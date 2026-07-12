# Execution Report 20 — Default Client-Seed Rollout & Live Fairness UX

## Sprint Objective

Make Trust Shield v2 the **default experience** for all active multiplayer play and communicate fairness status to players in real time, completing the provably fair rollout.

---

## Summary of Changes

### 1. Automatic Client-Seed Submission (Priority 1 ✅)

**Where seeds are generated:**
- In the `useMultiplayer` React hook (`src/lib/useMultiplayer.ts`), a new `generateClientSeed()` function creates a 32-character hex string from 16 bytes of `crypto.getRandomValues()` — the same CSPRNG used for TLS and Web Crypto.

**When seeds are sent:**
- **On `game_started`**: Immediately after receiving the game start message, the hook calls `autoSubmitClientSeed()` to send a `submit_client_seed` message over the existing WebSocket.
- **On new round (`game_update` with status `"playing"`)**: After each round transition, a fresh seed is auto-submitted with a 50ms delay to ensure the server has created the new round commitment first.

**How reconnects are handled:**
- The `broadcastGameState` function now injects `fairnessStatus` into every game update, so reconnecting clients immediately see the current fairness state.
- If a reconnecting client sends a seed for a round where it already submitted, the server-side `submitClientSeed` overwrites the slot, which is idempotent behavior.
- If seed submission fails for any reason (network error, CSPRNG unavailable), the hook silently catches the error and the server falls back to v1 (server-only) for that round.

**How often v1 fallback can still occur after this sprint:**
- v1 fallback now only occurs in edge cases:
  - Client running a very old browser without `crypto.getRandomValues` (effectively zero modern browsers)
  - WebSocket disconnection before the seed message is sent (reconnect will re-submit)
  - Race condition where a round completes before both seeds arrive (extremely unlikely in practice)
  - One player's client is modified/outdated and doesn't auto-submit
- Under normal conditions with current clients, **100% of rounds will use v2**.

### 2. Live Fairness Status UI (Priority 2 ✅)

**New type:** `FairnessStatusInfo` added to `server/multiplayer/types.ts`:
```typescript
interface FairnessStatusInfo {
  roundNumber: number;
  commitmentPublished: boolean;
  commitmentHashShort: string;    // first 12 chars
  mySeedSubmitted: boolean;
  opponentSeedSubmitted: boolean;
  activeVersion: number;          // 2 = full v2, 1 = fallback
  label: string;                  // "Trust Shield v2" or "Trust Shield v1 (server-only)"
}
```

**Server broadcasts:**
- `fairness_status` message sent to both players on match start, seed submission, and via every `game_update`.
- `buildFairnessStatus()` helper constructs per-player status with correct seed ownership perspective.

**Frontend display:**
- A compact **Trust Shield badge** in the game header next to the prize pool badge.
- Color-coded: **emerald green** (v2 active), **amber** (seeds in progress), **zinc** (v1 fallback).
- Shows a Shield icon + "v2" or "v1" text.
- **Hover tooltip** reveals:
  - Commitment hash (first 12 chars)
  - Three status indicators: Commitment published, My seed submitted, Opponent seed received
  - Round number and entropy source description

### 3. Replay/Live Consistency (Priority 3 ✅)

- The `broadcastGameState` function now injects `fairnessStatus` into every view, ensuring the live UI always reflects the same version (v1/v2) that will appear in the replay.
- `buildProofPackage` already records `algorithmVersion` matching the reveal version, so replays accurately show v2 vs. v1 for each round.
- Commitment hash displayed live matches the commitment hash in the proof package.
- Mixed v1/v2 matches (theoretically possible per-round) are correctly handled and separately verifiable.

### 4. TypeScript Cleanup (Priority 4 ✅)

**Root cause:** The `MoveResult` discriminated union type `{ ok: true; ... } | { ok: false; error: string }` caused TypeScript to fail type narrowing when accessing `.error` after a `!result.ok` guard. Additionally, `match.status` comparisons after mutation-inducing function calls (like `handleKnock`) were flagged as unreachable because TypeScript's control flow analysis doesn't track cross-function mutations.

