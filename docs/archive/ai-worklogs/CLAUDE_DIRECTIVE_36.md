# Claude Directive 36: Unified Activation Funnel and Economy Loop for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_36.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_36.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest report shows that Gin Paradise now has:

- a complete single-coin economy with coin packages, premium subscriptions, rake, timer presets, and rating-aware matchmaking posture
- hardened billing and admin visibility
- a daily retention layer with missions, streaks, and a daily puzzle
- a fully green suite with `945/945` tests passing in the latest execution report

I also manually tested the current workspace build after booting the latest code on a clean local port. That live test produced four important findings:

1. The current build is no longer blocked on core backend capability:
   - Daily Hub loads and streak check-in works.
   - Wallet purchase flow works in dry-run mode.
   - Direct WebSocket matchmaking and game start work against the current server build.
2. The biggest remaining gap is no longer infrastructure. It is **product-loop coherence**.
3. The product currently splits the daily-return loop across multiple surfaces:
   - Daily Hub has a streak check-in and mission rewards.
   - Wallet still presents a separate daily claim surface.
4. There is a real economy/ledger bug:
   - Daily Hub streak, mission, and puzzle rewards are being recorded as `faucet` transactions.
   - That means Daily Hub rewards can consume the wallet faucet cooldown and create misleading transaction history.

This is the exact kind of issue that makes an economy feel confusing even when the backend is technically functional.

The next highest-value task is therefore **not** more training depth, more billing plumbing, or more tournament infrastructure.

The next highest-value task is to turn the existing systems into one coherent commercial player loop:

`claim today -> understand bankroll -> enter a stake -> play -> rebuy or subscribe if needed`

## Your Next Task

Build the Unified Activation Funnel and Economy Loop sprint for Gin Paradise.

## Primary Objective

Turn the existing dashboard, daily system, wallet, and match-entry flow into a single clear monetization and retention funnel that:

- removes conflicting daily-claim behavior
- fixes the underlying ledger/cooldown bug
- gives players one obvious next action when they open the app
- improves coin conversion without undermining the economy

This sprint should make the product feel commercially intentional, not merely feature-complete.

## Required Scope

### 1. Canonical Daily Claim Architecture

- Choose and implement **one** canonical daily coin-claim flow.
- My recommendation: the **Daily Hub** should become the primary daily-return surface.
- The Wallet should become a ledger + commerce surface, not a competing daily-check-in surface.

Required outcomes:

- remove or demote the Wallet faucet as a primary claim CTA
- make Daily Hub the clear place where the daily claim/re-entry loop lives
- preserve visibility of claim status from Wallet and Dashboard, but do not keep two competing primary daily claims

### 2. Fix the Economy Ledger Collision

- Fix the transaction taxonomy so daily rewards do not all reuse `faucet`.
- At minimum, separate these concepts cleanly in the ledger and cooldown logic:
  - canonical daily grant
  - streak reward
  - mission reward
  - puzzle reward
- Ensure that claiming a streak reward, mission reward, or puzzle reward does **not** accidentally consume the daily faucet cooldown unless that is explicitly intended by the new unified design.
- Update wallet history labels so the ledger reflects what actually happened.

This bug must be treated as a required fix, not optional polish.

### 3. Retune the Free Re-Entry Path

- The zero-coin or busted-player recovery loop should be intentional.
- The canonical daily loop should let a busted player get meaningfully back into the product without flooding the economy.

Design target:

- a player who is out of coins should be able to make meaningful progress toward re-entry through the daily loop
- ideally, the canonical daily loop should support getting back to at least the minimum public coin stake within a single daily session, or with an obviously nearby next step

Document the exact reward math in the report and justify it relative to:

- the lowest public coin stake
- rake economics
- coin package value

### 4. Economy-First Dashboard / Home

- Redesign the Dashboard so it acts like a true activation surface.
- The current home experience is too sparse and leaves too much empty space relative to the business goals.

The above-the-fold home experience should clearly show:

- current bankroll
- daily claim status / next reward
- recommended next action
- quick match CTA
- low-balance fallback or buy-coins CTA
- lightweight visibility into today’s progress

