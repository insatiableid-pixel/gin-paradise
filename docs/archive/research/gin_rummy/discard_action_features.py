"""
Action-Conditioned Discard Feature Encoder for Gin Rummy.

Encodes candidate-level features for discard decisions from 11-card
post-draw hands. Each candidate discard gets its own feature vector,
enabling grouped ranking within a single hand/state.

Feature groups:
  1. Candidate card identity (rank, suit one-hot, deadwood value)
  2. Post-discard deadwood impact (resulting DW, delta from best)
  3. Meld destruction features (breaks existing meld, near-meld loss)
  4. Opportunity cost / near-meld preservation
  5. Opponent safety / exposure proxy
  6. Draw context (was card just drawn, restricted status)
  7. Hand composition summary (melds, DW cards, knock proximity)
  8. Phase / score context
  9. Opponent model signals

This produces a compact, focused feature vector per candidate.
"""

from collections import defaultdict
from gin_rummy.card import rank, suit, make_card, deadwood_value, NUM_CARDS, NUM_RANKS, NUM_SUITS
from gin_rummy.meld import (
    best_meld_arrangement, find_all_melds, compute_deadwood, count_near_melds
)

# Fixed feature vector length for discard action-conditioned model
DISCARD_FEATURE_DIM = 38


def encode_discard_candidate(hand_11, candidate, drew_from_discard, drawn_card,
                              game_state, opponent_model=None, target_score=100):
    """
    Encode features for a single discard candidate from an 11-card hand.

    Args:
        hand_11: list of 11 card ints (post-draw hand)
        candidate: int, the candidate card to discard
        drew_from_discard: bool, whether the player drew from discard
        drawn_card: int or None, the card that was drawn
        game_state: dict with turn_number, my_score, opp_score, deck_remaining, discard_pile
        opponent_model: OpponentModel instance (optional)
        target_score: target score for the game (default 100)

    Returns:
        list of floats, length DISCARD_FEATURE_DIM
    """
    features = []
    hand_set = set(hand_11)
    card_rank = rank(candidate)
    card_suit_val = suit(candidate)

    # ── 1. Candidate card identity (6 features) ─────────────────
    features.append(card_rank / 12.0)                       # normalized rank
    features.append(deadwood_value(candidate) / 10.0)       # normalized DW value
    # One-hot suit (4 features)
    for s in range(NUM_SUITS):
        features.append(1.0 if card_suit_val == s else 0.0)

    # ── 2. Post-discard deadwood impact (4 features) ────────────
    # Current best arrangement for full 11-card hand
    melds_11, dw_cards_11, dw_11 = best_meld_arrangement(hand_11)
    melded_11 = set()
    for m in melds_11:
        for c in m:
            melded_11.add(c)

    # DW after discarding this candidate
    remaining = [c for c in hand_11 if c != candidate]
    post_dw = compute_deadwood(remaining)
    features.append(post_dw / 100.0)                        # post-discard DW

    # Best possible DW (discard the best candidate)
    best_post_dw = _best_post_discard_dw(hand_11, drew_from_discard, drawn_card)
    features.append(best_post_dw / 100.0)                   # best achievable DW

    # DW delta from best (regret of this choice) — 0 is optimal
    dw_delta = post_dw - best_post_dw
    features.append(dw_delta / 50.0)                        # normalized regret

    # Binary: is this the DW-optimal discard?
    features.append(1.0 if dw_delta <= 0 else 0.0)

    # ── 3. Meld destruction features (4 features) ──────────────
    # Is candidate part of a meld in the 11-card arrangement?
    in_meld = 1.0 if candidate in melded_11 else 0.0
    features.append(in_meld)

    # How many melds before vs after discard?
    melds_after, _, _ = best_meld_arrangement(remaining)
    meld_count_delta = len(melds_after) - len(melds_11)
    features.append(float(meld_count_delta))                # negative = lost melds

    # Is candidate part of a meld in the remaining 10-card hand?
    # (Some cards are in melds of 11 but not needed for 10)
    melds_10 = find_all_melds(remaining)
    would_complete_meld_for_10 = any(candidate in m for m in find_all_melds(remaining + [candidate])
                                     if candidate in m)
    # More precisely: does removing this card break a meld?
    meld_count_10 = len(melds_after)
    meld_count_with = len([m for m in find_all_melds(hand_11) if candidate in m])
    features.append(min(meld_count_with, 3) / 3.0)          # melds involving candidate

    # Does candidate have the highest DW value among deadwood cards?
    is_highest_dw = 0.0
    if dw_cards_11:
        max_dw_val = max(deadwood_value(c) for c in dw_cards_11)
        if deadwood_value(candidate) >= max_dw_val and candidate not in melded_11:
            is_highest_dw = 1.0
    features.append(is_highest_dw)

    # ── 4. Near-meld / opportunity cost (4 features) ───────────
    # Near-meld counts before and after
    remaining_set = set(remaining)

    # Same-rank partners in remaining hand
    same_rank_partners = sum(1 for c in remaining if rank(c) == card_rank and suit(c) != card_suit_val)
    features.append(same_rank_partners / 3.0)

    # Adjacent-suit partners in remaining hand
    adj_suit_partners = sum(1 for c in remaining
                            if suit(c) == card_suit_val
                            and 0 < abs(rank(c) - card_rank) <= 2)
    features.append(adj_suit_partners / 4.0)

    # Near-meld change: doubles/triangles before vs after
    doubles_before, triangles_before = count_near_melds(hand_11)
    doubles_after, triangles_after = count_near_melds(remaining)
    near_meld_loss = (doubles_before + triangles_before) - (doubles_after + triangles_after)
    features.append(near_meld_loss / 5.0)                    # positive = lost near-melds

    # Gap-1 run partners (e.g., 5♠ when we have 3♠ — can become run with 4♠)
    gap_run_partners = 0
    for c in remaining:
        if suit(c) == card_suit_val and abs(rank(c) - card_rank) == 2:
            gap_run_partners += 1
    features.append(gap_run_partners / 3.0)

    # ── 5. Opponent safety / exposure (4 features) ─────────────
    if opponent_model is not None:
        from gin_rummy.opponent_model import IN_DISCARD, UNKNOWN

        # How dangerous is this discard for opponent?
        opp_weight = opponent_model.weight[candidate]
        features.append(min(opp_weight, 5.0) / 5.0)

        # Opponent-known related cards
        known_opp = opponent_model.get_known_opponent_cards()
        opp_related = 0
        for opp_c in known_opp:
            if rank(opp_c) == card_rank and suit(opp_c) != card_suit_val:
                opp_related += 1
            if suit(opp_c) == card_suit_val and abs(rank(opp_c) - card_rank) <= 2:
                opp_related += 1
        features.append(min(opp_related, 4) / 4.0)

        # Was this card already declined by opponent? (in discard pile)
        discard_pile = game_state.get('discard_pile', [])
        in_discard_history = 1.0 if candidate in set(discard_pile) else 0.0
        features.append(in_discard_history)

        # Blocked meld paths: how many of the candidate's meld-completing
        # partners are already gone (in discard or our hand)?
        blocked = set(hand_11) | set(c for c in range(NUM_CARDS) if opponent_model.card_state[c] == IN_DISCARD)
        blocked_paths = 0
        total_paths = 0
        # Check set meld paths
        for su in range(NUM_SUITS):
            if su != card_suit_val:
                c = make_card(card_rank, su)
                total_paths += 1
                if c in blocked:
                    blocked_paths += 1
        # Check run meld paths
        for dr in [-1, 1]:
            nr = card_rank + dr
            if 0 <= nr <= 12:
                c = make_card(nr, card_suit_val)
                total_paths += 1
                if c in blocked:
                    blocked_paths += 1
        features.append(blocked_paths / max(total_paths, 1))
    else:
        features.extend([0.5, 0.0, 0.0, 0.5])

    # ── 6. Draw context (3 features) ───────────────────────────
    # Was this the card just drawn?
    is_drawn = 1.0 if candidate == drawn_card else 0.0
    features.append(is_drawn)

    # Is this card restricted (can't discard because drew from discard)?
    restricted = drawn_card if drew_from_discard else None
    is_restricted = 1.0 if candidate == restricted else 0.0
    features.append(is_restricted)

    # Drew from discard flag
    features.append(1.0 if drew_from_discard else 0.0)

    # ── 7. Hand composition summary (6 features) ──────────────
    # These describe the overall hand state (shared across candidates)
    features.append(float(len(melds_11)) / 4.0)              # meld count (11-card)
    features.append(float(len(dw_cards_11)) / 11.0)           # DW card ratio
    features.append(1.0 if best_post_dw <= 10 else 0.0)       # can knock after best discard
    features.append(1.0 if best_post_dw == 0 else 0.0)        # can gin after best discard

    # Average DW value of deadwood cards in the 11-card hand
    if dw_cards_11:
        avg_dw_val = sum(deadwood_value(c) for c in dw_cards_11) / len(dw_cards_11)
    else:
        avg_dw_val = 0.0
    features.append(avg_dw_val / 10.0)

    # Suit concentration (max cards of any suit)
    suit_counts = [0] * NUM_SUITS
    for c in hand_11:
        suit_counts[suit(c)] += 1
    features.append(max(suit_counts) / 11.0)

    # ── 8. Phase / score context (7 features) ─────────────────
    turn_number = game_state.get('turn_number', 0)
    deck_remaining = game_state.get('deck_remaining', 31)
    my_score = game_state.get('my_score', 0)
    opp_score = game_state.get('opp_score', 0)

    features.append(turn_number / 50.0)
    features.append(deck_remaining / 31.0)
    features.append(1.0 if turn_number < 4 else 0.0)         # early game
    features.append(1.0 if turn_number >= 12 else 0.0)        # late game

    features.append(my_score / target_score)
    features.append(opp_score / target_score)
    features.append((my_score - opp_score) / target_score)

    assert len(features) == DISCARD_FEATURE_DIM, \
        f"Expected {DISCARD_FEATURE_DIM} features, got {len(features)}"
    return features


