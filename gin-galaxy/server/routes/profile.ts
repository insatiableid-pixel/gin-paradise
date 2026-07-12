/**
 * Profile & Achievement API Routes for Gin Paradise.
 *
 * Provides richer player identity, server-backed achievements,
 * prestige/identity layer, and public profile access.
 *
 * Endpoints:
 *   GET  /api/profile              — full profile for authenticated user
 *   GET  /api/profile/:username    — public profile by username
 *   PUT  /api/profile              — update profile selections (title, badge, frame, bio)
 *   GET  /api/profile/achievements — achievement list for authenticated user
 *   POST /api/profile/backfill     — trigger retroactive achievement evaluation
 */

import { Router, Response } from "express";
import { db } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import {
  evaluateAchievements,
  getUserAchievements,
  getUserPrestige,
  getPlayerProfile,
  updatePlayerProfile,
  getAchievementCount,
  backfillAchievements,
  ACHIEVEMENT_DEFINITIONS,
  ACHIEVEMENT_MAP,
  getUnseenNotifications,
  dismissNotifications,
  getRecentAchievementActivity,
} from "../achievements.js";
import { getCachedEvaluation } from "../analysis/pythonBridge.js";
import { getPlayerSeasonStats } from "../seasons.js";
import { getFollowerCount, getFollowingCount, isFollowing, getHeadToHead } from "../social.js";

const router = Router();

// ── Types ────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  username: string;
  rating: number;
  wins: number;
  losses: number;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function computeRatingTier(rating: number): { tier: string; color: string } {
  if (rating >= 1800) return { tier: "Elite", color: "diamond" };
  if (rating >= 1600) return { tier: "Expert", color: "gold" };
  if (rating >= 1400) return { tier: "Skilled", color: "silver" };
  if (rating >= 1200) return { tier: "Intermediate", color: "bronze" };
  return { tier: "Beginner", color: "zinc" };
}

function getWinStreak(userId: string): number {
  const replays = db.prepare(`
    SELECT winner_id FROM replays
    WHERE player1_id = ? OR player2_id = ?
    ORDER BY ended_at DESC
    LIMIT 20
  `).all(userId, userId) as { winner_id: string | null }[];

  let streak = 0;
  for (const r of replays) {
    if (r.winner_id === userId) streak++;
    else break;
  }
  return streak;
}

function getRecentAccuracy(userId: string): number | null {
  try {
    const replays = db.prepare(`
      SELECT id FROM replays
      WHERE player1_id = ? OR player2_id = ?
      ORDER BY ended_at DESC
      LIMIT 10
    `).all(userId, userId) as { id: string }[];

    let total = 0;
    let count = 0;
    for (const r of replays) {
      const cached = getCachedEvaluation(r.id);
      if (cached?.player_summaries?.[userId]) {
        total += cached.player_summaries[userId].engine_accuracy;
        count++;
      }
    }
    return count > 0 ? Math.round((total / count) * 10) / 10 : null;
  } catch {
    return null;
  }
}

function getTournamentStats(userId: string): { entered: number; won: number; bestFinish: string } {
  try {
    const entered = (db.prepare(
      "SELECT COUNT(*) as cnt FROM tournaments WHERE entrants_json LIKE ?"
    ).get(`%${userId}%`) as any)?.cnt || 0;

    const won = (db.prepare(
      "SELECT COUNT(*) as cnt FROM tournaments WHERE winner_id = ? AND status = 'completed'"
    ).get(userId) as any)?.cnt || 0;

    const bestFinish = won > 0 ? "1st" : entered > 0 ? "Participant" : "None";
    return { entered, won, bestFinish };
  } catch {
    return { entered: 0, won: 0, bestFinish: "None" };
  }
}

// ── GET /api/profile — Full profile for authenticated user ──────────

