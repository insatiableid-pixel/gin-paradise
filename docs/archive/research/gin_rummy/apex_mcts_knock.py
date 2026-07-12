"""
ApexMCTSKnock: ApexMCTS with learned knock model override.

Inherits all of ApexMCTS's draw search and Apex's discard logic.
Overrides ONLY the knock_decision method with a learned model that
considers gin liveness, score context, and risk.

Design philosophy:
- The learned model is trained on paired MC evaluations of knock vs continue
- It directly represents liveness × score context features
- Gin is always knocked (hard rule, not model)
- Low-stock forced knocks are preserved
- The model is only consulted for non-trivial knock states (DW 1-10)
- If the model file doesn't exist, falls back to Apex's knock logic
"""

import os
import random
from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.meld import best_meld_arrangement
from gin_rummy.knock_features import encode_knock_decision


# Path to the trained knock model
_DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "models", "knock_action_model.pkl"
)

# Minimum confidence to override Apex's knock decision
CONFIDENCE_THRESHOLD = 0.55


class ApexMCTSKnock(ApexMCTS):
    """
    ApexMCTS with learned knock model.

    Keeps all of ApexMCTS's draw search and Apex's discard logic intact.
    Overrides knock_decision with a learned model that evaluates
    liveness × score × risk features.
    """

    def __init__(self, name="ApexMCTSKnock", seed=None,
                 model_path=None, confidence_threshold=CONFIDENCE_THRESHOLD):
        super().__init__(name=name, seed=seed)
        self._knock_model = None
        self._model_loaded = False
        self._confidence_threshold = confidence_threshold

        # Diagnostics
        self._knock_consults = 0
        self._knock_overrides = 0
        self._knock_agreements = 0
        self._knock_fallbacks = 0

        # Try to load the model
        model_file = model_path or _DEFAULT_MODEL_PATH
        if os.path.exists(model_file):
            try:
                from gin_rummy.knock_action_model import LearnedKnockModel
                self._knock_model = LearnedKnockModel.load(model_file)
                self._model_loaded = True
            except Exception:
                self._model_loaded = False

    def knock_decision(self, hand, game_state):
        """
        Learned-model-backed knock decision.

        1. Check legality (DW <= 10)
        2. Always knock on gin (DW = 0)
        3. Always knock on low stock
        4. Consult learned model for DW 1-10
        5. If model is confident and disagrees with Apex, override
        6. Otherwise defer to Apex
        """
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        # Hard rules: always knock gin
        if my_dw == 0:
            return True

        # Hard rule: low stock → always knock
        deck_remaining = game_state.get('deck_remaining', 30)
        if deck_remaining <= 8:
            return True

        # Get Apex's decision
        apex_decision = super().knock_decision(hand, game_state)

        # If model not loaded, fall back to Apex
        if not self._model_loaded or self._knock_model is None:
            self._knock_fallbacks += 1
            return apex_decision

        # Encode features
        try:
            features = encode_knock_decision(
                hand=hand,
                game_state=game_state,
                opponent_model=self.model,
            )
        except Exception:
            self._knock_fallbacks += 1
            return apex_decision

        # Consult model
        self._knock_consults += 1
        knock_prob = self._knock_model.predict_single(features)
        model_decision = knock_prob > 0.5

        if model_decision == apex_decision:
            self._knock_agreements += 1
            return apex_decision

        # Disagreement: override only if confident
        confidence = abs(knock_prob - 0.5) * 2  # 0-1 scale
        if confidence >= self._confidence_threshold:
            self._knock_overrides += 1
            return model_decision
        else:
            self._knock_fallbacks += 1
            return apex_decision

    def get_search_stats(self):
        """Return diagnostic statistics including knock model stats."""
        stats = super().get_search_stats()
        total_knock = max(1, self._knock_consults)
        stats.update({
            'knock_model_loaded': self._model_loaded,
            'knock_consults': self._knock_consults,
            'knock_overrides': self._knock_overrides,
            'knock_overrides_pct': round(100.0 * self._knock_overrides / total_knock, 1),
            'knock_agreements': self._knock_agreements,
            'knock_agreements_pct': round(100.0 * self._knock_agreements / total_knock, 1),
            'knock_fallbacks': self._knock_fallbacks,
        })
        return stats
