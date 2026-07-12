"""
Phase 62: Upgraded Endgame Solver with Policy-Backed Continuation.

Upgrades over Phase 61:
  1. POLICY-BACKED CONTINUATION: both players use champion-level draw/discard/knock
     policies instead of greedy DW-minimizing. Supports pluggable continuation modes:
       - 'greedy' (Phase 61 baseline)
       - 'champion' (ApexMCTSClinchOnlyGoGin policy)
  2. EMPIRICAL MATCH-EQUITY: uses the Phase 62 match-equity table instead of
     the crude linear approximation
  3. BELIEF SENSITIVITY: supports running the same spot under different belief
     modes to test robustness

Architecture:
  This module wraps the Phase 61 solver and adds the policy-backed continuation
  engine. The Phase 61 module is preserved unchanged for regression testing.
"""

import random
import time
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Set

from gin_rummy.card import (
    NUM_CARDS, rank, suit, make_card, deadwood_value, card_str, hand_str
)
from gin_rummy.meld import (
    best_meld_arrangement, compute_deadwood, compute_layoffs, find_all_melds
)
from gin_rummy.game import GIN_BONUS, UNDERCUT_BONUS, TARGET_SCORE, MIN_STOCK_CARDS

from gin_rummy.endgame_solver import (
    PublicState, HandOutcome, OutcomeDistribution, SolverResult,
    generate_hidden_worlds, evaluate_knock_now, what_would_champion_do,
)


# ── Continuation Policy Modes ─────────────────────────────────────────

CONTINUATION_GREEDY = 'greedy'
CONTINUATION_CHAMPION = 'champion'
VALID_CONTINUATION_MODES = {CONTINUATION_GREEDY, CONTINUATION_CHAMPION}


# ── Policy-Backed Continuation Simulator ──────────────────────────────

class _MiniPlayer:
    """
    Lightweight shim that wraps champion-level draw/discard/knock logic
    for use inside the continuation simulator.
    
    Uses the same logic as ApexMCTSClinchOnlyGoGin but without full
    game engine overhead. Specifically:
    - Draw: uses Apex's draw logic (MCTS search disabled for speed)
    - Discard: uses Apex's actual-DW discard selection  
    - Knock: uses ClinchOnlyGoGin policy (gin or clinch only)
    
    This provides much higher fidelity continuation than greedy DW-minimizing
    while remaining tractable for solver use.
    """
    
    def __init__(self, hand, is_hero: bool, my_score: int, opp_score: int,
                 target_score: int = TARGET_SCORE):
        self.hand = list(hand)
        self.is_hero = is_hero
        self.my_score = my_score
        self.opp_score = opp_score
        self.target_score = target_score
        self._last_discard = None  # Cycle prevention
    
    def draw_decision(self, top_discard, discard_pile):
        """
        Decide whether to take from discard pile.
        Uses Apex's core heuristics (without MCTS search for speed).
        """
        # Cycle prevention: never take back the card we just discarded
        if top_discard == self._last_discard:
            return False
        
        # 1. Take if it completes a meld
        test_hand = self.hand + [top_discard]
        melds_with = find_all_melds(test_hand)
        completes_meld = any(top_discard in m for m in melds_with)
        if completes_meld:
            return True
        
        # 2. Take aces and twos (only if DW improves — no blind takes at endgame)
        if rank(top_discard) <= 1:
            current_dw = compute_deadwood(self.hand)
            best_dw_after = self._best_dw_after_take(test_hand, top_discard)
            if best_dw_after <= current_dw:
                return True
        
        # 3. Take if DW reduction >= 4
        current_dw = compute_deadwood(self.hand)
        best_dw_after = self._best_dw_after_take(test_hand, top_discard)
        if best_dw_after < current_dw - 3:
            return True
        
        return False
    
    def discard_decision(self, drew_from_discard, drawn_card):
        """
        Choose which card to discard from 11-card hand.
        Uses Apex's actual-DW discard selection.
        """
        melds, dw_cards, dw = best_meld_arrangement(self.hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)
        
        restricted = drawn_card if drew_from_discard else None
        candidates = [c for c in self.hand if c not in melded and c != restricted]
        if not candidates:
            candidates = [c for c in self.hand if c != restricted]
        if not candidates:
            candidates = list(self.hand)
        
        # Actual-DW verification: pick discard that minimizes remaining DW
        best_card = candidates[0]
        best_dw = float('inf')
        for c in candidates:
            remaining = [x for x in self.hand if x != c]
            actual_dw = compute_deadwood(remaining)
            if actual_dw < best_dw or (actual_dw == best_dw and 
                                        deadwood_value(c) > deadwood_value(best_card)):
                best_dw = actual_dw
                best_card = c
        
        self._last_discard = best_card  # Track for cycle prevention
        return best_card
    
    def knock_decision(self, game_state_scores):
        """
        Decide whether to knock.
        Uses ClinchOnlyGoGin policy: gin or clinch only.
        """
        melds, dw_cards, my_dw = best_meld_arrangement(self.hand)
        if my_dw > 10:
            return False
        
        # Gin: always knock
        if my_dw == 0:
            return True
        
        # Clinch: knock if it wins the game
        points_if_knock = max(1, 10 - my_dw)
        if (self.my_score + points_if_knock) >= self.target_score:
            return True
        
        # Otherwise: never knock (patience)
        return False
    
    def _best_dw_after_take(self, hand_11, restricted):
        best = 999
        for i, c in enumerate(hand_11):
            if c == restricted:
                continue
            rest = hand_11[:i] + hand_11[i+1:]
            dw = compute_deadwood(rest)
            if dw < best:
                best = dw
        return best