router.get("/", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;

  // Run achievement evaluation (picks up any newly eligible ones)
  const newAwards = evaluateAchievements(userId);

  const user = db.prepare(
    "SELECT id, username, rating, wins, losses, created_at FROM users WHERE id = ?"
  ).get(userId) as UserRow | undefined;

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const totalMatches = (user.wins || 0) + (user.losses || 0);
  const winRate = totalMatches > 0 ? Math.round(((user.wins || 0) / totalMatches) * 1000) / 10 : 0;

  // Global rank
  const rankRow = db.prepare("SELECT COUNT(*) as rank FROM users WHERE rating > ?").get(user.rating) as any;
  const globalRank = (rankRow?.rank || 0) + 1;
  const totalPlayers = (db.prepare("SELECT COUNT(*) as cnt FROM users").get() as any)?.cnt || 1;

  // Rating tier
  const ratingTier = computeRatingTier(user.rating);

  // Win streak
  const currentWinStreak = getWinStreak(userId);

  // Recent accuracy
  const recentAccuracy = getRecentAccuracy(userId);

  // Tournament stats
  const tournamentStats = getTournamentStats(userId);

  // Achievements
  const achievements = getUserAchievements(userId);
  const achievementCount = achievements.length;
  const achievementDetails = achievements.map(a => ({
    ...a,
    definition: ACHIEVEMENT_MAP.get(a.achievementId) || null,
  }));

  // Prestige
  const prestige = getUserPrestige(userId);

  // Profile selections
  const profile = getPlayerProfile(userId);

  // Compute best achievement tier
  const tierOrder = { diamond: 4, gold: 3, silver: 2, bronze: 1 };
  let bestTier = "bronze";
  for (const a of achievements) {
    const def = ACHIEVEMENT_MAP.get(a.achievementId);
    if (def && (tierOrder[def.tier] || 0) > (tierOrder[bestTier as keyof typeof tierOrder] || 0)) {
      bestTier = def.tier;
    }
  }

  // Recent match trend (last 10)
  const recentMatches = db.prepare(`
    SELECT winner_id, ended_at FROM replays
    WHERE player1_id = ? OR player2_id = ?
    ORDER BY ended_at DESC LIMIT 10
  `).all(userId, userId) as { winner_id: string | null; ended_at: number }[];

  const recentRecord = {
    wins: recentMatches.filter(m => m.winner_id === userId).length,
    losses: recentMatches.filter(m => m.winner_id && m.winner_id !== userId).length,
    total: recentMatches.length,
  };

  // Season stats
  const seasonStats = getPlayerSeasonStats(userId);

  // Social counts
  const followerCount = getFollowerCount(userId);
  const followingCount = getFollowingCount(userId);

  res.json({
    user: {
      id: user.id,
      username: user.username,
      rating: user.rating,
      wins: user.wins || 0,
      losses: user.losses || 0,
      totalMatches,
      winRate,
      globalRank,
      totalPlayers,
      joinedAt: user.created_at,
      ratingTier,
      currentWinStreak,
      recentAccuracy,
    },
    tournamentStats,
    seasonStats,
    achievements: achievementDetails,
    achievementCount,
    bestTier,
    prestige,
    profile,
    recentRecord,
    newAwards: newAwards.length > 0 ? newAwards.map(a => ({
      achievementId: a.achievementId,
      definition: ACHIEVEMENT_MAP.get(a.achievementId) || null,
    })) : [],
    allAchievements: ACHIEVEMENT_DEFINITIONS.map(def => ({
      ...def,
      earned: achievements.some(a => a.achievementId === def.id),
      earnedAt: achievements.find(a => a.achievementId === def.id)?.awardedAt || null,
    })),
    social: { followerCount, followingCount },
  });
});

// ── GET /api/profile/notifications — Unseen achievement unlocks ─────

router.get("/notifications", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const notifications = getUnseenNotifications(userId);
  res.json({
    notifications,
    count: notifications.length,
  });
});

// ── POST /api/profile/notifications/dismiss — Mark notifications seen ──

router.post("/notifications/dismiss", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const { notificationIds } = req.body || {};

  const dismissed = dismissNotifications(
    userId,
    Array.isArray(notificationIds) ? notificationIds : undefined
  );

  res.json({
    dismissed,
    message: dismissed > 0
      ? `Dismissed ${dismissed} notification${dismissed > 1 ? "s" : ""}.`
      : "No unseen notifications.",
  });
});

// ── GET /api/profile/activity — Recent achievement activity ─────────

router.get("/activity", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const rawLimit = parseInt(String(req.query.limit || "10"), 10);
    const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 10 : rawLimit, 1), 50);
    const activity = getRecentAchievementActivity(userId, limit);

    // Also include prestige unlocks
    const prestige = getUserPrestige(userId);

    res.json({
      recentAchievements: activity,
      prestige,
      totalAchievements: getAchievementCount(userId),
      totalPrestige: prestige.length,
    });
  } catch (err: any) {
    console.error("[activity] Error:", err);
    res.status(500).json({ error: "Internal error", message: err?.message });
  }
});

// ── GET /api/profile/:username — Public profile ─────────────────────

