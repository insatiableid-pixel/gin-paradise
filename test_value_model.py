"""
Tests for the value model infrastructure.

Tests cover:
  1. Feature encoding shape, determinism, and schema
  2. Baseline predictor output range and shape
  3. Model save/load roundtrip
  4. Dataset generation shape and schema
  5. Baseline vs model evaluation pipeline
  6. ApexValue gameplay legality and completion
"""

import os
import sys
import unittest
import random
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from gin_rummy.card import make_card, make_deck, NUM_CARDS
from gin_rummy.meld import compute_deadwood
from gin_rummy.pbs_features import encode_pbs, FEATURE_DIM, get_feature_names
from gin_rummy.value_model import BaselinePredictor, LearnedValueModel, train_value_model


class TestPBSFeatures(unittest.TestCase):
    """Test the PBS feature encoder."""

    def _make_hand_and_state(self, seed=42):
        """Create a deterministic hand and game state for testing."""
        rng = random.Random(seed)
        deck = list(range(NUM_CARDS))
        rng.shuffle(deck)
        hand = deck[:10]
        discard_pile = deck[20:23]

        game_state = {
            'turn_number': 3,
            'my_score': 25,
            'opp_score': 40,
            'deck_remaining': 28,
            'discard_pile': discard_pile,
        }
        return hand, game_state

    def test_feature_vector_shape(self):
        """Feature vector has correct dimensionality."""
        hand, gs = self._make_hand_and_state()
        features = encode_pbs(hand, gs)
        self.assertEqual(len(features), FEATURE_DIM)

    def test_feature_vector_determinism(self):
        """Same input produces identical features."""
        hand, gs = self._make_hand_and_state(seed=123)
        f1 = encode_pbs(hand, gs)
        f2 = encode_pbs(hand, gs)
        self.assertEqual(f1, f2)

    def test_different_hands_different_features(self):
        """Different hands produce different features."""
        hand1, gs1 = self._make_hand_and_state(seed=1)
        hand2, gs2 = self._make_hand_and_state(seed=2)
        f1 = encode_pbs(hand1, gs1)
        f2 = encode_pbs(hand2, gs2)
        self.assertNotEqual(f1, f2)

    def test_feature_names_match_dim(self):
        """Feature names list matches feature dimension."""
        names = get_feature_names()
        self.assertEqual(len(names), FEATURE_DIM)

    def test_hand_card_features(self):
        """Hand card presence features are binary and correct."""
        hand, gs = self._make_hand_and_state()
        features = encode_pbs(hand, gs)

        # First 52 features are hand card presence
        hand_set = set(hand)
        for c in range(NUM_CARDS):
            expected = 1.0 if c in hand_set else 0.0
            self.assertEqual(features[c], expected,
                             f"Card {c}: expected {expected}, got {features[c]}")

    def test_all_features_numeric(self):
        """All features are finite numbers."""
        hand, gs = self._make_hand_and_state()
        features = encode_pbs(hand, gs)
        for i, f in enumerate(features):
            self.assertIsInstance(f, float, f"Feature {i} is not float")
            self.assertTrue(np.isfinite(f), f"Feature {i} is not finite: {f}")

    def test_empty_discard_pile(self):
        """Feature encoding works with empty discard pile."""
        hand, gs = self._make_hand_and_state()
        gs['discard_pile'] = []
        features = encode_pbs(hand, gs)
        self.assertEqual(len(features), FEATURE_DIM)


class TestBaselinePredictor(unittest.TestCase):
    """Test the handcrafted baseline predictor."""

    def test_output_shape(self):
        """Single sample prediction returns scalar array."""
        hand, gs = TestPBSFeatures()._make_hand_and_state()
        features = encode_pbs(hand, gs)
        X = np.array([features], dtype=np.float32)

        baseline = BaselinePredictor()
        proba = baseline.predict_proba(X)
        self.assertEqual(proba.shape, (1,))

    def test_output_range(self):
        """Predictions are valid probabilities in [0, 1]."""
        baseline = BaselinePredictor()

        for seed in range(20):
            hand, gs = TestPBSFeatures()._make_hand_and_state(seed=seed)
            features = encode_pbs(hand, gs)
            X = np.array([features], dtype=np.float32)
            proba = baseline.predict_proba(X)
            self.assertGreaterEqual(proba[0], 0.0)
            self.assertLessEqual(proba[0], 1.0)

    def test_batch_prediction(self):
        """Batch prediction produces correct shape."""
        baseline = BaselinePredictor()
        X = np.random.randn(50, FEATURE_DIM).astype(np.float32)
        proba = baseline.predict_proba(X)
        self.assertEqual(proba.shape, (50,))

    def test_low_deadwood_higher_prob(self):
        """Lower deadwood should produce higher win probability."""
        baseline = BaselinePredictor()

        # Create feature vectors with different deadwood
        X_low = np.zeros((1, FEATURE_DIM), dtype=np.float32)
        X_low[0, 53] = 0.05  # Low normalized deadwood

        X_high = np.zeros((1, FEATURE_DIM), dtype=np.float32)
        X_high[0, 53] = 0.80  # High normalized deadwood

        p_low = baseline.predict_proba(X_low)[0]
        p_high = baseline.predict_proba(X_high)[0]
        self.assertGreater(p_low, p_high)


