"""
Phase 67 Task A: Per-Card Public Action Trace Pipeline.

Phase 66 exposed a hard data-pipeline gap: the dataset did not preserve
enough per-card public action history for the card-level belief model to
activate. This module builds the missing plumbing.

For each card in the unknown pool, we compute a per-card "trace signal"
indicating how likely the opponent is to hold it, based on:

  1. OPPONENT DISCARD-PILE PICKUPS — exact card known; if not re-discarded,
     it is KNOWN in opponent's hand.
  2. VISIBLE DISCARDS — cards the opponent discarded are NOT in their hand.
     Their neighbours are LESS likely in opponent's hand (opponent signalled
     they don't need them).
  3. UPCARD DECLINES — if the opponent passed on a discard-pile card, they
     likely don't need it or its close neighbours.
  4. PICKUP ADJACENCY — when the opponent picks up a card from discard,
     neighbouring cards (same rank / adjacent suit-run) become MORE likely
     in their hand (they are building melds).
  5. DISCARD ADJACENCY — when the opponent discards a card, neighbouring
     cards become LESS likely (they signalled they don't need that area).

The output is a per-card weight dict (card_id → float) where:
  - weight > 1.0 means "more likely in opponent hand than baseline"
  - weight < 1.0 means "less likely in opponent hand than baseline"
  - weight = 0.0 means "impossible" (card is visible or in hero's hand)

This is the first truly per-card trace signal in the solver pipeline.
"""

from typing import List, Dict, Optional, Set, Tuple
from gin_rummy.card import NUM_CARDS, rank, suit, make_card


# ── Trace Event Types ─────────────────────────────────────────────────

class ActionTrace:
    """
    Record of all per-card public action events visible to hero.

    This is the fundamental data structure Phase 66 was missing.
    Instead of just counts (n_opponent_pickups, n_opponent_discards),
    we now track WHICH SPECIFIC CARDS were involved and in what ORDER.
    """

    def __init__(self):
        self.opponent_pickups: List[int] = []     # cards opponent took from discard
        self.opponent_discards: List[int] = []    # cards opponent discarded
        self.upcard_declines: List[int] = []      # cards opponent passed on
        self.hero_discards: List[int] = []        # cards hero discarded
        self.turn_events: List[Tuple[str, int, int]] = []  # (event_type, card_id, turn_number)

    def record_opponent_pickup(self, card: int, turn: int = 0):
        """Opponent picked up a card from discard pile."""
        self.opponent_pickups.append(card)
        self.turn_events.append(('opp_pickup', card, turn))

    def record_opponent_discard(self, card: int, turn: int = 0):
        """Opponent discarded a card."""
        self.opponent_discards.append(card)
        self.turn_events.append(('opp_discard', card, turn))

    def record_upcard_decline(self, card: int, turn: int = 0):
        """Opponent declined the discard pile top card."""
        self.upcard_declines.append(card)
        self.turn_events.append(('opp_decline', card, turn))

    def record_hero_discard(self, card: int, turn: int = 0):
        """Hero discarded a card."""
        self.hero_discards.append(card)
        self.turn_events.append(('hero_discard', card, turn))

    @property
    def known_opponent_cards(self) -> Set[int]:
        """Cards known to be in opponent's hand (picked and not re-discarded)."""
        picked = set(self.opponent_pickups)
        discarded = set(self.opponent_discards)
        return picked - discarded

    @property
    def has_signal(self) -> bool:
        """Whether we have any actionable trace signal at all."""
        return bool(self.opponent_pickups or self.opponent_discards or
                    self.upcard_declines)


# ── Per-Card Trace Weight Builder ─────────────────────────────────────

# Weight adjustment constants
PICKUP_ADJACENCY_BOOST_SAME_RANK = 0.8   # same rank, different suit
PICKUP_ADJACENCY_BOOST_ADJ_RUN  = 0.8   # adjacent rank, same suit
PICKUP_ADJACENCY_BOOST_NEAR_RUN = 0.4   # 2 away in rank, same suit

