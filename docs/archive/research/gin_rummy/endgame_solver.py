"""
Representative Subgame Solver for Gin Rummy (Phase 61).

Evaluates knock-or-continue decisions in low-stock subgames by exhaustive
or near-exhaustive enumeration of hidden worlds and continuation play.

Architecture:
  - PUBLIC STATE FIRST: organized around public information available to
    both players, not only around the hero's full hand.
  - BELIEF STATE: generates hidden worlds consistent with visible cards
    and known public action constraints. First version is uniform over
    legal hidden worlds, with optional weight biasing from OpponentModel.
  - RICH OUTCOMES: returns full hand-outcome distributions (gin, knock-win,
    undercut, wall) rather than a single deadwood scalar.

Scope (Phase 61):
  - deck_remaining <= 8 (configurable, default 6)
  - legal knock available
  - hero knows own hand; opponent hand is belief-sampled
  - continuation play uses greedy deadwood-minimizing policy (explicit
    approximation: not game-theoretically optimal, but honest)

Approximations (explicit):
  1. BELIEF MODEL: uniform over legal hidden worlds (or weight-biased
     if opponent model provided). Does NOT use deep inference.
  2. CONTINUATION POLICY: both players use greedy DW-minimizing play
     (draw best, discard worst). This is a strong heuristic but NOT
     Nash-equilibrium play.
  3. OPPONENT KNOCK POLICY: opponent knocks whenever legal (DW <= 10).
     This is a conservative assumption (opponent is aggressive).
  4. SCORE CONTEXT: match-equity wrapper maps hand-outcome distributions
     to match-win probability changes. Uses a simple linear model
     as first approximation.

What is exact:
  - Meld arrangement is exact (best_meld_arrangement is optimal)
  - Scoring (gin bonus, undercut bonus, layoffs) is exact
  - Card consistency checks are exact

What is sampled:
  - Hidden world generation (opponent hand assignment)
  - Stock ordering within each sampled world

What is belief-dependent:
  - Opponent hand distribution (uniform or weighted)

What is policy-dependent:
  - Continuation play after "continue" (greedy DW-minimizing)
  - Opponent's knock threshold (always-knock-if-legal)
"""

import random
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Set
from collections import Counter

from gin_rummy.card import (
    NUM_CARDS, rank, suit, make_card, deadwood_value, card_str, hand_str
)
from gin_rummy.meld import (
    best_meld_arrangement, compute_deadwood, compute_layoffs
)
from gin_rummy.game import GIN_BONUS, UNDERCUT_BONUS, TARGET_SCORE, MIN_STOCK_CARDS


# ── Public State ──────────────────────────────────────────────────────

@dataclass
class PublicState:
    """
    Public-state representation for a Gin Rummy subgame.
    
    Contains all information available to both players at a decision point.
    """
    discard_pile: List[int]            # All cards in the discard pile (visible)
    turn_number: int                    # Current turn number
    stock_size: int                     # Cards remaining in stock
    my_score: int                       # Hero's current match score
    opp_score: int                      # Opponent's current match score
    target_score: int = TARGET_SCORE    # Match target score
    known_opponent_pickups: List[int] = field(default_factory=list)  # Cards opponent took from discard
    known_opponent_discards: List[int] = field(default_factory=list) # Cards opponent discarded

    def visible_cards(self) -> Set[int]:
        """All cards publicly visible (in discard pile)."""
        return set(self.discard_pile)

    def validate(self):
        """Validate public state consistency."""
        if self.stock_size < 0:
            raise ValueError(f"Stock size cannot be negative: {self.stock_size}")
        if self.stock_size > 31:
            raise ValueError(f"Stock size too large: {self.stock_size}")
        if self.turn_number < 0:
            raise ValueError(f"Turn number cannot be negative: {self.turn_number}")


# ── Hand-Outcome Distribution ────────────────────────────────────────

