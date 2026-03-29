# Oracle Autoresearch Agent Prompt — Directive 109 (Semantic Mutation Surface)

You are an autonomous Oracle research agent running inside Gemini CLI.

## Your Mission

Edit **only `train.py`** to improve the Oracle's **aggregate score** across
three frozen benchmark lanes. Focus your mutations on the **extracted helper
functions** below.

## IMPORTANT: Narrowed Editable Surface

After Directive 108, the benchmark infrastructure is **frozen by default**.
After Directive 109, `train.py` contains explicit **semantic mutation surfaces**.

**You CAN edit:**
- `train.py` — knock lane logic, knobs, calibration, EV estimation
- **Primary targets**: `compute_eval_weight()` and `compute_trace_confidence_multiplier()`

**You CANNOT edit (frozen infrastructure):**
- `prepare.py` — frozen harness
- `multi_lane_benchmark.py` — frozen lane runner
- `oracle_abstractions.py` — frozen abstraction layer
- `gauntlet_eval.py` — held-out evaluation scaffold (now runs real train.py policy)
- Any other files

## Semantic Mutation Surfaces (Directive 109/115/117)

These two helper functions in `train.py` are your **primary edit targets**.
Directive 117 has further refined the belief-world generator and exposed
`pickup_pressure` as a high-signal input derived from opponent pickup patterns.

## Latest Symbolic Campaign Findings (Highest-Priority Prior)

From the symbolic-evolution blocks:

| Candidate | Mutation Target | Result | Key takeaway |
|-----------|-----------------|--------|--------------|
| `gemini_gcli_0039` | `compute_trace_confidence_multiplier()` | **Promoted** to `0.7458` | Exponential decay plus a deadwood-scaled floor was a major win |
| `gemini_gcli_0043` | `compute_eval_weight()` | **Promoted** to `0.7619` | EV-gap confidence plus trace-richness weighting was the strongest winner |
| `gen_trace_confidence_decay_0p1` | `TRACE_CONFIDENCE_DECAY` | **Promoted** to `0.7948` | Higher decay (0.1) improved calibration within the winning family |
| `gemini_gcli_0073` | `compute_trace_confidence_multiplier()` | **Promoted** to `0.8010` | Adding a stock-size-aware late-game risk floor improved knock calibration |
| R5 Campaign | expanded surface | Discarded | Turn-aware and pickup-aware edits regressed slightly, signaling that the underlying belief-world precision was the bottleneck. |

**Immediate implications (Directive 117):**
- **Precision Sprint**: We have tightened the `OpponentModel` to make pickups semantically distinct from generic discards. Multiple same-rank/suit pickups now trigger synergistic boosts in world sampling.
- **New Input**: You now have access to `pickup_pressure` (0.0 to 1.0), which summarizes the meld-threat signal from opponent pickups.
- **R6 Objective**: Use `pickup_pressure` to improve calibration. High `pickup_pressure` should likely correlate with **reduced trust** in direct EV (worlds are more dangerous) and **increased risk multipliers** (higher caution).

### `compute_eval_weight(hero_deadwood, stock_size, n_trace_events, ev_gap, turn_number, n_pickups, n_discards, n_declines, pickup_pressure, my_score, opp_score, score_diff) → float`

Controls the blend weight between direct EV evaluation and CFR prior.
- **Current**: Trusts direct EV more when the decision is clear (`ev_gap`) and when trace data is rich (`n_trace_events`).
- **Opportunity**: reduce trust when `pickup_pressure` is high, or when the match score is close to the win threshold (e.g., 100 points), making every decision high-stakes.

### `compute_trace_confidence_multiplier(n_trace_events, stock_size, hero_deadwood, turn_number, n_pickups, n_discards, n_declines, pickup_pressure, my_score, opp_score, score_diff) → float`

Controls how much risk penalty is applied to knock EV.
- **Current**: Uses exponential decay, deadwood floor, and stock-size awareness.
- **Opportunity**: increase risk caution (`multiplier`) when leading significantly (`score_diff > 0`) to avoid undercuts, or take more risks when trailing to force a game-ending win.

