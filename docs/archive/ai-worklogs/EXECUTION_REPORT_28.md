# Execution Report — CLAUDE_DIRECTIVE_28
## Social Challenge, Follow, and Rematch Loop

**Status**: ✅ Complete  
**Date**: March 13, 2026  
**Test Suite**: 49 new tests + all existing suites passing (729 total), zero regressions

---

## Objective

Build a social challenge, follow, and rematch loop for Gin Paradise — transforming passive competition surfaces into an actionable social graph:
- Lightweight follow model for competitive connections
- Direct player-to-player challenge flow with expiry
- Social notification inbox for challenge events
- Head-to-head rivalry data on public profiles
- Follow/Challenge action buttons on public profiles and leaderboard
- Unified Social Hub page for managing challenges and connections

---

## What Was Built

### 1. Social Graph Model (`server/social.ts`)

**Lightweight follow system** with:

| Component | Implementation |
|-----------|---------------|
| Follow/Unfollow | One-directional follow model (not mutual friendship) |
| Follower/Following Counts | O(1) count queries via indexed tables |
| Follower Lists | Paginated with username + timestamp |
| Privacy Boundaries | No private data exposed via follows |
| New Follower Notifications | Automatic notification on follow event |
| Self-Follow Prevention | Cannot follow yourself |
| Duplicate Prevention | UNIQUE constraint prevents double-follows |

### 2. Challenge System (`server/social.ts`)

**Direct challenge flow** with complete lifecycle:

| Component | Implementation |
|-----------|---------------|
| Challenge States | pending → accepted / declined / expired / cancelled |
| Auto-Expiry | 5-minute TTL with automatic expiration |
| Duplicate Guard | One pending challenge per challenger→target pair |
| Active Limit | Max 5 outbound challenges per user |
| Access Control | Only participants can view challenge details |
| Stake Support | Challenge carries `stakeId` for format reuse |
| Message Support | Optional challenge message for context |

