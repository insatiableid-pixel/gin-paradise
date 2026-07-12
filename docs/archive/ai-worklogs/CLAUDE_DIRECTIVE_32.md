# Claude Directive 32: Broadcast Productization, Spectate Preferences, and Live Operations Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_32.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_32.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a mature competitive core with multiplayer, fairness proofs, replays, replay evaluation, AI coaching, wallet/escrow, tournaments, achievements, cosmetics, premium entitlements, seasons, social rivalry, challenge-to-match handoff, and staked rematches
- a completed Featured Matches & Privacy-Safe Spectator MVP with public live discovery, read-only spectator mode, featured eligibility rules, and strict hidden-information boundaries
- a fully green suite with `837/837` tests passing in the latest execution report

However, the spectator layer is still an MVP rather than a fully productized broadcast system:

1. The product can identify admin-featured matches in code, but there is still no admin-facing workflow to curate or operate featured matches inside the product.
2. Players still do not have an explicit, durable preference for whether their non-tournament public matches may be spectated.
3. The platform has live spectator counts, but it does not yet persist or expose useful broadcast metrics such as peak viewers or unique audience for completed matches.
4. The live experience now exists, but it still lacks the operational and measurement layer needed to turn it into a deliberate competitive-broadcast surface.

## Your Next Task

Build the Broadcast Productization, Spectate Preferences, and Live Operations sprint for Gin Paradise.

## Primary Objective

Turn the new spectator MVP into a productized, privacy-aware live-competition layer that admins can operate, players can understand and control, and the product can measure without weakening hidden-information safety or server authority.

## Required Scope

### 1. Admin Featured-Match Operations

- Add secure admin-facing controls for live-match curation.
- Admins must be able to see currently live matches, inspect why they are or are not spectatable, and manually feature or unfeature a match from inside the product.
- Reuse the existing admin backend and admin UI surfaces where practical rather than creating a disconnected control path.
- Preserve existing auth/admin boundaries. Public users must not gain access to room-management or operational controls.

### 2. Durable Player Spectate Preferences

- Add an explicit player preference that controls whether the player allows public spectating for matches that are not inherently public by rule.
- Apply that preference to the current featured-eligibility system in a clear, defensible way.
- A safe first pass is acceptable, but it must be explicit in both code and reporting which match types:
  - are always public
  - require both players to allow spectating
  - remain non-spectatable
- Tournament matches may remain public by rule if that is the cleanest model.
- Do not silently turn private challenge matches into public broadcasts by default.

### 3. Spectator Analytics and Durable Broadcast Metrics

- Add a first useful layer of spectator analytics for live and completed matches.
- At minimum, track and expose durable metrics such as:
  - peak concurrent spectators
  - total unique spectators per match, or another equally defensible audience metric
  - whether a match was manually featured
- Persist these metrics when a match completes so they do not disappear with in-memory room cleanup.
- Make the metrics available in at least one operational/admin surface and, where appropriate, on the public featured/live surfaces.

### 4. Broadcast UX Polish

- Improve the live/featured experience so it feels more intentional as a competitive broadcast surface, not just a transport demo.
- At minimum, players or spectators should be able to:
  - understand when a match is manually featured versus organically eligible
  - see current spectator context clearly
  - understand that the watch experience is read-only and privacy-safe
  - see coherent post-match or match-over context where appropriate
- Reuse existing table and multiplayer presentation patterns so the watch experience still feels part of the same product.

### 5. Fairness, Privacy, and Safety Boundaries

- Do not weaken fairness, hidden information, or server authority.
- Spectators still must not receive concealed hands during live play.
- Do not add spectator chat or interaction in this sprint.
- If any match category is unsafe or ambiguous under the new preference model, leave it out and state so explicitly.
- Be especially careful that admin featuring does not create accidental exposure of matches that should remain private.

### 6. Testing and Verification

Add automated coverage for the broadcast-productization pass. At minimum, cover:

- admin authorization and live-match featuring controls
- player spectate preference persistence and eligibility enforcement
- featured-match listing behavior after preference/feature changes
- spectator analytics tracking and persistence
- watch-surface/read-only data behavior
- regression coverage confirming multiplayer, fairness, wallet, escrow, rake, tournaments, social, seasons, training, cosmetics, entitlements, and admin systems still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No spectator chat, reactions, or direct interaction in this sprint
- No hidden-hand reveal during live play
- No broad streaming/video infrastructure
- No billing/provider integration in this sprint
- No exposure of private challenge matches by default
- No weakening of Trust Shield, escrow, or room authority

## Implementation Guidance

- Favor explicit spectator/public-state projection and explicit eligibility logic over ad hoc frontend filtering.
- Reuse the existing admin dashboard and spectator architecture where possible so new operations inherit the same trust boundaries.
- Prefer durable storage for any preference or metric that affects product behavior or reporting.
- Keep the first preference model simple and explain it precisely in the report.
- If scope must be narrowed, prioritize in this order:
  1. durable player spectate preference enforcement
  2. admin feature/unfeature controls
  3. durable spectator metrics
  4. broadcast UX polish
- Be explicit in the report about:
  - which match types are always public
  - which match types require player consent
  - which match types remain excluded
  - which spectator metrics are tracked live versus persisted after match completion

## Acceptance Criteria

This task is complete only if all of the following are true:

- admins can curate featured live matches through a real in-product control path
- the spectator eligibility system respects an explicit player preference for non-rule-public matches
- private matches are not accidentally exposed by the new system
- Gin Paradise records a durable first layer of spectator/broadcast metrics for completed matches
- the featured/watch experience clearly communicates broadcast context while remaining read-only and privacy-safe
- automated tests for the new broadcast operations layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_32.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new state

## Deliverable Expectation

Complete the broadcast productization layer next. After that, the strongest follow-on options will likely be fuller cosmetic application/store polish or provider-backed billing and premium activation, depending on product strategy.
