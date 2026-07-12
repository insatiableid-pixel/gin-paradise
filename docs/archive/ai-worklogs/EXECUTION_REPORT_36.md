# Execution Report 36: Unified Activation Funnel and Economy Loop

**Date:** March 14, 2026  
**Directive:** CLAUDE_DIRECTIVE_36  
**Status:** ✅ Complete  
**Test Suite:** 959/959 passing (32 test files — 14 new tests added)

---

## Objective

Turn the existing dashboard, daily system, wallet, and match-entry flow into a single clear monetization and retention funnel that:

- fixes the ledger/cooldown collision bug
- removes conflicting daily-claim behavior
- gives players one obvious next action when they open the app
- improves coin conversion without undermining the economy

## Current Context Before This Sprint

The product had daily retention (missions, streaks, puzzles), a wallet with coin packages, billing, and multiplayer — but these surfaces operated independently. Four specific issues:

1. **Economy Ledger Collision** — Daily Hub rewards (streak, mission, puzzle) were recorded as `faucet` transactions, consuming the wallet faucet cooldown
2. **Competing Daily Claims** — Wallet presented its own daily claim CTA alongside Daily Hub
3. **Dashboard Was Passive** — No bankroll visibility, no activation guidance
4. **Wallet Showed Raw Price Cards** — No gameplay framing for coin packages

---

## Actions Taken (Chronological)

### 1. Fixed Economy Ledger Collision (Priority 1)

**Files Modified:** `server/ledger.ts`, `server/dailyRetention.ts`

Added four new `TransactionType` values to the ledger type system:

| New Type | Purpose | Previously |
|---|---|---|
| `daily_grant` | Canonical Daily Hub claim | `faucet` |
| `streak_reward` | Streak check-in bonus | `faucet` |
| `mission_reward` | Daily mission completion | `faucet` |
| `puzzle_reward` | Daily puzzle completion | `faucet` |

Updated three functions in `dailyRetention.ts` to use proper types:
- `claimMissionReward()` → now uses `mission_reward`
- `checkInStreak()` → now uses `streak_reward`
- `claimPuzzleReward()` → now uses `puzzle_reward`

**Verification:** The wallet faucet's cooldown query filters on `type = 'faucet'`, which now correctly only matches actual wallet faucet claims. Daily retention rewards no longer consume the faucet cooldown.

### 2. Unified Daily Claim Model (Priority 1)

**Decision:** Daily Hub is the canonical daily-return surface. Wallet is a ledger + commerce surface.

**Changes:**
- **Wallet (`Wallet.tsx`):** Removed the standalone daily check-in CTA. Replaced with a read-only "Today's Earnings" widget that shows progress and links to Daily Hub. Players can see their daily status but are directed to the Daily Hub for claims.
- **Dashboard (`Dashboard.tsx`):** Added a prominent "Claim Today's Rewards" banner when daily rewards are unclaimed. This banner is the first thing above the fold.
- **Daily Hub remains unchanged** — it is the authoritative claim surface.

The result: one claim flow, visible from three surfaces.

### 3. Economy-First Dashboard Redesign (Priority 2)

**File Modified:** `Dashboard.tsx`

Redesigned the above-the-fold experience to clearly drive the activation funnel:

| Element | Purpose |
|---|---|
| **Daily claim banner** | Top CTA when daily rewards are unclaimed — drives to Daily Hub |
| **Bankroll indicator** | Shows coin balance inline with play buttons |
| **Affordable stake indicator** | Shows "Can afford up to X-coin stake" |
| **Quick Match as primary CTA** | Moved Quick Match before AI play — it's the commercial play mode |
| **Low-balance nudge** | Shows when balance < 100 with links to Daily Hub and Wallet |
| **Daily Hub summary** | Shows streak/mission/earnings progress after daily is claimed |

### 4. Match Entry Commercialization (Priority 3)

**File Modified:** `MultiplayerRoom.tsx`

- **Default stake changed** from `free` to `gold_100` — commercial intent by default
- **Auto-select** — when wallet loads, defaults to lowest non-free stake if affordable, otherwise `free`
- **Recommended stake indicator** — shows "Recommended: [X] based on your bankroll" below stakes
- **Low-balance guidance** — when player can't afford any stake, shows inline links to earn coins (Daily Hub) or buy coins (Wallet)
- **Preserved** — Fast/Medium/Slow timer, Like Rated/Wider Field posture, all stake presets, friend play

### 5. Wallet Conversion Framing (Priority 4)

**File Modified:** `Wallet.tsx`

Major redesign of the coin package merchandising:

| Before | After |
|---|---|
| Raw price cards | Gameplay-framed value: "≈ X entries at 100 coins" |
| No context | Play duration estimate: "Cautious player / Regular / Serious grinder" |
| Basic badges | Popular/Best Value tags preserved, enhanced with gradient styling |
| No upsell | Subtle Premium upsell card at bottom |

