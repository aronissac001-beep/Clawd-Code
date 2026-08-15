"""Configuration loading for the local model stack.

Reads ``clawd-local.yaml`` and resolves it against the active resource profile,
producing concrete per-tier settings that the backends can turn into command
lines. The profile is the single knob: changing it re-derives every tier.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import yaml

CONFIG_NAME = "clawd-local.yaml"


def _default_stack_dir() -> Path:
    """Locate local-stack/, whether it sits inside the repo or beside it.

    Inside the repo is preferred so the tuned config is version-controlled
    alongside the code it configures, but an existing checkout may still have
    it one level up. Override either with the CLAWD_LOCAL_DIR env var.
    """
    here = Path(__file__).resolve()
    candidates = (
        here.parents[2] / "local-stack",   # Clawd-Code/local-stack  (preferred)
        here.parents[3] / "local-stack",   # beside the repo (legacy layout)
    )
    for candidate in candidates:
        if (candidate / CONFIG_NAME).is_file():
            return candidate
    return candidates[0]


DEFAULT_STACK_DIR = _default_stack_dir()


class ConfigError(RuntimeError):
    """Raised when the local stack config is missing or internally inconsistent."""


@dataclass
class Profile:
    """A resource budget. Everything else is derived from this."""

    name: str
    vram_mb: int
    ram_mb: int
    threads: int
    threads_batch: int
    max_context: int
    allow_gpu: bool = True
    allow_deep_tier: bool = True
    # Roles this profile reassigns. A profile whose VRAM budget cannot hold the
    # default tier for a role MUST remap it here, or that role fails at runtime.
    role_overrides: dict[str, str] = field(default_factory=dict)


@dataclass
class Tier:
    """One rung of the model ladder, already clamped to the active profile."""

    name: str
    repo: str
    file: str
    approx_mb: int
    serve: bool = True
    port: Optional[int] = None
    device: str = "gpu"  # gpu | cpu | hybrid
    n_gpu_layers: int = 999
    n_cpu_moe: Optional[int | str] = None
    spec_type: str = "none"
    spec_draft_n_max: int = 6
    cache_type_k: Optional[str] = None
    cache_type_v: Optional[str] = None
    flash_attn: bool = False
    context: int = 8192
    # Hard ceiling on a single response. Without one, a model that starts
    # rambling generates until the context window is exhausted, at which point
    # llama.cpp truncates mid-stream and the caller gets an EMPTY response
    # after minutes of work. Observed on a 900-line file review: 13,862 tokens
    # generated, context died at 32,767, nothing returned.
    max_output_tokens: int = 4096
    batch_size: Optional[int] = None
    ubatch_size: Optional[int] = None
    backend: str = "llamacpp"
    ollama_tag: Optional[str] = None
    # Actual VRAM observed while loaded, written by `clawd-local tune`.
    # A measurement always beats the heuristic below.
    measured_vram_mb: Optional[int] = None
    # Multimodal projector, for vision tiers. llama.cpp keeps the vision tower
    # in a separate file from the language weights, and a vision model started
    # without it loads happily and then simply cannot see -- images are dropped
    # with no error. Both files are required for the tier to be usable.
    mmproj: Optional[str] = None

    @property
    def uses_gpu(self) -> bool:
        return self.device in ("gpu", "hybrid")

    @property
    def vram_estimate_mb(self) -> int:
        """VRAM footprint used by the supervisor's eviction budget.

        Prefers a measured value from ``clawd-local tune``. The fallback
        heuristic for ``hybrid`` tiers is deliberately pessimistic: MoE VRAM
        use depends on how many expert layers stay on the GPU, and a flat
        percentage badly underestimates a lightly-offloaded configuration.
        Measured on this hardware, deep at n_cpu_moe=32 used ~6.8 GB against a
        flat-20% estimate of 4.2 GB — an error large enough to admit a tier
        that then thrashes.
        """
        if self.device == "cpu":
            return 0
        if self.measured_vram_mb:
            return self.measured_vram_mb
        if self.device == "hybrid":
            # Assume roughly a third of weights stay resident unless measured.
            return int(self.approx_mb * 0.33)
        return self.approx_mb


@dataclass
class CloudPolicy:
    """Governs whether and how requests may leave the machine."""

    policy: str = "manual"  # off | manual | auto
    provider: str = "anthropic"
    model: str = "claude-sonnet-4-6"
    auto_max_calls_per_session: int = 5
    auto_requires_deep_failure: bool = True
    auto_confirm_first_time: bool = True
    # OpenRouter only. free_only verifies every model against the live
    # catalogue and refuses anything that is not zero-cost across all pricing
    # fields; mixed permits paid models under a session cap.
    cost_mode: str = "free_only"  # free_only | mixed
    max_paid_calls_per_session: int = 20

    def __post_init__(self) -> None:
        if self.policy not in ("off", "manual", "auto"):
            raise ConfigError(
                f"cloud.policy must be one of off|manual|auto, got {self.policy!r}"
            )
        if self.cost_mode not in ("free_only", "mixed"):
            raise ConfigError(
                f"cloud.cost_mode must be free_only|mixed, got {self.cost_mode!r}"
            )

    @property
    def is_free_only(self) -> bool:
        """True when the configuration cannot spend money."""
        return self.provider == "openrouter" and self.cost_mode == "free_only"


@dataclass
class EscalationPolicy:
    enabled: bool = True
    on_repeated_tool_failure: int = 2
    on_repeated_identical_call: int = 2
    on_empty_tool_args: int = 2
    auto_demote_after_success: bool = True
    ceiling: str = "deep"


@dataclass
class Thinking:
    """Which roles should skip the model's reasoning phase.

    MEASURED on workhorse (Qwen3.5-9B), identical prompt asking for one
    sentence:

        thinking on   300 completion tokens, content EMPTY, reasoning 1119
                      chars, finish_reason "length"
        thinking off   33 completion tokens, a correct 151-character answer,
                      finish_reason "stop"

    With thinking on the answer never arrives at all: llama.cpp streams the
    reasoning into a separate ``reasoning_content`` field and only starts
    filling ``content`` once thinking ends, so any cap short of the full
    reasoning trace returns an empty string rather than a truncated one. That
    reads as a broken model rather than a budget that is too small, and raising
    the budget to 1500 did not help -- it simply thought for longer.

    So this is off for the short roles by default. `main` keeps thinking, where
    it is worth the tokens.
    """

    off_for_roles: tuple[str, ...] = (
        "summarize", "title", "classify", "compaction", "plan",
    )


@dataclass
class FastRoles:
    """Send short, cheap roles to a fast free provider instead of a local tier.

    Off by default, and inert unless the user has also enabled a provider --
    two switches, because this is the setting that decides whether anything
    leaves the machine on an ordinary turn.

    ``main`` is deliberately absent from the default list: it is the role that
    sees whole source files.
    """

    enabled: bool = False
    roles: tuple[str, ...] = ("summarize", "title", "classify", "compaction")
    # These roles are short by nature, so a provider with a small context
    # ceiling still qualifies -- which is what lets the fastest one be used.
    min_context: int = 8192


@dataclass
class StackConfig:
    """Fully resolved local stack configuration."""

    stack_dir: Path
    profile: Profile
    profiles: dict[str, Profile]
    tiers: dict[str, Tier]
    roles: dict[str, str]
    escalation: EscalationPolicy
    cloud: CloudPolicy
    fast_roles: "FastRoles" = field(default_factory=lambda: FastRoles())
    thinking: "Thinking" = field(default_factory=lambda: Thinking())
    backends: dict[str, Any] = field(default_factory=dict)

    # -- paths -------------------------------------------------------------

    @property
    def models_dir(self) -> Path:
        rel = self.backends.get("llamacpp", {}).get("models_dir", "models")
        return self.stack_dir / rel

    @property
    def server_bin(self) -> Path:
        rel = self.backends.get("llamacpp", {}).get("server_bin", "bin/llama-server.exe")
        return self.stack_dir / rel

    @property
    def host(self) -> str:
        return self.backends.get("llamacpp", {}).get("host", "127.0.0.1")

    @property
    def startup_timeout_s(self) -> int:
        return int(self.backends.get("llamacpp", {}).get("startup_timeout_s", 180))

    @property
    def idle_evict_s(self) -> int:
        return int(self.backends.get("llamacpp", {}).get("idle_evict_s", 900))

    def model_path(self, tier: Tier) -> Path:
        return self.models_dir / tier.file

    def mmproj_path(self, tier: Tier) -> Optional[Path]:
        """Where a vision tier's projector lives, or None for text tiers."""
        return self.models_dir / tier.mmproj if tier.mmproj else None

    # -- lookups -----------------------------------------------------------

    def fits_budget(self, tier: Tier) -> bool:
        """Whether a tier plausibly fits the active profile's VRAM budget.

        Weights only, with headroom left for the KV cache. The supervisor does
        the precise accounting; this is the cheap check used for routing so a
        role never resolves to a tier that cannot start.
        """
        if not tier.uses_gpu:
            return True
        if tier.measured_vram_mb:
            # Measured totals already include the KV cache, so compare directly
            # rather than reserving headroom for it a second time.
            return tier.measured_vram_mb <= self.profile.vram_mb
        return tier.vram_estimate_mb <= self.profile.vram_mb * 0.85

    def tier_for_role(self, role: str) -> Tier:
        """Resolve a role to a tier that can actually run under this profile.

        Falls back down the ladder rather than raising: a battery profile too
        small for the workhorse should quietly serve the 4B, not fail on the
        user's first message.
        """
        tier_name = self.roles.get(role) or self.roles.get("main") or "workhorse"
        tier = self.tiers.get(tier_name)
        if tier is None:
            raise ConfigError(f"role {role!r} maps to unknown tier {tier_name!r}")

        blocked_deep = tier.name == "deep" and not self.profile.allow_deep_tier
        if not blocked_deep and self.fits_budget(tier):
            return tier

        # Walk down to the strongest tier that is both permitted and affordable.
        for candidate_name in ("deep", "workhorse", "reflex"):
            candidate = self.tiers.get(candidate_name)
            if candidate is None or not candidate.serve:
                continue
            if candidate_name == "deep" and not self.profile.allow_deep_tier:
                continue
            if candidate.vram_estimate_mb > tier.vram_estimate_mb:
                continue  # never escalate as a "fallback"
            if self.fits_budget(candidate):
                return candidate

        raise ConfigError(
            f"no tier fits the '{self.profile.name}' profile budget of "
            f"{self.profile.vram_mb} MB for role {role!r}. "
            f"Raise vram_mb, or set a tier's device to cpu."
        )

    def servable_tiers(self) -> list[Tier]:
        return [t for t in self.tiers.values() if t.serve]


