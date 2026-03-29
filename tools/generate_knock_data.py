"""
Knock Decision Dataset Generator.

Runs ApexMCTS vs ApexMCTS self-play and at each legal knock decision:
  1. Snapshots the 10-card post-discard hand state
  2. Encodes knock features
  3. Evaluates both actions via paired MC continuations:
     - knock now: score the hand against sampled opponent hands
     - continue:  simulate rest of hand under fixed policy
  4. Records a paired label comparing expected outcomes

Because knock states are rarer than draw/discard states, we spend more
compute per label (more MC samples) for higher fidelity.

Usage:
  python tools/generate_knock_data.py [--games N] [--seed S] [--output PATH]
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
from gin_rummy.meld import best_meld_arrangement, compute_deadwood, compute_layoffs
from gin_rummy.knock_features import encode_knock_decision, KNOCK_FEATURE_DIM
from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.game import GinRummyGame, TARGET_SCORE, MIN_STOCK_CARDS, GIN_BONUS, UNDERCUT_BONUS
from gin_rummy.draw_search import _best_discard_dw, _get_hand_after_best_discard, _rollout_dw

# Label generation parameters
LABEL_SAMPLES = 30       # MC samples for knock/continue evaluation (higher fidelity)
CONTINUE_DEPTH = 4       # Rollout depth for continuation evaluation
SCORE_NORM = 50.0        # Normalization for point delta


class KnockInstrumentedApexMCTS(ApexMCTS):
    """
    ApexMCTS that captures paired knock-decision labels via MC evaluation.

    At each legal knock decision point, records:
      - knock features
      - paired MC evaluation of knock vs continue
    """

    def __init__(self, player_idx, name="KnockInstrumentedApexMCTS", seed=None,
                 label_samples=LABEL_SAMPLES, continue_depth=CONTINUE_DEPTH):
        super().__init__(name=name, seed=seed)
        self.player_idx = player_idx
        self._label_samples = label_samples
        self._continue_depth = continue_depth
        self._label_rng = random.Random(seed)
        self._all_data = []     # (features, point_delta, knock_better)
        self._record_count = 0
        self._skip_count = 0
        self._gin_count = 0
        self._non_gin_count = 0

    def knock_decision(self, hand, game_state):
        """Override to capture paired labels before making the decision."""
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw > 10:
            return False

        # Record the knock decision data point
        self._record_knock_decision(hand, game_state, melds, dw_cards, my_dw)

        # Make the actual decision via Apex's logic
        return super().knock_decision(hand, game_state)

    def _record_knock_decision(self, hand, game_state, melds, dw_cards, my_dw):
        """Encode features and generate paired MC label for this knock decision."""
        if len(hand) != 10:
            self._skip_count += 1
            return

        try:
            features = encode_knock_decision(
                hand=hand,
                game_state=game_state,
                opponent_model=self.model,
            )
        except Exception:
            self._skip_count += 1
            return

        # Generate paired MC label
        point_delta = self._generate_paired_label(hand, game_state, melds, dw_cards, my_dw)
        if point_delta is None:
            self._skip_count += 1
            return

        knock_better = 1.0 if point_delta > 0 else 0.0
        self._all_data.append((features, point_delta, knock_better))
        self._record_count += 1

        if my_dw == 0:
            self._gin_count += 1
        else:
            self._non_gin_count += 1

    def _generate_paired_label(self, hand, game_state, melds, dw_cards, my_dw):
        """
        Generate a paired MC label: point_delta = advantage of knocking now.

        Positive point_delta → knock is better (gains more points)
        Negative → continue is better

        Evaluation:
        - knock now: MC over sampled opponent hands, compute expected knock score
        - continue: rollout for several turns, check if we reach gin or
          better knock, compute expected outcome
        """
        unseen = self.model.sample_unseen_cards()
        if len(unseen) < 3:
            return None

        knock_ev_sum = 0.0
        continue_ev_sum = 0.0
        worlds_evaluated = 0

        for _ in range(self._label_samples):
            # Sample a plausible world
            shuffled = list(unseen)
            self._label_rng.shuffle(shuffled)

            # === Evaluate: KNOCK NOW ===
            knock_ev = self._evaluate_knock_now(hand, melds, dw_cards, my_dw, shuffled)

            # === Evaluate: CONTINUE ===
            continue_ev = self._evaluate_continue(hand, my_dw, shuffled, game_state)

            knock_ev_sum += knock_ev
            continue_ev_sum += continue_ev
            worlds_evaluated += 1

        if worlds_evaluated == 0:
            return None

        avg_knock = knock_ev_sum / worlds_evaluated
        avg_continue = continue_ev_sum / worlds_evaluated

        # point_delta: positive = knock is better
        point_delta = (avg_knock - avg_continue) / SCORE_NORM

        return point_delta

    def _evaluate_knock_now(self, hand, melds, dw_cards, my_dw, shuffled_unseen):
        """
        Evaluate expected points from knocking now.

        Score the knock against a sampled opponent hand:
        - If gin: GIN_BONUS + opponent DW
        - If knock wins: opponent DW - my DW
        - If undercut: -(UNDERCUT_BONUS + my DW - opponent DW)
        """
        # Sample opponent hand from unseen cards
        opp_hand = shuffled_unseen[:10] if len(shuffled_unseen) >= 10 else shuffled_unseen

        if not opp_hand:
            return 0.0

        opp_melds, opp_dw_cards, opp_dw = best_meld_arrangement(opp_hand)

        if my_dw == 0:
            # Gin: no layoffs allowed
            return float(GIN_BONUS + opp_dw)

        # Non-gin knock: compute layoffs
        layoff_cards = compute_layoffs(melds, opp_dw_cards)
        opp_dw_after = opp_dw - sum(deadwood_value(c) for c in layoff_cards)
        opp_dw_after = max(0, opp_dw_after)

        if my_dw < opp_dw_after:
            # Knock wins
            return float(opp_dw_after - my_dw)
        else:
            # Undercut
            return -float(UNDERCUT_BONUS + my_dw - opp_dw_after)

    def _evaluate_continue(self, hand, my_dw, shuffled_unseen, game_state):
        """
        Evaluate expected points from continuing to play.

        Simulate a short continuation:
        1. Draw from stock, discard best, repeat for CONTINUE_DEPTH turns
        2. After continuation, evaluate the final hand:
           - If gin: score as gin
           - If knockable: score as knock against sampled opponent
           - If not knockable: score as 0 (hand void / no knock)
        """
        # Rollout: draw-discard cycles
        current_hand = list(hand)
        stock_idx = 0
        turns_played = 0

        for _ in range(self._continue_depth):
            if stock_idx >= len(shuffled_unseen):
                break
            drawn = shuffled_unseen[stock_idx]
            stock_idx += 1
            hand_11 = current_hand + [drawn]
            current_hand = _get_hand_after_best_discard(hand_11, restricted=None)
            turns_played += 1

            # Check if we hit gin mid-rollout
            post_dw = compute_deadwood(current_hand)
            if post_dw == 0:
                # Gin during continuation: sample opponent for scoring
                remaining = shuffled_unseen[stock_idx:]
                opp_hand = remaining[:10] if len(remaining) >= 10 else remaining
                if opp_hand:
                    _, _, opp_dw = best_meld_arrangement(opp_hand)
                    return float(GIN_BONUS + opp_dw)
                return float(GIN_BONUS)

        # After rollout, evaluate the final hand
        final_melds, final_dw_cards, final_dw = best_meld_arrangement(current_hand)

        if final_dw > 10:
            # Can't knock after continuation: net 0 (conservative)
            # In reality could still be non-zero but we need a baseline
            return 0.0

        # Can knock: evaluate against sampled opponent
        # Use remaining unseen cards for opponent
        remaining = shuffled_unseen[stock_idx:]
        opp_hand = remaining[:10] if len(remaining) >= 10 else remaining
        if not opp_hand:
            return 0.0

        opp_melds, opp_dw_cards, opp_dw = best_meld_arrangement(opp_hand)

        if final_dw == 0:
            return float(GIN_BONUS + opp_dw)

        layoff_cards = compute_layoffs(final_melds, opp_dw_cards)
        opp_dw_after = opp_dw - sum(deadwood_value(c) for c in layoff_cards)
        opp_dw_after = max(0, opp_dw_after)

        if final_dw < opp_dw_after:
            return float(opp_dw_after - final_dw)
        else:
            return -float(UNDERCUT_BONUS + final_dw - opp_dw_after)

    def get_data(self):
        """Return (X, point_deltas, knock_better) arrays."""
        if not self._all_data:
            return (np.empty((0, KNOCK_FEATURE_DIM), dtype=np.float32),
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
        self._gin_count = 0
        self._non_gin_count = 0


def generate_knock_dataset(n_games, target_score, seed, verbose=False):
    """
    Run self-play and generate knock-decision dataset.

    Returns (X, point_deltas, knock_better, metadata)
    """
    rng = random.Random(seed)

    p0 = KnockInstrumentedApexMCTS(0, name="KMCTS_P0", seed=rng.randint(0, 2**31))
    p1 = KnockInstrumentedApexMCTS(1, name="KMCTS_P1", seed=rng.randint(0, 2**31))

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
        'knock_better_rate': float(np.mean(labels)) if len(labels) > 0 else 0,
        'mean_point_delta': float(np.mean(deltas)) if len(deltas) > 0 else 0,
        'std_point_delta': float(np.std(deltas)) if len(deltas) > 0 else 0,
        'feature_dim': KNOCK_FEATURE_DIM,
        'label_samples': LABEL_SAMPLES,
        'continue_depth': CONTINUE_DEPTH,
        'generation_time_sec': round(elapsed, 1),
        'p0_skips': p0._skip_count,
        'p1_skips': p1._skip_count,
        'p0_gin_states': p0._gin_count,
        'p0_non_gin_states': p0._non_gin_count,
        'p1_gin_states': p1._gin_count,
        'p1_non_gin_states': p1._non_gin_count,
        'source_policy': 'ApexMCTS',
    }

    return X, deltas, labels, metadata


def main():
    parser = argparse.ArgumentParser(description="Generate knock decision training data")
    parser.add_argument("--games", type=int, default=3000,
                        help="Number of games to play (default: 3000)")
    parser.add_argument("--target", type=int, default=100,
                        help="Target score per game (default: 100)")
    parser.add_argument("--seed", type=int, default=20260318,
                        help="Random seed (default: 20260318)")
    parser.add_argument("--output", type=str, default=None,
                        help="Output file path (default: models/knock_action_data.npz)")
    args = parser.parse_args()

    output_path = args.output or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "knock_action_data.npz"
    )

    print("=" * 60)
    print("  KNOCK DECISION DATA GENERATOR")
    print("=" * 60)
    print(f"  Games:          {args.games}")
    print(f"  Target score:   {args.target}")
    print(f"  Seed:           {args.seed}")
    print(f"  Output:         {output_path}")
    print(f"  Feature dim:    {KNOCK_FEATURE_DIM}")
    print(f"  Label samples:  {LABEL_SAMPLES}")
    print(f"  Continue depth: {CONTINUE_DEPTH}")
    print("=" * 60)

    X, deltas, labels, metadata = generate_knock_dataset(
        n_games=args.games,
        target_score=args.target,
        seed=args.seed,
        verbose=True,
    )

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    np.savez_compressed(
        output_path,
        X=X,
        point_deltas=deltas,
        knock_better=labels,
        metadata=np.array([str(metadata)]),
    )

    print()
    print("=" * 60)
    print("  GENERATION COMPLETE")
    print("=" * 60)
    print(f"  Total samples:       {metadata['total_samples']:,}")
    print(f"  Total hands:         {metadata['total_hands']:,}")
    print(f"  Feature dim:         {metadata['feature_dim']}")
    print(f"  Knock-better rate:   {metadata['knock_better_rate']:.3f}")
    print(f"  Mean point delta:    {metadata['mean_point_delta']:.4f}")
    print(f"  Std point delta:     {metadata['std_point_delta']:.4f}")
    print(f"  Gin states (P0):     {metadata['p0_gin_states']}")
    print(f"  Non-gin states (P0): {metadata['p0_non_gin_states']}")
    print(f"  Gin states (P1):     {metadata['p1_gin_states']}")
    print(f"  Non-gin states (P1): {metadata['p1_non_gin_states']}")
    print(f"  Generation time:     {metadata['generation_time_sec']:.1f}s")
    print(f"  Output:              {output_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
