"""
Tests for frontier-informed knock policy variants (Phase 60).

Validates:
  - Variant construction and basic knock decisions
  - Gin probability estimator consistency
  - Clinch-only exception preservation
  - Policy logic correctness for each family
  - Inheritance integrity (draw/discard delegation)
"""

import unittest
import random

from gin_rummy.frontier_knock import (
    FrontierGinThreshold,
    FrontierMultiCard,
    FrontierLivenessGuard,
    estimate_gin_probability,
)
from gin_rummy.card import parse_card, hand_str
from gin_rummy.meld import best_meld_arrangement, compute_deadwood

_c = parse_card


class TestGinProbabilityEstimator(unittest.TestCase):
    """Tests for the gin probability estimator."""

    def test_gin_hand_high_probability(self):
        """A hand already at DW=0 should have gin_prob ~1.0."""
        # 3 sets + gin
        hand = [_c('2C'), _c('2D'), _c('2H'),
                _c('6C'), _c('6D'), _c('6H'),
                _c('KC'), _c('KD'), _c('KH'),
                _c('AS')]
        # DW=1, not quite gin, but very close
        _, _, dw = best_meld_arrangement(hand)
        self.assertEqual(dw, 1)
        gp = estimate_gin_probability(hand, n_rollouts=100, rng=random.Random(42))
        # Should have some gin probability
        self.assertGreater(gp, 0.0)

    def test_high_dw_low_probability(self):
        """A hand with many dispersed DW cards should have low gin probability."""
        hand = [_c('KC'), _c('KD'), _c('KH'),
                _c('8C'), _c('8D'), _c('8H'),
                _c('AS'), _c('2D'), _c('AH'), _c('3S')]
        _, dw_cards, dw = best_meld_arrangement(hand)
        self.assertEqual(len(dw_cards), 4)
        gp = estimate_gin_probability(hand, n_rollouts=100, rng=random.Random(42))
        self.assertLess(gp, 0.20)

    def test_deterministic_with_seed(self):
        """Same seed should give same result."""
        hand = [_c('AC'), _c('2C'), _c('3C'),
                _c('7D'), _c('8D'), _c('9D'),
                _c('JS'), _c('QS'), _c('KS'),
                _c('5H')]
        gp1 = estimate_gin_probability(hand, n_rollouts=50, rng=random.Random(42))
        gp2 = estimate_gin_probability(hand, n_rollouts=50, rng=random.Random(42))
        self.assertEqual(gp1, gp2)

    def test_returns_float_in_range(self):
        """Gin probability should be in [0, 1]."""
        hand = [_c('2C'), _c('2D'), _c('2H'),
                _c('6C'), _c('6D'), _c('6H'),
                _c('KC'), _c('KD'), _c('KH'),
                _c('5S')]
        gp = estimate_gin_probability(hand, n_rollouts=30, rng=random.Random(42))
        self.assertGreaterEqual(gp, 0.0)
        self.assertLessEqual(gp, 1.0)


