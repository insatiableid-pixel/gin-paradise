"""
Phase 67 Task B+C: Meld-Aware Opponent Hand Constructor.

The core of Phase 67: replace random card sampling with *meld-first*
opponent hand construction. This is the layer Phase 66 proved was missing.

Architecture (range-construction, not random sampling):

  1. MELD SKELETON ENUMERATION — find all plausible meld skeletons
     (sets and runs) from the unknown card pool, scored by trace-weight
     consistency.
  2. TOP-K SKELETON SELECTION — pick the K most plausible meld structures.
  3. HAND COMPLETION — for each skeleton, fill remaining slots with
     plausible deadwood cards (trace-weighted sampling).
  4. QUALITY GATING — score completed hands against the predicted
     deadwood distribution and reject implausible hands.
  5. WEIGHTED OUTPUT — return candidate hands with importance weights
     for use in solver evaluation.

What is exact:
  - Meld arrangement / deadwood scoring for each candidate hand
  - Card visibility constraints

What is heuristic:
  - Meld skeleton scoring (trace-weight sum as proxy for plausibility)
  - Deadwood quality gating (Gaussian kernel on predicted mean DW)
  - Skeleton selection (top-K by score)

What is approximate:
  - Finite skeleton enumeration (not exhaustive over all possible melds)
  - Completion sampling (not exhaustive over all possible fills)
"""

import random
import math
from typing import List, Dict, Optional, Tuple, Set
from collections import defaultdict

from gin_rummy.card import (
    NUM_CARDS, rank, suit, make_card, deadwood_value, card_str
)
from gin_rummy.meld import (
    best_meld_arrangement, compute_deadwood,
    find_sets, find_runs
)
from gin_rummy.action_trace import (
    ActionTrace, build_trace_weights, trace_weight_diagnostics
)


# ── Meld Skeleton Types ──────────────────────────────────────────────

def enumerate_meld_skeletons(
    pool: List[int],
    trace_weights: Dict[int, float],
    max_skeletons: int = 60,
    min_skeleton_score: float = 0.5,
) -> List[Tuple[List[Tuple[int, ...]], float]]:
    """
    Enumerate plausible meld skeletons from the unknown card pool.

    A "skeleton" is a non-overlapping set of 1-3 melds that could be
    in the opponent's hand. Each skeleton is scored by the sum of
    trace weights of its constituent cards (higher = more plausible).

    Returns:
        List of (melds_list, skeleton_score) tuples, sorted by score
        descending. Each melds_list is a list of card tuples.
    """
    # Find all individual melds from the pool
    all_sets = find_sets(pool)
    all_runs = find_runs(pool)
    all_melds = all_sets + all_runs

    if not all_melds:
        return []

    # Score each individual meld by trace-weight sum
    scored_melds = []
    for m in all_melds:
        score = sum(trace_weights.get(c, 1.0) for c in m)
        # Bonus for larger melds (runs of 4+ are stronger signals)
        if len(m) >= 4:
            score *= 1.3
        scored_melds.append((m, score))

    # Sort by score descending
    scored_melds.sort(key=lambda x: x[1], reverse=True)

    # Build skeletons: combinations of 1-3 non-overlapping melds
    # Start with single-meld skeletons
    skeletons: List[Tuple[List[Tuple[int, ...]], float]] = []

    # Single-meld skeletons (all scored melds)
    for m, score in scored_melds:
        if score >= min_skeleton_score:
            skeletons.append(([m], score))

    # Two-meld skeletons (top melds combined if non-overlapping)
    top_melds = scored_melds[:30]  # limit for combinatorial tractability
    for i in range(len(top_melds)):
        m1, s1 = top_melds[i]
        cards1 = set(m1)
        for j in range(i + 1, len(top_melds)):
            m2, s2 = top_melds[j]
            if not cards1.intersection(m2):
                combined_score = s1 + s2
                if combined_score >= min_skeleton_score:
                    skeletons.append(([m1, m2], combined_score))
                    if len(skeletons) > max_skeletons * 3:
                        break
        if len(skeletons) > max_skeletons * 3:
            break

    # Three-meld skeletons (only from top-10 melds)
    top_3 = scored_melds[:12]
    for i in range(len(top_3)):
        m1, s1 = top_3[i]
        cards1 = set(m1)
        for j in range(i + 1, len(top_3)):
            m2, s2 = top_3[j]
            if cards1.intersection(m2):
                continue
            cards12 = cards1 | set(m2)
            for k in range(j + 1, len(top_3)):
                m3, s3 = top_3[k]
                if not cards12.intersection(m3):
                    combined_score = s1 + s2 + s3
                    if combined_score >= min_skeleton_score:
                        skeletons.append(([m1, m2, m3], combined_score))

    # Sort by score descending, keep top-K
    skeletons.sort(key=lambda x: x[1], reverse=True)
    return skeletons[:max_skeletons]


