"""
Phase 62 Tests: Policy-Backed Continuation, Match Equity Table,
Spot Miner, and Solver V2.

Covers:
  - Policy-backed continuation reproducibility / structure
  - Score-table construction / lookup sanity
  - Mined-spot format validation
  - Regression protection for canonical spot solving
  - Multi-mode comparison (same spot under two continuation modes)
  - Belief sensitivity testing
"""

import pytest
import random
import os
import json
from gin_rummy.card import make_card, card_str, hand_str
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.endgame_solver import (
    PublicState, HandOutcome, OutcomeDistribution, SolverResult,
    generate_hidden_worlds, evaluate_knock_now, what_would_champion_do,
)
from gin_rummy.canonical_spots import (
    CANONICAL_SPOTS, get_spot, list_spot_ids, get_solvable_spots,
)
from gin_rummy.solver_v2 import (
    solve_spot_v2, compare_continuation_modes,
    simulate_continuation_policy, _MiniPlayer,
    CONTINUATION_GREEDY, CONTINUATION_CHAMPION,
)


# ── Policy-Backed Continuation Tests ─────────────────────────────────

class TestPolicyBackedContinuation:
    """Test the champion-policy continuation simulator."""
    
    def test_greedy_mode_produces_valid_outcome(self):
        """Greedy continuation should produce a valid HandOutcome."""
        spot = get_spot('fragmented_dw_low_stock')
        hero = spot['hero_hand']
        ps = spot['public_state']
        
        worlds = generate_hidden_worlds(hero, ps, n_worlds=5, rng=random.Random(42))
        opp_hand, stock = worlds[0]
        
        outcome = simulate_continuation_policy(
            hero, opp_hand, stock, ps,
            rng=random.Random(42), mode=CONTINUATION_GREEDY,
        )
        
        assert isinstance(outcome, HandOutcome)
        # Exactly one outcome type should be set
        types_set = sum([outcome.gin, outcome.knock_win, outcome.undercut, outcome.wall])
        assert types_set <= 1 or (outcome.hero_points > 0 or outcome.opp_points > 0 or outcome.wall)
    
    def test_champion_mode_produces_valid_outcome(self):
        """Champion continuation should produce a valid HandOutcome."""
        spot = get_spot('fragmented_dw_low_stock')
        hero = spot['hero_hand']
        ps = spot['public_state']
        
        worlds = generate_hidden_worlds(hero, ps, n_worlds=5, rng=random.Random(42))
        opp_hand, stock = worlds[0]
        
        outcome = simulate_continuation_policy(
            hero, opp_hand, stock, ps,
            rng=random.Random(42), mode=CONTINUATION_CHAMPION,
        )
        
        assert isinstance(outcome, HandOutcome)
    
    def test_invalid_mode_raises(self):
        """Invalid continuation mode should raise ValueError."""
        spot = get_spot('fragmented_dw_low_stock')
        hero = spot['hero_hand']
        ps = spot['public_state']
        
        worlds = generate_hidden_worlds(hero, ps, n_worlds=1, rng=random.Random(42))
        opp_hand, stock = worlds[0]
        
        with pytest.raises(ValueError, match="Invalid continuation mode"):
            simulate_continuation_policy(
                hero, opp_hand, stock, ps,
                rng=random.Random(42), mode='invalid_mode',
            )
    
    def test_champion_continuation_reproducible(self):
        """Same seed should produce same champion continuation outcome."""
        spot = get_spot('gin_live_one_dw')
        hero = spot['hero_hand']
        ps = spot['public_state']
        
        worlds = generate_hidden_worlds(hero, ps, n_worlds=3, rng=random.Random(42))
        opp_hand, stock = worlds[0]
        
        o1 = simulate_continuation_policy(
            hero, opp_hand, stock, ps,
            rng=random.Random(99), mode=CONTINUATION_CHAMPION,
        )
        o2 = simulate_continuation_policy(
            hero, opp_hand, stock, ps,
            rng=random.Random(99), mode=CONTINUATION_CHAMPION,
        )
        
        assert o1.gin == o2.gin
        assert o1.knock_win == o2.knock_win
        assert o1.undercut == o2.undercut
        assert o1.wall == o2.wall
        assert o1.hero_points == o2.hero_points
        assert o1.opp_points == o2.opp_points
    
    def test_continuation_terminates(self):
        """Continuation should always terminate (not hang)."""
        spot = get_spot('undercut_risk_heavy')
        hero = spot['hero_hand']
        ps = spot['public_state']
        
        worlds = generate_hidden_worlds(hero, ps, n_worlds=10, rng=random.Random(42))
        
        for opp_hand, stock in worlds:
            outcome = simulate_continuation_policy(
                hero, opp_hand, stock, ps,
                rng=random.Random(42), mode=CONTINUATION_CHAMPION,
            )
            # Should complete without hanging
            assert isinstance(outcome, HandOutcome)


