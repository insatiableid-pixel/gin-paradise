//! Meld detection and optimal meld arrangement for Gin Rummy.
//!
//! Melds:
//!   - Sets: 3 or 4 cards of same rank, different suits
//!   - Runs: 3+ consecutive cards of same suit (Ace low only, not adjacent to King)
//!
//! The algorithm uses bitmask-accelerated backtracking to find the optimal
//! meld arrangement that minimizes deadwood, exactly matching the Python
//! implementation semantics.

use crate::card::{self, CardSet, NUM_RANKS, NUM_SUITS};

/// A meld represented as a small sorted list of card indices.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Meld {
    pub cards: Vec<u8>,
}

impl Meld {
    pub fn new(cards: Vec<u8>) -> Self {
        let mut sorted = cards;
        sorted.sort();
        Meld { cards: sorted }
    }

    pub fn to_cardset(&self) -> CardSet {
        CardSet::from_cards(&self.cards)
    }

    /// Sum of deadwood values of cards in this meld.
    pub fn deadwood_saved(&self) -> u32 {
        self.cards.iter().map(|&c| card::DEADWOOD_TABLE[c as usize] as u32).sum()
    }

    /// Check if this is a set meld (same rank).
    pub fn is_set(&self) -> bool {
        self.cards.len() >= 3
            && self.cards.iter().all(|&c| card::rank(c) == card::rank(self.cards[0]))
    }

    /// Check if this is a run meld (consecutive same suit).
    pub fn is_run(&self) -> bool {
        if self.cards.len() < 3 {
            return false;
        }
        let s = card::suit(self.cards[0]);
        if !self.cards.iter().all(|&c| card::suit(c) == s) {
            return false;
        }
        let mut ranks: Vec<u8> = self.cards.iter().map(|&c| card::rank(c)).collect();
        ranks.sort();
        for i in 1..ranks.len() {
            if ranks[i] != ranks[i - 1] + 1 {
                return false;
            }
        }
        true
    }
}

/// Result of the best meld arrangement search.
#[derive(Clone, Debug)]
pub struct MeldResult {
    /// The optimal set of non-overlapping melds.
    pub melds: Vec<Meld>,
    /// Cards not in any meld (deadwood cards).
    pub deadwood_cards: Vec<u8>,
    /// Total deadwood value of unmelded cards.
    pub deadwood_value: u32,
}

/// Find all valid set melds (3 or 4 cards of same rank) from the given card set.
pub fn find_sets(cards: CardSet) -> Vec<Meld> {
    let mut melds = Vec::new();
    // For each rank, collect which suits are present
    for r in 0..NUM_RANKS as u8 {
        let mut suit_cards = Vec::new();
        for s in 0..NUM_SUITS as u8 {
            let c = card::make_card(r, s);
            if cards.contains(c) {
                suit_cards.push(c);
            }
        }
        if suit_cards.len() >= 3 {
            // All 3-card combinations
            for i in 0..suit_cards.len() {
                for j in (i + 1)..suit_cards.len() {
                    for k in (j + 1)..suit_cards.len() {
                        melds.push(Meld::new(vec![suit_cards[i], suit_cards[j], suit_cards[k]]));
                    }
                }
            }
            // 4-card set
            if suit_cards.len() == 4 {
                melds.push(Meld::new(suit_cards));
            }
        }
    }
    melds
}

/// Find all valid run melds (3+ consecutive cards of the same suit).
pub fn find_runs(cards: CardSet) -> Vec<Meld> {
    let mut melds = Vec::new();

    for s in 0..NUM_SUITS as u8 {
        // Collect ranks present in this suit
        let mut ranks_present = Vec::new();
        for r in 0..NUM_RANKS as u8 {
            if cards.contains(card::make_card(r, s)) {
                ranks_present.push(r);
            }
        }
        if ranks_present.len() < 3 {
            continue;
        }

        // Find consecutive sequences
        let mut sequences: Vec<Vec<u8>> = Vec::new();
        let mut current = vec![ranks_present[0]];

        for i in 1..ranks_present.len() {
            if ranks_present[i] == *current.last().unwrap() + 1 {
                current.push(ranks_present[i]);
            } else {
                if current.len() >= 3 {
                    sequences.push(current.clone());
                }
                current = vec![ranks_present[i]];
            }
        }
        if current.len() >= 3 {
            sequences.push(current);
        }

        // Extract all sub-runs of length 3+
        for seq in &sequences {
            for start in 0..seq.len() {
                for end in (start + 3)..=seq.len() {
                    let meld_cards: Vec<u8> = seq[start..end]
                        .iter()
                        .map(|&r| card::make_card(r, s))
                        .collect();
                    melds.push(Meld::new(meld_cards));
                }
            }
        }
    }
    melds
}

