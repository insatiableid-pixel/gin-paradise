# Claude Directive 34: Revenue Hardening, Stripe Webhooks, and Commercial Lobby Completion for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_34.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_34.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a completed single-coin economy pivot with coin packages, premium subscription billing, timer presets, matchmaking posture, and all sweepstakes framing removed from the living product
- a Stripe-backed billing module already in place, but still operating with a dry-run/degraded path when credentials are absent
- a fully green suite with `872/872` tests passing in the latest execution report

However, the current revenue path is not fully hardened yet:

1. The Stripe webhook / async confirmation path is not implemented, which means purchase and subscription fulfillment are not yet production-grade.
2. The backend supports timer speed and matchmaking posture, but the actual lobby controls are not yet rendered for players.
3. The billing and subscription lifecycle needs clearer completion, reconciliation, and support tooling if this is going to function as a real commercial product.

That means the next highest-value task is not a new content category. The next highest-value task is to make the new monetization model **operationally reliable and visible**.

## Your Next Task

Build the Revenue Hardening, Stripe Webhooks, and Commercial Lobby Completion sprint for Gin Paradise.

## Primary Objective

Turn the new coin-economy and premium-subscription model into a production-grade revenue surface by:

- hardening payment fulfillment and subscription lifecycle handling
- exposing the commercial match-lobby controls that shape spend behavior
- improving support and reconciliation visibility around billing

## Required Scope

### 1. Stripe Webhook and Billing Reliability

- Implement a real Stripe webhook endpoint for asynchronous purchase/subscription confirmation.
- Verify signatures when Stripe webhook secrets are configured.
- Support idempotent processing for duplicate or retried events.
- Ensure coin purchases and premium subscriptions can both be fulfilled/reconciled safely through the webhook path.
- Add durable event/purchase tracking sufficient for support, auditability, and replay-safe fulfillment.
- Be explicit in the report about which Stripe event types are handled and how duplicate fulfillment is prevented.

### 2. Subscription Lifecycle Completion

- Make the premium subscription flow behave like a real recurring product lifecycle, not just a one-time grant path.
- At minimum, support the core states/events that matter for a commercial subscription:
  - successful activation
  - duplicate/replayed confirmation safety
  - cancellation or non-renewing state handling if the chosen Stripe flow exposes it
  - accurate entitlement state after relevant billing events
- If the product can support a customer billing/management portal cleanly, add it.
- If any lifecycle state is intentionally deferred, state that precisely and honestly in the report.

### 3. Coin Purchase Lifecycle Completion

- Make coin purchases feel complete and trustworthy from the player's perspective.
- At minimum, players should be able to:
  - initiate a purchase
  - return from checkout to a clear success/cancel/error state
  - see purchase status/history in-product
  - understand whether the environment is in live mode or dry-run mode
- Avoid ambiguous “maybe it worked” purchase UX.

### 4. Commercial Lobby Completion

- Render the missing lobby controls for:
  - timer speed (`Fast / Medium / Slow`)
  - matchmaking posture (`Like Rated / Wider Field`, or similarly clear labels)
- These controls must be clearly tied to the existing backend functionality rather than being cosmetic-only.
- Communicate tradeoffs clearly:
  - timer speed affects match pace and decision time
  - posture affects match quality versus queue speed
- Preserve the coin PvP path as the primary lane in the lobby.

### 5. Billing and Support Visibility

- Improve support/admin visibility for the new billing system.
- At minimum, admins or support tooling should be able to inspect enough information to debug:
  - completed purchases
  - duplicate/ignored webhook events
  - premium subscription state issues
  - dry-run versus live billing mode
- Reuse existing admin/reporting patterns where possible rather than inventing a disconnected tool.

### 6. Reliability, Safety, and Honest Environments

- Preserve honest environment behavior.
- If Stripe credentials are absent, the app may remain in a clearly-labeled dry-run/degraded mode, but that mode must not pretend to be live billing.
- The live path and the dry-run path must remain distinguishable in UI/reporting.
- Do not weaken auth, wallet integrity, entitlement integrity, or ledger auditability while hardening billing.

### 7. Testing and Verification

Add automated coverage for the revenue-hardening pass. At minimum, cover:

- webhook authentication/signature behavior
- idempotent webhook handling and duplicate-event safety
- coin purchase fulfillment and wallet crediting
- premium subscription fulfillment and entitlement activation
- cancellation/error/retry edge cases where applicable
- billing-mode status behavior (live vs dry-run)
- lobby timer/posture selector integration with backend queueing
- admin/support billing visibility
- regression coverage across wallet, rake, tournaments, multiplayer, spectator, training, entitlements, and admin surfaces

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No new retention-content system such as missions, streaks, or puzzle mode in this sprint
- No mobile / App Store / Google Play billing in this sprint
- No new sweepstakes or redemption mechanics
- No major training-content expansion
- No physical-product commerce

## Implementation Guidance

- Prioritize reliability over breadth. The goal is to make the monetization path real and dependable before expanding adjacent product areas.
- Reuse the existing Stripe billing module, wallet ledger, entitlements layer, and admin surfaces as much as possible.
- Prefer durable billing-event records over implicit state assumptions.
- If webhook handling requires local testing accommodations, implement them honestly and document exactly what production still requires.
- If scope must be narrowed, prioritize in this order:
  1. Stripe webhook + idempotent fulfillment
  2. purchase/subscription completion UX
  3. lobby timer/posture selectors
  4. admin/support billing visibility
- Be explicit in the report about:
  - what is now production-grade
  - what still depends on credentials or deployment configuration
  - which subscription lifecycle events are truly supported
  - how players and admins can distinguish live mode from dry-run mode

## Acceptance Criteria

This task is complete only if all of the following are true:

- Stripe webhook handling exists and is idempotent for the supported live path
- coin purchases can be safely fulfilled/reconciled through the webhook flow
- premium subscription fulfillment updates entitlements correctly through the supported billing lifecycle
- players see clear success/cancel/error/pending outcomes around purchases and subscriptions
- the lobby exposes real timer speed and matchmaking posture selectors tied to backend behavior
- admins/support have a usable way to inspect relevant billing/reconciliation state
- dry-run behavior remains honest and distinguishable from live billing
- automated tests for the revenue-hardening layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_34.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new state

## Deliverable Expectation

Complete the revenue-hardening and commercial-lobby completion pass next. After that, the strongest follow-on options will likely be retention content that reinforces the coin + subscription loop, mobile/app-store monetization, or cosmetic-store monetization polish.
