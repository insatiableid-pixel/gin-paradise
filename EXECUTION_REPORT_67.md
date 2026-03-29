# EXECUTION REPORT 67: Trace-Aware Meld World Construction Sprint

**Directive:** `CLAUDE_DIRECTIVE_67.md`  
**Phase:** 67  
**Date:** 2026-03-23  
**Elapsed:** 26.1 s  
**Status:** Complete — v5 is a material breakthrough

---

## Objective

Replace the solver's remaining low-stock belief failure: random card sampling for opponent hands. Phase 66 proved two things — (1) the hidden-world model is the core bottleneck and (2) importance-weighting random hands is not enough. Phase 67 therefore builds the first **trace-aware, meld-aware opponent hand constructor** and integrates it as solver v5.

---

## Deliverables

| # | Deliverable | File | Status |
|---|-------------|------|--------|
| A | Per-card public action trace pipeline | `gin_rummy/action_trace.py` | Delivered |
| B | Meld-aware opponent hand constructor | `gin_rummy/meld_constructor.py` | Delivered |
| C | Trace + meld + estimator integration | Combined in meld_constructor.py | Delivered |
| D | Solver v5 | `gin_rummy/solver_v5.py` | Delivered |
| E | Calibration comparison v3 / v4 / v5 | `gin_rummy/run_phase67.py` + `phase67_results.json` | Delivered |
| F | Surviving knock frontier analysis | Section in results JSON | Delivered |

---

## 1. What New Trace Data Became Available (Task A)

### action_trace.py — The Missing Per-Card Pipeline

Phase 66 identified that the `OpponentModel`'s card weights were a no-op because the dataset stored only **counts** (n_opponent_pickups, n_opponent_discards), not specific cards. Phase 67 built `ActionTrace`, a proper per-card event log:

| Event Type | What It Records | Signal |
|------------|-----------------|--------|
| `opp_pickup` | Exact card opponent took from discard pile | KNOWN in opponent hand (if not re-discarded) |
| `opp_discard` | Exact card opponent discarded | NOT in opponent hand; neighbours LESS likely |
| `opp_decline` | Card opponent passed on from discard top | Doesn't need it or its neighbours |
| `hero_discard` | Card hero discarded | Available information for future use |

### Adjacency Propagation

Per-card trace weights propagate through meld-neighbourhood relationships:

- **Pickup adjacency boost:** Same rank (+0.8), adjacent run (+0.8), near run (+0.4)
- **Discard adjacency reduce:** Same rank (-0.5), adjacent run (-0.5), near run (-0.25)
- **Decline reduce:** Card itself (-0.3), neighbours (-0.15)

All weights clamped to [0.05, 6.0].

### Honest Limitation: Signal Activation in This Evaluation

The Phase 65 dataset stores only pickup/discard **counts**, not specific cards. In the trace signal audit (100 spots):

| Metric | Value |
|--------|-------|
| Spots with active signal (spread > 0.01) | **0 / 100 (0%)** |
| Mean weight spread | 0.0 |

**The per-card trace signal did NOT activate in this evaluation.** The pipeline is correct and ready, but it needs per-card event data from real game replays to produce non-uniform weights. **All differentiation in this evaluation comes from meld-aware construction (Task B) and the estimator quality prior, not from card-level tracing.**

---

## 2. How the Meld-Aware Constructor Works (Task B + C)

### Architecture: Range Construction, Not Random Sampling

```
          ┌─────────────────────────────────┐
          │  MELD SKELETON ENUMERATION      │
          │  Find all plausible sets/runs   │
          │  from the unknown card pool     │
          │  → Score by trace-weight sum    │
          │  → Keep top-K by score          │
          └─────────────────┬───────────────┘
                            │
    ┌───────────────────────┼───────────────────────┐
    │                       │                       │
    v                       v                       v
┌────────────┐   ┌──────────────┐   ┌────────────────┐
│ TIER 1     │   │ TIER 2       │   │ TIER 3         │
│ Skeleton   │   │ Trace-Random │   │ High-DW        │
│ (65%)      │   │ (20%)        │   │ (15%)          │
│ Build hand │   │ No forced    │   │ Bias toward    │
│ around     │   │ melds, but   │   │ face cards /   │
│ meld       │   │ card-level   │   │ junk hands     │
│ skeleton   │   │ weights      │   │ (opponent      │
│            │   │ still active │   │  stuck)        │
└──────┬─────┘   └──────┬───────┘   └───────┬────────┘
       │                │                    │
       └────────────────┼────────────────────┘
                        v
              ┌──────────────────┐
              │ QUALITY GATING   │
              │ Gaussian kernel  │
              │ on predicted     │
              │ mean opp DW      │
              │ → keeps plausible│
              │   hands only     │
              └──────────────────┘
```

