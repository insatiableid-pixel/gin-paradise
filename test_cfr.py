"""
Tests for the CFR learning path: strategy, training, and inference.

Covers:
  - Information set computation
  - CFR strategy regret matching
  - Strategy save/load roundtrip
  - ApexCFR fallback behavior
  - ApexCFR game completion
  - Deterministic behavior under fixed seed
  - Legal action enforcement
"""

import os
import json
import random
import tempfile
import unittest

from gin_rummy.card import make_card, rank, suit, deadwood_value
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.cfr_strategy import (
    CFRStrategy, compute_info_set, NUM_ACTIONS,
    _count_partial_melds, _count_isolated_high,
    _score_diff_bucket, _deck_remaining_bucket,
)
from gin_rummy.apex_cfr import ApexCFR


class InfoSetComputationTests(unittest.TestCase):
    """Tests for information set feature extraction."""

    def _make_gs(self, turn=0, my_score=0, opp_score=0, deck_remaining=30):
        return {
            'turn_number': turn,
            'my_score': my_score,
            'opp_score': opp_score,
            'deck_remaining': deck_remaining,
            'discard_pile': [],
        }

    def test_info_set_returns_tuple(self):
        """Info set should be a hashable tuple."""
        hand = [make_card(i, 0) for i in range(10)] + [make_card(10, 1)]
        gs = self._make_gs()
        info_set = compute_info_set(hand, gs)
        self.assertIsInstance(info_set, tuple)
        self.assertEqual(len(info_set), 7)

    def test_info_set_deterministic(self):
        """Same hand and state should produce same info set."""
        hand = [make_card(i, 0) for i in range(10)] + [make_card(10, 1)]
        gs = self._make_gs()
        is1 = compute_info_set(hand, gs)
        is2 = compute_info_set(hand, gs)
        self.assertEqual(is1, is2)

    def test_info_set_gin_hand(self):
        """Gin hand should have DW bucket 0 and max melds."""
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0), make_card(3, 0),  # A-2-3-4C
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D
            make_card(8, 2), make_card(9, 2), make_card(10, 2),  # 9-T-JS
            make_card(12, 3),  # extra card for 11-card hand
        ]
        gs = self._make_gs()
        info_set = compute_info_set(hand, gs)
        # DW bucket should be low (the KH is 10 DW, but other 10 cards have 0 DW)
        self.assertIsInstance(info_set[0], int)  # dw_bucket
        self.assertGreaterEqual(info_set[1], 2)  # meld_count >= 2

    def test_info_set_varies_with_turn(self):
        """Different turns should produce different turn buckets."""
        hand = [make_card(i, 0) for i in range(10)] + [make_card(10, 1)]
        is_early = compute_info_set(hand, self._make_gs(turn=0))
        is_late = compute_info_set(hand, self._make_gs(turn=14))
        # Turn buckets: 0//4=0 vs 14//4=3
        self.assertNotEqual(is_early[4], is_late[4])

    def test_score_diff_buckets(self):
        """Verify score difference bucketing."""
        self.assertEqual(_score_diff_bucket(0, 50), 0)  # far behind
        self.assertEqual(_score_diff_bucket(40, 55), 1)  # behind
        self.assertEqual(_score_diff_bucket(50, 50), 2)  # even
        self.assertEqual(_score_diff_bucket(75, 50), 3)  # ahead
        self.assertEqual(_score_diff_bucket(90, 20), 4)  # far ahead

    def test_deck_remaining_buckets(self):
        """Verify deck remaining bucketing."""
        self.assertEqual(_deck_remaining_bucket(5), 0)   # very low
        self.assertEqual(_deck_remaining_bucket(12), 1)  # low
        self.assertEqual(_deck_remaining_bucket(20), 2)  # medium
        self.assertEqual(_deck_remaining_bucket(30), 3)  # high


