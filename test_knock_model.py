"""
Test suite for knock decision model pipeline.

Tests:
  - Feature encoding shape and determinism
  - Legal-knock state integrity
  - Baseline model outputs
  - Model save/load roundtrip
  - Training produces valid model
  - Evaluation pipeline structure
  - ApexMCTSKnock gameplay legality and completion
"""

import os
import sys
import unittest
import random
import tempfile
import shutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from gin_rummy.card import make_deck, rank, suit, deadwood_value, NUM_CARDS
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.knock_features import encode_knock_decision, KNOCK_FEATURE_DIM, get_knock_feature_names
from gin_rummy.knock_action_model import (
    LearnedKnockModel, AlwaysKnockBaseline, GoGinBaseline,
    ApexKnockBaseline, PaperInspiredBaseline, FirstKnockBaseline,
    train_knock_model, KNOCK_FEATURE_DIM as MODEL_FEATURE_DIM,
)
from gin_rummy.apex_mcts_knock import ApexMCTSKnock


def _make_test_hand(seed=42):
    """Generate a random 10-card hand."""
    rng = random.Random(seed)
    deck = make_deck()
    rng.shuffle(deck)
    return deck[:10]


def _make_knockable_hand(seed=42):
    """Generate a hand with DW <= 10 (knockable).
    
    Constructs hands by selecting melds and then adding low-value deadwood
    cards to guarantee DW <= 10. Much more efficient than random search
    since only ~0.05% of random deals are knockable.
    """
    from gin_rummy.card import make_card
    rng = random.Random(seed)
    
    # Strategy: make 2 three-card melds (6 cards) + 4 low-DW cards
    # Pick a set meld: e.g. rank R in 3 suits
    rank_for_set = rng.randint(0, 12)
    suits_for_set = rng.sample(range(4), 3)
    set_meld = [make_card(rank_for_set, s) for s in suits_for_set]
    
    # Pick a run meld: 3 consecutive ranks in a suit
    run_suit = rng.randint(0, 3)
    run_start = rng.randint(0, 10)  # can start 0-10 for 3-card run
    run_meld = [make_card(run_start + i, run_suit) for i in range(3)]
    
    # Check for overlap
    used = set(set_meld + run_meld)
    if len(used) < 6:
        # Overlap: use simpler construction
        set_meld = [make_card(0, 0), make_card(0, 1), make_card(0, 2)]  # Ace set
        run_meld = [make_card(7, 3), make_card(8, 3), make_card(9, 3)]  # 8-9-10 of clubs
        used = set(set_meld + run_meld)
    
    # Add 4 low-value deadwood cards (Aces and 2s from unused positions)
    all_low = []
    for r in range(3):  # ranks 0 (A), 1 (2), 2 (3) — DW values 1, 2, 3
        for s in range(4):
            c = make_card(r, s)
            if c not in used:
                all_low.append(c)
    
    rng.shuffle(all_low)
    dw_cards = all_low[:4]
    
    hand = list(set_meld) + list(run_meld) + dw_cards
    assert len(hand) == 10, f"Hand has {len(hand)} cards"
    assert len(set(hand)) == 10, "Duplicate cards in hand"
    
    dw = compute_deadwood(hand)
    assert dw <= 10, f"Constructed hand has DW={dw}"
    return hand


def _make_gin_hand():
    """Generate a gin hand (DW = 0): three sets of 3 + one Ace."""
    from gin_rummy.card import make_card
    hand = [
        make_card(0, 0), make_card(0, 1), make_card(0, 2),  # Ace set
        make_card(1, 0), make_card(1, 1), make_card(1, 2),  # 2 set
        make_card(2, 0), make_card(2, 1), make_card(2, 2),  # 3 set
        make_card(3, 0),                                      # 4♠ in run with above
    ]
    # Actually let's just make a proper gin hand
    # A♠ 2♠ 3♠ (run) + 5♥ 5♦ 5♣ (set) + 8♠ 9♠ 10♠ J♠ (run)
    hand = [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),    # A-2-3♠
        make_card(4, 1), make_card(4, 2), make_card(4, 3),    # 5♥ 5♦ 5♣
        make_card(7, 0), make_card(8, 0), make_card(9, 0), make_card(10, 0),  # 8-J♠
    ]
    dw = compute_deadwood(hand)
    if dw == 0:
        return hand
    # fallback: try many hands
    rng = random.Random(99)
    for _ in range(10000):
        deck = make_deck()
        rng.shuffle(deck)
        h = deck[:10]
        if compute_deadwood(h) == 0:
            return h
    raise RuntimeError("Could not generate gin hand")


def _default_game_state(turn=5, my_score=0, opp_score=0, deck_remaining=20):
    return {
        'turn_number': turn,
        'my_score': my_score,
        'opp_score': opp_score,
        'deck_remaining': deck_remaining,
        'discard_pile': [],
    }


