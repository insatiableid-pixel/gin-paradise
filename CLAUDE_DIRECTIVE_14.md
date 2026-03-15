# Claude Directive 14: Gin Paradise Rename and Brand Consistency Sprint

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_14.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_14.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest `EXECUTION_REPORT_13.md` shows that the Game Feel & Interaction Polish sprint is complete and the platform now has:

- drag-and-drop hand sorting
- active meld highlighting
- meaningful motion and restrained audio
- 335 passing automated tests across 14 files with zero regressions

However, the product is still branded throughout the codebase and docs as **Gin Galaxy**.

The product name has now been intentionally changed to **Gin Paradise** to reduce infringement risk and establish the brand that should be used going forward.

This rename now needs to be handled as a deliberate, consistency-focused sprint rather than a scattered string-replace.

## Your Next Task

Complete the `Gin Galaxy` → `Gin Paradise` rename and brand consistency sprint.

## Primary Objective

Remove the old public-facing brand from the active product surface and current documentation, replace it with `Gin Paradise`, and do so without breaking persisted user settings or other important state.

## Required Scope

### 1. Public-Facing Brand Replacement

- Replace `Gin Galaxy` with `Gin Paradise` across active user-facing surfaces.
- This includes, at minimum, anywhere the brand is shown to a player or operator:
  - app shell / layout branding
  - page titles and visible headers
  - metadata or manifest-style display names if present
  - deployment/operator docs that describe the product
  - status / current root docs that are meant to describe the live project
- Do not leave mixed branding in the live app.

### 2. Active Documentation Alignment

- Update the active living docs to the new name, especially:
  - `PROJECT_STATUS.md`
  - current deployment documentation
  - current metadata/configuration docs if applicable
- Also reconcile any obvious drift between `PROJECT_STATUS.md` and `EXECUTION_REPORT_13.md` while touching those files, since the status report appears behind the latest completed sprint.
- Historical archived reports/directives do not need a full rewrite unless there is a strong reason; prioritize current living docs and current product surfaces.

### 3. Persistence-Safe Key Migration

- Audit persisted keys or user-visible storage identifiers that include the old brand.
- The existing preference storage key includes the old name (`gin-galaxy-prefs`).
- If you rename persisted keys, implement a safe one-time migration path so existing users do not silently lose preferences.
- Be explicit in the Execution Report about what was migrated and what remained unchanged.

### 4. Package / Metadata / Operational Naming

- Update low-risk package metadata, display metadata, server startup labels, and similar active naming surfaces where appropriate.
- If there are internal technical names that still reference `gin-galaxy`, decide deliberately whether to change them now or leave them temporarily.
- Do not perform risky path or folder renames unless they are clearly safe and worth the churn.
- If any internal `gin-galaxy` references remain intentionally, document them clearly in the Execution Report as internal-only holdovers.

### 5. Search-Based Verification Pass

- Use a repo-wide search to identify remaining occurrences of:
  - `Gin Galaxy`
  - `gin-galaxy`
  - `gin galaxy`
- Clean up the occurrences that matter for the live product, current docs, active metadata, and active developer-facing naming where it is low-risk.
- Distinguish between:
  - public-facing / active references that must be renamed now
  - historical archive or internal path references that may reasonably remain for the moment

### 6. Testing and Verification

Add or update automated coverage where practical for any logic introduced in this pass, especially around:

- storage-key migration behavior if implemented
- metadata / preference-store behavior touched by the rename
- regressions caused by the rename pass

Also perform manual verification if the environment allows it, including:

- visible app branding
- browser title / metadata if applicable
- persistence behavior after reload
- no mixed-brand UI states

## Non-Goals for This Pass

- No new gameplay features
- No PR-score / Python microservice work in this sprint
- No scheduled tournament expansion in this sprint
- No PostgreSQL/Redis migration in this sprint
- No risky repository-wide folder rename unless it is clearly justified
- No need to rewrite every historical archived execution report or directive

## Implementation Guidance

- Treat this as a brand-safety and consistency pass, not a cosmetic afterthought.
- Prioritize what a player, operator, or public repo reader would actually see first.
- Preserve user trust: do not break saved preferences or other state if a storage key changes.
- Be disciplined about scope. A thoughtful rename with migration and documentation is more valuable than a chaotic string replace.
- In the Execution Report, explicitly list any old-name references that remain and why.

## Acceptance Criteria

This task is complete only if all of the following are true:

- the live app and active current docs use `Gin Paradise` instead of `Gin Galaxy`
- no mixed-brand user-facing surfaces remain
- any renamed persisted storage keys migrate safely or are deliberately preserved with clear rationale
- active deployment / operator docs are aligned with the new brand
- `PROJECT_STATUS.md` is updated to both the new name and the current post-Directive-13 state
- any intentionally retained internal `gin-galaxy` references are documented clearly
- automated tests for any migration / logic touched in this pass exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_14.md` is saved to the workspace root

## Deliverable Expectation

Complete the brand rename to `Gin Paradise` next. After that, the strongest follow-on options will likely be the mathematical replay-evaluation / PR track, scheduled tournament expansion, or later infrastructure scale-out if usage begins to justify it.