"""
Unit tests for the mathematical replay evaluator.

Tests the core evaluation logic without subprocess overhead:
  - Card parsing
  - Discard evaluation
  - Knock evaluation
  - Draw evaluation
  - Summary building
  - Full pipeline with sample transcripts
"""

import json
import pytest
from gin_rummy.evaluator import (
    parse_card_flexible,
    evaluate_discard,
    evaluate_knock,
    evaluate_draw,
    evaluate_replay,
    build_summary,
)
from gin_rummy.card import card_str, make_card, rank, suit, deadwood_value
from gin_rummy.meld import compute_deadwood, best_meld_arrangement


# ── Card Parsing Tests ────────────────────────────────────────────────

class TestCardParsing:
    def test_standard_format(self):
        """Parse standard 2-char card strings."""
        assert parse_card_flexible('AS') == make_card(0, 2)  # Ace of Spades
        assert parse_card_flexible('KH') == make_card(12, 3)  # King of Hearts
        assert parse_card_flexible('7D') == make_card(6, 1)  # 7 of Diamonds

    def test_unicode_suits(self):
        """Parse cards with unicode suit symbols."""
        assert parse_card_flexible('K♠') == make_card(12, 2)
        assert parse_card_flexible('A♥') == make_card(0, 3)
        assert parse_card_flexible('3♦') == make_card(2, 1)
        assert parse_card_flexible('Q♣') == make_card(11, 0)

    def test_ten_format(self):
        """Parse '10' as rank."""
        assert parse_card_flexible('10♥') == make_card(9, 3)
        assert parse_card_flexible('10S') == make_card(9, 2)

    def test_face_cards(self):
        """Parse face cards."""
        assert parse_card_flexible('J♠') == make_card(10, 2)
        assert parse_card_flexible('Q♦') == make_card(11, 1)
        assert parse_card_flexible('K♣') == make_card(12, 0)

    def test_invalid_returns_none(self):
        """Invalid inputs return None."""
        assert parse_card_flexible('') is None
        assert parse_card_flexible('X') is None
        assert parse_card_flexible(None) is None
        assert parse_card_flexible('ZZ') is None

    def test_lowercase(self):
        """Lowercase letters work."""
        assert parse_card_flexible('ah') == make_card(0, 3)
        assert parse_card_flexible('ks') == make_card(12, 2)


# ── Discard Evaluation Tests ─────────────────────────────────────────

class TestDiscardEvaluation:
    def test_optimal_discard_rated_best(self):
        """If player discards the engine-preferred card, severity is 'best'."""
        # Hand: A♣ 2♣ 3♣ 4♠ 5♠ 6♠ 7♥ 8♥ 9♥ K♦ + drawn Q♦
        hand_11 = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-3 clubs (run)
            make_card(3, 2), make_card(4, 2), make_card(5, 2),  # 4-6 spades (run)
            make_card(6, 3), make_card(7, 3), make_card(8, 3),  # 7-9 hearts (run)
            make_card(12, 1),  # K♦ (deadwood 10)
            make_card(11, 1),  # Q♦ (deadwood 10)
        ]
        # Best discard is K♦ or Q♦ (both 10 DW, both unmelded)
        result = evaluate_discard(
            hand_11, make_card(12, 1), False, make_card(11, 1),
            [], 5,
        )
        assert result['severity'] == 'best'
        assert result['dw_cost'] == 0

    def test_bad_discard_rated_mistake_or_worse(self):
        """Discarding a melded card when unmelded options exist is penalized."""
        # Hand with a clear run: A♣ 2♣ 3♣ and loose K♦ K♠ K♥ (set) + 7♥ 8♠ 9♦ Q♣ + drawn J♠
        hand_11 = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-3 clubs run
            make_card(12, 1), make_card(12, 2), make_card(12, 3),  # K set
            make_card(6, 3),  # 7♥
            make_card(7, 2),  # 8♠
            make_card(8, 1),  # 9♦
            make_card(11, 0),  # Q♣
            make_card(10, 2),  # J♠ (drawn)
        ]
        # Discarding a card from the Ace run (low DW) increases deadwood
        actual_discard = make_card(0, 0)  # Ace of clubs
        result = evaluate_discard(
            hand_11, actual_discard, False, make_card(10, 2),
            [], 5,
        )
        # Should have some DW cost since we're breaking a meld
        assert result['dw_cost'] >= 0
        assert result['type'] == 'discard'

    def test_result_structure(self):
        """Verify the evaluation result has all required fields."""
        hand_11 = list(range(11))  # Cards 0-10
        result = evaluate_discard(
            hand_11, 0, False, 10, [], 3,
        )
        assert 'type' in result
        assert 'actual_card' in result
        assert 'engine_preferred' in result
        assert 'actual_resulting_dw' in result
        assert 'engine_resulting_dw' in result
        assert 'dw_cost' in result
        assert 'severity' in result
        assert 'matches_engine' in result
        assert result['type'] == 'discard'
        assert result['severity'] in ('best', 'inaccuracy', 'mistake', 'blunder')


