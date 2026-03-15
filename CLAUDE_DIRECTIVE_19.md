# Claude Directive 19: Trust Shield Productization and Client-Seed Hardening Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_19.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_19.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a completed cryptographic trust shield with commit-reveal fairness proofs
- replay-level fairness data persisted to SQLite and exposed through APIs
- a public Fairness / Trust Shield explanation page
- a fully green suite with `432/432` tests passing

However, the trust shield still has three meaningful product gaps:

1. The fairness proof is still more accessible to a technical user than to a normal competitive player.
2. There is no first-class proof inspector or one-click proof download flow inside the replay experience.
3. Trust Shield v1 still relies on server-seed-only commitment; client seed contribution was explicitly deferred.

## Your Next Task

Build the Trust Shield Productization and Client-Seed Hardening sprint for Gin Paradise.

## Primary Objective

Turn the current fairness architecture into a visible, usable, defense-in-depth trust feature by adding replay-facing proof verification UX, downloadable proof artifacts, and client-seed contribution where feasible.

## Required Scope

### 1. Replay-Facing Proof Inspector

- Add a real proof inspector to the replay experience rather than leaving verification mainly at the API/documentation layer.
- A participant viewing a replay should be able to inspect, at minimum:
  - commitment hash
  - algorithm version
  - nonce / round number
  - revealed seed data or verification-ready seed metadata
  - proof verification result
- Make the verification flow understandable to a serious but non-technical player.
- If there are multiple rounds, the inspector should clearly distinguish round-by-round proofs.

### 2. Proof Download and Export

- Add a one-click way for a participant to download the proof package as JSON from the replay surface.
- Ensure the downloaded package is exactly what the public verify flow expects, not a lossy summary.
- If useful, also provide a copyable verification payload or copy-to-clipboard action.
- Keep access control aligned with replay visibility rules.

### 3. Client-Seed Contribution (Defense in Depth)

- Add client-seed participation to the fairness model if it can be done without destabilizing live play.
- Prefer a clean deterministic combination scheme rather than an ad hoc mixture.
- The result should strengthen the claim that the final shuffle is not solely determined by hidden server state.
- Preserve the server-authoritative model and do not leak hidden-card information before the hand is complete.
- If protocol changes are needed in WebSocket messages or match setup flow, keep them minimal and explicit.
- Version the fairness algorithm appropriately if the derivation changes.

### 4. Fairness UX and Transparency Improvements

- Update the Fairness / Trust Shield page so it reflects the real v2 behavior after this sprint.
- Explain client seed contribution in plain English if implemented.
- Make it obvious how a player goes from:
  - finished replay
  - to proof details
  - to verification
- Keep the explanation honest about what is cryptographically provable and what still remains trust-based.

### 5. API and Persistence Alignment

- Ensure replay detail, fairness APIs, and any verification endpoints stay aligned with the new proof format.
- Preserve backward compatibility for v1 proof packages if practical, or handle versioned verification cleanly.
- Keep persisted proof data durable and replay-safe across existing match and tournament flows.

### 6. Testing and Verification

Add automated coverage for the productized trust-shield pass. At minimum, cover:

- replay fairness detail retrieval and access control
- proof download/export correctness
- local or server-side verification against downloaded proof packages
- client-seed contribution affecting deterministic shuffle outcomes
- versioned verification for old/new proof formats if applicable
- regression coverage confirming multiplayer, tournaments, training, wallet, admin, and replay flows still work

Also perform manual verification if the environment allows it, ideally by:

- completing a replay with fairness data
- downloading the proof package
- verifying it through the intended user-facing path

## Non-Goals for This Pass

- No blockchain integration
- No external audit procurement in this sprint
- No PostgreSQL/Redis migration in this sprint
- No business-model or currency redesign in this sprint
- No anti-collusion / fraud platform expansion beyond fairness-proof hardening

## Implementation Guidance

- This sprint should make the trust shield feel real to users, not just correct in backend code.
- Prioritize product-visible verification over adding obscure extra cryptographic complexity.
- If scope must be narrowed, prioritize in this order:
  1. replay proof inspector
  2. proof download/export
  3. client-seed contribution
  4. Fairness-page refinement
- Be explicit in the report about:
  - the final seed-combination scheme
  - how backward compatibility is handled
  - what verification can now be done entirely from replay-visible artifacts
  - what usability tradeoffs were made

## Acceptance Criteria

This task is complete only if all of the following are true:

- replay participants can inspect fairness proof details from the product UI
- replay participants can download or export a verification-ready proof artifact
- the verification flow works end to end from product-visible data
- client-seed contribution is implemented or its deferral is justified with concrete technical reasoning in the report
- the fairness explanation surface matches the actual implementation
- automated tests for the new trust-shield product layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_19.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the next trust-shield productization pass now. After that, the strongest follow-on options will likely be evaluation-cache persistence, deeper Training product depth, cosmetic/prestige systems, or later infrastructure scale-out once live usage justifies it.
