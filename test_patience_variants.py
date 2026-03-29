"""
Patience variant tests for Phase 57.

Tests:
1. New bot registration and instantiation
2. Knock policy correctness for all four patience variants
3. Dominant-action scenario coverage (clinch, low-stock, opening, gin-only-clinch, illegal)
4. Mirror/self-play helper correctness
5. Gameplay completion for all patience variants
"""

import os
import sys
import unittest
import random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gin_rummy.card import make_card, deadwood_value
from gin_rummy.meld import best_meld_arrangement
from gin_rummy.game import GinRummyGame

from gin_rummy.apex_mcts_gogin import ApexMCTSGoGin
from gin_rummy.apex_mcts_clinch_gogin import ApexMCTSClinchGoGin
from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin
from gin_rummy.apex_mcts_lowstock_gogin import ApexMCTSLowStockGoGin


def _make_game_state(**overrides):
    gs = {
        'turn_number': 5,
        'my_score': 0,
        'opp_score': 0,
        'deck_remaining': 20,
        'discard_pile': [],
    }
    gs.update(overrides)
    return gs


# ── Hand constructors ──────────────────────────────────────────

def _gin_hand():
    """DW = 0."""
    return [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),   # A-2-3 spades
        make_card(3, 1), make_card(4, 1), make_card(5, 1),   # 4-5-6 hearts
        make_card(6, 2), make_card(7, 2), make_card(8, 2),   # 7-8-9 diamonds
        make_card(9, 3),                                       # 10 clubs
    ]


def _low_dw_hand_1card():
    """DW = 1, one deadwood card (Ace)."""
    return [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),   # A-2-3 spades
        make_card(3, 1), make_card(4, 1), make_card(5, 1),   # 4-5-6 hearts
        make_card(6, 2), make_card(7, 2), make_card(8, 2),   # 7-8-9 diamonds
        make_card(0, 1),                                       # Ace hearts = 1 DW
    ]


def _mid_dw_hand():
    """DW = 8."""
    return [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),   # A-2-3 spades
        make_card(3, 1), make_card(4, 1), make_card(5, 1),   # 4-5-6 hearts
        make_card(6, 2), make_card(7, 2), make_card(8, 2),   # 7-8-9 diamonds
        make_card(7, 3),                                       # 8 clubs = 8 DW
    ]


def _dw_10_hand():
    """DW = 10."""
    return [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),   # A-2-3 spades
        make_card(3, 1), make_card(4, 1), make_card(5, 1),   # 4-5-6 hearts
        make_card(6, 2), make_card(7, 2), make_card(8, 2),   # 7-8-9 diamonds
        make_card(9, 0),                                       # 10 spades = 10 DW
    ]


def _high_dw_hand():
    """DW > 10."""
    return [
        make_card(12, 0), make_card(11, 1), make_card(10, 2),
        make_card(9, 3), make_card(8, 0), make_card(7, 1),
        make_card(6, 2), make_card(5, 3), make_card(4, 0),
        make_card(3, 1),
    ]


def _all_patience_bots():
    return {
        'GoGin': ApexMCTSGoGin(seed=42),
        'ClinchOnlyGoGin': ApexMCTSClinchOnlyGoGin(seed=42),
        'ClinchGoGin': ApexMCTSClinchGoGin(seed=42),
        'LowStockGoGin': ApexMCTSLowStockGoGin(seed=42),
    }


# ═══════════════════════════════════════════════════════════════
# 1. Registration & Instantiation
# ═══════════════════════════════════════════════════════════════

class TestPatienceVariantInstantiation(unittest.TestCase):
    """All four patience variants can be instantiated cleanly."""

    def test_gogin_creates(self):
        bot = ApexMCTSGoGin(seed=1)
        self.assertEqual(bot.name, "ApexMCTSGoGin")

    def test_clinchonly_creates(self):
        bot = ApexMCTSClinchOnlyGoGin(seed=1)
        self.assertEqual(bot.name, "ApexMCTSClinchOnlyGoGin")

    def test_clinch_creates(self):
        bot = ApexMCTSClinchGoGin(seed=1)
        self.assertEqual(bot.name, "ApexMCTSClinchGoGin")

    def test_lowstock_creates(self):
        bot = ApexMCTSLowStockGoGin(seed=1)
        self.assertEqual(bot.name, "ApexMCTSLowStockGoGin")


