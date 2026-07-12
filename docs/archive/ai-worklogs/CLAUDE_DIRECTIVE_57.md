# Claude Directive 57: Robust Knock Policy Resolution Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_57.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - why this path was chosen
   - exact files changed
   - exact commands run
   - candidate policy definitions
   - evaluation methodology
   - self-play / mirror results
   - patient-field cross-play results
   - exploitative-field results
   - dominant-action scenario results
   - tests run
   - final recommendation
   - rejected variants and why they were rejected
   - unresolved risks
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, any produced artifact needed for the chosen path, and `EXECUTION_REPORT_57.md` are all finished.

## Current State

Phase 56 resolved the biggest open question:

- the learned `ApexMCTSKnock` model is **not** the source of the gain
- the gain came from a much simpler mechanism: **patience**
- patience policies like `ApexMCTSGoGin` and `ApexMCTSClinchGoGin` reproduced or exceeded the learned-model gain against `ApexMCTS`
- the learned model lost badly to `ApexMCTSGoGin`

However, the revised `EXECUTION_REPORT_56.md` also corrected the promotion logic:

- **no bot is promoted yet**
- `ApexMCTSGoGin` wins the completed H2Hs, but those results are strongly shaped by exploiting aggressive knockers
- `ApexMCTSGoGin` still misses obvious dominant actions such as immediate non-gin score-clinch knocks
- therefore Phase 56 did **not** identify the correct production policy; it only identified the mechanism

That is the Phase 57 problem.

## Primary Objective

Determine the strongest **robust** knock policy for the current engine.

The standard is no longer:

- "which bot punishes `ApexMCTS` the hardest?"

The standard is:

- "which bot is most defensible as the default production policy when the goal is maximizing match win probability in every spot?"

This means the base bot should aim to be:

1. difficult to exploit
2. sensible in self-play and strong-candidate cross-play
3. correct on dominant-action situations

Exploitative strength against weak/aggressive bots is still useful, but it is secondary.

## Core Principles

Use these principles explicitly:

1. Phase 56 already answered the big question: learning is not the current win source. Do not go backward.
2. The default champion should not be selected primarily for exploiting a known weak benchmark pool.
3. Self-play and strong-candidate cross-play are the primary standard.
4. Immediate match-clinching legal knocks are dominant-action cases and must be handled correctly.
5. Do not assume other non-gin knocks are dominant without evidence.
6. Match win rate is the primary metric. Average points, undercuts, and voids are supporting diagnostics.
7. If two policies are close, prefer the simpler one that does not miss obvious correct actions.
8. If the evidence remains mixed, say so explicitly and do not force a promotion.

## Why This Path Was Chosen

The current evidence separates two different questions:

1. **Mechanism question**
   - Answered in Phase 56: patience beats aggressive knocking.

2. **Production-policy question**
   - Still unanswered: what should the default bot do once easy exploitative edges disappear?

Strong poker / imperfect-information AI programs did not define their best base policy as "best exploiter of a weak opponent."
They aimed for robust, self-play-stable strategies first, then optionally layered opponent-specific exploitation on top.

Phase 57 should adopt the same philosophy:

- build or select the strongest robust patience policy first
- treat exploitation of aggressive knockers as a secondary check, not the champion criterion

## Scope

### Always Allowed

- `gin_rummy/apex_mcts_gogin.py`
- `gin_rummy/apex_mcts_clinch_gogin.py`
- `gin_rummy/apex_mcts_firstknock.py`
- `gin_rummy/apex_mcts_paperknock.py`
- new Python files under `gin_rummy/`
- one or two new helper scripts under `tools/` if needed for mirror or population evaluation
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
- `test_knock_ablation.py`
- `test_knock_scenarios.py`
- `EXECUTION_REPORT_57.md`

### Suggested New Files

You do not have to use exactly these names, but a structure in this spirit is expected if useful:

- `gin_rummy/apex_mcts_clinchonly_gogin.py`
- `gin_rummy/apex_mcts_lowstock_gogin.py`
- `tools/evaluate_patience_population.py`
- `test_patience_variants.py`

### Conditionally Allowed

