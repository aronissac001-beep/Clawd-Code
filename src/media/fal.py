"""Image and video generation through fal.ai.

fal exposes 1000+ model endpoints behind one queue protocol, so a single client
covers text-to-image, image editing, text-to-video and image-to-video. Only the
endpoint id and the payload shape change.

Three decisions worth stating:

**The queue, not the sync endpoint.** ``https://fal.run/{model}`` returns the
result in the response, which is fine for a fast image and useless for video --
a Kling generation takes minutes and no sensible HTTP timeout survives it.
``https://queue.fal.run/{model}`` returns immediately with a request id and is
polled. Since one code path has to handle video anyway, images go through it
too rather than maintaining two.

**Never construct the poll URLs.** For ``fal-ai/flux/dev`` the status URL is
``.../fal-ai/flux/requests/{id}/status`` -- the trailing path segment is
dropped, because ``dev`` is a variant of the ``flux`` app rather than an app of
its own. How many segments to drop is not derivable from the id: compare
``fal-ai/kling-video/v3/pro/text-to-video``. The submit response carries
``status_url``, ``response_url`` and ``cancel_url`` outright, so those are used
verbatim and the question never arises.

**Images go in as data URIs.** fal has a storage API for uploads, but every
image input also accepts a ``data:`` URI. Inlining avoids a second round trip,
a second failure mode, and leaving files on someone else's bucket.

Model ids rot. fal's own documentation says to fetch a model's ``llms.txt``
rather than trusting an id remembered from training data, so ``CATALOG`` below
is a starting point rather than a closed set -- the UI lets any endpoint id be
typed in, and an unknown id fails with fal's own error rather than ours.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

QUEUE_BASE = "https://queue.fal.run"

# fal bills per generation. Polling every 250ms would not cost more, but it
# would hammer the endpoint for a job measured in minutes; 1.5s is responsive
# enough for a progress bar.
POLL_INTERVAL_S = 1.5
POLL_TIMEOUT_S = 900  # video models genuinely take this long


class FalError(RuntimeError):
    """Raised when fal rejects a request or a job fails."""


# ---------------------------------------------------------------------------
# catalogue
# ---------------------------------------------------------------------------

TASKS = ("text-to-image", "image-to-image", "text-to-video", "image-to-video")


@dataclass(frozen=True)
class Param:
    """One tunable input, described well enough for the UI to draw a control."""

    name: str
    label: str
    kind: str = "text"  # text | int | float | select | bool
    default: Any = None
    options: tuple[str, ...] = ()
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    help: str = ""

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "kind": self.kind,
            "default": self.default,
            "options": list(self.options),
            "min": self.minimum,
            "max": self.maximum,
            "help": self.help,
        }


IMAGE_SIZES = (
    "square_hd", "square", "portrait_4_3", "portrait_16_9",
    "landscape_4_3", "landscape_16_9",
)

_IMAGE_PARAMS = (
    Param("image_size", "Size", "select", "landscape_4_3", IMAGE_SIZES),
    Param("num_images", "Count", "int", 1, minimum=1, maximum=4),
    Param("num_inference_steps", "Steps", "int", 28, minimum=1, maximum=50,
          help="More steps, more detail, more time."),
    Param("guidance_scale", "Guidance", "float", 3.5, minimum=1, maximum=20,
          help="How literally the prompt is followed."),
    Param("seed", "Seed", "int", None, help="Leave empty for random."),
)

_FAST_IMAGE_PARAMS = (
    Param("image_size", "Size", "select", "landscape_4_3", IMAGE_SIZES),
    Param("num_images", "Count", "int", 1, minimum=1, maximum=4),
    Param("num_inference_steps", "Steps", "int", 4, minimum=1, maximum=12),
    Param("seed", "Seed", "int", None, help="Leave empty for random."),
)

_EDIT_PARAMS = (
    Param("guidance_scale", "Guidance", "float", 3.5, minimum=1, maximum=20),
    Param("num_images", "Count", "int", 1, minimum=1, maximum=4),
    Param("seed", "Seed", "int", None),
)

_VIDEO_PARAMS = (
    Param("duration", "Duration", "select", "5", ("5", "10"), help="Seconds."),
    Param("aspect_ratio", "Aspect", "select", "16:9", ("16:9", "9:16", "1:1")),
    Param("negative_prompt", "Avoid", "text", "", help="What to keep out."),
)


@dataclass(frozen=True)
class MediaModel:
    id: str
    label: str
    task: str
    notes: str = ""
    params: tuple[Param, ...] = ()
    prompt_field: str = "prompt"
    image_field: str = "image_url"

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "task": self.task,
            "notes": self.notes,
            "params": [p.as_dict() for p in self.params],
            "needs_image": self.task in ("image-to-image", "image-to-video"),
        }


CATALOG: tuple[MediaModel, ...] = (
    MediaModel("fal-ai/flux/schnell", "FLUX schnell", "text-to-image",
               "Fastest. Good for drafts and iteration.", _FAST_IMAGE_PARAMS),
    MediaModel("fal-ai/flux/dev", "FLUX dev", "text-to-image",
               "Slower, noticeably better detail.", _IMAGE_PARAMS),
    MediaModel("fal-ai/flux-pro/v1.1-ultra", "FLUX 1.1 Pro Ultra", "text-to-image",
               "Highest fidelity. Costs the most per image.", _IMAGE_PARAMS),
    MediaModel("fal-ai/recraft-v3", "Recraft v3", "text-to-image",
               "Strong at vector art, logos and legible text.", _IMAGE_PARAMS),

    MediaModel("fal-ai/flux-pro/kontext", "FLUX Kontext", "image-to-image",
               "Edit an existing image by describing the change.", _EDIT_PARAMS),
    MediaModel("fal-ai/flux/dev/image-to-image", "FLUX dev img2img", "image-to-image",
               "Re-render an image towards a prompt.",
               _EDIT_PARAMS + (Param("strength", "Strength", "float", 0.85,
                                     minimum=0.0, maximum=1.0,
                                     help="How far from the original."),)),

    MediaModel("fal-ai/kling-video/v3/pro/text-to-video", "Kling v3 Pro", "text-to-video",
               "High quality, minutes per clip.", _VIDEO_PARAMS),
    MediaModel("fal-ai/minimax/hailuo-02/standard/text-to-video",
               "Hailuo 02", "text-to-video", "Faster, cheaper.", _VIDEO_PARAMS),

    MediaModel("fal-ai/kling-video/v3/pro/image-to-video", "Kling v3 Pro", "image-to-video",
               "Animate a still image.", _VIDEO_PARAMS),
    MediaModel("fal-ai/minimax/hailuo-02/standard/image-to-video",
               "Hailuo 02", "image-to-video", "Faster, cheaper.", _VIDEO_PARAMS),
)


def models_for_task(task: str) -> list[MediaModel]:
    return [m for m in CATALOG if m.task == task]


def find_model(model_id: str) -> Optional[MediaModel]:
    return next((m for m in CATALOG if m.id == model_id), None)


# ---------------------------------------------------------------------------
# credentials and storage
# ---------------------------------------------------------------------------


def fal_key() -> Optional[str]:
    """The fal API key, from the environment or the clawd config.

    Checked in that order so a shell export wins over a stored key, which is
    what you want when testing a second account.
    """
    for var in ("FAL_KEY", "FAL_API_KEY"):
        value = os.environ.get(var, "").strip()
        if value:
            return value
    try:
        from ..config import load_config

        entry = (load_config().get("providers") or {}).get("fal") or {}
        value = (entry.get("api_key") or "").strip()
        return value or None
    except Exception:
        return None


def media_root() -> Path:
    """Where generated media lands.

    Outside the workspace on purpose: generations are experiments, and dropping
    megabytes of video into someone's git repo is not a helpful default. The UI
    offers an explicit "save to workspace" for the ones worth keeping.
    """
    root = Path.home() / ".clawd" / "media"
    root.mkdir(parents=True, exist_ok=True)
    return root


def to_data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{payload}"


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def _request(url: str, key: str, method: str = "GET",
             body: Optional[dict] = None, timeout: int = 60) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Key {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "clawd-code/1.0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8")[:600]
        except Exception:
            pass
        # fal returns a JSON body with the real reason; surfacing the status
        # code alone turns "your prompt was rejected" into "HTTP 422".
        raise FalError(f"fal returned {exc.code} for {url}\n{detail}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise FalError(f"cannot reach fal: {exc}") from exc

    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise FalError(f"fal returned a non-JSON body: {raw[:200]}") from exc


def _extract_outputs(data: dict) -> list[dict]:
    """Pull media URLs out of a result, whatever shape the model used.

    Every model returns something different -- ``images: [{url}]``,
    ``video: {url}``, ``audio_url``, a bare ``url``. Rather than a per-model
    adapter that breaks whenever the catalogue moves, walk the structure and
    collect anything that looks like a media URL.
    """
    found: list[dict] = []
    seen: set[str] = set()

    def kind_of(url: str, content_type: str) -> str:
        blob = f"{content_type} {url}".lower()
        if "video" in blob or blob.rsplit("?", 1)[0].endswith((".mp4", ".webm", ".mov")):
            return "video"
        if "audio" in blob or blob.rsplit("?", 1)[0].endswith((".mp3", ".wav", ".ogg")):
            return "audio"
        return "image"

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            url = node.get("url")
            if isinstance(url, str) and url.startswith("http") and url not in seen:
                seen.add(url)
                found.append({
                    "url": url,
                    "kind": kind_of(url, str(node.get("content_type") or "")),
                    "width": node.get("width"),
                    "height": node.get("height"),
                })
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    return found


def download(url: str, dest_dir: Path, stem: str) -> Optional[Path]:
    """Fetch a generated file locally.

    fal's result URLs expire. Anything worth showing in a gallery has to be
    pulled down at generation time or the gallery is a wall of broken images an
    hour later.
    """
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "clawd-code/1.0"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = resp.read()
            ctype = resp.headers.get("Content-Type", "")
    except (urllib.error.URLError, TimeoutError, OSError):
        return None

    suffix = mimetypes.guess_extension(ctype.split(";")[0].strip()) or ""
    if not suffix:
        tail = url.rsplit("?", 1)[0].rsplit(".", 1)
        suffix = f".{tail[-1]}" if len(tail) == 2 and len(tail[-1]) <= 5 else ".bin"
    if suffix == ".jpe":
        suffix = ".jpg"

    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / f"{stem}{suffix}"
    path.write_bytes(payload)
    return path


# ---------------------------------------------------------------------------
# jobs
# ---------------------------------------------------------------------------


@dataclass
class Job:
    id: str
    model: str
    task: str
    prompt: str
    status: str = "queued"  # queued | running | done | error | cancelled
    queue_position: Optional[int] = None
    error: str = ""
    outputs: list[dict] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    logs: list[str] = field(default_factory=list)
    _cancel: bool = False

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "model": self.model,
            "task": self.task,
            "prompt": self.prompt,
            "status": self.status,
            "queue_position": self.queue_position,
            "error": self.error,
            "outputs": self.outputs,
            "created_at": self.created_at,
            "elapsed": round((self.finished_at or time.time()) - self.created_at, 1),
            "logs": self.logs[-6:],
        }


class JobStore:
    """Runs fal generations on background threads and keeps their state.

    Generation is minutes long for video, so the HTTP request that starts a job
    returns as soon as it is queued. The UI polls this store. That also means a
    browser refresh does not lose an in-flight job.
    """

    def __init__(self, max_history: int = 60):
        self._jobs: dict[str, Job] = {}
        self._order: list[str] = []
        self._lock = threading.Lock()
        self.max_history = max_history

    def list(self) -> list[dict]:
        with self._lock:
            return [self._jobs[i].as_dict() for i in reversed(self._order)
                    if i in self._jobs]

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in ("done", "error", "cancelled"):
                return False
            job._cancel = True
            return True

    def _add(self, job: Job) -> None:
        with self._lock:
            self._jobs[job.id] = job
            self._order.append(job.id)
            while len(self._order) > self.max_history:
                self._jobs.pop(self._order.pop(0), None)

    def submit(self, model_id: str, task: str, prompt: str,
               payload: dict, key: str) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], model=model_id, task=task, prompt=prompt)
        self._add(job)
        thread = threading.Thread(
            target=self._run, args=(job, model_id, payload, key), daemon=True
        )
        thread.start()
        return job

    def _run(self, job: Job, model_id: str, payload: dict, key: str) -> None:
        try:
            submitted = _request(f"{QUEUE_BASE}/{model_id}", key,
                                 method="POST", body=payload)
            # Use fal's own URLs -- see the module docstring on why these
            # cannot be reconstructed from the model id.
            status_url = submitted.get("status_url")
            response_url = submitted.get("response_url")
            if not status_url or not response_url:
                raise FalError(
                    f"fal accepted the job but returned no polling URLs: "
                    f"{json.dumps(submitted)[:300]}"
                )

            job.status = "running"
            deadline = time.time() + POLL_TIMEOUT_S

            while True:
                if job._cancel:
                    job.status = "cancelled"
                    job.finished_at = time.time()
                    cancel_url = submitted.get("cancel_url")
                    if cancel_url:
                        try:
                            _request(cancel_url, key, method="PUT")
                        except FalError:
                            pass  # best effort; the job is already off our list
                    return

                if time.time() > deadline:
                    raise FalError(
                        f"timed out after {POLL_TIMEOUT_S}s waiting for fal"
                    )

                state = _request(status_url, key)
                status = str(state.get("status") or "").upper()
                position = state.get("queue_position")
                if isinstance(position, int):
                    job.queue_position = position

                for entry in state.get("logs") or []:
                    message = entry.get("message") if isinstance(entry, dict) else None
                    if message and message not in job.logs:
                        job.logs.append(str(message))

                if status == "COMPLETED":
                    break
                if status in ("FAILED", "ERROR", "CANCELLED"):
                    raise FalError(
                        f"fal reported {status.lower()}: "
                        f"{json.dumps(state)[:300]}"
                    )
                time.sleep(POLL_INTERVAL_S)

            result = _request(response_url, key, timeout=120)
            outputs = _extract_outputs(result)
            if not outputs:
                raise FalError(
                    f"the job completed but returned no media: "
                    f"{json.dumps(result)[:300]}"
                )

            stored: list[dict] = []
            for index, item in enumerate(outputs):
                local = download(item["url"], media_root(), f"{job.id}-{index}")
                stored.append({
                    **item,
                    "file": local.name if local else None,
                    "local": bool(local),
                })
            job.outputs = stored
            job.status = "done"
            job.finished_at = time.time()

        except FalError as exc:
            job.status = "error"
            job.error = str(exc)
            job.finished_at = time.time()
        except Exception as exc:  # a crash here would silently wedge the job
            job.status = "error"
            job.error = f"{type(exc).__name__}: {exc}"
            job.finished_at = time.time()


def build_payload(model: Optional[MediaModel], model_id: str, prompt: str,
                  params: dict, image_uri: Optional[str]) -> dict:
    """Assemble the request body, dropping anything the user left blank.

    Sending ``seed: null`` is not the same as omitting it -- some endpoints
    reject an explicit null where they would happily default. Empty means
    absent.
    """
    prompt_field = model.prompt_field if model else "prompt"
    image_field = model.image_field if model else "image_url"

    payload: dict[str, Any] = {prompt_field: prompt}
    known = {p.name: p for p in (model.params if model else ())}

    for name, value in (params or {}).items():
        if value is None or value == "":
            continue
        spec = known.get(name)
        if spec is not None and spec.kind == "int":
            try:
                value = int(value)
            except (TypeError, ValueError):
                continue
        elif spec is not None and spec.kind == "float":
            try:
                value = float(value)
            except (TypeError, ValueError):
                continue
        payload[name] = value

    if image_uri:
        payload[image_field] = image_uri
    return payload