@dataclass
class HandOutcome:
    """Outcome of a single hand resolution."""
    gin: bool = False
    knock_win: bool = False
    undercut: bool = False
    wall: bool = False            # Hand ended without knock (stock depleted)
    hero_points: int = 0          # Points hero earns (positive if hero wins)
    opp_points: int = 0           # Points opponent earns (positive if opp wins)
    hero_deadwood: int = 0
    opp_deadwood: int = 0
    

@dataclass
class OutcomeDistribution:
    """Distribution of outcomes across sampled worlds."""
    outcomes: List[HandOutcome] = field(default_factory=list)
    
    @property
    def n(self) -> int:
        return len(self.outcomes)
    
    @property
    def gin_rate(self) -> float:
        if not self.outcomes:
            return 0.0
        return sum(1 for o in self.outcomes if o.gin) / self.n
    
    @property
    def knock_win_rate(self) -> float:
        if not self.outcomes:
            return 0.0
        return sum(1 for o in self.outcomes if o.knock_win) / self.n
    
    @property
    def undercut_rate(self) -> float:
        if not self.outcomes:
            return 0.0
        return sum(1 for o in self.outcomes if o.undercut) / self.n
    
    @property
    def wall_rate(self) -> float:
        if not self.outcomes:
            return 0.0
        return sum(1 for o in self.outcomes if o.wall) / self.n
    
    @property
    def expected_hero_points(self) -> float:
        if not self.outcomes:
            return 0.0
        return sum(o.hero_points for o in self.outcomes) / self.n
    
    @property
    def expected_opp_points(self) -> float:
        if not self.outcomes:
            return 0.0
        return sum(o.opp_points for o in self.outcomes) / self.n
    
    @property
    def net_expected_points(self) -> float:
        """Expected points from hero's perspective (positive = good for hero)."""
        return self.expected_hero_points - self.expected_opp_points
    
    @property
    def hero_win_rate(self) -> float:
        """Fraction of outcomes where hero earns points."""
        if not self.outcomes:
            return 0.0
        return sum(1 for o in self.outcomes if o.hero_points > 0) / self.n
    
    def to_dict(self) -> Dict:
        return {
            'n_worlds': self.n,
            'gin_rate': round(self.gin_rate, 4),
            'knock_win_rate': round(self.knock_win_rate, 4),
            'undercut_rate': round(self.undercut_rate, 4),
            'wall_rate': round(self.wall_rate, 4),
            'expected_hero_pts': round(self.expected_hero_points, 2),
            'expected_opp_pts': round(self.expected_opp_points, 2),
            'net_expected_pts': round(self.net_expected_points, 2),
            'hero_win_rate': round(self.hero_win_rate, 4),
        }


# ── Solver Result ─────────────────────────────────────────────────────

@dataclass
class SolverResult:
    """Complete result of a subgame solve."""
    knock_now: OutcomeDistribution       # Outcomes if hero knocks now
    continue_play: OutcomeDistribution   # Outcomes if hero continues
    recommended_action: str              # 'knock' or 'continue'
    confidence: float                    # 0.0-1.0, how confident the recommendation is
    match_equity_knock: Optional[float] = None   # Match-win probability delta from knock
    match_equity_continue: Optional[float] = None # Match-win probability delta from continue
    diagnostics: Dict = field(default_factory=dict)
    
    def to_dict(self) -> Dict:
        d = {
            'recommended_action': self.recommended_action,
            'confidence': round(self.confidence, 3),
            'knock_now': self.knock_now.to_dict(),
            'continue_play': self.continue_play.to_dict(),
            'diagnostics': self.diagnostics,
        }
        if self.match_equity_knock is not None:
            d['match_equity_knock'] = round(self.match_equity_knock, 4)
        if self.match_equity_continue is not None:
            d['match_equity_continue'] = round(self.match_equity_continue, 4)
        return d


# ── Hidden World Generator ────────────────────────────────────────────

