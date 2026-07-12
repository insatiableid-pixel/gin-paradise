# Directive 101 - Renewable Lease Heartbeat Sprint

## Objective
Replace deterministic failover cleanup with short renewable room and timer leases so abrupt owner loss can hand off naturally after lease expiry.

## Why This Sprint
Directive 100 proved that real gameplay could continue on a successor node, but it still needed manual room/timer lease cleanup in the test to make the room reclaimable. The highest-leverage next step was to make that handoff path real: the owning node should keep leases fresh while alive, and a successor should be able to reclaim the room automatically when those leases stop renewing.

## Required Deliverables
1. Update `gin-galaxy/server/multiplayer/roomManager.ts` so room ownership uses short renewable leases with a background renewal loop for rooms owned by the current node.
2. Update `gin-galaxy/server/multiplayer/turnTimer.ts` so active turn timers use short renewable leases instead of one lease for the whole turn, and stop the local timer if the node loses timer ownership.
3. Extend `gin-galaxy/tests/redisAppHarness.ts` so app-process Redis tests can simulate an abrupt crash and pass per-process env overrides for lease timing.
4. Upgrade `gin-galaxy/tests/redisCoordinator.appFailover.test.ts` so it kills the owner without graceful cleanup, waits for natural room/timer lease expiry, reconnects through the successor, and proves gameplay continues.
5. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so the repo truthfully describes renewable lease-expiry handoff as proven and narrows the remaining gap accordingly.
6. Add `EXECUTION_REPORT_101.md` describing what changed and how it was verified.

## Constraints
- Keep the handoff path honest: do not claim a stronger failure detector than “renewable leases expire when the owner stops renewing.”
- Preserve graceful shutdown behavior; this sprint adds abrupt-owner-loss recovery rather than replacing clean handoff.
- Use repo evidence only and keep the proof deterministic enough for CI.

## Verification
Run, at minimum:
- `npm run lint`
- `npx vitest run tests/competitive-integrity.test.ts`
- `REDIS_URL=redis://127.0.0.1:6379 npx vitest run --no-file-parallelism --maxWorkers=1 tests/redisCoordinator.appFailover.test.ts`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Completion Criteria
The sprint is complete when abrupt owner loss no longer depends on manual lease cleanup, the surviving node can reclaim the room after natural lease expiry and continue live play, and the docs/report describe the remaining crash-window gap honestly.
