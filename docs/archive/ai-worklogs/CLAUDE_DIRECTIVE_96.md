# Directive 96 - Redis Restart Soak Proof

## Goal
Prove the next strongest resilience step in Redis mode: repeated coordinator restarts can preserve room ownership, recover expired timer snapshots, and continue relaying live room actions without state drift.

## Required Work
1. Add a deterministic Redis-backed restart-soak proof that exercises several restart cycles on the owner node.
2. The proof must show, in one bounded test flow:
   - persisted room ownership survives disconnect/reconnect cycles,
   - each expired timer snapshot is recovered again after the restart,
   - live room actions still relay successfully after each recovery cycle.
3. Use real Redis-backed coordinator instances and stable node IDs. Do not fake the coordinator boundary.
4. Update the Redis test lane wiring if a new test file is added.
5. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so they describe the restart-soak proof truthfully and keep the remaining gap focused on production-scale soak and chaos automation.

## Acceptance Criteria
- `npm run lint` passes.
- `npm test` passes.
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis` passes.
- The repo root contains the new execution report for this directive.

## Constraints
- Keep the proof deterministic and bounded.
- This is a soak proof, not a full chaos framework.
