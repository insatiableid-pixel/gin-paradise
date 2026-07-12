"""
Nexus: Optimal Gin Rummy AI.

Key improvements over existing players:
  1. Discard by actual deadwood computation on non-melded cards
  2. Opponent-model-aware safety scoring for discards
  3. Layoff-aware knock decisions for marginal cases
  4. Smart draw with DW reduction + meld completion
"""

import random
from itertools import combinations
from gin_rummy.card import rank, suit, make_card, deadwood_value, NUM_CARDS
from gin_rummy.meld import (
    best_meld_arrangement, find_all_melds, compute_deadwood, compute_layoffs
)
from gin_rummy.player import Player
from gin_rummy.opponent_model import OpponentModel, IN_DISCARD

UNDERCUT_BONUS = 25
MC_KNOCK_SAMPLES = 20
SAFETY_WEIGHT = 0.5
LATE_TURN = 12


class Nexus(Player):
    """Optimal Gin Rummy AI."""

    def __init__(self, name="Nexus"):
        super().__init__(name)
        self.model = OpponentModel()
        self.hand = []
        self.turn = 0
        self.my_score = 0
        self.opp_score = 0

    def new_hand(self, hand, opponent_id):
        self.hand = list(hand)
        self.model.reset(hand)
        self.turn = 0

    # ================================================================
    #  DRAW - Take if meld completion or significant DW reduction
    # ================================================================
    def draw_decision(self, top_discard, hand, game_state):
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)
        self.turn = game_state["turn_number"]
        self.my_score = game_state.get("my_score", 0)
        self.opp_score = game_state.get("opp_score", 0)

        for c in game_state.get("discard_pile", []):
            if c not in self.hand:
                self.model.set_discard(c)

        # 1. Take if it completes/extends a meld
        test_hand = hand + [top_discard]
        melds_with = find_all_melds(test_hand)
        if any(top_discard in m for m in melds_with):
            return True

        # 2. Take if it significantly reduces deadwood (>=4 points)
        current_dw = compute_deadwood(hand)
        take_dw = self._best_dw_after_take(test_hand, top_discard)
        if take_dw < current_dw - 3:
            return True

        # 3. Defensive draw: deny opponent if cost is small
        if self._should_defensive_draw(top_discard, current_dw, take_dw):
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

    def _should_defensive_draw(self, card, current_dw, take_dw):
        """Take to deny opponent if cost is small and they likely want it."""
        if take_dw > current_dw + 2:
            return False
        r, s = rank(card), suit(card)
        known_opp = self.model.get_known_opponent_cards()
        danger = 0
        for opp_c in known_opp:
            if rank(opp_c) == r and suit(opp_c) != s:
                danger += 3
            if suit(opp_c) == s and 0 < abs(rank(opp_c) - r) <= 2:
                danger += 3
        return danger >= 6

    # ================================================================
    #  DISCARD - Actual DW computation on non-melded cards + safety
    # ================================================================
    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)

        melds, dw_cards, dw = best_meld_arrangement(hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)

        restricted = drawn_card if drew_from_discard else None

        # Only consider non-melded cards first
        candidates = [c for c in hand if c not in melded and c != restricted]
        if not candidates:
            candidates = [c for c in hand if c != restricted]
        if not candidates:
            candidates = list(hand)

        best_card = None
        best_score = float("inf")

        for c in candidates:
            remaining = list(hand)
            remaining.remove(c)
            actual_dw = compute_deadwood(remaining)
            safety = self._safety_score(c)

            # Primary: minimize remaining deadwood
            # Secondary: small safety penalty to prefer safe discards
            combined = actual_dw + safety * SAFETY_WEIGHT

            if (combined < best_score or
                    (combined == best_score and best_card is not None and
                     deadwood_value(c) > deadwood_value(best_card))):
                best_score = combined
                best_card = c

        self.model.my_discard(best_card)
        if best_card in self.hand:
            self.hand.remove(best_card)
        return best_card

    def _safety_score(self, card):
        """How dangerous is discarding this card to the opponent? Lower = safer."""
        r, s = rank(card), suit(card)
        score = 0.0
        blocked = set(self.hand) | set(
            c for c in range(NUM_CARDS) if self.model.card_state[c] == IN_DISCARD
        )
        other_suits = [su for su in range(4) if su != s]
        for combo in combinations(other_suits, 2):
            if all(make_card(r, su) not in blocked for su in combo):
                w = sum(self.model.weight[make_card(r, su)] for su in combo)
                score += w * 0.5
        for start_r in range(max(0, r - 2), min(11, r) + 1):
            end_r = start_r + 2
            if end_r > 12:
                continue
            needed = [make_card(rr, s) for rr in range(start_r, end_r + 1) if rr != r]
            if all(c not in blocked for c in needed):
                w = sum(self.model.weight[c] for c in needed)
                score += w * 0.5
        for opp_c in self.model.get_known_opponent_cards():
            if rank(opp_c) == r and suit(opp_c) != s:
                score += 4.0
            if suit(opp_c) == s and 0 < abs(rank(opp_c) - r) <= 2:
                score += 3.0
        return score

    # ================================================================
    #  KNOCK - Aggressive with layoff-aware MC for marginal cases
    # ================================================================
    def knock_decision(self, hand, game_state):
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False
        turn = game_state["turn_number"]
        my_score = game_state.get("my_score", 0)
        opp_score = game_state.get("opp_score", 0)
        if my_dw == 0:
            return True
        if my_dw <= 5:
            return True
        if my_score + 1 >= 100:
            return True
        if turn <= 3 or turn >= LATE_TURN:
            return True
        # DW 6-10, mid-game: layoff-aware MC
        total_ev = 0.0
        undercuts = 0
        for _ in range(MC_KNOCK_SAMPLES):
            opp_hand = self.model.sample_opponent_hand(n_total=10)
            _, opp_dw_cards, opp_dw = best_meld_arrangement(opp_hand)
            layoff_cards = compute_layoffs(melds, opp_dw_cards)
            opp_dw_after = opp_dw - sum(deadwood_value(c) for c in layoff_cards)
            if opp_dw_after < 0:
                opp_dw_after = 0
            if my_dw < opp_dw_after:
                total_ev += (opp_dw_after - my_dw)
            else:
                total_ev -= (UNDERCUT_BONUS + my_dw - opp_dw_after)
                undercuts += 1
        expected_value = total_ev / MC_KNOCK_SAMPLES
        if expected_value > -3:
            return True
        if opp_score > my_score:
            return True
        return False

    # ================================================================
    #  OPPONENT TRACKING
    # ================================================================
    def notify_opponent_draw(self, from_discard, card=None):
        if from_discard and card is not None:
            self.model.opponent_drew_discard(card)
        else:
            self.model.opponent_drew_stock()

    def notify_opponent_discard(self, card):
        self.model.opponent_discarded(card)

    def notify_hand_result(self, result):
        pass

