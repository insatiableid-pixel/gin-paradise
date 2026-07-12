# Execution Report — Directive 108

## Objective
Harden the Directive 107 multi-lane Oracle architecture into a true Sprint 1
infrastructure layer by freezing stronger lane targets, separating optimization-time
proxy measurement from promotion-time gating, adding Pareto-aware promotion,
building a held-out gauntlet scaffold, and narrowing the evolvable surface back
down before richer symbolic evolution begins.

## What Was Delivered

### 1. Frozen Stronger Per-Lane Reference Targets (`prepare.py`)

Three frozen target artifact files are now generated offline by `prepare.py --force`:

| Lane | Target File | Evaluable | Oracle Reference |
|------|-----------|-----------|------------------|
| **Knock** | `frozen_knock_targets.json` | 80 spots | v6 solver + world-sampled EV + continuation policies |
| **Draw** | `frozen_draw_targets.json` | 80 spots | DW-improvement comparison with info penalty, stock sampling |
| **Discard** | `frozen_discard_targets.json` | 80 spots | DW-optimal + safety-awareness tiebreak |

Each target record includes:
- Target action
- Per-action scores / EV-like values
- Provenance metadata explaining the oracle computation

Targets are deterministic (stable seeds) and stored as stable artifacts.

### 2. Multi-Lane Benchmark Consumes Frozen Targets

`multi_lane_benchmark.py` was refactored from an online oracle-computing system
to a pure consumer of frozen labels. Candidate evaluation **does not** recompute
lane truth. Per-lane metrics are now reproducible from one candidate run to the next.

### 3. Proxy Metrics Include Oracle Distance

Per-lane metrics now include target-distance terms beyond simple accuracy:

| Lane | Accuracy Metric | Distance Metric |
|------|----------------|-----------------|
| **Knock** | accuracy vs best action | avg target EV gap |
| **Draw** | accuracy vs oracle best | score distance (EV gap on mismatch) |
| **Discard** | accuracy vs DW-optimal | DW distance to optimal |

Lane scores incorporate these distance terms as penalty components.

### 4. Pareto-Aware Multi-Lane Promotion Gate

`agent_loop.py` promotion logic upgraded from "aggregate score only" to:

1. Candidate must beat incumbent aggregate score by configurable margin
2. **No single lane may regress by more than epsilon** (default: 0.02)
3. If aggregate improves but a lane regresses, the candidate is **blocked**

Detailed logging for every promotion decision:
- Aggregate delta
- Per-lane scores and deltas
- Exact reason the candidate was kept or discarded
- Whether the Pareto gate passed or blocked

### 5. Held-Out Full-Game Gauntlet Scaffold

`gauntlet_eval.py` created with:
- Uses repo's existing `GinRummyGame`, `Player`, `run_balanced_matchup`
- Deterministic seat-balanced evaluation (each deal played twice)
- 95% Wilson confidence intervals for win rates
- JSON result artifact with full statistics and verdict
- Configurable deal count (bounded smoke: `--n-deals 10`)

Command used for verification:
```powershell
& '.\.local-python\3.14\python.exe' oracle_autoresearch\gauntlet_eval.py --n-deals 10 --seed 108
```

### 6. Narrowed Editable Surface

After this sprint, the clear distinction is:

**Frozen benchmark infrastructure (do NOT edit):**
- `prepare.py` — data prep and target generation
- `multi_lane_benchmark.py` — lane runner
- `oracle_abstractions.py` — abstraction layer
- `gauntlet_eval.py` — held-out evaluation

**Evolvable solver logic (agent-editable):**
- `train.py` — the **only** file the agent should edit

The `agent_prompt.md` explicitly restricts `target_file` to `train.py` only.

### 7. Updated Documentation

| File | Changes |
|------|---------|
| `README.md` | Rewritten — architecture diagram separates frozen/evolvable, documents gauntlet |
| `program.md` | Rewritten — narrowed scope, Pareto promotion, gauntlet section |
| `agent_prompt.md` | Rewritten — single-file editing surface, oracle-distance metrics |

## Verification Results

