# Claude Directive 3: Competitive Integrity Sprint for Gin Galaxy

## Default Protocol

This directive inherits the project default protocol.

For every task you complete in this workspace:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT.md` unless the user explicitly asks for a numbered variant.
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

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT_2.md` show that Gin Galaxy now has:

- hardened backend security and validation
- room-code multiplayer MVP
- automatic quick-match matchmaking
- passing API, multiplayer, and matchmaking test suites
- verified single-player and multiplayer game flows

The platform is now functionally multiplayer-capable, but it is not yet dispute-proof enough for a future sweepstakes economy.

Before introducing any coin economy, buy-ins, escrow, or real-value competition, multiplayer must be resilient against stalling, fully auditable, and fair in how it pairs players.

## Your Next Task

Build the competitive integrity foundation for Gin Galaxy multiplayer.

Focus on eliminating griefing/stalling vectors, creating an auditable match ledger, and improving matchmaking quality.

## Primary Objective

Make multiplayer matches enforceable, reviewable, and fair enough to serve as the foundation for future wagered or sweepstakes-style play.

## Required Scope

### 1. Server-Enforced Game Timers

- Add server-enforced turn timing to the multiplayer system.
- Prevent a player from stalling a match indefinitely by idling, tab-closing, or refusing to act.
- Implement a clear timeout rule for live games. Choose the smallest reliable policy that preserves game integrity.
- Acceptable approaches include:
  - auto-forfeit on timeout
  - or a strictly defined server-controlled fallback action path if that is safer and simpler
- The server must remain authoritative over timer start, expiration, and timeout outcomes.
- Make timer state visible enough in the client for players to understand what is happening.

### 2. Match Transcript / Action Ledger

- Record a chronological, structured transcript for multiplayer matches from the server-authoritative game flow.
- Persist enough data to reconstruct and audit a completed match later.
- At minimum, capture:
  - players
  - match or room identifiers
  - round boundaries
  - deal/start events
  - draw source and acting player
  - discard events
  - knock, gin, undercut, round end, and match end
  - timeout, disconnect, leave, and forfeit outcomes where applicable
  - sequence order and/or timestamps
- Store the transcript in a form that is easy to inspect, test, and reuse later for replay or AI analysis.
- Ensure both room-code matches and quick-match games produce transcripts.

### 3. Rating-Aware Matchmaking

- Upgrade the current FIFO matchmaking queue to a rating-aware search strategy.
- Use an expanding Elo bracket or similarly simple, deterministic approach.
- A good default is to search within a narrow rating window first, then expand it over time until a match is found.
- Preserve duplicate prevention, disconnect cleanup, and current queue safety guarantees.
- Keep the room-code friend-match flow working exactly as before.

### 4. Reliability and Audit Rules

- Timeout and disconnect behavior must be explicit and documented in code and the final report.
- Match outcomes caused by timeout, disconnect, or forfeit must be persisted consistently.
- Rating updates must remain correct when a match ends through a non-standard path.
- Do not introduce client-authoritative shortcuts.

### 5. Testing and Verification

Add automated coverage for the competitive integrity work. At minimum, cover:

- timer expiration behavior
- timeout outcome persistence
- transcript creation for completed matches
- transcript integrity for key actions and terminal outcomes
- rating-aware pairing behavior
- regression coverage confirming room-code multiplayer still works
- regression coverage confirming quick-match multiplayer still works

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No sweepstakes or wallet system yet
- No replay UI yet unless a minimal internal viewer falls out naturally
- No Redis or horizontal scaling work unless strictly required
- No major visual redesign outside what timer visibility requires
- No advanced AI coaching overhaul yet
- No TypeScript port of DeepKnock or Nexus in this pass

## Implementation Guidance

- Optimize for dispute-proof behavior over feature breadth.
- Prefer explicit server rules to ambiguous client behavior.
- Keep the transcript schema intentionally structured so replay and analysis features can build on it next without a rewrite.
- If there is a tradeoff between fancy UX and airtight behavior, choose airtight behavior.

## Acceptance Criteria

This task is complete only if all of the following are true:

- a live multiplayer game cannot stall indefinitely due to player inactivity
- the server enforces timeout behavior and persists the outcome correctly
- completed multiplayer matches persist structured transcripts
- both room-code and quick-match games benefit from the new integrity rules
- matchmaking uses a rating-aware search strategy instead of pure FIFO
- room-code multiplayer still works
- quick-match multiplayer still works
- competitive-integrity tests exist and pass alongside existing tests
- a comprehensive `EXECUTION_REPORT.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the competitive integrity sprint first. After that, the most natural next step will be replay and post-game analysis on top of the stored transcripts, followed by persistent multiplayer infrastructure or sweepstakes groundwork.
