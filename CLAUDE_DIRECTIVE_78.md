# Claude Directive 78: Make Oracle Autoresearch Truly Agent-Driven

## Mission

Phase 77 produced something useful, but not yet the thing we actually asked for.

What now exists is:

- a persistent campaign runner
- honest keep/discard bookkeeping
- a bounded ablation campaign with useful results

What does **not** yet exist is true Karpathy-style continuous autoresearch:

> an agent in Antigravity repeatedly editing `oracle_autoresearch/train.py`, benchmarking the edited file, keeping or discarding the resulting code change, and continuing without fresh human steering

Phase 78 is therefore a **corrective infrastructure phase**.

The goal is to convert the current campaign runner into a real agent-driven Oracle autoresearch loop.

---

## Why Phase 77 Is Not Sufficient

Phase 77 over-claimed in two important ways:

1. the loop executed a hard-coded variant queue and monkey-patched `train.py` globals
2. “Antigravity integration” was described as launching a generic Python script, not as a demonstrated Antigravity-mediated code-editing process

That means the current system is closer to a **structured benchmark runner** than to true continuous autoresearch.

Keep the good parts from Phase 77, but do not claim the mission is complete until the agent is actually iterating on `train.py`.

---

## Core Principle

This phase is about making the loop **real**, not just orderly.

The rule is:

> the outer loop must drive actual candidate code changes to `train.py`, not only pre-scripted toggle sweeps

If the agent never edits the research file, it is not Karpathy-style autoresearch yet.

---

## Hard Constraints

1. **Do not break benchmark integrity.**
   The eval set remains frozen.

2. **Do not let the agent edit `prepare.py`.**
   `train.py` is the research surface.

3. **Do not let eval diagnostics become a hidden promotion channel.**

4. **Do not fake Antigravity integration.**
   The report must describe a real Antigravity role in the edit-run-judge loop.

5. **Do not rely on monkey-patching alone as the research mechanism.**
   Monkey-patching may remain a testing aid, but it does not satisfy the main requirement.

6. **Do not require a fresh directive after each experiment.**

7. **Do not discard the useful Phase 77 ablation findings.**
   They should inform the first real search agenda.

---

## Task A: Convert The Loop From Variant Runner To Candidate Runner

Refactor the outer loop so that each experiment is centered on an actual candidate version of `train.py`.

At minimum, the loop must support:

1. starting from the current incumbent `train.py`
2. asking the Antigravity agent to propose a concrete edit to `train.py`
3. applying that edit
4. benchmarking the edited file
5. keeping or discarding the resulting file version
6. restoring the incumbent on discard
7. committing the new incumbent on keep

The key unit of search must become:

> a candidate code diff to `train.py`

not just a predefined variant id.

---

## Task B: Make Antigravity Real

Integrate Antigravity into the actual edit path.

That means the report must be able to say, concretely:

- what Antigravity process was launched
- what prompt/context it received
- how it was constrained to `train.py`
- how its proposed edit was captured and applied

If Antigravity requires:

- a prompt template
- a wrapper script
- an adapter file
- a scratch workspace
- or a file-based request/response protocol

build the smallest honest version that works.

But do not hand-wave this step.

---

## Task C: Preserve The Good Phase 77 Infrastructure

Keep and reuse the useful pieces from Phase 77 where appropriate:

- persistent state
- keep/discard bookkeeping
- resume support
- experiment history
- session summaries

You may refactor them, but do not throw them away without reason.

---

## Task D: Seed The First Real Search Agenda

Do not let the first real autonomous loop be aimless.

Use the Phase 77 ablation findings as the initial search prior:

- trace-confidence scaling looked strongest
- stock-size deadwood prior looked second-best
- mixed continuation looked weak
- the full bundle looked bad

That means the first agent-driven search agenda should be biased toward:

- preserving or refining trace-confidence behavior
- testing smaller subsets / refinements rather than blindly restoring the full P75 bundle
- simplifying or weakening mixed continuation unless evidence says otherwise

The point is not to hard-code the answer.
The point is to give the first real autonomous campaign a sensible starting prior.

---

## Task E: Prove It With Actual Agent-Mediated Edits

Do not stop at building plumbing.

Run a bounded proof in which the Antigravity-driven loop performs at least:

1. one real agent-generated edit to `train.py`
2. one completed benchmark of that edited file
3. one honest keep/discard decision on that edited file
4. durable logging of the candidate diff and outcome

If possible, demonstrate multiple iterations.

But the minimum proof must include at least one actual agent-authored `train.py` candidate.

---

## Task F: Make Promotion And Revert Safe

When a candidate loses, the system must return to the incumbent cleanly.

When a candidate wins, the system must:

- update incumbent state
- persist the promoted artifact path and score
- record the code diff / summary
- commit the promoted `train.py`

If no candidate wins during the proof run, that is acceptable, but discard behavior must still be demonstrated honestly.

---

## Required Deliverables

Produce:

1. the corrected agent-driven Oracle autoresearch loop
2. any Antigravity adapter / prompt / wrapper files required
3. any state/logging updates needed to support code-diff-based experiments
4. a bounded proof run with actual agent-generated `train.py` edits
5. `phase78_results.json`
6. `EXECUTION_REPORT_78.md`

---

## Required Truthfulness

In `EXECUTION_REPORT_78.md`, answer these plainly:

1. Is the loop now truly agent-driven, or still mostly scripted?
2. What exact step causes Antigravity to edit `train.py`?
3. What files mediate the Antigravity integration?
4. What does one candidate lifecycle look like from prompt to keep/discard?
5. Was at least one real agent-generated `train.py` diff benchmarked?
6. Was discard restoration proven?
7. Was promotion-and-commit proven? If not, what remains unproven?
8. What did the first real autonomous search attempt actually try?
9. Did any real agent-generated candidate improve on the incumbent?
10. What still remains before overnight unattended operation is trustworthy?

---

## What Not To Do

Do **not**:

- report another scripted variant sweep as “continuous autoresearch”
- avoid `train.py` edits by hiding behind runtime overrides
- call a generic Python launch command “Antigravity integration” unless Antigravity is truly in the edit path
- spend the phase manually tuning scores by hand

---

## Success Condition

The strongest outcome for Phase 78 is:

> the Oracle loop now includes a real Antigravity agent that edits `train.py`, benchmarks those edits, keeps or discards them honestly, and can continue this process without a new directive after every experiment

If the loop is still partly scripted, say so clearly.
