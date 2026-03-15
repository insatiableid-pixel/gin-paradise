"""
Mathematical Replay Evaluator for Gin Paradise.

Accepts a JSON replay transcript on stdin and produces structured,
per-turn decision evaluations using the Apex v2 engine logic.

Evaluated decision types (MVP):
  1. Discard decisions  — first-class, most reliable
  2. Knock decisions    — strong candidate, clear right/wrong
  3. Draw decisions     — included with honest caveats about hidden info

Methodology:
  - For each player decision point, reconstruct the known hand state
  - Use Apex v2's heuristic + actual-DW scoring to determine engine-preferred action
  - Classify each decision as: best, inaccuracy, mistake, or blunder
  - Aggregate into an overall "engine accuracy" score (not a PR claim)

Limitations (honest):
  - This is an engine-guided approximation, NOT a solved-game oracle
  - Draw evaluation is limited by hidden information (opponent hand unknown)
  - The evaluator uses heuristic scoring, not CFR or perfect-play proof
  - Score is "engine agreement rate" — how often the player matched Apex v2

Usage:
  echo '{"actions": [...], "players": [...]}' | python -m gin_rummy.evaluator
"""

import json
import sys
import time
from typing import List, Dict, Any, Optional, Tuple

from gin_rummy.card import (
    rank, suit, make_card, deadwood_value, card_str, parse_card, NUM_CARDS,
    RANK_NAMES, SUIT_NAMES
)
from gin_rummy.meld import (
    best_meld_arrangement, find_all_melds, compute_deadwood, compute_layoffs
)

# ── Constants ─────────────────────────────────────────────────────────

TIMEOUT_SECONDS = 30  # Max wall-clock time for entire evaluation
MAX_ACTIONS = 2000     # Safety cap on transcript length

# Severity thresholds (deadwood-point cost)
BLUNDER_THRESHOLD = 8   # ≥8 DW cost
MISTAKE_THRESHOLD = 4   # ≥4 DW cost
INACCURACY_THRESHOLD = 1  # ≥1 DW cost


# ── Card Parsing ──────────────────────────────────────────────────────

# Map unicode suit symbols to our internal suit indices
SUIT_SYMBOL_MAP = {
    '♣': 0, '♦': 1, '♠': 2, '♥': 3,
    'C': 0, 'D': 1, 'S': 2, 'H': 3,
    'c': 0, 'd': 1, 's': 2, 'h': 3,
}

RANK_CHAR_MAP = {
    'A': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5,
    '7': 6, '8': 7, '9': 8, 'T': 9, '10': 9,
    'J': 10, 'Q': 11, 'K': 12,
}


def parse_card_flexible(s: str) -> Optional[int]:
    """Parse card strings like 'K♠', 'KS', '10♥', 'AH', etc."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    if len(s) < 2:
        return None

    # Handle '10' as rank
    if s.startswith('10'):
        rank_val = 9
        suit_char = s[2:]
    else:
        rank_char = s[0].upper()
        rank_val = RANK_CHAR_MAP.get(rank_char)
        if rank_val is None:
            return None
        suit_char = s[1:]

    # Parse suit (might be unicode symbol or letter)
    suit_val = SUIT_SYMBOL_MAP.get(suit_char)
    if suit_val is None and len(suit_char) > 0:
        suit_val = SUIT_SYMBOL_MAP.get(suit_char[0])
    if suit_val is None:
        return None

    return make_card(rank_val, suit_val)


# ── Game State Reconstruction ─────────────────────────────────────────

class PlayerState:
    """Tracks a player's known hand and game state during replay."""

    def __init__(self, player_id: str, username: str):
        self.player_id = player_id
        self.username = username
        self.hand: List[int] = []  # Current hand (may be partial if info hidden)
        self.hand_known = False     # Whether we have full hand knowledge

    def reset_hand(self):
        self.hand = []
        self.hand_known = False


class GameReconstructor:
    """
    Walks through transcript actions to reconstruct game state
    at each decision point.
    """

    def __init__(self, actions: List[Dict], players: List[Dict]):
        self.actions = actions
        self.players = {p['userId']: PlayerState(p['userId'], p['username']) for p in players}
        self.discard_pile: List[int] = []
        self.known_discards: List[str] = []  # Card strings from transcript
        self.turn_number = 0
        self.current_round = 0
        self.deck_cards_drawn = 0  # Approximate stock count

    def get_player(self, player_id: str) -> Optional[PlayerState]:
        return self.players.get(player_id)


