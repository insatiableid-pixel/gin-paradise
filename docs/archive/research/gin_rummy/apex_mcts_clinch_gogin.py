"""
ApexMCTSClinchGoGin: ApexMCTS with clinch-aware go-gin knock policy.

Ablation bot that keeps ApexMCTS draw and Apex discard logic unchanged,
but changes the knock policy to:
  1. Always knock on gin (DW=0)
  2. Non-gin legal knock: knock if it immediately wins the game
  3. Low-stock legal knock: knock if deck_remaining <= 8 (preserve engine's low-stock override)
  4. Otherwise never knock

Purpose: isolate whether the learned model's advantage comes from
simple patience + obvious score-clinch handling, or from genuine
knock judgment beyond those obvious cases.

Note: the low-stock override at deck_remaining <= 8 is preserved
from the base Apex/ApexMCTSKnock engine to ensure a fair comparison.
Without this, the bot would void too many hands when stock runs out,
which is a strategic penalty unrelated to knock judgment.
"""

from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.meld import best_meld_arrangement


class ApexMCTSClinchGoGin(ApexMCTS):
    """
    ApexMCTS with clinch-aware go-gin knock policy.

    - Gin (DW=0): always knock
    - Non-gin legal knock that wins the game: always knock
    - Low stock (deck <= 8): always knock (engine's standard low-stock override)
    - Everything else: never knock
    """

    def __init__(self, name="ApexMCTSClinchGoGin", seed=None,
                 target_score=100):
        super().__init__(name=name, seed=seed)
        self._target_score = target_score

    def knock_decision(self, hand, game_state):
        """Knock on gin, immediate game-clinching knocks, and low stock."""
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        # 1. Always knock on gin
        if my_dw == 0:
            return True

        # 2. Low stock: always knock (engine's standard override)
        deck_remaining = game_state.get('deck_remaining', 30)
        if deck_remaining <= 8:
            return True

        # 3. Non-gin knock that wins the game
        # Conservative estimate: assume we score at least 1 point for a valid knock
        my_score = game_state.get('my_score', 0)
        points_if_knock = max(1, 10 - my_dw)  # Rough minimum: opponent DW >= our DW + 1
        if (my_score + points_if_knock) >= self._target_score:
            return True

        # 4. Otherwise: hold for gin
        return False
