"""
Phase 64: Solver Falsification Benchmark — SAFE / INCREMENTAL runner.

Runs each probe SEQUENTIALLY with intermediate saves and a cooling pause
between chunks to prevent CPU saturation (which froze the PC last time).

Usage:
    python -m gin_rummy.run_phase64_safe [--probe broad|dw3|texture|all]
                                          [--stage2]
                                          [--deals N]

Defaults: --probe all  --deals 120  (120 deals = 240 games per probe)
"""

import gc
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
from gin_rummy.meld import clear_cache

# ═══════════════════════════════════════════════════════════════════════
#  Configuration — deliberately lightweight defaults
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_DEALS = 120          # 240 total games per probe (safe default)
STAGE2_DEALS = 500           # 1000 total games for confirmation
TARGET_SCORE = 100
BASE_SEED = 20260321

# Chunk size: how many deals to run before pausing + saving
CHUNK_SIZE = 40              # 80 games per chunk

# Pause between chunks (seconds) to let CPU cool
CHUNK_PAUSE = 1.0

# Promotion threshold
PROMISING_THRESHOLD = 0.48


def make_champion():
    return ApexMCTSClinchOnlyGoGin(seed=None)


PROBE_MAP = {
    'broad':   ('SolverProbeBroad',   lambda: SolverProbeBroad(seed=None)),
    'dw3':     ('SolverProbeDW3',     lambda: SolverProbeDWAware(seed=None, dw_threshold=3)),
    'texture': ('SolverProbeTexture', lambda: SolverProbeTextureAware(seed=None, min_dw_cards=2)),
}


def run_chunked_matchup(probe_name, probe_factory, total_deals, seed_offset=0):
    """Run a matchup in small chunks with pauses and progress saves."""
    from gin_rummy.benchmark import BenchmarkMatchupResult

    print(f"\n{'─' * 60}")
    print(f"  {probe_name} vs Champion  ({total_deals} deals = {total_deals * 2} games)")
    print(f"  Running in chunks of {CHUNK_SIZE} deals with {CHUNK_PAUSE}s cooling pauses")
    print(f"{'─' * 60}")

    # Run in chunks
    remaining = total_deals
    offset = 0
    combined_result = None

    while remaining > 0:
        chunk = min(CHUNK_SIZE, remaining)
        chunk_seed = BASE_SEED + seed_offset + offset

        result = run_balanced_matchup(
            player_a_factory=probe_factory,
            player_b_factory=make_champion,
            n_games=chunk,
            target_score=TARGET_SCORE,
            seed=chunk_seed,
            progress=True,
        )

        # Merge into combined result
        if combined_result is None:
            combined_result = result
        else:
            combined_result.games_played += result.games_played
            combined_result.wins_a += result.wins_a
            combined_result.wins_b += result.wins_b
            combined_result.seat_games_a_p0 += result.seat_games_a_p0
            combined_result.seat_games_a_p1 += result.seat_games_a_p1
            combined_result.total_hands += result.total_hands
            combined_result.total_void_hands += result.total_void_hands
            combined_result.total_gins_a += result.total_gins_a
            combined_result.total_gins_b += result.total_gins_b
            combined_result.total_undercuts_a += result.total_undercuts_a
            combined_result.total_undercuts_b += result.total_undercuts_b
            combined_result.total_points_a += result.total_points_a
            combined_result.total_points_b += result.total_points_b

        offset += chunk
        remaining -= chunk

        # Clear caches and force GC between chunks
        clear_cache()
        gc.collect()

        if remaining > 0:
            ci_low, ci_high = wilson_interval(combined_result.wins_a, combined_result.games_played)
            wr = combined_result.wins_a / max(1, combined_result.games_played) * 100
            print(f"    ── chunk done: {combined_result.games_played} games, "
                  f"WR={wr:.1f}% [{ci_low*100:.1f}%, {ci_high*100:.1f}%] "
                  f"— cooling {CHUNK_PAUSE}s ──")
            time.sleep(CHUNK_PAUSE)

    print_matchup_benchmark_result(combined_result)
    return combined_result


def summarize_result(name, result, stage=1):
    ci_low, ci_high = result.win_rate_ci_a
    return {
        'probe': name,
        'stage': stage,
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
        'promising': result.win_rate_a >= PROMISING_THRESHOLD,
    }


def save_results(stage1_summaries, stage2_summaries, config):
    output = {
        'phase': 64,
        'config': config,
        'stage1': stage1_summaries,
        'stage2': stage2_summaries,
    }
    output_path = 'phase64_results.json'
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)
    print(f"\n  Results saved to {output_path}")


