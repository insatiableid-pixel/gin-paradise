# Claude Directive 61: Representative Subgame Solver Foundation Sprint

## Mission

Begin the real **oracle-track pivot**.

Phase 60 was the decisive negative result: the Phase 59 knock frontier was descriptively real, but **compact heuristic integration failed in full duplicate matches**. The engine is no longer bottlenecked by missing threshold rules. It is bottlenecked by the absence of a trustworthy mathematical apparatus for evaluating imperfect-information decisions in **match context**.

So Phase 61 should **not** produce another handcrafted knock variant.

Instead, build the first usable **representative subgame solver foundation** for Gin Rummy, with the immediate goal of creating a small, trustworthy research tool that can answer high-leverage decisions more honestly than our current deadwood- and policy-proxy stack.

This phase is the first deliberate step toward the long-term target:

- a robust, hard-to-exploit default engine
- a mathematically grounded analysis engine
- eventually, the closest thing to **eXtreme Gammon for Gin Rummy**

## Why This Is The Right Next Step

The recent sequence is now clear:

- **Phase 57:** `ApexMCTSClinchOnlyGoGin` became champion because patience plugged undercut leaks.
- **Phase 58:** opening `DW=9` is not a universal knock; the decision depends on structure and liveness.
- **Phase 59:** the early knock choice is a real frontier over gin liveness / deadwood structure.
- **Phase 60:** translating that frontier into compact heuristic rules lost to the champion in real matches.

That means:

1. the descriptive frontier work was useful,
2. but **manual frontier rule engineering is now a local maximum**,
3. and the next leap must come from **subgame solving / belief-state / value-grounded evaluation**, not another threshold.

The right question is no longer:

- “What extra heuristic knock rule should we add?”

The right question is:

- “How do we build the first small solver that can evaluate a Gin subgame in a way that is closer to true match-winning EV?”

## Core Phase 61 Principle

Treat this as **research infrastructure**, not a shipping-bot sprint.

The default expectation is:

- **no new production champion**
- **no new heuristic knock family**
- **no more static gin-probability threshold tuning**

The deliverable is a new **solver-grade tool** plus a small solved-spot corpus and a clear report on what it teaches us.

## Required Deliverable

Build the first version of a **representative subgame solver** centered on **knock-critical endgames / small-stock situations**, because those are the most tractable places to get mathematically meaningful answers first.

### Phase 61 should produce all of the following:

1. A new research module for **subgame / endgame solving**
2. A small **belief-state / hidden-world construction layer** rooted in public information
3. A small library of **canonical critical spots** in a machine-readable format
4. A way to compare:
   - `knock now`
   - `continue`
   - and, where needed, the resulting continuation values / outcome distributions
5. A report that states plainly what the solver found and how it differs from the current champion

## Scope: Start Where Exactness Is Plausible

Do **not** try to solve full Gin from the opening.

Start with **low-stock representative subgames**, where exact or near-exact reasoning is much more plausible.

Recommended initial scope:

- `deck_remaining <= 6` or `<= 8`
- legal knock available
- a small set of curated public states
- both players still using bounded action spaces if necessary

If exact solving to the end of the hand is feasible at this stock depth, do it.
If not, implement the strongest bounded approximation you can, but be explicit about every approximation.

## Architectural Requirements

### 1. Public-State First

The solver must be organized around **public state**, not only around the hero’s full hand.

At minimum, the public state representation should include:

- discard pile / upcard state
- turn number
- stock size
- visible pickups / declines if available
- current score
- any other already-available public action history that affects inference

### 2. Belief-State Foundation

You do **not** need a full neural belief model yet.
You **do** need a first honest belief-state layer.

Implement a first-pass hidden-world generator / opponent-hand distribution that is:

- consistent with visible cards
- consistent with known public action constraints where feasible
- explicit about what it is and is not modeling

Uniform consistency over legal hidden worlds is acceptable as a first version.
A lightly informed belief model is better if it is still honest and testable.

But do **not** pretend the solver is oracle-grade if the belief assumptions are crude.

### 3. Solve Outcomes, Not Just Deadwood

The solver must not reduce the decision to expected deadwood alone.

It should return, at minimum, some combination of:

- expected hand points
- gin frequency
- knock-win frequency
- undercut frequency
- wall / no-knock outcomes
- post-hand score transitions

If feasible, add a simple score-aware wrapper that maps these outcomes into a **match-context evaluation** rather than just raw hand points.

If full match-win probability is not yet feasible, then produce the **full hand-outcome distribution** cleanly so that future match-equity wrappers can sit on top of it.

That is still much better than a single deadwood scalar.

## Concrete Phase 61 Tasks

### Task A: Build the First Solver Core

Create a new module, e.g. something in the spirit of:

- `gin_rummy/subgame_solver.py`
- or `gin_rummy/endgame_solver.py`

It should be able to:

- accept a curated public state + hero hand + score state
- generate legal hidden worlds consistent with public information
- compare at least `knock now` vs `continue`
- evaluate the remainder of the hand with as much exactness as the small-stock scope allows

If you need to keep the continuation policy bounded for tractability, say so explicitly.

### Task B: Build a Canonical Spot Format

Create a small machine-readable critical-spot corpus, e.g. JSON or Python data definitions, for a handful of canonical subgames.

The first corpus should include at least:

1. **Low-stock legal knock, one-card DW, gin-live**
2. **Low-stock legal knock, multi-card fragmented DW**
3. **Low-stock legal knock, undercut-risk-heavy shape**
4. **At least one score-sensitive spot**
   - e.g. near-clinch or clearly behind

You may add one or two opening / early-turn spots for future study, but the primary solved set should stay in the tractable low-stock region.

### Task C: Compare Solver Output to Current Champion

For each canonical spot:

- record what the current champion would do
- record what the solver prefers
- quantify the difference

The goal is not yet to ship a fix.
The goal is to identify where the champion is obviously wrong, where it is already strong, and where the solver still lacks confidence.

### Task D: Add Test Coverage

Add real tests for:

- spot loading / validation
- hidden-world generation consistency
- solver determinism or reproducibility where appropriate
- action comparison output shape
- at least one or two sanity checks on known dominant-action scenarios

Examples:

- gin should always knock
- immediate match-clinch should always knock
- illegal knock states must be rejected cleanly

## What Not To Do

### Do not:

- build another heuristic knock family
- write more gin-probability threshold rules
- claim that Phase 60 means “knock is solved”
- pivot back to discard-model tuning or action-model imitation
- attempt a full-game solver in one phase
- call a sampled deadwood rollout an oracle

### Also do not:

- overstate exactness if the belief model is still crude
- confuse “beats ApexMCTS” with “approaches correct play”

## Required Truthfulness

Be explicit in `EXECUTION_REPORT_61.md` about:

1. **What is exact**
2. **What is sampled**
3. **What is belief-dependent**
4. **What is still policy-dependent**
5. **What the solver can and cannot conclude yet**

This phase is valuable only if it is honest.

## Preferred Evaluation Standard

The main success criterion is **not** a new benchmark champion.

The main success criterion is:

- we now possess a small but real **solver-grade research instrument**
- we can analyze some Gin spots in terms richer than deadwood
- we can start building a corpus of **ground-truth or near-ground-truth critical situations**

If you can produce a tiny exact or near-exact endgame solver that already shows specific disagreements with `ApexMCTSClinchOnlyGoGin`, that is a successful Phase 61 even if nothing gets promoted.

## Stretch Goal

If the core solver lands cleanly, add one lightweight bridge toward the longer-term oracle path:

- a first match-equity wrapper over hand-outcome distributions, or
- a first belief-state feature extractor that can later feed a learned value model

This is optional. The core deliverable is the solver foundation.

## Final Report Requirements

Write `EXECUTION_REPORT_61.md` with:

1. what you built
2. what class of spots it can evaluate
3. what approximations it uses
4. the canonical spot results
5. where the current champion agrees or disagrees
6. the best next step toward the oracle roadmap

## Summary

Phase 60 told us something important:

> The frontier exists, but heuristic integration is not enough.

Phase 61 should therefore stop chasing another local policy patch and start building the first real **oracle foundation**:

- representative subgame solving
- public-state / belief-state reasoning
- richer outcome evaluation
- and a reusable critical-spot corpus

That is the correct next step toward a genuine XG-track Gin engine.
