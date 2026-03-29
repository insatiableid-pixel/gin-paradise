/**
 * Match Transcript / Action Ledger.
 *
 * Records a chronological, structured transcript for every multiplayer
 * match played through the server. Transcripts are persisted in-memory
 * with an export function for later SQLite migration or file dump.
 *
 * Each transcript captures:
 *  - players, room ID, match start time
 *  - round boundaries (deal / start)
 *  - draw source & acting player
 *  - discard events
 *  - knock, gin, undercut, round end, match end
 *  - timeout, disconnect, leave, forfeit outcomes
 *  - sequence number & timestamp per action
 *
 * Transcripts are persisted to SQLite on finalization for durable replay access.
 */

import { persistReplay } from "../db.js";
import { enqueueJob } from "../outbox.js";

// ── Action Types ────────────────────────────────────────────────────

export type TranscriptActionType =
  | "match_start"
  | "round_start"
  | "draw"
  | "discard"
  | "knock"
  | "gin"
  | "undercut"
  | "round_end"
  | "match_end"
  | "timeout"
  | "disconnect"
  | "leave"
  | "forfeit"
  | "next_round";

export interface TranscriptAction {
  seq: number;
  timestamp: number;
  type: TranscriptActionType;
  playerId?: string;
  playerUsername?: string;
  detail?: Record<string, unknown>;
}

export interface MatchTranscript {
  roomId: string;
  players: { userId: string; username: string }[];
  startedAt: number;
  endedAt: number | null;
  actions: TranscriptAction[];
  outcome: {
    winnerId: string | null;
    winnerUsername: string | null;
    loserId: string | null;
    loserUsername: string | null;
    winnerScore: number;
    loserScore: number;
    endReason: "completed" | "forfeit" | "timeout" | "disconnect" | null;
  } | null;
}

// ── In-memory transcript store ──────────────────────────────────────

const transcripts = new Map<string, MatchTranscript>();

/**
 * Create a new transcript for a match.
 */
export function createTranscript(
  roomId: string,
  players: { userId: string; username: string }[]
): MatchTranscript {
  const transcript: MatchTranscript = {
    roomId,
    players: players.map((p) => ({ userId: p.userId, username: p.username })),
    startedAt: Date.now(),
    endedAt: null,
    actions: [],
    outcome: null,
  };

  transcripts.set(roomId, transcript);

  // Record match start
  addAction(roomId, "match_start", undefined, undefined, {
    players: players.map((p) => p.username),
  });

  return transcript;
}

/**
 * Add a chronological action to a transcript.
 */
export function addAction(
  roomId: string,
  type: TranscriptActionType,
  playerId?: string,
  playerUsername?: string,
  detail?: Record<string, unknown>
): void {
  const transcript = transcripts.get(roomId);
  if (!transcript) return;

  transcript.actions.push({
    seq: transcript.actions.length + 1,
    timestamp: Date.now(),
    type,
    playerId,
    playerUsername,
    detail,
  });
}

/**
 * Record a round start event.
 */
export function recordRoundStart(
  roomId: string,
  roundNumber: number,
  firstPlayerId: string,
  firstPlayerUsername: string
): void {
  addAction(roomId, "round_start", firstPlayerId, firstPlayerUsername, {
    roundNumber,
  });
}

/**
 * Record a draw event.
 */
export function recordDraw(
  roomId: string,
  playerId: string,
  playerUsername: string,
  source: "stock" | "discard",
  card?: { suit: string; rank: string }
): void {
  addAction(roomId, "draw", playerId, playerUsername, {
    source,
    ...(card ? { card: `${card.rank}${card.suit}` } : {}),
  });
}

/**
 * Record a discard event.
 */
export function recordDiscard(
  roomId: string,
  playerId: string,
  playerUsername: string,
  card: { suit: string; rank: string }
): void {
  addAction(roomId, "discard", playerId, playerUsername, {
    card: `${card.rank}${card.suit}`,
  });
}

/**
 * Record a knock/gin/undercut outcome.
 */
