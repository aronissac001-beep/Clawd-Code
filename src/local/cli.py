"""``clawd-local`` — manage the local model ladder.

    clawd-local doctor              check binaries, GPU, models, config
    clawd-local status              show profile, running servers, VRAM
    clawd-local profile [name]      show or switch the active resource profile
    clawd-local fetch <tier|all>    download GGUF weights
    clawd-local start <tier>        bring a tier up
    clawd-local stop <tier|all>     take a tier down
    clawd-local bench <tier>        measure real tokens/sec on this machine
    clawd-local tune deep           find the smallest --n-cpu-moe that fits
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from .backends import build_llamacpp_args
from .config import (
    ConfigError,
    StackConfig,
    Tier,
    load_config,
    set_active_profile,
    set_tier_value,
)
from .supervisor import ModelSupervisor, SupervisorError, query_free_vram_mb

HF_URL = "https://huggingface.co/{repo}/resolve/main/{file}"

BENCH_PROMPT = (
    "Write a Python function that parses an ISO-8601 duration string such as "
    "'P3DT4H5M6S' into a datetime.timedelta. Handle missing components and "
    "raise ValueError on malformed input. Include three doctests."
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _fmt_mb(mb: float) -> str:
    return f"{mb / 1024:.1f} GB" if mb >= 1024 else f"{int(mb)} MB"


def gguf_block_count(path: Path) -> Optional[int]:
    """Read the transformer layer count from a GGUF header.

    Parses only the metadata block, so it costs a few KB of reads rather than
    loading the model. Used to bound the --n-cpu-moe search: probing values
    above the real layer count wastes a full model load each time.

    Returns None if the file is not parseable rather than raising — a failed
    introspection should degrade to a default range, not abort the tune.
    """
    import struct

    # GGUF metadata value type enum.
    (U8, I8, U16, I16, U32, I32, F32, BOOL, STRING, ARRAY, U64, I64, F64) = range(13)
    FIXED = {U8: 1, I8: 1, U16: 2, I16: 2, U32: 4, I32: 4, F32: 4,
             BOOL: 1, U64: 8, I64: 8, F64: 8}

    try:
        with path.open("rb") as fh:
            if fh.read(4) != b"GGUF":
                return None
            struct.unpack("<I", fh.read(4))[0]           # version
            fh.read(8)                                    # tensor_count
            n_kv = struct.unpack("<Q", fh.read(8))[0]

            def read_str() -> str:
                n = struct.unpack("<Q", fh.read(8))[0]
                return fh.read(n).decode("utf-8", errors="replace")

            def skip_value(vtype: int) -> None:
                if vtype in FIXED:
                    fh.read(FIXED[vtype])
                elif vtype == STRING:
                    read_str()
                elif vtype == ARRAY:
                    elem_type = struct.unpack("<I", fh.read(4))[0]
                    count = struct.unpack("<Q", fh.read(8))[0]
                    if elem_type in FIXED:
                        fh.read(FIXED[elem_type] * count)
                    elif elem_type == STRING:
                        for _ in range(count):
                            read_str()
                    else:
                        raise ValueError(f"unsupported array element type {elem_type}")
                else:
                    raise ValueError(f"unsupported value type {vtype}")

            for _ in range(min(n_kv, 4096)):
                key = read_str()
                vtype = struct.unpack("<I", fh.read(4))[0]
                if key.endswith(".block_count") and vtype in (U32, I32, U64, I64):
                    raw = fh.read(FIXED[vtype])
                    fmt = {U32: "<I", I32: "<i", U64: "<Q", I64: "<q"}[vtype]
                    return int(struct.unpack(fmt, raw)[0])
                skip_value(vtype)
    except (OSError, ValueError, struct.error, KeyError):
        return None
    return None


def remote_size(repo: str, filename: str) -> Optional[int]:
    """Authoritative file size from the HF API, or None if unreachable.

    Used to verify downloads. Existence on disk is not proof of completeness —
    an interrupted transfer leaves a plausible-looking file that only fails
    later, deep inside llama.cpp, as an unhelpful GGUF parse error.
    """
    url = f"https://huggingface.co/api/models/{repo}/tree/main"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "clawd-local/1.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            entries = json.loads(resp.read().decode())
    except (urllib.error.URLError, OSError, ValueError, TimeoutError):
        return None
    for entry in entries:
        if entry.get("path") == filename:
            size = entry.get("size")
            return int(size) if size else None
    return None


def verify_model(cfg: StackConfig, tier: Tier) -> tuple[bool, str]:
    """Check a downloaded model against its upstream size.

    Returns (ok, message). Unreachable network is treated as OK-with-caveat
    rather than a failure, so the check never blocks offline use.
    """
    path = cfg.model_path(tier)
    if not path.is_file():
        return False, "missing"
    local = path.stat().st_size
    expected = remote_size(tier.repo, tier.file)
    if expected is None:
        return True, f"{_fmt_mb(local / (1024*1024))} (size unverified: offline)"
    if local != expected:
        pct = local / expected if expected else 0
        return False, (
            f"TRUNCATED {_fmt_mb(local / (1024*1024))} of "
            f"{_fmt_mb(expected / (1024*1024))} ({pct:.0%})"
        )
    return True, _fmt_mb(local / (1024 * 1024))


def _download_parallel(
    url: str,
    dest: Path,
    total: int,
    label: str,
    connections: int = 8,
    chunk_mb: int = 32,
) -> None:
    """Fetch a file over several ranged connections at once.

    HuggingFace throttles each connection (measured ~270 KB/s here), so a
    single stream makes a 20 GB model an overnight job. Requesting disjoint
    byte ranges in parallel sidesteps that limit.

    Progress is recorded per chunk in a sidecar JSON file, so an interrupted
    download resumes at chunk granularity instead of restarting. The output
    file is preallocated and written at offsets, which avoids needing double
    the disk space that a concatenate-the-parts approach would.
    """
    import concurrent.futures
    import threading

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    state_path = dest.with_suffix(dest.suffix + ".progress")

    chunk_size = chunk_mb * 1024 * 1024
    n_chunks = (total + chunk_size - 1) // chunk_size

    done_chunks: set[int] = set()
    if state_path.is_file() and tmp.is_file():
        try:
            saved = json.loads(state_path.read_text())
            if saved.get("total") == total and saved.get("chunk_size") == chunk_size:
                done_chunks = set(saved.get("done", []))
        except (ValueError, OSError):
            done_chunks = set()

    # Preallocate so workers can seek and write independently.
    if not tmp.is_file() or tmp.stat().st_size != total:
        with tmp.open("wb") as fh:
            fh.truncate(total)
        done_chunks = set()

    lock = threading.Lock()
    fh = tmp.open("r+b")
    completed = len(done_chunks)
    bytes_done = completed * chunk_size
    resumed_bytes = bytes_done  # excluded from the rate so ETA reflects this run
    start_time = time.time()
    last_report = 0.0
    failures: list[str] = []

    def fetch_chunk(idx: int) -> None:
        nonlocal completed, bytes_done, last_report
        begin = idx * chunk_size
        end = min(begin + chunk_size, total) - 1
        for attempt in range(4):
            try:
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": "clawd-local/1.0",
                        "Range": f"bytes={begin}-{end}",
                    },
                )
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = resp.read()
                if len(data) != end - begin + 1:
                    raise OSError(f"short chunk {idx}: {len(data)} of {end-begin+1}")
                with lock:
                    fh.seek(begin)
                    fh.write(data)
                    done_chunks.add(idx)
                    completed += 1
                    bytes_done += len(data)
                    now = time.time()
                    if now - last_report > 1.0:
                        elapsed = max(now - start_time, 0.001)
                        rate = (bytes_done - resumed_bytes) / elapsed
                        pct = completed / n_chunks * 100
                        eta = (total - bytes_done) / rate if rate > 0 else 0
                        sys.stdout.write(
                            f"\r  {label}: {pct:5.1f}%  "
                            f"{bytes_done / (1024**3):.2f}/{total / (1024**3):.2f} GB  "
                            f"{rate / (1024**2):.2f} MB/s  ETA {eta / 60:.0f}m    "
                        )
                        sys.stdout.flush()
                        last_report = now
                        state_path.write_text(json.dumps({
                            "total": total, "chunk_size": chunk_size,
                            "done": sorted(done_chunks),
                        }))
                return
            except Exception as exc:  # noqa: BLE001 - retry any transport error
                if attempt == 3:
                    with lock:
                        failures.append(f"chunk {idx}: {exc}")
                    return
                time.sleep(1.5 * (attempt + 1))

    pending = [i for i in range(n_chunks) if i not in done_chunks]
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=connections) as pool:
            list(pool.map(fetch_chunk, pending))
    finally:
        fh.close()

    sys.stdout.write("\r" + " " * 78 + "\r")

    if failures:
        state_path.write_text(json.dumps({
            "total": total, "chunk_size": chunk_size, "done": sorted(done_chunks),
        }))
        raise OSError(
            f"{len(failures)} chunk(s) failed, e.g. {failures[0]}. "
            f"Progress saved; re-run fetch to resume."
        )

    if tmp.stat().st_size != total:
        raise OSError(f"size mismatch after download: {tmp.stat().st_size} != {total}")

    tmp.replace(dest)
    state_path.unlink(missing_ok=True)


def _download_hf(repo: str, filename: str, dest: Path) -> bool:
    """Download via huggingface_hub, which uses the chunked Xet protocol.

    Substantially faster than a single-stream HTTP GET, and it resumes properly
    across interruptions because partial chunks are committed to a cache rather
    than buffered in memory. Returns False if the library is unavailable so the
    caller can fall back.
    """
    try:
        from huggingface_hub import hf_hub_download
    except ModuleNotFoundError:
        return False

    dest.parent.mkdir(parents=True, exist_ok=True)
    cached = hf_hub_download(
        repo_id=repo,
        filename=filename,
        local_dir=str(dest.parent),
        # Keep the blob cache next to the models so a re-fetch is instant and
        # does not land in the user's home directory unannounced.
        cache_dir=str(dest.parent / ".cache"),
    )
    cached_path = Path(cached)
    if cached_path.resolve() != dest.resolve():
        if dest.exists():
            dest.unlink()
        cached_path.replace(dest)
    return True


def _download(url: str, dest: Path, label: str) -> None:
    """Stream a file to disk with resume support and a progress line.

    Fallback for when huggingface_hub is not installed.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    existing = tmp.stat().st_size if tmp.exists() else 0

    req = urllib.request.Request(url, headers={"User-Agent": "clawd-local/1.0"})
    if existing:
        req.add_header("Range", f"bytes={existing}-")

    try:
        resp = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as exc:
        if exc.code == 416 and existing:  # already complete
            tmp.rename(dest)
            return
        raise

    total = int(resp.headers.get("Content-Length", 0)) + existing
    mode = "ab" if existing and resp.status == 206 else "wb"
    if mode == "wb":
        existing = 0

    done = existing
    last_report = 0.0
    with tmp.open(mode) as fh:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            fh.write(chunk)
            done += len(chunk)
            now = time.time()
            if now - last_report > 0.5:
                pct = (done / total * 100) if total else 0
                sys.stdout.write(
                    f"\r  {label}: {_fmt_mb(done / 1e6 * 1.048576)} "
                    f"/ {_fmt_mb(total / 1e6 * 1.048576)} ({pct:.0f}%)   "
                )
                sys.stdout.flush()
                last_report = now
    sys.stdout.write("\r" + " " * 78 + "\r")

    # A dropped connection makes read() return b"" — indistinguishable from a
    # clean end of stream. Without this check a truncated file gets renamed as
    # if it were complete, and only surfaces later as a corrupt-GGUF error.
    if total and done != total:
        raise OSError(
            f"truncated download: got {done} of {total} bytes "
            f"({done / total:.0%}). The partial file is kept at {tmp.name}; "
            f"re-run fetch to resume."
        )
    tmp.rename(dest)


