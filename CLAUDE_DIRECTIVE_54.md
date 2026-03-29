# Claude Directive 54: Discard-Stage Action Model Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_54.md`.
3. The execution report must include, at minimum:
   - objective
   - current context
   - why this path was chosen over more draw-model iteration
   - exact files changed
   - exact commands run
   - dataset design and schema
   - candidate-label generation method
   - offline baseline vs learned-model comparison
   - group-aware decision metrics
   - benchmark tables if gameplay integration happens
   - tests run
   - shipped outcome vs experimental-only outcome
   - rejected variants and why they were rejected
   - unresolved risks
   - recommended next step
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. The task is not complete until the code, verification, any produced artifact needed for the chosen path, and `EXECUTION_REPORT_54.md` are all finished.

## Current State

The current Python AI position is now much clearer:

- `EXECUTION_REPORT_49.md` shipped `ApexMCTS` as the champion with a real high-power duplicate edge over `Apex`.
- `EXECUTION_REPORT_51.md` and `EXECUTION_REPORT_52.md` showed that state-value learning does not improve draw play in gameplay, even when it looks promising offline.
- `EXECUTION_REPORT_53.md` went one step further:
  - the first action-conditioned draw model clearly beat handcrafted baselines offline
  - but still produced no measurable gameplay edge over `ApexMCTS`
  - combined head-to-head result was 48.75% over 480 games

That is an important answer, not a failure to understand.

The evidence now strongly suggests:

- the draw decision is no longer the main binding constraint in the shipped champion
- learned signal can exist offline without converting to wins
- the next promising surface is **discard choice**, where the engine still relies on a hand-built heuristic pipeline every turn

Also keep one historical lesson in view:

- `EXECUTION_REPORT_48.md` ruled out discard-only CFR in its specific form
- that does **not** mean discard modeling is closed
- it means the old CFR abstraction should not be repeated

## Primary Objective

Build the first action-conditioned learning path for the discard decision:

1. create a reproducible dataset of post-draw discard states with candidate discard labels or utilities
2. train and evaluate a learned model that scores or ranks discard candidates
3. compare it against meaningful offline discard baselines on held-out **group-aware** metrics
4. only if the offline evidence is clearly positive, integrate it into a controlled experimental bot and benchmark it against unchanged `ApexMCTS`

## Decision Rule

Use this decision rule explicitly:

1. `ApexMCTS` remains the exact shipped champion baseline.
2. More draw-model iteration is not the main task for this sprint.
3. Do **not** spend this sprint on more `ApexMCTSAction` threshold tuning, more state-value work, or another draw-only label experiment unless the new discard path fails immediately.
4. The new model should target the discard action directly, not indirectly through generic state value.
5. If the discard model does not beat offline baselines on held-out grouped discard decisions, stop there and report honestly rather than forcing gameplay integration.

## Why This Path Was Chosen

The best available evidence now points here:

- Report 53 showed that even an action-conditioned draw model with very strong offline numbers does not move gameplay.
- Draw is therefore likely near the practical ceiling of what the current `ApexMCTS` search already captures.
- By contrast, discard choice is still decided by Apex's two-phase heuristic pipeline:
  - fast heuristic ranking over candidates
  - actual deadwood verification on only the top few candidates
- That makes discard the largest remaining frequent decision surface still governed mainly by heuristics.

So Phase 54 should answer the next sharper question:

- can action-conditioned learning add value on the discard surface, where the bot still makes a hand-built candidate-ranking choice every turn?

That is a stronger next question than more draw-side tuning.

## Scope

### Always Allowed

- `gin_rummy/apex.py`
- `gin_rummy/apex_mcts.py`
- `gin_rummy/apex_mcts_action.py`
- `gin_rummy/apex_cfr.py`
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
- `EXECUTION_REPORT_54.md`

### Suggested New Files

You do not have to use exactly these names, but a structure in this spirit is expected if useful:

- `gin_rummy/discard_action_features.py`
- `gin_rummy/discard_action_model.py`
- `gin_rummy/apex_mcts_discard.py`
- `tools/generate_discard_data.py`
- `train_discard_model.py`
- `evaluate_discard_model.py`
- `test_discard_model.py`
- `models/discard_action_data.*`
- `models/discard_action_model.*`

### Conditionally Allowed

Only if required for the chosen path:

- a refreshed benchmark alias for the experimental discard bot
- additional model artifacts or JSON summaries
- a small diagnostic script for grouped ranking analysis

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- new CFR work
- reviving the old discard-CFR strategy-table approach
- more blind draw-model tuning as the main task
- broad architecture churn
- benchmark methodology changes unless you discover a correctness bug and explain it explicitly

## Required Sequence

### 1. Lock the Baseline

Before doing any new learning work:

- preserve the exact shipped `ApexMCTS` draw search and knock logic as the benchmark baseline
- do not mutate the shipped champion into the experiment
- if you create a new experimental bot, keep it clearly separate

Strong naming preference:

- `ApexMCTSDiscard`

### 2. Target the Actual Discard Seam

The relevant seam already exists in `Apex.discard_decision`:

- heuristic candidate scoring
- then actual deadwood verification on only the top few candidates

Phase 54 should target that seam directly.

The new model should score or rank discard candidates from a post-draw discard state, not learn a vague policy table.

### 3. Build a Candidate-Based Discard Dataset

This sprint should focus specifically on **discard decisions** from 11-card post-draw states.

Each data group should correspond to one discard decision state.
Within each group, you should evaluate multiple legal discard candidates.

