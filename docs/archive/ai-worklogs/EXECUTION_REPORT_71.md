# Execution Report 71: Rust Core Foundation Sprint

## Status: SUCCESS

Phase 71 delivered all required deliverables: a working Rust toolchain, a real `gin-core` crate with bitset card representation and exact meld/deadwood computation, a usable Python integration path, and honest benchmarks.

---

## 1. Rust Toolchain Status

| Component | Version |
|-----------|---------|
| `rustc` | 1.94.0 (4a4ef493e 2026-03-02) |
| `cargo` | 1.94.0 (85eff7c80 2026-01-15) |
| Target | `x86_64-pc-windows-gnu` |
| Linker | MinGW-w64 via MSYS2 |

Installed via `winget install Rustlang.Rustup` + MSYS2 for the GNU toolchain (no MSVC Build Tools were present on the machine). The GNU target was configured as default.

---

## 2. Crate Architecture

```
gin-core/
├── Cargo.toml          # PyO3 optional feature, release LTO
├── src/
│   ├── lib.rs          # Module root, optional PyO3 entry
│   ├── card.rs         # CardSet u64 bitset + card utilities
│   ├── meld.rs         # Meld detection + optimal arrangement
│   ├── python.rs       # PyO3 bindings (feature-gated)
│   └── bin/
│       ├── benchmark.rs    # Rust-native throughput benchmark
│       └── gin_bridge.rs   # Subprocess JSON bridge for Python
└── tests/
    └── parity.rs       # 1000-hand random + edge case tests
```

**Design decisions:**
- PyO3 is an **optional feature** (`[features] python = ["pyo3"]`), so the core compiles and tests without needing Python dev headers. This was necessary because the MSVC linker was unavailable.
- The crate is structured for future extension: `card.rs` provides the foundational `CardSet` type, `meld.rs` provides the hot-path engine, and the `bin/` directory provides both benchmarking and Python integration entry points.
- `crate-type = ["rlib"]` by default; flips to `["cdylib", "rlib"]` when the `python` feature is enabled.

---

## 3. Bitset Card Representation

The `CardSet` type stores a 52-card set in a `u64` bitmask (bit `i` set ↔ card `i` present).

**Supported operations:**
- `from_cards(&[u8])` — construct from card indices
- `contains(card)` — O(1) membership check
- `add(card)` / `remove(card)` — O(1) mutation
- `union` / `intersection` / `difference` — single bitwise op
- `intersects(other)` — fast overlap check (used in backtracking)
- `len()` — `popcnt` instruction
- `iter()` — trailing-zeros iteration
- `to_vec()` — convert back to sorted card list

**Card encoding matches Python exactly:** `rank = card / 4`, `suit = card % 4`, `make_card(r, s) = r * 4 + s`. Deadwood values use a compile-time lookup table (`const DEADWOOD_TABLE: [u8; 52]`).

---

## 4. Meld/Deadwood Parity Results

### Methodology

Tested Rust vs Python `best_meld_arrangement` on:
- 6 hand-crafted edge cases (gin, junk, overlapping meld choice, four-of-a-kind, near-gin, long run)
- 5,000 randomly generated 10-card hands
- 1,000 random hands in Rust-internal parity tests (invariant checks)

### Results

| Metric | Value |
|--------|-------|
| Total hands tested | 5,006 |
| Mismatches | **0** |
| Parity rate | **100.0%** |

The Rust engine produces **identical deadwood values** to the Python engine on every tested hand. The backtracking algorithm in `meld.rs` is a direct port of the Python `best_meld_arrangement` logic, using the same bitmask-accelerated search over non-overlapping melds.

### Rust-internal invariant tests (1,000 random hands)

For every hand, the Rust test suite verifies:
1. Deadwood accounting: `deadwood_value == total_hand_dw - sum(meld_saved)`
2. No overlapping melds: no card appears in two melds
3. All cards accounted for: `meld_cards ∪ deadwood_cards == hand`
4. All melds valid: each meld is a valid set or run

---

## 5. Python Integration Path

### Implemented: Subprocess JSON Bridge

The integration uses a persistent subprocess (`gin_bridge.exe`) communicating via line-delimited JSON on stdin/stdout.

**Protocol:**
```
→ {"cmd": "deadwood", "cards": [0, 4, 8, ...]}
← {"deadwood": 15}

→ {"cmd": "best_meld", "cards": [0, 4, 8, ...]}
← {"melds": [[0,4,8]], "deadwood_cards": [12,16], "deadwood_value": 20}

→ {"cmd": "batch_deadwood", "hands": [[...], [...], ...]}
← {"results": [15, 20, 8, ...]}
```

**Python wrapper:** `gin_rummy/rust_bridge.py` provides a `RustBridge` class with drop-in replacements:
- `bridge.compute_deadwood(cards) → int`
- `bridge.best_meld_arrangement(cards) → (melds, dw_cards, dw_val)`
- `bridge.batch_compute_deadwood(hands) → [int, ...]`

### PyO3 Status

PyO3 bindings are written and feature-gated. Building with `--features python` requires either MSVC Build Tools or a properly configured GNU+Python dev environment. The bindings are ready but were not activated this phase because the MSVC linker was unavailable. **The subprocess bridge is the working integration path.**

---

## 6. Benchmarks and Honest Speedup

