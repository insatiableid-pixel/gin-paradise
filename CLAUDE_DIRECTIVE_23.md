# Claude Directive 23: AI Coaching Timeline and Cached Training Narrative Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_23.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_23.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a strong analytical moat with auto-prepared engine evaluations and progression-aware training
- a rich profile, achievement, and prestige layer built on real competitive and training data
- a fully green suite with `516/516` tests passing

However, one major differentiator is still fragmented:

1. Engine evaluation is integrated into Training, but Gemini coaching still mainly lives behind the replay-analysis endpoint rather than inside the training journey.
2. Replay coaching does not appear to be durably cached as a first-class training artifact.
3. Players can see what the engine thought, but the product still does not consistently surface a persistent human-readable coaching narrative across sessions and time.

## Your Next Task

Build the AI Coaching Timeline and Cached Training Narrative sprint for Gin Paradise.

## Primary Objective

Turn coaching from an isolated replay feature into a durable, timeline-native part of the training product by caching narrative analysis, integrating it into training flows, and preserving a clear distinction between engine truth and AI explanation.

## Required Scope

### 1. Durable Replay Coaching Cache

- Add durable caching/persistence for replay-level coaching output rather than regenerating narrative analysis ad hoc each time.
- The cache should support both:
  - Gemini-generated coaching when an API key is available
  - graceful fallback structured coaching when Gemini is unavailable
- Avoid unnecessary repeat Gemini calls for the same replay/session unless there is a clear versioning reason.
- If helpful, version the coaching artifact so future prompt/model changes can be managed cleanly.

### 2. Training Timeline Integration

- Integrate cached coaching into the Training product, not just replay detail.
- At minimum, the Training experience should surface some combination of:
  - recent coaching timeline entries
  - session-level narrative summaries
  - key coaching themes or recurring strategic patterns
  - links between engine-evaluated mistakes and coaching explanations
- Make it easy for a player to move from raw accuracy/mistake signals to readable advice.

### 3. Session Review Enrichment

- Upgrade the training session review so it combines:
  - engine evaluation
  - key-moment severity
  - cached narrative coaching
- Keep the distinction explicit:
  - engine evaluation = structured analytical source
  - Gemini/fallback coaching = explanatory layer
- Do not blur the two into a fake single “oracle.”

### 4. Coaching History and Pattern Surfacing

- Add a lightweight history or pattern layer that helps players understand repeated themes across sessions.
- Examples include:
  - recurring coaching themes
  - repeated leaks
  - common endgame or discard-pattern advice
  - “most recent coaching note” surfaces on training/profile if that fits cleanly
- Keep this grounded in cached session artifacts rather than hallucinated account-wide summaries.

### 5. Operational Safety and Cost Control

- Keep Gemini entirely out of the gameplay critical path.
- If coaching generation is automatic or semi-automatic, ensure it is bounded and operationally sane.
- Reuse cached results aggressively.
- Preserve graceful fallback behavior when the API key is missing or the model call fails.
- The Training surface must remain functional even with no Gemini access.

### 6. Testing and Verification

Add automated coverage for the coaching-integration pass. At minimum, cover:

- replay coaching cache creation and reuse
- fallback coaching persistence behavior
- training/session endpoints surfacing cached coaching
- distinction between engine data and coaching data in responses
- regression coverage confirming replays, evaluation, training, profile, fairness, wallet, tournaments, and multiplayer still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No gameplay-critical Gemini integration
- No subscription/paywall packaging in this sprint
- No full cosmetic store in this sprint
- No new fairness algorithm work in this sprint
- No infrastructure migration in this sprint
- No rewrite or regression of the newly completed Game Room layout pass in this sprint

## Implementation Guidance

- Treat this as completing the training moat, not as sprinkling more AI copy around the app.
- The key product win is: after a match, a player should have both rigorous evaluation and readable coaching living in one durable training system.
- If shared presentation helpers are touched, preserve the recent Game Room improvements: 4-row suit-based hand layout, live deadwood counter, knock validation, four-color deck support, and dark-surface suit visibility.
- If scope must be narrowed, prioritize in this order:
  1. durable coaching cache
  2. training session integration
  3. coaching timeline/history
  4. profile/prestige tie-ins
- Be explicit in the report about:
  - where coaching is cached
  - when it is generated
  - how fallback coaching is stored
  - how duplicate Gemini calls are prevented
  - how the UI distinguishes engine evaluation from coaching narrative

## Acceptance Criteria

This task is complete only if all of the following are true:

- replay coaching is durably cached or persisted rather than treated as a purely transient endpoint result
- the Training product surfaces cached coaching in a meaningful session/timeline flow
- players can move from engine-evaluated mistakes to readable coaching without leaving the core training journey
- fallback/no-key behavior still yields a coherent cached coaching artifact instead of a broken or empty experience
- the distinction between engine evaluation and AI coaching remains explicit in API responses and UI
- automated tests for the new coaching/training layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_23.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the next coaching-integration pass now. After that, the strongest follow-on options will likely be instant live achievement triggers, monetizable cosmetic systems, or subscription packaging once the coaching + training moat feels fully complete.

