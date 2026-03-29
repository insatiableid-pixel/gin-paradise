# Symbolic-Evolution Campaign Report: 12-Experiment Symbolic Block

## Campaign Overview
- **Start Time:** 2026-03-28 11:40
- **End Time:** 2026-03-28 12:47
- **Total Experiments:** 12 (Experiments #39 through #50)
- **Initial Incumbent:** `gemini_gcli_0025` (Aggregate Score: `0.6293`)
- **Final Incumbent:** `gemini_gcli_0043` (Aggregate Score: `0.7619`)
- **Total Promotions:** 2

## Key Results
The campaign successfully transitioned the Oracle from a fixed-weight baseline to a dynamic, state-dependent policy logic.

### 1. Best Semantic Candidate: `gemini_gcli_0043`
This candidate achieved the highest aggregate score of **0.7619** by introducing a dynamic blend weight in `compute_eval_weight()`. It trust the direct EV estimation more when the decision is clear (large EV gap) and when trace data is rich, while relying on the CFR prior for uncertain, low-information states.

**Winning Logic (`compute_eval_weight`):**
```python
gap_confidence = 1.0 - math.exp(-abs(ev_gap) * 2.5)
trace_confidence = min(1.0, n_trace_events / 10.0)
dynamic_weight = (DIRECT_EVAL_WEIGHT - 0.15) + (0.15 * gap_confidence) + (0.10 * trace_confidence)
return max(0.5, min(1.0, dynamic_weight))
```

### 2. First Promotion: `gemini_gcli_0039`
This candidate provided the initial jump (from 0.6293 to 0.7458) by evolving `compute_trace_confidence_multiplier()` to use exponential decay for risk reduction and a deadwood-scaled floor to prevent overconfidence on marginal high-DW knocks.

**Winning Logic (`compute_trace_confidence_multiplier`):**
```python
multiplier = math.exp(-TRACE_CONFIDENCE_DECAY * n_trace_events)
dynamic_floor = TRACE_CONFIDENCE_FLOOR + (0.015 * max(0, hero_deadwood - 4))
return max(dynamic_floor, min(1.0, multiplier))
```

## Promotion Analysis
- **`compute_eval_weight()` promotions:** 1 (`gemini_gcli_0043`)
- **`compute_trace_confidence_multiplier()` promotions:** 1 (`gemini_gcli_0039`)
- **Scalar Fallbacks:** No scalar-only fallback candidates outperformed the semantic mutations in this block. Gemini strongly preferred semantic edits as directed.

## Mutation Patterns
### Winning Patterns
- **Non-linear Blend Weights:** Combining `math.exp` with state features (EV gap, trace events) significantly outperformed fixed constants.
- **Asymmetric Risk Floors:** Raising the risk-adjustment floor specifically for high-deadwood hands effectively suppressed overconfident marginal knocks.

### Losing Patterns
- **Pure Stock-Size Schedules:** Mutations that only looked at `stock_size` (Experiments #45-49) generally failed to improve upon the more nuanced interaction terms found in the winners.
- **Over-parameterized Sqrt/Polynomials:** Some candidates (Exp #44) attempted complex interaction terms that regressed the knock lane, likely due to overfitting the small eval set.

## Artifact Paths
- **Final train.py (Incumbent):** `oracle_autoresearch/train.py`
- **Best Candidate Log:** `oracle_autoresearch/artifacts/candidates/candidate_0043_20260328-120638.json`
- **Full Session Summary:** `oracle_autoresearch/artifacts/20260328-124734-agent_session_summary.json`
- **Execution Report:** `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`

## Success Criteria Status
- [x] **Semantic candidate promoted:** Yes (`gemini_gcli_0043`).
- [x] **Clear winning mutation family:** Yes (Exponential decay + EV-gap weighted trust).
- [x] **Clear losing mutation family:** Yes (Simple stock-size linear schedules).

**Verdict: SUCCESS**
The campaign proved that the new semantic mutation surface is highly effective for symbolic evolution. The jump from 0.6293 to 0.7619 aggregate score represents a major advancement in Oracle policy quality.
