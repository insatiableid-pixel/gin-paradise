You are the candidate-generation component inside an Oracle autoresearch loop.
You must propose exactly one focused candidate edit for train.py.

Hard rules:
- Only propose edits for train.py.
- Do not modify prepare.py, the eval split, or the scoring formula.
- Prefer 1-3 exact string replacements.
- Every old_text must appear verbatim in the current train.py shown below.
- Keep the diff reviewable. Small, falsifiable ideas are better than sprawling rewrites.
- You may edit beyond the parameter registry if you have a strong reason, but still return exact string replacements.
- Return JSON only. No markdown fences, no prose before or after the JSON.

Return a JSON object with exactly these keys:
{
  "hypothesis": "short hypothesis",
  "edits": {"exact old text": "exact new text"},
  "param_names": ["symbol_a", "symbol_b"],
  "param_changes": {"symbol_a": {"old": 1, "new": 2, "delta": 1}},
  "rationale": "why this candidate is worth testing now",
  "confidence": "low" | "medium" | "high"
}

Human-authored program.md:
# Oracle Autoresearch Program

This folder is the Gin Rummy Oracle analogue of Karpathy's `autoresearch`
workflow. The human edits this file. The agent edits `train.py`.

## Setup

To kick off a new Oracle campaign:

1. Read `README.md`, `prepare.py`, `train.py`, and this `program.md`.
2. Verify `oracle_autoresearch/data/` exists. If it does not, run
   `python oracle_autoresearch/prepare.py` once.
3. Verify `oracle_autoresearch/loop_state.json` exists and has an incumbent.
4. Confirm Gemini CLI is installed and authenticated if you plan to use the
   autonomous loop.
5. Start the loop and let it keep iterating until manually stopped.

## Scope

What you can edit:
- `train.py` only

What you cannot edit:
- `prepare.py`
- the frozen benchmark data
- the scoring formula
- the rest of the repo unless explicitly told otherwise

## Objective

Optimize the scalar `score` emitted by `train.py`.
Higher is better.

This is a narrow but real Oracle benchmark, not the full final gin super-engine.
Today it focuses on low-stock knock/continue quality. The right behavior is:
- improve action quality against the held-out reference
- avoid reckless over-knocking
- reduce false positives
- reduce undercuts when choosing knock
- reduce EV regret

The point is to make the Oracle stronger without cheating the benchmark.

## Experiment Loop

The autoresearch loop owns keep/discard decisions:

1. Generate one focused candidate edit for `train.py`
2. Apply the edit
3. Benchmark it for the fixed time budget
4. Keep it only if it beats the incumbent by the configured margin
5. Otherwise restore the incumbent and move on
6. Log diffs, scores, rationale, and provenance every time

The loop should not stop to ask for permission once it starts. It should keep
trying ideas until manually interrupted.

## Simplicity Criterion

All else equal, simpler is better.

- A tiny gain with ugly complexity is usually not worth it.
- A comparable score with less code is a win.
- Focused, falsifiable edits beat sprawling rewrites.

## Good Directions

- Better abstractions or buckets for late-game knock decisions
- Better calibration of `P(knock)`
- Better use of world sampling under the fixed time budget
- Cleaner regularization or confidence heuristics
- Better ways to spend time between direct eval and priors
- Small structural edits in `train.py` if they are clearly justified

## Bad Directions

- Editing `prepare.py`
- Rebuilding the dataset every run
- Changing the fixed eval benchmark
- Expanding into unrelated engine work
- Optimizing for superficial knock rate alone
- Returning edits that are too large to review or reason about

## Current Research Context

- Phase 70 showed CFR-style work could improve held-out quality but also
  encourage over-knocking.
- The current sandbox is designed to reward stronger decisions without drifting
  into knock spam.
- Gemini CLI is now the preferred autonomous research boundary because it can
  actually be invoked headlessly in this environment.


Current agent prompt / research priors:
# Oracle Autoresearch Agent Prompt

You are an autonomous Oracle research agent running inside Gemini CLI.

## Your Mission

Edit `train.py` to improve the Oracle's knock/continue decision quality on a frozen low-stock benchmark. The score to beat is the **incumbent score** recorded in `loop_state.json`.

## What You Can Edit

- **Only `train.py`** in the `oracle_autoresearch/` directory.
- Do not edit `prepare.py`, the eval benchmark, or any other files.

## What The Score Measures

The score rewards:
- Matching the reference `best_action` on held-out eval spots
- Low overknock rate relative to solver_v6
- Low false-positive knock rate
- Low undercut rate when choosing to knock
- Low average EV regret

Higher score is better. Current incumbent: see `loop_state.json`.

## Phase 77 Ablation Findings (Your Prior)

From the Phase 77 campaign:

| Component              | Score  | Delta vs 0.5873 |
|------------------------|--------|------------------|
| trace_confidence_only  | 0.5719 | -0.0154 (best)   |
| stock_dw_prior_only    | 0.5626 | -0.0247          |
| upcard_decline_only    | 0.5545 | -0.0328          |
| mixed_continuation_only| 0.5523 | -0.0350          |
| phase74_baseline_repro | 0.5325 | -0.0548          |
| full_p75_bundle        | 0.4897 | -0.0976 (worst)  |

## Phase 78 Agent Search Findings (Additional Prior)

| Candidate                      | Score  | Delta    | Key insight                       |
|--------------------------------|--------|----------|-----------------------------------|
| refine_trace_floor_0.45        | 0.5735 | -0.0138  | Floor 0.45 too aggressive         |
| refine_trace_decay_0.12        | 0.4983 | -0.0890  | Decay 0.12 is catastrophic        |
| disable_mixed_continuation     | 0.5876 | +0.0003  | Essentially tied, near-neutral    |

**Key Implications:**
- Trace-confidence scaling is the strongest individual P75 component
- Trace floor 0.45 is too aggressive; current 0.6 is near-optimal
- Trace decay is very sensitive; increasing it is catastrophic
- Mixed continuation is nearly neutral — disabling it doesn't help enough alone
- The incumbent at 0.5873 appears robust

## How Candidates Are Generated (Phase 79)

Candidates are now generated **at runtime** by `candidate_generator.py`, NOT from a static list.

The generator reads THIS file, extracts live parameter values from `train.py`, and analyzes experiment history to propose novel edits using 5 strategies:

1. **Gradient-informed**: move in directions that previously scored closest to incumbent
2. **Unexplored**: test parameters that have never been perturbed
3. **Combination**: combine multiple near-neutral changes that might accumulate
4. **Fine perturbation**: systematic grid search around promising parameter regions
5. **Reversal**: try the opposite direction of changes that were harmful

## Editable Parameters

The following `train.py` parameters are in the mutable research surface:

| Parameter | Current | Group | Description |
|-----------|---------|-------|-------------|
| TRACE_CONFIDENCE_FLOOR | 0.6 | trace | Min risk multiplier |
| TRACE_CONFIDENCE_DECAY | 0.08 | trace | Per-event risk reduction |
| KNOCK_RISK_PENALTY_BASE | 0.05 | risk | Base undercut penalty |
| DW_RISK_SCALE | 0.012 | risk | Per-DW-point penalty |
| GIN_BONUS | 0.04 | risk | Bonus for gin hands |
| EARLY_EXIT_CONFIDENCE_THRESHOLD | 2.5 | eval | T-stat for early exit |
| EARLY_EXIT_MIN_WORLDS | 20 | eval | Min worlds before exit |
| N_WORLDS_BASE | 50 | sampling | Base worlds per spot |
| DIRECT_EVAL_WEIGHT | 0.70 | blend | Direct eval vs CFR blend |
| DECLINE_SAME_RANK_REDUCE | 0.35 | decline | Same-rank weight reduction |
| DECLINE_ADJ_SUIT_REDUCE | 0.30 | decline | Adjacent same-suit reduction |
| DECLINE_FAR_SUIT_REDUCE | 0.15 | decline | 2-distant same-suit reduction |
| CONTINUATION_MIX_ENABLED | True | continuation | Mixed continuation toggle |
| CONTINUATION_CHAMPION_WEIGHT | 0.80 | continuation | Champion policy weight |
| STOCK_DW_PRIOR_ENABLED | True | prior | DW prior toggle |
| STOCK_DW_PRIOR_STD | 3.5 | prior | Gaussian kernel spread |
| CALIBRATION_MAX_WORLDS | 100 | calibration | Max worlds for calibration |
| CFR_BUDGET_FRACTION | 0.10 | blend | CFR time budget fraction |
| CALIBRATION_FRACTION | 0.15 | calibration | Training data for calibration |
| WORLD_GEN_OVERSAMPLE | 2 | sampling | World generation oversample |

## Rules

1. Each edit should be a focused, testable hypothesis
2. Keep changes small and reviewable
3. Do not alter the eval set or scoring formula
4. Do not edit `prepare.py`
5. Prefer 1-3 exact string replacements against the current `train.py`
6. If you touch code outside the explicit parameter registry, keep the diff tight
7. Log your hypothesis clearly

## Output Contract

Return exactly one JSON object with these keys:

```json
{
  "hypothesis": "short hypothesis",
  "edits": {
    "exact old text": "exact new text"
  },
  "param_names": ["SYMBOL_A", "SYMBOL_B"],
  "param_changes": {
    "SYMBOL_A": { "old": 1, "new": 2, "delta": 1 }
  },
  "rationale": "why this candidate is worth testing now",
  "confidence": "low"
}
```

