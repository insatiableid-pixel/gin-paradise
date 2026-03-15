# Claude Directive 22: Profile, Achievement, and Prestige Layer Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_22.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_22.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a strong competitive core with tournaments, trust shield, replay evaluation, and auto-prepared training
- a meaningful analytical moat with progression signals and session review
- a fully green suite with `485/485` tests passing

However, one major product/retention layer is still thin:

1. The existing Profile surface is still comparatively shallow relative to the rest of the platform.
2. Player improvement, tournament finishes, and training achievements are not yet being turned into durable status or visible milestones.
3. The product still lacks a real prestige layer that can later support retention and monetization without affecting gameplay integrity.

## Your Next Task

Build the Profile, Achievement, and Prestige Layer sprint for Gin Paradise.

## Primary Objective

Turn player history and improvement into visible identity, progression, and status so the platform feels more like a living competitive ecosystem and less like a set of isolated tools.

## Required Scope

### 1. Richer Player Profile

- Upgrade the existing Profile experience into a more complete player identity surface.
- At minimum, the profile should surface some combination of:
  - lifetime match record and rating context
  - tournament participation / finishes where available
  - training highlights or recent improvement indicators
  - best recent achievements or milestones
  - selected visible prestige elements (title, badge, avatar frame, etc.)
- Keep the presentation productized and legible rather than dumping raw stats.

### 2. Achievement Framework

- Add a server-backed achievement or milestone system rather than only frontend-derived badges.
- The first pass should include a practical initial set of achievements spanning multiple activity types, such as:
  - competitive play milestones
  - tournament participation / placement
  - training/improvement milestones
  - streaks or consistency markers
  - trust/proof or replay-analysis engagement if that fits naturally
- Achievements should be durable, queryable, and timestamped once earned.

### 3. Prestige / Identity Layer

- Add a first meaningful non-gameplay prestige layer.
- This does not need to be a monetized store yet, but it should create the foundation for visible status.
- Examples include:
  - profile titles
  - achievement badges
  - unlocked avatar treatments
  - deck/back/frame identity hooks if there is a clean place to surface them
- Do not add anything that affects gameplay fairness or card readability.

### 4. Public or Shareable Competitive Identity

- Make player identity more socially useful where practical.
- If feasible in this pass, add a public-profile or profile-sharing path so players can show their standing, achievements, and improvement.
- If a full public route is too large, at minimum make the profile easier to reference and richer as an in-product identity surface.

### 5. Data Integrity and Award Logic

- Achievement and prestige logic must be deterministic and resistant to duplicate awards.
- Use explicit server-side criteria rather than trusting frontend calculations.
- Be careful about retroactive awarding: if you support backfill for past history, do it intentionally and document the rule.
- Keep the report explicit about:
  - what is awarded automatically
  - whether historical backfill exists
  - how duplicate issuance is prevented

### 6. Testing and Verification

Add automated coverage for the new profile/prestige layer. At minimum, cover:

- achievement award criteria and duplicate prevention
- profile API/data loading
- any public/shareable profile access rules
- training/tournament/rating data integration into profile summaries
- regression coverage confirming training, replays, tournaments, wallet, fairness, and multiplayer still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No gameplay-affecting items or pay-to-win mechanics
- No full cosmetic store or checkout flow in this sprint
- No subscription gating in this sprint
- No infrastructure migration in this sprint
- No new fairness algorithm work in this sprint

## Implementation Guidance

- Treat this as the first real retention and prestige layer, not as superficial decoration.
- Reuse the strong existing data the platform already has: rating, tournaments, training, replays, and trust signals.
- If scope must be narrowed, prioritize in this order:
  1. server-backed achievements
  2. richer profile surface
  3. visible prestige/title/badge layer
  4. public/shareable profile path
- Favor a small number of meaningful, well-earned milestones over a giant pile of low-signal badges.

## Acceptance Criteria

This task is complete only if all of the following are true:

- Gin Paradise has a materially richer profile experience
- there is a server-backed achievement/milestone system with deterministic award logic
- players can display at least one meaningful prestige/identity layer derived from real platform activity
- achievement/prestige data survives normally through persistence and reloads
- automated tests for the new profile/achievement layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_22.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the first real profile/achievement/prestige pass next. After that, the strongest follow-on options will likely be AI coaching integration into the training timeline, monetizable cosmetic systems, or subscription packaging once the identity and training layers feel strong enough to monetize cleanly.
