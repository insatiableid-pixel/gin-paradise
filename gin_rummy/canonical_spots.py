"""
Canonical Critical-Spot Corpus for Gin Rummy Subgame Solver (Phase 61).

Machine-readable collection of curated subgame positions designed to
stress-test the endgame solver across the key decision-relevant axes:

  1. Low-stock, legal knock, one-card DW, gin-live
  2. Low-stock, legal knock, multi-card fragmented DW
  3. Low-stock, legal knock, undercut-risk-heavy shape
  4. Score-sensitive spot (near-clinch / behind)
  5. Trivial-dominant spots for sanity checks
  6. Opening DW=9 spot for future study (tractability caveat)

All cards use integer encoding: rank * 4 + suit
  rank: 0=A, 1=2, ..., 9=T, 10=J, 11=Q, 12=K
  suit: 0=C, 1=D, 2=S, 3=H
"""

from gin_rummy.card import make_card, card_str, hand_str, parse_card
from gin_rummy.endgame_solver import PublicState


def _mc(r, s):
    """Convenience: make_card(rank, suit)."""
    return make_card(r, s)


def _parse_hand(cards_str: str):
    """Parse space-separated card strings like 'AC 2D 3S'."""
    return [parse_card(s) for s in cards_str.strip().split()]


# ── Spot Definitions ──────────────────────────────────────────────────

# Each spot is a dict with:
#   id: unique spot identifier
#   description: human-readable description
#   category: one of the canonical categories
#   hero_hand: list of 10 card ints
#   public_state: PublicState instance
#   expected_dominant: 'knock', 'continue', or 'unclear'
#   notes: analysis notes

CANONICAL_SPOTS = []


# ── Spot 1: One-card DW, gin-live, low stock ─────────────────────────
# Hero has 3 melds (9 cards melded) + one deadwood card.
# The DW card (5H) could complete a 4th meld with one more draw.
# Stock has 4 cards left. DW = 5.

_spot1_hero = [
    # Run: AC 2C 3C
    _mc(0, 0), _mc(1, 0), _mc(2, 0),
    # Run: 7D 8D 9D
    _mc(6, 1), _mc(7, 1), _mc(8, 1),
    # Set: JC JD JS
    _mc(10, 0), _mc(10, 1), _mc(10, 2),
    # DW: 5H (could form run 4H-5H-6H or set 5C-5D-5H)
    _mc(4, 3),
]

_spot1_discard = [
    _mc(12, 0),  # KC
    _mc(12, 1),  # KD
    _mc(11, 3),  # QH
    _mc(9, 0),   # TC
    _mc(8, 0),   # 9C
    _mc(7, 0),   # 8C
]

CANONICAL_SPOTS.append({
    'id': 'gin_live_one_dw',
    'description': 'Low stock (4 cards), DW=5, one deadwood card (5H), gin-live. '
                   'Could draw 4H or 6H for gin via run, or 5C/5D for gin via set.',
    'category': 'low_stock_gin_live',
    'hero_hand': _spot1_hero,
    'public_state': PublicState(
        discard_pile=_spot1_discard,
        turn_number=18,
        stock_size=4,
        my_score=0,
        opp_score=0,
    ),
    'expected_dominant': 'unclear',  # Depends on stock composition / opponent hand
    'notes': 'Key tension: knock for safe +5 average vs wait for gin (+25+opp_dw). '
             'With 4 stock cards and 4 gin-completing cards possible, gin odds ~16-25% '
             'but undercut risk grows.',
})


# ── Spot 2: Multi-card fragmented DW, low stock ─────────────────────
# Hero has 2 melds + 4 scattered deadwood cards. DW = 8.
# No realistic path to gin. Stock nearly empty.

_spot2_hero = [
    # Run: 4S 5S 6S
    _mc(3, 2), _mc(4, 2), _mc(5, 2),
    # Set: 9C 9D 9H
    _mc(8, 0), _mc(8, 1), _mc(8, 3),
    # DW: 2H (2), AH (1), 3D (3), 2C (2) = 8 total
    _mc(1, 3), _mc(0, 3), _mc(2, 1), _mc(1, 0),
]

_spot2_discard = [
    _mc(12, 2),  # KS
    _mc(11, 0),  # QC
    _mc(11, 1),  # QD
    _mc(10, 3),  # JH
    _mc(7, 2),   # 8S
    _mc(6, 3),   # 7H
    _mc(5, 1),   # 6D
]

