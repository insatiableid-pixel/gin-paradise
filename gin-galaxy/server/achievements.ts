/**
 * Achievement & Prestige System for Gin Paradise.
 *
 * Server-backed achievement engine with deterministic award logic,
 * duplicate prevention, timestamped awards, title/badge/frame unlocks,
 * and retroactive backfill support.
 *
 * Achievements are evaluated server-side against real data — no client
 * calculation is trusted. Each achievement is awarded at most once via
 * UNIQUE(user_id, achievement_id) constraint.
 */

import crypto from "crypto";
import { db } from "./db.js";

// ── Achievement Definitions ──────────────────────────────────────────

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name
  category: "competitive" | "tournament" | "training" | "consistency" | "prestige";
  tier: "bronze" | "silver" | "gold" | "diamond";
  /** Prestige unlock: title, badge, or frame key */
  prestigeUnlock?: { type: "title" | "badge" | "frame"; key: string; label: string };
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDef[] = [
  // ── Competitive Play Milestones ──
  {
    id: "first_match",
    name: "First Steps",
    description: "Play your first match",
    icon: "Swords",
    category: "competitive",
    tier: "bronze",
    prestigeUnlock: { type: "badge", key: "newcomer", label: "Newcomer" },
  },
  {
    id: "win_10",
    name: "Getting Started",
    description: "Win 10 matches",
    icon: "Trophy",
    category: "competitive",
    tier: "bronze",
  },
  {
    id: "win_50",
    name: "Competitor",
    description: "Win 50 matches",
    icon: "Trophy",
    category: "competitive",
    tier: "silver",
    prestigeUnlock: { type: "title", key: "competitor", label: "Competitor" },
  },
  {
    id: "win_100",
    name: "Centurion",
    description: "Win 100 matches",
    icon: "Trophy",
    category: "competitive",
    tier: "gold",
    prestigeUnlock: { type: "title", key: "centurion", label: "Centurion" },
  },
  {
    id: "win_500",
    name: "Gin Master",
    description: "Win 500 matches",
    icon: "Crown",
    category: "competitive",
    tier: "diamond",
    prestigeUnlock: { type: "title", key: "gin_master", label: "Gin Master" },
  },
  {
    id: "rating_1400",
    name: "Rising Star",
    description: "Reach a rating of 1400",
    icon: "TrendingUp",
    category: "competitive",
    tier: "silver",
    prestigeUnlock: { type: "badge", key: "rising_star", label: "Rising Star" },
  },
  {
    id: "rating_1600",
    name: "Expert Player",
    description: "Reach a rating of 1600",
    icon: "Star",
    category: "competitive",
    tier: "gold",
    prestigeUnlock: { type: "title", key: "expert", label: "Expert" },
  },
  {
    id: "rating_1800",
    name: "Elite",
    description: "Reach a rating of 1800",
    icon: "Gem",
    category: "competitive",
    tier: "diamond",
    prestigeUnlock: { type: "title", key: "elite", label: "Elite" },
  },
  {
    id: "first_gin",
    name: "Gin!",
    description: "Win a round with Gin (0 deadwood)",
    icon: "Zap",
    category: "competitive",
    tier: "bronze",
    prestigeUnlock: { type: "badge", key: "gin_strike", label: "Gin Strike" },
  },

  // ── Tournament Milestones ──
  {
    id: "first_tournament",
    name: "Tournament Debut",
    description: "Enter your first tournament",
    icon: "Flag",
    category: "tournament",
    tier: "bronze",
  },
  {
    id: "tournament_win",
    name: "Champion",
    description: "Win a tournament",
    icon: "Award",
    category: "tournament",
    tier: "gold",
    prestigeUnlock: { type: "title", key: "champion", label: "Champion" },
  },
  {
    id: "tournament_win_3",
    name: "Serial Winner",
    description: "Win 3 tournaments",
    icon: "Medal",
    category: "tournament",
    tier: "diamond",
    prestigeUnlock: { type: "frame", key: "champion_frame", label: "Champion Frame" },
  },

  // ── Training / Improvement Milestones ──
  {
    id: "first_evaluation",
    name: "Self Aware",
    description: "Get your first match evaluation",
    icon: "Search",
    category: "training",
    tier: "bronze",
  },
  {
    id: "accuracy_80",
    name: "Sharp Player",
    description: "Achieve 80%+ engine accuracy in a match",
    icon: "Target",
    category: "training",
    tier: "silver",
    prestigeUnlock: { type: "badge", key: "sharp", label: "Sharp" },
  },
  {
    id: "accuracy_90",
    name: "Precision",
    description: "Achieve 90%+ engine accuracy in a match",
    icon: "Crosshair",
    category: "training",
    tier: "gold",
    prestigeUnlock: { type: "title", key: "precision", label: "Precision" },
  },
  {
    id: "no_blunders",
    name: "Clean Sheet",
    description: "Complete a match with zero blunders",
    icon: "CheckCircle",
    category: "training",
    tier: "silver",
    prestigeUnlock: { type: "badge", key: "clean_sheet", label: "Clean Sheet" },
  },
  {
    id: "evaluated_10",
    name: "Student of the Game",
    description: "Get 10 matches evaluated",
    icon: "BookOpen",
    category: "training",
    tier: "silver",
  },

  // ── Consistency / Streak Milestones ──
  {
    id: "win_streak_5",
    name: "Hot Streak",
    description: "Win 5 matches in a row",
    icon: "Flame",
    category: "consistency",
    tier: "silver",
    prestigeUnlock: { type: "badge", key: "on_fire", label: "On Fire" },
  },
  {
    id: "win_streak_10",
    name: "Unstoppable",
    description: "Win 10 matches in a row",
    icon: "Flame",
    category: "consistency",
    tier: "gold",
    prestigeUnlock: { type: "title", key: "unstoppable", label: "Unstoppable" },
  },
  {
    id: "matches_played_100",
    name: "Veteran",
    description: "Play 100 matches",
    icon: "Shield",
    category: "consistency",
    tier: "gold",
    prestigeUnlock: { type: "title", key: "veteran", label: "Veteran" },
  },
  {
    id: "daily_player_7",
    name: "Dedicated",
    description: "Play at least one match on 7 different days",
    icon: "Calendar",
    category: "consistency",
    tier: "silver",
    prestigeUnlock: { type: "badge", key: "dedicated", label: "Dedicated" },
  },

  // ── Prestige Tier ──
  {
    id: "staked_win",
    name: "High Roller",
    description: "Win a staked match",
    icon: "DollarSign",
    category: "prestige",
    tier: "silver",
    prestigeUnlock: { type: "badge", key: "high_roller", label: "High Roller" },
  },
  {
    id: "proof_verified",
    name: "Trust Verified",
    description: "Verify a fairness proof",
    icon: "ShieldCheck",
    category: "prestige",
    tier: "bronze",
    prestigeUnlock: { type: "badge", key: "trust_verified", label: "Trust Verified" },
  },
];

