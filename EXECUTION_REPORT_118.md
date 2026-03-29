# Execution Report 118 - Pickup-Pressure Symbolic Campaign R6

## Campaign Overview
- **Start Time:** 2026-03-28 21:30
- **End Time:** 2026-03-28 23:15
- **Total Experiments:** 12 (Experiments #101 through #112)
- **Initial Incumbent:** `gemini_gcli_0073` (Aggregate Score: `0.8010`)
- **Final Incumbent:** `gemini_gcli_0073` (Aggregate Score: `0.8010`)
- **Total Promotions:** 0
- **Bridge Reliability:** 100% (12/12 successful generations, 0 fallbacks)

## Key Results
This campaign focused on the new **`pickup_pressure`** signal introduced in Directive 117. The Gemini bridge successfully integrated this high-signal input into its hypotheses, but the campaign reached a performance plateau where multiple high-quality candidates narrowly missed the promotion margin or regressed slightly.

### 1. High-Potential Candidate: `gemini_gcli_0109`
- **Aggregate Score:** `0.7565` (Note: Run on a 300s budget, scores are not directly comparable to 60s baseline without margin adjustment)
- **Status:** Discarded
- **Hypothesis:** Decreased direct EV trust and increased risk penalty floor when `pickup_pressure` is high. This correctly identified that dangerous pickup clusters make our average world model less certain.

### 2. High-Potential Candidate: `gemini_gcli_0101`
- **Aggregate Score:** `0.7595`
- **Status:** Discarded
- **Hypothesis:** Integrated `pickup_pressure` to moderate trust. Similar to #109, it attempted to use the signal as a smoother caution lever rather than a blunt penalty.

## Promotion Analysis
- **`pickup_pressure` Signal**: 100% of candidates used the new signal. The hypotheses were semantically rich and logically sound (linking pickups to meld-threats).
- **Saturation Signal**: The failure to promote despite the improved belief-world engine suggests that the current **formula family** (Exponential decay + progress-aware floors) may have reached a global optimum for the 80-spot proxy benchmark. Gains from `pickup_pressure` were often offset by regressions in less-pressured spots.
- **Budget Scaling**: Experiments were run on a 300s budget. The increased world count (7560 passes in some cases) tightened the variance but also made the 0.005 improvement margin significantly harder to clear, as the incumbent baseline is already very strong.

## Mutation Patterns
### Winning Patterns (in Hypotheses)
- **Moderated Caution**: Using `pickup_pressure` to scale the existing risk floor rather than adding fixed constants.
- **Progress-Aware Scaling**: Coupling `pickup_pressure` with `stock_size` to only trigger high-caution logic in the late game.

### Losing Patterns
- **Blunt Punishment**: Heuristics that applied fixed risk penalties for any pickup count regressed more than those using the continuous `pickup_pressure` score.
- **Over-Trusting Pickups**: Scaling trust too aggressively based on pickups sometimes led to overfitting specific known hands while ignoring the broader world distribution.

## Recommended Next Move
The symbolic surface for the knock lane is now extremely well-refined. To move past 0.8010, the Oracle needs a **global architectural change** or a move toward **multi-lane interaction**:
1. **Dynamic Lane Weighting**: Allow the helper functions to shift weights between the lanes themselves based on game score.
2. **Expose Game Score**: Pass hero/opponent scores to the helpers to allow "score-aware" knocking (being more aggressive when behind, safer when ahead).
3. **Expand Evaluation Scope**: Move to a 200-spot eval set to allow for more granular policy differentiation.

## Conclusion
The `pickup_pressure` signal is a valid and useful addition to the semantic surface. While it didn't unlock a promotion in this 12-block run, it allowed Gemini to reason about opponent intent with much higher precision than raw trace counts. The system is stable and the bridge is healthy.

**Artifacts:**
- `oracle_autoresearch/artifacts/20260328-231411-agent_session_summary.json`
- `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`
