# Claude Directive 39: Gameplay Table Layout, Hand Dominance, and Core Board UX Polish for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_39.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_39.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest report shows that Gin Paradise now has:

- real Stripe Checkout session creation in live mode
- paid-offer monetization routed through billing instead of free fulfillment
- raw-body-preserving webhook verification
- offer-aware billing attribution and admin visibility
- a fully green suite with `1001/1001` tests passing

That means the monetization and billing foundation is now in a much stronger place.

The next bottleneck is no longer billing credibility. It is core game feel.

Recent direct product feedback is clear: the play surface still feels materially worse than Game Colony in one of the places that matters most — table layout and visual priority during live play.

Two specific issues were called out:

- the Stock and Discard piles should not dominate the center of the screen
- the opponent hand should live in the upper-right quadrant, while the player hand should dominate the middle / lower play area

This is important beyond cosmetics. Gin Paradise is a competitive game product. If the board does not feel spatially natural, readable, and satisfying during repeated play, retention and monetization improvements will underperform.

The next highest-value step is therefore to make the actual play screen feel much more deliberate, table-first, and hand-centric.

## Your Next Task

Build the Gameplay Table Layout, Hand Dominance, and Core Board UX Polish sprint for Gin Paradise.

## Primary Objective

Make the live Gin Rummy board feel substantially better by rebalancing the spatial hierarchy of the play surface so that:

- the player hand is the dominant focal element
- draw/discard infrastructure is present but secondary
- the opponent area reads naturally in the upper-right
- the overall table feels closer to a polished competitive card game and less like a centered UI stack

This sprint is about gameplay ergonomics and visual hierarchy, not about billing or backend expansion.

## Required Scope

### 1. Rebalance the Table Geometry

Refactor the board layout so the table reads as a deliberate spatial composition rather than a centered vertical stack.

At minimum on desktop / large screens:

- Stock and Discard should live in the upper-left quadrant or left-side table rail
- opponent identity and hidden hand should live in the upper-right quadrant
- the player hand should visually own the middle-to-lower portion of the play surface
- the center of the table should feel mostly open, supporting focus on the player’s hand and played card decisions

This should apply to:

- `src/pages/GameRoom.tsx`
- `src/pages/MultiplayerRoom.tsx`

If it fits cleanly, bring the spectator layout closer to the same spatial logic too.

### 2. Hand Dominance and Card Readability

Improve the visual priority of the player’s hand so that the board feels like it is built around card decisions.

At minimum:

- the player hand should be visibly larger or more prominent than the opponent hand
- spacing, overlap, or row layout should feel intentional rather than cramped
- selected-card state should remain obvious
- meld highlighting, deadwood context, and interaction states must remain readable
- the board should still feel good with 10- and 11-card hands

Do not reduce actual usability in pursuit of style.

### 3. Opponent Area Polish

The opponent lane should feel anchored and competitive rather than floating generically at the top.

At minimum:

- opponent profile / score / status should visually pair with the opponent’s hidden cards
- the upper-right placement should feel stable and balanced against the left-side stock/discard tray
- turn-state information should still be understandable at a glance

### 4. Reduce Board Clutter

Use this sprint to simplify the live play surface where helpful.

At minimum, evaluate and improve:

- whether top-of-board chrome is too heavy
- whether action-state hints are too detached from the hand interaction area
- whether labels for Stock / Discard / counters can be quieter but clearer
- whether empty table space is being used intentionally

Do not remove important information. Do remove avoidable visual competition.

### 5. Responsive Behavior

The board must still work on smaller screens.

Required behavior:

- mobile and narrower tablet layouts should remain functional and readable
- if the exact desktop quadrant layout does not fit on mobile, adapt intelligently rather than forcing it
- the player hand must still remain the most important element
- interaction targets must stay usable

Desktop improvement is the priority, but responsive regressions are not acceptable.

### 6. Preserve Gameplay Functionality

This sprint must not degrade actual play behavior.

Preserve:

- draw from Stock / Discard
- discard and knock flows
- selected-card logic
- drag / reorder behavior where present
- showdown overlays
- turn indicators
- low-balance or commercial messaging where those are already present in multiplayer contexts

The goal is a better board, not a broken one.

### 7. Verification and Visual Discipline

This is a UI sprint, so verification must be stronger than “it compiles.”

At minimum:

- run lint / typecheck
- verify both single-player and multiplayer board layouts manually if the environment allows
- explicitly confirm in the report how the board changed on desktop and on smaller screens
- document any areas left intentionally unchanged

If a local dev run is possible, use it and report what was observed.

## Non-Goals for This Pass

- No broad redesign of Dashboard, Wallet, Premium, or admin surfaces
- No major new gameplay mechanics
- No AI logic changes
- No replay-system redesign
- No spectator feature expansion beyond layout alignment if it falls out naturally
- No new billing or commerce work unless required by the changed board layout

This sprint is specifically about making live play feel better.

## Implementation Guidance

- Benchmark mentally against polished card-table layouts, not generic app dashboards.
- Favor spatial hierarchy over more boxes, more borders, or more labels.
- The player’s hand should feel like the center of gravity.
- The stock/discard tray should be compact and confident, not dominant.
- The opponent should feel present in the upper-right without competing with the player hand.
- Preserve the existing visual language where reasonable, but do not be afraid to make the board feel more intentional.
- If the single-player and multiplayer boards have drifted stylistically, use this sprint to bring them closer together.
- If scope must be narrowed, prioritize:
  1. desktop GameRoom
  2. desktop MultiplayerRoom
  3. responsive adaptation
  4. spectator alignment

## Acceptance Criteria

This task is complete only if all of the following are true:

- Gin Paradise’s active play views place Stock / Discard away from the screen center on desktop
- the opponent lane is anchored into the upper-right quadrant on desktop
- the player hand clearly dominates the board visually
- single-player and multiplayer board layouts both improve materially in the same direction
- gameplay interactions still work cleanly with no major regressions
- responsive behavior remains usable
- automated verification (`lint` / typecheck, plus any additional checks added) passes
- a comprehensive `EXECUTION_REPORT_39.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new state

## Deliverable Expectation

Complete the board-layout and gameplay-feel polish next.

After that, the strongest follow-on options will likely be:

- deeper interaction polish for card movement, discard feedback, and turn-state clarity
- spectator-view visual alignment with the main play surface
- broader front-end refinement of the competitive identity across the product
