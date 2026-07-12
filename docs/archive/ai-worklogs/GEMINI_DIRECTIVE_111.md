# Gemini Directive 111 - Second Bounded Symbolic Exploitation Block

## Objective
Run the **second bounded Gemini CLI symbolic-evolution campaign** from the new
incumbent `gemini_gcli_0043` (`0.7619`) and exploit the newly discovered
winning mutation family before we widen the semantic surface again.

This campaign should continue to target only the two helper functions in
`oracle_autoresearch/train.py`:

- `compute_eval_weight(...)`
- `compute_trace_confidence_multiplier(...)`

## Why This Is The Right Move
The first symbolic block was a strong success:
- promotion #1: exponential decay + deadwood-scaled floor in
  `compute_trace_confidence_multiplier()`
- promotion #2: EV-gap confidence + trace-richness weighting in
  `compute_eval_weight()`
- final incumbent jumped from `0.6293` to `0.7619`

That is a large enough gain that the optimal next move is **not** new
infrastructure yet. It is one more bounded exploitation block centered on the
winning family.

## What To Read First
Read these files before launching:

- `oracle_autoresearch/README.md`
- `oracle_autoresearch/program.md`
- `oracle_autoresearch/agent_prompt.md`
- `EXECUTION_REPORT_109.md`
- `ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_FROM_GEMINI_GCLI_0025.md`
- `oracle_autoresearch/loop_state.json`

Confirm from them that:
- the incumbent is now `gemini_gcli_0043`,
- the current aggregate score is `0.7619`,
- the benchmark infrastructure remains frozen,
- and the semantic surfaces are still only the two helper functions in
  `train.py`.

## Campaign Instructions

### 1. Run a bounded 12-experiment block

Launch:

```powershell
.\oracle_autoresearch\run_gemini_loop.ps1 -MaxExperiments 12
```

Use Gemini CLI's auto-selected model. Do **not** pin an old model.

### 2. Prioritize local exploitation of the winning family

Good directions for this block:
- local coefficient refinements around the incumbent formulas
- mild secondary interaction terms added to already-strong logic
- careful refinement of EV-gap weighting
- careful refinement of trace-richness weighting
- careful refinement of the deadwood-scaled floor
- combinations that preserve the core winner shape while improving calibration

Bad directions for this block:
- pure stock-size-only schedules as the main idea
- broad new formula families unrelated to the winner
- overly complex polynomial / sqrt churn
- edits outside `train.py`
- reopening frozen benchmark infrastructure

### 3. Keep the surface narrow

Prefer edits inside the bodies of:
- `compute_eval_weight()`
- `compute_trace_confidence_multiplier()`

Only touch nearby `train.py` call sites if absolutely necessary.

### 4. Treat this as exploitation, not rediscovery

The first symbolic block already told us:
- non-linear EV-gap + trace-richness weighting is promising
- non-linear decay + protective high-deadwood floor is promising
- pure stock-size schedules are weak by themselves

Use those findings directly instead of spending experiments rediscovering them.

## Deliverable
When the run finishes, write a root report at:

`ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_R2_FROM_GEMINI_GCLI_0043.md`

That report must include:
- start and end times,
- initial and final incumbent,
- number of experiments and promotions,
- best candidate,
- whether the best promotion came from `compute_eval_weight()` or
  `compute_trace_confidence_multiplier()`,
- whether the campaign found continued headroom in the current winning family,
- repeated losing local variants to avoid next,
- and all key artifact paths.

## Success Criteria
This campaign is successful if it does at least one of these:
- promotes another semantic candidate from the current winning family,
- clearly shows that the current family is now locally saturated,
- or identifies the specific next surface-expansion we should hand back to
  Claude.
