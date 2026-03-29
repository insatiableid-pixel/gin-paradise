"""
Tests for the Phase 61 Endgame Solver and Canonical Spots.

Covers:
  - Spot loading and validation
  - Hidden-world generation consistency
  - Solver determinism / reproducibility
  - Action comparison output shape
  - Sanity checks on known dominant-action scenarios
"""

import pytest
import random
from gin_rummy.card import make_card, card_str, hand_str
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.endgame_solver import (
    PublicState, HandOutcome, OutcomeDistribution, SolverResult,
    generate_hidden_worlds, evaluate_knock_now, simulate_continuation,
    solve_spot, what_would_champion_do, match_equity_delta,
)
from gin_rummy.canonical_spots import (
    CANONICAL_SPOTS, get_spot, list_spot_ids, get_solvable_spots,
    validate_spot, validate_all_spots,
)


# ── Spot Loading & Validation ─────────────────────────────────────────

class TestSpotLoading:
    """Test that canonical spots load correctly."""

    def test_all_spots_load(self):
        """All spots should load without error."""
        assert len(CANONICAL_SPOTS) >= 7, "Should have at least 7 canonical spots"

    def test_list_spot_ids(self):
        """Should return a list of string IDs."""
        ids = list_spot_ids()
        assert len(ids) == len(CANONICAL_SPOTS)
        for sid in ids:
            assert isinstance(sid, str)

    def test_get_spot_by_id(self):
        """Should retrieve correct spot by ID."""
        spot = get_spot('gin_trivial_dominant')
        assert spot['id'] == 'gin_trivial_dominant'
        assert spot['expected_dominant'] == 'knock'

    def test_get_nonexistent_spot_raises(self):
        """Should raise KeyError for unknown spot ID."""
        with pytest.raises(KeyError):
            get_spot('nonexistent_spot_id')

    def test_all_spots_valid(self):
        """All spots should pass internal validation."""
        for spot in CANONICAL_SPOTS:
            # Check hand size
            assert len(spot['hero_hand']) == 10, f"Spot {spot['id']} has wrong hand size"
            # Check no duplicates
            assert len(set(spot['hero_hand'])) == 10, f"Spot {spot['id']} has duplicate cards"
            # Check no overlap with discard pile
            hand_set = set(spot['hero_hand'])
            disc_set = set(spot['public_state'].discard_pile)
            overlap = hand_set & disc_set
            assert not overlap, f"Spot {spot['id']} has hand/discard overlap"

    def test_spot_deadwood_values(self):
        """Verify expected deadwood for key spots."""
        gin_spot = get_spot('gin_trivial_dominant')
        assert compute_deadwood(gin_spot['hero_hand']) == 0

        clinch_spot = get_spot('match_clinch_trivial')
        assert compute_deadwood(clinch_spot['hero_hand']) == 10

        dw1_spot = get_spot('dw1_gin_close')
        assert compute_deadwood(dw1_spot['hero_hand']) == 1

        frag_spot = get_spot('fragmented_dw_low_stock')
        assert compute_deadwood(frag_spot['hero_hand']) == 8

    def test_solvable_spots_excludes_illegal(self):
        """get_solvable_spots should exclude spots with expected_dominant='reject'."""
        solvable = get_solvable_spots()
        for spot in solvable:
            assert spot['expected_dominant'] != 'reject'
        # The illegal_knock_reject spot should be excluded
        ids = [s['id'] for s in solvable]
        assert 'illegal_knock_reject' not in ids


# ── Hidden World Generation ───────────────────────────────────────────

