"""
Belief-World Diagnostics (Directive 117)

Inspects how pickup/discard/decline signals affect sampled opponent worlds.
Identifies pickup-rich spots and provides a detailed summary of the
belief-world generation quality.
"""

import sys
import os
import json
import random
from typing import List, Dict, Any

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAB_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(LAB_DIR, "data")
ARTIFACT_DIR = os.path.join(LAB_DIR, "artifacts")
sys.path.insert(0, ROOT_DIR)
sys.path.insert(0, LAB_DIR)

from prepare import load_eval_spots, SpotRecord
from gin_rummy.belief_world_generator import generate_worlds_with_estimator
from gin_rummy.card import card_str, rank, suit
from gin_rummy.meld import compute_deadwood

def run_diagnostics(n_spots: int = 5):
    print("=== BELIEF-WORLD DIAGNOSTICS ===")
    
    spots = load_eval_spots()
    # Filter for spots with pickups
    pickup_spots = [s for s in spots if s.n_opponent_pickups > 0]
    pickup_spots.sort(key=lambda s: s.n_opponent_pickups, reverse=True)
    
    if not pickup_spots:
        print("No pickup-rich spots found in eval set. Using top spots by turn number.")
        pickup_spots = sorted(spots, key=lambda s: s.turn_number, reverse=True)

    target_spots = pickup_spots[:n_spots]
    results = []

    for i, spot in enumerate(target_spots):
        print(f"\nAnalyzing Spot {i+1} (Game {spot.game_id}, Turn {spot.turn_number})")
        print(f"  Pickups: {[card_str(c) for c in spot.known_opponent_pickups]}")
        print(f"  Discards: {[card_str(c) for c in spot.known_opponent_discards]}")
        
        # Generate worlds (without estimator for pure trace analysis)
        worlds, weights, diagnostics = generate_worlds_with_estimator(
            hero_hand=spot.hero_hand,
            discard_pile=spot.discard_pile,
            stock_size=spot.stock_size,
            turn_number=spot.turn_number,
            my_score=spot.my_score,
            opp_score=spot.opp_score,
            estimator=None,
            n_worlds=100,
            known_opponent_pickups=spot.known_opponent_pickups,
            known_opponent_discards=spot.known_opponent_discards,
        )
        
        # Analyze sampled worlds
        opp_hands = [w[0] for w in worlds]
        opp_dws = [compute_deadwood(h) for h in opp_hands]
        
        # Check pickup retention
        pickups_retained = []
        for pickup in spot.known_opponent_pickups:
            if spot.known_opponent_discards and pickup in spot.known_opponent_discards:
                continue
            count = sum(1 for hand in opp_hands if pickup in hand)
            pickups_retained.append((card_str(pickup), count))
            
        # Check near-pickup support
        near_pickup_support = {}
        for pickup in spot.known_opponent_pickups:
            r, s = rank(pickup), suit(pickup)
            neighbors = []
            # Same rank
            for su in range(4):
                if su != s: neighbors.append(rank(pickup) + su*13) # simplified check
            # Adj rank same suit
            if r > 0: neighbors.append(pickup - 1)
            if r < 12: neighbors.append(pickup + 1)
            
            for n in neighbors:
                if n in spot.hero_hand or n in spot.discard_pile: continue
                count = sum(1 for hand in opp_hands if n in hand)
                near_pickup_support[card_str(n)] = count

        spot_summary = {
            "game_id": spot.game_id,
            "turn": spot.turn_number,
            "pickups": [card_str(c) for c in spot.known_opponent_pickups],
            "sampled_mean_dw": sum(opp_dws) / len(opp_dws),
            "sampled_min_dw": min(opp_dws),
            "pickup_retention": pickups_retained,
            "near_pickup_support": sorted(near_pickup_support.items(), key=lambda x: x[1], reverse=True)[:5],
            "diagnostics": diagnostics
        }
        results.append(spot_summary)
        
        print(f"  Sampled Mean DW: {spot_summary['sampled_mean_dw']:.2f} (min={spot_summary['sampled_min_dw']})")
        print(f"  Pickup Retention: {pickups_retained}")
        print(f"  Top Near-Pickup Support: {spot_summary['near_pickup_support']}")

    # Save artifact
    output_path = os.path.join(ARTIFACT_DIR, "belief_diagnostics_report.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\nReport saved to {output_path}")

if __name__ == "__main__":
    run_diagnostics()