def generate_hidden_worlds(
    hero_hand: List[int],
    public_state: PublicState,
    n_worlds: int = 200,
    rng: Optional[random.Random] = None,
    opponent_weights: Optional[Dict[int, float]] = None,
) -> List[Tuple[List[int], List[int]]]:
    """
    Generate plausible hidden worlds consistent with public information.
    
    Each world is a (opponent_hand, stock_order) tuple.
    
    Args:
        hero_hand: Hero's current 10-card hand
        public_state: Current public state
        n_worlds: Number of worlds to generate
        rng: Random number generator for reproducibility
        opponent_weights: Optional per-card weights for opponent hand
            (higher = more likely in opponent's hand). If None, uniform.
    
    Returns:
        List of (opponent_hand, stock_cards) tuples
    """
    if rng is None:
        rng = random.Random()
    
    hero_set = set(hero_hand)
    visible = public_state.visible_cards()
    
    # All cards not accounted for
    unassigned = []
    for c in range(NUM_CARDS):
        if c not in hero_set and c not in visible:
            unassigned.append(c)
    
    opp_hand_size = 10  # Standard Gin Rummy hand size
    
    if len(unassigned) < opp_hand_size:
        # Not enough cards — degenerate case
        return []
    
    # Cards known to be in opponent's hand (picked up from discard, not yet discarded)
    known_opp = set(public_state.known_opponent_pickups) - set(public_state.known_opponent_discards)
    known_opp -= hero_set  # Sanity: can't be in both
    known_opp -= visible   # Sanity: can't be in discard pile
    known_opp_in_unassigned = known_opp & set(unassigned)
    
    worlds = []
    for _ in range(n_worlds):
        # Start with known opponent cards
        opp_hand = list(known_opp_in_unassigned)
        remaining_needed = opp_hand_size - len(opp_hand)
        
        # Pool of cards to assign to opponent
        pool = [c for c in unassigned if c not in known_opp_in_unassigned]
        
        if remaining_needed > len(pool):
            remaining_needed = len(pool)
        
        if remaining_needed > 0:
            if opponent_weights is not None:
                # Weighted sampling
                opp_sample = _weighted_sample_without_replacement(
                    pool, 
                    [opponent_weights.get(c, 1.0) for c in pool],
                    remaining_needed,
                    rng
                )
            else:
                # Uniform sampling
                opp_sample = rng.sample(pool, remaining_needed)
            opp_hand.extend(opp_sample)
        
        opp_set = set(opp_hand)
        stock = [c for c in unassigned if c not in opp_set]
        rng.shuffle(stock)
        
        worlds.append((opp_hand, stock))
    
    return worlds


def _weighted_sample_without_replacement(
    items: List[int],
    weights: List[float],
    k: int,
    rng: random.Random,
) -> List[int]:
    """Weighted sampling without replacement."""
    pool = list(zip(items, weights))
    result = []
    for _ in range(k):
        if not pool:
            break
        total = sum(w for _, w in pool)
        if total <= 0:
            idx = rng.randrange(len(pool))
        else:
            r = rng.random() * total
            cumulative = 0.0
            idx = 0
            for i, (_, w) in enumerate(pool):
                cumulative += w
                if cumulative >= r:
                    idx = i
                    break
        result.append(pool[idx][0])
        pool.pop(idx)
    return result


# ── Knock-Now Evaluator ───────────────────────────────────────────────

