"""
Public Belief State (PBS) Feature Encoder for Gin Rummy.

Encodes the acting player's observable information state into a fixed-length
numeric feature vector suitable for supervised learning of win-probability.

Feature groups:
  1. Hand composition (52-dim binary: which cards are in hand)
  2. Hand statistics (deadwood, meld count, near-meld count, etc.)
  3. Discard pile knowledge (52-dim binary: which cards are in discard)
  4. Discard pile statistics (size, recent discards summary)
  5. Score context (my_score, opp_score, score_diff, normalized)
  6. Turn / game phase context (turn_number, wall_depth, phase indicators)
  7. Knock eligibility features

All features are numeric (float). The encoder is deterministic for a given
game state, which is essential for reproducibility and testing.
"""

import math
from gin_rummy.card import rank, suit, deadwood_value, NUM_CARDS, NUM_RANKS, NUM_SUITS
from gin_rummy.meld import best_meld_arrangement, find_all_melds, compute_deadwood, count_near_melds


# Fixed feature vector length
FEATURE_DIM = 139


def encode_pbs(hand, game_state, target_score=100):
    """
    Encode a public belief state into a fixed-length feature vector.

    Args:
        hand: list of card ints (the acting player's hand, 10 cards)
        game_state: dict with keys:
            - turn_number: int
            - my_score: int
            - opp_score: int
            - deck_remaining: int
            - discard_pile: list of card ints (all visible discards)
        target_score: the target score for the game (default 100)

    Returns:
        list of floats, length FEATURE_DIM
    """
    features = []

    # ── 1. Hand card presence (52 features) ────────────────────────
    hand_set = set(hand)
    for c in range(NUM_CARDS):
        features.append(1.0 if c in hand_set else 0.0)

    # ── 2. Hand statistics (13 features) ───────────────────────────
    melds, dw_cards, dw = best_meld_arrangement(hand)
    all_melds = find_all_melds(hand)

    # Deadwood value (raw and normalized)
    features.append(float(dw))                           # raw deadwood
    features.append(dw / 100.0)                          # normalized deadwood

    # Number of complete melds
    features.append(float(len(melds)))

    # Total cards in melds
    melded_count = sum(len(m) for m in melds)
    features.append(float(melded_count))

    # Number of deadwood cards
    features.append(float(len(dw_cards)))

    # Can knock?
    features.append(1.0 if dw <= 10 else 0.0)

    # Is gin?
    features.append(1.0 if dw == 0 else 0.0)

    # Near-meld counts (doubles and triangles)
    doubles, triangles = count_near_melds(hand)
    features.append(float(doubles))
    features.append(float(triangles))

    # Rank distribution entropy (how spread out are the ranks?)
    rank_counts = [0] * NUM_RANKS
    for c in hand:
        rank_counts[rank(c)] += 1
    entropy = 0.0
    n = len(hand) if hand else 1
    for rc in rank_counts:
        if rc > 0:
            p = rc / n
            entropy -= p * math.log2(p)
    features.append(entropy)

    # Suit distribution (4 values: count per suit, normalized)
    suit_counts = [0] * NUM_SUITS
    for c in hand:
        suit_counts[suit(c)] += 1
    # Max suit concentration (for run potential)
    features.append(max(suit_counts) / max(n, 1))
    # Min suit count
    features.append(min(suit_counts) / max(n, 1))
    # Suit balance (std dev)
    mean_suit = n / NUM_SUITS
    suit_var = sum((sc - mean_suit) ** 2 for sc in suit_counts) / NUM_SUITS
    features.append(math.sqrt(suit_var) / max(n, 1))

    # ── 3. Discard pile card presence (52 features) ────────────────
    discard_pile = game_state.get('discard_pile', [])
    discard_set = set(discard_pile)
    for c in range(NUM_CARDS):
        features.append(1.0 if c in discard_set else 0.0)

    # ── 4. Discard pile statistics (4 features) ────────────────────
    features.append(float(len(discard_pile)))             # pile size
    features.append(len(discard_pile) / 32.0)             # normalized pile size

    # Average deadwood value of discarded cards
    if discard_pile:
        avg_disc_dw = sum(deadwood_value(c) for c in discard_pile) / len(discard_pile)
    else:
        avg_disc_dw = 0.0
    features.append(avg_disc_dw / 10.0)

    # Number of unique ranks in discard pile
    disc_ranks = set(rank(c) for c in discard_pile)
    features.append(len(disc_ranks) / NUM_RANKS)

    # ── 5. Score context (6 features) ──────────────────────────────
    my_score = game_state.get('my_score', 0)
    opp_score = game_state.get('opp_score', 0)

    features.append(my_score / target_score)              # normalized my score
    features.append(opp_score / target_score)             # normalized opp score
    features.append((my_score - opp_score) / target_score)  # score differential

    # Win proximity
    features.append(max(0, target_score - my_score) / target_score)
    features.append(max(0, target_score - opp_score) / target_score)

    # Score urgency (how close is someone to winning?)
    max_score = max(my_score, opp_score)
    features.append(max_score / target_score)

    # ── 6. Turn / game phase context (6 features) ─────────────────
    turn_number = game_state.get('turn_number', 0)
    deck_remaining = game_state.get('deck_remaining', 31)

    features.append(turn_number / 50.0)                   # normalized turn
    features.append(deck_remaining / 31.0)                # normalized deck remaining

    # Phase indicators
    features.append(1.0 if turn_number < 4 else 0.0)     # early game
    features.append(1.0 if 4 <= turn_number < 10 else 0.0)  # mid game
    features.append(1.0 if 10 <= turn_number < 16 else 0.0)  # late game
    features.append(1.0 if turn_number >= 16 else 0.0)    # very late game

    # ── 7. Knock features (6 features) ────────────────────────────
    # If we can knock, how good is it?
    if dw <= 10:
        features.append(1.0)                              # can knock
        features.append((10 - dw) / 10.0)                 # knock quality
        features.append(1.0 if dw == 0 else 0.0)          # gin
        features.append(1.0 if dw <= 5 else 0.0)          # low-dw knock
        features.append(float(len(dw_cards)) / 10.0)      # DW card fraction
        # Potential gin proximity
        features.append(dw / 10.0)
    else:
        features.append(0.0)
        features.append(0.0)
        features.append(0.0)
        features.append(0.0)
        features.append(float(len(dw_cards)) / 10.0)
        features.append(1.0)

    assert len(features) == FEATURE_DIM, f"Expected {FEATURE_DIM} features, got {len(features)}"
    return features


