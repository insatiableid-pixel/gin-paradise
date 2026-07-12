"""
Phase 66 Task A+B: Belief-Weighted Hidden-World Generator.

Replaces the uniform hidden-world sampling from Phase 61 with a generator
that produces opponent hands consistent with:

  1. CARD-LEVEL LIKELIHOOD — per-card weights from public action history
     (opponent pickups, declines, discard patterns). Reuses OpponentModel.
  2. DEADWOOD-QUALITY PRIOR — predicted opponent deadwood distribution from
     the Phase 65 estimator. Reject or reweight worlds whose overall quality
     is implausible for champion-level late-game play.
  3. LEGAL CONSISTENCY — all visible card constraints enforced exactly.

Architecture:
  Two-stage importance-weighted sampling:
    Stage 1: Sample candidate opponent hands using card-level weights
             derived from public action history (OpponentModel).
    Stage 2: Compute per-world importance weight based on how well
             the hand's deadwood matches the predicted quality prior.

  This is a clean, testable design that separates card-level signal
  from hand-quality signal while remaining computationally tractable.

What is exact:
  - Card visibility constraints (hero hand, discard pile, known opponent pickups)
  - Meld arrangement / deadwood scoring for each candidate hand

What is heuristic:
  - Card-level weights from OpponentModel (pickup/decline/discard signals)
  - Deadwood-quality prior from UndercutRiskEstimator

What is approximate:
  - Importance weighting (not exhaustive enumeration)
  - Gaussian-shaped deadwood quality kernel
"""

import random
import math
from typing import List, Dict, Optional, Tuple, Set

from gin_rummy.card import (
    NUM_CARDS, rank, suit, make_card, deadwood_value, card_str
)
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.opponent_model import OpponentModel


# ── Card-Level Weight Builder ─────────────────────────────────────────

def build_card_weights_from_public_history(
    hero_hand: List[int],
    discard_pile: List[int],
    known_opponent_pickups: Optional[List[int]] = None,
    known_opponent_discards: Optional[List[int]] = None,
) -> Dict[int, float]:
    """
    Build per-card weights for opponent hand sampling using public
    action history.

    Uses OpponentModel's Bayesian-inspired weight system:
    - Cards opponent picked from discard → KNOWN_OPPONENT (weight ∞ / forced)
    - Cards near pickups → boosted weight (likely forming melds)
    - Cards near opponent discards → reduced weight (likely not needed)
    - Remaining cards → baseline weight 1.0

    Returns dict mapping card_id → weight for all unassigned cards.
    """
    model = OpponentModel()
    model.reset(hero_hand)

    # Mark discard pile
    for c in discard_pile:
        model.set_discard(c)

    # Process opponent pickup history
    if known_opponent_pickups:
        for c in known_opponent_pickups:
            # Only process if card still plausible (not yet re-discarded)
            if known_opponent_discards and c in known_opponent_discards:
                continue
            model.opponent_drew_discard(c)

    # Process opponent discard history
    if known_opponent_discards:
        for c in known_opponent_discards:
            model.opponent_discarded(c)

    # Build weight dict for all unknown cards
    hero_set = set(hero_hand)
    visible = set(discard_pile)
    weights = {}

    for card_id in range(NUM_CARDS):
        if card_id in hero_set or card_id in visible:
            continue
        weights[card_id] = model.weight[card_id]

    return weights


# ── Deadwood Quality Kernel ──────────────────────────────────────────

def deadwood_quality_weight(
    hand_deadwood: int,
    predicted_mean_dw: float,
    predicted_std_dw: float = 3.0,
) -> float:
    """
    Compute importance weight for a sampled opponent hand based on how
    well its deadwood matches the predicted distribution.

    Uses a Gaussian kernel centered on the predicted mean deadwood,
    with a configurable spread. Hands with deadwood very far from
    the prediction get low weight; hands near the prediction get
    high weight.

    The kernel is intentionally soft (std=3.0 by default) to avoid
    over-constraining the sampling — we want to bias toward realistic
    hands, not force them.
    """
    if predicted_std_dw <= 0:
        predicted_std_dw = 3.0

    z = (hand_deadwood - predicted_mean_dw) / predicted_std_dw
    return math.exp(-0.5 * z * z)


