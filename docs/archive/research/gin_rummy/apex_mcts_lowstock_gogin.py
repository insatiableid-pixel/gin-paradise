"""
ApexMCTSLowStockGoGin: ApexMCTS with low-stock go-gin knock policy.

Knock policy:
  1. Gin (DW=0): always knock
  2. Non-gin legal knock on low stock (deck_remaining <= 8): always knock
  3. Otherwise: never knock

NO clinch override.  This isolates the low-stock exception from the
clinch exception so Phase 57 can determine whether low-stock alone
justifies breaking pure go-gin patience.
"""

from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.meld import best_meld_arrangement


class ApexMCTSLowStockGoGin(ApexMCTS):
    """
    ApexMCTS with low-stock go-gin knock policy.

    - Gin (DW=0): always knock
    - Non-gin legal knock on low stock (deck <= 8): always knock
    - Everything else (including clinch situations): never knock
    """

    def __init__(self, name="ApexMCTSLowStockGoGin", seed=None):
        super().__init__(name=name, seed=seed)

    def knock_decision(self, hand, game_state):
        """Knock on gin or low-stock situations only."""
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        # 1. Always knock on gin
        if my_dw == 0:
            return True

        # 2. Low stock: always knock
        deck_remaining = game_state.get('deck_remaining', 30)
        if deck_remaining <= 8:
            return True

        # 3. Otherwise: hold for gin (NO clinch override)
        return False
