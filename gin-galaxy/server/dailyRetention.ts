/**
 * Daily Retention System — Missions, Streaks, and Daily Puzzle for Gin Paradise.
 *
 * Server-authoritative retention loop that reinforces the coin economy
 * and premium product without undermining purchases or competitive fairness.
 *
 * Design principles:
 * - All progress/reward state is server-backed and durable (SQLite).
 * - Daily reset is deterministic: midnight UTC.
 * - Reward math is conservative and bounded.
 * - Premium deepens convenience/archive access, never creates pay-to-win.
 * - Missions reinforce valuable product behaviors (play, win, train, spectate).
 *
 * Economy tuning rationale:
 * - Daily faucet already gives 500 coins.
 * - Mission rewards: 50-200 coins per mission, max ~500/day from missions.
 * - Streak bonus: 25-500 coins, escalating but capped at day 30.
 * - Puzzle reward: 100 coins for completion, +50 bonus for optimal play.
 * - Total daily retention income: ~1,150 max (faucet + missions + streak + puzzle).
 * - Coin packages start at 5,000 coins. Daily retention cannot replace purchases
 *   for active staked-match players, but provides enough to keep casual players engaged.
 */

import { db } from "./db.js";
import { mutateBalance } from "./ledger.js";
import { isPremium } from "./entitlements.js";
import crypto from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────

export interface MissionDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  targetCount: number;
  rewardCoins: number;
  category: "engagement" | "competitive" | "training" | "social";
}

export interface PlayerMission {
  missionId: string;
  definition: MissionDefinition;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  nextReward: { day: number; coins: number };
  streakPreserved: boolean; // true if today's check-in has been done
  todayCheckedIn: boolean;
}

export interface DailyPuzzle {
  puzzleId: string;
  puzzleDate: string;
  scenario: PuzzleScenario;
  completed: boolean;
  playerChoice: string | null;
  wasOptimal: boolean | null;
  rewardClaimed: boolean;
}

export interface PuzzleScenario {
  title: string;
  description: string;
  hand: number[];      // card IDs in player's hand
  discardTop: number;  // card on top of discard pile
  stockAvailable: boolean;
  deadwood: number;
  optimalAction: string;    // "draw_stock" | "draw_discard" | "knock" | "discard_X"
  optimalReason: string;
  difficulty: "easy" | "medium" | "hard";
}

// ─── Constants ──────────────────────────────────────────────────────────

/** Daily reset: midnight UTC */
export function getTodayDateUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getYesterdayDateUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ─── Mission Pool ───────────────────────────────────────────────────────
// Each day, players get 3-4 missions drawn from this pool.
// Rewards are bounded: 50-200 coins per mission.

const MISSION_POOL: MissionDefinition[] = [
  // Engagement
  {
    id: "daily_checkin",
    title: "Daily Check-In",
    description: "Visit Gin Paradise today",
    icon: "☀️",
    targetCount: 1,
    rewardCoins: 50,
    category: "engagement",
  },
  {
    id: "play_1_match",
    title: "First Blood",
    description: "Play 1 match (any mode)",
    icon: "🃏",
    targetCount: 1,
    rewardCoins: 100,
    category: "engagement",
  },
  {
    id: "play_3_matches",
    title: "Triple Threat",
    description: "Play 3 matches",
    icon: "🔥",
    targetCount: 3,
    rewardCoins: 200,
    category: "engagement",
  },
  // Competitive
  {
    id: "win_1_match",
    title: "Winner's Circle",
    description: "Win a match",
    icon: "🏆",
    targetCount: 1,
    rewardCoins: 150,
    category: "competitive",
  },
  {
    id: "win_2_matches",
    title: "On a Roll",
    description: "Win 2 matches",
    icon: "⚡",
    targetCount: 2,
    rewardCoins: 200,
    category: "competitive",
  },
  {
    id: "knock_opponent",
    title: "Knockdown",
    description: "Win by knocking",
    icon: "👊",
    targetCount: 1,
    rewardCoins: 100,
    category: "competitive",
  },
  // Training
  {
    id: "complete_training",
    title: "Student of the Game",
    description: "Complete a training session",
    icon: "📚",
    targetCount: 1,
    rewardCoins: 100,
    category: "training",
  },
  {
    id: "solve_puzzle",
    title: "Puzzle Master",
    description: "Complete today's daily puzzle",
    icon: "🧩",
    targetCount: 1,
    rewardCoins: 100,
    category: "training",
  },
  // Social
  {
    id: "spectate_match",
    title: "Talent Scout",
    description: "Spectate a live match",
    icon: "👁️",
    targetCount: 1,
    rewardCoins: 75,
    category: "social",
  },
  {
    id: "view_replay",
    title: "Film Study",
    description: "Watch a replay",
    icon: "🎬",
    targetCount: 1,
    rewardCoins: 50,
    category: "social",
  },
];

