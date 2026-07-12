# Claude Directive 51: Match Equity Foundation Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_51.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - why this oracle-track foundation path was chosen over more ApexMCTS tuning
   - exact files changed
   - exact data-generation, training, evaluation, and benchmark commands run
   - dataset size and schema
   - model architecture and feature encoding
   - baseline predictor vs learned-model offline metrics
   - before/after benchmark tables if an experimental bot is integrated
   - tests run
   - shipped outcome vs experimental-only outcome
   - rejected variants and why they were rejected
   - unresolved risks
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, any produced artifact needed for the chosen path, and `EXECUTION_REPORT_51.md` are all finished.

## Current State

The current Python AI position is now clear:

- `EXECUTION_REPORT_49.md` shipped `ApexMCTS` as the new champion with a real high-power edge over `Apex`.
- `EXECUTION_REPORT_50.md` tested opponent-model-weighted world sampling (`ApexMCTSv2`) and found no edge over the baseline `ApexMCTS`.
- `PROJECT_STATUS.md` has been updated accordingly: `ApexMCTS` remains the shipped champion; `ApexMCTSv2` is experimental and not shipped.
- The attached strategy memo, `Building an Oracle Gin Rummy Engine.md`, argues that the current engine family has reached the ceiling of deadwood-proxy PIMC improvements and should pivot toward match-equity over public belief state.

Treat that architectural diagnosis seriously.

The next step is **not** another narrow search-parameter tweak unless the new path fails completely.

## Primary Objective

Build the first oracle-track foundation by moving the engine one layer closer to **match-equity maximization** instead of pure deadwood proxy:

1. generate a reusable self-play dataset of public states, private hands, score context, and eventual outcomes
2. train and evaluate a first supervised match-equity model
3. if the offline model is good enough, integrate it into a controlled experimental bot and benchmark it against `ApexMCTS`

## Decision Rule

Use this decision rule explicitly:

1. `ApexMCTS` is the shipped champion baseline
2. stop spending the sprint on another local heuristic/search tweak unless the new foundation path fails early
3. first teach the engine to predict eventual outcome from public state + private hand + score context
4. only integrate the learned evaluator into gameplay if it beats a simple handcrafted baseline offline
5. only replace or challenge `ApexMCTS` if duplicate benchmarks support it honestly

## Why This Path Was Chosen

The best available evidence now points here:

- Report 48 ruled out discard-only CFR
- Report 50 ruled out weighted-world world sampling as a meaningful improvement to `ApexMCTS`
- the oracle memo explicitly identifies the current ceiling as:
  - deadwood proxy instead of match equity
  - perfect-information Monte Carlo instead of belief-state evaluation
  - local tactical search instead of strategic value prediction

So Phase 51 should begin the transition from:

- "which branch leaves me less deadwood soon?"

to:

- "which branch increases my probability of winning the game or match from this information state?"

## Scope

### Always Allowed

- `gin_rummy/apex_mcts.py`
- `gin_rummy/apex_mcts_v2.py`
- `gin_rummy/draw_search.py`
- new Python files under `gin_rummy/`
- new Python tests in the repo root
- data-generation, training, and evaluation scripts in the workspace root or a new `tools/` subpath
- lightweight model/config artifacts needed for this path
- `benchmark.py`
- `test_apex.py`
- `test_regressions.py`
- `test_mcts.py`
- `EXECUTION_REPORT_51.md`

### Suggested New Files

You do not have to use exactly these names, but a structure in this spirit is expected if useful:

- `gin_rummy/pbs_features.py`
- `gin_rummy/value_model.py`
- `gin_rummy/apex_value.py`
- `tools/generate_value_data.py`
- `train_value_model.py`
- `evaluate_value_model.py`
- `test_value_model.py`
- `models/apex_value_model.*`

### Conditionally Allowed

Only if required for the chosen model stack:

- dependency declarations or setup notes for Python-side ML/runtime support
- a new benchmark alias in `benchmark.py` for the experimental value-based bot

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- unrelated documentation churn
- new CFR work
- broad neural-search architecture churn beyond the scoped value-model foundation
- benchmark methodology changes unless you discover a correctness bug and explain it explicitly