def simulate_continuation_policy(
    hero_hand: List[int],
    opp_hand: List[int],
    stock: List[int],
    public_state: PublicState,
    rng: Optional[random.Random] = None,
    mode: str = CONTINUATION_CHAMPION,
) -> HandOutcome:
    """
    Simulate continuation play to end of hand using policy-backed play.
    
    Both players use champion-level draw/discard/knock decisions instead
    of the Phase 61 greedy DW-minimizing approximation.
    
    Supports two modes:
      - 'greedy': Phase 61 greedy DW-minimizing (for comparison)
      - 'champion': ApexMCTSClinchOnlyGoGin policy (draw/discard/knock)
    
    Key improvements over Phase 61 greedy:
      - Real draw decisions (discard pile vs stock)  
      - Real discard decisions (actual-DW minimization with heuristics)
      - Real knock decisions (gin/clinch only)
      - Continuation until end of hand with natural termination
    """
    if mode not in VALID_CONTINUATION_MODES:
        raise ValueError(f"Invalid continuation mode: {mode}. Must be one of {VALID_CONTINUATION_MODES}")
    
    if mode == CONTINUATION_GREEDY:
        # Delegate to Phase 61 greedy simulator
        from gin_rummy.endgame_solver import simulate_continuation
        return simulate_continuation(
            hero_hand, opp_hand, stock, public_state, rng,
            hero_knock_threshold=0,  # Go-gin matching champion
            opp_knock_threshold=10,
        )
    
    if rng is None:
        rng = random.Random()
    
    outcome = HandOutcome()
    
    # Create mini-players with champion policy
    hero = _MiniPlayer(
        list(hero_hand), is_hero=True,
        my_score=public_state.my_score,
        opp_score=public_state.opp_score,
        target_score=public_state.target_score,
    )
    opp = _MiniPlayer(
        list(opp_hand), is_hero=False,
        my_score=public_state.opp_score,  # From opponent's perspective
        opp_score=public_state.my_score,
        target_score=public_state.target_score,
    )
    
    stock_cards = list(stock)
    stock_idx = 0
    discard_pile = list(public_state.discard_pile)
    
    # Hero just declined to knock, so opponent goes next
    is_hero_turn = False
    
    max_turns = 20  # Safety cap
    
    for _ in range(max_turns):
        # Check stock depletion
        remaining_stock = len(stock_cards) - stock_idx
        if remaining_stock <= MIN_STOCK_CARDS:
            outcome.wall = True
            outcome.hero_deadwood = compute_deadwood(hero.hand)
            outcome.opp_deadwood = compute_deadwood(opp.hand)
            return outcome
        
        active = hero if is_hero_turn else opp
        defender = opp if is_hero_turn else hero
        
        # ── DRAW PHASE ──
        drew_from_discard = False
        drawn_card = None
        
        if discard_pile:
            top_discard = discard_pile[-1]
            takes_discard = active.draw_decision(top_discard, discard_pile)
            if takes_discard:
                drawn_card = discard_pile.pop()
                active.hand.append(drawn_card)
                drew_from_discard = True
        
        if not drew_from_discard:
            if stock_idx >= len(stock_cards):
                outcome.wall = True
                outcome.hero_deadwood = compute_deadwood(hero.hand)
                outcome.opp_deadwood = compute_deadwood(opp.hand)
                return outcome
            drawn_card = stock_cards[stock_idx]
            stock_idx += 1
            active.hand.append(drawn_card)
        
        # ── DISCARD PHASE ──
        discard = active.discard_decision(drew_from_discard, drawn_card)
        if discard in active.hand:
            active.hand.remove(discard)
        else:
            # Fallback: remove highest DW card
            discard = max(active.hand, key=deadwood_value)
            active.hand.remove(discard)
        discard_pile.append(discard)
        
        # ── KNOCK PHASE ──
        melds, dw_cards, dw = best_meld_arrangement(active.hand)
        
        # Check for forced knock at low stock
        remaining_stock = len(stock_cards) - stock_idx
        force_knock = remaining_stock <= MIN_STOCK_CARDS and dw <= 10
        
        should_knock = force_knock or (dw <= 10 and active.knock_decision(None))
        
        if should_knock:
            return _resolve_knock(
                active, defender, is_hero_turn,
                hero, opp, melds, dw_cards, dw
            )
        
        is_hero_turn = not is_hero_turn
    
    # Safety: ran out of turns
    outcome.wall = True
    outcome.hero_deadwood = compute_deadwood(hero.hand)
    outcome.opp_deadwood = compute_deadwood(opp.hand)
    return outcome


