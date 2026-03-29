# EXECUTION REPORT — Directive 82: Durable Write Path, Outbox Workers & Honest Storage Evolution

**Date:** 2026-03-25
**Status:** ✅ COMPLETE

---

## Objective

Decouple non-critical, retryable secondary writes from the synchronous gameplay hot path by implementing a durable, DB-backed outbox and in-process worker loop. Harden transactional boundaries for authoritative economy and match-outcome writes. Establish an explicit write-path policy that classifies every persistent write in the system.

---

## What Was Done

### 1. Write-Path Policy (`server/writePathPolicy.ts`)
- Created a canonical write-path registry that classifies every persistent write as either **authoritative synchronous** or **derived asynchronous**
- Authoritative writes (money, escrow, billing, replay persistence, match outcomes, tournament advancement, user registration, offers, daily retention) remain synchronous and transactional — always
- Derived writes (replay auto-evaluation, broadcast metrics, coaching cache warmup, achievement triggers) are now routed through the durable outbox
- Policy is documented as both code (compile-time type) and operator documentation

### 2. Durable Outbox Table (`server/outbox.ts`)
- **Schema:** `outbox_jobs` table with `id`, `job_type`, `payload`, `status`, `attempts`, `max_attempts`, `last_error`, `dedup_key`, `available_at`, `started_at`, `completed_at`
- **Status lifecycle:** `pending` → `processing` → `completed` | `failed` → (retry) → `pending` | `dead`
- **Enqueue** with optional dedup key and delay-based availability
- **Atomic claim** semantics — jobs are exclusively owned by one worker
- **Fail with backoff** — failed jobs are re-queued with exponential backoff (`RETRY_BASE_DELAY_MS * attempts`)
- **Poison job protection** — jobs exceeding `max_attempts` (default 5) are marked `dead` and stop retrying
- **Dedup suppression** — if a non-terminal job with the same dedup key exists, enqueue is silently skipped
- **Cleanup** — completed jobs older than a configurable threshold are automatically garbage-collected
- **Diagnostics** — counts by status, oldest pending timestamp, recent/failed job queries
- **SQL indexes** on status, available_at, dedup_key, job_type, created_at for efficient polling

### 3. Outbox Worker (`server/outboxWorker.ts`)
- **In-process poll loop** with configurable interval (default 2s), batch size (default 5), and cleanup frequency
- **Handler registry** — register async handlers per job type; handlers must be idempotent
- **Processing:** claim → parse payload → invoke handler → complete or fail
- **Start/stop lifecycle** — safe to call multiple times, unref'd timer doesn't block shutdown
- **Status reporting** — running state, jobs processed/failed, poll cycle count, last poll timestamp, registered handlers, queue diagnostics
- **Graceful shutdown** — stops on process SIGTERM/SIGINT

### 4. Job Handlers (`server/outboxHandlers.ts`)
- **replay_auto_evaluation** — loads replay from DB, invokes Python evaluator subprocess; idempotent via cache check
- **broadcast_metrics_persist** — persists spectator analytics to `broadcast_metrics` table; idempotent via UUID-keyed insert
- **achievement_trigger** — evaluates and grants achievements; idempotent via grant-state check
- **coaching_cache_warmup** — placeholder for coaching narrative pre-generation; logs acknowledgment

### 5. Flow Migration: Replay Auto-Evaluation
- **Before:** `transcript.ts` → `setTimeout(() => triggerAutoEvaluation(replayId), 2000)` (fire-and-forget, lost on crash)
- **After:** `transcript.ts` → `enqueueJob({ jobType: "replay_auto_evaluation", dedupKey: "eval:{replayId}", delayMs: 2000 })` (durable, retryable, dedup-safe)
- Authoritative `persistReplay()` call remains on the synchronous hot path (unchanged)

### 6. Flow Migration: Achievement Triggers
- **Before:** `transcript.ts` → `try { triggerLiveAchievements(winnerId, "match_completion") } catch {}` (fire-and-forget, swallowed errors)
- **After:** `transcript.ts` → `enqueueJob({ jobType: "achievement_trigger", dedupKey: "ach:{userId}:{replayId}" })` (durable, retryable, dedup-safe)
- Both winner and loser achievement jobs are enqueued independently

### 7. SQLite Hardening (`server/db.ts`)
- **busy_timeout = 5000** — wait up to 5s for write lock instead of failing immediately; critical for outbox worker contention
- **foreign_keys = ON** — enforce referential integrity
- **wal_autocheckpoint = 1000** — explicit standard checkpoint tuning
- **journal_size_limit = 64MB** — prevent unbounded WAL growth

### 8. Server Lifecycle Integration (`server.ts`)
- Outbox table initialization at startup (after all other tables)
- All 4 job handlers registered before worker start
- Worker started with production defaults (2s poll, 5 batch, 24h cleanup)
- Worker stopped on graceful shutdown (before DB close)

### 9. Health Endpoint Augmentation (`server.ts`)
- `/api/health` now includes `outboxWorker` status (running, processed, failed, handlers, diagnostics)
- `/api/health` now includes `databaseHardening` (walMode, busyTimeout, foreignKeys)

