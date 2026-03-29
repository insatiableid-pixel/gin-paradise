# Claude Directive 76: Oracle Calibration Integrity Repair

## Mission

Phase 75 is **not yet a clean basis for a calibration-search conclusion**.

The benchmark itself still appears honest, but the calibration plumbing is not aligned with the candidate being scored.

Two concrete issues must be repaired before we trust any claim that Phase 75 is "just a calibration problem":

1. `calibrate_threshold_on_training(...)` is still using the legacy predictor path (`predict_knock_probability_direct`) instead of the Phase 75 model path.
2. the adaptive calibration world-count logic is effectively disabled by clamping `cal_n_worlds` back down to `N_WORLDS_BASE`.

So Phase 76 is a **corrective integrity sprint**:

> make training calibration model-consistent, keep eval discipline intact, and rerun the candidate honestly.

---

## Why This Phase Exists

Phase 75 reported:

- training calibration chose `0.55` / `0.60`
- eval diagnostics showed `0.50` looked best
- recommendation: `IMPROVE_CALIBRATION_SEARCH`

But that conclusion is not reliable until calibration is actually driven by the same candidate path used at eval time.

Right now, we do **not** yet know whether:

- the true Phase 75 candidate really calibrates to `0.55-0.60`
- or the apparent mismatch was caused by miswired calibration code

That is the central question for Phase 76.

---

## Hard Constraints

1. **Do not touch the frozen eval set for selection.**
   Eval remains final scoring only.

2. **Do not widen scope into a new modeling phase yet.**
   This is primarily a calibration-integrity repair.

3. **Do not claim that Phase 75 was "just calibration-limited" unless corrected reruns support that.**

4. **Keep the 300-second budget honest.**

5. **Do not silently change the benchmark definition or score formula.**

6. **Do not discard the Phase 75 opponent-model improvements unless corrected evidence shows they are harmful.**

---

## Task A: Repair Calibration Plumbing

Make threshold calibration use the **same candidate probability path** as the scored run.

That means:

- if Phase 75 model is enabled, calibration probabilities must come from the Phase 75 model path
- if early-exit is part of the candidate, either:
  - use the same early-exit path in calibration, or
  - use a clearly documented calibration-only variant that preserves the same world model and probability mapping

The key requirement is simple:

> the thing being threshold-calibrated on training must be the same candidate family that is evaluated on the frozen benchmark

Be explicit in the report about exactly which function/path calibration now uses.

---

## Task B: Repair Adaptive Calibration Budgeting

Fix the calibration world-count logic so the reported adaptive count is the count actually used.

If you decide calibration should still be capped, that is allowed, but then:

- make the cap explicit
- report it honestly
- and do not pretend the adaptive count was used when it was not

---

## Task C: Re-run The Corrected Candidate

After the repair, run at least:

1. two full protocol-clean 300-second runs of the corrected Phase 75 candidate

You may also run a lightweight reproduction/baseline comparison if needed, but the main requirement is the corrected candidate rerun.

For each full run, report:

- score
- delta vs V6
- delta vs Phase 74 best (`0.5873`)
- calibrated threshold
- threshold-selection method
- elapsed seconds
- key quality metrics

Diagnostic eval sweeps are still allowed, but only if clearly marked:

> NOT USED FOR SELECTION

---

## Task D: Only Then Test Calibration Search

Once calibration plumbing is corrected, you may improve calibration search itself if needed.

Reasonable options:

- add threshold candidates around `0.48-0.53`
- increase calibration sample size
- use a more stable calibration split
- use simple cross-validation on training data

But do this **only after** the plumbing is corrected, and say clearly which part was:

- plumbing repair
- versus actual calibration-search improvement

Do not blur those together.

---

## Required Deliverables

Produce:

1. corrected Oracle autoresearch code
2. `phase76_results.json`
3. `EXECUTION_REPORT_76.md`

---

## Required Truthfulness

In `EXECUTION_REPORT_76.md`, answer these plainly:

1. Was Phase 75 calibration actually miswired?
2. What exact calibration path does Phase 76 use now?
3. Was the adaptive calibration world count previously neutralized by a clamp?
4. After repair, what thresholds did training calibration select?
5. After repair, did the corrected candidate beat `0.5873` cleanly?
6. Does the evidence still support `IMPROVE_CALIBRATION_SEARCH`, or was the Phase 75 conclusion premature?
7. What should the next phase optimize now?

---

## What Not To Do

Do **not**:

- use eval diagnostics to choose the final threshold
- treat the old Phase 75 conclusion as already validated
- mix new opponent-model experiments into this phase unless needed for the calibration repair
- hide whether the fix changed the selected threshold materially

---

## Success Condition

The strongest outcome for Phase 76 is:

> a protocol-clean rerun showing whether the Phase 75 opponent-model candidate still looks strong once calibration is actually wired to that candidate

If the corrected rerun beats `0.5873`, say so plainly.
If it does not, say that plainly too.
