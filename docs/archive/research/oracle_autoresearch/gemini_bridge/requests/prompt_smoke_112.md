You are the candidate-generation component inside an Oracle autoresearch loop.
You must propose exactly one focused candidate edit for train.py.

Hard rules:
- Only propose edits for train.py.
- Focus strictly on the extracted helper functions: compute_eval_weight() and compute_trace_confidence_multiplier().
- Prefer 1-3 exact string replacements.
- Every old_text must appear verbatim in the current train.py snippet shown below.
- Return JSON only. No markdown fences, no prose before or after the JSON.

Return a JSON object with exactly these keys:
{
  "hypothesis": "short hypothesis",
  "edits": {"exact old text": "exact new text"},
  "param_names": ["symbol_a"],
  "param_changes": {"symbol_a": {"old": 1, "new": 2, "delta": 1}},
  "rationale": "why this candidate is worth testing now",
  "confidence": "low" | "medium" | "high"
}

Current agent prompt / research priors:
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

## Semantic Mutation Surfaces (Directive 109)

These two helper functions in `train.py` are your **primary edit targets**.
Their initial implementations are simple baseline logic. You should propose
richer mathematical functions that improve the aggregate score.

## Latest Symbolic Campaign Findings (Highest-Priority Prior)

From the first and second symbolic-evolution blocks:

| Candidate | Mutation Target | Result | Key takeaway |
|-----------|-----------------|--------|--------------|
| `gemini_gcli_0039` | `compute_trace_confidence_multiplier()` | **Promoted** to `0.7458` | Exponential decay plus a deadwood-scaled floor was a major win |
| `gemini_gcli_0043` | `compute_eval_weight()` | **Promoted** to `0.7619` | EV-gap confidence plus trace-richness weighting was the strongest winner |
| `gen_trace_confidence_decay_0p1` | `TRACE_CONFIDENCE_DECAY` | **Promoted** to `0.7948` | Higher decay (0.1) improved calibration within the winning family |
| R2 local variants | mixed scalar knobs | Discarded | Toggling DW prior or continuation weight regressed or tied; family is stable |

**Immediate implications:**
- **Current Incumbent**: `gen_trace_confidence_decay_0p1` (`0.7948`)
- **Winning Family**: 
  - `compute_eval_weight()`: EV-gap + trace-richness dynamic weighting.
  - `compute_trace_confidence_multiplier()`: Non-linear decay + protective floor.
- Refine the **formulas** themselves now that the coefficients are better calibrated.
- Look for **interactions** between the two functions: e.g., should eval weight decrease as trace confidence increases?
- Avoid pure stock-size-only schedules; keep the state-dependent (DW, EV gap) logic as the core.

### `compute_eval_weight(hero_deadwood, stock_size, n_trace_events, ev_gap) → float`

Controls the blend weight between direct EV evaluation and CFR prior.
- **Current**: returns fixed constant `DIRECT_EVAL_WEIGHT = 0.90`
- **Opportunity**: make the weight state-dependent via:
  - Non-linear functions of stock_size (trust EV more in late game)
  - Sigmoid curves over ev_gap (trust more when gap is large)
  - Interaction terms between trace_events and hero_deadwood
  - Asymmetric rules for high vs low DW scenarios

### `compute_trace_confidence_multiplier(n_trace_events, stock_size, hero_deadwood) → float`

Controls how much risk penalty is applied to knock EV.
- **Current**: simple linear decay `1.0 - 0.08 * n_trace_events`, floored at 0.6
- **Opportunity**: replace with:
  - Exponential or sqrt decay curves
  - Weighted event types (pickups vs discards vs declines)
  - Stock-size interaction (late-game trace is more informative)
  - hero_deadwood context (risk matters more at high DW)
  - Polynomial blends or sigmoid mappings

### What Makes a Good Mutation

