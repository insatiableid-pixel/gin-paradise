"""
CFR Trainer: External Sampling MCCFR for Gin Rummy Discard Policy.

Uses the game engine to play out hands, collecting discard decision
points and updating CFR regrets. Training is done via self-play
between two Apex bots, where at each discard point we:

1. Compute the information set
2. Generate top-K candidates via Apex's heuristic pipeline
3. Sample an action from the current regret-matched strategy
4. Compute counterfactual values for all actions by evaluating
   the resulting deadwood after each candidate discard
5. Update regrets

This is a simplified "outcome sampling" approach where we measure
the immediate reward (deadwood reduction) rather than full game
tree traversal, which keeps training tractable while still learning
meaningful strategy improvements.
"""

import random
import time
from collections import defaultdict

from gin_rummy.card import (
    rank, suit, make_card, deadwood_value, NUM_CARDS, make_deck
)
from gin_rummy.meld import best_meld_arrangement, compute_deadwood, find_all_melds
from gin_rummy.apex import Apex
from gin_rummy.game import GinRummyGame, MIN_STOCK_CARDS, MAX_TURNS_PER_HAND
from gin_rummy.cfr_strategy import (
    CFRStrategy, compute_info_set, NUM_ACTIONS
)


class CFRTrainingApex(Apex):
    """
    Modified Apex that records discard decision points for CFR training.

    During training, this bot plays normally (using Apex logic) but at
    each discard decision, it records the state for CFR update.
    """

    def __init__(self, name="CFRTrainApex", strategy=None, training_player=False):
        super().__init__(name)
        self.strategy = strategy
        self.training_player = training_player
        self.decision_points = []  # [(info_set, candidates, chosen_idx, candidate_dws)]

    def new_hand(self, hand, opponent_id):
        super().new_hand(hand, opponent_id)
        self.decision_points = []

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        """
        Discard using CFR strategy (if training) or Apex fallback.

        Records decision points for CFR training updates.
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

        # Compute actual DW for each candidate
        candidate_dws = []
        for c in top_candidates:
            remaining = list(hand)
            remaining.remove(c)
            actual_dw = compute_deadwood(remaining)
            candidate_dws.append(actual_dw)

        # Compute info set
        info_set = compute_info_set(hand, game_state)

        # Choose action
        if self.training_player and self.strategy is not None:
            # Use regret-matched strategy with epsilon-greedy exploration
            strategy_probs = self.strategy.get_strategy(info_set)

            # Epsilon-greedy: 10% uniform exploration
            epsilon = 0.1
            probs = [(1.0 - epsilon) * p + epsilon / NUM_ACTIONS
                     for p in strategy_probs]

            # Normalize
            total = sum(probs)
            probs = [p / total for p in probs]

            # Sample action
            r = random.random()
            cumulative = 0.0
            chosen_idx = 0
            for i, p in enumerate(probs):
                cumulative += p
                if r < cumulative:
                    chosen_idx = i
                    break

            # Accumulate strategy
            self.strategy.accumulate_strategy(info_set, strategy_probs)
        else:
            # Non-training player: use Apex's pure DW minimization
            chosen_idx = 0
            best_dw = float('inf')
            best_card = top_candidates[0]
            for i, c in enumerate(top_candidates[:top_n]):
                if candidate_dws[i] < best_dw or (
                    candidate_dws[i] == best_dw and
                    deadwood_value(c) > deadwood_value(best_card)
                ):
                    best_dw = candidate_dws[i]
                    best_card = c
                    chosen_idx = i

        # Record decision point
        self.decision_points.append((info_set, top_candidates, chosen_idx, candidate_dws))

        best_card = top_candidates[chosen_idx]
        self._top_for_opp = best_card
        self._last_discard = best_card
        self.model.my_discard(best_card)
        if best_card in self.hand:
            self.hand.remove(best_card)
        return best_card


def _compute_hand_reward(game_result, player_idx):
    """
    Compute a normalized reward for a hand result.

    Returns a value in roughly [-1, 1] range.
    """
    if game_result.is_void:
        return 0.0

    if game_result.winner == player_idx:
        # Won: reward proportional to points scored
        return min(1.0, game_result.points / 50.0)
    else:
        # Lost: negative reward
        return max(-1.0, -game_result.points / 50.0)


def train_cfr(
    strategy,
    num_iterations=5000,
    hands_per_iteration=20,
    seed=42,
    verbose=True,
    progress_interval=500,
):
    """
    Train the CFR strategy via self-play.

    Each iteration:
    1. Play a batch of hands between two CFRTrainingApex bots
    2. For each discard decision point, compute counterfactual values
    3. Update regrets in the strategy table

    Args:
        strategy: CFRStrategy instance to train
        num_iterations: number of training iterations
        hands_per_iteration: hands to play per iteration
        seed: random seed for reproducibility
        verbose: whether to print progress
        progress_interval: how often to print progress

    Returns:
        strategy: the trained CFRStrategy
    """
    random.seed(seed)
    start_time = time.time()

    total_hands = 0
    total_updates = 0

    for iteration in range(num_iterations):
        # Create training bots - alternate which player trains
        training_side = iteration % 2

        p0 = CFRTrainingApex("Train0", strategy, training_player=(training_side == 0))
        p1 = CFRTrainingApex("Train1", strategy, training_player=(training_side == 1))

        game = GinRummyGame(p0, p1, target_score=100, verbose=False)

        # Play out hands
        scores = [0, 0]
        for h in range(hands_per_iteration):
            dealer = h % 2
            hand_result = game._play_hand(dealer, scores)
            total_hands += 1

            if not hand_result.is_void and hand_result.winner is not None:
                scores[hand_result.winner] += hand_result.points

            # Update CFR regrets for the training player
            training_bot = p0 if training_side == 0 else p1
            reward = _compute_hand_reward(hand_result, training_side)

            for info_set, candidates, chosen_idx, candidate_dws in training_bot.decision_points:
                # Counterfactual values: lower DW = better, so negate
                # We combine immediate DW improvement with game outcome
                chosen_dw = candidate_dws[chosen_idx]

                for a in range(NUM_ACTIONS):
                    # Immediate value: DW difference (chosen vs alternative)
                    dw_diff = chosen_dw - candidate_dws[a]  # positive = alternative is better
                    immediate_value = dw_diff / 10.0  # normalize

                    # Counterfactual regret: value of action a over chosen action
                    # Combines immediate DW advantage with game outcome signal
                    cf_value = immediate_value

                    if a == chosen_idx:
                        # The action we actually took gets the game outcome signal
                        cf_value += reward * 0.3
                    else:
                        # Alternative actions get partial game signal (discounted)
                        cf_value += reward * 0.1

                    regret = cf_value - (reward * 0.2 if a == chosen_idx else 0.0)
                    strategy.update_regret(info_set, a, regret)

                total_updates += 1

            # Reset for next hand
            p0.new_hand([], 1)
            p1.new_hand([], 0)

        strategy.iterations = iteration + 1

        if verbose and (iteration + 1) % progress_interval == 0:
            elapsed = time.time() - start_time
            info_sets = strategy.num_info_sets()
            print(f"  Iteration {iteration + 1}/{num_iterations} | "
                  f"Info sets: {info_sets} | "
                  f"Hands: {total_hands} | "
                  f"Updates: {total_updates} | "
                  f"Time: {elapsed:.1f}s")

    elapsed = time.time() - start_time
    if verbose:
        print(f"\nTraining complete:")
        print(f"  Iterations: {num_iterations}")
        print(f"  Total hands: {total_hands}")
        print(f"  Total updates: {total_updates}")
        print(f"  Unique info sets: {strategy.num_info_sets()}")
        print(f"  Training time: {elapsed:.1f}s")

    return strategy
