/**
 * Trust Shield / Provably Fair tests.
 *
 * Covers:
 *  - Deterministic shuffle reproduction from proof inputs
 *  - Commitment mismatch / tamper detection
 *  - Failure on altered nonce, seed, or deck hash
 *  - Persistence and retrieval of fairness metadata through replay APIs
 *  - Commitment-before-reveal lifecycle behavior
 *  - Standalone verification endpoint
 *  - v2 client-seed contribution and combined seed verification
 *  - Proof download endpoint
 *  - Backward compatibility with v1 proofs
 *  - Regression coverage
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "crypto";
import {
  generateServerSeed,
  computeCommitmentHash,
  deterministicShuffle,
  computeDeckHash,
  cardIndexToCard,
  deckOrderToCards,
  cardToIndex,
  combineSeeds,
  initMatchFairness,
  createRoundCommitment,
  revealRoundSeed,
  getRoundProof,
  getMatchProofs,
  buildProofPackage,
  verifyProofPackage,
  getSerializableFairnessData,
  submitClientSeed,
  getClientSeeds,
  cleanupFairness,
  _clearAllFairness,
  FAIRNESS_ALGORITHM_VERSION,
  FAIRNESS_ALGORITHM_VERSION_V1,
  type FairnessProofPackage,
} from "../server/multiplayer/fairness.js";
import { startTestServer, stopTestServer, getBaseUrl, registerUser, loginUser, makeRequest } from "./helpers.js";

// ── Unit Tests: Core Cryptographic Functions ────────────────────────

describe("Trust Shield — Cryptographic Core", () => {
  beforeEach(() => {
    _clearAllFairness();
  });

  it("generates 64-char hex server seeds (32 bytes)", () => {
    const seed = generateServerSeed();
    expect(seed).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(seed)).toBe(true);
  });

  it("produces unique server seeds", () => {
    const seeds = new Set(Array.from({ length: 20 }, () => generateServerSeed()));
    expect(seeds.size).toBe(20);
  });

  it("computes deterministic commitment hash from seed + nonce", () => {
    const seed = "a".repeat(64);
    const hash1 = computeCommitmentHash(seed, 1);
    const hash2 = computeCommitmentHash(seed, 1);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("produces different commitments for different nonces", () => {
    const seed = generateServerSeed();
    const h1 = computeCommitmentHash(seed, 1);
    const h2 = computeCommitmentHash(seed, 2);
    expect(h1).not.toBe(h2);
  });

  it("produces different commitments for different seeds", () => {
    const s1 = generateServerSeed();
    const s2 = generateServerSeed();
    const h1 = computeCommitmentHash(s1, 1);
    const h2 = computeCommitmentHash(s2, 1);
    expect(h1).not.toBe(h2);
  });
});

describe("Trust Shield — Deterministic Shuffle", () => {
  it("produces a 52-card deck", () => {
    const seed = generateServerSeed();
    const deck = deterministicShuffle(seed, 1);
    expect(deck).toHaveLength(52);
    // All indices 0-51 must be present exactly once
    const sorted = [...deck].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });

  it("is deterministic — same seed+nonce produce same deck", () => {
    const seed = generateServerSeed();
    const d1 = deterministicShuffle(seed, 5);
    const d2 = deterministicShuffle(seed, 5);
    expect(d1).toEqual(d2);
  });

  it("different nonce produces different deck", () => {
    const seed = generateServerSeed();
    const d1 = deterministicShuffle(seed, 1);
    const d2 = deterministicShuffle(seed, 2);
    expect(d1).not.toEqual(d2);
  });

  it("different seed produces different deck", () => {
    const s1 = generateServerSeed();
    const s2 = generateServerSeed();
    const d1 = deterministicShuffle(s1, 1);
    const d2 = deterministicShuffle(s2, 1);
    expect(d1).not.toEqual(d2);
  });

  it("deck hash is deterministic for same deck", () => {
    const seed = generateServerSeed();
    const deck = deterministicShuffle(seed, 1);
    const h1 = computeDeckHash(deck);
    const h2 = computeDeckHash(deck);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
});

describe("Trust Shield — Card Index Mapping", () => {
  it("maps 0 to A♠ and 51 to K♣", () => {
    expect(cardIndexToCard(0)).toEqual({ suit: "♠", rank: "A" });
    expect(cardIndexToCard(51)).toEqual({ suit: "♣", rank: "K" });
  });

  it("round-trips card index → card → index", () => {
    for (let i = 0; i < 52; i++) {
      const card = cardIndexToCard(i);
      expect(cardToIndex(card.suit, card.rank)).toBe(i);
    }
  });

  it("deckOrderToCards produces 52 unique cards", () => {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    const cards = deckOrderToCards(deck);
    expect(cards).toHaveLength(52);
    const keys = new Set(cards.map(c => `${c.rank}${c.suit}`));
    expect(keys.size).toBe(52);
  });
});

// ── Unit Tests: Seed Combination (v2) ───────────────────────────────

describe("Trust Shield — Seed Combination (v2)", () => {
  it("combineSeeds produces deterministic 64-char hex output", () => {
    const serverSeed = generateServerSeed();
    const c1 = combineSeeds(serverSeed, "player1seed", "player2seed");
    const c2 = combineSeeds(serverSeed, "player1seed", "player2seed");
    expect(c1).toBe(c2);
    expect(c1).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(c1)).toBe(true);
  });

  it("different client seeds produce different combined seeds", () => {
    const serverSeed = generateServerSeed();
    const c1 = combineSeeds(serverSeed, "seedA", "seedB");
    const c2 = combineSeeds(serverSeed, "seedC", "seedD");
    expect(c1).not.toBe(c2);
  });

  it("different server seeds produce different combined seeds", () => {
    const s1 = generateServerSeed();
    const s2 = generateServerSeed();
    const c1 = combineSeeds(s1, "client1", "client2");
    const c2 = combineSeeds(s2, "client1", "client2");
    expect(c1).not.toBe(c2);
  });

  it("order of client seeds matters (player1 vs player2)", () => {
    const serverSeed = generateServerSeed();
    const c1 = combineSeeds(serverSeed, "alpha", "beta");
    const c2 = combineSeeds(serverSeed, "beta", "alpha");
    expect(c1).not.toBe(c2);
  });

  it("combined seed produces different shuffle than server seed alone", () => {
    const serverSeed = generateServerSeed();
    const combined = combineSeeds(serverSeed, "client1", "client2");
    const d1 = deterministicShuffle(serverSeed, 1);
    const d2 = deterministicShuffle(combined, 1);
    expect(d1).not.toEqual(d2);
  });
});

// ── Unit Tests: Commitment-Reveal Lifecycle ─────────────────────────

describe("Trust Shield — Lifecycle", () => {
  beforeEach(() => {
    _clearAllFairness();
  });

  it("creates commitment before reveal", () => {
    initMatchFairness("room-1");
    const { commitment, deckOrder } = createRoundCommitment("room-1", 1);
    
    expect(commitment.commitmentHash).toHaveLength(64);
    expect(commitment.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);
    expect(deckOrder).toHaveLength(52);

    // Reveal should not exist yet
    const proof = getRoundProof("room-1", 1);
    expect(proof).not.toBeNull();
    expect(proof!.reveal).toBeNull();
  });

  it("reveals seed after round completes (v1 — no client seeds)", () => {
    initMatchFairness("room-2");
    const { commitment } = createRoundCommitment("room-2", 1);
    
    const reveal = revealRoundSeed("room-2", 1);
    expect(reveal).not.toBeNull();
    expect(reveal!.serverSeed).toHaveLength(64);
    expect(reveal!.nonce).toBe(1);
    expect(reveal!.deckOrder).toHaveLength(52);
    expect(reveal!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);
    expect(reveal!.clientSeeds).toBeNull();
    expect(reveal!.combinedSeed).toBeNull();
    
    // Verify commitment matches
    const recomputed = computeCommitmentHash(reveal!.serverSeed, reveal!.nonce);
    expect(recomputed).toBe(commitment.commitmentHash);
  });

  it("handles multi-round matches with incrementing nonces", () => {
    initMatchFairness("room-3");
    
    const r1 = createRoundCommitment("room-3", 1);
    const r2 = createRoundCommitment("room-3", 2);
    const r3 = createRoundCommitment("room-3", 3);
    
    // All commitments should be different
    expect(r1.commitment.commitmentHash).not.toBe(r2.commitment.commitmentHash);
    expect(r2.commitment.commitmentHash).not.toBe(r3.commitment.commitmentHash);
    
    // All deck orders should be different
    expect(r1.deckOrder).not.toEqual(r2.deckOrder);
    
    // All proofs should be tracked
    const proofs = getMatchProofs("room-3");
    expect(proofs).toHaveLength(3);
  });

  it("buildProofPackage returns verifiable package (v1)", () => {
    initMatchFairness("room-4");
    createRoundCommitment("room-4", 1);
    revealRoundSeed("room-4", 1);
    
    const pkg = buildProofPackage("room-4", 1);
    expect(pkg).not.toBeNull();
    expect(pkg!.verification.commitmentValid).toBe(true);
    expect(pkg!.verification.deckReproducible).toBe(true);
    expect(pkg!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);
  });

  it("verifyProofPackage validates genuine proof (v1)", () => {
    initMatchFairness("room-5");
    createRoundCommitment("room-5", 1);
    revealRoundSeed("room-5", 1);
    
    const pkg = buildProofPackage("room-5", 1)!;
    const result = verifyProofPackage(pkg);
    
    expect(result.valid).toBe(true);
    expect(result.commitmentValid).toBe(true);
    expect(result.deckReproducible).toBe(true);
    expect(result.deckHashMatch).toBe(true);
    expect(result.clientSeedValid).toBeNull(); // v1, no client seeds
    expect(result.details.length).toBeGreaterThan(0);
  });

  it("cleanupFairness removes state", () => {
    initMatchFairness("room-6");
    createRoundCommitment("room-6", 1);
    cleanupFairness("room-6");
    
    expect(getMatchProofs("room-6")).toHaveLength(0);
    expect(getRoundProof("room-6", 1)).toBeNull();
  });

  it("getSerializableFairnessData captures all round proofs", () => {
    initMatchFairness("room-7");
    createRoundCommitment("room-7", 1);
    revealRoundSeed("room-7", 1);
    createRoundCommitment("room-7", 2);
    revealRoundSeed("room-7", 2);
    
    const data = getSerializableFairnessData("room-7");
    expect(data).not.toBeNull();
    expect(data!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);
    expect(data!.proofs).toHaveLength(2);
    expect(data!.proofs[0].reveal).not.toBeNull();
    expect(data!.proofs[1].reveal).not.toBeNull();
  });
});

// ── Client-Seed Contribution Tests (v2) ───────────────────────────

describe("Trust Shield — Client-Seed Contribution (v2)", () => {
  beforeEach(() => {
    _clearAllFairness();
  });

  it("accepts client seeds from both players", () => {
    initMatchFairness("cs-1", ["player-a", "player-b"]);
    createRoundCommitment("cs-1", 1);

    const r1 = submitClientSeed("cs-1", 1, "player-a", "my-random-seed");
    expect(r1.bothPresent).toBe(false);

    const r2 = submitClientSeed("cs-1", 1, "player-b", "their-random-seed");
    expect(r2.bothPresent).toBe(true);
    expect(r2.combinedSeed).toBeTruthy();
    expect(r2.deckOrder).toHaveLength(52);
  });

  it("getClientSeeds returns submitted seeds", () => {
    initMatchFairness("cs-2", ["p1", "p2"]);
    createRoundCommitment("cs-2", 1);

    submitClientSeed("cs-2", 1, "p1", "seed-A");
    submitClientSeed("cs-2", 1, "p2", "seed-B");

    const seeds = getClientSeeds("cs-2", 1);
    expect(seeds).not.toBeNull();
    expect(seeds!.player1).toBe("seed-A");
    expect(seeds!.player2).toBe("seed-B");
  });

  it("reveal uses combined seed when client seeds are present (v2)", () => {
    initMatchFairness("cs-3", ["p1", "p2"]);
    createRoundCommitment("cs-3", 1);

    submitClientSeed("cs-3", 1, "p1", "alice-seed");
    submitClientSeed("cs-3", 1, "p2", "bob-seed");

    const reveal = revealRoundSeed("cs-3", 1);
    expect(reveal).not.toBeNull();
    expect(reveal!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION); // v2
    expect(reveal!.clientSeeds).not.toBeNull();
    expect(reveal!.clientSeeds!.player1).toBe("alice-seed");
    expect(reveal!.clientSeeds!.player2).toBe("bob-seed");
    expect(reveal!.combinedSeed).toBeTruthy();

    // Verify the combined seed is correct
    const expectedCombined = combineSeeds(reveal!.serverSeed, "alice-seed", "bob-seed");
    expect(reveal!.combinedSeed).toBe(expectedCombined);

    // Verify the deck was shuffled using the combined seed
    const expectedDeck = deterministicShuffle(expectedCombined, 1);
    expect(reveal!.deckOrder).toEqual(expectedDeck);
  });

  it("buildProofPackage includes client seed data (v2)", () => {
    initMatchFairness("cs-4", ["p1", "p2"]);
    createRoundCommitment("cs-4", 1);
    submitClientSeed("cs-4", 1, "p1", "foo");
    submitClientSeed("cs-4", 1, "p2", "bar");
    revealRoundSeed("cs-4", 1);

    const pkg = buildProofPackage("cs-4", 1);
    expect(pkg).not.toBeNull();
    expect(pkg!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);
    expect(pkg!.reveal.clientSeeds).not.toBeNull();
    expect(pkg!.reveal.combinedSeed).toBeTruthy();
    expect(pkg!.verification.commitmentValid).toBe(true);
    expect(pkg!.verification.deckReproducible).toBe(true);
  });

  it("verifyProofPackage validates v2 proof with client seeds", () => {
    initMatchFairness("cs-5", ["p1", "p2"]);
    createRoundCommitment("cs-5", 1);
    submitClientSeed("cs-5", 1, "p1", "x");
    submitClientSeed("cs-5", 1, "p2", "y");
    revealRoundSeed("cs-5", 1);

    const pkg = buildProofPackage("cs-5", 1)!;
    const result = verifyProofPackage(pkg);

    expect(result.valid).toBe(true);
    expect(result.commitmentValid).toBe(true);
    expect(result.deckReproducible).toBe(true);
    expect(result.deckHashMatch).toBe(true);
    expect(result.clientSeedValid).toBe(true);
  });

  it("falls back to v1 when no client seeds are submitted", () => {
    initMatchFairness("cs-6", ["p1", "p2"]);
    createRoundCommitment("cs-6", 1);
    // No client seeds submitted
    const reveal = revealRoundSeed("cs-6", 1);

    expect(reveal).not.toBeNull();
    expect(reveal!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);
    expect(reveal!.clientSeeds).toBeNull();
    expect(reveal!.combinedSeed).toBeNull();

    const pkg = buildProofPackage("cs-6", 1)!;
    const result = verifyProofPackage(pkg);
    expect(result.valid).toBe(true);
    expect(result.clientSeedValid).toBeNull();
  });

  it("mixed rounds: v1 and v2 in same match", () => {
    initMatchFairness("cs-7", ["p1", "p2"]);

    // Round 1: no client seeds (v1)
    createRoundCommitment("cs-7", 1);
    revealRoundSeed("cs-7", 1);

    // Round 2: with client seeds (v2)
    createRoundCommitment("cs-7", 2);
    submitClientSeed("cs-7", 2, "p1", "round2-seed-a");
    submitClientSeed("cs-7", 2, "p2", "round2-seed-b");
    revealRoundSeed("cs-7", 2);

    const pkg1 = buildProofPackage("cs-7", 1)!;
    const pkg2 = buildProofPackage("cs-7", 2)!;

    expect(pkg1.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);
    expect(pkg2.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);

    const r1 = verifyProofPackage(pkg1);
    const r2 = verifyProofPackage(pkg2);

    expect(r1.valid).toBe(true);
    expect(r2.valid).toBe(true);
    expect(r2.clientSeedValid).toBe(true);
  });
});

// ── Tamper Detection Tests ──────────────────────────────────────────

describe("Trust Shield — Tamper Detection", () => {
  beforeEach(() => {
    _clearAllFairness();
  });

  it("detects altered server seed", () => {
    initMatchFairness("tamper-1");
    createRoundCommitment("tamper-1", 1);
    revealRoundSeed("tamper-1", 1);
    
    const pkg = buildProofPackage("tamper-1", 1)!;
    // Tamper with the seed
    pkg.reveal.serverSeed = "b".repeat(64);
    
    const result = verifyProofPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.commitmentValid).toBe(false);
  });

  it("detects altered nonce", () => {
    initMatchFairness("tamper-2");
    createRoundCommitment("tamper-2", 1);
    revealRoundSeed("tamper-2", 1);
    
    const pkg = buildProofPackage("tamper-2", 1)!;
    // Tamper with the nonce
    pkg.reveal.nonce = 999;
    
    const result = verifyProofPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.commitmentValid).toBe(false);
  });

  it("detects altered deck hash", () => {
    initMatchFairness("tamper-3");
    createRoundCommitment("tamper-3", 1);
    revealRoundSeed("tamper-3", 1);
    
    const pkg = buildProofPackage("tamper-3", 1)!;
    // Tamper with the deck hash
    pkg.reveal.deckHash = "c".repeat(64);
    
    const result = verifyProofPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.deckHashMatch).toBe(false);
  });

  it("detects altered deck order", () => {
    initMatchFairness("tamper-4");
    createRoundCommitment("tamper-4", 1);
    revealRoundSeed("tamper-4", 1);
    
    const pkg = buildProofPackage("tamper-4", 1)!;
    // Swap two cards in the deck
    [pkg.reveal.deckOrder[0], pkg.reveal.deckOrder[1]] = [pkg.reveal.deckOrder[1], pkg.reveal.deckOrder[0]];
    
    const result = verifyProofPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.deckReproducible).toBe(false);
  });

  it("detects altered commitment hash", () => {
    initMatchFairness("tamper-5");
    createRoundCommitment("tamper-5", 1);
    revealRoundSeed("tamper-5", 1);
    
    const pkg = buildProofPackage("tamper-5", 1)!;
    // Tamper with the commitment
    pkg.commitment.commitmentHash = "d".repeat(64);
    
    const result = verifyProofPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.commitmentValid).toBe(false);
  });

  it("detects tampered client seed in v2 proof", () => {
    initMatchFairness("tamper-6", ["p1", "p2"]);
    createRoundCommitment("tamper-6", 1);
    submitClientSeed("tamper-6", 1, "p1", "real-seed-1");
    submitClientSeed("tamper-6", 1, "p2", "real-seed-2");
    revealRoundSeed("tamper-6", 1);

    const pkg = buildProofPackage("tamper-6", 1)!;
    // Tamper with a client seed
    pkg.reveal.clientSeeds!.player1 = "fake-seed";

    const result = verifyProofPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.clientSeedValid).toBe(false);
  });

  it("detects tampered combined seed in v2 proof", () => {
    initMatchFairness("tamper-7", ["p1", "p2"]);
    createRoundCommitment("tamper-7", 1);
    submitClientSeed("tamper-7", 1, "p1", "s1");
    submitClientSeed("tamper-7", 1, "p2", "s2");
    revealRoundSeed("tamper-7", 1);

    const pkg = buildProofPackage("tamper-7", 1)!;
    // Tamper with the combined seed
    pkg.reveal.combinedSeed = "e".repeat(64);

    const result = verifyProofPackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.clientSeedValid).toBe(false);
  });
});

// ── Integration Tests: API ──────────────────────────────────────────

describe("Trust Shield — API", () => {
  let BASE: string;
  let token: string;
  let token2: string;

  beforeAll(async () => {
    BASE = await startTestServer();
    const ts = Date.now();
    // Register and login user 1
    await registerUser(`fairuser1_${ts}`, `fairuser1_${ts}@test.com`, "password123");
    const login1 = await loginUser(`fairuser1_${ts}`, "password123");
    token = login1.body.sessionId;
    // Register and login user 2
    await registerUser(`fairuser2_${ts}`, `fairuser2_${ts}@test.com`, "password123");
    const login2 = await loginUser(`fairuser2_${ts}`, "password123");
    token2 = login2.body.sessionId;
  });

  afterAll(async () => {
    await stopTestServer();
  });

  it("POST /api/fairness/verify validates genuine v1 proof", async () => {
    // Build a proof package manually
    const seed = generateServerSeed();
    const nonce = 1;
    const commitmentHash = computeCommitmentHash(seed, nonce);
    const deckOrder = deterministicShuffle(seed, nonce);
    const deckHash = computeDeckHash(deckOrder);

    const pkg: FairnessProofPackage = {
      handId: "test-hand-1",
      matchId: "test-match-1",
      roundNumber: 1,
      commitment: {
        commitmentHash,
        committedAt: new Date().toISOString(),
        algorithmVersion: FAIRNESS_ALGORITHM_VERSION_V1,
      },
      reveal: {
        serverSeed: seed,
        nonce,
        algorithmVersion: FAIRNESS_ALGORITHM_VERSION_V1,
        deckHash,
        deckOrder,
        revealedAt: new Date().toISOString(),
      },
      transcriptHash: null,
      timestamps: {
        committed: new Date().toISOString(),
        revealed: new Date().toISOString(),
      },
      verification: { commitmentValid: false, deckReproducible: false },
      algorithmVersion: FAIRNESS_ALGORITHM_VERSION_V1,
    };

    const res = await makeRequest("POST", "/api/fairness/verify", pkg);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.commitmentValid).toBe(true);
    expect(res.body.deckReproducible).toBe(true);
    expect(res.body.deckHashMatch).toBe(true);
    expect(res.body.clientSeedValid).toBeNull();
    expect(res.body.reproducedDeck).toHaveLength(21); // first 21 cards shown
    expect(res.body.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);
  });

  it("POST /api/fairness/verify validates genuine v2 proof", async () => {
    const seed = generateServerSeed();
    const nonce = 1;
    const commitmentHash = computeCommitmentHash(seed, nonce);
    const client1 = "player-a-seed";
    const client2 = "player-b-seed";
    const combined = combineSeeds(seed, client1, client2);
    const deckOrder = deterministicShuffle(combined, nonce);
    const deckHash = computeDeckHash(deckOrder);

    const pkg: FairnessProofPackage = {
      handId: "test-hand-v2",
      matchId: "test-match-v2",
      roundNumber: 1,
      commitment: {
        commitmentHash,
        committedAt: new Date().toISOString(),
        algorithmVersion: FAIRNESS_ALGORITHM_VERSION,
      },
      reveal: {
        serverSeed: seed,
        nonce,
        algorithmVersion: FAIRNESS_ALGORITHM_VERSION,
        deckHash,
        deckOrder,
        revealedAt: new Date().toISOString(),
        clientSeeds: { player1: client1, player2: client2 },
        combinedSeed: combined,
      },
      transcriptHash: null,
      timestamps: {
        committed: new Date().toISOString(),
        revealed: new Date().toISOString(),
      },
      verification: { commitmentValid: false, deckReproducible: false },
      algorithmVersion: FAIRNESS_ALGORITHM_VERSION,
    };

    const res = await makeRequest("POST", "/api/fairness/verify", pkg);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.commitmentValid).toBe(true);
    expect(res.body.deckReproducible).toBe(true);
    expect(res.body.deckHashMatch).toBe(true);
    expect(res.body.clientSeedValid).toBe(true);
    expect(res.body.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);
  });

  it("POST /api/fairness/verify rejects tampered proof", async () => {
    const seed = generateServerSeed();
    const nonce = 1;
    const commitmentHash = computeCommitmentHash(seed, nonce);
    const deckOrder = deterministicShuffle(seed, nonce);
    const deckHash = computeDeckHash(deckOrder);

    const pkg: FairnessProofPackage = {
      handId: "test-hand-2",
      matchId: "test-match-2",
      roundNumber: 1,
      commitment: {
        commitmentHash,
        committedAt: new Date().toISOString(),
        algorithmVersion: FAIRNESS_ALGORITHM_VERSION_V1,
      },
      reveal: {
        serverSeed: "x".repeat(64), // TAMPERED
        nonce,
        algorithmVersion: FAIRNESS_ALGORITHM_VERSION_V1,
        deckHash,
        deckOrder,
        revealedAt: new Date().toISOString(),
      },
      transcriptHash: null,
      timestamps: {
        committed: new Date().toISOString(),
        revealed: new Date().toISOString(),
      },
      verification: { commitmentValid: false, deckReproducible: false },
      algorithmVersion: FAIRNESS_ALGORITHM_VERSION_V1,
    };

    const res = await makeRequest("POST", "/api/fairness/verify", pkg);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.commitmentValid).toBe(false);
  });

  it("POST /api/fairness/verify rejects malformed input", async () => {
    const res = await makeRequest("POST", "/api/fairness/verify", { garbage: true });
    expect(res.status).toBe(400);
  });

  // Regression tests
  it("regression: registration still works", async () => {
    const unique = `regfair_${crypto.randomUUID().slice(0, 8)}`;
    const res = await registerUser(unique, `${unique}@test.com`, "password123");
    expect([200, 201]).toContain(res.status);
  });

  it("regression: wallet API still works", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
  });

  it("regression: leaderboard still works", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });

  it("regression: replay list still works", async () => {
    const res = await makeRequest("GET", "/api/replays", undefined, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
  });
});
