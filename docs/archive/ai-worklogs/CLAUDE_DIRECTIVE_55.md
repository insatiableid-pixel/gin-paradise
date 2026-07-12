# Claude Directive 55: Knock Liveness & Score Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_55.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - why this path was chosen over more draw/discard iteration
   - exact files changed
   - exact commands run
   - dataset design and schema
   - paired label-generation method
   - offline baseline vs learned-model comparison
   - decision-quality metrics
   - gameplay benchmark tables if integration happens
   - tests run
   - shipped outcome vs experimental-only outcome
   - rejected variants and why they were rejected
   - unresolved risks
   - recommended next step
   - explicit comparison to the main claims of `Knocking in the Game of Gin Rummy.pdf`
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, any produced artifact needed for the chosen path, and `EXECUTION_REPORT_55.md` are all finished.

## Current State

The current Python AI position is now quite coherent:

- `EXECUTION_REPORT_49.md` shipped `ApexMCTS` as the champion with a real high-power duplicate edge over `Apex`.
- `EXECUTION_REPORT_51.md` and `EXECUTION_REPORT_52.md` showed that state-value learning does not improve draw play in gameplay.
- `EXECUTION_REPORT_53.md` showed that even action-conditioned draw learning produces strong offline signal without gameplay improvement.
- `EXECUTION_REPORT_54.md` showed the same broad pattern on discard choice:
  - mixed or near-tied offline performance against Apex's discard heuristic
  - early gameplay signal around 45-46% versus `ApexMCTS`

The learned-model story from Reports 51-54 is now consistent:

- draw: no gameplay edge
- discard: no gameplay edge

That strongly suggests the next remaining high-leverage seam is **knocking**.

This also matches the earlier paper discussion:

- `Knocking in the Game of Gin Rummy.pdf` argues that knocking policy can be a larger performance separator than conventional wisdom suggests
- the paper especially emphasizes turn count, gin liveness, and knock/gin tradeoffs

## Primary Objective

Build the first action-conditioned learning path for the **knock decision**:

1. create a reproducible dataset of legal knock states with paired `knock now` vs `continue` labels
2. train and evaluate a learned model that predicts when knocking is better than continuing
3. explicitly model **liveness × score context**, not just deadwood
4. compare the learned model against meaningful offline knock baselines
5. only if the offline evidence is clearly positive, integrate it into a controlled experimental bot and benchmark it against unchanged `ApexMCTS`

## Decision Rule

Use this decision rule explicitly:

1. `ApexMCTS` remains the exact shipped champion baseline.
2. More draw/discard model iteration is not the main task for this sprint.
3. The new model should target the knock action directly, not generic state value.
4. Because legal knock states are much rarer than draw/discard states, prefer **higher-fidelity labels** over sheer dataset size.
5. If the knock model does not beat current knock baselines offline on held-out legal knock states, stop there and report honestly rather than forcing gameplay integration.

## Why This Path Was Chosen

The best available evidence points here:

- Reports 51-54 have now tested learned models on both draw and discard without producing a ship-worthy gameplay edge.
- By contrast, knocking is the one major decision surface that still plausibly has high leverage and has not yet been isolated with a learned action model.
- The attached paper argues that knock decisions are highly situational and that conventional wisdom over-discourages going for gin.
- Our current knock logic is already richer than a simple threshold policy, but it still does **not** explicitly represent all of the paper's central ideas, especially gin liveness / gin hits as first-class features.

So Phase 55 should answer the next sharper question:

- can a knock model that directly represents liveness, turn, score, and risk finally produce useful gameplay signal where draw/discard models did not?

That is the strongest next experiment.

## Scope

### Always Allowed

- `gin_rummy/apex.py`
- `gin_rummy/apex_mcts.py`
- `gin_rummy/deepknock.py`
- `gin_rummy/nexus.py`
- `gin_rummy/evaluator.py`
- new Python files under `gin_rummy/`
- new Python tests in the repo root
- analysis / data-generation / training scripts in the workspace root or a `tools/` subpath
- `benchmark.py`
- `test_apex.py`
- `test_regressions.py`
- `test_mcts.py`
- `test_value_model.py`
- `test_value_search.py`
- `test_action_model.py`
- `test_discard_model.py`
- `EXECUTION_REPORT_55.md`

### Suggested New Files

You do not have to use exactly these names, but a structure in this spirit is expected if useful:

- `gin_rummy/knock_features.py`
- `gin_rummy/knock_action_model.py`
- `gin_rummy/apex_mcts_knock.py`
- `tools/generate_knock_data.py`
- `train_knock_model.py`
- `evaluate_knock_model.py`
- `test_knock_model.py`
- `models/knock_action_data.*`
- `models/knock_action_model.*`

### Conditionally Allowed

Only if required for the chosen path:

- a refreshed benchmark alias for the experimental knock bot
- additional model artifacts or JSON summaries
- a small diagnostic script for gin-hit / liveness analysis

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- new draw-model or discard-model tuning as the main task
- broad architecture churn
- RL or self-play retraining programs that explode the scope
- benchmark methodology changes unless you discover a correctness bug and explain it explicitly

## Required Sequence

### 1. Lock the Baseline

Before doing any new learning work:

- preserve the exact shipped `ApexMCTS` draw search and discard pipeline as the benchmark baseline
- if you create a new experimental bot, only override the knock decision

