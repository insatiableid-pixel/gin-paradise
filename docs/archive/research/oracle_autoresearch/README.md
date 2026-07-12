# Oracle Autoresearch — Semantic Mutation Surface (Directive 109)

Multi-lane Oracle research lab modeled on Karpathy's `autoresearch` workflow,
hardened via Directive 108 into a Sprint 1 infrastructure layer, and extended
via Directive 109 with an explicit semantic mutation surface and a real-policy
gauntlet integration.

Inspired by *Discovering Multiagent Learning Algorithms with Large Language
Models* and Deep Think guidance: constrained algorithm families, bounded search
spaces, frozen proxy labels, clear separation of optimization-time proxy
measurement from promotion-time gating, and **narrow helper functions ready
for AlphaEvolve-style LLM code evolution**.

## Architecture

```
FIXED BENCHMARK INFRASTRUCTURE (do NOT edit):
  prepare.py                  — frozen harness, splits, lane target generation
  multi_lane_benchmark.py     — frozen multi-lane runner (consumes frozen targets)
  oracle_abstractions.py      — frozen shared info-state abstraction layer
  gauntlet_eval.py            — held-out evaluation (runs REAL train.py policy)

EVOLVABLE SOLVER LOGIC (agent-editable):
  train.py                    — knock lane (EV estimation, calibration, knobs)
    ├── compute_eval_weight()                — mutation surface: blend weight
    └── compute_trace_confidence_multiplier()— mutation surface: risk scaling
```

### Semantic Mutation Surfaces (Directive 109/115/117/119)

Two small, self-contained functions in `train.py` are the primary targets
for Gemini's symbolic-evolution campaign. Directive 119 added
`my_score`, `opp_score`, and `score_diff` to incorporate game-score context:

| Function | Current Behavior (R5) | Evolution Opportunity |
|----------|-----------------|----------------------|
| `compute_eval_weight()` | EV-gap + trace trust | `pickup_pressure` or `score_diff` |
| `compute_trace_confidence_multiplier()` | Exp decay + stock floor | `pickup_pressure` or match-score pressure |

### Campaign Reporting Convention

Root reports for directives follow a strict naming rule:
- `GEMINI_DIRECTIVE_<N>.md` → `EXECUTION_REPORT_<N>.md`

Both functions receive real game-state features and produce scalar weights
used in the policy path. An LLM can propose continuous mathematical formulas,
schedules, or asymmetric rules inside these functions without touching
any benchmark infrastructure.

### Benchmark Lanes

| Lane | Weight | Decision Surface | Reference | Targets |
|------|--------|-----------------|-----------| --------|
| **Knock** | 60% | knock vs continue (low-stock) | v6 solver + world-sampled EV | `frozen_knock_targets.json` |
| **Draw** | 25% | take discard vs draw stock | oracle-computed DW comparison | `frozen_draw_targets.json` |
| **Discard** | 15% | which card to discard | DW-optimal + safety scoring | `frozen_discard_targets.json` |

All targets are **frozen offline** by `prepare.py`. The benchmark never
recomputes oracle truth during candidate evaluation.

### Proxy vs Promotion-Time Evaluation

| Level | What | When | File |
|-------|------|------|------|
| **Proxy** | Frozen multi-lane benchmark | Every candidate | `multi_lane_benchmark.py` |
| **Gate** | Pareto-aware multi-lane promotion | On aggregate improvement | `agent_loop.py` |
| **Held-out** | Full-game gauntlet (real train.py policy) | Post-promotion or manual | `gauntlet_eval.py` |

### Gauntlet Integration (Directive 109)

The gauntlet now evaluates the **real `train.py` Oracle policy**, not a
simplified proxy player:

- `RealOraclePolicyPlayer` delegates knock decisions to the full belief-world
  EV estimation path from `train.py`
- Uses `compute_eval_weight()` and `compute_trace_confidence_multiplier()`
  (the same mutation surfaces targeted by Gemini)
- Deterministic seeding, seat-balanced evaluation, Wilson CI, JSON artifacts
- Legacy simplified player available via `--mode legacy` for comparison

### Promotion Logic (Pareto-Aware)

A candidate is promoted only if:
1. Aggregate score beats incumbent by configurable margin
2. No single lane regresses by more than epsilon (default: 0.02)

### Shared Abstraction Layer

All lanes use a common explicit abstraction layer (`oracle_abstractions.py`):

1. Deadwood bucket — hero hand quality
2. Meld structure — meld count, arrangement richness
3. Combination / layoff potential — near-meld cards
4. Upcard utility — value of the face-up card
5. Opponent memory — bucketed trace signals
6. Deck phase — stock size and turn progression

## Files

### Fixed Infrastructure (frozen)
- `oracle_autoresearch/prepare.py`: frozen harness, frozen split, frozen per-lane targets
- `oracle_autoresearch/multi_lane_benchmark.py`: frozen multi-lane benchmark consumer
- `oracle_autoresearch/oracle_abstractions.py`: frozen info-state features
- `oracle_autoresearch/gauntlet_eval.py`: real-policy gauntlet (Directive 109)

### Evolvable Solver Logic
- `oracle_autoresearch/train.py`: **the only file the agent should edit**
  - `compute_eval_weight()`: semantic mutation surface for blend weight
  - `compute_trace_confidence_multiplier()`: semantic mutation surface for risk

### Support
- `oracle_autoresearch/program.md`: human-authored research program
- `oracle_autoresearch/agent_prompt.md`: candidate-generation brief
- `oracle_autoresearch/agent_loop.py`: benchmark / promote / discard loop
- `oracle_autoresearch/gemini_bridge.py`: headless Gemini CLI bridge
- `oracle_autoresearch/run_gemini_loop.ps1`: convenient Windows launcher

## Manual Quick Start

```powershell
# 1. Generate frozen targets (one-time, or --force to rebuild)
& '.\.local-python\3.14\python.exe' oracle_autoresearch\prepare.py --force

# 2. Run a smoke benchmark
& '.\.local-python\3.14\python.exe' oracle_autoresearch\train.py --time-budget 60 --tag directive109_smoke

# 3. Run the real-policy gauntlet (bounded smoke)
& '.\.local-python\3.14\python.exe' oracle_autoresearch\gauntlet_eval.py --n-deals 10 --seed 109

# 4. Run the legacy proxy gauntlet for comparison
& '.\.local-python\3.14\python.exe' oracle_autoresearch\gauntlet_eval.py --n-deals 10 --seed 109 --mode legacy
```

## Gemini CLI Autoresearch

```powershell
& '.\.local-python\3.14\python.exe' oracle_autoresearch\agent_loop.py `
  --bridge-provider gemini `
  --bridge-mode fallback_only `
  --max-experiments 1 `
  --dry-run
```

## Outputs

- frozen benchmark data in `oracle_autoresearch/data/`
  - `frozen_knock_targets.json`
  - `frozen_draw_targets.json`
  - `frozen_discard_targets.json`
- benchmark artifacts in `oracle_autoresearch/artifacts/`
- bridge requests in `oracle_autoresearch/gemini_bridge/requests/`
- bridge responses in `oracle_autoresearch/gemini_bridge/responses/`
- multi-lane results embedded in `latest_run.json`
- gauntlet results in `artifacts/*-gauntlet_eval.json`

## What This Is Not

This is **not** full unified Gin Rummy solving or "eXtreme Gammon for gin."
It is a hardened proxy benchmark with frozen per-lane oracle targets,
Pareto-aware promotion, a real-policy gauntlet, and two narrow semantic
mutation surfaces — ready for the first Gemini symbolic-evolution campaign.