def _resolve_knock(active, defender, is_hero_turn, hero, opp, melds, dw_cards, dw):
    """Resolve a knock during continuation play."""
    outcome = HandOutcome()
    
    def_melds, def_dw_cards, def_dw = best_meld_arrangement(defender.hand)
    
    outcome.hero_deadwood = dw if is_hero_turn else def_dw
    outcome.opp_deadwood = def_dw if is_hero_turn else dw
    
    if dw == 0:
        # Gin
        outcome.gin = is_hero_turn
        if is_hero_turn:
            outcome.hero_points = GIN_BONUS + def_dw
        else:
            outcome.opp_points = GIN_BONUS + compute_deadwood(hero.hand)
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
        # Opponent knocked; resolve from hero's perspective
        h_melds, h_dw_cards, h_dw = best_meld_arrangement(hero.hand)
        hero_layoffs = compute_layoffs(melds, h_dw_cards)
        h_dw_after = h_dw - sum(deadwood_value(c) for c in hero_layoffs)
        if h_dw_after < 0:
            h_dw_after = 0
        
        outcome.hero_deadwood = h_dw_after
        outcome.opp_deadwood = dw
        
        if dw < h_dw_after:
            # Opponent wins knock
            outcome.opp_points = h_dw_after - dw
        else:
            # Hero undercuts
            outcome.undercut = True
            outcome.hero_points = UNDERCUT_BONUS + (dw - h_dw_after)
    
    return outcome


# ── Upgraded Solver ───────────────────────────────────────────────────

