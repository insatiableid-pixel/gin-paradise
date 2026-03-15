/**
 * Social Model for Gin Paradise.
 *
 * Lightweight competitive follow model, direct challenge system, and
 * challenge-to-match activation layer.
 *
 * Follow Model:
 *  - One-directional follow (not mutual friendship)
 *  - Follow/unfollow from public competitive surfaces
 *  - Counts exposed publicly; full lists only to the follower
 *
 * Challenge Model:
 *  - Direct player-to-player challenge
 *  - States: pending → accepted / declined / expired / cancelled
 *  - Auto-expire after 5 minutes
 *  - Only one active outbound challenge per challenger→target pair
 *  - Accepted challenges allocate a private room for match handoff
 *
 * Rematch Model:
 *  - After a completed heads-up match, either player can propose rematch
 *  - Both must opt-in before a new match starts
 *  - Same format reuse (stake, etc.) if still valid
 *  - Accepted rematches allocate a new private room
 *
 * Availability Model:
 *  - Lightweight player status: online / in_match / in_queue / offline
 *  - Derived from in-memory room and queue state
 *  - No persistent presence infrastructure required
 */

import crypto from "crypto";
import { db } from "./db.js";
import { checkBalance } from "./escrow.js";

// ── Types ──────────────────────────────────────────────────────────

export interface Follow {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: number;
}

export interface Challenge {
  id: string;
  challengerId: string;
  challengerUsername: string;
  targetId: string;
  targetUsername: string;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  stakeId: string;
  message: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  /** Room ID allocated on acceptance — the live match destination */
  roomId: string | null;
}

