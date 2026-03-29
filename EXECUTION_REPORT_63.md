# Execution Report 63: Rare-Spot Disagreement Mapping Sprint

## TL;DR

The `fragmented_dw_low_stock` disagreement from Phases 61–62 is **not rare**.
It is an instance of a much broader, **systematic** disagreement between the
champion and the improved solver.  The champion currently makes the wrong
knock/continue decision in **~64% of natural-frequency low-stock legal-knock
states**, with a mean conditional EV loss of **~12.8 points**.

Classification: **common and meaningful**.

A future production override — or narrower targeted experiment — is justified.

---

## 1. What Corpus Was Built

### Mining pipeline

Three complementary mining paths were implemented in `disagreement_miner.py`:

| Path | Label | Games | Spots | Purpose |
|------|-------|------:|------:|---------|
| Champion self-play | `natural` | 100 | 417 | Natural-frequency baseline |
| Alternate-policy self-play (GoGin variants) | `oversampled` | 60 | 250 | DW 5–10 coverage enrichment |
| Synthetic perturbation of low-DW naturals | `synthetic` | — | 328 | Fill DW 5–10 gap mechanically |

**Total:** 995 spots evaluated by the Phase 62 improved solver.

### Mining specifics

- **Natural miner:** `ApexMCTSClinchOnlyGoGin` vs itself, 100 games.
  Captures every position where `stock ≤ 6` and `DW ≤ 10` (legal knock).
- **Oversampled miner:** GoGin vs ClinchOnly and GoGin vs GoGin, 60 games.
  These policies pass on knocks more often, leading to different low-stock states.
- **Synthetic miner:** Takes natural spots with DW ≤ 4, swaps a melded card
  with a higher-DW available card to push DW into the 5–10 range. Only uses
  cards not in hand or discard pile.

## 2. How Natural vs Oversampled vs Synthetic Were Separated

Every `DisagreementSpot` carries a `corpus_type` label (`natural`, `oversampled`,
or `synthetic`).  This label is:

- set at mining time — not retroactively
- preserved through solver evaluation, clustering, and reporting
- **never blended** in frequency estimation (only `natural` is used)

The analysis code enforces this separation:
- `estimate_frequency_and_cost()` only accepts natural-corpus spots
- cluster analysis is run three times, once per corpus type
- the report tables clearly label each section

## 3. What Disagreement Classes Were Found

### 3.1 Natural-Frequency Findings

| Metric | Value |
|--------|------:|
| Total low-stock legal-knock spots | 417 |
| Disagreements | 266 |
| **Disagreement rate** | **63.8%** |
| Mean conditional EV loss | 12.84 pts |
| Mean conditional ME loss | 0.0868 |
| Aggregate EV cost per spot | 8.19 pts |
| **Classification** | **common_meaningful** |

### 3.2 DW Region Breakdown (Natural)

| DW Region | Total | Disagree | Rate |
|-----------|------:|---------:|-----:|
| DW 0–4 | 329 | 186 | 56.5% |
| **DW 5–10** | **88** | **80** | **90.9%** |

The Phase 62 suspicion is confirmed and dramatically exceeded: the DW 5–10
region has a **91% disagreement rate** — the champion is almost always wrong
in this zone.

But the disagreement is **not** confined to DW 5–10.  Even in the DW 0–4
region, the disagreement rate is 56.5%.  This is a broad-spectrum issue.

### 3.3 Cluster Structure

The following are the **largest natural-frequency disagreement clusters**,
sorted by size:

