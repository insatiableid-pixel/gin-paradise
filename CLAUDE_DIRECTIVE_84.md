# CLAUDE DIRECTIVE 84 - Coordinator-Backed Live Match Snapshots

## Objective

Make Gin Paradise's live multiplayer state recoverable across process or node boundaries by persisting serializable match snapshots through the Realtime Coordinator and hydrating room state from that shared snapshot store.

## Why This Is Next

Directive 83 proved that Redis can own shared room metadata, queue membership, and leases. The remaining gap is live match recovery: the game engine state still lives only in `roomManager` memory, which means a reconnect on another node cannot resume an in-progress match. This directive closes that seam without pretending we have finished load-balancer routing.

## Scope

1. Add coordinator methods for room game snapshots: store, fetch, and clear the serializable live match payload for a room.
2. Implement those methods in both `MemoryCoordinator` and `RedisCoordinator`.
3. Update `roomManager` so match state and last-showdown state are synced into the coordinator on every meaningful transition, and hydrated back into local memory on reconnect or after a node restart.
4. Add a live Redis integration proof that a snapshot survives a coordinator restart and can be read back by a fresh coordinator instance.
5. Update health diagnostics, deployment docs, and project status to describe snapshot recovery honestly.

## Constraints

- Keep memory mode as the default supported path.
- Do not claim full cross-node WebSocket routing or production sticky-session automation unless it is actually proven.
- Preserve existing gameplay behavior and keep the current test suite green.

## Success Criteria

- The default Vitest suite still passes.
- The Redis-only integration test proves that room state and live match snapshot data survive across coordinator instances.
- `PROJECT_STATUS.md` and `gin-galaxy/DEPLOYMENT.md` explicitly call out that live match recovery is now coordinator-backed, while full routing/failover remains bounded follow-up work.

## Deliverables

- `CLAUDE_DIRECTIVE_84.md` in the repo root.
- Code changes required to implement snapshot storage and hydration.
- `EXECUTION_REPORT_84.md` summarizing what was changed, what was proven, and what remains bounded.