def evaluate_knock_now(
    hero_hand: List[int],
    opp_hand: List[int],
) -> HandOutcome:
    """
    Evaluate the exact outcome of knocking now against a specific opponent hand.
    
    Uses exact meld arrangement, exact scoring, and exact layoff computation.
    """
    outcome = HandOutcome()
    
    hero_melds, hero_dw_cards, hero_dw = best_meld_arrangement(hero_hand)
    opp_melds, opp_dw_cards, opp_dw = best_meld_arrangement(opp_hand)
    
    outcome.hero_deadwood = hero_dw
    outcome.opp_deadwood = opp_dw
    
    if hero_dw == 0:
        # Gin
        outcome.gin = True
        outcome.hero_points = GIN_BONUS + opp_dw
        return outcome
    
    # Non-gin knock: opponent can lay off
    layoff_cards = compute_layoffs(hero_melds, opp_dw_cards)
    opp_dw_after_layoff = opp_dw - sum(deadwood_value(c) for c in layoff_cards)
    if opp_dw_after_layoff < 0:
        opp_dw_after_layoff = 0
    
    outcome.opp_deadwood = opp_dw_after_layoff
    
    if hero_dw < opp_dw_after_layoff:
        # Knock wins
        outcome.knock_win = True
        outcome.hero_points = opp_dw_after_layoff - hero_dw
    else:
        # Undercut (includes ties)
        outcome.undercut = True
        outcome.opp_points = UNDERCUT_BONUS + (hero_dw - opp_dw_after_layoff)
    
    return outcome


# ── Continuation Simulator ────────────────────────────────────────────