def _openai_chat(base_url: str, model: str, prompt: str, max_tokens: int = 256) -> dict:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.0,
        "stream": False,
    }).encode()
    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer local"},
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(resp.read().decode())


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------


def cmd_doctor(cfg: StackConfig, args) -> int:
    ok = True
    print(f"config      : {cfg.stack_dir / 'clawd-local.yaml'}")
    print(f"profile     : {cfg.profile.name}  "
          f"(vram {_fmt_mb(cfg.profile.vram_mb)}, ram {_fmt_mb(cfg.profile.ram_mb)}, "
          f"{cfg.profile.threads}t/{cfg.profile.threads_batch}tb, "
          f"ctx<={cfg.profile.max_context})")

    if cfg.server_bin.is_file():
        print(f"llama-server: {cfg.server_bin}")
    else:
        print(f"llama-server: MISSING at {cfg.server_bin}")
        ok = False

    free = query_free_vram_mb()
    if free is None:
        print("gpu         : nvidia-smi unavailable (CPU-only operation)")
    else:
        print(f"gpu         : {_fmt_mb(free)} VRAM free now, "
              f"budget {_fmt_mb(cfg.profile.vram_mb)}")
        if free < cfg.profile.vram_mb:
            print(f"              note: budget exceeds free VRAM; something else is "
                  f"holding {_fmt_mb(cfg.profile.vram_mb - free)}")

    print("models      :")
    for name, tier in cfg.tiers.items():
        good, detail = verify_model(cfg, tier)
        if good:
            print(f"  {name:<10} ok       {detail:>22}  {tier.file}")
        elif detail == "missing":
            print(f"  {name:<10} MISSING  {_fmt_mb(tier.approx_mb):>22}  {tier.file}")
            ok = False
        else:
            print(f"  {name:<10} BAD      {detail:>22}  {tier.file}")
            ok = False

    # Model ids from OpenRouter already carry their org prefix, so prefixing
    # the provider name again renders as "openrouter/openrouter/free".
    target = (cfg.cloud.model if "/" in cfg.cloud.model
              else f"{cfg.cloud.provider}/{cfg.cloud.model}")
    cost = f", cost_mode={cfg.cloud.cost_mode}" if cfg.cloud.provider == "openrouter" else ""
    print(f"cloud       : policy={cfg.cloud.policy} ({target}{cost})"
          + ("  [cannot spend money]" if cfg.cloud.is_free_only else ""))

    if not ok:
        print("\nSome components are missing. Run: clawd-local fetch all")
    return 0 if ok else 1


