"""
Action-Conditioned Draw Dataset Generator.

Runs ApexMCTS vs ApexMCTS self-play and at each draw decision:
  1. Snapshots the draw-decision state
  2. Encodes action features for that state
  3. Evaluates both draw actions (take vs stock) via paired MC continuations
  4. Records a paired label: action_delta = P(win|take) - P(win|stock)

The label generation uses a tractable approximation:
  - For each draw state, sample N_WORLDS worlds
  - For each world, simulate a short rollout for TAKE and STOCK
  - Use post-rollout deadwood as a proxy for win probability
  - action_delta = avg(stock_dw - take_dw) / normalization
  - take_better = 1 if action_delta > 0 (take has lower DW) else 0

This paired structure ensures the label is aligned with the actual
draw decision, not generic state quality.

Usage:
  python tools/generate_action_data.py [--games N] [--seed S] [--output PATH]
"""

import argparse
import os
import sys
import time
import random

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from gin_rummy.card import NUM_CARDS, make_deck, deadwood_value
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.action_features import encode_draw_action, ACTION_FEATURE_DIM
from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.game import GinRummyGame, TARGET_SCORE, MIN_STOCK_CARDS, MAX_TURNS_PER_HAND
from gin_rummy.draw_search import _best_discard_dw, _get_hand_after_best_discard, _rollout_dw

# Label generation parameters
LABEL_WORLDS = 12       # Worlds to sample for paired MC label
LABEL_DEPTH = 2         # Rollout depth for each world
INFO_PENALTY_DW = 1.5   # DW penalty for taking (info reveal)
DW_NORM = 30.0          # Normalization constant for DW delta


