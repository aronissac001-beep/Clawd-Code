from __future__ import annotations

import re
import shlex
import subprocess
from pathlib import Path
from typing import Any

from ..context import ToolContext
from ..errors import ToolInputError, ToolPermissionError
from ..protocol import ToolResult
from ..registry import ToolSpec


_DANGEROUS_PATTERNS = [
    re.compile(r"\bsudo\b", re.IGNORECASE),
    re.compile(r"\bshutdown\b", re.IGNORECASE),
    re.compile(r"\breboot\b", re.IGNORECASE),
    re.compile(r"\bmkfs\b", re.IGNORECASE),
    re.compile(r"\bdd\b\s+if=", re.IGNORECASE),
    re.compile(r"\brm\b.*\s+-rf\s+/\s*$", re.IGNORECASE),
    re.compile(r"\brm\b.*\s+-rf\s+/\s+"),
    re.compile(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:", re.IGNORECASE),
]


def _truncate(s: str, limit: int = 20000) -> str:
    if len(s) <= limit:
        return s
    return s[:limit] + "\n\n... [truncated] ..."


_BASH_PATH: str | None = None


def _bash_executable() -> str:
    """Find a bash that can actually run a command.

    On Windows, ``bash`` on PATH is usually ``C:\\Windows\\System32\\bash.exe``
    -- the WSL launcher, not a shell. On a machine with no distro installed it
    fails with

        WSL ... execvpe(/bin/bash) failed: No such file or directory

    and exit code 1, so every Bash tool call returns an error that looks like
    the command was wrong rather than the shell being absent. Git for Windows
    ships a real bash; prefer it, and only fall back to PATH when what is there
    is not the WSL shim.
    """
    global _BASH_PATH
    if _BASH_PATH is not None:
        return _BASH_PATH

    import os
    import shutil

    candidates: list[str] = []
    if os.name == "nt":
        for base in (os.environ.get("ProgramFiles", r"C:\Program Files"),
                     os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
                     os.environ.get("LOCALAPPDATA", "")):
            if base:
                candidates.append(str(Path(base) / "Git" / "bin" / "bash.exe"))

    found = next((c for c in candidates if Path(c).is_file()), None)
    if found is None:
        on_path = shutil.which("bash")
        # System32\bash.exe is the WSL launcher. Anything else is a real shell.
        if on_path and "system32" not in on_path.replace("/", "\\").lower():
            found = on_path

    _BASH_PATH = found or "bash"
    return _BASH_PATH


def _try_extract_cd(command: str) -> Path | None:
    stripped = command.strip()
    if not stripped.startswith("cd "):
        return None
    try:
        parts = shlex.split(stripped, posix=True)
    except ValueError:
        return None
    if len(parts) >= 2 and parts[0] == "cd":
        return Path(parts[1])
    return None


class BashTool:
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="Bash",
            description="Execute a shell command.",
            input_schema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "command": {"type": "string"},
                    "cwd": {"type": "string"},
                    "timeout_s": {"type": "integer"},
                },
                "required": ["command"],
            },
            is_destructive=True,
            max_result_size_chars=50_000,
        )

    def run(self, tool_input: dict[str, Any], context: ToolContext) -> ToolResult:
        command = tool_input["command"]
        if not isinstance(command, str) or not command.strip():
            raise ToolInputError("command must be a non-empty string")
        if "\x00" in command:
            raise ToolInputError("command contains NUL byte")

        for pat in _DANGEROUS_PATTERNS:
            if pat.search(command):
                raise ToolPermissionError("refusing to run potentially dangerous command")

        explicit_cwd = tool_input.get("cwd")
        if explicit_cwd is not None:
            if not isinstance(explicit_cwd, str) or not explicit_cwd.startswith("/"):
                raise ToolInputError("cwd must be an absolute path when provided")
            cwd = context.ensure_allowed_path(explicit_cwd)
        else:
            cwd = context.cwd or context.workspace_root

        cd_target = _try_extract_cd(command)
        if cd_target is not None and command.strip().startswith("cd ") and len(command.strip().splitlines()) == 1:
            next_dir = (cwd / cd_target).expanduser().resolve() if not cd_target.is_absolute() else cd_target.expanduser().resolve()
            next_dir = context.ensure_allowed_path(next_dir)
            if not next_dir.exists() or not next_dir.is_dir():
                return ToolResult(name="Bash", output={"error": f"directory does not exist: {next_dir}"}, is_error=True)
            context.cwd = next_dir
            return ToolResult(name="Bash", output={"cwd": str(context.cwd), "stdout": "", "stderr": ""})

        timeout_s = tool_input.get("timeout_s", 60)
        if not isinstance(timeout_s, int) or timeout_s < 1 or timeout_s > 600:
            raise ToolInputError("timeout_s must be an integer between 1 and 600")

        completed = subprocess.run(
            [_bash_executable(), "-lc", command],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout_s,
            # Output is captured, so no console is needed. Without this flag
            # Windows flashes a terminal window for every command the agent
            # runs, which is jarring in the desktop app.
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

        stdout = _truncate(completed.stdout or "")
        stderr = _truncate(completed.stderr or "")
        output: dict[str, Any] = {
            "cwd": str(cwd),
            "exit_code": completed.returncode,
            "stdout": stdout,
            "stderr": stderr,
        }
        return ToolResult(name="Bash", output=output, is_error=completed.returncode != 0)

