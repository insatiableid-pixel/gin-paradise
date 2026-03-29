"""
Information-Set Monte Carlo draw search for Gin Rummy.

Given a hand and a discard pile top card, evaluates whether taking
the discard vs drawing from stock produces better expected outcomes.

The search works by:
1. Sampling plausible worlds using opponent-model-weighted card placement
2. Cards the opponent likely holds are less likely to appear as stock draws
3. For each world, simulating a short rollout
4. Comparing the expected deadwood after the best discard for each draw choice
5. Factoring in an information-revelation penalty for taking from the discard pile

v2 improvement (Directive 50): opponent-model-weighted world sampling.
Instead of shuffling unseen cards uniformly, we use the opponent model's
weight[] to bias card placement. Cards with higher opponent-model weight
(more likely in opponent's hand) are less likely to appear as early stock
draws. This produces more realistic world samples.
"""

import random
from gin_rummy.card import rank, suit, make_card, deadwood_value, NUM_CARDS
from gin_rummy.meld import (
    best_meld_arrangement, find_all_melds, compute_deadwood, compute_layoffs
)


# Default search parameters
DEFAULT_NUM_WORLDS = 30       # Number of sampled worlds
DEFAULT_ROLLOUT_DEPTH = 2     # Number of draw-discard cycles to simulate
INFO_PENALTY = 1.5            # DW penalty for revealing info by taking discard


def _weighted_shuffle(cards, weights, rng):
    """
    Shuffle cards with inverse-opponent-weight bias.

    Cards the opponent is MORE likely to hold (high weight) should appear
    LATER in the shuffled order (less likely as stock draws). We use
    inverse weighting: stock_weight = 1 / opponent_weight, so cards the
    opponent is unlikely to hold appear first (as stock draws).

    This is implemented via weighted sampling without replacement using
    the provided RNG for reproducibility.
    """
    if not cards:
        return []

    pool = list(zip(cards, weights))
    result = []

    for _ in range(len(pool)):
        if not pool:
            break
        # Compute inverse weights for stock probability
        # Higher opponent weight → lower stock weight
        stock_weights = []
        for _, w in pool:
            # Inverse: 1/w, but clamp w to avoid division by zero
            sw = 1.0 / max(w, 0.05)
            stock_weights.append(sw)

        total = sum(stock_weights)
        if total <= 0:
            # Uniform fallback
            idx = rng.randrange(len(pool))
        else:
            r = rng.random() * total
            cumulative = 0.0
            idx = 0
            for i, sw in enumerate(stock_weights):
                cumulative += sw
                if cumulative >= r:
                    idx = i
                    break

        result.append(pool[idx][0])
        pool.pop(idx)

    return result


def evaluate_draw_choice(hand, top_discard, opponent_model, game_state,
                         num_worlds=DEFAULT_NUM_WORLDS,
                         rollout_depth=DEFAULT_ROLLOUT_DEPTH,
                         info_penalty=INFO_PENALTY,
                         rng=None,
                         use_weighted_worlds=True):
    """
    Evaluate draw choices via Monte Carlo sampling.

    Args:
        use_weighted_worlds: If True, use opponent-model-weighted world
            sampling. If False, use uniform shuffle (v1 behavior).

    Returns:
        (should_take_discard, take_ev, stock_ev, diagnostics)

        take_ev: average post-rollout deadwood if we take the discard
        stock_ev: average post-rollout deadwood if we draw from stock
        diagnostics: dict with search metadata
    """
    if rng is None:
        rng = random.Random()

    hand_set = set(hand)
    current_dw = compute_deadwood(hand)

    # Identify unseen cards (not in our hand, not known discards, not known opponent)
    unseen = opponent_model.sample_unseen_cards()
    known_opp = opponent_model.get_known_opponent_cards()

    # If there are almost no unseen cards, can't meaningfully search
    if len(unseen) < 3:
        return None, 0.0, 0.0, {'skipped': True, 'reason': 'too_few_unseen'}

    # Pre-compute opponent model weights for unseen cards
    if use_weighted_worlds:
        unseen_weights = [opponent_model.weight[c] for c in unseen]
    else:
        unseen_weights = None

    take_dw_sum = 0.0
    stock_dw_sum = 0.0
    worlds_evaluated = 0

    for _ in range(num_worlds):
        # Sample a world: assign unseen cards to stock
        if use_weighted_worlds:
            shuffled_unseen = _weighted_shuffle(unseen, unseen_weights, rng)
        else:
            shuffled_unseen = list(unseen)
            rng.shuffle(shuffled_unseen)

        # === Evaluate: TAKE the discard ===
        take_hand = list(hand) + [top_discard]
        take_dw = _best_discard_dw(take_hand, restricted=top_discard)

        # Simulate short rollout after taking discard
        rollout_hand_take = _get_hand_after_best_discard(take_hand, restricted=top_discard)
        take_rollout_dw = _rollout_dw(
            rollout_hand_take, shuffled_unseen, rollout_depth, rng
        )

        # === Evaluate: Draw from STOCK ===
        if not shuffled_unseen:
            continue

        stock_card = shuffled_unseen[0]
        stock_hand = list(hand) + [stock_card]
        stock_dw = _best_discard_dw(stock_hand, restricted=None)

        # Simulate short rollout after drawing from stock
        rollout_hand_stock = _get_hand_after_best_discard(stock_hand, restricted=None)
        remaining_stock = shuffled_unseen[1:]
        stock_rollout_dw = _rollout_dw(
            rollout_hand_stock, remaining_stock, rollout_depth, rng
        )

        take_dw_sum += take_rollout_dw
        stock_dw_sum += stock_rollout_dw
        worlds_evaluated += 1

    if worlds_evaluated == 0:
        return None, 0.0, 0.0, {'skipped': True, 'reason': 'no_worlds'}

    take_ev = take_dw_sum / worlds_evaluated
    stock_ev = stock_dw_sum / worlds_evaluated

    # Apply information-revelation penalty for taking from discard
    adjusted_take_ev = take_ev + info_penalty

    should_take = adjusted_take_ev < stock_ev

    diagnostics = {
        'skipped': False,
        'worlds_evaluated': worlds_evaluated,
        'take_ev_raw': take_ev,
        'take_ev_adjusted': adjusted_take_ev,
        'stock_ev': stock_ev,
        'current_dw': current_dw,
        'margin': stock_ev - adjusted_take_ev,
        'weighted_worlds': use_weighted_worlds,
    }

    return should_take, adjusted_take_ev, stock_ev, diagnostics


def _best_discard_dw(hand_11, restricted=None):
    """
    Find the minimum deadwood achievable by discarding one card from an 11-card hand.
    If restricted is set, that card cannot be discarded (just drawn from discard).
    """
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
    """
    Return the 10-card hand after making the best deadwood-minimizing discard.
    """
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
        # Shouldn't happen, but fallback
        return hand_11[:10]
    return best_hand


def _rollout_dw(hand, stock_cards, depth, rng):
    """
    Simulate `depth` draw-from-stock-then-discard-best cycles.
    Returns the final deadwood after the rollout.
    """
    current_hand = list(hand)
    stock_idx = 0

    for _ in range(depth):
        if stock_idx >= len(stock_cards):
            break
        # Draw from stock
        drawn = stock_cards[stock_idx]
        stock_idx += 1
        hand_11 = current_hand + [drawn]
        # Discard best (no restriction since drawn from stock)
        current_hand = _get_hand_after_best_discard(hand_11, restricted=None)

    return compute_deadwood(current_hand)
