import unittest

from gin_rummy.card import make_card
from gin_rummy.heisenbot import Heisenbot


def build_state(turn_number: int, my_score: int = 0, opp_score: int = 0):
    return {
        "turn_number": turn_number,
        "my_score": my_score,
        "opp_score": opp_score,
        "deck_remaining": 31,
        "discard_pile": [],
    }


class HeisenbotPaperFidelityTests(unittest.TestCase):

    def setUp(self):
        self.bot = Heisenbot("Heisenbot")

    def test_draws_ace_for_future_value_even_without_connections(self):
        hand = [
            make_card(4, 0), make_card(6, 1), make_card(8, 2), make_card(10, 3), make_card(12, 0),
            make_card(3, 1), make_card(5, 2), make_card(7, 3), make_card(9, 0), make_card(11, 1),
        ]
        top_discard = make_card(0, 2)

        self.bot.new_hand(hand, opponent_id=1)

        self.assertTrue(self.bot.draw_decision(top_discard, hand, build_state(turn_number=3)))

    def test_draws_two_for_future_value_even_without_connections(self):
        hand = [
            make_card(4, 0), make_card(6, 1), make_card(8, 2), make_card(10, 3), make_card(12, 0),
            make_card(3, 1), make_card(5, 2), make_card(7, 3), make_card(9, 0), make_card(11, 1),
        ]
        top_discard = make_card(1, 2)

        self.bot.new_hand(hand, opponent_id=1)

        self.assertTrue(self.bot.draw_decision(top_discard, hand, build_state(turn_number=3)))

    def test_draws_triangle_through_first_five_turns(self):
        hand = [
            make_card(6, 1), make_card(7, 1), make_card(1, 0), make_card(3, 2), make_card(5, 3),
            make_card(8, 0), make_card(9, 2), make_card(10, 3), make_card(11, 0), make_card(12, 2),
        ]
        top_discard = make_card(6, 0)

        self.bot.new_hand(hand, opponent_id=1)

        self.assertTrue(self.bot.draw_decision(top_discard, hand, build_state(turn_number=4)))

    def test_declines_triangle_after_five_turns_without_other_value(self):
        hand = [
            make_card(6, 1), make_card(7, 1), make_card(1, 0), make_card(3, 2), make_card(5, 3),
            make_card(8, 0), make_card(9, 2), make_card(10, 3), make_card(11, 0), make_card(12, 2),
        ]
        top_discard = make_card(6, 0)

        self.bot.new_hand(hand, opponent_id=1)

        self.assertFalse(self.bot.draw_decision(top_discard, hand, build_state(turn_number=5)))

    def test_discard_prefers_deadwood_category_before_double(self):
        hand = [
            make_card(0, 0), make_card(0, 1), make_card(0, 2), make_card(0, 3),
            make_card(1, 0), make_card(1, 1), make_card(1, 2), make_card(1, 3),
            make_card(4, 0), make_card(4, 1), make_card(5, 2),
        ]

        self.bot.new_hand(hand[:10], opponent_id=1)

        discard = self.bot.discard_decision(hand, False, None, build_state(turn_number=3))

        self.assertEqual(discard, make_card(5, 2))

    def test_discard_prefers_lowest_safety_count_within_category(self):
        hand = [
            make_card(0, 0), make_card(0, 1), make_card(0, 2), make_card(0, 3),
            make_card(1, 0), make_card(1, 1), make_card(1, 2), make_card(1, 3),
            make_card(2, 0), make_card(2, 1), make_card(3, 3),
        ]

        self.bot.new_hand(hand[:10], opponent_id=1)

        discard = self.bot.discard_decision(hand, False, None, build_state(turn_number=3))

        self.assertEqual(discard, make_card(2, 0))

    def test_discard_breaks_safety_ties_by_highest_rank(self):
        hand = [
            make_card(0, 0), make_card(0, 1), make_card(0, 2), make_card(0, 3),
            make_card(1, 0), make_card(1, 1), make_card(1, 2), make_card(1, 3),
            make_card(2, 0), make_card(3, 1), make_card(4, 0),
        ]

        self.bot.new_hand(hand[:10], opponent_id=1)

        discard = self.bot.discard_decision(hand, False, None, build_state(turn_number=3))

        self.assertEqual(discard, make_card(4, 0))

    def test_knocks_early_with_legal_high_deadwood(self):
        hand = [
            make_card(2, 0), make_card(3, 0), make_card(4, 0),
            make_card(6, 0), make_card(6, 1), make_card(6, 2),
            make_card(8, 3), make_card(9, 3), make_card(10, 3),
            make_card(7, 2),
        ]

        self.bot.new_hand(hand, opponent_id=1)

        self.assertTrue(self.bot.knock_decision(hand, build_state(turn_number=0)))

    def test_does_not_knock_when_ahead_by_thirty(self):
        hand = [
            make_card(2, 0), make_card(3, 0), make_card(4, 0),
            make_card(6, 0), make_card(6, 1), make_card(6, 2),
            make_card(8, 3), make_card(9, 3), make_card(10, 3),
            make_card(4, 2),
        ]

        self.bot.new_hand(hand, opponent_id=1)

        self.assertFalse(self.bot.knock_decision(hand, build_state(turn_number=6, my_score=40, opp_score=10)))

    def test_does_not_knock_when_behind_by_thirty(self):
        hand = [
            make_card(2, 0), make_card(3, 0), make_card(4, 0),
            make_card(6, 0), make_card(6, 1), make_card(6, 2),
            make_card(8, 3), make_card(9, 3), make_card(10, 3),
            make_card(4, 2),
        ]

        self.bot.new_hand(hand, opponent_id=1)

        self.assertFalse(self.bot.knock_decision(hand, build_state(turn_number=6, my_score=10, opp_score=40)))

    def test_knocks_with_deadwood_five_or_less_midgame(self):
        hand = [
            make_card(2, 0), make_card(3, 0), make_card(4, 0),
            make_card(6, 0), make_card(6, 1), make_card(6, 2),
            make_card(8, 3), make_card(9, 3), make_card(10, 3),
            make_card(4, 2),
        ]

        self.bot.new_hand(hand, opponent_id=1)

        self.assertTrue(self.bot.knock_decision(hand, build_state(turn_number=6)))

    def test_does_not_knock_with_high_deadwood_and_fewer_than_three_deadwood_cards(self):
        hand = [
            make_card(2, 0), make_card(3, 0), make_card(4, 0),
            make_card(6, 0), make_card(6, 1), make_card(6, 2),
            make_card(8, 3), make_card(9, 3), make_card(10, 3),
            make_card(7, 2),
        ]

        self.bot.new_hand(hand, opponent_id=1)

        self.assertFalse(self.bot.knock_decision(hand, build_state(turn_number=6)))

    def test_knocks_by_default_with_legal_hand_and_three_or_more_deadwood_cards(self):
        hand = [
            make_card(2, 0), make_card(3, 0), make_card(4, 0),
            make_card(6, 0), make_card(6, 1), make_card(6, 2),
            make_card(0, 2), make_card(1, 3), make_card(3, 1), make_card(2, 3),
        ]

        self.bot.new_hand(hand, opponent_id=1)

        self.assertTrue(self.bot.knock_decision(hand, build_state(turn_number=6)))

    def test_knocks_late_even_with_high_deadwood(self):
        hand = [
            make_card(2, 0), make_card(3, 0), make_card(4, 0),
            make_card(6, 0), make_card(6, 1), make_card(6, 2),
            make_card(8, 3), make_card(9, 3), make_card(10, 3),
            make_card(7, 2),
        ]

        self.bot.new_hand(hand, opponent_id=1)

        self.assertTrue(self.bot.knock_decision(hand, build_state(turn_number=14)))


if __name__ == "__main__":
    unittest.main()