class TestHiddenWorldGeneration:
    """Test hidden world generator consistency."""

    def test_worlds_consistent_with_hero_hand(self):
        """No world should contain cards from hero's hand."""
        spot = get_spot('gin_live_one_dw')
        hero_set = set(spot['hero_hand'])
        worlds = generate_hidden_worlds(
            spot['hero_hand'], spot['public_state'], n_worlds=50, rng=random.Random(42)
        )
        for opp_hand, stock in worlds:
            opp_set = set(opp_hand)
            assert not (opp_set & hero_set), "Opponent hand contains hero's cards"
            stock_set = set(stock)
            assert not (stock_set & hero_set), "Stock contains hero's cards"

    def test_worlds_consistent_with_discard(self):
        """No world should contain cards from the discard pile."""
        spot = get_spot('fragmented_dw_low_stock')
        disc_set = set(spot['public_state'].discard_pile)
        worlds = generate_hidden_worlds(
            spot['hero_hand'], spot['public_state'], n_worlds=50, rng=random.Random(42)
        )
        for opp_hand, stock in worlds:
            assert not (set(opp_hand) & disc_set), "Opponent hand contains discard pile cards"
            assert not (set(stock) & disc_set), "Stock contains discard pile cards"

    def test_worlds_have_correct_hand_size(self):
        """Opponent hand should have 10 cards."""
        spot = get_spot('gin_live_one_dw')
        worlds = generate_hidden_worlds(
            spot['hero_hand'], spot['public_state'], n_worlds=50, rng=random.Random(42)
        )
        for opp_hand, stock in worlds:
            assert len(opp_hand) == 10, f"Opponent hand has {len(opp_hand)} cards"

    def test_worlds_no_card_overlap(self):
        """Opponent hand and stock should not share cards."""
        spot = get_spot('dw1_gin_close')
        worlds = generate_hidden_worlds(
            spot['hero_hand'], spot['public_state'], n_worlds=50, rng=random.Random(42)
        )
        for opp_hand, stock in worlds:
            assert not (set(opp_hand) & set(stock)), "Opponent hand and stock share cards"

    def test_worlds_cover_all_unassigned_cards(self):
        """Union of opponent hand and stock should be all unassigned cards."""
        spot = get_spot('gin_live_one_dw')
        hero_set = set(spot['hero_hand'])
        disc_set = set(spot['public_state'].discard_pile)
        assigned = hero_set | disc_set
        unassigned = set(range(52)) - assigned

        worlds = generate_hidden_worlds(
            spot['hero_hand'], spot['public_state'], n_worlds=50, rng=random.Random(42)
        )
        for opp_hand, stock in worlds:
            world_cards = set(opp_hand) | set(stock)
            assert world_cards == unassigned, (
                f"World cards {len(world_cards)} != unassigned {len(unassigned)}"
            )

    def test_known_opponent_pickups_respected(self):
        """Known opponent pickups should always be in opponent's hand."""
        spot = get_spot('undercut_risk_heavy')
        known_pickups = set(spot['public_state'].known_opponent_pickups)
        disc_set = set(spot['public_state'].discard_pile)
        hero_set = set(spot['hero_hand'])
        
        # Only pickups not in discard or hero hand count
        expected_in_opp = known_pickups - disc_set - hero_set
        
        if expected_in_opp:
            worlds = generate_hidden_worlds(
                spot['hero_hand'], spot['public_state'], n_worlds=50, rng=random.Random(42)
            )
            for opp_hand, stock in worlds:
                opp_set = set(opp_hand)
                for c in expected_in_opp:
                    assert c in opp_set, (
                        f"Known pickup {card_str(c)} not in opponent hand"
                    )

    def test_reproducibility_with_seed(self):
        """Same seed should produce same worlds."""
        spot = get_spot('gin_live_one_dw')
        worlds1 = generate_hidden_worlds(
            spot['hero_hand'], spot['public_state'], n_worlds=10, rng=random.Random(42)
        )
        worlds2 = generate_hidden_worlds(
            spot['hero_hand'], spot['public_state'], n_worlds=10, rng=random.Random(42)
        )
        for (o1, s1), (o2, s2) in zip(worlds1, worlds2):
            assert sorted(o1) == sorted(o2), "Worlds differ with same seed"
            assert s1 == s2, "Stock differs with same seed"


# ── Knock-Now Evaluator ───────────────────────────────────────────────

