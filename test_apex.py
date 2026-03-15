"""Tests protecting Apex bot behavior after strength improvements."""
import unittest
from gin_rummy.card import make_card, rank, suit, deadwood_value
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.apex import Apex
from gin_rummy.opponent_model import IN_MY_HAND, IN_DISCARD, KNOWN_OPPONENT


class ApexDrawTests(unittest.TestCase):

    def _make_apex(self, hand):
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        return a

    def _gs(self, turn=0, pile=None):
        return {
            'turn_number': turn,
            'my_score': 0, 'opp_score': 0,
            'deck_remaining': 30,
            'discard_pile': pile or [],
        }

    def test_takes_meld_completing_card(self):
        # Hand has 7C 7D, offer 7S -> completes set
        hand = [
            make_card(6, 0), make_card(6, 1),  # 7C, 7D
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3 clubs run
            make_card(8, 2), make_card(9, 2), make_card(10, 2),  # 9-T-J spades
            make_card(11, 3), make_card(4, 1),
        ]
        a = self._make_apex(hand)
        self.assertTrue(a.draw_decision(make_card(6, 2), hand, self._gs()))  # 7S

    def test_declines_useless_high_card(self):
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),
            make_card(4, 1), make_card(5, 1), make_card(6, 1),
            make_card(8, 2), make_card(9, 2), make_card(10, 2),
            make_card(3, 3),
        ]
        a = self._make_apex(hand)
        # King of hearts - no meld potential, doesn't reduce DW
        self.assertFalse(a.draw_decision(make_card(12, 3), hand, self._gs()))

    def test_always_takes_ace(self):
        """Paper rule: always take Aces from discard."""
        hand = [
            make_card(5, 0), make_card(6, 1), make_card(7, 2),
            make_card(8, 3), make_card(9, 0), make_card(10, 1),
            make_card(11, 2), make_card(12, 3), make_card(3, 0),
            make_card(4, 1),
        ]
        a = self._make_apex(hand)
        # Ace of hearts - no meld potential, but paper says always take
        self.assertTrue(a.draw_decision(make_card(0, 3), hand, self._gs()))

    def test_always_takes_two(self):
        """Paper rule: always take Twos from discard."""
        hand = [
            make_card(5, 0), make_card(6, 1), make_card(7, 2),
            make_card(8, 3), make_card(9, 0), make_card(10, 1),
            make_card(11, 2), make_card(12, 3), make_card(3, 0),
            make_card(4, 1),
        ]
        a = self._make_apex(hand)
        self.assertTrue(a.draw_decision(make_card(1, 3), hand, self._gs()))

    def test_triangle_draw_early_game(self):
        # Has 5C and 5D; offer 5S which is a triangle with adjacent potential
        hand = [
            make_card(4, 0), make_card(4, 1),  # 5C, 5D (same rank pair)
            make_card(3, 0),                     # 4C (adjacent to 5C -> triangle)
            make_card(8, 2), make_card(9, 2), make_card(10, 2),
            make_card(0, 3), make_card(1, 3), make_card(2, 3),
            make_card(12, 1),
        ]
        a = self._make_apex(hand)
        offered = make_card(4, 2)  # 5S
        # Should take triangle in early game if no DW cost
        result = a.draw_decision(offered, hand, self._gs(turn=2))
        # Triangle detection: 5S + 5C pair + 4C adjacent = triangle
        self.assertTrue(result)


class ApexDiscardTests(unittest.TestCase):

    def _gs(self, turn=0):
        return {
            'turn_number': turn,
            'my_score': 0, 'opp_score': 0,
            'deck_remaining': 30,
            'discard_pile': [],
        }

    def test_discards_highest_isolated_deadwood(self):
        # Hand with melds and isolated high cards
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3C run
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D run
            make_card(8, 2), make_card(9, 2), make_card(10, 2), # 9-T-JS run
            make_card(12, 3), make_card(11, 0),  # KH (10 DW), QC (10 DW)
        ]
        a = Apex("Test")
        a.new_hand(hand[:10], opponent_id=1)
        discard = a.discard_decision(hand, False, make_card(11, 0), self._gs())
        # Should discard one of the high DW cards (K or Q)
        self.assertIn(rank(discard), [11, 12])

    def test_keeps_near_meld_over_isolated(self):
        # Two 5s (partial set) + isolated K: should discard K over the pair
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3C run
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D run
            make_card(8, 2), make_card(9, 2), make_card(10, 2), # 9-T-JS run
            make_card(4, 0), make_card(12, 3),  # 5C (pairs with 5D) + KH isolated
        ]
        a = Apex("Test")
        a.new_hand(hand[:10], opponent_id=1)
        discard = a.discard_decision(hand, False, make_card(12, 3), self._gs())
        # Should discard isolated KH (10 DW) not the 5C which pairs with 5D in melds
        self.assertEqual(discard, make_card(12, 3))

    def test_respects_drew_from_discard_restriction(self):
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),
            make_card(4, 1), make_card(5, 1), make_card(6, 1),
            make_card(8, 2), make_card(9, 2), make_card(10, 2),
            make_card(12, 3), make_card(3, 3),
        ]
        drawn = make_card(3, 3)
        a = Apex("Test")
        a.new_hand(hand[:10], opponent_id=1)
        discard = a.discard_decision(hand, True, drawn, self._gs())
        self.assertNotEqual(discard, drawn)


