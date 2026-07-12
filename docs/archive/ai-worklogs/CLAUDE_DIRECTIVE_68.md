# Claude Directive 68: Trace Activation and Solver V6 Sprint

## Mission

Activate the missing per-card public-action signal and use it to build the next solver upgrade under a clean, falsifiable evaluation standard.

Phase 67 proved that **meld-aware hand construction is the right abstraction layer** and that `solver_v5` is a real calibration breakthrough. But it also proved the next bottleneck just as clearly:

> the trace-aware layer is architecturally present but functionally inert, because the current datasets do not preserve exact per-card public events.

So Phase 68 should not be another benchmark phase and not another heuristic phase.
It should build the first **trace-active** solver pipeline, use it to produce `solver_v6`, and prove that any gain is coming from real per-card trace information rather than incidental constructor retuning.

## Why This Is The Right Next Step

The recent chain now says:

- **Phase 65:** undercut estimator exposed the uniform-world blind spot
- **Phase 66:** importance-weighted random hands were not enough
- **Phase 67:** meld-aware construction solved most of the deadwood realism problem
- **Phase 67:** but the card-level trace signal still contributed **zero** because the dataset had no exact public card events

That means the next highest-force oracle move is:

- make the trace signal real
- feed it into meld construction
- measure whether the world model becomes even closer to how strong opponents actually arrive at low-stock positions

This is deeper and more oracle-aligned than another gameplay benchmark right now.

## Core Principle

Phase 68 is a **data activation + belief refinement** phase.

The target is a new solver version whose opponent worlds are conditioned by:

- meld structure
- undercut/deadwood priors
- and now, finally, **actual per-card public action traces**

That is a qualitatively stronger imperfect-information model than what we have now.

## Hard Constraints

1. **Do not build a new production bot in this phase.**
2. **Do not run a broad benchmark probe.**
3. **Do not accept a no-op trace layer again.**
   The whole point of this phase is to activate it.
4. **Do not overclaim success if the trace signal barely moves the calibration.**
5. **Do not let constructor retuning masquerade as trace success.**
   You must isolate the incremental effect of trace activation.

## Required Deliverables

Produce:

1. a new **trace-rich low-stock dataset**
2. an activated card-level trace weighting path
3. a new `solver_v6` built on top of the trace-active constructor
4. a calibration comparison vs `solver_v5`
5. `EXECUTION_REPORT_68.md`

## Task A: Build A Trace-Rich Dataset

Create a new low-stock legal-knock dataset that preserves exact public card events, not just counts.

At minimum, each spot should carry enough information to reconstruct:

- exact opponent discard-pile pickups
- exact opponent discards, in order
- exact visible declines / passes if available
- turn order / timing for those events

This dataset should be mined from real strong self-play / engine traces, not retrofitted approximately from summary features. Prefer the current shipped champion family as the source population so the dataset reflects realistic strong-play public histories.

### Required success check

In the new dataset, the trace weighting path must show **non-zero spread** on a meaningful fraction of spots.

You must explicitly report:

- percentage of spots with active card-weight differentiation
- mean / median card-weight spread
- how often the trace signal changes skeleton ranking

If the activation rate is still near zero, stop and explain why.

## Task B: Integrate The Trace Signal Into Meld Construction

Use the new per-card trace data to actually influence opponent range construction.

The trace signal should affect at least:

- skeleton scoring / ranking
- candidate completion scoring
- and, if useful, the tier mixture itself

This is where `ActionTrace` must stop being “ready infrastructure” and become a genuine modeling input.

### Required ablation

Run at least one controlled comparison where the constructor is held fixed and only the trace weights are toggled:

- same trace-rich held-out spots
- same constructor family
- trace off vs trace on

You must report whether trace activation alone changes:

- skeleton ranking
- sampled world distribution
- calibration metrics
- action recommendations

## Task C: Close More Of The Low-DW World Gap

Phase 67 moved sampled opponent low-DW worlds from 4.2% to 42.3%, but reality was 86.7%.

Phase 68 should try to narrow that remaining gap.

Acceptable directions include:

- biasing skeleton selection toward stronger meld realizations
- reducing the zero-meld junk tier
- adding a more explicit **gin-chasing / low-deadwood tier**
- improving the fill procedure around skeletons so completions are less random

Do not just tweak numbers blindly.
Tie the change to calibration metrics, and distinguish clearly between:

- gains from better constructor priors
- gains from trace activation

## Task D: Build Solver V6

Create `solver_v6` as the trace-active successor to `solver_v5`.

It should combine:

- meld-aware construction
- undercut/deadwood priors
- active trace weighting from real per-card events

This is the phase where the full architecture from 67 finally gets to operate as intended.

## Task E: Compare V5 vs V6 Honestly

On held-out trace-rich low-stock legal-knock spots, compare at least:

- mean opponent deadwood prediction
- opponent deadwood MAE / bias
- fraction of sampled opponent worlds with `DW <= 5`
- correct-continue rate on actual undercut spots
- knock / continue recommendation rate
- surviving non-gin knock UC rate

Also report one specifically trace-sensitive metric, such as:

- how often v6 differs from v5 because of trace signal alone
- how often the top-ranked skeleton changes when trace weights are active

The point is not just “is v6 better?”
It is:

> did the trace signal finally become a live, useful source of information?

## Task F: Revisit The Surviving Non-Gin Knock Frontier

Phase 67 still left a surviving non-gin knock class with meaningful undercut risk.

After trace activation, determine whether that surviving frontier becomes:

- smaller
- cleaner
- more coherent
- and more plausible as a future benchmark target

If v6 still recommends lots of risky non-gin low-stock knocks, say so plainly.

## Optional Task G: Tiny Targeted Validation

Only if v6 materially outperforms v5 and produces a very small, coherent surviving class, you may suggest one future narrow validation benchmark.

Do **not** run a broad gameplay phase here unless the signal is extremely clean.

## Required Truthfulness

In `EXECUTION_REPORT_68.md`, explicitly answer:

1. Did the trace signal actually activate?
2. How much did it change the world distribution?
3. How much of v6’s improvement came from trace signal vs constructor retuning?
4. Did v6 materially beat v5, or only slightly?
5. Is there now a truly benchmark-worthy surviving class, or not yet?

## What Not To Do

Do **not**:

- return to summary-count-only datasets
- accept a zero-spread trace model as “good enough”
- spend the phase mostly on benchmarks
- ship a new knock heuristic from partial evidence

## Preferred Report Structure

Write `EXECUTION_REPORT_68.md` with:

1. **What new trace-rich data became available**
2. **Whether the trace signal activated**
3. **How the constructor changed**
4. **V5 vs V6 calibration comparison**
5. **How the low-DW world gap changed**
6. **How the surviving knock frontier changed**
7. **Trace-off vs trace-on ablation**
8. **Best next oracle-roadmap step**

## Success Criteria

Phase 68 is successful if, by the end, we have:

- a trace-rich dataset with active per-card public signal
- a trace-powered `solver_v6`
- materially improved low-stock world realism over v5
- a clear ablation showing whether per-card trace signal itself matters
- and a clearer view of whether any non-gin knock frontier still survives after realistic belief construction

That is the strongest next push toward the gin-rummy oracle after Phase 67.

## Summary

Phase 67 proved meld-aware construction works.
Phase 68 should now switch on the missing signal that can make it truly opponent-specific:

- real per-card public action traces
- active trace-weighted skeleton selection
- and a trace-powered `solver_v6`

That is the next real oracle-direction step.
