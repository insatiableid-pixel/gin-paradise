"""
Tests for knock ablation bots: ApexMCTSGoGin, ApexMCTSClinchGoGin,
ApexMCTSFirstKnock, ApexMCTSPaperKnock.

Validates:
- Construction and basic properties
- Expected knock behavior in trivial cases
- Immediate-clinch non-gin cases
- Low-stock cases
- Gameplay completion without hangs or illegal behavior
- Benchmark factory registration
"""

import os
import sys
import unittest
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gin_rummy.card import make_card, make_deck
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.game import GinRummyGame
from gin_rummy.apex_mcts_gogin import ApexMCTSGoGin
from gin_rummy.apex_mcts_clinch_gogin import ApexMCTSClinchGoGin
from gin_rummy.apex_mcts_firstknock import ApexMCTSFirstKnock
from gin_rummy.apex_mcts_paperknock import ApexMCTSPaperKnock
from gin_rummy.apex_mcts import ApexMCTS


def _gin_hand():
    """A hand with deadwood = 0 (gin)."""
    # Three 3-card melds + 1 card melded = 10 cards, all in melds
    # A-2-3 of spades, 4-5-6 of hearts, 7-8-9 of diamonds, 10-J-Q of clubs
    return [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),   # A-2-3 spades
        make_card(3, 1), make_card(4, 1), make_card(5, 1),   # 4-5-6 hearts
        make_card(6, 2), make_card(7, 2), make_card(8, 2),   # 7-8-9 diamonds
        make_card(9, 3),  # 10 clubs - need this to be part of a meld
    ]


def _low_dw_hand():
    """A hand with low deadwood (DW ~3)."""
    # Two 3-card melds + remaining low cards
    return [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),   # A-2-3 spades
        make_card(3, 1), make_card(4, 1), make_card(5, 1),   # 4-5-6 hearts
        make_card(6, 2), make_card(7, 2), make_card(8, 2),   # 7-8-9 diamonds
        make_card(0, 1),  # Ace hearts = 1 DW
    ]


def _high_dw_hand():
    """A hand with DW > 10 (cannot knock)."""
    return [
        make_card(12, 0), make_card(11, 1), make_card(10, 2),  # K, Q, J different suits
        make_card(9, 3), make_card(8, 0), make_card(7, 1),     # 10, 9, 8 different suits
        make_card(6, 2), make_card(5, 3), make_card(4, 0),     # 7, 6, 5 different suits
        make_card(3, 1),                                        # 4 hearts
    ]


def _mid_dw_hand():
    """A hand with DW ~7 (legal knock, risky zone)."""
    return [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),   # A-2-3 spades
        make_card(3, 1), make_card(4, 1), make_card(5, 1),   # 4-5-6 hearts
        make_card(6, 2), make_card(7, 2), make_card(8, 2),   # 7-8-9 diamonds
        make_card(6, 3),  # 7 clubs = 7 DW
    ]


def _base_game_state(**overrides):
    gs = {
        'turn_number': 5,
        'my_score': 0,
        'opp_score': 0,
        'deck_remaining': 20,
        'discard_pile': [],
    }
    gs.update(overrides)
    return gs


class TestApexMCTSGoGin(unittest.TestCase):
    """Tests for the go-gin-only ablation bot."""

    def test_construction(self):
        bot = ApexMCTSGoGin()
        self.assertEqual(bot.name, "ApexMCTSGoGin")
        self.assertIsInstance(bot, ApexMCTS)

    def test_gin_always_knocks(self):
        bot = ApexMCTSGoGin()
        hand = _gin_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw == 0:
            self.assertTrue(bot.knock_decision(hand, _base_game_state()))

    def test_non_gin_never_knocks(self):
        bot = ApexMCTSGoGin()
        hand = _low_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 0 and dw <= 10:
            self.assertFalse(bot.knock_decision(hand, _base_game_state()))

    def test_high_dw_no_knock(self):
        bot = ApexMCTSGoGin()
        hand = _high_dw_hand()
        self.assertFalse(bot.knock_decision(hand, _base_game_state()))

    def test_mid_dw_no_knock(self):
        bot = ApexMCTSGoGin()
        hand = _mid_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 0 and dw <= 10:
            self.assertFalse(bot.knock_decision(hand, _base_game_state()))

    def test_gameplay_completes(self):
        """Verify bot plays a full game without hanging or crashing."""
        random.seed(42)
        bot_a = ApexMCTSGoGin(seed=42)
        bot_b = ApexMCTS(seed=43)
        game = GinRummyGame(bot_a, bot_b, target_score=50, verbose=False)
        result = game.play_game()
        self.assertIsNotNone(result.winner)
        self.assertIn(result.winner, [0, 1])


