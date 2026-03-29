//! Card representation and utilities for Gin Rummy.
//!
//! Card encoding: u8 0-51
//!   rank = card / 4   (0=Ace, 1=Two, ..., 9=Ten, 10=Jack, 11=Queen, 12=King)
//!   suit = card % 4   (0=Clubs, 1=Diamonds, 2=Spades, 3=Hearts)

pub const NUM_CARDS: usize = 52;
pub const NUM_RANKS: usize = 13;
pub const NUM_SUITS: usize = 4;

/// 52-bit bitmask card set stored in a u64.
/// Bit i is set if card i is present.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct CardSet(pub u64);

impl CardSet {
    pub const EMPTY: CardSet = CardSet(0);

    /// Create from a slice of card indices.
    #[inline]
    pub fn from_cards(cards: &[u8]) -> Self {
        let mut bits = 0u64;
        for &c in cards {
            bits |= 1u64 << c;
        }
        CardSet(bits)
    }

    /// Number of cards in the set.
    #[inline]
    pub fn len(self) -> u32 {
        self.0.count_ones()
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// Check if card is present.
    #[inline]
    pub fn contains(self, card: u8) -> bool {
        (self.0 >> card) & 1 == 1
    }

    /// Add a card.
    #[inline]
    pub fn add(&mut self, card: u8) {
        self.0 |= 1u64 << card;
    }

    /// Remove a card.
    #[inline]
    pub fn remove(&mut self, card: u8) {
        self.0 &= !(1u64 << card);
    }

    /// Set union.
    #[inline]
    pub fn union(self, other: CardSet) -> CardSet {
        CardSet(self.0 | other.0)
    }

    /// Set intersection.
    #[inline]
    pub fn intersection(self, other: CardSet) -> CardSet {
        CardSet(self.0 & other.0)
    }

    /// Set difference (self minus other).
    #[inline]
    pub fn difference(self, other: CardSet) -> CardSet {
        CardSet(self.0 & !other.0)
    }

    /// Check if self and other share any cards.
    #[inline]
    pub fn intersects(self, other: CardSet) -> bool {
        (self.0 & other.0) != 0
    }

    /// Convert to vector of card indices.
    pub fn to_vec(self) -> Vec<u8> {
        let mut result = Vec::with_capacity(self.len() as usize);
        let mut bits = self.0;
        while bits != 0 {
            let idx = bits.trailing_zeros() as u8;
            result.push(idx);
            bits &= bits - 1; // Clear lowest set bit
        }
        result
    }

    /// Iterate over card indices.
    #[inline]
    pub fn iter(self) -> CardSetIter {
        CardSetIter(self.0)
    }
}

impl std::fmt::Debug for CardSet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let cards: Vec<String> = self.iter().map(|c| card_str(c)).collect();
        write!(f, "CardSet({})", cards.join(" "))
    }
}

/// Iterator over cards in a CardSet.
pub struct CardSetIter(u64);

impl Iterator for CardSetIter {
    type Item = u8;

    #[inline]
    fn next(&mut self) -> Option<u8> {
        if self.0 == 0 {
            None
        } else {
            let idx = self.0.trailing_zeros() as u8;
            self.0 &= self.0 - 1;
            Some(idx)
        }
    }
}

/// Get rank (0-12) of a card.
#[inline]
pub fn rank(card: u8) -> u8 {
    card / 4
}

/// Get suit (0-3) of a card.
#[inline]
pub fn suit(card: u8) -> u8 {
    card % 4
}

/// Create a card from rank and suit.
#[inline]
pub fn make_card(r: u8, s: u8) -> u8 {
    r * 4 + s
}

/// Deadwood point value of a card.
/// Ace = 1, 2-9 = face value, 10/J/Q/K = 10.
#[inline]
pub fn deadwood_value(card: u8) -> u8 {
    let r = rank(card);
    match r {
        0 => 1,             // Ace
        1..=8 => r + 1,     // 2-9
        _ => 10,            // Ten, Jack, Queen, King
    }
}

/// Precomputed deadwood values for all 52 cards.
pub const DEADWOOD_TABLE: [u8; 52] = {
    let mut table = [0u8; 52];
    let mut i = 0u8;
    loop {
        if i >= 52 { break; }
        let r = i / 4;
        table[i as usize] = match r {
            0 => 1,
            1 => 2, 2 => 3, 3 => 4, 4 => 5, 5 => 6, 6 => 7, 7 => 8, 8 => 9,
            _ => 10,
        };
        i += 1;
    }
    table
};

const RANK_NAMES: [char; 13] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const SUIT_NAMES: [char; 4] = ['C', 'D', 'S', 'H'];

/// Short string representation: e.g., "7H", "AS".
pub fn card_str(card: u8) -> String {
    format!("{}{}", RANK_NAMES[rank(card) as usize], SUIT_NAMES[suit(card) as usize])
}

/// Sum of deadwood values for a card set.
#[inline]
pub fn total_deadwood(cards: CardSet) -> u32 {
    let mut total = 0u32;
    for c in cards.iter() {
        total += DEADWOOD_TABLE[c as usize] as u32;
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_card_encoding() {
        // Ace of Clubs = 0
        assert_eq!(make_card(0, 0), 0);
        assert_eq!(rank(0), 0);
        assert_eq!(suit(0), 0);

        // King of Hearts = 12*4 + 3 = 51
        assert_eq!(make_card(12, 3), 51);
        assert_eq!(rank(51), 12);
        assert_eq!(suit(51), 3);

        // 7 of Spades = 6*4 + 2 = 26
        assert_eq!(make_card(6, 2), 26);
        assert_eq!(rank(26), 6);
        assert_eq!(suit(26), 2);
    }

    #[test]
    fn test_deadwood_values() {
        assert_eq!(deadwood_value(make_card(0, 0)), 1);   // Ace
        assert_eq!(deadwood_value(make_card(1, 0)), 2);   // Two
        assert_eq!(deadwood_value(make_card(8, 0)), 9);   // Nine
        assert_eq!(deadwood_value(make_card(9, 0)), 10);  // Ten
        assert_eq!(deadwood_value(make_card(10, 0)), 10); // Jack
        assert_eq!(deadwood_value(make_card(12, 0)), 10); // King
    }

    #[test]
    fn test_cardset_ops() {
        let a = CardSet::from_cards(&[0, 4, 8]);
        let b = CardSet::from_cards(&[4, 8, 12]);

        assert_eq!(a.len(), 3);
        assert!(a.contains(0));
        assert!(!a.contains(1));

        assert_eq!(a.union(b).len(), 4);
        assert_eq!(a.intersection(b).len(), 2);
        assert_eq!(a.difference(b).len(), 1);
        assert!(a.intersects(b));

        let cards = a.to_vec();
        assert_eq!(cards, vec![0, 4, 8]);
    }

    #[test]
    fn test_cardset_iter() {
        let cs = CardSet::from_cards(&[51, 0, 26]);
        let v: Vec<u8> = cs.iter().collect();
        assert_eq!(v, vec![0, 26, 51]);
    }
}