All four required verification commands passed:

| # | Command | Result |
|---|---------|--------|
| 1 | `python oracle_autoresearch/prepare.py --force` | ✅ Passed — generated frozen targets for all 3 lanes |
| 2 | `python oracle_autoresearch/train.py --time-budget 60 --tag directive108_smoke` | ✅ Passed (exit 0) |
| 3 | `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode fallback_only --max-experiments 1 --dry-run` | ✅ Passed (exit 0) |
| 4 | `python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 108` | ✅ Passed — deterministic, 0.12s |

### Smoke Test Per-Lane Results (60s budget)

| Lane | Score | Detail |
|------|-------|--------|
| Knock | 0.5593 | From frozen targets, 65% accuracy |
| Draw | 1.0000 | From frozen targets, 100% accuracy, 0.0 distance |
| Discard | 1.0000 | From frozen targets, 100% accuracy, 0.0 DW distance |
| **Aggregate** | **0.7356** | Weighted combination |

### Gauntlet Results (10 deals, bounded smoke)

| Metric | Value |
|--------|-------|
| Oracle wins | 10 |
| Simple wins | 10 |
| Oracle win rate | 50.0% (CI: 29.9% - 70.1%) |
| Verdict | FAIL (bounded proxy player, not full train.py policy) |
| Elapsed | 0.12s |

Note: The gauntlet uses a simplified OracleKnockPlayer, not the full train.py
policy with belief worlds. The scaffold exists and runs deterministically;
the full integration of the train.py policy into a gauntlet player is a natural
next step.

## Constraints Honored

- ✅ Did not remove the multi-lane architecture from 107
- ✅ Did not collapse back to knock-only
- ✅ Did not jump to dynamic blending schedules, VAD-style regret, or wide symbolic search
- ✅ Lane truth is frozen offline, not recomputed online
- ✅ Editable surface narrowed to `train.py` only
- ✅ Incumbent behavior preserved: `DIRECT_EVAL_WEIGHT=0.90`, `CALIBRATION_MAX_WORLDS=150`, `CALIBRATION_FRACTION=0.15`

## What Changed from Directive 107

| Aspect | Directive 107 | Directive 108 |
|--------|--------------|---------------|
| Lane targets | Computed online per eval | Frozen offline by prepare.py |
| Lane metrics | Accuracy only | Accuracy + oracle distance |
| Promotion | Aggregate score only | Pareto-aware (aggregate + no lane regression) |
| Editable surface | train.py + multi_lane + abstractions | train.py only |
| Held-out eval | None | Gauntlet scaffold |
| Phase | 81 | 108 |

## Files Modified/Created

| File | Action |
|------|--------|
| `oracle_autoresearch/prepare.py` | **Modified** — frozen per-lane target generation |
| `oracle_autoresearch/multi_lane_benchmark.py` | **Rewritten** — consumes frozen targets, oracle-distance metrics |
| `oracle_autoresearch/agent_loop.py` | **Modified** — Pareto-aware promotion gate |
| `oracle_autoresearch/gauntlet_eval.py` | **Created** — held-out full-game evaluation scaffold |
| `oracle_autoresearch/README.md` | **Rewritten** — hardened architecture docs |
| `oracle_autoresearch/program.md` | **Rewritten** — narrowed scope, Pareto, gauntlet |
| `oracle_autoresearch/agent_prompt.md` | **Rewritten** — single-file editing surface |
| `EXECUTION_REPORT_108.md` | **Created** — this report |

## What Remains for the Next Sprint

The repo is now ready for richer symbolic evolution over a narrow, well-frozen
solver surface:

1. **Richer symbolic mutations in train.py** — the evolvable surface is constrained
   to a single file with clear knobs
2. **Stronger gauntlet player** — integrate the full train.py belief-world policy
   into the gauntlet's OracleKnockPlayer
3. **VAD-style regret mutation** — can now be explored safely within train.py
   without contaminating the benchmark infrastructure
4. **Dynamic blending schedules** — only after the benchmark proves stable
5. **Population-relative exploitability** — build on the gauntlet scaffold
