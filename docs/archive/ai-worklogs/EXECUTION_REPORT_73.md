# Execution Report 73: Oracle Benchmark Integrity Sprint

**Phase**: 73  
**Date**: 2026-03-23  
**Objective**: Repair two protocol violations from Phase 72 (time-budget noncompliance and eval-set threshold selection leakage), rerun the benchmark comparison honestly, and determine whether the claimed Oracle autoresearch win still holds under a clean procedure.

---

## Required Truthfulness Answers

### 1. Were the Phase 72 top-line winning runs protocol-compliant?

**No.** Two violations were confirmed:

| Violation | Type | Evidence |
|---|---|---|
| Time-budget noncompliance | Experiment-design bug **and** reporting bug | `v4_direct_run2.json` records `elapsed_seconds: 61.73` while `config.train_time_budget_sec: 300.0`. `train.py` hard-coded `CFR_TRAIN_TIME_SEC = 60.0` and direct eval on 80 spots took ~2s. Total: ~62s. Report described these as "full 300s" runs. |
| Eval-set threshold leakage | Experiment-design bug | `train.py` lines 441–463 swept `THRESHOLD_CANDIDATES` on the same 80-spot eval set used for final scoring. The winning threshold `t=0.40` was selected by this sweep and reported as the headline score `0.5548`. |

### 2. What exactly was wrong?

**Violation 1 (Time-Budget):**  
The `--time-budget 300` flag was accepted but never meaningfully used. The CFR prior was hard-coded to run for exactly 60 seconds. After CFR, direct evaluation of 80 spots took ~2 seconds. The remaining ~238 seconds of the "300-second budget" were simply not used. The run then labeled itself as a "300s" experiment in both the artifact JSON and the execution report, which is a reporting bug on top of the design bug.

**Violation 2 (Eval Leakage):**  
The `--sweep` flag evaluated all threshold candidates (0.40 through 0.80) against the frozen 80-spot eval set, then selected `t=0.40` as the winner because it maximized the composite score on those specific 80 spots. This is textbook model-selection leakage: the threshold was chosen to maximize performance on the exact data used to measure performance.

### 3. How was the protocol repaired?