export interface Rematch {
  id: string;
  challengeId: string | null;
  player1Id: string;
  player1Username: string;
  player2Id: string;
  player2Username: string;
  proposerId: string;
  status: "proposed" | "accepted" | "declined" | "expired";
  stakeId: string;
  roomId: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export type PlayerAvailability = "online" | "in_match" | "in_queue" | "offline";

export interface SocialNotification {
  id: string;
  userId: string;
  type: "challenge_received" | "challenge_accepted" | "challenge_declined" | "challenge_expired" | "match_ready" | "rematch_received" | "rematch_accepted" | "new_follower";
  referenceId: string | null;
  fromUserId: string | null;
  fromUsername: string | null;
  message: string;
  read: boolean;
  createdAt: number;
}

// ── Database Setup ─────────────────────────────────────────────────

/** Challenge expiry TTL — 5 minutes */
export const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000;

/** Accepted challenge room TTL — 10 minutes before room allocation expires */
export const CHALLENGE_ROOM_TTL_MS = 10 * 60 * 1000;

/** Accepted rematch room TTL — 5 minutes before room allocation expires */
export const REMATCH_ROOM_TTL_MS = 5 * 60 * 1000;

/** Maximum active outbound challenges per user */
const MAX_ACTIVE_CHALLENGES = 5;

export function initializeSocialTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(follower_id, following_id),
      FOREIGN KEY(follower_id) REFERENCES users(id),
      FOREIGN KEY(following_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
    CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      challenger_id TEXT NOT NULL,
      challenger_username TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_username TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','expired','cancelled')),
      stake_id TEXT NOT NULL DEFAULT 'free',
      message TEXT,
      room_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(challenger_id) REFERENCES users(id),
      FOREIGN KEY(target_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_challenges_target ON challenges(target_id, status);
    CREATE INDEX IF NOT EXISTS idx_challenges_challenger ON challenges(challenger_id, status);
    CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
    CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at);

    CREATE TABLE IF NOT EXISTS rematches (
      id TEXT PRIMARY KEY,
      challenge_id TEXT,
      player1_id TEXT NOT NULL,
      player1_username TEXT NOT NULL,
      player2_id TEXT NOT NULL,
      player2_username TEXT NOT NULL,
      proposer_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','declined','expired')),
      stake_id TEXT NOT NULL DEFAULT 'free',
      room_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(player1_id) REFERENCES users(id),
      FOREIGN KEY(player2_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rematches_players ON rematches(player1_id, player2_id, status);
    CREATE INDEX IF NOT EXISTS idx_rematches_status ON rematches(status);

    CREATE TABLE IF NOT EXISTS social_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      reference_id TEXT,
      from_user_id TEXT,
      from_username TEXT,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_social_notif_user ON social_notifications(user_id, read, created_at DESC);
  `);

  // Migration: add room_id column to challenges if missing
  try {
    db.exec("ALTER TABLE challenges ADD COLUMN room_id TEXT");
  } catch { /* column already exists */ }
}

// ── Follow Operations ──────────────────────────────────────────────

export function followPlayer(followerId: string, followingId: string): { ok: boolean; error?: string } {
  if (followerId === followingId) {
    return { ok: false, error: "Cannot follow yourself" };
  }

  // Check target exists
  const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(followingId) as { id: string; username: string } | undefined;
  if (!target) {
    return { ok: false, error: "Player not found" };
  }

  // Check not already following
  const existing = db.prepare(
    "SELECT id FROM follows WHERE follower_id = ? AND following_id = ?"
  ).get(followerId, followingId);
  if (existing) {
    return { ok: false, error: "Already following this player" };
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO follows (id, follower_id, following_id, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, followerId, followingId, now);

  // Create notification for the followed player
  const follower = db.prepare("SELECT username FROM users WHERE id = ?").get(followerId) as { username: string } | undefined;
  if (follower) {
    createSocialNotification(
      followingId,
      "new_follower",
      id,
      followerId,
      follower.username,
      `${follower.username} started following you`
    );
  }

  return { ok: true };
}

export function unfollowPlayer(followerId: string, followingId: string): { ok: boolean; error?: string } {
  const result = db.prepare(
    "DELETE FROM follows WHERE follower_id = ? AND following_id = ?"
  ).run(followerId, followingId);

  if (result.changes === 0) {
    return { ok: false, error: "Not following this player" };
  }
  return { ok: true };
}

export function isFollowing(followerId: string, followingId: string): boolean {
  const row = db.prepare(
    "SELECT id FROM follows WHERE follower_id = ? AND following_id = ?"
  ).get(followerId, followingId);
  return !!row;
}

export function getFollowerCount(userId: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) as cnt FROM follows WHERE following_id = ?"
  ).get(userId) as any;
  return row?.cnt || 0;
}

export function getFollowingCount(userId: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) as cnt FROM follows WHERE follower_id = ?"
  ).get(userId) as any;
  return row?.cnt || 0;
}

export function getFollowers(userId: string, limit = 50): { userId: string; username: string; followedAt: number }[] {
  return db.prepare(`
    SELECT f.follower_id as userId, u.username, f.created_at as followedAt
    FROM follows f
    INNER JOIN users u ON u.id = f.follower_id
    WHERE f.following_id = ?
    ORDER BY f.created_at DESC
    LIMIT ?
  `).all(userId, limit) as any[];
}

export function getFollowing(userId: string, limit = 50): { userId: string; username: string; followedAt: number }[] {
  return db.prepare(`
    SELECT f.following_id as userId, u.username, f.created_at as followedAt
    FROM follows f
    INNER JOIN users u ON u.id = f.following_id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
    LIMIT ?
  `).all(userId, limit) as any[];
}

// ── Challenge Operations ───────────────────────────────────────────

/**
 * Expire any challenges past their expiry time.
 * Call this before querying challenges for freshness.
 */
export function expirePendingChallenges(): number {
  const now = Date.now();
  const result = db.prepare(
    "UPDATE challenges SET status = 'expired', updated_at = ? WHERE status = 'pending' AND expires_at <= ?"
  ).run(now, now);

  // Create notifications for expired challenges
  if (result.changes > 0) {
    const expired = db.prepare(
      "SELECT id, challenger_id, challenger_username, target_id, target_username FROM challenges WHERE status = 'expired' AND updated_at = ?"
    ).all(now) as any[];

    for (const ch of expired) {
      createSocialNotification(
        ch.challenger_id,
        "challenge_expired",
        ch.id,
        ch.target_id,
        ch.target_username,
        `Your challenge to ${ch.target_username} has expired`
      );
    }
  }

  return result.changes;
}

export function createChallenge(
  challengerId: string,
  challengerUsername: string,
  targetId: string,
  stakeId = "free",
  message: string | null = null,
): { ok: boolean; challenge?: Challenge; error?: string } {
  if (challengerId === targetId) {
    return { ok: false, error: "Cannot challenge yourself" };
  }

  // Expire old challenges first
  expirePendingChallenges();

  // Check target exists
  const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(targetId) as { id: string; username: string } | undefined;
  if (!target) {
    return { ok: false, error: "Player not found" };
  }

  // Check no duplicate active challenge to same target
  const existing = db.prepare(
    "SELECT id FROM challenges WHERE challenger_id = ? AND target_id = ? AND status = 'pending'"
  ).get(challengerId, targetId);
  if (existing) {
    return { ok: false, error: "You already have a pending challenge to this player" };
  }

  // Check max active outbound challenges
  const activeCount = (db.prepare(
    "SELECT COUNT(*) as cnt FROM challenges WHERE challenger_id = ? AND status = 'pending'"
  ).get(challengerId) as any)?.cnt || 0;
  if (activeCount >= MAX_ACTIVE_CHALLENGES) {
    return { ok: false, error: "Too many active challenges. Cancel one first." };
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const expiresAt = now + CHALLENGE_EXPIRY_MS;

  db.prepare(`
    INSERT INTO challenges (id, challenger_id, challenger_username, target_id, target_username, status, stake_id, message, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(id, challengerId, challengerUsername, targetId, target.username, stakeId, message, now, now, expiresAt);

  const challenge = getChallengeById(id)!;

  // Notify the target
  createSocialNotification(
    targetId,
    "challenge_received",
    id,
    challengerId,
    challengerUsername,
    `${challengerUsername} challenged you to a match!`
  );

  return { ok: true, challenge };
}

export function acceptChallenge(challengeId: string, userId: string): { ok: boolean; challenge?: Challenge; roomId?: string; error?: string } {
  expirePendingChallenges();

  const challenge = getChallengeById(challengeId);
  if (!challenge) {
    return { ok: false, error: "Challenge not found" };
  }
  if (challenge.targetId !== userId) {
    return { ok: false, error: "Not your challenge to accept" };
  }
  if (challenge.status !== "pending") {
    return { ok: false, error: `Challenge is ${challenge.status}` };
  }

  // Validate balance for staked challenges
  if (challenge.stakeId && challenge.stakeId !== "free") {
    const challengerBalance = checkBalance(challenge.challengerId, challenge.stakeId);
    if (!challengerBalance.canAfford) {
      return { ok: false, error: `${challenge.challengerUsername} can no longer afford this stake (need ${challengerBalance.required} ${challengerBalance.currency === "sweeps_coins" ? "Sweeps" : "Gold"}, have ${challengerBalance.balance})` };
    }
    const targetBalance = checkBalance(userId, challenge.stakeId);
    if (!targetBalance.canAfford) {
      return { ok: false, error: `Insufficient balance to accept this staked challenge (need ${targetBalance.required} ${targetBalance.currency === "sweeps_coins" ? "Sweeps" : "Gold"}, have ${targetBalance.balance})` };
    }
  }

  // Allocate a room ID for the match handoff
  const roomId = generateChallengeRoomId();
  const now = Date.now();
  db.prepare(
    "UPDATE challenges SET status = 'accepted', room_id = ?, updated_at = ? WHERE id = ?"
  ).run(roomId, now, challengeId);

  // Notify challenger that match is ready — include stake info
  const stakeLabel = (challenge.stakeId && challenge.stakeId !== "free") ? ` (${challenge.stakeId})` : "";
  createSocialNotification(
    challenge.challengerId,
    "match_ready",
    challengeId,
    userId,
    challenge.targetUsername,
    `${challenge.targetUsername} accepted your challenge${stakeLabel}! Join the match now.`
  );

  // Also send standard acceptance notification
  createSocialNotification(
    challenge.challengerId,
    "challenge_accepted",
    challengeId,
    userId,
    challenge.targetUsername,
    `${challenge.targetUsername} accepted your challenge!`
  );

  return { ok: true, challenge: getChallengeById(challengeId)!, roomId };
}

export function declineChallenge(challengeId: string, userId: string): { ok: boolean; error?: string } {
  const challenge = getChallengeById(challengeId);
  if (!challenge) {
    return { ok: false, error: "Challenge not found" };
  }
  if (challenge.targetId !== userId) {
    return { ok: false, error: "Not your challenge to decline" };
  }
  if (challenge.status !== "pending") {
    return { ok: false, error: `Challenge is ${challenge.status}` };
  }

  const now = Date.now();
  db.prepare(
    "UPDATE challenges SET status = 'declined', updated_at = ? WHERE id = ?"
  ).run(now, challengeId);

  // Notify challenger
  createSocialNotification(
    challenge.challengerId,
    "challenge_declined",
    challengeId,
    userId,
    challenge.targetUsername,
    `${challenge.targetUsername} declined your challenge`
  );

  return { ok: true };
}

export function cancelChallenge(challengeId: string, userId: string): { ok: boolean; error?: string } {
  const challenge = getChallengeById(challengeId);
  if (!challenge) {
    return { ok: false, error: "Challenge not found" };
  }
  if (challenge.challengerId !== userId) {
    return { ok: false, error: "Not your challenge to cancel" };
  }
  if (challenge.status !== "pending") {
    return { ok: false, error: `Challenge is ${challenge.status}` };
  }

  const now = Date.now();
  db.prepare(
    "UPDATE challenges SET status = 'cancelled', updated_at = ? WHERE id = ?"
  ).run(now, challengeId);

  return { ok: true };
}

export function getChallengeById(id: string): Challenge | null {
  const row = db.prepare("SELECT * FROM challenges WHERE id = ?").get(id) as any;
  return row ? formatChallenge(row) : null;
}

export function getPendingChallengesForUser(userId: string): Challenge[] {
  expirePendingChallenges();
  const rows = db.prepare(
    "SELECT * FROM challenges WHERE target_id = ? AND status = 'pending' ORDER BY created_at DESC"
  ).all(userId) as any[];
  return rows.map(formatChallenge);
}

export function getOutboundChallenges(userId: string): Challenge[] {
  expirePendingChallenges();
  const rows = db.prepare(
    "SELECT * FROM challenges WHERE challenger_id = ? AND status = 'pending' ORDER BY created_at DESC"
  ).all(userId) as any[];
  return rows.map(formatChallenge);
}

export function getChallengeHistory(userId: string, limit = 20): Challenge[] {
  const rows = db.prepare(`
    SELECT * FROM challenges
    WHERE challenger_id = ? OR target_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(userId, userId, limit) as any[];
  return rows.map(formatChallenge);
}

/**
 * Get head-to-head record between two players.
 * Only uses replay data — no private info exposed.
 */
export function getHeadToHead(userId: string, opponentId: string): { wins: number; losses: number; total: number; lastPlayed: number | null } {
  const rows = db.prepare(`
    SELECT winner_id, ended_at FROM replays
    WHERE (player1_id = ? AND player2_id = ?) OR (player1_id = ? AND player2_id = ?)
    ORDER BY ended_at DESC
  `).all(userId, opponentId, opponentId, userId) as { winner_id: string | null; ended_at: number }[];

  let wins = 0;
  let losses = 0;
  for (const r of rows) {
    if (r.winner_id === userId) wins++;
    else if (r.winner_id === opponentId) losses++;
  }

  return {
    wins,
    losses,
    total: rows.length,
    lastPlayed: rows.length > 0 ? rows[0].ended_at : null,
  };
}

function formatChallenge(row: any): Challenge {
  return {
    id: row.id,
    challengerId: row.challenger_id,
    challengerUsername: row.challenger_username,
    targetId: row.target_id,
    targetUsername: row.target_username,
    status: row.status,
    stakeId: row.stake_id,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    roomId: row.room_id || null,
  };
}

/** Generate a 6-character room code for challenge rooms */
function generateChallengeRoomId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "CH-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── Rematch Operations ─────────────────────────────────────────────

/** Rematch expiry TTL — 3 minutes */
export const REMATCH_EXPIRY_MS = 3 * 60 * 1000;

/**
 * Expire any rematches past their expiry time.
 */
export function expirePendingRematches(): number {
  const now = Date.now();
  const result = db.prepare(
    "UPDATE rematches SET status = 'expired', updated_at = ? WHERE status = 'proposed' AND expires_at <= ?"
  ).run(now, now);
  return result.changes;
}

export function proposeRematch(
  proposerId: string,
  opponentId: string,
  stakeId = "free",
  originalChallengeId: string | null = null,
): { ok: boolean; rematch?: Rematch; error?: string } {
  if (proposerId === opponentId) {
    return { ok: false, error: "Cannot rematch yourself" };
  }

  expirePendingRematches();

  // Check opponent exists
  const opponent = db.prepare("SELECT id, username FROM users WHERE id = ?").get(opponentId) as { id: string; username: string } | undefined;
  if (!opponent) {
    return { ok: false, error: "Player not found" };
  }

  const proposer = db.prepare("SELECT id, username FROM users WHERE id = ?").get(proposerId) as { id: string; username: string } | undefined;
  if (!proposer) {
    return { ok: false, error: "Player not found" };
  }

  // Check no duplicate pending rematch between these two
  const existing = db.prepare(
    "SELECT id FROM rematches WHERE ((player1_id = ? AND player2_id = ?) OR (player1_id = ? AND player2_id = ?)) AND status = 'proposed'"
  ).get(proposerId, opponentId, opponentId, proposerId);
  if (existing) {
    return { ok: false, error: "A rematch is already pending between you two" };
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const expiresAt = now + REMATCH_EXPIRY_MS;

  db.prepare(`
    INSERT INTO rematches (id, challenge_id, player1_id, player1_username, player2_id, player2_username, proposer_id, status, stake_id, room_id, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, NULL, ?, ?, ?)
  `).run(id, originalChallengeId, proposerId, proposer.username, opponentId, opponent.username, proposerId, stakeId, now, now, expiresAt);

  const rematch = getRematchById(id)!;

  // Notify the opponent
  createSocialNotification(
    opponentId,
    "rematch_received",
    id,
    proposerId,
    proposer.username,
    `${proposer.username} wants a rematch!`
  );

  return { ok: true, rematch };
}

export function acceptRematch(rematchId: string, userId: string): { ok: boolean; rematch?: Rematch; roomId?: string; error?: string } {
  expirePendingRematches();

  const rematch = getRematchById(rematchId);
  if (!rematch) {
    return { ok: false, error: "Rematch not found" };
  }

  // Only the non-proposer can accept
  if (rematch.proposerId === userId) {
    return { ok: false, error: "Cannot accept your own rematch proposal" };
  }

  // Must be one of the two players
  if (rematch.player1Id !== userId && rematch.player2Id !== userId) {
    return { ok: false, error: "Not your rematch to accept" };
  }

  if (rematch.status !== "proposed") {
    return { ok: false, error: `Rematch is ${rematch.status}` };
  }

  // Validate balance for staked rematches
  if (rematch.stakeId && rematch.stakeId !== "free") {
    const p1Balance = checkBalance(rematch.player1Id, rematch.stakeId);
    if (!p1Balance.canAfford) {
      return { ok: false, error: `${rematch.player1Username} can no longer afford this stake (need ${p1Balance.required} ${p1Balance.currency === "sweeps_coins" ? "Sweeps" : "Gold"}, have ${p1Balance.balance})` };
    }
    const p2Balance = checkBalance(rematch.player2Id, rematch.stakeId);
    if (!p2Balance.canAfford) {
      return { ok: false, error: `${rematch.player2Username} can no longer afford this stake (need ${p2Balance.required} ${p2Balance.currency === "sweeps_coins" ? "Sweeps" : "Gold"}, have ${p2Balance.balance})` };
    }
  }

  // Allocate a room ID
  const roomId = generateChallengeRoomId();
  const now = Date.now();
  db.prepare(
    "UPDATE rematches SET status = 'accepted', room_id = ?, updated_at = ? WHERE id = ?"
  ).run(roomId, now, rematchId);

  // Notify the proposer
  const accepterUsername = rematch.player1Id === userId ? rematch.player1Username : rematch.player2Username;
  const stakeLabel = (rematch.stakeId && rematch.stakeId !== "free") ? ` (${rematch.stakeId})` : "";
  createSocialNotification(
    rematch.proposerId,
    "rematch_accepted",
    rematchId,
    userId,
    accepterUsername,
    `${accepterUsername} accepted your rematch${stakeLabel}! Join the match now.`
  );

  // Also send match_ready
  createSocialNotification(
    rematch.proposerId,
    "match_ready",
    rematchId,
    userId,
    accepterUsername,
    `Rematch is ready${stakeLabel}! Join the match now.`
  );

  return { ok: true, rematch: getRematchById(rematchId)!, roomId };
}

export function declineRematch(rematchId: string, userId: string): { ok: boolean; error?: string } {
  const rematch = getRematchById(rematchId);
  if (!rematch) {
    return { ok: false, error: "Rematch not found" };
  }
  if (rematch.player1Id !== userId && rematch.player2Id !== userId) {
    return { ok: false, error: "Not your rematch to decline" };
  }
  if (rematch.status !== "proposed") {
    return { ok: false, error: `Rematch is ${rematch.status}` };
  }

  const now = Date.now();
  db.prepare(
    "UPDATE rematches SET status = 'declined', updated_at = ? WHERE id = ?"
  ).run(now, rematchId);

  return { ok: true };
}

export function getRematchById(id: string): Rematch | null {
  const row = db.prepare("SELECT * FROM rematches WHERE id = ?").get(id) as any;
  return row ? formatRematch(row) : null;
}

export function getPendingRematchesForUser(userId: string): Rematch[] {
  expirePendingRematches();
  const rows = db.prepare(
    "SELECT * FROM rematches WHERE (player1_id = ? OR player2_id = ?) AND status = 'proposed' ORDER BY created_at DESC"
  ).all(userId, userId) as any[];
  return rows.map(formatRematch);
}

export function getAcceptedChallengesForUser(userId: string): Challenge[] {
  // Run TTL expiry first
  expireAcceptedChallenges();
  const rows = db.prepare(
    "SELECT * FROM challenges WHERE (challenger_id = ? OR target_id = ?) AND status = 'accepted' AND room_id IS NOT NULL ORDER BY updated_at DESC LIMIT 10"
  ).all(userId, userId) as any[];
  return rows.map(formatChallenge);
}

/**
 * Get accepted rematches that are still joinable for a user.
 */
export function getAcceptedRematchesForUser(userId: string): Rematch[] {
  expireAcceptedRematches();
  const rows = db.prepare(
    "SELECT * FROM rematches WHERE (player1_id = ? OR player2_id = ?) AND status = 'accepted' AND room_id IS NOT NULL ORDER BY updated_at DESC LIMIT 10"
  ).all(userId, userId) as any[];
  return rows.map(formatRematch);
}

// ── TTL Expiry for Accepted Challenges / Rematches ─────────────────

/**
 * Expire accepted challenges whose room TTL has elapsed.
 *
 * What expires: challenges with status='accepted' whose updated_at is older than CHALLENGE_ROOM_TTL_MS.
 * When: 10 minutes after acceptance.
 * What the user sees: challenge status changes to 'expired'; room is no longer joinable.
 * Notifications/history: remain visible — only the joinable state changes.
 */
export function expireAcceptedChallenges(): number {
  const now = Date.now();
  const cutoff = now - CHALLENGE_ROOM_TTL_MS;
  const result = db.prepare(
    "UPDATE challenges SET status = 'expired', updated_at = ? WHERE status = 'accepted' AND updated_at <= ?"
  ).run(now, cutoff);
  return result.changes;
}

/**
 * Expire accepted rematches whose room TTL has elapsed.
 *
 * What expires: rematches with status='accepted' whose updated_at is older than REMATCH_ROOM_TTL_MS.
 * When: 5 minutes after acceptance.
 * What the user sees: rematch status changes to 'expired'; room is no longer joinable.
 * Notifications/history: remain visible — only the joinable state changes.
 */
export function expireAcceptedRematches(): number {
  const now = Date.now();
  const cutoff = now - REMATCH_ROOM_TTL_MS;
  const result = db.prepare(
    "UPDATE rematches SET status = 'expired', updated_at = ? WHERE status = 'accepted' AND updated_at <= ?"
  ).run(now, cutoff);
  return result.changes;
}

function formatRematch(row: any): Rematch {
  return {
    id: row.id,
    challengeId: row.challenge_id,
    player1Id: row.player1_id,
    player1Username: row.player1_username,
    player2Id: row.player2_id,
    player2Username: row.player2_username,
    proposerId: row.proposer_id,
    status: row.status,
    stakeId: row.stake_id,
    roomId: row.room_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

// ── Player Availability ────────────────────────────────────────────

/**
 * Availability callback — set by roomManager to query real-time state.
 * This avoids a circular dependency between social.ts and roomManager.ts.
 */
let availabilityCallback: ((userId: string) => PlayerAvailability) | null = null;

export function setAvailabilityCallback(cb: (userId: string) => PlayerAvailability): void {
  availabilityCallback = cb;
}

export function getPlayerAvailability(userId: string): PlayerAvailability {
  if (availabilityCallback) {
    return availabilityCallback(userId);
  }
  return "offline";
}

/**
 * Get availability for multiple users at once.
 */
export function getPlayerAvailabilities(userIds: string[]): Record<string, PlayerAvailability> {
  const result: Record<string, PlayerAvailability> = {};
  for (const id of userIds) {
    result[id] = getPlayerAvailability(id);
  }
  return result;
}

// ── Social Notifications ───────────────────────────────────────────

export function createSocialNotification(
  userId: string,
  type: SocialNotification["type"],
  referenceId: string | null,
  fromUserId: string | null,
  fromUsername: string | null,
  message: string,
): void {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO social_notifications (id, user_id, type, reference_id, from_user_id, from_username, message, read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, userId, type, referenceId, fromUserId, fromUsername, message, now);
}

export function getSocialNotifications(userId: string, unreadOnly = false, limit = 30): SocialNotification[] {
  const query = unreadOnly
    ? "SELECT * FROM social_notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC LIMIT ?"
    : "SELECT * FROM social_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?";
  const rows = db.prepare(query).all(userId, limit) as any[];
  return rows.map(formatNotification);
}

export function getUnreadSocialNotificationCount(userId: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) as cnt FROM social_notifications WHERE user_id = ? AND read = 0"
  ).get(userId) as any;
  return row?.cnt || 0;
}

export function markSocialNotificationsRead(userId: string, notificationIds?: string[]): number {
  if (notificationIds && notificationIds.length > 0) {
    const placeholders = notificationIds.map(() => "?").join(",");
    const result = db.prepare(
      `UPDATE social_notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`
    ).run(userId, ...notificationIds);
    return result.changes;
  }
  // Mark all as read
  const result = db.prepare(
    "UPDATE social_notifications SET read = 1 WHERE user_id = ? AND read = 0"
  ).run(userId);
  return result.changes;
}

function formatNotification(row: any): SocialNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    referenceId: row.reference_id,
    fromUserId: row.from_user_id,
    fromUsername: row.from_username,
    message: row.message,
    read: !!row.read,
    createdAt: row.created_at,
  };
}