def _resolve_tier(
    name: str,
    raw: dict[str, Any],
    profile: Profile,
    ollama_overrides: dict[str, str],
) -> Tier:
    """Build a Tier, clamping requested settings to the profile budget."""
    device = raw.get("device", "gpu")
    if not profile.allow_gpu and device in ("gpu", "hybrid"):
        # cpu_only profile: force everything onto the CPU.
        device = "cpu"

    context = min(int(raw.get("context", 8192)), profile.max_context)

    # n_cpu_moe "auto" is left symbolic here; the tuner resolves it to an int
    # and writes the measured value back into the YAML.
    n_cpu_moe = raw.get("n_cpu_moe")
    if isinstance(n_cpu_moe, str) and n_cpu_moe != "auto":
        try:
            n_cpu_moe = int(n_cpu_moe)
        except ValueError as exc:
            raise ConfigError(
                f"tier {name!r}: n_cpu_moe must be an integer or 'auto'"
            ) from exc

    backend = "ollama" if name in ollama_overrides else "llamacpp"

    return Tier(
        name=name,
        repo=raw["repo"],
        file=raw["file"],
        approx_mb=int(raw.get("approx_mb", 0)),
        serve=bool(raw.get("serve", True)),
        port=raw.get("port"),
        device=device,
        n_gpu_layers=0 if device == "cpu" else int(raw.get("n_gpu_layers", 999)),
        n_cpu_moe=n_cpu_moe,
        spec_type=raw.get("spec_type", "none"),
        spec_draft_n_max=int(raw.get("spec_draft_n_max", 6)),
        cache_type_k=raw.get("cache_type_k"),
        cache_type_v=raw.get("cache_type_v"),
        flash_attn=bool(raw.get("flash_attn", False)),
        context=context,
        max_output_tokens=int(raw.get("max_output_tokens", 4096)),
        batch_size=raw.get("batch_size"),
        ubatch_size=raw.get("ubatch_size"),
        backend=backend,
        ollama_tag=ollama_overrides.get(name),
        measured_vram_mb=raw.get("measured_vram_mb"),
        mmproj=raw.get("mmproj"),
    )


