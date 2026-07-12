# Directive 104 - App Churn Soak Sprint

## Objective
Add a bounded production-style Redis app soak that proves repeated abrupt owner churn across multiple live rooms at the real app-process layer, not just through coordinator fixtures or single-room failover proofs.

## Why This Sprint
Directive 103 closed the last high-value abrupt-crash lifecycle surfaces, but the next remaining gap was no longer correctness of one room or one crash boundary. The repo still needed a stronger proof that repeated owner loss across more than one live room could recover cleanly and keep gameplay moving at the actual app-process layer. The highest-leverage next step is a deterministic multi-room churn soak that stays stable enough for CI while exercising the real multi-node recovery path harder than the current single-room app failover lane.

## Required Deliverables
1. Add a new Redis app-process soak test that starts two real Gin Paradise servers, creates multiple live rooms across both nodes, and survives repeated abrupt owner churn with gameplay still advancing after recovery.
2. Make the soak deterministic and bounded: use short renewable leases, explicit crash/restart order, and concrete recovery assertions rather than fuzzy timing or random chaos.
3. Prove at least one recovery where a room migrates to the survivor, play advances, the original node restarts, and a later crash recovers multiple live rooms back onto that restarted node.
4. Add the new soak lane to `npm run test:redis` so it becomes part of the standard Redis verification story.
5. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so the repo now describes bounded app-process soak/churn proof as live, while keeping heavier production-scale soak and broader fault-matrix automation as the remaining gap.
6. Add `EXECUTION_REPORT_104.md` describing what changed and how it was verified.

## Constraints
- Keep the new soak lane deterministic enough to be reliable in CI and local runs.
- Do not replace the existing single-room app failover lane; extend coverage beyond it.
- Do not over-claim “production-scale” validation. The new proof should be described as bounded app-process soak, not final scale certification.
- Preserve the already-green Redis integration, failover, chaos, restart-soak, and abrupt-crash lifecycle proofs.

## Verification
Run, at minimum:
- `npm run lint`
- `REDIS_URL=redis://127.0.0.1:6379 npx vitest run --no-file-parallelism --maxWorkers=1 tests/redisCoordinator.appSoak.test.ts`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Completion Criteria
The sprint is complete when the repo has a bounded multi-room app-process churn soak proof integrated into the standard Redis lane, and the docs/report describe the remaining scale/automation gap honestly.
