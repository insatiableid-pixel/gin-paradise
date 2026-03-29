# Execution Report — Directive 109

## Objective
Bridge from "hardened benchmark infrastructure" (Directive 108) to "paper-aligned
LLM code evolution over constrained solver components" by:
1. Integrating the real `train.py` Oracle policy into the gauntlet evaluator
2. Extracting a narrow semantic mutation surface in `train.py`
3. Updating all docs and prompts to point Gemini at that surface
4. Preserving the incumbent's exact numerical behavior

## What Was Delivered

### 1. Real `train.py` Policy Integrated into the Gauntlet

`gauntlet_eval.py` now contains `RealOraclePolicyPlayer`, a full-game player
that delegates knock decisions to the real train.py belief-world EV estimation:

- **Belief-world generation** with enhanced card weights (upcard decline signal)
- **Stock-size deadwood prior** for world quality
- **Mixed continuation policy** (80% champion + 20% greedy blend)
- **Dynamic risk adjustments** via `compute_trace_confidence_multiplier()`
- **EV-to-probability conversion** with `compute_eval_weight()` blending
- **Deterministic seeding** for reproducibility under fixed seeds

The legacy simplified `OracleKnockPlayer` is retained and accessible via
`--mode legacy` for comparison runs.

| Feature | Directive 108 (Legacy) | Directive 109 (Real) |
|---------|----------------------|---------------------|
| Knock decision | DW threshold (≤7) | Belief-world EV estimation |
| Draw decision | Meld-completer heuristic | Same (DW-minimizing baseline) |
| Discard decision | Max DW card | Same (DW-minimizing baseline) |
| World generation | None | Enhanced card weights, decline signal |
| Risk adjustment | None | Trace-confidence + DW-scaled penalty |
| Policy consistency | Simplified proxy | Uses same mutation surfaces as benchmark |

### 2. Semantic Mutation Surface Extracted in `train.py`

Two small, self-contained helper functions were extracted:

#### `compute_eval_weight(hero_deadwood, stock_size, n_trace_events, ev_gap) → float`

- Controls the blend between direct belief-world EV estimate and CFR policy prior
- **Current behavior**: returns `DIRECT_EVAL_WEIGHT = 0.90` (flat constant)
- **Evolution opportunity**: state-dependent sigmoid/polynomial functions
- **Available features**: hero_deadwood, stock_size, n_trace_events, ev_gap
- Wired into `predict_knock_probability_direct()`,
  `predict_knock_probability_incremental_p75()`, and the inline Phase 3 loop

#### `compute_trace_confidence_multiplier(n_trace_events, stock_size, hero_deadwood) → float`

- Controls how much risk penalty is applied to knock EV
- **Current behavior**: `1.0 - 0.08 * n_trace_events`, floored at 0.6
- **Evolution opportunity**: non-linear decay, interaction terms, contextual adaptation
- **Available features**: n_trace_events, stock_size, hero_deadwood
- Wired into `compute_trace_confidence()`, which feeds into all EV computation paths

Both functions are also used by the `RealOraclePolicyPlayer` in the gauntlet,
ensuring held-out evaluation runs the exact same policy being optimized.

### 3. Incumbent Numerically Preserved

The refactor is **behavior-equivalent**:

| Parameter | Before | After | Changed? |
|-----------|--------|-------|----------|
| `DIRECT_EVAL_WEIGHT` | 0.90 | 0.90 (via `compute_eval_weight()`) | No |
| `CALIBRATION_MAX_WORLDS` | 150 | 150 | No |
| `CALIBRATION_FRACTION` | 0.15 | 0.15 | No |
| `TRACE_CONFIDENCE_DECAY` | 0.08 | 0.08 (via `compute_trace_confidence_multiplier()`) | No |
| `TRACE_CONFIDENCE_FLOOR` | 0.6 | 0.6 (via `compute_trace_confidence_multiplier()`) | No |

The existing `compute_trace_confidence(spot)` function now delegates to
`compute_trace_confidence_multiplier()`, passing the same `n_events`,
`stock_size`, and `hero_deadwood` values from the SpotRecord. All control
flow paths that previously used `DIRECT_EVAL_WEIGHT` directly now call
`compute_eval_weight()` which returns that same constant.

### 4. Gauntlet Output Enhanced for Human Gating

