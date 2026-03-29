# Gemini Directive 114 - Coupled Semantic Block R4

## Objective
Run the **next bridge-only symbolic-evolution block** from the current
incumbent `gemini_gcli_0073` (`0.8010`) with a specific focus on **coupled
semantic edits across both helper functions**:

- `compute_eval_weight(...)`
- `compute_trace_confidence_multiplier(...)`

The goal is to exploit the interaction headroom surfaced by R3 instead of
continuing with mostly one-function-at-a-time refinements.

## Why This Is The Right Move
The latest reports show three important things:

1. The Gemini bridge is healthy again (`12/12` successful bridge generations).
2. The current winning family is real and still improving.
3. Candidate `gemini_gcli_0075` scored `0.8052` but missed promotion margin
   after `gemini_gcli_0073` was already kept, which strongly suggests there is
   still headroom in the **interaction** between the two helper functions.

So the next best move is **not** infrastructure and **not** another broad
single-function search. It is a deliberate coupled-semantic block.

## What To Read First
Read these files before launching:

- `oracle_autoresearch/train.py`
- `oracle_autoresearch/agent_prompt.md`
- `oracle_autoresearch/program.md`
- `oracle_autoresearch/loop_state.json`
- `EXECUTION_REPORT_112.md`
- `ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_R3_BRIDGE_ONLY_FROM_GEN_TRACE_CONFIDENCE_DECAY_0P1.md`
- `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`

Confirm from them that:
- the incumbent is `gemini_gcli_0073`
- the current score is `0.8010`
- bridge reliability is restored
- the prompt now reflects the current winning family

## Campaign Instructions

### 1. Run a bridge-only 12-experiment block

Launch:

```powershell
& '.\.local-python\3.14\python.exe' oracle_autoresearch\agent_loop.py `
  --bridge-provider gemini `
  --bridge-mode bridge_only `
  --bridge-timeout 300 `
  --max-experiments 12
```

Do **not** use fallback for this campaign.

### 2. Focus on coupled edits

This block should strongly prefer candidates that intentionally coordinate the
two helper functions together.

Good directions:
- progress-aware `compute_eval_weight()` refinements that complement the new
  late-game risk floor
- interaction terms where direct-EV trust and risk penalty evolve coherently
  with game progress
- small, focused dual-function edits that preserve the current winning family
  while improving late-game calibration
- secondary stock-size interactions only when they are coupled to the existing
  EV-gap / trace-richness logic, not when they replace it

Bad directions:
- pure stock-size-only schedules as the main idea
- reverting exponential decay back to simpler linear forms
- broad formula-family resets
- edits outside `train.py`
- infrastructure or prompt churn during the campaign

### 3. Treat the current family as the baseline, not the problem

Preserve the core winners:
- `compute_eval_weight()` should still be built around EV-gap confidence and
  trace richness
- `compute_trace_confidence_multiplier()` should still be built around
  exponential decay plus protective floor logic

The job of this block is to refine and couple those ideas, not discard them.

## Deliverable
When the run finishes, write this root report:

`ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_R4_COUPLED_FROM_GEMINI_GCLI_0073.md`

That report must include:
- start and end times
- initial and final incumbent
- number of experiments and promotions
- confirmation that the campaign ran in `bridge_only` mode
- whether the best promotion came from a **coupled dual-function edit**
- whether `compute_eval_weight()` finally broke through on top of the new
  trace-floor logic
- whether continued headroom exists in the current family
- and the exact losing coupled variants to avoid next

## Success Criteria
This campaign is successful if it produces at least one of:
- a promoted coupled semantic candidate
- a stronger single-function promotion that clearly dominates the coupled ideas
- or a clean saturation signal showing that the current family is now mostly
  exhausted and the next move should return to Claude for a surface expansion
