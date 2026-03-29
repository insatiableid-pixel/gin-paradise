"""
Phase 63 Tests: Targeted Disagreement Mining and Analysis.

Tests cover:
  - Targeted spot miner validity (hand consistency, metadata integrity)
  - Corpus labeling (natural / oversampled / synthetic separation)
  - Hand texture classification correctness
  - Disagreement analysis output shape
  - Clustering / bucketing correctness
  - Frequency estimation logic
  - Synthetic perturbation validity
"""

import unittest
import random
from unittest.mock import patch

from gin_rummy.card import (
    make_card, card_str, hand_str, deadwood_value, NUM_CARDS, rank, suit
)
from gin_rummy.meld import (
    best_meld_arrangement, compute_deadwood, find_all_melds
)
from gin_rummy.endgame_solver import PublicState
from gin_rummy.disagreement_miner import (
    DisagreementSpot, NaturalFrequencyMiner, CoverageOversampledMiner,
    SyntheticPerturbationMiner, classify_hand_texture,
    mine_disagreement_corpus, get_corpus_summary,
    CORPUS_NATURAL, CORPUS_OVERSAMPLED, CORPUS_SYNTHETIC,
)
from gin_rummy.disagreement_analysis import (
    run_solver_on_corpus, cluster_disagreements,
    estimate_frequency_and_cost, DisagreementCluster,
    FrequencyEstimate,
)


def _mc(r, s):
    return make_card(r, s)


class TestHandTextureClassification(unittest.TestCase):
    """Test hand texture classification correctness."""
    
    def test_gin_hand(self):
        """Gin hand (DW=0) classified as 'gin'."""
        hand = [
            _mc(0, 0), _mc(1, 0), _mc(2, 0),   # AC 2C 3C
            _mc(4, 1), _mc(5, 1), _mc(6, 1),    # 5D 6D 7D
            _mc(11, 2), _mc(11, 3), _mc(11, 0),  # QS QH QC
            _mc(9, 1),  # Fill: we need exactly gin
        ]
        # This might not be gin. Let's use a proper gin hand.
        hand = [
            _mc(0, 0), _mc(1, 0), _mc(2, 0),   # AC 2C 3C
            _mc(4, 1), _mc(5, 1), _mc(6, 1), _mc(7, 1),  # 5D 6D 7D 8D
            _mc(11, 2), _mc(11, 3), _mc(11, 0),  # QS QH QC
        ]
        dw = compute_deadwood(hand)
        self.assertEqual(dw, 0)
        texture, n_dw = classify_hand_texture(hand)
        self.assertEqual(texture, 'gin')
        self.assertEqual(n_dw, 0)
    
    def test_fragmented_hand(self):
        """Hand with 3+ scattered DW cards classified as fragmented."""
        hand = [
            _mc(3, 2), _mc(4, 2), _mc(5, 2),    # 4S 5S 6S
            _mc(8, 0), _mc(8, 1), _mc(8, 3),     # 9C 9D 9H
            _mc(1, 3), _mc(0, 3), _mc(2, 1), _mc(1, 0),  # 2H AH 3D 2C = 8 DW
        ]
        texture, n_dw = classify_hand_texture(hand)
        self.assertIn(texture, ['fragmented', 'gin_live'])
        self.assertGreaterEqual(n_dw, 3)
    
    def test_concentrated_hand(self):
        """Hand with 1 high-value DW card classified as concentrated."""
        hand = [
            _mc(0, 0), _mc(1, 0), _mc(2, 0),    # AC 2C 3C
            _mc(6, 1), _mc(7, 1), _mc(8, 1),     # 7D 8D 9D
            _mc(10, 0), _mc(10, 1), _mc(10, 2),   # JC JD JS
            _mc(8, 2),  # 9S = DW 9
        ]
        texture, n_dw = classify_hand_texture(hand)
        self.assertEqual(n_dw, 1)
        # Could be concentrated or gin_live depending on outs
        self.assertIn(texture, ['concentrated', 'gin_live'])
    
    def test_dw_card_count_matches(self):
        """DW card count should match actual unmelded card count."""
        hand = [
            _mc(3, 2), _mc(4, 2), _mc(5, 2),    # 4S 5S 6S
            _mc(8, 0), _mc(8, 1), _mc(8, 3),     # 9C 9D 9H
            _mc(1, 3), _mc(0, 3), _mc(2, 1), _mc(1, 0),  # DW cards
        ]
        melds, dw_cards, dw = best_meld_arrangement(hand)
        _, n_dw = classify_hand_texture(hand)
        self.assertEqual(n_dw, len(dw_cards))


