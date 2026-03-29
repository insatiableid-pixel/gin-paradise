# CLAUDE DIRECTIVE 93 - Redis Relay & Reclaim Load Proof

## Goal
Add a bounded but meaningful load-soak proof for Redis mode so the repo demonstrates bursty multi-node relay and lease-reclaim behavior under concurrent pressure.

## Scope
- Add a dedicated Redis load test lane that stresses coordinator relay and lease reclamation at the same time.
- Prove that many concurrent room-action relays can complete without losing responses.
- Prove that many expired room leases can be reclaimed by a successor node in a burst.
- Wire the new load proof into the Redis test script so it runs with the existing Redis integration checks.
- Update project status and deployment docs so they describe the new load proof honestly.

## Must-Haves
- The load proof must run only when `REDIS_URL` is present.
- Keep the existing Redis integration tests intact.
- Use a deterministic, bounded concurrency level so the test is stable in CI and local runs.
- Do not claim production-scale soak or chaos automation is complete.

## Verification
- `npm run lint`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Output
- Update `PROJECT_STATUS.md` with the new sprint summary.
- Update `gin-galaxy/DEPLOYMENT.md` to mention representative load proof.
- Write `EXECUTION_REPORT_93.md` after implementation.