/// Find all possible melds from given cards.
pub fn find_all_melds(cards: CardSet) -> Vec<Meld> {
    let mut melds = find_sets(cards);
    melds.extend(find_runs(cards));
    melds
}

/// Find the optimal meld arrangement that minimizes deadwood.
///
/// Returns a MeldResult with the best set of non-overlapping melds,
/// the leftover deadwood cards, and the total deadwood value.
///
/// This uses bitmask-accelerated backtracking, exactly matching
/// the Python `best_meld_arrangement` semantics.
pub fn best_meld_arrangement(cards: &[u8]) -> MeldResult {
    let card_set = CardSet::from_cards(cards);
    let total_dw = card::total_deadwood(card_set);

    let all_melds = find_all_melds(card_set);

    if all_melds.is_empty() {
        return MeldResult {
            melds: vec![],
            deadwood_cards: cards.to_vec(),
            deadwood_value: total_dw,
        };
    }

    // Build bitmasks and deadwood-saved values for each meld
    // Use a local index bitmask (relative to the input card list)
    let card_to_idx: std::collections::HashMap<u8, usize> = cards
        .iter()
        .enumerate()
        .map(|(i, &c)| (c, i))
        .collect();

    let mut meld_masks: Vec<u64> = Vec::new();
    let mut meld_dw_saved: Vec<u32> = Vec::new();
    let mut valid_melds: Vec<Meld> = Vec::new();

    for m in &all_melds {
        if m.cards.iter().all(|c| card_to_idx.contains_key(c)) {
            let mut mask = 0u64;
            let mut saved = 0u32;
            for &c in &m.cards {
                mask |= 1u64 << card_to_idx[&c];
                saved += card::DEADWOOD_TABLE[c as usize] as u32;
            }
            meld_masks.push(mask);
            meld_dw_saved.push(saved);
            valid_melds.push(m.clone());
        }
    }

    if valid_melds.is_empty() {
        return MeldResult {
            melds: vec![],
            deadwood_cards: cards.to_vec(),
            deadwood_value: total_dw,
        };
    }

    // Backtracking search for best non-overlapping meld combination
    let mut best_saved = 0u32;
    let mut best_combo: Vec<usize> = Vec::new();

    backtrack(
        0,
        0,
        0,
        &mut Vec::new(),
        &meld_masks,
        &meld_dw_saved,
        &mut best_saved,
        &mut best_combo,
    );

    // Build result
    let mut used_cards = CardSet::EMPTY;
    let mut result_melds = Vec::new();
    for &i in &best_combo {
        result_melds.push(valid_melds[i].clone());
        for &c in &valid_melds[i].cards {
            used_cards.add(c);
        }
    }

    let remaining: Vec<u8> = cards.iter().filter(|&&c| !used_cards.contains(c)).copied().collect();
    let final_dw = total_dw - best_saved;

    MeldResult {
        melds: result_melds,
        deadwood_cards: remaining,
        deadwood_value: final_dw,
    }
}

fn backtrack(
    idx: usize,
    used_mask: u64,
    saved: u32,
    combo: &mut Vec<usize>,
    meld_masks: &[u64],
    meld_dw_saved: &[u32],
    best_saved: &mut u32,
    best_combo: &mut Vec<usize>,
) {
    if saved > *best_saved {
        *best_saved = saved;
        *best_combo = combo.clone();
    }

    for i in idx..meld_masks.len() {
        if meld_masks[i] & used_mask == 0 {
            combo.push(i);
            backtrack(
                i + 1,
                used_mask | meld_masks[i],
                saved + meld_dw_saved[i],
                combo,
                meld_masks,
                meld_dw_saved,
                best_saved,
                best_combo,
            );
            combo.pop();
        }
    }
}

