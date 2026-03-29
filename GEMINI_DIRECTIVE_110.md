# Gemini Directive 110 - First Bounded Symbolic-Evolution Campaign

## Objective
Run the **first bounded Gemini CLI symbolic-evolution campaign** against the
new semantic mutation surfaces prepared by Directive 109.

This campaign should target only the two extracted helper functions in
`oracle_autoresearch/train.py`:

- `compute_eval_weight(...)`
- `compute_trace_confidence_multiplier(...)`

The benchmark infrastructure is now frozen and ready. This is the point where
Gemini CLI becomes the active research worker.

## Why This Is The Right Moment
Directive 109 completed the final preconditions:
- frozen multi-lane targets are in place,
- Pareto-aware promotion is in place,
- the held-out gauntlet now evaluates the **real** `train.py` policy,
- and the semantic mutation surface inside `train.py` is explicit and narrow.

Do **not** spend another Claude cycle on more infrastructure first. The repo is
ready for the first real bounded semantic-evolution run.

## What To Read First
Read these files before launching the run:

- `oracle_autoresearch/README.md`
- `oracle_autoresearch/program.md`
- `oracle_autoresearch/agent_prompt.md`
- `EXECUTION_REPORT_108.md`
- `EXECUTION_REPORT_109.md`
- `oracle_autoresearch/loop_state.json`

Confirm from the files that:
- benchmark infrastructure is frozen,
- `train.py` is the only editable file,
- the primary mutation surfaces are
  `compute_eval_weight()` and `compute_trace_confidence_multiplier()`,
- and the current incumbent is still `gemini_gcli_0025`.

## Campaign Instructions

### 1. Run a bounded symbolic-evolution block

Launch:

```powershell
.\oracle_autoresearch\run_gemini_loop.ps1 -MaxExperiments 12
```

Use Gemini CLI's auto-selected model. Do **not** pin an old model.

### 2. Mutation focus

The campaign should strongly prefer **semantic** edits inside the two helper
functions over scalar retuning.

Good directions:
- state-dependent blend weights,
- non-linear schedules,
- sigmoid / exponential / polynomial mappings,
- interaction terms across the available features,
- asymmetric rules where the state clearly justifies them.

Bad directions:
- broad file churn,
- edits outside `train.py`,
- reopening benchmark infrastructure,
- changing frozen targets or scoring logic,
- defaulting back to pure scalar knob search unless semantic ideas stall.

### 3. Stay constrained

Keep the mutation surface narrow:
- prefer edits inside the bodies of
  `compute_eval_weight()` and
  `compute_trace_confidence_multiplier()`
- only touch nearby call sites in `train.py` if absolutely necessary
- do not redesign the whole file

### 4. Respect the measurement stack

Do not modify:
- `prepare.py`
- `multi_lane_benchmark.py`
- `oracle_abstractions.py`
- `gauntlet_eval.py`

The point of this campaign is to let the frozen harness judge symbolic solver
changes honestly.

## Deliverable
When the 12-experiment block finishes, write a root report at:

`ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_FROM_GEMINI_GCLI_0025.md`

That report must include:
- start and end times,
- initial and final incumbent,
- number of experiments,
- number of promotions,
- best semantic candidate,
- whether promotions came from `compute_eval_weight()` or
  `compute_trace_confidence_multiplier()`,
- whether any scalar fallback candidates outperformed semantic ones,
- repeated losing mutation patterns to avoid next,
- and all key artifact paths.

## Success Criteria
This campaign is successful if at least one of the following happens:
- a semantic candidate is promoted,
- a clear winning mutation family emerges,
- or a clear losing mutation family is identified strongly enough to narrow the
  next campaign.

Even a no-promotion run is acceptable if it produces strong directional
evidence about the new semantic surfaces.
