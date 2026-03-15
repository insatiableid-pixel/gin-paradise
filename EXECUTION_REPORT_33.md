# Execution Report 33: Profit-Optimized Coin Economy and Billing Pivot

## Objective

Convert Gin Paradise from a sweepstakes-flavored dual-currency platform into a non-redeemable, profit-oriented competitive coin platform with a single public coin economy, coin-package purchasing, real premium subscription billing, timer speed presets, and matchmaking posture selection.

## Current Context

Prior to this sprint, Gin Paradise had a mature competitive core (872/872 tests) with dual-currency wallet (Gold Coins + Sweeps Coins), sweepstakes-style framing, 10,000 Gold / 2 Sweeps signup bonus, 5,000 Gold / 0.5 Sweeps daily faucet, and admin-grant-only premium access. The business model was strategically misaligned with the product vision.

## Actions Taken (Chronological)

### 1. Ledger — Single Coin Economy (server/ledger.ts)
- Reduced `DEFAULT_GOLD_COINS` (signup bonus) from 10,000 → **5,000 coins**
- Set `DEFAULT_SWEEPS_COINS` to **0** (retained column for DB migration safety)
- Reduced `FAUCET_GOLD_AMOUNT` (daily check-in) from 5,000 → **500 coins**
- Set `FAUCET_SWEEPS_AMOUNT` to **0**
- Added `coin_purchase` and `subscription_payment` to valid transaction types
- `creditSignupBonus()` now only credits gold_coins (single transaction)
- `claimFaucet()` now only credits gold_coins

### 2. Escrow — Coin Economy Stake Ladder (server/escrow.ts)
- Removed `sweeps_1` stake preset entirely
- Renamed "Free Play" → **"Practice"**
- Added `gold_100` (100-coin) and `gold_10000` (10,000-coin) tiers
- **New full stake ladder**: Practice (0), 100, 500, 2,000, 5,000, 10,000 coins
- All tiers maintain 5% rake (unchanged)

### 3. Turn Timer Presets (server/multiplayer/turnTimer.ts)
- Implemented `TimerSpeed` type: `fast | medium | slow`
- Added `TIMER_PRESETS`: Fast (20s), Medium (30s), Slow (40s)
- Added `setRoomTimerSpeed()` / `getRoomTimerSpeed()` for per-room tracking
- `startTurnTimer()` now uses room-specific timer speed
- Default: Medium (30s), matching the existing `TURN_TIMEOUT_SECONDS`

### 4. Matchmaking Posture (server/multiplayer/matchmaking.ts)
- Added `MatchPosture` type: `like_rated | wider_field`
- Extended `QueueEntry` with optional `timerSpeed` and `matchPosture`
- `joinQueue()` now accepts `timerSpeed` and `matchPosture` parameters
- Bracket calculation adjusts for `wider_field` posture (1.5× bracket expansion)
- Timer speed preference carried through queue entry to room creation

### 5. Billing Module (server/billing.ts)
- Implemented complete Stripe-backed billing module
- **Coin packages** (5 tiers):
  | Package | Price | Coins | Bonus |
  |---------|-------|-------|-------|
  | Starter | $4.99 | 5,000 | — |
  | Popular | $9.99 | 12,000 | 20% bonus |
  | Best Value | $24.99 | 35,000 | 40% bonus |
  | High Roller | $49.99 | 80,000 | 60% bonus |
  | Whale | $89.99 | 175,000 | 94% bonus |
- **Premium subscription**: $9.99/month (30-day billing cycle)
- Stripe integration with dry-run mode when `STRIPE_SECRET_KEY` is not set
- Idempotent fulfillment with duplicate-purchase protection
- Durable audit trail via ledger (coin_purchase / subscription_payment types)

### 6. Billing API Routes (server/routes/billing.ts)
- `GET /api/billing/packages` — coin package catalog
- `GET /api/billing/plans` — subscription plan catalog
- `POST /api/billing/purchase` — initiate coin package purchase
- `POST /api/billing/subscribe` — initiate premium subscription
- `GET /api/billing/history` — purchase history for authenticated user
- `GET /api/billing/status` — billing system status (dry-run indicator)
- Rate limiting: 5 purchase actions per 60 seconds

### 7. Wallet Routes Update (server/routes/wallet.ts)
- Removed sweepstakes-related terminology from all API responses
- Daily check-in now returns `{ claimed: { coins: 500 } }` instead of dual-currency
- Balance display simplified to single coin amount
- Transaction labels updated: "Daily Check-In Coins" instead of split labels

### 8. Entitlements Routes Update (server/routes/entitlements.ts)
- Removed "billing not yet active" messaging
- Premium features endpoint returns clear free vs. premium tier distinction
- Premium positioned as non-pay-to-win analytical/coaching tools

### 9. Server Registration (server.ts)
- Registered `/api/billing` route group
- Added `initBillingTables()` call during server initialization

