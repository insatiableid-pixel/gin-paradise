# CLAUDE DIRECTIVE 91 - Spectator Relay & Multi-Node Routing

## Goal
Make watch-mode a first-class distributed surface and remove the obsolete sticky-session requirement from Redis mode.

## Scope
- Add node-aware spectator delivery so spectator updates can relay through the coordinator when the socket lives on a different node.
- Remove the `watch_match` hard-handoff gate for non-owning nodes.
- Drop `WS_SESSION_AFFINITY_REQUIRED` from config, startup health, and deployment docs.
- Rename Redis live-room routing to `multi_node_relay` and keep the node-id requirement explicit.
- Update project status and the deployment guide so they describe the current relay-capable architecture honestly.

## Must-Haves
- `watch_match` on a remote-owned room must return `spectator_update`, not `room_handoff_required`.
- Spectator updates and match-over messages must use coordinator node delivery when the watcher socket lives elsewhere.
- Redis mode must still require a stable `COORDINATOR_NODE_ID`.
- Keep the existing player relay, room ownership, and timer recovery behavior intact.

## Verification
- `npm run lint`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Output
- Update `PROJECT_STATUS.md` with the new sprint summary.
- Update `gin-galaxy/DEPLOYMENT.md` to describe the relay-capable Redis mode.
- Write `EXECUTION_REPORT_91.md` after implementation.
