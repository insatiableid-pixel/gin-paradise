"""
Phase 61 Solver Analysis: Compare solver output to champion for all canonical spots.

Run:  python -m gin_rummy.solve_canonical_spots > solve_results.txt
"""

import json
import time
from gin_rummy.card import card_str, hand_str
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.canonical_spots import CANONICAL_SPOTS, get_solvable_spots
from gin_rummy.endgame_solver import solve_spot, what_would_champion_do


N_WORLDS = 500  # Enough for stable estimates


def run_analysis():
    print("=" * 78)
    print("  PHASE 61: REPRESENTATIVE SUBGAME SOLVER — CANONICAL SPOT ANALYSIS")
    print("=" * 78)
    print(f"\n  Worlds per spot: {N_WORLDS}")
    print(f"  Seed: 20260320 (deterministic)")
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
        print(f"  Hand: {hand_str(hero)}")
        print(f"  DW: {hero_dw} | Stock: {ps.stock_size} | Turn: {ps.turn_number}")
        print(f"  Score: Hero {ps.my_score} — Opp {ps.opp_score}")

        # Champion decision
        champ_action, champ_reason = what_would_champion_do(hero, ps)
        print(f"\n  Champion (ApexMCTSClinchOnlyGoGin): {champ_action.upper()} ({champ_reason})")

        # Solver decision
        t0 = time.time()
        result = solve_spot(hero, ps, n_worlds=N_WORLDS, seed=20260320)
        elapsed = time.time() - t0
        total_time += elapsed

        solver_action = result.recommended_action
        print(f"  Solver recommendation: {solver_action.upper()} (confidence: {result.confidence:.3f})")
        print(f"  Solve time: {elapsed:.2f}s")

        # Knock outcomes
        ko = result.knock_now
        print(f"\n  KNOCK NOW outcomes ({ko.n} worlds):")
        print(f"    Gin rate:       {ko.gin_rate * 100:6.2f}%")
        print(f"    Knock-win rate: {ko.knock_win_rate * 100:6.2f}%")
        print(f"    Undercut rate:  {ko.undercut_rate * 100:6.2f}%")
        print(f"    Wall rate:      {ko.wall_rate * 100:6.2f}%")
        print(f"    E[hero pts]:    {ko.expected_hero_points:+.2f}")
        print(f"    E[opp pts]:     {ko.expected_opp_points:+.2f}")
        print(f"    Net E[pts]:     {ko.net_expected_points:+.2f}")

        # Continue outcomes
        co = result.continue_play
        print(f"\n  CONTINUE outcomes ({co.n} worlds):")
        print(f"    Gin rate:       {co.gin_rate * 100:6.2f}%")
        print(f"    Knock-win rate: {co.knock_win_rate * 100:6.2f}%")
        print(f"    Undercut rate:  {co.undercut_rate * 100:6.2f}%")
        print(f"    Wall rate:      {co.wall_rate * 100:6.2f}%")
        print(f"    E[hero pts]:    {co.expected_hero_points:+.2f}")
        print(f"    E[opp pts]:     {co.expected_opp_points:+.2f}")
        print(f"    Net E[pts]:     {co.net_expected_points:+.2f}")

        # Match equity
        if result.match_equity_knock is not None:
            print(f"\n  Match equity delta (knock):    {result.match_equity_knock:+.4f}")
            print(f"  Match equity delta (continue): {result.match_equity_continue:+.4f}")

        # Agreement/disagreement
        agrees = solver_action == champ_action
        print(f"\n  {'✓ AGREES' if agrees else '✗ DISAGREES'} with champion")
        if not agrees:
            diff = ko.net_expected_points - co.net_expected_points
            print(f"    Solver reason: knock net={ko.net_expected_points:+.2f}, "
                  f"continue net={co.net_expected_points:+.2f}, "
                  f"diff={diff:+.2f}")
            print(f"    Champion goes {champ_action} ({champ_reason}) but solver prefers {solver_action}")

        results.append({
            'spot_id': sid,
            'hero_dw': hero_dw,
            'stock': ps.stock_size,
            'champion': champ_action,
            'champion_reason': champ_reason,
            'solver': solver_action,
            'agrees': agrees,
            'knock_net': ko.net_expected_points,
            'continue_net': co.net_expected_points,
            'confidence': result.confidence,
            'match_equity_knock': result.match_equity_knock,
            'match_equity_continue': result.match_equity_continue,
        })

    # Summary table
    print(f"\n\n{'=' * 78}")
    print("  SUMMARY TABLE")
    print(f"{'=' * 78}")
    print(f"  {'Spot ID':<28} {'DW':>3} {'Stk':>3} {'Champ':>8} {'Solver':>8} {'Agree':>6} {'K.Net':>7} {'C.Net':>7}")
    print(f"  {'─' * 74}")
    for r in results:
        agree_str = "YES" if r['agrees'] else "NO"
        print(f"  {r['spot_id']:<28} {r['hero_dw']:>3} {r['stock']:>3} "
              f"{r['champion']:>8} {r['solver']:>8} {agree_str:>6} "
              f"{r['knock_net']:>+7.1f} {r['continue_net']:>+7.1f}")

    agrees_count = sum(1 for r in results if r['agrees'])
    disagrees_count = len(results) - agrees_count
    print(f"\n  Agreements: {agrees_count}/{len(results)}")
    print(f"  Disagreements: {disagrees_count}/{len(results)}")
    print(f"  Total solve time: {total_time:.2f}s")
    print(f"{'=' * 78}")

    # Print disagreement analysis
    if disagrees_count > 0:
        print(f"\n\n{'=' * 78}")
        print("  DISAGREEMENT ANALYSIS")
        print(f"{'=' * 78}")
        for r in results:
            if not r['agrees']:
                print(f"\n  • {r['spot_id']}: Champion says {r['champion']} ({r['champion_reason']}), "
                      f"Solver says {r['solver']}")
                diff = r['knock_net'] - r['continue_net']
                print(f"    Knock net: {r['knock_net']:+.2f}, Continue net: {r['continue_net']:+.2f} "
                      f"(diff: {diff:+.2f})")
                if r['match_equity_knock'] is not None:
                    me_diff = r['match_equity_knock'] - r['match_equity_continue']
                    print(f"    Match equity: knock={r['match_equity_knock']:+.4f}, "
                          f"continue={r['match_equity_continue']:+.4f} (diff: {me_diff:+.4f})")
                print(f"    Confidence: {r['confidence']:.3f}")


if __name__ == '__main__':
    run_analysis()
