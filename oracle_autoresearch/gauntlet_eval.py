"""
Held-Out Full-Game Gauntlet Evaluation — Directive 109.

This is the bounded scaffold for a promotion-time or post-promotion
bot-vs-bot evaluation. It runs the **real train.py Oracle policy** against
a frozen baseline player set in deterministic, seat-balanced games.

Directive 109: upgraded from simplified OracleKnockPlayer to the real
belief-world Oracle policy from train.py.

This is NOT the proxy benchmark (that's multi_lane_benchmark.py).
This is a separate, heavier evaluation for promotion-time gating.

Usage (bounded smoke mode):
    python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 109

Usage (full evaluation):
    python oracle_autoresearch/gauntlet_eval.py --n-deals 100 --seed 109

The gauntlet produces:
  - Win rate with 95% Wilson confidence intervals
  - Per-matchup statistics (gins, undercuts, points)
  - A JSON result artifact for provenance
  - Clear identification of which Oracle policy was evaluated
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from typing import Dict, List, Optional

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAB_DIR = os.path.dirname(os.path.abspath(__file__))
ARTIFACT_DIR = os.path.join(LAB_DIR, "artifacts")

sys.path.insert(0, ROOT_DIR)
sys.path.insert(0, LAB_DIR)

from gin_rummy.game import GinRummyGame
from gin_rummy.player import SimplePlayer, Player
from gin_rummy.meld import best_meld_arrangement, compute_deadwood, clear_cache, find_all_melds
from gin_rummy.card import deadwood_value, rank, suit, make_card, NUM_CARDS
from gin_rummy.benchmark import wilson_interval, run_balanced_matchup, print_matchup_benchmark_result

# Import train.py's real policy components
from train import (
    build_enhanced_card_weights,
    compute_eval_weight,
    compute_trace_confidence_multiplier,
    KNOCK_RISK_PENALTY_BASE,
    DW_RISK_SCALE,
    GIN_BONUS,
    VALUE_NORMALIZER,
    CONTINUATION_MIX_ENABLED,
    CONTINUATION_CHAMPION_WEIGHT,
    CONTINUATION_GREEDY_WEIGHT,
    WORLD_GEN_OVERSAMPLE,
    STOCK_DW_PRIOR_ENABLED,
    STOCK_DW_PRIOR,
    DIRECT_EVAL_WEIGHT,
    N_WORLDS_BASE,
)

try:
    from gin_rummy.endgame_solver import PublicState, evaluate_knock_now
    from gin_rummy.solver_v2 import (
        CONTINUATION_CHAMPION, CONTINUATION_GREEDY,
        simulate_continuation_policy,
    )
    from gin_rummy.belief_world_generator import generate_belief_weighted_worlds
    from gin_rummy.opponent_model import OpponentModel
except ImportError:
    pass  # already on path from sys.path.insert above


# ── Real Oracle Policy Player (Directive 109) ─────────────────────────

class RealOraclePolicyPlayer(Player):
    """
    Full belief-world Oracle policy player for gauntlet evaluation.

    Directive 109: This player delegates knock decisions to the real
    train.py policy path — belief-world generation, EV estimation,
    risk adjustments, and dynamic weight computation — rather than
    using a simplified proxy threshold.

    Draw and discard use DW-minimizing baseline logic (same as the
    proxy benchmark's candidate evaluation scope).

    Args:
        name: Player name for reporting
        n_worlds: Number of belief worlds per knock decision (default: 30)
        seed: Deterministic seed for reproducibility
    """

    def __init__(
        self,
        name: str = "RealOracle",
        n_worlds: int = 30,
        seed: int = 109,
    ):
        super().__init__(name)
        self.n_worlds = n_worlds
        self.seed = seed
        self.rng = random.Random(seed)
        self.hand = []
        self.opponent_pickups = []
        self.opponent_discards = []
        self.upcard_declines = []
        self.discard_pile_visible = []
        self.turn_number = 0
        self.my_score = 0
        self.opp_score = 0

    def new_hand(self, hand, opponent_id):
        self.hand = list(hand)
        self.opponent_pickups = []
        self.opponent_discards = []
        self.upcard_declines = []
        self.discard_pile_visible = []
        self.turn_number = 0

    def draw_decision(self, top_discard, hand, game_state):
        """DW-minimizing draw: take discard if it completes/extends a meld."""
        self.hand = list(hand)
        self.my_score = game_state.get("my_score", 0)
        self.opp_score = game_state.get("opp_score", 0)
        self.turn_number = game_state.get("turn_number", 0)
        # Track visible discard pile
        dp = game_state.get("discard_pile", [])
        if dp:
            self.discard_pile_visible = list(dp)

        test_hand = hand + [top_discard]
        melds_with = find_all_melds(test_hand)
        for meld in melds_with:
            if top_discard in meld:
                return True

        # Track upcard decline if we don't take it
        if top_discard not in self.upcard_declines:
            self.upcard_declines.append(top_discard)
        return False

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        """Discard highest deadwood card not in a meld."""
        self.hand = list(hand)
        melds, deadwood_cards, dw = best_meld_arrangement(hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)

        candidates = [c for c in hand if c not in melded]
        if drew_from_discard:
            candidates = [c for c in candidates if c != drawn_card]

        if not candidates:
            candidates = [c for c in hand if not (drew_from_discard and c == drawn_card)]

        chosen = max(candidates, key=deadwood_value)
        # Track discard in visible pile
        self.discard_pile_visible.append(chosen)
        return chosen

    def knock_decision(self, hand, game_state):
        """
        Real Oracle policy knock decision via belief-world EV estimation.

        Uses the same policy path as train.py:
        - Enhanced card weight builder (upcard decline signal)
        - Belief-world generation with stock-size deadwood prior
        - Mixed continuation policy (champion + greedy blend)
        - Dynamic eval weight and trace-confidence risk adjustments
        """
        self.hand = list(hand)
        melds, deadwood_cards, dw = best_meld_arrangement(hand)

        # Always gin
        if dw == 0:
            return True

        # Can't knock if deadwood > 10
        if dw > 10:
            return False

        stock_remaining = game_state.get("deck_remaining", 20)

        # Build enhanced card weights with decline signal
        card_weights = build_enhanced_card_weights(
            hero_hand=list(hand),
            discard_pile=list(self.discard_pile_visible),
            known_opponent_pickups=self.opponent_pickups,
            known_opponent_discards=self.opponent_discards,
            upcard_declines=self.upcard_declines,
        )

        # Stock-size-aware deadwood prior
        predicted_mean_dw = None
        if STOCK_DW_PRIOR_ENABLED and stock_remaining in STOCK_DW_PRIOR:
            predicted_mean_dw = STOCK_DW_PRIOR[stock_remaining]

        # Generate belief worlds
        worlds, _weights = generate_belief_weighted_worlds(
            hero_hand=list(hand),
            discard_pile=list(self.discard_pile_visible),
            stock_size=stock_remaining,
            n_worlds=self.n_worlds,
            rng=random.Random(self.rng.randint(0, 2**31 - 1)),
            card_weights=card_weights,
            known_opponent_pickups=self.opponent_pickups,
            known_opponent_discards=self.opponent_discards,
            predicted_mean_opp_dw=predicted_mean_dw,
            quality_weight_mode='gaussian' if predicted_mean_dw is not None else 'none',
            oversample_factor=WORLD_GEN_OVERSAMPLE,
        )

        if not worlds:
            # Fallback: knock if DW <= 7
            return dw <= 7

        public_state = PublicState(
            discard_pile=list(self.discard_pile_visible),
            turn_number=self.turn_number,
            stock_size=stock_remaining,
            my_score=self.my_score,
            opp_score=self.opp_score,
        )

        # Trace-confidence risk adjustment (Directive 109 mutation surface)
        n_pickups = len(self.opponent_pickups)
        n_discards = len(self.opponent_discards)
        n_declines = len(self.upcard_declines)
        n_trace_events = n_pickups + n_discards + n_declines

        # ── Directive 117: Pickup-Specific Pressure ──
        pickup_pressure = 0.0
        if n_pickups > 0:
            pickup_pressure = n_pickups * 0.2
            # Check for same-rank or same-suit clusters
            suits = [suit(c) for c in self.opponent_pickups]
            ranks = [rank(c) for c in self.opponent_pickups]
            for s in set(suits):
                if suits.count(s) >= 2: pickup_pressure += 0.15
            for r in set(ranks):
                if ranks.count(r) >= 2: pickup_pressure += 0.25
        pickup_pressure = min(1.0, pickup_pressure)

        trace_conf = compute_trace_confidence_multiplier(
            n_trace_events=n_trace_events,
            stock_size=stock_remaining,
            hero_deadwood=dw,
            turn_number=self.turn_number,
            n_pickups=n_pickups,
            n_discards=n_discards,
            n_declines=n_declines,
            pickup_pressure=pickup_pressure,
            my_score=self.my_score,
            opp_score=self.opp_score,
            score_diff=self.my_score - self.opp_score,
        )

        if dw == 0:
            dw_adjustment = GIN_BONUS * VALUE_NORMALIZER
        else:
            dw_adjustment = -DW_RISK_SCALE * dw * VALUE_NORMALIZER * trace_conf

        knock_total = 0.0
        continue_total = 0.0
        hero_hand_list = list(hand)

        for world_index, (opp_hand, stock) in enumerate(worlds):
            opp_hand_list = list(opp_hand)
            knock_outcome = evaluate_knock_now(hero_hand_list, opp_hand_list)
            knock_payoff = knock_outcome.hero_points - knock_outcome.opp_points

            # Mixed continuation policy
            if CONTINUATION_MIX_ENABLED:
                champion_outcome = simulate_continuation_policy(
                    hero_hand=hero_hand_list,
                    opp_hand=opp_hand_list,
                    stock=list(stock),
                    public_state=public_state,
                    rng=random.Random(self.rng.randint(0, 2**31 - 1) + world_index),
                    mode=CONTINUATION_CHAMPION,
                )
                champion_payoff = champion_outcome.hero_points - champion_outcome.opp_points

                greedy_outcome = simulate_continuation_policy(
                    hero_hand=hero_hand_list,
                    opp_hand=opp_hand_list,
                    stock=list(stock),
                    public_state=public_state,
                    rng=random.Random(self.rng.randint(0, 2**31 - 1) + world_index + 500000),
                    mode=CONTINUATION_GREEDY,
                )
                greedy_payoff = greedy_outcome.hero_points - greedy_outcome.opp_points

                continue_payoff = (
                    CONTINUATION_CHAMPION_WEIGHT * champion_payoff
                    + CONTINUATION_GREEDY_WEIGHT * greedy_payoff
                )
            else:
                continue_outcome = simulate_continuation_policy(
                    hero_hand=hero_hand_list,
                    opp_hand=opp_hand_list,
                    stock=list(stock),
                    public_state=public_state,
                    rng=random.Random(self.rng.randint(0, 2**31 - 1) + world_index),
                    mode=CONTINUATION_CHAMPION,
                )
                continue_payoff = continue_outcome.hero_points - continue_outcome.opp_points

            # Apply risk adjustments
            knock_payoff += dw_adjustment
            if knock_outcome.undercut:
                knock_payoff -= KNOCK_RISK_PENALTY_BASE * VALUE_NORMALIZER * trace_conf

            knock_total += knock_payoff
            continue_total += continue_payoff

        mean_knock = knock_total / len(worlds)
        mean_continue = continue_total / len(worlds)

        # Convert EV gap to probability via sigmoid
        ev_gap = (mean_knock / VALUE_NORMALIZER) - (mean_continue / VALUE_NORMALIZER)

        # Dynamic eval weight (Directive 109 mutation surface)
        eval_weight = compute_eval_weight(
            hero_deadwood=dw,
            stock_size=stock_remaining,
            n_trace_events=n_trace_events,
            ev_gap=ev_gap,
            turn_number=self.turn_number,
            n_pickups=n_pickups,
            n_discards=n_discards,
            n_declines=n_declines,
            pickup_pressure=pickup_pressure,
            my_score=self.my_score,
            opp_score=self.opp_score,
            score_diff=self.my_score - self.opp_score,
        )

        direct_prob = 1.0 / (1.0 + math.exp(-ev_gap * 3.0))

        # Apply eval weight (higher = trust direct more, lower = more conservative)
        # In gauntlet mode we use pure direct probability, but scale by eval weight
        # to match train.py's blending behavior
        knock_prob = eval_weight * direct_prob + (1.0 - eval_weight) * 0.5

        return knock_prob >= 0.55  # Use the calibrated threshold from incumbent

    def notify_opponent_draw(self, from_discard, card=None):
        if from_discard and card is not None:
            self.opponent_pickups.append(card)

    def notify_opponent_discard(self, card):
        self.opponent_discards.append(card)


# ── Legacy Simplified Player (kept for comparison) ────────────────────

class OracleKnockPlayer(Player):
    """
    Simplified Oracle-style player (legacy from Directive 108).

    For draw and discard decisions, uses the simple baseline (DW-minimizing).
    For knock decisions, uses a threshold on hero deadwood as a proxy.

    Kept for comparison runs only. Use --mode legacy to select this player.
    """

    def __init__(
        self,
        name: str = "LegacyOracle",
        knock_dw_threshold: int = 7,
        take_meld_completers: bool = True,
    ):
        super().__init__(name)
        self.knock_dw_threshold = knock_dw_threshold
        self.take_meld_completers = take_meld_completers
        self.hand = []
        self.opponent_pickups = []
        self.opponent_discards = []

    def new_hand(self, hand, opponent_id):
        self.hand = list(hand)
        self.opponent_pickups = []
        self.opponent_discards = []

    def draw_decision(self, top_discard, hand, game_state):
        if not self.take_meld_completers:
            return False
        test_hand = hand + [top_discard]
        melds_with = find_all_melds(test_hand)
        for meld in melds_with:
            if top_discard in meld:
                return True
        return False

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        melds, deadwood_cards, dw = best_meld_arrangement(hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)

        candidates = [c for c in hand if c not in melded]
        if drew_from_discard:
            candidates = [c for c in candidates if c != drawn_card]

        if not candidates:
            candidates = [c for c in hand if not (drew_from_discard and c == drawn_card)]

        return max(candidates, key=deadwood_value)

    def knock_decision(self, hand, game_state):
        melds, deadwood_cards, dw = best_meld_arrangement(hand)
        stock_remaining = game_state.get("deck_remaining", 20)

        if dw == 0:
            return True

        if stock_remaining <= 4:
            return dw <= 10
        elif stock_remaining <= 8:
            return dw <= self.knock_dw_threshold + 2
        else:
            return dw <= self.knock_dw_threshold

    def notify_opponent_draw(self, from_discard, card=None):
        if from_discard and card is not None:
            self.opponent_pickups.append(card)

    def notify_opponent_discard(self, card):
        self.opponent_discards.append(card)


# ── Gauntlet Runner ──────────────────────────────────────────────────

POLICY_REAL = "real"
POLICY_LEGACY = "legacy"

def run_gauntlet(
    n_deals: int = 10,
    seed: int = 109,
    target_score: int = 100,
    verbose: bool = False,
    policy_mode: str = POLICY_REAL,
    n_worlds: int = 30,
) -> Dict:
    """
    Run the held-out gauntlet: Oracle vs SimplePlayer baseline.

    Uses deterministic duplicated-deal mode for statistical rigor.
    Each deal is played twice (seat-balanced).

    Args:
        n_deals: Number of unique deals (actual games = 2 × n_deals)
        seed: Deterministic base seed
        target_score: Points to win a game
        verbose: Print detailed output
        policy_mode: "real" for train.py policy, "legacy" for simplified proxy
        n_worlds: Worlds per knock decision (real policy only)

    Returns:
        Gauntlet result dict
    """
    t0 = time.perf_counter()

    if policy_mode == POLICY_REAL:
        oracle_desc = f"RealOraclePolicyPlayer (n_worlds={n_worlds}, belief-world EV)"
        def oracle_factory():
            return RealOraclePolicyPlayer(
                name="RealOracle",
                n_worlds=n_worlds,
                seed=seed,
            )
    else:
        oracle_desc = "OracleKnockPlayer (legacy, knock_dw_threshold=7)"
        def oracle_factory():
            return OracleKnockPlayer(name="LegacyOracle", knock_dw_threshold=7)

    def simple_factory():
        return SimplePlayer(name="Simple")

    print(f"\n{'='*72}")
    print(f"GAUNTLET EVALUATION (Directive 109 — Real Policy)")
    print(f"{'='*72}")
    print(f"  Policy mode:  {policy_mode}")
    print(f"  Oracle:       {oracle_desc}")
    print(f"  Baseline:     SimplePlayer (always-knock)")
    print(f"  Deals:        {n_deals} (× 2 seat-balanced = {n_deals * 2} games)")
    print(f"  Seed:         {seed}")
    print(f"  Target score: {target_score}")
    if policy_mode == POLICY_REAL:
        print(f"  Worlds/knock: {n_worlds}")
        print(f"  EV estimation: belief-world + mixed continuation")
        print(f"  Risk adjust:  trace-confidence + DW-scaled penalty")
        print(f"  Eval weight:  compute_eval_weight() (mutation surface)")
        print(f"  Trace conf:   compute_trace_confidence_multiplier() (mutation surface)")
    print(f"{'='*72}\n")

    result = run_balanced_matchup(
        oracle_factory,
        simple_factory,
        n_games=n_deals,
        target_score=target_score,
        seed=seed,
        progress=True,
    )

    elapsed = time.perf_counter() - t0

    print_matchup_benchmark_result(result)

    ci_low, ci_high = result.win_rate_ci_a

    gauntlet_result = {
        "gauntlet": True,
        "directive": 109,
        "policy_mode": policy_mode,
        "policy_description": oracle_desc,
        "oracle_name": result.player_a,
        "baseline_name": result.player_b,
        "n_deals": n_deals,
        "total_games": result.games_played,
        "seed": seed,
        "target_score": target_score,
        "oracle_wins": result.wins_a,
        "baseline_wins": result.wins_b,
        "oracle_win_rate": round(result.win_rate_a, 4),
        "baseline_win_rate": round(result.win_rate_b, 4),
        "oracle_win_rate_ci_95": [round(ci_low, 4), round(ci_high, 4)],
        "avg_hands_per_game": round(result.avg_hands_per_game, 2),
        "avg_points_oracle": round(result.avg_points_a, 2),
        "avg_points_baseline": round(result.avg_points_b, 2),
        "oracle_gins": result.total_gins_a,
        "baseline_gins": result.total_gins_b,
        "oracle_undercuts": result.total_undercuts_a,
        "baseline_undercuts": result.total_undercuts_b,
        "void_hands": result.total_void_hands,
        "elapsed_sec": round(elapsed, 2),
    }

    if policy_mode == POLICY_REAL:
        gauntlet_result["n_worlds_per_knock"] = n_worlds
        gauntlet_result["mutation_surfaces"] = [
            "compute_eval_weight",
            "compute_trace_confidence_multiplier",
        ]

    # Determine verdict
    if result.win_rate_a > 0.55:
        verdict = "STRONG"
    elif result.win_rate_a > 0.50:
        verdict = "MARGINAL"
    else:
        verdict = "FAIL"

    gauntlet_result["verdict"] = verdict

    print(f"\n  GAUNTLET VERDICT: {verdict}")
    print(f"  Oracle win rate: {result.win_rate_a*100:.1f}% "
          f"(95% CI: {ci_low*100:.1f}% - {ci_high*100:.1f}%)")
    print(f"  Policy evaluated: {oracle_desc}")

    return gauntlet_result


def main():
    parser = argparse.ArgumentParser(
        description="Held-out Full-Game Gauntlet Evaluation (Directive 109 — Real Policy)"
    )
    parser.add_argument(
        "--n-deals",
        type=int,
        default=10,
        help="Number of unique deals (each played twice seat-balanced, default: 10)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=109,
        help="Deterministic base seed (default: 109)",
    )
    parser.add_argument(
        "--target-score",
        type=int,
        default=100,
        help="Points to win a game (default: 100)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print verbose output",
    )
    parser.add_argument(
        "--mode",
        type=str,
        choices=["real", "legacy"],
        default="real",
        help="Policy mode: 'real' for full train.py policy, 'legacy' for simplified proxy (default: real)",
    )
    parser.add_argument(
        "--n-worlds",
        type=int,
        default=30,
        help="Worlds per knock decision in real policy mode (default: 30)",
    )
    args = parser.parse_args()

    result = run_gauntlet(
        n_deals=args.n_deals,
        seed=args.seed,
        target_score=args.target_score,
        verbose=args.verbose,
        policy_mode=args.mode,
        n_worlds=args.n_worlds,
    )

    # Save result artifact
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    result_path = os.path.join(ARTIFACT_DIR, f"{timestamp}-gauntlet_eval.json")
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(f"\n  Gauntlet result saved: {result_path}")
    print(f"  Elapsed: {result['elapsed_sec']:.1f}s")
    print(f"  Policy: {result['policy_description']}")


if __name__ == "__main__":
    main()
