# Directive 95 - Redis Failover Churn Proof

## Goal
Prove the next highest-leverage resilience step in Redis mode: multiple rooms can fail over together, their expired timer snapshots can be recovered on the successor, and live room actions can still relay after takeover.

## Required Work
1. Add a deterministic Redis-backed churn proof that exercises several rooms in parallel.
2. The proof must show, in one bounded test flow:
   - a burst of expired room leases can be reclaimed by the successor node,
   - each room’s expired timer snapshot is recovered and its timeout count advances exactly once,
   - room actions still relay successfully after takeover for every room in the burst.
3. Use real Redis-backed coordinator instances and stable node IDs. Do not fake the coordinator boundary.
4. Update the Redis test lane wiring if a new test file is added.
5. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so they describe the new churn proof truthfully and keep the remaining gap focused on production-scale soak and chaos automation.

## Acceptance Criteria
- `npm run lint` passes.
- `npm test` passes.
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis` passes.
- The repo root contains the new execution report for this directive.

## Constraints
- Keep the test deterministic and bounded.
- Do not turn this into a broad chaos harness yet; this is still a proof, not a soak framework.