Additional requirements:
- `edits` must be exact string replacements that exist in the current `train.py`
- `confidence` must be `low`, `medium`, or `high`
- return JSON only, with no markdown fences or extra commentary

## Process

The `agent_loop.py` runner will:
1. Send THIS prompt, the current `program.md`, loop state, and full `train.py`
   through the Gemini CLI bridge
2. Parse your JSON candidate
3. Apply string replacement edits to `train.py`
4. Benchmark the modified file as a subprocess (300s budget)
5. Keep if it beats the incumbent by margin (`>= 0.005`), discard if not
6. Restore the incumbent on discard
7. Log full provenance: prompt hash, generation strategy, param changes, and
   request/response artifacts
8. Repeat until max experiments or queue exhaustion


Current loop context:
{
  "request_id": "gcli_0022",
  "incumbent_score": 0.6189,
  "incumbent_variant": "gemini_gcli_0019",
  "incumbent_params": {
    "TRACE_CONFIDENCE_FLOOR": 0.6,
    "TRACE_CONFIDENCE_DECAY": 0.08,
    "KNOCK_RISK_PENALTY_BASE": 0.05,
    "DW_RISK_SCALE": 0.012,
    "GIN_BONUS": 0.04,
    "EARLY_EXIT_CONFIDENCE_THRESHOLD": 2.5,
    "EARLY_EXIT_MIN_WORLDS": 20,
    "N_WORLDS_BASE": 50,
    "DIRECT_EVAL_WEIGHT": 0.85,
    "DECLINE_SAME_RANK_REDUCE": 0.35,
    "DECLINE_ADJ_SUIT_REDUCE": 0.3,
    "DECLINE_FAR_SUIT_REDUCE": 0.15,
    "CONTINUATION_MIX_ENABLED": true,
    "CONTINUATION_CHAMPION_WEIGHT": 0.8,
    "STOCK_DW_PRIOR_ENABLED": true,
    "STOCK_DW_PRIOR_STD": 3.5,
    "CALIBRATION_MAX_WORLDS": 100,
    "CFR_BUDGET_FRACTION": 0.1,
    "CALIBRATION_FRACTION": 0.15,
    "WORLD_GEN_OVERSAMPLE": 2
  },
  "recent_experiment_history": [
    {
      "id": 1,
      "variant": "phase74_baseline_repro",
      "score": 0.5325,
      "delta": -0.0548,
      "decision": "discard",
      "accuracy_vs_best": 0.65,
      "knock_rate": 0.5,
      "overknock_vs_v6": 0.075
    },
    {
      "id": 2,
      "variant": "upcard_decline_only",
      "score": 0.5545,
      "delta": -0.0328,
      "decision": "discard",
      "accuracy_vs_best": 0.6875,
      "knock_rate": 0.5375,
      "overknock_vs_v6": 0.1125
    },
    {
      "id": 3,
      "variant": "stock_dw_prior_only",
      "score": 0.5626,
      "delta": -0.0247,
      "decision": "discard",
      "accuracy_vs_best": 0.6875,
      "knock_rate": 0.5375,
      "overknock_vs_v6": 0.1125
    },
    {
      "id": 4,
      "variant": "mixed_continuation_only",
      "score": 0.5523,
      "delta": -0.035,
      "decision": "discard",
      "accuracy_vs_best": 0.65,
      "knock_rate": 0.475,
      "overknock_vs_v6": 0.05
    },
    {
      "id": 5,
      "variant": "trace_confidence_only",
      "score": 0.5719,
      "delta": -0.0154,
      "decision": "discard",
      "accuracy_vs_best": 0.7375,
      "knock_rate": 0.6125,
      "overknock_vs_v6": 0.1875
    },
    {
      "id": 6,
      "variant": "full_p75_bundle",
      "score": 0.4897,
      "delta": -0.0976,
      "decision": "discard",
      "accuracy_vs_best": 0.5625,
      "knock_rate": 0.3375,
      "overknock_vs_v6": 0.0
    },
    {
      "id": 7,
      "variant": "refine_trace_confidence_floor_045",
      "score": 0.5735,
      "delta": -0.0138,
      "decision": "discard",
      "strategy": null,
      "source": null,
      "phase": null
    },
    {
      "id": 8,
      "variant": "refine_trace_decay_012",
      "score": 0.4983,
      "delta": -0.089,
      "decision": "discard",
      "strategy": null,
      "source": null,
      "phase": null
    },
    {
      "id": 9,
      "variant": "disable_mixed_continuation",
      "score": 0.5876,
      "delta": 0.0003,
      "decision": "discard",
      "strategy": null,
      "source": null,
      "phase": null
    },
    {
      "id": 10,
      "variant": "combo_decline_weaker",
      "score": 0.4983,
      "delta": -0.089,
      "decision": "discard",
      "strategy": "combination",
      "source": null,
      "phase": 79
    },
    {
      "id": 11,
      "variant": "gen_continuation_champion_weight_0p85",
      "score": 0.5568,
      "delta": -0.0305,
      "decision": "discard",
      "strategy": "gradient_informed",
      "source": null,
      "phase": 79
    },
    {
      "id": 12,
      "variant": "antigravity_p80_resp_001",
      "score": 0.5134,
      "delta": -0.0739,
      "decision": "discard",
      "strategy": "antigravity_medium",
      "source": "claude_opus_4.6_antigravity",
      "phase": 80
    },
    {
      "id": 13,
      "variant": "gemini_gcli_0013",
      "score": 0.4897,
      "delta": -0.0976,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 14,
      "variant": "gemini_gcli_0014",
      "score": 0.5587,
      "delta": -0.0286,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 15,
      "variant": "gemini_gcli_0015",
      "score": 0.4986,
      "delta": -0.0887,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 16,
      "variant": "gemini_gcli_0016",
      "score": 0.5346,
      "delta": -0.0527,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 17,
      "variant": "gemini_gcli_0017",
      "score": 0.4966,
      "delta": -0.0907,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 18,
      "variant": "gemini_gcli_0018",
      "score": 0.4983,
      "delta": -0.089,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 19,
      "variant": "gemini_gcli_0019",
      "score": 0.6189,
      "delta": 0.0316,
      "decision": "keep",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 20,
      "variant": "gemini_gcli_0020",
      "score": 0.6134,
      "delta": -0.0055,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 21,
      "variant": "gemini_gcli_0021",
      "score": 0.5596,
      "delta": -0.0593,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
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
  },
  "param_registry": [
    {
      "name": "TRACE_CONFIDENCE_FLOOR",
      "min_val": 0.2,
      "max_val": 0.9,
      "step_sizes": [
        0.05,
        0.1,
        0.15
      ],
      "param_type": "float",
      "description": "Minimum risk multiplier when trace data is rich",
      "group": "trace"
    },
    {
      "name": "TRACE_CONFIDENCE_DECAY",
      "min_val": 0.02,
      "max_val": 0.2,
      "step_sizes": [
        0.02,
        0.04
      ],
      "param_type": "float",
      "description": "Per-event reduction in risk multiplier",
      "group": "trace"
    },
    {
      "name": "KNOCK_RISK_PENALTY_BASE",
      "min_val": 0.01,
      "max_val": 0.15,
      "step_sizes": [
        0.01,
        0.02
      ],
      "param_type": "float",
      "description": "Base undercut penalty on knock payoff",
      "group": "risk"
    },
    {
      "name": "DW_RISK_SCALE",
      "min_val": 0.004,
      "max_val": 0.025,
      "step_sizes": [
        0.002,
        0.004
      ],
      "param_type": "float",
      "description": "Per-deadwood-point penalty scale",
      "group": "risk"
    },
    {
      "name": "GIN_BONUS",
      "min_val": 0.01,
      "max_val": 0.1,
      "step_sizes": [
        0.01,
        0.02
      ],
      "param_type": "float",
      "description": "Bonus for gin hands",
      "group": "risk"
    },
    {
      "name": "EARLY_EXIT_CONFIDENCE_THRESHOLD",
      "min_val": 1.5,
      "max_val": 4.0,
      "step_sizes": [
        0.25,
        0.5
      ],
      "param_type": "float",
      "description": "T-stat threshold for early exit in incremental eval",
      "group": "eval"
    },
    {
      "name": "EARLY_EXIT_MIN_WORLDS",
      "min_val": 10,
      "max_val": 40,
      "step_sizes": [
        5,
        10
      ],
      "param_type": "int",
      "description": "Minimum worlds before early exit is allowed",
      "group": "eval"
    },
    {
      "name": "N_WORLDS_BASE",
      "min_val": 30,
      "max_val": 100,
      "step_sizes": [
        10,
        20
      ],
      "param_type": "int",
      "description": "Base worlds per spot for evaluation",
      "group": "sampling"
    },
    {
      "name": "DIRECT_EVAL_WEIGHT",
      "min_val": 0.5,
      "max_val": 1.0,
      "step_sizes": [
        0.05,
        0.1
      ],
      "param_type": "float",
      "description": "Blend weight: direct eval vs CFR prior",
      "group": "blend"
    },
    {
      "name": "DECLINE_SAME_RANK_REDUCE",
      "min_val": 0.1,
      "max_val": 0.6,
      "step_sizes": [
        0.05,
        0.1
      ],
      "param_type": "float",
      "description": "Weight reduction for same-rank cards on upcard decline",
      "group": "decline"
    },
    {
      "name": "DECLINE_ADJ_SUIT_REDUCE",
      "min_val": 0.1,
      "max_val": 0.55,
      "step_sizes": [
        0.05,
        0.1
      ],
      "param_type": "float",
      "description": "Weight reduction for adjacent same-suit on upcard decline",
      "group": "decline"
    },
    {
      "name": "DECLINE_FAR_SUIT_REDUCE",
      "min_val": 0.05,
      "max_val": 0.35,
      "step_sizes": [
        0.05,
        0.1
      ],
      "param_type": "float",
      "description": "Weight reduction for 2-distant same-suit on upcard decline",
      "group": "decline"
    },
    {
      "name": "CONTINUATION_MIX_ENABLED",
      "min_val": 0,
      "max_val": 1,
      "step_sizes": [
        1
      ],
      "param_type": "bool",
      "description": "Enable/disable mixed continuation policy blend",
      "group": "continuation"
    },
    {
      "name": "CONTINUATION_CHAMPION_WEIGHT",
      "min_val": 0.5,
      "max_val": 1.0,
      "step_sizes": [
        0.05,
        0.1
      ],
      "param_type": "float",
      "description": "Champion policy weight in mixed continuation",
      "group": "continuation"
    },
    {
      "name": "STOCK_DW_PRIOR_ENABLED",
      "min_val": 0,
      "max_val": 1,
      "step_sizes": [
        1
      ],
      "param_type": "bool",
      "description": "Enable/disable stock-size deadwood prior",
      "group": "prior"
    },
    {
      "name": "STOCK_DW_PRIOR_STD",
      "min_val": 1.5,
      "max_val": 6.0,
      "step_sizes": [
        0.5,
        1.0
      ],
      "param_type": "float",
      "description": "Gaussian kernel spread for deadwood prior",
      "group": "prior"
    },
    {
      "name": "CALIBRATION_MAX_WORLDS",
      "min_val": 50,
      "max_val": 200,
      "step_sizes": [
        25,
        50
      ],
      "param_type": "int",
      "description": "Max worlds for threshold calibration",
      "group": "calibration"
    },
    {
      "name": "CFR_BUDGET_FRACTION",
      "min_val": 0.0,
      "max_val": 0.25,
      "step_sizes": [
        0.05
      ],
      "param_type": "float",
      "description": "Fraction of time budget allocated to CFR prior",
      "group": "blend"
    },
    {
      "name": "CALIBRATION_FRACTION",
      "min_val": 0.05,
      "max_val": 0.3,
      "step_sizes": [
        0.05
      ],
      "param_type": "float",
      "description": "Fraction of training data for threshold calibration",
      "group": "calibration"
    },
    {
      "name": "WORLD_GEN_OVERSAMPLE",
      "min_val": 1,
      "max_val": 4,
      "step_sizes": [
        1
      ],
      "param_type": "int",
      "description": "Oversample factor for world generation",
      "group": "sampling"
    }
  ]
}

Current train.py source:
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
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from prepare import (
    ARTIFACT_DIR,
    SpotRecord,
    evaluate_probabilities,
    load_eval_spots,
    load_manifest,
    load_train_spots,
    prepare_lab,
)

try:
    from gin_rummy.endgame_solver import PublicState, evaluate_knock_now
    from gin_rummy.solver_v2 import (
        CONTINUATION_CHAMPION, CONTINUATION_GREEDY,
        simulate_continuation_policy,
    )
    from gin_rummy.belief_world_generator import generate_belief_weighted_worlds
    from gin_rummy.opponent_model import OpponentModel
    from gin_rummy.card import rank, suit, make_card, NUM_CARDS
except ModuleNotFoundError:
    import sys

    ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, ROOT_DIR)
    from gin_rummy.endgame_solver import PublicState, evaluate_knock_now
    from gin_rummy.solver_v2 import (
        CONTINUATION_CHAMPION, CONTINUATION_GREEDY,
        simulate_continuation_policy,
    )
    from gin_rummy.belief_world_generator import generate_belief_weighted_worlds
    from gin_rummy.opponent_model import OpponentModel
    from gin_rummy.card import rank, suit, make_card, NUM_CARDS


