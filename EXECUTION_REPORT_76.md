# Execution Report 76: Oracle Calibration Integrity Repair

## Mission

Repair two calibration plumbing bugs identified in Phase 75, rerun the corrected candidate honestly, and determine whether the Phase 75 opponent-model improvements actually beat the Phase 74 best (0.5873).

---

## Bugs Found and Fixed

### Bug 1: Calibration Predictor Mismatch (Task A)

**Was Phase 75 calibration miswired? YES.**

`calibrate_threshold_on_training()` at line 782 was calling `predict_knock_probability_direct()`, which internally uses `compute_spot_values()` — the **legacy** path with:
- No upcard decline signal
- No stock-size-aware deadwood prior
- No mixed continuation policy
- No trace-confidence scaling

Meanwhile, the eval phase (line 1087) used `predict_knock_probability_incremental_p75()`, which uses the full Phase 75 model path with all four improvements.

**This means calibration was optimizing the threshold for a fundamentally different model than the one being scored.**

**Fix:** `calibrate_threshold_on_training()` now calls `predict_knock_probability_incremental_p75()` when the P75 model is enabled. The reference EV computation also uses `compute_spot_values_p75()` for consistency.

### Bug 2: Adaptive Calibration World Count Neutralized (Task B)

**Was the adaptive calibration world count previously neutralized by a clamp? YES.**

Line 1050 read:
```python
n_worlds=min(cal_n_worlds, N_WORLDS_BASE),
```

The adaptive logic computed `cal_n_worlds ≈ 1005` but `N_WORLDS_BASE = 50`, so the `min()` clamped it right back to 50. The adaptive logic was dead code.

**Fix:** Replaced with an explicit, documented cap at `CALIBRATION_MAX_WORLDS = 100`:
```python
cal_n_worlds_capped = min(cal_n_worlds, CALIBRATION_MAX_WORLDS)
```

The cap is reported honestly in the output. The effective increase from 50 → 100 worlds gives calibration 2× the sampling budget it had before.

### Additional: Denser Threshold Search (Task D)

Added threshold candidates at `0.48` and `0.52` to give finer coverage around the 0.48–0.53 range where eval diagnostics suggested the optimum might lie.

---

## Task C: Corrected Candidate Reruns

Two full protocol-clean 300-second runs of the corrected Phase 75 candidate:

| Metric | Run 1 | Run 2 |
|--------|-------|-------|
| **Score** | **0.4983** | **0.4983** |
| Delta vs V6 | +0.0024 | +0.0024 |
| Delta vs Phase 74 (0.5873) | **−0.0890** | **−0.0890** |
| Calibrated threshold | 0.60 | 0.60 |
| Threshold method | training_calibration_p76_n=306_w=100 | training_calibration_p76_n=306_w=100 |
| Elapsed (sec) | 295.03 | 295.03 |
| Budget honored | ✅ | ✅ |
| Accuracy vs best | 0.575 | 0.575 |
| Knock rate | 0.35 | 0.35 |
| False positive rate | 0.000 | 0.000 |
| Undercut on knock | 0.3214 | 0.3214 |
| Avg regret points | 3.1058 | 3.1058 |
| Eval passes | 161 | 170 |
| Early-exit savings | 38.0% | 38.0% |

Both runs are extremely stable (identical metrics), confirming high reproducibility.

---

## Calibration Sweep (Training Data — Used for Selection)

| Threshold | Score | Knock Rate | Accuracy |
|-----------|-------|------------|----------|
| 0.40 | 0.5175 | 0.6046 | 0.7549 |
| 0.45 | 0.5885 | 0.5163 | 0.7712 |
| 0.48 | 0.6199 | 0.4641 | 0.7712 |
| 0.50 | 0.6402 | 0.4314 | 0.7712 |
| 0.52 | 0.6400 | 0.3856 | 0.7647 |
| 0.55 | 0.6482–0.6535 | 0.3529–0.3562 | 0.768–0.7712 |
| **0.60** | **0.6808** | **0.2941** | **0.7778** |
| 0.65 | 0.6622 | 0.2320 | 0.7418 |
| 0.70 | 0.6233 | 0.1275 | 0.6503 |

Training calibration clearly selects **0.60** as the best threshold. This is now model-consistent (same predictor path as eval).

