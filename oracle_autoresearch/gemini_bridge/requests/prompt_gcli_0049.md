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
# Oracle Autoresearch Program (Directive 109)

This folder is the Gin Rummy Oracle analogue of Karpathy's `autoresearch`
workflow, hardened via Directive 108 and extended via Directive 109 with
explicit semantic mutation surfaces for AlphaEvolve-style LLM code evolution.

## Architecture (Directive 109)

The lab evaluates Oracle decision quality across three frozen benchmark lanes,
each consuming **pre-computed offline targets** (no online oracle recomputation):

| Lane | Decision | Metric | Weight | Targets |
|------|----------|--------|--------|---------|
| **Knock** | knock vs continue (low-stock) | composite score | 60% | `frozen_knock_targets.json` |
| **Draw** | take discard vs draw stock | accuracy + distance | 25% | `frozen_draw_targets.json` |
| **Discard** | which card to discard | accuracy + safety + DW dist | 15% | `frozen_discard_targets.json` |

All lanes share a common **Oracle Abstraction Layer** (`oracle_abstractions.py`).

The **aggregate promotion score** is the weighted combination of per-lane
scores, gated by a **Pareto constraint** that prevents any single-lane regression.

## Semantic Mutation Surface (Directive 109)

Two small helper functions in `train.py` are the primary evolution targets:

### `compute_eval_weight(hero_deadwood, stock_size, n_trace_events, ev_gap) → float`
- Controls blend between direct EV and CFR prior
- Currently returns fixed `DIRECT_EVAL_WEIGHT = 0.90`
- Target: state-dependent sigmoid, polynomial, or piecewise functions

### `compute_trace_confidence_multiplier(n_trace_events, stock_size, hero_deadwood) → float`
- Controls risk-penalty scaling based on observation quality
- Currently: linear decay `1.0 - 0.08 * events`, floor 0.6
- Target: non-linear decay, interaction terms, contextual adaptation

Both functions are used by the real-policy gauntlet player, ensuring the
held-out evaluation always runs the exact same policy being optimized.

## Setup

1. Read `README.md`, `prepare.py`, `train.py`, and this `program.md`.
2. Run `python oracle_autoresearch/prepare.py --force` to generate frozen targets.
3. Verify `oracle_autoresearch/data/` contains:
   - `train_spots.json`, `eval_spots.json`, `lab_manifest.json`
   - `frozen_knock_targets.json`, `frozen_draw_targets.json`, `frozen_discard_targets.json`
4. Verify `oracle_autoresearch/loop_state.json` exists and has an incumbent.
5. Confirm Gemini CLI is installed and authenticated if using the loop.

## Scope

What you can edit:
- `train.py` — **preferably** the two mutation surface functions:
  - `compute_eval_weight()`
  - `compute_trace_confidence_multiplier()`
- Scalar knobs in `train.py` as a fallback

What you cannot edit (frozen benchmark infrastructure):
- `prepare.py` — the frozen benchmark harness
- `multi_lane_benchmark.py` — the frozen lane runner
- `oracle_abstractions.py` — the frozen abstraction layer
- `gauntlet_eval.py` — the held-out evaluation (now runs real policy)
- The frozen benchmark data and targets
- The scoring formula
- The rest of the repo unless explicitly told otherwise

## Objective

Optimize the **aggregate score** across all three lanes.
Higher is better. The knock lane still dominates (60% weight), but
draw and discard lanes provide broader signal.

Promotion requires both:
1. Aggregate score improvement by margin
2. No single lane regression beyond epsilon (0.02)

## Experiment Loop

The autoresearch loop owns keep/discard decisions:

1. Generate one focused candidate edit to `train.py`
   - **Prefer semantic mutations** in helper functions over scalar tuning
   - Propose continuous math: sigmoid, exponential, polynomial, sqrt
2. Apply the edit
3. Benchmark it (all lanes run with frozen targets)
4. Keep it only if the aggregate score beats the incumbent by margin
   AND no single lane regresses by > epsilon (Pareto gate)
