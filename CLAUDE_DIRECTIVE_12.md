# Claude Directive 12: Tournament Mode MVP Sprint for Gin Galaxy

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_12.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_12.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT_11.md` show that Gin Galaxy now has:

- hardened auth, validation, rate limiting, health checks, and single-node deployment readiness
- server-authoritative multiplayer with rating-aware matchmaking, timers, transcripts, replays, escrow, rake, and admin visibility
- consistent live-play card preferences in both single-player and multiplayer
- 279 passing automated tests across the platform

The attached benchmark side-track artifacts do not currently change the main roadmap:

- `run_benchmark.py` shows a separate bot-champion verification workflow
- `benchmark_results.txt` is currently empty, so there is no new benchmark evidence that should redirect the main product sequence

That means the best next step remains on the core business path: deepen competitive PvP productization rather than shift into AI research or infrastructure migration.

## Your Next Task

Build the first Tournament Mode MVP for Gin Galaxy.

This should be a deliberately narrow, auditable, user-playable tournament product built on top of the existing multiplayer, wallet, escrow, rake, replay, and admin foundations.

## Primary Objective

Add a simple but real tournament flow that increases competitive depth, repeatable paid entry, and player retention without introducing unnecessary format complexity.

## Required Scope

### 1. Narrow Tournament Format

- Start with one intentionally constrained format for the MVP.
- Prefer a 4-player single-elimination sit-and-go bracket as the first supported format.
- Do not try to build a giant general tournament engine in this pass.
- If format configurability is added, keep it tightly scoped and justified.

### 2. Tournament Data Model and Lifecycle

- Add durable tournament records so the system can track:
  - tournament identity
  - format
  - status (`open`, `in_progress`, `completed`, `cancelled`, or equivalent)
  - entrants
  - bracket progression
  - linked match / replay identifiers where useful
  - payout and rake metadata
- The tournament lifecycle should at minimum support:
  - open for entry
  - fill / lock
  - semifinal round
  - final round
  - completion
  - cancellation / refund path if the tournament cannot start

### 3. Entry, Escrow, and Payout Logic

- Reuse the existing wallet, ledger, escrow, and house-accounting primitives instead of inventing a parallel economy path.
- Tournament entry should be balance-gated and transparent before the player joins.
- Keep the first version financially conservative and auditable.
- At minimum, support:
  - free-play tournaments
  - at least one wallet-backed tournament buy-in path using the existing currency system
- Gold-only for the first paid tournament path is acceptable if that is the safest MVP.
- If a tournament starts and funds are collected, payout and rake accounting must be deterministic and inspectable.
- If a tournament is cancelled before meaningful play begins, refunds must be explicit and correct.
- Prefer a simple payout schedule for MVP. Winner-take-all is acceptable if that keeps the accounting clean and honest.

### 4. Bracket Orchestration

- When the tournament fills, seed the bracket and create the first-round matches automatically.
- Winners must advance automatically to the final.
- Existing match outcomes (normal completion, forfeit, timeout, disconnect) must integrate cleanly with bracket progression.
- Tournament state should remain understandable and replayable after reconnection or refresh.
- Avoid fragile manual operator steps wherever practical.

### 5. Tournament UI

- Add a clear user-facing tournament entry and bracket experience.
- At minimum, players should be able to:
  - discover the available tournament format
  - see entry fee, prize structure, and rake before joining
  - join or cancel before start if allowed
  - see tournament fill state / waiting state
  - view bracket progression and current status
  - understand when they are advancing, eliminated, or waiting for the next round
- Keep the UI operationally clear rather than trying to over-polish the first version.

### 6. Replay / Admin / Audit Integration

- Tournament matches should continue to benefit from the existing replay and transcript pipeline where practical.
- If tournament-specific financial activity creates new ledger or revenue context, keep it inspectable through the existing admin and accounting surfaces or extend them minimally.
- Preserve auditability. An operator should be able to understand what happened financially and competitively.

### 7. Testing and Verification

Add automated coverage for the tournament layer. At minimum, cover:

- tournament creation / listing behavior if added
- successful join and duplicate / invalid join rejection
- balance-gated entry for paid tournaments
- bracket fill and automatic start
- semifinal-to-final advancement
- tournament completion
- refund path for cancelled / failed-start tournaments
- payout and rake accounting for completed tournaments
- integration of forfeit / timeout / disconnect outcomes with bracket progression
- regression coverage confirming existing heads-up matchmaking, replay, escrow, admin, and wallet flows still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No massive multi-table tournament system
- No scheduled long-duration MTT platform
- No blind levels, rebuys, or late registration in this pass
- No PostgreSQL/Redis migration in this sprint
- No unrelated AI-bot work
- No full tournament CMS or advanced operator tooling beyond what the MVP needs

## Implementation Guidance

- Optimize for the business reality already established in this project: human-vs-human competitive play with platform rake.
- Reuse the existing multiplayer match engine, replay pipeline, wallet ledger, and admin visibility as much as possible.
- Favor a narrow, correct sit-and-go tournament over a broad but brittle abstraction.
- Be explicit in the Execution Report about the chosen payout model, refund rules, and how tournament rake is represented.
- If you need to constrain supported stake types or payout structures for MVP safety, do that deliberately and document it clearly.

## Acceptance Criteria

This task is complete only if all of the following are true:

- a user can enter and play through at least one real tournament format
- tournament state is durable enough to track entries, bracket progression, and completion
- paid tournament entry is balance-gated and financially auditable
- refunds and payouts are deterministic and correct for the supported format
- tournament progression handles normal play and abnormal outcomes cleanly
- players can understand the tournament flow from the UI
- tournament activity integrates sensibly with existing replay / admin / accounting systems where relevant
- automated tests for tournament flows exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_12.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the first narrow tournament-mode MVP next. After that, the strongest follow-on options will likely be deeper tournament productization, richer transcript-based analysis, or a later infrastructure migration once live scale actually demands it.