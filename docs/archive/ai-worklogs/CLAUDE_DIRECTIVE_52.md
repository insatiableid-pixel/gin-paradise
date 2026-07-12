# Claude Directive 52: Value-Augmented Rollout Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_52.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - why this path was chosen over direct value replacement and over more local `ApexMCTS` tuning
   - exact files changed
   - exact commands run
   - leaf-state / distribution-alignment diagnostics
   - experimental design and guardrails
   - parameter sweep or candidate-selection table
   - benchmark tables
   - tests run
   - shipped outcome vs experimental-only outcome
   - rejected variants and why they were rejected
   - unresolved risks
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, any produced artifact needed for the chosen path, and `EXECUTION_REPORT_52.md` are all finished.

## Current State

The current Python AI position is now clear:

- `EXECUTION_REPORT_49.md` shipped `ApexMCTS` as the new champion with a real high-power duplicate edge over `Apex`.
- `EXECUTION_REPORT_50.md` tested opponent-model-weighted world sampling (`ApexMCTSv2`) and found no edge over the baseline `ApexMCTS`.
- `EXECUTION_REPORT_51.md` successfully created the first oracle-track foundation:
  - reproducible self-play dataset
  - first learned value model
  - strong offline win-probability metrics versus the handcrafted baseline
- But `EXECUTION_REPORT_51.md` also showed that the first gameplay integration, `ApexValue`, was a catastrophic failure:
  - roughly 10% win rate versus `ApexMCTS`
  - worse than every serious bot in the field

Treat that as an important negative result.

The lesson is **not** "value learning failed."
The lesson is:

- the learned model appears to contain real offline signal
- but replacing the proven rollout objective with a raw `P(win)` estimate at the wrong integration point badly damages play

So Phase 52 should **salvage the foundation, not abandon it**.

## Primary Objective

Build the safest and highest-signal next oracle-track experiment:

1. validate whether the Phase 51 value model is useful on actual rollout leaf states
2. integrate the learned value signal only as a **conservative supplement** to the existing `ApexMCTS` draw search
3. benchmark that conservative hybrid honestly against unchanged `ApexMCTS`
4. stop and report honestly if the value signal still does not survive gameplay

This is a refinement of the oracle-track pivot, not a retreat back to blind heuristic tuning.

## Decision Rule

Use this decision rule explicitly:

1. `ApexMCTS` remains the exact shipped champion baseline.
2. The direct Phase 51 path of "replace rollout deadwood evaluation with raw learned `P(win)`" is now a closed negative result for this sprint.
3. Do **not** spend this sprint on more CFR work, more weighted-world tuning, or blind model-size escalation.
4. The learned model may be used only as a **supplementary signal** unless strong evidence says otherwise.
5. If alignment diagnostics or duplicate benchmarks show the value signal still hurts play, stop there and recommend the next architectural step honestly rather than grinding parameters.

## Why This Path Was Chosen

The best available evidence now points here:

- Report 48 ruled out discard-only CFR.
- Report 50 ruled out weighted-world sampling as a meaningful improvement path.
- Report 51 showed that the value-model foundation is real offline, but the first integration architecture was wrong.
- Report 51 itself recommended **value-augmented rollouts** as the best next experiment.

So Phase 52 should test the narrow question:

- can learned match-equity signal help if it is attached carefully to the proven search stack?

That is a much better next question than:

- "can we throw away rollouts and trust a first-generation value model?"

## Scope

### Always Allowed

- `gin_rummy/apex_mcts.py`
- `gin_rummy/draw_search.py`
- `gin_rummy/apex_value.py`
- `gin_rummy/value_model.py`
- `gin_rummy/pbs_features.py`
- new Python files under `gin_rummy/`
- new Python tests in the repo root
- analysis / diagnostic scripts in the workspace root or a `tools/` subpath
- `benchmark.py`
- `test_apex.py`
- `test_regressions.py`
- `test_mcts.py`
- `test_value_model.py`
- `EXECUTION_REPORT_52.md`

### Suggested New Files

You do not have to use exactly these names, but a structure in this spirit is expected if useful:

- `gin_rummy/value_augmented_search.py`
- `gin_rummy/apex_mcts_value.py`
- `tools/analyze_value_alignment.py`
- `test_value_search.py`

### Conditionally Allowed

Only if required for the chosen path:

- a new benchmark alias for the experimental hybrid bot
- a refreshed model artifact if and only if feature schema or training target changes materially
- a small diagnostic artifact or JSON summary for alignment analysis

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- new CFR work
- large new architecture churn
- blind hyperparameter grinding without a narrow hypothesis
- benchmark methodology changes unless you discover a correctness bug and explain it explicitly

## Required Sequence

### 1. Lock the Baseline

Before doing any experimental integration work:

- preserve the exact shipped `ApexMCTS` behavior as the benchmark baseline
- do not mutate the shipped champion into the experiment
- if you need a hybrid bot, create a clearly separate experimental class and benchmark alias

Strong naming preference:

- `ApexMCTSValue`

This should be visibly distinct from the failed Phase 51 `ApexValue`.