class TestModelSaveLoad(unittest.TestCase):
    """Test model save/load functionality."""

    def test_save_load_roundtrip(self):
        """Model produces same predictions after save/load."""
        # Create small training set
        rng = random.Random(42)
        X_train = np.random.RandomState(42).randn(200, FEATURE_DIM).astype(np.float32)
        y_train = (np.random.RandomState(42).rand(200) > 0.5).astype(np.float32)

        # Train
        model = train_value_model(X_train, y_train, hidden_layers=(16, 8),
                                   max_iter=50, random_state=42)

        # Predict before save
        X_test = np.random.RandomState(99).randn(10, FEATURE_DIM).astype(np.float32)
        proba_before = model.predict_proba(X_test)

        # Save and reload
        with tempfile.NamedTemporaryFile(suffix='.pkl', delete=False) as f:
            tmp_path = f.name

        try:
            model.save(tmp_path)
            loaded = LearnedValueModel.load(tmp_path)
            proba_after = loaded.predict_proba(X_test)

            np.testing.assert_array_almost_equal(proba_before, proba_after, decimal=6)
        finally:
            os.unlink(tmp_path)


class TestDatasetSchema(unittest.TestCase):
    """Test that generated datasets have correct schema."""

    def test_small_generation(self):
        """Generate a small dataset and verify schema."""
        from tools.generate_value_data import generate_dataset

        X, y, metadata = generate_dataset(n_games=5, target_score=100, seed=42)

        # Check shapes
        self.assertEqual(X.ndim, 2)
        self.assertEqual(X.shape[1], FEATURE_DIM)
        self.assertEqual(y.ndim, 1)
        self.assertEqual(X.shape[0], y.shape[0])

        # Check types
        self.assertEqual(X.dtype, np.float32)
        self.assertEqual(y.dtype, np.float32)

        # Check labels are binary
        unique_labels = set(np.unique(y))
        self.assertTrue(unique_labels.issubset({0.0, 1.0}))

        # Check metadata
        self.assertEqual(metadata['n_games'], 5)
        self.assertEqual(metadata['feature_dim'], FEATURE_DIM)
        self.assertGreater(metadata['total_samples'], 0)

    def test_positive_rate_reasonable(self):
        """Positive rate should be near 0.5 (symmetric self-play)."""
        from tools.generate_value_data import generate_dataset

        X, y, metadata = generate_dataset(n_games=20, target_score=100, seed=123)

        pos_rate = y.mean()
        # Should be roughly balanced (0.3 to 0.7 for 20 games)
        self.assertGreater(pos_rate, 0.2)
        self.assertLess(pos_rate, 0.8)


class TestEvaluationPipeline(unittest.TestCase):
    """Test the baseline-vs-model evaluation pipeline."""

    def test_pipeline_runs(self):
        """Full pipeline from data → train → evaluate runs without error."""
        from tools.generate_value_data import generate_dataset

        # Generate small dataset
        X, y, _ = generate_dataset(n_games=10, target_score=100, seed=42)

        if len(y) < 20:
            self.skipTest("Too few samples for pipeline test")

        # Split
        from sklearn.model_selection import train_test_split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.3, random_state=42
        )

        # Baseline
        baseline = BaselinePredictor()
        baseline_proba = baseline.predict_proba(X_test)

        # Train model
        model = train_value_model(X_train, y_train, hidden_layers=(16, 8),
                                   max_iter=50, random_state=42)
        learned_proba = model.predict_proba(X_test)

        # Both produce valid probabilities
        self.assertTrue(np.all(baseline_proba >= 0))
        self.assertTrue(np.all(baseline_proba <= 1))
        self.assertTrue(np.all(learned_proba >= 0))
        self.assertTrue(np.all(learned_proba <= 1))

        # Brier scores are finite
        from sklearn.metrics import brier_score_loss
        b_brier = brier_score_loss(y_test, baseline_proba)
        l_brier = brier_score_loss(y_test, learned_proba)
        self.assertTrue(np.isfinite(b_brier))
        self.assertTrue(np.isfinite(l_brier))


class TestApexValueGameplay(unittest.TestCase):
    """Test ApexValue gameplay legality and completion."""

    def test_game_completes(self):
        """ApexValue can complete a full game without errors."""
        from gin_rummy.apex_value import ApexValue
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        # ApexValue without a model file should fall back to ApexMCTS
        p0 = ApexValue("ApexValue", seed=42, model_path="/nonexistent/model.pkl")
        p1 = ApexMCTS("ApexMCTS", seed=43)

        random.seed(42)
        game = GinRummyGame(p0, p1, target_score=50, verbose=False)
        result = game.play_game()

        self.assertIsNotNone(result.winner)
        self.assertIn(result.winner, [0, 1])
        self.assertGreater(result.hands_played, 0)

    def test_game_completes_with_trained_model(self):
        """If model exists, ApexValue completes games with it."""
        model_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "models", "apex_value_model.pkl"
        )
        if not os.path.exists(model_path):
            self.skipTest("No trained model available")

        from gin_rummy.apex_value import ApexValue
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        p0 = ApexValue("ApexValue", seed=42, model_path=model_path)
        p1 = ApexMCTS("ApexMCTS", seed=43)

        random.seed(42)
        game = GinRummyGame(p0, p1, target_score=100, verbose=False)
        result = game.play_game()

        self.assertIsNotNone(result.winner)
        self.assertGreater(result.hands_played, 0)


if __name__ == "__main__":
    unittest.main()
