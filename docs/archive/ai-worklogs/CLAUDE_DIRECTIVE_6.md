# Claude Directive 6: Sweepstakes Ledger Foundation Sprint for Gin Galaxy

## Default Protocol

This directive inherits the project default protocol.

For every task you complete in this workspace:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT.md` unless the user explicitly asks for a numbered variant.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT_5.md` show that Gin Galaxy now has:

- hardened backend auth, validation, and rate limiting
- server-authoritative multiplayer with rating-aware matchmaking
- server-enforced timers and auditable transcripts
- durable replay persistence and replay review UI
- transcript-driven AI analysis tied to exact stored matches
- 131 passing automated tests across the core competitive platform

The next highest-value gap is now the **economy foundation**.

Gin Galaxy already feels like a serious competitive platform, but it still lacks the wallet and ledger primitives required for any future Club WPT Gold-style flow. Before buy-ins, escrow, rake, or payout logic can exist, the project needs durable account balances, append-only transaction history, and an auditable free-coin claim path.

## Your Next Task

Build the sweepstakes ledger foundation for Gin Galaxy.

Focus on safe, auditable wallet primitives first, not on full monetization or payment processing.

## Primary Objective

Add a dual-currency wallet and append-only transaction ledger so authenticated users can hold balances, inspect ledger history, and claim a daily faucet through the web app.

## Required Scope

### 1. Dual-Currency Data Model

- Extend the current database schema to support both `gold_coins` and `sweeps_coins`.
- Add an append-only `transactions` ledger table that records every balance mutation.
- Store enough metadata to explain why each entry exists, such as transaction type, amount, currency, related user, timestamp, and a durable reference or note when helpful.
- Prefer explicit ledger helpers over scattered direct balance updates.
- Keep the schema easy to migrate later to PostgreSQL without redesigning the model.

### 2. Atomic Balance Mutation Rules

- Balance changes must be server-authored and atomic.
- Use database transactions so balance updates and transaction inserts succeed or fail together.
- Do not allow silent balance mutation without a corresponding ledger entry.
- Protect against negative balances unless the product explicitly allows a specific case.
- Design the helper layer so future escrow, buy-in, rake, refund, and prize-payout flows can reuse it cleanly.

### 3. Wallet and Faucet API

- Add authenticated backend endpoints for:
  - current wallet balances
  - recent transaction history
  - a daily faucet claim or equivalent free-coin claim flow
- Validate request inputs and enforce authentication everywhere.
- Return clear cooldown or already-claimed responses for faucet requests.
- Apply rate limiting where appropriate.

### 4. Minimal Wallet / Cashier UI

- Add a simple player-facing wallet experience in the frontend.
- Show current balances clearly.
- Let the user claim the daily faucet from an obvious place.
- Show a recent transaction list or ledger history.
- Optimize for correctness and audit clarity over flashy monetization styling.

### 5. Integrity and Product Framing

- Keep the server as the source of truth for balances.
- Avoid implying real-money purchase, redemption, or legal sweepstakes readiness if those flows do not yet exist.
- Use naming and copy that match the current implementation honestly.
- Document any assumptions around faucet amount, claim interval, or default starting balances.

### 6. Testing and Verification

Add automated coverage for the wallet and ledger foundation. At minimum, cover:

- wallet balance retrieval for an authenticated user
- transaction history retrieval
- successful faucet claim
- duplicate or cooldown faucet rejection
- atomic balance-plus-ledger writes
- auth rejection for wallet endpoints
- regression coverage confirming existing auth, replay, and analysis behavior still works

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No external payment processor integration
- No redemption or cash-out flow
- No coin-gated matchmaking or buy-in queues yet
- No rake or prize distribution yet
- No PostgreSQL or Redis migration in this pass
- No legal/compliance claim that the product is sweepstakes-ready

## Implementation Guidance

- Prefer small, explicit ledger primitives that future systems can trust.
- Keep faucet values and claim cadence configurable, not hard-coded in a way that is painful to change later.
- Treat the ledger as the audit trail and balances as a fast current-state projection.
- If there is a tradeoff between a prettier wallet UI and stronger auditability, choose auditability.
- Design the API and data model so the next sprint can add escrow and match entry fees without undoing this work.

## Acceptance Criteria

This task is complete only if all of the following are true:

- authenticated users have durable `gold_coins` and `sweeps_coins` balances
- every wallet mutation is recorded in an append-only transaction ledger
- balance updates and ledger writes happen atomically
- an authenticated user can view wallet balances and recent ledger history
- an authenticated user can claim the configured faucet once per allowed interval
- duplicate or early faucet claims are rejected cleanly
- existing competitive platform behavior still works
- automated tests for wallet and ledger behavior exist and pass alongside existing tests
- a comprehensive `EXECUTION_REPORT.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the wallet and ledger foundation next. After that, the strongest follow-on options will be coin-gated matchmaking and escrow flows, deeper analysis sophistication, or the larger infrastructure migration path for multi-instance scale.
