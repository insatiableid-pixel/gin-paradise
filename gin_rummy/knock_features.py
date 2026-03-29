"""
Knock Decision Feature Encoder for Gin Rummy.

Encodes features specific to the knock-vs-continue decision.
Designed to make liveness, score context, and risk first-class
citizens, as argued by the knocking research paper.

Feature groups:
  1. Deadwood structure (total, card count, top card values)
  2. Meld structure (count, types, extension potential)
  3. Gin liveness (gin hits, gin rating, one-turn gin potential)
  4. Turn / tempo context
  5. Score context (gap, distance to 100, situational modifiers)
  6. Layoff / undercut risk proxies
  7. Opponent development signals
  8. Liveness × Score interactions

Produces a compact, focused feature vector for the knock decision.
"""

from gin_rummy.card import (
    rank, suit, make_card, deadwood_value, NUM_CARDS, NUM_RANKS, NUM_SUITS
)
from gin_rummy.meld import (
    best_meld_arrangement, find_all_melds, compute_deadwood,
    compute_layoffs, is_run_meld, is_set_meld
)

# Fixed feature vector length
KNOCK_FEATURE_DIM = 48


def _count_gin_hits(hand, melds, dw_cards):
    """
    Count the number of single-card draws that would achieve gin.

    A 'gin hit' is a card not currently in the hand that, if drawn and
    replacing the worst deadwood card, would bring deadwood to 0.

    Returns: (gin_hit_count, gin_hit_cards)
    """
    if not dw_cards:
        return 0, []

    hand_set = set(hand)
    gin_hits = []

    # For each possible card not in hand
    for c in range(NUM_CARDS):
        if c in hand_set:
            continue
        # Try adding this card and removing each dw card
        test_hand_base = list(hand) + [c]
        for dw_c in dw_cards:
            test_hand = [x for x in test_hand_base if x != dw_c or x == c]
            # Make sure we have exactly 10 cards
            if len(test_hand) != 10:
                # Deduplicate: if c == dw_c, the removal was wrong
                continue
            dw = compute_deadwood(test_hand)
            if dw == 0:
                gin_hits.append(c)
                break  # One hit per card is enough

    return len(gin_hits), gin_hits


def _count_quick_gin_hits(hand, melds, dw_cards):
    """
    Fast approximation of gin hits: cards that directly complete
    the remaining deadwood into melds.

    Checks:
    1. Cards that form a meld with ALL remaining deadwood cards
    2. Cards that complete a set or run using deadwood cards
    """
    if not dw_cards:
        return 0

    hand_set = set(hand)
    dw_set = set(dw_cards)
    hits = 0

    # Total deadwood value
    total_dw = sum(deadwood_value(c) for c in dw_cards)

    # For each card not in hand, check if adding it and optimally
    # discarding makes gin achievable
    for c in range(NUM_CARDS):
        if c in hand_set:
            continue
        # Quick check: can this card + dw_cards form melds?
        test_group = list(dw_cards) + [c]
        test_melds = find_all_melds(test_group)

        # Check if any combination of melds covers all dw_cards + new card
        # minus one discard
        if len(dw_cards) <= 3:
            # Small enough to check exhaustively via full hand test
            test_hand = list(hand) + [c]
            # Try discarding each non-melded card
            for discard_c in test_hand:
                remaining = [x for x in test_hand if x != discard_c]
                if len(remaining) == 10:
                    if compute_deadwood(remaining) == 0:
                        hits += 1
                        break
                    # Also handle duplicate cards
                elif len(remaining) < 10:
                    continue
                else:
                    # Remove only first occurrence
                    remaining = list(test_hand)
                    remaining.remove(discard_c)
                    if len(remaining) == 10 and compute_deadwood(remaining) == 0:
                        hits += 1
                        break

    return hits


