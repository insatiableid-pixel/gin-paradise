# Claude Directive 53: Action-Conditioned Draw Model Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_53.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - why this path was chosen over more `ApexMCTSValue` tuning
   - exact files changed
   - exact commands run
   - dataset design and schema
   - label-generation method
   - offline baseline vs learned-model comparison
   - decision-quality metrics
   - benchmark tables if gameplay integration happens
   - tests run
   - shipped outcome vs experimental-only outcome
   - rejected variants and why they were rejected
   - unresolved risks
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, any produced artifact needed for the chosen path, and `EXECUTION_REPORT_53.md` are all finished.

## Current State

The current Python AI position is now clearer than ever:

- `EXECUTION_REPORT_49.md` shipped `ApexMCTS` as the champion with a real high-power duplicate edge over `Apex`.
- `EXECUTION_REPORT_50.md` ruled out weighted-world sampling as a meaningful next-step improvement.
- `EXECUTION_REPORT_51.md` created the first reusable value-model foundation, but direct `P(win)` replacement (`ApexValue`) was catastrophic.
- `EXECUTION_REPORT_52.md` salvaged that foundation with conservative value-augmented rollouts, but the result was still neutral:
  - `ApexMCTSValue` no longer damages play
  - but it also showed no measurable edge versus `ApexMCTS`
  - combined head-to-head result was essentially 50/50

This matters.

Two successive experiments have now failed to produce a draw-stage edge from a **state-value** model:

1. direct replacement was catastrophic
2. conservative augmentation was neutral

That strongly suggests the next model needs to predict the value of the **action**, not just the value of the resulting state.

## Primary Objective

Build the first action-conditioned learning path for the draw decision:

1. create a reproducible dataset of draw-decision states with paired `take discard` vs `draw stock` labels
2. train and evaluate a learned model that predicts **which draw action is better**, or by how much
3. compare it against meaningful offline baselines on held-out decision-quality metrics
4. only if the offline evidence is clearly positive, integrate it into a controlled experimental bot and benchmark it against unchanged `ApexMCTS`

## Decision Rule

Use this decision rule explicitly:

1. `ApexMCTS` remains the exact shipped champion baseline.
2. The `ApexMCTSValue` path is now informationally useful but not the main optimization target for this sprint.
3. Do **not** spend this sprint on wider close-call bands, heavier value weights, or more `ApexMCTSValue` parameter grinding unless the new path fails immediately.
4. The next model should be trained on the decision it will actually help make.
5. If the action-conditioned model does not beat offline baselines on held-out draw decisions, stop there and report honestly rather than forcing gameplay integration.

## Why This Path Was Chosen

The best available evidence points here:

- Report 49 showed the draw decision is the last clearly exploitable surface in the current champion.
- Report 51 showed that a generic state-value model is not safe to substitute for draw search.
- Report 52 showed that even a careful state-value supplement does not move the needle.
- Report 52 itself recommended **action-conditioned value modeling** as the best next step.

So Phase 53 should answer the sharper question:

- can we learn the value of `take` versus `stock` directly from the same public state, instead of hoping a generic state-value model indirectly solves that choice?

That is the most aligned next experiment.

## Scope

### Always Allowed

- `gin_rummy/apex_mcts.py`
- `gin_rummy/apex_mcts_value.py`
- `gin_rummy/draw_search.py`
- `gin_rummy/value_model.py`
- `gin_rummy/pbs_features.py`
- new Python files under `gin_rummy/`
- new Python tests in the repo root
- analysis / data-generation / training scripts in the workspace root or a `tools/` subpath
- `benchmark.py`
- `test_apex.py`
- `test_regressions.py`
- `test_mcts.py`
- `test_value_model.py`
- `test_value_search.py`
- `EXECUTION_REPORT_53.md`

### Suggested New Files

You do not have to use exactly these names, but a structure in this spirit is expected if useful:

- `gin_rummy/action_features.py`
- `gin_rummy/draw_action_model.py`
- `gin_rummy/apex_mcts_action.py`
- `tools/generate_action_data.py`
- `train_action_model.py`
- `evaluate_action_model.py`
- `test_action_model.py`
- `models/draw_action_data.*`
- `models/draw_action_model.*`

### Conditionally Allowed

Only if required for the chosen path:

- a refreshed benchmark alias for the new experimental bot
- additional model artifacts or JSON summaries
- a small diagnostic script for counterfactual label quality

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- new CFR work
- more blind `ApexMCTSValue` tuning as the main task
- broad architecture churn
- benchmark methodology changes unless you discover a correctness bug and explain it explicitly

## Required Sequence

### 1. Lock the Baseline

Before doing any new learning work:

- preserve the exact shipped `ApexMCTS` behavior as the benchmark baseline
- do not mutate the shipped champion into the experiment
- if you create a new experimental bot, keep it clearly separate

Strong naming preference:

- `ApexMCTSAction`

### 2. Build an Action-Conditioned Draw Dataset

This sprint should focus specifically on **draw decisions**.