export const ACHIEVEMENT_MAP = new Map(ACHIEVEMENT_DEFINITIONS.map(a => [a.id, a]));

// ── Database Setup ───────────────────────────────────────────────────

export function initializeAchievementTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      awarded_at INTEGER NOT NULL,
      context TEXT,
      UNIQUE(user_id, achievement_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id);
    CREATE INDEX IF NOT EXISTS idx_achievements_user_achievement ON achievements(user_id, achievement_id);

    CREATE TABLE IF NOT EXISTS prestige (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      prestige_type TEXT NOT NULL,
      prestige_key TEXT NOT NULL,
      prestige_label TEXT NOT NULL,
      source_achievement TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL,
      UNIQUE(user_id, prestige_type, prestige_key),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_prestige_user ON prestige(user_id);

    CREATE TABLE IF NOT EXISTS player_profiles (
      user_id TEXT PRIMARY KEY,
      selected_title TEXT,
      selected_badge TEXT,
      selected_frame TEXT,
      bio TEXT DEFAULT '',
      updated_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS achievement_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      trigger_source TEXT NOT NULL DEFAULT 'live',
      seen INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_notif_user_unseen ON achievement_notifications(user_id, seen);
  `);
}

// ── Award Logic ──────────────────────────────────────────────────────

export interface AwardResult {
  achievementId: string;
  awarded: boolean;
  duplicate: boolean;
}

/**
 * Award an achievement to a user. Returns whether it was newly awarded
 * or was a duplicate. Uses INSERT OR IGNORE for idempotency.
 */
export function awardAchievement(userId: string, achievementId: string, context?: string): AwardResult {
  const def = ACHIEVEMENT_MAP.get(achievementId);
  if (!def) {
    return { achievementId, awarded: false, duplicate: false };
  }

  const now = Date.now();
  const id = crypto.randomUUID();

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO achievements (id, user_id, achievement_id, awarded_at, context)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(id, userId, achievementId, now, context || null);

  if (result.changes > 0) {
    // New award — also unlock any prestige item
    if (def.prestigeUnlock) {
      const prestigeId = crypto.randomUUID();
      db.prepare(`
        INSERT OR IGNORE INTO prestige (id, user_id, prestige_type, prestige_key, prestige_label, source_achievement, unlocked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        prestigeId,
        userId,
        def.prestigeUnlock.type,
        def.prestigeUnlock.key,
        def.prestigeUnlock.label,
        achievementId,
        now
      );
    }
    return { achievementId, awarded: true, duplicate: false };
  }

  return { achievementId, awarded: false, duplicate: true };
}