def _gin_rating(hand, melds, dw_cards):
    """
    Estimate how 'gin-live' a hand is on a 0-1 scale.

    Factors:
    - Number of melded cards (more = closer to gin)
    - Number of deadwood cards (fewer = better)
    - Total deadwood value (lower = better)
    - Near-meld potential among deadwood cards
    """
    n_melded = 10 - len(dw_cards)
    total_dw = sum(deadwood_value(c) for c in dw_cards)

    # Base rating from structure
    if n_melded >= 9:
        base = 0.95  # One card from gin
    elif n_melded >= 7:
        base = 0.6
    elif n_melded >= 6:
        base = 0.3
    else:
        base = 0.1

    # Bonus for low total deadwood among remaining cards
    if total_dw <= 3:
        base += 0.2
    elif total_dw <= 5:
        base += 0.1

    # Check if dw_cards have near-meld potential
    if len(dw_cards) >= 2:
        dw_melds = find_all_melds(dw_cards)
        if dw_melds:
            base += 0.15

    return min(1.0, max(0.0, base))


def encode_knock_decision(hand, game_state, opponent_model=None, target_score=100):
    """
    Encode features for the knock decision.

    Args:
        hand: list of 10 card ints (the acting player's hand, post-discard)
        game_state: dict with turn_number, my_score, opp_score, deck_remaining, discard_pile
        opponent_model: OpponentModel instance (optional)
        target_score: target score for the game (default 100)

    Returns:
        list of floats, length KNOCK_FEATURE_DIM
    """
    features = []
    hand_set = set(hand)

    melds, dw_cards, my_dw = best_meld_arrangement(hand)
    melded = set()
    for m in melds:
        for c in m:
            melded.add(c)

    # ── 1. Deadwood structure (7 features) ──────────────────────
    features.append(my_dw / 10.0)                           # deadwood total (0-1 in knock range)
    features.append(len(dw_cards) / 10.0)                   # deadwood card count
    features.append(1.0 if my_dw == 0 else 0.0)             # is gin
    features.append(1.0 if my_dw <= 3 else 0.0)             # very low deadwood
    features.append(1.0 if my_dw <= 5 else 0.0)             # low deadwood

    # Deadwood card value distribution
    if dw_cards:
        max_dw_card = max(deadwood_value(c) for c in dw_cards)
        avg_dw_card = sum(deadwood_value(c) for c in dw_cards) / len(dw_cards)
    else:
        max_dw_card = 0
        avg_dw_card = 0
    features.append(max_dw_card / 10.0)                     # max single dw card value
    features.append(avg_dw_card / 10.0)                     # avg dw card value

    # ── 2. Meld structure (5 features) ──────────────────────────
    n_melds = len(melds)
    features.append(n_melds / 4.0)                           # meld count
    n_melded = len(melded)
    features.append(n_melded / 10.0)                         # melded card count

    # Count meld types
    n_sets = sum(1 for m in melds if is_set_meld(m))
    n_runs = sum(1 for m in melds if is_run_meld(m))
    features.append(n_sets / 3.0)                            # set meld count
    features.append(n_runs / 3.0)                            # run meld count

    # Long melds (4+ cards, more layoff risk)
    n_long_melds = sum(1 for m in melds if len(m) >= 4)
    features.append(n_long_melds / 3.0)                      # long meld count

    # ── 3. Gin liveness (6 features) ────────────────────────────
    gin_rating = _gin_rating(hand, melds, dw_cards)
    features.append(gin_rating)                              # gin rating (0-1)

    # Quick gin hit count (how many one-card draws make gin)
    gin_hits = _count_quick_gin_hits(hand, melds, dw_cards)
    features.append(min(gin_hits, 8) / 8.0)                  # gin hits normalized

    # One-card-from-gin structural indicators
    features.append(1.0 if len(dw_cards) == 1 else 0.0)     # exactly 1 dw card
    features.append(1.0 if len(dw_cards) <= 2 else 0.0)     # 1-2 dw cards (paper rule 7)

    # Deadwood cards that are near-meld (could improve)
    dw_near_meld = 0
    for c in dw_cards:
        r, s = rank(c), suit(c)
        # Check same-rank partners
        partners = sum(1 for su in range(NUM_SUITS) if su != s
                       and make_card(r, su) in hand_set)
        # Check adjacent same-suit
        adj = sum(1 for dr in [-1, 1] if 0 <= r + dr <= 12
                  and make_card(r + dr, s) in hand_set)
        if partners >= 1 or adj >= 1:
            dw_near_meld += 1
    features.append(dw_near_meld / max(len(dw_cards), 1))   # fraction of dw with partners

    # Are ALL deadwood cards the same rank or adjacent suit?
    # (indicates concentrated improvement potential)
    if len(dw_cards) >= 2:
        dw_ranks = [rank(c) for c in dw_cards]
        dw_concentrated = (len(set(dw_ranks)) == 1  # same rank
                          or (len(dw_cards) == 2
                              and suit(dw_cards[0]) == suit(dw_cards[1])
                              and abs(dw_ranks[0] - dw_ranks[1]) <= 2))
    else:
        dw_concentrated = True
    features.append(1.0 if dw_concentrated else 0.0)         # dw concentrated

    # ── 4. Turn / tempo context (5 features) ────────────────────
    turn = game_state.get('turn_number', 0)
    deck_remaining = game_state.get('deck_remaining', 31)

    features.append(turn / 30.0)                             # turn normalized
    features.append(deck_remaining / 31.0)                   # deck remaining
    features.append(1.0 if turn <= 3 else 0.0)               # early game
    features.append(1.0 if turn >= 10 else 0.0)              # late game
    features.append(1.0 if deck_remaining <= 8 else 0.0)     # low stock

    # ── 5. Score context (7 features) ───────────────────────────
    my_score = game_state.get('my_score', 0)
    opp_score = game_state.get('opp_score', 0)
    score_diff = my_score - opp_score

    features.append(my_score / target_score)                 # my progress
    features.append(opp_score / target_score)                # opp progress
    features.append(score_diff / target_score)               # score gap

    # Distance to winning (with knock vs with gin)
    points_if_knock = max(1, my_dw)  # Rough: we don't know opp DW
    gin_bonus = 25
    knock_wins_game = 1.0 if (my_score + points_if_knock) >= target_score else 0.0
    gin_wins_game = 1.0 if (my_score + gin_bonus) >= target_score else 0.0
    features.append(knock_wins_game)                         # knock could win game
    features.append(gin_wins_game)                           # gin would win game

    # Paper rule: ±22 gap → go for gin
    features.append(1.0 if score_diff >= 22 else 0.0)        # well ahead
    features.append(1.0 if score_diff <= -22 else 0.0)       # well behind

    # ── 6. Layoff / undercut risk proxies (6 features) ──────────
    # Meld extension points (opponent can lay off onto our melds)
    layoff_exposure = 0
    for m in melds:
        if is_run_meld(m):
            # Can be extended on both ends
            ranks_m = sorted(rank(c) for c in m)
            if ranks_m[0] > 0:
                layoff_exposure += 1  # Low-end extension
            if ranks_m[-1] < 12:
                layoff_exposure += 1  # High-end extension
        elif is_set_meld(m):
            if len(m) < 4:
                layoff_exposure += 1  # Fourth suit can lay off
    features.append(min(layoff_exposure, 8) / 8.0)          # layoff exposure

    # Undercut risk: higher when our DW is high (6-10 range)
    undercut_risk = 0.0
    if my_dw >= 6:
        undercut_risk = (my_dw - 5) / 5.0  # 0 at DW=5, 1 at DW=10
    features.append(undercut_risk)                           # undercut risk proxy

    # DW range bucket features
    features.append(1.0 if 1 <= my_dw <= 3 else 0.0)        # safe knock zone
    features.append(1.0 if 4 <= my_dw <= 6 else 0.0)        # moderate knock zone
    features.append(1.0 if 7 <= my_dw <= 10 else 0.0)       # risky knock zone

    # Undercut penalty magnitude (25 + our DW if undercut)
    undercut_cost = (25 + my_dw) / 35.0  # Normalized by max ~35 pts
    features.append(undercut_cost)                           # undercut cost

    # ── 7. Opponent development signals (5 features) ────────────
    if opponent_model is not None:
        known_opp = opponent_model.get_known_opponent_cards()
        features.append(len(known_opp) / 10.0)              # known opp cards

        # Opponent's estimated development (via known cards)
        if known_opp:
            opp_melds = find_all_melds(known_opp)
            features.append(min(len(opp_melds), 5) / 5.0)   # opp visible melds
        else:
            features.append(0.0)

        # Average opponent weight for our deadwood cards
        # (high weight = opponent wants similar cards, may have low DW)
        if dw_cards:
            avg_opp_weight = sum(opponent_model.weight[c] for c in dw_cards) / len(dw_cards)
        else:
            avg_opp_weight = 1.0
        features.append(min(avg_opp_weight, 5.0) / 5.0)     # opp interest in our DW

        # How many cards has opponent taken from discard?
        opp_discard_takes = len(known_opp)
        features.append(opp_discard_takes / 10.0)            # opp aggressiveness

        # Opponent likely close to knock?
        # Proxy: many known cards + high weights = strong hand
        total_high_weight = sum(1 for c in range(NUM_CARDS)
                                 if opponent_model.weight[c] >= 2.0
                                 and opponent_model.card_state[c] == 3)  # UNKNOWN
        features.append(total_high_weight / 20.0)            # opp hand strength proxy
    else:
        features.extend([0.0, 0.0, 0.5, 0.0, 0.25])

    # ── 8. Liveness × Score interactions (7 features) ───────────
    # These explicit interactions capture the paper's core thesis:
    # "playing for gin depends on liveness AND score"

    features.append(gin_rating * (score_diff / target_score))   # gin_live × score_gap
    features.append(gin_rating * (turn / 30.0))                 # gin_live × tempo
    features.append(gin_rating * (1.0 - deck_remaining / 31.0)) # gin_live × deck_pressure
    features.append(undercut_risk * (turn / 30.0))              # undercut risk × tempo
    features.append(gin_rating * gin_wins_game)                 # gin_live × clinch

    # Paper-inspired: hold for gin when DW cards <= 2 AND score gap large
    hold_signal = (1.0 if len(dw_cards) <= 2 else 0.0) * abs(score_diff) / target_score
    features.append(hold_signal)                                # structural hold signal

    # Combined risk-reward
    reward_if_knock = (10 - my_dw) / 10.0 if my_dw > 0 else 1.0
    features.append(reward_if_knock * (1.0 - undercut_risk))    # risk-adjusted knock value

    assert len(features) == KNOCK_FEATURE_DIM, \
        f"Expected {KNOCK_FEATURE_DIM} features, got {len(features)}"
    return features


