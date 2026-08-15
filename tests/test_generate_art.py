"""The tools that let the chat agent draw.

The bug these fix: the app had a whole pixel-art pipeline and no tool wired to
it, so the model in the app's own chat answered "I can't generate images" --
correctly, and uselessly. Most of what is asserted here is about the seams
between the tool and everything around it, because that is where the previous
version of this feature broke: a sprite that arrives as a 32-pixel speck, or a
job cancelled by the very code that told the user it would keep running, is
indistinguishable from the feature not working.
"""

from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from src.media import pixelart
from src.tool_system.context import ToolContext
from src.tool_system.defaults import build_default_registry
from src.tool_system.errors import ToolInputError
from src.tool_system.tools.generate_art import (GenerateImageTool,
                                                GeneratePixelArtTool)


class _FakeJob:
    """A studio job that settles however the test wants."""

    def __init__(self, status="done", frames=None, error="", logs=None,
                 sheet=None, gif=None, outputs=None):
        self.id = "job123"
        self.status = status
        self.error = error
        self.logs = logs if logs is not None else []
        self.frames = frames or []
        self.sheet = sheet
        self.gif = gif
        self.outputs = outputs or []
        self.backend = "pollinations"
        self.created_at = 0.0
        self.finished_at = 1.0


class _FakeStudio:
    def __init__(self, job):
        self.job = job
        self.cancelled = False
        self.submitted = None

    def submit(self, *args, **kw):
        # Stands in for both PixelStudio.submit(kind, brief, **kw) and
        # JobStore.submit(model, task, prompt, payload, key).
        self.submitted = {"args": args, **kw}
        if len(args) >= 2:
            self.submitted.update(kind=args[0], brief=args[1])
        return self.job

    def cancel(self, job_id):
        self.cancelled = True
        self.job.status = "cancelled"
        return True


def _ctx(cancel=False):
    return ToolContext(workspace_root=Path.cwd(),
                       should_cancel=(lambda: True) if cancel else None)


FRAME = {"file": "00-south.png", "preview": "00-south@6x.png",
         "dir": "job123", "label": "south"}


class TestRegistration(unittest.TestCase):
    def test_both_tools_are_in_the_default_registry(self):
        names = [s.name for s in
                 build_default_registry(include_user_tools=False).list_specs()]
        self.assertIn("GeneratePixelArt", names)
        self.assertIn("GenerateImage", names)

    def test_schemas_survive_the_openai_converter(self):
        """A schema with no top-level "type" is silently dropped on the wire.

        That is not hypothetical -- it is why the Skill tool never reaches any
        local model. These two must not join it.
        """
        for tool in (GeneratePixelArtTool(), GenerateImageTool()):
            schema = dict(tool.spec().input_schema)
            self.assertEqual(schema.get("type"), "object", tool.spec().name)
            self.assertIn("properties", schema, tool.spec().name)

    def test_the_subject_is_the_first_property(self):
        """The UI labels a tool card with the first input value."""
        self.assertEqual(
            list(GeneratePixelArtTool().spec().input_schema["properties"])[0],
            "subject")
        self.assertEqual(
            list(GenerateImageTool().spec().input_schema["properties"])[0],
            "prompt")

    def test_string_enums_track_the_pipeline_rather_than_restating_it(self):
        """A cycle the Pixels tab offers and the chat rejects is a bug."""
        props = GeneratePixelArtTool().spec().input_schema["properties"]
        self.assertEqual(sorted(props["action"]["enum"]),
                         sorted(pixelart.ANIMATIONS))

    def test_integer_properties_carry_no_enum(self):
        """Measured: a Gemini route on OpenRouter 400s on an integer enum.

        String enums are fine, integer ones take the whole request down, so
        the allowed values live in the description and are enforced in run().
        """
        props = GeneratePixelArtTool().spec().input_schema["properties"]
        for name in ("grid", "directions"):
            self.assertEqual(props[name]["type"], "integer")
            self.assertNotIn("enum", props[name], name)

    def test_the_sizes_offered_are_the_sizes_the_pipeline_makes(self):
        from src.tool_system.tools import generate_art

        self.assertEqual(sorted(generate_art.SIZES),
                         sorted(pixelart.SIZES.values()))
        text = GeneratePixelArtTool().spec().input_schema["properties"]["grid"]["description"]
        for size in pixelart.SIZES.values():
            self.assertIn(str(size), text)

    def test_the_description_tells_the_model_it_can_do_this(self):
        """The failure being fixed is a refusal, not a crash."""
        text = GeneratePixelArtTool().spec().description.lower()
        for word in ("pixel art", "sprite", "8-bit"):
            self.assertIn(word, text)
        self.assertIn("never reply that you are unable", text)


