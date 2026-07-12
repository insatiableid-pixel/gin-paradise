"""
Patience population evaluation tool.

Supports:
1. Mirror/self-play: run a bot against itself to reveal void-heavy or
   pathological dynamics.
2. Patient-field round-robin: run patience-only candidates against each other.
3. Diagnostic output: non-gin clinch/low-stock opportunities, undercuts,
   gins, voids, average hands per game.

Usage:
  python tools/evaluate_patience_population.py --mode mirror --bot ApexMCTSGoGin --games 60 --seed 20260305
  python tools/evaluate_patience_population.py --mode field --games 40 --seed 20260305
"""

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from gin_rummy.benchmark import (
    run_balanced_matchup,
    run_seeded_round_robin,
    print_matchup_benchmark_result,
    print_round_robin_benchmark,
)
from gin_rummy.apex_mcts_gogin import ApexMCTSGoGin
from gin_rummy.apex_mcts_clinch_gogin import ApexMCTSClinchGoGin
from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin
from gin_rummy.apex_mcts_lowstock_gogin import ApexMCTSLowStockGoGin


PATIENCE_BOTS = {
    "ApexMCTSGoGin": lambda: ApexMCTSGoGin("ApexMCTSGoGin"),
    "ApexMCTSClinchOnlyGoGin": lambda: ApexMCTSClinchOnlyGoGin("ApexMCTSClinchOnlyGoGin"),
    "ApexMCTSClinchGoGin": lambda: ApexMCTSClinchGoGin("ApexMCTSClinchGoGin"),
    "ApexMCTSLowStockGoGin": lambda: ApexMCTSLowStockGoGin("ApexMCTSLowStockGoGin"),
}


def run_mirror(bot_name, n_games, target_score, seed):
    """Run a mirror/self-play matchup: bot A vs bot A with different seeds."""
    if bot_name not in PATIENCE_BOTS:
        raise ValueError(f"Unknown bot: {bot_name}. Available: {list(PATIENCE_BOTS.keys())}")

    factory = PATIENCE_BOTS[bot_name]

    # For mirror, both sides use the same bot class
    # We create two factories with slightly different internal names for clarity
    factory_a = lambda: type(factory())(name=f"{bot_name}_A")
    factory_b = lambda: type(factory())(name=f"{bot_name}_B")

    print("=" * 78)
    print(f"  MIRROR/SELF-PLAY: {bot_name}")
    print("=" * 78)
    print(f"  Games per seat: {n_games} (total = {n_games * 2})")
    print(f"  Target score: {target_score}")
    print(f"  Seed: {seed}")
    print()

    result = run_balanced_matchup(
        factory_a, factory_b,
        n_games=n_games,
        target_score=target_score,
        seed=seed,
        progress=True,
    )

    print_matchup_benchmark_result(result)

    # Additional mirror diagnostics
    total_games = result.games_played
    print(f"\n  Mirror Diagnostics:")
    print(f"  Win split: {result.wins_a} / {result.wins_b} (expected ~50/50)")
    print(f"  Total gins: {result.total_gins_a} + {result.total_gins_b} = {result.total_gins_a + result.total_gins_b}")
    print(f"  Total undercuts: {result.total_undercuts_a} + {result.total_undercuts_b} = {result.total_undercuts_a + result.total_undercuts_b}")
    print(f"  Void hands: {result.total_void_hands}")
    if total_games > 0:
        print(f"  Gin rate: {(result.total_gins_a + result.total_gins_b) / total_games:.2f} per game")
        print(f"  Void rate: {result.total_void_hands / result.total_hands:.4f} per hand" if result.total_hands > 0 else "  Void rate: N/A")
        print(f"  Avg hands/game: {result.avg_hands_per_game:.2f}")
    print()

    return result


def run_field(n_games, target_score, seed):
    """Run patient-field round-robin among all patience candidates."""
    print("=" * 78)
    print("  PATIENT-FIELD ROUND-ROBIN")
    print("=" * 78)
    print(f"  Games per matchup: {n_games}")
    print(f"  Target score: {target_score}")
    print(f"  Seed: {seed}")
    print()

    summary = run_seeded_round_robin(
        player_factories=PATIENCE_BOTS,
        n_games_per_matchup=n_games,
        target_score=target_score,
        seed=seed,
        progress=True,
    )

    print_round_robin_benchmark(summary)

    print("\n  Detailed Matchup Reports:")
    for key in summary.results:
        print_matchup_benchmark_result(summary.results[key])

    return summary


def _parse_args():
    parser = argparse.ArgumentParser(description="Patience population evaluation")
    parser.add_argument("--mode", choices=["mirror", "field"], required=True,
                       help="'mirror' for self-play, 'field' for patient-field round-robin")
    parser.add_argument("--bot", type=str, default="ApexMCTSGoGin",
                       help="Bot name for mirror mode")
    parser.add_argument("--games", type=int, default=60,
                       help="Games per matchup/mirror")
    parser.add_argument("--target", type=int, default=100,
                       help="Target score")
    parser.add_argument("--seed", type=int, default=20260305,
                       help="Base seed")
    return parser.parse_args()


def main():
    args = _parse_args()

    if args.mode == "mirror":
        run_mirror(args.bot, args.games, args.target, args.seed)
    elif args.mode == "field":
        run_field(args.games, args.target, args.seed)


if __name__ == "__main__":
    main()