Only if required for the chosen path:

- one small helper for mirror/self-play benchmarking
- one small helper for patient-population reporting
- refreshed benchmark aliases for any new patience variants

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- more learned knock-model tuning
- new draw or discard model work
- broad architecture churn
- benchmark methodology changes beyond what is needed to support mirror/self-play or patient-population evaluation

## Required Sequence

### 1. Freeze the Phase 56 Conclusion

Before changing anything:

- treat `ApexMCTSKnock` as rejected as a production candidate
- treat `ApexMCTSGoGin` and `ApexMCTSClinchGoGin` as unresolved leading patience candidates
- do not reopen learned-model work in this sprint

### 2. Define the Candidate Robust Policies

At minimum, evaluate these policies:

- `ApexMCTSGoGin`
  - gin always knocks
  - otherwise never knock

- `ApexMCTSClinchOnlyGoGin`
  - gin always knocks
  - non-gin legal knock knocks **only if it immediately wins the game**
  - otherwise never knock

- `ApexMCTSClinchGoGin`
  - gin always knocks
  - non-gin legal knock knocks if it immediately wins the game
  - low-stock legal knock knocks
  - otherwise never knock

Optional but useful if the evidence needs it:

- `ApexMCTSLowStockGoGin`
  - gin always knocks
  - non-gin legal knock knocks only on low stock
  - otherwise never knock

The purpose is to isolate whether the only justified exception is:

- clinch
- low stock
- both
- or neither

### 3. Build the Right Evaluation Harness

This is required.

The existing benchmark work is good for normal cross-play, but it is not enough by itself for the current question.

You must support all of the following:

1. **Mirror/self-play evaluation**
   - a candidate against itself
   - needed to reveal void-heavy or pathological dynamics

2. **Patient-field cross-play**
   - a field composed mostly of patience candidates
   - this is the primary robustness evaluation

3. **Exploitative-field cross-play**
   - aggressive bots like `ApexMCTS`, `Apex`, and optionally `DeepKnock` / `Nexus`
   - this is secondary, but still useful

You may satisfy this by:

- a small helper script
- aliases that allow same-policy mirror matches
- or another minimal implementation

Do not replace the current benchmark system.
Extend around it minimally.

### 4. Add Dominant-Action Scenario Coverage

This is required and should be treated as correctness testing, not flavor.

At minimum, evaluate:

1. **Immediate non-gin score clinch**
   - example family: score near target, legal knock wins the match immediately
2. **Opening legal knock**
   - example family: `0-0` score with a legal DW 9-10 knock available
   - do not assume the answer; test and report it
3. **Low-stock non-clinching legal knock**
4. **Gin-only clinch**
   - knock does not win, gin would
5. **Illegal knock**
   - DW > 10

The important rule is:

- immediate match-clinch must be treated as a dominant-action check
- opening legal-knock states must be explicitly examined, not waved away

### 5. Report the Right Diagnostics

For each candidate policy, report:

- mirror/self-play win rate if symmetric aliases are used
- mirror/self-play gin rate
- mirror/self-play void-hand count
- non-gin clinch opportunities seen
- non-gin clinch opportunities taken
- low-stock legal knock opportunities seen
- low-stock legal knock opportunities taken
- undercuts for and against
- gins for and against
- match win rate versus:
  - patient field
  - exploitative field

If practical, also report:

- average hands per game
- average match length
- fraction of hands ending by gin / knock / void

### 6. Benchmark in the Correct Order

#### A. Patient-Field Evaluation (Primary)

This is the most important layer.

At minimum, run:

- patience-only round robin
- `ApexMCTSClinchOnlyGoGin` vs `ApexMCTSGoGin`
- `ApexMCTSClinchOnlyGoGin` vs `ApexMCTSClinchGoGin`
- top-two patience variants in a higher-power duplicate probe

#### B. Mirror / Self-Play Evaluation (Primary)

At minimum, run:

- `ApexMCTSGoGin` mirror
- `ApexMCTSClinchOnlyGoGin` mirror
- `ApexMCTSClinchGoGin` mirror

The purpose is to see what happens when the opponent is equally patient and no cheap exploit is available.

