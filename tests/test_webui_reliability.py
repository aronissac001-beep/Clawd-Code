"""The web UI's stuck states, and the walks that made it stop responding.

Every case here was reproduced against the running server before it was fixed;
the docstrings record what the failure actually looked like, because "the UI
sometimes doesn't respond" is not a thing you can grep for later.
"""

from __future__ import annotations

import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from src.webui import server


class _FakeThread:
    def __init__(self, alive: bool):
        self._alive = alive

    def is_alive(self) -> bool:
        return self._alive


def _session():
    """A session object without building a provider or a tool registry."""
    s = object.__new__(server.Session)
    s.busy = False
    s.cancel = False
    s.worker = None
    return s


class TestRunningVsBusy(unittest.TestCase):
    """`busy` is a promise; `running()` is evidence.

    The bug: `session.busy = True` is set before the worker thread starts and
    cleared only inside that worker's `finally`. Anything that raised in
    between -- an unknown tier, a model that would not load for want of VRAM --
    left the flag set with nothing alive to clear it. Every later message then
    came back "a request is already in flight", forever, and /api/stop only set
    a cancel flag that no worker was there to read. A server restart was the
    only way out.
    """

    def test_a_flag_with_no_worker_is_not_a_running_turn(self):
        s = _session()
        s.busy = True
        s.worker = None
        self.assertFalse(s.running())

    def test_a_flag_with_a_dead_worker_is_not_a_running_turn(self):
        s = _session()
        s.busy = True
        s.worker = _FakeThread(alive=False)
        self.assertFalse(s.running())

    def test_a_live_worker_is_a_running_turn(self):
        s = _session()
        s.busy = True
        s.worker = _FakeThread(alive=True)
        self.assertTrue(s.running())

    def test_an_inline_holder_counts_as_running(self):
        """The planner owns the session without spawning a thread."""
        s = _session()
        s.busy = True
        s.worker = server._SYNC_HOLDER
        self.assertTrue(s.running())

    def test_not_busy_is_never_running(self):
        s = _session()
        s.busy = False
        s.worker = _FakeThread(alive=True)
        self.assertFalse(s.running())


class TestChatSetupFailures(unittest.TestCase):
    """A failed start must leave the session exactly as it found it."""

    def setUp(self):
        self.session = _session()
        patcher = patch.object(server, "get_session", return_value=self.session)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _send(self, message="hi", model=None):
        req = server.ChatRequest(message=message, attachments=[], model=model)
        import asyncio

        return asyncio.run(server.chat(req))

    def test_a_failed_start_does_not_wedge_the_session(self):
        with patch.object(server, "_start_chat", side_effect=HTTPException(400, "boom")):
            with self.assertRaises(HTTPException):
                self._send()
        self.assertFalse(self.session.busy)
        self.assertFalse(self.session.running())

    def test_a_failed_start_does_not_make_a_bad_model_sticky(self):
        """Selecting a model that cannot be applied used to poison the session.

        The spec is assigned before it is validated, so after one 400 every
        later message failed the same way even though the user had stopped
        asking for that model, with nothing in the UI explaining why.
        """
        self.session.model_spec = "auto"
        with patch.object(server, "_start_chat",
                          side_effect=HTTPException(400, "unknown tier")):
            with self.assertRaises(HTTPException):
                self._send(model="local:does-not-exist")
        self.assertEqual(self.session.model_spec, "auto")

    def test_a_second_message_is_refused_only_while_a_worker_lives(self):
        self.session.busy = True
        self.session.worker = _FakeThread(alive=True)
        with self.assertRaises(HTTPException) as caught:
            self._send()
        self.assertEqual(caught.exception.status_code, 409)


