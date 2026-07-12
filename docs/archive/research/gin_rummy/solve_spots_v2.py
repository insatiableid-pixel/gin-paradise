"""
Phase 62 Task D + E: Full Solver Comparison and Belief Sensitivity Analysis.

Task D: Re-runs solver analysis on:
  1. Phase 61 canonical spots under both greedy and champion continuation
  2. Newly mined realistic spots

Task E: Belief sensitivity check — runs selected spots under:
  1. Uniform belief (default)
  2. Opponent-frequency-weighted belief

Run:  python -m gin_rummy.solve_spots_v2
"""

import json
import time
import random
from gin_rummy.card import card_str, hand_str
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.canonical_spots import CANONICAL_SPOTS, get_solvable_spots
from gin_rummy.endgame_solver import what_would_champion_do
from gin_rummy.solver_v2 import (
    solve_spot_v2, compare_continuation_modes,
    CONTINUATION_GREEDY, CONTINUATION_CHAMPION,
)


N_WORLDS = 500  # Enough for stable estimates
SEED = 20260320


def run_canonical_comparison():
    """Task D part 1: Run canonical spots under both continuation modes."""
    print("=" * 78)
    print("  PHASE 62: CANONICAL SPOT COMPARISON — GREEDY vs CHAMPION CONTINUATION")
    print("=" * 78)
    print(f"\n  Worlds per spot: {N_WORLDS}")
    print(f"  Seed: {SEED}")
    print()
    
    solvable = get_solvable_spots()
    results = []
    total_time = 0
    
    for spot in solvable:
        sid = spot['id']
        hero = spot['hero_hand']
        ps = spot['public_state']
        hero_dw = compute_deadwood(hero)
        
        print(f"\n{'─' * 78}")
        print(f"  Spot: {sid}")
        print(f"  {spot['description']}")
        print(f"  Hand: {hand_str(hero)} | DW: {hero_dw} | Stock: {ps.stock_size}")
        print(f"  Score: {ps.my_score}-{ps.opp_score}")
        
        # Champion decision
        champ_action, champ_reason = what_would_champion_do(hero, ps)
        print(f"\n  Champion: {champ_action.upper()} ({champ_reason})")
        
        # Phase 61 greedy solver
        t0 = time.time()
        greedy_result = solve_spot_v2(
            hero, ps, n_worlds=N_WORLDS, seed=SEED,
            continuation_mode=CONTINUATION_GREEDY,
            use_empirical_equity=False,
        )
        greedy_time = time.time() - t0
        
        # Phase 62 champion solver
        t0 = time.time()
        try:
            champ_result = solve_spot_v2(
                hero, ps, n_worlds=N_WORLDS, seed=SEED,
                continuation_mode=CONTINUATION_CHAMPION,
                use_empirical_equity=True,
            )
        except Exception as e:
            # If empirical table not built, fall back to linear
            champ_result = solve_spot_v2(
                hero, ps, n_worlds=N_WORLDS, seed=SEED,
                continuation_mode=CONTINUATION_CHAMPION,
                use_empirical_equity=False,
            )
        champ_time = time.time() - t0
        total_time += greedy_time + champ_time
        
        print(f"\n  GREEDY continuation:")
        _print_result_summary(greedy_result, greedy_time)
        
        print(f"\n  CHAMPION continuation:")
        _print_result_summary(champ_result, champ_time)
        
        # Comparison
        greedy_agrees = greedy_result.recommended_action == champ_action
        champ_agrees = champ_result.recommended_action == champ_action
        
        status = ""
        if greedy_agrees and champ_agrees:
            status = "STABLE AGREEMENT"
        elif not greedy_agrees and not champ_agrees:
            status = "STABLE DISAGREEMENT"
        elif greedy_agrees and not champ_agrees:
            status = "NEW DISAGREEMENT (champion-continuation reveals)"
        else:
            status = "RESOLVED DISAGREEMENT (champion-continuation fixes)"
        
        print(f"\n  Status: {status}")
        
        results.append({
            'spot_id': sid,
            'hero_dw': hero_dw,
            'stock': ps.stock_size,
            'score': f"{ps.my_score}-{ps.opp_score}",
            'champion': champ_action,
            'greedy_solver': greedy_result.recommended_action,
            'champion_solver': champ_result.recommended_action,
            'greedy_agrees': greedy_agrees,
            'champion_agrees': champ_agrees,
            'status': status,
            'greedy_knock_net': greedy_result.knock_now.net_expected_points,
            'greedy_cont_net': greedy_result.continue_play.net_expected_points,
            'champ_knock_net': champ_result.knock_now.net_expected_points,
            'champ_cont_net': champ_result.continue_play.net_expected_points,
            'greedy_me_knock': greedy_result.match_equity_knock,
            'greedy_me_cont': greedy_result.match_equity_continue,
            'champ_me_knock': champ_result.match_equity_knock,
            'champ_me_cont': champ_result.match_equity_continue,
        })
    
    # Summary
    _print_comparison_summary(results, total_time)
    return results


