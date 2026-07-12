# Claude Directive 29: Seamless Challenge-to-Match Activation Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_29.md`.
3. You must also emit an updated project status report and save it to the workspace root as `PROJECT_STATUS.md`.
4. The execution report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
5. The updated `PROJECT_STATUS.md` must reflect the true current state of the product and must not overclaim completed scope.
6. In particular, if accepted challenges still do not hand players into a real live private match flow, do not describe the rematch/challenge loop as fully complete.
7. The task is not complete until the code, verification, `EXECUTION_REPORT_29.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a fully featured competitive core with multiplayer, tournaments, fairness proofs, training/coaching, achievements, cosmetics, premium packaging, seasons, and public profiles
- a newly completed social layer with follows, direct challenges, challenge inbox/history, head-to-head rivalry context, and a Social Hub
- a fully green suite with `729/729` tests passing

However, the most important friction in the new social loop is still unresolved:

1. Accepted challenges do not yet hand players directly into a live private match flow.
2. The challenge/rematch system still feels one step removed from actual gameplay.
3. Players can express intent to compete, but the product does not yet convert that intent into a seamless head-to-head session.

## Your Next Task

Build the Seamless Challenge-to-Match Activation sprint for Gin Paradise.

## Primary Objective

Turn the new challenge/rematch layer into a true gameplay loop by making accepted challenges and consensual rematches flow directly into a real private match/lobby experience with minimal friction and no compromise to the server-authoritative model.

## Required Scope

### 1. Challenge Acceptance → Live Match Handoff

- When a valid direct challenge is accepted, the product should move beyond “accepted intent” and hand both players into a concrete match-start flow.
- Reuse the existing trusted multiplayer room/lobby system wherever possible.
- At minimum, support:
  - an accepted challenge resulting in a real, actionable private match destination
  - clear join/start behavior for both players
  - explicit handling for stale/invalid conditions such as disconnects, eligibility changes, or balance problems

### 2. Rematch Activation Flow

- Upgrade rematch from a social concept into an actual gameplay handoff.
- After a completed heads-up match, if both players opt in, the system should create a concrete rematch path rather than leaving them to restart manually.
- Reuse prior context sensibly where valid:
  - same opponent
  - same match format
  - same stakes if still allowed
- Be explicit about when rematch creation is blocked and why.

### 3. Availability and Status Cues

- Add lightweight status cues that make challenges more actionable and less confusing.
- At minimum, help the user understand whether the other player is:
  - available to challenge
  - already busy/in match
  - already connected to an accepted challenge flow
- Keep this lightweight and operationally simple; do not build a full chat/presence platform.

### 4. Social Hub / Profile Integration

- Update the new social surfaces so challenge state feels coherent end to end.
- At minimum:
  - accepted challenges should expose a clear path into the live match destination
  - public profile / social hub should reflect actionable state where appropriate
  - challenge/rematch actions should feel tied to actual play, not just inbox management

### 5. Validation, Escrow, and Safety Boundaries

- Preserve all existing trust and match-authority guarantees.
- Ensure challenge/rematch handoff does not bypass:
  - auth/session validation
  - stake compatibility checks
  - wallet / escrow safety rules
  - multiplayer room authority
- Be careful with edge cases like insufficient balance after acceptance but before match start.

### 6. Testing and Verification

Add automated coverage for the challenge-to-match activation pass. At minimum, cover:

- accepted challenge handoff into a real match/lobby path
- rematch creation and validation
- invalid/stale challenge handling
- busy-state / availability behavior
- regression coverage confirming multiplayer, fairness, wallet, escrow, seasons, profiles, social systems, tournaments, training, cosmetics, entitlements, and admin still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No full chat or DM system in this sprint
- No spectating system in this sprint
- No irreversible billing/provider integration in this sprint
- No weakening of fairness, match authority, or escrow protections
- No broad infrastructure migration for presence/state in this sprint
- No regression of the newly completed seasonal, profile, or social hub work

## Implementation Guidance

- Treat this as completion of the social competition loop, not as a separate matchmaking product.
- Reuse existing private room / multiplayer machinery instead of inventing a parallel match stack.
- Keep the handoff understandable for normal players: challenge, accept, join, play.
- Favor deterministic and explicit state transitions over ambiguous UI states.
- If scope must be narrowed, prioritize in this order:
  1. accepted challenge → real private match handoff
  2. consensual rematch → real private match handoff
  3. status/availability cues
  4. deeper hub/profile polish
- If shared gameplay surfaces are touched, preserve recent Game Room improvements: 4-row suit-based hand layout, live deadwood counter, knock validation, four-color deck support, and dark-surface suit visibility.
- Be explicit in the report about:
  - how accepted challenges map onto the existing room system
  - how rematches are created safely
  - what availability states exist and how they are derived
  - what unresolved multiplayer-social edge cases remain
- If the updated `PROJECT_STATUS.md` describes the social/challenge layer, make sure its wording matches reality precisely, especially around whether challenge acceptance/rematch now creates a real match handoff or still stops at intent.

## Acceptance Criteria

This task is complete only if all of the following are true:

- accepted direct challenges now lead into a real, actionable private match flow
- consensual rematches after heads-up play now lead into a real, actionable private match flow
- players can understand whether a challenge is actionable based on lightweight status cues
- social hub / profile surfaces now connect clearly into actual gameplay rather than stopping at intent
- automated tests for the challenge-to-match layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_29.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects whether the gameplay handoff is truly complete

## Deliverable Expectation

Complete the gameplay handoff layer for social competition next. After that, the strongest follow-on options will likely be spectator/featured-match surfaces, a fuller cosmetic storefront, or real billing/provider integration depending on product strategy.
