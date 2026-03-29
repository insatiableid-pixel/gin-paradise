# Claude Directive 46: Apex-Only Strength Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_46.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - exact files changed
   - paper-backed hypotheses considered
   - exact benchmark commands run
   - before/after benchmark tables
   - tests run
   - rejected ideas and why they were rejected
   - unresolved risks
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, and `EXECUTION_REPORT_46.md` are all finished.

## Current State

Apex is the current practical champion in this repo.

Current verified baseline on March 15, 2026:

- `test_apex.py`: 29/29 passing
- Quick duplicate-hand round robin:
  - `Apex` Elo: `1560.47`
  - `Apex vs Nexus`: `56.25%` over 80 games
  - `Apex vs DeepKnock`: `62.50%` over 80 games
  - `Apex vs Heisenbot`: `60.00%` over 80 games

Relevant prior larger benchmark context from `apex_v2_execution_report.md`:

- `Apex vs Nexus`: `58.0%`
- `Apex vs DeepKnock`: `57.4%`
- `Apex vs Heisenbot`: `61.0%`
- `Apex vs Titan`: partial `~57%`, with known degenerate-seed hang risk

This means the next step is not broad product work. The next step is a narrow, benchmark-driven attempt to make `Apex` stronger without touching unrelated systems.

## Your Next Task

Improve `Apex` only.

The goal is to make the strongest bot stronger while leaving the rest of the project alone.

## Hard Scope Lock

Allowed code edits:

- `gin_rummy/apex.py`
- `test_apex.py`
- `EXECUTION_REPORT_46.md`

Read-only references:

- `benchmark.py`
- `gin_rummy/benchmark.py`
- other bot implementations such as `nexus.py`, `deepknock.py`, and `heisenbot.py`
- prior Apex reports
- the attached PDFs

Forbidden edits:

- any frontend or `gin-galaxy/` file
- any server or product file
- any shared engine file outside `gin_rummy/apex.py`
- any other bot implementation
- any benchmark harness code
- any new dependency, training pipeline, model artifact, or dataset

If you believe the best improvement requires editing anything outside `gin_rummy/apex.py` and `test_apex.py`, do not expand scope. Stop, document the blocker, and leave the rest of the repo untouched.

## Primary Objective

Raise Apex's measured strength under the existing duplicate-hand benchmark methodology, with special priority on `Apex vs Nexus`, while avoiding regressions against `DeepKnock` and `Heisenbot`.

## Source Packet You Must Use

Use the attached papers as hypothesis generators, not as cargo-cult templates:

1. `17823-Article Text-21317-1-2-20210518.pdf`
   - Heisenbot paper: separate draw, discard, and knock policies; early-triangle logic; always-value Aces/Twos; benchmark policy variants empirically.
2. `17825-Article Text-21319-1-2-20210518.pdf`
   - Card fitness paper: discard quality should combine future deadwood, opponent utility, and meld contribution rather than a single heuristic dimension.
3. `17826-Article Text-21320-1-2-20210518.pdf`
   - Opponent modeling and myopic meld distance: "almost-meld" structure matters; opponent-aware evaluation matters; SIGRA dominated all other variants in their study.
4. `17830-Article Text-21324-1-2-20210518.pdf`
   - Random-forest opponent estimation: better opponent hand inference materially improves play, even with simple surrounding heuristics.
5. `17834-Article Text-21328-1-2-20210518.pdf`
   - Expert-knowledge tuning: threshold choices matter; grid search beat intuition; holding pair-like structures too long caused a meaningful drop.
6. `17838-Article Text-21332-1-2-20210518.pdf`
   - DNN hand estimation plus heuristic play: expected-utility draw/discard evaluation improved win rate, but the broad lesson is to use opponent probabilities and hand utility, not to add heavyweight ML here.

Do not blindly copy weaker agents' policies into Apex. Use paper ideas only if they survive the benchmark gates below.

## Required Workflow

### 1. Record the Baseline First

Before changing code, run and record these exact commands:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,Nexus --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,Nexus --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,DeepKnock --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,DeepKnock --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,Heisenbot --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players Apex,Heisenbot --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

Do not change the commands, seeds, or benchmark harness.

### 2. Pick a Small Number of Paper-Backed Hypotheses

Do not implement a grab bag of unrelated tweaks.

Pick at most 1 to 3 tightly related hypotheses from the source packet, such as:

- better discard tie-breaking using card fitness and almost-meld structure
- more opponent-aware discard danger estimation inside Apex
- turn-sensitive or stock-sensitive parameter tuning inside Apex
- more explicit hand-utility scoring for draw/discard choices

### 3. Keep the Improvement Local to Apex

If a new helper is needed, keep it inside `gin_rummy/apex.py`.

Do not edit `opponent_model.py`, `meld.py`, `game.py`, or any shared benchmark code.

### 4. Add Regression Coverage

Every behavior change must come with targeted `test_apex.py` coverage.

The tests should prove the intended decision shift, not just exercise lines.

### 5. Benchmark After Each Coherent Change Set

Do not stack several unverified ideas and only benchmark at the end.

Use the same commands before and after so the comparison is honest.

### 6. Revert Weak Ideas

If an idea is source-backed but loses on the benchmark, remove it.

This task is about measured strength, not paper compliance.

## Benchmark Gates

Your change is acceptable only if all of the following are true:

1. `test_apex.py` still passes in full.
2. In the quick 40-deal round robin, `Apex` remains the top Elo bot among `Apex`, `Nexus`, `DeepKnock`, and `Heisenbot`.
3. Across the six acceptance benchmark runs above:
   - combined total wins for `Apex` across all three matchups must improve over the recorded baseline
   - `Apex vs Nexus` must not regress in combined win rate
   - `Apex vs DeepKnock` must not regress by more than 1.0 percentage point
   - `Apex vs Heisenbot` must not regress by more than 1.0 percentage point

If those conditions are not met, do not keep the change.

## Implementation Guidance

- Favor low-cost heuristics over expensive search.
- Preserve the current public behavior shape unless the new version benchmarks better.
- Treat discard quality as the most likely high-leverage area unless the measured results say otherwise.
- Use the card-fitness and almost-meld papers to improve utility estimation, not to justify arbitrary complexity.
- Use the opponent-estimation papers to sharpen discard danger and action valuation, but do it locally inside Apex.
- Use the expert-tuning paper as permission to run a small, disciplined constant sweep inside Apex. If you do this, report the grid and results exactly.
- Do not introduce CFR, neural networks, random-forest training, or new offline data generation in this sprint.
- Do not chase Titan in the acceptance gate. Titan has a known degenerate benchmark issue and is not worth widening scope for here.

## Non-Goals for This Pass

- No web-app work
- No replay or coaching work
- No benchmark harness rewrite
- No changes to other bots
- No shared-engine refactor
- No new ML system
- No dependency installation or new artifact generation

## Acceptance Criteria

This task is complete only if all of the following are true:

- only `gin_rummy/apex.py`, `test_apex.py`, and `EXECUTION_REPORT_46.md` are changed
- the attached papers are used as explicit hypothesis inputs
- Apex-side regression tests pass
- the exact before/after benchmark commands are run and reported
- the benchmark gates above are satisfied
- weak or regressive hypotheses are removed rather than left in place
- `EXECUTION_REPORT_46.md` is saved to the workspace root with honest before/after numbers

## Deliverable Expectation

Deliver one disciplined Apex-only improvement pass next.

If the papers do not yield a benchmark-positive change within this scope lock, the correct outcome is an honest report and no broader repo churn.
