# Directive 112 - Gemini Bridge Reliability Recovery

## Objective
Restore **reliable Gemini semantic candidate generation** for the Oracle
autoresearch loop after the timeout-driven fallback block reported in
`ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_R2_FROM_GEMINI_GCLI_0043.md`.

This sprint is **not** about changing benchmark infrastructure or inventing a
new research surface. It is about making the Gemini bridge dependable again so
the next symbolic-evolution block can run on actual semantic candidates instead
of degrading into local fallback search.

## Why This Sprint
The second symbolic block still found a useful improvement:
- incumbent moved from `0.7619` to `0.7948`
- `TRACE_CONFIDENCE_DECAY` increased from `0.08` to `0.10`

That is good news.

But the same report also shows the higher-leverage problem:
- **Gemini bridge timed out**
- the entire block fell back to local generator candidates
- semantic formula exploitation was largely absent

So the next best move is clear:
- keep the new incumbent,
- keep the current semantic mutation surface,
- and fix the bridge so Gemini can resume doing the work it is uniquely good at.

## Required Deliverables

### 1. Diagnose and Fix the Gemini Bridge Timeout Path

Investigate and harden the real path used by:
- `oracle_autoresearch/gemini_bridge.py`
- `oracle_autoresearch/agent_loop.py`
- `oracle_autoresearch/run_gemini_loop.ps1`

Implement a bounded, production-usable fix for the timeout issue.

Requirements:
- increase the default bridge timeout if the current `180s` default is too low
  for the present prompt size / model behavior
- add at least one bounded retry path before dropping into local fallback
- log the exact failure mode cleanly:
  - timeout duration
  - request id
  - whether retry succeeded
  - whether fallback was entered
- keep the bridge fully headless and automatable

Do **not** paper over the failure by silently increasing fallback usage. The
goal is to recover real Gemini semantic generation.

### 2. Compact the Bridge Request to Higher-Signal Context

The bridge request appears large and historically noisy. Tighten it.

Requirements:
- reduce low-value historical clutter in the request payload
- prefer recent, high-signal symbolic history over stale phase-era noise
- keep the frozen constraints and current incumbent context
- preserve enough context for good candidate generation, but cut anything that
  is clearly slowing the request without helping

Examples of things to consider:
- shorter recent history windows
- concise summaries instead of long raw history lists
- prioritizing current winning / losing mutation families
- avoiding repeated stale ablation context when it is no longer useful

The goal is not just "more timeout"; it is "smaller and more relevant request."

### 3. Preserve the Current Mutation Surface and Incumbent

Do **not** broaden or redesign the current solver surface in this sprint.

Preserve:
- current incumbent behavior (`0.7948` baseline)
- current semantic surfaces:
  - `compute_eval_weight()`
  - `compute_trace_confidence_multiplier()`
- frozen benchmark infrastructure
- Pareto-aware promotion gate
- real-policy gauntlet

This sprint is bridge recovery, not a new modeling sprint.

### 4. Update the Oracle Prompt With Latest R2 Findings

Since a local fallback candidate did promote, carry forward the new signal:
- `TRACE_CONFIDENCE_DECAY = 0.10` is now the live scalar frontier inside the
  current winning family
- pure floor adjustments around `TRACE_CONFIDENCE_FLOOR` were not helpful
- toggling `STOCK_DW_PRIOR_ENABLED` and perturbing continuation weights did not
  beat the new incumbent
- the semantic winning family from the previous block is still the main target

Update `oracle_autoresearch/agent_prompt.md` and, if useful,
`oracle_autoresearch/program.md` so the next Gemini campaign starts from the
real current state instead of stale priors.

### 5. Add a Direct Bridge Smoke / Diagnostic Path

Add or document a simple, deterministic way to prove the bridge works before we
launch another 12-experiment block.

Requirements:
- one direct bridge smoke command or helper path
- it should prove:
  - Gemini CLI responds,
  - the response parses,
  - and the loop can consume the candidate
- it should be faster than a full experiment block

This can be a small script, a CLI flag pattern, or a documented command, as
long as it is reliable and easy to run.

### 6. Update Documentation and Add Root Handoff

Update:
- `oracle_autoresearch/README.md`
- `oracle_autoresearch/program.md`
- `oracle_autoresearch/agent_prompt.md`

so they clearly document:
- the recovered bridge behavior,
- the retry / timeout policy,
- the diagnostic path,
- and the latest incumbent priors.

Add `EXECUTION_REPORT_112.md` in the repo root describing:
- what caused the bridge failure,
- what was changed,
- what timeout / retry defaults now exist,
- whether a real bridge candidate was successfully generated after the fix,
- and whether the repo is ready for the next Gemini symbolic block.

## Constraints
- Do **not** change the benchmark infrastructure.
- Do **not** widen the editable surface.
- Do **not** turn this into another modeling sprint.
- Do **not** rely on fallback candidates as the primary "fix."
- Keep all fixes deterministic, reviewable, and scriptable.

## Verification
Run, at minimum:

1. A direct bridge smoke / diagnostic command
   - must produce a real Gemini response that parses successfully

2. `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode bridge_only --max-experiments 1 --dry-run`
   - must succeed without falling back

3. `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode bridge_then_fallback --max-experiments 1 --dry-run`
   - must also succeed, and should not need fallback if the bridge is healthy

4. If the environment requires the local Python path, use the repo's existing
   `.local-python\\3.14\\python.exe`

You do **not** need to run another full 12-experiment block in this sprint.

## Completion Criteria
This sprint is complete when:
- the Gemini bridge no longer times out on the normal Oracle request path,
- the request payload is leaner and more relevant,
- the latest incumbent priors are reflected in the Oracle prompt,
- a direct smoke path proves real Gemini candidate generation works,
- and the repo is ready for the next bounded symbolic-evolution block to return
  to **real semantic Gemini generation**, not local fallback exploitation.
