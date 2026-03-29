# Claude Directive 70: CFR Convergence and Policy Validation Sprint

## Mission

Take the working Phase 69 public-state CFR pilot from **proof of feasibility** to **first serious policy candidate**.

Phase 69 proved the architectural pivot is real:

- bounded imperfect-information MCCFR works in this repo
- the public-state / belief abstraction is viable
- Python is fast enough for pilot-scale work
- the old discard-CFR path is dead
- the new pilot produces genuine mixed strategies and real strategic divergence from `solver_v6`

But Phase 69 also left the key open question unresolved:

> is the current CFR policy divergence meaningful progress, or just early knock-heavy noise from partial convergence and approximate continuation values?

So Phase 70 should **not** widen the game yet and **not** jump to Rust yet.
It should first answer, rigorously, whether the bounded low-stock CFR policy becomes trustworthy when trained harder and evaluated properly.

---

## Why This Is The Right Next Step

The current evidence says:

- **Phase 68:** low-stock belief modeling is now close enough to reality to support subgame solving
- **Phase 69:** CFR on that bounded subgame is tractable and non-trivial
- **Phase 69:** the pilot is still early (3,000 iterations, exploitability proxy 0.473, knock-heavy skew)

That means the highest-force oracle move is:

1. push the current bounded CFR pilot toward deeper convergence
2. measure whether its strategy stabilizes
3. test whether its learned policy beats or at least matches `solver_v6` on held-out action quality
4. only then decide whether to widen the action space

This is the honest bridge from “architecture works” to “architecture produces better play.”

---

## Core Principle

Phase 70 is a **convergence and validation** phase.

The target is not another feasibility demo.
The target is not yet a full multi-surface blueprint.
The target is:

- a harder-trained knock/continue CFR policy
- better understanding of abstraction quality
- and a clear answer on whether this bounded CFR path deserves to expand

---

## Hard Constraints

1. **Do not jump to Rust in this phase unless you discover a true blocker.**
   Phase 69 explicitly said Python is sufficient at current scope.
2. **Do not widen to draw/discard surfaces yet unless the bounded knock CFR validates strongly.**
   We should not build on an untrusted policy.
3. **Do not benchmark a half-converged policy broadly and overinterpret it.**
4. **Do not replace `solver_v6` blindly.**
5. **Do not spend the phase inventing new heuristic knock rules.**

---

## Required Deliverables

Produce:

1. a **longer-run CFR training sweep** for the current bounded subgame
2. at least one **abstraction refinement sweep**
3. a **held-out action-quality comparison** between CFR and `solver_v6`
4. a **research-only live policy integration** for bounded low-stock knock decisions
5. an honest decision on:
   - expand the action space next
   - or fix abstraction / leaf values first
6. `EXECUTION_REPORT_70.md`

---

## Task A: Push The Current Pilot Toward Real Convergence

Run materially longer training on the existing bounded low-stock knock/continue subgame.

### Minimum recommendation

Use checkpoints such as:

- 3K
- 10K
- 25K
- 50K
- optionally 100K if runtime remains reasonable

At each checkpoint, report:

- exploitability proxy
- number of active info sets
- mean knock probability
- mixed-strategy rate
- stability of average strategy

The key question is:

> does the pilot keep improving, or does it settle into a clearly wrong knock-heavy regime?

---

## Task B: Refine The Abstraction Based On Actual Occupancy

Phase 69 showed the current abstraction is extremely sparse:

- 331 observed info sets
- 12M theoretical cross-product
- 40% singleton info sets

That means the next lever is not raw memory, but better bucket design.

Test at least one thoughtful refinement, for example:

- coarsen a weak / low-signal dimension
- refine a strong / decision-critical dimension such as hero DW or opponent readiness
- rebalance trace-related buckets if they are too sparse

Do not brute-force many variants.
Try a small number of deliberate alternatives and report:

- coverage
- singleton rate
- exploitability trend
- policy stability

The aim is to discover whether the current knock-heavy skew is partly an abstraction artifact.

---

## Task C: Evaluate CFR Policy Quality On Held-Out Spots

This is the most important task.

On a held-out set of low-stock legal-knock spots, compare:

