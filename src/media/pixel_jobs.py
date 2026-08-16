"""Sprite, rotation and animation jobs -- the PixelLab-shaped operations.

Each job is a set of images that have to agree with each other. A rotation is
eight views of the same character; an animation is six frames of one motion.
Consistency across the set is the whole difficulty, and it is what separates
this from calling an image model eight times.

Three things are done about that:

    one seed per job     every frame is generated from the same seed, which
                         holds the design steady far better than wording alone
    shared design brief  an LLM expands the user's few words into a fixed
                         description of the character -- colours, silhouette,
                         distinguishing features -- reused verbatim in every
                         frame prompt
    identical palette    all frames are quantised against the first frame's
                         palette, so no frame drifts to a different set of
                         colours even if the model does

The third is the one that matters most and needs no model at all.
"""

from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from .fal import (FalError, _extract_outputs, _request, QUEUE_BASE, download,
                  is_pollinations, media_root, note_fal_refusal,
                  run_pollinations)
from .pixelart import (ANIMATIONS, DIRECTIONS, DIRECTIONS_4, PixelError,
                       build_gif, build_sheet, direction_prompt, frame_prompt,
                       lora_by_id, quantise_to_sprite, sprite_prompt)

FLUX_LORA_MODEL = "fal-ai/flux-lora"
POLL_INTERVAL_S = 1.5
JOB_TIMEOUT_S = 900

# How many frames to generate at once, per backend.
#
# fal is a real job queue and is happy to run a turnaround in parallel.
# Pollinations rate-limits per IP rather than per connection -- measured, it
# answers 429 to a second concurrent request and keeps answering 429 for a
# while afterwards -- so for that backend, parallelism does not just fail to
# help, it makes the whole sheet fail. One at a time, with backoff, is the
# fastest way through a per-IP limit.
FETCH_WORKERS = {"fal": 4, "pollinations": 1}


def pixel_root() -> Path:
    root = media_root() / "pixel"
    root.mkdir(parents=True, exist_ok=True)
    return root


# Refusals about the account rather than the request. Retrying these is
# pointless and switching backends is the only thing that helps; a 422 on a
# rejected prompt would fail the same way on any backend, so it is not here.
_ACCOUNT_SIGNS = ("exhausted balance", "user is locked", "top up",
                  "unauthorized", "invalid api key", "forbidden",
                  "fal 401", "fal 402", "fal 403")


def _account_refusal(exc: BaseException) -> bool:
    return any(sign in str(exc).lower() for sign in _ACCOUNT_SIGNS)


@dataclass
class PixelJob:
    id: str
    kind: str                      # sprite | rotation | animation
    brief: str
    lora: str
    grid: int
    palette: int
    backend: str
    status: str = "queued"
    error: str = ""
    logs: list[str] = field(default_factory=list)
    frames: list[dict] = field(default_factory=list)
    sheet: Optional[dict] = None
    gif: Optional[dict] = None
    design: str = ""
    # The seed every frame was generated from. Assigned when the job runs if
    # the caller did not pick one, so a result is always reproducible after
    # the fact -- which is what makes "same character, new pose" possible.
    seed: Optional[int] = None
    created_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    _cancel: bool = False

    def as_dict(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "brief": self.brief,
            "lora": self.lora, "grid": self.grid, "palette": self.palette,
            "backend": self.backend, "status": self.status, "error": self.error,
            "logs": self.logs[-8:], "frames": self.frames,
            "sheet": self.sheet, "gif": self.gif, "design": self.design,
            "seed": self.seed,
            "elapsed": round((self.finished_at or time.time()) - self.created_at, 1),
        }


_STUDIO: Optional["PixelStudio"] = None
_STUDIO_LOCK = threading.Lock()


def studio() -> "PixelStudio":
    """The one studio in this process.

    Deliberately here rather than in the web layer: both the HTTP endpoints and
    the agent's own tool need it, and they need the *same* one. Two studios
    would mean art generated from chat never appearing in the Pixels tab, which
    looks exactly like the generation having silently failed.
    """
    global _STUDIO
    with _STUDIO_LOCK:
        if _STUDIO is None:
            _STUDIO = PixelStudio()
        return _STUDIO


