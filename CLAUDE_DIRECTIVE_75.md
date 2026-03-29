# Claude Directive 75: Oracle Opponent-Model Quality Sprint

## Mission

Phase 74 improved the protocol-clean Oracle score from `0.5559` to `0.5873` by spending the same 300-second budget more effectively.

That was a successful scaling phase.

The next question is now:

> can we improve the quality of each sampled world, rather than merely the quantity of sampled worlds?

Phase 75 should therefore focus on **opponent-model quality** inside the Oracle direct-evaluation loop.

---

## Why This Is The Right Next Step

Phase 74 established three things:

1. the benchmark is clean
2. more effective use of the budget helps
3. the next bottleneck is no longer raw throughput alone

The report's own recommendation was `IMPROVE_OPPONENT_MODEL`.

That means the highest-leverage next move is to improve:

- how hidden worlds are generated
- how belief weights are assigned
- and/or how continuation is modeled inside those worlds

without breaking the protocol discipline established in Phases 73-74.

---

## Core Principle

Phase 75 is a **better-worlds, not just more-worlds** phase.

The rule is:

> keep the benchmark clean, keep the budget fixed, and improve the informational quality of the sampled worlds.

Do not change the eval standard to make success easier.
Improve the model of the hidden state and the continuation environment.

---

## Hard Constraints

1. **Do not break the benchmark integrity restored in Phase 73.**
   The eval set stays frozen.

2. **Do not reintroduce eval-set hyperparameter selection.**
   Thresholds and other knobs must still be selected via training/calibration only.

3. **Do not fake the 300-second budget.**
   Keep protocol compliance intact.

4. **Do not default back to more Rust work unless the evidence demands it.**
   Phase 74 showed Rust is not the active bottleneck right now.

5. **Do not widen scope into unrelated engine or product work.**

6. **Keep the successful Phase 74 optimizations unless there is clear evidence they hurt quality.**

---

## Required Deliverables

Produce:

1. an improved protocol-clean Oracle candidate
2. any minimal world-generation / opponent-model code changes needed to support it
3. `phase75_results.json`
4. `EXECUTION_REPORT_75.md`

---

## Task A: Audit The Current Opponent-Model Path

Start by tracing exactly how the current candidate forms its hidden-world beliefs.

At minimum, inspect and summarize:

- card-level weighting in the belief world generator
- how pickups / discards / declines shape weights
- how continuation policy is chosen once a world is sampled
- what assumptions are fixed vs learned vs heuristic

The goal is to identify where the current model is most likely losing quality on borderline knock/continue spots.

---

## Task B: Improve World Quality

Make a targeted quality improvement to the hidden-world modeling.

Promising directions include:

- stronger weighting from public trace events
- adaptive weighting based on deadwood-sensitive signals
- multiple continuation-policy hypotheses instead of one fixed opponent policy
- more intelligent sampling around borderline spots
- better use of score state / stock size when constructing worlds

Avoid adding complexity that does not clearly change the information content of the sampled worlds.

---

## Task C: Keep Calibration Honest

Any new knobs introduced in Phase 75 must still be selected on training/calibration data only.

This includes:

- belief-weight parameters
- opponent-policy mixtures
- sampling schedules
- risk penalties
- thresholds

Do not tune them on the frozen eval set.

---

## Task D: Re-run The Benchmark Cleanly

Run at least:

1. one protocol-clean reproduction of the Phase 74 candidate
2. two protocol-clean runs of the improved Phase 75 candidate

Report:

- score
- delta vs V6
- delta vs Phase 74 best (`0.5873`)
- elapsed time
- threshold source
- key quality metrics

If the new opponent model improves score, say so.
If it improves accuracy but hurts the composite score, say that.
If it does not help, say that too.

---

## Task E: Decide Whether Better Worlds Beat More Worlds

At the end of the phase, answer this plainly:

> did improving opponent-model quality beat the current clean score of `0.5873`?

Possible outcomes:

- **YES, better score**
- **NO, similar score but better robustness**
- **NO, no meaningful improvement**

All are useful if reported honestly.

---

## Task F: Recommend The Next Direction

Choose one primary recommendation:

- `KEEP_IMPROVING_OPPONENT_MODEL`
- `EXPAND_EVAL_SET`
- `IMPROVE_CALIBRATION_SEARCH`
- `RETURN_TO_SCALING`

Pick only one, based on evidence.

---

## Required Truthfulness

In `EXECUTION_REPORT_75.md`, explicitly answer:

1. What is the current hidden-world modeling path?
2. What specific quality improvement was made?
3. Did the score beat `0.5873`?
4. Did the change improve the quality of borderline decisions?
5. Was the gain due to better world quality, or just incidental threshold movement?
6. Is opponent modeling now the right frontier, or not?
7. What should the next phase optimize?

---

## What Not To Do

Do **not**:

- touch the eval set for selection
- quietly change the benchmark definition
- add fancy modeling with no measured benefit
- restart the Rust port for cosmetic reasons
- claim quality wins without protocol-clean reruns

---

## Success Condition

The strongest outcome for Phase 75 is:

> a protocol-clean Oracle candidate that beats `0.5873` by improving the quality of hidden-world modeling rather than merely increasing sample count.

But a clear negative result is still valuable if it shows that better opponent modeling is not yet the highest-leverage next step.
