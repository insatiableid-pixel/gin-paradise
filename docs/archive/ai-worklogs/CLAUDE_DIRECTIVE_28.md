# Claude Directive 28: Social Challenge, Follow, and Rematch Loop Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_28.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_28.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a hardened competitive core with multiplayer, tournaments, fairness proofs, replay evaluation, training, coaching, achievements, cosmetics, and premium packaging
- a first real public competition layer with seasons, seasonal leaderboards, richer public profiles, and leaderboard-to-profile drilldown
- a fully green suite with `680/680` tests passing

However, one major retention layer is still underdeveloped:

1. Players can inspect each other publicly, but they still cannot form lightweight social connections inside the product.
2. There is no first-class challenge/rematch loop that turns public identity into repeated head-to-head competition.
3. The platform still lacks a durable rivalry/follow-up loop that makes strong players want to come back for specific opponents, not just anonymous queue games.

## Your Next Task

Build the Social Challenge, Follow, and Rematch Loop sprint for Gin Paradise.

## Primary Objective

Turn Gin Paradise's new public competition surfaces into an actual social retention loop by letting players follow notable opponents, challenge them directly, and easily run back meaningful heads-up matches.

## Required Scope

### 1. Lightweight Social Graph

- Add a simple social relationship layer suitable for a competitive platform.
- Favor a lightweight follow model over a complicated full social network.
- At minimum, support:
  - following another player from public competitive surfaces
  - unfollowing that player
  - viewing basic counts or lists where appropriate
- Keep privacy and abuse boundaries sensible.

### 2. Direct Challenge Flow

- Build a first-class challenge flow on top of the existing heads-up multiplayer foundation.
- Players should be able to challenge another player directly from appropriate surfaces such as:
  - public profile
  - leaderboard inspect/profile surfaces
  - recent competitive context where appropriate
- The challenge flow should reuse existing match primitives where possible instead of creating a separate rules stack.
- At minimum, support:
  - send challenge
  - receive challenge
  - accept / decline / expire challenge
  - clear handling when a player is offline, already in a match, or no longer eligible

### 3. Rematch Loop

- Add an immediate rematch option after a completed heads-up match where it is appropriate.
- Keep this consensual: both players must opt in before a rematch starts.
- Reuse prior match context sensibly where possible, such as:
  - same format
  - same stakes if still valid
  - same opponent
- Be explicit about any constraints that prevent automatic rematch (insufficient balance, player left, account state, etc.).

### 4. Social/Challenge Notifications

- Build a minimal, durable notification/inbox surface for challenge-related events.
- At minimum, players should be able to understand:
  - who challenged them
  - whether a challenge is pending, accepted, declined, expired, or no longer available
  - when a rematch invite is waiting
- Reuse existing notification patterns/infrastructure where sensible, but keep the result coherent for social competition rather than achievement-only events.

### 5. Profile and Competitive Context Integration

- Expand public/social surfaces so they feel action-oriented, not just informational.
- At minimum:
  - public player profile should expose follow/challenge entry points where appropriate
  - leaderboard/profile drilldown should connect naturally into challenge actions
  - if feasible, surface lightweight head-to-head or rivalry context without leaking private/internal data
- Preserve sensible privacy boundaries and do not expose hidden internal metrics.

### 6. Testing and Verification

Add automated coverage for the social challenge pass. At minimum, cover:

- follow/unfollow behavior and permission boundaries
- challenge creation, acceptance, decline, expiry, and invalid-state handling
- rematch initiation and validation
- notification/inbox behavior for challenge events
- regression coverage confirming gameplay, multiplayer, fairness, seasons, profiles, coaching, cosmetics, entitlements, tournaments, wallet, and admin systems still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No full chat or direct-messaging system in this sprint
- No spectating system in this sprint
- No irreversible billing/provider integration in this sprint
- No gameplay-affecting social rewards or pay-to-win mechanics
- No regression of the recently completed seasonal leaderboard/public profile work
- No weakening of fairness, auth, stake validation, or room-authority rules

## Implementation Guidance

- Treat this as a competitive-social layer, not as a generic social-media feature set.
- Favor a clean, low-friction challenge experience over a broad but shallow friend system.
- Reuse the existing multiplayer and notification architecture wherever possible.
- Do not create alternate game-state authority paths for challenges or rematches; they should still flow through the trusted multiplayer system.
- Preserve the current season/public-profile momentum: this sprint should make those surfaces more actionable.
- If scope must be narrowed, prioritize in this order:
  1. direct challenge flow
  2. rematch loop
  3. lightweight follow model
  4. challenge notifications/inbox
  5. extra rivalry context
- If shared presentation helpers are touched, preserve recent Game Room improvements: 4-row suit-based hand layout, live deadwood counter, knock validation, four-color deck support, and dark-surface suit visibility.
- Be explicit in the report about:
  - how challenges map onto the existing room/match system
  - what challenge expiry or invalidation rules exist
  - what social data is intentionally public versus private
  - what larger social/community features remain out of scope

## Acceptance Criteria

This task is complete only if all of the following are true:

- players can create meaningful direct head-to-head challenges from public competitive surfaces
- players can follow and unfollow other players through a lightweight social model
- players can participate in a consensual rematch flow after completed heads-up matches
- challenge/rematch state is visible through a coherent notification or inbox surface
- public profile / leaderboard surfaces now connect into a stronger rivalry-style competition loop
- automated tests for the social challenge layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_28.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the first real direct-social competition loop next. After that, the strongest follow-on options will likely be spectator/featured-match surfaces, a fuller cosmetic storefront, or real billing/provider integration depending on product strategy.
