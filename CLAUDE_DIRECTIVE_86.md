# CLAUDE DIRECTIVE 86 - Explicit WS Session Affinity Contract

## Objective

Make Gin Paradise's remaining live-room deployment constraint explicit at runtime: when the Redis-backed coordinator is enabled, the server must advertise and require WebSocket session affinity until true cross-node relay exists.

## Why This Is Next

Directive 85 made wrong-node live-room access safe by rejecting it with a structured handoff hint. The remaining production risk is operator error: Redis mode still needs sticky sessions or equivalent affinity for active room sockets, and that contract should be enforced by startup validation and health metadata instead of only by documentation.

## Scope

1. Add a runtime config flag that represents whether WebSocket session affinity is required.
2. Fail startup in `COORDINATOR_MODE=redis` unless `WS_SESSION_AFFINITY_REQUIRED=true` is explicitly set.
3. Surface the live-room routing mode in the startup banner and `/api/health` payload.
4. Mirror the same health contract in the test harness so the runtime shape stays consistent.
5. Add focused tests for config parsing, startup validation, and the new health payload fields.
6. Update deployment docs and project status so they match the enforced contract.

## Constraints

- Do not claim cross-node WebSocket relay.
- Do not weaken the existing owner-gated live-room rejection path.
- Keep the single-node memory coordinator path unchanged.
- Keep the contract additive and explicit rather than implicit.

## Success Criteria

- Redis mode cannot start unless the session-affinity requirement is acknowledged.
- `/api/health` reports the deployment's live-room routing mode.
- The test harness exposes the same health shape as production.
- The default regression suite remains green.
- Deployment docs clearly say sticky sessions are still required for active room sockets.

## Deliverables

- `CLAUDE_DIRECTIVE_86.md` in the repo root.
- Code changes enforcing and advertising the WS session affinity contract.
- `EXECUTION_REPORT_86.md` summarizing the change, verification, and remaining gaps.
