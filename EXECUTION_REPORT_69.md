# EXECUTION REPORT 69: Public-State CFR Pilot Sprint

**Directive:** `CLAUDE_DIRECTIVE_69.md`  
**Phase:** 69  
**Date:** 2026-03-23  
**Elapsed:** 731.6 s  
**Status:** Complete — first genuine imperfect-information CFR pilot is working

---

## Objective

Build the first honest public-state / belief-state CFR pilot for Gin Rummy. Define a bounded subgame, run real MCCFR over hidden-information decision points, measure tractability, compare against solver_v6, and decide whether Rust is an immediate blocker.

---

## Deliverables

| # | Deliverable | File | Status |
|---|-------------|------|--------|
| A | Old CFR audit | Section in this report + `phase69_results.json` | Delivered |
| B | Bounded subgame definition | `gin_rummy/cfr_public_state.py` | Delivered |
| C | MCCFR pilot | `gin_rummy/cfr_public_state.py` + `gin_rummy/run_phase69.py` | Delivered |
| D | Abstraction/throughput measurement | `phase69_results.json` | Delivered |
| E | CFR vs solver_v6 comparison | `phase69_results.json` | Delivered |
| F | Rust necessity assessment | `phase69_results.json` | Delivered |

---

## 1. What Transfers From The Old CFR Work (Task A)

### Reusable Infrastructure

| Component | Source | Status |
|-----------|--------|--------|
| Regret table handling (`defaultdict`) | `cfr_strategy.py` | **REUSED** — same pattern |
| Regret matching computation | `cfr_strategy.py:get_strategy()` | **REUSED** — identical |
| Average strategy accumulation | `cfr_strategy.py:accumulate_strategy()` | **REUSED** — same |
| JSON serialization pattern | `cfr_strategy.py:save()/load()` | Partially reusable |
| Training loop alternation | `cfr_trainer.py` | Concept reused |

### Non-Transferable Assumptions (Dead)

| Component | Problem |
|-----------|---------|
| Discard-only action space (K=3) | Modeled WHICH card to discard, not WHETHER to knock. Completely different decision. |
| Apex top-K candidate abstraction | Reduced CFR to a discard preference learner on top of Apex, not a genuine decision-maker. |
| Immediate deadwood reward proxy | Regret from DW reduction, not game outcomes. Made it a DW optimizer, not a strategy learner. |
| No hidden-information traversal | Never sampled opponent hands. CFR in name only. |
| Discard-oriented info-set features | 11-card pre-discard state, missing trace/belief features. |

### Verdict

The old CFR path was a **discard-preference learner built on Apex**, NOT a genuine imperfect-information game solver. Only the regret-table machinery transfers. Phase 69 is a **new oracle-oriented CFR path**, not a resurrection of the old experiment.

---

## 2. Bounded Subgame Definition (Task B)

### Subgame: Late-Game Legal-Knock Decision

| Property | Value |
|----------|-------|
| Decision point | Low-stock (≤6 cards), hero DW ≤ 10 |
| Action space | **{knock, continue}** — 2 actions |
| Hidden information | Opponent 10-card hand |
| Chance model | Belief-weighted world sampling |
| Leaf evaluation | Exact knock scoring / champion continuation rollout |

### Public-State / Information-Set Abstraction (11 dimensions)

```
PUBLIC STATE:          stock_bucket       (4 levels)
                       score_diff_bucket  (5 levels)
                       discard_pile_bucket(4 levels)
                       turn_bucket        (5 levels)

HERO HAND:             hero_dw_bucket     (6 levels: gin/near-gin/low/med/high/max)
                       hero_meld_count    (5 levels)
                       hero_gin_live      (2 levels: binary)

BELIEF CONDITIONING:   opp_pickup_bucket  (5 levels)
                       opp_discard_bucket (5 levels)
                       opp_decline_bucket (5 levels)
                       trace_intensity    (4 levels)
```

### Space Size

