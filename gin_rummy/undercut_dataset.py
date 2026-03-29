"""
Phase 65 Task A: Build a Low-Stock Undercut Dataset.

Mine a substantial labelled dataset of low-stock legal-knock positions from
strong self-play (champion vs champion).  For each position record:

  - full public state  
  - hero hand (10 cards after discard)  
  - score state / stock size / turn / discard pile  
  - opponent TRUE hand (for labelling only)  
  - opponent TRUE deadwood  
  - knock outcome: knock_win / undercut / gin  
  - exact hero DW and opponent DW after layoffs   
  - "undercut-ready" flag (opponent DW-after-layoff <= hero DW)  

This is the first trustworthy training/evaluation set for low-stock opponent
hand quality and undercut risk.
"""

import random
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Tuple, Dict, Any
import json, time

from gin_rummy.card import (
    NUM_CARDS, rank, suit, make_card, deadwood_value, card_str, hand_str, make_deck
)
from gin_rummy.meld import best_meld_arrangement, compute_deadwood, compute_layoffs
from gin_rummy.game import GIN_BONUS, UNDERCUT_BONUS, TARGET_SCORE, MIN_STOCK_CARDS


# ── Labelled Spot ─────────────────────────────────────────────────────

@dataclass
class LabelledKnockSpot:
    """A fully-labelled low-stock legal-knock position."""

    # Public / hero info
    hero_hand: List[int]
    hero_deadwood: int
    hero_melds: List[List[int]]
    hero_dw_cards: List[int]
    stock_size: int
    turn_number: int
    my_score: int
    opp_score: int
    discard_pile: List[int]

    # Hidden truth (labelling only)
    opp_hand: List[int]
    opp_deadwood_raw: int          # before layoffs
    opp_deadwood_after_layoff: int # after layoffs on hero's melds

    # Outcome labels
    outcome: str  # 'gin', 'knock_win', 'undercut'
    hero_points: int
    opp_points: int
    undercut_ready: bool           # opp DW after layoff <= hero DW

    # Derived features (public-only, useful for model building)
    discard_pile_size: int = 0
    n_opponent_pickups: int = 0
    n_opponent_discards: int = 0
    hero_dw_card_count: int = 0
    hero_meld_count: int = 0
    game_id: int = 0

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['hero_hand_str'] = hand_str(self.hero_hand)
        d['opp_hand_str'] = hand_str(self.opp_hand)
        return d


# ── Dataset Builder ───────────────────────────────────────────────────

