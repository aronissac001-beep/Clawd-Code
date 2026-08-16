"""Local web UI for Clawd Code.

Serves a chat interface on localhost so the agent can be used without a
terminal. Runs entirely on the machine -- no external services, no telemetry.

The interesting part is bridging ``run_agent_loop``, which is synchronous and
callback-driven, into a live HTTP stream. The loop runs on a worker thread and
pushes events into a queue; the SSE response drains that queue. This keeps the
loop untouched -- the UI is a consumer of the same callbacks the REPL uses.
"""

from __future__ import annotations

import asyncio
import json
import os
import queue
import re
import sys
import threading
import time
import traceback
import urllib.parse
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..agent.conversation import Conversation
from ..config import get_default_provider, get_provider_config
from ..local.config import ConfigError, load_config, set_active_profile
from ..providers import get_provider_class
from ..tool_system.agent_loop import ToolEvent, run_agent_loop
from ..tool_system.context import ToolContext
from ..tool_system.defaults import build_default_registry

STATIC_DIR = Path(__file__).resolve().parent / "static"


# ---------------------------------------------------------------------------
# session
# ---------------------------------------------------------------------------


@dataclass
class Session:
    """One chat session: conversation, provider and tools."""

    workspace: Path
    provider: Any
    conversation: Conversation
    registry: Any
    context: ToolContext
    busy: bool = False
    cancel: bool = False
    # Tools the user has switched off. Held here rather than in the registry so
    # toggling is reversible without rebuilding from defaults.
    disabled_tools: set = field(default_factory=set)
    tokens_in: int = 0
    tokens_out: int = 0
    turns: int = 0
    # "auto" | "local:<tier>" | "openrouter:<model id>". Sticky across turns,
    # so the model picker behaves like a setting rather than a one-shot.
    model_spec: str = "auto"
    # The chat this conversation belongs to. Assigned up front rather than on
    # first save, so a turn that crashes still has somewhere to have been
    # written; the sidebar is then a record of what happened rather than only
    # of what the user remembered to save.
    session_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    title: str = ""
    # readonly | ask | accept_edits | full
    permission_mode: str = "ask"
    # low | medium | high | max -- scales the response budget.
    effort: str = "medium"
    # Whatever is serving the current turn: a worker thread, or _SYNC_HOLDER
    # when the turn runs inline. Held so `busy` can be checked against
    # something real rather than trusted.
    worker: Any = None

    def running(self) -> bool:
        """Is a turn genuinely in flight, as opposed to merely flagged?

        `busy` on its own is a promise, not evidence. It is set before the
        worker starts and cleared only inside that worker's `finally`, so any
        failure in between -- a model that will not load, an unknown tier --
        left it set with nothing alive to clear it, and every later message
        got "a request is already in flight" until the server was restarted.

        Asking the worker instead makes that unrepresentable: no live worker
        means no turn, whatever the flag says.
        """
        return bool(self.busy and self.worker is not None
                    and self.worker.is_alive())

    def effective_registry(self):
        """The registry minus disabled tools.

        Every tool schema costs prompt tokens on every turn, so switching tools
        off is a real speed lever and not only a safety one.

        MEASURED, in the shape that actually goes on the wire. An earlier note
        here counted the Anthropic serialisation, which is not what this
        project's default path sends: OpenAICompatibleProvider re-wraps every
        entry as {type: function, function: {...}}, and that is bigger.

        45 tools registered, 44 sent -- Skill's schema has no top-level
        "type", so the converter drops it -- for 15,581 characters, about
        3,900 tokens. Against each tier's window:

            reflex      8,192 ctx    47.5%   ← barely usable for tool work
            vision     16,384 ctx    23.8%
            workhorse  32,768 ctx    11.9%
            deep       32,768 ctx    11.9%

        So on the main tiers the full set is cheap and disabling tools buys
        little; on reflex it dominates. That split is also what decides whether
        MCP servers are affordable -- one of them can double the count.
        """
        if not self.disabled_tools:
            return self.registry
        from ..tool_system.registry import ToolRegistry

        keep = [
            self.registry.get(s.name)
            for s in self.registry.list_specs()
            if s.name not in self.disabled_tools
        ]
        return ToolRegistry([t for t in keep if t is not None])

    @classmethod
    def create(cls, workspace: Path) -> "Session":
        provider_name = get_default_provider()
        cls_ = get_provider_class(provider_name)
        try:
            key = (get_provider_config(provider_name) or {}).get("api_key") or "local"
        except ValueError:
            key = "local"
        provider = cls_(api_key=key) if provider_name != "local" else cls_()

        registry = build_default_registry(include_user_tools=False)
        return cls(
            workspace=workspace,
            provider=provider,
            conversation=Conversation(),
            registry=registry,
            context=ToolContext(workspace_root=workspace, cwd=workspace),
        )

    def reset(self) -> None:
        self.conversation = Conversation()


class _SyncHolder:
    """Stands in for a worker thread when a turn is served inline.

    The planner runs on the request's own threadpool worker rather than
    spawning one, so there is no thread to ask -- but it still owns the
    session for its duration, and `running()` must say so.
    """

    @staticmethod
    def is_alive() -> bool:
        return True


_SYNC_HOLDER = _SyncHolder()

SESSION: Optional[Session] = None
WORKSPACE = Path.cwd()


def get_session() -> Session:
    global SESSION
    if SESSION is None:
        SESSION = Session.create(WORKSPACE)
    return SESSION


# ---------------------------------------------------------------------------
# app
# ---------------------------------------------------------------------------

app = FastAPI(title="Clawd Code UI", docs_url=None, redoc_url=None)

# Set in main() from the bind address. Defaults to False so that anything
# importing this module without going through main() -- a test, the desktop
# shell -- gets the cautious behaviour rather than the convenient one.
_LOOPBACK_ONLY = False


@app.exception_handler(Exception)
def _unhandled(request, exc: Exception):
    """Say what went wrong, in the response and on stderr.

    A bare "500: Internal Server Error" is close to useless here. The one that
    prompted this cost a long hunt: a stale process was raising ImportError
    from a lazy import inside a route, and the only copy of that traceback went
    to the server's own stdout -- which, when it is launched from a shortcut or
    a pythonw shell, nobody ever sees.

    Returning the detail to the caller is safe for this app and only this app:
    it binds loopback by default and serves one local user. The check below is
    what keeps that true -- expose the detail only while the server is actually
    bound to localhost, so pointing --host at a LAN address does not start
    publishing tracebacks.
    """
    # Formatted from `exc`, not from sys.exc_info(). A handler runs *after* the
    # except block has been left, so format_exc() here returns the string
    # "NoneType: None" -- a diagnostic that diagnoses nothing, which is the
    # exact failure this handler exists to end.
    detail = "".join(
        traceback.format_exception(type(exc), exc, exc.__traceback__))
    print(detail, file=sys.stderr, flush=True)
    body = {"detail": f"{type(exc).__name__}: {exc}"}
    if _LOOPBACK_ONLY:
        body["traceback"] = detail[-4000:]
    return JSONResponse(status_code=500, content=body)


class ChatRequest(BaseModel):
    message: str
    # Names of files previously returned by /api/upload.
    attachments: list[str] = []
    # Optional one-off override; otherwise the session's sticky selection wins.
    model: Optional[str] = None


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


MAX_TEXT = 8000


def _tool_event_payload(ev: ToolEvent) -> dict:
    """Shape a ToolEvent for the UI.

    Structured output is preserved rather than stringified: the Edit and Write
    tools return a `structuredPatch`, which is what lets the UI render a real
    before/after diff instead of a wall of JSON.
    """
    out = ev.tool_output
    patch = None
    file_path = None
    images = None
    text = None

    if isinstance(out, dict):
        patch = out.get("structuredPatch")
        file_path = out.get("filePath")
        # Generated art travels the same road as a diff: lifted out of the
        # JSON blob so the UI can draw the thing itself. A tool that returns a
        # picture and gets rendered as {"url": "/api/pixel/file/..."} has, as
        # far as the user is concerned, not returned a picture.
        raw = out.get("images")
        if isinstance(raw, list):
            images = [
                {"url": str(i.get("url")), "label": str(i.get("label") or ""),
                 "pixel": bool(i.get("pixel"))}
                for i in raw[:24]
                if isinstance(i, dict) and str(i.get("url", "")).startswith("/api/")
            ] or None
        # Keep the payload small: the full original file is not needed to draw
        # a diff, and can be megabytes.
        text = None if patch else json.dumps(
            {k: v for k, v in out.items()
             if k not in ("originalFile", "structuredPatch", "images")},
            default=str,
        )[:MAX_TEXT]
    elif isinstance(out, str):
        text = out[:MAX_TEXT]
    elif out is not None:
        try:
            text = json.dumps(out, default=str)[:MAX_TEXT]
        except (TypeError, ValueError):
            text = str(out)[:MAX_TEXT]

    return {
        "type": "tool",
        "kind": ev.kind,
        "name": ev.tool_name,
        "input": ev.tool_input,
        "output": text,
        "patch": patch,
        "images": images,
        "file": file_path,
        "is_error": ev.is_error,
        "error": ev.error,
    }


# ---------------------------------------------------------------------------
# model selection
# ---------------------------------------------------------------------------


