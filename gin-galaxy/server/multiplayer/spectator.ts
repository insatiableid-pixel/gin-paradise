/**
 * Spectator Module for Gin Paradise.
 *
 * Provides privacy-safe spectator state projection for live matches,
 * durable player spectate preferences, broadcast analytics, and
 * admin featured-match operations.
 *
 * Spectators NEVER see:
 *   - Either player's hand during live play
 *   - Stock card identities
 *   - Any hidden game state
 *
 * Spectators CAN see:
 *   - Player identities and scores
 *   - Whose turn it is
 *   - Discard pile top card (public information)
 *   - Stock/discard counts
 *   - Round/match progression
 *   - Game status and messages
 *   - Revealed hands at showdown (round_over / game_over only)
 *   - Showdown data (melds, deadwood, layoffs, outcome)
 *
 * Spectate Preference Model:
 *   - Tournament matches: ALWAYS public by rule
 *   - High-stakes matches (gold_2000+, sweeps_1): require BOTH players to allow spectating
 *   - Admin-featured: require BOTH players to allow spectating (admin cannot override player consent)
 *   - Ranked (both players ≥1400): require BOTH players to allow spectating
 *   - Free quick-match: NOT eligible (not notable enough)
 *   - Private challenges: NOT eligible (privacy-safe by design)
 *
 * Broadcast Analytics (persisted per match):
 *   - Peak concurrent spectators
 *   - Total unique spectators
 *   - Whether the match was manually admin-featured
 *   - Featured reasons
 *   - Match duration
 */

import crypto from "crypto";
import type { MatchState, Card } from "./engine.js";
import type { CardView, ShowdownData } from "./types.js";
import { db } from "../db.js";

// ── Spectator View (what spectators see) ─────────────────────────────

export interface SpectatorGameView {
  roomId: string;
  player1Username: string;
  player2Username: string;
  player1Score: number;
  player2Score: number;
  /** Which player's turn it is (username) */
  currentTurnUsername: string;
  /** Number of cards in each player's hand (count only, no card data) */
  player1CardCount: number;
  player2CardCount: number;
  /** Top of discard pile — public information */
  topDiscard: CardView | null;
  /** Number of cards remaining in stock */
  stockCount: number;
  /** Number of cards in discard pile */
  discardCount: number;
  /** Current game status */
  status: "playing" | "round_over" | "game_over";
  /** Human-readable game message */
  message: string;
  /** Round number */
  roundNumber: number;
  /** Overall match winner (userId) — null during play */
  winnerId: string | null;
  /** Round winner (userId) — null during play */
  roundWinnerId: string | null;
  /** Points from the current/last round */
  roundPoints: number;
  /** Stake info if staked match */
  stakeInfo?: {
    stakeId: string;
    label: string;
    prizePool: number;
    currency: string;
  } | null;
  /** Showdown data — only present at round_over or game_over */
  showdown?: ShowdownData | null;
}

/**
 * Generate a privacy-safe spectator view of the match.
 * This NEVER exposes either player's hand during live play.
 * Hands are only visible in showdown data at round_over/game_over.
 */
export function getSpectatorView(state: MatchState): SpectatorGameView {
  const p1 = state.players[0];
  const p2 = state.players[1];
  const currentPlayer = state.players[state.currentPlayerIndex];
  const topDiscard = state.discard.length > 0
    ? { suit: state.discard[state.discard.length - 1].suit, rank: state.discard[state.discard.length - 1].rank }
    : null;

  return {
    roomId: state.roomId,
    player1Username: p1.username,
    player2Username: p2.username,
    player1Score: p1.score,
    player2Score: p2.score,
    currentTurnUsername: currentPlayer.username,
    player1CardCount: p1.hand.length,
    player2CardCount: p2.hand.length,
    topDiscard: topDiscard as CardView | null,
    stockCount: state.stock.length,
    discardCount: state.discard.length,
    status: state.status,
    message: state.message,
    roundNumber: state.roundNumber,
    winnerId: state.winnerId,
    roundWinnerId: state.roundWinnerId,
    roundPoints: state.roundPoints,
  };
}

