"""
Bayesian-inspired opponent hand modeling for DeepKnock.

Instead of Heisenbot's integer -5 to 5 system, this tracks:
  - Definite card states (in my hand, in discard, known-opponent)
  - Probability-weighted estimates for unknown cards
  - Weighted sampling of plausible opponent hands for Monte Carlo
"""

import random
from gin_rummy.card import rank, suit, make_card, NUM_CARDS


# Card states
IN_MY_HAND = 0
IN_DISCARD = 1
KNOWN_OPPONENT = 2
UNKNOWN = 3


class OpponentModel:
    """Tracks opponent's likely hand composition."""

    def __init__(self):
        self.card_state = [UNKNOWN] * NUM_CARDS
        self.weight = [1.0] * NUM_CARDS  # Relative probability weight for UNKNOWN cards
        self.opponent_hand_size = 10
        self._known_opponent = set()
        self._my_hand = set()

    def reset(self, my_hand):
        """Reset at start of a new hand."""
        self.card_state = [UNKNOWN] * NUM_CARDS
        self.weight = [1.0] * NUM_CARDS
        self.opponent_hand_size = 10
        self._known_opponent = set()
        self._my_hand = set(my_hand)

        for c in my_hand:
            self.card_state[c] = IN_MY_HAND
            self.weight[c] = 0.0

    def set_discard(self, card):
        """Mark a card as being in the discard pile."""
        self.card_state[card] = IN_DISCARD
        self.weight[card] = 0.0
        self._known_opponent.discard(card)

    def set_initial_discard(self, card):
        """Mark the initial face-up card."""
        self.card_state[card] = IN_DISCARD
        self.weight[card] = 0.0

    def update_my_hand(self, hand):
        """Update with current hand state."""
        # Clear old hand cards
        for c in self._my_hand:
            if self.card_state[c] == IN_MY_HAND:
                self.card_state[c] = UNKNOWN
                self.weight[c] = 1.0
        self._my_hand = set(hand)
        for c in hand:
            self.card_state[c] = IN_MY_HAND
            self.weight[c] = 0.0

    def opponent_drew_discard(self, card):
        """Opponent picked up a known card from the discard pile."""
        self.card_state[card] = KNOWN_OPPONENT
        self.weight[card] = 0.0
        self._known_opponent.add(card)

        # ── Directive 117: Stronger Pickup Semantic Signal ─────────────
        # Pickups are active choices; neighbor boost should be stronger
        # than generic trace events.
        r, s = rank(card), suit(card)
        
        # Boost same-rank likelihood (sets)
        # Multiple pickups of same rank should stack (handled by +=)
        self._boost_neighbors(r, s, same_rank_boost=1.2, adj_suit_boost=1.0, far_suit_boost=0.5)
        
        # Additional logic for multiple pickups: if we already have a pickup 
        # of the same rank, boost the remaining suits even more.
        same_rank_count = sum(1 for c in self._known_opponent if rank(c) == r)
        if same_rank_count >= 2:
            for su in range(4):
                c = make_card(r, su)
                if self.card_state[c] == UNKNOWN:
                    self.weight[c] = min(10.0, self.weight[c] + 1.0)

    def opponent_drew_stock(self):
        """Opponent drew from stock (unknown card)."""
        pass  # We learn nothing specific

    def opponent_discarded(self, card):
        """Opponent discarded a card."""
        self.card_state[card] = IN_DISCARD
        self.weight[card] = 0.0
        self._known_opponent.discard(card)
        self.opponent_hand_size -= 0  # They drew then discarded, net 0

        # Reduce likelihood of neighboring cards
        r, s = rank(card), suit(card)
        self._reduce_neighbors(r, s, same_rank_reduce=0.4, adj_suit_reduce=0.4, far_suit_reduce=0.2)

    def my_discard(self, card):
        """I discarded a card."""
        self.card_state[card] = IN_DISCARD
        self.weight[card] = 0.0
        self._my_hand.discard(card)

    def my_draw(self, card, from_discard):
        """I drew a card."""
        self.card_state[card] = IN_MY_HAND
        self.weight[card] = 0.0
        self._my_hand.add(card)

    def _boost_neighbors(self, r, s, same_rank_boost, adj_suit_boost, far_suit_boost):
        """Increase weight of cards near a picked-up card."""
        # Same rank, different suits
        for su in range(4):
            if su != s:
                c = make_card(r, su)
                if self.card_state[c] == UNKNOWN:
                    self.weight[c] = min(5.0, self.weight[c] + same_rank_boost)

        # Same suit, adjacent rank
        for dr in [-1, 1]:
            nr = r + dr
            if 0 <= nr <= 12:
                c = make_card(nr, s)
                if self.card_state[c] == UNKNOWN:
                    self.weight[c] = min(5.0, self.weight[c] + adj_suit_boost)

        # Same suit, distance 2
        for dr in [-2, 2]:
            nr = r + dr
            if 0 <= nr <= 12:
                c = make_card(nr, s)
                if self.card_state[c] == UNKNOWN:
                    self.weight[c] = min(5.0, self.weight[c] + far_suit_boost)

    def _reduce_neighbors(self, r, s, same_rank_reduce, adj_suit_reduce, far_suit_reduce):
        """Decrease weight of cards near a discarded card."""
        for su in range(4):
            if su != s:
                c = make_card(r, su)
                if self.card_state[c] == UNKNOWN:
                    self.weight[c] = max(0.1, self.weight[c] - same_rank_reduce)

        for dr in [-1, 1]:
            nr = r + dr
            if 0 <= nr <= 12:
                c = make_card(nr, s)
                if self.card_state[c] == UNKNOWN:
                    self.weight[c] = max(0.1, self.weight[c] - adj_suit_reduce)

        for dr in [-2, 2]:
            nr = r + dr
            if 0 <= nr <= 12:
                c = make_card(nr, s)
                if self.card_state[c] == UNKNOWN:
                    self.weight[c] = max(0.1, self.weight[c] - far_suit_reduce)

    def get_unknown_cards(self):
        """Get all cards with UNKNOWN state (could be in opponent hand or stock)."""
        return [c for c in range(NUM_CARDS) if self.card_state[c] == UNKNOWN]

    def get_known_opponent_cards(self):
        """Get all cards known to be in opponent's hand."""
        return list(self._known_opponent)

    def sample_opponent_hand(self, n_total=10):
        """
        Sample a plausible opponent hand using weighted probabilities.
        Starts with known opponent cards, fills rest from UNKNOWN pool.
        """
        known = list(self._known_opponent)
        needed = n_total - len(known)

        if needed <= 0:
            return known[:n_total]

        unknown = self.get_unknown_cards()
        if len(unknown) <= needed:
            return known + unknown

        # Weighted sampling without replacement
        weights = [self.weight[c] for c in unknown]
        total_w = sum(weights)
        if total_w <= 0:
            sampled = random.sample(unknown, needed)
        else:
            sampled = self._weighted_sample(unknown, weights, needed)

        return known + sampled

    def sample_unseen_cards(self):
        """Get all cards that could be drawn from the stock."""
        return [c for c in range(NUM_CARDS)
                if self.card_state[c] == UNKNOWN and c not in self._known_opponent]

    @staticmethod
    def _weighted_sample(population, weights, k):
        """Weighted random sample without replacement."""
        pool = list(zip(population, weights))
        result = []
        for _ in range(k):
            if not pool:
                break
            total = sum(w for _, w in pool)
            if total <= 0:
                idx = random.randrange(len(pool))
            else:
                r = random.random() * total
                cumulative = 0
                idx = 0
                for i, (_, w) in enumerate(pool):
                    cumulative += w
                    if cumulative >= r:
                        idx = i
                        break
            result.append(pool[idx][0])
            pool.pop(idx)
        return result

    def estimate_opponent_deadwood_distribution(self, n_samples=20):
        """
        Estimate distribution of opponent's deadwood via sampling.
        Returns list of (sampled_hand, deadwood) tuples.
        """
        from gin_rummy.meld import compute_deadwood
        results = []
        for _ in range(n_samples):
            opp_hand = self.sample_opponent_hand()
            dw = compute_deadwood(opp_hand)
            results.append((opp_hand, dw))
        return results
