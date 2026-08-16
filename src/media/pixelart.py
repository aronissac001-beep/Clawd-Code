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
import statistics
from collections import deque
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


def lora_by_id(lora_id: Optional[str]) -> Optional[PixelLora]:
    """The LoRA with this id, or None -- including for None itself.

    Callers pass whatever the client sent, and "no LoRA" is a real choice, so
    an unknown id and an absent one both mean the same thing here: generate
    from the prompt alone.
    """
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
    palette_from: Optional[Path] = None,
    sharpen: float = 1.0,
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

    # Square it off, so a landscape generation does not squash the sprite. Pad
    # rather than crop -- cropping eats limbs.
    side = max(image.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(image, ((side - image.width) // 2, (side - image.height) // 2))

    # BOX (area average) rather than NEAREST -- see the docstring. LANCZOS
    # keeps more edge contrast on the way down but rings, so it is paired with
    # a sharpen and offered rather than imposed: it changes every sprite,
    # including ones already approved.
    if sharpen and sharpen > 1.0:
        small = square.resize((grid, grid), Image.LANCZOS)
        alpha_before = small.getchannel("A")
        from PIL import ImageEnhance

        # RGB only. Sharpening the alpha channel haloes the silhouette, which
        # is the one edge that must stay hard.
        crisp = ImageEnhance.Sharpness(small.convert("RGB")).enhance(
            min(sharpen, 2.0))
        small = crisp.convert("RGBA")
        small.putalpha(alpha_before)
    else:
        small = square.resize((grid, grid), Image.BOX)

    # Clear the backdrop after downscaling: a few thousand pixels rather than a
    # million, and the averaged colours are cleaner to match against. The
    # transparent padding added above is itself a border the fill starts from,
    # which is harmless -- it is already transparent.
    if background == "transparent":
        small = _remove_backdrop(small, tolerance)

    # Quantise the colour channels only; the alpha we may have just created
    # must not be dithered into a speckled edge.
    alpha = small.getchannel("A")
    rgb = small.convert("RGB")

    # Quantise against an earlier frame's palette when one is given.
    #
    # Without this each frame picks its own optimal colours, and they disagree:
    # measured on a real five-frame animation, 24 colours per frame but 116
    # across the set and exactly one colour common to all five. The character
    # is recoloured slightly every frame -- which reads as flicker in motion,
    # and makes a sprite sheet impossible to store as one indexed image.
    #
    # The reference is rebuilt from a sprite that already contains only
    # `palette` colours, so re-deriving it returns that same set.
    reference = None
    if palette_from is not None and Path(palette_from).is_file():
        try:
            reference = Image.open(palette_from).convert("RGB").quantize(
                colors=palette, method=Image.MEDIANCUT, dither=Image.NONE)
        except OSError:
            reference = None

    if reference is not None:
        reduced = rgb.quantize(palette=reference, dither=Image.NONE)
    else:
        reduced = rgb.quantize(colors=palette, method=Image.MEDIANCUT,
                               dither=Image.NONE)
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
        # Opaque pixels only. Counting the RGB behind transparent ones made
        # every sprite report the full palette even when a colour was used
        # solely by the cleared backdrop -- a number that could never fall.
        "colours_used": len({p[:3] for p in out.getdata() if p[3]}),
        "source_size": list(original),
        "tolerance": tolerance,
        **inspect(out),
    }


def inspect(image) -> dict[str, Any]:
    """Three numbers that say whether a sprite is worth opening.

    A sprite with a third of its body missing and a clean one are the same
    size, have the same colour count, and take the same time to make. Without
    these an agent has to look at every result to learn what three integers
    could have told it -- and on real output here, more than half of the
    frames would fail a trivial numeric guard.

    opaque  how much of the canvas is the subject. Healthy is roughly 30-75%.
            Above ~90% the backdrop was never removed; below ~8% the key ate
            the character.
    holes   transparent pixels *enclosed* by the subject rather than reachable
            from the border. This is the one that matters: background removal
            and damage both raise transparency, and only this tells them
            apart. Anything above 1% is a broken silhouette.
    edge    how much of the outer ring is still opaque. High means backdrop
            survived at the frame's edge.
    """
    pixels = image.load()
    w, h = image.size
    total = w * h
    opaque = sum(1 for y in range(h) for x in range(w) if pixels[x, y][3])

    # Transparent pixels reachable from the border are background; the rest
    # are holes punched through the artwork.
    seen = bytearray(total)
    queue: deque = deque()

    def push(x: int, y: int) -> None:
        if not seen[y * w + x] and pixels[x, y][3] == 0:
            seen[y * w + x] = 1
            queue.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)
    outside = 0
    while queue:
        x, y = queue.popleft()
        outside += 1
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                push(nx, ny)

    band = max(1, min(w, h) // 20)
    ring = [(x, y) for y in range(h) for x in range(w)
            if x < band or y < band or x >= w - band or y >= h - band]
    edge = sum(1 for x, y in ring if pixels[x, y][3]) / len(ring)

    opaque_pct = round(100 * opaque / total, 1)
    hole_pct = round(100 * ((total - opaque) - outside) / total, 2)
    edge_pct = round(100 * edge, 1)

    warnings = []
    if opaque_pct > 90 or edge_pct > 15:
        warnings.append("backdrop survived")
    if opaque_pct < 8:
        warnings.append("subject may have been keyed away")
    if hole_pct > 1:
        warnings.append("holes in the silhouette")

    return {
        "opaque_pct": opaque_pct,
        "hole_pct": hole_pct,
        "edge_opaque_pct": edge_pct,
        "warning": "; ".join(warnings),
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


def _row_backdrop(image, tolerance: int, edge: float = 0.04,
                  agreement: float = 0.85):
    """The backdrop colour per row, read from the left and right margins.

    One colour cannot describe the backdrop these models produce. Measured on
    a real generation: the top corners were (123,123,121) and the bottom ones
    (173,173,173) -- a vertical gradient fifty levels deep, which made the
    four-corner test disagree, return None, and key nothing at all. The sprite
    shipped with a fully opaque background.

    A per-row estimate follows that gradient. Returns None when the margins do
    not agree row by row, which is the honest answer for an actual scene.
    """
    pixels = image.load()
    w, h = image.size
    band = max(1, int(w * edge))
    rows: list[Optional[tuple]] = []
    confident = 0
    for y in range(h):
        samples = [pixels[x, y] for x in range(band)]
        samples += [pixels[w - 1 - x, y] for x in range(band)]
        samples = [s for s in samples if s[3]]
        if not samples:
            rows.append(None)
            continue
        median = tuple(int(statistics.median(s[i] for s in samples))
                       for i in range(3))
        agree = sum(1 for s in samples if _close(s, median, tolerance))
        if agree / len(samples) >= agreement:
            rows.append(median)
            confident += 1
        else:
            rows.append(None)
    return rows if confident / h >= 0.7 else None


def _key_out_backdrop(image, rows, tolerance: int):
    """Clear the backdrop, working inwards from the border only.

    Two properties, and both are needed:

    *Connected* -- a pixel is only cleared if there is a path to the border
    through other backdrop pixels. That is what stops this punching holes in
    the middle of the artwork, which a plain colour match does whenever the
    character happens to wear the backdrop's colour.

    *Row-aware* -- each pixel is matched against its own row's backdrop rather
    than one global colour, so a gradient is followed rather than abandoned.

    An earlier attempt propagated the tolerance from each pixel to its
    neighbour instead. That tracks a gradient beautifully and then walks
    straight into the character, because adjacent character pixels are also
    similar to each other: measured, it left 1-12% of the sprite standing.
    """
    out = image.copy()
    pixels = out.load()
    w, h = out.size
    seen = bytearray(w * h)
    queue: deque = deque()

    def push(x: int, y: int) -> None:
        if not seen[y * w + x]:
            seen[y * w + x] = 1
            queue.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while queue:
        x, y = queue.popleft()
        key = rows[y]
        colour = pixels[x, y]
        if key is None or colour[3] == 0 or not _close(colour, key, tolerance):
            continue
        pixels[x, y] = (0, 0, 0, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                push(nx, ny)
    return out


def _transparent_count(image) -> int:
    pixels = image.load()
    w, h = image.size
    return sum(1 for y in range(h) for x in range(w) if pixels[x, y][3] == 0)


def _remove_backdrop(image, tolerance: int):
    """Clear the backdrop, preferring the pass that cannot damage the subject.

    The connected pass wins by construction, not by score. An earlier version
    of this ran both and kept whichever produced more transparency, which
    sounds safe and is exactly backwards: holes punched through a character
    *are* transparency, so the rule preferred the damaging result precisely
    when damage occurred. Measured across 51 real frames, it picked the flat
    key on 31 of them, and on one five-frame animation that cost 16-17% of
    every frame to holes while the discarded candidate had none.

    The flat key survives only as a fallback for images where the row estimate
    finds no agreement at all -- there, anything beats shipping an opaque
    rectangle.

    The tolerance is nudged once if nothing keys, and only then. A general
    ladder was tested and rejected: raising the tolerance on an image that
    already keyed erases subjects while every cheap metric stays green -- on
    one golem it removed the body and kept the vignette, at 0% holes.
    """
    for tol in (tolerance, tolerance + 16):
        rows = _row_backdrop(image, tol)
        if rows is not None:
            return _key_out_backdrop(image, rows, tol)
        flat_key = _background_key(image, tol)
        if flat_key is not None:
            return _key_out_colour(image, flat_key, tol)
    return image


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

    # One palette for the whole animation, and a real transparent index.
    #
    # The previous version converted each frame separately with an ADAPTIVE
    # palette, which reintroduced exactly the drift the sprites had just been
    # fixed to avoid -- measured on frames sharing 23 of 23 colours, the GIF
    # came out with 20 per frame and only 16 in common. It also wrote no
    # transparency key at all, so the sprite was previewed on an opaque black
    # rectangle and any hole in the silhouette rendered black rather than
    # showing through. This is the surface an animation gets judged by, so its
    # flicker reads as the sprites still being broken.
    frames_rgba = []
    for path in paths:
        frame = Image.open(path).convert("RGBA")
        if upscale > 1:
            frame = frame.resize((frame.width * upscale, frame.height * upscale),
                                 Image.NEAREST)
        frames_rgba.append(frame)

    # Index 0 is reserved for transparency, so the palette is derived at one
    # colour short and every real colour is shifted up by one.
    colours = max(2, min(255, len({p[:3] for f in frames_rgba
                                   for p in f.getdata() if p[3]}) or 2))
    strip = Image.new("RGB", (sum(f.width for f in frames_rgba),
                              frames_rgba[0].height))
    offset = 0
    for frame in frames_rgba:
        strip.paste(frame.convert("RGB"), (offset, 0))
        offset += frame.width
    reference = strip.quantize(colors=colours, method=Image.MEDIANCUT,
                               dither=Image.NONE)

    images = []
    for frame in frames_rgba:
        mapped = frame.convert("RGB").quantize(palette=reference,
                                               dither=Image.NONE)
        # Shift every index up by one and paint transparent pixels as index 0.
        shifted = mapped.point(lambda i: min(255, i + 1))
        mask = frame.getchannel("A").point(lambda a: 255 if a <= 128 else 0)
        shifted.paste(0, (0, 0), mask)
        table = reference.getpalette()[: colours * 3]
        shifted.putpalette([0, 0, 0] + table)
        images.append(shifted)

    dest.parent.mkdir(parents=True, exist_ok=True)
    images[0].save(dest, save_all=True, append_images=images[1:],
                   duration=max(20, int(1000 / max(1, fps))), loop=0,
                   disposal=2, transparency=0)
    return {"file": dest.name, "frames": len(images), "fps": fps,
            "colours": colours}


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