// ── Featured Match Eligibility ───────────────────────────────────────

export type FeaturedReason = "tournament" | "high_stakes" | "featured" | "ranked";

export interface FeaturedMatch {
  roomId: string;
  player1: { username: string; rating: number };
  player2: { username: string; rating: number };
  scores: { player1: number; player2: number };
  roundNumber: number;
  status: "playing" | "round_over" | "game_over";
  reasons: FeaturedReason[];
  stakeInfo?: { label: string; prizePool: number; currency: string } | null;
  spectatorCount: number;
  startedAt: number;
  /** Whether this match was manually admin-featured */
  isAdminFeatured: boolean;
}

/** Rating threshold for "ranked" featured matches */
const RANKED_RATING_THRESHOLD = 1400;

/** Stake IDs considered "high stakes" */
const HIGH_STAKE_IDS = new Set(["gold_2000", "gold_5000", "sweeps_1"]);

// ── In-memory spectator + featured state ─────────────────────────────

/** Admin-featured room IDs */
const adminFeaturedRooms = new Set<string>();

/** Per-room spectator tracking */
const roomSpectators = new Map<string, Set<string>>(); // roomId → Set<spectatorUserId>

/** Per-room broadcast analytics (in-memory during match) */
interface RoomBroadcastStats {
  peakConcurrent: number;
  uniqueSpectators: Set<string>;
  wasAdminFeatured: boolean;
  startedAt: number;
}
const roomBroadcastStats = new Map<string, RoomBroadcastStats>();

export function addAdminFeatured(roomId: string): void {
  adminFeaturedRooms.add(roomId);
  // Track admin-featured status in broadcast stats
  const stats = roomBroadcastStats.get(roomId);
  if (stats) {
    stats.wasAdminFeatured = true;
  }
}

export function removeAdminFeatured(roomId: string): void {
  adminFeaturedRooms.delete(roomId);
}

export function isAdminFeatured(roomId: string): boolean {
  return adminFeaturedRooms.has(roomId);
}

// ── Spectator tracking ───────────────────────────────────────────────

export function addSpectator(roomId: string, userId: string): void {
  if (!roomSpectators.has(roomId)) {
    roomSpectators.set(roomId, new Set());
  }
  roomSpectators.get(roomId)!.add(userId);

  // Update broadcast analytics
  if (!roomBroadcastStats.has(roomId)) {
    roomBroadcastStats.set(roomId, {
      peakConcurrent: 0,
      uniqueSpectators: new Set(),
      wasAdminFeatured: adminFeaturedRooms.has(roomId),
      startedAt: Date.now(),
    });
  }
  const stats = roomBroadcastStats.get(roomId)!;
  stats.uniqueSpectators.add(userId);
  const currentCount = roomSpectators.get(roomId)!.size;
  if (currentCount > stats.peakConcurrent) {
    stats.peakConcurrent = currentCount;
  }
}

export function removeSpectator(roomId: string, userId: string): void {
  const spectators = roomSpectators.get(roomId);
  if (spectators) {
    spectators.delete(userId);
    if (spectators.size === 0) {
      roomSpectators.delete(roomId);
    }
  }
}

export function getSpectatorCount(roomId: string): number {
  return roomSpectators.get(roomId)?.size || 0;
}

export function getRoomSpectatorIds(roomId: string): string[] {
  const spectators = roomSpectators.get(roomId);
  return spectators ? Array.from(spectators) : [];
}

export function cleanupSpectators(roomId: string): void {
  roomSpectators.delete(roomId);
  adminFeaturedRooms.delete(roomId);
}

// ── Broadcast Analytics ──────────────────────────────────────────────

/**
 * Initialize broadcast stats tracking for a room at match start.
 */
export function initBroadcastStats(roomId: string): void {
  roomBroadcastStats.set(roomId, {
    peakConcurrent: 0,
    uniqueSpectators: new Set(),
    wasAdminFeatured: adminFeaturedRooms.has(roomId),
    startedAt: Date.now(),
  });
}

/**
 * Get in-memory broadcast stats for a live room.
 */
