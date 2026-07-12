# Directive 100 - App Failover Gameplay Sprint

## Objective
Move the Redis multi-node proof from coordinator-only takeover into a bounded two-process app-level gameplay failover path.

## Why This Sprint
The repo already had relay, reclaim, failover, churn, restart-soak, smoke, and chaos coverage at the coordinator boundary, but the next product-level question was sharper: can a real live game keep going after the owning app process disappears and a successor node takes over? That needed proof at the actual server/WebSocket/gameplay layer, not just inside coordinator fixtures.

## Required Deliverables
1. Update the multiplayer runtime so a node that adopts room ownership can recover that room’s active turn timer immediately instead of waiting for process startup.
2. Harden successor-state recovery so fresher relay-delivered room state cannot be overwritten by an older coordinator snapshot during takeover.
3. Keep Redis room ownership and lease-cache state aligned during snapshot replacement so reclaimed rooms do not stay blocked behind stale local lease entries.
4. Add focused test coverage for timer recovery after room ownership moves to the current node.
5. Add a bounded live Redis app-process failover proof that starts two real Gin Paradise servers, advances a live game, removes the owner through a deterministic lease-handoff path, reconnects through the successor, and proves play continues.
6. Update `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` so the repo truthfully describes bounded app failover gameplay proof and the remaining gaps.
7. Add `EXECUTION_REPORT_100.md` describing what changed and how it was verified.

## Constraints
- Use repo evidence only; do not claim autonomous dead-node detection if the proof depends on deterministic lease cleanup.
- Keep the proof bounded and deterministic rather than introducing flaky timing races.
- If the proof exposes a real correctness bug, fix the underlying bug instead of weakening the test.

## Verification
Run, at minimum:
- `npm run lint`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Completion Criteria
The sprint is complete when a successor node can adopt a live room, recover its timer, continue real gameplay in a two-process Redis proof, and the docs/report describe both the new proof and the remaining abrupt-owner-loss gap honestly.