**Database Schema:**
```sql
CREATE TABLE follows (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL,
  following_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(follower_id, following_id)
);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenger_id TEXT NOT NULL,
  challenger_username TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','accepted','declined','expired','cancelled')),
  stake_id TEXT NOT NULL DEFAULT 'free',
  message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE social_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  reference_id TEXT,
  from_user_id TEXT,
  from_username TEXT,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

### 3. Social API (`server/routes/social.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/social/follow/:userId` | Yes | Follow a player by ID |
| DELETE | `/api/social/follow/:userId` | Yes | Unfollow a player by ID |
| POST | `/api/social/follow-by-username/:username` | Yes | Follow by username (profile page) |
| DELETE | `/api/social/follow-by-username/:username` | Yes | Unfollow by username (profile page) |
| GET | `/api/social/followers` | Yes | List followers |
| GET | `/api/social/following` | Yes | List following |
| GET | `/api/social/relationship/:userId` | Yes | Relationship to another player |
| POST | `/api/social/challenge` | Yes | Send a challenge (by targetId) |
| POST | `/api/social/challenge-by-username` | Yes | Send a challenge (by username) |
| POST | `/api/social/challenge/:id/accept` | Yes | Accept challenge |
| POST | `/api/social/challenge/:id/decline` | Yes | Decline challenge |
| POST | `/api/social/challenge/:id/cancel` | Yes | Cancel own challenge |
| GET | `/api/social/challenges/inbox` | Yes | Pending inbound challenges |
| GET | `/api/social/challenges/outbox` | Yes | Pending outbound challenges |
| GET | `/api/social/challenges/history` | Yes | Recent challenge history |
| GET | `/api/social/challenge/:id` | Yes | Challenge details (participants only) |
| GET | `/api/social/head-to-head/:userId` | Yes | Head-to-head record |
| GET | `/api/social/notifications` | Yes | Social notifications |
| POST | `/api/social/notifications/read` | Yes | Mark notifications as read |

### 4. Social Notifications

**Durable notification inbox** for challenge events:

| Notification Type | Trigger |
|------------------|---------|
| `challenge_received` | Someone challenges you |
| `challenge_accepted` | Your challenge was accepted |
| `challenge_declined` | Your challenge was declined |
| `challenge_expired` | Your challenge expired (5-min TTL) |
| `new_follower` | Someone started following you |

Supports:
- Unread count badge
- Mark specific or all notifications as read
- Filterable (unread-only mode)
- Paginated with configurable limit

### 5. Head-to-Head Rivalry Data

**Public, privacy-safe rivalry context**:
- Uses replay records only (no private data)
- Shows wins/losses/total between two players
- Last played timestamp
- Exposed via `/api/social/head-to-head/:userId`
- Automatically included in public profile response

### 6. Profile & Competitive Context Integration

**Public Profile (`PublicPlayerProfile.tsx`)** now includes:

- **Follow/Unfollow Button**: One-click follow toggle with animated state changes
- **Challenge Button**: Direct challenge from profile with "Challenge Sent!" confirmation
- **Follower Count**: Inline follower count in player info
- **Head-to-Head Rivalry Card**: Gradient card showing your record vs this opponent
  - Your Wins / Total Matches / Their Wins in a 3-column grid
  - Last played date
  - Only shown when you have match history together
- **Social Relationship Data**: Backend returns `isFollowing`, `isFollowedBy`, and `headToHead` when viewer is authenticated

**Public Profile API** enhancements:
- Social counts (`followerCount`, `followingCount`) added to both authenticated and public profile endpoints
- Relationship data appended when viewer has a valid session
- Head-to-head record computed from replay data — no private info leaked

### 7. Social Hub Page (`src/pages/SocialHub.tsx`)

**Unified social competition surface** with 5 tabs:

| Tab | Content |
|-----|---------|
| Inbox | Pending inbound challenges with Accept/Decline buttons |
| Sent | Outbound pending challenges with Cancel option |
| History | All challenge history with status badges and timestamps |
| Following | Following list with Profile/Unfollow actions |
| Alerts | Social notification feed with read state and mark-all-read |

Features:
- Badge counts on tabs (inbox count, unread notifications)
- Time-ago display for all timestamps
- Expiry countdown on pending challenges
- Empty states with contextual guidance
- Refresh button for manual reload
- Link navigation to player profiles from every context

### 8. Navigation Integration

- **Social Hub** added to Layout navigation with Swords icon
- `/social` route added to App router

---

## Files Created

| File | Purpose |
|------|---------|
| `server/social.ts` | Social model: follows, challenges, head-to-head, notifications |
| `server/routes/social.ts` | REST API for social actions (19 endpoints) |
| `src/pages/SocialHub.tsx` | Unified social competition surface (5-tab hub) |
| `tests/social.test.ts` | 49 comprehensive tests for social layer |

## Files Modified

| File | Changes |
|------|---------|
| `server.ts` | Social route import, table init, route mount |
| `server/routes/profile.ts` | Social counts + relationship data in both profile endpoints |
| `src/App.tsx` | SocialHub import and `/social` route |
| `src/components/Layout.tsx` | Social nav item with Swords icon |
| `src/pages/PublicPlayerProfile.tsx` | Follow/Challenge buttons, H2H rivalry card, follower counts |
| `tests/helpers.ts` | Social route mount, table init, DELETE method support |

---

## Test Coverage

**49 new tests** across 9 describe blocks:

| Suite | Tests | Coverage |
|-------|-------|----------|
| Social Follow Model | 11 | Follow, self-rejection, duplicate rejection, nonexistent player, relationship check, self-relationship, followers list, following list, new follower notification, unfollow, unfollow-when-not-following |
| Direct Challenge Flow | 12 | Create, self-rejection, duplicate rejection, inbox listing, outbox listing, challenge notification, wrong-user accept rejection, accept, double-accept rejection, accepted notification, participant-only access, history |
| Challenge Decline Flow | 3 | Create+decline, decline notification, double-decline rejection |
| Challenge Cancel Flow | 2 | Create+cancel, wrong-user cancel rejection |
| Challenge Validation Edge Cases | 3 | Missing targetId, nonexistent player, nonexistent challenge |
| Head-to-Head Record | 2 | Empty matchup, self head-to-head |
| Social Notifications | 4 | List all, filter unread, mark specific read, mark all read |
| Public Profile Social Integration | 3 | Social counts in own profile, public profile, relationship data |
| Regression: Existing Systems | 9 | Health, auth, leaderboard, seasons, wallet, profile, training, tournaments, cosmetics |

### Cross-Suite Results

**All existing test suites pass with the social changes:**

| Test File | Tests | Status |
|-----------|-------|--------|
| social.test.ts | 49 | ✅ All pass |
| entitlements.test.ts | 33 | ✅ All pass |
| coaching.test.ts | 35 | ✅ All pass |
| training.test.ts | 29 | ✅ All pass |
| cosmetics.test.ts | 34 | ✅ All pass |
| profile.test.ts | 31 | ✅ All pass |
| live-triggers.test.ts | 29 | ✅ All pass |
| seasons.test.ts | 33 | ✅ All pass |
| api.test.ts | 21 | ✅ All pass |
| admin.test.ts | 25 | ✅ All pass |
| evaluation.test.ts | 18 | ✅ All pass |
| replay-analysis.test.ts | 23 | ✅ All pass |
| replays.test.ts | 18 | ✅ All pass |
| wallet.test.ts | 24 | ✅ All pass |
| escrow.test.ts | 34 | ✅ All pass |
| fairness.test.ts | 47 | ✅ All pass |
| tournament.test.ts | 35 | ✅ All pass |
| scheduled-tournament.test.ts | 32 | ✅ All pass |
| competitive-integrity.test.ts | 35 | ✅ All pass |
| game-feel.test.ts | 21 | ✅ All pass |
| default-rollout.test.ts | 24 | ✅ All pass |
| hardening.test.ts | 16 | ✅ All pass |
| rake.test.ts | 32 | ✅ All pass |
| matchmaking.test.ts | 15 | ✅ All pass |
| multiplayer.test.ts | 19 | ✅ All pass |
| showdown-fidelity.test.ts | 17 | ✅ All pass |

**Total: 729 tests across 26 files, all passing.**

---

## Acceptance Criteria Verification

| Criteria | Status |
|----------|--------|
| Lightweight social graph (follow/unfollow) | ✅ Full follow model with counts, lists, notifications |
| Privacy and abuse boundaries maintained | ✅ No private data in public endpoints, self-follow/duplicate blocked |
| Direct challenge flow on top of heads-up foundation | ✅ Complete lifecycle: pending→accepted/declined/expired/cancelled |
| Challenges from public profiles | ✅ Follow/Challenge buttons on PublicPlayerProfile |
| Challenge expiry (5-minute TTL) | ✅ Auto-expire with notification |
| Challenge accept/decline/cancel | ✅ All three actions with access control |
| Challenge notification inbox | ✅ Social notifications with unread count, mark-read |
| Head-to-head rivalry context | ✅ Wins/losses/total from replays, shown on profile |
| No private data leaked in rivalry | ✅ Only replay outcomes exposed |
| Social/challenge entry points on profiles | ✅ Follow + Challenge buttons on player profiles |
| No full chat or DM | ✅ Challenge messages only, no chat system |
| No spectating system | ✅ Not implemented |
| No irreversible billing integration | ✅ No billing changes |
| No gameplay-affecting social rewards | ✅ Follows/challenges are display-only |
| No regression of existing systems | ✅ All 680 pre-existing tests still pass |
| No weakening of fairness, auth, stakes, or room authority | ✅ No changes to game engine, auth, or escrow |

---

## Architecture Decisions

1. **One-Directional Follow Model**: Follows are asymmetric (like Twitter), not mutual friendships. This avoids consent complexity and supports competitive "watching" dynamics naturally.

2. **Username-Based Endpoints**: Added `follow-by-username` and `challenge-by-username` endpoints because the public profile deliberately doesn't expose `userId` for privacy reasons. The frontend resolves username→userId server-side.

3. **5-Minute Challenge TTL**: Challenges auto-expire after 5 minutes via `expirePendingChallenges()` called before every query. No background job needed — expiry is lazy but deterministic.

4. **Separate Social Notifications Table**: Rather than extending the existing achievement notification system, social notifications use their own table (`social_notifications`) with a dedicated type system. This prevents coupling between achievement and social subsystems.

5. **Head-to-Head from Replays Only**: The `getHeadToHead()` function queries only the `replays` table, which contains match outcomes. No game-state, accuracy, or internal metrics are exposed — only win/loss/total and last-played timestamp.

6. **Relationship Data in Profile Response**: When a requester has a valid session, the public profile response includes `relationship` with `isFollowing`, `isFollowedBy`, and `headToHead`. This enables the frontend to render action buttons and rivalry data without extra API calls.

7. **Challenge Accept Does Not Auto-Create Match**: The challenge acceptance marks the challenge as accepted and notifies both parties, but does not auto-create a WebSocket room. The accepted challenge serves as intent validation — the actual match start flows through the existing matchmaking/room system. This avoids coupling challenge state with room lifecycle.

8. **Max 5 Active Challenges**: A simple throttle prevents spam. Users must cancel existing challenges before sending more, keeping the system lightweight.