DISCARD_ADJACENCY_REDUCE_SAME_RANK = 0.5  # same rank, different suit
DISCARD_ADJACENCY_REDUCE_ADJ_RUN  = 0.5  # adjacent rank, same suit
DISCARD_ADJACENCY_REDUCE_NEAR_RUN = 0.25 # 2 away in rank, same suit

DECLINE_REDUCE_FACTOR = 0.3              # opponent didn't want this card
DECLINE_ADJACENCY_REDUCE = 0.15          # neighbours of declined card

MIN_WEIGHT = 0.05
MAX_WEIGHT = 6.0


def build_trace_weights(
    hero_hand: List[int],
    discard_pile: List[int],
    trace: Optional[ActionTrace] = None,
    # Fallback: if no ActionTrace, use raw lists
    known_opponent_pickups: Optional[List[int]] = None,
    known_opponent_discards: Optional[List[int]] = None,
) -> Dict[int, float]:
    """
    Build per-card weights for the unknown card pool using the full
    public action trace.

    This is the upgraded replacement for Phase 66's
    build_card_weights_from_public_history(), which was a thin wrapper
    around OpponentModel weights.

    Key improvements:
      1. Per-card trace events (pickups, discards, declines) with
         ORDER preserved
      2. Adjacency boost/reduce for meld-neighbour cards
      3. Decline signal (opponent passed on a card = doesn't want it)
      4. All weights bounded to [MIN_WEIGHT, MAX_WEIGHT]

    Returns:
        Dict[int, float] mapping card_id → weight for all unknown cards.
        Known-opponent cards get weight 0 (handled separately as forced).
        Hero-hand and visible cards get weight 0 (not in pool).
    """
    hero_set = set(hero_hand)
    visible = set(discard_pile)

    # Build the trace from raw lists if no ActionTrace provided
    if trace is None:
        trace = ActionTrace()
        if known_opponent_pickups:
            for c in known_opponent_pickups:
                trace.record_opponent_pickup(c)
        if known_opponent_discards:
            for c in known_opponent_discards:
                trace.record_opponent_discard(c)

    known_opp = trace.known_opponent_cards
    known_opp -= hero_set   # sanity
    known_opp -= visible    # sanity

    # Initialize weights for all unknown cards
    weights: Dict[int, float] = {}
    for c in range(NUM_CARDS):
        if c in hero_set or c in visible:
            continue
        if c in known_opp:
            # Known opponent card — will be forced into hand, not sampled
            weights[c] = 0.0
            continue
        weights[c] = 1.0

    # ── Apply pickup adjacency boosts ──
    for pickup_card in trace.opponent_pickups:
        if pickup_card in set(trace.opponent_discards):
            continue  # card was re-discarded, weak signal
        r, s = rank(pickup_card), suit(pickup_card)
        _boost_neighbours(weights, r, s,
                          PICKUP_ADJACENCY_BOOST_SAME_RANK,
                          PICKUP_ADJACENCY_BOOST_ADJ_RUN,
                          PICKUP_ADJACENCY_BOOST_NEAR_RUN)

    # ── Apply discard adjacency reductions ──
    for discard_card in trace.opponent_discards:
        r, s = rank(discard_card), suit(discard_card)
        _reduce_neighbours(weights, r, s,
                           DISCARD_ADJACENCY_REDUCE_SAME_RANK,
                           DISCARD_ADJACENCY_REDUCE_ADJ_RUN,
                           DISCARD_ADJACENCY_REDUCE_NEAR_RUN)

    # ── Apply decline reductions ──
    for decline_card in trace.upcard_declines:
        if decline_card in weights:
            weights[decline_card] = max(MIN_WEIGHT,
                                        weights[decline_card] - DECLINE_REDUCE_FACTOR)
        r, s = rank(decline_card), suit(decline_card)
        _reduce_neighbours(weights, r, s,
                           DECLINE_ADJACENCY_REDUCE,
                           DECLINE_ADJACENCY_REDUCE,
                           0.0)

    # ── Clamp all weights ──
    for c in weights:
        if weights[c] > 0:
            weights[c] = max(MIN_WEIGHT, min(MAX_WEIGHT, weights[c]))

    return weights


