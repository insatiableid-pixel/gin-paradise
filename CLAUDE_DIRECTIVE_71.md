# Claude Directive 71: Rust Core Foundation Sprint

## Mission

Commit to the oracle architecture for real.

The project has now done enough Python-side de-risking:

- late-game belief modeling is credible
- bounded public-state CFR works
- Python is sufficient for pilots

But if the goal is the gin-rummy oracle, not just more careful pilot science, the bottleneck is no longer conceptual. It is now **architecture and speed**.

So Phase 71 should stop widening Python experiments and start building the **Rust core** that the oracle roadmap has been pointing toward:

- fast card-set operations
- fast meld / deadwood computation
- a clean Python↔Rust boundary
- the foundation for future CFR and endgame solving at real scale

This is the point where we stop circling the runway.

---

## Why This Is The Right Next Step

The strategic state is now:

- the heuristic path has hit diminishing returns
- the low-stock solver path has produced real insight
- the bounded CFR path proved that imperfect-information regret learning is viable
- the roadmap assessment argues that the true oracle stack is:
  - Rust core
  - CFR blueprint
  - endgame solving
  - Python as orchestration shell

If we continue doing only Python-side bounded studies, we risk learning more about local subgames without actually building the machine that can carry the full oracle program.

Phase 71 should therefore be the first **infrastructure-for-oracle** phase, not another evaluation microphase.

---

## Core Principle

Phase 71 is a **systems pivot** phase.

The goal is not to ship a stronger bot immediately.
The goal is to build the fast, correct substrate that future oracle work will sit on.

The rule is:

> preserve the Python research shell, but move the performance-critical game core into Rust.

---

## Hard Constraints

1. **Do not spend this phase on more heuristic bot tuning.**
2. **Do not spend this phase on widening CFR decision surfaces in Python.**
3. **Do not try to port the whole project.**
   Build the high-value hot core first.
4. **Do not sacrifice correctness for speed.**
   Exact parity with Python matters more than flashy throughput claims.
5. **Do not let FFI polish consume the whole phase.**
   If PyO3 becomes annoying, use the simplest working interop boundary that proves the architecture.

---

## Required Deliverables

Produce:

1. a working **Rust toolchain setup** in this repo
2. a new Rust core crate, recommended name: `gin-core`
3. fast Rust implementations of:
   - card representation / set operations
   - meld detection
   - deadwood computation
4. correctness parity tests against the existing Python engine
5. a usable Python integration path
6. benchmarks showing whether the core is fast enough to justify the pivot
7. `EXECUTION_REPORT_71.md`

---

## Task A: Install / Verify Rust Toolchain

The current environment did not have `cargo` available.

Phase 71 must begin by making Rust real in this workspace.

Required outputs:

- verify whether Rust is already available
- if not, install or otherwise provision a usable Rust toolchain
- confirm:
  - `rustc --version`
  - `cargo --version`

If toolchain setup becomes blocked, say exactly where and why.
But do not silently skip it.

---

## Task B: Create The Rust Core Crate

Create a new crate for the performance-critical engine core.

Recommended structure:

- `gin-core/`
  - `Cargo.toml`
  - `src/lib.rs`
  - modules for cards, melds, deadwood, and test helpers

This crate should be designed as the eventual home for:

- fast endgame solving primitives
- CFR traversal primitives
- compact state hashing / abstraction support

But in Phase 71, keep scope focused on the most important hot path:

- card sets
- meld search
- deadwood evaluation

---

## Task C: Implement Bitset / Bitboard Card Representation

Implement a Rust representation for card sets that is materially faster than Python lists/sets.

Preferred direction:

- 52-card bitmask inside `u64`

At minimum support:

- add/remove card
- membership check
- union / intersection / difference
- iteration over held cards
- conversion to/from Python integer-card lists

This representation should become the foundation for all later Rust-side game work.

---

## Task D: Port Meld Detection And Deadwood Computation

Port the exact meld / deadwood logic into Rust.

This is the most important concrete deliverable of the phase.

The Rust version must:

- match Python correctness exactly on representative test cases
- support best meld arrangement, not just greedy meld finding
- return deadwood in the same semantics as current Python code

Use the existing Python implementation as the reference truth, not as a vague guide.

### Required validation

Test parity on:

- hand-crafted edge cases
- randomly sampled hands
- hands with overlapping run/set choices
- gin / near-gin / high-deadwood junk hands

If there are mismatches, report them explicitly and fix them before claiming success.

---

## Task E: Build The Simplest Useful Python Integration

Expose the Rust core to Python.

Preferred path:

- PyO3 bindings

Acceptable fallback:

- a minimal CLI or subprocess bridge if that gets working faster this phase

The important thing is not elegance.
It is proving that Python-side research code can call the Rust core and get exact answers back.

At minimum, Python should be able to call:

- `best_meld_arrangement(...)`
- `compute_deadwood(...)`

using the Rust implementation.

---

## Task F: Benchmark Honestly

Benchmark Rust vs Python on the operations that actually matter for the oracle path.

At minimum measure:

- deadwood computation throughput
- best-meld search throughput
- batch evaluation over many random hands

Report:

- absolute timings
- speedup factor
- any setup / FFI overhead

The question is:

> does the Rust core already deliver enough speedup to justify making it the foundation for CFR and solver scaling?

Do not overstate performance if the gain is mostly eaten by interop overhead.

---

## Task G: Define The Next Boundary

At the end of the phase, state clearly what should move into Rust next.

Likely candidates:

- world generation
- continuation simulation
- endgame solve primitives
- CFR traversal / regret updates

But choose based on actual profiling and the new core structure, not just roadmap rhetoric.

---

## Required Truthfulness

In `EXECUTION_REPORT_71.md`, explicitly answer:

1. Did the Rust pivot actually become real in this repo?
2. Does the Rust meld/deadwood core match Python exactly?
3. What speedup did we get, honestly?
4. Is the Python↔Rust boundary workable?
5. What should be moved into Rust next?
6. Did this phase materially accelerate the oracle roadmap, or only set up infrastructure?

---

## What Not To Do

Do **not**:

- broaden the scope into a full engine rewrite
- mix this with another CFR training campaign
- claim “Rust solved it” if the only result is a crate skeleton
- compromise correctness to chase large benchmark numbers

---

## Preferred Report Structure

Write `EXECUTION_REPORT_71.md` with:

1. **Rust toolchain status**
2. **Crate architecture**
3. **Bitset card representation**
4. **Meld/deadwood parity results**
5. **Python integration path**
6. **Benchmarks and honest speedup**
7. **Best next oracle-roadmap step**

---

## Success Criteria

Phase 71 is successful if, by the end, we have:

- a working Rust toolchain in the repo
- a real `gin-core` crate
- exact Rust parity for meld/deadwood computation
- callable Python integration
- benchmark evidence that the pivot is justified

That is the first true full-throttle step toward the gin-rummy oracle architecture.

---

## Summary

Enough Python-only proving has been done.

Phase 71 should now build the Rust foundation that the oracle program actually needs:

- fast card representation
- fast exact meld/deadwood computation
- Python↔Rust integration
- and benchmarked proof that the architecture shift is real

That is the correct full-throttle move.