- CFR average strategy
- `solver_v6`
- actual realized outcome from the dataset when available

But do not stop at action agreement.
Measure action quality more directly.

### At minimum, report

- CFR vs `solver_v6` agreement rate
- CFR vs `solver_v6` knock rate
- outcome breakdown on disagreement spots
- whether disagreement spots systematically favor one method

### Preferred stronger evaluation

For each held-out spot, estimate the value of:

- `knock`
- `continue`

using the same hidden-world / continuation machinery for both policies, then compare:

- action chosen by CFR
- action chosen by `solver_v6`
- estimated best action under the evaluation setup

The question is not “is CFR different?”
It is:

> is CFR becoming a better decision-maker than the current deterministic solver in this bounded domain?

---

## Task D: Build A Research-Only CFR-Guided Low-Stock Knock Bot

If the longer-run CFR strategy becomes at least moderately credible, integrate it into a research bot that:

- uses the current champion stack everywhere else
- but in covered low-stock legal-knock states, consults the learned CFR policy

This bot is **research-only**, not a promoted champion candidate.

### Important

Preserve the bounded scope:

- only in the pilot-covered state family
- no broad action-surface changes
- no claim of full oracle play

You may test:

- stochastic play from the learned mixed strategy
- deterministic proxy (for example, knock if `p(knock)` exceeds a threshold)

But be explicit which you used and why.

---

## Task E: Run Narrow, Honest Validation

Do not do a massive broad benchmark yet.
Instead use a staged validation:

1. **Spot-level validation** first
2. **Targeted low-stock live-play probe** second, only if spot-level results justify it

If you run live-play validation, keep it narrow and research-oriented:

- compare the CFR-guided research bot against the current `solver_v6`-style bounded policy
- report low-stock knock frequency, undercut rate, gin rate, and win rate in the triggered region
- only run a broader duplicate benchmark if the bounded policy clearly looks promising

---

## Task F: Decide The Next Oracle Pivot Honestly

By the end of the phase, make a clear recommendation:

1. **Expand to a second decision surface next**
   for example draw-source choice

or

2. **Keep the scope bounded and improve abstraction / continuation values**

or

3. **Move to Rust sooner than expected**
   only if training throughput or rollout cost becomes the real blocker

This recommendation should come from evidence, not roadmap momentum alone.

---

## Required Truthfulness

In `EXECUTION_REPORT_70.md`, explicitly answer:

1. Does the bounded knock/continue CFR policy continue to improve with more iterations?
2. Does the knock-heavy bias shrink, persist, or worsen?
3. Did abstraction refinement help?
4. On held-out spots, is CFR now better than `solver_v6`, worse, or still unclear?
5. Is a bounded CFR-guided live policy promising enough to justify expansion?
6. What is the best next oracle-roadmap step after Phase 70?

---

## What Not To Do

Do **not**:

- widen to draw/discard just because the roadmap says so
- broad-benchmark a clearly unconverged policy
- start Rust work without evidence of a real blocker
- overclaim mixed strategies as proof of correctness
- turn this into another heuristic knock sprint

---

## Preferred Report Structure

Write `EXECUTION_REPORT_70.md` with:

1. **Long-run convergence sweep**
2. **Abstraction refinement comparison**
3. **Held-out CFR vs solver_v6 action-quality study**
4. **Research-bot integration and narrow live validation**
5. **Whether bounded CFR is now trustworthy**
6. **Best next oracle-roadmap step**

---

## Success Criteria

Phase 70 is successful if, by the end, we have:

- a materially better-trained bounded CFR policy
- clearer evidence on convergence and stability
- a grounded answer on whether CFR is actually outperforming `solver_v6` in this subgame
- and a justified decision on whether to expand the action space next

That is the strongest next move toward the gin-rummy oracle after Phase 69.

---

## Summary

Phase 69 proved the bounded CFR architecture works.

Phase 70 should now answer the harder and more important question:

- if we train it longer and validate it honestly,
- does bounded public-state CFR actually become a better low-stock decision-maker than the current solver?

If yes, we expand.
If no, we fix the abstraction or leaf values before scaling.
