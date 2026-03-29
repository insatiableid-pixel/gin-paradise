"""
Multi-Lane Oracle Proxy Benchmark — Directive 108.

Hardened from Directive 107: the benchmark is now a pure consumer of
frozen per-lane target artifacts produced offline by prepare.py.

Key changes from 107:
  - No online oracle recomputation: all lane truth is loaded from frozen targets
  - Per-lane metrics include oracle-distance terms (EV gap, score distance)
  - The aggregate score combines accuracy + distance metrics

Lanes:
  1. KNOCK lane  — existing low-stock knock/continue (frozen targets from prepare.py)
  2. DRAW lane   — draw-source decision (frozen oracle targets)
  3. DISCARD lane — discard safety / selection quality (frozen oracle targets)

The abstraction layer is imported from oracle_abstractions.py.
"""

from __future__ import annotations

import json
import math
import os
import random
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAB_DIR = os.path.dirname(os.path.abspath(__file__))

import sys
sys.path.insert(0, ROOT_DIR)
sys.path.insert(0, LAB_DIR)

from prepare import (
    ARTIFACT_DIR,
    SpotRecord,
    load_eval_spots,
    load_manifest,
    load_frozen_knock_targets,
    load_frozen_draw_targets,
    load_frozen_discard_targets,
    prepare_lab,
)

from oracle_abstractions import (
    build_oracle_info_state,
    OracleInfoState,
    deadwood_bucket,
    deck_phase_bucket,
    upcard_utility_bucket,
    opponent_memory_bucket,
    opponent_danger_score,
)

try:
    from gin_rummy.meld import compute_deadwood, best_meld_arrangement
    from gin_rummy.card import rank, suit, make_card, deadwood_value, NUM_CARDS
    from gin_rummy.endgame_solver import PublicState, evaluate_knock_now
    from gin_rummy.belief_world_generator import generate_belief_weighted_worlds
except ModuleNotFoundError:
    pass


# ── Lane Weight Configuration ────────────────────────────────────────
# These define how per-lane scores combine into the aggregate.
# The knock lane remains dominant since it has the strongest held-out reference.

LANE_WEIGHTS = {
    "knock": 0.60,      # dominant — has full reference labels
    "draw": 0.25,       # draw-source decision quality
    "discard": 0.15,    # discard safety / selection quality
}

# ── Knock Lane ────────────────────────────────────────────────────────
# The knock lane consumes frozen targets from prepare.py.
# Proxy metrics now include EV-gap distance alongside accuracy.


def run_knock_lane(train_result: Dict, frozen_knock_targets: List[Dict]) -> Dict:
    """
    Extract knock lane metrics from a completed train.py run.
    Now computes oracle-distance metrics using frozen targets.
    """
    metrics = train_result.get("metrics", {})
    score = metrics.get("score", 0.0)

    # Oracle distance: compute average EV-gap weighted regret from frozen targets
    detail = metrics.get("detail", [])
    ev_gap_total = 0.0
    ev_gap_count = 0
    for i, target in enumerate(frozen_knock_targets):
        if i < len(detail):
            d = detail[i]
            # Candidate chose action -> what's the distance to oracle best EV?
            target_gap = target.get("ev_gap", 0.0)
            ev_gap_total += target_gap
            ev_gap_count += 1

    avg_target_ev_gap = ev_gap_total / ev_gap_count if ev_gap_count else 0.0

    return {
        "lane": "knock",
        "score": score,
        "accuracy": metrics.get("accuracy_vs_best", 0.0),
        "knock_rate": metrics.get("knock_rate", 0.0),
        "false_positive_rate": metrics.get("false_positive_rate", 0.0),
        "undercut_rate_when_knock": metrics.get("undercut_rate_when_knock", 0.0),
        "avg_regret_points": metrics.get("avg_regret_points", 0.0),
        "avg_target_ev_gap": round(avg_target_ev_gap, 4),
        "n_eval": metrics.get("n_eval", 0),
        "targets_consumed": "frozen",
    }


# ── Draw Lane ─────────────────────────────────────────────────────────
# Now consumes frozen oracle targets. No online oracle recomputation.


def _predict_draw_action(
    spot: SpotRecord,
    info_state: OracleInfoState,
) -> str:
    """
    Candidate draw-source policy using the abstraction layer.
    This is the evolvable component for the draw lane.
    """
    if not spot.discard_pile:
        return "stock"

    upcard = spot.discard_pile[-1]
    utility = info_state.upcard_utility

    # Heuristic policy based on abstraction features
    # Higher utility → more likely to take
    if utility >= 3:
        return "take"  # completes a meld
    if utility >= 2 and info_state.deck_phase <= 2:
        return "take"  # useful card in late game
    if utility >= 2 and info_state.dw_bucket >= 4:
        return "take"  # useful card when deadwood is high

    return "stock"


