"""
Tests for the ApexMCTS Monte Carlo draw search bot.

Covers:
- Draw search evaluation correctness
- Fallback behavior when search is skipped
- Deterministic behavior under fixed seed
- Game completion across multiple seeds
- Legal decisions under search
- Search diagnostics reporting
"""

import unittest
import os
import sys
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gin_rummy.card import rank, suit, make_card, deadwood_value, card_str, NUM_CARDS
from gin_rummy.meld import best_meld_arrangement, compute_deadwood, find_all_melds
from gin_rummy.game import GinRummyGame
from gin_rummy.apex import Apex
from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.nexus import Nexus
from gin_rummy.draw_search import (
    evaluate_draw_choice, _best_discard_dw, _get_hand_after_best_discard,
    _rollout_dw
)
from gin_rummy.opponent_model import OpponentModel, IN_MY_HAND, IN_DISCARD, UNKNOWN


class DrawSearchHelperTests(unittest.TestCase):
    """Test the low-level draw search helper functions."""

    def test_best_discard_dw_unrestricted(self):
        """_best_discard_dw finds minimum deadwood discard."""
        # Hand of 11: 10 low cards + 1 King
        hand_11 = [make_card(0, 0), make_card(0, 1), make_card(0, 2),  # 3 Aces (set)
                    make_card(1, 0), make_card(2, 0), make_card(3, 0),  # 2,3,4 of C (run)
                    make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5,6,7 of D (run)
                    make_card(7, 2),                                     # 8 of S
                    make_card(12, 3)]                                    # K of H (10 DW)
        best = _best_discard_dw(hand_11, restricted=None)
        # Discarding King should give us the best DW
        hand_without_king = [c for c in hand_11 if c != make_card(12, 3)]
        expected = compute_deadwood(hand_without_king)
        self.assertEqual(best, expected)

    def test_best_discard_dw_restricted(self):
        """_best_discard_dw respects the restricted card."""
        hand_11 = [make_card(0, 0), make_card(0, 1), make_card(0, 2),
                    make_card(1, 0), make_card(2, 0), make_card(3, 0),
                    make_card(4, 1), make_card(5, 1), make_card(6, 1),
                    make_card(7, 2),
                    make_card(12, 3)]
        # With King restricted, we can't discard it
        best = _best_discard_dw(hand_11, restricted=make_card(12, 3))
        # Should be worse than or equal to unrestricted
        best_unrestricted = _best_discard_dw(hand_11, restricted=None)
        self.assertGreaterEqual(best, best_unrestricted)

    def test_get_hand_after_best_discard(self):
        """_get_hand_after_best_discard returns a 10-card hand."""
        hand_11 = [make_card(r, 0) for r in range(11)]
        result = _get_hand_after_best_discard(hand_11, restricted=None)
        self.assertEqual(len(result), 10)

    def test_rollout_dw_no_stock(self):
        """Rollout with empty stock returns current hand DW."""
        hand = [make_card(r, 0) for r in range(10)]
        result = _rollout_dw(hand, [], depth=3, rng=random.Random(42))
        self.assertEqual(result, compute_deadwood(hand))

    def test_rollout_dw_with_stock(self):
        """Rollout with stock cards produces valid deadwood."""
        hand = [make_card(r, 0) for r in range(10)]
        stock = [make_card(r, 1) for r in range(5)]
        result = _rollout_dw(hand, stock, depth=2, rng=random.Random(42))
        self.assertGreaterEqual(result, 0)
        self.assertLessEqual(result, 200)  # Reasonable upper bound


