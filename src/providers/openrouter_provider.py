"""OpenRouter provider with an enforced free-only mode.

OpenRouter aggregates ~400 models behind one OpenAI-compatible endpoint, a
subset of which are genuinely zero-cost. Two cost modes:

``free_only``
    Every request is checked against the live catalogue and refused unless the
    model bills zero across *all* pricing fields. This is a hard gate, not a
    filter on model names -- an unknown or repriced model is refused rather
    than sent.

``mixed``
    Paid models are permitted. Spend is real, so a per-session call cap applies
    and the first paid call asks for confirmation.

The mode is checked at request time rather than at configuration time, so
flipping to ``free_only`` takes effect immediately, including mid-session.
"""

from __future__ import annotations

from typing import Any, Callable, Generator, Optional

try:
    from openai import OpenAI  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    OpenAI = None

from ..local.openrouter import FREE_AUTO_MODEL, CatalogError, ModelCatalog
from .base import ChatResponse, MessageInput, TextChunkCallback
from .openai_compatible import OpenAICompatibleProvider

BASE_URL = "https://openrouter.ai/api/v1"


class PaidModelBlocked(RuntimeError):
    """Raised when a paid model is requested but the cost mode forbids it."""


class OpenRouterProvider(OpenAICompatibleProvider):
    """Serves OpenRouter models under a switchable cost policy."""

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        cost_mode: str = "free_only",
        catalog: Optional[ModelCatalog] = None,
        max_paid_calls: int = 20,
        confirm_paid: Optional[Callable[[str], bool]] = None,
        app_title: str = "Clawd Code",
        app_url: str = "https://github.com/GPT-AGI/Clawd-Code",
    ):
        super().__init__(api_key, base_url or BASE_URL, model or FREE_AUTO_MODEL)
        self.cost_mode = cost_mode
        self.catalog = catalog or ModelCatalog(cache_dir=".")
        self.max_paid_calls = max_paid_calls
        self._paid_calls_used = 0
        self._paid_confirmed = False
        self._confirm_paid = confirm_paid
        self._app_title = app_title
        self._app_url = app_url

    # -- policy ------------------------------------------------------------

    def set_cost_mode(self, mode: str) -> None:
        if mode not in ("free_only", "mixed"):
            raise ValueError(f"cost_mode must be free_only|mixed, got {mode!r}")
        self.cost_mode = mode

    def _authorize(self, model_id: str) -> str:
        """Gate a model against the cost mode. Returns the model to actually use."""
        if self.cost_mode == "free_only":
            # Raises CatalogError with an actionable message when not free.
            self.catalog.assert_free(model_id)
            return model_id

        info = self.catalog.get(model_id)
        if info is None or info.is_free:
            return model_id  # unknown-but-permitted, or free: nothing to gate

        # Paid model under `mixed`. Money is about to be spent.
        if self._paid_calls_used >= self.max_paid_calls:
            raise PaidModelBlocked(
                f"session cap of {self.max_paid_calls} paid OpenRouter calls "
                f"reached. Raise it in clawd-local.yaml, or use "
                f"`/openrouter free` to stay on zero-cost models."
            )
        if not self._paid_confirmed:
            approved = (
                self._confirm_paid(
                    f"Send this request to {model_id} ({info.price_summary})? "
                    f"This spends real money and your code leaves the machine."
                )
                if self._confirm_paid is not None
                else False
            )
            if not approved:
                raise PaidModelBlocked(
                    f"declined paid model {model_id!r}. Still on {self.cost_mode!r}; "
                    f"use `/openrouter free` to pin zero-cost models."
                )
            self._paid_confirmed = True
        self._paid_calls_used += 1
        return model_id

    # -- client ------------------------------------------------------------

    def _create_client(self) -> Any:
        if OpenAI is None:  # pragma: no cover
            raise ModuleNotFoundError("the `openai` package is required")
        return OpenAI(
            base_url=self.base_url or BASE_URL,
            api_key=self.api_key,
            timeout=600.0,
            # OpenRouter attributes usage to an app via these headers. They are
            # optional; sending them keeps requests identifiable rather than
            # anonymous, and costs nothing.
            default_headers={
                "HTTP-Referer": self._app_url,
                "X-Title": self._app_title,
            },
        )

    # -- chat --------------------------------------------------------------

    def chat(
        self,
        messages: list[MessageInput],
        tools: Optional[list[dict[str, Any]]] = None,
        **kwargs,
    ) -> ChatResponse:
        kwargs["model"] = self._authorize(self._get_model(**kwargs))
        return super().chat(messages, tools=tools, **kwargs)

    def chat_stream(
        self,
        messages: list[MessageInput],
        tools: Optional[list[dict[str, Any]]] = None,
        **kwargs,
    ) -> Generator[str, None, None]:
        kwargs["model"] = self._authorize(self._get_model(**kwargs))
        yield from super().chat_stream(messages, tools=tools, **kwargs)

    def chat_stream_response(
        self,
        messages: list[MessageInput],
        tools: Optional[list[dict[str, Any]]] = None,
        on_text_chunk: TextChunkCallback | None = None,
        **kwargs,
    ) -> ChatResponse:
        kwargs["model"] = self._authorize(self._get_model(**kwargs))
        return super().chat_stream_response(
            messages, tools=tools, on_text_chunk=on_text_chunk, **kwargs
        )

    # -- introspection -----------------------------------------------------

    def get_available_models(self) -> list[str]:
        """Models permitted under the current cost mode."""
        try:
            if self.cost_mode == "free_only":
                return [FREE_AUTO_MODEL] + [m.id for m in self.catalog.free_models()]
            return [FREE_AUTO_MODEL] + sorted(self.catalog.load())
        except CatalogError:
            return [FREE_AUTO_MODEL]

    def status(self) -> dict:
        try:
            free_count = len(self.catalog.free_models())
        except CatalogError:
            free_count = -1
        return {
            "cost_mode": self.cost_mode,
            "model": self.model,
            "free_models_available": free_count,
            "paid_calls_used": self._paid_calls_used,
            "paid_calls_cap": self.max_paid_calls,
        }