def run_draw_lane(
    eval_spots: List[SpotRecord],
    frozen_draw_targets: List[Dict],
) -> Dict:
    """
    Run the draw lane benchmark using frozen oracle targets.
    No online oracle recomputation — purely a consumer of frozen labels.
    """
    total = 0
    correct = 0
    take_count = 0
    oracle_take_count = 0
    skipped = 0
    score_distance_total = 0.0  # oracle distance metric

    for idx, spot in enumerate(eval_spots):
        if idx >= len(frozen_draw_targets):
            break

        target = frozen_draw_targets[idx]
        if target is None:
            skipped += 1
            continue

        oracle_action = target["best_action"]
        info_state = build_oracle_info_state(spot)
        candidate_action = _predict_draw_action(spot, info_state)

        total += 1
        if candidate_action == oracle_action:
            correct += 1
        if candidate_action == "take":
            take_count += 1
        if oracle_action == "take":
            oracle_take_count += 1

        # Oracle distance: how far is candidate's score from oracle's best score?
        if candidate_action == oracle_action:
            score_distance_total += 0.0
        else:
            # EV gap between oracle's best and candidate's chosen action
            score_distance_total += target.get("ev_gap", 0.0)

    if total == 0:
        return {"lane": "draw", "score": 0.0, "n_eval": 0, "skipped": skipped,
                "targets_consumed": "frozen"}

    accuracy = correct / total
    take_rate = take_count / total
    oracle_take_rate = oracle_take_count / total
    overtake = max(0.0, take_rate - oracle_take_rate)
    avg_score_distance = score_distance_total / total

    # Draw lane score: accuracy minus overtake penalty minus distance penalty
    score = accuracy - 0.30 * overtake - 0.10 * min(avg_score_distance / 5.0, 1.0)

    return {
        "lane": "draw",
        "score": round(score, 4),
        "accuracy": round(accuracy, 4),
        "take_rate": round(take_rate, 4),
        "oracle_take_rate": round(oracle_take_rate, 4),
        "overtake": round(overtake, 4),
        "avg_score_distance": round(avg_score_distance, 4),
        "n_eval": total,
        "skipped": skipped,
        "targets_consumed": "frozen",
    }


# ── Discard Lane ──────────────────────────────────────────────────────
# Now consumes frozen oracle targets. No online oracle recomputation.


def _candidate_discard_selection(
    hand_11: List[int],
    spot: SpotRecord,
    info_state: OracleInfoState,
    drawn_from_discard: bool = False,
    drawn_card: Optional[int] = None,
) -> int:
    """
    Candidate discard policy using abstraction layer + safety.
    This is the evolvable component for the discard lane.
    """
    # Primary: DW-minimizing set
    dw_scores = {}
    for i, c in enumerate(hand_11):
        if drawn_from_discard and c == drawn_card:
            continue
        remaining = hand_11[:i] + hand_11[i + 1:]
        dw = compute_deadwood(remaining)
        dw_scores[c] = dw

    if not dw_scores:
        return hand_11[0]

    min_dw = min(dw_scores.values())
    # Candidates that achieve optimal DW
    optimal_set = [c for c, dw in dw_scores.items() if dw == min_dw]

    if len(optimal_set) == 1:
        return optimal_set[0]

    # Tie-break: prefer safest discard among DW-optimal choices
    def safety_score(card):
        r, s = rank(card), suit(card)
        danger = 0.0
        for pickup in spot.known_opponent_pickups:
            pr, ps = rank(pickup), suit(pickup)
            if pr == r:
                danger += 2.0
            if ps == s and abs(pr - r) <= 2:
                danger += 1.5
        for declined in spot.upcard_declines:
            dr, ds = rank(declined), suit(declined)
            if dr == r:
                danger -= 0.5
            if ds == s and abs(dr - r) <= 1:
                danger -= 0.3
        return danger

    safest = min(optimal_set, key=safety_score)
    return safest


