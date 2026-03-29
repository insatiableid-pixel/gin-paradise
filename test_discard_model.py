"""
Tests for the discard action model pipeline.

Covers:
  - Discard feature encoding (shape, determinism, validity)
  - Baseline model correctness
  - Model training and save/load
  - Grouped dataset integrity
  - ApexMCTSDiscard gameplay legality and completion
"""

import os
import sys
import unittest
import random
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gin_rummy.card import rank, suit, make_card, deadwood_value, make_deck, NUM_CARDS
from gin_rummy.meld import best_meld_arrangement, compute_deadwood, find_all_melds
from gin_rummy.discard_action_features import (
    encode_discard_candidate, get_discard_feature_names,
    DISCARD_FEATURE_DIM, encode_all_candidates
)
from gin_rummy.discard_action_model import (
    DeadwoodDiscardBaseline, ApexHeuristicDiscardBaseline,
    LearnedDiscardModel, train_discard_model
)
from gin_rummy.opponent_model import OpponentModel


def _make_test_hand_11():
    """Create a deterministic 11-card test hand."""
    random.seed(42)
    deck = list(range(NUM_CARDS))
    random.shuffle(deck)
    return deck[:11]


def _make_test_game_state():
    return {
        'turn_number': 5,
        'my_score': 30,
        'opp_score': 25,
        'deck_remaining': 20,
        'discard_pile': [10, 15, 22],
    }


class TestDiscardFeatures(unittest.TestCase):
    """Test discard feature encoding."""

    def test_feature_shape(self):
        """Feature encoding produces correct shape."""
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        candidate = hand[0]
        features = encode_discard_candidate(hand, candidate, False, None, gs)
        self.assertEqual(len(features), DISCARD_FEATURE_DIM)

    def test_feature_determinism(self):
        """Same inputs produce same features."""
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        candidate = hand[0]
        f1 = encode_discard_candidate(hand, candidate, False, None, gs)
        f2 = encode_discard_candidate(hand, candidate, False, None, gs)
        self.assertEqual(f1, f2)

    def test_feature_names_match_dim(self):
        """Feature names list matches feature dimension."""
        names = get_discard_feature_names()
        self.assertEqual(len(names), DISCARD_FEATURE_DIM)

    def test_features_are_valid_floats(self):
        """All features are valid floats (no NaN, no inf)."""
        import math
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        for c in hand:
            features = encode_discard_candidate(hand, c, False, None, gs)
            for i, f in enumerate(features):
                self.assertFalse(math.isnan(f), f"Feature {i} is NaN")
                self.assertFalse(math.isinf(f), f"Feature {i} is inf")

    def test_features_reasonable_range(self):
        """Features are in reasonable ranges."""
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        candidate = hand[0]
        features = encode_discard_candidate(hand, candidate, False, None, gs)
        for i, f in enumerate(features):
            self.assertGreaterEqual(f, -5.0, f"Feature {i} too low: {f}")
            self.assertLessEqual(f, 5.0, f"Feature {i} too high: {f}")

    def test_different_candidates_different_features(self):
        """Different discard candidates produce different features."""
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        f0 = encode_discard_candidate(hand, hand[0], False, None, gs)
        f1 = encode_discard_candidate(hand, hand[-1], False, None, gs)
        self.assertNotEqual(f0, f1)

    def test_with_opponent_model(self):
        """Features encode correctly with opponent model."""
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        model = OpponentModel()
        model.reset(hand[:10])  # 10-card subset as "my hand"
        features = encode_discard_candidate(hand, hand[0], False, None, gs, model)
        self.assertEqual(len(features), DISCARD_FEATURE_DIM)

    def test_without_opponent_model(self):
        """Features work without opponent model."""
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        features = encode_discard_candidate(hand, hand[0], False, None, gs, None)
        self.assertEqual(len(features), DISCARD_FEATURE_DIM)

    def test_drew_from_discard_flag(self):
        """Drew-from-discard context changes features."""
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        drawn = hand[-1]
        f_stock = encode_discard_candidate(hand, hand[0], False, None, gs)
        f_disc = encode_discard_candidate(hand, hand[0], True, drawn, gs)
        # The drew_from_discard feature should differ
        self.assertNotEqual(f_stock, f_disc)

    def test_encode_all_candidates(self):
        """encode_all_candidates returns valid candidate list and features."""
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        candidates, features = encode_all_candidates(hand, False, None, gs)
        self.assertGreater(len(candidates), 0)
        self.assertEqual(len(candidates), len(features))
        for f in features:
            self.assertEqual(len(f), DISCARD_FEATURE_DIM)


