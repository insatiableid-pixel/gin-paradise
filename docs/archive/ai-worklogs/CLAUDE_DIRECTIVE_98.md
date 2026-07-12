# Directive 98 - Chaos Matrix Sprint

## Objective
Turn the Redis proof set from "smoke + failover + restart soak + load" into a deterministic app-level chaos matrix that mixes node restarts and Redis interruptions while two real `gin-galaxy` server processes are live.

## Why This Sprint
Directive 97 proved that two production-mode app processes can cooperate through Redis. The remaining gap is not another single scenario; it is a bounded, repeatable chaos harness that shakes the multi-node relay/failover path in a few high-value ways before we call the live-room story robust enough for broader production-scale soak.

## Required Deliverables
1. Add a new Redis-gated chaos test, ideally `gin-galaxy/tests/redisCoordinator.chaosMatrix.test.ts`, that:
   - starts two production-mode server processes in Redis mode with distinct `PORT` and `COORDINATOR_NODE_ID` values,
   - uses a temp SQLite database path and a unique Redis key prefix,
   - runs a small seeded matrix of scenarios, such as:
     - owner process restart during live play,
     - joiner process restart during live play,
     - Redis disconnect/reconnect between live actions,
     - multi-room churn with alternating ownership,
   - verifies after each disruption that:
     - health eventually recovers,
     - room ownership and leases are reclaimed,
     - active turn timers recover from snapshots,
     - room actions still relay across nodes,
     - no unexpected `room_handoff_required` or `error` messages appear in the successful paths,
   - cleans up both server processes and temp files reliably, even when a scenario fails.
2. Reuse the existing Redis test harness patterns where it helps, but do not duplicate logic unnecessarily. If a small shared helper extraction materially reduces brittleness, make it.
3. Wire the new chaos test into the npm test flow in the least disruptive way. Prefer keeping `npm run test:redis` deterministic and reasonably fast; if the chaos matrix would make that lane too heavy, add a dedicated `npm run test:redis:chaos` script and keep the main Redis lane stable.
4. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so they truthfully describe the new chaos coverage and the remaining gap after it.
5. Add an `EXECUTION_REPORT_98.md` describing what changed and how it was verified.

## Constraints
- Keep the scenarios bounded and seeded.
- Use real app processes and real Redis.
- Use repo evidence only. Do not invent behaviors that are not already supported by the codebase.
- Prefer clarity and repeatability over raw breadth. One well-designed chaos matrix is better than a fragile fuzz storm.

## Verification
Run, at minimum:
- `npm run lint`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Completion Criteria
The sprint is complete when the chaos matrix passes reliably, the docs and status are updated, and the execution report records the exact verification results.