## Required Sequence

### 1. Lock the Baseline

Before doing any learning work, preserve the exact Report 49 `ApexMCTS` behavior as the benchmark baseline.

If you create a value-integrated bot, it must be benchmarked against the unchanged shipped champion.

### 2. Define the First Public-State / Match-Equity Dataset

Create a dataset generator from self-play, preferably using `ApexMCTS` as the source policy.

Each row should at minimum include:

- public game state features
- the acting player's private hand features
- score context
- wall depth / turn context
- discard pile / recent public action context
- eventual outcome target

Strong default target:

- probability of the acting player eventually winning the current game

If match-level labeling is feasible in this sprint, you may use match outcome instead, but explain the choice explicitly.

The dataset must be reproducible and saved in a documented format.

### 3. Build a Baseline Predictor and a Learned Model

You must compare at least two predictors offline:

1. a simple handcrafted baseline, such as:
   - deadwood-only score
   - deadwood + score differential
   - another simple linear heuristic
2. a learned model

The learned model does not have to be large.
A compact MLP or similarly lightweight value model is preferred over a huge architecture for this first step.

Do not claim progress from training alone.
The learned model must beat the simple baseline on held-out offline metrics to justify gameplay integration.

### 4. Offline Evaluation First

Evaluate the model on held-out data with metrics appropriate for probabilistic outcome prediction.

At minimum report:

- train / validation split sizes
- calibration or proper scoring metric
- Brier score or cross-entropy / log loss
- baseline vs learned comparison

If the learned model does not beat the baseline meaningfully, stop there, report honestly, and do not force gameplay integration.

### 5. Controlled Gameplay Integration Only If Justified

If the learned model is meaningfully better offline, integrate it into a controlled experimental bot.

Recommended default:

- keep the existing `ApexMCTS` search structure
- replace or augment the deadwood-proxy leaf evaluation with the learned value estimate
- keep fallback logic conservative

Expected bot naming:

- `ApexValue` or `ApexMCTSValue`

If you choose a different name, explain it.

### 6. Add Focused Tests

Add tests for:

- dataset generation shape / schema
- feature encoding determinism
- model save/load
- baseline-vs-model evaluation pipeline
- gameplay integration legality and completion, if integration happens

### 7. Benchmark Honestly

Run and record these commands unless you discover a correctness reason to change them and explain it explicitly:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_mcts.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_value_model.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' tools/generate_value_data.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' train_value_model.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' evaluate_value_model.py
```

If gameplay integration happens, also run:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexValue,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexValue,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexValue,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexValue,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

Only if those runs are promising should you escalate to a 500-deal duplicate probe.

## Benchmark Gates

Your result is acceptable only if all of the following are true:

1. `test_apex.py` passes in full.
2. `test_regressions.py` passes in full.
3. `test_mcts.py` passes in full.
4. all new value-model tests pass in full.
5. dataset generation and model training complete successfully.
6. the learned model beats the simple offline baseline on held-out data, or the report explains honestly why it failed.
7. if gameplay integration happens, the experimental bot must complete duplicate benchmarks without hanging.
8. if gameplay integration happens, no ship decision may be made from small-sample noise alone.

## Acceptance Criteria

This task is complete only if all of the following are true:

- a reproducible match-equity dataset was created
- a first learned value model was trained and evaluated offline
- offline metrics were compared against a handcrafted baseline
- gameplay integration happened only if justified by offline evidence
- the report clearly states whether the result is foundation-only or also gameplay-positive
- `EXECUTION_REPORT_51.md` is saved to the workspace root with honest numbers

## Deliverable Expectation

Directive 49 found the first real search breakthrough.
Directive 50 showed that local search refinements are not guaranteed to move the needle.

Directive 51 should begin the oracle-track transition:

- away from deadwood-only proxy thinking
- toward match-equity prediction
- while preserving the rigorous duplicate-benchmark culture that got the engine this far

A strong foundation-only result is acceptable.
A forced ship from weak evidence is not.
