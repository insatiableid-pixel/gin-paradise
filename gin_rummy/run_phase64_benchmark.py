"""
Phase 64: Solver Falsification Benchmark Probe.

Runs solver-aligned knock probes against the current champion
(ApexMCTSClinchOnlyGoGin) in seat-balanced duplicate matches.

Stage 1: Quick screen — 240 deals per probe (480 total games each).
Stage 2: Confirmation — 600 deals (1200 total games) for promising probes.

Usage:
    python -m gin_rummy.run_phase64_benchmark [--stage1-only] [--light]
"""

import json
import math
import sys
import time

from gin_rummy.benchmark import run_balanced_matchup, wilson_interval, print_matchup_benchmark_result
from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin
from gin_rummy.solver_probe_knock import (
    SolverProbeBroad,
    SolverProbeDWAware,
    SolverProbeTextureAware,
)


# ═══════════════════════════════════════════════════════════════════════
#  Configuration
# ═══════════════════════════════════════════════════════════════════════

STAGE1_DEALS = 240          # 480 total games per probe (seat-balanced)
STAGE2_DEALS = 600          # 1200 total games for confirmation
LIGHT_STAGE1_DEALS = 150    # lighter option if --light flag
LIGHT_STAGE2_DEALS = 400
TARGET_SCORE = 100
BASE_SEED = 20260321

# Promotion threshold: probe win rate lower bound > 50%
# i.e. 95% CI low > 50% for "clearly winning"
PROMISING_THRESHOLD = 0.48  # More lenient for advancing to Stage 2


def make_champion():
    return ApexMCTSClinchOnlyGoGin(seed=None)


def make_broad():
    return SolverProbeBroad(seed=None)


def make_dw_aware():
    return SolverProbeDWAware(seed=None, dw_threshold=3)


def make_texture():
    return SolverProbeTextureAware(seed=None, min_dw_cards=2)


PROBES = {
    'SolverProbeBroad': make_broad,
    'SolverProbeDW3': make_dw_aware,
    'SolverProbeTexture': make_texture,
}


def run_stage(probe_name, probe_factory, n_deals, seed_offset=0):
    """Run a single probe vs champion matchup."""
    print(f"\n{'─' * 60}")
    print(f"  {probe_name} vs Champion  ({n_deals} deals = {n_deals * 2} games)")
    print(f"{'─' * 60}")

    result = run_balanced_matchup(
        player_a_factory=probe_factory,
        player_b_factory=make_champion,
        n_games=n_deals,
        target_score=TARGET_SCORE,
        seed=BASE_SEED + seed_offset,
        progress=True,
    )

    print_matchup_benchmark_result(result)
    return result


def is_promising(result):
    """Check if probe is promising enough for Stage 2."""
    return result.win_rate_a >= PROMISING_THRESHOLD


def summarize_result(name, result):
    """Build a summary dict for the report."""
    ci_low, ci_high = result.win_rate_ci_a
    return {
        'probe': name,
        'games': result.games_played,
        'deals': result.games_played // 2,
        'wins_probe': result.wins_a,
        'wins_champion': result.wins_b,
        'win_rate': round(result.win_rate_a * 100, 2),
        'ci_95_low': round(ci_low * 100, 2),
        'ci_95_high': round(ci_high * 100, 2),
        'avg_pts_probe': round(result.avg_points_a, 2),
        'avg_pts_champion': round(result.avg_points_b, 2),
        'avg_pt_diff': round(result.avg_point_diff_a, 2),
        'gins_probe': result.total_gins_a,
        'gins_champion': result.total_gins_b,
        'undercuts_probe': result.total_undercuts_a,
        'undercuts_champion': result.total_undercuts_b,
        'void_hands': result.total_void_hands,
        'avg_hands_per_game': round(result.avg_hands_per_game, 2),
        'promising': is_promising(result),
    }


