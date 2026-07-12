# Claude Directive 77: Continuous Oracle Autoresearch In Antigravity

## Mission

Phase 76 repaired the calibration plumbing and gave us a clean read on the full Phase 75 opponent-model bundle.

That clean result was not good enough:

- training-selected threshold: `0.60`
- protocol-clean score: `0.4983`
- delta vs Phase 74 best (`0.5873`): `-0.0890`

So we now know two things:

1. the benchmark is finally clean enough to trust
2. the bundled Phase 75 idea is not a winner as currently configured

At the same time, we are still missing the most important Karpathy-style piece:

> the unattended outer loop that keeps editing `train.py`, benchmarking, keeping or discarding changes honestly, committing true improvements, and continuing in Antigravity without needing a fresh directive after every run

Because Phase 77 has **not** yet been executed, this directive merges the two next needs into one optimal Phase 77:

- build the continuous Oracle autoresearch outer loop in **Antigravity**
- and use that loop for the **first bounded research campaign**, focused on Phase 75 component ablations

This replaces both the earlier ablation-only Phase 77 draft and the withdrawn Phase 78 draft.

---

## What Success Looks Like

At the end of Phase 77, we should have:

1. a working Antigravity-driven continuous Oracle autoresearch loop
2. honest keep/discard and incumbent tracking
3. persistent logs/state that survive interruption
4. a bounded proof run showing the loop actually works
5. the first real autonomous research campaign aimed at the current highest-value question:

> which Phase 75 component(s) help, which hurt, and is there a smaller clean subset that beats the full P75 bundle or even Phase 74?

---

## Core Principle

This phase is about **building the machine and pointing it at the right first problem**.

The rule is:

> do not spend another phase manually shepherding one experiment at a time if we can now trust the benchmark enough to automate the outer loop

But also:

> do not build an aimless autonomous loop; give it a concrete first research agenda based on the best current evidence

---

## Hard Constraints

1. **Do not break benchmark integrity.**
   The eval set stays frozen.

2. **Do not let the autonomous worker edit `prepare.py`.**
   `train.py` remains the research surface unless a tiny supporting file is strictly necessary for the loop itself.

3. **Do not let eval diagnostics become a hidden selection channel.**
   Final keep/discard logic must remain benchmark-honest.

4. **Do not fake autonomy.**
   Manual launch is allowed. Manual per-iteration supervision is not.

5. **Do not fake promotion decisions.**
   A candidate is only kept if it beats the incumbent under an explicit rule.

6. **Do not widen scope into whole-repo autonomy.**
   This is Oracle-only.

7. **Do not turn this into open-ended random search.**
   The first campaign must be structured around the Phase 75 component question.

---

## Track 1: Build The Antigravity Outer Loop

Implement the missing continuous loop around `oracle_autoresearch`.

At minimum, the loop must support:

1. one-time lab preparation
2. incumbent tracking
3. experiment proposal/edit step
4. benchmark execution
5. keep/discard decision
6. git commit of kept improvements on a dedicated research branch
7. persistent experiment history
8. interruption-safe resume

Use **Antigravity** as the execution surface.

If this needs:

- a launch script
- a prompt template
- an Antigravity adapter
- a state file
- a loop runner
- or a small helper around the current lab

build those pieces.

The end state should be:

> a user can launch Oracle autoresearch in Antigravity and it will continue iterating without needing a new directive after each experiment

Be explicit in the report about exactly how Antigravity enters the execution path.

---

## Track 2: Define Honest Incumbent Logic

The loop must have explicit incumbent and promotion rules.

At minimum, store:

- incumbent score
- incumbent artifact path
- incumbent commit SHA
- incumbent threshold / selection method
- timestamp of promotion

The keep/discard rule must be written down and implemented consistently.

If you use:

- best single score
- repeated-run confirmation
- minimum improvement margin
- tie-break by stability

state the exact policy.

Do not leave incumbent logic implicit.

---

## Track 3: Build Persistent Logging And Resume

Every experiment should leave a durable record.

At minimum log:

- experiment id
- timestamp
- git SHA before / after
- short description of attempted change
- kept or discarded
- score
- delta vs incumbent
- threshold
- artifact path
- failure reason if the run failed

The progress curve should be reconstructable from repo state alone.

If Antigravity or the process stops, the loop must be restartable from persistent state.

No fragile in-memory-only design.

---

## Track 4: First Research Campaign = Phase 75 Ablations

Do not let the new loop wander blindly on day one.

Its first research campaign should target the best open question exposed by Phase 76:

> the full Phase 75 bundle underperforms, but which individual components or subsets are actually helping?

At minimum, make it possible for the loop to explore named, reviewable variants covering:

1. Phase 74-style baseline
2. upcard decline signal only
3. stock-size deadwood prior only
4. mixed continuation only
5. trace-confidence scaling only
6. full Phase 75 bundle

If one single component clearly helps, you may additionally allow the loop to test one best two-component combination.

The important thing is that the early autonomous experiments are interpretable and tied to the current research question.

---

## Track 5: Prove The Loop With A Bounded Run

Do not just build scaffolding and claim success.

Run a bounded proof of the continuous system in Antigravity.

The proof should demonstrate at least:

1. one attempted edit or named variant transition
2. one completed benchmark run
3. one keep/discard decision
4. persistent state/log output
5. restartability if feasible

If you can demonstrate multiple iterations, even better, but correctness matters more than count.

---

## Track 6: Preserve The Karpathy Human / Agent Split

Keep the basic Karpathy structure intact:

- the human iterates on Markdown instructions
- the agent iterates on the single Python research file

If `oracle_autoresearch/program.md` needs minimal refinement to work better in Antigravity, do so and explain why.

Do not turn this back into a many-file free-for-all research setup.

---

## Required Deliverables

Produce:

1. the Antigravity-compatible continuous Oracle autoresearch runner
2. any small state/logging/config files needed to support it
3. any minimal `program.md` refinements needed for unattended operation
4. the first bounded autonomous campaign output
5. `phase77_results.json`
6. `EXECUTION_REPORT_77.md`

---

## Required Truthfulness

In `EXECUTION_REPORT_77.md`, answer these plainly:

1. Is the continuous Oracle autoresearch loop now real, or still manual?
2. What exact files make up the outer loop?
3. How does Antigravity enter the execution path?
4. What is the keep/discard rule?
5. What persistent state is written after each experiment?
6. Can the loop resume after interruption?
7. What did the bounded proof run actually demonstrate?
8. Which Phase 75 component performed best in the first campaign?
9. Which component performed worst?
10. Did any clean variant beat the full P75 bundle?
11. Did any clean variant beat `0.5873`?
12. What still remains before this can run overnight unattended with confidence?

---

## What Not To Do

Do **not**:

- spend this phase manually chasing a new score by hand
- hide manual steps inside something called “autonomous”
- require a fresh directive for every experiment
- let the worker mutate the benchmark definition
- skip the ablation structure and jump straight to opaque random edits
- leave git/history behavior ambiguous

---

## Success Condition

The strongest outcome for Phase 77 is:

> Oracle autoresearch can now be launched in Antigravity as a continuous, honest, restartable loop, and its first bounded autonomous campaign has already started answering which opponent-model components are worth keeping

If the loop is real but the first campaign finds no winning subset, say so clearly.
