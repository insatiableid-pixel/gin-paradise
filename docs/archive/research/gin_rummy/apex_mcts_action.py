"""
ApexMCTSAction: ApexMCTS with action-conditioned draw model.

Conservative integration: uses the learned draw action model
to resolve close-call situations where the MC draw search margin
is narrow. When the search margin is within the close-call band,
the action model's prediction is used as a tiebreaker.

This preserves all of ApexMCTS's proven behavior and only uses
the learned model where the search is least confident.

Design:
  - When |search margin| >= STRONG_MARGIN: use search result (as ApexMCTS does)
  - When CLOSE_CALL_BAND <= |search margin| < STRONG_MARGIN: use model prediction
  - When |search margin| < CLOSE_CALL_BAND: defer to Apex heuristic
  - When search is skipped: defer to Apex heuristic
"""

import os
import random
from gin_rummy.apex_mcts import ApexMCTS, OVERRIDE_MARGIN
from gin_rummy.draw_search import evaluate_draw_choice, INFO_PENALTY
from gin_rummy.draw_action_model import LearnedDrawActionModel
from gin_rummy.action_features import encode_draw_action

# Integration thresholds
STRONG_MARGIN = 1.5        # Above this: trust search (high confidence)
CLOSE_CALL_BAND = 0.3     # Below this: defer to Apex heuristic
MODEL_THRESHOLD = 0.55    # Model P(take) must exceed this to take

# Default model path
DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "models", "draw_action_model.pkl"
)


class ApexMCTSAction(ApexMCTS):
    """
    ApexMCTS with action-conditioned model for close-call resolution.

    Keeps all of ApexMCTS's proven discard, knock, and search logic.
    Adds a learned draw action model that is consulted only when the
    MC search margin is in the uncertain middle band.
    """

    def __init__(self, name="ApexMCTSAction", seed=None,
                 model_path=None,
                 strong_margin=STRONG_MARGIN,
                 close_call_band=CLOSE_CALL_BAND,
                 model_threshold=MODEL_THRESHOLD):
        super().__init__(name=name, seed=seed)
        self._strong_margin = strong_margin
        self._close_call_band = close_call_band
        self._model_threshold = model_threshold

        # Load model
        path = model_path or DEFAULT_MODEL_PATH
        if os.path.exists(path):
            self._action_model = LearnedDrawActionModel.load(path)
        else:
            self._action_model = None

        # Diagnostics
        self._model_consults = 0
        self._model_overrides = 0
        self._strong_search = 0
        self._weak_fallback = 0

    def draw_decision(self, top_discard, hand, game_state):
        """
        Draw decision with model-augmented close-call resolution.

        Flow:
          1. Update state (as ApexMCTS)
          2. Get Apex heuristic answer
          3. Run MC draw search
          4. If search has strong margin → use search
          5. If search has medium margin → consult action model
          6. If search margin is weak or skipped → use Apex heuristic
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

        # Step 1: Get Apex heuristic answer
        apex_decision = self._apex_draw_decision(top_discard, hand, game_state)

        # Step 2: Run MC draw search (same as ApexMCTS)
        should_take, take_ev, stock_ev, diag = evaluate_draw_choice(
            hand=hand, top_discard=top_discard,
            opponent_model=self.model, game_state=game_state,
            num_worlds=self._num_worlds, rollout_depth=self._rollout_depth,
            info_penalty=self._info_penalty, rng=self._search_rng,
            use_weighted_worlds=False,
        )

        self._search_count += 1

        # Step 3: If search was skipped, fall back to Apex
        if diag.get('skipped'):
            self._skip_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

        margin = diag.get('margin', 0.0)
        abs_margin = abs(margin)

        # Step 4: Strong search margin → trust search
        if abs_margin >= self._strong_margin:
            self._strong_search += 1
            decision = should_take
            if decision != apex_decision:
                self._override_count += 1
            else:
                self._agree_count += 1
            if decision:
                self._last_discard = None
            return decision

        # Step 5: Medium margin → consult action model
        if abs_margin >= self._close_call_band and self._action_model is not None:
            self._model_consults += 1
            try:
                features = encode_draw_action(
                    hand=hand,
                    top_discard=top_discard,
                    game_state=game_state,
                    opponent_model=self.model,
                )
                take_prob = self._action_model.predict_single(features)
                model_decision = take_prob > self._model_threshold

                if model_decision != apex_decision:
                    self._model_overrides += 1

                if model_decision:
                    self._last_discard = None
                return model_decision
            except Exception:
                pass  # Fall through to Apex

        # Step 6: Weak margin or no model → defer to Apex
        self._weak_fallback += 1
        if apex_decision:
            self._last_discard = None
        return apex_decision

    def get_search_stats(self):
        """Return extended diagnostic statistics."""
        stats = super().get_search_stats()
        total = self._search_count or 1
        stats.update({
            'model_consults': self._model_consults,
            'model_consults_pct': round(100.0 * self._model_consults / total, 1),
            'model_overrides': self._model_overrides,
            'model_overrides_pct': round(100.0 * self._model_overrides / total, 1),
            'strong_search': self._strong_search,
            'strong_search_pct': round(100.0 * self._strong_search / total, 1),
            'weak_fallbacks': self._weak_fallback,
            'weak_fallbacks_pct': round(100.0 * self._weak_fallback / total, 1),
        })
        return stats
