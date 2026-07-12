# EXECUTION_REPORT_17.md — Training Dashboard and Evaluation Hardening Sprint

**Sprint:** CLAUDE_DIRECTIVE_17  
**Date:** March 12, 2026  
**Objective:** Turn the replay-evaluation capability into a first-class training product while cleaning up the known evaluation instability so the platform returns to a fully green, trustworthy test state.

---

## 1. Deliverables Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Evaluation test/rate-limit instability resolved | ✅ Complete | Root cause identified and fixed with `resetAllRateLimiters()` + wrong endpoint URL fix |
| Full test suite honestly green | ✅ Complete | 400/400 tests pass (was 381/385+4 pre-existing failures) |
| Dedicated Training Center surface | ✅ Complete | `/training` route with prominent nav placement |
| Engine accuracy overview card | ✅ Complete | Average accuracy, trend indicator (improving/declining/stable) |
| Win rate and session stats | ✅ Complete | Win rate percentage, sessions played/evaluated |
| Severity distribution visualization | ✅ Complete | Horizontal bar chart with best/inaccuracy/mistake/blunder breakdown |
| Best & most instructive session highlights | ✅ Complete | Clickable cards linking to highest/lowest accuracy replays |
| Session list with evaluation badges | ✅ Complete | Inline severity badges, accuracy scores, result indicators |
| Recurring mistake type detection | ✅ Complete | Backend detects most common non-best decision types |
| Training API (backend) | ✅ Complete | `GET /api/training/summary` + `GET /api/training/session/:id` |
| Session review productization | ✅ Complete | Coherent session review with key moments, severity, cached eval data |
| Trend and retention signals | ✅ Complete | Accuracy trend detection, best/worst sessions, recurring mistakes |
| Methodology documentation | ✅ Complete | In-page methodology card explaining engine vs AI coaching distinction |
| Automated test coverage | ✅ Complete | 15 new training tests + regression coverage for eval/replays/wallet/leaderboard |
| Admin test DB-pollution fix | ✅ Complete | Fixed pre-existing admin player search test instability |
| PROJECT_STATUS.md updated | ✅ Complete | Reflects sprint completion |

---

## 2. Current Context

Gin Paradise's evaluation system was carrying 4 pre-existing test failures acknowledged in EXECUTION_REPORT_16. The training/evaluation capability was functional but hidden inside the replay detail flow. This sprint elevated it into a dedicated training product and resolved all test instability.

---

## 3. Actions Taken (Chronological)

### 3.1 Evaluation Hardening

1. **Root Cause Analysis:** Investigated the 4 failing tests in `evaluation.test.ts`. Discovered two independent issues:
   - **Rate limiter exhaustion:** All test requests share IP `127.0.0.1`. The auth rate limiter (20 requests / 15 minutes) was exhausted when creating 14+ test users (each needing register + login = 28+ hits). The 1-second retry delay in the test helper was ineffective against a 15-minute window.
   - **Incorrect wallet endpoint:** The regression test used `/api/wallet/balance` but the actual endpoint is `/api/wallet`. The SPA fallback served HTML instead of JSON, causing a JSON parse failure.

2. **Rate Limiter Fix:** Added a `resetAllRateLimiters()` export to `server/middleware/rateLimit.ts`. This function clears all rate limiter stores via a module-level registry. The evaluation test calls it before each user creation.

3. **Wallet Endpoint Fix:** Corrected the path from `/api/wallet/balance` to `/api/wallet` in the evaluation regression test.

4. **Admin Test Fix (bonus):** Discovered a pre-existing admin player search test failure caused by DB pollution (accumulated `regular_*` users from previous runs exceeded the LIMIT 20 result set). Fixed by using the specific unique username in the search query instead of the generic prefix.

### 3.2 Training API (Backend)

5. **Created `server/routes/training.ts`** with two endpoints:
   - `GET /api/training/summary` — Aggregates recent replays, extracts cached evaluations, computes trends (accuracy, severity distribution, win rate, best/worst sessions, recurring mistake types)
   - `GET /api/training/session/:id` — Returns a coherent session review combining replay data, cached evaluation, and key moments (sorted by severity)

