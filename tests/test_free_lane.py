"""Tests for the free provider lane and its failover.

The bugs these cover are the ones that actually happened while wiring four
free providers up to real keys:

- A hardcoded model id is a dead id within weeks. Google had retired the one
  in this file for new accounts, and Cerebras had never served the ones named.
  So the lane discovers what a provider lists and ranks it, and the ranking is
  what gets tested -- not any particular id.
- "The key is present" and "the key works" are different facts. Cerebras
  answers 402 to every model on a perfectly valid free key. That refusal must
  fail over like a rate limit but must not be *retried* like one.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from src.local.free_providers import (ACCOUNT_COOLDOWN_S, COOLDOWN_S,
                                      PROVIDERS, FreeLane, best_model, by_id)


class TestModelRanking(unittest.TestCase):
    """`best_model` picks from what the provider actually lists."""

    def _pick(self, provider_id: str, roster: list[str]) -> str:
        provider = by_id(provider_id)
        with patch("src.local.free_providers.list_models", return_value=roster):
            return best_model(provider)

    def test_google_prefers_the_latest_alias_over_a_retired_version(self):
        """The bug: a plain "flash-lite" match lands on 2.5, which is closed.

        Google lists every generation at once and 2.5 sorts first, so matching
        the family name alone picked a model that 404s for new accounts.
        """
        chosen = self._pick("google", [
            "models/gemini-2.5-flash-lite",       # retired for new accounts
            "models/gemini-3.5-flash-lite",
            "models/gemini-flash-lite-latest",
        ])
        self.assertEqual(chosen, "models/gemini-flash-lite-latest")

    def test_google_falls_back_through_generations(self):
        """Without the alias, take the newest flash-lite that is on offer."""
        chosen = self._pick("google", [
            "models/gemini-2.5-flash-lite",
            "models/gemini-3.5-flash-lite",
        ])
        self.assertEqual(chosen, "models/gemini-3.5-flash-lite")

    def test_google_prefers_lite_over_full_flash(self):
        """Full flash reasons first and returns nothing under a small cap.

        Measured: a 12-token budget on gemini-3.5-flash comes back empty
        because the whole budget went to hidden reasoning tokens. This lane
        serves short roles, so lite is not a downgrade here -- it is the only
        one that answers.
        """
        chosen = self._pick("google", [
            "models/gemini-3.5-flash",
            "models/gemini-3.5-flash-lite",
        ])
        self.assertEqual(chosen, "models/gemini-3.5-flash-lite")

    def test_groq_prefers_the_small_fast_model(self):
        chosen = self._pick("groq", [
            "llama-3.1-8b-instant", "llama-3.3-70b-versatile",
        ])
        self.assertEqual(chosen, "llama-3.1-8b-instant")

    def test_non_chat_endpoints_are_never_chosen(self):
        """A substring match would happily land on a speech endpoint."""
        chosen = self._pick("groq", [
            "whisper-large-v3", "llama-3.1-8b-instant",
        ])
        self.assertEqual(chosen, "llama-3.1-8b-instant")

    def test_unranked_roster_still_yields_something_usable(self):
        chosen = self._pick("groq", ["some-unknown-model"])
        self.assertEqual(chosen, "some-unknown-model")

    def test_empty_roster_falls_back_to_the_configured_id(self):
        provider = by_id("groq")
        with patch("src.local.free_providers.list_models", return_value=[]):
            self.assertEqual(best_model(provider), provider.models[0])


class TestFailureClassification(unittest.TestCase):
    """Whose fault the failure is decides whether to fail over, and for how long."""

    def setUp(self):
        self.lane = FreeLane()

    def test_rate_limit_cools_down_briefly(self):
        self.assertTrue(self.lane.note_failure(
            "groq", RuntimeError("Error code: 429 - rate limit reached")))
        remaining = self.lane._cooldown["groq"] - __import__("time").time()
        self.assertLessEqual(remaining, COOLDOWN_S + 1)
        self.assertGreater(remaining, COOLDOWN_S - 10)

    def test_payment_required_is_benched_for_much_longer(self):
        """402 will still be 402 in ninety seconds; only billing changes it."""
        self.assertTrue(self.lane.note_failure("cerebras", RuntimeError(
            "Error code: 402 - {'message': 'Payment required to access this "
            "resource. Visit your billing tab.'}")))
        remaining = self.lane._cooldown["cerebras"] - __import__("time").time()
        self.assertGreater(remaining, COOLDOWN_S * 2)
        self.assertLessEqual(remaining, ACCOUNT_COOLDOWN_S + 1)

    def test_retired_model_is_treated_as_an_account_refusal(self):
        self.assertTrue(self.lane.note_failure("google", RuntimeError(
            "Error code: 404 - This model is no longer available to new users")))

    def test_our_own_bad_request_does_not_fail_over(self):
        """A malformed body fails identically everywhere.

        Failing over would spend four providers' rate limits on one bug.
        """
        self.assertFalse(self.lane.note_failure(
            "groq", RuntimeError("Error code: 400 - invalid 'messages[0].role'")))
        self.assertNotIn("groq", self.lane._cooldown)


class TestLaneSelection(unittest.TestCase):
    def setUp(self):
        self.all_on = [p for p in PROVIDERS]

    def test_a_benched_provider_is_skipped_and_another_is_offered(self):
        lane = FreeLane()
        with patch("src.local.free_providers.enabled_providers",
                   return_value=self.all_on):
            self.assertEqual(lane.pick().id, "groq")
            lane.note_failure("groq", RuntimeError("429 rate limit"))
            second = lane.pick()
            self.assertIsNotNone(second)
            self.assertNotEqual(second.id, "groq")

    def test_context_ceiling_keeps_a_small_provider_out_of_long_work(self):
        """Cerebras is the fastest option and caps at 8k. Speed is not enough."""
        lane = FreeLane()
        with patch("src.local.free_providers.enabled_providers",
                   return_value=self.all_on):
            roomy = [p.id for p in lane.available(min_context=32_000)]
        self.assertNotIn("cerebras", roomy)

    def test_no_provider_left_returns_none_rather_than_raising(self):
        lane = FreeLane()
        with patch("src.local.free_providers.enabled_providers", return_value=[]):
            self.assertIsNone(lane.pick())

    def test_a_key_alone_does_not_enable_a_provider(self):
        """Consent is per provider. Someone may have GROQ_API_KEY set for an
        unrelated tool; that is not permission to send this code through it."""
        provider = by_id("groq")
        with patch.dict("os.environ", {"GROQ_API_KEY": "gsk_test"}), \
             patch("src.config.load_config", return_value={"providers": {}}):
            self.assertTrue(provider.key())
            self.assertFalse(provider.enabled())


class TestPixelBackendFallback(unittest.TestCase):
    """A locked fal account should cost the user a note, not eight frames."""

    def test_account_refusals_are_recognised(self):
        from src.media.fal import FalError
        from src.media.pixel_jobs import _account_refusal

        for message in (
            "User is locked. Reason: Exhausted balance. (fal 403, https://x)",
            "Unauthorized (fal 401, https://x)",
            "Invalid API key (fal 403, https://x)",
        ):
            self.assertTrue(_account_refusal(FalError(message)), message)

    def test_request_failures_are_not_account_refusals(self):
        """A rejected prompt or a timeout would fail the same on any backend."""
        from src.media.fal import FalError
        from src.media.pixel_jobs import _account_refusal

        for message in (
            "prompt rejected by the safety checker (fal 422, https://x)",
            "timed out waiting for fal",
            "fal returned no image",
        ):
            self.assertFalse(_account_refusal(FalError(message)), message)


if __name__ == "__main__":
    unittest.main()
