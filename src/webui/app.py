"""Standalone desktop app shell for Clawd Code.

Runs the local server in-process on a background thread and shows it in a real
window via the system WebView2 runtime -- no browser chrome, no localhost URL
to type, no bundled Chromium. The window is the app.

Native capabilities the browser cannot offer are exposed to the page through
``Api``: picking a working folder, and closing cleanly so GPU memory is
released rather than leaked to an orphaned llama-server.
"""

from __future__ import annotations

import os
import socket
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

ICON_CANDIDATES = ("assets/clawd.ico", "assets/icon.ico")


def _free_port() -> int:
    """Ask the OS for an unused port, so two instances never collide."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_until_up(url: str, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.15)
    return False


class Api:
    """Methods callable from JavaScript as ``window.pywebview.api.*``."""

    def __init__(self) -> None:
        self.window = None

    def pick_folder(self) -> Optional[str]:
        """Native folder chooser. A desktop app has no launch directory, so
        this is how the user says which project to work on."""
        import webview

        if self.window is None:
            return None
        result = self.window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return None
        return result[0] if isinstance(result, (list, tuple)) else str(result)

    def minimize(self) -> None:
        if self.window is not None:
            self.window.minimize()

    def close(self) -> None:
        if self.window is not None:
            self.window.destroy()


def _ensure_streams() -> None:
    """Give sys.stdout/stderr somewhere to go under pythonw.exe.

    A GUI build of Python has no console, so both are ``None``. Most code never
    notices -- until something builds a logging StreamHandler around them, which
    is exactly what uvicorn does on startup. The handler construction raises,
    the server thread dies before binding, ``_wait_until_up`` times out, and the
    app exits without ever creating a window.

    Symptom, for the next person: launching with python.exe shows the window and
    launching with pythonw.exe silently does nothing. The desktop shortcut uses
    pythonw, to avoid a console flashing on screen, so this is the path that
    matters.
    """
    import sys

    for name in ("stdout", "stderr"):
        if getattr(sys, name, None) is None:
            setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))


def _release_orphaned_vram() -> None:
    """Kill any llama-server left holding VRAM by a previous hard exit.

    Done in-process rather than by the launcher, so the app can be started
    directly from pythonw.exe with no console window anywhere in the chain.
    """
    try:
        from ..local.cli import main as cli_main

        cli_main(["stop", "all"])
    except Exception:
        pass


def main(
    workspace: Optional[str] = None,
    debug: bool = False,
    minimized: bool = False,
) -> None:
    _ensure_streams()

    import webview

    from . import server as srv

    _release_orphaned_vram()
    port = _free_port()
    srv.WORKSPACE = Path(workspace).resolve() if workspace else Path.home()

    def run_server() -> None:
        import uvicorn

        uvicorn.run(srv.app, host="127.0.0.1", port=port, log_level="error")

    threading.Thread(target=run_server, daemon=True).start()

    base = f"http://127.0.0.1:{port}"
    if not _wait_until_up(f"{base}/api/status"):
        raise SystemExit(
            "the local server did not start; run `python -m src.webui` to see the error"
        )

    api = Api()
    repo_root = Path(__file__).resolve().parents[2]
    icon = next(
        (str(repo_root / c) for c in ICON_CANDIDATES if (repo_root / c).is_file()),
        None,
    )

    window = webview.create_window(
        "Clawd Code",
        base,
        js_api=api,
        width=1180,
        height=820,
        min_size=(760, 560),
        # Shown for the instant before the page paints. The UI defaults to the
        # light theme, so a dark value here reads as a flash of the wrong app.
        background_color="#faf9f5",
        text_select=True,
        # Used by the run-at-login shortcut: the app is ready in the taskbar
        # without a window appearing over whatever you are doing at boot.
        minimized=minimized,
    )
    api.window = window

    def on_closing() -> None:
        # Release VRAM rather than leaving an orphaned llama-server holding it,
        # which would stop the next launch with an out-of-memory refusal.
        try:
            urllib.request.urlopen(
                urllib.request.Request(f"{base}/api/shutdown", method="POST"), timeout=10
            )
        except Exception:
            pass

    window.events.closing += on_closing

    kwargs = {"debug": debug}
    if icon:
        kwargs["icon"] = icon
    webview.start(**kwargs)


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(prog="clawd-app", description="Clawd Code desktop app")
    ap.add_argument("--workspace", default=None)
    ap.add_argument("--debug", action="store_true", help="open devtools")
    ap.add_argument("--minimized", action="store_true",
                    help="start in the taskbar rather than on screen (used at login)")
    ns = ap.parse_args()
    main(ns.workspace, ns.debug, ns.minimized)
