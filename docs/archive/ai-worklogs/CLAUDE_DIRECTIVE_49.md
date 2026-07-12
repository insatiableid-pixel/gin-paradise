# Claude Directive 49: Non-CFR Upstream Search Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_49.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - why a non-CFR path was chosen
   - exact files changed
   - exact search, training, or evaluation commands run
   - exact benchmark commands run
   - before/after benchmark tables
   - tests run
   - shipped outcome vs experimental-only outcome
   - rejected variants and why they were rejected
   - unresolved risks
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, any model/artifact needed for the chosen path, and `EXECUTION_REPORT_49.md` are all finished.

## Current State

The current Python AI situation is now materially clearer than it was when the original Phase 49 handoff was written:

- `EXECUTION_REPORT_47.md` fixed the engine blocker and restored reliable benchmark execution.
- `EXECUTION_REPORT_48.md` gave the discard-only CFR path a fair test.
- The high-power 1,000-game duplicate probe in Report 48 resolved the ambiguity:
  - ApexCFR scored 50.20% vs Apex at target 150
  - the earlier 51.25% result was noise
  - discard-only CFR under the top-3-Apex action space does not beat Apex

Treat that result as closed.

**Do not spend this directive on more CFR work.**

The discard-CFR path converges back toward Apex and is no longer the best use of time.

## Primary Objective

Pursue the best non-CFR upstream improvement path that can plausibly produce decisions Apex does not already make, benchmark it honestly, and ship it only if the evidence supports doing so.

## Decision Rule

Use this decision rule explicitly:

1. discard-only CFR is closed and should not be extended
2. the next path must be non-CFR
3. prioritize decision surfaces where Apex is least likely to already be optimal
4. prefer a tractable search-based path before committing to heavy neural infrastructure
5. if a non-CFR prototype does not clear benchmarks honestly, do not force a ship

## Recommended Path

The recommended default is a hybrid search bot, for example `ApexMCTS`, that:

- keeps Apex's current discard logic
- keeps Apex's current knock logic
- focuses search on the draw decision first
- uses the existing opponent model to sample hidden information
- uses capped information-set MCTS or another honest non-CFR search method to decide:
  - take the discard pile card, or
  - draw from stock

This is the preferred shape because Report 48 strongly suggests the remaining improvement surface is not discard selection itself, but the information-revealing choice around taking from the discard pile.

If you find a clearly better non-CFR path, you may choose it, but the report must explain why it was better than the recommended draw-search path.

## Scope

### Always Allowed

- `gin_rummy/apex.py`
- `gin_rummy/opponent_model.py`
- new Python files under `gin_rummy/`
- new Python tests in the repo root
- training or experiment scripts in the workspace root or a new `tools/` subpath
- lightweight model/config artifacts needed for the chosen path
- `benchmark.py`
- `test_apex.py`
- `test_regressions.py`
- `EXECUTION_REPORT_49.md`

### Suggested New Files

You do not have to use exactly these names, but a structure in this spirit is expected if useful:

- `gin_rummy/mcts.py`
- `gin_rummy/apex_mcts.py`
- `gin_rummy/search_state.py`
- `test_mcts.py`

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- unrelated documentation churn
- new CFR work
- expanding discard-CFR beyond cleanup or compatibility fixes
- changing benchmark methodology unless you find a correctness bug and explain it explicitly
- heavy dependency churn unless absolutely required and honestly justified

## Required Sequence

### 1. Start From the Negative Result

Use `EXECUTION_REPORT_48.md` as the baseline source of truth.

The point of this directive is not to rescue discard-CFR.
The point is to move to a path that can generate non-Apex behavior.

### 2. Choose and Document the Non-CFR Search Path

You must explicitly document:

- which decision surface is being searched
- what hidden information is sampled
- what the search budget is
- what evaluation function is used
- what fallback behavior is used when search is skipped or inconclusive

Strong default guidance:

- search the draw decision only
- sample opponent hands from the existing opponent model
- use short capped rollouts or shallow tree search with Apex behavior as the default policy
- keep the action space tiny and high-signal

Do not overbuild.
You are trying to find a real strength gain, not build a research framework for its own sake.

### 3. Implement a Benchmarkable Derived Bot

The derived bot must be able to play full legal games and must be benchmarkable through `benchmark.py`.

If you implement `ApexMCTS`, the expected default behavior is:

- search or evaluate `draw_decision`
- after that, let Apex handle discard and knock
- fall back safely to Apex when search coverage or time budget is insufficient

If you choose a different non-CFR path, keep the same spirit: one clear decision surface, benchmarkable in this sprint.

### 4. Add Focused Tests

Add integration-level protection for the new path.

At minimum, cover:

- legal decisions under search
- fallback behavior
- deterministic behavior under fixed seed when search randomness is seeded
- game completion across multiple seeds
- any critical helper logic introduced for search

### 5. Run Honest Benchmarks

Run and record these commands unless you discover a correctness reason to change them and explain it explicitly:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_mcts.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTS,Apex --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTS,Apex --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTS,Nexus --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTS,Nexus --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTS,Apex --games 500 --target 150 --seed 20260305 --show-matchups --no-progress
```

If you choose a different bot name, keep the benchmark structure the same and explain the rename.

If `test_mcts.py` is not the exact filename you use, run the equivalent new test file and explain the difference.

### 6. Ship Only if the High-Power Probe Supports It

Do not repeat the mistake of trusting small-sample noise.

If the 40-game or 120-game results look good but the 500-deal duplicate probe collapses back to ~50%, do not ship.

If the high-power probe holds up, you may ship.

## Benchmark Gates

Your result is acceptable only if all of the following are true:

1. `test_apex.py` passes in full.
2. `test_regressions.py` passes in full.
3. all new non-CFR tests pass.
4. the quick round robins complete without hanging.
5. the 120-game head-to-head acceptance runs complete without hanging.
6. the 500-deal duplicate probe versus Apex completes without hanging.
7. if you ship the new bot, the 500-deal duplicate probe versus Apex must show a real edge, not a coin-flip result.
8. if you ship the new bot, its performance versus Nexus must not materially regress.
9. if you do not ship, the report must state clearly whether the failure was due to search quality, rollout evaluation, runtime budget, or lack of genuine edge.

## Acceptance Criteria

This task is complete only if all of the following are true:

- a real non-CFR upstream path was implemented and exercised
- the chosen search method is documented clearly in `EXECUTION_REPORT_49.md`
- benchmarks were actually run
- the report clearly states whether a new bot was shipped or remains experimental
- any regressive idea is removed rather than left ambiguously in place
- `EXECUTION_REPORT_49.md` is saved to the workspace root with honest numbers

## Deliverable Expectation

Directive 48 ruled out discard-only CFR.

Directive 49 should move up a level and test whether a non-CFR search path can create genuinely new behavior where Apex still has room to improve.

A clean negative result is acceptable.
Another ambiguous small-sample "maybe" result is not.
