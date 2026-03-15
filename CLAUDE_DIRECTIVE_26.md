# Claude Directive 26: Premium Entitlements and Training Subscription Packaging Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_26.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_26.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a strong coaching and training moat
- live achievements, prestige, and cosmetic inventory/catalog foundations
- a fully green suite with `614/614` tests passing

However, one major business-product layer is still missing:

1. The premium value is already built, but it is not yet packaged as a clear entitlement or subscription-ready product.
2. Training/coaching depth, cosmetic identity, and free core play are not yet separated into a clean monetization-ready model.
3. The platform can support subscription-style value, but there is no real plan/entitlement system to enforce it server-side.

## Your Next Task

Build the Premium Entitlements and Training Subscription Packaging sprint for Gin Paradise.

## Primary Objective

Create a clean server-backed entitlement model and premium product packaging for the training/coaching moat, while keeping core competitive play intact and avoiding a hard commitment to a specific billing provider in this sprint.

## Required Scope

### 1. Entitlement Model

- Add a durable server-backed entitlement/subscription model.
- At minimum, support:
  - free/default tier
  - premium/pro tier
  - clear plan or entitlement metadata per user
  - room for future trials, grants, expirations, or billing sync
- Server-side checks must be the source of truth for premium access.

### 2. Premium Feature Packaging

- Define and implement a sensible first premium bundle around the existing training/coaching product.
- Keep core gameplay, trust, and fair competition intact for all players.
- Premium features should come from the moat you have already built, such as deeper coaching/training layers, richer history, exports, advanced filters, or other clearly non-gameplay advantages.
- Be explicit in the implementation and report about:
  - what remains free
  - what becomes premium
  - why that split makes product sense

### 3. Product Surfaces and Upsell Flow

- Add user-facing product surfaces that explain the premium offering.
- At minimum, include some combination of:
  - current plan display
  - plan comparison or upgrade card/page
  - graceful locked states for premium-only surfaces
  - clear upgrade messaging inside Training/Profile where relevant
- Locked states should still feel useful and respectful, not broken or hostile.

### 4. Admin / Dev Grant Controls

- Add a safe way to grant or revoke premium access for development, testing, and operator support.
- This should work without requiring a real payment processor.
- Keep the admin/dev path auditable and server-enforced.

### 5. Integration Discipline

- Entitlement checks should be integrated thoughtfully into the existing training/coaching/profile/cosmetic surfaces without creating scattered inconsistent gating rules.
- Avoid duplicating access logic across many frontend-only conditionals.
- Preserve graceful fallback behavior where relevant.

### 6. Testing and Verification

Add automated coverage for the entitlement/package pass. At minimum, cover:

- free vs premium access behavior
- server-side enforcement of gated endpoints/features
- plan display / locked-state data flow
- admin/dev grant or revoke behavior
- regression coverage confirming gameplay, fairness, replays, coaching, training, profile, cosmetics, wallet, and tournaments still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No irreversible payment processor or app-store billing integration in this sprint
- No pay-to-win mechanics or gameplay access gating
- No new fairness algorithm work in this sprint
- No infrastructure migration in this sprint
- No regression of the recently completed Game Room layout improvements in this sprint

## Implementation Guidance

- Treat this as premium packaging and entitlement infrastructure, not as a rushed checkout integration.
- The product should emerge with a coherent answer to: "What is the free product, and what is the premium product?"
- Favor gating deeper analytical value over gating the core game.
- If shared presentation helpers are touched, preserve the recent Game Room improvements: 4-row suit-based hand layout, live deadwood counter, knock validation, four-color deck support, and dark-surface suit visibility.
- If scope must be narrowed, prioritize in this order:
  1. entitlement model
  2. server-side premium enforcement
  3. user-facing plan/upgrade surfaces
  4. admin/dev grant flow
- Be explicit in the report about:
  - the entitlement schema
  - the exact premium/free split
  - what is future-facing versus fully usable now
  - what would still be needed later for real billing integration

## Acceptance Criteria

This task is complete only if all of the following are true:

- Gin Paradise has a server-backed entitlement model for free vs premium access
- premium analytical value is packaged coherently without harming core competitive play
- user-facing plan or upgrade surfaces exist and explain the premium offering clearly
- admin/dev grant controls exist for testing/support without a real payment processor
- automated tests for the entitlement/package layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_26.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the premium-entitlements and subscription-packaging pass next. After that, the strongest follow-on options will likely be real billing integration, deeper public-profile/social competition features, or a fuller cosmetic storefront once the free/premium model is nailed down.
