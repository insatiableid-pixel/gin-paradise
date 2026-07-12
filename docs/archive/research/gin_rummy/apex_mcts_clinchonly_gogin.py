"""
ApexMCTSClinchOnlyGoGin: ApexMCTS with clinch-only go-gin knock policy.

Knock policy:
  1. Gin (DW=0): always knock
  2. Non-gin legal knock that immediately wins the game: always knock
  3. Otherwise: never knock

NO low-stock override.  This isolates the clinch exception from the
low-stock exception so Phase 57 can determine whether clinch alone
justifies breaking pure go-gin patience.
"""

from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.meld import best_meld_arrangement


class ApexMCTSClinchOnlyGoGin(ApexMCTS):
    """
    ApexMCTS with clinch-only go-gin knock policy.

    - Gin (DW=0): always knock
    - Non-gin legal knock that wins the game: always knock
    - Everything else (including low stock): never knock
    """

    def __init__(self, name="ApexMCTSClinchOnlyGoGin", seed=None,
                 target_score=100):
        super().__init__(name=name, seed=seed)
        self._target_score = target_score

    def knock_decision(self, hand, game_state):
        """Knock on gin or immediate game-clinching knocks only."""
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        # 1. Always knock on gin
        if my_dw == 0:
            return True

        # 2. Non-gin knock that wins the game
        my_score = game_state.get('my_score', 0)
        points_if_knock = max(1, 10 - my_dw)
        if (my_score + points_if_knock) >= self._target_score:
            return True

        # 3. Otherwise: hold for gin (NO low-stock override)
        return False
