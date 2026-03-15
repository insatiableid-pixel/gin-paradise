# Execution Report 30: Staked Challenges, In-Game Rematch, and Challenge Cleanup

**Date:** March 13, 2026  
**Directive:** Claude Directive 30 — Staked Challenges, In-Game Rematch, and Challenge Cleanup  
**Status:** ✅ Complete

---

## Objective

Finalize the direct-social competition flow by ensuring staked challenges and rematches function correctly through the acceptance and room join process, adding an in-game rematch prompt to the multiplayer game-over experience, implementing TTL cleanup for stale challenge/rematch rooms, and ensuring social/match UX coherence around stake display and joinable/expired state differentiation.

## Current Context (Before)

- Gin Paradise had seamless challenge-to-match flow with room allocation on acceptance
- **Critical gaps:**
  - Staked challenges fell back to free-play behavior — stake was not validated or passed through the accept/join flow
  - No in-game rematch option — users had to navigate to Social Hub to propose rematches
  - No TTL cleanup — accepted challenge rooms that were never joined lingered indefinitely
  - Notifications did not include stake information
- 770/770 tests passing across 27 test files

## Actions Taken (Chronological)

### 1. Staked Challenge Handoff (`server/social.ts`)

- **Balance Validation on Accept:** Modified `acceptChallenge()` to validate both players' balances (challenger and target) before accepting a staked challenge. If either player can't afford the stake, the acceptance is rejected with a clear error message specifying the player, required amount, and current balance.
- **Balance Validation for Rematches:** Modified `acceptRematch()` with the same balance validation for both players.
- **Stake Info in Notifications:** Both `match_ready` and `challenge_accepted` notifications now include the stake label (e.g., " (gold_500)") when the challenge/rematch is staked.
- **Import:** Added `checkBalance` import from `escrow.ts` for balance validation.

### 2. Challenge/Rematch Room TTL Cleanup (`server/social.ts`)

- **Constants:** Added `CHALLENGE_ROOM_TTL_MS` (10 minutes) and `REMATCH_ROOM_TTL_MS` (5 minutes).
- **`expireAcceptedChallenges()`:** Expires all accepted challenges whose `updated_at` is older than 10 minutes, setting status to `'expired'`.
- **`expireAcceptedRematches()`:** Expires all accepted rematches whose `updated_at` is older than 5 minutes, setting status to `'expired'`.
- **Auto-cleanup:** `getAcceptedChallengesForUser()` now runs `expireAcceptedChallenges()` before querying, ensuring users never see stale joinable challenges.
- **New function:** `getAcceptedRematchesForUser()` with the same auto-cleanup pattern for rematches.

### 3. Room Manager Stake Validation (`server/multiplayer/roomManager.ts`)

- **Stake Validation at Join Time:** The `join_challenge_room` handler now:
  - Extracts `stakeId` from the message (carried from the challenge/rematch record)
  - Validates the stake preset exists
  - Checks the joining player's balance for non-free stakes
  - Sends `insufficient_funds` message if balance is insufficient
  - Creates the room with the correct `stakeId` (was previously falling back to free)

### 4. Social API Routes Extension (`server/routes/social.ts`)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/social/rematches/accepted` | GET | List accepted rematches with room IDs (joinable rematches) |

- Imported `getAcceptedRematchesForUser` from social model.

### 5. In-Game Rematch Button (`src/pages/MultiplayerRoom.tsx`)

- **`RematchButton` component:** New standalone component rendered in the game-over overlay that:
  - Fetches opponent's userId via the profile API
  - Proposes a rematch via `POST /api/social/rematch` with the current stake level
  - Shows loading, sent, error, and accepted states
  - Polls for acceptance (every 3s, up to 10 attempts)
  - On acceptance, renders a "Join Rematch Room" CTA that navigates to the challenge room URL
  - Handles declined rematches with retry option
- **Stake info display:** Shows current stake level in the rematch button label for non-free stakes.
- **Also fixed:** Corrupted header section (timer, disconnect indicator, sound toggle) restored to correct state.

## Files Modified

| File | Changes |
|---|---|
| `server/social.ts` | Balance validation in `acceptChallenge`/`acceptRematch`, TTL expiry constants and functions, `getAcceptedRematchesForUser`, `checkBalance` import, stake label in notifications |
| `server/multiplayer/roomManager.ts` | Stake validation at `join_challenge_room` time, correct stakeId propagation to room creation |
| `server/routes/social.ts` | `getAcceptedRematchesForUser` import, `/api/social/rematches/accepted` endpoint |
| `src/pages/MultiplayerRoom.tsx` | `RematchButton` component in game-over overlay, fixed corrupted timer/header section |

## Files Created

| File | Purpose |
|---|---|
| `tests/staked-challenge.test.ts` | 28 comprehensive tests for staked challenge/rematch handoff, TTL, notifications, and regression |