def main():
    light_mode = '--light' in sys.argv
    stage1_only = '--stage1-only' in sys.argv

    s1_deals = LIGHT_STAGE1_DEALS if light_mode else STAGE1_DEALS
    s2_deals = LIGHT_STAGE2_DEALS if light_mode else STAGE2_DEALS

    print("=" * 60)
    print("  PHASE 64: SOLVER FALSIFICATION BENCHMARK PROBE")
    print("=" * 60)
    print(f"  Mode: {'LIGHT' if light_mode else 'STANDARD'}")
    print(f"  Stage 1: {s1_deals} deals ({s1_deals * 2} games) per probe")
    print(f"  Stage 2: {s2_deals} deals ({s2_deals * 2} games) if promising")
    print(f"  Seed: {BASE_SEED}")
    print(f"  Target score: {TARGET_SCORE}")
    print()

    # ── Stage 1: Quick Screen ──────────────────────────────────────────
    print("\n" + "═" * 60)
    print("  STAGE 1: QUICK SCREEN")
    print("═" * 60)

    stage1_results = {}
    all_summaries = []

    for i, (name, factory) in enumerate(PROBES.items()):
        result = run_stage(name, factory, s1_deals, seed_offset=i * 100000)
        stage1_results[name] = result
        summary = summarize_result(name, result)
        all_summaries.append(summary)

    # Print Stage 1 summary table
    print("\n" + "═" * 60)
    print("  STAGE 1 SUMMARY")
    print("═" * 60)
    print(f"  {'Probe':<22} {'WR%':>6} {'95% CI':>16} {'Pts±':>7} {'Promise':>8}")
    print(f"  {'─' * 22} {'─' * 6} {'─' * 16} {'─' * 7} {'─' * 8}")
    for s in all_summaries:
        ci_str = f"[{s['ci_95_low']:5.1f}%, {s['ci_95_high']:5.1f}%]"
        promise_str = "YES ✓" if s['promising'] else "no"
        print(f"  {s['probe']:<22} {s['win_rate']:>5.1f}% {ci_str:>16} {s['avg_pt_diff']:>+6.1f} {promise_str:>8}")

    # ── Stage 2: Confirmation ──────────────────────────────────────────
    promising_probes = {name: factory for name, factory in PROBES.items()
                        if is_promising(stage1_results[name])}

    stage2_results = {}
    stage2_summaries = []

    if promising_probes and not stage1_only:
        print("\n" + "═" * 60)
        print("  STAGE 2: CONFIRMATION")
        print("═" * 60)
        print(f"  Advancing {len(promising_probes)} probe(s): {', '.join(promising_probes.keys())}")

        for i, (name, factory) in enumerate(promising_probes.items()):
            result = run_stage(name, factory, s2_deals, seed_offset=500000 + i * 100000)
            stage2_results[name] = result
            summary = summarize_result(name, result)
            summary['stage'] = 2
            stage2_summaries.append(summary)

        print("\n" + "═" * 60)
        print("  STAGE 2 SUMMARY")
        print("═" * 60)
        print(f"  {'Probe':<22} {'WR%':>6} {'95% CI':>16} {'Pts±':>7}")
        print(f"  {'─' * 22} {'─' * 6} {'─' * 16} {'─' * 7}")
        for s in stage2_summaries:
            ci_str = f"[{s['ci_95_low']:5.1f}%, {s['ci_95_high']:5.1f}%]"
            print(f"  {s['probe']:<22} {s['win_rate']:>5.1f}% {ci_str:>16} {s['avg_pt_diff']:>+6.1f}")
    elif stage1_only:
        print("\n  [Stage 2 skipped: --stage1-only flag]")
    else:
        print("\n  [Stage 2 skipped: no promising probes from Stage 1]")

    # ── Save results to JSON ───────────────────────────────────────────
    output = {
        'phase': 64,
        'config': {
            'stage1_deals': s1_deals,
            'stage2_deals': s2_deals,
            'target_score': TARGET_SCORE,
            'seed': BASE_SEED,
            'light_mode': light_mode,
        },
        'stage1': all_summaries,
        'stage2': stage2_summaries,
    }

    output_path = 'phase64_results.json'
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)
    print(f"\n  Results saved to {output_path}")

    # ── Final verdict ──────────────────────────────────────────────────
    print("\n" + "═" * 60)
    print("  PHASE 64: PRELIMINARY VERDICT")
    print("═" * 60)

    if stage2_summaries:
        best = max(stage2_summaries, key=lambda s: s['win_rate'])
        if best['ci_95_low'] > 50.0:
            print(f"  SIGNAL VALIDATED: {best['probe']} wins at {best['win_rate']:.1f}%")
            print(f"  95% CI: [{best['ci_95_low']:.1f}%, {best['ci_95_high']:.1f}%]")
            print(f"  → Broad solver signal validated (World 1 or 2)")
        elif best['win_rate'] > 50.0:
            print(f"  SUGGESTIVE but not definitive: {best['probe']} at {best['win_rate']:.1f}%")
            print(f"  95% CI: [{best['ci_95_low']:.1f}%, {best['ci_95_high']:.1f}%]")
            print(f"  → Needs more games for confidence")
        else:
            print(f"  NO SIGNAL: best probe {best['probe']} at {best['win_rate']:.1f}%")
            print(f"  → Solver low-stock knock bias likely falsified (World 3)")
    elif all_summaries:
        best = max(all_summaries, key=lambda s: s['win_rate'])
        if best['win_rate'] > 50.0:
            print(f"  Stage 1 only — best: {best['probe']} at {best['win_rate']:.1f}%")
        else:
            print(f"  Stage 1 only — no probe winning. Best: {best['probe']} at {best['win_rate']:.1f}%")
            print(f"  → Solver low-stock knock bias likely falsified (World 3)")

    print("═" * 60)


if __name__ == '__main__':
    main()
