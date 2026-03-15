"""
Meld detection and optimal meld arrangement for Gin Rummy.

Melds:
  - Sets: 3 or 4 cards of same rank, different suits
  - Runs: 3+ consecutive cards of same suit (Ace low only, not adjacent to King)
"""

from itertools import combinations
from collections import defaultdict
from gin_rummy.card import rank, suit, make_card, deadwood_value

# Cache for meld arrangements to avoid recomputation
_meld_cache = {}
_CACHE_MAX = 50000


def find_sets(cards):
    """Find all valid set melds (3-4 cards of same rank) from given cards."""
    by_rank = defaultdict(list)
    for c in cards:
        by_rank[rank(c)].append(c)

    melds = []
    for r, cs in by_rank.items():
        if len(cs) >= 3:
            for combo in combinations(cs, 3):
                melds.append(tuple(sorted(combo)))
            if len(cs) == 4:
                melds.append(tuple(sorted(cs)))
    return melds


def find_runs(cards):
    """Find all valid run melds (3+ consecutive same suit) from given cards."""
    by_suit = defaultdict(list)
    card_lookup = {}
    for c in cards:
        r, s = rank(c), suit(c)
        by_suit[s].append(r)
        card_lookup[(r, s)] = c

    melds = []
    for s, ranks in by_suit.items():
        ranks_sorted = sorted(set(ranks))
        if len(ranks_sorted) < 3:
            continue

        # Find consecutive sequences
        sequences = []
        current = [ranks_sorted[0]]
        for i in range(1, len(ranks_sorted)):
            if ranks_sorted[i] == current[-1] + 1:
                current.append(ranks_sorted[i])
            else:
                if len(current) >= 3:
                    sequences.append(current)
                current = [ranks_sorted[i]]
        if len(current) >= 3:
            sequences.append(current)

        # Extract all sub-runs of length 3+
        for seq in sequences:
            for start in range(len(seq)):
                for end in range(start + 3, len(seq) + 1):
                    meld = tuple(card_lookup[(r, s)] for r in seq[start:end])
                    melds.append(meld)

    return melds


def find_all_melds(cards):
    """Find all possible melds from given cards."""
    return find_sets(cards) + find_runs(cards)


def best_meld_arrangement(cards):
    """
    Find the optimal meld arrangement that minimizes deadwood.

    Returns: (melds, deadwood_cards, deadwood_value)
      melds: list of tuples, each tuple is a meld
      deadwood_cards: list of unmelded cards
      deadwood_value: total deadwood points
    """
    cards_key = frozenset(cards)
    if cards_key in _meld_cache:
        return _meld_cache[cards_key]

    all_melds = find_all_melds(cards)
    total_dw = sum(deadwood_value(c) for c in cards)

    if not all_melds:
        result = ([], list(cards), total_dw)
        _cache_store(cards_key, result)
        return result

    # Build bitmasks for fast intersection checks
    card_list = list(cards)
    card_to_idx = {}
    for i, c in enumerate(card_list):
        card_to_idx[c] = i

    meld_masks = []
    meld_dw_saved = []
    valid_melds = []
    for m in all_melds:
        if all(c in card_to_idx for c in m):
            mask = 0
            saved = 0
            for c in m:
                mask |= (1 << card_to_idx[c])
                saved += deadwood_value(c)
            meld_masks.append(mask)
            meld_dw_saved.append(saved)
            valid_melds.append(m)

    if not valid_melds:
        result = ([], list(cards), total_dw)
        _cache_store(cards_key, result)
        return result

    best_saved = [0]
    best_combo = [[]]

    def backtrack(idx, used_mask, saved, combo):
        if saved > best_saved[0]:
            best_saved[0] = saved
            best_combo[0] = combo[:]

        for i in range(idx, len(valid_melds)):
            if meld_masks[i] & used_mask == 0:
                combo.append(i)
                new_saved = saved + meld_dw_saved[i]
                # Pruning: even if all remaining melds were added, can we beat best?
                backtrack(i + 1, used_mask | meld_masks[i], new_saved, combo)
                combo.pop()

    backtrack(0, 0, 0, [])

    # Build result
    used_cards = set()
    result_melds = []
    for i in best_combo[0]:
        result_melds.append(valid_melds[i])
        for c in valid_melds[i]:
            used_cards.add(c)

    remaining = [c for c in cards if c not in used_cards]
    final_dw = total_dw - best_saved[0]

    result = (result_melds, remaining, final_dw)
    _cache_store(cards_key, result)
    return result