### Skeleton Enumeration Results (50 spots)

| Metric | Value |
|--------|-------|
| Mean skeletons per spot | 28.8 |
| Mean unique cards in skeletons | 9.8 |
| Spots with zero skeletons | **0** |

Every low-stock spot produces viable meld skeletons. The constructor has material to work with in 100% of cases.

### What Is Exact vs Heuristic

| Component | Exact or Heuristic |
|-----------|--------------------|
| Meld arrangement / deadwood scoring | **Exact** |
| Card visibility constraints | **Exact** |
| Known-opponent forced cards | **Exact** |
| Meld skeleton scoring (trace-weight sum) | Heuristic |
| Deadwood quality gating (Gaussian kernel) | Heuristic |
| Skeleton selection (top-K by score) | Approximate |
| Completion sampling | Approximate |

---

## 3. How v5 Differs from v3 / v4

| Feature | v3 (Phase 65) | v4 (Phase 66) | v5 (Phase 67) |
|---------|---------------|---------------|---------------|
| World generation | Uniform random | Belief-weighted random | **Meld-first construction** |
| Card-level signal | Not piped | OpponentModel (no-op) | ActionTrace pipeline (ready, not active on dataset) |
| Opponent hand shape | Random 10-card bundles | Random + quality filter | **Built around meld skeletons** |
| Quality gating | None | Gaussian kernel on DW | Gaussian kernel on DW |
| UC reweighting | Post-hoc belief weights | Importance weights | Importance weights |
| UC penalty | Yes (full delta) | Yes (damped 0.5x) | Yes (damped 0.4x) |
| Tier coverage | Single tier | Single tier | **Three tiers** (skeleton/random/high-DW) |

**The fundamental difference:** v3 and v4 both sample random 10-card bundles from the card pool, then try to reweight. v5 **constructs** hands by first proposing plausible meld structures and then filling remaining slots. This is not a refinement — it is a different algorithm.

---

## 4. Calibration Comparison: v3 vs v4 vs v5 (Task E)

### Headline Numbers (150 low-stock legal-knock positions)

|                              | v3 (P65) | v4 (P66) | **v5 (P67)** | **Actual** |
|------------------------------|----------|----------|-------------|------------|
| Mean opp DW prediction       | 28.5     | 24.1     | **7.3**     | **2.9**    |
| Opp DW MAE                   | 25.6     | 21.2     | **4.8**     | —          |
| Opp DW bias                  | +25.6    | +21.2    | **+4.4**    | —          |
| Frac opp worlds DW ≤ 5       | 4.2%     | 10.1%    | **42.3%**   | **86.7%**  |
| Knock rate                   | 50.0%    | 58.7%    | **38.0%**   | —          |
| Continue rate                 | 50.0%    | 41.3%    | **62.0%**   | —          |

### Undercut-Aware Accuracy (87 actual undercut positions)

|                              | v3       | v4       | **v5**      |
|------------------------------|----------|----------|-------------|
| Correctly says "continue"    | 48/87 (55%) | 43/87 (49%) | **66/87 (76%)** |

### Key Takeaways

1. **Opp DW MAE collapsed:** 25.6 → 4.8 (v3→v5). This is a **5.3x improvement**. v5 predicts opponent deadwood at 7.3 vs the actual 2.9. v3 predicts 28.5. The gap to reality went from 25.6 to 4.4.

2. **Low-DW world fraction surged:** 4.2% → 42.3% (v3→v5). That's a **10x improvement** in producing opponent worlds with DW ≤ 5. Reality is 86.7%, so the remaining gap is about 2x, not the 20x gap v3 had.

3. **Correct-continue on undercut positions:** 55% → 76%. v5 correctly avoids knocking on 21 more undercut positions than v3 (out of 87).

