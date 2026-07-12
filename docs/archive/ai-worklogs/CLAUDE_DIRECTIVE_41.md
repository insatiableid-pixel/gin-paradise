# Claude Directive 41: Post-Launch Desktop Table Composition, Seat Anchoring, and Vertical Spacing Refinement for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_41.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_41.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

Gin Paradise has now crossed an important threshold:

- the tropical paradise brand system is live
- the shared card visual system is in place
- the core play surfaces have been themed and demoed successfully in a live browser

That means the next best step should be informed by actual post-launch product feedback, not just internal taste.

That feedback is already clear, and it has now been validated against the live app in-browser:

- keeping the player hand dominant is still correct
- keeping the 4-row suit layout is still correct
- moving Stock / Discard off to the upper-left rail on desktop was an overcorrection
- on desktop, the draw area works better when it stays horizontally centered and lifted into the upper-middle of the table
- the more important remaining problem is seat anchoring: the opponent hand is top-center while opponent identity/score sits off to the side, and the player identity likewise feels detached from the lower hand zone
- the hand panel also starts a bit too high, which compresses the open felt between the centered draw area and the player’s hand

This is an important refinement, not a minor preference. The board is the core product. If the desktop table composition is wrong, the strongest visual work in the world will still feel slightly “off” in repeated play.

The next highest-value step is therefore to refine the desktop board composition based on live observation, preserving the centered raised draw area while fixing seat coherence and vertical spacing.

## Your Next Task

Build the Post-Launch Desktop Table Composition, Seat Anchoring, and Vertical Spacing Refinement sprint for Gin Paradise.

## Primary Objective

Refine the desktop layout of the live play board so that:

- Stock / Discard stay horizontally centered or near-centered on the table
- they remain lifted into the upper-middle rather than falling into the visual center
- the player hand still clearly dominates the lower half
- the 4-row suit layout remains the core hand interaction model
- opponent and player identity/score areas feel visually attached to their respective seats
- the open felt between the draw area and the hand is increased and used intentionally

This sprint is about spatial correction and desktop game feel, not another broad visual re-theme.

## Required Scope

### 1. Rework Desktop Table Geometry in Active Play Views

Refine the layout of the live board on desktop / large screens in:

- `src/pages/GameRoom.tsx`
- `src/pages/MultiplayerRoom.tsx`

At minimum on desktop:

- Stock / Discard should remain horizontally centered or close to centered
- the piles should stay above the visual midpoint, in the upper-middle band of the table
- the center of the table should still feel open rather than crowded
- the player hand should continue to dominate the lower zone

Do not revert to the old centered stack wholesale, and do not push the piles back to a left rail. The goal is a better centered composition with stronger spacing and seat logic.

### 2. Preserve the 4-Row Suit Hand as the Hero Interaction Surface

The player hand remains the most important element.

Required behavior:

- keep the 4-row suit layout
- keep or improve hand readability and scan speed
- keep selected-card state obvious
- maintain enough breathing room between the raised draw area and the hand
- ensure the lower-half composition still feels like “your zone”

### 3. Fix Seat Anchoring for Both Players

The live board currently feels split because the visual “seats” are not fully coherent.

At minimum:

- the opponent avatar / name / score should feel attached to the opponent hand rather than offset as a separate sidebar element
- the player identity / score should feel attached to the player’s lower-zone interaction area
- both seats should read clearly in the opponent -> draw area -> player hand flow
- seat anchoring should improve the person-to-person feel of the match without making the board symmetrical in a stiff way

### 4. Rebalance Vertical Spacing and Open Felt

The current desktop board needs more deliberate breathing room between the upper draw area and the lower hand.

At minimum:

- create a clearer vertical gap between the centered draw area and the player hand
- avoid pushing the hand so high that the center feels compressed
- keep turn messaging and deadwood context legible without cluttering the open table space
- make the desktop board feel more composed than both:
  - the old centered-middle pile layout
  - the later upper-left-rail layout

### 5. Keep Mobile / Narrow Layouts Practical

This is primarily a desktop refinement sprint, but mobile must not regress.

Required behavior:

- preserve or improve the current mobile layout if it already works better there
- do not force the desktop-centered composition onto narrow screens if it harms usability
- document any desktop/mobile divergence explicitly in the execution report

Desktop correctness is the priority. Responsive breakage is not acceptable.

### 6. Preserve the Tropical Brand System

Do not lose the work already done.

Preserve:

- emerald felt table treatment
- warm gold interaction accents
- branded card backs
- shared card visual system
- existing card-face language

This sprint is about layout composition within the new theme, not abandoning it.

### 7. Preserve Gameplay Functionality

No core gameplay behavior should regress.

Preserve:

- draw from Stock / Discard
- discard and knock flows
- drag / reorder behavior where present
- action rails and turn indicators
- showdown overlays and end states
- multiplayer-specific trust / timer / room context

### 8. Verification

Because this is a post-launch UX refinement, verification should be stronger than compilation alone.

At minimum:

- run lint / typecheck
- run any practical build or regression checks
- manually verify the board on desktop if the environment allows
- use the actual running app as the reference, not only code inspection
- explicitly describe before/after desktop behavior in the report
- explicitly note how mobile was handled

If possible, include a short rationale for why the final composition is better than both:

- the old fully centered stack
- the newer upper-left rail version

## Non-Goals for This Pass

- No broad secondary-page re-theme yet
- No new billing or backend systems
- No new card art system
- No gameplay mechanic changes
- No spectator feature expansion beyond layout alignment if it falls out naturally

This sprint is specifically about correcting the core desktop play surface after live feedback.

## Implementation Guidance

- Think in terms of seat composition and vertical hierarchy, not just x/y movement.
- The real goal is:
  - hand dominant
  - draw area centered
  - draw area lifted upward
  - center not visually blocked
  - opponent seat unified
  - player seat unified
  - more breathing room between draw area and hand
- Avoid both extremes:
  - old centered-middle piles that dominate the board
  - left-rail piles that make the draw area feel detached from shared play
- Favor this eye flow:
  - opponent seat
  - centered draw area
  - open felt
  - player hand + action rail
- Use desktop-specific layout logic if that is the cleanest solution.
- If scope must narrow, prioritize:
  1. `GameRoom.tsx` desktop composition
  2. `MultiplayerRoom.tsx` desktop composition
  3. seat anchoring
  4. mobile preservation / responsive polish

## Acceptance Criteria

This task is complete only if all of the following are true:

- Stock / Discard are not pushed to a desktop upper-left rail in the active play views
- the draw area is horizontally centered or near-centered on desktop and remains lifted into the upper-middle of the table
- the 4-row suit hand remains intact and clearly dominant
- opponent and player identity/score areas feel visually attached to their seats
- the vertical gap between the draw area and hand is improved on desktop
- single-player and multiplayer both follow the corrected desktop composition
- mobile / narrow layouts remain usable
- gameplay interactions still work cleanly with no major regressions
- verification is performed and documented clearly
- a comprehensive `EXECUTION_REPORT_41.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the refined state

## Deliverable Expectation

Complete the desktop table-composition and seat-anchoring correction next.

After that, the strongest follow-on options will likely be:

- product-wide tropical alignment across remaining secondary pages
- motion polish for draw / discard / reveal interactions
- deeper turn-state and action-rail interaction refinement
