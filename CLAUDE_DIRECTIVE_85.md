# CLAUDE DIRECTIVE 85 - Authoritative Room Ownership and Handoff Hints

## Objective

Make Gin Paradise's live room path explicitly owner-aware so active-room joins, reconnects, and spectating only proceed on the node that owns the room lease. When a request lands on the wrong node, return a structured handoff hint that tells the client which node owns the room and that sticky sessions or equivalent affinity are required.

## Why This Is Next

Directive 84 proved that in-progress match state can survive a coordinator restart. The remaining production risk is split-brain access: if more than one node can accept an active room, shared snapshots are not enough. This directive makes room ownership authoritative before we attempt broader relay or load-balancer automation.

## Scope

1. Add a small room-affinity helper that decides whether a live room can be served locally and builds a structured handoff hint when it cannot.
2. Enforce that helper in `roomManager` for active-room reconnects, room joins, challenge-room joins, and `watch_match` spectator entry.
3. Emit a structured `room_handoff_required` server message with `roomId`, `ownerNodeId`, and a human-readable recovery message; update the browser hooks to surface it.
4. Keep memory mode as the default supported path and preserve single-node behavior.
5. Add tests that prove wrong-node admission is rejected and that the handoff payload includes the owner node id.
6. Update `PROJECT_STATUS.md` and deployment docs to state honestly that sticky sessions or equivalent affinity are still required for active room sockets until real cross-node relay exists.

## Constraints

- Do not claim full cross-node WebSocket relay.
- Do not weaken the current single-node room flow.
- Preserve the existing test suite and keep the new ownership boundary narrowly scoped.

## Success Criteria

- Wrong-node live-room access is rejected with a structured handoff hint.
- Existing single-node gameplay, reconnect, and spectator flows still pass.
- The default Vitest suite and Redis-only integration tests remain green.
- Status and deployment docs clearly distinguish proved owner gating from future relay work.

## Deliverables

- `CLAUDE_DIRECTIVE_85.md` in the repo root.
- Code changes implementing room ownership gating and handoff hints.
- `EXECUTION_REPORT_85.md` summarizing what changed, what was proven, and what remains bounded.