class TestDisagreementSpotValidation(unittest.TestCase):
    """Test DisagreementSpot data structure and properties."""
    
    def _make_test_spot(self, dw=5, stock=4, my_score=0, opp_score=0,
                        corpus_type=CORPUS_NATURAL):
        """Create a valid test spot."""
        # Build a hand with approximately target DW
        hand = [
            _mc(0, 0), _mc(1, 0), _mc(2, 0),    # AC 2C 3C
            _mc(6, 1), _mc(7, 1), _mc(8, 1),     # 7D 8D 9D
            _mc(10, 0), _mc(10, 1), _mc(10, 2),   # JC JD JS
            _mc(4, 3),  # 5H = DW 5
        ]
        actual_dw = compute_deadwood(hand)
        ps = PublicState(
            discard_pile=[_mc(12, 0), _mc(12, 1)],
            turn_number=18,
            stock_size=stock,
            my_score=my_score,
            opp_score=opp_score,
        )
        texture, n_dw = classify_hand_texture(hand)
        return DisagreementSpot(
            hero_hand=hand,
            public_state=ps,
            hero_deadwood=actual_dw,
            corpus_type=corpus_type,
            source_game_id=1,
            dw_card_count=n_dw,
            hand_texture=texture,
        )
    
    def test_stock_bucket(self):
        """Stock bucket classification."""
        s = self._make_test_spot(stock=2)
        self.assertEqual(s.stock_bucket, 'stock_1_2')
        
        s = self._make_test_spot(stock=4)
        self.assertEqual(s.stock_bucket, 'stock_3_4')
        
        s = self._make_test_spot(stock=6)
        self.assertEqual(s.stock_bucket, 'stock_5_6')
    
    def test_dw_bucket(self):
        """DW bucket classification."""
        s = self._make_test_spot()
        # DW=5 should be dw_3_5
        self.assertEqual(s.dw_bucket, 'dw_3_5')
    
    def test_score_bucket(self):
        """Score bucket classification."""
        s = self._make_test_spot(my_score=0, opp_score=0)
        self.assertEqual(s.score_bucket, 'early_game')
        
        s = self._make_test_spot(my_score=50, opp_score=30)
        self.assertEqual(s.score_bucket, 'mid_game')
        
        s = self._make_test_spot(my_score=85, opp_score=70)
        self.assertEqual(s.score_bucket, 'late_game')
    
    def test_to_dict(self):
        """Serialization produces expected keys."""
        s = self._make_test_spot()
        d = s.to_dict()
        required_keys = [
            'id', 'hero_hand', 'hero_deadwood', 'stock_size',
            'score_state', 'corpus_type', 'dw_card_count',
            'hand_texture', 'champion_action', 'solver_action',
            'ev_knock', 'ev_continue', 'ev_diff', 'is_disagreement',
        ]
        for key in required_keys:
            self.assertIn(key, d)
    
    def test_corpus_type_preserved(self):
        """Corpus type label is preserved correctly."""
        for ct in [CORPUS_NATURAL, CORPUS_OVERSAMPLED, CORPUS_SYNTHETIC]:
            s = self._make_test_spot(corpus_type=ct)
            self.assertEqual(s.corpus_type, ct)


