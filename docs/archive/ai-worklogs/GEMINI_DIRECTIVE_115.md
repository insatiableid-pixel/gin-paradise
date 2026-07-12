# Gemini Directive 115 - Semantic Surface Expansion After R4 Saturation

## Objective
Expand the current Oracle semantic mutation surface just enough to move past the
local saturation reported in
`ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_R4_COUPLED_FROM_GEMINI_GCLI_0073.md`,
while preserving the current incumbent's behavior by default.

This is a Gemini CLI engineering sprint, not a symbolic search sprint.

## Why This Sprint
The latest bridge-only Gemini block was a clean success operationally:
- bridge reliability was perfect (`12/12`)
- coupled semantic edits were explored honestly
- raw scores reached `0.8055`

But it also produced a clear modeling signal:
- the current two-function mutation surface appears **locally saturated**
- multiple high-quality candidates missed the `0.005` promotion margin by small
  amounts
- the report explicitly recommends widening the helper-function surface with
  new bounded state features such as:
  - turn number
  - opponent pickup count
  - opponent discard count

So the next highest-leverage move is to give Gemini a slightly richer, still
bounded semantic surface instead of forcing it to keep squeezing the same four
inputs.

## Required Deliverables

### 1. Expand the Helper-Function Input Surface in `train.py`

Widen the semantic surface of the current helper functions in a careful,
bounded way.

Target functions:
- `compute_eval_weight(...)`
- `compute_trace_confidence_multiplier(...)`

Expose a few additional high-signal state features already evidenced in the repo.
Good candidates include:
- `turn_number`
- opponent pickup count
- opponent discard count
- upcard decline count
- or other similarly small public-state signals already available at call sites

Requirements:
- keep the surface **narrow and explicit**
- do **not** turn this into a wide architectural rewrite
- do **not** expose dozens of features
- preserve incumbent behavior by default:
  - if the new inputs are not yet used semantically, the old effective policy
    should remain intact

### 2. Keep the Benchmark and Gauntlet Frozen

Do **not** modify the benchmark infrastructure except where strictly necessary
to pass through the richer state inputs into the same policy logic.

Do **not** change:
- frozen targets
- lane scoring
- Pareto gate logic
- promotion margin

If the gauntlet calls the same helper surfaces, update it only as needed to
keep the real-policy evaluation aligned with `train.py`.

### 3. Update the Oracle Prompt / Program for the Expanded Surface

Update:
- `oracle_autoresearch/agent_prompt.md`
- `oracle_autoresearch/program.md`
- `oracle_autoresearch/README.md`

so they clearly describe:
- the new helper-function inputs
- that the surface is intentionally wider than before but still bounded
- that the benchmark remains frozen
- that the next Gemini campaign should focus on the expanded semantic surface,
  not scalar knobs

### 4. Establish the Report-Naming Rule

The repo now needs a hard rule for future Gemini campaign reports:

When executing a root directive named:
- `GEMINI_DIRECTIVE_<N>.md`

the resulting root report **must** be named:
- `EXECUTION_REPORT_<N>.md`

Update the relevant docs / prompts / directive guidance so this convention is
explicit and stable going forward.

This sprint's handoff must be:
- `EXECUTION_REPORT_115.md`

### 5. Preserve the Current Incumbent as the Baseline

Current source of truth:
- incumbent: `gemini_gcli_0073`
- score: `0.8010`
- winning family:
  - EV-gap + trace-richness dynamic weighting
  - exponential decay + protective floor + stock-size-aware late-game floor

Do **not** degrade this behavior while expanding the surface.

## Constraints
- Do **not** run another symbolic Gemini search block in this sprint.
- Do **not** widen the surface recklessly.
- Do **not** change the promotion rule just because several candidates missed
  by small margins.
- Do **not** collapse back into scalar-only thinking.
- Keep the expansion surgical, reviewable, and source-of-truth aligned.

## Verification
Run, at minimum:

1. `python oracle_autoresearch/train.py --time-budget 60 --tag directive115_smoke`
   - should preserve baseline behavior within expected smoke variance

2. `python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 115`
   - should still exercise the real-policy path successfully

3. `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode bridge_only --max-experiments 1 --dry-run`
   - should show that the expanded surface is reflected in the Gemini request

Use the repo-local Python if needed:
- `.local-python\\3.14\\python.exe`

## Completion Criteria
This sprint is complete when:
- the current helper functions have a slightly richer bounded input surface
- docs and prompts describe that new surface clearly
- incumbent behavior is preserved
- the Gemini report-naming rule is explicitly established
- and the repo is ready for the next Gemini block to search the expanded
  semantic surface instead of a locally saturated one