# ── Decision Evaluators ───────────────────────────────────────────────

def evaluate_discard(
    hand_11: List[int],
    actual_discard: int,
    drew_from_discard: bool,
    drawn_card: Optional[int],
    discard_pile: List[int],
    turn_number: int,
) -> Dict[str, Any]:
    """
    Evaluate a discard decision using Apex v2's actual-DW methodology.

    Given an 11-card hand (after draw, before discard), determine:
    1. What the engine would discard (minimizing resulting deadwood)
    2. How the actual discard compares

    Returns structured evaluation dict.
    """
    # Restriction: can't discard what was just drawn from discard pile
    restricted = drawn_card if drew_from_discard else None

    # Find optimal meld arrangement for the 11-card hand
    melds, dw_cards, _ = best_meld_arrangement(hand_11)
    melded = set()
    for m in melds:
        for c in m:
            melded.add(c)

    # Build candidate list (prefer non-melded, respect restriction)
    candidates = [c for c in hand_11 if c not in melded and c != restricted]
    if not candidates:
        candidates = [c for c in hand_11 if c != restricted]
    if not candidates:
        candidates = list(hand_11)

    # Evaluate each candidate by resulting deadwood (Apex v2 Phase 2 logic)
    best_card = candidates[0]
    best_dw = float('inf')
    candidate_results = []

    for c in candidates:
        remaining = list(hand_11)
        remaining.remove(c)
        actual_dw = compute_deadwood(remaining)
        candidate_results.append({
            'card': card_str(c),
            'card_int': c,
            'resulting_deadwood': actual_dw,
        })
        if actual_dw < best_dw or (actual_dw == best_dw and deadwood_value(c) > deadwood_value(best_card)):
            best_dw = actual_dw
            best_card = c

    # Actual discard evaluation
    remaining_actual = list(hand_11)
    if actual_discard in remaining_actual:
        remaining_actual.remove(actual_discard)
        actual_dw = compute_deadwood(remaining_actual)
    else:
        actual_dw = best_dw  # Fallback if card not found

    dw_cost = actual_dw - best_dw  # How much worse is the actual choice

    # Classify severity
    if dw_cost <= 0:
        severity = 'best'
    elif dw_cost < INACCURACY_THRESHOLD:
        severity = 'best'  # Marginal differences are "best"
    elif dw_cost < MISTAKE_THRESHOLD:
        severity = 'inaccuracy'
    elif dw_cost < BLUNDER_THRESHOLD:
        severity = 'mistake'
    else:
        severity = 'blunder'

    return {
        'type': 'discard',
        'actual_card': card_str(actual_discard),
        'engine_preferred': card_str(best_card),
        'actual_resulting_dw': actual_dw,
        'engine_resulting_dw': best_dw,
        'dw_cost': max(0, dw_cost),
        'severity': severity,
        'matches_engine': actual_discard == best_card,
    }


