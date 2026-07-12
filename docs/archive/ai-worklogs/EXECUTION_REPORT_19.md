# Execution Report 19: Trust Shield Productization & Client-Seed Hardening Sprint

**Date:** March 12, 2026  
**Directive:** `CLAUDE_DIRECTIVE_19.md`  
**Sprint:** Trust Shield Productization and Client-Seed Hardening  
**Result:** ✅ All acceptance criteria met. All 447 tests passing (18 test files).

---

## Objective

Turn the existing server-side fairness architecture into a **visible, usable, defense-in-depth trust feature** by adding:

1. A replay-facing proof inspector
2. One-click proof download/export
3. Client-seed contribution (v2 algorithm)
4. Updated Fairness/Trust Shield explanation page
5. API and persistence alignment for v1 + v2 proofs
6. Comprehensive automated test coverage

---

## Current Context (Pre-Sprint)

- **Trust Shield v1** complete: commit-reveal shuffles, server-seed-only, proof packages persisted to SQLite
- **32 fairness tests** passing, 432 total tests
- No user-facing proof inspector in the replay experience
- No proof download capability
- Client-seed contribution explicitly deferred to a future sprint

---

## Actions Taken (Chronological)

### 1. Client-Seed Contribution (v2 Algorithm)

**File:** `server/multiplayer/fairness.ts`

- **Algorithm version bumped to v2** (`FAIRNESS_ALGORITHM_VERSION = 2`), with `FAIRNESS_ALGORITHM_VERSION_V1 = 1` preserved
- **New `combineSeeds()` function**: `HMAC-SHA256(serverSeed, clientSeed1 + ":" + clientSeed2)` — deterministic, neither party alone can predict the result
- **`submitClientSeed()` function**: accepts per-round client seeds from players, returns combined seed + deck once both are present
- **`getClientSeeds()` function**: retrieves submitted seeds for a round
- **`revealRoundSeed()` updated**: detects whether client seeds were contributed, uses combined seed for v2 or falls back to server-seed-only for v1
- **`FairnessReveal` extended**: new optional `clientSeeds` and `combinedSeed` fields
- **`FairnessProofPackage` extended**: new `algorithmVersion` field
- **`verifyProofPackage()` updated**: validates combined seed derivation for v2, reports `clientSeedValid` result
- **`buildProofPackage()` updated**: determines shuffle seed based on algorithm version
- **`MatchFairnessState` extended**: stores per-round client seeds and player ID ordering
- **`initMatchFairness()` updated**: accepts optional `playerIds` for v2 ordering
- **Backward compatibility**: if no client seeds are submitted, the round uses v1 (server-seed-only) — existing matches are unaffected

### 2. WebSocket Protocol Extension

**Files:** `server/multiplayer/types.ts`, `server/multiplayer/roomManager.ts`

- Added `submit_client_seed` client message type (`{ type: "submit_client_seed"; seed: string }`)
- Added `client_seed_accepted` server message type (`{ type: "client_seed_accepted"; roundNumber: number }`)
- Added case handler in `roomManager.ts` message loop: validates seed (max 64 chars, non-empty), submits for current round, sends acknowledgement
- Player IDs now passed to `initMatchFairness()` at match start for v2 ordering

### 3. Replay-Facing Proof Inspector

**File:** `src/pages/Replays.tsx`

- **New fairness types**: `FairnessCommitment`, `FairnessReveal`, `FairnessProofVerified`, `FairnessData` interfaces added
- **New state management**: `fairnessData`, `loadingFairness`, `fairnessError`, `expandedProofs`, `copiedField`
- **Auto-fetch on replay open**: fairness data is automatically loaded when a replay is opened
- **Trust Shield button**: cyan-themed button in replay header, toggles expansion of all proof cards
- **Trust Shield panel**: renders between match summary and Engine Evaluation panel, featuring:
  - Panel header with algorithm version badge and "Client Seeds" badge (when present)
  - **Download Proof** button for one-click JSON export
  - Summary line: "X rounds verified — All proofs valid" with checkmark
  - **Per-round expandable proof cards** showing:
    - Verification status indicator (green checkmark or red exclamation)
    - Round number, algorithm version, client seeds indicator
    - Verified/Failed badge
  - **Expanded proof details** (collapsible per round):
    - Verification detail lines (from server-side verification)
    - Commitment hash with copy button
    - Server seed with copy button
    - Client seeds (v2 only) — styled in purple with player 1/player 2 labels
    - Combined seed (v2 only) — purple styled
    - Nonce, Algorithm version, Deck hash in a 3-column grid
    - Committed At / Revealed At timestamps
    - "Copy verification payload" button — copies the full JSON for independent verification
  - **"How verification works" explainer** — plain English description of commit-reveal + client seed contribution

