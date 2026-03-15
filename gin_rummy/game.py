"""
Gin Rummy game engine with full rules, scoring, and layoffs.
"""

import random
from gin_rummy.card import (
    NUM_CARDS, rank, suit, make_card, deadwood_value, card_str, hand_str, make_deck
)
from gin_rummy.meld import best_meld_arrangement, compute_layoffs

GIN_BONUS = 25
UNDERCUT_BONUS = 25
TARGET_SCORE = 100
MIN_STOCK_CARDS = 2  # Hand is void if stock reaches this
MAX_HANDS_PER_GAME = 200  # Safety limit to prevent infinite void-hand loops


class HandResult:
    """Result of a single hand."""
    __slots__ = ['winner', 'loser', 'points', 'is_gin', 'is_undercut', 'is_void',
                 'knocker', 'knocker_deadwood', 'opponent_deadwood']

    def __init__(self):
        self.winner = None
        self.loser = None
        self.points = 0
        self.is_gin = False
        self.is_undercut = False
        self.is_void = False
        self.knocker = None
        self.knocker_deadwood = 0
        self.opponent_deadwood = 0


class GameResult:
    """Result of a full game (first to TARGET_SCORE)."""
    __slots__ = ['winner', 'loser', 'winner_score', 'loser_score', 'hands_played',
                 'gin_count', 'undercut_count', 'void_count']

    def __init__(self):
        self.winner = None
        self.loser = None
        self.winner_score = 0
        self.loser_score = 0
        self.hands_played = 0
        self.gin_count = [0, 0]
        self.undercut_count = [0, 0]
        self.void_count = 0


