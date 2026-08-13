"""Entry point: python -m src.webui"""

from __future__ import annotations

import argparse

from .server import main

ap = argparse.ArgumentParser(prog="clawd-ui", description="Clawd Code web UI")
ap.add_argument("--host", default="127.0.0.1")
ap.add_argument("--port", type=int, default=8765)
ap.add_argument("--workspace", default=None, help="folder the agent works in")
ns = ap.parse_args()

main(ns.host, ns.port, ns.workspace)