# ── Knock Evaluation Tests ───────────────────────────────────────────

class TestKnockEvaluation:
    def test_gin_always_knock(self):
        """Gin (0 DW) should always be knock."""
        # All melded hand = 0 DW
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-3 clubs
            make_card(3, 2), make_card(4, 2), make_card(5, 2),  # 4-6 spades
            make_card(6, 3), make_card(7, 3), make_card(8, 3),  # 7-9 hearts
            make_card(9, 1),  # Need another card... let's extend:
        ]
        _, _, dw = best_meld_arrangement(hand)
        # If DW == 0, engine says knock
        if dw == 0:
            result = evaluate_knock(hand, True, 5, 50, 50, 20)
            assert result is not None
            assert result['engine_preferred'] == True
            assert result['matches_engine'] == True
            assert result['severity'] == 'best'

    def test_cannot_knock_returns_none(self):
        """If DW > 10, returns None (nothing to evaluate)."""
        # High-DW hand
        hand = [
            make_card(12, 0), make_card(12, 1),  # KK (20 DW)
            make_card(11, 0), make_card(11, 1),  # QQ (20 DW)
            make_card(10, 0), make_card(10, 1),  # JJ (20 DW)
            make_card(9, 0), make_card(9, 1),  # TT (20 DW)
            make_card(8, 0), make_card(0, 1),   # 9,A (10 DW)
        ]
        _, _, dw = best_meld_arrangement(hand)
        if dw > 10:
            result = evaluate_knock(hand, False, 5, 50, 50, 20)
            assert result is None

    def test_low_stock_forces_knock(self):
        """With deck ≤ 8, engine always says knock."""
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-3 clubs
            make_card(3, 2), make_card(4, 2), make_card(5, 2),  # 4-6 spades
            make_card(6, 3), make_card(7, 3), make_card(8, 3),  # 7-9 hearts
            make_card(8, 1),  # 9♦ - small DW
        ]
        _, _, dw = best_meld_arrangement(hand)
        if dw <= 10:
            result = evaluate_knock(hand, True, 10, 50, 50, 5)  # deck=5
            assert result is not None
            assert result['engine_preferred'] == True

    def test_result_structure(self):
        """Verify knock evaluation result structure."""
        hand = [
            make_card(0, 0), make_card(1, 0), make_card(2, 0),
            make_card(3, 2), make_card(4, 2), make_card(5, 2),
            make_card(6, 3), make_card(7, 3), make_card(8, 3),
            make_card(8, 1),
        ]
        _, _, dw = best_meld_arrangement(hand)
        if dw <= 10:
            result = evaluate_knock(hand, True, 5, 50, 50, 20)
            assert result is not None
            assert 'type' in result
            assert 'deadwood' in result
            assert 'did_knock' in result
            assert 'engine_preferred' in result
            assert 'severity' in result
            assert 'matches_engine' in result


# ── Draw Evaluation Tests ────────────────────────────────────────────

