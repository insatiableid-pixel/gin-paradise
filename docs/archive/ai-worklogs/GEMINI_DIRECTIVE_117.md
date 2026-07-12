# Gemini Directive 117 - Pickup-Aware Belief-World Precision Sprint

## Objective
Improve the **underlying belief-world generation quality** for pickup-heavy
late-game knock decisions, because Directive 116 showed that richer symbolic
logic is now outrunning the current opponent-world model.

This is a Gemini CLI **engineering / diagnostic sprint**, not another
symbolic search block.

## Why This Is The Highest-Leverage Next Step
Directive 116 was a clean operational run:
- bridge reliability was perfect (`12/12`)
- the expanded semantic surface reached Gemini correctly
- every candidate used at least one new feature

But the modeling result was decisive:
- no promotions
- pickup-aware and turn-aware helper-function edits consistently regressed the
  knock lane slightly
- the best R5 candidates still finished below the incumbent

That pattern strongly suggests the next bottleneck is **not** “one more formula
inside the existing helper functions.”
It is the fidelity of the **belief-world generator and trace-to-world mapping**
that those helper functions are trying to trust.

The repo already shows the relevant stack:
- `oracle_autoresearch/train.py`
- `gin_rummy/belief_world_generator.py`

So the right next move is to make that layer more truthful and better
instrumented before asking Gemini to search on top of it again.

## Required Deliverables

### 1. Add a Belief-World Diagnostics Path

Create a bounded diagnostic path that lets us inspect how pickup/discard/decline
signals are actually affecting sampled opponent worlds.

Good output should include, for pickup-rich benchmark spots:
- sampled opponent deadwood distribution
- how many known pickups are forced / retained
- frequency of near-pickup supporting cards
- top weighted candidate cards before sampling
- basic comparison between generic trace count and pickup-specific pressure

This can be implemented as a small script or utility under
`oracle_autoresearch/` as long as it is easy to rerun and produces a saved
artifact or readable summary.

### 2. Tighten Pickup-Aware Belief-World Generation

Improve the underlying opponent-world generation path in a **bounded** way.

Target areas:
- `gin_rummy/belief_world_generator.py`
- `oracle_autoresearch/train.py`

Good candidates:
- make pickup effects more semantically distinct from generic trace events
- refine how pickup-known cards interact with nearby supporting cards
- ensure pickup pressure improves world plausibility without double-counting
  danger in a way that overwhelms knock calibration
- preserve incumbent-like behavior on low-trace / no-pickup spots

Do **not** rewrite the whole solver.
Do **not** replace the two-stage world-generation design.
Keep this reviewable and local.

### 3. Expose One Small New Mutation Surface If Helpful

If the cleanest solution is to expose one new bounded helper for later search,
do so.

Examples:
- a pickup-pressure weighting helper
- a world-sampling confidence helper
- a small public-trace-to-weight schedule

Requirements:
- keep it narrow
- preserve existing behavior by default
- do not open a giant new search surface

The goal is to set up the **next** symbolic campaign on a better foundation,
not to restart broad unconstrained tuning.

### 4. Keep the Benchmark Infrastructure Frozen

Do **not** change:
- frozen targets
- lane weights
- Pareto gate logic
- promotion margin
- benchmark lane definitions

Do **not** increase eval set size or rebuild targets in this sprint.
We want to isolate whether better world-generation fidelity improves the current
policy path before we touch measurement.

### 5. Update Docs / Prompt for the New Frontier

Update, as needed:
- `oracle_autoresearch/agent_prompt.md`
- `oracle_autoresearch/program.md`
- `oracle_autoresearch/README.md`

They should now reflect that:
- the current incumbent is still `gemini_gcli_0073` at `0.8010`
- the expanded helper-function surface has been explored through R5
- the next frontier is pickup-aware belief-world quality, not generic
  turn-number churn
- any new bounded mutation surface is documented clearly

### 6. Preserve the Report-Naming Rule

Because this directive is:
- `GEMINI_DIRECTIVE_117.md`

the root handoff **must** be:
- `EXECUTION_REPORT_117.md`

Also keep:
- `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`

## Constraints
- Do **not** run another 12-experiment symbolic campaign in this sprint.
- Do **not** widen the editable surface recklessly.
- Do **not** touch unrelated multiplayer, app, or UI code.
- Do **not** use benchmark changes as a shortcut.
- Prefer a small diagnostic + small world-generation improvement over a large
  speculative rewrite.

## Verification
Run, at minimum:

1. `python oracle_autoresearch/train.py --time-budget 60 --tag directive117_smoke`
   - baseline path still works after belief-world changes

2. `python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 117`
   - real-policy path still works

3. Run the new belief-world diagnostic on at least one pickup-rich spot cohort
   and save/report the output

4. `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode bridge_only --max-experiments 1 --dry-run`
   - prompt and mutation surface remain coherent for the next campaign

Use the repo-local Python if needed:
- `.local-python\\3.14\\python.exe`

## Expected Output
Write a root handoff at:
- `EXECUTION_REPORT_117.md`

That report must include:
- what diagnostics were added
- what the diagnostics revealed about pickup-aware world generation
- exactly what bounded changes were made
- whether a new mutation surface was added
- whether the repo is now ready for the next Gemini symbolic campaign

## Success Criteria
This sprint is successful if:

1. We gain a clearer, inspectable picture of how pickup signals shape sampled
   opponent worlds, and
2. The belief-world generator becomes more semantically aligned with the public
   trace signals the Oracle is already trying to use, without breaking the
   frozen benchmark structure.
