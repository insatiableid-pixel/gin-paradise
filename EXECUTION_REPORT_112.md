# Execution Report 112 - Bridge Reliability Recovery

## Objective
Recover reliable Gemini CLI candidate generation for the Oracle autoresearch loop after the timeout-driven fallback block in Directive 111.

## Root Cause Analysis
The 180s timeout was insufficient for the large prompt payload (40+ experiments in history and full `train.py` source) when the Gemini CLI backend was under load or performing complex symbolic reasoning. The lack of a retry mechanism meant that a single timeout would force the entire loop into fallback mode.

## Changes Implemented

### 1. Hardened Timeout and Retry Path
- **Default Timeout**: Increased from 180s to **300s** across `gemini_bridge.py`, `agent_loop.py`, and `run_gemini_loop.ps1`.
- **Retries**: Added **1 bounded retry** in `invoke_gemini_bridge()` before falling back.
- **Improved Logging**: Added clear logs for request IDs, timeout durations, retry attempts, and final outcomes (Success/Failure/Exception).

### 2. Leaner Bridge Requests
- **History Truncation**: Reduced `experiment_history_summary` from 40 to **15 entries**, focusing on the most recent findings.
- **Source Optimization**: Implemented `_optimize_train_py_for_prompt()` to extract only the target functions (`compute_eval_weight`, `compute_trace_confidence_multiplier`) and relevant headers, significantly reducing token bloat.
- **Registry Removal**: Omitted the full `param_registry` from the JSON payload when focusing on semantic helper function mutations.

### 3. Updated Research Priors
- Updated `agent_prompt.md` and `program.md` to include the latest incumbent `gen_trace_confidence_decay_0p1` (`0.7948`).
- Instructed the agent to focus on refining the successful formula families (Exponential decay + EV-gap weighting) rather than scalar knobs.

## Verification Results

### 1. Bridge Smoke Test
Run: `python oracle_autoresearch/smoke_bridge.py`
- **Result**: SUCCESS
- **Latency**: 44.3s (well within 300s limit)
- **Candidate Quality**: Generated a high-confidence semantic mutation for `compute_trace_confidence_multiplier` involving stock-size interaction.

### 2. Agent Loop Dry Run
Run: `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode bridge_only --max-experiments 1 --dry-run`
- **Result**: SUCCESS
- **Outcome**: Successfully generated and parsed a real Gemini candidate without needing fallback.

## Conclusion
The Gemini bridge is fully recovered and significantly more robust than before. The loop is now ready for the next real symbolic-evolution campaign.

**Artifacts:**
- `oracle_autoresearch/gemini_bridge.py` (Updated)
- `oracle_autoresearch/smoke_bridge.py` (New)
- `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md` (Updated)
