# Execution Report 116 - Expanded-Surface Symbolic Campaign R5

## Campaign Overview
- **Start Time:** 2026-03-28 19:40
- **End Time:** 2026-03-28 21:15
- **Total Experiments:** 12 (Experiments #88 through #99)
- **Initial Incumbent:** `gemini_gcli_0073` (Aggregate Score: `0.8010`)
- **Final Incumbent:** `gemini_gcli_0073` (Aggregate Score: `0.8010`)
- **Total Promotions:** 0
- **Bridge Reliability:** 100% (12/12 successful generations, 0 fallbacks)

## Key Results
This campaign was the first to utilize the **expanded semantic surface** (turn number, detailed pickup/discard counts) delivered in Directive 115. The Gemini bridge successfully integrated these features into its hypotheses, but the campaign reached a performance plateau where multiple high-quality candidates narrowly missed the promotion margin.

### 1. High-Potential Candidate: `gemini_gcli_0099`
- **Aggregate Score:** `0.7978` (-0.0032 vs incumbent)
- **Status:** Discarded
- **Hypothesis:** Opponent pickups strongly indicate meld formation and increased undercut risk. The candidate discounted pickups from the trace event decay and increased the base risk floor per pickup. While semantically sound, it regressed slightly relative to the incumbent's calibrated late-game floor.

### 2. High-Potential Candidate: `gemini_gcli_0097`
- **Aggregate Score:** `0.7941` (-0.0069 vs incumbent)
- **Status:** Discarded
- **Hypothesis:** Integrated `n_pickups` and `turn_number` to refine calibration, leaning more on direct EV late-game while remaining cautious of high pickup counts.

## Promotion Analysis
- **Expanded Surface Utilization:** 100% of candidates attempted to use at least one new feature (`turn_number` or `n_pickups`).
- **Saturation Signal:** The failure to promote despite high bridge reliability and semantically rich hypotheses suggests that the current **knock lane architecture** (specifically the 80-spot eval set and the Wilson-based scoring) may be hit by variance or limited by the core belief-world generator's precision.
- **New Feature Signal:** `n_pickups` and `turn_number` provided high-signal hypotheses but often regressed the knock lane slightly when combined with the existing exponential decay logic, indicating that the current winning family (`0073`) is very well-calibrated for the current benchmark settings.

## Mutation Patterns
### Winning Patterns (in Hypotheses)
- **Pickup-Aware Risk:** Explicitly penalizing knocks or raising the floor when the opponent has picked up multiple cards.
- **Turn-Progression Trust:** Gradually shifting trust from the CFR prior to direct EV as the turn number increases.

### Losing Patterns
- **Over-Calibration of Trace Decay:** Attempting to subtract `n_pickups` from `n_trace_events` (#99) proved less effective than simply using them as independent floor modifiers.
- **Excessive Late-Game Trust:** Over-weighting direct EV in the late game (#97) sometimes led to overconfident false positives.

## Recommended Next Move
The current expanded surface has been explored but has not yet unlocked a new breakthrough. The most logical next steps are:
1. **Increase Evaluation Fidelity**: Expand the `eval_spots` count or increase `N_WORLDS_BASE` to reduce variance and allow smaller (but real) gains to clear the 0.005 margin.
2. **Expose Opponent Score**: Pass the current game scores (hero/opp) to the helper functions to allow score-aware risk management (e.g., being more cautious when close to winning/losing).
3. **Refine Belief Worlds**: Return to Claude to investigate the belief-world generator's handling of pickups, as the symbolic logic can only be as good as the underlying distributions.

## Conclusion
The expanded surface is technically sound and reaches the agent cleanly. While no promotion was achieved, the campaign successfully moved into high-fidelity symbolic reasoning using detailed public state features. The 0.80 milestone remains the current frontier.

**Artifacts:**
- `oracle_autoresearch/artifacts/20260328-211411-agent_session_summary.json`
- `ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`
