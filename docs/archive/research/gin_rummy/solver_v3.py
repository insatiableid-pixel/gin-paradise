"""
Phase 65 Task D: Solver v3 with Undercut-Aware Belief Calibration.

Integrates the undercut-risk estimator into the solver using a hybrid
approach:

  1. BELIEF REWEIGHTING: reweight hidden-world samples toward opponent
     hands consistent with the estimated low-stock deadwood distribution.
     Worlds where opponent has low DW (undercut-ready) get up-weighted
     when the estimator predicts high undercut risk.

  2. DIRECT UNDERCUT PENALTY: adjust knock-now evaluation using the
     calibrated undercut-risk estimate as an explicit correction term.

Architecture:
  Wraps solver_v2 and adds the undercut-calibration layer.
  solver_v2 is preserved unchanged for regression testing.
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
    generate_hidden_worlds, evaluate_knock_now,
)
from gin_rummy.solver_v2 import (
    simulate_continuation_policy, CONTINUATION_CHAMPION,
    _compute_empirical_equity,
)


# ── Belief Reweighting ───────────────────────────────────────────────

def compute_belief_weights(
    worlds: List[Tuple[List[int], List[int]]],
    hero_hand: List[int],
    estimator_uc_prob: float,
    hero_dw: int,
) -> List[float]:
    """
    Compute per-world importance weights that shift the belief distribution
    toward the estimator's predicted undercut probability.
    
    Strategy: 
      - Classify each world as 'undercut_ready' or not based on exact 
        knock scoring against the sampled opponent hand.
      - Compute target fraction of undercut-ready worlds = estimator_uc_prob.
      - Reweight worlds so the weighted undercut fraction matches the target.
    
    This is lightweight importance sampling that preserves the diversity of
    world sampling while correcting the aggregate undercut rate.
    """
    n = len(worlds)
    if n == 0:
        return []

    # Classify each world
    hero_melds, hero_dw_cards, _ = best_meld_arrangement(hero_hand)
    undercut_flags = []

    for opp_hand, stock in worlds:
        outcome = evaluate_knock_now(hero_hand, opp_hand)
        undercut_flags.append(outcome.undercut)

    uc_count = sum(undercut_flags)
    non_uc = n - uc_count

    if uc_count == 0 or non_uc == 0:
        # Degenerate: can't reweight if all same class
        return [1.0] * n

    # Current empirical rates
    current_uc_rate = uc_count / n
    target_uc_rate = max(0.01, min(0.99, estimator_uc_prob))

    # Compute per-class weights
    # w_uc * uc_count + w_non_uc * non_uc = n  (normalisation)
    # w_uc * uc_count / n = target_uc_rate
    w_uc = target_uc_rate * n / uc_count
    w_non_uc = (1 - target_uc_rate) * n / non_uc

    # Clamp weights to avoid extreme values
    max_weight = 5.0
    w_uc = min(w_uc, max_weight)
    w_non_uc = min(w_non_uc, max_weight)

    weights = []
    for is_uc in undercut_flags:
        weights.append(w_uc if is_uc else w_non_uc)

    # Normalise so sum = n
    total = sum(weights)
    if total > 0:
        weights = [w * n / total for w in weights]

    return weights


# ── Weighted Outcome Aggregation ─────────────────────────────────────

class WeightedOutcomeDistribution:
    """Outcome distribution with importance weights."""

    def __init__(self, outcomes: List[HandOutcome], weights: List[float]):
        self.outcomes = outcomes
        self.weights = weights
        self._total_weight = sum(weights)

    @property
    def n(self) -> int:
        return len(self.outcomes)

    def _weighted_rate(self, predicate) -> float:
        if self._total_weight <= 0:
            return 0.0
        return sum(
            w for o, w in zip(self.outcomes, self.weights) if predicate(o)
        ) / self._total_weight

    @property
    def undercut_rate(self) -> float:
        return self._weighted_rate(lambda o: o.undercut)

    @property
    def gin_rate(self) -> float:
        return self._weighted_rate(lambda o: o.gin)

    @property
    def knock_win_rate(self) -> float:
        return self._weighted_rate(lambda o: o.knock_win)

    @property
    def expected_hero_points(self) -> float:
        if self._total_weight <= 0:
            return 0.0
        return sum(
            o.hero_points * w for o, w in zip(self.outcomes, self.weights)
        ) / self._total_weight

    @property
    def expected_opp_points(self) -> float:
        if self._total_weight <= 0:
            return 0.0
        return sum(
            o.opp_points * w for o, w in zip(self.outcomes, self.weights)
        ) / self._total_weight

    @property
    def net_expected_points(self) -> float:
        return self.expected_hero_points - self.expected_opp_points

    def to_dict(self) -> Dict:
        return {
            'n_worlds': self.n,
            'undercut_rate': round(self.undercut_rate, 4),
            'gin_rate': round(self.gin_rate, 4),
            'knock_win_rate': round(self.knock_win_rate, 4),
            'expected_hero_pts': round(self.expected_hero_points, 2),
            'expected_opp_pts': round(self.expected_opp_points, 2),
            'net_expected_pts': round(self.net_expected_points, 2),
        }


# ── Solver v3 ────────────────────────────────────────────────────────

def solve_spot_v3(
    hero_hand: List[int],
    public_state: PublicState,
    estimator=None,
    n_worlds: int = 200,
    seed: Optional[int] = None,
    opponent_weights: Optional[Dict[int, float]] = None,
    use_belief_reweighting: bool = True,
    use_undercut_penalty: bool = True,
    continuation_mode: str = CONTINUATION_CHAMPION,
    use_empirical_equity: bool = True,
    compute_match_equity: bool = True,
) -> SolverResult:
    """
    Phase 65 solver with undercut-aware belief calibration.
    
    Improvements over solver_v2:
      1. Belief reweighting: hidden worlds are importance-weighted to match
         estimated undercut probability from the calibration model.
      2. Undercut penalty: knock-now EV is corrected by the calibrated
         undercut-risk estimate.
      3. All Phase 62 features preserved (policy-backed continuation,
         empirical match-equity table).
    """
    public_state.validate()

    melds, dw_cards, hero_dw = best_meld_arrangement(hero_hand)
    if hero_dw > 10:
        raise ValueError(f"Hero cannot knock: deadwood {hero_dw} > 10")
    if len(hero_hand) != 10:
        raise ValueError(f"Hero hand must have 10 cards, got {len(hero_hand)}")

    rng = random.Random(seed) if seed is not None else random.Random()

    # Generate hidden worlds (same as v2)
    worlds = generate_hidden_worlds(
        hero_hand=hero_hand,
        public_state=public_state,
        n_worlds=n_worlds,
        rng=rng,
        opponent_weights=opponent_weights,
    )

    if not worlds:
        return SolverResult(
            knock_now=OutcomeDistribution(),
            continue_play=OutcomeDistribution(),
            recommended_action='knock',
            confidence=0.0,
            diagnostics={'error': 'no_valid_worlds'},
        )

    # Get estimator prediction (if available)
    estimator_uc_prob = None
    estimator_opp_dw = None
    if estimator is not None:
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

    # Compute outcomes for each world
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

    # Compute belief weights
    if use_belief_reweighting and estimator_uc_prob is not None:
        weights = compute_belief_weights(
            worlds, hero_hand, estimator_uc_prob, hero_dw
        )
    else:
        weights = [1.0] * len(worlds)

    # Build weighted outcome distributions
    knock_weighted = WeightedOutcomeDistribution(knock_outcomes_list, weights)
    # Continue outcomes use uniform weights (reweighting only affects
    # knock-now evaluation, since the undercut risk is specific to
    # knocking immediately)
    continue_weighted = WeightedOutcomeDistribution(
        continue_outcomes_list, [1.0] * len(continue_outcomes_list)
    )

    # Build standard OutcomeDistribution for compatibility
    knock_dist = OutcomeDistribution(outcomes=knock_outcomes_list)
    continue_dist = OutcomeDistribution(outcomes=continue_outcomes_list)

    # Compute match equity
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

    # Use weighted net points for recommendation
    knock_net_weighted = knock_weighted.net_expected_points
    cont_net = continue_dist.net_expected_points

    # Apply undercut penalty correction if enabled
    undercut_correction = 0.0
    if use_undercut_penalty and estimator_uc_prob is not None:
        # The correction shifts knock-now EV downward when the estimator
        # predicts higher undercut risk than the uniform sampling implies.
        uniform_uc_rate = knock_dist.undercut_rate
        uc_delta = estimator_uc_prob - uniform_uc_rate

        if uc_delta > 0:
            # Estimator thinks undercut risk is HIGHER than uniform sampling
            # Penalty = excess undercut probability * average undercut cost
            avg_undercut_cost = UNDERCUT_BONUS + hero_dw  # expected opponent gain
            undercut_correction = -uc_delta * avg_undercut_cost
            knock_net_weighted += undercut_correction

    # Recommendation
    if me_knock is not None and me_continue is not None:
        # Adjust match equity for undercut correction
        adjusted_me_knock = me_knock
        if undercut_correction != 0 and me_knock is not None:
            # Rough translation of point correction to equity
            equity_correction = undercut_correction * 0.004  # ~0.4% per point
            adjusted_me_knock += equity_correction

        if adjusted_me_knock > me_continue:
            recommended = 'knock'
        elif me_continue > adjusted_me_knock:
            recommended = 'continue'
        else:
            recommended = 'knock'
    else:
        if knock_net_weighted > cont_net:
            recommended = 'knock'
        elif cont_net > knock_net_weighted:
            recommended = 'continue'
        else:
            recommended = 'knock'

    # Confidence
    point_spread = abs(knock_net_weighted - cont_net)
    confidence = min(1.0, point_spread / 10.0)

    # Diagnostics
    diagnostics = {
        'worlds_sampled': len(worlds),
        'hero_deadwood': hero_dw,
        'stock_size': public_state.stock_size,
        'turn_number': public_state.turn_number,
        'score_state': f"{public_state.my_score}-{public_state.opp_score}",
        'continuation_policy': continuation_mode,
        'equity_model': 'empirical_table' if use_empirical_equity else 'linear_phase61',
        'belief_model': 'undercut_calibrated' if use_belief_reweighting and estimator_uc_prob is not None else 'uniform',
        'solver_version': 'phase65_v3',
        'estimator_uc_prob': round(estimator_uc_prob, 4) if estimator_uc_prob is not None else None,
        'uniform_uc_rate': round(knock_dist.undercut_rate, 4),
        'weighted_uc_rate': round(knock_weighted.undercut_rate, 4),
        'undercut_correction': round(undercut_correction, 2),
        'knock_net_uniform': round(knock_dist.net_expected_points, 2),
        'knock_net_weighted': round(knock_net_weighted, 2),
        'continue_net': round(cont_net, 2),
        'approximations': [
            'undercut_calibrated_belief_reweighting',
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
