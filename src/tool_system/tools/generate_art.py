"""Image generation the agent can actually reach.

The app has had a complete pixel-art pipeline, a Pixels tab and a CLI bridge
for an *outside* agent to drive it -- and no tool at all, so the model in the
app's own chat answered "I can't generate images", correctly. These two tools
close that gap; they are thin wrappers over the pipelines that already exist.

Two tools rather than one with a mode flag. A small local model picks a tool by
its name far more reliably than it fills in an enum, and "pixel art" and "an
image" are the two things a user asks for by name. The pair costs about 480
tokens of prompt on every turn.

Both block until the job finishes, because the agent loop is synchronous. That
puts a ceiling on how long they may wait: while a tool runs the SSE stream is
silent, and the browser abandons a stream that says nothing for 180 seconds.
Hence TIMEOUT_S, deliberately under that -- and, when it expires, a result that
hands the job over to the Pixels tab rather than cancelling it.
"""

from __future__ import annotations

import time
from typing import Any

from ..context import ToolContext
from ..errors import ToolInputError
from ..protocol import ToolResult
from ..registry import ToolSpec

# Under the browser's 180s silent-stream watchdog, with room to spare for the
# final quantise pass and the model's own reply.
TIMEOUT_S = 150
POLL_S = 0.4

# Valid sprite sizes, taken from the pipeline rather than restated, so the chat
# path cannot drift from what the Pixels tab accepts.
SIZES = (16, 32, 48, 64, 96, 128)

# The model is about to be handed a list of URLs for pictures the user can
# already see. Without this it pastes them into the prose as bare links.
SHOWN = ("The images are already displayed to the user. Describe them in a "
         "sentence; do not paste the URLs.")


class _Timeout(Exception):
    """We stopped waiting. The job itself keeps going."""


def _wait(job, context: ToolContext, cancel_job) -> None:
    """Block until the job settles.

    Raises _Timeout if we gave up waiting -- deliberately *without* cancelling
    the job. Telling the user "it will appear in the Pixels tab" and then
    killing it would be a lie, and the studio carrying on in the background is
    the only reason that message is worth sending. Cancel only when the user
    actually asked to stop.
    """
    deadline = time.time() + TIMEOUT_S
    while job.status in ("queued", "running"):
        if context.cancelled():
            cancel_job()
            return
        if time.time() > deadline:
            raise _Timeout
        time.sleep(POLL_S)


def _explain(error: str) -> str:
    """Turn a backend failure into something worth relaying to the user.

    The web UI renders a tool's output but never its exception, so a raised
    error paints a card that says "failed" and nothing else. Anything the user
    needs to read has to come back as text, and it has to stand on its own:
    the model may not be told this was an error at all.
    """
    low = (error or "").lower()
    if "429" in low or "too many requests" in low:
        return ("The free image service is rate-limiting this machine. Tell "
                "the user to wait a minute and ask again -- nothing is wrong "
                "with their request.")
    if "empty image" in low:
        return ("The image service returned an empty file. Tell the user to "
                "ask again; it usually works on a second try.")
    if "pillow" in low:
        return ("Pillow is not installed, so the picture could not be turned "
                "into a sprite. Tell the user to run: pip install Pillow")
    if "did not answer" in low or "timed out" in low:
        return ("The free image service did not answer in time. Tell the user "
                "to try again shortly.")
    return f"Generation failed: {error or 'no reason given'}"


