# Claude Directive 30: Staked Challenges, In-Game Rematch, and Challenge Cleanup Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_30.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_30.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a fully operational challenge-to-match flow where accepted challenges and rematches allocate real room IDs and hand players into live private matches
- a mature competitive core with multiplayer, tournaments, fairness proofs, training/coaching, achievements, cosmetics, premium packaging, seasons, public profiles, and social competition
- a fully green suite with `770/770` tests passing

However, the newest report also identifies the most important remaining friction in this path:

1. Staked challenge rooms still effectively fall back to free-play behavior because stake selection is not wired cleanly through the challenge-room join flow.
2. Rematch is functional but still not exposed in the most natural place: the multiplayer game-over experience.
3. Accepted challenge/rematch rooms can linger indefinitely without TTL cleanup, which weakens polish and state hygiene.

## Your Next Task

Build the Staked Challenges, In-Game Rematch, and Challenge Cleanup sprint for Gin Paradise.

## Primary Objective

Finish the direct-social competition path so player-to-player challenges work correctly for staked play, rematches are available at the moment players want them most, and stale challenge-room state does not accumulate indefinitely.

## Required Scope

### 1. Staked Challenge Handoff

- Wire challenge and rematch stake information cleanly through the full acceptance → room join → match start path.
- Direct challenges that specify a non-free stake should preserve that stake all the way into the actual match flow.
- Preserve all existing wallet, escrow, and settlement guarantees.
- At minimum, support:
  - challenge/rematch stake carried through to room join
  - proper validation if either player can no longer afford the stake
  - clear UX when a staked challenge cannot start

### 2. In-Game Rematch Prompt

- Add a true rematch affordance to the multiplayer game-over / end-of-match experience.
- Players should not have to leave the match flow and go hunting through the Social Hub for the most natural “run it back” action.
- Keep rematch consensual and safe; both players must still agree before a new match starts.
- Reuse existing rematch primitives where possible rather than inventing a parallel system.

### 3. Challenge / Rematch Room TTL Cleanup

- Add cleanup behavior so accepted-but-never-joined challenge rooms and rematch rooms do not linger forever.
- Keep the implementation simple and auditable.
- Be explicit about:
  - what expires
  - when it expires
  - what the user sees after expiry
  - whether notifications/history remain visible after expiry

### 4. Social / Match UX Coherence

- Update the Social Hub and any affected gameplay surfaces so staked challenges, rematches, and expired match-ready states are easy to understand.
- At minimum:
  - show the challenge/rematch stake where relevant
  - differentiate joinable vs expired vs invalid match-ready entries
  - make rematch/game-over behavior feel coherent with the existing social hub

### 5. Testing and Verification

Add automated coverage for this finishing pass. At minimum, cover:

- staked challenge/rematch room handoff
- insufficient-balance or invalid-stake behavior
- in-game rematch prompt and acceptance flow
- TTL expiry / cleanup behavior
- regression coverage confirming multiplayer, wallet, escrow, rake, fairness, social systems, seasons, training, cosmetics, entitlements, tournaments, and admin still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No full spectating system in this sprint
- No broad presence/heartbeat architecture in this sprint
- No irreversible billing/provider integration in this sprint
- No chat or DM system in this sprint
- No weakening of fairness, server authority, stake validation, or escrow protections

## Implementation Guidance

- Treat this as completion of the challenge/rematch product loop, not as a new feature family.
- Preserve the current room-based architecture; do not create a separate special-case game stack for staked challenges.
- Favor explicit user messaging over silent failure when a staked challenge or rematch cannot start.
- If scope must be narrowed, prioritize in this order:
  1. staked challenge/rematch handoff
  2. in-game rematch button/prompt
  3. challenge/rematch room TTL cleanup
  4. extra social-hub polish
- If shared gameplay surfaces are touched, preserve recent Game Room improvements: 4-row suit-based hand layout, live deadwood counter, knock validation, four-color deck support, and dark-surface suit visibility.
- Be explicit in the report about:
  - how stakes now travel through challenge/rematch flows
  - where escrow is enforced
  - what TTL or cleanup rules were added
  - what remaining social-competition friction still exists

## Acceptance Criteria

This task is complete only if all of the following are true:

- staked direct challenges and staked rematches now hand off into real matches without silently degrading to free-play behavior
- multiplayer game-over flow offers a real rematch path using the existing trusted rematch model
- stale accepted challenge/rematch rooms no longer linger indefinitely
- social and gameplay surfaces now present staked challenge/rematch state clearly
- automated tests for this finishing pass exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_30.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new state

## Deliverable Expectation

Complete the last major friction fixes in the direct-social competition path next. After that, the strongest follow-on options will likely be spectator/featured-match surfaces, a fuller cosmetic storefront, or real billing/provider integration depending on product strategy.
