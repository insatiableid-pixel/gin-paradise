//! Rust-side benchmark for gin-core performance.
//! Measures deadwood computation and meld arrangement throughput.

use gin_core::card::{self, make_card};
use gin_core::meld;
use std::time::Instant;

fn main() {
    println!("=== gin-core Rust Benchmark ===\n");

    // Generate deterministic hands using a simple LCG
    let mut state: u64 = 42;
    let mut lcg = || -> u64 {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        state
    };

    let num_hands = 100_000;
    let mut hands: Vec<Vec<u8>> = Vec::with_capacity(num_hands);

    for _ in 0..num_hands {
        let mut deck: Vec<u8> = (0..52).collect();
        for i in (1..52).rev() {
            let j = (lcg() % (i as u64 + 1)) as usize;
            deck.swap(i, j);
        }
        hands.push(deck[..10].to_vec());
    }

    // Warm up
    for hand in &hands[..100] {
        let _ = meld::best_meld_arrangement(hand);
    }

    // Benchmark: compute_deadwood
    let start = Instant::now();
    let mut total_dw = 0u64;
    for hand in &hands {
        total_dw += meld::compute_deadwood(hand) as u64;
    }
    let dw_elapsed = start.elapsed();
    println!("compute_deadwood × {}:", num_hands);
    println!("  Total time:     {:.3}ms", dw_elapsed.as_secs_f64() * 1000.0);
    println!("  Per hand:       {:.1}μs", dw_elapsed.as_secs_f64() * 1_000_000.0 / num_hands as f64);
    println!("  Throughput:     {:.0} hands/sec", num_hands as f64 / dw_elapsed.as_secs_f64());
    println!("  Avg deadwood:   {:.1}", total_dw as f64 / num_hands as f64);
    println!();

    // Benchmark: best_meld_arrangement (full result)
    let start = Instant::now();
    let mut total_melds = 0usize;
    for hand in &hands {
        let result = meld::best_meld_arrangement(hand);
        total_melds += result.melds.len();
    }
    let meld_elapsed = start.elapsed();
    println!("best_meld_arrangement × {}:", num_hands);
    println!("  Total time:     {:.3}ms", meld_elapsed.as_secs_f64() * 1000.0);
    println!("  Per hand:       {:.1}μs", meld_elapsed.as_secs_f64() * 1_000_000.0 / num_hands as f64);
    println!("  Throughput:     {:.0} hands/sec", num_hands as f64 / meld_elapsed.as_secs_f64());
    println!("  Avg melds/hand: {:.2}", total_melds as f64 / num_hands as f64);
    println!();

    // Benchmark: find_all_melds (enumeration only)
    let start = Instant::now();
    let mut total_found = 0usize;
    for hand in &hands {
        let cs = card::CardSet::from_cards(hand);
        total_found += meld::find_all_melds(cs).len();
    }
    let find_elapsed = start.elapsed();
    println!("find_all_melds × {}:", num_hands);
    println!("  Total time:     {:.3}ms", find_elapsed.as_secs_f64() * 1000.0);
    println!("  Per hand:       {:.1}μs", find_elapsed.as_secs_f64() * 1_000_000.0 / num_hands as f64);
    println!("  Throughput:     {:.0} hands/sec", num_hands as f64 / find_elapsed.as_secs_f64());
    println!("  Avg melds found:{:.1}", total_found as f64 / num_hands as f64);
    println!();

    // Benchmark: batch edge cases — high-meld-density hands
    let mut hard_hands: Vec<Vec<u8>> = Vec::new();
    // Create hands with many overlapping meld possibilities
    for s in 0..4u8 {
        for start_r in 0..8u8 {
            let mut hand: Vec<u8> = Vec::new();
            for r in start_r..start_r.min(12).max(start_r) + 5 {
                if r < 13 {
                    hand.push(make_card(r, s));
                }
            }
            // Fill remaining with same-rank cards from other suits
            for r2 in 0..13u8 {
                if hand.len() >= 10 { break; }
                let c = make_card(r2, (s + 1) % 4);
                if !hand.contains(&c) {
                    hand.push(c);
                }
            }
            if hand.len() >= 10 {
                hard_hands.push(hand[..10].to_vec());
            }
        }
    }

    let num_hard = hard_hands.len();
    let reps = 1000;
    let start = Instant::now();
    for _ in 0..reps {
        for hand in &hard_hands {
            let _ = meld::best_meld_arrangement(hand);
        }
    }
    let hard_elapsed = start.elapsed();
    let total_hard = num_hard * reps;
    println!("High-density meld hands (hard cases) × {}:", total_hard);
    println!("  Total time:     {:.3}ms", hard_elapsed.as_secs_f64() * 1000.0);
    println!("  Per hand:       {:.1}μs", hard_elapsed.as_secs_f64() * 1_000_000.0 / total_hard as f64);
    println!("  Throughput:     {:.0} hands/sec", total_hard as f64 / hard_elapsed.as_secs_f64());
    println!();

    println!("=== Benchmark Complete ===");
}
