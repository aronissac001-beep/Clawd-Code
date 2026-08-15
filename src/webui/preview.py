"""Run the project's dev server and show it in a pane.

Reads ``.claude/launch.json`` -- the same file Claude Code uses, so a project
configured for one works in the other without a second config format.

    {
      "version": "0.0.1",
      "configurations": [
        {"name": "web", "runtimeExecutable": "npm",
         "runtimeArgs": ["run", "dev"], "port": 5173}
      ]
    }

An entry with a ``url`` and no executable attaches to a server that is already
running instead of starting one.

Two things this deliberately does not do. It does not guess a start command
when there is no config: a wrong guess runs arbitrary commands in someone's
repository, and being asked once is cheaper than that. And it does not proxy
the app through this server -- the pane points an iframe straight at
localhost:PORT, so the app sees its own origin and cookies, paths and websockets
behave exactly as they do in a browser.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Optional

LAUNCH_FILE = Path(".claude") / "launch.json"
LOG_LINES = 400
READY_TIMEOUT_S = 90

# Windows: keep the child off the console so no window flashes on screen.
_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


class PreviewError(RuntimeError):
    pass


def read_configs(workspace: Path) -> list[dict]:
    """Configurations from launch.json, or [] when there is no file."""
    path = workspace / LAUNCH_FILE
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError) as exc:
        raise PreviewError(f"{LAUNCH_FILE} is not valid JSON: {exc}") from exc

    out = []
    for entry in data.get("configurations") or []:
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        port = entry.get("port")
        out.append({
            "name": entry["name"],
            "command": entry.get("runtimeExecutable"),
            "args": list(entry.get("runtimeArgs") or []),
            "port": int(port) if port else None,
            "url": entry.get("url"),
            "cwd": entry.get("cwd"),
            "attach_only": not entry.get("runtimeExecutable"),
        })
    return out


def default_config_text(workspace: Path) -> str:
    """A starting launch.json, guessed from what is in the project.

    Offered as text for the user to accept or edit -- never written or run
    without them saying so.
    """
    if (workspace / "package.json").is_file():
        command, args, port = "npm", ["run", "dev"], 5173
    elif (workspace / "manage.py").is_file():
        command, args, port = "python", ["manage.py", "runserver"], 8000
    elif any((workspace / f).is_file() for f in ("pyproject.toml", "requirements.txt")):
        command, args, port = "python", ["-m", "http.server", "8000"], 8000
    else:
        command, args, port = "npm", ["run", "dev"], 3000

    return json.dumps({
        "version": "0.0.1",
        "configurations": [{
            "name": workspace.name or "app",
            "runtimeExecutable": command,
            "runtimeArgs": args,
            "port": port,
        }],
    }, indent=2)


class PreviewServer:
    """One running dev server, with its output captured."""

    def __init__(self, config: dict, workspace: Path):
        self.name = config["name"]
        self.port = config.get("port")
        self.url = config.get("url") or (
            f"http://localhost:{self.port}" if self.port else None)
        self.workspace = workspace
        self.lines: deque[str] = deque(maxlen=LOG_LINES)
        self.started_at = time.time()
        self.process: Optional[subprocess.Popen] = None
        self.error = ""

        if config.get("attach_only"):
            if not self.url:
                raise PreviewError(
                    f"{self.name!r} has neither a command nor a url to attach to"
                )
            self.lines.append(f"[clawd] attaching to {self.url}")
            return

        cwd = Path(config["cwd"]) if config.get("cwd") else workspace
        argv = [config["command"], *config["args"]]
        try:
            self.process = subprocess.Popen(
                argv,
                cwd=str(cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                text=True,
                bufsize=1,
                encoding="utf-8",
                errors="replace",
                creationflags=_NO_WINDOW,
                # npm/yarn are .cmd shims on Windows and are not directly
                # executable; the shell resolves them.
                shell=(os.name == "nt"),
            )
        except (OSError, ValueError) as exc:
            raise PreviewError(f"cannot start {' '.join(argv)}: {exc}") from exc

        self.lines.append(f"[clawd] $ {' '.join(argv)}")
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self) -> None:
        assert self.process is not None
        for line in self.process.stdout:  # type: ignore[union-attr]
            self.lines.append(line.rstrip("\n"))
        code = self.process.wait()
        self.lines.append(f"[clawd] exited with code {code}")

    @property
    def alive(self) -> bool:
        return self.process is None or self.process.poll() is None

    def is_listening(self) -> bool:
        """Whether something answers on the port yet."""
        if not self.port:
            return self.alive
        import socket

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.4)
            return sock.connect_ex(("127.0.0.1", self.port)) == 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "url": self.url,
            "port": self.port,
            "alive": self.alive,
            "listening": self.is_listening(),
            "uptime": round(time.time() - self.started_at, 1),
            "logs": list(self.lines)[-60:],
            "error": self.error,
            "managed": self.process is not None,
        }

    def stop(self) -> None:
        if self.process is None:
            return
        try:
            if os.name == "nt":
                # The shell wrapper is the direct child; killing the tree is the
                # only way to actually stop node underneath it.
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(self.process.pid)],
                               capture_output=True, creationflags=_NO_WINDOW)
            else:
                self.process.terminate()
        except Exception:
            pass


class PreviewManager:
    def __init__(self) -> None:
        self.servers: dict[str, PreviewServer] = {}
        self._lock = threading.Lock()

    def start(self, config: dict, workspace: Path) -> PreviewServer:
        with self._lock:
            existing = self.servers.get(config["name"])
            if existing is not None and existing.alive:
                return existing
            server = PreviewServer(config, workspace)
            self.servers[config["name"]] = server
            return server

    def stop(self, name: str) -> bool:
        with self._lock:
            server = self.servers.pop(name, None)
        if server is None:
            return False
        server.stop()
        return True

    def stop_all(self) -> None:
        with self._lock:
            names = list(self.servers)
        for name in names:
            self.stop(name)

    def status(self) -> list[dict]:
        with self._lock:
            return [s.as_dict() for s in self.servers.values()]
