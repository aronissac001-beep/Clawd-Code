"""Free, OpenAI-compatible model providers, as a pool with failover.

Why a pool rather than one provider: during testing, every free model on
OpenRouter's shared pool returned 429 in sequence -- six models tried, one
answered. A single cloud lane is a single point of failure, and the free tiers
are exactly where that failure is routine rather than rare.

All four providers here speak the OpenAI chat-completions API, so they need no
new client code. What differs is the URL, the key, and the limits.

**Everything here is off by default.** This project's premise is that your code
stays on your machine; each provider added is another third party receiving it.
Enabling one is a decision the user makes per provider, with the limits and the
privacy note in front of them, not a switch that turns on a category.

Rate limits are recorded as documented at the time of writing and are used only
for display and for ordering -- the code never assumes them. A provider that
starts refusing is cooled down on the evidence of its own 429, not on a
prediction from a table that may be a year stale.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Optional

# How long a provider sits out after rate-limiting us. Long enough that we are
# not hammering a limit we have already hit, short enough that a per-minute
# limit has cleared by the time we try again.
COOLDOWN_S = 90


@dataclass(frozen=True)
class FreeProvider:
    id: str
    label: str
    base_url: str
    env_vars: tuple[str, ...]
    # Free models, fastest/cheapest first.
    models: tuple[str, ...]
    max_context: int
    limits: str
    speed: str
    privacy: str
    signup: str

    def key(self) -> Optional[str]:
        """The API key, from the environment or the clawd config."""
        for var in self.env_vars:
            value = os.environ.get(var, "").strip()
            if value:
                return value
        try:
            from ..config import load_config

            entry = (load_config().get("providers") or {}).get(self.id) or {}
            return (entry.get("api_key") or "").strip() or None
        except Exception:
            return None

    def enabled(self) -> bool:
        """Opt-in, and off until explicitly turned on.

        A key being present is not consent. Someone may have GROQ_API_KEY set
        for an unrelated tool; that is not permission to send this project's
        source code through it.
        """
        try:
            from ..config import load_config

            entry = (load_config().get("providers") or {}).get(self.id) or {}
            return bool(entry.get("enabled")) and bool(self.key())
        except Exception:
            return False

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "models": list(self.models),
            "max_context": self.max_context,
            "limits": self.limits,
            "speed": self.speed,
            "privacy": self.privacy,
            "signup": self.signup,
            "has_key": bool(self.key()),
            "enabled": self.enabled(),
        }


# Limits are as documented at the time of writing. Verified for Groq and
# Cerebras; the other two are taken from their own docs and should be treated
# as approximate.
PROVIDERS: tuple[FreeProvider, ...] = (
    FreeProvider(
        id="groq",
        label="Groq",
        base_url="https://api.groq.com/openai/v1",
        env_vars=("GROQ_API_KEY",),
        models=("llama-3.1-8b-instant", "llama-3.3-70b-versatile",
                "openai/gpt-oss-120b"),
        max_context=131072,
        limits="30 req/min · 500k tokens/day on the 8B, 100k on the 70B",
        speed="very fast — hundreds of tokens/sec",
        privacy="Prompts leave your machine and reach Groq.",
        signup="console.groq.com/keys",
    ),
    FreeProvider(
        id="cerebras",
        label="Cerebras",
        base_url="https://api.cerebras.ai/v1",
        env_vars=("CEREBRAS_API_KEY",),
        models=("llama-4-scout-17b-16e-instruct", "qwen-3-32b"),
        # The free tier caps context at 8k across all models, which rules it
        # out for the main agent loop and makes it a good fit for the short
        # roles: summarising, naming, classifying.
        max_context=8192,
        limits="1M tokens/day · 30 req/min · 8k context ceiling",
        speed="fastest available — thousands of tokens/sec",
        privacy="Prompts leave your machine and reach Cerebras.",
        signup="cloud.cerebras.ai",
    ),
    FreeProvider(
        id="google",
        label="Google AI Studio",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        env_vars=("GEMINI_API_KEY", "GOOGLE_API_KEY"),
        models=("gemini-2.5-flash", "gemini-2.0-flash"),
        max_context=1048576,
        limits="generous free tier for prototyping; per-minute caps apply",
        speed="fast",
        privacy="Prompts leave your machine and reach Google. Free-tier "
                "input may be used to improve their models — check their terms.",
        signup="aistudio.google.com/apikey",
    ),
    FreeProvider(
        id="mistral",
        label="Mistral",
        base_url="https://api.mistral.ai/v1",
        env_vars=("MISTRAL_API_KEY",),
        models=("mistral-small-latest", "codestral-latest"),
        max_context=131072,
        limits="1 req/sec · 500k tokens/min",
        speed="fast",
        privacy="Prompts leave your machine and reach Mistral.",
        signup="console.mistral.ai/api-keys",
    ),
)


def by_id(provider_id: str) -> Optional[FreeProvider]:
    return next((p for p in PROVIDERS if p.id == provider_id), None)


def enabled_providers() -> list[FreeProvider]:
    return [p for p in PROVIDERS if p.enabled()]


@dataclass
class FreeLane:
    """Picks among the enabled providers and remembers which are sulking."""

    _cooldown: dict[str, float] = field(default_factory=dict)

    def available(self, min_context: int = 0) -> list[FreeProvider]:
        """Enabled providers that are not cooling down and fit the context.

        The context filter is what keeps Cerebras out of the main agent loop:
        it is the fastest option available and cannot hold the conversation.
        """
        now = time.time()
        return [
            p for p in enabled_providers()
            if self._cooldown.get(p.id, 0) <= now and p.max_context >= min_context
        ]

    def pick(self, min_context: int = 0) -> Optional[FreeProvider]:
        candidates = self.available(min_context)
        return candidates[0] if candidates else None

    def penalise(self, provider_id: str, seconds: int = COOLDOWN_S) -> None:
        """Sit a provider out after it refuses us."""
        self._cooldown[provider_id] = time.time() + seconds

    def note_failure(self, provider_id: str, error: BaseException) -> bool:
        """Cool a provider down if the error looks like a limit rather than a bug.

        Returns whether it was penalised. A malformed request is our fault and
        will fail identically on the next provider, so failing over would just
        spread the same mistake around.
        """
        text = str(error).lower()
        transient = any(sign in text for sign in (
            "429", "rate limit", "rate-limit", "too many requests",
            "quota", "capacity", "overloaded", "503", "502", "timeout",
        ))
        if transient:
            self.penalise(provider_id)
        return transient

    def status(self) -> list[dict]:
        now = time.time()
        out = []
        for provider in PROVIDERS:
            cooling = max(0, int(self._cooldown.get(provider.id, 0) - now))
            out.append({**provider.as_dict(), "cooling_down_s": cooling})
        return out
