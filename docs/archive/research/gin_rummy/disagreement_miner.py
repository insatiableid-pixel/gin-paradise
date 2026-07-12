"""
Phase 63 Task A: Targeted Disagreement Miner for Medium-DW Low-Stock Spots.

Extends the Phase 62 spot miner with three mining paths designed to
increase coverage of the DW 5-10 / stock <= 6 region that was underrepresented
in the Phase 62 corpus:

  1. NATURAL-FREQUENCY MINING: Large-sample champion self-play (same as Phase 62
     but with much larger sample size). Every spot is labeled 'natural'.
  2. COVERAGE-OVERSAMPLED MINING: Self-play using alternate knock policies
     (GoGin, FirstKnock) to reach states the champion rarely reaches.
     Spots are labeled 'oversampled'.
  3. SYNTHETIC PERTURBATION: Takes real mined spots with DW 0-4 and perturbs
     them by swapping a melded card with a higher-DW unmelded card to push DW
     into the 5-10 range. Spots are labeled 'synthetic'.

Each MinedSpot carries a `corpus_type` label that is critical for Phase 63's
truthfulness requirement: natural vs oversampled vs synthetic must never be
blended in analysis.
"""

import random
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Set

from gin_rummy.card import (
    NUM_CARDS, rank, suit, make_card, deadwood_value, card_str, hand_str, make_deck
)
from gin_rummy.meld import (
    best_meld_arrangement, compute_deadwood, find_all_melds
)
from gin_rummy.game import GIN_BONUS, UNDERCUT_BONUS, TARGET_SCORE, MIN_STOCK_CARDS
from gin_rummy.endgame_solver import PublicState


# ── Corpus Type Labels ────────────────────────────────────────────────

CORPUS_NATURAL = 'natural'
CORPUS_OVERSAMPLED = 'oversampled'
CORPUS_SYNTHETIC = 'synthetic'


# ── Extended Mined Spot ───────────────────────────────────────────────

@dataclass
class DisagreementSpot:
    """A mined position with full metadata for disagreement analysis."""
    hero_hand: List[int]
    public_state: PublicState
    hero_deadwood: int
    corpus_type: str  # 'natural', 'oversampled', or 'synthetic'
    source_game_id: int = 0
    dw_card_count: int = 0  # Number of deadwood cards (fragmentation)
    hand_texture: str = ''  # 'fragmented', 'concentrated', 'gin_live'
    
    # Solver results (populated by analysis phase)
    champion_action: str = ''
    solver_action: str = ''
    ev_knock: float = 0.0
    ev_continue: float = 0.0
    ev_diff: float = 0.0  # knock_ev - continue_ev (positive = knock better)
    me_knock: float = 0.0
    me_continue: float = 0.0
    is_disagreement: bool = False
    
    @property
    def stock_size(self) -> int:
        return self.public_state.stock_size
    
    @property
    def score_state(self) -> str:
        return f"{self.public_state.my_score}-{self.public_state.opp_score}"
    
    @property
    def stock_bucket(self) -> str:
        if self.stock_size <= 2:
            return 'stock_1_2'
        elif self.stock_size <= 4:
            return 'stock_3_4'
        else:
            return 'stock_5_6'
    
    @property
    def dw_bucket(self) -> str:
        if self.hero_deadwood <= 2:
            return 'dw_0_2'
        elif self.hero_deadwood <= 5:
            return 'dw_3_5'
        elif self.hero_deadwood <= 8:
            return 'dw_6_8'
        else:
            return 'dw_9_10'
    
    @property
    def score_bucket(self) -> str:
        my = self.public_state.my_score
        opp = self.public_state.opp_score
        if my >= 80 or opp >= 80:
            return 'late_game'
        elif my >= 40 or opp >= 40:
            return 'mid_game'
        else:
            return 'early_game'
    
    def to_dict(self) -> dict:
        return {
            'id': f"d63_{self.corpus_type}_{self.source_game_id}_dw{self.hero_deadwood}_stk{self.stock_size}",
            'hero_hand': list(self.hero_hand),
            'hero_deadwood': self.hero_deadwood,
            'stock_size': self.stock_size,
            'score_state': self.score_state,
            'corpus_type': self.corpus_type,
            'dw_card_count': self.dw_card_count,
            'hand_texture': self.hand_texture,
            'champion_action': self.champion_action,
            'solver_action': self.solver_action,
            'ev_knock': round(self.ev_knock, 2),
            'ev_continue': round(self.ev_continue, 2),
            'ev_diff': round(self.ev_diff, 2),
            'is_disagreement': self.is_disagreement,
        }


