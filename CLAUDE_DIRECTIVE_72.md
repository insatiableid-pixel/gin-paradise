# Claude Directive 72: Oracle Autoresearch Launch Sprint

## Mission

Phase 71 made the Rust pivot real.
The next step is not another broad architectural document and not a return to open-ended Python experimentation.

Phase 72 should be the first **disciplined Oracle autoresearch phase**:

- use the new `oracle_autoresearch/` sandbox
- keep the benchmark fixed
- let the agent iterate only on the editable candidate file
- measure progress honestly against the frozen Oracle baseline

The goal is to find out whether this setup can produce a **real benchmark improvement** on the bounded low-stock Oracle problem, not merely a plausible new idea.

---

## Why This Is The Right Next Step

The project now has three things it did not have before:

1. a credible bounded Oracle subproblem from Phases 68-70
2. a real Rust substrate from Phase 71
3. a dedicated `oracle_autoresearch/` lab with:
   - fixed prep harness
   - frozen train/eval split
   - cached reference action values
   - explicit scalar scoring
   - one editable file: `train.py`

This is the first moment where the project can test the Karpathy-style workflow honestly:

> can a constrained autonomous loop improve Oracle decision quality under a fixed benchmark, without widening scope or hand-tuning the whole project?

That is exactly what Phase 72 should answer.

---

## Core Principle

Phase 72 is a **closed-loop benchmark phase**.

The rule is:

> freeze the environment, edit only the candidate file, and optimize the measured score honestly.

This phase is not about building more scaffolding.
It is about seeing whether the scaffolding works.

---

## Hard Constraints

1. **Do not edit `oracle_autoresearch/prepare.py`.**
   The harness is fixed.

2. **Do not edit the cached dataset or benchmark artifacts manually.**
   No moving the goalposts.

3. **Only edit `oracle_autoresearch/train.py` unless a genuine blocking bug in the sandbox is discovered.**
   If a blocking bug is found, fix the minimum necessary thing and report it explicitly.

4. **Do not spend this phase on broad bot work outside the sandbox.**
   No heuristic-engine tuning in `gin_rummy/`.

5. **Do not spend this phase on more Rust infrastructure.**
   Rust is supporting context here, not the target of the sprint.

6. **Use the fixed benchmark score as the primary objective.**
   Secondary metrics matter only as explanation, not as substitutes for the score.

7. **Do not claim progress from short smoke runs alone.**
   Short runs are for screening only.
   Final claims must come from fixed-budget benchmark runs.

---

## Known Context Going In

From the prepared lab:

- train spots: `2040`
- held-out pool: `875`
- eval spots: `80`
- frozen V6 baseline score: `0.4959`
- frozen V6 knock rate: `0.4250`

The score intentionally penalizes:

- over-knocking vs V6
- false-positive knocks
- undercuts on chosen knocks
- EV regret vs cached reference values

This exists because Phase 70 showed the bounded CFR path could improve held-out action quality while still becoming too knock-happy.

---

## Required Deliverables

Produce:

1. an improved `oracle_autoresearch/train.py` candidate, if one is found
2. a sequence of benchmark artifacts in `oracle_autoresearch/artifacts/`
3. a compact machine-readable summary file: `phase72_results.json`
4. a written report: `EXECUTION_REPORT_72.md`

---

## Task A: Audit The Sandbox And Reproduce The Baseline Context

Begin by reading:

- `oracle_autoresearch/program.md`
- `oracle_autoresearch/prepare.py`
- `oracle_autoresearch/train.py`
- `oracle_autoresearch/data/lab_manifest.json`

Confirm:

- the benchmark is prepared
- the V6 baseline in the manifest is readable
- the current candidate runs end-to-end

Do not change anything in this step unless the sandbox is blocked.

---

## Task B: Run A Real Baseline Candidate Benchmark

Run the current `oracle_autoresearch/train.py` as the starting candidate.

You may use short runs first to sanity-check throughput and failure modes, but you must also run at least one **real benchmark-length run** before making conclusions.

At minimum, record:

- score
- score delta vs V6
- accuracy vs best
- knock rate
- false-positive rate
- undercut rate when knocking
- average regret points

The purpose of this step is to establish the real starting point of the current candidate under the fixed harness.

---

## Task C: Improve The Candidate Inside `train.py`

Work only inside `oracle_autoresearch/train.py`.

Promising directions include:

- better information-set bucketing
- better thresholding or threshold policy
- regret regularization / smoothing
- better risk penalties for high-deadwood knock states
- better use of sampled worlds
- simpler abstractions that reduce sparse info sets
- calibration adjustments that reduce pathological knock or continue bias

Avoid cosmetic complexity.
The target is measured improvement, not novelty for its own sake.

At least **three materially distinct ideas** should be tested unless the first one already produces a clearly dominant result and follow-up confirmations.

---

## Task D: Run An Honest Experiment Loop

Use a two-stage loop:

1. short exploratory runs to screen ideas cheaply
2. full benchmark runs to validate the strongest candidate(s)

Required:

- at least 3 meaningful experimental variants
- at least 2 full benchmark runs on the best candidate configuration

If the best candidate is unstable across full runs, say so explicitly.

Do not cherry-pick a single lucky run without acknowledging variance.

---

## Task E: Decide Whether Phase 72 Actually Won

At the end of the experiment loop, answer the central question plainly:

> did the Oracle autoresearch setup beat the frozen V6 baseline score of `0.4959`?

Possible outcomes:

- **YES, benchmark improvement**:
  report the best score and why it improved

- **NO, but promising**:
  report the best near-miss and the limiting failure mode

- **NO, setup not yet productive**:
  report that honestly and explain whether the bottleneck is:
  - abstraction
  - training objective
  - score design
  - variance
  - or insufficient search depth

Do not redefine success after the fact.

---

## Task F: Recommend The Next Move Honestly

Based on the evidence, choose one of these recommendations:

- `KEEP_AUTORESEARCHING`
- `ADJUST_SCORE_OR_HARNESS`
- `PORT_MORE_INNER_LOOP_TO_RUST`
- `RETURN_TO_ORACLE_MODELING`

Pick only one primary recommendation and justify it from Phase 72 results.

---

## Required Truthfulness

In `EXECUTION_REPORT_72.md`, explicitly answer:

1. Did the sandbox run cleanly and comparably?
2. What was the starting candidate score?
3. What was the best full-run score?
4. Did any candidate beat the frozen V6 baseline of `0.4959`?
5. What change helped most, if any?
6. Is the current bottleneck now search quality, abstraction quality, or runtime budget?
7. Should the next phase continue in this sandbox, or pivot again?

---

## What Not To Do

Do **not**:

- edit `prepare.py` for convenience
- regenerate the dataset to chase a friendlier split
- widen scope into general bot development
- count smoke tests as final evidence
- bury negative results under narrative

---

## Success Condition

The strongest outcome for Phase 72 is:

> a reproducible candidate in `oracle_autoresearch/train.py` that beats the frozen V6 baseline on the fixed Oracle benchmark.

But a clean, honest negative result is still valuable if it tells us the current autoresearch formulation is not yet strong enough.

The point of Phase 72 is to learn that truth quickly and rigorously.
