import unittest

from gin_rummy.card import make_card
from gin_rummy.deepknock import DeepKnock
from gin_rummy.game import GinRummyGame, UNDERCUT_BONUS
from gin_rummy.opponent_model import IN_DISCARD, IN_MY_HAND
from gin_rummy.player import Player


class PassivePlayer(Player):
    """Deterministic player for engine tests."""

    def __init__(self, name="Passive"):
        super().__init__(name)

    def draw_decision(self, top_discard, hand, game_state):
        return False

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        candidates = [c for c in hand if not (drew_from_discard and c == drawn_card)]
        return candidates[0] if candidates else hand[0]

    def knock_decision(self, hand, game_state):
        return False


class OpeningScriptPlayer(PassivePlayer):
    def __init__(self, name, take_first_draw):
        super().__init__(name)
        self.take_first_draw = take_first_draw
        self.draw_calls = 0
        self.opponent_draw_events = []

    def draw_decision(self, top_discard, hand, game_state):
        self.draw_calls += 1
        if self.draw_calls == 1:
            return self.take_first_draw
        return False

    def notify_opponent_draw(self, from_discard, card=None):
        self.opponent_draw_events.append((from_discard, card))


class StateProbePlayer(PassivePlayer):
    def __init__(self, name):
        super().__init__(name)
        self.last_draw_state = None
        self.discard_checks = []

    def draw_decision(self, top_discard, hand, game_state):
        self.last_draw_state = dict(game_state)
        return False

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        if self.last_draw_state is not None:
            expected = self.last_draw_state['deck_remaining'] - (0 if drew_from_discard else 1)
            self.discard_checks.append(game_state['deck_remaining'] == expected)
        return super().discard_decision(hand, drew_from_discard, drawn_card, game_state)


class GinRummyRegressionTests(unittest.TestCase):

    def test_tie_knock_is_undercut(self):
        game = GinRummyGame(PassivePlayer("A"), PassivePlayer("B"))

        # Opponent has exactly 5 deadwood after best meld arrangement.
        opp_hand = [
            make_card(6, 0), make_card(6, 1), make_card(6, 2),  # set of 7s
            make_card(8, 3), make_card(9, 3), make_card(10, 3),  # 9-T-J hearts
            make_card(1, 0), make_card(2, 0), make_card(3, 0),   # 2-3-4 clubs
            make_card(4, 1),                                      # 5 deadwood
        ]
        knocker_hand = [
            make_card(0, 0), make_card(2, 1), make_card(4, 2), make_card(6, 3), make_card(8, 0),
            make_card(10, 1), make_card(12, 2), make_card(1, 3), make_card(3, 0), make_card(5, 1),
        ]

        hr = game._score_knock(
            knocker=0,
            hands=[knocker_hand, opp_hand],
            knocker_melds=[],
            knocker_dw_cards=[],
            knocker_dw=5,
        )

        self.assertTrue(hr.is_undercut)
        self.assertEqual(hr.winner, 1)
        self.assertEqual(hr.points, UNDERCUT_BONUS)

    def test_opening_flow_offers_upcard_to_dealer_if_non_dealer_declines(self):
        dealer = OpeningScriptPlayer("Dealer", take_first_draw=True)
        non_dealer = OpeningScriptPlayer("NonDealer", take_first_draw=False)
        game = GinRummyGame(dealer, non_dealer)

        # Force seat 0 to be dealer, so seat 1 is non-dealer.
        game._play_hand(dealer=0, scores=[0, 0])

        self.assertGreaterEqual(dealer.draw_calls, 1)
        self.assertTrue(non_dealer.opponent_draw_events)
        self.assertTrue(non_dealer.opponent_draw_events[0][0])  # Dealer took upcard.

    def test_discard_phase_gets_fresh_deck_remaining(self):
        p0 = StateProbePlayer("P0")
        p1 = StateProbePlayer("P1")
        game = GinRummyGame(p0, p1)

        game._play_hand(dealer=0, scores=[0, 0])

        checks = p0.discard_checks + p1.discard_checks
        self.assertTrue(checks)
        self.assertTrue(all(checks))

    def test_deepknock_updates_model_after_discard(self):
        ai = DeepKnock("DK")
        base_hand = [
            make_card(0, 0), make_card(1, 1), make_card(2, 2), make_card(3, 3), make_card(4, 0),
            make_card(5, 1), make_card(6, 2), make_card(7, 3), make_card(8, 0), make_card(9, 1),
        ]
        drawn = make_card(12, 3)

        ai.new_hand(base_hand, opponent_id=1)
        hand_11 = list(base_hand) + [drawn]
        discarded = ai.discard_decision(
            hand_11,
            drew_from_discard=False,
            drawn_card=drawn,
            game_state={
                'turn_number': 0,
                'my_score': 0,
                'opp_score': 0,
                'deck_remaining': 30,
                'discard_pile': [],
            },
        )

        post_hand = [c for c in hand_11 if c != discarded]
        for c in post_hand:
            self.assertEqual(ai.model.card_state[c], IN_MY_HAND)
        self.assertEqual(ai.model.card_state[discarded], IN_DISCARD)

    def test_deepknock_marks_visible_discards_even_if_stale_my_hand_marker_exists(self):
        ai = DeepKnock("DK")
        base_hand = [
            make_card(0, 0), make_card(1, 1), make_card(2, 2), make_card(3, 3), make_card(4, 0),
            make_card(5, 1), make_card(6, 2), make_card(7, 3), make_card(8, 0), make_card(9, 1),
        ]
        stale_card = base_hand[0]
        current_hand = base_hand[1:]

        ai.new_hand(base_hand, opponent_id=1)
        ai.model.card_state[stale_card] = IN_MY_HAND

        ai.draw_decision(
            top_discard=stale_card,
            hand=current_hand,
            game_state={
                'turn_number': 1,
                'my_score': 0,
                'opp_score': 0,
                'deck_remaining': 20,
                'discard_pile': [stale_card],
            },
        )

        self.assertEqual(ai.model.card_state[stale_card], IN_DISCARD)


