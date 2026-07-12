# Claude Directive 4: Replay Persistence and Review Sprint for Gin Galaxy

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

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT_3.md` show that Gin Galaxy now has:

- hardened backend security and validation
- room-code multiplayer MVP
- quick-match matchmaking with rating-aware pairing
- server-enforced turn timers and timeout handling
- server-authored multiplayer transcripts for auditability
- passing API, multiplayer, matchmaking, and competitive integrity test suites

The next highest-value gap is now **durable replay and post-game review**.

The platform already records structured multiplayer transcripts, but they are currently in memory and players cannot inspect them in the product. The next step is to persist those transcripts and expose them in a minimal but genuinely useful replay flow.

## Your Next Task

Build the replay persistence and review foundation for Gin Galaxy.

Focus on durable transcript storage plus a minimal authenticated replay experience for completed multiplayer matches.

## Primary Objective

Persist completed multiplayer transcripts to durable storage and let players review their recent matches through the web app.

## Required Scope

### 1. Durable Transcript Storage

- Move multiplayer transcript storage from in-memory only to durable project storage.
- Prefer SQLite so it fits the current architecture and survives server restarts.
- Store enough structured data to reconstruct completed matches and rounds later.
- Preserve or improve the current transcript schema rather than replacing it with something less structured.
- Ensure both room-code and quick-match matches persist transcript data.
- Handle normal completions, forfeits, disconnects, and timeout endings consistently.

### 2. Replay Backend Access

- Add authenticated backend access for replay history and replay detail.
- Support a recent replay list for the logged-in user.
- Support loading a full transcript for a single replay.
- Enforce access control so users can only fetch replays for matches they participated in unless broader visibility already exists by design.
- Keep the API shapes clear and stable for later analysis features.

### 3. Minimal Replay UI

- Add a replay viewing flow in the frontend.
- Make completed replays discoverable from an existing player-facing surface such as Dashboard, Profile, Analysis, or Multiplayer history.
- Provide a basic but usable review experience. At minimum, include:
  - replay list or recent match history
  - transcript timeline or move list
  - clear per-action labeling (who acted and what happened)
  - round result summary
  - lightweight step-through or action focus capability if feasible without overbuilding
- Optimize for correctness and readability over visual polish.

### 4. Replay / Transcript Integration Rules

- Keep the server-authoritative transcript as the source of truth.
- Do not break current multiplayer, matchmaking, timer, or transcript-recording behavior.
- If a match ends abnormally, the replay should still clearly reflect that end reason.
- Define and document whether incomplete or abandoned matches are shown in replay history, and be consistent.

### 5. Testing and Verification

Add automated coverage for replay persistence and access. At minimum, cover:

- transcript persistence for completed multiplayer matches
- replay list retrieval for an authorized player
- replay detail retrieval for an authorized player
- replay access rejection for unauthorized users
- transcript integrity after persistence round-trip
- regression coverage confirming room-code and quick-match multiplayer still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No sweepstakes or wallet system yet
- No deep AI coaching overhaul yet
- No spectator mode
- No Redis or horizontal scaling work unless strictly required
- No major visual redesign outside what replay viewing requires
- No advanced rating/matchmaking changes in this pass

## Implementation Guidance

- Reuse the existing transcript model and competitive integrity work as the foundation.
- Prefer the smallest durable schema that is easy to test, inspect, and extend later.
- Design the replay API and stored transcript shape so future AI analysis can consume them without another schema rewrite.
- If there is a tradeoff between flashy replay UI and durable correctness, choose durable correctness.

## Acceptance Criteria

This task is complete only if all of the following are true:

- completed multiplayer matches persist transcripts durably
- both room-code and quick-match matches produce durable replay data
- an authenticated player can view their recent replay list
- an authenticated player can open a replay and inspect the transcript
- unauthorized replay access is rejected
- existing multiplayer, matchmaking, timer, and transcript behavior still works
- replay persistence/tests exist and pass alongside existing tests
- a comprehensive `EXECUTION_REPORT.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete durable replay persistence and the first replay review flow next. After that, the most natural follow-on will be richer AI analysis on top of those stored transcripts, followed by persistent multiplayer infrastructure refinements or sweepstakes groundwork.
