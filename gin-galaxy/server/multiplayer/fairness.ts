/**
 * Provably Fair Shuffle — Cryptographic Commitment and Verification Module.
 *
 * Implements a commit–reveal protocol for Gin Paradise multiplayer hands:
 *
 * v1 (server-seed only):
 *  1. BEFORE dealing: the server generates a cryptographic server_seed,
 *     computes a deterministic shuffle from (server_seed, nonce),
 *     and publishes a commitment hash = SHA-256(server_seed || nonce).
 *  2. AFTER the hand ends: the server reveals the server_seed + nonce.
 *
 * v2 (client-seed contribution — defense in depth):
 *  1. BEFORE dealing: the server generates a server_seed and publishes a
 *     commitment hash = SHA-256(server_seed || nonce) as before.
 *  2. Each client submits a client_seed (any string up to 64 bytes).
 *  3. The combinedSeed = HMAC-SHA256(server_seed, client_seed_1 + ":" + client_seed_2).
 *  4. The shuffle is derived from (combinedSeed, nonce) instead of (server_seed, nonce).
 *  5. AFTER the hand ends: the server reveals server_seed, both client seeds, nonce,
 *     and the combined seed so anyone can reproduce the shuffle.
 *
 * The shuffle uses a Fisher–Yates algorithm seeded by HMAC-SHA256 to produce
 * a deterministic, reproducible deck ordering from explicit inputs.
 *
 * The commitment hash is always SHA-256(server_seed + ":" + nonce) regardless of
 * algorithm version — this proves the server committed to a seed BEFORE seeing
 * client seeds. With v2, the final shuffle additionally incorporates client entropy,
 * ensuring neither party alone determines the deck order.
 */

import crypto from "crypto";

// ── Constants ────────────────────────────────────────────────────────

export const FAIRNESS_ALGORITHM_VERSION = 2;
export const FAIRNESS_ALGORITHM_VERSION_V1 = 1;

// ── Types ────────────────────────────────────────────────────────────

export interface FairnessCommitment {
  /** SHA-256 hex of (serverSeed || ":" || nonce) — published pre-deal */
  commitmentHash: string;
  /** ISO-8601 timestamp when commitment was created */
  committedAt: string;
  /** Algorithm version used to derive the shuffle */
  algorithmVersion: number;
}

export interface FairnessReveal {
  /** The raw server seed (32 bytes hex) — revealed post-hand */
  serverSeed: string;
  /** Integer nonce (monotonically increasing per match) */
  nonce: number;
  /** Algorithm version */
  algorithmVersion: number;
  /** SHA-256 hex of the resulting 52-card deck ordering */
  deckHash: string;
  /** The deterministic deck order as an array of card indices (0-51) */
  deckOrder: number[];
  /** ISO-8601 timestamp when seed was revealed */
  revealedAt: string;
  /** Client seeds contributed by each player (v2 only) */
  clientSeeds?: { player1: string; player2: string } | null;
  /** Combined seed derived from server + client seeds (v2 only) */
  combinedSeed?: string | null;
}

export interface FairnessProof {
  /** Unique identifier for this hand/round */
  handId: string;
  /** Match / room identifier */
  matchId: string;
  /** Round number within the match */
  roundNumber: number;
  /** Pre-deal commitment */
  commitment: FairnessCommitment;
  /** Post-hand reveal (null until hand completes) */
  reveal: FairnessReveal | null;
  /** SHA-256 hex of the transcript actions for this round (linkage) */
  transcriptHash: string | null;
  /** Timestamps */
  createdAt: string;
  completedAt: string | null;
}

export interface FairnessProofPackage {
  handId: string;
  matchId: string;
  roundNumber: number;
  commitment: FairnessCommitment;
  reveal: FairnessReveal;
  transcriptHash: string | null;
  timestamps: {
    committed: string;
    revealed: string;
  };
  verification: {
    commitmentValid: boolean;
    deckReproducible: boolean;
  };
  /** Algorithm version used for this proof */
  algorithmVersion: number;
}