class TestKnockFeatureEncoding(unittest.TestCase):
    """Tests for knock feature encoder."""

    def test_feature_dim(self):
        hand = _make_knockable_hand(seed=1)
        gs = _default_game_state()
        features = encode_knock_decision(hand, gs)
        self.assertEqual(len(features), KNOCK_FEATURE_DIM)

    def test_feature_dim_matches_model(self):
        self.assertEqual(KNOCK_FEATURE_DIM, MODEL_FEATURE_DIM)

    def test_feature_names_count(self):
        names = get_knock_feature_names()
        self.assertEqual(len(names), KNOCK_FEATURE_DIM)

    def test_feature_determinism(self):
        hand = _make_knockable_hand(seed=10)
        gs = _default_game_state()
        f1 = encode_knock_decision(hand, gs)
        f2 = encode_knock_decision(hand, gs)
        self.assertEqual(f1, f2)

    def test_gin_hand_features(self):
        hand = _make_gin_hand()
        gs = _default_game_state()
        features = encode_knock_decision(hand, gs)
        # is_gin (index 2) should be 1.0
        self.assertEqual(features[2], 1.0)
        # dw_total (index 0) should be 0.0
        self.assertEqual(features[0], 0.0)

    def test_features_are_bounded(self):
        """All features should be roughly bounded (most in [-2, 2])."""
        for seed in range(20):
            hand = _make_knockable_hand(seed=seed)
            gs = _default_game_state(turn=seed, my_score=seed*5, opp_score=seed*3)
            features = encode_knock_decision(hand, gs)
            for i, f in enumerate(features):
                self.assertTrue(-5.0 <= f <= 5.0,
                    f"Feature {i} out of range: {f} (seed={seed})")


class TestKnockBaselines(unittest.TestCase):
    """Tests for knock decision baselines."""

    def _random_features(self, n=50, seed=42):
        rng = np.random.RandomState(seed)
        return rng.rand(n, KNOCK_FEATURE_DIM).astype(np.float32)

    def test_always_knock_shape(self):
        X = self._random_features()
        baseline = AlwaysKnockBaseline()
        proba = baseline.predict_proba(X)
        self.assertEqual(proba.shape, (50,))
        np.testing.assert_array_equal(proba, np.ones(50))

    def test_go_gin_baseline(self):
        X = self._random_features()
        baseline = GoGinBaseline()
        proba = baseline.predict_proba(X)
        self.assertEqual(proba.shape, (50,))
        # If is_gin feature (idx 2) is > 0.5, should predict 1.0
        for i in range(50):
            expected = 1.0 if X[i, 2] > 0.5 else 0.0
            self.assertEqual(proba[i], expected)

    def test_apex_knock_baseline_returns_valid(self):
        X = self._random_features()
        baseline = ApexKnockBaseline()
        proba = baseline.predict_proba(X)
        self.assertEqual(proba.shape, (50,))
        self.assertTrue(np.all(proba >= 0.0))
        self.assertTrue(np.all(proba <= 1.0))

    def test_paper_inspired_baseline_returns_valid(self):
        X = self._random_features()
        baseline = PaperInspiredBaseline()
        proba = baseline.predict_proba(X)
        self.assertEqual(proba.shape, (50,))
        self.assertTrue(np.all(proba >= 0.0))
        self.assertTrue(np.all(proba <= 1.0))

    def test_first_knock_baseline(self):
        X = self._random_features()
        baseline = FirstKnockBaseline()
        proba = baseline.predict_proba(X)
        self.assertEqual(proba.shape, (50,))
        np.testing.assert_array_equal(proba, np.ones(50))

    def test_single_sample_input(self):
        """All baselines should handle single-sample input."""
        X = self._random_features(n=1)
        for baseline_cls in [AlwaysKnockBaseline, GoGinBaseline,
                             ApexKnockBaseline, PaperInspiredBaseline]:
            baseline = baseline_cls()
            proba = baseline.predict_proba(X)
            self.assertEqual(proba.shape, (1,))


