# Claude Directive 17: Training Dashboard and Evaluation Hardening Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_17.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_17.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- scheduled tournaments, dynamic brackets, byes, and no-show handling
- a first engine-backed replay evaluation / PR-style MVP
- existing Gemini narrative coaching on replays
- a polished table experience and strong heads-up core

However, two important gaps remain:

1. The training/evaluation moat is still mostly tucked inside the replay detail flow rather than elevated into a dedicated retention surface.
2. The latest execution report still acknowledges 4 pre-existing `evaluation.test.ts` failures tied to rate-limiter interactions, which means the evaluation stack is not yet fully hardened.

## Your Next Task

Build the Training Dashboard and Evaluation Hardening sprint for Gin Paradise.

## Primary Objective

Turn the current replay-evaluation capability into a first-class training product while also cleaning up the known evaluation instability so the platform returns to a fully green, trustworthy test state.

## Required Scope

### 1. Evaluation Hardening First

- Resolve the known `evaluation.test.ts` rate-limiter / test-stability failures.
- The evaluation path should no longer be carrying an acknowledged “pre-existing failure” caveat.
- Ensure the evaluation endpoints, caching, and rate limiting can coexist cleanly in both production and test harness contexts.
- The result should be an honestly green suite, not a report that explains away failures.

### 2. Dedicated Training Surface

- Add a dedicated Training / My Analysis surface in the product rather than relying only on replay detail pages.
- This should be prominent enough to reinforce that analysis is part of the core product, not a hidden extra.
- At minimum, the training surface should let a player see:
  - recent analyzed sessions or matches
  - engine accuracy / evaluation summaries
  - severity distribution trends
  - quick access to the most instructive replays or biggest mistakes

### 3. Session Review Productization

- Build a clearer session-level review experience on top of the existing replay evaluation and Gemini coaching layers.
- Reuse cached engine evaluations and cached narrative analysis where possible.
- Avoid re-calling Python or Gemini unnecessarily when the information already exists.
- Present the session review as a coherent training artifact rather than just a pile of raw numbers.

### 4. Trend and Retention Signals

- Add lightweight training progression signals that help players come back and improve.
- At minimum, consider:
  - recent average engine accuracy
  - severity counts over recent sessions
  - recurring mistake categories if practical
  - best / worst recent sessions
- Keep the metrics honest and interpretable. Do not imply solved-game precision where it does not exist.

### 5. UI/UX Integration

- Make the training product feel intentional and productized.
- The dashboard should connect naturally to:
  - replay detail
  - engine evaluation
  - Gemini coaching
- If export/share is straightforward, include a lightweight shareable or copyable review summary. If not, prioritize the dashboard and review flow first.

### 6. Documentation and Methodology Clarity

- Clarify the language around what the training metrics mean.
- Keep the distinction between:
  - engine-backed evaluation
  - Gemini-written coaching
- Update current docs/status if the training system becomes a more central product surface.

### 7. Testing and Verification

Add automated coverage for the training/dashboard pass. At minimum, cover:

- the fixed evaluation/rate-limit behavior
- training-surface data loading and access control as applicable
- aggregation or trend logic introduced for session summaries
- regression coverage confirming replay evaluation, replay analysis, tournaments, wallet, and admin flows still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No business-model / currency pivot in this sprint
- No scheduled tournament rewrite beyond what is needed for training linkage
- No PostgreSQL/Redis migration in this sprint
- No full native-mobile packaging work in this sprint
- No claim of perfect-play proof or solved-game analysis

## Implementation Guidance

- Treat this as training-productization plus reliability cleanup, not as a cosmetic dashboard project.
- Fix the known evaluation instability before adding shiny layers on top of it.
- Reuse the existing replay evaluation and Gemini coaching artifacts rather than inventing parallel analysis systems.
- Favor clear, sticky training value over dashboard bloat.
- In the Execution Report, be explicit about:
  - how the known evaluation failures were resolved
  - what metrics are newly surfaced
  - what is cached versus recomputed
  - what still remains limited or heuristic

## Acceptance Criteria

This task is complete only if all of the following are true:

- the evaluation test/rate-limit instability is resolved
- the automated suite is honestly green without the old “pre-existing failure” caveat
- Gin Paradise has a dedicated training / analysis surface beyond raw replay detail
- players can see session-level evaluation summaries and access the most useful reviews
- the distinction between engine evaluation and Gemini coaching remains clear
- regression coverage for the new training product layer exists and passes
- a comprehensive `EXECUTION_REPORT_17.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the training-dashboard and evaluation-hardening pass next. After that, the strongest follow-on options will likely be tournament history / retention features, deeper evaluation sophistication, or later infrastructure scale-out if live usage starts demanding it.