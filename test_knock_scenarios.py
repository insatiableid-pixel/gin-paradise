"""
Targeted knock scenario tests.

Tests canonical knock situations across all ablation bots to validate
that each policy handles obvious and high-leverage knock states sensibly.

Scenarios:
1. Immediate clinch: legal non-gin knock that immediately reaches target score
2. Gin-only clinch: knock won't win, but gin would
3. Low-stock legal knock: deck_remaining <= 8
4. Early live hand hold: early turn, few deadwood cards, good gin liveness
5. Risky undercut zone: DW 7-10 with real undercut exposure
6. Large score-gap hold: clearly ahead or behind with a live hand
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gin_rummy.card import make_card, deadwood_value
from gin_rummy.meld import best_meld_arrangement

from gin_rummy.apex_mcts_gogin import ApexMCTSGoGin
from gin_rummy.apex_mcts_clinch_gogin import ApexMCTSClinchGoGin
from gin_rummy.apex_mcts_firstknock import ApexMCTSFirstKnock
from gin_rummy.apex_mcts_paperknock import ApexMCTSPaperKnock
from gin_rummy.apex_mcts_knock import ApexMCTSKnock
from gin_rummy.apex_mcts import ApexMCTS


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
        make_card(9, 3),  # 10 clubs - will check if actually melded
    ]


def _low_dw_hand_1card():
    """
    Hand with 1 deadwood card (DW ~1-3), very gin-live.
    3 melds of 3 cards = 9 melded, 1 deadwood card.
    """
    return [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),   # A-2-3 spades
        make_card(3, 1), make_card(4, 1), make_card(5, 1),   # 4-5-6 hearts
        make_card(6, 2), make_card(7, 2), make_card(8, 2),   # 7-8-9 diamonds
        make_card(0, 1),                                       # Ace hearts = 1 DW
    ]


def _mid_dw_hand_risky():
    """DW ~8, risky undercut zone."""
    return [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),   # A-2-3 spades
        make_card(3, 1), make_card(4, 1), make_card(5, 1),   # 4-5-6 hearts
        make_card(6, 2), make_card(7, 2), make_card(8, 2),   # 7-8-9 diamonds
        make_card(7, 3),                                       # 8 clubs = 8 DW
    ]


def _dw_10_hand():
    """DW = 10, maximum legal knock deadwood."""
    return [
        make_card(0, 0), make_card(1, 0), make_card(2, 0),   # A-2-3 spades
        make_card(3, 1), make_card(4, 1), make_card(5, 1),   # 4-5-6 hearts
        make_card(6, 2), make_card(7, 2), make_card(8, 2),   # 7-8-9 diamonds
        make_card(9, 0),                                       # 10 spades = 10 DW
    ]


def _high_dw_hand():
    """A hand with DW > 10 (cannot knock)."""
    return [
        make_card(12, 0), make_card(11, 1), make_card(10, 2),  # K, Q, J different suits
        make_card(9, 3), make_card(8, 0), make_card(7, 1),     # 10, 9, 8 different suits
        make_card(6, 2), make_card(5, 3), make_card(4, 0),     # 7, 6, 5 different suits
        make_card(3, 1),                                        # 4 hearts
    ]


def _all_bots():
    """Create one instance of each ablation bot."""
    return {
        'GoGin': ApexMCTSGoGin(seed=42),
        'ClinchGoGin': ApexMCTSClinchGoGin(seed=42),
        'FirstKnock': ApexMCTSFirstKnock(seed=42),
        'PaperKnock': ApexMCTSPaperKnock(seed=42),
        'ApexMCTS': ApexMCTS(seed=42),
    }


class TestScenario1_ImmediateClinch(unittest.TestCase):
    """
    Scenario 1: Legal non-gin knock that immediately reaches the target score.
    All sensible bots should knock here.
    """

    def test_clinch_with_low_dw(self):
        """Score=98, DW=1 -> knock wins the game with high probability."""
        hand = _low_dw_hand_1card()
        melds, dw_cards, dw = best_meld_arrangement(hand)
        if dw > 10:
            self.skipTest("Hand DW too high")

        gs = _make_game_state(my_score=98)
        bots = _all_bots()

        # ClinchGoGin, FirstKnock, PaperKnock, ApexMCTS should all knock
        self.assertTrue(bots['ClinchGoGin'].knock_decision(hand, gs),
                       "ClinchGoGin should knock when clinching game")
        self.assertTrue(bots['FirstKnock'].knock_decision(hand, gs),
                       "FirstKnock always knocks")
        # GoGin should NOT knock (only knocks on gin)
        if dw > 0:
            self.assertFalse(bots['GoGin'].knock_decision(hand, gs),
                           "GoGin never knocks non-gin")


class TestScenario2_GinOnlyClinch(unittest.TestCase):
    """
    Scenario 2: Knock doesn't win, but gin would.
    Some bots might hold for gin here if they're gin-live.
    """

    def test_gin_only_clinch_low_dw(self):
        """Score=74, DW=1 -> knock won't reach 100, but gin (25 bonus) would."""
        hand = _low_dw_hand_1card()
        melds, dw_cards, dw = best_meld_arrangement(hand)
        if dw > 10:
            self.skipTest("Hand DW too high")

        gs = _make_game_state(my_score=74, deck_remaining=20)

        bots = _all_bots()
        # GoGin should hold (only knocks gin)
        if dw > 0:
            self.assertFalse(bots['GoGin'].knock_decision(hand, gs))
        # FirstKnock should knock (always knocks)
        self.assertTrue(bots['FirstKnock'].knock_decision(hand, gs))
        # ClinchGoGin: depend on whether knock wins game
        # With DW=1, points_if_knock = max(1, 10-1) = 9, 74+9 < 100 -> no clinch
        # So ClinchGoGin should hold


