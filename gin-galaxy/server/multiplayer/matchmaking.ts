/**
 * Queue-based Matchmaking System with Rating-Aware Pairing.
 *
 * Responsibilities:
 *  - Queue with duplicate entry prevention
 *  - Rating-aware pairing with expanding Elo bracket
 *  - Clean cancel / disconnect cleanup
 *  - Matchmaking posture: like-rated (tight brackets) vs wider-field (fast matching)
 *  - Timer speed preference carried through to room creation
 *
 * Pairing strategy:
 *  - For each candidate pair, we compute |ratingA - ratingB|.
 *  - Each player has a search bracket that starts narrow (±50 rating)
 *    and expands by 50 every 10 seconds they've been in the queue.
 *  - Two players can be matched if their rating difference is within
 *    BOTH players' current search brackets.
 *  - Among all eligible pairs, pick the closest-rated pair.
 *  - If multiple pairs are equally close, prefer the pair with the
 *    longest combined wait time (FIFO tiebreak).
 */

import { WebSocket } from "ws";
import { getCoordinator } from "./coordinatorFactory.js";

// ── Queue Entry ──────────────────────────────────────────────────────

export type MatchPosture = "like_rated" | "wider_field";

export interface QueueEntry {
  userId: string;
  username: string;
  rating: number;
  ws: WebSocket;
  enqueuedAt: number;
  stakeId: string;
  timerSpeed?: string;
  matchPosture?: MatchPosture;
}

// ── In-memory queue ──────────────────────────────────────────────────

const queue: QueueEntry[] = [];
const queuedUserIds = new Set<string>();

function getSharedCoordinator() {
  try {
    return getCoordinator();
  } catch {
    return null;
  }
}

function mirrorQueueEntry(entry: QueueEntry): void {
  const coord = getSharedCoordinator();
  if (!coord) return;

  coord.enqueueMatchmaking({
    ...entry,
    ws: null,
    nodeId: coord.getNodeId(),
    connected: isWsOpen(entry.ws),
  });
}

function mirrorQueueRemoval(userId: string): void {
  const coord = getSharedCoordinator();
  if (!coord) return;
  coord.dequeueMatchmaking(userId);
}

function mirrorQueueClear(): void {
  const coord = getSharedCoordinator();
  if (!coord) return;
  coord.clearMatchmakingQueue();
}

// ── Match Found Callback ─────────────────────────────────────────────

export type MatchFoundCallback = (
  player1: QueueEntry,
  player2: QueueEntry
) => void;

let onMatchFound: MatchFoundCallback | null = null;

/**
 * Register the callback that the room manager will use to create
 * a room when two players are matched.
 */
export function setMatchFoundCallback(cb: MatchFoundCallback) {
  onMatchFound = cb;
}

// ── Rating-Aware Constants ───────────────────────────────────────────

/** Base search bracket (± this many rating points). */
const BASE_BRACKET = 50;

/** Bracket expands by this many points per expansion step. */
const BRACKET_EXPANSION = 50;

/** Seconds between each bracket expansion. */
const EXPANSION_INTERVAL_SECONDS = 10;

/** Maximum search bracket (after this, match anyone). */
const MAX_BRACKET = 1000;

/**
 * Calculate the current search bracket for a player based on wait time.
 */
function getSearchBracket(entry: QueueEntry): number {
  const waitSeconds = (Date.now() - entry.enqueuedAt) / 1000;
  const expansionRate = entry.matchPosture === "wider_field" ? BRACKET_EXPANSION * 2 : BRACKET_EXPANSION;
  const expansions = Math.floor(waitSeconds / EXPANSION_INTERVAL_SECONDS);
  return Math.min(BASE_BRACKET + expansions * expansionRate, MAX_BRACKET);
}

// ── Queue Operations ─────────────────────────────────────────────────

export interface QueueResult {
  ok: boolean;
  error?: string;
  position?: number;
}

/**
 * Add a player to the matchmaking queue.
 * Returns an error if the player is already queued.
 */
export function joinQueue(
  userId: string,
  username: string,
  rating: number,
  ws: WebSocket,
  stakeId: string = "free",
  timerSpeed: string = "medium",
  matchPosture: MatchPosture = "like_rated"
): QueueResult {
  const coord = getSharedCoordinator();
  if (queuedUserIds.has(userId) || coord?.isMatchmakingQueued(userId)) {
    return { ok: false, error: "Already in matchmaking queue." };
  }

  const entry: QueueEntry = {
    userId,
    username,
    rating,
    ws,
    enqueuedAt: Date.now(),
    stakeId,
    timerSpeed,
    matchPosture,
  };

  queue.push(entry);
  queuedUserIds.add(userId);
  mirrorQueueEntry(entry);

  // Try to form a match immediately
  tryPair();

  // Return position (1-indexed) — may already be 0 if just paired
  const pos = queue.findIndex((e) => e.userId === userId);
  return { ok: true, position: pos >= 0 ? pos + 1 : 0 };
}

/**
 * Remove a player from the matchmaking queue.
 * Idempotent — does nothing if the player is not queued.
 */