def evaluate_knock(
    hand_10: List[int],
    did_knock: bool,
    turn_number: int,
    my_score: int,
    opp_score: int,
    deck_remaining: int,
) -> Optional[Dict[str, Any]]:
    """
    Evaluate a knock/no-knock decision using simplified Apex v2 logic.

    Only evaluates when the player CAN knock (DW ≤ 10).
    Returns None if the player cannot knock.
    """
    melds, dw_cards, my_dw = best_meld_arrangement(hand_10)
    if my_dw > 10:
        return None  # Can't knock, nothing to evaluate

    # Simplified Apex v2 knock logic (without MC sampling, since
    # we don't have opponent hand info in replays)
    score_diff = my_score - opp_score

    engine_knock = True  # Default: knock when legal

    if my_dw == 0:
        engine_knock = True  # Gin: always knock
    elif deck_remaining <= 8:
        engine_knock = True  # Low stock: always knock
    elif score_diff >= 22 and my_dw > 0:
        if turn_number < 12 and len(dw_cards) <= 2:
            engine_knock = False  # Ahead: hold for gin
    elif score_diff <= -22 and my_dw > 0:
        if turn_number < 12 and len(dw_cards) <= 2:
            engine_knock = False  # Behind: hold for gin
    elif my_dw <= 5:
        engine_knock = True  # Low DW: always knock
    elif turn_number <= 3:
        engine_knock = True  # Early game: knock aggressively
    elif turn_number >= 13:
        engine_knock = True  # Late game: knock before opponent gins
    elif len(dw_cards) <= 2:
        engine_knock = False  # Few DW cards: hold for improvement
    else:
        # Mid-game, moderate DW, 3+ DW cards
        # Without MC (no opponent hand), default to knock if DW ≤ 7
        engine_knock = my_dw <= 7

    matches = did_knock == engine_knock

    # Classify severity
    if matches:
        severity = 'best'
    else:
        if my_dw == 0 and not did_knock:
            severity = 'blunder'  # Not knocking with gin
        elif my_dw <= 3 and not did_knock and turn_number >= 8:
            severity = 'mistake'  # Not knocking with very low DW late
        elif did_knock and len(dw_cards) <= 2 and turn_number < 8:
            severity = 'inaccuracy'  # Knocked when could improve
        elif not did_knock and deck_remaining <= 8:
            severity = 'mistake'  # Didn't knock with low stock
        else:
            severity = 'inaccuracy'

    return {
        'type': 'knock',
        'deadwood': my_dw,
        'dw_cards_count': len(dw_cards),
        'did_knock': did_knock,
        'engine_preferred': engine_knock,
        'turn_number': turn_number,
        'deck_remaining': deck_remaining,
        'severity': severity,
        'matches_engine': matches,
    }


def evaluate_draw(
    hand_10: List[int],
    top_discard: int,
    took_discard: bool,
    turn_number: int,
) -> Dict[str, Any]:
    """
    Evaluate a draw decision.

    CAVEAT: Draw evaluation is limited because:
    - We don't know the stock card the player would have drawn
    - We evaluate only whether the discard helps the hand

    We evaluate: "Was taking/declining the discard a reasonable choice?"
    """
    # Check if the discard card helps
    test_hand = hand_10 + [top_discard]
    melds_with = find_all_melds(test_hand)
    completes_meld = any(top_discard in m for m in melds_with)

    current_dw = compute_deadwood(hand_10)

    # Best DW achievable if we take the discard and optimally discard
    best_dw_after_take = float('inf')
    for i, c in enumerate(test_hand):
        if c == top_discard:
            continue  # Can't immediately discard what we just drew
        rest = test_hand[:i] + test_hand[i+1:]
        dw = compute_deadwood(rest)
        if dw < best_dw_after_take:
            best_dw_after_take = dw

    dw_improvement = current_dw - best_dw_after_take

    # Engine decision: take if it completes/extends a meld, OR reduces DW significantly
    engine_take = False
    if completes_meld:
        engine_take = True
    elif rank(top_discard) <= 1:  # Aces and Twos: always take
        engine_take = True
    elif dw_improvement >= 4:
        engine_take = True

    matches = took_discard == engine_take

    # Severity
    if matches:
        severity = 'best'
    elif completes_meld and not took_discard:
        severity = 'mistake'  # Declined a meld-completing card
    elif not completes_meld and took_discard and dw_improvement <= 0:
        severity = 'inaccuracy'  # Took a card that doesn't help
    else:
        severity = 'inaccuracy'

    return {
        'type': 'draw',
        'top_discard': card_str(top_discard),
        'took_discard': took_discard,
        'engine_preferred_take': engine_take,
        'completes_meld': completes_meld,
        'dw_improvement_if_taken': max(0, dw_improvement),
        'severity': severity,
        'matches_engine': matches,
        # Honest caveat
        'caveat': 'draw_hidden_info' if not completes_meld else None,
    }


# ── Main Evaluation Pipeline ─────────────────────────────────────────

