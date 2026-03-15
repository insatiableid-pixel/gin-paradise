# Execution Report 21: Training Automation and Progression Depth Sprint

## Objective

Turn training from a good optional review tool into a frictionless, habit-forming product surface by automatically preparing evaluations where practical and surfacing clearer player-improvement signals over time.

## Current Context (Pre-Sprint)

- Training surface existed with cached evaluation summaries and session reviews
- Engine evaluation required players to manually trigger evaluation from replay detail
- Training lacked deeper progression framing over time
- Tournament/format context not tied into training story
- 471 automated tests passing, clean TypeScript

## Actions Taken (Chronological)

### 1. Automatic Evaluation Preparation — Backend Hook

**File: `server/analysis/pythonBridge.ts`**

- Added `triggerAutoEvaluation(replayId)` — fire-and-forget function that loads a completed replay from SQLite, builds the evaluation payload, and dispatches it to the Python evaluator. Failures are silently logged, never blocking gameplay.
- Added `batchPrepareEvaluations(userId, maxBatch)` — on-demand batch preparation for a user's recent unevaluated replays. Bounded by `maxBatch` (default 5, max 10) to prevent runaway work.
- Added `isEvaluationInFlight(replayId)` — deduplication check for concurrent evaluation requests.
- Added global `inFlightEvaluations` Set to prevent duplicate concurrent evaluations of the same replay.
- Updated `evaluateReplay()` to check in-flight status before spawning Python, and to clean up in-flight tracking via `finally` block.

**File: `server/multiplayer/transcript.ts`**

- Added import of `triggerAutoEvaluation` from `pythonBridge.ts`.
- Updated `finalizeTranscript()` to capture the replay ID from `persistReplay()` return value, then trigger auto-evaluation via a 2-second delayed `setTimeout`. The delay ensures all match finalization (escrow settlement, rating updates, tournament advancement) completes before evaluation begins.
- Wrapped in try/catch so auto-eval failures never interrupt match completion.

**When evaluations are auto-prepared:**
- **Immediately after match completion** (via `finalizeTranscript` → `triggerAutoEvaluation`, with 2s delay)
- **On-demand batch prep** from Training page via `POST /api/training/prepare`
- **Deduplication**: both paths check cache and in-flight set before spawning work

### 2. Tournament and Format Context — Schema & Detection

**File: `server/db.ts`**

- Added `match_format TEXT DEFAULT 'heads_up'` column to replays table (migration-safe).
- Added `tournament_id TEXT` column to replays table (migration-safe).
- Updated `persistReplay()` signature to accept optional `matchFormat` and `tournamentId` parameters.
- Added `_detectMatchFormat(actions)` — inspects transcript `match_start` action metadata to auto-detect format:
  - `tournament_sng` — if `tournamentId` present and format is SNG
  - `tournament_scheduled` — if `tournamentId` present and format is scheduled
  - `heads_up_staked` — if `stakeId` is not "free"
  - `heads_up` — default
- Added `_detectTournamentId(actions)` — extracts tournament ID from transcript metadata.

### 3. Training API Endpoints — Full Rewrite

**File: `server/routes/training.ts`** (complete rewrite)

**`GET /api/training/summary`** — enhanced with:
- **Progression signals**: rolling accuracy timeline, mistake-rate timeline, window comparison (recent 40% vs older 40%), streak analysis (hot/cold/neutral), category accuracy (strongest/weakest decision types), improvement delta
- **Tournament/format context**: sessions now include `matchFormat`, `tournamentId`, `tournamentName`; best/worst sessions include `matchFormat`
- **Format breakdown**: distribution of sessions across match formats
- **Auto-evaluation metadata**: `meta.autoEvaluationEnabled`, `meta.autoEvaluationNote`

**`GET /api/training/session/:id`** — enhanced with:
- `matchFormat`, `matchFormatLabel` (human-readable), `tournamentId`, `tournamentName`
- Key moments sorted by severity (blunders first)

**`POST /api/training/prepare`** (new) — batch-prepare evaluations:
- Accepts `maxBatch` (1-10, default 5)
- Returns `{ triggered, alreadyCached, total, message }`
- Bounded and safe: uses deduplication, cache check, and max batch limit

**`GET /api/training/history`** (new) — paginated, filterable session history:
- Query params: `limit` (1-100), `offset`, `filter` (all|evaluated|unevaluated|wins|losses|tournament), `sort` (recent|accuracy_high|accuracy_low)
- Returns sessions with pagination metadata (`total`, `limit`, `offset`, `hasMore`)

### 4. Training Frontend — Full Rewrite

**File: `src/pages/Training.tsx`** (complete rewrite)

