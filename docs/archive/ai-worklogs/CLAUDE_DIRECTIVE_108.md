# Directive 108 - Oracle Ground-Truth Harness Hardening

## Objective
Implement the **next Deep Think-aligned step after Directive 107**: keep the
new multi-lane Oracle architecture, but harden it into a true Sprint 1
infrastructure layer by freezing stronger lane targets, separating
optimization-time proxy measurement from promotion-time gating, and narrowing
the evolvable surface back down before richer symbolic evolution begins.

## Why This Sprint
Directive 107 successfully moved `oracle_autoresearch` from a single narrow
knock-only sandbox into a broader multi-lane proxy benchmark with:
- a shared Gin Rummy abstraction layer,
- three decision lanes (`knock`, `draw`, `discard`),
- and an aggregate score.

That was the right strategic direction.

However, the Deep Think guidance says the next move should **not** yet be
"evolve everything." It should be to make the benchmark more paper-aligned and
harder to game:

1. proxy labels should be stronger and more frozen,
2. optimization-time proxy metrics should be clearly separated from final
   promotion-time checks,
3. the editable surface should stay constrained,
4. and promotion should become Pareto-aware across lanes instead of relying on
   a single weighted scalar alone.

In other words: keep the broader harness from 107, but turn it into a more
honest AlphaEvolve-style research substrate before we ask Gemini to mutate more
expressive solver logic.

## Required Deliverables

### 1. Freeze Stronger Per-Lane Reference Targets in `prepare.py`

Extend the current Oracle data-prep pipeline so lane truth is generated
**offline** and stored in stable artifacts, instead of being recomputed inside
candidate evaluation.

Requirements:
- Keep the existing train/eval split and base dataset intact.
- Generate frozen per-lane target artifacts for at least:
  - knock lane,
  - draw lane,
  - discard lane.
- Each target record should include, where practical:
  - target action,
  - per-action target scores / EV-like values / regret-like values,
  - metadata explaining the target provenance.
- Use the strongest repo-grounded reference available for each lane:
  - `solver_v6`,
  - `endgame_solver`,
  - `belief_world_generator`,
  - continuation policies,
  - and any other already-existing oracle machinery that improves truth quality.
- Use stable random seeds so the targets are deterministic.

If exact `solver_v6` style oracle truth is infeasible for a lane, document the
best stronger approximation you implemented and why.

### 2. Refactor the Multi-Lane Benchmark to Consume Frozen Targets

Update the multi-lane benchmark so candidate evaluation loads frozen targets
from artifacts produced by `prepare.py`.

Requirements:
- Candidate evaluation should **not** recompute lane truth online.
- The benchmark should become a consumer of frozen labels / target values.
- Per-lane metrics should be reproducible from one candidate run to the next.
- Keep the 107 lane structure unless a correctness issue requires a small fix.

### 3. Move the Proxy Metrics Closer to "Oracle Distance"

Deep Think advised that optimization-time proxy metrics should look more like
distance to stronger oracle targets, not just simple local heuristics.

Implement that where feasible:
- keep action accuracy where useful,
- but add target-distance style terms such as:
  - EV gap,
  - regret gap,
  - score distance,
  - or probability / preference distance,
depending on what each lane can support honestly from repo evidence.

The result should be:
- lane metrics that are more informative than raw accuracy alone,
- still fast enough for iterative research,
- and clearly documented.

### 4. Upgrade Promotion Logic to Pareto-Aware Multi-Lane Gating

Refactor `agent_loop.py` promotion logic so promotion is no longer "aggregate
score only."

Requirements:
- Candidate must still beat the incumbent aggregate score by a configurable
  margin.
- Also require that no single lane regresses by more than a small configurable
  epsilon.
- Log:
  - aggregate delta,
  - per-lane scores,
  - per-lane deltas,
  - and the exact reason a candidate was kept or discarded.
- Preserve the overall keep/discard workflow and incumbent restoration logic.

