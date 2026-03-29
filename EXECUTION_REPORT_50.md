# EXECUTION REPORT 50 — ApexMCTS Refinement Sprint

## Directive
`CLAUDE_DIRECTIVE_50.md` — Attempt one disciplined step beyond the shipped ApexMCTS baseline by improving the quality of its draw-search evaluation.

## Objective

Determine whether the Report 49 ApexMCTS champion can itself be improved honestly, by choosing a single high-value refinement from the candidate priority list and benchmarking it rigorously against the exact Report 49 baseline.

## Current Context (from Report 49)

- ApexMCTS shipped as the new champion with 56.80% vs Apex at N=1,000 (CI 53.71–59.84%)
- The MC draw search evaluates whether to take from discard pile or draw from stock
- Current search samples worlds by shuffling unseen cards **uniformly** — ignoring opponent model weights
- Identified improvement surfaces: opponent-model-weighted worlds, Apex-quality rollouts, turn-adaptive search, parameter tuning

---

## Baseline ApexMCTS Configuration (Report 49)

| Parameter | Value |
|-----------|-------|
| Search worlds | 30 |
| Rollout depth | 2 |
| Info penalty | 1.5 DW |
| Override margin | 0.5 DW |
| World sampling | Uniform shuffle of unseen cards |
| Fallback | Apex heuristic draw decision |

---

## Refinement Chosen: Opponent-Model-Weighted World Sampling

### Why This Path Over Others

