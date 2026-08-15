"""Local model provider backed by the tiered llama.cpp / Ollama stack.

Clawd-Code's agent loop talks to this exactly as it would to OpenAI. Underneath,
each request is routed to a tier by role, the matching server is started (and
another evicted, if VRAM demands it), and the request is issued against that
server's OpenAI-compatible endpoint.

Because ``OpenAICompatibleProvider`` already handles tool-schema translation and
streaming tool-call reassembly, this subclass only has to supply the right
client per request.
"""

from __future__ import annotations

from typing import Any, Callable, Generator, Optional

try:
    from openai import OpenAI  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    OpenAI = None

from ..local.config import StackConfig, load_config
from ..local.router import CloudBlocked, Decision, Router
from ..local.supervisor import ModelSupervisor
from .base import BaseProvider, ChatResponse, MessageInput, TextChunkCallback
from .openai_compatible import OpenAICompatibleProvider


def _is_provider(client: Any) -> bool:
    """Whether a bound client is a full provider rather than a raw SDK client.

    The previous check was ``not hasattr(client, "chat.completions")``, which is
    always True: "chat.completions" is a dotted string, not an attribute name,
    so hasattr never finds it. That made the branch fire for raw OpenAI clients
    too, where ``client.chat`` is a namespace rather than a callable.
    """
    return isinstance(client, BaseProvider)