class TestKnockNowEvaluator:
    """Test exact knock evaluation."""

    def test_gin_gives_bonus(self):
        """Gin should award GIN_BONUS + opp_dw."""
        from gin_rummy.game import GIN_BONUS
        hero = get_spot('gin_trivial_dominant')['hero_hand']
        # Opponent with some deadwood
        opp = [make_card(12, 0), make_card(11, 1), make_card(0, 1),
               make_card(1, 3), make_card(3, 2), make_card(4, 3),
               make_card(6, 2), make_card(7, 0), make_card(8, 1), make_card(9, 0)]
        outcome = evaluate_knock_now(hero, opp)
        assert outcome.gin is True
        opp_dw = compute_deadwood(opp)
        assert outcome.hero_points == GIN_BONUS + opp_dw
        assert outcome.opp_points == 0

    def test_knock_win(self):
        """Lower DW knocker should win the difference."""
        # Hero: DW=5
        hero = get_spot('gin_live_one_dw')['hero_hand']
        hero_dw = compute_deadwood(hero)
        assert hero_dw == 5
        
        # Construct opponent with high DW (sure to lose)
        opp = [make_card(12, 0), make_card(12, 1), make_card(12, 2),  # Not a set alone enough to offset
               make_card(11, 1), make_card(9, 0), make_card(8, 2),
               make_card(7, 2), make_card(6, 2), make_card(5, 3), make_card(4, 3)]
        opp_melds, opp_dw_cards, opp_dw = best_meld_arrangement(opp)
        
        outcome = evaluate_knock_now(hero, opp)
        # Hero should win unless undercut
        if hero_dw < outcome.opp_deadwood:
            assert outcome.knock_win is True
            assert outcome.hero_points == outcome.opp_deadwood - hero_dw
        else:
            assert outcome.undercut is True

    def test_undercut_gives_bonus(self):
        """Undercut should award UNDERCUT_BONUS + delta to opponent."""
        from gin_rummy.game import UNDERCUT_BONUS
        # Hero DW=10
        hero = get_spot('match_clinch_trivial')['hero_hand']
        hero_dw = compute_deadwood(hero)
        assert hero_dw == 10
        
        # Opponent with DW=0 (gin) → hero gets undercut
        opp_gin = [make_card(0, 1), make_card(1, 1), make_card(2, 1),  # AD-2D-3D run
                   make_card(4, 0), make_card(4, 2), make_card(4, 3),  # Set of 5s
                   make_card(6, 3), make_card(7, 3), make_card(8, 3), make_card(9, 2)]  # Need DW=0
        opp_dw = compute_deadwood(opp_gin)
        # This opponent probably isn't DW=0. Let me use something that IS.
        opp_gin = [make_card(0, 1), make_card(1, 1), make_card(2, 1),  # AD 2D 3D run
                   make_card(6, 3), make_card(7, 3), make_card(8, 3),  # 7H 8H 9H run
                   make_card(3, 2), make_card(3, 0), make_card(3, 3),  # 4S 4C 4H set
                   make_card(11, 3)]  # QH = DW 10... nope
        # Need clean DW ≤ hero_DW for undercut
        # Let's make opponent with DW=5 (which is < hero's 10)
        opp_low = [make_card(0, 1), make_card(1, 1), make_card(2, 1),  # AD 2D 3D
                   make_card(6, 3), make_card(7, 3), make_card(8, 3),  # 7H 8H 9H
                   make_card(3, 2), make_card(3, 0), make_card(3, 3),  # 4S 4C 4H set
                   make_card(4, 2)]  # 5S = DW=5
        opp_dw_check = compute_deadwood(opp_low)
        # Hero knocks with DW=10, opponent has DW=5 after layoffs → undercut
        outcome = evaluate_knock_now(hero, opp_low)
        assert outcome.undercut is True
        assert outcome.opp_points >= UNDERCUT_BONUS


# ── Solver Determinism ────────────────────────────────────────────────

