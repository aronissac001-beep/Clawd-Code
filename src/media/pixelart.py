"""Pixel art: generation, and the part that makes it actually pixel art.

The thing worth understanding before reading the rest: **a diffusion model does
not produce pixel art.** Prompt one for a sprite and you get a 1024x1024 image
that *looks* pixelated -- anti-aliased edges, soft gradients, several thousand
distinct colours, and a "pixel" grid that drifts by a fraction of a pixel
across the image. Drop it into a game at 64x64 and it turns to mush.

Real sprite work needs three things a model will not give you:

    an exact grid          every block the same size, aligned to the corner
    a small palette        16-64 colours, not 40,000
    hard edges             no anti-aliasing, no semi-transparent fringe

All three are deterministic image operations, so they happen here, locally,
with no model involved. That also means they work on output from any source --
fal, Pollinations, or a file someone drew by hand -- and they are the reason
this module is worth more than a prompt suffix saying "pixel art style".

The LoRAs below improve the input to that pipeline. They do not replace it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

# ---------------------------------------------------------------------------
# models
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PixelLora:
    """A LoRA fal can load, with the trigger its author trained it on."""

    id: str
    label: str
    repo: str
    weights: str
    trigger: str
    notes: str

    @property
    def url(self) -> str:
        return f"https://huggingface.co/{self.repo}/resolve/main/{self.weights}"

    def as_dict(self) -> dict:
        return {"id": self.id, "label": self.label, "repo": self.repo,
                "trigger": self.trigger, "notes": self.notes, "url": self.url}


# FLUX.1-dev LoRAs, because that is the base fal-ai/flux-lora serves. SDXL
# pixel LoRAs are more numerous and better trained (nerijs/pixel-art-xl has 639
# likes against Retro-Pixel's 91) but need an SDXL endpoint, so they are not
# usable here without a second backend.
PIXEL_LORAS: tuple[PixelLora, ...] = (
    PixelLora("retro", "Retro Pixel", "prithivMLmods/Retro-Pixel-Flux-LoRA",
              "Retro-Pixel.safetensors", "Retro Pixel",
              "Classic 8/16-bit look. The author notes it is still training, "
              "so it can produce artefacts."),
    PixelLora("modern", "Modern Pixel", "UmeAiRT/FLUX.1-dev-LoRA-Modern_Pixel_art",
              "FLUX-Modern_Pixel_art.safetensors", "modern pixel art",
              "Cleaner, more contemporary indie-game look."),
    PixelLora("none", "No LoRA", "", "", "",
              "Base FLUX with prompt guidance only. Rougher input, but the "
              "post-processing still produces a usable sprite."),
)


def lora_by_id(lora_id: str) -> Optional[PixelLora]:
    return next((l for l in PIXEL_LORAS if l.id == lora_id), None)


# ---------------------------------------------------------------------------
# PixelLab-equivalent presets
# ---------------------------------------------------------------------------

# Eight-way facing, the standard for top-down and isometric games. Ordered so
# adjacent entries are adjacent on screen, which is what a sprite sheet wants.
DIRECTIONS = ("south", "south-west", "west", "north-west",
              "north", "north-east", "east", "south-east")

DIRECTIONS_4 = ("south", "west", "north", "east")

ANIMATIONS: dict[str, dict[str, Any]] = {
    "idle":   {"frames": 4, "beat": "a subtle breathing loop, weight shifting slightly"},
    "walk":   {"frames": 6, "beat": "a walk cycle: contact, down, pass, up, contact, down"},
    "run":    {"frames": 6, "beat": "a fast run cycle with a long stride and airborne frame"},
    "attack": {"frames": 5, "beat": "a melee swing: wind-up, commit, impact, follow-through, recover"},
    "hurt":   {"frames": 3, "beat": "a recoil: impact, stagger back, recover"},
    "death":  {"frames": 5, "beat": "a collapse: stagger, buckle, fall, settle, still"},
}

SIZES = {
    "16": 16, "32": 32, "48": 48, "64": 64, "96": 96, "128": 128,
}

PALETTES = {
    "8": 8, "16": 16, "24": 24, "32": 32, "48": 48, "64": 64,
}


# ---------------------------------------------------------------------------
# the post-processing that makes it a sprite
# ---------------------------------------------------------------------------


class PixelError(RuntimeError):
    pass


def _pil():
    try:
        from PIL import Image, ImageOps  # noqa: F401

        return Image
    except ModuleNotFoundError as exc:  # pragma: no cover
        raise PixelError(
            "Pillow is required for pixel art post-processing: pip install Pillow"
        ) from exc


def quantise_to_sprite(
    source: Path,
    dest: Path,
    grid: int = 64,
    palette: int = 24,
    upscale: int = 0,
    background: str = "keep",
    tolerance: int = 32,
) -> dict[str, Any]:
    """Turn a generated image into an actual sprite.

    ``grid``       the sprite's real resolution, e.g. 64 means 64x64 pixels
    ``palette``    how many colours to keep
    ``upscale``    integer factor for a viewable copy; 0 to skip
    ``background`` keep | transparent -- flood the flat border colour out
    ``tolerance``  how close to the corner colour counts as background

    Downscaling uses BOX (area average) rather than NEAREST. NEAREST samples
    one source pixel per target pixel, which on a soft AI image picks up
    whatever happened to land on the sample point and throws away the rest --
    it looks noisy and loses thin features. Averaging first, then quantising to
    a small palette, is what produces clean flat blocks.
    """
    Image = _pil()

    if grid < 8 or grid > 512:
        raise PixelError("grid must be between 8 and 512")
    if palette < 2 or palette > 256:
        raise PixelError("palette must be between 2 and 256")

    try:
        image = Image.open(source).convert("RGBA")
    except OSError as exc:
        raise PixelError(f"cannot read {source.name}: {exc}") from exc

    original = image.size

    # Read the backdrop colour BEFORE padding. Squaring fills the margins with
    # transparent pixels, so a corner sample taken afterwards reads the padding
    # and the key becomes a no-op -- which is exactly what happened the first
    # time this ran: it reported success and changed nothing.
    key = _background_key(image, tolerance) if background == "transparent" else None

    # Square it off, so a landscape generation does not squash the sprite. Pad
    # rather than crop -- cropping eats limbs.
    side = max(image.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(image, ((side - image.width) // 2, (side - image.height) // 2))

    small = square.resize((grid, grid), Image.BOX)

    # Key after downscaling: a few thousand pixels rather than a million, and
    # the averaged colours are cleaner to match against.
    if key is not None:
        small = _key_out_colour(small, key, tolerance)

    # Quantise the colour channels only; the alpha we may have just created
    # must not be dithered into a speckled edge.
    alpha = small.getchannel("A")
    rgb = small.convert("RGB")
    reduced = rgb.quantize(colors=palette, method=Image.MEDIANCUT, dither=Image.NONE)
    out = reduced.convert("RGBA")
    out.putalpha(alpha)

    # Hard alpha: a sprite edge is in or out, never 40% there. Anti-aliased
    # fringing is the single most obvious tell of an AI "pixel art" image.
    out.putalpha(alpha.point(lambda a: 255 if a > 128 else 0))

    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG")

    preview = None
    if upscale and upscale > 1:
        preview = dest.with_name(dest.stem + f"@{upscale}x.png")
        out.resize((grid * upscale, grid * upscale), Image.NEAREST).save(preview, "PNG")

    return {
        "file": dest.name,
        "preview": preview.name if preview else None,
        "grid": grid,
        "palette": palette,
        "colours_used": len(out.convert("RGB").getcolors(maxcolors=1 << 16) or []),
        "source_size": list(original),
    }


def _close(a, b, tolerance: int) -> bool:
    return all(abs(a[i] - b[i]) <= tolerance for i in range(3))


def _background_key(image, tolerance: int):
    """The backdrop colour, or None if there is no agreed one.

    Only returns a colour when all four corners agree. A busy background is not
    a backdrop, and blanking it would punch holes through the artwork.
    """
    pixels = image.load()
    w, h = image.size
    corners = [pixels[0, 0], pixels[w - 1, 0], pixels[0, h - 1], pixels[w - 1, h - 1]]
    if any(c[3] == 0 for c in corners):
        return None  # already transparent there; nothing to key
    if not all(_close(corners[0], c, tolerance) for c in corners[1:]):
        return None
    return corners[0]


def _key_out_colour(image, key, tolerance: int):
    """Make every pixel close to ``key`` transparent.

    Deliberately not a flood fill: a flood from the corner leaks through any
    gap in the silhouette and eats the sprite, which is a worse failure than
    leaving a stray background pixel behind.
    """
    out = image.copy()
    target = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            if target[x, y][3] and _close(target[x, y], key, tolerance):
                target[x, y] = (0, 0, 0, 0)
    return out


def build_sheet(frames: Iterable[Path], dest: Path, columns: int = 0) -> dict[str, Any]:
    """Lay sprites out in a grid, the way a game engine wants them.

    Every cell is the size of the largest frame, so a frame that happens to be
    smaller does not shift everything after it -- engines index sheets by
    arithmetic, not by looking.
    """
    Image = _pil()
    paths = [p for p in frames if p.is_file()]
    if not paths:
        raise PixelError("no frames to assemble")

    images = [Image.open(p).convert("RGBA") for p in paths]
    cell_w = max(i.width for i in images)
    cell_h = max(i.height for i in images)
    columns = columns or len(images)
    rows = math.ceil(len(images) / columns)

    sheet = Image.new("RGBA", (cell_w * columns, cell_h * rows), (0, 0, 0, 0))
    for index, frame in enumerate(images):
        x = (index % columns) * cell_w
        y = (index // columns) * cell_h
        sheet.paste(frame, (x + (cell_w - frame.width) // 2,
                            y + (cell_h - frame.height) // 2), frame)

    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest, "PNG")
    return {
        "file": dest.name,
        "frames": len(images),
        "columns": columns,
        "rows": rows,
        "cell": [cell_w, cell_h],
        "size": [sheet.width, sheet.height],
    }


def build_gif(frames: Iterable[Path], dest: Path, fps: int = 8,
              upscale: int = 4) -> dict[str, Any]:
    """An animated preview, so an animation can be judged without an engine."""
    Image = _pil()
    paths = [p for p in frames if p.is_file()]
    if not paths:
        raise PixelError("no frames to animate")

    images = []
    for path in paths:
        frame = Image.open(path).convert("RGBA")
        if upscale > 1:
            frame = frame.resize((frame.width * upscale, frame.height * upscale),
                                 Image.NEAREST)
        # GIF has one transparent index rather than an alpha channel, so flatten
        # onto a checker-free solid; a half-transparent GIF looks broken.
        flat = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        flat.paste(frame, (0, 0), frame)
        images.append(flat.convert("P", palette=Image.ADAPTIVE))

    dest.parent.mkdir(parents=True, exist_ok=True)
    images[0].save(dest, save_all=True, append_images=images[1:],
                   duration=max(20, int(1000 / max(1, fps))), loop=0, disposal=2)
    return {"file": dest.name, "frames": len(images), "fps": fps}


# ---------------------------------------------------------------------------
# prompts
# ---------------------------------------------------------------------------

STYLE_RULES = (
    "flat colours, hard edges, no anti-aliasing, no gradients, no blur, "
    "strong silhouette, plain flat background, centred, full body in frame"
)


def sprite_prompt(brief: str, lora: Optional[PixelLora], grid: int) -> str:
    """One sprite. The trigger word goes first, as LoRA authors expect."""
    parts = []
    if lora and lora.trigger:
        parts.append(lora.trigger)
    parts.append(f"{grid}x{grid} pixel art sprite of {brief.strip()}")
    parts.append(STYLE_RULES)
    return ", ".join(parts)


def direction_prompt(brief: str, lora: Optional[PixelLora], grid: int,
                     direction: str) -> str:
    facing = {
        "south": "facing the camera, front view",
        "south-west": "facing front-left, three-quarter view",
        "west": "facing left, side view",
        "north-west": "facing back-left, three-quarter rear view",
        "north": "facing away from the camera, back view",
        "north-east": "facing back-right, three-quarter rear view",
        "east": "facing right, side view",
        "south-east": "facing front-right, three-quarter view",
    }.get(direction, direction)
    parts = []
    if lora and lora.trigger:
        parts.append(lora.trigger)
    parts.append(f"{grid}x{grid} pixel art sprite of {brief.strip()}, {facing}")
    parts.append("identical character design, same colours and proportions in "
                 "every view")
    parts.append(STYLE_RULES)
    return ", ".join(parts)


def frame_prompt(brief: str, lora: Optional[PixelLora], grid: int,
                 action: str, index: int, total: int, beat: str) -> str:
    parts = []
    if lora and lora.trigger:
        parts.append(lora.trigger)
    parts.append(f"{grid}x{grid} pixel art sprite of {brief.strip()}")
    parts.append(f"frame {index + 1} of {total} of {beat}")
    parts.append("identical character design and colours across every frame, "
                 "same camera and scale")
    parts.append(STYLE_RULES)
    return ", ".join(parts)