def _boost_neighbours(weights: Dict[int, float], r: int, s: int,
                      same_rank_boost: float, adj_run_boost: float,
                      near_run_boost: float):
    """Increase weight of cards neighbouring a pickup."""
    # Same rank, different suits (set neighbour)
    for su in range(4):
        if su != s:
            c = make_card(r, su)
            if c in weights and weights[c] > 0:
                weights[c] = min(MAX_WEIGHT, weights[c] + same_rank_boost)

    # Same suit, adjacent rank (run neighbour)
    for dr in [-1, 1]:
        nr = r + dr
        if 0 <= nr <= 12:
            c = make_card(nr, s)
            if c in weights and weights[c] > 0:
                weights[c] = min(MAX_WEIGHT, weights[c] + adj_run_boost)

    # Same suit, 2 away (near-run neighbour)
    for dr in [-2, 2]:
        nr = r + dr
        if 0 <= nr <= 12:
            c = make_card(nr, s)
            if c in weights and weights[c] > 0:
                weights[c] = min(MAX_WEIGHT, weights[c] + near_run_boost)


def _reduce_neighbours(weights: Dict[int, float], r: int, s: int,
                       same_rank_reduce: float, adj_run_reduce: float,
                       near_run_reduce: float):
    """Decrease weight of cards neighbouring a discard."""
    for su in range(4):
        if su != s:
            c = make_card(r, su)
            if c in weights and weights[c] > 0:
                weights[c] = max(MIN_WEIGHT, weights[c] - same_rank_reduce)

    for dr in [-1, 1]:
        nr = r + dr
        if 0 <= nr <= 12:
            c = make_card(nr, s)
            if c in weights and weights[c] > 0:
                weights[c] = max(MIN_WEIGHT, weights[c] - adj_run_reduce)

    for dr in [-2, 2]:
        nr = r + dr
        if 0 <= nr <= 12:
            c = make_card(nr, s)
            if c in weights and weights[c] > 0:
                weights[c] = max(MIN_WEIGHT, weights[c] - near_run_reduce)


# ── Convenience: Build trace from existing spot data ──────────────────

def build_trace_from_spot(spot) -> ActionTrace:
    """
    Build an ActionTrace from a LabelledKnockSpot.

    Phase 65 dataset records n_opponent_pickups and n_opponent_discards
    as counts only, not specific cards. We can still extract the discard
    pile sequence for decline/discard signals.

    This is a best-effort reconstruction from available data.
    """
    trace = ActionTrace()

    # The discard pile IS the visible discard history
    # The last card in the pile was the most recent discard
    dp = getattr(spot, 'discard_pile', [])

    # If we have specific pickup/discard lists, use them
    opp_pickups = getattr(spot, 'known_opponent_pickups', None)
    opp_discards_list = getattr(spot, 'known_opponent_discards', None)

    if opp_pickups:
        for c in opp_pickups:
            trace.record_opponent_pickup(c)

    if opp_discards_list:
        for c in opp_discards_list:
            trace.record_opponent_discard(c)

    return trace


def trace_weight_diagnostics(weights: Dict[int, float]) -> Dict:
    """Diagnostic summary of trace weights."""
    if not weights:
        return {'n_cards': 0}

    active_w = [w for w in weights.values() if w > 0]
    if not active_w:
        return {'n_cards': len(weights), 'n_active': 0}

    return {
        'n_cards': len(weights),
        'n_active': len(active_w),
        'min_weight': round(min(active_w), 3),
        'max_weight': round(max(active_w), 3),
        'mean_weight': round(sum(active_w) / len(active_w), 3),
        'spread': round(max(active_w) - min(active_w), 3),
        'n_boosted': sum(1 for w in active_w if w > 1.05),
        'n_reduced': sum(1 for w in active_w if w < 0.95),
    }