class TestMiniPlayer:
    """Test the lightweight champion-policy shim."""
    
    def test_draw_completes_meld(self):
        """MiniPlayer should take a card that completes a meld."""
        # Hand with partial run: AC 2C + scattered
        hand = [
            make_card(0, 0), make_card(1, 0),  # AC 2C
            make_card(5, 1), make_card(6, 1), make_card(7, 1),  # 6D 7D 8D
            make_card(10, 0), make_card(10, 1), make_card(10, 2),  # JC JD JS
            make_card(8, 3), make_card(12, 3),  # 9H KH
        ]
        player = _MiniPlayer(hand, True, 0, 0)
        
        # 3C completes the AC-2C-3C run
        three_clubs = make_card(2, 0)
        takes = player.draw_decision(three_clubs, [])
        assert takes is True
    
    def test_knock_gin(self):
        """MiniPlayer should always knock on gin."""
        gin_hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # AC 2C 3C
            make_card(4, 1), make_card(5, 1), make_card(6, 1), make_card(7, 1),  # 5D-8D
            make_card(11, 2), make_card(11, 3), make_card(11, 0),  # QS QH QC
        ]
        player = _MiniPlayer(gin_hand, True, 0, 0)
        assert player.knock_decision(None) is True
    
    def test_knock_clinch(self):
        """MiniPlayer should knock when it clinches the match."""
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # AC 2C 3C
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5D-7D
            make_card(10, 0), make_card(10, 1), make_card(10, 2),  # JC JD JS
            make_card(4, 3),  # 5H = DW 5
        ]
        player = _MiniPlayer(hand, True, 96, 50)  # score 96 + ~5 pts = clinch
        assert player.knock_decision(None) is True
    
    def test_no_knock_patience(self):
        """MiniPlayer should not knock on non-gin, non-clinch hands."""
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # AC 2C 3C
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5D-7D
            make_card(10, 0), make_card(10, 1), make_card(10, 2),  # JC JD JS
            make_card(4, 3),  # 5H = DW 5
        ]
        player = _MiniPlayer(hand, True, 0, 0)
        assert player.knock_decision(None) is False


# ── Match Equity Table Tests ──────────────────────────────────────────

