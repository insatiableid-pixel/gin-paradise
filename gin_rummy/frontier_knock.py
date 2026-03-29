"""
Frontier-informed knock policy variants (Phase 60).

All variants inherit from ApexMCTSClinchOnlyGoGin, preserving:
  - ApexMCTS draw search
  - Apex discard logic
  - Clinch-only mandatory exception (gin + game-winning knocks)

Each variant adds a compact rule based on the Phase 59 frontier map:
  - Gin probability threshold (estimated via greedy rollout)
  - DW-card count exceptions
  - High-liveness patience guards

The gin probability estimator is the same greedy rollout from Phase 59,
with a reduced rollout count for live gameplay performance.
"""

import random
from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.card import NUM_CARDS, deadwood_value


# ═══════════════════════════════════════════════════════════════════════
#  GIN PROBABILITY ESTIMATOR (reduced for live gameplay)
# ═══════════════════════════════════════════════════════════════════════

def estimate_gin_probability(hand, n_rollouts=50, max_horizon=6, rng=None):
    """Estimate gin probability via greedy rollout.

    Same algorithm as Phase 59's measure_gin_probability, but with
    reduced rollout count (50 vs 200) for live gameplay performance.

    The definition is unchanged: fraction of greedy rollouts that
    reach DW=0 within max_horizon draw-discard cycles.
    """
    if rng is None:
        rng = random.Random()
    known = set(hand)
    pool_base = [c for c in range(NUM_CARDS) if c not in known]
    gin_count = 0
    for _ in range(n_rollouts):
        pool = list(pool_base)
        rng.shuffle(pool)
        h = list(hand)
        pi = 0
        for _ in range(max_horizon):
            if pi >= len(pool):
                break
            draw = pool[pi]; pi += 1
            h.append(draw)
            best_disc = None; best_dw = 999
            for i, c in enumerate(h):
                rest = h[:i] + h[i+1:]
                dw = compute_deadwood(rest)
                if dw < best_dw:
                    best_dw = dw; best_disc = c
            h.remove(best_disc)
            if best_dw == 0:
                gin_count += 1
                break
    return gin_count / n_rollouts


# ═══════════════════════════════════════════════════════════════════════
#  FAMILY A: Simple Gin-Probability Threshold
# ═══════════════════════════════════════════════════════════════════════

class FrontierGinThreshold(ApexMCTSClinchOnlyGoGin):
    """
    Clinch-only + knock when gin probability is below threshold.

    Policy:
      1. Gin (DW=0): always knock
      2. Game-clinching knock: always knock
      3. Legal knock with gin_prob < T: knock
      4. Otherwise: continue

    Directly implements the Phase 59 finding that pure patience
    leaves EV on the table when gin probability is low.
    """

    def __init__(self, name=None, seed=None, target_score=100,
                 gin_prob_threshold=0.20, n_rollouts=50):
        if name is None:
            name = f"FrontierGinT{int(gin_prob_threshold*100)}"
        super().__init__(name=name, seed=seed, target_score=target_score)
        self._gin_prob_threshold = gin_prob_threshold
        self._n_rollouts = n_rollouts
        self._gp_rng = random.Random(seed)
        # Diagnostics
        self._frontier_knocks = 0
        self._frontier_continues = 0

    def knock_decision(self, hand, game_state):
        """Frontier-informed knock: knock when gin probability is low."""
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        # 1. Always knock on gin
        if my_dw == 0:
            return True

        # 2. Game-clinching knock
        my_score = game_state.get('my_score', 0)
        points_if_knock = max(1, 10 - my_dw)
        if (my_score + points_if_knock) >= self._target_score:
            return True

        # 3. Frontier rule: knock if gin probability is below threshold
        gp = estimate_gin_probability(hand, n_rollouts=self._n_rollouts,
                                       rng=self._gp_rng)
        if gp < self._gin_prob_threshold:
            self._frontier_knocks += 1
            return True

        # 4. Otherwise: continue
        self._frontier_continues += 1
        return False

    def get_frontier_stats(self):
        total = max(1, self._frontier_knocks + self._frontier_continues)
        return {
            'frontier_knocks': self._frontier_knocks,
            'frontier_continues': self._frontier_continues,
            'frontier_knock_rate': round(self._frontier_knocks / total, 3),
        }


# ═══════════════════════════════════════════════════════════════════════
#  FAMILY B: Threshold + Multi-Card Deadwood Exception
# ═══════════════════════════════════════════════════════════════════════