def _apply_model_spec(session: Session, spec: str) -> dict:
    """Point the next request at a specific model.

    Three shapes, because there are three genuinely different destinations:

    ``auto``                  the router decides, including escalation
    ``local:<tier>``          pin one rung of the local ladder
    ``openrouter:<model id>`` force the request off-box to a named model

    OpenRouter is armed per request rather than set once: ``arm_cloud()`` is
    deliberately one-shot in the router, so a sticky selection has to re-arm
    before every turn. That is done here rather than in the router, so nothing
    else can accidentally acquire a permanent cloud route.
    """
    provider = session.provider
    router = getattr(provider, "router", None)
    if router is None:
        raise HTTPException(400, "the local ladder is not active")

    spec = (spec or "auto").strip()
    if spec == "auto":
        router.force_tier(None)
        router.force_cloud(False)
        return {"mode": "auto"}

    kind, _, value = spec.partition(":")

    if kind == "local":
        router.force_cloud(False)
        try:
            router.force_tier(value)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"mode": "local", "tier": value}

    if kind == "openrouter":
        if not value:
            raise HTTPException(400, "no OpenRouter model given")
        cfg = getattr(provider, "cfg", None)
        if cfg is None:
            raise HTTPException(400, "the local ladder is not active")
        cfg.cloud.provider = "openrouter"
        cfg.cloud.model = value
        if cfg.cloud.policy == "off":
            # Choosing a cloud model *is* the consent; refusing it here would
            # mean the picker silently did nothing.
            cfg.cloud.policy = "manual"
        # The provider is cached and holds its own model attribute, so setting
        # cfg.cloud.model alone would keep calling whatever it was built with.
        cached = getattr(provider, "_openrouter", None)
        if cached is not None:
            cached.model = value
        # Sticky, not one-shot: one user message costs several provider calls.
        router.force_cloud(True)
        return {"mode": "openrouter", "model": value}

    raise HTTPException(400, f"unknown model selector {spec!r}")


# Tools that change something. Used both to deny them in read-only mode and to
# decide what "accept edits" is actually accepting.
_EDIT_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
_MUTATING_TOOLS = _EDIT_TOOLS | {"Bash", "BashOutput", "KillShell"}

PERMISSION_MODES = {
    "readonly": {"label": "Read only",
                 "detail": "No writes, edits or shell commands"},
    "ask": {"label": "Ask",
            "detail": "Anything needing approval is refused"},
    "accept_edits": {"label": "Accept edits",
                     "detail": "File changes go through, shell still asks"},
    "full": {"label": "Full access",
             "detail": "Nothing is withheld"},
}

EFFORT_TOKENS = {"low": 1024, "medium": None, "high": 8192, "max": 16384}
EFFORT_LABELS = {"low": "Low", "medium": "Medium", "high": "High", "max": "Max"}


def _apply_permission_mode(session: Session) -> None:
    """Translate the chosen mode into denials and an approval handler.

    There is no interactive prompt in this UI, so "ask" means refuse: a tool
    that wants approval gets an error rather than silently proceeding. The
    other modes decide up front what would have been approved.
    """
    from ..tool_system.permissions import ToolPermissionContext

    mode = session.permission_mode
    context = session.context
    context.plan_mode = mode == "readonly"

    deny = _MUTATING_TOOLS if mode == "readonly" else set()
    context.permission_context = ToolPermissionContext.from_iterables(
        deny_names=deny, workspace_root=session.workspace
    )

    if mode == "full":
        context.permission_handler = lambda name, msg, sug: (True, False)
    elif mode == "accept_edits":
        context.permission_handler = lambda name, msg, sug: (name in _EDIT_TOOLS, False)
    else:
        context.permission_handler = None


def _effort_kwargs(session: Session) -> dict:
    """Provider parameters for the chosen effort.

    Effort here is a response budget, not a reasoning-token knob: local
    llama.cpp models have no such control, and pretending otherwise would make
    the menu a placebo. Higher effort buys room for a longer answer -- which is
    what actually ran out on the 900-line review that motivated the cap.
    """
    budget = EFFORT_TOKENS.get(session.effort)
    return {"max_tokens": budget} if budget else {}


def _vision_tier_name() -> Optional[str]:
    """The name of a served tier that can actually see, or None.

    Identified by having a projector configured rather than by being called
    "vision": that is the thing that makes it able to read an image, and it
    keeps a renamed tier working.
    """
    try:
        cfg = load_config()
    except ConfigError:
        return None
    for name, tier in cfg.tiers.items():
        if tier.serve and getattr(tier, "mmproj", None):
            return name
    return None


UPLOAD_DIR = Path.home() / ".clawd" / "media" / "uploads"


def _attachment_blocks(names: list[str]) -> tuple[list[str], list[str]]:
    """Resolve uploaded file names to (data URIs, human-readable paths).

    Both are returned because they serve different consumers: a vision model
    reads the image itself, while the agent's file tools need somewhere on disk
    to point at. A model with no vision still gets a usable message.
    """
    from ..media.fal import media_root, to_data_uri

    uris: list[str] = []
    paths: list[str] = []
    for name in names or []:
        safe = Path(name).name  # never let a name escape these directories
        # Two sources, because "attach" means both "the file I dropped in" and
        # "the image I just generated", and those land in different places.
        path = next(
            (p for p in (UPLOAD_DIR / safe, media_root() / safe) if p.is_file()),
            None,
        )
        if path is None:
            continue
        paths.append(str(path))
        if path.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
            try:
                uris.append(to_data_uri(path))
            except OSError:
                pass
    return uris, paths


@app.post("/api/chat")
async def chat(req: ChatRequest):
    session = get_session()
    if session.running():
        raise HTTPException(409, "a request is already in flight")
    if not req.message.strip() and not req.attachments:
        raise HTTPException(400, "empty message")

    # The picker's selection is sticky, but only once it is known to work. A
    # spec that cannot be applied -- a tier that no longer exists, a model that
    # will not start -- used to stick anyway, so the 400 repeated on every
    # later message even after the user stopped asking for that model, with
    # nothing in the UI to say why.
    previous_spec = session.model_spec
    if req.model:
        session.model_spec = req.model

    events: "queue.Queue[Optional[dict]]" = queue.Queue()
    session.busy = True
    session.cancel = False

    # Everything between here and the worker thread starting must be
    # exception-safe, because `busy` is only cleared in the worker's `finally`
    # -- and if the worker never starts, nothing clears it.
    #
    # This was not theoretical. `_apply_model_spec` raises for an unknown tier
    # and for a model that will not start (routine here: the ladder refuses
    # when VRAM is short). The 400 reached the user, the session stayed busy,
    # and every later message got "a request is already in flight" -- forever,
    # since /api/stop only sets the cancel flag and there was no worker to read
    # it. One transient model failure bricked the UI until the server was
    # restarted.
    try:
        return _start_chat(session, req, events)
    except BaseException:
        session.busy = False
        session.model_spec = previous_spec
        raise


def _start_chat(session: Session, req: "ChatRequest",
                events: "queue.Queue[Optional[dict]]") -> StreamingResponse:
    image_uris, file_paths = _attachment_blocks(req.attachments)

    # An image sent to a text-only tier is not an error -- llama.cpp accepts
    # the request and answers as though the picture were not there, which is
    # indistinguishable from the model being unobservant. When the user has not
    # pinned a model, route the turn to a vision tier instead. Restored
    # afterwards, so one screenshot does not leave the whole session on a model
    # that is worse at tool-driven coding.
    routed_from: Optional[str] = None
    if image_uris and session.model_spec == "auto":
        vision = _vision_tier_name()
        if vision:
            routed_from = session.model_spec
            session.model_spec = f"local:{vision}"

    _apply_model_spec(session, session.model_spec)
    _apply_permission_mode(session)

    text = req.message
    if file_paths:
        listing = "\n".join(f"- {p}" for p in file_paths)
        text = f"{text}\n\nAttached files (also on disk):\n{listing}".strip()
    session.conversation.add_user_message_with_images(text, image_uris)

    if routed_from is not None:
        events.put({
            "type": "notice",
            "data": f"Image attached — using the {_vision_tier_name()} model "
                    f"for this turn.",
        })

    class _Cancelled(RuntimeError):
        pass

    def on_text(chunk: str) -> None:
        # Stop, checked per token rather than per turn.
        #
        # The guards on chat/chat_stream_response only fire *between* model
        # calls, so a single long answer -- the common case, and the one a user
        # actually wants to abandon -- ran to completion whatever they pressed.
        # Measured before this: 25 seconds of generation after Stop, streaming
        # to a queue with nobody left reading it.
        #
        # Raising here does reach the outside. openai_compatible calls this
        # callback directly with no guard of its own, so the exception leaves
        # chat_stream_response; the agent loop treats a failed stream as
        # "streaming unsupported" and retries with chat(), which is guarded and
        # raises immediately. One wasted call setup, and the turn ends.
        if session.cancel:
            raise _Cancelled("stopped by user")
        events.put({"type": "text", "data": chunk})

    def on_event(ev: ToolEvent) -> None:
        # No cancel check here on purpose: the loop routes tool events through
        # _safe_call_handler, which swallows every exception, so raising would
        # be a no-op that only looked like a guard. Tool boundaries are already
        # covered by the guards on chat/chat_stream_response.
        #
        # The provider sees tool *requests*; only the loop knows the outcome.
        # Feeding results back is what lets escalation notice a failing model.
        if ev.kind in ("tool_result", "tool_error"):
            observe = getattr(session.provider, "observe_tool_result", None)
            if observe is not None:
                observe(not ev.is_error)
        events.put(_tool_event_payload(ev))

    # Let long-running tools see Stop. Image generation can sit inside one tool
    # call for a minute with no streamed token to interrupt, so without this
    # the button looks dead for the whole call.
    session.context.should_cancel = lambda: session.cancel

    def worker() -> None:
        # run_agent_loop has no cancellation hook, and exceptions raised from
        # the event callbacks are swallowed by _safe_call_handler. The one
        # place an exception reliably escapes is the provider call the loop
        # makes each turn, so Stop is enforced by guarding that for the
        # duration of the request and restoring it afterwards.
        original_chat = session.provider.chat
        original_stream = getattr(session.provider, "chat_stream_response", None)

        def guarded_chat(*args, **kwargs):
            if session.cancel:
                raise _Cancelled("stopped by user")
            return original_chat(*args, **kwargs)

        def guarded_stream(*args, **kwargs):
            # _call_provider_for_turn swallows exceptions from this and falls
            # back to chat(), which is also guarded -- so cancelling still
            # takes effect either way.
            if session.cancel:
                raise _Cancelled("stopped by user")
            return original_stream(*args, **kwargs)

        session.provider.chat = guarded_chat  # type: ignore[method-assign]
        if original_stream is not None:
            session.provider.chat_stream_response = guarded_stream  # type: ignore[method-assign]
        try:
            result = run_agent_loop(
                conversation=session.conversation,
                provider=session.provider,
                tool_registry=session.effective_registry(),
                tool_context=session.context,
                max_turns=25,
                provider_kwargs=_effort_kwargs(session),
                # Real token-by-token streaming. With stream=False the loop
                # calls provider.chat() and only chunks the text *after* the
                # full response arrives, so the UI shows nothing for the whole
                # generation -- measured at 135s of silence on a long answer.
                stream=True,
                verbose=False,
                on_event=on_event,
                on_text_chunk=on_text,
            )
            route = None
            decision = getattr(session.provider, "last_route", None)
            if decision is not None:
                route = {"target": decision.target, "reason": decision.reason}
            usage = result.usage or {}
            session.tokens_in += int(usage.get("input_tokens") or 0)
            session.tokens_out += int(usage.get("output_tokens") or 0)
            session.turns += int(result.num_turns or 0)
            events.put({
                "type": "done",
                "text": result.response_text,
                "usage": usage,
                "turns": result.num_turns,
                "route": route,
                "session_tokens": {"in": session.tokens_in, "out": session.tokens_out},
            })
        except _Cancelled:
            events.put({"type": "stopped"})
        except Exception as exc:  # surfaced to the user rather than swallowed
            events.put({
                "type": "error",
                "data": str(exc),
                "detail": traceback.format_exc(limit=3),
            })
        finally:
            session.provider.chat = original_chat  # type: ignore[method-assign]
            if original_stream is not None:
                session.provider.chat_stream_response = original_stream  # type: ignore[method-assign]
            session.busy = False
            session.cancel = False
            # Hand the routing back if this turn borrowed the vision tier.
            if routed_from is not None:
                session.model_spec = routed_from
                try:
                    _apply_model_spec(session, routed_from)
                except HTTPException:
                    pass
            # After the turn, whatever its outcome: a failed turn is still
            # history worth keeping, and often the more interesting kind.
            _autosave(session)
            events.put(None)

    session.worker = threading.Thread(target=worker, daemon=True)
    session.worker.start()

    async def stream():
        loop = asyncio.get_running_loop()
        while True:
            item = await loop.run_in_executor(None, events.get)
            if item is None:
                break
            yield _sse(item)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/status")
