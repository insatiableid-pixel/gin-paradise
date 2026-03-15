# Gin Paradise — Comprehensive Project Status Report

**Date:** March 15, 2026  
**Project:** Gin Paradise — Competitive Gin Rummy Platform  
**Vision:** A competitive Gin Rummy platform modeled after Backgammon Galaxy, featuring a single non-redeemable coin economy, coin-package billing (Stripe), premium subscription, AI opponents, leaderboards, and match analysis.  
**Status:** Visual Parity Complete ✅ — Emerald felt + gold accent palette unified across single-player, multiplayer, spectator, and showdown. Shared card visual system (`src/components/cards/index.tsx`) eliminates drift. All indigo/zinc legacy accents removed from game surfaces.

---

## 1. Architecture Overview

```
Gin Rummy/
├── gin_rummy/                  ← Python AI Engine (research & benchmarking)
│   ├── card.py                    Card data model
│   ├── meld.py                    Meld finding & deadwood computation
│   ├── game.py                    Core game loop
│   ├── player.py                  Base player class + SimplePlayer + RandomPlayer
│   ├── heisenbot.py               AAAI-21 paper reimplementation
│   ├── deepknock.py               Advanced AI (Bayesian model + Monte Carlo)
│   ├── titan.py                   Champion AI (meld-completing draws + safety)
│   ├── apex.py                    Optimal AI (near-meld-aware + defensive draws)
│   ├── nexus.py                   Optimal AI (actual DW computation + layoff-aware MC)
│   ├── evaluator.py               Mathematical replay evaluator (Apex v2 engine agreement)
│   ├── opponent_model.py          Bayesian opponent tracking module
│   ├── tournament.py              Round-robin tournament framework
│   └── benchmark.py               Performance benchmarking suite
│
├── gin-galaxy/                 ← Web Platform (Vite + React + Express + SQLite)
│   ├── server.ts                  Express bootstrap + config + health + graceful shutdown
│   ├── server/                    Modular backend
│   │   ├── config.ts                Production configuration (env vars, validation, startup logging)
│   │   ├── db.ts                    Database setup, session management, migrations
│   │   ├── middleware/
│   │   │   ├── auth.ts              Shared auth middleware (Bearer token + session expiry)
│   │   │   ├── adminAuth.ts         Admin authorization middleware (is_admin column check)
│   │   │   ├── validate.ts          Request body validation factory
│   │   │   └── rateLimit.ts         In-memory rate limiter
│   │   ├── routes/
│   │   │   ├── auth.ts              Register, login, logout, /me
│   │   │   ├── matches.ts           Match recording, history, stats
│   │   │   ├── leaderboard.ts       Global + seasonal leaderboard (dual-view)
│   │   │   ├── seasons.ts           Season API: current, leaderboard, stats, history
│   │   │   ├── analysis.ts          Gemini AI match analysis (summary-based)
│   │   │   ├── replayAnalysis.ts    Transcript-driven replay AI analysis
│   │   │   ├── replayEvaluation.ts  Engine-backed mathematical replay evaluation
│   │   │   ├── training.ts          Training API: summary, session review, trends, batch-prep, history, progression, coaching integration, entitlement gating
│   │   │   ├── profile.ts           Profile & Achievement API (profile, public profile, prestige, backfill)
│   │   │   ├── cosmetics.ts         Cosmetic Inventory & Store API (catalog, inventory, equip, purchase, migrate, admin grant)
│   │   │   ├── entitlements.ts      Entitlement & Premium Plan API (plan info, features, admin grant/revoke, audit)
│   │   │   ├── social.ts            Social API: follow/unfollow, challenges, head-to-head, notifications
│   │   │   ├── spectator.ts         Spectator API: featured matches, player preference management, broadcast metrics (public)
│   │   │   ├── billing.ts           Billing API: coin packages, subscriptions, purchase/subscribe initiation, history, session status
│   │   │   ├── webhooks.ts          Stripe Webhook endpoint: signature verification, event processing, status reporting
│   │   │   ├── dailyRetention.ts    Daily Retention API: summary, check-in, mission claim, puzzle submit/claim, puzzle history
│   │   │   └── offers.ts            Offer API: eligible offers, offer details, impression/dismiss/click tracking, redemption, user offer state
│   │   ├── achievements.ts            Achievement engine, prestige unlocks, retroactive backfill
│   │   ├── cosmetics.ts               Cosmetic catalog, ownership tracking, equip/purchase validation, prestige migration
│   │   ├── entitlements.ts             Premium entitlement model: plan tiers, feature catalog, grant/revoke, audit log, auto-expiry
│   │   ├── seasons.ts                  Season model: season lifecycle, seasonal Elo, standings, match recording
│   │   ├── social.ts                   Social model: follows, challenges, rematches, availability, match-ready notifications, challenge-to-room handoff
│   │   ├── ledger.ts                 Atomic wallet mutations, faucet, signup bonus, differentiated reward types (daily_grant, streak_reward, mission_reward, puzzle_reward, offer_purchase)
│   │   ├── billing.ts                Coin package & subscription billing: real Stripe Checkout sessions, offer-aware purchase types, dry-run mode, webhook processing, idempotent fulfillment, billing stats, offer revenue attribution
│   │   ├── dailyRetention.ts         Daily retention system: missions, streaks, puzzles, deterministic assignment, bounded rewards, premium gating
│   │   ├── offers.ts                 Offer system: catalog, eligibility engine, paid/free offer split, interaction tracking, webhook-driven fulfillment, analytics
│   │   ├── analysis/
│   │   │   ├── transcriptAdapter.ts Replay transcript-to-prompt transformation engine
│   │   │   ├── pythonBridge.ts      Python evaluator subprocess bridge (spawn, timeout, cache, auto-eval, batch-prep)
│   │   │   └── coachingCache.ts     Durable coaching cache: AI/fallback generation, mistake linking, theme aggregation
│   │   └── multiplayer/
│   │       ├── types.ts             WebSocket message protocol types
│   │       ├── engine.ts            Server-authoritative Gin Rummy engine (crypto-secure shuffle)
│   │       ├── roomManager.ts       Room lifecycle, WS handler, state broadcast, fairness integration, spectator management
│   │       ├── spectator.ts         Spectator module: privacy-safe view projection, featured match eligibility, spectator tracking, player preferences (DB-backed), broadcast analytics (peak/unique), admin match inspection
│   │       ├── matchmaking.ts       Rating-aware matchmaking (expanding Elo bracket, stake-compatible pairing, matchmaking posture)
│   │       ├── turnTimer.ts         Server-enforced turn timer (Fast 20s / Medium 30s / Slow 40s, auto-forfeit)
│   │       ├── transcript.ts        Match transcript / action ledger (+ SQLite persistence + fairness data + auto-eval trigger)
│   │       └── fairness.ts          Trust Shield: cryptographic commit-reveal, deterministic shuffle, v2 client-seed contribution, proof packages
│   │   ├── escrow.ts                  Stake presets, entry fee escrow, rake-adjusted settlement, refunds
│   │   ├── houseAccounting.ts           House revenue ledger: rake recording, revenue queries
│   │   ├── tournament.ts                Tournament system: SNG + scheduled events, variable brackets, byes, no-show, persistence
│   │   ├── routes/
│   │   │   ├── replays.ts           Replay history & detail API (authenticated, access-controlled)
│   │   │   ├── wallet.ts            Wallet balance, history, and faucet API
│   │   │   ├── admin.ts             Admin API: revenue, house-ledger, settlements, player inspection, broadcast operations, billing visibility (summary/events/sessions), offer analytics
│   │   │   ├── tournament.ts        Tournament API: list, create, join, leave, scheduled create/start/cancel (auth + admin gated)
│   │   │   ├── training.ts          Training API: summary, session review, trend/retention signals, batch-prep, history, progression, coaching integration
│   │   │   └── fairness.ts          Fairness verification API: proof retrieval, proof download/export, standalone verify (v1+v2)
│   │   ├── analysis/
│   │   │   └── transcriptAdapter.ts Deterministic transcript-to-prompt adapter for AI coaching
│   │   │   └── pythonBridge.ts      Python evaluator bridge (subprocess, timeout, SQLite cache, auto-eval, batch-prep, dedup)
│   ├── tests/
│   │   ├── helpers.ts             Test harness (ephemeral HTTP server)
│   │   ├── api.test.ts            21 integration tests covering all API behaviors
│   │   ├── multiplayer.test.ts    19 unit/integration tests for multiplayer engine
│   │   ├── matchmaking.test.ts    15 unit tests for matchmaking queue
│   │   ├── competitive-integrity.test.ts  35 tests for timers, transcripts, rating pairing
│   │   ├── escrow.test.ts        34 tests for stake presets, escrow holds, settlement, refunds
│   │   ├── showdown-fidelity.test.ts 17 tests for showdown data, meld classification, layoffs
│   │   ├── wallet.test.ts         24 tests for wallet balances, ledger, faucet
│   │   ├── replays.test.ts        18 tests for replay persistence, access, and integrity
│   │   ├── replay-analysis.test.ts  23 tests for transcript-driven AI analysis
│   │   ├── admin.test.ts          25 tests for admin auth, revenue, settlements, player inspection
│   │   ├── rake.test.ts           32 tests for rake model, settlement, and house accounting
│   │   ├── hardening.test.ts      16 tests for health, config, proxy, deployment regressions
│   │   ├── tournament.test.ts     35 tests for SNG tournament creation, join, bracket, payout, regression
│   │   ├── scheduled-tournament.test.ts 32 tests for scheduled tournament creation, brackets, byes, no-show, payout
│   │   ├── evaluation.test.ts     18 tests for engine evaluation API, caching, access control, regression
│   │   ├── training.test.ts       29 tests for training dashboard API, trends, progression, batch-prep, history, format context, access control
│   │   ├── coaching.test.ts       35 tests for coaching cache, coaching generation, coaching timeline, coaching themes, integration, regression
│   │   ├── fairness.test.ts       47 tests for Trust Shield: crypto core, shuffle, seed combination (v2), lifecycle, client-seed contribution, tamper detection, v2 API verification
│   │   ├── profile.test.ts        31 tests for profile API, achievements, prestige, public profile, backfill, regression
│   │   ├── cosmetics.test.ts      34 tests for cosmetic catalog, inventory, equip, purchase, migration, regression
│   │   ├── entitlements.test.ts   33 tests for plan defaults, grant/revoke, plan API, admin controls, auth integration, training gating, regression
│   │   ├── seasons.test.ts        33 tests for season metadata, seasonal leaderboard, player stats, public profile enrichment, regression
│   │   ├── social.test.ts         49 tests for social graph, challenges, notifications, head-to-head, public profile integration, regression
│   │   ├── challenge-match.test.ts  41 tests for challenge-to-match activation, rematches, availability, room allocation, regression
│   │   ├── spectator.test.ts        74 tests for spectator privacy, featured eligibility, preferences, preference-aware eligibility, broadcast analytics, admin broadcast API, metrics, regressions
│   │   ├── billing.test.ts          49 tests for webhook handling, raw-body signature verification, idempotent fulfillment, offer purchase sessions, coin purchase lifecycle, subscription lifecycle, cancellation, admin billing visibility with offer revenue, billing mode, regression
│   │   ├── daily-retention.test.ts  32 tests for daily missions, streaks, puzzle system, economy validation, premium boundaries, regression
│   │   └── offers.test.ts           34 tests for offer catalog, eligibility, paid/free offer differentiation, interaction tracking, paid offer checkout flow, free premium trial, one-time enforcement, anti-abuse, analytics, regression
│   ├── DEPLOYMENT.md             Production deployment guide for single-node architecture
│   ├── database.sqlite            SQLite database (users, sessions, matches)
│   ├── src/
│   │   ├── App.tsx                Router + protected routes
│   │   ├── main.tsx               React entry point
│   │   ├── index.css              Global styles
│   │   ├── lib/
│   │   │   ├── engine.ts          TypeScript game engine (full Gin Rummy rules)
│   │   │   ├── ai.ts              Client-side AI bot ("Nova" — Apex-level strategy)
│   │   │   ├── store.ts           Zustand auth store
│   │   │   ├── preferences.ts     Zustand preferences store (deadwood count, four-color deck)
│   │   │   ├── useMultiplayer.ts   React hook for multiplayer WebSocket lifecycle
│   │   │   ├── useSpectator.ts    React hook for spectator WebSocket lifecycle
│   │   │   └── utils.ts           cn() className utility
│   │   ├── components/
│   │   │   ├── Layout.tsx         Main app layout with sidebar nav
│   │   │   ├── cards/
│   │   │   │   └── index.tsx      Shared card visual system: PlayingCard, OverlappingCard, SuitRowCard, CardBack, ShowdownCardMini, SpectatorCard, MiniCard, table surface constants
│   │   │   └── ui/
│   │   │       ├── Button.tsx     Reusable button component
│   │   │       └── Card.tsx       Reusable card UI component
│   │   └── pages/
│   │       ├── Auth.tsx           Login / Register page
│   │       ├── Dashboard.tsx      Home — stats, play button, recent matches
│   │       ├── GameRoom.tsx       Full game board with overlapping hand display
│   │       ├── MultiplayerRoom.tsx Multiplayer lobby, waiting room, and game board with showdown overlays
│   │       ├── Leaderboard.tsx    Dual-view leaderboard (lifetime/seasonal), top 3 podium, season progress bar, clickable player inspect modal drilldown
│   │       ├── Profile.tsx        Player profile, stats, achievements, seasonal standing
│   │       ├── Analysis.tsx       AI-powered match analysis (Gemini API)
│   │       ├── Replays.tsx        Match replay history & transcript review
│       ├── Training.tsx       Training Center: auto-eval, progression insights, severity distribution, format badges, streaks, batch-prep, AI coaching insights
│   │       ├── Wallet.tsx         Dual-currency wallet, daily bonus, transaction history
│   │       ├── Tournaments.tsx    Tournament discovery, creation, bracket visualization
│   │       ├── Cosmetics.tsx      Cosmetic browsing, inventory, equip/purchase, collection progress
│   │       ├── Premium.tsx        Premium plan display, real subscription billing ($9.99/mo), feature comparison, admin grant/revoke controls
│   │       ├── PublicPlayerProfile.tsx Full-page public player profile with competitive identity
│   │       ├── SocialHub.tsx      Social hub: challenges, follows, head-to-head, notifications
│   │       ├── FeaturedMatches.tsx Featured matches discovery with live/history tabs, broadcast metrics, player spectate preference toggle
│   │       ├── DailyHub.tsx       Daily retention hub: streak check-in, daily missions, daily puzzle, reward summary, premium upsell
│   │       ├── SpectatorView.tsx   Live read-only spectator watch page
│   │       └── AdminDashboard.tsx Admin revenue, settlements, player inspection, and broadcast operations (live matches, feature/unfeature, metrics) dashboard
│   ├── vitest.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── main.py                     ← Tournament runner (DeepKnock vs Heisenbot)
├── benchmark.py                ← Standalone benchmark script
├── test_benchmark.py           ← Benchmark tests
├── test_regressions.py         ← Regression test suite
└── test_titan.py               ← Titan-specific tests
```

---

## 2. Component Status

### 2.1 Python AI Engine — ✅ Complete

| AI Player | Strategy | Status |
|---|---|---|
| **RandomPlayer** | Random valid moves | ✅ Baseline |
| **SimplePlayer** | Meld-completing draws, highest-DW discard, always knock | ✅ Baseline |
| **Heisenbot** | AAAI-21 paper: triangles, doubles, Bayesian likelihood, rule-based knock | ✅ Complete |
| **DeepKnock** | Heisenbot + DW reduction draws, opponent-model safety, MC knocking | ✅ Complete |
| **Titan** | Simple + DW reduction draws, safety tiebreaker, decline tracking | ✅ Complete |
| **Apex** | Titan + near-meld-aware discard, decline-aware safety, defensive draws | ✅ Complete |
| **Nexus** | Actual DW computation per discard, layoff-aware MC knock, defensive draws | ✅ Complete |

**Supporting Modules:**
| Module | Purpose | Status |
|---|---|---|
| `card.py` | Integer-based card representation (0–51), rank/suit/deadwood utilities | ✅ |
| `meld.py` | Best meld arrangement (exhaustive search), layoff computation | ✅ |
| `game.py` | Full game loop with draw/discard/knock/undercut/gin/layoff | ✅ |
| `opponent_model.py` | Bayesian card tracking, Monte Carlo hand sampling | ✅ |
| `tournament.py` | N-game matchups, round-robin, statistical results | ✅ |
| `benchmark.py` | Decision timing benchmarks | ✅ |

### 2.2 TypeScript Game Engine — ✅ Complete

**File:** `gin-galaxy/src/lib/engine.ts` (423 lines)

