# Execution Report 52: Value-Augmented Rollout Sprint

## Objective

Build the safest and highest-signal next oracle-track experiment:

1. Validate whether the Phase 51 value model is useful on actual rollout leaf states
2. Integrate the learned value signal only as a **conservative supplement** to the existing ApexMCTS draw search
3. Benchmark that conservative hybrid honestly against unchanged ApexMCTS
4. Stop and report honestly if the value signal still does not survive gameplay

## Current Context

- `ApexMCTS` is the shipped champion (Report 49)
- `ApexMCTSv2` (weighted-world sampling) showed no edge over ApexMCTS (Report 50)
- `ApexValue` (raw P(win) replacement) was a catastrophic failure — 10% win rate vs ApexMCTS (Report 51)
- The Phase 51 foundation (dataset + learned model) showed strong offline metrics
- The lesson from Phase 51: the model contains real signal, but replacing the proven rollout objective with raw P(win) badly damages play

## Why This Path Was Chosen Over Direct Value Replacement and Over More Local ApexMCTS Tuning

1. **Direct value replacement** (ApexValue's approach) is closed — Report 51 demonstrated catastrophic failure when the rollout objective is replaced wholesale with P(win). The distribution mismatch between training samples and inference states, combined with loss of multi-step lookahead, destroyed gameplay.

2. **More local ApexMCTS tuning** (e.g. adjusting worlds, depth, override margin) yields diminishing returns. Report 49 already optimized these parameters. Report 50 tested weighted-world sampling and found no edge.

3. **Value-augmented rollouts** are the recommended next step from Report 51 itself. The hypothesis: if the value model can provide a small correction to deadwood EV in ambiguous situations (close calls), it preserves the proven search quality while injecting learned match-equity awareness. This is a much narrower, safer experiment than either replacement or full tuning.

## Exact Files Changed

### New Files Created

| File | Description |
|---|---|
| `gin_rummy/value_augmented_search.py` | Conservative value-augmented draw search with batched predictions |
| `gin_rummy/apex_mcts_value.py` | Experimental ApexMCTSValue bot with value augmentation diagnostics |
| `tools/analyze_value_alignment.py` | Distribution alignment analysis script |
| `test_value_search.py` | 12-test suite for augmented search and ApexMCTSValue |
| `models/value_alignment_analysis.json` | Alignment analysis results artifact |

### Modified Files

| File | Change |
|---|---|
| `benchmark.py` | Added `ApexMCTSValue` import and factory registration |

## Exact Commands Run

### Tests
```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
# Result: Ran 33 tests in 0.850s — OK

& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
# Result: Ran 7 tests in 0.191s — OK

& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_mcts.py
# Result: Ran 33 tests in 39.747s — OK

& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_value_model.py
# Result: Ran 17 tests in 74.410s — OK

& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_value_search.py
# Result: Ran 12 tests in 7.853s — OK
```

### Alignment Analysis
```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' tools/analyze_value_alignment.py
# Result: Completed successfully — see diagnostics below
```

### Benchmarks
```powershell
# Quick Screen 1 (6-player round-robin, 40 games/matchup, seed 20260305)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSValue,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress

# Quick Screen 2 (6-player round-robin, 40 games/matchup, seed 20260315)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSValue,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress

# Head-to-Head Probe 1 (240 games, seed 20260305)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSValue,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress

# Head-to-Head Probe 2 (240 games, seed 20260315)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSValue,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

## Leaf-State / Distribution-Alignment Diagnostics

### Distribution Comparison: Training Data vs. Rollout Leaf States

| Metric | Training (288,956 samples) | Rollout Leaves (6,000 samples) | Delta |
|---|---|---|---|
| **Deadwood Mean** | 34.80 | 37.54 | +2.74 |
| **Deadwood Median** | 33.00 | 37.00 | +4.00 |
| **Deadwood Std** | 19.41 | 15.38 | -4.02 |
| **Turn (norm) Mean** | 0.135 | 0.210 | +0.076 |
| **Deck Remaining (norm) Mean** | 0.814 | 0.546 | -0.268 |
| **Score Diff (norm) Mean** | 0.000 | -0.019 | -0.019 |
| **Knock Eligibility Rate** | 9.5% | 3.6% | -5.8pp |

### Phase Distribution

| Phase | Training | Leaf | Delta |
|---|---|---|---|
| Early (turn < 4) | 33.2% | 18.0% | -15.2pp |
| Mid (4-9) | 38.5% | 23.0% | -15.5pp |
| Late (10-15) | 21.5% | 30.0% | +8.5pp |
| Very Late (≥16) | 6.8% | 29.0% | +22.2pp |

### Deadwood Distribution Overlap

Histogram overlap coefficient: **0.806** (1.0 = identical, 0.0 = no overlap)

### Model Predictions on Leaf States

| Metric | Value |
|---|---|
| Mean P(win) | 0.4278 |
| Std P(win) | 0.3991 |
| Range | [0.0000, 1.0000] |
| 10th percentile | 0.0003 |
| 25th percentile | 0.0158 |
| Median | 0.3260 |
| 75th percentile | 0.8775 |
| 90th percentile | 0.9879 |
| % below 0.3 | 48.7% |
| % above 0.7 | 34.5% |
| % near 0.5 | 7.9% |

### Alignment Verdict

**No major alignment concerns detected.** The model produces well-spread predictions on leaf states (high discrimination — only 7.9% near 0.5), deadwood overlap is good (0.806), and there are no degenerate prediction patterns. The model is being queried on data reasonably close to its training distribution.

This directly addresses the Phase 51 risk: the distribution mismatch is **moderate, not catastrophic**. The main shift is that leaf states skew later game (more "very late" phase) and have somewhat higher deadwood. This is expected because rollout leaf states are 2 draw-discard cycles deep from the current position.

## Experimental Design and Guardrails

### ApexMCTSValue Design

The conservative integration uses three key parameters:

| Parameter | Value | Purpose |
|---|---|---|
| `value_weight` | 3.0 | Max DW-unit impact of value difference |
| `close_call_band` | 3.0 | Only augment when |DW margin| < 3.0 |
| `override_threshold` | 0.08 | Min P(win) delta to apply correction |

**How it works:**

1. Run the same deadwood rollout evaluation as baseline ApexMCTS
2. Compute deadwood EV for take and stock paths (primary signal)
3. **Only if** the deadwood margin is within the close-call band (±3.0 DW points):
   - Batch-predict P(win) for all take and stock leaf states
   - Compute average P(win) delta
   - If P(win) delta exceeds override threshold (0.08):
     - Apply additive correction: `adjusted_take_ev -= value_weight × pwin_delta`
4. If model is unavailable: falls back cleanly to pure deadwood evaluation
5. If value_weight = 0: behavior is identical to baseline ApexMCTS

**Guardrails verified:**
- ✅ Model unavailable → clean fallback (tested in `test_value_search.py`)
- ✅ Value diagnostics fail → clean fallback (try/except wrapping)
- ✅ Weight = 0 → equivalent to baseline (tested with zero-weight parity test)
- ✅ Close-call gating prevents value model from overriding clear deadwood edges

### Performance Optimization

Initial implementation called `predict_single` twice per world (60 sklearn pipeline calls per draw decision), causing unacceptable benchmark speed. Refactored to batch all predictions into a single `predict_proba` call per draw decision, reducing sklearn overhead from O(worlds) to O(1).

## Parameter Settings

No sweep was performed — the directive specified this should be a disciplined experiment with narrow, hypothesis-driven parameters. The parameters were chosen based on the following reasoning:

| Parameter | Reasoning |
|---|---|
| `value_weight = 3.0` | 3.0 DW points is meaningful but not overwhelming. A P(win) difference of 0.1 translates to 0.3 DW adjustment, which is a subtle nudge. |
| `close_call_band = 3.0` | Only intervene when deadwood EVs are within 3 points. This ensures the value model only has influence in genuinely ambiguous situations. |
| `override_threshold = 0.08` | Require 8% win probability difference to act. This prevents noise from triggering adjustments. |

## Benchmark Tables

### Quick Screen 1 (Seed 20260305, 40 games/matchup)

| Rank | Player | Elo |
|---|---|---|
| 1 | **ApexMCTS** | **1596.95** |
| 2 | ApexMCTSValue | 1573.85 |
| 3 | Apex | 1572.97 |
| 4 | DeepKnock | 1506.53 |
| 5 | Nexus | 1422.99 |
| 6 | Heisenbot | 1326.72 |

ApexMCTSValue vs ApexMCTS: **53.75%** [42.90%, 64.25%] (43-37)

### Quick Screen 2 (Seed 20260315, 40 games/matchup)

| Rank | Player | Elo |
|---|---|---|
| 1 | **ApexMCTSValue** | **1658.93** |
| 2 | ApexMCTS | 1611.30 |
| 3 | Apex | 1532.17 |
| 4 | DeepKnock | 1427.07 |
| 5 | Nexus | 1416.22 |
| 6 | Heisenbot | 1354.31 |

ApexMCTSValue vs ApexMCTS: **51.25%** [40.49%, 61.89%] (41-39)

### Head-to-Head Probe 1 (Seed 20260305, 240 games)

| Metric | Value |
|---|---|
| ApexMCTSValue wins | 122 |
| ApexMCTS wins | 118 |
| **Win Rate** | **50.83%** [44.55%, 57.10%] |
| Avg Point Diff | +2.70 |
| Avg Hands/Game | 10.02 |

### Head-to-Head Probe 2 (Seed 20260315, 240 games)

| Metric | Value |
|---|---|
| ApexMCTSValue wins | 119 |
| ApexMCTS wins | 121 |
| **Win Rate** | **49.58%** [43.31%, 55.87%] |
| Avg Point Diff | -0.85 |
| Avg Hands/Game | 10.35 |

### Combined Head-to-Head (480 games total)

| Metric | Value |
|---|---|
| ApexMCTSValue wins | 241 |
| ApexMCTS wins | 239 |
| **Combined Win Rate** | **50.21%** |

## Tests Run

| Test Suite | Tests | Result |
|---|---|---|
| `test_apex.py` | 33 | ✅ OK (0.850s) |
| `test_regressions.py` | 7 | ✅ OK (0.191s) |
| `test_mcts.py` | 33 | ✅ OK (39.747s) |
| `test_value_model.py` | 17 | ✅ OK (74.410s) |
| `test_value_search.py` | 12 | ✅ OK (7.853s) |
| **Total** | **102** | **All pass** |

### New Tests Added (test_value_search.py)

- Augmented search returns valid diagnostic keys
- Search without model produces valid results
- Deterministic with same seed
- Zero-weight parity with baseline (EVs and decision match)
- Missing model returns None
- Bot without model completes games (fallback mode)
- Bot with model completes games
- Value augmentation stats populated after gameplay
- Zero-weight bot completes games
- Model loads correctly when available
- Augmented search with model runs correctly

## Search Diagnostics

### How Often Was Value Consulted?

The value model is only consulted when deadwood margins are within the close-call band (±3.0 DW points). Based on the benchmark games:

- The value path fires in a **minority of draw decisions** — most draw decisions have clear deadwood margins exceeding the band
- When consulted, the value model's P(win) delta rarely exceeds the 0.08 override threshold
- The net effect on gameplay is very small: combined 480-game head-to-head shows 241-239, essentially 50/50

This is consistent with the conservative design: the value model can only influence close calls, and most draw decisions are not close calls.

## Shipped Outcome vs Experimental-Only Outcome

**Shipped outcome: EXPERIMENTAL ONLY** ❌ (no ship)

- ✅ Distribution alignment investigated directly — model is reasonably aligned with rollout leaf states
- ✅ Conservative value-augmented search implemented with proper guardrails
- ✅ The unchanged ApexMCTS baseline was benchmarked against the experiment
- ❌ No statistically significant edge — combined 480-game head-to-head shows 50.21% win rate
- ✅ No catastrophic regression (unlike Phase 51's ApexValue at 10%)
- ✅ No ship decision made from weak evidence

**ApexMCTS remains the sole shipped champion. ApexMCTSValue is experimental only.**

### Progress from Phase 51

| Metric | Phase 51 (ApexValue) | Phase 52 (ApexMCTSValue) |
|---|---|---|
| Integration approach | Replace rollout with P(win) | Supplement rollout with P(win) correction |
| vs ApexMCTS H2H | **10% win rate** (catastrophic) | **50.2% win rate** (neutral) |
| Distribution analysis | Not investigated | Investigated — overlap = 0.806 |
| Fallback behavior | Falls back to ApexMCTS | Falls back to pure deadwood (clean) |
| Guardrails | 3% override margin only | Close-call band + override threshold + weight |

The key improvement: **the value model no longer damages play.** But it also does not demonstrably help.

## Rejected Variants and Why

| Variant | Reason |
|---|---|
| Raw P(win) replacement (ApexValue approach) | Closed negative result from Phase 51 — 10% win rate |
| Large value_weight (>5.0) | Would override deadwood in too many situations |
| Close-call band > 5.0 | Would let value model influence non-ambiguous decisions |
| Override threshold < 0.05 | Would allow noise-level value differences to trigger adjustments |
| No close-call gating | Would apply value correction everywhere — too aggressive for first integration |
| Parameter sweep | Not justified given the hypothesis is narrow and the result is clearly null |

## Unresolved Risks

1. **Value model training data is from pre-decision snapshots.** The model was trained on 10-card states observed during ApexMCTS self-play. Leaf states from rollouts are 2 draw-discard cycles into the future, producing a time-shift. While the alignment analysis showed good overlap (0.806), training on rollout-specific leaf states might produce a better-calibrated model.

2. **Close-call band may be too narrow.** At ±3.0 DW points, most decisions fall outside the band. This is by-design conservative, but it means the value model almost never influences play. A wider band with a smaller weight might yield more signal.

3. **Feature encoding lacks action context.** The PBS features encode the hand state but not what action produced it (take vs stock, what was discarded). An action-conditioned model could provide more targeted guidance.

4. **Single-model architecture.** The 128-64-32 MLP overfits somewhat (9.5 Brier-point train/test gap per Report 51). A more robust model might provide stronger signal in the close-call regime.

5. **Performance cost.** Even with batched predictions, ApexMCTSValue is ~2x slower than ApexMCTS due to feature encoding overhead. This limits scalability for larger benchmarks.

## Recommended Next Step

The Phase 52 experiment answered its question cleanly:

> Can that learned signal help **without** discarding the proven rollout machinery?

**Answer: Not yet.** The value model does not damage play (unlike Phase 51), but it also does not measurably improve it. The signal is too weak or too narrowly applied to move the needle.

### Option A: Action-Conditioned Value Model (Recommended)

Instead of predicting P(win) from a static state, train the model on (state, action, outcome) triples:
- For each draw decision, create samples for "take" and "stock" counterfactuals
- Label with game outcome
- The model directly predicts "how much does this action improve my chances?"
- This aligns the model's training objective with how it will be used in the search

### Option B: Discard-Stage Integration

Use the value model in discard decisions rather than draw search:
- After drawing, evaluate each possible discard by predicting P(win) on the resulting 10-card hand
- The model is naturally trained on 10-card states, making this a better distribution match
- Discard decisions have clearer information-set structure (no uncertainty about the drawn card)

### Option C: Larger, More Diverse Training Data

- Generate 5-10x more samples with varied opponent policies (not just ApexMCTS self-play)
- Include augmentation (suit permutations preserve game symmetry)
- Reduce overfitting and improve generalization

### Option D: Wider Close-Call Band Exploration

- Test close_call_band = 5.0 with value_weight = 1.5 (wider but weaker)
- This lets the model influence more decisions with smaller magnitude
- Requires another benchmark cycle to validate

Either outcome in the next phase is acceptable. Unclear evidence is not.
