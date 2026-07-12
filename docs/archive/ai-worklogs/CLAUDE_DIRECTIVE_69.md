# Claude Directive 69: Public-State CFR Pilot Sprint

## Mission

Begin the real oracle pivot.

Phase 68 was a genuine success: `solver_v6` materially improved low-stock opponent-world realism, and the trace-rich dataset finally activated the public-action signal. But the same report also gave the limiting truth:

- the remaining gain came overwhelmingly from constructor design, not trace signal
- the surviving non-gin knock frontier is still too risky to ship from heuristic evidence alone
- more local solver retuning is now much more likely to produce diminishing returns than oracle progress

At the same time, `ORACLE_ROADMAP_ASSESSMENT.md` makes the bigger strategic case correctly:

> the next step should be an architectural pivot toward imperfect-information game solving, not another round of heuristic knock refinement.

So Phase 69 should **not** be another benchmark probe and **not** another world-constructor tuning sprint.
It should build the first honest **public-state / belief-state CFR pilot** for Gin Rummy.

---

## Why This Is The Right Next Step

The current chain says:

- **Phases 61-68:** the late-game solver foundation is now real
- **Phase 68:** low-stock world realism is close enough to ground truth to use as a serious subgame input
- **Phase 68:** trace signal is live, but not yet the main driver
- **Roadmap assessment:** the true gap to oracle level is now game-theoretic, not heuristic

The highest-force move toward the gin-rummy oracle is therefore:

1. freeze `solver_v6` as the current late-game belief reference
2. define the first bounded public-state Gin subgame
3. run a real MCCFR / CFR-style pilot on that subgame
4. measure whether this path is tractable and strategically non-trivial

This phase is about **de-risking the oracle architecture**, not squeezing another local edge out of the current champion.

---

## Core Principle

Phase 69 is a **feasibility and architecture validation** phase.

The target is not a full-game oracle and not a new production bot.
The target is proof that we can move from:

- heuristic/search decision rules

to:

- public-state abstraction
- belief-conditioned information sets
- regret-based strategy learning over hidden-information Gin subgames

If that pilot works, we have started the real oracle track.

---

## Hard Constraints

1. **Do not spend this phase on another heuristic knock policy.**
2. **Do not spend this phase mostly on more constructor retuning.**
3. **Do not treat the old discard-only CFR path as the solution.**
   It may offer reusable scaffolding, but the old local discard policy is a solved dead end.
4. **Do not claim full-game CFR.**
   This phase is a bounded pilot, not a grandiose leap.
5. **Do not let toolchain friction consume the whole phase.**
   If Rust is unavailable, do not stall the oracle pivot waiting on infrastructure alone.

---

## Required Deliverables

Produce:

1. a first **public-state / information-set schema** for a bounded Gin subgame
2. a first **belief-conditioned abstraction** grounded in the Phase 68 trace-rich data
3. a working **MCCFR / CFR pilot** on that bounded subgame
4. an honest **tractability report**:
   - info-set counts
   - memory rough order of magnitude
   - Python throughput / bottlenecks
   - whether Rust now becomes an immediate blocker
5. a comparison between the CFR pilot and the current `solver_v6` on canonical spots
6. `EXECUTION_REPORT_69.md`

---

## Task A: Audit What Transfers And What Does Not

Start by auditing the existing CFR artifacts:

- `gin_rummy/cfr_trainer.py`
- `gin_rummy/cfr_strategy.py`
- `gin_rummy/apex_cfr.py`

Explicitly separate:

- **reusable infrastructure**
  - regret table handling
  - strategy accumulation patterns
  - serialization ideas
- **non-transferable assumptions**
  - discard-only action space
  - Apex-top-K candidate abstraction
  - immediate deadwood reward proxy
  - lack of genuine hidden-information subgame traversal

The report should make clear that this phase is a new oracle-oriented CFR path, not a resurrection of the old discard CFR experiment.

---

## Task B: Define The First Bounded Public-State Gin Subgame

Build the smallest meaningful Gin subgame that is:

- genuinely imperfect-information
- grounded in real trace-rich public actions
- small enough to run MCCFR on in this repo

### Default recommendation

Use a **late-game public-state subgame** centered on low-stock legal-knock states, because:

- Phase 68 gives us the strongest current belief model there
- the world generator is now credible enough to serve as a hidden-world sampler
- the decision is strategically important
- the state space is much smaller than full-game Gin

### Public-state encoding should include at least

- stock size
- score state (`my_score`, `opp_score`)
- discard pile / top discard representation
- known opponent pickups
- known opponent discards
- decline/pass structure
- turn number / phase bucket
- legal-action context

### Belief / abstraction features should include at least

- hero deadwood bucket
- hero meld / partial-meld structure
- opponent hand-quality bucket
- opponent deadwood / readiness proxy
- opponent meld-richness / gin-liveness proxy
- public-trace intensity / certainty bucket

### Action space

At minimum the pilot must model a real strategic choice over hidden information.