// ─── Streak Reward Schedule ─────────────────────────────────────────────
// Escalates for the first 30 days, then caps. This rewards consistency
// without creating runaway currency inflation.
// Day 1: 25, Day 2: 50, Day 3: 75, Day 5: 125, Day 7: 200,
// Day 14: 350, Day 21: 400, Day 30+: 500 (cap)

export function getStreakReward(day: number): number {
  if (day <= 0) return 0;
  if (day <= 7) return Math.min(25 * day, 200);
  if (day <= 14) return 250 + Math.floor((day - 7) * (100 / 7));
  if (day <= 30) return 350 + Math.floor((day - 14) * (150 / 16));
  return 500; // cap at 500 after day 30
}

// ─── Daily Puzzle Scenarios ─────────────────────────────────────────────
// Deterministic daily puzzles. The puzzle for a given date is derived from
// a hash of the date string, selecting from a pool of hand-crafted scenarios.

const PUZZLE_SCENARIOS: PuzzleScenario[] = [
  {
    title: "The Obvious Draw",
    description: "A card on the discard pile completes your run. What do you do?",
    hand: [1, 2, 4, 17, 18, 19, 30, 35, 40, 45],
    discardTop: 3,
    stockAvailable: true,
    deadwood: 28,
    optimalAction: "draw_discard",
    optimalReason: "The 3♠ completes your A-2-3 spade run, reducing deadwood by 10 points.",
    difficulty: "easy",
  },
  {
    title: "Knock or Continue?",
    description: "Your deadwood is at 10. Should you knock or keep playing for gin?",
    hand: [1, 2, 3, 14, 15, 16, 27, 28, 33, 38],
    discardTop: 42,
    stockAvailable: true,
    deadwood: 10,
    optimalAction: "knock",
    optimalReason: "With 10 deadwood you can knock. Going for gin is risky — the opponent might undercut you or knock first.",
    difficulty: "medium",
  },
  {
    title: "Dangerous Discard",
    description: "You need to discard. Which card is safest to let go?",
    hand: [5, 6, 7, 18, 19, 31, 32, 44, 48, 50],
    discardTop: 22,
    stockAvailable: true,
    deadwood: 22,
    optimalAction: "discard_50",
    optimalReason: "High-value unconnected cards should be discarded first to reduce deadwood risk. The King has no adjacent cards in your hand.",
    difficulty: "easy",
  },
  {
    title: "Stock vs Discard",
    description: "The discard pile shows a card that could help, but reveals information. Draw from stock?",
    hand: [10, 11, 23, 24, 25, 36, 37, 41, 46, 49],
    discardTop: 12,
    stockAvailable: true,
    deadwood: 30,
    optimalAction: "draw_stock",
    optimalReason: "Drawing the Q♠ shows your opponent you need high spades. The information cost outweighs the meld potential since you only have 10-J (not a guaranteed run).",
    difficulty: "hard",
  },
  {
    title: "Gin Opportunity",
    description: "You're close to gin. One card away from a complete hand.",
    hand: [1, 2, 3, 14, 15, 16, 27, 28, 29, 43],
    discardTop: 40,
    stockAvailable: true,
    deadwood: 4,
    optimalAction: "draw_stock",
    optimalReason: "With only 4 deadwood from a single unmatched card, drawing from stock gives you a chance at gin without revealing your near-complete hand.",
    difficulty: "medium",
  },
  {
    title: "Early Game Strategy",
    description: "It's early in the round. You have scattered cards. What's your priority?",
    hand: [3, 8, 15, 22, 27, 33, 38, 42, 47, 51],
    discardTop: 9,
    stockAvailable: true,
    deadwood: 52,
    optimalAction: "draw_discard",
    optimalReason: "The 10♠ pairs with your 9♠ (card 8), giving you adjacent cards for a potential run. In early game, building toward melds is crucial.",
    difficulty: "medium",
  },
  {
    title: "Defensive Play",
    description: "Your opponent has been picking up hearts. You hold the 7♥. Discard it?",
    hand: [4, 5, 6, 19, 20, 32, 33, 34, 45, 51],
    discardTop: 39,
    stockAvailable: true,
    deadwood: 18,
    optimalAction: "discard_51",
    optimalReason: "Never feed a suit your opponent is collecting. Discard the King♦ instead — it's high deadwood and not connected to your melds.",
    difficulty: "hard",
  },
  {
    title: "The Triangle Decision",
    description: "You have two partial melds that share a card. Which combination do you commit to?",
    hand: [14, 15, 16, 17, 27, 28, 40, 41, 42, 50],
    discardTop: 13,
    stockAvailable: true,
    deadwood: 10,
    optimalAction: "knock",
    optimalReason: "You already have excellent melds: 2♦-3♦-4♦-5♦ and A♣-2♣. Knock at 10 deadwood instead of being greedy.",
    difficulty: "hard",
  },
  {
    title: "Late Game Patience",
    description: "The stock is running low. You have a decent hand. Play it safe?",
    hand: [1, 2, 3, 14, 15, 16, 27, 35, 43, 48],
    discardTop: 36,
    stockAvailable: true,
    deadwood: 16,
    optimalAction: "draw_discard",
    optimalReason: "Drawing the 10♣ gives you 10-J♣ pairing with potential. Late game with dwindling stock favors taking known cards over blind draws.",
    difficulty: "medium",
  },
  {
    title: "Split Decision",
    description: "Two possible knocks: one risky, one safe. Which path?",
    hand: [10, 11, 12, 23, 24, 25, 36, 37, 44, 46],
    discardTop: 38,
    stockAvailable: true,
    deadwood: 8,
    optimalAction: "knock",
    optimalReason: "8 deadwood is a strong knock. The risk of waiting for gin when you're already in a winning position is rarely worth it unless you've tracked cards.",
    difficulty: "medium",
  },
];