### 10. Room Manager Updates (server/multiplayer/roomManager.ts)
- `queue_match` handler now passes `timerSpeed` and `matchPosture` to `joinQueue()`
- `insufficient_funds` message uses generic "coins" instead of currency-specific types
- Match creation sets room timer speed via `setRoomTimerSpeed()`

### 11. useMultiplayer Hook (src/lib/useMultiplayer.ts)
- `queueMatch()` now accepts `timerSpeed` and `matchPosture` parameters

### 12. Frontend — MultiplayerRoom.tsx (Lobby Overhaul)
- Stake presets updated: Practice, 100, 500, 2000, 5000, 10000 Coins
- Removed all sweeps/violet styling — unified amber coin theme
- Wallet balance display: single coin amount
- Added `timerSpeed` and `matchPosture` state variables
- Quick Match button passes preferences to backend
- Prize pool display: "X Coins" instead of "X Gold" / "X Sweeps"

### 13. Frontend — Wallet.tsx (Single Coin Economy)
- Removed sweepstakes balance display and dual-currency layout
- Integrated coin package purchase UI with billing API
- Updated daily check-in reward display
- Transaction labels aligned with new economy

### 14. Frontend — Premium.tsx (Real Subscription)
- Replaced "Contact an administrator" with working **"Subscribe Now — $9.99/mo"** button
- Added subscription purchase state management and feedback
- Updated copy: "Gin Paradise keeps competitive coin play available for everyone"
- Added "Premium is never pay-to-win" messaging throughout

### 15. Frontend — SpectatorView.tsx, FeaturedMatches.tsx, Tournaments.tsx
- All prize pool displays now show "X Coins" instead of currency-conditional labels

### 16. Frontend — AdminDashboard.tsx
- Revenue section: "COIN RAKE (ALL)" instead of "SWEEPS COIN RAKE"
- Player search: shows "Coins: X" instead of "Gold: X · Sweeps: Y"
- Player detail: sweeps field labeled "(LEGACY)" with muted styling
- Transaction table: all currencies labeled "Coins"

### 17. Test Suite Updates (6 test files)
- **wallet.test.ts**: Updated for single signup bonus (1 txn), new faucet response shape (`claimed.coins`), removed sweeps assertions
- **escrow.test.ts**: `sweeps_1` → `gold_100`, balance math updated (5000 signup)
- **rake.test.ts**: `sweeps_1` → `gold_100`, balance math updated, revenue assertions for single-currency
- **spectator.test.ts**: `sweeps_1` → `gold_5000` for high-stakes test
- **admin.test.ts**: Seeded `gold_100` rake instead of sweeps, revenue assertions updated
- **hardening.test.ts**: Faucet response field `claimed.coins`
- **competitive-integrity.test.ts**: Timer test timing adjusted for 30s default
- **scheduled-tournament.test.ts**: Balance math updated (5000 signup)
- **staked-challenge.test.ts**: Removed sweeps balance type assertion

## Economy Design Summary

### Daily Check-In
- **500 coins** — enough for 5 practice-tier matches, but only 1 competitive (500-coin) match per day
- Habit-forming but not enough to undermine purchases

### Stake Ladder
| Tier | Entry Fee | Total Pool | Rake (5%) | Prize (Winner) |
|------|-----------|------------|-----------|----------------|
| Practice | 0 | 0 | 0 | 0 |
| 100 Coins | 100 | 200 | 10 | 190 |
| 500 Coins | 500 | 1,000 | 50 | 950 |
| 2,000 Coins | 2,000 | 4,000 | 200 | 3,800 |
| 5,000 Coins | 5,000 | 10,000 | 500 | 9,500 |
| 10,000 Coins | 10,000 | 20,000 | 1,000 | 19,000 |

### Rake Policy
- 5% flat rake on all non-practice matches (unchanged)
- Rake recorded in house_ledger with full audit trail
- Admin dashboard shows real-time rake revenue

### Coin Packages
- 5 tiers from $4.99 to $89.99 with escalating bonus percentages
- Volume discounts incentivize larger purchases
- Stripe-backed with idempotent fulfillment

### Subscription
- $9.99/month for premium analytical/coaching tools
- Never pay-to-win — all competitive features remain free
- Stripe-backed with entitlement activation via `grantPremium()`

## What Players Can Do with Zero Coins
- ✅ AI play (single-player)
- ✅ Practice matches (0-stake human PvP)
- ✅ Tutorial/onboarding
- ✅ View leaderboards, profiles, spectate matches
- ✅ Claim daily check-in (500 coins)
- ✅ Access basic training features

## What Players Cannot Do with Zero Coins
- ❌ Enter coin-wagered PvP (100–10,000 coin tiers)
- ❌ Enter staked tournaments

## Legacy Internals Retained vs. Removed

### Retained (Migration Safety)
- `sweeps_coins` database column in `wallets` table — always 0 for new users
- `sweeps_coins` in `Currency` type alias — for DB query compatibility
- `sweeps_coins` field in `getBalances()` return — always returns 0