| Cluster | n | Mean EV Diff | Mean ME Diff | Interpretation |
|---------|--:|:--------:|:--------:|------|
| stock_5_6 / dw_0_2 / gin_live / early | 38 | +12.8 | +0.076 | Champion waits for gin when it should knock |
| stock_5_6 / dw_0_2 / gin_live / mid | 30 | +12.1 | +0.088 | Same pattern, mid-game |
| stock_5_6 / dw_3_5 / fragmented / mid | 23 | +12.3 | +0.074 | Fragmented medium-DW, champion continues |
| stock_5_6 / dw_3_5 / fragmented / early | 18 | +10.8 | +0.052 | Same, early game |
| stock_5_6 / dw_0_2 / gin_live / late | 16 | +8.7 | +0.094 | Gin-live hands, late game |
| stock_5_6 / dw_6_8 / fragmented / early | 12 | +15.4 | +0.064 | Phase 62's target class |
| stock_5_6 / dw_0_2 / concentrated / early | 11 | +14.4 | +0.068 | Concentrated low-DW |
| stock_5_6 / dw_0_2 / concentrated / mid | 10 | +10.5 | +0.053 | Same, mid-game |
| stock_5_6 / dw_6_8 / fragmented / mid | 8 | +11.4 | +0.077 | Fragmented DW 6–8 |
| stock_5_6 / dw_6_8 / fragmented / late | 8 | +15.5 | +0.240 | High ME diff — late game amplifies |
| stock_5_6 / dw_3_5 / fragmented / late | 8 | +12.0 | +0.145 | Late-game fragmented |

**Key finding:** The disagreement is **not** one coherent class.
It spans at least three structural families:

1. **Gin-live / low-DW / stock 5–6:** The champion continues hoping for gin
   when the solver says knock.  This is the largest cluster (84+ spots natural).
2. **Fragmented / medium-DW / stock 5–6:** The Phase 62 target class.
   Present and confirmed, though not the most common.
3. **Concentrated / low-DW / various:** Even with 1–2 DW cards, the champion
   continues when the solver recommends knocking.

### 3.4 Oversampled Findings (Coverage Check)

The oversampled corpus (250 spots) shows a **62.8% disagreement rate** with
mean EV diff 13.09 — nearly identical to natural.  This validates that the
disagreement is not an artifact of the champion's specific play style; it
persists across alternate policy pairings.

### 3.5 Synthetic Findings (DW 5–10 Enrichment)

The synthetic corpus (328 spots) shows a **79.3% disagreement rate** with
mean EV diff 13.81.  This is higher than natural because synthetics are
biased toward the DW 5–10 region where disagreement is strongest.

## 4. How Often Disagreement Spots Occur

### Natural frequency estimation

From 100 champion self-play games:

- 417 low-stock (stock ≤ 6) legal-knock (DW ≤ 10) positions observed
- **~4.2 qualifying positions per game on average**
- Of these, 266 are disagreements → **~2.7 champion errors per game**

These positions cluster in the late-stock region (stock 5–6 dominates).
The mandatory knock at stock ≤ 2 means most stock_1_2 positions are forced
and less interesting for disagreement.

### DW 5–10 frequency

- 88 of 417 natural spots (21%) fall in DW 5–10
- These have a 91% disagreement rate
- So DW 5–10 disagreements are ~19% of all qualifying spots (80/417)

The DW 5–10 region is naturally rarer (the champion tends to meld well by
late stock), but when it does arise, the champion is almost always wrong.

## 5. How Costly The Disagreements Appear To Be

### Conditional severity

| Corpus | Mean EV Loss (conditional) | Mean ME Loss (conditional) |
|--------|:--------:|:--------:|
| Natural | 12.84 pts | 0.0868 |
| Oversampled | 13.09 pts | 0.0866 |
| Synthetic | 13.81 pts | 0.0820 |

A 12.8-point EV loss per disagreement is substantial — comparable to the
difference between an undercut and a normal knock.

### Aggregate cost

- **Disagreement rate:** 63.8%
- **Mean conditional EV loss:** 12.84 pts
- **Aggregate EV cost per qualifying spot:** 8.19 pts

This is not negligible.  Over the ~4.2 qualifying spots per game, the
champion is losing an estimated **~34 EV points per game** to knock timing
errors in low-stock positions.

### Classification

**Common and meaningful.**

- Rate > 5% threshold → common
- Severity > 5.0 pts threshold → large
- Both → common_meaningful

## 6. Whether a Future Production Override Is Justified

**Yes.** The data strongly supports pursuing a production override.