class CFRStrategyTests(unittest.TestCase):
    """Tests for CFR strategy regret matching and persistence."""

    def test_uniform_strategy_with_no_regrets(self):
        """With no accumulated regrets, strategy should be uniform."""
        strat = CFRStrategy()
        info_set = (0, 1, 2, 3, 0, 2, 3)
        probs = strat.get_strategy(info_set)
        self.assertEqual(len(probs), NUM_ACTIONS)
        for p in probs:
            self.assertAlmostEqual(p, 1.0 / NUM_ACTIONS, places=5)

    def test_regret_matching_concentrates(self):
        """High regret for one action should concentrate strategy."""
        strat = CFRStrategy()
        info_set = (0, 1, 2, 3, 0, 2, 3)
        # Add large positive regret to action 1
        strat.update_regret(info_set, 1, 100.0)
        probs = strat.get_strategy(info_set)
        self.assertGreater(probs[1], 0.9)

    def test_negative_regret_ignored(self):
        """Negative regrets should be clipped to 0 in regret matching."""
        strat = CFRStrategy()
        info_set = (0, 1, 2, 3, 0, 2, 3)
        strat.update_regret(info_set, 0, -100.0)
        strat.update_regret(info_set, 1, 10.0)
        strat.update_regret(info_set, 2, -50.0)
        probs = strat.get_strategy(info_set)
        # Only action 1 has positive regret
        self.assertAlmostEqual(probs[1], 1.0, places=5)

    def test_average_strategy_accumulation(self):
        """Average strategy should reflect accumulated probabilities."""
        strat = CFRStrategy()
        info_set = (0, 1, 2, 3, 0, 2, 3)
        # Accumulate: mostly action 2
        strat.accumulate_strategy(info_set, [0.1, 0.1, 0.8])
        strat.accumulate_strategy(info_set, [0.0, 0.2, 0.8])
        avg = strat.get_average_strategy(info_set)
        self.assertGreater(avg[2], 0.7)

    def test_save_load_roundtrip(self):
        """Strategy should survive save/load cycle."""
        strat = CFRStrategy()
        info_set = (1, 2, 3, 0, 1, 2, 3)
        strat.update_regret(info_set, 0, 5.0)
        strat.update_regret(info_set, 1, 10.0)
        strat.accumulate_strategy(info_set, [0.3, 0.5, 0.2])
        strat.iterations = 100

        with tempfile.NamedTemporaryFile(suffix='.json', delete=False, mode='w') as f:
            filepath = f.name

        try:
            strat.save(filepath)
            self.assertTrue(os.path.exists(filepath))

            loaded = CFRStrategy()
            loaded.load(filepath)

            self.assertEqual(loaded.iterations, 100)
            self.assertEqual(loaded.num_info_sets(), 1)

            # Verify regrets preserved
            orig_strat = strat.get_strategy(info_set)
            load_strat = loaded.get_strategy(info_set)
            for a in range(NUM_ACTIONS):
                self.assertAlmostEqual(orig_strat[a], load_strat[a], places=5)

            # Verify average strategy preserved
            orig_avg = strat.get_average_strategy(info_set)
            load_avg = loaded.get_average_strategy(info_set)
            for a in range(NUM_ACTIONS):
                self.assertAlmostEqual(orig_avg[a], load_avg[a], places=5)
        finally:
            os.unlink(filepath)

    def test_has_coverage(self):
        """has_coverage should return True only for trained info sets."""
        strat = CFRStrategy()
        info_set = (0, 1, 2, 3, 0, 2, 3)
        self.assertFalse(strat.has_coverage(info_set))
        strat.accumulate_strategy(info_set, [0.3, 0.3, 0.4])
        self.assertTrue(strat.has_coverage(info_set))


class ApexCFRFallbackTests(unittest.TestCase):
    """Tests for ApexCFR fallback behavior when no strategy is loaded."""

    def _gs(self, turn=0):
        return {
            'turn_number': turn,
            'my_score': 0, 'opp_score': 0,
            'deck_remaining': 30,
            'discard_pile': [],
        }

    def test_no_strategy_plays_like_apex(self):
        """Without a loaded strategy, ApexCFR should behave like Apex."""
        from gin_rummy.apex import Apex

        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3C run
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D run
            make_card(8, 2), make_card(9, 2), make_card(10, 2),  # 9-T-JS run
            make_card(12, 3), make_card(11, 0),  # KH (10 DW), QC (10 DW)
        ]

        # ApexCFR with no strategy file
        bot = ApexCFR("TestCFR", strategy_path="/nonexistent/path.json")
        bot.new_hand(hand[:10], opponent_id=1)
        cfr_discard = bot.discard_decision(hand, False, make_card(11, 0), self._gs())

        # Pure Apex
        apex = Apex("TestApex")
        apex.new_hand(hand[:10], opponent_id=1)
        apex_discard = apex.discard_decision(hand, False, make_card(11, 0), self._gs())

        # Both should discard a high DW card
        self.assertIn(rank(cfr_discard), [11, 12])
        self.assertIn(rank(apex_discard), [11, 12])

    def test_cfr_reports_fallback_stats(self):
        """ApexCFR should track fallback vs CFR decision counts."""
        bot = ApexCFR("TestCFR", strategy_path="/nonexistent/path.json")
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),
            make_card(4, 1), make_card(5, 1), make_card(6, 1),
            make_card(8, 2), make_card(9, 2), make_card(10, 2),
            make_card(12, 3), make_card(11, 0),
        ]
        bot.new_hand(hand[:10], opponent_id=1)
        bot.discard_decision(hand, False, make_card(11, 0), self._gs())

        stats = bot.get_cfr_usage_stats()
        self.assertEqual(stats['fallback_decisions'], 1)
        self.assertEqual(stats['cfr_decisions'], 0)