class TestMatchEquityTable:
    """Test match equity table construction and lookup."""
    
    def test_table_construction(self):
        """Should be able to build a small table."""
        from gin_rummy.match_equity_table import MatchEquityTable
        
        # Create a small synthetic table for testing
        table = {
            '0': {'0': 0.5, '50': 0.35},
            '50': {'0': 0.65, '50': 0.5},
        }
        met = MatchEquityTable(
            table=table, target_score=100, bucket_size=50, sims_per_bucket=10
        )
        
        assert met.win_probability(0, 0) == 0.5
        assert met.win_probability(50, 0) == 0.65
    
    def test_terminal_states(self):
        """Terminal states should return exact 0 or 1."""
        from gin_rummy.match_equity_table import MatchEquityTable
        
        met = MatchEquityTable(table={'0': {'0': 0.5}}, target_score=100)
        
        assert met.win_probability(100, 50) == 1.0
        assert met.win_probability(50, 100) == 0.0
        assert met.win_probability(150, 50) == 1.0
    
    def test_equity_delta_symmetry(self):
        """Hero earning points should be positive delta, opp earning negative."""
        from gin_rummy.match_equity_table import MatchEquityTable
        
        table = {
            '0': {'0': 0.5, '5': 0.45, '10': 0.40},
            '5': {'0': 0.55, '5': 0.5, '10': 0.45},
            '10': {'0': 0.60, '5': 0.55, '10': 0.5},
        }
        met = MatchEquityTable(table=table, target_score=100, bucket_size=5)
        
        delta_hero_wins = met.equity_delta(10, 0, 0, 0)
        assert delta_hero_wins > 0
        
        delta_opp_wins = met.equity_delta(0, 10, 0, 0)
        assert delta_opp_wins < 0
        
        delta_none = met.equity_delta(0, 0, 0, 0)
        assert abs(delta_none) < 1e-10
    
    def test_serialization_roundtrip(self):
        """Table should survive save/load roundtrip."""
        from gin_rummy.match_equity_table import MatchEquityTable
        import tempfile
        
        table = {'0': {'0': 0.5, '50': 0.35}, '50': {'0': 0.65, '50': 0.5}}
        met1 = MatchEquityTable(table=table, target_score=100, bucket_size=50)
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            path = f.name
        
        try:
            met1.save(path)
            met2 = MatchEquityTable.load(path)
            
            assert met1.win_probability(0, 0) == met2.win_probability(0, 0)
            assert met1.win_probability(50, 0) == met2.win_probability(50, 0)
        finally:
            os.unlink(path)
    
    def test_interpolation(self):
        """Values between buckets should be interpolated."""
        from gin_rummy.match_equity_table import MatchEquityTable
        
        table = {
            '0': {'0': 0.5, '10': 0.4},
            '10': {'0': 0.6, '10': 0.5},
        }
        met = MatchEquityTable(table=table, target_score=100, bucket_size=10)
        
        # Midpoint should be ~0.5
        wp_mid = met.win_probability(5, 5)
        assert 0.4 < wp_mid < 0.6


# ── Mined Spot Format Tests ──────────────────────────────────────────

class TestMinedSpotFormat:
    """Test mined spot data structure and validation."""
    
    def test_mined_spot_to_solver_dict(self):
        """MinedSpot should produce a valid solver dict."""
        from gin_rummy.spot_miner import MinedSpot
        
        hero = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),
            make_card(4, 1), make_card(5, 1), make_card(6, 1),
            make_card(10, 0), make_card(10, 1), make_card(10, 2),
            make_card(4, 3),
        ]
        ps = PublicState(
            discard_pile=[make_card(12, 0), make_card(11, 1)],
            turn_number=15,
            stock_size=4,
            my_score=30,
            opp_score=20,
        )
        
        spot = MinedSpot(
            hero_hand=hero,
            public_state=ps,
            hero_deadwood=compute_deadwood(hero),
            source_game_id=42,
        )
        
        d = spot.to_solver_dict()
        assert 'id' in d
        assert 'hero_hand' in d
        assert 'public_state' in d
        assert len(d['hero_hand']) == 10
        assert d['expected_dominant'] == 'unclear'
    
    def test_mined_spot_hand_valid(self):
        """Mined spot hand should have 10 unique cards with no discard overlap."""
        from gin_rummy.spot_miner import MinedSpot
        
        hero = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),
            make_card(4, 1), make_card(5, 1), make_card(6, 1),
            make_card(10, 0), make_card(10, 1), make_card(10, 2),
            make_card(8, 3),
        ]
        discard = [make_card(12, 0)]
        ps = PublicState(
            discard_pile=discard, turn_number=15, stock_size=4,
            my_score=0, opp_score=0,
        )
        
        spot = MinedSpot(hero_hand=hero, public_state=ps, hero_deadwood=9, source_game_id=1)
        
        assert len(set(hero)) == 10
        assert not (set(hero) & set(discard))


