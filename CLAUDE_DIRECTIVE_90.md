# CLAUDE DIRECTIVE 90 - Cross-Node Room Relay

## Goal
Implement a coordinator-mediated relay path for live room actions so a client that lands on the non-owning node can still play through the owning node. Keep the remaining sticky-session requirement honest: relay live room actions, but do not pretend every websocket surface is fully distributed yet.

## Scope
- Add a narrow room-action request/response relay contract to the coordinator.
- Add node-aware server-message delivery so broadcasts go to the websocket-owning node, not just the current process.
- Bridge the room manager to the coordinator relay events.
- Preserve local websocket references across Redis snapshot refreshes only when node identity still matches.
- Update docs and project status to reflect the new relay behavior without overstating the remaining failover gaps.

## Must-Haves
- Relay `join_room`, challenge-room join/reconnect, and live turn actions (`draw`, `discard`, `knock`, `next_round`, `submit_client_seed`) across nodes when the room lease belongs elsewhere.
- Keep `watch_match` and other non-relayed websocket surfaces honest if they still need handoff.
- Make remote room-player broadcasts route through the owning node id, then forward to the local websocket on the destination node.
- Preserve the existing coordinator-backed ownership and timer recovery behavior.

## Verification
- `npm run lint`
- `npm test`
- `REDIS_URL=redis://127.0.0.1:6379 npm run test:redis`

## Output
- Update `PROJECT_STATUS.md` with the new sprint summary.
- Update `gin-galaxy/DEPLOYMENT.md` to describe relay honestly.
- Write `EXECUTION_REPORT_90.md` after implementation.