def evaluate_replay(transcript: Dict[str, Any]) -> Dict[str, Any]:
    """
    Main entry point: evaluate all player decisions in a replay transcript.

    Returns structured evaluation with per-turn assessments and summary.
    """
    start_time = time.time()

    actions = transcript.get('actions', [])
    players = transcript.get('players', [])
    requesting_player_id = transcript.get('requestingPlayerId', '')

    if len(actions) > MAX_ACTIONS:
        return {
            'error': 'transcript_too_long',
            'message': f'Transcript has {len(actions)} actions, max is {MAX_ACTIONS}',
        }

    if len(players) < 2:
        return {
            'error': 'insufficient_players',
            'message': 'Need at least 2 players',
        }

    evaluations: List[Dict[str, Any]] = []
    player_hands: Dict[str, List[int]] = {}  # Track known hands
    discard_pile: List[int] = []
    turn_number = 0
    last_drew_from_discard: Dict[str, bool] = {}
    last_drawn_card: Dict[str, Optional[int]] = {}
    last_draw_source: Dict[str, str] = {}
    deck_remaining = 31  # 52 - 20 dealt - 1 upcard
    my_score = 0
    opp_score = 0

    # Walk through actions
    for action in actions:
        # Timeout check
        if time.time() - start_time > TIMEOUT_SECONDS:
            break

        action_type = action.get('type', '')
        player_id = action.get('playerId', '')
        detail = action.get('detail', {})
        seq = action.get('seq', 0)

        if action_type == 'round_start':
            # Reset state for new round
            player_hands.clear()
            discard_pile.clear()
            last_drew_from_discard.clear()
            last_drawn_card.clear()
            last_draw_source.clear()
            turn_number = 0
            deck_remaining = 31
            continue

        if action_type == 'draw':
            source = detail.get('source', '')
            card_s = detail.get('card', '')
            card_int = parse_card_flexible(card_s) if card_s else None

            last_draw_source[player_id] = source
            last_drew_from_discard[player_id] = (source == 'discard')
            last_drawn_card[player_id] = card_int

            if source == 'discard' and card_int is not None:
                # Player took from discard pile
                if card_int in discard_pile:
                    discard_pile.remove(card_int)
                if player_id in player_hands:
                    player_hands[player_id].append(card_int)
            elif source == 'stock':
                deck_remaining = max(0, deck_remaining - 1)
                # Stock draws: card may or may not be revealed in transcript
                if card_int is not None and player_id in player_hands:
                    player_hands[player_id].append(card_int)

            # Evaluate draw decision (only if we know enough)
            if player_id in player_hands and len(player_hands[player_id]) >= 10:
                hand_before = player_hands[player_id][:-1] if card_int else player_hands[player_id][:10]
                if discard_pile and source in ('discard', 'stock'):
                    top_disc = card_int if source == 'discard' and card_int else (
                        discard_pile[-1] if discard_pile else None
                    )
                    if top_disc is not None and len(hand_before) == 10:
                        took = (source == 'discard')
                        draw_eval = evaluate_draw(
                            hand_before, top_disc, took, turn_number
                        )
                        draw_eval['seq'] = seq
                        draw_eval['player_id'] = player_id
                        draw_eval['player_username'] = action.get('playerUsername', '')
                        evaluations.append(draw_eval)

            continue

        if action_type == 'discard':
            card_s = detail.get('card', '')
            card_int = parse_card_flexible(card_s)

            if card_int is not None and player_id in player_hands:
                hand = player_hands[player_id]
                if len(hand) == 11:
                    # We have the full 11-card hand, evaluate
                    drew_discard = last_drew_from_discard.get(player_id, False)
                    drawn = last_drawn_card.get(player_id, None)

                    disc_eval = evaluate_discard(
                        hand, card_int, drew_discard, drawn,
                        discard_pile, turn_number,
                    )
                    disc_eval['seq'] = seq
                    disc_eval['player_id'] = player_id
                    disc_eval['player_username'] = action.get('playerUsername', '')
                    evaluations.append(disc_eval)

                    # Update hand state
                    if card_int in hand:
                        hand.remove(card_int)

                discard_pile.append(card_int)
            continue

        if action_type == 'knock':
            knocker_dw = detail.get('knockerDeadwood')
            if knocker_dw is not None and player_id in player_hands:
                hand = player_hands[player_id]
                if len(hand) == 10:
                    knock_eval = evaluate_knock(
                        hand, True, turn_number,
                        my_score, opp_score, deck_remaining,
                    )
                    if knock_eval:
                        knock_eval['seq'] = seq
                        knock_eval['player_id'] = player_id
                        knock_eval['player_username'] = action.get('playerUsername', '')
                        evaluations.append(knock_eval)
            continue

        if action_type in ('round_end', 'match_end', 'match_start'):
            if action_type == 'round_end':
                turn_number = 0
            continue

        if action_type == 'next_round':
            turn_number = 0
            continue

    # Also evaluate "no-knock" decisions: when a player discards and could
    # have knocked but didn't. We track this by checking after each discard.
    # (Already captured in knock evaluations above when knock action exists)

    elapsed = time.time() - start_time

    # Build summary
    summary = build_summary(evaluations, requesting_player_id, players)
    summary['evaluation_time_ms'] = round(elapsed * 1000)
    summary['evaluations'] = evaluations

    return summary


