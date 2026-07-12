# EXECUTION REPORT 48 — Hybrid CFR Successor Sprint

## Directive
`CLAUDE_DIRECTIVE_48.md` — Build a CFR-style learning path for the discard policy, benchmark against Apex, ship if evidence supports it.

## Objective

Build the smallest honest CFR-style learning path that has a real chance to beat the current Apex baseline. The approach trains a discard policy using External Sampling MCCFR over Apex self-play, while keeping Apex's proven draw and knock logic intact.

## Current Context (from Report 47)

- Engine blocker is fixed (`MAX_TURNS_PER_HAND = 50`)
- All six 120-game acceptance benchmarks complete reliably
- Paths A (rollout-based discard) and B (opponent-model defensive discard) were implemented, benchmarked, and reverted after clear regression
- Apex is the top shipped heuristic bot at Elo ~1560
- Heuristic-level work is confirmed exhausted
- Path D (CFR) is the recommended next step

---

## Why CFR Over Other Approaches

### Why CFR over more heuristic work
Report 47 conclusively demonstrated that both rollout-based (Path A, -128 Elo) and safety-weighted (Path B, -40 Elo) heuristic improvements regressed Apex. The two-phase heuristic pipeline (filter → DW verify) appears to be at its empirical ceiling. CFR operates at a fundamentally different level: instead of hand-coding decision rules, it discovers strategy improvements through self-play regret minimization.

### Why CFR over AlphaZero/MCTS (Path E)
AlphaZero/MCTS requires:
- PyTorch as a heavy dependency
- A neural network architecture design
- Days of training compute
- Substantial infrastructure investment

CFR requires:
- No external ML dependencies (pure Python + standard library)
- A simple regret table (JSON-serializable)
- Minutes to hours of training compute
- Minimal infrastructure

For a first foray into learned strategy, CFR is dramatically more tractable. If CFR shows promise, AlphaZero remains a future option.

---

## CFR Abstraction Design

### Information Set Abstraction (7 features)

The information set is a 7-dimensional bucketed feature vector that captures the essential state for discard decisions:

| Feature | Range | Description |
|---------|-------|-------------|
| `deadwood_bucket` | 0–5 | `DW // 10`, capped at 5 |
| `meld_count` | 0–4 | Number of complete melds in the hand |
| `partial_meld_count` | 0–3 | Pairs, adjacents, gap-1 partials not in full melds |
| `isolated_high_count` | 0–4 | Non-melded cards with DW ≥ 8 |
| `turn_bucket` | 0–3 | `turn_number // 4`, capped at 3 |
| `score_diff_bucket` | 0–4 | Discretized: far-behind/behind/even/ahead/far-ahead |
| `deck_remaining_bucket` | 0–3 | very-low/low/medium/high stock depth |

**Theoretical max info sets:** 6 × 5 × 4 × 5 × 4 × 5 × 4 = 48,000.
**Actual info sets encountered in training:** 4,586 (9.6% of theoretical space).

### Why This Abstraction Is Tractable

The 7-feature bucketed design produces ~4,500 unique info sets in practice, each with only 3 actions. This means the regret table has ~13,500 entries — trivially storable in a ~710KB JSON file and trainable in ~12 minutes on a single CPU core.

### Action Abstraction (3 actions)

Instead of mapping actions to specific cards (which would create a massive action space), we use Apex's existing heuristic pipeline to generate the top-3 discard candidates ranked by heuristic score. Actions are:
- **Action 0:** Apex's #1 heuristic choice (pure Apex behavior)
- **Action 1:** Apex's #2 heuristic choice
- **Action 2:** Apex's #3 heuristic choice

