# Claude Directive 56: Knock Ablation Validation Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_56.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - why this validation path was chosen before final promotion
   - exact files changed
   - exact commands run
   - ablation bot definitions
   - targeted knock-scenario definitions
   - benchmark tables
   - knock-frequency / gin / undercut diagnostics
   - score / deck / clinch slice diagnostics
   - tests run
   - promotion decision
   - rejected variants and why they were rejected
   - unresolved risks
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, any produced artifact needed for the chosen path, and `EXECUTION_REPORT_56.md` are all finished.

## Current State

The current Python AI position is now at an important decision point:

- `EXECUTION_REPORT_49.md` shipped `ApexMCTS` as the current champion.
- Reports 51–54 showed that learned models for draw and discard did not translate into gameplay gains.
- `EXECUTION_REPORT_55.md` is the first strong positive learned result:
  - `ApexMCTSKnock` beat `ApexMCTS` by **64.70% over 1,000 seat-balanced games**
  - the undercut asymmetry was enormous
  - the report concluded it was ship-worthy

But Report 55 also leaves three unresolved interpretation risks:

1. the learned knock model's offline accuracy advantage over the `go_gin` baseline is tiny
2. the dataset says knocking is correct only ~4.2% of legal knock states
3. the current comparison set may still be too weak, because a bot can be "simple" while still handling obvious dominant actions like:
   - gin always knocks
   - legal non-gin knock that immediately wins the game
   - low-stock forced or near-forced knock situations

That must be validated before final promotion.

## Primary Objective

Determine whether the Phase 55 breakthrough is:

1. a genuine learned-model advantage
2. mostly a simpler knock-ablation effect like `go gin` / `rarely knock`
3. mostly an "obvious match-equity rules" correction
4. or a combination of the above

The goal of Phase 56 is to validate the mechanism honestly and then make the right promotion decision.

## Core Principles

Use these principles explicitly:

1. Treat `ApexMCTSKnock` as a **provisional** champion candidate, not yet final.
2. The next step is not more model tuning; it is **mechanism validation**.
3. The learned model should only be credited if it clearly beats simple knock policies that preserve the same draw/discard engine **and** already include obvious dominant-action rules.
4. "Go gin" alone is not a sufficient ablation, because it may fail trivial score-clinch cases.
5. If a simpler policy matches the gain, report that honestly and do not overclaim the learned model.
6. If the learned model still wins after strong ablation testing, promote it confidently.

## Why This Path Was Chosen

Report 55 is the best result in the whole learned-model series, but it has a specific interpretation risk:

- `go_gin` already achieved nearly the same offline accuracy as the learned model
- most legal knock states in the dataset were labeled `continue`
- so the dramatic gameplay improvement could come from **patience itself**, not from the learned model's nuance
- and some of the learned edge could come from obvious match-equity or stock-depth handling rather than deeper knock judgment

That makes the next question very sharp:

- does the learned knock model beat a simpler `ApexMCTS + strong obvious-rule knock policy` ablation?

Until that is answered, promotion should remain provisional.

## Scope

### Always Allowed

- `gin_rummy/apex_mcts_knock.py`
- `gin_rummy/knock_action_model.py`
- `gin_rummy/knock_features.py`
- `gin_rummy/apex_mcts.py`
- new Python files under `gin_rummy/`
- new Python tests in the repo root
- `benchmark.py`
- `test_apex.py`
- `test_regressions.py`
- `test_mcts.py`
- `test_value_model.py`
- `test_value_search.py`
- `test_action_model.py`
- `test_discard_model.py`
- `test_knock_model.py`
- `EXECUTION_REPORT_56.md`

### Suggested New Files

You do not have to use exactly these names, but a structure in this spirit is expected if useful:

- `gin_rummy/apex_mcts_gogin.py`
- `gin_rummy/apex_mcts_clinch_gogin.py`
- `gin_rummy/apex_mcts_firstknock.py`
- `gin_rummy/apex_mcts_paperknock.py`
- `test_knock_ablation.py`
- `test_knock_scenarios.py`

### Conditionally Allowed

Only if required for the chosen path:

- one or two additional diagnostic scripts for knock-frequency analysis
- one or two scenario-analysis scripts for targeted knock-state reporting
- a refreshed benchmark alias list for ablation bots

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- more knock-model training or threshold tuning as the main task
- new draw/discard model work
- broad architecture churn
- benchmark methodology changes unless you discover a correctness bug and explain it explicitly

## Required Sequence

### 1. Freeze the Report 55 Candidate

Before changing anything:

- preserve the exact Report 55 `ApexMCTSKnock` behavior as the provisional candidate
- do not tune the model, thresholds, or features in this sprint unless validation reveals a correctness bug

### 2. Build Stronger Simple Knock Ablations

Create simple ablation bots that keep `ApexMCTS` draw and discard logic unchanged while changing only the knock policy.

At minimum, create:

- `ApexMCTSGoGin`
  - gin always knocks
  - otherwise never knock

- `ApexMCTSClinchGoGin`
  - gin always knocks
  - non-gin legal knock knocks if it immediately wins the game
  - low-stock legal knock may also knock if you judge that preserving the current engine's low-stock override is necessary for a fair baseline, but if you do this you must say so explicitly
  - otherwise never knock

Strongly preferred additional ablations:

- `ApexMCTSFirstKnock`
  - knock at the first legal opportunity
