"""
ApexMCTSGoGin: ApexMCTS with go-gin-only knock policy.

Ablation bot that keeps ApexMCTS draw and Apex discard logic unchanged,
but changes the knock policy to: knock ONLY on gin (DW=0), never otherwise.

Purpose: isolate whether the learned model's gameplay gain comes from
simple patience (rarely knocking) versus genuine knock judgment.
"""

from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.meld import best_meld_arrangement


class ApexMCTSGoGin(ApexMCTS):
    """
    ApexMCTS with go-gin-only knock policy.

    - Gin (DW=0): always knock
    - Everything else: never knock

    Draw and discard logic are completely unchanged from ApexMCTS/Apex.
    """

    def __init__(self, name="ApexMCTSGoGin", seed=None):
        super().__init__(name=name, seed=seed)

    def knock_decision(self, hand, game_state):
        """Only knock on gin."""
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False
        return my_dw == 0
