# Claude Directive 13: Game Feel and Interaction Polish Sprint for Gin Galaxy

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_13.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_13.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT_12.md` show that Gin Galaxy now has:

- a hardened, deployable single-node competitive platform
- server-authoritative multiplayer, escrow, rake, replays, admin visibility, and a playable tournament MVP
- 314 passing automated tests with zero regressions

At this point, the biggest remaining gap is not core rules integrity. It is *moment-to-moment product feel*. The platform is trustworthy and feature-rich, but it still needs a more tactile, premium, cognitively supportive play experience before broader user acquisition and bigger liquidity pushes.

Deep Think's remarks are most useful here in the **Game Feel / Retention** track. The Python PR microservice idea is strategically interesting, and scheduled MTTs are a likely later expansion, but the immediate next move should be making active play feel excellent.

## Your Next Task

Build the Game Feel and Interaction Polish sprint for Gin Galaxy.

Focus on tactile hand interaction, reduced cognitive load, meaningful motion, and restrained audio feedback across the live card table.

## Primary Objective

Make playing a hand of Gin Rummy feel premium, clear, and satisfying in both single-player and multiplayer/tournament play without compromising rules accuracy, selection precision, or server authority.

## Required Scope

### 1. Drag-and-Drop Hand Sorting

- Let the player manually reorder their own hand during active play.
- This must work with the existing overlapping hand layout rather than replacing it.
- The local hand order must remain a presentation-layer concern. Do not weaken server-authoritative gameplay or hidden-information guarantees.
- Preserve strong click/tap accuracy despite overlap and dragging.
- If a reset-to-auto-sort affordance is useful, add it.
- Keep the interaction stable and easy to understand. Players should feel in control of their grouping strategy.

### 2. Active Meld Highlighting

- Add live, in-hand visual highlighting for completed melds during active play.
- Keep it subtle, readable, and helpful rather than noisy.
- Highlighting should improve recognition of sets/runs without making deadwood or selection state harder to see.
- Reuse the existing rules logic where possible rather than inventing a second interpretation layer.

### 3. Meaningful Animations

- Add a small set of purposeful animations that improve table feel:
  - deal / receive card motion
  - draw from stock or discard
  - discard to pile
  - knock / round-end emphasis
- Motion should support comprehension and delight, not add visual clutter.
- Respect reduced-motion users. If the platform or browser indicates reduced motion, honor it.

### 4. Audio Feedback

- Add restrained, high-signal audio feedback for core table actions where appropriate:
  - deal / draw
  - discard
  - knock / result reveal
  - payout / tournament advancement if practical
- Audio should be optional and easy to mute.
- Keep the sound layer tasteful. Avoid turning the table into a slot machine.

### 5. Preference and Accessibility Integration

- Extend the existing preference system if needed to support:
  - sound on/off
  - motion preference or enhanced animations toggle if useful
- Keep the existing deadwood-count and four-color-deck controls intact.
- Make sure settings remain discoverable and consistent across the relevant play surfaces.

### 6. Cross-Surface Consistency

- Apply the improvements consistently anywhere the live card table matters:
  - single-player
  - heads-up multiplayer
  - tournament matches
- Do not build one interaction model for one mode and a different one for another unless there is a clear reason.

### 7. Testing and Verification

Add automated coverage for the parts of this sprint that are practical to test. At minimum, cover:

- any new preference-store behavior
- any pure logic added for local hand ordering or meld-highlighting state
- regression coverage for existing table interactions that could be affected
- any utility or component logic that becomes central to drag-sorting / highlighting behavior

Also perform manual verification if the environment allows it, especially for:

- drag-and-drop feel
- selection accuracy with overlap
- animation timing
- audio behavior
- reduced-motion / muted states

## Non-Goals for This Pass

- No Python microservice / PR-score bridge in this sprint
- No scheduled multi-table tournament expansion yet
- No PostgreSQL/Redis migration in this sprint
- No major backend architecture rewrite
- No broad visual redesign of unrelated app pages

## Implementation Guidance

- Optimize around human-factors principles: spatial stability, recognition over recall, strong hit targets, low cognitive noise, and clear state transitions.
- Preserve the current table-native overlapping hand aesthetic; improve it rather than replacing it.
- If a drag-and-drop library is introduced, keep its surface area narrow and justified.
- Be careful with z-index, pointer targets, and mobile-width behavior.
- Treat motion and sound as support systems for the game loop, not decorative extras.
- In the Execution Report, be explicit about what is local-only presentation state versus server-trusted game state.

## Acceptance Criteria

This task is complete only if all of the following are true:

- the player can manually reorder their own hand during live play
- local reordering does not compromise server-authoritative rules or hidden information
- completed melds are visually highlighted during active play in a helpful way
- meaningful animations exist for core table actions without overwhelming the interface
- audio feedback exists for key table actions and can be muted
- settings for the new polish features are discoverable and consistent with existing preferences
- the improved interaction model works across the relevant live-play surfaces
- automated tests for the practical logic introduced in this pass exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_13.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the premium game-feel and interaction-polish pass next. After that, the strongest follow-on options will likely be the mathematical replay-evaluation / PR track, scheduled tournament expansion, or later infrastructure scale-out when real usage demands it.