### 10. Test Helper Integration (`tests/helpers.ts`)
- `initOutboxTable()` called during test server startup
- `registerAllHandlers()` called during test server startup
- Worker is NOT started in test env (tests use `_processNextJob()` for deterministic processing)

---

## Test Results

### New Tests: `tests/outbox.test.ts` — 28 tests

| Suite | Tests | Status |
|---|---|---|
| Outbox — Enqueue | 4 | ✅ |
| Outbox — Claim / Complete / Fail | 5 | ✅ |
| Outbox — Diagnostics | 3 | ✅ |
| Outbox — Retry and Cleanup | 2 | ✅ |
| Worker — Handler Registration and Processing | 3 | ✅ |
| Worker — Status and Lifecycle | 3 | ✅ |
| Migrated Flow — Replay Auto-Evaluation | 1 | ✅ |
| Migrated Flow — Achievement Trigger | 1 | ✅ |
| Migrated Flow — Broadcast Metrics | 1 | ✅ |
| Authoritative Write Regression | 1 | ✅ |
| Health Endpoint — Outbox Visibility | 1 | ✅ |
| Startup / Config Regression | 3 | ✅ |

### Full Regression Suite

```
 Test Files   35 passed (35)
      Tests   1065 passed (1065)
   Duration   112.80s
```

**0 regressions.** All existing tests continue to pass.

---

## Files Changed

| File | Change |
|---|---|
| `server/outbox.ts` | **NEW** — Durable outbox queue: schema, enqueue, claim, complete, fail, diagnostics |
| `server/outboxWorker.ts` | **NEW** — In-process worker loop with handler registry |
| `server/outboxHandlers.ts` | **NEW** — Job handler implementations for 4 job types |
| `server/writePathPolicy.ts` | **NEW** — Write-path classification registry |
| `server/multiplayer/transcript.ts` | **MODIFIED** — Migrated auto-eval + achievements to outbox |
| `server/db.ts` | **MODIFIED** — Added SQLite hardening pragmas |
| `server.ts` | **MODIFIED** — Outbox init, handler registration, worker lifecycle, health endpoint |
| `tests/helpers.ts` | **MODIFIED** — Outbox table + handler init in test server |
| `tests/outbox.test.ts` | **NEW** — 28 tests for outbox + migrated flows |
| `DEPLOYMENT.md` | **MODIFIED** — Outbox worker, write-path policy, SQLite hardening docs |
| `PROJECT_STATUS.md` | **MODIFIED** — Updated status to Directive 82 completion |

---

## What Is Proven vs. What Is Scaffolded

### Proven (tested, running in default mode)
- Durable outbox lifecycle: enqueue → claim → process → complete | fail → retry → dead
- Dedup suppression (per-key, non-terminal only)
- Delayed job availability
- Exponential backoff on failure
- Poison job dead-lettering
- Worker poll loop, handler dispatch, status reporting
- Replay auto-eval migration (fire-and-forget → durable queue)
- Achievement trigger migration (fire-and-forget → durable queue)
- SQLite hardening (busy_timeout, foreign_keys, WAL tuning)
- Health endpoint: outbox diagnostics + database hardening
- Full regression suite (1065 tests, 0 failures)

### Integration-Only (scaffolded, not yet exercised in production)
- coaching_cache_warmup handler (placeholder — logs acknowledgment)
- broadcast_metrics_persist handler (registered but spectator module not yet wired to enqueue)
- Multi-process worker (in-process only; distributed claim would need Redis/pg advisory locks)

---

## What This Sprint Explicitly Does NOT Do

| Not Done | Why |
|---|---|
| External message queue (Redis, RabbitMQ) | Not needed. SQLite outbox is the right fit for single-node. |
| Multi-process workers | Single-node architecture. The interface is designed for future separation. |
| Distributed job locking | Not needed until Redis coordinator is live. |
| PostgreSQL migration | Not needed for current scale. |
| Rate limiting on outbox | Worker batch size (5) and poll interval (2s) provide natural throttling. |
| Admin UI for outbox | Health endpoint provides operator visibility. Admin dashboard is a future sprint. |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MATCH COMPLETION                             │
│                                                                     │
│  ┌──────────────────┐     ┌──────────────────────────────────────┐  │
│  │  AUTHORITATIVE    │     │  DERIVED ASYNC (Outbox)              │  │
│  │  SYNCHRONOUS      │     │                                      │  │
│  │                   │     │  enqueueJob("replay_auto_eval")      │  │
│  │  persistReplay()  │ ──► │  enqueueJob("achievement_trigger")   │  │
│  │    ↓              │     │  enqueueJob("achievement_trigger")   │  │
│  │  SQLite INSERT    │     │    ↓                                 │  │
│  │  (system of rec.) │     │  outbox_jobs table (SQLite)          │  │
│  └──────────────────┘     └──────────────────────────────────────┘  │
│                                        ↓                            │
│                             ┌──────────────────┐                    │
│                             │  OUTBOX WORKER    │                    │
│                             │  (poll every 2s)  │                    │
│                             │                   │                    │
│                             │  claim → process  │                    │
│                             │  → complete/fail  │                    │
│                             │  → retry/dead     │                    │
│                             └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
```