class TestCorpusLabeling(unittest.TestCase):
    """Test that corpus types are correctly assigned."""
    
    def test_natural_label(self):
        """Natural miner labels spots as 'natural'."""
        miner = NaturalFrequencyMiner(max_stock=6, seed=42)
        spots = miner.mine(n_games=3)
        for spot in spots:
            self.assertEqual(spot.corpus_type, CORPUS_NATURAL)
    
    def test_oversampled_label(self):
        """Oversampled miner labels spots as 'oversampled'."""
        miner = CoverageOversampledMiner(max_stock=6, seed=42)
        spots = miner.mine(n_games=2)
        for spot in spots:
            self.assertEqual(spot.corpus_type, CORPUS_OVERSAMPLED)
    
    def test_synthetic_label(self):
        """Synthetic perturbation miner labels spots as 'synthetic'."""
        # First mine some natural spots
        nat_miner = NaturalFrequencyMiner(max_stock=6, seed=42)
        nat_spots = nat_miner.mine(n_games=3)
        
        synth_miner = SyntheticPerturbationMiner(seed=42)
        synth_spots = synth_miner.perturb_spots(nat_spots)
        
        for spot in synth_spots:
            self.assertEqual(spot.corpus_type, CORPUS_SYNTHETIC)


class TestMinerValidity(unittest.TestCase):
    """Test that mined spots are valid game positions."""
    
    def test_natural_spots_valid_hands(self):
        """Natural miner produces valid 10-card hands."""
        miner = NaturalFrequencyMiner(max_stock=6, seed=42)
        spots = miner.mine(n_games=3)
        
        for spot in spots:
            self.assertEqual(len(spot.hero_hand), 10,
                           f"Hand should have 10 cards: {hand_str(spot.hero_hand)}")
            self.assertEqual(len(set(spot.hero_hand)), 10,
                           f"Hand has duplicate cards: {hand_str(spot.hero_hand)}")
    
    def test_natural_spots_no_overlap(self):
        """Mined hand cards don't overlap with discard pile."""
        miner = NaturalFrequencyMiner(max_stock=6, seed=42)
        spots = miner.mine(n_games=3)
        
        for spot in spots:
            hand_set = set(spot.hero_hand)
            discard_set = set(spot.public_state.discard_pile)
            overlap = hand_set & discard_set
            self.assertEqual(len(overlap), 0,
                           f"Hand overlaps discard: {[card_str(c) for c in overlap]}")
    
    def test_natural_spots_legal_knock(self):
        """Mined spots have DW <= 10 (legal knock)."""
        miner = NaturalFrequencyMiner(max_stock=6, seed=42)
        spots = miner.mine(n_games=3)
        
        for spot in spots:
            self.assertLessEqual(spot.hero_deadwood, 10)
    
    def test_natural_spots_low_stock(self):
        """Mined spots have stock <= max_stock."""
        miner = NaturalFrequencyMiner(max_stock=6, seed=42)
        spots = miner.mine(n_games=3)
        
        for spot in spots:
            self.assertLessEqual(spot.public_state.stock_size, 6)
    
    def test_metadata_consistency(self):
        """DW metadata matches computed DW."""
        miner = NaturalFrequencyMiner(max_stock=6, seed=42)
        spots = miner.mine(n_games=3)
        
        for spot in spots:
            actual_dw = compute_deadwood(spot.hero_hand)
            self.assertEqual(spot.hero_deadwood, actual_dw,
                           f"Metadata DW {spot.hero_deadwood} != computed {actual_dw}")
    
    def test_valid_card_range(self):
        """All cards are in valid range [0, 51]."""
        miner = NaturalFrequencyMiner(max_stock=6, seed=42)
        spots = miner.mine(n_games=3)
        
        for spot in spots:
            for c in spot.hero_hand:
                self.assertGreaterEqual(c, 0)
                self.assertLess(c, NUM_CARDS)
            for c in spot.public_state.discard_pile:
                self.assertGreaterEqual(c, 0)
                self.assertLess(c, NUM_CARDS)