class GeneratePixelArtTool:
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="GeneratePixelArt",
            description=(
                "Draw pixel art. Use this for any request for pixel art, a "
                "sprite, a sprite sheet, a game character, an 8-bit or 16-bit "
                "picture, a retro game icon, or a walk/idle/attack cycle.\n"
                "- This app CAN generate images. Never reply that you are "
                "unable to; call this instead\n"
                '- kind: "sprite" is one image, "rotation" is one character '
                'seen from several angles, "animation" is the frames of a '
                "cycle\n"
                "- Needs no API key. A sprite takes about 30s and every extra "
                "frame adds about the same, so prefer a single sprite unless "
                "the user asked for motion or several angles\n"
                "- Returns transparent-background PNGs, shown in the reply and "
                "in the app's Pixels tab"
            ),
            input_schema={
                "type": "object",
                # Kept, matching every other tool. Omitting it was tried, on
                # the theory that ignoring an invented key beats hard-failing
                # on one -- but a Gemini route on OpenRouter then rejected the
                # whole request with "required[0]: property is not defined",
                # which breaks every message rather than one argument. An odd
                # schema is not worth a provider that refuses to talk.
                "additionalProperties": False,
                "properties": {
                    # First, because the UI labels the tool card with the first
                    # input value.
                    "subject": {
                        "type": "string",
                        "description": "What to draw, e.g. 'a green frog knight "
                                       "with a tiny wooden shield'.",
                    },
                    "kind": {
                        "type": "string",
                        "enum": ["sprite", "rotation", "animation"],
                        "description": "Defaults to sprite.",
                    },
                    "action": {
                        "type": "string",
                        "enum": ["idle", "walk", "run", "attack", "hurt", "death"],
                        "description": "Which cycle, when kind is animation.",
                    },
                    # Integers carry their allowed values in the description
                    # rather than in an `enum`.
                    #
                    # An enum would be the better schema -- it is the only
                    # constraint the local validator actually enforces -- but
                    # measured, a Gemini route on OpenRouter rejects
                    # {"type": "integer", "enum": [...]} outright and answers
                    # 400 for the whole request. String enums are fine; integer
                    # ones are not. A tool that stops a provider talking is
                    # worse than one whose bad argument is caught below in
                    # run(), which is where both of these are checked anyway.
                    "directions": {
                        "type": "integer",
                        "description": "How many facings, when kind is rotation: "
                                       "4 or 8. Defaults to 4.",
                    },
                    "grid": {
                        "type": "integer",
                        "description": "Sprite size in pixels: "
                                       + ", ".join(str(s) for s in SIZES)
                                       + ". Defaults to 64.",
                    },
                },
                "required": ["subject"],
            },
            is_read_only=False,
            max_result_size_chars=20_000,
        )

    def run(self, tool_input: dict[str, Any], context: ToolContext) -> ToolResult:
        from ...media.pixel_jobs import studio
        from ...media.pixelart import ANIMATIONS

        subject = (tool_input.get("subject") or "").strip()
        if not subject:
            raise ToolInputError("subject must say what to draw")

        kind = tool_input.get("kind") or "sprite"
        if kind not in ("sprite", "rotation", "animation"):
            raise ToolInputError(
                f"kind must be sprite, rotation or animation, got {kind!r}")

        action = tool_input.get("action") or "walk"
        if kind == "animation" and action not in ANIMATIONS:
            raise ToolInputError(
                f"action must be one of {', '.join(sorted(ANIMATIONS))}")

        directions = tool_input.get("directions") or 4
        if directions not in (4, 8):
            raise ToolInputError("directions must be 4 or 8")

        grid = tool_input.get("grid") or 64
        if grid not in SIZES:
            raise ToolInputError(
                f"grid must be one of {', '.join(str(s) for s in SIZES)}")

        # Chat is the free lane; the Pixels tab is where money gets spent.
        #
        # fal is not tried here even when a key exists. The only thing it adds
        # is the LoRA, and the Pollinations fallback cannot apply a LoRA
        # anyway -- so against a refused account the fal attempt costs about
        # twenty-five seconds to deliver exactly nothing, on every generation.
        # Anyone with credit can still pick fal explicitly in the Pixels tab.
        jobs = studio()
        job = jobs.submit(
            kind, subject, lora="retro", grid=grid, palette=24,
            backend="pollinations", action=action, directions=directions,
        )

        try:
            _wait(job, context, lambda: jobs.cancel(job.id))
        except _Timeout:
            return ToolResult(
                name="GeneratePixelArt",
                output={
                    "status": "running",
                    "job": job.id,
                    "progress": (job.logs or ["starting"])[-1],
                    # The stop instruction is load-bearing: a model told "still
                    # running" will otherwise helpfully start a second job.
                    "note": (f"Still rendering after {TIMEOUT_S}s. Tell the "
                             f"user it is still going and will appear in the "
                             f"Pixels tab shortly. Do not call this tool again "
                             f"for this request."),
                })

        if job.status == "cancelled":
            return ToolResult(
                name="GeneratePixelArt",
                output={"status": "cancelled",
                        "note": "The user pressed Stop, so it was cancelled."})

        if job.status != "done":
            return ToolResult(
                name="GeneratePixelArt",
                output={"status": job.status, "error": _explain(job.error),
                        "logs": job.logs[-3:]},
                is_error=True)

        # `preview or file` matters. `file` is the real asset, so a 32x32
        # sprite shown at native size is a speck; quantise_to_sprite also
        # writes a 6x nearest-neighbour copy, which is what the Pixels tab
        # displays and what belongs in the chat.
        images = [
            {"url": f"/api/pixel/file/{f['dir']}/{f.get('preview') or f['file']}",
             "label": f.get("label") or "sprite", "pixel": True}
            for f in job.frames
        ][:12]
        if job.sheet:
            images.append({"url": f"/api/pixel/file/{job.sheet['dir']}/{job.sheet['file']}",
                           "label": "sheet", "pixel": True})
        if job.gif:
            images.append({"url": f"/api/pixel/file/{job.gif['dir']}/{job.gif['file']}",
                           "label": "animation", "pixel": True})

        return ToolResult(
            name="GeneratePixelArt",
            output={
                "status": "done",
                "kind": kind,
                "frames": len(job.frames),
                "grid": f"{grid}x{grid}",
                "backend": job.backend,
                "images": images,
                # Carries the one thing worth relaying when it happens -- a
                # backend swap -- and drops the "3/4 west" progress lines.
                "notes": [line for line in job.logs
                          if not line[:1].isdigit()][-3:],
                "seconds": round((job.finished_at or time.time()) - job.created_at, 1),
                "shown": SHOWN,
            },
        )