### 2. Reuse the Phase 51 Foundation by Default

Use the existing Phase 51 artifacts unless you have a specific reason to change them:

- `models/value_data.npz`
- `models/apex_value_model.pkl`
- `models/value_model_results.json`

Do **not** automatically regenerate a massive dataset just because you can.

If you change:

- feature schema
- training target
- or model interface

then regenerate only what is necessary and explain the reason explicitly in the report.

### 3. Measure Distribution Alignment Before Trusting the Model

Phase 51's most important unresolved risk was distribution mismatch.

You must investigate that directly.

At minimum, do one of these:

- add a dedicated diagnostic script, or
- extend the evaluation pipeline to sample real rollout leaf states from `ApexMCTS` search and compare them to the Phase 51 training distribution

The analysis should cover at least:

- deadwood distribution
- turn / phase distribution
- deck-remaining distribution
- score-differential distribution
- knock-eligibility rate
- prediction range / calibration on those leaf states if labels are available

You do not need a perfect statistical paper.
You do need evidence that tells us whether the model is being queried on something close to what it was trained on.

### 4. Implement Conservative Value-Augmented Search

The preferred design is:

1. keep the existing deadwood rollout evaluation intact
2. evaluate the learned value signal only on valid 10-card leaf states that match the feature schema
3. use the value model as a **small correction, tiebreaker, or close-call signal**
4. keep fallback behavior conservative

Good examples:

- deadwood EV remains primary, value model supplies a small additive adjustment
- value model is consulted only when take-vs-stock deadwood margins are already close
- value model breaks ties between otherwise similar rollout outcomes

Bad examples for this sprint:

- replace the rollout objective entirely with `P(win)`
- let the model override clear deadwood edges freely
- use value estimates on malformed or obviously off-distribution states

Guardrails:

- if the model is unavailable, behavior should fall back cleanly
- if value diagnostics fail, behavior should fall back cleanly
- if the augmentation weight is zero, behavior should be equivalent to the baseline path

### 5. Keep the Search Change Narrow and Auditable

This should be a disciplined experiment, not a kitchen-sink rewrite.

Prefer a small number of clearly interpretable knobs, such as:

- value weight
- close-call band
- override margin

If you do a parameter sweep, keep it intentionally small and hypothesis-driven.
For example, a small grid over 3-5 candidate settings is fine.
A large blind search is not.

### 6. Add Focused Tests

Add tests for the new path, including as appropriate:

- alignment / diagnostic helper correctness
- blended-evaluator determinism and numeric validity
- fallback behavior when model is missing
- zero-weight or disabled-path parity with baseline behavior
- gameplay legality and completion for the new experimental bot

If a parity test is not exact due to randomness, explain the limitation and still test the strongest reproducible invariant you can.

### 7. Benchmark Honestly

Run and record these commands unless you discover a correctness reason to change them and explain it explicitly:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_mcts.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_value_model.py
```

If you add a new test file, also run it explicitly.

Run the alignment / diagnostic command you create, for example:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' tools/analyze_value_alignment.py
```

Then run quick screening benchmarks for the experimental hybrid bot:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSValue,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSValue,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress
```

If and only if those quick screens are at least credible, then run direct head-to-head probes:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSValue,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSValue,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

Only if those head-to-head probes are genuinely promising should you escalate to a 500-deal duplicate probe.

### 8. Report the Search Diagnostics, Not Just the Win Rate

The report must include operational diagnostics for the experimental bot, such as:

- how often the value path was consulted
- how often it changed the baseline answer
- how often it agreed with the baseline
- how often it fell back

If the value signal only fires in a tiny number of close-call spots, that is useful information even if the final edge is small.

## Benchmark Gates

Your result is acceptable only if all of the following are true:

1. `test_apex.py` passes in full.
2. `test_regressions.py` passes in full.
3. `test_mcts.py` passes in full.
4. `test_value_model.py` passes in full.
5. any new tests pass in full.
6. the alignment analysis completes successfully and is documented honestly.
7. the experimental bot completes duplicate benchmarks without hangs or illegal behavior.
8. no ship decision is made from small-sample noise alone.

## Acceptance Criteria

This task is complete only if all of the following are true:

- the Phase 51 failure mode was investigated directly, not hand-waved
- a conservative value-augmented search path was either implemented or ruled out with evidence
- the unchanged `ApexMCTS` baseline was benchmarked against the new experiment
- the report clearly states whether the outcome is:
  - failed experiment
  - experimental-only positive signal
  - or ship-worthy challenger
- `EXECUTION_REPORT_52.md` is saved to the workspace root with honest numbers

## Deliverable Expectation

Directive 51 proved something important:

- the project can now generate data
- train a model
- and evaluate it offline

Directive 52 should answer the next harder question:

- can that learned signal help **without** discarding the proven rollout machinery?

If yes, that is the first real bridge between the current champion and an oracle-track architecture.
If no, that is still valuable, because it tells us the next phase should likely move toward action-conditioned training or better belief-state evaluation rather than naive state-value insertion.

Either outcome is acceptable.
Unclear evidence is not.