My default preference is:

- `knock`
- `continue`

for the first pilot subgame.

If you can honestly include a second real decision surface without exploding the scope, that is welcome, but do not compromise the pilot just to make it bigger.

The important thing is:

> this must be a genuine imperfect-information regret problem, not another threshold fit.

---

## Task C: Build The MCCFR / CFR Pilot

Implement a real bounded pilot that:

- operates on the public-state / belief abstraction from Task B
- uses hidden-world sampling or belief-weighted world construction as the chance model
- updates regrets over the bounded action space
- accumulates average strategy
- produces non-trivial policy outputs over repeated iterations

### Minimum acceptable standard

The pilot must include:

- correct regret updates on a toy sanity-check game first
- then actual traversal on the bounded Gin subgame
- a measurable convergence signal or at least meaningful strategy stabilization

### Leaf / continuation handling

For bounded subgame continuation, it is acceptable to use:

- `solver_v6`
- existing endgame continuation simulation
- or a clearly-defined bounded rollout

But be explicit:

- what is exact
- what is sampled
- what is approximated

This phase is about architecture honesty.

---

## Task D: Measure Abstraction Size And Throughput Honestly

Do not assume the roadmap numbers are true.
Measure what you can.

On real trace-rich spots, report:

- number of unique public states encountered
- number of unique information sets after abstraction
- bucket occupancy / sparsity
- rough memory implications of the current abstraction
- Python pilot throughput:
  - iterations/sec
  - traversals/sec
  - where the hot loop time is going

The point is to answer:

> is the CFR pivot actually tractable here, and if so, where is the first real bottleneck?

---

## Task E: Compare CFR Pilot Strategy vs Solver V6

On a canonical set of bounded late-game spots, compare:

- `solver_v6` recommendation
- CFR pilot average strategy
- where they agree
- where they disagree
- whether the CFR pilot produces meaningful mixed strategies

Do not benchmark a new player broadly in this phase.
This is a **strategy / architecture comparison**, not a tournament phase.

What matters is whether the pilot shows evidence of:

- non-trivial regret learning
- strategically coherent departures from the heuristic solver
- or the opposite: collapse back into the current solver logic

Either result is valuable.

---

## Task F: Decide Whether Rust Is An Immediate Blocker

The roadmap assessment argues for a Rust core.
That may well be right.
But Phase 69 should answer it empirically, not by rhetoric.

### Required output

Explicitly conclude one of:

1. **Python is sufficient for the bounded pilot; keep architecture work in Python for now**
2. **Python is already the blocker; Phase 70 should begin Rust core foundation immediately**

Support this with actual measurements from Task D.

### Optional scoped Rust work

If, and only if, the CFR pilot is functioning and you still have time, you may do one tightly-scoped de-risking step such as:

- checking whether Rust toolchain is available
- scaffolding a minimal `gin-core` crate
- or drafting the Python/Rust boundary for cards + meld/deadwood

Do **not** let optional Rust work crowd out the actual CFR pilot.

---

## Required Truthfulness

In `EXECUTION_REPORT_69.md`, explicitly answer:

1. Is a bounded public-state CFR pilot for Gin Rummy working in practice?
2. Is the Phase 68 trace-rich dataset sufficient to support a real information-set abstraction?
3. What parts of the old CFR path transfer, and what parts are dead?
4. Does the CFR pilot produce strategic behavior that is meaningfully different from `solver_v6`?
5. Is Rust now an immediate necessity, or just the next optimization frontier?
6. What is the best next oracle-roadmap step after this pilot?

---

## What Not To Do

Do **not**:

- run another broad champion benchmark
- ship another knock heuristic
- spend the whole phase polishing `solver_v6`
- present a toy threshold learner as “CFR”
- pretend the old discard-only CFR experiment was a real oracle attempt

---

## Preferred Report Structure

Write `EXECUTION_REPORT_69.md` with:

1. **What transfers from the old CFR work**
2. **Bounded subgame definition**
3. **Public-state / information-set abstraction**
4. **MCCFR pilot design**
5. **Pilot convergence / throughput results**
6. **CFR vs solver_v6 comparison**
7. **Rust necessity assessment**
8. **Best next oracle-roadmap step**

---

## Success Criteria

Phase 69 is successful if, by the end, we have:

- the first real public-state Gin subgame definition
- a working bounded CFR/MCCFR pilot over that subgame
- honest measurements of abstraction size and Python tractability
- a clear answer on whether Rust is now the next blocker
- and a concrete bridge from the current solver stack to the actual oracle architecture

That is the strongest next push toward the gin-rummy oracle after Phase 68.

---

## Summary

Phase 68 got the late-game belief model close enough to reality to stop polishing and start pivoting.

Phase 69 should therefore do the first real oracle thing:

- define a bounded public-state Gin subgame
- run real regret minimization on it
- measure abstraction and speed honestly
- and decide whether the project is ready for the Rust-backed CFR blueprint path

That is the correct next move.