/// Compute minimum deadwood value for a hand.
#[inline]
pub fn compute_deadwood(cards: &[u8]) -> u32 {
    best_meld_arrangement(cards).deadwood_value
}

/// Compute layoffs: which of opponent's deadwood cards can be laid off
/// onto the knocker's melds. Returns a CardSet of layoff-able cards.
pub fn compute_layoffs(knocker_melds: &[Meld], opponent_deadwood: &[u8]) -> CardSet {
    let available = CardSet::from_cards(opponent_deadwood);
    let mut laid_off = CardSet::EMPTY;

    // Build extended meld descriptors
    enum ExtMeld {
        Set { rank: u8, suits: u8 }, // suits as bitmask (4 bits)
        Run { suit: u8, min_rank: u8, max_rank: u8 },
    }

    let mut ext_melds: Vec<ExtMeld> = Vec::new();
    for m in knocker_melds {
        if m.is_set() {
            let r = card::rank(m.cards[0]);
            let mut suit_bits = 0u8;
            for &c in &m.cards {
                suit_bits |= 1 << card::suit(c);
            }
            ext_melds.push(ExtMeld::Set { rank: r, suits: suit_bits });
        } else if m.is_run() {
            let s = card::suit(m.cards[0]);
            let ranks: Vec<u8> = m.cards.iter().map(|&c| card::rank(c)).collect();
            let min_r = *ranks.iter().min().unwrap();
            let max_r = *ranks.iter().max().unwrap();
            ext_melds.push(ExtMeld::Run { suit: s, min_rank: min_r, max_rank: max_r });
        }
    }

    let mut changed = true;
    while changed {
        changed = false;
        for em in ext_melds.iter_mut() {
            match em {
                ExtMeld::Set { rank: r, suits } => {
                    if suits.count_ones() < 4 {
                        for s in 0..4u8 {
                            if (*suits >> s) & 1 == 0 {
                                let c = card::make_card(*r, s);
                                if available.contains(c) && !laid_off.contains(c) {
                                    laid_off.add(c);
                                    *suits |= 1 << s;
                                    changed = true;
                                }
                            }
                        }
                    }
                }
                ExtMeld::Run { suit: s, min_rank, max_rank } => {
                    // Extend low end
                    if *min_rank > 0 {
                        let c = card::make_card(*min_rank - 1, *s);
                        if available.contains(c) && !laid_off.contains(c) {
                            laid_off.add(c);
                            *min_rank -= 1;
                            changed = true;
                        }
                    }
                    // Extend high end
                    if *max_rank < 12 {
                        let c = card::make_card(*max_rank + 1, *s);
                        if available.contains(c) && !laid_off.contains(c) {
                            laid_off.add(c);
                            *max_rank += 1;
                            changed = true;
                        }
                    }
                }
            }
        }
    }

    laid_off
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::make_card;

    #[test]
    fn test_find_sets_basic() {
        // Three Aces (AC, AD, AS)
        let cards = CardSet::from_cards(&[
            make_card(0, 0), make_card(0, 1), make_card(0, 2),
        ]);
        let sets = find_sets(cards);
        assert_eq!(sets.len(), 1);
        assert!(sets[0].is_set());
    }

    #[test]
    fn test_find_sets_four() {
        // Four Kings
        let cards = CardSet::from_cards(&[
            make_card(12, 0), make_card(12, 1), make_card(12, 2), make_card(12, 3),
        ]);
        let sets = find_sets(cards);
        // 4 choose 3 = 4 three-card sets + 1 four-card set = 5
        assert_eq!(sets.len(), 5);
    }

    #[test]
    fn test_find_runs_basic() {
        // A-2-3 of Clubs
        let cards = CardSet::from_cards(&[
            make_card(0, 0), make_card(1, 0), make_card(2, 0),
        ]);
        let runs = find_runs(cards);
        assert_eq!(runs.len(), 1);
        assert!(runs[0].is_run());
    }

    #[test]
    fn test_find_runs_long() {
        // A-2-3-4-5 of Hearts
        let hand: Vec<u8> = (0..5).map(|r| make_card(r, 3)).collect();
        let cards = CardSet::from_cards(&hand);
        let runs = find_runs(cards);
        // Sub-runs: 3-len(A23,234,345), 4-len(A234,2345), 5-len(A2345) = 6
        assert_eq!(runs.len(), 6);
    }

    #[test]
    fn test_best_meld_gin() {
        // Build a gin hand: A-2-3 of Clubs, 4-5-6 of Diamonds, 7-8-9 of Spades, T-T-T set
        let hand = vec![
            make_card(0, 0), make_card(1, 0), make_card(2, 0), // A23 Clubs
            make_card(3, 1), make_card(4, 1), make_card(5, 1), // 456 Diamonds
            make_card(6, 2), make_card(7, 2), make_card(8, 2), // 789 Spades
            make_card(9, 0),                                    // TC (part of set)
        ];
        // Actually need melds to cover all... let's use a simpler gin hand
        let hand = vec![
            make_card(0, 0), make_card(1, 0), make_card(2, 0), // A23 Clubs
            make_card(3, 1), make_card(4, 1), make_card(5, 1), // 456 Diamonds
            make_card(6, 2), make_card(7, 2), make_card(8, 2), make_card(9, 2), // 789T Spades
        ];
        let result = best_meld_arrangement(&hand);
        assert_eq!(result.deadwood_value, 0);
        assert!(result.deadwood_cards.is_empty());
    }

    #[test]
    fn test_best_meld_junk() {
        // All different ranks and suits, no melds possible
        let hand = vec![
            make_card(0, 0), make_card(2, 1), make_card(4, 2), make_card(6, 3),
            make_card(8, 0), make_card(10, 1), make_card(12, 2),
        ];
        let result = best_meld_arrangement(&hand);
        assert!(result.melds.is_empty());
        assert_eq!(result.deadwood_cards.len(), 7);
        // 1 + 3 + 5 + 7 + 9 + 10 + 10 = 45
        assert_eq!(result.deadwood_value, 45);
    }

    #[test]
    fn test_overlapping_meld_choice() {
        // 7C can be in a set (7C,7D,7S) OR a run (5C,6C,7C)
        // The algorithm should pick the combination that minimizes deadwood.
        let hand = vec![
            make_card(4, 0), make_card(5, 0), make_card(6, 0), // 5C,6C,7C run
            make_card(6, 1), make_card(6, 2),                   // 7D,7S (partial set with 7C)
            make_card(12, 3),                                   // KH deadwood
        ];
        let result = best_meld_arrangement(&hand);
        // Best is the run 5C-6C-7C (saves 5+6+7=18), leaving 7D,7S,KH as deadwood (7+7+10=24)
        // vs set 7C-7D-7S (saves 7+7+7=21), leaving 5C,6C,KH as deadwood (5+6+10=21)
        // The set is better here (saves more deadwood)
        assert_eq!(result.melds.len(), 1);
        assert_eq!(result.deadwood_value, 21); // 5+6+10
    }

    #[test]
    fn test_compute_deadwood() {
        let hand: Vec<u8> = vec![
            make_card(0, 0), make_card(1, 0), make_card(2, 0), // A23 Clubs run
            make_card(12, 3), // KH = 10 deadwood
        ];
        assert_eq!(compute_deadwood(&hand), 10);
    }

    #[test]
    fn test_layoffs() {
        // Knocker has run A-2-3 of Clubs and set of 7s (7C,7D,7S)
        let melds = vec![
            Meld::new(vec![make_card(0, 0), make_card(1, 0), make_card(2, 0)]),
            Meld::new(vec![make_card(6, 0), make_card(6, 1), make_card(6, 2)]),
        ];
        // Opponent deadwood: 4C (extends run), 7H (extends set), KH (no layoff)
        let opp_dw = vec![make_card(3, 0), make_card(6, 3), make_card(12, 3)];
        let layoffs = compute_layoffs(&melds, &opp_dw);
        assert!(layoffs.contains(make_card(3, 0))); // 4C extends A-2-3 run
        assert!(layoffs.contains(make_card(6, 3))); // 7H extends 7-set
        assert!(!layoffs.contains(make_card(12, 3))); // KH can't lay off
    }
}