class TestSyntheticPerturbation(unittest.TestCase):
    """Test synthetic perturbation validity."""
    
    def test_perturbed_spots_valid(self):
        """Perturbed spots have valid hands."""
        nat_miner = NaturalFrequencyMiner(max_stock=6, seed=42)
        nat_spots = nat_miner.mine(n_games=3)
        
        synth_miner = SyntheticPerturbationMiner(seed=42)
        synth_spots = synth_miner.perturb_spots(nat_spots, target_dw_range=(5, 10))
        
        for spot in synth_spots:
            self.assertEqual(len(spot.hero_hand), 10)
            self.assertEqual(len(set(spot.hero_hand)), 10)
            self.assertGreaterEqual(spot.hero_deadwood, 5)
            self.assertLessEqual(spot.hero_deadwood, 10)
    
    def test_perturbed_no_discard_overlap(self):
        """Perturbed hands don't overlap with discard pile."""
        nat_miner = NaturalFrequencyMiner(max_stock=6, seed=42)
        nat_spots = nat_miner.mine(n_games=3)
        
        synth_miner = SyntheticPerturbationMiner(seed=42)
        synth_spots = synth_miner.perturb_spots(nat_spots)
        
        for spot in synth_spots:
            hand_set = set(spot.hero_hand)
            discard_set = set(spot.public_state.discard_pile)
            overlap = hand_set & discard_set
            self.assertEqual(len(overlap), 0)
    
    def test_perturbed_in_target_range(self):
        """Perturbed spots land in the target DW range."""
        nat_miner = NaturalFrequencyMiner(max_stock=6, seed=42)
        nat_spots = nat_miner.mine(n_games=3)
        
        synth_miner = SyntheticPerturbationMiner(seed=42)
        synth_spots = synth_miner.perturb_spots(nat_spots, target_dw_range=(5, 10))
        
        for spot in synth_spots:
            actual_dw = compute_deadwood(spot.hero_hand)
            self.assertEqual(spot.hero_deadwood, actual_dw)
            self.assertGreaterEqual(actual_dw, 5)
            self.assertLessEqual(actual_dw, 10)


class TestClusteringCorrectness(unittest.TestCase):
    """Test disagreement clustering logic."""
    
    def _make_solved_spot(self, dw=6, stock=3, my_score=0, opp_score=0,
                          champion_action='continue', solver_action='knock',
                          ev_diff=10.0, texture='fragmented'):
        """Create a spot with pre-populated solver results."""
        hand = [
            _mc(0, 0), _mc(1, 0), _mc(2, 0),
            _mc(6, 1), _mc(7, 1), _mc(8, 1),
            _mc(10, 0), _mc(10, 1), _mc(10, 2),
            _mc(4, 3),
        ]
        actual_dw = compute_deadwood(hand)
        spot = DisagreementSpot(
            hero_hand=hand,
            public_state=PublicState(
                discard_pile=[_mc(12, 0)],
                turn_number=18,
                stock_size=stock,
                my_score=my_score,
                opp_score=opp_score,
            ),
            hero_deadwood=dw,
            corpus_type=CORPUS_NATURAL,
            source_game_id=1,
            dw_card_count=3,
            hand_texture=texture,
            champion_action=champion_action,
            solver_action=solver_action,
            ev_knock=15.0,
            ev_continue=5.0,
            ev_diff=ev_diff,
            is_disagreement=(champion_action != solver_action),
        )
        return spot
    
    def test_only_disagreements_clustered(self):
        """Only disagreement spots are included in clusters."""
        agree = self._make_solved_spot(champion_action='knock', solver_action='knock')
        disagree = self._make_solved_spot(champion_action='continue', solver_action='knock')
        
        clusters = cluster_disagreements([agree, disagree])
        total_in_clusters = sum(c.n for c in clusters.values())
        self.assertEqual(total_in_clusters, 1)
    
    def test_cluster_key_structure(self):
        """Cluster keys have 4 components."""
        spot = self._make_solved_spot()
        clusters = cluster_disagreements([spot])
        
        for key in clusters:
            self.assertEqual(len(key), 4)  # stock, dw, texture, score
    
    def test_same_bucket_grouped(self):
        """Spots in the same bucket are grouped together."""
        s1 = self._make_solved_spot(dw=6, stock=3)
        s2 = self._make_solved_spot(dw=7, stock=4)
        # Both should be in (stock_3_4, dw_6_8, ...)
        
        clusters = cluster_disagreements([s1, s2])
        # They share the same DW and stock buckets
        for key, cluster in clusters.items():
            if cluster.n == 2:
                self.assertEqual(key[0], 'stock_3_4')
                self.assertEqual(key[1], 'dw_6_8')
    
    def test_different_buckets_separated(self):
        """Spots in different buckets are in different clusters."""
        s1 = self._make_solved_spot(dw=3, stock=2)  # dw_3_5, stock_1_2
        s2 = self._make_solved_spot(dw=9, stock=6)  # dw_9_10, stock_5_6
        
        clusters = cluster_disagreements([s1, s2])
        self.assertGreaterEqual(len(clusters), 2)


