#!/usr/bin/env python3
"""
Critical Situation Benchmark (CSB) miner — Sprint 2.

Plays ApexMCTS self-play (or ApexMCTS vs Apex) and records draw decisions
where Apex heuristic and MC search disagree with sufficient margin.

Outputs:
  data/csb_disagreements.json

Usage:
  python scripts/mine_csb_disagreements.py --games 40 --seed 20260712
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESEARCH_ROOT = os.path.join(REPO_ROOT, "docs", "archive", "research")
if RESEARCH_ROOT not in sys.path:
    sys.path.insert(0, RESEARCH_ROOT)

from gin_rummy.apex_mcts import ApexMCTS, OVERRIDE_MARGIN  # noqa: E402
from gin_rummy.card import card_str  # noqa: E402
from gin_rummy.draw_search import evaluate_draw_choice  # noqa: E402
from gin_rummy.game import GinRummyGame  # noqa: E402
from gin_rummy.meld import compute_deadwood  # noqa: E402


class InstrumentedApexMCTS(ApexMCTS):
    """ApexMCTS that records draw disagreements for CSB."""

    def __init__(self, *args, miner_log: Optional[List[Dict[str, Any]]] = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.miner_log = miner_log if miner_log is not None else []
        self._game_id = 0
        self._hand_id = 0

    def new_hand(self, hand, opponent_id):
        super().new_hand(hand, opponent_id)
        self._hand_id += 1

    def draw_decision(self, top_discard, hand, game_state):
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)
        self.turn = game_state["turn_number"]
        self.my_score = game_state.get("my_score", 0)
        self.opp_score = game_state.get("opp_score", 0)

        for c in game_state.get("discard_pile", []):
            self.discard_pile_cards.add(c)
            if c not in self.hand:
                self.model.set_discard(c)

        apex_decision = self._apex_draw_decision(top_discard, hand, game_state)
        should_take, take_ev, stock_ev, diag = evaluate_draw_choice(
            hand=hand,
            top_discard=top_discard,
            opponent_model=self.model,
            game_state=game_state,
            num_worlds=self._num_worlds,
            rollout_depth=self._rollout_depth,
            info_penalty=self._info_penalty,
            rng=self._search_rng,
            use_weighted_worlds=True,
        )

        self._search_count += 1
        final = apex_decision

        if diag.get("skipped") or should_take is None:
            self._skip_count += 1
            final = apex_decision
        else:
            margin = diag.get("margin", 0.0)
            search_decision = bool(should_take)
            if search_decision == apex_decision:
                self._agree_count += 1
                final = apex_decision
            elif abs(margin) >= self._override_margin:
                self._override_count += 1
                final = search_decision
                self.miner_log.append(
                    {
                        "kind": "draw_disagreement_override",
                        "game_id": self._game_id,
                        "hand_id": self._hand_id,
                        "turn": game_state.get("turn_number"),
                        "my_score": game_state.get("my_score"),
                        "opp_score": game_state.get("opp_score"),
                        "deck_remaining": game_state.get("deck_remaining"),
                        "top_discard": card_str(top_discard),
                        "hand": [card_str(c) for c in sorted(hand)],
                        "current_dw": compute_deadwood(hand),
                        "apex_source": "discard" if apex_decision else "stock",
                        "search_source": "discard" if search_decision else "stock",
                        "final_source": "discard" if final else "stock",
                        "take_ev": take_ev,
                        "stock_ev": stock_ev,
                        "margin": margin,
                        "diagnostics": {
                            k: diag[k]
                            for k in (
                                "worlds_evaluated",
                                "take_ev_raw",
                                "take_ev_adjusted",
                                "stock_ev",
                                "weighted_worlds",
                            )
                            if k in diag
                        },
                    }
                )
            else:
                self._fallback_count += 1
                final = apex_decision
                if search_decision != apex_decision:
                    self.miner_log.append(
                        {
                            "kind": "draw_disagreement_weak",
                            "game_id": self._game_id,
                            "hand_id": self._hand_id,
                            "turn": game_state.get("turn_number"),
                            "my_score": game_state.get("my_score"),
                            "opp_score": game_state.get("opp_score"),
                            "deck_remaining": game_state.get("deck_remaining"),
                            "top_discard": card_str(top_discard),
                            "hand": [card_str(c) for c in sorted(hand)],
                            "current_dw": compute_deadwood(hand),
                            "apex_source": "discard" if apex_decision else "stock",
                            "search_source": "discard" if search_decision else "stock",
                            "final_source": "discard" if final else "stock",
                            "take_ev": take_ev,
                            "stock_ev": stock_ev,
                            "margin": margin,
                        }
                    )

        if final:
            self._last_discard = None
        return final


def run_mining(n_games: int, seed: int, target: int) -> Dict[str, Any]:
    log: List[Dict[str, Any]] = []
    stats_acc = {
        "searches": 0,
        "overrides": 0,
        "agreements": 0,
        "fallbacks": 0,
        "skips": 0,
    }

    for g in range(n_games):
        game_seed = seed + g
        random.seed(game_seed)
        p0 = InstrumentedApexMCTS("AMCTS0", seed=game_seed, miner_log=log)
        p1 = InstrumentedApexMCTS("AMCTS1", seed=game_seed + 1, miner_log=log)
        p0._game_id = g
        p1._game_id = g
        GinRummyGame(p0, p1, target_score=target, verbose=False).play_game()
        for bot in (p0, p1):
            s = bot.get_search_stats()
            stats_acc["searches"] += s["total_searches"]
            stats_acc["overrides"] += s["overrides"]
            stats_acc["agreements"] += s["agreements"]
            stats_acc["fallbacks"] += s["fallbacks"]
            stats_acc["skips"] += s["skips"]

    overrides = [x for x in log if x["kind"] == "draw_disagreement_override"]
    weak = [x for x in log if x["kind"] == "draw_disagreement_weak"]

    return {
        "report": "csb_disagreement_mine",
        "sprint": "sprint2",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "games": n_games,
            "seed": seed,
            "target_score": target,
            "override_margin": OVERRIDE_MARGIN,
            "methodology": "ApexMCTS self-play; log Apex-vs-search draw disagreements",
        },
        "summary": {
            "total_spots_logged": len(log),
            "overrides": len(overrides),
            "weak_disagreements": len(weak),
            "search_stats_sum": stats_acc,
            "override_rate": (
                round(stats_acc["overrides"] / max(1, stats_acc["searches"]), 4)
            ),
        },
        "spots": log,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Mine CSB draw disagreements")
    parser.add_argument("--games", type=int, default=40)
    parser.add_argument("--seed", type=int, default=20260712)
    parser.add_argument("--target", type=int, default=100)
    parser.add_argument(
        "--out",
        type=str,
        default=os.path.join(REPO_ROOT, "data", "csb_disagreements.json"),
    )
    args = parser.parse_args()

    t0 = time.time()
    print(f"Mining CSB spots: games={args.games} seed={args.seed}")
    report = run_mining(args.games, args.seed, args.target)
    report["elapsed_seconds"] = round(time.time() - t0, 3)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")

    s = report["summary"]
    print(
        f"Done in {report['elapsed_seconds']}s | "
        f"spots={s['total_spots_logged']} overrides={s['overrides']} "
        f"weak={s['weak_disagreements']} override_rate={s['override_rate']}"
    )
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
