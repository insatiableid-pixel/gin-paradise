# EXECUTION REPORT 32 — Broadcast Productization, Spectator Preferences & Live Operations

**Directive:** CLAUDE_DIRECTIVE_32.md  
**Sprint:** Broadcast Productization, Spectator Preferences & Live Operations  
**Date:** 2026-03-14  
**Status:** ✅ COMPLETE  

---

## Summary

Gin Paradise's spectator MVP has been productized into a full broadcast layer. Admins can now curate featured matches through a dedicated dashboard tab with live match inspection and one-click feature/unfeature controls. Players have durable opt-in/opt-out spectate preferences that are enforced server-side — admin featuring cannot override player consent. Broadcast analytics (peak viewers, unique spectators, match duration) are tracked in-memory during matches and persisted to a durable `broadcast_metrics` table on match completion. The discovery surface now includes broadcast history, and the spectator view wire protocol includes admin-featured status for broadcast UX differentiation.

---

## What Was Built

### 1. Admin Featured-Match Operations

**Files:** `server/routes/admin.ts`, `server/multiplayer/roomManager.ts`, `server/multiplayer/spectator.ts`

Admin dashboard now has full broadcast operations:

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/broadcast/live` | List ALL live matches with admin metadata (eligibility, reasons, ineligibility explanation, broadcast stats) |
| `POST /api/admin/broadcast/feature` | Admin-feature a live match (respects player consent) |
| `POST /api/admin/broadcast/unfeature` | Remove admin featuring from a match |
| `GET /api/admin/broadcast/metrics` | Summary stats + recent broadcast metrics |

**Key design decision:** Admin featuring does NOT override player spectate preferences. If a player has disabled spectating, the admin can still mark the room as "featured," but it will not appear in the public featured list. The admin dashboard clearly shows ineligibility reasons when a match cannot be spectated.

### 2. Player Spectate Preferences (Durable)

**Files:** `server/db.ts`, `server/multiplayer/spectator.ts`, `server/routes/spectator.ts`

**Table:** `player_spectate_preferences`

| Column | Type | Purpose |
|---|---|---|
| `user_id` | TEXT PK | Links to `users.id` |
| `allow_spectating` | INTEGER | 1 = allow (default), 0 = opt-out |
| `updated_at` | DATETIME | Last preference change |

**Preference enforcement model:**

| Match Type | Preference Required? | Behavior |
|---|---|---|
| Tournament | ❌ No | Always public by rule |
| High-stakes (gold_2000+, sweeps_1) | ✅ Both players | Hidden if either opts out |
| Admin-featured | ✅ Both players | Admin cannot override consent |
| Ranked (both ≥1400) | ✅ Both players | Hidden if either opts out |
| Free quick-match | N/A | Never eligible |
| Private challenge | N/A | Never eligible |

**API:**

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/spectator/preference` | Required | Get player's current preference |
| `PUT /api/spectator/preference` | Required | Set `{ allowSpectating: boolean }` |

### 3. Spectator Analytics (In-Memory + Durable)

**Files:** `server/multiplayer/spectator.ts`, `server/db.ts`, `server/multiplayer/roomManager.ts`

**In-memory tracking** during live matches:
- Peak concurrent spectators
- Unique spectator set (across joins/leaves)
- Admin-featured status during match

**Durable persistence** (`broadcast_metrics` table) on match completion:

| Column | Description |
|---|---|
| `peak_concurrent_spectators` | Highest simultaneous viewer count |
| `total_unique_spectators` | Distinct users who watched |
| `was_admin_featured` | Whether admin manually featured this match |
| `featured_reasons` | JSON array of eligibility reasons |
| `match_duration_seconds` | Total match length |
| `winner_id`, `winner_username` | Match outcome |
| `stake_id` | Stake level |

Analytics are initialized at match start (`initBroadcastStats`), updated on spectator join/leave, and persisted on match completion. Cleanup occurs when rooms are destroyed.

### 4. Broadcast UX Polish

**Files:** `src/pages/FeaturedMatches.tsx`, `src/pages/AdminDashboard.tsx`, `server/multiplayer/types.ts`

**FeaturedMatches page enhancements:**
- Tabbed layout: "Live Now" + "Broadcast History"
- Live match cards display "Admin Pick" badge for admin-featured matches
- Broadcast history table shows completed match metrics (peak/unique viewers, winner, duration)
- Spectate preference toggle with privacy explanation
- Auto-refresh every 10 seconds

**AdminDashboard enhancements:**
- New "Broadcast" tab with:
  - Summary cards: total broadcasts, unique viewers, peak all-time, admin featured count
  - Live match list with feature/unfeature buttons
  - Eligibility reasons + ineligibility explanations for each match
  - Live broadcast stats (peak, unique, current)
  - Recent broadcast history table

