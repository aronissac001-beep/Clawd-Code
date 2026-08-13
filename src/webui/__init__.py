"""Local web UI for Clawd Code.

Start with:  python -m src.webui
"""

from __future__ import annotations

__all__ = ["main"]


def main(*args, **kwargs):
    from .server import main as _main

    return _main(*args, **kwargs)
