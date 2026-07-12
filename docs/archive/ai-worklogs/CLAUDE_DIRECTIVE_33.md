# Claude Directive 33: Profit-Optimized Coin Economy and Billing Pivot for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_33.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_33.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a mature competitive core with multiplayer, replays, replay evaluation, AI coaching, training surfaces, tournaments, seasons, social rivalry, spectator/broadcast tooling, cosmetics, admin tooling, wallet/escrow/rake primitives, and premium entitlements
- a completed Broadcast Productization sprint with admin featured-match operations, durable spectate preferences, broadcast analytics, public broadcast history, and `872/872` passing tests in the latest execution report
- enough technical foundation to stop exploring product direction abstractly and start aligning the business model with the actual monetization strategy

However, the current living product model is strategically misaligned:

1. The product and current status documentation still frame the platform around sweepstakes and a dual-currency model, but that direction is no longer the plan.
2. The biggest missing business-model pieces are still coin-package purchasing and real subscription billing.
3. The current free/coin/product framing is not yet optimized around long-term profit.
4. The platform has stronger training features than it needs for monetization success right now; matching Backgammon Galaxy's training depth is NOT the priority.

The product decision is now fixed:

- **Sweepstakes is out.**
- Gin Paradise should move toward a **Backgammon Galaxy-style virtual coin + subscription model**, minus physical-product commerce.
- The business should optimize for **long-term profit**, not for maximum free-rated accessibility.

## Your Next Task

Build the Profit-Optimized Coin Economy and Billing Pivot for Gin Paradise.

## Primary Objective

Convert Gin Paradise from a sweepstakes-flavored dual-currency platform into a non-redeemable, profit-oriented competitive coin platform with:

- a single public coin economy
- daily check-in coins
- house rake on coin matches
- coin-package purchasing
- real premium subscription billing
- AI/free-play only as onboarding, practice, or social fallback
- no primary free rated human ladder

## Required Scope

### 1. Remove the Sweepstakes Model from the Living Product

- Remove sweepstakes, Club WPT-style, redeemable, or real-money-adjacent framing from current product copy, current status docs, and current user-facing surfaces.
- Historical directives and historical execution reports do not need a full rewrite unless necessary for correctness, but all current living product surfaces must reflect the new direction.
- Remove or retire `sweeps` terminology from the user-facing product model.
- Be explicit in the report about what legacy internals were fully removed versus retained temporarily for migration safety.

### 2. Converge on a Single Public Coin Economy

- Replace the current public dual-currency experience with one canonical, non-redeemable gameplay currency.
- Retune wallet, faucet/check-in, stake presets, escrow, rake, admin reporting, spectator stake labeling, tournament economics, and any other economy-facing surfaces accordingly.
- If keeping legacy database columns temporarily is the safest migration path, that is acceptable, but the API/UI/types/docs must no longer present a sweepstakes or dual-currency product.
- The daily check-in should grant only a **trivial** amount of coins.
- A player with zero coins must **not** be able to enter coin-wagered PvP.

### 3. Profit-Oriented Match Product Design

- Do **not** create or preserve a primary free rated human queue.
- The main competitive public loop should be coin PvP, not zero-risk rated PvP.
- Zero-coin or risk-averse players may still have non-coin paths such as:
  - AI play
  - tutorial/practice play
  - optionally unranked friend/private matches
- Expose coin match options that clearly support both:
  - conservative wagering
  - aggressive wagering
- Also give players a clear queue/matchmaking choice between:
  - like-rated opponents
  - wider-field / faster matching
- Rework the lobby/matchmaking product language so the coin PvP path is clearly the primary business lane.

### 4. Timer Policy for Throughput and Anti-Cheat

- Replace the current single slow-turn assumption with a small fixed timer menu:
  - `Fast` = 20 seconds
  - `Medium` = 30 seconds
  - `Slow` = 40 seconds
- Do not ship any slower preset in this sprint.
- The timer design must optimize for:
  - game throughput
  - anti-stall behavior
  - reducing opportunities for outside assistance / effective cheating
- Preserve or improve the current timeout / auto-play / forfeit integrity.

### 5. Coin Packages with Real Billing