def simulate_continuation(
    hero_hand: List[int],
    opp_hand: List[int],
    stock: List[int],
    public_state: PublicState,
    rng: Optional[random.Random] = None,
    hero_knock_threshold: int = 10,
    opp_knock_threshold: int = 10,
) -> HandOutcome:
    """
    Simulate continuation play to the end of the hand.
    
    Both players use greedy DW-minimizing play:
      - Always draw from stock (simplification: no discard pile drawing)
      - Discard the card that minimizes resulting deadwood
      - Knock when deadwood <= threshold
    
    APPROXIMATION: This is NOT game-theoretically optimal play.
    It is a strong heuristic that provides an honest baseline for
    continuation value estimation.
    
    Returns the hand outcome.
    """
    if rng is None:
        rng = random.Random()
    
    outcome = HandOutcome()
    
    h_hand = list(hero_hand)
    o_hand = list(opp_hand)
    stock_cards = list(stock)
    stock_idx = 0
    
    # Hero just declined to knock, so it's opponent's turn next
    # (Hero drew, discarded, declined knock → opponent's turn)
    is_hero_turn = False
    
    discard_pile = list(public_state.discard_pile)
    
    max_turns = 20  # Safety cap
    
    for _ in range(max_turns):
        # Check stock depletion
        if stock_idx >= len(stock_cards) or len(stock_cards) - stock_idx <= MIN_STOCK_CARDS:
            outcome.wall = True
            outcome.hero_deadwood = compute_deadwood(h_hand)
            outcome.opp_deadwood = compute_deadwood(o_hand)
            return outcome
        
        active_hand = h_hand if is_hero_turn else o_hand
        knock_threshold = hero_knock_threshold if is_hero_turn else opp_knock_threshold
        
        # Draw from stock (greedy simplification)
        drawn = stock_cards[stock_idx]
        stock_idx += 1
        active_hand.append(drawn)
        
        # Discard: minimize deadwood
        best_dw = float('inf')
        best_discard_idx = 0
        for i, c in enumerate(active_hand):
            remaining = active_hand[:i] + active_hand[i+1:]
            dw = compute_deadwood(remaining)
            if dw < best_dw:
                best_dw = dw
                best_discard_idx = i
        
        discarded = active_hand.pop(best_discard_idx)
        discard_pile.append(discarded)
        
        # Post-discard deadwood for knock check
        melds, dw_cards, dw = best_meld_arrangement(active_hand)
        
        # Knock decision
        if dw <= knock_threshold:
            # This player knocks
            knocker_hand = active_hand
            defender_hand = o_hand if is_hero_turn else h_hand
            
            def_melds, def_dw_cards, def_dw = best_meld_arrangement(defender_hand)
            
            outcome.hero_deadwood = dw if is_hero_turn else def_dw
            outcome.opp_deadwood = def_dw if is_hero_turn else dw
            
            if dw == 0:
                # Gin
                outcome.gin = is_hero_turn
                if is_hero_turn:
                    outcome.hero_points = GIN_BONUS + def_dw
                else:
                    outcome.opp_points = GIN_BONUS + compute_deadwood(h_hand)
                return outcome
            
            # Non-gin knock: compute layoffs
            layoff_cards = compute_layoffs(melds, def_dw_cards)
            def_dw_after = def_dw - sum(deadwood_value(c) for c in layoff_cards)
            if def_dw_after < 0:
                def_dw_after = 0
            
            if is_hero_turn:
                outcome.opp_deadwood = def_dw_after
                if dw < def_dw_after:
                    outcome.knock_win = True
                    outcome.hero_points = def_dw_after - dw
                else:
                    outcome.undercut = True
                    outcome.opp_points = UNDERCUT_BONUS + (dw - def_dw_after)
            else:
                outcome.hero_deadwood = compute_deadwood(h_hand)
                opp_knock_dw = dw
                hero_dw_for_layoff = compute_deadwood(h_hand)
                h_melds, h_dw_cards, h_dw = best_meld_arrangement(h_hand)
                # Opponent knocked, hero lays off on opponent's melds
                hero_layoffs = compute_layoffs(melds, h_dw_cards)
                h_dw_after = h_dw - sum(deadwood_value(c) for c in hero_layoffs)
                if h_dw_after < 0:
                    h_dw_after = 0
                
                outcome.hero_deadwood = h_dw_after
                outcome.opp_deadwood = opp_knock_dw
                
                if opp_knock_dw < h_dw_after:
                    # Opponent wins knock
                    outcome.opp_points = h_dw_after - opp_knock_dw
                else:
                    # Hero undercuts
                    outcome.undercut = True
                    outcome.hero_points = UNDERCUT_BONUS + (opp_knock_dw - h_dw_after)
            
            return outcome
        
        # Force knock if stock nearly depleted
        remaining_stock = len(stock_cards) - stock_idx
        if remaining_stock <= MIN_STOCK_CARDS and dw <= 10:
            # Same knock logic as above — extracted for clarity
            knocker_hand = active_hand
            defender_hand = o_hand if is_hero_turn else h_hand
            def_melds, def_dw_cards, def_dw = best_meld_arrangement(defender_hand)
            
            if dw == 0:
                if is_hero_turn:
                    outcome.gin = True
                    outcome.hero_points = GIN_BONUS + def_dw
                else:
                    outcome.opp_points = GIN_BONUS + compute_deadwood(h_hand)
                return outcome
            
            layoff_cards = compute_layoffs(melds, def_dw_cards)
            def_dw_after = def_dw - sum(deadwood_value(c) for c in layoff_cards)
            if def_dw_after < 0:
                def_dw_after = 0
            
            if is_hero_turn:
                outcome.hero_deadwood = dw
                outcome.opp_deadwood = def_dw_after
                if dw < def_dw_after:
                    outcome.knock_win = True
                    outcome.hero_points = def_dw_after - dw
                else:
                    outcome.undercut = True
                    outcome.opp_points = UNDERCUT_BONUS + (dw - def_dw_after)
            else:
                h_melds, h_dw_cards, h_dw = best_meld_arrangement(h_hand)
                hero_layoffs = compute_layoffs(melds, h_dw_cards)
                h_dw_after = h_dw - sum(deadwood_value(c) for c in hero_layoffs)
                if h_dw_after < 0:
                    h_dw_after = 0
                outcome.hero_deadwood = h_dw_after
                outcome.opp_deadwood = dw
                if dw < h_dw_after:
                    outcome.opp_points = h_dw_after - dw
                else:
                    outcome.undercut = True
                    outcome.hero_points = UNDERCUT_BONUS + (dw - h_dw_after)
            return outcome
        
        is_hero_turn = not is_hero_turn
    
    # Safety: if we ran out of turns, it's a wall
    outcome.wall = True
    outcome.hero_deadwood = compute_deadwood(h_hand)
    outcome.opp_deadwood = compute_deadwood(o_hand)
    return outcome


