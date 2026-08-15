"""A real terminal in the dock, over a WebSocket.

Design note worth stating, because the obvious alternative is worse: the VT
emulation runs on the *server*, not in the browser.

The browser-side option is xterm.js, which is excellent and is what Claude Code
uses -- but it is a CDN dependency, and this app is served from localhost by a
Python process that must work with no network. Vendoring 300KB of JavaScript to
render a terminal that pyte already renders correctly in Python is a poor trade.

So: pywinpty spawns a real console process, pyte consumes its output into a
screen buffer, and the socket ships that buffer as a grid of styled runs. The
client draws text and forwards keystrokes. Cursor movement, clearing, scrolling
and colour all resolve server-side, where a tested VT100 implementation already
lives.

The cost is bandwidth -- a full screen per update rather than a delta -- which
at 80x24 is a few KB and entirely acceptable over loopback.
"""

from __future__ import annotations

import asyncio
import os
import queue
import threading
from typing import Any, Optional

DEFAULT_COLS = 100
DEFAULT_ROWS = 28

# Redraws are coalesced: a build spewing output would otherwise send a frame per
# read, and the client cannot usefully paint faster than this anyway.
FRAME_INTERVAL_S = 0.05


def default_shell() -> str:
    if os.name == "nt":
        return os.environ.get("COMSPEC") or "powershell.exe"
    return os.environ.get("SHELL") or "/bin/bash"


class TerminalSession:
    """One PTY plus the screen buffer its output is rendered into."""

    def __init__(self, cwd: str, cols: int = DEFAULT_COLS, rows: int = DEFAULT_ROWS):
        import pyte

        self.cols = max(20, min(cols, 400))
        self.rows = max(5, min(rows, 200))
        self.screen = pyte.Screen(self.cols, self.rows)
        self.stream = pyte.Stream(self.screen)
        self.updates: "queue.Queue[bool]" = queue.Queue()
        self.alive = True
        self._lock = threading.Lock()

        from winpty import PtyProcess

        self.proc = PtyProcess.spawn(
            default_shell(), cwd=cwd, dimensions=(self.rows, self.cols)
        )
        self._reader = threading.Thread(target=self._pump, daemon=True)
        self._reader.start()

    def _pump(self) -> None:
        """Feed PTY output into the screen until the process exits."""
        while self.alive:
            try:
                data = self.proc.read(4096)
            except (EOFError, OSError):
                break
            if not data:
                if not self.proc.isalive():
                    break
                continue
            with self._lock:
                self.stream.feed(data)
            # A bare flag: the consumer reads the whole screen anyway, so
            # queueing the data itself would only risk unbounded growth.
            try:
                self.updates.put_nowait(True)
            except queue.Full:
                pass
        self.alive = False
        try:
            self.updates.put_nowait(True)
        except queue.Full:
            pass

    def write(self, text: str) -> None:
        if self.alive:
            try:
                self.proc.write(text)
            except (OSError, ValueError):
                self.alive = False

    def resize(self, cols: int, rows: int) -> None:
        cols = max(20, min(int(cols), 400))
        rows = max(5, min(int(rows), 200))
        if (cols, rows) == (self.cols, self.rows):
            return
        self.cols, self.rows = cols, rows
        with self._lock:
            self.screen.resize(rows, cols)
        try:
            self.proc.setwinsize(rows, cols)
        except (OSError, ValueError):
            pass

    def snapshot(self) -> dict[str, Any]:
        """The screen as styled runs, one list per row.

        Runs rather than per-character spans: a mostly-uniform line collapses to
        a single entry, which is the difference between a few hundred bytes per
        frame and a few thousand.
        """
        with self._lock:
            buffer = self.screen.buffer
            rows: list[list[dict]] = []
            for y in range(self.rows):
                line = buffer[y]
                runs: list[dict] = []
                for x in range(self.cols):
                    char = line[x]
                    style = (char.fg, char.bg, char.bold, char.reverse)
                    if runs and runs[-1]["_s"] == style:
                        runs[-1]["t"] += char.data
                    else:
                        runs.append({
                            "t": char.data,
                            "fg": char.fg,
                            "bg": char.bg,
                            "b": char.bold,
                            "r": char.reverse,
                            "_s": style,
                        })
                for run in runs:
                    del run["_s"]
                # Trailing blank space costs bandwidth and renders identically.
                while runs and not runs[-1]["t"].strip() and runs[-1]["bg"] == "default":
                    runs.pop()
                rows.append(runs)

            return {
                "type": "screen",
                "rows": rows,
                "cursor": {"x": self.screen.cursor.x, "y": self.screen.cursor.y,
                           "hidden": self.screen.cursor.hidden},
                "cols": self.cols,
                "nrows": self.rows,
                "alive": self.alive,
            }

    def close(self) -> None:
        self.alive = False
        try:
            self.proc.terminate(force=True)
        except Exception:
            pass


async def serve(ws, cwd: str) -> None:
    """Drive one terminal session over an accepted WebSocket."""
    session: Optional[TerminalSession] = None
    loop = asyncio.get_running_loop()

    try:
        session = TerminalSession(cwd)
    except Exception as exc:
        await ws.send_json({"type": "error",
                            "message": f"cannot start a terminal: {exc}"})
        return

    async def push() -> None:
        """Coalesce updates and send the screen."""
        last = ""
        while session.alive or not session.updates.empty():
            try:
                await loop.run_in_executor(None, session.updates.get, True, 1.0)
            except Exception:
                if not session.alive:
                    break
                continue
            await asyncio.sleep(FRAME_INTERVAL_S)
            # Drain anything that piled up during the sleep; one frame covers it.
            while not session.updates.empty():
                try:
                    session.updates.get_nowait()
                except queue.Empty:
                    break
            snap = session.snapshot()
            payload = str(snap)
            if payload != last:
                last = payload
                await ws.send_json(snap)
        await ws.send_json({"type": "exit"})

    pusher = asyncio.create_task(push())
    try:
        # First frame immediately, so the pane is not blank until the shell
        # prints its prompt.
        await ws.send_json(session.snapshot())
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind == "input":
                session.write(msg.get("data", ""))
            elif kind == "resize":
                session.resize(msg.get("cols", DEFAULT_COLS),
                               msg.get("rows", DEFAULT_ROWS))
                session.updates.put_nowait(True)
            elif kind == "close":
                break
    except Exception:
        pass  # a disconnect is the normal way this ends
    finally:
        pusher.cancel()
        if session is not None:
            session.close()