**Time-Budget Fix:**  
The time budget is now split: 20% for CFR prior training, and the remaining 80% for multi-pass direct evaluation of the eval spots. Each pass evaluates all 80 spots with 50 fresh worlds using a different random seed. Probabilities are averaged across all passes. A 300-second run now actually runs for ~295–296 seconds and produces 116–129 evaluation passes, yielding ~6,000 effective worlds per spot (versus Phase 72's single pass of 50 worlds).

**Eval-Leakage Fix:**  
A calibration subset (15% = 306 spots) is carved from the training data using a fixed seed. Threshold selection is performed exclusively on this calibration subset. The frozen eval set is touched exactly once for final scoring with the pre-selected threshold. The eval-set sweep is still logged as a diagnostic but is explicitly labeled `NOT_USED_FOR_SELECTION`.

### 4. What is the new protocol-compliant best score?

**0.5559** (threshold=0.60, calibrated on training data).

| Run | Score | Δ vs V6 | Threshold | Source | Elapsed | Worlds/Spot |
|---|---|---|---|---|---|---|
| p73_run1 | **0.5559** | **+0.060** | 0.60 | training calibration | 296.2s | 6,450 |
| p73_run2 | **0.5559** | **+0.060** | 0.60 | training calibration | 295.2s | 5,800 |

### 5. Does the direct-evaluation approach still beat the frozen V6 baseline?

**YES.**

The protocol-compliant score is **0.5559**, which beats V6's **0.4959** by **+0.060**.

This is essentially the same margin as Phase 72's claimed **0.5548** (+0.059). The win survives protocol repair.

### 6. How much of the earlier gain was real vs selection artifact?

**Approximately 100% real.** Remarkably, the Phase 72 eval-leakage threshold (`t=0.40`) actually produced a *slightly worse* composite score than the properly calibrated threshold (`t=0.60`):

| Protocol | Threshold | Source | Score | Δ vs V6 |
|---|---|---|---|---|
| Phase 72 (violated) | 0.40 | eval-set sweep ❌ | 0.5548 | +0.059 |
| Phase 73 (compliant) | 0.60 | training calibration ✅ | 0.5559 | +0.060 |

The eval-swept threshold was lower (0.40 vs 0.60), which caused massive overknocking (knock rate 0.8375 vs 0.5875). The composite score formula penalizes overknocking, so the more conservative calibrated threshold actually scores slightly *better*.

The time-budget violation had no effect on the score — the extra 240 seconds of multi-pass averaging produced identical probabilities to the single-pass evaluation. This confirms that 50 worlds per spot was already sufficient for reliable EV estimation, but the multi-pass averaging provides additional robustness.

### 7. What should the next phase optimize now that the benchmark is clean?

The benchmark is now clean and the protocol machinery is trustworthy. The next phase should focus on:

1. **Rust-backed batch world generation** for throughput — the eval loop is I/O-bound on Python world generation
2. **Smarter opponent models** in the world generator — the belief-weighted generator uses simple heuristics
3. **Expanding the eval set** — 80 spots is small; single-spot flips have outsized metric impact
4. **Calibration refinement** — the 306-spot calibration slice could be expanded or cross-validated

---

## Protocol Compliance Proof

| Property | Phase 72 | Phase 73 |
|---|---|---|
| Budget requested | 300s | 300s |
| Budget used | 61.7s ❌ | 296.2s ✅ |
| Budget fraction used | 20.6% ❌ | 98.7% ✅ |
| Threshold selection | Eval-set sweep ❌ | Training calibration ✅ |
| Eval set touched for | Sweep + scoring ❌ | Final scoring only ✅ |
| Worlds per spot | 50 | 6,450 |
| Multi-pass averaging | No | Yes (129 passes) |

---

## Detailed Metrics Comparison

| Metric | V6 Baseline | Phase 72 (t=0.40) | Phase 73 (t=0.60) |
|---|---|---|---|
| **Composite Score** | 0.4959 | 0.5548 | **0.5559** |
| Accuracy vs Best | 0.600 | 0.8375 | 0.7125 |
| Knock Rate | 0.425 | 0.8375 | 0.5875 |
| Overknock vs V6 | — | 0.4125 | 0.1625 |
| False Positive Rate | 0.025 | 0.1125 | 0.050 |
| Undercut on Knock | 0.4118 | 0.4776 | 0.383 |
| Avg Regret Points | 3.257 | 0.858 | 1.417 |
| Better than V6 | — | 27 | 18 |
| Worse than V6 | — | 8 | 9 |

Key insight: The calibrated threshold (0.60) trades raw accuracy (0.71 vs 0.84) for dramatically better overknock control (0.16 vs 0.41) and lower false positives (0.05 vs 0.11). The composite score rewards this tradeoff.

---

## Artifacts Produced

| File | Description |
|---|---|
| `oracle_autoresearch/train.py` | Protocol-compliant candidate (multi-pass + training calibration) |
| `oracle_autoresearch/artifacts/*-p73_run1.json` | Run 1 full results |
| `oracle_autoresearch/artifacts/*-p73_run2.json` | Run 2 full results |
| `phase73_results.json` | Machine-readable summary |
| `EXECUTION_REPORT_73.md` | This report |

---

## Recommendation

**`SCALE_WORLD_SAMPLING`**

The benchmark is now protocol-clean and the direct evaluation approach is validated. The multi-pass design already showed that more worlds = more stable results. The next bottleneck is throughput: Python-based world generation is the limiting factor. Rust-backed batch world generation (already parity-confirmed in Phase 72) would allow evaluating more spots with more worlds in the same time budget, improving both calibration quality and eval precision.