class UndercutDatasetBuilder:
    """
    Mine labelled low-stock knock positions from champion self-play.
    
    Records BOTH players' perspectives each turn, giving double the spots
    per game compared to single-perspective mining.
    """

    def __init__(self, max_stock: int = 6, seed: int = 20260321):
        self.max_stock = max_stock
        self.seed = seed
        self.spots: List[LabelledKnockSpot] = []

    def build(self, n_games: int = 500, verbose: bool = False) -> List[LabelledKnockSpot]:
        """Mine n_games of champion self-play."""
        from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin

        rng = random.Random(self.seed)
        self.spots = []

        t0 = time.time()
        for game_id in range(n_games):
            game_seed = rng.randint(0, 2**31)
            random.seed(game_seed)

            p0 = ApexMCTSClinchOnlyGoGin(name="P0", seed=game_seed)
            p1 = ApexMCTSClinchOnlyGoGin(name="P1", seed=game_seed + 1)

            self._play_game(p0, p1, game_id)

            if verbose and (game_id + 1) % 100 == 0:
                elapsed = time.time() - t0
                print(f"  {game_id+1}/{n_games} games | {len(self.spots)} spots | {elapsed:.1f}s")

        if verbose:
            elapsed = time.time() - t0
            print(f"  DONE: {len(self.spots)} spots from {n_games} games in {elapsed:.1f}s")

        return self.spots

    def _play_game(self, p0, p1, game_id: int):
        """Play a full game (to TARGET_SCORE), capturing qualifying spots."""
        scores = [0, 0]
        dealer = random.randint(0, 1)
        players = [p0, p1]

        for hand_num in range(200):
            if scores[0] >= TARGET_SCORE or scores[1] >= TARGET_SCORE:
                break
            self._play_hand(players, dealer, scores, game_id * 10000 + hand_num)
            dealer = 1 - dealer

    def _play_hand(self, players, dealer, scores, spot_base_id):
        """Play one hand with full-truth recording."""
        deck = make_deck()
        hands = [deck[:10], deck[10:20]]
        discard_pile = [deck[20]]
        stock = deck[21:]

        for p in range(2):
            players[p].new_hand(list(hands[p]), 1 - p)

        non_dealer = 1 - dealer
        current = non_dealer
        turn_number = 0
        opening = True

        opp_pickups = [[], []]   # per-player list of cards picked from discard
        opp_discards = [[], []]  # per-player discards list

        while turn_number < 50:
            if len(stock) <= MIN_STOCK_CARDS:
                break

            # ── DRAW ──
            drew_from_discard = False
            drawn_card = None

            if opening:
                top = discard_pile[-1]
                gs_nd = self._gs(non_dealer, scores, stock, discard_pile, 0)
                if players[non_dealer].draw_decision(top, list(hands[non_dealer]), gs_nd):
                    current = non_dealer
                    drawn_card = discard_pile.pop()
                    hands[current].append(drawn_card)
                    drew_from_discard = True
                    opp_pickups[current].append(drawn_card)
                    players[dealer].notify_opponent_draw(True, drawn_card)
                else:
                    gs_d = self._gs(dealer, scores, stock, discard_pile, 0)
                    if players[dealer].draw_decision(top, list(hands[dealer]), gs_d):
                        current = dealer
                        drawn_card = discard_pile.pop()
                        hands[current].append(drawn_card)
                        drew_from_discard = True
                        opp_pickups[current].append(drawn_card)
                        players[non_dealer].notify_opponent_draw(True, drawn_card)
                    else:
                        current = non_dealer
                        drawn_card = stock.pop()
                        hands[current].append(drawn_card)
                        players[dealer].notify_opponent_draw(False)
                opening = False
            else:
                gs = self._gs(current, scores, stock, discard_pile, turn_number)
                top = discard_pile[-1] if discard_pile else None
                if top and players[current].draw_decision(top, list(hands[current]), gs):
                    drawn_card = discard_pile.pop()
                    hands[current].append(drawn_card)
                    drew_from_discard = True
                    opp_pickups[current].append(drawn_card)
                    players[1 - current].notify_opponent_draw(True, drawn_card)
                else:
                    if not stock:
                        break
                    drawn_card = stock.pop()
                    hands[current].append(drawn_card)
                    players[1 - current].notify_opponent_draw(False)

            # ── DISCARD ──
            gs_disc = self._gs(current, scores, stock, discard_pile, turn_number)
            discard = players[current].discard_decision(
                list(hands[current]), drew_from_discard, drawn_card, gs_disc
            )
            if discard not in hands[current]:
                discard = max(hands[current], key=deadwood_value)
            if drew_from_discard and discard == drawn_card:
                candidates = [c for c in hands[current] if c != drawn_card]
                discard = max(candidates, key=deadwood_value) if candidates else hands[current][0]
            hands[current].remove(discard)
            discard_pile.append(discard)
            opp_discards[current].append(discard)
            players[1 - current].notify_opponent_discard(discard)

            # ── CAPTURE QUALIFYING SPOT ──
            melds_h, dw_cards_h, dw_h = best_meld_arrangement(hands[current])
            opp = 1 - current

            if len(stock) <= self.max_stock and dw_h <= 10:
                # Compute exact knock outcome against opponent's true hand
                opp_melds, opp_dw_cards, opp_dw_raw = best_meld_arrangement(hands[opp])

                if dw_h == 0:
                    outcome = 'gin'
                    hero_pts = GIN_BONUS + opp_dw_raw
                    opp_pts = 0
                    opp_dw_after = opp_dw_raw
                else:
                    layoffs = compute_layoffs(melds_h, opp_dw_cards)
                    opp_dw_after = opp_dw_raw - sum(deadwood_value(c) for c in layoffs)
                    if opp_dw_after < 0:
                        opp_dw_after = 0

                    if dw_h < opp_dw_after:
                        outcome = 'knock_win'
                        hero_pts = opp_dw_after - dw_h
                        opp_pts = 0
                    else:
                        outcome = 'undercut'
                        hero_pts = 0
                        opp_pts = UNDERCUT_BONUS + (dw_h - opp_dw_after)

                spot = LabelledKnockSpot(
                    hero_hand=list(hands[current]),
                    hero_deadwood=dw_h,
                    hero_melds=[list(m) for m in melds_h],
                    hero_dw_cards=list(dw_cards_h),
                    stock_size=len(stock),
                    turn_number=turn_number,
                    my_score=scores[current],
                    opp_score=scores[opp],
                    discard_pile=list(discard_pile),
                    opp_hand=list(hands[opp]),
                    opp_deadwood_raw=opp_dw_raw,
                    opp_deadwood_after_layoff=opp_dw_after,
                    outcome=outcome,
                    hero_points=hero_pts,
                    opp_points=opp_pts,
                    undercut_ready=(opp_dw_after <= dw_h),
                    discard_pile_size=len(discard_pile),
                    n_opponent_pickups=len(opp_pickups[opp]),
                    n_opponent_discards=len(opp_discards[opp]),
                    hero_dw_card_count=len(dw_cards_h),
                    hero_meld_count=len(melds_h),
                    game_id=spot_base_id,
                )
                self.spots.append(spot)

            # ── KNOCK DECISION ──
            gs_knock = self._gs(current, scores, stock, discard_pile, turn_number)
            if dw_h <= 10:
                should_knock = players[current].knock_decision(list(hands[current]), gs_knock)
            else:
                should_knock = False

            if len(stock) <= MIN_STOCK_CARDS and dw_h <= 10:
                should_knock = True

            if should_knock:
                # Score
                opp_melds2, opp_dw_cards2, opp_dw2 = best_meld_arrangement(hands[opp])
                if dw_h == 0:
                    scores[current] += GIN_BONUS + opp_dw2
                else:
                    layoffs2 = compute_layoffs(melds_h, opp_dw_cards2)
                    opp_dw_aft2 = opp_dw2 - sum(deadwood_value(c) for c in layoffs2)
                    if opp_dw_aft2 < 0:
                        opp_dw_aft2 = 0
                    if dw_h < opp_dw_aft2:
                        scores[current] += opp_dw_aft2 - dw_h
                    else:
                        scores[opp] += UNDERCUT_BONUS + (dw_h - opp_dw_aft2)
                return

            turn_number += 1
            current = 1 - current

    @staticmethod
    def _gs(player, scores, stock, discard_pile, turn_number):
        return {
            'turn_number': turn_number,
            'my_score': scores[player],
            'opp_score': scores[1 - player],
            'deck_remaining': len(stock),
            'discard_pile': list(discard_pile),
        }