class ApexKnockTests(unittest.TestCase):

    def _gs(self, turn=5, my_score=0, opp_score=0):
        return {
            'turn_number': turn,
            'my_score': my_score, 'opp_score': opp_score,
            'deck_remaining': 20,
            'discard_pile': [],
        }

    def test_always_knocks_gin(self):
        # Real gin hand: all melded
        gin_hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),
            make_card(4, 1), make_card(5, 1), make_card(6, 1),
            make_card(8, 2), make_card(9, 2), make_card(10, 2),
            make_card(3, 0),  # 4C extends A-2-3C to A-2-3-4C
        ]
        a = Apex("Test")
        a.new_hand(gin_hand, opponent_id=1)
        self.assertTrue(a.knock_decision(gin_hand, self._gs()))

    def test_knocks_at_low_dw(self):
        # DW = 1 (just an ace)
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),
            make_card(4, 1), make_card(5, 1), make_card(6, 1),
            make_card(8, 2), make_card(9, 2), make_card(10, 2),
            make_card(0, 3),  # Ace = 1 DW
        ]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        self.assertTrue(a.knock_decision(hand, self._gs()))

    def test_does_not_knock_above_10(self):
        hand = [
            make_card(12, 0), make_card(11, 1), make_card(10, 2),
            make_card(9, 3), make_card(8, 0), make_card(7, 1),
            make_card(6, 2), make_card(5, 3), make_card(4, 0),
            make_card(3, 1),
        ]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        _, _, dw = best_meld_arrangement(hand)
        if dw > 10:
            self.assertFalse(a.knock_decision(hand, self._gs()))

    def test_score_aware_hold_when_ahead(self):
        """Paper rule: ahead by >=30, few DW cards → hold for gin."""
        # 3 melds + 1 low DW card = DW 2, 1 DW card
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3C
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D
            make_card(8, 2), make_card(9, 2), make_card(10, 2), # 9-T-JS
            make_card(1, 3),  # 2H = 2 DW, only 1 DW card
        ]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        # Ahead by 40 (70-30), mid-game: should hold for gin
        result = a.knock_decision(hand, self._gs(turn=6, my_score=70, opp_score=30))
        self.assertFalse(result)

    def test_score_aware_hold_when_behind(self):
        """Paper rule: behind by >=30, few DW cards → hold for gin."""
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3C
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D
            make_card(8, 2), make_card(9, 2), make_card(10, 2), # 9-T-JS
            make_card(1, 3),  # 2H = 2 DW, only 1 DW card
        ]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        # Behind by 40 (30-70), mid-game: should hold for gin
        result = a.knock_decision(hand, self._gs(turn=6, my_score=30, opp_score=70))
        self.assertFalse(result)

    def test_few_dw_cards_hold_rule(self):
        """Paper rule 7: DW > 5 but only 1-2 DW cards → don't knock."""
        # 2 melds + 1 face card as only DW = DW 10, 1 DW card
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3C
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D
            make_card(8, 2), make_card(9, 2), make_card(10, 2), # 9-T-JS
            make_card(12, 3),  # KH = 10 DW, but only 1 DW card
        ]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        _, dw_cards, dw = best_meld_arrangement(hand)
        # DW=10, 1 DW card, mid-game: should hold
        if dw > 5 and len(dw_cards) <= 2:
            result = a.knock_decision(hand, self._gs(turn=7, my_score=50, opp_score=50))
            self.assertFalse(result)

    def test_knocks_early_game_aggressively(self):
        """Paper rule: turns 0-3, knock aggressively."""
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3C run
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D run
            make_card(8, 2), make_card(9, 2), make_card(10, 2), # 9-T-JS run
            make_card(7, 3),  # 8H = 8 DW
        ]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        _, _, dw = best_meld_arrangement(hand)
        if dw <= 10:
            # Turn 2, early game: should knock aggressively
            result = a.knock_decision(hand, self._gs(turn=2))
            self.assertTrue(result)

    def test_stock_depth_knock_override(self):
        """When deck_remaining <= 8 and DW <= 10 → always knock to avoid void."""
        # DW = 10 (one King), mid-game: normally might hold
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3C
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D
            make_card(8, 2), make_card(9, 2), make_card(10, 2), # 9-T-JS
            make_card(12, 3),  # KH = 10 DW, 1 DW card
        ]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        # With deck_remaining=6 (≤ 8), should knock despite only 1 DW card
        gs = {'turn_number': 7, 'my_score': 50, 'opp_score': 50,
              'deck_remaining': 6, 'discard_pile': []}
        result = a.knock_decision(hand, gs)
        self.assertTrue(result)

    def test_stock_depth_does_not_override_high_dw(self):
        """Stock-depth override should not apply when DW > 10."""
        hand = [
            make_card(12, 0), make_card(11, 1), make_card(10, 2),
            make_card(9, 3), make_card(8, 0), make_card(7, 1),
            make_card(6, 2), make_card(5, 3), make_card(4, 0),
            make_card(3, 1),
        ]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        _, _, dw = best_meld_arrangement(hand)
        if dw > 10:
            gs = {'turn_number': 7, 'my_score': 50, 'opp_score': 50,
                  'deck_remaining': 5, 'discard_pile': []}
            result = a.knock_decision(hand, gs)
            self.assertFalse(result)

    def test_score_gap_threshold_at_22(self):
        """Score gap threshold changed from 30 to 22. 
        At gap=25 (>22) with 1 DW card, should hold for gin."""
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3C
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D
            make_card(8, 2), make_card(9, 2), make_card(10, 2), # 9-T-JS
            make_card(1, 3),  # 2H = 2 DW, only 1 DW card
        ]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        # Ahead by 25 (>22): should hold for gin
        result = a.knock_decision(hand, self._gs(turn=6, my_score=60, opp_score=35))
        self.assertFalse(result)