def cmd_status(cfg: StackConfig, args) -> int:
    sup = ModelSupervisor(cfg)
    rows = sup.status()
    print(f"profile: {cfg.profile.name}   budget: {_fmt_mb(cfg.profile.vram_mb)} VRAM")
    free = query_free_vram_mb()
    if free is not None:
        print(f"gpu    : {_fmt_mb(free)} free")
    if not rows:
        print("\nNo servers running in this process.")
        print("Note: servers are started on demand by the agent, and are")
        print("owned by the process that started them.")
        return 0
    print(f"\n{'tier':<10} {'backend':<9} {'device':<8} {'vram':>9}  {'idle':>6}  url")
    for r in rows:
        print(f"{r['tier']:<10} {r['backend']:<9} {r['device']:<8} "
              f"{_fmt_mb(r['vram_mb']):>9}  {r['idle_s']:>5}s  {r['url']}")
    return 0


def cmd_profile(cfg: StackConfig, args) -> int:
    if not args.name:
        print(f"active: {cfg.profile.name}\n")
        print(f"{'profile':<12} {'vram':>9} {'ram':>9} {'thr':>5} {'ctx':>7}  deep")
        for name, p in cfg.profiles.items():
            mark = "*" if name == cfg.profile.name else " "
            print(f"{mark}{name:<11} {_fmt_mb(p.vram_mb):>9} {_fmt_mb(p.ram_mb):>9} "
                  f"{p.threads:>5} {p.max_context:>7}  {'yes' if p.allow_deep_tier else 'no'}")
        return 0

    if args.name not in cfg.profiles:
        print(f"unknown profile {args.name!r}. Known: {', '.join(cfg.profiles)}")
        return 1
    set_active_profile(cfg.stack_dir, args.name)
    print(f"active profile -> {args.name}")
    print("Restart running servers for this to take effect: clawd-local stop all")
    return 0


