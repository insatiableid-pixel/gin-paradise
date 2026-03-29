# Claude Directive 74: Oracle World-Sampling Scaling Sprint

## Mission

Phase 73 established a protocol-clean result:

- the benchmark is honest
- the direct-evaluation candidate beats the frozen V6 baseline
- the next bottleneck is throughput, not benchmark validity

Phase 74 should therefore focus on the next obvious question:

> can we use the Rust substrate and/or better batching to buy materially more world-sampling power inside the same fixed 300-second Oracle benchmark budget?

This is now a **scaling phase**, not a validity phase.

---

## Why This Is The Right Next Step

The current Oracle candidate is already good enough to beat V6, but it spends nearly all of its budget doing Python-side repeated world generation and evaluation.

Phase 73's own conclusion was `SCALE_WORLD_SAMPLING`.

That means Phase 74 should try to improve one or both of:

1. **worlds per spot**
2. **effective benchmark precision**

without sacrificing the protocol cleanliness established in Phase 73.

The Phase 71 Rust work exists precisely to make this next step possible.

---

## Core Principle

Phase 74 is a **throughput-for-quality** phase.

The rule is:

> use the same clean benchmark, but spend the budget more effectively.

Do not change the benchmark to make the score easier.
Improve the candidate's sampling power or sampling quality under the existing benchmark.

---

## Hard Constraints

1. **Do not break the benchmark integrity restored in Phase 73.**
   The eval set remains frozen.

2. **Do not reintroduce eval-set selection leakage.**
   Thresholds and related knobs must still be chosen via training/calibration only.

3. **Do not fake budget usage.**
   A 300-second run must still use the budget honestly.

4. **Do not widen scope into unrelated bot or product work.**

5. **Only move performance-critical pieces into Rust or batching if they materially improve sampling throughput.**
   Avoid cosmetic cross-language churn.

6. **Any Rust integration must preserve correctness and be benchmarked honestly.**

---

## Required Deliverables

Produce:

1. an improved protocol-clean Oracle candidate
2. any minimal Rust / bridge / batching changes needed to support it
3. `phase74_results.json`
4. `EXECUTION_REPORT_74.md`

---

## Task A: Profile The Current Phase 73 Candidate

Start by measuring where the current 300-second budget goes.

At minimum, break down:

- CFR prior time
- world generation time
- continuation simulation time
- calibration time
- final eval time

The goal is to identify the actual hot path, not the presumed one.

---

## Task B: Improve Sampling Throughput

Use the profiling result to implement the most leverageful improvement.

Promising directions include:

- Rust-backed batch deadwood / meld use inside world generation
- batching repeated spot evaluations
- caching or reusing legal-card structures
- reducing Python overhead in repeated per-world loops
- improving multi-pass scheduling so the full budget buys more informative samples

It is acceptable if the main improvement is a batching design rather than a full Rust port, as long as it clearly improves throughput.

---

## Task C: Keep Calibration Honest

Any new knobs introduced in Phase 74 must still be selected on training/calibration data only.

This includes:

- thresholds
- blend ratios
- risk penalties
- world-count schedules

If you tune them, do it without touching the eval set for selection.

---

## Task D: Re-run The Benchmark Cleanly

Run at least:

1. one protocol-clean baseline reproduction of the current Phase 73 candidate
2. two protocol-clean runs of the improved candidate

Report:

- score
- delta vs V6
- elapsed time
- worlds per spot
- passes per run
- calibration threshold source

If score improves only because worlds per spot rises, say so.
If throughput rises but score does not, say that too.

---

## Task E: Decide Whether Scaling Helped

At the end of the phase, answer this plainly:

> did the throughput improvement produce a better protocol-clean Oracle score than Phase 73's `0.5559`?

Possible outcomes:

- **YES, better score**
- **NO, same score but better precision / throughput**
- **NO, no meaningful gain**

All three are useful if reported honestly.

---

## Task F: Recommend The Next Boundary

Choose one primary recommendation:

- `KEEP_SCALING_WITH_RUST`
- `EXPAND_EVAL_SET`
- `IMPROVE_OPPONENT_MODEL`
- `AUTOMATE_CALIBRATION_SEARCH`

Pick only one.

---

## Required Truthfulness

In `EXECUTION_REPORT_74.md`, explicitly answer:

1. Where was the real hot path in the Phase 73 candidate?
2. What exact throughput change was made?
3. Did worlds per spot or passes per run increase materially?
4. Did the benchmark score beat `0.5559`?
5. If not, did the change still improve precision or stability?
6. Is Rust now paying rent on the Oracle path, or not yet?
7. What should the next phase optimize?

---

## What Not To Do

Do **not**:

- touch the eval set for selection
- quietly alter the benchmark definition
- claim throughput wins without measurements
- claim quality wins without protocol-clean reruns
- move large chunks to Rust without evidence they matter

---

## Success Condition

The strongest outcome for Phase 74 is:

> a protocol-clean Oracle candidate that uses the same 300-second budget more effectively and beats the current clean score of `0.5559`.

But a clear finding that throughput improved while score stayed flat is still valuable, because it tells us whether the next bottleneck is sampling power or model quality.