def deadwood_bucket_weight(
    hand_deadwood: int,
    bucket_probs: List[float],
) -> float:
    """
    Alternative: weight based on predicted bucket probabilities.

    bucket_probs is [P(0-2), P(3-5), P(6-10), P(>10)] from the estimator.
    Returns the probability mass assigned to the bucket this hand falls in.
    """
    if hand_deadwood <= 2:
        return bucket_probs[0] if len(bucket_probs) > 0 else 0.25
    elif hand_deadwood <= 5:
        return bucket_probs[1] if len(bucket_probs) > 1 else 0.25
    elif hand_deadwood <= 10:
        return bucket_probs[2] if len(bucket_probs) > 2 else 0.25
    else:
        return bucket_probs[3] if len(bucket_probs) > 3 else 0.25


# ── Belief-Weighted World Generator ──────────────────────────────────

def generate_belief_weighted_worlds(
    hero_hand: List[int],
    discard_pile: List[int],
    stock_size: int,
    n_worlds: int = 200,
    rng: Optional[random.Random] = None,
    # Card-level signal
    card_weights: Optional[Dict[int, float]] = None,
    known_opponent_pickups: Optional[List[int]] = None,
    known_opponent_discards: Optional[List[int]] = None,
    # Quality prior signal
    predicted_mean_opp_dw: Optional[float] = None,
    predicted_bucket_probs: Optional[List[float]] = None,
    # Control
    quality_weight_mode: str = 'gaussian',  # 'gaussian', 'bucket', or 'none'
    oversample_factor: int = 3,  # Generate N × oversample candidates, keep N best-weighted
    max_weight_ratio: float = 10.0,  # Clamp importance weights
) -> Tuple[List[Tuple[List[int], List[int]]], List[float]]:
    """
    Generate belief-weighted hidden worlds for the solver.

    Returns:
        (worlds, weights) where:
        - worlds is a list of (opponent_hand, stock_cards) tuples
        - weights is a list of per-world importance weights

    Architecture:
      1. Build or use provided card-level weights
      2. Generate n_worlds × oversample_factor candidate worlds
         using card-weighted sampling
      3. Score each candidate by deadwood quality prior
      4. Keep the n_worlds candidates with highest combined weight
      5. Return worlds + normalised importance weights

    This is a clean two-stage importance sampling design:
    - Stage 1 handles card-level signal (which cards opponent likely holds)
    - Stage 2 handles hand-level signal (what quality of hand is plausible)
    """
    if rng is None:
        rng = random.Random()

    hero_set = set(hero_hand)
    visible = set(discard_pile)

    # All unassigned cards
    unassigned = []
    for c in range(NUM_CARDS):
        if c not in hero_set and c not in visible:
            unassigned.append(c)

    opp_hand_size = 10

    if len(unassigned) < opp_hand_size:
        return [], []

    # Known opponent cards (picked from discard, not yet re-discarded)
    known_opp = set()
    if known_opponent_pickups:
        known_opp = set(known_opponent_pickups)
        if known_opponent_discards:
            known_opp -= set(known_opponent_discards)
        known_opp -= hero_set
        known_opp -= visible
    known_opp_in_unassigned = known_opp & set(unassigned)

    # Build card weights if not provided
    if card_weights is None:
        card_weights = build_card_weights_from_public_history(
            hero_hand, discard_pile,
            known_opponent_pickups, known_opponent_discards,
        )

    # Stage 1: Generate candidate worlds with card-level weights
    n_candidates = n_worlds * oversample_factor
    candidates = []  # (opp_hand, stock, card_sampling_weight)

    for _ in range(n_candidates):
        opp_hand = list(known_opp_in_unassigned)
        remaining_needed = opp_hand_size - len(opp_hand)

        pool = [c for c in unassigned if c not in known_opp_in_unassigned]

        if remaining_needed > len(pool):
            remaining_needed = len(pool)

        if remaining_needed > 0:
            pool_weights = [card_weights.get(c, 1.0) for c in pool]
            opp_sample = _weighted_sample_without_replacement(
                pool, pool_weights, remaining_needed, rng
            )
            opp_hand.extend(opp_sample)

        opp_set = set(opp_hand)
        stock_cards = [c for c in unassigned if c not in opp_set]
        rng.shuffle(stock_cards)

        candidates.append((opp_hand, stock_cards))

    # Stage 2: Score by deadwood quality prior
    scored = []
    for opp_hand, stock_cards in candidates:
        opp_dw = compute_deadwood(opp_hand)

        if quality_weight_mode == 'gaussian' and predicted_mean_opp_dw is not None:
            quality_w = deadwood_quality_weight(opp_dw, predicted_mean_opp_dw)
        elif quality_weight_mode == 'bucket' and predicted_bucket_probs is not None:
            quality_w = deadwood_bucket_weight(opp_dw, predicted_bucket_probs)
        else:
            quality_w = 1.0

        # Floor at a small positive value to prevent complete rejection
        quality_w = max(quality_w, 0.01)

        scored.append((opp_hand, stock_cards, quality_w))

    # Sort by quality weight (descending) and keep top n_worlds
    scored.sort(key=lambda x: x[2], reverse=True)
    selected = scored[:n_worlds]

    worlds = [(s[0], s[1]) for s in selected]
    raw_weights = [s[2] for s in selected]

    # Clamp weight ratio
    if raw_weights:
        min_w = min(raw_weights)
        if min_w > 0:
            ratios = [w / min_w for w in raw_weights]
            clamped = [min(r, max_weight_ratio) for r in ratios]
        else:
            clamped = raw_weights

        # Normalise so sum = n_worlds
        total = sum(clamped)
        if total > 0:
            weights = [w * n_worlds / total for w in clamped]
        else:
            weights = [1.0] * n_worlds
    else:
        weights = []

    return worlds, weights


