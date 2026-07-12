# Claude Directive 82: Durable Write Path, Outbox Workers, and Honest Storage Evolution for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_82.md`.
3. You must also emit an updated project status report and save it to the workspace root as `PROJECT_STATUS.md`.
4. The execution report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
5. The updated `PROJECT_STATUS.md` must reflect the true current state of the product and must not overclaim completed storage scale or production readiness.
6. The task is not complete until the code, verification, `EXECUTION_REPORT_82.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

Directive 81 improved the realtime architecture honestly:

- Gin Paradise now has a `RealtimeCoordinator` boundary instead of relying directly on scattered in-process Maps for room, player, and spectator coordination
- the default in-memory mode still works
- Redis-backed coordination is scaffolded and contract-tested, but not yet wired to live Redis I/O

That was the right first move.

But the next bottleneck is now the write path, not the room registry.

The product already has many persistence-heavy systems sharing one SQLite database and one Node process:

- users and sessions
- wallets, transactions, billing sessions, and offer purchases
- tournaments and brackets
- replays and transcript persistence
- replay evaluation cache and coaching cache
- broadcast metrics, seasonal standings, and other derived analytics

In addition, some secondary work is still coupled too closely to hot paths:

- replay persistence can trigger downstream evaluation work
- coaching / analysis preparation depends on replay and evaluation data
- broadcast and feature analytics continue to accumulate alongside gameplay and economy writes

The result is not yet dishonest, but it is still too coupled.

The system now needs a clear rule:

> money, match outcome, and core competitive state must be written synchronously and transactionally

while:

> derived, retryable, eventually-consistent side effects must move onto a durable background lane

This sprint is about building that durable background lane, tightening transactional boundaries, and making the storage story more honest.

## Your Next Task

Build the Durable Write Path, Outbox Workers, and Honest Storage Evolution sprint for Gin Paradise.

## Primary Objective

Reduce write-path contention and failure coupling without pretending the product has already outgrown SQLite.

This sprint should make the single-node architecture materially safer by:

- classifying critical versus derived writes
- moving retryable secondary work out of request/gameplay hot paths
- keeping economy and competitive correctness transactional
- creating a real storage-evolution seam for future migration work

The goal is not “replace SQLite everywhere.”

The goal is:

> keep authoritative writes simple and correct, and stop forcing every non-critical side effect to compete for the same immediate write path

## Required Scope

### 1. Establish an Explicit Write-Path Policy

Create a clear code-level distinction between:

- **authoritative synchronous writes**
- **derived asynchronous writes**

At minimum, the code and report must make this distinction explicit for these areas:

- wallet / ledger mutations
- billing and paid-offer fulfillment
- replay / transcript finalization
- tournament advancement and payout-critical state
- post-game evaluation / coaching / analytics follow-up work

The rule should be:

- money, entitlement, stake, settlement, and official match outcome writes remain synchronous and transactional
- retryable derived work moves behind a durable queue or outbox

Do not leave this as a conceptual note only.

There must be a real implementation boundary in code.

### 2. Introduce a Durable DB-Backed Outbox / Job Queue

Add a persistent outbox or job table suitable for single-node durability.

At minimum it must support:

- job type
- payload
- status
- attempt count
- created / available / processed timestamps
- failure recording
- idempotency or deduplication support where appropriate

The queue must be durable across process restarts.

Do not use only in-memory timers, local arrays, or fire-and-forget promises as the “solution.”

This outbox is the new lane for secondary work.

### 3. Move At Least Two Real Secondary Flows Off The Hot Path

Use the new durable outbox to move actual repo-backed secondary work out of direct gameplay or request completion.

At minimum, one of the migrated flows must be:

- replay auto-evaluation or replay follow-up processing currently triggered from transcript completion

And at least one additional real secondary path must be moved as well, such as:

- coaching cache preparation
- replay-analysis warmup
- broadcast metric finalisation
- non-critical analytics or derived leaderboard / enrichment work

Choose the highest-value second candidate based on repo evidence.

The important point is:

- the queue must be used for real product work, not only a toy example

### 4. Tighten Transactional Boundaries For Authoritative Writes

Review and harden the highest-risk write paths so critical product truth stays atomic.

At minimum, validate and improve as needed for:

- ledger / billing / offer-purchase fulfillment paths
- replay finalization and outcome persistence
- tournament or match-settlement state transitions if touched by related flows

Required behavior:

- authoritative writes must be explicitly transactional
- duplicate processing must be safely handled
- background follow-up must not be able to corrupt or double-apply core product truth

Do not push money or official match outcome writes into eventual consistency just to lower contention.

### 5. Add Worker Execution, Visibility, and Failure Handling

Implement a real worker loop or worker service for the outbox.

At minimum:

- jobs can be claimed safely
- failed jobs are recorded and retryable
- poison jobs do not silently spin forever
- health / diagnostics expose enough signal to understand backlog and failures

If you keep the worker inside the same Node process for now, that is acceptable.

But:

- it must still be a real worker model
- it must be startable / stoppable / diagnosable
- the report must clearly describe what is proven in-process versus what would change in a future multi-process deployment

### 6. Harden SQLite Operation Honestly

Improve the SQLite write path where it is responsible to do so.

Appropriate areas include:

- busy-timeout behavior
- WAL / checkpoint considerations
- foreign-key enforcement if missing
- explicit retry or conflict handling where truly needed
- better startup logging around storage mode and worker mode

Do not cargo-cult “database tuning.”

Only add hardening that is justified by the repo’s current architecture and this sprint’s goals.

### 7. Improve Deployment Honesty and Operator Diagnostics

Update docs and runtime visibility so an operator can tell:

- which writes are synchronous versus queued
- whether the outbox worker is running
- whether there is backlog or job failure accumulation
- what SQLite still does and does not support

This must include:

- deployment documentation updates
- health endpoint and/or admin/debug visibility improvements
- a plain statement of what is truly supported in single-node mode

Do not imply the platform is now horizontally write-scalable unless you actually prove it.

### 8. Testing and Verification

Add automated coverage for the new storage behavior.

At minimum, cover:

- outbox enqueue / claim / complete / fail behavior
- idempotent or duplicate-safe processing
- one migrated replay-related background flow
- one additional migrated secondary flow
- regression coverage showing authoritative writes still complete correctly
- startup/config/health behavior for the worker path

Manual verification is encouraged if the environment allows it.

## Non-Goals for This Pass

- Do not do a full PostgreSQL migration yet
- Do not move all writes into background jobs
- Do not weaken wallet, billing, escrow, or settlement correctness
- Do not build a giant distributed event platform
- Do not claim multi-node write scaling
- Do not use Redis as a substitute for a durable system-of-record database in this sprint

This sprint is about write discipline and durability, not infrastructure theater.

## Implementation Guidance

- Prefer a small, explicit outbox over a vague async abstraction.
- Keep authoritative transactions narrow and obvious.
- Treat replay/eval/coaching follow-up as prime candidates for eventual consistency.
- Favor idempotent job handlers.
- Make worker diagnostics readable by humans.
- If a candidate secondary flow is too tightly coupled to move cleanly, say so and choose the next highest-value one.
- Be honest in the report about what is reduced, what is eliminated, and what contention still remains.

If scope must be narrowed, prioritize in this order:

1. durable outbox implementation
2. moving replay auto-follow-up off the hot path
3. moving one additional real secondary flow
4. transactional hardening of authoritative writes
5. diagnostics and polish

## Acceptance Criteria

This task is complete only if all of the following are true:

- the codebase has a real durable outbox / job mechanism, not just in-memory async work
- at least two genuine secondary flows now run through that mechanism
- authoritative economy / match-truth writes remain synchronous and transactionally safe
- duplicate or retry scenarios are handled safely
- health/docs/operator visibility truthfully describe worker and storage behavior
- automated tests cover the new queue and migrated flows
- a comprehensive `EXECUTION_REPORT_82.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and does not overstate storage maturity

## Deliverable Expectation

Complete the durable write-path and outbox sprint next.

After that, the strongest follow-on directive will likely be one of these, depending on the findings:

- wire the Redis coordinator to real I/O and move shared queue / timer ownership toward distributed coordination
- or begin a targeted primary-database migration for the highest-value authoritative domains

This sprint should give us the evidence to choose that next step honestly.
