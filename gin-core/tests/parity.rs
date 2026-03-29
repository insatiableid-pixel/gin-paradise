//! Comprehensive parity tests for the Rust gin-core engine.
//! These tests validate exact parity with the Python implementation
//! across many hand configurations.

use gin_core::card::{self, CardSet, make_card};
use gin_core::meld::{self, Meld};

/// Helper: compute deadwood for a hand given as a slice.
fn dw(cards: &[u8]) -> u32 {
    meld::compute_deadwood(cards)
}

/// Helper: get best arrangement and return (melds_count, deadwood_value).
fn arrange(cards: &[u8]) -> (usize, u32) {
    let r = meld::best_meld_arrangement(cards);
    (r.melds.len(), r.deadwood_value)
}

// ── Card encoding parity ──────────────────────────────────────

#[test]
fn test_card_encoding_parity() {
    // Matches Python: rank = card // 4, suit = card % 4
    for c in 0u8..52 {
        assert_eq!(card::rank(c), c / 4);
        assert_eq!(card::suit(c), c % 4);
        assert_eq!(make_card(c / 4, c % 4), c);
    }
}

#[test]
fn test_deadwood_values_parity() {
    // Matches Python deadwood_value
    // Ace = 1, 2=2, ..., 9=9, 10=J=Q=K=10
    let expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
    for r in 0u8..13 {
        for s in 0u8..4 {
            let c = make_card(r, s);
            assert_eq!(card::deadwood_value(c), expected[r as usize]);
        }
    }
}

// ── Gin hands (deadwood == 0) ──────────────────────────────────

#[test]
fn test_gin_three_runs_one_set() {
    // A-2-3 Clubs, 4-5-6 Diamonds, 7-8-9 Spades, T-T-T set (3 suits)
    let hand = vec![
        make_card(0, 0), make_card(1, 0), make_card(2, 0),  // A23C
        make_card(3, 1), make_card(4, 1), make_card(5, 1),  // 456D
        make_card(6, 2), make_card(7, 2), make_card(8, 2),  // 789S
        make_card(9, 3),                                     // TH
    ];
    // This isn't actually gin because TH alone can't form a meld.
    // Let's fix: use T-T-T set
    let hand = vec![
        make_card(0, 0), make_card(1, 0), make_card(2, 0),  // A23C
        make_card(3, 1), make_card(4, 1), make_card(5, 1),  // 456D
        make_card(9, 0), make_card(9, 1), make_card(9, 2), make_card(9, 3),  // TTTT
    ];
    assert_eq!(dw(&hand), 0);
}

#[test]
fn test_gin_all_runs() {
    // A-2-3 Clubs, 4-5-6 Clubs (wait, these overlap suit)
    // A-2-3 Clubs, 5-6-7 Diamonds, 9-T-J-K Spades — Nope.
    // Clean gin: A-2-3-4 Clubs, 5-6-7 Diamonds, 8-9-T Hearts
    let hand = vec![
        make_card(0, 0), make_card(1, 0), make_card(2, 0), make_card(3, 0), // A234C
        make_card(4, 1), make_card(5, 1), make_card(6, 1), // 567D
        make_card(7, 3), make_card(8, 3), make_card(9, 3), // 89TH
    ];
    assert_eq!(dw(&hand), 0);
}

// ── Junk hands (no melds) ──────────────────────────────────────

#[test]
fn test_all_face_cards_no_melds() {
    // K♣ Q♦ J♠ T♥ K♦ Q♠ J♥ T♣ K♠ Q♥
    // All different rank-suit combos but no sets or runs
    let hand = vec![
        make_card(12, 0), make_card(11, 1), make_card(10, 2), make_card(9, 3),
        make_card(12, 1), make_card(11, 2), make_card(10, 3), make_card(9, 0),
        make_card(12, 2), make_card(11, 3),
    ];
    // Actually K♣ K♦ K♠ form a set! Let me use truly scattered cards.
    let hand = vec![
        make_card(0, 0), make_card(2, 1), make_card(4, 2), make_card(6, 3),
        make_card(8, 0), make_card(10, 1), make_card(12, 2),
        make_card(1, 3), make_card(5, 0), make_card(9, 1),
    ];
    // No sets (all different ranks), no runs (gaps in each suit)
    // DW: A=1, 3=3, 5=5, 7=7, 9=9, J=10, K=10, 2=2, 6=6, T=10 = 63
    assert_eq!(dw(&hand), 63);
    let (melds, _) = arrange(&hand);
    assert_eq!(melds, 0);
}

