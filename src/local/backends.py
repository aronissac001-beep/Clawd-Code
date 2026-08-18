"""Backend adapters: turn a resolved Tier into a running OpenAI-compatible server.

Two backends:

``llamacpp``
    Primary. The only backend exposing ``--n-cpu-moe`` and ``--spec-type``,
    which the deep and workhorse tiers respectively depend on. We spawn and
    supervise ``llama-server.exe`` ourselves.

``ollama``
    Optional, per-tier. Ollama manages its own model lifecycle, so we only
    check reachability and hand back a base URL. Convenient for the small
    tiers where the advanced flags do not matter.

All flag names verified against llama.cpp build b10405.
"""

from __future__ import annotations

import shutil
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Optional

from .config import StackConfig, Tier


class BackendError(RuntimeError):
    """Raised when a backend cannot start or become healthy."""


@dataclass
class Endpoint:
    """A live OpenAI-compatible endpoint."""

    base_url: str
    tier: str
    backend: str
    process: Optional[subprocess.Popen] = None
    vram_mb: int = 0
    started_at: float = 0.0
    last_used: float = 0.0

    def touch(self) -> None:
        self.last_used = time.time()


# ---------------------------------------------------------------------------
# llama.cpp
# ---------------------------------------------------------------------------


def build_llamacpp_args(cfg: StackConfig, tier: Tier) -> list[str]:
    """Construct the llama-server command line for a tier.

    The profile supplies thread counts and the context ceiling; the tier
    supplies placement and speculation strategy.
    """
    model_path = cfg.model_path(tier)
    if not model_path.is_file():
        raise BackendError(
            f"model file missing for tier {tier.name!r}: {model_path}\n"
            f"Fetch it with: clawd-local fetch {tier.name}"
        )

    profile = cfg.profile
    args: list[str] = [
        str(cfg.server_bin),
        "-m", str(model_path),
        "--host", cfg.host,
        "--port", str(tier.port),
        "-c", str(tier.context),
        "-t", str(profile.threads),
        "-tb", str(profile.threads_batch),
        # One slot. MTP speculation does not support -np > 1, and an agent
        # driver issues strictly sequential requests anyway.
        "-np", "1",
        "--no-webui",
    ]

    # -- vision ------------------------------------------------------------
    # A vision model started without its projector loads without complaint and
    # then silently ignores every image, which looks exactly like the model
    # being bad at the task. Fail loudly instead.
    if tier.mmproj:
        mmproj_path = cfg.mmproj_path(tier)
        if mmproj_path is None or not mmproj_path.is_file():
            raise BackendError(
                f"tier {tier.name!r} is a vision tier but its projector is "
                f"missing: {mmproj_path}\n"
                f"Fetch it with: clawd-local fetch {tier.name}"
            )
        args += ["--mmproj", str(mmproj_path)]

    # -- placement ---------------------------------------------------------
    if tier.device == "cpu":
        args += ["-ngl", "0"]
    else:
        args += ["-ngl", str(tier.n_gpu_layers)]

    # A split placement must not be memory-mapped, whichever label the tier
    # wears.
    #
    # This was gated on device == "hybrid", which reads as "the MoE tier" but
    # actually means "the tier whose weights do not all fit on the card". A
    # dense tier with n_gpu_layers below its layer count is in exactly the same
    # position: 8 GB of its weights live in system RAM and are read in full on
    # every token. Under the default mmap they are clean, file-backed pages,
    # which Windows is free to evict under memory pressure -- and then every
    # token faults them back from disk. 13 GB of weights against ~13 GB of
    # free RAM is precisely when that happens.
    split_placement = tier.device == "hybrid" or (
        tier.device == "gpu" and tier.n_gpu_layers not in (None, 0)
        and tier.n_gpu_layers < 999
    )
    if split_placement:
        # llama.cpp warns explicitly when tensor overrides are combined with
        # mmap: paging expert weights through the mapping on every prefill
        # batch is far slower than holding them in resident memory.
        # (--no-mmap is deprecated in b10405; --load-mode none replaces it.)
        args += ["--load-mode", "none"]

    if tier.device == "hybrid":
        # Routed experts to system RAM, attention/dense stay on the GPU.
        if tier.n_cpu_moe in (None, "auto"):
            # Safe default until `clawd-local tune deep` measures the real
            # value: push every expert to CPU. Slowest-but-fits.
            args += ["-cmoe"]
        else:
            args += ["-ncmoe", str(tier.n_cpu_moe)]

    # -- attention / cache -------------------------------------------------
    if tier.flash_attn:
        args += ["-fa", "on"]
    if tier.cache_type_k:
        args += ["-ctk", tier.cache_type_k]
    if tier.cache_type_v:
        args += ["-ctv", tier.cache_type_v]

    # -- batching ----------------------------------------------------------
    # MoE CPU offload is very sensitive to prompt batch size: large batches let
    # llama.cpp ship CPU-resident weights to the GPU once and process the whole
    # batch there, instead of round-tripping per token.
    if tier.batch_size:
        args += ["-b", str(tier.batch_size)]
    if tier.ubatch_size:
        args += ["-ub", str(tier.ubatch_size)]

    # -- speculation -------------------------------------------------------
    # Dense tiers only. See the policy note in clawd-local.yaml: speculation
    # measures net-negative on A3B MoE because each verified token pulls a
    # fresh expert slice through memory.
    if tier.spec_type and tier.spec_type != "none":
        args += ["--spec-type", tier.spec_type, "--spec-draft-n-max", str(tier.spec_draft_n_max)]
        if tier.spec_type.startswith("draft-") and tier.spec_type != "draft-mtp":
            draft = cfg.tiers.get("draft")
            if draft is None:
                raise BackendError(
                    f"tier {tier.name!r} uses {tier.spec_type} but no draft tier is configured"
                )
            draft_path = cfg.model_path(draft)
            if not draft_path.is_file():
                raise BackendError(
                    f"draft model missing: {draft_path}\n"
                    f"Fetch it with: clawd-local fetch draft"
                )
            args += ["-md", str(draft_path), "-ngld", "999"]

    return args


