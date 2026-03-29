"""
CFR Training Script for Gin Rummy Discard Policy.

Trains an External Sampling MCCFR strategy over Apex self-play,
saves the learned strategy, and prints training statistics.

Usage:
    python train_cfr.py
    python train_cfr.py --iterations 10000 --hands 30 --seed 42
"""

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gin_rummy.cfr_strategy import CFRStrategy
from gin_rummy.cfr_trainer import train_cfr


def main():
    parser = argparse.ArgumentParser(description="Train CFR discard strategy for Gin Rummy")
    parser.add_argument("--iterations", type=int, default=5000,
                        help="Number of training iterations (default: 5000)")
    parser.add_argument("--hands", type=int, default=20,
                        help="Hands per iteration (default: 20)")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed (default: 42)")
    parser.add_argument("--output", type=str, default="models/apex_cfr_strategy.json",
                        help="Output strategy file path")
    parser.add_argument("--resume", type=str, default=None,
                        help="Resume from existing strategy file")
    parser.add_argument("--quiet", action="store_true",
                        help="Suppress progress output")
    args = parser.parse_args()

    print("=" * 68)
    print("  CFR DISCARD STRATEGY TRAINING")
    print("=" * 68)
    print(f"  Iterations:      {args.iterations}")
    print(f"  Hands/iteration: {args.hands}")
    print(f"  Total hands:     {args.iterations * args.hands}")
    print(f"  Seed:            {args.seed}")
    print(f"  Output:          {args.output}")
    if args.resume:
        print(f"  Resuming from:   {args.resume}")
    print("=" * 68)
    print()

    # Initialize or resume strategy
    strategy = CFRStrategy()
    if args.resume and os.path.exists(args.resume):
        strategy.load(args.resume)
        print(f"Resumed strategy: {strategy.num_info_sets()} info sets, "
              f"{strategy.iterations} prior iterations")
        print()

    # Train
    t0 = time.time()
    strategy = train_cfr(
        strategy,
        num_iterations=args.iterations,
        hands_per_iteration=args.hands,
        seed=args.seed,
        verbose=not args.quiet,
        progress_interval=max(1, args.iterations // 10),
    )
    elapsed = time.time() - t0

    # Save
    os.makedirs(os.path.dirname(args.output) if os.path.dirname(args.output) else '.', exist_ok=True)
    strategy.save(args.output)
    print(f"\nStrategy saved to: {args.output}")
    print(f"File size: {os.path.getsize(args.output) / 1024:.1f} KB")

    # Print strategy analysis
    _print_strategy_analysis(strategy)

    print(f"\nTotal training time: {elapsed:.1f}s")
    print(f"Training throughput: {args.iterations * args.hands / elapsed:.0f} hands/sec")


def _print_strategy_analysis(strategy):
    """Print analysis of the trained strategy."""
    print("\n" + "=" * 68)
    print("  STRATEGY ANALYSIS")
    print("=" * 68)

    total_sets = strategy.num_info_sets()
    print(f"  Unique info sets: {total_sets}")

    # Analyze how many info sets prefer non-Apex action
    non_apex_count = 0
    for info_set in strategy.strategy_sum:
        avg = strategy.get_average_strategy(info_set)
        best_action = max(range(len(avg)), key=lambda a: avg[a])
        if best_action != 0:
            non_apex_count += 1

    if total_sets > 0:
        print(f"  Info sets preferring non-Apex discard: {non_apex_count} "
              f"({100.0 * non_apex_count / total_sets:.1f}%)")
        print(f"  Info sets agreeing with Apex: {total_sets - non_apex_count} "
              f"({100.0 * (total_sets - non_apex_count) / total_sets:.1f}%)")

    # Show some example info sets with strong non-Apex preferences
    print("\n  Example learned preferences (non-Apex):")
    examples = []
    for info_set in strategy.strategy_sum:
        avg = strategy.get_average_strategy(info_set)
        best_action = max(range(len(avg)), key=lambda a: avg[a])
        if best_action != 0 and max(avg) > 0.5:
            examples.append((info_set, avg, best_action))

    for info_set, avg, action in examples[:10]:
        dw_b, meld_c, partial_c, iso_h, turn_b, score_b, deck_b = info_set
        probs = ', '.join(f'{p:.2f}' for p in avg)
        print(f"    DW={dw_b} M={meld_c} P={partial_c} I={iso_h} "
              f"T={turn_b} S={score_b} D={deck_b} → "
              f"action={action} probs=[{probs}]")

    if not examples:
        print("    (none with >50% confidence in non-Apex action)")


if __name__ == '__main__':
    main()
