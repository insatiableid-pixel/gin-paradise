"""
Solver Probe Knock Variants (Phase 64).

Three simple solver-aligned knock probes, all inheriting from the current
champion (ApexMCTSClinchOnlyGoGin).  Each preserves all draw/discard logic
and only overrides knock_decision in the low-stock region (stock <= 6).

Variant A — Broad Probe:
  If stock <= 6 and legal knock (DW <= 10): knock.
  Otherwise: champion policy.

Variant B — DW-Aware Probe:
  If stock <= 6 and legal knock and DW >= 3: knock.
  Otherwise: champion policy.

Variant C — Texture-Aware Probe:
  If stock <= 6 and legal knock and hand is fragmented (>= 2 DW cards): knock.
  Otherwise: champion policy.

All are maximally simple.  No gin-probability rollouts, no extra computation.
"""

from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin
from gin_rummy.meld import best_meld_arrangement


class SolverProbeBroad(ApexMCTSClinchOnlyGoGin):
    """Variant A: Broad low-stock knock probe.

    If stock <= 6 and legal knock: always knock.
    Otherwise: champion policy (gin + clinch only).
    """

    def __init__(self, name="SolverProbeBroad", seed=None, target_score=100):
        super().__init__(name=name, seed=seed, target_score=target_score)
        # Diagnostics
        self._probe_knocks = 0
        self._probe_skips = 0

    def knock_decision(self, hand, game_state):
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        # Always knock on gin
        if my_dw == 0:
            return True

        # Game-clinching knock
        my_score = game_state.get('my_score', 0)
        points_if_knock = max(1, 10 - my_dw)
        if (my_score + points_if_knock) >= self._target_score:
            return True

        # PROBE: low-stock override — knock whenever legal
        deck_remaining = game_state.get('deck_remaining', 30)
        # stock <= 6 means deck_remaining <= 6
        if deck_remaining <= 6:
            self._probe_knocks += 1
            return True

        # Outside low-stock: champion behavior (never knock)
        self._probe_skips += 1
        return False

    def get_probe_stats(self):
        total = max(1, self._probe_knocks + self._probe_skips)
        return {
            'probe_knocks': self._probe_knocks,
            'probe_skips': self._probe_skips,
            'probe_knock_rate': round(self._probe_knocks / total, 3),
        }


class SolverProbeDWAware(ApexMCTSClinchOnlyGoGin):
    """Variant B: DW-aware low-stock knock probe.

    If stock <= 6 and legal knock and DW >= 3: knock.
    Otherwise: champion policy (gin + clinch only).
    """

    def __init__(self, name="SolverProbeDW3", seed=None, target_score=100,
                 dw_threshold=3):
        super().__init__(name=name, seed=seed, target_score=target_score)
        self._dw_threshold = dw_threshold
        # Diagnostics
        self._probe_knocks = 0
        self._probe_skips = 0

    def knock_decision(self, hand, game_state):
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        # Always knock on gin
        if my_dw == 0:
            return True

        # Game-clinching knock
        my_score = game_state.get('my_score', 0)
        points_if_knock = max(1, 10 - my_dw)
        if (my_score + points_if_knock) >= self._target_score:
            return True

        # PROBE: low-stock + DW threshold override
        deck_remaining = game_state.get('deck_remaining', 30)
        if deck_remaining <= 6 and my_dw >= self._dw_threshold:
            self._probe_knocks += 1
            return True

        # Outside probe region: champion behavior
        self._probe_skips += 1
        return False

    def get_probe_stats(self):
        total = max(1, self._probe_knocks + self._probe_skips)
        return {
            'probe_knocks': self._probe_knocks,
            'probe_skips': self._probe_skips,
            'probe_knock_rate': round(self._probe_knocks / total, 3),
        }


class SolverProbeTextureAware(ApexMCTSClinchOnlyGoGin):
    """Variant C: Texture-aware low-stock knock probe.

    If stock <= 6 and legal knock and hand is fragmented
    (>= min_dw_cards deadwood cards): knock.
    Otherwise: champion policy (gin + clinch only).

    A hand with >= 2 deadwood cards is considered fragmented/multi-card DW.
    This targets the Phase 62/63 cluster of fragmented medium-DW hands.
    """

    def __init__(self, name="SolverProbeTexture", seed=None, target_score=100,
                 min_dw_cards=2):
        super().__init__(name=name, seed=seed, target_score=target_score)
        self._min_dw_cards = min_dw_cards
        # Diagnostics
        self._probe_knocks = 0
        self._probe_skips = 0

    def knock_decision(self, hand, game_state):
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        # Always knock on gin
        if my_dw == 0:
            return True

        # Game-clinching knock
        my_score = game_state.get('my_score', 0)
        points_if_knock = max(1, 10 - my_dw)
        if (my_score + points_if_knock) >= self._target_score:
            return True

        # PROBE: low-stock + fragmented texture override
        deck_remaining = game_state.get('deck_remaining', 30)
        if deck_remaining <= 6 and len(dw_cards) >= self._min_dw_cards:
            self._probe_knocks += 1
            return True

        # Outside probe region: champion behavior
        self._probe_skips += 1
        return False

    def get_probe_stats(self):
        total = max(1, self._probe_knocks + self._probe_skips)
        return {
            'probe_knocks': self._probe_knocks,
            'probe_skips': self._probe_skips,
            'probe_knock_rate': round(self._probe_knocks / total, 3),
        }
