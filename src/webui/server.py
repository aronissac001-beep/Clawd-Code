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
import queue
import threading
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
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


class ChatRequest(BaseModel):
    message: str


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _tool_event_payload(ev: ToolEvent) -> dict:
    """Flatten a ToolEvent for the browser, trimming oversized output."""
    out = ev.tool_output
    if out is not None and not isinstance(out, (str, int, float, bool)):
        try:
            out = json.dumps(out, default=str)[:4000]
        except (TypeError, ValueError):
            out = str(out)[:4000]
    elif isinstance(out, str):
        out = out[:4000]
    return {
        "type": "tool",
        "kind": ev.kind,
        "name": ev.tool_name,
        "input": ev.tool_input,
        "output": out,
        "is_error": ev.is_error,
        "error": ev.error,
    }


@app.post("/api/chat")
async def chat(req: ChatRequest):
    session = get_session()
    if session.busy:
        raise HTTPException(409, "a request is already in flight")
    if not req.message.strip():
        raise HTTPException(400, "empty message")

    events: "queue.Queue[Optional[dict]]" = queue.Queue()
    session.busy = True
    session.cancel = False
    session.conversation.add_user_message(req.message)

    class _Cancelled(RuntimeError):
        pass

    def on_text(chunk: str) -> None:
        events.put({"type": "text", "data": chunk})

    def on_event(ev: ToolEvent) -> None:
        # The provider sees tool *requests*; only the loop knows the outcome.
        # Feeding results back is what lets escalation notice a failing model.
        if ev.kind in ("tool_result", "tool_error"):
            observe = getattr(session.provider, "observe_tool_result", None)
            if observe is not None:
                observe(not ev.is_error)
        events.put(_tool_event_payload(ev))

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
                tool_registry=session.registry,
                tool_context=session.context,
                max_turns=25,
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
            events.put({
                "type": "done",
                "text": result.response_text,
                "usage": result.usage or {},
                "turns": result.num_turns,
                "route": route,
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
            events.put(None)

    threading.Thread(target=worker, daemon=True).start()

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
        "busy": session.busy,
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
    tool already running finishes first."""
    session = get_session()
    if not session.busy:
        return {"ok": True, "was_busy": False}
    session.cancel = True
    return {"ok": True, "was_busy": True}


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
    return FileResponse(STATIC_DIR / "index.html")


def main(host: str = "127.0.0.1", port: int = 8765, workspace: Optional[str] = None) -> None:
    global WORKSPACE
    if workspace:
        WORKSPACE = Path(workspace).resolve()
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
