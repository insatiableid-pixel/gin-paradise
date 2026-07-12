# Claude Directive 48: Hybrid CFR Successor Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_48.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - why CFR was chosen over more heuristic work and over AlphaZero/MCTS for this sprint
   - the exact abstraction used for information sets and actions
   - exact files changed
   - exact training commands run
   - exact benchmark commands run
   - before/after benchmark tables
   - tests run
   - shipped outcome vs experimental-only outcome
   - rejected variants and why they were rejected
   - unresolved risks
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, any trained artifact needed for the chosen path, and `EXECUTION_REPORT_48.md` are all finished.

## Current State

The project is again split into two realities:

- The web platform remains in a strong state and is not the priority here.
  - `PROJECT_STATUS.md` still reflects the Directive 45 web baseline.
  - Do not spend this sprint on `gin-galaxy/`.
- The Python AI track has now completed the unblock phase.
  - `EXECUTION_REPORT_47.md` fixed the benchmark blocker in `gin_rummy/game.py` via `MAX_TURNS_PER_HAND`.
  - All six 120-game acceptance benchmarks now complete reliably.
  - Paths A and B from Directive 47 were implemented, benchmarked, and reverted after clear regression.
  - Apex remains the top shipped heuristic bot.

The key conclusion from `EXECUTION_REPORT_47.md` is no longer tentative:

1. the engine blocker is fixed
2. the benchmark path is reliable
3. lightweight heuristic tuning appears exhausted
4. the best next step is Path D: CFR-style strategy learning

## Primary Objective

Build the smallest honest CFR-style learning path that has a real chance to beat the current Apex baseline, benchmark it honestly, and ship it only if the evidence supports doing so.

This is not a scaffolding-only directive.

You must produce one of these two honest outcomes:

1. a benchmark-backed learned successor bot that is stronger than current Apex, or
2. a benchmark-backed experimental CFR path that does not yet beat Apex, plus a clear report showing what was learned and what the next training step should be

## Decision Rule

Use this decision rule explicitly:

1. preserve the engine unblock and the current Apex baseline
2. prefer Path D (CFR-style learning) over Path E (AlphaZero/MCTS) for this sprint
3. keep the first learned system tractable and benchmarkable
4. avoid broad, untrained infrastructure that cannot be evaluated honestly this turn
5. if the learned path loses, do not force a ship

## Recommended Problem Framing

Do not try to solve the entire imperfect-information game tree in one jump unless you can truly execute that well in this sprint.

The recommended default is a hybrid successor, for example `ApexCFR`, that:

- keeps Apex's current draw logic
- keeps Apex's current knock logic
- learns the discard policy first, because that is where the heuristic ceiling appears most likely
- falls back safely to Apex behavior for unseen states or unsupported cases

This is the preferred shape unless you find a clearly better tractable CFR framing and explain why.

## Scope

### Always Allowed

- `gin_rummy/apex.py`
- `gin_rummy/game.py` only if required for CFR integration or a correctness fix directly related to this work
- new Python files under `gin_rummy/`
- new Python tests in the repo root
- training or experiment scripts in the workspace root or a new `tools/` subpath
- lightweight strategy/model/config artifacts needed for the chosen path
- `test_apex.py`
- `test_regressions.py`
- `EXECUTION_REPORT_48.md`

### Suggested New Files

You do not have to use exactly these names, but a structure in this spirit is expected if useful:

- `gin_rummy/cfr_trainer.py`
- `gin_rummy/cfr_strategy.py`
- `gin_rummy/apex_cfr.py`
- `train_cfr.py`
- `test_cfr.py`
- `models/apex_cfr_strategy.json`

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- unrelated documentation churn
- changes to `benchmark.py` or `gin_rummy/benchmark.py` unless you find a correctness bug and explain it explicitly
- changes to other existing bot implementations unless a new derived bot file is the chosen path
- heavy dependency churn unless truly required and justified

Prefer standard library or already-available Python dependencies if possible.

## Required Sequence

### 1. Start From the Report 47 Baseline

Use `EXECUTION_REPORT_47.md` as the baseline source of truth for:

- engine reliability
- current Apex benchmark numbers
- the rejection of additional heuristic-only work

Do not spend this directive re-testing already-rejected heuristic ideas unless they are directly reused inside a CFR framing.

