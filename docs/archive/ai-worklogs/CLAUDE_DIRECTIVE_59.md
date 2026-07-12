# Claude Directive 59: Knock Frontier Mapping Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_59.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - why this path was chosen
   - exact files changed
   - exact commands run
   - evaluation methodology
   - scenario-family definitions
   - knock-frontier tables
   - robust/patient evaluation results
   - exploitative-opponent results
   - dominant-action findings
   - conclusion
   - limitations
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, any produced artifact needed for the chosen path, and `EXECUTION_REPORT_59.md` are all finished.

## Current State

The project has now learned three important things:

1. **Phase 57 resolved the default patience policy.**
   - `ApexMCTSClinchOnlyGoGin` is the current robust production knock policy.
   - Pure patience is the mechanism.
   - The clinch-only exception costs nothing measurable and fixes the only unconditionally dominant non-gin action currently proven.
   - The low-stock exception is empirically harmful.

2. **Phase 58 resolved one high-signal opening question.**
   - At `0-0`, opening legal `DW=9` knock states do **not** support a universal “always knock.”
   - For the typical `DW=9` shape — one concentrated deadwood card atop strong meld structure and high gin probability — the evidence favors **continue**.
   - For fragmented multi-card `DW=9` shapes with much lower gin upside, the evidence can favor **knock**.

3. **The knock decision is now clearly a frontier, not a threshold.**
   - It depends on more than deadwood total.
   - At minimum it depends on:
     - deadwood total
     - deadwood-card count / structure
     - gin probability / gin liveness
     - turn number
     - score state
     - opponent state

This is also consistent with Michael Sall's framework from *Gin Rummy: A Predator's Guide*:

- knocking is a **match-EV** decision, not a deadwood-threshold decision
- the hand must be evaluated by its **relative worth** against the opponent
- high knock-card situations carry greater undercut risk
- decisions to play for gin must be **re-evaluated every card**
- opponent pickups, discards, and overall direction matter

Do **not** import Sall's partners / spade / box-specific advice literally into our singles engine.
Do use his framework as structural guidance for which variables matter.

## Primary Objective

Build the first usable **knock frontier map** for the current engine.

The question is no longer:

- “should the bot generally knock more or less?”

The question is:

- “for which exact state families is `knock now` higher match-EV than `continue`, and for which families is it not?”

Phase 59 should turn that from a debate into a map.

## Core Principles

Use these principles explicitly:

1. The default champion remains `ApexMCTSClinchOnlyGoGin` unless new evidence clearly supports a change.
2. The goal of this sprint is frontier discovery, not a broad policy rewrite.
3. Deadwood total alone is insufficient. Every result must be stratified by hand structure and gin liveness.
4. For **opening** decisions, evaluate exact `DW` totals from `1..9`.
5. For **subsequent** early-turn decisions, do not collapse everything into one bucket before seeing the data.
6. Opponent state is part of the knock decision:
   - what they took
   - what they discarded
   - and whether they appear to be reducing deadwood quickly
7. Robust/patient evaluation is primary. Exploitative-opponent results are secondary.
8. Match win probability / match-EV is preferred to deadwood proxy whenever feasible.

## Why This Path Was Chosen

The current evidence points to a specific next step.

Phase 57 answered:

- which patience policy is the best default current bot

Phase 58 answered:

- one exact opening `DW=9` question

What remains is the broader underlying research problem:

- Where is the actual knock boundary?

The user's current hypothesis is directionally right:

- we likely need to understand opening `DW 1..9`
- and then how that boundary shifts on subsequent turns

But the evidence already shows the boundary will not be a single number.
So this sprint should map the frontier cleanly instead of chasing another one-off anecdote.

## Scope

### Always Allowed

- `gin_rummy/apex_mcts_clinchonly_gogin.py`
- `gin_rummy/apex_mcts_gogin.py`
- `gin_rummy/apex_mcts_clinch_gogin.py`
- new Python files under `gin_rummy/`
- new helper scripts under `tools/`
- new tests in the repo root
- `benchmark.py`
- `test_apex.py`
- `test_regressions.py`
- `test_mcts.py`
- `test_knock_ablation.py`
- `test_knock_scenarios.py`
- `test_patience_variants.py`
- `test_opening_dw9_knock.py`
- `EXECUTION_REPORT_59.md`

### Suggested New Files

You do not have to use exactly these names, but a structure in this spirit is expected if useful:

- `tools/evaluate_knock_frontier.py`
- `test_knock_frontier.py`
- `knock_frontier_results.json`

### Conditionally Allowed

Only if required for the chosen path:

- one small helper for paired same-world continuation evaluation
- one small helper for opponent-state scenario generation
- one small saved raw-results artifact (JSON/CSV)

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- broad draw/discard refactors
- learned knock-model tuning
- triangle / high-pair / triangle-break research as the main task of this directive

Those are promising future seams, but **not this phase**.

## Required Sequence

### 1. Freeze the Current Champion

Before changing anything:

- treat `ApexMCTSClinchOnlyGoGin` as the current champion baseline
- do not replace it from this directive unless the new frontier evidence is unusually clear

### 2. Map the Opening Frontier First