export function leaveQueue(userId: string): QueueResult {
  const idx = queue.findIndex((e) => e.userId === userId);
  if (idx === -1) {
    const coord = getSharedCoordinator();
    if (coord?.isMatchmakingQueued(userId)) {
      coord.dequeueMatchmaking(userId);
      return { ok: true };
    }
    return { ok: false, error: "Not in matchmaking queue." };
  }

  queue.splice(idx, 1);
  queuedUserIds.delete(userId);
  mirrorQueueRemoval(userId);
  return { ok: true };
}

/**
 * Check if a player is currently in the queue.
 */
export function isInQueue(userId: string): boolean {
  const coord = getSharedCoordinator();
  return coord?.isMatchmakingQueued(userId) ?? queuedUserIds.has(userId);
}

/**
 * Get the current queue size (for diagnostics / UI).
 */
export function getQueueSize(): number {
  const coord = getSharedCoordinator();
  return coord?.getMatchmakingQueueSize() ?? queue.length;
}

// ── Pairing Logic (Rating-Aware Expanding Bracket) ──────────────────

/**
 * Rating-aware pairing with expanding brackets.
 *
 * For each candidate pair (i, j), check:
 *  1. Both WebSockets are still open
 *  2. |rating_i - rating_j| <= min(bracket_i, bracket_j)
 *
 * Among all eligible pairs, pick the pair with the smallest rating gap.
 * Ties are broken by combined wait time (longest wait wins → FIFO behavior).
 */
function tryPair() {
  // Remove disconnected entries first
  purgeDisconnected();

  while (queue.length >= 2 && onMatchFound) {
    let bestPair: [number, number] | null = null;
    let bestRatingGap = Infinity;
    let bestCombinedWait = -1;

    for (let i = 0; i < queue.length; i++) {
      for (let j = i + 1; j < queue.length; j++) {
        const a = queue[i];
        const b = queue[j];

        // Stake compatibility: only pair players with the same stake level
        if (a.stakeId !== b.stakeId) continue;

        const ratingGap = Math.abs(a.rating - b.rating);
        const bracketA = getSearchBracket(a);
        const bracketB = getSearchBracket(b);

        // Both players must accept the gap
        if (ratingGap > bracketA || ratingGap > bracketB) continue;

        // Check if websockets are alive
        if (!isWsOpen(a.ws) || !isWsOpen(b.ws)) continue;

        const combinedWait = (Date.now() - a.enqueuedAt) + (Date.now() - b.enqueuedAt);

        // Prefer smallest rating gap, then longest combined wait
        if (ratingGap < bestRatingGap || (ratingGap === bestRatingGap && combinedWait > bestCombinedWait)) {
          bestPair = [i, j];
          bestRatingGap = ratingGap;
          bestCombinedWait = combinedWait;
        }
      }
    }

    if (!bestPair) break; // No eligible pair found

    // Remove them from queue (remove higher index first to preserve lower index)
    const [idx1, idx2] = bestPair;
    const p2 = queue.splice(idx2, 1)[0];
    const p1 = queue.splice(idx1, 1)[0];
    queuedUserIds.delete(p1.userId);
    queuedUserIds.delete(p2.userId);
    mirrorQueueRemoval(p1.userId);
    mirrorQueueRemoval(p2.userId);

    onMatchFound(p1, p2);
  }
}

function isWsOpen(ws: WebSocket): boolean {
  return ws.readyState === WebSocket.OPEN;
}

/**
 * Remove entries whose WebSocket is no longer open.
 */
function purgeDisconnected() {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!isWsOpen(queue[i].ws)) {
      queuedUserIds.delete(queue[i].userId);
      mirrorQueueRemoval(queue[i].userId);
      queue.splice(i, 1);
    }
  }
}

/**
 * Handle a player disconnecting — remove from queue if present.
 * Called by the room manager on WebSocket close.
 */
export function handleDisconnect(userId: string) {
  leaveQueue(userId);
}

// ── Periodic cleanup (stale entries, lost connections) ────────────────

const QUEUE_STALE_TTL = 5 * 60 * 1000; // 5 minutes max time in queue

setInterval(() => {
  const now = Date.now();
  for (let i = queue.length - 1; i >= 0; i--) {
    const entry = queue[i];
    if (now - entry.enqueuedAt > QUEUE_STALE_TTL || !isWsOpen(entry.ws)) {
      // Notify timed-out player if still connected
      if (isWsOpen(entry.ws)) {
        try {
          entry.ws.send(
            JSON.stringify({
              type: "queue_timeout",
              message: "Matchmaking queue timed out. Please try again.",
            })
          );
        } catch {
          // ignore send errors
        }
      }
      queuedUserIds.delete(entry.userId);
      mirrorQueueRemoval(entry.userId);
      queue.splice(i, 1);
    }
  }
}, 30_000).unref();

// ── Exported for testing ─────────────────────────────────────────────

export function _getQueue(): QueueEntry[] {
  return queue;
}

export function _clearQueue() {
  queue.length = 0;
  queuedUserIds.clear();
  mirrorQueueClear();
}

// Export bracket calculation for testing
export { getSearchBracket as _getSearchBracket, BASE_BRACKET, BRACKET_EXPANSION, EXPANSION_INTERVAL_SECONDS };