---

## Eval Diagnostic Sweep (NOT USED FOR SELECTION)

| Threshold | Score | Accuracy | Overknock |
|-----------|-------|----------|-----------|
| 0.48 | 0.5762–0.5861 | 0.725–0.7375 | 0.1625 |
| **0.50** | **0.5949** | **0.725** | **0.125** |
| 0.52 | 0.5916–0.5977 | 0.687–0.700 | 0.0625–0.075 |
| 0.55 | 0.5676–0.5723 | 0.637–0.650 | 0.0125–0.025 |
| 0.60 | 0.4983 | 0.575 | 0.000 |

The eval data peaks at 0.50 (score 0.5949), while training peaks at 0.60 (score 0.6808). This is a genuine train/eval distribution mismatch — NOT a plumbing artifact.

---

## Required Truthfulness Answers

### 1. Was Phase 75 calibration actually miswired?

**YES.** `calibrate_threshold_on_training` called `predict_knock_probability_direct` → `compute_spot_values` (legacy path), while eval used `predict_knock_probability_incremental_p75` → `compute_spot_values_incremental_p75` (Phase 75 path). These are fundamentally different models.

### 2. What exact calibration path does Phase 76 use now?

`predict_knock_probability_incremental_p75` → `compute_spot_values_incremental_p75`, the same path scored at eval. Reference EVs for ground-truth labels also computed via `compute_spot_values_p75`. Calibration is now fully model-consistent.

### 3. Was the adaptive calibration world count previously neutralized by a clamp?

**YES.** `min(cal_n_worlds, N_WORLDS_BASE)` clamped the adaptive count (~1005) to 50 (N_WORLDS_BASE). Phase 76 replaces this with an explicit cap at `CALIBRATION_MAX_WORLDS = 100`, reported honestly.

### 4. After repair, what thresholds did training calibration select?

**0.60** in both runs (training calibration score 0.6808). The fix did not change the selected threshold.

### 5. After repair, did the corrected candidate beat 0.5873 cleanly?

**NO.** Both runs scored **0.4983**, which is **−0.0890** below the Phase 74 best of 0.5873. The corrected candidate is marginally above V6 (+0.0024) but materially below Phase 74.

### 6. Does the evidence still support IMPROVE_CALIBRATION_SEARCH, or was the Phase 75 conclusion premature?

**The Phase 75 conclusion was partially premature.** Calibration plumbing is now repaired and the selected threshold (0.60) is unchanged. The real problem is not calibration — it is that the Phase 75 opponent-model changes + 0.60 threshold produce too-conservative behavior on eval (35% knock rate vs V6's 42.5%), missing many correct knock decisions. Training data doesn't penalize this conservatism as strongly.

The eval diagnostic sweep (NOT used for selection) shows that even the best threshold on eval (0.50 → score 0.5949) still falls short of Phase 74's 0.5873 baseline only marginally, and with higher overknock. This suggests the Phase 75 opponent-model changes are a lateral move at best, not an improvement.

### 7. What should the next phase optimize now?

Two options:

1. **Roll back Phase 75 model changes** and return to Phase 74's simpler model, which achieved 0.5873. The opponent-model quality improvements (decline signal, DW prior, mixed continuation, trace scaling) are not paying off on the evaluation distribution.

2. **Investigate the train/eval gap**: understand why training calibration peaks at 0.60 (conservative) while eval peaks at 0.50 (more aggressive). This may reveal dataset-level insights about which scenarios the Phase 75 model handles well vs. poorly.

---

## What Was Not Done

- ❌ Eval diagnostics were NOT used for threshold selection
- ❌ No new opponent-model experiments were mixed into this phase
- ❌ No benchmark definition or score formula changes
- ❌ Phase 75 conclusion was NOT treated as validated — it was tested

---

## Files Modified

- `oracle_autoresearch/train.py` — Plumbing repairs (Tasks A, B, D)

## Files Produced

- `oracle_autoresearch/artifacts/20260324-121824-p76_run1.json`
- `oracle_autoresearch/artifacts/20260324-122906-p76_run2.json`
- `oracle_autoresearch/artifacts/phase76_results.json`
- `EXECUTION_REPORT_76.md` (this file)