ACTIONS = ("knock", "continue")
ACTION_KNOCK = 0
ACTION_CONTINUE = 1
N_ACTIONS = 2

# ── Experiment knobs ──────────────────────────────────────────────────
TRAIN_TIME_BUDGET_SEC = 300.0
PROGRESS_EVERY_SEC = 30.0

# For the direct approach: base worlds per spot (adaptive scaling may increase)
N_WORLDS_BASE = 50
VALUE_NORMALIZER = 50.0

# Precommitted knock threshold (calibration may update this)
KNOCK_THRESHOLD = 0.55

# Risk adjustments applied to knock payoff
KNOCK_RISK_PENALTY_BASE = 0.05   # base undercut penalty
DW_RISK_SCALE = 0.012            # per-deadwood-point penalty
GIN_BONUS = 0.04                 # bonus for gin hands

# Phase 75: Trace-informed confidence scaling for risk adjustments
# More trace events → more confident in our world model → less risk penalty needed
TRACE_CONFIDENCE_FLOOR = 0.6     # minimum risk multiplier (when trace is rich)
TRACE_CONFIDENCE_DECAY = 0.08    # how much each trace event reduces risk multiplier

# Phase 75: Deadwood prior — stock-size-based expected opponent deadwood
# In late game (low stock), surviving opponents likely have organized hands
# These are heuristic priors, NOT tuned on eval set
STOCK_DW_PRIOR_ENABLED = True
STOCK_DW_PRIOR = {
    2: 4.0,   # Very late game: opponent likely has ~4 DW
    3: 5.0,
    4: 6.0,
    5: 7.5,
    6: 9.0,
}
STOCK_DW_PRIOR_STD = 3.5  # Gaussian kernel spread (intentionally soft)

# Phase 75: Mixed continuation policy
# Blend champion + greedy continuation to hedge against policy model error
CONTINUATION_MIX_ENABLED = True
CONTINUATION_CHAMPION_WEIGHT = 0.80  # 80% champion, 20% greedy
CONTINUATION_GREEDY_WEIGHT = 0.20

# Threshold candidates for calibration (on TRAINING data only)
# Phase 76: added denser coverage around 0.48-0.53 range per directive
THRESHOLD_CANDIDATES = [0.40, 0.45, 0.48, 0.50, 0.52, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]

# Phase 76: Explicit calibration world-count cap (honest, documented)
# Adaptive logic may compute more, but we cap here to stay within budget.
# This replaces the silent min(cal_n_worlds, N_WORLDS_BASE) clamp from Phase 75.
CALIBRATION_MAX_WORLDS = 100

# CFR component for "policy prior"
USE_CFR_PRIOR = True
CFR_BUDGET_FRACTION = 0.10  # Phase 74: reduced from 20% to 10%
N_WORLDS_TRAIN = 15
REGRET_CLIP = 4.0

# Info-set buckets for CFR prior
STOCK_BUCKETS = (2, 4, 6)
SCORE_DIFF_BUCKETS = (-30, -10, 10, 30)
DISCARD_BUCKETS = (5, 12, 20)
TURN_BUCKETS = (4, 8, 12, 16)
HERO_DW_BUCKETS = (0, 2, 5, 7, 9)
OPP_PICKUP_BUCKETS = (0, 1, 2, 4)
OPP_DISCARD_BUCKETS = (0, 2, 5, 8)
DECLINE_BUCKETS = (0, 2, 5, 8)
TRACE_BUCKETS = (0, 2, 4)

# Blend weight: how much to trust direct eval vs CFR prior
# 0 = pure CFR, 1 = pure direct eval
DIRECT_EVAL_WEIGHT = 0.85

# Calibration split: fraction of training data used for threshold calibration
CALIBRATION_FRACTION = 0.15
CALIBRATION_SEED = 73

# Phase 74: Early-exit confidence for incremental EV estimation
EARLY_EXIT_MIN_WORLDS = 20
EARLY_EXIT_CONFIDENCE_THRESHOLD = 2.5

# World generation oversample factor
WORLD_GEN_OVERSAMPLE = 2

# Phase 75: Upcard decline weight reduction parameters
DECLINE_SAME_RANK_REDUCE = 0.35    # Declined a card → less likely to need same rank
DECLINE_ADJ_SUIT_REDUCE = 0.30     # Less likely to need adjacent same-suit cards
DECLINE_FAR_SUIT_REDUCE = 0.15     # Weaker signal for 2-distant same suit


def bucketize(value: int, boundaries: Tuple[int, ...]) -> int:
    for idx, boundary in enumerate(boundaries):
        if value <= boundary:
            return idx
    return len(boundaries)


def compute_candidate_info_set(spot: SpotRecord) -> tuple:
    score_diff = spot.my_score - spot.opp_score
    trace_intensity = (
        len(spot.known_opponent_pickups) * 2
        + len(spot.known_opponent_discards)
        + len(spot.upcard_declines)
    )
    gin_live = 1 if (spot.hero_deadwood <= 1 and spot.hero_dw_card_count == 1) else 0

    return (
        bucketize(spot.stock_size, STOCK_BUCKETS),
        bucketize(score_diff, SCORE_DIFF_BUCKETS),
        bucketize(spot.discard_pile_size, DISCARD_BUCKETS),
        bucketize(spot.turn_number, TURN_BUCKETS),
        bucketize(spot.hero_deadwood, HERO_DW_BUCKETS),
        min(spot.hero_meld_count, 4),
        min(spot.hero_dw_card_count, 4),
        gin_live,
        bucketize(len(spot.known_opponent_pickups), OPP_PICKUP_BUCKETS),
        bucketize(len(spot.known_opponent_discards), OPP_DISCARD_BUCKETS),
        bucketize(len(spot.upcard_declines), DECLINE_BUCKETS),
        bucketize(trace_intensity, TRACE_BUCKETS),
    )


