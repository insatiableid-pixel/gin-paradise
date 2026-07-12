# Claude Directive 38: Real Stripe Checkout, Paid Offer Monetization, and Webhook Hardening for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_38.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_38.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest report shows that Gin Paradise now has:

- a unified activation funnel spanning Dashboard, Daily Hub, Wallet, and multiplayer entry
- first-purchase optimization with starter offers, premium intro logic, and offer analytics
- admin visibility into offer performance
- a fully green suite with `989/989` tests passing

That is meaningful progress. The product now has a real commercial funnel shape:

- players can be activated through daily retention
- low-balance states can be merchandised
- introductory offers can be targeted and measured
- premium trials can be granted through the entitlement system

However, the highest-value remaining gap is no longer awareness or merchandising. It is payment reality and production hardening.

The new starter bundle is positioned as a paid commercial offer, and the broader billing stack is now central to the business model. That means the next bottleneck is making sure priced flows are truly checkout-backed, webhook-confirmed, and safe for live deployment.

In particular, the platform now needs:

- real Stripe Checkout session creation for priced commerce
- paid-offer flows that do not grant value before payment confirmation
- durable linkage between offer purchases and billing sessions
- hardened webhook request handling with preserved raw body for signature verification
- reporting that distinguishes standard purchases from offer-driven revenue

This is the difference between a strong monetization prototype and a production-safe revenue system.

## Your Next Task

Build the Real Stripe Checkout, Paid Offer Monetization, and Webhook Hardening sprint for Gin Paradise.

## Primary Objective

Make monetization real and production-safe by wiring all priced commercial flows to actual Stripe-backed checkout sessions, preserving idempotent fulfillment, and keeping free-offer flows distinct from paid ones.

This sprint should turn the current commercial layer into a true billing system, not just a priced UI surface.

## Required Scope

### 1. Real Stripe Checkout Session Creation

Upgrade the current billing layer so live mode creates genuine Stripe Checkout Sessions for priced flows.

At minimum:

- coin package purchases must create real checkout sessions in live mode
- premium subscription starts must create real checkout sessions in live mode
- success and cancel URLs must remain configurable and sensible
- Stripe session metadata must include enough context to reconcile fulfillment safely, such as:
  - internal billing session ID
  - user ID
  - purchase kind
  - package / plan / offer ID as applicable

Dry-run behavior should remain available for local development, but live mode must no longer behave like a placeholder.

### 2. Paid Offer Checkout Flow

Split free offers from paid offers cleanly.

Required behavior:

- free offers, such as a standalone premium trial, may still redeem directly in-app
- paid offers, such as the starter bundle, must initiate checkout instead of granting value immediately
- a priced offer must only fulfill after confirmed checkout completion
- a paid offer must not be acquirable for free through the offer redemption endpoint

You may reuse the existing offer route shape if that is clean, but the API response must clearly indicate when a checkout redirect is required.

### 3. Offer-Aware Billing Sessions and Fulfillment

Extend the billing architecture so offer purchases are first-class billing objects rather than special-case side effects.

At minimum:

- billing sessions must be able to represent paid offer purchases, or an equivalent durable concept must exist
- paid offer purchase intents must be linked to the relevant offer ID
- webhook completion must route to the correct fulfillment path:
  - standard coin package
  - premium subscription
  - paid offer bundle
- paid offer fulfillment must remain atomic and durable:
  - grant coins
  - grant any premium-trial duration
  - insert redemption record
  - record purchase interaction

One-time enforcement and before-first-purchase rules must remain server-authoritative across both checkout initiation and final fulfillment.

### 4. Webhook Hardening and Raw-Body Integrity

Close the known gap in webhook request handling.

At minimum:

- `/api/webhooks/stripe` must receive preserved raw request bytes suitable for signature verification
- normal JSON parsing for the rest of the API must continue to work unchanged
- webhook verification must not rely on re-serialized JSON when the secret is configured
- malformed or unsupported events should still be recorded clearly in billing audit data
- idempotent processing and safe duplicate handling must be preserved