def get_discard_feature_names():
    """Return human-readable names for each discard feature dimension."""
    return [
        # Card identity (6)
        'card_rank_norm', 'card_dw_norm',
        'card_suit_C', 'card_suit_D', 'card_suit_S', 'card_suit_H',
        # Post-discard DW impact (4)
        'post_discard_dw_norm', 'best_post_dw_norm', 'dw_delta_from_best', 'is_dw_optimal',
        # Meld destruction (4)
        'in_meld_11', 'meld_count_delta', 'melds_involving_candidate', 'is_highest_dw_card',
        # Near-meld / opportunity cost (4)
        'same_rank_partners', 'adj_suit_partners', 'near_meld_loss', 'gap_run_partners',
        # Opponent safety (4)
        'opp_card_weight', 'opp_related_cards', 'in_discard_history', 'blocked_meld_paths',
        # Draw context (3)
        'is_drawn_card', 'is_restricted', 'drew_from_discard',
        # Hand summary (6)
        'meld_count_11', 'dw_card_ratio', 'can_knock_after', 'can_gin_after',
        'avg_dw_card_value', 'max_suit_concentration',
        # Phase/score (7)
        'turn_norm', 'deck_remaining_norm', 'is_early', 'is_late',
        'my_score_norm', 'opp_score_norm', 'score_diff_norm',
    ]


