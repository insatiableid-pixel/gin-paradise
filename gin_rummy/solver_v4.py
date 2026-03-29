"""
Phase 66 Task C: Solver v4 with Belief-Weighted World Generator.

Integrates the Phase 66 belief-weighted hidden-world generator into the
solver, replacing uniform sampling with realistic opponent hand distributions.

Key differences from solver_v3:
  - v3 used uniform world sampling + post-hoc importance reweighting
  - v4 uses a fundamentally different world generator that produces
    realistic opponent hands FROM THE START, then uses those worlds
    directly for both knock and continuation evaluation

Architecture:
  1. BELIEF-WEIGHTED WORLDS: uses generate_worlds_with_estimator() which
     combines card-level weights (from public action history / OpponentModel)
     with deadwood-quality priors (from Phase 65 estimator)
  2. IMPORTANCE-WEIGHTED EVALUATION: each world carries its own importance
     weight, which flows through knock-now and continuation evaluation
  3. ESTIMATOR UNDERCUT PENALTY: retained from v3 as an additional
     calibration correction on top of the improved world generation
  4. All Phase 62 features preserved (policy-backed continuation,
     empirical match-equity table)

Solver hierarchy:
  v1 (Phase 61): uniform worlds + greedy continuation
  v2 (Phase 62): uniform worlds + champion continuation + empirical equity
  v3 (Phase 65): uniform worlds + belief reweighting + undercut penalty
  v4 (Phase 66): belief-weighted worlds + importance weights + undercut penalty
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
from gin_rummy.belief_world_generator import generate_worlds_with_estimator


# ── Solver v4 ────────────────────────────────────────────────────────

def solve_spot_v4(
    hero_hand: List[int],
    public_state: PublicState,
    estimator=None,
    n_worlds: int = 200,
    seed: Optional[int] = None,
    use_undercut_penalty: bool = True,
    continuation_mode: str = CONTINUATION_CHAMPION,
    use_empirical_equity: bool = True,
    compute_match_equity: bool = True,
    quality_weight_mode: str = 'gaussian',
) -> SolverResult:
    """
    Phase 66 solver with belief-weighted world generation.

    Key improvements over solver_v3:
      1. World generator is fundamentally improved: produces opponent hands
         consistent with both card-level public signals AND predicted
         deadwood quality, not uniform sampling + post-hoc reweighting.
      2. Importance weights from the generator flow through all evaluation
         (knock and continue), not just knock-now.
      3. Undercut penalty retained as secondary calibration correction.
      4. All Phase 62 features preserved (policy-backed continuation,
         empirical match-equity table).
    """
    public_state.validate()

    melds, dw_cards, hero_dw = best_meld_arrangement(hero_hand)
    if hero_dw > 10:
        raise ValueError(f"Hero cannot knock: deadwood {hero_dw} > 10")
    if len(hero_hand) != 10:
        raise ValueError(f"Hero hand must have 10 cards, got {len(hero_hand)}")

    rng = random.Random(seed) if seed is not None else random.Random()

    # ── Generate belief-weighted worlds ──
    worlds, world_weights, belief_diag = generate_worlds_with_estimator(
        hero_hand=hero_hand,
        discard_pile=list(public_state.discard_pile),
        stock_size=public_state.stock_size,
        turn_number=public_state.turn_number,
        my_score=public_state.my_score,
        opp_score=public_state.opp_score,
        estimator=estimator,
        n_worlds=n_worlds,
        rng=rng,
        known_opponent_pickups=list(public_state.known_opponent_pickups) if public_state.known_opponent_pickups else None,
        known_opponent_discards=list(public_state.known_opponent_discards) if public_state.known_opponent_discards else None,
        quality_weight_mode=quality_weight_mode,
    )

    if not worlds:
        return SolverResult(
            knock_now=OutcomeDistribution(),
            continue_play=OutcomeDistribution(),
            recommended_action='knock',
            confidence=0.0,
            diagnostics={'error': 'no_valid_worlds'},
        )

    # Use uniform weights if generator didn't produce them
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
    # v4 key difference: worlds are ALREADY belief-biased, and we apply
    # the generator's importance weights to BOTH knock and continue
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
    estimator_uc_prob = belief_diag.get('predicted_uc_prob', None)

    if use_undercut_penalty and estimator_uc_prob is not None:
        # Compare estimator's UC prediction to the belief-weighted UC rate
        # (which should already be much closer to reality than uniform)
        weighted_uc_rate = knock_weighted.undercut_rate
        uc_delta = estimator_uc_prob - weighted_uc_rate

        if uc_delta > 0.05:  # Only correct if material gap remains
            avg_undercut_cost = UNDERCUT_BONUS + hero_dw
            undercut_correction = -uc_delta * avg_undercut_cost * 0.5  # Damped
            knock_net_weighted += undercut_correction

    # ── Recommendation ──
    if me_knock is not None and me_continue is not None:
        adjusted_me_knock = me_knock
        if undercut_correction != 0 and me_knock is not None:
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
    diagnostics = {
        'worlds_sampled': len(worlds),
        'hero_deadwood': hero_dw,
        'stock_size': public_state.stock_size,
        'turn_number': public_state.turn_number,
        'score_state': f"{public_state.my_score}-{public_state.opp_score}",
        'continuation_policy': continuation_mode,
        'equity_model': 'empirical_table' if use_empirical_equity else 'linear_phase61',
        'belief_model': 'belief_weighted_phase66',
        'solver_version': 'phase66_v4',
        # v4-specific diagnostics
        'quality_weight_mode': quality_weight_mode,
        'estimator_uc_prob': round(estimator_uc_prob, 4) if estimator_uc_prob is not None else None,
        'uniform_uc_rate': round(knock_dist.undercut_rate, 4),
        'belief_weighted_uc_rate': round(knock_weighted.undercut_rate, 4),
        'undercut_correction': round(undercut_correction, 2),
        'knock_net_weighted': round(knock_net_weighted, 2),
        'cont_net_weighted': round(cont_net_weighted, 2),
        'knock_net_unweighted': round(knock_dist.net_expected_points, 2),
        'cont_net_unweighted': round(continue_dist.net_expected_points, 2),
        # Belief generator diagnostics
        'belief_generator': belief_diag,
        'approximations': [
            'belief_weighted_world_generation',
            'card_level_public_action_weights',
            'deadwood_quality_prior_from_estimator',
            f'{quality_weight_mode}_quality_kernel',
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
