# Claude Directive 47: Unblock Benchmarking and Pursue the Highest-Upstream Apex Upgrade

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_47.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - exact files changed
   - root cause of the benchmark blocker
   - approaches considered and why
   - exact benchmark and training commands run
   - before/after benchmark tables
   - tests run
   - rejected approaches and why they were rejected
   - unresolved risks
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, and `EXECUTION_REPORT_47.md` are all finished.

## Current State

The project is split into two realities:

- The web platform is already in a very strong state.
  - `EXECUTION_REPORT_45.md` and `PROJECT_STATUS.md` show a fully green `1001`-test baseline.
  - Visual alignment across player-facing, fairness, and admin surfaces is complete.
- The Python AI side still has unfinished strategic work.
  - `EXECUTION_REPORT_46.md` confirmed Apex is still the practical champion.
  - The attempted paper-backed heuristic tweaks hit a ceiling or regressed.
  - The required 120-game acceptance benchmarks were blocked by degenerate hand loops in `gin_rummy/game.py`.

The conclusion is not "stop at the papers." The conclusion is:

1. first unblock honest benchmarking
2. then consider the strongest available Apex-improvement path, including approaches beyond the attached papers

## Your Next Task

Fix the engine-level benchmark blocker, then pursue the highest-upstream Apex improvement approach that is justified by the evidence.

You are explicitly **not** limited to paper-backed heuristic tweaks.

## Primary Objective

1. Make the Python benchmark path reliable by fixing the hand-loop blocker in `gin_rummy/game.py`.
2. After benchmarking is unblocked, choose the best next Apex-strengthening path from the full candidate set below.
3. Deliver the strongest benchmark-backed outcome you can honestly support in this sprint.

## Scope

### Always Allowed

- `gin_rummy/game.py`
- `gin_rummy/apex.py`
- `test_apex.py`
- `test_regressions.py`
- `EXECUTION_REPORT_47.md`

### Newly Allowed for Larger-Scope AI Work

If the best next step requires it, you may also create or edit:

- new Python files under `gin_rummy/`
- new Python test files in the repo root if needed
- training or experiment scripts in the workspace root or a new `tools/` subpath
- lightweight model/config artifacts needed for the chosen approach
- dependency declarations or setup notes needed for Python-side AI experimentation

Examples of now-allowed larger-scope work:

- `gin_rummy/cfr_trainer.py`
- `gin_rummy/cfr_strategy.py`
- `gin_rummy/apex_cfr.py`
- `gin_rummy/mcts.py`
- `gin_rummy/network.py`
- `gin_rummy/apex_alpha.py`
- `train_cfr.py`
- `train_alpha.py`

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- unrelated product documentation churn
- changes to benchmark methodology in `benchmark.py` or `gin_rummy/benchmark.py` unless absolutely required to fix a correctness bug
- changes to other existing bot implementations unless a new derived bot file is the chosen approach

If you widen scope beyond `apex.py` and `game.py`, the execution report must explain exactly why the wider approach was chosen over the narrower ones.

## Required Sequence

### 1. Fix the Engine-Level Benchmark Blocker First

`EXECUTION_REPORT_46.md` identified the blocker clearly: the game engine permits pathological draw/discard loops that can hang higher-sample benchmarks.

At minimum:

- investigate the hand loop in `gin_rummy/game.py`
- add a bounded deterministic safeguard such as `MAX_TURNS_PER_HAND` or an equivalent honest void-hand rule
- ensure the safeguard does not quietly corrupt ordinary gameplay
- add regression coverage that proves the guard works

This is mandatory, regardless of which Apex-improvement path you choose next.

### 2. Re-Run the Benchmark Path After the Guard

After the engine fix, run and record these commands:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,Nexus --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,Nexus --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,DeepKnock --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,DeepKnock --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,Heisenbot --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,Heisenbot --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

Do not change the seeds or acceptance benchmark commands unless you discover a correctness bug and explain it explicitly.

### 3. Then Choose the Best Improvement Path

After the benchmark path is reliable, you must consider the full candidate set below.

You are not required to implement all of them. You are required to choose the best path supported by evidence.

## Candidate Improvement Paths

### Path A: Rollout-Based Discard Evaluation

Use lightweight forward simulation to estimate future discard value rather than relying only on immediate deadwood.

### Path B: Opponent-Model Defensive Discard

Use the existing opponent model more directly when estimating the danger of feeding a discard to the opponent.

### Path C: Lookahead Knock EV

Compare knock-now EV versus wait-one-turn EV instead of relying only on current-turn EV.

### Path D: Deep CFR / CFR-Style Strategy Learning

If heuristic methods appear capped, you may create a larger-scope CFR training and inference path with new Python files, scripts, and supporting artifacts.

### Path E: AlphaZero-Style MCTS + Neural Network

If justified, you may create an MCTS plus neural network path, including new files, training scripts, and Python dependencies such as PyTorch.

This is a significantly larger research path, so if you choose it, the report must explain why it was worth preferring over the lighter-weight options.

## Decision Rule

Use this decision rule explicitly:

1. fix the engine blocker
2. verify that the blocked benchmarks now complete
3. evaluate the likely ROI of Paths A-E
4. choose the highest-value approach you can honestly execute in this sprint

You do not have to stay narrow if the narrow options look exhausted.
You do not have to go large if the narrow options still have clear headroom.

## Guidance on Larger-Scope Paths

If you choose Path D or Path E:

- you may add new Python files and dependencies
- you may add training scripts
- you may add setup notes for the dependency/runtime path
- you must still produce concrete verification, not just scaffolding
- you must benchmark the resulting approach honestly against the current Apex baseline

Do not claim a paradigm shift unless you actually train and test something meaningful.

## Benchmark Gates

Your final result is acceptable only if all of the following are true:

1. `test_apex.py` passes in full.
2. `test_regressions.py` passes in full.
3. The six 120-game acceptance benchmark runs complete without hanging.
4. In the quick 40-deal round robin, the strongest shipped bot remains top Elo among `Apex`, `Nexus`, `DeepKnock`, and `Heisenbot`.
5. If you ship an Apex-side or derived-bot strength change, it must be supported by benchmark evidence against the baseline from `EXECUTION_REPORT_46.md`.
6. `Apex vs Nexus` or the chosen successor bot's performance versus Nexus must not regress in combined win rate.
7. `Apex vs DeepKnock` and `Apex vs Heisenbot` or the chosen successor bot's performance versus those opponents must not regress by more than 1.0 percentage point unless the report explicitly justifies a strategic tradeoff with stronger overall gains.

## Acceptance Criteria

This task is complete only if all of the following are true:

- the engine-level loop/hang blocker is identified and addressed
- regression tests cover that blocker and pass
- the blocked 120-game acceptance benchmarks now complete
- the full approach set A-E is considered explicitly in the report
- the chosen improvement path is justified honestly
- any regressive idea is removed rather than left in place
- `EXECUTION_REPORT_47.md` is saved to the workspace root with honest numbers

## Deliverable Expectation

Complete the engine unblock first, then pursue the strongest realistic Apex-upgrade path available.

The papers are now only one input among several.
If heuristic work is exhausted, you are explicitly allowed to move up the ladder into rollout, CFR, or AlphaZero-style work as long as the execution remains honest and benchmarked.