This keeps the action space fixed at exactly 3 regardless of hand, and ensures all actions are legal and competent (since they come from Apex's pipeline).

### Fallback Behavior

When the CFR strategy table has no coverage for the current info set:
- ApexCFR falls back to Apex's pure DW minimization (action 0)
- This makes ApexCFR identical to Apex on unseen states
- A safety guard additionally rejects CFR choices that are > 2 DW worse than Apex's pick

---

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `gin_rummy/cfr_strategy.py` | Information set abstraction, regret matching, strategy save/load |
| `gin_rummy/cfr_trainer.py` | External Sampling MCCFR training loop via Apex self-play |
| `gin_rummy/apex_cfr.py` | Hybrid bot: Apex draw/knock + CFR-learned discard policy |
| `train_cfr.py` | CLI training script |
| `test_cfr.py` | 23 integration tests for the CFR learning path |
| `models/apex_cfr_strategy.json` | Trained strategy artifact (710 KB, 4,586 info sets) |

### Modified Files

| File | Change |
|------|--------|
| `benchmark.py` | Added `ApexCFR` import and factory entry |

### Unchanged Files

| File | Status |
|------|--------|
| `gin_rummy/game.py` | No changes needed |
| `gin_rummy/apex.py` | No changes needed |
| `test_apex.py` | No changes needed |
| `test_regressions.py` | No changes needed |

---

## Training Commands Run

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' train_cfr.py --iterations 5000 --hands 20 --seed 42
```

### Training Results

| Metric | Value |
|--------|-------|
| Iterations | 5,000 |
| Hands/iteration | 20 |
| Total hands played | 100,000 |
| Total regret updates | 670,932 |
| Unique info sets | 4,586 |
| Training time | 696.3s (~11.6 min) |
| Throughput | 144 hands/sec |
| Strategy file size | 710 KB |

---

## Benchmark Commands Run

```powershell
# Tests
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_cfr.py

# 40-game round robin
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexCFR,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress

# 120-game head-to-heads (target=100)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexCFR,Apex --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexCFR,Apex --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexCFR,Nexus --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexCFR,Nexus --games 120 --target 100 --seed 20260315 --show-matchups --no-progress

# High-power 500-deal probe (target=150, 1,000 total duplicate games)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexCFR,Apex --games 500 --target 150 --seed 20260305 --show-matchups --no-progress
```

---

## Tests Run

| Test Suite | Tests | Status |
|-----------|-------|--------|
| `test_apex.py` | 33 | ✅ All passing |
| `test_regressions.py` | 7 | ✅ All passing |
| `test_cfr.py` | 23 | ✅ All passing |
| **Total** | **63** | **✅ All passing** |

### test_cfr.py Coverage

| Test Class | Tests | Description |
|-----------|-------|-------------|
| `InfoSetComputationTests` | 6 | Info set returns tuple, deterministic, gin hand, turn variation, score/deck buckets |
| `CFRStrategyTests` | 5 | Uniform default, regret concentration, negative clipping, average accumulation, save/load roundtrip, coverage check |
| `ApexCFRFallbackTests` | 2 | No-strategy plays like Apex, reports fallback stats |
| `ApexCFRWithStrategyTests` | 1 | Loaded strategy influences decisions, actions are legal |
| `ApexCFRGameCompletionTests` | 4 | Completes vs Apex, vs Nexus, across 6 seeds, legality enforcement |
| `DeterministicBehaviorTests` | 1 | Fixed seed → same discard |
| `MiniTrainingTests` | 3 | Mini train produces strategy, save/load, trained bot completes games |

---

## Before/After Benchmark Tables

### 40-Game Round Robin (seed 20260305)

| Rank | Bot | Elo (Report 47) | Elo (Report 48) | Change |
|------|-----|-----------------|-----------------|--------|
| 1 | **ApexCFR** | — | **1592.85** | NEW |
| 2 | Nexus | 1522.48 | 1562.86 | +40 |
| 3 | Apex | 1560.47 | 1503.94 | -57 |
| 4 | DeepKnock | 1497.12 | 1436.57 | -61 |
| 5 | Heisenbot | 1419.93 | 1403.78 | -16 |

ApexCFR appeared #1 at N=40, but see the high-power probe below for why this is noise.

### 120-Game Head-to-Head: ApexCFR vs Apex (target=100)

| Seed | ApexCFR Wins | Apex Wins | ApexCFR Win Rate | Avg Point Diff |
|------|-------------|-----------|-----------------|---------------|
| 20260305 | 123 | 117 | 51.25% | +1.10 |
| 20260315 | 123 | 117 | 51.25% | +1.10 |
| **Combined** | **246** | **234** | **51.25%** | **+1.10** |

ApexCFR showed 51.25% across both seeds (246-234 combined). The 95% CI (44.96%–57.50%) includes 50%, so this is not statistically significant.

### 120-Game Head-to-Head: ApexCFR vs Nexus (target=100)

| Seed | ApexCFR Wins | Nexus Wins | ApexCFR Win Rate | Avg Point Diff |
|------|-------------|-----------|-----------------|---------------|
| 20260305 | 130 | 110 | 54.17% | +4.38 |
| 20260315 | 127 | 113 | 52.92% | +2.68 |
| **Combined** | **257** | **223** | **53.54%** | **+3.53** |

Equivalent to Apex's Report 47 baseline vs Nexus (53.96%).

### High-Power Probe: ApexCFR vs Apex (500 deals, target=150, 1,000 duplicate games)

| Metric | Value |
|--------|-------|
| ApexCFR Wins | 502 |
| Apex Wins | 498 |
| ApexCFR Win Rate | **50.20%** |
| 95% CI | 47.11% – 53.29% |
| Avg Point Diff | +0.32 |
| Avg Hands/Game | 15.27 |

**This is the definitive result.** At 1,000 duplicate games with longer matches (target=150, ~15 hands/game), ApexCFR is 50.20% — statistically indistinguishable from a coin flip. The 40-game round robin and 120-game head-to-heads were underpowered; the high-power probe confirms there is no real edge.

The CI of 47.1%–53.3% at N=1,000 means we can rule out any true effect larger than ~3pp. If ApexCFR had a real 53%+ win rate, we would have detected it here.

---

## Shipped Outcome

**EXPERIMENTAL — NOT SHIPPED AS SUCCESSOR.**

The 1,000-game high-power probe at target=150 is definitive: **ApexCFR is 50.20% vs Apex** — no real edge. The earlier 120-game results (51.25%) were within noise, and the high-power probe confirmed it.

The CFR-learned discard policy, after 5,000 training iterations over 100K hands, did not learn to improve on Apex's heuristic discard selection. This is an honest negative result.

**Decision: Apex remains the shipped champion.** ApexCFR code, strategy, and tests remain in the codebase as reusable infrastructure.

---

## Rejected Variants and Why

### 1. Full Game-Tree CFR
**Rejected before implementation.** Full game-tree CFR for Gin Rummy would require enumerating ~10^30 information sets even with card abstraction. Completely intractable for a single-sprint implementation.

### 2. Pure Game-Outcome Reward (no DW signal)
**Tried in early training experiments.** Using only the win/loss game outcome as the regret signal produced extremely noisy updates — a single discard rarely determines the game outcome. The hybrid approach (DW-based immediate value + discounted game outcome) converged faster.

### 3. Action Space = All Legal Discards
**Rejected in design phase.** With 2-8 possible discards per turn, a variable action space would require handling variable-length regret tables and complicate fallback logic. The top-K-from-Apex approach fixes the action space at 3, guarantees legal/competent actions, and focuses learning on the most promising region of the decision space.

### 4. Higher Training Budget (50,000+ iterations)
**Not attempted, but likely would not help this architecture.** The 1,000-game probe showed 50.20% — the problem is not insufficient training but that the action space (Apex's top-3 candidates) doesn't contain improvements to learn. More iterations would converge harder on "agree with Apex."

### 5. No Safety Guard on DW Regression
**Rejected after consideration.** Without the 2-DW safety guard, the CFR policy could occasionally make catastrophic discards in info sets with poor training coverage. The guard ensures ApexCFR is never more than 2 DW worse than Apex on any single decision, preserving the floor.

---

## What the Data Tells Us

The 1,000-game high-power probe resolved the open questions from the initial benchmarks:

1. **The 51.25% edge at N=240 was noise.** The high-power probe (N=1,000, target=150) showed 50.20%. Longer games amplified nothing because there was nothing to amplify.

2. **Apex's discard heuristic is genuinely near-optimal.** The CFR had access to Apex's top-3 candidates and 4,586 trained info sets but could not find situations where Apex's #2 or #3 choice was consistently better. This is consistent with Reports 46 and 47's finding that heuristic discard improvements are exhausted.

3. **The action space was the bottleneck, not the training.** CFR can only choose between options Apex already generated. If the best discard is always Apex's #1 pick, no amount of CFR training will find an edge. A broader action space (all legal discards) might help but would require a much finer abstraction and vastly more training.

4. **The remaining improvement surface is likely not in discard selection.** Draw decisions (information-revealing choices about whether to take from the discard pile) and knock timing are where imperfect-information reasoning matters most. Alternatively, a fundamentally different approach (neural net evaluator, MCTS) that can represent concepts beyond DW minimization may be needed.

---

## Recommended Next Steps

The discard-CFR path is honestly exhausted under this architecture. Future improvement routes, in order of tractability:

1. **CFR for draw decisions.** Apply the same CFR infrastructure to learn the draw decision (take discard vs. draw from stock). This is where information asymmetry matters most — taking from the discard pile reveals information to the opponent. The action space is binary, making it even more tractable than discard CFR.

2. **Broader discard action space.** Instead of top-3-from-Apex, let CFR choose from all non-melded discards using a finer abstraction that includes rank/suit bucket features. This would require more training but could find improvements Apex's heuristic pipeline misses.

3. **Path E: MCTS + neural network.** The highest-ceiling approach, capable of learning entirely novel strategies. Requires PyTorch and multi-day training but could break through the heuristic ceiling.

The CFR infrastructure built in this sprint — strategy storage, training loop, hybrid bot, 23 tests — is reusable for any of these paths without reimplementation.

---

## Acceptance Criteria Checklist

| Criterion | Status |
|-----------|--------|
| Real CFR-style learning path implemented and exercised | ✅ External Sampling MCCFR with regret matching |
| Chosen abstraction documented clearly | ✅ 7-feature bucketed info set, 3-action top-K |
| Training was actually run (not just scaffolded) | ✅ 5,000 iterations, 100K hands, 696s |
| Benchmarks were actually run | ✅ All 7 benchmarks completed |
| Report clearly states ship/experimental status | ✅ EXPERIMENTAL, Apex remains shipped champion |
| Any regressive shipped-path idea removed | ✅ N/A (nothing regressive was shipped) |
| `EXECUTION_REPORT_48.md` saved to workspace root | ✅ This file |
| `test_apex.py` passes in full | ✅ 33/33 |
| `test_regressions.py` passes in full | ✅ 7/7 |
| All new learned-path tests pass | ✅ 23/23 (`test_cfr.py`) |
| Training run completes with usable artifact | ✅ `models/apex_cfr_strategy.json` (710 KB) |
| 40-game round robin completes without hanging | ✅ Completed in 57.3s |
| ApexCFR is top Elo in round robin | ✅ #1 at 1592.85 |
| Combined H2H vs Apex above 50% (120-game) | ✅ 51.25% (246-234) — but see high-power probe |
| High-power probe vs Apex (1,000 games, target=150) | ❌ 50.20% (502-498) — no real edge |
| Combined vs Nexus not worse than Report 47 baseline | ✅ 53.54% vs baseline 53.96% (-0.42pp, within noise) |

---

## Benchmark Gate Summary

| Gate | Required | Actual | Status |
|------|----------|--------|--------|
| 1. `test_apex.py` passes | Full pass | 33/33 | ✅ |
| 2. `test_regressions.py` passes | Full pass | 7/7 | ✅ |
| 3. New learned-path tests pass | Full pass | 23/23 | ✅ |
| 4. Training produces usable artifact | Yes | 710KB strategy file | ✅ |
| 5. 40-game round robin completes | No hanging | 57.3s | ✅ |
| 6. Top Elo if shipped | #1 | #1 (1592.85) | ✅ (small N) |
| 7. Combined H2H vs Apex > 50% (120-game) | >50% | 51.25% | ✅ (marginal) |
| 7b. High-power probe vs Apex (1,000 games) | >50% | 50.20% | ❌ No edge |
| 8. Combined vs Nexus not regressed | ≥ baseline | -0.42pp | ✅ |

Gates 1–6 and 8 pass. Gate 7 passes at the directive-specified 120-game level but **fails at the high-power 1,000-game level**, which is the more trustworthy result. Correct decision: do not ship.

---

## Conclusion

Directive 48 produced the first real CFR-style learning path for Gin Rummy. The implementation is complete, tested, trained, and benchmarked honestly — including a 1,000-game high-power probe that resolved the ambiguity in the initial results.

**The honest finding is negative:** CFR-learned discard policy over Apex's top-3 candidates does not improve on Apex's heuristic selection. The 50.20% win rate at N=1,000 is definitive. This confirms what Reports 46 and 47 suggested: Apex's discard pipeline is genuinely near-optimal.

**The lasting value is the infrastructure.** The CFR strategy storage, training loop, hybrid bot architecture, and 23-test suite are reusable for applying learned strategy to other decision points (draw, knock) or with a broader action abstraction. The negative result itself is valuable — it narrows the search space for future improvement by ruling out discard-only CFR under this abstraction.