# ── Match-Equity Wrapper ──────────────────────────────────────────────

def match_equity_delta(
    hero_points: float,
    opp_points: float,
    my_score: int,
    opp_score: int,
    target_score: int = TARGET_SCORE,
) -> float:
    """
    Estimate match-win probability change from a hand outcome.
    
    APPROXIMATION: Uses a linear model where each point closer to
    target_score is worth proportionally more. This is a first-pass
    heuristic, not a true match-equity table.
    
    Returns delta in match-win probability (positive = good for hero).
    """
    # Simple linear equity model
    # At score 0-0, each point is worth ~1/target * 0.5 match-equity
    # As you approach target, points are worth more
    
    def win_prob_from_score(my_s, opp_s):
        """Naive linear match-win probability estimate."""
        if my_s >= target_score:
            return 1.0
        if opp_s >= target_score:
            return 0.0
        # Linear interpolation based on progress
        my_progress = my_s / target_score
        opp_progress = opp_s / target_score
        # Logistic blend
        diff = my_progress - opp_progress
        return 0.5 + 0.4 * diff  # Clamp-free linear approximation
    
    before = win_prob_from_score(my_score, opp_score)
    after = win_prob_from_score(
        my_score + hero_points,
        opp_score + opp_points,
    )
    
    return after - before


# ── Main Solver ───────────────────────────────────────────────────────

