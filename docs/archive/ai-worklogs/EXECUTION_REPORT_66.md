# EXECUTION REPORT 66: Belief-Weighted World Generation

**Directive:** `CLAUDE_DIRECTIVE_66.md`  
**Phase:** 66  
**Date:** 2026-03-23  
**Elapsed:** 24.8 s  
**Status:** Complete - Honest Assessment

---

## Objective

Replace the solver's **uniform hidden-world generation** with a **belief-weighted model** that incorporates:

1. Card-level weights from public action history (opponent pickups, declines, discard patterns)
2. Deadwood-quality priors from the Phase 65 undercut estimator
3. All existing undercut calibration knowledge

The goal: make sampled opponent worlds reflect the kinds of hands a strong bot actually *reaches* in low-stock positions, rather than uniform random noise.

---

## Deliverables

| # | Deliverable | File | Status |
|---|-------------|------|--------|
| A | Belief-weighted hidden-world generator | `belief_world_generator.py` | Delivered |
| B | Solver v4 integration | `solver_v4.py` | Delivered |
| C | Calibration comparison v2/v3/v4 | `run_phase66.py` + `phase66_results.json` | Delivered |
| D | Opponent DW prediction improvement | Section in results JSON | Delivered |
| E | Surviving knock frontier analysis | Section in results JSON | Delivered |

---

## Architecture: Belief-Weighted World Generator

### Two-Stage Importance-Weighted Sampling

```
Stage 1: Card-Level Weights           Stage 2: Quality Prior
+----------------------------+        +----------------------------+
|  OpponentModel             |        |  UndercutRiskEstimator     |
|  - Pickup boosts           |  --->  |  - Predicted E[opp_dw]     |
|  - Discard penalties       |        |  - Gaussian kernel weight  |
|  - Baseline = 1.0          |        |  - Oversample 3x, keep N  |
+----------------------------+        +----------------------------+
         |                                       |
         v                                       v
   Sample N*3 candidate                   Rank by deadwood
   opponent hands using                   quality match,
   card-level weights                     keep top N worlds
```

**Stage 1** uses `OpponentModel`'s Bayesian card weights: cards the opponent picked from the discard pile get boosted, cards near opponent discards get reduced, everything else sits at baseline 1.0.

**Stage 2** uses the Phase 65 `UndercutRiskEstimator` to predict mean opponent deadwood, then applies a Gaussian kernel to each candidate world: hands whose deadwood is far from the predicted mean get down-weighted, hands near the predicted mean get up-weighted.

The generator oversamples 3x, scores by quality match, keeps the top N worlds, and returns both worlds and normalized importance weights.

---

## Discovery: The Card-Weight Spread Problem

A critical finding: in the Phase 65 dataset, **card_weight_spread is 0.0 for all 20 diagnostic samples**. This means the OpponentModel is producing uniform weights for every card - the card-level signal from Stage 1 is providing **zero differentiation**.

**Root cause:** The dataset (`LabelledKnockSpot`) does not track individual opponent action events (which specific cards were picked up, which were declined). It only stores summary counts (`n_opponent_pickups`, `n_opponent_discards`). Without the granular action trace, the `OpponentModel` cannot assign non-uniform weights.

**Impact:** Stage 1's card-level weighting is effectively a no-op in this evaluation. The only active signal is Stage 2's deadwood quality prior. This means **the improvement we see comes entirely from the deadwood quality kernel**, not from card-level tracking.

**Fix path:** Future integration must pipe the actual per-card pickup/decline/discard trace from the game engine into the generator. This is a data-pipeline problem, not a modeling problem.

---

## Calibration Comparison: v2 vs v3 vs v4

### Headline Numbers (150 low-stock legal-knock positions)

|                            | v2 (P62)   | v3 (P65)   | v4 (P66)   | Actual     |
|----------------------------|------------|------------|------------|------------|
| Mean UC rate               | 1.9%       | 34.9%      | 8.4%       | **58.0%**  |
| Mean opp DW prediction     | 28.5       | 28.5       | 24.1       | **2.9**    |
| UC rate bias               | -56.1 pp   | -23.1 pp   | -49.6 pp   | -          |
| Opp DW bias                | +25.6      | +25.6      | +21.2      | -          |
| Knock rate                 | 77.3%      | 50.0%      | 58.7%      | -          |
| Continue rate              | 22.7%      | 50.0%      | 41.3%      | -          |