def load_config(
    stack_dir: Optional[Path | str] = None,
    profile_override: Optional[str] = None,
) -> StackConfig:
    """Load and resolve the local stack config.

    Args:
        stack_dir: Directory holding ``clawd-local.yaml``. Defaults to
            ``local-stack/`` beside the Clawd-Code checkout, overridable with
            the ``CLAWD_LOCAL_DIR`` environment variable.
        profile_override: Use this profile instead of ``active_profile``.
    """
    if stack_dir is None:
        # Resolved per call, not once at import, so the lookup stays correct
        # if the directory is relocated between the two layouts.
        stack_dir = os.environ.get("CLAWD_LOCAL_DIR") or _default_stack_dir()
    stack_dir = Path(stack_dir).resolve()

    cfg_path = stack_dir / CONFIG_NAME
    if not cfg_path.is_file():
        raise ConfigError(
            f"No {CONFIG_NAME} at {cfg_path}. Run `clawd-local init` to create one."
        )

    with cfg_path.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh) or {}

    raw_profiles = raw.get("profiles") or {}
    if not raw_profiles:
        raise ConfigError("config defines no profiles")

    profiles = {
        name: Profile(
            name=name,
            vram_mb=int(p.get("vram_mb", 0)),
            ram_mb=int(p.get("ram_mb", 8000)),
            threads=int(p.get("threads", 6)),
            threads_batch=int(p.get("threads_batch", p.get("threads", 6))),
            max_context=int(p.get("max_context", 8192)),
            allow_gpu=bool(p.get("allow_gpu", True)),
            allow_deep_tier=bool(p.get("allow_deep_tier", True)),
            role_overrides=dict(p.get("role_overrides") or {}),
        )
        for name, p in raw_profiles.items()
    }

    active_name = profile_override or raw.get("active_profile") or "balanced"
    if active_name not in profiles:
        raise ConfigError(
            f"active_profile {active_name!r} is not defined. "
            f"Known profiles: {', '.join(sorted(profiles))}"
        )
    profile = profiles[active_name]

    backends = raw.get("backends") or {}
    ollama_overrides = (backends.get("ollama") or {}).get("tier_overrides") or {}

    raw_tiers = raw.get("tiers") or {}
    if not raw_tiers:
        raise ConfigError("config defines no tiers")
    tiers = {
        name: _resolve_tier(name, spec, profile, ollama_overrides)
        for name, spec in raw_tiers.items()
    }

    # A tier configured for speculation needs its draft companion present.
    for tier in tiers.values():
        if tier.spec_type not in ("none", "", None) and tier.spec_type.startswith("draft-"):
            if tier.spec_type == "draft-mtp":
                continue  # MTP drafts from the model's own layers
            if "draft" not in tiers:
                raise ConfigError(
                    f"tier {tier.name!r} requests spec_type={tier.spec_type!r} "
                    "but no 'draft' tier is defined"
                )

    # Profile role overrides win: a budget that cannot hold the default tier
    # must be able to redirect the role rather than fail when it is first used.
    roles = dict(raw.get("roles") or {"main": "workhorse"})
    roles.update(profile.role_overrides)

    return StackConfig(
        stack_dir=stack_dir,
        profile=profile,
        profiles=profiles,
        tiers=tiers,
        roles=roles,
        escalation=EscalationPolicy(**(raw.get("escalation") or {})),
        cloud=CloudPolicy(**(raw.get("cloud") or {})),
        fast_roles=_fast_roles_from(raw.get("fast_roles")),
        thinking=_thinking_from(raw.get("thinking")),
        backends=backends,
    )


