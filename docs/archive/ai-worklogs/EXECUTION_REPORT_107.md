# Execution Report — Directive 107

## Objective
Upgrade `oracle_autoresearch` from a single narrow low-stock knock/continue
sandbox into a broader multi-lane Oracle proxy benchmark with explicit Gin
Rummy information-state abstractions, a wider held-out evaluation suite,
and one honest aggregate promotion score.

## What Was Delivered

### 1. Shared Oracle Abstraction Layer (`oracle_abstractions.py`)

Six explicit, reviewable information-state abstraction groups:

| Group | Feature | Implementation |
|-------|---------|----------------|
| **Deadwood bucket** | Hero hand quality (0=gin through 7=very high) | `deadwood_bucket()` |
| **Meld structure** | Meld count + DW card count (capped) | `meld_structure_bucket()` |
| **Combination potential** | Near-meld extensions (pairs, partial runs) | `combination_potential_bucket()` |
| **Upcard utility** | Face-up card value to hero (0-3) | `upcard_utility_bucket()` |
| **Opponent memory** | Bucketed pickup/discard/decline + danger score | `opponent_memory_bucket()`, `opponent_danger_score()` |
| **Deck phase** | Stock size + turn number buckets | `deck_phase_bucket()`, `turn_phase_bucket()` |

All features are unified in `OracleInfoState` dataclass with `.as_tuple()` for
CFR-compatible dict keying. `build_oracle_info_state(spot)` is the single entry
point used by all lanes.

### 2. Multi-Lane Benchmark (`multi_lane_benchmark.py`)

Three frozen held-out decision lanes:

| Lane | Weight | Decision | Reference | Metric |
|------|--------|----------|-----------|--------|
| **Knock** (preserved) | 60% | knock vs continue | v6 solver + world-sampled EV | composite score |
| **Draw** (new) | 25% | take discard vs draw stock | Oracle-computed best action | accuracy − overtake penalty |
| **Discard** (new) | 15% | which card to discard | DW-optimal + safety scoring | accuracy + safety bonus |

**Draw lane** computes oracle best-action by sampling unseen cards for stock
draws and comparing expected DW improvement against taking the upcard (with
an information-revelation penalty). The candidate policy uses the abstraction
layer's `upcard_utility`, `deck_phase`, and `dw_bucket` features.

**Discard lane** evaluates discard selection among DW-optimal candidates, with
a safety-awareness tie-breaker using opponent trace data (avoiding cards near
opponent pickups, preferring cards opponent declined).

### 3. Aggregate Promotion Score

The aggregate score is a weighted combination of per-lane scores:

```
aggregate = 0.60 * knock_score + 0.25 * draw_score + 0.15 * discard_score
```

This replaces the single knock-only score for promotion decisions.

### 4. Existing Knock Lane Preserved

The current incumbent behaviour is **completely intact**:
- `DIRECT_EVAL_WEIGHT = 0.90`
- `CALIBRATION_MAX_WORLDS = 150`
- `CALIBRATION_FRACTION = 0.15`
- All Phase 75/76 opponent-model improvements retained
- `train.py` now calls the multi-lane benchmark after its existing scoring

### 5. Updated Documentation

- `program.md` — describes multi-lane architecture and lane weights
- `agent_prompt.md` — updated for three-file editing surface with all
  editable parameters across `train.py`, `multi_lane_benchmark.py`, and
  `oracle_abstractions.py`
- `README.md` — updated architecture diagram, file listing, and quickstart

## Verification Results

All three required verification commands passed:

| Command | Result |
|---------|--------|
| `python oracle_autoresearch/prepare.py` | ✅ Passed (lab exists) |
| `python oracle_autoresearch/train.py --time-budget 60 --tag directive107_smoke` | ✅ Passed (exit 0) |
| `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode fallback_only --max-experiments 1 --dry-run` | ✅ Passed (exit 0) |

### Smoke Test Per-Lane Results (60s budget)

| Lane | Score | Detail |
|------|-------|--------|
| Knock | 0.5593 | 65% accuracy, 0% false positive, 41% undercut rate |
| Draw | 1.0000 | 100% accuracy on eval set (baseline policy) |
| Discard | 0.9629 | 96% accuracy + 0.04% safety bonus |
| **Aggregate** | **0.7300** | Weighted combination |

Note: Knock score is lower than the full 300s incumbent (0.6293) because
this smoke test ran with only a 60s budget. The aggregate properly integrates
all three lanes.

## What Remains Intentionally Out of Scope

1. **Full unified Gin Rummy solving** — This is a proxy benchmark, not the
   final super-oracle. The abstraction layer is explicit and bounded.

2. **Neural embedding rewrites** — All features are handcrafted and reviewable.
   No opaque learned representations are used in this sprint.

3. **Broader knock windows across deck phases** — The directive suggested this
   as a potential third lane. The discard-safety lane was chosen instead as it
   reuses more existing repo infrastructure and provides genuinely orthogonal
   signal. Broader knock windows remain a natural future extension by adjusting
   the `max_stock` parameter in dataset generation.

4. **Lane weight optimisation** — The 60/25/15 weights are an initial
   reasonable split. Empirical tuning of lane weights is a natural next step
   for the autoresearch loop.

5. **Draw lane: opponent-model-weighted world sampling** — The draw oracle
   currently uses uniform sampling for stock draw cards. Integrating the
   opponent model weights (as done in the knock lane) would improve oracle
   quality but is deferred.

## How the Aggregate Evaluation Was Verified

1. **Knock lane** — Verified by the existing frozen eval benchmark (80 spots)
   with v6 solver reference labels. Score formula unchanged.

2. **Draw lane** — Oracle-computed best action uses world-sampled DW
   improvement comparison with information-revelation penalty. Candidate
   policy evaluated against this reference on the same 80 eval spots.

3. **Discard lane** — Oracle best discard is DW-optimal among the 11-card
   hand after simulated draw. Candidate policy evaluated for accuracy plus
   safety-awareness bonus on the same 80 eval spots.

4. **Aggregate** — Weighted combination verified to be numerically consistent:
   `0.60 × 0.5593 + 0.25 × 1.0 + 0.15 × 0.9629 = 0.7300` ✓

## Files Modified/Created

| File | Action |
|------|--------|
| `oracle_autoresearch/oracle_abstractions.py` | **Created** — shared abstraction layer |
| `oracle_autoresearch/multi_lane_benchmark.py` | **Created** — multi-lane runner |
| `oracle_autoresearch/train.py` | **Modified** — integrated multi-lane call |
| `oracle_autoresearch/program.md` | **Rewritten** — multi-lane architecture |
| `oracle_autoresearch/agent_prompt.md` | **Rewritten** — three-file editing surface |
| `oracle_autoresearch/README.md` | **Rewritten** — updated docs |
| `EXECUTION_REPORT_107.md` | **Created** — this report |
