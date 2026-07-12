# Claude Directive 81: Realtime Backplane and Honest Multi-Instance Readiness for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_81.md`.
3. You must also emit an updated project status report and save it to the workspace root as `PROJECT_STATUS.md`.
4. The execution report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
5. The updated `PROJECT_STATUS.md` must reflect the true current state of the product and must not overclaim completed scale or production readiness.
6. The task is not complete until the code, verification, `EXECUTION_REPORT_81.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

Gin Paradise has grown into a feature-rich competitive platform:

- React/Vite frontend with authenticated routes for dashboard, play, leaderboard, profile, analysis, replays, tournaments, training, fairness, wallet, social, live matches, cosmetics, premium, and admin
- Node.js/Express backend with routes covering auth, matches, replay analysis, wallet, tournaments, training, fairness, social, billing, offers, and admin tooling
- server-authoritative multiplayer and spectator flows over WebSockets
- SQLite persistence for users, sessions, matches, replays, wallets, transactions, tournaments, broadcast metrics, and more
- optional Python- and Gemini-backed post-game analysis layers

That is meaningful product depth.

But the architecture summary also surfaced the clearest scale bottleneck:

- `server/multiplayer/roomManager.ts` still owns room lifecycle, matchmaking queue state, player-to-room mapping, spectator connections, and other live coordination concerns inside one Node process
- `gin-galaxy/DEPLOYMENT.md` explicitly documents a single-instance deployment model with SQLite and no external cache or message bus

That stack is excellent for local development and a small beta, but it is not an honest foundation for multi-instance realtime scale.

The next step is therefore not "pretend we horizontally scale now."

It is:

> build a real coordination boundary so Gin Paradise can preserve correct single-node behavior while becoming truthfully extensible toward shared realtime infrastructure

## Your Next Task

Build the Realtime Backplane and Honest Multi-Instance Readiness sprint for Gin Paradise.

## Primary Objective

Decouple live multiplayer coordination from a single in-process memory model.

This sprint should create an explicit, testable coordination layer for rooms, queueing, presence, and live fanout so the product can keep working in single-node mode today while gaining a real path toward multi-instance deployment tomorrow.

The goal is not to overclaim full horizontal scale.

The goal is to remove the biggest architectural lie-to-ourselves:

> that a feature-rich live platform can stay healthy long term while all realtime coordination lives inside module-level memory maps

## Required Scope

### 1. Extract a Realtime Coordination Boundary

Refactor the multiplayer stack so core live coordination depends on an explicit interface or service boundary instead of directly depending on in-process module state.

At minimum, isolate or abstract the concerns currently entangled inside the room manager:

- room registry / room lifecycle
- player-to-room membership tracking
- matchmaking queue state
- spectator presence and routing metadata
- featured / broadcast match coordination data
- reconnect / disconnect bookkeeping
- any timer ownership or timer metadata that is currently assumed to be purely local

The important rule is:

- direct reliance on process-local maps must be contained behind a narrow implementation boundary
- higher-level multiplayer code should depend on the boundary, not on the in-memory data structure choice

### 2. Preserve a Strong Single-Node Implementation

Do not break the current local and beta-friendly development shape.

Required behavior:

- a zero-extra-infra in-memory implementation must remain available
- local development should still run cleanly without Redis, Kafka, or other hosted dependencies
- room-code multiplayer, quick match, spectators, fairness hooks, timers, and transcripts must still work in the default mode

This sprint must improve architecture without destroying the current usable dev path.

### 3. Add a Shared-State / Backplane Path

Create a real path toward shared realtime coordination.

Acceptable shapes include:

- a Redis-backed coordination adapter
- or another explicit shared-state plus fanout mechanism that is actually appropriate for multiplayer coordination

If a fully live external service cannot be exercised in this environment, you must still do the honest engineering work:

- define the contract
- wire the system so the coordinator implementation is swappable
- add config and startup validation
- implement as much of the shared adapter as can be responsibly tested here
- document exactly what is proven versus what remains integration-only

Do not leave this as hand-wavy comments.

There must be a real code path, config surface, and adapter boundary.

### 4. Make Connection Routing and Reconnect Logic Future-Proof

The current model assumes the WebSocket handler that accepted the connection is also where the match truth lives.

Reduce that assumption.

At minimum:

- make room identity, player membership, and reconnect semantics portable across implementations
- avoid coupling reconnect logic to only local process memory where a cleaner shared lookup can exist
- make room ownership and player presence explicit enough that future multi-node routing is not a rewrite

You do not need to solve cross-instance sticky-session routing completely in this pass.

But you do need to make the current code stop assuming it can only ever exist inside one process.

### 5. Preserve Server Authority and Product Semantics

Do not weaken the strong parts of the current architecture while introducing the boundary.

These behaviors must remain intact:

- server-authoritative game state
- fairness / proof integration
- escrow and stake handling
- tournament hooks
- transcript recording
- timeout and forfeit rules
- spectator safety rules

This is a refactor-and-hardening sprint, not a simplification-by-deletion sprint.

### 6. Improve Deployment Honesty and Operator Visibility

Update the deployment and operational story so it truthfully describes the new state of the system.

At minimum:

- document supported single-node mode versus any experimental or optional shared-coordinator mode
- expose enough startup logging, diagnostics, or admin/debug visibility to tell which coordinator mode is active
- make failure modes readable enough for an operator to understand why multiplayer coordination is or is not healthy

The final report must say plainly what is truly supported.

### 7. Testing and Verification

Add automated coverage for the new boundary and its guarantees.

At minimum, cover:

- contract-level behavior of the coordinator abstraction
- regression coverage for room-code multiplayer
- regression coverage for quick-match multiplayer
- reconnect or disconnect handling through the new boundary
- spectator or featured-match coordination behavior if touched
- timer-related behavior if timer coordination is moved or abstracted
- startup/config behavior for the non-default coordinator path

Perform manual verification too if the environment allows it.

## Non-Goals for This Pass

- Do not migrate the whole product off SQLite yet
- Do not redesign the wallet, billing, or tournament data model yet
- Do not claim full horizontal scale unless you actually prove it end-to-end
- Do not do a broad frontend redesign outside minimal UX changes needed for reconnect or diagnostics
- Do not replace server-authoritative gameplay with client shortcuts
- Do not treat "interface extraction only" as sufficient if there is no real backplane path

The storage and write-contention problem is real, but it is the next step after this one, not the excuse to avoid the realtime boundary work now.

## Implementation Guidance

- Prefer clean seams over giant rewrites.
- Separate transport concerns, coordination concerns, and game-engine concerns.
- Keep the coordinator contract narrow and explicit.
- Favor idempotent room and queue operations.
- Prefer explicit event envelopes or coordination messages over hidden side effects.
- Preserve current behavior in default mode first, then extend.
- If the shared adapter is partial, be precise about which capabilities are production-safe and which are scaffolding.

If scope must be narrowed, prioritize in this order:

1. extracting the coordination boundary cleanly
2. keeping the in-memory implementation fully working
3. wiring a real shared-coordinator path
4. deployment/config honesty
5. extra polish

## Acceptance Criteria

This task is complete only if all of the following are true:

- multiplayer coordination no longer depends directly on scattered process-local state outside a defined boundary
- the default in-memory mode still supports the current core multiplayer flows
- the codebase now has a real shared-coordinator/backplane path instead of only an aspirational comment
- reconnect and membership assumptions are cleaner and more portable than before
- deployment/config docs accurately describe coordinator modes and their support level
- automated tests cover the new coordination boundary and key multiplayer regressions
- a comprehensive `EXECUTION_REPORT_81.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and does not overstate scale readiness

## Deliverable Expectation

Complete the realtime backplane and coordination-boundary sprint first.

After that, the most natural next directive will be:

- durable write-path hardening and storage evolution for economy, tournaments, replays, and other high-contention persistence flows

That should be the next optimization after the system stops trapping live coordination inside one Node process.