def cmd_fetch(cfg: StackConfig, args) -> int:
    targets: list[Tier]
    if args.tier == "all":
        targets = list(cfg.tiers.values())
    else:
        tier = cfg.tiers.get(args.tier)
        if tier is None:
            print(f"unknown tier {args.tier!r}. Known: {', '.join(cfg.tiers)}")
            return 1
        targets = [tier]

    total = sum(t.approx_mb for t in targets if not cfg.model_path(t).is_file())
    if total:
        print(f"About to download ~{_fmt_mb(total)} into {cfg.models_dir}\n")

    for tier in targets:
        dest = cfg.model_path(tier)
        if dest.is_file():
            ok, detail = verify_model(cfg, tier)
            if ok:
                print(f"  {tier.name:<10} already present  {detail}")
                continue
            # A truncated file is worse than a missing one: it looks complete
            # and fails much later. Replace it rather than skipping.
            print(f"  {tier.name:<10} {detail} - re-downloading")
            dest.unlink()
        url = HF_URL.format(repo=tier.repo, file=tier.file)
        print(f"  {tier.name:<10} {tier.repo}")
        # Clear any stale partial from the fallback downloader.
        stale = dest.with_suffix(dest.suffix + ".part")
        if stale.exists():
            stale.unlink()
        try:
            # Prefer parallel ranged GETs: HF throttles per connection, so this
            # is several times faster than any single-stream path. Falls back to
            # a single stream only when the size is unknown (offline API).
            size = remote_size(tier.repo, tier.file)
            if size:
                _download_parallel(url, dest, size, tier.name,
                                   connections=args.connections)
            else:
                _download(url, dest, tier.name)
            ok, detail = verify_model(cfg, tier)
            if not ok:
                print(f"  {tier.name:<10} FAILED verification: {detail}")
                return 1
            print(f"  {tier.name:<10} done  {detail}")
        except urllib.error.HTTPError as exc:
            print(f"  {tier.name:<10} FAILED {exc.code} {exc.reason}")
            print(f"             checked: {url}")
            print("             The repo or filename may have changed upstream;")
            print("             verify it on huggingface.co and update clawd-local.yaml.")
            return 1
        except (urllib.error.URLError, OSError) as exc:
            print(f"  {tier.name:<10} FAILED {exc}")
            return 1
        except Exception as exc:  # noqa: BLE001 - hub client raises its own types
            print(f"  {tier.name:<10} FAILED {type(exc).__name__}: {exc}")
            print(f"             checked: {url}")
            return 1
    return 0


