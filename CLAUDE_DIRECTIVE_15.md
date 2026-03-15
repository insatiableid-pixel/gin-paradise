# Claude Directive 15: Mathematical Replay Evaluation and PR MVP Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_15.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_15.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a hardened, deployable single-node competitive platform
- replay persistence, transcript-driven Gemini coaching, tournament mode, and polished game feel
- brand consistency under the new `Gin Paradise` name
- 335 passing automated tests in the latest execution report, though current status documentation may still need that count reconciled
- a freshly strengthened `Apex v2` Python engine with bounded actual-deadwood discard verification, stock-depth-aware knock behavior, duplicate-hand benchmark methodology, and dedicated Apex-side test coverage

The biggest remaining strategic gap is that the analysis layer is still primarily narrative. It can coach, but it does not yet provide a mathematically structured replay evaluation layer that can flag concrete mistakes and summarize decision quality the way Backgammon Galaxy-style products do.

## Your Next Task

Build the first Mathematical Replay Evaluation and PR MVP for Gin Paradise.

## Primary Objective

Add a structured, engine-backed replay evaluation layer that uses the existing Python Gin Rummy engine to score decision quality and surface per-turn mistakes in a more objective way than Gemini text alone.

## Required Scope

### 1. Python Evaluation Bridge

- Do **not** port the heavy evaluation logic to TypeScript in this sprint.
- Reuse the existing `gin_rummy/` Python engine and strongest available evaluation logic where practical.
- Default to `Apex v2` as the first evaluator unless there is a clear, benchmark-backed reason to use a different Python engine.
- Introduce a lightweight integration boundary from the Node/TypeScript app to Python.
- A local subprocess bridge or lightweight local service is acceptable; choose the narrowest honest mechanism that fits the current architecture.
- Keep the deployment story understandable. If this adds a new runtime requirement or startup flow, document it clearly.

### 2. Structured Replay Evaluation

- Use stored replay transcript data to reconstruct player decision points.
- For the MVP, focus on the decision types that can be evaluated most credibly and performantly with the current engine.
- Discard decisions should be first-class if feasible. Knock / do-not-knock decisions are also strong candidates. Draw decisions may be included if the methodology is reliable.
- Discard and knock decisions should be prioritized ahead of deeper hidden-state draw evaluation if scope must be narrowed.
- For each evaluated decision, produce structured output such as:
  - turn / sequence reference
  - actual action taken
  - engine-preferred action
  - score delta / loss metric / severity classification
  - tag such as `best`, `inaccuracy`, `mistake`, or `blunder`
- Be mathematically honest. Do not present the evaluator as a solved-game oracle if it is still an engine-guided approximation.
- Preserve performance guardrails. Avoid naive full-search or unbounded Monte Carlo behavior that can hang on degenerate seeds.

### 3. Summary Score / PR Layer

- Aggregate the per-turn evaluations into a replay-level summary score.
- If you use a `PR`, `accuracy`, or similarly strong label, define it clearly and use it consistently.
- The methodology must be explicit enough that the score is defensible and not just cosmetic.
- If the first version is better described as `engine accuracy` or `evaluation score` rather than true PR, prefer honesty over hype.

### 4. Backend Storage and Access

- Decide whether replay evaluations should be generated on demand, cached, or persisted.
- Avoid unnecessary recomputation if the same replay is analyzed repeatedly.
- Preserve the existing authentication and participant-only access expectations around replay analysis.
- If the evaluator fails or Python is unavailable, degrade gracefully rather than breaking the replay experience.
- Add bounded execution behavior (timeouts / fail-safe handling / partial-result strategy) so one pathological replay position cannot stall the product.

### 5. UI Integration

- Surface the structured evaluation in the replay experience.
- At minimum, the replay UI should show:
  - a replay-level summary score
  - per-turn mistake markers / tags
  - enough detail for a user to see what the engine preferred versus what they did
- Keep the presentation operationally clear and serious rather than flashy.
- Gemini coaching can remain as the narrative layer, but it should not be confused with the mathematical evaluator.

### 6. Documentation

- Document the evaluation methodology at a practical level.
- Explain what the Python bridge does, what kinds of actions are evaluated, and what the score means.
- Update deployment or environment docs if this adds a Python dependency to the web-platform runtime path.

### 7. Testing and Verification

Add automated coverage for the evaluation layer. At minimum, cover:

- transcript-to-evaluation pipeline behavior
- access control and replay ownership behavior for the new evaluation path
- graceful failure when the Python evaluator is unavailable or returns an error
- caching / persistence behavior if introduced
- regression coverage confirming existing replay, Gemini analysis, wallet, tournament, and multiplayer flows still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No full CFR / information-set solver implementation
- No claim of perfect-play proof unless actually achieved
- No PostgreSQL/Redis migration in this sprint
- No scheduled multi-table tournament expansion in this sprint
- No broad frontend redesign unrelated to replay evaluation

## Implementation Guidance

- Treat this as the first serious bridge between the research-grade Python engine and the product.
- Start from `Apex v2` as the practical champion candidate and reuse other Python logic such as `Nexus`, `DeepKnock`, deadwood evaluation, layoff awareness, and opponent-aware heuristics where they materially help.
- If you need to compare evaluators, use the improved duplicate-hand benchmark methodology rather than noisy seat-alternation assumptions.
- Favor a narrow, truthful evaluator over an overclaimed but shallow score.
- Keep the product language disciplined: clearly separate engine-backed evaluation from Gemini-written commentary.
- In the Execution Report, be explicit about:
  - what action types are evaluated
  - what the score actually means
  - whether the evaluator is on-demand, cached, or persisted
  - what the current limitations still are

## Acceptance Criteria

This task is complete only if all of the following are true:

- the web platform can obtain structured replay evaluation from the Python Gin Rummy engine
- replay viewers can see a summary score and per-turn mistake tagging
- the methodology is documented honestly and not presented as a solved perfect oracle unless warranted
- access control remains correct for replay evaluation
- evaluator failure degrades gracefully without breaking the replay UX
- automated tests for the new evaluation path exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_15.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the first mathematical replay-evaluation / PR-style MVP next. After that, the strongest follow-on options will likely be scheduled tournament expansion, deeper evaluation sophistication, or later infrastructure scale-out once real usage warrants it.