- **Auto-evaluation messaging**: header notes that evaluations auto-prepare after matches
- **Batch-prep button**: "Evaluate (N)" button triggers `POST /api/training/prepare`, shows result banner
- **Stat cards**: Engine Accuracy (with trend + improvement delta), Win Rate, Evaluated count, Decision Quality
- **Progression Insights card**: Hot/Cold streak display, best streak counter, strongest/weakest category analysis, window comparison (recent vs earlier accuracy)
- **Format Distribution card**: visual bar breakdown of match formats
- **Highlights row**: Best Session and Most Instructive session with format badges
- **Severity Distribution bar**: visual bar chart of decision quality
- **Session list**: each session shows result badge, opponent, score, format badge, tournament name, severity counts, accuracy, time ago, duration
- **Overview/History tabs**: split between overview dashboard and full history list
- **Methodology note**: updated to explain auto-evaluation, engine accuracy heuristic nature, and progression signals

### 5. Operational Safety

- Python evaluation remains completely off the gameplay critical path
- `triggerAutoEvaluation` is fire-and-forget with try/catch protection
- `batchPrepareEvaluations` is bounded (max 10 per call) with deduplication
- In-flight tracking prevents duplicate concurrent evaluations
- All existing timeout and graceful-failure behavior preserved
- Auto-eval uses `setTimeout(fn, 2000)` delay to avoid interference with match finalization

## Files Created, Modified, or Deleted

| File | Action | Description |
|------|--------|-------------|
| `server/analysis/pythonBridge.ts` | Modified | Added auto-eval trigger, batch-prep, in-flight tracking, deduplication |
| `server/multiplayer/transcript.ts` | Modified | Auto-evaluation hook in `finalizeTranscript()` |
| `server/db.ts` | Modified | `match_format` + `tournament_id` columns, format detection, updated `persistReplay` |
| `server/routes/training.ts` | Rewritten | New endpoints: prepare, history. Enhanced: summary, session detail. Progression signals. |
| `src/pages/Training.tsx` | Rewritten | Auto-eval UX, progression insights, format badges, tabs, batch-prep button |
| `tests/training.test.ts` | Rewritten | 29 tests covering all new and existing functionality |

## Tests and Verification

### Automated Tests

**485 tests pass across 19 test files** (up from 471 — 14 new tests added).

New test coverage includes:
- Training summary API authentication and response shape
- Empty state handling
- Session summaries with replays (with and without evaluations)
- Trend computation with cached evaluations
- Recurring mistake type detection
- **Progression signals**: accuracy timeline, mistake rate timeline, window comparison, improvement delta, best streak (6 new assertions)
- **Format breakdown**: multiple formats in distribution (new test)
- **Tournament context**: tournament ID and format in session data (2 new tests)
- **Session detail**: format labels, tournament context (new test)
- **Batch prepare**: authenticated, empty user, result shape (3 new tests)
- **History pagination**: offset pagination, different pages (2 new tests)
- **History filtering**: by result (wins), by tournament format, format in data (3 new tests)
- Access control (403 for non-participants)
- Unauthenticated rejection (401)
- 404 for nonexistent replays
- Null evaluation when no cache exists
- Regression coverage for replays, evaluation, wallet, leaderboard APIs

### Manual Verification

The environment does not support interactive browser sessions. The following should be verified manually:
1. Play a match and confirm the Training page populates automatically without visiting replay evaluation
2. Confirm the "Evaluate (N)" button triggers batch prep and shows result message
3. Confirm progression insights (streaks, categories, window comparison) appear after 4+ evaluated sessions
4. Confirm tournament sessions show format badges and tournament names

## Unresolved Issues or Risks

1. **Python evaluator availability**: Auto-evaluation depends on the Python Apex v2 evaluator being available. When Python is not installed or the evaluator module is missing, auto-evaluation silently fails (by design). The Training page shows "Preparing…" badges until evaluation completes or the user manually triggers batch-prep.

2. **Evaluation latency**: The 2-second delay before auto-evaluation trigger is a simple heuristic. In very high-throughput scenarios (unlikely for current scale), multiple concurrent evaluations could compete for Python subprocess resources. The in-flight deduplication prevents duplicate work but doesn't limit concurrency.

3. **Tournament ID detection**: Format auto-detection relies on transcript `match_start` action metadata. If tournament metadata isn't explicitly recorded in the transcript actions (e.g., for older replays), the format defaults to `heads_up`. This is forward-compatible — new matches will have the metadata.

4. **History filtering**: The `evaluated`/`unevaluated` filters work at the application layer (post-query) rather than SQL-level, since evaluation cache is a separate table joined via application logic. For large replay volumes, this could be less efficient. Acceptable for current scale.

## Recommended Next Steps

1. **Cosmetic/Prestige Systems**: Add achievement badges, skill tiers, or visual progression markers that leverage the training data
2. **Profile/Achievement Layer**: Surface lifetime stats, milestones, and seasonal progress on a public profile
3. **AI Coaching Integration**: Connect Gemini-based coaching insights directly to the Training progression timeline
4. **Concurrency Limiting**: Add a semaphore or queue-based limiter for Python evaluations if server load increases
5. **Subscription/Monetization**: Gate premium training features (deeper analytics, export, coaching) behind subscription tiers
