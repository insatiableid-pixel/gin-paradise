# Gemini Directive 112 - Bridge Reliability Recovery

## Objective
Recover reliable **Gemini CLI semantic candidate generation** for the Oracle
autoresearch loop after the timeout-driven fallback block reported in:

- `ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_R2_FROM_GEMINI_GCLI_0043.md`
- `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`

This is a Gemini-executable engineering sprint. The goal is to make the bridge
healthy again so the next symbolic-evolution block uses real semantic Gemini
candidates instead of degrading into local fallback search.

## Why This Is The Highest-Leverage Next Step
The second symbolic block still improved the Oracle:
- incumbent moved from `0.7619` to `0.7948`
- but the entire block ran on `local_fallback_generator`
- because the Gemini bridge timed out

That means the research direction is still good, but the actual semantic worker
went offline. The next best move is to restore the worker, not to keep squeezing
fallback scalars.

## What To Read First
Read these files before making changes:

- `oracle_autoresearch/gemini_bridge.py`
- `oracle_autoresearch/agent_loop.py`
- `oracle_autoresearch/run_gemini_loop.ps1`
- `oracle_autoresearch/agent_prompt.md`
- `oracle_autoresearch/program.md`
- `ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_R2_FROM_GEMINI_GCLI_0043.md`
- `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`
- `oracle_autoresearch/loop_state.json`

Confirm from them that:
- the current incumbent is `gen_trace_confidence_decay_0p1`
- the current score is `0.7948`
- the bridge timeout default is currently `180s`
- the last symbolic block used `0` bridge candidates and `12` fallback candidates

## Required Deliverables

### 1. Fix the Timeout Path

Harden the real Gemini bridge path used by:
- `oracle_autoresearch/gemini_bridge.py`
- `oracle_autoresearch/agent_loop.py`
- `oracle_autoresearch/run_gemini_loop.ps1`

Requirements:
- raise the default bridge timeout if needed
- add at least one bounded retry before falling back
- log clearly:
  - request id
  - timeout duration
  - retry attempt
  - final outcome
- keep the bridge fully headless and scriptable

Do **not** solve this by silently leaning harder on fallback.

### 2. Make the Bridge Request Leaner

Reduce bridge payload bloat without losing high-signal context.

Requirements:
- trim stale low-value history
- prefer recent symbolic findings and current incumbent priors
- preserve frozen constraints and current mutation-surface instructions
- keep the request more relevant and easier for Gemini CLI to answer quickly

### 3. Carry Forward the New R2 Priors

Update the Oracle prompt so the next semantic block starts from the real current
frontier:

- `TRACE_CONFIDENCE_DECAY = 0.10` is now live
- pure trace-floor adjustments were weak
- continuation-weight perturbations were weak
- stock-DW-prior toggling was weak
- the winning semantic family from the first symbolic block is still valid

Update:
- `oracle_autoresearch/agent_prompt.md`
- and `oracle_autoresearch/program.md` if useful

### 4. Add a Direct Bridge Smoke Path

Add or document a fast deterministic command that proves:
- Gemini CLI responded
- the response parsed
- and the loop can consume it

This should be faster than a full 12-experiment block.

### 5. Keep the Research Surface Frozen

Do **not** change:
- `prepare.py`
- `multi_lane_benchmark.py`
- `oracle_abstractions.py`
- `gauntlet_eval.py`

Do **not** widen the mutation surface. This is a bridge-recovery sprint, not a
modeling sprint.

## Verification
Run, at minimum:

1. a direct bridge smoke / diagnostic command
   - must produce a real Gemini response that parses

2. `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode bridge_only --max-experiments 1 --dry-run`
   - must succeed without fallback

3. `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode bridge_then_fallback --max-experiments 1 --dry-run`
   - should also succeed and should not need fallback if the bridge is healthy

If needed, use the repo-local Python:

```powershell
& '.\.local-python\3.14\python.exe' oracle_autoresearch\agent_loop.py ...
```

## Deliverable
When done, write:

`EXECUTION_REPORT_112.md`

to the repo root. Include:
- what caused the timeout
- what timeout / retry defaults now exist
- what request-size / prompt-context changes were made
- whether a real bridge candidate was successfully generated after the fix
- exact verification commands run
- whether the repo is ready for the next real Gemini symbolic block

## Success Criteria
This sprint is successful if:
- the Gemini bridge no longer times out on the normal Oracle path
- a real bridge-generated candidate is produced again
- fallback is no longer the primary worker
- and the repo is ready for the next bounded symbolic-evolution block