This should be an honest Pareto-style gate, not a cosmetic log message.

### 5. Add a Held-Out Full-Game Evaluation Scaffold

Deep Think recommended a final held-out bot-vs-bot gate, separate from the
proxy benchmark.

Implement a **bounded scaffold** for that now.

Requirements:
- Add a held-out evaluation entrypoint, for example:
  - `oracle_autoresearch/gauntlet_eval.py`
  - or equivalent.
- Use repo-evidenced game runtime pieces such as `rust_bridge` where practical.
- Make it able to run the current Oracle against a frozen baseline set in a
  deterministic way.
- Keep the production-scale version configurable, but verification can use a
  smaller bounded smoke size.

Minimum acceptable outcome:
- the gauntlet scaffold exists,
- can be run deterministically,
- and is documented as a promotion-time or post-promotion check.

You do **not** need to build the final perfect population-relative exploitability
system in this sprint, but you must create the real scaffold now.

### 6. Narrow the Editable Research Surface Back Down

Directive 107 broadened the editing surface to include benchmark files. Deep
Think's advice says the next move should keep the benchmark infrastructure
frozen and constrained.

Update the Oracle lab docs and prompts so that after this sprint:
- benchmark and harness files are frozen by default,
- the primary agent-editable surface returns to `train.py`,
- and the prompt clearly distinguishes:
  - fixed benchmark infrastructure,
  - evolvable solver logic.

If one small helper file must remain editable for legitimate solver logic,
document that clearly, but keep the surface narrow.

### 7. Update Documentation and Add Root Handoff

Update:
- `oracle_autoresearch/README.md`
- `oracle_autoresearch/program.md`
- `oracle_autoresearch/agent_prompt.md`

so they clearly describe:
- frozen multi-lane targets,
- proxy-vs-promotion-time evaluation,
- Pareto-aware promotion,
- and the narrowed editable surface.

Add `EXECUTION_REPORT_108.md` in the repo root describing:
- what changed from 107,
- what was frozen,
- what promotion gate now exists,
- what gauntlet scaffold now exists,
- and what remains for the next symbolic-evolution sprint.

## Constraints
- Do **not** remove the multi-lane architecture added in 107.
- Do **not** collapse back to a knock-only benchmark.
- Do **not** jump yet to dynamic blending schedules, VAD-style regret mutation,
  or wide symbolic search surfaces in this sprint.
- Do **not** leave lane truth as online recomputation if it can be frozen
  offline.
- Do **not** widen the editable surface beyond what is needed for the solver.
- Keep the current incumbent behavior as the starting baseline:
  - `DIRECT_EVAL_WEIGHT = 0.90`
  - `CALIBRATION_MAX_WORLDS = 150`
  - `CALIBRATION_FRACTION = 0.15`

## Verification
Run, at minimum:

1. `python oracle_autoresearch/prepare.py`
   - must regenerate or confirm frozen per-lane target artifacts

2. `python oracle_autoresearch/train.py --time-budget 60 --tag directive108_smoke`
   - must report multi-lane results using frozen targets

3. `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode fallback_only --max-experiments 1 --dry-run`
   - must show the new promotion / logging path still works

4. Run the held-out gauntlet scaffold in a bounded smoke mode
   - document the exact command used
   - keep it deterministic and practical

If the environment requires the local Python path, use the repo's existing
`.local-python\\3.14\\python.exe`.

## Completion Criteria
This sprint is complete when:
- the 107 multi-lane harness has frozen stronger per-lane targets,
- lane evaluation consumes those frozen targets,
- promotion is Pareto-aware across lanes,
- a real held-out gauntlet scaffold exists,
- docs clearly distinguish fixed benchmark infrastructure from evolvable solver
  logic,
- and the repo is ready for the *next* Deep Think-aligned sprint, which should
  focus on richer symbolic evolution over a narrow, well-frozen solver surface.
