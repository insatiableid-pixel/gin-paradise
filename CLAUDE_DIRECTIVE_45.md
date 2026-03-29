# Claude Directive 45: Reliability Reset and Final Utility-Surface Alignment for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_45.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_45.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

Gin Paradise is now in a strong player-facing state:

- all player-facing surfaces are aligned to the tropical paradise visual system
- the desktop board composition has been refined
- gameplay motion polish is in place

That means the biggest remaining gaps are now cleanup and readiness gaps, not broad product-direction gaps.

Two specific issues stand out from `EXECUTION_REPORT_44.md` and the updated status:

1. The automated suite is no longer fully green because of a pre-existing failure in `tests/api.test.ts` (`SqliteError: FOREIGN KEY constraint failed`)
2. The only remaining visual holdouts are the internal / utility surfaces:
   - `src/pages/Fairness.tsx`
   - `src/pages/AdminDashboard.tsx`

Those two gaps matter because they affect confidence and completeness:

- a non-green baseline slows all future work
- lingering old visual language in the last two surfaces makes the product feel not quite finished

The next highest-value step is therefore to restore a clean reliability baseline and finish the final utility-surface alignment.

## Your Next Task

Build the Reliability Reset and Final Utility-Surface Alignment sprint for Gin Paradise.

## Primary Objective

Return the project to a fully trustworthy baseline by fixing the outstanding automated-test failure and then bringing the final internal / utility surfaces into alignment with the established tropical paradise system.

The goal is not new scope. The goal is a cleaner, more finished foundation for whatever comes next.

## Required Scope

### 1. Fix the `tests/api.test.ts` Failure

Investigate and resolve the foreign-key failure called out in `EXECUTION_REPORT_44.md`.

At minimum:

- reproduce the failure reliably
- identify the true cause rather than papering over it
- fix the underlying issue in the test setup, teardown, fixture order, or application logic as appropriate
- restore the full automated suite to a green baseline if feasible

The execution report must clearly explain:

- what the failure actually was
- why it happened
- what changed to fix it

### 2. Re-Establish a Fully Green Verification Baseline

After the fix, run the strongest practical verification you can.

At minimum:

- lint / typecheck
- affected tests
- full test suite if feasible

If the entire suite still cannot be made green, the report must say exactly why and what remains blocked.

### 3. Align `Fairness.tsx` to the Tropical System

Bring the Fairness page into the established visual language without hurting its educational clarity.

At minimum:

- background, cards, callouts, and headings should align with the tropical paradise system
- code / explanation blocks should remain easy to read
- trust and technical credibility should remain stronger than decorative theming

This page should feel like part of the same product, but still like a serious integrity page.

### 4. Align `AdminDashboard.tsx` to the Tropical System

Bring the admin surface into visual parity with the rest of the app while keeping operational clarity high.

At minimum:

- tabs, tables, filters, cards, badges, and summary panels should align with the emerald / amber / gold system
- dense admin data must stay readable and scannable
- status colors should remain semantically meaningful

This should feel like a professional control room inside the same product, not a leftover theme.

### 5. Keep Scope Disciplined

Do not expand back into already-finished player-facing pages unless a tiny shared-pattern adjustment is truly needed.

This sprint is specifically about:

- restoring test confidence
- finishing the last two older-color surfaces

### 6. Verification

Because this sprint blends reliability and UI cleanup, verification must cover both.

At minimum:

- run lint / typecheck
- run the previously failing API test(s)
- run the full test suite if feasible
- manually inspect `Fairness.tsx` and `AdminDashboard.tsx` if the environment allows
- document final test counts and results clearly

## Non-Goals for This Pass

- No new gameplay mechanics
- No new monetization systems
- No additional large feature work
- No broad redesign of already-complete player-facing pages unless a tiny consistency touch is required

This sprint is about closing the remaining quality gaps.

## Implementation Guidance

- Treat the test failure as a real bug until proven otherwise.
- Prefer fixing the actual lifecycle / fixture / referential-integrity issue over weakening assertions.
- For Admin and Fairness theming, optimize for clarity first and theme second.
- If scope must narrow, prioritize:
  1. fixing the API test failure and restoring a green baseline
  2. `AdminDashboard.tsx` alignment
  3. `Fairness.tsx` alignment

## Acceptance Criteria

This task is complete only if all of the following are true:

- the cause of the `tests/api.test.ts` foreign-key failure is identified and addressed
- the automated baseline is materially healthier, ideally fully green
- `Fairness.tsx` is aligned with the tropical paradise system without losing clarity
- `AdminDashboard.tsx` is aligned with the tropical paradise system without losing operational readability
- verification is performed and documented clearly
- a comprehensive `EXECUTION_REPORT_45.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new baseline

## Deliverable Expectation

Complete the reliability reset and final utility-surface alignment next.

After that, the strongest follow-on options will likely be:

- deeper microinteraction refinement beyond gameplay
- achievement / reward celebration polish
- new feature work on top of a cleaner, fully aligned baseline