def main():
    # Parse args
    probe_filter = 'all'
    do_stage2 = False
    n_deals = DEFAULT_DEALS

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == '--probe' and i + 1 < len(args):
            probe_filter = args[i + 1]
            i += 2
        elif args[i] == '--stage2':
            do_stage2 = True
            i += 1
        elif args[i] == '--deals' and i + 1 < len(args):
            n_deals = int(args[i + 1])
            i += 2
        else:
            i += 1

    # Select probes
    if probe_filter == 'all':
        probes = list(PROBE_MAP.items())
    elif probe_filter in PROBE_MAP:
        probes = [(probe_filter, PROBE_MAP[probe_filter])]
    else:
        print(f"Unknown probe: {probe_filter}. Options: broad, dw3, texture, all")
        sys.exit(1)

    config = {
        'stage1_deals': n_deals,
        'stage2_deals': STAGE2_DEALS if do_stage2 else 0,
        'target_score': TARGET_SCORE,
        'seed': BASE_SEED,
        'chunk_size': CHUNK_SIZE,
        'chunk_pause_s': CHUNK_PAUSE,
        'probe_filter': probe_filter,
    }

    print("=" * 60)
    print("  PHASE 64: SOLVER FALSIFICATION BENCHMARK (SAFE MODE)")
    print("=" * 60)
    print(f"  Deals per probe: {n_deals} ({n_deals * 2} games)")
    print(f"  Chunk size: {CHUNK_SIZE} deals ({CHUNK_SIZE * 2} games)")
    print(f"  Probes: {', '.join(name for _, (name, _) in probes)}")
    print(f"  Stage 2: {'YES' if do_stage2 else 'NO (pass --stage2 to enable)'}")
    print()

    # ── Stage 1 ──
    print("\n" + "═" * 60)
    print("  STAGE 1: QUICK SCREEN")
    print("═" * 60)

    stage1_summaries = []
    stage1_results = {}

    for idx, (key, (name, factory)) in enumerate(probes):
        result = run_chunked_matchup(name, factory, n_deals, seed_offset=idx * 100000)
        stage1_results[key] = result
        stage1_summaries.append(summarize_result(name, result, stage=1))

        # Save after each probe (incremental safety)
        save_results(stage1_summaries, [], config)

        # Extra cooling between probes
        if idx < len(probes) - 1:
            print(f"\n    ═══ Cooling 3s before next probe ═══\n")
            gc.collect()
            time.sleep(3.0)

    # Stage 1 summary
    print("\n" + "═" * 60)
    print("  STAGE 1 SUMMARY")
    print("═" * 60)
    print(f"  {'Probe':<22} {'WR%':>6} {'95% CI':>16} {'Pts±':>7} {'Promise':>8}")
    print(f"  {'─' * 22} {'─' * 6} {'─' * 16} {'─' * 7} {'─' * 8}")
    for s in stage1_summaries:
        ci_str = f"[{s['ci_95_low']:5.1f}%, {s['ci_95_high']:5.1f}%]"
        promise_str = "YES ✓" if s['promising'] else "no"
        print(f"  {s['probe']:<22} {s['win_rate']:>5.1f}% {ci_str:>16} {s['avg_pt_diff']:>+6.1f} {promise_str:>8}")

    # ── Stage 2 ──
    stage2_summaries = []

    if do_stage2:
        promising = [(k, PROBE_MAP[k]) for k in [key for key, (_, _) in probes]
                     if stage1_results[k].win_rate_a >= PROMISING_THRESHOLD]
        if promising:
            print("\n" + "═" * 60)
            print("  STAGE 2: CONFIRMATION")
            print("═" * 60)
            print(f"  Advancing: {', '.join(PROBE_MAP[k][0] for k, _ in promising)}")

            for idx, (key, (name, factory)) in enumerate(promising):
                result = run_chunked_matchup(name, factory, STAGE2_DEALS,
                                             seed_offset=500000 + idx * 100000)
                stage2_summaries.append(summarize_result(name, result, stage=2))
                save_results(stage1_summaries, stage2_summaries, config)
                gc.collect()
                time.sleep(3.0)

            print("\n" + "═" * 60)
            print("  STAGE 2 SUMMARY")
            print("═" * 60)
            for s in stage2_summaries:
                ci_str = f"[{s['ci_95_low']:5.1f}%, {s['ci_95_high']:5.1f}%]"
                print(f"  {s['probe']:<22} {s['win_rate']:>5.1f}% {ci_str:>16} {s['avg_pt_diff']:>+6.1f}")
        else:
            print("\n  [Stage 2 skipped: no promising probes]")

    save_results(stage1_summaries, stage2_summaries, config)

    # ── Verdict ──
    print("\n" + "═" * 60)
    print("  PHASE 64: PRELIMINARY VERDICT")
    print("═" * 60)

    final = stage2_summaries if stage2_summaries else stage1_summaries
    if final:
        best = max(final, key=lambda s: s['win_rate'])
        if best['ci_95_low'] > 50.0:
            print(f"  SIGNAL VALIDATED: {best['probe']} wins at {best['win_rate']:.1f}%")
            print(f"  95% CI: [{best['ci_95_low']:.1f}%, {best['ci_95_high']:.1f}%]")
        elif best['win_rate'] > 50.0:
            print(f"  SUGGESTIVE: {best['probe']} at {best['win_rate']:.1f}%")
            print(f"  95% CI: [{best['ci_95_low']:.1f}%, {best['ci_95_high']:.1f}%]")
            print(f"  → Needs more games for confidence")
        else:
            print(f"  NO SIGNAL: best probe {best['probe']} at {best['win_rate']:.1f}%")
            print(f"  → Solver low-stock knock bias likely falsified (World 3)")

    print("═" * 60)


if __name__ == '__main__':
    main()