def status():
    """Everything the sidebar shows. Degrades gracefully if the ladder is off."""
    session = get_session()
    out: dict[str, Any] = {
        "workspace": str(session.workspace),
        "provider": get_default_provider(),
        "busy": session.running(),
        "messages": len(session.conversation.messages),
    }

    prov = session.provider
    if hasattr(prov, "status"):
        try:
            out["ladder"] = prov.status()
        except Exception as exc:
            out["ladder_error"] = str(exc)

    try:
        cfg = load_config()
        out["profile"] = cfg.profile.name
        out["profiles"] = sorted(cfg.profiles)
        out["tiers"] = [
            {
                "name": n,
                "device": t.device,
                "context": t.context,
                "model": t.file,
                "serve": t.serve,
            }
            for n, t in cfg.tiers.items()
            if t.serve
        ]
        out["roles"] = {r: cfg.tier_for_role(r).name for r in cfg.roles}
        out["cloud"] = {
            "policy": cfg.cloud.policy,
            "provider": cfg.cloud.provider,
            "model": cfg.cloud.model,
            "cost_mode": cfg.cloud.cost_mode,
            "free_only": cfg.cloud.is_free_only,
        }
    except ConfigError as exc:
        out["config_error"] = str(exc)

    try:
        from ..local.supervisor import query_free_vram_mb

        out["vram_free_mb"] = query_free_vram_mb()
    except Exception:
        out["vram_free_mb"] = None

    try:
        from ..tool_system.write_guard import snapshot

        out["write_guard"] = snapshot()
    except Exception:
        pass

    return out


class ProfileRequest(BaseModel):
    name: str


@app.post("/api/profile")
def set_profile(req: ProfileRequest):
    cfg = load_config()
    if req.name not in cfg.profiles:
        raise HTTPException(400, f"unknown profile {req.name!r}")
    set_active_profile(cfg.stack_dir, req.name)
    session = get_session()
    # Servers must restart to pick up the new budget.
    if hasattr(session.provider, "supervisor"):
        session.provider.supervisor.shutdown()
    return {"ok": True, "profile": req.name}


class TierRequest(BaseModel):
    name: Optional[str] = None


@app.post("/api/tier")
def set_tier(req: TierRequest):
    session = get_session()
    router = getattr(session.provider, "router", None)
    if router is None:
        raise HTTPException(400, "the local ladder is not active")
    try:
        router.force_tier(req.name or None)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "pinned": req.name}


class CloudRequest(BaseModel):
    policy: Optional[str] = None
    arm: bool = False


@app.post("/api/cloud")
def set_cloud(req: CloudRequest):
    session = get_session()
    router = getattr(session.provider, "router", None)
    if router is None:
        raise HTTPException(400, "the local ladder is not active")
    if req.policy:
        try:
            router.set_cloud_policy(req.policy)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    if req.arm:
        try:
            router.arm_cloud()
        except Exception as exc:
            raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "policy": router.cloud_policy, "armed": req.arm}


class CostModeRequest(BaseModel):
    mode: str


@app.post("/api/costmode")
def set_cost_mode(req: CostModeRequest):
    if req.mode not in ("free_only", "mixed"):
        raise HTTPException(400, "mode must be free_only or mixed")
    session = get_session()
    cfg = getattr(session.provider, "cfg", None)
    if cfg is not None:
        cfg.cloud.cost_mode = req.mode
        return {"ok": True, "cost_mode": req.mode}
    if hasattr(session.provider, "set_cost_mode"):
        session.provider.set_cost_mode(req.mode)
        return {"ok": True, "cost_mode": req.mode}
    raise HTTPException(400, "OpenRouter is not the active provider")


@app.get("/api/models/free")
def free_models():
    try:
        from ..local.openrouter import CatalogError, ModelCatalog

        cfg = load_config()
        cat = ModelCatalog(cache_dir=cfg.stack_dir)
        return {
            "models": [
                {"id": m.id, "context": m.context_length} for m in cat.free_models()
            ]
        }
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


@app.post("/api/stop")
def stop():
    """Request cancellation. Takes effect before the next model call, so a
    tool already running finishes first.

    Also the manual way out of a stuck session. Stop used to set the cancel
    flag and nothing else, so when `busy` was set with no worker alive there
    was nobody to read the flag and the button did nothing -- the one control
    a user reaches for when the UI stops responding was the one that could not
    help. Clearing a flag no live worker owns is safe: there is nothing left
    to race with.
    """
    session = get_session()
    if not session.busy:
        return {"ok": True, "was_busy": False}
    if not session.running():
        session.busy = False
        session.cancel = False
        session.worker = None
        return {"ok": True, "was_busy": False, "cleared_stale": True}
    session.cancel = True
    return {"ok": True, "was_busy": True}


# ---------------------------------------------------------------------------
# settings
# ---------------------------------------------------------------------------


def _editor():
    from ..local.config_writer import ConfigEditor

    return ConfigEditor(load_config().stack_dir)


def _reload_after_change() -> None:
    """Config changed on disk; drop running servers so they restart with it."""
    session = get_session()
    sup = getattr(session.provider, "supervisor", None)
    if sup is not None:
        sup.shutdown()
    cfg = getattr(session.provider, "cfg", None)
    if cfg is not None:
        try:
            session.provider.cfg = load_config()
            if sup is not None:
                sup.cfg = session.provider.cfg
            router = getattr(session.provider, "router", None)
            if router is not None:
                router.cfg = session.provider.cfg
        except ConfigError:
            pass


@app.get("/api/settings")
def get_settings():
    """Everything the settings panel needs, resolved and raw."""
    try:
        cfg = load_config()
    except ConfigError as exc:
        raise HTTPException(500, str(exc)) from exc

    raw = _editor().load()

    def tier_row(name, t):
        path = cfg.model_path(t)
        return {
            "name": name,
            "repo": t.repo,
            "file": t.file,
            "device": t.device,
            "context": t.context,
            "max_output_tokens": t.max_output_tokens,
            "spec_type": t.spec_type,
            "spec_draft_n_max": t.spec_draft_n_max,
            "n_cpu_moe": t.n_cpu_moe,
            "n_gpu_layers": t.n_gpu_layers,
            "cache_type_k": t.cache_type_k,
            "cache_type_v": t.cache_type_v,
            "flash_attn": t.flash_attn,
            "batch_size": t.batch_size,
            "ubatch_size": t.ubatch_size,
            "serve": t.serve,
            "approx_mb": t.approx_mb,
            "measured_vram_mb": t.measured_vram_mb,
            "downloaded": path.is_file(),
            "size_mb": int(path.stat().st_size / (1024 * 1024)) if path.is_file() else 0,
        }

    profiles = {}
    for pname, p in cfg.profiles.items():
        profiles[pname] = {
            "vram_mb": p.vram_mb, "ram_mb": p.ram_mb, "threads": p.threads,
            "threads_batch": p.threads_batch, "max_context": p.max_context,
            "allow_gpu": p.allow_gpu, "allow_deep_tier": p.allow_deep_tier,
            "role_overrides": dict(p.role_overrides),
        }

    esc = raw.get("escalation") or {}
    return {
        "active_profile": cfg.profile.name,
        "profiles": profiles,
        "tiers": [tier_row(n, t) for n, t in cfg.tiers.items()],
        "roles": dict(cfg.roles),
        "escalation": {k: esc.get(k) for k in (
            "enabled", "on_repeated_tool_failure", "on_repeated_identical_call",
            "on_empty_tool_args", "auto_demote_after_success", "ceiling")},
        "cloud": {
            "policy": cfg.cloud.policy, "provider": cfg.cloud.provider,
            "model": cfg.cloud.model, "cost_mode": cfg.cloud.cost_mode,
            "auto_max_calls_per_session": cfg.cloud.auto_max_calls_per_session,
            "max_paid_calls_per_session": cfg.cloud.max_paid_calls_per_session,
        },
        "limits": __import__("src.local.config_writer", fromlist=["LIMITS"]).LIMITS,
        "devices": ["gpu", "cpu", "hybrid"],
        "spec_types": ["none", "draft-mtp", "ngram-simple", "ngram-cache", "draft-simple"],
        "models_dir": str(cfg.models_dir),
    }