If there are framework-specific tradeoffs, document them clearly in the execution report.

### 5. Frontend Checkout UX and Return-State Accuracy

Update the UI so priced flows behave like real purchases rather than instant grants.

At minimum:

- Wallet purchase buttons should use returned checkout URLs cleanly
- Premium subscribe CTA should use returned checkout URLs cleanly
- Dashboard and Wallet paid-offer CTAs should redirect into checkout instead of immediately fulfilling
- free-offer CTAs should still redeem in-app without unnecessary friction
- success / cancelled / pending states should be accurate and should not imply fulfillment before webhook confirmation
- duplicate-click protection and loading states should remain user-friendly

The user experience should remain clean in both dry-run and live modes.

### 6. Admin and Revenue Attribution Visibility

Strengthen admin visibility so the business can tell what is actually generating revenue.

At minimum, the admin/support surfaces should make it clear:

- whether a billing session came from a standard package, subscription, or offer
- which offer generated revenue
- whether a paid offer purchase completed, failed, or is still pending
- whether premium granted via an offer was tied to a paid transaction or a free trial

Avoid double-counting revenue between offer analytics and billing analytics.

### 7. Testing and Verification

Add automated coverage for the new live-path and reconciliation behavior.

At minimum, cover:

- live-mode checkout session creation metadata for coin packages and subscriptions
- paid-offer checkout initiation behavior
- prevention of free fulfillment for priced offers
- webhook-driven fulfillment for paid offers
- idempotent duplicate webhook handling for offer purchases
- raw-body signature verification behavior
- admin visibility and attribution for offer-backed billing sessions
- regression coverage across billing, offers, wallet, premium, and dashboard flows

Perform manual verification too if the environment allows it.

## Non-Goals for This Pass

- No App Store / Google Play commercialization yet
- No customer portal or deep subscription self-service unless it falls out very naturally
- No broad A/B testing platform yet
- No giant seasonal offer engine with many variants
- No new currencies or economy redesign
- No pay-to-win monetization changes
- No broad redesign of unrelated product areas

This sprint is about making the current revenue stack real, safe, and attributable.

## Implementation Guidance

- Keep free-offer fulfillment and paid-offer checkout initiation clearly separated in code.
- Prefer a typed purchase-intent model over scattered conditional branches.
- Reuse the existing billing session and webhook architecture where possible instead of creating a second parallel payment pipeline.
- Be explicit about metadata contracts between checkout creation and webhook fulfillment.
- Preserve the current anti-abuse rules for offers; do not weaken them in order to simplify payment flow.
- If Stripe library integration requires new dependencies, keep the surface area small and well-isolated.
- In the report, be explicit about what is truly live-ready versus what remains intentionally mocked or deferred.

If scope must be narrowed, prioritize in this order:

1. real checkout session creation for all priced flows
2. paid-offer checkout plus webhook fulfillment
3. raw-body webhook hardening
4. admin attribution visibility
5. secondary UX polish

## Acceptance Criteria

This task is complete only if all of the following are true:

- Gin Paradise creates real Stripe Checkout sessions in live mode for coin packages and premium subscriptions
- the paid starter bundle no longer grants value immediately without payment confirmation
- free offers still work cleanly as direct in-app claims where appropriate
- offer purchases are durably linked to billing sessions or an equivalent authoritative purchase record
- webhook signature verification uses preserved raw-body data on the Stripe endpoint
- idempotent webhook fulfillment still works for standard purchases, subscriptions, and paid offers
- admin/support surfaces can distinguish standard purchases from offer-driven revenue
- automated tests for the new purchase and webhook paths exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_38.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new state without overstating production readiness

## Deliverable Expectation

Complete the real checkout and webhook-hardening layer next.

After that, the strongest follow-on options will likely be:

- lifecycle messaging and reactivation around abandoned or expired starter offers
- self-serve subscription management and billing recovery
- controlled experimentation on pricing, packaging, and offer sequencing
