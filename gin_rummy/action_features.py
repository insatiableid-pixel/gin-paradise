"""
Action-Conditioned Draw Feature Encoder for Gin Rummy.

Encodes draw-decision-specific features that capture the value of
taking from the discard pile vs drawing from stock. The feature set
is designed to answer: "is take better than stock?"

Feature groups:
  1. Candidate discard card identity (rank, suit one-hot, deadwood value)
  2. Immediate deadwood impact (swing after take, best possible after take)
  3. Meld completion/extension features for the candidate card
  4. Near-meld formation potential
  5. Information-reveal proxy features
  6. Hand composition summary (compact, not full 52-dim)
  7. Phase / score context
  8. Opponent model signals

This produces a compact, focused feature vector (not the full 139-dim PBS).
"""

import math
from gin_rummy.card import rank, suit, make_card, deadwood_value, NUM_CARDS, NUM_RANKS, NUM_SUITS
from gin_rummy.meld import (
    best_meld_arrangement, find_all_melds, compute_deadwood, count_near_melds
)


# Fixed feature vector length for action-conditioned model
ACTION_FEATURE_DIM = 42


def encode_draw_action(hand, top_discard, game_state, opponent_model=None, target_score=100):
    """
    Encode features for the draw decision.

    Args:
        hand: list of 10 card ints (the acting player's hand)
        top_discard: int, the card on top of discard pile
        game_state: dict with turn_number, my_score, opp_score, deck_remaining, discard_pile
        opponent_model: OpponentModel instance (optional, for info-reveal features)
        target_score: target score for the game (default 100)

    Returns:
        list of floats, length ACTION_FEATURE_DIM
    """
    features = []
    hand_set = set(hand)

    # ── 1. Candidate discard card identity (6 features) ─────────
    card_rank = rank(top_discard)
    card_suit_val = suit(top_discard)
    features.append(card_rank / 12.0)                      # normalized rank
    features.append(deadwood_value(top_discard) / 10.0)    # normalized DW value
    # One-hot suit (4 features)
    for s in range(NUM_SUITS):
        features.append(1.0 if card_suit_val == s else 0.0)

    # ── 2. Immediate deadwood impact (5 features) ───────────────
    current_dw = compute_deadwood(hand)
    features.append(current_dw / 100.0)                    # current deadwood normalized

    # DW after taking the discard (best possible after discarding worst)
    take_hand = list(hand) + [top_discard]
    best_take_dw = _best_discard_dw(take_hand, restricted=top_discard)
    features.append(best_take_dw / 100.0)                  # best DW after take

    # DW swing: how much does taking improve DW?
    dw_swing = current_dw - best_take_dw
    features.append(dw_swing / 50.0)                       # normalized swing (positive = improvement)

    # Binary: does taking improve DW at all?
    features.append(1.0 if dw_swing > 0 else 0.0)

    # Binary: does taking bring us to knock range?
    features.append(1.0 if best_take_dw <= 10 else 0.0)

    # ── 3. Meld completion/extension features (5 features) ──────
    # Does the card complete a meld?
    melds_with = find_all_melds(take_hand)
    completes_meld = any(top_discard in m for m in melds_with)
    features.append(1.0 if completes_meld else 0.0)

    # How many melds does it participate in?
    melds_involving = sum(1 for m in melds_with if top_discard in m)
    features.append(min(melds_involving, 4) / 4.0)         # capped at 4

    # Existing melds without the card vs with
    melds_without, _, dw_without = best_meld_arrangement(hand)
    melds_after_take, _, dw_after_take = best_meld_arrangement(take_hand)

    # NOTE: dw_after_take includes the card, so it's for an 11-card hand
    # We want the meld count change
    features.append(float(len(melds_after_take) - len(melds_without)))

    # Does it form a new near-meld?
    # Check if card pairs with hand cards (same rank or adjacent suit)
    same_rank_count = sum(1 for c in hand if rank(c) == card_rank and suit(c) != card_suit_val)
    features.append(same_rank_count / 3.0)                 # max 3 same-rank partners

    adj_suit_count = sum(1 for c in hand if suit(c) == card_suit_val
                         and 0 < abs(rank(c) - card_rank) <= 2)
    features.append(adj_suit_count / 4.0)                  # max ~4 adjacent suit

    # ── 4. Near-meld formation summary (3 features) ─────────────
    doubles_before, triangles_before = count_near_melds(hand)
    # After hypothetical take + best discard
    hand_after_take = _get_hand_after_best_discard(take_hand, restricted=top_discard)
    doubles_after, triangles_after = count_near_melds(hand_after_take)

    features.append((doubles_after - doubles_before) / 5.0)    # near-meld improvement
    features.append((triangles_after - triangles_before) / 3.0)
    features.append((doubles_after + triangles_after) / 10.0)  # total near-meld density

    # ── 5. Information-reveal proxy features (4 features) ───────
    # Taking from discard reveals info to opponent
    # Card's deadwood value as proxy for info cost (high DW cards are more costly to reveal)
    features.append(deadwood_value(top_discard) / 10.0)    # info reveal cost proxy

    # Discard pile depth (more discards = less info cost of one more)
    discard_pile = game_state.get('discard_pile', [])
    features.append(len(discard_pile) / 32.0)

    # How many of our hand cards are "near" the discard card?
    # (If we already have related cards, opponent may infer our shape)
    related_count = same_rank_count + adj_suit_count
    features.append(min(related_count, 6) / 6.0)

    # Are we already revealing shape? (have we been taking from discard a lot?)
    # Proxy: how many of our hand cards were once in the discard pile?
    discard_set = set(discard_pile)
    hand_from_discard = sum(1 for c in hand if c in discard_set)
    features.append(hand_from_discard / 10.0)

    # ── 6. Hand composition summary (7 features) ───────────────
    melds, dw_cards, dw = best_meld_arrangement(hand)
    features.append(float(len(melds)) / 4.0)               # meld count
    features.append(float(len(dw_cards)) / 10.0)            # DW card count
    features.append(1.0 if dw <= 10 else 0.0)               # already can knock
    features.append(1.0 if dw == 0 else 0.0)                # already gin

    # Average DW value of deadwood cards
    if dw_cards:
        avg_dw_card = sum(deadwood_value(c) for c in dw_cards) / len(dw_cards)
    else:
        avg_dw_card = 0.0
    features.append(avg_dw_card / 10.0)

    # Rank diversity in hand
    rank_set = set(rank(c) for c in hand)
    features.append(len(rank_set) / NUM_RANKS)

    # Suit concentration
    suit_counts = [0] * NUM_SUITS
    for c in hand:
        suit_counts[suit(c)] += 1
    features.append(max(suit_counts) / 10.0)

    # ── 7. Phase / score context (7 features) ──────────────────
    turn_number = game_state.get('turn_number', 0)
    deck_remaining = game_state.get('deck_remaining', 31)
    my_score = game_state.get('my_score', 0)
    opp_score = game_state.get('opp_score', 0)

    features.append(turn_number / 50.0)
    features.append(deck_remaining / 31.0)
    features.append(1.0 if turn_number < 4 else 0.0)       # early game
    features.append(1.0 if turn_number >= 12 else 0.0)     # late game

    features.append(my_score / target_score)
    features.append(opp_score / target_score)
    features.append((my_score - opp_score) / target_score)

    # ── 8. Opponent model signals (5 features) ─────────────────
    if opponent_model is not None:
        # How much does the opponent want this card? (based on model weights)
        opp_weight = opponent_model.weight[top_discard]
        features.append(min(opp_weight, 5.0) / 5.0)

        # Average opponent weight of same-rank cards
        same_rank_weights = [opponent_model.weight[make_card(card_rank, s)]
                             for s in range(NUM_SUITS) if s != card_suit_val
                             and opponent_model.card_state[make_card(card_rank, s)] == 3]  # UNKNOWN
        features.append(sum(same_rank_weights) / max(len(same_rank_weights), 1) / 5.0
                        if same_rank_weights else 0.0)

        # Number of known opponent cards
        known_opp = opponent_model.get_known_opponent_cards()
        features.append(len(known_opp) / 10.0)

        # Is the card safe to deny? (would completing opponent's meld)
        from gin_rummy.opponent_model import UNKNOWN
        opp_related = 0
        for opp_c in known_opp:
            if rank(opp_c) == card_rank:
                opp_related += 1
            if suit(opp_c) == card_suit_val and abs(rank(opp_c) - card_rank) <= 2:
                opp_related += 1
        features.append(min(opp_related, 4) / 4.0)

        # Stock concentration (how many unseen/unknown cards remain?)
        unseen = opponent_model.sample_unseen_cards()
        features.append(len(unseen) / 31.0)
    else:
        features.extend([0.5, 0.5, 0.0, 0.0, 1.0])

    assert len(features) == ACTION_FEATURE_DIM, f"Expected {ACTION_FEATURE_DIM} features, got {len(features)}"
    return features


