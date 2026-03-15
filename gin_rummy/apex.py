"""
Apex: Strongest Gin Rummy AI.

Proven foundation: actual-DW discard selection, defensive draws.
Upgrades:
  1. Bayesian opponent model for tracking and MC knock decisions
  2. Triangle-aware draws (early game)
  3. Layoff-aware MC knock to avoid undercuts at DW 6-10
  4. Score-aware knock suppression (paper rules: ±22 → go for gin)
  5. Always take Aces/Twos (minimal DW, undercut insurance)
  6. Few-DW-cards hold rule (paper rule 7: DW>5, <3 cards → hold)
  7. Opponent-model-weighted safety scoring for discards
  8. Stock-depth-aware knock aggression (deck ≤ 8 → knock)
  9. Actual-DW discard minimization (replaces heuristic)
"""

from itertools import combinations
from gin_rummy.card import (
    rank, suit, make_card, deadwood_value, NUM_CARDS
)
from gin_rummy.meld import (
    best_meld_arrangement, find_all_melds, compute_deadwood, compute_layoffs
)
from gin_rummy.player import Player
from gin_rummy.opponent_model import OpponentModel, IN_DISCARD

MC_KNOCK_SAMPLES = 25
UNDERCUT_BONUS = 25
TRIANGLE_CUTOFF = 6
SCORE_GAP_THRESHOLD = 22


