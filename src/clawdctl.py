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
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

DEFAULT_BASE = "http://127.0.0.1:8765"


class BridgeError(RuntimeError):
    pass


def _headers() -> dict:
    """Content type, plus the token when remote access is configured.

    Hoisted rather than inlined because there are two request builders in this
    file -- `call` and `cmd_ask`, which bypasses `call` to stream SSE -- and
    "forgot the second caller" is exactly how a client half-breaks the day auth
    is switched on.
    """
    head = {"Content-Type": "application/json"}
    try:
        from .config import load_config

        token = (load_config().get("webui") or {}).get("token")
        if token:
            head["Authorization"] = f"Bearer {token}"
    except Exception:
        pass
    return head


def call(base: str, path: str, payload: Optional[dict] = None,
         method: Optional[str] = None, timeout: int = 120) -> Any:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        base + path, data=data, method=method or ("POST" if data else "GET"),
        headers=_headers(),
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


def pixel_dir(job_id: str) -> str:
    """Where the sprites for a job actually are on disk.

    Printed instead of a URL because the caller is usually an agent that can
    open a file but cannot open a browser. A path it can read is the difference
    between iterating on what it made and generating blind.
    """
    home = os.path.expanduser("~")
    return os.path.join(home, ".clawd", "media", "pixel", job_id)


def _numbers(frame: dict) -> str:
    """The three figures that let a caller reject a sprite without opening it."""
    bits = [f"{frame['grid']}x{frame['grid']}",
            f"{frame['colours_used']} colours"]
    if "opaque_pct" in frame:
        bits += [f"opaque {frame['opaque_pct']:.0f}%",
                 f"edge {frame['edge_opaque_pct']:.0f}%",
                 f"holes {frame['hole_pct']:.2f}%"]
    line = "  ".join(bits)
    if frame.get("warning"):
        line += f"   <-- {frame['warning']}"
    return line


def _report(done: dict, quiet: bool) -> None:
    folder = pixel_dir(done["id"])
    print(f"job {done['id']}  {done['kind']}  {done.get('backend')}  "
          f"seed={done.get('seed')}  {done.get('elapsed')}s")
    if done.get("design"):
        print(f"design: {done['design']}")
    print(f"folder: {folder}")
    for frame in done["frames"]:
        print(f"  {frame['label']:<14} {_numbers(frame)}")
        # The @6x copy is the one to LOOK at; the plain file is the asset; the
        # raw is what a re-cut has to start from.
        print(f"      view   {os.path.join(folder, frame.get('preview') or frame['file'])}")
        print(f"      asset  {os.path.join(folder, frame['file'])}")
        if frame.get("source"):
            print(f"      raw    {os.path.join(folder, frame['source'])}")
    if done.get("sheet"):
        print(f"  sheet          {done['sheet']['size'][0]}x{done['sheet']['size'][1]}")
        print(f"      {os.path.join(folder, done['sheet']['file'])}")
    if done.get("gif"):
        print(f"  animation      {done['gif']['frames']} frames")
        print(f"      {os.path.join(folder, done['gif']['file'])}")
    print(f"reproduce: --seed {done.get('seed')} --grid {done.get('grid')} "
          f"--palette {done.get('palette')}")
    print(f"same character: --from {done['id']}")


