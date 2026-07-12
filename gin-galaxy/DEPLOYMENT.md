# Gin Paradise — Deployment Guide

> **Audience:** A technically basic operator deploying Gin Paradise for the first time.
> **Architecture:** Single-instance Node.js server with SQLite by default. Optional Redis-backed realtime coordinator for shared multiplayer state, live room-action and spectator relay, clean shutdown handoff, turn-timer recovery, renewable room/timer lease heartbeats, deterministic failover rehearsal, failover churn proof, restart-soak proof, bounded chaos-matrix proof, burst-load proof, quieter shutdown/restart behavior, a real two-process app smoke proof, a bounded two-process abrupt-owner-loss gameplay proof, a bounded endurance-soak proof, and an awaited durable room-snapshot commit barrier for critical gameplay actions.

---

## What You Need

| Requirement           | Details                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js**           | v18+ (recommended: v20 LTS or newer)                                                                                                                      |
| **Persistent disk**   | Required — the SQLite database file must survive restarts                                                                                                 |
| **WebSocket support** | Required — the multiplayer game uses WebSocket connections                                                                                                |
| **Single instance**   | The default supported path. Keep one app instance for the simplest deployment; Redis-backed coordinator mode exists for bounded shared-state experiments. |
| **Memory**            | ~128 MB minimum. A 512 MB instance is comfortable for a small beta.                                                                                       |

---

## Quick Start (Local)

```bash
cd gin-galaxy
cp .env.example .env          # Edit to add your GEMINI_API_KEY (optional)
npm install                    # Install dependencies (first time only)
npm run dev                    # Starts dev server on http://localhost:3000
```

---

## Production Deployment

### Supported production topology

Run exactly **one Gin Paradise application process** against its SQLite file.
This is the only production topology currently supported. Redis coordinator
mode proves room relay, authoritative leases, timer recovery, and bounded
failover scenarios, but it does not make SQLite safe for concurrent writers and
does not provide cross-node matchmaking or distributed HTTP rate limiting.

Do not horizontally scale the application tier until the primary database,
matchmaking ownership, and rate limiter have moved to shared services. Redis
multi-process lanes are resilience/integration proofs, not an autoscaling
deployment contract.

### 1. Build the Frontend

```bash
cd gin-galaxy
npm install
npm run build                  # Compiles React/Vite to ./dist/
```

### 2. Configure Environment