// ─── Database Initialization ───────────────────────────────────────────

export function initializeDailyRetentionTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_missions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mission_date TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      claimed INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_missions_user_date ON daily_missions(user_id, mission_date);

    CREATE TABLE IF NOT EXISTS daily_streaks (
      user_id TEXT PRIMARY KEY,
      current_streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0,
      last_checkin_date TEXT,
      total_checkins INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS daily_puzzles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      puzzle_date TEXT NOT NULL,
      puzzle_index INTEGER NOT NULL,
      player_choice TEXT,
      was_optimal INTEGER,
      completed INTEGER NOT NULL DEFAULT 0,
      reward_claimed INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_puzzles_user_date ON daily_puzzles(user_id, puzzle_date);
  `);
}

// ─── Mission Assignment ─────────────────────────────────────────────────

/**
 * Get today's missions for a user. Auto-assigns if not yet assigned today.
 * Each day, the player gets exactly 4 missions: 1 engagement, 1 competitive,
 * 1 training, and 1 social/wildcard.
 */
export function getPlayerMissions(userId: string): PlayerMission[] {
  const today = getTodayDateUTC();

  // Check if missions already assigned today
  const existing = db.prepare(
    "SELECT * FROM daily_missions WHERE user_id = ? AND mission_date = ?"
  ).all(userId, today) as any[];

  if (existing.length > 0) {
    return existing.map(row => ({
      missionId: row.mission_id,
      definition: MISSION_POOL.find(m => m.id === row.mission_id)!,
      progress: row.progress,
      completed: row.completed === 1,
      claimed: row.claimed === 1,
    }));
  }

  // Assign new missions for today
  return assignDailyMissions(userId, today);
}

function assignDailyMissions(userId: string, date: string): PlayerMission[] {
  // Deterministic selection based on user + date for consistency
  const seed = hashCode(`${userId}:${date}`);

  const byCategory = {
    engagement: MISSION_POOL.filter(m => m.category === "engagement"),
    competitive: MISSION_POOL.filter(m => m.category === "competitive"),
    training: MISSION_POOL.filter(m => m.category === "training"),
    social: MISSION_POOL.filter(m => m.category === "social"),
  };

  // Always include daily_checkin, then pick 1 competitive, 1 training, 1 social/engagement
  const selected: MissionDefinition[] = [
    byCategory.engagement[0], // daily_checkin is always first
    byCategory.competitive[Math.abs(seed) % byCategory.competitive.length],
    byCategory.training[Math.abs(seed >> 8) % byCategory.training.length],
    byCategory.social[Math.abs(seed >> 16) % byCategory.social.length],
  ];

  const insertStmt = db.prepare(`
    INSERT INTO daily_missions (id, user_id, mission_date, mission_id, progress, completed, claimed)
    VALUES (?, ?, ?, ?, 0, 0, 0)
  `);

  const txn = db.transaction(() => {
    for (const mission of selected) {
      insertStmt.run(crypto.randomUUID(), userId, date, mission.id);
    }
  });
  txn();

  return selected.map(def => ({
    missionId: def.id,
    definition: def,
    progress: 0,
    completed: false,
    claimed: false,
  }));
}

/**
 * Record progress toward a mission. Idempotent within a day.
 * Returns true if any mission progressed.
 */
export function recordMissionProgress(
  userId: string,
  missionId: string,
  incrementBy: number = 1
): { progressed: boolean; completed: boolean } {
  const today = getTodayDateUTC();

  const row = db.prepare(
    "SELECT * FROM daily_missions WHERE user_id = ? AND mission_date = ? AND mission_id = ?"
  ).get(userId, today, missionId) as any;

  if (!row) return { progressed: false, completed: false };
  if (row.completed) return { progressed: false, completed: true };

  const def = MISSION_POOL.find(m => m.id === missionId);
  if (!def) return { progressed: false, completed: false };

  const newProgress = Math.min(row.progress + incrementBy, def.targetCount);
  const isComplete = newProgress >= def.targetCount;

  db.prepare(
    "UPDATE daily_missions SET progress = ?, completed = ? WHERE id = ?"
  ).run(newProgress, isComplete ? 1 : 0, row.id);

  return { progressed: true, completed: isComplete };
}

/**
 * Claim the reward for a completed mission.
 */
export function claimMissionReward(
  userId: string,
  missionId: string
): { success: boolean; coinsAwarded: number; error?: string } {
  const today = getTodayDateUTC();

  const row = db.prepare(
    "SELECT * FROM daily_missions WHERE user_id = ? AND mission_date = ? AND mission_id = ?"
  ).get(userId, today, missionId) as any;

  if (!row) return { success: false, coinsAwarded: 0, error: "Mission not found" };
  if (!row.completed) return { success: false, coinsAwarded: 0, error: "Mission not yet completed" };
  if (row.claimed) return { success: false, coinsAwarded: 0, error: "Reward already claimed" };

  const def = MISSION_POOL.find(m => m.id === missionId);
  if (!def) return { success: false, coinsAwarded: 0, error: "Invalid mission definition" };

  db.prepare("UPDATE daily_missions SET claimed = 1 WHERE id = ?").run(row.id);

  mutateBalance(
    userId,
    "gold_coins",
    def.rewardCoins,
    "mission_reward",
    `mission:${missionId}`,
    `Daily mission reward: ${def.title}`
  );

  return { success: true, coinsAwarded: def.rewardCoins };
}

// ─── Streak System ──────────────────────────────────────────────────────

/**
 * Get streak info for a user.
 */
export function getStreakInfo(userId: string): StreakInfo {
  const row = db.prepare(
    "SELECT * FROM daily_streaks WHERE user_id = ?"
  ).get(userId) as any;

  const today = getTodayDateUTC();

  if (!row) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastCheckInDate: null,
      nextReward: { day: 1, coins: getStreakReward(1) },
      streakPreserved: false,
      todayCheckedIn: false,
    };
  }

  const lastDate = row.last_checkin_date;
  const todayCheckedIn = lastDate === today;
  const yesterday = getYesterdayDateUTC();

  // Streak is preserved if checked in today or yesterday
  const streakPreserved = lastDate === today || lastDate === yesterday;
  const effectiveStreak = streakPreserved ? row.current_streak : 0;

  return {
    currentStreak: effectiveStreak,
    longestStreak: row.longest_streak,
    lastCheckInDate: lastDate,
    nextReward: {
      day: effectiveStreak + 1,
      coins: getStreakReward(effectiveStreak + 1),
    },
    streakPreserved,
    todayCheckedIn,
  };
}

/**
 * Check in for the day (streak). Returns reward info.
 * Idempotent — if already checked in today, returns existing info.
 */
export function checkInStreak(userId: string): {
  success: boolean;
  streakDay: number;
  coinsAwarded: number;
  isNewRecord: boolean;
  error?: string;
} {
  const today = getTodayDateUTC();
  const yesterday = getYesterdayDateUTC();

  const row = db.prepare(
    "SELECT * FROM daily_streaks WHERE user_id = ?"
  ).get(userId) as any;

  if (row?.last_checkin_date === today) {
    return {
      success: false,
      streakDay: row.current_streak,
      coinsAwarded: 0,
      isNewRecord: false,
      error: "Already checked in today",
    };
  }

  let newStreak: number;
  if (!row) {
    newStreak = 1;
  } else if (row.last_checkin_date === yesterday) {
    newStreak = row.current_streak + 1;
  } else {
    newStreak = 1; // streak broken
  }

  const longestStreak = Math.max(newStreak, row?.longest_streak || 0);
  const isNewRecord = newStreak > (row?.longest_streak || 0);
  const reward = getStreakReward(newStreak);

  db.prepare(`
    INSERT INTO daily_streaks (user_id, current_streak, longest_streak, last_checkin_date, total_checkins, updated_at)
    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      current_streak = ?,
      longest_streak = ?,
      last_checkin_date = ?,
      total_checkins = total_checkins + 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, newStreak, longestStreak, today, newStreak, longestStreak, today);

  // Award streak bonus
  mutateBalance(
    userId,
    "gold_coins",
    reward,
    "streak_reward",
    `streak:day${newStreak}`,
    `Day ${newStreak} streak bonus`
  );

  // Also auto-progress the daily_checkin mission
  recordMissionProgress(userId, "daily_checkin", 1);

  return {
    success: true,
    streakDay: newStreak,
    coinsAwarded: reward,
    isNewRecord,
  };
}

