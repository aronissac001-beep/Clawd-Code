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
ap.add_argument("--set-token", action="store_true",
                help="generate a token for remote access and print the URL to "
                     "open on your phone, then exit")
ap.add_argument("--clear-token", action="store_true",
                help="turn remote access off again, then exit")
ns = ap.parse_args()

if ns.set_token or ns.clear_token:
    from .auth import new_token, set_token

    if ns.clear_token:
        set_token(None)
        print("Remote access disabled. The app is local-only again.")
        raise SystemExit(0)

    token = new_token()
    set_token(token)
    print("Remote access enabled.")
    print()
    print("The app itself stays bound to 127.0.0.1 and needs no firewall")
    print("rule. Expose it over a tunnel, which terminates TLS on this")
    print("machine and forwards to loopback:")
    print()
    print(f"    tailscale serve --bg {ns.port}")
    print()
    print("Then open this once on your phone. The token is swapped for a")
    print("cookie and dropped from the address bar, so it is not left in")
    print("your history or autocomplete:")
    print()
    print(f"    https://<machine>.<tailnet>.ts.net/?token={token}")
    print()
    print("Anyone holding that token can run shell commands on this machine.")
    print("Treat it like a password. Revoke it with --clear-token.")
    raise SystemExit(0)

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
