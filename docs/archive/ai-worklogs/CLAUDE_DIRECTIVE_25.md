# Claude Directive 25: Cosmetic Inventory and Store-Ready Prestige Catalog Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_25.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_25.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a strong coaching and training moat
- a rich profile, achievement, and prestige identity layer
- live achievement triggers and instant unlock feedback
- a fully green suite with `580/580` tests passing

However, one obvious product/business layer is still missing:

1. Prestige items currently exist mainly as achievement-driven unlocks, not as part of a broader cosmetic inventory system.
2. There is no real cosmetic catalog, ownership/inventory layer, or store-ready browsing experience.
3. The platform has identity and retention hooks, but not yet the non-gameplay cosmetic surface that could eventually support monetization cleanly.

## Your Next Task

Build the Cosmetic Inventory and Store-Ready Prestige Catalog sprint for Gin Paradise.

## Primary Objective

Extend the existing prestige framework into a proper cosmetic system foundation: durable item catalog, ownership, inventory, preview/equip flows, and a product surface that can later support monetization without affecting gameplay fairness.

## Required Scope

### 1. Server-Backed Cosmetic Catalog

- Add a real catalog/inventory model for cosmetics rather than treating prestige items as one-off profile settings only.
- At minimum, support cosmetic item definitions with fields such as:
  - item key / id
  - cosmetic type
  - display name
  - description
  - rarity / tier
  - source (achievement, catalog, admin grant, etc.)
  - preview metadata needed by the UI
- Make the schema flexible enough to coexist with the current achievement-unlocked prestige items.

### 2. Ownership and Inventory

- Add durable ownership tracking for cosmetics.
- Existing prestige unlocks should map cleanly into this ownership system rather than becoming a separate incompatible path.
- A player should be able to see:
  - owned items
  - locked catalog items
  - currently equipped items
- Duplicate ownership must be prevented.

### 3. Inventory / Cosmetic UI

- Build the first real cosmetic browsing and equip surface.
- This can live inside Profile or a dedicated Inventory/Cosmetics page, whichever best fits the current product.
- At minimum, players should be able to:
  - browse unlocked and locked cosmetics
  - preview what they do to profile identity or supported surfaces
  - equip owned items
  - understand how an item is unlocked (achievement, grant, catalog, etc.)
- Keep the experience polished and status-driven, not cluttered.

### 4. Store-Ready Foundation

- Make the system structurally ready for future monetization, even if this sprint does not ship a real-money checkout flow.
- If a purchase path is implemented in this pass, keep it clearly non-redeemable / non-gameplay and operationally safe.
- It is acceptable to limit the first acquisition methods to:
  - achievement unlocks
  - admin/dev grants
  - soft-currency or placeholder catalog hooks
- Do not bind the project to a final payment/compliance model in this sprint.

### 5. Integration with Existing Prestige

- Migrate or reconcile the current title/badge/frame system into the broader cosmetic model cleanly.
- Preserve all previously earned prestige unlocks.
- Existing players must not lose unlocked items or active selections.
- Be explicit in the report about any migration/backfill rules.

### 6. Testing and Verification

Add automated coverage for the cosmetic-foundation pass. At minimum, cover:

- catalog retrieval
- ownership persistence
- duplicate-prevention
- equip/update validation
- compatibility with achievement-unlocked prestige items
- regression coverage confirming profile, achievements, coaching, training, replays, fairness, wallet, and multiplayer still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No pay-to-win mechanics or gameplay-affecting cosmetics
- No irreversible real-money checkout integration in this sprint
- No subscription packaging in this sprint
- No infrastructure migration in this sprint
- No new fairness algorithm work in this sprint
- No regression of the recently completed Game Room layout improvements in this sprint

## Implementation Guidance

- Treat this as the cosmetic/inventory foundation, not as a rushed monetization hack.
- Reuse and unify the existing prestige system rather than layering a second identity system on top of it.
- Preserve player readability and table clarity above all else. Cosmetic expression must not degrade card readability or trust.
- If shared presentation helpers are touched, preserve the recent Game Room improvements: 4-row suit-based hand layout, live deadwood counter, knock validation, four-color deck support, and dark-surface suit visibility.
- If scope must be narrowed, prioritize in this order:
  1. catalog + ownership model
  2. inventory/equip UI
  3. prestige migration compatibility
  4. store-ready acquisition hooks
- Be explicit in the report about:
  - how existing prestige items were mapped
  - what acquisition paths are supported
  - what remains placeholder/future-facing
  - what is intentionally not monetized yet

## Acceptance Criteria

This task is complete only if all of the following are true:

- Gin Paradise has a server-backed cosmetic catalog and ownership model
- previously earned prestige items remain available and compatible
- players can browse and equip cosmetic/identity items through a real product surface
- the system is structurally ready for future monetization without requiring that monetization to ship now
- automated tests for the new cosmetic/inventory layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_25.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the cosmetic inventory and store-ready prestige foundation next. After that, the strongest follow-on options will likely be subscription packaging around the training/coaching moat, a real cosmetic storefront, or deeper public-profile/social competition features.