### Pure Rust Performance (no IPC overhead)

| Operation | Hands | Total Time | Per Hand | Throughput |
|-----------|-------|------------|----------|------------|
| `compute_deadwood` | 100,000 | 240ms | 2.4μs | 416K/sec |
| `best_meld_arrangement` | 100,000 | 227ms | 2.3μs | 440K/sec |
| `find_all_melds` | 100,000 | 183ms | 1.8μs | 546K/sec |
| Hard-density melds | 32,000 | 199ms | 6.2μs | 161K/sec |

### Python vs Rust-via-Bridge (10,000 hands)

| Mode | Python | Rust | Speedup |
|------|--------|------|---------|
| `compute_deadwood` (single calls) | 108ms | 224ms | **0.5x** (IPC overhead dominates) |
| `compute_deadwood` (batch 1000) | 108ms | 19ms | **5.6x** |
| `best_meld_arrangement` (single) | 104ms | 231ms | **0.4x** (IPC overhead) |

### Honest Assessment

**The Rust core is ~4-5x faster than Python** when measured pure (no IPC). In batch mode through the subprocess bridge, the effective speedup is **5.6x**.

**Single-call overhead is real.** Each individual subprocess JSON round-trip adds ~20μs of serialization + pipe I/O, which dominates the ~2μs Rust computation time. This means:

- **For world generation / CFR traversal (batch workloads):** Rust delivers a clear win. Batching 1,000 hands in a single call amortizes IPC to negligible cost.
- **For individual hand evaluation in the Python research shell:** The subprocess bridge is slower than native Python unless batched.
- **With PyO3 (future):** IPC overhead disappears entirely. Expected speedup: ~5x consistently.

### Does the speedup justify the pivot?

**Yes, but the justification is architectural, not just throughput.**

The current Python meld/deadwood engine runs at ~90K hands/sec. For the oracle roadmap:
- CFR blueprint computation requires millions of state evaluations → 440K/sec in Rust vs 90K/sec in Python is a meaningful (5x) improvement
- Endgame solving requires exhaustive enumeration → Rust's bitwise operations are fundamentally more efficient
- The real multiplier comes when *compact state hashing, game tree traversal, and regret updates* all live in Rust, eliminating Python overhead entirely

---

## 7. Best Next Oracle-Roadmap Step

Based on profiling and the architecture established this phase:

### Recommended next moves (in priority order):

1. **Install MSVC Build Tools** (or configure cross-compilation) to enable PyO3 native bindings. This eliminates the subprocess IPC overhead entirely and makes the Rust engine a true drop-in for all Python-side code.

2. **Port world generation to Rust.** The `belief_world_generator.py` samples opponent hands and evaluates deadwood for each — this is a perfect batch workload. Moving it to Rust could 5-10x the solver's world-evaluation throughput.

3. **Port continuation simulation.** The `solver_v6` runs forward simulations from each world; the inner loop is game-play with meld/deadwood evaluation. This is the next natural hot path after world generation.

4. **CFR traversal in Rust.** Once the game mechanics are in Rust, the `cfr_public_state.py` MCCFR engine can move its inner loop to Rust while keeping the Python orchestration shell.

### What to defer:
- Full engine rewrite (keep Python for research orchestration)
- Endgame solving (needs CFR foundation first)

---

## Required Truthfulness Answers

### 1. Did the Rust pivot actually become real in this repo?
**Yes.** There is a working Rust toolchain, a real `gin-core` crate with 4 source modules, and it compiles, tests, and runs. The crate contains production-quality card set operations, meld detection, and deadwood computation.

### 2. Does the Rust meld/deadwood core match Python exactly?
**Yes, 100% parity.** Zero mismatches across 5,006 tested hands (6 edge cases + 5,000 random).

### 3. What speedup did we get, honestly?
**~5x in pure Rust** (440K hands/sec vs 90K hands/sec in Python). Through the subprocess bridge: **5.6x in batch mode**, slower for single calls due to IPC overhead.

### 4. Is the Python↔Rust boundary workable?
**Yes, via the subprocess bridge.** It works today for batch workloads. PyO3 bindings are written but need MSVC Build Tools to activate — that's a solvable environment issue, not an architecture problem.

### 5. What should be moved into Rust next?
World generation and continuation simulation, then CFR traversal. See Section 7 above.

### 6. Did this phase materially accelerate the oracle roadmap, or only set up infrastructure?
**Mostly infrastructure, but real infrastructure.** The crate is not just a skeleton — it has a working engine with proven correctness parity and measurable speedup. The oracle roadmap now has a concrete Rust substrate to build on, which is what Phase 71 was designed to deliver.

---

## Deliverables Checklist

| Deliverable | Status |
|-------------|--------|
| Rust toolchain in repo | ✅ rustc 1.94.0 + cargo 1.94.0 |
| `gin-core` crate | ✅ 4 source modules, compiles in release |
| Bitset card representation | ✅ `CardSet(u64)` with full ops |
| Meld detection (Rust) | ✅ sets, runs, all sub-runs |
| Deadwood computation (Rust) | ✅ optimal arrangement via backtracking |
| Correctness parity tests | ✅ 100% parity on 5,006 hands |
| Python integration | ✅ subprocess bridge + PyO3 (gated) |
| Benchmarks | ✅ ~5x pure Rust speedup |
| This report | ✅ |