def start_llamacpp(cfg: StackConfig, tier: Tier, log_dir: Path) -> Endpoint:
    """Spawn llama-server for a tier and block until it answers health checks."""
    if not cfg.server_bin.is_file():
        raise BackendError(
            f"llama-server not found at {cfg.server_bin}. "
            "Run scripts/install-llamacpp.ps1 to install it."
        )

    args = build_llamacpp_args(cfg, tier)
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{tier.name}.log"
    log_fh = log_path.open("a", encoding="utf-8", errors="replace")
    log_fh.write(f"\n{'=' * 70}\n{time.strftime('%Y-%m-%d %H:%M:%S')}\n{' '.join(args)}\n{'=' * 70}\n")
    log_fh.flush()

    creation_flags = 0
    if hasattr(subprocess, "CREATE_NO_WINDOW"):
        creation_flags = subprocess.CREATE_NO_WINDOW

    proc = subprocess.Popen(
        args,
        stdout=log_fh,
        stderr=subprocess.STDOUT,
        cwd=str(cfg.stack_dir),
        creationflags=creation_flags,
    )

    base_url = f"http://{cfg.host}:{tier.port}"
    deadline = time.time() + cfg.startup_timeout_s
    while time.time() < deadline:
        if proc.poll() is not None:
            raise BackendError(
                f"llama-server for tier {tier.name!r} exited with code {proc.returncode}. "
                f"See {log_path}"
            )
        if _health_ok(base_url):
            now = time.time()
            return Endpoint(
                base_url=f"{base_url}/v1",
                tier=tier.name,
                backend="llamacpp",
                process=proc,
                vram_mb=tier.vram_estimate_mb,
                started_at=now,
                last_used=now,
            )
        time.sleep(1.0)

    proc.terminate()
    raise BackendError(
        f"llama-server for tier {tier.name!r} did not become healthy within "
        f"{cfg.startup_timeout_s}s. See {log_path}"
    )


def _health_ok(base_url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{base_url}/health", timeout=2) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError, TimeoutError):
        return False


def stop_endpoint(endpoint: Endpoint, timeout: float = 10.0) -> None:
    """Terminate a spawned server, escalating to kill if it will not exit."""
    proc = endpoint.process
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


# ---------------------------------------------------------------------------
# Ollama
# ---------------------------------------------------------------------------


def start_ollama(cfg: StackConfig, tier: Tier) -> Endpoint:
    """Verify Ollama is reachable and serving the tier's tag.

    Ollama owns its own model lifecycle, so there is no process to spawn; we
    only confirm the daemon is up and the tag is present.
    """
    host = (cfg.backends.get("ollama") or {}).get("host", "http://127.0.0.1:11434")
    if not tier.ollama_tag:
        raise BackendError(f"tier {tier.name!r} has backend=ollama but no tag configured")

    try:
        with urllib.request.urlopen(f"{host}/api/tags", timeout=3) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        hint = (
            "Ollama is not running. Start it with `ollama serve`."
            if shutil.which("ollama")
            else "Ollama is not installed. Install it or set this tier's backend to llamacpp."
        )
        raise BackendError(f"cannot reach Ollama at {host}: {exc}. {hint}") from exc

    if tier.ollama_tag.split(":")[0] not in body:
        raise BackendError(
            f"Ollama has no model matching {tier.ollama_tag!r}. "
            f"Pull it with: ollama pull {tier.ollama_tag}"
        )

    now = time.time()
    return Endpoint(
        base_url=f"{host}/v1",
        tier=tier.name,
        backend="ollama",
        process=None,
        # Ollama manages its own VRAM; we do not account for it in our budget.
        vram_mb=0,
        started_at=now,
        last_used=now,
    )


def start_tier(cfg: StackConfig, tier: Tier, log_dir: Path) -> Endpoint:
    """Start a tier on whichever backend it is configured for.

    If a speculative configuration fails to load, retry once without it.
    MTP requires the GGUF to actually carry multi-token-prediction tensors,
    and not every quant of a model does — a tier that runs slightly slower
    beats a tier that refuses to start.
    """
    if tier.backend == "ollama":
        return start_ollama(cfg, tier)

    try:
        return start_llamacpp(cfg, tier, log_dir)
    except BackendError:
        if not tier.spec_type or tier.spec_type == "none":
            raise
        fallback = replace(tier, spec_type="none")
        print(
            f"  note: tier '{tier.name}' failed to start with "
            f"--spec-type {tier.spec_type}; retrying without speculation. "
            f"See {log_dir / (tier.name + '.log')}"
        )
        return start_llamacpp(cfg, fallback, log_dir)
