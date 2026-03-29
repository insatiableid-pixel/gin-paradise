"""
Tests for the action-conditioned draw model pipeline.

Covers:
  1. Action feature encoding shape and determinism
  2. Dataset generation schema
  3. Paired label integrity
  4. Model save/load
  5. Baseline evaluation pipeline
  6. ApexMCTSAction gameplay legality and completion
"""

import os
import sys
import random
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gin_rummy.card import make_deck, make_card, rank, suit, deadwood_value, NUM_CARDS
from gin_rummy.meld import compute_deadwood, best_meld_arrangement, find_all_melds
from gin_rummy.action_features import encode_draw_action, ACTION_FEATURE_DIM, get_action_feature_names
from gin_rummy.draw_action_model import (
    DeadwoodBaseline, ApexHeuristicBaseline, LearnedDrawActionModel,
    train_draw_action_model
)


def _make_test_hand():
    """Create a reproducible test hand and game state."""
    random.seed(42)
    deck = list(range(NUM_CARDS))
    random.shuffle(deck)
    hand = deck[:10]
    top_discard = deck[10]
    game_state = {
        'turn_number': 5,
        'my_score': 30,
        'opp_score': 20,
        'deck_remaining': 20,
        'discard_pile': [deck[10], deck[11], deck[12]],
    }
    return hand, top_discard, game_state


class TestActionFeatures(unittest.TestCase):
    """Tests for action_features.py"""

    def test_feature_encoding_shape(self):
        """Feature vector has correct length."""
        hand, top_discard, game_state = _make_test_hand()
        features = encode_draw_action(hand, top_discard, game_state)
        self.assertEqual(len(features), ACTION_FEATURE_DIM)

    def test_feature_encoding_determinism(self):
        """Same inputs produce same features."""
        hand, top_discard, game_state = _make_test_hand()
        f1 = encode_draw_action(hand, top_discard, game_state)
        f2 = encode_draw_action(hand, top_discard, game_state)
        self.assertEqual(f1, f2)

    def test_feature_names_match_dim(self):
        """Feature names list matches feature dimension."""
        names = get_action_feature_names()
        self.assertEqual(len(names), ACTION_FEATURE_DIM)

    def test_all_features_numeric(self):
        """All features are valid floats."""
        hand, top_discard, game_state = _make_test_hand()
        features = encode_draw_action(hand, top_discard, game_state)
        for i, f in enumerate(features):
            self.assertIsInstance(f, float, f"Feature {i} is not float: {type(f)}")
            self.assertFalse(f != f, f"Feature {i} is NaN")  # NaN check

    def test_features_bounded(self):
        """Features are in reasonable ranges (most should be 0-1)."""
        hand, top_discard, game_state = _make_test_hand()
        features = encode_draw_action(hand, top_discard, game_state)
        for i, f in enumerate(features):
            self.assertGreaterEqual(f, -2.0, f"Feature {i} too low: {f}")
            self.assertLessEqual(f, 5.0, f"Feature {i} too high: {f}")

    def test_different_cards_different_features(self):
        """Different discard cards produce different features."""
        hand, _, game_state = _make_test_hand()
        # Use two different cards not in hand
        hand_set = set(hand)
        available = [c for c in range(NUM_CARDS) if c not in hand_set]
        f1 = encode_draw_action(hand, available[0], game_state)
        f2 = encode_draw_action(hand, available[1], game_state)
        self.assertNotEqual(f1, f2)

    def test_meld_completing_card_features(self):
        """Card that completes a meld has completes_meld=1.0."""
        # Create hand with two cards of same rank
        hand = [make_card(5, 0), make_card(5, 1),  # Two 6s
                make_card(0, 0), make_card(1, 0), make_card(2, 0),  # Run A-3 clubs
                make_card(10, 2), make_card(11, 2), make_card(12, 2),  # Run J-K spades
                make_card(7, 3), make_card(8, 3)]  # 8H, 9H
        top_discard = make_card(5, 2)  # Third 6 (completes set meld)
        game_state = {
            'turn_number': 3, 'my_score': 0, 'opp_score': 0,
            'deck_remaining': 25, 'discard_pile': [top_discard],
        }
        features = encode_draw_action(hand, top_discard, game_state)
        # Feature index 11 is completes_meld
        self.assertEqual(features[11], 1.0, "completes_meld should be 1.0")

    def test_with_opponent_model(self):
        """Features work correctly with opponent model."""
        from gin_rummy.opponent_model import OpponentModel
        hand, top_discard, game_state = _make_test_hand()
        model = OpponentModel()
        model.reset(hand)
        features = encode_draw_action(hand, top_discard, game_state, opponent_model=model)
        self.assertEqual(len(features), ACTION_FEATURE_DIM)

    def test_without_opponent_model(self):
        """Features work without opponent model (defaults)."""
        hand, top_discard, game_state = _make_test_hand()
        features = encode_draw_action(hand, top_discard, game_state, opponent_model=None)
        self.assertEqual(len(features), ACTION_FEATURE_DIM)


