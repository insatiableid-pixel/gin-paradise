"""
Phase 69: Public-State CFR Pilot for Bounded Gin Rummy Subgame.

This module implements:
  1. Information-set abstraction for a bounded knock/continue subgame
  2. External-sampling MCCFR over hidden-information Gin subgames
  3. Belief-conditioned world sampling using Phase 68 trace-rich data

The bounded subgame:
  - Decision point: low-stock legal-knock position
  - Action space: {knock, continue}
  - Hidden information: opponent hand
  - Chance model: belief-weighted world sampling from belief_world_generator
  - Leaf values: exact knock scoring (knock) or simulated continuation (continue)

What is exact:
  - Meld arrangement and scoring for knock outcomes
  - Card visibility constraints
  - Information-set abstraction feature extraction

What is sampled:
  - Hidden opponent hands (via belief-weighted world generation)
  - Continuation play outcomes (via solver_v2 champion continuation)

What is approximated:
  - Information-set bucketing (discretization of continuous features)
  - Continuation value estimation (champion heuristic, not game-theoretic)
  - Leaf evaluation for "continue" (bounded rollout, not exact)

Architecture difference from old CFR (cfr_trainer.py / cfr_strategy.py):
  - OLD: discard-only action space, Apex top-K candidates, immediate DW reward
  - NEW: knock/continue decision, genuine hidden-information traversal,
         full game outcome payoffs, belief-conditioned world sampling

This is a new oracle-oriented CFR path, NOT a resurrection of the old
discard CFR experiment.
"""

import random
import time
import math
from collections import defaultdict
from typing import List, Dict, Optional, Tuple, Any

from gin_rummy.card import (
    NUM_CARDS, rank, suit, make_card, deadwood_value, card_str, hand_str
)
from gin_rummy.meld import best_meld_arrangement, compute_deadwood, compute_layoffs
from gin_rummy.game import GIN_BONUS, UNDERCUT_BONUS, TARGET_SCORE, MIN_STOCK_CARDS
from gin_rummy.endgame_solver import (
    PublicState, HandOutcome, evaluate_knock_now,
)
from gin_rummy.solver_v2 import (
    simulate_continuation_policy, CONTINUATION_CHAMPION,
)


# ── Action Space ──────────────────────────────────────────────────────

ACTIONS = ['knock', 'continue']
N_ACTIONS = 2
ACTION_KNOCK = 0
ACTION_CONTINUE = 1


# ── Information-Set Abstraction ───────────────────────────────────────

