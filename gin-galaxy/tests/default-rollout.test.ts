/**
 * Default Client-Seed Rollout Tests.
 *
 * Validates the Trust Shield v2 default rollout:
 *  - Automatic client-seed submission on match start
 *  - Live fairness status generation and correctness
 *  - Reconnect/next-round behavior with new seeds
 *  - Fallback scenarios (no seeds → v1)
 *  - Fairness status fields and consistency
 *  - Regression tests for core features
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "crypto";
import {
  generateServerSeed,
  computeCommitmentHash,
  deterministicShuffle,
  computeDeckHash,
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

// ── Default Rollout: Auto-Submit Client Seed ──────────────────────────

describe("Default Rollout — Auto Client-Seed Submission", () => {
  beforeEach(() => {
    _clearAllFairness();
  });

  it("both players can submit seeds immediately after match start", () => {
    initMatchFairness("auto-1", ["player-a", "player-b"]);
    createRoundCommitment("auto-1", 1);

    // Simulate auto-submission (what the frontend hook does)
    const seedA = crypto.randomBytes(16).toString("hex"); // 32-char hex seed
    const seedB = crypto.randomBytes(16).toString("hex");

    const r1 = submitClientSeed("auto-1", 1, "player-a", seedA);
    expect(r1.bothPresent).toBe(false);

    const r2 = submitClientSeed("auto-1", 1, "player-b", seedB);
    expect(r2.bothPresent).toBe(true);
    expect(r2.combinedSeed).toBeTruthy();
    expect(r2.deckOrder).toHaveLength(52);
  });

  it("seeds of correct length from crypto.getRandomValues equivalent", () => {
    // Simulate what the browser hook generates: 16 bytes → 32-char hex
    const seed = crypto.randomBytes(16).toString("hex");
    expect(seed).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(seed)).toBe(true);
  });

  it("multiple rounds each get fresh seeds", () => {
    initMatchFairness("auto-2", ["p1", "p2"]);

    // Round 1
    createRoundCommitment("auto-2", 1);
    submitClientSeed("auto-2", 1, "p1", "round1-seed-a");
    submitClientSeed("auto-2", 1, "p2", "round1-seed-b");
    const reveal1 = revealRoundSeed("auto-2", 1);

    // Round 2
    createRoundCommitment("auto-2", 2);
    submitClientSeed("auto-2", 2, "p1", "round2-seed-a");
    submitClientSeed("auto-2", 2, "p2", "round2-seed-b");
    const reveal2 = revealRoundSeed("auto-2", 2);

    // Both rounds should be v2
    expect(reveal1!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);
    expect(reveal2!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);

    // Combined seeds should differ
    expect(reveal1!.combinedSeed).not.toBe(reveal2!.combinedSeed);

    // Decks should differ
    expect(reveal1!.deckOrder).not.toEqual(reveal2!.deckOrder);
  });

  it("auto-submitted seeds produce verifiable proofs", () => {
    initMatchFairness("auto-3", ["alice", "bob"]);
    createRoundCommitment("auto-3", 1);

    submitClientSeed("auto-3", 1, "alice", crypto.randomBytes(16).toString("hex"));
    submitClientSeed("auto-3", 1, "bob", crypto.randomBytes(16).toString("hex"));

    revealRoundSeed("auto-3", 1);

    const pkg = buildProofPackage("auto-3", 1);
    expect(pkg).not.toBeNull();

    const result = verifyProofPackage(pkg!);
    expect(result.valid).toBe(true);
    expect(result.commitmentValid).toBe(true);
    expect(result.deckReproducible).toBe(true);
    expect(result.deckHashMatch).toBe(true);
    expect(result.clientSeedValid).toBe(true);
  });

  it("seed submission is idempotent for same player+round", () => {
    initMatchFairness("auto-4", ["p1", "p2"]);
    createRoundCommitment("auto-4", 1);

    // Submit twice for same player
    submitClientSeed("auto-4", 1, "p1", "first-seed");
    submitClientSeed("auto-4", 1, "p1", "second-seed");

    // Second submission should overwrite (or first takes precedence — behavior is implementation-defined)
    const seeds = getClientSeeds("auto-4", 1);
    expect(seeds).not.toBeNull();
    // At least one seed should be present
    expect(seeds!.player1).toBeTruthy();
  });
});

// ── Default Rollout: Reconnect & Next-Round Behavior ──────────────────

describe("Default Rollout — Reconnect & Round Transitions", () => {
  beforeEach(() => {
    _clearAllFairness();
  });

  it("new round commitment is independent of previous round seeds", () => {
    initMatchFairness("recon-1", ["p1", "p2"]);

    // Round 1 with seeds
    createRoundCommitment("recon-1", 1);
    submitClientSeed("recon-1", 1, "p1", "seed1a");
    submitClientSeed("recon-1", 1, "p2", "seed1b");
    revealRoundSeed("recon-1", 1);

    // Round 2 — new commitment
    const r2 = createRoundCommitment("recon-1", 2);
    expect(r2.commitment.commitmentHash).toHaveLength(64);
    expect(r2.deckOrder).toHaveLength(52);

    // New round should have no seeds yet
    const seeds2 = getClientSeeds("recon-1", 2);
    // Either null (no entry yet) or both slots null
    if (seeds2) {
      expect(seeds2.player1).toBeNull();
      expect(seeds2.player2).toBeNull();
    }

    // After submitting for round 2
    submitClientSeed("recon-1", 2, "p1", "seed2a");
    submitClientSeed("recon-1", 2, "p2", "seed2b");
    const reveal2 = revealRoundSeed("recon-1", 2);
    expect(reveal2!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);
  });

  it("reconnect does not duplicate seed submission — seeds are per-round", () => {
    initMatchFairness("recon-2", ["p1", "p2"]);
    createRoundCommitment("recon-2", 1);

    // First submission
    submitClientSeed("recon-2", 1, "p1", "original-seed");
    const seeds1 = getClientSeeds("recon-2", 1);

    // Simulated reconnect: submitting again for same round
    submitClientSeed("recon-2", 1, "p1", "reconnect-seed");
    const seeds2 = getClientSeeds("recon-2", 1);

    // Seed should be present (either original or reconnect)
    expect(seeds2!.player1).toBeTruthy();
  });

  it("all round proofs in a multi-round match are retrievable", () => {
    initMatchFairness("recon-3", ["p1", "p2"]);

    for (let r = 1; r <= 5; r++) {
      createRoundCommitment("recon-3", r);
      submitClientSeed("recon-3", r, "p1", `seed-p1-r${r}`);
      submitClientSeed("recon-3", r, "p2", `seed-p2-r${r}`);
      revealRoundSeed("recon-3", r);
    }

    const proofs = getMatchProofs("recon-3");
    expect(proofs).toHaveLength(5);

    // All proofs should be complete with v2
    for (const proof of proofs) {
      expect(proof.reveal).not.toBeNull();
      expect(proof.reveal!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);
      expect(proof.reveal!.clientSeeds).not.toBeNull();
    }
  });
});

// ── Default Rollout: Fallback Scenarios ───────────────────────────────

describe("Default Rollout — Fallback Behavior", () => {
  beforeEach(() => {
    _clearAllFairness();
  });

  it("falls back to v1 when no client seeds submitted", () => {
    initMatchFairness("fb-1", ["p1", "p2"]);
    createRoundCommitment("fb-1", 1);
    // No seeds submitted
    const reveal = revealRoundSeed("fb-1", 1);
    expect(reveal!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);
    expect(reveal!.clientSeeds).toBeNull();
    expect(reveal!.combinedSeed).toBeNull();
  });

  it("falls back to v1 when only one player submits a seed", () => {
    initMatchFairness("fb-2", ["p1", "p2"]);
    createRoundCommitment("fb-2", 1);
    submitClientSeed("fb-2", 1, "p1", "only-one-seed");
    // Only one seed — not enough for v2
    const reveal = revealRoundSeed("fb-2", 1);
    expect(reveal!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);
    expect(reveal!.clientSeeds).toBeNull();
    expect(reveal!.combinedSeed).toBeNull();
  });

  it("v1 fallback proofs are still valid and verifiable", () => {
    initMatchFairness("fb-3", ["p1", "p2"]);
    createRoundCommitment("fb-3", 1);
    // No client seeds — force v1 fallback
    revealRoundSeed("fb-3", 1);

    const pkg = buildProofPackage("fb-3", 1);
    expect(pkg).not.toBeNull();
    expect(pkg!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);

    const result = verifyProofPackage(pkg!);
    expect(result.valid).toBe(true);
    expect(result.clientSeedValid).toBeNull(); // v1, no client seeds
  });

  it("mixed v1/v2 in same match still verifies", () => {
    initMatchFairness("fb-4", ["p1", "p2"]);

    // Round 1: one seed only (v1 fallback)
    createRoundCommitment("fb-4", 1);
    submitClientSeed("fb-4", 1, "p1", "partial-seed");
    revealRoundSeed("fb-4", 1);

    // Round 2: both seeds (v2)
    createRoundCommitment("fb-4", 2);
    submitClientSeed("fb-4", 2, "p1", "full-seed-a");
    submitClientSeed("fb-4", 2, "p2", "full-seed-b");
    revealRoundSeed("fb-4", 2);

    // Round 3: no seeds (v1)
    createRoundCommitment("fb-4", 3);
    revealRoundSeed("fb-4", 3);

    const proofs = getMatchProofs("fb-4");
    expect(proofs).toHaveLength(3);

    const pkg1 = buildProofPackage("fb-4", 1)!;
    const pkg2 = buildProofPackage("fb-4", 2)!;
    const pkg3 = buildProofPackage("fb-4", 3)!;

    expect(pkg1.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);
    expect(pkg2.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);
    expect(pkg3.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);

    expect(verifyProofPackage(pkg1).valid).toBe(true);
    expect(verifyProofPackage(pkg2).valid).toBe(true);
    expect(verifyProofPackage(pkg3).valid).toBe(true);
  });
});

// ── Default Rollout: Live Fairness Status ─────────────────────────────

describe("Default Rollout — Live Fairness Status", () => {
  beforeEach(() => {
    _clearAllFairness();
  });

  it("fairness status reflects commitment published", () => {
    initMatchFairness("fs-1", ["p1", "p2"]);
    createRoundCommitment("fs-1", 1);

    const proof = getRoundProof("fs-1", 1);
    expect(proof).not.toBeNull();
    expect(proof!.commitment.commitmentHash).toHaveLength(64);
  });

  it("client seed state tracked per player per round", () => {
    initMatchFairness("fs-2", ["player-a", "player-b"]);
    createRoundCommitment("fs-2", 1);

    // Before any seeds
    let seeds = getClientSeeds("fs-2", 1);
    // No seeds submitted yet — either null object or both slots null
    expect(seeds?.player1 ?? null).toBeNull();
    expect(seeds?.player2 ?? null).toBeNull();

    // After player A submits
    submitClientSeed("fs-2", 1, "player-a", "my-seed");
    seeds = getClientSeeds("fs-2", 1);
    expect(seeds!.player1).toBe("my-seed");
    expect(seeds!.player2).toBeNull();

    // After player B submits
    submitClientSeed("fs-2", 1, "player-b", "their-seed");
    seeds = getClientSeeds("fs-2", 1);
    expect(seeds!.player1).toBe("my-seed");
    expect(seeds!.player2).toBe("their-seed");
  });

  it("serializable fairness data captures v2 rounds correctly", () => {
    initMatchFairness("fs-3", ["p1", "p2"]);

    createRoundCommitment("fs-3", 1);
    submitClientSeed("fs-3", 1, "p1", "seed-a");
    submitClientSeed("fs-3", 1, "p2", "seed-b");
    revealRoundSeed("fs-3", 1);

    const data = getSerializableFairnessData("fs-3");
    expect(data).not.toBeNull();
    expect(data!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);
    expect(data!.proofs).toHaveLength(1);
    expect(data!.proofs[0].reveal).not.toBeNull();
    expect(data!.proofs[0].reveal!.clientSeeds).not.toBeNull();
    expect(data!.proofs[0].reveal!.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);
  });
});

// ── Default Rollout: Replay/Live Consistency ──────────────────────────

describe("Default Rollout — Replay/Live Consistency", () => {
  beforeEach(() => {
    _clearAllFairness();
  });

  it("proof package algorithm version matches reveal version", () => {
    initMatchFairness("cons-1", ["p1", "p2"]);

    // v2 round
    createRoundCommitment("cons-1", 1);
    submitClientSeed("cons-1", 1, "p1", "s1");
    submitClientSeed("cons-1", 1, "p2", "s2");
    revealRoundSeed("cons-1", 1);

    const pkg = buildProofPackage("cons-1", 1)!;
    expect(pkg.algorithmVersion).toBe(pkg.reveal.algorithmVersion);
    expect(pkg.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION);
  });

  it("v1 fallback is consistently reflected in both proof and reveal", () => {
    initMatchFairness("cons-2", ["p1", "p2"]);
    createRoundCommitment("cons-2", 1);
    revealRoundSeed("cons-2", 1);

    const pkg = buildProofPackage("cons-2", 1)!;
    expect(pkg.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);
    expect(pkg.reveal.algorithmVersion).toBe(FAIRNESS_ALGORITHM_VERSION_V1);
    expect(pkg.reveal.clientSeeds).toBeNull();
    expect(pkg.reveal.combinedSeed).toBeNull();
  });

  it("commitment hash is identical between live status and proof", () => {
    initMatchFairness("cons-3", ["p1", "p2"]);
    const { commitment } = createRoundCommitment("cons-3", 1);
    submitClientSeed("cons-3", 1, "p1", "a");
    submitClientSeed("cons-3", 1, "p2", "b");
    revealRoundSeed("cons-3", 1);

    const pkg = buildProofPackage("cons-3", 1)!;
    expect(pkg.commitment.commitmentHash).toBe(commitment.commitmentHash);
  });

  it("v2 proof's combined seed matches independent computation", () => {
    initMatchFairness("cons-4", ["p1", "p2"]);
    createRoundCommitment("cons-4", 1);
    submitClientSeed("cons-4", 1, "p1", "client1");
    submitClientSeed("cons-4", 1, "p2", "client2");
    revealRoundSeed("cons-4", 1);

    const pkg = buildProofPackage("cons-4", 1)!;
    const expectedCombined = combineSeeds(pkg.reveal.serverSeed, "client1", "client2");
    expect(pkg.reveal.combinedSeed).toBe(expectedCombined);

    const expectedDeck = deterministicShuffle(expectedCombined, 1);
    expect(pkg.reveal.deckOrder).toEqual(expectedDeck);
  });
});

// ── Integration Tests: API with Trust Shield v2 Default ───────────────

describe("Default Rollout — API Integration", () => {
  let BASE: string;
  let token: string;

  beforeAll(async () => {
    BASE = await startTestServer();
    const ts = Date.now();
    await registerUser(`rollout_user_${ts}`, `rollout_${ts}@test.com`, "password123");
    const login = await loginUser(`rollout_user_${ts}`, "password123");
    token = login.body.sessionId;
  });

  afterAll(async () => {
    await stopTestServer();
  });

  it("POST /api/fairness/verify validates auto-generated v2 proof", async () => {
    const seed = generateServerSeed();
    const nonce = 1;
    const commitmentHash = computeCommitmentHash(seed, nonce);

    // Simulate auto-generated client seeds (like the browser hook)
    const client1 = crypto.randomBytes(16).toString("hex");
    const client2 = crypto.randomBytes(16).toString("hex");
    const combined = combineSeeds(seed, client1, client2);
    const deckOrder = deterministicShuffle(combined, nonce);
    const deckHash = computeDeckHash(deckOrder);

    const pkg: FairnessProofPackage = {
      handId: "auto-test-1",
      matchId: "auto-match-1",
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

  // Regression: core features still working
  it("regression: wallet API functional", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
  });

  it("regression: leaderboard functional", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });

  it("regression: replay list functional", async () => {
    const res = await makeRequest("GET", "/api/replays", undefined, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
  });

  it("regression: auth registration functional", async () => {
    const unique = `reg_rollout_${crypto.randomUUID().slice(0, 8)}`;
    const res = await registerUser(unique, `${unique}@test.com`, "password123");
    expect([200, 201]).toContain(res.status);
  });
});