CANONICAL_SPOTS.append({
    'id': 'fragmented_dw_low_stock',
    'description': 'Low stock (3 cards), DW=8, four small deadwood cards, no gin path. '
                   'Fragmented deadwood with little improvement potential.',
    'category': 'low_stock_fragmented',
    'hero_hand': _spot2_hero,
    'public_state': PublicState(
        discard_pile=_spot2_discard,
        turn_number=20,
        stock_size=3,
        my_score=0,
        opp_score=0,
    ),
    'expected_dominant': 'knock',  # Little improvement potential, stock nearly gone
    'notes': 'With 3 stock cards and 4 scattered DW cards, improving the hand is '
             'unlikely. Knocking with DW=8 is probably best to avoid opponent gin.',
})


# ── Spot 3: Undercut-risk-heavy, low stock ───────────────────────────
# Hero has DW=9 but opponent has been picking up low cards.
# Known opponent pickups suggest opponent may have very low DW.

_spot3_hero = [
    # Run: 5D 6D 7D
    _mc(4, 1), _mc(5, 1), _mc(6, 1),
    # Set: QC QS QD
    _mc(11, 0), _mc(11, 2), _mc(11, 1),
    # Run: 9H TH JH
    _mc(8, 3), _mc(9, 3), _mc(10, 3),
    # DW: 9S (9)
    _mc(8, 2),
]

_spot3_discard = [
    _mc(12, 3),  # KH
    _mc(12, 2),  # KS
    _mc(7, 3),   # 8H
    _mc(4, 0),   # 5C
    _mc(3, 3),   # 4H
    _mc(2, 3),   # 3H
]

CANONICAL_SPOTS.append({
    'id': 'undercut_risk_heavy',
    'description': 'Low stock (5 cards), DW=9. Opponent picked up AC and 2S from '
                   'discard (known low-DW signals). High undercut risk.',
    'category': 'low_stock_undercut_risk',
    'hero_hand': _spot3_hero,
    'public_state': PublicState(
        discard_pile=_spot3_discard,
        turn_number=16,
        stock_size=5,
        my_score=0,
        opp_score=0,
        known_opponent_pickups=[_mc(0, 0), _mc(1, 2)],  # AC, 2S
        known_opponent_discards=[],
    ),
    'expected_dominant': 'continue',  # High undercut risk with DW=9
    'notes': 'Opponent picked up AC and 2S — strong signal of low DW. Knocking at '
             'DW=9 risks a large undercut (-25 + delta). Continuing might yield a '
             'better hand or wall.',
})


# ── Spot 4: Score-sensitive, near-clinch ─────────────────────────────
# Hero at 93 points, needs 7 to clinch. DW=3, stock=4.
# Knocking guarantees at least 1 point, but probably ~7+ (enough to win).

_spot4_hero = [
    # Run: 3H 4H 5H
    _mc(2, 3), _mc(3, 3), _mc(4, 3),
    # Run: 7C 8C 9C
    _mc(6, 0), _mc(7, 0), _mc(8, 0),
    # Set: KD KS KH
    _mc(12, 1), _mc(12, 2), _mc(12, 3),
    # DW: 3C (3)
    _mc(2, 0),
]

_spot4_discard = [
    _mc(11, 0),  # QC
    _mc(10, 0),  # JC
    _mc(9, 2),   # TS
    _mc(0, 1),   # AD
    _mc(1, 1),   # 2D
    _mc(5, 0),   # 6C
]

CANONICAL_SPOTS.append({
    'id': 'near_clinch_score_sensitive',
    'description': 'Hero at 93, opponent at 45. DW=3, stock=4. Knocking likely '
                   'clinches the match. Gin would over-clinch with maximum points.',
    'category': 'score_sensitive',
    'hero_hand': _spot4_hero,
    'public_state': PublicState(
        discard_pile=_spot4_discard,
        turn_number=17,
        stock_size=4,
        my_score=93,
        opp_score=45,
    ),
    'expected_dominant': 'knock',  # Clinch is almost certain
    'notes': 'Classic score-sensitive spot. DW=3 means knock yields at least 1pt '
             '(enough to clinch requires 7). Expected opponent DW after layoffs '
             'likely gives enough points. The champion (clinch-only) would knock here '
             'because 93 + max(1, 10-3=7) = 100 >= target.',
})


# ── Spot 5: Gin (DW=0), trivial dominant ─────────────────────────────
# Sanity check: hero has gin handle. Must always knock.

