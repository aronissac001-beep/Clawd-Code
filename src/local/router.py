"""Role routing, failure escalation, and cloud policy.

Two independent decisions live here:

1. **Which tier** serves a given role. Most agent tokens are not hard
   reasoning — they are summarising a file, compacting history, naming a
   commit — and sending those to a 4B instead of the main model is nearly
   free. That is the single biggest win in this stack.

2. **When to escalate**. Small models fail in a characteristic way: rather
   than self-correcting after a bad tool call, they repeat it verbatim until
   the context fills. Detecting that loop and promoting to a stronger tier is
   more valuable than any amount of prompt tuning.

Cloud escalation sits above both, gated by an explicit policy so that code
never leaves the machine by accident.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .config import StackConfig, Tier

# Tier strength, weakest first. Escalation walks rightwards.
TIER_ORDER = ["reflex", "workhorse", "deep"]


class CloudBlocked(RuntimeError):
    """Raised when a cloud request is attempted but policy forbids it."""


@dataclass
class Decision:
    """Where a single request should be sent."""

    target: str          # tier name, or "cloud"
    reason: str          # human-readable, surfaced in the REPL
    escalated: bool = False
    is_cloud: bool = False


@dataclass
class _FailureState:
    """Rolling evidence that the current tier is floundering."""

    consecutive_tool_failures: int = 0
    consecutive_empty_args: int = 0
    recent_call_hashes: list[str] = field(default_factory=list)

    def reset(self) -> None:
        self.consecutive_tool_failures = 0
        self.consecutive_empty_args = 0
        self.recent_call_hashes.clear()

    def repeated_identical(self, window: int) -> int:
        """Length of the current run of identical tool calls."""
        if not self.recent_call_hashes:
            return 0
        last = self.recent_call_hashes[-1]
        run = 0
        for h in reversed(self.recent_call_hashes):
            if h != last:
                break
            run += 1
        return run


class Router:
    """Chooses a tier per request and escalates when the current tier fails."""

    def __init__(
        self,
        cfg: StackConfig,
        confirm_cloud: Optional[Callable[[str], bool]] = None,
    ):
        self.cfg = cfg
        self._failures = _FailureState()
        self._forced_tier: Optional[str] = None
        self._forced_cloud = False         # set by the model picker, sticky
        self._cloud_armed = False          # set by `/cloud` for one request
        self._cloud_calls_used = 0
        self._cloud_confirmed = False
        self._confirm_cloud = confirm_cloud
        self._escalated_from: Optional[str] = None

    # -- policy state ------------------------------------------------------

    @property
    def cloud_policy(self) -> str:
        return self.cfg.cloud.policy

    def set_cloud_policy(self, policy: str) -> None:
        if policy not in ("off", "manual", "auto"):
            raise ValueError(f"cloud policy must be off|manual|auto, got {policy!r}")
        self.cfg.cloud.policy = policy
        if policy == "off":
            self._cloud_armed = False

    def arm_cloud(self) -> None:
        """Send the next request to the cloud provider (policy=manual)."""
        if self.cloud_policy == "off":
            raise CloudBlocked(
                "cloud policy is 'off'. Enable it with `/cloud manual` first."
            )
        self._cloud_armed = True

    def force_tier(self, tier_name: Optional[str]) -> None:
        """Pin routing to one tier until cleared. Backs the `/model` command."""
        if tier_name is not None and tier_name not in self.cfg.tiers:
            raise ValueError(f"unknown tier {tier_name!r}")
        self._forced_tier = tier_name
        if tier_name is not None:
            self._forced_cloud = False

    def force_cloud(self, on: bool) -> None:
        """Pin every request to the cloud provider until cleared.

        Deliberately distinct from ``arm_cloud``, which fires once and clears
        itself. That is right for `/cloud`, an escape hatch for a single
        request, but wrong for a model *selection*: the agent loop makes
        several provider calls to answer one user message, so a one-shot arm
        sends turn 1 to the chosen model and silently drops turns 2..n back
        onto the local ladder -- which then fails to start for want of VRAM.
        """
        self._forced_cloud = on
        if on:
            self._forced_tier = None

    # -- routing -----------------------------------------------------------

    def route(self, role: str = "main") -> Decision:
        """Pick a destination for the next request."""
        # 1. An armed manual cloud request wins outright.
        if self._cloud_armed:
            self._cloud_armed = False
            self._authorize_cloud(manual=True)
            return Decision("cloud", "manual /cloud escalation", is_cloud=True)

        # 2. A cloud model chosen in the picker, for every turn of this request.
        if self._forced_cloud:
            self._authorize_cloud(manual=True)
            return Decision(
                "cloud", f"pinned to {self.cfg.cloud.model}", is_cloud=True
            )

        # 3. An explicit /model pin.
        if self._forced_tier:
            return Decision(self._forced_tier, f"pinned to {self._forced_tier}")

        base = self.cfg.tier_for_role(role)

        # 4. Escalation, only for the main agent loop. A failing summarisation
        #    is not worth promoting to a 35B model.
        if role == "main" and self.cfg.escalation.enabled:
            escalated = self._escalation_target(base)
            if escalated is not None:
                return escalated

        return Decision(base.name, f"role '{role}' -> {base.name}")

    def _escalation_target(self, base: Tier) -> Optional[Decision]:
        esc = self.cfg.escalation
        reasons: list[str] = []

        if self._failures.consecutive_tool_failures >= esc.on_repeated_tool_failure:
            reasons.append(
                f"{self._failures.consecutive_tool_failures} consecutive tool failures"
            )
        run = self._failures.repeated_identical(esc.on_repeated_identical_call)
        if run >= esc.on_repeated_identical_call:
            reasons.append(f"same tool call repeated {run}x")
        if self._failures.consecutive_empty_args >= esc.on_empty_tool_args:
            reasons.append(
                f"{self._failures.consecutive_empty_args} malformed tool-call payloads"
            )

        if not reasons:
            return None

        reason = "; ".join(reasons)
        stronger = self._next_tier(base.name, ceiling=esc.ceiling)

        if stronger is not None:
            self._escalated_from = base.name
            return Decision(stronger, f"escalated: {reason}", escalated=True)

        # Already at the local ceiling. Cloud is the only step left.
        if self.cloud_policy == "auto":
            if esc.auto_requires_deep_failure and base.name != esc.ceiling:
                return None
            try:
                self._authorize_cloud(manual=False)
            except CloudBlocked:
                return None
            return Decision(
                "cloud", f"auto-escalated to cloud: {reason}", escalated=True, is_cloud=True
            )
        return None

    def _next_tier(self, current: str, ceiling: str) -> Optional[str]:
        """Next stronger tier that exists, is allowed, and is below the ceiling."""
        try:
            idx = TIER_ORDER.index(current)
            ceil_idx = TIER_ORDER.index(ceiling)
        except ValueError:
            return None
        for name in TIER_ORDER[idx + 1 : ceil_idx + 1]:
            tier = self.cfg.tiers.get(name)
            if tier is None or not tier.serve:
                continue
            if name == "deep" and not self.cfg.profile.allow_deep_tier:
                continue
            return name
        return None

    # -- cloud gating ------------------------------------------------------

    def _authorize_cloud(self, manual: bool) -> None:
        policy = self.cloud_policy
        if policy == "off":
            raise CloudBlocked("cloud policy is 'off'; request stays local")
        if not manual:
            if policy != "auto":
                raise CloudBlocked("automatic cloud escalation requires policy 'auto'")
            if self._cloud_calls_used >= self.cfg.cloud.auto_max_calls_per_session:
                raise CloudBlocked(
                    f"session cap of {self.cfg.cloud.auto_max_calls_per_session} "
                    "automatic cloud calls reached"
                )
            if self.cfg.cloud.auto_confirm_first_time and not self._cloud_confirmed:
                approved = (
                    self._confirm_cloud(
                        "Local tiers are stuck. Send this request to "
                        f"{self.cfg.cloud.provider}/{self.cfg.cloud.model}? "
                        "Your code and context leave the machine."
                    )
                    if self._confirm_cloud is not None
                    else False
                )
                if not approved:
                    raise CloudBlocked("user declined cloud escalation")
                self._cloud_confirmed = True
        self._cloud_calls_used += 1

    # -- feedback from the agent loop --------------------------------------

    def record_tool_call(self, name: str, args: Any) -> None:
        """Note an outgoing tool call so degenerate loops become visible."""
        try:
            payload = json.dumps(args, sort_keys=True, default=str)
        except (TypeError, ValueError):
            payload = str(args)
        digest = hashlib.sha1(f"{name}:{payload}".encode()).hexdigest()[:16]
        self._failures.recent_call_hashes.append(digest)
        del self._failures.recent_call_hashes[:-8]  # keep a short window

        if not args or (isinstance(args, dict) and not any(args.values())):
            self._failures.consecutive_empty_args += 1
        else:
            self._failures.consecutive_empty_args = 0

    def record_tool_result(self, ok: bool) -> None:
        if ok:
            self._failures.consecutive_tool_failures = 0
        else:
            self._failures.consecutive_tool_failures += 1

    def record_turn_success(self) -> None:
        """A turn completed cleanly; clear escalation state."""
        self._failures.reset()
        if self.cfg.escalation.auto_demote_after_success:
            self._escalated_from = None

    def status(self) -> dict:
        return {
            "cloud_policy": self.cloud_policy,
            "cloud_calls_used": self._cloud_calls_used,
            "pinned_tier": self._forced_tier,
            "pinned_cloud": self._forced_cloud,
            "consecutive_tool_failures": self._failures.consecutive_tool_failures,
            "repeated_identical_calls": self._failures.repeated_identical(2),
            "escalated_from": self._escalated_from,
        }
