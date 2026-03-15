# Execution Report 10: Admin Revenue and Operations Dashboard Sprint

**Date:** March 11, 2026  
**Directive:** CLAUDE_DIRECTIVE_10.md  
**Status:** ✅ Complete

---

## Objective

Build the admin revenue and operations dashboard for Gin Paradise — a secure, read-mostly operational visibility layer that lets an authorized operator inspect rake revenue, recent settlements, match outcomes, and player wallet/ledger activity without querying SQLite manually. Additionally, add two small player-facing preference controls: optional deadwood count display and optional four-color deck rendering.

---

## Current Context

Prior to this sprint, Gin Paradise had:
- Hardened auth, validation, and rate limiting
- Server-authoritative multiplayer with rating-aware matchmaking
- Turn timers, transcripts, replay persistence, and replay analysis
- Dual-currency wallets, escrow settlement, and a working 5% rake model
- House revenue recorded in a durable `house_ledger` table
- 238 passing automated tests across the platform

The operational gap: the platform could take a vig, but there was no admin-facing surface to inspect that revenue, review settlements, or support day-to-day operations.

---

## Actions Taken

### 1. Admin Authentication & Access Control

**Admin Identity Model:**
- Added `is_admin INTEGER DEFAULT 0` column to the `users` table (idempotent migration in `db.ts`).
- Admin accounts are **provisioned via direct database update**: `UPDATE users SET is_admin = 1 WHERE username = 'admin';`
- There is no self-service admin promotion — this is intentional for security.

**Server Enforcement:**
- Created `server/middleware/adminAuth.ts` with `requireAdmin()` middleware.
- `requireAdmin` runs AFTER `requireAuth` — it reads the `is_admin` column and returns 403 if the user is not an admin.
- All admin API endpoints are protected by both `requireAuth` + `requireAdmin`.
- Non-admin users receive `403 Forbidden` with explicit error message.
- Unauthenticated users receive `401 Unauthorized` (from existing `requireAuth`).

**Auth Response Updates:**
- `/api/auth/me` and login response now include `is_admin` boolean.
- The frontend auth store (`store.ts`) includes `is_admin` in the `User` interface.
- Admin navigation link is conditionally shown only when `is_admin` is true — but this is cosmetic; server enforces access regardless.

### 2. Admin Revenue Visibility

**Endpoint: `GET /api/admin/revenue`**
- Returns a summary object with:
  - `totalRakeCollected` — aggregate across all currencies
  - `totalRakeTransactions` — count
  - `byCurrency` — array with `{ currency, total_revenue, transaction_count }` for each currency
  - `recentEntries` — last 5 house ledger entries for quick context
- Numbers reconcile directly against the existing `house_ledger` table via `getHouseRevenue()` and `getHouseLedger()`.

### 3. Settlement & Match Operations View

**Endpoint: `GET /api/admin/settlements`**
- Joins `replays` and `house_ledger` tables to show recent staked match outcomes.
- Returns for each settlement:
  - Both player usernames
  - Winner/loser
  - Final scores
  - End reason (completed, forfeit, timeout, disconnect)
  - Stake ID, currency, and rake amount
  - Replay ID (for cross-referencing with transcript data)
  - Timestamps
- Supports `?limit=N` parameter (default 30, max 100).

### 4. Wallet/Ledger Support Visibility

**Endpoint: `GET /api/admin/players/search?q=<username>`**
- Targeted player search by partial username match.
- Returns matching players with their current wallet balances.
- Limit 20 results per search.

**Endpoint: `GET /api/admin/players/:id`**
- Full player inspection for support cases.
- Returns:
  - Player profile (username, email, rating, wins, losses, join date, admin status)
  - Current wallet balances (gold + sweeps)
  - Recent transactions (up to 30, configurable via `?limit=N`)
  - Recent match history (last 10)
- Returns 404 for nonexistent player IDs.
- Read-only — no mutation capability.

### 5. Admin UI

**Page: `/admin` (AdminDashboard.tsx)**
- Three-tab layout: **Revenue**, **Settlements**, **Players**
- **Revenue tab:**
  - Three summary cards: Total Rake, Gold Coin Rake, Sweeps Coin Rake
  - Full house ledger table with date, type, currency, amount, stake, and notes
- **Settlements tab:**
  - Recent staked match table with players, winner, score, end reason, stake, rake, and replay reference
  - Color-coded end reason badges (green=completed, amber=forfeit, rose=timeout/disconnect)
- **Players tab:**
  - Search bar with username query
  - Player results list with avatar, rating, W/L, and wallet balances
  - Detailed player view with stat cards, transaction history table
  - Back-to-results navigation

**Navigation:**
- Admin link (Shield icon) appears in the nav bar only for users with `is_admin = true`.
- Available on both desktop nav and mobile bottom bar.
- Refresh button on the dashboard reloads data without page navigation.

### 6. Player Preference Controls

**Preferences Store: `src/lib/preferences.ts`**
- Zustand store persisted to `localStorage` under `gin-galaxy-prefs` key.
- Two preferences:
  - `showDeadwoodCount` (default: `true`) — show/hide deadwood count in showdown overlays
  - `fourColorDeck` (default: `false`) — enable four-color deck (♠ black, ♥ red, ♦ blue, ♣ green)

**`getSuitColor()` utility:**
- Centralizes card color logic for both two-color (standard) and four-color modes.
- Used by all three card components: `PlayingCard`, `OverlappingCard`, `ShowdownCardMini`.