### Undercut-Aware Accuracy (87 actual undercut positions)

|                            | v2         | v3         | v4         |
|----------------------------|------------|------------|------------|
| Correctly says "continue"  | 25/87 (29%)| **48/87 (55%)**| 43/87 (49%)|

### Honest Interpretation

**v3 remains the best-calibrated solver** for undercut avoidance. It achieves the closest UC rate estimate (34.9% vs 58.0% actual) and the highest correct-continue rate on undercut positions (55.2%).

**v4 improves world quality over v2** (opp DW bias reduced from +25.6 to +21.2), but its calibration is **worse than v3** for UC detection. This is because:

1. v3's approach of *estimator-driven belief reweighting* (adjusting world weights post-hoc to match the estimator's UC prediction) is more directly tuned to the UC detection problem than v4's approach of *filtering for deadwood quality*.
2. v4's quality kernel biases toward the *predicted* mean opp DW (~5-6), but doesn't translate that directly into UC rate calibration.
3. Without card-level differentiation (card_weight_spread = 0), v4's Stage 1 adds no value.

---

## Opponent Deadwood Prediction Quality

| (50 spots)                     | v2 (uniform) | v4 (belief)  |
|--------------------------------|-------------|-------------|
| Mean Absolute Error            | 30.8        | **26.8**    |
| Mean Bias (predicted - actual) | +30.8       | **+26.8**   |
| MAE Improvement                | -           | +4.0        |

v4 reduces the world-level opp DW prediction error by ~4 points of MAE. However, the remaining bias is still enormous (+26.8 vs actual 2.9). The quality kernel is pulling sampled worlds toward more realistic deadwood (sampled mean ~24 vs ~28), but the gap to reality (~3) is still vast.

**Why the bias remains:** Even with the Gaussian quality kernel centered at predicted mean ~5-6, the *sampled* mean opp DW is ~24-38. This is because the card pool after removing hero hand (10 cards), discard pile (~20+ cards), and visible cards contains mostly high-deadwood cards. The quality kernel can only filter among the candidate worlds it's given - if *all* candidate worlds have high opp DW, filtering doesn't help much.

**The fundamental constraint:** Random 10-card samples from the remaining card pool will *always* have high DW (expected ~28-30) regardless of weighting, because the pool contains a roughly uniform mix of ranks. Only a hand *built around melds* can achieve DW < 5. The generator would need to actively construct meld-rich hands, not just reweight random samples.

---

## Surviving Knock Frontier (Task E)

### v4 Knock Survivors by DW Class

| DW  | n  | Gin | Win | UC  | UC Rate | Actual Mean Opp DW |
|-----|----|-----|-----|-----|---------|--------------------|
| 0   | 22 | 22  | 0   | 0   | 0.0%    | 3.6                |
| 1   | 19 | 0   | 7   | 12  | 63.2%   | 1.4                |
| 2   | 21 | 0   | 7   | 14  | 66.7%   | 3.9                |
| 3   | 5  | 0   | 1   | 4   | 80.0%   | 2.2                |
| 4   | 8  | 0   | 3   | 5   | 62.5%   | 3.5                |
| 5   | 2  | 0   | 0   | 2   | 100.0%  | 2.5                |
| 7   | 3  | 0   | 1   | 2   | 66.7%   | 6.3                |
| 8   | 5  | 0   | 2   | 3   | 60.0%   | 6.6                |
| 9   | 3  | 0   | 1   | 2   | 66.7%   | 7.0                |

**Only gin (DW=0) is safely knockable** - 0% undercut rate. Every other DW class has 60-100% undercut rate, confirming Phase 65's finding that low-stock non-gin knocks are extremely dangerous.

### Knock Survivor Classification

