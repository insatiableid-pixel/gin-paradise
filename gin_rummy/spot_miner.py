"""
Phase 62 Task C: Mine Real Low-Stock Legal-Knock Spots from Self-Play.

Extracts realistic positions from strong self-play where:
  - stock is low (configurable threshold)
  - hero has a legal knock (DW <= 10)
  - the spot preserves full solver-replay information

Each mined spot includes:
  - hero hand
  - public state (discard pile, scores, stock size, turn)
  - source game metadata
"""

import random
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple

from gin_rummy.card import (
    NUM_CARDS, rank, suit, make_card, deadwood_value, card_str, hand_str, make_deck
)
from gin_rummy.meld import best_meld_arrangement, compute_deadwood, compute_layoffs
from gin_rummy.game import GIN_BONUS, UNDERCUT_BONUS, TARGET_SCORE, MIN_STOCK_CARDS
from gin_rummy.endgame_solver import PublicState


# ── Mined Spot Data Structure ─────────────────────────────────────────

@dataclass
class MinedSpot:
    """A real game position mined from self-play."""
    hero_hand: List[int]
    public_state: PublicState
    hero_deadwood: int
    gin_probability_estimate: float = 0.0  # rough estimate
    source_game_id: int = 0
    category: str = 'mined_real'
    
    def to_solver_dict(self) -> dict:
        """Convert to the spot format used by the canonical corpus."""
        gin_cards = self._count_gin_completing_cards()
        return {
            'id': f"mined_{self.source_game_id}_dw{self.hero_deadwood}_stk{self.public_state.stock_size}",
            'description': (
                f"Mined spot: DW={self.hero_deadwood}, stock={self.public_state.stock_size}, "
                f"score={self.public_state.my_score}-{self.public_state.opp_score}, "
                f"gin_completing_cards={gin_cards}"
            ),
            'category': self.category,
            'hero_hand': list(self.hero_hand),
            'public_state': self.public_state,
            'expected_dominant': 'unclear',
            'notes': f"Real position from game {self.source_game_id}",
        }
    
    def _count_gin_completing_cards(self) -> int:
        """Count how many cards could complete gin from current hand."""
        hero_set = set(self.hero_hand)
        visible = set(self.public_state.discard_pile)
        
        count = 0
        for c in range(NUM_CARDS):
            if c in hero_set or c in visible:
                continue
            test_hand = list(self.hero_hand) + [c]
            # Try replacing each existing card
            for i in range(len(self.hero_hand)):
                candidate = self.hero_hand[:i] + [c] + self.hero_hand[i+1:]
                if compute_deadwood(candidate) == 0:
                    count += 1
                    break
            # Also check: draw + discard for gin
            for i, existing in enumerate(test_hand):
                rest = test_hand[:i] + test_hand[i+1:]
                if len(rest) == 10 and compute_deadwood(rest) == 0:
                    count += 1
                    break
        return count


# ── Spot Miner ────────────────────────────────────────────────────────

