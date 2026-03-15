"""
DeepKnock vs Heisenbot: Gin Rummy AI Tournament

Runs a comprehensive tournament comparing DeepKnock against Heisenbot
and other baseline strategies, replicating the evaluation from the
Heisenbot AAAI-21 paper with our superior AI.
"""

import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gin_rummy.player import SimplePlayer, RandomPlayer
from gin_rummy.heisenbot import Heisenbot
from gin_rummy.deepknock import DeepKnock
from gin_rummy.tournament import (
    run_matchup, print_matchup_result,
    run_round_robin, print_round_robin_results,
)


def main():
    print("=" * 70)
    print("  DEEPKNOCK vs HEISENBOT: Gin Rummy AI Tournament")
    print("=" * 70)
    print()
    print("DeepKnock advantages over Heisenbot:")
    print("  1. Monte Carlo draw evaluation (expected value vs heuristic)")
    print("  2. Opponent-aware discard scoring (Bayesian model vs safety counts)")
    print("  3. Risk-aware knocking (MC opponent deadwood estimation)")
    print("  4. Adaptive strategy (game phase + score differential)")
    print()

    # --- Configuration ---
    N_GAMES = 2000  # Games per matchup (increase for tighter confidence)

    # --- Player Factories ---
    players = {
        'Simple': lambda: SimplePlayer("Simple"),
        'Heisenbot': lambda: Heisenbot("Heisenbot"),
        'DeepKnock': lambda: DeepKnock("DeepKnock"),
    }

    # --- Head-to-Head: DeepKnock vs Heisenbot ---
    print("-" * 70)
    print("  MAIN EVENT: DeepKnock vs Heisenbot")
    print("-" * 70)

    result = run_matchup(
        lambda: DeepKnock("DeepKnock"),
        lambda: Heisenbot("Heisenbot"),
        n_games=N_GAMES,
        progress=True,
    )
    print_matchup_result(result)

    dk_win_pct = result.win_pct[0]
    if dk_win_pct > 50:
        print(f"\n  >>> DeepKnock WINS with {dk_win_pct:.1f}% win rate! <<<")
    else:
        print(f"\n  >>> Heisenbot wins with {result.win_pct[1]:.1f}% win rate.")

    # --- Round Robin Tournament ---
    print(f"\n{'=' * 70}")
    print("  FULL ROUND-ROBIN TOURNAMENT")
    print(f"{'=' * 70}")

    results = run_round_robin(players, n_games=N_GAMES)

    player_names = list(players.keys())
    print_round_robin_results(results, player_names)

    # --- Detailed matchup stats ---
    print(f"\n{'=' * 70}")
    print("  DETAILED MATCHUP STATISTICS")
    print(f"{'=' * 70}")

    for key, r in results.items():
        print_matchup_result(r)

    print("\nTournament complete!")


if __name__ == "__main__":
    main()
