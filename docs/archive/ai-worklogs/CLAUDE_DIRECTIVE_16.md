# Claude Directive 16: Scheduled Tournament and Liquidity Expansion Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_16.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_16.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a hardened, deployable single-node competitive platform
- player-vs-player stake flow, rake, admin visibility, tournament MVP, polished game feel, and brand consistency
- a first engine-backed replay evaluation / PR-style MVP using the Python Gin Rummy engine
- broad automated coverage across both the web platform and Python evaluation layer

The biggest remaining business/product gap is liquidity scaling. Right now the tournament product is still centered on small on-demand sit-and-go brackets. To create real concurrency spikes, retention hooks, and marquee events, the platform needs scheduled tournaments with dynamic bracketing rather than only fill-on-demand SNGs.

## Your Next Task

Build the Scheduled Tournament and Liquidity Expansion sprint for Gin Paradise.

## Primary Objective

Extend the current tournament system into a more operationally real event product: scheduled registrations, variable-size brackets, automatic byes, and round orchestration that can support meaningful concurrency spikes.

## Required Scope

### 1. Scheduled Tournament Lifecycle

- Extend the tournament model to support scheduled events with explicit timing.
- At minimum, support:
  - scheduled start time
  - registration-open state
  - registration-closed / locked state
  - automatic transition to in-progress when the event starts
  - cancellation / refund path when minimum conditions are not met
- Keep the first version operationally predictable rather than overly configurable.

### 2. Admin-Controlled Event Creation

- Add an operator/admin path for creating scheduled tournaments.
- This should be more controlled than the current player-created SNG model.
- Admins should be able to define, at minimum:
  - event name
  - start time
  - buy-in / freeroll status
  - supported field size or bracket cap
  - rake / payout metadata as appropriate
- Preserve server-enforced authorization for any admin creation or control path.

### 3. Variable-Size Brackets and Byes

- Upgrade bracket generation beyond the current fixed 4-player sit-and-go.
- Support variable entrant counts with automatic bye handling when the field is not an exact power of two.
- Prefer a clear and defensible seeding rule for byes. Rating-based seeding is acceptable if that is the best fit with the current platform.
- Auto-advance bye recipients correctly without manual operator intervention.

### 4. Round Orchestration

- Ensure the tournament engine can manage multi-round progression cleanly.
- Later rounds should not start until the prerequisite matches from the current round are resolved.
- Players should have clear waiting states between rounds.
- Existing abnormal outcomes (timeout, forfeit, disconnect) must still advance the bracket correctly.
- Add no-show / unstarted-match handling so a scheduled event cannot stall indefinitely because a match never begins.

### 5. Tournament UI Expansion

- Extend the tournament UI to support scheduled events.
- At minimum, players should be able to:
  - discover upcoming scheduled events
  - see countdown / start timing
  - register or unregister before lock if allowed
  - understand field size, current entrants, and prize structure
  - see bracket state across rounds once the event starts
  - understand whether they are waiting, advancing, eliminated, or complete
- Keep the UI clear and operationally legible. The first goal is usability, not ornament.

### 6. Financial and Audit Integration

- Preserve the existing wallet, ledger, escrow-like tournament accounting, and house-accounting integrity.
- Registration, cancellation, refunds, payouts, and rake must remain deterministic and auditable.
- If scheduled tournaments add new admin/accounting visibility needs, extend the existing admin surface minimally and thoughtfully.

### 7. Testing and Verification

Add automated coverage for the scheduled-event layer. At minimum, cover:

- admin-only creation / control behavior
- registration before start and lock behavior at or near start time
- insufficient-field cancellation and refund behavior
- variable-size bracket generation
- bye assignment and auto-advancement
- round gating (next round waits for current round completion)
- no-show / unstarted-match resolution
- payout and rake behavior for supported event types
- regression coverage confirming existing SNG tournaments, replay evaluation, wallet, admin, and multiplayer flows still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No PostgreSQL/Redis migration in this sprint
- No full massive MTT platform beyond the supported first event format
- No push notification system in this sprint
- No mobile app packaging work in this sprint
- No new replay-evaluation engine rewrite in this sprint

## Implementation Guidance

- Reuse the current tournament system as the base; extend it rather than replacing it.
- Optimize for event-driven liquidity, not tournament-format maximalism.
- If scope must be narrowed, prioritize:
  1. scheduled registration
  2. variable bracket generation with byes
  3. no-show handling
  4. clean operator control
- Keep the first event format honest and supportable. A solid scheduled single-elimination event is better than a half-built giant MTT abstraction.
- In the Execution Report, be explicit about:
  - supported field sizes
  - seeding / bye rules
  - no-show resolution rules
  - which tournament types are admin-only versus player-created

## Acceptance Criteria

This task is complete only if all of the following are true:

- Gin Paradise supports scheduled tournament registration ahead of start time
- admins can create and control the supported scheduled event type securely
- variable-size brackets with byes work for the supported format
- rounds progress correctly without manual intervention
- no-show / unstarted matches do not stall the tournament indefinitely
- financial flows remain deterministic and auditable
- players can understand the scheduled event flow in the UI
- automated tests for the new tournament expansion path exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_16.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the first scheduled-tournament and liquidity-expansion pass next. After that, the strongest follow-on options will likely be deeper evaluation sophistication, tournament history / retention features, or later infrastructure scale-out once live usage demands it.