Transaction history improvements:
- **16 distinct type labels** with emoji icons (🔥 Streak, 🎯 Mission, 🧩 Puzzle, etc.)
- **Differentiated styling** — credits show green, debits show red
- **Balance-after** shown for every transaction

### 6. Navigation Prioritization (Priority 5)

**File Modified:** `Layout.tsx`

Restructured navigation into primary and secondary tiers:

**Primary (core loop):** Play → Daily → Wallet → Premium  
**Secondary (ancillary):** Leaderboard, Training, Analysis, Replays, Trust Shield, Cosmetics, Social, Live, Profile, Tournaments

**Mobile bar:** Limited to 5 tabs — Play, Daily, Wallet, Premium, Profile (down from 15+)

### 7. Automated Testing

**File Created:** `tests/unified-funnel.test.ts` (14 tests)

| Test Group | Tests | Coverage |
|---|---|---|
| Ledger Collision Fix | 5 | streak → `streak_reward`, no `faucet` leakage, mission → `mission_reward`, puzzle → `puzzle_reward`, zero faucet contamination |
| Faucet Cooldown Isolation | 3 | daily rewards don't block faucet, faucet cooldown is type-scoped, transaction history shows differentiated types |
| Transaction Type Taxonomy | 1 | all 4 new types valid in `mutateBalance` |
| Unified Funnel Regression | 5 | daily summary shape, wallet shape, history types, billing packages, health endpoint |

---

## Files Created / Modified

| File | Action | Summary |
|---|---|---|
| `server/ledger.ts` | Modified | Added `daily_grant`, `streak_reward`, `mission_reward`, `puzzle_reward` types |
| `server/dailyRetention.ts` | Modified | Changed 3 functions from `faucet` to proper reward types |
| `src/pages/Dashboard.tsx` | Rewritten | Activation-first home with bankroll, claim banner, low-balance nudge |
| `src/pages/Wallet.tsx` | Rewritten | Commerce + ledger surface, gameplay-framed packages, removed competing daily CTA |
| `src/pages/MultiplayerRoom.tsx` | Modified | Default stake, recommended stake, low-balance guidance |
| `src/components/Layout.tsx` | Modified | Primary/secondary nav tiers, focused mobile bar |
| `tests/unified-funnel.test.ts` | Created | 14 tests for ledger fix, cooldown isolation, regression |

---

## Tests and Verification

**Full suite:** 959 tests across 32 test files — all passing ✅

No regressions across any existing test file. The 14 new tests specifically verify:
- Daily retention rewards use correct TransactionTypes
- Wallet faucet cooldown is not triggered by daily rewards
- Transaction history correctly differentiates all reward sources
- API shapes are preserved
- Cross-system regression points are stable

---

## Re-Entry Math Analysis

### Free Re-Entry Path for Low-Balance Players

A player who is at 0 coins can earn back to the minimum public stake (100 coins) through a single daily session:

| Daily Activity | Coins Earned |
|---|---|
| Streak check-in (Day 1) | 50 |
| Daily check-in mission | 50 |
| One additional mission (avg) | ~75 |
| Daily puzzle (base) | 100 |
| **Total minimum daily** | **275 coins** |

A busted player can re-enter the 100-coin stake tier with a **single daily session**. With optimal puzzle play, they can earn 375+ coins in one session.

### vs. Economy Parameters

| Parameter | Value | Ratio |
|---|---|---|
| Min public stake | 100 coins | 1 daily session to re-enter |
| Max daily earn (free) | ~575 coins | 5.75× lowest stake |
| Coin package (cheapest) | $4.99 / 5,000 coins | 50 entries at 100-coin |
| Rake on 100-coin match | 10 coins (5%) | 1% of max daily earn |
| Signup bonus | 5,000 coins | 50 entries at 100-coin |

The daily loop supports re-entry without flooding the economy: max free daily earnings are ~575 coins, which supports 5 staked matches before the player needs to earn again or purchase. This is conservative enough to not devalue purchases while ensuring the product doesn't feel dead for busted players.

---

## Unresolved Issues / Risks

1. **Wallet faucet still exists** — It's demoted (no CTA in Wallet), but the API endpoint `/api/wallet/faucet` is still functional. If desired, it could be fully deprecated or converted to redirect users to Daily Hub. Kept for backward compatibility currently.

2. **Desktop nav is dense** — 16+ items in the top bar is usable but crowded. A future pass could add collapsible sections or a sidebar. Not addressed here to stay within scope.

3. **No visual verification in this sprint** — The changes are structurally sound and test-verified, but a manual UI walkthrough would be valuable to confirm the visual flow.

---

## Recommended Next Steps

1. **First-purchase optimization** — Add a first-time buyer discount banner, or a "starter pack" bundle with premium trial
2. **App Store / Google Play** — Wrap the web app in a native shell for distribution
3. **Tournament programming** — Feed the daily-to-match-to-purchase loop with scheduled events
4. **Sound and animation polish** — Micro-interactions for coin earn/spend events
5. **Deprecate wallet faucet** — If Daily Hub is fully established, remove the redundant faucet endpoint