**Prefer:**
- Continuous mathematical operations (sigmoid, exponential, sqrt, polynomial)
- Dynamic schedules that vary with game state
- Non-linear weighting logic
- Asymmetric rules (different behavior for gin-live vs marginal knock)
- Small, self-contained changes within one or both helper functions
- Local refinements of the existing winning family before inventing a completely new one

**Avoid:**
- Plain scalar retuning (that was the old approach)
- Wide structural rewrites outside the helper functions
- Adding new classes or large frameworks
- Changing the scoring formula or benchmark infrastructure
- Pure stock-size-only schedules as the main idea
- Complex formula churn that is not clearly better motivated than the current winner

## Multi-Lane Architecture (Frozen Targets)

| Lane | Weight | Decision | Targets |
|------|--------|----------|---------|
| **Knock** (60%) | knock vs continue | `frozen_knock_targets.json` |
| **Draw** (25%) | discard vs stock draw | `frozen_draw_targets.json` |
| **Discard** (15%) | which card to discard | `frozen_discard_targets.json` |

**Aggregate score** = weighted average of per-lane scores.

## Promotion Gate (Pareto-Aware)

A candidate is promoted only if:
1. Aggregate score beats incumbent by margin (configurable)
2. No single lane regresses by more than epsilon (default: 0.02)

## Editable Parameters (train.py only)

| Parameter | Current | Description |
|-----------|---------|-------------|
| TRACE_CONFIDENCE_FLOOR | 0.6 | Min risk multiplier |
| TRACE_CONFIDENCE_DECAY | 0.08 | Per-event risk reduction |
| KNOCK_RISK_PENALTY_BASE | 0.05 | Base undercut penalty |
| DW_RISK_SCALE | 0.012 | Per-DW-point penalty |
| GIN_BONUS | 0.04 | Bonus for gin hands |
| EARLY_EXIT_CONFIDENCE_THRESHOLD | 2.5 | T-stat for early exit |
| EARLY_EXIT_MIN_WORLDS | 20 | Min worlds before exit |
| N_WORLDS_BASE | 50 | Base worlds per spot |
| DIRECT_EVAL_WEIGHT | 0.90 | Direct eval vs CFR blend (now via compute_eval_weight) |
| CALIBRATION_MAX_WORLDS | 150 | Max calibration worlds |
| CFR_BUDGET_FRACTION | 0.10 | CFR time budget fraction |
| CALIBRATION_FRACTION | 0.15 | Calibration data fraction |

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


