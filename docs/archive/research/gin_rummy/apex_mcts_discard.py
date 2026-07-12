"""
ApexMCTSDiscard: ApexMCTS with learned discard candidate ranking.

Keeps all of ApexMCTS's proven draw search and knock logic intact.
Overrides only the discard_decision method to use a learned model
for candidate ranking instead of Apex's two-phase heuristic pipeline.

Design:
  1. Enumerate all legal discard candidates (same as Apex)
  2. Encode features for each candidate
  3. Score candidates using the learned model
  4. Select the highest-scored candidate

Fallback: if the model is unavailable or encounters an error,
falls back to Apex's standard discard logic.
"""

import os
from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.discard_action_model import LearnedDiscardModel
from gin_rummy.discard_action_features import encode_discard_candidate, DISCARD_FEATURE_DIM
from gin_rummy.card import deadwood_value
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
import numpy as np

# Default model path
DEFAULT_DISCARD_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "models", "discard_action_model.pkl"
)


class ApexMCTSDiscard(ApexMCTS):
    """
    ApexMCTS with learned discard candidate ranking.

    Keeps all of ApexMCTS's draw search and knock logic unchanged.
    Replaces only the discard decision with a learned model that
    scores and ranks all legal discard candidates.
    """

    def __init__(self, name="ApexMCTSDiscard", seed=None, model_path=None):
        super().__init__(name=name, seed=seed)

        # Load discard model
        path = model_path or DEFAULT_DISCARD_MODEL_PATH
        if os.path.exists(path):
            self._discard_model = LearnedDiscardModel.load(path)
        else:
            self._discard_model = None

        # Diagnostics
        self._model_discard_count = 0
        self._fallback_discard_count = 0

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        """
        Learned model-backed discard decision.

        1. Build candidate list (same as Apex: prefer non-melded, respect restriction)
        2. Try to encode features and score with learned model
        3. If model available and successful: pick highest-scored candidate
        4. Otherwise: fall back to Apex's standard discard logic
        """
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)
        self.turn = game_state.get('turn_number', self.turn)

        if self._discard_model is None:
            self._fallback_discard_count += 1
            return super().discard_decision(hand, drew_from_discard, drawn_card, game_state)

        try:
            best_card = self._model_discard(hand, drew_from_discard, drawn_card, game_state)
            self._model_discard_count += 1

            self._top_for_opp = best_card
            self._last_discard = best_card
            self.model.my_discard(best_card)
            if best_card in self.hand:
                self.hand.remove(best_card)
            return best_card
        except Exception:
            self._fallback_discard_count += 1
            return super().discard_decision(hand, drew_from_discard, drawn_card, game_state)

    def _model_discard(self, hand, drew_from_discard, drawn_card, game_state):
        """Use the learned model to pick the best discard candidate."""
        restricted = drawn_card if drew_from_discard else None

        # Build candidate list (same filtering as Apex)
        melds, dw_cards, _ = best_meld_arrangement(hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)

        candidates = [c for c in hand if c not in melded and c != restricted]
        if not candidates:
            candidates = [c for c in hand if c != restricted]
        if not candidates:
            candidates = list(hand)

        if len(candidates) == 1:
            return candidates[0]

        # Encode features for each candidate
        feature_list = []
        for c in candidates:
            feats = encode_discard_candidate(
                hand, c, drew_from_discard, drawn_card,
                game_state, self.model
            )
            feature_list.append(feats)

        X = np.array(feature_list, dtype=np.float32)
        scores = self._discard_model.score_candidates(X)

        # Pick the highest-scored candidate
        best_idx = int(np.argmax(scores))
        return candidates[best_idx]

    def get_search_stats(self):
        """Return extended diagnostic statistics."""
        stats = super().get_search_stats()
        total_discards = self._model_discard_count + self._fallback_discard_count
        stats.update({
            'model_discards': self._model_discard_count,
            'fallback_discards': self._fallback_discard_count,
            'model_discard_pct': round(
                100.0 * self._model_discard_count / max(total_discards, 1), 1
            ),
        })
        return stats