class TestPixelArtHappyPath(unittest.TestCase):
    def _run(self, job, **args):
        studio = _FakeStudio(job)
        with patch("src.media.pixel_jobs.studio", return_value=studio):
            result = GeneratePixelArtTool().run(
                {"subject": "a frog knight", **args}, _ctx())
        return result, studio

    def test_it_returns_the_upscaled_preview_not_the_raw_asset(self):
        """`file` is the sprite at native size -- 32 real pixels on screen."""
        result, _ = self._run(_FakeJob(frames=[FRAME]))
        self.assertFalse(result.is_error)
        self.assertEqual(result.output["images"][0]["url"],
                         "/api/pixel/file/job123/00-south@6x.png")

    def test_it_falls_back_to_file_when_there_is_no_preview(self):
        frame = {**FRAME, "preview": None}
        result, _ = self._run(_FakeJob(frames=[frame]))
        self.assertEqual(result.output["images"][0]["url"],
                         "/api/pixel/file/job123/00-south.png")

    def test_every_url_is_one_the_ui_will_forward(self):
        """_tool_event_payload drops anything not starting with /api/."""
        result, _ = self._run(_FakeJob(
            frames=[FRAME],
            sheet={"file": "sheet.png", "dir": "job123"},
            gif={"file": "anim.gif", "dir": "job123"}))
        urls = [i["url"] for i in result.output["images"]]
        self.assertEqual(len(urls), 3)
        self.assertTrue(all(u.startswith("/api/") for u in urls), urls)
        self.assertIn("sheet", [i["label"] for i in result.output["images"]])

    def test_chat_never_spends_money(self):
        """Chat is the free lane; the Pixels tab is where fal is chosen."""
        _, studio = self._run(_FakeJob(frames=[FRAME]))
        self.assertEqual(studio.submitted["backend"], "pollinations")
        self.assertIsNone(studio.submitted.get("key"))

    def test_progress_lines_are_dropped_but_backend_swaps_are_kept(self):
        job = _FakeJob(frames=[FRAME],
                       logs=["1/4 south", "2/4 west",
                             "fal refused this account — finishing on Pollinations"])
        result, _ = self._run(job)
        self.assertEqual(len(result.output["notes"]), 1)
        self.assertIn("fal refused", result.output["notes"][0])

    def test_the_model_is_told_not_to_paste_the_urls(self):
        result, _ = self._run(_FakeJob(frames=[FRAME]))
        self.assertIn("do not paste", result.output["shown"].lower())


class TestPixelArtFailures(unittest.TestCase):
    def _run(self, job, cancel=False):
        studio = _FakeStudio(job)
        with patch("src.media.pixel_jobs.studio", return_value=studio):
            result = GeneratePixelArtTool().run(
                {"subject": "a frog knight"}, _ctx(cancel=cancel))
        return result, studio

    def test_giving_up_waiting_does_not_kill_the_job(self):
        """The result says it will finish in the Pixels tab. It must be true."""
        job = _FakeJob(status="running")
        with patch("src.tool_system.tools.generate_art.TIMEOUT_S", 0.05), \
             patch("src.tool_system.tools.generate_art.POLL_S", 0.01):
            result, studio = self._run(job)
        self.assertFalse(studio.cancelled)
        self.assertFalse(result.is_error)
        self.assertEqual(result.output["status"], "running")

    def test_the_handoff_tells_the_model_not_to_start_another_job(self):
        job = _FakeJob(status="running")
        with patch("src.tool_system.tools.generate_art.TIMEOUT_S", 0.05), \
             patch("src.tool_system.tools.generate_art.POLL_S", 0.01):
            result, _ = self._run(job)
        self.assertIn("do not call this tool again",
                      result.output["note"].lower())

    def test_stop_cancels_and_is_not_an_error(self):
        result, studio = self._run(_FakeJob(status="running"), cancel=True)
        self.assertTrue(studio.cancelled)
        self.assertFalse(result.is_error)
        self.assertEqual(result.output["status"], "cancelled")

    def test_a_rate_limit_is_explained_in_words_the_user_can_act_on(self):
        """The UI renders a tool's output but never its exception, so the
        reason has to travel as text or the card just says "failed"."""
        job = _FakeJob(status="error",
                       error="Pollinations did not answer: HTTP Error 429: Too Many Requests")
        result, _ = self._run(job)
        self.assertTrue(result.is_error)
        self.assertIn("rate-limiting", result.output["error"])
        self.assertIn("wait a minute", result.output["error"])

    def test_a_missing_pillow_names_the_command_to_run(self):
        result, _ = self._run(_FakeJob(status="error",
                                       error="Pillow is required for this"))
        self.assertIn("pip install Pillow", result.output["error"])