Strong naming preference:

- `ApexMCTSKnock`

### 2. Build a Legal-Knock Dataset

This sprint should focus specifically on **legal knock states**, i.e. states where `deadwood <= 10` and the player is allowed to choose between:

- knock now
- continue playing

Strong default:

- include every legal knock opportunity encountered in self-play

If useful for paper comparison, also report a "first knock opportunity" subset separately, but the main dataset should not be limited to only first-opportunity states unless you have a strong reason.

### 3. Generate Paired Labels for `Knock` vs `Continue`

The labels must directly compare the two actions from the same state.

Preferred structure:

1. snapshot a legal knock state
2. evaluate `knock now`
3. evaluate `continue`
4. compute a target such as:
   - expected hand-point delta
   - expected game-win delta
   - or both

Because knock states are relatively rare, you should spend more compute per label than we did on draw/discard states if needed.

Strong default:

- `knock now`: score the hand immediately using sampled opponent hands / layoffs consistent with current public information
- `continue`: simulate the rest of the hand under a fixed continuation policy and estimate the resulting outcome

If feasible, prefer a label closer to **game equity** than pure deadwood proxy.
If not feasible, use expected hand-point delta and explain the limitation honestly.

### 4. Make Liveness a First-Class Feature

The user’s core claim should be taken seriously here:

- playing for gin depends on the liveness of the hand **and** the score

So the feature set should explicitly represent liveness.

Useful candidates include:

- deadwood total
- deadwood card count
- gin hits / gin rating
- one-turn gin potential
- number of melded cards, especially 6/8 versus 7/9 structure if meaningful
- turn number
- deck remaining
- score differential
- distance of each player to 100
- layoff risk / undercut risk proxies
- opponent development proxies from visible pickups and discard behavior

If you include interaction features or explicit derived features for `liveness × score`, that is encouraged.

### 5. Compare Against Meaningful Knock Baselines

You must compare the learned model against meaningful offline knock baselines, such as:

- current `ApexMCTS` / `Apex` knock policy
- first-knock baseline
- go-gin baseline
- a simple paper-inspired knock regression or rules baseline if practical

At minimum report decision-quality metrics like:

- action accuracy against the paired target
- average regret in expected points or equity
- calibration if you model probabilities
- breakdowns by:
  - gin liveness bucket
  - turn bucket
  - score state bucket

The learned model must beat a reasonable baseline on held-out knock states to justify gameplay integration.

### 6. Gameplay Integration Is Optional and Must Be Earned

Only if the offline knock results are clearly positive should you integrate the model into gameplay.

Preferred conservative integration ideas:

- keep gin as an always-knock rule
- keep any hard legality / stock-void safeguards
- use the model only for the genuine `knock now` versus `continue` choice

Avoid for this sprint:

- changing draw or discard logic at the same time
- trusting the model in obviously trivial states
- turning this into a full-engine rewrite

If offline results are not clearly positive, stop at foundation-only and report honestly.

### 7. Add Focused Tests

Add tests for the new path, including as appropriate:

- dataset generation shape / schema
- legal-knock state integrity
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
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_action_model.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_discard_model.py
```

If you add a new test file, also run it explicitly.

If you build the knock dataset / model pipeline, run and report the exact commands, for example:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' tools/generate_knock_data.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' train_knock_model.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' evaluate_knock_model.py
```

If gameplay integration happens, run quick screening benchmarks first:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress
```

If and only if those are promising, then run direct head-to-head probes:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

Only if those head-to-head probes are genuinely promising should you escalate to a 500-deal duplicate probe.

## Benchmark Gates

Your result is acceptable only if all of the following are true:

1. `test_apex.py` passes in full.
2. `test_regressions.py` passes in full.
3. `test_mcts.py` passes in full.
4. `test_value_model.py` passes in full.
5. `test_value_search.py` passes in full.
6. `test_action_model.py` passes in full.
7. `test_discard_model.py` passes in full.
8. any new tests pass in full.
9. the knock dataset / evaluation pipeline completes successfully, or the report explains honestly why it failed.
10. if gameplay integration happens, the experimental bot completes duplicate benchmarks without hangs or illegal behavior.
11. no ship decision is made from small-sample noise alone.

## Acceptance Criteria

This task is complete only if all of the following are true:

- the knock decision was modeled directly
- a reproducible legal-knock dataset was created
- the feature set explicitly represented liveness and score context
- a learned knock model was trained and evaluated against offline baselines
- gameplay integration happened only if the offline evidence justified it
- the report clearly states whether the outcome is:
  - foundation-only failure
  - experimental-only positive signal
  - or ship-worthy challenger
- `EXECUTION_REPORT_55.md` is saved to the workspace root with honest numbers

## Deliverable Expectation

Reports 51-54 together answered an important sequence of questions:

- draw learning did not move gameplay
- discard learning did not move gameplay

Directive 55 should answer the next one:

- when the model explicitly represents liveness, turn, score, and risk, does knock optimization finally produce meaningful engine strength?

If yes, that becomes the first learned model aimed at the most strategically expressive remaining decision surface.
If no, that is still valuable, because the next oracle-track push should likely move toward a critical-situations benchmark or deeper game-equity infrastructure rather than more local supervised policies.

Either outcome is acceptable.
Unclear evidence is not.
