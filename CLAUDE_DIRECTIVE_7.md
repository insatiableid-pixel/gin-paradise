# Claude Directive 7: Coin-Gated Matchmaking and Escrow Sprint for Gin Galaxy

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_7.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_7.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT_6.md` show that Gin Galaxy now has:

- hardened auth, validation, and rate limiting
- server-authoritative multiplayer with rating-aware matchmaking
- turn timers, audit transcripts, and replay persistence
- transcript-driven AI analysis on stored matches
- dual-currency wallets with append-only transaction ledger
- signup bonuses, daily faucet claims, and wallet history
- 155 passing automated tests across the competitive platform and wallet foundation

The next highest-value gap is now **turning wallet balances into actual match entry and settlement flows**.

Gin Galaxy can now store and audit balances, but coins do not yet participate in gameplay. The next step is to let players enter stake-based matches, have the server hold funds safely in escrow, and resolve those funds correctly on win, loss, refund, timeout, or forfeit.

## Your Next Task

Build the coin-gated matchmaking and escrow flow for Gin Galaxy.

Focus on correctness, auditability, and clear wallet effects first, not on flashy casino presentation.

## Primary Objective

Allow players to join stake-based multiplayer matches with server-controlled entry fees, escrow holds, and deterministic payout or refund behavior.

## Required Scope

### 1. Stake Configuration and Match Metadata

- Add a clear stake model for multiplayer entry fees.
- Prefer fixed stake presets over arbitrary free-form amounts.
- Support enough metadata to know the currency, entry fee, and resulting prize pool or escrow amount for each match.
- Persist or expose stake metadata anywhere it is needed for later auditing, replay review, or wallet history.

### 2. Coin-Gated Queue / Match Entry

- Extend the multiplayer queue or match entry flow so a player can choose a stake level before joining.
- Only pair players whose queue parameters are compatible, including stake and currency.
- Reject queue or match entry when a player has insufficient balance.
- Keep the server as the source of truth for balance checks and matchmaking eligibility.
- Preserve current non-staked behavior only if it remains coherent; otherwise replace it cleanly with stake-aware flow.

### 3. Escrow Hold and Settlement Logic

- When a stake-based match is created or starts, hold the entry fees safely in escrow using the wallet/ledger primitives.
- Use explicit ledger transaction types for holds, releases, refunds, and payouts.
- Ensure balance mutations and ledger entries remain atomic.
- Define and implement resolution rules for:
  - normal completed match
  - timeout or forfeit after match start
  - disconnect after match start
  - failure before the match properly starts
  - queue cancellation or pairing failure before funds are committed
- If the match starts and later resolves by forfeit/timeout/disconnect, the winner should receive the appropriate stake-based outcome, not a silent refund.

### 4. Frontend Stake and Wallet UX

- Add a minimal but clear stake-selection experience in the multiplayer flow.
- Show enough wallet context for players to understand whether they can afford the selected queue.
- Surface insufficient-funds errors cleanly.
- Make the match result or wallet history reflect the stake outcome clearly enough that a player can understand what happened.

### 5. Auditability and Replay Context

- Ensure stake and settlement outcomes are auditable after the fact.
- If practical within scope, include stake context in replay detail, match history, or transcript metadata.
- Do not create balance changes that are invisible to the player or absent from the ledger.

### 6. Testing and Verification

Add automated coverage for stake-based matchmaking and escrow. At minimum, cover:

- successful stake-based queue or room entry with sufficient funds
- insufficient-funds rejection
- pairing only between compatible stake selections
- escrow hold creation for both players
- payout on normal win
- payout on forfeit/timeout/disconnect after match start
- refund or no-charge behavior when a match fails before proper start
- wallet history reflecting holds and payouts correctly
- regression coverage confirming existing auth, replay, and analysis behavior still works

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No external payments, deposits, or cash-out flow
- No legal/compliance claim that the product is fully sweepstakes-ready
- No PostgreSQL or Redis migration in this pass
- No rake unless it falls out naturally and can be implemented safely without muddying the core escrow flow
- No tournament wagering or other advanced economy modes yet

## Implementation Guidance

- Prefer a small number of fixed stake presets so behavior is easy to test and reason about.
- Treat the ledger as the audit trail and wallet balances as the current projection of truth.
- If there is a tradeoff between broader gameplay surface and airtight settlement logic, choose airtight settlement logic.
- Keep the settlement rules explicit and documented so later compliance or product review is possible.
- Reuse the existing ledger primitives instead of bypassing them with direct SQL.

## Acceptance Criteria

This task is complete only if all of the following are true:

- players can enter a stake-based multiplayer flow with server-validated balance checks
- compatible stake selections match correctly
- entry fees are held and settled through explicit ledger-backed escrow logic
- insufficient funds are rejected cleanly
- abnormal match endings resolve funds according to documented rules
- wallet history clearly reflects stake-related balance changes
- existing competitive-platform behavior still works
- automated tests for stake-based matchmaking and escrow exist and pass alongside existing tests
- a comprehensive `EXECUTION_REPORT_7.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the first stake-based matchmaking and escrow flow next. After that, the strongest follow-on options will be payout/rake refinement, deeper analysis sophistication, or the infrastructure migration path needed for larger-scale production economics.
