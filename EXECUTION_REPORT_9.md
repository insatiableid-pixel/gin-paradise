# Execution Report 9 — Rake and House Accounting Sprint

**Date:** March 11, 2026  
**Directive:** CLAUDE_DIRECTIVE_9.md  
**Project:** Gin Paradise — Competitive Gin Rummy Platform  
**Status:** ✅ Complete

---

## Objective

Add a configurable rake model to staked multiplayer matches so the platform can safely retain a house share of each eligible contest while keeping payouts, player-visible economics, and audit trails correct.

---

## Current Context (Before This Sprint)

Gin Paradise had:
- 206 passing automated tests
- Dual-currency wallets, ledger foundation, coin-gated matchmaking, and escrow settlement
- Winner-takes-all settlement (no platform revenue)
- Player-facing stake picker without rake disclosure

---

## Actions Taken (Chronological)

### 1. Designed the Rake Model

Chose a **5% flat rake** on all non-free stake presets:
- Simple, transparent, easy to audit
- Free play remains completely rake-free
- Configurable via the `rakePercent` parameter on each preset

**Settlement Formula (per stake preset):**

| Variable | Formula |
|---|---|
| `totalHeld` | `entryFee × 2` |
| `rakeAmount` | `totalHeld × rakePercent` |
| `prizePool` (winner payout) | `totalHeld − rakeAmount` |
| **Invariant** | `prizePool + rakeAmount = totalHeld` |

### 2. Created House Accounting Module

**New file:** `server/houseAccounting.ts`

- Dedicated `house_ledger` table in SQLite for platform revenue tracking
- `recordRake()` — records each rake collection with full context (room, stake, winner, loser)
- `getHouseLedger()` — recent house ledger entries
- `getHouseRevenue()` — aggregated revenue by currency
- `getHouseRevenueForCurrency()` — convenience query for specific currency

### 3. Updated Database Schema

**Modified file:** `server/db.ts`

