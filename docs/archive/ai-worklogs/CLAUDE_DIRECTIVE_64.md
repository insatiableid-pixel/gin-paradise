# Claude Directive 64: Solver Falsification Benchmark Probe

## Mission

Run the first direct, match-level falsification test of the Phase 61–63 solver signal.

The improved solver now makes a broad low-stock recommendation:

- in many `stock <= 6`, legal-knock states
- across multiple DW bands and textures
- it prefers `knock now` where the current champion continues

Phase 63’s disagreement audit was strong enough that the next honest step is no longer more mining.
The next honest step is to ask:

> Does a solver-aligned low-stock knock override actually win duplicate matches against the current champion?

This phase should answer that directly.

## Why This Is The Right Next Step

The chain is now:

- **Phase 61:** first solver foundation
- **Phase 62:** better continuation and match-equity support strengthened the initial disagreement
- **Phase 63:** the disagreement proved broad, common, and costly enough to justify a production test

That means we have crossed the threshold where continued analysis alone is lower value than a clean benchmark probe.

If the solver is right, a low-stock knock override should beat the current champion.
If it loses, then the solver still has a systematic low-stock knock bias and future effort should go back into solver realism rather than bot changes.

Either result is highly informative.

## Core Principle

This is a **falsification phase**.

Do not build a complicated policy tree.
Do not optimize many knobs.
Do not handcraft a dozen micro-rules.

We want a small number of simple, interpretable probes that test whether the solver’s broad knock preference survives actual duplicate match play.

## Hard Constraints

1. **Do not ship a new champion without real benchmark evidence.**
2. **Do not build complex multi-threshold heuristics.**
3. **Do not optimize against a weak field first.**
   Direct H2H vs the current champion is the primary test.
4. **Do not overfit to Phase 63 cluster tables.**
   This phase is about broad falsification, not curve fitting.

## Required Candidate Set

Build **2–3 simple solver-aligned probe variants** on top of the current champion.

They should all preserve existing draw/discard behavior and only change knock behavior in the low-stock region.

### Required Variant A: Broad Probe

Create the maximally simple test of the solver thesis:

- if `stock <= 6` and knock is legal, knock
- otherwise use the champion’s current knock policy

This is the strongest falsification probe.
If even this broad solver-aligned rule wins, the current champion is almost certainly too patient.

### Required Variant B: Narrower DW-Aware Probe

Create one narrower probe that tries to protect the most solver-suspicious region without fully embracing the broad rule.

Recommended shape:

- if `stock <= 6` and legal knock and `DW >= 3`, knock
- otherwise champion policy

If the exact cutoff needs small adjustment from the Phase 63 results, that is acceptable, but keep it simple and interpretable.

### Required Variant C: Texture-Aware Probe

Create one texture-aware probe aligned with the original low-stock fragmented disagreement.

Recommended shape:

- if `stock <= 6` and legal knock and hand is fragmented / multi-card deadwood, knock
- otherwise champion policy

Again: keep the rule compact. This is a probe, not a final architecture.

## Primary Benchmark Plan

### Stage 1: Quick Screen

Each probe variant must play a duplicate H2H against:

- `ApexMCTSClinchOnlyGoGin`

Run enough games to kill bad probes quickly but not waste time.

Suggested quick screen:

- `240` to `400` total games per probe

### Stage 2: Confirmation

If one variant looks promising in Stage 1, run a substantially larger confirmation benchmark against the current champion.

Suggested confirmation:

- `1000+` total games

If none of the probes is promising, stop and report that clearly.

## Required Diagnostics

This phase is only useful if the benchmark is interpretable.

For each probe, report:

- overall win rate vs champion
- confidence interval or at least clear sample counts
- low-stock knock frequency
- gin rate
- undercut rate
- average hand points when knocking
- performance split by:
  - `stock 1-2`
  - `stock 3-4`
  - `stock 5-6`
- performance split by:
  - `DW 0-2`
  - `DW 3-5`
  - `DW 6-10`

The point is to learn whether:

- the broad probe works broadly
- only the medium/high-DW region works
- or the whole solver knock signal collapses in real matches

## Required Interpretation

At the end, explicitly state which of these worlds we are in:

1. **Broad solver signal validated**
   A broad low-stock knock rule beats the champion.

2. **Narrow solver signal validated**
   The broad rule loses, but a narrower DW/texture-aware probe wins.

3. **Solver low-stock knock bias falsified**
   All probes lose, meaning the solver disagreement does not convert to match strength.

This classification matters more than squeezing out one extra percentage point.

## Secondary Benchmarking

Only after direct H2H vs the champion:

- if a probe looks real, you may optionally test it in a secondary field
- but this is not the primary requirement

The decisive question is whether the probe beats the current champion.

## What Not To Do

Do **not**:

- build a giant phase of extra solver mining first
- add more than 3 probe variants
- fine-tune several adjacent thresholds after seeing quick-screen noise
- promote a new policy from Stage 1 alone
- claim the solver is proven correct just because a narrow probe wins a small sample

## Preferred Report Structure

Write `EXECUTION_REPORT_64.md` with:

1. **What probe variants were built**
2. **Why those variants were chosen**
3. **Quick-screen results**
4. **Confirmation results** (if any)
5. **Stock-bucket and DW-bucket diagnostics**
6. **Whether the solver’s low-stock knock signal validated or failed**
7. **Best next step**

## Success Criteria

Phase 64 is successful if it gives a clean answer to this:

- does a solver-aligned low-stock knock override beat the current champion in real duplicate match play?

That answer, whether yes or no, is now worth more than another round of static analysis.

## Summary

Phase 63 justified a production test.
Phase 64 should run that test directly and honestly.

Use a small number of simple probe variants.
Benchmark them against the champion.
Learn whether the solver is broadly right, narrowly right, or still biased.