def run_discard_lane(
    eval_spots: List[SpotRecord],
    frozen_discard_targets: List[Dict],
) -> Dict:
    """
    Run the discard lane benchmark using frozen oracle targets.
    No online oracle recomputation — purely a consumer of frozen labels.
    """
    total = 0
    correct = 0
    safety_bonus_total = 0.0
    dw_distance_total = 0.0  # oracle distance: DW distance to optimal

    for idx, spot in enumerate(eval_spots):
        if idx >= len(frozen_discard_targets):
            break

        target = frozen_discard_targets[idx]
        if target is None:
            continue

        oracle_discard = target["oracle_discard"]
        oracle_discard_dw = target["oracle_discard_dw"]
        hand_11 = target["hand_11"]

        info_state = build_oracle_info_state(spot)
        candidate_discard = _candidate_discard_selection(
            hand_11, spot, info_state, False, None)

        total += 1

        if candidate_discard == oracle_discard:
            correct += 1

        # Oracle distance: DW distance between candidate choice and oracle optimal
        # How much worse is the candidate's resulting hand?
        all_dw = target.get("all_dw_scores", {})
        candidate_dw = all_dw.get(str(candidate_discard), oracle_discard_dw)
        dw_distance = max(0, candidate_dw - oracle_discard_dw)
        dw_distance_total += dw_distance

        # Safety-awareness: measure whether the candidate avoids
        # dangerous discards relative to oracle
        safety_scores = target.get("safety_scores", {})
        oracle_danger = safety_scores.get(str(oracle_discard), 0.0)
        candidate_danger = safety_scores.get(str(candidate_discard), 0.0)
        if candidate_danger < oracle_danger:
            safety_bonus_total += 0.01  # small bonus for safer choice

    if total == 0:
        return {"lane": "discard", "score": 0.0, "n_eval": 0,
                "targets_consumed": "frozen"}

    accuracy = correct / total
    safety_bonus = safety_bonus_total / total
    avg_dw_distance = dw_distance_total / total

    # Discard lane score: accuracy + safety bonus - DW distance penalty
    score = accuracy + safety_bonus - 0.05 * min(avg_dw_distance / 3.0, 1.0)

    return {
        "lane": "discard",
        "score": round(score, 4),
        "accuracy": round(accuracy, 4),
        "safety_bonus": round(safety_bonus, 4),
        "avg_dw_distance": round(avg_dw_distance, 4),
        "n_eval": total,
        "targets_consumed": "frozen",
    }


# ── Aggregate Promotion Score ─────────────────────────────────────────

def compute_aggregate_score(lane_results: Dict[str, Dict]) -> Dict:
    """
    Compute the aggregate promotion score from per-lane results.

    The aggregate is a weighted combination of per-lane scores.
    This is the single number used for promotion decisions.
    """
    weighted_sum = 0.0
    total_weight = 0.0
    per_lane = {}

    for lane_name, weight in LANE_WEIGHTS.items():
        result = lane_results.get(lane_name, {})
        lane_score = result.get("score", 0.0)
        per_lane[lane_name] = {
            "score": lane_score,
            "weight": weight,
            "weighted_contribution": round(lane_score * weight, 4),
        }
        weighted_sum += lane_score * weight
        total_weight += weight

    aggregate = weighted_sum / total_weight if total_weight > 0 else 0.0

    return {
        "aggregate_score": round(aggregate, 4),
        "per_lane": per_lane,
        "lane_weights": LANE_WEIGHTS,
    }


# ── Full Multi-Lane Benchmark Runner ──────────────────────────────────

def run_multi_lane_benchmark(
    train_result: Dict,
    eval_spots: Optional[List[SpotRecord]] = None,
    seed: int = 108,
) -> Dict:
    """
    Run the full multi-lane benchmark using frozen targets.

    Args:
        train_result: Result dict from existing train.py run (knock lane)
        eval_spots: Eval spots for draw and discard lanes
        seed: Random seed (retained for compatibility but targets are frozen)

    Returns:
        Full benchmark result with per-lane and aggregate scores
    """
    if eval_spots is None:
        eval_spots = load_eval_spots()

    t0 = time.perf_counter()

    # Load frozen targets
    frozen_knock_targets = load_frozen_knock_targets()
    frozen_draw_targets = load_frozen_draw_targets()
    frozen_discard_targets = load_frozen_discard_targets()

    print(f"  [TARGETS] Loaded frozen targets: knock={len(frozen_knock_targets)}, "
          f"draw={len(frozen_draw_targets)}, discard={len(frozen_discard_targets)}")

    # Lane 1: Knock (from existing train.py + frozen targets)
    knock_result = run_knock_lane(train_result, frozen_knock_targets)
    print(f"  [KNOCK LANE]   score={knock_result['score']:.4f}")

    # Lane 2: Draw source (frozen targets)
    draw_result = run_draw_lane(eval_spots, frozen_draw_targets)
    print(f"  [DRAW LANE]    score={draw_result['score']:.4f}  "
          f"acc={draw_result.get('accuracy', 0):.4f}  "
          f"dist={draw_result.get('avg_score_distance', 0):.4f}  "
          f"n={draw_result['n_eval']}")

    # Lane 3: Discard safety (frozen targets)
    discard_result = run_discard_lane(eval_spots, frozen_discard_targets)
    print(f"  [DISCARD LANE] score={discard_result['score']:.4f}  "
          f"acc={discard_result.get('accuracy', 0):.4f}  "
          f"dw_dist={discard_result.get('avg_dw_distance', 0):.4f}  "
          f"n={discard_result['n_eval']}")

    lane_results = {
        "knock": knock_result,
        "draw": draw_result,
        "discard": discard_result,
    }

    aggregate = compute_aggregate_score(lane_results)
    elapsed = time.perf_counter() - t0

    print(f"\n  [AGGREGATE]    score={aggregate['aggregate_score']:.4f}  "
          f"({elapsed:.1f}s)")

    return {
        "multi_lane": True,
        "directive": 108,
        "targets_mode": "frozen_offline",
        "lane_results": lane_results,
        "aggregate": aggregate,
        "elapsed_sec": round(elapsed, 2),
        "seed": seed,
    }
