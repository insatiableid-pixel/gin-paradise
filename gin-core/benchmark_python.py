"""
Python benchmark for gin_rummy meld/deadwood computation.
Used to compare against Rust gin-core performance.
"""

import time
import random
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gin_rummy.card import make_card, deadwood_value, rank, suit
from gin_rummy.meld import best_meld_arrangement, compute_deadwood, find_all_melds, clear_cache


def generate_hands(n, seed=42):
    """Generate n random 10-card hands using deterministic seed."""
    rng = random.Random(seed)
    hands = []
    for _ in range(n):
        deck = list(range(52))
        rng.shuffle(deck)
        hands.append(deck[:10])
    return hands


def benchmark_python(num_hands=10000):
    """Run Python meld/deadwood benchmark."""
    print(f"=== Python Benchmark (meld.py) ===\n")

    hands = generate_hands(num_hands)

    # Warm up + clear cache
    clear_cache()
    for hand in hands[:100]:
        best_meld_arrangement(hand)
    clear_cache()

    # Benchmark: compute_deadwood
    start = time.perf_counter()
    total_dw = 0
    for hand in hands:
        total_dw += compute_deadwood(hand)
    dw_elapsed = time.perf_counter() - start
    print(f"compute_deadwood × {num_hands}:")
    print(f"  Total time:     {dw_elapsed*1000:.3f}ms")
    print(f"  Per hand:       {dw_elapsed*1_000_000/num_hands:.1f}μs")
    print(f"  Throughput:     {num_hands/dw_elapsed:.0f} hands/sec")
    print(f"  Avg deadwood:   {total_dw/num_hands:.1f}")
    print()

    clear_cache()

    # Benchmark: best_meld_arrangement (full result)
    start = time.perf_counter()
    total_melds = 0
    for hand in hands:
        melds, dw_cards, dw_val = best_meld_arrangement(hand)
        total_melds += len(melds)
    meld_elapsed = time.perf_counter() - start
    print(f"best_meld_arrangement × {num_hands}:")
    print(f"  Total time:     {meld_elapsed*1000:.3f}ms")
    print(f"  Per hand:       {meld_elapsed*1_000_000/num_hands:.1f}μs")
    print(f"  Throughput:     {num_hands/meld_elapsed:.0f} hands/sec")
    print(f"  Avg melds/hand: {total_melds/num_hands:.2f}")
    print()

    clear_cache()

    # Benchmark: find_all_melds
    start = time.perf_counter()
    total_found = 0
    for hand in hands:
        total_found += len(find_all_melds(hand))
    find_elapsed = time.perf_counter() - start
    print(f"find_all_melds × {num_hands}:")
    print(f"  Total time:     {find_elapsed*1000:.3f}ms")
    print(f"  Per hand:       {find_elapsed*1_000_000/num_hands:.1f}μs")
    print(f"  Throughput:     {num_hands/find_elapsed:.0f} hands/sec")
    print(f"  Avg melds found:{total_found/num_hands:.1f}")
    print()

    print(f"=== Python Benchmark Complete ===")

    return {
        "compute_deadwood_ms": dw_elapsed * 1000,
        "best_meld_ms": meld_elapsed * 1000,
        "find_all_melds_ms": find_elapsed * 1000,
        "num_hands": num_hands,
    }


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10000
    results = benchmark_python(n)
    # Write results to JSON for comparison script
    with open("python_benchmark_results.json", "w") as f:
        json.dump(results, f, indent=2)