The disagreement is:
- ✅ Structurally coherent (solver consistently says "knock" when champion says "continue")
- ✅ Broad rather than narrow (spans DW 0–10, multiple textures)
- ✅ Common (63.8% of qualifying positions)
- ✅ Costly (~12.8 pts per disagreement)
- ✅ Stable across corpus types (natural ≈ oversampled rates)

### Critical caveat: solver-stability uncertainty

The Phase 62 solver uses 150–300 worlds for continuation evaluation.
The directional finding (solver prefers knock) is stable, but the exact
magnitude of EV differences may be approximate.  The solver is known to
have a systematic knock-preference in low-stock positions, which could
partially inflate disagreement counts.

**Recommendation:** Before shipping a production override, run a **direct
duplicate benchmark** of a knock-biased variant (e.g., "always knock when
stock ≤ 6 and DW ≤ 10") against the current champion.  The benchmark is
the ground truth; the solver analysis is the justification for running it.

## 7. Best Next Step For The Oracle Roadmap

### Recommended: Phase 64 — Narrow Benchmark Probe

1. **Create a minimal knock-override variant:** When `stock ≤ 6` and
   `DW ≤ 10`, always knock.  This is the maximally simple test of the
   solver's recommendation.

2. **Run a direct duplicate benchmark** (e.g., 2000 matches) against
   `ApexMCTSClinchOnlyGoGin`.

3. **If the override wins:** This validates the solver and justifies a
   production promotion.  Subsequent work can refine the threshold
   (possibly exempting DW 0 gin-live hands where gin would score more).

4. **If the override loses:** The solver's knock preference may be an
   artifact of world-generation or continuation-evaluation limitations.
   This would redirect research toward improving the solver rather than
   changing the bot.

### Do not do

- Do not ship the override without the benchmark
- Do not build complex multi-threshold heuristics yet
- Do not revert to hand-tuned knock rules

---

## Solver Stability Notes

### What is solver-stable

- The **direction** of disagreement: solver consistently prefers knock
- The **breadth** of the disagreement: spans all DW buckets, all textures
- The **consistency** across corpus types: natural ≈ oversampled

### What remains approximate

- **Exact EV magnitudes:** dependent on world count and continuation depth
- **Belief-mode sensitivity:** only champion-continuation mode was used
  (the "optimistic" mode would likely show similar direction but different
  magnitudes)
- **Score-context interactions:** late-game ME amplification is large
  (0.24 ME diff in some clusters) but these are small-sample clusters

---

## Test Results

All 36 tests pass:

- `TestHandTextureClassification` — 4 tests
- `TestDisagreementSpotValidation` — 5 tests
- `TestCorpusLabeling` — 3 tests
- `TestMinerValidity` — 6 tests
- `TestSyntheticPerturbation` — 3 tests
- `TestClusteringCorrectness` — 4 tests
- `TestFrequencyEstimation` — 7 tests
- `TestAnalysisOutputShape` — 2 tests
- `TestCorpusSummary` — 2 tests

---

## Deliverables Checklist

| Deliverable | Status | File |
|------------|--------|------|
| Targeted disagreement miner | ✅ | `gin_rummy/disagreement_miner.py` |
| Expanded rare-spot corpus | ✅ | 995 spots across 3 corpus types |
| Disagreement analysis report | ✅ | This document + `phase63_results.json` |
| Recommendation on production test | ✅ | Yes — justified (see §6) |
| Execution report | ✅ | This document |
| Tests | ✅ | `tests/test_disagreement_miner.py` (36 tests, all pass) |

---

## Files Created / Modified

| File | Action |
|------|--------|
| `gin_rummy/disagreement_miner.py` | Created — targeted miner with 3 mining paths |
| `gin_rummy/disagreement_analysis.py` | Created — solver runner, clustering, frequency estimation |
| `gin_rummy/run_phase63_analysis.py` | Created — full analysis runner |
| `gin_rummy/run_phase63_light.py` | Created — lightweight runner (used for this report) |
| `tests/test_disagreement_miner.py` | Created — 36 tests covering all components |
| `phase63_results.json` | Created — raw analysis results |
| `EXECUTION_REPORT_63.md` | Created — this report |