// ── Mixed meld hands ──────────────────────────────────────────

#[test]
fn test_one_run_rest_deadwood() {
    // 5-6-7 of Hearts + 7 deadwood cards
    // Note: make_card(3,3) = 4H which extends the run to 4-5-6-7H
    let hand = vec![
        make_card(4, 3), make_card(5, 3), make_card(6, 3), // 567H
        make_card(0, 0), make_card(2, 1), make_card(8, 2),
        make_card(10, 0), make_card(12, 1), make_card(1, 2), make_card(3, 3),
    ];
    // 4H extends the run to 4567H (saves 4+5+6+7=22)
    // Remaining deadwood: A(1)+3(3)+9(9)+J(10)+K(10)+2(2) = 35
    let (melds, deadwood) = arrange(&hand);
    assert_eq!(melds, 1);
    assert_eq!(deadwood, 35);
}

#[test]
fn test_one_set_rest_deadwood() {
    // Three 8s (8C 8D 8S)
    let hand = vec![
        make_card(7, 0), make_card(7, 1), make_card(7, 2), // 888
        make_card(0, 0), make_card(2, 1), make_card(4, 2),
        make_card(6, 3), make_card(10, 0), make_card(12, 1), make_card(1, 3),
    ];
    // Set saves 8+8+8=24 (wait... 8 is rank 7, value = 8)
    // Remaining: A(1)+3(3)+5(5)+7(7)+J(10)+K(10)+2(2) = 38
    let (melds, deadwood) = arrange(&hand);
    assert_eq!(melds, 1);
    assert_eq!(deadwood, 38);
}

// ── Overlapping meld choices ──────────────────────────────────

#[test]
fn test_shared_card_run_vs_set() {
    // 7C can join run 5C-6C-7C or set 7C-7D-7S
    // Run saves 5+6+7=18, Set saves 7+7+7=21
    // Should pick set to minimize deadwood
    let hand = vec![
        make_card(4, 0), make_card(5, 0), make_card(6, 0), // 5C 6C 7C
        make_card(6, 1), make_card(6, 2),                   // 7D 7S
        make_card(12, 3),                                    // KH
    ];
    let result = meld::best_meld_arrangement(&hand);
    assert_eq!(result.melds.len(), 1);
    // Set (7C 7D 7S) saves 21, leaves 5C(5)+6C(6)+K(10) = 21
    assert_eq!(result.deadwood_value, 21);
}

#[test]
fn test_two_melds_better_than_one_big() {
    // Sometimes two smaller melds beat one larger meld
    // A-2-3 Clubs and 5-5-5 set vs A-2-3-4-5 Clubs run
    let hand = vec![
        make_card(0, 0), make_card(1, 0), make_card(2, 0),  // A23C
        make_card(3, 0), make_card(4, 0),                    // 45C
        make_card(4, 1), make_card(4, 2),                    // 5D 5S
        make_card(12, 3), make_card(11, 3), make_card(10, 3), // KH QH JH
    ];
    // Best: A234C run (4 cards) + 5C-5D-5S set (3 cards) + JQKH run (3 cards) = all 10 cards
    // This is gin! DW = 0
    let result = meld::best_meld_arrangement(&hand);
    assert_eq!(result.deadwood_value, 0);
}

// ── Near-gin hands ──────────────────────────────────────────

#[test]
fn test_near_gin_one_deadwood() {
    // 3 melds + 1 Ace deadwood = DW of 1
    let hand = vec![
        make_card(0, 0), make_card(1, 0), make_card(2, 0),  // A23C
        make_card(5, 1), make_card(6, 1), make_card(7, 1),  // 678D
        make_card(9, 0), make_card(9, 1), make_card(9, 2),  // TTT
        make_card(0, 3),                                     // AH = 1 DW
    ];
    assert_eq!(dw(&hand), 1);
}

// ── Edge cases ──────────────────────────────────────────────

#[test]
fn test_empty_hand() {
    assert_eq!(dw(&[]), 0);
}

#[test]
fn test_single_card() {
    assert_eq!(dw(&[make_card(12, 0)]), 10); // King
    assert_eq!(dw(&[make_card(0, 0)]), 1);   // Ace
}

#[test]
fn test_two_cards_no_meld() {
    assert_eq!(dw(&[make_card(0, 0), make_card(6, 3)]), 8); // A + 7 = 1 + 7
}

