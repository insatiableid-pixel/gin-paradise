# Claude Directive 73: Oracle Benchmark Integrity Sprint

## Mission

Phase 72 found a promising direct-evaluation approach, but the benchmark claim is not yet protocol-clean.

Two issues must be treated as real:

1. the reported "full 300-second" winning runs were not actually 300-second runs
2. the winning threshold was chosen by sweeping on the eval set itself

Phase 73 must therefore be a **benchmark integrity and revalidation phase**.

The goal is simple:

> repair the protocol violations, rerun the comparison honestly, and determine whether the claimed Oracle autoresearch win still holds under a clean procedure.

---

## Why This Phase Is Necessary

The Phase 72 artifact and code show a mismatch:

- `EXECUTION_REPORT_72.md` describes Variant 4 as a "full 300s" winner
- but `oracle_autoresearch/artifacts/...v4_direct_run2.json` records `elapsed_seconds: 61.73`
- and `oracle_autoresearch/train.py` hard-codes a `60` second CFR prior plus direct eval, rather than actually using the provided `--time-budget`

There is also eval leakage:

- the threshold sweep is performed on the same frozen eval set used for final scoring
- then the best threshold from that sweep is reported as the headline benchmark result

This does not invalidate the idea.
It does invalidate treating the Phase 72 top-line number as protocol-settled.

---

## Core Principle

Phase 73 is a **truth-maintenance** phase.

The rule is:

> no benchmark win counts unless the runtime protocol is honored and model-selection leakage is removed.

This phase is not about flashy new ideas.
It is about turning a promising result into a trustworthy result.

---

## Hard Constraints

1. **Do not paper over the Phase 72 issues.**
   Acknowledge them explicitly in the report.

2. **Do not claim Phase 72's `0.5548` as the validated benchmark champion unless it survives protocol repair.**

3. **Do not choose thresholds or blend settings on the frozen eval set.**
   Hyperparameter selection must come from training or calibration data only.

4. **Honor the configured experiment budget honestly.**
   If the run is labeled `300s`, it should actually use that budget in a meaningful way.

5. **Keep the eval benchmark frozen.**
   Do not regenerate or replace the 80 eval spots.

6. **Only make the minimum sandbox changes necessary to restore integrity.**
   This phase may edit `oracle_autoresearch/train.py`, and may edit `oracle_autoresearch/prepare.py` only if a minimal harness change is genuinely necessary.

7. **Do not widen scope into general bot work or broader Oracle architecture.**

---

## Required Deliverables

Produce:

1. a protocol-compliant `oracle_autoresearch/train.py`
2. any minimal harness fix needed for clean calibration separation
3. `phase73_results.json`
4. `EXECUTION_REPORT_73.md`

---

## Task A: Audit And State The Violations Explicitly

Start by confirming, with evidence, the two Phase 72 protocol problems:

1. time-budget noncompliance
2. threshold selection on the eval set

State clearly whether each one is:

- a reporting bug
- an experiment-design bug
- or both

Do not proceed as if they are trivial.

---

## Task B: Make Runtime Budget Honest

Fix the experiment loop so that the configured runtime budget is used meaningfully.

Acceptable approaches include:

- using the full budget for CFR prior plus direct evaluation
- using remaining time to increase world counts adaptively
- using a time-budgeted refinement loop over training/calibration spots

What is not acceptable:

- accepting a `300s` flag while finishing in ~60s and still calling it a full run

The exact use of the remaining budget is up to you, but it must be principled and documented.

---

## Task C: Remove Eval-Set Selection Leakage

The frozen eval set must remain evaluation-only.

Thresholds, blend ratios, and similar knobs must be chosen using one of:

- a calibration slice carved from the training set
- cross-validation on the training set
- a precommitted threshold with no eval tuning

If a calibration subset is introduced, describe exactly how it is formed and keep it fixed for reproducibility.

The final reported benchmark score must come from a threshold that was **not selected on the eval set**.

---

## Task D: Rerun The Comparison Honestly

After repairing the protocol:

1. rerun the original baseline candidate
2. rerun the direct-evaluation candidate
3. compare against frozen V6 baseline

Required:

- at least 2 protocol-compliant runs for the best candidate
- explicit reporting of runtime, threshold-selection method, and final score

If the score varies materially between reruns, report the variance honestly.

---

## Task E: Decide The Real Outcome

At the end of the phase, answer this question plainly:

> after fixing the protocol, does the direct-evaluation candidate still beat the frozen V6 baseline of `0.4959`?

Possible outcomes:

- **YES, still beats baseline**
- **NO, win disappears under clean protocol**
- **MAYBE, effect exists but is unstable**

Do not blur these together.

---

## Task F: Recommend The Next Move

Choose one primary recommendation:

- `KEEP_AUTORESEARCHING`
- `SCALE_WORLD_SAMPLING`
- `IMPROVE_CALIBRATION`
- `RETHINK_SCORE_OR_HARNESS`

Pick only one, based on the repaired evidence.

---

## Required Truthfulness

In `EXECUTION_REPORT_73.md`, explicitly answer:

1. Were the Phase 72 top-line winning runs protocol-compliant?
2. What exactly was wrong?
3. How was the protocol repaired?
4. What is the new protocol-compliant best score?
5. Does the direct-evaluation approach still beat the frozen V6 baseline?
6. How much of the earlier gain was real vs selection artifact?
7. What should the next phase optimize now that the benchmark is clean?

---

## What Not To Do

Do **not**:

- treat the Phase 72 number as settled without revalidation
- keep using eval-set sweeps for threshold choice
- quietly rename a 60-second run as a 300-second run
- regenerate the eval set
- expand scope into unrelated Oracle work

---

## Success Condition

The best outcome for Phase 73 is:

> a protocol-clean benchmark result showing whether the direct-evaluation candidate truly beats V6.

If the answer is negative, that is still a successful Phase 73 if it is honest and well-explained.