class SettingsRequest(BaseModel):
    section: str
    name: Optional[str] = None
    values: dict


@app.post("/api/settings")
def update_settings(req: SettingsRequest):
    from ..local.config_writer import ConfigWriteError

    ed = _editor()
    try:
        if req.section == "profile":
            if not req.name:
                raise HTTPException(400, "profile name required")
            applied = ed.set_profile(req.name, req.values)
        elif req.section == "tier":
            if not req.name:
                raise HTTPException(400, "tier name required")
            applied = ed.set_tier(req.name, req.values)
        elif req.section == "roles":
            applied = ed.set_roles(req.values)
        elif req.section == "escalation":
            applied = ed.set_escalation(req.values)
        elif req.section == "cloud":
            applied = ed.set_cloud(req.values)
        elif req.section == "active_profile":
            applied = {"active_profile": ed.set_active_profile(req.values["name"])}
        else:
            raise HTTPException(400, f"unknown section {req.section!r}")
    except ConfigWriteError as exc:
        raise HTTPException(400, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(400, f"missing field {exc}") from exc

    _reload_after_change()
    return {"ok": True, "applied": applied}


@app.get("/api/models/installed")
def installed_models():
    """GGUF files present on disk, so a tier can be pointed at another one."""
    cfg = load_config()
    d = cfg.models_dir
    out = []
    if d.is_dir():
        for p in sorted(d.glob("*.gguf")):
            out.append({"file": p.name, "size_mb": int(p.stat().st_size / (1024 * 1024))})
    return {"models": out, "dir": str(d)}


@app.get("/api/tools")
def list_tools():
    session = get_session()
    specs = []
    for s in session.registry.list_specs():
        specs.append({
            "name": s.name,
            "description": (s.description or "")[:160],
            "enabled": s.name not in session.disabled_tools,
        })
    return {"tools": sorted(specs, key=lambda t: t["name"]),
            "disabled": sorted(session.disabled_tools)}


class ToolToggle(BaseModel):
    name: str
    enabled: bool


@app.post("/api/tools")
def toggle_tool(req: ToolToggle):
    session = get_session()
    known = {s.name for s in session.registry.list_specs()}
    if req.name not in known:
        raise HTTPException(400, f"unknown tool {req.name!r}")
    if req.enabled:
        session.disabled_tools.discard(req.name)
    else:
        session.disabled_tools.add(req.name)
    return {"ok": True, "disabled": sorted(session.disabled_tools)}


# -- file mentions ----------------------------------------------------------

_SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist",
              "build", ".idea", ".vscode", "models", "bin", ".cache"}

# Ceilings for the @-mention walk. This runs while the user is typing, so the
# right trade is "good answers fast" over "complete answers eventually": a
# picker that appears in 250ms with the top matches beats a complete one that
# arrives after the user has finished the sentence.
FIND_BUDGET_S = 0.25
FIND_SCAN_CAP = 20000


@app.get("/api/files")
def find_files(q: str = "", limit: int = 25):
    """Files under the workspace matching a fragment, for @-mentions.

    Walks rather than globs so noisy directories can be pruned -- a node_modules
    or a models folder would otherwise swamp every result.

    Bounded by time and by files examined, not only by matches found. The
    match cap alone was no bound at all: a query that matches little walks the
    whole tree looking for the matches it will never find, and the workspace is
    whatever folder the user picked. Measured at 42 seconds with a home folder
    as the workspace -- and this endpoint fires from the @-mention picker, so
    that was 42 seconds of a threadpool worker per keystroke.

    os.walk is breadth-first-ish from the root down, and results are ranked
    shallowest-first anyway, so cutting the walk short drops the paths least
    likely to have been wanted.
    """
    session = get_session()
    root = session.workspace
    needle = q.lower().strip()
    out = []
    if not root.is_dir():
        return {"files": []}

    deadline = time.monotonic() + FIND_BUDGET_S
    scanned = 0
    truncated = False

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if fn.startswith("."):
                continue
            scanned += 1
            full = Path(dirpath) / fn
            try:
                rel = full.relative_to(root).as_posix()
            except ValueError:
                continue
            if needle and needle not in rel.lower():
                continue
            out.append(rel)
            if len(out) >= limit * 8:
                break
        if len(out) >= limit * 8:
            break
        # Checked per directory rather than per file: time.monotonic() on every
        # filename would itself become the cost being guarded against.
        if scanned >= FIND_SCAN_CAP or time.monotonic() > deadline:
            truncated = True
            break

    # Shallower paths and earlier matches first: a file at the root is far more
    # likely to be the one meant than one buried six levels down.
    out.sort(key=lambda p: (p.count("/"), p.lower().find(needle) if needle else 0, len(p)))
    return {"files": out[:limit], "truncated": truncated, "scanned": scanned}


# ---------------------------------------------------------------------------
# plan mode: decompose a large request and run the steps
# ---------------------------------------------------------------------------

CURRENT_RUN: dict[str, Any] = {"orch": None}


def _workspace_files(root: Path, limit: int = 60) -> list[str]:
    out = []
    if not root.is_dir():
        return out
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if fn.startswith("."):
                continue
            try:
                out.append((Path(dirpath) / fn).relative_to(root).as_posix())
            except ValueError:
                continue
            if len(out) >= limit:
                return out
    return out


def _plan_with_model(session, goal: str) -> Any:
    """Ask the local model for a plan, falling back to a generic shape."""
    from ..local.planner import build_planner_messages, fallback_plan, parse_plan

    msgs = build_planner_messages(goal, _workspace_files(session.workspace))
    try:
        # Routed through the "plan" role so the tier is configurable from
        # Settings > Roles rather than hardcoded here.
        #
        # MEASURED on the same goal ("Make a Snake game in Python using
        # pygame"), which settled which tier should be the default:
        #
        #   workhorse (9B, GPU)   46.6s   8 steps   27.2 tok/s
        #   reflex    (4B, CPU)  184.3s   1 step     7.9 tok/s
        #
        # Reflex is 4x slower AND decomposes badly -- a one-step "plan" is no
        # plan at all. Planning on the CPU would leave the GPU free, but that
        # is worth nothing if the output is unusable. Hence workhorse.
        #
        # 2200 tokens, not less: an 8-step plan ran to 1270 tokens, and a 900
        # cap truncated the JSON mid-object on BOTH tiers, so parsing failed
        # and every request silently fell back to the generic 4-step plan.
        resp = session.provider.chat(
            msgs, tools=None, max_tokens=2200, temperature=0.0, role="plan")
        return parse_plan(goal, resp.content or "")
    except Exception:
        return fallback_plan(goal)


def _unescape_if_needed(content: str) -> str:
    """Repair double-escaped newlines from a remote worker's JSON.

    Models frequently emit "a\\\\nb" rather than "a\\nb", so json.loads yields
    a literal backslash-n instead of a newline and the whole file lands on one
    line -- valid JSON, unrunnable Python. Observed on a scoring.py that failed
    with "unexpected character after line continuation character".

    Only applied when the text has escapes and no real newlines, so genuine
    multi-line content containing a legitimate "\\n" is left alone.
    """
    if "\n" in content or "\\n" not in content:
        return content
    return (content
            .replace("\\r\\n", "\n")
            .replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace('\\"', '"')
            .replace("\\'", "'"))


def _write_remote_files(root: Path, raw: str) -> tuple[list[str], list[str]]:
    """Land a remote worker's file map on disk, safely.

    Paths come from a model on someone else's server, so each one is resolved
    and checked to be inside the workspace. Without that, a path like
    ``../../.ssh/authorized_keys`` would escape the folder entirely.
    """
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    start, depth, chunk = text.find("{"), 0, None
    if start < 0:
        return [], []
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                chunk = text[start:i + 1]
                break
    if not chunk:
        return [], []
    try:
        files = (json.loads(chunk) or {}).get("files") or {}
    except ValueError:
        return [], []
    if not isinstance(files, dict):
        return [], []

    root = root.resolve()
    written: list[str] = []
    rejected: list[str] = []
    for rel, content in list(files.items())[:12]:
        if not isinstance(rel, str) or not isinstance(content, str):
            continue
        from ..tool_system.write_guard import WriteRejected, guard

        target_probe = (root / rel)
        prior = None
        if target_probe.is_file():
            try:
                prior = target_probe.read_text(encoding="utf-8", errors="replace")
            except OSError:
                prior = None
        try:
            # `prior` matters most here: a remote worker once returned the same
            # 62-char string for a dozen paths and flattened nine real files.
            content, _ = guard(rel, content, existing=prior)
        except WriteRejected as exc:
            rejected.append(f"{rel}: {exc}")
            continue        # a bad write is worse than a missing file
        target = (root / rel).resolve()
        try:
            target.relative_to(root)      # refuses ../ escapes
        except ValueError:
            continue
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            written.append(target.relative_to(root).as_posix())
        except OSError:
            continue
    return written, rejected


