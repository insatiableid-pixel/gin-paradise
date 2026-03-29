# Symbolic-Evolution Campaign Report: 12-Experiment Symbolic Block R4 (Coupled)

## Campaign Overview
- **Start Time:** 2026-03-28 16:15
- **End Time:** 2026-03-28 18:37
- **Total Experiments:** 12 (Experiments #76 through #87)
- **Initial Incumbent:** `gemini_gcli_0073` (Aggregate Score: `0.8010`)
- **Final Incumbent:** `gemini_gcli_0073` (Aggregate Score: `0.8010`)
- **Total Promotions:** 0
- **Bridge Reliability:** 100% (12/12 successful bridge generations, 0 fallbacks)

## Key Results
This campaign focused on **coupled semantic edits** to exploit interactions between EV-gap trust and late-game risk floors. While the hardened Gemini bridge successfully generated complex dual-function hypotheses, the campaign yielded no promotions as the best candidates fell just short of the 0.005 improvement margin.

### 1. High-Quality Candidate: `gemini_gcli_0080`
- **Aggregate Score:** `0.8055` (+0.0045 vs incumbent)
- **Status:** Discarded (Below 0.005 margin)
- **Hypothesis:** Unified progress-aware scaling for both helper functions. It refined the `0073` stock-size interaction and adjusted the `0075` progress-boost in eval weight. It missed promotion by only `0.0005`.

### 2. High-Quality Candidate: `gemini_gcli_0076`
- **Aggregate Score:** `0.8040` (+0.0030 vs incumbent)
- **Status:** Discarded (Below 0.005 margin)
- **Hypothesis:** Synergized the `0075`-style late-game EV trust with the `0073` late-game trace floor.

## Promotion Analysis
- **Coupled Dual-Function Edits:** Most candidates (#76, #80, #81, #84, #86, #87) were intentional coupled edits.
- **Breakthroughs:** No promotion was achieved, but the raw scores consistently hovered in the `0.8040 - 0.8055` range, suggesting the coupled approach is identifying a high-quality (but incremental) local optimum.
- **Marginal Performance:** The 0.005 promotion margin is now a significant barrier for this formula family. Multiple candidates outperformed the incumbent's raw score but were discarded.

## Mutation Patterns and Findings
### Winning Patterns (Raw Score Gains)
- **Progress-Aware Trust Scaling:** Explicitly coupling `stock_size` depletion to *both* functions simultaneously (trusting EV more AND being more cautious about risk) appears to be the most effective way to squeeze more performance out of the current architecture.

### Losing Patterns
- **Over-parameterization:** Candidates that introduced more than two new interaction terms simultaneously tended to regress the knock lane (#85, #87), likely due to over-fitting the specific calibration set distributions.
- **Baseline Reversions:** Small regressions toward earlier, less-dynamic formulas consistently failed to beat the incumbent.

## Headroom Assessment
The current winning family (Exponential decay + EV-gap trust + stock-size floor) appears to be **locally saturated**. While raw gains are still being found (up to `0.8055`), they are becoming too small to reliably clear the promotion margin. 

**Recommendation:** The next campaign should consider widening the mutation surface or handing back to Claude to introduce new state features (e.g., turn number, opponent pickup/discard counts) into the helper functions.

## Artifact Paths
- **Current train.py (Incumbent):** `oracle_autoresearch/train.py`
- **Best Raw Candidate Log (#80):** `oracle_autoresearch/artifacts/candidates/candidate_0080_20260328-175514.json`
- **Full Session Summary:** `oracle_autoresearch/artifacts/20260328-183653-agent_session_summary.json`
- **Execution Report:** `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`

## Success Criteria Status
- [ ] **Promote a coupled semantic candidate:** No (missed margin).
- [x] **Stronger single-function promotion:** No.
- [x] **Clean saturation signal:** Yes. The consistent failure to clear the margin despite raw gains indicates local saturation of the current formula family.

**Verdict: SATURATED**
The campaign successfully validated the coupled approach and the robustness of the bridge, but clearly signaled that we have extracted the majority of the "low-hanging" symbolic value from the current two-function mutation surface.