export function recordKnockOutcome(
  roomId: string,
  knockerId: string,
  knockerUsername: string,
  outcomeType: "knock" | "gin" | "undercut",
  winnerId: string,
  winnerUsername: string,
  points: number,
  knockerDeadwood: number,
  opponentDeadwood: number,
  discardedCard: { suit: string; rank: string }
): void {
  // Record the knock action itself
  addAction(roomId, outcomeType, knockerId, knockerUsername, {
    discardedCard: `${discardedCard.rank}${discardedCard.suit}`,
    knockerDeadwood,
    opponentDeadwood,
    winnerId,
    winnerUsername,
    points,
  });

  // Record round end
  addAction(roomId, "round_end", winnerId, winnerUsername, {
    points,
    outcomeType,
  });
}

/**
 * Finalize a transcript when the match ends.
 */
export function finalizeTranscript(
  roomId: string,
  winnerId: string,
  winnerUsername: string,
  loserId: string,
  loserUsername: string,
  winnerScore: number,
  loserScore: number,
  endReason: "completed" | "forfeit" | "timeout" | "disconnect",
  fairnessData?: any
): void {
  const transcript = transcripts.get(roomId);
  if (!transcript) return;

  transcript.endedAt = Date.now();
  transcript.outcome = {
    winnerId,
    winnerUsername,
    loserId,
    loserUsername,
    winnerScore,
    loserScore,
    endReason,
  };

  addAction(roomId, "match_end", winnerId, winnerUsername, {
    winnerScore,
    loserScore,
    endReason,
  });

  // ── AUTHORITATIVE SYNCHRONOUS WRITE ──
  // Persist replay to durable storage (SQLite). This is the system-of-record
  // for match transcripts. Must succeed synchronously.
  try {
    const replayId = persistReplay(transcript, fairnessData);

    // ── DERIVED ASYNC WRITES (via durable outbox) ──
    // These are retryable, eventually-consistent side effects.
    // They never block or fail the hot path.

    // 1. Queue replay auto-evaluation (Python engine, ~30s)
    enqueueJob({
      jobType: "replay_auto_evaluation",
      payload: { replayId },
      dedupKey: `eval:${replayId}`,
      delayMs: 2000, // Brief delay for finalization to settle
    });

    // 2. Queue achievement evaluation for both players
    enqueueJob({
      jobType: "achievement_trigger",
      payload: { userId: winnerId, trigger: "match_completion" },
      dedupKey: `ach:${winnerId}:${replayId}`,
    });
    enqueueJob({
      jobType: "achievement_trigger",
      payload: { userId: loserId, trigger: "match_completion" },
      dedupKey: `ach:${loserId}:${replayId}`,
    });
  } catch (err) {
    console.error(`[transcript] Failed to persist replay for room ${roomId}:`, err);
  }
}

/**
 * Record a timeout event.
 */
export function recordTimeout(
  roomId: string,
  timedOutPlayerId: string,
  timedOutPlayerUsername: string
): void {
  addAction(roomId, "timeout", timedOutPlayerId, timedOutPlayerUsername);
}

/**
 * Record a disconnect event.
 */
export function recordDisconnect(
  roomId: string,
  playerId: string,
  playerUsername: string
): void {
  addAction(roomId, "disconnect", playerId, playerUsername);
}

/**
 * Record a leave/forfeit event.
 */
export function recordForfeit(
  roomId: string,
  playerId: string,
  playerUsername: string,
  reason: "leave" | "timeout" | "disconnect"
): void {
  addAction(roomId, "forfeit", playerId, playerUsername, { reason });
}

// ── Query / Export ───────────────────────────────────────────────────

/**
 * Get the transcript for a room.
 */
export function getTranscript(roomId: string): MatchTranscript | undefined {
  return transcripts.get(roomId);
}

/**
 * Get all stored transcripts (for testing/export).
 */
export function getAllTranscripts(): Map<string, MatchTranscript> {
  return transcripts;
}

/**
 * Clear all transcripts (for testing).
 */
export function _clearTranscripts(): void {
  transcripts.clear();
}
