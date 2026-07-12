# Oracle Autoresearch Program (Directive 109)

This folder is the Gin Rummy Oracle analogue of Karpathy's `autoresearch`
workflow, hardened via Directive 108 and extended via Directive 109 with
explicit semantic mutation surfaces for AlphaEvolve-style LLM code evolution.

## Architecture (Directive 109)

The lab evaluates Oracle decision quality across three frozen benchmark lanes,
each consuming **pre-computed offline targets** (no online oracle recomputation):

| Lane | Decision | Metric | Weight | Targets |
|------|----------|--------|--------|---------|
| **Knock** | knock vs continue (low-stock) | composite score | 60% | `frozen_knock_targets.json` |
| **Draw** | take discard vs draw stock | accuracy + distance | 25% | `frozen_draw_targets.json` |
| **Discard** | which card to discard | accuracy + safety + DW dist | 15% | `frozen_discard_targets.json` |

All lanes share a common **Oracle Abstraction Layer** (`oracle_abstractions.py`).

The **aggregate promotion score** is the weighted combination of per-lane
scores, gated by a **Pareto constraint** that prevents any single-lane regression.

## Semantic Mutation Surface (Directive 109/115/117)

Two helper functions in `train.py` are the primary evolution targets.
Directive 117 added `pickup_pressure` to the signature, representing the 
meld-threat intensity of opponent discard pickups.

### `compute_eval_weight(hero_deadwood, stock_size, n_trace_events, ev_gap, turn_number, n_pickups, n_discards, n_declines, pickup_pressure, my_score, opp_score, score_diff) → float`
- Controls blend between direct EV and CFR prior
- Current: EV-gap confidence + trace-richness weighting
- Target: refine curves using `turn_number`, `pickup_pressure`, or match-score context (`score_diff`).

### `compute_trace_confidence_multiplier(n_trace_events, stock_size, hero_deadwood, turn_number, n_pickups, n_discards, n_declines, pickup_pressure, my_score, opp_score, score_diff) → float`
- Controls risk-penalty scaling based on observation quality
- Current: Exponential decay + deadwood floor + stock-size floor boost
- Target: use `pickup_pressure` or match-score pressure for more precise risk adjustment.

Both functions are used by the real-policy gauntlet player, ensuring the
held-out evaluation always runs the exact same policy being optimized.

## Precision Engineering (Directive 117)

To unlock further gains, the underlying belief-world generator was tightened:
- **OpponentModel**: Pickup boosts were increased and made synergistic (multiple
  pickups of same rank/suit create higher world-sampling density in those regions).
- **Diagnostics**: A new `belief_diagnostics.py` script provides visibility into
  how public signals shape sampled worlds.

## Report-Naming Convention (Directive 115)

To maintain a clear historical audit trail, all root reports for directives must
follow this naming rule:
- Input: `GEMINI_DIRECTIVE_<N>.md`
- Output: `EXECUTION_REPORT_<N>.md`

## Setup

1. Read `README.md`, `prepare.py`, `train.py`, and this `program.md`.
2. Run `python oracle_autoresearch/prepare.py --force` to generate frozen targets.
3. Verify `oracle_autoresearch/data/` contains:
   - `train_spots.json`, `eval_spots.json`, `lab_manifest.json`
   - `frozen_knock_targets.json`, `frozen_draw_targets.json`, `frozen_discard_targets.json`
4. Verify `oracle_autoresearch/loop_state.json` exists and has an incumbent.
5. Confirm Gemini CLI is installed and authenticated if using the loop.

## Scope

What you can edit:
- `train.py` — **preferably** the two mutation surface functions:
  - `compute_eval_weight()`
  - `compute_trace_confidence_multiplier()`
- Scalar knobs in `train.py` as a fallback

What you cannot edit (frozen benchmark infrastructure):
- `prepare.py` — the frozen benchmark harness
- `multi_lane_benchmark.py` — the frozen lane runner
- `oracle_abstractions.py` — the frozen abstraction layer
- `gauntlet_eval.py` — the held-out evaluation (now runs real policy)
- The frozen benchmark data and targets
- The scoring formula
- The rest of the repo unless explicitly told otherwise

## Objective

Optimize the **aggregate score** across all three lanes.
Higher is better. The knock lane still dominates (60% weight), but
draw and discard lanes provide broader signal.

Promotion requires both:
1. Aggregate score improvement by margin
2. No single lane regression beyond epsilon (0.02)

## Experiment Loop

The autoresearch loop owns keep/discard decisions:

1. Generate one focused candidate edit to `train.py`
   - **Prefer semantic mutations** in helper functions over scalar tuning
   - Propose continuous math: sigmoid, exponential, polynomial, sqrt
2. Apply the edit
3. Benchmark it (all lanes run with frozen targets)
4. Keep it only if the aggregate score beats the incumbent by margin
   AND no single lane regresses by > epsilon (Pareto gate)
5. Otherwise restore the incumbent and move on
6. Log diffs, scores, rationale, and provenance every time

## Held-Out Gauntlet (Directive 109: Real Policy)

The gauntlet now evaluates the **real `train.py` Oracle policy**:

- `RealOraclePolicyPlayer` runs belief-world EV estimation for knock decisions
- Uses the same `compute_eval_weight()` and `compute_trace_confidence_multiplier()`
  that the proxy benchmark optimizes
- Deterministic seat-balanced games with Wilson CI
- Command: `python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 109`
- Legacy mode: `python oracle_autoresearch/gauntlet_eval.py --n-deals 10 --seed 109 --mode legacy`

## Simplicity Criterion

All else equal, simpler is better. Focused, falsifiable edits beat sprawling rewrites.
A single clean sigmoid that improves the aggregate score is worth more than
a sprawling framework that adds complexity without measurable benefit.

## Good Directions

- **Semantic mutations** in `compute_eval_weight()` or `compute_trace_confidence_multiplier()`
- Non-linear functions of game-state features
- Interaction terms between available state variables
- Asymmetric rules for different game phases
- Better EV estimation via knob adjustments (fallback)
- Better opponent-model weights for world generation

## Bad Directions

- Editing `prepare.py`, `multi_lane_benchmark.py`, or `oracle_abstractions.py`
- Rebuilding targets every run
- Changing the fixed eval benchmark
- Expanding into unrelated engine work
- Opaque neural embedding rewrites
- Over-claiming full unified Gin Rummy solving

## Current Research Context

- Phase 76 repaired calibration integrity.
- Directive 107 expanded from a single knock lane to three lanes.
- Directive 108 froze per-lane targets, added Pareto promotion, gauntlet, narrowed surface.
- **Directive 109** extracted semantic mutation surfaces and integrated the real
  policy into the gauntlet.
- **Directive 111** confirmed local headroom in the winning family, promoting `0.7948`.
- **Directive 112** hardened the Gemini bridge, optimized prompts, and enabled retries.
- The incumbent aggregate score is `0.7948` (gemini_gcli_0043 + local refinement).
- Next: semantic formula evolution via the hardened Gemini bridge.