def _make_step_runner(session):
    """Build the callback the orchestrator uses to execute one step.

    Each step gets a brand new Conversation seeded with only a short summary of
    prior work -- never the full transcript. Carrying the transcript is what
    exhausted the context in the first place.
    """
    from ..agent.conversation import Conversation
    from ..tool_system.agent_loop import run_agent_loop

    def run_step(step, worker, summary: str) -> str:
        prompt = (
            f"{step.prompt}\n\n"
            f"--- context ---\n{summary}\n"
            f"Working folder: {session.workspace}\n"
            f"Do only this step. Do not attempt the whole project."
        )

        if worker.kind == "openrouter":
            # Remote workers have no tools -- they cannot touch this machine.
            # Without a way to land their output, parallelism would just produce
            # text that goes nowhere, so they are asked for a file map which is
            # written here, on this side of the network.
            from ..config import get_provider_config
            from ..local.openrouter import ModelCatalog
            from ..providers.openrouter_provider import OpenRouterProvider

            key = (get_provider_config("openrouter") or {}).get("api_key")
            if not key:
                raise RuntimeError("no OpenRouter key configured")
            cfg = load_config()
            prov = OpenRouterProvider(
                api_key=key, model=worker.model, cost_mode=cfg.cloud.cost_mode,
                catalog=ModelCatalog(cache_dir=cfg.stack_dir))
            # The example is described rather than shown as copyable literals:
            # a model took '{"files": {"relative/path.py": "file contents here"}}'
            # at face value and created relative/path.py containing exactly
            # "file contents here".
            remote_prompt = (
                prompt +
                "\n\nYou cannot run tools. Reply with ONLY a JSON object with a "
                'single key "files", whose value maps each real file path '
                "(relative to the project root, forward slashes) to that file's "
                "complete contents as a JSON string.\n"
                "Use the ACTUAL paths and ACTUAL code for this task -- never "
                "placeholder names or placeholder text.\n"
                "No prose, no code fence, no commentary."
            )
            r = prov.chat([{"role": "user", "content": remote_prompt}],
                          tools=None, model=worker.model, max_tokens=6000)
            written, rejected = _write_remote_files(session.workspace, r.content or "")
            if rejected and not written:
                raise RuntimeError(
                    f"{worker.model} produced only rejected content: " +
                    "; ".join(rejected[:3]))
            if written:
                note = f"Wrote {len(written)} file(s): " + ", ".join(written)
                if rejected:
                    note += f" ({len(rejected)} rejected: " + "; ".join(rejected[:2]) + ")"
                return note
            # A remote step that produced no files did NOT do its job. Reporting
            # it as done was actively misleading: a first run showed 7 steps
            # "OK" with only 4 files on disk, because models that answered in
            # prose instead of the requested JSON were counted as successes.
            # Failing here makes the gap visible and lets the step be retried.
            raise RuntimeError(
                f"{worker.model} returned prose instead of a file map, so nothing "
                f"was written. First 200 chars: {(r.content or '')[:200]!r}")

        conv = Conversation()
        conv.add_user_message(prompt)
        result = run_agent_loop(
            conversation=conv,
            provider=session.provider,
            tool_registry=session.effective_registry(),
            tool_context=session.context,
            max_turns=12,
            stream=False,
            verbose=False,
        )
        return result.response_text or ""

    return run_step


class PlanRequest(BaseModel):
    goal: str
    force: bool = False


@app.post("/api/plan")
def make_plan(req: PlanRequest):
    """Decide whether a request needs breaking up, and produce the steps."""
    from ..local.planner import should_plan

    session = get_session()
    if session.running():
        raise HTTPException(409, "a request is already in flight")

    needed, score, why = should_plan(req.goal)
    if not needed and not req.force:
        return {"needed": False, "score": score, "reasons": why}

    session.busy = True
    session.worker = _SYNC_HOLDER      # no thread to ask; say so explicitly
    try:
        plan = _plan_with_model(session, req.goal)
    finally:
        session.busy = False
        session.worker = None

    cfg = None
    try:
        cfg = load_config()
    except ConfigError:
        pass
    try:
        key = (get_provider_config("openrouter") or {}).get("api_key")
    except Exception:
        key = None

    from ..local.orchestrator import build_workers

    workers = build_workers(cfg, key)
    CURRENT_RUN["plan"] = plan
    CURRENT_RUN["workers"] = workers
    return {
        "needed": True, "score": score, "reasons": why,
        "plan": plan.to_dict(),
        "workers": [{"name": w.name, "kind": w.kind, "model": w.model} for w in workers],
    }


@app.post("/api/plan/run")
async def run_plan():
    """Execute the current plan, streaming step updates."""
    from ..local.orchestrator import Orchestrator

    session = get_session()
    plan = CURRENT_RUN.get("plan")
    workers = CURRENT_RUN.get("workers")
    if plan is None or not workers:
        raise HTTPException(400, "no plan prepared")
    if session.running():
        raise HTTPException(409, "a request is already in flight")

    events: "queue.Queue[Optional[dict]]" = queue.Queue()
    session.busy = True

    # Same trap as /api/chat: nothing clears `busy` if we raise before the
    # worker starts, and building the orchestrator can raise.
    try:
        orch = Orchestrator(plan, workers, _make_step_runner(session),
                            on_event=lambda p: events.put(p),
                            workspace=session.workspace)
    except BaseException:
        session.busy = False
        raise
    CURRENT_RUN["orch"] = orch

    def worker() -> None:
        try:
            state = orch.run()
            events.put({"type": "plan_done", "state": state.to_dict()})
        except Exception as exc:
            events.put({"type": "error", "data": str(exc)})
        finally:
            session.busy = False
            CURRENT_RUN["orch"] = None
            events.put(None)

    session.worker = threading.Thread(target=worker, daemon=True)
    session.worker.start()

    async def stream():
        loop = asyncio.get_running_loop()
        while True:
            item = await loop.run_in_executor(None, events.get)
            if item is None:
                break
            yield _sse(item)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@app.post("/api/plan/stop")
def stop_plan():
    orch = CURRENT_RUN.get("orch")
    if orch is None:
        return {"ok": True, "running": False}
    orch.cancel()
    return {"ok": True, "running": True}


# -- slash commands ---------------------------------------------------------

COMMANDS = [
    {"name": "help", "args": "", "help": "List these commands"},
    {"name": "clear", "args": "", "help": "Start a new chat"},
    {"name": "cost", "args": "", "help": "Tokens used this session"},
    {"name": "tier", "args": "[name]", "help": "Pin a model, or clear the pin"},
    {"name": "profile", "args": "[name]", "help": "Switch resource profile"},
    {"name": "cloud", "args": "[off|manual|auto]", "help": "Cloud policy, or arm one request"},
    {"name": "openrouter", "args": "[free|mixed]", "help": "OpenRouter cost mode"},
    {"name": "tools", "args": "", "help": "Which tools are on"},
    {"name": "compact", "args": "", "help": "Summarise and shorten this chat"},
]


@app.get("/api/commands")
def list_commands():
    return {"commands": COMMANDS}


class CommandRequest(BaseModel):
    line: str


@app.post("/api/command")
def run_command(req: CommandRequest):
    """Execute a slash command and return text to show in the transcript."""
    session = get_session()
    raw = req.line.strip().lstrip("/")
    name, _, args = raw.partition(" ")
    name, args = name.lower(), args.strip()

    try:
        cfg = load_config()
    except ConfigError:
        cfg = None

    if name == "help":
        return {"text": "\n".join(
            f"/{c['name']} {c['args']}".ljust(28) + c["help"] for c in COMMANDS)}

    if name == "clear":
        session.reset()
        session.tokens_in = session.tokens_out = session.turns = 0
        return {"text": "New chat started.", "clear": True}

    if name == "cost":
        return {"text":
            f"This session\n"
            f"  turns        {session.turns}\n"
            f"  input tokens {session.tokens_in:,}\n"
            f"  output       {session.tokens_out:,}\n"
            f"  cost         $0.00 — everything ran on your GPU"}

    if name == "tier":
        router = getattr(session.provider, "router", None)
        if router is None:
            return {"text": "The local ladder is not active."}
        try:
            router.force_tier(args or None)
        except ValueError as exc:
            return {"text": str(exc)}
        return {"text": f"Pinned to {args}." if args else "Automatic model selection."}

    if name == "profile":
        if not cfg:
            return {"text": "No local config."}
        if not args:
            return {"text": "Profiles: " + ", ".join(sorted(cfg.profiles)) +
                            f"\nActive: {cfg.profile.name}"}
        from ..local.config_writer import ConfigEditor, ConfigWriteError
        try:
            ConfigEditor(cfg.stack_dir).set_active_profile(args)
        except ConfigWriteError as exc:
            return {"text": str(exc)}
        _reload_after_change()
        return {"text": f"Profile set to {args}."}

    if name == "cloud":
        router = getattr(session.provider, "router", None)
        if router is None:
            return {"text": "The local ladder is not active."}
        if args in ("off", "manual", "auto"):
            router.set_cloud_policy(args)
            return {"text": f"Cloud policy: {args}."}
        try:
            router.arm_cloud()
        except Exception as exc:
            return {"text": str(exc)}
        free = cfg.cloud.is_free_only if cfg else False
        return {"text": f"Next message goes to {cfg.cloud.model if cfg else 'the cloud'}." +
                        ("\nCost mode is free-only, so this cannot cost money." if free else
                         "\nThis will spend money.")}

    if name == "openrouter":
        if not cfg:
            return {"text": "No local config."}
        if args in ("free", "mixed"):
            from ..local.config_writer import ConfigEditor
            mode = "free_only" if args == "free" else "mixed"
            ConfigEditor(cfg.stack_dir).set_cloud({"cost_mode": mode})
            _reload_after_change()
            return {"text": f"OpenRouter cost mode: {mode}." +
                    ("" if mode == "free_only" else "\nPaid models are now allowed.")}
        return {"text": f"OpenRouter cost mode is {cfg.cloud.cost_mode}."}

    if name == "tools":
        on = [s.name for s in session.registry.list_specs()
              if s.name not in session.disabled_tools]
        off = sorted(session.disabled_tools)
        text = f"{len(on)} tools on"
        if off:
            text += f", {len(off)} off: " + ", ".join(off)
        return {"text": text}

    if name == "compact":
        n = len(session.conversation.messages)
        if n < 4:
            return {"text": "Not enough history to compact."}
        keep = session.conversation.messages[-4:]
        session.conversation.messages = list(keep)
        return {"text": f"Compacted {n} messages down to {len(keep)}."}

    return {"text": f"Unknown command /{name}. Try /help."}