# ── Convenience: Full Belief Generator ────────────────────────────────

def generate_worlds_with_estimator(
    hero_hand: List[int],
    discard_pile: List[int],
    stock_size: int,
    turn_number: int,
    my_score: int,
    opp_score: int,
    estimator=None,
    n_worlds: int = 200,
    rng: Optional[random.Random] = None,
    known_opponent_pickups: Optional[List[int]] = None,
    known_opponent_discards: Optional[List[int]] = None,
    quality_weight_mode: str = 'gaussian',
) -> Tuple[List[Tuple[List[int], List[int]]], List[float], Dict]:
    """
    Full belief-weighted world generator that integrates:
    1. Card-level weights from public action history
    2. Deadwood quality prior from the Phase 65 estimator
    3. All public state signals

    Returns:
        (worlds, weights, belief_diagnostics)
    """
    diagnostics = {
        'card_weight_source': 'public_action_history',
        'quality_prior_source': 'none',
        'quality_weight_mode': quality_weight_mode,
        'predicted_mean_opp_dw': None,
        'predicted_bucket_probs': None,
        'predicted_uc_prob': None,
    }

    # Build card weights from public history
    card_weights = build_card_weights_from_public_history(
        hero_hand, discard_pile,
        known_opponent_pickups, known_opponent_discards,
    )

    # Get quality prior from estimator
    predicted_mean_opp_dw = None
    predicted_bucket_probs = None
    predicted_uc_prob = None

    if estimator is not None:
        try:
            from gin_rummy.meld import best_meld_arrangement
            melds, dw_cards, hero_dw = best_meld_arrangement(hero_hand)

            from gin_rummy.undercut_dataset import LabelledKnockSpot
            pseudo = LabelledKnockSpot(
                hero_hand=list(hero_hand),
                hero_deadwood=hero_dw,
                hero_melds=[list(m) for m in melds],
                hero_dw_cards=list(dw_cards),
                stock_size=stock_size,
                turn_number=turn_number,
                my_score=my_score,
                opp_score=opp_score,
                discard_pile=list(discard_pile),
                opp_hand=[],
                opp_deadwood_raw=0,
                opp_deadwood_after_layoff=0,
                outcome='',
                hero_points=0, opp_points=0,
                undercut_ready=False,
                discard_pile_size=len(discard_pile),
                n_opponent_pickups=len(known_opponent_pickups or []),
                n_opponent_discards=len(known_opponent_discards or []),
                hero_dw_card_count=len(dw_cards),
                hero_meld_count=len(melds),
            )

            predicted_mean_opp_dw = estimator.predict_opp_dw(pseudo)
            predicted_bucket_probs = estimator.predict_bucket_probs(pseudo)
            predicted_uc_prob = estimator.predict_undercut_prob(pseudo)

            diagnostics['quality_prior_source'] = 'undercut_estimator'
            diagnostics['predicted_mean_opp_dw'] = round(predicted_mean_opp_dw, 2)
            diagnostics['predicted_bucket_probs'] = [round(p, 4) for p in predicted_bucket_probs]
            diagnostics['predicted_uc_prob'] = round(predicted_uc_prob, 4)
        except Exception as e:
            diagnostics['quality_prior_error'] = str(e)

    # Check if card weights have any non-trivial differentiation
    if card_weights:
        w_values = list(card_weights.values())
        w_min, w_max = min(w_values), max(w_values)
        diagnostics['card_weight_min'] = round(w_min, 3)
        diagnostics['card_weight_max'] = round(w_max, 3)
        diagnostics['card_weight_spread'] = round(w_max - w_min, 3)
    else:
        diagnostics['card_weight_spread'] = 0.0

    worlds, weights = generate_belief_weighted_worlds(
        hero_hand=hero_hand,
        discard_pile=discard_pile,
        stock_size=stock_size,
        n_worlds=n_worlds,
        rng=rng,
        card_weights=card_weights,
        known_opponent_pickups=known_opponent_pickups,
        known_opponent_discards=known_opponent_discards,
        predicted_mean_opp_dw=predicted_mean_opp_dw,
        predicted_bucket_probs=predicted_bucket_probs,
        quality_weight_mode=quality_weight_mode,
    )

    # Post-generation diagnostics
    if worlds:
        opp_dws = [compute_deadwood(opp) for opp, _ in worlds]
        diagnostics['sampled_mean_opp_dw'] = round(sum(opp_dws) / len(opp_dws), 2)
        diagnostics['sampled_min_opp_dw'] = min(opp_dws)
        diagnostics['sampled_max_opp_dw'] = max(opp_dws)
        diagnostics['n_worlds_generated'] = len(worlds)

        # Fraction with DW <= 5 (late-game realistic range)
        low_dw_count = sum(1 for d in opp_dws if d <= 5)
        diagnostics['sampled_frac_opp_dw_le5'] = round(low_dw_count / len(opp_dws), 4)

    return worlds, weights, diagnostics


# ── Internal Helper ──────────────────────────────────────────────────

def _weighted_sample_without_replacement(
    items: List[int],
    weights: List[float],
    k: int,
    rng: random.Random,
) -> List[int]:
    """Weighted sampling without replacement."""
    pool = list(zip(items, weights))
    result = []
    for _ in range(k):
        if not pool:
            break
        total = sum(w for _, w in pool)
        if total <= 0:
            idx = rng.randrange(len(pool))
        else:
            r = rng.random() * total
            cumulative = 0.0
            idx = 0
            for i, (_, w) in enumerate(pool):
                cumulative += w
                if cumulative >= r:
                    idx = i
                    break
        result.append(pool[idx][0])
        pool.pop(idx)
    return result