@dataclass
class CandidateStats:
    iterations: int
    elapsed_seconds: float
    info_sets: int
    iterations_per_sec: float
    exploitability_proxy: float
    mean_knock_probability: float
    direct_eval_spots: int
    cfr_budget_sec: float
    eval_budget_sec: float
    n_worlds_used: int
    calibrated_threshold: float
    calibration_method: str
    time_budget_requested: float
    time_budget_honored: bool


class CandidateStrategy:
    """Simple CFR strategy used as a prior."""
    def __init__(self) -> None:
        self.regret_sum = defaultdict(lambda: [0.0] * N_ACTIONS)
        self.strategy_sum = defaultdict(lambda: [0.0] * N_ACTIONS)
        self.visit_count = defaultdict(int)

    def get_strategy(self, info_set: tuple) -> List[float]:
        regrets = self.regret_sum[info_set]
        positive = [max(0.0, regret) for regret in regrets]
        total = sum(positive)
        if total > 0:
            return [value / total for value in positive]
        return [0.5, 0.5]

    def get_average_strategy(self, info_set: tuple) -> List[float]:
        sums = self.strategy_sum[info_set]
        total = sum(sums)
        if total > 0:
            return [value / total for value in sums]
        return [0.5, 0.5]

    def accumulate_strategy(self, info_set: tuple, strategy: List[float]) -> None:
        for action in range(N_ACTIONS):
            self.strategy_sum[info_set][action] += strategy[action]
        self.visit_count[info_set] += 1

    def update_regret(self, info_set: tuple, action: int, regret: float) -> None:
        clipped = max(-REGRET_CLIP, min(REGRET_CLIP, regret))
        self.regret_sum[info_set][action] += clipped

    def get_exploitability_proxy(self) -> float:
        if not self.regret_sum:
            return 1.0
        diffs = []
        for info_set in self.regret_sum:
            current = self.get_strategy(info_set)
            average = self.get_average_strategy(info_set)
            diffs.append(sum(abs(a - b) for a, b in zip(current, average)))
        return sum(diffs) / len(diffs) if diffs else 1.0

    def mean_knock_probability(self) -> float:
        if not self.strategy_sum:
            return 0.5
        values = [
            self.get_average_strategy(info_set)[ACTION_KNOCK]
            for info_set in self.strategy_sum
        ]
        return sum(values) / len(values) if values else 0.5


# ── Phase 75: Enhanced Card Weight Builder ────────────────────────────

def build_enhanced_card_weights(
    hero_hand: List[int],
    discard_pile: List[int],
    known_opponent_pickups: Optional[List[int]] = None,
    known_opponent_discards: Optional[List[int]] = None,
    upcard_declines: Optional[List[int]] = None,
) -> Dict[int, float]:
    """
    Phase 75: Enhanced card weight builder that integrates upcard declines.

    Standard OpponentModel handles pickups/discards. We add:
    - Upcard decline signal: cards opponent declined to pick up reduce
      likelihood of neighboring cards (opponent doesn't need that region).
    - This directly addresses a quality gap identified in the Phase 75 audit:
      upcard_declines data was available but never used in world generation.
    """
    model = OpponentModel()
    model.reset(hero_hand)

    # Mark discard pile
    for c in discard_pile:
        model.set_discard(c)

    # Process opponent pickup history
    if known_opponent_pickups:
        for c in known_opponent_pickups:
            if known_opponent_discards and c in known_opponent_discards:
                continue
            model.opponent_drew_discard(c)

    # Process opponent discard history
    if known_opponent_discards:
        for c in known_opponent_discards:
            model.opponent_discarded(c)

    # Phase 75: Process upcard declines — opponent chose not to pick these up
    # This means they likely don't need cards in this rank/suit neighborhood
    if upcard_declines:
        for declined_card in upcard_declines:
            # Don't process if card is already resolved
            if declined_card in set(hero_hand) or declined_card in set(discard_pile):
                continue
            r, s = rank(declined_card), suit(declined_card)

            # Reduce weight of same-rank cards (opponent doesn't want this rank set)
            for su in range(4):
                if su != s:
                    c = make_card(r, su)
                    if model.card_state[c] == 3:  # UNKNOWN
                        model.weight[c] = max(0.1, model.weight[c] - DECLINE_SAME_RANK_REDUCE)

            # Reduce weight of adjacent same-suit cards
            for dr in [-1, 1]:
                nr = r + dr
                if 0 <= nr <= 12:
                    c = make_card(nr, s)
                    if model.card_state[c] == 3:  # UNKNOWN
                        model.weight[c] = max(0.1, model.weight[c] - DECLINE_ADJ_SUIT_REDUCE)

            # Weaker reduction for 2-distant same-suit
            for dr in [-2, 2]:
                nr = r + dr
                if 0 <= nr <= 12:
                    c = make_card(nr, s)
                    if model.card_state[c] == 3:  # UNKNOWN
                        model.weight[c] = max(0.1, model.weight[c] - DECLINE_FAR_SUIT_REDUCE)

    # Build weight dict for all unknown cards
    hero_set = set(hero_hand)
    visible = set(discard_pile)
    weights = {}

    for card_id in range(NUM_CARDS):
        if card_id in hero_set or card_id in visible:
            continue
        weights[card_id] = model.weight[card_id]

    return weights


def compute_trace_confidence(spot: SpotRecord) -> float:
    """
    Phase 75: Compute a trace-confidence score based on how much public
    information we have about opponent behavior.

    More trace data means our world model is better informed, so we can
    apply less risk penalty (the worlds are more accurate).

    Returns a multiplier in [TRACE_CONFIDENCE_FLOOR, 1.0]:
      1.0 = no trace data, full risk penalty applies
      TRACE_CONFIDENCE_FLOOR = rich trace data, reduced risk penalty
    """
    n_events = (
        len(spot.known_opponent_pickups)
        + len(spot.known_opponent_discards)
        + len(spot.upcard_declines)
    )
    multiplier = 1.0 - TRACE_CONFIDENCE_DECAY * n_events
    return max(TRACE_CONFIDENCE_FLOOR, min(1.0, multiplier))


# ── Phase 75: Enhanced World Value Computation ────────────────────────

def compute_spot_values_p75(
    spot: SpotRecord,
    n_worlds: int,
    rng: random.Random,
) -> Tuple[float, float]:
    """
    Phase 75: Compute knock and continue EV with opponent-model quality improvements.

    Improvements over Phase 74:
    1. Enhanced card weights with upcard decline signal
    2. Stock-size-aware deadwood prior for world quality filtering
    3. Mixed continuation policy blend (champion + greedy)
    4. Trace-confidence-scaled risk adjustments
    """
    # Phase 75: Build enhanced card weights including decline signal
    card_weights = build_enhanced_card_weights(
        hero_hand=list(spot.hero_hand),
        discard_pile=list(spot.discard_pile),
        known_opponent_pickups=spot.known_opponent_pickups,
        known_opponent_discards=spot.known_opponent_discards,
        upcard_declines=spot.upcard_declines,
    )

    # Phase 75: Stock-size-aware deadwood prior
    predicted_mean_dw = None
    if STOCK_DW_PRIOR_ENABLED and spot.stock_size in STOCK_DW_PRIOR:
        predicted_mean_dw = STOCK_DW_PRIOR[spot.stock_size]

    worlds, _weights = generate_belief_weighted_worlds(
        hero_hand=list(spot.hero_hand),
        discard_pile=list(spot.discard_pile),
        stock_size=spot.stock_size,
        n_worlds=n_worlds,
        rng=random.Random(rng.randint(0, 2**31 - 1)),
        card_weights=card_weights,
        known_opponent_pickups=spot.known_opponent_pickups,
        known_opponent_discards=spot.known_opponent_discards,
        predicted_mean_opp_dw=predicted_mean_dw,
        quality_weight_mode='gaussian' if predicted_mean_dw is not None else 'none',
        oversample_factor=WORLD_GEN_OVERSAMPLE,
    )

    if not worlds:
        return 0.0, 0.0

    public_state = PublicState(
        discard_pile=list(spot.discard_pile),
        turn_number=spot.turn_number,
        stock_size=spot.stock_size,
        my_score=spot.my_score,
        opp_score=spot.opp_score,
    )

    # Phase 75: Trace-confidence-scaled risk adjustment
    trace_conf = compute_trace_confidence(spot)
    dw = spot.hero_deadwood
    if dw == 0:
        dw_adjustment = GIN_BONUS * VALUE_NORMALIZER
    else:
        # Scale DW risk by trace confidence: more trace data → less penalty
        dw_adjustment = -DW_RISK_SCALE * dw * VALUE_NORMALIZER * trace_conf

    knock_total = 0.0
    continue_total = 0.0

    hero_hand_list = list(spot.hero_hand)

    for world_index, (opp_hand, stock) in enumerate(worlds):
        opp_hand_list = list(opp_hand)
        knock_outcome = evaluate_knock_now(hero_hand_list, opp_hand_list)
        knock_payoff = knock_outcome.hero_points - knock_outcome.opp_points

        # Phase 75: Mixed continuation policy
        if CONTINUATION_MIX_ENABLED:
            # Champion continuation
            champion_outcome = simulate_continuation_policy(
                hero_hand=hero_hand_list,
                opp_hand=opp_hand_list,
                stock=list(stock),
                public_state=public_state,
                rng=random.Random(rng.randint(0, 2**31 - 1) + world_index),
                mode=CONTINUATION_CHAMPION,
            )
            champion_payoff = champion_outcome.hero_points - champion_outcome.opp_points

            # Greedy continuation (cheaper, different policy model)
            greedy_outcome = simulate_continuation_policy(
                hero_hand=hero_hand_list,
                opp_hand=opp_hand_list,
                stock=list(stock),
                public_state=public_state,
                rng=random.Random(rng.randint(0, 2**31 - 1) + world_index + 500000),
                mode=CONTINUATION_GREEDY,
            )
            greedy_payoff = greedy_outcome.hero_points - greedy_outcome.opp_points

            continue_payoff = (
                CONTINUATION_CHAMPION_WEIGHT * champion_payoff
                + CONTINUATION_GREEDY_WEIGHT * greedy_payoff
            )
        else:
            continue_outcome = simulate_continuation_policy(
                hero_hand=hero_hand_list,
                opp_hand=opp_hand_list,
                stock=list(stock),
                public_state=public_state,
                rng=random.Random(rng.randint(0, 2**31 - 1) + world_index),
                mode=CONTINUATION_CHAMPION,
            )
            continue_payoff = continue_outcome.hero_points - continue_outcome.opp_points

        # Apply risk adjustments to knock
        knock_payoff += dw_adjustment
        if knock_outcome.undercut:
            knock_payoff -= KNOCK_RISK_PENALTY_BASE * VALUE_NORMALIZER * trace_conf

        knock_total += knock_payoff
        continue_total += continue_payoff

    mean_knock = knock_total / len(worlds)
    mean_continue = continue_total / len(worlds)
    return (mean_knock / VALUE_NORMALIZER, mean_continue / VALUE_NORMALIZER)