class SpotMiner:
    """
    Mines real low-stock legal-knock positions from strong self-play.
    
    Instruments game play to capture positions meeting criteria:
      - stock_size <= max_stock_threshold
      - hero DW <= 10 (legal knock)
    """
    
    def __init__(self, max_stock: int = 6, min_spots: int = 20, seed: int = 20260320):
        self.max_stock = max_stock
        self.min_spots = min_spots
        self.seed = seed
        self.spots: List[MinedSpot] = []
    
    def mine_from_self_play(self, n_games: int = 200, verbose: bool = False) -> List[MinedSpot]:
        """
        Play n_games of strong self-play and extract qualifying spots.
        
        Uses ApexMCTSClinchOnlyGoGin (champion) for both sides.
        """
        from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin
        
        rng = random.Random(self.seed)
        self.spots = []
        seen_hashes = set()  # Avoid near-duplicate spots
        
        for game_id in range(n_games):
            game_seed = rng.randint(0, 2**31)
            random.seed(game_seed)
            
            p0 = ApexMCTSClinchOnlyGoGin(name="P0", seed=game_seed)
            p1 = ApexMCTSClinchOnlyGoGin(name="P1", seed=game_seed + 1)
            
            # Play the game with instrumentation
            new_spots = self._play_instrumented_game(p0, p1, game_id)
            
            for spot in new_spots:
                # Dedup by hand hash
                h = frozenset(spot.hero_hand)
                if h not in seen_hashes:
                    seen_hashes.add(h)
                    self.spots.append(spot)
            
            if verbose and game_id % 50 == 0:
                print(f"  Game {game_id}/{n_games}: {len(self.spots)} spots mined so far")
            
            if len(self.spots) >= self.min_spots * 3:
                # Enough spots, stop early
                break
        
        if verbose:
            print(f"  Total spots mined: {len(self.spots)}")
        
        return self.spots
    
    def _play_instrumented_game(self, p0, p1, game_id) -> List[MinedSpot]:
        """Play a single game, capturing qualifying positions."""
        spots = []
        scores = [0, 0]
        dealer = random.randint(0, 1)
        max_hands = 50
        
        for hand_num in range(max_hands):
            if scores[0] >= TARGET_SCORE or scores[1] >= TARGET_SCORE:
                break
            
            hand_spots = self._play_instrumented_hand(
                p0, p1, dealer, scores, game_id * 1000 + hand_num
            )
            spots.extend(hand_spots)
            
            dealer = 1 - dealer
        
        return spots
    
    def _play_instrumented_hand(self, p0, p1, dealer, scores, spot_id_base) -> List[MinedSpot]:
        """Play a single hand with position capture at qualifying moments."""
        spots = []
        players = [p0, p1]
        
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
        
        from gin_rummy.game import GinRummyGame, MAX_TURNS_PER_HAND
        
        while turn_number < MAX_TURNS_PER_HAND:
            if len(stock) <= MIN_STOCK_CARDS:
                break
            
            # Build game state
            gs = {
                'turn_number': turn_number,
                'my_score': scores[current],
                'opp_score': scores[1 - current],
                'deck_remaining': len(stock),
                'discard_pile': list(discard_pile),
            }
            
            # Draw Phase
            drew_from_discard = False
            drawn_card = None
            
            if opening:
                # Simplified opening: non-dealer decides, then dealer
                top = discard_pile[-1]
                if players[non_dealer].draw_decision(top, list(hands[non_dealer]),
                        {'turn_number': 0, 'my_score': scores[non_dealer],
                         'opp_score': scores[dealer], 'deck_remaining': len(stock),
                         'discard_pile': list(discard_pile)}):
                    current = non_dealer
                    drawn_card = discard_pile.pop()
                    hands[current].append(drawn_card)
                    drew_from_discard = True
                    players[dealer].notify_opponent_draw(True, drawn_card)
                elif players[dealer].draw_decision(top, list(hands[dealer]),
                        {'turn_number': 0, 'my_score': scores[dealer],
                         'opp_score': scores[non_dealer], 'deck_remaining': len(stock),
                         'discard_pile': list(discard_pile)}):
                    current = dealer
                    drawn_card = discard_pile.pop()
                    hands[current].append(drawn_card)
                    drew_from_discard = True
                    players[non_dealer].notify_opponent_draw(True, drawn_card)
                else:
                    current = non_dealer
                    drawn_card = stock.pop()
                    hands[current].append(drawn_card)
                    players[dealer].notify_opponent_draw(False)
                opening = False
            else:
                top = discard_pile[-1] if discard_pile else None
                if top and players[current].draw_decision(top, list(hands[current]), gs):
                    drawn_card = discard_pile.pop()
                    hands[current].append(drawn_card)
                    drew_from_discard = True
                    players[1 - current].notify_opponent_draw(True, drawn_card)
                else:
                    if not stock:
                        break
                    drawn_card = stock.pop()
                    hands[current].append(drawn_card)
                    players[1 - current].notify_opponent_draw(False)
            
            # Discard Phase
            gs_disc = {
                'turn_number': turn_number,
                'my_score': scores[current],
                'opp_score': scores[1 - current],
                'deck_remaining': len(stock),
                'discard_pile': list(discard_pile),
            }
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
            players[1 - current].notify_opponent_discard(discard)
            
            # ── CAPTURE QUALIFYING POSITIONS ──
            melds, dw_cards, dw = best_meld_arrangement(hands[current])
            
            if len(stock) <= self.max_stock and dw <= 10:
                # This is a qualifying position! Capture it.
                spot = MinedSpot(
                    hero_hand=list(hands[current]),
                    public_state=PublicState(
                        discard_pile=list(discard_pile),
                        turn_number=turn_number,
                        stock_size=len(stock),
                        my_score=scores[current],
                        opp_score=scores[1 - current],
                    ),
                    hero_deadwood=dw,
                    source_game_id=spot_id_base,
                )
                spots.append(spot)
            
            # Knock Phase
            gs_knock = {
                'turn_number': turn_number,
                'my_score': scores[current],
                'opp_score': scores[1 - current],
                'deck_remaining': len(stock),
                'discard_pile': list(discard_pile),
            }
            
            if dw <= 10:
                should_knock = players[current].knock_decision(list(hands[current]), gs_knock)
            else:
                should_knock = False
            
            if len(stock) <= MIN_STOCK_CARDS and dw <= 10:
                should_knock = True
            
            if should_knock:
                # Score the knock and return
                opponent = 1 - current
                opp_melds, opp_dw_cards, opp_dw = best_meld_arrangement(hands[opponent])
                
                if dw == 0:
                    scores[current] += GIN_BONUS + opp_dw
                else:
                    layoffs = compute_layoffs(melds, opp_dw_cards)
                    opp_dw_after = opp_dw - sum(deadwood_value(c) for c in layoffs)
                    if opp_dw_after < 0:
                        opp_dw_after = 0
                    
                    if dw < opp_dw_after:
                        scores[current] += opp_dw_after - dw
                    else:
                        scores[opponent] += UNDERCUT_BONUS + (dw - opp_dw_after)
                
                return spots
            
            turn_number += 1
            current = 1 - current
        
        return spots
    
    def get_diverse_sample(self, n: int = 20) -> List[MinedSpot]:
        """
        Select a diverse sample of spots covering different DW values,
        stock sizes, and score states.
        """
        if not self.spots:
            return []
        
        # Group by (dw, stock_size) bucket
        buckets = {}
        for spot in self.spots:
            key = (spot.hero_deadwood, spot.public_state.stock_size)
            if key not in buckets:
                buckets[key] = []
            buckets[key].append(spot)
        
        # Take from each bucket proportionally
        selected = []
        per_bucket = max(1, n // len(buckets))
        
        for key in sorted(buckets.keys()):
            bucket = buckets[key]
            take = min(per_bucket, len(bucket))
            selected.extend(bucket[:take])
        
        # If too many, trim to n; if too few, add more
        if len(selected) > n:
            selected = selected[:n]
        elif len(selected) < n:
            remaining = [s for s in self.spots if s not in selected]
            additional = min(n - len(selected), len(remaining))
            selected.extend(remaining[:additional])
        
        return selected


def mine_spots(n_games: int = 200, min_spots: int = 20,
               max_stock: int = 6, verbose: bool = False) -> List[MinedSpot]:
    """
    Convenience function: mine spots from self-play and return diverse sample.
    """
    miner = SpotMiner(max_stock=max_stock, min_spots=min_spots)
    miner.mine_from_self_play(n_games=n_games, verbose=verbose)
    sample = miner.get_diverse_sample(n=min_spots)
    return sample


if __name__ == '__main__':
    print("Mining real low-stock legal-knock positions from self-play...")
    spots = mine_spots(n_games=200, min_spots=20, verbose=True)
    
    print(f"\nMined {len(spots)} diverse spots:")
    print(f"  {'DW':>3} {'Stock':>5} {'Score':>10} {'Hand':>40}")
    print(f"  {'─' * 62}")
    for s in spots:
        ps = s.public_state
        print(f"  {s.hero_deadwood:>3} {ps.stock_size:>5} "
              f"{ps.my_score:>3}-{ps.opp_score:<3} "
              f"{hand_str(s.hero_hand):>40}")
