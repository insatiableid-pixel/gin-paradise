# Claude Directive 2: Matchmaking Foundation for Gin Galaxy

## Default Protocol

This directive inherits the project default protocol.

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
5. The task is not complete until the code, verification, `EXECUTION_REPORT.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT.md` show that Gin Galaxy now has:

- hardened backend security and validation
- modular server architecture
- passing API and multiplayer automated tests
- live room-code multiplayer MVP with server-authoritative WebSocket play
- verified single-player and multiplayer game flows

The next highest-value gap is not core gameplay anymore. It is **multiplayer usability and productization**.

Players can already play live matches, but only if they manually create and share room codes. The most natural next step is to remove that friction with a matchmaking system.

## Your Next Task

Build the first matchmaking system for Gin Galaxy multiplayer.

Keep the existing room-code multiplayer flow working, but add a new automatic queue-based path so two authenticated players can be paired into a match without sharing codes.

## Primary Objective

Enable authenticated players to click a quick-play action, enter a matchmaking queue, and be automatically placed into a live 1v1 multiplayer match.

## Required Scope

### 1. Matchmaking Backend

- Add a queue-based matchmaking layer on top of the current multiplayer room system.
- Prevent duplicate queue entries from the same authenticated user.
- Support queue join, queue leave/cancel, match found, and queue cleanup flows.
- Auto-create and assign a multiplayer room when a match is found.
- Prefer the simplest reliable pairing strategy first.
- If rating-aware pairing is easy to add without overcomplicating the system, use a lightweight version. Otherwise ship FIFO pairing but structure it so rating-aware rules can be added later.

### 2. Real-Time Client Flow

- Add a clear quick-match path in the UI.
- Show queue/searching state, cancellation, and transition into the live match when paired.
- Preserve the existing create-room / join-room code flow for direct friend matches.
- Make sure quick match and room-code match flows do not interfere with each other.

### 3. Reliability Rules

- Handle queue cancellation cleanly.
- If a player disconnects while queued, remove them from the queue.
- If a player is matched and disconnects before the game starts, handle that case cleanly and do not strand the opponent.
- Keep the server authoritative over match creation and assignment.

### 4. Testing and Verification

Add automated coverage for matchmaking behavior. At minimum, cover:

- queue join
- queue cancel/leave
- duplicate queue rejection
- automatic pairing of two players
- transition from queue to active match
- queue cleanup on disconnect
- regression coverage confirming room-code multiplayer still works

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No sweepstakes or wallet system
- No full ranked ladder redesign
- No tournament mode
- No replay system unless it falls out naturally from the work
- No persistent distributed queue infrastructure unless clearly required
- No advanced AI changes

## Implementation Guidance

- Reuse the current multiplayer room manager instead of creating a second parallel match system.
- Favor the smallest architecture that makes quick-play real and stable.
- Keep room-code multiplayer intact for friend matches.
- Optimize for clean state transitions and low-risk behavior over feature breadth.

## Acceptance Criteria

This task is complete only if all of the following are true:

- an authenticated player can enter a quick-match queue
- two queued players are automatically paired into a multiplayer game
- a queued player can cancel without leaving stale queue state behind
- duplicate queue entries are rejected
- room-code multiplayer still works
- automated matchmaking tests exist and pass alongside existing tests
- a comprehensive `EXECUTION_REPORT.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete matchmaking first. After that, the next likely decision will be between replay/analysis enhancements, persistent multiplayer infrastructure, or sweepstakes groundwork.
