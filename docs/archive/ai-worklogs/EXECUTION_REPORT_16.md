# EXECUTION_REPORT_16.md — Scheduled Tournament & Liquidity Expansion Sprint

**Sprint:** CLAUDE_DIRECTIVE_16  
**Date:** March 12, 2026  
**Objective:** Extend the tournament system to support scheduled registrations, variable-size brackets, automatic byes, and round orchestration.

---

## 1. Deliverables Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Scheduled tournament model | ✅ Complete | New `scheduled` format with registration lifecycle |
| Admin-only creation | ✅ Complete | `POST /api/tournaments/scheduled` requires `requireAdmin` |
| Variable-size brackets (2-128 players) | ✅ Complete | Dynamic bracket generation with power-of-two rounding |
| Automatic bye assignment | ✅ Complete | Top seeds get byes, auto-advance to next round |
| Rating-based seeding | ✅ Complete | Elo rating lookup at start time, descending sort |
| Round orchestration | ✅ Complete | `currentRound` / `totalRounds` tracking with gating |
| No-show timeout resolution | ✅ Complete | 5-minute deadline, auto-forfeit to higher seed |
| Registration open/closed lifecycle | ✅ Complete | `registration_open` → `registration_closed` → `in_progress` |
| Scheduled auto-start | ✅ Complete | Background timer checks for past-due start times |
| Insufficient-field cancellation | ✅ Complete | Auto-cancel + full refund if field < minimum |
| Financial integrity (payout/rake) | ✅ Complete | Economics computed at actual field size, winner-take-all |
| Frontend UI expansion | ✅ Complete | Upcoming tab, countdown timers, dynamic bracket view, bye badges |
| DB schema migration | ✅ Complete | 6 new columns with backwards-compatible ALTER TABLE |
| Automated tests | ✅ Complete | 32 new tests, 35 existing SNG tests pass (0 regressions) |
| PROJECT_STATUS.md updated | ✅ Complete | Reflects sprint completion |

---

## 2. Tournament Format Specifications

### 2.1 Supported Formats

| Format | `sit_and_go_4` | `scheduled` |
|--------|----------------|-------------|
| Creation | Any authenticated user (from presets) | Admin-only (`requireAdmin`) |
| Field Size | Fixed 4 players | 2–128 players (configurable) |
| Start Trigger | Automatic on fill (4/4) | Admin manual or scheduled auto-start |
| Seeding | Random shuffle | Rating-based (Elo descending) |
| Bracket | Fixed: 2 semis + 1 final | Variable: `nextPowerOfTwo(n)` with byes |
| Byes | None (always exactly 4) | Top seeds get byes when `n < bracketSize` |
| Registration | Immediate join-until-full | `registration_open` → `registration_closed` |
| No-Show | Not applicable (manual start) | 5-minute auto-forfeit to higher seed |
| Min Entrants | 4 (always) | Configurable (default 2) |

### 2.2 Seeding & Bye Rules

- **Seeding:** At tournament start time, each entrant's current Elo rating is looked up from the database. Players are sorted by rating descending: highest rating = seed 1, second highest = seed 2, etc. Default rating for unrated players is 1200.
- **Bye Assignment:** When the field size `n` is not a power of two, the bracket is padded to `nextPowerOfTwo(n)`. The `bracketSize - n` highest seeds receive automatic byes in round 1. A bye match is marked with `status: "bye"` and the winner (the real player) is immediately advanced to the next round.
- **Bracket Pairing:** Standard single-elimination pairing: seed 1 vs seed N, seed 2 vs N-1, etc. This ensures highest seeds face lowest seeds if no upsets occur.

### 2.3 No-Show Resolution Rules

- When a round begins, each pending match receives a `noShowDeadline` set to `now + 5 minutes` (configurable via `NO_SHOW_TIMEOUT_MS`).
- A background timer checks every 10 seconds for expired deadlines.
- If a match expires:
  - **Both players assigned:** Higher seed (player1) wins by default forfeit.
  - **Only one player assigned:** That player auto-advances.
- The no-show resolution propagates the winner to the next round and checks for round completion.
- This prevents tournaments from stalling if players abandon mid-event.

### 2.4 Tournament Type Access Control

| Action | SNG | Scheduled |
|--------|-----|-----------|
| Create | Any authenticated user | `requireAdmin` only |
| Join | Any authenticated user | Any authenticated user |
| Leave | While `open` | While `registration_open` |
| Start | Automatic (4/4 fill) | Admin manual or scheduled auto |
| Cancel | Any (while open, or admin) | Admin only |

---

## 3. Files Modified

### Backend

| File | Change |
|------|--------|
| `server/tournament.ts` | **Rewritten** — dual-format support, variable brackets, bye logic, no-show, seeding, scheduled lifecycle |
| `server/routes/tournament.ts` | **Rewritten** — added `/scheduled`, `/upcoming`, `/my`, `/:id/start`, `/:id/cancel` endpoints |
| `server/db.ts` | Extended tournaments table with 6 new columns + ALTER TABLE migrations |
| `server/multiplayer/roomManager.ts` | Updated tournament advance to handle `readyMatches` and elimination notifications |

### Frontend

| File | Change |
|------|--------|
| `src/pages/Tournaments.tsx` | **Rewritten** — "Upcoming" tab, countdown timers, dynamic bracket view, bye match cards, OFFICIAL badges, round progress |

### Tests

| File | Tests | Change |
|------|-------|--------|
| `tests/scheduled-tournament.test.ts` | 32 | **New** — comprehensive scheduled tournament coverage |
| `tests/tournament.test.ts` | 35 | **Unchanged** — all pass (backward compatibility verified) |

