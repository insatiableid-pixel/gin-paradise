# Claude Directive 8: Showdown Fidelity and Human-Factors Hand UX Sprint for Gin Galaxy

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_8.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_8.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT_7.md` show that Gin Galaxy now has:

- hardened auth, validation, and rate limiting
- server-authoritative multiplayer with rating-aware matchmaking
- turn timers, transcripts, replay persistence, and replay analysis
- dual-currency wallets, ledger foundation, coin-gated matchmaking, and escrow settlement
- 189 passing automated tests across the core platform

However, one important gameplay-fidelity and usability gap remains in the actual card-table experience:

- end-of-hand showdown behavior is not yet guaranteed to present both hands correctly to players on every round end
- normal-knock layoff behavior may exist in scoring logic, but the product experience must clearly reveal and communicate it
- the current hand presentation is still closer to a spaced utility grid than an optimal table-native gin layout

The next task is to fix the rules presentation and hand interaction model so the game feels correct, readable, and cognitively efficient for real players.

## Your Next Task

Build the showdown-fidelity and human-factors hand UX upgrade for Gin Galaxy.

Focus on rules-correct presentation, perceptual clarity, and strong interaction ergonomics. This is not a cosmetic pass. It is a gameplay-comprehension and decision-quality pass.

## Primary Objective

Make the live and end-of-round Gin Rummy interface feel table-native, rules-faithful, and faster for humans to read and act on.

## Required Scope

### 1. End-of-Hand Showdown Fidelity

- At the end of every round, both players' full hands must be revealed to both players.
- This must be true for:
  - normal knock
  - undercut
  - gin
  - game-ending hands as well as non-game-ending hands
- For a normal knock, the opponent must have the correct layoff opportunity against the knocker's melds, and the showdown presentation must make that outcome legible.
- For gin, both hands must still be revealed, but no layoff should occur.
- Showdown data should be internally consistent across server state, client view, replay data, and transcript/audit output.

### 2. Visible Layoff Presentation

- For non-gin knock hands, do not merely compute layoff silently. Show it.
- The player should be able to understand:
  - which melds the knocker exposed
  - which opponent cards laid off onto those melds
  - which cards remained deadwood after layoff
- Prefer a layout that visually attaches laid-off cards to the relevant melds rather than hiding the result in summary text.
- Preserve scoring correctness and make the explanation of the outcome easy to verify at a glance.

### 3. Live Hand Layout Redesign

Replace the current evenly spaced utility-style hand presentation with a table-style overlapping card layout during live play.

The layout should follow these principles:

- Cards should overlap horizontally enough that the hand consumes less width and visually reads as a real hand on a table.
- In a visually grouped sequence or cluster, interior cards should be partially exposed rather than fully separated.
- The trailing edge card in a visible sequence should remain fully readable.
- The overlap should support quick perception of runs, pairs, near-melds, and deadwood rather than forcing the user to scan isolated tiles one by one.
- The layout must remain interactive and reliable for selection, especially on narrower screens.

Use the Game Colony-style overlapping hand feel as a baseline reference, but improve on it with cleaner information design, stronger responsiveness, and better action clarity.

### 4. Human Factors and Cognitive Ergonomics

Design this pass around human performance, not just aesthetics.

The interface should explicitly optimize for:

- perceptual grouping: melds, near-melds, and deadwood should be easier to visually parse
- recognition over recall: reduce the need for players to mentally reconstruct hand structure each turn
- spatial stability: avoid unnecessary card reordering or jumpiness that breaks the player's mental map
- motor accuracy: overlapping cards still need dependable click/tap targets, selection affordances, and z-order behavior
- low cognitive noise: emphasize relationships and legal actions, not decorative clutter
- phase clarity: draw, discard, knock, showdown, and next-round states should feel unmistakably different
- individual differences: account for smaller screens, lower visual acuity, and players who scan differently

If there is a tradeoff between more dramatic visuals and clearer, faster decisions, choose clearer, faster decisions.

### 5. Interaction Model Requirements

- Selected cards must remain easy to identify and manipulate despite overlap.
- Hover, focus, active, and selected states should be legible and intentional.
- If cards lift, fan, or rise during interaction, the motion must help targeting and understanding rather than add noise.
- Do not create accidental ambiguity about which card is selected.
- Maintain or improve mobile usability; overlap should save width, not create a tap nightmare.

### 6. Showdown and Replay Consistency

- Replay detail and post-game review should reflect the corrected showdown information.
- If knock/layoff reveal data is not currently stored in enough detail, extend the schema or transcript structure carefully and additively.
- Avoid a situation where players saw one thing live but replays show something less complete or contradictory.

### 7. Testing and Verification

Add automated coverage for both rules fidelity and UI/state integration. At minimum, cover:

- both hands revealed on normal knock round end
- both hands revealed on gin round end
- layoff applied on normal knock and not on gin
- showdown payloads or state shapes carrying enough data for correct presentation
- replay/transcript consistency for revealed hands and layoff context if that data path changes
- regression coverage confirming existing multiplayer, escrow, replay, and analysis behavior still works

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No new payments, rake, or wallet economics changes
- No major AI-strategy port from Python in this pass
- No speculative redesign of unrelated pages
- No purely decorative art pass detached from interaction quality
- No compromise of rules correctness in order to simplify the visuals

## Implementation Guidance

- Treat the final card-table experience as a human-factors problem first and a styling problem second.
- Favor layouts that let players chunk information into meaningful structures quickly.
- Preserve spatial continuity whenever possible so the user can build a stable internal model of their hand.
- Keep the live hand, showdown state, and replay state conceptually aligned.
- If the backend already computes part of this correctly but the client fails to surface it, fix the product experience rather than duplicating hidden logic.
- Be explicit in the Execution Report about which behaviors were engine fixes, message-shape fixes, transcript fixes, and presentation-layer fixes.

## Acceptance Criteria

This task is complete only if all of the following are true:

- both players' full hands are revealed to both players at every round end
- normal knocks visibly support and present layoffs correctly
- gin hands reveal both hands but do not allow layoffs
- the live player hand uses a table-style overlapping layout rather than the old evenly spaced presentation
- the overlapping layout improves width efficiency while preserving reliable selection and readability
- showdown, replay, and transcript behavior remain consistent with the corrected rules presentation
- existing multiplayer, escrow, replay, and analysis behavior still works
- automated tests for showdown fidelity and related regressions exist and pass alongside existing tests
- a comprehensive `EXECUTION_REPORT_8.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the rules-faithful showdown and hand UX upgrade next. After that, the strongest follow-on options will be deeper single-player difficulty tiers, richer match analysis, or broader product polish around tournament play and competitive retention.