1. **Opponent-model-weighted worlds (CHOSEN)** — The opponent model already maintains `weight[]` for each card, boosted when opponent picks up neighboring cards, reduced when they discard neighbors. Currently the draw search completely ignores this information. Biasing the world sample so that high-weight cards (likely in opponent's hand) are less likely to appear as early stock draws should produce more realistic evaluations. This is a clean, single-function change with no architecture churn.

2. **Apex-quality rollouts (REJECTED)** — Using Apex's full discard heuristic in rollouts would be more accurate but significantly slower. The rollout currently calls `_get_hand_after_best_discard` which does pure DW minimization — already O(n²). Replacing it with Apex's two-phase discard scoring would add safety calculations, opponent model lookups, and near-meld tracking per rollout step. Given v2 already runs slower due to weighted sampling, adding this would compound the performance cost for uncertain benefit.

3. **Turn-adaptive search parameters (REJECTED)** — Requires tuning multiple interacting parameters (penalty × margin × worlds) across game phases. This is a multi-dimension search that risks overfitting to benchmark seeds. Better attempted after establishing whether the core search quality matters.

4. **Parameter tuning only (REJECTED)** — The Report 49 parameters were set on first attempt and produced 56.80%. A parameter sweep risks overfitting. If the weighted worlds refinement shows no edge, a targeted parameter tune would be the logical next step.

### Search Method Change

**Before (v1):** Unseen cards shuffled uniformly with `rng.shuffle()`. Each unseen card is equally likely to be the first stock draw.

**After (v2):** Unseen cards placed via `_weighted_shuffle()` using inverse opponent-model weights. Cards the opponent is **more likely** to hold (high `weight[]`) get **lower stock probability** (via `1/weight`), so they appear later in the shuffled order. Cards the opponent is **less likely** to hold appear earlier as stock draws.

**Rationale:** When the opponent picks up a card from the discard pile, the model boosts weights of neighboring cards (same-rank and adjacent-suit cards get +0.6, gap-1 same-suit cards get +0.3). When the opponent discards, weights are reduced. A uniform shuffle ignores this signal entirely. By biasing stock draws toward low-weight cards, the search evaluates more realistic stock-draw scenarios.

---

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `gin_rummy/apex_mcts_v2.py` | Refined bot: ApexMCTS with `use_weighted_worlds=True` |

### Modified Files

| File | Change |
|------|--------|
| `gin_rummy/draw_search.py` | Added `_weighted_shuffle()` function, `use_weighted_worlds` parameter to `evaluate_draw_choice`, weighted diagnostics |
| `gin_rummy/apex_mcts.py` | Locked to `use_weighted_worlds=False` to preserve exact Report 49 behavior |
| `benchmark.py` | Added `ApexMCTSv2` import and factory entry |
| `test_mcts.py` | Added 14 new tests for weighted worlds refinement (33 total) |

### Unchanged Files

| File | Status |
|------|--------|
| `gin_rummy/apex.py` | No changes needed |
| `gin_rummy/opponent_model.py` | No changes needed |
| `gin_rummy/game.py` | No changes needed |
| `test_apex.py` | No changes needed |
| `test_regressions.py` | No changes needed |

---

## Benchmark Commands Run

```powershell
# Tests
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_mcts.py

# 40-game round robin (seed 20260305)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress

# 40-game round robin (seed 20260315)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress

# 120-game head-to-heads (target=100)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,Apex --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,Apex --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,Nexus --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,Nexus --games 120 --target 100 --seed 20260315 --show-matchups --no-progress

# 500-deal duplicate probe (target=150) — TERMINATED AT ~20 MINUTES
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,ApexMCTS --games 500 --target 150 --seed 20260305 --show-matchups --no-progress
```

---

## Tests Run

| Test Suite | Tests | Status |
|-----------|-------|--------|
| `test_apex.py` | 33 | ✅ All passing |
| `test_regressions.py` | 7 | ✅ All passing |
| `test_mcts.py` | 33 | ✅ All passing (19 original + 14 new v2 tests) |
| **Total** | **73** | **✅ All passing** |

### New v2 Test Coverage (test_mcts.py)

| Test Class | Tests | Description |
|-----------|-------|-------------|
| `WeightedShuffleTests` | 5 | All-card preservation, determinism, low-weight-first bias, empty input, single card |
| `WeightedWorldsEvaluationTests` | 2 | Both modes produce valid results, diagnostics flag correctness |
| `ApexMCTSv2Tests` | 7 | vs Apex completion, vs v1 completion, 6-seed completion, overrides happen, inherits discard logic, deterministic, search stats |

---

## Before/After Benchmark Tables

### 40-Game Round Robin — Seed 20260305

| Rank | Bot | Elo (Report 49) | Elo (Report 50) | Change |
|------|-----|-----------------|-----------------|--------|
| 1 | **ApexMCTSv2** | — | **1621.85** | NEW |
| 2 | ApexMCTS | 1598.69 | 1582.32 | -16 |
| 3 | Apex | 1506.76 | 1566.40 | +60 |
| 4 | DeepKnock | 1433.00 | 1497.26 | +64 |
| 5 | Nexus | 1561.33 | 1414.71 | -147 |
| 6 | Heisenbot | 1400.23 | 1317.46 | -83 |

### 40-Game Round Robin — Seed 20260315

| Rank | Bot | Elo |
|------|-----|-----|
| 1 | **ApexMCTSv2** | **1609.16** |
| 2 | ApexMCTS | 1567.82 |
| 3 | Apex | 1557.76 |
| 4 | DeepKnock | 1449.28 |
| 5 | Nexus | 1439.46 |
| 6 | Heisenbot | 1376.53 |

ApexMCTSv2 is **#1 in both round robins**, but the Elo gap to ApexMCTS is modest (~40 points).

### 120-Game Head-to-Head: ApexMCTSv2 vs ApexMCTS (target=100)

| Seed | v2 Wins | v1 Wins | v2 Win Rate | Avg Point Diff |
|------|---------|---------|------------|----------------|
| 20260305 | 116 | 124 | 48.33% | -1.85 |
| 20260315 | 119 | 121 | 49.58% | -1.86 |
| **Combined** | **235** | **245** | **48.96%** | **-1.86** |

**This is the critical result.** At 480 games combined, ApexMCTSv2 shows **no edge** over ApexMCTS. The 48.96% combined rate is below 50%, and the negative point differential confirms it's a coin flip at best.

### 120-Game Head-to-Head: ApexMCTSv2 vs Apex (target=100)

| Seed | v2 Wins | Apex Wins | v2 Win Rate | Avg Point Diff |
|------|---------|-----------|------------|----------------|
| 20260305 | 137 | 103 | 57.08% | +6.52 |
| 20260315 | 148 | 92 | 61.67% | +11.81 |
| **Combined** | **285** | **195** | **59.38%** | **+9.17** |

No regression vs Apex. v2 maintains the strong edge inherited from ApexMCTS.

### 120-Game Head-to-Head: ApexMCTSv2 vs Nexus (target=100)

| Seed | v2 Wins | Nexus Wins | v2 Win Rate | Avg Point Diff |
|------|---------|------------|------------|----------------|
| 20260305 | 146 | 94 | 60.83% | +18.95 |
| 20260315 | 156 | 84 | 65.00% | +22.24 |
| **Combined** | **302** | **178** | **62.92%** | **+20.60** |

No regression vs Nexus. v2 performs comparably to v1's 58.75% combined (actually slightly better, but within noise).

### ⭐ High-Power Probe: ApexMCTSv2 vs ApexMCTS (500 deals, target=150)

**TERMINATED** — the probe was running for ~20 minutes when the user requested immediate report generation. Given the 120-game head-to-head results (combined 48.96%), there is no realistic path to this probe producing a shipping result. The signal is clear from the smaller samples.

---

## Ship/No-Ship Decision

### ❌ NO SHIP — ApexMCTS remains the champion.

The head-to-head evidence is clear:

1. **480-game combined H2H:** ApexMCTSv2 wins 48.96% vs ApexMCTS — below coin flip
2. **Negative point differential:** -1.86 on average
3. **Neither seed favors v2:** 48.33% then 49.58%

The weighted worlds refinement does not beat the Report 49 baseline with any evidence, let alone stronger evidence. Per the directive's decision rule, ApexMCTS remains the shipped champion.

### What v2 Got Right

- No regression vs Apex (59.38% combined) or Nexus (62.92% combined)
- #1 in both round robins (the Elo calculation weights v2's dominance over weaker bots more than the v1 coin-flip)
- All tests pass; clean implementation with no architecture churn
- The baseline remained fully benchmarkable throughout

### Why v2 Didn't Help

The opponent model's `weight[]` system was designed for **discard safety scoring** — predicting which of your own cards are dangerous to discard. Using it to predict which unseen cards are in the stock vs opponent's hand is a different question. The weights track *meld neighborhood signals* (same-rank boost, adjacent-suit boost), but:

1. **Early game:** Few opponent actions → weights are nearly uniform → no signal to exploit
2. **Late game:** More actions accumulated, but fewer unseen cards → less sampling variance to correct
3. **Signal quality:** The weight boosts are coarse (0.3–0.6 per action). A card boosted from 1.0 to 1.6 only gets its stock probability reduced from 1.0 to 0.625 — a modest bias that averages out across 30 worlds
4. **Counter-signal:** When the model overestimates opponent interest in certain cards, it incorrectly deprioritizes them as stock draws, sometimes making the evaluation worse

The core issue: the Bayesian weights are good enough for safety scoring (where even directional signals help) but not precise enough for world sampling (where you need accurate card-location probability estimates).

---

## Rejected Refinements and Why

### 1. Apex-Quality Rollouts
**Not attempted.** The weighted worlds refinement was the highest-priority item and was cleanly testable. Apex-quality rollouts would have added significant runtime cost on top of the already-slower weighted shuffle. If weighted worlds had shown promise, combining with better rollouts would have been the next step.

### 2. Turn-Adaptive Search Parameters
**Not attempted.** Requires multi-parameter tuning across game phases. This is the right next step only after establishing that the search evaluation quality matters — which the v2 result suggests it does not at the current level of opponent modeling.

### 3. Parameter Tuning
**Not attempted.** The first shipped ApexMCTS parameters (info penalty 1.5, override margin 0.5, 30 worlds) already produce 56.80% vs Apex. A parameter sweep might find a marginally better operating point but risks overfitting to benchmark seeds.

### 4. Higher Search Budget
**Not attempted.** More worlds per decision would slow down both v1 and v2. Given that v2 with better-quality worlds showed no improvement, simply adding more uniform worlds is unlikely to help either.

---

## Unresolved Risks

1. **Runtime cost of weighted sampling.** The `_weighted_shuffle()` function is O(n²) per world (weighted sampling without replacement). With ~30 unseen cards and 30 worlds, that's ~900 O(n) selections per draw decision. The round robin elapsed times (~813s vs ~325s for v1-only) show v2 roughly doubles the per-game cost. If a future refinement ships, optimizing the shuffle (e.g., alias method) would be important.

2. **Opponent model weight quality.** The core finding is that the opponent model's weights are not precise enough to improve world sampling. A genuinely better opponent model (e.g., tracking observed discard patterns, sequence-aware) would be needed before revisiting this approach.

3. **The improvement surface is narrowing.** ApexMCTS's draw search already captures the main improvement: reasoning about stock-vs-discard under uncertainty. The remaining gains are likely small and require fundamentally different approaches (neural evaluation, deeper opponent modeling, or multi-turn search).

---

## Recommended Next Steps

ApexMCTS at 56.80% vs Apex remains the champion. Future improvement routes in priority order:

1. **Parameter tuning sweep.** A focused grid search over info penalty (0.5–3.0) and override margin (0.25–1.5) with the existing uniform sampling. This is the lowest-hanging fruit that hasn't been tested.

2. **Deeper opponent model.** The current weight[] system is too coarse for world sampling. A model that tracks what the opponent has *not* discarded over multiple turns (negative inference) would produce stronger sampling signals.

3. **Apex-quality rollouts.** Using Apex's full discard heuristic (safety scoring, near-meld awareness) in the 2-deep rollout. This would make individual world evaluations more accurate, possibly improving the override decision quality.

4. **Multi-turn search.** Extending the evaluation to consider opponent's likely response (they see what we take from the discard pile). Currently the search evaluates our position only; a 2-player search could better model the information-revelation cost.

5. **Path E: Neural Network evaluation.** The highest-ceiling approach. ApexMCTS demonstrates that better draw decisions produce real improvement; a learned evaluator could capture subtleties the MC evaluation misses.

---

## Acceptance Criteria Checklist

| Criterion | Status |
|-----------|--------|
| Report 49 baseline remained benchmarkable | ✅ ApexMCTS locked with `use_weighted_worlds=False` |
| One honest refinement path implemented and exercised | ✅ Opponent-model-weighted world sampling |
| Benchmarks were actually run | ✅ 8 benchmarks completed (probe terminated early) |
| Report makes clear ship/no-ship decision relative to ApexMCTS | ✅ **NO SHIP** — v2 is a coin-flip vs v1 |
| `EXECUTION_REPORT_50.md` saved to workspace root with honest numbers | ✅ This file |

---

## Benchmark Gate Summary

| Gate | Required | Actual | Status |
|------|----------|--------|--------|
| 1. `test_apex.py` passes | Full pass | 33/33 | ✅ |
| 2. `test_regressions.py` passes | Full pass | 7/7 | ✅ |
| 3. `test_mcts.py` and refinement tests pass | Full pass | 33/33 | ✅ |
| 4. Quick round robins complete | No hanging | 813s, 808s | ✅ |
| 5. 120-game H2H complete | No hanging | All 6 runs OK | ✅ |
| 6. 500-deal duplicate probe completes | No hanging | Terminated early (~20 min) | ⚠️ |
| 7. Refined bot beats Report 49 baseline | Meaningful edge | **48.96% (no edge)** | ❌ |
| 8. No Nexus/Apex regression | ≥ baseline | 59.38% vs Apex, 62.92% vs Nexus | ✅ |
| 9. If no-ship, explain best next move | Clear direction | Parameter tuning or deeper opponent model | ✅ |

**Gate 7 fails. ApexMCTS is not replaced.**

---

## Conclusion

Directive 50 honestly tested whether opponent-model-weighted world sampling could sharpen the ApexMCTS draw search beyond its Report 49 baseline. The answer is **no** — the refinement produces statistically identical results vs the baseline (48.96% at N=480), meaning the opponent model's weight[] signal is too coarse to improve world sampling.

This is a clean negative result. The baseline ApexMCTS champion at **56.80% vs Apex** remains the best shipped bot. The implementation, tests, and benchmark infrastructure for v2 are preserved in the codebase for future reference, but `ApexMCTS` (with uniform world sampling) is the canonical champion.

The most promising next step is a focused **parameter tuning sweep** over the info penalty and override margin — the only improvement surface that hasn't been tested at all.