Create a `.env` file (or set environment variables directly in your hosting platform):

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_PATH=/data/database.sqlite    # Use your persistent disk path
TRUST_PROXY=true                        # Required behind Render/Railway/Fly/nginx
COORDINATOR_NODE_ID=gin-paradise-01     # Stable identity for this deployment slot
GEMINI_API_KEY=your-key-here            # Optional — only affects AI analysis
STRIPE_SECRET_KEY=your-stripe-key        # Required only when billing is enabled
STRIPE_WEBHOOK_SECRET=your-webhook-secret # Required in every production deployment
```

### 3. Start the Server

```bash
npm start
# or equivalently:
NODE_ENV=production tsx server.ts
```

The server will:

- Print a configuration summary to stdout
- Serve the pre-built frontend from `./dist/`
- Listen on the configured port (default: 3000)
- Accept WebSocket connections on `/ws`
- Recover active turn timers from coordinator snapshots for rooms owned by this node
- Respond to health checks on `/api/health`

---

## Environment Variables

| Variable                             | Default             | Required                                | Description                                                                                                                               |
| ------------------------------------ | ------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                           | `development`       | No                                      | Set to `production` to serve static files instead of Vite dev server                                                                      |
| `PORT`                               | `3000`              | No                                      | HTTP server port                                                                                                                          |
| `HOST`                               | `0.0.0.0`           | No                                      | Bind address. Use `127.0.0.1` to restrict to localhost.                                                                                   |
| `DATABASE_PATH`                      | `./database.sqlite` | **Yes** (for persistent deployments)    | Path to the SQLite database file. Must be on persistent storage.                                                                          |
| `TRUST_PROXY`                        | `false`             | **Yes** (behind reverse proxy)          | Set to `true` for correct IP resolution behind a reverse proxy                                                                            |
| `COORDINATOR_NODE_ID`                | _(generated)_       | **Yes** (with `COORDINATOR_MODE=redis`) | Stable per-instance coordinator identity. Keep it consistent across restarts so live-room ownership and spectator relay survive recovery. |
| `ROOM_OWNER_LEASE_TTL_MS`            | `15000`             | No                                      | Optional room-owner lease TTL in milliseconds. Lower values speed up abrupt-owner-loss handoff but require more frequent renewals.        |
| `ROOM_OWNER_LEASE_RENEW_INTERVAL_MS` | `5000`              | No                                      | Optional renewal cadence for room-owner leases. Keep it comfortably below `ROOM_OWNER_LEASE_TTL_MS`.                                      |
| `TURN_TIMER_LEASE_TTL_MS`            | `15000`             | No                                      | Optional active-turn lease TTL in milliseconds. Lower values speed up timer handoff after owner loss.                                     |
| `TURN_TIMER_LEASE_RENEW_INTERVAL_MS` | `5000`              | No                                      | Optional renewal cadence for active-turn leases. Keep it comfortably below `TURN_TIMER_LEASE_TTL_MS`.                                     |
| `GEMINI_API_KEY`                     | _(empty)_           | No                                      | Google Gemini API key for AI match analysis. Without it, analysis returns a structured fallback. All gameplay works without it.           |
| `ALLOWED_ORIGINS`                    | _(empty)_           | No                                      | Comma-separated CORS origins if serving frontend from a different domain                                                                  |
| `STRIPE_SECRET_KEY`                  | _(empty)_           | No                                      | Stripe API key. Without it, billing stays in dry-run mode.                                                                                |
| `STRIPE_WEBHOOK_SECRET`              | _(empty)_           | **Yes in production**                   | Stripe endpoint signing secret. Production startup fails if it is absent; signed payload bytes are verified before JSON parsing.          |

---

## Health Check

```
GET /api/health
```

Returns:

```json
{
  "status": "healthy",
  "timestamp": "2026-03-11T22:30:00.000Z",
  "uptime": 3600,
  "version": "1.0.0-beta",
  "database": "connected",
  "deployment": {
    "coordinatorMode": "redis",
    "liveRoomRouting": "multi_node_relay"
  },
  "coordinator": {
    "mode": "redis",
    "healthy": true,
    "nodeId": "gin-paradise-01",
    "rooms": 3,
    "players": 6,
    "spectators": 1,
    "snapshots": 2
  },
  "environment": "production"
}
```

Use this endpoint for platform health checks (Render, Railway, Fly, etc.) and uptime monitoring. It is unauthenticated and does not expose secrets.

---

## Platform-Specific Guidance

### Render

1. **Build Command:** `npm install && npm run build`
2. **Start Command:** `npm start`
3. **Environment:** Set `NODE_ENV=production`, `TRUST_PROXY=true`, and `DATABASE_PATH` to a path on the persistent disk
4. **Disk:** Attach a persistent disk and set `DATABASE_PATH` to a path on it (e.g., `/data/database.sqlite`)
5. **Health Check:** Set the health check path to `/api/health`
6. **WebSocket:** Render supports WebSockets by default on Web Services

### Railway

1. **Build Command:** `npm install && npm run build`
2. **Start Command:** `npm start`
3. **Environment:** Set `NODE_ENV=production`, `TRUST_PROXY=true`
4. **Volume:** Attach a volume and set `DATABASE_PATH` to a path on the volume
5. **WebSocket:** Railway supports WebSockets by default

### Fly.io

1. **Dockerfile:** Use a Node.js base image, copy the project, run `npm install && npm run build`
2. **Environment:** Set via `fly secrets set NODE_ENV=production TRUST_PROXY=true`
3. **Volume:** Create a volume and mount it; set `DATABASE_PATH` to a path on the mount
4. **Scaling:** Run exactly 1 instance (`fly scale count 1`)

### VPS with nginx

1. Run the app directly with `npm start`
2. Configure nginx to proxy HTTP and WebSocket:

```nginx
server {
    listen 80;
    server_name ginparadise.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

3. Set `TRUST_PROXY=true` in the app's environment
4. Use a process manager like systemd or PM2 to keep it running:

```bash
# PM2 example:
pm2 start "npm start" --name gin-paradise
pm2 save
```

---

## WebSocket Notes

- The app uses WebSockets on the `/ws` path for real-time multiplayer
- Clients exchange their authenticated HTTP session for a random, single-use WebSocket ticket. The ticket expires after 30 seconds and only its SHA-256 hash is stored; reusable session IDs never enter proxy URLs or access logs.
- Common reverse proxy issue: make sure your proxy passes the `Upgrade` and `Connection` headers
- The app handles WebSocket upgrades manually on the HTTP server, so it works correctly with both Vite HMR (dev) and static serving (prod)
- `COORDINATOR_MODE=redis` uses the shared coordinator boundary for multi-process live-room resilience tests: relay, spectator updates, recovery metadata, authoritative renewable leases, and bounded failover/soak proofs.
- `COORDINATOR_MODE=redis` also requires a stable `COORDINATOR_NODE_ID`; Redis room ownership metadata uses it so restarted processes can keep the same identity.
- Live rooms are owner-gated, and the server relays live room actions and spectator/watch updates across nodes when a client lands on the non-owning process.
- The live-room story is now relay-capable, lease-reclaim-aware, backed by renewable room/timer lease heartbeats, failover-rehearsed, churn-proofed, restart-soak proven, quiet under disconnect/reconnect churn, smoke-tested across two live app processes, boundedly proven to continue gameplay on a successor after abrupt owner loss via natural lease expiry, covered by a seeded multi-room fault matrix across mixed room topologies and alternating crash order, and exercised by a heavier bounded endurance-soak lane, but truly larger-scale sustained soak and broader long-running chaos automation remain integration milestones.
- Use `npm run test:redis:soak` when you want the heavier bounded soak path without running the entire Redis verification matrix.

---

## SQLite Notes

- **Single instance only.** SQLite is not designed for concurrent writes from multiple processes. Run exactly one instance of the server.
- **WAL mode** is enabled by default for better read performance during concurrent operations.
- Wallet, transaction, rake, and escrow arithmetic is authoritative in integer hundredths. Legacy `REAL` columns remain mirrored only for schema compatibility.
- Match escrows and settlement state are durable SQLite records keyed by room. Settlement/refund is transactional and idempotent, and startup reconciliation refunds holds whose room did not survive recovery.
- **Database file must be on persistent storage.** On platforms like Render or Railway, ephemeral file systems will lose data on restart. Attach a persistent disk or volume.
- **Backup:** To back up the database, copy the `database.sqlite`, `database.sqlite-wal`, and `database.sqlite-shm` files. Alternatively, use SQLite's `.backup` command.

---

## Graceful Shutdown

The server handles `SIGTERM` and `SIGINT` gracefully:

1. Stops accepting new HTTP connections
2. Closes all WebSocket client connections
3. Clears background timers (session purge, room cleanup)
4. Releases active room/timer ownership metadata for rooms owned by this node, while leaving Redis snapshots intact for recovery
5. Closes the SQLite database connection
6. Exits after a 2-second drain period

This makes it safe to deploy behind process managers (PM2, systemd) and container orchestrators (Docker, Kubernetes).

---

## Admin Access

Admin accounts are provisioned via direct database update (intentionally — no self-service admin promotion):

```sql
sqlite3 database.sqlite "UPDATE users SET is_admin = 1 WHERE username = 'your_admin_username';"
```

Admin endpoints at `/api/admin/*` are read-only and require both a valid session and the `is_admin` flag.

---

## Realtime Coordinator

Gin Paradise uses a **Realtime Coordinator** to manage live multiplayer state (rooms, player membership, spectator connections, leases, matchmaking queue mirrors, and live match snapshots). The coordinator is a pluggable boundary - multiplayer code depends on the coordinator interface, not on a specific storage backend. Memory is the default mode. Redis mode now uses real Redis I/O, pub/sub, shared state, replayable match snapshots for reconnect/failover recovery, a stable coordinator identity, owner-gated live-room handoff hints when a socket lands on the wrong node, lease-expiry reclamation, renewable room/timer lease heartbeats, deterministic failover rehearsal, failover churn proof, restart-soak proof, representative burst-load proof for relay/reclaim traffic, clean shutdown ownership release, bounded chaos coverage in the default Redis lane, quieter disconnect handling for stale async writes, node-aware relay for live room and spectator messages, successor timer recovery on room adoption, relay-shadowed room-state freshness during recovery, bounded app-soak coverage, bounded endurance-soak coverage, and a seeded two-process fault-matrix proof across mixed room topologies and alternating crash order.

### Coordinator Modes

| Mode               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `memory` (default) | In-process Maps. Zero external dependencies. Perfect for local dev and single-instance production.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **Fully supported**            |
| `redis`            | Redis-backed shared state with pub/sub, queue mirroring, leases, live match snapshots, room-ownership handoff hints, lease-expiry reclamation, renewable room/timer lease heartbeats, clean-shutdown ownership release, deterministic failover rehearsal, failover churn proof, restart-soak proof, bounded chaos coverage, relay-capable live room and spectator messages, representative burst-load proof, a two-process app smoke proof, bounded app-soak proof, bounded endurance-soak proof, a seeded mixed-topology fault-matrix proof, a bounded two-process abrupt-owner-loss gameplay proof, quieter disconnect behavior, successor timer recovery on room adoption, and a stable `COORDINATOR_NODE_ID` per deployment slot. Live Redis integration, failover, churn, restart-soak, chaos, load, smoke, app-failover, app-soak, endurance-soak, and fault-matrix proof passed. | **Proven in live Redis tests** |

### Configuration

| Variable                             | Default        | Description                                                                                                                            |
| ------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `COORDINATOR_MODE`                   | `memory`       | Set to `redis` to use the Redis-backed coordinator with shared state, pub/sub, and live match snapshots. Requires a live Redis server. |
| `REDIS_URL`                          | _(none)_       | Required when `COORDINATOR_MODE=redis`. Redis connection string (e.g. `redis://localhost:6379`).                                       |
| `REDIS_KEY_PREFIX`                   | `ginparadise:` | Key namespace prefix for all coordinator keys in Redis.                                                                                |
| `COORDINATOR_NODE_ID`                | _(generated)_  | Required when `COORDINATOR_MODE=redis`. Stable per-instance identity used by room ownership, recovery, and spectator relay.            |
| `ROOM_OWNER_LEASE_TTL_MS`            | `15000`        | Optional room-owner lease TTL. Short renewable leases make abrupt-owner-loss handoff faster.                                           |
| `ROOM_OWNER_LEASE_RENEW_INTERVAL_MS` | `5000`         | Optional room-owner lease renewal cadence.                                                                                             |
| `TURN_TIMER_LEASE_TTL_MS`            | `15000`        | Optional active-turn lease TTL. Short renewable leases make timer takeover faster.                                                     |
| `TURN_TIMER_LEASE_RENEW_INTERVAL_MS` | `5000`         | Optional active-turn lease renewal cadence.                                                                                            |

### Health Check

The `/api/health` endpoint now includes coordinator diagnostics:

```json
{
  "deployment": {
    "coordinatorMode": "memory",
    "liveRoomRouting": "single_node"
  },
  "coordinator": {
    "mode": "memory",
    "healthy": true,
    "nodeId": "memory-1234",
    "rooms": 3,
    "players": 6,
    "spectators": 1,
    "snapshots": 2
  }
}
```

### What is Proven vs. Integration-Only

**Proven (tested, running in default mode):**

- Coordinator interface and contract suite
- MemoryCoordinator full implementation
- RedisCoordinator real Redis I/O, shared snapshots, pub/sub, and lease propagation
- Live match snapshot persistence and hydration through the coordinator
- Room ownership admission control, lease-expiry reclamation, structured handoff hints for live rooms, and clean shutdown ownership release
- Renewable room-owner and active-turn lease heartbeats keep live ownership fresh and allow natural lease-expiry handoff after abrupt owner loss
- Representative burst-load proof for relay and lease-reclaim traffic
- Bounded chaos-matrix proof for restart/reconnect recovery and alternating ownership using real Redis lease transfer semantics
- Two-process app smoke plus bounded app failover gameplay proof with successor room adoption, timer recovery, and continued play after abrupt owner loss via natural lease expiry
- Critical gameplay lifecycle surfaces now wait for a durable room-snapshot commit in Redis mode, and bounded app-process proofs show post-discard, match-start, and forced-end owner crashes still recover the correct successor state
- Bounded two-process app soak proof shows repeated abrupt owner churn across multiple live rooms while gameplay continues after each recovery
- Bounded two-process endurance-soak proof shows repeated seeded multi-room failover cycles across both nodes while gameplay continues after each recovery phase
- Seeded two-process fault-matrix proof shows mixed local/split room topologies, alternating crash order, survivor-connected sockets, and reconnect-driven reclaim all recover cleanly while gameplay continues after takeover
- Relay-delivered room-state shadowing keeps fresher live state from being overwritten by stale coordinator cache during successor recovery
- Stale async Redis persistence and publish work is suppressed cleanly during disconnect/reconnect instead of emitting misleading closed-client noise
- Factory instantiation, config parsing, startup validation
- Full regression suite passes in default mode

**Integration-only (bounded follow-up work):**

- Truly larger production-scale end-to-end multi-node soak and broader long-running chaos automation beyond the current bounded app-soak, endurance-soak, and seeded fault-matrix lanes

---

## Durable Outbox & Background Worker

Gin Paradise uses a **durable outbox pattern** to decouple non-critical, retryable secondary work from the synchronous gameplay hot path. All background jobs are persisted to SQLite — they survive process restarts and are retried automatically on failure.

### Write-Path Policy

| Category                      | Examples                                                                                                                    | Behavior                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Authoritative Synchronous** | Wallet mutations, escrow holds/settlements, billing fulfillment, replay persistence, match outcomes, tournament advancement | Must complete atomically. Failure = user-visible error.                                                          |
| **Derived Asynchronous**      | Replay auto-evaluation, broadcast metrics, coaching cache warmup, achievement triggers                                      | Routed through durable outbox. Retryable, eventually-consistent. Failure = background retry, never user-visible. |

### How It Works

1. When a match completes, the **replay persistence** (authoritative) executes synchronously
2. Follow-up work (evaluation, achievements) is **enqueued** into the `outbox_jobs` SQLite table
3. The **outbox worker** polls the table every 2 seconds and dispatches jobs to registered handlers
4. Failed jobs are **retried** with exponential backoff (max 5 attempts)
5. Poison jobs (exceeded max retries) are marked **"dead"** and stop retrying
6. Completed jobs are **cleaned up** automatically after 24 hours

### Health Check

The `/api/health` endpoint now includes outbox worker diagnostics:

```json
{
  "outboxWorker": {
    "running": true,
    "jobsProcessed": 142,
    "jobsFailed": 3,
    "lastPollAt": "2026-03-25T19:30:00.000Z",
    "pollCycles": 1847,
    "registeredHandlers": [
      "replay_auto_evaluation",
      "broadcast_metrics_persist",
      "achievement_trigger",
      "coaching_cache_warmup"
    ],
    "diagnostics": {
      "pending": 0,
      "processing": 0,
      "completed": 139,
      "failed": 0,
      "dead": 3,
      "total": 142
    }
  },
  "databaseHardening": {
    "walMode": true,
    "busyTimeout": 5000,
    "foreignKeys": true
  }
}
```

### SQLite Hardening (New)

The following SQLite pragmas are now explicitly set:

- **busy_timeout = 5000** — wait up to 5s for write lock (prevents `SQLITE_BUSY` from worker contention)
- **foreign_keys = ON** — enforce foreign key constraints
- **wal_autocheckpoint = 1000** — standard WAL auto-checkpoint
- **journal_size_limit = 64MB** — prevent unbounded WAL growth

---

## What This Architecture Does NOT Support (Yet)

| Limitation                              | Workaround                                                                                                                                                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Horizontal scaling (multiple instances) | **Not a supported production topology.** The Redis resilience proofs do not make the process-local matcher, limiter, or SQLite writer distributed. Run one application process until those dependencies move to shared services.                                           |
| Cross-node matchmaking                  | The expanding rating window is re-evaluated every 30 seconds, but pairing remains process-local because live WebSocket handoff is not yet a supported contract. Route queue traffic to one matchmaking node; Redis mirrors queue state for diagnostics/deduplication only. |
| Distributed HTTP rate limiting          | The supported deployment is one SQLite-writing application process. Its limiter is a true in-memory sliding window. A future horizontally scaled HTTP tier must move rate limits and the primary database to shared services first.                                        |
| Live Redis coordinator                  | Proven against a live Redis instance in integration tests; use it for bounded multi-node coordination and recovery, not as a finished autoscaling recipe yet.                                                                                                              |
| PostgreSQL                              | Not needed for a single-node beta. Migrate when real scale demands it.                                                                                                                                                                                                     |
| Automated database migrations           | Migrations run on startup automatically.                                                                                                                                                                                                                                   |
| HTTPS termination                       | Use your reverse proxy or platform (Render/Railway do this for you).                                                                                                                                                                                                       |
| Automated backups                       | Copy the SQLite file. Set up a cron job if needed.                                                                                                                                                                                                                         |

Durable multiplayer commits intentionally remain on the gameplay input path. Monitor
`gin_paradise_coordinator_commit_duration_ms_avg`,
`gin_paradise_coordinator_commit_duration_ms_max`, and
`gin_paradise_coordinator_commit_failures_total` at `/api/metrics` before placing
Redis in another region.

---

## GEMINI_API_KEY (AI Analysis)

The Gemini API key is **completely optional**. Without it:

- All gameplay features work normally
- AI-powered match analysis returns a structured fallback with match statistics and general tips
- The server logs a note at startup indicating analysis is in fallback mode

To enable full AI analysis:

1. Get an API key at https://aistudio.google.com/apikey
2. Add `GEMINI_API_KEY=your-key-here` to your `.env` file or environment
3. Restart the server