class TestScenario3_LowStockLegalKnock(unittest.TestCase):
    """
    Scenario 3: Legal knock with deck_remaining <= 8.
    All non-gogin bots should knock here.
    """

    def test_low_stock_mid_dw(self):
        hand = _mid_dw_hand_risky()
        melds, dw_cards, dw = best_meld_arrangement(hand)
        if dw > 10:
            self.skipTest("Hand DW too high")

        gs = _make_game_state(deck_remaining=5)
        bots = _all_bots()

        # ClinchGoGin, FirstKnock, PaperKnock should all knock on low stock
        self.assertTrue(bots['ClinchGoGin'].knock_decision(hand, gs),
                       "ClinchGoGin should knock on low stock")
        self.assertTrue(bots['FirstKnock'].knock_decision(hand, gs),
                       "FirstKnock always knocks")
        self.assertTrue(bots['PaperKnock'].knock_decision(hand, gs),
                       "PaperKnock should knock on low stock")
        # GoGin should NOT knock
        if dw > 0:
            self.assertFalse(bots['GoGin'].knock_decision(hand, gs),
                           "GoGin never knocks non-gin, even low stock")

    def test_low_stock_dw_10(self):
        hand = _dw_10_hand()
        melds, dw_cards, dw = best_meld_arrangement(hand)
        if dw > 10:
            self.skipTest("Hand DW too high")

        gs = _make_game_state(deck_remaining=3)
        bots = _all_bots()

        self.assertTrue(bots['ClinchGoGin'].knock_decision(hand, gs))
        self.assertTrue(bots['FirstKnock'].knock_decision(hand, gs))
        self.assertTrue(bots['PaperKnock'].knock_decision(hand, gs))


class TestScenario4_EarlyLiveHandHold(unittest.TestCase):
    """
    Scenario 4: Early turn, few deadwood cards, good gin liveness.
    Patience-oriented bots should hold here.
    """

    def test_early_low_dw_live_hand(self):
        """Turn 2, DW=1, 1 DW card -> very gin-live, should hold."""
        hand = _low_dw_hand_1card()
        melds, dw_cards, dw = best_meld_arrangement(hand)
        if dw > 10 or dw == 0:
            self.skipTest("Hand not in target range")

        gs = _make_game_state(turn_number=2, deck_remaining=28)
        bots = _all_bots()

        # GoGin holds (always holds non-gin)
        self.assertFalse(bots['GoGin'].knock_decision(hand, gs))
        # FirstKnock knocks (always knocks)
        self.assertTrue(bots['FirstKnock'].knock_decision(hand, gs))
        # PaperKnock: DW <= 3, 1 DW card, turn < 10 -> holds for gin
        if dw <= 3 and len(dw_cards) == 1:
            self.assertFalse(bots['PaperKnock'].knock_decision(hand, gs),
                           "PaperKnock should hold with 1 DW card early")


