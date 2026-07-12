"""
Phase 74 Task A: Profile the Phase 73 Oracle candidate hot path.

Measures where the 300-second eval budget actually goes by timing each
component of the per-spot evaluation pipeline on a sample of eval spots.
"""

from __future__ import annotations

import os
import sys
import time
import random
import statistics

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

from prepare import load_eval_spots, load_train_spots, load_manifest, prepare_lab
from gin_rummy.endgame_solver import PublicState, evaluate_knock_now
from gin_rummy.solver_v2 import CONTINUATION_CHAMPION, simulate_continuation_policy
from gin_rummy.belief_world_generator import generate_belief_weighted_worlds
from gin_rummy.meld import compute_deadwood, best_meld_arrangement

N_WORLDS = 50
SAMPLE_SPOTS = 10  # Profile on a small sample for speed


def profile_single_spot(spot, rng, n_worlds=N_WORLDS):
    """Profile a single spot evaluation, returning timing breakdown."""
    timings = {}
    
    # 1. World generation
    t0 = time.perf_counter()
    worlds, _weights = generate_belief_weighted_worlds(
        hero_hand=list(spot.hero_hand),
        discard_pile=list(spot.discard_pile),
        stock_size=spot.stock_size,
        n_worlds=n_worlds,
        rng=random.Random(rng.randint(0, 2**31 - 1)),
        known_opponent_pickups=spot.known_opponent_pickups,
        known_opponent_discards=spot.known_opponent_discards,
        oversample_factor=2,
    )
    timings['world_gen_ms'] = (time.perf_counter() - t0) * 1000
    
    if not worlds:
        return timings
    
    public_state = PublicState(
        discard_pile=list(spot.discard_pile),
        turn_number=spot.turn_number,
        stock_size=spot.stock_size,
        my_score=spot.my_score,
        opp_score=spot.opp_score,
    )
    
    # 2. Knock evaluation (per world)
    knock_times = []
    for opp_hand, stock in worlds:
        t0 = time.perf_counter()
        evaluate_knock_now(list(spot.hero_hand), list(opp_hand))
        knock_times.append((time.perf_counter() - t0) * 1000)
    timings['knock_eval_total_ms'] = sum(knock_times)
    timings['knock_eval_mean_ms'] = statistics.mean(knock_times)
    
    # 3. Continuation simulation (per world)
    cont_times = []
    for i, (opp_hand, stock) in enumerate(worlds):
        t0 = time.perf_counter()
        simulate_continuation_policy(
            hero_hand=list(spot.hero_hand),
            opp_hand=list(opp_hand),
            stock=list(stock),
            public_state=public_state,
            rng=random.Random(rng.randint(0, 2**31 - 1) + i),
            mode=CONTINUATION_CHAMPION,
        )
        cont_times.append((time.perf_counter() - t0) * 1000)
    timings['continuation_total_ms'] = sum(cont_times)
    timings['continuation_mean_ms'] = statistics.mean(cont_times)
    
    # 4. Deadwood computations inside world gen (separate measurement)
    t0 = time.perf_counter()
    for opp_hand, _ in worlds:
        compute_deadwood(opp_hand)
    timings['deadwood_compute_total_ms'] = (time.perf_counter() - t0) * 1000
    
    # Total per-spot
    timings['total_per_spot_ms'] = (
        timings['world_gen_ms'] + 
        timings['knock_eval_total_ms'] + 
        timings['continuation_total_ms']
    )
    timings['n_worlds'] = len(worlds)
    
    return timings