class GinRummyGame:
    """
    Full Gin Rummy game engine.
    Manages dealing, turns, scoring, and game progression.
    """

    def __init__(self, player0, player1, target_score=TARGET_SCORE, verbose=False):
        self.players = [player0, player1]
        self.target_score = target_score
        self.verbose = verbose

    @staticmethod
    def _build_game_state(current, scores, stock, discard_pile, turn_number):
        """Build a fresh game state snapshot for the acting player."""
        return {
            'turn_number': turn_number,
            'my_score': scores[current],
            'opp_score': scores[1 - current],
            'deck_remaining': len(stock),
            'discard_pile': list(discard_pile),
        }

    def play_game(self):
        """Play a full game to target_score. Returns GameResult."""
        scores = [0, 0]
        dealer = random.randint(0, 1)
        result = GameResult()

        while scores[0] < self.target_score and scores[1] < self.target_score and result.hands_played < MAX_HANDS_PER_GAME:
            hand_result = self._play_hand(dealer, scores)
            result.hands_played += 1

            if hand_result.is_void:
                result.void_count += 1
            elif hand_result.winner is not None:
                scores[hand_result.winner] += hand_result.points
                if hand_result.is_gin:
                    result.gin_count[hand_result.winner] += 1
                if hand_result.is_undercut:
                    result.undercut_count[hand_result.winner] += 1

            dealer = 1 - dealer  # Alternate dealer

            if self.verbose:
                self._print_hand_result(hand_result, scores)

        if scores[0] >= self.target_score:
            result.winner = 0
            result.loser = 1
        else:
            result.winner = 1
            result.loser = 0
        result.winner_score = scores[result.winner]
        result.loser_score = scores[result.loser]
        return result

    def _opening_draw(self, dealer, non_dealer, scores, stock, discard_pile, hands, turn_number):
        """Resolve standard opening upcard flow and return (current, drew_from_discard, drawn_card)."""
        top_discard = discard_pile[-1]

        gs_non_dealer = self._build_game_state(non_dealer, scores, stock, discard_pile, turn_number)
        non_dealer_takes = self.players[non_dealer].draw_decision(
            top_discard, list(hands[non_dealer]), gs_non_dealer
        )

        if non_dealer_takes:
            current = non_dealer
            drawn_card = discard_pile.pop()
            hands[current].append(drawn_card)
            self.players[dealer].notify_opponent_draw(True, drawn_card)
            return current, True, drawn_card

        gs_dealer = self._build_game_state(dealer, scores, stock, discard_pile, turn_number)
        dealer_takes = self.players[dealer].draw_decision(
            top_discard, list(hands[dealer]), gs_dealer
        )

        if dealer_takes:
            current = dealer
            drawn_card = discard_pile.pop()
            hands[current].append(drawn_card)
            self.players[non_dealer].notify_opponent_draw(True, drawn_card)
            return current, True, drawn_card

        # If both decline, non-dealer must draw from stock.
        current = non_dealer
        drawn_card = stock.pop()
        hands[current].append(drawn_card)
        self.players[dealer].notify_opponent_draw(False)
        return current, False, drawn_card

    def _play_hand(self, dealer, scores):
        """Play a single hand. Returns HandResult."""
        # Deal
        deck = make_deck()
        hands = [deck[:10], deck[10:20]]
        discard_pile = [deck[20]]
        stock = deck[21:]

        # Notify players
        for p in range(2):
            opp = 1 - p
            self.players[p].new_hand(list(hands[p]), opp)

        # Build game state
        non_dealer = 1 - dealer
        current = non_dealer  # Non-dealer goes first
        turn_number = 0
        opening_offer_pending = True

        hr = HandResult()

        while True:
            # Check if stock is depleted
            if len(stock) <= MIN_STOCK_CARDS:
                hr.is_void = True
                return hr

            # --- Draw Phase ---
            drew_from_discard = False
            drawn_card = None

            if opening_offer_pending:
                current, drew_from_discard, drawn_card = self._opening_draw(
                    dealer, non_dealer, scores, stock, discard_pile, hands, turn_number
                )
                opening_offer_pending = False
            else:
                gs_draw = self._build_game_state(current, scores, stock, discard_pile, turn_number)
                top_discard = discard_pile[-1] if discard_pile else None
                take_discard = False

                if top_discard is not None:
                    take_discard = self.players[current].draw_decision(
                        top_discard, list(hands[current]), gs_draw
                    )

                if take_discard and top_discard is not None:
                    drawn_card = discard_pile.pop()
                    hands[current].append(drawn_card)
                    drew_from_discard = True
                    # Notify opponent
                    self.players[1 - current].notify_opponent_draw(True, drawn_card)
                else:
                    drawn_card = stock.pop()
                    hands[current].append(drawn_card)
                    drew_from_discard = False
                    self.players[1 - current].notify_opponent_draw(False)

            # --- Discard Phase ---
            gs_discard = self._build_game_state(current, scores, stock, discard_pile, turn_number)
            discard = self.players[current].discard_decision(
                list(hands[current]), drew_from_discard, drawn_card, gs_discard
            )

            # Validate discard
            if discard not in hands[current]:
                # Invalid discard - pick highest deadwood
                discard = max(hands[current], key=deadwood_value)
            if drew_from_discard and discard == drawn_card:
                # Can't discard what was just drawn from discard pile
                candidates = [c for c in hands[current] if c != drawn_card]
                discard = max(candidates, key=deadwood_value) if candidates else hands[current][0]

            hands[current].remove(discard)
            discard_pile.append(discard)
            self.players[1 - current].notify_opponent_discard(discard)

            # --- Knock Phase ---
            melds_k, dw_cards_k, dw_k = best_meld_arrangement(hands[current])
            gs_knock = self._build_game_state(current, scores, stock, discard_pile, turn_number)

            if dw_k <= 10:
                should_knock = self.players[current].knock_decision(
                    list(hands[current]), gs_knock
                )
            else:
                should_knock = False

            # Force knock if stock is nearly depleted
            if len(stock) <= MIN_STOCK_CARDS and dw_k <= 10:
                should_knock = True

            if should_knock:
                hr = self._score_knock(current, hands, melds_k, dw_cards_k, dw_k)
                # Notify players
                for p in range(2):
                    self.players[p].notify_hand_result(hr)
                return hr

            turn_number += 1
            current = 1 - current

    def _score_knock(self, knocker, hands, knocker_melds, knocker_dw_cards, knocker_dw):
        """Score a knock. Handle gin, layoffs, and undercuts."""
        hr = HandResult()
        hr.knocker = knocker
        opponent = 1 - knocker

        is_gin = (knocker_dw == 0)
        hr.is_gin = is_gin

        # Opponent arranges their melds
        opp_melds, opp_dw_cards, opp_dw = best_meld_arrangement(hands[opponent])

        # Layoffs (unless gin)
        if not is_gin:
            layoff_cards = compute_layoffs(knocker_melds, opp_dw_cards)
            opp_dw -= sum(deadwood_value(c) for c in layoff_cards)
            if opp_dw < 0:
                opp_dw = 0

        hr.knocker_deadwood = knocker_dw
        hr.opponent_deadwood = opp_dw

        if is_gin:
            hr.winner = knocker
            hr.loser = opponent
            hr.points = GIN_BONUS + opp_dw
        elif knocker_dw < opp_dw:
            hr.winner = knocker
            hr.loser = opponent
            hr.points = opp_dw - knocker_dw
        else:
            # Undercut (includes deadwood ties).
            hr.is_undercut = True
            hr.winner = opponent
            hr.loser = knocker
            hr.points = UNDERCUT_BONUS + (knocker_dw - opp_dw)

        return hr

    def _print_hand_result(self, hr, scores):
        if hr.is_void:
            print(f"  Hand void (stock depleted)")
        else:
            knocker_name = self.players[hr.knocker].name
            winner_name = self.players[hr.winner].name
            if hr.is_gin:
                print(f"  {knocker_name} goes GIN! +{hr.points} for {winner_name}")
            elif hr.is_undercut:
                print(f"  {knocker_name} knocked ({hr.knocker_deadwood} dw) but "
                      f"UNDERCUT by {winner_name}! +{hr.points}")
            else:
                print(f"  {knocker_name} knocks ({hr.knocker_deadwood} vs {hr.opponent_deadwood} dw) "
                      f"+{hr.points} for {winner_name}")
            print(f"  Score: {self.players[0].name}={scores[0]}, {self.players[1].name}={scores[1]}")