class FrontierMultiCard(ApexMCTSClinchOnlyGoGin):
    """
    Clinch-only + multi-card DW exception + gin probability threshold.

    Policy:
      1. Gin (DW=0): always knock
      2. Game-clinching knock: always knock
      3. Legal knock with n_dw_cards >= N: knock (multi-card DW)
      4. Legal knock with gin_prob < T: knock
      5. Otherwise: continue

    Motivated by Phase 58/59: fragmented multi-card DW hands were
    consistently strong knocks (+35 to +42 Δ). These hands have
    negligible gin probability and high undercut risk from continuing.
    """

    def __init__(self, name=None, seed=None, target_score=100,
                 gin_prob_threshold=0.20, min_dw_cards=3, n_rollouts=50):
        if name is None:
            name = f"FrontierMC{min_dw_cards}_T{int(gin_prob_threshold*100)}"
        super().__init__(name=name, seed=seed, target_score=target_score)
        self._gin_prob_threshold = gin_prob_threshold
        self._min_dw_cards = min_dw_cards
        self._n_rollouts = n_rollouts
        self._gp_rng = random.Random(seed)
        # Diagnostics
        self._multicard_knocks = 0
        self._threshold_knocks = 0
        self._frontier_continues = 0

    def knock_decision(self, hand, game_state):
        """Frontier-informed knock with multi-card DW exception."""
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        # 1. Always knock on gin
        if my_dw == 0:
            return True

        # 2. Game-clinching knock
        my_score = game_state.get('my_score', 0)
        points_if_knock = max(1, 10 - my_dw)
        if (my_score + points_if_knock) >= self._target_score:
            return True

        # 3. Multi-card DW exception: fragmented hands always knock
        if len(dw_cards) >= self._min_dw_cards:
            self._multicard_knocks += 1
            return True

        # 4. Gin probability threshold
        gp = estimate_gin_probability(hand, n_rollouts=self._n_rollouts,
                                       rng=self._gp_rng)
        if gp < self._gin_prob_threshold:
            self._threshold_knocks += 1
            return True

        # 5. Otherwise: continue
        self._frontier_continues += 1
        return False

    def get_frontier_stats(self):
        total = max(1, self._multicard_knocks + self._threshold_knocks
                    + self._frontier_continues)
        return {
            'multicard_knocks': self._multicard_knocks,
            'threshold_knocks': self._threshold_knocks,
            'frontier_continues': self._frontier_continues,
            'total_frontier_decisions': total,
            'multicard_knock_rate': round(self._multicard_knocks / total, 3),
            'threshold_knock_rate': round(self._threshold_knocks / total, 3),
        }


# ═══════════════════════════════════════════════════════════════════════
#  FAMILY C: Threshold + High-Liveness Patience Guard
# ═══════════════════════════════════════════════════════════════════════

class FrontierLivenessGuard(ApexMCTSClinchOnlyGoGin):
    """
    Clinch-only + gin probability threshold + high-liveness patience guard.

    Policy:
      1. Gin (DW=0): always knock
      2. Game-clinching knock: always knock
      3. Legal knock with gin_prob >= H AND dw >= D: continue (patience guard)
      4. Legal knock with gin_prob < T: knock
      5. Otherwise: continue

    The patience guard encodes: "connected / gin-live high-DW hands
    want patience" from Phase 59, without hard-coding many cases.
    """

    def __init__(self, name=None, seed=None, target_score=100,
                 gin_prob_threshold=0.20, liveness_guard=0.40,
                 guard_min_dw=6, n_rollouts=50):
        if name is None:
            name = f"FrontierLG{int(liveness_guard*100)}_T{int(gin_prob_threshold*100)}"
        super().__init__(name=name, seed=seed, target_score=target_score)
        self._gin_prob_threshold = gin_prob_threshold
        self._liveness_guard = liveness_guard
        self._guard_min_dw = guard_min_dw
        self._n_rollouts = n_rollouts
        self._gp_rng = random.Random(seed)
        # Diagnostics
        self._guarded_continues = 0
        self._threshold_knocks = 0
        self._frontier_continues = 0

    def knock_decision(self, hand, game_state):
        """Frontier-informed knock with high-liveness patience guard."""
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        # 1. Always knock on gin
        if my_dw == 0:
            return True

        # 2. Game-clinching knock
        my_score = game_state.get('my_score', 0)
        points_if_knock = max(1, 10 - my_dw)
        if (my_score + points_if_knock) >= self._target_score:
            return True

        # 3+4: Need gin probability for both guard and threshold
        gp = estimate_gin_probability(hand, n_rollouts=self._n_rollouts,
                                       rng=self._gp_rng)

        # 3. High-liveness patience guard
        if gp >= self._liveness_guard and my_dw >= self._guard_min_dw:
            self._guarded_continues += 1
            return False

        # 4. Gin probability threshold: knock if low gin chances
        if gp < self._gin_prob_threshold:
            self._threshold_knocks += 1
            return True

        # 5. Otherwise: continue
        self._frontier_continues += 1
        return False

    def get_frontier_stats(self):
        total = max(1, self._guarded_continues + self._threshold_knocks
                    + self._frontier_continues)
        return {
            'guarded_continues': self._guarded_continues,
            'threshold_knocks': self._threshold_knocks,
            'frontier_continues': self._frontier_continues,
            'total_frontier_decisions': total,
            'guarded_rate': round(self._guarded_continues / total, 3),
            'threshold_knock_rate': round(self._threshold_knocks / total, 3),
        }