class ActionInstrumentedApexMCTS(ApexMCTS):
    """
    ApexMCTS that captures paired draw-decision labels via MC evaluation.

    At each draw decision point, records:
      - action features
      - paired MC evaluation of take vs stock
    """

    def __init__(self, player_idx, name="ActionInstrumentedApexMCTS", seed=None,
                 label_worlds=LABEL_WORLDS, label_depth=LABEL_DEPTH):
        super().__init__(name=name, seed=seed)
        self.player_idx = player_idx
        self._label_worlds = label_worlds
        self._label_depth = label_depth
        self._label_rng = random.Random(seed)
        self._all_data = []     # (features, action_delta, take_better)
        self._record_count = 0
        self._skip_count = 0

    def draw_decision(self, top_discard, hand, game_state):
        """Override to capture paired labels before making the decision."""
        # Update state (mirror ApexMCTS behavior)
        self.hand = list(hand)
        self.model.update_my_hand(self.hand)
        self.turn = game_state['turn_number']
        self.my_score = game_state.get('my_score', 0)
        self.opp_score = game_state.get('opp_score', 0)

        for c in game_state.get('discard_pile', []):
            self.discard_pile_cards.add(c)
            if c not in self.hand:
                self.model.set_discard(c)

        # Record the draw decision
        self._record_draw_decision(hand, top_discard, game_state)

        # Now make the actual decision via ApexMCTS
        # Re-call the parent but skip re-updating state
        apex_decision = self._apex_draw_decision(top_discard, hand, game_state)

        from gin_rummy.draw_search import evaluate_draw_choice
        should_take, take_ev, stock_ev, diag = evaluate_draw_choice(
            hand=hand, top_discard=top_discard,
            opponent_model=self.model, game_state=game_state,
            num_worlds=self._num_worlds, rollout_depth=self._rollout_depth,
            info_penalty=self._info_penalty, rng=self._search_rng,
            use_weighted_worlds=False,
        )

        self._search_count += 1

        if diag.get('skipped'):
            self._skip_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

        margin = diag.get('margin', 0.0)
        search_decision = should_take

        if search_decision == apex_decision:
            self._agree_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

        abs_margin = abs(margin)
        if abs_margin >= self._override_margin:
            self._override_count += 1
            if search_decision:
                self._last_discard = None
            return search_decision
        else:
            self._fallback_count += 1
            if apex_decision:
                self._last_discard = None
            return apex_decision

    def _record_draw_decision(self, hand, top_discard, game_state):
        """Encode features and generate paired MC label for this draw decision."""
        if len(hand) != 10:
            return

        try:
            features = encode_draw_action(
                hand=hand,
                top_discard=top_discard,
                game_state=game_state,
                opponent_model=self.model,
            )
        except Exception:
            self._skip_count += 1
            return

        # Generate paired MC label
        action_delta = self._generate_paired_label(hand, top_discard, game_state)
        if action_delta is None:
            self._skip_count += 1
            return

        take_better = 1.0 if action_delta > 0 else 0.0
        self._all_data.append((features, action_delta, take_better))
        self._record_count += 1

    def _generate_paired_label(self, hand, top_discard, game_state):
        """
        Generate a paired MC label: action_delta = advantage of take over stock.

        Positive action_delta → take is better (lower DW)
        Negative → stock is better

        Uses the same paired MC approach as the draw search but captures
        the raw DW difference as a continuous label.
        """
        unseen = self.model.sample_unseen_cards()
        if len(unseen) < 3:
            return None

        take_dw_sum = 0.0
        stock_dw_sum = 0.0
        worlds_evaluated = 0

        for _ in range(self._label_worlds):
            # Sample world: shuffle unseen cards
            shuffled = list(unseen)
            self._label_rng.shuffle(shuffled)

            # === Take from discard ===
            take_hand = list(hand) + [top_discard]
            rollout_hand_take = _get_hand_after_best_discard(take_hand, restricted=top_discard)
            take_rollout_dw = _rollout_dw(rollout_hand_take, shuffled, self._label_depth, self._label_rng)

            # === Draw from stock ===
            if not shuffled:
                continue
            stock_card = shuffled[0]
            stock_hand = list(hand) + [stock_card]
            rollout_hand_stock = _get_hand_after_best_discard(stock_hand, restricted=None)
            remaining = shuffled[1:]
            stock_rollout_dw = _rollout_dw(rollout_hand_stock, remaining, self._label_depth, self._label_rng)

            take_dw_sum += take_rollout_dw
            stock_dw_sum += stock_rollout_dw
            worlds_evaluated += 1

        if worlds_evaluated == 0:
            return None

        take_ev = take_dw_sum / worlds_evaluated
        stock_ev = stock_dw_sum / worlds_evaluated

        # Apply info penalty for taking
        adjusted_take_ev = take_ev + INFO_PENALTY_DW

        # action_delta: positive = take is better (lower adjusted DW)
        action_delta = (stock_ev - adjusted_take_ev) / DW_NORM

        return action_delta

    def get_data(self):
        """Return (X, action_deltas, take_better) arrays."""
        if not self._all_data:
            return (np.empty((0, ACTION_FEATURE_DIM), dtype=np.float32),
                    np.empty(0, dtype=np.float32),
                    np.empty(0, dtype=np.float32))
        X = np.array([d[0] for d in self._all_data], dtype=np.float32)
        deltas = np.array([d[1] for d in self._all_data], dtype=np.float32)
        labels = np.array([d[2] for d in self._all_data], dtype=np.float32)
        return X, deltas, labels

    def reset_data(self):
        self._all_data.clear()
        self._record_count = 0
        self._skip_count = 0