6. **Design decisions:**
   - **Reuses cached evaluations only** — never re-calls Python evaluator or Gemini. Players must run evaluation from the replay detail page first.
   - **Access control** — Both endpoints require authentication. Session detail enforces participant-only access (403 for non-participants).
   - **Methodology honesty** — Response includes explicit methodology metadata: "Engine accuracy measures agreement with Apex v2 heuristic evaluation. This is not a solved-game oracle."
   - **Trend detection** — Compares first-half vs second-half of evaluated sessions. ±3% threshold distinguishes improving/declining/stable.
   - **Key moments** — Extracts up to 5 non-best decisions sorted by severity (blunders first).

7. **Registered routes** in both `server.ts` and `tests/helpers.ts` at `/api/training`.

### 3.3 Training Dashboard (Frontend)

8. **Created `src/pages/Training.tsx`** — a dedicated Training Center page featuring:
   - **Hero stat cards:** Engine accuracy (with trend indicator), win rate, sessions evaluated, decision quality badges
   - **Best/Most Instructive session highlights** — clickable cards linking to replay detail
   - **Severity distribution bar** — horizontal stacked bar chart with legend
   - **Session list** — recent matches with inline win/loss badges, accuracy scores, severity counts, duration, and "not evaluated" indicators
   - **Methodology card** — explains engine accuracy vs AI coaching, acknowledges heuristic limitations

9. **Design language:** Matches the existing dark theme with teal accent for training-specific elements (distinct from indigo for analysis, emerald for success). Uses glassmorphism cards, `GraduationCap` icon, tabular nums for accuracy display.

10. **Navigation integration:**
    - Added `/training` route in `App.tsx`
    - Added "Training" nav item in `Layout.tsx` between Analysis and Replays with `GraduationCap` icon
    - Prominent placement reinforces training as a core product surface

### 3.4 Testing and Verification

11. **Created `tests/training.test.ts`** with 15 tests across 4 describe blocks:
    - Authentication & access (2 tests)
    - Empty state handling (1 test)
    - Replay aggregation + evaluation trends + recurring mistakes (4 tests)
    - Session detail with access control (5 tests)
    - Regression coverage for existing APIs (4 tests covering replays, evaluation, wallet, leaderboard)

12. **Full suite verification:** 400/400 tests pass with zero failures across 17 test files.

---

## 4. Files Created

| File | Purpose |
|------|---------|
| `gin-galaxy/server/routes/training.ts` | Training API backend (summary + session detail endpoints) |
| `gin-galaxy/src/pages/Training.tsx` | Training Center frontend page |
| `gin-galaxy/tests/training.test.ts` | 15 automated tests for training features |

## 5. Files Modified

| File | Change |
|------|--------|
| `gin-galaxy/server/middleware/rateLimit.ts` | Added `resetAllRateLimiters()` export and rate limiter store registry |
| `gin-galaxy/tests/evaluation.test.ts` | Import `resetAllRateLimiters`, call before user creation; fix wallet endpoint path |
| `gin-galaxy/tests/admin.test.ts` | Import `resetAllRateLimiters`, call in beforeAll; use specific username in player search |
| `gin-galaxy/tests/helpers.ts` | Register training routes in test app |
| `gin-galaxy/server.ts` | Import and register training routes at `/api/training` |
| `gin-galaxy/src/App.tsx` | Import Training page, add `/training` route |
| `gin-galaxy/src/components/Layout.tsx` | Add Training nav item with GraduationCap icon |

---

## 6. How the Known Failures Were Resolved

### Rate Limiter Exhaustion (3 tests)
- **Symptom:** `expect([200]).toContain(regRes.status)` failed because `regRes.status` was `429` (Too Many Requests)
- **Root cause:** All test requests originate from `127.0.0.1`. The auth rate limiter allows 20 requests per 15 minutes per IP. With 14+ test users × 2 auth calls each = 28+ hits, the limit was always exceeded.
- **Fix:** Added a module-level `rateLimitStores` registry that tracks all rate limiter instances. `resetAllRateLimiters()` clears all stores. Tests call this before each user creation.
- **Why this is safe:** The function only exists for test reset. Production never calls it. The rate limiter behavior is unchanged for real requests.

