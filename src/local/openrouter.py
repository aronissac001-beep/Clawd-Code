"""OpenRouter model catalog: which models are genuinely free, and which cost.

The free roster rotates constantly -- providers add, pull and reprice models,
and the count moved between 14 and 29 over a single month -- so a hardcoded
list would silently rot into either "model not found" errors or, worse,
unexpected charges. Everything here is resolved against the live catalogue.

Two rules make ``free_only`` an actual guarantee rather than a naming
convention:

1. **Never trust the ``:free`` suffix.** It is a naming convention, not a
   contract. A model can be renamed or repriced while keeping the suffix.
2. **Check every pricing field, not just prompt and completion.** The pricing
   object also carries ``internal_reasoning``, ``web_search`` and cache-write
   rates. A model billing zero for tokens but non-zero for reasoning would
   still spend money. (At the time of writing all 18 free models are zero
   across every field -- this check keeps that true rather than assuming it.)
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

MODELS_URL = "https://openrouter.ai/api/v1/models"
CACHE_NAME = "openrouter-models.json"
DEFAULT_TTL_S = 3600  # the roster moves, but not minute to minute

# OpenRouter's auto-router for zero-cost models: it picks a free model that
# fits the request rather than pinning one that may be pulled tomorrow.
FREE_AUTO_MODEL = "openrouter/free"


class CatalogError(RuntimeError):
    """Raised when the catalogue cannot be fetched or a model cannot be verified."""


@dataclass(frozen=True)
class ModelInfo:
    id: str
    name: str
    context_length: int
    is_free: bool
    prompt_price: float
    completion_price: float
    nonzero_fields: tuple[str, ...] = ()
    input_modalities: tuple[str, ...] = ()
    output_modalities: tuple[str, ...] = ()

    @property
    def price_summary(self) -> str:
        if self.is_free:
            return "free"
        # Prices are per token; per-million is the readable unit.
        return (f"${self.prompt_price * 1e6:.2f}/M in, "
                f"${self.completion_price * 1e6:.2f}/M out")

    @property
    def is_text_model(self) -> bool:
        """Usable as a coding assistant: takes text in, emits text out.

        The free pool is not all chat models -- it currently includes music
        generators (google/lyria-*, which output text/audio). Routing an agent
        to one produces confident nonsense, so they are filtered out of
        suggestions and listings by default.
        """
        if not self.output_modalities:
            return True  # unannotated: assume text rather than hide it
        if "text" not in self.output_modalities:
            return False
        # Anything also emitting audio or image is a generation model, not a
        # chat model, regardless of it nominally producing text too.
        return not ({"audio", "image", "video"} & set(self.output_modalities))


def _as_float(value: object) -> float:
    """Pricing values arrive as strings ('0.000000375'). Missing means zero."""
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        # An unparseable price is treated as non-zero: refusing to call a model
        # is always safer than charging the user by accident.
        return float("inf")


def _classify(entry: dict) -> ModelInfo:
    pricing = entry.get("pricing") or {}
    nonzero: list[str] = []
    for field, raw in pricing.items():
        if _as_float(raw) != 0.0:
            nonzero.append(field)
    arch = entry.get("architecture") or {}
    return ModelInfo(
        id=entry.get("id", ""),
        name=entry.get("name") or entry.get("id", ""),
        context_length=int(entry.get("context_length") or 0),
        is_free=not nonzero,
        prompt_price=_as_float(pricing.get("prompt")),
        completion_price=_as_float(pricing.get("completion")),
        nonzero_fields=tuple(sorted(nonzero)),
        input_modalities=tuple(arch.get("input_modalities") or ()),
        output_modalities=tuple(arch.get("output_modalities") or ()),
    )


class ModelCatalog:
    """Cached view of the OpenRouter model list."""

    def __init__(self, cache_dir: Path, ttl_s: int = DEFAULT_TTL_S):
        self.cache_path = Path(cache_dir) / CACHE_NAME
        self.ttl_s = ttl_s
        self._models: Optional[dict[str, ModelInfo]] = None

    # -- fetching ----------------------------------------------------------

    def _fetch(self) -> list[dict]:
        req = urllib.request.Request(
            MODELS_URL, headers={"User-Agent": "clawd-local/1.0"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        data = payload.get("data")
        if not isinstance(data, list) or not data:
            raise CatalogError("OpenRouter returned an empty model list")
        return data

    def _load_cache(self) -> Optional[list[dict]]:
        if not self.cache_path.is_file():
            return None
        age = time.time() - self.cache_path.stat().st_mtime
        if age > self.ttl_s:
            return None
        try:
            return json.loads(self.cache_path.read_text("utf-8"))
        except (OSError, ValueError):
            return None

    def _save_cache(self, data: list[dict]) -> None:
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(data), "utf-8")
        except OSError:
            pass  # a cache miss is not worth failing a request over

    def load(self, force: bool = False) -> dict[str, ModelInfo]:
        """Return {model_id: ModelInfo}, from cache when fresh."""
        if self._models is not None and not force:
            return self._models

        data = None if force else self._load_cache()
        if data is None:
            try:
                data = self._fetch()
                self._save_cache(data)
            except (urllib.error.URLError, OSError, ValueError, TimeoutError) as exc:
                stale = self._stale_cache()
                if stale is None:
                    raise CatalogError(
                        f"cannot reach the OpenRouter model catalogue: {exc}"
                    ) from exc
                data = stale

        self._models = {m.id: m for m in (_classify(e) for e in data) if m.id}
        return self._models

    def _stale_cache(self) -> Optional[list[dict]]:
        """Any cached copy, ignoring TTL. Better stale than unusable offline."""
        if not self.cache_path.is_file():
            return None
        try:
            return json.loads(self.cache_path.read_text("utf-8"))
        except (OSError, ValueError):
            return None

    # -- queries -----------------------------------------------------------

    def get(self, model_id: str) -> Optional[ModelInfo]:
        return self.load().get(model_id)

    def free_models(self, text_only: bool = True) -> list[ModelInfo]:
        """Zero-cost models, largest context first.

        ``text_only`` excludes generation models (music, image) that happen to
        be free but are useless to a coding agent.
        """
        return sorted(
            (m for m in self.load().values()
             if m.is_free and (m.is_text_model or not text_only)),
            key=lambda m: (-m.context_length, m.id),
        )

    def paid_models(self) -> list[ModelInfo]:
        return sorted(
            (m for m in self.load().values() if not m.is_free), key=lambda m: m.id
        )

    # -- the guarantee -----------------------------------------------------

    def assert_free(self, model_id: str) -> ModelInfo:
        """Verify a model costs nothing, or raise.

        This is the single gate that makes ``free_only`` meaningful. It refuses
        anything it cannot positively verify as zero-cost, including models it
        has never heard of -- an unknown model is not a free model.
        """
        # The auto-router only ever selects zero-cost models, and is not itself
        # listed as a model, so it is allowed by name.
        if model_id == FREE_AUTO_MODEL:
            return ModelInfo(
                id=FREE_AUTO_MODEL,
                name="OpenRouter auto-router (free pool)",
                context_length=0,
                is_free=True,
                prompt_price=0.0,
                completion_price=0.0,
            )

        info = self.get(model_id)
        if info is None:
            raise CatalogError(
                f"model {model_id!r} is not in the OpenRouter catalogue, so it "
                f"cannot be verified as free. Refusing to send a request in "
                f"free_only mode.\nRun `/openrouter models` to see what is free "
                f"right now, or switch with `/openrouter mixed`."
            )
        if not info.is_free:
            charged = ", ".join(info.nonzero_fields) or "prompt/completion"
            raise CatalogError(
                f"model {model_id!r} is NOT free -- it charges for: {charged} "
                f"({info.price_summary}).\nSwitch with `/openrouter mixed` to "
                f"allow paid models, or pick a free one with `/openrouter models`."
            )
        return info

    def suggest_free(self, prefer_context: int = 0) -> str:
        """Pick a reasonable free chat model, preferring larger context.

        Coding-tuned models win ties: a model advertising itself as a coder is
        a better default for this tool than a general one of similar size.
        """
        candidates = [m for m in self.free_models() if m.context_length >= prefer_context]
        if not candidates:
            candidates = self.free_models()
        if not candidates:
            raise CatalogError(
                "OpenRouter currently lists no free text models. The roster "
                "rotates; try again later or use `/openrouter mixed`."
            )
        coders = [m for m in candidates if "code" in m.id.lower() or "coder" in m.id.lower()]
        return (coders or candidates)[0].id
