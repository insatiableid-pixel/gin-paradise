# Directive 103 - Start & Forced-End Crash Durability Sprint

## Objective
Extend the durable room-snapshot commit barrier beyond the bounded post-discard proof so match start and forced-end lifecycle crashes are also covered by real two-process Redis app proofs.

## Why This Sprint
Directive 102 closed the narrow post-action crash window for critical gameplay actions, but the repo still had two high-value abrupt-crash surfaces outside that proof: the moment a match transitions from waiting to playing, and the forced-end path that settles the match and cleans up timers after a disconnect/forfeit/timeout. Those are lifecycle boundaries where stale recovery would be especially user-visible, so the next highest-leverage step is to make both paths durably commit their room truth before outward broadcast and prove it with bounded app-level crash tests.

## Required Deliverables
1. Update `gin-galaxy/server/multiplayer/roomManager.ts` so `startMatchForRoom(...)` waits for a durable room snapshot after the first timer is started and before outward `game_started`/timer broadcast.
2. Update `gin-galaxy/server/multiplayer/roomManager.ts` so the forced-end / forfeit path waits for a durable finished-room snapshot after authoritative settlement, transcript/fairness updates, and timer cleanup, and before notifying the remaining player.
3. Make sure the durable room snapshot includes the live timer state needed for match-start recovery instead of relying on a later best-effort timer write.
4. Extend `gin-galaxy/tests/redisCoordinator.appFailover.test.ts` with bounded two-process crash proofs for `match_start` and `forced_end`, using the existing one-shot crash injection hook so the owner dies immediately after the durable commit and before outward broadcast.
5. If existing chaos coverage assumes metadata-only ownership moves, update `gin-galaxy/tests/redisCoordinator.chaosMatrix.test.ts` so it reflects real Redis lease semantics rather than papering over them.
6. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so the repo truthfully describes bounded abrupt-crash durability as proven for discard, match start, and forced end, while keeping production-scale soak / chaos automation as the remaining next gap.
7. Add `EXECUTION_REPORT_103.md` describing what changed and how it was verified.

## Constraints
- Keep the scope bounded to the highest-value lifecycle crash surfaces; do not claim every abrupt-crash edge is solved.
- Preserve the already-green abrupt-owner-loss, post-discard, restart-soak, churn, and chaos proofs.
- Prefer reusing the new durable commit barrier and crash hook instead of inventing a second persistence path.
- Keep the chaos harness honest: if ownership transfer now depends on real Redis leases, the tests must say so and behave that way.

## Verification
Run, at minimum:
- `npm run lint`
- `REDIS_URL=redis://127.0.0.1:6379 npx vitest run --no-file-parallelism --maxWorkers=1 tests/redisCoordinator.appFailover.test.ts`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Completion Criteria
The sprint is complete when the repo proves that a durably committed match start and a durably committed forced end both survive an immediate owner crash before outward broadcast, and the docs/report describe the remaining scale/chaos gap honestly.
