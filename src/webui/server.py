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
import threading
import traceback
from dataclasses import dataclass, field
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
    # Tools the user has switched off. Held here rather than in the registry so
    # toggling is reversible without rebuilding from defaults.
    disabled_tools: set = field(default_factory=set)
    tokens_in: int = 0
    tokens_out: int = 0
    turns: int = 0

    def effective_registry(self):
        """The registry minus disabled tools.

        Every tool schema costs prompt tokens on every turn -- roughly 8.4k for
        the full set -- so switching tools off is a real speed lever, not just
        a safety one.
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
    text = None

    if isinstance(out, dict):
        patch = out.get("structuredPatch")
        file_path = out.get("filePath")
        # Keep the payload small: the full original file is not needed to draw
        # a diff, and can be megabytes.
        text = None if patch else json.dumps(
            {k: v for k, v in out.items() if k not in ("originalFile", "structuredPatch")},
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
        "file": file_path,
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
                tool_registry=session.effective_registry(),
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


@app.get("/api/files")
def find_files(q: str = "", limit: int = 25):
    """Files under the workspace matching a fragment, for @-mentions.

    Walks rather than globs so noisy directories can be pruned -- a node_modules
    or a models folder would otherwise swamp every result.
    """
    session = get_session()
    root = session.workspace
    needle = q.lower().strip()
    out = []
    if not root.is_dir():
        return {"files": []}

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if fn.startswith("."):
                continue
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

    # Shallower paths and earlier matches first: a file at the root is far more
    # likely to be the one meant than one buried six levels down.
    out.sort(key=lambda p: (p.count("/"), p.lower().find(needle) if needle else 0, len(p)))
    return {"files": out[:limit]}


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
    if session.busy:
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
    out = []
    for p in sorted(SESSIONS_DIR.glob("*.json"), key=lambda f: -f.stat().st_mtime):
        try:
            data = json.loads(p.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        out.append({
            "id": p.stem,
            "title": data.get("title") or p.stem,
            "workspace": data.get("workspace", ""),
            "messages": len(data.get("messages", [])),
            "saved_at": p.stat().st_mtime,
        })
    return {"sessions": out[:50]}


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


@app.post("/api/sessions/save")
def save_session(req: SaveRequest):
    session = get_session()
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    msgs = _serialise_messages(session.conversation)
    title = req.title
    if not title:
        first = next((m["content"] for m in msgs if m["role"] == "user"), "")
        title = (first[:60] + "…") if len(first) > 60 else (first or "Untitled")
    _session_file(req.id).write_text(
        json.dumps({
            "title": title,
            "workspace": str(session.workspace),
            "messages": msgs,
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
    if session.busy:
        raise HTTPException(409, "finish the current request first")
    session.reset()
    for m in data.get("messages", []):
        session.conversation.add_message(m["role"], m["content"])
    return {"ok": True, **data}


@app.delete("/api/sessions/{sid}")
def delete_session(sid: str):
    p = _session_file(sid)
    if p.is_file():
        p.unlink()
    return {"ok": True}


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
