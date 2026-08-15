"""Entry point: python -m src.webui"""

from __future__ import annotations

import argparse

from .server import main

ap = argparse.ArgumentParser(prog="clawd-ui", description="Clawd Code web UI")
ap.add_argument("--host", default="127.0.0.1")
ap.add_argument("--port", type=int, default=8765)
ap.add_argument("--workspace", default=None, help="folder the agent works in")
ap.add_argument("--keep-vram", action="store_true",
                help="leave any running llama-server alone at startup")
ns = ap.parse_args()

if not ns.keep_vram:
    # Release VRAM held by an llama-server this process did not start.
    #
    # A supervisor only knows about servers it launched, so a leftover from a
    # previous run is invisible to eviction: the budget check sees the VRAM as
    # taken by "something outside Clawd-Code" and refuses to start anything,
    # with no way out but killing it by hand. The desktop shell has always done
    # this on launch; the plain server entry point did not, which is how you
    # end up unable to load a model on a machine with nothing else running.
    try:
        from ..local.cli import main as cli_main

        cli_main(["stop", "all"])
    except Exception:
        pass  # best effort -- never block startup on cleanup

main(ns.host, ns.port, ns.workspace)