# ═══════════════════════════════════════════════════════════════
# 2. Knock Policy Correctness
# ═══════════════════════════════════════════════════════════════

class TestKnockPolicyGin(unittest.TestCase):
    """All patience variants knock on gin."""

    def test_all_knock_on_gin(self):
        hand = _gin_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw != 0:
            self.skipTest("Hand is not gin")
        gs = _make_game_state()
        for name, bot in _all_patience_bots().items():
            self.assertTrue(bot.knock_decision(hand, gs),
                          f"{name} should knock on gin")


class TestKnockPolicyIllegal(unittest.TestCase):
    """All patience variants refuse to knock when DW > 10."""

    def test_all_refuse_illegal(self):
        hand = _high_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw <= 10:
            self.skipTest("Hand DW unexpectedly low")
        gs = _make_game_state()
        for name, bot in _all_patience_bots().items():
            self.assertFalse(bot.knock_decision(hand, gs),
                           f"{name} should not knock when DW > 10")


class TestKnockPolicyMidGame(unittest.TestCase):
    """Normal mid-game non-gin: GoGin and ClinchOnly hold, LowStock holds,
    ClinchGoGin holds (no clinch, no low stock)."""

    def test_normal_midgame_all_hold(self):
        hand = _low_dw_hand_1card()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 10 or dw == 0:
            self.skipTest("Hand not in target range")

        gs = _make_game_state(turn_number=5, deck_remaining=20,
                              my_score=0, opp_score=0)
        bots = _all_patience_bots()

        # All should hold in normal mid-game
        for name, bot in bots.items():
            self.assertFalse(bot.knock_decision(hand, gs),
                           f"{name} should hold in normal mid-game")


# ═══════════════════════════════════════════════════════════════
# 3. Dominant-Action Scenario Coverage
# ═══════════════════════════════════════════════════════════════

class TestDominantAction_ImmediateClinch(unittest.TestCase):
    """Scenario 1: Score near target, legal knock wins the game."""

    def test_clinch_score98_dw1(self):
        """Score=98, DW=1 -> knock wins. ClinchOnly and ClinchGoGin should knock."""
        hand = _low_dw_hand_1card()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 10:
            self.skipTest("Hand DW too high")

        gs = _make_game_state(my_score=98)
        bots = _all_patience_bots()

        # GoGin: never knocks non-gin
        if dw > 0:
            self.assertFalse(bots['GoGin'].knock_decision(hand, gs),
                           "GoGin never knocks non-gin")

        # ClinchOnlyGoGin: should knock (clinch)
        self.assertTrue(bots['ClinchOnlyGoGin'].knock_decision(hand, gs),
                       "ClinchOnlyGoGin should knock to clinch the game")

        # ClinchGoGin: should knock (clinch)
        self.assertTrue(bots['ClinchGoGin'].knock_decision(hand, gs),
                       "ClinchGoGin should knock to clinch the game")

        # LowStockGoGin: should NOT knock (no low stock)
        if dw > 0:
            self.assertFalse(bots['LowStockGoGin'].knock_decision(hand, gs),
                           "LowStockGoGin should not knock without low stock")

    def test_clinch_score91_dw8(self):
        """Score=91, DW=8 -> points_if_knock = max(1, 10-8) = 2, 91+2 < 100. No clinch."""
        hand = _mid_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 10:
            self.skipTest("Hand DW too high")

        gs = _make_game_state(my_score=91, deck_remaining=20)
        bots = _all_patience_bots()

        # ClinchOnlyGoGin: should NOT knock (91+2 < 100)
        self.assertFalse(bots['ClinchOnlyGoGin'].knock_decision(hand, gs),
                        "ClinchOnlyGoGin should not knock, won't clinch")


class TestDominantAction_OpeningLegalKnock(unittest.TestCase):
    """Scenario 2: Opening legal knock (turn 0-1, score 0-0)."""

    def test_opening_dw9_all_hold(self):
        """Turn 0, score 0-0, DW=9-10. All patience bots should hold."""
        hand = _dw_10_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 10 or dw == 0:
            self.skipTest("Hand not in target range")

        gs = _make_game_state(turn_number=0, my_score=0, opp_score=0,
                              deck_remaining=30)
        bots = _all_patience_bots()

        for name, bot in bots.items():
            self.assertFalse(bot.knock_decision(hand, gs),
                           f"{name} should hold on opening DW 10 knock")


