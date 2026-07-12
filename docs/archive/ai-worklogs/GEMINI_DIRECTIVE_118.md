# Gemini Directive 118 - Pickup-Pressure Symbolic Campaign R6

## Objective
Run the first bounded Gemini symbolic-evolution block against the
**pickup-pressure-enhanced** Oracle surface delivered in Directive 117.

This campaign should test whether the new bounded signal:
- `pickup_pressure`

can unlock a real promotion beyond the current incumbent:
- `gemini_gcli_0073`
- aggregate score `0.8010`

without changing the frozen benchmark or promotion gate.

## Why This Is The Highest-Leverage Next Step
Directive 116 showed that the earlier expanded helper surface was reaching
Gemini correctly, but raw `n_pickups` / `turn_number` edits mostly produced
slight knock-lane regressions.

Directive 117 addressed the most likely bottleneck:
- improved pickup-aware opponent modeling
- added belief diagnostics
- exposed a new first-class semantic input:
  - `pickup_pressure`

The dry run already confirmed Gemini can see and use this new input.
So the correct next move is not another engineering sprint.
It is the first real search block on this improved semantic foundation.

## Required Work

### 1. Read Current Oracle State Before Running
Read at minimum:
- `oracle_autoresearch/agent_prompt.md`
- `oracle_autoresearch/program.md`
- `oracle_autoresearch/README.md`
- `EXECUTION_REPORT_117.md`
- `oracle_autoresearch/loop_state.json`

Confirm that:
- the incumbent is still `gemini_gcli_0073`
- the current aggregate score is `0.8010`
- `pickup_pressure` is now part of the helper-function signatures

### 2. Run a Bounded Bridge-Only Gemini Campaign
Run the next campaign as:
- Gemini CLI only
- `bridge_only` mode
- `12` experiments
- no local fallback

This is a **symbolic** campaign, not a benchmark redesign and not a belief
generator rewrite.

### 3. Search Priorities
Primary mutation targets remain:
- `compute_eval_weight(...)`
- `compute_trace_confidence_multiplier(...)`

But the campaign should now center the new signal:
- `pickup_pressure`

Highest-priority ideas:
- use `pickup_pressure` as a **smooth bounded caution signal**, not as a blunt
  per-pickup penalty
- reduce direct-EV trust only when `pickup_pressure` and late-game progression
  agree, instead of universally punishing pickup-heavy spots
- use `pickup_pressure` to raise the risk floor in a **moderated** way that
  cooperates with the existing winning family from `0073`
- prefer interactions between:
  - `pickup_pressure`
  - `stock_size`
  - `turn_number`
  - `ev_gap`
  - `n_trace_events`

Good direction:
- smooth continuous schedules
- conditional moderation
- pickup-pressure-aware calibration that preserves the strong baseline when
  pickup pressure is low

Avoid:
- raw additive `+0.03 per pickup` style penalties
- simply replacing `n_trace_events` with `n_pickups`
- aggressive late-game direct-EV trust boosts that already failed in R5
- touching benchmark infrastructure or world-generation code in this run

### 4. Promotion Goal
The campaign should aim to beat:
- aggregate incumbent score `0.8010`
- by at least the existing `0.005` promotion margin

The likely path is:
- knock-lane improvement from better calibrated caution under truly dangerous
  pickup-rich spots, while preserving incumbent behavior elsewhere

### 5. Report Naming Rule
This directive must follow the repo naming rule exactly.

Because this root directive is:
- `GEMINI_DIRECTIVE_118.md`

the resulting root handoff **must** be:
- `EXECUTION_REPORT_118.md`

Do not use a long custom campaign filename for the root handoff.

## Constraints
- Do **not** redesign the lab.
- Do **not** widen the mutation surface further in this campaign.
- Do **not** change frozen targets, lane scoring, Pareto gate logic, or margin.
- Do **not** silently fall back to local generation.
- If the Gemini bridge fails, stop and report the failure honestly in
  `EXECUTION_REPORT_118.md`.

## Expected Output
When the run finishes, write a root report at:
- `EXECUTION_REPORT_118.md`

That report must include:
- start time and end time
- initial incumbent and final incumbent
- total experiments run
- total promotions
- bridge success/failure status
- best candidate and worst candidate
- whether `pickup_pressure` generated real winning signal or only near-misses
- whether the best candidates used moderation or blunt punishment
- recommended next move after the run

Also preserve the normal Oracle execution artifacts under:
- `oracle_autoresearch/artifacts`
- `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`

## Success Criteria
This directive is successful if one of the following happens:

1. A candidate is promoted by at least `0.005` over `0.8010`, proving that
   `pickup_pressure` unlocked real new headroom.

2. No promotion occurs, but the report clearly shows whether `pickup_pressure`
   is a productive new signal, a near-miss signal, or mostly dead weight, so
   the next sprint can be chosen rationally.