- `ApexMCTSPaperKnock`
  - a lightweight paper-inspired rule if practical
- `ApexMCTSClinchPaper`
  - paper-style hold logic, but never misses an immediate game-clinching legal knock

The purpose is not to make them strong.
The purpose is to isolate whether the gain is coming from:

- the learned model
- simple patience
- or obvious score/deck exceptions

### 3. Add Targeted Knock Scenario Coverage

This is required. Do not rely only on aggregate H2H results.

Create focused tests or diagnostics for canonical knock situations, including at minimum:

1. **Immediate clinch**
   - legal non-gin knock that immediately reaches the target score
2. **Gin-only clinch**
   - knock does not win, but gin would
3. **Low-stock legal knock**
   - legal knock with `deck_remaining <= 8`
4. **Early live hand hold**
   - early turn, few deadwood cards, good gin liveness
5. **Risky undercut zone**
   - DW 7-10 with real undercut exposure
6. **Large score-gap hold**
   - clearly ahead or behind with a live hand

You do not need an enormous scenario suite.
But you do need enough coverage to answer whether the policy handles obvious and high-leverage knock states sensibly.

### 4. Add Knock Mechanism Diagnostics

For every knock-policy bot tested, report:

- knock opportunities seen
- knock decisions taken
- knock rate
- gin rate
- undercut rate
- average points scored when knocking
- average points conceded when undercut

Also report sliced diagnostics for at least these buckets:

- `knock_wins_game = 1` vs `0`
- `gin_wins_game = 1` vs `0`
- `deck_remaining <= 8` vs `> 8`
- early / mid / late turn buckets
- score gap buckets
- deadwood buckets

If practical, also report gin-liveness buckets and learned-model average `P(knock)` within those slices.

This is necessary to explain the mechanism, not just the result.

### 5. Benchmark the Right Comparisons

The key benchmarks are:

1. `ApexMCTSGoGin` vs `ApexMCTS`
2. `ApexMCTSClinchGoGin` vs `ApexMCTS`
3. `ApexMCTSKnock` vs `ApexMCTSGoGin`
4. `ApexMCTSKnock` vs `ApexMCTSClinchGoGin`
5. `ApexMCTSKnock` vs `ApexMCTS`

If you add more ablations, benchmark them too, but these are the core acceptance matchups.

### 6. Make the Promotion Decision Based on Strong Ablations

Use this promotion logic:

- if `ApexMCTSKnock` clearly beats `ApexMCTSClinchGoGin`, then the learned model itself adds value beyond simple patience and obvious score handling
- if `ApexMCTSClinchGoGin` matches most of the gain against `ApexMCTS`, then the breakthrough is primarily a simple knock-policy discovery
- if a simpler policy actually outperforms the learned model, report that honestly and prefer the simpler champion
- if the learned model wins overall but fails obvious scenario checks, do not promote it without explicitly naming that risk

This sprint is complete only when that distinction is clear.

### 7. Add Focused Tests

Add tests for the ablation bots and the scenario coverage, including as appropriate:

- legality and completion
- expected knock behavior in trivial cases
- immediate-clinch non-gin cases
- low-stock cases
- benchmark factory registration if needed

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
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_knock_model.py
```

If you add new test files, also run them explicitly.

Then run ablation screening benchmarks, for example:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSClinchGoGin,ApexMCTSGoGin,ApexMCTS,Apex,DeepKnock,Nexus,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSClinchGoGin,ApexMCTSGoGin,ApexMCTS,Apex,DeepKnock,Nexus,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress
```

Then run direct head-to-head probes:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSGoGin,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSGoGin,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSClinchGoGin,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSClinchGoGin,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSGoGin --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSGoGin --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSClinchGoGin --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSKnock,ApexMCTSClinchGoGin --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

Only if the learned model still looks meaningfully better should you run a high-power duplicate probe between:

- `ApexMCTSKnock`
- and the strongest simple ablation

That strongest simple ablation should usually be `ApexMCTSClinchGoGin` unless the evidence says otherwise.

## Benchmark Gates

Your result is acceptable only if all of the following are true:

1. all existing required Python tests pass
2. any new ablation and scenario tests pass
3. the ablation bots complete duplicate benchmarks without hangs or illegal behavior
4. the report makes it clear whether the learned model itself adds value beyond:
   - simple patience
   - obvious score-clinch logic
   - low-stock exceptions
5. no promotion decision is made from small-sample noise alone

## Acceptance Criteria

This task is complete only if all of the following are true:

- simple knock ablations were implemented
- at least one stronger score-aware simple ablation was implemented
- `ApexMCTSKnock` was benchmarked against them directly
- targeted knock scenarios were tested or reported explicitly
- knock-frequency / gin / undercut diagnostics were reported
- score / deck / clinch slice diagnostics were reported
- the report makes a clear promotion decision:
  - learned model confirmed
  - simpler ablation preferred
  - or unresolved / not enough evidence
- `EXECUTION_REPORT_56.md` is saved to the workspace root with honest numbers

## Deliverable Expectation

Report 55 may be the first true learned breakthrough in the engine.
But before we lock that in, Phase 56 should answer the harder and more honest question:

- did the learned knock model discover something more nuanced than `go gin` plus obvious match-equity exceptions, or did it mainly discover that knocking much less is already enough to crush `ApexMCTS`?

If the learned model survives that test, promote it confidently.
If not, ship the simpler truth.

Either outcome is acceptable.
Unclear evidence is not.
