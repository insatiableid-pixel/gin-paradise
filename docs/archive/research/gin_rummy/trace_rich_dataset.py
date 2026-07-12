"""
Phase 68 Task A: Trace-Rich Low-Stock Dataset Builder.

Mines champion self-play and preserves EXACT per-card public action events,
not just counts. This is the missing ingredient that Phase 67 identified:
the trace-aware layer was architecturally present but functionally inert
because the dataset only stored pickup/discard counts.

For each qualifying low-stock legal-knock position, we now record:
  - exact opponent discard-pile pickups (which specific cards, in order)
  - exact opponent discards (which specific cards, in order)
  - exact upcard declines / passes
  - turn ordering for all events

This dataset enables the ActionTrace pipeline to produce non-uniform
per-card weights for the first time.
"""

import random
import time
import json
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional, Tuple

from gin_rummy.card import (
    NUM_CARDS, rank, suit, make_card, deadwood_value, card_str, hand_str, make_deck
)
from gin_rummy.meld import best_meld_arrangement, compute_deadwood, compute_layoffs
from gin_rummy.game import GIN_BONUS, UNDERCUT_BONUS, TARGET_SCORE, MIN_STOCK_CARDS


@dataclass
class TraceRichSpot:
    """A fully-labelled low-stock position with per-card trace events."""

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

    # Per-card trace events (THE NEW DATA)
    known_opponent_pickups: List[int]    # exact cards opponent took from discard
    known_opponent_discards: List[int]   # exact cards opponent discarded
    upcard_declines: List[int]           # exact cards opponent passed on
    hero_discards: List[int]             # exact cards hero discarded
    trace_events: List[Dict]            # ordered event log

    # Hidden truth (labelling only)
    opp_hand: List[int]
    opp_deadwood_raw: int
    opp_deadwood_after_layoff: int

    # Outcome labels
    outcome: str  # 'gin', 'knock_win', 'undercut'
    hero_points: int
    opp_points: int
    undercut_ready: bool

    # Derived features
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


