"""The two things that decide whether a sprite is usable in a game.

Both were measured as broken on real output before these changes:

- A backdrop that is a gradient rather than one flat colour was not removed at
  all. Not partially -- at all. The four-corner agreement test bailed and the
  sprite shipped fully opaque, which for a game asset means unusable.
- Frames of one animation each picked their own optimal palette. Measured on a
  real five-frame job: 24 colours per frame, 116 across the set, exactly one
  colour common to all five. The character is recoloured every frame.

The images here are synthetic so the tests are fast and offline, but each one
reproduces the shape of a failure seen in real output.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image

from src.media.pixelart import quantise_to_sprite


def _sprite_on(backdrop, size=256, blob=(200, 40, 40)):
    """A red blob centred on `backdrop`, which may be flat or a gradient."""
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            pixels[x, y] = backdrop(x, y)
    for y in range(size // 3, 2 * size // 3):
        for x in range(size // 3, 2 * size // 3):
            pixels[x, y] = blob
    return image


def _transparent_share(path: Path) -> float:
    image = Image.open(path).convert("RGBA")
    pixels = image.load()
    w, h = image.size
    clear = sum(1 for y in range(h) for x in range(w) if pixels[x, y][3] == 0)
    return clear / (w * h)


def _colours(path: Path) -> set:
    image = Image.open(path).convert("RGB")
    return {c for _, c in (image.getcolors(maxcolors=1 << 16) or [])}


class TestBackdropRemoval(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _run(self, backdrop, **kw):
        source = self.tmp / "source.png"
        _sprite_on(backdrop).save(source)
        dest = self.tmp / "sprite.png"
        quantise_to_sprite(source, dest, grid=32, palette=8,
                           background="transparent", **kw)
        return dest

    def test_a_flat_backdrop_is_removed(self):
        dest = self._run(lambda x, y: (120, 120, 120))
        self.assertGreater(_transparent_share(dest), 0.5)

    def test_a_gradient_backdrop_is_removed(self):
        """The real failure: corners 50 levels apart, so nothing was keyed.

        Measured on the generation that prompted this, a frog knight: top
        corners (123,123,121), bottom (173,173,173), result 0% transparent.
        """
        dest = self._run(lambda x, y: (120 + y // 5, 120 + y // 5, 118 + y // 5))
        self.assertGreater(_transparent_share(dest), 0.5)

    def test_the_subject_survives(self):
        """A backdrop pass that eats the artwork is worse than doing nothing."""
        dest = self._run(lambda x, y: (120 + y // 5, 120 + y // 5, 118 + y // 5))
        image = Image.open(dest).convert("RGBA")
        pixels = image.load()
        w, h = image.size
        centre = [pixels[x, y]
                  for y in range(int(h * .4), int(h * .6))
                  for x in range(int(w * .4), int(w * .6))]
        opaque = sum(1 for p in centre if p[3] != 0)
        self.assertGreater(opaque / len(centre), 0.9)

    def test_a_scene_backdrop_is_left_alone(self):
        """No agreed backdrop means no key. Guessing would punch holes.

        The structures have to be large. Fine noise is not a busy background at
        sprite resolution -- BOX downscaling averages it into a flat colour,
        and keying that flat colour is then the right answer. Only features big
        enough to survive the downscale make a backdrop genuinely unkeyable.
        """
        def scene(x, y):
            if y < 90:
                return (60, 130, 220)        # sky
            if x < 110:
                return (30, 110, 40)         # trees on the left
            return (170, 140, 90)            # ground on the right
        dest = self._run(scene)
        self.assertLess(_transparent_share(dest), 0.25)

    def test_keeping_the_background_is_still_possible(self):
        source = self.tmp / "s.png"
        _sprite_on(lambda x, y: (120, 120, 120)).save(source)
        dest = self.tmp / "kept.png"
        quantise_to_sprite(source, dest, grid=32, palette=8, background="keep")
        self.assertEqual(_transparent_share(dest), 0.0)


class TestSharedPalette(unittest.TestCase):
    """Frames of a set must agree on their colours."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _frames(self, shared: bool):
        """Three frames whose subject shifts hue slightly, as a model's would."""
        reference = None
        out = []
        for index, tint in enumerate(((200, 40, 40), (190, 55, 45), (205, 35, 60))):
            source = self.tmp / f"raw-{index}.png"
            _sprite_on(lambda x, y: (120, 120, 120), blob=tint).save(source)
            dest = self.tmp / f"{'s' if shared else 'i'}-{index}.png"
            quantise_to_sprite(source, dest, grid=32, palette=8,
                               background="transparent",
                               palette_from=reference if shared else None)
            if shared and reference is None:
                reference = dest
            out.append(dest)
        return out

    def test_independent_frames_drift(self):
        """The behaviour being fixed, asserted so the fix is meaningful."""
        sets = [_colours(p) for p in self._frames(shared=False)]
        self.assertGreater(len(set().union(*sets)), len(sets[0]))

    def test_a_shared_palette_holds_every_frame_to_one_set(self):
        sets = [_colours(p) for p in self._frames(shared=True)]
        union = set().union(*sets)
        self.assertLessEqual(len(union), 8,
                             f"expected one 8-colour palette, got {len(union)}")

    def test_a_missing_reference_is_not_an_error(self):
        source = self.tmp / "r.png"
        _sprite_on(lambda x, y: (120, 120, 120)).save(source)
        dest = self.tmp / "out.png"
        info = quantise_to_sprite(source, dest, grid=32, palette=8,
                                  palette_from=self.tmp / "nope.png")
        self.assertTrue(dest.is_file())
        self.assertLessEqual(info["colours_used"], 8)


class TestSeedIsRecorded(unittest.TestCase):
    """Reproducibility is what turns generation into iteration."""

    def test_a_job_carries_the_seed_it_was_given(self):
        from src.media.pixel_jobs import PixelJob

        job = PixelJob(id="x", kind="sprite", brief="a rock", lora="retro",
                       grid=32, palette=16, backend="pollinations", seed=777)
        self.assertEqual(job.as_dict()["seed"], 777)

    def test_the_seed_is_reported_even_when_not_chosen(self):
        from src.media.pixel_jobs import PixelJob

        job = PixelJob(id="x", kind="sprite", brief="a rock", lora="retro",
                       grid=32, palette=16, backend="pollinations")
        self.assertIn("seed", job.as_dict())

    def test_the_request_model_accepts_a_seed(self):
        from src.webui.server import PixelRequest

        self.assertEqual(PixelRequest(brief="a rock", seed=42).seed, 42)
        self.assertIsNone(PixelRequest(brief="a rock").seed)


if __name__ == "__main__":
    unittest.main()
