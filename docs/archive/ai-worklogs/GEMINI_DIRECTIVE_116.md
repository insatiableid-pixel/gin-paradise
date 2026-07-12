# Gemini Directive 116 - Expanded-Surface Symbolic Campaign R5

## Objective
Run the first bounded Gemini symbolic-evolution block against the **expanded**
helper-function surface delivered in Directive 115.

This campaign should exploit the newly exposed public-state features to move
past the current incumbent plateau:
- incumbent: `gemini_gcli_0073`
- aggregate score: `0.8010`

The goal is to find a promotion by improving the knock lane through
state-conditioned logic that uses the new inputs, while keeping the benchmark,
gauntlet, and promotion gate frozen.

## Why This Is The Highest-Leverage Next Step
Directive 115 did the engineering work we needed:
- the helper signatures in `oracle_autoresearch/train.py` now expose:
  - `turn_number`
  - `n_pickups`
  - `n_discards`
  - `n_declines`
- baseline behavior was preserved
- gauntlet parity was verified
- Gemini bridge dry-run proved the new surface reaches the prompt cleanly

So the correct next move is **not** another engineering sprint.
It is the first real search block on this richer semantic surface.

## Required Work

### 1. Read Current Oracle State Before Running
Read at minimum:
- `oracle_autoresearch/agent_prompt.md`
- `oracle_autoresearch/program.md`
- `oracle_autoresearch/README.md`
- `EXECUTION_REPORT_115.md`
- `oracle_autoresearch/loop_state.json`

Confirm that:
- the incumbent is still `gemini_gcli_0073`
- the current aggregate score is `0.8010`
- the new mutation surface from Directive 115 is available

### 2. Run a Bounded Bridge-Only Gemini Campaign
Run the next campaign as:
- Gemini CLI only
- `bridge_only` mode
- `12` experiments
- no local fallback

This is an **expanded-surface symbolic campaign**, not a scalar tuning pass.

### 3. Search Priorities
Primary mutation targets remain:
- `compute_eval_weight(...)`
- `compute_trace_confidence_multiplier(...)`

But now the search should explicitly prioritize the new state features.

Highest-priority ideas:
- use `turn_number` to distinguish early, middle, and late-hand trust behavior
- use `n_pickups` as a stronger public-pressure signal than raw trace count alone
- use `n_discards` and `n_declines` only when they add clear value, not formula clutter
- prefer state-conditioned logic that preserves the current winning family while
  refining **when** it activates

Good direction:
- surgical conditional or continuous schedules that combine:
  - EV-gap confidence
  - trace richness
  - late-game stock pressure
  - explicit pickup pressure
  - turn progression

Avoid:
- generic rewrites that merely restate stock-size scaling
- broad multi-term churn with weak semantic motivation
- touching benchmark infrastructure
- changing the promotion rule
- edits outside the intended symbolic surface unless strictly required to keep
  the search loop functioning

### 4. Promotion Goal
The campaign should aim to beat:
- aggregate incumbent score `0.8010`
- by at least the existing `0.005` promotion margin

The most likely path is:
- a knock-lane gain driven by better calibration of trust/risk based on
  `turn_number` and pickup pressure

### 5. Report Naming Rule
This directive must follow the repo naming rule exactly.

Because this root directive is:
- `GEMINI_DIRECTIVE_116.md`

the resulting root handoff **must** be:
- `EXECUTION_REPORT_116.md`

Do not use a long custom campaign filename for the root handoff.

## Constraints
- Do **not** redesign the lab.
- Do **not** widen the mutation surface further in this campaign.
- Do **not** change frozen targets, lane scoring, Pareto gate logic, or margin.
- Do **not** silently fall back to local generation.
- If the Gemini bridge fails, stop and report the failure honestly in
  `EXECUTION_REPORT_116.md`.

## Expected Output
When the run finishes, write a root report at:
- `EXECUTION_REPORT_116.md`

That report must include:
- start time and end time
- initial incumbent and final incumbent
- total experiments run
- total promotions
- bridge success/failure status
- best candidate and worst candidate
- whether the new features (`turn_number`, `n_pickups`, `n_discards`,
  `n_declines`) produced meaningful winning signal
- recommended next move after the run

Also preserve the normal Oracle execution artifacts under:
- `oracle_autoresearch/artifacts`
- `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`

## Success Criteria
This directive is successful if one of the following happens:

1. A candidate is promoted by at least `0.005` over `0.8010`, proving the
   expanded surface unlocked new headroom.

2. No promotion occurs, but the report clearly shows whether the new features
   generated strong near-misses or mostly noise, so we can choose the next
   engineering sprint rationally.