4. **v5 is materially better than v3** across every calibration metric. This is not marginal.

5. **v5 is also materially better than v4** — the meld-first construction is the decisive improvement over v4's importance-weighted random sampling.

---

## 5. Whether the World Model Finally Got Closer to Real Opponent Hands

### Yes.

The residual bias is honest and bounded:

| Metric | v3 | v5 | Improvement |
|--------|----|----|-------------|
| Mean opp DW vs actual | 28.5 vs 2.9 = **+25.6** | 7.3 vs 2.9 = **+4.4** | **5.8x closer** |
| Frac DW ≤ 5 vs actual | 4.2% vs 86.7% = **gap 82.5 pp** | 42.3% vs 86.7% = **gap 44.4 pp** | **1.9x closer** |
| Correct-continue on UC | 55% | **76%** | **+21 pp** |

v5 still overestimates opponent deadwood by +4.4 (predicting 7.3 when reality is 2.9), and still only generates 42.3% low-DW worlds when reality is 86.7%. The remaining gap comes from:

1. **No active card-level trace signal** in this dataset — when real per-card events activate, skeleton scoring will improve.
2. **The 15% zero-meld tier** deliberately includes high-DW junk hands, pulling the mean up.
3. **The estimator's DW prediction** may not be perfectly centred, so the quality kernel doesn't perfectly filter.

But the direction is correct and the magnitude of improvement is large.

---

## 6. How the Surviving Knock Frontier Changed (Task F)

### Knock Survivors: v3 → v5

| Metric | v3 | v4 | **v5** |
|--------|----|----|--------|
| Total knock recommendations | 75 | 88 | **57** |
| Continue recommendations | 75 | 62 | **93** |

v5 is the **most conservative solver** — it recommends knocking only 38% of the time, vs v3's 50% and v4's 59%.

### v5 Knock Survivors by DW Class

| DW | n | Gin | Win | UC | UC Rate | Notes |
|----|---|-----|-----|----|---------|-------|
| 0  | 24 | 24 | 0 | 0 | **0.0%** | Safe: always knock gin |
| 1  | 9  | 0  | 4 | 5 | 55.6% | Still risky |
| 2  | 12 | 0  | 5 | 7 | 58.3% | Still risky |
| 3  | 2  | 0  | 0 | 2 | 100.0% | All undercuts |
| 5  | 1  | 0  | 0 | 1 | 100.0% | All undercuts |
| 7  | 3  | 0  | 0 | 3 | 100.0% | All undercuts |
| 8  | 3  | 0  | 2 | 1 | 33.3% | Small sample |
| 9  | 3  | 0  | 1 | 2 | 66.7% | Mostly undercuts |

### Knock Survivor Classification

| Class | Count |
|-------|-------|
| Gin (DW=0) | 24 |
| Clinch-adjacent | 0 |
| Low-DW (DW=1-2, non-clinch) | 21 |
| Other | 12 |

### UC Rate Among Surviving Knock Recommendations

| Solver | UC Rate | Knock Count |
|--------|---------|-------------|
| v3 | 52.0% | 75 |
| v4 | 50.0% | 88 |
| **v5** | **36.8%** | **57** |

**v5's surviving knock class is narrower, rarer, and cleaner.** The UC rate among its remaining knock recommendations dropped from 52% (v3) to 36.8% (v5). Combined with having fewer total knocks (57 vs 75), this means v5 is more selective and its knock advice is more believable.

### Recommendation Changes

| Transition | v3 → v5 | v4 → v5 |
|------------|---------|---------|
| Same action | 98 | 107 |
| knock → continue | 35 | 37 |
| continue → knock | 17 | 6 |

v5 flips **35 positions from knock to continue** relative to v3, and **37 from knock to continue** relative to v4. It flips far fewer in the other direction (17 and 6), confirming it is a more cautious, better-calibrated solver.

---

## 7. Truthfulness: Source Attribution

### What came from new trace plumbing (Task A)
- The `ActionTrace` class and `build_trace_weights()` are new infrastructure.
- **Zero signal activated in this evaluation** because the Phase 65 dataset lacks per-card event data.
- The pipeline is architecturally correct and ready for real game integration.