def main():
    prepare_lab(force=False)
    eval_spots = load_eval_spots()
    train_spots = load_train_spots()
    
    sample = eval_spots[:SAMPLE_SPOTS]
    rng = random.Random(74)
    
    print("=" * 72)
    print("PHASE 74 HOT-PATH PROFILER")
    print("=" * 72)
    print(f"Profiling {len(sample)} spots × {N_WORLDS} worlds each")
    print()
    
    all_timings = []
    for i, spot in enumerate(sample):
        t = profile_single_spot(spot, rng, N_WORLDS)
        all_timings.append(t)
        print(
            f"  Spot {i:2d}: total={t['total_per_spot_ms']:7.1f}ms | "
            f"world_gen={t['world_gen_ms']:6.1f}ms | "
            f"knock={t['knock_eval_total_ms']:6.1f}ms | "
            f"continuation={t['continuation_total_ms']:7.1f}ms"
        )
    
    # Aggregate
    print()
    print("-" * 72)
    print("AGGREGATE (per spot averages):")
    avg_total = statistics.mean([t['total_per_spot_ms'] for t in all_timings])
    avg_worldgen = statistics.mean([t['world_gen_ms'] for t in all_timings])
    avg_knock = statistics.mean([t['knock_eval_total_ms'] for t in all_timings])
    avg_cont = statistics.mean([t['continuation_total_ms'] for t in all_timings])
    avg_dw = statistics.mean([t['deadwood_compute_total_ms'] for t in all_timings])
    
    print(f"  Total per spot:      {avg_total:7.1f}ms  (100%)")
    print(f"  World generation:    {avg_worldgen:7.1f}ms  ({avg_worldgen/avg_total*100:5.1f}%)")
    print(f"  Knock evaluation:    {avg_knock:7.1f}ms  ({avg_knock/avg_total*100:5.1f}%)")
    print(f"  Continuation sim:    {avg_cont:7.1f}ms  ({avg_cont/avg_total*100:5.1f}%)")
    print(f"  (Deadwood compute):  {avg_dw:7.1f}ms  (subset of above)")
    
    # Project to full benchmark
    print()
    print("-" * 72)
    n_eval = 80
    total_budget_sec = 300
    cfr_budget_sec = 60  # 20% of 300
    eval_budget_sec = total_budget_sec - cfr_budget_sec - 5  # 5s reserved
    
    ms_per_spot_per_world = avg_total / N_WORLDS
    total_world_spot_capacity = (eval_budget_sec * 1000) / ms_per_spot_per_world
    worlds_per_spot = total_world_spot_capacity / n_eval
    passes = worlds_per_spot / N_WORLDS
    
    print("PROJECTED FULL BENCHMARK (300s budget, 80 eval spots):")
    print(f"  Time per world-spot:     {ms_per_spot_per_world:.2f}ms")
    print(f"  Eval budget:             {eval_budget_sec:.0f}s")
    print(f"  Estimated capacity:      {total_world_spot_capacity:.0f} world-spots")
    print(f"  Estimated worlds/spot:   {worlds_per_spot:.0f}")
    print(f"  Estimated passes:        {passes:.0f}")
    
    # Breakdown of what Rust could help with
    print()
    print("-" * 72)
    print("RUST ACCELERATION OPPORTUNITIES:")
    
    # World gen includes: weighted sampling + N*oversample deadwood computations
    dw_fraction_of_worldgen = avg_dw / avg_worldgen * 100 if avg_worldgen > 0 else 0
    print(f"  Deadwood in world-gen:   {dw_fraction_of_worldgen:.1f}% of world-gen time")
    
    # Knock eval is mostly best_meld_arrangement calls
    knock_fraction = avg_knock / avg_total * 100
    print(f"  Knock eval fraction:     {knock_fraction:.1f}% of total")
    
    # Continuation sim is the big one
    cont_fraction = avg_cont / avg_total * 100
    print(f"  Continuation fraction:   {cont_fraction:.1f}% of total (DOMINANT)")
    
    # Inside continuation: compute_deadwood and best_meld_arrangement are called
    # multiple times per world. Let's measure
    print()
    print("DETAILED CONTINUATION BREAKDOWN (1 spot, 5 worlds):")
    spot = sample[0]
    worlds, _ = generate_belief_weighted_worlds(
        hero_hand=list(spot.hero_hand),
        discard_pile=list(spot.discard_pile),
        stock_size=spot.stock_size,
        n_worlds=5,
        rng=random.Random(999),
        known_opponent_pickups=spot.known_opponent_pickups,
        known_opponent_discards=spot.known_opponent_discards,
        oversample_factor=2,
    )
    
    # Count meld/deadwood calls in continuation by monkey-patching
    from gin_rummy import meld as meld_module
    original_bma = meld_module.best_meld_arrangement
    original_cdw = meld_module.compute_deadwood
    bma_count = [0]
    cdw_count = [0]
    bma_time = [0.0]
    cdw_time = [0.0]
    
    def counting_bma(hand):
        bma_count[0] += 1
        t0 = time.perf_counter()
        result = original_bma(hand)
        bma_time[0] += time.perf_counter() - t0
        return result
    
    def counting_cdw(hand):
        cdw_count[0] += 1
        t0 = time.perf_counter()
        result = original_cdw(hand)
        cdw_time[0] += time.perf_counter() - t0
        return result
    
    meld_module.best_meld_arrangement = counting_bma
    meld_module.compute_deadwood = counting_cdw
    
    public_state = PublicState(
        discard_pile=list(spot.discard_pile),
        turn_number=spot.turn_number,
        stock_size=spot.stock_size,
        my_score=spot.my_score,
        opp_score=spot.opp_score,
    )
    
    for i, (opp_hand, stock) in enumerate(worlds):
        simulate_continuation_policy(
            hero_hand=list(spot.hero_hand),
            opp_hand=list(opp_hand),
            stock=list(stock),
            public_state=public_state,
            rng=random.Random(i * 1000),
            mode=CONTINUATION_CHAMPION,
        )
    
    meld_module.best_meld_arrangement = original_bma
    meld_module.compute_deadwood = original_cdw
    
    print(f"  best_meld_arrangement calls: {bma_count[0]} ({bma_time[0]*1000:.1f}ms)")
    print(f"  compute_deadwood calls:      {cdw_count[0]} ({cdw_time[0]*1000:.1f}ms)")
    print(f"  BMA calls per world:         {bma_count[0] / 5:.1f}")
    print(f"  CDW calls per world:         {cdw_count[0] / 5:.1f}")
    total_meld_ms = (bma_time[0] + cdw_time[0]) * 1000
    print(f"  Total meld/dw time:          {total_meld_ms:.1f}ms for 5 worlds")
    print(f"  Per-world meld/dw:           {total_meld_ms / 5:.2f}ms")
    
    print()
    print("=" * 72)


if __name__ == "__main__":
    main()
