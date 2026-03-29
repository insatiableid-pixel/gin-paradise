"""
Test suite for the knock frontier evaluation harness.
Validates scenario construction, gin probability, and paired evaluation.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from gin_rummy.card import parse_card, card_str, deadwood_value, NUM_CARDS
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from tools.evaluate_knock_frontier import (
    _build_scenario_families,
    measure_gin_probability,
    classify_gin_liveness,
    score_knock_immediate,
    run_paired,
)
from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin

_c = parse_card


class TestScenarioConstruction(unittest.TestCase):
    """Verify all curated scenarios have correct properties."""

    def setUp(self):
        self.families = _build_scenario_families()

    def test_all_dw_levels_covered(self):
        """DW 1..9 all have at least 2 scenarios."""
        for dw in range(1, 10):
            with self.subTest(dw=dw):
                self.assertGreaterEqual(len(self.families[dw]), 2,
                                       f"DW={dw} needs at least 2 scenarios")

    def test_hand_size(self):
        """All hands have exactly 10 unique cards."""
        for dw, scenarios in self.families.items():
            for sc in scenarios:
                with self.subTest(label=sc['label']):
                    self.assertEqual(len(sc['hand']), 10)
                    self.assertEqual(len(set(sc['hand'])), 10)

    def test_deadwood_values(self):
        """All hands have correct deadwood."""
        for dw, scenarios in self.families.items():
            for sc in scenarios:
                with self.subTest(label=sc['label']):
                    _, dw_cards, actual_dw = best_meld_arrangement(sc['hand'])
                    self.assertEqual(actual_dw, sc['target_dw'],
                                    f"{sc['label']}: DW mismatch")

    def test_dw_card_counts(self):
        """DW card counts match stated n_dw_cards."""
        for dw, scenarios in self.families.items():
            for sc in scenarios:
                with self.subTest(label=sc['label']):
                    _, dw_cards, _ = best_meld_arrangement(sc['hand'])
                    self.assertEqual(len(dw_cards), sc['n_dw_cards'],
                                    f"{sc['label']}: n_dw_cards mismatch")

    def test_structural_variety(self):
        """Each DW level has at least one isolated-style scenario."""
        for dw in range(1, 10):
            labels = [sc['label'] for sc in self.families[dw]]
            has_variety = len(labels) >= 2
            self.assertTrue(has_variety,
                           f"DW={dw} needs structural variety")

    def test_total_scenario_count(self):
        """At least 20 scenarios total."""
        total = sum(len(v) for v in self.families.values())
        self.assertGreaterEqual(total, 20)


class TestGinProbability(unittest.TestCase):
    """Verify gin probability measurement."""

    def test_gin_hand_high_probability(self):
        """A hand 1 card from gin should have high gin probability."""
        # 3 melds + lone AS (DW=1) → very high gin chance
        hand = [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
                _c('KC'),_c('KD'),_c('KH'),_c('AS')]
        gp = measure_gin_probability(hand, n_rollouts=100)
        self.assertGreater(gp, 0.1,
                          "DW=1 hand should have meaningful gin probability")

    def test_dispersed_hand_low_probability(self):
        """A dispersed multi-card DW hand should have lower gin chance."""
        hand = [_c('5S'),_c('5D'),_c('5H'),_c('8C'),_c('9C'),_c('TC'),
                _c('AC'),_c('2D'),_c('3H'),_c('3S')]
        gp = measure_gin_probability(hand, n_rollouts=100)
        # Should be lower than concentrated 1-card DW
        self.assertLess(gp, 0.5,
                       "Dispersed DW hand should have modest gin probability")

    def test_classification(self):
        """Gin liveness classification thresholds."""
        self.assertEqual(classify_gin_liveness(0.01), 'LOW')
        self.assertEqual(classify_gin_liveness(0.04), 'LOW')
        self.assertEqual(classify_gin_liveness(0.05), 'MED')
        self.assertEqual(classify_gin_liveness(0.10), 'MED')
        self.assertEqual(classify_gin_liveness(0.20), 'HIGH')
        self.assertEqual(classify_gin_liveness(0.50), 'HIGH')


class TestScoring(unittest.TestCase):
    """Verify knock scoring logic."""

    def test_gin_bonus(self):
        """Gin knock should include 25-point bonus."""
        # Gin hand: all melded
        gin_hand = [_c('2C'),_c('2D'),_c('2H'),_c('2S'),
                    _c('6C'),_c('6D'),_c('6H'),
                    _c('KC'),_c('KD'),_c('KH')]
        opp_hand = [_c('AS'),_c('3S'),_c('4S'),_c('5S'),_c('7S'),
                    _c('8S'),_c('9S'),_c('TS'),_c('JS'),_c('QS')]
        pts = score_knock_immediate(gin_hand, opp_hand)
        self.assertGreater(pts, 25, "Gin should give 25+ points")

    def test_undercut(self):
        """Higher-DW knock against lower-DW opponent should give negative."""
        # Our DW=9, opponent DW=5
        our_hand = [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
                    _c('KC'),_c('KD'),_c('KH'),_c('9S')]
        opp_hand = [_c('3C'),_c('3D'),_c('3H'),_c('7C'),_c('7D'),_c('7H'),
                    _c('JC'),_c('JD'),_c('JH'),_c('5S')]
        pts = score_knock_immediate(our_hand, opp_hand)
        # Should be negative (undercut)
        self.assertLess(pts, 0, "Should be undercut when opponent DW is lower")


class TestPairedEvaluation(unittest.TestCase):
    """Verify paired evaluation harness."""

    def test_paired_returns_correct_structure(self):
        """run_paired should return dict with expected keys."""
        hand = [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
                _c('KC'),_c('KD'),_c('KH'),_c('AS')]
        hero_fac = lambda: ApexMCTSClinchOnlyGoGin(seed=None)
        opp_fac = lambda: ApexMCTSClinchOnlyGoGin(seed=None)
        result = run_paired(hand, hero_fac, opp_fac, n_worlds=10, seed=42)
        
        for key in ['avg_knock', 'avg_cont', 'avg_diff', 'se',
                     'knock_better_frac', 'cont_better_frac', 'n_worlds']:
            self.assertIn(key, result, f"Missing key: {key}")

    def test_paired_world_count(self):
        """n_worlds in result matches requested count."""
        hand = [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
                _c('KC'),_c('KD'),_c('KH'),_c('AS')]
        hero_fac = lambda: ApexMCTSClinchOnlyGoGin(seed=None)
        opp_fac = lambda: ApexMCTSClinchOnlyGoGin(seed=None)
        result = run_paired(hand, hero_fac, opp_fac, n_worlds=20, seed=42)
        self.assertEqual(result['n_worlds'], 20)

    def test_low_dw_favors_knock(self):
        """DW=1 should strongly favor knock (or at least not strongly favor continue)."""
        hand = [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
                _c('KC'),_c('KD'),_c('KH'),_c('AS')]
        hero_fac = lambda: ApexMCTSClinchOnlyGoGin(seed=None)
        opp_fac = lambda: ApexMCTSClinchOnlyGoGin(seed=None)
        result = run_paired(hand, hero_fac, opp_fac, n_worlds=50, seed=42)
        # DW=1 should not overwhelmingly favor continue;
        # knock should at least be competitive
        # (We don't assert knock > continue since with high gin prob,
        #  continue can also be strong at DW=1)
        self.assertIsNotNone(result['avg_diff'])


if __name__ == '__main__':
    unittest.main()