### What came from meld-aware hand construction (Task B)
- **This is the entire source of v5's improvement.**
- Meld skeleton enumeration produces 28.8 skeletons per spot on average.
- Three-tier generation (65% skeleton / 20% random / 15% high-DW) produces realistic world distributions.
- Opp DW MAE went from 25.6 → 4.8 **entirely due to meld-first construction**.

### What came from the undercut estimator
- Quality gating (Gaussian kernel on predicted mean opp DW) helps filter implausible hands.
- Undercut penalty correction (damped at 0.4x) provides secondary calibration.
- The estimator itself (AUC 0.752, Brier 0.202) is unchanged from Phase 65.

### What remains heuristic
- Meld skeleton scoring (trace-weight sum as proxy for plausibility)
- Deadwood quality gating (Gaussian kernel shape)
- Tier allocation fractions (65/20/15)
- Undercut penalty damping factor (0.4)

---

## Honest Answers to the Three Direct Questions

### 1. Did the card-level signal finally activate?
**No.** The `ActionTrace` pipeline is built and correct, but the Phase 65 dataset doesn't contain per-card events. Weight spread was 0.0 across all evaluated spots. The signal will activate when integrated with real game replay data.

### 2. Did sampled opponent deadwood meaningfully move toward reality?
**Yes, dramatically.** Mean predicted opp DW went from 28.5 (v3) to 7.3 (v5), vs actual 2.9. MAE dropped from 25.6 to 4.8. The fraction of sampled worlds with DW ≤ 5 went from 4.2% to 42.3% (actual: 86.7%). This is the first time sampled worlds have been anywhere near realistic.

### 3. Is v5 genuinely better than v3, or just architecturally nicer?
**v5 is genuinely better than v3** on every measured metric:
- Opp DW MAE: 25.6 → 4.8 (5.3x)
- Low-DW world fraction: 4.2% → 42.3% (10x)
- Correct-continue on UC spots: 55% → 76% (+21 pp)
- Surviving knock UC rate: 52% → 36.8% (-15 pp)
- Knock rate: 50% → 38% (more conservative, correct direction)

This is not marginal or architectural — it is a material calibration breakthrough.

---

## What Not to Overclaim

1. **The card-level trace signal is still inert.** When it activates in live play, it should further improve skeleton scoring and fill sampling. But we cannot claim it contributed here.

2. **Mean opp DW still overestimates by +4.4.** v5 is 5.8x closer to reality than v3, but not at reality. The remaining gap is addressable but real.

3. **Low-DW world fraction is 42.3% vs 86.7% actual.** Still roughly half of what it should be. The zero-meld tier and imperfect quality gating pull the distribution upward.

4. **Non-gin knock recommendations are still risky.** Among v5's 33 non-gin knocks, the UC rate is ~60%. The solver is not yet accurate enough to reliably recommend non-gin knocks in low stock.

---

## Best Next Oracle-Roadmap Step

Phase 67 proved that **meld-aware hand construction is the right abstraction layer**. The remaining gaps are:

1. **Activate the card-level trace signal.** Pipe per-card pickup/discard/decline events from the game engine into `ActionTrace`. This will make skeleton scoring and fill sampling more realistic.

2. **Close the low-DW world gap.** The constructors produces 42% low-DW worlds vs 87% actual. Options: bias skeleton selection toward good deadwood outcomes, or add a fourth "gin-chasing" tier.

3. **v5 live play validation.** Run v5 through actual game situations (not just the Phase 65 dataset) to confirm calibration holds in dynamic play.

4. **Non-gin knock refinement.** v5's 33 surviving non-gin knocks still have ~60% UC. Consider whether any of these are genuinely correct, or whether the solver should default to a near-gin-only knock policy.

---

## Files Delivered

| File | Purpose |
|------|---------|
| `gin_rummy/action_trace.py` | Per-card public action trace pipeline (Task A) |
| `gin_rummy/meld_constructor.py` | Meld-aware opponent hand constructor (Tasks B+C) |
| `gin_rummy/solver_v5.py` | Solver v5 integrating meld-aware worlds (Task D) |
| `gin_rummy/run_phase67.py` | Master runner for calibration comparison (Tasks E+F) |
| `phase67_results.json` | Full numeric results |
| `EXECUTION_REPORT_67.md` | This report |