class TestDiscardBaselines(unittest.TestCase):
    """Test discard baseline models."""

    def test_deadwood_baseline_shape(self):
        """Deadwood baseline produces correct output shape."""
        import numpy as np
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        candidates, features = encode_all_candidates(hand, False, None, gs)
        X = np.array(features, dtype=np.float32)
        baseline = DeadwoodDiscardBaseline()
        scores = baseline.score_candidates(X)
        self.assertEqual(len(scores), len(candidates))

    def test_deadwood_baseline_ranks(self):
        """Deadwood baseline ranking is consistent."""
        import numpy as np
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        candidates, features = encode_all_candidates(hand, False, None, gs)
        X = np.array(features, dtype=np.float32)
        baseline = DeadwoodDiscardBaseline()
        ranking = baseline.rank_candidates(X)
        self.assertEqual(len(ranking), len(candidates))

    def test_apex_baseline_shape(self):
        """Apex heuristic baseline produces correct output shape."""
        import numpy as np
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        candidates, features = encode_all_candidates(hand, False, None, gs)
        X = np.array(features, dtype=np.float32)
        baseline = ApexHeuristicDiscardBaseline()
        scores = baseline.score_candidates(X)
        self.assertEqual(len(scores), len(candidates))

    def test_melded_card_penalized(self):
        """Cards in melds should score lower (not good to discard)."""
        import numpy as np
        # Create hand with a clear meld: Ace of clubs, Ace of diamonds, Ace of spades
        hand = [
            make_card(0, 0), make_card(0, 1), make_card(0, 2),  # Ace set
            make_card(5, 3), make_card(7, 1), make_card(9, 0),
            make_card(10, 2), make_card(11, 3), make_card(12, 0),
            make_card(3, 1), make_card(6, 2),
        ]
        gs = _make_test_game_state()
        baseline = ApexHeuristicDiscardBaseline()

        # Melded card should score lower than a high-DW non-melded card
        feat_melded = encode_discard_candidate(hand, hand[0], False, None, gs)
        feat_high_dw = encode_discard_candidate(hand, hand[-3], False, None, gs)  # Jack

        X = np.array([feat_melded, feat_high_dw], dtype=np.float32)
        scores = baseline.score_candidates(X)
        # The high-DW non-melded card should score higher (better to discard)
        self.assertGreater(scores[1], scores[0])


class TestDiscardModelTraining(unittest.TestCase):
    """Test model training and save/load."""

    def test_train_small_dataset(self):
        """Train on small synthetic dataset without errors."""
        import numpy as np
        rng = np.random.RandomState(42)
        X = rng.randn(200, DISCARD_FEATURE_DIM).astype(np.float32)
        y = (rng.rand(200) > 0.5).astype(np.float32)

        model = train_discard_model(X, y, hidden_layers=(16, 8), max_iter=50)
        scores = model.score_candidates(X)
        self.assertEqual(len(scores), 200)

    def test_save_load_roundtrip(self):
        """Save/load preserves model predictions."""
        import numpy as np
        rng = np.random.RandomState(42)
        X = rng.randn(200, DISCARD_FEATURE_DIM).astype(np.float32)
        y = (rng.rand(200) > 0.5).astype(np.float32)

        model = train_discard_model(X, y, hidden_layers=(16, 8), max_iter=50)
        scores_before = model.score_candidates(X[:5])

        with tempfile.NamedTemporaryFile(suffix='.pkl', delete=False) as f:
            tmppath = f.name
        try:
            model.save(tmppath)
            loaded = LearnedDiscardModel.load(tmppath)
            scores_after = loaded.score_candidates(X[:5])
            np.testing.assert_array_almost_equal(scores_before, scores_after)
        finally:
            os.unlink(tmppath)

    def test_predict_best(self):
        """predict_best returns valid index."""
        import numpy as np
        rng = np.random.RandomState(42)
        X = rng.randn(200, DISCARD_FEATURE_DIM).astype(np.float32)
        y = (rng.rand(200) > 0.5).astype(np.float32)

        model = train_discard_model(X, y, hidden_layers=(16, 8), max_iter=50)
        best_idx = model.predict_best(X)
        self.assertGreaterEqual(best_idx, 0)
        self.assertLess(best_idx, 200)

    def test_score_single(self):
        """score_single returns valid float."""
        import numpy as np
        rng = np.random.RandomState(42)
        X = rng.randn(200, DISCARD_FEATURE_DIM).astype(np.float32)
        y = (rng.rand(200) > 0.5).astype(np.float32)

        model = train_discard_model(X, y, hidden_layers=(16, 8), max_iter=50)
        score = model.score_single(X[0].tolist())
        self.assertIsInstance(score, float)
        self.assertGreaterEqual(score, 0.0)
        self.assertLessEqual(score, 1.0)


