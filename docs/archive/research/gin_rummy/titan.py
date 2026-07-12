"""
Titan: Champion Gin Rummy AI.

Built on Simple's proven foundation with ONLY targeted improvements
that have been validated through tournament play:
  1. Draw: Only take discard if it completes a meld OR reduces DW by ≥4
  2. Discard: Highest deadwood first, with safety tiebreaker
  3. Knock: Always knock when legal (DW ≤ 10)
  4. Opponent tracking: decline signals and known cards for safer discards
"""

import random
from itertools import combinations
from gin_rummy.card import (
    rank, suit, make_card, deadwood_value, NUM_CARDS
)
from gin_rummy.meld import (
    best_meld_arrangement, find_all_melds, compute_deadwood
)
from gin_rummy.player import Player


class Titan(Player):
    """Champion Gin Rummy AI — Simple foundation with targeted improvements."""

    def __init__(self, name="Titan"):
        super().__init__(name)
        self.hand = []
        self.turn = 0
        self.discard_pile_cards = set()
        self.known_opp = set()     # Cards we KNOW opponent holds
        self.declined = set()      # Cards opponent declined
        self._top_for_opp = None   # What opponent will see next turn

    def new_hand(self, hand, opponent_id):
        self.hand = list(hand)
        self.turn = 0
        self.discard_pile_cards = set()
        self.known_opp = set()
        self.declined = set()
        self._top_for_opp = None

    # ════════════════════════════════════════════════════════════
    #  DRAW — Simple's approach + DW reduction check
    # ════════════════════════════════════════════════════════════
    def draw_decision(self, top_discard, hand, game_state):
        self.hand = list(hand)
        self.turn = game_state['turn_number']

        for c in game_state.get('discard_pile', []):
            self.discard_pile_cards.add(c)

        # 1. Take if it immediately completes/extends a meld
        test_hand = hand + [top_discard]
        melds_with = find_all_melds(test_hand)
        if any(top_discard in m for m in melds_with):
            return True

        # 2. Take if it significantly reduces deadwood (≥4 points)
        #    This is the ONE improvement over Simple that helps
        current_dw = compute_deadwood(hand)
        best_dw = self._best_dw_after_take(test_hand, top_discard)
        if best_dw < current_dw - 3:
            return True

        return False

    def _best_dw_after_take(self, hand_11, restricted):
        """Best DW achievable after discarding one card from 11-card hand."""
        best = 999
        for i, c in enumerate(hand_11):
            if c == restricted:
                continue
            rest = hand_11[:i] + hand_11[i + 1:]
            dw = compute_deadwood(rest)
            if dw < best:
                best = dw
        return best

    # ════════════════════════════════════════════════════════════
    #  DISCARD — Highest deadwood, safety tiebreaker
    # ════════════════════════════════════════════════════════════
    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        self.hand = list(hand)

        melds, dw_cards, dw = best_meld_arrangement(hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)

        candidates = [c for c in hand if c not in melded]
        if drew_from_discard:
            candidates = [c for c in candidates if c != drawn_card]
        if not candidates:
            candidates = [c for c in hand if not (drew_from_discard and c == drawn_card)]
        if not candidates:
            candidates = list(hand)

        # Primary: highest deadwood (get rid of expensive cards)
        # Secondary: lowest safety count (safest to give opponent)
        # Tertiary: highest rank
        best = max(candidates, key=lambda c: (
            deadwood_value(c) * 10,     # Dominant factor
            -self._safety_count(c),     # Tiebreaker: prefer safe discards
            rank(c)                      # Final tiebreaker
        ))

        # Track our discard for opponent decline tracking
        self._top_for_opp = best
        return best

    def _safety_count(self, card):
        """How many melds could opponent form with this card? Lower = safer."""
        r, s = rank(card), suit(card)
        blocked = set(self.hand) | self.discard_pile_cards
        count = 0

        # Possible set melds (need 2 others of same rank)
        other_suits = [su for su in range(4) if su != s]
        for combo in combinations(other_suits, 2):
            if all(make_card(r, su) not in blocked for su in combo):
                count += 1

        # Possible run melds (need 2 others for a run of 3)
        for start_r in range(max(0, r - 2), min(11, r) + 1):
            end_r = start_r + 2
            if end_r > 12:
                continue
            needed = [make_card(rr, s) for rr in range(start_r, end_r + 1) if rr != r]
            if all(c not in blocked for c in needed):
                count += 1

        # Discount if opponent declined this card
        if card in self.declined:
            count = max(0, count - 2)

        # Penalty if we KNOW opponent has related cards
        for opp_c in self.known_opp:
            if rank(opp_c) == r and suit(opp_c) != s:
                count += 3
            if suit(opp_c) == s and 0 < abs(rank(opp_c) - r) <= 2:
                count += 2

        return count

    # ════════════════════════════════════════════════════════════
    #  KNOCK — Always knock when legal
    # ════════════════════════════════════════════════════════════
    def knock_decision(self, hand, game_state):
        _, _, dw = best_meld_arrangement(hand)
        return dw <= 10

    # ════════════════════════════════════════════════════════════
    #  OPPONENT TRACKING
    # ════════════════════════════════════════════════════════════
    def notify_opponent_draw(self, from_discard, card=None):
        if from_discard and card is not None:
            self.known_opp.add(card)
        else:
            # Opponent declined whatever was on top
            if self._top_for_opp is not None:
                self.declined.add(self._top_for_opp)

    def notify_opponent_discard(self, card):
        self.known_opp.discard(card)
        self.discard_pile_cards.add(card)
        self._top_for_opp = card  # This is now the top for next decision

    def notify_hand_result(self, result):
        pass
