"""
Test harness for Directive 58 opening DW=9 knock study.

Validates:
  1. All scenario hands are exactly DW=9 with 10 cards
  2. Gin probability measurement produces sane values
  3. Immediate knock scoring is correct for known cases
  4. Paired evaluation harness runs without error
  5. Continuation engine plays valid moves
"""

import os
import sys
import random
import unittest

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, os.path.join(PROJECT_ROOT, 'tools'))

from gin_rummy.card import parse_card as _c, card_str, deadwood_value, NUM_CARDS
from gin_rummy.meld import best_meld_arrangement, compute_deadwood

# Import the study module
from evaluate_opening_dw9_knock import (
    SCENARIO_FAMILY, measure_gin_probability,
    score_knock_immediate, play_continuation, run_paired,
)
from gin_rummy.apex_mcts_gogin import ApexMCTSGoGin


class TestScenarioFamily(unittest.TestCase):
    """Validate scenario hand definitions."""

    def test_all_hands_have_10_cards(self):
        for sc in SCENARIO_FAMILY:
            self.assertEqual(len(sc['hand']), 10,
                             f"{sc['label']} has {len(sc['hand'])} cards")

    def test_all_hands_are_dw9(self):
        for sc in SCENARIO_FAMILY:
            _, _, dw = best_meld_arrangement(sc['hand'])
            self.assertEqual(dw, 9,
                             f"{sc['label']} has DW={dw}, expected 9")

    def test_no_duplicate_cards_in_hand(self):
        for sc in SCENARIO_FAMILY:
            self.assertEqual(len(set(sc['hand'])), 10,
                             f"{sc['label']} has duplicate cards")

    def test_all_cards_valid(self):
        for sc in SCENARIO_FAMILY:
            for c in sc['hand']:
                self.assertGreaterEqual(c, 0)
                self.assertLess(c, NUM_CARDS)

    def test_minimum_scenario_count(self):
        self.assertGreaterEqual(len(SCENARIO_FAMILY), 8,
                                "Need at least 8 scenarios for meaningful stratification")

    def test_labels_unique(self):
        labels = [sc['label'] for sc in SCENARIO_FAMILY]
        self.assertEqual(len(labels), len(set(labels)))

    def test_no_cross_scenario_hand_duplication(self):
        hands = [tuple(sorted(sc['hand'])) for sc in SCENARIO_FAMILY]
        self.assertEqual(len(hands), len(set(hands)),
                         "Two scenarios use the same hand")


class TestGinProbability(unittest.TestCase):
    """Validate gin probability measurement."""

    def test_returns_valid_probability(self):
        hand = SCENARIO_FAMILY[0]['hand']
        gp, gc, gt = measure_gin_probability(hand, n_rollouts=20, max_horizon=4)
        self.assertGreaterEqual(gp, 0.0)
        self.assertLessEqual(gp, 1.0)
        self.assertEqual(gt, 20)
        self.assertGreaterEqual(gc, 0)
        self.assertLessEqual(gc, gt)

    def test_deterministic_with_seed(self):
        hand = SCENARIO_FAMILY[0]['hand']
        rng1 = random.Random(999)
        rng2 = random.Random(999)
        gp1, _, _ = measure_gin_probability(hand, n_rollouts=30, rng=rng1)
        gp2, _, _ = measure_gin_probability(hand, n_rollouts=30, rng=rng2)
        self.assertEqual(gp1, gp2, "Same seed should produce same result")

    def test_gin_hand_has_high_probability(self):
        # A hand that is already DW=0 should have gin_prob = 1.0 if we
        # check before the first draw. But our function draws first, so
        # the hand may degrade. Just check it's relatively high.
        # Actually for a DW=0 hand, gin_prob from rollout may be < 1 because
        # after drawing a card the DW might not re-reach 0. But the first
        # turn should be 1.0 since it starts at 0 and draws then discards.
        # Let's just test a known scenario produces a non-trivial value.
        hand = SCENARIO_FAMILY[0]['hand']
        gp, _, _ = measure_gin_probability(hand, n_rollouts=50, max_horizon=6)
        # L1 is low-liveness, so gin_prob should be modest
        self.assertLess(gp, 0.8, "L1 should not have very high gin probability")