Preferred structure:

1. snapshot a real post-draw discard state from self-play
2. enumerate legal discard candidates, respecting the "cannot immediately return the taken discard" rule
3. compute a candidate feature vector for each legal discard
4. assign each candidate a utility or regret label relative to the best candidate in that same state

Strong default:

- grouped candidate dataset, not a flat ungrouped classifier

This grouped structure is important because the real question is:

- which discard is best **within this hand**?

not:

- is this candidate generally good in isolation?

### 4. Generate Labels That Break Self-Play Circularity

Report 53 identified self-play circularity as a real risk.

Avoid reproducing it here by:

- labeling multiple candidate discards from the same state
- not just learning from the discard Apex happened to choose
- comparing candidates against each other under the same continuation assumptions

Good default label schemes:

- normalized utility for each candidate
- regret versus best candidate
- binary near-optimal label within each state

Preferred label-generation method:

- paired continuation rollouts from the same underlying state and sampled worlds

For example:

1. remove candidate discard
2. continue with a fixed continuation policy
3. estimate downstream quality using a tractable rollout or continuation metric
4. compare candidates within the state

You do not need a perfect solver-grade discard oracle in this sprint.
You do need a label that is more aligned than the old discard-CFR abstraction.

### 5. Use Candidate Features That Reflect Real Discard Tradeoffs

The feature set should represent what makes discard hard.

Useful candidates include:

- card identity and deadwood value
- deadwood after discard
- whether the discard breaks a meld or near-meld
- opportunity cost / near-meld destruction
- opponent safety or exposure proxies
- whether the card was newly drawn and restricted
- discard-pile / visible-card context
- score / phase context
- opponent-model signals if helpful

If you keep the feature set focused and interpretable, that is a plus.

### 6. Compare Against Meaningful Offline Discard Baselines

This is not just another classification sprint.

You must compare the learned model against meaningful discard baselines, such as:

- Apex's current discard choice
- pure post-discard deadwood minimization
- the current Apex phase-1 heuristic score

At minimum report **group-aware** decision metrics like:

- top-1 best-discard accuracy by state
- average regret versus the best candidate in each state
- pairwise ranking accuracy, if used
- baseline vs learned comparison

The learned model must beat a simple baseline on held-out grouped discard decisions to justify gameplay integration.

### 7. Gameplay Integration Is Optional and Must Be Earned

Only if the offline discard results are clearly positive should you integrate the model into gameplay.

Preferred conservative integration ideas:

- use the model to rerank all legal discard candidates
- or rerank a larger candidate set than Apex currently verifies
- keep draw search, knock logic, and rules handling unchanged

Avoid for this sprint:

- reviving a CFR-style strategy lookup table
- replacing large parts of the engine at once
- forcing model control when confidence is weak

If offline results are not clearly positive, stop at foundation-only and report honestly.

### 8. Add Focused Tests

Add tests for the new path, including as appropriate:

- dataset generation shape / schema
- grouped-candidate integrity
- feature encoding determinism
- model save/load
- grouped evaluation pipeline
- gameplay legality and completion if integration happens

### 9. Benchmark Honestly

Run and record these commands unless you discover a correctness reason to change them and explain it explicitly:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_mcts.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_value_model.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_value_search.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_action_model.py
```

If you add a new test file, also run it explicitly.

If you build the discard dataset / model pipeline, run and report the exact commands, for example:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' tools/generate_discard_data.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' train_discard_model.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' evaluate_discard_model.py
```

If gameplay integration happens, run quick screening benchmarks first:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSDiscard,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSDiscard,ApexMCTS,Apex,Nexus,DeepKnock,Heisenbot --games 40 --target 100 --seed 20260315 --show-matchups --no-progress
```

If and only if those are promising, then run direct head-to-head probes:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSDiscard,ApexMCTS --games 120 --target 100 --seed 20260305 --show-matchups --no-progress
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' benchmark.py --players ApexMCTSDiscard,ApexMCTS --games 120 --target 100 --seed 20260315 --show-matchups --no-progress
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
7. any new tests pass in full.
8. the grouped discard dataset / evaluation pipeline completes successfully, or the report explains honestly why it failed.
9. if gameplay integration happens, the experimental bot completes duplicate benchmarks without hangs or illegal behavior.
10. no ship decision is made from small-sample noise alone.

## Acceptance Criteria

This task is complete only if all of the following are true:

- the discard decision was modeled directly
- a reproducible grouped discard dataset was created
- a learned discard model was trained and evaluated against offline baselines
- grouped decision metrics were reported, not just flat per-candidate accuracy
- gameplay integration happened only if the offline evidence justified it
- the report clearly states whether the outcome is:
  - foundation-only failure
  - experimental-only positive signal
  - or ship-worthy challenger
- `EXECUTION_REPORT_54.md` is saved to the workspace root with honest numbers

## Deliverable Expectation

Directive 53 answered an important question:

- action-conditioned learning can find real draw-decision signal offline
- but draw is likely no longer where wins are hiding

Directive 54 should answer the next one:

- can action-conditioned learning move the needle on discard choice, the largest remaining heuristic surface in the champion?

If yes, that becomes the first learned model aimed at a surface the current engine still handles mostly heuristically.
If no, that is still valuable, because the next oracle-track push should likely shift to knock-timing strategy or a critical-situations benchmark rather than more learned-action iteration on obvious surfaces.

Either outcome is acceptable.
Unclear evidence is not.