**Wire protocol:**
- `SpectatorGameViewWire.isAdminFeatured` flag added for frontend differentiation
- Initial spectator view and broadcast updates both include the flag

### 5. Privacy & Security Invariants

All invariants from Sprint 31 are preserved:

- ✅ **No hidden card leakage** — SpectatorGameView remains a distinct, independently-constructed type
- ✅ **No spectator interaction** — read-only wire protocol
- ✅ **No private challenge exposure** — eligibility rules unchanged
- ✅ **Admin cannot override player consent** — featuring respects preferences
- ✅ **Tournament always public** — rule-based, not preference-dependent
- ✅ **Server-authoritative projection** — no client-side filtering

### 6. Test Coverage

**File:** `tests/spectator.test.ts` — **74 tests** (up from 39)

| Test Group | Count | Covers |
|---|---|---|
| Spectator View — Privacy Safety | 7 | Hidden card invariants, public-only projection |
| Featured Match Eligibility | 12 | All reason types, combinations, thresholds |
| Spectator Tracking | 6 | Add/remove/count/cleanup |
| Featured Matches API | 2 | Public endpoint shape |
| Spectator View — Data Shape | 5 | Public field completeness |
| Player Spectate Preferences | 4 | Default/opt-out/toggle/both-players |
| Preference-Aware Eligibility | 5 | Blocking, tournament bypass, admin consent |
| Player Spectate Preference API | 7 | Get/set/toggle/validation/auth |
| Broadcast Analytics | 7 | Init/peak/unique/persist/cleanup |
| Broadcast Metrics Summary | 1 | Summary shape |
| Admin Broadcast API | 10 | Auth enforcement, feature/unfeature, metrics |
| Broadcast Metrics API (public) | 1 | Recent metrics endpoint |
| Spectator Regression | 8 | Registration, wallet, leaderboard, auth, profile |

**Additional fix:** `tests/api.test.ts` cleanup updated to handle `player_spectate_preferences` FK constraint.

**Full suite:** 872 tests across 29 files — all passing.

---

## Files Modified

| File | Change |
|---|---|
| `server/db.ts` | Added `player_spectate_preferences` and `broadcast_metrics` tables |
| `server/multiplayer/spectator.ts` | Complete rewrite: added preferences, analytics, persistence, admin ops |
| `server/multiplayer/roomManager.ts` | Integrated analytics, preferences, admin metadata, `getLiveMatches()` |
| `server/multiplayer/types.ts` | Added `isAdminFeatured` to `SpectatorGameViewWire` |
| `server/routes/admin.ts` | Added broadcast live/feature/unfeature/metrics endpoints |
| `server/routes/spectator.ts` | Added preference get/set + public metrics endpoints |
| `src/pages/FeaturedMatches.tsx` | Tabbed layout, broadcast history, preference toggle |
| `src/pages/AdminDashboard.tsx` | New Broadcast tab with full live/metrics UI |
| `tests/spectator.test.ts` | 74 tests covering all new features |
| `tests/api.test.ts` | FK constraint cleanup fix |

---

## Architecture Notes

```
┌──────────────────────────────────────────────────────────────┐
│  SPECTATOR ARCHITECTURE (Productized)                         │
│                                                                │
│  Player Preferences ─────────► Eligibility Engine ◄──── Rules  │
│  (DB: player_spectate_preferences)     │             (tournament, │
│                                        │              stakes,     │
│                                        │              rating)     │
│                                        ▼                         │
│                              Featured Match List                │
│                                        │                         │
│                     ┌──────────────────┼──────────────────┐     │
│                     │                  │                  │     │
│               Public API         Admin API          WebSocket   │
│            /spectator/featured  /admin/broadcast/*  watch_match │
│                     │                  │                  │     │
│               FeaturedMatches    AdminDashboard     SpectatorView│
│                (Live + History)  (Broadcast tab)   (isAdminFeatured)│
│                     │                                           │
│               Preference Toggle                                 │
│                                                                │
│  Analytics:                                                     │
│    In-Memory ──► peakConcurrent, uniqueSpectators               │
│    On Complete ──► broadcast_metrics (durable)                  │
│    Admin View ──► summary + recent metrics                      │
└──────────────────────────────────────────────────────────────┘
```

---

## Non-Goals Confirmed

- ❌ No real-time chat/emoji reactions (out of scope for this sprint)
- ❌ No delay buffer (stream delay) — matches are shown in real-time
- ❌ No spectator-count-based matchmaking boost
- ❌ No public spectator leaderboard
