# CLAUDE DIRECTIVE 89 - Live Turn Timer Recovery

## Objective

Persist the active turn timer in the coordinator snapshot, restore it when an owned room is recovered after restart, and immediately catch up any timer that has already expired while the process was down.

## Why This Is Next

Directive 88 made room ownership recoverable on clean shutdown, but in-flight turn timers still live only in process memory. That means a restarted node can see the room and match state again, but it can still lose the active timeout window unless the timer state is also carried through the shared coordinator snapshot.

## Scope

1. Extend the coordinator game snapshot with serialisable turn-timer state.
2. Persist timer metadata whenever a turn timer starts, resets, cancels, or expires.
3. Restore owned-room timers on startup and on first room access after recovery.
4. If a recovered timer is already expired, trigger the same timeout path immediately instead of leaving the room stalled.
5. Add tests covering snapshot round-tripping, timer restore, and immediate catch-up.
6. Update deployment docs and project status so the failover story stays honest.

## Constraints

- Do not change the live gameplay rules.
- Keep memory and Redis coordinators aligned.
- Preserve existing room ownership and sticky-session requirements.
- Do not attempt full cross-node WebSocket relay yet.

## Success Criteria

- A running turn timer is visible in coordinator snapshots.
- Restarting a node with owned rooms restores the remaining timer.
- An already-expired recovered timer is handled immediately.
- The default regression suite stays green.
- Redis integration tests still pass against a real Redis server.

## Deliverables

- `CLAUDE_DIRECTIVE_89.md` in the repo root.
- Code changes that persist and restore live turn timers.
- `EXECUTION_REPORT_89.md` summarizing the implementation, verification, and remaining gaps.
