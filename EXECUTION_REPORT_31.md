# EXECUTION REPORT 31 — Featured Matches & Privacy-Safe Spectator MVP

**Directive:** CLAUDE_DIRECTIVE_31.md  
**Sprint:** Featured Matches and Privacy-Safe Spectator MVP  
**Date:** 2026-03-14  
**Status:** ✅ COMPLETE  

---

## Summary

Gin Paradise now has a first real featured-match/spectator MVP. Players can discover notable live matches through a dedicated "Live" surface and watch them in real-time with a clean, read-only spectator experience. The spectator system strictly enforces hidden-information safety — spectators **never** see either player's cards during live play. Hands are only revealed at showdown (end of round), consistent with the game's public information model.

---

## What Was Built

### 1. Privacy-Safe Spectator State Projection

**File:** `server/multiplayer/spectator.ts`

A dedicated spectator module provides explicit public-state projection. The `getSpectatorView()` function generates a `SpectatorGameView` that intentionally includes only publicly-safe information:

**What spectators CAN see:**
| Data Field | Source | Privacy Status |
|---|---|---|
| Player usernames | Match state | ✅ Public |
| Scores (both players) | Match state | ✅ Public |
| Current turn (whose turn) | Match state | ✅ Public |
| Card counts (hand sizes) | Match state | ✅ Public |
| Top discard card | Discard pile | ✅ Public |
| Stock pile count | Match state | ✅ Public |
| Discard pile count | Match state | ✅ Public |
| Game status | Match state | ✅ Public |
| Round number | Match state | ✅ Public |
| Winner (at game end) | Match state | ✅ Public |
| Showdown data (melds, deadwood) | Round/game over | ✅ Public (post-showdown) |
| Stake info (if staked) | Escrow | ✅ Public |

**What spectators NEVER see:**
| Data Field | Why Hidden |
|---|---|
| Either player's hand (cards) | Core hidden information — card identities are secret |
| Stock pile card identities | Hidden game state |
| PlayerGameView fields (myHand, hasDrawn, etc.) | Player-specific privileged data |
| Fairness commitments/seeds | Player-specific Trust Shield data |
| Turn timer details | Player-specific UI state |

The `SpectatorGameView` is a completely separate type from `PlayerGameView` — there is no filtering or subsetting of player views. The spectator projection is built from scratch against the match state, ensuring no accidental leakage through field inheritance.

### 2. Match Eligibility / Opt-In Rules

**Spectatable match types (first pass — simple and safe):**

| Match Type | Eligible? | Reason Code |
|---|---|---|
| Tournament matches | ✅ Always | `tournament` |
| High-stakes (gold_2000, gold_5000, sweeps_1) | ✅ Always | `high_stakes` |
| Admin-featured | ✅ When admin-promoted | `featured` |
| Both players rated ≥1400 | ✅ When criteria met | `ranked` |
| Free quick-match | ❌ Not eligible | — |
| Private challenges | ❌ Not eligible | — |

**Design rationale:** Free and private matches are excluded by default to preserve privacy. The eligibility model is conservative — it only makes "notable" matches watchable, avoiding the impression that every casual game is broadcast.

### 3. Featured Matches Discovery Surface

**Frontend Page:** `src/pages/FeaturedMatches.tsx`  
**Route:** `/live`  
**Nav Item:** "Live" with Tv icon  

Features:
- Auto-refreshing match list (10-second interval)
- Live indicator with pulsing dot
- Match cards showing player names, ratings, scores, round progress
- Reason badges (Tournament, High Stakes, Featured, Top Ranked)
- Spectator count per match
- Prize pool display for staked matches
- "Watch Live" CTA buttons
- Empty state with helpful description of what makes matches eligible
- Privacy/spectating info footer explaining boundaries
- **No authentication required** to view the list (public discovery surface)

### 4. Spectator Watch Experience

**Frontend Page:** `src/pages/SpectatorView.tsx`  
**Hook:** `src/lib/useSpectator.ts`  
**Route:** `/play/multiplayer?watch=ROOMID`

Features:
- Live WebSocket connection to match via `watch_match` message
- Score board with player avatars and turn indicators
- Card table showing stock pile (face-down) and discard pile (top card)
- Card count display (hand sizes, not card identities)
- "TURN" badge on active player
- Showdown display at round_over/game_over (melds, deadwood, layoffs)
- Stake/prize pool display
- "LIVE" badge in header
- Spectator count
- "Read-only mode" indicator with EyeOff icon
- Clean connection/error/match-over states
- Auto-disconnect on unmount

### 5. WebSocket Protocol Additions

**New client messages:**
- `watch_match { roomId }` — Join as spectator
- `leave_spectate` — Leave spectator session