class TestDominantAction_LowStock(unittest.TestCase):
    """Scenario 3: Low stock (deck_remaining <= 8)."""

    def test_low_stock_dw8(self):
        """Low stock, DW=8. ClinchGoGin and LowStockGoGin should knock."""
        hand = _mid_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 10:
            self.skipTest("Hand DW too high")

        gs = _make_game_state(deck_remaining=5)
        bots = _all_patience_bots()

        # GoGin: never knocks non-gin
        if dw > 0:
            self.assertFalse(bots['GoGin'].knock_decision(hand, gs))

        # ClinchOnlyGoGin: does NOT have low-stock override
        if dw > 0:
            self.assertFalse(bots['ClinchOnlyGoGin'].knock_decision(hand, gs),
                           "ClinchOnlyGoGin has NO low-stock override")

        # ClinchGoGin: has low-stock override
        self.assertTrue(bots['ClinchGoGin'].knock_decision(hand, gs),
                       "ClinchGoGin should knock on low stock")

        # LowStockGoGin: has low-stock override
        self.assertTrue(bots['LowStockGoGin'].knock_decision(hand, gs),
                       "LowStockGoGin should knock on low stock")


class TestDominantAction_GinOnlyClinch(unittest.TestCase):
    """Scenario 4: Knock doesn't win, gin would. All patience bots hold."""

    def test_gin_needed_to_clinch(self):
        """Score=74, DW=1 -> knock won't reach 100, gin (25 bonus) would."""
        hand = _low_dw_hand_1card()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 10 or dw == 0:
            self.skipTest("Hand not in target range")

        gs = _make_game_state(my_score=74, deck_remaining=20)
        bots = _all_patience_bots()

        # points_if_knock = max(1, 10-1) = 9; 74+9 = 83 < 100
        # All patience bots should hold
        for name, bot in bots.items():
            self.assertFalse(bot.knock_decision(hand, gs),
                           f"{name} should hold — knock won't clinch, gin would")


class TestDominantAction_NonGinLowStockClinch(unittest.TestCase):
    """Scenario 5: Low stock AND clinch at the same time."""

    def test_low_stock_plus_clinch(self):
        """Low stock + clinch: ClinchGoGin, ClinchOnlyGoGin (clinch), LowStockGoGin (low stock) all knock."""
        hand = _low_dw_hand_1card()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 10:
            self.skipTest("Hand DW too high")

        gs = _make_game_state(my_score=98, deck_remaining=5)
        bots = _all_patience_bots()

        # GoGin: still never knocks non-gin
        if dw > 0:
            self.assertFalse(bots['GoGin'].knock_decision(hand, gs))

        # All three exception variants should knock
        self.assertTrue(bots['ClinchOnlyGoGin'].knock_decision(hand, gs))
        self.assertTrue(bots['ClinchGoGin'].knock_decision(hand, gs))
        self.assertTrue(bots['LowStockGoGin'].knock_decision(hand, gs))


# ═══════════════════════════════════════════════════════════════
# 4. Policy Differentiation
# ═══════════════════════════════════════════════════════════════