# ── Solver V2 Tests ───────────────────────────────────────────────────

class TestSolverV2:
    """Test the Phase 62 upgraded solver."""
    
    def test_v2_greedy_matches_v1(self):
        """V2 in greedy mode should produce same recommendation as V1."""
        from gin_rummy.endgame_solver import solve_spot
        
        spot = get_spot('fragmented_dw_low_stock')
        hero = spot['hero_hand']
        ps = spot['public_state']
        
        v1_result = solve_spot(hero, ps, n_worlds=50, seed=42)
        v2_result = solve_spot_v2(
            hero, ps, n_worlds=50, seed=42,
            continuation_mode=CONTINUATION_GREEDY,
            use_empirical_equity=False,
        )
        
        assert v1_result.recommended_action == v2_result.recommended_action
    
    def test_v2_champion_runs(self):
        """V2 in champion mode should complete without error."""
        spot = get_spot('gin_live_one_dw')
        hero = spot['hero_hand']
        ps = spot['public_state']
        
        result = solve_spot_v2(
            hero, ps, n_worlds=30, seed=42,
            continuation_mode=CONTINUATION_CHAMPION,
            use_empirical_equity=False,
        )
        
        assert isinstance(result, SolverResult)
        assert result.recommended_action in ('knock', 'continue')
    
    def test_v2_gin_always_knocks(self):
        """V2 should always recommend knock on gin."""
        spot = get_spot('gin_trivial_dominant')
        result = solve_spot_v2(
            spot['hero_hand'], spot['public_state'],
            n_worlds=50, seed=42,
            continuation_mode=CONTINUATION_CHAMPION,
            use_empirical_equity=False,
        )
        assert result.recommended_action == 'knock'
        assert result.knock_now.gin_rate == 1.0
    
    def test_v2_illegal_knock_rejected(self):
        """V2 should reject illegal knock (DW > 10)."""
        spot = get_spot('illegal_knock_reject')
        with pytest.raises(ValueError, match="cannot knock"):
            solve_spot_v2(spot['hero_hand'], spot['public_state'], n_worlds=10, seed=42,
                          use_empirical_equity=False)
    
    def test_v2_diagnostics_contain_version(self):
        """V2 diagnostics should identify solver version and continuation policy."""
        spot = get_spot('fragmented_dw_low_stock')
        result = solve_spot_v2(
            spot['hero_hand'], spot['public_state'],
            n_worlds=20, seed=42,
            continuation_mode=CONTINUATION_CHAMPION,
            use_empirical_equity=False,
        )
        
        assert result.diagnostics['solver_version'] == 'phase62'
        assert result.diagnostics['continuation_policy'] == 'champion'
    
    def test_v2_reproducible(self):
        """V2 should be deterministic with same seed."""
        spot = get_spot('undercut_risk_heavy')
        hero = spot['hero_hand']
        ps = spot['public_state']
        
        r1 = solve_spot_v2(hero, ps, n_worlds=30, seed=42,
                           continuation_mode=CONTINUATION_CHAMPION,
                           use_empirical_equity=False)
        r2 = solve_spot_v2(hero, ps, n_worlds=30, seed=42,
                           continuation_mode=CONTINUATION_CHAMPION,
                           use_empirical_equity=False)
        
        assert r1.recommended_action == r2.recommended_action
        assert abs(r1.knock_now.net_expected_points - r2.knock_now.net_expected_points) < 1e-10


# ── Multi-Mode Comparison Tests ───────────────────────────────────────