class TestGroupedDatasetIntegrity(unittest.TestCase):
    """Test grouped dataset structure."""

    def test_candidates_are_unique_in_group(self):
        """All candidates in a single group should be distinct cards."""
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        candidates, features = encode_all_candidates(hand, False, None, gs)
        self.assertEqual(len(candidates), len(set(candidates)))

    def test_restricted_card_excluded(self):
        """Restricted card (drew from discard) should not appear as candidate."""
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        drawn = hand[-1]
        candidates, features = encode_all_candidates(hand, True, drawn, gs)
        melds, _, _ = best_meld_arrangement(hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)
        # Restricted card should not be a candidate (unless it's the only option)
        non_melded_non_restricted = [c for c in hand if c not in melded and c != drawn]
        if non_melded_non_restricted:
            self.assertNotIn(drawn, candidates)

    def test_feature_encoding_consistency(self):
        """Feature encoding for same candidate is consistent across calls."""
        hand = _make_test_hand_11()
        gs = _make_test_game_state()
        c0 = hand[0]
        f1 = encode_discard_candidate(hand, c0, False, None, gs)
        f2 = encode_discard_candidate(hand, c0, False, None, gs)
        self.assertEqual(f1, f2)


class TestApexMCTSDiscard(unittest.TestCase):
    """Test ApexMCTSDiscard gameplay."""

    def test_gameplay_completion(self):
        """ApexMCTSDiscard completes games without errors."""
        from gin_rummy.apex_mcts_discard import ApexMCTSDiscard
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        random.seed(42)
        p0 = ApexMCTSDiscard("TestDiscard", seed=42)
        p1 = ApexMCTS("TestMCTS", seed=43)

        game = GinRummyGame(p0, p1, target_score=50, verbose=False)
        result = game.play_game()

        self.assertIn(result.winner, [0, 1])
        self.assertGreater(result.hands_played, 0)

    def test_no_illegal_behavior(self):
        """ApexMCTSDiscard plays legally across multiple seeds."""
        from gin_rummy.apex_mcts_discard import ApexMCTSDiscard
        from gin_rummy.apex import Apex
        from gin_rummy.game import GinRummyGame

        for seed in range(5):
            random.seed(seed)
            p0 = ApexMCTSDiscard("TestDiscard", seed=seed)
            p1 = Apex("TestApex")

            game = GinRummyGame(p0, p1, target_score=50, verbose=False)
            result = game.play_game()

            self.assertIn(result.winner, [0, 1])

    def test_fallback_without_model(self):
        """ApexMCTSDiscard falls back gracefully without model file."""
        from gin_rummy.apex_mcts_discard import ApexMCTSDiscard
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        random.seed(42)
        p0 = ApexMCTSDiscard("TestDiscard", seed=42,
                              model_path="/nonexistent/model.pkl")
        p1 = ApexMCTS("TestMCTS", seed=43)

        game = GinRummyGame(p0, p1, target_score=50, verbose=False)
        result = game.play_game()

        self.assertIn(result.winner, [0, 1])
        # All discards should have been fallback
        self.assertEqual(p0._model_discard_count, 0)
        self.assertGreater(p0._fallback_discard_count, 0)

    def test_search_stats(self):
        """Search stats are valid."""
        from gin_rummy.apex_mcts_discard import ApexMCTSDiscard
        from gin_rummy.apex_mcts import ApexMCTS
        from gin_rummy.game import GinRummyGame

        random.seed(42)
        p0 = ApexMCTSDiscard("TestDiscard", seed=42)
        p1 = ApexMCTS("TestMCTS", seed=43)

        game = GinRummyGame(p0, p1, target_score=50, verbose=False)
        game.play_game()

        stats = p0.get_search_stats()
        self.assertIn('model_discards', stats)
        self.assertIn('fallback_discards', stats)
        self.assertIn('model_discard_pct', stats)


if __name__ == '__main__':
    unittest.main()
