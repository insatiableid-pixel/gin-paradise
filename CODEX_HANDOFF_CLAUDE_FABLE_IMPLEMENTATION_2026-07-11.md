# Codex Handoff — Claude Fable Audit Implementation

Date: 2026-07-11  
Workspace: `C:\Users\mrwat\OneDrive\Desktop\Gin Rummy`  
Application: `gin-galaxy/`

## Objective

Implement all actionable recommendations in
`Claude_Fable_5_Repo_Advice_7.11.2026.md`.

## Current State

The implementation is substantially complete and present in the working tree.
Do **not** reset, checkout, clean, or discard the existing changes. The original
working tree also contained untracked user files; preserve them.

One small TypeScript error remains from the final Redis test-harness update:

```text
tests/redisAppHarness.ts(299,78): error TS2345:
Argument of type 'unknown' is not assignable to parameter of type
'string | number | boolean'.
```

Fix it by retaining the narrowed ticket before entering the Promise callback:

```ts
if (typeof ticketPayload.ticket !== "string") {
  throw new Error("WebSocket ticket response did not contain a ticket");
}
const ticket = ticketPayload.ticket;

return new Promise((resolve, reject) => {
  const ws = new WebSocket(
    `${baseUrl.replace("http://", "ws://")}/ws?ticket=${encodeURIComponent(ticket)}`,
  );
```

This is the only known unfinished code fix.

## Implemented Work

### Billing and authentication security

- Fixed Stripe webhook signature verification for ESM by using a top-level
  `crypto` import instead of `require()`.
- Signature configuration is read dynamically for reliable tests.
- Production startup now fails closed without `STRIPE_WEBHOOK_SECRET`.
- Added valid-signature and tampered-payload tests.
- Malformed webhook JSON now returns HTTP 400.
- Raw webhook bytes remain intact until after signature verification.
- Registration no longer returns raw internal exception messages.
- Reusable session IDs were removed from WebSocket URLs.
- Added 30-second, random, hashed, single-use WebSocket tickets issued through
  authenticated `POST /api/auth/ws-ticket`.
- Multiplayer and spectator clients now obtain tickets before connecting.
- Added ticket replay/consumption coverage.
- `/api/auth/me` logs out only for authorization failures, not transient network
  errors.
- Added a client catch-all route and moved Express error middleware last.

Primary files include:

- `gin-galaxy/server/billing.ts`
- `gin-galaxy/server/config.ts`
- `gin-galaxy/server/websocketTickets.ts` (new)
- `gin-galaxy/server/routes/auth.ts`
- `gin-galaxy/server/routes/webhooks.ts`
- `gin-galaxy/src/lib/websocketTicket.ts` (new)
- `gin-galaxy/src/lib/useMultiplayer.ts`
- `gin-galaxy/src/lib/useSpectator.ts`
- `gin-galaxy/src/App.tsx`

### Durable and atomic economy

- Added durable SQLite `room_escrows` and `escrow_holds` tables.
- Holds, settlement, and refunds are immediate transactions and idempotent.
- Settlement status is durable across restart/failover.
- Startup reconciliation refunds orphaned holds while preserving recovered rooms.
- Wallet, transaction, rake, and escrow calculations now use authoritative
  integer hundredths.
- Legacy REAL columns are backfilled and synchronized by compatibility triggers.
- Faucet cooldown claim and credit are one immediate transaction.
- Match result rows and rating/stat changes are one transaction.
- Added wallet-versus-ledger reconciliation at startup.
- Added restart, duplicate hold/settlement, orphan refund, precision, drift, and
  legacy-write tests.

Primary files:

- `gin-galaxy/server/db.ts`
- `gin-galaxy/server/escrow.ts`
- `gin-galaxy/server/ledger.ts`
- `gin-galaxy/server/houseAccounting.ts`
- `gin-galaxy/server/multiplayer/roomManager.ts`
- `gin-galaxy/tests/escrow.test.ts`
- `gin-galaxy/tests/wallet.test.ts`

### Multiplayer correctness and Redis resilience

- Matchmaking rechecks expanding rating windows every 30 seconds.
- Cross-node matchmaking remains explicitly documented as process-local; Redis
  mirrors queue data, and deployments should use sticky/single-node matchmaking.
- Stale WebSocket close events cannot replace or forfeit a newer connection.
- Disconnect-forfeit callbacks check the exact disconnect generation.
- Timer ownership compares user IDs consistently via `myUserId`.
- Fixed per-round fairness transcript filtering by removing `|| true`.
- Equal-timestamp snapshots no longer overwrite applied state.
- Redis queue clearing uses SCAN rather than KEYS.
- Redis cold-start snapshots use `mGet` batches.
- Live-match rating lookup is batched instead of two queries per room.
- Added bounded client auto-reconnect.
- Added authoritative async lease claim/renew APIs and owner-checked Lua renewal.
- Existing synchronous callers explicitly tolerate late Redis revocation: rejected
  provisional claims emit a local `lease_released` event, and room/timer work is
  stopped or transferred.
- Added a real Redis two-node lease-race test.
- Added coordinator commit latency/failure metrics.
- During live Redis validation, timer recovery after provisional room adoption was
  hardened: recovery retries on owner-lease renewal and reconnect boundaries.

Primary files:

