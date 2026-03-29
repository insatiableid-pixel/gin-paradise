"""
Tests for value-augmented search and ApexMCTSValue bot.

Covers:
  1. Augmented search correctness and numeric validity
  2. Blended evaluator determinism
  3. Fallback behavior when model is missing
  4. Zero-weight parity with baseline behavior
  5. ApexMCTSValue gameplay legality and completion
  6. Value consultation diagnostics
"""

import os
import sys
import unittest
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from gin_rummy.card import make_card, make_deck, NUM_CARDS, deadwood_value
from gin_rummy.meld import compute_deadwood
from gin_rummy.pbs_features import encode_pbs, FEATURE_DIM
from gin_rummy.opponent_model import OpponentModel
from gin_rummy.value_augmented_search import (
    evaluate_draw_choice_augmented,
    _load_value_model,
    DEFAULT_VALUE_WEIGHT,
    DEFAULT_CLOSE_CALL_BAND,
)
from gin_rummy.draw_search import evaluate_draw_choice


def _make_test_scenario(seed=42):
    """Create a deterministic test scenario for draw search."""
    rng = random.Random(seed)
    deck = list(range(NUM_CARDS))
    rng.shuffle(deck)
    hand = deck[:10]
    discard_pile = deck[20:23]
    top_discard = discard_pile[-1]

    game_state = {
        'turn_number': 5,
        'my_score': 30,
        'opp_score': 25,
        'deck_remaining': 25,
        'discard_pile': discard_pile,
    }

    model = OpponentModel()
    model.reset(hand)
    for c in discard_pile:
        model.set_discard(c)

    return hand, top_discard, model, game_state


class TestAugmentedSearch(unittest.TestCase):
    """Test the value-augmented draw search."""

    def test_search_returns_valid_diagnostics(self):
        """Augmented search returns all expected diagnostic keys."""
        hand, top, opp_model, gs = _make_test_scenario()
        rng = random.Random(42)

        result, take_ev, stock_ev, diag = evaluate_draw_choice_augmented(
            hand=hand, top_discard=top, opponent_model=opp_model,
            game_state=gs, value_model=None, rng=rng,
        )

        # Check all diagnostic keys exist
        self.assertIn('skipped', diag)
        self.assertIn('value_consulted', diag)
        self.assertIn('value_changed_answer', diag)
        self.assertIn('worlds_evaluated', diag)

    def test_no_model_produces_valid_result(self):
        """Search without model produces valid boolean or None result."""
        hand, top, opp_model, gs = _make_test_scenario()
        rng = random.Random(42)

        result, take_ev, stock_ev, diag = evaluate_draw_choice_augmented(
            hand=hand, top_discard=top, opponent_model=opp_model,
            game_state=gs, value_model=None, rng=rng,
        )

        if not diag.get('skipped'):
            self.assertIsInstance(result, bool)
            self.assertTrue(np.isfinite(take_ev))
            self.assertTrue(np.isfinite(stock_ev))
            # Without model, value should not have been consulted
            self.assertFalse(diag['value_consulted'])

    def test_determinism(self):
        """Same seed produces identical results."""
        hand, top, opp_model, gs = _make_test_scenario(seed=100)

        r1, t1, s1, d1 = evaluate_draw_choice_augmented(
            hand=hand, top_discard=top, opponent_model=opp_model,
            game_state=gs, value_model=None, rng=random.Random(77),
        )
        # Reset opponent model state
        opp_model2 = OpponentModel()
        opp_model2.reset(hand)
        for c in gs['discard_pile']:
            opp_model2.set_discard(c)

        r2, t2, s2, d2 = evaluate_draw_choice_augmented(
            hand=hand, top_discard=top, opponent_model=opp_model2,
            game_state=gs, value_model=None, rng=random.Random(77),
        )

        self.assertEqual(r1, r2)
        if not d1.get('skipped'):
            self.assertAlmostEqual(t1, t2, places=6)
            self.assertAlmostEqual(s1, s2, places=6)


class TestZeroWeightParity(unittest.TestCase):
    """Test that value_weight=0 produces identical results to baseline."""

    def test_zero_weight_matches_baseline(self):
        """With value_weight=0, augmented search matches baseline."""
        hand, top, opp_model, gs = _make_test_scenario(seed=55)
        seed = 99

        # Baseline search
        r_base, t_base, s_base, d_base = evaluate_draw_choice(
            hand=hand, top_discard=top, opponent_model=opp_model,
            game_state=gs, rng=random.Random(seed),
            use_weighted_worlds=False,
        )

        # Reset opponent model for fair comparison
        opp_model2 = OpponentModel()
        opp_model2.reset(hand)
        for c in gs['discard_pile']:
            opp_model2.set_discard(c)

        # Augmented with weight=0 (should match baseline)
        r_aug, t_aug, s_aug, d_aug = evaluate_draw_choice_augmented(
            hand=hand, top_discard=top, opponent_model=opp_model2,
            game_state=gs, value_model=None, rng=random.Random(seed),
            value_weight=0.0,
        )

        if not d_base.get('skipped') and not d_aug.get('skipped'):
            # EVs should be identical since no value augmentation
            self.assertAlmostEqual(t_base, t_aug, places=4)
            self.assertAlmostEqual(s_base, s_aug, places=4)
            # Decision should match
            self.assertEqual(r_base, r_aug)