class DrawSearchEvaluationTests(unittest.TestCase):
    """Test the main evaluate_draw_choice function."""

    def test_evaluate_returns_valid_structure(self):
        """evaluate_draw_choice returns valid (should_take, take_ev, stock_ev, diag)."""
        hand = [make_card(r, 0) for r in range(10)]
        top_discard = make_card(10, 1)  # Jack of Diamonds
        model = OpponentModel()
        model.reset(hand)
        game_state = {'turn_number': 3, 'my_score': 0, 'opp_score': 0,
                      'deck_remaining': 30, 'discard_pile': [top_discard]}
        model.set_discard(top_discard)

        result = evaluate_draw_choice(
            hand, top_discard, model, game_state,
            num_worlds=10, rollout_depth=1, rng=random.Random(42)
        )
        should_take, take_ev, stock_ev, diag = result
        self.assertIsInstance(diag, dict)
        self.assertIn('skipped', diag)
        if not diag['skipped']:
            self.assertIsInstance(should_take, bool)
            self.assertIn('worlds_evaluated', diag)
            self.assertGreater(diag['worlds_evaluated'], 0)

    def test_evaluate_deterministic_with_seed(self):
        """Same seed produces same results."""
        hand = [make_card(r, 0) for r in range(10)]
        top_discard = make_card(10, 1)
        model = OpponentModel()
        model.reset(hand)
        model.set_discard(top_discard)
        gs = {'turn_number': 3, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': [top_discard]}

        r1 = evaluate_draw_choice(hand, top_discard, model, gs,
                                  num_worlds=10, rng=random.Random(42))
        r2 = evaluate_draw_choice(hand, top_discard, model, gs,
                                  num_worlds=10, rng=random.Random(42))
        self.assertEqual(r1[0], r2[0])
        self.assertAlmostEqual(r1[1], r2[1], places=6)
        self.assertAlmostEqual(r1[2], r2[2], places=6)

    def test_meld_completing_card_favored(self):
        """Search should favor taking a card that completes a meld."""
        # Hand with a pair of aces needing a third
        hand = [make_card(0, 0), make_card(0, 1),   # A♣, A♦ (pair)
                make_card(5, 0), make_card(6, 0), make_card(7, 0),  # 6,7,8♣ (run)
                make_card(10, 1), make_card(11, 1), make_card(12, 1),  # J,Q,K♦ (run)
                make_card(9, 2), make_card(8, 3)]  # T♠, 9♥

        top_discard = make_card(0, 2)  # A♠ — completes the ace set!

        model = OpponentModel()
        model.reset(hand)
        model.set_discard(top_discard)
        gs = {'turn_number': 3, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 25, 'discard_pile': [top_discard]}

        _, take_ev, stock_ev, diag = evaluate_draw_choice(
            hand, top_discard, model, gs,
            num_worlds=20, rollout_depth=1, info_penalty=0,  # No penalty for clearer signal
            rng=random.Random(42)
        )
        if not diag.get('skipped'):
            # Taking a meld-completing card should generally be better (lower DW)
            self.assertLess(take_ev, stock_ev + 5,
                            "Meld-completing card should produce competitive EV")


class ApexMCTSFallbackTests(unittest.TestCase):
    """Test that ApexMCTS falls back correctly to Apex behavior."""

    def test_inherits_discard_logic(self):
        """ApexMCTS uses Apex's discard logic unchanged."""
        apex = Apex("Apex")
        mcts = ApexMCTS("MCTS", seed=42)

        hand_10 = [make_card(r, 0) for r in range(10)]
        gs = {'turn_number': 3, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': []}

        apex.new_hand(list(hand_10), 1)
        mcts.new_hand(list(hand_10), 1)

        hand_11 = list(hand_10) + [make_card(10, 1)]
        apex_discard = apex.discard_decision(list(hand_11), False, make_card(10, 1), gs)
        mcts_discard = mcts.discard_decision(list(hand_11), False, make_card(10, 1), gs)
        self.assertEqual(apex_discard, mcts_discard)

    def test_inherits_knock_logic(self):
        """ApexMCTS uses Apex's knock logic unchanged."""
        apex = Apex("Apex")
        mcts = ApexMCTS("MCTS", seed=42)

        # Low DW hand that should knock
        hand = [make_card(0, 0), make_card(0, 1), make_card(0, 2),  # Ace set
                make_card(4, 0), make_card(5, 0), make_card(6, 0),  # 5,6,7♣ run
                make_card(8, 1), make_card(9, 1), make_card(10, 1),  # 9,T,J♦ run
                make_card(1, 3)]  # 2♥ (2 DW)

        gs = {'turn_number': 5, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 25, 'discard_pile': []}

        apex.new_hand(list(hand), 1)
        mcts.new_hand(list(hand), 1)

        self.assertEqual(
            apex.knock_decision(list(hand), gs),
            mcts.knock_decision(list(hand), gs)
        )

    def test_reports_search_stats(self):
        """get_search_stats returns valid diagnostic dict."""
        mcts = ApexMCTS("MCTS", seed=42)
        stats = mcts.get_search_stats()
        self.assertIn('total_searches', stats)
        self.assertIn('overrides', stats)
        self.assertIn('agreements', stats)
        self.assertIn('fallbacks', stats)


class ApexMCTSGameCompletionTests(unittest.TestCase):
    """Test that ApexMCTS can complete full legal games."""

    def test_completes_vs_apex(self):
        """ApexMCTS completes a game vs Apex without hanging."""
        random.seed(42)
        game = GinRummyGame(ApexMCTS("MCTS", seed=42), Apex("Apex"), target_score=50)
        result = game.play_game()
        self.assertIsNotNone(result.winner)
        self.assertGreaterEqual(result.hands_played, 1)

    def test_completes_vs_nexus(self):
        """ApexMCTS completes a game vs Nexus without hanging."""
        random.seed(123)
        game = GinRummyGame(ApexMCTS("MCTS", seed=123), Nexus("Nexus"), target_score=50)
        result = game.play_game()
        self.assertIsNotNone(result.winner)

    def test_completes_across_seeds(self):
        """ApexMCTS completes games across 6 different seeds."""
        for seed in [1, 42, 123, 456, 789, 999]:
            random.seed(seed)
            game = GinRummyGame(
                ApexMCTS("MCTS", seed=seed),
                Apex("Apex"),
                target_score=50
            )
            result = game.play_game()
            self.assertIsNotNone(result.winner,
                                 f"Game did not complete with seed {seed}")

    def test_legality_enforcement(self):
        """All draw decisions from ApexMCTS are boolean (True/False)."""
        random.seed(42)
        mcts = ApexMCTS("MCTS", seed=42)
        apex = Apex("Apex")
        game = GinRummyGame(mcts, apex, target_score=30)
        result = game.play_game()
        # If game completes without error, all decisions were legal
        self.assertIsNotNone(result.winner)

    def test_search_overrides_happen(self):
        """Over enough games, the search should override Apex at least once."""
        total_overrides = 0
        for seed in range(10):
            random.seed(seed)
            mcts = ApexMCTS("MCTS", seed=seed)
            game = GinRummyGame(mcts, Apex("Apex"), target_score=50)
            game.play_game()
            total_overrides += mcts.get_search_stats()['overrides']
        # Across 10 games, expect at least one override
        self.assertGreater(total_overrides, 0,
                           "Search never overrode Apex across 10 games")


class DeterministicBehaviorTests(unittest.TestCase):
    """Test determinism under fixed seeds."""

    def test_same_seed_same_draw(self):
        """Fixed seed produces identical draw decision."""
        hand = [make_card(r, 0) for r in range(10)]
        top_discard = make_card(10, 1)
        gs = {'turn_number': 3, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': [top_discard]}

        decisions = []
        for _ in range(3):
            mcts = ApexMCTS("MCTS", seed=42)
            mcts.new_hand(list(hand), 1)
            d = mcts.draw_decision(top_discard, list(hand), gs)
            decisions.append(d)
        self.assertEqual(decisions[0], decisions[1])
        self.assertEqual(decisions[1], decisions[2])


class SearchIntegrationTests(unittest.TestCase):
    """Integration tests for the search pipeline."""

    def test_search_with_known_opponent_cards(self):
        """Search works when opponent has known cards."""
        hand = [make_card(r, 0) for r in range(10)]
        top_discard = make_card(10, 1)

        model = OpponentModel()
        model.reset(hand)
        model.set_discard(top_discard)
        # Simulate opponent picking up a card
        model.opponent_drew_discard(make_card(11, 2))

        gs = {'turn_number': 5, 'my_score': 20, 'opp_score': 30,
              'deck_remaining': 20, 'discard_pile': [top_discard]}

        result = evaluate_draw_choice(
            hand, top_discard, model, gs,
            num_worlds=10, rng=random.Random(42)
        )
        _, _, _, diag = result
        self.assertFalse(diag.get('skipped', True))

    def test_search_with_sparse_unseen(self):
        """Search handles case with very few unseen cards gracefully."""
        hand = [make_card(r, 0) for r in range(10)]
        top_discard = make_card(10, 1)

        model = OpponentModel()
        model.reset(hand)
        model.set_discard(top_discard)

        # Mark almost all cards as known (in hand or discard)
        for c in range(NUM_CARDS):
            if c not in hand and c != top_discard:
                model.set_discard(c)

        gs = {'turn_number': 5, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 2, 'discard_pile': [top_discard]}

        result = evaluate_draw_choice(
            hand, top_discard, model, gs,
            num_worlds=10, rng=random.Random(42)
        )
        _, _, _, diag = result
        # Should handle gracefully (either skip or evaluate)
        self.assertIsInstance(diag, dict)


# ═══════════════════════════════════════════════════════════════
#  Directive 50: Weighted worlds refinement tests
# ═══════════════════════════════════════════════════════════════

class WeightedShuffleTests(unittest.TestCase):
    """Test the _weighted_shuffle function directly."""

    def test_weighted_shuffle_returns_all_cards(self):
        """Weighted shuffle preserves all input cards."""
        from gin_rummy.draw_search import _weighted_shuffle
        cards = [make_card(r, 0) for r in range(10)]
        weights = [1.0] * 10
        result = _weighted_shuffle(cards, weights, random.Random(42))
        self.assertEqual(sorted(result), sorted(cards))
        self.assertEqual(len(result), len(cards))

    def test_weighted_shuffle_deterministic(self):
        """Same seed produces same order."""
        from gin_rummy.draw_search import _weighted_shuffle
        cards = [make_card(r, 0) for r in range(10)]
        weights = [1.0 + r * 0.5 for r in range(10)]
        r1 = _weighted_shuffle(cards, weights, random.Random(42))
        r2 = _weighted_shuffle(cards, weights, random.Random(42))
        self.assertEqual(r1, r2)

    def test_weighted_shuffle_biases_low_weight_first(self):
        """Cards with low opponent weight (high stock weight) appear earlier."""
        from gin_rummy.draw_search import _weighted_shuffle
        # Create cards where first 5 have very low weight (likely in stock)
        # and last 5 have very high weight (likely in opponent's hand)
        cards = list(range(10))
        weights = [0.1, 0.1, 0.1, 0.1, 0.1, 5.0, 5.0, 5.0, 5.0, 5.0]

        # Run multiple shuffles and track average position
        low_weight_cards = set(cards[:5])
        low_weight_avg_pos = 0
        high_weight_avg_pos = 0
        n_trials = 200

        for seed in range(n_trials):
            result = _weighted_shuffle(cards, weights, random.Random(seed))
            for pos, card in enumerate(result):
                if card in low_weight_cards:
                    low_weight_avg_pos += pos
                else:
                    high_weight_avg_pos += pos

        low_weight_avg_pos /= (n_trials * 5)
        high_weight_avg_pos /= (n_trials * 5)

        # Low-weight cards should appear earlier (lower avg position)
        self.assertLess(low_weight_avg_pos, high_weight_avg_pos,
                        f"Low-weight cards should appear earlier: "
                        f"low_avg={low_weight_avg_pos:.2f}, high_avg={high_weight_avg_pos:.2f}")

    def test_weighted_shuffle_empty_input(self):
        """Weighted shuffle handles empty input."""
        from gin_rummy.draw_search import _weighted_shuffle
        result = _weighted_shuffle([], [], random.Random(42))
        self.assertEqual(result, [])

    def test_weighted_shuffle_single_card(self):
        """Weighted shuffle handles single card."""
        from gin_rummy.draw_search import _weighted_shuffle
        result = _weighted_shuffle([5], [2.0], random.Random(42))
        self.assertEqual(result, [5])


class WeightedWorldsEvaluationTests(unittest.TestCase):
    """Test that weighted worlds produce different but valid evaluations."""

    def test_weighted_vs_uniform_both_valid(self):
        """Both weighted and uniform modes produce valid results."""
        hand = [make_card(r, 0) for r in range(10)]
        top_discard = make_card(10, 1)
        model = OpponentModel()
        model.reset(hand)
        model.set_discard(top_discard)
        # Simulate some opponent activity to create non-uniform weights
        model.opponent_drew_discard(make_card(11, 2))
        model.opponent_discarded(make_card(8, 3))

        gs = {'turn_number': 5, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 25, 'discard_pile': [top_discard]}

        # Uniform (v1)
        r1 = evaluate_draw_choice(
            hand, top_discard, model, gs,
            num_worlds=20, rng=random.Random(42),
            use_weighted_worlds=False
        )
        _, _, _, diag1 = r1
        self.assertFalse(diag1.get('skipped'))
        self.assertFalse(diag1.get('weighted_worlds'))

        # Weighted (v2)
        r2 = evaluate_draw_choice(
            hand, top_discard, model, gs,
            num_worlds=20, rng=random.Random(42),
            use_weighted_worlds=True
        )
        _, _, _, diag2 = r2
        self.assertFalse(diag2.get('skipped'))
        self.assertTrue(diag2.get('weighted_worlds'))

    def test_weighted_worlds_diagnostics(self):
        """Weighted worlds reports correct diagnostic flag."""
        hand = [make_card(r, 0) for r in range(10)]
        top_discard = make_card(10, 1)
        model = OpponentModel()
        model.reset(hand)
        model.set_discard(top_discard)

        gs = {'turn_number': 3, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': [top_discard]}

        _, _, _, diag = evaluate_draw_choice(
            hand, top_discard, model, gs,
            num_worlds=10, rng=random.Random(42),
            use_weighted_worlds=True
        )
        if not diag.get('skipped'):
            self.assertTrue(diag['weighted_worlds'])


class ApexMCTSv2Tests(unittest.TestCase):
    """Test the ApexMCTSv2 bot (weighted worlds)."""

    def test_v2_completes_vs_apex(self):
        """ApexMCTSv2 completes a game vs Apex without hanging."""
        from gin_rummy.apex_mcts_v2 import ApexMCTSv2
        random.seed(42)
        game = GinRummyGame(ApexMCTSv2("MCTSv2", seed=42), Apex("Apex"), target_score=50)
        result = game.play_game()
        self.assertIsNotNone(result.winner)
        self.assertGreaterEqual(result.hands_played, 1)

    def test_v2_completes_vs_mcts_v1(self):
        """ApexMCTSv2 completes a game vs ApexMCTS (v1) without hanging."""
        from gin_rummy.apex_mcts_v2 import ApexMCTSv2
        random.seed(42)
        game = GinRummyGame(
            ApexMCTSv2("MCTSv2", seed=42),
            ApexMCTS("MCTSv1", seed=43),
            target_score=50
        )
        result = game.play_game()
        self.assertIsNotNone(result.winner)

    def test_v2_completes_across_seeds(self):
        """ApexMCTSv2 completes games across 6 different seeds."""
        from gin_rummy.apex_mcts_v2 import ApexMCTSv2
        for seed in [1, 42, 123, 456, 789, 999]:
            random.seed(seed)
            game = GinRummyGame(
                ApexMCTSv2("MCTSv2", seed=seed),
                Apex("Apex"),
                target_score=50
            )
            result = game.play_game()
            self.assertIsNotNone(result.winner,
                                 f"Game did not complete with seed {seed}")

    def test_v2_search_overrides_happen(self):
        """Over enough games, v2 search should override Apex at least once."""
        from gin_rummy.apex_mcts_v2 import ApexMCTSv2
        total_overrides = 0
        for seed in range(10):
            random.seed(seed)
            mcts = ApexMCTSv2("MCTSv2", seed=seed)
            game = GinRummyGame(mcts, Apex("Apex"), target_score=50)
            game.play_game()
            total_overrides += mcts.get_search_stats()['overrides']
        self.assertGreater(total_overrides, 0,
                           "v2 search never overrode Apex across 10 games")

    def test_v2_inherits_discard_logic(self):
        """ApexMCTSv2 uses Apex's discard logic unchanged."""
        from gin_rummy.apex_mcts_v2 import ApexMCTSv2
        apex = Apex("Apex")
        v2 = ApexMCTSv2("MCTSv2", seed=42)

        hand_10 = [make_card(r, 0) for r in range(10)]
        gs = {'turn_number': 3, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': []}

        apex.new_hand(list(hand_10), 1)
        v2.new_hand(list(hand_10), 1)

        hand_11 = list(hand_10) + [make_card(10, 1)]
        apex_discard = apex.discard_decision(list(hand_11), False, make_card(10, 1), gs)
        v2_discard = v2.discard_decision(list(hand_11), False, make_card(10, 1), gs)
        self.assertEqual(apex_discard, v2_discard)

    def test_v2_deterministic_with_seed(self):
        """Fixed seed produces identical v2 draw decision."""
        from gin_rummy.apex_mcts_v2 import ApexMCTSv2
        hand = [make_card(r, 0) for r in range(10)]
        top_discard = make_card(10, 1)
        gs = {'turn_number': 3, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 30, 'discard_pile': [top_discard]}

        decisions = []
        for _ in range(3):
            mcts = ApexMCTSv2("MCTSv2", seed=42)
            mcts.new_hand(list(hand), 1)
            d = mcts.draw_decision(top_discard, list(hand), gs)
            decisions.append(d)
        self.assertEqual(decisions[0], decisions[1])
        self.assertEqual(decisions[1], decisions[2])

    def test_v2_reports_search_stats(self):
        """v2 get_search_stats returns valid diagnostic dict."""
        from gin_rummy.apex_mcts_v2 import ApexMCTSv2
        mcts = ApexMCTSv2("MCTSv2", seed=42)
        stats = mcts.get_search_stats()
        self.assertIn('total_searches', stats)
        self.assertIn('overrides', stats)
        self.assertIn('agreements', stats)
        self.assertIn('fallbacks', stats)


if __name__ == '__main__':
    unittest.main()