def run_mined_spots():
    """Task D part 2: Run mined realistic spots."""
    print("\n\n" + "=" * 78)
    print("  PHASE 62: MINED REALISTIC SPOT ANALYSIS")
    print("=" * 78)
    
    from gin_rummy.spot_miner import mine_spots
    
    print("\n  Mining spots from self-play...")
    spots = mine_spots(n_games=200, min_spots=15, verbose=True)
    
    if not spots:
        print("  No spots mined. Skipping.")
        return []
    
    print(f"\n  Analyzing {len(spots)} mined spots...")
    results = []
    
    for i, mined in enumerate(spots):
        spot_dict = mined.to_solver_dict()
        hero = spot_dict['hero_hand']
        ps = spot_dict['public_state']
        hero_dw = compute_deadwood(hero)
        
        print(f"\n{'─' * 78}")
        print(f"  Mined Spot {i+1}: DW={hero_dw}, Stock={ps.stock_size}, "
              f"Score={ps.my_score}-{ps.opp_score}")
        print(f"  Hand: {hand_str(hero)}")
        
        champ_action, champ_reason = what_would_champion_do(hero, ps)
        print(f"  Champion: {champ_action.upper()} ({champ_reason})")
        
        try:
            result = solve_spot_v2(
                hero, ps, n_worlds=N_WORLDS, seed=SEED,
                continuation_mode=CONTINUATION_CHAMPION,
                use_empirical_equity=False,  # Linear is fine for mined spots
            )
        except Exception as e:
            print(f"  ERROR: {e}")
            continue
        
        print(f"  Solver: {result.recommended_action.upper()} (conf: {result.confidence:.3f})")
        agrees = result.recommended_action == champ_action
        print(f"  {'✓ AGREES' if agrees else '✗ DISAGREES'} with champion")
        
        results.append({
            'spot_id': spot_dict['id'],
            'hero_dw': hero_dw,
            'stock': ps.stock_size,
            'score': f"{ps.my_score}-{ps.opp_score}",
            'champion': champ_action,
            'solver': result.recommended_action,
            'agrees': agrees,
            'knock_net': result.knock_now.net_expected_points,
            'cont_net': result.continue_play.net_expected_points,
            'confidence': result.confidence,
        })
    
    # Summary
    print(f"\n{'=' * 78}")
    print("  MINED SPOT SUMMARY")
    print(f"{'=' * 78}")
    agrees = sum(1 for r in results if r['agrees'])
    disagrees = len(results) - agrees
    print(f"  Agreements: {agrees}/{len(results)}")
    print(f"  Disagreements: {disagrees}/{len(results)}")
    
    if disagrees > 0:
        print(f"\n  Disagree spots:")
        for r in results:
            if not r['agrees']:
                diff = r['knock_net'] - r['cont_net']
                print(f"    {r['spot_id']}: DW={r['hero_dw']}, Stock={r['stock']}, "
                      f"Champion={r['champion']}, Solver={r['solver']}, "
                      f"diff={diff:+.1f}")
    
    return results


def run_belief_sensitivity():
    """Task E: Belief sensitivity check on key spots."""
    print("\n\n" + "=" * 78)
    print("  PHASE 62: BELIEF SENSITIVITY CHECK")
    print("=" * 78)
    
    # Test on the key disagreement spot and a couple others
    test_spots = ['fragmented_dw_low_stock', 'undercut_risk_heavy', 'gin_live_one_dw']
    results = []
    
    for sid in test_spots:
        from gin_rummy.canonical_spots import get_spot
        spot = get_spot(sid)
        hero = spot['hero_hand']
        ps = spot['public_state']
        hero_dw = compute_deadwood(hero)
        
        print(f"\n{'─' * 78}")
        print(f"  Spot: {sid} (DW={hero_dw}, Stock={ps.stock_size})")
        
        # Run with uniform belief
        result_uniform = solve_spot_v2(
            hero, ps, n_worlds=N_WORLDS, seed=SEED,
            continuation_mode=CONTINUATION_CHAMPION,
            use_empirical_equity=False,
        )
        
        # Run with light frequency weighting
        # Create simple weights: cards near opponent's known pickups get higher weight
        weights = _build_light_belief_weights(ps)
        
        result_weighted = solve_spot_v2(
            hero, ps, n_worlds=N_WORLDS, seed=SEED,
            continuation_mode=CONTINUATION_CHAMPION,
            use_empirical_equity=False,
            opponent_weights=weights if weights else None,
        )
        
        print(f"\n  Uniform belief: {result_uniform.recommended_action.upper()} "
              f"(conf: {result_uniform.confidence:.3f})")
        print(f"    Knock net: {result_uniform.knock_now.net_expected_points:+.2f}")
        print(f"    Continue net: {result_uniform.continue_play.net_expected_points:+.2f}")
        
        print(f"\n  Weighted belief: {result_weighted.recommended_action.upper()} "
              f"(conf: {result_weighted.confidence:.3f})")
        print(f"    Knock net: {result_weighted.knock_now.net_expected_points:+.2f}")
        print(f"    Continue net: {result_weighted.continue_play.net_expected_points:+.2f}")
        
        stable = result_uniform.recommended_action == result_weighted.recommended_action
        print(f"\n  Belief sensitivity: {'STABLE' if stable else 'FRAGILE'}")
        
        results.append({
            'spot_id': sid,
            'hero_dw': hero_dw,
            'uniform_action': result_uniform.recommended_action,
            'weighted_action': result_weighted.recommended_action,
            'stable': stable,
            'uniform_knock_net': result_uniform.knock_now.net_expected_points,
            'uniform_cont_net': result_uniform.continue_play.net_expected_points,
            'weighted_knock_net': result_weighted.knock_now.net_expected_points,
            'weighted_cont_net': result_weighted.continue_play.net_expected_points,
        })
    
    return results