class PixelStudio:
    """Runs pixel-art jobs on background threads."""

    def __init__(self, max_history: int = 40):
        self._jobs: dict[str, PixelJob] = {}
        self._order: list[str] = []
        self._lock = threading.Lock()
        self.max_history = max_history

    def list(self) -> list[dict]:
        with self._lock:
            return [self._jobs[i].as_dict() for i in reversed(self._order)
                    if i in self._jobs]

    def get(self, job_id: str) -> Optional[PixelJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in ("done", "error", "cancelled"):
                return False
            job._cancel = True
            return True

    def submit(self, kind: str, brief: str, *, lora: Optional[str] = "retro",
               grid: int = 64, palette: int = 24, backend: str = "fal",
               action: str = "walk", directions: int = 8,
               key: Optional[str] = None, describe=None,
               seed: Optional[int] = None) -> PixelJob:
        job = PixelJob(id=uuid.uuid4().hex[:12], kind=kind, brief=brief,
                       lora=lora, grid=grid, palette=palette, backend=backend,
                       seed=seed)
        with self._lock:
            self._jobs[job.id] = job
            self._order.append(job.id)
            while len(self._order) > self.max_history:
                self._jobs.pop(self._order.pop(0), None)

        threading.Thread(
            target=self._run, daemon=True,
            args=(job, action, directions, key, describe),
        ).start()
        return job

    # -- the work ----------------------------------------------------------

    def _run(self, job: PixelJob, action: str, directions: int,
             key: Optional[str], describe) -> None:
        try:
            job.status = "running"
            lora = lora_by_id(job.lora)

            # A fixed design brief, reused verbatim in every frame. Without it
            # the model reinvents the character between views and the set is
            # unusable as a sprite sheet.
            if describe is not None and job.kind in ("rotation", "animation"):
                job.logs.append("writing a design brief…")
                try:
                    job.design, note = describe(job.brief)
                    if note:
                        job.logs.append(note)
                except Exception as exc:
                    job.logs.append(
                        f"art direction failed ({type(exc).__name__}); "
                        f"using the brief as written")
            subject = f"{job.brief}. {job.design}".strip() if job.design else job.brief

            prompts = self._prompts(job, subject, lora, action, directions)
            # One seed for the whole set: the strongest lever on consistency
            # that does not cost a model call. Recorded on the job, so a set
            # the user liked can be reproduced or varied deliberately instead
            # of being rerolled and hoped for.
            seed = job.seed if job.seed is not None else (
                int(time.time() * 1000) % 2_000_000_000)
            job.seed = seed

            raw_dir = pixel_root() / job.id
            raw_dir.mkdir(parents=True, exist_ok=True)

            # Fetch the frames concurrently.
            #
            # These are independent HTTP requests, and doing them one after
            # another made the wall time the sum of the slowest backend's mood:
            # measured at ~40s per frame on Pollinations under load, an
            # eight-direction turnaround took over five minutes, which is
            # longer than the chat stream will wait before deciding the turn is
            # dead. Concurrency makes the job cost roughly one frame instead of
            # all of them.
            #
            done = 0
            workers = min(FETCH_WORKERS.get(job.backend, 1), len(prompts))

            def fetch(item: tuple[int, tuple[str, str]]) -> tuple[int, Path]:
                nonlocal done
                index, (label, prompt) = item
                if job._cancel:
                    raise PixelError("cancelled")
                path = self._generate(job, prompt, seed, raw_dir,
                                      f"raw-{index:02d}", key)
                done += 1
                job.logs.append(f"{done}/{len(prompts)} {label}")
                return index, path

            if workers > 1:
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    raws = dict(pool.map(fetch, enumerate(prompts)))
            else:
                raws = dict(fetch(item) for item in enumerate(prompts))

            if job._cancel:
                job.status = "cancelled"
                job.finished_at = time.time()
                return

            # Quantise in order. This part is local and fast, and doing it
            # serially keeps the frame list deterministic -- a rotation whose
            # facings arrive shuffled is not a rotation.
            # The first frame sets the palette and every later frame is
            # quantised against it, so the set shares one set of colours. This
            # is the cheapest consistency lever there is -- no model call, and
            # it fixes the flicker that otherwise makes an animation unusable.
            shared_palette: Optional[Path] = None
            for index, (label, prompt) in enumerate(prompts):
                sprite = raw_dir / f"{index:02d}-{label}.png"
                info = quantise_to_sprite(
                    raws[index], sprite, grid=job.grid, palette=job.palette,
                    upscale=6, background="transparent",
                    palette_from=shared_palette,
                )
                if shared_palette is None:
                    shared_palette = sprite
                info.update({"label": label, "prompt": prompt, "dir": job.id})
                job.frames.append(info)

            paths = [raw_dir / f["file"] for f in job.frames]
            if len(paths) > 1:
                columns = 4 if job.kind == "rotation" else len(paths)
                job.sheet = {**build_sheet(paths, raw_dir / "sheet.png", columns),
                             "dir": job.id}
                if job.kind == "animation":
                    job.gif = {**build_gif(paths, raw_dir / "anim.gif", fps=8),
                               "dir": job.id}

            job.status = "done"
            job.finished_at = time.time()

        except (FalError, PixelError) as exc:
            job.status = "error"
            job.error = str(exc)
            job.finished_at = time.time()
        except Exception as exc:
            job.status = "error"
            job.error = f"{type(exc).__name__}: {exc}"
            job.finished_at = time.time()

    def _prompts(self, job: PixelJob, subject: str, lora, action: str,
                 directions: int) -> list[tuple[str, str]]:
        if job.kind == "sprite":
            return [("sprite", sprite_prompt(subject, lora, job.grid))]

        if job.kind == "rotation":
            facings = DIRECTIONS if directions >= 8 else DIRECTIONS_4
            return [(d, direction_prompt(subject, lora, job.grid, d))
                    for d in facings]

        if job.kind == "animation":
            spec = ANIMATIONS.get(action) or ANIMATIONS["walk"]
            total = spec["frames"]
            return [(f"{action}-{i}",
                     frame_prompt(subject, lora, job.grid, action, i, total,
                                  spec["beat"]))
                    for i in range(total)]

        raise PixelError(f"unknown job kind {job.kind!r}")

    def _generate(self, job: PixelJob, prompt: str, seed: int,
                  dest_dir: Path, stem: str, key: Optional[str]) -> Path:
        """One image, from whichever backend the job asked for.

        Falls back to Pollinations when fal will not serve *this account* --
        no key, an exhausted balance, a revoked key. A rotation is eight
        images and an animation more; failing the whole set on frame one when
        a keyless backend is sitting right there is the wrong trade, and the
        user finds out either way because the swap is logged.
        """
        if job.backend == "pollinations":
            out = run_pollinations("pollinations/flux", prompt,
                                   {"width": 1024, "height": 1024, "seed": seed},
                                   dest_dir, stem)
            return dest_dir / out[0]["file"]

        if not key:
            job.logs.append("no fal key — using Pollinations instead")
            job.backend = "pollinations"
            return self._generate(job, prompt, seed, dest_dir, stem, key)

        try:
            return self._generate_fal(job, prompt, seed, dest_dir, stem, key)
        except FalError as exc:
            if job._cancel or not _account_refusal(exc):
                raise
            # Switch for the rest of the job, not just this frame: the balance
            # will not refill between frame two and frame three. And remember
            # it process-wide, so the *next* job does not pay the same failed
            # round trip before falling back.
            note_fal_refusal()
            job.logs.append(f"fal refused this account ({exc}) — "
                            f"finishing on Pollinations")
            if job.lora:
                job.logs.append("note: the LoRA is a fal feature and is not "
                                "applied on Pollinations")
            job.backend = "pollinations"
            return self._generate(job, prompt, seed, dest_dir, stem, key)

    def _generate_fal(self, job: PixelJob, prompt: str, seed: int,
                      dest_dir: Path, stem: str, key: str) -> Path:
        lora = lora_by_id(job.lora)
        payload: dict[str, Any] = {
            "prompt": prompt,
            "image_size": {"width": 1024, "height": 1024},
            "num_inference_steps": 28,
            "num_images": 1,
            "seed": seed,
            "enable_safety_checker": False,
        }
        # `repo`, not `url`: url is an f-string and so is always truthy -- for
        # the "No LoRA" entry it interpolates to
        # "https://huggingface.co//resolve/main/", which fal would be asked to
        # fetch. Invisible while fal refuses the account; the first thing to
        # break the day someone tops up.
        if lora and lora.repo:
            payload["loras"] = [{"path": lora.url, "scale": 1.0}]

        submitted = _request(f"{QUEUE_BASE}/{FLUX_LORA_MODEL}", key,
                             method="POST", body=payload)
        status_url = submitted.get("status_url")
        response_url = submitted.get("response_url")
        if not status_url or not response_url:
            raise FalError(f"fal returned no polling URLs: {submitted}")

        deadline = time.time() + JOB_TIMEOUT_S
        while True:
            if job._cancel:
                raise FalError("cancelled")
            if time.time() > deadline:
                raise FalError("timed out waiting for fal")
            state = _request(status_url, key)
            status = str(state.get("status") or "").upper()
            if status == "COMPLETED":
                break
            if status in ("FAILED", "ERROR", "CANCELLED"):
                raise FalError(f"fal reported {status.lower()}")
            time.sleep(POLL_INTERVAL_S)

        result = _request(response_url, key, timeout=120)
        outputs = _extract_outputs(result)
        if not outputs:
            raise FalError("fal returned no image")

        path = download(outputs[0]["url"], dest_dir, stem)
        if path is None:
            raise FalError("could not download the generated image")
        return path
