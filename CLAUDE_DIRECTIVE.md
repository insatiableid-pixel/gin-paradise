# Claude Directive: Next Phase for Gin Galaxy

## Default Protocol

This is the default protocol for this project unless a newer root directive explicitly replaces it.

For every task you complete in this workspace:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. Do not treat documentation as optional. The task is only complete when the code changes, verification, and root-level `EXECUTION_REPORT.md` are all finished.

## Current State

The latest `EXECUTION_REPORT.md` shows that the backend hardening sprint is complete. Gin Galaxy now has a hardened single-player beta foundation with:

- modularized backend routes and middleware
- secure password hashing and session expiry
- request validation and rate limiting
- automated API coverage
- verified end-to-end single-player gameplay

That means the next major milestone is no longer backend hardening. The next highest-value task is multiplayer.

## Your Next Task

Build the first real-time multiplayer architecture for `gin-galaxy/`.

Focus on a playable 1v1 multiplayer MVP, not on sweepstakes, cosmetic polish, or advanced AI work.

## Primary Objective

Enable two authenticated human players to create or join the same match and play Gin Rummy against each other in real time using a server-authoritative game flow.

## Required Scope

### 1. Real-Time Transport

- Add WebSocket-based real-time communication to the existing Node/Express app.
- Authenticate multiplayer connections using the existing session token model.
- Keep the server authoritative for room state, turn order, draw/discard/knock legality, and result resolution.

### 2. Multiplayer Match Flow

Implement the minimum complete loop for human-vs-human play:

- create room or start match
- second player joins room
- server deals cards and manages stock/discard state
- players take alternating turns
- valid draw, discard, knock, gin, undercut, and round-end handling
- match result persistence using the existing stats/rating pipeline or a cleanly extended equivalent

### 3. Frontend Integration

- Replace the current `Play Friend` stub with a real multiplayer entry path.
- Add the minimum UI needed to:
  - create or join a room
  - wait for an opponent
  - play a synchronized live match
  - see opponent presence and turn state
- Preserve the current single-player mode; do not break it.

### 4. Validation and Reliability

- Reject out-of-turn or invalid actions on the server.
- Prevent clients from authoritatively mutating game state.
- Handle disconnects at least well enough to avoid corrupt matches.
- If full reconnect support is too large for this pass, implement a clear disconnect/forfeit rule and document it.

### 5. Testing and Verification

Add automated coverage for the multiplayer foundation. At minimum, cover:

- authenticated room creation
- second player join flow
- turn-order enforcement
- rejection of invalid actions
- successful round or match completion path

Also perform manual verification with two authenticated players if the environment allows it.

## Non-Goals for This Pass

- No sweepstakes or wallet system
- No matchmaking ladder beyond the simplest room-based flow
- No tournament mode
- No replay system unless it falls out naturally from the architecture
- No advanced AI port work
- No major visual redesign outside what multiplayer requires

## Implementation Guidance

- Reuse the existing TypeScript engine and hardened backend foundation wherever possible.
- Prefer the smallest architecture that can honestly support a full multiplayer match.
- Keep contracts explicit between server and client.
- Favor clarity and correctness over feature breadth.

## Acceptance Criteria

This task is complete only if all of the following are true:

- two authenticated users can enter the same multiplayer match
- the server, not the client, is authoritative over game state
- turn order and move legality are enforced correctly
- results persist correctly after match completion
- single-player mode still works
- multiplayer tests exist and pass
- a comprehensive `EXECUTION_REPORT.md` is saved to the workspace root

## Deliverable Expectation

Complete the multiplayer MVP first. After that, the likely next strategic decision will be choosing between deeper multiplayer productization, replay/analysis enhancements, or sweepstakes infrastructure.