class TestPolicyDifferentiation(unittest.TestCase):
    """Verify that the four policies are genuinely different."""

    def test_clinchonly_differs_from_gogin(self):
        """ClinchOnlyGoGin knocks on clinch, GoGin does not."""
        hand = _low_dw_hand_1card()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 10 or dw == 0:
            self.skipTest("Hand not in range")

        gs = _make_game_state(my_score=98)
        gogin = ApexMCTSGoGin(seed=42)
        clinchonly = ApexMCTSClinchOnlyGoGin(seed=42)

        self.assertFalse(gogin.knock_decision(hand, gs))
        self.assertTrue(clinchonly.knock_decision(hand, gs))

    def test_clinchonly_differs_from_clinchgogin_on_lowstock(self):
        """ClinchOnlyGoGin does NOT knock on low stock, ClinchGoGin does."""
        hand = _mid_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 10 or dw == 0:
            self.skipTest("Hand not in range")

        gs = _make_game_state(deck_remaining=5, my_score=0)
        clinchonly = ApexMCTSClinchOnlyGoGin(seed=42)
        clinchgogin = ApexMCTSClinchGoGin(seed=42)

        self.assertFalse(clinchonly.knock_decision(hand, gs))
        self.assertTrue(clinchgogin.knock_decision(hand, gs))

    def test_lowstock_differs_from_gogin(self):
        """LowStockGoGin knocks on low stock, GoGin does not."""
        hand = _mid_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 10 or dw == 0:
            self.skipTest("Hand not in range")

        gs = _make_game_state(deck_remaining=5)
        gogin = ApexMCTSGoGin(seed=42)
        lowstock = ApexMCTSLowStockGoGin(seed=42)

        self.assertFalse(gogin.knock_decision(hand, gs))
        self.assertTrue(lowstock.knock_decision(hand, gs))

    def test_lowstock_differs_from_clinchonly_on_clinch(self):
        """LowStockGoGin does NOT knock on clinch (no low stock), ClinchOnlyGoGin does."""
        hand = _low_dw_hand_1card()
        melds, _, dw = best_meld_arrangement(hand)
        if dw > 10 or dw == 0:
            self.skipTest("Hand not in range")

        gs = _make_game_state(my_score=98, deck_remaining=20)
        lowstock = ApexMCTSLowStockGoGin(seed=42)
        clinchonly = ApexMCTSClinchOnlyGoGin(seed=42)

        self.assertFalse(lowstock.knock_decision(hand, gs))
        self.assertTrue(clinchonly.knock_decision(hand, gs))


# ═══════════════════════════════════════════════════════════════
# 5. Gameplay Completion
# ═══════════════════════════════════════════════════════════════

class TestGameplayCompletion(unittest.TestCase):
    """All patience variants can complete a full game without crashing."""

    def _run_game(self, p0, p1, seed=42):
        random.seed(seed)
        game = GinRummyGame(p0, p1, target_score=100, verbose=False)
        result = game.play_game()
        self.assertIsNotNone(result.winner)
        self.assertGreater(result.hands_played, 0)
        return result

    def test_gogin_vs_clinchonly(self):
        self._run_game(ApexMCTSGoGin(seed=1), ApexMCTSClinchOnlyGoGin(seed=2))

    def test_gogin_vs_lowstock(self):
        self._run_game(ApexMCTSGoGin(seed=1), ApexMCTSLowStockGoGin(seed=2))

    def test_clinchonly_vs_clinchgogin(self):
        self._run_game(ApexMCTSClinchOnlyGoGin(seed=1), ApexMCTSClinchGoGin(seed=2))

    def test_clinchonly_vs_lowstock(self):
        self._run_game(ApexMCTSClinchOnlyGoGin(seed=1), ApexMCTSLowStockGoGin(seed=2))

    def test_lowstock_vs_clinchgogin(self):
        self._run_game(ApexMCTSLowStockGoGin(seed=1), ApexMCTSClinchGoGin(seed=2))

    def test_gogin_mirror(self):
        """GoGin vs GoGin completes without crash."""
        self._run_game(ApexMCTSGoGin(seed=1), ApexMCTSGoGin(seed=2))

    def test_clinchonly_mirror(self):
        """ClinchOnlyGoGin vs ClinchOnlyGoGin completes without crash."""
        self._run_game(ApexMCTSClinchOnlyGoGin(seed=1), ApexMCTSClinchOnlyGoGin(seed=2))


# ═══════════════════════════════════════════════════════════════
# 6. Benchmark Registration
# ═══════════════════════════════════════════════════════════════

class TestBenchmarkRegistration(unittest.TestCase):
    """New bots are properly registered in benchmark.py."""

    def test_clinchonly_registered(self):
        from benchmark import _build_player_factories
        factories = _build_player_factories(["ApexMCTSClinchOnlyGoGin"])
        self.assertIn("ApexMCTSClinchOnlyGoGin", factories)
        bot = factories["ApexMCTSClinchOnlyGoGin"]()
        self.assertEqual(bot.name, "ApexMCTSClinchOnlyGoGin")

    def test_lowstock_registered(self):
        from benchmark import _build_player_factories
        factories = _build_player_factories(["ApexMCTSLowStockGoGin"])
        self.assertIn("ApexMCTSLowStockGoGin", factories)
        bot = factories["ApexMCTSLowStockGoGin"]()
        self.assertEqual(bot.name, "ApexMCTSLowStockGoGin")


if __name__ == '__main__':
    unittest.main()
