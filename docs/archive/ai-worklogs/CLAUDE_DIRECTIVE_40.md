# Claude Directive 40: Multiplayer Visual Parity, Shared Card System, and Play-Surface Consistency for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_40.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_40.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest status and execution report together show two important truths:

- Gin Paradise now has a much stronger game-board layout and a premium emerald / gold visual direction.
- That visual overhaul is not yet fully unified across the live play experience.

`EXECUTION_REPORT_39.md` is especially clear on this point. It describes a substantial visual overhaul centered in `GameRoom.tsx`, then explicitly recommends the following immediate next step:

- apply the same emerald felt + gold accent palette to `MultiplayerRoom.tsx`

It also calls out additional unfinished consistency work:

- `OverlappingCard` still carries old visual language in some places
- `ShowdownCardMini` should be brought into the new design system
- spectator visual alignment remains deferred

In other words, the board direction is now much better, but the product still risks feeling like two different games depending on where a user plays.

That inconsistency matters. Multiplayer is a core competitive surface. If single-player looks premium but multiplayer still feels partially legacy, the strongest product impression is diluted.

The next highest-value step is therefore not more backend work. It is visual parity and component consolidation across the live play surfaces.

## Your Next Task

Build the Multiplayer Visual Parity, Shared Card System, and Play-Surface Consistency sprint for Gin Paradise.

## Primary Objective

Finish the visual transition from the old zinc / indigo game board language to the new emerald felt / warm gold Gin Paradise identity across multiplayer and adjacent play-surface components.

The goal is that a user moving between:

- single-player
- multiplayer
- showdown states
- related card surfaces

should feel like they are still in the same premium product.

## Required Scope

### 1. MultiplayerRoom Visual Parity

Bring `src/pages/MultiplayerRoom.tsx` fully into the new visual system established in the single-player board.

At minimum:

- emerald felt / lounge-style table treatment should match the new direction
- gold / amber should replace remaining indigo-primary interaction accents where appropriate
- stock / discard, selection states, pills, prompts, and action emphasis should feel like the same family as `GameRoom`
- opponent hidden cards and table chrome should align with the new branded style

Do not merely “tint” the page. Make it feel intentionally ported into the new design language.

### 2. Shared Card Visual System

Reduce drift between the different card renderers.

At minimum, audit and unify the visual language of:

- `PlayingCard`
- `OverlappingCard`
- `SuitRowCard`
- `ShowdownCardMini`
- card back rendering used in opponent / hidden-card contexts

The end result should preserve context-specific behavior, but the cards should clearly belong to one coherent Gin Paradise system.

If the cleanest approach is to extract shared helpers, shared classes, or a small internal card-style system, do that.

### 3. Selection, Highlight, and State Consistency

Interaction cues should be visually consistent across play modes.

At minimum:

- selected-card styling should use the new accent language consistently
- meld highlighting should not clash with the new palette
- draw / discard affordances should read clearly in both single-player and multiplayer
- showdown-state cards should not feel like leftovers from an older theme

### 4. Showdown and Overlay Consistency

The round-over and game-over experiences should match the premium play-surface direction.

At minimum:

- showdown mini-cards should visually align with the new card-face language
- overlay chrome should not revert to a colder legacy look
- important result states (gin, undercut, knock, winner emphasis) should still be legible and exciting

### 5. Spectator Alignment if It Falls Out Cleanly

The report correctly deferred spectator work because it is a different layout model. That is still reasonable.

However, if it can be improved cleanly without derailing the sprint, bring `SpectatorView.tsx` closer to the same visual world through:

- background treatment
- card styling consistency
- accent color alignment

This is optional for this pass. Multiplayer parity is not optional.

### 6. Preserve Functionality

This is a visual and component-consistency sprint, not a gameplay rewrite.

Preserve:

- drag / reorder interactions
- selection logic
- discard / knock flows
- timers, status chips, and trust/billing context already present in multiplayer
- showdown correctness
- responsive usability

No gameplay regressions are acceptable.

### 7. Verification

Because this sprint is largely visual, verification must be explicit.

At minimum:

- run lint / typecheck
- run any affected build or regression checks that are practical
- manually verify both `GameRoom` and `MultiplayerRoom` if the environment allows
- explicitly document what visual inconsistencies were removed
- explicitly document anything intentionally left for a later pass

If `PROJECT_STATUS.md` previously overstated completeness, correct that with precision rather than hand-waving.

## Non-Goals for This Pass

- No new backend systems
- No billing changes unless a purely visual dependency requires a tiny adjustment
- No large Dashboard / Wallet / Premium redesign
- No new game mechanics
- No replay-system redesign
- No full spectator feature expansion

This sprint is about visual parity and component coherence in the actual play experience.

## Implementation Guidance

- Treat `GameRoom` as the target visual benchmark, but do not blindly duplicate code if a shared abstraction would be cleaner.
- Avoid ending with two near-identical large files that drift again later.
- Prefer extracting shared card-style helpers or reusable presentational pieces when that reduces design duplication.
- Keep the premium card-lounge direction intact:
  - emerald felt
  - warm gold accents
  - branded card backs
  - readable, overlap-friendly card faces
- Be especially careful with overlap-heavy contexts. A beautiful card design that is harder to scan is a regression.
- If scope must narrow, prioritize:
  1. `MultiplayerRoom.tsx` parity
  2. shared card component consistency
  3. showdown mini-card cleanup
  4. spectator alignment

## Acceptance Criteria

This task is complete only if all of the following are true:

- `MultiplayerRoom.tsx` is brought materially into the same visual language as the overhauled single-player board
- remaining legacy indigo / zinc gameplay accents are removed or justified in active play contexts
- the core card renderers feel like one coherent system
- showdown / overlay card presentation is visually consistent with the new theme
- gameplay interactions still work cleanly with no major regressions
- verification is performed and documented clearly
- a comprehensive `EXECUTION_REPORT_40.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects what is and is not finished

## Deliverable Expectation

Complete multiplayer visual parity and card-system consistency next.

After that, the strongest follow-on options will likely be:

- motion polish for draw / discard / reveal interactions
- spectator-view visual alignment
- broader product-wide brand alignment beyond the play surface
