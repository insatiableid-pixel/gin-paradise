"""
Phase 67 Task D: Solver v5 — Meld-Aware, Trace-Aware Low-Stock Solver.

Integrates the Phase 67 meld-aware opponent hand constructor into the
solver, replacing both v3's uniform sampling and v4's importance-weighted
random sampling with true range construction.

Key differences from previous solvers:

  v3 (Phase 65): uniform worlds + post-hoc belief reweighting by UC rate
  v4 (Phase 66): belief-weighted random sampling + importance weights
  v5 (Phase 67): meld-aware hand construction + trace weights + quality gating

Solver hierarchy:
  v1 (Phase 61): uniform worlds + greedy continuation
  v2 (Phase 62): uniform worlds + champion continuation + empirical equity
  v3 (Phase 65): uniform worlds + belief reweighting + undercut penalty
  v4 (Phase 66): belief-weighted random worlds + importance weights + UC penalty
  v5 (Phase 67): meld-aware constructed worlds + trace weights + quality gating

What v5 does differently:
  1. WORLD CONSTRUCTION: opponent hands are built around plausible meld
     skeletons, not sampled randomly. This produces much more realistic
     late-game opponent hands by construction.
  2. TRACE SIGNAL: per-card weights from the full public action trace
     (pickups, discards, declines) guide both skeleton scoring and
     completion sampling.
  3. QUALITY GATING: hands are scored against the estimator's predicted
     deadwood distribution and filtered for plausibility.
  4. THREE-TIER COVERAGE: skeleton-based / trace-random / high-DW tiers
     ensure the opponent range includes both meld-rich and stuck hands.
"""

import random
import math
from typing import List, Dict, Optional, Tuple

from gin_rummy.card import (
    NUM_CARDS, rank, suit, make_card, deadwood_value, card_str, hand_str
)
from gin_rummy.meld import (
    best_meld_arrangement, compute_deadwood, compute_layoffs
)
from gin_rummy.game import GIN_BONUS, UNDERCUT_BONUS, TARGET_SCORE, MIN_STOCK_CARDS

from gin_rummy.endgame_solver import (
    PublicState, HandOutcome, OutcomeDistribution, SolverResult,
    evaluate_knock_now,
)
from gin_rummy.solver_v2 import (
    simulate_continuation_policy, CONTINUATION_CHAMPION,
    _compute_empirical_equity,
)
from gin_rummy.solver_v3 import WeightedOutcomeDistribution
from gin_rummy.meld_constructor import construct_worlds_with_estimator


# ── Solver v5 ────────────────────────────────────────────────────────