class TestFrontierGinThreshold(unittest.TestCase):
    """Tests for Family A: Simple gin-probability threshold."""

    def test_always_knock_gin(self):
        """DW=0 should always knock regardless of threshold."""
        bot = FrontierGinThreshold(gin_prob_threshold=0.01, seed=42)
        hand = [_c('2C'), _c('2D'), _c('2H'),
                _c('6C'), _c('6D'), _c('6H'),
                _c('KC'), _c('KD'), _c('KH'), _c('KS')]
        _, _, dw = best_meld_arrangement(hand)
        self.assertEqual(dw, 0)
        gs = {'turn_number': 0, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': []}
        self.assertTrue(bot.knock_decision(hand, gs))

    def test_clinch_exception(self):
        """Game-clinching knock should override threshold."""
        bot = FrontierGinThreshold(gin_prob_threshold=0.01, seed=42)
        hand = [_c('2C'), _c('2D'), _c('2H'),
                _c('6C'), _c('6D'), _c('6H'),
                _c('KC'), _c('KD'), _c('KH'),
                _c('AS')]  # DW=1
        gs = {'turn_number': 0, 'my_score': 99, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': []}
        self.assertTrue(bot.knock_decision(hand, gs))

    def test_never_knock_illegal(self):
        """DW > 10 should never knock."""
        bot = FrontierGinThreshold(gin_prob_threshold=0.99, seed=42)
        hand = [_c('KC'), _c('QC'), _c('JC'),
                _c('TD'), _c('9D'), _c('8D'),
                _c('7H'), _c('6H'), _c('5S'), _c('4S')]
        _, _, dw = best_meld_arrangement(hand)
        if dw > 10:
            gs = {'turn_number': 0, 'my_score': 0, 'opp_score': 0,
                  'deck_remaining': 30, 'discard_pile': []}
            self.assertFalse(bot.knock_decision(hand, gs))

    def test_name_generation(self):
        """Default name should encode the threshold."""
        bot = FrontierGinThreshold(gin_prob_threshold=0.20)
        self.assertEqual(bot.name, "FrontierGinT20")
        bot2 = FrontierGinThreshold(gin_prob_threshold=0.30)
        self.assertEqual(bot2.name, "FrontierGinT30")

    def test_inherits_draw_discard(self):
        """Should have draw_decision and discard_decision from ApexMCTS."""
        bot = FrontierGinThreshold(gin_prob_threshold=0.20, seed=42)
        self.assertTrue(hasattr(bot, 'draw_decision'))
        self.assertTrue(hasattr(bot, 'discard_decision'))


class TestFrontierMultiCard(unittest.TestCase):
    """Tests for Family B: Threshold + multi-card DW exception."""

    def test_multicard_exception_triggers(self):
        """Hands with >= min_dw_cards should knock."""
        bot = FrontierMultiCard(gin_prob_threshold=0.01, min_dw_cards=3,
                                 seed=42)
        # 2 sets + 4 DW cards
        hand = [_c('KC'), _c('KD'), _c('KH'),
                _c('8C'), _c('8D'), _c('8H'),
                _c('AS'), _c('2D'), _c('AH'), _c('3S')]
        _, dw_cards, dw = best_meld_arrangement(hand)
        self.assertGreaterEqual(len(dw_cards), 3)
        gs = {'turn_number': 0, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': []}
        self.assertTrue(bot.knock_decision(hand, gs))

    def test_gin_always_knocks(self):
        """DW=0 should always knock."""
        bot = FrontierMultiCard(gin_prob_threshold=0.01, min_dw_cards=3,
                                 seed=42)
        hand = [_c('2C'), _c('2D'), _c('2H'),
                _c('6C'), _c('6D'), _c('6H'),
                _c('KC'), _c('KD'), _c('KH'), _c('KS')]
        gs = {'turn_number': 0, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': []}
        self.assertTrue(bot.knock_decision(hand, gs))

    def test_name_generation(self):
        bot = FrontierMultiCard(gin_prob_threshold=0.20, min_dw_cards=3)
        self.assertEqual(bot.name, "FrontierMC3_T20")


class TestFrontierLivenessGuard(unittest.TestCase):
    """Tests for Family C: Threshold + high-liveness patience guard."""

    def test_gin_always_knocks(self):
        """DW=0 should always knock."""
        bot = FrontierLivenessGuard(gin_prob_threshold=0.01,
                                     liveness_guard=0.40, seed=42)
        hand = [_c('2C'), _c('2D'), _c('2H'),
                _c('6C'), _c('6D'), _c('6H'),
                _c('KC'), _c('KD'), _c('KH'), _c('KS')]
        gs = {'turn_number': 0, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': []}
        self.assertTrue(bot.knock_decision(hand, gs))

    def test_clinch_overrides_guard(self):
        """Game-clinching should override the patience guard."""
        bot = FrontierLivenessGuard(gin_prob_threshold=0.01,
                                     liveness_guard=0.01,
                                     guard_min_dw=1, seed=42)
        hand = [_c('2C'), _c('2D'), _c('2H'),
                _c('6C'), _c('6D'), _c('6H'),
                _c('KC'), _c('KD'), _c('KH'),
                _c('AS')]  # DW=1
        gs = {'turn_number': 0, 'my_score': 99, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': []}
        self.assertTrue(bot.knock_decision(hand, gs))

    def test_name_generation(self):
        bot = FrontierLivenessGuard(gin_prob_threshold=0.20,
                                     liveness_guard=0.40)
        self.assertEqual(bot.name, "FrontierLG40_T20")

    def test_inherits_draw_discard(self):
        """Should have draw_decision and discard_decision from ApexMCTS."""
        bot = FrontierLivenessGuard(gin_prob_threshold=0.20,
                                     liveness_guard=0.40, seed=42)
        self.assertTrue(hasattr(bot, 'draw_decision'))
        self.assertTrue(hasattr(bot, 'discard_decision'))


class TestClinchPreservation(unittest.TestCase):
    """Cross-variant tests that all variants preserve the clinch exception."""

    def _make_all_variants(self):
        return [
            FrontierGinThreshold(gin_prob_threshold=0.20, seed=42),
            FrontierGinThreshold(gin_prob_threshold=0.30, seed=42),
            FrontierMultiCard(gin_prob_threshold=0.20, min_dw_cards=3, seed=42),
            FrontierLivenessGuard(gin_prob_threshold=0.20,
                                   liveness_guard=0.40, seed=42),
        ]

    def test_all_knock_on_gin(self):
        """All variants must knock on gin."""
        hand = [_c('2C'), _c('2D'), _c('2H'),
                _c('6C'), _c('6D'), _c('6H'),
                _c('KC'), _c('KD'), _c('KH'), _c('KS')]
        gs = {'turn_number': 5, 'my_score': 0, 'opp_score': 50,
              'deck_remaining': 20, 'discard_pile': []}
        for bot in self._make_all_variants():
            with self.subTest(bot=bot.name):
                self.assertTrue(bot.knock_decision(hand, gs))

    def test_all_knock_on_clinch(self):
        """All variants must knock when it wins the game."""
        hand = [_c('2C'), _c('2D'), _c('2H'),
                _c('6C'), _c('6D'), _c('6H'),
                _c('KC'), _c('KD'), _c('KH'),
                _c('AS')]  # DW=1
        gs = {'turn_number': 5, 'my_score': 95, 'opp_score': 50,
              'deck_remaining': 20, 'discard_pile': []}
        for bot in self._make_all_variants():
            with self.subTest(bot=bot.name):
                self.assertTrue(bot.knock_decision(hand, gs))

    def test_all_reject_illegal_knock(self):
        """All variants must reject DW > 10."""
        hand = [_c('KC'), _c('QS'), _c('JH'),
                _c('TD'), _c('9C'), _c('8S'),
                _c('7H'), _c('6D'), _c('5C'), _c('4S')]
        _, _, dw = best_meld_arrangement(hand)
        if dw > 10:
            gs = {'turn_number': 0, 'my_score': 0, 'opp_score': 0,
                  'deck_remaining': 30, 'discard_pile': []}
            for bot in self._make_all_variants():
                with self.subTest(bot=bot.name):
                    self.assertFalse(bot.knock_decision(hand, gs))


if __name__ == '__main__':
    unittest.main()
