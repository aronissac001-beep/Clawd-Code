"""The network gate.

This server hands out shell access. An auth check nobody tested with a missing
token is not an auth check, so most of what follows asserts that things are
REFUSED. Two of these tests exist specifically because the obvious ways to
build this leave a silent hole:

  test_static_mount_is_refused    an app-level Depends() does not cover
                                  app.mount(), which serves the file anyway
  test_websocket_is_refused       @app.middleware("http") never sees a
                                  websocket scope, and /ws/terminal spawns a
                                  PowerShell PTY on connect

Both pass only because the gate is a pure ASGI middleware.
"""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from src.webui import auth, server

TOKEN = "test-token-do-not-ship"


def _client() -> TestClient:
    # base_url matters: TestClient defaults to Host "testserver", which the
    # loopback Host check correctly rejects.
    return TestClient(server.app, base_url="http://127.0.0.1")


class _Gated(unittest.TestCase):
    """A token is configured, so everything must be checked."""

    def setUp(self):
        self._saved = auth._TOKEN
        auth._TOKEN = TOKEN
        self.client = _client()

    def tearDown(self):
        auth._TOKEN = self._saved


class TestRefusedWithoutToken(_Gated):
    def test_api_route_is_refused(self):
        self.assertEqual(self.client.get("/api/status").status_code, 401)

    def test_static_mount_is_refused(self):
        """app.mount() appends a raw Mount that dependency plumbing never
        sees; only middleware in front of the router covers it."""
        self.assertEqual(self.client.get("/static/app.js").status_code, 401)

    def test_the_page_itself_is_refused(self):
        self.assertEqual(self.client.get("/").status_code, 401)

    def test_unmatched_path_is_refused(self):
        self.assertEqual(self.client.get("/no-such-thing").status_code, 401)

    def test_websocket_is_refused(self):
        """/ws/terminal spawns a shell as its first act. A gate that covers
        sixty JSON routes and misses this one has accomplished nothing."""
        with self.assertRaises(Exception):
            with self.client.websocket_connect("/ws/terminal"):
                pass

    def test_posting_a_chat_is_refused(self):
        response = self.client.post("/api/chat", json={"message": "hi"})
        self.assertEqual(response.status_code, 401)


class TestAcceptedWithToken(_Gated):
    def test_bearer_header_is_accepted(self):
        response = self.client.get(
            "/api/status", headers={"Authorization": f"Bearer {TOKEN}"})
        self.assertEqual(response.status_code, 200)

    def test_cookie_is_accepted(self):
        self.client.cookies.set(auth.COOKIE_NAME, TOKEN)
        self.assertEqual(self.client.get("/api/status").status_code, 200)

    def test_a_wrong_token_is_refused(self):
        self.client.cookies.set(auth.COOKIE_NAME, TOKEN[:-1] + "x")
        self.assertEqual(self.client.get("/api/status").status_code, 401)

    def test_an_empty_token_does_not_match(self):
        self.client.cookies.set(auth.COOKIE_NAME, "")
        self.assertEqual(self.client.get("/api/status").status_code, 401)


class TestFirstVisitHandover(_Gated):
    """?token=... is swapped for a cookie and dropped from the URL."""

    def test_it_redirects_and_sets_the_cookie(self):
        response = self.client.get(f"/?token={TOKEN}", follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.headers["location"], "/")
        cookie = response.headers["set-cookie"]
        self.assertIn(auth.COOKIE_NAME, cookie)
        self.assertIn("HttpOnly", cookie)

    def test_the_token_is_stripped_but_other_params_survive(self):
        response = self.client.get(
            f"/?pane=terminal&token={TOKEN}", follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        self.assertIn("pane=terminal", response.headers["location"])
        self.assertNotIn("token", response.headers["location"])

    def test_a_wrong_token_in_the_url_is_refused(self):
        response = self.client.get("/?token=nope", follow_redirects=False)
        self.assertEqual(response.status_code, 401)


class TestCrossOrigin(_Gated):
    """A WebSocket handshake is exempt from CORS, so the Origin check is the
    only thing stopping another page from opening a shell here."""

    def test_a_foreign_origin_is_refused_even_with_the_cookie(self):
        self.client.cookies.set(auth.COOKIE_NAME, TOKEN)
        response = self.client.get(
            "/api/status", headers={"Origin": "http://evil.example"})
        self.assertEqual(response.status_code, 403)

    def test_the_matching_origin_is_allowed(self):
        self.client.cookies.set(auth.COOKIE_NAME, TOKEN)
        response = self.client.get(
            "/api/status", headers={"Origin": "http://127.0.0.1"})
        self.assertEqual(response.status_code, 200)


class TestLocalOnlyMode(unittest.TestCase):
    """No token configured: the shipped default, unchanged behaviour."""

    def setUp(self):
        self._saved = auth._TOKEN
        auth._TOKEN = None
        self.client = _client()

    def tearDown(self):
        auth._TOKEN = self._saved

    def test_loopback_still_works_with_no_token(self):
        self.assertEqual(self.client.get("/api/status").status_code, 200)

    def test_a_foreign_host_header_is_refused(self):
        """DNS rebinding: a page on the internet pointing its own domain at
        127.0.0.1 so the browser treats this server as same-origin."""
        response = self.client.get(
            "/api/status", headers={"Host": "attacker.example"})
        self.assertEqual(response.status_code, 403)


class TestComparison(unittest.TestCase):
    """Exercised directly rather than over HTTP: the test client refuses to
    send a non-ASCII header at all, but a browser sends raw bytes and the gate
    decodes them latin-1, so a high-byte string does reach the comparison."""

    def setUp(self):
        self._saved = auth._TOKEN
        auth._TOKEN = TOKEN

    def tearDown(self):
        auth._TOKEN = self._saved

    def test_a_non_ascii_candidate_returns_false_rather_than_raising(self):
        # compare_digest raises TypeError on a non-ASCII str; encoding first is
        # what keeps a hostile cookie a refusal instead of a 500.
        self.assertFalse(auth._matches("café"))
        self.assertFalse(auth._matches("\xff\xfe\x80"))

    def test_the_right_token_still_matches(self):
        self.assertTrue(auth._matches(TOKEN))

    def test_nothing_matches_when_no_token_is_set(self):
        auth._TOKEN = None
        self.assertFalse(auth._matches(""))
        self.assertFalse(auth._matches(TOKEN))


class TestTokenPlumbing(unittest.TestCase):
    def test_a_generated_token_is_long_enough_to_not_need_rate_limiting(self):
        token = auth.new_token()
        self.assertGreaterEqual(len(token), 32)
        self.assertNotEqual(token, auth.new_token())

    def test_the_token_is_read_from_the_user_config_not_the_model_stack(self):
        """server.py binds `load_config` to the model stack's config; reading
        the wrong one would silently return None and disable the gate."""
        import inspect

        source = inspect.getsource(auth.load_token)
        self.assertIn("from ..config import load_config", source)


if __name__ == "__main__":
    unittest.main()