# ── Meld-Aware Hand Constructor ──────────────────────────────────────

def construct_meld_aware_hands(
    hero_hand: List[int],
    discard_pile: List[int],
    stock_size: int,
    n_hands: int = 200,
    rng: Optional[random.Random] = None,
    # Trace signal
    trace: Optional[ActionTrace] = None,
    known_opponent_pickups: Optional[List[int]] = None,
    known_opponent_discards: Optional[List[int]] = None,
    # Quality prior
    predicted_mean_opp_dw: Optional[float] = None,
    predicted_std_dw: float = 4.0,
    # Control
    max_skeletons: int = 50,
    skeleton_fraction: float = 0.65,  # fraction of hands built from skeletons
    random_fraction: float = 0.20,    # fraction from trace-weighted random
    zero_meld_fraction: float = 0.15, # fraction with no forced melds (high-DW)
    quality_oversample: int = 3,
) -> Tuple[List[Tuple[List[int], List[int]]], List[float], Dict]:
    """
    Construct plausible opponent hands using meld-first construction.

    Three-tier generation strategy:
      Tier 1 (skeleton_fraction): Build hands around meld skeletons.
        - Pick a skeleton, force its cards into the hand, fill rest from pool.
      Tier 2 (random_fraction): Trace-weighted random sampling.
        - No forced melds, but card-level weights still active.
        - Catches cases where opponent has few melds.
      Tier 3 (zero_meld_fraction): Deliberately high-deadwood hands.
        - Biased toward face cards / high-DW cards.
        - Represents opponents who are stuck with bad hands.

    After generation, all hands are quality-gated against the predicted
    deadwood distribution and importance-weighted.

    Returns:
        (worlds, weights, diagnostics) where:
        - worlds is list of (opponent_hand, stock_cards) tuples
        - weights is per-world importance weights
        - diagnostics is dict of construction statistics
    """
    if rng is None:
        rng = random.Random()

    hero_set = set(hero_hand)
    visible = set(discard_pile)

    # All unassigned cards
    unassigned = [c for c in range(NUM_CARDS)
                  if c not in hero_set and c not in visible]

    opp_hand_size = 10
    if len(unassigned) < opp_hand_size:
        return [], [], {'error': 'insufficient_unassigned_cards'}

    # Build trace weights
    trace_weights = build_trace_weights(
        hero_hand, discard_pile,
        trace=trace,
        known_opponent_pickups=known_opponent_pickups,
        known_opponent_discards=known_opponent_discards,
    )

    # Determine known opponent cards (forced into every hand)
    known_opp = set()
    if known_opponent_pickups:
        known_opp = set(known_opponent_pickups)
        if known_opponent_discards:
            known_opp -= set(known_opponent_discards)
        known_opp -= hero_set
        known_opp -= visible
    known_opp_in_pool = known_opp & set(unassigned)

    # Sampling pool excludes known-opponent cards (they are forced)
    sampling_pool = [c for c in unassigned if c not in known_opp_in_pool]

    # Enumerate meld skeletons from the pool
    skeletons = enumerate_meld_skeletons(
        sampling_pool, trace_weights, max_skeletons=max_skeletons
    )

    # ── Compute tier sizes ──
    total_candidates = n_hands * quality_oversample
    n_skeleton = int(total_candidates * skeleton_fraction) if skeletons else 0
    n_random = int(total_candidates * random_fraction)
    n_zero_meld = total_candidates - n_skeleton - n_random

    # If no skeletons found, redistribute to random
    if not skeletons:
        n_random = int(total_candidates * (skeleton_fraction + random_fraction))
        n_zero_meld = total_candidates - n_random

    # ── Tier 1: Skeleton-based hands ──
    candidates = []
    tier_counts = {'skeleton': 0, 'random': 0, 'zero_meld': 0}

    for i in range(n_skeleton):
        # Pick a skeleton (weighted by score)
        skel_melds, skel_score = _pick_skeleton(skeletons, rng)
        hand = _build_hand_from_skeleton(
            skel_melds, known_opp_in_pool, sampling_pool,
            trace_weights, opp_hand_size, rng
        )
        if hand is not None:
            opp_set = set(hand)
            stock = [c for c in unassigned if c not in opp_set]
            rng.shuffle(stock)
            candidates.append((hand, stock, 'skeleton'))
            tier_counts['skeleton'] += 1

    # ── Tier 2: Trace-weighted random ──
    for i in range(n_random):
        hand = _build_random_hand(
            known_opp_in_pool, sampling_pool, trace_weights,
            opp_hand_size, rng
        )
        if hand is not None:
            opp_set = set(hand)
            stock = [c for c in unassigned if c not in opp_set]
            rng.shuffle(stock)
            candidates.append((hand, stock, 'random'))
            tier_counts['random'] += 1

    # ── Tier 3: Zero-meld (high deadwood) hands ──
    for i in range(n_zero_meld):
        hand = _build_high_dw_hand(
            known_opp_in_pool, sampling_pool, trace_weights,
            opp_hand_size, rng
        )
        if hand is not None:
            opp_set = set(hand)
            stock = [c for c in unassigned if c not in opp_set]
            rng.shuffle(stock)
            candidates.append((hand, stock, 'zero_meld'))
            tier_counts['zero_meld'] += 1

    if not candidates:
        return [], [], {'error': 'no_candidates_generated'}

    # ── Quality gating: score each hand ──
    scored = []
    for hand, stock, tier in candidates:
        dw = compute_deadwood(hand)

        # Quality weight: how well does this hand's DW match prediction?
        if predicted_mean_opp_dw is not None:
            z = (dw - predicted_mean_opp_dw) / max(predicted_std_dw, 1.0)
            quality_w = math.exp(-0.5 * z * z)
        else:
            quality_w = 1.0

        # Trace consistency: how well does this hand match card-level weights?
        trace_score = sum(trace_weights.get(c, 1.0) for c in hand
                          if c not in known_opp_in_pool)
        n_sampled = max(1, len(hand) - len(known_opp_in_pool))
        trace_consistency = trace_score / n_sampled  # normalize by hand size

        # Combined weight
        combined = quality_w * trace_consistency
        combined = max(combined, 0.01)  # floor
        scored.append((hand, stock, combined, dw, tier))

    # Sort by combined weight, keep top n_hands
    scored.sort(key=lambda x: x[2], reverse=True)
    selected = scored[:n_hands]

    worlds = [(s[0], s[1]) for s in selected]
    raw_weights = [s[2] for s in selected]

    # Normalize weights so sum = n_hands
    total_w = sum(raw_weights)
    if total_w > 0:
        weights = [w * n_hands / total_w for w in raw_weights]
    else:
        weights = [1.0] * n_hands

    # Clamp weight ratio
    if weights:
        min_w = min(weights)
        max_w = max(weights)
        if min_w > 0 and max_w / min_w > 15.0:
            # Soft clamp: compress extreme ratios
            median_w = sorted(weights)[len(weights) // 2]
            weights = [min(w, median_w * 15.0) for w in weights]
            # Re-normalize
            total_w2 = sum(weights)
            if total_w2 > 0:
                weights = [w * n_hands / total_w2 for w in weights]

    # ── Diagnostics ──
    dw_values = [s[3] for s in selected]
    tier_selected = defaultdict(int)
    for s in selected:
        tier_selected[s[4]] += 1

    diag = {
        'n_candidates_generated': len(candidates),
        'n_selected': len(selected),
        'n_skeletons_found': len(skeletons),
        'tier_counts_generated': dict(tier_counts),
        'tier_counts_selected': dict(tier_selected),
        'trace_weight_diag': trace_weight_diagnostics(trace_weights),
        'selected_dw_mean': round(sum(dw_values) / len(dw_values), 2) if dw_values else None,
        'selected_dw_min': min(dw_values) if dw_values else None,
        'selected_dw_max': max(dw_values) if dw_values else None,
        'selected_frac_dw_le5': round(
            sum(1 for d in dw_values if d <= 5) / len(dw_values), 4
        ) if dw_values else None,
        'predicted_mean_opp_dw': predicted_mean_opp_dw,
        'constructor_mode': 'meld_aware_phase67',
    }

    return worlds, weights, diag


# ── Internal: Hand Construction Helpers ───────────────────────────────

def _pick_skeleton(
    skeletons: List[Tuple[List[Tuple[int, ...]], float]],
    rng: random.Random,
) -> Tuple[List[Tuple[int, ...]], float]:
    """Pick a skeleton weighted by score."""
    total = sum(s for _, s in skeletons)
    if total <= 0:
        idx = rng.randrange(len(skeletons))
        return skeletons[idx]

    r = rng.random() * total
    cumulative = 0.0
    for melds, score in skeletons:
        cumulative += score
        if cumulative >= r:
            return melds, score
    return skeletons[-1]


def _build_hand_from_skeleton(
    skeleton_melds: List[Tuple[int, ...]],
    known_forced: Set[int],
    pool: List[int],
    trace_weights: Dict[int, float],
    hand_size: int,
    rng: random.Random,
) -> Optional[List[int]]:
    """Build a full opponent hand around a meld skeleton."""
    # Start with known forced cards
    hand = list(known_forced)
    used = set(hand)

    # Add skeleton cards
    for meld in skeleton_melds:
        for c in meld:
            if c not in used:
                hand.append(c)
                used.add(c)

    remaining_needed = hand_size - len(hand)
    if remaining_needed < 0:
        # Skeleton too large — trim to hand size
        hand = hand[:hand_size]
        return hand
    if remaining_needed == 0:
        return hand

    # Fill remaining slots from pool using trace weights
    fill_pool = [c for c in pool if c not in used]
    if len(fill_pool) < remaining_needed:
        return None

    fill_weights = [trace_weights.get(c, 1.0) for c in fill_pool]
    fill_cards = _weighted_sample_no_replace(fill_pool, fill_weights,
                                             remaining_needed, rng)
    hand.extend(fill_cards)
    return hand


def _build_random_hand(
    known_forced: Set[int],
    pool: List[int],
    trace_weights: Dict[int, float],
    hand_size: int,
    rng: random.Random,
) -> Optional[List[int]]:
    """Build a random hand using trace weights (no forced melds)."""
    hand = list(known_forced)
    used = set(hand)
    remaining_needed = hand_size - len(hand)

    fill_pool = [c for c in pool if c not in used]
    if len(fill_pool) < remaining_needed:
        return None

    fill_weights = [trace_weights.get(c, 1.0) for c in fill_pool]
    fill_cards = _weighted_sample_no_replace(fill_pool, fill_weights,
                                             remaining_needed, rng)
    hand.extend(fill_cards)
    return hand


def _build_high_dw_hand(
    known_forced: Set[int],
    pool: List[int],
    trace_weights: Dict[int, float],
    hand_size: int,
    rng: random.Random,
) -> Optional[List[int]]:
    """Build a deliberately high-deadwood hand (opponent stuck with junk)."""
    hand = list(known_forced)
    used = set(hand)
    remaining_needed = hand_size - len(hand)

    fill_pool = [c for c in pool if c not in used]
    if len(fill_pool) < remaining_needed:
        return None

    # Bias toward high deadwood-value cards (face cards, 10s)
    # and cards with LOW trace weight (opponent less likely to hold =
    # these "leftover" cards are realistic junk)
    fill_weights = []
    for c in fill_pool:
        dw_val = deadwood_value(c)
        trace_w = trace_weights.get(c, 1.0)
        # High DW value = more likely in a junk hand
        # Low trace weight = less likely opponent specifically wants it
        # So we weight by dw_value / trace_weight
        w = (dw_val / max(trace_w, 0.1)) ** 0.5
        fill_weights.append(max(w, 0.01))

    fill_cards = _weighted_sample_no_replace(fill_pool, fill_weights,
                                             remaining_needed, rng)
    hand.extend(fill_cards)
    return hand


def _weighted_sample_no_replace(
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


# ── Convenience: Full Constructor With Estimator ──────────────────────

def construct_worlds_with_estimator(
    hero_hand: List[int],
    discard_pile: List[int],
    stock_size: int,
    turn_number: int,
    my_score: int,
    opp_score: int,
    estimator=None,
    n_hands: int = 200,
    rng: Optional[random.Random] = None,
    trace: Optional[ActionTrace] = None,
    known_opponent_pickups: Optional[List[int]] = None,
    known_opponent_discards: Optional[List[int]] = None,
) -> Tuple[List[Tuple[List[int], List[int]]], List[float], Dict]:
    """
    Full meld-aware world constructor with estimator integration.

    Combines:
      1. Per-card trace weights from action_trace module
      2. Meld skeleton enumeration
      3. Quality gating against estimator's predicted DW
      4. Three-tier generation (skeleton / random / high-DW)

    This is the Phase 67 replacement for Phase 66's
    generate_worlds_with_estimator().
    """
    if rng is None:
        rng = random.Random()

    # Get quality prior from estimator
    predicted_mean_opp_dw = None

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
        except Exception:
            pass

    worlds, weights, diag = construct_meld_aware_hands(
        hero_hand=hero_hand,
        discard_pile=discard_pile,
        stock_size=stock_size,
        n_hands=n_hands,
        rng=rng,
        trace=trace,
        known_opponent_pickups=known_opponent_pickups,
        known_opponent_discards=known_opponent_discards,
        predicted_mean_opp_dw=predicted_mean_opp_dw,
    )

    # Add estimator diagnostics
    if predicted_mean_opp_dw is not None:
        diag['estimator_predicted_mean_opp_dw'] = round(predicted_mean_opp_dw, 2)

    return worlds, weights, diag
