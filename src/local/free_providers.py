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

# A refusal that names the account rather than the load -- 402, 401, a model
# closed to new users -- will still be true in ninety seconds. Bench it for the
# session instead of paying a failed round-trip on every cheap role.
ACCOUNT_COOLDOWN_S = 3600


@dataclass(frozen=True)
class FreeProvider:
    id: str
    label: str
    base_url: str
    env_vars: tuple[str, ...]
    # Fallback ids, used only when the live roster cannot be fetched. The first
    # version of this file hardcoded ids and three of four providers rejected
    # them within a week -- Google had retired the names for new accounts and
    # Cerebras had never served them. openrouter.py already carries the same
    # warning in its docstring; this is the same mistake repeated.
    models: tuple[str, ...]
    # Substrings ranked best-first, matched against whatever the provider
    # actually lists. Naming a family survives a version bump; naming a version
    # does not.
    prefer: tuple[str, ...]
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
        # Small-and-fast first: this lane exists for short roles, so an 8B that
        # answers instantly beats a 70B that eats the daily token budget.
        prefer=("8b-instant", "gpt-oss-20b", "llama-3.3-70b", "qwen"),
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
        models=("gpt-oss-120b", "gemma-4-31b", "zai-glm-4.7"),
        prefer=("gpt-oss", "gemma", "glm", "llama", "qwen"),
        # The free tier caps context at 8k across all models, which rules it
        # out for the main agent loop and makes it a good fit for the short
        # roles: summarising, naming, classifying.
        max_context=8192,
        # Measured 2026-08-15: a valid key, and all three listed models return
        # 402 "payment required". Cerebras lists what exists, not what your
        # account may call, so this lane needs billing enabled before it works
        # at all -- which is why the failure below is treated as permanent
        # rather than as a rate limit to wait out.
        limits="needs billing enabled — every model 402s on a free key",
        speed="fastest available — thousands of tokens/sec",
        privacy="Prompts leave your machine and reach Cerebras.",
        signup="cloud.cerebras.ai",
    ),
    FreeProvider(
        id="google",
        label="Google AI Studio",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        env_vars=("GEMINI_API_KEY", "GOOGLE_API_KEY"),
        # Google namespaces ids as "models/…" and closes older ones to new
        # accounts, so a bare "gemini-2.5-flash" 404s twice over. It also lists
        # every generation at once, and a plain "flash-lite" match lands on
        # 2.5 -- alphabetically first, and retired. Hence the `-latest` alias
        # first: Google repoints it themselves, so it survives release cadence
        # better than any version this file could name.
        models=("models/gemini-flash-lite-latest", "models/gemini-3.6-flash"),
        # flash-lite over flash deliberately. The full flash models reason
        # before answering, so a short role with a small output cap spends its
        # whole budget on hidden tokens and returns an empty string -- measured
        # here, the same failure the local `thinking.off_for_roles` switch
        # exists to prevent.
        prefer=("flash-lite-latest", "3.5-flash-lite", "3.1-flash-lite",
                "flash-lite", "flash-latest", "flash"),
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
        models=("ministral-8b-latest", "mistral-small-latest"),
        prefer=("ministral-8b", "mistral-small", "ministral-3b", "codestral"),
        max_context=131072,
        limits="1 req/sec · 500k tokens/min",
        speed="fast",
        privacy="Prompts leave your machine and reach Mistral.",
        signup="console.mistral.ai/api-keys",
    ),
)


def by_id(provider_id: str) -> Optional[FreeProvider]:
    return next((p for p in PROVIDERS if p.id == provider_id), None)


# {provider id: (fetched_at, [model ids])}. In memory only -- the roster moves
# on a scale of weeks, and a wrong id is recoverable in one request, so a disk
# cache would add a staleness bug for no real gain.
_ROSTER: dict[str, tuple[float, list[str]]] = {}
ROSTER_TTL_S = 1800

# Anything that is not a chat model. Ranking would otherwise happily pick a
# speech or embedding endpoint that matched a substring.
_NOT_CHAT = ("whisper", "tts", "embed", "rerank", "moderation", "guard",
             "orpheus", "aqa", "ocr", "image", "audio", "veo", "imagen")


def list_models(provider: FreeProvider, force: bool = False) -> list[str]:
    """What this provider actually serves right now.

    Falls back to the configured ids when the call fails, so losing the network
    degrades to a guess rather than to nothing.
    """
    cached = _ROSTER.get(provider.id)
    if cached and not force and time.time() - cached[0] < ROSTER_TTL_S:
        return cached[1]

    key = provider.key()
    if not key:
        return list(provider.models)

    try:
        from openai import OpenAI

        client = OpenAI(base_url=provider.base_url, api_key=key, timeout=30.0)
        ids = sorted(m.id for m in client.models.list().data)
    except Exception:
        return list(provider.models)

    _ROSTER[provider.id] = (time.time(), ids)
    return ids


def best_model(provider: FreeProvider) -> str:
    """The id to actually send, ranked by the provider's `prefer` list.

    Matching on substrings rather than exact ids is what makes this survive a
    version bump: "flash-lite" still resolves after gemini-3.6 becomes 3.7.
    """
    available = [m for m in list_models(provider)
                 if not any(bad in m.lower() for bad in _NOT_CHAT)]
    if not available:
        return provider.models[0]

    for wanted in provider.prefer:
        match = next((m for m in available if wanted in m.lower()), None)
        if match:
            return match

    # Nothing preferred is on offer; anything chat-shaped beats failing.
    return available[0]


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
        """Cool a provider down if the error is about *it* rather than about us.

        Returns whether it was penalised, which the caller reads as "worth
        trying the next provider". A malformed request is our fault and will
        fail identically on the next provider, so failing over would just
        spread the same mistake around.

        Two shapes of provider-side failure, and they want different waits:

        - A limit (429, quota, 5xx) clears on its own. Short cooldown.
        - An account refusal (401/402/403, or a model retired for new users)
          does not clear until somebody logs into a billing page. Cerebras
          answers 402 to every model on a valid free key, so retrying it each
          minute costs a wasted round-trip on every cheap role, forever.
        """
        text = str(error).lower()
        account = any(sign in text for sign in (
            "401", "402", "403", "payment required", "billing",
            "invalid api key", "unauthorized", "no longer available",
        ))
        if account:
            self.penalise(provider_id, seconds=ACCOUNT_COOLDOWN_S)
            return True

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