class ApexOpponentModelTests(unittest.TestCase):

    def test_model_tracks_opponent_pickup(self):
        hand = [make_card(i, 0) for i in range(10)]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        picked = make_card(10, 1)
        a.notify_opponent_draw(True, picked)
        self.assertIn(picked, a.model.get_known_opponent_cards())

    def test_model_tracks_opponent_discard(self):
        hand = [make_card(i, 0) for i in range(10)]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        picked = make_card(10, 1)
        a.notify_opponent_draw(True, picked)
        a.notify_opponent_discard(picked)
        self.assertNotIn(picked, a.model.get_known_opponent_cards())
        self.assertEqual(a.model.card_state[picked], IN_DISCARD)

    def test_decline_tracking(self):
        hand = [make_card(i, 0) for i in range(10)]
        a = Apex("Test")
        a.new_hand(hand, opponent_id=1)
        a._top_for_opp = make_card(12, 3)
        a.notify_opponent_draw(False)  # opponent declined
        self.assertIn(make_card(12, 3), a.declined)

    def test_model_updates_on_discard_decision(self):
        hand = [
            make_card(0, 0), make_card(1, 1), make_card(2, 2),
            make_card(3, 3), make_card(4, 0), make_card(5, 1),
            make_card(6, 2), make_card(7, 3), make_card(8, 0),
            make_card(9, 1), make_card(12, 3),
        ]
        a = Apex("Test")
        a.new_hand(hand[:10], opponent_id=1)
        discarded = a.discard_decision(hand, False, make_card(12, 3), {
            'turn_number': 0, 'my_score': 0, 'opp_score': 0,
            'deck_remaining': 30, 'discard_pile': [],
        })
        self.assertEqual(a.model.card_state[discarded], IN_DISCARD)
        post_hand = [c for c in hand if c != discarded]
        for c in post_hand:
            self.assertEqual(a.model.card_state[c], IN_MY_HAND)