def classify_hand_texture(hand: List[int]) -> Tuple[str, int]:
    """
    Classify hand texture based on deadwood structure.
    
    Returns:
        (texture, dw_card_count) where texture is one of:
        - 'fragmented': 3+ deadwood cards with no near-meld connections
        - 'concentrated': 1-2 deadwood cards with high individual DW value
        - 'gin_live': deadwood cards have realistic gin-completing paths
    """
    melds, dw_cards, dw = best_meld_arrangement(hand)
    n_dw = len(dw_cards)
    
    if n_dw == 0:
        return 'gin', 0
    
    if n_dw == 1:
        # Single DW card — check if gin-completing cards exist
        gin_outs = _count_gin_outs(hand, dw_cards)
        if gin_outs >= 2:
            return 'gin_live', 1
        else:
            return 'concentrated', 1
    
    if n_dw == 2:
        gin_outs = _count_gin_outs(hand, dw_cards)
        if gin_outs >= 2:
            return 'gin_live', 2
        return 'concentrated', 2
    
    # 3+ deadwood cards
    # Check for near-meld connections among DW cards
    partial_melds = find_all_melds(dw_cards)
    if partial_melds:
        return 'gin_live', n_dw
    
    return 'fragmented', n_dw


def _count_gin_outs(hand: List[int], dw_cards: List[int]) -> int:
    """Count how many unseen cards could make gin (DW=0)."""
    hand_set = set(hand)
    count = 0
    for c in range(NUM_CARDS):
        if c in hand_set:
            continue
        # Try adding card and removing each DW card
        for dc in dw_cards:
            test = [x for x in hand if x != dc] + [c]
            if len(test) == 10 and compute_deadwood(test) == 0:
                count += 1
                break
    return count


# ── Natural-Frequency Miner ──────────────────────────────────────────

