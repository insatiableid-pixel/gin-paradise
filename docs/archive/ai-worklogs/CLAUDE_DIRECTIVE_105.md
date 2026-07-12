# Directive 105 - Seeded Fault Matrix Sprint

## Objective
Add a heavier bounded Redis app-process fault-matrix lane that proves multi-room recovery across mixed room topologies, alternating crash order, survivor-connected sockets, and reconnect-driven reclaim.

## Why This Sprint
Directive 104 proved a bounded multi-room app soak, but it still exercised one main churn path. The next highest-leverage move was to widen the recovery matrix without pretending we had already reached true production-scale chaos. Gin Paradise needed a deterministic way to prove that different room shapes and failover patterns all recover cleanly at the real two-process app layer, not just through coordinator fixtures or a single soak storyline.

## Required Deliverables
1. Add a new Redis app-process fault-matrix suite that runs multiple seeded scenarios with:
   - local-owner rooms,
   - split-node rooms,
   - pre-advanced turn state,
   - alternating node crash order.
2. Prove both recovery styles inside the same lane:
   - survivor-connected sockets continue cleanly after takeover,
   - reconnect-driven recovery reclaims rooms and resumes play.
3. Harden runtime recovery where needed so recoverable rooms can be reclaimed proactively when a survivor still has connected local participants.
4. Integrate the new seeded matrix into `npm run test:redis`.
5. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so the repo now says bounded seeded fault-matrix proof is live, while keeping truly larger production-scale soak and longer-running chaos automation as the remaining gap.
6. Add `EXECUTION_REPORT_105.md` describing what changed and how it was verified.

## Constraints
- Keep the matrix deterministic and CI-stable.
- Do not over-claim production-scale certification.
- Preserve the already-green Redis integration, failover, churn, restart-soak, load, smoke, app-failover, app-soak, and chaos lanes.
- Prefer real app-process evidence over metadata-only shortcuts.

## Verification
Run, at minimum:
- `npm run lint`
- `REDIS_URL=redis://127.0.0.1:6379 npx vitest run --no-file-parallelism --maxWorkers=1 tests/redisCoordinator.faultMatrix.test.ts`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Completion Criteria
The sprint is complete when the repo has a seeded mixed-topology fault matrix integrated into the standard Redis lane, runtime recovery stays stable under that matrix, and the docs/report describe the remaining larger-scale gap honestly.