def solve_spot_v2(
    hero_hand: List[int],
    public_state: PublicState,
    n_worlds: int = 200,
    seed: Optional[int] = None,
    opponent_weights: Optional[Dict[int, float]] = None,
    continuation_mode: str = CONTINUATION_CHAMPION,
    use_empirical_equity: bool = True,
    compute_match_equity: bool = True,
) -> SolverResult:
    """
    Phase 62 upgraded solver with policy-backed continuation.
    
    Improvements over Phase 61 solve_spot:
      1. Continuation uses champion policy (draw/discard/knock) instead of greedy
      2. Match equity uses empirical table instead of linear approximation
      3. Supports pluggable continuation modes for comparison
    
    Args:
        continuation_mode: 'greedy' or 'champion'
        use_empirical_equity: True to use Phase 62 table, False for Phase 61 linear
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
        # === Knock Now (exact, same as Phase 61) ===
        knock_outcome = evaluate_knock_now(hero_hand, opp_hand)
        knock_outcomes.outcomes.append(knock_outcome)
        
        # === Continue (policy-backed) ===
        cont_rng = random.Random(rng.randint(0, 2**32))
        cont_outcome = simulate_continuation_policy(
            hero_hand=hero_hand,
            opp_hand=opp_hand,
            stock=stock,
            public_state=public_state,
            rng=cont_rng,
            mode=continuation_mode,
        )
        continue_outcomes.outcomes.append(cont_outcome)
    
    # Compute match equity
    me_knock = None
    me_continue = None
    if compute_match_equity:
        if use_empirical_equity:
            me_knock, me_continue = _compute_empirical_equity(
                knock_outcomes, continue_outcomes, public_state
            )
        else:
            from gin_rummy.endgame_solver import match_equity_delta
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
        if me_knock > me_continue:
            recommended = 'knock'
        elif me_continue > me_knock:
            recommended = 'continue'
        else:
            recommended = 'knock'
    else:
        if knock_net > cont_net:
            recommended = 'knock'
        elif cont_net > knock_net:
            recommended = 'continue'
        else:
            recommended = 'knock'
    
    # Confidence
    point_spread = abs(knock_net - cont_net)
    confidence = min(1.0, point_spread / 10.0)
    
    # Diagnostics
    diagnostics = {
        'worlds_sampled': len(worlds),
        'hero_deadwood': hero_dw,
        'stock_size': public_state.stock_size,
        'turn_number': public_state.turn_number,
        'score_state': f"{public_state.my_score}-{public_state.opp_score}",
        'continuation_policy': continuation_mode,
        'equity_model': 'empirical_table' if use_empirical_equity else 'linear_phase61',
        'belief_model': 'weighted' if opponent_weights else 'uniform',
        'solver_version': 'phase62',
        'approximations': [
            'uniform_or_weighted_belief_over_legal_worlds',
            f'{continuation_mode}_continuation_policy',
            'champion_draw_discard_knock_in_continuation' if continuation_mode == 'champion' else 'greedy_dw_minimizing',
            'empirical_match_equity_table' if use_empirical_equity else 'linear_match_equity',
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


def _compute_empirical_equity(
    knock_dist: OutcomeDistribution,
    continue_dist: OutcomeDistribution,
    public_state: PublicState,
) -> Tuple[float, float]:
    """
    Compute match-equity deltas using the empirical table.
    
    For each outcome in the distribution, looks up the after-hand
    match equity and averages across all sampled worlds.
    """
    try:
        from gin_rummy.match_equity_table import get_match_equity_table
        met = get_match_equity_table()
    except Exception:
        # Fallback to linear if table not available
        from gin_rummy.endgame_solver import match_equity_delta
        me_k = match_equity_delta(
            knock_dist.expected_hero_points,
            knock_dist.expected_opp_points,
            public_state.my_score,
            public_state.opp_score,
        )
        me_c = match_equity_delta(
            continue_dist.expected_hero_points,
            continue_dist.expected_opp_points,
            public_state.my_score,
            public_state.opp_score,
        )
        return me_k, me_c
    
    before = met.win_probability(public_state.my_score, public_state.opp_score)
    
    # Average equity delta across all knock outcomes
    if knock_dist.outcomes:
        knock_eq_sum = 0.0
        for o in knock_dist.outcomes:
            after = met.win_probability(
                public_state.my_score + o.hero_points,
                public_state.opp_score + o.opp_points,
            )
            knock_eq_sum += (after - before)
        me_knock = knock_eq_sum / len(knock_dist.outcomes)
    else:
        me_knock = 0.0
    
    # Average equity delta across all continue outcomes
    if continue_dist.outcomes:
        cont_eq_sum = 0.0
        for o in continue_dist.outcomes:
            after = met.win_probability(
                public_state.my_score + o.hero_points,
                public_state.opp_score + o.opp_points,
            )
            cont_eq_sum += (after - before)
        me_continue = cont_eq_sum / len(continue_dist.outcomes)
    else:
        me_continue = 0.0
    
    return me_knock, me_continue


# ── Multi-Mode Comparison ─────────────────────────────────────────────

def compare_continuation_modes(
    hero_hand: List[int],
    public_state: PublicState,
    n_worlds: int = 200,
    seed: int = 42,
) -> Dict[str, SolverResult]:
    """
    Run the same spot under both continuation modes for comparison.
    
    Returns dict mapping mode name to SolverResult.
    """
    results = {}
    for mode in [CONTINUATION_GREEDY, CONTINUATION_CHAMPION]:
        results[mode] = solve_spot_v2(
            hero_hand, public_state,
            n_worlds=n_worlds,
            seed=seed,
            continuation_mode=mode,
        )
    return results
