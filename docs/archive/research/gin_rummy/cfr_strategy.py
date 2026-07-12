"""
CFR Strategy: Information Set Abstraction & Strategy Storage for Gin Rummy.

Abstracts the complex Gin Rummy state into tractable information sets
for discard decisions, and stores/loads the learned regret tables
and average strategies.

Information Set Features (discard-only):
  - deadwood_bucket:       0-5 (DW//10, capped at 5)
  - meld_count:            0-4 (number of complete melds)
  - partial_meld_count:    0-3 (doubles/near-melds, capped)
  - isolated_high_count:   0-4 (non-melded cards with DW >= 8, capped)
  - turn_bucket:           0-3 (turn//4, capped at 3)
  - score_diff_bucket:     0-4 (discretized score difference)
  - deck_remaining_bucket: 0-3 (stock cards remaining, bucketed)

Action Abstraction (discard):
  We use Apex's existing two-phase pipeline to generate the top-K (K=3)
  discard candidates ranked by heuristic score. Actions are indexed 0..K-1,
  representing "choose the Nth-best candidate from Apex's ranking."
  This keeps the action space at exactly 3 regardless of hand.

Fallback:
  If the current information set has not been seen during training,
  fall back to action 0 (Apex's top choice), which is equivalent
  to pure Apex behavior.
"""

import json
import os
from collections import defaultdict

from gin_rummy.card import rank, suit, deadwood_value, NUM_CARDS
from gin_rummy.meld import best_meld_arrangement, find_all_melds


NUM_ACTIONS = 3  # Top-K discard candidates from Apex pipeline


def _count_partial_melds(hand, melded):
    """Count 2-card partial melds (pairs/adjacents) not already in full melds."""
    hand_set = set(hand)
    partials = 0

    # Pairs of same rank (partial sets)
    by_rank = defaultdict(list)
    for c in hand:
        if c not in melded:
            by_rank[rank(c)].append(c)
    for r, cs in by_rank.items():
        if len(cs) >= 2:
            partials += 1

    # Adjacent same-suit (partial runs)
    by_suit = defaultdict(list)
    for c in hand:
        if c not in melded:
            by_suit[suit(c)].append(rank(c))
    for s, ranks in by_suit.items():
        ranks_sorted = sorted(set(ranks))
        for i in range(len(ranks_sorted) - 1):
            if ranks_sorted[i + 1] - ranks_sorted[i] <= 2:  # adjacent or gap-1
                partials += 1

    return min(partials, 3)


def _count_isolated_high(hand, melded):
    """Count non-melded cards with deadwood value >= 8."""
    count = 0
    for c in hand:
        if c not in melded and deadwood_value(c) >= 8:
            count += 1
    return min(count, 4)


def _score_diff_bucket(my_score, opp_score):
    """Discretize score difference into 5 buckets."""
    diff = my_score - opp_score
    if diff <= -30:
        return 0  # far behind
    elif diff <= -10:
        return 1  # behind
    elif diff <= 10:
        return 2  # even
    elif diff <= 30:
        return 3  # ahead
    else:
        return 4  # far ahead


def _deck_remaining_bucket(deck_remaining):
    """Discretize deck remaining into 4 buckets."""
    if deck_remaining <= 8:
        return 0  # very low
    elif deck_remaining <= 16:
        return 1  # low
    elif deck_remaining <= 24:
        return 2  # medium
    else:
        return 3  # high


def compute_info_set(hand, game_state):
    """
    Compute the information set key for a discard decision.

    Args:
        hand: 11-card hand (after draw, before discard)
        game_state: dict with turn_number, my_score, opp_score, deck_remaining

    Returns:
        tuple: hashable information set key
    """
    melds, dw_cards, dw = best_meld_arrangement(hand)
    melded = set()
    for m in melds:
        for c in m:
            melded.add(c)

    dw_bucket = min(dw // 10, 5)
    meld_count = min(len(melds), 4)
    partial_count = _count_partial_melds(hand, melded)
    iso_high = _count_isolated_high(hand, melded)
    turn_bucket = min(game_state.get('turn_number', 0) // 4, 3)
    score_bucket = _score_diff_bucket(
        game_state.get('my_score', 0),
        game_state.get('opp_score', 0)
    )
    deck_bucket = _deck_remaining_bucket(game_state.get('deck_remaining', 30))

    return (dw_bucket, meld_count, partial_count, iso_high,
            turn_bucket, score_bucket, deck_bucket)


class CFRStrategy:
    """
    Stores and manages CFR regret sums and average strategy.

    Uses external sampling MCCFR regret matching.
    """

    def __init__(self):
        # regret_sum[info_set] = [float] * NUM_ACTIONS
        self.regret_sum = defaultdict(lambda: [0.0] * NUM_ACTIONS)
        # strategy_sum[info_set] = [float] * NUM_ACTIONS
        self.strategy_sum = defaultdict(lambda: [0.0] * NUM_ACTIONS)
        self.iterations = 0

    def get_strategy(self, info_set):
        """
        Compute current strategy via regret matching.

        Returns:
            list of floats: probability distribution over actions
        """
        regrets = self.regret_sum[info_set]
        positive = [max(0.0, r) for r in regrets]
        total = sum(positive)

        if total > 0:
            return [p / total for p in positive]
        else:
            # Uniform when no positive regret
            return [1.0 / NUM_ACTIONS] * NUM_ACTIONS

    def get_average_strategy(self, info_set):
        """
        Compute the average strategy (converged Nash approximation).

        Returns:
            list of floats: probability distribution over actions
        """
        sums = self.strategy_sum[info_set]
        total = sum(sums)

        if total > 0:
            return [s / total for s in sums]
        else:
            return [1.0 / NUM_ACTIONS] * NUM_ACTIONS

    def update_regret(self, info_set, action, regret):
        """Add regret for a specific action at this info set."""
        self.regret_sum[info_set][action] += regret

    def accumulate_strategy(self, info_set, strategy, weight=1.0):
        """Accumulate the current strategy for averaging."""
        for a in range(NUM_ACTIONS):
            self.strategy_sum[info_set][a] += strategy[a] * weight

    def num_info_sets(self):
        """Number of unique information sets seen."""
        return len(self.regret_sum)

    def save(self, filepath):
        """Save strategy to JSON file."""
        data = {
            'iterations': self.iterations,
            'num_info_sets': self.num_info_sets(),
            'regret_sum': {str(k): v for k, v in self.regret_sum.items()},
            'strategy_sum': {str(k): v for k, v in self.strategy_sum.items()},
        }
        os.makedirs(os.path.dirname(filepath) if os.path.dirname(filepath) else '.', exist_ok=True)
        with open(filepath, 'w') as f:
            json.dump(data, f)

    def load(self, filepath):
        """Load strategy from JSON file."""
        with open(filepath, 'r') as f:
            data = json.load(f)

        self.iterations = data.get('iterations', 0)
        self.regret_sum = defaultdict(lambda: [0.0] * NUM_ACTIONS)
        self.strategy_sum = defaultdict(lambda: [0.0] * NUM_ACTIONS)

        for k_str, v in data.get('regret_sum', {}).items():
            key = tuple(eval(k_str))  # Convert string tuple back
            self.regret_sum[key] = v

        for k_str, v in data.get('strategy_sum', {}).items():
            key = tuple(eval(k_str))
            self.strategy_sum[key] = v

    def has_coverage(self, info_set):
        """Check if this info set has meaningful training coverage."""
        sums = self.strategy_sum.get(info_set)
        if sums is None:
            return False
        return sum(sums) > 0