Each training example should come from a real draw state and should encode enough information to answer:

- is `take discard` better than `draw stock` here?

Preferred structure:

1. snapshot a draw-decision state from self-play
2. evaluate both actions from that same state
3. produce either:
   - a binary label: `take_better`
   - or a real-valued target: `action_delta`
   - or both

Strong default:

- paired examples or paired labels from the **same original state**

This paired structure matters more than absolute model size.

### 3. Generate Labels in a Way That Matches Intended Use

The labels must reflect draw-decision quality, not generic state quality.

Good default approaches:

- paired continuation rollouts from the same hidden world / sampled worlds
- a small Monte Carlo estimate of eventual game win rate for `take` and for `stock`
- target = `P(win | take) - P(win | stock)` or binary `take_better`

You do not need a perfect solver-grade target in this sprint.
You do need a target that is clearly more aligned than the Phase 51/52 state-value labels.

If full-game paired continuations are too expensive, use a tractable approximation, but explain it explicitly and honestly.

### 4. Reuse Existing Features Only If They Are Actually Appropriate

You may reuse the existing PBS features if they help, but do not assume they are sufficient unchanged.

The action-conditioned model likely needs explicit draw-decision context, such as:

- the candidate discard-pile card identity
- whether that card completes or extends a meld
- immediate deadwood swing if taken
- information-reveal proxy features
- phase / score context

If you keep the feature set small and focused, that is a plus.

### 5. Compare Against Meaningful Offline Baselines

This is not a generic classification sprint.

You must compare the learned model against meaningful draw baselines, such as:

- Apex's draw heuristic
- deadwood-improvement heuristic
- the current `ApexMCTS` search answer on the same sampled states, if feasible

At minimum report decision-quality metrics like:

- held-out decision accuracy
- regret or average missed EV versus the target label
- calibration if you model probabilities
- baseline vs learned comparison

The learned model must beat a simple baseline on held-out draw decisions to justify gameplay integration.

### 6. Gameplay Integration Is Optional and Must Be Earned

Only if the offline results are clearly positive should you integrate the action-conditioned model into gameplay.

Preferred conservative integration ideas:

- use the model as a prior for the draw search
- use it to resolve close calls
- use it to decide when full Monte Carlo search is needed

Avoid for this sprint:

- replacing `ApexMCTS` wholesale
- trusting the model everywhere
- discarding the proven search stack without strong evidence

If offline results are not clearly positive, stop at foundation-only and report honestly.

### 7. Add Focused Tests

Add tests for the new path, including as appropriate:

- dataset generation shape / schema
- paired-label integrity
- feature encoding determinism
- model save/load
- baseline-vs-model evaluation pipeline
- gameplay legality and completion if integration happens

### 8. Benchmark Honestly

Run and record these commands unless you discover a correctness reason to change them and explain it explicitly:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_mcts.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_value_model.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_value_search.py
```

If you add a new test file, also run it explicitly.

If you build the action-conditioned dataset / model pipeline, run and report the exact commands, for example:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' tools/generate_action_data.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' train_action_model.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' evaluate_action_model.py
```

If gameplay integration happens, run quick screening benchmarks first:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSAction,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSAction,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress
```

If and only if those are promising, then run direct head-to-head probes:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSAction,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSAction,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

Only if those head-to-head probes are genuinely promising should you escalate to a 500-deal duplicate probe.

## Benchmark Gates

Your result is acceptable only if all of the following are true:

1. `test_apex.py` passes in full.
2. `test_regressions.py` passes in full.
3. `test_mcts.py` passes in full.
4. `test_value_model.py` passes in full.
5. `test_value_search.py` passes in full.
6. any new tests pass in full.
7. the action-conditioned dataset / evaluation pipeline completes successfully, or the report explains honestly why it failed.
8. if gameplay integration happens, the experimental bot completes duplicate benchmarks without hangs or illegal behavior.
9. no ship decision is made from small-sample noise alone.

## Acceptance Criteria

This task is complete only if all of the following are true:

- the draw decision was modeled directly rather than indirectly through generic state value
- a reproducible action-conditioned dataset was created
- a learned draw-action model was trained and evaluated against offline baselines
- gameplay integration happened only if the offline evidence justified it
- the report clearly states whether the outcome is:
  - foundation-only failure
  - experimental-only positive signal
  - or ship-worthy challenger
- `EXECUTION_REPORT_53.md` is saved to the workspace root with honest numbers

## Deliverable Expectation

Directive 52 answered an important question:

- a safe state-value supplement is possible
- but it does not yet buy strength

Directive 53 should answer the next one:

- if the model is trained on the draw action itself, does it finally produce useful decision signal?

If yes, that becomes the first learned model aligned to the engine's most important remaining tactical surface.
If no, that is still valuable, because it means the next oracle-track push should likely move toward discard-stage action modeling, richer data, or a critical-situations benchmark rather than more draw-model iteration.

Either outcome is acceptable.
Unclear evidence is not.