def compute_spot_values_incremental_p75(
    spot: SpotRecord,
    n_worlds: int,
    rng: random.Random,
) -> Tuple[float, float, int]:
    """
    Phase 75: Compute knock and continue EV with early-exit optimization
    AND opponent-model quality improvements.

    Returns (knock_ev, continue_ev, worlds_actually_used).
    """
    # Phase 75: Enhanced card weights with decline signal
    card_weights = build_enhanced_card_weights(
        hero_hand=list(spot.hero_hand),
        discard_pile=list(spot.discard_pile),
        known_opponent_pickups=spot.known_opponent_pickups,
        known_opponent_discards=spot.known_opponent_discards,
        upcard_declines=spot.upcard_declines,
    )

    # Phase 75: Stock-size-aware deadwood prior
    predicted_mean_dw = None
    if STOCK_DW_PRIOR_ENABLED and spot.stock_size in STOCK_DW_PRIOR:
        predicted_mean_dw = STOCK_DW_PRIOR[spot.stock_size]

    worlds, _weights = generate_belief_weighted_worlds(
        hero_hand=list(spot.hero_hand),
        discard_pile=list(spot.discard_pile),
        stock_size=spot.stock_size,
        n_worlds=n_worlds,
        rng=random.Random(rng.randint(0, 2**31 - 1)),
        card_weights=card_weights,
        known_opponent_pickups=spot.known_opponent_pickups,
        known_opponent_discards=spot.known_opponent_discards,
        predicted_mean_opp_dw=predicted_mean_dw,
        quality_weight_mode='gaussian' if predicted_mean_dw is not None else 'none',
        oversample_factor=WORLD_GEN_OVERSAMPLE,
    )

    if not worlds:
        return 0.0, 0.0, 0

    # Pre-compute shared objects once per spot
    hero_hand_list = list(spot.hero_hand)
    public_state = PublicState(
        discard_pile=list(spot.discard_pile),
        turn_number=spot.turn_number,
        stock_size=spot.stock_size,
        my_score=spot.my_score,
        opp_score=spot.opp_score,
    )

    # Phase 75: Trace-confidence-scaled risk adjustment
    trace_conf = compute_trace_confidence(spot)
    dw = spot.hero_deadwood
    if dw == 0:
        dw_adjustment = GIN_BONUS * VALUE_NORMALIZER
    else:
        dw_adjustment = -DW_RISK_SCALE * dw * VALUE_NORMALIZER * trace_conf

    knock_total = 0.0
    continue_total = 0.0
    gap_values = []
    worlds_used = 0

    for world_index, (opp_hand, stock) in enumerate(worlds):
        opp_hand_list = list(opp_hand)
        knock_outcome = evaluate_knock_now(hero_hand_list, opp_hand_list)
        knock_payoff = knock_outcome.hero_points - knock_outcome.opp_points

        # Phase 75: Mixed continuation policy
        if CONTINUATION_MIX_ENABLED:
            champion_outcome = simulate_continuation_policy(
                hero_hand=hero_hand_list,
                opp_hand=opp_hand_list,
                stock=list(stock),
                public_state=public_state,
                rng=random.Random(rng.randint(0, 2**31 - 1) + world_index),
                mode=CONTINUATION_CHAMPION,
            )
            champion_payoff = champion_outcome.hero_points - champion_outcome.opp_points

            greedy_outcome = simulate_continuation_policy(
                hero_hand=hero_hand_list,
                opp_hand=opp_hand_list,
                stock=list(stock),
                public_state=public_state,
                rng=random.Random(rng.randint(0, 2**31 - 1) + world_index + 500000),
                mode=CONTINUATION_GREEDY,
            )
            greedy_payoff = greedy_outcome.hero_points - greedy_outcome.opp_points

            continue_payoff = (
                CONTINUATION_CHAMPION_WEIGHT * champion_payoff
                + CONTINUATION_GREEDY_WEIGHT * greedy_payoff
            )
        else:
            continue_outcome = simulate_continuation_policy(
                hero_hand=hero_hand_list,
                opp_hand=opp_hand_list,
                stock=list(stock),
                public_state=public_state,
                rng=random.Random(rng.randint(0, 2**31 - 1) + world_index),
                mode=CONTINUATION_CHAMPION,
            )
            continue_payoff = continue_outcome.hero_points - continue_outcome.opp_points

        # Apply risk adjustments to knock
        knock_payoff += dw_adjustment
        if knock_outcome.undercut:
            knock_payoff -= KNOCK_RISK_PENALTY_BASE * VALUE_NORMALIZER * trace_conf

        knock_total += knock_payoff
        continue_total += continue_payoff
        worlds_used += 1

        # Track per-world gap for early-exit
        gap_values.append(knock_payoff - continue_payoff)

        # Early-exit check after minimum worlds
        if worlds_used >= EARLY_EXIT_MIN_WORLDS and worlds_used < len(worlds):
            n = worlds_used
            mean_gap = sum(gap_values) / n
            if n >= 3:
                variance = sum((g - mean_gap) ** 2 for g in gap_values) / (n - 1)
                if variance > 0:
                    stderr = (variance / n) ** 0.5
                    t_stat = abs(mean_gap) / stderr
                    if t_stat >= EARLY_EXIT_CONFIDENCE_THRESHOLD:
                        break

    mean_knock = knock_total / worlds_used
    mean_continue = continue_total / worlds_used
    return (mean_knock / VALUE_NORMALIZER, mean_continue / VALUE_NORMALIZER, worlds_used)


# ── Legacy compute_spot_values (used in CFR training) ─────────────────

def compute_spot_values(
    spot: SpotRecord,
    n_worlds: int,
    rng: random.Random,
) -> Tuple[float, float]:
    """Compute knock and continue EV for a spot using world sampling (legacy path for CFR)."""
    worlds, _weights = generate_belief_weighted_worlds(
        hero_hand=list(spot.hero_hand),
        discard_pile=list(spot.discard_pile),
        stock_size=spot.stock_size,
        n_worlds=n_worlds,
        rng=random.Random(rng.randint(0, 2**31 - 1)),
        known_opponent_pickups=spot.known_opponent_pickups,
        known_opponent_discards=spot.known_opponent_discards,
        oversample_factor=WORLD_GEN_OVERSAMPLE,
    )

    if not worlds:
        return 0.0, 0.0

    public_state = PublicState(
        discard_pile=list(spot.discard_pile),
        turn_number=spot.turn_number,
        stock_size=spot.stock_size,
        my_score=spot.my_score,
        opp_score=spot.opp_score,
    )

    knock_total = 0.0
    continue_total = 0.0

    for world_index, (opp_hand, stock) in enumerate(worlds):
        knock_outcome = evaluate_knock_now(list(spot.hero_hand), list(opp_hand))
        knock_payoff = knock_outcome.hero_points - knock_outcome.opp_points

        continue_outcome = simulate_continuation_policy(
            hero_hand=list(spot.hero_hand),
            opp_hand=list(opp_hand),
            stock=list(stock),
            public_state=public_state,
            rng=random.Random(rng.randint(0, 2**31 - 1) + world_index),
            mode=CONTINUATION_CHAMPION,
        )
        continue_payoff = continue_outcome.hero_points - continue_outcome.opp_points

        # Graduated deadwood risk
        dw = spot.hero_deadwood
        if dw == 0:
            knock_payoff += GIN_BONUS * VALUE_NORMALIZER
        else:
            knock_payoff -= DW_RISK_SCALE * dw * VALUE_NORMALIZER

        # Undercut penalty
        if knock_outcome.undercut:
            knock_payoff -= KNOCK_RISK_PENALTY_BASE * VALUE_NORMALIZER

        knock_total += knock_payoff
        continue_total += continue_payoff

    mean_knock = knock_total / len(worlds)
    mean_continue = continue_total / len(worlds)
    return (mean_knock / VALUE_NORMALIZER, mean_continue / VALUE_NORMALIZER)