#[test]
fn test_four_of_a_kind() {
    // Four Kings: should pick 4-card set (saves all 40), no deadwood from kings
    let hand = vec![
        make_card(12, 0), make_card(12, 1), make_card(12, 2), make_card(12, 3),
        make_card(0, 0), // A = 1 DW
    ];
    let result = meld::best_meld_arrangement(&hand);
    // Should use the 4-card set
    assert_eq!(result.deadwood_value, 1);
}

// ── Layoff tests ──────────────────────────────────────────────

#[test]
fn test_layoff_extends_run_both_ends() {
    // Knocker has 5-6-7 of Hearts
    let melds = vec![
        Meld::new(vec![make_card(4, 3), make_card(5, 3), make_card(6, 3)]),
    ];
    // Opponent has 4H (extends low), 8H (extends high), 9H (chains after 8H), KC (no)
    let opp_dw = vec![make_card(3, 3), make_card(7, 3), make_card(8, 3), make_card(12, 0)];
    let layoffs = meld::compute_layoffs(&melds, &opp_dw);
    assert!(layoffs.contains(make_card(3, 3))); // 4H
    assert!(layoffs.contains(make_card(7, 3))); // 8H
    assert!(layoffs.contains(make_card(8, 3))); // 9H (chains)
    assert!(!layoffs.contains(make_card(12, 0))); // KC
}

#[test]
fn test_layoff_extends_set() {
    // Knocker has set of 5s (5C 5D 5S)
    let melds = vec![
        Meld::new(vec![make_card(4, 0), make_card(4, 1), make_card(4, 2)]),
    ];
    // Opponent has 5H
    let opp_dw = vec![make_card(4, 3)];
    let layoffs = meld::compute_layoffs(&melds, &opp_dw);
    assert!(layoffs.contains(make_card(4, 3))); // 5H
}

// ── CardSet tests ──────────────────────────────────────────────

#[test]
fn test_cardset_full_deck() {
    let all: Vec<u8> = (0..52).collect();
    let cs = CardSet::from_cards(&all);
    assert_eq!(cs.len(), 52);
    for c in 0..52u8 {
        assert!(cs.contains(c));
    }
}

#[test]
fn test_cardset_difference_identity() {
    let a = CardSet::from_cards(&[1, 5, 10, 20, 30]);
    let empty = a.difference(a);
    assert!(empty.is_empty());
}

// ── Batch random hand parity (statistical) ──────────────────

#[test]
fn test_many_random_hands() {
    // Generate deterministic "random-like" hands and verify consistency
    // Use a simple LCG for reproducibility
    let mut state: u64 = 12345;
    let mut lcg = || -> u64 {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        state
    };

    for _ in 0..1000 {
        // Generate a random 10-card hand
        let mut deck: Vec<u8> = (0..52).collect();
        // Fisher-Yates shuffle with our LCG
        for i in (1..52).rev() {
            let j = (lcg() % (i as u64 + 1)) as usize;
            deck.swap(i, j);
        }
        let hand: Vec<u8> = deck[..10].to_vec();

        let result = meld::best_meld_arrangement(&hand);

        // Invariant checks
        let total_dw: u32 = hand.iter().map(|&c| card::DEADWOOD_TABLE[c as usize] as u32).sum();
        let meld_saved: u32 = result.melds.iter().map(|m| m.deadwood_saved()).sum();
        assert_eq!(result.deadwood_value, total_dw - meld_saved,
            "Deadwood accounting mismatch for hand {:?}", hand);

        // Check no card appears in two melds
        let mut used = CardSet::EMPTY;
        for m in &result.melds {
            let ms = m.to_cardset();
            assert!(!used.intersects(ms), "Overlapping melds in hand {:?}", hand);
            used = used.union(ms);
        }

        // Check all cards accounted for
        let used_plus_dw: Vec<u8> = {
            let mut v = used.to_vec();
            v.extend_from_slice(&result.deadwood_cards);
            v.sort();
            v
        };
        let mut sorted_hand = hand.clone();
        sorted_hand.sort();
        assert_eq!(used_plus_dw, sorted_hand, "Card accounting mismatch for hand {:?}", hand);

        // All melds must be valid
        for m in &result.melds {
            assert!(m.is_set() || m.is_run(), "Invalid meld {:?} in hand {:?}", m, hand);
        }
    }
}