Current loop context:
{
  "request_id": "smoke_112",
  "incumbent_score": 0.7948,
  "incumbent_variant": "gen_trace_confidence_decay_0p1",
  "incumbent_params": {
    "TRACE_CONFIDENCE_FLOOR": 0.6,
    "TRACE_CONFIDENCE_DECAY": 0.1,
    "KNOCK_RISK_PENALTY_BASE": 0.05,
    "DW_RISK_SCALE": 0.012,
    "GIN_BONUS": 0.04,
    "EARLY_EXIT_CONFIDENCE_THRESHOLD": 2.5,
    "EARLY_EXIT_MIN_WORLDS": 20,
    "N_WORLDS_BASE": 60,
    "DIRECT_EVAL_WEIGHT": 0.9,
    "DECLINE_SAME_RANK_REDUCE": 0.35,
    "DECLINE_ADJ_SUIT_REDUCE": 0.3,
    "DECLINE_FAR_SUIT_REDUCE": 0.15,
    "CONTINUATION_MIX_ENABLED": true,
    "CONTINUATION_CHAMPION_WEIGHT": 0.8,
    "STOCK_DW_PRIOR_ENABLED": false,
    "STOCK_DW_PRIOR_STD": 3.5,
    "CALIBRATION_MAX_WORLDS": 150,
    "CFR_BUDGET_FRACTION": 0.1,
    "CALIBRATION_FRACTION": 0.15,
    "WORLD_GEN_OVERSAMPLE": 2
  },
  "recent_experiment_history": [
    {
      "id": 48,
      "variant": "gemini_gcli_0048",
      "score": 0.7555,
      "delta": -0.0064,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 49,
      "variant": "gemini_gcli_0049",
      "score": 0.7619,
      "delta": 0.0,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 50,
      "variant": "gemini_gcli_0050",
      "score": 0.7555,
      "delta": -0.0064,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 51,
      "variant": "gen_stock_dw_prior_enabled_off",
      "score": 0.7709,
      "delta": 0.009,
      "decision": "keep",
      "strategy": "local_fallback_unexplored",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 52,
      "variant": "gen_n_worlds_base_60",
      "score": 0.783,
      "delta": 0.0121,
      "decision": "keep",
      "strategy": "local_fallback_gradient_informed",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 53,
      "variant": "gen_continuation_champion_weight_0p75",
      "score": 0.7868,
      "delta": 0.0038,
      "decision": "discard",
      "strategy": "local_fallback_gradient_informed",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 54,
      "variant": "gen_dw_risk_scale_0p011",
      "score": 0.7668,
      "delta": -0.0162,
      "decision": "discard",
      "strategy": "local_fallback_fine_perturbation",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 55,
      "variant": "gen_trace_confidence_decay_0p1",
      "score": 0.7948,
      "delta": 0.0118,
      "decision": "keep",
      "strategy": "local_fallback_gradient_informed",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 56,
      "variant": "gen_early_exit_confidence_threshold_2p25",
      "score": 0.7769,
      "delta": -0.0179,
      "decision": "discard",
      "strategy": "local_fallback_gradient_informed",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 57,
      "variant": "gen_world_gen_oversample_1",
      "score": 0.7769,
      "delta": -0.0179,
      "decision": "discard",
      "strategy": "local_fallback_gradient_informed",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 58,
      "variant": "gen_early_exit_min_worlds_25",
      "score": 0.7792,
      "delta": -0.0156,
      "decision": "discard",
      "strategy": "local_fallback_gradient_informed",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 59,
      "variant": "gen_n_worlds_base_40",
      "score": null,
      "delta": null,
      "decision": "discard",
      "strategy": "local_fallback_gradient_informed",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 60,
      "variant": "gen_trace_confidence_decay_0p04",
      "score": null,
      "delta": null,
      "decision": "discard",
      "strategy": "local_fallback_reversal",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 61,
      "variant": "gen_trace_confidence_floor_0p63",
      "score": 0.7769,
      "delta": -0.0179,
      "decision": "discard",
      "strategy": "local_fallback_fine_perturbation",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 62,
      "variant": "gen_dw_risk_scale_0p01",
      "score": 0.7769,
      "delta": -0.0179,
      "decision": "discard",
      "strategy": "local_fallback_fine_perturbation",
      "source": "local_fallback_generator",
      "phase": 108
    }
  ],
  "constraints": {
    "editable_file": "train.py",
    "forbidden_files": [
      "prepare.py"
    ],
    "loop_owner": "agent_loop.py",
    "promotion_margin": 0.005,
    "preferred_edit_style": "exact string replacements against current train.py",
    "max_edit_count": 3,
    "keep_changes_reviewable": true
  }
}

