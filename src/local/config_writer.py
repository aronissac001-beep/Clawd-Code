"""Round-trip editing of clawd-local.yaml.

The config is documentation as much as settings -- it carries the measured
tuning curves, the reason speculation is off for MoE, why 16k context was not
enough. A plain ``yaml.safe_dump`` would silently delete all of it the first
time a user moved a slider, so edits go through ruamel's round-trip loader,
which preserves comments, key order and formatting.

Every setter validates before writing. A UI that can put the config into a
state the loader rejects is worse than no UI, because the app then fails to
start and the user has no way back.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Optional

from ruamel.yaml import YAML

CONFIG_NAME = "clawd-local.yaml"

_yaml = YAML()
_yaml.preserve_quotes = True
_yaml.width = 4096          # never re-wrap the long explanatory comments
_yaml.indent(mapping=2, sequence=4, offset=2)


class ConfigWriteError(RuntimeError):
    """Raised when a requested change would produce an invalid config."""


# Bounds are deliberately generous -- this guards against nonsense (negative
# VRAM, a 4-million-token context) rather than against unusual-but-valid setups.
LIMITS = {
    "vram_mb": (0, 80_000),
    "ram_mb": (512, 512_000),
    "threads": (1, 128),
    "threads_batch": (1, 256),
    "max_context": (512, 1_048_576),
    "context": (512, 1_048_576),
    "max_output_tokens": (64, 131_072),
    "n_cpu_moe": (0, 512),
    "n_gpu_layers": (0, 999),
    "spec_draft_n_max": (1, 32),
    "batch_size": (32, 32_768),
    "ubatch_size": (32, 32_768),
}

VALID_DEVICES = ("gpu", "cpu", "hybrid")
VALID_SPEC = ("none", "draft-mtp", "draft-simple", "ngram-simple", "ngram-cache",
              "draft-eagle3", "draft-dflash", "ngram-map-k", "ngram-mod")
VALID_CACHE = ("f16", "q8_0", "q4_0")


def _check(key: str, value: Any) -> Any:
    """Coerce and bounds-check one setting."""
    if key in LIMITS:
        try:
            value = int(value)
        except (TypeError, ValueError):
            raise ConfigWriteError(f"{key} must be a whole number, got {value!r}")
        lo, hi = LIMITS[key]
        if not (lo <= value <= hi):
            raise ConfigWriteError(f"{key} must be between {lo} and {hi}, got {value}")
        return value
    if key == "device":
        if value not in VALID_DEVICES:
            raise ConfigWriteError(f"device must be one of {VALID_DEVICES}")
    if key == "spec_type":
        if value not in VALID_SPEC:
            raise ConfigWriteError(f"spec_type must be one of {VALID_SPEC}")
    if key in ("cache_type_k", "cache_type_v"):
        if value not in VALID_CACHE:
            raise ConfigWriteError(f"{key} must be one of {VALID_CACHE}")
    if key in ("flash_attn", "serve", "allow_gpu", "allow_deep_tier", "enabled"):
        return bool(value)
    return value


class ConfigEditor:
    """Loads, edits and saves the stack config without losing comments."""

    def __init__(self, stack_dir: Path | str):
        self.path = Path(stack_dir) / CONFIG_NAME
        if not self.path.is_file():
            raise ConfigWriteError(f"no config at {self.path}")

    def load(self) -> Any:
        with self.path.open("r", encoding="utf-8") as fh:
            return _yaml.load(fh)

    def save(self, data: Any) -> None:
        """Write atomically, keeping one backup.

        A half-written config means the app will not start, and the user has no
        editor open to fix it -- so write to a temp file and swap.
        """
        backup = self.path.with_suffix(".yaml.bak")
        try:
            shutil.copy2(self.path, backup)
        except OSError:
            pass
        tmp = self.path.with_suffix(".yaml.tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            _yaml.dump(data, fh)
        tmp.replace(self.path)

    # -- typed setters -----------------------------------------------------

    def set_profile(self, name: str, values: dict) -> dict:
        data = self.load()
        profiles = data.get("profiles")
        if profiles is None or name not in profiles:
            raise ConfigWriteError(f"unknown profile {name!r}")
        allowed = ("vram_mb", "ram_mb", "threads", "threads_batch",
                   "max_context", "allow_gpu", "allow_deep_tier")
        applied = {}
        for k, v in values.items():
            if k not in allowed:
                continue
            profiles[name][k] = _check(k, v)
            applied[k] = profiles[name][k]
        self.save(data)
        return applied

    def set_tier(self, name: str, values: dict) -> dict:
        data = self.load()
        tiers = data.get("tiers")
        if tiers is None or name not in tiers:
            raise ConfigWriteError(f"unknown tier {name!r}")
        allowed = ("repo", "file", "device", "context", "max_output_tokens",
                   "spec_type", "spec_draft_n_max", "n_cpu_moe", "n_gpu_layers",
                   "cache_type_k", "cache_type_v", "flash_attn", "serve",
                   "batch_size", "ubatch_size", "approx_mb", "port")
        applied = {}
        for k, v in values.items():
            if k not in allowed:
                continue
            if k == "n_cpu_moe" and v in ("auto", None, ""):
                tiers[name][k] = "auto"
                applied[k] = "auto"
                continue
            tiers[name][k] = _check(k, v)
            applied[k] = tiers[name][k]

        # A hybrid tier without MoE offload is just a GPU tier that will not
        # fit; catching it here beats an out-of-memory crash on next load.
        t = tiers[name]
        if t.get("device") == "hybrid" and t.get("n_cpu_moe") in (None, ""):
            t["n_cpu_moe"] = "auto"

        self.save(data)
        return applied

    def set_roles(self, roles: dict) -> dict:
        data = self.load()
        tiers = set(data.get("tiers") or {})
        current = data.get("roles")
        if current is None:
            raise ConfigWriteError("config has no roles section")
        for role, tier in roles.items():
            if tier not in tiers:
                raise ConfigWriteError(f"role {role!r} points at unknown tier {tier!r}")
            current[role] = tier
        self.save(data)
        return dict(current)

    def set_escalation(self, values: dict) -> dict:
        data = self.load()
        esc = data.get("escalation")
        if esc is None:
            raise ConfigWriteError("config has no escalation section")
        allowed = ("enabled", "on_repeated_tool_failure", "on_repeated_identical_call",
                   "on_empty_tool_args", "auto_demote_after_success", "ceiling")
        applied = {}
        for k, v in values.items():
            if k not in allowed:
                continue
            if k in ("enabled", "auto_demote_after_success"):
                esc[k] = bool(v)
            elif k == "ceiling":
                if v not in (data.get("tiers") or {}):
                    raise ConfigWriteError(f"ceiling must be a tier name, got {v!r}")
                esc[k] = v
            else:
                n = int(v)
                if not (1 <= n <= 20):
                    raise ConfigWriteError(f"{k} must be between 1 and 20")
                esc[k] = n
            applied[k] = esc[k]
        self.save(data)
        return applied

    def set_cloud(self, values: dict) -> dict:
        data = self.load()
        cloud = data.get("cloud")
        if cloud is None:
            raise ConfigWriteError("config has no cloud section")
        allowed = ("policy", "provider", "model", "cost_mode",
                   "auto_max_calls_per_session", "max_paid_calls_per_session")
        applied = {}
        for k, v in values.items():
            if k not in allowed:
                continue
            if k == "policy" and v not in ("off", "manual", "auto"):
                raise ConfigWriteError("policy must be off|manual|auto")
            if k == "cost_mode" and v not in ("free_only", "mixed"):
                raise ConfigWriteError("cost_mode must be free_only|mixed")
            if k.endswith("_per_session"):
                v = max(0, int(v))
            cloud[k] = v
            applied[k] = v
        self.save(data)
        return applied

    def set_active_profile(self, name: str) -> str:
        data = self.load()
        if name not in (data.get("profiles") or {}):
            raise ConfigWriteError(f"unknown profile {name!r}")
        data["active_profile"] = name
        self.save(data)
        return name