class LocalProvider(OpenAICompatibleProvider):
    """Serves requests from a local model ladder, with optional cloud escape.

    The ``api_key`` argument is ignored for local traffic — llama-server does
    not authenticate — but is forwarded to the cloud provider when a request
    escalates off-box.
    """

    # Signals to callers (e.g. the compaction service) that they may pass a
    # ``role`` kwarg to have the request routed to an appropriate tier.
    supports_roles = True

    def __init__(
        self,
        api_key: str = "local",
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        cfg: Optional[StackConfig] = None,
        confirm_cloud: Optional[Callable[[str], bool]] = None,
    ):
        super().__init__(api_key or "local", base_url, model or "workhorse")
        self.cfg = cfg or load_config()
        self.supervisor = ModelSupervisor(self.cfg)
        self.router = Router(self.cfg, confirm_cloud=confirm_cloud)
        self._clients: dict[str, Any] = {}
        self._last_decision: Optional[Decision] = None
        self._confirm_cloud = confirm_cloud
        # Built lazily and reused, so the model catalogue is fetched once.
        self._openrouter: Optional[Any] = None

    # -- client plumbing ---------------------------------------------------

    def _create_client(self) -> Any:
        """Required by the base class; the workhorse tier is the default."""
        return self._client_for_tier(self.cfg.roles.get("main", "workhorse"))

    def _client_for_tier(self, tier_name: str) -> Any:
        if OpenAI is None:  # pragma: no cover
            raise ModuleNotFoundError("the `openai` package is required for LocalProvider")
        endpoint = self.supervisor.get(tier_name)
        endpoint.touch()
        cached = self._clients.get(endpoint.base_url)
        if cached is None:
            # llama-server ignores the key but the SDK insists on one.
            cached = OpenAI(base_url=endpoint.base_url, api_key="local", timeout=600.0)
            self._clients[endpoint.base_url] = cached
        return cached

    def _free_client(self, provider_id: str) -> Any:
        """An OpenAI client pointed at one of the free providers.

        They all speak the OpenAI chat-completions API, so the only differences
        are the base URL and the key -- no new client code, which is why adding
        four of them costs almost nothing.
        """
        from ..local.free_providers import by_id

        provider = by_id(provider_id)
        if provider is None:
            raise CloudBlocked(f"unknown free provider {provider_id!r}")
        key = provider.key()
        if not key:
            raise CloudBlocked(f"{provider.label} has no API key configured")

        cached = self._clients.get(provider.base_url)
        if cached is None:
            cached = OpenAI(base_url=provider.base_url, api_key=key, timeout=300.0)
            self._clients[provider.base_url] = cached
        return cached

    def _bind(self, role: str, **kwargs) -> tuple[Any, str, Decision]:
        """Route this request and return (client, model_name, decision)."""
        decision = self.router.route(role)
        self._last_decision = decision

        if decision.free_provider:
            return (self._free_client(decision.free_provider),
                    decision.free_model, decision)

        if decision.is_cloud:
            client, model = self._cloud_client()
            return client, model, decision

        tier = self.cfg.tiers[decision.target]
        client = self._client_for_tier(decision.target)
        # llama-server serves a single model and ignores this field, but the
        # SDK requires it and it makes logs readable.
        return client, kwargs.get("model") or tier.name, decision

    def _observe(self, response: ChatResponse) -> None:
        """Feed a turn's tool activity to the router.

        Escalation depends on this. It was previously wired only into
        chat_stream_response, but the agent loop calls chat(), so the router
        never saw a single tool call and escalation could not fire -- a 9B
        looping on twelve failed calls was promoted to nothing.
        """
        for call in response.tool_uses or []:
            self.router.record_tool_call(call.get("name", ""), call.get("input"))
        if not response.tool_uses:
            # A turn that answers without tools is a clean finish.
            self.router.record_turn_success()

    def observe_tool_result(self, ok: bool) -> None:
        """Report a tool outcome. Callers that execute tools (the agent loop's
        event stream) know success/failure; the provider only sees requests.
        """
        self.router.record_tool_result(ok)

    def _apply_thinking(self, role: str, kwargs: dict[str, Any]) -> None:
        """Turn the reasoning phase off for roles that want a short answer.

        Measured on this stack: with thinking on, a request for one sentence
        spent all 300 completion tokens in ``reasoning_content`` and returned an
        EMPTY ``content`` with finish_reason "length". With it off, the same
        prompt answered correctly in 33 tokens. Raising the cap does not fix it
        -- the model simply thinks for longer -- so this is the only lever that
        works.

        Sent through ``extra_body`` because it is a llama.cpp/jinja template
        argument rather than an OpenAI API field. Providers that do not know it
        ignore it.
        """
        if role not in self.cfg.thinking.off_for_roles:
            return
        extra = dict(kwargs.get("extra_body") or {})
        template = dict(extra.get("chat_template_kwargs") or {})
        template.setdefault("enable_thinking", False)
        extra["chat_template_kwargs"] = template
        kwargs["extra_body"] = extra

    def _cap_output(self, decision: Decision, kwargs: dict[str, Any]) -> None:
        """Bound the response length, in place, for local tiers.

        llama.cpp generates until the context window is exhausted and then
        truncates mid-stream, which reaches the caller as an EMPTY reply after
        minutes of compute rather than as an error. Measured on a 900-line file
        review: 13,862 tokens generated, context died at 32,767, nothing
        returned. An explicit cap turns a silent failure into a finished
        (if shorter) answer.
        """
        if decision.is_cloud:
            return
        tier = self.cfg.tiers.get(decision.target)
        if tier is not None and kwargs.get("max_tokens") is None:
            kwargs["max_tokens"] = tier.max_output_tokens

    def _cloud_client(self) -> tuple[Any, str]:
        """Build a client for the configured cloud provider."""
        from ..config import get_provider_config  # imported late to avoid a cycle

        cloud = self.cfg.cloud
        try:
            key = (get_provider_config(cloud.provider) or {}).get("api_key")
        except ValueError as exc:
            raise CloudBlocked(f"unknown cloud provider {cloud.provider!r}") from exc
        if not key:
            raise CloudBlocked(
                f"cloud escalation needs an API key for {cloud.provider!r}. "
                f"Run `clawd login`, or set cloud.policy to 'off' in clawd-local.yaml."
            )
        if cloud.provider == "openrouter":
            # Delegate to the real provider so the free-only gate runs on every
            # request. Sharing the catalogue keeps one cached copy per session.
            from ..local.openrouter import ModelCatalog
            from .openrouter_provider import OpenRouterProvider

            if self._openrouter is None:
                self._openrouter = OpenRouterProvider(
                    api_key=key,
                    model=cloud.model,
                    cost_mode=cloud.cost_mode,
                    catalog=ModelCatalog(cache_dir=self.cfg.stack_dir),
                    max_paid_calls=cloud.max_paid_calls_per_session,
                    confirm_paid=self._confirm_cloud,
                )
            # Mode can be flipped mid-session by /openrouter.
            self._openrouter.set_cost_mode(cloud.cost_mode)
            return self._openrouter, cloud.model

        if cloud.provider == "anthropic":
            # The Anthropic API is not OpenAI-shaped; route through the real
            # provider class rather than pretending otherwise.
            from .anthropic_provider import AnthropicProvider

            return AnthropicProvider(api_key=key, model=cloud.model), cloud.model

        base_urls = {
            "openai": "https://api.openai.com/v1",
            "glm": "https://open.bigmodel.cn/api/paas/v4",
            "minimax": "https://api.minimaxi.com/anthropic",
        }
        return (
            OpenAI(base_url=base_urls.get(cloud.provider), api_key=key, timeout=600.0),
            cloud.model,
        )

    # -- chat --------------------------------------------------------------

    def chat(
        self,
        messages: list[MessageInput],
        tools: Optional[list[dict[str, Any]]] = None,
        role: str = "main",
        **kwargs,
    ) -> ChatResponse:
        client, model, decision = self._bind(role, **kwargs)
        if _is_provider(client):
            # A full provider (Anthropic, OpenRouter) — delegate wholesale so
            # its own policy gates run.
            return client.chat(messages, tools=tools, **kwargs)
        self._client = client
        kwargs["model"] = model
        self._cap_output(decision, kwargs)
        self._apply_thinking(role, kwargs)
        response = super().chat(messages, tools=tools, **kwargs)
        self._observe(response)
        return response

    def chat_stream(
        self,
        messages: list[MessageInput],
        tools: Optional[list[dict[str, Any]]] = None,
        role: str = "main",
        **kwargs,
    ) -> Generator[str, None, None]:
        client, model, decision = self._bind(role, **kwargs)
        if _is_provider(client):
            yield from client.chat_stream(messages, tools=tools, **kwargs)
            return
        self._client = client
        kwargs["model"] = model
        self._cap_output(decision, kwargs)
        self._apply_thinking(role, kwargs)
        yield from super().chat_stream(messages, tools=tools, **kwargs)

    def _free_failover(self, decision: Decision, exc: BaseException,
                       min_context: int) -> Optional[Decision]:
        """After a free provider refuses, hand back the next one to try.

        Only for refusals that look like limits. A malformed request is our
        fault and would fail identically everywhere, so failing over would just
        spread the same mistake across four providers and four rate limits.
        """
        from ..local.free_providers import best_model

        if not decision.free_provider:
            return None
        lane = self.router.free_lane
        if not lane.note_failure(decision.free_provider, exc):
            return None

        nxt = lane.pick(min_context=min_context)
        if nxt is None:
            return None
        return Decision(
            "cloud",
            f"{decision.free_provider} rate-limited -> {nxt.label}",
            is_cloud=True,
            free_provider=nxt.id,
            free_model=best_model(nxt),
        )

    def chat_stream_response(
        self,
        messages: list[MessageInput],
        tools: Optional[list[dict[str, Any]]] = None,
        on_text_chunk: TextChunkCallback | None = None,
        role: str = "main",
        **kwargs,
    ) -> ChatResponse:
        client, model, decision = self._bind(role, **kwargs)
        if _is_provider(client):
            return client.chat_stream_response(
                messages, tools=tools, on_text_chunk=on_text_chunk, **kwargs
            )

        # Free lane: try each enabled provider until one answers. This is the
        # whole point of having a pool -- a single free lane returning 429 was
        # a dead end.
        while True:
            self._client = client
            kwargs["model"] = model
            self._cap_output(decision, kwargs)
            self._apply_thinking(role, kwargs)
            try:
                response = super().chat_stream_response(
                    messages, tools=tools, on_text_chunk=on_text_chunk, **kwargs
                )
                break
            except Exception as exc:
                nxt = self._free_failover(
                    decision, exc, self.cfg.fast_roles.min_context
                )
                if nxt is None:
                    raise
                decision = nxt
                self._last_decision = nxt
                client = self._free_client(nxt.free_provider)
                model = nxt.free_model
        # Feed tool activity back to the router so degenerate loops are caught.
        for call in response.tool_uses or []:
            self.router.record_tool_call(call.get("name", ""), call.get("input"))
        if not response.tool_uses:
            self.router.record_turn_success()
        return response

    # -- introspection -----------------------------------------------------

    def get_available_models(self) -> list[str]:
        return [name for name, t in self.cfg.tiers.items() if t.serve]

    @property
    def last_route(self) -> Optional[Decision]:
        return self._last_decision

    def status(self) -> dict:
        return {
            "profile": self.cfg.profile.name,
            "servers": self.supervisor.status(),
            "router": self.router.status(),
        }

    def shutdown(self) -> None:
        self.supervisor.shutdown()