def _best_post_discard_dw(hand_11, drew_from_discard, drawn_card):
    """Find minimum deadwood achievable by discarding one card, respecting restrictions."""
    restricted = drawn_card if drew_from_discard else None
    best_dw = 999
    for c in hand_11:
        if c == restricted:
            continue
        remaining = [x for x in hand_11 if x != c]
        dw = compute_deadwood(remaining)
        if dw < best_dw:
            best_dw = dw
    return best_dw


def encode_all_candidates(hand_11, drew_from_discard, drawn_card,
                           game_state, opponent_model=None, target_score=100):
    """
    Encode features for all legal discard candidates from an 11-card hand.

    Returns:
        candidates: list of card ints (legal candidates)
        features: list of feature vectors (one per candidate)
    """
    restricted = drawn_card if drew_from_discard else None

    # Build candidate list: prefer non-melded, respect restriction
    melds, dw_cards, _ = best_meld_arrangement(hand_11)
    melded = set()
    for m in melds:
        for c in m:
            melded.add(c)

    candidates = [c for c in hand_11 if c not in melded and c != restricted]
    if not candidates:
        candidates = [c for c in hand_11 if c != restricted]
    if not candidates:
        candidates = list(hand_11)

    feature_list = []
    for c in candidates:
        feats = encode_discard_candidate(
            hand_11, c, drew_from_discard, drawn_card,
            game_state, opponent_model, target_score
        )
        feature_list.append(feats)

    return candidates, feature_list