def train_cfr_prior(
    strategy: CandidateStrategy,
    spots: List[SpotRecord],
    time_budget_sec: float,
    seed: int = 71,
) -> int:
    """Train a quick CFR prior on training data."""
    rng = random.Random(seed)
    start = time.perf_counter()
    iterations = 0

    while time.perf_counter() - start < time_budget_sec:
        spot = rng.choice(spots)
        info_set = compute_candidate_info_set(spot)
        strat = strategy.get_strategy(info_set)
        strategy.accumulate_strategy(info_set, strat)

        knock_value, continue_value = compute_spot_values(spot, N_WORLDS_TRAIN, rng)
        expected_value = strat[ACTION_KNOCK] * knock_value + strat[ACTION_CONTINUE] * continue_value

        strategy.update_regret(info_set, ACTION_KNOCK, knock_value - expected_value)
        strategy.update_regret(info_set, ACTION_CONTINUE, continue_value - expected_value)

        iterations += 1
        if iterations % 500 == 0:
            elapsed = time.perf_counter() - start
            print(
                f"  CFR prior: t={elapsed:5.1f}s | iter={iterations:6d} | "
                f"info_sets={len(strategy.regret_sum):4d} | "
                f"mean_p_knock={strategy.mean_knock_probability():.4f}"
            )

    return iterations


def predict_knock_probability_direct(
    spot: SpotRecord,
    rng: random.Random,
    n_worlds: int,
    strategy: CandidateStrategy = None,
) -> float:
    """Compute knock probability via direct EV estimation, optionally blended with CFR prior."""
    # Direct evaluation with adaptive world count
    knock_ev, continue_ev = compute_spot_values(spot, n_worlds, rng)

    # Convert EV gap to a probability via sigmoid mapping
    ev_gap = knock_ev - continue_ev
    direct_prob = 1.0 / (1.0 + math.exp(-ev_gap * 3.0))

    if strategy is not None and USE_CFR_PRIOR:
        info_set = compute_candidate_info_set(spot)
        cfr_prob = strategy.get_average_strategy(info_set)[ACTION_KNOCK]
        # Blend direct and CFR
        blended = DIRECT_EVAL_WEIGHT * direct_prob + (1.0 - DIRECT_EVAL_WEIGHT) * cfr_prob
        return blended
    else:
        return direct_prob


def predict_knock_probability_incremental_p75(
    spot: SpotRecord,
    rng: random.Random,
    n_worlds: int,
    strategy: CandidateStrategy = None,
) -> Tuple[float, int]:
    """
    Phase 75: Compute knock probability with early-exit + opponent-model quality improvements.
    Returns (probability, worlds_actually_used).
    """
    knock_ev, continue_ev, worlds_used = compute_spot_values_incremental_p75(
        spot, n_worlds, rng
    )

    ev_gap = knock_ev - continue_ev
    direct_prob = 1.0 / (1.0 + math.exp(-ev_gap * 3.0))

    if strategy is not None and USE_CFR_PRIOR:
        info_set = compute_candidate_info_set(spot)
        cfr_prob = strategy.get_average_strategy(info_set)[ACTION_KNOCK]
        blended = DIRECT_EVAL_WEIGHT * direct_prob + (1.0 - DIRECT_EVAL_WEIGHT) * cfr_prob
        return blended, worlds_used
    else:
        return direct_prob, worlds_used


def calibrate_threshold_on_training(
    strategy: CandidateStrategy,
    calibration_spots: List[SpotRecord],
    n_worlds: int,
    rng: random.Random,
    manifest: Dict,
    use_p75_model: bool = True,
) -> Tuple[float, Dict]:
    """
    Phase 76: Select the best threshold using ONLY calibration data.

    CRITICAL CHANGE from Phase 75:
    - Calibration probabilities now come from predict_knock_probability_incremental_p75
      (the same candidate path scored at eval time), NOT predict_knock_probability_direct.
    - The reference EV computation also uses compute_spot_values_p75 when the P75 model
      is enabled, for consistency.
    """
    print(f"\n--- Calibrating threshold on {len(calibration_spots)} training spots ---")
    print(f"  Phase 76: calibration predictor = {'P75 incremental' if use_p75_model else 'legacy direct'}")
    print(f"  Phase 76: calibration n_worlds = {n_worlds}")

    # Compute probabilities for calibration spots using the SAME model path as eval
    cal_probabilities = []
    cal_worlds_used_total = 0
    for i, spot in enumerate(calibration_spots):
        if use_p75_model:
            prob, worlds_used = predict_knock_probability_incremental_p75(
                spot, rng, n_worlds, strategy=strategy
            )
            cal_worlds_used_total += worlds_used
        else:
            prob = predict_knock_probability_direct(spot, rng, n_worlds, strategy=strategy)
            cal_worlds_used_total += n_worlds
        cal_probabilities.append(prob)
        if (i + 1) % 20 == 0:
            print(f"  Calibrated {i+1}/{len(calibration_spots)} spots")

    print(f"  Total calibration worlds consumed: {cal_worlds_used_total}")

    # For each calibration spot, determine the ground-truth best action
    # Phase 76: use the P75 model path for reference EV too, for consistency
    cal_reference_entries = []
    for spot in calibration_spots:
        ref_rng = random.Random(rng.randint(0, 2**31 - 1))
        if use_p75_model:
            knock_ev_cal, continue_ev_cal = compute_spot_values_p75(
                spot, 30, ref_rng
            )
        else:
            knock_ev_cal, continue_ev_cal = compute_spot_values(
                spot, 30, ref_rng
            )
        best_action = "knock" if knock_ev_cal >= continue_ev_cal else "continue"
        cal_reference_entries.append({
            "best_action": best_action,
            "knock_ev": knock_ev_cal,
            "continue_ev": continue_ev_cal,
            "ev_gap": abs(knock_ev_cal - continue_ev_cal),
            "actual_outcome": spot.outcome,
            "hero_deadwood": spot.hero_deadwood,
            "stock_size": spot.stock_size,
            "n_worlds": 30,
            "v6_action": "continue",
            "v6_error": None,
        })

    # Sweep thresholds on calibration data
    best_threshold = KNOCK_THRESHOLD
    best_score = -999.0
    sweep_detail = {}

    baseline_for_cal = manifest["baseline"]

    for t in THRESHOLD_CANDIDATES:
        cal_actions = ["knock" if p >= t else "continue" for p in cal_probabilities]

        from prepare import score_actions, _evaluate_actions_from_entries
        cal_metrics = _evaluate_actions_from_entries(cal_reference_entries, cal_actions)
        cal_score_result = score_actions(cal_reference_entries, cal_actions, baseline_for_cal)
        cal_score = cal_score_result["score"]

        sweep_detail[str(t)] = {
            "score": round(cal_score, 4),
            "knock_rate": cal_score_result["knock_rate"],
            "accuracy": cal_score_result["accuracy_vs_best"],
        }

        print(
            f"  cal_threshold={t:.2f} => score={cal_score:.4f} "
            f"knock_rate={cal_score_result['knock_rate']:.4f} "
            f"acc={cal_score_result['accuracy_vs_best']:.4f}"
        )

        if cal_score > best_score:
            best_score = cal_score
            best_threshold = t

    print(f"\n  Calibrated threshold: {best_threshold:.2f} (cal_score={best_score:.4f})")
    return best_threshold, sweep_detail


def compute_adaptive_world_count(
    n_spots: int,
    remaining_time_sec: float,
    time_per_world_spot_estimate: float,
) -> int:
    """
    Given remaining time budget, compute how many worlds per spot we can afford.
    Minimum is N_WORLDS_BASE (50), maximum is capped at 200.
    """
    if remaining_time_sec <= 0 or time_per_world_spot_estimate <= 0:
        return N_WORLDS_BASE

    total_world_spots = remaining_time_sec / time_per_world_spot_estimate
    worlds_per_spot = int(total_world_spots / n_spots)

    return max(N_WORLDS_BASE, min(worlds_per_spot, 200))