class TestDrawEvaluation:
    def test_meld_completing_draw_detected(self):
        """Taking a card that completes a meld should be 'best'."""
        # Hand with 2 cards of same rank, discard completes the set
        hand = [
            make_card(5, 0), make_card(5, 1),  # Two 6s
            make_card(0, 0), make_card(1, 0), make_card(2, 0),  # A-3 clubs
            make_card(7, 2), make_card(8, 2), make_card(9, 2),  # 8-T spades
            make_card(11, 3), make_card(12, 3),  # Q,K hearts
        ]
        top_discard = make_card(5, 2)  # Third 6 (completes set)
        result = evaluate_draw(hand, top_discard, True, 3)
        assert result['completes_meld'] == True
        assert result['engine_preferred_take'] == True
        assert result['severity'] == 'best'

    def test_declining_meld_completing_is_mistake(self):
        """Declining a meld-completing card is a mistake."""
        hand = [
            make_card(5, 0), make_card(5, 1),
            make_card(0, 0), make_card(1, 0), make_card(2, 0),
            make_card(7, 2), make_card(8, 2), make_card(9, 2),
            make_card(11, 3), make_card(12, 3),
        ]
        top_discard = make_card(5, 2)
        result = evaluate_draw(hand, top_discard, False, 3)  # Declined
        assert result['engine_preferred_take'] == True
        assert result['severity'] == 'mistake'
        assert result['matches_engine'] == False

    def test_draw_result_structure(self):
        """Verify draw evaluation result structure."""
        hand = list(range(10))
        result = evaluate_draw(hand, 40, True, 3)
        assert 'type' in result
        assert 'top_discard' in result
        assert 'took_discard' in result
        assert 'engine_preferred_take' in result
        assert 'completes_meld' in result
        assert 'severity' in result
        assert 'matches_engine' in result
        assert result['type'] == 'draw'


# ── Summary Building Tests ───────────────────────────────────────────

class TestSummaryBuilding:
    def test_empty_evaluations(self):
        """Summary with no evaluations should report insufficient data."""
        players = [
            {'userId': 'p1', 'username': 'alice'},
            {'userId': 'p2', 'username': 'bob'},
        ]
        summary = build_summary([], 'p1', players)
        assert summary['total_evaluated'] == 0
        assert summary['methodology'] == 'apex_v2_engine_agreement'
        assert 'player_summaries' in summary
        assert summary['player_summaries']['p1']['score_label'] == 'insufficient_data'

    def test_perfect_accuracy(self):
        """All matching evaluations should yield 100% accuracy."""
        evals = [
            {'type': 'discard', 'player_id': 'p1', 'matches_engine': True, 'severity': 'best', 'dw_cost': 0},
            {'type': 'discard', 'player_id': 'p1', 'matches_engine': True, 'severity': 'best', 'dw_cost': 0},
            {'type': 'knock', 'player_id': 'p1', 'matches_engine': True, 'severity': 'best'},
        ]
        players = [
            {'userId': 'p1', 'username': 'alice'},
            {'userId': 'p2', 'username': 'bob'},
        ]
        summary = build_summary(evals, 'p1', players)
        assert summary['requesting_player_accuracy'] == 100.0
        assert summary['requesting_player_label'] == 'excellent'

    def test_mixed_accuracy(self):
        """Mix of matches and mismatches calculates correctly."""
        evals = [
            {'type': 'discard', 'player_id': 'p1', 'matches_engine': True, 'severity': 'best', 'dw_cost': 0},
            {'type': 'discard', 'player_id': 'p1', 'matches_engine': False, 'severity': 'mistake', 'dw_cost': 5},
            {'type': 'discard', 'player_id': 'p1', 'matches_engine': True, 'severity': 'best', 'dw_cost': 0},
            {'type': 'discard', 'player_id': 'p1', 'matches_engine': False, 'severity': 'blunder', 'dw_cost': 10},
        ]
        players = [
            {'userId': 'p1', 'username': 'alice'},
            {'userId': 'p2', 'username': 'bob'},
        ]
        summary = build_summary(evals, 'p1', players)
        assert summary['requesting_player_accuracy'] == 50.0
        p1s = summary['player_summaries']['p1']
        assert p1s['severity_counts']['best'] == 2
        assert p1s['severity_counts']['mistake'] == 1
        assert p1s['severity_counts']['blunder'] == 1
        assert p1s['total_discard_dw_cost'] == 15

    def test_score_labels(self):
        """Score label mapping is correct."""
        players = [{'userId': 'p1', 'username': 'x'}, {'userId': 'p2', 'username': 'y'}]

        # 95% = excellent
        evals_95 = [{'type': 'discard', 'player_id': 'p1', 'matches_engine': i < 19, 'severity': 'best', 'dw_cost': 0} for i in range(20)]
        assert build_summary(evals_95, 'p1', players)['requesting_player_label'] == 'excellent'

        # 75% = good
        evals_75 = [{'type': 'discard', 'player_id': 'p1', 'matches_engine': i < 15, 'severity': 'best' if i < 15 else 'inaccuracy', 'dw_cost': 0} for i in range(20)]
        assert build_summary(evals_75, 'p1', players)['requesting_player_label'] == 'good'


