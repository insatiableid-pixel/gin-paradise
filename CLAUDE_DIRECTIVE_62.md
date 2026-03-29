# Claude Directive 62: Solver Fidelity Upgrade Sprint

## Mission

Strengthen the new representative subgame solver so its disagreements with the current champion become **credible enough to guide future engine design**.

Phase 61 successfully built the first solver-grade research instrument. That was the correct pivot. But the report is also clear about the current bottleneck:

- the solver found one important disagreement (`fragmented_dw_low_stock`)
- **but its continuation branch is still too crude** to trust as near-ground-truth

So Phase 62 should **not** ship a new heuristic knock rule yet.
It should upgrade the solver’s weakest approximations:

1. **continuation policy fidelity**
2. **match-equity evaluation fidelity**
3. **realism of the spot corpus**

This is the next correct step toward the oracle roadmap.

## Why This Is The Right Next Step

The recent chain is now coherent:

- **Phase 60:** compact frontier heuristics lost in full matches
- **Phase 61:** the right move was solver infrastructure, not more heuristics
- **Phase 61 result:** the solver already found a plausible champion mistake, but the result is still policy-dependent because continuation uses a simplified stock-only greedy rollout

That means the key question is no longer:

- “What should the bot do?”

It is now:

- “Can the solver evaluate `continue` realistically enough that we trust its answer?”

The report itself ranked the next steps correctly:

1. better continuation policy
2. better match-equity table
3. belief refinement
4. larger realistic corpus

Phase 62 should follow that order.

## Core Principle

Treat this as a **solver credibility** phase, not a champion-promotion phase.

The default expected outcome is:

- stronger solver
- better canonical-spot analysis
- more trustworthy disagreement set
- **no new production bot yet**

## Hard Constraints

1. **Do not ship a new knock heuristic from the Phase 61 disagreement alone.**
   The whole purpose of this phase is to determine whether that disagreement survives higher-fidelity evaluation.

2. **Do not revert to threshold tuning.**
   No new gin-probability threshold family, no manual frontier buckets, no local rule spree.

3. **Do not claim oracle-level correctness.**
   This phase should improve fidelity, not overstate exactness.

4. **Keep the current champion unchanged** unless an overwhelming case somehow emerges accidentally.
   That is not the expected deliverable.

## Required Deliverables

Phase 62 should produce:

1. a **policy-backed continuation engine** inside the solver
2. a **better match-equity wrapper / table**
3. an expanded set of **realistic low-stock legal-knock spots**
4. a rerun of the canonical spot comparison under the improved solver
5. `EXECUTION_REPORT_62.md`

## Task A: Replace Greedy Continuation With Policy-Backed Continuation

This is the main task.

Right now the largest source of solver weakness is that `continue` is evaluated using a crude continuation policy:

- greedy deadwood minimization
- stock-only draws
- simplified knock behavior

Upgrade this to a higher-fidelity continuation model that uses the actual engine policies where feasible.

### Minimum required behavior

The improved continuation branch should support:

- real draw decisions (`discard` vs `stock`) where possible
- real discard decisions from an existing strong engine
- real knock decisions from an existing strong engine
- continuation until end of hand (or until a justified low-stock cutoff if absolutely necessary)

### Preferred baseline policy

Use the current champion family as the default continuation policy:

- `ApexMCTSClinchOnlyGoGin`

If plugging the full champion into both sides is too expensive, use the strongest tractable approximation you can, but it must be **meaningfully closer to real bot play** than the Phase 61 greedy rollout.

### Recommended implementation shape

Ideally the solver should support pluggable continuation policies:

- `greedy` (old baseline)
- `champion_policy`
- optionally one alternate strong policy for sensitivity testing

The point is to measure how solver conclusions change when the continuation branch becomes more realistic.

## Task B: Replace the Linear Match-Equity Approximation

Phase 61’s linear match-equity wrapper was honest, but too weak.

Build a first empirical **score-state match-equity table** from strong self-play or simulation.

### Goal

Estimate a mapping like:

- `(my_score, opp_score) -> approximate win probability`

This does not need to be perfect. It needs to be **materially better than a linear proxy** and reusable by the solver.

### Constraints

- Prefer strong-bot self-play rather than weak baselines
- Be explicit about data source and smoothing assumptions
- If full table coverage is too expensive, use a practical approximation with interpolation / bucketing

### Use in solver

Use this table to convert post-hand score outcomes into a better match-equity delta for:

- `knock now`
- `continue`

## Task C: Expand The Spot Corpus With Real Positions

Phase 61’s 8 canonical spots were a good start, but they were still hand-authored.

Add a second corpus layer: **real low-stock legal-knock spots mined from strong self-play**.

### Required target

Extract at least a modest realistic set, for example:

- 10–20 low-stock legal-knock positions

from games involving the current champion or another strong policy.

Each mined spot should preserve enough information for solver replay:

- hero hand
- public state
- score state
- stock size
- discard pile / visible action context

### Goal

We want to know whether the one current disagreement is a one-off curiosity or part of a repeatable class of champion errors.

## Task D: Re-run and Compare

After Tasks A–C, re-run the solver analysis on:

1. the Phase 61 canonical spots
2. the new mined realistic spots

For each spot, compare at least:

- old greedy continuation verdict
- new policy-backed continuation verdict
- current champion action

And clearly identify:

- stable disagreements
- disagreements that disappeared once continuation improved
- new disagreements that only emerge in realistic spots

## Task E: Belief Sensitivity Check

If the core work lands cleanly, add one controlled belief refinement experiment.

Do **not** build a full neural belief model yet.
Just test whether the solver’s verdict is sensitive to a more informed hidden-world sampler.

Examples:

- existing uniform hidden-world generation
- lightly weighted generation using public-action / opponent-model hints if already available

The goal is not to finish belief modeling. The goal is to discover whether the current disagreements are fragile to belief assumptions.

This is secondary to Tasks A and B.

## Required Tests

Add real tests for the new solver capabilities, including:

- policy-backed continuation reproducibility / structure
- score-table construction / lookup sanity
- mined-spot format validation
- regression protection for canonical spot solving
- at least one test showing the solver can run the same spot under two continuation modes

Keep the Phase 61 honesty standard: every approximation should be testable.

## What Not To Do

Do **not**:

- promote a new champion solely from solver output
- add a new hand-written low-stock knock exception yet
- pivot back to draw/discard imitation learning
- conflate “policy-backed continuation” with equilibrium solving
- claim the improved solver is exact unless it truly is

## Preferred Report Structure

Write `EXECUTION_REPORT_62.md` with these sections:

1. **What changed in the solver**
2. **How continuation fidelity improved**
3. **How match-equity evaluation improved**
4. **What real spots were mined**
5. **Which disagreements survived**
6. **Which prior disagreements disappeared**
7. **What this means for the current champion**
8. **Best next step toward the oracle roadmap**

## Success Criteria

Phase 62 is successful if, by the end, we have:

- a solver that evaluates `continue` much more realistically
- a better score-aware outcome valuation
- a realistic low-stock spot corpus
- a clearer, more trustworthy map of where the champion is genuinely wrong

That is much more valuable right now than another local heuristic tweak.

## Summary

Phase 61 proved the oracle-track pivot was right.
Phase 62 should now make that new solver **credible**:

- upgrade continuation policy
- upgrade match-equity evaluation
- test on real low-stock spots
- keep the champion unchanged unless the evidence becomes overwhelming

This is the correct next step toward a true XG-track Gin engine.