class TestPixelArtArguments(unittest.TestCase):
    """Argument faults raise: the model reads the message and retries."""

    def _run(self, **args):
        studio = _FakeStudio(_FakeJob(frames=[FRAME]))
        with patch("src.media.pixel_jobs.studio", return_value=studio):
            return GeneratePixelArtTool().run(args, _ctx()), studio

    def test_an_empty_subject_is_rejected(self):
        with self.assertRaises(ToolInputError):
            self._run(subject="   ")

    def test_an_unknown_kind_is_rejected(self):
        with self.assertRaises(ToolInputError):
            self._run(subject="a frog", kind="gif")

    def test_a_size_the_pipeline_cannot_make_is_rejected(self):
        with self.assertRaises(ToolInputError):
            self._run(subject="a frog", grid=37)

    def test_a_size_the_pixels_tab_offers_is_accepted(self):
        result, studio = self._run(subject="a frog", grid=48)
        self.assertFalse(result.is_error)
        self.assertEqual(studio.submitted["grid"], 48)

    def test_defaults_are_the_cheap_ones(self):
        """Every extra frame is another generation and another 30 seconds."""
        _, studio = self._run(subject="a frog")
        self.assertEqual(studio.submitted["kind"], "sprite")
        self.assertEqual(studio.submitted["directions"], 4)


class TestGenerateImage(unittest.TestCase):
    def _run(self, job, **args):
        store = _FakeStudio(job)
        with patch("src.media.fal.store", return_value=store):
            return GenerateImageTool().run({"prompt": "a lighthouse", **args},
                                           _ctx()), store

    def test_it_returns_a_servable_url(self):
        job = _FakeJob(outputs=[{"file": "abc.jpg", "local": True}])
        result, _ = self._run(job)
        self.assertFalse(result.is_error)
        self.assertEqual(result.output["images"][0]["url"],
                         "/api/media/file/abc.jpg")

    def test_outputs_without_a_local_file_are_skipped(self):
        job = _FakeJob(outputs=[{"url": "https://x/y.jpg"},
                                {"file": "abc.jpg"}])
        result, _ = self._run(job)
        self.assertEqual(len(result.output["images"]), 1)

    def test_it_does_not_report_a_size_it_did_not_verify(self):
        """Pollinations echoes the requested size and writes a different one."""
        result, _ = self._run(_FakeJob(outputs=[{"file": "abc.jpg"}]))
        self.assertNotIn("size", result.output)

    def test_an_empty_prompt_is_rejected(self):
        with self.assertRaises(ToolInputError):
            self._run(_FakeJob(), prompt="")

    def test_a_failed_job_explains_itself(self):
        result, _ = self._run(_FakeJob(status="error", error="empty image"))
        self.assertTrue(result.is_error)
        self.assertIn("ask again", result.output["error"])


class TestEventPayloadCarriesTheArt(unittest.TestCase):
    """The seam between the tool and the browser."""

    def test_images_are_lifted_out_and_the_urls_leave_the_json_blob(self):
        from src.tool_system.protocol import ToolResult
        from src.webui.server import _tool_event_payload

        class _Ev:
            kind = "tool_result"
            tool_name = "GeneratePixelArt"
            tool_input = {"subject": "a frog"}
            tool_output = {
                "status": "done",
                "images": [{"url": "/api/pixel/file/job123/00@6x.png",
                            "label": "south", "pixel": True}],
            }
            is_error = False
            error = None

        payload = _tool_event_payload(_Ev())
        self.assertEqual(len(payload["images"]), 1)
        self.assertTrue(payload["images"][0]["pixel"])
        # Otherwise the user reads a wall of JSON above the picture.
        self.assertNotIn("/api/pixel", payload["output"])

    def test_an_off_site_url_is_refused(self):
        from src.webui.server import _tool_event_payload

        class _Ev:
            kind = "tool_result"
            tool_name = "GenerateImage"
            tool_input = {}
            tool_output = {"images": [{"url": "https://evil.example/x.png"}]}
            is_error = False
            error = None

        self.assertIsNone(_tool_event_payload(_Ev())["images"])


if __name__ == "__main__":
    unittest.main()
