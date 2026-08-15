"""VRAM-budgeted lifecycle management for local model servers.

The hard constraint on an 8 GB laptop GPU: with ~1.1 GB held by the Windows
desktop compositor, roughly 7.0 GB is usable. The workhorse tier alone
(5.7 GB of weights plus ~1 GB of KV cache) very nearly fills that. So in
practice **only one GPU-resident tier fits at a time**, and switching tiers
means evicting the incumbent.

This module makes that explicit rather than letting llama-server fail with an
out-of-memory error halfway through a request. It:

  * tracks a VRAM budget from the active profile,
  * evicts least-recently-used GPU tiers to make room,
  * verifies against real ``nvidia-smi`` free memory before committing,
  * reaps servers that have gone idle.

CPU-resident tiers (``device: cpu``) cost no VRAM and are never evicted for
budget reasons, which is exactly why the reflex tier is placed there — it stays
warm for cheap summarisation work while the GPU serves the main loop.
"""

from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path
from typing import Optional

from .backends import BackendError, Endpoint, start_tier, stop_endpoint
from .config import StackConfig, Tier


class SupervisorError(RuntimeError):
    """Raised when a tier cannot be brought up within the resource budget."""


# Spawning a console-less child on Windows. Without this every subprocess
# flashes a black terminal window -- and since the UI polls VRAM on a timer,
# that means a window blinking on screen every few seconds.
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# nvidia-smi takes ~100ms and spawns a process. The UI asks for VRAM on every
# status poll, so results are cached briefly: the number does not change
# meaningfully between polls, and this collapses many spawns into one.
#
# The TTL has to exceed the poll interval or the cache never hits. It was 3s
# against a 6s poll, so the hit rate was exactly zero and every poll spawned a
# process: measured, that made /api/status 99ms instead of ~15ms, and on
# Windows a process spawn is the expensive part. Call sites that need an
# accurate number before committing VRAM pass max_age_s=0 explicitly, so
# lengthening this cannot affect eviction -- it only affects a sidebar readout.
_VRAM_CACHE: dict[str, float | int | None] = {"value": None, "at": 0.0}
_VRAM_TTL_S = 15.0


def query_free_vram_mb(max_age_s: float = _VRAM_TTL_S) -> Optional[int]:
    """Ask nvidia-smi for free VRAM. Returns None if unavailable.

    This is ground truth and beats our own accounting, because other processes
    (browsers, compositors, games) move the baseline underneath us.

    Pass ``max_age_s=0`` to force a fresh reading, which the supervisor does
    before committing to load a model.
    """
    now = time.time()
    if max_age_s > 0 and (now - float(_VRAM_CACHE["at"])) < max_age_s:
        return _VRAM_CACHE["value"]  # type: ignore[return-value]

    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
            creationflags=NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    first = out.stdout.strip().splitlines()
    if not first:
        return None
    try:
        value = int(first[0].strip())
    except ValueError:
        return None
    _VRAM_CACHE["value"] = value
    _VRAM_CACHE["at"] = now
    return value


def estimate_kv_cache_mb(tier: Tier) -> int:
    """Approximate KV cache VRAM for a tier.

    A rough per-token figure scaled by context length and halved when the
    cache is quantised to 8-bit. Deliberately conservative — the supervisor
    cross-checks against nvidia-smi before committing, so over-estimating
    costs an unnecessary eviction but never an OOM.
    """
    if tier.device == "cpu":
        return 0
    if tier.measured_vram_mb:
        # A measured figure is total observed usage, KV cache included.
        # Adding an estimate on top would double-count it.
        return 0
    # ~64 MB per 1K tokens is a reasonable f16 figure for a 9B-class model.
    per_1k = 64
    mb = (tier.context / 1024.0) * per_1k
    if tier.cache_type_k in ("q8_0", "q4_0"):
        mb *= 0.5
    if tier.device == "hybrid":
        # Only the attention layers stay resident for MoE offload.
        mb *= 0.6
    return int(mb)