Current train.py target functions:
```python
"""
Agent-editable Oracle candidate.

Everything in this file is fair game: abstraction, training schedule,
sampling choices, thresholding, regularization, and scoring heuristics.

prepare.py is fixed. program.md is human-authored.

Phase 76: Oracle Calibration Integrity Repair.
Corrects two calibration plumbing bugs from Phase 75:
  1. calibrate_threshold_on_training now uses the Phase 75 model path
     (predict_knock_probability_incremental_p75) instead of the legacy predictor,
     so calibration and eval are model-consistent.
  2. Adaptive calibration world-count is no longer clamped back to N_WORLDS_BASE.
     An explicit, documented cap at CALIBRATION_MAX_WORLDS is used instead.

Retains Phase 75 opponent-model improvements:
  - Upcard decline signal
  - Stock-size-aware deadwood prior
  - Mixed continuation policy blend
  - Trace-confidence-scaled risk adjustments
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random

# ... (skipped code) ...

def compute_eval_weight(
    hero_deadwood: int,
    stock_size: int,
    n_trace_events: int,
    ev_gap: float,
) -> float:
    """
    Compute how much to trust the direct EV evaluation vs the CFR prior.

    This function controls the blend between the direct belief-world
    EV estimate and the CFR policy prior. Higher output means "trust
    the direct evaluation more."

    The initial implementation returns the fixed incumbent value
    (DIRECT_EVAL_WEIGHT = 0.90). A smarter version could vary this
    weight based on game state — for example:
    - Lower trust when trace data is sparse (uncertain worlds)
    - Higher trust when EV gap is large (high-confidence decision)
    - Different trust levels at different stock sizes or DW levels
    - Non-linear schedules or sigmoid curves over state features

    Args:
        hero_deadwood: current hero deadwood count (0-10 when knockable)
        stock_size: cards remaining in the stock
        n_trace_events: number of public trace events observed
            (pickups + discards + declines)
        ev_gap: knock_ev - continue_ev from the current spot evaluation

    Returns:
        float in [0.0, 1.0]: weight for direct evaluation
        (1 - weight is applied to the CFR prior)
    """
    # ── MUTATION TARGET ──
    # Trust direct EV more when the decision is clear (large EV gap)
    # and when trace data is rich. Trust CFR prior more when uncertain.
    gap_confidence = 1.0 - math.exp(-abs(ev_gap) * 2.5)
    trace_confidence = min(1.0, n_trace_events / 10.0)
    
    dynamic_weight = (DIRECT_EVAL_WEIGHT - 0.15) + (0.15 * gap_confidence) + (0.10 * trace_confidence)
    return max(0.5, min(1.0, dynamic_weight))


# ... (skipped code) ...

def compute_trace_confidence_multiplier(
    n_trace_events: int,
    stock_size: int,
    hero_deadwood: int,
) -> float:
    """
    Compute risk-adjustment multiplier based on observation quality.

    This function controls how much risk penalty (undercut penalty,
    DW-scaled penalty) is applied to the knock payoff. A lower output
    means "we have good information about the opponent, so apply less
    risk penalty." A higher output means "less information, more caution."

    The initial implementation is a simple linear decay from 1.0,
    decreasing by TRACE_CONFIDENCE_DECAY per trace event, with floor
    at TRACE_CONFIDENCE_FLOOR. A smarter version could:
    - Use non-linear decay (e.g., exponential, sqrt)
    - Weight different event types differently (pickups vs discards)
    - Incorporate stock-size context (late-game trace is more valuable)
    - Factor in hero_deadwood (risk matters more at high DW)
    - Combine signals via a sigmoid or polynomial

    Args:
        n_trace_events: total public trace events (pickups + discards + declines)
        stock_size: cards remaining in the stock
        hero_deadwood: hero's current deadwood count

    Returns:
        float in [TRACE_CONFIDENCE_FLOOR, 1.0]: risk multiplier
        1.0 = full risk penalty, TRACE_CONFIDENCE_FLOOR = reduced penalty
    """
    # ── MUTATION TARGET ──
    # Exponential decay for smoother risk reduction
    multiplier = math.exp(-TRACE_CONFIDENCE_DECAY * n_trace_events)
    # Risk matters more at high deadwood; raise the floor for marginal knocks
    dynamic_floor = TRACE_CONFIDENCE_FLOOR + (0.015 * max(0, hero_deadwood - 4))
    return max(dynamic_floor, min(1.0, multiplier))


# ── Phase 75: Enhanced World Value Computation ────────────────────────

# ... (rest of file skipped for brevity) ...
```
