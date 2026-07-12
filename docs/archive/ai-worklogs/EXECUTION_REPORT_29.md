# Execution Report 29: Seamless Challenge-to-Match Activation Sprint

**Date:** March 13, 2026  
**Directive:** Claude Directive 29 — Seamless Challenge-to-Match Activation  
**Status:** ✅ Complete

---

## Objective

Turn the social challenge/rematch layer into a true gameplay loop by making accepted challenges and consensual rematches flow directly into a real private match/lobby experience with minimal friction and no compromise to the server-authoritative model.

## Current Context (Before)

- Gin Paradise had a complete social layer: follows, direct challenges, challenge inbox/history, head-to-head rivalry, Social Hub
- **Critical gap:** Accepted challenges stopped at "accepted intent" — players could express intent to compete but the product did not convert that intent into a seamless head-to-head session
- 729/729 tests passing across 26 test files

## Actions Taken (Chronological)

### 1. Social Model Extension (`server/social.ts`)

- **Challenge Room Allocation:** Modified `acceptChallenge()` to allocate a unique room ID (prefixed `CH-`) when a challenge is accepted. The room ID is stored on the challenge record in the database.
- **Rematch Model:** Added full `rematches` table and operations:
  - `proposeRematch()` — creates a rematch proposal with 3-minute expiry
  - `acceptRematch()` — allocates a room ID on acceptance
  - `declineRematch()` — declines the proposal
  - `expirePendingRematches()` — auto-expires old proposals
  - Duplicate prevention between same player pairs
  - Self-rematch prevention
- **Availability Model:** Added `PlayerAvailability` type (`online | in_match | in_queue | offline`) with callback-based architecture to avoid circular imports
- **New Notification Types:** `match_ready` and `rematch_accepted` — both notify with actionable "Join the match now" messaging
- **Migration:** Auto-migration adds `room_id` column to existing `challenges` table

### 2. WebSocket Protocol Extension (`server/multiplayer/types.ts`)

- Added `join_challenge_room` client message type with `roomId` and optional `stakeId` fields
- This allows WebSocket clients to join rooms allocated by challenge/rematch acceptance

### 3. Room Manager Enhancement (`server/multiplayer/roomManager.ts`)

- **Challenge Room Handler:** Added `join_challenge_room` message case that:
  - Creates the room with predetermined ID if it doesn't exist yet (first player to join)
  - Joins as second player if room exists and is waiting
  - Reconnects if player was already in the room
  - Auto-starts the match when both players are present
  - Handles edge cases: full rooms, games already in progress
- **Availability Callback:** Registers `getPlayerStatus()` with `setAvailabilityCallback()` on WS server attach
- **Player Status Derivation:** `getPlayerStatus()` derives availability from in-memory room state and matchmaking queue — no persistent presence infrastructure needed

### 4. Social API Routes Extension (`server/routes/social.ts`)