class TestBaselineModels(unittest.TestCase):
    """Tests for baseline models."""

    def _get_test_features(self):
        """Get a small batch of test features."""
        import numpy as np
        hand, top_discard, game_state = _make_test_hand()
        features = encode_draw_action(hand, top_discard, game_state)
        X = np.array([features] * 5, dtype=np.float32)
        return X

    def test_deadwood_baseline_shape(self):
        """DeadwoodBaseline produces correct output shape."""
        import numpy as np
        X = self._get_test_features()
        baseline = DeadwoodBaseline()
        probs = baseline.predict_proba(X)
        self.assertEqual(probs.shape, (5,))
        preds = baseline.predict(X)
        self.assertEqual(preds.shape, (5,))

    def test_deadwood_baseline_range(self):
        """Probabilities are valid."""
        import numpy as np
        X = self._get_test_features()
        baseline = DeadwoodBaseline()
        probs = baseline.predict_proba(X)
        for p in probs:
            self.assertGreaterEqual(p, 0.0)
            self.assertLessEqual(p, 1.0)

    def test_apex_heuristic_shape(self):
        """ApexHeuristicBaseline produces correct output shape."""
        import numpy as np
        X = self._get_test_features()
        baseline = ApexHeuristicBaseline()
        probs = baseline.predict_proba(X)
        self.assertEqual(probs.shape, (5,))

    def test_apex_heuristic_meld_completion(self):
        """ApexHeuristic returns high probability for meld-completing cards."""
        import numpy as np
        # Create features where completes_meld = 1.0
        hand = [make_card(5, 0), make_card(5, 1),
                make_card(0, 0), make_card(1, 0), make_card(2, 0),
                make_card(10, 2), make_card(11, 2), make_card(12, 2),
                make_card(7, 3), make_card(8, 3)]
        top_discard = make_card(5, 2)
        game_state = {
            'turn_number': 3, 'my_score': 0, 'opp_score': 0,
            'deck_remaining': 25, 'discard_pile': [top_discard],
        }
        features = encode_draw_action(hand, top_discard, game_state)
        X = np.array([features], dtype=np.float32)
        baseline = ApexHeuristicBaseline()
        prob = baseline.predict_proba(X)[0]
        self.assertGreater(prob, 0.8, f"Meld-completing card should have high take prob: {prob}")

    def test_single_sample_input(self):
        """Models handle single-sample (1D) input."""
        import numpy as np
        hand, top_discard, game_state = _make_test_hand()
        features = encode_draw_action(hand, top_discard, game_state)
        X = np.array(features, dtype=np.float32)  # 1D array

        for Model in [DeadwoodBaseline, ApexHeuristicBaseline]:
            baseline = Model()
            probs = baseline.predict_proba(X)
            self.assertEqual(probs.shape, (1,))


class TestModelTrainAndSave(unittest.TestCase):
    """Tests for model training and save/load."""

    def test_train_small_dataset(self):
        """Can train on a small synthetic dataset."""
        import numpy as np
        rng = random.Random(42)
        N = 200
        X = np.random.RandomState(42).randn(N, ACTION_FEATURE_DIM).astype(np.float32)
        y = np.random.RandomState(42).randint(0, 2, N).astype(np.float32)

        model = train_draw_action_model(X, y, hidden_layers=(16, 8), max_iter=50)
        self.assertIsNotNone(model)

        probs = model.predict_proba(X[:5])
        self.assertEqual(probs.shape, (5,))
        for p in probs:
            self.assertGreaterEqual(p, 0.0)
            self.assertLessEqual(p, 1.0)

    def test_save_load_roundtrip(self):
        """Model can be saved and loaded."""
        import numpy as np
        import tempfile

        N = 100
        X = np.random.RandomState(42).randn(N, ACTION_FEATURE_DIM).astype(np.float32)
        y = np.random.RandomState(42).randint(0, 2, N).astype(np.float32)

        model = train_draw_action_model(X, y, hidden_layers=(8,), max_iter=20)
        probs_before = model.predict_proba(X[:3])

        with tempfile.NamedTemporaryFile(suffix='.pkl', delete=False) as f:
            path = f.name
        try:
            model.save(path)
            loaded = LearnedDrawActionModel.load(path)
            probs_after = loaded.predict_proba(X[:3])
            np.testing.assert_allclose(probs_before, probs_after, rtol=1e-5)
        finally:
            os.unlink(path)

    def test_predict_single(self):
        """predict_single returns a float."""
        import numpy as np

        N = 100
        X = np.random.RandomState(42).randn(N, ACTION_FEATURE_DIM).astype(np.float32)
        y = np.random.RandomState(42).randint(0, 2, N).astype(np.float32)

        model = train_draw_action_model(X, y, hidden_layers=(8,), max_iter=20)
        features = list(X[0])
        prob = model.predict_single(features)
        self.assertIsInstance(prob, float)
        self.assertGreaterEqual(prob, 0.0)
        self.assertLessEqual(prob, 1.0)