The user should not have to mentally assemble the loop by visiting multiple pages.

### 5. Match Entry Commercialization

- Improve the multiplayer entry surface so it better supports the coin economy.
- Keep AI play and friend play available, but make public coin play the primary commercial lane.

At minimum:

- surface recommended stakes based on bankroll
- show stronger low-balance guidance
- if a selected stake is unaffordable, present:
  - a lower-stake fallback
  - a clear buy-coins route
  - AI/friend fallback only as secondary
- keep `Fast / Medium / Slow` timing intact
- keep `Like Rated / Wider Field` posture intact

The goal is to reduce friction between bankroll state and match entry.

### 6. Wallet Conversion Framing

- Improve the Wallet so it merchandises coin packages in gameplay terms, not just raw price cards.
- Package cards should help a player understand practical value, such as:
  - approximate number of 100-coin entries
  - how long a package supports common play patterns
  - which package is best for cautious vs aggressive players

Also:

- keep dry-run/live billing mode visible but less intrusive than it is now
- make the wallet better at handling low-balance and first-purchase states
- keep subscription upsell present, but do not let it overshadow the coin economy

### 7. Navigation Prioritization

- The product currently exposes many top-level destinations.
- Preserve the full feature set, but improve information hierarchy so first-session and repeat-session behavior is clearer.

Favor stronger emphasis on:

- Play
- Daily
- Wallet
- Premium

De-emphasize surfaces that are valuable but not primary for the opening monetization/retention loop.

This does **not** require deleting features. It requires better prioritization.

### 8. Testing and Verification

Add automated coverage that would have caught the live issues found in testing. At minimum, cover:

- ledger transaction-type separation for daily systems
- canonical daily claim behavior
- cooldown correctness after streak/mission/puzzle rewards
- low-balance / re-entry behavior
- dashboard or API-level integration around daily-status + wallet-state coupling
- multiplayer affordability guidance if business logic changes there

Also perform manual verification against the current build if the environment allows it.

## Non-Goals for This Pass

- No major expansion of training depth
- No mobile / App Store / Google Play work
- No sweepstakes behavior
- No new currency
- No pay-to-win monetization
- No giant redesign of every page in the product

This sprint should be focused on the activation and economy loop, not on broad unrelated surface polish.

## Implementation Guidance

- Make explicit product decisions instead of preserving conflicting legacy behavior.
- The product should feel like one connected loop, not four partially overlapping systems.
- Wallet should primarily answer:
  - how many coins do I have?
  - how did I get/spend them?
  - how do I buy more?
- Daily should primarily answer:
  - what can I claim today?
  - what can I complete today?
  - how do I earn enough to get back into action?
- Dashboard should primarily answer:
  - what should I do right now?
- Keep the reward model conservative, but do not make the day-one or bust-recovery experience feel dead.
- Be explicit in the report about:
  - the new daily claim model
  - the exact ledger/event taxonomy
  - the re-entry math for low-balance users
  - why the new structure is better for profit and clarity

If scope must be narrowed, prioritize in this order:

1. ledger/cooldown correctness + canonical daily claim model
2. dashboard activation funnel
3. low-balance / stake-entry commercialization
4. wallet conversion framing
5. navigation hierarchy polish

## Acceptance Criteria

This task is complete only if all of the following are true:

- Gin Paradise has one clear canonical daily claim/re-entry flow
- the daily ledger/cooldown collision is fixed
- wallet history accurately differentiates daily grant, streak, mission, and puzzle rewards
- the home/dashboard surface clearly directs players into the coin economy loop
- low-balance players have a clear re-entry path that aligns with the minimum public coin stake
- wallet conversion framing is materially stronger than the current raw-card presentation
- the relevant automated tests exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_36.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new state

## Deliverable Expectation

Complete the activation-funnel and economy-loop unification layer next.

After that, the strongest follow-on options will likely be:

- deeper first-purchase optimization
- App Store / Google Play commercialization
- tournament and live-event programming that feeds the new daily-to-match-to-purchase loop