## Tests and Verification

### Automated Tests
- **New tests:** 28 (`staked-challenge.test.ts`)
- **Total suite:** 798/798 passing ✅ (was 770)
- **28 test files** — zero regressions

### Test Coverage

| Category | Tests | Description |
|---|---|---|
| Staked challenge acceptance | 3 | Create staked challenge, validate balances, free challenge fallback |
| Staked rematch acceptance | 2 | Create staked rematch, accept with room allocation |
| Accepted rematches endpoint | 3 | Listing, both-participant visibility, auth required |
| Stake info in notifications | 2 | Staked notifications include label, free notifications don't |
| Challenge room TTL expiry | 2 | Expiry callable, fresh timestamps visible |
| Rematch room TTL expiry | 1 | Fresh timestamps visible |
| Challenge stake persistence | 2 | StakeId preserved through acceptance for challenges and rematches |
| Room ID format | 2 | CH- prefix for both staked challenges and rematches |
| Edge cases | 3 | Declined/cancelled staked challenges don't allocate rooms |
| Regression | 8 | Wallet, inbox, history, rematches, availability, notifications, health, leaderboard |

### Directive Acceptance Criteria Checklist

| Criterion | Status |
|---|---|
| ① Staked challenge accepted → stakeId passes through to room join | ✅ |
| ② Balance validated for both players on challenge acceptance | ✅ |
| ③ Balance validated for both players on rematch acceptance | ✅ |
| ④ Insufficient balance → clear rejection message | ✅ |
| ⑤ In-game rematch prompt in multiplayer game-over | ✅ |
| ⑥ Rematch carries over stake level | ✅ |
| ⑦ Rematch process remains consensual (propose → accept) | ✅ |
| ⑧ Challenge room TTL expiry (10 minutes) | ✅ |
| ⑨ Rematch room TTL expiry (5 minutes) | ✅ |
| ⑩ Expired rooms → status 'expired', not joinable | ✅ |
| ⑪ Notifications include stake info for staked challenges | ✅ |
| ⑫ Accepted rematches listing endpoint | ✅ |
| ⑬ No weakening of trust/safety guarantees | ✅ |
| ⑭ Comprehensive automated tests | ✅ (28 new) |
| ⑮ All existing tests pass (zero regressions) | ✅ (798/798) |

## Architecture Notes

### Staked Challenge Flow (Complete)
1. Challenger creates challenge with `stakeId: "gold_500"` → `pending`
2. Target accepts → `acceptChallenge()` validates both players' balances via `checkBalance()`
3. If validated → room allocated (`CH-XXXXXX`), status → `accepted`, notifications sent with stake label
4. If Either Player Can't Afford → returns `{ ok: false, error: "... need X, have Y" }`
5. Both players navigate to `/play/multiplayer?challengeRoom=CH-XXXXXX&stakeId=gold_500`
6. `join_challenge_room` handler validates balance again at join time, creates room with `stakeId`
7. Normal multiplayer game flow with escrow settlement

### TTL Expiry Pipeline
```
accepted challenge → 10 minutes pass → expireAcceptedChallenges() → status = 'expired'
accepted rematch → 5 minutes pass → expireAcceptedRematches() → status = 'expired'
```
Expiry runs lazily on read (when listing accepted challenges/rematches), not on a background timer. This is simple and effective for the current scale.

### In-Game Rematch Architecture
```
Game Over Overlay → RematchButton component
  → Fetch opponent profile (userId)
  → POST /api/social/rematch { opponentId, stakeId }
  → Poll GET /api/social/rematch/:id every 3s
  → On accepted: render "Join Rematch Room" → navigate to challenge room
```
The rematch remains consensual — both players must agree. The in-game button is a convenience surface; the underlying primitives (`proposeRematch`, `acceptRematch`) are unchanged.

## Unresolved Issues / Known Limitations

1. **Availability still WS-scoped:** Players without active WebSocket connections appear as "offline" even if browsing the site. A lightweight heartbeat would improve this but was not in scope.

2. **In-game rematch polling is client-side:** The rematch acceptance detection uses HTTP polling (every 3s). A WebSocket-based notification would be more responsive but requires additional protocol messages.

3. **Staked challenge creation does not pre-validate balance:** Only acceptance validates. A player could create a staked challenge they can't afford, and the error only surfaces when the target tries to accept. This is harmless but could be polished.

## Recommended Next Steps

1. **WebSocket rematch notification** — Push rematch acceptance/decline through WebSocket instead of HTTP polling
2. **Challenge creation balance pre-check** — Validate challenger's balance at creation time
3. **Spectator/featured match surfaces** — The room system supports read-only connections
4. **Real billing/provider integration** — Production economy path when strategy is ready
5. **Social Hub polish** — Show expired challenges/rematches differently (grayed out, "Expired" badge)