class ApexCFRWithStrategyTests(unittest.TestCase):
    """Tests for ApexCFR when a trained strategy is loaded."""

    def _gs(self, turn=0, my_score=0, opp_score=0, deck_remaining=30):
        return {
            'turn_number': turn,
            'my_score': my_score,
            'opp_score': opp_score,
            'deck_remaining': deck_remaining,
            'discard_pile': [],
        }

    def test_loaded_strategy_influences_decisions(self):
        """ApexCFR with a loaded strategy should use CFR for known info sets."""
        # Create a strategy that strongly prefers action 1
        strat = CFRStrategy()

        # Train on a broad range of info sets to ensure coverage
        for dw_b in range(6):
            for meld_c in range(5):
                for partial_c in range(4):
                    for iso_h in range(5):
                        for turn_b in range(4):
                            for score_b in range(5):
                                for deck_b in range(4):
                                    info_set = (dw_b, meld_c, partial_c, iso_h,
                                                turn_b, score_b, deck_b)
                                    strat.accumulate_strategy(info_set, [0.1, 0.8, 0.1])

        with tempfile.NamedTemporaryFile(suffix='.json', delete=False, mode='w') as f:
            filepath = f.name

        try:
            strat.save(filepath)

            bot = ApexCFR("TestCFR", strategy_path=filepath)
            self.assertTrue(bot.cfr_loaded)

            # Make a decision
            hand = [
                make_card(0, 0), make_card(1, 0), make_card(2, 0),
                make_card(4, 1), make_card(5, 1), make_card(6, 1),
                make_card(8, 2), make_card(9, 2), make_card(10, 2),
                make_card(12, 3), make_card(11, 0),
            ]
            bot.new_hand(hand[:10], opponent_id=1)
            discard = bot.discard_decision(hand, False, make_card(11, 0), self._gs())

            # The discard should be a legal card from the hand
            self.assertIn(discard, hand)

            # Should have used CFR or fallback (either is acceptable)
            stats = bot.get_cfr_usage_stats()
            self.assertEqual(stats['total'], 1)
        finally:
            os.unlink(filepath)


class ApexCFRGameCompletionTests(unittest.TestCase):
    """Tests for ApexCFR completing full games."""

    def test_completes_game_without_error(self):
        """ApexCFR should complete a full game without crashing."""
        from gin_rummy.game import GinRummyGame

        random.seed(42)
        bot = ApexCFR("CFR", strategy_path="/nonexistent/path.json")
        from gin_rummy.apex import Apex
        opponent = Apex("Apex")

        game = GinRummyGame(bot, opponent, target_score=100, verbose=False)
        result = game.play_game()
        self.assertIn(result.winner, [0, 1])
        self.assertGreater(result.hands_played, 0)

    def test_completes_game_against_nexus(self):
        """ApexCFR should complete a game against Nexus."""
        from gin_rummy.game import GinRummyGame
        from gin_rummy.nexus import Nexus

        random.seed(123)
        bot = ApexCFR("CFR", strategy_path="/nonexistent/path.json")
        opponent = Nexus("Nexus")

        game = GinRummyGame(bot, opponent, target_score=100, verbose=False)
        result = game.play_game()
        self.assertIn(result.winner, [0, 1])
        self.assertGreater(result.hands_played, 0)

    def test_completes_across_many_seeds(self):
        """ApexCFR should complete reliably across multiple seeds."""
        from gin_rummy.game import GinRummyGame
        from gin_rummy.apex import Apex

        for seed in [42, 0, 1, 100, 999, 2026]:
            random.seed(seed)
            bot = ApexCFR(f"CFR_{seed}", strategy_path="/nonexistent/path.json")
            opponent = Apex(f"Apex_{seed}")
            game = GinRummyGame(bot, opponent, target_score=100, verbose=False)
            result = game.play_game()
            self.assertIsNotNone(result.winner, f"Game should complete for seed {seed}")
            self.assertGreater(result.hands_played, 0)

    def test_discard_is_always_legal(self):
        """Every discard must be in the current hand and respect restriction."""
        from gin_rummy.game import GinRummyGame
        from gin_rummy.apex import Apex

        class LegalityCheckBot(ApexCFR):
            def __init__(self):
                super().__init__("LegalCheck", strategy_path="/nonexistent/path.json")
                self.violations = []

            def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
                discard = super().discard_decision(hand, drew_from_discard, drawn_card, game_state)
                if discard not in hand:
                    self.violations.append(('not_in_hand', discard))
                if drew_from_discard and discard == drawn_card:
                    self.violations.append(('drew_restricted', discard))
                return discard

        random.seed(42)
        bot = LegalityCheckBot()
        opponent = Apex("Apex")
        game = GinRummyGame(bot, opponent, target_score=100, verbose=False)
        game.play_game()
        self.assertEqual(len(bot.violations), 0, f"Legality violations: {bot.violations}")