def generate_action_dataset(n_games, target_score, seed, verbose=False):
    """
    Run self-play and generate action-conditioned draw dataset.

    Returns (X, action_deltas, take_better, metadata)
    """
    rng = random.Random(seed)

    p0 = ActionInstrumentedApexMCTS(0, name="AMCTS_P0", seed=rng.randint(0, 2**31))
    p1 = ActionInstrumentedApexMCTS(1, name="AMCTS_P1", seed=rng.randint(0, 2**31))

    wins = [0, 0]
    total_hands = 0
    start_time = time.time()

    for game_idx in range(n_games):
        random.seed(rng.randint(0, 2**31))
        game = GinRummyGame(p0, p1, target_score=target_score, verbose=False)
        result = game.play_game()

        winner = result.winner
        wins[winner] += 1
        total_hands += result.hands_played

        if verbose and (game_idx + 1) % 100 == 0:
            elapsed = time.time() - start_time
            rate = (game_idx + 1) / elapsed
            print(f"  Game {game_idx + 1}/{n_games} ({rate:.1f} games/sec) "
                  f"P0: {p0._record_count} samples, P1: {p1._record_count} samples")

    X0, d0, l0 = p0.get_data()
    X1, d1, l1 = p1.get_data()

    if len(X0) > 0 and len(X1) > 0:
        X = np.concatenate([X0, X1], axis=0)
        deltas = np.concatenate([d0, d1], axis=0)
        labels = np.concatenate([l0, l1], axis=0)
    elif len(X0) > 0:
        X, deltas, labels = X0, d0, l0
    else:
        X, deltas, labels = X1, d1, l1

    elapsed = time.time() - start_time

    metadata = {
        'n_games': n_games,
        'target_score': target_score,
        'seed': seed,
        'total_samples': len(labels),
        'total_hands': total_hands,
        'p0_wins': wins[0],
        'p1_wins': wins[1],
        'take_better_rate': float(np.mean(labels)) if len(labels) > 0 else 0,
        'mean_action_delta': float(np.mean(deltas)) if len(deltas) > 0 else 0,
        'std_action_delta': float(np.std(deltas)) if len(deltas) > 0 else 0,
        'feature_dim': ACTION_FEATURE_DIM,
        'label_worlds': LABEL_WORLDS,
        'label_depth': LABEL_DEPTH,
        'info_penalty': INFO_PENALTY_DW,
        'generation_time_sec': round(elapsed, 1),
        'p0_skips': p0._skip_count,
        'p1_skips': p1._skip_count,
        'source_policy': 'ApexMCTS',
    }

    return X, deltas, labels, metadata


def main():
    parser = argparse.ArgumentParser(description="Generate action-conditioned draw training data")
    parser.add_argument("--games", type=int, default=2000,
                        help="Number of games to play (default: 2000)")
    parser.add_argument("--target", type=int, default=100,
                        help="Target score per game (default: 100)")
    parser.add_argument("--seed", type=int, default=20260317,
                        help="Random seed (default: 20260317)")
    parser.add_argument("--output", type=str, default=None,
                        help="Output file path (default: models/draw_action_data.npz)")
    args = parser.parse_args()

    output_path = args.output or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "draw_action_data.npz"
    )

    print("=" * 60)
    print("  ACTION-CONDITIONED DRAW DATA GENERATOR")
    print("=" * 60)
    print(f"  Games:          {args.games}")
    print(f"  Target score:   {args.target}")
    print(f"  Seed:           {args.seed}")
    print(f"  Output:         {output_path}")
    print(f"  Feature dim:    {ACTION_FEATURE_DIM}")
    print(f"  Label worlds:   {LABEL_WORLDS}")
    print(f"  Label depth:    {LABEL_DEPTH}")
    print(f"  Info penalty:   {INFO_PENALTY_DW}")
    print("=" * 60)

    X, deltas, labels, metadata = generate_action_dataset(
        n_games=args.games,
        target_score=args.target,
        seed=args.seed,
        verbose=True,
    )

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    np.savez_compressed(
        output_path,
        X=X,
        action_deltas=deltas,
        take_better=labels,
        metadata=np.array([str(metadata)]),
    )

    print()
    print("=" * 60)
    print("  GENERATION COMPLETE")
    print("=" * 60)
    print(f"  Total samples:       {metadata['total_samples']:,}")
    print(f"  Total hands:         {metadata['total_hands']:,}")
    print(f"  Feature dim:         {metadata['feature_dim']}")
    print(f"  Take-better rate:    {metadata['take_better_rate']:.3f}")
    print(f"  Mean action delta:   {metadata['mean_action_delta']:.4f}")
    print(f"  Std action delta:    {metadata['std_action_delta']:.4f}")
    print(f"  Generation time:     {metadata['generation_time_sec']:.1f}s")
    print(f"  P0 skips:            {metadata['p0_skips']}")
    print(f"  P1 skips:            {metadata['p1_skips']}")
    print(f"  Output:              {output_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