/**
 * Get all achievements for a user.
 */
export function getUserAchievements(userId: string): { achievementId: string; awardedAt: number; context: string | null }[] {
  return db.prepare(`
    SELECT achievement_id as achievementId, awarded_at as awardedAt, context
    FROM achievements
    WHERE user_id = ?
    ORDER BY awarded_at DESC
  `).all(userId) as any[];
}

/**
 * Get all prestige unlocks for a user.
 */
export function getUserPrestige(userId: string): { type: string; key: string; label: string; sourceAchievement: string; unlockedAt: number }[] {
  return db.prepare(`
    SELECT prestige_type as type, prestige_key as key, prestige_label as label,
           source_achievement as sourceAchievement, unlocked_at as unlockedAt
    FROM prestige
    WHERE user_id = ?
    ORDER BY unlocked_at DESC
  `).all(userId) as any[];
}

/**
 * Get player profile selections (title, badge, frame).
 */
export function getPlayerProfile(userId: string): { selectedTitle: string | null; selectedBadge: string | null; selectedFrame: string | null; bio: string } {
  const row = db.prepare(`
    SELECT selected_title as selectedTitle, selected_badge as selectedBadge,
           selected_frame as selectedFrame, bio
    FROM player_profiles
    WHERE user_id = ?
  `).get(userId) as any;

  return row || { selectedTitle: null, selectedBadge: null, selectedFrame: null, bio: "" };
}

/**
 * Update player profile selections.
 */
export function updatePlayerProfile(userId: string, updates: { selectedTitle?: string | null; selectedBadge?: string | null; selectedFrame?: string | null; bio?: string }): void {
  const now = Date.now();

  // Upsert
  db.prepare(`
    INSERT INTO player_profiles (user_id, selected_title, selected_badge, selected_frame, bio, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      selected_title = COALESCE(excluded.selected_title, selected_title),
      selected_badge = COALESCE(excluded.selected_badge, selected_badge),
      selected_frame = COALESCE(excluded.selected_frame, selected_frame),
      bio = COALESCE(excluded.bio, bio),
      updated_at = excluded.updated_at
  `).run(
    userId,
    updates.selectedTitle ?? null,
    updates.selectedBadge ?? null,
    updates.selectedFrame ?? null,
    updates.bio ?? "",
    now
  );
}

// ── Achievement Evaluation Engine ────────────────────────────────────

/**
 * Evaluate and award all applicable achievements for a user based on
 * current state. This is the main entry point — call it after events
 * like match completion, tournament finish, or evaluation completion.
 *
 * Returns array of newly awarded achievements.
 */