class ModelSupervisor:
    """Starts, stops and budgets local model servers."""

    def __init__(self, cfg: StackConfig):
        self.cfg = cfg
        self.log_dir = cfg.stack_dir / "logs"
        self._endpoints: dict[str, Endpoint] = {}
        self._lock = threading.RLock()

    # -- budget ------------------------------------------------------------

    @property
    def budget_mb(self) -> int:
        return self.cfg.profile.vram_mb

    def _committed_vram_mb(self) -> int:
        return sum(
            ep.vram_mb + estimate_kv_cache_mb(self.cfg.tiers[ep.tier])
            for ep in self._endpoints.values()
            if self.cfg.tiers[ep.tier].uses_gpu
        )

    def _required_vram_mb(self, tier: Tier) -> int:
        if not tier.uses_gpu:
            return 0
        return tier.vram_estimate_mb + estimate_kv_cache_mb(tier)

    # -- lifecycle ---------------------------------------------------------

    def get(self, tier_name: str) -> Endpoint:
        """Return a live endpoint for a tier, starting or making room as needed."""
        with self._lock:
            tier = self.cfg.tiers.get(tier_name)
            if tier is None:
                raise SupervisorError(f"unknown tier {tier_name!r}")
            if not tier.serve:
                raise SupervisorError(
                    f"tier {tier_name!r} is not servable (serve: false). "
                    "The draft tier is consumed by the workhorse, not served directly."
                )

            self.reap_idle()

            existing = self._endpoints.get(tier_name)
            if existing is not None:
                if existing.process is None or existing.process.poll() is None:
                    existing.touch()
                    return existing
                # Died underneath us; drop it and restart.
                self._endpoints.pop(tier_name, None)

            self._make_room_for(tier)
            endpoint = start_tier(self.cfg, tier, self.log_dir)
            self._endpoints[tier_name] = endpoint
            return endpoint

    def _make_room_for(self, tier: Tier) -> None:
        """Evict LRU GPU tiers until the incoming tier fits the budget."""
        required = self._required_vram_mb(tier)
        if required == 0:
            return

        if required > self.budget_mb:
            raise SupervisorError(
                f"tier {tier.name!r} needs ~{required} MB of VRAM but the "
                f"'{self.cfg.profile.name}' profile budgets only {self.budget_mb} MB.\n"
                f"Either switch to a larger profile (clawd-local profile max), "
                f"reduce this tier's context, or set its device to cpu."
            )

        # Evict least-recently-used GPU residents until our own accounting fits.
        while self._committed_vram_mb() + required > self.budget_mb:
            victim = self._lru_gpu_endpoint()
            if victim is None:
                break
            self.stop(victim.tier, reason="evicted to make room for " + tier.name)

        # Cross-check against reality. Other processes may have taken VRAM
        # since we last looked, and nvidia-smi knows better than we do.
        # Force a fresh reading: a cached one could predate an eviction.
        free = query_free_vram_mb(max_age_s=0)
        if free is not None and free < required:
            while free is not None and free < required:
                victim = self._lru_gpu_endpoint()
                if victim is None:
                    break
                self.stop(victim.tier, reason="evicted after nvidia-smi shortfall")
                time.sleep(1.5)  # let the driver release the allocation
                free = query_free_vram_mb(max_age_s=0)
            if free is not None and free < required:
                raise SupervisorError(
                    f"only {free} MB of VRAM is free but tier {tier.name!r} needs "
                    f"~{required} MB, and there is nothing left to evict.\n"
                    f"Something outside Clawd-Code is holding VRAM. Close it, or "
                    f"run `clawd-local profile cpu_only` to keep off the GPU."
                )

    def _lru_gpu_endpoint(self) -> Optional[Endpoint]:
        candidates = [
            ep for ep in self._endpoints.values() if self.cfg.tiers[ep.tier].uses_gpu
        ]
        if not candidates:
            return None
        return min(candidates, key=lambda ep: ep.last_used)

    def stop(self, tier_name: str, reason: str = "") -> None:
        with self._lock:
            endpoint = self._endpoints.pop(tier_name, None)
            if endpoint is None:
                return
            stop_endpoint(endpoint)

    def reap_idle(self) -> None:
        """Stop servers idle beyond the configured threshold."""
        cutoff = self.cfg.idle_evict_s
        if cutoff <= 0:
            return
        now = time.time()
        with self._lock:
            stale = [
                name
                for name, ep in self._endpoints.items()
                if ep.process is not None and (now - ep.last_used) > cutoff
            ]
            for name in stale:
                self.stop(name, reason="idle")

    def shutdown(self) -> None:
        with self._lock:
            for name in list(self._endpoints):
                self.stop(name, reason="shutdown")

    # -- introspection -----------------------------------------------------

    def status(self) -> list[dict]:
        with self._lock:
            rows = []
            for name, ep in self._endpoints.items():
                tier = self.cfg.tiers[name]
                alive = ep.process is None or ep.process.poll() is None
                rows.append({
                    "tier": name,
                    "backend": ep.backend,
                    "device": tier.device,
                    "url": ep.base_url,
                    "alive": alive,
                    "vram_mb": self._required_vram_mb(tier),
                    "idle_s": int(time.time() - ep.last_used),
                })
            return rows

    def __enter__(self) -> "ModelSupervisor":
        return self

    def __exit__(self, *exc) -> None:
        self.shutdown()
