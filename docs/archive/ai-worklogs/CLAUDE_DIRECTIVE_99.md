# Directive 99 - Redis Shutdown Hygiene Sprint

## Objective
Harden the Redis coordinator shutdown path so disconnect and reconnect cycles stop producing misleading closed-client persistence noise, while keeping the Redis proof lane truthful and easy to run.

## Why This Sprint
The Redis relay, failover, soak, smoke, and chaos proofs were already green, but restart-oriented runs still surfaced a real quality gap: stale async best-effort writes could race with `disconnect()` and log fake failures like `The client is closed`. That kind of noise obscures real issues and weakens confidence in the restart-soak story.

## Required Deliverables
1. Update `gin-galaxy/server/multiplayer/redisCoordinator.ts` so best-effort Redis persistence and pub/sub work capture a valid client context, suppress stale closed-client errors after disconnect/reconnect invalidates that context, and continue logging unexpected active-context failures.
2. Add a focused Redis integration regression test in `gin-galaxy/tests/redisCoordinator.integration.test.ts` that forces a persistence write to straddle `disconnect()` and proves we do not emit fake closed-client room-persistence errors.
3. Fold the bounded chaos matrix into the standard Redis verification lane in `gin-galaxy/package.json` so `npm run test:redis` covers integration, failover, churn, restart-soak, load, smoke, and chaos together.
4. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so the repo truthfully describes the cleaner shutdown behavior and the current Redis test lane.
5. Add `EXECUTION_REPORT_99.md` describing what changed and how it was verified.

## Constraints
- Keep the fix narrow: do not weaken real error visibility just to silence logs.
- Use repo evidence only; do not invent Redis features that are not already implemented.
- Preserve the deterministic Redis proof lane.

## Verification
Run, at minimum:
- `npm run lint`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Completion Criteria
The sprint is complete when the stale closed-client noise is suppressed without masking active failures, the Redis lane stays green with chaos coverage included, and the docs/status/report all match the verified result.
