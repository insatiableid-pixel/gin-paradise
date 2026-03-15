"""
DeepKnock: Advanced Gin Rummy AI that beats Heisenbot.

Design philosophy: Build on Heisenbot's proven strategies, then add targeted
improvements where they matter most.

Key advantages over Heisenbot:
1. Smarter draw: takes discards that reduce deadwood significantly (not just melds)
2. Opponent-aware discard: uses Bayesian model to avoid feeding opponent melds
3. Monte Carlo knocking: estimates opponent deadwood to minimize undercut risk
4. Better knock timing: considers opponent's likely state, not just own deadwood
"""

from itertools import combinations
from gin_rummy.card import (
    rank, suit, make_card, deadwood_value, NUM_CARDS
)
from gin_rummy.meld import (
    best_meld_arrangement, find_all_melds, compute_deadwood
)
from gin_rummy.player import Player
from gin_rummy.opponent_model import OpponentModel, IN_DISCARD


# Tunable parameters
MC_KNOCK_SAMPLES = 15
EARLY_GAME_TURNS = 4
MID_GAME_TURNS = 10
LATE_GAME_TURNS = 13
TRIANGLE_CUTOFF_TURN = 6


class DeepKnock(Player):

    def __init__(self, name="DeepKnock"):
        super().__init__(name)
        self.model = OpponentModel()
        self.hand = []
        self.turn_count = 0
        self.my_score = 0
        self.opp_score = 0

    def new_hand(self, hand, opponent_id):
        self.hand = list(hand)
        self.model.reset(hand)
        self.turn_count = 0

    # ================================================================
    # DRAW POLICY: Future Value + Deadwood Reduction
    # ================================================================
    def draw_decision(self, top_discard, hand, game_state):
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)
        self.turn_count = game_state['turn_number']
        self.my_score = game_state['my_score']
        self.opp_score = game_state['opp_score']

        # Update model with known discard cards.
        # This also repairs stale IN_MY_HAND markers if one of our former cards
        # is now visible in discard.
        for c in game_state.get('discard_pile', []):
            if c not in self.hand:
                self.model.set_discard(c)

        # 1. Take if it immediately creates/extends a meld
        test_hand = hand + [top_discard]
        melds_with = find_all_melds(test_hand)
        directly_melds = any(top_discard in m for m in melds_with)

        if directly_melds:
            return True

        # 2. Always take Aces and Twos (low deadwood insurance)
        if rank(top_discard) <= 1:
            return True

        # 3. Take if forms a triangle (early/mid game)
        if self.turn_count < TRIANGLE_CUTOFF_TURN:
            if self._forms_triangle(top_discard, hand):
                return True

        # 4. Take if it significantly reduces deadwood
        #    (must properly restrict: can't discard what we just took)
        current_dw = compute_deadwood(hand)
        take_dw = self._best_discard_deadwood(test_hand, restricted=top_discard)
        if take_dw < current_dw - 3:
            return True

        # 5. Take low-deadwood cards that form doubles (early game)
        if self.turn_count < MID_GAME_TURNS and deadwood_value(top_discard) <= 3:
            if self._forms_double(top_discard, hand):
                return True

        return False

    def _best_discard_deadwood(self, hand_11, restricted=None):
        """Best achievable deadwood after discarding one card from 11-card hand."""
        best_dw = 999
        for i, c in enumerate(hand_11):
            if c == restricted:
                continue
            remaining = hand_11[:i] + hand_11[i + 1:]
            dw = compute_deadwood(remaining)
            if dw < best_dw:
                best_dw = dw
        return best_dw

    def _forms_triangle(self, card, hand):
        """Check if taking this card forms a triangle (2 meld paths)."""
        r, s = rank(card), suit(card)
        hand_set = set(hand)

        # Same rank pair + adjacent same suit
        same_rank = [c for c in hand if rank(c) == r and suit(c) != s]
        if same_rank:
            for sr in same_rank:
                sr_s = suit(sr)
                for dr in [-1, 1]:
                    nr = r + dr
                    if 0 <= nr <= 12:
                        if make_card(nr, s) in hand_set or make_card(nr, sr_s) in hand_set:
                            return True

        # Adjacent same suit + same rank elsewhere
        for dr in [-1, 1]:
            nr = r + dr
            if 0 <= nr <= 12 and make_card(nr, s) in hand_set:
                for c in hand:
                    if rank(c) == r and suit(c) != s:
                        return True
                    if rank(c) == nr and suit(c) != s:
                        return True
        return False

    def _forms_double(self, card, hand):
        """Check if card forms a partial meld with any hand card."""
        r, s = rank(card), suit(card)
        for c in hand:
            cr, cs = rank(c), suit(c)
            if cr == r and cs != s:
                return True
            if cs == s and 0 < abs(cr - r) <= 1:
                return True
        return False

    # ================================================================
    # DISCARD POLICY: Heisenbot-style categorization + opponent model
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
        hand_set = set(hand)

        # Categorize unmelded cards: deadwood, doubles, triangles
        deadwood_list = []
        doubles_list = []
        triangles_list = []

        for c in hand:
            if c == restricted:
                continue
            if c in melded:
                continue

            cat = self._categorize_card(c, hand_set, melded)
            if cat == 'triangle':
                # Downgrade triangles to deadwood late game
                if self.turn_count >= MID_GAME_TURNS:
                    deadwood_list.append(c)
                else:
                    triangles_list.append(c)
            elif cat == 'double':
                if self.turn_count >= 8:
                    deadwood_list.append(c)
                else:
                    doubles_list.append(c)
            else:
                deadwood_list.append(c)

        # Pick from lowest priority category first
        if deadwood_list:
            candidates = deadwood_list
        elif doubles_list:
            candidates = doubles_list
        elif triangles_list:
            candidates = triangles_list
        else:
            # All cards melded or restricted, pick from full hand
            candidates = [c for c in hand if c != restricted]
            if not candidates:
                candidates = list(hand)

        # Within the chosen category: discard highest deadwood first,
        # use safety as tiebreaker (lower safety = safer to discard)
        best_card = max(candidates, key=lambda c: (
            deadwood_value(c),
            -self._safety_score(c),
            rank(c)
        ))

        # Keep model state aligned with the actual post-discard hand.
        self.model.my_discard(best_card)
        if best_card in self.hand:
            self.hand.remove(best_card)
        return best_card

    def _categorize_card(self, card, hand_set, melded):
        """Categorize unmelded card as 'triangle', 'double', or 'deadwood'."""
        r, s = rank(card), suit(card)

        # Check triangle: two same-rank + one adjacent
        same_rank = [c for c in hand_set if rank(c) == r and suit(c) != s and c not in melded and c != card]
        if same_rank:
            for sr in same_rank:
                sr_s = suit(sr)
                for check_r in [r - 1, r + 1]:
                    if 0 <= check_r <= 12:
                        if make_card(check_r, s) in hand_set or make_card(check_r, sr_s) in hand_set:
                            return 'triangle'

        # Check double: adjacent same suit pair
        for dr in [-1, 1]:
            nr = r + dr
            if 0 <= nr <= 12:
                adj = make_card(nr, s)
                if adj in hand_set and adj not in melded:
                    # Check if this pair + something forms a triangle
                    for c2 in hand_set:
                        if c2 not in melded and c2 != card and c2 != adj:
                            if rank(c2) == r and suit(c2) != s:
                                return 'triangle'
                            if rank(c2) == nr and suit(c2) != s:
                                return 'triangle'
                    return 'double'

        # Same rank pair (not part of triangle)
        if same_rank:
            return 'double'

        return 'deadwood'

    def _safety_score(self, card):
        """
        How dangerous is discarding this card to the opponent?
        Uses opponent model for weighted risk. Lower = safer to discard.
        """
        r, s = rank(card), suit(card)
        score = 0.0

        blocked = set(self.hand) | set(
            c for c in range(NUM_CARDS) if self.model.card_state[c] == IN_DISCARD
        )

        # Possible set melds for opponent
        other_suits = [su for su in range(4) if su != s]
        for combo in combinations(other_suits, 2):
            if all(make_card(r, su) not in blocked for su in combo):
                # Weight by opponent likelihood
                w = sum(self.model.weight[make_card(r, su)] for su in combo)
                score += w * 0.5

        # Possible run melds for opponent
        for start_r in range(max(0, r - 2), min(11, r) + 1):
            end_r = start_r + 2
            if end_r > 12:
                continue
            needed = [make_card(rr, s) for rr in range(start_r, end_r + 1) if rr != r]
            if all(c not in blocked for c in needed):
                w = sum(self.model.weight[c] for c in needed)
                score += w * 0.5

        # Strong penalty if opponent is KNOWN to hold related cards
        known_opp = self.model.get_known_opponent_cards()
        for opp_c in known_opp:
            if rank(opp_c) == r and suit(opp_c) != s:
                score += 4.0
            if suit(opp_c) == s and 0 < abs(rank(opp_c) - r) <= 2:
                score += 3.0

        return score

    # ================================================================
    # KNOCK POLICY: Aggressive baseline + Monte Carlo for marginal cases
    # ================================================================
    def knock_decision(self, hand, game_state):
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)

        melds, dw_cards, dw = best_meld_arrangement(hand)

        if dw > 10:
            return False

        turn = game_state['turn_number']
        my_score = game_state['my_score']
        opp_score = game_state['opp_score']
        score_diff = my_score - opp_score

        # === ALWAYS knock conditions ===
        if dw == 0:
            return True  # Gin

        if dw <= 5:
            return True  # Greedy threshold: proven effective

        # === Turn-based rules ===
        if turn < EARLY_GAME_TURNS:
            return True  # Opponent likely has high deadwood, knock aggressively

        if turn >= LATE_GAME_TURNS:
            return True  # Late game: knock before opponent goes gin

        # === dw 6-10, turns 4-12: use Monte Carlo ===
        opp_samples = self.model.estimate_opponent_deadwood_distribution(MC_KNOCK_SAMPLES)
        opp_deadwoods = [d for _, d in opp_samples]

        # Expected points from knocking
        expected_pts = 0.0
        for opp_dw in opp_deadwoods:
            if dw <= opp_dw:
                expected_pts += (opp_dw - dw)
            else:
                expected_pts -= (25 + dw - opp_dw)
        expected_pts /= len(opp_deadwoods)

        # Score-based strategy (only at extreme leads/deficits)
        if score_diff >= 50:
            # Way ahead: only skip knocking if we can likely improve to gin
            if len(dw_cards) <= 2 and dw <= 8:
                return False  # Few deadwood cards, good gin potential
            return expected_pts > -5

        if score_diff <= -50:
            # Way behind: need big wins, be selective but not passive
            if expected_pts > 3:
                return True
            if len(dw_cards) <= 2:
                return False  # Good chance to improve
            return turn >= MID_GAME_TURNS  # Don't wait too long

        # Normal play: knock unless expected value is clearly bad
        if expected_pts > -3:
            return True

        # Only hold off if we have few deadwood cards (likely to improve)
        if len(dw_cards) <= 2:
            return False

        # Default: knock. Don't let the opponent knock first.
        return True

    # ================================================================
    # NOTIFICATIONS
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
