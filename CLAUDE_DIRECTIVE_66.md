# Claude Directive 66: Belief-Weighted World Generation Sprint

## Mission

Push the project harder in the true **gin-rummy oracle direction** by replacing the solver’s weakest structural assumption:

> uniform hidden-world generation for the opponent hand in low-stock positions.

Phase 65 proved that this is the core defect:

- the old solver estimated opponent mean deadwood at ~28 when reality was ~3
- it underestimated undercut risk by ~57 percentage points
- a simple public-feature estimator materially improved solver behavior

That means the next highest-force oracle move is **not** another benchmark probe and **not** another knock heuristic.
It is to build the first real **belief-weighted opponent range / hidden-world generator** for the solver.

## Why This Is The Right Next Step

The recent chain is now very clear:

- **Phase 64:** broad solver-aligned low-stock knock probes failed badly in real matches
- **Phase 65:** we isolated why — the solver’s belief model is catastrophically wrong about opponent hand quality
- **Phase 65:** a simple undercut-risk estimator already made the solver meaningfully more selective

So the strongest oracle-direction step is to fix the belief layer itself.

This phase should move the solver from:

- “sample any legal hidden world almost uniformly”

toward:

- “sample opponent worlds that actually look like the kinds of hands a patient strong bot reaches in low-stock positions”

That is a foundational imperfect-information upgrade, not a local heuristic patch.

## Core Principle

Phase 66 is a **belief-state realism** phase.

The target deliverable is a new solver path whose hidden-world generator is informed by:

- opponent deadwood priors
- public action history
- card-level likelihood cues
- existing undercut calibration knowledge

This is closer to an actual oracle-track engine than another knock-rule benchmark.

## Hard Constraints

1. **Do not build or ship a new production knock override in this phase.**
2. **Do not run another broad low-stock benchmark probe.**
3. **Do not keep the uniform world generator as the default for serious low-stock analysis** if the new generator outperforms it.
4. **Do not overstate the new belief model as “solved.”**

## Required Deliverables

Produce:

1. a new **belief-weighted hidden-world generator**
2. a new solver path using that generator (e.g. `solver_v4`)
3. a calibration comparison against Phase 62 / Phase 65 solver variants
4. a clear report on whether the surviving low-stock knock recommendations become narrower and more trustworthy
5. `EXECUTION_REPORT_66.md`

## Task A: Build A Belief-Weighted Opponent Range Model

Replace the low-stock uniform hidden-world sampling with a weighted model for opponent hands.

This should use only public / inferable information.

### Required ingredients

At minimum, incorporate:

- the Phase 65 undercut / opponent-deadwood estimator
- score state
- stock size
- discard pile composition
- turn number
- hero hand summary features

### Strongly preferred

Also incorporate real **public action history**:

- opponent pickups from discard
- declines of visible discard
- opponent discards by rank / suit / structure
- any existing information already available in `opponent_model.py`

If `opponent_model.py` can be reused meaningfully, do it.
This is exactly the kind of phase where that module should start mattering.

## Task B: Generate Worlds Consistent With Both Card Likelihood And Deadwood Quality

The new hidden-world generator should not merely weight individual cards independently.
It should also try to produce opponent hands whose **overall quality** matches what we now know about late-game play.

That means the sampling procedure should, in some form, respect:

- predicted opponent deadwood bucket or mean deadwood
- card-level compatibility with public evidence
- legal consistency with all visible information

Acceptable approaches include:

1. **Weighted sampling + rejection**
   Sample candidate opponent hands with card weights, reject or reweight hands whose deadwood profile is implausible.

2. **Two-stage sampling**
   First sample a target deadwood bucket / hand-quality class, then sample a legal hand consistent with that class.

3. **Importance weighting**
   Generate many legal worlds and reweight them by both card-likelihood and hand-quality likelihood.

Choose the cleanest and most testable approach.

## Task C: Build Solver V4 On Top Of The New Belief Generator

Create a new solver path that uses the belief-weighted world generator by default in low-stock analysis.

This solver should be comparable directly against:

- Phase 62 solver (`solver_v2`)
- Phase 65 solver (`solver_v3`)

The point is not just to add code, but to show measurable belief realism gains.

## Task D: Quantify Calibration Improvement

This is the core evaluation.

On held-out low-stock legal-knock positions, compare v2, v3, and v4 on:

- predicted undercut rate vs actual undercut rate
- mean opponent deadwood prediction vs actual
- calibration by risk bucket
- any ranking metric like AUC if relevant
- action recommendation shift (`knock` vs `continue`)

The report should clearly answer:

1. How much does v4 reduce undercut-rate bias?
2. How much does v4 reduce opponent-deadwood bias?
3. Does v4 improve over v3 materially, or only slightly?

## Task E: Re-evaluate Surviving Knock Recommendations

Use v4 to revisit the low-stock spots where v3 still recommended knock.

The goal is to see whether the recommendation set becomes:

- much narrower
- more coherent
- and more believable

Specifically, identify whether the surviving v4 knock spots cluster around:

- gin / trivial spots
- clinch-adjacent spots
- DW=1 / very low-risk spots
- or still broad low-stock regions

That tells us whether we are finally approaching a trustworthy solver recommendation frontier.

## Optional Task F: Tiny Validation Probe

Only if v4 produces a **very narrow and clearly different** surviving knock class, you may run one tiny benchmark sanity check on that exact class.

Important:

- this is optional
- it must be narrow
- it must not become another broad benchmark phase

If the solver remains broad or ambiguous, skip this and report that more solver realism is still needed.

## Required Truthfulness

In `EXECUTION_REPORT_66.md`, explicitly separate:

- what is driven by the undercut estimator
- what is driven by public action history
- what is driven by card-level likelihood weighting
- what remains heuristic in the world generator

Also say plainly whether v4 is:

- a major belief improvement
- a modest improvement
- or not enough better than v3 to matter

## What Not To Do

Do **not**:

- return to uniform low-stock sampling as if nothing happened
- add new handcrafted knock thresholds
- spend the phase mostly on benchmark probes
- claim the new generator is an oracle-range model if it is still heavily heuristic

## Preferred Report Structure

Write `EXECUTION_REPORT_66.md` with:

1. **What new belief-weighted generator was built**
2. **How public action history and hand-quality priors were incorporated**
3. **Calibration comparison: v2 vs v3 vs v4**
4. **Opponent deadwood prediction improvement**
5. **How the surviving knock frontier changed**
6. **Whether a narrow benchmark target now exists**
7. **Best next step on the oracle roadmap**

## Success Criteria

Phase 66 is successful if, by the end, we have:

- a materially better low-stock belief model
- a world generator that no longer imagines opponents with absurdly high deadwood
- a solver whose remaining knock recommendations are narrower and more trustworthy

That is the highest-force oracle-direction move after Phase 65.

## Summary

Phase 65 proved the solver’s belief model was the real problem.
Phase 66 should now replace that weak belief layer with a belief-weighted world generator grounded in:

- public state
- opponent action history
- hand-quality priors
- undercut calibration

That is the next real step toward a gin-rummy oracle.