def _manifest(job_id: str) -> dict:
    """The recipe for an earlier job, read from its own folder.

    From disk rather than from the studio: the studio keeps forty jobs and
    loses them on restart, but the folder is still there tomorrow, which is
    when you want yesterday's character back.
    """
    path = os.path.join(pixel_dir(job_id), "manifest.json")
    if not os.path.isfile(path):
        raise BridgeError(
            f"no manifest for job {job_id}. Jobs made before manifests were "
            f"written do not have one; generate a fresh sprite to get a "
            f"reusable character.")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def cmd_pixel(args) -> int:
    # Inherit the recipe from an earlier job, so "the same character, walking"
    # needs neither the seed nor the design brief retyped.
    inherited = _manifest(args.your_from) if args.your_from else {}
    seed = args.seed if args.seed is not None else inherited.get("seed")
    grid = args.grid if args.grid is not None else inherited.get("grid", 64)
    palette = (args.palette if args.palette is not None
               else inherited.get("palette", 24))

    # One brief, several seeds. Generating a few and choosing is how pixel art
    # actually gets made -- the first result is rarely the one you keep.
    seeds: list[Optional[int]] = [seed]
    if args.variations > 1:
        base = seed if seed is not None else int(time.time()) % 100000
        seeds = [base + i for i in range(args.variations)]

    results = []
    for index, one_seed in enumerate(seeds):
        job = call(args.base, "/api/pixel/generate", {
            "kind": args.kind, "brief": args.brief, "lora": args.lora,
            "grid": grid, "palette": palette, "backend": args.backend,
            "action": args.action, "directions": args.directions,
            "art_direct": not args.no_art_direction, "seed": one_seed,
            "tolerance": args.tolerance, "sharpen": args.sharpen,
            "design": inherited.get("design") or None,
        })
        if not args.quiet:
            label = f" ({index + 1}/{len(seeds)})" if len(seeds) > 1 else ""
            print(f"{job['kind']} job {job['id']} on {job['backend']}{label}",
                  file=sys.stderr)
        results.append(_wait(args.base, "/api/pixel/jobs", job["id"],
                             "pixel job", args.quiet))

    if args.json:
        print(json.dumps(results if len(results) > 1 else results[0], indent=2))
        return 0 if all(r["status"] == "done" for r in results) else 1

    failed, worst = 0, 0
    for index, done in enumerate(results):
        if len(results) > 1:
            print(f"\n--- variation {index + 1} ---")
        if done["status"] != "done":
            failed += 1
            worst = max(worst, classify(done.get("error") or done["status"]))
            print(f"failed: {done.get('error') or done['status']}", file=sys.stderr)
            continue
        _report(done, args.quiet)
    return worst if failed == len(results) else 0


def classify(error: str) -> int:
    """An exit code that says what to do next, not merely that it went wrong.

    An agent that cannot tell "wait a minute and retry" from "this will never
    work" spends the whole rate-limit budget rediscovering a permanent failure.
    """
    low = (error or "").lower()
    if "429" in low or "too many requests" in low or "rate" in low:
        return 2      # transient: the same command will work later
    if any(s in low for s in ("exhausted balance", "locked", "401", "402",
                              "403", "unauthorized", "payment")):
        return 3      # the account: change backend, do not retry
    if any(s in low for s in ("unknown kind", "describe what", "400", "422",
                              "must be")):
        return 4      # the request: change the brief or the flags
    return 1


def _spread(text: str, fallback: list[int]) -> list[int]:
    if not text:
        return fallback
    return [int(part) for part in str(text).replace(" ", "").split(",") if part]


def cmd_refine(args) -> int:
    """Re-cut a raw at a different size, palette or tolerance.

    No model and no network: about thirty milliseconds a pass. Sweeping is
    therefore cheaper than one generation by three orders of magnitude, which
    is why it should be the first thing tried, not the last.
    """
    grids = _spread(args.grid, [32])
    palettes = _spread(args.palette, [16])
    tolerances = _spread(args.tolerance, [32]) if args.sweep else \
        _spread(args.tolerance, [32])[:1]
    if args.sweep and not args.tolerance:
        tolerances = [16, 24, 32, 48, 64]

    rows = []
    for grid in grids:
        for palette in palettes:
            for tolerance in tolerances:
                info = call(args.base, "/api/pixel/requantise", {
                    "folder": args.job, "name": args.frame, "grid": grid,
                    "palette": palette, "background": args.background,
                    "tolerance": tolerance, "sharpen": args.sharpen,
                })
                rows.append(info)

    if args.json:
        print(json.dumps(rows if len(rows) > 1 else rows[0], indent=2))
        return 0

    # Least surviving backdrop first: the top row is usually the keeper, and
    # when it is not, the second is.
    rows.sort(key=lambda r: (r.get("edge_opaque_pct", 0), r.get("hole_pct", 0)))
    folder = pixel_dir(rows[0]["dir"])
    for info in rows:
        print(f"  t{info.get('tolerance', '?'):<3} {_numbers(info)}")
        print(f"      view   {os.path.join(folder, info.get('preview') or info['file'])}")
    if len(rows) > 1:
        print(f"\n{len(rows)} results, least backdrop first. Open the top two "
              f"or three and pick on the picture.")
    return 0


