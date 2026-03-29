"""
ApexMCTS: Apex with Monte Carlo draw search.

Inherits all of Apex's proven discard and knock logic.
Overrides only the draw_decision method with an information-set
Monte Carlo evaluation that samples plausible worlds and evaluates
whether taking from the discard pile or drawing from stock produces
better expected deadwood.

Design philosophy:
- Apex's draw heuristic is good but not perfect. It uses rules like
  "take if it completes a meld" and "take if DW drop >= 4". These
  are sound but miss cases where:
  (a) Taking a card that completes a meld still isn't worth the info reveal
  (b) The average stock draw is better than the discard even when
      the discard looks individually appealing
  (c) A card that doesn't meet any heuristic threshold is actually
      better than stock on average

- The search evaluates both choices across many sampled worlds and
  picks the one with lower expected post-rollout deadwood (with an
  info penalty for taking from the discard pile).

- When the search is inconclusive (margin too small) or can't run
  (too few unseen cards), we fall back to Apex's heuristic draw.
"""

from gin_rummy.apex import Apex
from gin_rummy.draw_search import evaluate_draw_choice, DEFAULT_NUM_WORLDS, DEFAULT_ROLLOUT_DEPTH, INFO_PENALTY
import random


# Minimum margin to override Apex's draw decision
# If the search margin is within this band, defer to Apex
OVERRIDE_MARGIN = 0.5

# Number of sampled worlds for the draw search
SEARCH_WORLDS = 30

# Rollout depth (draw-discard cycles after initial draw)
SEARCH_DEPTH = 2


class ApexMCTS(Apex):
    """
    Apex with Monte Carlo draw search.

    Keeps all of Apex's discard and knock logic intact.
    Overrides draw_decision with a search-backed evaluation
    that samples worlds and compares expected deadwood between
    taking from discard vs drawing from stock.
    """

    def __init__(self, name="ApexMCTS", seed=None,
                 num_worlds=SEARCH_WORLDS,
                 rollout_depth=SEARCH_DEPTH,
                 info_penalty=INFO_PENALTY,
                 override_margin=OVERRIDE_MARGIN):
        super().__init__(name)
        self._search_rng = random.Random(seed)
        self._num_worlds = num_worlds
        self._rollout_depth = rollout_depth
        self._info_penalty = info_penalty
        self._override_margin = override_margin

        # Diagnostics counters
        self._search_count = 0
        self._override_count = 0
        self._fallback_count = 0
        self._agree_count = 0
        self._skip_count = 0

    def new_hand(self, hand, opponent_id):
        super().new_hand(hand, opponent_id)

    def draw_decision(self, top_discard, hand, game_state):
        """
        Monte Carlo search-backed draw decision.

        1. Get Apex's heuristic decision
        2. Run the MC draw search
        3. If search is inconclusive or skipped, use Apex's decision
        4. If search disagrees and has sufficient margin, override Apex
        5. Otherwise, agree with Apex
        """
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)
        self.turn = game_state['turn_number']
        self.my_score = game_state.get('my_score', 0)
        self.opp_score = game_state.get('opp_score', 0)

        for c in game_state.get('discard_pile', []):
            self.discard_pile_cards.add(c)
            if c not in self.hand:
                self.model.set_discard(c)

        # Step 1: Get Apex's heuristic answer
        apex_decision = self._apex_draw_decision(top_discard, hand, game_state)

        # Step 2: Run the MC draw search (v1: uniform world sampling)
        should_take, take_ev, stock_ev, diag = evaluate_draw_choice(
            hand=hand,
            top_discard=top_discard,
            opponent_model=self.model,
            game_state=game_state,
            num_worlds=self._num_worlds,
            rollout_depth=self._rollout_depth,
            info_penalty=self._info_penalty,
            rng=self._search_rng,
            use_weighted_worlds=False,
        )

        self._search_count += 1

        # Step 3: If search was skipped, fall back to Apex
        if diag.get('skipped'):
            self._skip_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

        # Step 4: Check if search disagrees with sufficient margin
        margin = diag.get('margin', 0.0)
        search_decision = should_take

        if search_decision == apex_decision:
            # Agreement
            self._agree_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

        # Disagreement: only override if margin is strong enough
        abs_margin = abs(margin)
        if abs_margin >= self._override_margin:
            self._override_count += 1
            if search_decision:
                self._last_discard = None
            return search_decision
        else:
            # Weak disagreement: defer to Apex
            self._fallback_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

    def _apex_draw_decision(self, top_discard, hand, game_state):
        """
        Run Apex's draw heuristic without the side effects we already applied.
        This replicates the logic from Apex.draw_decision without re-updating
        the model (which we already did above).
        """
        from gin_rummy.card import rank, deadwood_value
        from gin_rummy.meld import find_all_melds, compute_deadwood

        # 1. Take if it completes/extends a meld
        test_hand = hand + [top_discard]
        melds_with = find_all_melds(test_hand)
        completes_meld = any(top_discard in m for m in melds_with)
        if completes_meld:
            return True

        # 1b. Cycle prevention
        if top_discard == self._last_discard:
            return False

        # 2. Always take Aces and Twos
        if rank(top_discard) <= 1:
            return True

        # 3. Take if it reduces deadwood by >=4
        current_dw = compute_deadwood(hand)
        best_dw = self._best_dw_after_take(test_hand, top_discard)
        if best_dw < current_dw - 3:
            return True

        # 4. Triangle formation in early game
        if self.turn < 6 and best_dw <= current_dw:
            if self._forms_triangle(top_discard, hand):
                return True

        # 5. Low-DW doubles in early/mid game
        if self.turn < 10 and deadwood_value(top_discard) <= 3:
            if self._forms_double(top_discard, hand):
                best_dw_check = self._best_dw_after_take(test_hand, top_discard)
                if best_dw_check <= current_dw:
                    return True

        # 6. Defensive draw
        if self._should_defensive_draw(top_discard, hand, current_dw):
            return True

        return False

    def get_search_stats(self):
        """Return diagnostic statistics about the search."""
        total = self._search_count or 1
        return {
            'total_searches': self._search_count,
            'overrides': self._override_count,
            'overrides_pct': round(100.0 * self._override_count / total, 1),
            'agreements': self._agree_count,
            'agreements_pct': round(100.0 * self._agree_count / total, 1),
            'fallbacks': self._fallback_count,
            'fallbacks_pct': round(100.0 * self._fallback_count / total, 1),
            'skips': self._skip_count,
            'skips_pct': round(100.0 * self._skip_count / total, 1),
        }