class Apex(Player):
    """Strongest Gin Rummy AI."""

    def __init__(self, name="Apex"):
        super().__init__(name)
        self.model = OpponentModel()
        self.hand = []
        self.turn = 0
        self.discard_pile_cards = set()
        self.declined = set()
        self._top_for_opp = None
        self.my_score = 0
        self.opp_score = 0

    def new_hand(self, hand, opponent_id):
        self.hand = list(hand)
        self.model.reset(hand)
        self.turn = 0
        self.discard_pile_cards = set()
        self.declined = set()
        self._top_for_opp = None

    # ════════════════════════════════════════════════════════════
    #  DRAW
    # ════════════════════════════════════════════════════════════
    def draw_decision(self, top_discard, hand, game_state):
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)
        self.turn = game_state['turn_number']
        self.my_score = game_state.get('my_score', 0)
        self.opp_score = game_state.get('opp_score', 0)

        for c in game_state.get('discard_pile', []):
            self.discard_pile_cards.add(c)
            if c not in self.hand:
                self.model.set_discard(c)

        # 1. Take if it completes/extends a meld
        test_hand = hand + [top_discard]
        melds_with = find_all_melds(test_hand)
        if any(top_discard in m for m in melds_with):
            return True

        # 2. Always take Aces and Twos (paper rule: minimal DW insurance)
        if rank(top_discard) <= 1:
            return True

        # 3. Take if it reduces deadwood by >=4
        current_dw = compute_deadwood(hand)
        best_dw = self._best_dw_after_take(test_hand, top_discard)
        if best_dw < current_dw - 3:
            return True

        # 4. Triangle formation in early game (if no DW cost)
        if self.turn < TRIANGLE_CUTOFF and best_dw <= current_dw:
            if self._forms_triangle(top_discard, hand):
                return True

        # 5. Take low-DW doubles in early/mid game (paper-inspired)
        if self.turn < 10 and deadwood_value(top_discard) <= 3:
            if self._forms_double(top_discard, hand):
                # current_dw already computed at line 79, just use it
                best_dw_check = self._best_dw_after_take(test_hand, top_discard)
                if best_dw_check <= current_dw:
                    return True

        # 6. Defensive draw: deny opponent if cost is small
        if self._should_defensive_draw(top_discard, hand, current_dw):
            return True

        return False

    def _best_dw_after_take(self, hand_11, restricted):
        best = 999
        for i, c in enumerate(hand_11):
            if c == restricted:
                continue
            rest = hand_11[:i] + hand_11[i + 1:]
            dw = compute_deadwood(rest)
            if dw < best:
                best = dw
        return best

    def _forms_triangle(self, card, hand):
        r, s = rank(card), suit(card)
        hand_set = set(hand)
        same_rank = [c for c in hand if rank(c) == r and suit(c) != s]
        if same_rank:
            for sr in same_rank:
                sr_s = suit(sr)
                for dr in [-1, 1]:
                    nr = r + dr
                    if 0 <= nr <= 12:
                        if make_card(nr, s) in hand_set or make_card(nr, sr_s) in hand_set:
                            return True
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
        """Check if card forms a partial meld (pair or adjacent) with any hand card."""
        r, s = rank(card), suit(card)
        for c in hand:
            cr, cs = rank(c), suit(c)
            if cr == r and cs != s:
                return True
            if cs == s and 0 < abs(cr - r) <= 2:  # Include gap-1 partial runs
                return True
        return False

    def _should_defensive_draw(self, card, hand, current_dw):
        r, s = rank(card), suit(card)
        known_opp = self.model.get_known_opponent_cards()
        opp_want_score = 0
        for opp_c in known_opp:
            if rank(opp_c) == r and suit(opp_c) != s:
                opp_want_score += 3
            if suit(opp_c) == s and 0 < abs(rank(opp_c) - r) <= 2:
                opp_want_score += 3
        if opp_want_score < 6:
            return False
        test_hand = hand + [card]
        best_dw = self._best_dw_after_take(test_hand, card)
        return best_dw <= current_dw + 2

    # ════════════════════════════════════════════════════════════
    #  DISCARD — Two-phase: heuristic filter → actual-DW verification
    # ════════════════════════════════════════════════════════════
    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)

        melds, dw_cards, dw = best_meld_arrangement(hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)

        restricted = drawn_card if drew_from_discard else None
        candidates = [c for c in hand if c not in melded and c != restricted]
        if not candidates:
            candidates = [c for c in hand if c != restricted]
        if not candidates:
            candidates = list(hand)

        hand_set = set(hand)

        # Phase 1: Fast heuristic scoring to rank all candidates
        scored = []
        for c in candidates:
            heuristic = self._discard_score(c, hand_set, melded)
            scored.append((heuristic, c))
        scored.sort(reverse=True)  # Higher = better to discard

        # Phase 2: Actual-DW verification on top candidates (max 3)
        top_n = min(3, len(scored))
        best_card = scored[0][1]  # fallback
        best_dw = float('inf')
        for _, c in scored[:top_n]:
            remaining = list(hand)
            remaining.remove(c)
            actual_dw = compute_deadwood(remaining)
            # Pure DW comparison; safety already reflected in phase 1 ranking
            if actual_dw < best_dw or (actual_dw == best_dw
                    and deadwood_value(c) > deadwood_value(best_card)):
                best_dw = actual_dw
                best_card = c

        self._top_for_opp = best_card
        self.model.my_discard(best_card)
        if best_card in self.hand:
            self.hand.remove(best_card)
        return best_card

    def _discard_score(self, card, hand_set, melded):
        """Score a discard candidate. Higher = better to discard."""
        dv = deadwood_value(card)
        r, s = rank(card), suit(card)

        score = dv * 100

        near_meld = self._near_meld_value(card, hand_set, melded)
        score -= near_meld * 30

        safety = self._safety_count(card)
        score -= safety * 15

        if card in self.declined:
            score += 20

        return score

    def _near_meld_value(self, card, hand_set, melded):
        r, s = rank(card), suit(card)
        value = 0

        same_rank_count = 0
        for su in range(4):
            if su != s:
                c = make_card(r, su)
                if c in hand_set and c not in melded:
                    same_rank_count += 1
        if same_rank_count >= 2:
            value += 4
        elif same_rank_count == 1:
            value += 2

        adj_count = 0
        if r > 0 and make_card(r - 1, s) in hand_set:
            c = make_card(r - 1, s)
            if c not in melded:
                adj_count += 1
        if r < 12 and make_card(r + 1, s) in hand_set:
            c = make_card(r + 1, s)
            if c not in melded:
                adj_count += 1
        if adj_count >= 2:
            value += 5
        elif adj_count == 1:
            value += 2

        if adj_count == 0:
            if r >= 2 and make_card(r - 2, s) in hand_set and make_card(r - 2, s) not in melded:
                value += 1
            if r <= 10 and make_card(r + 2, s) in hand_set and make_card(r + 2, s) not in melded:
                value += 1

        if self.turn >= 8:
            value = value // 2

        return value

    def _safety_count(self, card):
        """Opponent-model-weighted safety score. Higher = more dangerous to discard."""
        r, s = rank(card), suit(card)
        blocked = set(self.hand) | set(
            c for c in range(NUM_CARDS) if self.model.card_state[c] == IN_DISCARD
        )
        score = 0.0

        # Possible set melds for opponent (weighted by model)
        other_suits = [su for su in range(4) if su != s]
        for combo in combinations(other_suits, 2):
            if all(make_card(r, su) not in blocked for su in combo):
                w = sum(self.model.weight[make_card(r, su)] for su in combo)
                score += w * 0.5

        # Possible run melds for opponent (weighted by model)
        for start_r in range(max(0, r - 2), min(11, r) + 1):
            end_r = start_r + 2
            if end_r > 12:
                continue
            needed = [make_card(rr, s) for rr in range(start_r, end_r + 1) if rr != r]
            if all(c not in blocked for c in needed):
                w = sum(self.model.weight[c] for c in needed)
                score += w * 0.5

        # Discount if opponent declined this card
        if card in self.declined:
            score = max(0, score - 2)

        # Strong penalty if opponent KNOWN to hold related cards
        for opp_c in self.model.get_known_opponent_cards():
            if rank(opp_c) == r and suit(opp_c) != s:
                score += 4.0
            if suit(opp_c) == s and 0 < abs(rank(opp_c) - r) <= 2:
                score += 3.0

        return score

    # ════════════════════════════════════════════════════════════
    #  KNOCK — Paper-informed rules + MC undercut avoidance
    # ════════════════════════════════════════════════════════════
    def knock_decision(self, hand, game_state):
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        turn = game_state['turn_number']
        my_score = game_state.get('my_score', 0)
        opp_score = game_state.get('opp_score', 0)
        score_diff = my_score - opp_score
        deck_remaining = game_state.get('deck_remaining', 30)

        # 1. Gin: always
        if my_dw == 0:
            return True

        # 1b. Stock-depth override: don't risk a void hand when stock is low
        if deck_remaining <= 8 and my_dw <= 10:
            return True

        # 2. Score-aware: ahead by ≥THRESHOLD → hold for gin (paper rule)
        #    Exception: late game or close to winning → just knock
        if score_diff >= SCORE_GAP_THRESHOLD and my_dw > 0:
            if turn < 12 and my_score + my_dw < 100:
                # Hold for gin unless we have too many DW cards to realistically improve
                if len(dw_cards) <= 2:
                    return False

        # 3. Score-aware: behind by ≥THRESHOLD → hold for gin (paper rule)
        #    Small gains won't close the gap; need gin bonus
        if score_diff <= -SCORE_GAP_THRESHOLD and my_dw > 0:
            if turn < 12 and len(dw_cards) <= 2:
                return False

        # 4. Low DW: always knock
        if my_dw <= 5:
            return True

        # 5. Early game (turns 0-3): knock aggressively, opponent likely high DW
        if turn <= 3:
            return True

        # 6. Late game (turn 13+): knock before opponent goes gin
        if turn >= 13:
            return True

        # 7. Paper rule 7: DW > 5 but fewer than 3 DW cards → hold
        #    High chance of quick improvement (e.g., one face card as deadwood)
        if len(dw_cards) <= 2:
            return False

        # 8. DW 6-10, mid-game, 3+ DW cards: MC layoff-aware check
        self.model.update_my_hand(hand)
        total_ev = 0.0
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
        expected_value = total_ev / MC_KNOCK_SAMPLES

        # Knock if EV is not clearly negative
        if expected_value > -3:
            return True

        # Behind on score: be more aggressive
        if opp_score > my_score:
            return True

        return False

    # ════════════════════════════════════════════════════════════
    #  OPPONENT TRACKING
    # ════════════════════════════════════════════════════════════
    def notify_opponent_draw(self, from_discard, card=None):
        if from_discard and card is not None:
            self.model.opponent_drew_discard(card)
        else:
            if self._top_for_opp is not None:
                self.declined.add(self._top_for_opp)
            self.model.opponent_drew_stock()

    def notify_opponent_discard(self, card):
        self.model.opponent_discarded(card)
        self.discard_pile_cards.add(card)
        self._top_for_opp = card

    def notify_hand_result(self, result):
        pass
