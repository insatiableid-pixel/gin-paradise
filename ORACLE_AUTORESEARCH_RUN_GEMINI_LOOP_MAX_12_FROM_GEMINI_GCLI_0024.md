# Oracle Autoresearch Execution Report: 12 Experiments from gemini_gcli_0024

## Session Metadata
- **Start Time:** Friday, March 27, 2026, 19:44:10 (approx)
- **End Time:** Friday, March 27, 2026, 20:44:28
- **Initial Incumbent:** `gemini_gcli_0024` (Score: `0.6243`)
- **Final Incumbent:** `gemini_gcli_0025` (Score: `0.6293`)
- **Experiments Run:** 12 (#25 to #36)
- **Promotions:** 1 (`gemini_gcli_0025`)

## Performance Summary
- **Best Candidate:** `gemini_gcli_0025` (Score: `0.6293`, Delta: `+0.005`)
  - **Hypothesis:** Increasing `CALIBRATION_MAX_WORLDS` to 150 to support the high `DIRECT_EVAL_WEIGHT` of 0.90.
- **Worst Candidate:** `gemini_gcli_0026`, `0031`, `0033`, `0034` (Score: `0.5161`, Delta: `-0.1132`)
  - **Losing Direction:** Aggressive increases to both `CALIBRATION_FRACTION` and `CALIBRATION_MAX_WORLDS` simultaneously.

## Research Insights
- **Losing Directions to De-prioritize:**
  - **Aggressive Calibration Expansion:** Increasing `CALIBRATION_FRACTION` beyond 0.15 (e.g., to 0.20 or higher) combined with high `CALIBRATION_MAX_WORLDS` (200+) resulted in significant regressions (Score ~0.5161). The overhead or data-shift from larger calibration sets appears to hurt more than the threshold precision helps.
  - **Redundant Calibration Testing:** The model spent many experiments (#26-#36) trying various combinations of `CALIBRATION_FRACTION` and `CALIBRATION_MAX_WORLDS`. Most of these were strongly negative. Future runs should pivot away from calibration-tuning and toward other local neighborhood parameters like `TRACE_CONFIDENCE_FLOOR` or `EARLY_EXIT` parameters while keeping calibration at the new stable point (`MAX_WORLDS = 150`, `FRACTION = 0.15`).

## Main Artifacts
- **Execution Report:** `C:\Users\mrwat\OneDrive\Desktop\Gin Rummy\ORACLE_AUTORESEARCH_EXECUTION_REPORT.md`
- **Session Summary:** `C:\Users\mrwat\OneDrive\Desktop\Gin Rummy\oracle_autoresearch\artifacts\20260327-204428-agent_session_summary.json`
- **Incumbent Metadata:** `C:\Users\mrwat\OneDrive\Desktop\Gin Rummy\oracle_autoresearch\loop_state.json`
- **Candidate Logs:** `C:\Users\mrwat\OneDrive\Desktop\Gin Rummy\oracle_autoresearch\artifacts\candidates\`

---
*This report summarizes the autonomous research loop performed by Gemini CLI.*
