# Claude Directive 35: Daily Missions, Streaks, and Puzzle Retention Loop for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_35.md`.
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
6. The task is not complete until the code, verification, `EXECUTION_REPORT_35.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a complete single-coin economy with coin packages, premium subscriptions, rake, timer presets, and matchmaking posture
- hardened revenue infrastructure with Stripe webhook handling, idempotent billing fulfillment, commercial lobby controls, and admin billing visibility
- a fully green suite with `913/913` tests passing in the latest execution report

That means the product is no longer blocked on basic monetization infrastructure.

However, the next major profit lever is now retention:

1. The app needs stronger daily-return behavior so players keep opening it even when they are not currently in an active match-buying cycle.
2. The product needs better habit loops around the coin economy so daily check-in, match participation, and subscription value reinforce each other.
3. The platform already has more than enough training depth to be useful; what it lacks now is a lighter-weight, repeatable retention loop rather than a deeper training stack.

The next highest-value task is therefore not more billing plumbing. The next highest-value task is a **daily retention loop** that reinforces the coin + subscription model without becoming pay-to-win.

## Your Next Task

Build the Daily Missions, Streaks, and Puzzle Retention Loop sprint for Gin Paradise.

## Primary Objective

Create a durable daily-return system that increases habit formation and long-term monetization by adding:

- daily missions
- daily streak progression
- a lightweight daily puzzle/challenge loop

The system should reinforce the coin economy and premium product without undermining purchases or competitive fairness.

## Required Scope

### 1. Daily Missions System

- Add a durable server-backed daily mission system.
- Missions should reset on a clear, deterministic daily cadence.
- At minimum, the mission model should support:
  - assignment
  - progress tracking
  - completion state
  - reward claiming
  - daily refresh
- Mission content should reinforce valuable product behaviors such as:
  - daily check-in / app open
  - playing matches
  - winning matches
  - engaging with approved training or puzzle content
  - spectating / social / tournament behaviors if that fits cleanly
- Mission rewards should primarily be coin-oriented and clearly bounded.

### 2. Streak System

- Add a durable daily streak system tied to repeat engagement.
- A player should be able to see:
  - current streak
  - next reward
  - what breaks or preserves the streak
- Streak rewards may be coins and/or cosmetic/progression rewards, but they must not become pay-to-win gameplay power.
- The streak design should make missing a day understandable and predictable, not opaque.

### 3. Daily Puzzle / Challenge Loop

- Add a lightweight daily puzzle or challenge mode that gives players a reason to return even when they are not ready to stake coins immediately.
- This does **not** need to match Backgammon Galaxy's full training depth.
- Favor one high-signal, repeatable daily challenge over a huge content system.
- Reuse existing evaluation/training/replay foundations where possible.
- The player should get:
  - one clear daily challenge
  - answer/result feedback
  - reward/progression for participation or success
- If premium differentiation is added here, keep it non-pay-to-win. Premium may deepen analysis, history, or archive access, but should not create unfair gameplay advantage.

### 4. Retention UX Surfaces

- Surface the new retention loop clearly in the product.
- At minimum, players should have obvious access from high-traffic surfaces such as:
  - Dashboard
  - Wallet / check-in context
  - Training or a new puzzle page
- The product should communicate:
  - what is available today
  - what has already been claimed/completed
  - what reward is next
- Avoid burying the retention loop behind admin or low-traffic pages.

### 5. Economy Tuning and Business Discipline

- Tune mission, streak, and puzzle rewards so they reinforce engagement without flooding the economy.
- The execution report must explicitly document:
  - mission reward ranges
  - streak reward schedule
  - puzzle reward logic
  - why the reward design does not undermine coin-package value
- Be conservative. A strong retention loop is more important than overly generous rewards.

### 6. Premium and Fairness Boundaries

- Premium can deepen convenience, history, archive access, or analysis around the retention loop.
- Premium must **not** become pay-to-win gameplay power.
- Do not create a system where paying players simply farm substantially more gameplay currency in a way that damages competitive integrity.
- Keep the coin economy, matchmaking, and ranked/coin PvP fairness intact.

### 7. Testing and Verification

Add automated coverage for the retention loop. At minimum, cover:

- daily mission assignment and reset behavior
- progress tracking and reward claiming
- streak increment / reset rules
- daily puzzle availability and completion handling
- reward economy behavior
- premium/non-premium boundaries where applicable
- regression coverage across wallet, billing, multiplayer, spectator, social, tournaments, training, and admin systems

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No attempt to build a full eXtremeGammon-equivalent training system
- No mobile / App Store / Google Play monetization in this sprint
- No new currency or sweepstakes behavior
- No pay-to-win premium rewards
- No giant content library if a smaller, repeatable daily loop can satisfy the goal

## Implementation Guidance

- Prioritize repeatability and clarity over content volume.
- Reuse the existing wallet, training, replay evaluation, entitlement, and profile foundations where practical.
- Keep reward math disciplined. The goal is to increase return frequency, not to replace coin purchases.
- Favor a server-authoritative reward/progress system over client-side counters.
- If scope must be narrowed, prioritize in this order:
  1. daily missions
  2. streak system
  3. daily puzzle/challenge
  4. premium/archive polish around the loop
- Be explicit in the report about:
  - the daily reset model
  - how rewards are bounded
  - which actions count toward missions and streaks
  - which parts of the loop are free versus premium-enhanced

## Acceptance Criteria

This task is complete only if all of the following are true:

- Gin Paradise has a visible daily mission system with durable progress and reward claiming
- Gin Paradise has a visible streak system with understandable reset/progression rules
- Gin Paradise has a lightweight daily puzzle/challenge loop
- the new retention rewards are clearly bounded and do not materially undermine the coin economy
- any premium enhancements remain non-pay-to-win
- automated tests for the retention loop exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_35.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new state

## Deliverable Expectation

Complete the retention-loop layer next. After that, the strongest follow-on options will likely be mobile/app-store monetization, cosmetic-store monetization polish, or deeper social/live-event programming that turns daily retention into larger competitive moments.
