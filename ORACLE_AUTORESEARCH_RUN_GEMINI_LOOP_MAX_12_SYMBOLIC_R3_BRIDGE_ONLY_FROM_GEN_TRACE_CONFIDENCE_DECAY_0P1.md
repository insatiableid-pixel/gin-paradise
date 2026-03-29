# Symbolic-Evolution Campaign Report: 12-Experiment Symbolic Block R3

## Campaign Overview
- **Start Time:** 2026-03-28 14:45
- **End Time:** 2026-03-28 16:00
- **Total Experiments:** 12 (Experiments #64 through #75)
- **Initial Incumbent:** `gen_trace_confidence_decay_0p1` (Aggregate Score: `0.7948`)
- **Final Incumbent:** `gemini_gcli_0073` (Aggregate Score: `0.8010`)
- **Total Promotions:** 1
- **Bridge Reliability:** 100% (12/12 successful bridge generations, 0 fallbacks)

## Key Results
This campaign successfully utilized the hardened Gemini bridge to explore semantic refinements of the winning formula family. The campaign achieved a breakthrough in the knock lane by incorporating stock-size awareness into the risk floor.

### 1. Best Semantic Candidate (Promoted): `gemini_gcli_0073`
This candidate achieved an aggregate score of **0.8010** by refining `compute_trace_confidence_multiplier()`. It introduced a stock-size interaction that raises the risk floor as the deck depletes, effectively suppressing overconfident late-game knocks.

**Winning Logic (`compute_trace_confidence_multiplier`):**
```python
multiplier = math.exp(-TRACE_CONFIDENCE_DECAY * n_trace_events)
# Late-game knocks are riskier; raise floor as stock depletes
stock_risk_factor = max(0, (31 - stock_size) / 62.0)
dynamic_floor = TRACE_CONFIDENCE_FLOOR + (0.015 * max(0, hero_deadwood - 4)) + (0.1 * stock_risk_factor)
return max(dynamic_floor, min(1.0, multiplier))
```

### 2. High-Potential Candidate: `gemini_gcli_0075`
Although not promoted (due to the 0.005 margin requirement relative to the newly promoted #73), this candidate achieved a raw aggregate score of **0.8052**. It explored a "progress boost" in `compute_eval_weight()` to increase trust in direct evaluation as the game tree shrinks.

## Promotion Analysis
- **`compute_trace_confidence_multiplier()` promotions:** 1 (`gemini_gcli_0073`)
- **`compute_eval_weight()` promotions:** 0 (though #75 showed promise)
- **Bridge Performance:** The `bridge_only` constraint was fully honored. Average response time was ~30s, and the leaner payloads prevented any timeouts.

## Mutation Patterns and Findings
### Winning Patterns
- **Late-Game Risk Awareness:** Explicitly scaling the risk floor by `stock_size` depletion significantly improved knock calibration.
- **Formula Refinement:** Semantic edits that built upon the R1/R2 exponential decay foundation continue to outperform broad resets.

### Losing Patterns
- **Linear Scaling Reversions:** Attempts to revert from exponential decay back to linear scaling (Experiment #74) resulted in score regressions or ties.
- **Over-Calibration:** Candidates that attempted to move too many coefficients at once often regressed the knock lane due to over-tuning.

## Headroom Assessment
Continued headroom exists in the interaction between the two helper functions. The success of `gemini_gcli_0075` (score 0.8052) suggests that a "unified" semantic edit touching both functions simultaneously might provide the next major jump.

## Artifact Paths
- **Final train.py (Incumbent):** `oracle_autoresearch/train.py`
- **Best Candidate Log:** `oracle_autoresearch/artifacts/candidates/candidate_0073_20260328-154917.json`
- **Full Session Summary:** `oracle_autoresearch/artifacts/20260328-160009-agent_session_summary.json`
- **Execution Report:** `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`

## Success Criteria Status
- [x] **Oracle docs/prompt synced to real incumbent:** Yes.
- [x] **12-experiment block runs in bridge_only mode:** Yes.
- [x] **Another semantic promotion achieved:** Yes (`gemini_gcli_0073`).

**Verdict: SUCCESS**
The campaign reached the 0.80 milestone using purely semantic mutations from the hardened Gemini bridge. The sync of priors ensured the agent was working from the true frontier, leading to high-quality hypotheses and successful promotions.