### 2. Design a Tractable CFR Abstraction

You must explicitly choose and document:

- the information set abstraction
- the action abstraction
- the fallback behavior for unseen states
- why this abstraction is tractable enough to train this sprint

Strong default guidance:

- info set features can include some combination of:
  - deadwood bucket
  - meld count
  - partial-meld count
  - isolated-high-card count
  - turn bucket
  - score-difference bucket
  - deck-remaining bucket
  - discard-pile depth bucket
  - lightweight opponent-danger bucket if available without exploding state size
- action space should stay bounded:
  - top-K legal discard candidates from Apex's existing pipeline, or
  - a small discard-class abstraction mapped back to legal cards

Do not create an abstraction so broad that you cannot actually train and benchmark it.

### 3. Implement the CFR Training and Inference Path

The implementation must be usable, not just structural.

At minimum:

- implement regret tracking and average-strategy persistence
- provide a deterministic save/load path for the learned strategy
- provide a runnable training script
- provide an inference path that can play full games legally
- provide a safe fallback to Apex behavior when the learned table has no useful coverage

If you create a hybrid bot, be explicit about which decisions are learned and which remain heuristic.

### 4. Add Focused Tests

Add tests that protect the learned path at the integration level, not just the file-import level.

At minimum, cover the most important properties of the chosen design, such as:

- learned policy loads successfully
- fallback behavior works when strategy coverage is missing
- chosen actions are legal
- the derived bot completes games without hanging
- deterministic behavior under fixed seed, where appropriate

### 5. Train Enough to Produce Meaningful Evidence

You must run a real training pass.

If the full intended training budget is too large, reduce the abstraction or training scope rather than shipping empty infrastructure.

Acceptable examples:

- discard-only CFR with enough iterations to produce a nontrivial policy table
- hybrid self-play training against Apex
- curriculum or sampled-state training if justified

Unacceptable example:

- untrained code plus a promise that real results would come later

### 6. Benchmark Honestly

After training, benchmark the learned path honestly against the current field.

Use these commands unless you discover a correctness reason to change them and explain it explicitly:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_cfr.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' train_cfr.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexCFR,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexCFR,Apex --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexCFR,Apex --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexCFR,Nexus --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexCFR,Nexus --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

If you choose a different bot name, keep the benchmark structure the same and explain the rename.

If `test_cfr.py` is not the exact filename you use, run the equivalent new learned-path test file and explain the difference.

### 7. Ship Only What the Benchmarks Support

If the learned successor is clearly stronger, you may ship it.

If it is not clearly stronger:

- keep Apex as the shipped champion
- leave the learned path clearly experimental or revert it
- make the report honest about what improved, what failed, and what the next training step should be

## Benchmark Gates

Your result is acceptable only if all of the following are true:

1. `test_apex.py` passes in full.
2. `test_regressions.py` passes in full.
3. all new learned-path tests pass.
4. the training run completes and produces a usable learned artifact or table.
5. the quick 40-game round robin completes without hanging.
6. if you ship a new learned bot as the successor, it must finish as top Elo in the 40-game round robin among `ApexCFR`, `Apex`, `Nexus`, `DeepKnock`, and `Heisenbot`.
7. if you ship a new learned bot as the successor, its combined head-to-head win rate versus Apex across the two 120-game seeds must be above 50%.
8. if you ship a new learned bot as the successor, its combined win rate versus Nexus across the two 120-game seeds must not be worse than current Apex's Report 47 baseline unless the report makes a very strong overall-case argument.

## Acceptance Criteria

This task is complete only if all of the following are true:

- a real CFR-style learning path was implemented and exercised
- the chosen abstraction is documented clearly in `EXECUTION_REPORT_48.md`
- training was actually run, not just scaffolded
- benchmarks were actually run
- the report clearly states whether a new bot was shipped or the work remains experimental
- any regressive shipped-path idea is removed rather than left in place ambiguously
- `EXECUTION_REPORT_48.md` is saved to the workspace root with honest numbers

## Deliverable Expectation

Directive 47 established that heuristic-level Apex work is tapped out.

Directive 48 should be the first serious move up the ladder:

- not broader than necessary
- not emptier than necessary
- and honest enough that a no-ship experimental result is still useful if the CFR path does not yet clear the benchmark gates
