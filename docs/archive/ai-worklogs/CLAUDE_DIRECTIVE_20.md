# Claude Directive 20: Default Client-Seed Rollout and Live Fairness UX Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_20.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_20.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a fully productized Trust Shield with replay proof inspector, proof download, and public verification
- v2 fairness support with client-seed contribution in the backend protocol
- a fully green runtime test suite with `447/447` tests passing

However, the rollout is still incomplete in one important way:

1. The frontend does not yet auto-submit client seeds on match start, so Trust Shield v2 is not the default live experience for current players.
2. The live game surface does not yet clearly communicate fairness status during a match or round.
3. The latest report still notes a pre-existing TypeScript error in `multiplayer.test.ts`, even though runtime tests pass.

## Your Next Task

Build the Default Client-Seed Rollout and Live Fairness UX sprint for Gin Paradise.

## Primary Objective

Make Trust Shield v2 the default behavior for active multiplayer play, and surface fairness status clearly enough that players can feel the trust system working before they ever open a replay.

## Required Scope

### 1. Automatic Client-Seed Submission

- Wire the current frontend multiplayer flow to automatically generate and submit a client seed when a round or match begins.
- Use a secure client-side randomness source.
- Ensure current players do not need to click anything special for v2 fairness to activate.
- Handle reconnects, next-round transitions, and timing edge cases cleanly.
- Preserve graceful fallback behavior if a seed cannot be submitted for any reason.

### 2. Live Fairness Status in the Game UI

- Add a restrained but visible fairness-status surface to live multiplayer and tournament play.
- At minimum, a player should be able to understand:
  - commitment published
  - my seed submitted
  - opponent seed received / waiting
  - round now running under Trust Shield v2 or fallback mode
- Keep this lightweight and non-distracting. The goal is trust clarity, not dashboard clutter.

### 3. Round and Replay Consistency

- Ensure the live fairness status and replay proof inspector tell a consistent story.
- If a round falls back to v1, that should be accurately reflected later in replay/fairness surfaces.
- If a round runs under v2, the replay proof inspector should show it as the normal/default case rather than an edge case.

### 4. Technical Cleanup

- Clean up the pre-existing TypeScript issue noted in the latest report if it is still present.
- Make the fairness rollout feel genuinely complete rather than carrying a small “known caveat” forward.
- If other small type-level or protocol-level inconsistencies are discovered directly in the fairness rollout path, fix them as part of this pass.

### 5. Testing and Verification

Add automated coverage for the default-rollout pass. At minimum, cover:

- automatic client-seed submission on match/round start
- reconnect or next-round behavior
- fallback behavior when seed submission fails or is absent
- live fairness-status UI or state transitions as applicable
- regression coverage confirming replays, fairness verification, tournaments, training, wallet, and multiplayer still work

Also perform manual verification if the environment allows it, ideally by confirming that a normal current-client multiplayer match now produces v2 fairness proofs without any manual user action.

## Non-Goals for This Pass

- No new fairness algorithm beyond the existing v2 design
- No blockchain integration
- No infrastructure migration in this sprint
- No business-model redesign in this sprint
- No cosmetic/prestige system expansion unless strictly needed for the fairness UI itself

## Implementation Guidance

- Treat this as a rollout-completion sprint, not a reinvention sprint.
- Make v2 fairness the default for healthy current clients while preserving safe fallback.
- Favor subtle trust instrumentation in the live UI over heavy technical exposition on the table.
- If scope must be narrowed, prioritize in this order:
  1. auto-submit client seeds
  2. live fairness status
  3. replay/live consistency cleanup
  4. TypeScript cleanup
- Be explicit in the report about:
  - when the client seed is generated
  - when it is sent
  - how retries or reconnects are handled
  - how often v1 fallback can still occur after this sprint

## Acceptance Criteria

This task is complete only if all of the following are true:

- current frontend clients automatically participate in Trust Shield v2 for normal multiplayer play
- players can see a clear live fairness status without needing to open a replay
- replay/fairness surfaces accurately reflect whether a round used v2 or fallback mode
- the known fairness-rollout caveat about manual client-seed participation is removed or materially narrowed
- the pre-existing TypeScript issue in the rollout path is resolved or explicitly justified if genuinely unrelated
- automated tests for the rollout-completion layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_20.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the final Trust Shield rollout pass next so that fairness v2 becomes the normal, player-visible live experience. After that, the strongest follow-on options will likely be deeper Training product depth, cosmetic/prestige systems, or later infrastructure scale-out once live usage justifies it.