class TestStopEndpoint(unittest.TestCase):
    def setUp(self):
        self.session = _session()
        patcher = patch.object(server, "get_session", return_value=self.session)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_stop_cancels_a_live_turn(self):
        self.session.busy = True
        self.session.worker = _FakeThread(alive=True)
        out = server.stop()
        self.assertTrue(out["was_busy"])
        self.assertTrue(self.session.cancel)
        self.assertTrue(self.session.busy)   # the worker clears it, not us

    def test_stop_clears_a_stale_flag_nobody_owns(self):
        """The one button reached for when the UI wedges must un-wedge it."""
        self.session.busy = True
        self.session.worker = None
        out = server.stop()
        self.assertTrue(out.get("cleared_stale"))
        self.assertFalse(self.session.busy)

    def test_stop_on_an_idle_session_is_harmless(self):
        out = server.stop()
        self.assertFalse(out["was_busy"])
        self.assertFalse(self.session.cancel)


class TestFileSearchIsBounded(unittest.TestCase):
    """The @-mention walk fires per keystroke and must not walk a whole disk.

    Its only stopping condition was "enough matches found", which is no bound
    at all for a query that matches little: it walked the entire tree looking
    for matches it would never find. With a home folder as the workspace that
    was measured at 42 seconds -- per keystroke, each one holding a threadpool
    worker.
    """

    def setUp(self):
        self.root = Path(server.__file__).resolve().parents[2]
        self.session = _session()
        self.session.workspace = self.root
        patcher = patch.object(server, "get_session", return_value=self.session)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_query_that_matches_nothing_still_returns_promptly(self):
        started = time.monotonic()
        out = server.find_files(q="zzz-no-such-file-anywhere", limit=12)
        elapsed = time.monotonic() - started
        self.assertEqual(out["files"], [])
        # Generous against the 0.25s budget: CI machines and cold file caches
        # are slow, and the point is "bounded", not "fast".
        self.assertLess(elapsed, 5.0, f"walk took {elapsed:.1f}s")

    def test_the_budget_is_reported_rather_than_hidden(self):
        out = server.find_files(q="server", limit=12)
        self.assertIn("truncated", out)
        self.assertIn("scanned", out)

    def test_matches_are_still_found_and_ranked_shallowest_first(self):
        out = server.find_files(q="server.py", limit=12)
        self.assertTrue(out["files"], "expected to find server.py in this repo")
        depths = [p.count("/") for p in out["files"]]
        self.assertEqual(depths, sorted(depths))

    def test_a_missing_workspace_is_not_an_error(self):
        self.session.workspace = self.root / "no-such-directory"
        self.assertEqual(server.find_files(q="x")["files"], [])


class TestVramCacheOutlivesThePollInterval(unittest.TestCase):
    """The cache TTL has to exceed the poll interval or it never hits.

    It was 3s against a 6s status poll, so the hit rate was exactly zero and
    every poll spawned nvidia-smi -- which on Windows is the expensive part,
    and made /api/status 99ms instead of ~15ms.
    """

    def test_ttl_exceeds_the_ui_poll_interval(self):
        from src.local import supervisor

        ui_poll_interval_s = 6.0
        self.assertGreater(supervisor._VRAM_TTL_S, ui_poll_interval_s)

    def test_callers_that_need_accuracy_can_still_force_a_read(self):
        """Eviction must not be given a stale number to budget against.

        This is what makes lengthening the TTL safe: it only ever affects the
        sidebar readout, never a decision about committing VRAM.
        """
        from src.local import supervisor

        saved = dict(supervisor._VRAM_CACHE)
        self.addCleanup(supervisor._VRAM_CACHE.update, saved)
        supervisor._VRAM_CACHE["value"] = 1234
        supervisor._VRAM_CACHE["at"] = time.time()

        fresh = type("R", (), {"returncode": 0, "stdout": "99\n", "stderr": ""})()
        with patch.object(supervisor.subprocess, "run", return_value=fresh) as run:
            self.assertEqual(supervisor.query_free_vram_mb(), 1234)   # served cached
            run.assert_not_called()
            self.assertEqual(supervisor.query_free_vram_mb(max_age_s=0), 99)
            run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
