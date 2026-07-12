"""
ApexValue: ApexMCTS with learned value-model leaf evaluation.

Replaces the deadwood-proxy rollout evaluation in the draw search with
the trained match-equity model's win-probability estimate. The search
still samples worlds and evaluates both draw choices, but instead of
using rollout deadwood as the objective, it uses the learned model's
P(win) prediction from the resulting hand state.

Design:
  - Keeps all of ApexMCTS's proven discard and knock logic
  - Overrides draw_decision to use value-model-backed search
  - Falls back to ApexMCTS draw logic if model is unavailable
  - The search objective is MAXIMIZE P(win) instead of MINIMIZE deadwood

This bot is EXPERIMENTAL and should only be shipped if benchmark evidence
supports it.
"""

import os
import random
from gin_rummy.apex_mcts import ApexMCTS, SEARCH_WORLDS, SEARCH_DEPTH, OVERRIDE_MARGIN
from gin_rummy.pbs_features import encode_pbs, FEATURE_DIM
from gin_rummy.value_model import LearnedValueModel
from gin_rummy.card import NUM_CARDS
from gin_rummy.meld import compute_deadwood

# Default model path
DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "models", "apex_value_model.pkl"
)

# Search parameters
VALUE_SEARCH_WORLDS = 30
VALUE_OVERRIDE_MARGIN = 0.03  # Win probability margin (not deadwood)


class ApexValue(ApexMCTS):
    """
    ApexMCTS with learned value-model leaf evaluation.

    The draw search evaluates each draw choice by:
    1. Sampling plausible worlds (same as ApexMCTS)
    2. For each world, computing the best discard after each draw choice
    3. Encoding the resulting hand state as PBS features
    4. Using the learned model to predict P(win) from that state
    5. Choosing the draw option with higher average P(win)
    """

    def __init__(self, name="ApexValue", seed=None,
                 model_path=None, num_worlds=VALUE_SEARCH_WORLDS,
                 override_margin=VALUE_OVERRIDE_MARGIN):
        super().__init__(
            name=name, seed=seed,
            num_worlds=num_worlds, override_margin=override_margin,
        )
        self._value_model = None
        self._model_path = model_path or DEFAULT_MODEL_PATH
        self._load_model()

        # Additional diagnostics
        self._value_search_count = 0
        self._value_override_count = 0
        self._value_agree_count = 0
        self._value_fallback_count = 0

    def _load_model(self):
        """Try to load the value model."""
        try:
            if os.path.exists(self._model_path):
                self._value_model = LearnedValueModel.load(self._model_path)
        except Exception:
            self._value_model = None

    def draw_decision(self, top_discard, hand, game_state):
        """
        Value-model-backed draw decision.

        If the model is available, runs a value-based search.
        Otherwise falls back to ApexMCTS's deadwood search.
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

        # Get Apex's heuristic decision
        apex_decision = self._apex_draw_decision(top_discard, hand, game_state)

        # If no value model, fall back to ApexMCTS behavior
        if self._value_model is None:
            return super().draw_decision(top_discard, hand, game_state)

        # Run value-model search
        value_decision, take_value, stock_value, diag = self._value_search(
            hand, top_discard, game_state
        )

        self._value_search_count += 1

        if diag.get('skipped'):
            self._value_fallback_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

        if value_decision == apex_decision:
            self._value_agree_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

        # Disagreement: override if margin is sufficient
        margin = abs(diag.get('margin', 0.0))
        if margin >= self._override_margin:
            self._value_override_count += 1
            if value_decision:
                self._last_discard = None
            return value_decision
        else:
            self._value_fallback_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

    def _value_search(self, hand, top_discard, game_state):
        """
        Monte Carlo search using value model for leaf evaluation.

        Instead of rolling out and measuring deadwood, we encode the
        resulting hand state and predict P(win) directly.
        """
        hand_set = set(hand)

        # Get unseen cards
        unseen = self.model.sample_unseen_cards()
        if len(unseen) < 3:
            return None, 0.0, 0.0, {'skipped': True, 'reason': 'too_few_unseen'}

        take_value_sum = 0.0
        stock_value_sum = 0.0
        worlds_evaluated = 0

        for _ in range(self._num_worlds):
            # Sample a world
            shuffled_unseen = list(unseen)
            self._search_rng.shuffle(shuffled_unseen)

            # === Evaluate: TAKE the discard ===
            take_hand = list(hand) + [top_discard]
            take_result_hand = self._best_hand_after_discard(take_hand, restricted=top_discard)
            take_gs = dict(game_state)
            take_value = self._evaluate_hand_value(take_result_hand, take_gs)

            # === Evaluate: Draw from STOCK ===
            if not shuffled_unseen:
                continue

            stock_card = shuffled_unseen[0]
            stock_hand = list(hand) + [stock_card]
            stock_result_hand = self._best_hand_after_discard(stock_hand, restricted=None)
            stock_gs = dict(game_state)
            stock_value = self._evaluate_hand_value(stock_result_hand, stock_gs)

            take_value_sum += take_value
            stock_value_sum += stock_value
            worlds_evaluated += 1

        if worlds_evaluated == 0:
            return None, 0.0, 0.0, {'skipped': True, 'reason': 'no_worlds'}

        take_ev = take_value_sum / worlds_evaluated
        stock_ev = stock_value_sum / worlds_evaluated

        # Small info penalty for taking from discard (reveals information)
        adjusted_take_ev = take_ev - 0.02  # 2% penalty in win probability

        should_take = adjusted_take_ev > stock_ev

        diagnostics = {
            'skipped': False,
            'worlds_evaluated': worlds_evaluated,
            'take_ev': take_ev,
            'take_ev_adjusted': adjusted_take_ev,
            'stock_ev': stock_ev,
            'margin': adjusted_take_ev - stock_ev,
        }

        return should_take, adjusted_take_ev, stock_ev, diagnostics

    def _evaluate_hand_value(self, hand_10, game_state):
        """Predict P(win) for a 10-card hand using the value model."""
        try:
            features = encode_pbs(hand_10, game_state)
            return self._value_model.predict_single(features)
        except Exception:
            # Fallback: use deadwood-based estimate
            dw = compute_deadwood(hand_10)
            return max(0.0, 1.0 - dw / 50.0)

    def _best_hand_after_discard(self, hand_11, restricted=None):
        """Return the 10-card hand after optimal discard."""
        best_dw = 999
        best_hand = None
        for i, c in enumerate(hand_11):
            if c == restricted:
                continue
            remaining = hand_11[:i] + hand_11[i+1:]
            dw = compute_deadwood(remaining)
            if dw < best_dw:
                best_dw = dw
                best_hand = remaining
        return best_hand if best_hand is not None else hand_11[:10]

    def get_value_search_stats(self):
        """Return value search diagnostics."""
        total = self._value_search_count or 1
        return {
            'total_value_searches': self._value_search_count,
            'value_overrides': self._value_override_count,
            'value_overrides_pct': round(100.0 * self._value_override_count / total, 1),
            'value_agreements': self._value_agree_count,
            'value_agreements_pct': round(100.0 * self._value_agree_count / total, 1),
            'value_fallbacks': self._value_fallback_count,
            'value_fallbacks_pct': round(100.0 * self._value_fallback_count / total, 1),
            'model_loaded': self._value_model is not None,
        }