---

## 4. Test Results

### Scheduled Tournament Tests (32 tests, all pass)

| Test Group | Count | Status |
|------------|-------|--------|
| Admin-Only Scheduled Tournament Creation | 5 | ✅ |
| Scheduled Tournament Registration | 5 | ✅ |
| Insufficient Field Cancellation | 1 | ✅ |
| Variable-Size Bracket Generation | 5 | ✅ |
| Bye Auto-Advancement | 1 | ✅ |
| Round Gating | 2 | ✅ |
| No-Show Resolution | 3 | ✅ |
| Scheduled Tournament Full Lifecycle | 1 | ✅ |
| Scheduled Tournament API | 4 | ✅ |
| Scheduled Tournament Regression | 5 | ✅ |

### Full Suite Results

```
 ✓ tests/scheduled-tournament.test.ts   (32 tests)   233ms
 ✓ tests/tournament.test.ts             (35 tests)   415ms
 ✓ tests/rake.test.ts                   (32 tests)   736ms
 ✓ tests/escrow.test.ts                 (34 tests)   840ms
 ✓ tests/admin.test.ts                  (25 tests)   774ms
 ✓ tests/wallet.test.ts                 (24 tests)   1788ms
 ✓ tests/hardening.test.ts              (16 tests)   1145ms
 ✓ tests/api.test.ts                    (21 tests)   2389ms
 ✓ tests/game-feel.test.ts              (21 tests)   551ms
 ✓ tests/competitive-integrity.test.ts  (35 tests)   18ms
 ✓ tests/showdown-fidelity.test.ts      (17 tests)   10ms
 ✓ tests/multiplayer.test.ts            (19 tests)   9ms
 ✓ tests/matchmaking.test.ts            (15 tests)   8ms
 ✓ tests/replays.test.ts                (18 tests)   3539ms
 ✓ tests/replay-analysis.test.ts        (23 tests)   4492ms
 ✗ tests/evaluation.test.ts             (18 tests)   16815ms  [4 pre-existing rate-limiter failures]

Test Files: 15 passed, 1 failed (pre-existing)
Tests:      381 passed, 4 failed (pre-existing)
```

> **Note:** The 4 failures in `evaluation.test.ts` are pre-existing rate limiter issues from the Mathematical Replay Evaluation sprint. They are NOT caused by this sprint.

---

## 5. Database Schema Changes

New columns added to `tournaments` table:

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `scheduled_start_time` | INTEGER | NULL | Epoch ms for scheduled start |
| `max_entrants` | INTEGER | 4 | Maximum field size |
| `min_entrants` | INTEGER | 4 | Minimum to avoid cancellation |
| `admin_created` | INTEGER | 0 | Whether admin-created |
| `current_round` | INTEGER | NULL | Active round number |
| `total_rounds` | INTEGER | NULL | Total rounds in bracket |

All columns use backwards-compatible `ALTER TABLE ... ADD COLUMN` with `try/catch` for idempotency.

---

## 6. Financial Integrity

- **Entry fees** are deducted immediately on join (escrow hold pattern).
- **Prize pool** is computed at tournament start based on actual field size: `totalPool = entryFee × actualEntrants`.
- **Rake** is computed as `totalPool × rakePercent` and deducted from the pool.
- **Winner payout:** `totalPool - rakeAmount` (winner-take-all).
- **Cancellation:** Full refund of entry fees to all entrants, no rake collected.
- **Leave before start:** Full refund of entry fee.
- **Reconciliation invariant:** `prizePool + rakeAmount == totalPool` (tested).

---

## 7. Architecture Decisions

1. **In-memory + SQLite persistence:** Tournaments remain in-memory maps for performance, with SQLite persistence for crash recovery. Same pattern as existing SNG system.
2. **Background timers:** Scheduled start checks and no-show resolution run on a 10-second interval (unref'd to not block process exit).
3. **Backward compatibility:** The `sit_and_go_4` format is completely unchanged. All existing SNG tests pass without modification.
4. **Rating lookup at start time:** Ratings are fetched from the users table at tournament start, not at registration time. This ensures the most current rating is used for seeding.
5. **No WebSocket dependency for scheduled tournaments:** The scheduling and no-show systems work entirely server-side. Players receive updates via the existing tournament update WebSocket messages when they're connected.

---

## 8. Known Limitations & Future Work

- **Single-node only:** The background timers and in-memory state don't support multi-node deployments. This is consistent with the current architecture and explicitly out of scope per the directive.
- **Winner-take-all only:** The payout structure is winner-take-all. Multi-place payouts (2nd, 3rd) could be added later.
- **No push notifications:** Players must poll or be connected to see tournament updates. Push notifications are out of scope per the directive.
- **Pre-existing evaluation test failures:** 4 tests in `evaluation.test.ts` fail due to rate limiter interactions from a previous sprint. Not related to this work.

---

## 9. Acceptance Criteria Checklist

- [x] Gin Paradise supports scheduled tournament registration ahead of start time
- [x] Admins can create and control the supported scheduled event type securely
- [x] Variable-size brackets with byes work for the supported format
- [x] Rounds progress correctly without manual intervention
- [x] No-show / unstarted matches do not stall the tournament indefinitely
- [x] Financial flows remain deterministic and auditable
- [x] Players can understand the scheduled event flow in the UI
- [x] Automated tests for the new tournament expansion path exist and pass alongside the existing suite
- [x] Comprehensive `EXECUTION_REPORT_16.md` saved to workspace root
- [x] `PROJECT_STATUS.md` updated to reflect sprint completion
