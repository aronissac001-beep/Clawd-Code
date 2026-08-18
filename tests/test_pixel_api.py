"""The pixel-art HTTP surface, and the 500 that hid itself.

The incident: `/api/pixel/options` and `/api/pixel/jobs` returned bare 500s
while the engine underneath worked perfectly when called directly. The cause
was not a defect in any shipped file -- it was a long-running server holding an
old `src.media.fal` in memory while the pixel routes, which import
`src.media.pixel_jobs` *lazily inside the handler*, pulled the newer file off
disk. The new module imported a name the cached old one did not have, and the
ImportError surfaced as "500: Internal Server Error" with the traceback going
to a stdout nobody reads.

So the tests here guard the two things that made it expensive: the cross-module
import contract that lazy imports let drift, and the silence.
"""

from __future__ import annotations

import ast
import re
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from src.media import fal, pixel_jobs, pixelart
from src.webui import auth, server


class _LocalOnly(unittest.TestCase):
    """Pin the gate to local-only for tests that are not about the gate.

    auth loads the real token from ~/.clawd/config.json at import, so without
    this the whole file passes or fails depending on whether the developer
    happens to have remote access switched on.
    """

    def setUp(self):
        self._token = auth._TOKEN
        auth._TOKEN = None
        self.addCleanup(self._restore)

    def _restore(self):
        auth._TOKEN = self._token


class TestLazyImportContract(unittest.TestCase):
    """Every name pixel_jobs imports from fal must actually be there.

    A lazy import inside a route means a broken cross-module contract is not
    found at startup, or by any import-time check -- it is found by a user,
    as a 500, at the moment they ask for a sprite.
    """

    def _imported_names(self, module_path: Path, from_module: str) -> list[str]:
        tree = ast.parse(module_path.read_text(encoding="utf-8"))
        names: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == from_module:
                names.extend(a.name for a in node.names)
        return names

    def test_pixel_jobs_imports_only_names_fal_defines(self):
        names = self._imported_names(Path(pixel_jobs.__file__), "fal")
        self.assertTrue(names, "expected pixel_jobs to import from fal")
        missing = [n for n in names if not hasattr(fal, n)]
        self.assertEqual(missing, [], f"pixel_jobs imports {missing} from fal")

    def test_the_routes_lazy_imports_resolve(self):
        """The exact imports the two failing handlers perform."""
        from src.media.pixel_jobs import FLUX_LORA_MODEL, studio  # noqa: F401
        from src.media.pixelart import (ANIMATIONS, DIRECTIONS,  # noqa: F401
                                        PALETTES, PIXEL_LORAS, SIZES)
        self.assertTrue(callable(studio))


class TestPixelEndpoints(_LocalOnly):
    def setUp(self):
        super().setUp()
        self.client = TestClient(server.app, base_url="http://127.0.0.1")

    def test_options_returns_200_and_the_pickers_it_promises(self):
        response = self.client.get("/api/pixel/options")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        for key in ("loras", "sizes", "palettes", "animations", "directions",
                    "backends", "model"):
            self.assertIn(key, body)
        # Pollinations needs no key, so it must always be on offer -- it is
        # what makes the feature work on an account with no fal balance.
        self.assertIn("pollinations", body["backends"])

    def test_jobs_returns_200(self):
        response = self.client.get("/api/pixel/jobs")
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json()["jobs"], list)

    def test_generate_rejects_an_empty_brief_with_400_not_500(self):
        response = self.client.post("/api/pixel/generate",
                                    json={"brief": "   "})
        self.assertEqual(response.status_code, 400)

    def test_generate_rejects_an_unknown_kind_with_400(self):
        response = self.client.post("/api/pixel/generate",
                                    json={"brief": "a rock", "kind": "gif"})
        self.assertEqual(response.status_code, 400)


class TestNullLora(unittest.TestCase):
    """"No LoRA" is a real choice the picker offers, so null is a real value."""

    def test_the_request_model_accepts_null(self):
        request = server.PixelRequest(brief="a rock", lora=None)
        self.assertIsNone(request.lora)

    def test_lora_lookup_tolerates_none(self):
        self.assertIsNone(pixelart.lora_by_id(None))
        self.assertIsNone(pixelart.lora_by_id("no-such-lora"))

    def test_the_none_entry_carries_no_repo_to_fetch(self):
        """`url` is an f-string and so always truthy; `repo` is the real test."""
        none_lora = pixelart.lora_by_id("none")
        self.assertIsNotNone(none_lora)
        self.assertFalse(none_lora.repo)
        self.assertTrue(none_lora.url)          # truthy, and meaningless


class TestUnhandledErrorsAreLegible(_LocalOnly):
    """A 500 must say what happened. That is the whole lesson of this bug."""

    def setUp(self):
        super().setUp()
        self.client = TestClient(server.app, raise_server_exceptions=False,
                                 base_url="http://127.0.0.1")

        @server.app.get("/api/test-only-boom")
        def _boom():
            raise ImportError("cannot import name 'note_fal_refusal'")

        self.addCleanup(self._drop_route)

    def _drop_route(self):
        server.app.router.routes = [
            r for r in server.app.router.routes
            if getattr(r, "path", None) != "/api/test-only-boom"
        ]

    def test_the_response_names_the_exception(self):
        response = self.client.get("/api/test-only-boom")
        self.assertEqual(response.status_code, 500)
        detail = response.json()["detail"]
        self.assertIn("ImportError", detail)
        self.assertIn("note_fal_refusal", detail)

    def test_the_traceback_is_included_on_a_loopback_bind(self):
        original = server._LOOPBACK_ONLY
        server._LOOPBACK_ONLY = True
        self.addCleanup(setattr, server, "_LOOPBACK_ONLY", original)
        body = self.client.get("/api/test-only-boom").json()
        self.assertIn("traceback", body)
        self.assertIn("ImportError", body["traceback"])

    def test_the_traceback_is_withheld_when_bound_beyond_localhost(self):
        original = server._LOOPBACK_ONLY
        server._LOOPBACK_ONLY = False
        self.addCleanup(setattr, server, "_LOOPBACK_ONLY", original)
        body = self.client.get("/api/test-only-boom").json()
        self.assertNotIn("traceback", body)
        self.assertIn("detail", body)          # still says what it was


if __name__ == "__main__":
    unittest.main()