# ── Convenience Runners ──────────────────────────────────────────────

def build_undercut_dataset(n_games: int = 500, max_stock: int = 6,
                           verbose: bool = True) -> List[LabelledKnockSpot]:
    """Build and return the labelled dataset."""
    builder = UndercutDatasetBuilder(max_stock=max_stock)
    return builder.build(n_games=n_games, verbose=verbose)


def save_dataset(spots: List[LabelledKnockSpot], path: str):
    """Serialise dataset to JSON."""
    data = [s.to_dict() for s in spots]
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def dataset_summary(spots: List[LabelledKnockSpot]) -> Dict[str, Any]:
    """Compute summary statistics for the dataset."""
    if not spots:
        return {'n': 0}

    n = len(spots)
    outcomes = {'gin': 0, 'knock_win': 0, 'undercut': 0}
    dw_buckets = {}   # hero_dw -> count
    stock_buckets = {}
    opp_dw_vals = []
    undercut_ready_count = 0

    for s in spots:
        outcomes[s.outcome] += 1
        dw_buckets[s.hero_deadwood] = dw_buckets.get(s.hero_deadwood, 0) + 1
        stock_buckets[s.stock_size] = stock_buckets.get(s.stock_size, 0) + 1
        opp_dw_vals.append(s.opp_deadwood_after_layoff)
        if s.undercut_ready:
            undercut_ready_count += 1

    return {
        'n': n,
        'outcomes': outcomes,
        'undercut_rate': outcomes['undercut'] / n,
        'gin_rate': outcomes['gin'] / n,
        'knock_win_rate': outcomes['knock_win'] / n,
        'undercut_ready_rate': undercut_ready_count / n,
        'mean_opp_dw_after_layoff': sum(opp_dw_vals) / n,
        'dw_buckets': dict(sorted(dw_buckets.items())),
        'stock_buckets': dict(sorted(stock_buckets.items())),
    }


if __name__ == '__main__':
    print("Phase 65 Task A: Building low-stock undercut dataset …")
    spots = build_undercut_dataset(n_games=500, max_stock=6, verbose=True)
    summary = dataset_summary(spots)
    print(f"\n=== DATASET SUMMARY ===")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    save_dataset(spots, 'phase65_undercut_dataset.json')
    print(f"\nSaved {len(spots)} labelled spots to phase65_undercut_dataset.json")