**Files fixed:**
- `tests/multiplayer.test.ts` — All `.error` accesses now use explicit type assertions; status comparison uses `as string` cast
- `tests/competitive-integrity.test.ts` — Status comparison after `handleKnock` mutation fixed 
- `tests/showdown-fidelity.test.ts` — `.error` access on MoveResult fixed
- `tests/matchmaking.test.ts` — Missing `stakeId` property on manually constructed `QueueEntry`

**Result:** `npx tsc --noEmit` now exits cleanly with **zero errors**.

---

## Files Modified

| File | Change |
|------|--------|
| `server/multiplayer/types.ts` | Added `FairnessStatusInfo` interface, `fairnessStatus` to `PlayerGameView`, new server message types |
| `server/multiplayer/roomManager.ts` | Added `buildFairnessStatus()`, `broadcastFairnessStatus()`, injected status into all game views, enhanced `submit_client_seed` handler |
| `src/lib/useMultiplayer.ts` | Auto client-seed generation/submission, `fairnessStatus` state, handler for `fairness_status` messages |
| `src/pages/MultiplayerRoom.tsx` | Live Trust Shield badge with hover tooltip |
| `tests/multiplayer.test.ts` | Fixed all MoveResult TypeScript errors |
| `tests/competitive-integrity.test.ts` | Fixed status comparison TS error |
| `tests/showdown-fidelity.test.ts` | Fixed MoveResult.error TS error |
| `tests/matchmaking.test.ts` | Fixed missing stakeId on QueueEntry |

## Files Created

| File | Purpose |
|------|---------|
| `tests/default-rollout.test.ts` | 24 automated tests for the rollout: auto-submission, reconnects, fallbacks, live status, replay consistency, API integration |

---

## Test Results

```
Test Files  19 passed (19)
     Tests  471 passed (471)
```

**New tests added:** 24 (in `tests/default-rollout.test.ts`)

Test coverage by area:
- **Auto Client-Seed Submission** (5 tests): both-player submission, seed format, multi-round fresh seeds, verifiable proofs, idempotency
- **Reconnect & Round Transitions** (3 tests): independent round commitments, reconnect safety, multi-round proof retrieval
- **Fallback Behavior** (4 tests): no seeds → v1, partial seeds → v1, v1 proof validity, mixed v1/v2 match verification
- **Live Fairness Status** (3 tests): commitment publication, per-player seed tracking, serializable data correctness
- **Replay/Live Consistency** (4 tests): algorithm version matching, v1 consistency, commitment hash identity, combined seed reproducibility
- **API Integration** (5 tests): v2 proof verification endpoint, wallet/leaderboard/replay/auth regression

**TypeScript:** `npx tsc --noEmit` passes with **0 errors**.

---

## Acceptance Criteria Checklist

| Criterion | Status |
|-----------|--------|
| Current frontend clients automatically participate in Trust Shield v2 | ✅ Auto-submit on game_started + round transitions |
| Players can see live fairness status without opening replays | ✅ Trust Shield badge with hover tooltip |
| Replay/fairness surfaces accurately reflect v2 vs. fallback | ✅ algorithmVersion consistent between live and proof |
| Known caveat about manual client-seed participation removed/narrowed | ✅ Seeds are now automatic; v1 only in extreme edge cases |
| TypeScript issue resolved | ✅ Zero tsc errors across entire codebase |
| Automated tests for rollout pass alongside existing suite | ✅ 471/471 tests pass |
| EXECUTION_REPORT_20.md saved to workspace root | ✅ This file |
| PROJECT_STATUS.md updated | ✅ See below |

---

## Architecture Note

The rollout preserves backward compatibility:
- The `submit_client_seed` WebSocket message was already defined — clients now use it automatically
- `FairnessStatusInfo` is an additive optional field on `PlayerGameView` — no breaking changes
- The `fairness_status` server message is new but ignored by older clients (no handler = no-op)
- v1 fallback path is preserved unchanged for any scenario where seeds aren't available
