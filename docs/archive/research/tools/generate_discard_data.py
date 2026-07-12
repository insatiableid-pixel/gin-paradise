"""
Discard Action Dataset Generator.

Runs ApexMCTS vs ApexMCTS self-play and at each discard decision:
  1. Snapshots the 11-card post-draw state
  2. Enumerates all legal discard candidates
  3. For each candidate: encodes features + estimates utility via paired rollout
  4. Labels each candidate with normalized utility relative to best in group

The grouped structure is critical: the model must learn which discard
is best *within this hand*, not whether a candidate is generally good.

Label generation:
  For each candidate discard:
    1. Remove candidate from hand → 10-card remaining hand
    2. Rollout N_WORLDS continuation scenarios (draw-discard cycles)
    3. Measure post-rollout deadwood
    4. Normalize utility within the group (lower DW = higher utility)
    5. Label = 1 if candidate is within threshold of best utility

Usage:
  python tools/generate_discard_data.py [--games N] [--seed S] [--output PATH]
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
from gin_rummy.discard_action_features import (
    encode_discard_candidate, DISCARD_FEATURE_DIM, encode_all_candidates
)
from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.game import GinRummyGame, TARGET_SCORE
from gin_rummy.draw_search import _get_hand_after_best_discard, _rollout_dw

# Label generation parameters
LABEL_WORLDS = 8          # Worlds to sample per candidate
LABEL_DEPTH = 2           # Continuation rollout depth
NEAR_OPTIMAL_THRESHOLD = 0.02  # Normalized utility within this of best = near-optimal


class DiscardInstrumentedApexMCTS(ApexMCTS):
    """
    ApexMCTS that captures grouped discard decision labels.

    At each discard decision point, records:
      - features for all legal candidates
      - paired continuation rollout utility for each candidate
      - group ID linking candidates from the same decision state
    """

    def __init__(self, player_idx, name="DiscardInstrumentedApexMCTS", seed=None,
                 label_worlds=LABEL_WORLDS, label_depth=LABEL_DEPTH):
        super().__init__(name=name, seed=seed)
        self.player_idx = player_idx
        self._label_worlds = label_worlds
        self._label_depth = label_depth
        self._label_rng = random.Random(seed)
        self._all_data = []        # (features, utility, group_id)
        self._group_counter = 0
        self._record_count = 0
        self._skip_count = 0

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        """Override to capture grouped discard labels before making the decision."""
        # Record the discard decision data
        self._record_discard_decision(hand, drew_from_discard, drawn_card, game_state)

        # Now make the actual decision via Apex's logic
        return super().discard_decision(hand, drew_from_discard, drawn_card, game_state)

    def _record_discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        """Encode features and generate utility labels for all candidates."""
        if len(hand) != 11:
            return

        restricted = drawn_card if drew_from_discard else None

        # Get all legal candidates
        melds, dw_cards, _ = best_meld_arrangement(hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)

        candidates = [c for c in hand if c not in melded and c != restricted]
        if not candidates:
            candidates = [c for c in hand if c != restricted]
        if not candidates:
            candidates = list(hand)

        if len(candidates) < 2:
            self._skip_count += 1
            return

        # Encode features for each candidate
        try:
            candidate_features = []
            for c in candidates:
                feats = encode_discard_candidate(
                    hand, c, drew_from_discard, drawn_card,
                    game_state, self.model
                )
                candidate_features.append(feats)
        except Exception:
            self._skip_count += 1
            return

        # Generate rollout-based utility for each candidate
        utilities = self._generate_candidate_utilities(hand, candidates, game_state)
        if utilities is None:
            self._skip_count += 1
            return

        # Normalize utilities within the group
        max_util = max(utilities)
        min_util = min(utilities)
        util_range = max_util - min_util

        group_id = self._group_counter
        self._group_counter += 1

        for i, (feats, util) in enumerate(zip(candidate_features, utilities)):
            # Normalized utility: 1.0 = best, 0.0 = worst
            if util_range > 0:
                norm_util = (util - min_util) / util_range
            else:
                norm_util = 1.0  # All equal → all optimal

            self._all_data.append((feats, norm_util, group_id, util))
            self._record_count += 1

    def _generate_candidate_utilities(self, hand, candidates, game_state):
        """
        Generate utility scores for each candidate discard via paired rollouts.

        Lower resulting deadwood = higher utility.
        Returns list of utility scores (one per candidate), or None on failure.
        """
        unseen = self.model.sample_unseen_cards()
        if len(unseen) < 3:
            return None

        utilities = []

        for candidate in candidates:
            remaining = [c for c in hand if c != candidate]

            total_dw = 0.0
            worlds_evaluated = 0

            for _ in range(self._label_worlds):
                shuffled = list(unseen)
                self._label_rng.shuffle(shuffled)

                # Rollout from the remaining 10-card hand
                rollout_dw = _rollout_dw(remaining, shuffled, self._label_depth, self._label_rng)
                total_dw += rollout_dw
                worlds_evaluated += 1

            if worlds_evaluated == 0:
                return None

            avg_dw = total_dw / worlds_evaluated
            # Utility = negative of DW (lower DW = higher utility)
            utilities.append(-avg_dw)

        return utilities

    def get_data(self):
        """Return (X, utilities, group_ids, raw_utilities) arrays."""
        if not self._all_data:
            return (np.empty((0, DISCARD_FEATURE_DIM), dtype=np.float32),
                    np.empty(0, dtype=np.float32),
                    np.empty(0, dtype=np.int32),
                    np.empty(0, dtype=np.float32))
        X = np.array([d[0] for d in self._all_data], dtype=np.float32)
        utils = np.array([d[1] for d in self._all_data], dtype=np.float32)
        groups = np.array([d[2] for d in self._all_data], dtype=np.int32)
        raw_utils = np.array([d[3] for d in self._all_data], dtype=np.float32)
        return X, utils, groups, raw_utils

    def reset_data(self):
        self._all_data.clear()
        self._record_count = 0
        self._skip_count = 0
        self._group_counter = 0


def generate_discard_dataset(n_games, target_score, seed, verbose=False):
    """
    Run self-play and generate grouped discard dataset.

    Returns (X, utilities, group_ids, raw_utilities, metadata)
    """
    rng = random.Random(seed)

    p0 = DiscardInstrumentedApexMCTS(0, name="DMCTS_P0", seed=rng.randint(0, 2**31))
    p1 = DiscardInstrumentedApexMCTS(1, name="DMCTS_P1", seed=rng.randint(0, 2**31))

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

        if verbose and (game_idx + 1) % 50 == 0:
            elapsed = time.time() - start_time
            rate = (game_idx + 1) / elapsed
            p0_groups = p0._group_counter
            p1_groups = p1._group_counter
            print(f"  Game {game_idx + 1}/{n_games} ({rate:.1f} games/sec) "
                  f"P0: {p0._record_count} samples/{p0_groups} groups, "
                  f"P1: {p1._record_count} samples/{p1_groups} groups")

    X0, u0, g0, r0 = p0.get_data()
    X1, u1, g1, r1 = p1.get_data()

    if len(X0) > 0 and len(X1) > 0:
        # Offset P1 group IDs to avoid collision
        g1_offset = g1 + p0._group_counter
        X = np.concatenate([X0, X1], axis=0)
        utils = np.concatenate([u0, u1], axis=0)
        groups = np.concatenate([g0, g1_offset], axis=0)
        raw_utils = np.concatenate([r0, r1], axis=0)
    elif len(X0) > 0:
        X, utils, groups, raw_utils = X0, u0, g0, r0
    else:
        X, utils, groups, raw_utils = X1, u1, g1, r1

    elapsed = time.time() - start_time
    n_groups = len(np.unique(groups)) if len(groups) > 0 else 0

    # Create binary labels: near-optimal = within threshold of best in group
    labels = np.zeros(len(utils), dtype=np.float32)
    for gid in np.unique(groups):
        mask = groups == gid
        group_utils = utils[mask]
        best_util = np.max(group_utils)
        near_optimal = group_utils >= (best_util - NEAR_OPTIMAL_THRESHOLD)
        labels[mask] = near_optimal.astype(np.float32)

    metadata = {
        'n_games': n_games,
        'target_score': target_score,
        'seed': seed,
        'total_samples': len(labels),
        'total_groups': n_groups,
        'avg_candidates_per_group': round(len(labels) / max(n_groups, 1), 1),
        'total_hands': total_hands,
        'p0_wins': wins[0],
        'p1_wins': wins[1],
        'near_optimal_rate': float(np.mean(labels)) if len(labels) > 0 else 0,
        'mean_utility': float(np.mean(utils)) if len(utils) > 0 else 0,
        'std_utility': float(np.std(utils)) if len(utils) > 0 else 0,
        'feature_dim': DISCARD_FEATURE_DIM,
        'label_worlds': LABEL_WORLDS,
        'label_depth': LABEL_DEPTH,
        'near_optimal_threshold': NEAR_OPTIMAL_THRESHOLD,
        'generation_time_sec': round(elapsed, 1),
        'p0_skips': p0._skip_count,
        'p1_skips': p1._skip_count,
        'source_policy': 'ApexMCTS',
    }

    return X, utils, groups, labels, raw_utils, metadata


def main():
    parser = argparse.ArgumentParser(description="Generate discard action training data")
    parser.add_argument("--games", type=int, default=500,
                        help="Number of games to play (default: 500)")
    parser.add_argument("--target", type=int, default=100,
                        help="Target score per game (default: 100)")
    parser.add_argument("--seed", type=int, default=20260318,
                        help="Random seed (default: 20260318)")
    parser.add_argument("--output", type=str, default=None,
                        help="Output file path (default: models/discard_action_data.npz)")
    args = parser.parse_args()

    output_path = args.output or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "discard_action_data.npz"
    )

    print("=" * 60)
    print("  DISCARD ACTION DATASET GENERATOR")
    print("=" * 60)
    print(f"  Games:              {args.games}")
    print(f"  Target score:       {args.target}")
    print(f"  Seed:               {args.seed}")
    print(f"  Output:             {output_path}")
    print(f"  Feature dim:        {DISCARD_FEATURE_DIM}")
    print(f"  Label worlds:       {LABEL_WORLDS}")
    print(f"  Label depth:        {LABEL_DEPTH}")
    print(f"  Near-optimal thr:   {NEAR_OPTIMAL_THRESHOLD}")
    print("=" * 60)

    X, utils, groups, labels, raw_utils, metadata = generate_discard_dataset(
        n_games=args.games,
        target_score=args.target,
        seed=args.seed,
        verbose=True,
    )

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    np.savez_compressed(
        output_path,
        X=X,
        utilities=utils,
        group_ids=groups,
        labels=labels,
        raw_utilities=raw_utils,
        metadata=np.array([str(metadata)]),
    )

    print()
    print("=" * 60)
    print("  GENERATION COMPLETE")
    print("=" * 60)
    print(f"  Total samples:       {metadata['total_samples']:,}")
    print(f"  Total groups:        {metadata['total_groups']:,}")
    print(f"  Avg cands/group:     {metadata['avg_candidates_per_group']}")
    print(f"  Total hands:         {metadata['total_hands']:,}")
    print(f"  Feature dim:         {metadata['feature_dim']}")
    print(f"  Near-optimal rate:   {metadata['near_optimal_rate']:.3f}")
    print(f"  Mean utility:        {metadata['mean_utility']:.4f}")
    print(f"  Std utility:         {metadata['std_utility']:.4f}")
    print(f"  Generation time:     {metadata['generation_time_sec']:.1f}s")
    print(f"  P0 skips:            {metadata['p0_skips']}")
    print(f"  P1 skips:            {metadata['p1_skips']}")
    print(f"  Output:              {output_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