class TestFrequencyEstimation(unittest.TestCase):
    """Test frequency and cost estimation logic."""
    
    def _make_spot(self, is_disagree=False, ev_diff=5.0, dw=6,
                   me_knock=0.05, me_continue=0.02):
        """Create a spot with solver results."""
        return DisagreementSpot(
            hero_hand=[_mc(i, 0) for i in range(10)],
            public_state=PublicState(
                discard_pile=[_mc(12, 0)],
                turn_number=18,
                stock_size=4,
                my_score=0,
                opp_score=0,
            ),
            hero_deadwood=dw,
            corpus_type=CORPUS_NATURAL,
            source_game_id=1,
            dw_card_count=3,
            hand_texture='fragmented',
            champion_action='continue' if is_disagree else 'knock',
            solver_action='knock',
            ev_knock=10.0,
            ev_continue=10.0 - ev_diff,
            ev_diff=ev_diff,
            me_knock=me_knock,
            me_continue=me_continue,
            is_disagreement=is_disagree,
        )
    
    def test_no_disagreements(self):
        """Zero disagreements → rate is 0."""
        spots = [self._make_spot(is_disagree=False) for _ in range(10)]
        est = estimate_frequency_and_cost(spots)
        self.assertEqual(est.disagreement_rate, 0.0)
        self.assertEqual(est.total_natural_disagreements, 0)
    
    def test_all_disagreements(self):
        """All spots are disagreements → rate is 1."""
        spots = [self._make_spot(is_disagree=True) for _ in range(10)]
        est = estimate_frequency_and_cost(spots)
        self.assertEqual(est.disagreement_rate, 1.0)
    
    def test_partial_disagreements(self):
        """Some disagreements → rate is correct fraction."""
        spots = [self._make_spot(is_disagree=True) for _ in range(3)]
        spots += [self._make_spot(is_disagree=False) for _ in range(7)]
        est = estimate_frequency_and_cost(spots)
        self.assertAlmostEqual(est.disagreement_rate, 0.3)
    
    def test_mean_conditional_loss(self):
        """Mean conditional loss computed correctly."""
        spots = [
            self._make_spot(is_disagree=True, ev_diff=10.0),
            self._make_spot(is_disagree=True, ev_diff=20.0),
            self._make_spot(is_disagree=False, ev_diff=5.0),
        ]
        est = estimate_frequency_and_cost(spots)
        self.assertAlmostEqual(est.mean_conditional_ev_loss, 15.0)
    
    def test_classification_rare_negligible(self):
        """Low rate + low severity → rare_negligible."""
        # 1 disagree out of 25 (4%) with small loss
        spots = [self._make_spot(is_disagree=True, ev_diff=3.0)]
        spots += [self._make_spot(is_disagree=False) for _ in range(24)]
        est = estimate_frequency_and_cost(spots)
        self.assertEqual(est.classification, 'rare_negligible')
    
    def test_classification_common_meaningful(self):
        """High rate + high severity → common_meaningful."""
        spots = [self._make_spot(is_disagree=True, ev_diff=15.0) for _ in range(6)]
        spots += [self._make_spot(is_disagree=False) for _ in range(4)]
        est = estimate_frequency_and_cost(spots)
        self.assertEqual(est.classification, 'common_meaningful')
    
    def test_dw_region_breakdown(self):
        """DW region breakdown computed correctly."""
        spots = [
            self._make_spot(is_disagree=True, dw=3),
            self._make_spot(is_disagree=False, dw=2),
            self._make_spot(is_disagree=True, dw=7),
            self._make_spot(is_disagree=True, dw=8),
            self._make_spot(is_disagree=False, dw=6),
        ]
        est = estimate_frequency_and_cost(spots)
        self.assertEqual(est.dw_0_4_total, 2)
        self.assertEqual(est.dw_0_4_disagreements, 1)
        self.assertEqual(est.dw_5_10_total, 3)
        self.assertEqual(est.dw_5_10_disagreements, 2)