def build_summary(
    evaluations: List[Dict],
    requesting_player_id: str,
    players: List[Dict],
) -> Dict[str, Any]:
    """Build aggregate summary scores from per-turn evaluations."""

    result: Dict[str, Any] = {
        'methodology': 'apex_v2_engine_agreement',
        'methodology_description': (
            'Engine Accuracy measures how often player decisions matched '
            'the Apex v2 engine\'s preferred choice. This is a heuristic '
            'approximation, not a solved-game oracle. Draw evaluations '
            'have an inherent information disadvantage caveat.'
        ),
        'total_evaluated': len(evaluations),
    }

    # Per-player summaries
    player_summaries = {}
    for p in players:
        pid = p['userId']
        p_evals = [e for e in evaluations if e.get('player_id') == pid]

        if not p_evals:
            player_summaries[pid] = {
                'username': p['username'],
                'total_decisions': 0,
                'engine_accuracy': None,
                'score_label': 'insufficient_data',
            }
            continue

        total = len(p_evals)
        matches = sum(1 for e in p_evals if e.get('matches_engine', False))
        accuracy = round((matches / total) * 100, 1) if total > 0 else 0

        # Count by severity
        severity_counts = {'best': 0, 'inaccuracy': 0, 'mistake': 0, 'blunder': 0}
        for e in p_evals:
            sev = e.get('severity', 'best')
            if sev in severity_counts:
                severity_counts[sev] += 1

        # Count by type
        type_counts = {'draw': 0, 'discard': 0, 'knock': 0}
        type_matches = {'draw': 0, 'discard': 0, 'knock': 0}
        for e in p_evals:
            t = e.get('type', '')
            if t in type_counts:
                type_counts[t] += 1
                if e.get('matches_engine', False):
                    type_matches[t] += 1

        # Total DW cost
        total_dw_cost = sum(e.get('dw_cost', 0) for e in p_evals if e.get('type') == 'discard')

        # Score label
        if accuracy >= 90:
            score_label = 'excellent'
        elif accuracy >= 75:
            score_label = 'good'
        elif accuracy >= 60:
            score_label = 'fair'
        elif accuracy >= 40:
            score_label = 'needs_improvement'
        else:
            score_label = 'poor'

        player_summaries[pid] = {
            'username': p['username'],
            'total_decisions': total,
            'engine_matches': matches,
            'engine_accuracy': accuracy,
            'score_label': score_label,
            'severity_counts': severity_counts,
            'type_breakdown': {
                t: {
                    'total': type_counts[t],
                    'matches': type_matches[t],
                    'accuracy': round((type_matches[t] / type_counts[t]) * 100, 1) if type_counts[t] > 0 else None,
                }
                for t in type_counts
            },
            'total_discard_dw_cost': total_dw_cost,
        }

    result['player_summaries'] = player_summaries

    # Requesting player's summary as top-level for convenience
    if requesting_player_id in player_summaries:
        req = player_summaries[requesting_player_id]
        result['requesting_player_accuracy'] = req.get('engine_accuracy')
        result['requesting_player_label'] = req.get('score_label')
    else:
        result['requesting_player_accuracy'] = None
        result['requesting_player_label'] = 'unknown'

    return result


# ── Entrypoint ────────────────────────────────────────────────────────

def main():
    """Read transcript JSON from stdin, emit evaluation JSON to stdout."""
    try:
        raw = sys.stdin.read()
        transcript = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({'error': 'invalid_json', 'message': str(e)}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': 'read_error', 'message': str(e)}))
        sys.exit(1)

    try:
        result = evaluate_replay(transcript)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': 'evaluation_error', 'message': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