class WorkspaceRequest(BaseModel):
    path: str


@app.post("/api/workspace")
def set_workspace(req: WorkspaceRequest):
    """Point the agent at a different folder. A desktop app has no launch
    directory, so this is how a project is chosen."""
    global SESSION, WORKSPACE
    path = Path(req.path).expanduser()
    if not path.is_dir():
        raise HTTPException(400, f"not a folder: {path}")
    session = get_session()
    if session.running():
        raise HTTPException(409, "finish the current request first")

    WORKSPACE = path.resolve()
    # Keep the provider (and any loaded model) but re-root the tools, so
    # switching folders does not cost a 20s model reload.
    session.workspace = WORKSPACE
    session.context = ToolContext(workspace_root=WORKSPACE, cwd=WORKSPACE)
    session.reset()
    return {"ok": True, "workspace": str(WORKSPACE)}


# -- sessions ---------------------------------------------------------------

SESSIONS_DIR = Path.home() / ".clawd" / "ui-sessions"


def _session_file(name: str) -> Path:
    safe = "".join(c for c in name if c.isalnum() or c in "-_")[:64]
    if not safe:
        raise HTTPException(400, "invalid session name")
    return SESSIONS_DIR / f"{safe}.json"


@app.get("/api/sessions")
def list_sessions():
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    session = get_session()
    out = []
    for p in sorted(SESSIONS_DIR.glob("*.json"), key=lambda f: -f.stat().st_mtime):
        try:
            data = json.loads(p.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        workspace = data.get("workspace", "")
        out.append({
            "id": p.stem,
            "title": data.get("title") or p.stem,
            "workspace": workspace,
            # The sidebar groups by project, and a full path is too long to
            # read at 244px. The folder name is what distinguishes them.
            "project": Path(workspace).name if workspace else "",
            "model": data.get("model", "auto"),
            "messages": len(data.get("messages", [])),
            "saved_at": data.get("saved_at") or p.stat().st_mtime,
            "active": p.stem == session.session_id,
        })
    return {"sessions": out[:80], "current": session.session_id}


@app.post("/api/sessions/new")
def new_session():
    """Start a fresh chat, leaving the current one saved and listed."""
    session = get_session()
    if session.running():
        raise HTTPException(409, "finish the current request first")
    _autosave(session)
    session.reset()
    session.session_id = uuid.uuid4().hex[:12]
    session.title = ""
    session.tokens_in = session.tokens_out = session.turns = 0
    return {"ok": True, "id": session.session_id}


class SaveRequest(BaseModel):
    id: str
    title: Optional[str] = None


def _serialise_messages(conv: Conversation) -> list[dict]:
    out = []
    for m in conv.messages:
        content = m.content
        if not isinstance(content, str):
            try:
                content = json.dumps(content, default=str)
            except (TypeError, ValueError):
                content = str(content)
        out.append({"role": m.role, "content": content})
    return out


def _derive_title(msgs: list[dict]) -> str:
    """Name a chat after its opening request.

    The first user message is the only thing available at the moment a session
    becomes worth listing, and asking a model to summarise it would cost a
    round trip per chat for a string nobody reads closely. Strip the machinery
    the UI appends -- attachment listings and pasted paths -- so the title is
    the question, not the plumbing.
    """
    first = next((m["content"] for m in msgs if m["role"] == "user"), "")
    first = first.split("\n\nAttached files")[0].strip()
    first = re.sub(r"\s+", " ", first)
    if not first:
        return "Untitled"
    return first[:58].rstrip() + "…" if len(first) > 58 else first


def _autosave(session: Session) -> None:
    """Persist the current chat after every turn.

    Saving explicitly was the previous behaviour, which meant the sidebar only
    ever held sessions the user thought to keep -- and losing an hour of work
    to a crash was a matter of course rather than an accident.
    """
    try:
        msgs = _serialise_messages(session.conversation)
        if not msgs:
            return
        if not session.title:
            session.title = _derive_title(msgs)
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        _session_file(session.session_id).write_text(
            json.dumps({
                "title": session.title,
                "workspace": str(session.workspace),
                "model": session.model_spec,
                "messages": msgs,
                "saved_at": time.time(),
            }, indent=1),
            "utf-8",
        )
    except (OSError, ValueError, HTTPException):
        # Autosave is a convenience. A failure here must not take down the
        # turn that just succeeded.
        pass


@app.post("/api/sessions/save")
def save_session(req: SaveRequest):
    session = get_session()
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    msgs = _serialise_messages(session.conversation)
    title = req.title or _derive_title(msgs)
    _session_file(req.id).write_text(
        json.dumps({
            "title": title,
            "workspace": str(session.workspace),
            "model": session.model_spec,
            "messages": msgs,
            "saved_at": time.time(),
        }, indent=1),
        "utf-8",
    )
    return {"ok": True, "id": req.id, "title": title}


@app.get("/api/sessions/{sid}")
def load_session(sid: str):
    p = _session_file(sid)
    if not p.is_file():
        raise HTTPException(404, "no such session")
    data = json.loads(p.read_text("utf-8"))
    session = get_session()
    if session.running():
        raise HTTPException(409, "finish the current request first")

    # Save what is on screen before replacing it, or switching sessions is a
    # way to lose the one you were in.
    _autosave(session)

    session.reset()
    session.session_id = sid
    session.title = data.get("title", "")
    for m in data.get("messages", []):
        session.conversation.add_message(m["role"], m["content"])

    # Restore the model this chat was using, so a session pinned to a cloud
    # model does not silently resume on the local ladder.
    spec = data.get("model") or "auto"
    try:
        _apply_model_spec(session, spec)
        session.model_spec = spec
    except HTTPException:
        session.model_spec = "auto"

    return {"ok": True, **data}


@app.delete("/api/sessions/{sid}")
def delete_session(sid: str):
    p = _session_file(sid)
    if p.is_file():
        p.unlink()
    return {"ok": True}


# ---------------------------------------------------------------------------
# models, uploads and generative media
# ---------------------------------------------------------------------------


@app.get("/api/models/catalog")
def model_catalog():
    """Every model the picker can offer, local and remote, in one list.

    OpenRouter failures are reported rather than raised: losing the network
    should grey out the cloud section, not break the picker for local tiers.
    """
    session = get_session()
    out: dict[str, Any] = {"current": session.model_spec, "local": [],
                           "free": [], "paid": [], "vision": []}

    try:
        cfg = load_config()
        out["local"] = [
            {
                "id": f"local:{name}",
                "label": name,
                "detail": f"{tier.device}, {tier.context // 1024}k ctx",
                "model": tier.file,
            }
            for name, tier in cfg.tiers.items()
            if tier.serve
        ]
        out["cost_mode"] = cfg.cloud.cost_mode
    except ConfigError as exc:
        out["config_error"] = str(exc)

    try:
        from ..local.openrouter import ModelCatalog

        cfg = load_config()
        catalog = ModelCatalog(cache_dir=cfg.stack_dir)

        def shape(m) -> dict:
            return {
                "id": f"openrouter:{m.id}",
                "label": m.name,
                "detail": f"{m.context_length // 1000}k ctx · {m.price_summary}",
                "free": m.is_free,
                "vision": "image" in m.input_modalities,
            }

        out["free"] = [shape(m) for m in catalog.free_models()]
        # The paid roster is ~500 models; the picker filters client-side, but
        # shipping all of them makes the payload multi-megabyte for no gain.
        out["paid"] = [shape(m) for m in catalog.paid_models()[:400]]
        out["vision"] = [m["id"] for m in out["free"] + out["paid"] if m["vision"]]
    except Exception as exc:
        out["cloud_error"] = str(exc)

    return out


@app.get("/api/free-providers")
def free_providers():
    """The opt-in free lane: who is available, who is on, who is cooling down."""
    from ..local.free_providers import PROVIDERS

    session = get_session()
    router = getattr(session.provider, "router", None)
    status = router.free_lane.status() if router is not None else [
        p.as_dict() for p in PROVIDERS
    ]

    fast = {"enabled": False, "roles": []}
    try:
        cfg = load_config()
        fast = {"enabled": cfg.fast_roles.enabled, "roles": list(cfg.fast_roles.roles)}
    except ConfigError:
        pass
    return {"providers": status, "fast_roles": fast}


class FreeProviderRequest(BaseModel):
    id: str
    enabled: Optional[bool] = None
    api_key: Optional[str] = None


@app.post("/api/free-providers")
def set_free_provider(req: FreeProviderRequest):
    from ..config import load_config as load_app_config, save_config
    from ..local.free_providers import by_id

    provider = by_id(req.id)
    if provider is None:
        raise HTTPException(400, f"unknown provider {req.id!r}")

    config = load_app_config()
    entry = config.setdefault("providers", {}).setdefault(req.id, {})
    if req.api_key is not None:
        entry["api_key"] = req.api_key.strip()
    if req.enabled is not None:
        if req.enabled and not (req.api_key or provider.key()):
            raise HTTPException(400, f"{provider.label} needs an API key first")
        entry["enabled"] = bool(req.enabled)
    entry.setdefault("base_url", provider.base_url)
    entry.setdefault("default_model", provider.models[0])
    save_config(config)

    # Never echo the key back: this response lands in the browser's network log.
    return {"ok": True, **by_id(req.id).as_dict()}


class FastRolesRequest(BaseModel):
    enabled: bool


@app.post("/api/free-providers/fast-roles")
def set_fast_roles(req: FastRolesRequest):
    """Turn the fast lane on or off, preserving the file's comments."""
    from ..local.config_writer import ConfigWriteError

    try:
        editor = _editor()
        raw = editor.load()
        raw.setdefault("fast_roles", {})["enabled"] = bool(req.enabled)
        editor.save(raw)
    except (ConfigWriteError, KeyError, AttributeError) as exc:
        raise HTTPException(400, f"cannot update fast_roles: {exc}") from exc

    _reload_after_change()
    return {"ok": True, "enabled": req.enabled}


class TurnSettingsRequest(BaseModel):
    permission_mode: Optional[str] = None
    effort: Optional[str] = None


@app.get("/api/turn-settings")
def get_turn_settings():
    session = get_session()
    return {
        "permission_mode": session.permission_mode,
        "effort": session.effort,
        "modes": PERMISSION_MODES,
        "mode_label": PERMISSION_MODES[session.permission_mode]["label"],
        "effort_label": EFFORT_LABELS[session.effort],
        "efforts": {
            k: {"label": EFFORT_LABELS[k],
                "detail": f"up to {v:,} tokens" if v else "the tier's own limit"}
            for k, v in EFFORT_TOKENS.items()
        },
    }


@app.post("/api/turn-settings")
def set_turn_settings(req: TurnSettingsRequest):
    session = get_session()
    if req.permission_mode is not None:
        if req.permission_mode not in PERMISSION_MODES:
            raise HTTPException(400, f"unknown mode {req.permission_mode!r}")
        session.permission_mode = req.permission_mode
        _apply_permission_mode(session)
    if req.effort is not None:
        if req.effort not in EFFORT_TOKENS:
            raise HTTPException(400, f"unknown effort {req.effort!r}")
        session.effort = req.effort
    return {"ok": True, "permission_mode": session.permission_mode,
            "effort": session.effort}


class ModelRequest(BaseModel):
    spec: str


@app.post("/api/model")
def set_model(req: ModelRequest):
    session = get_session()
    result = _apply_model_spec(session, req.spec)
    session.model_spec = req.spec
    return {"ok": True, **result}


class UploadRequest(BaseModel):
    name: str
    # data: URI from the browser's FileReader. Base64 over JSON avoids adding
    # python-multipart just for this one route.
    data: str


@app.post("/api/upload")
def upload(req: UploadRequest):
    import base64
    import uuid as _uuid

    header, _, payload = req.data.partition(",")
    if not payload or not header.startswith("data:"):
        raise HTTPException(400, "expected a data: URI")
    try:
        blob = base64.b64decode(payload)
    except Exception as exc:
        raise HTTPException(400, f"undecodable payload: {exc}") from exc
    if len(blob) > 24 * 1024 * 1024:
        raise HTTPException(413, "file is larger than 24MB")

    suffix = Path(req.name).suffix.lower() or ".bin"
    safe = f"{_uuid.uuid4().hex[:10]}{suffix}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / safe).write_bytes(blob)

    kind = "image" if suffix in (".png", ".jpg", ".jpeg", ".gif", ".webp") else (
        "video" if suffix in (".mp4", ".webm", ".mov") else "file")
    return {"name": safe, "original": req.name, "kind": kind,
            "url": f"/api/upload/{safe}", "bytes": len(blob)}


@app.get("/api/upload/{name}")
def serve_upload(name: str):
    path = UPLOAD_DIR / Path(name).name
    if not path.is_file():
        raise HTTPException(404, "no such upload")
    return FileResponse(path)


def _job_store():
    """The process-wide media store, shared with the agent's GenerateImage tool.

    Same reason as _pixel_studio: a second store would mean images made from
    chat never showing up in the Media tab.
    """
    from ..media.fal import store

    return store()


@app.get("/api/media/models")
def media_models():
    from ..media.fal import CATALOG, POLLINATIONS_MODELS, TASKS, fal_key

    has_key = bool(fal_key())
    return {
        "tasks": list(TASKS),
        # Pollinations needs no key, so it is listed either way -- that is the
        # point of it being here.
        "models": [m.as_dict() for m in POLLINATIONS_MODELS + CATALOG],
        "has_key": has_key,
        # The key prompt is only worth showing when nothing at all would work.
        "needs_key": False,
    }


class MediaKeyRequest(BaseModel):
    key: str


@app.post("/api/media/key")
def set_media_key(req: MediaKeyRequest):
    from ..config import set_api_key

    key = req.key.strip()
    if not key:
        raise HTTPException(400, "empty key")
    set_api_key("fal", key)
    # Deliberately not echoed back -- the response goes into the browser
    # devtools network log, and a key does not belong there.
    return {"ok": True}


class MediaRequest(BaseModel):
    model: str
    task: str
    prompt: str
    params: dict = {}
    # Name of a previously uploaded image, for the image-to-* tasks.
    image: Optional[str] = None


@app.post("/api/media/generate")
def media_generate(req: MediaRequest):
    from ..media.fal import (build_payload, fal_key, find_model,
                             is_pollinations, to_data_uri)

    key = fal_key()
    if not key and not is_pollinations(req.model):
        raise HTTPException(
            400,
            "no fal API key. Add one in Settings, or set FAL_KEY in your "
            "environment — or pick a Pollinations model, which needs no key.",
        )
    if not req.prompt.strip():
        raise HTTPException(400, "a prompt is required")

    image_uri = None
    if req.image:
        path = UPLOAD_DIR / Path(req.image).name
        if not path.is_file():
            raise HTTPException(400, f"no uploaded image named {req.image!r}")
        image_uri = to_data_uri(path)
    elif req.task in ("image-to-image", "image-to-video"):
        raise HTTPException(400, f"{req.task} needs a source image")

    model = find_model(req.model)
    payload = build_payload(model, req.model, req.prompt, req.params, image_uri)
    job = _job_store().submit(req.model, req.task, req.prompt, payload, key)
    return job.as_dict()


# ---------------------------------------------------------------------------
# pixel art
# ---------------------------------------------------------------------------

def _pixel_studio():
    """The process-wide studio, shared with the agent's GeneratePixelArt tool.

    Kept as a function rather than inlined at the call sites so the ownership
    of the singleton stays in one place -- src/media/pixel_jobs.studio().
    """
    from ..media.pixel_jobs import studio

    return studio()


_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)