def solve_spot_v5(
    hero_hand: List[int],
    public_state: PublicState,
    estimator=None,
    n_worlds: int = 200,
    seed: Optional[int] = None,
    use_undercut_penalty: bool = True,
    continuation_mode: str = CONTINUATION_CHAMPION,
    use_empirical_equity: bool = True,
    compute_match_equity: bool = True,
) -> SolverResult:
    """
    Phase 67 solver with meld-aware opponent hand construction.

    Key improvements over solver_v4:
      1. World construction is fundamentally different: opponent hands are
         built around plausible meld skeletons, not sampled randomly.
      2. Per-card trace weights guide construction (pickups, discards,
         declines → which cards opponent likely holds).
      3. Quality gating ensures generated hands have plausible deadwood
         for late-game champion play.
      4. Three-tier generation covers the full opponent range:
         meld-rich, trace-random, and high-deadwood "stuck" hands.
      5. Undercut penalty retained as secondary calibration correction.
      6. All Phase 62 features preserved (policy-backed continuation,
         empirical match-equity table).
    """
    public_state.validate()

    melds, dw_cards, hero_dw = best_meld_arrangement(hero_hand)
    if hero_dw > 10:
        raise ValueError(f"Hero cannot knock: deadwood {hero_dw} > 10")
    if len(hero_hand) != 10:
        raise ValueError(f"Hero hand must have 10 cards, got {len(hero_hand)}")

    rng = random.Random(seed) if seed is not None else random.Random()

    # ── Construct meld-aware worlds ──
    worlds, world_weights, construct_diag = construct_worlds_with_estimator(
        hero_hand=hero_hand,
        discard_pile=list(public_state.discard_pile),
        stock_size=public_state.stock_size,
        turn_number=public_state.turn_number,
        my_score=public_state.my_score,
        opp_score=public_state.opp_score,
        estimator=estimator,
        n_hands=n_worlds,
        rng=rng,
        known_opponent_pickups=(
            list(public_state.known_opponent_pickups)
            if public_state.known_opponent_pickups else None
        ),
        known_opponent_discards=(
            list(public_state.known_opponent_discards)
            if public_state.known_opponent_discards else None
        ),
    )

    if not worlds:
        return SolverResult(
            knock_now=OutcomeDistribution(),
            continue_play=OutcomeDistribution(),
            recommended_action='knock',
            confidence=0.0,
            diagnostics={'error': 'no_valid_worlds',
                         'constructor': construct_diag},
        )

    # Use uniform weights if constructor didn't produce them
    if not world_weights or len(world_weights) != len(worlds):
        world_weights = [1.0] * len(worlds)

    # ── Evaluate each world ──
    knock_outcomes_list = []
    continue_outcomes_list = []

    for opp_hand, stock in worlds:
        # Knock now (exact)
        knock_outcome = evaluate_knock_now(hero_hand, opp_hand)
        knock_outcomes_list.append(knock_outcome)

        # Continue (policy-backed)
        cont_rng = random.Random(rng.randint(0, 2**32))
        cont_outcome = simulate_continuation_policy(
            hero_hand=hero_hand,
            opp_hand=opp_hand,
            stock=stock,
            public_state=public_state,
            rng=cont_rng,
            mode=continuation_mode,
        )
        continue_outcomes_list.append(cont_outcome)

    # ── Build weighted outcome distributions ──
    knock_weighted = WeightedOutcomeDistribution(knock_outcomes_list, world_weights)
    continue_weighted = WeightedOutcomeDistribution(continue_outcomes_list, world_weights)

    # Standard distributions (for compatibility / diagnostics)
    knock_dist = OutcomeDistribution(outcomes=knock_outcomes_list)
    continue_dist = OutcomeDistribution(outcomes=continue_outcomes_list)

    # ── Compute match equity ──
    me_knock = None
    me_continue = None
    if compute_match_equity and use_empirical_equity:
        me_knock, me_continue = _compute_empirical_equity(
            knock_dist, continue_dist, public_state
        )
    elif compute_match_equity:
        from gin_rummy.endgame_solver import match_equity_delta
        me_knock = match_equity_delta(
            knock_dist.expected_hero_points,
            knock_dist.expected_opp_points,
            public_state.my_score,
            public_state.opp_score,
            public_state.target_score,
        )
        me_continue = match_equity_delta(
            continue_dist.expected_hero_points,
            continue_dist.expected_opp_points,
            public_state.my_score,
            public_state.opp_score,
            public_state.target_score,
        )

    # ── Use weighted net points for recommendation ──
    knock_net_weighted = knock_weighted.net_expected_points
    cont_net_weighted = continue_weighted.net_expected_points

    # Apply undercut penalty correction if enabled
    undercut_correction = 0.0
    estimator_uc_prob = None

    if use_undercut_penalty and estimator is not None:
        try:
            estimator_uc_prob = estimator.predict_undercut_prob_from_features(
                stock_size=public_state.stock_size,
                turn_number=public_state.turn_number,
                hero_deadwood=hero_dw,
                hero_dw_card_count=len(dw_cards),
                hero_meld_count=len(melds),
                discard_pile=public_state.discard_pile,
                hero_hand=hero_hand,
                my_score=public_state.my_score,
                opp_score=public_state.opp_score,
            )
        except Exception:
            estimator_uc_prob = None

    if use_undercut_penalty and estimator_uc_prob is not None:
        # Compare estimator's UC prediction to the meld-aware UC rate
        constructed_uc_rate = knock_weighted.undercut_rate
        uc_delta = estimator_uc_prob - constructed_uc_rate

        if uc_delta > 0.05:  # Only correct if material gap remains
            avg_undercut_cost = UNDERCUT_BONUS + hero_dw
            undercut_correction = -uc_delta * avg_undercut_cost * 0.4  # Damped
            knock_net_weighted += undercut_correction

    # ── Recommendation ──
    if me_knock is not None and me_continue is not None:
        adjusted_me_knock = me_knock
        if undercut_correction != 0:
            equity_correction = undercut_correction * 0.004
            adjusted_me_knock += equity_correction

        if adjusted_me_knock > me_continue:
            recommended = 'knock'
        elif me_continue > adjusted_me_knock:
            recommended = 'continue'
        else:
            recommended = 'knock'
    else:
        if knock_net_weighted > cont_net_weighted:
            recommended = 'knock'
        elif cont_net_weighted > knock_net_weighted:
            recommended = 'continue'
        else:
            recommended = 'knock'

    # ── Confidence ──
    point_spread = abs(knock_net_weighted - cont_net_weighted)
    confidence = min(1.0, point_spread / 10.0)

    # ── Diagnostics ──
    opp_dws = [compute_deadwood(opp) for opp, _ in worlds]
    diagnostics = {
        'worlds_sampled': len(worlds),
        'hero_deadwood': hero_dw,
        'stock_size': public_state.stock_size,
        'turn_number': public_state.turn_number,
        'score_state': f"{public_state.my_score}-{public_state.opp_score}",
        'continuation_policy': continuation_mode,
        'equity_model': 'empirical_table' if use_empirical_equity else 'linear_phase61',
        'belief_model': 'meld_aware_phase67',
        'solver_version': 'phase67_v5',
        # v5-specific diagnostics
        'estimator_uc_prob': round(estimator_uc_prob, 4) if estimator_uc_prob is not None else None,
        'uniform_uc_rate': round(knock_dist.undercut_rate, 4),
        'meld_aware_uc_rate': round(knock_weighted.undercut_rate, 4),
        'undercut_correction': round(undercut_correction, 2),
        'knock_net_weighted': round(knock_net_weighted, 2),
        'cont_net_weighted': round(cont_net_weighted, 2),
        'knock_net_unweighted': round(knock_dist.net_expected_points, 2),
        'cont_net_unweighted': round(continue_dist.net_expected_points, 2),
        # World quality diagnostics
        'opp_dw_mean': round(sum(opp_dws) / len(opp_dws), 2) if opp_dws else None,
        'opp_dw_min': min(opp_dws) if opp_dws else None,
        'opp_dw_max': max(opp_dws) if opp_dws else None,
        'opp_frac_dw_le5': round(
            sum(1 for d in opp_dws if d <= 5) / len(opp_dws), 4
        ) if opp_dws else None,
        # Constructor diagnostics
        'constructor': construct_diag,
        'approximations': [
            'meld_aware_world_construction',
            'per_card_trace_weights',
            'skeleton_enumeration_top_k',
            'three_tier_generation_strategy',
            'deadwood_quality_gating',
            f'{continuation_mode}_continuation_policy',
            'empirical_match_equity_table' if use_empirical_equity else 'linear_match_equity',
            'estimator_undercut_penalty' if use_undercut_penalty else 'no_undercut_penalty',
        ],
    }

    return SolverResult(
        knock_now=knock_dist,
        continue_play=continue_dist,
        recommended_action=recommended,
        confidence=confidence,
        match_equity_knock=me_knock,
        match_equity_continue=me_continue,
        diagnostics=diagnostics,
    )
