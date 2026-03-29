"""
Self-play dataset generator for match-equity value model training.

Runs ApexMCTS vs ApexMCTS self-play and records every decision point's
public belief state features alongside the eventual game outcome.

Dataset format (numpy .npz):
  - X: float32 array of shape (N, FEATURE_DIM) — PBS feature vectors
  - y: float32 array of shape (N,) — binary game outcome (1.0 = acting player wins)
  - metadata: dict with generation parameters

Usage:
  python tools/generate_value_data.py [--games N] [--target T] [--seed S] [--output PATH]
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
from gin_rummy.meld import best_meld_arrangement
from gin_rummy.pbs_features import encode_pbs, FEATURE_DIM
from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.game import GinRummyGame, TARGET_SCORE, MIN_STOCK_CARDS, MAX_TURNS_PER_HAND


class InstrumentedApexMCTS(ApexMCTS):
    """
    ApexMCTS subclass that records PBS feature snapshots at each decision point.

    After each game, call finalize_game(winner_idx) to label all snapshots
    with the game outcome.
    """

    def __init__(self, player_idx, name="InstrumentedApexMCTS", seed=None):
        super().__init__(name=name, seed=seed)
        self.player_idx = player_idx
        self._snapshots = []    # (features, player_idx) tuples for current game
        self._all_data = []     # (features, label) finalized data

    def draw_decision(self, top_discard, hand, game_state):
        # Record pre-draw snapshot
        self._record_snapshot(hand, game_state)
        return super().draw_decision(top_discard, hand, game_state)

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        # Record pre-discard snapshot (11-card hand — use 10-card snapshot from draw)
        # Don't double-record; draw already captured this decision point
        return super().discard_decision(hand, drew_from_discard, drawn_card, game_state)

    def knock_decision(self, hand, game_state):
        # Record knock decision point
        self._record_snapshot(hand, game_state)
        return super().knock_decision(hand, game_state)

    def _record_snapshot(self, hand, game_state):
        """Encode current state and store for later labeling."""
        if len(hand) != 10:
            return  # Only record from 10-card hands
        try:
            features = encode_pbs(hand, game_state)
            self._snapshots.append((features, self.player_idx))
        except Exception:
            pass  # Don't crash data generation on encoding errors

    def finalize_game(self, winner_idx):
        """Label all snapshots from the completed game."""
        for features, pidx in self._snapshots:
            label = 1.0 if pidx == winner_idx else 0.0
            self._all_data.append((features, label))
        self._snapshots.clear()

    def get_data(self):
        """Return (X, y) arrays of all finalized data."""
        if not self._all_data:
            return np.empty((0, FEATURE_DIM), dtype=np.float32), np.empty(0, dtype=np.float32)
        X = np.array([d[0] for d in self._all_data], dtype=np.float32)
        y = np.array([d[1] for d in self._all_data], dtype=np.float32)
        return X, y

    def reset_data(self):
        """Clear all stored data."""
        self._all_data.clear()
        self._snapshots.clear()


def generate_dataset(n_games, target_score, seed, verbose=False):
    """
    Run self-play and generate labeled dataset.

    Returns (X, y, metadata) where:
      X: (N, FEATURE_DIM) feature matrix
      y: (N,) binary labels
      metadata: dict
    """
    rng = random.Random(seed)

    p0 = InstrumentedApexMCTS(0, name="ApexMCTS_P0", seed=rng.randint(0, 2**31))
    p1 = InstrumentedApexMCTS(1, name="ApexMCTS_P1", seed=rng.randint(0, 2**31))

    wins = [0, 0]
    total_hands = 0
    start_time = time.time()

    for game_idx in range(n_games):
        # Set global random seed for deck shuffling
        random.seed(rng.randint(0, 2**31))

        game = GinRummyGame(p0, p1, target_score=target_score, verbose=False)
        result = game.play_game()

        winner = result.winner
        wins[winner] += 1
        total_hands += result.hands_played

        # Finalize labels for both players
        p0.finalize_game(winner)
        p1.finalize_game(winner)

        if verbose and (game_idx + 1) % 100 == 0:
            elapsed = time.time() - start_time
            rate = (game_idx + 1) / elapsed
            print(f"  Game {game_idx + 1}/{n_games} ({rate:.1f} games/sec) "
                  f"P0 wins: {wins[0]}, P1 wins: {wins[1]}")

    # Combine data from both players
    X0, y0 = p0.get_data()
    X1, y1 = p1.get_data()

    X = np.concatenate([X0, X1], axis=0) if len(X0) > 0 and len(X1) > 0 else (
        X0 if len(X0) > 0 else X1
    )
    y = np.concatenate([y0, y1], axis=0) if len(y0) > 0 and len(y1) > 0 else (
        y0 if len(y0) > 0 else y1
    )

    elapsed = time.time() - start_time

    metadata = {
        'n_games': n_games,
        'target_score': target_score,
        'seed': seed,
        'total_samples': len(y),
        'total_hands': total_hands,
        'p0_wins': wins[0],
        'p1_wins': wins[1],
        'win_rate_p0': wins[0] / n_games if n_games > 0 else 0,
        'positive_rate': float(np.mean(y)) if len(y) > 0 else 0,
        'feature_dim': FEATURE_DIM,
        'generation_time_sec': round(elapsed, 1),
        'source_policy': 'ApexMCTS',
    }

    return X, y, metadata


def main():
    parser = argparse.ArgumentParser(description="Generate self-play value training data")
    parser.add_argument("--games", type=int, default=2000,
                        help="Number of games to play (default: 2000)")
    parser.add_argument("--target", type=int, default=100,
                        help="Target score per game (default: 100)")
    parser.add_argument("--seed", type=int, default=20260316,
                        help="Random seed (default: 20260316)")
    parser.add_argument("--output", type=str, default=None,
                        help="Output file path (default: models/value_data.npz)")
    args = parser.parse_args()

    output_path = args.output or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "value_data.npz"
    )

    print("=" * 60)
    print("  GIN RUMMY VALUE DATA GENERATOR")
    print("=" * 60)
    print(f"  Games:        {args.games}")
    print(f"  Target score: {args.target}")
    print(f"  Seed:         {args.seed}")
    print(f"  Output:       {output_path}")
    print(f"  Feature dim:  {FEATURE_DIM}")
    print("=" * 60)

    X, y, metadata = generate_dataset(
        n_games=args.games,
        target_score=args.target,
        seed=args.seed,
        verbose=True,
    )

    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Save dataset
    np.savez_compressed(
        output_path,
        X=X,
        y=y,
        metadata=np.array([str(metadata)]),  # store metadata as string
    )

    print()
    print("=" * 60)
    print("  GENERATION COMPLETE")
    print("=" * 60)
    print(f"  Total samples:     {metadata['total_samples']:,}")
    print(f"  Total hands:       {metadata['total_hands']:,}")
    print(f"  Feature dim:       {metadata['feature_dim']}")
    print(f"  Positive rate:     {metadata['positive_rate']:.3f}")
    print(f"  P0 wins:           {metadata['p0_wins']} ({metadata['win_rate_p0']:.3f})")
    print(f"  P1 wins:           {metadata['p1_wins']}")
    print(f"  Generation time:   {metadata['generation_time_sec']:.1f}s")
    print(f"  Output:            {output_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