// ─── Daily Puzzle ───────────────────────────────────────────────────────

/** Get today's puzzle index from date (deterministic). */
function getPuzzleIndexForDate(date: string): number {
  return Math.abs(hashCode(date)) % PUZZLE_SCENARIOS.length;
}

/**
 * Get the daily puzzle for a user. Creates the record if first access.
 */
export function getDailyPuzzle(userId: string): DailyPuzzle {
  const today = getTodayDateUTC();
  const puzzleIdx = getPuzzleIndexForDate(today);

  const existing = db.prepare(
    "SELECT * FROM daily_puzzles WHERE user_id = ? AND puzzle_date = ?"
  ).get(userId, today) as any;

  if (existing) {
    return {
      puzzleId: existing.id,
      puzzleDate: today,
      scenario: PUZZLE_SCENARIOS[existing.puzzle_index],
      completed: existing.completed === 1,
      playerChoice: existing.player_choice,
      wasOptimal: existing.was_optimal === null ? null : existing.was_optimal === 1,
      rewardClaimed: existing.reward_claimed === 1,
    };
  }

  // Create the daily puzzle record
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO daily_puzzles (id, user_id, puzzle_date, puzzle_index, completed, reward_claimed)
    VALUES (?, ?, ?, ?, 0, 0)
  `).run(id, userId, today, puzzleIdx);

  return {
    puzzleId: id,
    puzzleDate: today,
    scenario: PUZZLE_SCENARIOS[puzzleIdx],
    completed: false,
    playerChoice: null,
    wasOptimal: null,
    rewardClaimed: false,
  };
}

/**
 * Submit a puzzle answer.
 */
export function submitPuzzleAnswer(
  userId: string,
  playerChoice: string
): {
  success: boolean;
  wasOptimal: boolean;
  optimalAction: string;
  optimalReason: string;
  error?: string;
} {
  const today = getTodayDateUTC();

  const existing = db.prepare(
    "SELECT * FROM daily_puzzles WHERE user_id = ? AND puzzle_date = ?"
  ).get(userId, today) as any;

  if (!existing) {
    return { success: false, wasOptimal: false, optimalAction: "", optimalReason: "", error: "No puzzle found for today" };
  }

  if (existing.completed) {
    const scenario = PUZZLE_SCENARIOS[existing.puzzle_index];
    return {
      success: false,
      wasOptimal: existing.was_optimal === 1,
      optimalAction: scenario.optimalAction,
      optimalReason: scenario.optimalReason,
      error: "Puzzle already completed",
    };
  }

  const scenario = PUZZLE_SCENARIOS[existing.puzzle_index];
  const wasOptimal = playerChoice === scenario.optimalAction;

  db.prepare(
    "UPDATE daily_puzzles SET player_choice = ?, was_optimal = ?, completed = 1 WHERE id = ?"
  ).run(playerChoice, wasOptimal ? 1 : 0, existing.id);

  // Auto-progress the solve_puzzle mission
  recordMissionProgress(userId, "solve_puzzle", 1);

  return {
    success: true,
    wasOptimal,
    optimalAction: scenario.optimalAction,
    optimalReason: scenario.optimalReason,
  };
}

/**
 * Claim the daily puzzle reward.
 * Base reward: 100 coins. Optimal bonus: +50 coins.
 * Premium: +25 bonus for analysis access (non-pay-to-win).
 */
export function claimPuzzleReward(userId: string): {
  success: boolean;
  coinsAwarded: number;
  breakdown: { base: number; optimalBonus: number; premiumBonus: number };
  error?: string;
} {
  const today = getTodayDateUTC();

  const existing = db.prepare(
    "SELECT * FROM daily_puzzles WHERE user_id = ? AND puzzle_date = ?"
  ).get(userId, today) as any;

  if (!existing) return { success: false, coinsAwarded: 0, breakdown: { base: 0, optimalBonus: 0, premiumBonus: 0 }, error: "No puzzle found" };
  if (!existing.completed) return { success: false, coinsAwarded: 0, breakdown: { base: 0, optimalBonus: 0, premiumBonus: 0 }, error: "Puzzle not yet completed" };
  if (existing.reward_claimed) return { success: false, coinsAwarded: 0, breakdown: { base: 0, optimalBonus: 0, premiumBonus: 0 }, error: "Reward already claimed" };

  const base = 100;
  const optimalBonus = existing.was_optimal ? 50 : 0;
  const premiumBonus = isPremium(userId) ? 25 : 0;
  const total = base + optimalBonus + premiumBonus;

  db.prepare("UPDATE daily_puzzles SET reward_claimed = 1 WHERE id = ?").run(existing.id);

  mutateBalance(
    userId,
    "gold_coins",
    total,
    "puzzle_reward",
    `puzzle:${today}`,
    `Daily puzzle reward${existing.was_optimal ? " (optimal)" : ""}${isPremium(userId) ? " +premium" : ""}`
  );

  return {
    success: true,
    coinsAwarded: total,
    breakdown: { base, optimalBonus, premiumBonus },
  };
}

// ─── Retention Summary ──────────────────────────────────────────────────

/**
 * Get a complete daily retention summary for the player.
 * This is the primary API surface for the frontend.
 */
export function getDailyRetentionSummary(userId: string): {
  missions: PlayerMission[];
  streak: StreakInfo;
  puzzle: DailyPuzzle;
  todayDate: string;
  totalAvailableCoins: number;
  totalClaimedCoins: number;
} {
  const missions = getPlayerMissions(userId);
  const streak = getStreakInfo(userId);
  const puzzle = getDailyPuzzle(userId);

  const totalAvailable = missions.reduce((sum, m) => sum + m.definition.rewardCoins, 0)
    + streak.nextReward.coins
    + 100 + 50; // puzzle base + optimal bonus

  const totalClaimed = missions.filter(m => m.claimed).reduce((sum, m) => sum + m.definition.rewardCoins, 0)
    + (streak.todayCheckedIn ? getStreakReward(streak.currentStreak) : 0)
    + (puzzle.rewardClaimed ? (100 + (puzzle.wasOptimal ? 50 : 0)) : 0);

  return {
    missions,
    streak,
    puzzle,
    todayDate: getTodayDateUTC(),
    totalAvailableCoins: totalAvailable,
    totalClaimedCoins: totalClaimed,
  };
}

// ─── Mission Progress Hooks ─────────────────────────────────────────────
// These are called from other parts of the server when relevant events occur.

export function onMatchPlayed(userId: string, isWin: boolean): void {
  // Ensure missions are assigned for today
  getPlayerMissions(userId);

  recordMissionProgress(userId, "play_1_match", 1);
  recordMissionProgress(userId, "play_3_matches", 1);

  if (isWin) {
    recordMissionProgress(userId, "win_1_match", 1);
    recordMissionProgress(userId, "win_2_matches", 1);
    recordMissionProgress(userId, "knock_opponent", 1); // simplified — any win counts
  }
}

export function onTrainingCompleted(userId: string): void {
  getPlayerMissions(userId);
  recordMissionProgress(userId, "complete_training", 1);
}

export function onSpectateMatch(userId: string): void {
  getPlayerMissions(userId);
  recordMissionProgress(userId, "spectate_match", 1);
}

export function onReplayViewed(userId: string): void {
  getPlayerMissions(userId);
  recordMissionProgress(userId, "view_replay", 1);
}

// ─── Premium Archive (non-pay-to-win) ───────────────────────────────────

/**
 * Get puzzle history. Free: last 7 days. Premium: all history.
 */
export function getPuzzleHistory(userId: string): DailyPuzzle[] {
  const limit = isPremium(userId) ? 90 : 7;
  const rows = db.prepare(`
    SELECT * FROM daily_puzzles
    WHERE user_id = ? AND completed = 1
    ORDER BY puzzle_date DESC
    LIMIT ?
  `).all(userId, limit) as any[];

  return rows.map(row => ({
    puzzleId: row.id,
    puzzleDate: row.puzzle_date,
    scenario: PUZZLE_SCENARIOS[row.puzzle_index],
    completed: true,
    playerChoice: row.player_choice,
    wasOptimal: row.was_optimal === 1,
    rewardClaimed: row.reward_claimed === 1,
  }));
}

// ─── Utility ────────────────────────────────────────────────────────────

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}

/** Exported for testing */
export const _testExports = {
  MISSION_POOL,
  PUZZLE_SCENARIOS,
  hashCode,
  getPuzzleIndexForDate,
};