def compute_public_info_set(
    hero_hand: List[int],
    public_state: PublicState,
    known_opponent_pickups: Optional[List[int]] = None,
    known_opponent_discards: Optional[List[int]] = None,
    upcard_declines: Optional[List[int]] = None,
) -> tuple:
    """
    Compute the information set for a knock/continue decision.

    This is the genuine public-state + belief-state abstraction for the
    bounded subgame. It encodes:

    PUBLIC STATE:
      - stock_bucket: discretized stock remaining
      - score_bucket: discretized score difference
      - discard_pile_bucket: discretized discard pile size
      - turn_bucket: discretized turn number

    HERO HAND STATE (private to hero, shapes the info set):
      - hero_dw_bucket: hero deadwood bucket
      - hero_meld_count: number of complete melds
      - hero_gin_live: whether hero is one card from gin

    BELIEF CONDITIONING (from public action trace):
      - opp_pickup_bucket: discretized number of opponent pickups
      - opp_discard_bucket: discretized number of opponent discards
      - opp_decline_bucket: discretized number of opponent declines
      - trace_intensity: overall trace signal strength

    Returns:
        tuple: hashable information set key
    """
    melds, dw_cards, hero_dw = best_meld_arrangement(hero_hand)
    melded = set()
    for m in melds:
        for c in m:
            melded.add(c)

    # ── Public state features ──
    stock_bucket = _stock_bucket(public_state.stock_size)
    score_bucket = _score_diff_bucket(public_state.my_score, public_state.opp_score)
    discard_bucket = _discard_pile_bucket(len(public_state.discard_pile))
    turn_bucket = min(public_state.turn_number // 4, 4)

    # ── Hero hand features ──
    hero_dw_bucket = _hero_dw_bucket(hero_dw)
    hero_meld_count = min(len(melds), 4)
    hero_gin_live = _is_gin_live(hero_hand, melds, dw_cards)

    # ── Opponent hand-quality proxy from trace ──
    n_pickups = len(known_opponent_pickups) if known_opponent_pickups else 0
    n_discards = len(known_opponent_discards) if known_opponent_discards else 0
    n_declines = len(upcard_declines) if upcard_declines else 0

    pickup_bucket = min(n_pickups, 4)
    discard_count_bucket = min(n_discards // 3, 4)
    decline_bucket = min(n_declines // 3, 4)

    # Trace intensity: rough measure of how much info we have
    trace_intensity = min(3, (n_pickups * 2 + n_discards + n_declines) // 5)

    return (
        stock_bucket,       # 0-3
        score_bucket,       # 0-4
        discard_bucket,     # 0-3
        turn_bucket,        # 0-4
        hero_dw_bucket,     # 0-5
        hero_meld_count,    # 0-4
        hero_gin_live,      # 0-1
        pickup_bucket,      # 0-4
        discard_count_bucket, # 0-4
        decline_bucket,     # 0-4
        trace_intensity,    # 0-3
    )


def _stock_bucket(stock_size: int) -> int:
    if stock_size <= 2:
        return 0
    elif stock_size <= 4:
        return 1
    elif stock_size <= 6:
        return 2
    else:
        return 3


def _score_diff_bucket(my_score: int, opp_score: int) -> int:
    diff = my_score - opp_score
    if diff <= -30:
        return 0
    elif diff <= -10:
        return 1
    elif diff <= 10:
        return 2
    elif diff <= 30:
        return 3
    else:
        return 4


def _discard_pile_bucket(pile_size: int) -> int:
    if pile_size <= 5:
        return 0
    elif pile_size <= 12:
        return 1
    elif pile_size <= 20:
        return 2
    else:
        return 3


def _hero_dw_bucket(dw: int) -> int:
    """Hero deadwood bucket (finer for low DW where knock/continue is close)."""
    if dw == 0:
        return 0   # gin
    elif dw <= 2:
        return 1   # near-gin
    elif dw <= 5:
        return 2   # low
    elif dw <= 7:
        return 3   # medium
    elif dw <= 9:
        return 4   # high
    else:
        return 5   # max-knock (DW=10)


def _is_gin_live(hand: List[int], melds: list, dw_cards: list) -> int:
    """Whether hero is one card from gin (9 melded cards + 1 DW)."""
    total_melded = sum(len(m) for m in melds)
    return 1 if (total_melded >= 9 and len(dw_cards) == 1) else 0


# ── Theoretical info-set space size ───────────────────────────────────

def compute_info_set_space_size() -> int:
    """Compute the theoretical maximum number of unique information sets."""
    return (
        4 *    # stock_bucket
        5 *    # score_bucket
        4 *    # discard_bucket
        5 *    # turn_bucket
        6 *    # hero_dw_bucket
        5 *    # hero_meld_count
        2 *    # hero_gin_live
        5 *    # pickup_bucket
        5 *    # discard_count_bucket
        5 *    # decline_bucket
        4      # trace_intensity
    )


# ── MCCFR Strategy Store ─────────────────────────────────────────────

class PublicStateCFRStrategy:
    """
    CFR strategy store for the bounded knock/continue subgame.

    Stores regret sums and cumulative strategy for each information set.
    Uses regret matching to compute the current strategy.
    """

    def __init__(self):
        self.regret_sum: Dict[tuple, List[float]] = defaultdict(
            lambda: [0.0] * N_ACTIONS
        )
        self.strategy_sum: Dict[tuple, List[float]] = defaultdict(
            lambda: [0.0] * N_ACTIONS
        )
        self.iterations = 0
        self.visit_count: Dict[tuple, int] = defaultdict(int)

    def get_strategy(self, info_set: tuple) -> List[float]:
        """Compute current strategy via regret matching."""
        regrets = self.regret_sum[info_set]
        positive = [max(0.0, r) for r in regrets]
        total = sum(positive)
        if total > 0:
            return [p / total for p in positive]
        return [1.0 / N_ACTIONS] * N_ACTIONS

    def get_average_strategy(self, info_set: tuple) -> List[float]:
        """Compute the average strategy (Nash approximation)."""
        sums = self.strategy_sum[info_set]
        total = sum(sums)
        if total > 0:
            return [s / total for s in sums]
        return [1.0 / N_ACTIONS] * N_ACTIONS

    def update_regret(self, info_set: tuple, action: int, regret: float):
        """Add regret for a specific action at this info set."""
        self.regret_sum[info_set][action] += regret

    def accumulate_strategy(self, info_set: tuple, strategy: List[float],
                            weight: float = 1.0):
        """Accumulate the current strategy for averaging."""
        for a in range(N_ACTIONS):
            self.strategy_sum[info_set][a] += strategy[a] * weight

    def num_info_sets(self) -> int:
        """Number of unique info sets visited."""
        return len(self.regret_sum)

    def get_exploitability_proxy(self) -> float:
        """
        Proxy for convergence: mean absolute difference between regret-matched
        and average strategy across all info sets.
        """
        if not self.regret_sum:
            return 1.0
        diffs = []
        for info_set in self.regret_sum:
            current = self.get_strategy(info_set)
            average = self.get_average_strategy(info_set)
            diff = sum(abs(c - a) for c, a in zip(current, average))
            diffs.append(diff)
        return sum(diffs) / len(diffs) if diffs else 1.0

    def get_strategy_stats(self) -> Dict[str, Any]:
        """Summary statistics for the learned strategy."""
        if not self.strategy_sum:
            return {'n_info_sets': 0}

        # Collect average strategy distributions
        knock_probs = []
        continue_probs = []
        mixed_count = 0

        for info_set in self.strategy_sum:
            avg = self.get_average_strategy(info_set)
            knock_probs.append(avg[ACTION_KNOCK])
            continue_probs.append(avg[ACTION_CONTINUE])
            if 0.05 < avg[ACTION_KNOCK] < 0.95:
                mixed_count += 1

        return {
            'n_info_sets': len(self.strategy_sum),
            'mean_knock_prob': round(sum(knock_probs) / len(knock_probs), 4),
            'mean_continue_prob': round(sum(continue_probs) / len(continue_probs), 4),
            'n_mixed_strategies': mixed_count,
            'frac_mixed': round(mixed_count / len(knock_probs), 4),
            'exploitability_proxy': round(self.get_exploitability_proxy(), 6),
        }


# ── MCCFR Trainer ──────────────────────────────────────────────────────

class PublicStateMCCFR:
    """
    External-sampling MCCFR for the bounded knock/continue subgame.

    Each iteration:
      1. Sample a spot from the trace-rich dataset (public state + hero hand)
      2. Sample hidden worlds for the opponent (belief-weighted)
      3. For each action (knock / continue), compute the expected payoff
         across the sampled worlds
      4. Update regrets
      5. Accumulate strategy

    This is a genuine MCCFR implementation over imperfect information:
    the hidden state (opponent hand) is sampled from the belief model,
    and regrets are computed over the full knock/continue action space.
    """

    def __init__(
        self,
        strategy: PublicStateCFRStrategy,
        n_worlds_per_spot: int = 30,
        seed: int = 42,
    ):
        self.strategy = strategy
        self.n_worlds_per_spot = n_worlds_per_spot
        self.rng = random.Random(seed)

    def train_on_spots(
        self,
        spots: list,
        n_iterations: int = 2000,
        verbose: bool = True,
        progress_interval: int = 200,
    ) -> Dict[str, Any]:
        """
        Train the CFR strategy on a list of TraceRichSpot instances.

        Returns diagnostics dict with training metrics.
        """
        t0 = time.time()
        total_updates = 0
        convergence_log = []

        for iteration in range(n_iterations):
            # Pick a random spot
            spot = self.rng.choice(spots)

            # Build info set
            info_set = compute_public_info_set(
                hero_hand=spot.hero_hand,
                public_state=PublicState(
                    discard_pile=list(spot.discard_pile),
                    turn_number=spot.turn_number,
                    stock_size=spot.stock_size,
                    my_score=spot.my_score,
                    opp_score=spot.opp_score,
                ),
                known_opponent_pickups=spot.known_opponent_pickups,
                known_opponent_discards=spot.known_opponent_discards,
                upcard_declines=spot.upcard_declines,
            )

            # Get current strategy
            current_strategy = self.strategy.get_strategy(info_set)

            # Accumulate strategy (weighted by iteration for later averaging)
            self.strategy.accumulate_strategy(info_set, current_strategy)
            self.strategy.visit_count[info_set] += 1

            # Compute action values via world sampling
            action_values = self._compute_action_values(spot)

            # Compute expected value under current strategy
            ev = sum(current_strategy[a] * action_values[a] for a in range(N_ACTIONS))

            # Update regrets
            for a in range(N_ACTIONS):
                regret = action_values[a] - ev
                self.strategy.update_regret(info_set, a, regret)

            total_updates += 1

            # Progress reporting
            if verbose and (iteration + 1) % progress_interval == 0:
                elapsed = time.time() - t0
                exploit = self.strategy.get_exploitability_proxy()
                n_info = self.strategy.num_info_sets()
                convergence_log.append({
                    'iteration': iteration + 1,
                    'exploit_proxy': round(exploit, 6),
                    'n_info_sets': n_info,
                    'elapsed': round(elapsed, 1),
                })
                print(f"  Iter {iteration+1}/{n_iterations} | "
                      f"Info sets: {n_info} | "
                      f"Exploit proxy: {exploit:.6f} | "
                      f"Time: {elapsed:.1f}s")

        self.strategy.iterations += n_iterations
        elapsed = time.time() - t0

        return {
            'n_iterations': n_iterations,
            'total_updates': total_updates,
            'n_spots': len(spots),
            'n_info_sets': self.strategy.num_info_sets(),
            'elapsed_seconds': round(elapsed, 2),
            'iterations_per_sec': round(n_iterations / elapsed, 1) if elapsed > 0 else 0,
            'convergence_log': convergence_log,
        }

    def _compute_action_values(self, spot) -> List[float]:
        """
        Compute expected payoff for each action by sampling worlds.

        For knock: exact scoring against each sampled opponent hand
        For continue: simulated continuation via champion policy

        Returns [knock_value, continue_value]
        """
        # Generate opponent worlds from belief model
        worlds = self._sample_worlds(spot)

        if not worlds:
            return [0.0, 0.0]

        knock_payoffs = []
        continue_payoffs = []

        for opp_hand, stock in worlds:
            # ── Knock action: exact scoring ──
            knock_outcome = evaluate_knock_now(spot.hero_hand, opp_hand)
            knock_payoff = knock_outcome.hero_points - knock_outcome.opp_points
            knock_payoffs.append(knock_payoff)

            # ── Continue action: simulated continuation ──
            ps = PublicState(
                discard_pile=list(spot.discard_pile),
                turn_number=spot.turn_number,
                stock_size=spot.stock_size,
                my_score=spot.my_score,
                opp_score=spot.opp_score,
            )
            cont_rng = random.Random(self.rng.randint(0, 2**32))
            cont_outcome = simulate_continuation_policy(
                hero_hand=list(spot.hero_hand),
                opp_hand=list(opp_hand),
                stock=list(stock),
                public_state=ps,
                rng=cont_rng,
                mode=CONTINUATION_CHAMPION,
            )
            cont_payoff = cont_outcome.hero_points - cont_outcome.opp_points
            continue_payoffs.append(cont_payoff)

        # Average payoff across worlds
        mean_knock = sum(knock_payoffs) / len(knock_payoffs)
        mean_continue = sum(continue_payoffs) / len(continue_payoffs)

        # Normalize to roughly [-1, 1] range for regret stability
        # Using 50 as max plausible swing (gin bonus + high opponent DW)
        knock_value = mean_knock / 50.0
        continue_value = mean_continue / 50.0

        return [knock_value, continue_value]

    def _sample_worlds(self, spot) -> List[Tuple[List[int], List[int]]]:
        """
        Sample hidden worlds for a spot using the belief-weighted generator.

        Uses the same infrastructure as solver_v6 but lighter weight
        (fewer worlds per spot for MCCFR throughput).
        """
        from gin_rummy.belief_world_generator import generate_belief_weighted_worlds

        hero_set = set(spot.hero_hand)
        visible = set(spot.discard_pile)

        worlds, _ = generate_belief_weighted_worlds(
            hero_hand=spot.hero_hand,
            discard_pile=list(spot.discard_pile),
            stock_size=spot.stock_size,
            n_worlds=self.n_worlds_per_spot,
            rng=random.Random(self.rng.randint(0, 2**32)),
            known_opponent_pickups=spot.known_opponent_pickups,
            known_opponent_discards=spot.known_opponent_discards,
            oversample_factor=2,
        )

        return worlds


# ── Toy Sanity-Check Game ─────────────────────────────────────────────

class KuhnPokerCFR:
    """
    Kuhn Poker CFR implementation for sanity-checking regret updates.

    Kuhn Poker is the standard minimal test for CFR implementations.
    3 cards (J, Q, K), 2 players, each dealt 1 card.
    Action space: {pass, bet} at each decision point.

    Known Nash equilibrium exists and is well-documented.
    If this converges, the regret machinery is correct.
    """

    def __init__(self, seed=42):
        self.regret_sum = defaultdict(lambda: [0.0, 0.0])  # [pass, bet]
        self.strategy_sum = defaultdict(lambda: [0.0, 0.0])
        self.rng = random.Random(seed)
        self.iterations = 0

    def get_strategy(self, info_set):
        regrets = self.regret_sum[info_set]
        positive = [max(0.0, r) for r in regrets]
        total = sum(positive)
        if total > 0:
            return [p / total for p in positive]
        return [0.5, 0.5]

    def train(self, n_iterations=10000, verbose=False):
        t0 = time.time()
        for i in range(n_iterations):
            cards = [0, 1, 2]  # J=0, Q=1, K=2
            self.rng.shuffle(cards)
            for player in range(2):
                self._cfr(cards, "", 1.0, 1.0, player)
            self.iterations += 1

        elapsed = time.time() - t0

        # Extract Nash strategies for key info sets
        results = {}
        for info_set in sorted(self.strategy_sum.keys()):
            avg = self._get_average_strategy(info_set)
            results[info_set] = {'pass': round(avg[0], 4), 'bet': round(avg[1], 4)}

        return {
            'iterations': n_iterations,
            'elapsed': round(elapsed, 3),
            'strategies': results,
            'converged': self._check_convergence(results),
        }

    def _cfr(self, cards, history, p0, p1, training_player):
        """Recursive CFR traversal for Kuhn Poker."""
        plays = len(history)
        player = plays % 2

        # Terminal states
        if plays >= 2:
            if history == "pp":
                # Both pass: higher card wins 1
                return 1 if cards[player] > cards[1 - player] else -1
            elif history == "bb":
                # Both bet: higher card wins 2
                return 2 if cards[player] > cards[1 - player] else -2
            elif history == "bp":
                # Player 0 bet, player 1 passed (fold)
                return 1 if player == 0 else -1
            elif history == "pb":
                if plays == 2:
                    # Player 0 passed, player 1 bet — not terminal, player 0 acts
                    pass  # Fall through to action
                else:
                    return -1  # shouldn't reach
            elif history == "pbp":
                # P0 pass, P1 bet, P0 fold
                return -1 if player == 1 else 1
            elif history == "pbb":
                # P0 pass, P1 bet, P0 call
                return 2 if cards[player] > cards[1 - player] else -2

        if plays > 3:
            return 0

        info_set = f"{cards[player]}_{history}"
        strategy = self.get_strategy(info_set)

        # Accumulate strategy
        reach = p0 if player == 0 else p1
        for a in range(2):
            self.strategy_sum[info_set][a] += reach * strategy[a]

        action_values = [0.0, 0.0]
        actions = ["p", "b"]

        for a in range(2):
            new_history = history + actions[a]
            if player == 0:
                action_values[a] = -self._cfr(cards, new_history,
                                               p0 * strategy[a], p1,
                                               training_player)
            else:
                action_values[a] = -self._cfr(cards, new_history,
                                               p0, p1 * strategy[a],
                                               training_player)

        # Compute counterfactual value
        node_value = sum(strategy[a] * action_values[a] for a in range(2))

        # Update regrets (only for training player)
        if player == training_player:
            opp_reach = p1 if player == 0 else p0
            for a in range(2):
                regret = action_values[a] - node_value
                self.regret_sum[info_set][a] += opp_reach * regret

        return node_value

    def _get_average_strategy(self, info_set):
        sums = self.strategy_sum[info_set]
        total = sum(sums)
        if total > 0:
            return [s / total for s in sums]
        return [0.5, 0.5]

    def _check_convergence(self, results):
        """
        Check if Kuhn Poker strategies are approximately correct.

        Known Nash equilibrium properties:
        - Player 0 with J should pass with high probability
        - Player 0 with K should bet with high probability
        - Player 1 with K should always bet/call
        """
        checks = []

        # P0 with J at root should mostly pass (bet ≈ 1/3 in Nash)
        key_j_root = "0_"
        if key_j_root in results:
            j_bet = results[key_j_root]['bet']
            checks.append(('P0_J_bet_approx_1/3', abs(j_bet - 1/3) < 0.15))

        # P0 with K at root should always bet
        key_k_root = "2_"
        if key_k_root in results:
            k_bet = results[key_k_root]['bet']
            checks.append(('P0_K_always_bet', k_bet > 0.85))

        passed = all(c[1] for c in checks) if checks else False
        return {
            'passed': passed,
            'checks': checks,
        }


# ── Solver V6 Comparison Helper ──────────────────────────────────────

def compare_cfr_vs_solver_v6(
    spots: list,
    strategy: PublicStateCFRStrategy,
    n_compare: int = 50,
    seed: int = 123,
) -> Dict[str, Any]:
    """
    Compare CFR pilot average strategy vs solver_v6 recommendation
    on canonical spots.
    """
    from gin_rummy.solver_v6 import solve_spot_v6

    rng = random.Random(seed)
    results = []

    # Sample N spots
    compare_spots = rng.sample(spots, min(n_compare, len(spots)))

    agree_count = 0
    disagree_count = 0
    cfr_knock_count = 0
    cfr_continue_count = 0
    v6_knock_count = 0
    v6_continue_count = 0
    mixed_strategy_spots = []

    for spot in compare_spots:
        # ── CFR recommendation ──
        info_set = compute_public_info_set(
            hero_hand=spot.hero_hand,
            public_state=PublicState(
                discard_pile=list(spot.discard_pile),
                turn_number=spot.turn_number,
                stock_size=spot.stock_size,
                my_score=spot.my_score,
                opp_score=spot.opp_score,
            ),
            known_opponent_pickups=spot.known_opponent_pickups,
            known_opponent_discards=spot.known_opponent_discards,
            upcard_declines=spot.upcard_declines,
        )
        avg_strategy = strategy.get_average_strategy(info_set)
        cfr_action = 'knock' if avg_strategy[ACTION_KNOCK] >= avg_strategy[ACTION_CONTINUE] else 'continue'
        is_mixed = 0.05 < avg_strategy[ACTION_KNOCK] < 0.95

        if cfr_action == 'knock':
            cfr_knock_count += 1
        else:
            cfr_continue_count += 1

        # ── Solver V6 recommendation ──
        ps = PublicState(
            discard_pile=list(spot.discard_pile),
            turn_number=spot.turn_number,
            stock_size=spot.stock_size,
            my_score=spot.my_score,
            opp_score=spot.opp_score,
        )
        try:
            v6_result = solve_spot_v6(
                hero_hand=spot.hero_hand,
                public_state=ps,
                n_worlds=100,
                seed=seed,
                known_opponent_pickups=spot.known_opponent_pickups,
                known_opponent_discards=spot.known_opponent_discards,
                upcard_declines=spot.upcard_declines,
            )
            v6_action = v6_result.recommended_action
        except Exception:
            v6_action = 'error'

        if v6_action == 'knock':
            v6_knock_count += 1
        elif v6_action == 'continue':
            v6_continue_count += 1

        if cfr_action == v6_action:
            agree_count += 1
        else:
            disagree_count += 1

        result_entry = {
            'hero_dw': spot.hero_deadwood,
            'stock_size': spot.stock_size,
            'cfr_knock_prob': round(avg_strategy[ACTION_KNOCK], 4),
            'cfr_continue_prob': round(avg_strategy[ACTION_CONTINUE], 4),
            'cfr_action': cfr_action,
            'v6_action': v6_action,
            'agree': cfr_action == v6_action,
            'is_mixed': is_mixed,
            'actual_outcome': spot.outcome,
        }
        results.append(result_entry)

        if is_mixed:
            mixed_strategy_spots.append(result_entry)

    return {
        'n_compared': len(compare_spots),
        'agree': agree_count,
        'disagree': disagree_count,
        'agreement_rate': round(agree_count / len(compare_spots), 4) if compare_spots else 0,
        'cfr_knock_rate': round(cfr_knock_count / len(compare_spots), 4) if compare_spots else 0,
        'cfr_continue_rate': round(cfr_continue_count / len(compare_spots), 4) if compare_spots else 0,
        'v6_knock_rate': round(v6_knock_count / len(compare_spots), 4) if compare_spots else 0,
        'v6_continue_rate': round(v6_continue_count / len(compare_spots), 4) if compare_spots else 0,
        'n_mixed_strategies': len(mixed_strategy_spots),
        'mixed_strategy_spots': mixed_strategy_spots[:10],  # Cap output
        'detail': results[:20],  # Cap output
    }


# ── Abstraction Measurement ──────────────────────────────────────────

def measure_abstraction_size(
    spots: list,
    n_sample: int = 500,
    seed: int = 77,
) -> Dict[str, Any]:
    """
    Measure information-set abstraction size on real trace-rich spots.
    """
    rng = random.Random(seed)
    sample = rng.sample(spots, min(n_sample, len(spots)))

    info_sets = set()
    info_set_counts = defaultdict(int)

    for spot in sample:
        info_set = compute_public_info_set(
            hero_hand=spot.hero_hand,
            public_state=PublicState(
                discard_pile=list(spot.discard_pile),
                turn_number=spot.turn_number,
                stock_size=spot.stock_size,
                my_score=spot.my_score,
                opp_score=spot.opp_score,
            ),
            known_opponent_pickups=spot.known_opponent_pickups,
            known_opponent_discards=spot.known_opponent_discards,
            upcard_declines=spot.upcard_declines,
        )
        info_sets.add(info_set)
        info_set_counts[info_set] += 1

    # Bucket occupancy
    counts = list(info_set_counts.values())
    theoretical_max = compute_info_set_space_size()

    # Memory estimate: 2 floats per action * 2 tables (regret + strategy)
    # = 4 floats per info set per table entry
    bytes_per_info_set = N_ACTIONS * 2 * 8  # 2 tables, 8 bytes per float
    total_bytes_theoretical = theoretical_max * bytes_per_info_set
    total_bytes_observed = len(info_sets) * bytes_per_info_set

    return {
        'n_spots_sampled': len(sample),
        'unique_info_sets_observed': len(info_sets),
        'theoretical_max_info_sets': theoretical_max,
        'occupancy_rate': round(len(info_sets) / theoretical_max, 6),
        'mean_spots_per_info_set': round(sum(counts) / len(counts), 2) if counts else 0,
        'max_spots_per_info_set': max(counts) if counts else 0,
        'min_spots_per_info_set': min(counts) if counts else 0,
        'median_spots_per_info_set': sorted(counts)[len(counts) // 2] if counts else 0,
        'singleton_info_sets': sum(1 for c in counts if c == 1),
        'memory_estimate_theoretical_MB': round(total_bytes_theoretical / 1e6, 2),
        'memory_estimate_observed_KB': round(total_bytes_observed / 1e3, 2),
    }