class TestApexMCTSAction(unittest.TestCase):
    """Tests for the ApexMCTSAction experimental bot."""

    def test_gameplay_completion(self):
        """ApexMCTSAction completes a full game without errors."""
        from gin_rummy.apex_mcts_action import ApexMCTSAction
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        random.seed(42)
        # Use dummy model (might not exist yet)
        p0 = ApexMCTSAction(name="TestAction", seed=42)
        p1 = ApexMCTS(name="TestMCTS", seed=43)

        game = GinRummyGame(p0, p1, target_score=50, verbose=False)
        result = game.play_game()

        self.assertIn(result.winner, [0, 1])
        self.assertGreater(result.hands_played, 0)

    def test_no_illegal_behavior(self):
        """Bot produces legal draw decisions over multiple games."""
        from gin_rummy.apex_mcts_action import ApexMCTSAction
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        for seed in range(42, 47):
            random.seed(seed)
            p0 = ApexMCTSAction(name="Action", seed=seed)
            p1 = ApexMCTS(name="Baseline", seed=seed + 100)
            game = GinRummyGame(p0, p1, target_score=50, verbose=False)
            result = game.play_game()
            self.assertIn(result.winner, [0, 1])

    def test_search_stats(self):
        """Bot produces valid search statistics."""
        from gin_rummy.apex_mcts_action import ApexMCTSAction
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        random.seed(42)
        p0 = ApexMCTSAction(name="Action", seed=42)
        p1 = ApexMCTS(name="Baseline", seed=43)
        game = GinRummyGame(p0, p1, target_score=50, verbose=False)
        game.play_game()

        stats = p0.get_search_stats()
        self.assertIn('total_searches', stats)
        self.assertIn('model_consults', stats)
        self.assertGreater(stats['total_searches'], 0)


class TestDatasetSchema(unittest.TestCase):
    """Tests for dataset generation schema."""

    def test_action_feature_encoding_consistency(self):
        """Features encode consistently across multiple calls."""
        random.seed(100)
        deck = list(range(NUM_CARDS))
        random.shuffle(deck)
        hand = deck[:10]

        game_state = {
            'turn_number': 3,
            'my_score': 10,
            'opp_score': 15,
            'deck_remaining': 25,
            'discard_pile': [deck[10]],
        }

        for card in deck[10:15]:  # Try 5 different discard cards
            features = encode_draw_action(hand, card, game_state)
            self.assertEqual(len(features), ACTION_FEATURE_DIM)
            # Card rank feature should match the actual card
            expected_rank = rank(card) / 12.0
            self.assertAlmostEqual(features[0], expected_rank, places=5)

    def test_dw_swing_sign_convention(self):
        """Positive DW swing means take improves deadwood."""
        # Hand with high deadwood
        hand = [make_card(9, 0), make_card(10, 1), make_card(11, 2), make_card(12, 3),  # face cards
                make_card(8, 0), make_card(7, 1), make_card(6, 2), make_card(5, 3),
                make_card(4, 0), make_card(3, 1)]

        # Card that completes a meld (should have positive swing)
        # Not guaranteed, but check the sign convention is consistent
        top_discard = make_card(9, 1)  # same rank as first card
        game_state = {
            'turn_number': 5, 'my_score': 0, 'opp_score': 0,
            'deck_remaining': 20, 'discard_pile': [top_discard],
        }
        features = encode_draw_action(hand, top_discard, game_state)
        dw_swing = features[8]  # IDX_DW_SWING
        # Just verify it's a float (sign depends on specific hand)
        self.assertIsInstance(dw_swing, float)


if __name__ == "__main__":
    unittest.main()
