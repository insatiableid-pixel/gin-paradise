"""
Phase 68 Tasks B+C: Trace-Active Meld Constructor.

Upgrades the Phase 67 meld_constructor with two critical changes:

  1. TRACE ACTIVATION (Task B): Per-card trace weights from real public
     action events now ACTUALLY influence skeleton scoring, skeleton
     selection ranking, and completion sampling. When trace data shows
     the opponent picked up a card, neighbours of that card are boosted
     in skeleton scoring. When trace data shows the opponent discarded
     or declined a card, those regions are penalized.

  2. LOW-DW GAP CLOSING (Task C): Phase 67 produced 42.3% low-DW worlds
     vs 86.7% reality. This constructor adds:
     - A new Tier 0: "gin-chasing / low-DW" tier that builds hands
       around the strongest possible meld structures
     - Biased skeleton selection toward higher meld coverage
     - Smarter completion filling: prefer low-DW cards when filling
       around skeletons
     - Reduced zero-meld junk tier (15% -> 8%)

Architecture:
  Tier 0 (gin_chasing_fraction):  Strong-meld hands with minimal DW
  Tier 1 (skeleton_fraction):     Standard meld-skeleton hands
  Tier 2 (random_fraction):       Trace-weighted random hands
  Tier 3 (zero_meld_fraction):    High-DW junk hands (reduced)

What is exact:
  - Meld arrangement / deadwood scoring
  - Card visibility constraints
  - Known-opponent forced cards

What is heuristic:
  - Meld skeleton scoring (trace-weight * meld-quality product)
  - Trace-active skeleton ranking
  - Low-DW bias in gin-chasing tier
  - Deadwood quality gating
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


# ── Meld Skeleton with Trace-Active Scoring ──────────────────────────

def enumerate_meld_skeletons_v2(
    pool: List[int],
    trace_weights: Dict[int, float],
    max_skeletons: int = 60,
    min_skeleton_score: float = 0.3,
    trace_active: bool = True,
) -> List[Tuple[List[Tuple[int, ...]], float, Dict]]:
    """
    Enumerate plausible meld skeletons with TRACE-ACTIVE scoring.

    Key upgrade from Phase 67:
      - Skeleton score now combines BOTH trace-weight plausibility AND
        meld structural quality (total cards melded, DW reduction).
      - When trace data has non-uniform weights, skeletons containing
        trace-boosted cards get proportionally higher scores.
      - Skeletons covering more cards (= lower DW) get a quality bonus.

    Returns:
        List of (melds_list, skeleton_score, meta) tuples.
        meta contains decomposed scoring for ablation.
    """
    all_sets = find_sets(pool)
    all_runs = find_runs(pool)
    all_melds = all_sets + all_runs

    if not all_melds:
        return []

    # Score each individual meld
    scored_melds = []
    for m in all_melds:
        # Trace plausibility: sum of trace weights for cards in this meld
        trace_score = sum(trace_weights.get(c, 1.0) for c in m)

        # Meld quality: total DW saved by having these cards melded
        dw_saved = sum(deadwood_value(c) for c in m)

        # Length bonus: longer melds are stronger signals
        length_bonus = 1.0 + 0.15 * max(0, len(m) - 3)

        if trace_active:
            # Combined score: trace plausibility * quality * length
            combined = trace_score * (1.0 + dw_saved * 0.05) * length_bonus
        else:
            # Trace-off ablation: ignore trace weights
            combined = len(m) * (1.0 + dw_saved * 0.05) * length_bonus

        scored_melds.append((m, combined, trace_score))

    scored_melds.sort(key=lambda x: x[1], reverse=True)

    # Build skeletons: combinations of 1-3 non-overlapping melds
    skeletons = []

    # Single-meld skeletons
    for m, score, tscore in scored_melds:
        if score >= min_skeleton_score:
            cards_melded = len(m)
            dw_if_all_melded = sum(deadwood_value(c) for c in m)
            skeletons.append(([m], score, {
                'n_melds': 1, 'cards_melded': cards_melded,
                'trace_score': tscore, 'dw_saved': dw_if_all_melded
            }))

    # Two-meld skeletons
    top_melds = scored_melds[:35]
    for i in range(len(top_melds)):
        m1, s1, t1 = top_melds[i]
        cards1 = set(m1)
        for j in range(i + 1, len(top_melds)):
            m2, s2, t2 = top_melds[j]
            if not cards1.intersection(m2):
                combined_score = s1 + s2
                cards_melded = len(m1) + len(m2)
                # Coverage bonus for multi-meld skeletons
                coverage_bonus = 1.0 + 0.1 * cards_melded
                adjusted = combined_score * coverage_bonus
                if adjusted >= min_skeleton_score:
                    skeletons.append(([m1, m2], adjusted, {
                        'n_melds': 2, 'cards_melded': cards_melded,
                        'trace_score': t1 + t2,
                        'dw_saved': sum(deadwood_value(c) for c in m1) + sum(deadwood_value(c) for c in m2)
                    }))
                    if len(skeletons) > max_skeletons * 3:
                        break
        if len(skeletons) > max_skeletons * 3:
            break

    # Three-meld skeletons
    top_3 = scored_melds[:15]
    for i in range(len(top_3)):
        m1, s1, t1 = top_3[i]
        cards1 = set(m1)
        for j in range(i + 1, len(top_3)):
            m2, s2, t2 = top_3[j]
            if cards1.intersection(m2):
                continue
            cards12 = cards1 | set(m2)
            for k in range(j + 1, len(top_3)):
                m3, s3, t3 = top_3[k]
                if not cards12.intersection(m3):
                    combined_score = s1 + s2 + s3
                    cards_melded = len(m1) + len(m2) + len(m3)
                    coverage_bonus = 1.0 + 0.15 * cards_melded
                    adjusted = combined_score * coverage_bonus
                    if adjusted >= min_skeleton_score:
                        skeletons.append(([m1, m2, m3], adjusted, {
                            'n_melds': 3, 'cards_melded': cards_melded,
                            'trace_score': t1 + t2 + t3,
                            'dw_saved': sum(deadwood_value(c) for c in m1 + m2 + m3)
                        }))

    skeletons.sort(key=lambda x: x[1], reverse=True)
    return skeletons[:max_skeletons]


# ── Trace-Active, Low-DW-Biased Hand Constructor ────────────────────

def construct_trace_active_hands(
    hero_hand: List[int],
    discard_pile: List[int],
    stock_size: int,
    n_hands: int = 200,
    rng: Optional[random.Random] = None,
    # Trace signal
    trace: Optional[ActionTrace] = None,
    known_opponent_pickups: Optional[List[int]] = None,
    known_opponent_discards: Optional[List[int]] = None,
    upcard_declines: Optional[List[int]] = None,
    # Quality prior
    predicted_mean_opp_dw: Optional[float] = None,
    predicted_std_dw: float = 3.5,
    # Control
    max_skeletons: int = 60,
    gin_chasing_fraction: float = 0.20,   # NEW Tier 0: strong-meld / low-DW
    skeleton_fraction: float = 0.50,       # Tier 1: standard skeleton
    random_fraction: float = 0.22,         # Tier 2: trace-weighted random
    zero_meld_fraction: float = 0.08,      # Tier 3: junk (reduced from 15%)
    quality_oversample: int = 3,
    trace_active: bool = True,
) -> Tuple[List[Tuple[List[int], List[int]]], List[float], Dict]:
    """
    Construct plausible opponent hands using trace-active construction.

    Four-tier generation:
      Tier 0 (gin_chasing): Build hands from BEST skeletons with low-DW
        completion bias. These represent opponents who are close to gin.
      Tier 1 (skeleton): Standard meld-skeleton hands (Phase 67 style).
      Tier 2 (random): Trace-weighted random sampling.
      Tier 3 (zero_meld): High-DW junk (reduced fraction).

    Key upgrades from Phase 67:
      1. Trace weights ACTUALLY affect skeleton scoring and ranking
      2. New gin-chasing tier produces more low-DW opponent worlds
      3. Low-DW fill bias: prefer low deadwood-value cards for completion
      4. Tighter quality gating (std=3.5 vs 4.0)
    """
    if rng is None:
        rng = random.Random()

    hero_set = set(hero_hand)
    visible = set(discard_pile)

    unassigned = [c for c in range(NUM_CARDS)
                  if c not in hero_set and c not in visible]

    opp_hand_size = 10
    if len(unassigned) < opp_hand_size:
        return [], [], {'error': 'insufficient_unassigned_cards'}

    # Build trace weights using the ActionTrace with all events
    if trace is None and (known_opponent_pickups or known_opponent_discards or upcard_declines):
        trace = ActionTrace()
        if known_opponent_pickups:
            for c in known_opponent_pickups:
                trace.record_opponent_pickup(c)
        if known_opponent_discards:
            for c in known_opponent_discards:
                trace.record_opponent_discard(c)
        if upcard_declines:
            for c in upcard_declines:
                trace.record_upcard_decline(c)

    trace_weights = build_trace_weights(
        hero_hand, discard_pile,
        trace=trace,
        known_opponent_pickups=known_opponent_pickups,
        known_opponent_discards=known_opponent_discards,
    )

    # Known opponent cards
    known_opp = set()
    if known_opponent_pickups:
        known_opp = set(known_opponent_pickups)
        if known_opponent_discards:
            known_opp -= set(known_opponent_discards)
        known_opp -= hero_set
        known_opp -= visible
    known_opp_in_pool = known_opp & set(unassigned)

    sampling_pool = [c for c in unassigned if c not in known_opp_in_pool]

    # Enumerate meld skeletons with trace-active scoring
    skeletons = enumerate_meld_skeletons_v2(
        sampling_pool, trace_weights,
        max_skeletons=max_skeletons,
        trace_active=trace_active,
    )

    # ── Compute tier sizes ──
    total_candidates = n_hands * quality_oversample
    n_gin_chasing = int(total_candidates * gin_chasing_fraction) if skeletons else 0
    n_skeleton = int(total_candidates * skeleton_fraction) if skeletons else 0
    n_random = int(total_candidates * random_fraction)
    n_zero_meld = total_candidates - n_gin_chasing - n_skeleton - n_random

    if not skeletons:
        n_random = int(total_candidates * (gin_chasing_fraction + skeleton_fraction + random_fraction))
        n_zero_meld = total_candidates - n_random

    # ── Tier 0: Gin-chasing / low-DW hands ──
    candidates = []
    tier_counts = {'gin_chasing': 0, 'skeleton': 0, 'random': 0, 'zero_meld': 0}

    for i in range(n_gin_chasing):
        # Pick from TOP skeletons (strongest meld structures)
        if skeletons:
            # Bias heavily toward skeletons with most cards melded
            skel_melds, skel_score, skel_meta = _pick_skeleton_biased_strong(skeletons, rng)
            hand = _build_hand_low_dw(
                skel_melds, known_opp_in_pool, sampling_pool,
                trace_weights, opp_hand_size, rng
            )
            if hand is not None:
                opp_set = set(hand)
                stock = [c for c in unassigned if c not in opp_set]
                rng.shuffle(stock)
                candidates.append((hand, stock, 'gin_chasing'))
                tier_counts['gin_chasing'] += 1

    # ── Tier 1: Standard skeleton-based hands ──
    for i in range(n_skeleton):
        skel_melds, skel_score, skel_meta = _pick_skeleton_weighted(skeletons, rng)
        hand = _build_hand_from_skeleton_v2(
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
        hand = _build_random_hand_v2(
            known_opp_in_pool, sampling_pool, trace_weights,
            opp_hand_size, rng
        )
        if hand is not None:
            opp_set = set(hand)
            stock = [c for c in unassigned if c not in opp_set]
            rng.shuffle(stock)
            candidates.append((hand, stock, 'random'))
            tier_counts['random'] += 1

    # ── Tier 3: Zero-meld junk ──
    for i in range(n_zero_meld):
        hand = _build_high_dw_hand_v2(
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

    # ── Quality gating ──
    scored = []
    for hand, stock, tier in candidates:
        dw = compute_deadwood(hand)

        # Quality weight
        if predicted_mean_opp_dw is not None:
            z = (dw - predicted_mean_opp_dw) / max(predicted_std_dw, 1.0)
            quality_w = math.exp(-0.5 * z * z)
        else:
            quality_w = 1.0

        # Trace consistency
        trace_score = sum(trace_weights.get(c, 1.0) for c in hand
                          if c not in known_opp_in_pool)
        n_sampled = max(1, len(hand) - len(known_opp_in_pool))
        trace_consistency = trace_score / n_sampled

        # Combined weight
        combined = quality_w * trace_consistency
        combined = max(combined, 0.01)
        scored.append((hand, stock, combined, dw, tier))

    scored.sort(key=lambda x: x[2], reverse=True)
    selected = scored[:n_hands]

    worlds = [(s[0], s[1]) for s in selected]
    raw_weights = [s[2] for s in selected]

    # Normalize weights
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
            median_w = sorted(weights)[len(weights) // 2]
            weights = [min(w, median_w * 15.0) for w in weights]
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
        'trace_active': trace_active,
        'selected_dw_mean': round(sum(dw_values) / len(dw_values), 2) if dw_values else None,
        'selected_dw_min': min(dw_values) if dw_values else None,
        'selected_dw_max': max(dw_values) if dw_values else None,
        'selected_frac_dw_le5': round(
            sum(1 for d in dw_values if d <= 5) / len(dw_values), 4
        ) if dw_values else None,
        'predicted_mean_opp_dw': predicted_mean_opp_dw,
        'constructor_mode': 'trace_active_phase68',
    }

    return worlds, weights, diag


# ── Internal: Hand Construction Helpers ───────────────────────────────

def _pick_skeleton_weighted(
    skeletons: List[Tuple[List[Tuple[int, ...]], float, Dict]],
    rng: random.Random,
) -> Tuple[List[Tuple[int, ...]], float, Dict]:
    """Pick a skeleton weighted by score."""
    total = sum(s for _, s, _ in skeletons)
    if total <= 0:
        idx = rng.randrange(len(skeletons))
        return skeletons[idx]

    r = rng.random() * total
    cumulative = 0.0
    for melds, score, meta in skeletons:
        cumulative += score
        if cumulative >= r:
            return melds, score, meta
    return skeletons[-1]


def _pick_skeleton_biased_strong(
    skeletons: List[Tuple[List[Tuple[int, ...]], float, Dict]],
    rng: random.Random,
) -> Tuple[List[Tuple[int, ...]], float, Dict]:
    """Pick a skeleton biased toward those with most cards melded (low DW)."""
    # Weight by cards_melded^2 * score
    weighted = []
    for melds, score, meta in skeletons:
        cards_melded = meta.get('cards_melded', sum(len(m) for m in melds))
        w = (cards_melded ** 2) * score
        weighted.append((melds, score, meta, w))

    total = sum(w for _, _, _, w in weighted)
    if total <= 0:
        idx = rng.randrange(len(weighted))
        return weighted[idx][:3]

    r = rng.random() * total
    cumulative = 0.0
    for melds, score, meta, w in weighted:
        cumulative += w
        if cumulative >= r:
            return melds, score, meta
    return weighted[-1][:3]


def _build_hand_from_skeleton_v2(
    skeleton_melds: List[Tuple[int, ...]],
    known_forced: Set[int],
    pool: List[int],
    trace_weights: Dict[int, float],
    hand_size: int,
    rng: random.Random,
) -> Optional[List[int]]:
    """Build a full opponent hand around a meld skeleton."""
    hand = list(known_forced)
    used = set(hand)

    for meld in skeleton_melds:
        for c in meld:
            if c not in used:
                hand.append(c)
                used.add(c)

    remaining_needed = hand_size - len(hand)
    if remaining_needed < 0:
        hand = hand[:hand_size]
        return hand
    if remaining_needed == 0:
        return hand

    fill_pool = [c for c in pool if c not in used]
    if len(fill_pool) < remaining_needed:
        return None

    fill_weights = [trace_weights.get(c, 1.0) for c in fill_pool]
    fill_cards = _weighted_sample_no_replace(fill_pool, fill_weights,
                                             remaining_needed, rng)
    hand.extend(fill_cards)
    return hand


def _build_hand_low_dw(
    skeleton_melds: List[Tuple[int, ...]],
    known_forced: Set[int],
    pool: List[int],
    trace_weights: Dict[int, float],
    hand_size: int,
    rng: random.Random,
) -> Optional[List[int]]:
    """Build a low-DW hand: force skeleton + fill with LOW deadwood cards."""
    hand = list(known_forced)
    used = set(hand)

    for meld in skeleton_melds:
        for c in meld:
            if c not in used:
                hand.append(c)
                used.add(c)

    remaining_needed = hand_size - len(hand)
    if remaining_needed < 0:
        hand = hand[:hand_size]
        return hand
    if remaining_needed == 0:
        return hand

    fill_pool = [c for c in pool if c not in used]
    if len(fill_pool) < remaining_needed:
        return None

    # Bias toward LOW deadwood-value cards (aces, 2s, 3s)
    # AND cards with HIGH trace weight (opponent likely to hold)
    fill_weights = []
    for c in fill_pool:
        dw_val = deadwood_value(c)
        trace_w = trace_weights.get(c, 1.0)
        # Low DW value = more likely in a gin-chasing hand
        # High trace weight = more likely opponent has this card
        # Inverse DW weighting: Ace=10, 2=5, ..., K=1
        inverse_dw = max(0.5, 11 - dw_val)
        w = inverse_dw * max(trace_w, 0.1)
        fill_weights.append(max(w, 0.01))

    fill_cards = _weighted_sample_no_replace(fill_pool, fill_weights,
                                             remaining_needed, rng)
    hand.extend(fill_cards)
    return hand


def _build_random_hand_v2(
    known_forced: Set[int],
    pool: List[int],
    trace_weights: Dict[int, float],
    hand_size: int,
    rng: random.Random,
) -> Optional[List[int]]:
    """Build a random hand using trace weights."""
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


def _build_high_dw_hand_v2(
    known_forced: Set[int],
    pool: List[int],
    trace_weights: Dict[int, float],
    hand_size: int,
    rng: random.Random,
) -> Optional[List[int]]:
    """Build a high-DW junk hand."""
    hand = list(known_forced)
    used = set(hand)
    remaining_needed = hand_size - len(hand)

    fill_pool = [c for c in pool if c not in used]
    if len(fill_pool) < remaining_needed:
        return None

    fill_weights = []
    for c in fill_pool:
        dw_val = deadwood_value(c)
        trace_w = trace_weights.get(c, 1.0)
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

def construct_worlds_v6(
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
    upcard_declines: Optional[List[int]] = None,
    trace_active: bool = True,
) -> Tuple[List[Tuple[List[int], List[int]]], List[float], Dict]:
    """
    Full trace-active world constructor with estimator integration.

    Phase 68 replacement for Phase 67's construct_worlds_with_estimator().
    """
    if rng is None:
        rng = random.Random()

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

    worlds, weights, diag = construct_trace_active_hands(
        hero_hand=hero_hand,
        discard_pile=discard_pile,
        stock_size=stock_size,
        n_hands=n_hands,
        rng=rng,
        trace=trace,
        known_opponent_pickups=known_opponent_pickups,
        known_opponent_discards=known_opponent_discards,
        upcard_declines=upcard_declines,
        predicted_mean_opp_dw=predicted_mean_opp_dw,
        trace_active=trace_active,
    )

    if predicted_mean_opp_dw is not None:
        diag['estimator_predicted_mean_opp_dw'] = round(predicted_mean_opp_dw, 2)

    return worlds, weights, diag
