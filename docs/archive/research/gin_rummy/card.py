"""
Card representation and utilities for Gin Rummy.

Card encoding: int 0-51
  rank = card // 4   (0=Ace, 1=Two, ..., 9=Ten, 10=Jack, 11=Queen, 12=King)
  suit = card % 4    (0=Clubs, 1=Diamonds, 2=Spades, 3=Hearts)
"""

import random

NUM_CARDS = 52
NUM_RANKS = 13
NUM_SUITS = 4

RANK_NAMES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K']
SUIT_NAMES = ['C', 'D', 'S', 'H']
RANK_FULL = ['Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King']
SUIT_FULL = ['Clubs', 'Diamonds', 'Spades', 'Hearts']


def rank(card):
    """Get rank (0-12) of a card."""
    return card // 4


def suit(card):
    """Get suit (0-3) of a card."""
    return card % 4


def make_card(r, s):
    """Create a card from rank and suit."""
    return r * 4 + s


def deadwood_value(card):
    """Get the deadwood point value of a card."""
    r = rank(card)
    if r == 0:
        return 1  # Ace
    if r >= 9:
        return 10  # Ten, Jack, Queen, King
    return r + 1  # 2-9


def card_str(card):
    """Short string representation: e.g., '7H', 'AS'."""
    return RANK_NAMES[rank(card)] + SUIT_NAMES[suit(card)]


def card_full_str(card):
    """Full string representation: e.g., '7 of Hearts'."""
    return f"{RANK_FULL[rank(card)]} of {SUIT_FULL[suit(card)]}"


def hand_str(hand):
    """String representation of a hand, sorted."""
    return ' '.join(card_str(c) for c in sorted(hand))


def make_deck():
    """Create a fresh shuffled deck."""
    deck = list(range(NUM_CARDS))
    random.shuffle(deck)
    return deck


def parse_card(s):
    """Parse a card string like '7H' or 'AS' into card int."""
    s = s.strip().upper()
    r = RANK_NAMES.index(s[0])
    su = SUIT_NAMES.index(s[1])
    return make_card(r, su)
