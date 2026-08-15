"""A command-line way into a running Clawd Code app.

Built so an outside agent -- Claude Code in a terminal, a script, a keybinding
-- can drive the app without a browser. Everything it does goes through the
same HTTP API the UI uses, so there is one implementation and no second path
that can drift out of step.

    python -m src.clawdctl status
    python -m src.clawdctl pixel "a knight with a red plume" --kind rotation
    python -m src.clawdctl image "a castle at dusk" --backend pollinations
    python -m src.clawdctl ask "what does the router do when a tier fails?"
    python -m src.clawdctl run "/cost"

Waits for the work to finish and prints the result, because a caller that has
to poll is a caller that will forget to. ``--json`` prints the raw payload for
anything that wants to parse rather than read.

The app must already be running:  python -m src.webui
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

DEFAULT_BASE = "http://127.0.0.1:8765"


class BridgeError(RuntimeError):
    pass


def call(base: str, path: str, payload: Optional[dict] = None,
         method: Optional[str] = None, timeout: int = 120) -> Any:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        base + path, data=data, method=method or ("POST" if data else "GET"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        try:
            detail = json.loads(detail).get("detail", detail)
        except ValueError:
            pass
        raise BridgeError(f"{exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise BridgeError(
            f"cannot reach the app at {base} ({exc.reason}). "
            f"Start it with: python -m src.webui"
        ) from exc
    return json.loads(body) if body.strip() else {}


def _wait(base: str, path: str, job_id: str, label: str,
          quiet: bool, timeout: int = 1800) -> dict:
    """Poll a job until it settles, reporting progress to stderr.

    Progress goes to stderr so that ``--json`` on stdout stays machine-readable
    even while a human is watching the same terminal.
    """
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        jobs = call(base, path).get("jobs", [])
        job = next((j for j in jobs if j["id"] == job_id), None)
        if job is None:
            raise BridgeError(f"{label} {job_id} vanished")
        if not quiet:
            note = (job.get("logs") or [""])[-1]
            line = f"  {job['status']:<9} {job.get('elapsed', 0):>5}s  {note}"
            if line != last:
                print(line, file=sys.stderr, flush=True)
                last = line
        if job["status"] in ("done", "error", "cancelled"):
            return job
        time.sleep(2)
    raise BridgeError(f"{label} {job_id} did not finish within {timeout}s")


# ---------------------------------------------------------------- commands


def cmd_status(args) -> int:
    status = call(args.base, "/api/status")
    if args.json:
        print(json.dumps(status, indent=2))
        return 0
    print(f"workspace : {status.get('workspace')}")
    print(f"provider  : {status.get('provider')}   busy: {status.get('busy')}")
    vram = status.get("vram_free_mb")
    print(f"vram free : {vram / 1024:.1f} GB" if vram else "vram free : unknown")
    for server in (status.get("ladder") or {}).get("servers", []):
        print(f"  loaded  : {server['tier']} on {server['url']}")
    guard = (status.get("write_guard") or {}).get("stats") or {}
    if guard:
        print(f"guard     : {guard.get('writes_checked', 0)} writes checked")
    return 0


def cmd_pixel(args) -> int:
    job = call(args.base, "/api/pixel/generate", {
        "kind": args.kind, "brief": args.brief, "lora": args.lora,
        "grid": args.grid, "palette": args.palette, "backend": args.backend,
        "action": args.action, "directions": args.directions,
        "art_direct": not args.no_art_direction,
    })
    if not args.quiet:
        print(f"{job['kind']} job {job['id']} on {job['backend']}",
              file=sys.stderr)

    done = _wait(args.base, "/api/pixel/jobs", job["id"], "pixel job", args.quiet)
    if args.json:
        print(json.dumps(done, indent=2))
        return 0 if done["status"] == "done" else 1

    if done["status"] != "done":
        print(f"failed: {done.get('error') or done['status']}", file=sys.stderr)
        return 1

    if done.get("design"):
        print(f"design: {done['design']}")
    root = f"{args.base}/api/pixel/file/{done['id']}"
    for frame in done["frames"]:
        print(f"  {frame['label']:<14} {frame['grid']}x{frame['grid']} "
              f"{frame['colours_used']} colours   {root}/{frame['file']}")
    if done.get("sheet"):
        print(f"  sheet          {done['sheet']['size'][0]}x"
              f"{done['sheet']['size'][1]}   {root}/{done['sheet']['file']}")
    if done.get("gif"):
        print(f"  animation      {done['gif']['frames']} frames   "
              f"{root}/{done['gif']['file']}")
    return 0


def cmd_image(args) -> int:
    model = args.model or ("pollinations/flux" if args.backend == "pollinations"
                           else "fal-ai/flux/schnell")
    job = call(args.base, "/api/media/generate", {
        "model": model, "task": "text-to-image", "prompt": args.prompt,
        "params": {"width": args.width, "height": args.height},
    })
    done = _wait(args.base, "/api/media/jobs", job["id"], "image job", args.quiet)
    if args.json:
        print(json.dumps(done, indent=2))
        return 0 if done["status"] == "done" else 1
    if done["status"] != "done":
        print(f"failed: {done.get('error')}", file=sys.stderr)
        return 1
    for out in done["outputs"]:
        print(f"{args.base}/api/media/file/{out['file']}")
    return 0


def cmd_ask(args) -> int:
    """Send a prompt through the agent and stream the reply."""
    request = urllib.request.Request(
        args.base + "/api/chat",
        data=json.dumps({"message": args.prompt,
                         "model": args.model or "auto"}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    text = ""
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            for raw in response:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                try:
                    event = json.loads(line[5:].strip())
                except ValueError:
                    continue
                kind = event.get("type")
                if kind == "text":
                    text += event["data"]
                    if not args.quiet and not args.json:
                        sys.stdout.write(event["data"])
                        sys.stdout.flush()
                elif kind == "done":
                    text = event.get("text") or text
                elif kind == "tool" and not args.quiet:
                    if event.get("kind") == "tool_use":
                        print(f"\n  [{event['name']}]", file=sys.stderr)
                elif kind == "error":
                    print(f"\nerror: {event.get('data')}", file=sys.stderr)
                    return 1
    except urllib.error.HTTPError as exc:
        raise BridgeError(f"{exc.code}: {exc.read().decode()[:300]}") from exc

    if args.json:
        print(json.dumps({"reply": text}, indent=2))
    elif args.quiet:
        print(text)
    else:
        print()
    return 0


def cmd_run(args) -> int:
    result = call(args.base, "/api/command", {"line": args.line})
    print(json.dumps(result, indent=2) if args.json else result.get("text", ""))
    return 0


def cmd_model(args) -> int:
    if args.spec:
        print(json.dumps(call(args.base, "/api/model", {"spec": args.spec})))
        return 0
    catalog = call(args.base, "/api/models/catalog")
    if args.json:
        print(json.dumps(catalog, indent=2))
        return 0
    print(f"current: {catalog['current']}")
    for group in ("local", "free", "paid"):
        rows = catalog.get(group) or []
        if not rows:
            continue
        print(f"\n{group} ({len(rows)}):")
        for row in rows[:args.limit]:
            print(f"  {row['id']:<52} {row.get('detail', '')}")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="clawd-bridge",
        description="Drive a running Clawd Code app from the command line.")
    parser.add_argument("--base", default=DEFAULT_BASE, help="app URL")
    parser.add_argument("--json", action="store_true", help="raw JSON output")
    parser.add_argument("--quiet", "-q", action="store_true",
                        help="suppress progress on stderr")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="what the app is doing").set_defaults(fn=cmd_status)

    p = sub.add_parser("pixel", help="generate pixel art")
    p.add_argument("brief")
    p.add_argument("--kind", default="sprite",
                   choices=("sprite", "rotation", "animation"))
    p.add_argument("--lora", default="retro")
    p.add_argument("--grid", type=int, default=64)
    p.add_argument("--palette", type=int, default=24)
    p.add_argument("--backend", default="fal", choices=("fal", "pollinations"))
    p.add_argument("--action", default="walk",
                   help="for --kind animation: idle, walk, run, attack, hurt, death")
    p.add_argument("--directions", type=int, default=8, choices=(4, 8))
    p.add_argument("--no-art-direction", action="store_true",
                   help="skip the model call that writes the shared design brief")
    p.set_defaults(fn=cmd_pixel)

    p = sub.add_parser("image", help="generate an ordinary image")
    p.add_argument("prompt")
    p.add_argument("--model")
    p.add_argument("--backend", default="fal", choices=("fal", "pollinations"))
    p.add_argument("--width", type=int, default=1024)
    p.add_argument("--height", type=int, default=1024)
    p.set_defaults(fn=cmd_image)

    p = sub.add_parser("ask", help="send a prompt through the agent")
    p.add_argument("prompt")
    p.add_argument("--model", help="auto, local:<tier>, openrouter:<id>")
    p.add_argument("--timeout", type=int, default=900)
    p.set_defaults(fn=cmd_ask)

    p = sub.add_parser("run", help="run a slash command")
    p.add_argument("line")
    p.set_defaults(fn=cmd_run)

    p = sub.add_parser("model", help="show or set the model")
    p.add_argument("spec", nargs="?")
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(fn=cmd_model)

    args = parser.parse_args(argv)
    try:
        return args.fn(args)
    except BridgeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
