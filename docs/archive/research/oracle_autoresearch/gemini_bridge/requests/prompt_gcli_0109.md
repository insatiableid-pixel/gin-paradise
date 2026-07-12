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

### `compute_eval_weight(hero_deadwood, stock_size, n_trace_events, ev_gap, turn_number, n_pickups, n_discards, n_declines, pickup_pressure) → float`

Controls the blend weight between direct EV evaluation and CFR prior.
- **Current**: Trusts direct EV more when the decision is clear (`ev_gap`) and when trace data is rich (`n_trace_events`).
- **Opportunity**: reduce trust when `pickup_pressure` is high, as specific meld-seeking behavior makes our average world model less certain.

### `compute_trace_confidence_multiplier(n_trace_events, stock_size, hero_deadwood, turn_number, n_pickups, n_discards, n_declines, pickup_pressure) → float`

Controls how much risk penalty is applied to knock EV.
- **Current**: Uses exponential decay, deadwood floor, and stock-size awareness.
- **Opportunity**: use `pickup_pressure` to raise the risk floor more aggressively than raw `n_trace_events` alone.

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


Current loop context:
{
  "request_id": "gcli_0109",
  "incumbent_score": 0.801,
  "incumbent_variant": "gemini_gcli_0073",
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
      "id": 94,
      "variant": "gemini_gcli_0094",
      "score": 0.7905,
      "delta": -0.0105,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 95,
      "variant": "gemini_gcli_0095",
      "score": 0.7971,
      "delta": -0.0039,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 96,
      "variant": "gemini_gcli_0096",
      "score": 0.7759,
      "delta": -0.0251,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 97,
      "variant": "gemini_gcli_0097",
      "score": 0.7941,
      "delta": -0.0069,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 98,
      "variant": "gemini_gcli_0098",
      "score": 0.7905,
      "delta": -0.0105,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 99,
      "variant": "gemini_gcli_0099",
      "score": 0.7978,
      "delta": -0.0032,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 100,
      "variant": "gemini_gcli_0100",
      "score": null,
      "delta": null,
      "decision": "dry_run",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 101,
      "variant": "gemini_gcli_0101",
      "score": 0.7536,
      "delta": -0.0474,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 102,
      "variant": "gemini_gcli_0102",
      "score": 0.7628,
      "delta": -0.0382,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 103,
      "variant": "gemini_gcli_0103",
      "score": 0.7604,
      "delta": -0.0406,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 104,
      "variant": "gemini_gcli_0104",
      "score": 0.7601,
      "delta": -0.0409,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 105,
      "variant": "gemini_gcli_0105",
      "score": 0.7565,
      "delta": -0.0445,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 106,
      "variant": "gemini_gcli_0106",
      "score": 0.7596,
      "delta": -0.0414,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 107,
      "variant": "gemini_gcli_0107",
      "score": 0.7534,
      "delta": -0.0476,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 108,
      "variant": "gemini_gcli_0108",
      "score": 0.7595,
      "delta": -0.0415,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
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
    turn_number: int,
    n_pickups: int,
    n_discards: int,
    n_declines: int,
    pickup_pressure: float,
) -> float:
    """
    Compute how much to trust the direct EV evaluation vs the CFR prior.

    This function controls the blend between the direct belief-world
    EV estimate and the CFR policy prior. Higher output means "trust
    the direct evaluation more."

    Args:
        hero_deadwood: current hero deadwood count (0-10 when knockable)
        stock_size: cards remaining in the stock
        n_trace_events: total observed events (pickups + discards + declines)
        ev_gap: knock_ev - continue_ev from current evaluation
        turn_number: current hand turn number
        n_pickups: count of known opponent pickups from discard
        n_discards: count of known opponent discards
        n_declines: count of upcard declines observed
        pickup_pressure: float in [0, 1] representing pickup intensity

    Returns:
        float in [0.0, 1.0]: weight for direct evaluation
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
    turn_number: int,
    n_pickups: int,
    n_discards: int,
    n_declines: int,
    pickup_pressure: float,
) -> float:
    """
    Compute risk-adjustment multiplier based on observation quality.

    This function controls how much risk penalty (undercut penalty,
    DW-scaled penalty) is applied to the knock payoff. A lower output
    means "we have good information about the opponent, so apply less
    risk penalty." A higher output means "less information, more caution."

    Args:
        n_trace_events: total observed events (pickups + discards + declines)
        stock_size: cards remaining in the stock
        hero_deadwood: hero's current deadwood count
        turn_number: current hand turn number
        n_pickups: count of known opponent pickups from discard
        n_discards: count of known opponent discards
        n_declines: count of upcard declines observed
        pickup_pressure: float in [0, 1] representing pickup intensity

    Returns:
        float in [TRACE_CONFIDENCE_FLOOR, 1.0]: risk multiplier
    """
    # ── MUTATION TARGET ──
    # Exponential decay for smoother risk reduction, accelerated by game progress
    progress = max(0.0, 31.0 - stock_size) / 31.0
    multiplier = math.exp(-TRACE_CONFIDENCE_DECAY * n_trace_events * (1.0 + 0.5 * progress))
    # Risk matters more at high deadwood; lower the floor as game progresses
    dynamic_floor = TRACE_CONFIDENCE_FLOOR + (0.015 * max(0, hero_deadwood - 4)) - (0.05 * progress)
    return max(dynamic_floor, min(1.0, multiplier))


# ── Phase 75: Enhanced World Value Computation ────────────────────────

# ... (rest of file skipped for brevity) ...
```