### 4. Proof Download and Export

**File:** `server/routes/fairness.ts`

- Added `GET /api/replays/:id/fairness/download` — authenticated, participant-only endpoint
- Returns a JSON file with `Content-Disposition: attachment` header for browser download
- Download payload includes: `replayId`, `matchId`, `players`, `matchDate`, `proofPackages[]`, `verificationInstructions`
- Each proof package is verification-ready (matches what `/api/fairness/verify` expects)
- Verification instructions include step-by-step guidance and the API endpoint
- **Frontend**: `downloadProof()` callback fetches blob and triggers browser download as `fairness-proof-{id}.json`
- **Copy-to-clipboard**: any proof field or the full verification payload can be copied

### 5. API and Persistence Alignment

**File:** `server/routes/fairness.ts`

- `GET /api/replays/:id/fairness` — updated to detect algorithm version, run self-verification, and report `hasClientSeeds` per proof
- `POST /api/fairness/verify` — updated for v2 verification:
  - Detects algorithm version from proof package
  - Validates combined seed derivation against `HMAC-SHA256(serverSeed, c1 + ":" + c2)` for v2
  - Returns `clientSeedValid` in response
  - Shows reproduced deck cards for the first 21 positions (dealt cards + first discard)
- **v1 backward compatibility**: all v1 proof packages continue to verify correctly — tested explicitly

### 6. Fairness UX and Transparency Improvements

**File:** `src/pages/Fairness.tsx`

- Updated hero description to mention client-seed contribution
- Added **Step 2: Contribute** card (purple-themed) describing client seed HMAC-SHA256 combination
- Resequenced to 4 steps: Commit → Contribute → Play → Reveal & Verify
- Updated "What Remains Trust-Based" section: removed "server-side seed generation" (no longer trust-only), added "Client seed opt-in" explanation
- Updated Technical Details:
  - Algorithm version: v2 (client-seed contribution)
  - Added Seed Combination: HMAC-SHA256(serverSeed, c1 + ":" + c2)
  - Added Backward Compatible: Yes (v1 proofs still verifiable)
- Updated verification pseudocode to include combined seed step

### 7. Testing

**File:** `tests/fairness.test.ts` — rewritten with comprehensive v2 coverage

New/updated test blocks:

| Test Block | Count | Coverage |
|---|---|---|
| Cryptographic Core | 5 | Seed generation, commitment hashing |
| Deterministic Shuffle | 5 | Deck production, determinism, hashing |
| Card Index Mapping | 3 | Index-to-card round-tripping |
| **Seed Combination (v2)** | **5** | **combineSeeds determinism, order sensitivity, shuffle divergence** |
| Lifecycle | 7 | Commitment-before-reveal, multi-round, serializable data |
| **Client-Seed Contribution (v2)** | **8** | **Submission, retrieval, reveal with combined seed, proof building, verification, v1 fallback, mixed v1/v2 rounds** |
| Tamper Detection | **7** | Altered seed, nonce, deck hash, deck order, commitment, **tampered client seed, tampered combined seed** |
| API Integration | **7** | **v1 verify, v2 verify**, tampered proof, malformed input, regressions |

**Total: 47 fairness tests** (up from 32)  
**Total project: 447 tests passing** (up from 432)  
**All 18 test files pass.**

---

## Files Modified

| File | Action | Description |
|---|---|---|
| `server/multiplayer/fairness.ts` | Modified | v2 algorithm, combineSeeds, submitClientSeed, getClientSeeds, updated verify/build |
| `server/multiplayer/roomManager.ts` | Modified | submit_client_seed handler, playerIds to initMatchFairness |
| `server/multiplayer/types.ts` | Modified | submit_client_seed, client_seed_accepted message types |
| `server/routes/fairness.ts` | Rewritten | v2 proof retrieval, proof download endpoint, v2 verification |
| `src/pages/Replays.tsx` | Modified | Proof inspector panel, download button, copy-to-clipboard, fairness state |
| `src/pages/Fairness.tsx` | Modified | v2 flow, client seed explanation, updated technical details |
| `tests/fairness.test.ts` | Rewritten | 47 tests covering v1+v2 lifecycle, tamper detection, APIs |
| `PROJECT_STATUS.md` | Modified | Sprint status update, test count update |