# A reasoning model spends tokens thinking before it writes anything visible.
# The first version of this asked for 120 and got back an empty string with
# finish_reason "length" -- the whole budget went on reasoning and nothing was
# left to answer with. Empty, not short, which is the same failure clawd-local
# already records for the main loop. Ask for enough that the answer fits after
# the thinking.
DESIGN_TOKENS = 700


def _design_brief(brief: str) -> tuple[str, str]:
    """Expand a few words into a fixed character description.

    Returns (design, note). The note is surfaced in the job log, because a
    silent empty design is what let four knights come back holding four
    different weapons with nothing in the UI to explain why.

    Runs on whatever the model picker is set to -- the local ladder by default.
    This is the job an LLM is genuinely good at here: eight views only look
    like one character if every prompt carries the same concrete details, and
    inventing those details consistently is not something a diffusion model
    does on its own.
    """
    session = get_session()
    prompt = (
        "Art-direct a pixel art sprite. Reply with ONE sentence of at most 40 "
        "words describing this character's fixed visual design so an artist "
        "could draw it from any angle: colours, silhouette, clothing, weapon, "
        "and one distinguishing feature. No preamble, no lists, no thinking "
        "out loud.\n\n"
        f"Character: {brief}"
    )
    try:
        response = session.provider.chat(
            [{"role": "user", "content": prompt}],
            role="summarize", max_tokens=DESIGN_TOKENS,
        )
    except Exception as exc:
        return "", f"art direction failed ({type(exc).__name__}); using the brief as written"

    text = _THINK_BLOCK.sub("", response.content or "").strip()
    if not text:
        reason = getattr(response, "finish_reason", "?")
        return "", (f"art direction returned nothing (finish_reason={reason}); "
                    f"using the brief as written")

    # A model that ignores the word limit produces a prompt so long the sprite
    # instructions get lost behind it; clip rather than trust.
    words = text.split()
    return " ".join(words[:60]), f"design brief: {len(words)} words"


@app.get("/api/pixel/options")
def pixel_options():
    from ..media.pixel_jobs import FLUX_LORA_MODEL
    from ..media.pixelart import (ANIMATIONS, DIRECTIONS, PALETTES,
                                  PIXEL_LORAS, SIZES)
    from ..media.fal import fal_key

    return {
        "loras": [l.as_dict() for l in PIXEL_LORAS],
        "sizes": sorted(SIZES.values()),
        "palettes": sorted(PALETTES.values()),
        "animations": {k: v["frames"] for k, v in ANIMATIONS.items()},
        "directions": list(DIRECTIONS),
        "backends": (["fal"] if fal_key() else []) + ["pollinations"],
        "has_key": bool(fal_key()),
        "model": FLUX_LORA_MODEL,
    }


class PixelRequest(BaseModel):
    kind: str = "sprite"           # sprite | rotation | animation
    brief: str
    # Optional because null is a reasonable thing for a client to send for "no
    # LoRA" -- the picker offers exactly that. Typed `str`, it was a 422 with a
    # validation blob instead of a sprite.
    lora: Optional[str] = "retro"
    grid: int = 64
    palette: int = 24
    backend: str = "fal"
    action: str = "walk"
    directions: int = 8
    # Whether to spend a model call writing the shared design brief.
    art_direct: bool = True
    # Fix the seed to reproduce a result, or vary it deliberately. Left unset,
    # the studio picks one and records it on the job, so anything you liked can
    # be asked for again.
    seed: Optional[int] = None