class TestSolverDeterminism:
    """Test that solver produces reproducible results with same seed."""

    def test_solve_reproducible(self):
        """Same seed should produce identical solver results."""
        spot = get_spot('gin_live_one_dw')
        r1 = solve_spot(spot['hero_hand'], spot['public_state'], n_worlds=30, seed=42)
        r2 = solve_spot(spot['hero_hand'], spot['public_state'], n_worlds=30, seed=42)
        assert r1.recommended_action == r2.recommended_action
        assert abs(r1.knock_now.net_expected_points - r2.knock_now.net_expected_points) < 1e-10
        assert abs(r1.continue_play.net_expected_points - r2.continue_play.net_expected_points) < 1e-10


# ── Solver Output Shape ──────────────────────────────────────────────

class TestSolverOutputShape:
    """Test that solver output has the expected structure."""

    def test_solver_result_fields(self):
        """SolverResult should have all required fields."""
        spot = get_spot('fragmented_dw_low_stock')
        result = solve_spot(spot['hero_hand'], spot['public_state'], n_worlds=20, seed=42)
        
        assert isinstance(result, SolverResult)
        assert result.recommended_action in ('knock', 'continue')
        assert 0.0 <= result.confidence <= 1.0
        assert isinstance(result.knock_now, OutcomeDistribution)
        assert isinstance(result.continue_play, OutcomeDistribution)
        assert isinstance(result.diagnostics, dict)

    def test_outcome_distribution_rates_sum_to_one(self):
        """Outcome rates should approximately sum to 1.0."""
        spot = get_spot('gin_live_one_dw')
        result = solve_spot(spot['hero_hand'], spot['public_state'], n_worlds=50, seed=42)
        
        for dist in [result.knock_now, result.continue_play]:
            total_rate = dist.gin_rate + dist.knock_win_rate + dist.undercut_rate + dist.wall_rate
            assert abs(total_rate - 1.0) < 0.05, (
                f"Outcome rates sum to {total_rate}, expected ~1.0"
            )

    def test_to_dict_structure(self):
        """to_dict should produce a JSON-serializable dict."""
        import json
        spot = get_spot('fragmented_dw_low_stock')
        result = solve_spot(spot['hero_hand'], spot['public_state'], n_worlds=20, seed=42)
        d = result.to_dict()
        # Should be JSON-serializable
        json_str = json.dumps(d)
        assert len(json_str) > 0

    def test_diagnostics_contain_key_info(self):
        """Diagnostics should contain essential metadata."""
        spot = get_spot('gin_live_one_dw')
        result = solve_spot(spot['hero_hand'], spot['public_state'], n_worlds=20, seed=42)
        diag = result.diagnostics
        assert 'worlds_sampled' in diag
        assert 'hero_deadwood' in diag
        assert 'belief_model' in diag
        assert 'approximations' in diag
        assert diag['worlds_sampled'] == 20


# ── Dominant Action Sanity Checks ─────────────────────────────────────

class TestDominantActions:
    """Test that the solver finds correct answers for known dominant actions."""

    def test_gin_always_knocks(self):
        """With DW=0 (gin), solver must recommend 'knock'."""
        spot = get_spot('gin_trivial_dominant')
        result = solve_spot(spot['hero_hand'], spot['public_state'], n_worlds=50, seed=42)
        assert result.recommended_action == 'knock', (
            f"Gin should always knock, got '{result.recommended_action}'"
        )
        # Gin rate should be 100% for knock action
        assert result.knock_now.gin_rate == 1.0

    def test_match_clinch_always_knocks(self):
        """With score at 99, any legal knock should clinch."""
        spot = get_spot('match_clinch_trivial')
        result = solve_spot(spot['hero_hand'], spot['public_state'], n_worlds=50, seed=42)
        assert result.recommended_action == 'knock', (
            f"Match clinch should always knock, got '{result.recommended_action}'"
        )

    def test_illegal_knock_rejected(self):
        """Solver must raise ValueError for DW > 10."""
        spot = get_spot('illegal_knock_reject')
        with pytest.raises(ValueError, match="cannot knock"):
            solve_spot(spot['hero_hand'], spot['public_state'], n_worlds=10, seed=42)

    def test_near_clinch_prefers_knock(self):
        """At 93-45 with DW=3, knock should be strongly preferred."""
        spot = get_spot('near_clinch_score_sensitive')
        result = solve_spot(spot['hero_hand'], spot['public_state'], n_worlds=100, seed=42)
        assert result.recommended_action == 'knock', (
            f"Near clinch at score 93 with DW=3 should knock, got '{result.recommended_action}'"
        )

    def test_fragmented_dw_prefers_knock_at_low_stock(self):
        """With DW=8 and stock=3, fragmented hand should prefer knock."""
        spot = get_spot('fragmented_dw_low_stock')
        result = solve_spot(spot['hero_hand'], spot['public_state'], n_worlds=100, seed=42)
        assert result.recommended_action == 'knock', (
            f"Fragmented DW at low stock should knock, got '{result.recommended_action}'"
        )


