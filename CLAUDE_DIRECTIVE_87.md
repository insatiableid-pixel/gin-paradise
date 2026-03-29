# CLAUDE DIRECTIVE 87 - Stable Coordinator Identity for Redis Recovery

## Objective

Make Gin Paradise's Redis-backed coordinator use a stable, operator-controlled node identity so room ownership survives process restarts and the existing owner-gated live-room checks remain valid after recovery.

## Why This Is Next

Directive 86 made the live-room deployment contract explicit: Redis mode now requires sticky sessions or equivalent affinity for active sockets. The remaining practical recovery gap is identity churn. Today the coordinator node id is generated fresh per process, which means a restarted server can no longer match the owner id stored in room snapshots, even when it is the same deployment slot. This directive closes that gap without pretending cross-node relay already exists.

## Scope

1. Add a stable coordinator node id configuration value and parse it from the environment.
2. Require that stable node id when `COORDINATOR_MODE=redis` so restart recovery is intentional, not accidental.
3. Thread the configured node id through both coordinator implementations and startup logging.
4. Surface the stable node id in health diagnostics so operators can verify which identity owns the live-room namespace.
5. Add tests for config parsing, validation, and coordinator factory wiring.
6. Update deployment docs and project status to explain the new identity contract honestly.

## Constraints

- Do not claim full cross-node relay.
- Do not change the existing owner-gated admission behavior.
- Keep memory mode simple and zero-infra by default.
- Preserve the current Redis lease and snapshot model.

## Success Criteria

- Redis mode cannot start without an explicit stable coordinator identity.
- A restarted server using the same identity can still match room ownership metadata from Redis snapshots.
- Health and startup logs show the stable node id clearly.
- The default regression suite remains green.
- Deployment docs explain that the stable node id is part of the Redis recovery contract.

## Deliverables

- `CLAUDE_DIRECTIVE_87.md` in the repo root.
- Code changes adding stable coordinator identity support.
- `EXECUTION_REPORT_87.md` summarizing the implementation and verification.
