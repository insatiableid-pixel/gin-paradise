# Claude Directive 42: High-Traffic Secondary Surface Tropical Alignment for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_42.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_42.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

Gin Paradise now has:

- a live tropical paradise identity across Auth, Dashboard, Layout, and the core game surfaces
- a shared card visual system that keeps the board experience coherent
- a corrected desktop board composition validated in the running app

That is strong progress. The highest-traffic gameplay surfaces now feel like one product.

The clearest remaining UX gap is what happens after a player leaves those surfaces.

`EXECUTION_REPORT_41.md` explicitly calls out the next step:

- product-wide tropical alignment across remaining secondary pages

Right now, users can move from a polished tropical game board into secondary screens that still fall back to the old indigo / zinc product language. That creates a visible break in brand cohesion, especially on pages tied to:

- retention
- monetization
- player identity
- competitive status

The next highest-value step is therefore not another gameplay-only refinement. It is to extend the tropical paradise system into the most important secondary surfaces first.

## Your Next Task

Build the High-Traffic Secondary Surface Tropical Alignment sprint for Gin Paradise.

## Primary Objective

Bring the most frequently visited non-game pages into the same tropical paradise visual identity as the live game surfaces, without destabilizing their existing functionality.

The goal is that a user moving through the product should feel continuous brand coherence across:

- play
- daily return
- wallet / premium commerce
- identity / ranking surfaces

## Required Scope

### 1. Create or Reuse a Secondary-Surface Theme System

Do not theme each page as a one-off.

At minimum, establish or extend reusable patterns for:

- page backgrounds
- section shells / panels
- header bands / hero sections
- badges / pills / stat cards
- tabs / filter controls
- CTA button hierarchy

These should clearly inherit from the tropical paradise system already used on the primary surfaces.

### 2. Align the Highest-Value Secondary Pages

At minimum, theme the following pages into the tropical paradise system:

- `src/pages/Wallet.tsx`
- `src/pages/Premium.tsx`
- `src/pages/DailyHub.tsx`
- `src/pages/Profile.tsx`
- `src/pages/Leaderboard.tsx`

These pages matter because they cover:

- monetization
- retention
- player identity
- competitive aspiration

They should no longer feel like a different product from the board.

### 3. Preserve Page-Specific Functionality and Clarity

This is a brand-alignment sprint, not a feature rewrite.

Preserve:

- Wallet package clarity and transaction readability
- Premium plan comparison and subscription CTAs
- DailyHub mission / streak / puzzle usability
- Profile information density and achievement visibility
- Leaderboard readability and ranking hierarchy

Do not sacrifice information clarity for theme.

### 4. Improve Cross-Page Visual Coherence

At minimum:

- background treatments should feel related to the game surfaces
- primary CTAs should use the established warm gold / tropical palette appropriately
- emerald / felt / glass / wood cues should feel consistent instead of arbitrary
- typography, spacing, and card shells should not snap back to old indigo dashboard language

This should feel like product-wide design continuation, not a skin pasted on top.

### 5. Keep Scope Disciplined

There are many remaining secondary pages. Do not over-sprawl this sprint.

Pages such as:

- `SocialHub.tsx`
- `Replays.tsx`
- `Tournaments.tsx`
- `Cosmetics.tsx`
- `FeaturedMatches.tsx`
- `AdminDashboard.tsx`
- `Analysis.tsx`
- `Fairness.tsx`

may remain for later unless they fit cleanly after the required set above.

Depth on the required pages is more important than shallow changes everywhere.

### 6. Verification

Because this sprint is visual and navigational, verification must be explicit.

At minimum:

- run lint / typecheck
- run any practical build or regression checks
- manually inspect the themed pages if the environment allows
- document exactly which pages were aligned in this sprint
- document which pages remain deferred

If practical, note whether the transitions between Dashboard -> Daily/Wallet/Premium/Profile/Leaderboard now feel continuous.

## Non-Goals for This Pass

- No new backend systems
- No gameplay mechanic changes
- No major board-layout changes
- No broad admin or fairness redesign unless it cleanly falls out later
- No attempt to fully theme every remaining page in one pass

This sprint is about the highest-traffic secondary surfaces first.

## Implementation Guidance

- Reuse the emerging tropical primitives instead of duplicating page-local styling.
- Prioritize clarity on information-dense pages like Wallet and Leaderboard.
- Keep the monetization pages feeling premium, not gaudy.
- The pages should feel warmer and more immersive, but still faster to scan than the game board.
- If scope must narrow, prioritize in this order:
  1. `Wallet.tsx`
  2. `Premium.tsx`
  3. `DailyHub.tsx`
  4. `Profile.tsx`
  5. `Leaderboard.tsx`

## Acceptance Criteria

This task is complete only if all of the following are true:

- the required secondary pages have been brought materially into the tropical paradise visual system
- the pages remain functional and readable
- the design feels continuous with the board and Dashboard rather than reverting to the older indigo / zinc look
- verification is performed and documented clearly
- a comprehensive `EXECUTION_REPORT_42.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects what was themed and what remains deferred

## Deliverable Expectation

Complete the first major wave of secondary-surface tropical alignment next.

After that, the strongest follow-on options will likely be:

- the next wave of secondary pages (SocialHub, Replays, Tournaments, Cosmetics, FeaturedMatches)
- motion polish for gameplay interactions
- deeper interaction refinement on action rails, draw affordances, and turn-state clarity