| Metric | Value |
|--------|-------|
| Theoretical max info sets | **12,000,000** |
| Observed info sets (1,000 spots) | **331** |
| Occupancy rate | **0.003%** |
| Theoretical memory | 384 MB |
| Observed memory | **10.6 KB** |

The occupancy rate is extremely sparse — only 331 of 12M theoretical info sets appear in real late-game positions. This means the practical info-set space is vastly smaller than the theoretical cross-product, and memory is negligible.

---

## 3. MCCFR Pilot Design (Task C)

### Architecture

```
                     ┌──────────────────────────┐
                     │   TraceRichSpot Dataset   │
                     │   (1,751 positions)       │
                     └──────────┬───────────────┘
                                │ sample spot
                                v
                     ┌──────────────────────────┐
                     │  Information-Set Key      │
                     │  (11-dim public-state     │
                     │   + belief abstraction)   │
                     └──────────┬───────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    v                       v
            ┌──────────────┐       ┌──────────────────┐
            │    KNOCK     │       │    CONTINUE       │
            │  exact score │       │  champion rollout  │
            │  per world   │       │  per world         │
            └──────┬───────┘       └───────┬───────────┘
                   └─────────┬─────────────┘
                             v
                    ┌──────────────────┐
                    │  REGRET UPDATE   │
                    │  action_value -  │
                    │  expected_value  │
                    └──────────────────┘
```

### Kuhn Poker Sanity Check: PASSED ✓

Before running on Gin Rummy, the regret machinery was validated on Kuhn Poker (the standard minimal CFR test game).

| Info Set | Pass | Bet | Expected (Nash) |
|----------|------|-----|-----------------|
| P0 with J (root) | 0.693 | **0.307** | ≈ 1/3 bet ✓ |
| P0 with Q (root) | 0.999 | 0.001 | ≈ 0 bet ✓ |
| P0 with K (root) | 0.000 | **1.000** | always bet ✓ |
| P1 with Q (facing bet) | 0.688 | 0.312 | ≈ 1/3 call ✓ |

Kuhn strategies converged to known Nash equilibrium in 10,000 iterations (0.16s). The regret matching and strategy accumulation machinery is correct.

### Training on Gin Rummy Bounded Subgame

| Metric | Value |
|--------|-------|
| Dataset | 1,751 trace-rich spots (300 games) |
| Iterations | **3,000** |
| Unique info sets | **397** |
| Elapsed | **36.5 s** |
| Throughput | **82.2 iter/s** |

---

## 4. Pilot Convergence / Throughput Results (Tasks C + D)

### Convergence Trajectory

| Iteration | Info Sets | Exploitability Proxy |
|-----------|-----------|---------------------|
| 300 | 170 | 0.799 |
| 600 | 255 | 0.721 |
| 900 | 299 | 0.670 |
| 1,200 | 321 | 0.606 |
| 1,500 | 338 | 0.559 |
| 1,800 | 359 | 0.548 |
| 2,100 | 372 | 0.526 |
| 2,400 | 382 | 0.506 |
| 2,700 | 387 | 0.475 |
| **3,000** | **397** | **0.473** |

The exploitability proxy is **steadily decreasing** (0.799 → 0.473), confirming genuine convergence. The decline has not plateaued, implying further improvement with more iterations.

### Strategy Characteristics

| Metric | Value |
|--------|-------|
| Mean knock probability | **0.655** |
| Mean continue probability | 0.345 |
| Mixed strategies (5% < p < 95%) | **339 / 397 (85.4%)** |

**85% of info sets learned genuinely mixed strategies.** This is the definitive evidence that the pilot is producing non-trivial output: in most late-game positions, the correct strategy is probabilistic, not deterministic.

### Throughput

| Metric | Value |
|--------|-------|
| MCCFR iterations/sec | **82.2** |
| World evaluations/sec | **1,644** |
| Total world evaluations | 60,000 |
| 10K iterations estimated | ~122 seconds |