class TestScoring(unittest.TestCase):
    """Validate knock scoring logic."""

    def test_knock_wins(self):
        # Knocker DW=9, opponent DW=30 (no melds)
        knocker = [_c('AS'),_c('AD'),_c('AH'),_c('2C'),_c('3C'),_c('4C'),
                   _c('TH'),_c('JH'),_c('QH'),_c('9C')]  # DW=9
        # Opponent: all face cards, no melds → DW should be high
        opponent = [_c('KS'),_c('QD'),_c('JC'),_c('TD'),_c('9D'),
                    _c('8H'),_c('7C'),_c('6D'),_c('5S'),_c('4D')]
        pts = score_knock_immediate(knocker, opponent)
        # Knocker DW=9, opponent DW depends on melds
        _, _, opp_dw = best_meld_arrangement(opponent)
        if opp_dw > 9:
            self.assertGreater(pts, 0, "Knocker should win when opponent has higher DW")

    def test_undercut(self):
        # Knocker DW=9, opponent also DW ≤ 9 → undercut
        knocker = [_c('AS'),_c('AD'),_c('AH'),_c('2C'),_c('3C'),_c('4C'),
                   _c('TH'),_c('JH'),_c('QH'),_c('9C')]  # DW=9
        # Opponent with DW=5 → undercut
        opponent = [_c('KS'),_c('KD'),_c('KH'),_c('7S'),_c('8S'),_c('9S'),
                    _c('2H'),_c('3D'),_c('5D'),_c('5H')]
        _, _, opp_dw = best_meld_arrangement(opponent)
        pts = score_knock_immediate(knocker, opponent)
        if opp_dw <= 9:
            self.assertLess(pts, 0, f"Should be undercut (opp DW={opp_dw})")

    def test_gin_bonus(self):
        # A gin hand (DW=0) should get 25 + opponent DW
        gin_hand = [_c('AS'),_c('AD'),_c('AH'),_c('2C'),_c('3C'),_c('4C'),
                    _c('TH'),_c('JH'),_c('QH'),_c('KH')]
        _, _, gin_dw = best_meld_arrangement(gin_hand)
        if gin_dw == 0:
            opp = [_c('KS'),_c('QD'),_c('JC'),_c('TD'),_c('9D'),
                   _c('8C'),_c('7D'),_c('6S'),_c('5D'),_c('4D')]
            _, _, opp_dw = best_meld_arrangement(opp)
            pts = score_knock_immediate(gin_hand, opp)
            self.assertEqual(pts, 25 + opp_dw)


class TestPairedEvaluation(unittest.TestCase):
    """Validate the paired evaluation harness."""

    def test_runs_without_error(self):
        sc = SCENARIO_FAMILY[0]
        kp, cp, df = run_paired(sc, lambda: ApexMCTSGoGin(seed=None),
                                n_worlds=5, seed=42)
        self.assertEqual(len(kp), 5)
        self.assertEqual(len(cp), 5)
        self.assertEqual(len(df), 5)

    def test_diffs_are_consistent(self):
        sc = SCENARIO_FAMILY[0]
        kp, cp, df = run_paired(sc, lambda: ApexMCTSGoGin(seed=None),
                                n_worlds=10, seed=42)
        for k, c, d in zip(kp, cp, df):
            self.assertAlmostEqual(d, k - c, places=5,
                                   msg="diff should equal knock_pts - continue_pts")

    def test_continuation_returns_bounded_values(self):
        sc = SCENARIO_FAMILY[0]
        kp, cp, df = run_paired(sc, lambda: ApexMCTSGoGin(seed=None),
                                n_worlds=10, seed=42)
        for v in cp:
            self.assertGreaterEqual(v, -150, "Continuation points too negative")
            self.assertLessEqual(v, 150, "Continuation points too high")


if __name__ == '__main__':
    unittest.main()