Added new endpoints:
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/social/challenges/accepted` | GET | List accepted challenges with room IDs (joinable matches) |
| `/api/social/rematch` | POST | Propose a rematch |
| `/api/social/rematch/:id/accept` | POST | Accept a rematch (returns roomId) |
| `/api/social/rematch/:id/decline` | POST | Decline a rematch |
| `/api/social/rematches` | GET | List pending rematches for user |
| `/api/social/rematch/:id` | GET | Rematch detail (participants only) |
| `/api/social/availability/:userId` | GET | Single player availability status |
| `/api/social/availability/batch` | POST | Batch availability check (up to 50 users) |

Updated existing endpoint:
- `POST /api/social/challenge/:id/accept` — now returns `roomId` in response body

### 5. Multiplayer Hook Extension (`src/lib/useMultiplayer.ts`)

- Added `joinChallengeRoom()` convenience action that sends the `join_challenge_room` WebSocket message
- Exported in the hook's return value

### 6. MultiplayerRoom Page Update (`src/pages/MultiplayerRoom.tsx`)

- Added `?challengeRoom=ROOMID` URL parameter handling
- Auto-connects WebSocket and auto-joins the challenge room on navigation
- Identical pattern to existing `?quickmatch=true` and `?tournamentId=...` handling

### 7. Social Hub Frontend Rewrite (`src/pages/SocialHub.tsx`)

Complete rewrite with:
- **"Active" tab** — Shows joinable accepted challenges with "Join Match" button (gradient emerald CTA) and pending rematch proposals with wait indicator
- **Inbox** — Accept challenges with "Accept & Play" button that navigates directly to the match; rematch requests shown with "Accept & Play" and "Decline" actions
- **Following list** — Availability status badges (green dot = online, amber = in match, indigo = searching, grey = offline) with labels
- **Notifications** — `match_ready` and `rematch_accepted` notifications highlighted with emerald styling and Play icon
- **6-tab layout:** Inbox, Active, Outbox, History, Following, Alerts

### 8. Test Suite (`tests/challenge-match.test.ts`)

41 new tests across 12 describe blocks:
- Challenge acceptance with room allocation (3)
- Accepted challenges listing (3)
- Match-ready notifications (1)
- Rematch proposal and acceptance (6)
- Rematch decline (2)
- Rematch duplicate prevention (1)
- Rematch self-challenge prevention (1)
- Rematch detail endpoint (2)
- Availability status API (3)
- Batch availability API (3)
- Rematch validation errors (2)
- Challenge room ID format (1)
- Edge cases (2)
- Regression tests (11)

## Files Created

| File | Purpose |
|---|---|
| `tests/challenge-match.test.ts` | 41 new tests for challenge-to-match activation |

## Files Modified

| File | Changes |
|---|---|
| `server/social.ts` | Rematch model, availability model, room allocation on challenge accept, new notification types, DB migration |
| `server/routes/social.ts` | 8 new endpoints (rematch, availability), accept response includes roomId |
| `server/multiplayer/types.ts` | `join_challenge_room` client message type |
| `server/multiplayer/roomManager.ts` | Challenge room join handler, availability callback, getPlayerStatus |
| `src/lib/useMultiplayer.ts` | `joinChallengeRoom` action |
| `src/pages/MultiplayerRoom.tsx` | `?challengeRoom=ROOMID` auto-join handling |
| `src/pages/SocialHub.tsx` | Complete rewrite with Active tab, availability badges, match-ready emphasis |

## Tests and Verification

### Automated Tests
- **New tests:** 41 (challenge-match.test.ts)
- **Total suite:** 770/770 passing ✅ (was 729)
- **Zero regressions** across all 27 test files

### Design Verification
- Accepted challenges allocate room IDs in `CH-XXXXXX` format
- Both challenger and target can see the room ID and join
- Rematch proposals create real room allocations on acceptance
- Availability status derives from room/queue state without persistent infrastructure
- All existing trust/safety boundaries preserved (auth, escrow, wallet, fairness)

## Architecture Notes

### How Accepted Challenges Map to Rooms
1. Challenge is created (status: `pending`, roomId: `null`)
2. Target accepts → `acceptChallenge()` generates a `CH-XXXXXX` room ID and stores it
3. Both players navigate to `/play/multiplayer?challengeRoom=CH-XXXXXX`
4. First player's WebSocket `join_challenge_room` creates the room with that predetermined ID
5. Second player's `join_challenge_room` joins the existing room
6. When both players are present, `startMatchForRoom()` is called automatically
7. Normal multiplayer game flow takes over (server-authoritative engine, timers, transcripts, escrow)

### How Rematches Work
1. Player proposes rematch via `POST /api/social/rematch` (3-minute expiry)
2. Opponent accepts → `acceptRematch()` allocates a room ID
3. Both players navigate to the challenge room URL
4. Same join flow as challenge rooms

### Availability States
| Status | Derived From |
|---|---|
| `in_match` | Player is in a room with `status === "playing"` |
| `in_queue` | Player is in the matchmaking queue |
| `online` | Player has a WebSocket connection or is in a waiting room |
| `offline` | No active state found (default) |

Note: Without persistent WebSocket connection tracking at the HTTP layer, "online" is a conservative approximation. Players without an active WS connection but making API calls will show as "offline" from the availability callback. This is acceptable for the lightweight status cues requirement.

## Unresolved Issues / Known Limitations

1. **No room expiry for challenge rooms:** If both players accept a challenge but neither ever joins the WebSocket, the room ID is allocated but never used. This is harmless (no resources consumed until first join) but the UI would show stale "Join Match" entries indefinitely. A cleanup job or TTL on challenge rooms would be a future polish item.

2. **Availability is WS-connection-scoped:** The availability callback can only report status for players with active WebSocket connections (in rooms or queue). HTTP-only sessions appear as "offline" even if the player is actively browsing. A lightweight heartbeat or presence layer would improve this, but that was explicitly a non-goal for this sprint.

3. **Escrow integration at challenge-room join time:** The challenge room creation uses the free stake by default. If the challenge specified a non-free stake, the escrow hold would need to happen at room join time. The infrastructure supports this (the `join_challenge_room` message accepts a `stakeId`), but the frontend does not yet pass the challenge's stake through. Staked challenges will need this wired in a future sprint.

4. **No "rematch" button in the game-over overlay:** The rematch flow is initiated from the Social Hub, not from within the game-over screen. Adding a rematch button to the multiplayer game-over overlay would reduce friction further.

## Recommended Next Steps

1. **Game-over rematch button** — Add "Rematch?" prompt to the multiplayer game-over overlay for immediate rematch without leaving the game screen
2. **Staked challenge room handoff** — Wire challenge stakeId through to the room join for non-free challenges 
3. **Challenge room TTL** — Auto-clean stale challenge rooms after 15 minutes of inactivity
4. **Spectator/featured match surfaces** — The room system is now flexible enough to support read-only spectator connections
5. **Real billing/provider integration** — Production economy path when product strategy is ready