export function evaluateAchievements(userId: string): AwardResult[] {
  const results: AwardResult[] = [];

  // Fetch user data
  const user = db.prepare("SELECT id, rating, wins, losses FROM users WHERE id = ?").get(userId) as any;
  if (!user) return results;

  const totalMatches = (user.wins || 0) + (user.losses || 0);
  const wins = user.wins || 0;
  const rating = user.rating || 1200;

  // ── Competitive milestones ──
  if (totalMatches >= 1) {
    results.push(awardAchievement(userId, "first_match"));
  }
  if (wins >= 10) {
    results.push(awardAchievement(userId, "win_10"));
  }
  if (wins >= 50) {
    results.push(awardAchievement(userId, "win_50"));
  }
  if (wins >= 100) {
    results.push(awardAchievement(userId, "win_100"));
  }
  if (wins >= 500) {
    results.push(awardAchievement(userId, "win_500"));
  }
  if (totalMatches >= 100) {
    results.push(awardAchievement(userId, "matches_played_100"));
  }
  if (rating >= 1400) {
    results.push(awardAchievement(userId, "rating_1400"));
  }
  if (rating >= 1600) {
    results.push(awardAchievement(userId, "rating_1600"));
  }
  if (rating >= 1800) {
    results.push(awardAchievement(userId, "rating_1800"));
  }

  // ── Gin detection (from replays) ──
  try {
    const ginReplay = db.prepare(`
      SELECT id FROM replays
      WHERE (player1_id = ? OR player2_id = ?) AND winner_id = ?
      AND transcript_json LIKE '%"type":"knock"%'
      AND transcript_json LIKE '%"deadwood":0%'
      LIMIT 1
    `).get(userId, userId, userId) as any;
    if (ginReplay) {
      results.push(awardAchievement(userId, "first_gin", ginReplay.id));
    }
  } catch {}

  // ── Tournament milestones ──
  try {
    const tournamentEntry = db.prepare(`
      SELECT id FROM tournaments WHERE entrants_json LIKE ?
      LIMIT 1
    `).get(`%${userId}%`) as any;
    if (tournamentEntry) {
      results.push(awardAchievement(userId, "first_tournament"));
    }

    const tournamentWins = db.prepare(`
      SELECT COUNT(*) as cnt FROM tournaments WHERE winner_id = ? AND status = 'completed'
    `).get(userId) as any;
    if (tournamentWins?.cnt >= 1) {
      results.push(awardAchievement(userId, "tournament_win"));
    }
    if (tournamentWins?.cnt >= 3) {
      results.push(awardAchievement(userId, "tournament_win_3"));
    }
  } catch {}

  // ── Training milestones ──
  try {
    const evalCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM replay_evaluations re
      INNER JOIN replays r ON r.id = re.replay_id
      WHERE r.player1_id = ? OR r.player2_id = ?
    `).get(userId, userId) as any;

    if (evalCount?.cnt >= 1) {
      results.push(awardAchievement(userId, "first_evaluation"));
    }
    if (evalCount?.cnt >= 10) {
      results.push(awardAchievement(userId, "evaluated_10"));
    }

    // Check accuracy achievements from cached evaluations
    const evals = db.prepare(`
      SELECT re.result_json FROM replay_evaluations re
      INNER JOIN replays r ON r.id = re.replay_id
      WHERE r.player1_id = ? OR r.player2_id = ?
    `).all(userId, userId) as { result_json: string }[];

    for (const evalRow of evals) {
      try {
        const evalData = JSON.parse(evalRow.result_json);
        const summary = evalData?.player_summaries?.[userId];
        if (summary) {
          const accuracy = summary.engine_accuracy;
          if (accuracy >= 80) {
            results.push(awardAchievement(userId, "accuracy_80"));
          }
          if (accuracy >= 90) {
            results.push(awardAchievement(userId, "accuracy_90"));
          }
          const sev = summary.severity_counts;
          if (sev && sev.blunder === 0 && (sev.best + sev.inaccuracy + sev.mistake) > 0) {
            results.push(awardAchievement(userId, "no_blunders"));
          }
        }
      } catch {}
    }
  } catch {}

  // ── Win streak detection ──
  try {
    const recentReplays = db.prepare(`
      SELECT winner_id FROM replays
      WHERE player1_id = ? OR player2_id = ?
      ORDER BY ended_at DESC
      LIMIT 20
    `).all(userId, userId) as { winner_id: string | null }[];

    let currentStreak = 0;
    let maxStreak = 0;
    for (const r of recentReplays) {
      if (r.winner_id === userId) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        break; // only track current consecutive win streak from most recent
      }
    }

    // For max streak, re-calculate looking through all
    let streak = 0;
    for (const r of recentReplays) {
      if (r.winner_id === userId) {
        streak++;
        maxStreak = Math.max(maxStreak, streak);
      } else {
        streak = 0;
      }
    }

    if (maxStreak >= 5) {
      results.push(awardAchievement(userId, "win_streak_5"));
    }
    if (maxStreak >= 10) {
      results.push(awardAchievement(userId, "win_streak_10"));
    }
  } catch {}

  // ── Daily player detection ──
  try {
    const distinctDays = db.prepare(`
      SELECT COUNT(DISTINCT date(ended_at / 1000, 'unixepoch')) as days
      FROM replays
      WHERE player1_id = ? OR player2_id = ?
    `).get(userId, userId) as any;

    if (distinctDays?.days >= 7) {
      results.push(awardAchievement(userId, "daily_player_7"));
    }
  } catch {}

  // ── Staked win ──
  try {
    const stakedWin = db.prepare(`
      SELECT id FROM replays
      WHERE winner_id = ? AND match_format = 'heads_up_staked'
      LIMIT 1
    `).get(userId) as any;
    if (stakedWin) {
      results.push(awardAchievement(userId, "staked_win"));
    }
  } catch {}

  // Filter to only newly awarded
  return results.filter(r => r.awarded);
}

/**
 * Run retroactive backfill for a user — evaluates all achievements
 * against historical data. Safe to call multiple times due to
 * INSERT OR IGNORE dedup.
 */
export function backfillAchievements(userId: string): AwardResult[] {
  return evaluateAchievements(userId);
}

/**
 * Get achievement count for a user.
 */
export function getAchievementCount(userId: string): number {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM achievements WHERE user_id = ?").get(userId) as any;
  return row?.cnt || 0;
}

// ── Live Achievement Triggers ────────────────────────────────────────

export interface LiveAwardNotification {
  achievementId: string;
  definition: AchievementDef;
  prestigeUnlock?: { type: string; key: string; label: string };
  awardedAt: number;
}

/**
 * Trigger live achievement evaluation for a user after a game event.
 * Awards applicable achievements and creates notification records for
 * newly earned ones. Returns the list of new awards with full metadata.
 *
 * This is the primary entry point for real-time achievement triggers
 * (match completion, tournament finish, evaluation completion, etc.).
 *
 * @param triggerSource - Label for what triggered the evaluation (e.g. "match_completion")
 */
export function triggerLiveAchievements(
  userId: string,
  triggerSource: string,
): LiveAwardNotification[] {
  const newAwards = evaluateAchievements(userId);
  if (newAwards.length === 0) return [];

  const notifications: LiveAwardNotification[] = [];
  const now = Date.now();

  for (const award of newAwards) {
    const def = ACHIEVEMENT_MAP.get(award.achievementId);
    if (!def) continue;

    // Record notification
    const notifId = crypto.randomUUID();
    try {
      db.prepare(`
        INSERT OR IGNORE INTO achievement_notifications (id, user_id, achievement_id, trigger_source, seen, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
      `).run(notifId, userId, award.achievementId, triggerSource, now);
    } catch {
      // Ignore — notification is best-effort
    }

    notifications.push({
      achievementId: award.achievementId,
      definition: def,
      prestigeUnlock: def.prestigeUnlock,
      awardedAt: now,
    });
  }

  if (notifications.length > 0) {
    console.log(`[achievements] Live trigger (${triggerSource}): ${notifications.length} new award(s) for user ${userId}`);
  }

  return notifications;
}

/**
 * Get unseen achievement notifications for a user.
 * Used by the frontend to show unlock toasts and the recent activity feed.
 */
export function getUnseenNotifications(userId: string, limit = 20): {
  id: string;
  achievementId: string;
  triggerSource: string;
  createdAt: number;
  definition: AchievementDef | null;
  prestigeUnlock?: { type: string; key: string; label: string };
}[] {
  const rows = db.prepare(`
    SELECT id, achievement_id, trigger_source, created_at
    FROM achievement_notifications
    WHERE user_id = ? AND seen = 0
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit) as { id: string; achievement_id: string; trigger_source: string; created_at: number }[];

  return rows.map(r => {
    const def = ACHIEVEMENT_MAP.get(r.achievement_id) || null;
    return {
      id: r.id,
      achievementId: r.achievement_id,
      triggerSource: r.trigger_source,
      createdAt: r.created_at,
      definition: def,
      prestigeUnlock: def?.prestigeUnlock,
    };
  });
}

/**
 * Mark achievement notifications as seen.
 * If no IDs provided, marks ALL unseen notifications for the user as seen.
 */
export function dismissNotifications(userId: string, notificationIds?: string[]): number {
  if (notificationIds && notificationIds.length > 0) {
    // Mark specific notifications as seen
    const placeholders = notificationIds.map(() => "?").join(",");
    const result = db.prepare(`
      UPDATE achievement_notifications SET seen = 1
      WHERE user_id = ? AND id IN (${placeholders})
    `).run(userId, ...notificationIds);
    return result.changes;
  } else {
    // Mark all unseen as seen
    const result = db.prepare(`
      UPDATE achievement_notifications SET seen = 1
      WHERE user_id = ? AND seen = 0
    `).run(userId);
    return result.changes;
  }
}

/**
 * Get recent achievement activity for a user (seen + unseen).
 * Used for the activity feed / progress surface.
 */
export function getRecentAchievementActivity(userId: string, limit = 10): {
  achievementId: string;
  awardedAt: number;
  definition: AchievementDef | null;
  prestigeUnlock?: { type: string; key: string; label: string };
}[] {
  const rows = db.prepare(`
    SELECT achievement_id, awarded_at
    FROM achievements
    WHERE user_id = ?
    ORDER BY awarded_at DESC
    LIMIT ?
  `).all(userId, limit) as { achievement_id: string; awarded_at: number }[];

  return rows.map(r => {
    const def = ACHIEVEMENT_MAP.get(r.achievement_id) || null;
    return {
      achievementId: r.achievement_id,
      awardedAt: r.awarded_at,
      definition: def,
      prestigeUnlock: def?.prestigeUnlock,
    };
  });
}
