"""
Fixed Oracle autoresearch harness.

This is the Oracle analogue of Karpathy's prepare.py:
  - one-time data preparation
  - frozen train/eval split
  - frozen reference labels / metrics
  - runtime evaluation helpers that train.py can import

train.py is the only file the agent is meant to edit.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import time
from dataclasses import asdict, dataclass
from typing import Callable, Dict, List, Optional

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAB_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(LAB_DIR, "data")
ARTIFACT_DIR = os.path.join(LAB_DIR, "artifacts")

SOURCE_DATASET_PATH = os.path.join(ROOT_DIR, "phase68_trace_rich_dataset.json")
TRAIN_SPOTS_PATH = os.path.join(DATA_DIR, "train_spots.json")
EVAL_SPOTS_PATH = os.path.join(DATA_DIR, "eval_spots.json")
MANIFEST_PATH = os.path.join(DATA_DIR, "lab_manifest.json")

# ── Frozen Per-Lane Target Artifact Paths (Directive 108) ─────────────
KNOCK_TARGETS_PATH = os.path.join(DATA_DIR, "frozen_knock_targets.json")
DRAW_TARGETS_PATH = os.path.join(DATA_DIR, "frozen_draw_targets.json")
DISCARD_TARGETS_PATH = os.path.join(DATA_DIR, "frozen_discard_targets.json")

DATASET_VERSION = "phase68_trace_rich_dataset_v1"
TRAIN_SPLIT_SEED = 70
EVAL_SAMPLE_SEED = 170
EVAL_SAMPLE_SIZE = 80
REFERENCE_WORLD_COUNT = 30
REFERENCE_V6_WORLD_COUNT = 100
DRAW_ORACLE_WORLD_COUNT = 25
DISCARD_ORACLE_WORLD_COUNT = 20
DRAW_INFO_PENALTY = 1.5  # DW penalty for information revelation in draw lane

try:
    from gin_rummy.endgame_solver import PublicState, evaluate_knock_now
    from gin_rummy.solver_v2 import CONTINUATION_CHAMPION, simulate_continuation_policy
    from gin_rummy.solver_v6 import solve_spot_v6
    from gin_rummy.belief_world_generator import generate_belief_weighted_worlds
    from gin_rummy.rust_bridge import RustBridge
    from gin_rummy.meld import compute_deadwood
    from gin_rummy.card import rank, suit, NUM_CARDS
except ModuleNotFoundError:
    import sys

    sys.path.insert(0, ROOT_DIR)
    from gin_rummy.endgame_solver import PublicState, evaluate_knock_now
    from gin_rummy.solver_v2 import CONTINUATION_CHAMPION, simulate_continuation_policy
    from gin_rummy.solver_v6 import solve_spot_v6
    from gin_rummy.belief_world_generator import generate_belief_weighted_worlds
    from gin_rummy.rust_bridge import RustBridge
    from gin_rummy.meld import compute_deadwood
    from gin_rummy.card import rank, suit, NUM_CARDS


@dataclass
class SpotRecord:
    hero_hand: List[int]
    hero_deadwood: int
    hero_melds: List[List[int]]
    hero_dw_cards: List[int]
    stock_size: int
    turn_number: int
    my_score: int
    opp_score: int
    discard_pile: List[int]
    known_opponent_pickups: List[int]
    known_opponent_discards: List[int]
    upcard_declines: List[int]
    hero_discards: List[int]
    trace_events: List[Dict]
    opp_hand: List[int]
    opp_deadwood_raw: int
    opp_deadwood_after_layoff: int
    outcome: str
    hero_points: int
    opp_points: int
    undercut_ready: bool
    discard_pile_size: int
    n_opponent_pickups: int
    n_opponent_discards: int
    hero_dw_card_count: int
    hero_meld_count: int
    game_id: int

    @classmethod
    def from_dict(cls, data: Dict) -> "SpotRecord":
        return cls(
            hero_hand=data["hero_hand"],
            hero_deadwood=data["hero_deadwood"],
            hero_melds=data["hero_melds"],
            hero_dw_cards=data["hero_dw_cards"],
            stock_size=data["stock_size"],
            turn_number=data["turn_number"],
            my_score=data["my_score"],
            opp_score=data["opp_score"],
            discard_pile=data["discard_pile"],
            known_opponent_pickups=data.get("known_opponent_pickups", []),
            known_opponent_discards=data.get("known_opponent_discards", []),
            upcard_declines=data.get("upcard_declines", []),
            hero_discards=data.get("hero_discards", []),
            trace_events=data.get("trace_events", []),
            opp_hand=data["opp_hand"],
            opp_deadwood_raw=data["opp_deadwood_raw"],
            opp_deadwood_after_layoff=data["opp_deadwood_after_layoff"],
            outcome=data["outcome"],
            hero_points=data["hero_points"],
            opp_points=data["opp_points"],
            undercut_ready=data["undercut_ready"],
            discard_pile_size=data.get("discard_pile_size", len(data["discard_pile"])),
            n_opponent_pickups=data.get("n_opponent_pickups", 0),
            n_opponent_discards=data.get("n_opponent_discards", 0),
            hero_dw_card_count=data.get("hero_dw_card_count", len(data["hero_dw_cards"])),
            hero_meld_count=data.get("hero_meld_count", len(data["hero_melds"])),
            game_id=data.get("game_id", 0),
        )

    def to_dict(self) -> Dict:
        return asdict(self)


def _ensure_dirs() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(ARTIFACT_DIR, exist_ok=True)


def load_source_dataset() -> List[SpotRecord]:
    with open(SOURCE_DATASET_PATH, "r", encoding="utf-8") as handle:
        raw = json.load(handle)
    return [SpotRecord.from_dict(entry) for entry in raw]


def load_train_spots() -> List[SpotRecord]:
    with open(TRAIN_SPOTS_PATH, "r", encoding="utf-8") as handle:
        return [SpotRecord.from_dict(entry) for entry in json.load(handle)]


def load_eval_spots() -> List[SpotRecord]:
    with open(EVAL_SPOTS_PATH, "r", encoding="utf-8") as handle:
        return [SpotRecord.from_dict(entry) for entry in json.load(handle)]


def load_manifest() -> Dict:
    with open(MANIFEST_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def prepared_lab_exists() -> bool:
    return (
        os.path.exists(TRAIN_SPOTS_PATH)
        and os.path.exists(EVAL_SPOTS_PATH)
        and os.path.exists(MANIFEST_PATH)
        and os.path.exists(KNOCK_TARGETS_PATH)
        and os.path.exists(DRAW_TARGETS_PATH)
        and os.path.exists(DISCARD_TARGETS_PATH)
    )


def load_frozen_knock_targets() -> List[Dict]:
    """Load pre-computed frozen knock lane targets."""
    with open(KNOCK_TARGETS_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_frozen_draw_targets() -> List[Dict]:
    """Load pre-computed frozen draw lane targets."""
    with open(DRAW_TARGETS_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_frozen_discard_targets() -> List[Dict]:
    """Load pre-computed frozen discard lane targets."""
    with open(DISCARD_TARGETS_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _build_public_state(spot: SpotRecord) -> PublicState:
    return PublicState(
        discard_pile=list(spot.discard_pile),
        turn_number=spot.turn_number,
        stock_size=spot.stock_size,
        my_score=spot.my_score,
        opp_score=spot.opp_score,
    )


def _reference_entry_for_spot(spot: SpotRecord, seed: int) -> Dict:
    public_state = _build_public_state(spot)

    try:
        v6_result = solve_spot_v6(
            hero_hand=list(spot.hero_hand),
            public_state=public_state,
            n_worlds=REFERENCE_V6_WORLD_COUNT,
            seed=seed,
            known_opponent_pickups=spot.known_opponent_pickups,
            known_opponent_discards=spot.known_opponent_discards,
            upcard_declines=spot.upcard_declines,
        )
        v6_action = v6_result.recommended_action
    except Exception as exc:
        v6_action = "error"
        v6_error = str(exc)
    else:
        v6_error = None

    worlds, _weights = generate_belief_weighted_worlds(
        hero_hand=list(spot.hero_hand),
        discard_pile=list(spot.discard_pile),
        stock_size=spot.stock_size,
        n_worlds=REFERENCE_WORLD_COUNT,
        rng=random.Random(seed),
        known_opponent_pickups=spot.known_opponent_pickups,
        known_opponent_discards=spot.known_opponent_discards,
        oversample_factor=2,
    )

    knock_total = 0.0
    continue_total = 0.0

    for world_index, (opp_hand, stock) in enumerate(worlds):
        knock_outcome = evaluate_knock_now(list(spot.hero_hand), list(opp_hand))
        knock_total += knock_outcome.hero_points - knock_outcome.opp_points

        cont_outcome = simulate_continuation_policy(
            hero_hand=list(spot.hero_hand),
            opp_hand=list(opp_hand),
            stock=list(stock),
            public_state=public_state,
            rng=random.Random(seed + 100000 + world_index),
            mode=CONTINUATION_CHAMPION,
        )
        continue_total += cont_outcome.hero_points - cont_outcome.opp_points

    n_worlds = len(worlds)
    knock_ev = knock_total / n_worlds if n_worlds else 0.0
    continue_ev = continue_total / n_worlds if n_worlds else 0.0
    best_action = "knock" if knock_ev >= continue_ev else "continue"

    return {
        "best_action": best_action,
        "knock_ev": round(knock_ev, 4),
        "continue_ev": round(continue_ev, 4),
        "ev_gap": round(abs(knock_ev - continue_ev), 4),
        "actual_outcome": spot.outcome,
        "hero_deadwood": spot.hero_deadwood,
        "stock_size": spot.stock_size,
        "n_worlds": n_worlds,
        "v6_action": v6_action,
        "v6_error": v6_error,
    }


def _evaluate_actions_from_entries(entries: List[Dict], actions: List[str]) -> Dict:
    total = len(entries)
    correct = 0
    knock_count = 0
    false_positive = 0
    false_negative = 0
    undercut_on_knock = 0
    regret_total = 0.0
    v6_agree = 0
    better_than_v6 = 0
    worse_than_v6 = 0

    for entry, action in zip(entries, actions):
        best_action = entry["best_action"]
        knock_ev = entry["knock_ev"]
        continue_ev = entry["continue_ev"]
        action_ev = knock_ev if action == "knock" else continue_ev
        best_ev = knock_ev if best_action == "knock" else continue_ev

        if action == "knock":
            knock_count += 1
            if entry["actual_outcome"] == "undercut":
                undercut_on_knock += 1

        if action == best_action:
            correct += 1
        elif action == "knock":
            false_positive += 1
        else:
            false_negative += 1

        if action == entry["v6_action"]:
            v6_agree += 1
        else:
            v6_correct = entry["v6_action"] == best_action
            candidate_correct = action == best_action
            if candidate_correct and not v6_correct:
                better_than_v6 += 1
            elif v6_correct and not candidate_correct:
                worse_than_v6 += 1

        regret_total += (best_ev - action_ev)

    knock_rate = knock_count / total if total else 0.0
    accuracy = correct / total if total else 0.0
    false_positive_rate = false_positive / total if total else 0.0
    false_negative_rate = false_negative / total if total else 0.0
    undercut_rate_when_knock = (
        undercut_on_knock / knock_count if knock_count else 0.0
    )
    avg_regret = regret_total / total if total else 0.0

    return {
        "n_eval": total,
        "accuracy_vs_best": round(accuracy, 4),
        "knock_rate": round(knock_rate, 4),
        "false_positive_rate": round(false_positive_rate, 4),
        "false_negative_rate": round(false_negative_rate, 4),
        "undercut_rate_when_knock": round(undercut_rate_when_knock, 4),
        "avg_regret_points": round(avg_regret, 4),
        "v6_agreement_rate": round(v6_agree / total, 4) if total else 0.0,
        "better_than_v6": better_than_v6,
        "worse_than_v6": worse_than_v6,
    }


def score_actions(entries: List[Dict], actions: List[str], baseline: Dict) -> Dict:
    metrics = _evaluate_actions_from_entries(entries, actions)
    overknock = max(0.0, metrics["knock_rate"] - baseline["v6_knock_rate"])

    score = metrics["accuracy_vs_best"]
    score -= 0.35 * overknock
    score -= 0.35 * metrics["false_positive_rate"]
    score -= 0.20 * metrics["undercut_rate_when_knock"]
    score -= 0.10 * min(metrics["avg_regret_points"] / 25.0, 1.0)

    metrics["score"] = round(score, 4)
    metrics["score_delta_vs_v6"] = round(score - baseline["v6_score"], 4)
    metrics["overknock_vs_v6"] = round(overknock, 4)
    return metrics


def evaluate_probabilities(
    probabilities: List[float],
    threshold: float,
    manifest: Optional[Dict] = None,
) -> Dict:
    if manifest is None:
        manifest = load_manifest()
    entries = manifest["eval_reference"]
    actions = ["knock" if p >= threshold else "continue" for p in probabilities]
    metrics = score_actions(entries, actions, manifest["baseline"])
    metrics["threshold"] = threshold
    metrics["mean_knock_probability"] = round(
        sum(probabilities) / len(probabilities), 4
    ) if probabilities else 0.0
    metrics["detail"] = [
        {
            "hero_deadwood": entry["hero_deadwood"],
            "stock_size": entry["stock_size"],
            "knock_probability": round(probabilities[i], 4),
            "action": actions[i],
            "best_action": entry["best_action"],
            "v6_action": entry["v6_action"],
            "actual_outcome": entry["actual_outcome"],
            "knock_ev": entry["knock_ev"],
            "continue_ev": entry["continue_ev"],
        }
        for i, entry in enumerate(entries[:20])
    ]
    return metrics


def evaluate_policy_fn(
    predict_knock_probability: Callable[[SpotRecord], float],
    threshold: float,
    eval_spots: Optional[List[SpotRecord]] = None,
    manifest: Optional[Dict] = None,
) -> Dict:
    if eval_spots is None:
        eval_spots = load_eval_spots()
    probabilities = [float(predict_knock_probability(spot)) for spot in eval_spots]
    return evaluate_probabilities(probabilities, threshold, manifest=manifest)


def _write_json(path: str, payload) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def _rust_bridge_summary(spots: List[SpotRecord]) -> Dict:
    summary = {
        "bridge_available": False,
        "bridge_path": None,
        "hero_deadwood_match_sample": None,
        "checked_hands": 0,
    }
    try:
        with RustBridge() as bridge:
            sample_hands = [spot.hero_hand for spot in spots[:256]]
            rust_values = bridge.batch_compute_deadwood(sample_hands)
            py_values = [spot.hero_deadwood for spot in spots[:256]]
            summary["bridge_available"] = True
            summary["bridge_path"] = bridge._bridge_path
            summary["hero_deadwood_match_sample"] = (rust_values == py_values)
            summary["checked_hands"] = len(sample_hands)
    except Exception as exc:
        summary["error"] = str(exc)
    return summary


def _draw_oracle_target_for_spot(spot: SpotRecord, seed: int) -> Optional[Dict]:
    """
    Compute frozen oracle draw-source target for a spot.
    Returns target dict or None if not evaluable.
    """
    if not spot.discard_pile:
        return None
    upcard = spot.discard_pile[-1]
    if upcard in spot.hero_hand:
        return None

    hero_hand = list(spot.hero_hand)
    base_dw = compute_deadwood(hero_hand)

    # Evaluate TAKE: add upcard, find best discard (not the upcard itself)
    take_hand = hero_hand + [upcard]
    best_take_dw = 999
    for i, c in enumerate(take_hand):
        if c == upcard:
            continue
        remaining = take_hand[:i] + take_hand[i + 1:]
        dw = compute_deadwood(remaining)
        if dw < best_take_dw:
            best_take_dw = dw

    take_improvement = base_dw - best_take_dw

    # Evaluate STOCK: sample random draws, compute average improvement
    hero_set = set(hero_hand)
    visible = set(spot.discard_pile)
    unseen = [c for c in range(NUM_CARDS) if c not in hero_set and c not in visible]

    if len(unseen) < 3:
        return None

    rng = random.Random(seed)
    stock_improvements = []
    sample_size = min(DRAW_ORACLE_WORLD_COUNT, len(unseen))
    sample_cards = rng.sample(unseen, sample_size)

    for stock_card in sample_cards:
        stock_hand = hero_hand + [stock_card]
        best_stock_dw = 999
        for i, c in enumerate(stock_hand):
            remaining = stock_hand[:i] + stock_hand[i + 1:]
            dw = compute_deadwood(remaining)
            if dw < best_stock_dw:
                best_stock_dw = dw
        stock_improvements.append(base_dw - best_stock_dw)

    avg_stock_improvement = sum(stock_improvements) / len(stock_improvements)

    # Apply information penalty for taking from discard
    adjusted_take = take_improvement - DRAW_INFO_PENALTY
    best_action = "take" if adjusted_take > avg_stock_improvement else "stock"

    return {
        "best_action": best_action,
        "take_improvement": round(take_improvement, 4),
        "avg_stock_improvement": round(avg_stock_improvement, 4),
        "adjusted_take_score": round(adjusted_take, 4),
        "stock_score": round(avg_stock_improvement, 4),
        "ev_gap": round(abs(adjusted_take - avg_stock_improvement), 4),
        "base_dw": base_dw,
        "best_take_dw": best_take_dw,
        "upcard": upcard,
        "n_stock_samples": sample_size,
        "provenance": "offline_oracle_dw_comparison_with_info_penalty",
    }


def _discard_oracle_target_for_spot(spot: SpotRecord, seed: int) -> Optional[Dict]:
    """
    Compute frozen oracle discard target for a spot.
    Returns target dict or None if not evaluable.
    """
    if len(spot.hero_hand) < 10 or not spot.discard_pile:
        return None

    upcard = spot.discard_pile[-1]
    hand_11 = list(spot.hero_hand) + [upcard]

    # Oracle best discard: minimize deadwood
    best_dw = 999
    best_card = hand_11[0]
    all_dw_scores = {}
    for i, c in enumerate(hand_11):
        remaining = hand_11[:i] + hand_11[i + 1:]
        dw = compute_deadwood(remaining)
        all_dw_scores[c] = dw
        if dw < best_dw:
            best_dw = dw
            best_card = c

    # All DW-optimal candidates
    optimal_set = [c for c, dw in all_dw_scores.items() if dw == best_dw]

    # Compute safety scores for each card
    safety_scores = {}
    for c in hand_11:
        r, s = rank(c), suit(c)
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
        safety_scores[c] = round(danger, 4)

    # Oracle discard: DW-optimal, then safest among ties
    if len(optimal_set) > 1:
        oracle_discard = min(optimal_set, key=lambda c: safety_scores.get(c, 0.0))
    else:
        oracle_discard = best_card

    return {
        "oracle_discard": oracle_discard,
        "oracle_discard_dw": best_dw,
        "all_dw_scores": {str(c): dw for c, dw in all_dw_scores.items()},
        "safety_scores": {str(c): s for c, s in safety_scores.items()},
        "optimal_set": optimal_set,
        "optimal_set_size": len(optimal_set),
        "hand_11": hand_11,
        "provenance": "offline_oracle_dw_optimal_safety_tiebreak",
    }


def prepare_lab(force: bool = False, skip_rust_check: bool = False) -> Dict:
    _ensure_dirs()

    if prepared_lab_exists() and not force:
        return load_manifest()

    spots = load_source_dataset()

    shuffled_indices = list(range(len(spots)))
    rng = random.Random(TRAIN_SPLIT_SEED)
    rng.shuffle(shuffled_indices)

    split = int(len(shuffled_indices) * 0.7)
    train_indices = shuffled_indices[:split]
    heldout_indices = shuffled_indices[split:]

    eval_rng = random.Random(EVAL_SAMPLE_SEED)
    eval_indices = eval_rng.sample(heldout_indices, min(EVAL_SAMPLE_SIZE, len(heldout_indices)))

    train_spots = [spots[index] for index in train_indices]
    eval_spots = [spots[index] for index in eval_indices]

    _write_json(TRAIN_SPOTS_PATH, [spot.to_dict() for spot in train_spots])
    _write_json(EVAL_SPOTS_PATH, [spot.to_dict() for spot in eval_spots])

    # ── Knock lane targets (existing logic) ───────────────────────────
    reference_entries = []
    t0 = time.time()
    for idx, spot in enumerate(eval_spots):
        reference_entries.append(_reference_entry_for_spot(spot, EVAL_SAMPLE_SEED + idx))

    v6_actions = [
        entry["v6_action"] if entry["v6_action"] in ("knock", "continue") else "continue"
        for entry in reference_entries
    ]
    baseline_metrics = _evaluate_actions_from_entries(reference_entries, v6_actions)
    baseline_metrics["v6_score"] = score_actions(
        reference_entries,
        v6_actions,
        {
            "v6_knock_rate": baseline_metrics["knock_rate"],
            "v6_score": 0.0,
        },
    )["score"]
    baseline_metrics["prep_elapsed_sec"] = round(time.time() - t0, 2)

    # ── Freeze knock lane targets ─────────────────────────────────────
    _write_json(KNOCK_TARGETS_PATH, reference_entries)
    print(f"  [FREEZE] Knock targets: {len(reference_entries)} entries -> {KNOCK_TARGETS_PATH}")

    # ── Freeze draw lane targets ──────────────────────────────────────
    draw_targets = []
    draw_seed_base = EVAL_SAMPLE_SEED + 50000
    for idx, spot in enumerate(eval_spots):
        target = _draw_oracle_target_for_spot(spot, draw_seed_base + idx)
        draw_targets.append(target)  # None for non-evaluable spots
    _write_json(DRAW_TARGETS_PATH, draw_targets)
    evaluable_draw = sum(1 for t in draw_targets if t is not None)
    print(f"  [FREEZE] Draw targets: {evaluable_draw}/{len(draw_targets)} evaluable -> {DRAW_TARGETS_PATH}")

    # ── Freeze discard lane targets ───────────────────────────────────
    discard_targets = []
    discard_seed_base = EVAL_SAMPLE_SEED + 60000
    for idx, spot in enumerate(eval_spots):
        target = _discard_oracle_target_for_spot(spot, discard_seed_base + idx)
        discard_targets.append(target)  # None for non-evaluable spots
    _write_json(DISCARD_TARGETS_PATH, discard_targets)
    evaluable_discard = sum(1 for t in discard_targets if t is not None)
    print(f"  [FREEZE] Discard targets: {evaluable_discard}/{len(discard_targets)} evaluable -> {DISCARD_TARGETS_PATH}")

    manifest = {
        "dataset_version": DATASET_VERSION,
        "source_dataset_path": SOURCE_DATASET_PATH,
        "train_split_seed": TRAIN_SPLIT_SEED,
        "eval_sample_seed": EVAL_SAMPLE_SEED,
        "train_count": len(train_spots),
        "heldout_count": len(heldout_indices),
        "eval_count": len(eval_spots),
        "reference_world_count": REFERENCE_WORLD_COUNT,
        "reference_v6_world_count": REFERENCE_V6_WORLD_COUNT,
        "frozen_targets": {
            "knock": KNOCK_TARGETS_PATH,
            "draw": DRAW_TARGETS_PATH,
            "discard": DISCARD_TARGETS_PATH,
            "draw_evaluable": evaluable_draw,
            "discard_evaluable": evaluable_discard,
        },
        "baseline": {
            "v6_knock_rate": baseline_metrics["knock_rate"],
            "v6_accuracy_vs_best": baseline_metrics["accuracy_vs_best"],
            "v6_false_positive_rate": baseline_metrics["false_positive_rate"],
            "v6_undercut_rate_when_knock": baseline_metrics["undercut_rate_when_knock"],
            "v6_avg_regret_points": baseline_metrics["avg_regret_points"],
            "v6_score": baseline_metrics["v6_score"],
        },
        "rust_bridge": None if skip_rust_check else _rust_bridge_summary(train_spots),
        "eval_reference": reference_entries,
    }

    _write_json(MANIFEST_PATH, manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare the Oracle autoresearch lab")
    parser.add_argument("--force", action="store_true", help="Rebuild frozen split and references")
    parser.add_argument(
        "--skip-rust-check",
        action="store_true",
        help="Skip the optional Rust bridge batch validation",
    )
    args = parser.parse_args()

    manifest = prepare_lab(force=args.force, skip_rust_check=args.skip_rust_check)

    print("=" * 72)
    print("ORACLE AUTORESEARCH PREP (Directive 108: Frozen Per-Lane Targets)")
    print("=" * 72)
    print(f"Dataset version:   {manifest['dataset_version']}")
    print(f"Train spots:       {manifest['train_count']}")
    print(f"Held-out spots:    {manifest['heldout_count']}")
    print(f"Eval spots:        {manifest['eval_count']}")
    print(f"V6 baseline score: {manifest['baseline']['v6_score']:.4f}")
    print(f"V6 knock rate:     {manifest['baseline']['v6_knock_rate']:.4f}")
    frozen = manifest.get("frozen_targets", {})
    if frozen:
        print(f"Frozen knock:      {frozen.get('knock', 'n/a')}")
        print(f"Frozen draw:       {frozen.get('draw', 'n/a')} ({frozen.get('draw_evaluable', '?')} evaluable)")
        print(f"Frozen discard:    {frozen.get('discard', 'n/a')} ({frozen.get('discard_evaluable', '?')} evaluable)")
    rust_bridge = manifest.get("rust_bridge")
    if rust_bridge:
        print(f"Rust bridge:       {rust_bridge.get('bridge_available')}")
        if rust_bridge.get("hero_deadwood_match_sample") is not None:
            print(f"Rust sample parity:{rust_bridge['hero_deadwood_match_sample']}")
    print(f"Manifest:          {MANIFEST_PATH}")
    print("=" * 72)


if __name__ == "__main__":
    main()