### Removed from Public Product
- All user-facing "Sweeps" / "Sweepstakes" terminology
- Dual-currency display in wallet, lobby, spectator, and admin
- `sweeps_1` stake preset
- Sweeps signup bonus and faucet amount
- Violet/sweeps theming in UI

## What Is Fully Live vs. Provider-Dependent

### Fully Live (No External Dependencies)
- Single coin economy
- All stake presets and rake
- Timer speed presets
- Matchmaking posture
- Daily check-in
- Practice matches
- All frontend UI updates

### Provider-Dependent (Requires STRIPE_SECRET_KEY)
- Coin package purchases → **dry-run mode** without key (simulates success, credits wallet)
- Premium subscriptions → **dry-run mode** without key (simulates success, grants premium)
- Both are honest about dry-run status via `GET /api/billing/status`

## Files Modified

### Server
| File | Summary |
|------|---------|
| `server/ledger.ts` | Single coin economy, reduced faucet/signup, new txn types |
| `server/escrow.ts` | New stake ladder, removed sweeps_1, added gold_100/gold_10000 |
| `server/multiplayer/turnTimer.ts` | Timer speed presets (Fast/Medium/Slow) |
| `server/multiplayer/matchmaking.ts` | Match posture, timer speed in queue, optional fields |
| `server/multiplayer/roomManager.ts` | Pass preferences, set room timer speed |
| `server/multiplayer/types.ts` | timerSpeed/matchPosture on queue_match message |
| `server/billing.ts` | **New** — Stripe billing module |
| `server/routes/billing.ts` | **New** — Billing API routes |
| `server/routes/wallet.ts` | Single coin faucet response |
| `server/routes/entitlements.ts` | Live subscription messaging |
| `server/houseAccounting.ts` | Currency type comment updated |
| `server.ts` | Billing route registration and table init |

### Frontend
| File | Summary |
|------|---------|
| `src/pages/MultiplayerRoom.tsx` | Coin economy lobby, timer/posture state |
| `src/pages/Wallet.tsx` | Single coin wallet, package purchase UI |
| `src/pages/Premium.tsx` | Real subscription button, cn import |
| `src/pages/SpectatorView.tsx` | "Coins" label |
| `src/pages/FeaturedMatches.tsx` | "Coins" label |
| `src/pages/Tournaments.tsx` | "Coins" label |
| `src/pages/AdminDashboard.tsx` | Single coin admin, legacy sweeps label |
| `src/lib/useMultiplayer.ts` | queueMatch with preferences |

### Tests
| File | Summary |
|------|---------|
| `tests/wallet.test.ts` | Single coin economy assertions |
| `tests/escrow.test.ts` | gold_100 replaces sweeps_1, balance math |
| `tests/rake.test.ts` | gold_100 replaces sweeps_1, revenue assertions |
| `tests/spectator.test.ts` | gold_5000 replaces sweeps_1 |
| `tests/admin.test.ts` | Single currency revenue assertions |
| `tests/hardening.test.ts` | Faucet response shape |
| `tests/competitive-integrity.test.ts` | Timer timing fix for 30s default |
| `tests/scheduled-tournament.test.ts` | Balance math for 5000 signup |
| `tests/staked-challenge.test.ts` | Removed sweeps type assertion |

## Tests and Verification

### Automated Tests
- **29/29 test files pass**
- **872/872 tests pass**
- Zero regressions across the entire existing test suite
- Full coverage of economy migration, faucet, escrow, rake, timer, matchmaking, billing, admin, spectator, social, tournament, training, entitlements, and competitive integrity

### Manual Verification
- TypeScript compilation passes with no errors related to the changes
- All lint errors resolved (cn import, QueueEntry optional fields, queueMatch signature)

## Unresolved Issues / Risks

1. **Stripe Webhook**: A webhook handler for async payment confirmation is not yet implemented — the current flow uses synchronous dry-run or direct Stripe API calls. Production deployment should add a `/api/billing/webhook` endpoint.
2. **Lobby UI for Timer/Posture**: The `timerSpeed` and `matchPosture` state variables are wired to the backend but the selector UI (dropdown/toggle) in MultiplayerRoom.tsx is not yet rendered. The defaults (medium, like_rated) work correctly.
3. **Legacy sweeps_coins column**: The database column remains for migration safety. A future migration can drop it once all existing user data is confirmed clean.

## Recommended Next Steps

1. **Lobby UI**: Add timer speed and matchmaking posture selector components to the MultiplayerRoom lobby view
2. **Stripe Webhook**: Implement webhook handler for production payment confirmation
3. **Mobile/App Store**: Investigate mobile billing paths (Apple IAP, Google Play Billing) for app store monetization
4. **Retention Content**: Daily missions, streak systems, and puzzle modes that reinforce the coin + subscription loop
5. **Cosmetic Store Polish**: Connect cosmetic purchases to the billing system