| Class                    | Count |
|--------------------------|-------|
| Gin (DW=0)               | 22    |
| Clinch-adjacent           | 0     |
| Low-DW (DW=1-2, !clinch) | 40    |
| Other                     | 26    |

### v3 -> v4 Recommendation Changes

| Change              | Count |
|---------------------|-------|
| Same action         | 127   |
| knock -> continue   | 5     |
| continue -> knock   | 18    |

v4 is *less cautious* than v3, flipping 18 spots from continue to knock. This is the opposite of what we'd want - v3's estimator-driven approach is more conservative and more accurate in this domain.

### UC Rate Among Remaining Knock Recommendations

| Solver | UC Rate | Knock Count |
|--------|---------|-------------|
| v2     | 53.4%   | 116         |
| v3     | 52.0%   | 75          |
| v4     | 50.0%   | 88          |

v4 slightly reduces the UC rate among surviving knocks (50% vs 53.4%) but not as effectively as v3 which achieves this through *fewer, better-selected* knocks (75 vs 88).

---

## Honest Assessment: What Worked and What Didn't

### What Worked

1. **Architecture is clean and correct.** The two-stage belief-weighted generator with importance weights is properly designed and functional.
2. **Opp DW prediction improved.** The quality kernel reduces MAE by 4 points (30.8 -> 26.8).
3. **The estimator's deadwood predictions are reasonable.** Predicted mean opp DW of 4-7 is much closer to the actual ~3 than the uniform-world implied ~28.
4. **Infrastructure for future improvement is in place.** When card-level action traces become available, Stage 1 will activate.

### What Didn't Work As Hoped

1. **Card-level signal is a no-op.** The dataset lacks per-card action traces, so OpponentModel produces uniform weights. Stage 1 contributes nothing.
2. **v4 is less accurate than v3 for UC detection.** The direct estimator-driven reweighting in v3 is more effective than v4's quality filtering approach.
3. **The fundamental sampling problem persists.** Random 10-card samples from the card pool will always have high deadwood. You can't filter your way to a realistic low-DW opponent hand when none of the candidates have low DW.
4. **v4 is less cautious than v3.** It knocks more often (58.7% vs 50.0%), which is the wrong direction in this undercut-heavy domain.

### The Core Remaining Problem

The generator needs to **construct meld-rich opponent hands**, not just reweight random samples. This would require:
- Enumerating possible meld structures over the remaining cards
- Sampling hands that contain specific melds
- Weighting by how plausible such meld structures are given public signals

This is a fundamentally different algorithm from importance-weighted sampling over random draws.

---

## Recommendation: Keep v3 as Default

**Do not replace v3 with v4 as the default solver.** v3's direct estimator-driven approach (belief reweighting + undercut penalty) is more effective at the core task of UC avoidance.

v4's belief-weighted generator is architecturally correct and should be preserved as infrastructure. The generator will become valuable when:
1. Per-card action traces are piped from the game engine (activating Stage 1)
2. Meld-aware opponent hand construction replaces random sampling (fixing the fundamental DW bias)

---

## Files Delivered

| File | Purpose |
|------|---------|
| `gin_rummy/belief_world_generator.py` | Two-stage belief-weighted hidden-world generator |
| `gin_rummy/solver_v4.py` | Solver v4 integrating the generator |
| `gin_rummy/run_phase66.py` | Master runner for calibration comparison |
| `phase66_results.json` | Full numeric results |
| `EXECUTION_REPORT_66.md` | This report |

---

## What's Next

The highest-force remaining moves, in order:

1. **Meld-aware opponent hand construction.** Don't sample random 10-card hands. Build hands around plausible meld structures (runs, sets), then populate remaining slots with deadwood. This is the only way to get sampled opponent hands below DW=10 at a realistic rate.
2. **Pipe per-card action traces.** The game engine knows which cards the opponent picked from the discard pile. Pass this to the generator to activate card-level weighting.
3. **Test v3 in live matches.** v3's conservative approach (reject knocks when UC risk is high) is the most trustworthy current solver for low-stock positions. Validate with real play.
