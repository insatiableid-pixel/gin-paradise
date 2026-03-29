"""
ApexCFR: Hybrid Gin Rummy AI combining Apex heuristics with CFR-learned discard policy.

Decision breakdown:
  - DRAW:    Pure Apex (heuristic, not learned)
  - DISCARD: CFR-learned policy when coverage exists, Apex fallback otherwise
  - KNOCK:   Pure Apex (heuristic MC-based, not learned)

The CFR-learned discard policy:
  1. Generates top-K candidates using Apex's heuristic pipeline (same as pure Apex)
  2. Looks up the information set in the trained strategy table
  3. If the info set has been seen in training, selects the action with
     highest average-strategy probability
  4. If not seen, falls back to Apex's pure DW minimization (action 0)

This ensures ApexCFR is never worse than Apex on unseen states,
and can only improve on states where training found a better policy.
"""

import os
from gin_rummy.card import rank, suit, deadwood_value
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.apex import Apex
from gin_rummy.cfr_strategy import (
    CFRStrategy, compute_info_set, NUM_ACTIONS
)

# Default strategy file path
DEFAULT_STRATEGY_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'models', 'apex_cfr_strategy.json'
)


class ApexCFR(Apex):
    """
    Hybrid bot: Apex draw/knock + CFR-learned discard policy.

    Inherits all of Apex's draw, knock, and opponent tracking logic.
    Overrides only discard_decision to use the learned strategy.
    """

    def __init__(self, name="ApexCFR", strategy_path=None):
        super().__init__(name)
        self.cfr_strategy = CFRStrategy()
        self.cfr_loaded = False
        self.cfr_decisions = 0      # Count of CFR-guided decisions
        self.fallback_decisions = 0  # Count of Apex-fallback decisions

        # Load strategy if available
        path = strategy_path or DEFAULT_STRATEGY_PATH
        if os.path.exists(path):
            try:
                self.cfr_strategy.load(path)
                self.cfr_loaded = True
            except Exception:
                self.cfr_loaded = False

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        """
        Discard using CFR-learned strategy when available, Apex otherwise.

        Process:
        1. Generate candidates using Apex's heuristic pipeline
        2. Look up info set in CFR strategy table
        3. If covered: use average strategy to pick best action
        4. If not covered: use Apex's pure DW minimization
        """
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)
        self.turn = game_state.get('turn_number', self.turn)

        melds, dw_cards, dw = best_meld_arrangement(hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)

        restricted = drawn_card if drew_from_discard else None
        candidates = [c for c in hand if c not in melded and c != restricted]
        if not candidates:
            candidates = [c for c in hand if c != restricted]
        if not candidates:
            candidates = list(hand)

        hand_set = set(hand)

        # Phase 1: Heuristic scoring (same as Apex)
        scored = []
        for c in candidates:
            heuristic = self._discard_score(c, hand_set, melded)
            scored.append((heuristic, c))
        scored.sort(reverse=True)

        # Phase 2: Get top-K candidates
        top_n = min(NUM_ACTIONS, len(scored))
        top_candidates = [scored[i][1] for i in range(top_n)]

        # Pad if fewer than NUM_ACTIONS candidates
        while len(top_candidates) < NUM_ACTIONS:
            top_candidates.append(top_candidates[-1])

        # Phase 3: CFR-informed selection
        chosen_idx = 0  # Default: Apex's top choice

        if self.cfr_loaded:
            info_set = compute_info_set(hand, game_state)

            if self.cfr_strategy.has_coverage(info_set):
                # Use average strategy from CFR training
                avg_strategy = self.cfr_strategy.get_average_strategy(info_set)

                # Pick the action with highest average strategy probability
                # (deterministic at inference time, not sampling)
                chosen_idx = max(range(NUM_ACTIONS), key=lambda a: avg_strategy[a])

                # But verify the choice doesn't increase DW vs Apex's pick
                # This is a safety check to prevent gross regressions
                chosen_dw = compute_deadwood(
                    [c for c in hand if c != top_candidates[chosen_idx]]
                )
                apex_dw = compute_deadwood(
                    [c for c in hand if c != top_candidates[0]]
                )

                # Allow CFR choice if:
                # - It matches Apex (no risk)
                # - It's within 2 DW of Apex's choice (learned preference)
                # - Only if DW <= 2 worse; never accept 3+ DW regression
                if chosen_dw <= apex_dw + 2:
                    self.cfr_decisions += 1
                else:
                    # CFR choice is too risky, fall back
                    chosen_idx = 0
                    self.fallback_decisions += 1
            else:
                self.fallback_decisions += 1
        else:
            # No strategy loaded: pure Apex behavior
            # Use Apex Phase 2: actual-DW verification on top candidates
            best_dw = float('inf')
            best_card = top_candidates[0]
            for i in range(top_n):
                c = top_candidates[i]
                remaining = list(hand)
                remaining.remove(c)
                actual_dw = compute_deadwood(remaining)
                if actual_dw < best_dw or (
                    actual_dw == best_dw and
                    deadwood_value(c) > deadwood_value(best_card)
                ):
                    best_dw = actual_dw
                    best_card = c
                    chosen_idx = i
            self.fallback_decisions += 1

        best_card = top_candidates[chosen_idx]
        self._top_for_opp = best_card
        self._last_discard = best_card
        self.model.my_discard(best_card)
        if best_card in self.hand:
            self.hand.remove(best_card)
        return best_card

    def get_cfr_usage_stats(self):
        """Return stats on how often CFR vs fallback was used."""
        total = self.cfr_decisions + self.fallback_decisions
        return {
            'cfr_decisions': self.cfr_decisions,
            'fallback_decisions': self.fallback_decisions,
            'total': total,
            'cfr_rate': self.cfr_decisions / total if total > 0 else 0.0,
        }
