"""
CLI runner for rigorous Gin Rummy AI benchmarking.

Examples:
  python benchmark.py
  python benchmark.py --games 4000 --seed 20260305 --players DeepKnock,Heisenbot,Titan
"""

import argparse
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gin_rummy.benchmark import (
    print_matchup_benchmark_result,
    print_round_robin_benchmark,
    run_seeded_round_robin,
)
from gin_rummy.apex import Apex
from gin_rummy.deepknock import DeepKnock
from gin_rummy.heisenbot import Heisenbot
from gin_rummy.player import RandomPlayer, SimplePlayer
from gin_rummy.nexus import Nexus
from gin_rummy.titan import Titan


def _parse_args():
    parser = argparse.ArgumentParser(description="Deterministic, seat-balanced Gin Rummy benchmark runner")
    parser.add_argument("--games", type=int, default=2000, help="Games per matchup (default: 2000)")
    parser.add_argument("--target", type=int, default=100, help="Target score per game (default: 100)")
    parser.add_argument("--seed", type=int, default=20260305, help="Base seed for reproducibility")
    parser.add_argument("--elo-k", type=float, default=24.0, help="Elo K-factor (default: 24)")
    parser.add_argument(
        "--players",
        type=str,
        default="Simple,Heisenbot,DeepKnock,Titan,Apex,Nexus",
        help="Comma-separated player names",
    )
    parser.add_argument(
        "--show-matchups",
        action="store_true",
        help="Print full detailed report for every matchup",
    )
    parser.add_argument(
        "--no-progress",
        action="store_true",
        help="Disable progress display",
    )
    return parser.parse_args()


def _build_player_factories(player_names):
    available = {
        "Simple": lambda: SimplePlayer("Simple"),
        "Random": lambda: RandomPlayer("Random"),
        "Heisenbot": lambda: Heisenbot("Heisenbot"),
        "DeepKnock": lambda: DeepKnock("DeepKnock"),
        "Titan": lambda: Titan("Titan"),
        "Apex": lambda: Apex("Apex"),
        "Nexus": lambda: Nexus("Nexus"),
    }

    factories = {}
    for name in player_names:
        if name not in available:
            valid = ", ".join(sorted(available.keys()))
            raise ValueError(f"Unknown player '{name}'. Valid options: {valid}")
        factories[name] = available[name]
    return factories


def main():
    args = _parse_args()

    selected = [name.strip() for name in args.players.split(",") if name.strip()]
    if len(selected) < 2:
        raise ValueError("Need at least 2 players for benchmarking")

    player_factories = _build_player_factories(selected)

    print("=" * 78)
    print("  GIN RUMMY REPRODUCIBLE BENCHMARK")
    print("=" * 78)
    print(f"Players: {', '.join(player_factories.keys())}")
    print(f"Games per matchup: {args.games}")
    print(f"Target score: {args.target}")
    print(f"Base seed: {args.seed}")
    print(f"Elo K-factor: {args.elo_k}")

    summary = run_seeded_round_robin(
        player_factories=player_factories,
        n_games_per_matchup=args.games,
        target_score=args.target,
        seed=args.seed,
        elo_k=args.elo_k,
        progress=not args.no_progress,
    )

    print_round_robin_benchmark(summary)

    if args.show_matchups:
        for key in summary.results:
            print_matchup_benchmark_result(summary.results[key])


if __name__ == "__main__":
    main()
