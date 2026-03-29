# Claude Directive 65: Undercut-Aware Belief Calibration Sprint

## Mission

Attack the dominant solver failure exposed by Phase 64:

> the solver systematically underestimates opponent undercut danger in low-stock legal-knock positions.

This phase should push the project **harder toward the gin-rummy oracle vector** by improving the solver’s belief realism, not by testing more heuristic bot overrides.

Do **not** build a new production knock heuristic in this phase.
Do **not** run another broad solver-aligned benchmark probe.

Instead, build the first explicit **opponent hand-quality / undercut-risk calibration layer** for the solver.

## Why This Is The Right Next Step

The chain is now decisive:

- **Phase 61:** first solver foundation
- **Phase 62:** solver fidelity upgrade
- **Phase 63:** disagreement class looked broad and meaningful
- **Phase 64:** direct duplicate benchmark falsified the solver’s broad low-stock knock recommendation

The key lesson from Phase 64 is not “ignore the solver.”
The key lesson is:

- the solver is missing a critical latent variable:
  **how likely the opponent already has a low-deadwood undercut-ready hand**

That is a classic imperfect-information / belief-state failure.
Fixing that is more aligned with the long-term oracle roadmap than any further heuristic knock tuning.

## Core Principle

Phase 65 is a **solver realism** phase centered on undercut calibration.

We now know the benchmark ground truth:

- broad low-stock knock recommendations lose
- the main visible mechanism is undercut punishment

So the next question is:

> Can we make the solver predict undercut danger realistically enough that its low-stock recommendations become calibrated?

That is exactly the kind of step that moves us toward an oracle.

## Hard Constraints

1. **No new production knock override.**
2. **No new benchmark probe variants** unless needed only as a tiny sanity check after solver calibration.
3. **No broad heuristic tuning.**
4. **Focus on solver belief realism and opponent hand-quality estimation.**

## Required Deliverables

Produce:

1. a large labeled **low-stock undercut dataset**
2. a **calibration audit** comparing solver-predicted undercut danger to actual outcomes
3. a first explicit **undercut-risk / opponent-deadwood estimator**
4. an improved solver path that uses that signal
5. `EXECUTION_REPORT_65.md`

## Task A: Build A Low-Stock Undercut Dataset

Mine a substantial dataset of low-stock legal-knock positions from strong self-play.

Recommended scope:

- current champion vs itself as the main natural source
- low stock region such as `stock <= 6`
- legal knock available

For each position, record at minimum:

- full public state
- hero hand
- score state
- stock size
- discard pile / visible actions
- opponent true hand (for labeling only)
- opponent true deadwood
- whether immediate hero knock would be:
  - knock win
  - undercut
  - gin
- whether the position is “undercut-ready” under exact knock scoring

The goal is to create the first trustworthy training/evaluation set for low-stock opponent hand quality.

## Task B: Measure Current Solver Calibration

Before changing the solver, quantify how wrong it currently is.

For a representative sample of the new dataset, compare:

- solver-implied undercut probability if hero knocks now
- actual undercut frequency from the true hidden hand
- solver-implied opponent deadwood distribution
- actual opponent deadwood distribution

You should report calibration by bucket, e.g.:

- stock bucket
- DW bucket
- score bucket
- hand texture bucket

This phase is most valuable if it proves exactly where the solver’s belief state is broken.

## Task C: Build A First Opponent Hand-Quality / Undercut-Risk Estimator

Create the first explicit model for low-stock opponent hand quality.

This does **not** need to be a large neural net.
A simpler calibrated model is acceptable if it is honest and useful.

Examples of acceptable outputs:

- probability opponent deadwood is `0-2`, `3-5`, `6-10`, `>10`
- probability hero would be undercut if knocking now
- expected opponent deadwood under the public state

Inputs should be public/inferable features only, such as:

- stock size
- turn number
- score state
- discard pile composition
- opponent pickups / declines if available
- public action history features
- visible card pressure / known dead cards

Use whatever modeling approach is strongest and tractable here:

- calibrated heuristic regression
- tree/boosted model
- lightweight learned classifier
- reweighting scheme for hidden-world sampling

But the model must be:

- evaluated on held-out data
- calibrated, not just accurate in ranking
- explicitly documented

## Task D: Integrate The Signal Into The Solver

Use the new undercut/deadwood model to improve solver realism.

Acceptable integration paths include:

1. **Belief reweighting**
   Reweight hidden-world samples toward opponent hands consistent with the estimated low-stock deadwood distribution.

2. **Direct undercut penalty / correction**
   Adjust knock-now evaluation using the calibrated undercut risk estimate.

3. **Hybrid**
   Reweight worlds and also surface explicit undercut-risk diagnostics.

Choose the path that gives the cleanest, most testable improvement.

## Task E: Re-run Calibration Spots

After integration, re-run a meaningful subset of:

- the canonical spots from Phases 61–62
- the Phase 63 disagreement corpus
- especially the low-stock disagreement classes that triggered the failed Phase 64 probes

The goal is **not** to prove the solver perfect.
The goal is to see whether:

- disagreement rate falls
- low-stock knock recommendations become narrower
- undercut probability predictions become better calibrated

## Required Analysis Questions

Your report must answer these directly:

1. How badly was the old solver underestimating undercut risk?
2. Does the new estimator materially improve calibration?
3. After calibration, does the solver still recommend broad low-stock knocking?
4. Which disagreement classes survive the correction?
5. Is there now a much narrower candidate class worth future gameplay testing?

## Required Truthfulness

Be explicit about:

- what labels come from exact hidden-hand truth
- what is inferred from public state
- whether the estimator is predictive vs calibrated
- whether solver improvements changed direction or only magnitude

If the new calibration still leaves the solver broadly knock-biased, say so plainly.

## What Not To Do

Do **not**:

- return to broad benchmark probes before fixing solver realism
- claim the solver is “fixed” just because calibration improves somewhat
- build a huge end-to-end neural oracle in one phase
- ship a low-stock rule from this phase alone

## Preferred Report Structure

Write `EXECUTION_REPORT_65.md` with:

1. **Dataset built**
2. **Baseline solver calibration error**
3. **New undercut / opponent-deadwood estimator**
4. **How it was integrated**
5. **Before vs after solver calibration results**
6. **Which disagreement classes remain**
7. **Best next step for the oracle roadmap**

## Success Criteria

Phase 65 is successful if, by the end, we have:

- a real undercut-risk calibration dataset
- a measurable account of how the old solver was wrong
- a first belief-aware correction layer
- a more trustworthy low-stock solver

That is the highest-force move toward the gin-rummy oracle after Phase 64.

## Summary

Phase 64 falsified the solver’s broad low-stock knock advice.
Phase 65 should not guess again.
It should fix the underlying cause:

- poor opponent hand-quality estimation
- poor undercut-risk calibration

That is the next real oracle-direction step.
