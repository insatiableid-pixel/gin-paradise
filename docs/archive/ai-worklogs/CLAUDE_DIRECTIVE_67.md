# Claude Directive 67: Trace-Aware Meld World Construction Sprint

## Mission

Take the next strongest oracle-direction step by replacing the solver’s remaining low-stock belief failure:

> it still samples opponent hands as random card bundles and then tries to reweight them, instead of constructing the meld-rich hands that strong opponents actually reach.

Phase 66 proved two things:

1. the solver’s hidden-world model is the core bottleneck
2. importance-weighting random hands is not enough

So Phase 67 should **not** spend its energy on more benchmark probes or new knock heuristics.
It should build the first **trace-aware, meld-aware opponent hand constructor** for the low-stock solver.

## Why This Is The Right Next Step

The chain is now very clear:

- **Phase 64:** solver-driven low-stock knock probes failed in live play
- **Phase 65:** the reason was catastrophic undercut underestimation from a bad belief model
- **Phase 66:** belief-weighted world generation improved architecture but failed to beat v3 because:
  - card-level weights were a no-op without per-card action traces
  - random 10-card hands from the remaining pool still had absurdly high deadwood

That means the next highest-force move toward the gin-rummy oracle is:

- stop sampling random opponent hands
- start constructing **plausible meld-first opponent hands**
- condition those hands on the actual public action trace

This is much closer to a true imperfect-information engine than another round of knock heuristics.

## Core Principle

Phase 67 is a **range-construction** phase.

The target is not “a slightly better penalty term.”
The target is a new opponent-range generator that answers:

- what kinds of meld structures is the opponent plausibly holding?
- which specific cards are supported or contradicted by the public trace?
- what deadwood quality is realistic at this point in the hand?

That is the correct next abstraction layer for an oracle-track gin solver.

## Hard Constraints

1. **Do not build a new production knock policy in this phase.**
2. **Do not run another broad gameplay benchmark probe.**
3. **Do not keep relying on random 10-card opponent hand sampling as the main low-stock range mechanism.**
4. **Do not overclaim success if the new constructor is only marginally better.**

## Required Deliverables

Produce:

1. a richer **public action trace pipeline**
2. a **meld-aware opponent hand constructor**
3. a new solver path built on top of it (e.g. `solver_v5`)
4. a calibration comparison against v3 and v4
5. `EXECUTION_REPORT_67.md`

## Task A: Pipe Per-Card Public Action Traces

Phase 66 exposed a hard data-pipeline gap: the dataset did not preserve enough per-card public action history for the card-level belief model to activate.

Fix that.

At minimum, low-stock spot objects and/or mining pipelines should preserve:

- opponent discard-pile pickups by exact card
- visible discards by exact card and turn order
- upcard declines / passes if available
- any existing public action sequence that the solver can legally use

If some of this information is not currently available in the engine or replay path, add the smallest clean plumbing necessary to make it available for solver research.

This task matters because without it, `OpponentModel`-style card weights remain inert.

## Task B: Build A Meld-Aware Opponent Hand Constructor

This is the center of the phase.

Instead of:

- sampling random legal opponent hands
- then reweighting by deadwood quality

build a constructor that first proposes **plausible meld skeletons** and then fills remaining slots.

### Required idea

The constructor should generate opponent hands through something like:

1. choose one or more candidate meld structures (runs / sets) from the legal unknown cards
2. score those structures by consistency with:
   - public action trace
   - card-level weights
   - predicted opponent deadwood / undercut risk
3. fill remaining cards as plausible deadwood
4. produce a weighted candidate opponent hand

You do not need a full exact range solver.
But you do need to move from “random cards” to “hands built around meld intent.”

### Acceptable implementation shapes

Examples:

- enumerate top-K plausible meld skeletons, then sample completions
- importance-sample runs/sets first, then fill deadwood
- sample target deadwood bucket first, then construct meld-rich hands consistent with it

Choose the simplest formulation that actually changes the world distribution in the right direction.

## Task C: Combine Meld Construction With Trace-Aware Card Weights

The new constructor should use both:

- **card-level evidence** from the public trace / `OpponentModel`
- **hand-quality evidence** from the undercut / deadwood estimator

In other words:

- action trace says *which cards / suits / ranks are plausible*
- estimator says *how good the overall hand should be*

We want both signals active at once.

## Task D: Build Solver V5

Integrate the new constructor into a new solver path for low-stock analysis.

This solver should be directly comparable against:

- `solver_v3` (best calibrated so far)
- `solver_v4` (belief-weighted random worlds)

The main question is:

> Does meld-aware construction finally make the sampled opponent worlds look like real late-game opponent hands?

## Task E: Quantify Whether The World Model Actually Improved

This phase must be judged on calibration, not elegance.

On held-out low-stock legal-knock spots, compare v3 / v4 / v5 on at least:

- mean predicted opponent deadwood vs actual
- opponent deadwood MAE / bias
- fraction of sampled opponent worlds with `DW <= 5`
- undercut-rate prediction bias
- correct-continue rate on actual undercut spots
- knock / continue recommendation rate

The report must say plainly whether v5 is:

- materially better than v3
- only better than v4
- or still not good enough

## Task F: Revisit The Surviving Knock Frontier

If v5 materially improves calibration, use it to re-check the low-stock knock frontier.

We want to know whether the remaining solver-recommended non-gin knocks become:

- rarer
- cleaner
- more coherent
- and more benchmark-worthy

If v5 still recommends lots of low-stock non-gin knocking, but calibration remains poor, say so plainly.

## Optional Task G: Tiny Validation Probe

Only if v5 clearly outperforms v3 and produces a **small, coherent** surviving knock class, you may run a tiny validation probe on that narrow class.

This is optional and must remain narrow.

Do **not** turn the phase back into a broad benchmark sprint.

## Required Truthfulness

In `EXECUTION_REPORT_67.md`, explicitly separate:

- what came from new trace plumbing
- what came from meld-aware hand construction
- what came from the undercut estimator
- what remains heuristic

Also answer directly:

1. Did the card-level signal finally activate?
2. Did sampled opponent deadwood meaningfully move toward reality?
3. Is v5 genuinely better than v3, or just architecturally nicer?

## What Not To Do

Do **not**:

- add another hand-tuned knock threshold
- spend the phase mostly on gameplay benchmarks
- claim success if the sampled opponent hands are still nowhere near real low-stock quality
- keep a no-op card-weight stage without saying so explicitly

## Preferred Report Structure

Write `EXECUTION_REPORT_67.md` with:

1. **What new trace data became available**
2. **How the meld-aware constructor works**
3. **How v5 differs from v3/v4**
4. **Calibration comparison: v3 vs v4 vs v5**
5. **Whether the world model finally got closer to real opponent hands**
6. **How the surviving knock frontier changed**
7. **Best next oracle-roadmap step**

## Success Criteria

Phase 67 is successful if, by the end, we have:

- live card-level public-trace signal
- a meld-aware opponent hand constructor
- materially more realistic low-stock opponent worlds
- a solver whose remaining knock advice is narrower and more believable

That is the strongest available push toward the gin-rummy oracle after Phase 66.

## Summary

Phase 66 proved that weighting random hands is not enough.
Phase 67 should now build the missing layer:

- trace-aware
- meld-aware
- deadwood-aware

opponent range construction.

That is the next real oracle-direction move.