Primary bottleneck: **continuation simulation** (`simulate_continuation_policy`). Each world requires a full rollout with meld arrangement at every step. Knock evaluation is comparatively cheap.

### Info-Set Abstraction Measurement

| Metric | Value |
|--------|-------|
| Spots sampled | 1,000 |
| Unique info sets | **331** |
| Theoretical max | 12,000,000 |
| Occupancy | **0.003%** |
| Mean spots per info set | 3.02 |
| Singleton info sets | 132 (40%) |
| Memory (observed) | **10.6 KB** |

The abstraction is extremely sparse. The actual information-set space is ~331, not 12M. Memory is negligible. This means the current abstraction has plenty of room to be refined (added dimensions, finer buckets) without memory concerns.

---

## 5. CFR vs Solver V6 Comparison (Task E)

### Headline Numbers (50 spots)

| Metric | Value |
|--------|-------|
| Agreement rate | **52%** |
| CFR knock rate | **80%** |
| V6 knock rate | **44%** |
| Disagreement spots | 24 |
| Mixed strategy spots | 33 |

### Interpretation

The CFR pilot **systematically recommends knock more aggressively than solver_v6** (80% vs 44% knock rate). This is a genuine strategic divergence, not random noise.

The 52% agreement rate means the CFR pilot and solver_v6 disagree on nearly half the spots. This is the expected result for an early pilot that:
- Has only seen 3,000 iterations (partial convergence)
- Uses a coarser abstraction than the solver's exact per-world evaluation
- Averages over information sets rather than evaluating each position individually

### Where They Agree

Both agree on the easiest cases:
- **DW=0 (gin):** both always knock ✓
- **DW=1, stock ≤ 2:** both knock (forced by stock depletion) ✓

### Where They Disagree

The CFR pilot knocks more in borderline spots:
- **DW=1, stock 3-5:** CFR often knocks, v6 often continues
- **DW=4-7, stock 4-5:** CFR knocks aggressively, v6 continues

This is consistent with a partially converged strategy that hasn't yet fully internalized the undercut risk signal. The pilot's mean knock probability of 0.655 suggests it's learning toward a mixed strategy but skews knock-heavy at this iteration count.

### Evidence of Non-Trivial Learning

The pilot produces **meaningful mixed strategies** on 33/50 spots (66%). Example:

| DW | Stock | P(knock) | P(continue) | V6 Action | Actual |
|----|-------|----------|-------------|-----------|--------|
| 1 | 3 | 0.527 | 0.473 | continue | knock_win |
| 1 | 3 | 0.250 | 0.750 | continue | undercut |
| 2 | 4 | 0.181 | 0.819 | knock | knock_win |
| 5 | 6 | 0.167 | 0.833 | knock | knock_win |
| 1 | 5 | 0.288 | 0.712 | continue | knock_win |

The varying probabilities across positions with the same hero DW but different trace contexts shows the pilot is **conditioning on belief features**, not just hero deadwood. This is the first time the project has produced genuine mixed strategies for the knock/continue decision.

---

## 6. Rust Necessity Assessment (Task F)

### Empirical Finding

| Metric | Value |
|--------|-------|
| Python throughput | **82.2 iter/s** |
| 10K iterations time | **~122 seconds** |
| Rust toolchain | **NOT available** |

### Verdict

**Python is sufficient for the bounded pilot.** The current throughput allows meaningful convergence experiments in minutes. Python is NOT the bottleneck for Phase 69 scope.

### Scaling Projections

| Scale | Estimated Time |
|-------|---------------|
| Bounded pilot (10K iter) | 2 minutes |
| Extended pilot (100K iter) | 20 minutes |
| Full-game CFR estimate | ~3.4 hours (100× scale) |

### Recommendation

> **Keep architecture work in Python for the next 1-2 phases.** Rust becomes relevant when scaling to larger subgames (wider action space, more game phases) or full-game CFR. The immediate next step should be widening the subgame scope, not rewriting in Rust.

