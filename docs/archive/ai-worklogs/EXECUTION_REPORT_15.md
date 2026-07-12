# Execution Report 15: Mathematical Replay Evaluation MVP

**Date:** March 12, 2026  
**Directive:** `CLAUDE_DIRECTIVE_15.md` — Mathematical Replay Evaluation & PR-Style MVP  
**Project:** Gin Paradise — Competitive Gin Rummy Platform

---

## Objective

Build a structured, engine-backed replay evaluation layer that uses the existing Python Gin Rummy engine (Apex v2) to score decision quality and identify per-turn mistakes. Surface results in the replay viewer as a clear "engine accuracy" metric alongside the existing narrative AI coaching.

## Pre-Sprint State

Gin Paradise had 314 passing tests across 14 test files, with transcript-driven AI analysis (Gemini) already providing narrative coaching on replays. No mathematical decision evaluation existed — the analysis was purely LLM-generated commentary without engine-grounded scoring.

---

## Actions Taken

### 1. Python Evaluation Engine (`gin_rummy/evaluator.py`)

**New file:** 420 lines. Accepts replay transcript JSON via stdin, produces structured per-turn evaluations via stdout.

**Evaluated Decision Types:**

| Type | Methodology | Reliability |
|------|-------------|-------------|
| **Discard** | Apex v2 actual-DW scoring: computes resulting deadwood for all legal discards, identifies engine-preferred card, measures DW cost | **First-class** — most reliable, full information |
| **Knock** | Simplified Apex v2 heuristics: gin always knock, low stock always knock, DW/turn/hand-shape thresholds | **Strong** — clear right/wrong in most cases |
| **Draw** | Meld-completion detection, DW improvement analysis for discard-pile draws | **Included with caveat** — limited by hidden opponent hand and unknown stock card |

**Severity Classification:**

| Severity | DW Cost Threshold | Meaning |
|----------|-------------------|---------|
| `best` | ≤0 | Matches or exceeds engine choice |
| `inaccuracy` | 1–3 | Slightly suboptimal |
| `mistake` | 4–7 | Material deadwood cost |
| `blunder` | ≥8 | Serious strategic error |

**Safety Bounds:**
- 30-second wall-clock timeout
- Maximum 2000 actions per transcript
- Minimum 2 players required

### 2. TypeScript Python Bridge (`server/analysis/pythonBridge.ts`)

**New file:** 155 lines. Subprocess bridge between Node.js backend and Python evaluator.

**Architecture:**
1. Check SQLite cache (`replay_evaluations` table) first
2. Spawn `python -m gin_rummy.evaluator` as subprocess
3. Send transcript JSON via stdin
4. Collect evaluation JSON from stdout
5. Cache successful results in SQLite
6. 30s timeout with SIGTERM kill on expiry
7. Graceful degradation: returns structured error when Python unavailable

**Configurable via env vars:**
- `PYTHON_PATH` — Python executable (default: `python`)
- `EVAL_TIMEOUT_MS` — Timeout in ms (default: 30000)

### 3. Evaluation API Route (`server/routes/replayEvaluation.ts`)

**New file:** 135 lines. Two endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/replays/:id/evaluation` | POST | Compute (or retrieve cached) evaluation. Rate limited 15/5min |
| `/api/replays/:id/evaluation` | GET | Retrieve cached evaluation only. No Python invocation |

**Access Control:** Both endpoints enforce participant-only access (same as existing replay routes). Non-participants get 403, unauthenticated get 401.

**Graceful Degradation:** If Python fails, returns:
```json
{
  "evaluation": null,
  "source": "error",
  "error": "Human-readable message",
  "meta": { "replayId": "...", "methodology": "apex_v2_engine_agreement", "available": false }
}
```
The replay viewer is *never* broken by evaluation failures.

### 4. Database Schema Extension

**New table:** `replay_evaluations`

| Column | Type | Purpose |
|--------|------|---------|
| `replay_id` | TEXT PRIMARY KEY | Links to replays table |
| `evaluation_json` | TEXT NOT NULL | Full evaluation result |
| `engine_version` | TEXT DEFAULT 'apex_v2' | For future version tracking |
| `created_at` | DATETIME | Cache timestamp |

**Caching strategy:** On-demand computation, persisted in SQLite after first successful evaluation. Subsequent requests (GET or POST) return cached results instantly. INSERT OR REPLACE allows re-evaluation to overwrite stale cache.

### 5. Frontend Integration (`src/pages/Replays.tsx`)

**Modified:** Added ~200 lines for evaluation UI.

**Changes:**
- New "Engine Eval" button (teal-themed) alongside existing "AI Coach" button (indigo-themed)
- Dedicated evaluation panel with:
  - Engine accuracy percentage (4xl bold, color-coded by score)
  - Score label badge (excellent/good/fair/needs_improvement/poor)
  - Severity distribution per player (✓ best, ○ inaccuracy, △ mistake, ⚠ blunder)
  - Methodology description text
  - Evaluation timing and source info
- Per-turn severity badges on the action timeline:
  - Non-best actions get inline colored badges
  - Discard mistakes show engine-preferred alternative
  - DW cost shown for costly errors
- Loading state with animated spinner
- Error state with amber warning panel and guidance text

**Design language:** Mathematical evaluation uses **teal** theme to distinguish from narrative AI coaching's **indigo** theme.

### 6. Server + Test Helpers Wiring

**Modified:** `server.ts` and `tests/helpers.ts`
- Added import and Express route mounting for `replayEvaluationRoutes`
- Test helper creates full Express app with evaluation route for integration testing

---

## What the Score Actually Means

**Engine Accuracy** measures **how often the player's decisions matched the Apex v2 engine's preferred choice**. This is reported honestly:

- It is an **engine agreement rate**, not a perfect-play rating
- The methodology is labeled `apex_v2_engine_agreement` in all API responses and UI
- The evaluator uses **heuristic scoring** (actual deadwood computation, simplified knock thresholds), not CFR or solved-game proof
- Draw evaluations carry an explicit `caveat: "draw_hidden_info"` flag because the evaluator doesn't know the stock card
- The evaluation panel includes a visible methodology description explaining these limitations

**What it is NOT:**
- NOT a solved-game oracle or EV calculation
- NOT perfect play — it's measuring agreement with a strong heuristic bot
- NOT competitive analysis — it doesn't model opponent strategy

---

## Caching & Performance

- **Strategy:** On-demand, persisted in SQLite
- **First evaluation:** Spawns Python subprocess (~2-5 seconds typical)
- **Subsequent requests:** Instant from SQLite cache
- **Timeout:** 30 seconds hard cap with process kill
- **Cache invalidation:** Manual only (no auto-expiry). Re-POST forces re-evaluation if cache exists

---

## Current Limitations

1. **Draw evaluation is limited** — Without knowing the stock card or opponent hand, draw decisions are evaluated only by whether the discard pile card would help. Marked with caveat in output.
2. **Knock thresholds are simplified** — Full Apex v2 uses Monte Carlo sampling of opponent hands for knock decisions. The evaluator uses simplified heuristics since replay transcripts don't expose opponent hands.
3. **Hand reconstruction depends on transcript data** — If transcripts don't include card details (e.g., stock draws without card reveal), some decisions can't be evaluated. The evaluator gracefully skips unevaluable decisions.
4. **Python runtime required** — The evaluator requires Python 3 with the `gin_rummy` package importable. When unavailable, the endpoint degrades gracefully.

---

## Verification

### Python Evaluator Tests

```
test_evaluator.py — 24 tests passed
  TestCardParsing — 6 tests (standard, unicode, 10-format, face cards, invalid, lowercase)
  TestDiscardEvaluation — 3 tests (optimal→best, bad→penalized, result structure)
  TestKnockEvaluation — 4 tests (gin→always knock, high DW→None, low stock→force, structure)
  TestDrawEvaluation — 3 tests (meld-completing→best, declined meld→mistake, structure)
  TestSummaryBuilding — 4 tests (empty→insufficient, perfect→100%, mixed→correct, labels)
  TestFullPipeline — 4 tests (empty actions, too few players, too many actions, basic transcript)