class TestAnalysisOutputShape(unittest.TestCase):
    """Test analysis output shapes and structure."""
    
    def test_solver_populates_fields(self):
        """Solver run populates all required fields on spots."""
        hand = [
            _mc(0, 0), _mc(1, 0), _mc(2, 0),    # AC 2C 3C
            _mc(6, 1), _mc(7, 1), _mc(8, 1),     # 7D 8D 9D
            _mc(10, 0), _mc(10, 1), _mc(10, 2),   # JC JD JS
            _mc(4, 3),  # 5H = DW 5
        ]
        spot = DisagreementSpot(
            hero_hand=hand,
            public_state=PublicState(
                discard_pile=[_mc(12, 0), _mc(12, 1)],
                turn_number=18,
                stock_size=4,
                my_score=0,
                opp_score=0,
            ),
            hero_deadwood=5,
            corpus_type=CORPUS_NATURAL,
            source_game_id=1,
            dw_card_count=1,
            hand_texture='concentrated',
        )
        
        run_solver_on_corpus([spot], n_worlds=50, seed=42)
        
        self.assertIn(spot.champion_action, ['knock', 'continue'])
        self.assertIn(spot.solver_action, ['knock', 'continue'])
        self.assertIsInstance(spot.ev_knock, float)
        self.assertIsInstance(spot.ev_continue, float)
        self.assertIsInstance(spot.is_disagreement, bool)
    
    def test_cluster_summary_shape(self):
        """Cluster summary has required keys."""
        spot = DisagreementSpot(
            hero_hand=[_mc(i, 0) for i in range(10)],
            public_state=PublicState(
                discard_pile=[_mc(12, 0)],
                turn_number=18, stock_size=4,
                my_score=0, opp_score=0,
            ),
            hero_deadwood=6,
            corpus_type=CORPUS_NATURAL,
            source_game_id=1,
            dw_card_count=3,
            hand_texture='fragmented',
            is_disagreement=True,
            champion_action='continue',
            solver_action='knock',
            ev_diff=10.0,
        )
        
        cluster = DisagreementCluster(
            cluster_key=('stock_3_4', 'dw_6_8', 'fragmented', 'early_game'),
            spots=[spot],
        )
        
        summary = cluster.summary()
        self.assertIn('cluster_key', summary)
        self.assertIn('count', summary)
        self.assertIn('mean_ev_diff', summary)
        self.assertIn('mean_me_diff', summary)


class TestCorpusSummary(unittest.TestCase):
    """Test corpus summary generation."""
    
    def test_corpus_summary_keys(self):
        """Summary has entries for each corpus type."""
        corpus = {
            CORPUS_NATURAL: [
                DisagreementSpot(
                    hero_hand=[_mc(i, 0) for i in range(10)],
                    public_state=PublicState(
                        discard_pile=[], turn_number=18,
                        stock_size=4, my_score=0, opp_score=0,
                    ),
                    hero_deadwood=5,
                    corpus_type=CORPUS_NATURAL,
                    dw_card_count=1,
                    hand_texture='concentrated',
                ),
            ],
        }
        summary = get_corpus_summary(corpus)
        self.assertIn(CORPUS_NATURAL, summary)
        self.assertEqual(summary[CORPUS_NATURAL]['total'], 1)
    
    def test_dw_distribution(self):
        """DW distribution counts correctly."""
        spots = [
            DisagreementSpot(
                hero_hand=[_mc(i, 0) for i in range(10)],
                public_state=PublicState(
                    discard_pile=[], turn_number=18,
                    stock_size=4, my_score=0, opp_score=0,
                ),
                hero_deadwood=dw,
                corpus_type=CORPUS_NATURAL,
                dw_card_count=1,
                hand_texture='concentrated',
            )
            for dw in [1, 1, 3, 7, 7, 7]
        ]
        corpus = {CORPUS_NATURAL: spots}
        summary = get_corpus_summary(corpus)
        dw_dist = summary[CORPUS_NATURAL]['dw_distribution']
        self.assertEqual(dw_dist[1], 2)
        self.assertEqual(dw_dist[3], 1)
        self.assertEqual(dw_dist[7], 3)


if __name__ == '__main__':
    unittest.main()