---

## Truthfulness: Explicit Answers

### 1. Is a bounded public-state CFR pilot for Gin Rummy working in practice?

**Yes.** The pilot runs real MCCFR over a genuine imperfect-information subgame. It passed the Kuhn Poker sanity check (Nash-converged strategies), and on the Gin subgame it produced 397 info sets with steadily decreasing exploitability (0.799 → 0.473 over 3,000 iterations). The convergence has not plateaued, implying further improvement is available.

### 2. Is the Phase 68 trace-rich dataset sufficient to support a real information-set abstraction?

**Yes.** The 1,751 trace-rich spots cover 331 unique info sets with mean occupancy of 3.02 spots/set. The per-card trace data (pickups, discards, declines) successfully populates the belief-conditioning dimensions of the info-set abstraction. The trace features produce measurably different strategies across positions with the same hero deadwood but different opponent behavior histories.

### 3. What parts of the old CFR path transfer, and what parts are dead?

**Transfers:** Regret-table machinery (defaultdict, regret matching, strategy accumulation) — identical mathematical algorithm.

**Dead:** Everything else. The old path's discard-only action space, Apex top-K abstraction, immediate DW reward proxy, and absence of hidden-information traversal make it a discard-preference learner, not a game solver. The new path is fundamentally different.

### 4. Does the CFR pilot produce strategic behavior that is meaningfully different from solver_v6?

**Yes.** The pilot disagrees with solver_v6 on 48% of positions, systematically recommending knock more aggressively (80% vs 44% knock rate). More importantly, 85% of info sets learned genuinely mixed strategies — evidence of non-trivial regret learning that is structurally different from solver_v6's deterministic per-position evaluation. Whether this divergence is *better* than v6 requires more iterations and evaluation.

### 5. Is Rust now an immediate necessity, or just the next optimization frontier?

**Not immediate.** Python runs the bounded pilot at 82.2 iter/s, completing 10K iterations in ~2 minutes. This is sufficient for meaningful experimentation. Rust becomes necessary when scaling to larger subgames or pursuing full-game CFR, likely 2-3 phases from now.

### 6. What is the best next oracle-roadmap step after this pilot?

The best next step is **widening the subgame** (Phase 70 recommendation):

1. **More iterations:** Run the current pilot for 50K-100K iterations to see if mixed strategies stabilize and exploitability drops further.
2. **Wider action space:** Add draw-source decisions (stock vs discard pile) as a second decision surface.
3. **Finer abstraction:** The current 331 observed info sets are very sparse relative to the theoretical 12M. Coarsen some dimensions (remove trace_intensity) and refine others (split hero_dw more finely) to improve coverage.
4. **CFR-guided knock policy:** Deploy the learned mixed strategy as an actual knock policy and benchmark it against solver_v6 in live play.

---

## What Not To Overclaim

1. **The CFR pilot has NOT converged.** 3,000 iterations is early. The exploitability proxy is still 0.473, well above zero. The current strategies are directionally correct but not yet reliable.

2. **The knock-heavy divergence from v6 may be wrong.** The pilot's 80% knock rate is likely too aggressive at this iteration count. With more training, undercut risk should push the strategy toward more continue.

3. **The pilot does NOT prove CFR is better than heuristic solving.** It proves that CFR is *tractable* and produces *non-trivial* strategies. Whether those strategies are actually superior to solver_v6 requires convergence + evaluation.

4. **The 12M theoretical info-set space is misleading.** Only 331 info sets appear in practice. The abstraction is too coarse in some dimensions (many empty buckets) and may need rebalancing.

---

## Files Delivered

| File | Purpose |
|------|---------|
| `gin_rummy/cfr_public_state.py` | Info-set abstraction + MCCFR engine (Tasks B+C) |
| `gin_rummy/run_phase69.py` | Master runner (Tasks A-F) |
| `phase69_results.json` | Full numeric results |
| `EXECUTION_REPORT_69.md` | This report |