class NaturalFrequencyMiner:
    """
    Mines spots from champion self-play at natural frequency.
    
    Every spot represents a position that actually arises under strong play.
    These are the most trustworthy for frequency estimation.
    """
    
    def __init__(self, max_stock: int = 6, min_dw: int = 0,
                 max_dw: int = 10, seed: int = 20260321):
        self.max_stock = max_stock
        self.min_dw = min_dw
        self.max_dw = max_dw
        self.seed = seed
    
    def mine(self, n_games: int = 500, verbose: bool = False) -> List[DisagreementSpot]:
        """Mine spots from champion self-play."""
        from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin
        
        rng = random.Random(self.seed)
        spots = []
        seen_hashes = set()
        
        for game_id in range(n_games):
            game_seed = rng.randint(0, 2**31)
            random.seed(game_seed)
            
            p0 = ApexMCTSClinchOnlyGoGin(name="P0", seed=game_seed)
            p1 = ApexMCTSClinchOnlyGoGin(name="P1", seed=game_seed + 1)
            
            new_spots = self._play_instrumented_game(p0, p1, game_id, game_seed)
            
            for spot in new_spots:
                h = frozenset(spot.hero_hand)
                if h not in seen_hashes:
                    seen_hashes.add(h)
                    spots.append(spot)
            
            if verbose and game_id % 100 == 0:
                print(f"  Natural: Game {game_id}/{n_games}: {len(spots)} spots")
        
        if verbose:
            print(f"  Natural total: {len(spots)} spots")
        
        return spots
    
    def _play_instrumented_game(self, p0, p1, game_id, seed) -> List[DisagreementSpot]:
        """Play a single game, extracting qualifying positions."""
        from gin_rummy.game import GinRummyGame, MAX_TURNS_PER_HAND
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
    
    def _play_instrumented_hand(self, p0, p1, dealer, scores, spot_id_base) -> List[DisagreementSpot]:
        """Play one hand, capturing qualifying positions."""
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
        
        from gin_rummy.game import MAX_TURNS_PER_HAND
        
        while turn_number < MAX_TURNS_PER_HAND:
            if len(stock) <= MIN_STOCK_CARDS:
                break
            
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
            
            if (len(stock) <= self.max_stock and 
                self.min_dw <= dw <= self.max_dw):
                texture, n_dw = classify_hand_texture(hands[current])
                spot = DisagreementSpot(
                    hero_hand=list(hands[current]),
                    public_state=PublicState(
                        discard_pile=list(discard_pile),
                        turn_number=turn_number,
                        stock_size=len(stock),
                        my_score=scores[current],
                        opp_score=scores[1 - current],
                    ),
                    hero_deadwood=dw,
                    corpus_type=CORPUS_NATURAL,
                    source_game_id=spot_id_base,
                    dw_card_count=n_dw,
                    hand_texture=texture,
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
                # Score the knock
                opponent = 1 - current
                opp_melds, opp_dw_cards, opp_dw = best_meld_arrangement(hands[opponent])
                
                from gin_rummy.meld import compute_layoffs
                
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


# ── Coverage-Oversampled Miner ────────────────────────────────────────

class CoverageOversampledMiner:
    """
    Mines spots from self-play with alternate knock policies.
    
    By using more aggressive knockers (FirstKnock, LowStockGoGin),
    games reach different low-stock states than the champion normally would.
    These spots are labeled 'oversampled' because they don't represent
    natural champion-play frequency.
    """
    
    def __init__(self, max_stock: int = 6, seed: int = 63630321):
        self.max_stock = max_stock
        self.seed = seed
    
    def mine(self, n_games: int = 300, verbose: bool = False) -> List[DisagreementSpot]:
        """Mine spots from alternate-policy self-play."""
        spots = []
        rng = random.Random(self.seed)
        seen_hashes = set()
        
        # Use GoGin vs ClinchOnly — GoGin will pass on knocks the champion takes,
        # leading to different game states
        policy_pairs = self._get_policy_pairs()
        
        games_per_pair = n_games // len(policy_pairs)
        
        for pair_idx, (p0_class, p1_class, pair_name) in enumerate(policy_pairs):
            for game_id in range(games_per_pair):
                game_seed = rng.randint(0, 2**31)
                random.seed(game_seed)
                
                p0 = p0_class(name=f"P0_{pair_name}", seed=game_seed)
                p1 = p1_class(name=f"P1_{pair_name}", seed=game_seed + 1)
                
                global_id = pair_idx * games_per_pair + game_id
                new_spots = self._play_instrumented_game(
                    p0, p1, global_id, game_seed
                )
                
                for spot in new_spots:
                    h = frozenset(spot.hero_hand)
                    if h not in seen_hashes:
                        seen_hashes.add(h)
                        spots.append(spot)
            
            if verbose:
                print(f"  Oversampled ({pair_name}): {len(spots)} spots after {games_per_pair} games")
        
        if verbose:
            print(f"  Oversampled total: {len(spots)} spots")
        
        return spots
    
    def _get_policy_pairs(self):
        """Get pairs of different policies for diverse self-play."""
        from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin
        from gin_rummy.apex_mcts_gogin import ApexMCTSGoGin
        
        return [
            (ApexMCTSGoGin, ApexMCTSClinchOnlyGoGin, 'gogin_vs_clinch'),
            (ApexMCTSGoGin, ApexMCTSGoGin, 'gogin_vs_gogin'),
        ]
    
    def _play_instrumented_game(self, p0, p1, game_id, seed) -> List[DisagreementSpot]:
        """Play game with alternate policies, capturing qualifying spots."""
        spots = []
        scores = [0, 0]
        dealer = random.randint(0, 1)
        
        for hand_num in range(50):
            if scores[0] >= TARGET_SCORE or scores[1] >= TARGET_SCORE:
                break
            
            hand_spots = self._play_instrumented_hand(
                p0, p1, dealer, scores, game_id * 1000 + hand_num
            )
            spots.extend(hand_spots)
            dealer = 1 - dealer
        
        return spots
    
    def _play_instrumented_hand(self, p0, p1, dealer, scores, spot_id_base) -> List[DisagreementSpot]:
        """Play one hand with oversampled policies."""
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
        
        from gin_rummy.game import MAX_TURNS_PER_HAND
        
        while turn_number < MAX_TURNS_PER_HAND:
            if len(stock) <= MIN_STOCK_CARDS:
                break
            
            gs = {
                'turn_number': turn_number,
                'my_score': scores[current],
                'opp_score': scores[1 - current],
                'deck_remaining': len(stock),
                'discard_pile': list(discard_pile),
            }
            
            drew_from_discard = False
            drawn_card = None
            
            if opening:
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
            
            # Capture qualifying spots
            melds, dw_cards, dw = best_meld_arrangement(hands[current])
            
            if len(stock) <= self.max_stock and dw <= 10:
                texture, n_dw = classify_hand_texture(hands[current])
                spot = DisagreementSpot(
                    hero_hand=list(hands[current]),
                    public_state=PublicState(
                        discard_pile=list(discard_pile),
                        turn_number=turn_number,
                        stock_size=len(stock),
                        my_score=scores[current],
                        opp_score=scores[1 - current],
                    ),
                    hero_deadwood=dw,
                    corpus_type=CORPUS_OVERSAMPLED,
                    source_game_id=spot_id_base,
                    dw_card_count=n_dw,
                    hand_texture=texture,
                )
                spots.append(spot)
            
            # Knock check
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
                opponent = 1 - current
                opp_melds, opp_dw_cards, opp_dw = best_meld_arrangement(hands[opponent])
                from gin_rummy.meld import compute_layoffs
                
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


# ── Synthetic Perturbation Miner ──────────────────────────────────────

class SyntheticPerturbationMiner:
    """
    Creates synthetic spots by perturbing real low-DW spots into the DW 5-10 range.
    
    Takes a real mined spot and performs valid card swaps to increase DW while
    maintaining a legal game state. This fills coverage gaps in the DW 5-10 range
    that the champion naturally avoids.
    
    Spots are labeled 'synthetic' and must be analyzed separately.
    """
    
    def __init__(self, seed: int = 99990321):
        self.seed = seed
    
    def perturb_spots(self, source_spots: List[DisagreementSpot],
                      target_dw_range: Tuple[int, int] = (5, 10),
                      max_attempts: int = 20) -> List[DisagreementSpot]:
        """
        Perturb source spots to push DW into target range.
        
        Only perturbs spots with DW < target_dw_range[0].
        """
        rng = random.Random(self.seed)
        synthetic_spots = []
        
        for spot in source_spots:
            if spot.hero_deadwood >= target_dw_range[0]:
                continue  # Already in target range
            if spot.hero_deadwood > target_dw_range[1]:
                continue  # Already above target
            
            for attempt in range(max_attempts):
                perturbed = self._try_perturb(spot, target_dw_range, rng)
                if perturbed is not None:
                    synthetic_spots.append(perturbed)
                    break
        
        return synthetic_spots
    
    def _try_perturb(self, spot: DisagreementSpot,
                     target_range: Tuple[int, int],
                     rng: random.Random) -> Optional[DisagreementSpot]:
        """Try to create a valid perturbation of a spot."""
        hand = list(spot.hero_hand)
        visible = set(spot.public_state.discard_pile)
        hand_set = set(hand)
        
        # Find cards not in hand or discard pile
        available = [c for c in range(NUM_CARDS)
                     if c not in hand_set and c not in visible]
        
        if not available:
            return None
        
        melds, dw_cards, orig_dw = best_meld_arrangement(hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)
        
        melded_list = [c for c in hand if c in melded]
        if not melded_list:
            return None
        
        # Try swapping a melded card with an available card
        rng.shuffle(melded_list)
        rng.shuffle(available)
        
        for meld_card in melded_list:
            for avail_card in available[:10]:  # Limit search
                new_hand = [c if c != meld_card else avail_card for c in hand]
                new_dw = compute_deadwood(new_hand)
                
                if target_range[0] <= new_dw <= target_range[1]:
                    texture, n_dw = classify_hand_texture(new_hand)
                    return DisagreementSpot(
                        hero_hand=new_hand,
                        public_state=PublicState(
                            discard_pile=list(spot.public_state.discard_pile),
                            turn_number=spot.public_state.turn_number,
                            stock_size=spot.public_state.stock_size,
                            my_score=spot.public_state.my_score,
                            opp_score=spot.public_state.opp_score,
                        ),
                        hero_deadwood=new_dw,
                        corpus_type=CORPUS_SYNTHETIC,
                        source_game_id=spot.source_game_id + 900000,
                        dw_card_count=n_dw,
                        hand_texture=texture,
                    )
        
        return None


# ── Master Mining Pipeline ────────────────────────────────────────────

def mine_disagreement_corpus(
    n_natural_games: int = 500,
    n_oversampled_games: int = 300,
    verbose: bool = False,
) -> Dict[str, List[DisagreementSpot]]:
    """
    Run the full Phase 63 mining pipeline.
    
    Returns dict with keys: 'natural', 'oversampled', 'synthetic'
    Each contains a list of DisagreementSpots.
    """
    corpus = {}
    
    # 1. Natural frequency mining
    if verbose:
        print("=== Phase 1: Natural-frequency mining ===")
    natural_miner = NaturalFrequencyMiner()
    corpus['natural'] = natural_miner.mine(n_games=n_natural_games, verbose=verbose)
    
    # 2. Coverage-oversampled mining
    if verbose:
        print("\n=== Phase 2: Coverage-oversampled mining ===")
    oversampled_miner = CoverageOversampledMiner()
    corpus['oversampled'] = oversampled_miner.mine(n_games=n_oversampled_games, verbose=verbose)
    
    # 3. Synthetic perturbation (from natural spots with DW < 5)
    if verbose:
        print("\n=== Phase 3: Synthetic perturbation ===")
    low_dw_spots = [s for s in corpus['natural'] if s.hero_deadwood < 5]
    synth_miner = SyntheticPerturbationMiner()
    corpus['synthetic'] = synth_miner.perturb_spots(low_dw_spots)
    if verbose:
        print(f"  Synthetic: {len(corpus['synthetic'])} spots from {len(low_dw_spots)} low-DW sources")
    
    return corpus


def get_corpus_summary(corpus: Dict[str, List[DisagreementSpot]]) -> Dict:
    """Produce summary statistics for the mined corpus."""
    summary = {}
    for corpus_type, spots in corpus.items():
        dw_dist = {}
        stock_dist = {}
        texture_dist = {}
        for s in spots:
            dw_dist[s.hero_deadwood] = dw_dist.get(s.hero_deadwood, 0) + 1
            stock_dist[s.stock_size] = stock_dist.get(s.stock_size, 0) + 1
            texture_dist[s.hand_texture] = texture_dist.get(s.hand_texture, 0) + 1
        
        summary[corpus_type] = {
            'total': len(spots),
            'dw_distribution': dict(sorted(dw_dist.items())),
            'stock_distribution': dict(sorted(stock_dist.items())),
            'texture_distribution': texture_dist,
            'dw_5_10_count': sum(1 for s in spots if 5 <= s.hero_deadwood <= 10),
            'dw_0_4_count': sum(1 for s in spots if s.hero_deadwood <= 4),
        }
    
    return summary