You must evaluate **opening** legal knock states at:

- `DW = 1, 2, 3, 4, 5, 6, 7, 8, 9`

for:

- `my_score = 0`
- `opp_score = 0`
- opening / first legal knock opportunity context

For each `DW` total, the scenario family must be stratified by:

1. gin probability / gin liveness
2. deadwood-card count:
   - 1 card
   - 2 cards
   - 3+ cards
3. at least one notion of structure:
   - concentrated / live
   - dispersed / stale

Do not answer any `DW` total from one cherry-picked hand.

### 3. Extend to Subsequent Early Turns

After the opening frontier is complete, extend the study to **subsequent early turns**.

At minimum, evaluate:

- turn 1
- turn 2
- turn 3

Do not collapse turns `1-3` into one bucket before running the study.
If later you want to bucket `4-7` and `8+`, that is acceptable, but the first few turns should be examined individually.

For the subsequent-turn study, again evaluate:

- `DW = 1..9`

and include opponent-state slices.

### 4. Include Opponent State Explicitly

For subsequent-turn states, opponent state must be part of the frontier.

At minimum, include slices or scenario families based on:

1. opponent discard pickups count
2. opponent low-card pickups / visible knock-readiness signals if feasible
3. opponent deadwood-reduction direction:
   - looks stalled / neutral
   - appears to be reducing deadwood quickly

This can be represented via public-action-derived buckets.
It does **not** need to be a perfect hidden-state estimate.
But it must be explicit.

### 5. Use Sall as a Structural Guide

The study should reflect Sall's useful transferable ideas:

- knock decisions are about **relative hand worth**
- the value of continuing depends on **our gin chances**
- the danger of continuing depends on **their readiness**
- higher knock-card situations are more exposed to undercut risk
- a “play for gin” decision should be reconsidered as the hand evolves

For this directive, that means your frontier tables should, where possible, expose:

- our gin probability
- deadwood-card count / structure
- opponent readiness proxy
- and resulting action preference

Do **not** literalize partner or spade-up rules from the book.

### 6. Compare Actions Directly

For each scenario family, compare:

- **Action A:** knock now
- **Action B:** continue

This must be an action-level evaluation from the same state, not just whole-bot H2Hs.

Use paired same-world evaluation whenever practical:

- same public state
- same hidden world
- same continuation environment
- only the first action differs

### 7. Use the Right Evaluation Lenses

#### A. Robust/Patient Evaluation (Primary)

This is the main answer.

Use at least:

- `ApexMCTSClinchOnlyGoGin` continuation environment
- and/or a small patient policy family

#### B. Exploitative-Opponent Evaluation (Secondary)

Also include at least one slice against:

- `ApexMCTS`

This is useful, but it is not the main answer.

#### C. Dominant-Action Check

Keep immediate match-clinch as a separately recognized dominant-action case.
This directive is about the **non-clinch frontier**, not re-litigating clinch.

### 8. Report a Frontier, Not Just Individual Results

The output should not be a bag of examples.

You must summarize the findings into a frontier map, for example:

- by `DW total × gin-liveness`
- by `DW total × deadwood-card count`
- by `DW total × turn`
- with opponent-state annotations where those materially change the answer

The point is to extract a rule shape, even if it is only partial.

### 9. Conservative Integration Rule

Do **not** rewrite the live bot from this directive unless the evidence reveals a compact, clearly dominant refinement.

If a compact rule does emerge, it must be:

- simple
- strongly supported by the data
- and verified not to damage the current champion in patient-field reasoning

Otherwise, report the frontier and leave integration for the next phase.

## Expected Deliverables

At minimum, produce:

1. one reproducible frontier-study script or helper
2. one focused test file validating the frontier harness
3. one saved raw results artifact if practical
4. `EXECUTION_REPORT_59.md`

## Suggested Command Pattern

Run and record the relevant test suites plus any new focused test file.

At minimum, run:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_mcts.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_knock_ablation.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_knock_scenarios.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_patience_variants.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_opening_dw9_knock.py
```

If you add a new test file, run it explicitly.
If you add a frontier script, run it and record the exact command.

## Acceptance Criteria

This task is complete only if all of the following are true:

- opening `DW 1..9` legal-knock states were evaluated
- turns `1`, `2`, and `3` were evaluated explicitly
- the analysis is stratified by gin probability / gin liveness
- the analysis is stratified by deadwood-card count
- opponent-state slices are included for subsequent-turn states
- robust/patient results are reported as primary evidence
- exploitative-opponent results are reported as secondary evidence
- the report presents a usable knock-frontier map rather than isolated anecdotes
- `EXECUTION_REPORT_59.md` is saved to the workspace root with an honest conclusion

## Deliverable Expectation

Phase 57 chose the current robust knock policy.
Phase 58 proved that opening `DW=9` is not a universal knock.

Phase 59 should now answer the bigger question:

- where is the real early-hand knock frontier?

The job is to produce the first serious map of:

- `DW total`
- `turn`
- `gin liveness`
- `deadwood-card structure`
- `opponent state`

against:

- `knock now`
- vs `continue`

Map that frontier cleanly, and stop.