The gauntlet now clearly reports:
- **Which policy** was evaluated (real vs legacy, with full description)
- **Policy parameters** (n_worlds, EV estimation mode, risk adjustment mode)
- **Mutation surfaces** used (listed in JSON artifact)
- **Deterministic config** (seed, deal count, target score)
- **Verdict** (STRONG/MARGINAL/FAIL)
- **JSON artifact** with full provenance for comparison across runs

### 5. Documentation Updated

| File | Status |
|------|--------|
| `oracle_autoresearch/README.md` | Rewritten — mutation surface architecture, real-policy gauntlet |
| `oracle_autoresearch/program.md` | Rewritten — semantic evolution direction, helper function targets |
| `oracle_autoresearch/agent_prompt.md` | Rewritten — explicit mutation type field, semantic vs scalar |
| `oracle_autoresearch/train_incumbent.py` | Updated — matches train.py with mutation surfaces |

## Verification Results

All four required verification commands passed:

| # | Command | Result |
|---|---------|--------|
| 1 | `python oracle_autoresearch/prepare.py` | ✅ Passed — confirmed frozen targets |
| 2 | `python oracle_autoresearch/train.py --time-budget 60 --tag directive109_smoke` | ✅ Passed — knock score 0.5704, aggregate 0.7422 |
| 3 | `python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 109` | ✅ Passed — real policy, 55.0% win rate, 11.4s |
| 4 | `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode fallback_only --max-experiments 1 --dry-run` | ✅ Passed (exit 0) |

### Gauntlet Results (Real Policy, 10 deals)

| Metric | Value |
|--------|-------|
| Policy | RealOraclePolicyPlayer (n_worlds=30, belief-world EV) |
| Oracle wins | 11 |
| Simple wins | 9 |
| Oracle win rate | 55.0% (95% CI: 34.2% - 74.2%) |
| Oracle gins | 7 |
| Simple gins | 2 |
| Oracle undercuts | 11 |
| Simple undercuts | 3 |
| Avg points Oracle | 82.9 |
| Avg points Simple | 73.5 |
| Verdict | MARGINAL |
| Elapsed | 11.4s |

This is now a **real evaluation of the actual train.py policy**, not a
simplified proxy player. The MARGINAL verdict on 10 deals (20 games) is
expected — statistical power requires more deals for definitive gating.

## Constraints Honored

- ✅ Did not remove the frozen multi-lane benchmark architecture from 108
- ✅ Did not widen the editable surface beyond `train.py`
- ✅ Did not start broad symbolic evolution; only prepared the surface
- ✅ Did not degrade the incumbent while refactoring
- ✅ Mutation surface is narrow: exactly two small, documented functions
- ✅ Preferred explicit helper functions over broad structural churn

## Files Modified/Created

| File | Action |
|------|--------|
| `oracle_autoresearch/train.py` | **Modified** — extracted `compute_eval_weight()` and `compute_trace_confidence_multiplier()` |
| `oracle_autoresearch/gauntlet_eval.py` | **Rewritten** — `RealOraclePolicyPlayer` using real train.py policy |
| `oracle_autoresearch/agent_prompt.md` | **Rewritten** — points Gemini at semantic mutation surfaces |
| `oracle_autoresearch/README.md` | **Rewritten** — documents mutation surfaces and real-policy gauntlet |
| `oracle_autoresearch/program.md` | **Rewritten** — semantic evolution direction |
| `oracle_autoresearch/train_incumbent.py` | **Updated** — matches train.py |
| `EXECUTION_REPORT_109.md` | **Created** — this report |

## What the Repo Is Now Ready For

The next Gemini CLI involvement should be the **first bounded symbolic-evolution
campaign** targeting these two helper functions:

1. **`compute_eval_weight()`** — propose state-dependent blend weights
   using continuous math (sigmoid, exponential, polynomial) over hero_deadwood,
   stock_size, n_trace_events, and ev_gap

2. **`compute_trace_confidence_multiplier()`** — propose non-linear risk
   scaling using interaction terms, contextual adaptation, or asymmetric
   thresholds over n_trace_events, stock_size, and hero_deadwood

The benchmark infrastructure, frozen targets, Pareto gate, and held-out gauntlet
are all stable. The only thing that should change in the next sprint is the
**body of these two functions** inside `train.py`.