# ── Champion Comparison ───────────────────────────────────────────────

class TestChampionComparison:
    """Test what_would_champion_do function."""

    def test_champion_knocks_on_gin(self):
        spot = get_spot('gin_trivial_dominant')
        action, reason = what_would_champion_do(spot['hero_hand'], spot['public_state'])
        assert action == 'knock'
        assert reason == 'gin'

    def test_champion_knocks_on_clinch(self):
        spot = get_spot('match_clinch_trivial')
        action, reason = what_would_champion_do(spot['hero_hand'], spot['public_state'])
        assert action == 'knock'
        assert reason == 'clinch'

    def test_champion_continues_on_dw5(self):
        """Champion (go-gin + clinch) should continue with DW=5 at 0-0."""
        spot = get_spot('gin_live_one_dw')
        action, reason = what_would_champion_do(spot['hero_hand'], spot['public_state'])
        assert action == 'continue'
        assert reason == 'patience'

    def test_champion_continues_on_dw1(self):
        """Champion should continue even with DW=1 (unless clinch)."""
        spot = get_spot('dw1_gin_close')
        action, reason = what_would_champion_do(spot['hero_hand'], spot['public_state'])
        assert action == 'continue'
        assert reason == 'patience'

    def test_champion_near_clinch(self):
        """At 93 with DW=3, champion should knock (clinch exception)."""
        spot = get_spot('near_clinch_score_sensitive')
        action, reason = what_would_champion_do(spot['hero_hand'], spot['public_state'])
        assert action == 'knock'
        assert reason == 'clinch'


# ── Match Equity Wrapper ──────────────────────────────────────────────

class TestMatchEquity:
    """Test the match equity delta function."""

    def test_positive_hero_points_positive_delta(self):
        """Hero earning points should increase match equity."""
        delta = match_equity_delta(10, 0, 0, 0)
        assert delta > 0

    def test_positive_opp_points_negative_delta(self):
        """Opponent earning points should decrease match equity."""
        delta = match_equity_delta(0, 10, 0, 0)
        assert delta < 0

    def test_zero_points_zero_delta(self):
        """No points earned should yield zero delta."""
        delta = match_equity_delta(0, 0, 50, 50)
        assert abs(delta) < 1e-10

    def test_clinching_knock(self):
        """Clinching knock should have large positive delta."""
        delta = match_equity_delta(10, 0, 95, 50)
        assert delta > 0.1  # Going from 95 to 105, well past target


# ── PublicState Validation ────────────────────────────────────────────

class TestPublicStateValidation:
    def test_negative_stock_raises(self):
        with pytest.raises(ValueError):
            PublicState(
                discard_pile=[], turn_number=0,
                stock_size=-1, my_score=0, opp_score=0,
            ).validate()

    def test_negative_turn_raises(self):
        with pytest.raises(ValueError):
            PublicState(
                discard_pile=[], turn_number=-1,
                stock_size=10, my_score=0, opp_score=0,
            ).validate()

    def test_overly_large_stock_raises(self):
        with pytest.raises(ValueError):
            PublicState(
                discard_pile=[], turn_number=0,
                stock_size=50, my_score=0, opp_score=0,
            ).validate()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
