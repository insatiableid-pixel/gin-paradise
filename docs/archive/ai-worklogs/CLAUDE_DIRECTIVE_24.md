# Claude Directive 24: Live Achievement Triggers and Instant Progress Feedback Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_24.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_24.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a strong training moat with durable coaching cache, engine evaluation, progression signals, and coaching timeline features
- a rich profile, achievement, and prestige layer with server-backed awards and public profiles
- a fully green suite with `551/551` tests passing

However, one important retention gap remains:

1. Achievements and prestige are still mostly realized on profile load or manual backfill rather than at the moment the player earns them.
2. The platform has the data for meaningful progress moments, but not yet the instant feedback loop that makes those moments feel rewarding.
3. Coaching and training progress are now strong, but the game still does not celebrate those wins in real time.

## Your Next Task

Build the Live Achievement Triggers and Instant Progress Feedback sprint for Gin Paradise.

## Primary Objective

Make player progress feel alive by awarding achievements and prestige as soon as they are earned, surfacing those unlocks immediately in the product, and turning key competitive/training milestones into real-time retention moments.

## Required Scope

### 1. Server-Side Live Achievement Triggers

- Wire the existing achievement engine into the real places where achievements are actually earned.
- At minimum, evaluate achievement triggers after the relevant events complete successfully, such as:
  - match completion
  - tournament advancement / tournament finish
  - replay evaluation completion where training achievements depend on engine metrics
  - coaching generation completion where that is relevant to achievement definitions
- Preserve deterministic server-side logic and duplicate prevention.
- Do not move award logic to the client.

### 2. Immediate Unlock Feedback

- Add a first-class user-facing unlock flow so players see newly earned achievements/prestige without needing to visit Profile or click Backfill.
- This can be post-match, post-training, or dashboard-visible depending on what fits best, but it should feel immediate and clearly tied to what the player just did.
- At minimum, consider:
  - achievement unlock toast/modal/banner
  - newly unlocked title/badge/frame callout
  - lightweight “what changed” summary after a match or training event
- Keep it celebratory but not noisy.

### 3. Recent Progress / Activity Surface

- Add a lightweight activity or progression surface that shows recent unlocks and milestones.
- This can live on Dashboard, Profile, or both.
- At minimum, a player should be able to see recent achievements or newly unlocked prestige items without hunting for them.

### 4. Prestige Activation Flow

- If a player unlocks a prestige item, make it easy to understand and equip it.
- You do not need to auto-equip everything, but the path from unlock to use should be obvious.
- If a new badge/title/frame is unlocked, there should be a clear route to activate it from the unlock feedback or profile area.

### 5. Training and Coaching Progress Moments

- Use the newly completed training/coaching layers as part of the progress loop where it makes sense.
- At minimum, if a player earns a training-related achievement or hits a notable improvement milestone, surface that in a timely and understandable way.
- Keep the distinction between engine truth, coaching narrative, and achievement logic explicit.

### 6. Testing and Verification

Add automated coverage for the live-trigger pass. At minimum, cover:

- achievement evaluation after match completion and other supported trigger points
- duplicate-prevention under repeated trigger calls
- unlock feedback or activity-surface data loading
- prestige unlock visibility after new awards
- regression coverage confirming profile, training, coaching, tournaments, replays, fairness, wallet, and multiplayer still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No gameplay-affecting rewards or pay-to-win systems
- No full cosmetic store or payment flow in this sprint
- No subscription packaging in this sprint
- No new fairness algorithm work in this sprint
- No infrastructure migration in this sprint
- No regression of the recently completed Game Room layout improvements in this sprint

## Implementation Guidance

- Treat this as completing the retention loop around the achievement/prestige system, not as adding random notifications.
- The best outcome is that a player finishes something meaningful and immediately feels rewarded by the platform.
- Reuse the existing achievement engine and prestige persistence rather than creating parallel award state.
- If shared presentation helpers are touched, preserve the recent Game Room improvements: 4-row suit-based hand layout, live deadwood counter, knock validation, four-color deck support, and dark-surface suit visibility.
- If scope must be narrowed, prioritize in this order:
  1. server-side live triggers
  2. immediate unlock feedback
  3. recent activity/progress surface
  4. prestige activation polish
- Be explicit in the report about:
  - which trigger points were wired
  - what user-facing feedback now appears
  - how duplicate awards remain impossible
  - whether any achievement classes still require manual/backfill evaluation

## Acceptance Criteria

This task is complete only if all of the following are true:

- achievements are awarded at live trigger points rather than relying primarily on profile-load/backfill flows
- players receive clear, timely feedback when they unlock achievements or prestige
- recent progress or unlock history is visible in the product
- prestige unlocks have an obvious path to activation/use
- automated tests for the live-trigger/progress layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_24.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the live achievement-trigger and instant-progress-feedback pass next. After that, the strongest follow-on options will likely be a monetizable cosmetic system, subscription packaging around the training/coaching moat, or deeper public-profile/social competition layers.