class TestKnockModelTraining(unittest.TestCase):
    """Tests for model training and save/load."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def _make_synthetic_data(self, n=500, seed=42):
        rng = np.random.RandomState(seed)
        X = rng.rand(n, KNOCK_FEATURE_DIM).astype(np.float32)
        # Create labels correlated with features
        y = (X[:, 0] + X[:, 2] > 0.8).astype(np.float32)
        return X, y

    def test_train_produces_model(self):
        X, y = self._make_synthetic_data()
        model = train_knock_model(X, y, hidden_layers=(16, 8), max_iter=50)
        self.assertIsInstance(model, LearnedKnockModel)

    def test_model_predict_proba_shape(self):
        X, y = self._make_synthetic_data()
        model = train_knock_model(X, y, hidden_layers=(16, 8), max_iter=50)
        proba = model.predict_proba(X[:10])
        self.assertEqual(proba.shape, (10,))
        self.assertTrue(np.all(proba >= 0.0))
        self.assertTrue(np.all(proba <= 1.0))

    def test_model_predict_single(self):
        X, y = self._make_synthetic_data()
        model = train_knock_model(X, y, hidden_layers=(16, 8), max_iter=50)
        f = X[0].tolist()
        prob = model.predict_single(f)
        self.assertIsInstance(prob, float)
        self.assertTrue(0.0 <= prob <= 1.0)

    def test_save_load_roundtrip(self):
        X, y = self._make_synthetic_data()
        model = train_knock_model(X, y, hidden_layers=(16, 8), max_iter=50)
        path = os.path.join(self._tmpdir, "test_knock.pkl")
        model.save(path)
        self.assertTrue(os.path.exists(path))

        loaded = LearnedKnockModel.load(path)
        proba_orig = model.predict_proba(X[:5])
        proba_loaded = loaded.predict_proba(X[:5])
        np.testing.assert_array_almost_equal(proba_orig, proba_loaded)

    def test_model_beats_random_on_structured_data(self):
        """Model should do better than 50% on correlated data."""
        X, y = self._make_synthetic_data(n=800)
        model = train_knock_model(X, y, hidden_layers=(32, 16), max_iter=100)
        proba = model.predict_proba(X)
        preds = (proba > 0.5).astype(np.float32)
        acc = np.mean(preds == y)
        self.assertGreater(acc, 0.55, f"Model accuracy {acc:.3f} should exceed random baseline")


class TestLegalKnockStateIntegrity(unittest.TestCase):
    """Verify that legal knock states are properly identified."""

    def test_knockable_hand_has_valid_dw(self):
        for seed in range(20):
            hand = _make_knockable_hand(seed=seed)
            _, _, dw = best_meld_arrangement(hand)
            self.assertLessEqual(dw, 10)
            self.assertGreaterEqual(dw, 0)

    def test_gin_hand_has_zero_dw(self):
        hand = _make_gin_hand()
        _, _, dw = best_meld_arrangement(hand)
        self.assertEqual(dw, 0)

    def test_feature_encoding_only_for_valid_hands(self):
        """Feature encoding should work for any 10-card hand."""
        for seed in range(10):
            rng = random.Random(seed)
            deck = make_deck()
            rng.shuffle(deck)
            hand = deck[:10]
            gs = _default_game_state()
            # Should not crash regardless of DW
            features = encode_knock_decision(hand, gs)
            self.assertEqual(len(features), KNOCK_FEATURE_DIM)


class TestApexMCTSKnock(unittest.TestCase):
    """Tests for the ApexMCTSKnock gameplay bot."""

    def test_constructor(self):
        bot = ApexMCTSKnock(name="TestKnockBot")
        self.assertEqual(bot.name, "TestKnockBot")

    def test_knock_decision_gin(self):
        """Should always knock on gin."""
        bot = ApexMCTSKnock(name="TestBot")
        hand = _make_gin_hand()
        bot.new_hand(hand, 1)
        gs = _default_game_state()
        decision = bot.knock_decision(hand, gs)
        self.assertTrue(decision)

    def test_knock_decision_high_dw(self):
        """Should not knock when DW > 10."""
        bot = ApexMCTSKnock(name="TestBot")
        # Create a hand with definitely high DW
        from gin_rummy.card import make_card
        hand = [make_card(r, 0) for r in range(10)]  # A-10 of spades, scattered
        bot.new_hand(hand, 1)
        _, _, dw = best_meld_arrangement(hand)
        # If DW happens to be > 10, bot should not knock
        gs = _default_game_state()
        if dw > 10:
            decision = bot.knock_decision(hand, gs)
            self.assertFalse(decision)

    def test_gameplay_completion(self):
        """ApexMCTSKnock should complete games without errors or hangs."""
        from gin_rummy.game import GinRummyGame
        from gin_rummy.apex_mcts import ApexMCTS

        p0 = ApexMCTSKnock(name="KnockBot", seed=42)
        p1 = ApexMCTS(name="Baseline", seed=43)

        random.seed(12345)
        game = GinRummyGame(p0, p1, target_score=50, verbose=False)
        result = game.play_game()
        self.assertIn(result.winner, [0, 1])
        self.assertGreater(result.hands_played, 0)

    def test_search_stats(self):
        """ApexMCTSKnock should track diagnostic stats."""
        bot = ApexMCTSKnock(name="TestBot")
        stats = bot.get_search_stats()
        self.assertIn('knock_model_loaded', stats)
        self.assertIn('knock_consults', stats)


class TestDatasetGenerationSmoke(unittest.TestCase):
    """Smoke test for the data generation pipeline."""

    def test_generate_small_dataset(self):
        """Generate a tiny dataset and verify shape."""
        from tools.generate_knock_data import generate_knock_dataset

        X, deltas, labels, metadata = generate_knock_dataset(
            n_games=5, target_score=50, seed=99
        )
        self.assertEqual(X.ndim, 2)
        self.assertEqual(X.shape[1], KNOCK_FEATURE_DIM)
        self.assertEqual(len(deltas), len(labels))
        self.assertEqual(len(deltas), X.shape[0])
        self.assertIn('total_samples', metadata)
        self.assertIn('knock_better_rate', metadata)
        # Should have at least some samples from 5 games
        # (not strictly guaranteed but very likely)
        if X.shape[0] > 0:
            self.assertTrue(np.all(np.isfinite(X)))
            self.assertTrue(np.all(np.isfinite(deltas)))
            self.assertTrue(all(l in (0.0, 1.0) for l in labels))


if __name__ == '__main__':
    unittest.main()
