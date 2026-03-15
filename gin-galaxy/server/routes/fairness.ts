/**
 * Fairness Verification API Routes.
 *
 * Provides endpoints for verifying provably fair shuffle proofs:
 *  - GET /api/replays/:id/fairness — retrieve fairness proof data for a replay
 *  - GET /api/replays/:id/fairness/download — download proof packages as JSON
 *  - POST /api/fairness/verify — verify a proof package independently
 *
 * Access control: participants only for replay-specific data.
 */

import { Router, Response, Request } from "express";
import { db } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import {
  verifyProofPackage,
  computeCommitmentHash,
  deterministicShuffle,
  computeDeckHash,
  combineSeeds,
  cardIndexToCard,
  FAIRNESS_ALGORITHM_VERSION,
  FAIRNESS_ALGORITHM_VERSION_V1,
  type FairnessProofPackage,
} from "../multiplayer/fairness.js";

const router = Router();

// ─── GET /api/replays/:id/fairness ───────────────────────────────────
// Returns the fairness proof data for a specific replay.
// Access control: only participants can view.
router.get("/:id/fairness", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const replayId = req.params.id;

  const row = db.prepare(`
    SELECT r.player1_id, r.player2_id, r.fairness_json
    FROM replays r
    WHERE r.id = ?
  `).get(replayId) as any;

  if (!row) {
    res.status(404).json({ error: "Replay not found." });
    return;
  }

  // Access control: must be a participant
  if (row.player1_id !== req.userId && row.player2_id !== req.userId) {
    res.status(403).json({ error: "Access denied. You are not a participant in this match." });
    return;
  }

  if (!row.fairness_json) {
    res.json({
      fairness: null,
      message: "No fairness proof data available for this replay. Fairness proofs are generated for matches played after the Trust Shield update.",
    });
    return;
  }

  let fairnessData: any;
  try {
    fairnessData = JSON.parse(row.fairness_json);
  } catch {
    res.json({ fairness: null, message: "Fairness data is malformed." });
    return;
  }

  // For each proof that has a reveal, run self-verification
  const verifiedProofs = (fairnessData.proofs || []).map((proof: any) => {
    if (!proof.reveal) {
      return { ...proof, verified: false, reason: "Seed not yet revealed (hand may not have completed)." };
    }

    // Determine algorithm version
    const algVersion = proof.reveal.algorithmVersion || FAIRNESS_ALGORITHM_VERSION_V1;

    // Build a minimal proof package for verification
    const pkg: FairnessProofPackage = {
      handId: proof.handId,
      matchId: proof.matchId,
      roundNumber: proof.roundNumber,
      commitment: proof.commitment,
      reveal: proof.reveal,
      transcriptHash: proof.transcriptHash,
      timestamps: {
        committed: proof.commitment.committedAt,
        revealed: proof.reveal.revealedAt,
      },
      verification: { commitmentValid: false, deckReproducible: false },
      algorithmVersion: algVersion,
    };

    const result = verifyProofPackage(pkg);
    return {
      ...proof,
      verified: result.valid,
      verificationDetails: result.details,
      algorithmVersion: algVersion,
      hasClientSeeds: !!proof.reveal.clientSeeds,
    };
  });

  res.json({
    fairness: {
      algorithmVersion: fairnessData.algorithmVersion,
      proofs: verifiedProofs,
    },
  });
});

