//! Python bindings for gin-core via PyO3.
//!
//! Exposes the performance-critical card/meld/deadwood operations
//! to Python as a native extension module.

use pyo3::prelude::*;
use crate::card;
use crate::meld;

/// Compute the minimum deadwood value for a hand.
///
/// Args:
///     cards: list of card integers (0-51)
///
/// Returns:
///     int: minimum deadwood value
#[pyfunction]
fn compute_deadwood(cards: Vec<u8>) -> u32 {
    meld::compute_deadwood(&cards)
}

/// Find the best meld arrangement that minimizes deadwood.
///
/// Args:
///     cards: list of card integers (0-51)
///
/// Returns:
///     tuple: (melds, deadwood_cards, deadwood_value)
///         melds: list of lists of card ints
///         deadwood_cards: list of unmelded card ints
///         deadwood_value: int total deadwood
#[pyfunction]
fn best_meld_arrangement(cards: Vec<u8>) -> (Vec<Vec<u8>>, Vec<u8>, u32) {
    let result = meld::best_meld_arrangement(&cards);
    let melds: Vec<Vec<u8>> = result.melds.iter().map(|m| m.cards.clone()).collect();
    (melds, result.deadwood_cards, result.deadwood_value)
}

/// Find all possible melds from given cards.
///
/// Args:
///     cards: list of card integers (0-51)
///
/// Returns:
///     list of lists of card ints
#[pyfunction]
fn find_all_melds(cards: Vec<u8>) -> Vec<Vec<u8>> {
    let card_set = card::CardSet::from_cards(&cards);
    let melds = meld::find_all_melds(card_set);
    melds.iter().map(|m| m.cards.clone()).collect()
}

/// Get the deadwood point value of a single card.
///
/// Args:
///     card: card integer (0-51)
///
/// Returns:
///     int: deadwood value (1 for Ace, face value for 2-9, 10 for face cards)
#[pyfunction]
fn deadwood_value(card_id: u8) -> u8 {
    card::deadwood_value(card_id)
}

/// Get rank (0-12) of a card.
#[pyfunction]
fn card_rank(card_id: u8) -> u8 {
    card::rank(card_id)
}

/// Get suit (0-3) of a card.
#[pyfunction]
fn card_suit(card_id: u8) -> u8 {
    card::suit(card_id)
}

/// Create a card from rank and suit.
#[pyfunction]
fn make_card(rank: u8, suit: u8) -> u8 {
    card::make_card(rank, suit)
}

/// Compute which opponent deadwood cards can be laid off onto knocker's melds.
///
/// Args:
///     knocker_melds: list of melds (each meld is a list of card ints)
///     opponent_deadwood: list of opponent's deadwood card ints
///
/// Returns:
///     list of card ints that can be laid off
#[pyfunction]
fn compute_layoffs(knocker_melds: Vec<Vec<u8>>, opponent_deadwood: Vec<u8>) -> Vec<u8> {
    let melds: Vec<meld::Meld> = knocker_melds
        .into_iter()
        .map(|m| meld::Meld::new(m))
        .collect();
    let layoffs = meld::compute_layoffs(&melds, &opponent_deadwood);
    layoffs.to_vec()
}

/// Batch compute deadwood for many hands at once.
///
/// Args:
///     hands: list of lists of card ints
///
/// Returns:
///     list of deadwood values
#[pyfunction]
fn batch_compute_deadwood(hands: Vec<Vec<u8>>) -> Vec<u32> {
    hands.iter().map(|h| meld::compute_deadwood(h)).collect()
}

/// Batch best_meld_arrangement for many hands.
///
/// Args:
///     hands: list of lists of card ints
///
/// Returns:
///     list of (melds, deadwood_cards, deadwood_value) tuples
#[pyfunction]
fn batch_best_meld_arrangement(hands: Vec<Vec<u8>>) -> Vec<(Vec<Vec<u8>>, Vec<u8>, u32)> {
    hands
        .iter()
        .map(|h| {
            let result = meld::best_meld_arrangement(h);
            let melds: Vec<Vec<u8>> = result.melds.iter().map(|m| m.cards.clone()).collect();
            (melds, result.deadwood_cards, result.deadwood_value)
        })
        .collect()
}

/// The Python module definition.
pub fn register_module(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(compute_deadwood, m)?)?;
    m.add_function(wrap_pyfunction!(best_meld_arrangement, m)?)?;
    m.add_function(wrap_pyfunction!(find_all_melds, m)?)?;
    m.add_function(wrap_pyfunction!(deadwood_value, m)?)?;
    m.add_function(wrap_pyfunction!(card_rank, m)?)?;
    m.add_function(wrap_pyfunction!(card_suit, m)?)?;
    m.add_function(wrap_pyfunction!(make_card, m)?)?;
    m.add_function(wrap_pyfunction!(compute_layoffs, m)?)?;
    m.add_function(wrap_pyfunction!(batch_compute_deadwood, m)?)?;
    m.add_function(wrap_pyfunction!(batch_best_meld_arrangement, m)?)?;
    Ok(())
}