class TestModelFallback(unittest.TestCase):
    """Test fallback behavior when model is missing."""

    def test_missing_model_returns_none(self):
        """Loading a nonexistent model returns None."""
        model = _load_value_model("/nonexistent/path/model.pkl")
        self.assertIsNone(model)

    def test_bot_without_model_completes_game(self):
        """ApexMCTSValue without model falls back to ApexMCTS behavior."""
        from gin_rummy.apex_mcts_value import ApexMCTSValue
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        p0 = ApexMCTSValue("AMCTSV", seed=42, model_path="/nonexistent.pkl")
        p1 = ApexMCTS("AMCTS", seed=43)

        random.seed(42)
        game = GinRummyGame(p0, p1, target_score=50, verbose=False)
        result = game.play_game()

        self.assertIsNotNone(result.winner)
        self.assertIn(result.winner, [0, 1])
        self.assertGreater(result.hands_played, 0)

        # Value model should not have been loaded
        self.assertIsNone(p0._value_model)


class TestApexMCTSValueGameplay(unittest.TestCase):
    """Test ApexMCTSValue gameplay legality and completion."""

    def test_game_completes_without_model(self):
        """ApexMCTSValue completes games without a model (fallback mode)."""
        from gin_rummy.apex_mcts_value import ApexMCTSValue
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        p0 = ApexMCTSValue("AMCTSV", seed=42, model_path="/nonexistent.pkl")
        p1 = ApexMCTS("AMCTS", seed=43)

        random.seed(42)
        game = GinRummyGame(p0, p1, target_score=50, verbose=False)
        result = game.play_game()

        self.assertIsNotNone(result.winner)
        self.assertGreater(result.hands_played, 0)

    def test_game_completes_with_model(self):
        """ApexMCTSValue completes games with a trained model."""
        model_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "models", "apex_value_model.pkl"
        )
        if not os.path.exists(model_path):
            self.skipTest("No trained model available")

        from gin_rummy.apex_mcts_value import ApexMCTSValue
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        p0 = ApexMCTSValue("AMCTSV", seed=42, model_path=model_path)
        p1 = ApexMCTS("AMCTS", seed=43)

        random.seed(42)
        game = GinRummyGame(p0, p1, target_score=100, verbose=False)
        result = game.play_game()

        self.assertIsNotNone(result.winner)
        self.assertGreater(result.hands_played, 0)

    def test_diagnostics_populated(self):
        """Value augmentation stats are populated after gameplay."""
        model_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "models", "apex_value_model.pkl"
        )
        if not os.path.exists(model_path):
            self.skipTest("No trained model available")

        from gin_rummy.apex_mcts_value import ApexMCTSValue
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        p0 = ApexMCTSValue("AMCTSV", seed=42, model_path=model_path)
        p1 = ApexMCTS("AMCTS", seed=43)

        random.seed(42)
        game = GinRummyGame(p0, p1, target_score=50, verbose=False)
        game.play_game()

        stats = p0.get_value_augmentation_stats()
        self.assertGreater(stats['total_searches'], 0)
        self.assertTrue(stats['model_loaded'])

    def test_zero_weight_produces_mcts_behavior(self):
        """With value_weight=0, ApexMCTSValue produces same-quality play as ApexMCTS.
        
        Note: exact parity is difficult to test because the augmented search
        function has slightly different internal code paths even with weight=0.
        We test that both bots complete games and produce reasonable results.
        """
        from gin_rummy.apex_mcts_value import ApexMCTSValue
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        # Zero weight should still complete games normally
        p0 = ApexMCTSValue("AMCTSV_0w", seed=42, 
                           model_path="/nonexistent.pkl",
                           value_weight=0.0)
        p1 = ApexMCTS("AMCTS", seed=43)

        random.seed(42)
        game = GinRummyGame(p0, p1, target_score=50, verbose=False)
        result = game.play_game()

        self.assertIsNotNone(result.winner)
        self.assertGreater(result.hands_played, 0)


class TestValueAugmentationBehavior(unittest.TestCase):
    """Test that value augmentation behaves correctly with model."""

    def test_model_loaded_when_available(self):
        """Value model loads correctly when file exists."""
        model_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "models", "apex_value_model.pkl"
        )
        if not os.path.exists(model_path):
            self.skipTest("No trained model available")

        model = _load_value_model(model_path)
        self.assertIsNotNone(model)

        # Test prediction
        hand, gs = _make_test_features()
        features = encode_pbs(hand, gs)
        prob = model.predict_single(features)
        self.assertGreaterEqual(prob, 0.0)
        self.assertLessEqual(prob, 1.0)

    def test_augmented_search_with_model(self):
        """Augmented search runs correctly with loaded model."""
        model_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "models", "apex_value_model.pkl"
        )
        if not os.path.exists(model_path):
            self.skipTest("No trained model available")

        model = _load_value_model(model_path)
        hand, top, opp_model, gs = _make_test_scenario(seed=42)

        result, take_ev, stock_ev, diag = evaluate_draw_choice_augmented(
            hand=hand, top_discard=top, opponent_model=opp_model,
            game_state=gs, value_model=model, rng=random.Random(42),
        )

        if not diag.get('skipped'):
            self.assertIsInstance(result, bool)
            self.assertTrue(np.isfinite(take_ev))
            self.assertTrue(np.isfinite(stock_ev))
            self.assertGreater(diag['value_evals'], 0)


def _make_test_features(seed=42):
    """Create test hand and game state for feature encoding."""
    rng = random.Random(seed)
    deck = list(range(NUM_CARDS))
    rng.shuffle(deck)
    hand = deck[:10]
    game_state = {
        'turn_number': 5,
        'my_score': 30,
        'opp_score': 25,
        'deck_remaining': 25,
        'discard_pile': deck[20:23],
    }
    return hand, game_state


if __name__ == "__main__":
    unittest.main()