5. Otherwise restore the incumbent and move on
6. Log diffs, scores, rationale, and provenance every time

## Held-Out Gauntlet (Directive 109: Real Policy)

The gauntlet now evaluates the **real `train.py` Oracle policy**:

- `RealOraclePolicyPlayer` runs belief-world EV estimation for knock decisions
- Uses the same `compute_eval_weight()` and `compute_trace_confidence_multiplier()`
  that the proxy benchmark optimizes
- Deterministic seat-balanced games with Wilson CI
- Command: `python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 109`
- Legacy mode: `python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 109 --mode legacy`

## Simplicity Criterion

All else equal, simpler is better. Focused, falsifiable edits beat sprawling rewrites.
A single clean sigmoid that improves the aggregate score is worth more than
a sprawling framework that adds complexity without measurable benefit.

## Good Directions

- **Semantic mutations** in `compute_eval_weight()` or `compute_trace_confidence_multiplier()`
- Non-linear functions of game-state features
- Interaction terms between available state variables
- Asymmetric rules for different game phases
- Better EV estimation via knob adjustments (fallback)
- Better opponent-model weights for world generation

## Bad Directions

- Editing `prepare.py`, `multi_lane_benchmark.py`, or `oracle_abstractions.py`
- Rebuilding targets every run
- Changing the fixed eval benchmark
- Expanding into unrelated engine work
- Opaque neural embedding rewrites
- Over-claiming full unified Gin Rummy solving

## Current Research Context

- Phase 76 repaired calibration integrity.
- Directive 107 expanded from a single knock lane to three lanes.
- Directive 108 froze per-lane targets, added Pareto promotion, gauntlet, narrowed surface.
- **Directive 109** extracted semantic mutation surfaces and integrated the real
  policy into the gauntlet.
- The incumbent knock score is `0.6293` (CALIBRATION_MAX_WORLDS=150).
- The aggregate score now replaces the single knock score for promotion.
- The next Gemini campaign should target `compute_eval_weight()` and
  `compute_trace_confidence_multiplier()` with continuous mathematical functions.


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