def solve_spot(
    hero_hand: List[int],
    public_state: PublicState,
    n_worlds: int = 200,
    seed: Optional[int] = None,
    opponent_weights: Optional[Dict[int, float]] = None,
    hero_knock_threshold: int = 0,
    opp_knock_threshold: int = 10,
    compute_match_equity: bool = True,
) -> SolverResult:
    """
    Solve a knock-or-continue decision in a low-stock subgame.
    
    Args:
        hero_hand: Hero's current 10-card hand
        public_state: Current public state
        n_worlds: Number of hidden worlds to sample
        seed: Random seed for reproducibility
        opponent_weights: Optional per-card weights for belief biasing
        hero_knock_threshold: DW threshold for hero to knock during continuation
            (default 0 = go-gin, matching champion's continuation policy)
        opp_knock_threshold: DW threshold for opponent to knock during continuation
        compute_match_equity: Whether to compute match-equity deltas
    
    Returns:
        SolverResult with outcomes for both actions
    """
    public_state.validate()
    
    # Validate hero hand
    melds, dw_cards, hero_dw = best_meld_arrangement(hero_hand)
    if hero_dw > 10:
        raise ValueError(f"Hero cannot knock: deadwood {hero_dw} > 10")
    if len(hero_hand) != 10:
        raise ValueError(f"Hero hand must have 10 cards, got {len(hero_hand)}")
    
    rng = random.Random(seed) if seed is not None else random.Random()
    
    # Generate hidden worlds
    worlds = generate_hidden_worlds(
        hero_hand=hero_hand,
        public_state=public_state,
        n_worlds=n_worlds,
        rng=rng,
        opponent_weights=opponent_weights,
    )
    
    if not worlds:
        return SolverResult(
            knock_now=OutcomeDistribution(),
            continue_play=OutcomeDistribution(),
            recommended_action='knock',
            confidence=0.0,
            diagnostics={'error': 'no_valid_worlds'},
        )
    
    knock_outcomes = OutcomeDistribution()
    continue_outcomes = OutcomeDistribution()
    
    for opp_hand, stock in worlds:
        # === Knock Now ===
        knock_outcome = evaluate_knock_now(hero_hand, opp_hand)
        knock_outcomes.outcomes.append(knock_outcome)
        
        # === Continue ===
        cont_rng = random.Random(rng.randint(0, 2**32))
        cont_outcome = simulate_continuation(
            hero_hand=hero_hand,
            opp_hand=opp_hand,
            stock=stock,
            public_state=public_state,
            rng=cont_rng,
            hero_knock_threshold=hero_knock_threshold,
            opp_knock_threshold=opp_knock_threshold,
        )
        continue_outcomes.outcomes.append(cont_outcome)
    
    # Compute match equity if requested
    me_knock = None
    me_continue = None
    if compute_match_equity:
        me_knock = match_equity_delta(
            knock_outcomes.expected_hero_points,
            knock_outcomes.expected_opp_points,
            public_state.my_score,
            public_state.opp_score,
            public_state.target_score,
        )
        me_continue = match_equity_delta(
            continue_outcomes.expected_hero_points,
            continue_outcomes.expected_opp_points,
            public_state.my_score,
            public_state.opp_score,
            public_state.target_score,
        )
    
    # Recommend action
    knock_net = knock_outcomes.net_expected_points
    cont_net = continue_outcomes.net_expected_points
    
    if me_knock is not None and me_continue is not None:
        # Prefer match-equity-based decision
        if me_knock > me_continue:
            recommended = 'knock'
        elif me_continue > me_knock:
            recommended = 'continue'
        else:
            recommended = 'knock'  # Tie: prefer the certain outcome
    else:
        if knock_net > cont_net:
            recommended = 'knock'
        elif cont_net > knock_net:
            recommended = 'continue'
        else:
            recommended = 'knock'
    
    # Confidence: how separated are the two actions
    point_spread = abs(knock_net - cont_net)
    confidence = min(1.0, point_spread / 10.0)  # 10-point spread = full confidence
    
    # Diagnostics
    diagnostics = {
        'worlds_sampled': len(worlds),
        'hero_deadwood': hero_dw,
        'stock_size': public_state.stock_size,
        'turn_number': public_state.turn_number,
        'score_state': f"{public_state.my_score}-{public_state.opp_score}",
        'hero_knock_threshold': hero_knock_threshold,
        'opp_knock_threshold': opp_knock_threshold,
        'belief_model': 'weighted' if opponent_weights else 'uniform',
        'continuation_policy': 'greedy_dw_minimizing',
        'approximations': [
            'uniform_or_weighted_belief_over_legal_worlds',
            'greedy_deadwood_minimizing_continuation',
            'opponent_always_knocks_if_legal',
            'stock_draws_only_in_continuation',
        ],
    }
    
    return SolverResult(
        knock_now=knock_outcomes,
        continue_play=continue_outcomes,
        recommended_action=recommended,
        confidence=confidence,
        match_equity_knock=me_knock,
        match_equity_continue=me_continue,
        diagnostics=diagnostics,
    )


# ── Champion Comparison ───────────────────────────────────────────────

def what_would_champion_do(
    hero_hand: List[int],
    public_state: PublicState,
    target_score: int = TARGET_SCORE,
) -> Tuple[str, str]:
    """
    Determine what ApexMCTSClinchOnlyGoGin (champion) would do.
    
    Returns:
        (action, reason) tuple where action is 'knock' or 'continue'
    """
    melds, dw_cards, hero_dw = best_meld_arrangement(hero_hand)
    
    if hero_dw > 10:
        return 'continue', 'cannot_knock'
    
    if hero_dw == 0:
        return 'knock', 'gin'
    
    # Game-clinching knock check
    my_score = public_state.my_score
    points_if_knock = max(1, 10 - hero_dw)  # Conservative estimate
    if (my_score + points_if_knock) >= target_score:
        return 'knock', 'clinch'
    
    # Champion: never knock otherwise (pure go-gin with clinch exception)
    return 'continue', 'patience'