def get_knock_feature_names():
    """Return human-readable names for each knock feature dimension."""
    return [
        # Deadwood structure (7)
        'dw_total_norm', 'dw_card_count_norm', 'is_gin', 'very_low_dw', 'low_dw',
        'max_dw_card_norm', 'avg_dw_card_norm',
        # Meld structure (5)
        'meld_count_norm', 'melded_card_count_norm', 'set_meld_count', 'run_meld_count',
        'long_meld_count',
        # Gin liveness (6)
        'gin_rating', 'gin_hits_norm', 'one_dw_card', 'few_dw_cards',
        'dw_near_meld_frac', 'dw_concentrated',
        # Turn/tempo (5)
        'turn_norm', 'deck_remaining_norm', 'is_early', 'is_late', 'low_stock',
        # Score context (7)
        'my_score_norm', 'opp_score_norm', 'score_diff_norm',
        'knock_wins_game', 'gin_wins_game', 'well_ahead', 'well_behind',
        # Layoff/undercut risk (6)
        'layoff_exposure', 'undercut_risk', 'safe_knock_zone', 'moderate_knock_zone',
        'risky_knock_zone', 'undercut_cost_norm',
        # Opponent signals (5)
        'known_opp_count', 'opp_visible_melds', 'opp_dw_interest',
        'opp_aggressiveness', 'opp_strength_proxy',
        # Liveness × Score interactions (7)
        'gin_live_x_score', 'gin_live_x_tempo', 'gin_live_x_deck_pressure',
        'undercut_x_tempo', 'gin_live_x_clinch', 'structural_hold_signal',
        'risk_adjusted_knock_value',
    ]