router.get("/:username", (req, res: Response) => {
  const username = req.params.username;

  const user = db.prepare(
    "SELECT id, username, rating, wins, losses, created_at FROM users WHERE username = ?"
  ).get(username) as UserRow | undefined;

  if (!user) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  const totalMatches = (user.wins || 0) + (user.losses || 0);
  const winRate = totalMatches > 0 ? Math.round(((user.wins || 0) / totalMatches) * 1000) / 10 : 0;

  const rankRow = db.prepare("SELECT COUNT(*) as rank FROM users WHERE rating > ?").get(user.rating) as any;
  const globalRank = (rankRow?.rank || 0) + 1;

  const ratingTier = computeRatingTier(user.rating);

  const achievements = getUserAchievements(user.id);
  const prestige = getUserPrestige(user.id);
  const profile = getPlayerProfile(user.id);
  const tournamentStats = getTournamentStats(user.id);
  const seasonStats = getPlayerSeasonStats(user.id);

  // Social counts (public) and relationship to requester
  const followerCount = getFollowerCount(user.id);
  const followingCount = getFollowingCount(user.id);

  // Determine relationship if requester is authenticated
  const authHeader = req.headers.authorization;
  let relationship: { isFollowing: boolean; isFollowedBy: boolean; headToHead?: any } | null = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    const session = db.prepare(
      "SELECT user_id FROM sessions WHERE id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
    ).get(token) as { user_id: string } | undefined;
    if (session && session.user_id !== user.id) {
      relationship = {
        isFollowing: isFollowing(session.user_id, user.id),
        isFollowedBy: isFollowing(user.id, session.user_id),
        headToHead: getHeadToHead(session.user_id, user.id),
      };
    }
  }

  // Recent match highlights (public-safe — only outcomes, no internal data)
  const recentMatches = db.prepare(`
    SELECT winner_id, winner_username, loser_username, ended_at, end_reason FROM replays
    WHERE player1_id = ? OR player2_id = ?
    ORDER BY ended_at DESC LIMIT 5
  `).all(user.id, user.id) as { winner_id: string | null; winner_username: string | null; loser_username: string | null; ended_at: number; end_reason: string | null }[];

  const recentHighlights = recentMatches.map(m => ({
    result: m.winner_id === user.id ? "win" : "loss",
    opponent: m.winner_id === user.id ? m.loser_username : m.winner_username,
    endReason: m.end_reason,
    playedAt: m.ended_at,
  }));

  // Win streak for public display
  const currentWinStreak = getWinStreak(user.id);

  const achievementDetails = achievements.map(a => ({
    ...a,
    definition: ACHIEVEMENT_MAP.get(a.achievementId) || null,
  }));

  res.json({
    user: {
      username: user.username,
      rating: user.rating,
      wins: user.wins || 0,
      losses: user.losses || 0,
      totalMatches,
      winRate,
      globalRank,
      joinedAt: user.created_at,
      ratingTier,
      currentWinStreak,
    },
    tournamentStats,
    seasonStats,
    recentHighlights,
    achievements: achievementDetails,
    achievementCount: achievements.length,
    prestige,
    profile: {
      selectedTitle: profile.selectedTitle,
      selectedBadge: profile.selectedBadge,
      selectedFrame: profile.selectedFrame,
      bio: profile.bio,
    },
    social: { followerCount, followingCount },
    relationship,
  });
});

// ── PUT /api/profile — Update profile selections ────────────────────

router.put("/", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const { selectedTitle, selectedBadge, selectedFrame, bio } = req.body;

  // Validate that selected items are actually unlocked
  if (selectedTitle !== undefined && selectedTitle !== null) {
    const unlocked = getUserPrestige(userId);
    const hasTitle = unlocked.some(p => p.type === "title" && p.key === selectedTitle);
    if (!hasTitle) {
      res.status(400).json({ error: "Title not unlocked" });
      return;
    }
  }

  if (selectedBadge !== undefined && selectedBadge !== null) {
    const unlocked = getUserPrestige(userId);
    const hasBadge = unlocked.some(p => p.type === "badge" && p.key === selectedBadge);
    if (!hasBadge) {
      res.status(400).json({ error: "Badge not unlocked" });
      return;
    }
  }

  if (selectedFrame !== undefined && selectedFrame !== null) {
    const unlocked = getUserPrestige(userId);
    const hasFrame = unlocked.some(p => p.type === "frame" && p.key === selectedFrame);
    if (!hasFrame) {
      res.status(400).json({ error: "Frame not unlocked" });
      return;
    }
  }

  // Validate bio length
  if (bio !== undefined && typeof bio === "string" && bio.length > 200) {
    res.status(400).json({ error: "Bio must be 200 characters or fewer" });
    return;
  }

  updatePlayerProfile(userId, { selectedTitle, selectedBadge, selectedFrame, bio });

  res.json({ success: true, profile: getPlayerProfile(userId) });
});

// ── GET /api/profile/achievements/catalog — All available achievements ──

router.get("/achievements/catalog", (_req, res: Response) => {
  res.json({ achievements: ACHIEVEMENT_DEFINITIONS });
});

// ── POST /api/profile/backfill — Trigger retroactive evaluation ─────

router.post("/backfill", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const newAwards = backfillAchievements(userId);

  res.json({
    newAwards: newAwards.map(a => ({
      achievementId: a.achievementId,
      definition: ACHIEVEMENT_MAP.get(a.achievementId) || null,
    })),
    totalNewAwards: newAwards.length,
    message: newAwards.length > 0
      ? `Awarded ${newAwards.length} new achievement${newAwards.length > 1 ? "s" : ""}!`
      : "All achievements are up to date.",
  });
});

export default router;
