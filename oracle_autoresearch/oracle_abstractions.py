"""
Oracle Abstraction Layer — Directive 107.

Shared, explicit information-state abstractions for the multi-lane
Oracle proxy benchmark. Every lane imports feature buckets and state
summaries from here.

Design principles (from the Discovering Multiagent Learning paper):
  - bounded search-space for each decision family
  - explicit, reviewable features (no opaque embeddings)
  - usable by both CFR priors and direct evaluation
  - identical abstraction layer for train-time optimization
    and held-out evaluation

Abstraction groups:
  1. Deadwood bucket — hero-side hand quality
  2. Meld structure  — meld count, arrangement richness
  3. Combination / layoff potential — near-meld cards, extension paths
  4. Upcard utility / danger  — what the face-up card means for us
  5. Opponent memory  — summarised opponent trace signals
  6. Deck phase bucket — where we are in the hand progression
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

# ── 1. Deadwood Buckets ───────────────────────────────────────────────

DW_BOUNDARIES = (0, 2, 5, 7, 9, 15, 25)

def deadwood_bucket(dw: int) -> int:
    """Bucket hero deadwood into a coarse bin. 0 = gin, 7 = very high."""
    for idx, b in enumerate(DW_BOUNDARIES):
        if dw <= b:
            return idx
    return len(DW_BOUNDARIES)


# ── 2. Meld Structure ────────────────────────────────────────────────

def meld_structure_bucket(meld_count: int, dw_card_count: int) -> Tuple[int, int]:
    """Return (meld_count_capped, dw_card_count_capped)."""
    return min(meld_count, 4), min(dw_card_count, 5)


# ── 3. Combination / Layoff Potential ─────────────────────────────────

def combination_potential_bucket(
    hero_hand: List[int],
    hero_melds: List[List[int]],
    hero_dw_cards: List[int],
) -> int:
    """
    Estimate how many 1-draw meld extensions exist.

    Counts how many unmelded cards are one card away from forming
    a new meld (pair needing a third, or a two-card run needing either end).
    Returns a bucketed value 0-4.
    """
    try:
        from gin_rummy.card import rank, suit
    except ImportError:
        return 0

    if not hero_dw_cards or len(hero_dw_cards) < 2:
        return 0

    near_meld_count = 0
    dw_set = set(hero_dw_cards)

    # Check pairs among deadwood cards
    ranks_seen = {}
    for c in hero_dw_cards:
        r = rank(c)
        ranks_seen[r] = ranks_seen.get(r, 0) + 1

    for r, count in ranks_seen.items():
        if count >= 2:
            near_meld_count += 1  # Pair exists, needs one more for set

    # Check partial runs among deadwood cards
    suits_by_rank = {}
    for c in hero_dw_cards:
        r, s = rank(c), suit(c)
        key = s
        if key not in suits_by_rank:
            suits_by_rank[key] = []
        suits_by_rank[key].append(r)

    for s, rank_list in suits_by_rank.items():
        sorted_ranks = sorted(set(rank_list))
        for i in range(len(sorted_ranks) - 1):
            if sorted_ranks[i + 1] - sorted_ranks[i] <= 2:
                near_meld_count += 1

    return min(near_meld_count, 4)


# ── 4. Upcard Utility ─────────────────────────────────────────────────

def upcard_utility_bucket(
    upcard: Optional[int],
    hero_hand: List[int],
    hero_dw_cards: List[int],
) -> int:
    """
    How useful is the current upcard to us?
    0 = no upcard / useless
    1 = marginally useful (same rank exists in hand)
    2 = useful (adjacent suit card exists)
    3 = very useful (completes a meld)
    """
    if upcard is None:
        return 0

    try:
        from gin_rummy.card import rank, suit
        from gin_rummy.meld import compute_deadwood
    except ImportError:
        return 0

    r, s = rank(upcard), suit(upcard)
    hero_set = set(hero_hand)

    if upcard in hero_set:
        return 0  # already have it (shouldn't happen, but defensive)

    # Check if taking this card would reduce deadwood
    test_hand = list(hero_hand) + [upcard]
    # Find best discard after adding the upcard
    base_dw = compute_deadwood(hero_hand)
    best_new_dw = base_dw
    for i, c in enumerate(test_hand):
        if c == upcard:
            continue  # can't discard the card we just took
        remaining = test_hand[:i] + test_hand[i+1:]
        dw = compute_deadwood(remaining)
        if dw < best_new_dw:
            best_new_dw = dw

    dw_swing = base_dw - best_new_dw

    if dw_swing >= 5:
        return 3  # completes a meld or equivalent
    elif dw_swing >= 2:
        return 2  # useful improvement
    elif dw_swing >= 0:
        return 1  # marginal or neutral
    else:
        return 0  # harmful


# ── 5. Opponent Memory Abstraction ────────────────────────────────────

PICKUP_BOUNDARIES = (0, 1, 2, 4)
DISCARD_BOUNDARIES = (0, 2, 5, 8)
DECLINE_BOUNDARIES = (0, 2, 5, 8)

def opponent_memory_bucket(
    n_pickups: int,
    n_discards: int,
    n_declines: int,
) -> Tuple[int, int, int]:
    """
    Summarise opponent trace information into coarse buckets.
    Returns (pickup_bucket, discard_bucket, decline_bucket).
    """
    def _bucket(val, bounds):
        for i, b in enumerate(bounds):
            if val <= b:
                return i
        return len(bounds)

    return (
        _bucket(n_pickups, PICKUP_BOUNDARIES),
        _bucket(n_discards, DISCARD_BOUNDARIES),
        _bucket(n_declines, DECLINE_BOUNDARIES),
    )


def opponent_danger_score(
    known_pickups: List[int],
    known_discards: List[int],
) -> int:
    """
    Net retained pickups (pickups that opponent kept, never discarded back).
    Higher = more organised opponent hand. Bucketed 0-4.
    """
    retained = len(set(known_pickups) - set(known_discards))
    return min(retained, 4)


# ── 6. Deck Phase Bucket ─────────────────────────────────────────────

STOCK_BOUNDARIES = (2, 4, 6, 10, 16, 22)

def deck_phase_bucket(stock_size: int) -> int:
    """
    Where are we in the hand?
    0=endgame (<=2), 1=late, 2=mid-late, 3=mid, 4=mid-early, 5=early, 6=opening.
    """
    for i, b in enumerate(STOCK_BOUNDARIES):
        if stock_size <= b:
            return i
    return len(STOCK_BOUNDARIES)


TURN_BOUNDARIES = (4, 8, 12, 16, 22)

def turn_phase_bucket(turn_number: int) -> int:
    for i, b in enumerate(TURN_BOUNDARIES):
        if turn_number <= b:
            return i
    return len(TURN_BOUNDARIES)


# ── Unified Oracle Info-State ─────────────────────────────────────────

@dataclass
class OracleInfoState:
    """
    Complete abstracted information state for a Gin Rummy decision point.
    This is the shared representation used by all benchmark lanes.
    """
    dw_bucket: int
    meld_count: int
    dw_card_count: int
    combination_potential: int
    upcard_utility: int
    opp_pickup_bucket: int
    opp_discard_bucket: int
    opp_decline_bucket: int
    opp_danger: int
    deck_phase: int
    turn_phase: int
    score_diff_bucket: int  # bucketed (my_score - opp_score)
    gin_live: int  # 1 if gin is possible (dw <= 1, single dw card)

    def as_tuple(self) -> tuple:
        """For use as dict key in CFR-style algorithms."""
        return (
            self.dw_bucket,
            self.meld_count,
            self.dw_card_count,
            self.combination_potential,
            self.upcard_utility,
            self.opp_pickup_bucket,
            self.opp_discard_bucket,
            self.opp_decline_bucket,
            self.opp_danger,
            self.deck_phase,
            self.turn_phase,
            self.score_diff_bucket,
            self.gin_live,
        )


SCORE_DIFF_BOUNDARIES = (-30, -10, 10, 30)

def build_oracle_info_state(spot) -> OracleInfoState:
    """
    Construct an OracleInfoState from a SpotRecord.

    This is the single entry point for converting a raw spot into
    the shared abstraction used by all benchmark lanes.
    """
    dw_b = deadwood_bucket(spot.hero_deadwood)
    mc, dwc = meld_structure_bucket(spot.hero_meld_count, spot.hero_dw_card_count)
    combo = combination_potential_bucket(
        spot.hero_hand, spot.hero_melds, spot.hero_dw_cards,
    )
    upcard = spot.discard_pile[-1] if spot.discard_pile else None
    upc_util = upcard_utility_bucket(upcard, spot.hero_hand, spot.hero_dw_cards)

    opp_pb, opp_db, opp_dcb = opponent_memory_bucket(
        len(spot.known_opponent_pickups),
        len(spot.known_opponent_discards),
        len(spot.upcard_declines),
    )
    opp_dng = opponent_danger_score(
        spot.known_opponent_pickups,
        spot.known_opponent_discards,
    )
    dp = deck_phase_bucket(spot.stock_size)
    tp = turn_phase_bucket(spot.turn_number)

    score_diff = spot.my_score - spot.opp_score
    sd_bucket = 0
    for i, b in enumerate(SCORE_DIFF_BOUNDARIES):
        if score_diff <= b:
            sd_bucket = i
            break
    else:
        sd_bucket = len(SCORE_DIFF_BOUNDARIES)

    gin_live = 1 if (spot.hero_deadwood <= 1 and spot.hero_dw_card_count == 1) else 0

    return OracleInfoState(
        dw_bucket=dw_b,
        meld_count=mc,
        dw_card_count=dwc,
        combination_potential=combo,
        upcard_utility=upc_util,
        opp_pickup_bucket=opp_pb,
        opp_discard_bucket=opp_db,
        opp_decline_bucket=opp_dcb,
        opp_danger=opp_dng,
        deck_phase=dp,
        turn_phase=tp,
        score_diff_bucket=sd_bucket,
        gin_live=gin_live,
    )
