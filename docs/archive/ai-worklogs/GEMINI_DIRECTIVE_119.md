# Gemini Directive 119 - Score-Aware Match-Context Sprint

## Objective
Expose **game-score context** to the Oracle's existing semantic mutation
surface so the next Gemini symbolic campaign can reason about knock decisions
in the context of the match, not just the local hand state.

This is a Gemini CLI **engineering sprint**, not another symbolic search block.

## Why This Is The Highest-Leverage Next Step
Directive 118 was a clean bounded symbolic campaign:
- bridge reliability was perfect (`12/12`)
- every candidate used the new `pickup_pressure` signal
- the hypotheses were semantically coherent and internally consistent

But the result was also decisive:
- no promotions
- the best `pickup_pressure` candidates still regressed or only produced
  near-misses
- the report explicitly recommends moving toward **multi-lane interaction**
  instead of squeezing the current formula family harder

Three next moves were proposed in `EXECUTION_REPORT_118.md`:
- dynamic lane weighting
- expose game score
- expand evaluation scope

Of those, the **highest-leverage bounded move** is to expose game score to the
existing helper functions.

Why this choice:
- it adds real match-context intelligence without changing frozen targets
- it is already supported by the underlying spot data (`my_score`, `opp_score`)
- it gives Gemini a new semantic surface for "ahead vs behind" knock behavior
- it is much smaller and safer than rewriting aggregate lane weighting
- it avoids using benchmark expansion as a shortcut

The correct next step is therefore:
- add a **narrow score-aware mutation surface**
- preserve incumbent behavior by default
- prepare the repo for a later symbolic campaign on score-aware logic

## Required Deliverables

### 1. Expand the Helper-Function Surface With Score Context

Widen the current mutation surface in `oracle_autoresearch/train.py` just
enough to expose match-score state.

Target functions:
- `compute_eval_weight(...)`
- `compute_trace_confidence_multiplier(...)`

Expose a small, explicit score-aware input surface such as:
- `my_score`
- `opp_score`
- `score_diff`

Requirements:
- keep the expansion **narrow**
- prefer raw score inputs or one simple derived score-gap term
- do **not** expose a large new family of unrelated features
- preserve the current incumbent behavior by default if the new inputs are not
  yet used semantically

### 2. Thread Score Context Through the Real Policy Path

Update call sites only as needed so the real policy, benchmarked policy, and
held-out gauntlet remain aligned.

Good targets include:
- `oracle_autoresearch/train.py`
- `oracle_autoresearch/gauntlet_eval.py`

Requirements:
- keep the benchmark infrastructure frozen
- only add pass-through plumbing where necessary
- do **not** change scoring, targets, promotion margin, or lane weights

### 3. Add One Small Score-Context Audit or Diagnostic

Add a lightweight check that makes the new surface inspectable and easy to
trust before the next search block.

Good examples:
- a short script or saved summary showing score-gap distribution across the
  frozen eval spots
- a report of how often spots are near-clinch, behind-big, or ahead-big
- a simple confirmation artifact that the new score-aware inputs reach the
  helper-function call sites used by the real policy

Requirements:
- keep it bounded and readable
- do **not** build a large analytics framework
- the goal is confidence and visibility, not a new subsystem

### 4. Update Prompt / Docs for the New Frontier

Update:
- `oracle_autoresearch/agent_prompt.md`
- `oracle_autoresearch/program.md`
- `oracle_autoresearch/README.md`

They should now reflect that:
- the incumbent is still `gemini_gcli_0073` at `0.8010`
- `pickup_pressure` has been explored through R6 and appears directionally
  useful but not promotion-generating on its own
- the next frontier is **score-aware match context**
- the helper-function surface now includes bounded score inputs
- the next Gemini campaign should search **score-aware semantic formulas**,
  not generic knob churn

### 5. Preserve the Report-Naming Rule

This directive must follow the repo naming rule exactly.

Because this root directive is:
- `GEMINI_DIRECTIVE_119.md`

the resulting root handoff **must** be:
- `EXECUTION_REPORT_119.md`

Also keep:
- `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`

## Constraints
- Do **not** run another 12-experiment symbolic Gemini campaign in this sprint.
- Do **not** edit `prepare.py`, `multi_lane_benchmark.py`, or
  `oracle_abstractions.py`.
- Do **not** change frozen targets, lane weights, Pareto gate logic, or
  promotion margin.
- Do **not** implement dynamic aggregate lane reweighting in this sprint.
- Do **not** expand the eval set just to make promotion easier.
- Do **not** widen the helper surface beyond a small score-aware addition.
- Keep the work reviewable and local.

## Verification
Run, at minimum:

1. `python oracle_autoresearch/train.py --time-budget 60 --tag directive119_smoke`
   - baseline path still works after the score-surface expansion

2. `python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 119`
   - real-policy path still exercises the widened signatures successfully

3. `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode bridge_only --max-experiments 1 --dry-run`
   - the Gemini request should now show the score-aware helper surface

4. Run the new score-context audit / diagnostic and save or summarize the
   output

Use the repo-local Python if needed:
- `.local-python\\3.14\\python.exe`

## Expected Output
Write a root handoff at:
- `EXECUTION_REPORT_119.md`

That report must include:
- what score-aware inputs were exposed
- exactly which files were updated
- whether incumbent behavior was preserved by default
- what the score-context audit revealed
- whether the repo is now ready for a score-aware symbolic Gemini campaign

## Success Criteria
This sprint is successful if:

1. The Oracle helper-function surface gains a **small, explicit score-aware
   match-context input**, and
2. The real policy, gauntlet, docs, and prompt are all aligned with that new
   surface, and
3. The repo is ready for the next Gemini block to test whether score-aware
   knock calibration can break the `0.8010` plateau without changing the
   frozen benchmark structure.
