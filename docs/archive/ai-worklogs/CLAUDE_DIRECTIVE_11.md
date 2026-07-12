# Claude Directive 11: Public Beta Deployment Hardening Sprint for Gin Galaxy

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_11.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_11.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest `PROJECT_STATUS.md` and `EXECUTION_REPORT_10.md` show that Gin Galaxy now has:

- hardened auth, validation, and rate limiting
- server-authoritative multiplayer with rating-aware matchmaking, timers, transcripts, replays, escrow, and rake
- a secure admin dashboard for revenue, settlements, and player inspection
- player-facing preference controls for optional deadwood count and four-color deck
- 263 passing automated tests across the platform

At this point, the core competitive product is feature-rich enough for a serious public beta. The next major gap is not another gameplay subsystem. It is operational readiness: making the current single-node architecture safe, explicit, and easy to deploy online without relying on local-development assumptions.

This should be treated as a **single-node production-readiness sprint**, not a multi-node infrastructure migration. Do not jump to PostgreSQL/Redis in this pass. Make the current architecture deployable and supportable first.

## Your Next Task

Build the public-beta deployment hardening layer for Gin Galaxy.

Focus on making the existing app production-ready for a single always-on Node host with WebSocket support and persistent storage.

## Primary Objective

Turn the current local-successful build into a clearly deployable, operationally legible, public-beta-ready application without changing the core product architecture.

## Required Scope

### 1. Production Configuration Hardening

- Remove local-only assumptions from runtime startup where practical.
- Replace hard-coded operational values with explicit configuration where appropriate.
- At minimum, review and harden:
  - server port binding
  - host / origin assumptions
  - database file location or persistence assumptions
  - environment validation and startup error messaging
- Keep Gemini analysis optional. Missing `GEMINI_API_KEY` must remain a graceful non-fatal condition.

### 2. Correct Production Startup Path

- Ensure the project has a correct, honest production startup flow.
- Do not rely on a misleading or broken `start` command.
- Make sure the documented build/start path matches how the app should actually run online.
- Preserve the existing local development workflow.

### 3. Health and Readiness Visibility

- Add a minimal unauthenticated health surface suitable for deployment checks.
- At minimum, provide a basic way to verify:
  - server process is up
  - database is reachable
  - app is in a sane startup state
- Keep the health output safe and operational, not secret-bearing.

### 4. Proxy / Networking / WebSocket Hardening

- Make the app safer to run behind a normal hosted reverse proxy.
- Audit any IP-based or origin-sensitive behavior that may break when deployed behind a platform like Render, Railway, Fly, or a VPS reverse proxy.
- Harden WebSocket deployment assumptions explicitly.
- If proxy-aware IP handling or trust-proxy configuration is needed for correct rate limiting or logging, implement it carefully and document it.

### 5. Graceful Shutdown and Operational Safety

- Add sensible graceful-shutdown behavior where practical.
- Prefer clean server stop behavior over abrupt resource leakage.
- If there are recurring timers, intervals, or server resources that should be closed on shutdown, handle them deliberately.
- Do not turn this into a speculative high-availability rewrite.

### 6. Deployment Documentation

- Create or update a root-level deployment guide aimed at a technically basic operator.
- Explain, in plain English:
  - what service shape the app currently expects
  - that it should run as a single instance for now
  - that WebSockets are required
  - that persistent disk/storage is required for SQLite
  - which environment variables matter
  - that `GEMINI_API_KEY` is optional and only affects AI analysis
- Include a realistic deployment path for the current architecture rather than aspirational multi-service infrastructure.

### 7. Preference Parity Carry-Forward

- The latest execution report notes that the new deadwood-count and four-color-deck preferences may not yet be applied consistently in `MultiplayerRoom`.
- Close that parity gap in this pass if it still exists.
- The same player preferences should behave consistently in both single-player and multiplayer live play surfaces.
- Keep this scoped as a consistency fix, not a broader UI redesign.

### 8. Testing and Verification

Add automated coverage for the production-hardening layer where practical. At minimum, cover:

- health endpoint behavior
- any environment/config validation logic added
- any proxy-aware or trust-proxy behavior added, if reasonably testable
- any startup/runtime logic that was fragile before this pass and is now explicit
- any MultiplayerRoom preference-parity behavior fixed in this pass
- regression coverage confirming auth, matchmaking, escrow, rake, admin, replay, and analysis flows still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No PostgreSQL migration
- No Redis migration
- No tournament mode in this pass
- No new sweepstakes mechanics or payment rails
- No admin write tools unless strictly required for deployment
- No major gameplay redesign
- No attempt to make the app horizontally scalable in this sprint

## Implementation Guidance

- Optimize for the real next milestone: a trustworthy public beta running on one host.
- Prefer explicit configuration and honest documentation over clever magic.
- If a choice exists between "more infrastructure sophistication" and "clear single-node deployability," choose clear deployability.
- Keep the production story beginner-legible. A non-expert operator should be able to understand how to run it.
- Avoid inventing infrastructure that the current product does not yet need.
- Be explicit in the Execution Report about what host assumptions remain and what would still need to change before multi-instance or high-scale deployment.

## Acceptance Criteria

This task is complete only if all of the following are true:

- the app has an honest, working production startup path
- core operational configuration is explicit rather than hidden in local assumptions
- a basic health/readiness surface exists and is safe to expose
- deployment-sensitive proxy/WebSocket assumptions are hardened or clearly documented
- graceful shutdown behavior is improved where practical
- a root-level deployment guide exists or is meaningfully updated for a novice operator
- `GEMINI_API_KEY` remains optional and clearly documented as analysis-only
- player preferences for deadwood count and four-color deck behave consistently in multiplayer if that gap existed
- automated tests covering the new hardening work exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_11.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the single-node public-beta deployment hardening pass next. After that, the strongest follow-on options will be tournament mode, deeper productized analysis, or a more serious infrastructure migration path once real scale demands it.