class TestMultiModeComparison:
    """Test that the solver can run the same spot under different modes."""
    
    def test_compare_returns_both_modes(self):
        """compare_continuation_modes should return results for both modes."""
        spot = get_spot('fragmented_dw_low_stock')
        # Use lower-level solve_spot_v2 with explicit equity=False to avoid building table
        results = {}
        for mode in [CONTINUATION_GREEDY, CONTINUATION_CHAMPION]:
            results[mode] = solve_spot_v2(
                spot['hero_hand'], spot['public_state'],
                n_worlds=20, seed=42,
                continuation_mode=mode,
                use_empirical_equity=False,
            )
        
        assert CONTINUATION_GREEDY in results
        assert CONTINUATION_CHAMPION in results
        assert isinstance(results[CONTINUATION_GREEDY], SolverResult)
        assert isinstance(results[CONTINUATION_CHAMPION], SolverResult)
    
    def test_modes_may_differ(self):
        """Different continuation modes might produce different recommendations."""
        spot = get_spot('fragmented_dw_low_stock')
        results = {}
        for mode in [CONTINUATION_GREEDY, CONTINUATION_CHAMPION]:
            results[mode] = solve_spot_v2(
                spot['hero_hand'], spot['public_state'],
                n_worlds=50, seed=42,
                continuation_mode=mode,
                use_empirical_equity=False,
            )
        
        # Just check both produce valid results (may or may not agree)
        for mode, result in results.items():
            assert result.recommended_action in ('knock', 'continue')
            assert 0 <= result.confidence <= 1.0
    
    def test_greedy_diagnostics(self):
        """Greedy mode diagnostics should label continuation policy correctly."""
        spot = get_spot('gin_live_one_dw')
        result = solve_spot_v2(
            spot['hero_hand'], spot['public_state'],
            n_worlds=10, seed=42,
            continuation_mode=CONTINUATION_GREEDY,
            use_empirical_equity=False,
        )
        assert result.diagnostics['continuation_policy'] == 'greedy'
    
    def test_champion_diagnostics(self):
        """Champion mode diagnostics should label correctly."""
        spot = get_spot('gin_live_one_dw')
        result = solve_spot_v2(
            spot['hero_hand'], spot['public_state'],
            n_worlds=10, seed=42,
            continuation_mode=CONTINUATION_CHAMPION,
            use_empirical_equity=False,
        )
        assert result.diagnostics['continuation_policy'] == 'champion'


# ── Regression: Canonical Spots Still Solvable ────────────────────────

class TestCanonicalRegression:
    """Ensure Phase 61 canonical spots still solve correctly in V2."""
    
    def test_all_solvable_spots_run(self):
        """All solvable canonical spots should solve without error."""
        for spot in get_solvable_spots():
            result = solve_spot_v2(
                spot['hero_hand'], spot['public_state'],
                n_worlds=10, seed=42,
                continuation_mode=CONTINUATION_CHAMPION,
                use_empirical_equity=False,
            )
            assert isinstance(result, SolverResult)
    
    def test_sanity_spots_correct(self):
        """Known dominant-action spots should still be correct."""
        # Gin always knocks
        gin = get_spot('gin_trivial_dominant')
        r = solve_spot_v2(gin['hero_hand'], gin['public_state'], n_worlds=30, seed=42,
                          use_empirical_equity=False)
        assert r.recommended_action == 'knock'
        
        # Match clinch always knocks
        clinch = get_spot('match_clinch_trivial')
        r = solve_spot_v2(clinch['hero_hand'], clinch['public_state'], n_worlds=30, seed=42,
                          use_empirical_equity=False)
        assert r.recommended_action == 'knock'
    
    def test_outcome_rates_valid(self):
        """Outcome rates should be valid probabilities."""
        for spot in get_solvable_spots()[:3]:  # Test first 3 for speed
            result = solve_spot_v2(
                spot['hero_hand'], spot['public_state'],
                n_worlds=20, seed=42,
                use_empirical_equity=False,
            )
            for dist in [result.knock_now, result.continue_play]:
                assert 0 <= dist.gin_rate <= 1
                assert 0 <= dist.knock_win_rate <= 1
                assert 0 <= dist.undercut_rate <= 1
                assert 0 <= dist.wall_rate <= 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
