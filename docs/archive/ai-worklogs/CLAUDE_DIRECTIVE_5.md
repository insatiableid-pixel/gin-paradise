# Claude Directive 5: Transcript-Driven AI Analysis Sprint for Gin Galaxy

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

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT_4.md` show that Gin Galaxy now has:

- hardened backend security and validation
- server-authoritative real-time multiplayer
- quick-match matchmaking with rating-aware pairing
- server-enforced turn timers and auditable transcripts
- durable replay persistence in SQLite
- authenticated replay list and replay detail APIs
- a usable replay review UI with transcript step-through
- 108 passing automated tests across API, multiplayer, matchmaking, competitive integrity, and replay coverage

The next highest-value gap is now **analysis that actually uses the stored turn-by-turn transcript**.

Gin Galaxy already has an analysis route and UI, but the current analysis flow is still summary-oriented. The platform now has the durable replay substrate needed to deliver real post-game coaching tied to exact actions. That is the right next move before deeper productization or any sweepstakes/economy work.

## Your Next Task

Build the transcript-driven AI analysis layer for Gin Galaxy.

Focus on turning stored replay transcripts into authenticated, replay-specific coaching that helps a player understand what happened in a completed match.

## Primary Objective

Allow a player to request AI analysis for a stored replay and receive useful, transcript-grounded post-game feedback through the web app.

## Required Scope

### 1. Replay-Backed Analysis Input

- Extend the backend analysis flow so it can analyze a specific stored replay, not just coarse recent-match summaries.
- Use the persisted replay transcript as the source input for analysis.
- Ensure the transcript payload preserves enough context for meaningful commentary, including turn order, draw/discard/knock actions, and end reason.
- Keep the stored replay format stable unless a small additive improvement is clearly needed.

### 2. Authenticated Access Control

- Require authentication for transcript-driven analysis.
- Enforce that a user can only request analysis for replays they participated in unless broader visibility already exists by design.
- Return clear errors for unauthenticated, unauthorized, or missing replay requests.

### 3. Backend Analysis Experience

- Add or extend an API route so the frontend can request analysis for a specific replay id.
- Construct a structured transcript-to-prompt transformation that is readable, deterministic, and future-proof.
- Make the response clearly grounded in the replay, ideally referencing specific turns, decisions, or phases of the match.
- Preserve graceful fallback behavior when Gemini or its API key is unavailable.

### 4. Frontend Replay Analysis Flow

- Add a user-facing path to request analysis from the replay experience or another obviously related surface.
- Show analysis results in a way that is clearly tied to the selected replay.
- Optimize for clarity over flashy presentation. A strong first version is better than an overbuilt one.
- If useful, include lightweight affordances that connect analysis points to transcript steps or match phases.

### 5. Testing and Verification

Add automated coverage for transcript-driven analysis. At minimum, cover:

- authenticated analysis request for a valid replay
- unauthorized or non-participant analysis rejection
- replay-not-found handling
- graceful fallback behavior when AI configuration is unavailable
- transcript-to-analysis input shaping or formatting behavior
- regression coverage confirming replay APIs and existing analysis behavior still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No sweepstakes, wallet, or ledger system yet
- No PostgreSQL or Redis migration in this pass
- No live in-match coaching
- No full PR-style rating system unless it falls out naturally from the transcript work
- No major frontend redesign outside what replay analysis requires
- No advanced AI-engine port from Python into the web client in this pass

## Implementation Guidance

- Treat the stored replay transcript as the source of truth for post-game analysis.
- Prefer a structured transcript-to-prompt adapter over ad hoc string concatenation.
- Keep the API and analysis payload shape extendable for future features such as blunder tagging, per-turn annotations, or performance ratings.
- If there is a tradeoff between analytical depth and dependable access-controlled delivery, choose dependable delivery first.
- Keep the first version honest about uncertainty; avoid presenting invented certainty if the model can only infer from available transcript data.

## Acceptance Criteria

This task is complete only if all of the following are true:

- an authenticated player can request AI analysis for a stored replay they participated in
- replay-specific analysis is based on the persisted transcript rather than only high-level summary data
- unauthorized replay analysis access is rejected
- replay-not-found and missing-AI-configuration cases are handled cleanly
- the frontend exposes a clear path to request and read replay analysis
- existing replay, multiplayer, matchmaking, and analysis behavior still works
- automated tests for transcript-driven analysis exist and pass alongside existing tests
- a comprehensive `EXECUTION_REPORT.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the first transcript-driven AI analysis flow next. After that, the strongest follow-on options will be deeper analysis sophistication, difficulty-tier/product polish, or the much larger sweepstakes/economy track.