def _thinking_from(raw: Optional[dict]) -> "Thinking":
    raw = raw or {}
    roles = raw.get("off_for_roles")
    return Thinking(tuple(roles) if roles is not None else Thinking.off_for_roles)


def _fast_roles_from(raw: Optional[dict]) -> "FastRoles":
    raw = raw or {}
    roles = raw.get("roles")
    return FastRoles(
        enabled=bool(raw.get("enabled", False)),
        roles=tuple(roles) if roles else FastRoles.roles,
        min_context=int(raw.get("min_context", 8192)),
    )


def set_active_profile(stack_dir: Path | str, profile_name: str) -> None:
    """Rewrite ``active_profile`` in place, preserving comments.

    yaml.safe_dump would strip every comment in the file, which is most of its
    value, so this does a targeted line edit instead.
    """
    cfg_path = Path(stack_dir) / CONFIG_NAME
    lines = cfg_path.read_text(encoding="utf-8").splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.startswith("active_profile:"):
            lines[i] = f"active_profile: {profile_name}\n"
            break
    else:
        raise ConfigError("no active_profile key found in config")
    cfg_path.write_text("".join(lines), encoding="utf-8")


def set_tier_value(stack_dir: Path | str, tier: str, key: str, value: Any) -> None:
    """Write a tuned value (e.g. n_cpu_moe) back into a tier block, in place."""
    cfg_path = Path(stack_dir) / CONFIG_NAME
    lines = cfg_path.read_text(encoding="utf-8").splitlines(keepends=True)

    in_tiers = False
    in_target = False
    tier_indent = 0

    for i, line in enumerate(lines):
        stripped = line.strip()
        if not in_tiers:
            if stripped.startswith("tiers:"):
                in_tiers = True
            continue

        # A non-indented, non-comment line ends the tiers block.
        if line and not line[0].isspace() and not stripped.startswith("#"):
            break

        if stripped.startswith(f"{tier}:"):
            in_target = True
            tier_indent = len(line) - len(line.lstrip())
            continue

        if in_target:
            indent = len(line) - len(line.lstrip())
            if stripped and not stripped.startswith("#") and indent <= tier_indent:
                break  # next tier started; key was absent
            if stripped.startswith(f"{key}:"):
                pad = " " * indent
                # Preserve any trailing comment; it usually explains the field.
                comment = ""
                if "#" in line:
                    comment = "  # " + line.split("#", 1)[1].strip()
                lines[i] = f"{pad}{key}: {value}{comment}\n"
                cfg_path.write_text("".join(lines), encoding="utf-8")
                return

    raise ConfigError(f"could not find {tier}.{key} in config")