- `gin-galaxy/server/multiplayer/coordinator.ts`
- `gin-galaxy/server/multiplayer/memoryCoordinator.ts`
- `gin-galaxy/server/multiplayer/redisCoordinator.ts`
- `gin-galaxy/server/multiplayer/matchmaking.ts`
- `gin-galaxy/server/multiplayer/roomManager.ts`
- `gin-galaxy/server/multiplayer/turnTimer.ts`
- `gin-galaxy/server/observability.ts`
- `gin-galaxy/tests/redisCoordinator.integration.test.ts`
- `gin-galaxy/tests/redisAppHarness.ts`

### Quality gates and CI

- Coverage thresholds raised from 1% to:
  - statements 35%
  - branches 25%
  - functions 30%
  - lines 35%
- CI runs coverage instead of unmeasured tests.
- CI now provisions Redis and runs the complete Redis matrix.
- The Redis CI job has a test-only webhook signing secret because its harness
  starts production-mode server processes.
- Readiness audit inspects substantive lint/coverage/Redis controls and exits
  nonzero below target.
- Runtime `no-unused-vars` and `react-hooks/exhaustive-deps` are blocking errors.
- Cleaned 179 source lint errors without weakening or suppressing the rules.
- A true sliding-window limiter replaced the mislabeled fixed-window behavior.

Primary files:

- `.github/workflows/ci.yml`
- `gin-galaxy/eslint.config.js`
- `gin-galaxy/vitest.config.ts`
- `gin-galaxy/package.json`
- `gin-galaxy/scripts/readiness-audit.mjs`
- `gin-galaxy/server/middleware/rateLimit.ts`

### Documentation and repository hygiene

- Updated `.env.example`, deployment docs, and runbook for webhook secrets,
  one-time WebSocket tickets, durable integer economy, Redis latency metrics,
  sticky matchmaking, and single-process SQLite/rate-limit constraints.
- Deleted tracked `.edge-tmp/` crash dumps and ignored future crash artifacts.
- Archived tracked AI directive/execution logs under
  `docs/archive/ai-worklogs/`.
- Archived tracked `gin_rummy/`, `gin-core/`, `oracle_autoresearch/`, and `tools/`
  research sources under `docs/archive/research/`.
- Added `docs/archive/README.md`.
- Untracked generated `gin-core/target/` and `.idea/` were not moved or deleted;
  they are ignored.

Git will initially show the archive operation as many deletions plus untracked
additions. That is expected; once staged, Git can recognize the renames.

## Validation Already Completed

All results below were obtained after the main implementation landed.

- Full default Vitest suite: **1,089 passed, 0 failed, 25 skipped** across
  48 files. The skips were Redis-only tests without `REDIS_URL`.
- Coverage suite: **passed**.
  - Statements: 58.02%
  - Branches: 47.55%
  - Functions: 64.55%
  - Lines: 59.14%
- Live Redis matrix through a temporary Redis server in WSL:
  **11 files passed, 25/25 tests passed**.
  - The application and tests remained Windows Node processes.
  - WSL was used only to host temporary Redis on `127.0.0.1:6380`.
  - Redis was shut down afterward.
  - No WSL/Linux runtime dependency was added to the project.
- Playwright E2E: **4/4 passed**.
- Production Vite build: passed.
- Bundle budget: passed, 78 JS assets, 1,017,056 total JS bytes.
- `npm audit --audit-level=low`: 0 vulnerabilities.
- Secret scan: passed across 1,499 files.
- Readiness audit: Level 5, 100%.
- Full lint before the final harness edit: 0 errors, 262 non-gated warnings.
- `git diff --check`: passed before the last small harness/timer edits.

The live Redis run initially exposed two issues which were fixed:

1. Production child processes lacked a webhook secret and could not start.
   The harness and Redis CI job now use test-only secrets.
2. A recovered room could temporarily own the room without hydrating its timer;
   an initial fix caused recursive timeout recovery. The final implementation
   retries hydration during successful owner renewals and reconnect, avoiding
   recursion. Both failing scenarios then passed together, followed by the full
   25/25 Redis matrix.

## Exact Next Steps

Run from `gin-galaxy/` unless stated otherwise.

1. Apply the one-line narrowed `ticket` constant fix described at the top.
2. Run lightweight final gates:

```powershell
npm run typecheck
npx eslint . --quiet
npx vitest run tests/multiplayer.test.ts tests/redisCoordinator.integration.test.ts
npm run quality:readiness
```

3. Run final formatting/diff checks from the repository root:

```powershell
git diff --check
git status --short
```

4. The full expensive suites have already passed. Rerun only if further runtime
   changes are made:

```powershell
npm test
npm run test:coverage
npm run build
npm run quality:bundle
npm run test:e2e
```

5. If re-running Redis locally, the verified Windows/WSL procedure was:

```powershell
wsl -d Ubuntu -- bash -lc "redis-server --daemonize yes --port 6380 --save '' --appendonly no"
$env:REDIS_URL='redis://127.0.0.1:6380'
npm run test:redis
wsl -d Ubuntu -- redis-cli -p 6380 shutdown nosave
```

Capture the real `npm run test:redis` exit code before shutting Redis down; a
PowerShell `finally` block can otherwise leave the shell reporting only the
successful shutdown command.

## Working-Tree Safety

- Do not use `git reset --hard`, `git checkout --`, or `git clean`.
- Preserve the untracked source audit document:
  `Claude_Fable_5_Repo_Advice_7.11.2026.md`.
- Preserve any other pre-existing user artifacts.
- No commits or pushes were made.
