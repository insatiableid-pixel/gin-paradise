# Claude Directive 37: First-Purchase Optimization, Starter Offers, and Offer Analytics for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_37.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_37.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest report shows that Gin Paradise now has:

- a unified activation funnel with a canonical daily-return surface
- fixed reward-type taxonomy and corrected wallet faucet cooldown behavior
- an economy-first dashboard, commercialized match entry, and gameplay-framed wallet merchandising
- a fully green suite with `959/959` tests passing

That means the product has now crossed an important threshold:

- the coin economy exists
- billing exists
- premium exists
- the app now has a coherent daily-to-bankroll-to-match loop

What it does **not** yet have is a deliberate first-purchase conversion layer.

Right now monetization is still mostly generic:

- standard coin packages
- a standard premium page
- contextual low-balance guidance

That is good infrastructure, but it is not yet optimized commercial behavior.

To maximize long-term profit, the next highest-value step is to convert newly activated users into:

- first-time coin purchasers
- premium trial starters
- repeatable commercial offer viewers whose behavior is measurable

In other words: the funnel is now shaped. The next step is to monetize it intentionally.

## Your Next Task

Build the First-Purchase Optimization, Starter Offers, and Offer Analytics sprint for Gin Paradise.

## Primary Objective

Increase first paid conversion and premium starts by adding a durable commercial offer layer on top of the current billing and entitlement systems.

This sprint should create:

- at least one compelling one-time starter offer
- durable eligibility and anti-abuse rules
- contextual offer presentation in high-intent states
- analytics and admin visibility so the business can see whether offers are working

The goal is not more billing plumbing by itself. The goal is higher conversion from the funnel that now exists.

## Required Scope

### 1. Offer System Foundation

Add a durable offer system that can support introductory monetization without becoming brittle one-off UI logic.

At minimum, the system must support:

- named offers / SKUs
- eligibility rules
- impression tracking
- dismissal tracking
- purchase / conversion tracking
- one-time enforcement where appropriate

The offer system can be code-defined if that is the cleanest first implementation, but it must be durable and testable.

### 2. One-Time Starter Offer

Create at least one meaningful first-purchase starter offer for new or still-unconverted users.

Recommended shape:

- a one-time starter bundle
- better value than baseline à la “introductory” pricing/value framing
- may include:
  - coins
  - a limited premium trial
  - optionally a cosmetic bonus if it fits cleanly

Important constraints:

- it must not be pay-to-win beyond the existing coin economy model
- it must not be infinitely repeatable
- it must be clearly better than standard packages without breaking long-term package economics

The execution report must explain the exact offer economics and why they are commercially sensible.

### 3. Premium Trial / Intro Logic

Use the existing entitlement architecture to add a proper introductory premium path where appropriate.

At minimum:

- support a limited premium trial attached to a starter offer or intro upgrade path
- prevent duplicate or repeated trial abuse
- ensure expiration behavior is durable and understandable
- keep premium benefits analytical / convenience oriented, never pay-to-win

The system should be compatible with both dry-run and live billing modes.

### 4. Contextual Offer Surfaces

Show commercial offers where intent is highest.

At minimum, add or improve offer presentation in some combination of:

- Dashboard
- Wallet
- low-balance / busted-player states
- multiplayer insufficient-funds or unaffordable-stake states
- Premium page

Offer surfaces should be:

- contextual
- dismissible
- not spammy
- governed by simple cooldown/visibility rules

Do not build a pop-up casino. Build a disciplined commercial layer.

### 5. Standard Package Preservation

Keep the existing standard coin-package and premium flows intact.

The new offer layer should complement, not replace:

- standard coin packages
- standard premium subscription
- the existing billing history / admin visibility model

Users who are not eligible for offers should still see the ordinary commercial experience cleanly.

### 6. Offer Analytics and Admin Visibility

Add enough analytics and admin visibility to answer whether the new offer layer is working.

At minimum, track:

- offer impressions
- offer dismissals
- offer clicks / open intent
- offer purchases
- revenue by offer
- premium trial starts if trials are included

Expose this through admin/support surfaces in a way that is actually useful.

The business should be able to see:

- which offers are being shown
- which offers convert
- whether users are buying starter offers vs standard packages

### 7. Eligibility and Anti-Abuse Rules

The offer system must enforce clear rules such as:

- only before first purchase
- only one redemption per account
- optional account-age or account-state gating if useful
- no repeated trial claiming

These rules must be server-authoritative.

### 8. Testing and Verification

Add automated coverage for:

- offer eligibility
- one-time enforcement
- starter-offer fulfillment
- premium trial entitlement behavior
- analytics recording
- admin visibility
- regression across billing, wallet, entitlements, dashboard, and multiplayer affordability states as applicable

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No App Store / Google Play packaging yet
- No broad experimentation/A-B testing platform
- No giant promo engine with dozens of offers
- No sweepstakes behavior
- No new currency
- No pay-to-win premium or offer behavior
- No broad redesign of unrelated product areas

This sprint is specifically about first-purchase conversion and offer measurability.

## Implementation Guidance

- Start with one strong commercial offer rather than many weak ones.
- Favor a clean starter-offer architecture that can later support more offers, instead of scattering hard-coded banners everywhere.
- Use existing billing and entitlement systems as the fulfillment backbone.
- If a cosmetic bonus is included, keep it lightweight and easy to reason about.
- Offer copy and presentation should be commercially clear:
  - one-time
  - what’s included
  - why it’s a better deal
  - when it goes away, if applicable
- Be explicit in the report about:
  - offer eligibility rules
  - starter-offer pricing/value vs standard packages
  - premium trial duration and enforcement
  - what analytics are now captured
  - what admin/reporting visibility was added

If scope must be narrowed, prioritize in this order:

1. offer model + starter offer + durable fulfillment
2. contextual offer surfaces
3. analytics/admin visibility
4. cosmetic bonus or extra presentation polish

## Acceptance Criteria

This task is complete only if all of the following are true:

- Gin Paradise has at least one server-authoritative starter offer for first-purchase optimization
- the starter offer has durable eligibility and one-time enforcement
- any included premium trial has durable entitlement behavior and anti-abuse protection
- contextual offer surfaces exist in high-intent states
- standard package and subscription flows still work cleanly
- offer analytics and admin visibility exist and are useful
- automated tests for the offer system and regressions exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_37.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new state

## Deliverable Expectation

Complete the first-purchase optimization layer next.

After that, the strongest follow-on options will likely be:

- App Store / Google Play commercialization
- tournament/live-event programming that feeds the purchase funnel
- deeper retention-to-purchase sequencing and lifecycle messaging
