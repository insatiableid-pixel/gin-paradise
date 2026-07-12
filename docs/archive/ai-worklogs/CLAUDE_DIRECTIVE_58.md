# Claude Directive 58: Isolated Opening DW=9 Knock Study

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a concise but complete markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_58.md`.
3. The execution report must include, at minimum:
   - objective
   - exact scenario definition
   - why this isolated study was chosen
   - exact files changed
   - exact commands run
   - methodology
   - gin-liveness / gin-probability strata
   - paired same-world action-comparison design
   - raw matchup / simulation tables
   - conclusion
   - limitations
   - recommended implication for the main knock-policy work
4. Do not update `PROJECT_STATUS.md` for this task unless the user explicitly asks for it.
5. This task is not complete until the code, verification, any produced artifact needed for the chosen path, and `EXECUTION_REPORT_58.md` are all finished.

## Objective

Test one exact question in isolation:

- At **0-0 score**, in an **opening/very-early legal knock state** with **deadwood = 9**, is the higher match-EV action:
  - **knock now**
  - or **continue**

But answer it the right way:

- not from one hand
- not from a deadwood proxy
- not from exploiting a known weak opponent
- and not without varying the hand's **gin probability / gin liveness**

This is a focused research question, not a broad sprint.
Do not branch into unrelated knock-policy work.

## Why This Study Exists

There is now a key philosophical split in the project:

- one view says that an opening legal knock at DW=9 is obviously strong and should likely be taken
- another view says this should not be hard-coded without stronger evidence, because robust self-play / population evaluation should settle it
- a further refinement is that the answer may depend heavily on **gin probability**
  - two legal DW=9 hands can have the same deadwood total but very different upside if they continue

This directive is intended to answer that exact disagreement with evidence.

## Scope

### Always Allowed

- new Python files under `gin_rummy/`
- new helper scripts under `tools/`
- new tests in the repo root
- `benchmark.py`
- `test_apex.py`
- `test_regressions.py`
- `test_mcts.py`
- `test_knock_ablation.py`
- `test_knock_scenarios.py`
- `EXECUTION_REPORT_58.md`

### Suggested New Files

You do not have to use exactly these names, but a structure in this spirit is expected if useful:

- `tools/evaluate_opening_dw9_knock.py`
- `test_opening_dw9_knock.py`

### Still Forbidden

- any `gin-galaxy/` file
- any frontend or server file
- broad knock-policy refactors
- learned-model work
- draw/discard work
- promotion of a new champion from this directive alone

## Exact Research Question

The exact question is not:

- "does GoGin beat ApexMCTS?"

It is:

- "in a legal early-hand knock state with score 0-0 and DW exactly 9, is `knock now` or `continue` the higher-EV action under robust evaluation?"

And the answer must be stratified by **gin liveness / gin probability**, not just deadwood total.

## Required Methodology

### 1. Define the Scenario Precisely

You must define and report the exact semantics of the scenario you test.

At minimum, specify:

- whether the state is on turn 0, turn 1, or a small opening-turn family
- whether it is a post-draw / post-discard legal knock state under the engine's real rules
- the exact hand structures used
- the exact game-state fields used (`turn_number`, `my_score`, `opp_score`, `deck_remaining`, discard state, etc.)
- any public discard / upcard context that matters to legality or liveness
- any opponent-model state or history assumptions carried into the injected state

Do not leave the scenario vague.
Do not use impossible or rule-inconsistent states.

### 2. Use a Scenario Family, Not One Arbitrary Hand

Do **not** test only one single hand.

Construct a small but meaningful family of opening legal-knock states with:

- `my_score = 0`
- `opp_score = 0`
- `deadwood = 9`
- legal knock available
- opening / very-early turn context

The family must be stratified primarily by **gin probability / gin liveness**.

At minimum, include:

1. **low gin-probability / low gin-liveness** DW=9 states
2. **medium gin-probability / medium gin-liveness** DW=9 states
3. **high gin-probability / high gin-liveness** DW=9 states

Within or across those strata, also include structural diversity such as:

1. one-card deadwood style DW=9
2. multiple-deadwood-card DW=9
3. concentrated / live deadwood structure
4. dispersed / stale deadwood structure

The goal is to avoid answering the question from one cherry-picked texture.

### 2b. Measure Gin Probability Explicitly

Do not rely only on a hand-crafted label like "looks gin-live."

You must define and report how gin probability / gin liveness is measured.

Preferred options:

1. empirical rollout-based probability of reaching gin within a short horizon
2. empirical probability of eventually ginning before the hand ends under a fixed continuation policy family
3. a strong proxy such as exact gin-hit counts plus rollout confirmation

If you use a proxy rather than a direct probability estimate, say so explicitly.

### 3. Compare Actions Directly

For each scenario, compare:

- **Action A:** knock now
- **Action B:** continue

This must be an action-level evaluation, not just "which whole bot wins more."

At minimum, estimate the action values by continuing play from the **exact same state** under controlled hidden-world conditions.

This means:

- same public state
- same hidden world
- same deck / unseen-card realization
- same opponent policy
- same continuation policy after the forced first action

The only thing that should differ is:

- whether the acting player is forced to `knock now`
- or forced to `continue`

### 3b. Use Paired Same-World Evaluation

This is required.

For each sampled scenario instance and hidden world, evaluate both branches:

1. force `knock now`
2. force `continue`

Then compare the outcomes as a paired result.

Do not compare unmatched populations of random continuations if you can avoid it.
Variance reduction matters here.

### 4. Prefer Robust Evaluation Over Weak-Pool Exploitation

The primary lens should be robust evaluation, not "best exploitation of a weak aggressive knocker."

At minimum, include one or more of:

- continuation against a patient opponent policy
- continuation against a small policy population
- mirror-style continuation where both sides use the same strong baseline family except for the forced action under test

You may include aggressive-opponent results as a secondary slice, but they are not the main answer.

At minimum, the robust side should include:

- at least one patient continuation policy
- and at least one small candidate population or mirror-style continuation setup

### 5. Report Match-EV, Not Just Deadwood Proxy

The main answer should be framed in terms of:

- win probability
- match win rate
- or expected match points / match-equity proxy

Do not treat short-term deadwood improvement alone as the final answer.

Strong preference:

- continue the full **match**, not just the current hand, from the exact injected state after the forced action

If a full-match continuation is too expensive and you fall back to a hand-level proxy anywhere, you must:

- say so clearly
- report it as secondary
- and not let it substitute silently for the main conclusion

### 6. Include at Least One "Exploitative Opponent" Slice

As a secondary diagnostic, also report what happens against an aggressive knocker like `ApexMCTS`.

This is useful to distinguish:

- robustly correct action
from
- best exploit against a known leak

If the answer changes materially between robust and exploitative environments, say that explicitly.

### 7. Write the Conclusion Narrowly

Your conclusion should answer this exact question:

- In opening legal DW=9 knock states at 0-0, what does the evidence currently favor: knock now or continue?

And it should answer it in this form:

- overall
- by gin-probability stratum
- by any hand-structure split that materially changes the answer

If the answer depends strongly on hand texture, say that.
If the answer depends strongly on opponent type, say that.
If the evidence is mixed, say that.

Do not overgeneralize beyond this exact spot family.

## Expected Deliverables

At minimum, produce:

1. one reproducible scenario-study script or helper
2. one focused test file validating the scenario harness
3. one saved raw results artifact if practical (JSON/CSV is fine)
3. `EXECUTION_REPORT_58.md`

## Suggested Command Pattern

Run and record the relevant existing test suites plus any new focused test file you add.

At minimum, run:

```powershell
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_apex.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_regressions.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_mcts.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_knock_ablation.py
& 'C:\Users\mrwat\AppData\Local\Python\pythoncore-3.14-64\python.exe' -m unittest -v test_knock_scenarios.py
```

If you add a new test file, run it explicitly.
If you add a scenario script, run it and record the exact command.

## Acceptance Criteria

This task is complete only if all of the following are true:

- the opening DW=9 legal-knock scenario is defined precisely
- a small scenario family is evaluated, not just one hand
- the family is stratified by gin probability / gin liveness
- `knock now` vs `continue` is compared directly from the same state
- paired same-world evaluation is used or the report clearly explains why not
- robust-evaluation results are reported
- aggressive-opponent results are reported as secondary evidence
- the conclusion states whether the answer changes by gin-probability stratum
- `EXECUTION_REPORT_58.md` is saved to the workspace root with an honest narrow conclusion

## Deliverable Expectation

This directive is intentionally narrow.

The job is not to solve the whole knock policy.
The job is to answer one exact question with real evidence:

- at `0-0`, in opening legal `DW=9` knock states, should a robust bot usually knock now or continue?

And the answer must be good enough to say:

- "for low gin-probability DW=9 openings, the evidence favors X"
- "for high gin-probability DW=9 openings, the evidence favors Y"

Answer that question cleanly, and stop.
