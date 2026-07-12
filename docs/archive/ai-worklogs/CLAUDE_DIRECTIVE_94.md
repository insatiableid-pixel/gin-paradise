# Directive 94 - Redis Failover Rehearsal

## Goal
Prove the next bounded failover step in Redis mode: when the original room owner disappears, a successor node can reclaim the expired room lease, recover the persisted timer snapshot, and continue relaying room actions through the new owner.

## Required Work
1. Add a deterministic Redis-backed failover rehearsal test. Prefer a dedicated test file if that keeps the intent clearer, but keep the scope narrow.
2. The rehearsal must prove all of the following in one bounded flow:
   - an expired room lease can be reclaimed by a successor node,
   - an expired timer snapshot is restored on the successor and the timeout count is carried forward,
   - a room action can still be relayed through the successor after takeover.
3. Use real Redis-backed coordinator instances and stable node IDs. Do not fake the coordinator boundary or introduce broad chaos tooling yet.
4. Update the Redis test lane wiring if a new test file is added.
5. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so they describe this failover rehearsal truthfully and keep the remaining gap focused on production-scale soak and chaos automation.

## Acceptance Criteria
- `npm run lint` passes.
- `npm test` passes.
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis` passes.
- The repo root contains the new execution report for this directive.

## Constraints
- Keep the proof deterministic and short-running.
- Do not claim full production chaos coverage; this is a rehearsal, not a soak harness.