**Avoid:**
- Plain scalar retuning (that was the old approach)
- Wide structural rewrites outside the helper functions
- Adding new classes or large frameworks
- Changing the scoring formula or benchmark infrastructure

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
  "request_id": "gcli_0049",
  "incumbent_score": 0.7619,
  "incumbent_variant": "gemini_gcli_0043",
  "incumbent_params": {
    "TRACE_CONFIDENCE_FLOOR": 0.6,
    "TRACE_CONFIDENCE_DECAY": 0.08,
    "KNOCK_RISK_PENALTY_BASE": 0.05,
    "DW_RISK_SCALE": 0.012,
    "GIN_BONUS": 0.04,
    "EARLY_EXIT_CONFIDENCE_THRESHOLD": 2.5,
    "EARLY_EXIT_MIN_WORLDS": 20,
    "N_WORLDS_BASE": 50,
    "DIRECT_EVAL_WEIGHT": 0.9,
    "DECLINE_SAME_RANK_REDUCE": 0.35,
    "DECLINE_ADJ_SUIT_REDUCE": 0.3,
    "DECLINE_FAR_SUIT_REDUCE": 0.15,
    "CONTINUATION_MIX_ENABLED": true,
    "CONTINUATION_CHAMPION_WEIGHT": 0.8,
    "STOCK_DW_PRIOR_ENABLED": true,
    "STOCK_DW_PRIOR_STD": 3.5,
    "CALIBRATION_MAX_WORLDS": 150,
    "CFR_BUDGET_FRACTION": 0.1,
    "CALIBRATION_FRACTION": 0.15,
    "WORLD_GEN_OVERSAMPLE": 2
  },
  "recent_experiment_history": [
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
    },
    {
      "id": 22,
      "variant": "gemini_gcli_0022",
      "score": 0.5762,
      "delta": -0.0427,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 23,
      "variant": "gemini_gcli_0023",
      "score": 0.6132,
      "delta": -0.0057,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 24,
      "variant": "gemini_gcli_0024",
      "score": 0.6243,
      "delta": 0.0054,
      "decision": "keep",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 25,
      "variant": "gemini_gcli_0025",
      "score": 0.6293,
      "delta": 0.005,
      "decision": "keep",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 26,
      "variant": "gemini_gcli_0026",
      "score": 0.5161,
      "delta": -0.1132,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 27,
      "variant": "gemini_gcli_0027",
      "score": 0.5763,
      "delta": -0.053,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 28,
      "variant": "gemini_gcli_0028",
      "score": 0.598,
      "delta": -0.0313,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 29,
      "variant": "gemini_gcli_0029",
      "score": 0.5763,
      "delta": -0.053,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 30,
      "variant": "gemini_gcli_0030",
      "score": 0.587,
      "delta": -0.0423,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 31,
      "variant": "gemini_gcli_0031",
      "score": 0.5161,
      "delta": -0.1132,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 32,
      "variant": "gemini_gcli_0032",
      "score": 0.598,
      "delta": -0.0313,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 33,
      "variant": "gemini_gcli_0033",
      "score": 0.5161,
      "delta": -0.1132,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 34,
      "variant": "gemini_gcli_0034",
      "score": 0.5161,
      "delta": -0.1132,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 35,
      "variant": "gemini_gcli_0035",
      "score": 0.598,
      "delta": -0.0313,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 36,
      "variant": "gemini_gcli_0036",
      "score": 0.598,
      "delta": -0.0313,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 81
    },
    {
      "id": 37,
      "variant": "combo_decline_stronger",
      "score": null,
      "delta": null,
      "decision": "dry_run",
      "strategy": "local_fallback_combination",
      "source": "local_fallback_generator",
      "phase": 81
    },
    {
      "id": 38,
      "variant": "combo_no_mix_knock_penalty_0.04",
      "score": null,
      "delta": null,
      "decision": "dry_run",
      "strategy": "local_fallback_combination",
      "source": "local_fallback_generator",
      "phase": 108
    },
    {
      "id": 39,
      "variant": "gemini_gcli_0039",
      "score": 0.7458,
      "delta": 0.1165,
      "decision": "keep",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 40,
      "variant": "gemini_gcli_0040",
      "score": 0.7457,
      "delta": -0.0001,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 41,
      "variant": "gemini_gcli_0041",
      "score": null,
      "delta": null,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 42,
      "variant": "gemini_gcli_0042",
      "score": 0.7458,
      "delta": 0.0,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 43,
      "variant": "gemini_gcli_0043",
      "score": 0.7619,
      "delta": 0.0161,
      "decision": "keep",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 44,
      "variant": "gemini_gcli_0044",
      "score": 0.749,
      "delta": -0.0129,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 45,
      "variant": "gemini_gcli_0045",
      "score": 0.7422,
      "delta": -0.0197,
      "decision": "discard",
      "strategy": "gemini_medium",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 46,
      "variant": "gemini_gcli_0046",
      "score": 0.749,
      "delta": -0.0129,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 47,
      "variant": "gemini_gcli_0047",
      "score": 0.749,
      "delta": -0.0129,
      "decision": "discard",
      "strategy": "gemini_high",
      "source": "gemini_cli_headless",
      "phase": 108
    },
    {
      "id": 48,
      "variant": "gemini_gcli_0048",
      "score": 0.7555,
      "delta": -0.0064,
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
CALIBRATION_MAX_WORLDS = 150

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
DIRECT_EVAL_WEIGHT = 0.90

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
    return compute_trace_confidence_multiplier(
        n_trace_events=n_events,
        stock_size=spot.stock_size,
        hero_deadwood=spot.hero_deadwood,
    )


# ── Directive 109: Semantic Mutation Surface ──────────────────────────
#
# These two functions are the primary targets for Gemini's
# symbolic-evolution campaign. They encapsulate policy intelligence
# that currently lives as simple scalar operations. An LLM can
# propose continuous mathematical formulas, schedules, non-linear
# logic, or asymmetric rules inside these functions without touching
# any benchmark infrastructure.
#
# IMPORTANT: The initial implementations below produce behavior
# IDENTICAL to the Phase 76 incumbent. Any experiment that changes
# these functions must be verified by the benchmark before promotion.
# ──────────────────────────────────────────────────────────────────────


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
        # Directive 109: use compute_eval_weight mutation surface
        n_trace = (
            len(spot.known_opponent_pickups)
            + len(spot.known_opponent_discards)
            + len(spot.upcard_declines)
        )
        w = compute_eval_weight(
            hero_deadwood=spot.hero_deadwood,
            stock_size=spot.stock_size,
            n_trace_events=n_trace,
            ev_gap=ev_gap,
        )
        blended = w * direct_prob + (1.0 - w) * cfr_prob
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
        # Directive 109: use compute_eval_weight mutation surface
        n_trace = (
            len(spot.known_opponent_pickups)
            + len(spot.known_opponent_discards)
            + len(spot.upcard_declines)
        )
        w = compute_eval_weight(
            hero_deadwood=spot.hero_deadwood,
            stock_size=spot.stock_size,
            n_trace_events=n_trace,
            ev_gap=ev_gap,
        )
        blended = w * direct_prob + (1.0 - w) * cfr_prob
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
                    # Directive 109: use compute_eval_weight mutation surface
                    n_trace = (
                        len(spot.known_opponent_pickups)
                        + len(spot.known_opponent_discards)
                        + len(spot.upcard_declines)
                    )
                    w = compute_eval_weight(
                        hero_deadwood=spot.hero_deadwood,
                        stock_size=spot.stock_size,
                        n_trace_events=n_trace,
                        ev_gap=ev_gap,
                    )
                    prob = w * direct_prob + (1.0 - w) * cfr_prob
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

    # ── Directive 107: Multi-Lane Benchmark ────────────────────────────
    print()
    print("=" * 72)
    print("MULTI-LANE ORACLE PROXY BENCHMARK (Directive 107)")
    print("=" * 72)
    try:
        from multi_lane_benchmark import run_multi_lane_benchmark
        ml_result = run_multi_lane_benchmark(result, eval_spots)
        result["multi_lane"] = ml_result
        aggregate_score = ml_result["aggregate"]["aggregate_score"]

        # Re-save with multi-lane data
        with open(latest_path, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2)
        with open(tagged_path, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2)
    except Exception as exc:
        print(f"  [MULTI-LANE] Error: {exc}")
        aggregate_score = metrics['score']  # fallback to knock-only
    print("=" * 72)

    print()
    print("=" * 72)
    print("RESULTS (Multi-Lane, Directive 107)")
    print("=" * 72)
    print(f"Time budget:       {total_budget:.0f}s requested, {elapsed_total:.1f}s actual")
    print(f"Budget honored:    {stats.time_budget_honored}")
    print(f"CFR phase:         {cfr_actual_sec:.1f}s ({cfr_iters} iterations)")
    print(f"Eval phase:        {eval_actual_sec:.1f}s ({n_passes} passes × {N_WORLDS_BASE} = {total_worlds_per_spot} worlds/spot)")
    print(f"Early-exit:        {'ENABLED' if use_early_exit else 'DISABLED'} (savings: {phase75_changes['early_exit_savings_pct']:.1f}%)")
    print(f"Phase 75 model:    {'ENABLED' if use_p75_model else 'DISABLED'}")
    print(f"Effective w/spot:  {effective_worlds_per_spot}")
    print(f"Threshold:         {calibrated_threshold:.2f} (via {calibration_method})")
    print(f"Knock lane score:  {metrics['score']:.4f}")
    print(f"Aggregate score:   {aggregate_score:.4f}")
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
