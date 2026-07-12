"""
ApexMCTSValue: Conservative value-augmented draw search bot.

Inherits all of ApexMCTS's proven discard and knock logic.
Overrides draw_decision to use the value-augmented search that
supplements deadwood rollout EV with a learned P(win) correction
in close-call situations.

Design (Phase 52):
  - This is NOT a replacement of the rollout stack (that was ApexValue's mistake)
  - The value model is only consulted when deadwood margins are tight
  - Deadwood rollout remains the primary evaluation signal
  - When the model is unavailable, behavior falls back cleanly to ApexMCTS
  - When value_weight=0, behavior is equivalent to baseline ApexMCTS

Naming: "ApexMCTSValue" is deliberately distinct from the failed "ApexValue"
to signal this is a refinement of MCTS, not a replacement.
"""

import os
import random
from gin_rummy.apex_mcts import ApexMCTS, SEARCH_WORLDS, SEARCH_DEPTH, OVERRIDE_MARGIN
from gin_rummy.value_augmented_search import (
    evaluate_draw_choice_augmented,
    _load_value_model,
    DEFAULT_VALUE_WEIGHT,
    DEFAULT_CLOSE_CALL_BAND,
    DEFAULT_OVERRIDE_THRESHOLD,
    DEFAULT_MODEL_PATH,
)
from gin_rummy.draw_search import INFO_PENALTY


class ApexMCTSValue(ApexMCTS):
    """
    ApexMCTS with conservative value-augmented draw search.

    The draw search uses deadwood rollouts as the primary signal,
    with a learned P(win) correction applied only in close-call
    situations where the deadwood margin is small.
    """

    def __init__(self, name="ApexMCTSValue", seed=None,
                 num_worlds=SEARCH_WORLDS,
                 rollout_depth=SEARCH_DEPTH,
                 info_penalty=INFO_PENALTY,
                 override_margin=OVERRIDE_MARGIN,
                 model_path=None,
                 value_weight=DEFAULT_VALUE_WEIGHT,
                 close_call_band=DEFAULT_CLOSE_CALL_BAND,
                 value_override_threshold=DEFAULT_OVERRIDE_THRESHOLD):
        super().__init__(
            name=name, seed=seed,
            num_worlds=num_worlds,
            rollout_depth=rollout_depth,
            info_penalty=info_penalty,
            override_margin=override_margin,
        )
        self._value_weight = value_weight
        self._close_call_band = close_call_band
        self._value_override_threshold = value_override_threshold
        self._value_model = _load_value_model(model_path or DEFAULT_MODEL_PATH)

        # Value-specific diagnostics
        self._value_consulted_count = 0
        self._value_changed_count = 0
        self._value_agreed_count = 0
        self._value_not_consulted_count = 0

    def draw_decision(self, top_discard, hand, game_state):
        """
        Value-augmented draw decision.

        1. Get Apex's heuristic decision
        2. Run value-augmented MC draw search
        3. If search skipped, fall back to Apex
        4. If search disagrees with sufficient margin, override Apex
        5. Track value consultation diagnostics
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

        # Step 2: Run value-augmented search
        should_take, take_ev, stock_ev, diag = evaluate_draw_choice_augmented(
            hand=hand,
            top_discard=top_discard,
            opponent_model=self.model,
            game_state=game_state,
            value_model=self._value_model,
            num_worlds=self._num_worlds,
            rollout_depth=self._rollout_depth,
            info_penalty=self._info_penalty,
            rng=self._search_rng,
            value_weight=self._value_weight,
            close_call_band=self._close_call_band,
            override_threshold=self._value_override_threshold,
        )

        self._search_count += 1

        # Track value diagnostics
        if not diag.get('skipped'):
            if diag.get('value_consulted'):
                self._value_consulted_count += 1
                if diag.get('value_changed_answer'):
                    self._value_changed_count += 1
                else:
                    self._value_agreed_count += 1
            else:
                self._value_not_consulted_count += 1

        # Step 3: If search was skipped, fall back to Apex
        if diag.get('skipped'):
            self._skip_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

        # Step 4: Check agreement / override
        search_decision = should_take
        margin = diag.get('margin', 0.0)

        if search_decision == apex_decision:
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
            self._fallback_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

    def get_value_augmentation_stats(self):
        """Return diagnostics about value model consultation."""
        total = self._search_count or 1
        return {
            'total_searches': self._search_count,
            'value_consulted': self._value_consulted_count,
            'value_consulted_pct': round(100.0 * self._value_consulted_count / total, 1),
            'value_changed_answer': self._value_changed_count,
            'value_changed_pct': round(100.0 * self._value_changed_count / total, 1),
            'value_agreed': self._value_agreed_count,
            'value_agreed_pct': round(100.0 * self._value_agreed_count / total, 1),
            'value_not_consulted': self._value_not_consulted_count,
            'value_not_consulted_pct': round(100.0 * self._value_not_consulted_count / total, 1),
            'model_loaded': self._value_model is not None,
            'value_weight': self._value_weight,
            'close_call_band': self._close_call_band,
            'value_override_threshold': self._value_override_threshold,
            # Also include base MCTS stats
            'overrides': self._override_count,
            'overrides_pct': round(100.0 * self._override_count / total, 1),
            'agreements': self._agree_count,
            'agreements_pct': round(100.0 * self._agree_count / total, 1),
            'fallbacks': self._fallback_count,
            'fallbacks_pct': round(100.0 * self._fallback_count / total, 1),
            'skips': self._skip_count,
            'skips_pct': round(100.0 * self._skip_count / total, 1),
        }