def cmd_start(cfg: StackConfig, args) -> int:
    sup = ModelSupervisor(cfg)
    try:
        ep = sup.get(args.tier)
    except (SupervisorError, RuntimeError) as exc:
        print(f"error: {exc}")
        return 1
    print(f"{args.tier} up at {ep.base_url}")
    print("\nThis process owns the server; it stops when this command exits.")
    print("Press Ctrl-C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nstopping...")
        sup.shutdown()
    return 0


def cmd_stop(cfg: StackConfig, args) -> int:
    # Servers are owned by the process that spawned them; from here we can only
    # clean up stragglers by port.
    import subprocess

    ports = (
        [t.port for t in cfg.tiers.values() if t.port]
        if args.tier == "all"
        else [cfg.tiers[args.tier].port]
        if args.tier in cfg.tiers
        else []
    )
    if not ports:
        print(f"unknown tier {args.tier!r}")
        return 1

    from .supervisor import NO_WINDOW

    killed = 0
    for port in ports:
        # creationflags keeps these from flashing a console window, which is
        # very visible when the UI calls this on every launch and exit.
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"(Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue)"
             f" | Select-Object -ExpandProperty OwningProcess -Unique"],
            capture_output=True, text=True, check=False, creationflags=NO_WINDOW,
        )
        for pid in out.stdout.split():
            if pid.strip().isdigit():
                subprocess.run(["taskkill", "/PID", pid.strip(), "/F"],
                               capture_output=True, check=False,
                               creationflags=NO_WINDOW)
                killed += 1
    print(f"stopped {killed} server process(es)")
    return 0