### Incorrect Wallet Endpoint (1 test)
- **Symptom:** `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` — test received HTML instead of JSON
- **Root cause:** Test hit `/api/wallet/balance` but the actual endpoint is `/api/wallet`. The non-existent path fell through to Vite's SPA fallback which returned HTML.
- **Fix:** Changed the path to `/api/wallet`.

### Admin Player Search Instability (bonus fix)
- **Symptom:** `expected undefined to be defined` — the searched user wasn't in the results
- **Root cause:** DB accumulated `regular_*` users from previous test runs. The `LIKE '%regular%' LIMIT 20` query returned 20 older users, excluding the newly created one.
- **Fix:** Used the full unique username (e.g., `regular_a3f2b1`) as the search query instead of the generic prefix.

---

## 7. What Metrics Are Newly Surfaced

| Metric | Source | Cached vs Computed |
|--------|--------|-------------------|
| Average engine accuracy | Cached evaluations from `evaluation_cache` | Computed from cached data |
| Accuracy trend (improving/declining/stable) | Half-vs-half comparison of recent evaluated sessions | Computed |
| Win rate | Replay table win/loss counting | Computed from DB |
| Severity distribution (best/inaccuracy/mistake/blunder) | Cached evaluation `severity_counts` | Read from cache |
| Best/worst session | Sorted by cached accuracy | Computed from cached data |
| Recurring mistake types | Cached evaluation turn data | Computed from cache |
| Key moments per session | Cached evaluation turns sorted by severity | From cache |
| Sessions played/evaluated ratio | Replay count vs evaluation cache hit count | Computed |

All metrics derive from **already-cached evaluations** — no Python evaluator or Gemini API call is triggered by the training surface.

---

## 8. Engine vs AI Coaching: Maintained Distinction

The training surface maintains clear separation between two analysis layers:

- **Engine Evaluation (Apex v2):** Heuristic agreement rate. "How often did your decisions match what the Gin Rummy engine would play?" Fast, deterministic, cached forever. Expressed as accuracy percentage with severity classification.

- **AI Coaching (Gemini):** Narrative analysis and strategic suggestions. Complementary qualitative layer. Not aggregated into training metrics.

The methodology card on the Training Center explains this distinction and explicitly notes that engine accuracy is a heuristic approximation, not a solved-game oracle.

---

## 9. Test Results

```
Test Files  17 passed (17)
     Tests  400 passed (400)
  Duration  ~33s

Test breakdown:
  evaluation.test.ts         18 tests  ← formerly 4 failing, now all pass
  training.test.ts           15 tests  ← new
  replay-analysis.test.ts    23 tests
  wallet.test.ts             20 tests
  admin.test.ts              25 tests  ← formerly 1 failing, now passes
  scheduled-tournament.test.ts 32 tests
  ... and 11 more files
```

---

## 10. Unresolved Issues / Known Limitations

1. **Evaluation requires manual trigger:** Players must run engine evaluation from the replay detail page before training data appears. The training surface reads only cached evaluations — it does not auto-trigger evaluation of un-evaluated replays. This is intentional to avoid surprise Python/compute costs.

2. **No cross-session evaluation persistence:** The evaluation cache is in-memory (via `pythonBridge.ts`). If the server restarts, cached evaluations are lost. A future pass could persist evaluations to SQLite.

3. **Trend detection requires ≥4 evaluated sessions:** With fewer than 4 sessions, the trend indicator shows "Not enough data" instead of trying to infer a direction from insufficient samples.

4. **No export/share functionality yet:** The directive mentioned lightweight shareable summaries as optional. This was deferred in favor of the core dashboard and review flow.

5. **TypeScript pre-existing errors:** Some competitive-integrity tests have TypeScript errors unrelated to this sprint. They do not affect runtime or test execution.

---

## 11. Recommended Next Steps

1. **Evaluation Cache Persistence:** Persist the evaluation cache to SQLite so training data survives server restarts.
2. **Auto-evaluation for recent replays:** Optionally trigger batch evaluation of un-evaluated replays from the training surface.
3. **Tournament history integration:** Link tournament bracket performance to training trends.
4. **Deeper evaluation sophistication:** Decision-tree analysis, opening theory patterns, endgame accuracy breakdown.
5. **Infrastructure scale-out:** Redis-backed rate limiters and session stores if live usage starts demanding horizontal scaling.
