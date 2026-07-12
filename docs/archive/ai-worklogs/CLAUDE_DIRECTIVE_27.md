# Claude Directive 27: Seasonal Competition and Public Social Layer Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_27.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_27.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a strong competitive core with trust, tournaments, coaching, achievements, cosmetics, and premium packaging
- public profile plumbing and leaderboard foundations already in place
- a fully green suite with `614/614` tests passing

However, one major engagement layer is still underdeveloped:

1. Public player identity and leaderboard competition are still thinner than the rest of the platform.
2. There is no real seasonal competition loop that gives players a fresh ladder to chase.
3. The product lacks a strong public/social status surface tying together rating, achievements, cosmetics, and training progress.

## Your Next Task

Build the Seasonal Competition and Public Social Layer sprint for Gin Paradise.

## Primary Objective

Turn Gin Paradise into a stronger public competitive ecosystem by adding a season-based competition loop and richer public-facing identity/leaderboard surfaces that make status worth chasing.

## Required Scope

### 1. Season Model

- Add a first-class season concept to the platform.
- At minimum, support:
  - current active season metadata
  - season start/end boundaries
  - a stable season identifier
  - room for future archived seasons
- Keep the first version operationally simple and understandable.
- Be explicit about whether core lifetime rating remains unchanged or whether a separate seasonal metric is introduced.

### 2. Seasonal Leaderboard

- Extend the leaderboard experience to surface seasonal competition, not just lifetime standing.
- At minimum, players should be able to understand:
  - current season ranking or season standing
  - how season results are measured
  - who the top seasonal players are
- If scope must be narrowed, a season-specific leaderboard alongside the current lifetime board is acceptable.

### 3. Public Profile Expansion

- Build on the existing public profile path so player pages feel like true public competitive identities.
- At minimum, public profile surfaces should tie together some combination of:
  - rating and competitive record
  - seasonal standing
  - achievements/prestige/cosmetics currently displayed
  - recent progress or public activity highlights
  - tournament or training highlights where appropriate
- Keep privacy sensible and do not expose sensitive/internal-only data.

### 4. Leaderboard-to-Profile Competition Loop

- Make it easy to move from leaderboard discovery to player identity.
- At minimum, leaderboard entries should have a clear route into a richer public profile/inspect experience.
- The product should feel more socially legible: “Who is this player, why are they ranked here, and what have they earned?”

### 5. Season/Status Presentation

- Add clear UI cues that make the season feel real, such as:
  - season badges or labels
  - current season countdown or status marker
  - current season placement callouts
  - season-specific prestige/status markers if straightforward
- Do not let this become noisy or confusing.

### 6. Testing and Verification

Add automated coverage for the season/social pass. At minimum, cover:

- season metadata retrieval
- leaderboard season behavior
- public profile data shape and privacy boundaries
- leaderboard/profile integration
- regression coverage confirming gameplay, trust, coaching, training, profile, cosmetics, entitlements, wallet, tournaments, and multiplayer still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No gameplay-affecting rewards or pay-to-win systems
- No irreversible billing integration in this sprint
- No live chat/direct messaging system in this sprint
- No full spectating system in this sprint
- No infrastructure migration in this sprint
- No regression of the recently completed Game Room layout improvements in this sprint

## Implementation Guidance

- Treat this as the first real public competition layer, not as cosmetic re-labeling.
- Favor a simple, legible season model over a complicated reset economy.
- Preserve the value of the current lifetime identity while adding a fresh public ladder to chase.
- If shared presentation helpers are touched, preserve the recent Game Room improvements: 4-row suit-based hand layout, live deadwood counter, knock validation, four-color deck support, and dark-surface suit visibility.
- If scope must be narrowed, prioritize in this order:
  1. season model
  2. seasonal leaderboard
  3. richer public profile
  4. leaderboard-to-profile drilldown
- Be explicit in the report about:
  - how season standings are calculated
  - how season data coexists with lifetime rating
  - what public data is intentionally exposed
  - what future season/archive work remains

## Acceptance Criteria

This task is complete only if all of the following are true:

- Gin Paradise has a first-class current season concept
- players can view a meaningful season-based competition surface
- public player identity is materially richer than before
- leaderboard and public-profile surfaces now work together as a coherent competition loop
- automated tests for the season/social layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_27.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the first seasonal competition and public social layer next. After that, the strongest follow-on options will likely be real billing integration, a fuller cosmetic storefront, or more advanced public-competition features once the social loop proves sticky.
