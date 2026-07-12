# Claude Directive 10: Admin Revenue and Operations Dashboard Sprint for Gin Galaxy

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_10.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_10.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT_9.md` show that Gin Galaxy now has:

- hardened auth, validation, and rate limiting
- server-authoritative multiplayer with rating-aware matchmaking
- turn timers, transcripts, replay persistence, and replay analysis
- dual-currency wallets, escrow settlement, and a working rake model
- house revenue recorded in a durable ledger
- rules-faithful showdown presentation and table-native hand UX
- 238 passing automated tests across the platform

However, one important operational gap remains: the platform can now take a vig, but there is still no proper admin-facing surface to inspect that revenue, review settlements, and support day-to-day operation.

The next task is to make the business layer observable and supportable.

There are also two small but important player-facing preference requests that should be included in this pass:

- make deadwood count display optional in the UI
- make four-color deck rendering optional in the UI

## Your Next Task

Build the admin revenue and operations dashboard for Gin Galaxy.

Focus on secure, read-mostly operational visibility first. This is not a player-facing feature sprint. It is an operator-control and business-observability sprint.

## Primary Objective

Give an authorized operator a safe way to inspect rake revenue, recent settlements, match outcomes, and key wallet/ledger activity without having to query SQLite manually.

## Required Scope

### 1. Admin Authentication and Access Control

- Add an explicit admin access model.
- Do not rely on obscurity, hidden routes, or client-only checks.
- Protect all admin endpoints and admin UI with server-enforced authorization.
- Keep the first version conservative and secure. Read-only access is preferred unless a write capability is clearly necessary and tightly scoped.
- Document how an admin account is identified or provisioned.

### 2. Admin Revenue Visibility

- Expose the existing house-accounting data through secure admin APIs.
- At minimum, support:
  - total rake by currency
  - recent rake ledger entries
  - per-stake or recent-settlement visibility if practical
- Make the numbers easy to reconcile against the existing house ledger and settlement logic.
- Preserve auditable, queryable provenance for every revenue number shown.

### 3. Settlement and Match Operations View

- Give admins a way to inspect recent staked match outcomes.
- Include enough context to answer questions like:
  - who played
  - what the stake was
  - what the winner payout was
  - what rake was taken
  - how the match ended (completion, forfeit, timeout, disconnect)
- If replay or transcript identifiers help support/debugging, surface them.
- Optimize for supportability and trust, not visual flash.

### 4. Wallet / Ledger Support Visibility

- Provide admin visibility into player wallet state and recent ledger activity at an appropriate level.
- Prefer inspection over mutation in this pass.
- If player lookup is added, keep it targeted and useful for support cases.
- Avoid broad destructive admin powers unless absolutely necessary.

### 5. Minimal Admin UI

- Build a simple, secure admin-facing UI inside the web app.
- At minimum, include:
  - revenue summary cards
  - recent rake ledger or settlement table
  - recent staked match outcomes
  - targeted player or wallet inspection if feasible in scope
- Keep the visual design clean and operationally legible.
- This can be intentionally utilitarian; correctness and clarity matter more than polish.

### 6. Small Player Preference Controls

- Add a user-facing option to show or hide deadwood count during play.
- Add a user-facing option to enable or disable a four-color deck.
- These must be optional preferences, not hard-coded mandatory changes.
- Apply them consistently anywhere the live card table uses the relevant visuals or deadwood display.
- Prefer a lightweight implementation that is easy for players to discover and toggle.
- If persistence is straightforward, persist the preference in a sensible way; otherwise use the smallest honest implementation and document it clearly.

### 7. Testing and Verification

Add automated coverage for the admin layer. At minimum, cover:

- non-admin rejection for admin APIs
- successful admin access for revenue summaries
- successful admin access for recent rake ledger data
- successful admin access for recent settlement or staked-match data
- any player/wallet inspection endpoint behavior added in this pass
- deadwood-count preference behavior if surfaced in code paths that are practical to test
- four-color-deck preference behavior if surfaced in code paths that are practical to test
- regression coverage confirming existing auth, escrow, replay, showdown, and analysis behavior still works

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No external payments or cash-out flows
- No broad admin write tools or arbitrary balance editing unless strictly required
- No tournament mode in this pass
- No infrastructure migration to PostgreSQL/Redis in this pass
- No unrelated redesign of player-facing pages
- No analytics warehouse or BI tooling beyond what the app itself needs for core admin visibility

## Implementation Guidance

- Favor secure, explicit server authorization over convenience.
- Treat the admin surface as an operations tool, not a marketing dashboard.
- If there is a tradeoff between richer admin power and safer read-only observability, choose safer observability.
- Reuse the existing house ledger, wallet ledger, replay, and match data rather than inventing parallel stores.
- Be explicit in the Execution Report about how admin identity is provisioned, how access is enforced, and which data is read-only versus mutable.
- For the two player-facing options, favor simple, low-risk preference controls over a broader settings-system rewrite.

## Acceptance Criteria

This task is complete only if all of the following are true:

- admin access is server-enforced and non-admin access is rejected
- an authorized admin can view rake revenue summaries and recent house ledger entries
- an authorized admin can inspect recent staked match settlement context
- admin-facing wallet or player inspection, if added, is useful and safely scoped
- players can optionally show or hide deadwood count in the UI
- players can optionally enable or disable a four-color deck in the UI
- existing competitive-platform and economy behavior still works
- automated tests for admin access and revenue/ops visibility exist and pass alongside existing tests
- a comprehensive `EXECUTION_REPORT_10.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the first secure admin revenue and operations dashboard next. After that, the strongest follow-on options will be tournament mode, richer transcript-based analysis depth, or infrastructure hardening for production-scale deployment.