def cmd_show(args) -> int:
    """Everything known about an earlier job, without generating anything."""
    manifest = _manifest(args.job)
    if args.json:
        print(json.dumps(manifest, indent=2))
        return 0
    _report(manifest, args.quiet)
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
        headers=_headers(), method="POST")
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
    # LoRA weights are applied by fal. On the free backend selecting one only
    # prepends a trigger word the model was never trained on, which is noise.
    p.add_argument("--lora", default="none",
                   help="needs a funded fal account; does nothing on "
                        "Pollinations")
    p.add_argument("--grid", type=int, help="16, 32, 48, 64, 96 or 128 "
                                            "(default 64, or inherited)")
    p.add_argument("--palette", type=int, help="colours (default 24, or "
                                               "inherited)")
    # Free and keyless by default. fal is opt-in, because a locked account
    # costs a wait before falling back here anyway.
    p.add_argument("--backend", default="pollinations",
                   choices=("fal", "pollinations"))
    p.add_argument("--action", default="walk",
                   help="for --kind animation: idle, walk, run, attack, hurt, death")
    p.add_argument("--directions", type=int, default=8, choices=(4, 8))
    p.add_argument("--no-art-direction", action="store_true",
                   help="skip the model call that writes the shared design brief")
    p.add_argument("--seed", type=int,
                   help="reproduce a previous result, or hold a character "
                        "steady across separate runs")
    p.add_argument("--variations", type=int, default=1, metavar="N",
                   help="generate N takes on the same brief, one seed apart, "
                        "and print them all so you can pick")
    p.add_argument("--tolerance", type=int, default=32,
                   help="how far from the border colour still counts as "
                        "backdrop. Raise it when a sprite reports edge>15%%, "
                        "lower it when opaque drops under 8%%. Per-image: "
                        "sweep with `refine` rather than guessing")
    p.add_argument("--sharpen", type=float, default=1.0, metavar="F",
                   help="1.0 keeps the soft area-average downscale; 1.3-1.6 "
                        "is crisper at small grids. Capped at 2.0, beyond "
                        "which the generator's JPEG artefacts speckle")
    p.add_argument("--from", dest="your_from", metavar="JOB",
                   help="inherit seed, design brief, grid and palette from an "
                        "earlier job -- how you get a walk cycle of the "
                        "character you made yesterday")
    p.set_defaults(fn=cmd_pixel)

    p = sub.add_parser("show", help="paths and quality numbers for an earlier "
                                    "job, without generating anything")
    p.add_argument("job")
    p.set_defaults(fn=cmd_show)

    p = sub.add_parser("refine", help="re-cut a frame: different size, palette "
                                      "or background. No model, instant, free")
    p.add_argument("job", help="job id (the folder name)")
    p.add_argument("frame", help="the RAW to re-cut, e.g. raw-00.jpg. Re-cutting "
                                 "an already-quantised sprite compounds "
                                 "palette loss; `show` prints the raw for "
                                 "every frame")
    p.add_argument("--grid", help="one size or a list: 32,64")
    p.add_argument("--palette", help="one count or a list: 16,24")
    p.add_argument("--tolerance", help="one value or a list: 24,32,48")
    p.add_argument("--sharpen", type=float, default=1.0)
    p.add_argument("--background", default="transparent",
                   choices=("transparent", "keep"))
    p.add_argument("--sweep", action="store_true",
                   help="try every combination and print them sorted by how "
                        "much backdrop is left. ~30ms each, so a fifteen-point "
                        "sweep costs less than half a second")
    p.set_defaults(fn=cmd_refine)

    p = sub.add_parser("image", help="generate an ordinary image")
    p.add_argument("prompt")
    p.add_argument("--model")
    # Same default as `pixel`: free and keyless. Unlike the pixel path, the
    # media store has no fallback of its own, so naming fal on a refused
    # account fails outright rather than degrading.
    p.add_argument("--backend", default="pollinations",
                   choices=("fal", "pollinations"))
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
