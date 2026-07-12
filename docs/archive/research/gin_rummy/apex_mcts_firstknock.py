"""
ApexMCTSFirstKnock: ApexMCTS that knocks at the first legal opportunity.

Ablation bot that keeps ApexMCTS draw and Apex discard logic unchanged,
but changes the knock policy to: knock whenever DW <= 10 (always knock).

Purpose: represent the maximally aggressive knock policy. This is the
opposite extreme from GoGin. Comparing against GoGin and the learned
model reveals whether patience or aggression is the key factor.
"""

from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.meld import best_meld_arrangement


class ApexMCTSFirstKnock(ApexMCTS):
    """
    ApexMCTS with always-knock policy.

    - Any legal knock (DW <= 10): always knock
    - Not legal (DW > 10): don't knock

    Draw and discard logic are completely unchanged from ApexMCTS/Apex.
    """

    def __init__(self, name="ApexMCTSFirstKnock", seed=None):
        super().__init__(name=name, seed=seed)

    def knock_decision(self, hand, game_state):
        """Knock at every legal opportunity."""
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        return my_dw <= 10
