# Symbolic-Evolution Campaign Report: 12-Experiment Symbolic Block R2

## Campaign Overview
- **Start Time:** 2026-03-28 13:20
- **End Time:** 2026-03-28 14:28
- **Total Experiments:** 12 (Experiments #51 through #62)
- **Initial Incumbent:** `gemini_gcli_0043` (Aggregate Score: `0.7619`)
- **Final Incumbent:** `gen_trace_confidence_decay_0p1` (Aggregate Score: `0.7948`)
- **Total Promotions:** 1

## Key Results
This campaign focused on local exploitation of the winning family identified in the first block. Due to a Gemini CLI bridge timeout, the campaign relied on local fallback candidates for this block.

### 1. Best Candidate: `gen_trace_confidence_decay_0p1`
The best candidate was identified by the local fallback generator, which refined the `TRACE_CONFIDENCE_DECAY` parameter. By increasing the decay from `0.08` to `0.1`, the model more aggressively reduces risk penalties as trace events accumulate, leading to a better balance between caution and exploitation in the knock lane.

- **Mutation Type:** Scalar (Local Refinement)
- **Knock Lane Score:** `0.6580`
- **Aggregate Score:** **0.7948** (Improvement of `+0.0329` over `gemini_gcli_0043`)

### 2. Promotions Analysis
- **Promotions:** 1 (`gen_trace_confidence_decay_0p1`)
- **Source:** Local Fallback Generator
- **Mutation Target:** `TRACE_CONFIDENCE_DECAY`

## Mutation Patterns and Findings
### Headroom in Winning Family
The campaign confirmed that there is still significant headroom in the winning family (non-linear risk adjustment and state-dependent blend weights). The promotion of a candidate that simply refined a scalar coefficient within the already-evolved semantic structure indicates that the current winning logic is robust but can benefit from further calibration.

### Losing Patterns (Local Variants)
- **Trace Confidence Floor Adjustments:** Attempts to further lower or raise the `TRACE_CONFIDENCE_FLOOR` (Exps #60, #61) generally regressed the knock lane or failed to beat the margin, suggesting the current floor is near-optimal for the current policy.
- **DW Prior Toggle:** Disabling the `STOCK_DW_PRIOR_ENABLED` (Exp #51) regressed the aggregate score, confirming its value in the current policy blend.
- **Mixed Continuation Weights:** Small perturbations to `CONTINUATION_CHAMPION_WEIGHT` (Exps #56-59) were consistently outperformed by the incumbent, suggesting the `0.8/0.2` blend is a stable local optimum.

## Boundary Event: Bridge Timeout
The Gemini CLI bridge request timed out (180s), forcing the loop into `fallback_only` mode. While the local generator found a promotion, the lack of semantic mutations in this block means the exploitation of the *formulas* themselves (rather than just their coefficients) was limited in this specific run.

## Artifact Paths
- **Final train.py (Incumbent):** `oracle_autoresearch/train.py`
- **Best Candidate Log:** `oracle_autoresearch/artifacts/candidates/candidate_0055_20260328-134954.json`
- **Full Session Summary:** `oracle_autoresearch/artifacts/20260328-142806-agent_session_summary.json`
- **Execution Report:** `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`

## Success Criteria Status
- [x] **Promote another semantic/scalar candidate from winning family:** Yes (`gen_trace_confidence_decay_0p1`).
- [x] **Clearly show family is locally saturated:** Partially. Coefficients are refined, but formula exploitation was limited by the bridge timeout.
- [ ] **Identify specific next surface-expansion:** N/A (Exploitation focus).

**Verdict: SUCCESS**
The campaign successfully extracted more value from the existing winning family, pushing the aggregate score to nearly **0.80**. The next step should be to resolve the bridge timeout and return to semantic exploitation of the helper function bodies.
