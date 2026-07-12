# Claude Directive 63: Rare-Spot Disagreement Mapping Sprint

## Mission

Determine whether the solver-backed `fragmented_dw_low_stock` disagreement from Phases 61–62 is:

1. a **real and repeatable class** of champion errors worth targeting, or
2. a **rare edge case** that is solver-interesting but too infrequent to matter in match play.

Do **not** promote a new champion yet.
Do **not** ship a new low-stock knock rule yet.

Phase 63 should answer the question that now matters most:

> How often does the current champion reach low-stock legal-knock states where the improved solver believes `knock now` is materially better than `continue`, and what is the aggregate match-value cost of those mistakes?

## Why This Is The Right Next Step

The recent sequence now says:

- **Phase 60:** compact knock heuristics failed in full matches
- **Phase 61:** first solver scaffold found one actionable disagreement
- **Phase 62:** higher-fidelity continuation and better match-equity support **strengthened** that disagreement instead of weakening it

But Phase 62 also revealed the limiting fact:

- the mined low-stock spot corpus from champion self-play was dominated by **DW 0–4**
- the suspected disagreement class lives more in the **DW 5–10 fragmented / low-stock region**
- so we still do **not** know the real frequency and practical importance of the disagreement class

That makes the next step clear:

- map the disagreement class
- estimate its frequency
- estimate its aggregate cost
- only then decide whether a production override is warranted

This is the honest bridge between solver research and possible gameplay changes.

## Core Principle

Treat this as a **frequency-and-impact audit** for solver disagreements.

The success condition is **not** “invent a new heuristic.”
The success condition is a trustworthy answer to:

- how often the champion is wrong
- in what exact class of states
- by how much
- and whether that class is common enough to matter

## Hard Constraints

1. **Do not ship a new low-stock knock override in this phase.**
   Even if the disagreement continues to look real, this phase is about auditing the class, not shipping it.

2. **Do not revert to manual threshold engineering.**
   No new hand-written rule families.

3. **Do not over-interpret canonical spots.**
   The whole point here is to move from one-off curated examples to a real disagreement distribution.

4. **Keep the current champion unchanged** unless something unexpectedly overwhelming emerges and you can prove it with direct duplicate benchmarks. That is not the default expectation.

## Required Deliverables

Produce:

1. a **targeted disagreement miner**
2. an expanded **rare-spot corpus** focused on low-stock legal-knock positions in the medium/high-DW region
3. a **disagreement analysis report** quantifying frequency, severity, and structure
4. a clear recommendation on whether a future production test is justified
5. `EXECUTION_REPORT_63.md`

## Task A: Build a Targeted Spot Miner For The Missing Region

Phase 62’s self-play spot miner was useful, but it mostly found the states the champion naturally reaches:

- low stock
- mostly low deadwood

That is good, but insufficient for disagreement mapping.

Build a new targeted mining path that increases coverage of:

- `stock <= 5` or `<= 6`
- legal knock available
- `DW 5..10`
- especially **fragmented / multi-card deadwood** states

### Acceptable ways to do this

Use one or more of:

- larger champion self-play sample
- self-play with alternate strong bots / alternate knock policies
- solver-guided harvesting from games where legal knock was passed
- targeted state extraction from replayed games
- synthetic-but-valid perturbations of mined real states

The method does **not** have to preserve natural frequency perfectly, as long as you clearly label whether a corpus is:

- natural frequency
- oversampled for coverage
- or synthetic / perturbed

That distinction is essential.

## Task B: Run The Improved Solver Over The Expanded Corpus

Use the Phase 62 solver stack, including:

- policy-backed continuation
- empirical match-equity table
- both belief modes where useful

For each spot, record:

- current champion action
- solver-preferred action
- expected value difference between actions
- confidence / stability across belief modes if feasible
- structural metadata:
  - stock size
  - deadwood total
  - number of deadwood cards
  - fragmentation / hand-shape label
  - score context

## Task C: Cluster The Disagreements

This is the most important analytical step.

Do **not** just list example spots.
Group disagreements into recurring classes.

At minimum, analyze by:

- stock bucket
- DW bucket
- deadwood-card count
- fragmented vs concentrated hand texture
- score bucket

The goal is to answer:

- Is there one coherent disagreement class?
- Are there several?
- Does the `fragmented_dw_low_stock` spot generalize?

## Task D: Estimate Real-World Importance

You need two distinct quantities:

### 1. Conditional severity

When the champion is wrong in one of these spots, how big is the estimated value loss?

Examples:

- average expected-points loss
- average match-equity loss

### 2. Practical frequency

How often do such spots arise under strong play?

Use natural-frequency mining where possible to estimate:

- fraction of low-stock legal-knock states in the disagreement class
- fraction of all hands / games where the class appears

Even a rough estimate is useful if it is clearly labeled.

### The key output

Estimate the **aggregate cost** of the disagreement class:

- rare but large
- common but small
- rare and negligible
- common and meaningful

That is the real decision variable for whether to pursue a production override.

## Task E: Optional Targeted Validation Benchmark

Only if the disagreement class proves both:

- structurally coherent, and
- non-trivially important

then you may add one **very narrow experimental variant** for a future benchmark recommendation.

Important:

- this is optional
- do **not** promote it
- do **not** run a giant benchmark campaign unless the disagreement audit justifies it

If you do build such a variant, it should be extremely narrow and explicitly labeled as an experimental probe, for example:

- a low-stock fragmented-hand knock exception

But again: only if the audit says this class is real and meaningful.

## Required Truthfulness

In `EXECUTION_REPORT_63.md`, explicitly separate:

- **natural-frequency findings**
- **coverage-oversampled findings**
- **synthetic / perturbed findings**

This phase will be misleading if these are blended together.

Also be explicit about:

- which disagreement conclusions are solver-stable
- which remain belief-sensitive or approximation-sensitive

## Required Tests

Add tests for:

- targeted spot miner validity
- corpus labeling / metadata integrity
- disagreement analysis output shape
- clustering / bucketing correctness
- any optional experimental variant, if created

## What Not To Do

Do **not**:

- claim the champion is broadly wrong from one curated spot
- ship a new low-stock rule without frequency analysis
- treat oversampled disagreement corpora as natural-rate evidence
- abandon the solver path and revert to heuristic tuning

## Preferred Report Structure

Write `EXECUTION_REPORT_63.md` with:

1. **What corpus was built**
2. **How natural vs oversampled vs synthetic spots were separated**
3. **What disagreement classes were found**
4. **How often they occur**
5. **How costly they appear to be**
6. **Whether a future production override is justified**
7. **Best next step for the oracle roadmap**

## Success Criteria

Phase 63 is successful if, by the end, we know whether the Phase 62 disagreement is:

- a production-relevant weakness of the champion, or
- just an interesting but rare low-stock corner

That answer is much more valuable right now than prematurely editing the bot.

## Summary

Phase 62 made the solver credible enough to trust a disagreement.
Phase 63 should now determine whether that disagreement matters enough to act on.

Map the class.
Measure the frequency.
Estimate the cost.
Then decide whether a narrow production experiment is warranted.