class TraceRichDatasetBuilder:
    """
    Mine labelled low-stock knock positions with FULL per-card trace data.

    Key difference from Phase 65 UndercutDatasetBuilder:
      - Records exact cards for opponent pickups, discards, and declines
      - Preserves turn-ordered event log
      - Both players' perspectives captured
    """

    def __init__(self, max_stock: int = 6, seed: int = 20260323):
        self.max_stock = max_stock
        self.seed = seed
        self.spots: List[TraceRichSpot] = []

    def build(self, n_games: int = 500, verbose: bool = False) -> List[TraceRichSpot]:
        """Mine n_games of champion self-play with full trace recording."""
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
        scores = [0, 0]
        dealer = random.randint(0, 1)
        players = [p0, p1]

        for hand_num in range(200):
            if scores[0] >= TARGET_SCORE or scores[1] >= TARGET_SCORE:
                break
            self._play_hand(players, dealer, scores, game_id * 10000 + hand_num)
            dealer = 1 - dealer

    def _play_hand(self, players, dealer, scores, spot_base_id):
        """Play one hand with full per-card trace recording."""
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

        # Per-player trace data — THE KEY INNOVATION
        # For player p, opp_pickups[p] records cards that player p picked from discard
        # (which are visible to player 1-p as "opponent pickups")
        player_pickups = [[], []]     # player_pickups[p] = cards player p took from discard
        player_discards = [[], []]    # player_discards[p] = cards player p discarded
        player_declines = [[], []]    # player_declines[p] = cards player p declined

        # Ordered event log (for both perspectives)
        event_log = []  # list of (turn, event_type, player, card)

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
                    player_pickups[current].append(drawn_card)
                    event_log.append({'turn': turn_number, 'type': 'pickup', 'player': current, 'card': drawn_card})
                    players[dealer].notify_opponent_draw(True, drawn_card)
                else:
                    # Non-dealer declined the upcard
                    player_declines[non_dealer].append(top)
                    event_log.append({'turn': turn_number, 'type': 'decline', 'player': non_dealer, 'card': top})

                    gs_d = self._gs(dealer, scores, stock, discard_pile, 0)
                    if players[dealer].draw_decision(top, list(hands[dealer]), gs_d):
                        current = dealer
                        drawn_card = discard_pile.pop()
                        hands[current].append(drawn_card)
                        drew_from_discard = True
                        player_pickups[current].append(drawn_card)
                        event_log.append({'turn': turn_number, 'type': 'pickup', 'player': current, 'card': drawn_card})
                        players[non_dealer].notify_opponent_draw(True, drawn_card)
                    else:
                        # Dealer also declined
                        player_declines[dealer].append(top)
                        event_log.append({'turn': turn_number, 'type': 'decline', 'player': dealer, 'card': top})

                        current = non_dealer
                        drawn_card = stock.pop()
                        hands[current].append(drawn_card)
                        event_log.append({'turn': turn_number, 'type': 'stock_draw', 'player': current, 'card': -1})
                        players[dealer].notify_opponent_draw(False)
                opening = False
            else:
                gs = self._gs(current, scores, stock, discard_pile, turn_number)
                top = discard_pile[-1] if discard_pile else None
                if top and players[current].draw_decision(top, list(hands[current]), gs):
                    drawn_card = discard_pile.pop()
                    hands[current].append(drawn_card)
                    drew_from_discard = True
                    player_pickups[current].append(drawn_card)
                    event_log.append({'turn': turn_number, 'type': 'pickup', 'player': current, 'card': drawn_card})
                    players[1 - current].notify_opponent_draw(True, drawn_card)
                else:
                    # Current player declined the top
                    if top is not None:
                        player_declines[current].append(top)
                        event_log.append({'turn': turn_number, 'type': 'decline', 'player': current, 'card': top})

                    if not stock:
                        break
                    drawn_card = stock.pop()
                    hands[current].append(drawn_card)
                    event_log.append({'turn': turn_number, 'type': 'stock_draw', 'player': current, 'card': -1})
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
            player_discards[current].append(discard)
            event_log.append({'turn': turn_number, 'type': 'discard', 'player': current, 'card': discard})
            players[1 - current].notify_opponent_discard(discard)

            # ── CAPTURE QUALIFYING SPOT (for BOTH perspectives) ──
            melds_h, dw_cards_h, dw_h = best_meld_arrangement(hands[current])
            opp = 1 - current

            if len(stock) <= self.max_stock and dw_h <= 10:
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

                # Build trace data from hero's perspective
                # The opponent is player 'opp', so:
                # - "known_opponent_pickups" = player_pickups[opp]  (cards opponent took)
                # - "known_opponent_discards" = player_discards[opp] (cards opponent discarded)
                # - "upcard_declines" = player_declines[opp] (cards opponent declined)
                # - "hero_discards" = player_discards[current]
                spot = TraceRichSpot(
                    hero_hand=list(hands[current]),
                    hero_deadwood=dw_h,
                    hero_melds=[list(m) for m in melds_h],
                    hero_dw_cards=list(dw_cards_h),
                    stock_size=len(stock),
                    turn_number=turn_number,
                    my_score=scores[current],
                    opp_score=scores[opp],
                    discard_pile=list(discard_pile),
                    # Per-card trace events (THE NEW DATA)
                    known_opponent_pickups=list(player_pickups[opp]),
                    known_opponent_discards=list(player_discards[opp]),
                    upcard_declines=list(player_declines[opp]),
                    hero_discards=list(player_discards[current]),
                    trace_events=[
                        e for e in event_log  # Full event log for reference
                    ],
                    # Hidden truth
                    opp_hand=list(hands[opp]),
                    opp_deadwood_raw=opp_dw_raw,
                    opp_deadwood_after_layoff=opp_dw_after,
                    # Outcome labels
                    outcome=outcome,
                    hero_points=hero_pts,
                    opp_points=opp_pts,
                    undercut_ready=(opp_dw_after <= dw_h),
                    # Derived features
                    discard_pile_size=len(discard_pile),
                    n_opponent_pickups=len(player_pickups[opp]),
                    n_opponent_discards=len(player_discards[opp]),
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


def build_trace_rich_dataset(n_games: int = 500, max_stock: int = 6,
                             verbose: bool = True) -> List[TraceRichSpot]:
    """Build and return the trace-rich labelled dataset."""
    builder = TraceRichDatasetBuilder(max_stock=max_stock)
    return builder.build(n_games=n_games, verbose=verbose)


def save_trace_rich_dataset(spots: List[TraceRichSpot], path: str):
    """Serialise trace-rich dataset to JSON."""
    data = [s.to_dict() for s in spots]
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def trace_rich_dataset_summary(spots: List[TraceRichSpot]) -> Dict[str, Any]:
    """Summary statistics focusing on trace signal availability."""
    if not spots:
        return {'n': 0}

    n = len(spots)
    outcomes = {'gin': 0, 'knock_win': 0, 'undercut': 0}
    n_with_pickups = 0
    n_with_discards = 0
    n_with_declines = 0
    n_with_any_trace = 0
    total_pickups = 0
    total_discards = 0
    total_declines = 0
    opp_dw_vals = []

    for s in spots:
        outcomes[s.outcome] += 1
        opp_dw_vals.append(s.opp_deadwood_after_layoff)

        has_pickups = len(s.known_opponent_pickups) > 0
        has_discards = len(s.known_opponent_discards) > 0
        has_declines = len(s.upcard_declines) > 0

        if has_pickups:
            n_with_pickups += 1
        if has_discards:
            n_with_discards += 1
        if has_declines:
            n_with_declines += 1
        if has_pickups or has_discards or has_declines:
            n_with_any_trace += 1

        total_pickups += len(s.known_opponent_pickups)
        total_discards += len(s.known_opponent_discards)
        total_declines += len(s.upcard_declines)

    return {
        'n': n,
        'outcomes': outcomes,
        'undercut_rate': round(outcomes['undercut'] / n, 4),
        'mean_opp_dw_after_layoff': round(sum(opp_dw_vals) / n, 2),
        'frac_dw_le5': round(sum(1 for d in opp_dw_vals if d <= 5) / n, 4),
        'trace_coverage': {
            'spots_with_any_trace': n_with_any_trace,
            'pct_with_any_trace': round(n_with_any_trace / n * 100, 1),
            'spots_with_pickups': n_with_pickups,
            'pct_with_pickups': round(n_with_pickups / n * 100, 1),
            'spots_with_discards': n_with_discards,
            'pct_with_discards': round(n_with_discards / n * 100, 1),
            'spots_with_declines': n_with_declines,
            'pct_with_declines': round(n_with_declines / n * 100, 1),
            'mean_pickups_per_spot': round(total_pickups / n, 2),
            'mean_discards_per_spot': round(total_discards / n, 2),
            'mean_declines_per_spot': round(total_declines / n, 2),
        },
    }