_spot5_hero = [
    # Run: AC 2C 3C
    _mc(0, 0), _mc(1, 0), _mc(2, 0),
    # Run: 5D 6D 7D 8D
    _mc(4, 1), _mc(5, 1), _mc(6, 1), _mc(7, 1),
    # Set: QS QH QC
    _mc(11, 2), _mc(11, 3), _mc(11, 0),
]

_spot5_discard = [
    _mc(12, 0),  # KC
    _mc(12, 1),  # KD
    _mc(9, 0),   # TC
]

CANONICAL_SPOTS.append({
    'id': 'gin_trivial_dominant',
    'description': 'DW=0 (gin). Must always knock. Sanity check.',
    'category': 'trivial_dominant',
    'hero_hand': _spot5_hero,
    'public_state': PublicState(
        discard_pile=_spot5_discard,
        turn_number=12,
        stock_size=6,
        my_score=0,
        opp_score=0,
    ),
    'expected_dominant': 'knock',
    'notes': 'Gin is always strictly dominant. No reason to continue.',
})


# ── Spot 6: Match-clinch with non-gin knock, trivial ─────────────────
# Hero at 99, any knock wins. DW=10.

_spot6_hero = [
    # Run: 4C 5C 6C
    _mc(3, 0), _mc(4, 0), _mc(5, 0),
    # Set: 8D 8S 8H
    _mc(7, 1), _mc(7, 2), _mc(7, 3),
    # DW: KH (10) + AC (1) + 2D (2) + 7C (7) = ... 
    # Let's construct a DW=10 hand carefully
    # Run: 4C 5C 6C = 0 DW
    # Set: 8D 8S 8H = 0 DW
    # Remaining 4 cards must sum to 10
    # TH (10) = DW 10 works with 3 melded
    # Actually need exactly DW=10 with 4 unmelded
    # Let's do: AC (1) + 2S (2) + 3H (3) + 4D (4) = 10
    _mc(0, 0), _mc(1, 2), _mc(2, 3), _mc(3, 1),
]
# Fix: the hand above is wrong because _mc(3,0) = 4C and _mc(0,0) = AC 
# but _mc(3,1) = 4D. Let me rebuild properly.
_spot6_hero = [
    # Run: 5C 6C 7C
    _mc(4, 0), _mc(5, 0), _mc(6, 0),
    # Set: TD TS TH
    _mc(9, 1), _mc(9, 2), _mc(9, 3),
    # DW: AD (1), 2S (2), 3H (3), 4C... wait, 4C = _mc(3,0)
    # DW: AH (1), 2D (2), 3S (3), 4D (4) = 10
    _mc(0, 3), _mc(1, 1), _mc(2, 2), _mc(3, 1),
]
# Problem: _mc(3,1) is 4D and _mc(9,1) is TD — those are different, good.
# But _mc(1,1) is 2D and _mc(9,1) is TD — different ranks, same suit. Fine.

CANONICAL_SPOTS.append({
    'id': 'match_clinch_trivial',
    'description': 'Hero at 99, DW=10. Any knock wins the match. Trivial dominant.',
    'category': 'trivial_dominant',
    'hero_hand': _spot6_hero,
    'public_state': PublicState(
        discard_pile=[_mc(12, 0), _mc(12, 1), _mc(11, 0)],
        turn_number=15,
        stock_size=5,
        my_score=99,
        opp_score=50,
    ),
    'expected_dominant': 'knock',
    'notes': 'At 99 points, even DW=10 knock guarantees at least 1 point → win. '
             'Champion correctly knocks here (clinch exception).',
})


# ── Spot 7: Illegal knock (DW > 10), should reject ──────────────────
# Sanity check: hero has DW=15. Solver should reject cleanly.

_spot7_hero = [
    # Run: 2C 3C 4C
    _mc(1, 0), _mc(2, 0), _mc(3, 0),
    # DW: KH (10), 5D (5) = 15 total + other scattered
    _mc(12, 3), _mc(4, 1),
    _mc(0, 2), _mc(1, 3), _mc(7, 2), _mc(6, 3), _mc(9, 1),
]

CANONICAL_SPOTS.append({
    'id': 'illegal_knock_reject',
    'description': 'DW > 10, cannot knock. Solver must reject cleanly.',
    'category': 'sanity_check',
    'hero_hand': _spot7_hero,
    'public_state': PublicState(
        discard_pile=[_mc(11, 1), _mc(10, 2)],
        turn_number=8,
        stock_size=10,
        my_score=0,
        opp_score=0,
    ),
    'expected_dominant': 'reject',
    'notes': 'Solver must raise ValueError because DW > 10 (illegal knock state).',
})