#### C. Exploitative-Field Evaluation (Secondary)

At minimum, run:

- strongest patience candidates vs `ApexMCTS`
- optionally a small aggressive field round robin

This should be reported, but it should not override patient-field evidence by itself.

### 7. Use Production-Oriented Decision Logic

Use this decision logic:

- if `ApexMCTSClinchOnlyGoGin` is as strong as `ApexMCTSGoGin` in the patient field and fixes immediate-clinch errors, prefer `ApexMCTSClinchOnlyGoGin`
- if `ApexMCTSGoGin` clearly dominates even under the stronger self-play/patient-field standard, promote it
- if `ApexMCTSClinchGoGin` or a low-stock exception variant clearly improves patient-field performance without obvious downside, prefer it
- do **not** choose a policy only because it punishes `ApexMCTS` hardest
- do **not** choose a policy that misses immediate match-clinch actions unless the evidence is overwhelming and you explain that tradeoff explicitly
- if evidence still conflicts, leave promotion unresolved

### 8. Add Focused Tests

Add or extend tests for:

- benchmark/helper registration of any new patience variants
- mirror/self-play helper correctness if you add one
- immediate clinch behavior
- opening legal-knock behavior
- low-stock behavior
- gameplay completion

### 9. Benchmark Honestly

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
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_knock_ablation.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_knock_scenarios.py
```

If you add a new test file, also run it explicitly.

Then run patient-field cross-play, for example:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSGoGin,ApexMCTSClinchOnlyGoGin,ApexMCTSClinchGoGin,ApexMCTSLowStockGoGin --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSGoGin,ApexMCTSClinchOnlyGoGin,ApexMCTSClinchGoGin,ApexMCTSLowStockGoGin --games 40 --target 100 --seed 20260315 --show-matchups --no-progress
```

Then run direct patience H2Hs:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSClinchOnlyGoGin,ApexMCTSGoGin --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSClinchOnlyGoGin,ApexMCTSGoGin --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSClinchOnlyGoGin,ApexMCTSClinchGoGin --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSClinchOnlyGoGin,ApexMCTSClinchGoGin --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
```

Then run exploitative-field checks, for example:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSClinchOnlyGoGin,ApexMCTSGoGin,ApexMCTSClinchGoGin,ApexMCTS,Apex,DeepKnock,Nexus --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSClinchOnlyGoGin,ApexMCTSGoGin,ApexMCTSClinchGoGin,ApexMCTS,Apex,DeepKnock,Nexus --games 40 --target 100 --seed 20260315 --show-matchups --no-progress
```

If you add a mirror/self-play helper, run and report it explicitly.

Then run a higher-power duplicate probe between the top two candidates under the **patient-field** evaluation.
This final probe is required before any promotion recommendation.

## Benchmark Gates

Your result is acceptable only if all of the following are true:

1. all required Python tests pass
2. any new patience-variant or helper tests pass
3. the report clearly separates:
   - self-play / mirror evidence
   - patient-field evidence
   - exploitative-field evidence
4. the final recommendation is not based on exploitation of aggressive opponents alone
5. immediate match-clinch behavior is explicitly evaluated
6. opening legal-knock states are explicitly discussed

## Acceptance Criteria

This task is complete only if all of the following are true:

- the leading patience variants were evaluated in a patient field
- mirror/self-play behavior was reported
- dominant-action scenarios were explicitly tested
- exploitative-field performance was reported as secondary evidence
- a higher-power duplicate probe was used before any final promotion recommendation
- `EXECUTION_REPORT_57.md` is saved to the workspace root with honest numbers

## Deliverable Expectation

Phase 56 found the mechanism:

- patience beats aggressive knocking

Phase 57 should answer the harder question:

- what knock policy should a robust, hard-to-exploit production bot actually use?

Do not confuse:

- "best exploiter of `ApexMCTS`"

with:

- "best default policy for maximizing match win probability"

If pure `GoGin` survives the stronger standard, promote it.
If a clinch-only or other tiny exception set survives that standard, promote that instead.
If the evidence is still mixed, say so clearly and do not force a winner.