---

## Seed-Combination Scheme

```
Server: serverSeed = crypto.randomBytes(32).hex()
commitment = SHA-256(serverSeed + ":" + nonce)

Client 1: clientSeed1 = any string up to 64 chars
Client 2: clientSeed2 = any string up to 64 chars

Combined: combinedSeed = HMAC-SHA256(serverSeed, clientSeed1 + ":" + clientSeed2)
Shuffle:  deck = Fisher-Yates(HMAC-SHA256 stream from (combinedSeed, nonce))
```

**Why HMAC-SHA256?**
- Neither party can predict the combined seed without the other's input
- Deterministic: given all three inputs, anyone can reproduce the exact shuffle
- The server commitment (SHA-256 of server seed) is published BEFORE client seeds are known — proving the server didn't choose its seed based on client input
- Client seeds are combined symmetrically per player ID ordering (player1, player2) to ensure deterministic ordering

---

## Backward Compatibility

- Rounds without client seeds automatically use **v1** (server-seed-only), with `algorithmVersion: 1` in the reveal
- Rounds with both client seeds use **v2** (combined seed), with `algorithmVersion: 2`
- A single match can have mixed v1 and v2 rounds (explicitly tested)
- All existing v1 proof packages continue to verify correctly
- The verify endpoint auto-detects algorithm version from the proof package

---

## What Verification Can Now Be Done Entirely From Replay-Visible Artifacts

1. **In-app**: Open any completed replay → Trust Shield panel shows per-round verification results
2. **Download**: Click "Download Proof" → save JSON file containing all proof packages
3. **Independent verify**: Submit any proof package to `POST /api/fairness/verify` (no auth required)
4. **Manual verify**: Re-derive SHA-256(serverSeed + ":" + nonce) locally and compare to the published commitment hash
5. **v2 verify**: Re-derive HMAC-SHA256(serverSeed, c1 + ":" + c2) and confirm it matches the combined seed, then reproduce the shuffle

---

## Usability Tradeoffs Made

1. **Client seeds are opt-in**: The WebSocket protocol supports `submit_client_seed` but the frontend doesn't auto-send seeds yet. This is by design — it allows gradual rollout and avoids blocking gameplay if a client is on an older version. Rounds without client seeds gracefully fall back to v1.

2. **Proof panel auto-loads but starts collapsed**: Fairness data loads automatically when opening a replay, but individual round proofs require a click to expand. This avoids overwhelming non-technical players while keeping the data one click away for those who want it.

3. **Copy vs. download**: Both options are provided. Copy-to-clipboard is faster for quick verification; download gives a permanent artifact with verification instructions included.

---

## Unresolved Issues / Risks

1. **Frontend client-seed auto-submission**: The WS protocol and backend fully support client seeds, but the frontend game board doesn't auto-submit a random seed at game start yet. This is a follow-on task — adding `ws.send({ type: "submit_client_seed", seed: crypto.randomUUID() })` on game start.

2. **Pre-existing TypeScript error**: `tests/multiplayer.test.ts` has a pre-existing TS type error (`Property 'error' does not exist on type...`) that is unrelated to this sprint. All tests pass at runtime regardless.

---

## Recommended Next Steps

1. **Auto-submit client seeds on game start** — A small frontend change to automatically generate and send a random client seed when a match begins, making v2 the default without any user action
2. **Evaluation-cache persistence** — Persist engine evaluation results to SQLite for faster replay review
3. **Training dashboard depth** — Add session-over-session improvement tracking
4. **Cosmetic/prestige systems** — Player profiles, avatars, achievements
5. **Infrastructure scale-out** — PostgreSQL migration when live usage justifies it

---

## Test Verification

```
 Test Files  18 passed (18)
 Tests       447 passed (447)
 Duration    ~34s
```

All fairness-specific tests: **47 passed**  
Full regression suite: **447 passed across 18 files**  
No regressions introduced.