def get_feature_names():
    """Return human-readable names for each feature dimension."""
    names = []

    # Hand cards
    for c in range(NUM_CARDS):
        r = c // 4
        s = c % 4
        rank_names = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K']
        suit_names = ['C', 'D', 'S', 'H']
        names.append(f'hand_{rank_names[r]}{suit_names[s]}')

    # Hand statistics
    names.extend([
        'deadwood_raw', 'deadwood_norm', 'meld_count', 'melded_cards',
        'dw_card_count', 'can_knock', 'is_gin', 'doubles', 'triangles',
        'rank_entropy', 'max_suit_conc', 'min_suit_conc', 'suit_balance',
    ])

    # Discard pile cards
    for c in range(NUM_CARDS):
        r = c // 4
        s = c % 4
        rank_names = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K']
        suit_names = ['C', 'D', 'S', 'H']
        names.append(f'disc_{rank_names[r]}{suit_names[s]}')

    # Discard statistics
    names.extend([
        'disc_pile_size', 'disc_pile_norm', 'disc_avg_dw', 'disc_rank_diversity',
    ])

    # Score context
    names.extend([
        'my_score_norm', 'opp_score_norm', 'score_diff_norm',
        'my_win_distance', 'opp_win_distance', 'score_urgency',
    ])

    # Turn context
    names.extend([
        'turn_norm', 'deck_remaining_norm',
        'phase_early', 'phase_mid', 'phase_late', 'phase_very_late',
    ])

    # Knock features
    names.extend([
        'knock_can', 'knock_quality', 'knock_gin', 'knock_low_dw',
        'dw_card_fraction', 'gin_proximity',
    ])

    assert len(names) == FEATURE_DIM, f"Expected {FEATURE_DIM} names, got {len(names)}"
    return names