def _cache_store(key, value):
    global _meld_cache
    if len(_meld_cache) > _CACHE_MAX:
        _meld_cache.clear()
    _meld_cache[key] = value


def clear_cache():
    _meld_cache.clear()


def compute_deadwood(cards):
    """Compute minimum deadwood value for a hand."""
    _, _, dw = best_meld_arrangement(cards)
    return dw


def is_set_meld(meld):
    """Check if a meld is a set (same rank)."""
    return len(meld) >= 3 and len(set(rank(c) for c in meld)) == 1


def is_run_meld(meld):
    """Check if a meld is a run (consecutive same suit)."""
    if len(meld) < 3:
        return False
    suits = set(suit(c) for c in meld)
    if len(suits) != 1:
        return False
    ranks = sorted(rank(c) for c in meld)
    for i in range(1, len(ranks)):
        if ranks[i] != ranks[i - 1] + 1:
            return False
    return True


def compute_layoffs(knocker_melds, opponent_deadwood_cards):
    """
    Compute which of opponent's deadwood cards can be laid off
    onto the knocker's melds. Returns set of cards that can be laid off.
    Handles chaining (e.g., laying off extends a run, enabling further layoffs).
    """
    available = set(opponent_deadwood_cards)
    laid_off = set()

    # Build extended melds (can grow with layoffs)
    extended_melds = []
    for m in knocker_melds:
        if is_set_meld(m):
            extended_melds.append(('set', rank(m[0]), set(suit(c) for c in m)))
        elif is_run_meld(m):
            s = suit(m[0])
            ranks = sorted(rank(c) for c in m)
            extended_melds.append(('run', s, min(ranks), max(ranks)))

    changed = True
    while changed:
        changed = False
        for i, em in enumerate(extended_melds):
            if em[0] == 'set':
                r, suits_in = em[1], em[2]
                if len(suits_in) < 4:
                    for s in range(4):
                        if s not in suits_in:
                            card = make_card(r, s)
                            if card in available and card not in laid_off:
                                laid_off.add(card)
                                suits_in.add(s)
                                changed = True
            elif em[0] == 'run':
                s, min_r, max_r = em[1], em[2], em[3]
                # Extend low end
                if min_r > 0:
                    card = make_card(min_r - 1, s)
                    if card in available and card not in laid_off:
                        laid_off.add(card)
                        extended_melds[i] = ('run', s, min_r - 1, max_r)
                        changed = True
                        min_r -= 1
                # Extend high end
                if max_r < 12:
                    card = make_card(max_r + 1, s)
                    if card in available and card not in laid_off:
                        laid_off.add(card)
                        extended_melds[i] = ('run', s, min_r, max_r + 1)
                        changed = True

    return laid_off


def count_near_melds(cards):
    """Count doubles (2-card partial melds) and triangles (3-card groups with 2 meld paths)."""
    doubles = 0
    triangles = 0
    card_set = set(cards)

    # Check pairs of same rank (partial sets)
    by_rank = defaultdict(list)
    for c in cards:
        by_rank[rank(c)].append(c)

    for r, cs in by_rank.items():
        if len(cs) == 2:
            # Check if either card also has an adjacent same-suit card (triangle)
            for c in cs:
                s = suit(c)
                if r > 0 and make_card(r - 1, s) in card_set:
                    triangles += 1
                    break
                if r < 12 and make_card(r + 1, s) in card_set:
                    triangles += 1
                    break
            else:
                doubles += 1

    # Check pairs of adjacent same-suit (partial runs)
    by_suit = defaultdict(list)
    for c in cards:
        by_suit[suit(c)].append(rank(c))

    for s, ranks in by_suit.items():
        ranks_sorted = sorted(set(ranks))
        for i in range(len(ranks_sorted) - 1):
            if ranks_sorted[i] + 1 == ranks_sorted[i + 1]:
                # Adjacent pair - this is a partial run
                # Check if counted as part of a triangle already
                r1, r2 = ranks_sorted[i], ranks_sorted[i + 1]
                c1, c2 = make_card(r1, s), make_card(r2, s)
                # Only count if not part of a full meld
                if r1 > 0 and make_card(r1 - 1, s) in card_set:
                    continue  # Part of a run meld
                if r2 < 12 and make_card(r2 + 1, s) in card_set:
                    continue  # Part of a run meld
                doubles += 1

    return doubles, triangles
