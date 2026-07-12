#!/usr/bin/env python3
"""
Apex Sprint-1 baseline report harness.

Runs seat-balanced duplicate matchups and writes JSON with:
  - win rates + Wilson 95% CI
  - average scores / score differential
  - gins and undercuts
  - void hands

Usage (from repo root):
  python scripts/apex_baseline_report.py
  python scripts/apex_baseline_report.py --games 100 --seed 20260711
  python scripts/apex_baseline_report.py --players Apex,Heisenbot --games 200
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

# Research package lives under docs/archive/research (root gin_rummy/ is partial).
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESEARCH_ROOT = os.path.join(REPO_ROOT, "docs", "archive", "research")
if RESEARCH_ROOT not in sys.path:
    sys.path.insert(0, RESEARCH_ROOT)

from gin_rummy.apex import Apex  # noqa: E402
from gin_rummy.benchmark import run_balanced_matchup, wilson_interval  # noqa: E402
from gin_rummy.deepknock import DeepKnock  # noqa: E402
from gin_rummy.heisenbot import Heisenbot  # noqa: E402
from gin_rummy.nexus import Nexus  # noqa: E402
from gin_rummy.player import RandomPlayer, SimplePlayer  # noqa: E402
from gin_rummy.titan import Titan  # noqa: E402

try:
    from gin_rummy.apex_mcts import ApexMCTS
except Exception:  # pragma: no cover - optional heavy deps
    ApexMCTS = None  # type: ignore


def _factories() -> Dict[str, Any]:
    available = {
        "Simple": lambda: SimplePlayer("Simple"),
        "Random": lambda: RandomPlayer("Random"),
        "Heisenbot": lambda: Heisenbot("Heisenbot"),
        "DeepKnock": lambda: DeepKnock("DeepKnock"),
        "Titan": lambda: Titan("Titan"),
        "Apex": lambda: Apex("Apex"),
        "Nexus": lambda: Nexus("Nexus"),
    }
    if ApexMCTS is not None:
        available["ApexMCTS"] = lambda: ApexMCTS("ApexMCTS")
    return available


def _matchup_to_dict(result) -> Dict[str, Any]:
    ci_a = wilson_interval(result.wins_a, result.games_played)
    ci_b = wilson_interval(result.wins_b, result.games_played)
    return {
        "player_a": result.player_a,
        "player_b": result.player_b,
        "games_played": result.games_played,
        "deals": result.games_played // 2,
        "wins": {result.player_a: result.wins_a, result.player_b: result.wins_b},
        "win_rate": {
            result.player_a: round(result.win_rate_a, 6),
            result.player_b: round(result.win_rate_b, 6),
        },
        "win_rate_ci95": {
            result.player_a: {"low": round(ci_a[0], 6), "high": round(ci_a[1], 6)},
            result.player_b: {"low": round(ci_b[0], 6), "high": round(ci_b[1], 6)},
        },
        "avg_score": {
            result.player_a: round(result.avg_points_a, 4),
            result.player_b: round(result.avg_points_b, 4),
        },
        "avg_score_diff_a": round(result.avg_point_diff_a, 4),
        "gins": {
            result.player_a: result.total_gins_a,
            result.player_b: result.total_gins_b,
        },
        "undercuts": {
            result.player_a: result.total_undercuts_a,
            result.player_b: result.total_undercuts_b,
        },
        "undercut_rate_per_game": {
            result.player_a: round(result.total_undercuts_a / max(1, result.games_played), 6),
            result.player_b: round(result.total_undercuts_b / max(1, result.games_played), 6),
        },
        "total_hands": result.total_hands,
        "void_hands": result.total_void_hands,
        "avg_hands_per_game": round(result.avg_hands_per_game, 4),
        "seat_balance": {
            f"{result.player_a}_as_p0": result.seat_games_a_p0,
            f"{result.player_a}_as_p1": result.seat_games_a_p1,
        },
    }


def run_report(
    players: List[str],
    games: int,
    seed: int,
    target: int,
    progress: bool,
) -> Dict[str, Any]:
    factories_all = _factories()
    missing = [p for p in players if p not in factories_all]
    if missing:
        raise SystemExit(f"Unknown players: {missing}. Valid: {sorted(factories_all)}")

    factories = {name: factories_all[name] for name in players}
    matchups: List[Dict[str, Any]] = []
    started = time.time()

    for i, a in enumerate(players):
        for b in players[i + 1 :]:
            matchup_seed = seed + len(matchups) * 1000003
            print(f"\n=== {a} vs {b} | deals={games} seed={matchup_seed} ===")
            result = run_balanced_matchup(
                factories[a],
                factories[b],
                n_games=games,
                target_score=target,
                seed=matchup_seed,
                progress=progress,
            )
            payload = _matchup_to_dict(result)
            payload["seed"] = matchup_seed
            matchups.append(payload)
            print(
                f"  WR {a} {payload['win_rate'][a]*100:.2f}% | "
                f"{b} {payload['win_rate'][b]*100:.2f}% | "
                f"scoreΔ(A) {payload['avg_score_diff_a']:+.2f} | "
                f"UC {a}:{payload['undercuts'][a]} {b}:{payload['undercuts'][b]}"
            )

    elapsed = time.time() - started
    return {
        "report": "apex_baseline",
        "sprint": "sprint1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repo_root": REPO_ROOT,
        "research_root": RESEARCH_ROOT,
        "config": {
            "players": players,
            "deals_per_matchup": games,
            "games_per_matchup": games * 2,
            "target_score": target,
            "base_seed": seed,
            "methodology": "seat-balanced duplicate (each deal played twice, seats swapped)",
        },
        "elapsed_seconds": round(elapsed, 3),
        "matchups": matchups,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Apex baseline JSON report")
    parser.add_argument(
        "--players",
        type=str,
        default="Apex,Heisenbot",
        help="Comma-separated player names (default: Apex,Heisenbot)",
    )
    parser.add_argument(
        "--games",
        type=int,
        default=200,
        help="Unique deals per matchup (total games = 2×). Default 200 for sprint smoke; use 1000+ for promotion.",
    )
    parser.add_argument("--seed", type=int, default=20260711)
    parser.add_argument("--target", type=int, default=100)
    parser.add_argument(
        "--out",
        type=str,
        default=os.path.join(REPO_ROOT, "data", "apex_baseline_report.json"),
        help="Output JSON path",
    )
    parser.add_argument("--no-progress", action="store_true")
    args = parser.parse_args()

    players = [p.strip() for p in args.players.split(",") if p.strip()]
    if len(players) < 2:
        raise SystemExit("Need at least two players")

    report = run_report(
        players=players,
        games=args.games,
        seed=args.seed,
        target=args.target,
        progress=not args.no_progress,
    )

    out_path = args.out
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")

    print(f"\nWrote baseline report: {out_path}")
    print(f"Elapsed: {report['elapsed_seconds']}s")


if __name__ == "__main__":
    main()