# ── Spot 8: DW=1, opponent likely high DW, near end ─────────────────
# Hero has DW=1 (single ace). Very likely to win knock.
# But gin is one card away. Stock has 3 cards.

_spot8_hero = [
    # Run: 3D 4D 5D 6D
    _mc(2, 1), _mc(3, 1), _mc(4, 1), _mc(5, 1),
    # Set: JC JD JS
    _mc(10, 0), _mc(10, 1), _mc(10, 2),
    # Run: 8H 9H TH  
    _mc(7, 3), _mc(8, 3), _mc(9, 3),
    # Wait, that's 10 melded cards = gin already!
    # Fix: 9 melded + 1 DW
]

_spot8_hero = [
    # Run: 3D 4D 5D
    _mc(2, 1), _mc(3, 1), _mc(4, 1),
    # Set: JC JD JS
    _mc(10, 0), _mc(10, 1), _mc(10, 2),
    # Run: 8H 9H TH
    _mc(7, 3), _mc(8, 3), _mc(9, 3),
    # DW: AC (1)
    _mc(0, 0),
]

_spot8_discard = [
    _mc(12, 0), _mc(12, 1), _mc(12, 2), _mc(12, 3),  # All kings
    _mc(11, 0), _mc(11, 3),  # QC, QH
    _mc(6, 0),  # 7C
]

CANONICAL_SPOTS.append({
    'id': 'dw1_gin_close',
    'description': 'DW=1 (AC), stock=3, 9 cards melded. Gin-live if AC completes '
                   'a meld (e.g. draw AS or AD for set, or draw 2C for run). '
                   'Knock wins almost certainly but gin is possible.',
    'category': 'low_stock_gin_live',
    'hero_hand': _spot8_hero,
    'public_state': PublicState(
        discard_pile=_spot8_discard,
        turn_number=19,
        stock_size=3,
        my_score=0,
        opp_score=0,
    ),
    'expected_dominant': 'unclear',  # Depends on gin odds vs undercut risk
    'notes': 'With DW=1, knock is almost always safe (few undercuts at DW=1). '
             'But gin is +25 bonus. The solver should quantify this tradeoff. '
             'The champion (clinch-only go-gin) would CONTINUE here.',
})


# ── Spot accessor functions ───────────────────────────────────────────

def get_spot(spot_id: str) -> dict:
    """Get a canonical spot by its ID."""
    for spot in CANONICAL_SPOTS:
        if spot['id'] == spot_id:
            return spot
    raise KeyError(f"No spot with id '{spot_id}'")


def list_spot_ids() -> list:
    """List all available spot IDs."""
    return [s['id'] for s in CANONICAL_SPOTS]


def get_solvable_spots() -> list:
    """Get spots that can be solved (excludes sanity checks like illegal knock)."""
    return [s for s in CANONICAL_SPOTS if s['expected_dominant'] != 'reject']


def validate_spot(spot: dict) -> bool:
    """Validate a spot's internal consistency."""
    from gin_rummy.meld import compute_deadwood
    
    hand = spot['hero_hand']
    ps = spot['public_state']
    
    # Check hand size
    if len(hand) != 10:
        print(f"  FAIL: hand has {len(hand)} cards, expected 10")
        return False
    
    # Check no duplicates in hand
    if len(set(hand)) != 10:
        print(f"  FAIL: duplicate cards in hand")
        return False
    
    # Check hand doesn't overlap with discard pile
    overlap = set(hand) & set(ps.discard_pile)
    if overlap:
        print(f"  FAIL: hand overlaps discard pile: {[card_str(c) for c in overlap]}")
        return False
    
    # Check all cards are valid (0-51)
    all_cards = hand + ps.discard_pile
    for c in all_cards:
        if c < 0 or c >= 52:
            print(f"  FAIL: invalid card {c}")
            return False
    
    # Compute deadwood
    dw = compute_deadwood(hand)
    print(f"  Hand: {hand_str(hand)}")
    print(f"  DW: {dw}")
    
    return True


def validate_all_spots():
    """Validate all canonical spots."""
    print("Validating canonical spots:")
    all_valid = True
    for spot in CANONICAL_SPOTS:
        print(f"\n  [{spot['id']}] {spot['description'][:60]}...")
        valid = validate_spot(spot)
        if valid:
            print(f"  ✓ VALID")
        else:
            print(f"  ✗ INVALID")
            all_valid = False
    return all_valid


if __name__ == '__main__':
    validate_all_spots()
