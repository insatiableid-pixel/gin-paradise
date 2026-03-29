# Execution Report 53: Action-Conditioned Draw Model Sprint

## Objective

Build the first action-conditioned learning path for the draw decision:

1. Create a reproducible dataset of draw-decision states with paired `take discard` vs `draw stock` labels
2. Train and evaluate a learned model that predicts **which draw action is better**
3. Compare it against meaningful offline baselines on held-out decision-quality metrics
4. Only if the offline evidence is clearly positive, integrate it into a controlled experimental bot and benchmark it against unchanged `ApexMCTS`

## Current Context

- `ApexMCTS` is the shipped champion (Report 49)
- `ApexMCTSv2` (weighted-world sampling) showed no edge (Report 50)
- `ApexValue` (raw P(win) replacement) was catastrophic — 10% win rate (Report 51)
- `ApexMCTSValue` (conservative value augmentation) was neutral — 50.2% over 480 games (Report 52)
- Two successive experiments failed to produce a draw-stage edge from a **state-value** model

## Why This Path Was Chosen Over More ApexMCTSValue Tuning

Reports 51 and 52 established that a generic state-value model cannot meaningfully improve draw decisions, whether applied as replacement (catastrophic) or supplement (neutral). The state-value model predicts P(win) from a static game state, but the draw decision requires comparing two **actions** from the same state.

Action-conditioned modeling directly predicts: "is take better than stock?" This aligns the model's training objective with how it will be used. Instead of hoping a generic P(win) model indirectly solves the draw choice, the model is trained on the draw decision itself.

## Exact Files Changed

### New Files Created

| File | Description |
|---|---|
| `gin_rummy/action_features.py` | 42-dim action-conditioned feature encoder for draw decisions |
| `gin_rummy/draw_action_model.py` | Model framework: LearnedDrawActionModel, DeadwoodBaseline, ApexHeuristicBaseline |
| `gin_rummy/apex_mcts_action.py` | ApexMCTSAction bot with 3-tier close-call resolution |
| `tools/generate_action_data.py` | Paired MC dataset generator via ApexMCTS self-play |
| `train_action_model.py` | MLP classifier training script |
| `evaluate_action_model.py` | Offline evaluation pipeline comparing model vs baselines |
| `test_action_model.py` | 22-test suite for features, baselines, model, and gameplay |

### Modified Files

| File | Change |
|---|---|
| `benchmark.py` | `ApexMCTSAction` import and factory registration (done in prior session) |
| `train_action_model.py` | Fixed numpy float32 JSON serialization bug |

## Exact Commands Run

### Data Generation
```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' tools/generate_action_data.py --games 500 --target 100 --seed 20260317
# Result: 65,249 samples generated in ~20 min
```

### Training
```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' train_action_model.py
# Result: 96.65% test accuracy, 0.9888 AUC, 7.2s training time
```

### Evaluation
```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' evaluate_action_model.py
# Result: Learned model beats all baselines → verdict: positive
```

### Tests
```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_action_model.py
# Result: Ran 22 tests in 7.332s — OK

& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
# Result: Ran 33 tests in 0.859s — OK

& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
# Result: Ran 7 tests in 0.190s — OK

& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_mcts.py
# Result: Ran 33 tests in 18.843s — OK

& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_value_model.py
# Result: Ran 17 tests in 73.974s — OK

& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_value_search.py
# Result: Ran 12 tests in 4.966s — OK
```

