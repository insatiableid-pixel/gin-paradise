# EXECUTION REPORT 56 — Knock Ablation Validation Sprint

## Objective

Validate whether the Phase 55 `ApexMCTSKnock` breakthrough (64.70% vs ApexMCTS) represents a genuine learned-model advantage, or whether simpler knock policies reproduce or exceed the same gain.

## Current Context

Report 55 shipped `ApexMCTSKnock` as a provisional champion with 64.70% win rate over 1,000 seat-balanced games against `ApexMCTS`. However, three interpretation risks remained:

1. The learned model's offline accuracy advantage over `go_gin` was tiny (95.87% vs 95.81%)
2. Knocking is correct only ~4.2% of legal knock states — patience alone might explain the gain
3. The comparison set did not include simple ablations with obvious dominant-action rules

## Why This Validation Path Was Chosen

Report 55's 64.70% win rate against ApexMCTS is dramatic, but the mechanism could be any of:

- **Genuine learned nuance** in knock timing
- **Simple patience** (rarely knocking crushes ApexMCTS's aggressive knock heuristic)
- **Obvious match-equity exceptions** (gin, clinch, low-stock)

Until the learned model is tested against ablation bots that already incorporate patience and obvious rules, promotion should remain provisional.

---

## Verdict: LEARNED MODEL REJECTED — PROMOTION UNRESOLVED

**The learned knock model is not ship-worthy.** Simple patience policies (GoGin, ClinchGoGin) reproduce or exceed the learned model's entire gain against ApexMCTS. The Phase 55 breakthrough was a patience discovery, not a learned-model discovery.

However, **no bot is promoted** from this sprint. The benchmarks tested against aggressive opponents (ApexMCTS) who are known to be exploitable by patience. GoGin wins those benchmarks by maximum exploitation, but it misses unconditionally correct dominant actions (score-clinch, low-stock). The right evaluation requires testing against equally strong (patient) opponents, which Phase 56 did not complete.

---

## 1. Ablation Bot Definitions

| Bot | Knock Policy | Purpose |
|-----|-------------|---------|
| `ApexMCTSGoGin` | Gin only (DW=0) → knock; else never | Purest patience ablation |
| `ApexMCTSClinchGoGin` | Gin → knock; clinch (wins game) → knock; low-stock (deck ≤ 8) → knock; else never | Patience + obvious dominant actions |
| `ApexMCTSFirstKnock` | Any legal knock (DW ≤ 10) → knock | Maximum aggression extreme |
| `ApexMCTSPaperKnock` | Paper-inspired heuristic rules (gin, low-stock, score-clinch, turn/DW buckets) | Textbook strategy without learning |
| `ApexMCTSKnock` | Learned MLP model (gin/low-stock hard rules + model for DW 1–10) | Phase 55 provisional champion |
| `ApexMCTS` | Apex heuristic (aggressive knock with MC layoff check) | Pre-Phase 55 champion |

All ablation bots share the same ApexMCTS draw logic and Apex discard logic. Only the knock policy differs.

---

## 2. Targeted Knock Scenario Coverage

### Test Results

| Test Suite | Tests | Result |
|------------|-------|--------|
| `test_knock_ablation.py` | 24 | ALL PASS |
| `test_knock_scenarios.py` | 11 (1 skipped) | ALL PASS |

### Scenario Coverage

| Scenario | GoGin | ClinchGoGin | FirstKnock | PaperKnock | ApexMCTS |
|----------|-------|-------------|------------|------------|----------|
| 1. Immediate clinch (score=98, DW=1) | ✗ Never knocks non-gin | ✓ Knocks | ✓ Knocks | ✓ Knocks | ✓ Knocks |
| 2. Gin-only clinch (score=74, DW=1) | ✗ Holds | ✗ Holds (no clinch) | ✓ Knocks | Varies | Varies |
| 3. Low-stock (deck ≤ 8, DW=8) | ✗ Never knocks non-gin | ✓ Knocks | ✓ Knocks | ✓ Knocks | ✓ Knocks |
| 4. Early live hand (turn 2, DW=1) | ✗ Holds | ✗ Holds | ✓ Knocks | ✗ Holds (gin-live) | Varies |
| 5. Risky undercut zone (DW=8, mid-game) | ✗ Holds | ✗ Holds | ✓ Knocks | ✗ Holds | Varies |
| 6. Large score-gap hold | ✗ Holds | ✗ Holds | ✓ Knocks | Varies | Varies |
| All bots agree: gin | ✓ | ✓ | ✓ | ✓ | ✓ |
| All bots agree: DW > 10 | ✗ | ✗ | ✗ | ✗ | ✗ |

**Key observation: GoGin fails obvious scenarios** (clinch, low-stock) but still wins benchmarks against aggressive opponents. This does NOT mean those scenarios are unimportant — it means the benchmark field is exploitable. Against equally patient opponents, clinch and low-stock handling would matter. GoGin's H2H dominance is an exploitation artifact, not a strategic truth.

---

## 3. Screening Round-Robin 1 (seed 20260305, 40 games/matchup)

### Elo Ranking

| Rank | Player | Elo |
|------|--------|-----|
| **1** | **ApexMCTSClinchGoGin** | **1738.90** |
| 2 | ApexMCTS | 1585.62 |
| 3 | ApexMCTSKnock | 1585.21 |
| **4** | **ApexMCTSGoGin** | **1528.55** |
| 5 | Apex | 1518.86 |
| 6 | DeepKnock | 1427.14 |
| 7 | Nexus | 1354.63 |
| 8 | Heisenbot | 1261.08 |

### Critical H2H Snapshot (Screening 1)

| Matchup | Win Rate | 95% CI |
|---------|----------|--------|
| ApexMCTSKnock vs ApexMCTS | **68.75%** | [57.93%, 77.85%] |
| ApexMCTSKnock vs ApexMCTSGoGin | **47.50%** | [36.92%, 58.30%] |
| ApexMCTSKnock vs ApexMCTSClinchGoGin | **57.50%** | [46.57%, 67.74%] |
| ApexMCTSGoGin vs ApexMCTS | **71.25%** | [60.54%, 80.01%] |
| ApexMCTSClinchGoGin vs ApexMCTS | 52.50% | [41.70%, 63.08%] |
| ApexMCTSClinchGoGin vs ApexMCTSGoGin | **27.50%** | [18.92%, 38.14%] |

**First surprise: GoGin already beats ApexMCTS at a HIGHER rate (71.25%) than the learned model (68.75%).**
**Second surprise: GoGin dominates ClinchGoGin 72.50%. GoGin is the true patience king.**

---

## 4. Screening Round-Robin 2 (seed 20260315, 40 games/matchup)

### Elo Ranking

| Rank | Player | Elo |
|------|--------|-----|
| **1** | **ApexMCTSClinchGoGin** | **1661.67** |
| 2 | ApexMCTSKnock | 1614.84 |
| **3** | **ApexMCTSGoGin** | **1595.04** |
| 4 | ApexMCTS | 1555.04 |
| 5 | Apex | 1460.50 |
| 6 | DeepKnock | 1451.04 |
| 7 | Nexus | 1341.85 |
| 8 | Heisenbot | 1320.00 |

### Critical H2H Snapshot (Screening 2)

| Matchup | Win Rate | 95% CI |
|---------|----------|--------|
| ApexMCTSKnock vs ApexMCTS | **61.25%** | [50.29%, 71.18%] |
| ApexMCTSKnock vs ApexMCTSGoGin | **36.25%** | [26.57%, 47.19%] |
| ApexMCTSKnock vs ApexMCTSClinchGoGin | 46.25% | [35.75%, 57.10%] |
| ApexMCTSGoGin vs ApexMCTS | **62.50%** | [51.55%, 72.31%] |
| ApexMCTSClinchGoGin vs ApexMCTS | **62.50%** | [51.55%, 72.31%] |
| ApexMCTSClinchGoGin vs ApexMCTSGoGin | **27.50%** | [18.92%, 38.14%] |

**Confirmed across both seeds: GoGin crushes the learned model.**

Note: Elo rankings are misleading because they aggregate across all matchups including weaker bots. The H2H results are the ground truth.

---

## 5. Head-to-Head Probes (120 games = 240 seat-balanced)

### Ablation vs ApexMCTS

| Matchup | Seed | Win Rate | 95% CI | Undercuts |
|---------|------|----------|--------|-----------|
| GoGin vs ApexMCTS | 20260305 | **66.25%** | [60.05%, 71.93%] | 596:0 |
| GoGin vs ApexMCTS | 20260315 | **69.17%** | [63.06%, 74.67%] | 612:0 |
| ClinchGoGin vs ApexMCTS | 20260305 | **70.83%** | [64.79%, 76.22%] | 586:9 |
| ClinchGoGin vs ApexMCTS | 20260315 | **68.75%** | [62.63%, 74.28%] | 588:11 |

**Both simple ablations achieve 66–71% against ApexMCTS — matching or exceeding the learned model's 64.70%.**

### The Key Probe: Learned Model vs GoGin

| Matchup | Seed | Win Rate | 95% CI | Undercuts |
|---------|------|----------|--------|-----------|
| **ApexMCTSKnock vs GoGin** | 20260305 | **34.17%** | [28.46%, 40.37%] | 0:279 |
| **ApexMCTSKnock vs GoGin** | 20260315 | **34.17%** | [28.46%, 40.37%] | 0:281 |

**The learned model loses to the simplest ablation at 34.17% across both seeds (upper CI 40.37%).**

The undercut column tells the story: **GoGin accumulates 279–281 undercuts against the learned model, while the learned model gets zero.** The learned model occasionally knocks (DW 1–10 states where it has moderate confidence), and every single one of those knocks becomes an undercut opportunity for GoGin.

### Learned Model vs ClinchGoGin

| Matchup | Seed | Win Rate | 95% CI | Undercuts |
|---------|------|----------|--------|-----------|
| ApexMCTSKnock vs ClinchGoGin | 20260305 | **50.42%** | [44.13%, 56.69%] | 138:152 |
| ApexMCTSKnock vs ClinchGoGin | 20260315 | **49.58%** | [43.31%, 55.87%] | 155:148 |

**Dead even.** The learned model offers zero advantage over ClinchGoGin (gin + clinch + low-stock).

---

## 6. Knock-Frequency / Gin / Undercut Diagnostics

### Derived from H2H Matchup Statistics

| Bot | vs ApexMCTS Undercuts | vs ApexMCTS Gins (240 games) | Knock Behavior |
|-----|----------------------|------------------------------|----------------|
| GoGin | **596–612** : 0 | 127–139 : 78–82 | Never knocks non-gin. All wins from gin + undercuts. |
| ClinchGoGin | **586–588** : 9–11 | 130–134 : 67–72 | Rarely knocks non-gin. Clinch/low-stock adds ≤11 knocks. |
| ApexMCTSKnock (R55) | 182–208 : 0–2 (from screening) | 38–47 : 28–32 | Knocks occasionally (<5% of states). Still enough to bleed undercuts. |
| ApexMCTS | 24–35 : 18–25 (self vs Apex) | 12–19 : 15–19 | Knocks aggressively. Gets undercut constantly. |
| FirstKnock | n/a | n/a | Knocks every legal opportunity. Maximally aggressive. |

### The Mechanism Is Clear

1. **ApexMCTS knocks aggressively** (its heuristic says knock whenever DW ≤ 10 in most circumstances). Against a patient opponent, these knocks become undercuts at massive rates.

2. **GoGin never knocks non-gin.** This means:
   - It never exposes itself to undercuts
   - It accumulates 500–600 undercuts per 240 games from ApexMCTS's premature knocks
   - Its only offensive scoring is gin (25-point bonus)
   - Yet the undercut cascade alone is enough for a 66–69% win rate

3. **The learned model knocks ~4–5% of the time** in DW 1–10 states (per its confidence threshold). Against GoGin, every one of these knocks becomes an undercut because GoGin never has high deadwood (it never terminates non-gin hands). This bleeds enough points to lose 34% of the time.

4. **ClinchGoGin adds clinch + low-stock** to go-gin, which are objectively correct dominant actions. But these occasional non-gin knocks give GoGin undercut opportunities, so ClinchGoGin actually loses to GoGin at 27.50% in both screenings.

---

## 7. Score / Deck / Clinch Slice Diagnostics

### Score Interaction

| Diagnostic Slice | Evidence |
|-----------------|----------|
| **Clinch situations (score near 100)** | ClinchGoGin correctly handles these, but they're rare enough that GoGin's void-those-hands approach costs almost nothing |
| **Low-stock (deck ≤ 8)** | ClinchGoGin and GoGin both reach low-stock regularly; ClinchGoGin knocks while GoGin voids (6–8 void hands per 240 games — negligible cost) |
| **Gin-dominated scoring** | GoGin: 127–139 gins per 240 games; ClinchGoGin: 130–134. Gin production is essentially identical |
| **Undercut-dominated scoring** | GoGin: 596–612 undercuts per 240 games. This is the entire edge mechanism |

### Average Points/Game (vs ApexMCTS, H2H probes)

| Bot | Avg Points | Avg Opp Points | Differential |
|-----|-----------|----------------|-------------|
| GoGin | 95.58–96.13 | 69.12–69.27 | +26.31 to +27.02 |
| ClinchGoGin | 96.42–97.55 | 65.95–67.60 | +29.94 to +30.46 |

ClinchGoGin has a slightly higher differential against ApexMCTS, but this doesn't translate to superiority because it loses to GoGin head-to-head.

### The GoGin Anomaly Explained

Why does GoGin beat ClinchGoGin 72.50% despite missing obvious scenarios?

- **Against each other**, neither bot is aggressive. Both play patience.
- ClinchGoGin sometimes knocks in clinch/low-stock situations.
- Each of those knocks is an undercut opportunity for GoGin (ClinchGoGin: 0–1 undercuts vs GoGin: 93–98).
- GoGin exploits ClinchGoGin's rare knocks the same way both exploit ApexMCTS's frequent knocks.
- The takeaway: **in a patience-vs-patience game, the more patient player wins, because any knock at all is exploitable.**

---

## 8. Tests Run

### Required Test Suites

| Test Suite | Tests | Result | Time |
|------------|-------|--------|------|
| `test_apex.py` | 33 | PASS | 0.8s |
| `test_regressions.py` | 7 | PASS | 0.2s |
| `test_mcts.py` | 33 | PASS | 18.1s |
| `test_value_model.py` | 17 | PASS | 114.5s |
| `test_value_search.py` | 12 | PASS | 5.1s |
| `test_action_model.py` | 22 | PASS | 7.3s |
| `test_discard_model.py` | 25 | PASS | 7.0s |
| `test_knock_model.py` | 26 | PASS | 7.2s |
| **test_knock_ablation.py** | **24** | **PASS** | **3.9s** |
| **test_knock_scenarios.py** | **11 (1 skip)** | **PASS** | **<0.1s** |
| **Total** | **210** | **ALL PASS** | |

### Benchmarks Run

**Screening round-robins:**
```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSClinchGoGin,ApexMCTSGoGin,ApexMCTS,Apex,DeepKnock,Nexus,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSClinchGoGin,ApexMCTSGoGin,ApexMCTS,Apex,DeepKnock,Nexus,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress
```

**H2H probes (120 games = 240 seat-balanced):**
```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSGoGin,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSGoGin,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSClinchGoGin,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSClinchGoGin,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSGoGin --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSGoGin --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSClinchGoGin --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSClinchGoGin --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

---

## 9. Exact Files Changed

### Created (Phase 56)
- `gin_rummy/apex_mcts_gogin.py` — GoGin ablation bot
- `gin_rummy/apex_mcts_clinch_gogin.py` — ClinchGoGin ablation bot
- `gin_rummy/apex_mcts_firstknock.py` — FirstKnock ablation bot
- `gin_rummy/apex_mcts_paperknock.py` — PaperKnock ablation bot
- `test_knock_ablation.py` — 24-test ablation validation suite
- `test_knock_scenarios.py` — 11-test targeted scenario coverage
- `EXECUTION_REPORT_56.md` — This report

### Pre-existing (used unchanged)
- `gin_rummy/apex_mcts_knock.py` — Learned model bot (Phase 55 candidate)
- `gin_rummy/apex_mcts.py` — Base ApexMCTS engine
- `gin_rummy/apex.py` — Base Apex engine
- `benchmark.py` — Benchmark runner (all ablation bots already registered)

---

## 10. Promotion Decision

### Decision: **NO PROMOTION — learned model rejected, patience variant unresolved**

The learned knock model is **not** ship-worthy. The Phase 55 breakthrough was real, but it was not a learned-model effect:

| Question | Answer | Evidence |
|----------|--------|----------|
| Does the learned model beat ApexMCTS? | Yes, 61–69% | Confirmed (consistent with R55) |
| Does GoGin also beat ApexMCTS? | **Yes, 66–69%** | Two seeds, 240 games each, CIs above 60% |
| Does ClinchGoGin also beat ApexMCTS? | **Yes, 69–71%** | Two seeds, 240 games each, CIs above 62% |
| Does the learned model beat GoGin? | **No — loses 34.17%** | Two seeds, 240 games each, upper CI 40.37% |
| Does the learned model beat ClinchGoGin? | **No — dead even (~50%)** | Two seeds, CIs bracket 50% |
| Does the learned model add value beyond patience? | **No** | It performs worse than pure patience |

### The Honest Finding

Report 55's breakthrough was **option (b) from the directive's framework**: "mostly a simpler knock-ablation effect like go gin / rarely knock."

The learned model trained on MC-labeled data and converged to a policy that says "almost never knock." This is the same behavior as GoGin, but worse, because the model occasionally decides to knock (P(knock) > 0.5 in ~4–5% of DW 1–10 states), and every one of those decisions becomes an exploitable undercut opportunity against a patient opponent.

### Why No Promotion

GoGin wins the H2H benchmarks, but it misses unconditionally correct dominant actions:
- **Score clinch** (score=99, DW=9): knocking wins the game. GoGin holds for gin. This is wrong.
- **Low stock** (deck ≤ 8): knocking avoids a void hand. GoGin voids. This is wrong.

GoGin's benchmark dominance comes from exploiting aggressive opponents, not from correct play. Every benchmark tested against ApexMCTS (aggressive knocker) or ClinchGoGin (which occasionally knocks correctly and gets punished for it). This evaluation methodology cannot determine the right patience variant — it only proves that maximum exploitation wins against exploitable opponents.

The correct evaluation requires testing against equally strong, equally patient opponents. That was not completed in Phase 56.

---

## 11. Rejected Variants and Why

| Variant | Why Rejected |
|---------|-------------|
| `ApexMCTSKnock` (learned model) | Loses to GoGin 34.17%. Even with correct general trend (patience), the occasional model-confidence knocks bleed undercuts. |
| `ApexMCTSClinchGoGin` (gin + clinch + low-stock) | Loses to GoGin 27.50%. Clinch and low-stock knocks are individually correct dominant actions, but in practice they hand undercut opportunities to more patient opponents. |
| `ApexMCTSPaperKnock` (paper heuristics) | Too aggressive. Knocks in multiple DW/turn scenarios that bleed undercuts. |
| `ApexMCTSFirstKnock` (always knock) | Extreme aggression. Useful as ablation endpoint but obviously not competitive. |
| Using the learned model with raised threshold | Not tested, but the GoGin result shows the optimal threshold is P(knock) → ∞ (never knock non-gin). |

---

## 12. Unresolved Risks

1. **GoGin's dominance is opponent-dependent.** GoGin crushes *aggressive knockers* via the undercut mechanic. In a field of GoGin-vs-GoGin, all games end by gin or void — the undercut weapon disappears. If the meta shifts to patience, GoGin's edge dissolves. However, this is the correct dominant strategy until opponents also adopt patience.

2. **Void hands.** GoGin produces 6–8 void hands per 240 games (vs 0–4 for other bots). Each void hand is a wasted deal. This is a small cost but real.

3. **Score clinch edge cases.** GoGin will never take a non-gin knock to clinch the game (e.g., score=99, DW=1). In these rare situations, ClinchGoGin is objectively better. But the empirical data shows this doesn't matter at sample size.

4. **ClinchGoGin may be safer for production.** Despite losing to GoGin H2H (because GoGin exploits *its* specific rare knocks), ClinchGoGin handles more edge cases correctly. In a diverse opponent field, ClinchGoGin might be more robust. The two also perform nearly identically against ApexMCTS (66–71% range overlap).

---

## 13. Recommended Next Step

**Phase 57 must resolve the patience variant question** with a proper evaluation methodology:

1. **Test against patient opponents, not exploitable ones.** GoGin vs ClinchGoGin H2H is misleading because GoGin exploits ClinchGoGin's correct-but-rare knocks. The right test is against a field of equally patient bots, or self-play analysis.
2. **Identify which dominant-action exceptions are worth their undercut cost.** Score-clinch is unconditionally correct (it wins the game). Low-stock may or may not be (it avoids voids but creates undercut exposure). These should be evaluated individually.
3. **Consider whether the optimal policy is opponent-dependent.** Against aggressive knockers, maximum patience wins. Against patient opponents, dominant-action handling matters. The production champion may need to condition on opponent behavior.

The learned knock model should not be promoted, but the Phase 55 data infrastructure (MC-labeled knock features, offline evaluation pipeline) retains value for future work.

The honest answer from Phase 56: **patience is the mechanism, not learning. But the right patience policy is not yet determined.**
