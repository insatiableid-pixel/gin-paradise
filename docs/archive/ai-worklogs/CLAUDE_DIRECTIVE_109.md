# Directive 109 - Full-Policy Gauntlet and Symbolic Surface Prep

## Objective
Implement the **next Deep Think-aligned step after Directive 108**:

1. make the held-out gauntlet evaluate the **real `train.py` Oracle policy**,
   not a simplified proxy player, and
2. refactor `train.py` to expose a **small, explicit semantic mutation surface**
   for the first Gemini symbolic-evolution campaign.

This is the bridge from "hardened benchmark infrastructure" to "paper-aligned
LLM code evolution over constrained solver components."

## Why This Sprint
Directive 108 successfully hardened the benchmark:
- frozen multi-lane targets,
- Pareto-aware promotion,
- narrowed editable surface,
- held-out gauntlet scaffold.

But the 108 report also states the main remaining gap clearly:
- the gauntlet still uses a simplified `OracleKnockPlayer`, not the real
  `train.py` belief-world Oracle policy.

That means we are almost ready for richer symbolic evolution, but not quite.
Before Gemini starts mutating solver logic semantically, the held-out evaluator
must be judging the real policy, and the mutation surface inside `train.py`
must be more structured than "poke scalar constants."

Deep Think's advice points directly here:
- Sprint 1: harden the harness,
- Sprint 2: expose a narrow semantic code surface such as dynamic blending,
  while keeping the search space constrained.

Directive 109 should finish that transition.

## Required Deliverables

### 1. Integrate the Real `train.py` Policy into the Gauntlet

Replace or extend the current simplified gauntlet player so held-out evaluation
can execute the actual Oracle logic implemented in `train.py`.

Requirements:
- Reuse existing repo runtime pieces (`GinRummyGame`, `Player`,
  `run_balanced_matchup`, etc.) where practical.
- The gauntlet should evaluate the real belief-world / EV-estimation policy
  path from `train.py`, or a thin adapter that delegates directly to it.
- The integration must be deterministic under fixed seeds.
- Keep bounded smoke mode practical, but allow a heavier evaluation mode for
  real promotion-time or human-review runs.

The goal is that the gauntlet is no longer "proxy player vs baseline"; it is
"actual Oracle policy vs baseline."

### 2. Extract a Narrow Semantic Mutation Surface in `train.py`

Refactor `train.py` so the next Gemini campaign is not limited to scalar knob
tuning and does not require wide-file freeform edits.

At minimum, extract and document one or two narrow helper functions whose
initial behavior is **identical** to the current incumbent:

- a dynamic blend-weight surface, for example:
  - `compute_eval_weight(...)`
- and, if it fits cleanly, one confidence / risk surface, for example:
  - `compute_trace_confidence_multiplier(...)`
  - or equivalent

Requirements:
- Baseline behavior must remain equivalent to the current incumbent unless
  explicitly changed later by research experiments.
- These functions should be:
  - small,
  - self-contained,
  - easy to mutate,
  - and grounded in real state features already available in the code.
- Do **not** turn `train.py` into a giant framework or class hierarchy.
- Do **not** expose half the file; expose a small, intentional surface.

This is the first real AlphaEvolve-style step: the LLM should be able to mutate
bounded solver logic, not just constants.

### 3. Keep the Mutation Surface Constrained and Honest

Update the Oracle research prompt / docs so Gemini's next campaign is aimed at
these extracted functions, not broad file churn.

Requirements:
- `agent_prompt.md` should explicitly say the benchmark infrastructure remains
  frozen.
- It should instruct Gemini to prefer edits inside the extracted helper
  functions in `train.py`.
- It should explicitly encourage:
  - continuous mathematical operations,
  - schedules,
  - non-linear weighting logic,
  - asymmetric rules,
  - or other small semantic improvements
  instead of plain scalar retuning.
- Keep the output contract machine-parseable and tight.

### 4. Preserve the Current Incumbent Numerically

Because this sprint is about surface prep and evaluation fidelity, not yet
about winning a new experiment, preserve the incumbent's effective behavior:

- `DIRECT_EVAL_WEIGHT = 0.90`
- `CALIBRATION_MAX_WORLDS = 150`
- `CALIBRATION_FRACTION = 0.15`
- existing Pareto-aware gate
- existing frozen targets

If the refactor changes behavior accidentally, that is a bug.

### 5. Improve Gauntlet Output for Real Human Gating

Now that the gauntlet should be able to run the real policy, make its output
more useful for actual promotion review.

Requirements:
- clearly report which Oracle policy implementation was evaluated,
- include deterministic seeds / deal counts,
- keep JSON artifacts,
- and make the Markdown / console output easy to compare across runs.

You do **not** need to build full population-relative exploitability here.
Just make the gauntlet honest and usable for the next research phase.

### 6. Update Documentation and Add Root Handoff

Update:
- `oracle_autoresearch/README.md`
- `oracle_autoresearch/program.md`
- `oracle_autoresearch/agent_prompt.md`

so they clearly describe:
- real-policy gauntlet integration,
- the extracted semantic mutation surface in `train.py`,
- what is still frozen,
- and that the next Gemini campaign should target those surfaces.

Add `EXECUTION_REPORT_109.md` in the repo root describing:
- how the real policy was integrated into the gauntlet,
- what mutation surface now exists,
- how baseline behavior was preserved,
- and why the repo is now ready for the next Gemini symbolic-evolution run.

## Constraints
- Do **not** remove the frozen multi-lane benchmark architecture from 108.
- Do **not** widen the editable surface beyond `train.py`.
- Do **not** start broad symbolic evolution in this sprint; just prepare for it.
- Do **not** degrade the current incumbent while refactoring.
- Keep the mutation surface narrow and reviewable.
- Prefer a small number of explicit helper functions over broad structural churn.

## Verification
Run, at minimum:

1. `python oracle_autoresearch/prepare.py`
   - should still confirm or regenerate frozen targets cleanly

2. `python oracle_autoresearch/train.py --time-budget 60 --tag directive109_smoke`
   - should preserve baseline aggregate behavior within expected smoke variance

3. `python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 109`
   - must now run the real `train.py` policy path, not the old simplified proxy

4. `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode fallback_only --max-experiments 1 --dry-run`
   - should prove the prompt / mutation surface is ready for the next Gemini run

If the environment requires the local Python path, use the repo's existing
`.local-python\\3.14\\python.exe`.

## Completion Criteria
This sprint is complete when:
- the gauntlet evaluates the real `train.py` Oracle policy,
- `train.py` contains a small, explicit semantic mutation surface ready for LLM
  code evolution,
- docs and prompts point Gemini at that constrained surface,
- current benchmark infrastructure remains frozen,
- and the repo is genuinely ready for the **next Gemini CLI involvement**, which
  should be the first bounded symbolic-evolution campaign against these new
  helper functions.