**GameRoom integration:**
- Settings gear button (⚙️) added to the game header.
- Opens a dropdown with checkbox toggles for both preferences.
- All card components pass `fourColor={fourColorDeck}` prop.
- All deadwood count displays (`DW: X`) are wrapped with `showDeadwoodCount` conditional.
- Applies consistently in both Round Over and Game Over showdown overlays.
- Preferences persist across sessions via localStorage.

### 7. Wiring

- Admin routes imported and mounted in `server.ts` at `/api/admin`.
- Admin routes imported and mounted in `tests/helpers.ts` for test harness.
- Admin page route added to `App.tsx` inside the Layout protected route group.
- Layout updated with conditional admin nav item.

---

## Files Created

| File | Purpose |
|---|---|
| `server/middleware/adminAuth.ts` | Admin authorization middleware (`requireAdmin`) |
| `server/routes/admin.ts` | Admin API endpoints (revenue, house-ledger, settlements, player search/detail) |
| `src/pages/AdminDashboard.tsx` | Admin UI page with Revenue, Settlements, and Players tabs |
| `src/lib/preferences.ts` | Player preferences store (deadwood count, four-color deck) with localStorage persistence |
| `tests/admin.test.ts` | 25 admin API integration tests |

## Files Modified

| File | Change |
|---|---|
| `server/db.ts` | Added `is_admin` column migration |
| `server/routes/auth.ts` | Added `is_admin` to login and `/me` responses |
| `server.ts` | Imported and mounted admin routes |
| `tests/helpers.ts` | Imported and mounted admin routes in test harness |
| `src/lib/store.ts` | Added `is_admin` to User interface |
| `src/App.tsx` | Added AdminDashboard import and route |
| `src/components/Layout.tsx` | Added conditional admin nav item with Shield icon |
| `src/pages/GameRoom.tsx` | Integrated preferences: four-color deck colors, conditional deadwood display, settings gear dropdown |

---

## Tests and Verification

### New Tests: 25

| Category | Count | Coverage |
|---|---|---|
| **Non-admin rejection** | 6 | Revenue, house-ledger, settlements, player search, player detail, unauthenticated |
| **Admin revenue summary** | 3 | Currency breakdown, gold+sweeps separation, recent entries in response |
| **Admin house ledger** | 3 | Entry listing, limit parameter, field validation |
| **Admin settlements** | 2 | Settlement list, limit parameter |
| **Admin player search** | 3 | Username search, balance inclusion, empty query rejection |
| **Admin player detail** | 2 | Full detail response, 404 for nonexistent |
| **Admin identity in auth** | 2 | is_admin true for admin, false for regular |
| **Regression** | 4 | Registration, wallet API, leaderboard, faucet |

### Total Test Suite: **263 tests across 12 files — ALL PASSING ✅**

| Test File | Tests |
|---|---|
| `api.test.ts` | 21 |
| `multiplayer.test.ts` | 19 |
| `matchmaking.test.ts` | 15 |
| `competitive-integrity.test.ts` | 35 |
| `replays.test.ts` | 18 |
| `replay-analysis.test.ts` | 23 |
| `wallet.test.ts` | 24 |
| `escrow.test.ts` | 34 |
| `showdown-fidelity.test.ts` | 17 |
| `rake.test.ts` | 32 |
| `admin.test.ts` | **25** (new) |

**Zero regressions** — all 238 pre-existing tests continue to pass.

### Manual Verification

- Confirmed admin middleware correctly returns 403 for non-admin users and 401 for unauthenticated.
- Confirmed admin revenue endpoint reconciles against seeded house ledger data.
- Confirmed player search returns matching results with wallet balances.
- Confirmed player detail returns transactions and match history.

---

## Admin Provisioning Documentation

**How to make a user an admin:**

```sql
-- Connect to the SQLite database
-- From the gin-galaxy directory:
-- sqlite3 database.sqlite

-- Promote a user to admin:
UPDATE users SET is_admin = 1 WHERE username = 'your_admin_username';

-- Verify:
SELECT username, is_admin FROM users WHERE is_admin = 1;
```

**How access is enforced:**
- All `/api/admin/*` endpoints require both a valid session token (Bearer auth) AND `is_admin = 1` in the database.
- Client-side navigation visibility is a UX convenience — the server independently validates every request.
- There is no API endpoint to grant or revoke admin status — this must be done via direct database access.

**Which data is read-only vs mutable:**
- All admin endpoints in this pass are **read-only** — no mutations, no balance editing, no match manipulation.
- The only data written during admin actions is standard session/auth infrastructure (no admin-specific writes).

---

## Unresolved Issues or Risks

1. **No admin write tools** — intentional for this pass. If operators need to adjust balances or void matches, that would be a separate, tightly-scoped follow-up.
2. **Preferences not server-persisted** — deadwood count and four-color deck preferences use localStorage only. If server persistence is desired (e.g., syncing across devices), a future `user_preferences` table could be added.
3. **MultiplayerRoom.tsx** — the four-color deck and deadwood preference are implemented in `GameRoom.tsx` (single-player). MultiplayerRoom could receive the same treatment in a follow-up; the preferences store and `getSuitColor()` helper are already reusable.
4. **Admin audit log** — admin actions are not separately logged. For production, consider logging admin page views and searches.

---

## Recommended Next Step

The strongest follow-on options:
1. **Tournament mode** — bracket or round-robin multiplayer tournaments with entry fees and prize pools.
2. **Richer transcript-based analysis** — blunder tagging, per-turn annotations, deeper AI coaching.
3. **Infrastructure hardening for production** — PostgreSQL/Redis migration, proper session store, deployment pipeline.
4. **Admin write tools** — if support needs arise, add targeted admin balance adjustment or match voiding with full audit trail.