class GenerateImageTool:
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="GenerateImage",
            description=(
                "Draw an ordinary picture: an illustration, concept art, a "
                "logo, a poster, a photo-like image. For pixel art, sprites "
                "or game characters use GeneratePixelArt instead. Needs no "
                "API key and takes about 30s. The image is shown in the reply "
                "and in the app's Media tab."
            ),
            input_schema={
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "What to draw. Detail helps: subject, "
                                       "setting, lighting, style.",
                    },
                },
                "required": ["prompt"],
            },
            is_read_only=False,
            max_result_size_chars=20_000,
        )

    def run(self, tool_input: dict[str, Any], context: ToolContext) -> ToolResult:
        from ...media.fal import store

        prompt = (tool_input.get("prompt") or "").strip()
        if not prompt:
            raise ToolInputError("prompt must say what to draw")

        # Pollinations, hardcoded. Unlike the pixel path, JobStore has no
        # backend fallback of its own, so naming fal here would simply fail on
        # a refused account rather than degrading.
        #
        # No width/height parameters: Pollinations echoes whatever is asked for
        # in its response while writing a different size to disk, so reporting
        # the requested size back would be inventing a fact for the model to
        # relay as truth.
        jobs = store()
        job = jobs.submit("pollinations/flux", "text-to-image", prompt,
                          {"width": 1024, "height": 1024}, key="")

        try:
            _wait(job, context, lambda: jobs.cancel(job.id))
        except _Timeout:
            return ToolResult(
                name="GenerateImage",
                output={"status": "running", "job": job.id,
                        "note": (f"Still rendering after {TIMEOUT_S}s. Tell "
                                 f"the user it will appear in the Media tab "
                                 f"shortly. Do not call this tool again for "
                                 f"this request.")})

        if job.status == "cancelled":
            return ToolResult(
                name="GenerateImage",
                output={"status": "cancelled",
                        "note": "The user pressed Stop, so it was cancelled."})

        if job.status != "done" or not job.outputs:
            return ToolResult(
                name="GenerateImage",
                output={"status": job.status, "error": _explain(job.error)},
                is_error=True)

        return ToolResult(
            name="GenerateImage",
            output={
                "status": "done",
                "prompt": prompt,
                # Built from what was actually written, never from a naming
                # convention: the stem differs between backends.
                "images": [{"url": f"/api/media/file/{item['file']}",
                            "label": "image", "pixel": False}
                           for item in job.outputs if item.get("file")],
                "shown": SHOWN,
            },
        )
