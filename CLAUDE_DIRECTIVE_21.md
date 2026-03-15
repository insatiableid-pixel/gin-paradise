# Claude Directive 21: Training Automation and Progression Depth Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_21.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_21.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a completed Trust Shield v2 rollout that is live by default
- replay evaluation backed by the Python Apex v2 engine
- a dedicated Training surface with cached evaluation summaries and session reviews
- a fully green suite with `471/471` tests passing and clean TypeScript verification

However, the training moat still has a major product-friction gap:

1. Engine evaluation is still primarily something a user has to trigger from the replay flow rather than something the platform reliably prepares for them.
2. The Training surface has useful summaries, but it still lacks deeper progression framing over time.
3. Tournament performance and match-format context are not yet meaningfully tied into the training story.

## Your Next Task

Build the Training Automation and Progression Depth sprint for Gin Paradise.

## Primary Objective

Turn training from a good optional review tool into a frictionless, habit-forming product surface by automatically preparing evaluations where practical and surfacing clearer player-improvement signals over time.

## Required Scope

### 1. Automatic Evaluation Preparation

- Reduce or eliminate the current requirement that players must manually trigger evaluation from replay detail before Training becomes useful.
- Introduce a safe evaluation-preparation flow for completed replays.
- This can be asynchronous / background-oriented, but it must not block gameplay or replay availability.
- Keep execution bounded and operationally sane:
  - avoid unbounded replay backfills
  - avoid duplicate evaluation work
  - preserve current timeout / graceful-failure behavior
- Be explicit about when evaluations are auto-prepared:
  - immediately after match completion
  - on-demand batch prep from Training
  - or a hybrid approach

### 2. Training Progression Signals

- Expand the Training product with clearer session-over-session or period-over-period progress signals.
- At minimum, add some combination of:
  - rolling accuracy trend over time
  - improvement / decline indicators by recent window
  - mistake-rate trend
  - strongest and weakest recurring leak categories
  - recent best stretch / slump framing
- Keep the language honest: this is engine-agreement / heuristic evaluation, not solved-game truth.

### 3. Tournament and Format Context

- Link tournament and match-format context into Training where it meaningfully improves the product.
- At minimum, players should be able to tell whether a reviewed session came from:
  - standard heads-up play
  - a scheduled tournament
  - other materially different competitive contexts if present
- If straightforward, surface tournament finish / bracket context in training history or session detail.

### 4. Training History and Review Flow

- Make the Training experience feel more like a durable learning archive and less like a thin summary page.
- Improve session drill-down and/or history browsing so a player can more easily revisit:
  - best sessions
  - worst sessions
  - recent evaluated matches
  - particularly instructive losses or blunders
- If share/export is now straightforward, add a lightweight training-summary export or share path. If not, prioritize automation and progression first.

### 5. Operational Safety and Transparency

- Keep Python evaluation off the gameplay critical path.
- Ensure failures to auto-evaluate do not degrade match completion, replay persistence, or training page stability.
- If auto-preparation is partial or rate-limited, communicate that honestly in the product and in the report.

### 6. Testing and Verification

Add automated coverage for the training-automation pass. At minimum, cover:

- automatic or batched evaluation preparation behavior
- deduplication / cache reuse
- training summaries after auto-prepared evaluations
- progression/trend calculations introduced in this sprint
- tournament/format context surfacing where implemented
- regression coverage confirming replays, evaluation APIs, fairness, tournaments, wallet, and multiplayer still work

Also perform manual verification if the environment allows it, ideally by completing new matches and confirming that Training becomes meaningfully populated without the old manual replay-evaluation step.

## Non-Goals for This Pass

- No new fairness algorithm in this sprint
- No business-model or subscription gating implementation in this sprint
- No PostgreSQL/Redis migration in this sprint
- No native mobile packaging work in this sprint
- No cosmetic/prestige system expansion unless directly needed for training history presentation

## Implementation Guidance

- Treat this as productizing the analytical moat, not just adding more charts.
- The highest-leverage win is removing friction between “I finished a match” and “I have useful training insight.”
- If scope must be narrowed, prioritize in this order:
  1. automatic evaluation preparation
  2. stronger progression signals
  3. tournament/format context
  4. share/export polish
- Be explicit in the report about:
  - when and how evaluations are prepared
  - how duplicate work is avoided
  - what remains manual, if anything
  - which signals are computed versus retrieved from cache

## Acceptance Criteria

This task is complete only if all of the following are true:

- the Training surface is materially less dependent on manual replay-evaluation steps
- completed matches can populate Training through an automatic or clearly streamlined preparation flow
- players can see deeper progress/improvement signals over time
- tournament or format context is reflected in the training story where applicable
- failures in evaluation preparation do not break gameplay, replay persistence, or the Training page
- automated tests for the new training-product layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_21.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the next training-productization pass now. After that, the strongest follow-on options will likely be cosmetic/prestige systems, richer profile/achievement layers, or later monetization/subscription packaging once the training moat feels fully sticky.