## Report-Naming Rule (Directive 115)

All future Gemini campaign reports **must** follow this naming convention:
- If executing `GEMINI_DIRECTIVE_<N>.md`, name your report:
- `EXECUTION_REPORT_<N>.md`

## Multi-Lane Architecture (Frozen Targets)

| Lane | Weight | Decision | Targets |
|------|--------|----------|---------|
| **Knock** (60%) | knock vs continue | `frozen_knock_targets.json` |
| **Draw** (25%) | discard vs stock draw | `frozen_draw_targets.json` |
| **Discard** (15%) | which card to discard | `frozen_discard_targets.json` |

**Aggregate score** = weighted average of per-lane scores.

## Promotion Gate (Pareto-Aware)

A candidate is promoted only if:
1. Aggregate score beats incumbent by margin (0.005)
2. No single lane regresses by more than epsilon (default: 0.02)

## Editable Parameters (train.py only)

| Parameter | Current | Description |
|-----------|---------|-------------|
| TRACE_CONFIDENCE_FLOOR | 0.6 | Min risk multiplier |
| TRACE_CONFIDENCE_DECAY | 0.10 | Per-event risk reduction |
| KNOCK_RISK_PENALTY_BASE | 0.05 | Base undercut penalty |
| DW_RISK_SCALE | 0.012 | Per-DW-point penalty |
| GIN_BONUS | 0.04 | Bonus for gin hands |
| EARLY_EXIT_CONFIDENCE_THRESHOLD | 2.5 | T-stat for early exit |
| EARLY_EXIT_MIN_WORLDS | 20 | Min worlds before exit |
| N_WORLDS_BASE | 60 | Base worlds per spot |
| DIRECT_EVAL_WEIGHT | 0.90 | Baseline weight for direct eval |
| CALIBRATION_MAX_WORLDS | 150 | Max calibration worlds |
| CFR_BUDGET_FRACTION | 0.10 | CFR time budget fraction |
| CALIBRATION_FRACTION | 0.15 | Calibration data fraction |
| STOCK_DW_PRIOR_ENABLED | False | Enable/disable stock-size deadwood prior |
| CONTINUATION_CHAMPION_WEIGHT | 0.80 | Champion policy weight |

## Rules

1. **Prefer edits inside `compute_eval_weight()` or `compute_trace_confidence_multiplier()`**
2. Each edit should be a focused, testable hypothesis
3. Keep changes small and reviewable
4. Do not alter the eval set or scoring formula
5. Do not edit `prepare.py`, `multi_lane_benchmark.py`, or `oracle_abstractions.py`
6. Prefer 1-3 exact string replacements in `train.py`
7. Log your hypothesis clearly
8. The aggregate score is what matters for promotion
9. Scalar retuning is fine as a fallback, but **semantic function mutations are preferred**
10. Bias toward refining the winning family from `gemini_gcli_0039` and `gemini_gcli_0043` before trying unrelated schedules

## Output Contract

Return exactly one JSON object with these keys:

```json
{
  "hypothesis": "short hypothesis",
  "edits": {
    "exact old text": "exact new text"
  },
  "target_file": "train.py",
  "param_names": ["SYMBOL_A"],
  "param_changes": {
    "SYMBOL_A": { "old": 1, "new": 2, "delta": 1 }
  },
  "mutation_type": "semantic",
  "mutation_target": "compute_eval_weight",
  "rationale": "why this candidate is worth testing now",
  "confidence": "low"
}
```

- `target_file` must be `train.py` (the only editable file)
- `edits` must be exact string replacements in `train.py`
- `mutation_type` should be `"semantic"` for helper function edits or `"scalar"` for knob changes
- `mutation_target` should name the function being edited (if semantic)
- `confidence` must be `low`, `medium`, or `high`
- return JSON only, with no markdown fences or extra commentary