// ── Per-match fairness state ─────────────────────────────────────────

interface MatchFairnessState {
  /** Server seed for this entire match (generated once) */
  serverSeed: string;
  /** Monotonically increasing nonce for each round */
  currentNonce: number;
  /** Accumulated proofs for each round */
  proofs: Map<number, FairnessProof>;
  /** Client seeds contributed by players, keyed by round number */
  clientSeeds: Map<number, { player1: string | null; player2: string | null }>;
  /** Player IDs for ordering client seeds */
  playerIds: [string, string] | null;
}

const matchFairness = new Map<string, MatchFairnessState>();

// ── Core Cryptographic Functions ─────────────────────────────────────

/**
 * Generate a cryptographically secure 32-byte server seed.
 */
export function generateServerSeed(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Compute the commitment hash: SHA-256(serverSeed + ":" + nonce).
 */
export function computeCommitmentHash(serverSeed: string, nonce: number): string {
  const input = `${serverSeed}:${nonce}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Derive a deterministic sequence of random values from (serverSeed, nonce)
 * using HMAC-SHA256 in counter mode.
 *
 * This produces a reproducible stream of 32-bit unsigned integers.
 */
function deriveRandomStream(serverSeed: string, nonce: number, count: number): number[] {
  const values: number[] = [];
  let counter = 0;

  while (values.length < count) {
    const data = `${serverSeed}:${nonce}:${counter}`;
    const hash = crypto.createHmac("sha256", serverSeed).update(data).digest();

    // Extract 4-byte unsigned integers from the 32-byte hash
    for (let i = 0; i + 4 <= hash.length && values.length < count; i += 4) {
      values.push(hash.readUInt32BE(i));
    }
    counter++;
  }

  return values;
}

/**
 * Deterministic Fisher–Yates shuffle of card indices [0..51]
 * using the derived random stream from (seed, nonce).
 *
 * The seed parameter is either the raw server seed (v1) or the
 * combined seed (v2, derived from server + client seeds).
 *
 * Returns the shuffled deck as an array of card indices.
 */
export function deterministicShuffle(seed: string, nonce: number): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);

  // We need 51 random values for Fisher–Yates (one per swap)
  const randoms = deriveRandomStream(seed, nonce, 51);

  for (let i = 51; i > 0; i--) {
    const j = randoms[51 - i] % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

/**
 * Combine server seed with client seeds using HMAC-SHA256.
 * combinedSeed = HMAC-SHA256(serverSeed, clientSeed1 + ":" + clientSeed2)
 *
 * This ensures:
 * - The server cannot predict the combined seed without knowing client seeds
 * - Clients cannot predict it without knowing the server seed
 * - The result is deterministic given all inputs
 */
export function combineSeeds(
  serverSeed: string,
  clientSeed1: string,
  clientSeed2: string
): string {
  const clientData = `${clientSeed1}:${clientSeed2}`;
  return crypto.createHmac("sha256", serverSeed).update(clientData).digest("hex");
}

/**
 * Compute SHA-256 hex of a deck ordering (for proof verification).
 */
export function computeDeckHash(deckOrder: number[]): string {
  const input = deckOrder.join(",");
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Compute SHA-256 hex of transcript actions (for proof linkage).
 */
export function computeTranscriptHash(actions: any[]): string {
  const input = JSON.stringify(actions);
  return crypto.createHash("sha256").update(input).digest("hex");
}

// ── Lifecycle — called by the engine/roomManager ─────────────────────

/**
 * Initialize fairness tracking for a new match.
 * Called when a match starts (before the first deal).
 */
export function initMatchFairness(roomId: string, playerIds?: [string, string]): void {
  matchFairness.set(roomId, {
    serverSeed: generateServerSeed(),
    currentNonce: 0,
    proofs: new Map(),
    clientSeeds: new Map(),
    playerIds: playerIds || null,
  });
}

/**
 * Create a pre-deal commitment for a round.
 * Returns the commitment hash (to be broadcast to players)
 * and the deterministic deck order (to be used by the engine for dealing).
 *
 * IMPORTANT: the deck order must NOT be sent to clients at this point —
 * only the commitment hash is safe to share.
 */
export function createRoundCommitment(
  roomId: string,
  roundNumber: number
): { commitment: FairnessCommitment; deckOrder: number[] } {
  const state = matchFairness.get(roomId);
  if (!state) {
    throw new Error(`No fairness state for room ${roomId}`);
  }

  // Increment nonce for each new round
  state.currentNonce++;
  const nonce = state.currentNonce;

  // Compute commitment
  const commitmentHash = computeCommitmentHash(state.serverSeed, nonce); 
  const committedAt = new Date().toISOString();

  // Compute deterministic deck
  const deckOrder = deterministicShuffle(state.serverSeed, nonce);

  const commitment: FairnessCommitment = {
    commitmentHash,
    committedAt,
    algorithmVersion: FAIRNESS_ALGORITHM_VERSION,
  };

  // Create proof record
  const handId = `${roomId}-R${roundNumber}`;
  const proof: FairnessProof = {
    handId,
    matchId: roomId,
    roundNumber,
    commitment,
    reveal: null,
    transcriptHash: null,
    createdAt: committedAt,
    completedAt: null,
  };

  state.proofs.set(roundNumber, proof);

  return { commitment, deckOrder };
}

/**
 * Submit a client seed for a specific round.
 * Both players should submit before the deal is finalized (v2 flow).
 * Returns true if both seeds are now present.
 */
export function submitClientSeed(
  roomId: string,
  roundNumber: number,
  playerId: string,
  clientSeed: string
): { bothPresent: boolean; combinedSeed?: string; deckOrder?: number[] } {
  const state = matchFairness.get(roomId);
  if (!state) return { bothPresent: false };

  let roundSeeds = state.clientSeeds.get(roundNumber);
  if (!roundSeeds) {
    roundSeeds = { player1: null, player2: null };
    state.clientSeeds.set(roundNumber, roundSeeds);
  }

  // Determine which player slot
  if (state.playerIds) {
    if (playerId === state.playerIds[0]) {
      roundSeeds.player1 = clientSeed;
    } else if (playerId === state.playerIds[1]) {
      roundSeeds.player2 = clientSeed;
    }
  }

  // Check if both seeds are now present
  if (roundSeeds.player1 !== null && roundSeeds.player2 !== null) {
    // Both present — compute combined seed and new deck
    const combined = combineSeeds(state.serverSeed, roundSeeds.player1, roundSeeds.player2);
    const nonce = roundNumber;
    const deckOrder = deterministicShuffle(combined, nonce);
    return { bothPresent: true, combinedSeed: combined, deckOrder };
  }

  return { bothPresent: false };
}

/**
 * Get client seeds for a round (if any were submitted).
 */
export function getClientSeeds(
  roomId: string,
  roundNumber: number
): { player1: string | null; player2: string | null } | null {
  const state = matchFairness.get(roomId);
  if (!state) return null;
  return state.clientSeeds.get(roundNumber) || null;
}

/**
 * Reveal the seed material after a round completes.
 * This completes the fairness proof for the round.
 */
export function revealRoundSeed(
  roomId: string,
  roundNumber: number,
  transcriptActions?: any[]
): FairnessReveal | null {
  const state = matchFairness.get(roomId);
  if (!state) return null;

  const proof = state.proofs.get(roundNumber);
  if (!proof) return null;
  if (proof.reveal) return proof.reveal; // Already revealed

  const nonce = roundNumber;

  // Determine if client seeds were contributed (v2)
  const roundClientSeeds = state.clientSeeds.get(roundNumber);
  const hasClientSeeds = roundClientSeeds?.player1 != null && roundClientSeeds?.player2 != null;

  let shuffleSeed: string;
  let combinedSeedHex: string | null = null;
  let algVersion: number;

  if (hasClientSeeds) {
    // v2: combined seed
    combinedSeedHex = combineSeeds(state.serverSeed, roundClientSeeds!.player1!, roundClientSeeds!.player2!);
    shuffleSeed = combinedSeedHex;
    algVersion = FAIRNESS_ALGORITHM_VERSION; // 2
  } else {
    // v1: server seed only
    shuffleSeed = state.serverSeed;
    algVersion = FAIRNESS_ALGORITHM_VERSION_V1; // 1
  }

  // Recompute the deck
  const deckOrder = deterministicShuffle(shuffleSeed, nonce);
  const deckHash = computeDeckHash(deckOrder);

  // Compute transcript hash if actions provided
  if (transcriptActions) {
    proof.transcriptHash = computeTranscriptHash(transcriptActions);
  }

  const reveal: FairnessReveal = {
    serverSeed: state.serverSeed,
    nonce,
    algorithmVersion: algVersion,
    deckHash,
    deckOrder,
    revealedAt: new Date().toISOString(),
    clientSeeds: hasClientSeeds ? {
      player1: roundClientSeeds!.player1!,
      player2: roundClientSeeds!.player2!,
    } : null,
    combinedSeed: combinedSeedHex,
  };

  proof.reveal = reveal;
  proof.completedAt = reveal.revealedAt;

  return reveal;
}

/**
 * Get the fairness proof for a specific round.
 */
export function getRoundProof(roomId: string, roundNumber: number): FairnessProof | null {
  const state = matchFairness.get(roomId);
  if (!state) return null;
  return state.proofs.get(roundNumber) || null;
}

/**
 * Get all fairness proofs for a match.
 */
export function getMatchProofs(roomId: string): FairnessProof[] {
  const state = matchFairness.get(roomId);
  if (!state) return [];
  return Array.from(state.proofs.values());
}

/**
 * Build a downloadable/inspectable proof package for a completed round.
 */
export function buildProofPackage(roomId: string, roundNumber: number): FairnessProofPackage | null {
  const proof = getRoundProof(roomId, roundNumber);
  if (!proof || !proof.reveal) return null;

  // Determine which seed was used for the shuffle based on algorithm version
  const shuffleSeed = proof.reveal.combinedSeed || proof.reveal.serverSeed;

  // Self-verify the proof before packaging
  const commitmentValid = computeCommitmentHash(proof.reveal.serverSeed, proof.reveal.nonce) === proof.commitment.commitmentHash;
  const reproducedDeck = deterministicShuffle(shuffleSeed, proof.reveal.nonce);
  const deckReproducible = computeDeckHash(reproducedDeck) === proof.reveal.deckHash;

  return {
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
    algorithmVersion: proof.reveal.algorithmVersion,
  };
}

/**
 * Standalone verification function — can be called by clients or a verifier
 * utility to independently confirm a proof package.
 *
 * Returns { valid, details } where details explains what was checked.
 */
export function verifyProofPackage(pkg: FairnessProofPackage): {
  valid: boolean;
  commitmentValid: boolean;
  deckReproducible: boolean;
  deckHashMatch: boolean;
  clientSeedValid: boolean | null;
  details: string[];
} {
  const details: string[] = [];

  // 1. Verify commitment: SHA-256(serverSeed + ":" + nonce) === commitmentHash
  const recomputedCommitment = computeCommitmentHash(pkg.reveal.serverSeed, pkg.reveal.nonce);
  const commitmentValid = recomputedCommitment === pkg.commitment.commitmentHash;
  details.push(commitmentValid
    ? `✓ Commitment hash matches: ${recomputedCommitment.slice(0, 16)}...`
    : `✗ Commitment hash mismatch: expected ${pkg.commitment.commitmentHash.slice(0, 16)}..., got ${recomputedCommitment.slice(0, 16)}...`
  );

  // 2. Determine shuffle seed based on algorithm version
  let shuffleSeed: string;
  let clientSeedValid: boolean | null = null;

  const algVersion = pkg.algorithmVersion || pkg.reveal.algorithmVersion || FAIRNESS_ALGORITHM_VERSION_V1;

  if (algVersion >= 2 && pkg.reveal.clientSeeds && pkg.reveal.combinedSeed) {
    // v2: verify combined seed derivation
    const recomputedCombined = combineSeeds(
      pkg.reveal.serverSeed,
      pkg.reveal.clientSeeds.player1,
      pkg.reveal.clientSeeds.player2
    );
    clientSeedValid = recomputedCombined === pkg.reveal.combinedSeed;
    shuffleSeed = recomputedCombined;
    details.push(clientSeedValid
      ? `✓ Client seed combination verified (HMAC-SHA256)`
      : `✗ Client seed combination mismatch`
    );
  } else {
    // v1: server seed only
    shuffleSeed = pkg.reveal.serverSeed;
    details.push(`ℹ Algorithm v${algVersion}: server-seed-only shuffle`);
  }

  // 3. Reproduce the deck from (shuffleSeed, nonce)
  const reproducedDeck = deterministicShuffle(shuffleSeed, pkg.reveal.nonce);
  const reproducedDeckHash = computeDeckHash(reproducedDeck);
  const deckReproducible = JSON.stringify(reproducedDeck) === JSON.stringify(pkg.reveal.deckOrder);
  details.push(deckReproducible
    ? `✓ Deck order reproduced correctly (${reproducedDeck.length} cards)`
    : `✗ Deck order mismatch when reproduced from seed+nonce`
  );

  // 4. Verify deck hash matches
  const deckHashMatch = reproducedDeckHash === pkg.reveal.deckHash;
  details.push(deckHashMatch
    ? `✓ Deck hash matches: ${reproducedDeckHash.slice(0, 16)}...`
    : `✗ Deck hash mismatch`
  );

  const allValid = commitmentValid && deckReproducible && deckHashMatch &&
    (clientSeedValid === null || clientSeedValid);

  return {
    valid: allValid,
    commitmentValid,
    deckReproducible,
    deckHashMatch,
    clientSeedValid,
    details,
  };
}

/**
 * Clean up fairness state for a room (called on room cleanup).
 */
export function cleanupFairness(roomId: string): void {
  matchFairness.delete(roomId);
}

/**
 * Get serializable fairness data for persistence (to be stored alongside replay).
 */
export function getSerializableFairnessData(roomId: string): {
  proofs: FairnessProof[];
  algorithmVersion: number;
} | null {
  const state = matchFairness.get(roomId);
  if (!state) return null;

  return {
    proofs: Array.from(state.proofs.values()),
    algorithmVersion: FAIRNESS_ALGORITHM_VERSION,
  };
}

// ── Card Index Mapping ───────────────────────────────────────────────
// Maps between deck index (0-51) and (suit, rank) pairs.
// This must match the engine's card creation order exactly.

const SUITS = ["♠", "♥", "♦", "♣"] as const;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export function cardIndexToCard(index: number): { suit: string; rank: string } {
  const suitIdx = Math.floor(index / 13);
  const rankIdx = index % 13;
  return { suit: SUITS[suitIdx], rank: RANKS[rankIdx] };
}

export function deckOrderToCards(deckOrder: number[]): { suit: string; rank: string }[] {
  return deckOrder.map(cardIndexToCard);
}

/**
 * Convert a (suit, rank) card to a deck index.
 */
export function cardToIndex(suit: string, rank: string): number {
  const suitIdx = SUITS.indexOf(suit as any);
  const rankIdx = RANKS.indexOf(rank as any);
  if (suitIdx === -1 || rankIdx === -1) return -1;
  return suitIdx * 13 + rankIdx;
}

// ── For testing ──────────────────────────────────────────────────────
export function _clearAllFairness(): void {
  matchFairness.clear();
}