Added `house_ledger` table:
```sql
CREATE TABLE IF NOT EXISTS house_ledger (
  id TEXT PRIMARY KEY,
  currency TEXT NOT NULL CHECK(currency IN ('gold_coins', 'sweeps_coins')),
  amount REAL NOT NULL,
  type TEXT NOT NULL DEFAULT 'rake',
  room_id TEXT,
  stake_id TEXT,
  winner_id TEXT,
  loser_id TEXT,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Indexed on `currency` and `created_at DESC` for efficient revenue queries.

### 4. Redesigned Stake Presets with Rake

**Modified file:** `server/escrow.ts` (full rewrite)

- Added `rakePercent` and `rakeAmount` to the `StakePreset` interface
- Introduced `makePreset()` helper that computes `prizePool` and `rakeAmount` deterministically
- All non-free presets now have 5% rake
- Free play preset unchanged (0% rake, 0 entry, 0 payout)

**Final Stake Economics:**

| Preset | Entry Fee | Total Held | Rake (5%) | Net Payout |
|---|---|---|---|---|
| Free Play | 0 | 0 | 0 | 0 |
| 500 Gold | 500 | 1,000 | 50 | 950 |
| 2,000 Gold | 2,000 | 4,000 | 200 | 3,800 |
| 5,000 Gold | 5,000 | 10,000 | 500 | 9,500 |
| 1 Sweep | 1 | 2 | 0.10 | 1.90 |

### 5. Updated Settlement Logic

**Modified file:** `server/escrow.ts`

- `settleMatch()` now pays out `prizePool` (net of rake) to winner
- Rake recorded in house ledger via `recordRake()`
- `SettlementResult` now includes `rakeAmount` field
- Prize payout transaction note explicitly states rake amount
- **Refund paths remain untouched** — full refund, no rake deducted
- **Free play remains untouched** — no settlement, no rake
- Settlement is atomic: no partial payout/rake states

**Settlement by outcome type:**

| Outcome | Winner Payout | Rake | Refund |
|---|---|---|---|
| Normal completion | `prizePool` | `rakeAmount` | — |
| Forfeit after start | `prizePool` | `rakeAmount` | — |
| Timeout after start | `prizePool` | `rakeAmount` | — |
| Disconnect after start | `prizePool` | `rakeAmount` | — |
| Pre-start failure | — | **None** | Full refund (both players) |
| Free play | — | **None** | — |

### 6. Updated WebSocket Protocol Types

**Modified file:** `server/multiplayer/types.ts`

- Added `rakeAmount` and `rakePercent` to `PlayerGameView.stakeInfo`

### 7. Updated Room Manager

**Modified file:** `server/multiplayer/roomManager.ts`

- Stake info broadcast now includes `rakeAmount` and `rakePercent`
- Transcript metadata includes rake fields
- Game over messages show net payout (post-rake)

### 8. Updated Frontend — Player-Facing Transparency

**Modified file:** `src/pages/MultiplayerRoom.tsx`

- Stake picker now computes and shows rake-adjusted prize pools
- Each non-free stake shows "(5% rake)" label
- "Win X" values show net payout after rake
- Prize pool badge in game header displays net payout

### 9. Wrote Comprehensive Test Suite

**New file:** `tests/rake.test.ts` (32 tests)

### 10. Updated Existing Tests

**Modified file:** `tests/escrow.test.ts`

- Updated all settlement expectations to use rake-adjusted amounts
- All 34 existing escrow tests pass with new values

---

## Files Created

| File | Purpose |
|---|---|
| `server/houseAccounting.ts` | House revenue ledger: recordRake, getHouseRevenue, getHouseRevenueForCurrency |
| `tests/rake.test.ts` | 32 automated tests for rake-aware settlement and house accounting |

## Files Modified

| File | Changes |
|---|---|
| `server/db.ts` | Added `house_ledger` table and indexes |
| `server/escrow.ts` | Full rewrite: rake model, makePreset(), rake-adjusted settlement, SettlementResult.rakeAmount |
| `server/multiplayer/types.ts` | Added `rakeAmount`, `rakePercent` to stakeInfo type |
| `server/multiplayer/roomManager.ts` | Broadcast rake-adjusted stake info, transcript rake metadata |
| `src/pages/MultiplayerRoom.tsx` | Rake-adjusted stake picker with rake % disclosure |
| `tests/escrow.test.ts` | Updated expectations for rake-adjusted payout amounts |

---

## Tests and Verification

### Automated Tests — 238 Tests, All Passing ✅

| Test File | Tests | Status |
|---|---|---|
| `api.test.ts` | 21 | ✅ |
| `multiplayer.test.ts` | 19 | ✅ |
| `matchmaking.test.ts` | 15 | ✅ |
| `competitive-integrity.test.ts` | 35 | ✅ |
| `replays.test.ts` | 18 | ✅ |
| `replay-analysis.test.ts` | 23 | ✅ |
| `wallet.test.ts` | 24 | ✅ |
| `escrow.test.ts` | 34 | ✅ (updated for rake) |
| `showdown-fidelity.test.ts` | 17 | ✅ |
| **`rake.test.ts`** | **32** | **✅ (new)** |

### New Rake Test Coverage (32 tests)

| Category | Tests | Coverage |
|---|---|---|
| Rake Model — Presets | 6 | Free zero-rake, gold_500/2000/5000 math, sweeps math, all-preset reconciliation |
| Settlement — Completed Match | 2 | Correct payout, reconciliation |
| Settlement — Forfeit/Timeout/DC | 3 | Forfeit, timeout, disconnect (sweeps) — all with rake |
| Free Play — No Rake | 2 | Free settlement returns no_stake, free hold returns null |
| Refund — No Rake | 1 | Full refund, no rake deducted |
| House Accounting | 5 | Rake recorded in house_ledger, revenue by currency, specific currency query, no rake on free play, no rake on refund |
| Player Transaction History | 2 | Winner payout shows net amount with rake note, loser balance unchanged |
| Settlement Reconciliation | 4 | payout + rake = total held for all 4 non-free stake levels |
| Queue Compatibility | 2 | Stake pairing unchanged by rake |
| Regression | 5 | Registration, wallet API, leaderboard, faucet, preset structure |

### Regression Verification

All 206 pre-existing tests continue to pass alongside the 32 new rake tests. No regressions introduced.

---

## Unresolved Issues or Risks

1. **No admin API for house ledger** — house revenue is queryable via code/DB but not exposed as an API endpoint. This is intentional for this sprint; an admin dashboard would be a future deliverable.
2. **Rake percentage is hardcoded per-preset** — changing it requires a code change and redeploy. The `makePreset()` helper makes tuning easy, but there's no runtime configuration UI. This matches the directive's "easy to tune later" requirement.
3. **Rounding** — rake amounts use `Math.round(x * 100) / 100` for 2-decimal precision. For all current presets the math is clean. If future presets introduce amounts that don't round cleanly, additional precision handling may be needed.

---

## Recommended Next Steps

1. **Tournament mode** — brackets, multi-round tournaments with rake on finals
2. **Richer match analysis** — blunder tagging, per-turn annotations grounded in transcripts
3. **Infrastructure hardening** — PostgreSQL migration for production-scale economics
4. **Admin dashboard** — house revenue reporting, player management
5. **Difficulty levels** — selectable AI from Simple to Nexus
