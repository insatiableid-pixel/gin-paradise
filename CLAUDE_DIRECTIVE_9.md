# Claude Directive 9: Rake and House Accounting Sprint for Gin Galaxy

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_9.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_9.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT_8.md` show that Gin Galaxy now has:

- hardened auth, validation, and rate limiting
- server-authoritative multiplayer with rating-aware matchmaking
- turn timers, transcripts, replay persistence, and replay analysis
- dual-currency wallets, ledger foundation, coin-gated matchmaking, and escrow settlement
- rules-faithful showdown presentation and table-style overlapping hand UX
- 206 passing automated tests across the core platform

However, the current stake-based PvP economy is still winner-takes-all with no platform revenue model.

Players can now enter paid matches safely, funds are held and settled correctly, and the gameplay experience is strong. The next highest-value gap is the actual business layer: Gin Galaxy still does not take a vig.

## Your Next Task

Build the rake and house-accounting layer for Gin Galaxy.

Focus on safe, explicit, auditable revenue capture for stake-based PvP. This is not a payment-processing sprint. It is a settlement-model sprint.

## Primary Objective

Add a configurable rake model to staked multiplayer matches so the platform can safely retain a house share of each eligible contest while keeping payouts, player-visible economics, and audit trails correct.

## Required Scope

### 1. Rake Model and Stake Configuration

- Add an explicit rake model for non-free stake presets.
- Keep free-play matches rake-free.
- Prefer clear, deterministic stake math over hidden or ad hoc calculations.
- The player-facing economy should make sense before queue entry, including:
  - entry fee
  - total pooled stake
  - rake amount or percentage
  - net winner payout
- Keep the rake configuration easy to tune later without redesigning the settlement model.

### 2. Settlement Logic with House Share

- Extend escrow settlement so a staked match can split the held funds into:
  - winner payout
  - platform rake
- Preserve deterministic behavior for:
  - normal completed match
  - timeout after match start
  - forfeit after match start
  - disconnect after match start
  - refund/no-charge paths before proper match start
- Ensure total held funds always reconcile exactly into payout plus rake, or refund where appropriate.
- Keep settlement atomic. No partial payout/rake states.

### 3. Ledger and House Accounting

- Record rake explicitly in the ledger, not implicitly by omission.
- Add or extend ledger primitives so house revenue is auditable by currency.
- Preserve player-facing transaction integrity while also making platform revenue queryable and explainable.
- If a dedicated house/accounting store is needed, keep it minimal and durable.
- Avoid invisible money movement. The accounting trail must explain where every held coin went.

### 4. Player-Facing Transparency

- Update multiplayer stake selection and match surfaces so players can see the rake-adjusted economics before committing.
- Show net payout clearly enough that a player understands the contest terms.
- Reflect rake-aware outcomes in post-match surfaces where appropriate, such as result messages, wallet history labels, or replay/match metadata.
- Do not surprise the player with hidden deductions after the fact.

### 5. Auditability and Replay/Match Context

- Ensure stake, rake, and payout context is preserved where it matters for later audit or review.
- If useful, extend transcript, replay, or match metadata additively so later support/reconciliation can explain a result without reconstructing it from code.
- Keep the economy story internally consistent across wallet history, match settlement, and any replay-adjacent metadata.

### 6. Testing and Verification

Add automated coverage for rake-aware settlement. At minimum, cover:

- free-play remains rake-free
- non-free stake settlement applies rake correctly
- payout plus rake equals held funds
- forfeit/timeout/disconnect after match start still settle correctly with rake
- pre-start failure still refunds fully with no rake taken
- player transaction history reflects payout/rake behavior accurately
- platform/house accounting is queryable and correct by currency
- regression coverage confirming existing auth, escrow, replay, showdown, and analysis behavior still works

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No external payment processor integration
- No redemption or cash-out flow
- No legal/compliance claim that the platform is fully launch-ready for real-money or sweepstakes deployment
- No tournament mode in this pass unless it is strictly required for rake plumbing
- No unrelated UI redesign outside rake disclosure and result clarity
- No infrastructure migration to PostgreSQL/Redis in this pass

## Implementation Guidance

- Treat the rake as part of the settlement contract, not as a cosmetic add-on.
- Favor transparent economics over aggressive monetization tricks.
- If there is a tradeoff between flexible stake experimentation and fully auditable settlement math, choose auditable settlement math.
- Keep free-play and refund flows obviously untouched by rake.
- Reuse the existing wallet, ledger, escrow, and transcript foundations rather than bypassing them.
- Be explicit in the Execution Report about the final settlement formula for each stake type and outcome type.

## Acceptance Criteria

This task is complete only if all of the following are true:

- non-free stake matches apply a clear rake model
- free-play matches remain unaffected
- payout, rake, and refund behavior reconcile cleanly under all supported outcomes
- rake is explicitly recorded and auditable by currency
- players can see rake-adjusted contest economics before entering a staked match
- post-match surfaces make settlement outcomes understandable
- existing competitive-platform behavior still works
- automated tests for rake-aware settlement exist and pass alongside existing tests
- a comprehensive `EXECUTION_REPORT_9.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the rake and house-accounting layer next. After that, the strongest follow-on options will be tournament mode, richer match-analysis depth, or infrastructure hardening for larger-scale production economics.
