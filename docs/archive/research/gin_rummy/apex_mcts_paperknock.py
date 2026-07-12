"""
ApexMCTSPaperKnock: ApexMCTS with paper-inspired lightweight knock rules.

Ablation bot that keeps ApexMCTS draw and Apex discard logic unchanged,
but uses a simplified, paper-inspired knock policy based on well-known
Gin Rummy strategic principles:

1. Gin always knocks
2. Low stock always knocks (deck <= 8)
3. Very low DW (1-3): knock unless gin-live (few DW cards and score favors holding)
4. Low DW (4-5): knock in most cases
5. DW 6-10: hold unless late game or behind on score
6. Score-clinch: always knock if it wins the game
7. Paper rule 7: DW > 5 but <= 2 DW cards -> hold (likely to improve)

This represents a "textbook good" knock policy without any learning.
"""

from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.meld import best_meld_arrangement


class ApexMCTSPaperKnock(ApexMCTS):
    """
    ApexMCTS with paper-inspired knock rules.

    Uses simple heuristic rules from Gin Rummy strategy literature
    without any learning or MC simulation.
    """

    def __init__(self, name="ApexMCTSPaperKnock", seed=None,
                 target_score=100):
        super().__init__(name=name, seed=seed)
        self._target_score = target_score

    def knock_decision(self, hand, game_state):
        """Paper-inspired knock decision based on classic strategy."""
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        turn = game_state.get('turn_number', 0)
        my_score = game_state.get('my_score', 0)
        opp_score = game_state.get('opp_score', 0)
        deck_remaining = game_state.get('deck_remaining', 30)
        score_diff = my_score - opp_score

        # 1. Always knock on gin
        if my_dw == 0:
            return True

        # 2. Low stock: always knock
        if deck_remaining <= 8:
            return True

        # 3. Score clinch: knock if it wins the game
        if (my_score + max(1, 10 - my_dw)) >= self._target_score:
            return True

        # 4. Paper rule 7: DW > 5 but <= 2 DW cards -> hold
        #    These hands are very likely to improve to gin quickly
        if my_dw > 5 and len(dw_cards) <= 2:
            return False

        # 5. Very low DW (1-3): usually knock
        #    Exception: if gin-live (1 DW card) and not late game, hold
        if my_dw <= 3:
            if len(dw_cards) == 1 and turn < 10:
                return False  # One card from gin, hold
            return True

        # 6. Low DW (4-5): knock unless score gap favors holding
        if my_dw <= 5:
            if abs(score_diff) >= 22 and len(dw_cards) <= 2 and turn < 12:
                return False  # Big score gap, hold for gin
            return True

        # 7. DW 6-10: mostly hold
        #    Exception: late game (turn 13+) or behind on score
        if turn >= 13:
            return True
        if opp_score > my_score and turn >= 8:
            return True

        return False
