"""
Heisenbot: Faithful reimplementation from the AAAI-21 paper.

Draw Policy: Future Value
  - Take discard if it completes/extends a meld
  - Take discard if it's an Ace or Two (low deadwood)
  - Take discard if it forms a triangle (first 5 turns only)
  - Otherwise draw from stock

Discard Policy: Mixed offensive/defensive with safety counts
  - Categorize unmelded cards: deadwood > doubles > triangles
  - As turns increase, downgrade doubles to deadwood
  - Discard from lowest-priority category first
  - Within category, prefer lowest safety count (ties: highest rank)

Knock Policy: Rule-based decision tree
  - Gin: always
  - Ahead by 30+: don't knock (try for gin to win faster)
  - Behind by 30+: don't knock (small gains negligible)
  - < 4 turns: knock (opponent likely has high deadwood)
  - > 13 turns: knock (opponent may be close to gin anyway)
  - Deadwood <= 5: knock
  - Deadwood > 5 but < 3 deadwood cards: don't knock (likely to improve)
"""

from gin_rummy.card import rank, suit, make_card, NUM_CARDS
from gin_rummy.meld import best_meld_arrangement, find_all_melds
from gin_rummy.player import Player


DOUBLE_DOWNGRADE_TURN = 8


class Heisenbot(Player):

    def __init__(self, name="Heisenbot"):
        super().__init__(name)
        self.hand = []
        self.discard_pile_cards = set()
        self.known_opponent_cards = set()
        self.likelihood = [0] * NUM_CARDS
        self.turn_count = 0

    def new_hand(self, hand, opponent_id):
        self.hand = list(hand)
        self.discard_pile_cards = set()
        self.known_opponent_cards = set()
        self.likelihood = [0] * NUM_CARDS
        self.turn_count = 0

        for c in self.hand:
            self.likelihood[c] = -5

    # --- Draw Policy: Future Value ---
    def draw_decision(self, top_discard, hand, game_state):
        self.hand = list(hand)
        self.turn_count = game_state["turn_number"]

        for c in game_state.get("discard_pile", []):
            self.discard_pile_cards.add(c)
            self.likelihood[c] = -5

        test_hand = hand + [top_discard]
        melds_with = find_all_melds(test_hand)
        for meld in melds_with:
            if top_discard in meld:
                return True

        if rank(top_discard) <= 1:
            return True

        if self.turn_count < 5 and self._forms_triangle(top_discard, hand):
            return True

        return False

    def _forms_triangle(self, card, hand):
        """Check if taking this card would form a triangle with cards in hand."""
        r, s = rank(card), suit(card)
        hand_set = set(hand)

        same_rank = [c for c in hand if rank(c) == r and suit(c) != s]
        if same_rank:
            for sr in same_rank:
                sr_suit = suit(sr)
                if r > 0 and make_card(r - 1, s) in hand_set:
                    return True
                if r < 12 and make_card(r + 1, s) in hand_set:
                    return True
                if r > 0 and make_card(r - 1, sr_suit) in hand_set:
                    return True
                if r < 12 and make_card(r + 1, sr_suit) in hand_set:
                    return True

        if r > 0 and make_card(r - 1, s) in hand_set:
            adj = make_card(r - 1, s)
            adj_rank = rank(adj)
            for c in hand:
                if rank(c) == adj_rank and suit(c) != s and c != adj:
                    return True
                if rank(c) == r and suit(c) != s:
                    return True

        if r < 12 and make_card(r + 1, s) in hand_set:
            adj = make_card(r + 1, s)
            adj_rank = rank(adj)
            for c in hand:
                if rank(c) == adj_rank and suit(c) != s and c != adj:
                    return True
                if rank(c) == r and suit(c) != s:
                    return True

        return False

    # --- Discard Policy: Mixed offensive/defensive with safety counts ---
    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        self.hand = list(hand)
        self.turn_count = game_state["turn_number"]

        melds, _, _ = best_meld_arrangement(hand)
        melded = {c for m in melds for c in m}
        unmelded = [c for c in hand if c not in melded]

        restricted = drawn_card if drew_from_discard else None

        deadwood_set = []
        doubles_set = []
        triangles_set = []

        hand_set = set(hand)
        for c in unmelded:
            if c == restricted:
                continue
            cat = self._categorize_card(c, hand_set, melded)
            if cat == "triangle":
                triangles_set.append(c)
            elif cat == "double":
                if self.turn_count >= DOUBLE_DOWNGRADE_TURN:
                    deadwood_set.append(c)
                else:
                    doubles_set.append(c)
            else:
                deadwood_set.append(c)

        if deadwood_set:
            candidates = deadwood_set
        elif doubles_set:
            candidates = doubles_set
        elif triangles_set:
            candidates = triangles_set
        else:
            candidates = [c for c in hand if c != restricted]

        return min(candidates, key=lambda c: (self._safety_count(c), -rank(c), c))

    def _categorize_card(self, card, hand_set, melded):
        """Categorize a card as 'triangle', 'double', or 'deadwood'."""
        r, s = rank(card), suit(card)

        same_rank_cards = [c for c in hand_set if rank(c) == r and suit(c) != s and c not in melded]
        if same_rank_cards:
            for sr in same_rank_cards:
                sr_s = suit(sr)
                for check_r in [r - 1, r + 1]:
                    if 0 <= check_r <= 12:
                        if make_card(check_r, s) in hand_set or make_card(check_r, sr_s) in hand_set:
                            return "triangle"

        if r > 0 and make_card(r - 1, s) in hand_set:
            adj = make_card(r - 1, s)
            if adj not in melded:
                for c2 in hand_set:
                    if c2 not in melded and c2 != card and c2 != adj:
                        if rank(c2) == r and suit(c2) != s:
                            return "triangle"
                        if rank(c2) == r - 1 and suit(c2) != s:
                            return "triangle"
                return "double"

        if r < 12 and make_card(r + 1, s) in hand_set:
            adj = make_card(r + 1, s)
            if adj not in melded:
                for c2 in hand_set:
                    if c2 not in melded and c2 != card and c2 != adj:
                        if rank(c2) == r and suit(c2) != s:
                            return "triangle"
                        if rank(c2) == r + 1 and suit(c2) != s:
                            return "triangle"
                return "double"

        if same_rank_cards:
            return "double"

        return "deadwood"

    def _safety_count(self, card):
        """Count possible opponent melds involving this card."""
        r, s = rank(card), suit(card)
        blocked = set(self.hand) | self.discard_pile_cards
        count = 0

        other_suits = [su for su in range(4) if su != s]
        from itertools import combinations
        for combo in combinations(other_suits, 2):
            if all(make_card(r, su) not in blocked for su in combo):
                count += 1

        for start_r in range(max(0, r - 2), min(11, r) + 1):
            end_r = start_r + 2
            if end_r > 12:
                continue
            needed = [make_card(rr, s) for rr in range(start_r, end_r + 1) if rr != r]
            if all(c not in blocked for c in needed):
                count += 1

        return count

    # --- Knock Policy: Rule-based ---
    def knock_decision(self, hand, game_state):
        _, dw_cards, dw = best_meld_arrangement(hand)

        if dw > 10:
            return False

        my_score = game_state["my_score"]
        opp_score = game_state["opp_score"]
        turn = game_state["turn_number"]

        if dw == 0:
            return True
        if my_score - opp_score >= 30:
            return False
        if opp_score - my_score >= 30:
            return False
        if turn < 4:
            return True
        if turn > 13:
            return True
        if dw <= 5:
            return True
        if dw > 5 and len(dw_cards) < 3:
            return False
        return True

    # --- Opponent Tracking (Prognostication) ---
    def notify_opponent_draw(self, from_discard, card=None):
        if from_discard and card is not None:
            self.likelihood[card] = 5
            self.known_opponent_cards.add(card)
            r, s = rank(card), suit(card)
            self._adjust_neighbors(r, s, +2, +1)

    def notify_opponent_discard(self, card):
        self.likelihood[card] = -5
        self.known_opponent_cards.discard(card)
        self.discard_pile_cards.add(card)
        r, s = rank(card), suit(card)
        self._adjust_neighbors(r, s, -2, -1)

    def _adjust_neighbors(self, r, s, close_delta, far_delta):
        for su in range(4):
            if su != s:
                c = make_card(r, su)
                if self.likelihood[c] not in (-5, 5):
                    self.likelihood[c] = max(-5, min(5, self.likelihood[c] + close_delta))

        for dr in [-1, 1]:
            nr = r + dr
            if 0 <= nr <= 12:
                c = make_card(nr, s)
                if self.likelihood[c] not in (-5, 5):
                    self.likelihood[c] = max(-5, min(5, self.likelihood[c] + close_delta))

        for dr in [-2, 2]:
            nr = r + dr
            if 0 <= nr <= 12:
                c = make_card(nr, s)
                if self.likelihood[c] not in (-5, 5):
                    self.likelihood[c] = max(-5, min(5, self.likelihood[c] + far_delta))