@app.post("/api/pixel/generate")
def pixel_generate(req: PixelRequest):
    from ..media.fal import fal_available, fal_key

    if not req.brief.strip():
        raise HTTPException(400, "describe what to draw")
    if req.kind not in ("sprite", "rotation", "animation"):
        raise HTTPException(400, f"unknown kind {req.kind!r}")

    key = fal_key()
    backend = req.backend
    # Not `if not key`: a key that fal has already refused is worse than no key
    # at all, because the job submits, waits, fails and only then falls back --
    # about twenty-five seconds to learn what the last job already found out.
    if backend == "fal" and not fal_available():
        backend = "pollinations"

    job = _pixel_studio().submit(
        req.kind, req.brief, lora=req.lora, grid=req.grid, palette=req.palette,
        backend=backend, action=req.action, directions=req.directions,
        key=key, describe=_design_brief if req.art_direct else None,
        seed=req.seed,
    )
    return job.as_dict()


@app.get("/api/pixel/jobs")
def pixel_jobs():
    return {"jobs": _pixel_studio().list()}


@app.post("/api/pixel/jobs/{job_id}/cancel")
def pixel_cancel(job_id: str):
    return {"ok": _pixel_studio().cancel(job_id)}


@app.get("/api/pixel/file/{folder}/{name}")
def pixel_file(folder: str, name: str):
    from ..media.pixel_jobs import pixel_root

    path = pixel_root() / Path(folder).name / Path(name).name
    if not path.is_file():
        raise HTTPException(404, "no such file")
    return FileResponse(path)


class PixelRepostRequest(BaseModel):
    folder: str
    name: str
    grid: int = 64
    palette: int = 24
    background: str = "transparent"


@app.post("/api/pixel/requantise")
def pixel_requantise(req: PixelRepostRequest):
    """Re-run the post-processing at a different grid or palette.

    Cheap and instant -- no model involved -- so trying 32x32 against 64x64, or
    16 colours against 32, costs nothing and is the fastest way to find what a
    sprite should be.
    """
    from ..media.pixel_jobs import pixel_root
    from ..media.pixelart import PixelError, quantise_to_sprite

    folder = pixel_root() / Path(req.folder).name
    source = folder / Path(req.name).name
    if not source.is_file():
        raise HTTPException(404, "no such frame")
    dest = folder / f"{source.stem}-{req.grid}x{req.palette}.png"
    try:
        info = quantise_to_sprite(source, dest, grid=req.grid,
                                  palette=req.palette, upscale=6,
                                  background=req.background)
    except PixelError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {**info, "dir": folder.name}


@app.get("/api/media/jobs")
def media_jobs():
    return {"jobs": _job_store().list()}


@app.post("/api/media/jobs/{job_id}/cancel")
def media_cancel(job_id: str):
    return {"ok": _job_store().cancel(job_id)}


@app.get("/api/media/file/{name}")
def media_file(name: str):
    from ..media.fal import media_root

    path = media_root() / Path(name).name
    if not path.is_file():
        raise HTTPException(404, "no such file")
    return FileResponse(path)


class MediaSaveRequest(BaseModel):
    file: str
    directory: str = "media"


@app.post("/api/media/save")
def media_save(req: MediaSaveRequest):
    """Copy a generation into the workspace.

    Generations live outside the project by default (see media_root), so this
    is the explicit step that puts one somewhere the user's git repo can see.
    """
    import shutil

    from ..media.fal import media_root

    source = media_root() / Path(req.file).name
    if not source.is_file():
        raise HTTPException(404, "no such file")

    session = get_session()
    target_dir = (session.workspace / req.directory).resolve()
    if not str(target_dir).startswith(str(session.workspace.resolve())):
        raise HTTPException(400, "target escapes the workspace")
    target_dir.mkdir(parents=True, exist_ok=True)

    target = target_dir / source.name
    shutil.copy2(source, target)
    return {"ok": True, "path": str(target)}


def _safe_workspace_path(raw: str) -> Path:
    """Resolve a path and refuse anything outside the workspace."""
    session = get_session()
    root = session.workspace.resolve()
    candidate = Path(raw)
    full = (candidate if candidate.is_absolute() else root / candidate).resolve()
    try:
        full.relative_to(root)
    except ValueError:
        raise HTTPException(400, "path is outside the workspace") from None
    return full


# Files above this open read-only. Loading a 40MB minified bundle into a
# textarea locks the renderer, and it is not a file anyone edits by hand.
MAX_EDIT_BYTES = 1_500_000


@app.get("/api/file")
def read_file(path: str):
    full = _safe_workspace_path(path)
    if not full.is_file():
        raise HTTPException(404, "no such file")

    size = full.stat().st_size
    suffix = full.suffix.lower()
    if suffix in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf",
                  ".mp4", ".webm", ".mov"):
        return {"path": str(full), "kind": "media", "size": size,
                "url": f"/api/file/raw?path={urllib.parse.quote(str(full))}"}

    if size > MAX_EDIT_BYTES:
        return {"path": str(full), "kind": "too_big", "size": size}

    try:
        content = full.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return {"path": str(full), "kind": "binary", "size": size}
    return {"path": str(full), "kind": "text", "size": size, "content": content}


@app.get("/api/file/raw")
def read_file_raw(path: str):
    full = _safe_workspace_path(path)
    if not full.is_file():
        raise HTTPException(404, "no such file")
    return FileResponse(full)


class FileWriteRequest(BaseModel):
    path: str
    content: str


@app.post("/api/file")
def write_file(req: FileWriteRequest):
    """Save a hand edit from the file pane.

    Deliberately does NOT run the write guard. That guard exists to catch the
    ways *models* corrupt files -- echoed line numbers, escaped newlines,
    wholesale truncation. A person deleting most of a file has decided to, and
    refusing them is just an obstacle.
    """
    full = _safe_workspace_path(req.path)
    if not full.parent.is_dir():
        raise HTTPException(400, "the containing folder does not exist")

    # Browsers normalise a textarea's value to LF regardless of what was loaded
    # into it, so writing it back verbatim silently converts a CRLF file and
    # produces a whole-file diff out of a one-line edit. Restore whatever the
    # file already used.
    content = req.content.replace("\r\n", "\n")
    if full.is_file():
        try:
            existing = full.read_bytes()
            if b"\r\n" in existing:
                content = content.replace("\n", "\r\n")
        except OSError:
            pass

    full.write_bytes(content.encode("utf-8"))
    return {"ok": True, "path": str(full), "size": full.stat().st_size}


_PREVIEW: Any = None


def _preview():
    global _PREVIEW
    if _PREVIEW is None:
        from .preview import PreviewManager

        _PREVIEW = PreviewManager()
    return _PREVIEW


@app.get("/api/preview/configs")
def preview_configs():
    """What this project can run, from .claude/launch.json."""
    from .preview import PreviewError, default_config_text, read_configs

    session = get_session()
    try:
        configs = read_configs(session.workspace)
    except PreviewError as exc:
        raise HTTPException(400, str(exc)) from exc

    return {
        "configs": configs,
        "running": _preview().status(),
        # Offered as a starting point when there is no config. Deliberately not
        # written or run on its own -- guessing a start command means running
        # an arbitrary command in someone's repository.
        "suggestion": None if configs else default_config_text(session.workspace),
        "path": str(session.workspace / ".claude" / "launch.json"),
    }


class PreviewStartRequest(BaseModel):
    name: str


@app.post("/api/preview/start")
def preview_start(req: PreviewStartRequest):
    from .preview import PreviewError, read_configs

    session = get_session()
    configs = read_configs(session.workspace)
    config = next((c for c in configs if c["name"] == req.name), None)
    if config is None:
        raise HTTPException(404, f"no configuration named {req.name!r}")
    try:
        server = _preview().start(config, session.workspace)
    except PreviewError as exc:
        raise HTTPException(400, str(exc)) from exc
    return server.as_dict()


@app.post("/api/preview/stop")
def preview_stop(req: PreviewStartRequest):
    return {"ok": _preview().stop(req.name)}


@app.get("/api/preview/status")
def preview_status():
    return {"running": _preview().status()}


class PreviewConfigWrite(BaseModel):
    content: str


@app.post("/api/preview/configs")
def preview_write_config(req: PreviewConfigWrite):
    """Save a launch.json the user has reviewed."""
    session = get_session()
    try:
        json.loads(req.content)
    except ValueError as exc:
        raise HTTPException(400, f"not valid JSON: {exc}") from exc
    path = session.workspace / ".claude" / "launch.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(req.content, encoding="utf-8")
    return {"ok": True, "path": str(path)}


@app.websocket("/ws/terminal")
async def terminal_ws(ws: WebSocket):
    """A real shell in the dock, rooted at the current workspace."""
    await ws.accept()
    from .terminal import serve

    await serve(ws, str(get_session().workspace))


@app.post("/api/reset")
def reset():
    get_session().reset()
    return {"ok": True}


@app.post("/api/shutdown")
def shutdown():
    """Release GPU memory. Called by the launcher on close."""
    session = get_session()
    if hasattr(session.provider, "shutdown"):
        session.provider.shutdown()
    return {"ok": True}


@app.get("/")
def index():
    # no-store, because the UI is edited in place during development and a
    # cached shell against a restarted server is a confusing way to lose an
    # afternoon.
    return FileResponse(
        STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"}
    )


# The stylesheet and script are separate files rather than one inlined blob, so
# they need serving. Mounted last so it cannot shadow an /api route.
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def main(host: str = "127.0.0.1", port: int = 8765, workspace: Optional[str] = None) -> None:
    global WORKSPACE, _LOOPBACK_ONLY
    if workspace:
        WORKSPACE = Path(workspace).resolve()
    _LOOPBACK_ONLY = host in ("127.0.0.1", "::1", "localhost")
    import uvicorn

    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(prog="clawd-ui")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--workspace", default=None, help="folder the agent works in")
    ns = ap.parse_args()
    main(ns.host, ns.port, ns.workspace)