def cmd_bench(cfg: StackConfig, args) -> int:
    tier = cfg.tiers.get(args.tier)
    if tier is None:
        print(f"unknown tier {args.tier!r}")
        return 1

    # Allow overriding placement/speculation for A-B comparisons without
    # editing the config file.
    overrides = {}
    if args.spec_type:
        overrides["spec_type"] = args.spec_type
    if args.n_cpu_moe is not None:
        overrides["n_cpu_moe"] = args.n_cpu_moe
    if overrides:
        from dataclasses import replace as _replace

        tier = _replace(tier, **overrides)
        cfg = StackConfig(**{**cfg.__dict__, "tiers": {**cfg.tiers, tier.name: tier}})
        print(f"override: {', '.join(f'{k}={v}' for k, v in overrides.items())}")

    sup = ModelSupervisor(cfg)
    print(f"starting {args.tier} (this can take a minute for large models)...")
    try:
        ep = sup.get(args.tier)
    except (SupervisorError, RuntimeError) as exc:
        print(f"error: {exc}")
        return 1

    try:
        print("warming up...")
        _openai_chat(ep.base_url, tier.name, "Say OK.", max_tokens=8)

        # Prefill throughput matters more than generation for agent work: every
        # turn re-sends ~8-10k tokens of tool schemas and file content before a
        # single token is produced. A tier can generate quickly and still be
        # unusable if it processes prompts slowly, which is exactly what the
        # MoE tier does with its experts on the CPU.
        print(f"measuring prompt processing ({args.prefill_tokens} token prompt)...")
        big = (BENCH_PROMPT + "\n\n" + "".join(
            f"def helper_{i}(value):\n    return value * {i}\n\n"
            for i in range(args.prefill_tokens // 12)
        ))
        t0 = time.time()
        resp = _openai_chat(ep.base_url, tier.name, big, max_tokens=1)
        prefill_elapsed = time.time() - t0
        prompt_tokens = (resp.get("usage") or {}).get("prompt_tokens", 0)
        prefill_rate = prompt_tokens / prefill_elapsed if prefill_elapsed else 0
        print(f"  prefill: {prompt_tokens} tok in {prefill_elapsed:.1f}s "
              f"= {prefill_rate:.0f} tok/s")
        if prefill_rate:
            print(f"  -> a 10k-token agent turn would spend "
                  f"{10000 / prefill_rate:.0f}s on prompt processing alone")

        print(f"\nbenchmarking generation ({args.n} runs)...")
        rates = []
        for i in range(args.n):
            t0 = time.time()
            resp = _openai_chat(ep.base_url, tier.name, BENCH_PROMPT, max_tokens=args.tokens)
            elapsed = time.time() - t0
            out_tokens = (resp.get("usage") or {}).get("completion_tokens", 0)
            if out_tokens and elapsed > 0:
                rate = out_tokens / elapsed
                rates.append(rate)
                print(f"  run {i+1}: {out_tokens} tok in {elapsed:.1f}s = {rate:.1f} tok/s")

        if rates:
            best = max(rates)
            avg = sum(rates) / len(rates)
            print(f"\n{args.tier}: {avg:.1f} tok/s avg, {best:.1f} tok/s best")
            free = query_free_vram_mb()
            if free is not None:
                print(f"VRAM free while loaded: {_fmt_mb(free)}")
        else:
            print("no usable timing data returned")
            return 1
    finally:
        sup.shutdown()
    return 0


def cmd_tune(cfg: StackConfig, args) -> int:
    """Find the smallest --n-cpu-moe that still fits, which is the fastest.

    Higher N pushes more expert layers to system RAM, freeing VRAM but adding
    CPU work. We walk N downwards from all-CPU and keep the last value that
    both loads and benchmarks well.
    """
    tier = cfg.tiers.get(args.tier)
    if tier is None:
        print(f"unknown tier {args.tier!r}")
        return 1
    if tier.device != "hybrid":
        print(f"tier {args.tier!r} is device={tier.device}; --n-cpu-moe only "
              "applies to hybrid MoE tiers.")
        return 1
    if not cfg.model_path(tier).is_file():
        print(f"model not downloaded. Run: clawd-local fetch {args.tier}")
        return 1

    # Bound the search by the model's real depth. Probing above the layer count
    # is a wasted 20 GB load, and llama.cpp silently clamps it so the results
    # look like duplicates rather than errors.
    # Begin at FULL offload and walk down. Maximum offload is the only setting
    # guaranteed to fit, so starting there guarantees at least one working
    # result; starting lower risks every probe failing to load and the whole
    # run (six 20 GB reloads) returning nothing.
    blocks = gguf_block_count(cfg.model_path(tier))
    if args.start is not None:
        start = args.start          # explicit --start wins
        print(f"model depth: {blocks or 'unknown'} layers; starting at {start} (explicit)")
    elif blocks:
        start = blocks              # full offload: the one setting sure to fit
        print(f"model depth: {blocks} layers (starting at full offload)")
    else:
        start = 48
        print("model depth: could not read GGUF header; starting at 48")

    steps = list(range(start, args.stop - 1, -args.step))
    print(f"Tuning --n-cpu-moe for {args.tier}: probing {steps}")
    print(f"Each step reloads the model, so expect roughly "
          f"{len(steps)} x 1-3 minutes.\n")

    best_n: Optional[int] = None
    best_rate = 0.0

    for n in steps:
        print(f"  n_cpu_moe={n} ... ", end="", flush=True)
        probe = Tier(**{**tier.__dict__, "n_cpu_moe": n})
        probe_cfg = StackConfig(**{**cfg.__dict__, "tiers": {**cfg.tiers, tier.name: probe}})
        sup = ModelSupervisor(probe_cfg)
        try:
            ep = sup.get(tier.name)
            # A short warmup does not fault 20 GB of MoE experts into the page
            # cache, so the first timed run measures disk rather than the
            # offload setting. Take the best of several runs instead.
            _openai_chat(ep.base_url, tier.name, "Say OK.", max_tokens=8)
            rate = 0.0
            for _ in range(args.runs):
                t0 = time.time()
                resp = _openai_chat(ep.base_url, tier.name, BENCH_PROMPT, max_tokens=128)
                elapsed = time.time() - t0
                out_tokens = (resp.get("usage") or {}).get("completion_tokens", 0)
                if elapsed > 0 and out_tokens:
                    rate = max(rate, out_tokens / elapsed)
            free = query_free_vram_mb()
            print(f"{rate:.1f} tok/s, {_fmt_mb(free or 0)} VRAM free")
            if rate > best_rate:
                best_rate, best_n = rate, n
        except Exception as exc:  # noqa: BLE001 - any failure means "does not fit"
            msg = str(exc).splitlines()[0][:70]
            print(f"failed ({msg})")
        finally:
            sup.shutdown()
            time.sleep(2)  # let the driver release VRAM

    if best_n is None:
        print("\nNo configuration loaded successfully.")
        print("The model may be too large for this profile. Try a smaller quant.")
        return 1

    print(f"\nbest: n_cpu_moe={best_n} at {best_rate:.1f} tok/s")
    set_tier_value(cfg.stack_dir, tier.name, "n_cpu_moe", best_n)
    print(f"written to clawd-local.yaml ({tier.name}.n_cpu_moe = {best_n})")
    return 0


def cmd_args(cfg: StackConfig, args) -> int:
    """Print the exact llama-server command line for a tier (for debugging)."""
    tier = cfg.tiers.get(args.tier)
    if tier is None:
        print(f"unknown tier {args.tier!r}")
        return 1
    try:
        print(" ".join(f'"{a}"' if " " in a else a for a in build_llamacpp_args(cfg, tier)))
    except RuntimeError as exc:
        print(f"error: {exc}")
        return 1
    return 0


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="clawd-local", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stack-dir", help="directory holding clawd-local.yaml")
    parser.add_argument("--profile", help="override the active profile for this command")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("doctor", help="check binaries, GPU, models").set_defaults(fn=cmd_doctor)
    sub.add_parser("status", help="show running servers").set_defaults(fn=cmd_status)

    p = sub.add_parser("profile", help="show or switch resource profile")
    p.add_argument("name", nargs="?")
    p.set_defaults(fn=cmd_profile)

    p = sub.add_parser("fetch", help="download model weights")
    p.add_argument("tier", help="tier name, or 'all'")
    p.add_argument("-j", "--connections", type=int, default=8,
                   help="parallel connections (default 8; HF throttles each one)")
    p.set_defaults(fn=cmd_fetch)

    p = sub.add_parser("start", help="start a tier in the foreground")
    p.add_argument("tier")
    p.set_defaults(fn=cmd_start)

    p = sub.add_parser("stop", help="stop a tier, or 'all'")
    p.add_argument("tier")
    p.set_defaults(fn=cmd_stop)

    p = sub.add_parser("bench", help="measure tokens/sec")
    p.add_argument("tier")
    p.add_argument("-n", type=int, default=3, help="number of runs (default 3)")
    p.add_argument("--tokens", type=int, default=256, help="tokens to generate")
    p.add_argument("--spec-type", dest="spec_type",
                   help="override speculation for this run (e.g. none, draft-mtp, ngram-simple)")
    p.add_argument("--n-cpu-moe", dest="n_cpu_moe", type=int,
                   help="override MoE CPU offload layers for this run")
    p.add_argument("--prefill-tokens", type=int, default=6000,
                   help="approx prompt size for the prefill measurement")
    p.set_defaults(fn=cmd_bench)

    p = sub.add_parser("tune", help="find the best --n-cpu-moe for a hybrid tier")
    p.add_argument("tier", nargs="?", default="deep")
    p.add_argument("--start", type=int, default=None,
                   help="highest n to try (default: the model's layer count, i.e. full offload)")
    p.add_argument("--stop", type=int, default=8, help="lowest n to try")
    p.add_argument("--step", type=int, default=8)
    p.add_argument("--runs", type=int, default=3,
                   help="timed runs per probe; best is kept (default 3)")
    p.set_defaults(fn=cmd_tune)

    p = sub.add_parser("args", help="print the llama-server command line for a tier")
    p.add_argument("tier")
    p.set_defaults(fn=cmd_args)

    ns = parser.parse_args(argv)

    try:
        cfg = load_config(stack_dir=ns.stack_dir, profile_override=ns.profile)
    except ConfigError as exc:
        print(f"config error: {exc}")
        return 2

    return ns.fn(cfg, ns)


if __name__ == "__main__":
    raise SystemExit(main())
