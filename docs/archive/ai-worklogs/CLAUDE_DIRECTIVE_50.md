# Claude Directive 50: ApexMCTS Refinement Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_50.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - exact files changed
   - exact benchmark commands run
   - exact tuning or search commands run
   - the baseline ApexMCTS configuration from Report 49
   - the candidate refinement chosen and why
   - before/after benchmark tables
   - tests run
   - ship or no-ship decision and why
   - rejected refinements and why they were rejected
   - unresolved risks
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, and `EXECUTION_REPORT_50.md` are all finished.

## Current State

The project now has a new shipped Python champion:

- `EXECUTION_REPORT_49.md` established `ApexMCTS` as the new top bot.
- The decisive result was the 500-deal duplicate probe at target 150:
  - `ApexMCTS` beat `Apex` 56.80%
  - the full 95% CI was above 50%
- `test_mcts.py` now protects the non-CFR draw-search path.
- `benchmark.py` already supports `ApexMCTS`.

The old question of whether CFR can replace Apex is closed.
The new question is whether the first shipped `ApexMCTS` configuration can itself be improved honestly.

## Primary Objective

Attempt one disciplined step beyond the shipped `ApexMCTS` baseline by improving the quality of its draw-search evaluation, while preserving the ability to benchmark directly against the exact Report 49 champion.

## Decision Rule

Use this decision rule explicitly:

1. treat Report 49 `ApexMCTS` as the champion baseline
2. preserve a benchmarkable copy of that baseline while testing a refinement
3. choose the single highest-value refinement or tightly related refinement set you can honestly execute this sprint
4. avoid broad architecture churn or multi-branch research sprawl
5. only replace `ApexMCTS` if the refined candidate beats the Report 49 baseline with stronger evidence, not just noise

## Candidate Refinement Priorities

Prioritize from this list:

1. **Opponent-model-weighted worlds**
   - Replace uniform unseen-card shuffling with sampling biased by the opponent model's beliefs.
2. **Apex-quality rollouts**
   - Use stronger rollout policy than pure deadwood minimization.
3. **Turn-adaptive search parameters**
   - Make info penalty, override margin, or world count vary by game phase.
4. **Parameter tuning only**
   - If a clean sweep is the highest-value move, keep it narrow and report it honestly.

Do not jump to neural networks or revisit CFR in this directive.

## Scope

### Always Allowed

- `gin_rummy/apex_mcts.py`
- `gin_rummy/draw_search.py`
- new Python files under `gin_rummy/`
- new Python tests in the repo root
- tuning or experiment scripts in the workspace root or a new `tools/` subpath
- `benchmark.py`
- `test_apex.py`
- `test_regressions.py`
- `test_mcts.py`
- `EXECUTION_REPORT_50.md`

### Conditionally Allowed

Only if needed to preserve a clean benchmark baseline:

- a new derived bot file such as `gin_rummy/apex_mcts_v2.py`
- a second benchmark alias in `benchmark.py`

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- unrelated documentation churn
- new CFR work
- neural network work
- benchmark methodology changes unless you find a correctness bug and explain it explicitly

## Required Sequence

### 1. Lock the Baseline

Before refining anything, make sure the exact Report 49 `ApexMCTS` behavior remains benchmarkable.

If you edit `ApexMCTS` in place, you must preserve the old behavior under a separate bot name so the refined version can be compared directly to the shipped baseline.

### 2. Choose One Main Refinement Path

Pick the highest-value refinement from the priority list above.

If you combine multiple changes, they must be tightly related and justified as one coherent refinement path, not a grab bag.

Your report must explain why this path was chosen over the other listed options.

### 3. Add Focused Tests

Protect the refined search path with tests appropriate to the chosen refinement.

Examples:

- weighted world sampling respects opponent-model signals
- refined rollouts remain deterministic under fixed seed
- fallback behavior is preserved
- override statistics still look sane
- full games still complete across multiple seeds

### 4. Benchmark Against the Real Baseline

Run and record these commands unless you discover a correctness reason to change them and explain it explicitly:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_mcts.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,Apex --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,Apex --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,Nexus --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,Nexus --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSv2,ApexMCTS --games 500 --target 150 --seed 20260305 --show-matchups --no-progress
```

If you use a different candidate name, keep the benchmark structure the same and explain the rename.

### 5. Ship Only if the High-Power Probe Supports It

The Report 49 lesson still applies:

- small samples can flatter a candidate
- the high-power duplicate probe is the real gate

If the refined candidate looks good in the small runs but does not beat the Report 49 baseline in the 500-deal duplicate probe, do not replace the champion.

## Benchmark Gates

Your result is acceptable only if all of the following are true:

1. `test_apex.py` passes in full.
2. `test_regressions.py` passes in full.
3. `test_mcts.py` and any new refinement-specific tests pass in full.
4. the quick round robins complete without hanging.
5. the 120-game head-to-heads complete without hanging.
6. the 500-deal duplicate probe versus the Report 49 baseline completes without hanging.
7. if you ship the refined bot, it must beat the Report 49 `ApexMCTS` baseline in the 500-deal duplicate probe with a meaningful edge.
8. if you ship the refined bot, it must not regress materially versus Apex or Nexus.
9. if you do not ship, the report must clearly explain whether the best next move is more search-quality work, better world modeling, deeper rollouts, or a paradigm shift.

## Acceptance Criteria

This task is complete only if all of the following are true:

- the Report 49 baseline remained benchmarkable
- one honest refinement path was implemented and exercised
- benchmarks were actually run
- the report makes a clear ship/no-ship decision relative to `ApexMCTS`
- `EXECUTION_REPORT_50.md` is saved to the workspace root with honest numbers

## Deliverable Expectation

Directive 49 delivered a real breakthrough.
Directive 50 should determine whether that breakthrough can be sharpened further without losing rigor.

A clean "ApexMCTS is still the best version" outcome is acceptable.
A noisy overfit replacement is not.