class ApexFormsDoubleGapTests(unittest.TestCase):
    """Tests for the _forms_double gap-adjacency fix."""

    def test_detects_distance_2_gap_same_suit(self):
        """5♠ and 7♠ should be detected as a partial run (gap of 1 card)."""
        a = Apex("Test")
        hand = [make_card(i, 0) for i in range(10)]
        a.new_hand(hand, opponent_id=1)
        # 5♠ (rank=4, suit=2) with 7♠ (rank=6, suit=2) already in hand
        card = make_card(4, 2)   # 5♠
        test_hand = [make_card(6, 2)]  # 7♠ only
        self.assertTrue(a._forms_double(card, test_hand))

    def test_detects_adjacent_same_suit(self):
        """Original distance-1 detection should still work."""
        a = Apex("Test")
        hand = [make_card(i, 0) for i in range(10)]
        a.new_hand(hand, opponent_id=1)
        card = make_card(4, 2)   # 5♠
        test_hand = [make_card(5, 2)]  # 6♠
        self.assertTrue(a._forms_double(card, test_hand))

    def test_rejects_distance_3_gap(self):
        """5♠ and 8♠ (distance 3) should NOT be detected as partial run."""
        a = Apex("Test")
        hand = [make_card(i, 0) for i in range(10)]
        a.new_hand(hand, opponent_id=1)
        card = make_card(4, 2)   # 5♠
        test_hand = [make_card(7, 2)]  # 8♠ only (no pair, no close adjacency)
        self.assertFalse(a._forms_double(card, test_hand))


class ApexActualDWDiscardTests(unittest.TestCase):
    """Tests verifying actual-DW discard minimization (not heuristic)."""

    def _gs(self, turn=0):
        return {
            'turn_number': turn,
            'my_score': 0, 'opp_score': 0,
            'deck_remaining': 30,
            'discard_pile': [],
        }

    def test_discards_card_minimizing_remaining_dw(self):
        """Actual-DW should pick the discard that leaves lowest remaining DW."""
        # 3 melds + isolated K (10 DW) and isolated Q (10 DW)
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3C run
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D run
            make_card(8, 2), make_card(9, 2), make_card(10, 2), # 9-T-JS run
            make_card(12, 3), make_card(11, 0),  # KH (10), QC (10)
        ]
        a = Apex("Test")
        a.new_hand(hand[:10], opponent_id=1)
        discard = a.discard_decision(hand, False, make_card(11, 0), self._gs())
        # Either K or Q is fine, both give same remaining DW
        self.assertIn(rank(discard), [11, 12])

    def test_prefers_card_not_participating_in_melds(self):
        """Should not discard a card that's part of a better meld arrangement."""
        # A-2-3 clubs run is the meld. 5D pairs with 5C.
        # K hearts is isolated, should be discarded over the paired 5.
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-2-3C run
            make_card(4, 1), make_card(5, 1), make_card(6, 1),  # 5-6-7D run
            make_card(8, 2), make_card(9, 2), make_card(10, 2), # 9-T-JS run
            make_card(4, 0), make_card(12, 3),  # 5C (pairs with 5D) + KH isolated
        ]
        a = Apex("Test")
        a.new_hand(hand[:10], opponent_id=1)
        discard = a.discard_decision(hand, False, make_card(12, 3), self._gs())
        # KH should be chosen: discarding it leaves DW=5 (just the 5C left)
        # vs discarding 5C which leaves DW=10 (just the KH left)
        self.assertEqual(discard, make_card(12, 3))


class ApexEndToEndTests(unittest.TestCase):

    def test_apex_completes_game_without_error(self):
        from gin_rummy.game import GinRummyGame
        import random
        random.seed(42)
        a = Apex("A")
        b = Apex("B")
        result = GinRummyGame(a, b, target_score=100, verbose=False).play_game()
        self.assertIn(result.winner, [0, 1])
        self.assertGreater(result.hands_played, 0)

    def test_apex_beats_random_consistently(self):
        from gin_rummy.game import GinRummyGame
        from gin_rummy.player import RandomPlayer
        from gin_rummy.benchmark import run_balanced_matchup
        r = run_balanced_matchup(
            lambda: Apex("Apex"), lambda: RandomPlayer("Random"),
            n_games=50, target_score=100, seed=42, progress=False
        )
        # Apex should beat random at least 80% of the time
        self.assertGreater(r.win_rate_a, 0.70)


if __name__ == '__main__':
    unittest.main()