```

### Integration Tests

```
tests/evaluation.test.ts — 18 tests passed
  Replay Evaluation API — Authentication & Access (4)
  Replay Evaluation API — Graceful Degradation (1)
  Replay Evaluation API — Caching (3)
  Replay Evaluation — SQLite Cache Operations (4)
  Replay Evaluation — Access Control for GET (2)
  Replay Evaluation — Regression Coverage (4)
```

### Regression

All 314 pre-existing tests continue to pass. The evaluation endpoint is additive — existing replay analysis, replay viewing, wallet, admin, and tournament features are unaffected.

---

## Files Created (7 files)

| # | File | Lines | Purpose |
|---|------|-------|---------|
| 1 | `gin_rummy/evaluator.py` | 420 | Python evaluation engine (Apex v2 decision scoring) |
| 2 | `gin-galaxy/server/analysis/pythonBridge.ts` | 155 | TypeScript↔Python subprocess bridge with caching |
| 3 | `gin-galaxy/server/routes/replayEvaluation.ts` | 135 | Evaluation API endpoints (POST compute + GET cached) |
| 4 | `gin-galaxy/tests/evaluation.test.ts` | 500 | Integration tests for evaluation pipeline |
| 5 | `test_evaluator.py` | 350 | Python unit tests for evaluator logic |
| 6 | `EXECUTION_REPORT_15.md` | — | This report |
| 7 | `PROJECT_STATUS.md` | — | Updated with §23 sprint summary |

## Files Modified (4 files)

| # | File | Change |
|---|------|--------|
| 1 | `gin-galaxy/server.ts` | Added evaluation route import and mounting |
| 2 | `gin-galaxy/tests/helpers.ts` | Added evaluation route to test Express app |
| 3 | `gin-galaxy/src/pages/Replays.tsx` | Added evaluation UI (button, panel, per-turn badges) |
| 4 | `PROJECT_STATUS.md` | Updated architecture, endpoints, tests, §23 sprint summary |

---

## Acceptance Criteria Checklist

| Criterion | Status |
|-----------|--------|
| Web platform can obtain structured replay evaluation from Python engine | ✅ |
| Replay viewers can see summary score and per-turn mistake tagging | ✅ |
| Methodology documented honestly (not presented as solved oracle) | ✅ |
| Access control correct for replay evaluation | ✅ |
| Evaluator failure degrades gracefully without breaking replay UX | ✅ |
| Automated tests for evaluation path exist and pass | ✅ (24 Python + 18 TypeScript) |
| `EXECUTION_REPORT_15.md` saved to workspace root | ✅ |
| `PROJECT_STATUS.md` updated | ✅ |

---

## Summary

The Mathematical Replay Evaluation MVP is **complete**. The web platform can now obtain structured, engine-backed decision evaluation from the Python Gin Rummy engine via a subprocess bridge. The replay viewer surfaces an engine accuracy score with per-turn mistake tagging alongside the existing AI narrative coaching.

The evaluation methodology is honestly documented as an engine agreement rate using Apex v2 heuristics — not a solved-game oracle. The system degrades gracefully when Python is unavailable, caches results in SQLite for performance, and is fully tested with 42 new tests (24 Python + 18 TypeScript) alongside zero regressions to the existing 314-test suite.
