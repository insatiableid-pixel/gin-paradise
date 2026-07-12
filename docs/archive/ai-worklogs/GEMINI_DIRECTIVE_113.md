# Gemini Directive 113 - Incumbent Sync and Bridge-Only Symbolic Block R3

## Objective
Run the **next real semantic-evolution block** from the current incumbent, but
first sync the Oracle lab docs/prompt to the actual live `train.py` state.

This sprint has two steps:

1. **Sync the priors** in the Oracle lab so the prompt reflects the real current
   incumbent instead of stale prose.
2. Launch a **bridge-only** 12-experiment Gemini symbolic block so the results
   come from real semantic generation, not local fallback.

## Why This Is The Right Move
Directive 112 fixed the Gemini bridge:
- timeout increased to `300s`
- retry path added
- direct smoke succeeded
- `bridge_only` dry run succeeded

So the worker is back online.

But the current Oracle prose is drifting from the real incumbent state:
- `train.py` now has `N_WORLDS_BASE = 60`
- `TRACE_CONFIDENCE_DECAY = 0.10`
- `STOCK_DW_PRIOR_ENABLED = False`
- and the helper functions are no longer in their original simple baseline form

Before the next symbolic block, Gemini should make the prompt/doc layer match
the actual code and current incumbent. Then it should run the next true semantic
campaign with `bridge_only`.

## Source of Truth
When there is any mismatch between prose and code, trust these in this order:

1. `oracle_autoresearch/train.py`
2. `oracle_autoresearch/loop_state.json`
3. latest candidate logs and execution reports
4. then only after that, `agent_prompt.md` / `program.md`

Do **not** let stale prose override the actual current incumbent.

## What To Read First
Read these files before editing or running:

- `oracle_autoresearch/train.py`
- `oracle_autoresearch/loop_state.json`
- `oracle_autoresearch/agent_prompt.md`
- `oracle_autoresearch/program.md`
- `EXECUTION_REPORT_112.md`
- `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`
- `ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_FROM_GEMINI_GCLI_0025.md`
- `ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_R2_FROM_GEMINI_GCLI_0043.md`

Confirm from the code that the current live baseline includes at least:
- `N_WORLDS_BASE = 60`
- `TRACE_CONFIDENCE_DECAY = 0.10`
- `STOCK_DW_PRIOR_ENABLED = False`
- `CONTINUATION_CHAMPION_WEIGHT = 0.80`
- `CALIBRATION_MAX_WORLDS = 150`
- `CALIBRATION_FRACTION = 0.15`

## Step 1 - Sync the Oracle Priors

Before launching the next block, update:
- `oracle_autoresearch/agent_prompt.md`
- `oracle_autoresearch/program.md`
- and `oracle_autoresearch/README.md` if needed

Requirements:
- make the current-incumbent descriptions match the real `train.py` state
- update any stale text that still describes the helper functions as if they
  were still the original flat/linear baselines
- preserve the benchmark/frozen-infrastructure constraints
- preserve the current winning-family guidance:
  - dynamic EV-gap + trace-richness weighting remains strong
  - non-linear trace-confidence decay with protective floor remains strong
  - pure stock-size-only schedules remain weak
- mention that `TRACE_CONFIDENCE_DECAY = 0.10` is now the scalar frontier
  inside the current winning family

Do **not** widen the mutation surface.

## Step 2 - Run the Next Semantic Block in Bridge-Only Mode

Launch the next 12-experiment block using the real Gemini bridge only:

```powershell
& '.\.local-python\3.14\python.exe' oracle_autoresearch\agent_loop.py `
  --bridge-provider gemini `
  --bridge-mode bridge_only `
  --bridge-timeout 300 `
  --max-experiments 12
```

Do **not** use fallback for this campaign. If bridge generation fails, stop and
report the failure rather than silently converting the block into local search.

## Mutation Focus

Prefer:
- local semantic refinements of the current winning family
- interaction-aware refinements inside:
  - `compute_eval_weight()`
  - `compute_trace_confidence_multiplier()`
- modest coefficient and shape refinements around the current formula family
- small semantic edits with clear justification

Avoid:
- pure stock-size-only schedules as the main idea
- stale scalar replays that ignore the new incumbent state
- edits outside `train.py`
- benchmark / gauntlet / infrastructure changes
- broad formula-family resets unless the current family clearly stalls

## Deliverable
When the run finishes, write this root report:

`ORACLE_AUTORESEARCH_RUN_GEMINI_LOOP_MAX_12_SYMBOLIC_R3_BRIDGE_ONLY_FROM_GEN_TRACE_CONFIDENCE_DECAY_0P1.md`

That report must include:
- start and end times
- initial and final incumbent
- number of experiments and promotions
- confirmation that the run used `bridge_only`
- whether any bridge request failed
- best semantic candidate
- whether continued headroom exists in the current winning family
- losing local variants to avoid next
- exact artifact paths

If the bridge fails during the block, stop and write the same report with:
- failure point
- exact error
- request id
- and the next file/log to inspect

## Success Criteria
This sprint is successful if:
- the Oracle docs/prompt are synced to the real incumbent
- the next 12-experiment block runs in `bridge_only` mode
- and the result gives us one of:
  - another semantic promotion
  - a clear local-saturation signal for the current winning family
  - or a justified handoff back to Claude for the next surface expansion
