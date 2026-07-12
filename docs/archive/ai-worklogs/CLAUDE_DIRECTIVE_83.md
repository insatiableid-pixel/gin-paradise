# Claude Directive 83: Real Redis Backplane, Shared Matchmaking Ownership, and Honest Two-Node Realtime Proof for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_83.md`.
3. You must also emit an updated project status report and save it to the workspace root as `PROJECT_STATUS.md`.
4. The execution report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
5. The updated `PROJECT_STATUS.md` must reflect the true current state of the product and must not overclaim completed distributed or multi-instance readiness.
6. The task is not complete until the code, verification, `EXECUTION_REPORT_83.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

Directive 81 created the `RealtimeCoordinator` boundary and decoupled room/player/spectator state from direct module-level Maps.

Directive 82 then hardened the write path by:

- introducing a durable SQLite-backed outbox
- moving replay auto-evaluation and achievement follow-up off the synchronous hot path
- clarifying the difference between authoritative synchronous writes and derived asynchronous work

That means the architecture is now cleaner on both fronts:

- the realtime seam exists
- the write path is more honest

But Gin Paradise still cannot truthfully claim shared realtime coordination.

The latest report is explicit:

- `redisCoordinator.ts` is still scaffolding
- Redis mode still relies on local fallback behavior instead of real Redis I/O
- matchmaking queue coordination across instances is not yet real
- timer ownership across instances is not yet real
- cross-instance WebSocket fanout is not yet proven

So the next optimal step is no longer another storage sprint.

It is:

> make the shared realtime path real enough to prove bounded multi-instance behavior honestly

This does **not** mean “pretend the whole platform is now globally scalable.”

It means:

> remove the fake part of Redis mode and replace it with an actual shared coordination story

## Your Next Task

Build the Real Redis Backplane, Shared Matchmaking Ownership, and Honest Two-Node Realtime Proof sprint for Gin Paradise.

## Primary Objective

Turn the current Redis coordinator from contract-tested scaffolding into a real shared-state coordination layer for a bounded but meaningful set of multiplayer responsibilities.

This sprint should establish that:

- Redis mode uses actual Redis
- coordinator truth can exist outside one Node process
- matchmaking and room/presence ownership are no longer purely local assumptions
- a bounded multi-instance proof can be demonstrated honestly

The goal is not full distributed perfection.

The goal is:

> one real, defensible step from “single-node with scaffolding” to “shared realtime coordination exists and has been proven in a limited but real way”

## Required Scope

### 1. Replace Fake Redis Mode With Real Redis I/O

`COORDINATOR_MODE=redis` must stop silently behaving like a local fallback with Redis-flavored types.

Required behavior:

- use a real Redis client library
- establish real networked Redis reads/writes for coordinator state
- validate required Redis configuration on startup
- report Redis connectivity honestly in health and startup diagnostics

If Redis is unavailable in `redis` mode:

- fail clearly
- or degrade in an explicitly named development-only way

But do **not** present local fallback as if shared coordination is active.

That is the main lie this sprint must remove.

### 2. Move Shared Coordinator Truth Into Redis

At minimum, in Redis mode the following must round-trip through Redis rather than local-only Maps:

- room registry / room metadata
- player-to-room membership
- room player presence / connection metadata that must survive cross-process coordination
- spectator room membership or equivalent watch-state metadata

It is acceptable that raw WebSocket objects remain process-local.

However:

- shared identity, membership, and routing metadata must become Redis-backed truth in Redis mode

### 3. Add Real Cross-Instance Coordination Events

Introduce an explicit event or pub/sub layer for realtime coordination changes.

At minimum, use Redis to publish/subscribe or otherwise distribute coordination events such as:

- room created / room updated / room closed
- player joined / left / reconnected
- spectator joined / left
- matchmaking state changes
- ownership or timer leadership changes if applicable

The event model must be explicit enough to debug.

Each event should have a stable envelope, such as:

- event type
- room id or queue id
- node id
- timestamp
- payload

Do not hide cross-instance behavior behind silent implicit reads only.

### 4. Move Matchmaking Queue Coordination Out Of Pure Local Memory

The queue is one of the clearest remaining multi-instance blockers.

In Redis mode:

- quick-match queue state must become shared
- duplicate prevention must still work
- disconnect cleanup must still work
- pairing decisions must remain deterministic enough to reason about

It is acceptable if room-code friend matches stay simpler.

But quick-match coordination must no longer be a purely local per-process queue in Redis mode.

### 5. Introduce Explicit Room / Timer Ownership

Right now, timer and live-room control still implicitly live where the socket and room live.

Make ownership explicit.

At minimum:

- every active room in Redis mode has an owning node or equivalent leadership concept
- timer responsibility is tied to that ownership model
- ownership can be observed, documented, and recovered if the node disappears

This does **not** require a perfect distributed scheduler.

But it does require the code to stop relying on invisible local assumptions.

A lease, heartbeat, or similarly simple ownership protocol is acceptable.

### 6. Preserve Server Authority and Safety Rules

Do not regress the strong product semantics already in place.

These must remain intact:

- server-authoritative game state
- fairness / proof flow
- escrow and stake handling
- replay transcript correctness
- timeout and forfeit rules
- spectator privacy / safety behavior

This sprint is not an excuse to simplify by dropping correctness.

### 7. Produce A Bounded Two-Node Proof

You must prove something real.

Target a bounded but honest demonstration such as:

- two server instances pointed at the same Redis coordinator
- shared queue visibility across the instances
- a cross-instance matchmaking or room-coordination flow
- and at least one real distributed event propagation path

If a full browser-to-browser two-node match is too large for this sprint, an acceptable proof could be:

- a deterministic integration harness
- or a scripted multi-process demo

But the proof must show real cross-process coordination using actual Redis, not only mocks.

If the environment blocks a true two-node proof, say so plainly and document exactly what was proven instead.

### 8. Improve Deployment Honesty and Operator Visibility

Update runtime visibility and docs so an operator can tell:

- whether the app is in memory or Redis coordinator mode
- whether Redis is reachable and healthy
- which node owns a room or timer
- whether shared queue coordination is healthy
- what multi-instance claims are actually supported

The docs must distinguish clearly between:

- supported single-node mode
- experimentally proven Redis-backed shared coordination
- still-unproven production-scale assumptions

### 9. Testing and Verification

Add automated coverage for the new distributed-coordination behavior where reasonable.

At minimum, cover:

- Redis coordinator client behavior
- startup/config failure behavior in Redis mode
- shared room/member state round-trip behavior
- shared matchmaking queue behavior
- ownership or lease behavior if introduced
- regression coverage for existing memory mode

And then complement this with the bounded real Redis proof required above.

## Non-Goals For This Pass

- Do not do a full PostgreSQL migration
- Do not move the outbox to a distributed worker system yet
- Do not solve global load balancing or CDN edge routing
- Do not claim perfect auto-failover if it is not implemented
- Do not rewrite the whole multiplayer stack just because Redis is now real

This sprint is about honest shared coordination, not infrastructure theater.

## Implementation Guidance

- Keep the coordinator contract narrow and let Redis back it for real.
- Treat raw WebSocket connections as node-local and shared routing metadata as Redis-backed.
- Prefer explicit room/node ownership over “whoever happens to have the socket.”
- Use TTLs, leases, or heartbeats where they genuinely improve correctness.
- Preserve the in-memory implementation as the clean default path for local development.
- In Redis mode, fail honestly rather than silently falling back.
- If some behavior remains single-node only, name it explicitly in the report.

If scope must be narrowed, prioritize in this order:

1. real Redis I/O with honest no-fallback semantics
2. shared queue and room/member state
3. explicit room/timer ownership
4. bounded two-node proof
5. polish and extra diagnostics

## Acceptance Criteria

This task is complete only if all of the following are true:

- Redis mode uses actual Redis rather than pretending through local fallback
- room/member/shared queue truth is actually externalised in Redis mode
- room or timer ownership is explicit enough to reason about
- a bounded real Redis-backed two-node coordination proof is documented and honest
- memory mode still works and remains the default local path
- docs and health visibility clearly describe supported versus experimental distributed behavior
- automated tests cover the new Redis-backed path and existing memory-mode regressions
- a comprehensive `EXECUTION_REPORT_83.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and does not overstate multi-instance maturity

## Deliverable Expectation

Complete the real Redis backplane and bounded two-node proof sprint next.

After that, the strongest follow-on directive will likely be either:

- a targeted primary-database strategy for authoritative domains if SQLite remains the limiting factor
- or a distributed-worker / ownership-hardening pass if the new Redis coordinator exposes operational gaps first

This sprint should provide the evidence needed to choose that honestly.