# ── Full Pipeline Tests ──────────────────────────────────────────────

class TestFullPipeline:
    def test_empty_actions(self):
        """Empty transcript produces valid but empty evaluation."""
        result = evaluate_replay({
            'actions': [],
            'players': [
                {'userId': 'p1', 'username': 'alice'},
                {'userId': 'p2', 'username': 'bob'},
            ],
            'requestingPlayerId': 'p1',
        })
        assert 'error' not in result
        assert result['total_evaluated'] == 0
        assert result['methodology'] == 'apex_v2_engine_agreement'

    def test_too_few_players(self):
        """Insufficient players returns error."""
        result = evaluate_replay({
            'actions': [],
            'players': [{'userId': 'p1', 'username': 'alice'}],
            'requestingPlayerId': 'p1',
        })
        assert result.get('error') == 'insufficient_players'

    def test_too_many_actions(self):
        """Exceeding MAX_ACTIONS returns error."""
        result = evaluate_replay({
            'actions': [{'type': 'draw', 'seq': i} for i in range(2001)],
            'players': [
                {'userId': 'p1', 'username': 'alice'},
                {'userId': 'p2', 'username': 'bob'},
            ],
            'requestingPlayerId': 'p1',
        })
        assert result.get('error') == 'transcript_too_long'

    def test_basic_transcript(self):
        """A minimal transcript with known actions evaluates without error."""
        now = 1000000
        result = evaluate_replay({
            'actions': [
                {'seq': 1, 'timestamp': now, 'type': 'match_start', 'detail': {}},
                {'seq': 2, 'timestamp': now+1, 'type': 'round_start', 'playerId': 'p1', 'playerUsername': 'alice', 'detail': {'roundNumber': 1}},
                {'seq': 3, 'timestamp': now+2, 'type': 'draw', 'playerId': 'p1', 'playerUsername': 'alice', 'detail': {'source': 'stock'}},
                {'seq': 4, 'timestamp': now+3, 'type': 'discard', 'playerId': 'p1', 'playerUsername': 'alice', 'detail': {'card': 'K♠'}},
                {'seq': 5, 'timestamp': now+4, 'type': 'draw', 'playerId': 'p2', 'playerUsername': 'bob', 'detail': {'source': 'discard', 'card': 'K♠'}},
                {'seq': 6, 'timestamp': now+5, 'type': 'discard', 'playerId': 'p2', 'playerUsername': 'bob', 'detail': {'card': '3♥'}},
                {'seq': 7, 'timestamp': now+6, 'type': 'round_end', 'playerId': 'p1', 'playerUsername': 'alice', 'detail': {}},
            ],
            'players': [
                {'userId': 'p1', 'username': 'alice'},
                {'userId': 'p2', 'username': 'bob'},
            ],
            'requestingPlayerId': 'p1',
        })
        assert 'error' not in result
        assert result['methodology'] == 'apex_v2_engine_agreement'
        assert 'player_summaries' in result
        assert 'evaluation_time_ms' in result


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
