# CLAUDE DIRECTIVE 88 - Clean Shutdown Ownership Handoff

## Objective

Make live-room recovery cleaner by making ownership metadata first-class and releasing it on clean shutdown. When Gin Paradise stops gracefully, its active rooms should remain in Redis as recoverable snapshots, but they should be left ownerless so a restarted or successor node can reclaim them instead of inheriting stale ownership.

## Why This Is Next

Directive 87 made coordinator identity stable, which means room ownership can now survive process restarts on the same deployment slot. The remaining gap is that room ownership and turn-timer ownership are still only partially reflected in coordinator state, and clean shutdown currently disconnects without explicitly handing those live rooms back. That leaves Redis with recoverable room snapshots but stale ownership metadata.

## Scope

1. Add a coordinator method for updating room ownership metadata without changing the room roster or match snapshot.
2. Record timer ownership metadata when a turn timer starts, and clear it when the timer is canceled or expires.
3. Release active room ownership metadata during clean shutdown while preserving room snapshots, players, and match state.
4. Keep permanent room cleanup semantics unchanged for finished/removed rooms.
5. Add tests that prove ownership metadata round-trips in both coordinators and that shutdown handoff leaves recoverable rooms ownerless.
6. Update deployment docs and project status so the recovery story stays honest.

## Constraints

- Do not implement full cross-node WebSocket relay yet.
- Do not delete Redis room snapshots during clean shutdown.
- Keep memory and Redis coordinators behavior aligned.
- Preserve the existing owner-gated live-room checks.

## Success Criteria

- Coordinator rooms can expose updated owner and timer ownership metadata.
- Active timers are visible in coordinator metadata while running and cleared when they stop.
- Clean shutdown leaves room records and snapshots intact but clears ownership so another node can adopt them later.
- The default regression suite stays green.
- Redis integration tests still pass against a real Redis server.

## Deliverables

- `CLAUDE_DIRECTIVE_88.md` in the repo root.
- Code changes that make ownership metadata and clean shutdown handoff explicit.
- `EXECUTION_REPORT_88.md` summarizing the implementation, verification, and remaining gaps.