def get_action_feature_names():
    """Return human-readable names for each action feature dimension."""
    return [
        # Card identity (6)
        'card_rank_norm', 'card_dw_norm',
        'card_suit_C', 'card_suit_D', 'card_suit_S', 'card_suit_H',
        # Immediate DW impact (5)
        'current_dw_norm', 'best_take_dw_norm', 'dw_swing_norm',
        'dw_improves', 'take_reaches_knock',
        # Meld completion (5)
        'completes_meld', 'melds_involving_norm', 'meld_count_delta',
        'same_rank_partners', 'adj_suit_partners',
        # Near-meld (3)
        'doubles_delta', 'triangles_delta', 'near_meld_density',
        # Info reveal (4)
        'info_reveal_cost', 'pile_depth_norm', 'related_in_hand',
        'hand_from_discard',
        # Hand summary (7)
        'meld_count', 'dw_card_count', 'can_knock', 'is_gin',
        'avg_dw_card_value', 'rank_diversity', 'max_suit_conc',
        # Phase/score (7)
        'turn_norm', 'deck_remaining_norm', 'is_early', 'is_late',
        'my_score_norm', 'opp_score_norm', 'score_diff_norm',
        # Opponent model (5)
        'opp_card_weight', 'opp_same_rank_weight', 'known_opp_count',
        'opp_related_cards', 'unseen_count_norm',
    ]


def _best_discard_dw(hand_11, restricted=None):
    """Find minimum deadwood achievable by discarding one card from 11-card hand."""
    best_dw = 999
    for i, c in enumerate(hand_11):
        if c == restricted:
            continue
        remaining = hand_11[:i] + hand_11[i+1:]
        dw = compute_deadwood(remaining)
        if dw < best_dw:
            best_dw = dw
    return best_dw


def _get_hand_after_best_discard(hand_11, restricted=None):
    """Return 10-card hand after making the best deadwood-minimizing discard."""
    best_dw = 999
    best_hand = None
    for i, c in enumerate(hand_11):
        if c == restricted:
            continue
        remaining = hand_11[:i] + hand_11[i+1:]
        dw = compute_deadwood(remaining)
        if dw < best_dw:
            best_dw = dw
            best_hand = remaining
    if best_hand is None:
        return hand_11[:10]
    return best_hand