export function getLiveBroadcastStats(roomId: string): {
  peakConcurrent: number;
  uniqueSpectators: number;
  currentSpectators: number;
  wasAdminFeatured: boolean;
} | null {
  const stats = roomBroadcastStats.get(roomId);
  if (!stats) return null;
  return {
    peakConcurrent: stats.peakConcurrent,
    uniqueSpectators: stats.uniqueSpectators.size,
    currentSpectators: getSpectatorCount(roomId),
    wasAdminFeatured: stats.wasAdminFeatured,
  };
}

/**
 * Persist broadcast metrics to the database when a match completes.
 * This ensures metrics survive room cleanup.
 */
export function persistBroadcastMetrics(
  roomId: string,
  player1Id: string,
  player1Username: string,
  player2Id: string,
  player2Username: string,
  winnerId: string | null,
  winnerUsername: string | null,
  stakeId: string,
  reasons: FeaturedReason[],
  startedAt: number,
): void {
  const stats = roomBroadcastStats.get(roomId);
  // Only persist if there were actually spectators OR the match was featured
  if (!stats && reasons.length === 0) return;

  const endedAt = Date.now();
  const id = crypto.randomUUID();

  try {
    db.prepare(`
      INSERT INTO broadcast_metrics (
        id, room_id,
        player1_id, player1_username,
        player2_id, player2_username,
        peak_concurrent_spectators, total_unique_spectators,
        was_admin_featured, featured_reasons,
        stake_id, match_duration_seconds,
        winner_id, winner_username,
        started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, roomId,
      player1Id, player1Username,
      player2Id, player2Username,
      stats?.peakConcurrent ?? 0,
      stats?.uniqueSpectators.size ?? 0,
      (stats?.wasAdminFeatured || adminFeaturedRooms.has(roomId)) ? 1 : 0,
      JSON.stringify(reasons),
      stakeId,
      Math.floor((endedAt - startedAt) / 1000),
      winnerId, winnerUsername,
      startedAt, endedAt,
    );
  } catch {
    // Non-critical — don't crash the match
  }

  // Cleanup in-memory stats
  roomBroadcastStats.delete(roomId);
}

/**
 * Clean up in-memory broadcast stats without persisting (e.g., room cleanup without match end).
 */
export function cleanupBroadcastStats(roomId: string): void {
  roomBroadcastStats.delete(roomId);
}

// ── Broadcast Metrics Queries ────────────────────────────────────────

export interface BroadcastMetricRecord {
  id: string;
  room_id: string;
  player1_id: string;
  player1_username: string;
  player2_id: string;
  player2_username: string;
  peak_concurrent_spectators: number;
  total_unique_spectators: number;
  was_admin_featured: number;
  featured_reasons: string;
  stake_id: string | null;
  match_duration_seconds: number | null;
  winner_id: string | null;
  winner_username: string | null;
  started_at: number;
  ended_at: number;
  created_at: string;
}

/**
 * Get recent broadcast metrics for admin dashboard.
 */
export function getRecentBroadcastMetrics(limit: number = 30): BroadcastMetricRecord[] {
  return db.prepare(
    `SELECT * FROM broadcast_metrics ORDER BY ended_at DESC LIMIT ?`
  ).all(limit) as BroadcastMetricRecord[];
}

/**
 * Get broadcast metrics summary for admin.
 */
export function getBroadcastSummary(): {
  totalBroadcasts: number;
  totalUniqueViewers: number;
  peakAllTimeViewers: number;
  adminFeaturedCount: number;
} {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_broadcasts,
      SUM(total_unique_spectators) AS total_unique_viewers,
      MAX(peak_concurrent_spectators) AS peak_all_time,
      SUM(CASE WHEN was_admin_featured = 1 THEN 1 ELSE 0 END) AS admin_featured_count
    FROM broadcast_metrics
  `).get() as any;

  return {
    totalBroadcasts: row?.total_broadcasts ?? 0,
    totalUniqueViewers: row?.total_unique_viewers ?? 0,
    peakAllTimeViewers: row?.peak_all_time ?? 0,
    adminFeaturedCount: row?.admin_featured_count ?? 0,
  };
}

// ── Player Spectate Preferences ──────────────────────────────────────

/**
 * Get a player's spectate preference. Defaults to allowing spectating.
 */
export function getPlayerSpectatePreference(userId: string): boolean {
  const row = db.prepare(
    "SELECT allow_spectating FROM player_spectate_preferences WHERE user_id = ?"
  ).get(userId) as { allow_spectating: number } | undefined;
  // Default: allow spectating if no explicit preference set
  return row ? row.allow_spectating === 1 : true;
}

/**
 * Set a player's spectate preference.
 */
export function setPlayerSpectatePreference(userId: string, allowSpectating: boolean): void {
  db.prepare(`
    INSERT INTO player_spectate_preferences (user_id, allow_spectating, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      allow_spectating = excluded.allow_spectating,
      updated_at = datetime('now')
  `).run(userId, allowSpectating ? 1 : 0);
}

/**
 * Check if both players in a match allow spectating.
 * Tournament matches bypass this check (always public by rule).
 */
export function bothPlayersAllowSpectating(player1Id: string, player2Id: string): boolean {
  return getPlayerSpectatePreference(player1Id) && getPlayerSpectatePreference(player2Id);
}

// ── Featured Match Eligibility ───────────────────────────────────────

/**
 * Determine featured-match reasons for a room.
 * Returns empty array if not eligible.
 *
 * Match type classification:
 *   - Tournament matches: ALWAYS public (no player preference check)
 *   - High-stakes, admin-featured, ranked: require BOTH players to allow spectating
 *   - Free quick-match: NOT eligible
 *   - Private challenges: NOT eligible
 */
export function getFeaturedReasons(
  roomId: string,
  stakeId: string,
  isTournamentMatch: boolean,
  player1Rating: number,
  player2Rating: number,
  player1Id?: string,
  player2Id?: string,
): FeaturedReason[] {
  const reasons: FeaturedReason[] = [];

  // Tournament matches are always eligible (public by rule — no player consent needed)
  if (isTournamentMatch) {
    reasons.push("tournament");
  }

  // For non-tournament reasons, check player spectate preferences
  const playersConsent = player1Id && player2Id
    ? bothPlayersAllowSpectating(player1Id, player2Id)
    : true; // If IDs not provided, skip preference check (backward compat)

  // High-stakes matches — require both players to consent
  if (HIGH_STAKE_IDS.has(stakeId) && playersConsent) {
    reasons.push("high_stakes");
  }

  // Admin-featured — require both players to consent (admin cannot override privacy)
  if (isAdminFeatured(roomId) && playersConsent) {
    reasons.push("featured");
  }

  // High-rated players — require both players to consent
  if (player1Rating >= RANKED_RATING_THRESHOLD && player2Rating >= RANKED_RATING_THRESHOLD && playersConsent) {
    reasons.push("ranked");
  }

  return reasons;
}

/**
 * Check if a room is eligible for spectating (has at least one featured reason).
 */
export function isSpectatable(
  roomId: string,
  stakeId: string,
  isTournamentMatch: boolean,
  player1Rating: number,
  player2Rating: number,
  player1Id?: string,
  player2Id?: string,
): boolean {
  return getFeaturedReasons(roomId, stakeId, isTournamentMatch, player1Rating, player2Rating, player1Id, player2Id).length > 0;
}

// ── Admin Match Operations ───────────────────────────────────────────

export interface LiveMatchInfo {
  roomId: string;
  player1: { userId: string; username: string; rating: number };
  player2: { userId: string; username: string; rating: number };
  status: "waiting" | "playing" | "round_over" | "game_over";
  stakeId: string;
  isTournament: boolean;
  isAdminFeatured: boolean;
  spectatorCount: number;
  reasons: FeaturedReason[];
  isSpectatable: boolean;
  /** Why this match is NOT spectatable (if applicable) */
  ineligibilityReason?: string;
  scores?: { player1: number; player2: number };
  roundNumber?: number;
  startedAt: number;
  broadcastStats?: {
    peakConcurrent: number;
    uniqueSpectators: number;
    currentSpectators: number;
  };
}