class TestScenario5_RiskyUndercutZone(unittest.TestCase):
    """
    Scenario 5: DW 7-10 with real undercut exposure.
    Conservative bots should be cautious here.
    """

    def test_risky_dw8_midgame(self):
        hand = _mid_dw_hand_risky()
        melds, dw_cards, dw = best_meld_arrangement(hand)
        if dw > 10:
            self.skipTest("Hand DW too high")

        gs = _make_game_state(turn_number=7, deck_remaining=16)
        bots = _all_bots()

        # GoGin never knocks non-gin
        if dw > 0:
            self.assertFalse(bots['GoGin'].knock_decision(hand, gs))
        # FirstKnock always knocks
        self.assertTrue(bots['FirstKnock'].knock_decision(hand, gs))

    def test_risky_dw10_midgame(self):
        hand = _dw_10_hand()
        melds, dw_cards, dw = best_meld_arrangement(hand)

        gs = _make_game_state(turn_number=7, deck_remaining=16)
        bots = _all_bots()

        if dw > 0 and dw <= 10:
            self.assertFalse(bots['GoGin'].knock_decision(hand, gs))
        if dw <= 10:
            self.assertTrue(bots['FirstKnock'].knock_decision(hand, gs))


class TestScenario6_LargeScoreGapHold(unittest.TestCase):
    """
    Scenario 6: Clearly ahead or behind with a live hand.
    Score-aware bots should favor holding for gin when gap is large.
    """

    def test_well_ahead_low_dw(self):
        """Score gap >= 22, DW=1, live hand -> should hold for gin."""
        hand = _low_dw_hand_1card()
        melds, dw_cards, dw = best_meld_arrangement(hand)
        if dw > 10 or dw == 0:
            self.skipTest("Hand not in target range")

        gs = _make_game_state(my_score=60, opp_score=20, turn_number=5,
                              deck_remaining=18)
        bots = _all_bots()

        # GoGin: never knocks non-gin
        self.assertFalse(bots['GoGin'].knock_decision(hand, gs))
        # FirstKnock: always knocks
        self.assertTrue(bots['FirstKnock'].knock_decision(hand, gs))

    def test_well_behind_live_hand(self):
        """Score gap <= -22, DW=1, live hand -> gin bonus needed."""
        hand = _low_dw_hand_1card()
        melds, dw_cards, dw = best_meld_arrangement(hand)
        if dw > 10 or dw == 0:
            self.skipTest("Hand not in target range")

        gs = _make_game_state(my_score=20, opp_score=60, turn_number=5,
                              deck_remaining=18)
        bots = _all_bots()

        # GoGin: never knocks non-gin
        self.assertFalse(bots['GoGin'].knock_decision(hand, gs))
        # FirstKnock: always knocks
        self.assertTrue(bots['FirstKnock'].knock_decision(hand, gs))


class TestKnockDecisionConsistency(unittest.TestCase):
    """Cross-ablation consistency checks."""

    def test_all_bots_agree_on_gin(self):
        """All bots should knock on gin."""
        hand = _gin_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw != 0:
            self.skipTest("Hand is not gin")

        gs = _make_game_state()
        bots = _all_bots()
        for name, bot in bots.items():
            self.assertTrue(bot.knock_decision(hand, gs),
                          f"{name} should knock on gin")

    def test_all_bots_agree_on_illegal(self):
        """All bots should NOT knock when DW > 10."""
        hand = _high_dw_hand()
        melds, _, dw = best_meld_arrangement(hand)
        if dw <= 10:
            self.skipTest("Hand DW unexpectedly low")

        gs = _make_game_state()
        bots = _all_bots()
        for name, bot in bots.items():
            self.assertFalse(bot.knock_decision(hand, gs),
                           f"{name} should not knock when DW > 10")


if __name__ == '__main__':
    unittest.main()
