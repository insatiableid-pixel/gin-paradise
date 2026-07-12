# Claude Directive 43: Next-Wave User-Facing Tropical Alignment for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_43.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_43.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

Gin Paradise now has:

- a live tropical paradise identity across Auth, Dashboard, Layout, all game surfaces, and five high-traffic secondary pages
- a shared card visual system that keeps the core play experience coherent
- a corrected desktop board composition validated in the running app

That means the product’s primary loop now feels much more unified:

- enter the app
- see the Dashboard
- play the game
- visit Wallet / Premium / Daily / Profile / Leaderboard

However, the product still visibly fractures when users move into the remaining user-facing feature pages.

`EXECUTION_REPORT_42.md` explicitly deferred the next wave:

- `SocialHub.tsx`
- `Replays.tsx`
- `Tournaments.tsx`
- `Cosmetics.tsx`
- `Training.tsx`
- `Analysis.tsx`
- `FeaturedMatches.tsx`

These are all still part of the player-facing experience. If they remain in the older indigo / zinc language, the product still feels only partially transformed.

The next highest-value step is therefore to finish the next wave of player-facing tropical alignment while still deferring lower-priority internal surfaces such as Admin and utility surfaces such as Fairness.

## Your Next Task

Build the Next-Wave User-Facing Tropical Alignment sprint for Gin Paradise.

## Primary Objective

Extend the tropical paradise visual system to the remaining user-facing secondary pages so that competitive, social, replay, event, and coaching journeys feel like they belong to the same product as the game board and Dashboard.

The goal is product-wide continuity across the full player journey, not just the highest-traffic landing surfaces.

## Required Scope

### 1. Reuse and Strengthen Secondary-Surface Theme Primitives

Do not treat each page as a one-off reskin.

At minimum, reuse or extend the secondary-surface patterns already established in the last sprint for:

- page backgrounds
- content shells / cards
- tabs / segmented controls
- badges / stat panels
- CTA hierarchy
- inputs / selectors / filters
- empty states / banners / section headers

Prefer shared patterns over copy-pasted page-specific styling drift.

### 2. Theme the Remaining User-Facing Secondary Pages

At minimum, bring the following pages materially into the tropical paradise system:

- `src/pages/Training.tsx`
- `src/pages/Replays.tsx`
- `src/pages/Tournaments.tsx`
- `src/pages/SocialHub.tsx`
- `src/pages/FeaturedMatches.tsx`
- `src/pages/Analysis.tsx`
- `src/pages/Cosmetics.tsx`

These pages cover:

- coaching / improvement
- replay review
- events / competition
- social connection
- live discovery
- premium analytical value
- cosmetic progression / collection

They should no longer feel like a leftover product tier.

### 3. Preserve Functional Clarity on Dense Pages

Some of these pages are information-heavy and interaction-rich.

Preserve:

- Training progression readability
- Replay transcript and inspection clarity
- Tournament discovery / join state clarity
- Social notifications / challenge state clarity
- Featured match discovery clarity
- Analysis readability for coaching content
- Cosmetics browsing, rarity, ownership, and equip/purchase clarity

Theme should improve cohesion without making dense screens harder to scan.

### 4. Keep the Competitive Product Feel Intact

This sprint should not turn the secondary pages into decorative mood boards.

At minimum:

- maintain strong information hierarchy
- keep premium surfaces feeling high-value, not cluttered
- keep live / competitive surfaces feeling energetic and credible
- keep collection surfaces feeling rewarding but still readable

The tropical system should support the product, not overwhelm it.

### 5. Keep Scope Disciplined

Do not sprawl into everything remaining.

The following may remain deferred unless they fall out cleanly:

- `src/pages/Fairness.tsx`
- `src/pages/AdminDashboard.tsx`

Those are not the priority for this pass.

### 6. Verification

Because this sprint is visual and cross-page, verification must be explicit.

At minimum:

- run lint / typecheck
- run any practical build or regression checks
- manually inspect the newly themed pages if the environment allows
- document exactly which pages were aligned in this sprint
- document which pages remain deferred afterward

If practical, note whether transitions between Dashboard / Play and these next-wave pages now feel continuous.

## Non-Goals for This Pass

- No new backend systems
- No gameplay mechanic changes
- No major board-layout rewrite
- No admin re-theme unless it falls out very naturally
- No fairness / utility-surface redesign unless it falls out very naturally

This sprint is about the remaining player-facing pages first.

## Implementation Guidance

- Reuse the established emerald / amber / gold language consistently.
- Keep dense pages cleaner than the board, not equally busy.
- Favor shared shell components or repeated class patterns if that reduces drift.
- Keep CTAs and active-state indicators consistent with the newer themed pages.
- If scope must narrow, prioritize in this order:
  1. `Training.tsx`
  2. `Replays.tsx`
  3. `Tournaments.tsx`
  4. `SocialHub.tsx`
  5. `FeaturedMatches.tsx`
  6. `Analysis.tsx`
  7. `Cosmetics.tsx`

## Acceptance Criteria

This task is complete only if all of the following are true:

- the required user-facing secondary pages have been brought materially into the tropical paradise visual system
- the pages remain functional and readable
- the design feels continuous with the Dashboard and game surfaces rather than reverting to the older indigo / zinc language
- verification is performed and documented clearly
- a comprehensive `EXECUTION_REPORT_43.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects what is finished and what remains deferred

## Deliverable Expectation

Complete the next wave of user-facing tropical alignment next.

After that, the strongest follow-on options will likely be:

- the final internal / utility alignment wave (Admin, Fairness)
- motion polish for gameplay interactions
- deeper product-wide refinement of empty states, banners, and CTA patterns