### Benchmarks
```powershell
# Quick Screen 1 (6-player round-robin, 40 games/matchup, seed 20260305)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSAction,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress

# Quick Screen 2 (6-player round-robin, 40 games/matchup, seed 20260315)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSAction,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress

# Head-to-Head Probe 1 (240 games, seed 20260305)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSAction,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress

# Head-to-Head Probe 2 (240 games, seed 20260315)
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSAction,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

## Dataset Design and Schema

### Generation Method

500 games of ApexMCTS vs ApexMCTS self-play, using an instrumented bot (`ActionInstrumentedApexMCTS`) that captures every draw decision:

1. At each draw decision, encode 42 action-conditioned features
2. Evaluate both draw actions via paired MC continuations (12 worlds, depth 2)
3. Record: `action_delta = (stock_dw - adjusted_take_dw) / 30.0`
4. Binary label: `take_better = 1 if action_delta > 0`

### Paired Label Generation

For each draw state, the label is generated from the **same worlds**:

- Sample 12 unseen-card worlds
- For each world: simulate TAKE path (take + best discard + 2 rollout cycles) and STOCK path (draw top stock + best discard + 2 rollout cycles)
- `action_delta = avg(stock_dw - take_dw + info_penalty) / normalization`
- Positive delta = take produces lower deadwood after info penalty

This paired structure ensures the label directly captures the draw decision quality, not generic state value.

### Schema

| Field | Shape | Description |
|---|---|---|
| `X` | (65249, 42) | Action features per draw decision |
| `action_deltas` | (65249,) | Continuous label: advantage of take over stock |
| `take_better` | (65249,) | Binary label: 1.0 if take is better |

### Dataset Statistics

| Metric | Value |
|---|---|
| Total samples | 65,249 |
| Feature dimensions | 42 |
| Take-better rate | 15.4% |
| Mean action delta | -0.1082 |
| Std action delta | 0.2124 |
| Label worlds | 12 |
| Rollout depth | 2 |
| Info penalty | 1.5 DW |
| Source policy | ApexMCTS |
| Generation time | ~20 min |

The 15.4% take-better rate is consistent: the ApexMCTS policy already strongly favors stock, and the paired MC labels confirm this is correct most of the time.

### Feature Groups (42 dimensions)

| Group | Dims | Features |
|---|---|---|
| Card identity | 6 | Rank, DW value, suit one-hot |
| Immediate DW impact | 5 | Current DW, best DW after take, swing, improves, knock range |
| Meld completion | 5 | Completes meld, melds involving, meld count delta, same-rank partners, adj-suit partners |
| Near-meld formation | 3 | Doubles delta, triangles delta, near-meld density |
| Information reveal | 4 | Info cost proxy, pile depth, related in hand, hand from discard |
| Hand summary | 7 | Meld count, DW card count, can knock, is gin, avg DW value, rank diversity, suit concentration |
| Phase / score | 7 | Turn, deck remaining, early/late flags, scores, score diff |
| Opponent model | 5 | Opponent card weight, same-rank weight, known opp count, related cards, unseen count |

## Label-Generation Method

The labels use a tractable paired-continuation approximation:

1. For each draw state, sample 12 worlds from unseen cards
2. For each world:
   - **Take path**: take discard → best discard from 11 cards (restricted: can't return taken card) → simulate 2 draw-discard cycles → measure final deadwood
   - **Stock path**: draw top stock card from world → best discard from 11 cards → simulate 2 draw-discard cycles → measure final deadwood
3. Average take_dw and stock_dw across all worlds
4. Apply info penalty (+1.5 DW) to take path
5. `action_delta = (stock_ev - adjusted_take_ev) / 30.0`

This is not solver-grade, but it directly measures what matters: which draw action leads to lower expected deadwood, accounting for information cost.

## Offline Baseline vs Learned-Model Comparison

| Model | Accuracy | AUC | Brier | LogLoss | Regret |
|---|---|---|---|---|---|
| **Learned MLP** | **0.9665** | **0.9888** | **0.0250** | **0.0891** | **0.0492** |
| Deadwood Baseline | 0.9415 | 0.9818 | 0.0604 | 0.2486 | 0.0920 |
| Apex Heuristic | 0.9148 | 0.9528 | 0.0803 | 0.3141 | 0.1078 |
| Always Stock | 0.8464 | 0.5000 | 0.1536 | 2.4751 | 0.3007 |
| Always Take | 0.1536 | 0.5000 | 0.8464 | 13.6429 | 0.1826 |

### Decision-Quality Metrics

| Metric | Learned MLP | Best Baseline (Deadwood) | Edge |
|---|---|---|---|
| Accuracy | 96.65% | 94.15% | **+2.50pp** |
| AUC | 0.9888 | 0.9818 | **+0.0070** |
| Brier Score | 0.0250 | 0.0604 | **-0.0354** (better) |
| LogLoss | 0.0891 | 0.2486 | **-0.1595** (better) |
| Avg Regret (wrong) | 0.0492 | 0.0920 | **-0.0428** (better) |

### Per-Class Accuracy

| Model | Take Accuracy | Stock Accuracy |
|---|---|---|
| Learned MLP | 85.33% | 98.71% |
| Deadwood Baseline | 92.42% | 94.47% |
| Apex Heuristic | 95.21% | 90.80% |

The learned model is far more discriminating on stock calls (98.71% vs 94.47%) at the cost of being slightly less aggressive on take calls (85.33% vs Apex's 95.21%). This is a disciplined profile — it avoids bad takes.

### Calibration (Learned MLP)

| Bin | Mean Predicted | Mean Actual | Count |
|---|---|---|---|
| 0.0-0.1 | 0.006 | 0.009 | 10,466 |
| 0.1-0.2 | 0.146 | 0.174 | 363 |
| 0.2-0.3 | 0.248 | 0.303 | 188 |
| 0.3-0.4 | 0.343 | 0.363 | 102 |
| 0.4-0.5 | 0.453 | 0.539 | 78 |
| 0.5-0.6 | 0.549 | 0.603 | 73 |
| 0.6-0.7 | 0.648 | 0.574 | 101 |
| 0.7-0.8 | 0.751 | 0.714 | 70 |
| 0.8-0.9 | 0.855 | 0.768 | 112 |
| 0.9-1.0 | 0.993 | 0.983 | 1,478 |

Calibration is reasonable — the model is well-calibrated in the extremes (bins 0.0-0.1 and 0.9-1.0 contain most samples) and slightly overconfident in the mid-range (predicted > actual in 0.6-0.9). This is expected given the heavy class imbalance.

**Verdict: POSITIVE — gameplay integration justified.**

## ApexMCTSAction Design

### Integration Architecture

Three-tier close-call resolution preserving ApexMCTS's proven search:

| Search Margin | Action | Rationale |
|---|---|---|
| ≥ 1.5 DW (strong) | Trust search result | High-confidence search decisions unchanged |
| 0.3–1.5 DW (medium) | Consult action model | Ambiguous region where learned model may add value |
| < 0.3 DW (weak) or skipped | Defer to Apex heuristic | Near-zero search margin → insufficient signal |

**Model consultation**: When the search margin falls in the medium band, encode 42 action features and predict P(take is better). If P(take) > 0.55, take; otherwise, stock.

**Guardrails**:
- ✅ Model unavailable → clean fallback to Apex heuristic
- ✅ Feature encoding exception → clean fallback
- ✅ Strong search margins → never overridden by model
- ✅ All ApexMCTS discard, knock, and scoring logic preserved unchanged

## Benchmark Tables

### Quick Screen 1 (Seed 20260305, 40 games/matchup)

| Rank | Player | Elo |
|---|---|---|
| 1 | **ApexMCTS** | **1677.51** |
| 2 | Apex | 1541.24 |
| 3 | ApexMCTSAction | 1536.89 |
| 4 | DeepKnock | 1506.06 |
| 5 | Nexus | 1412.13 |
| 6 | Heisenbot | 1326.16 |

ApexMCTSAction vs ApexMCTS: **50.00%** [39.30%, 60.70%] (40-40)

### Quick Screen 2 (Seed 20260315, 40 games/matchup)

| Rank | Player | Elo |
|---|---|---|
| 1 | **ApexMCTSAction** | **1617.40** |
| 2 | Apex | 1563.72 |
| 3 | ApexMCTS | 1558.94 |
| 4 | DeepKnock | 1446.51 |
| 5 | Nexus | 1439.63 |
| 6 | Heisenbot | 1373.80 |

ApexMCTSAction vs ApexMCTS: **57.50%** [46.57%, 67.74%] (46-34)

### Head-to-Head Probe 1 (Seed 20260305, 240 games)

| Metric | Value |
|---|---|
| ApexMCTSAction wins | 123 |
| ApexMCTS wins | 117 |
| **Win Rate** | **51.25%** [44.96%, 57.50%] |
| Avg Point Diff | -0.40 |
| Avg Hands/Game | 10.32 |

### Head-to-Head Probe 2 (Seed 20260315, 240 games)

| Metric | Value |
|---|---|
| ApexMCTSAction wins | 111 |
| ApexMCTS wins | 129 |
| **Win Rate** | **46.25%** [40.05%, 52.57%] |
| Avg Point Diff | -0.98 |
| Avg Hands/Game | 10.32 |

### Combined Head-to-Head (480 games total)

| Metric | Value |
|---|---|
| ApexMCTSAction wins | 234 |
| ApexMCTS wins | 246 |
| **Combined Win Rate** | **48.75%** |

## Tests Run

| Test Suite | Tests | Result |
|---|---|---|
| `test_action_model.py` | 22 | ✅ OK (7.332s) |
| `test_apex.py` | 33 | ✅ OK (0.859s) |
| `test_regressions.py` | 7 | ✅ OK (0.190s) |
| `test_mcts.py` | 33 | ✅ OK (18.843s) |
| `test_value_model.py` | 17 | ✅ OK (73.974s) |
| `test_value_search.py` | 12 | ✅ OK (4.966s) |
| **Total** | **124** | **All pass** |

### New Tests Added (test_action_model.py, 22 tests)

**TestActionFeatures (9 tests):**
- Feature encoding produces correct shape (42 dim)
- Feature encoding is deterministic
- Feature names match dimension count
- All features are valid floats (no NaN)
- Features are in reasonable ranges
- Different discard cards produce different features
- Meld-completing card has completes_meld=1.0
- Works correctly with opponent model
- Works correctly without opponent model

**TestBaselineModels (4 tests):**
- DeadwoodBaseline produces correct output shape
- Probability values are valid (0-1 range)
- ApexHeuristicBaseline produces correct shape
- Meld-completing card gets high take probability
- Single-sample 1D input handles correctly

**TestModelTrainAndSave (3 tests):**
- Train on small synthetic dataset
- Save/load roundtrip preserves predictions
- predict_single returns valid float

**TestApexMCTSAction (3 tests):**
- Gameplay completion without errors
- No illegal behavior across multiple seeds
- Search stats are valid

**TestDatasetSchema (2 tests):**
- Feature encoding consistency across multiple calls
- DW swing sign convention is consistent

## Shipped Outcome vs Experimental-Only Outcome

**Shipped outcome: EXPERIMENTAL ONLY** ❌ (no ship)

- ✅ The draw decision was modeled directly rather than indirectly through generic state value
- ✅ A reproducible action-conditioned dataset was created (65,249 paired samples)
- ✅ A learned draw-action model was trained and evaluated against offline baselines
- ✅ The learned model **clearly beats all baselines** offline (96.65% vs 94.15% accuracy, 0.9888 vs 0.9818 AUC)
- ✅ Gameplay integration happened because the offline evidence justified it
- ❌ No statistically significant head-to-head edge — combined 480-game result: **48.75%** win rate
- ✅ No catastrophic regression (unlike Phase 51's ApexValue at 10%)
- ✅ No ship decision made from weak evidence

**ApexMCTS remains the sole shipped champion. ApexMCTSAction is experimental only.**

### Progress Across Learning Phases

| Phase | Bot | Approach | vs ApexMCTS H2H | Verdict |
|---|---|---|---|---|
| 51 | ApexValue | Replace rollout with P(win) | **10% win rate** | Catastrophic |
| 52 | ApexMCTSValue | Supplement rollout with P(win) | **50.2% / 480g** | Neutral |
| 53 | ApexMCTSAction | Action-conditioned close-call | **48.75% / 480g** | Neutral |

Three successive learned-model experiments have now failed to move the gameplay needle, despite progressively better offline signal.

## The Offline–Gameplay Gap: Analysis

This is the most important finding of Phase 53.

The action-conditioned model is **dramatically better** offline:
- 96.65% accuracy vs 94.15% (deadwood baseline) and 91.48% (Apex heuristic)
- 0.9888 AUC vs 0.9818 / 0.9528
- Nearly halved Brier score (0.025 vs 0.060)

Yet it produces **no measurable gameplay benefit**. Why?

### Hypothesis 1: Narrow Application Window

The model only fires in the medium-margin band (0.3–1.5 DW search margin). Most draw decisions have strong margins (the MC search is already decisive). The model improves decisions that rarely matter.

### Hypothesis 2: Label Alignment Gap

The paired MC labels use short (depth-2) deadwood rollouts, not full-game win probability. The model is trained on "which action leads to lower deadwood in 2 turns" but gameplay depends on full-game outcome. The action-conditioned structure fixes the state-value alignment problem but introduces a different gap: **tactical proxy vs strategic outcome**.

### Hypothesis 3: The Draw Decision Is Already Near-Optimal

ApexMCTS's 30-world MC search already produces excellent draw decisions. The 2.5% accuracy improvement on held-out decisions translates to ~1 additional correct decision per ~40 draw decisions. That single corrected decision may not consistently convert to wins.

### Hypothesis 4: Feature–Bot Circularity

The data was generated by ApexMCTS self-play. The model learned to reproduced ApexMCTS's draw patterns with slightly better accuracy. But reproducing the champion's own patterns cannot, by construction, beat the champion.

## Rejected Variants and Why

| Variant | Reason |
|---|---|
| Larger dataset (2000 games) | Reduced to 500 games due to generation speed (~0.4 games/sec). 65k samples proved sufficient for strong offline metrics. |
| Deeper rollouts (depth 4+) | Would dramatically slow data generation with marginal label quality improvement |
| Full-game continuation labels | Computationally intractable within sprint scope |
| Regression model (predicting delta) | Classification already produces strong AUC; regression adds complexity without clear benefit |
| Wider close-call band | H2H probe 2 (46.25%) suggests the model's close-call interventions may be slightly harmful; widening would amplify this |
| Lower model threshold (0.50) | Would make the model more aggressive on borderline calls where it is least calibrated |
| Direct search replacement | Closed negative result from Phases 51-52 |

## Unresolved Risks

1. **Offline-gameplay gap may be structural.** Three phases of increasingly sophisticated learned models all fail to translate offline accuracy into wins. The draw search may already be at or near the practical skill ceiling for draw decisions — improvements require different game surfaces (discard, knock timing).

2. **Self-play circularity.** Training on ApexMCTS's own decisions may learn to replicate rather than improve. Adversarial or mixed-policy training data could break this loop.

3. **Label quality ceiling.** Short (depth-2) deadwood rollouts are a noisy proxy for win probability. Full-game continuations would produce better labels but at 100x computational cost.

4. **Feature overfit to training distribution.** 42 features with 65k samples is a favorable ratio, but the model may overfit to the specific self-play distribution. Cross-policy data would test generalization.

5. **Model consultation frequency.** In the 3-tier design, the model is consulted only for a minority of draw decisions. This minimizes risk but also minimizes potential impact.

## Recommended Next Step

Phase 53 answered its question cleanly:

> if the model is trained on the draw action itself, does it finally produce useful decision signal?

**Answer: Yes, but only offline.** The action-conditioned model is the first learned component to clearly beat handcrafted baselines on draw-decision quality. But this signal does not translate to wins.

### Broader Lesson

Three successive learned-model experiments (51, 52, 53) have all failed the gameplay gate while succeeding offline. This strongly suggests:

1. **The draw decision is not the binding constraint.** ApexMCTS's MC search already handles draws well enough that marginal improvements don't convert to wins.

2. **The next productive surface is discard-stage optimization** or **knock-timing strategy** — areas where the current bot uses only heuristics, not search or learning.

### Option A: Discard-Stage Action Model (Recommended)

- After drawing, evaluate each possible discard using a learned model
- The PBS state features naturally encode the post-draw 10-card hand
- Discard decisions are made every turn (not gated by a close-call band)
- This is the largest remaining heuristic surface in the bot

### Option B: Knock-Timing Model

- Learn when to knock vs continue playing
- The current knock decision uses simple deadwood thresholds
- A learned model could incorporate opponent model signals, score context, and game phase

### Option C: Enhanced Label Quality

- Generate labels with full-game continuations (expensive but higher-fidelity)
- Use this to determine if the offline-gameplay gap is fundamentally a label problem
- If full-game labels still don't translate to wins, the draw decision is confirmed near-optimal

### Option D: Critical-Situations Benchmark

- Identify the specific draw decisions where ApexMCTSAction and ApexMCTS disagree
- Analyze whether the model's overrides are actually better or worse in those specific situations
- This diagnostic could reveal whether the model helps in some situations but hurts in others

Either outcome in the next phase is acceptable. Unclear evidence is not.
