"""
Base player interface and Simple baseline player for Gin Rummy.
"""

import random
from gin_rummy.card import rank, suit, make_card, deadwood_value, card_str
from gin_rummy.meld import best_meld_arrangement, find_all_melds, compute_deadwood


class Player:
    """Abstract base class for Gin Rummy players."""

    def __init__(self, name="Player"):
        self.name = name

    def new_hand(self, hand, opponent_id):
        """Called at the start of each hand with initial 10 cards."""
        pass

    def draw_decision(self, top_discard, hand, game_state):
        """
        Decide whether to draw from discard pile or stock.

        Args:
            top_discard: the face-up card on top of discard pile
            hand: current hand (list of card ints)
            game_state: dict with turn_number, my_score, opp_score, deck_remaining,
                        discard_pile (all visible discards)
        Returns:
            True to take the discard, False to draw from stock
        """
        raise NotImplementedError

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        """
        Choose which card to discard from the 11-card hand.

        Args:
            hand: current hand with 11 cards
            drew_from_discard: True if the drawn card came from discard
            drawn_card: the card that was just drawn
            game_state: dict with game info
        Returns:
            card int to discard
        """
        raise NotImplementedError

    def knock_decision(self, hand, game_state):
        """
        Decide whether to knock (if legal, i.e., deadwood <= 10).

        Args:
            hand: current 10-card hand after discard
            game_state: dict with game info
        Returns:
            True to knock, False to continue
        """
        raise NotImplementedError

    def notify_opponent_draw(self, from_discard, card=None):
        """Notify that opponent drew. card is known only if from_discard."""
        pass

    def notify_opponent_discard(self, card):
        """Notify that opponent discarded a card."""
        pass

    def notify_hand_result(self, result):
        """Called at end of hand with result details."""
        pass


class SimplePlayer(Player):
    """
    Simple baseline player (immediate value strategy).
    Draws discard only if it immediately completes a meld.
    Discards highest deadwood card not in a meld.
    Knocks as soon as possible (deadwood <= 10).
    """

    def __init__(self, name="Simple"):
        super().__init__(name)

    def draw_decision(self, top_discard, hand, game_state):
        # Take discard if it immediately creates/extends a meld
        test_hand = hand + [top_discard]
        melds_with = find_all_melds(test_hand)
        for meld in melds_with:
            if top_discard in meld:
                return True
        return False

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        melds, deadwood_cards, dw = best_meld_arrangement(hand)
        melded = set()
        for m in melds:
            for c in m:
                melded.add(c)

        # Can't discard what was just drawn from discard pile
        candidates = [c for c in hand if c not in melded]
        if drew_from_discard:
            candidates = [c for c in candidates if c != drawn_card]

        if not candidates:
            # All cards melded, discard any non-restricted card
            candidates = [c for c in hand if not (drew_from_discard and c == drawn_card)]

        # Discard highest deadwood
        return max(candidates, key=deadwood_value)

    def knock_decision(self, hand, game_state):
        _, _, dw = best_meld_arrangement(hand)
        return dw <= 10


class RandomPlayer(Player):
    """Completely random player for testing."""

    def __init__(self, name="Random"):
        super().__init__(name)

    def draw_decision(self, top_discard, hand, game_state):
        return random.random() < 0.5

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        candidates = list(hand)
        if drew_from_discard:
            candidates = [c for c in candidates if c != drawn_card]
        return random.choice(candidates)

    def knock_decision(self, hand, game_state):
        _, _, dw = best_meld_arrangement(hand)
        return dw <= 10