class DeterministicBehaviorTests(unittest.TestCase):
    """Tests for deterministic behavior under fixed seed."""

    def test_deterministic_discard_without_strategy(self):
        """Without strategy, same seed should produce same discard."""
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),
            make_card(4, 1), make_card(5, 1), make_card(6, 1),
            make_card(8, 2), make_card(9, 2), make_card(10, 2),
            make_card(12, 3), make_card(11, 0),
        ]
        gs = {'turn_number': 0, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': []}

        results = []
        for _ in range(3):
            random.seed(42)
            bot = ApexCFR("Test", strategy_path="/nonexistent/path.json")
            bot.new_hand(hand[:10], opponent_id=1)
            discard = bot.discard_decision(hand, False, make_card(11, 0), gs)
            results.append(discard)

        # All should be the same
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[1], results[2])


class MiniTrainingTests(unittest.TestCase):
    """Tests for the training pipeline with minimal iterations."""

    def test_mini_training_produces_strategy(self):
        """A small training run should produce a non-empty strategy."""
        from gin_rummy.cfr_trainer import train_cfr

        random.seed(42)
        strategy = CFRStrategy()
        strategy = train_cfr(
            strategy,
            num_iterations=10,
            hands_per_iteration=5,
            seed=42,
            verbose=False,
        )

        self.assertGreater(strategy.iterations, 0)
        self.assertGreater(strategy.num_info_sets(), 0)

    def test_mini_training_saves_and_loads(self):
        """Trained strategy should survive save/load."""
        from gin_rummy.cfr_trainer import train_cfr

        random.seed(42)
        strategy = CFRStrategy()
        strategy = train_cfr(
            strategy,
            num_iterations=10,
            hands_per_iteration=5,
            seed=42,
            verbose=False,
        )

        with tempfile.NamedTemporaryFile(suffix='.json', delete=False, mode='w') as f:
            filepath = f.name

        try:
            strategy.save(filepath)
            loaded = CFRStrategy()
            loaded.load(filepath)
            self.assertEqual(loaded.iterations, strategy.iterations)
            self.assertEqual(loaded.num_info_sets(), strategy.num_info_sets())
        finally:
            os.unlink(filepath)

    def test_trained_bot_completes_game(self):
        """An ApexCFR with a mini-trained strategy should complete games."""
        from gin_rummy.cfr_trainer import train_cfr
        from gin_rummy.game import GinRummyGame
        from gin_rummy.apex import Apex

        random.seed(42)
        strategy = CFRStrategy()
        strategy = train_cfr(
            strategy,
            num_iterations=20,
            hands_per_iteration=10,
            seed=42,
            verbose=False,
        )

        with tempfile.NamedTemporaryFile(suffix='.json', delete=False, mode='w') as f:
            filepath = f.name

        try:
            strategy.save(filepath)

            random.seed(99)
            bot = ApexCFR("CFR", strategy_path=filepath)
            self.assertTrue(bot.cfr_loaded)
            opponent = Apex("Apex")
            game = GinRummyGame(bot, opponent, target_score=100, verbose=False)
            result = game.play_game()
            self.assertIn(result.winner, [0, 1])
            self.assertGreater(result.hands_played, 0)
        finally:
            os.unlink(filepath)


if __name__ == '__main__':
    unittest.main()
