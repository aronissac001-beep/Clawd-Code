"""Network authentication for the web UI.

This server runs shell commands and edits files as the logged-in user. Whoever
can reach it can execute code. Until now that was survivable only because it
binds 127.0.0.1 and nothing else: there is no authentication anywhere in the
app, and the permission-mode chip is a UI preference the client chooses, not a
boundary -- an attacker would simply set it to `full`.

So the gate below is the whole security model, and where it sits matters more
than what it checks. Three mechanisms were tried against a replica app before
this one was written:

    FastAPI(dependencies=[Depends(...)])   route 401, StaticFiles mount 200
                                           -- app.mount() appends a raw Mount
                                           that dependency plumbing never sees
    @app.middleware("http")                route 401, WEBSOCKET CONNECTED
                                           -- BaseHTTPMiddleware returns early
                                           for any scope that is not "http"
    pure ASGI class + add_middleware       everything 401, websocket closed

The middle one is the idiomatic-looking choice and it is the dangerous one:
/ws/terminal spawns a PowerShell PTY the moment it is reached, so a gate that
covers sixty JSON routes and misses that one has accomplished nothing.

A pure ASGI class wraps app.router, so it sits in front of every route, the
static mount, the websocket, and every unmatched path.
"""

from __future__ import annotations

import secrets
import urllib.parse
from typing import Optional

from fastapi.responses import JSONResponse

COOKIE_NAME = "clawd_session"

# Names that mean "this machine". A Host header outside this set, in local-only
# mode, is a DNS-rebinding attempt: a page on the internet resolving its own
# domain to 127.0.0.1 so the browser will send it here as same-origin.
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}

# None means no remote access is configured, which is the shipped default and
# behaves exactly as the app always has: loopback only, no token required.
_TOKEN: Optional[str] = None


def load_token() -> Optional[str]:
    """The configured token, or None.

    Deliberately reads the *user* config (src/config.py) rather than the model
    stack's (src/local/config.py) -- server.py already binds the name
    `load_config` to the latter, and confusing the two would silently return
    None and disable the gate.
    """
    try:
        from ..config import load_config as load_user_config

        return ((load_user_config().get("webui") or {}).get("token") or None)
    except Exception:
        return None


def set_token(value: Optional[str]) -> None:
    """Persist a token, or clear it when passed None."""
    from ..config import load_config as load_user_config
    from ..config import save_config

    config = load_user_config()
    webui = dict(config.get("webui") or {})
    if value:
        webui["token"] = value
    else:
        webui.pop("token", None)
    config["webui"] = webui
    save_config(config)
    refresh()


def new_token() -> str:
    """32 bytes of urandom, URL-safe. Long enough that guessing is not a threat
    worth defending against with rate limiting."""
    return secrets.token_urlsafe(32)


def refresh() -> None:
    global _TOKEN
    _TOKEN = load_token()


def configured() -> bool:
    return _TOKEN is not None


def _hostname(value: str) -> str:
    """Authority without the port. Keeps a bracketed IPv6 literal intact."""
    value = value.split("//")[-1]
    if value.startswith("["):
        return value[: value.index("]") + 1]
    return value.split(":")[0]


def _matches(supplied: str) -> bool:
    # Fails closed when no token is set. Without this, compare_digest(b"", b"")
    # is True, so an empty credential would authenticate whenever _TOKEN were
    # None. The gate checks for None before ever calling this, so it is not
    # reachable today -- but it is exactly the shape of hole a later refactor
    # opens by moving one branch.
    if not _TOKEN:
        return False
    # Compared as bytes: compare_digest raises TypeError on a non-ASCII str,
    # and cookie values are attacker-controlled, so comparing str would turn a
    # 401 into a 500.
    return secrets.compare_digest(
        supplied.encode("utf-8", "replace"), _TOKEN.encode("utf-8"))


class AccessGate:
    """Refuses anything that is neither local nor carrying the token."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        kind = scope.get("type")
        if kind not in ("http", "websocket"):
            await self.app(scope, receive, send)      # lifespan
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in scope.get("headers", [])}
        host = _hostname(headers.get("host", ""))
        origin = headers.get("origin", "")

        # A WebSocket handshake is exempt from CORS, so this check is the only
        # thing stopping another page in the browser from opening /ws/terminal
        # and getting a shell. Non-browser callers (clawdctl, the desktop
        # shell) send no Origin and are unaffected.
        if origin and _hostname(origin) != host:
            await self._deny(scope, send, 403, "cross-origin request refused")
            return

        if _TOKEN is None:
            # Local-only mode: what the app has always done, plus a Host check
            # so a rebinding attack cannot reach it through the browser.
            if host not in LOOPBACK_HOSTS:
                await self._deny(
                    scope, send, 403,
                    "remote access is not configured. Run: "
                    "python -m src.webui --set-token")
                return
            await self.app(scope, receive, send)
            return

        # Token configured: everything is checked, loopback included. No local
        # exemption, because a tunnel makes every request look local, and a
        # local bypass would hand unauthenticated access to any process on the
        # machine.
        if self._authorised(headers):
            await self.app(scope, receive, send)
            return

        # First visit carries ?token=... . Swap it for a cookie and redirect to
        # the same path without it. A 303 replaces the history entry, so the
        # tokenised URL never lands in the phone's back stack or autocomplete.
        if kind == "http":
            query = urllib.parse.parse_qs(scope.get("query_string", b"").decode())
            supplied = (query.pop("token", [None]) or [None])[0]
            if supplied and _matches(supplied):
                tail = urllib.parse.urlencode(query, doseq=True)
                location = scope.get("path", "/") + (f"?{tail}" if tail else "")
                response = JSONResponse(status_code=303, content={"ok": True})
                response.headers["location"] = location
                # No Secure flag: this is served over plain HTTP on loopback,
                # with TLS terminated by the tunnel in front of it. A Secure
                # cookie would never be sent back, and a correct token would
                # look broken.
                response.set_cookie(
                    COOKIE_NAME, _TOKEN, httponly=True, samesite="strict",
                    path="/", max_age=60 * 60 * 24 * 365)
                await response(scope, receive, send)
                return

        await self._deny(scope, send, 401, "unauthorised")

    @staticmethod
    def _authorised(headers: dict) -> bool:
        auth = headers.get("authorization", "")
        if auth[:7].lower() == "bearer " and _matches(auth[7:].strip()):
            return True
        # The cookie is not a convenience: the page loads its stylesheet, its
        # script and every <img> from authenticated URLs, and no JavaScript can
        # attach a header to those. It is also how the WebSocket authenticates,
        # since the browser API takes no headers.
        for part in headers.get("cookie", "").split(";"):
            name, _, value = part.strip().partition("=")
            if name == COOKIE_NAME and _matches(value):
                return True
        return False

    @staticmethod
    async def _deny(scope, send, status: int, detail: str) -> None:
        if scope.get("type") == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return

        async def _receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        await JSONResponse(status_code=status, content={"detail": detail})(
            scope, _receive, send)


refresh()
