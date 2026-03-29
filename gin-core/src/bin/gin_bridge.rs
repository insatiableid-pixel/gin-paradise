//! CLI tool for computing deadwood/melds via stdin/stdout JSON.
//! This serves as the subprocess bridge for Python integration.
//!
//! Protocol:
//!   Input (one JSON per line):
//!     {"cmd": "deadwood", "cards": [0, 4, 8, ...]}
//!     {"cmd": "best_meld", "cards": [0, 4, 8, ...]}
//!     {"cmd": "batch_deadwood", "hands": [[0,4,8,...], [1,5,9,...], ...]}
//!     {"cmd": "batch_best_meld", "hands": [[0,4,8,...], [1,5,9,...], ...]}
//!
//!   Output (one JSON per line):
//!     {"deadwood": 15}
//!     {"melds": [[0,4,8]], "deadwood_cards": [12,16], "deadwood_value": 20}
//!     {"results": [15, 20, 8, ...]}
//!     {"results": [{"melds":..., "deadwood_cards":..., "deadwood_value":...}, ...]}

use gin_core::card::CardSet;
use gin_core::meld;
use std::io::{self, BufRead, Write};

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        // Parse JSON manually with minimal dependencies
        // We use a simple approach: parse with serde-less JSON matching
        let response = process_command(&line);
        writeln!(out, "{}", response).ok();
        out.flush().ok();
    }
}

fn process_command(input: &str) -> String {
    // Very simple JSON parser for our protocol
    // Extract cmd field
    let cmd = extract_string_field(input, "cmd").unwrap_or_default();

    match cmd.as_str() {
        "deadwood" => {
            let cards = extract_array_field(input, "cards");
            let dw = meld::compute_deadwood(&cards);
            format!("{{\"deadwood\":{}}}", dw)
        }
        "best_meld" => {
            let cards = extract_array_field(input, "cards");
            let result = meld::best_meld_arrangement(&cards);
            let melds_json: Vec<String> = result.melds.iter()
                .map(|m| format!("[{}]", m.cards.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(",")))
                .collect();
            let dw_json: Vec<String> = result.deadwood_cards.iter().map(|c| c.to_string()).collect();
            format!("{{\"melds\":[{}],\"deadwood_cards\":[{}],\"deadwood_value\":{}}}",
                melds_json.join(","),
                dw_json.join(","),
                result.deadwood_value
            )
        }
        "batch_deadwood" => {
            let hands = extract_nested_array_field(input, "hands");
            let results: Vec<String> = hands.iter()
                .map(|h| meld::compute_deadwood(h).to_string())
                .collect();
            format!("{{\"results\":[{}]}}", results.join(","))
        }
        "batch_best_meld" => {
            let hands = extract_nested_array_field(input, "hands");
            let results: Vec<String> = hands.iter().map(|h| {
                let r = meld::best_meld_arrangement(h);
                let melds: Vec<String> = r.melds.iter()
                    .map(|m| format!("[{}]", m.cards.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(",")))
                    .collect();
                let dw: Vec<String> = r.deadwood_cards.iter().map(|c| c.to_string()).collect();
                format!("{{\"melds\":[{}],\"deadwood_cards\":[{}],\"deadwood_value\":{}}}",
                    melds.join(","), dw.join(","), r.deadwood_value)
            }).collect();
            format!("{{\"results\":[{}]}}", results.join(","))
        }
        _ => format!("{{\"error\":\"unknown command: {}\"}}", cmd)
    }
}

/// Extract a string field value from JSON-like input.
fn extract_string_field(json: &str, field: &str) -> Option<String> {
    let pattern = format!("\"{}\"", field);
    let pos = json.find(&pattern)?;
    let after = &json[pos + pattern.len()..];
    // Skip : and whitespace
    let after = after.trim_start();
    let after = after.strip_prefix(':')?;
    let after = after.trim_start();
    // Extract quoted string
    let after = after.strip_prefix('"')?;
    let end = after.find('"')?;
    Some(after[..end].to_string())
}

/// Extract an array of u8 from a JSON field.
fn extract_array_field(json: &str, field: &str) -> Vec<u8> {
    let pattern = format!("\"{}\"", field);
    if let Some(pos) = json.find(&pattern) {
        let after = &json[pos + pattern.len()..];
        if let Some(start) = after.find('[') {
            if let Some(end) = after[start..].find(']') {
                let arr_str = &after[start+1..start+end];
                return arr_str.split(',')
                    .filter_map(|s| s.trim().parse::<u8>().ok())
                    .collect();
            }
        }
    }
    vec![]
}

/// Extract a nested array (array of arrays of u8) from a JSON field.
fn extract_nested_array_field(json: &str, field: &str) -> Vec<Vec<u8>> {
    let pattern = format!("\"{}\"", field);
    let mut hands = Vec::new();
    if let Some(pos) = json.find(&pattern) {
        let after = &json[pos + pattern.len()..];
        // Find the outer [ ]
        if let Some(outer_start) = after.find('[') {
            let rest = &after[outer_start + 1..];
            // Find each inner [...] array
            let mut i = 0;
            let bytes = rest.as_bytes();
            while i < bytes.len() {
                if bytes[i] == b'[' {
                    if let Some(end) = rest[i..].find(']') {
                        let inner = &rest[i+1..i+end];
                        let hand: Vec<u8> = inner.split(',')
                            .filter_map(|s| s.trim().parse::<u8>().ok())
                            .collect();
                        if !hand.is_empty() {
                            hands.push(hand);
                        }
                        i += end + 1;
                    } else {
                        break;
                    }
                } else if bytes[i] == b']' {
                    break; // End of outer array
                } else {
                    i += 1;
                }
            }
        }
    }
    hands
}