**New server messages:**
- `spectator_update { state: SpectatorGameViewWire }` — Live game state push
- `spectator_joined { roomId, spectatorCount }` — Notify players of new spectator
- `spectator_left { roomId, spectatorCount }` — Notify players when spectator leaves
- `spectator_match_over { roomId, message }` — Notify spectators when match ends

### 6. REST API

**Endpoint:** `GET /api/spectator/featured`  
**Auth:** None required (public)  
**Response:** `{ matches: FeaturedMatch[] }`

### 7. Server-Side Spectator Management

In `roomManager.ts`:
- Spectator WebSocket connections tracked in `spectatorConnections` map
- `broadcastSpectatorView()` called on every game state change (including showdowns)
- Spectators automatically cleaned up on room cleanup, match end, and disconnect
- Eligibility check on `watch_match` — rejects ineligible matches
- Players cannot spectate their own match
- Players receive `spectator_joined`/`spectator_left` notifications with counts

---

## Fairness and Anti-Leak Boundaries

- ✅ **No weakening of server authority** — The engine remains the single source of truth. Spectator views are generated server-side from match state, not client-filtered.
- ✅ **No hidden-hand leakage** — The `SpectatorGameView` type is built independently of `PlayerGameView`. There is no path for card data to leak to spectators during live play.
- ✅ **Showdown visibility is consistent** — Hands are revealed to spectators only at the same point they would be visible to any observer: after a knock/gin/undercut showdown.
- ✅ **No spectator interaction** — Spectators cannot send game actions, chat, or influence play. WebSocket is one-directional (server → spectator).
- ✅ **Trust Shield unaffected** — Fairness commitments, client seeds, and verification remain player-only. Spectators do not participate in Trust Shield flows.
- ✅ **Escrow unaffected** — Stake management, entry fees, and settlements are unchanged.

---

## What Remains Out of Scope

- ❌ Spectator chat, emotes, or direct interaction
- ❌ Hidden-hand reveal during live play (by design, permanently)
- ❌ Broad streaming/media infrastructure
- ❌ Admin UI for featuring matches (API exists; admin panel integration is a follow-on)
- ❌ Spectator analytics or engagement metrics
- ❌ Player opt-in/opt-out toggle for spectating (currently rule-based only)

---

## Test Coverage

**New test file:** `tests/spectator.test.ts`  
**New tests:** 39

### Test Categories:

| Category | Tests | Description |
|---|---|---|
| Privacy Safety | 7 | Verifies hands are never exposed, stock identities hidden, card counts correct |
| Featured Eligibility | 11 | Tournament, stakes, admin, ranked, combinations, edge cases |
| Spectator Tracking | 6 | Add/remove/count/list/cleanup/dedup spectators |
| Featured Matches API | 2 | Empty list response, no-auth access |
| Data Shape | 5 | Required fields, status, scores, round, discard count |
| Regression | 8 | Auth, wallet, leaderboard, social, profile, faucet, seasons |

### Full Suite Results:
- **Test files:** 29 passed (29) ← was 28, now 29 with spectator.test.ts
- **Total tests:** 837 passed (837) ← was 798, now 837 (39 new)
- **Zero regressions** across all existing test files

---

## Files Created / Modified

### New Files:
| File | Purpose |
|---|---|
| `server/multiplayer/spectator.ts` | Core spectator module — view projection, eligibility, tracking |
| `server/routes/spectator.ts` | REST API for featured matches |
| `src/pages/FeaturedMatches.tsx` | Featured matches discovery page |
| `src/pages/SpectatorView.tsx` | Live spectator watch page |
| `src/lib/useSpectator.ts` | React hook for spectator WebSocket |
| `tests/spectator.test.ts` | Comprehensive spectator tests |

### Modified Files:
| File | Changes |
|---|---|
| `server/multiplayer/types.ts` | Added spectator message types and SpectatorGameViewWire |
| `server/multiplayer/roomManager.ts` | Spectator WS handling, broadcast, featured listing, cleanup |
| `server.ts` | Registered spectator routes |
| `tests/helpers.ts` | Registered spectator routes in test server |
| `src/App.tsx` | Added FeaturedMatches route at `/live` |
| `src/pages/MultiplayerRoom.tsx` | SpectatorView integration via `?watch=` param |
| `src/components/Layout.tsx` | Added "Live" nav item |

---

## Architecture Notes

The spectator system follows the same design principles as the rest of Gin Paradise:

1. **Server-authoritative projection** — `getSpectatorView()` runs server-side against `MatchState`, not against any client-visible data.
2. **Separate type boundary** — `SpectatorGameView` is a distinct type from `PlayerGameView`, preventing accidental field inheritance.
3. **In-memory tracking** — Spectator connections and room tracking use the same in-memory pattern as the player room manager.
4. **Callback pattern** — Same pattern used for availability (social ↔ roomManager) is extended for spectator state.
5. **Clean separation** — Spectator eligibility rules are in the spectator module, not scattered across game logic.