class CyclingPlayer(Player):
    """Player that always takes the discard and discards highest DW, creating cycles."""

    def __init__(self, name="CyclingPlayer"):
        super().__init__(name)

    def draw_decision(self, top_discard, hand, game_state):
        return True  # Always take discard

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        from gin_rummy.card import deadwood_value
        # Can't discard what we just drew from discard pile
        if drew_from_discard and drawn_card is not None:
            candidates = [c for c in hand if c != drawn_card]
            return max(candidates, key=deadwood_value) if candidates else hand[0]
        return max(hand, key=deadwood_value)

    def knock_decision(self, hand, game_state):
        return False  # Never knock


class MaxTurnsPerHandTests(unittest.TestCase):
    """Tests for the MAX_TURNS_PER_HAND engine guard."""

    def test_degenerate_game_terminates(self):
        """Two cycling players should hit the turn limit, not hang forever."""
        import time
        from gin_rummy.game import GinRummyGame, MAX_TURNS_PER_HAND
        p0 = CyclingPlayer("C0")
        p1 = CyclingPlayer("C1")
        game = GinRummyGame(p0, p1, target_score=100, verbose=False)

        t0 = time.time()
        result = game.play_game()
        elapsed = time.time() - t0

        # Must complete in reasonable time (not hang)
        self.assertLess(elapsed, 30.0, f"Game took {elapsed:.1f}s — likely hung")
        self.assertIsNotNone(result.winner)
        # Should have some void hands from the turn limit
        self.assertGreater(result.void_count, 0,
                           "Cycling players should trigger void hands from turn limit")

    def test_normal_game_unaffected_by_turn_limit(self):
        """Normal Apex vs Apex games should finish well before MAX_TURNS_PER_HAND."""
        import random
        from gin_rummy.game import GinRummyGame
        from gin_rummy.apex import Apex
        for seed in [42, 123, 456]:
            random.seed(seed)
            g = GinRummyGame(Apex("A1"), Apex("A2"), target_score=100, verbose=False)
            r = g.play_game()
            self.assertIsNotNone(r.winner, f"Game should complete for seed {seed}")
            self.assertGreater(r.hands_played, 0)


if __name__ == '__main__':
    unittest.main()
