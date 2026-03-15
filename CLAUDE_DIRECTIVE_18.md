# Claude Directive 18: Trust Shield and Provably Fair Architecture Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_18.md`.
3. The report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
4. If the task materially changes project scope or status, update `PROJECT_STATUS.md` in the workspace root as part of the same task.
5. The task is not complete until the code, verification, `EXECUTION_REPORT_18.md`, and any needed `PROJECT_STATUS.md` updates are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a polished competitive heads-up platform with scheduled tournaments
- first-class replay evaluation and a dedicated Training surface
- honestly green verification with `400/400` tests passing
- strong replay, transcript, and audit foundations already in place

However, the biggest remaining trust gap is fairness transparency:

1. The live multiplayer system is still effectively an opaque server shuffle from the user’s point of view.
2. The current multiplayer engine still contains non-cryptographic shuffle logic in the live path.
3. Players cannot independently verify that a specific hand’s deck order was locked before dealing and revealed honestly afterward.
4. The product does not yet expose a clear public trust story that serious competitive players can inspect.

## Your Next Task

Build the Trust Shield and Provably Fair Architecture sprint for Gin Paradise.

## Primary Objective

Make every live Gin Paradise hand cryptographically auditable and user-verifiable without destabilizing the existing server-authoritative gameplay model.

## Required Scope

### 1. Cryptographic Shuffle and Commitment Lifecycle

- Replace any non-cryptographic randomness in the live multiplayer hand-shuffle path with a cryptographically secure approach.
- Introduce a per-hand server seed and a pre-deal commitment hash so the platform is committed to a shuffle source before cards are dealt.
- Derive the shuffle deterministically from explicit inputs rather than opaque ad hoc randomness.
- Version the fairness algorithm so future verifier logic can remain backward-compatible.
- If cleanly feasible without destabilizing live play, incorporate a client seed contribution as part of the final shuffle derivation.
- If client-seed participation is too invasive for this pass, still ship a strong server-seed commit/reveal model and document the limitation honestly.

### 2. Reveal and Proof Package

- After a hand is complete, reveal the seed material, nonce, and algorithm version needed to verify that hand’s shuffle.
- Persist the fairness metadata alongside the replay / transcript record in durable storage.
- Add a downloadable or otherwise inspectable proof package for a completed hand or match.
- At minimum, the proof artifact should include:
  - hand or round identifier
  - match identifier
  - commitment hash
  - revealed seed material needed for verification
  - nonce / counter
  - fairness algorithm version
  - deck hash and/or deterministic deck derivation data
  - transcript hash or proof linkage
  - relevant timestamps
- Ensure the reveal flow never leaks hidden-card information before the hand is over.

### 3. User-Verifiable Fairness Path

- Add a real verifier path rather than only storing proof data internally.
- A participant should be able to verify, from product-accessible data, that:
  - the pre-deal commitment matches the revealed seed
  - the revealed inputs reproduce the same deck order
  - the stored proof data matches the completed hand
- This can be an in-app verifier, a replay-detail verifier panel, or a supported verification utility exposed through the product in a credible way.
- Favor something an actual serious player can use, not just an internal developer helper.

### 4. Transcript and Audit Hardening

- Tie the fairness proof cleanly to the existing transcript / replay system.
- Add proof hashes or equivalent linkage so the shuffle proof and action log are connected rather than living as unrelated artifacts.
- Preserve fairness metadata through replay history and replay detail retrieval.
- Ensure scheduled tournaments and standard heads-up matches both produce fairness proof data through the same underlying mechanism where applicable.

### 5. Fairness UX and Documentation

- Add a user-facing Fairness / Provably Fair explanation surface.
- Explain the system in plain English:
  - the server commits before the hand starts
  - the reveal happens after the hand ends
  - players can independently verify the shuffle
  - blockchain is not required for this trust model
- Be explicit about what users can verify and what still remains trust-based.
- Link this trust explanation naturally from the replay or training ecosystem if that is the best fit.

### 6. Testing and Verification

Add automated coverage for the trust-shield pass. At minimum, cover:

- deterministic shuffle reproduction from proof inputs
- commitment mismatch / tamper detection
- failure on altered nonce, altered seed, or altered deck hash
- persistence and retrieval of fairness metadata through replay APIs
- commitment-before-reveal lifecycle behavior
- regression coverage confirming multiplayer, tournaments, replays, training, wallet, and admin flows still work

Also perform manual verification if the environment allows it, ideally by generating a real proof package and confirming it can be re-verified end to end.

## Non-Goals for This Pass

- No blockchain integration in this sprint
- No external paid fairness audit in this sprint
- No PostgreSQL/Redis migration in this sprint
- No business-model or currency pivot in this sprint
- No anti-collusion or fraud-detection expansion beyond what is directly needed for fairness proofing
- No replacement of the server-authoritative gameplay model with client-authoritative logic

## Implementation Guidance

- This is a real trust and audit sprint, not a marketing-copy sprint.
- Prioritize actual cryptographic commitment, proof persistence, and reproducibility over cosmetic “fair play” labels.
- If scope must be narrowed, prioritize in this order:
  1. cryptographic shuffle + pre-deal commitment
  2. post-hand reveal + persisted proof package
  3. user-verifiable replay/fairness verification path
  4. fairness documentation surface
- Reuse the existing replay, transcript, and scheduled-tournament architecture instead of inventing a parallel proof system.
- Keep the report explicit about:
  - which randomness source is used
  - how the commitment is generated
  - what exact inputs define the deterministic shuffle
  - what users can independently verify
  - what limitations remain after this pass

## Acceptance Criteria

This task is complete only if all of the following are true:

- live hand shuffles no longer depend on non-cryptographic randomness in the production multiplayer path
- Gin Paradise commits to hand randomness before cards are dealt
- completed hands expose persisted proof data that can be used to verify the shuffle afterward
- participants can verify the commitment and reproduced shuffle from product-accessible data
- replay/transcript surfaces carry the fairness proof linkage cleanly
- Gin Paradise has a clear user-facing fairness explanation surface
- automated tests for the new trust-shield layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_18.md` is saved to the workspace root
- `PROJECT_STATUS.md` is updated if the project status meaningfully changes

## Deliverable Expectation

Complete the first serious trust-shield / provably-fair pass next. After that, the strongest follow-on options will likely be evaluation-cache persistence, richer Training product depth, cosmetics/prestige layers, or later infrastructure scale-out once live usage justifies it.