def _build_light_belief_weights(ps: 'PublicState') -> dict:
    """
    Build lightweight opponent belief weights from public information.
    
    Cards adjacent (in rank/suit) to known opponent pickups get higher weight.
    This is a minimal belief model — not full inference, just public signals.
    """
    from gin_rummy.card import rank, suit, make_card, NUM_CARDS
    
    if not ps.known_opponent_pickups:
        return {}
    
    weights = {}
    pickup_set = set(ps.known_opponent_pickups)
    
    for c in range(NUM_CARDS):
        w = 1.0
        r, s = rank(c), suit(c)
        
        for pickup in pickup_set:
            pr, ps_suit = rank(pickup), suit(pickup)
            
            # Same rank: partial set signal
            if r == pr:
                w += 0.5
            
            # Adjacent in same suit: partial run signal
            if s == ps_suit and abs(r - pr) <= 2:
                w += 0.3
        
        if w != 1.0:
            weights[c] = w
    
    return weights


def _print_result_summary(result, elapsed):
    """Print solver result summary."""
    ko = result.knock_now
    co = result.continue_play
    print(f"    Action: {result.recommended_action.upper()} (conf: {result.confidence:.3f}) [{elapsed:.2f}s]")
    print(f"    Knock: net={ko.net_expected_points:+.2f}, gin={ko.gin_rate:.1%}, "
          f"win={ko.knock_win_rate:.1%}, uc={ko.undercut_rate:.1%}, wall={ko.wall_rate:.1%}")
    print(f"    Cont:  net={co.net_expected_points:+.2f}, gin={co.gin_rate:.1%}, "
          f"win={co.knock_win_rate:.1%}, uc={co.undercut_rate:.1%}, wall={co.wall_rate:.1%}")
    if result.match_equity_knock is not None:
        print(f"    ME:    knock={result.match_equity_knock:+.4f}, "
              f"cont={result.match_equity_continue:+.4f}")


def _print_comparison_summary(results, total_time):
    """Print canonical comparison summary."""
    print(f"\n\n{'=' * 78}")
    print("  CANONICAL COMPARISON SUMMARY")
    print(f"{'=' * 78}")
    print(f"\n  {'Spot':<30} {'DW':>3} {'Stk':>3} {'Champ':>8} {'Greedy':>8} {'Champ-C':>8} {'Status':<30}")
    print(f"  {'─' * 92}")
    
    for r in results:
        print(f"  {r['spot_id']:<30} {r['hero_dw']:>3} {r['stock']:>3} "
              f"{r['champion']:>8} {r['greedy_solver']:>8} {r['champion_solver']:>8} "
              f"{r['status']:<30}")
    
    # Count categories
    stable_agree = sum(1 for r in results if r['status'] == 'STABLE AGREEMENT')
    stable_disagree = sum(1 for r in results if r['status'] == 'STABLE DISAGREEMENT')
    resolved = sum(1 for r in results if 'RESOLVED' in r['status'])
    new_disagree = sum(1 for r in results if 'NEW' in r['status'])
    
    print(f"\n  Stable agreements:      {stable_agree}/{len(results)}")
    print(f"  Stable disagreements:   {stable_disagree}/{len(results)}")
    print(f"  Resolved disagreements: {resolved}/{len(results)}")
    print(f"  New disagreements:      {new_disagree}/{len(results)}")
    print(f"  Total time: {total_time:.2f}s")


def run_full_analysis():
    """Run complete Phase 62 analysis."""
    canonical_results = run_canonical_comparison()
    mined_results = run_mined_spots()
    belief_results = run_belief_sensitivity()
    
    return {
        'canonical': canonical_results,
        'mined': mined_results,
        'beliefs': belief_results,
    }


if __name__ == '__main__':
    run_full_analysis()
