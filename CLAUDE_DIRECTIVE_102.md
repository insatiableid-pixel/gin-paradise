# Directive 102 - Action Commit Durability Sprint

## Objective
Close the immediate post-action crash window for critical multiplayer gameplay by adding a real durable room-snapshot commit barrier and proving it in a two-process Redis app failover path.

## Why This Sprint
Directive 101 made abrupt owner-loss handoff real through renewable room and timer leases, but the repo still had one sharp remaining weakness: gameplay actions mutated live state locally and relied on later best-effort snapshot persistence. If the owner crashed in that narrow window, a successor could inherit stale turn truth. The next highest-leverage step was to make the critical gameplay path wait for a real durable room-snapshot commit before outward success broadcast.

## Required Deliverables
1. Update `gin-galaxy/server/multiplayer/coordinator.ts`, `gin-galaxy/server/multiplayer/memoryCoordinator.ts`, and `gin-galaxy/server/multiplayer/redisCoordinator.ts` so the coordinator exposes an awaitable `commitRoomGameState(...)` path distinct from the existing best-effort snapshot setter.
2. In Redis mode, make that durable commit path write the room game snapshot to Redis before returning and keep the corresponding coordinator event consistent with the committed payload.
3. Update `gin-galaxy/server/multiplayer/roomManager.ts` so `draw`, `discard`, `knock`, and `next_round` commit a merged room snapshot durably after timer/timeout updates and before outward success broadcast.
4. Add a bounded, test-only crash hook that can kill the owner immediately after a durable gameplay-action commit so the proof hits the real crash boundary instead of a delayed approximation.
5. Extend `gin-galaxy/tests/redisCoordinator.appFailover.test.ts` with a new two-process proof where the owner crashes immediately after a durably committed `discard`, before broadcasting the result, and the successor still recovers the advanced turn and keeps play moving.
6. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so the repo truthfully describes bounded post-action crash durability as proven for the critical gameplay path, while keeping broader abrupt-crash coverage and scale gaps honest.
7. Add `EXECUTION_REPORT_102.md` describing what changed and how it was verified.

## Constraints
- Keep the scope bounded to the highest-value gameplay path; do not claim all abrupt-crash surfaces are now solved.
- Preserve memory-mode behavior and existing relay/failover proofs.
- Prefer a reusable merged-snapshot helper over hand-written per-action persistence.
- Keep the new crash hook test-only and one-shot so it cannot affect normal operation.

## Verification
Run, at minimum:
- `npm run lint`
- `REDIS_URL=redis://127.0.0.1:6379 npx vitest run --no-file-parallelism --maxWorkers=1 tests/redisCoordinator.appFailover.test.ts`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Completion Criteria
The sprint is complete when critical gameplay actions no longer depend on best-effort snapshot timing alone, the repo proves a post-discard abrupt owner crash still recovers the advanced turn on the successor, and the docs/report describe the remaining abrupt-crash and soak gaps honestly.
