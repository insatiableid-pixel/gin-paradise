# Claude Directive 44: Gameplay Motion Polish, Reveal Animations, and Turn-State Feedback for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_44.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_44.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

Gin Paradise now has:

- a cohesive tropical paradise identity across the full player-facing product
- a refined desktop board composition
- a shared card visual system that keeps play surfaces consistent
- live verification that the product now looks coherent end to end

That means the biggest remaining player-facing gap is no longer visual alignment.

It is motion and feel.

The board now looks premium, but many core interactions still feel comparatively static:

- drawing from Stock / Discard
- discarding
- turn-state changes
- knock / round-end reveal moments

In other words, the visual layer has advanced faster than the interaction layer.

The next highest-value step is therefore to add disciplined motion polish to the gameplay experience so the board feels as premium in motion as it now looks at rest.

## Your Next Task

Build the Gameplay Motion Polish, Reveal Animations, and Turn-State Feedback sprint for Gin Paradise.

## Primary Objective

Make live play feel more tactile, readable, and satisfying by adding meaningful animation and interaction feedback to the core gameplay loop without sacrificing clarity, responsiveness, or competitive usability.

This sprint is about quality of feel, not new mechanics.

## Required Scope

### 1. Draw and Discard Motion in Active Play Views

Add more satisfying and informative motion to the core card flow in:

- `src/pages/GameRoom.tsx`
- `src/pages/MultiplayerRoom.tsx`

At minimum:

- drawing from Stock should feel distinct from drawing from Discard
- discard actions should visibly travel away from the hand and resolve into the discard pile
- transitions should reinforce card origin / destination, not just pulse in place
- motion should remain fast enough for competitive play

Do not add cinematic delays that make the game feel slower.

### 2. Turn-State and Action-Availability Feedback

Improve how the board communicates what the player should do next.

At minimum:

- valid draw targets should feel meaningfully available
- discard / knock / gin states should become more legible as the hand state changes
- turn transitions should feel clearer without becoming noisy
- action rails / prompts should support the player’s eye flow rather than compete with the hand

Use motion to clarify state, not to decorate everything.

### 3. Knock / Showdown / Reveal Polish

Round-ending moments should feel more rewarding and conclusive.

At minimum:

- knock and round-over transitions should have more presence than the current minimal overlay shift
- showdown / reveal sequences should feel intentional and readable
- important result states (gin, knock, undercut, round winner) should land with clear visual emphasis

Keep this tasteful. The goal is premium table drama, not arcade excess.

### 4. Respect Existing Animation Controls and Performance Constraints

If the product already exposes animation preferences or reduced-motion behavior, preserve and respect them.

At minimum:

- new motion must honor existing animation toggles where present
- motion should degrade gracefully when animations are disabled
- performance should remain smooth on the existing board layouts
- no interaction should feel blocked behind long transitions

### 5. Preserve Gameplay Correctness

No gameplay behavior should regress.

Preserve:

- draw / discard logic
- selection and drag / reorder behavior
- knock eligibility logic
- multiplayer timers and turn synchronization
- showdown correctness
- spectator correctness if touched indirectly

### 6. Verification

Because this is a feel sprint, verification must include more than static inspection.

At minimum:

- run lint / typecheck
- run any practical build or regression checks
- manually verify the animated flows in the running app if the environment allows
- document exactly which interactions were upgraded
- document any animation cases intentionally left unchanged

If practical, explicitly compare the before / after feel of:

- stock draw
- discard
- turn transition
- round-end reveal

## Non-Goals for This Pass

- No new gameplay rules
- No large board-layout rewrite
- No broad re-theme of internal / utility surfaces
- No backend architecture changes unless a tiny support adjustment is truly necessary

This sprint is about interaction quality on top of the now-finished visual layer.

## Implementation Guidance

- Favor a few strong, readable animations over many weak ones.
- The best motion should explain state change or add physicality.
- Keep timing tight; competitive players should never feel delayed.
- Reuse motion patterns between single-player and multiplayer where appropriate.
- If scope must narrow, prioritize:
  1. Stock / Discard draw motion
  2. Discard motion
  3. Turn-state / action-availability feedback
  4. Knock / showdown reveal polish

## Acceptance Criteria

This task is complete only if all of the following are true:

- core gameplay interactions in `GameRoom.tsx` and `MultiplayerRoom.tsx` feel materially more polished in motion
- draw / discard origin-destination cues are clearer
- turn-state and action-availability feedback are more legible
- round-end / reveal moments have better visual payoff
- existing animation controls and performance expectations are respected
- gameplay correctness remains intact
- verification is performed and documented clearly
- a comprehensive `EXECUTION_REPORT_44.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new state

## Deliverable Expectation

Complete the gameplay motion-polish layer next.

After that, the strongest follow-on options will likely be:

- final internal / utility surface alignment (AdminDashboard, Fairness)
- deeper microinteraction refinement on navigation, tabs, and empty states
- more advanced celebration / reward feedback on progression and achievement surfaces
