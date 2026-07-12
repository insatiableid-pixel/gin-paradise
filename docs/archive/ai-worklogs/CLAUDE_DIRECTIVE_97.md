# Directive 97 - Multi-Node App Smoke Sprint

## Objective
Prove the Redis live-room path at the actual app level, not just at the coordinator layer, by starting two real `gin-galaxy` server processes in Redis mode and driving them with real HTTP + WebSocket clients.

## Why This Sprint
The repository already proves relay, failover, churn, restart-soak, and load behavior inside the coordinator boundary. The remaining gap is broader end-to-end multi-node validation: we need one bounded smoke that shows the production server processes can cooperate through Redis exactly as the docs claim.

## Required Deliverables
1. Add a new Redis-gated smoke test, ideally `gin-galaxy/tests/redisCoordinator.multiNodeSmoke.test.ts`, that:
   - starts two production-mode server processes with distinct `PORT` and `COORDINATOR_NODE_ID` values,
   - uses a temp SQLite database path and a unique Redis key prefix,
   - verifies `/api/health` on both nodes reports `coordinatorMode: redis` and `liveRoomRouting: multi_node_relay`,
   - registers/logs in real users over HTTP,
   - creates a room on node A,
   - joins that room from node B and proves the relay succeeds without `room_handoff_required`,
   - makes the room spectatable by repo-evidenced means,
   - watches the match from node B and proves spectator notifications/update relays work across nodes,
   - drives at least one real player action from node B that is relayed to the owning node,
   - cleans up both server processes and temp files deterministically.
2. Wire the new smoke test into `gin-galaxy/package.json` so `npm run test:redis` includes it in the serialized Redis lane.
3. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so they truthfully say multi-node app-level smoke validation is now proven, while production-scale chaos automation / long-duration soak remains future work.
4. Add an `EXECUTION_REPORT_97.md` describing what changed and how it was verified.

## Constraints
- Keep the smoke bounded and deterministic. One strong smoke is better than an unstable mini-chaos suite.
- Use repo evidence only. Do not invent API behavior or deployment requirements that are not present in the codebase.
- Prefer real app processes and real WebSocket clients over mocks for this sprint.
- Keep the Redis lane single-worker and file-serialized if needed for stability.

## Verification
Run, at minimum:
- `npm run lint`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Completion Criteria
The sprint is complete when the smoke test passes against two live app processes, docs/status are updated, and the execution report records the exact verification results.