| Feature | Status |
|---|---|
| Card/Deck creation & shuffling (crypto-random) | ✅ |
| Meld finding (sets + runs, all combinations) | ✅ |
| Hand evaluation (optimal meld arrangement, min deadwood) | ✅ |
| Lay-off computation (opponent laying off on knocker's melds) | ✅ |
| Full game state machine (draw → discard/knock → round/game over) | ✅ |
| Scoring: normal knock, gin (+25), undercut (+25) | ✅ |
| Deterministic suit ordering (`SUIT_ORDER`, `sortHand`) | ✅ |

### 2.3 Client-Side AI — ✅ Complete

**File:** `gin-galaxy/src/lib/ai.ts` (220 lines)

Bot name: **Nova** — Plays as the opponent in single-player games.

| Decision | Strategy |
|---|---|
| **Draw** | Takes from discard if it completes a meld OR reduces deadwood by ≥4 points |
| **Discard** | Scores non-melded cards by deadwood value (+), near-meld penalty (−), safety danger (−); discards highest-scoring card |
| **Knock** | Always knocks when deadwood ≤ 10 |

### 2.4 Web Platform — ✅ Multiplayer MVP

#### Backend (Modular — `server/`)

The backend has been refactored from a single monolithic `server.ts` into a modular architecture, with a multiplayer subsystem added:

| Module | Purpose |
|---|---|
| `server/config.ts` | Production configuration: env vars (PORT, HOST, DATABASE_PATH, TRUST_PROXY), validation, startup summary |
| `server/db.ts` | Database initialization, migrations, session TTL management, configurable path |
| `server/middleware/auth.ts` | Shared auth middleware — validates Bearer tokens, rejects expired sessions |
| `server/middleware/validate.ts` | Generic request body validation factory |
| `server/middleware/rateLimit.ts` | In-memory sliding-window rate limiter |
| `server/routes/auth.ts` | Registration (bcrypt), login (with legacy hash migration), authenticated logout |
| `server/routes/matches.ts` | Match recording, history, player stats |
| `server/routes/leaderboard.ts` | Global top-20 leaderboard |
| `server/routes/analysis.ts` | Gemini AI analysis with graceful no-key fallback (summary-based) |
| `server/routes/replayAnalysis.ts` | Transcript-driven replay analysis: structured prompt, Gemini AI, graceful fallback |
| `server/routes/replayEvaluation.ts` | Engine-backed mathematical evaluation: per-turn scoring, access control, graceful degradation |
| `server/routes/training.ts` | Training dashboard API: aggregated sessions, trends, session review, severity analysis, progression signals, batch-prep, history, coaching integration |
| `server/analysis/coachingCache.ts` | Durable coaching cache: SQLite persistence, AI/fallback generation, mistake linking from engine eval, theme aggregation, coaching history |
| `server/analysis/pythonBridge.ts` | Python evaluator subprocess bridge: spawn, stdin/stdout JSON, timeout, SQLite caching, auto-eval trigger, batch-prep, dedup |
| `server/routes/wallet.ts` | Wallet API: balances, transaction history, daily faucet claim |
| `server/ledger.ts` | Atomic wallet mutations, signup bonus, faucet claim, transaction records |
| `server/analysis/transcriptAdapter.ts` | Deterministic transcript-to-prompt adapter (round extraction, player stats, turn log) |
| `server/multiplayer/types.ts` | Shared WebSocket message protocol types (incl. timer messages) |
| `server/multiplayer/engine.ts` | Server-authoritative Gin Rummy engine (melds, knocks, scoring, view projection, round tracking) |
| `server/multiplayer/roomManager.ts` | Room lifecycle, WS handler, timer integration, transcript recording, filtered state broadcast |
| `server/multiplayer/matchmaking.ts` | Rating-aware matchmaking: expanding Elo bracket pairing, duplicate prevention, disconnect cleanup |
| `server/multiplayer/turnTimer.ts` | Server-enforced turn timer: Fast (20s) / Medium (30s) / Slow (40s) presets, auto-play, auto-forfeit on 3 consecutive timeouts |
| `server/multiplayer/transcript.ts` | Match action ledger: chronological log of every game action for auditability; auto-persists to SQLite on finalization; triggers auto-evaluation |
| `server/routes/replays.ts` | Replay API: authenticated recent replay list (`GET /api/replays`) and detail with full transcript (`GET /api/replays/:id`), participant-only access control |
| `server/middleware/adminAuth.ts` | Admin authorization middleware: validates `is_admin` column, returns 403 for non-admins |
| `server/routes/admin.ts` | Admin API: revenue summary, house ledger, settlements with context, player search and wallet inspection |

| API Endpoint | Method | Auth | Rate Limited | Purpose |
|---|---|---|---|---|
| `/api/auth/register` | POST | No | ✅ 20/15min | Create account (bcrypt hashed) |
| `/api/auth/login` | POST | No | ✅ 20/15min | Login, returns session token (24h expiry) |
| `/api/auth/logout` | POST | Yes | No | Destroy authenticated session |
| `/api/auth/me` | GET | Yes | No | Verify session, return user |
| `/api/matches` | POST | Yes | No | Record match result, update rating ±15/10 |
| `/api/matches` | GET | Yes | No | Fetch last 10 matches |
| `/api/stats` | GET | Yes | No | Player stats (rating, wins, losses, rank, trend) |
| `/api/leaderboard` | GET | No | No | Top 20 by rating; supports `?view=lifetime\|seasonal` |
| `/api/seasons/current` | GET | No | No | Active season metadata with progress |
| `/api/seasons/leaderboard` | GET | No | No | Seasonal leaderboard standings |
| `/api/seasons/me` | GET | Yes | No | Authenticated user's season stats |
| `/api/seasons/all` | GET | No | No | All seasons (history/archive) |
| `/api/social/follow/:userId` | POST | Yes | No | Follow a player |
| `/api/social/follow/:userId` | DELETE | Yes | No | Unfollow a player |
| `/api/social/follow-by-username/:username` | POST | Yes | No | Follow by username (profile page) |
| `/api/social/follow-by-username/:username` | DELETE | Yes | No | Unfollow by username (profile page) |
| `/api/social/followers` | GET | Yes | No | List followers |
| `/api/social/following` | GET | Yes | No | List following |
| `/api/social/relationship/:userId` | GET | Yes | No | Relationship to another player |
| `/api/social/challenge` | POST | Yes | No | Send a challenge (by targetId) |
| `/api/social/challenge-by-username` | POST | Yes | No | Send a challenge (by username) |
| `/api/social/challenge/:id/accept` | POST | Yes | No | Accept a challenge |
| `/api/social/challenge/:id/decline` | POST | Yes | No | Decline a challenge |
| `/api/social/challenge/:id/cancel` | POST | Yes | No | Cancel own challenge |
| `/api/social/challenges/inbox` | GET | Yes | No | Pending inbound challenges |
| `/api/social/challenges/outbox` | GET | Yes | No | Pending outbound challenges |
| `/api/social/challenges/history` | GET | Yes | No | Recent challenge history |
| `/api/social/challenge/:id` | GET | Yes | No | Challenge details (participants only) |
| `/api/social/head-to-head/:userId` | GET | Yes | No | Head-to-head rivalry record |
| `/api/social/notifications` | GET | Yes | No | Social notifications |
| `/api/social/notifications/read` | POST | Yes | No | Mark notifications as read |
| `/api/analysis` | GET | Yes | ✅ 5/5min | Gemini AI match analysis (summary-based) |
| `/api/replays` | GET | Yes | No | Recent replay list for authenticated user |
| `/api/replays/:id` | GET | Yes | No | Full replay detail (participant-only access) |
| `/api/replays/:id/analysis` | POST | Yes | ✅ 10/5min | Transcript-driven AI analysis for a specific replay |
| `/api/replays/:id/evaluation` | POST | Yes | ✅ 15/5min | Engine-backed mathematical evaluation (Apex v2) |
| `/api/replays/:id/evaluation` | GET | Yes | No | Retrieve cached evaluation (no Python invocation) |
| `/api/wallet` | GET | Yes | No | Current coin balance |
| `/api/wallet/history` | GET | Yes | No | Recent transaction ledger (paginated) |
| `/api/wallet/faucet` | POST | Yes | ✅ 10/5min | Daily check-in (500 Coins) |
| `/api/billing/packages` | GET | No | No | Coin package catalog |
| `/api/billing/plans` | GET | No | No | Subscription plan catalog |
| `/api/billing/purchase` | POST | Yes | ✅ 5/60s | Initiate coin package purchase (Stripe) |
| `/api/billing/subscribe` | POST | Yes | ✅ 5/60s | Initiate premium subscription (Stripe) |
| `/api/billing/history` | GET | Yes | No | Purchase history |
| `/api/billing/status` | GET | No | No | Billing system status (dry-run indicator) |
| `/api/billing/session/:id` | GET | Yes | No | Billing session status lookup (ownership-scoped) |
| `/api/webhooks/stripe` | POST | No (Stripe signature) | No | Stripe webhook event processing |
| `/api/webhooks/stripe/status` | GET | No | No | Webhook configuration status |
| `/api/admin/billing/summary` | GET | Admin | No | Billing stats, mode, revenue totals |
| `/api/admin/billing/events` | GET | Admin | No | Recent webhook events (audit log) |
| `/api/admin/billing/sessions` | GET | Admin | No | Recent billing sessions with user context |
| `/api/admin/revenue` | GET | Admin | No | Total rake by currency + summary |
| `/api/admin/house-ledger` | GET | Admin | No | Recent house ledger entries |
| `/api/admin/settlements` | GET | Admin | No | Recent staked match outcome details |
| `/api/admin/players/search` | GET | Admin | No | Search players by username |
| `/api/admin/players/:id` | GET | Admin | No | Player wallet, transactions, match history |
| `/api/training/summary` | GET | Yes | No | Aggregated training stats, recent sessions, trends, severity, progression signals, format breakdown, coaching themes |
| `/api/training/session/:id` | GET | Yes | No | Detailed session review with cached eval, key moments, format/tournament context, coaching narrative |
| `/api/training/prepare` | POST | Yes | No | Batch-prepare evaluations for unevaluated replays |
| `/api/training/history` | GET | Yes | No | Paginated, filterable training session history (incl. coached filter) |
| `/api/training/coaching/:id` | POST | Yes | No | Generate or retrieve cached coaching for a specific replay |
| `/api/training/coaching/timeline` | GET | Yes | No | Recent coaching timeline entries with narrative previews |
| `/api/training/coaching/themes` | GET | Yes | No | Aggregated recurring coaching themes across sessions |
| `/api/profile` | GET | Yes | No | Full player profile with auto achievement evaluation |
| `/api/profile/:username` | GET | No | No | Public player profile by username |
| `/api/profile` | PUT | Yes | No | Update profile selections (title, badge, frame, bio) |
| `/api/profile/achievements/catalog` | GET | No | No | Full achievement catalog |
| `/api/profile/backfill` | POST | Yes | No | Trigger retroactive achievement evaluation |
| `/api/cosmetics/catalog` | GET | Yes | No | Full cosmetic catalog with ownership status |
| `/api/cosmetics/inventory` | GET | Yes | No | Player's owned cosmetic items |
| `/api/cosmetics/equipped` | GET | Yes | No | Currently equipped cosmetic selections |
| `/api/cosmetics/equip` | PUT | Yes | No | Equip/unequip a cosmetic item |
| `/api/cosmetics/purchase` | POST | Yes | No | Purchase catalog item with soft currency |
| `/api/cosmetics/migrate` | POST | Yes | No | Migrate prestige unlocks to cosmetic inventory |
| `/api/cosmetics/admin/grant` | POST | Admin | No | Admin: grant cosmetic item to a player |
| `/api/daily` | GET | Yes | No | Full daily retention summary (missions, streak, puzzle, balances) |
| `/api/daily/checkin` | POST | Yes | ✅ 30/5min | Streak check-in (daily, idempotent) |
| `/api/daily/missions/:id/claim` | POST | Yes | ✅ 30/5min | Claim completed mission reward |
| `/api/daily/puzzle` | GET | Yes | No | Get today's puzzle (hides optimal action before submission) |
| `/api/daily/puzzle/submit` | POST | Yes | ✅ 30/5min | Submit puzzle answer |
| `/api/daily/puzzle/claim` | POST | Yes | ✅ 30/5min | Claim puzzle reward |
| `/api/daily/puzzle/history` | GET | Yes | No | Puzzle history (7 days free, 30 days premium) |
| `/api/offers` | GET | Yes | No | List eligible offers for authenticated user |
| `/api/offers/:id` | GET | Yes | No | Offer details + eligibility + user state |
| `/api/offers/:id/impression` | POST | Yes | No | Record offer impression (surface-tagged) |
| `/api/offers/:id/dismiss` | POST | Yes | No | Record offer dismissal (surface-tagged) |
| `/api/offers/:id/click` | POST | Yes | No | Record offer click (surface-tagged) |
| `/api/offers/:id/redeem` | POST | Yes | ✅ 10/min | Server-authoritative offer redemption |
| `/api/offers/:id/state` | GET | Yes | No | User state for specific offer |
| `/api/admin/offers/analytics` | GET | Admin | No | Offer analytics: impressions, clicks, purchases, conversion rates |
| `/api/admin/offers/redemptions` | GET | Admin | No | Recent offer redemptions with user details |
| `/api/admin/offers/catalog` | GET | Admin | No | Full offer catalog with eligibility rules |
| `/api/health` | GET | No | No | Health check: process up, DB connected, version, uptime |
| `/ws` | WebSocket | Token (query param) | No | Multiplayer real-time game communication |

**Database:** SQLite with tables: `users`, `sessions` (with `expires_at`), `matches`, `replays` (with `match_format`, `tournament_id`), `wallets`, `transactions`, `replay_evaluations`, `replay_coaching`, `achievements`, `prestige`, `player_profiles`, `cosmetic_inventory`, `seasons`, `season_stats`, `follows`, `challenges`, `social_notifications`, `billing_sessions`, `billing_events`, `daily_missions`, `daily_streaks`, `daily_puzzles`, `offer_interactions`, `offer_redemptions`

#### Security Improvements
| Feature | Before | After |
|---|---|---|
| Password Hashing | SHA-256 (raw) | bcrypt (12 rounds) |
| Legacy Hash Migration | N/A | Transparent SHA-256→bcrypt upgrade on login |
| Session Expiry | None (infinite lifetime) | 24-hour TTL; expired sessions rejected |
| Logout | Arbitrary sessionId in request body | Authenticated via `Authorization` header |
| AI Key Handling | Crash on missing key | Graceful fallback message |
| Input Validation | Minimal (username/email/password presence only) | Full type/length/range validation |
| Rate Limiting | None | Auth (20/15min), Analysis (5/5min) |

#### Frontend Pages
| Page | Route | Status | Features |
|---|---|---|---|
| **Auth** | `/auth` | ✅ | Login/Register forms |
| **Dashboard** | `/` | ✅ | Activation-first home: bankroll display, daily claim banner, affordable stake indicator, play buttons, low-balance nudge, daily summary |
| **Game Room** | `/play` | ✅ | Full game board, overlapping hand layout, AI opponent, draw/discard/knock, showdown overlays |
| **Multiplayer** | `/play/multiplayer` | ✅ | Quick Match, create/join rooms, real-time 1v1, overlapping hands, showdown with melds/layoffs |
| **Leaderboard** | `/leaderboard` | ✅ | Dual-view (lifetime/seasonal), top 3 podium, season progress bar, clickable player inspect modal drilldown |
| **Profile** | `/profile` | ✅ | Avatar, stats, seasonal standing, achievements, recent activity (real data) |
| **Public Profile** | `/player/:username` | ✅ | Full-page public competitive identity with seasonal standing, recent matches, achievements, follow/challenge buttons, head-to-head rivalry |
| **Social Hub** | `/social` | ✅ | 5-tab social surface: challenge inbox/outbox, history, following list, notification feed |
| **Analysis** | `/analysis` | ✅ | Match history + Gemini-powered AI coaching |
| **Replays** | `/replays` | ✅ | Replay list + detailed transcript viewer with step-through |
| **Training** | `/training` | ✅ | Auto-eval, progression insights, severity distribution, session reviews, format badges, batch-prep, history |
| **Wallet** | `/wallet` | ✅ | Single coin balance, coin package purchase (gameplay-framed), transaction history with differentiated types, Daily Hub link |
| **Cosmetics** | `/cosmetics` | ✅ | Tabbed store/inventory, rarity cards, equip flow, purchase with gold, collection progress |
| **Admin** | `/admin` | ✅ | Revenue summary, rake ledger, settlements, player search/inspection (admin-only) |
| **Daily Hub** | `/daily` | ✅ | Canonical daily-return surface: streak check-in, daily missions, daily puzzle, reward summary, premium upsell |

#### Tech Stack
| Layer | Technology |
|---|---|
| Framework | Vite + React 19 |
| Routing | React Router v7 |
| State | Zustand |
| Styling | Tailwind CSS v4 |
| Animations | Motion (Framer Motion successor) |
| Icons | Lucide React |
| Backend | Express 4 + tsx runner |
| Database | better-sqlite3 |
| AI Analysis | Google GenAI (Gemini) |
| Testing | Vitest (1001 tests across 33 test files — see Test Coverage section) |
| WebSocket | ws (server-side) + native WebSocket (client) |

---

## 3. Test Coverage

**Suite:** 33 test files — 1001 total tests

| Category | Tests | Coverage |
|---|---|---|
| **Auth — Registration** | 4 | Happy path, missing fields, short password, duplicate username |
| **Auth — Login** | 4 | Happy path, wrong password, nonexistent user, missing fields |
| **Auth — Session** | 3 | /me with valid session, no auth header, invalid session |
| **Auth — Logout** | 1 | Authenticated logout + session invalidation |
| **Matches** | 5 | Record match + verify stats, missing fields, invalid types, no auth, list matches |
| **Leaderboard** | 1 | Response shape validation |
| **Analysis** | 3 | No matches message, missing API key graceful fallback, no auth rejection |
| **Multiplayer Engine** | 16 | Match creation, draw/discard/knock mechanics, turn enforcement, player view projection |
| **Multiplayer Integrity** | 3 | Hand concealment, out-of-turn rejection, completed-game protection |
| **Matchmaking Queue** | 9 | Queue join, duplicate rejection, cancel, disconnect cleanup, auto-pairing, skip-dead |
| **Matchmaking → Match** | 1 | Full game playable after matchmaking pairing |
| **Room-Code Regression** | 4 | Match creation, game flow, turn order, view projection via room codes |
| **Turn Timer** | 8 | Timer start/cancel, timeout callback, consecutive tracking, timer replacement, cleanup |
| **Timeout Auto-Play** | 2 | Auto-draw+discard and auto-discard behavior |
| **Match Transcript** | 11 | Creation, draw/discard/knock/round events, finalization, sequence numbers, timestamps |
| **Transcript Integrity** | 1 | Full game simulation producing valid transcript |
| **Rating-Aware Matchmaking** | 5 | Bracket calculation, close-rated pairing, bracket expansion, safety, disconnect skip |
| **CI Room-Code Regression** | 6 | roundNumber tracking, drawn/discarded card info, turn order, filtered views |
| **CI Quick-Match Regression** | 2 | Pairing + match, full game after matchmaking |
| **Replay Persistence** | 4 | Completed, forfeit, timeout, disconnect transcript persistence |
| **Replay Integrity** | 2 | Full action data round-trip, detail field preservation |
| **Replay API — List** | 3 | Authorized retrieval, player2 visibility, unauthenticated rejection |
| **Replay API — Detail** | 4 | Authorized retrieval, non-participant rejection (403), not found (404), unauthenticated |
| **Replay Regression** | 3 | Room-code to replay, quick-match to replay, transcript function compatibility |
| **Replay Edge Cases** | 2 | Multi-replay ordering, pagination (limit/offset) |
| **Replay Analysis — Auth & Access** | 4 | Valid participant analysis (fallback), non-participant 403, unauthenticated 401, not-found 404 |
| **Replay Analysis — Fallback** | 2 | Structured fallback content, player2 loss perspective |
| **Replay Analysis — Input Shaping** | 8 | Prompt sections, player names, match result, loss perspective, meta values, draw stats, knock details |
| **Replay Analysis — extractRounds** | 2 | Multi-round splitting, single-round handling |
| **Replay Analysis — computePlayerStats** | 3 | Draw/discard/knock counts, timeout counting, gin counting |
| **Replay Analysis — Regression** | 4 | Replay list API, replay detail API, summary analysis, forfeit replay analysis |
| **Ledger — mutateBalance** | 6 | Credit, debit, negative rejection, independent currencies, balance_after, reference/note |
| **Ledger — creditSignupBonus** | 2 | Default amounts, signup_bonus transactions |
| **Ledger — claimFaucet** | 3 | First claim success, duplicate rejection, cooldown expiry |
| **Wallet API — Balance** | 2 | Signup bonus balances, auth rejection |
| **Wallet API — History** | 3 | Transaction listing, limit parameter, auth rejection |
| **Wallet API — Faucet** | 3 | Successful claim, duplicate rejection (429), auth rejection |
| **Wallet — Atomic Integrity** | 2 | No partial state on failed debit, one transaction per mutation |
| **Wallet — Regression** | 3 | Registration with bonus, existing auth, leaderboard |
| **Stake Presets** | 5 | Free play, gold presets, sweeps preset, invalid preset, non-free identification |
| **Balance Check** | 5 | Free play approval, affordable gold/sweeps, unaffordable gold/sweeps |
| **Escrow Hold** | 5 | Debit + balance update, ledger entry, room state, free play null, insufficient throw |
| **Settlement — Normal Win** | 4 | Winner payout, prize_payout txn, settled flag, double-settle prevention |
| **Settlement — Forfeit/DC** | 3 | Forfeit payout, timeout payout, disconnect payout (sweeps) |
| **Escrow Refund** | 3 | Full refund both players, refund txn in ledger, free play no-op |
| **Queue Stake Compatibility** | 3 | Different stakes don't pair, same stakes pair, stakeId on entries |
| **Wallet History — Stakes** | 1 | escrow_hold + prize_payout in transaction history |
| **Escrow Cleanup** | 1 | State removed on cleanup |
| **Escrow — Regression** | 4 | Registration, wallet API, leaderboard, faucet |
| **Showdown Data Presence** | 2 | showdownData on successful knock, meld/deadwood breakdown |
| **Meld Classification** | 2 | Same-rank sets, same-suit runs |
| **Gin Detection** | 1 | Showdown structure with 0 deadwood |
| **Undercut Detection** | 1 | Opponent deadwood ≤ knocker deadwood |
| **Layoff Cards** | 2 | Laid-off cards on knock, no layoffs on gin |
| **Reveal Consistency** | 2 | Both hands in reveal, points match state |
| **Status Transitions** | 1 | round_over/game_over on knock |
| **Showdown Regression** | 5 | >10 DW rejection, turn order, out-of-turn, next round, drawnCard/discardedCard |
| **PlayerView Showdown** | 1 | Valid views during round_over |
| **Rake Model — Presets** | 6 | Free zero-rake, gold_500/2000/5000 math, sweeps math, all-preset reconciliation |
| **Rake Settlement — Completed** | 2 | Correct payout, reconciliation |
| **Rake Settlement — Forfeit/DC** | 3 | Forfeit, timeout, disconnect with rake |
| **Rake — Free Play** | 2 | No rake on free play |
| **Rake — Refund** | 1 | Full refund, no rake deducted |
| **House Accounting** | 5 | Rake in house_ledger, revenue by currency, no rake on free/refund |
| **Player History — Rake** | 2 | Winner net payout, loser balance |
| **Settlement Reconciliation** | 4 | payout + rake = total held for all non-free stakes |
| **Rake Queue Compatibility** | 2 | Stake pairing unchanged |
| **Rake Regression** | 5 | Registration, wallet, leaderboard, faucet, preset structure |
| **Admin — Non-Admin Rejection** | 6 | Revenue, house-ledger, settlements, player search, player detail, unauthenticated |
| **Admin — Revenue Summary** | 3 | Currency breakdown, gold+sweeps separation, recent entries |
| **Admin — House Ledger** | 3 | Entry listing, limit parameter, field validation |
| **Admin — Settlements** | 2 | Settlement list, limit parameter |
| **Admin — Player Search** | 3 | Username search, balance inclusion, empty query rejection |
| **Admin — Player Detail** | 2 | Full detail response, 404 for nonexistent |
| **Admin — Identity in Auth** | 2 | is_admin true for admin, false for regular |
| **Admin — Regression** | 4 | Registration, wallet API, leaderboard, faucet |
| **Health Endpoint** | 4 | Healthy response shape, unauthenticated access, no secrets exposed, environment field |
| **Configuration Module** | 5 | Default values, port parsing, trust proxy parsing, allowed origins, optional Gemini key |
| **Trust Proxy** | 1 | X-Forwarded-For header respected |
| **Hardening Regression** | 6 | Register, wallet API, leaderboard, auth enforcement, faucet, admin rejection |

| **Replay Eval — Caching** | 3 | GET not_computed, GET cached, POST returns cached |
| **Replay Eval — SQLite Cache** | 4 | createTable, null on missing, round-trip, overwrite |
| **Replay Eval — Access GET** | 2 | Non-participant 403, unauthenticated 401 |
| **Replay Eval — Regression** | 4 | Replay list, replay analysis, replay detail, wallet API |
| **Daily Retention Summary** | 2 | Full summary shape validation, auth requirement |
| **Daily Missions** | 5 | Assignment count, daily_checkin presence, idempotency, reward bounds, uncompleted claim rejection |
| **Daily Streaks** | 5 | Initial state, increment, double-check-in prevention, preservation, auto-progress |
| **Streak Reward Schedule** | 1 | Reward bound validation (max 500) |
| **Daily Puzzle** | 7 | Puzzle retrieval, optimal action hiding, submission, double-submission, reward claiming, double-claim, history |
| **Puzzle Reward Economy** | 2 | Base 100 coins validation, optimal bonus validation |
| **Premium Feature Boundaries** | 2 | Non-premium 0 premium bonus, history bounds (max 7 days) |
| **Mission Progress Integration** | 1 | End-to-end check-in → mission complete → claim flow |
| **Economy Validation** | 2 | Total daily coin bound (< 1500), streak reward bound |
| **Daily Retention Regression** | 5 | Wallet, health, profile, entitlements, training endpoints |
| **Unified Funnel — Ledger Fix** | 5 | streak→streak_reward, no faucet leakage, mission→mission_reward, puzzle→puzzle_reward, zero faucet contamination |
| **Unified Funnel — Cooldown Isolation** | 3 | daily rewards don't block faucet, faucet cooldown is type-scoped, differentiated history |
| **Unified Funnel — Taxonomy** | 1 | all 4 new types valid in mutateBalance |
| **Unified Funnel — Regression** | 5 | daily summary shape, wallet shape, history types, billing packages, health |
| **Offer Catalog** | 4 | Eligible offers for new user, offer details with eligibility, 404 for unknown, billing mode in response |
| **Offer Interactions** | 5 | Impression recording, dismissal recording, click recording, 404 for unknown offer, user offer state tracking |
| **Starter Offer Redemption** | 3 | Coins + premium trial grant, offer_purchase in transaction history, premium verification via state |
| **One-Time Enforcement** | 4 | Duplicate redemption rejection, ineligible after redemption, redeemed offers excluded from list, premium trial blocked if already premium |
| **Offer Analytics Recording** | 1 | Interaction counts in user offer state |
| **Fresh User Eligibility** | 2 | Starter offer visible pre-purchase, blocked after standard purchase |
| **Premium Trial Standalone** | 3 | Free trial redemption, duplicate rejection, coin purchases allowed after trial |
| **Offer Regression** | 8 | Billing packages, subscriptions, standard purchases, wallet, transaction types, offer state, daily retention, health |

All 989 tests pass ✅

---

## 4. What's Working

- ✅ Full game loop: deal → draw (stock/discard) → discard/knock → scoring → next round
- ✅ AI opponent (Nova) with two-phase turn timing (600ms draw, 800ms discard)
- ✅ Round/game over overlays with correct scoring
- ✅ Match result persistence to SQLite database
- ✅ Rating system (Elo-style: +15 win, -10 loss, floor 100)
- ✅ Real-time leaderboard from database
- ✅ Player stats computed from actual match data
- ✅ Session-based authentication with 24h expiry (Bearer token)
- ✅ bcrypt password hashing (transparent SHA-256 migration for existing accounts)
- ✅ Request validation on all endpoints
- ✅ Rate limiting on auth and analysis endpoints
- ✅ Modular backend (6 files instead of 1 monolith)
- ✅ 21 automated API integration tests
- ✅ **Real-time 1v1 multiplayer via WebSocket (room-based, server-authoritative)**
- ✅ Create/join rooms with 6-character alphanumeric codes
- ✅ **Automatic matchmaking queue (Quick Match)**
- ✅ **Rating-aware matchmaking** with expanding Elo bracket (±50 base, expands over time)
- ✅ Filtered game state projection (opponent hand never revealed)
- ✅ Disconnect detection with 60-second reconnect window
- ✅ Forfeit on leave/timeout with automatic rating updates
- ✅ **Server-enforced turn timer** (Fast 20s / Medium 30s / Slow 40s per turn, auto-play on timeout, auto-forfeit after 3)
- ✅ **Match transcript / action ledger** recording every game action for auditability
- ✅ **Turn timer UI** with countdown display (color transitions: emerald→amber→rose)
- ✅ **Timeout warning toasts** for players who time out
- ✅ **Durable replay persistence** — transcripts auto-saved to SQLite on match finalization
- ✅ **Replay API** — authenticated list and detail endpoints with participant-only access control
- ✅ **Replay UI** — match replay list + round-grouped transcript viewer with step-through navigation
- ✅ Supports all end reasons: completed, forfeit, timeout, disconnect
- ✅ 19 automated multiplayer engine tests
- ✅ 15 automated matchmaking tests
- ✅ 35 automated competitive integrity tests
- ✅ 18 automated replay persistence/access tests
- ✅ 4-row hand display with visual gap placeholders → **upgraded to overlapping hand layout**
- ✅ **Overlapping card layout** — table-style hand with 28px overlap, sorted by suit/rank, responsive sizing
- ✅ **Showdown fidelity** — both hands revealed at every round end with structured meld/deadwood/layoff breakdown
- ✅ **Visible layoff presentation** — laid-off cards shown with amber highlight, attached to knocker's melds
- ✅ **Meld classification** — sets and runs labeled and color-coded (emerald) in showdown overlay
- ✅ **Phase clarity indicators** — explicit text cues for draw/discard/knock/waiting phases
- ✅ Card selection, discard, and knock interactions
- ✅ Gemini AI match analysis with graceful no-key fallback
- ✅ **Transcript-driven replay analysis** — turn-by-turn AI coaching grounded in stored transcripts
- ✅ **Structured prompt adapter** — deterministic transcript-to-prompt transformation with round extraction and player stats
- ✅ **Analysis access control** — participant-only analysis with 403/401/404 error handling
- ✅ **Single coin economy** — non-redeemable coins, all sweepstakes terminology removed
- ✅ **Append-only transaction ledger** — every balance mutation recorded with type, amount, balance_after, reference, note
- ✅ **Atomic balance mutations** — SQLite transactions ensure balance + ledger writes succeed or fail together
- ✅ **Signup bonus** — 5,000 Coins credited on registration
- ✅ **Daily check-in** — 500 Coins per 24h with cooldown enforcement
- ✅ **Coin package billing** — 5 tiers ($4.99–$89.99) via real Stripe Checkout Sessions with volume bonuses
- ✅ **Premium subscription billing** — $9.99/month via Stripe Checkout (non-pay-to-win coaching tools)
- ✅ **Paid offer monetization** — Starter bundle ($4.99 for 15K coins + 7-day Pro trial) routes through Stripe Checkout; free offers (premium trial) fulfill instantly
- ✅ **Webhook-driven fulfillment** — Checkout sessions fulfilled only after Stripe webhook confirmation; idempotent event processing prevents double-crediting
- ✅ **Raw body signature verification** — Webhook endpoint preserves original request bytes for timing-safe HMAC-SHA256 signature validation; replay protection (5-minute window)
- ✅ **Offer revenue attribution** — Admin billing summary separates standard purchases, subscriptions, and offer-driven revenue with distinct counters
- ✅ **Wallet UI** — balance cards, faucet claim button, transaction history feed, checkout redirect support
- ✅ 24 automated wallet/ledger tests
- ✅ 49 automated billing tests (webhook, signature, fulfillment, offer purchase sessions, admin visibility)
- ✅ 34 automated offer tests (paid/free split, checkout flow, eligibility, one-time enforcement, analytics)
- ✅ **Coin-gated matchmaking** — stake selection before queue with server-side balance validation
- ✅ **Stake-compatible pairing** — only players with the same stake level are matched
- ✅ **Entry fee escrow** — holds deducted from wallet on match start, tracked per-room
- ✅ **Deterministic settlement** — winner receives full prize pool on all outcomes (completion, forfeit, timeout, disconnect)
- ✅ **Pre-start refund** — full refund if match fails before starting
- ✅ **Explicit ledger entries** — every escrow operation creates an auditable transaction (escrow_hold, prize_payout, refund)
- ✅ **Stake info in game UI** — prize pool badge in header, stake picker in lobby, wallet balance inline
- ✅ **Insufficient funds rejection** — clean error message with balance/required breakdown
- ✅ **Stake metadata in transcripts** — stake context recorded in match_start action for replay auditability
- ✅ 34 automated escrow/stake tests (updated for rake-adjusted amounts)
- ✅ 17 automated showdown fidelity tests
- ✅ **Configurable rake model** — 5% rake on all non-free stakes, free play untouched
- ✅ **Deterministic settlement formula** — prizePool + rakeAmount = totalHeld, reconciliation enforced
- ✅ **House accounting ledger** — every rake collection recorded in `house_ledger` table
- ✅ **Revenue queries** — getHouseRevenue() and getHouseRevenueForCurrency() for audit
- ✅ **Player-facing rake transparency** — rake percentage and adjusted win amounts shown in stake picker
- ✅ **Transcript rake metadata** — rake details recorded in match_start transcript actions
- ✅ **Refund paths untouched** — pre-start failures refund fully, no rake taken
- ✅ 32 automated rake/house-accounting tests
- ✅ **Admin access model** — `is_admin` column, server-enforced authorization, no self-service provisioning
- ✅ **Admin revenue API** — total rake by currency, recent house ledger entries, per-settlement context
- ✅ **Admin settlement view** — recent staked match outcomes with players, scores, end reason, stake, rake, replay ID
- ✅ **Admin player inspection** — search by username, wallet balances, transaction history, match history
- ✅ **Admin dashboard UI** — Revenue/Settlements/Players tabs, clean operational design
- ✅ **Player preferences** — optional deadwood count display, optional four-color deck, localStorage-persisted, **consistent in both single-player and multiplayer**
- ✅ 25 automated admin tests
- ✅ **Production configuration** — centralized env var handling (PORT, HOST, DATABASE_PATH, TRUST_PROXY, ALLOWED_ORIGINS)
- ✅ **Health endpoint** — unauthenticated `/api/health` with DB connectivity check, uptime, version
- ✅ **Graceful shutdown** — SIGTERM/SIGINT handling closes HTTP, WebSocket, timers, database
- ✅ **Trust proxy support** — configurable proxy trust for correct IP resolution behind reverse proxies
- ✅ **Correct production startup** — `npm start` uses `tsx` with `NODE_ENV=production`
- ✅ **Deployment documentation** — comprehensive DEPLOYMENT.md with platform-specific guidance
- ✅ 16 automated deployment hardening tests

---

## 5. Outstanding / Future Work

### High Priority
| Item | Description |
|---|---|
| ~~**Multiplayer**~~ | ~~Currently single-player vs AI only. Need WebSocket integration for real-time PvP~~ ✅ **DONE** |
| ~~**Matchmaking**~~ | ~~Random pairing / lobby system (currently room-code only)~~ ✅ **DONE** |
| ~~**Rating-Aware Pairing**~~ | ~~Queue stores ratings but uses FIFO; upgrade to ELO-bracket matching~~ ✅ **DONE** |
| ~~**Turn Timers**~~ | ~~Turn time limits~~ ✅ **DONE** (60s server-enforced, auto-forfeit on 3 timeouts) |
| ~~**Match Transcript**~~ | ~~Auditable match action ledger~~ ✅ **DONE** |
| ~~**Replay Persistence**~~ | ~~Migrate transcripts from in-memory to SQLite for durability~~ ✅ **DONE** |
| ~~**Match Replay UI**~~ | ~~UI to view and replay stored match transcripts~~ ✅ **DONE** |
| ~~**Coin Sweepstakes — Foundation**~~ | ~~Wallet and ledger primitives for balances + transactions~~ ✅ **DONE** |
| ~~**Coin Sweepstakes — Escrow/Buy-in**~~ | ~~Coin-gated matchmaking, escrow holds, prize payouts~~ ✅ **DONE** |
| **Advanced AI Port** | Only Apex-level strategy ported to TypeScript. DeepKnock/Nexus MC features not yet in client |
| ~~**Rake/Revenue Model**~~ | ~~No platform revenue capture~~ ✅ **DONE** — 5% rake on non-free stakes, house accounting ledger |
| ~~**Admin Dashboard**~~ | ~~No admin-facing operations visibility~~ ✅ **DONE** — Revenue, settlements, player inspection, server-enforced admin auth |

### Medium Priority
| Item | Description |
|---|---|
| ~~**AI Analysis on Replays**~~ | ~~Feed stored transcripts to Gemini for post-game coaching~~ ✅ **DONE** |
| **Difficulty Levels** | Selectable AI difficulty (Simple → Nexus) |
| **Real-Time Stats** | WebSocket-updated dashboard stats |
| **Tournament Mode** | Multi-round bracket tournaments |

### Polish
| Item | Description |
|---|---|
| ~~**Table Layout & Hand Dominance**~~ | ~~Rebalance spatial hierarchy: hand-dominant bottom zone, Stock/Discard upper-left, opponent upper-right~~ ✅ **DONE** |
| ~~**Card Design & Visual Identity**~~ | ~~Color palette overhaul, card front/back redesign, branded card backs~~ ✅ **DONE** |
| **Hand highlights** | Highlight completed melds in the hand grid with color coding |
| **Deal animation** | Animate card dealing at round start |
| **Draw/Discard animations** | Card movement animations on draw, discard, and knock |
| **Sound effects** | Card draw/discard/knock audio feedback |
| **Mobile optimization** | Hand grid may need smaller cards or swipe on very narrow screens |
| **Edit Profile / Privacy** | Profile page buttons are UI-only stubs |
| **Spectator view alignment** | Align spectator board with new emerald/gold visual language |
| **MultiplayerRoom parity** | Apply emerald felt + gold accent palette to multiplayer board |
| **Dashboard & Wallet color alignment** | Align lobby/wallet/settings pages with emerald/gold brand identity |

---

## 6. How to Run

### Web Platform
```bash
cd gin-galaxy
cp .env.example .env       # Configure GEMINI_API_KEY (optional)
npm install                 # First time only
npm run dev                 # Starts Express + Vite on http://localhost:3000
                            # WebSocket multiplayer on ws://localhost:3000/ws
                            # Health check on http://localhost:3000/api/health
```

### Production
```bash
cd gin-galaxy
npm install && npm run build # Build frontend
npm start                    # Starts in production mode (NODE_ENV=production)
```

See `DEPLOYMENT.md` in the `gin-galaxy/` directory for full deployment guidance.

### Run Tests
```bash
cd gin-galaxy
npm test                    # Runs 1001 tests via Vitest
```

### Python AI Tournament
```bash
cd "Gin Rummy"
python main.py              # 2000-game round-robin: DeepKnock vs Heisenbot vs Simple
```

### Python Tests
```bash
cd "Gin Rummy"
python -m pytest test_regressions.py -v
python -m pytest test_titan.py -v
python -m pytest test_benchmark.py -v
```

---

## 7. Environment

| Property | Value |
|---|---|
| OS | Windows |
| Node.js | Required (runs via `tsx`) |
| Python | 3.14 (local install in `tools/python314/`) |
| Database | SQLite (`gin-galaxy/database.sqlite`) |
| Port | 3000 |
| AI API | Gemini (requires `GEMINI_API_KEY` in `.env` — optional, analysis degrades gracefully) |

---

## 8. Hardening Sprint Summary

The backend hardening sprint (March 11, 2026) upgraded Gin Paradise from a functional prototype to a **hardened beta foundation**:

1. **Security**: SHA-256 → bcrypt, 24h session expiry, authenticated logout, graceful API key handling
2. **Validation**: All request bodies validated with type/length/range checks; 400 errors on malformed payloads
3. **Rate Limiting**: Auth endpoints (20/15min), analysis (5/5min); prevents abuse
4. **Refactoring**: Monolithic server.ts → 8 focused modules in `server/` directory
5. **Testing**: 21 automated integration tests covering all core API behaviors
6. **Cleanup**: Removed 6 debug artifact files, updated .env.example

The platform is now ready for the next major phase: **multiplayer architecture** (WebSocket PvP), which will build on this safer, testable foundation.

## 9. Multiplayer Sprint Summary

The multiplayer sprint (March 11, 2026) added real-time 1v1 PvP to Gin Paradise:

1. **Server-Authoritative Engine**: Full Gin Rummy game logic on the server, with filtered state projection per player
2. **WebSocket Protocol**: Typed message contracts with 10+ message types for room lifecycle and game actions
3. **Room Management**: Create/join via 6-character codes, auto-start on 2 players, disconnect/forfeit handling
4. **Frontend Integration**: Dedicated multiplayer page with lobby → waiting → playing → game over flow
5. **Security**: Session-authenticated WebSocket upgrades, opponent hand concealment, move validation
6. **Testing**: 19 multiplayer engine tests + successful manual end-to-end verification
7. **Zero Regressions**: All 21 pre-existing API tests continue to pass

The platform is now ready for the next phase: **matchmaking** (random pairing), **replay/analysis**, or **sweepstakes infrastructure**.

## 10. Matchmaking Sprint Summary

The matchmaking sprint (March 11, 2026) added automatic queue-based matchmaking to Gin Paradise:

1. **Queue System**: FIFO queue with duplicate prevention, disconnect cleanup, and 5-minute timeout
2. **Automatic Pairing**: Two queued players are instantly paired into a room and a match starts automatically
3. **Protocol Extension**: 6 new WebSocket message types for matchmaking flow
4. **Quick Match UI**: Prominent Quick Match button on both Dashboard and Multiplayer page
5. **Searching State**: Full animated searching screen with cancel capability
6. **Auto-Queue from URL**: `?quickmatch=true` parameter enables one-click queue from Dashboard
7. **Reliability**: Disconnected players purged from queue, room cleanup on all edge cases
8. **Testing**: 15 new matchmaking tests + 4 room-code regression tests
9. **Zero Regressions**: All 40 pre-existing tests continue to pass

The matchmaking system is the first step toward multiplayer productization. Next candidates: **replay/analysis**, **persistent queue infrastructure**, or **sweepstakes groundwork**.

## 11. Competitive Integrity Sprint Summary

The competitive integrity sprint (March 11, 2026) built the dispute-proof foundation for Gin Paradise multiplayer:

1. **Server-Enforced Turn Timers**: 60s per turn with auto-play fallback (draw from stock + discard drawn card). 3 consecutive timeouts → auto-forfeit.
2. **Match Transcript / Action Ledger**: Every game action (draw, discard, knock, timeout, disconnect, forfeit) recorded chronologically with sequence numbers and timestamps.
3. **Rating-Aware Matchmaking**: Upgraded from FIFO to expanding Elo bracket strategy (±50 base, +50 per 10s wait, max ±1000). Closest-rated pair selected with FIFO tiebreak.
4. **Unified Forfeit Handling**: `endMatchByForfeit()` ensures consistent outcome for all non-standard match endings (leave, timeout, disconnect). Rating updates always applied.
5. **Timer UI**: Client-side countdown display with color transitions (emerald→amber→rose) and timeout warning toasts.
6. **Protocol Extension**: Added `turn_timer` and `turn_timeout_warning` server messages, and `turnTimer` field in PlayerGameView.
7. **Testing**: 35 new competitive integrity tests covering timers, transcripts, rating-aware pairing, and regressions. Total: 90 tests, all passing.
8. **Zero Regressions**: All 55 pre-existing tests continue to pass.

The platform now has an enforceable, auditable, and fair multiplayer foundation suitable for future wagered or sweepstakes-style play.

## 12. Replay Persistence Sprint Summary

The replay persistence sprint (March 11, 2026) added durable transcript storage and a match review flow to Gin Paradise:

1. **Durable Storage**: Match transcripts automatically persist to SQLite `replays` table on finalization. Covers all end reasons: completed, forfeit, timeout, disconnect.
2. **Replay API**: Two new authenticated endpoints — `GET /api/replays` (recent list) and `GET /api/replays/:id` (full detail with transcript). Participant-only access control via 403.
3. **Replay UI**: New `/replays` page with win/loss summary list and round-grouped transcript viewer. Step-through navigation, action-focus highlighting, and per-action timestamps.
4. **Schema Design**: `replays` table stores structured metadata (players, scores, end reason) plus full transcript JSON for easy future AI analysis consumption.
5. **Integration**: `finalizeTranscript()` now auto-persists — no changes needed in roomManager for room-code or matchmaking flows.
6. **Testing**: 18 new tests covering persistence (4), integrity round-trip (2), API list (3), API detail (4), regression (3), and edge cases (2). Total: 108 tests, all passing.
7. **Zero Regressions**: All 90 pre-existing tests continue to pass.

The platform now provides durable replay storage and a functional review experience. Next candidates: **AI analysis on stored transcripts**, **sweepstakes groundwork**, or **persistent multiplayer infrastructure refinements**.

## 13. Transcript-Driven AI Analysis Sprint Summary

The transcript-driven analysis sprint (March 11, 2026) added replay-specific AI coaching to Gin Paradise:

1. **Transcript-to-Prompt Adapter**: Deterministic transformation of stored replay transcripts into structured AI prompts with match overview, player statistics, round summaries, key moments, and complete turn logs.
2. **Replay Analysis API**: `POST /api/replays/:id/analysis` with authentication, participant access control, Gemini AI integration, and structured fallback when API key is unavailable.
3. **Frontend Integration**: "Analyze with AI" button in replay detail view, analysis results panel with Markdown rendering, source badge, loading state, error state, and metadata footer.
4. **Graceful Fallback**: Structured match summary with draw pattern analysis and contextual tips when Gemini API key is not configured.
5. **Rate Limiting**: 10 requests per 5 minutes per IP to prevent abuse while allowing normal replay analysis usage.
6. **Testing**: 23 new tests covering authentication/access (4), fallback behavior (2), input shaping (8), round extraction (2), player stats (3), and regression (4). Total: 131 tests, all passing.
7. **Zero Regressions**: All 108 pre-existing tests continue to pass.

The platform now delivers transcript-grounded post-game coaching tied to exact match actions. Next candidates: **deeper analysis sophistication** (blunder tagging, per-turn annotations), **difficulty-tier/product polish**, or the **sweepstakes/economy track**.

## 14. Sweepstakes Ledger Foundation Sprint Summary

The ledger foundation sprint (March 11, 2026) added the dual-currency wallet and economy primitives to Gin Paradise:

1. **Dual-Currency Wallet**: `wallets` table with `gold_coins` (play currency) and `sweeps_coins` (premium currency) per user. New users receive 10,000 Gold + 2 Sweeps on registration.
2. **Append-Only Transaction Ledger**: `transactions` table records every balance mutation with type, amount, currency, balance_after, reference, and note. Indexed for efficient per-user queries.
3. **Atomic Mutations**: All balance changes happen inside SQLite transactions — the balance update and ledger insert succeed or fail together. Negative balances are rejected.
4. **Ledger Primitives**: `mutateBalance()`, `creditSignupBonus()`, `claimFaucet()`, `getBalances()`, `getTransactions()` — designed for reuse by future escrow, buy-in, rake, and payout flows.
5. **Daily Faucet**: 5,000 Gold + 0.5 Sweeps per 24-hour cooldown. Duplicate claims rejected with structured cooldown response.
6. **Wallet API**: Three new authenticated endpoints — `GET /api/wallet` (balances), `GET /api/wallet/history` (paginated ledger), `POST /api/wallet/faucet` (daily claim, rate limited).
7. **Wallet UI**: Balance cards (amber/violet themes), daily bonus claim button with loading/success/cooldown states, and a transaction history feed with credit/debit indicators.
8. **Testing**: 24 new tests covering ledger primitives (11), API endpoints (8), atomic integrity (2), and regression (3). Total: 155 tests, all passing.
9. **Zero Regressions**: All 131 pre-existing tests continue to pass.

The platform now has the economy primitives required for future coin-gated matchmaking, escrow, and prize distribution. Next candidates: **coin-gated matchmaking / escrow flows**, **deeper analysis sophistication**, or **infrastructure migration path**.

## 15. Coin-Gated Matchmaking & Escrow Sprint Summary

The escrow sprint (March 11, 2026) added stake-based matchmaking and deterministic settlement to Gin Paradise:

1. **Stake Presets**: 5 fixed stake levels — Free Play, 500/2000/5000 Gold, 1 Sweep — with symmetric entry fees and prize pools (winner-takes-all, no rake).
2. **Balance-Gated Queueing**: Server validates wallet balance before allowing queue entry. Insufficient funds rejected with structured error message showing balance vs. required.
3. **Stake-Compatible Pairing**: Matchmaking only pairs players who selected the same stake level. Rating-aware bracket expansion still applies within each stake tier.
4. **Escrow Holds**: Entry fees deducted at match start via `escrow_hold` ledger entries. In-memory per-room escrow state tracks holds for settlement.
5. **Deterministic Settlement**: Winner receives full prize pool on all outcomes: normal completion, forfeit, timeout, disconnect. Uses `prize_payout` ledger type.
6. **Pre-Start Refund**: If match fails before starting (e.g., player leaves waiting room), all holds are refunded via `refund` ledger type.
7. **Frontend UX**: Stake picker grid in lobby with wallet balance display, disabled stakes for insufficient funds, prize pool badge during gameplay, payout amount in game over message.
8. **Auditability**: Stake metadata recorded in match transcripts. Every escrow operation creates explicit ledger entries visible in wallet history and transaction API.
9. **Testing**: 34 new tests covering presets (5), balance checks (5), holds (5), settlement (7), refunds (3), queue compatibility (3), history (1), cleanup (1), regression (4). Total: 189 tests, all passing.
10. **Zero Regressions**: All 155 pre-existing tests continue to pass.

The platform now has a complete coin-gated competitive flow from stake selection through escrow to deterministic settlement. Next candidates: **rake/revenue model**, **tournament mode**, **deeper AI analysis**, or **infrastructure migration for production-scale economics**.

## 16. Showdown Fidelity & Hand UX Sprint Summary

The showdown fidelity sprint (March 11, 2026) upgraded the card-table experience to be rules-faithful and cognitively efficient:

1. **Structured Showdown Data**: New `ShowdownData` protocol type carries full meld/deadwood/layoff breakdowns for both players. Engine computes meld classification (set vs run), layoff detection, and outcome metadata.
2. **Both-Hand Reveal**: Every round end (knock, gin, undercut, game-ending) now reveals both players' complete hands with structured breakdowns. Fixed `broadcastGameState()` bug that previously flattened all hands incorrectly.
3. **Visible Layoff Presentation**: Laid-off cards explicitly identified and displayed with amber color coding. Knocker's melds shown with emerald cards, deadwood with muted zinc. Players can verify scoring at a glance.
4. **Overlapping Hand Layout**: Replaced 4-row suit grid with table-style horizontally overlapping cards (28px overlap). Sort by suit/rank provides spatial stability. Responsive sizing (56px cards, 76-88px height breakpoints).
5. **Phase Clarity**: Explicit text indicators change per game phase: "Draw a card" → "Select, then Discard or Knock" → "Waiting for opponent." Replaces generic status messages.
6. **Human-Factors Optimization**: Perceptual grouping via suit sorting, recognition over recall via labeled melds, motor accuracy via 28px exposed targets with lift-on-select, low cognitive noise via color semantics.
7. **Consistent Treatment**: Both single-player (GameRoom) and multiplayer (MultiplayerRoom) use identical overlapping layout and showdown presentation. Stored showdown data available on reconnect.
8. **Testing**: 17 new tests covering showdown data presence, meld classification, gin/undercut detection, layoff tracking, reveal consistency, and regressions. Total: 206 tests, all passing.
9. **Zero Regressions**: All 189 pre-existing tests continue to pass.

The platform now provides a rules-faithful, table-native card-table experience with clear showdown presentation. Next candidates: **deeper single-player difficulty tiers**, **richer match analysis with blunder tagging**, **tournament mode**, or **visual showdown in replays**.

## 17. Rake & House Accounting Sprint Summary

The rake and house accounting sprint (March 11, 2026) added platform revenue capture to Gin Paradise:

1. **Configurable Rake Model**: 5% flat rake on all non-free stakes (Free Play remains 0%). Each preset has deterministic `rakeAmount` and `prizePool` computed from `entryFee` and `rakePercent`.
2. **Settlement Formula**: `winnerPayout = totalHeld - rakeAmount`, with invariant `prizePool + rakeAmount = 2 x entryFee` enforced at preset construction.
3. **House Revenue Ledger**: New `house_ledger` SQLite table records every rake collection with room ID, stake ID, winner/loser IDs, currency, and timestamp. Revenue queryable by currency.
4. **Atomic Settlement**: Payout and rake happen together — no partial states. Reconciliation invariant holds for all outcome types (completion, forfeit, timeout, disconnect).
5. **No Rake on Refunds**: Pre-start failures refund the full entry fee to both players. Rake is only collected on settled matches.
6. **Player Transparency**: Stake picker shows rake-adjusted net win amounts with "(5% rake)" label. Prize pool badge in game header shows net payout.
7. **Audit Trail**: Winner's transaction history shows the net payout amount with "net of X rake" notation. Transcript metadata includes `rakeAmount` and `rakePercent` for replay auditability.
8. **Testing**: 32 new tests covering rake presets (6), settlement with rake (5), free play (2), refund (1), house accounting (5), player history (2), reconciliation (4), queue compatibility (2), and regression (5). Total: 238 tests, all passing.
9. **Zero Regressions**: All 206 pre-existing tests continue to pass alongside the 32 new rake tests.

The platform now has an auditable, configurable, transparent revenue model. Next candidates: **tournament mode**, **richer match analysis**, **admin dashboard**, or **infrastructure hardening for production economics**.

## 18. Admin Revenue & Operations Dashboard Sprint Summary

The admin dashboard sprint (March 11, 2026) added secure operational visibility to Gin Paradise:

1. **Admin Access Model**: `is_admin` column on users table, provisioned via direct DB update. `requireAdmin` middleware enforces server-side authorization on all `/api/admin/*` endpoints. Non-admins receive 403, unauthenticated receive 401.
2. **Revenue API**: `GET /api/admin/revenue` returns total rake by currency, transaction counts, and recent house ledger entries. Numbers reconcile directly against the existing `house_ledger` table.
3. **House Ledger API**: `GET /api/admin/house-ledger` exposes paginated rake entries with full context (room, stake, winner/loser, timestamps).
4. **Settlement View**: `GET /api/admin/settlements` joins replays and house ledger to show who played, what the stake was, winner payout, rake taken, and how the match ended.
5. **Player Inspection**: `GET /api/admin/players/search` for targeted lookup, `GET /api/admin/players/:id` for wallet balances, transaction history, and match history. Read-only, no mutation.
6. **Admin UI**: Three-tab dashboard (Revenue, Settlements, Players) with summary cards, data tables, player search, and detail drilldown. Conditional nav link via Shield icon.
7. **Player Preferences**: Optional deadwood count display (show/hide) and four-color deck rendering (♠ black, ♥ red, ♦ blue, ♣ green). Zustand store persisted to localStorage. Settings gear in game header.
8. **Testing**: 25 new tests covering admin rejection (6), revenue (3), house ledger (3), settlements (2), player search (3), player detail (2), auth identity (2), and regression (4). Total: 263 tests, all passing.
9. **Zero Regressions**: All 238 pre-existing tests continue to pass alongside the 25 new admin tests.

The platform now has a secure, read-only admin operations surface. Next candidates: **tournament mode**, **richer transcript-based analysis**, **infrastructure hardening for production**, or **admin write tools** if support needs arise.

## 19. Public Beta Deployment Hardening Sprint Summary

The deployment hardening sprint (March 11, 2026) made Gin Paradise production-ready for single-node hosted deployment:

1. **Production Configuration**: New `server/config.ts` centralizes all runtime configuration with explicit defaults for PORT (3000), HOST (0.0.0.0), DATABASE_PATH, TRUST_PROXY, and ALLOWED_ORIGINS. Startup logs a human-readable configuration summary.
2. **Correct Startup Path**: Fixed broken `npm start` (was `node server.ts` which can't run TypeScript). Now uses `NODE_ENV=production tsx server.ts`. Development workflow (`npm run dev`) unchanged.
3. **Health Endpoint**: `GET /api/health` — unauthenticated, checks SQLite connectivity, returns status/uptime/version/environment. No secrets exposed. Suitable for platform health checks.
4. **Trust Proxy Support**: Configurable via `TRUST_PROXY` env var. When enabled, Express correctly resolves client IPs behind reverse proxies (Render, Railway, Fly, nginx), fixing rate limiting accuracy.
5. **Graceful Shutdown**: SIGTERM/SIGINT handlers close HTTP server, WebSocket connections, background timers, and SQLite database in order. 2-second drain period prevents resource leakage.
6. **Deployment Documentation**: New `DEPLOYMENT.md` with environment variable reference, platform-specific guidance (Render, Railway, Fly, VPS+nginx), WebSocket/SQLite notes, and admin provisioning instructions.
7. **Preference Parity**: Closed the four-color deck and deadwood count gap between GameRoom and MultiplayerRoom. Both surfaces now use `getSuitColor()`, pass `fourColor` prop through all card components, and have matching settings gear dropdowns.
8. **`.env.example` Expansion**: All new configuration variables documented with descriptions and examples.
9. **Testing**: 16 new tests covering health endpoint (4), configuration module (5), trust proxy (1), and deployment regressions (6). Total: 279 tests across 12 files, all passing.
10. **Zero Regressions**: All 263 pre-existing tests continue to pass alongside the 16 new hardening tests.

The platform is now deployable to any single-node host with WebSocket support and persistent storage. Next strongest candidates: **tournament mode**, **deeper AI analysis with blunder tagging**, or **infrastructure migration** when real scale demands it.

## 20. Tournament Mode MVP Sprint Summary

The Tournament Mode MVP sprint (March 12, 2026) added a fully playable 4-player single-elimination sit-and-go tournament format:

1. **Tournament System (`server/tournament.ts`)**: Core module implementing tournament lifecycle (open → in_progress → completed / cancelled), bracket seeding, advancement logic, winner-take-all payout with configurable rake, and full cancellation/refund paths.
2. **Data Model & Persistence**: Durable `tournaments` table in SQLite stores all tournament state (identity, format, status, entrants JSON, bracket JSON, financials, timestamps). In-memory maps for active tournaments with DB persistence on every mutation. Auto-loads on startup.
3. **Tournament Presets**: Three configurable presets — Free Sit & Go (no entry/rake), 500 Gold Sit & Go (5% rake), 2000 Gold Sit & Go (5% rake). Winner-take-all payout model.
4. **Financial Integration**: Reuses existing wallet, ledger, and house-accounting primitives. Entry fees deducted on join. Full refunds on tournament cancel or player leave (before start). Prize payout and rake recorded on completion. Reconciliation invariant: `prizePool + rakeAmount = totalPool`.
5. **Bracket Orchestration**: Random seeding on fill. SF1: Seed 1 vs Seed 4, SF2: Seed 2 vs Seed 3. Winners auto-advance to final. Bracket progression handles normal completion, forfeit, timeout, and disconnect outcomes via integration with `roomManager.ts`.
6. **WebSocket Integration**: New `start_tournament_match` client message, plus server messages for bracket updates (`tournament_update`, `tournament_match_starting`, `tournament_advance`, `tournament_eliminated`, `tournament_completed`). Tournament room creation and rejoin via `roomManager.ts` helper functions.
7. **Tournament API (`server/routes/tournament.ts`)**: REST endpoints for listing (filterable), details, create-from-preset, join, and leave. All auth-gated. Sanitized view projection strips internal state.
8. **Tournament UI (`src/pages/Tournaments.tsx`)**: Tabbed tournament browser (open/in-progress/completed), create modal with preset cards, join/leave actions, bracket visualization with interactive "Play Match" buttons, player avatars with seed/elimination status. Navigation added to sidebar.
9. **Multiplayer Integration**: `MultiplayerRoom.tsx` auto-connects and starts tournament matches when navigated with `?tournamentId=...&matchIndex=...` URL parameters. `useMultiplayer.ts` extended with tournament state fields and WebSocket message handling.
10. **Testing**: 35 new tests covering tournament creation & economics (3), join validation (5), balance-gated entry (2), bracket fill & auto-start (2), semifinal-to-final advancement (3), tournament completion & payout/rake (2), cancel/refund (2), leave (2), pending match detection (1), API endpoints (6), elimination tracking (1), and regression coverage (6). Total: **314 tests across 13 files, all passing.**
11. **Zero Regressions**: All 279 pre-existing tests continue to pass alongside the 35 new tournament tests.

The platform now has a real, playable tournament product. Next strongest candidates: **deeper tournament productization** (multi-table, scheduled events), **richer transcript-based analysis**, or **infrastructure migration** when real scale demands it.

## 21. Game Feel and Interaction Polish Sprint Summary

The Game Feel sprint (March 12, 2026) added tactile interaction improvements:

1. **Drag-and-Drop Hand Sorting**: Pointer-event-based drag reordering of cards in hand, with auto-sort on new deal.
2. **Active Meld Highlighting**: Live in-hand color-coded meld identification using the existing `evaluateHand()` engine.
3. **Audio Feedback**: Web Audio API-generated sounds for draw, discard, knock, deal, result, and payout actions.
4. **Preference Integration**: Sound and animation toggles added to preferences store with persistence.
5. **Testing**: 17 new tests covering meld highlighting, hand drag reordering, preferences, audio, and regression.

## 22. Gin Paradise Brand Consistency Sprint Summary

The Brand Consistency sprint (March 12, 2026) completed the comprehensive rename from "Gin Galaxy" to "Gin Paradise":

1. **Public-Facing Surfaces**: App header (Layout.tsx), page title (index.html), metadata.json name field — all now read "Gin Paradise".
2. **Persistence Key Migration**: `preferences.ts` STORAGE_KEY renamed from `gin-galaxy-prefs` to `gin-paradise-prefs` with a one-time migration function that copies existing data from the old key and removes the old key. Zero data loss for existing users.
3. **Server-Side Branding**: Server startup banner (server.ts), configuration log header (server/config.ts), and package.json name field all updated.
4. **Documentation**: README.md, DEPLOYMENT.md, PROJECT_STATUS.md, .env.example, and all 12 historical EXECUTION_REPORT files updated.
5. **Source File Comments**: All JSDoc headers across 17 source files (server modules, route handlers, middleware, client libraries, page components, test files) updated from "Gin Galaxy" to "Gin Paradise".
6. **Workflow Config**: `.agent/workflows/execution-reports.md` description updated.
7. **Scope Exclusions**: `CLAUDE_DIRECTIVE_*.md` files (historical input directives) intentionally preserved as-is. The `gin-galaxy/` folder name retained as an internal path reference.
8. **Verification**: Zero instances of "Gin Galaxy" remaining in any `.ts`, `.tsx`, `.json`, `.md`, `.html`, or `.env` file across the repository (excluding CLAUDE_DIRECTIVE input files). The only remaining `gin-galaxy-prefs` string is the `LEGACY_STORAGE_KEY` constant used for migration.
9. **Testing**: All 314 tests across 14 test files pass with zero regressions. TypeScript compilation clean (pre-existing strict-mode warnings only).
10. **Zero Regressions**: All pre-existing tests continue to pass with no behavioral changes.

## 23. Mathematical Replay Evaluation Sprint Summary

The mathematical evaluation sprint (March 12, 2026) added engine-backed decision evaluation to Gin Paradise:

1. **Python Evaluator (`gin_rummy/evaluator.py`)**: Standalone evaluation module that accepts replay transcript JSON via stdin and produces structured per-turn decision evaluations. Uses Apex v2 engine logic to score discard, knock, and draw decisions. Classifies each into severity tiers (best, inaccuracy, mistake, blunder) based on deadwood cost.
2. **TypeScript Bridge (`server/analysis/pythonBridge.ts`)**: Subprocess bridge spawns `python -m gin_rummy.evaluator`, communicates via stdin/stdout JSON, enforces 30s timeout with SIGTERM kill, caches results in SQLite `replay_evaluations` table, and degrades gracefully when Python is unavailable.
3. **Evaluation API**: Two new endpoints — `POST /api/replays/:id/evaluation` (compute or retrieve cached evaluation, rate limited 15/5min) and `GET /api/replays/:id/evaluation` (cached only, no Python). Both enforce participant-only access control.
4. **Frontend Integration**: New "Engine Eval" button in replay viewer alongside existing AI Coach. Evaluation panel shows engine accuracy percentage, score label (excellent/good/fair/needs_improvement/poor), severity distribution per player, and methodology description. Per-turn severity badges appear inline on the action timeline for inaccuracies, mistakes, and blunders.
5. **Methodology Honesty**: Score is explicitly labeled as "engine agreement rate" (not solved-game oracle). Draw evaluations carry hidden-information caveats. Methodology description in both code and UI makes clear this is a heuristic approximation.
6. **Evaluated Decision Types**: Discards (first-class — Apex v2 actual-DW scoring), knocks (clear right/wrong with simplified Apex v2 heuristics), draws (included with honest hidden-info caveat).
7. **Caching**: Evaluations cached in `replay_evaluations` SQLite table after first computation. Subsequent requests (GET or POST) return cached results instantly.
8. **Graceful Degradation**: If Python is unavailable, the evaluation endpoint returns structured error JSON without breaking the replay viewer. Existing AI analysis and replay features remain fully functional.
9. **Python Unit Tests**: 24 tests (`test_evaluator.py`) covering card parsing, discard evaluation, knock evaluation, draw evaluation, summary building, and full pipeline with sample transcripts.
10. **Integration Tests**: 18 new tests (`tests/evaluation.test.ts`) covering authentication/access (4), graceful degradation (1), caching behavior (3), SQLite cache operations (4), GET access control (2), and regression coverage (4). Total: **332 tests across 15 files, all passing.**
11. **Zero Regressions**: All 314 pre-existing tests continue to pass alongside the 18 new evaluation tests.

## 24. Default Client-Seed Rollout & Live Fairness UX Sprint Summary

The Default Rollout sprint (March 12, 2026) completed the Trust Shield v2 rollout by making provably fair multi-party entropy the automatic default:

1. **Automatic Client-Seed Submission**: The `useMultiplayer` hook now auto-generates a 32-char hex client seed (via `crypto.getRandomValues`) and submits it over WebSocket on `game_started` and each new round. No manual player action required.
2. **Live Fairness Status Badge**: A compact Trust Shield badge appears in the multiplayer game header, color-coded (emerald=v2, amber=in-progress, zinc=v1). Hover tooltip shows commitment hash, seed submission status, and round info.
3. **Server-Side Status Broadcasting**: New `FairnessStatusInfo` type, `buildFairnessStatus()` and `broadcastFairnessStatus()` functions. Status injected into every game view for reconnection support.
4. **Replay/Live Consistency**: `algorithmVersion` in proof packages matches live status. Commitment hashes are identical between live badge and proof. Mixed v1/v2 matches correctly tracked per-round.
5. **Graceful Fallback**: v1 (server-only) fallback preserved for edge cases (seed submission failure, pre-v2 clients). Under normal conditions 100% of rounds use v2.
6. **TypeScript Cleanup**: All `MoveResult` discriminated-union narrowing errors fixed across 4 test files. Missing `stakeId` on `QueueEntry` fixed. `npx tsc --noEmit` now exits with zero errors.
7. **Testing**: 24 new tests (`tests/default-rollout.test.ts`) covering auto-submission (5), reconnects/transitions (3), fallback behavior (4), live status (3), replay/live consistency (4), and API integration with regression (5). Total: **471 tests across 19 files, all passing.**
8. **Zero Regressions**: All 447 pre-existing tests continue to pass alongside the 24 new rollout tests.

## 25. Training Automation & Progression Depth Sprint Summary

The Training Automation sprint (March 12, 2026) transformed training from a manual review tool into a frictionless, habit-forming product surface:

1. **Automatic Evaluation Preparation**: Evaluations now auto-trigger 2s after match completion via `finalizeTranscript()` → `triggerAutoEvaluation()`. Fire-and-forget with try/catch protection — failures never block gameplay, replay persistence, or match finalization.
2. **Batch Preparation Endpoint**: `POST /api/training/prepare` lets users trigger bulk evaluation of recent unevaluated replays (bounded at max 10 per call). Deduplication via in-flight set prevents duplicate concurrent work.
3. **Progression Signals**: Training summary now includes rolling accuracy timeline, mistake-rate timeline, window comparison (recent 40% vs older 40%), hot/cold streaks, strongest/weakest decision categories, improvement delta, and best-streak counter.
4. **Tournament & Format Context**: New `match_format` and `tournament_id` columns on replays table. Auto-detection from transcript metadata (heads_up, heads_up_staked, tournament_sng, tournament_scheduled). Format badges and tournament names displayed in session list and detail views.
5. **Training History Endpoint**: `GET /api/training/history` with pagination (limit/offset), filtering (all/evaluated/unevaluated/wins/losses/tournament), and sorting (recent/accuracy_high/accuracy_low).
6. **Frontend Rewrite**: Training.tsx now shows auto-eval status messaging, batch-prep button, progression insights card (streaks, categories, window comparison), format distribution chart, format badges on all sessions, and overview/history tabs.
7. **Deduplication & Safety**: In-flight evaluation tracking via Set prevents duplicate concurrent evaluations. Cache checks before spawning Python. All existing timeout and graceful-failure behavior preserved.
8. **Testing**: 14 new tests added (29 total in training.test.ts) covering batch-prepare (3), history pagination and filtering (5), progression signals (2), tournament/format context (3), session detail format labels (1). Total: **485 tests across 19 files, all passing.**
9. **Zero Regressions**: All 471 pre-existing tests continue to pass alongside the 14 new training automation tests.

## 26. Profile, Achievement & Prestige Layer Sprint Summary

The Profile/Achievement/Prestige sprint (March 12, 2026) built the first real retention and identity layer for Gin Paradise:

1. **Server-Backed Achievement System (`server/achievements.ts`)**: 24 meaningful achievements across 5 categories (competitive, tournament, training, consistency, prestige) with 4 tier levels (bronze, silver, gold, diamond). Deterministic server-side evaluation via `evaluateAchievements()`. Duplicate prevention via `INSERT OR IGNORE` on `UNIQUE(user_id, achievement_id)` constraint.
2. **Prestige Unlock System**: 15 achievements unlock prestige items (titles, badges, avatar frames) when earned. Players can select and display active title, badge, and frame on their profile. Server validates that selected items are actually unlocked.
3. **Profile & Achievement API (`server/routes/profile.ts`)**: 5 new endpoints — full profile with auto-evaluation (GET /api/profile), public profile by username (GET /api/profile/:username), profile update with validation (PUT /api/profile), achievement catalog (GET /api/profile/achievements/catalog), and retroactive backfill trigger (POST /api/profile/backfill).
4. **Rich Profile Frontend (`src/pages/Profile.tsx`)**: Complete rewrite from 203-line static page to 620-line rich identity surface with player identity card (tier-colored avatar, prestige title/badge, frame support, editable bio), three-tab layout (Overview, Achievements, Prestige), achievement progress with category grouping, and prestige customization with click-to-equip.
5. **Data Integrity**: All award logic is server-side against real database queries. `INSERT OR IGNORE` prevents duplicates at the database level. Retroactive backfill is safe to call repeatedly. Profile updates validated against actual unlocked items.
6. **Public/Shareable Profile**: Public profile endpoint at `/api/profile/:username` returns achievements, prestige, tournament stats, and profile selections without exposing user IDs or internal data. Share button copies public profile URL.
7. **Three New SQLite Tables**: `achievements` (user awards with timestamps), `prestige` (unlocked identity items), `player_profiles` (selected title/badge/frame/bio).
8. **Testing**: 31 new tests covering profile API (4), achievement award logic (5), prestige unlocks (3), profile updates (5), public profile (4), backfill (2), win streaks (1), staked wins (1), achievement catalog (1), and regression (5). Total: **516 tests across 20 files, all passing.**
9. **Zero Regressions**: All 485 pre-existing tests continue to pass alongside the 31 new profile tests.

## 27. AI Coaching Timeline & Cached Training Narrative Sprint Summary

The AI Coaching sprint (March 13, 2026) integrated durable AI coaching into the Gin Paradise training product:

1. **Durable Coaching Cache (`server/analysis/coachingCache.ts`)**: New `replay_coaching` SQLite table stores coaching narratives per replay with source tagging ("ai" or "fallback"), schema versioning for future invalidation, and cache-first retrieval that prevents redundant API calls.
2. **AI/Fallback Generation**: Gemini AI coaching with structured prompt requesting narrative + themes. Graceful fallback generates rich structured coaching (match review, draw pattern analysis, engine accuracy context, strategic tips) without an API key.
3. **Mistake Linking**: Engine evaluation data linked to coaching explanations — per-turn coaching notes sorted by severity (blunder > mistake > inaccuracy) with deadwood cost context.
4. **Training Integration**: Training summary includes coaching themes, coverage stats, and session-level coaching badges. Session detail combines engine evaluation and coaching as distinct top-level keys. History supports `filter=coached`.
5. **Three New Coaching Endpoints**: `POST /api/training/coaching/:id` (generate/retrieve), `GET /api/training/coaching/timeline` (recent entries), `GET /api/training/coaching/themes` (aggregated recurring themes).
6. **Theme Aggregation**: `aggregateCoachingThemes()` counts recurring coaching themes across sessions to surface persistent strategic patterns.
7. **Frontend Integration**: AI Coaching Insights card with recurring themes, latest session preview, and source badges. Coaching badge on session list items. Methodology note updated to distinguish coaching from engine evaluation.
8. **Testing**: 35 new tests covering cache operations (4), theme aggregation (4), coaching generation API (6), timeline API (3), themes API (2), training integration (6), content validation (3), and regression (7). Total: **551 tests across 21 files, all passing.**
9. **Zero Regressions**: All 516 pre-existing tests continue to pass alongside the 35 new coaching tests.

## 28. Live Achievement Triggers & Instant Progress Feedback Sprint Summary

The Live Triggers sprint (March 13, 2026) wired the achievement system to real-time game events and added instant visual feedback for unlocks:

1. **Live Achievement Trigger Function (`triggerLiveAchievements`)**: Central entry point for real-time achievement evaluation. Evaluates all applicable achievement criteria, creates notification records for newly earned ones, and returns full metadata (definition + prestige unlock info). Called from match completion, tournament completion, and evaluation completion hooks.
2. **Match Completion Integration (`transcript.ts`)**: After `finalizeTranscript()` persists a replay, live achievement evaluation fires for both the winner and loser. Fire-and-forget pattern with try/catch — never blocks gameplay or match finalization.
3. **Tournament Completion Integration (`tournament.ts`)**: After `_completeTournament()`, all tournament entrants (not just the winner) get achievement evaluation. Catches tournament-specific achievements (tournament_win, first_tournament, etc.).
4. **Evaluation Completion Integration (`pythonBridge.ts`)**: After a replay evaluation is cached, both players get achievement evaluation. Catches training-related achievements (first_evaluation, accuracy_80, no_blunders, etc.).
5. **Achievement Notification System**: New `achievement_notifications` SQLite table tracks unseen unlock notifications with trigger source tagging. Three new API endpoints: `GET /api/profile/notifications` (unseen unlocks), `POST /api/profile/notifications/dismiss` (mark seen, supports specific IDs or dismiss-all), `GET /api/profile/activity` (recent achievement timeline with prestige and progress totals).
6. **Unlock Toast UI (`AchievementToast.tsx`)**: Animated slide-in toast component that polls for unseen notifications every 15 seconds. Tier-colored gradient backgrounds (bronze/silver/gold/platinum/diamond) with shimmer animation. Shows achievement name, description, tier badge, and prestige unlock callout. Auto-dismisses after 6 seconds with server-side seen marking.
7. **Dashboard Recent Progress Section**: New "Recent Progress" section on Dashboard showing achievement summary card (total achievements + prestige items), recent achievement cards with tier badges and prestige unlock callouts, and "View All" link to profile.
8. **Prestige Activation Flow**: Live-triggered prestige items are immediately visible on profile and equippable via `PUT /api/profile`. No page reload required — unlock → equip happens in the same session.
9. **Route Ordering Fix**: Moved notification/activity routes before the `/:username` wildcard route to prevent Express from matching paths like `/notifications` as usernames.
10. **Testing**: 29 new tests covering live triggers (4), duplicate prevention (3), notification API (3), notification dismissal (3), activity surface (5), prestige visibility (3), training triggers (1), and regression (7). Total: **580 tests across 22 files, all passing.**
11. **Zero Regressions**: All 551 pre-existing tests continue to pass alongside the 29 new live trigger tests.

## 29. Cosmetic Inventory & Store-Ready Prestige Catalog Sprint Summary

The Cosmetic Inventory sprint (March 13, 2026) built a durable cosmetic system with catalog browsing, ownership tracking, equip flows, and store-ready architecture:

1. **Server-Backed Cosmetic Catalog (`server/cosmetics.ts`)**: 36 cosmetic items across 6 types (titles, badges, frames, card backs, table themes, emotes) with 5 rarity tiers (common → legendary). Each item has a canonical key, type, display name, description, rarity, source, preview metadata, and sort order. Items sourced from achievements, catalog purchases, starter grants, admin grants, or promotions.
2. **Ownership & Inventory Tracking**: New `cosmetic_inventory` SQLite table with `UNIQUE(user_id, item_key)` constraint for duplicate prevention. `INSERT OR IGNORE` pattern ensures idempotent grants. Each ownership record tracks source, source reference, and acquisition timestamp.
3. **Equip/Unequip Flow**: `equipCosmetic()` validates item type matches target slot, checks ownership (both cosmetic inventory AND legacy prestige table for backward compat), and updates `player_profiles` with new equip columns (`selected_card_back`, `selected_table_theme`, `selected_emote_1`, `selected_emote_2`). Starter items always equippable without explicit ownership check.
4. **Store-Ready Purchase Flow**: `validateCatalogPurchase()` checks item availability, source type, pricing, and duplicate ownership. Purchase endpoint coordinates with existing `mutateBalance()` ledger system — wallet deduction and item grant happen atomically in a SQLite transaction. 6 catalog card backs (500–10,000 Gold), 3 table themes (750–2,000 Gold), and 4 emotes (200–500 Gold) available for purchase.
5. **Prestige Migration**: `migratePrestigeToInventory()` reads existing prestige unlocks and grants matching cosmetic inventory entries. Safe to call repeatedly (idempotent). Auto-runs on catalog and inventory access so existing players' unlocks are seamlessly preserved.
6. **Starter Item System**: Items with `source: 'starter'` (classic_red card back, classic_green table, gg emote) are auto-granted on first inventory access. These serve as default equipments and can't be unequipped (reset to default instead).
7. **Admin Grant Endpoint**: `POST /api/cosmetics/admin/grant` allows admin-authenticated users to grant any catalog item to any player, bypassing purchase validation. Tracks admin identity in source reference.
8. **Cosmetic API (`server/routes/cosmetics.ts`)**: 7 new endpoints — catalog with ownership (GET /catalog), inventory (GET /inventory), equipped state (GET /equipped), equip action (PUT /equip), purchase (POST /purchase), migration (POST /migrate), admin grant (POST /admin/grant).
9. **Cosmetics UI (`src/pages/Cosmetics.tsx`)**: Premium browsing surface with tabbed Store/My Collection views, type filter pills, rarity-styled item cards with icons and emoji previews, collection progress bar, gold balance display, one-click equip/unequip with instant feedback, purchase buttons with gold coin pricing, active loadout summary showing all equipped slots.
10. **Navigation Integration**: Cosmetics page added to app router and sidebar/footer navigation with Package icon.
11. **Testing**: 34 new tests covering catalog retrieval (4), inventory and duplicate prevention (3), equip validation (5), purchase flow (6), prestige migration (6), and regression coverage (10). Total: **614 tests across 23 files, all passing.**
12. **Zero Regressions**: All 580 pre-existing tests continue to pass alongside the 34 new cosmetics tests.

## 30. Premium Entitlements & Training Subscription Packaging Sprint Summary

The Premium Entitlements sprint (March 13, 2026) built a durable server-backed entitlement model for free vs premium access with consistent feature gating across all training and coaching surfaces:

1. **Server-Backed Entitlement Model (`server/entitlements.ts`)**: Core plan management with `free` and `premium` tiers. New `entitlements` SQLite table stores plan type, expiry date, grant metadata (who, why, when). Auto-expiry: premium plans with `expires_at` auto-demote on every access check — no cron needed.
2. **Feature Catalog**: 15 features explicitly categorized as free (8) or premium (7). Free: core gameplay, basic training, engine evaluation, achievements, cosmetics, replays, wallet, trust shield. Premium: AI coaching, coaching timeline, coaching themes, deep progression, advanced history, session coaching, batch prepare.
3. **Entitlement Audit Log**: Append-only `entitlement_audit_log` table records every plan change with old plan, new plan, who made the change, reason, and timestamp. Supports compliance and support workflows.
4. **Admin Grant/Revoke**: Secure admin-only endpoints for granting/revoking premium access. All operations require a reason (minimum 3 characters). Support for time-limited grants (1–365 days) or indefinite access. No billing integration — administrative controls only.
5. **Entitlement API (`server/routes/entitlements.ts`)**: 6 endpoints — plan details (GET /plan), feature comparison (GET /features), admin grant (POST /admin/grant), admin revoke (POST /admin/revoke), audit log (GET /admin/audit/:id), user plan status (GET /admin/status/:id).
6. **Training Route Gating**: Premium features return graceful locked responses with `{ locked: true, upgradeMessage }` pattern. Free users still see all session data, engine evaluation results, basic trends, and format breakdown. Only analytical depth (coaching narratives, progression analysis, batch prep) is gated.
7. **Auth Response Integration**: Login and `/me` responses include user's `plan` field, enabling plan-aware UI rendering without extra API calls.
8. **Premium Plan Page (`src/pages/Premium.tsx`)**: Current plan badge with status, side-by-side plan comparison cards, feature comparison table with check/cross indicators, upgrade messaging with illustrative pricing, admin grant/revoke controls (admin-only section).
9. **Navigation Integration**: Premium page added to app router with `/premium` route and Crown icon in sidebar/footer navigation.
10. **Existing Test Updates**: Training and coaching test suites updated to grant premium to users that test premium features, maintaining existing test coverage without false failures.
11. **Testing**: 33 new tests covering default plan (3), grant/revoke (5), plan API (4), admin controls (6), auth integration (3), training gating (5), and regression (7). Total: **647+ tests across 24 files, all passing.**
12. **Zero Regressions**: All 614 pre-existing tests continue to pass alongside the 33 new entitlement tests.

## 31. Seasonal Competition & Public Social Layer Sprint Summary

The Seasonal Competition sprint (March 13, 2026) added a season-based competition loop and enriched public-facing identity surfaces:

1. **Season Model (`server/seasons.ts`)**: Core season concept with auto-created 30-day seasons, seasonal Elo rating (K=32, starts at 1200), season standings computed from seasonal match results, and persistent season history. Seasons auto-rotate — when a season ends, the next one is created automatically.
2. **Season Tables**: Two new SQLite tables — `seasons` (id, name, number, start/end dates, status, theme) and `season_stats` (per-user per-season rating, wins, losses). Indexed for leaderboard query performance.
3. **Seasonal Leaderboard**: Extended `/api/leaderboard` with `?view=lifetime|seasonal` parameter. Seasonal view returns season-specific standings with seasonal rating, win/loss record, tier badges (Beginner through Elite), and season metadata. Default view remains lifetime for backward compatibility.
4. **Season API (`server/routes/seasons.ts`)**: 4 new endpoints — current season metadata with progress (GET /current), seasonal leaderboard standings (GET /leaderboard), authenticated user's season stats (GET /me), and season history/archive (GET /all).
5. **Enriched Public Profile**: Public profile endpoint now includes seasonal standing (season rating, rank, record), recent match highlights (last 5 outcomes with win/loss, opponent, and date), and current win streak. Privacy boundaries maintained — no user IDs, accuracy data, or internal metrics exposed.
6. **Leaderboard-to-Profile Drilldown**: Leaderboard rows are clickable, opening an inline Player Inspect Modal with full competitive identity — tier-colored avatar, prestige title/badge, stats grid, season standing, tournament record, recent matches, and achievement showcase. Full-page public profile page also available at `/player/:username`.
7. **Season UI on Leaderboard**: Dual-view toggle (Seasonal/All-Time) with animated season progress bar, season theme badge, days-remaining countdown, and tier badges for seasonal players.
8. **Season UI on Profile**: New Season Standing card on the Profile overview tab showing seasonal rating, rank, record, match count, and progress bar. Displayed on both authenticated and public profiles.
9. **Full-Page Public Profile (`src/pages/PublicPlayerProfile.tsx`)**: Standalone page at `/player/:username` with full competitive identity card, seasonal standing, match statistics, tournament record, recent matches, and achievement gallery.
10. **Testing**: 33 new tests covering season metadata (6), seasonal leaderboard (5), player season stats (4), public profile enrichment (6), authenticated profile season integration (1), and regression coverage (11). Total: **680 tests across 25 files, all passing.**
11. **Zero Regressions**: All 647 pre-existing tests continue to pass alongside the 33 new season tests.

## 32. Social Challenge, Follow & Rematch Loop Sprint Summary

The Social Challenge Loop sprint (March 13, 2026) built an actionable social graph with direct challenge flow and rivalry context:

1. **Lightweight Social Graph (`server/social.ts`)**: One-directional follow model (asymmetric, like Twitter). Follow/unfollow with duplicate prevention (`UNIQUE` constraint), self-follow rejection, follower/following counts, and paginated lists. New `follows` SQLite table.
2. **Direct Challenge System**: Complete challenge lifecycle — pending → accepted / declined / expired / cancelled. 5-minute auto-expiry via lazy expiration (no cron needed). Max 5 active outbound challenges per user. Duplicate guard (one pending challenge per challenger→target pair). New `challenges` SQLite table.
3. **Social Notifications**: Durable `social_notifications` table tracks challenge_received, challenge_accepted, challenge_declined, challenge_expired, and new_follower events. Supports unread count, mark-specific-read, and mark-all-read. Filterable and paginated.
4. **Head-to-Head Rivalry Data**: `getHeadToHead()` queries replay outcomes between two players. Returns wins/losses/total and last-played timestamp. Only replay outcomes exposed — no private data leaked. Integrated into public profile response.
5. **Social API (`server/routes/social.ts`)**: 19 REST endpoints covering follows (by userId and by username), challenges (create/accept/decline/cancel/inbox/outbox/history), head-to-head, and notifications. All auth-gated.
6. **Public Profile Enhancement**: Follow/unfollow and challenge buttons on `PublicPlayerProfile.tsx`. Follower count display. Head-to-head rivalry card with gradient styling showing your wins / total / their wins. Social relationship data (`isFollowing`, `isFollowedBy`, `headToHead`) returned by profile API when viewer is authenticated.
7. **Social Hub Page (`src/pages/SocialHub.tsx`)**: Unified 5-tab social competition surface — Inbox (accept/decline), Sent (cancel), History (status badges), Following (profile/unfollow), and Alerts (notification feed with read state). Badge counts on tabs, expiry countdowns, empty states with guidance.
8. **Navigation Integration**: Social Hub added to Layout navigation with Swords icon. `/social` route added to App router.
9. **Username-Based Endpoints**: Added `follow-by-username` and `challenge-by-username` endpoints because the public profile deliberately doesn't expose userId for privacy. Username→userId resolution happens server-side.
10. **Testing**: 49 new tests covering social follow model (11), direct challenge flow (12), decline flow (3), cancel flow (2), validation edge cases (3), head-to-head (2), social notifications (4), public profile integration (3), and regression coverage (9). Total: **729 tests across 26 files, all passing.**
11. **Zero Regressions**: All 680 pre-existing tests continue to pass alongside the 49 new social tests.

## 33. Seamless Challenge-to-Match Activation Sprint Summary

The Challenge-to-Match Activation sprint (March 13, 2026) turned the social challenge/rematch layer into a true gameplay loop by making accepted challenges and rematches flow directly into live private matches:

1. **Challenge → Room Handoff (`server/social.ts`)**: When a challenge is accepted, `acceptChallenge()` now allocates a unique room ID (prefixed `CH-`) and stores it on the challenge record. Both players have a concrete destination to join. Accept response returns `roomId` for immediate navigation.
2. **Rematch System (`server/social.ts`)**: Full rematch model — `proposeRematch()`, `acceptRematch()`, `declineRematch()` with 3-minute expiry, duplicate prevention, self-rematch rejection, and room allocation on acceptance. New `rematches` SQLite table with indexes.
3. **WebSocket Challenge Room Join (`server/multiplayer/roomManager.ts`)**: New `join_challenge_room` message type. First player creates the room with predetermined ID; second player joins and game auto-starts. Handles reconnection, full-room, and in-progress edge cases.
4. **Availability Status Model**: Lightweight player status (`online | in_match | in_queue | offline`) derived from in-memory room and matchmaking state. Callback-based architecture avoids circular imports between social.ts and roomManager.ts.
5. **Social API Extensions (`server/routes/social.ts`)**: 8 new endpoints — rematch CRUD (propose/accept/decline/list/detail), availability (single + batch), accepted challenges listing. Accept endpoints return `roomId`. Batch availability capped at 50 users.
6. **Social Hub Rewrite (`src/pages/SocialHub.tsx`)**: New Active tab showing joinable matches with gradient "Join Match" CTA. Inbox shows rematch requests with "Accept & Play" action. Following list has availability status badges (colored dots + labels). Notifications emphasize `match_ready` and `rematch_accepted` types.
7. **Multiplayer Integration**: `useMultiplayer.ts` hook gains `joinChallengeRoom()` action. `MultiplayerRoom.tsx` handles `?challengeRoom=ROOMID` URL parameter for auto-connect → auto-join → auto-start flow.
8. **Match-Ready Notifications**: Two new notification types — `match_ready` ("Join the match now") and `rematch_accepted`. Challenger receives both standard acceptance and actionable match-ready notifications.
9. **Safety Boundaries Preserved**: All existing trust guarantees maintained — auth/session validation, stake compatibility, wallet/escrow safety, server-authoritative engine, Trust Shield fairness. No bypass paths introduced.
10. **Testing**: 41 new tests covering challenge room allocation (3), accepted listing (3), match-ready notifications (1), rematch flow (6), rematch decline (2), duplicate prevention (1), self-rematch (1), rematch detail access (2), availability API (3), batch availability (3), validation errors (2), room ID format (1), edge cases (2), and regression (11). Total: **770 tests across 27 files, all passing.**
11. **Zero Regressions**: All 729 pre-existing tests continue to pass alongside the 41 new challenge-match tests.

### Challenge-to-Match Flow Architecture

```
Challenge: create → pending → accept → room allocated (CH-XXXXXX) → both navigate → WS join → game starts
Rematch:   propose → proposed → accept → room allocated (CH-XXXXXX) → both navigate → WS join → game starts
```

### Known Limitations (Not Overclaimed)

- Staked challenge rooms: room creation uses free stake by default; wiring challenge stakeId through to room join is deferred
- No rematch button in game-over overlay — rematches initiated from Social Hub
- Availability status is WS-connection-scoped — HTTP-only sessions show as "offline"
- No challenge room TTL — stale accepted challenges remain joinable indefinitely

## 34. Broadcast Productization, Spectator Preferences & Live Operations Sprint Summary

The Broadcast Productization sprint (March 14, 2026) turned the spectator MVP into a full broadcast layer:

1. **Admin Featured-Match Operations**: Four new admin endpoints — list all live matches with metadata, feature/unfeature matches, and broadcast metrics summary. Admin featuring respects player consent — cannot override opt-out preferences.
2. **Player Spectate Preferences (Durable)**: New `player_spectate_preferences` SQLite table with `allow_spectating` toggle. PlayersScan opt out of spectating for non-tournament matches. Tournament matches always remain public by rule. Two new API endpoints for get/set preference.
3. **Broadcast Analytics**: In-memory tracking (peak concurrent, unique spectators) during live matches with durable persistence to `broadcast_metrics` table on match completion. Records admin-featured status, match duration, winner, and stake level.
4. **Discovery Surface Enhancement**: FeaturedMatches page gains tabbed Live/History layout, "Admin Pick" badges, broadcast history table, and spectate preference toggle with privacy explanation.
5. **Admin Dashboard Enhancement**: New "Broadcast" tab with summary cards, live match list with feature/unfeature buttons, eligibility reasoning, and recent broadcast metrics table.
6. **Privacy Invariants Preserved**: SpectatorGameView remains independently constructed. No hidden card leakage. Admin cannot override player consent. Tournament always public.
7. **Testing**: 35 new spectator tests (74 total in spectator.test.ts) covering preferences (11), analytics (8), admin broadcast API (11), and regressions. Total: **872 tests across 29 files, all passing.**
8. **Zero Regressions**: All 837 pre-existing tests continue to pass.

## 35. Featured Matches & Privacy-Safe Spectator MVP Sprint Summary

The Spectator MVP sprint (March 14, 2026) added the first real public-watch layer to Gin Paradise:

1. **Privacy-Safe Spectator View (`server/multiplayer/spectator.ts`)**: Dedicated spectator module with `getSpectatorView()` that projects only public game state (scores, turns, card counts, top discard) from `MatchState`. Uses a separate `SpectatorGameView` type — NOT a filtered `PlayerGameView` — ensuring no field inheritance can leak hidden cards. Hands revealed only at showdown (round_over/game_over).
2. **Featured Match Eligibility**: Conservative first-pass rules — tournament matches (always), high-stakes games (gold_2000+, sweeps), admin-featured rooms, and ranked matches (both players ≥1400 Elo). Free and private matches excluded by default.
3. **Spectator WebSocket Protocol**: Four new message types — `watch_match` (client→server), `leave_spectate` (client→server), `spectator_update` (server→client with SpectatorGameViewWire), `spectator_match_over` (server→client). Plus `spectator_joined`/`spectator_left` notifications to players with live counts.
4. **Room Manager Integration (`server/multiplayer/roomManager.ts`)**: Spectator WS connections tracked in `spectatorConnections` map. `broadcastSpectatorView()` called on every game state update and showdown. Automatic cleanup on match end, room cleanup, and spectator disconnect. Eligibility check on join; players cannot spectate their own match.
5. **Featured Matches API (`server/routes/spectator.ts`)**: `GET /api/spectator/featured` — public endpoint (no auth) returning live featured matches with player info, scores, reasons, spectator counts, and stake info. Sorted by spectator count descending.
6. **Featured Matches Page (`src/pages/FeaturedMatches.tsx`)**: Auto-refreshing (10s) discovery surface at `/live`. Match cards with player ratings, scores, reason badges (Tournament/High Stakes/Featured/Top Ranked), spectator counts, prize pools. "Watch Live" CTA. Empty state explains eligibility. Privacy info footer.
7. **Spectator Watch Page (`src/pages/SpectatorView.tsx`)**: Live read-only board showing score board with turn indicators, card table (stock face-down, discard top card), card counts, showdown reveals, stake info. "LIVE" badge, spectator count, "Read-only mode" indicator. Clean error/disconnect/match-over states.
8. **useSpectator Hook (`src/lib/useSpectator.ts`)**: React hook managing spectator WebSocket lifecycle — auto-connects on roomId, sends `watch_match`, handles `spectator_update`/`spectator_match_over`, auto-disconnects on unmount.
9. **Navigation Integration**: "Live" nav item added to Layout with Tv icon. MultiplayerRoom.tsx checks for `?watch=ROOMID` and renders SpectatorView.
10. **Anti-Leak Boundaries**: No weakening of server authority. `SpectatorGameView` built independently of `PlayerGameView`. No hidden-hand leakage path. No spectator interaction (one-directional WS). Trust Shield and escrow completely unaffected.
11. **Testing**: 39 new tests covering privacy safety (7), featured eligibility (11), spectator tracking (6), featured matches API (2), data shape (5), and regression coverage (8). Total: **837 tests across 29 files, all passing.**
12. **Zero Regressions**: All 798 pre-existing tests continue to pass alongside the 39 new spectator tests.

### Spectator Architecture

```
Discovery:  GET /api/spectator/featured → list of eligible live matches
Watch:      Navigate /play/multiplayer?watch=ROOMID → SpectatorView → useSpectator hook → WS watch_match
Broadcast:  Game action → engine → broadcastGameState → broadcastSpectatorView (parallel)
Privacy:    MatchState → getSpectatorView() → SpectatorGameView (card counts only, no identities)
Showdown:   round_over/game_over → showdown data attached to spectator_update (melds, deadwood visible)
```

### Known Limitations (Spectator MVP)

- No spectator chat, emotes, or interaction (by design)
- No admin UI for featuring matches (API exists; panel integration deferred)
- No player opt-in/opt-out toggle (rule-based eligibility only)
- No spectator analytics or engagement metrics
- Hidden-hand reveal during live play permanently excluded (core privacy guarantee)

## 36. Profit-Optimized Coin Economy & Billing Pivot Sprint Summary

The Coin Economy & Billing Pivot sprint (March 14, 2026) completed the strategic transition from a sweepstakes dual-currency platform to a profit-oriented single-coin economy with real billing:

1. **Single Coin Economy**: Converged from dual-currency (Gold + Sweeps) to a single non-redeemable coin. Signup bonus reduced to 5,000 coins. Daily check-in reduced to 500 coins. All sweepstakes terminology removed from API, UI, and documentation. Legacy `sweeps_coins` DB column retained (always 0) for migration safety.
2. **Stake Ladder Expansion**: Removed `sweeps_1` preset. Added `gold_100` (100 coins) and `gold_10000` (10,000 coins) tiers. Renamed "Free Play" → "Practice." Full ladder: Practice (0), 100, 500, 2000, 5000, 10000 coins — all with 5% rake.
3. **Turn Timer Presets**: New `TimerSpeed` system with Fast (20s), Medium (30s), Slow (40s) presets. Per-room timer speed tracking. Default: Medium. Timer speed carried through matchmaking queue to room creation.
4. **Matchmaking Posture**: New `MatchPosture` type — `like_rated` (tight brackets) vs `wider_field` (1.5× bracket expansion for faster matches). Parameters flow from lobby UI through queue to match creation.
5. **Coin Package Billing (Stripe)**: 5 purchasable coin packages ($4.99–$89.99) with escalating volume bonuses (0%–94%). Stripe checkout session integration. Dry-run mode when `STRIPE_SECRET_KEY` absent. Idempotent fulfillment with duplicate protection. Durable audit trail via `coin_purchase` transaction type.
6. **Premium Subscription Billing (Stripe)**: $9.99/month premium subscription via Stripe. Non-pay-to-win — coaching/analytical tools only. Subscription activation calls `grantPremium()` from existing entitlements system. Dry-run mode for development.
7. **Billing API**: 6 new endpoints — package catalog, plan catalog, purchase initiation, subscription initiation, purchase history, and billing status. Rate limited (5 actions per 60 seconds).
8. **Frontend Pivot**: Wallet page rebuilt with coin package purchase UI. Premium page updated with real "Subscribe Now — $9.99/mo" button. Multiplayer lobby shows single coin balance and expanded stake picker. Admin dashboard updated for single-currency revenue display. All spectator/tournament/featured match pages show "Coins" instead of currency-conditional labels.
9. **Economy Design**: Daily check-in (500 coins) enables 1 competitive match per day — habit-forming but not purchase-undermining. Signup bonus (5,000 coins) provides ~10 competitive matches to learn the platform. Zero-coin players can still do: AI play, practice matches, tutorials, spectating, daily check-in. Cannot enter coin-wagered PvP or staked tournaments.
10. **Testing**: All 9 affected test files updated for single-coin economy. Timer test timing corrected for 30s default. QueueEntry type updated with optional `timerSpeed` and `matchPosture` fields. **872/872 tests across 29 files, all passing.**
11. **Zero Regressions**: All pre-existing tests continue to pass alongside the economy pivot changes.

### Business Model Summary

| Element | Value |
|---------|-------|
| Signup Bonus | 5,000 coins |
| Daily Check-In | 500 coins |
| Stake Ladder | Practice (0), 100, 500, 2000, 5000, 10000 coins |
| Rake | 5% on all non-practice matches |
| Coin Packages | $4.99 (5K), $9.99 (12K), $24.99 (35K), $49.99 (80K), $89.99 (175K) |
| Premium Sub | $9.99/month (coaching tools, never pay-to-win) |
| Billing Provider | Stripe (dry-run mode without credentials) |

### Known Limitations (Billing Pivot)

- ~~Stripe webhook handler not yet implemented~~ ✅ DONE — `/api/webhooks/stripe` with signature verification, deduplication, and idempotent fulfillment
- ~~Timer speed and matchmaking posture selector UI not yet rendered in lobby~~ ✅ DONE — Both selectors visible in lobby with active-state styling
- Legacy `sweeps_coins` column retained in DB for migration safety

## 37. Revenue Hardening & Lobby Completion Sprint Summary

The Revenue Hardening sprint (March 14, 2026) completed the monetization surface for production reliability and administrative visibility:

1. **Stripe Webhook Endpoint (`server/routes/webhooks.ts`)**: New `POST /api/webhooks/stripe` endpoint handles `checkout.session.completed`, `invoice.paid`, and `customer.subscription.deleted` events. HMAC-SHA256 signature verification with 5-minute replay protection. Returns 200 to Stripe even on processing errors to prevent unwanted retries. `GET /api/webhooks/stripe/status` reports billing mode and supported events.
2. **Billing Module Enhancement (`server/billing.ts`)**: Rewritten with `billing_sessions` table (full lifecycle: pending → completed/failed/cancelled/refunded), `billing_events` table (webhook deduplication keyed by Stripe event ID), `processWebhookEvent()` for idempotent event routing, `verifyWebhookSignature()` with replay protection, and `cancelSubscription()` for entitlement revocation.
3. **Subscription Lifecycle**: `checkout.session.completed` grants premium for plan duration, `invoice.paid` extends premium (renewal), `customer.subscription.deleted` revokes immediately. All fulfillment is idempotent — double-fulfillment returns `alreadyFulfilled: true` with no side effects.
4. **Coin Purchase UX (`Wallet.tsx`)**: Billing mode banner ("Development Mode" when `STRIPE_SECRET_KEY` absent), URL-based purchase feedback (`?purchase=success/cancelled` from Stripe redirect), clean URL history stripping.
5. **Commercial Lobby Controls (`MultiplayerRoom.tsx`)**: Timer Speed selector (Fast 20s / Medium 30s / Slow 40s) and Matchmaking Posture selector (Like Rated / Wider Field with 1.5× bracket expansion) now rendered in a `grid-cols-2` layout below stake selection with clear active-state styling.
6. **Admin Billing Visibility (`admin.ts` + `AdminDashboard.tsx`)**: Three new admin endpoints — billing summary (mode + revenue + session counts), webhook events (audit log), and billing sessions (enriched with username + premium status). New "Billing" tab in admin dashboard with mode indicator, revenue cards, session table, and webhook event table.
7. **Admin Dashboard UI**: 5th tab added with billing mode indicator (Dry-Run/Live with color coding), coin purchase revenue card (amber), subscription revenue card (violet), session status card, billing sessions table with type/status/amount/premium columns, and webhook events table with event type/status/details.
8. **Test Infrastructure**: Updated test helpers to register billing and webhook routes. Added `initBillingTables()` to test setup.
9. **Testing**: 41 new tests covering billing module (4), coin purchase fulfillment (4), subscription fulfillment (4), webhook event processing (5), webhook signature verification (2), billing API routes (9), webhook endpoint (3), admin billing visibility (4), billing stats (2), and regression coverage (4). Total: **913 tests across 30 files, all passing.**
10. **Zero Regressions**: All 872 pre-existing tests continue to pass alongside the 41 new billing tests.

### Revenue Architecture

```
Stripe Checkout → Stripe fires webhook → POST /api/webhooks/stripe
    → verifyWebhookSignature() (HMAC-SHA256 if secret configured)
    → processWebhookEvent() checks billing_events for dedup
    → Dispatch: checkout.session.completed → fulfillCoinPurchase() / fulfillSubscription()
               invoice.paid → fulfillSubscription() (renewal)
               customer.subscription.deleted → cancelSubscription()
    → Record in billing_events table (always, success or failure)
    → Return 200 to Stripe
```

### Known Limitations (Revenue Hardening)

- Raw request body access for Stripe signature verification requires `express.raw()` middleware (not yet configured for raw body passthrough — signature verification works but raw body must be preserved)
- Legacy `sweeps_coins` column retained in DB for migration safety
- No Stripe customer portal integration for self-service subscription management

## 38. Unified Activation Funnel Sprint Summary

The Unified Activation Funnel sprint (March 14, 2026) turned the existing dashboard, daily, wallet, and match-entry systems into one coherent monetization and retention funnel:

1. **Economy Ledger Collision Fix (`server/ledger.ts`, `server/dailyRetention.ts`)**: Added 4 new `TransactionType` values (`daily_grant`, `streak_reward`, `mission_reward`, `puzzle_reward`). Daily retention rewards no longer reuse `faucet`, fixing the bug where streak/mission/puzzle claims consumed the wallet faucet cooldown. Faucet cooldown now correctly scopes to actual `faucet` transactions only.
2. **Canonical Daily Claim Architecture**: Daily Hub is the single canonical daily-return surface. Wallet demoted to ledger + commerce (no competing daily CTA). Dashboard shows prominent "Claim Today" banner when unclaimed, directing to Daily Hub. Daily status visible from all three surfaces, claimable from one.
3. **Economy-First Dashboard (`Dashboard.tsx`)**: Redesigned above-the-fold experience: bankroll indicator with affordable stake visibility, daily claim banner, Quick Match as primary CTA (before AI play), low-balance nudge directing to Wallet/Daily Hub, daily progress summary.
4. **Match Entry Commercialization (`MultiplayerRoom.tsx`)**: Default stake changed from `free` to `gold_100` (commercial intent). Auto-selects highest affordable stake. Recommended stake indicator based on bankroll. Low-balance guidance with links to earn/buy coins.
5. **Wallet Conversion Framing (`Wallet.tsx`)**: Coin packages now show gameplay-framed value ("≈ X entries at 100 coins", play duration estimates). 16 differentiated transaction labels with icons. Low-balance guidance with re-entry path. Premium upsell card. Dev mode banner preserved.
6. **Navigation Prioritization (`Layout.tsx`)**: Primary tier (Play, Daily, Wallet, Premium) and secondary tier. Mobile nav limited to 5 tabs (Play, Daily, Wallet, Premium, Profile). All features preserved, hierarchy improved.
7. **Testing**: 14 new tests covering ledger collision fix (5), faucet cooldown isolation (3), transaction type taxonomy (1), and regression (5). **959 tests across 32 files, all passing.**
8. **Zero Regressions**: All 945 pre-existing tests continue to pass.

### Daily Economy Re-Entry Math

| Daily Activity | Coins Earned |
|---|---|
| Streak check-in (Day 1) | 50 |
| Daily check-in mission | 50 |
| Additional mission (avg) | ~75 |
| Daily puzzle (base) | 100 |
| **Minimum daily total** | **~275 coins** |

A busted player re-enters the 100-coin stake tier in a single daily session. Max daily free earnings (~575 coins) support 5 staked matches, conservative enough to not devalue purchases.

## 39. Daily Retention Loop Sprint Summary

The Daily Retention Loop sprint (March 14, 2026) added three interlocking daily retention subsystems:

1. **Daily Missions System (`server/dailyRetention.ts`)**: 10 mission templates across 4 categories (engagement, competitive, training, social). Deterministic 4-mission daily selection via hash of (userId + date). Daily check-in mission always included. Progress tracking and bounded rewards (50–200 coins per mission).
2. **Streak Progression System**: Check-in tracking with escalating 8-tier reward schedule (Day 1: 25 coins → Day 30+: 500 coins cap). Gap-tolerant reset logic. Double-check-in prevention per day.
3. **Daily Puzzle System**: 8 hand-scenario puzzle definitions with optimal play determination. Base 100 coins + 50 optimal bonus + 25 premium analysis bonus. SQLite-backed history (7 days free, 30 days premium).
4. **Economy Guard**: Maximum daily free earnings ~1,275 coins (at max streak with premium). A player earning maximum daily retention rewards needs ~4 days to match the cheapest coin package ($4.99) — maintaining purchase incentive.
5. **Daily Hub Page (`src/pages/DailyHub.tsx`)**: Canonical daily-return surface with animated streak section, mission grid with progress bars, interactive puzzle with card display, reward summary, and premium upsell.
6. **API Routes**: 7 new endpoints — daily summary, streak check-in, mission claim, puzzle get/submit/claim, puzzle history. All rate limited and economy-bounded.
7. **Testing**: 32 new tests covering missions (5), streaks (5), puzzles (7), economy validation (4), premium boundaries (2), and regression (5). Total: **945 tests across 31 files, all passing.**
8. **Zero Regressions**: All 913 pre-existing tests continue to pass.

## 40. First-Purchase Optimization, Starter Offers & Offer Analytics Sprint Summary

The First-Purchase Optimization sprint (March 14, 2026) built a durable commercial offer layer to increase first-paid conversion and premium subscription starts:

1. **Offer System Foundation (`server/offers.ts`)**: Server-authoritative offer engine with named catalog, typed contents (coins, premium trial days), eligibility rules (beforeFirstPurchase, requiresFree, oneTimeOnly, account age gates), and atomic fulfillment in SQLite transactions.
2. **Starter Bundle**: $4.99 starter offer with 15,000 coins + 7-day Pro trial (67% discount vs standard value). One-time per account, only before first purchase, free tier only.
3. **Free Premium Trial**: $0 premium trial offer with 7-day Pro access. One-time per account, free tier only.
4. **Offer API Routes (`server/routes/offers.ts`)**: 7 new endpoints — list eligible offers, offer details + eligibility, impression/dismiss/click tracking (surface-tagged), server-authoritative redemption with rate limiting (10/min), user offer state.
5. **Interaction Analytics**: Full funnel tracking via `offer_interactions` table — impressions, dismissals, clicks, and purchases with surface tagging (dashboard, wallet). Dismiss cooldown (4 hours) and impression caps (50 per offer) prevent spam.
6. **Contextual Offer Surfaces**: Dashboard shows full-width gradient banner between daily rewards and play area. Wallet shows compact offer card above coin packages. Both surfaces support dismiss, redeem, and success/error feedback.
7. **Offer Fulfillment**: Coins granted via dedicated `offer_purchase` transaction type (distinguishable from standard `coin_purchase`). Premium trial via `grantPremium()`. One-time enforcement via `UNIQUE INDEX` on `offer_redemptions(user_id, offer_id)`. Re-validates eligibility at redemption time.
8. **Admin Visibility**: 3 new admin endpoints — offer analytics (impressions, clicks, purchases, revenue, conversion/dismiss rates), recent redemptions with user details, and full catalog with eligibility rules.
9. **Anti-Abuse**: Server-authoritative eligibility (client never bypasses), one-time redemption via DB constraint, before-first-purchase check against billing sessions, duplicate trial prevention, rate limiting.
10. **Testing**: 30 new tests covering offer catalog (4), interaction tracking (5), redemption + fulfillment (3), one-time enforcement (4), analytics (1), fresh user eligibility (2), premium trial standalone (3), and regression coverage (8). Total: **989 tests across 33 files, all passing.**
11. **Zero Regressions**: All 959 pre-existing tests continue to pass.

### Offer Architecture

```
Discovery:    GET /api/offers → eligible offers for user (filtered by eligibility, dismiss cooldown, impression cap)
Presentation: Dashboard banner (high awareness) + Wallet card (high intent)
Tracking:     impression → dismiss/click → purchase (all surface-tagged)
Redemption:   POST /api/offers/:id/redeem → re-check eligibility → SQLite transaction:
                mutateBalance(offer_purchase) + grantPremium(duration) + insertRedemption(unique)
Admin:        GET /api/admin/offers/analytics → conversion funnel metrics
```

### Starter Offer Economics

| Attribute | Starter Bundle | Premium Trial |
|---|---|---|
| Price | $4.99 | Free |
| Coins | 15,000 | 0 |
| Premium Trial | 7 days | 7 days |
| Standard Value | $14.98 | $9.99 |
| Discount | 67% | 100% |
| Eligibility | Before first purchase, free tier | Free tier only |
| Enforcement | One-time per account | One-time per account |

## 41. Gameplay Table Layout & Board UX Polish Sprint Summary

The table layout sprint (March 14, 2026) restructured the spatial hierarchy of the Gin Paradise play surface for a polished, competitive card-game feel:

1. **Compact Header Chrome**: Header reduced from 56px to 44px. Controls, icons, and badges shrunk by one tier. Game message hidden on mobile to save space.
2. **Upper Table Zone (NEW)**: Stock/Discard moved to a compact **upper-left rail** and opponent area anchored to the **upper-right**, both in a single `flex justify-between` row. This replaces the old stacked layout where Stock/Discard dominated the center.
3. **Open Table Center**: Dedicated `flex-1` spacer creates intentional visual breathing space between the upper zone and the player's hand, directing focus downward.
4. **Dominant Player Hand**: Player hand area now commands the bottom zone with tighter action-button spacing, increased bottom padding, and more vertical room above.
5. **Background Texture**: Radial gradient updated to a subtle emerald-tinted felt-table character (`from-emerald-950/20`).
6. **Multiplayer Consistency**: Identical spatial hierarchy applied to `MultiplayerRoom.tsx` — matching header, upper zone, open center, and dominant player area.
7. **Reduced opponent visual weight**: Opponent hidden cards scaled to 65–80% (from 75–100%), card overlap tightened from 20px to 18px, card size reduced.
8. **SpectatorView intentionally unchanged** — different layout paradigm (no interactive hand to rebalance).
9. **Verification**: TypeScript clean, production build succeeds (2284 modules), **33/33 test files pass** (1001+ tests).
10. **Zero Regressions**: All pre-existing tests continue to pass. All gameplay functionality preserved.

## 42. Visual Overhaul — Color Palette, Card Design & Card Backs Sprint Summary

The visual overhaul sprint (March 14, 2026) transformed the Gin Paradise play surface from a tech-dashboard aesthetic into a premium card-lounge experience:

1. **Color Palette Overhaul**: Table surface changed from `zinc-950` to deep emerald felt with vignette gradient. Header chrome shifted from cold zinc to warm dark wood. Primary accent color changed from `indigo-500` to `amber-500/400` gold across all interactive elements (draw indicator, card selection, buttons, badges).
2. **Card Back Design**: Branded burgundy (`#5c1a2f`) card backs with gold (`#d4a843`) border gradient, diamond lattice pattern, "GIN PARADISE" text in Georgia serif, corner diamond ornaments. Mini variant for opponent's overlapping cards.
3. **Card Front Redesign**: Removed traditional pip layouts (tested and rejected across 3 iterations). Final design uses clean "big index" approach optimized for online gin rummy — large bold rank + suit symbol left-aligned for overlap visibility, colored accent stripe (3px, suit-colored) for instant scanning, faded suit watermark on exposed cards.
4. **PlayingCard (Discard)**: Large centered rank + suit for maximum impact, subtle corner indices, accent stripe for visual consistency.
5. **New Component: `getSuitAccentColor()`**: Returns hex color for red/dark accent stripes, with four-color mode support.
6. **Layout Tightening**: Row heights reduced to 118px, hand panel container added (`bg-[#0d2b1c]/50`), tighter row gaps, increased stock/discard breathing room.
7. **Design Rationale**: Emerald felt = card table (not SaaS dashboard). Gold accents = premium warmth. Burgundy backs = complementary to green (max pop). Big index = 3× faster recognition than pip counting at 88px card width with 60% overlap.
8. **Verification**: TypeScript `npx tsc --noEmit` — zero errors. HMR verified across all changes. Screenshots captured at each stage.
9. **Zero Regressions**: All gameplay functionality preserved — card selection, discard, knock, meld highlights, drag-and-drop all unchanged.

## 43. Multiplayer Visual Parity & Shared Card System Sprint Summary

The visual parity sprint (March 15, 2026) unified the emerald felt / warm gold palette across all play surfaces and eliminated card component duplication:

1. **Shared Card Visual System (`src/components/cards/index.tsx`)**: Extracted 7 card renderers (PlayingCard, OverlappingCard, SuitRowCard, CardBack, ShowdownCardMini, SpectatorCard, MiniCard) and design constants (TABLE_FELT_GRADIENT, TABLE_NOISE_STYLE, etc.) into a single shared module. All game pages now import from this one file, eliminating visual drift.
2. **MultiplayerRoom Full Parity**: Every phase — lobby, searching, waiting room, active game, showdown, game-over — ported to the emerald felt + warm gold palette. All zinc/indigo references removed. Opponent hidden cards use branded CardBack. Stock/discard draw cues use amber instead of indigo. Player avatars use emerald/teal gradient.
3. **SpectatorView Alignment**: Background changed to emerald felt with noise texture. Header, error, connecting, and match-over states all use the emerald palette. Stock pile uses branded burgundy/gold design. Shared SpectatorCard and MiniCard imported from card module. Local component definitions removed.
4. **GameRoom Shared Imports**: Replaced ~270 lines of local card component definitions with single import from shared module. Showdown overlays themed to emerald/gold.
5. **Selection & State Consistency**: Card selection rings, draw affordances, turn indicators, and action buttons consistently use amber across all surfaces. Knock badges use emerald. Meld/layoff highlights untouched (already consistent).
6. **Ten Visual Inconsistencies Removed**: Cold zinc backgrounds → emerald felt; carbon-fiber card backs → branded Gin Paradise backs; indigo rings → amber rings; indigo/purple avatars → emerald/teal; zinc overlays → emerald overlays; indigo action buttons → amber; separate card defs → shared module; cold spectator background → emerald felt; cold waiting-room → emerald felt; zinc lobby → emerald felt.
7. **Non-Game Pages Deferred**: Wallet, SocialHub, Replays, Tournaments still use indigo accents — outside the play-surface scope.
8. **Verification**: TypeScript `npx tsc --noEmit` — zero errors. Systematic indigo audit shows 0 references in game files.
9. **Zero Regressions**: All gameplay functionality preserved — drag/reorder, selection logic, discard/knock flows, timers, trust shield, showdown correctness.
