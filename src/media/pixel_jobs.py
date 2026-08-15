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
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from .fal import (FalError, _extract_outputs, _request, QUEUE_BASE, download,
                  is_pollinations, media_root, run_pollinations)
from .pixelart import (ANIMATIONS, DIRECTIONS, DIRECTIONS_4, PixelError,
                       build_gif, build_sheet, direction_prompt, frame_prompt,
                       lora_by_id, quantise_to_sprite, sprite_prompt)

FLUX_LORA_MODEL = "fal-ai/flux-lora"
POLL_INTERVAL_S = 1.5
JOB_TIMEOUT_S = 900


def pixel_root() -> Path:
    root = media_root() / "pixel"
    root.mkdir(parents=True, exist_ok=True)
    return root


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
            "elapsed": round((self.finished_at or time.time()) - self.created_at, 1),
        }


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

    def submit(self, kind: str, brief: str, *, lora: str = "retro",
               grid: int = 64, palette: int = 24, backend: str = "fal",
               action: str = "walk", directions: int = 8,
               key: Optional[str] = None, describe=None) -> PixelJob:
        job = PixelJob(id=uuid.uuid4().hex[:12], kind=kind, brief=brief,
                       lora=lora, grid=grid, palette=palette, backend=backend)
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
            # that does not cost a model call.
            seed = int(time.time() * 1000) % 2_000_000_000

            raw_dir = pixel_root() / job.id
            raw_dir.mkdir(parents=True, exist_ok=True)
            shared_palette: Optional[Path] = None

            for index, (label, prompt) in enumerate(prompts):
                if job._cancel:
                    job.status = "cancelled"
                    job.finished_at = time.time()
                    return

                job.logs.append(f"{index + 1}/{len(prompts)} {label}")
                raw = self._generate(job, prompt, seed, raw_dir,
                                     f"raw-{index:02d}", key)

                sprite = raw_dir / f"{index:02d}-{label}.png"
                info = quantise_to_sprite(
                    raw, sprite, grid=job.grid, palette=job.palette,
                    upscale=6, background="transparent",
                )
                if shared_palette is None:
                    shared_palette = sprite
                info.update({"label": label, "prompt": prompt,
                             "dir": job.id})
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
        """One image, from whichever backend the job asked for."""
        if job.backend == "pollinations":
            out = run_pollinations("pollinations/flux", prompt,
                                   {"width": 1024, "height": 1024, "seed": seed},
                                   dest_dir, stem)
            return dest_dir / out[0]["file"]

        if not key:
            raise FalError("fal needs an API key; switch the backend to "
                           "Pollinations to generate without one")

        lora = lora_by_id(job.lora)
        payload: dict[str, Any] = {
            "prompt": prompt,
            "image_size": {"width": 1024, "height": 1024},
            "num_inference_steps": 28,
            "num_images": 1,
            "seed": seed,
            "enable_safety_checker": False,
        }
        if lora and lora.url:
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