// ─── GET /api/replays/:id/fairness/download ──────────────────────────
// Downloads the complete proof packages for a replay as JSON.
// This is the exact data needed for independent verification.
router.get("/:id/fairness/download", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const replayId = req.params.id;

  const row = db.prepare(`
    SELECT r.player1_id, r.player2_id, r.player1_username, r.player2_username,
           r.winner_username, r.loser_username, r.fairness_json,
           r.room_id, r.started_at, r.ended_at
    FROM replays r
    WHERE r.id = ?
  `).get(replayId) as any;

  if (!row) {
    res.status(404).json({ error: "Replay not found." });
    return;
  }

  if (row.player1_id !== req.userId && row.player2_id !== req.userId) {
    res.status(403).json({ error: "Access denied." });
    return;
  }

  if (!row.fairness_json) {
    res.status(404).json({ error: "No fairness data available for this replay." });
    return;
  }

  let fairnessData: any;
  try {
    fairnessData = JSON.parse(row.fairness_json);
  } catch {
    res.status(500).json({ error: "Fairness data is malformed." });
    return;
  }

  // Build verification-ready proof packages
  const proofPackages = (fairnessData.proofs || [])
    .filter((p: any) => p.reveal)
    .map((proof: any) => {
      const algVersion = proof.reveal.algorithmVersion || FAIRNESS_ALGORITHM_VERSION_V1;
      const shuffleSeed = proof.reveal.combinedSeed || proof.reveal.serverSeed;

      const commitmentValid = computeCommitmentHash(proof.reveal.serverSeed, proof.reveal.nonce) === proof.commitment.commitmentHash;
      const reproducedDeck = deterministicShuffle(shuffleSeed, proof.reveal.nonce);
      const deckReproducible = computeDeckHash(reproducedDeck) === proof.reveal.deckHash;

      const pkg: FairnessProofPackage = {
        handId: proof.handId,
        matchId: proof.matchId,
        roundNumber: proof.roundNumber,
        commitment: proof.commitment,
        reveal: proof.reveal,
        transcriptHash: proof.transcriptHash,
        timestamps: {
          committed: proof.commitment.committedAt,
          revealed: proof.reveal.revealedAt,
        },
        verification: {
          commitmentValid,
          deckReproducible,
        },
        algorithmVersion: algVersion,
      };

      return pkg;
    });

  const downloadPayload = {
    replayId,
    matchId: row.room_id,
    players: [
      { userId: row.player1_id, username: row.player1_username },
      { userId: row.player2_id, username: row.player2_username },
    ],
    matchDate: new Date(row.started_at).toISOString(),
    proofPackages,
    verificationInstructions: {
      description: "Each proof package can be independently verified using the /api/fairness/verify endpoint or by running the verification algorithm locally.",
      steps: [
        "1. Verify the commitment: SHA-256(serverSeed + ':' + nonce) must equal commitmentHash",
        "2. For v2 proofs: verify combinedSeed = HMAC-SHA256(serverSeed, clientSeed1 + ':' + clientSeed2)",
        "3. Reproduce the deck: run the deterministic Fisher-Yates shuffle with the appropriate seed and nonce",
        "4. Verify the deck hash: SHA-256(deck order) must equal deckHash",
      ],
      apiEndpoint: "/api/fairness/verify",
    },
  };

  // Set headers for download
  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="fairness-proof-${replayId.slice(0, 8)}.json"`
  );
  res.json(downloadPayload);
});

export default router;

// ─── Standalone verification route (no auth required) ────────────────
// POST /api/fairness/verify — accepts a proof package and returns verification result.
// This allows any user to independently verify a proof without authentication.
export const fairnessVerifyRouter = Router();

fairnessVerifyRouter.post("/verify", (req: Request, res: Response) => {
  const pkg = req.body as FairnessProofPackage;

  if (
    !pkg ||
    !pkg.commitment?.commitmentHash ||
    !pkg.reveal?.serverSeed ||
    pkg.reveal?.nonce === undefined
  ) {
    res.status(400).json({ error: "Invalid proof package. Required: commitment, reveal with serverSeed and nonce." });
    return;
  }

  const result = verifyProofPackage(pkg);

  // Determine the shuffle seed
  const algVersion = pkg.algorithmVersion || pkg.reveal.algorithmVersion || FAIRNESS_ALGORITHM_VERSION_V1;
  let shuffleSeed = pkg.reveal.serverSeed;
  if (algVersion >= 2 && pkg.reveal.clientSeeds && pkg.reveal.combinedSeed) {
    shuffleSeed = pkg.reveal.combinedSeed;
  }

  // Reproduce deck for transparency
  const reproducedDeck = deterministicShuffle(shuffleSeed, pkg.reveal.nonce);
  const reproducedCards = reproducedDeck.map(cardIndexToCard);

  res.json({
    valid: result.valid,
    commitmentValid: result.commitmentValid,
    deckReproducible: result.deckReproducible,
    deckHashMatch: result.deckHashMatch,
    clientSeedValid: result.clientSeedValid,
    details: result.details,
    reproducedDeck: reproducedCards.slice(0, 21).map((c, i) => ({
      position: i,
      card: `${c.rank}${c.suit}`,
      dealt_to: i < 10 ? "Player 1" : i < 20 ? "Player 2" : "First Discard",
    })),
    algorithmVersion: algVersion,
  });
});
