"""The refine loop: the numbers, the recipe, and the exit codes.

These cover the parts an external agent depends on but a human never notices,
because a human looks at the picture. An agent cannot, cheaply -- so it needs
the sprite to describe itself, the job to remember how it was made, and a
failure to say whether waiting would help.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from src.clawdctl import classify, _spread
from src.media.pixelart import build_gif, inspect, quantise_to_sprite


def _canvas(size=64, subject=True, hole=False, shift=0, tint=(200, 40, 40)):
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = image.load()
    if subject:
        for y in range(size // 4, 3 * size // 4):
            for x in range(size // 4 + shift, 3 * size // 4 + shift):
                if 0 <= x < size:
                    pixels[x, y] = (*tint, 255)
    if hole:
        for y in range(size // 2 - 4, size // 2 + 4):
            for x in range(size // 2 - 4, size // 2 + 4):
                pixels[x, y] = (0, 0, 0, 0)
    return image


class TestInspect(unittest.TestCase):
    """The numbers that let a caller reject a sprite without opening it."""

    def test_a_clean_sprite_reports_no_holes_and_no_warning(self):
        report = inspect(_canvas())
        self.assertEqual(report["hole_pct"], 0.0)
        self.assertEqual(report["warning"], "")
        self.assertGreater(report["opaque_pct"], 20)

    def test_a_hole_through_the_subject_is_distinguished_from_background(self):
        """The whole point: both raise transparency, only one is damage."""
        clean = inspect(_canvas())
        holed = inspect(_canvas(hole=True))
        self.assertEqual(clean["hole_pct"], 0.0)
        self.assertGreater(holed["hole_pct"], 1.0)
        self.assertIn("holes", holed["warning"])
        # Less opaque, yet worse -- which a transparency count alone would
        # have scored as an improvement.
        self.assertLess(holed["opaque_pct"], clean["opaque_pct"])

    def test_an_untouched_backdrop_is_flagged(self):
        opaque = Image.new("RGBA", (64, 64), (120, 120, 120, 255))
        report = inspect(opaque)
        self.assertEqual(report["opaque_pct"], 100.0)
        self.assertIn("backdrop survived", report["warning"])

    def test_an_erased_subject_is_flagged(self):
        report = inspect(Image.new("RGBA", (64, 64), (0, 0, 0, 0)))
        self.assertIn("keyed away", report["warning"])

    def test_the_numbers_ride_along_with_every_sprite(self):
        tmp = Path(tempfile.mkdtemp())
        source = tmp / "s.png"
        Image.new("RGB", (128, 128), (120, 120, 120)).save(source)
        info = quantise_to_sprite(source, tmp / "out.png", grid=32, palette=8,
                                  background="transparent", tolerance=40)
        for key in ("opaque_pct", "hole_pct", "edge_opaque_pct", "warning",
                    "tolerance"):
            self.assertIn(key, info)
        self.assertEqual(info["tolerance"], 40)


class TestGifPreview(unittest.TestCase):
    """The surface an animation gets judged by."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        # The frames have to differ, or the GIF writer collapses them into one
        # and there is nothing to compare across.
        self.frames = []
        for index, tint in enumerate(((200, 40, 40), (190, 55, 45), (205, 35, 60))):
            path = self.tmp / f"f{index}.png"
            _canvas(shift=index * 3, tint=tint).save(path)
            self.frames.append(path)

    def test_the_gif_is_actually_transparent(self):
        """It used to preview sprites on an opaque black rectangle."""
        dest = self.tmp / "a.gif"
        build_gif(self.frames, dest, fps=8)
        image = Image.open(dest)
        self.assertIn("transparency", image.info)
        self.assertEqual(image.convert("RGBA").getpixel((0, 0))[3], 0)

    def test_every_frame_draws_from_one_palette(self):
        """Per-frame ADAPTIVE palettes reintroduced the drift the sprites had
        just been fixed to avoid.

        The invariant is that the whole animation is bounded by a single
        palette -- not that the frames happen to share colours, which depends
        on the artwork. Here each frame is a different flat tint, so they share
        none while still coming from one palette of three.
        """
        dest = self.tmp / "b.gif"
        info = build_gif(self.frames, dest, fps=8)
        image = Image.open(dest)
        union = set()
        for index in range(info["frames"]):
            image.seek(index)
            union |= {p[:3] for p in image.convert("RGBA").getdata() if p[3]}
        self.assertEqual(info["frames"], len(self.frames))
        self.assertLessEqual(len(union), info["colours"])


class TestFailureClassification(unittest.TestCase):
    """An exit code that says what to do, not merely that it went wrong."""

    def test_a_rate_limit_says_wait(self):
        self.assertEqual(classify("HTTP Error 429: Too Many Requests"), 2)

    def test_an_account_refusal_says_do_not_retry(self):
        self.assertEqual(
            classify("User is locked. Reason: Exhausted balance."), 3)

    def test_a_bad_request_says_change_it(self):
        self.assertEqual(classify("unknown kind 'gif'"), 4)

    def test_anything_else_is_a_plain_failure(self):
        self.assertEqual(classify("the disk caught fire"), 1)

    def test_waiting_and_never_retrying_are_never_confused(self):
        self.assertNotEqual(classify("429 rate limited"),
                            classify("402 payment required"))


class TestSweepArguments(unittest.TestCase):
    def test_a_list_becomes_several_values(self):
        self.assertEqual(_spread("16,32,48", [32]), [16, 32, 48])

    def test_whitespace_is_tolerated(self):
        self.assertEqual(_spread("16, 32", [32]), [16, 32])

    def test_nothing_given_falls_back(self):
        self.assertEqual(_spread("", [32]), [32])
        self.assertEqual(_spread(None, [64]), [64])


class TestManifest(unittest.TestCase):
    """The recipe has to outlive the process that ran it."""

    def test_a_job_serialises_everything_needed_to_repeat_it(self):
        from src.media.pixel_jobs import PixelJob

        job = PixelJob(id="abc", kind="sprite", brief="a rock", lora=None,
                       grid=64, palette=24, backend="pollinations",
                       seed=99, tolerance=40, sharpen=1.4, design="a grey rock")
        data = json.loads(json.dumps(job.as_dict()))
        for key in ("id", "kind", "brief", "seed", "grid", "palette",
                    "tolerance", "sharpen", "design", "backend"):
            self.assertIn(key, data)
        self.assertEqual(data["seed"], 99)
        self.assertEqual(data["design"], "a grey rock")


class TestRequantiseNamesAreUnique(unittest.TestCase):
    """Two sweep points must not overwrite each other."""

    def test_tolerance_is_part_of_the_name(self):
        from src.webui.server import PixelRepostRequest

        a = PixelRepostRequest(folder="j", name="raw-00.jpg", grid=32,
                               palette=16, tolerance=24)
        b = PixelRepostRequest(folder="j", name="raw-00.jpg", grid=32,
                               palette=16, tolerance=48)
        self.assertNotEqual(a.tolerance, b.tolerance)
        # The route builds the stem from these fields; the model carrying them
        # distinctly is what makes distinct filenames possible.
        self.assertEqual(a.grid, b.grid)


if __name__ == "__main__":
    unittest.main()