- Implement a real, provider-backed coin-package purchase flow for the current product.
- Choose a concrete billing provider appropriate to the current stack. Unless the repo already clearly points elsewhere, use **Stripe** as the default web billing provider.
- Add the full product path needed for coin purchases:
  - coin package catalog
  - checkout/session initiation
  - fulfillment / wallet crediting
  - durable purchase audit trail
  - graceful failure and duplicate-fulfillment protection
  - clear user-facing purchase surfaces
- If local credentials are unavailable, implement the real integration path honestly and gate live execution gracefully. Do not fake a live billing system and do not overclaim production readiness.

### 6. Real Premium Subscription Billing

- Turn the existing premium/entitlements layer into a real paid subscription path for the current product.
- Reuse the same provider as coin packages where practical.
- Premium should remain a monetized product tier around:
  - coaching depth
  - advanced review/history
  - retention/quality-of-life depth
- Premium must **not** become pay-to-win gameplay power.
- Replace illustrative pricing / admin-grant-only framing on the Premium page with a real purchase path, while preserving admin/support controls if they are still useful.

### 7. Business-Model Tuning and Explicit Reporting

- The execution report must explicitly document the chosen:
  - daily check-in amount
  - stake ladder
  - rake policy
  - coin package sizes / prices
  - subscription positioning
- Tune the economy so the daily free amount is enough to keep the app habit-forming, but not enough to undermine purchases or the value of winning coin matches.
- Preserve healthy coin sinks. At minimum, rake must remain active on coin matches, and tournament economics should remain coherent under the new model.

### 8. Testing and Verification

Add or update automated coverage for the monetization pivot. At minimum, cover:

- economy migration / single-coin public model behavior
- daily check-in grant behavior
- zero-coin gating for coin PvP
- AI or other approved non-coin fallback paths
- conservative/aggressive stake selection behavior
- timer preset behavior and enforcement
- coin-package checkout and fulfillment flows
- premium subscription checkout / entitlement activation flows
- ledger / wallet / rake / tournament regression coverage
- spectator / admin / social / season / replay / training regression coverage

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No sweepstakes, redemption, or cash-out behavior
- No attempt to match Backgammon Galaxy's training-content depth
- No pay-to-win gameplay power through premium or purchases
- No unlimited free rated human ladder as a primary product lane
- No timer preset slower than 40 seconds
- No physical-product commerce
- No rewrite of every historical archived directive/report unless necessary

## Implementation Guidance

- Favor business-model clarity over backward-compatibility purity.
- Reuse the wallet, escrow, rake, house-accounting, entitlement, and admin foundations already in the repo.
- AI-without-coins is acceptable because it does not split human liquidity and helps onboarding/retention.
- Free human play, if preserved, should be clearly secondary and clearly non-primary for the business model.
- If a full schema cleanup is too risky for one sprint, it is acceptable to keep legacy internals temporarily while removing them from the public product model and stopping new sweepstakes-oriented flows.
- If scope must be narrowed, prioritize in this order:
  1. single public coin economy + sweepstakes removal
  2. coin-package purchase flow
  3. real premium subscription billing
  4. matchmaking/lobby reshaping around coin PvP
  5. timer preset rollout
- Be explicit in the report about:
  - what the player can do with zero coins
  - what the player cannot do with zero coins
  - how rake works after the pivot
  - which current surfaces became secondary instead of primary
  - what is fully live versus what still depends on provider credentials

## Acceptance Criteria

This task is complete only if all of the following are true:

- the current living product no longer positions itself as sweepstakes-based
- the public wallet/product model is a single non-redeemable coin economy
- the daily check-in grants a trivial coin amount
- zero-coin players cannot enter coin-wagered PvP
- Gin Paradise still offers clearly defined non-coin fallback paths such as AI and/or approved social practice paths
- the product does not ship a primary free rated human ladder
- the main PvP product clearly supports conservative and aggressive coin stakes
- players can choose a like-rated versus wider-field matchmaking posture in a clear way
- the timer menu is `Fast / Medium / Slow` with 20s / 30s / 40s presets
- coin-package billing exists with a real provider-backed integration path
- premium subscription billing exists with a real provider-backed integration path
- premium remains non-pay-to-win
- rake still applies cleanly to coin matches and relevant tournaments
- automated tests for the monetization pivot exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_33.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new business model

## Deliverable Expectation

Complete the business-model pivot next. After that, the strongest follow-on options will likely be mobile/app-store monetization, cosmetic application/store polish, or deeper retention content such as puzzles, missions, and streak systems that reinforce the coin + subscription loop without weakening the core business model.