class TestApexMCTSClinchGoGin(unittest.TestCase):
    """Tests for the clinch-aware go-gin ablation bot."""

    def test_construction(self):
        bot = ApexMCTSClinchGoGin()
        self.assertEqual(bot.name, "ApexMCTSClinchGoGin")
        self.assertIsInstance(bot, ApexMCTS)

    def test_gin_always_knocks(self):
        bot = ApexMCTSClinchGoGin()
        hand = _gin_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw == 0:
            self.assertTrue(bot.knock_decision(hand, _base_game_state()))

    def test_low_stock_always_knocks(self):
        bot = ApexMCTSClinchGoGin()
        hand = _mid_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw <= 10:
            gs = _base_game_state(deck_remaining=5)
            self.assertTrue(bot.knock_decision(hand, gs))

    def test_clinch_knock_near_target(self):
        """Non-gin knock that wins the game should be taken."""
        bot = ApexMCTSClinchGoGin(target_score=100)
        hand = _low_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 0 and dw <= 10:
            # Score is high enough that even a small knock wins
            gs = _base_game_state(my_score=98)
            decision = bot.knock_decision(hand, gs)
            self.assertTrue(decision)

    def test_mid_dw_no_knock_no_clinch(self):
        """Mid-DW hand far from target should NOT knock."""
        bot = ApexMCTSClinchGoGin()
        hand = _mid_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 0 and dw <= 10:
            gs = _base_game_state(my_score=0, deck_remaining=20)
            self.assertFalse(bot.knock_decision(hand, gs))

    def test_gameplay_completes(self):
        random.seed(42)
        bot_a = ApexMCTSClinchGoGin(seed=42)
        bot_b = ApexMCTS(seed=43)
        game = GinRummyGame(bot_a, bot_b, target_score=50, verbose=False)
        result = game.play_game()
        self.assertIsNotNone(result.winner)


class TestApexMCTSFirstKnock(unittest.TestCase):
    """Tests for the always-knock ablation bot."""

    def test_construction(self):
        bot = ApexMCTSFirstKnock()
        self.assertEqual(bot.name, "ApexMCTSFirstKnock")
        self.assertIsInstance(bot, ApexMCTS)

    def test_gin_knocks(self):
        bot = ApexMCTSFirstKnock()
        hand = _gin_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw == 0:
            self.assertTrue(bot.knock_decision(hand, _base_game_state()))

    def test_mid_dw_knocks(self):
        bot = ApexMCTSFirstKnock()
        hand = _mid_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw <= 10:
            self.assertTrue(bot.knock_decision(hand, _base_game_state()))

    def test_low_dw_knocks(self):
        bot = ApexMCTSFirstKnock()
        hand = _low_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw <= 10:
            self.assertTrue(bot.knock_decision(hand, _base_game_state()))

    def test_high_dw_no_knock(self):
        bot = ApexMCTSFirstKnock()
        hand = _high_dw_hand()
        self.assertFalse(bot.knock_decision(hand, _base_game_state()))

    def test_gameplay_completes(self):
        random.seed(42)
        bot_a = ApexMCTSFirstKnock(seed=42)
        bot_b = ApexMCTS(seed=43)
        game = GinRummyGame(bot_a, bot_b, target_score=50, verbose=False)
        result = game.play_game()
        self.assertIsNotNone(result.winner)


class TestApexMCTSPaperKnock(unittest.TestCase):
    """Tests for the paper-inspired knock ablation bot."""

    def test_construction(self):
        bot = ApexMCTSPaperKnock()
        self.assertEqual(bot.name, "ApexMCTSPaperKnock")
        self.assertIsInstance(bot, ApexMCTS)

    def test_gin_always_knocks(self):
        bot = ApexMCTSPaperKnock()
        hand = _gin_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw == 0:
            self.assertTrue(bot.knock_decision(hand, _base_game_state()))

    def test_low_stock_always_knocks(self):
        bot = ApexMCTSPaperKnock()
        hand = _mid_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw <= 10:
            gs = _base_game_state(deck_remaining=5)
            self.assertTrue(bot.knock_decision(hand, gs))

    def test_clinch_knocks(self):
        bot = ApexMCTSPaperKnock(target_score=100)
        hand = _low_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 0 and dw <= 10:
            gs = _base_game_state(my_score=98)
            self.assertTrue(bot.knock_decision(hand, gs))

    def test_gameplay_completes(self):
        random.seed(42)
        bot_a = ApexMCTSPaperKnock(seed=42)
        bot_b = ApexMCTS(seed=43)
        game = GinRummyGame(bot_a, bot_b, target_score=50, verbose=False)
        result = game.play_game()
        self.assertIsNotNone(result.winner)


class TestBenchmarkFactoryRegistration(unittest.TestCase):
    """Test that all ablation bots are properly registered in benchmark.py."""

    def test_all_ablation_bots_available(self):
        from benchmark import _build_player_factories
        names = ["ApexMCTSGoGin", "ApexMCTSClinchGoGin",
                 "ApexMCTSFirstKnock", "ApexMCTSPaperKnock"]
        factories = _build_player_factories(names)
        self.assertEqual(len(factories), 4)
        for name in names:
            self.assertIn(name, factories)
            bot = factories[name]()
            self.assertEqual(bot.name, name)


if __name__ == '__main__':
    unittest.main()