def build_result_payload(
    stats: CandidateStats,
    manifest: Dict[str, Any],
    probabilities: List[float],
    threshold: float,
    train_time_budget_sec: float,
    calibration_sweep: Dict = None,
    eval_diagnostic_sweep: Dict = None,
    phase75_changes: Dict = None,
) -> Dict[str, Any]:
    metrics = evaluate_probabilities(probabilities, threshold, manifest=manifest)
    payload = {
        "config": {
            "train_time_budget_sec": train_time_budget_sec,
            "n_worlds_base": N_WORLDS_BASE,
            "n_worlds_used": stats.n_worlds_used,
            "n_worlds_train": N_WORLDS_TRAIN,
            "value_normalizer": VALUE_NORMALIZER,
            "knock_threshold": threshold,
            "knock_risk_penalty_base": KNOCK_RISK_PENALTY_BASE,
            "dw_risk_scale": DW_RISK_SCALE,
            "gin_bonus": GIN_BONUS,
            "regret_clip": REGRET_CLIP,
            "direct_eval_weight": DIRECT_EVAL_WEIGHT,
            "use_cfr_prior": USE_CFR_PRIOR,
            "cfr_budget_fraction": CFR_BUDGET_FRACTION,
            "cfr_budget_sec": round(stats.cfr_budget_sec, 2),
            "calibration_fraction": CALIBRATION_FRACTION,
            "calibration_seed": CALIBRATION_SEED,
            "threshold_selection_method": stats.calibration_method,
            "phase74_early_exit_min_worlds": EARLY_EXIT_MIN_WORLDS,
            "phase74_early_exit_confidence": EARLY_EXIT_CONFIDENCE_THRESHOLD,
            # Phase 75 config
            "phase75_stock_dw_prior_enabled": STOCK_DW_PRIOR_ENABLED,
            "phase75_stock_dw_prior_std": STOCK_DW_PRIOR_STD,
            "phase75_continuation_mix_enabled": CONTINUATION_MIX_ENABLED,
            "phase75_champion_weight": CONTINUATION_CHAMPION_WEIGHT,
            "phase75_greedy_weight": CONTINUATION_GREEDY_WEIGHT,
            "phase75_trace_confidence_floor": TRACE_CONFIDENCE_FLOOR,
            "phase75_trace_confidence_decay": TRACE_CONFIDENCE_DECAY,
            "phase75_decline_same_rank_reduce": DECLINE_SAME_RANK_REDUCE,
            "phase75_decline_adj_suit_reduce": DECLINE_ADJ_SUIT_REDUCE,
        },
        "protocol_compliance": {
            "time_budget_requested_sec": stats.time_budget_requested,
            "time_budget_honored": stats.time_budget_honored,
            "actual_elapsed_sec": stats.elapsed_seconds,
            "cfr_phase_sec": round(stats.cfr_budget_sec, 2),
            "eval_phase_sec": round(stats.eval_budget_sec, 2),
            "threshold_selected_on": "training_calibration_slice",
            "eval_set_touched_for": "final_scoring_only",
        },
        "training": {
            "iterations": stats.iterations,
            "elapsed_seconds": stats.elapsed_seconds,
            "iterations_per_sec": stats.iterations_per_sec,
            "info_sets": stats.info_sets,
            "exploitability_proxy": stats.exploitability_proxy,
            "mean_knock_probability": stats.mean_knock_probability,
            "direct_eval_spots": stats.direct_eval_spots,
        },
        "baseline": manifest["baseline"],
        "metrics": metrics,
    }
    if calibration_sweep:
        payload["calibration_sweep_on_training"] = calibration_sweep
    if eval_diagnostic_sweep:
        payload["eval_diagnostic_sweep_NOT_USED_FOR_SELECTION"] = eval_diagnostic_sweep
    if phase75_changes:
        payload["phase75_opponent_model_changes"] = phase75_changes
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one Oracle autoresearch experiment")
    parser.add_argument(
        "--time-budget",
        type=float,
        default=TRAIN_TIME_BUDGET_SEC,
        help="Training time budget in seconds (honored in full)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=None,
        help="Precommitted threshold (skips calibration if set)",
    )
    parser.add_argument(
        "--tag",
        type=str,
        default="latest",
        help="Short label used in the output filename",
    )
    parser.add_argument(
        "--sweep",
        action="store_true",
        help="Report eval-set sweep as diagnostic (NOT used for selection)",
    )
    parser.add_argument(
        "--no-early-exit",
        action="store_true",
        help="Disable Phase 74 early-exit optimization (for comparison)",
    )
    parser.add_argument(
        "--no-p75-model",
        action="store_true",
        help="Disable Phase 75 opponent-model improvements (for comparison)",
    )
    args = parser.parse_args()

    use_early_exit = not args.no_early_exit
    use_p75_model = not args.no_p75_model

    if not os.path.exists(ARTIFACT_DIR):
        os.makedirs(ARTIFACT_DIR, exist_ok=True)

    prepare_lab(force=False)
    manifest = load_manifest()
    train_spots = load_train_spots()
    eval_spots = load_eval_spots()

    # ── Budget allocation ─────────────────────────────────────────────
    total_budget = args.time_budget
    cfr_budget = total_budget * CFR_BUDGET_FRACTION if USE_CFR_PRIOR else 0.0
    remaining_after_cfr = total_budget - cfr_budget

    print("=" * 72)
    print("ORACLE AUTORESEARCH EXPERIMENT (Phase 76: Calibration Integrity Repair)")
    print("=" * 72)
    print(f"Train spots:        {len(train_spots)}")
    print(f"Eval spots:         {len(eval_spots)}")
    print(f"Time budget (sec):  {total_budget}")
    print(f"  CFR phase:        {cfr_budget:.1f}s ({CFR_BUDGET_FRACTION*100:.0f}%)")
    print(f"  Eval+cal phase:   {remaining_after_cfr:.1f}s ({(1-CFR_BUDGET_FRACTION)*100:.0f}%)")
    print(f"Baseline V6 score:  {manifest['baseline']['v6_score']:.4f}")
    print(f"Phase 74 best:      0.5873")
    print(f"Threshold method:   {'precommitted' if args.threshold else 'calibration on training'}")
    print(f"Early-exit:         {'ENABLED' if use_early_exit else 'DISABLED'}")
    print(f"Phase 75 model:     {'ENABLED' if use_p75_model else 'DISABLED'}")
    print(f"Calibration cap:    {CALIBRATION_MAX_WORLDS} worlds (Phase 76 explicit cap)")
    if use_p75_model:
        print(f"  Decline signal:   ENABLED")
        print(f"  DW prior:         {'ENABLED' if STOCK_DW_PRIOR_ENABLED else 'DISABLED'}")
        print(f"  Mixed continuation: {'ENABLED' if CONTINUATION_MIX_ENABLED else 'DISABLED'}")
        print(f"  Trace confidence: floor={TRACE_CONFIDENCE_FLOOR}, decay={TRACE_CONFIDENCE_DECAY}")
    print("  Calibration uses: SAME candidate path as eval (Phase 76 fix)")
    print("=" * 72)

    overall_start = time.perf_counter()

    # ── Phase 1: Train CFR prior (10% of budget) ─────────────────────
    strategy = CandidateStrategy()
    cfr_iters = 0
    cfr_actual_sec = 0.0
    if USE_CFR_PRIOR:
        print(f"\n--- Phase 1: Training CFR prior ({cfr_budget:.1f}s budget) ---")
        cfr_start = time.perf_counter()
        cfr_iters = train_cfr_prior(strategy, train_spots, cfr_budget)
        cfr_actual_sec = time.perf_counter() - cfr_start
        print(f"  CFR prior done: {cfr_iters} iters, {len(strategy.regret_sum)} info sets, {cfr_actual_sec:.1f}s")

    # ── Phase 2: Calibrate threshold on training data ─────────────────
    cal_rng = random.Random(CALIBRATION_SEED)
    n_cal = max(20, int(len(train_spots) * CALIBRATION_FRACTION))
    cal_indices = cal_rng.sample(range(len(train_spots)), min(n_cal, len(train_spots)))
    calibration_spots = [train_spots[i] for i in cal_indices]

    if cfr_iters > 0 and cfr_actual_sec > 0:
        time_per_world_spot = cfr_actual_sec / (cfr_iters * N_WORLDS_TRAIN)
    else:
        time_per_world_spot = 0.015

    elapsed_so_far = time.perf_counter() - overall_start
    remaining_budget = total_budget - elapsed_so_far

    cal_proportion = len(calibration_spots) / (len(calibration_spots) + len(eval_spots))
    cal_time_budget = remaining_budget * cal_proportion
    eval_time_budget = remaining_budget * (1 - cal_proportion)

    calibration_sweep = {}
    if args.threshold is not None:
        calibrated_threshold = args.threshold
        calibration_method = f"precommitted={args.threshold}"
        print(f"\n--- Using precommitted threshold: {calibrated_threshold:.2f} ---")
    else:
        cal_n_worlds = compute_adaptive_world_count(
            n_spots=len(calibration_spots),
            remaining_time_sec=cal_time_budget,
            time_per_world_spot_estimate=time_per_world_spot,
        )
        # Phase 76 fix: use explicit documented cap instead of silently clamping to N_WORLDS_BASE
        cal_n_worlds_capped = min(cal_n_worlds, CALIBRATION_MAX_WORLDS)
        print(f"\n  Calibration world count: {cal_n_worlds_capped} "
              f"(adaptive={cal_n_worlds}, cap={CALIBRATION_MAX_WORLDS}, from {cal_time_budget:.1f}s budget)")

        calibrated_threshold, calibration_sweep = calibrate_threshold_on_training(
            strategy=strategy,
            calibration_spots=calibration_spots,
            n_worlds=cal_n_worlds_capped,
            rng=random.Random(CALIBRATION_SEED + 1),
            manifest=manifest,
            use_p75_model=use_p75_model,
        )
        calibration_method = f"training_calibration_p76_n={len(calibration_spots)}_w={cal_n_worlds_capped}"

    # ── Phase 3: Multi-pass evaluation on eval spots ──────────────────
    elapsed_so_far = time.perf_counter() - overall_start
    remaining_for_eval = total_budget - elapsed_so_far

    print(f"\n--- Phase 3: Multi-pass direct evaluation on {len(eval_spots)} eval spots ---")
    print(f"  Remaining budget: {remaining_for_eval:.1f}s")
    print(f"  Using calibrated threshold: {calibrated_threshold:.2f}")
    print(f"  Worlds per pass: {N_WORLDS_BASE}")

    eval_start = time.perf_counter()
    n_passes = 0
    probability_sums = [0.0] * len(eval_spots)

    total_worlds_consumed = 0
    total_worlds_possible = 0
    total_early_exits = 0

    budget_deadline = overall_start + total_budget - 5.0

    while time.perf_counter() < budget_deadline:
        n_passes += 1
        pass_seed = 72 + (n_passes - 1) * 1000
        pass_rng = random.Random(pass_seed)
        pass_early_exits = 0
        pass_worlds_used = 0

        for i, spot in enumerate(eval_spots):
            if time.perf_counter() >= budget_deadline:
                break

            if use_early_exit and use_p75_model:
                prob, worlds_used = predict_knock_probability_incremental_p75(
                    spot, pass_rng, N_WORLDS_BASE, strategy=strategy
                )
                if worlds_used < N_WORLDS_BASE:
                    pass_early_exits += 1
                pass_worlds_used += worlds_used
                total_worlds_possible += N_WORLDS_BASE
            elif use_p75_model:
                # P75 model without early-exit
                knock_ev, continue_ev = compute_spot_values_p75(
                    spot, N_WORLDS_BASE, pass_rng
                )
                ev_gap = knock_ev - continue_ev
                direct_prob = 1.0 / (1.0 + math.exp(-ev_gap * 3.0))
                if strategy is not None and USE_CFR_PRIOR:
                    info_set = compute_candidate_info_set(spot)
                    cfr_prob = strategy.get_average_strategy(info_set)[ACTION_KNOCK]
                    prob = DIRECT_EVAL_WEIGHT * direct_prob + (1.0 - DIRECT_EVAL_WEIGHT) * cfr_prob
                else:
                    prob = direct_prob
                pass_worlds_used += N_WORLDS_BASE
            else:
                # Legacy path (Phase 74 baseline)
                prob = predict_knock_probability_direct(
                    spot, pass_rng, N_WORLDS_BASE, strategy=strategy
                )
                pass_worlds_used += N_WORLDS_BASE

            probability_sums[i] += prob

        total_worlds_consumed += pass_worlds_used
        total_early_exits += pass_early_exits

        elapsed = time.perf_counter() - overall_start
        avg_probs = [s / n_passes for s in probability_sums]
        mean_p = sum(avg_probs) / len(avg_probs)
        early_exit_str = f" early_exits={pass_early_exits}" if use_early_exit else ""
        print(
            f"  Pass {n_passes} complete ({elapsed:.1f}s elapsed) | "
            f"mean_p_knock={mean_p:.4f} | "
            f"worlds_used={pass_worlds_used}{early_exit_str}"
        )

    # Average across all passes
    probabilities = [s / n_passes for s in probability_sums]

    eval_actual_sec = time.perf_counter() - eval_start
    elapsed_total = time.perf_counter() - overall_start
    total_worlds_per_spot = N_WORLDS_BASE * n_passes

    effective_worlds_per_spot = total_worlds_consumed // len(eval_spots) if eval_spots else 0

    print(f"  Total passes: {n_passes} | Nominal worlds/spot: {total_worlds_per_spot}")
    print(f"  Effective worlds consumed: {total_worlds_consumed}")
    if use_early_exit and total_worlds_possible > 0:
        savings = (1 - total_worlds_consumed / total_worlds_possible) * 100
        print(f"  Early-exit savings: {savings:.1f}% of continuation budget")
        print(f"  Total early exits: {total_early_exits} / {n_passes * len(eval_spots)} spot-passes")

    # Phase 75 opponent-model changes summary
    phase75_changes = {
        "p75_model_enabled": use_p75_model,
        "upcard_decline_signal": use_p75_model,
        "stock_dw_prior": STOCK_DW_PRIOR_ENABLED and use_p75_model,
        "mixed_continuation": CONTINUATION_MIX_ENABLED and use_p75_model,
        "trace_confidence_scaling": use_p75_model,
        "n_passes": n_passes,
        "effective_worlds_per_spot": effective_worlds_per_spot,
        "nominal_worlds_per_spot": total_worlds_per_spot,
        "early_exit_enabled": use_early_exit,
        "total_early_exits": total_early_exits,
        "early_exit_savings_pct": round(
            (1 - total_worlds_consumed / total_worlds_possible) * 100, 1
        ) if use_early_exit and total_worlds_possible > 0 else 0.0,
    }

    stats = CandidateStats(
        iterations=cfr_iters,
        elapsed_seconds=round(elapsed_total, 2),
        info_sets=len(strategy.regret_sum),
        iterations_per_sec=round(cfr_iters / cfr_actual_sec, 1) if cfr_actual_sec else 0.0,
        exploitability_proxy=round(strategy.get_exploitability_proxy(), 6),
        mean_knock_probability=round(
            sum(probabilities) / len(probabilities) if probabilities else 0.5, 4
        ),
        direct_eval_spots=len(eval_spots),
        cfr_budget_sec=cfr_actual_sec,
        eval_budget_sec=eval_actual_sec,
        n_worlds_used=total_worlds_per_spot,
        calibrated_threshold=calibrated_threshold,
        calibration_method=calibration_method,
        time_budget_requested=total_budget,
        time_budget_honored=(elapsed_total >= total_budget * 0.80),
    )

    # ── Diagnostic eval-set sweep (NOT used for model selection) ──────
    eval_diagnostic_sweep = {}
    if args.sweep:
        print("\n--- Diagnostic Eval-Set Sweep (NOT used for threshold selection) ---")
        for t in THRESHOLD_CANDIDATES:
            sweep_metrics = evaluate_probabilities(probabilities, t, manifest=manifest)
            eval_diagnostic_sweep[str(t)] = {
                "score": sweep_metrics["score"],
                "knock_rate": sweep_metrics["knock_rate"],
                "accuracy_vs_best": sweep_metrics["accuracy_vs_best"],
                "overknock_vs_v6": sweep_metrics["overknock_vs_v6"],
                "false_positive_rate": sweep_metrics["false_positive_rate"],
                "undercut_rate_when_knock": sweep_metrics["undercut_rate_when_knock"],
                "avg_regret_points": sweep_metrics["avg_regret_points"],
            }
            print(
                f"  threshold={t:.2f} => score={sweep_metrics['score']:.4f} "
                f"knock_rate={sweep_metrics['knock_rate']:.4f} "
                f"acc={sweep_metrics['accuracy_vs_best']:.4f} "
                f"overknock={sweep_metrics['overknock_vs_v6']:.4f}"
            )
        print("  (Above sweep is diagnostic only. Threshold was selected on training data.)")

    # ── Final scoring with calibrated threshold ───────────────────────
    result = build_result_payload(
        stats,
        manifest,
        probabilities,
        calibrated_threshold,
        total_budget,
        calibration_sweep=calibration_sweep if calibration_sweep else None,
        eval_diagnostic_sweep=eval_diagnostic_sweep if args.sweep else None,
        phase75_changes=phase75_changes,
    )

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    latest_path = os.path.join(ARTIFACT_DIR, "latest_run.json")
    tagged_path = os.path.join(ARTIFACT_DIR, f"{timestamp}-{args.tag}.json")

    with open(latest_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    with open(tagged_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)

    metrics = result["metrics"]
    print()
    print("=" * 72)
    print("RESULTS (Protocol-Compliant, Phase 76)")
    print("=" * 72)
    print(f"Time budget:       {total_budget:.0f}s requested, {elapsed_total:.1f}s actual")
    print(f"Budget honored:    {stats.time_budget_honored}")
    print(f"CFR phase:         {cfr_actual_sec:.1f}s ({cfr_iters} iterations)")
    print(f"Eval phase:        {eval_actual_sec:.1f}s ({n_passes} passes × {N_WORLDS_BASE} = {total_worlds_per_spot} worlds/spot)")
    print(f"Early-exit:        {'ENABLED' if use_early_exit else 'DISABLED'} (savings: {phase75_changes['early_exit_savings_pct']:.1f}%)")
    print(f"Phase 75 model:    {'ENABLED' if use_p75_model else 'DISABLED'}")
    print(f"Effective w/spot:  {effective_worlds_per_spot}")
    print(f"Threshold:         {calibrated_threshold:.2f} (via {calibration_method})")
    print(f"Score:             {metrics['score']:.4f}")
    print(f"Score vs V6:       {metrics['score_delta_vs_v6']:+.4f}")
    print(f"Accuracy vs best:  {metrics['accuracy_vs_best']:.4f}")
    print(f"Knock rate:        {metrics['knock_rate']:.4f}")
    print(f"Overknock vs V6:   {metrics['overknock_vs_v6']:.4f}")
    print(f"False positive:    {metrics['false_positive_rate']:.4f}")
    print(f"Undercut on knock: {metrics['undercut_rate_when_knock']:.4f}")
    print(f"Avg regret points: {metrics['avg_regret_points']:.4f}")
    print(f"Saved:             {tagged_path}")
    print("=" * 72)


if __name__ == "__main__":
    main()

```
