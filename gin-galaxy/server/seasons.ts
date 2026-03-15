/**
 * Season Model for Gin Paradise.
 *
 * First-class season concept with:
 *  - Current active season metadata (id, name, start, end)
 *  - Season-specific match tracking and seasonal Elo variant
 *  - Persistent season history for future archived seasons
 *  - Season standings computed from match results within season boundaries
 *
 * Design decisions:
 *  - Lifetime rating (users.rating) is UNCHANGED. Seasons add a separate
 *    seasonal_rating that resets each season.
 *  - Season boundaries are date-based (start_at / end_at timestamps).
 *  - The first season (Season 1) is auto-created on initialization.
 *  - Seasonal standings use wins within the season window, with seasonal
 *    rating as tiebreaker.
 */

import crypto from "crypto";
import { db } from "./db.js";

// ── Types ──────────────────────────────────────────────────────────

export interface Season {
  id: string;
  name: string;
  number: number;
  startAt: number;   // epoch ms
  endAt: number;     // epoch ms
  status: "active" | "completed" | "upcoming";
  theme: string;     // display theme label
}

export interface SeasonStanding {
  rank: number;
  userId: string;
  username: string;
  seasonalRating: number;
  seasonWins: number;
  seasonLosses: number;
  seasonMatches: number;
  winRate: string;
  ratingTier: { tier: string; color: string };
}

export interface PlayerSeasonStats {
  seasonId: string;
  seasonName: string;
  seasonNumber: number;
  seasonalRating: number;
  seasonWins: number;
  seasonLosses: number;
  seasonMatches: number;
  seasonRank: number;
  totalSeasonPlayers: number;
  seasonEndAt: number;
  seasonStartAt: number;
  daysRemaining: number;
  seasonStatus: string;
}

// ── Database Setup ─────────────────────────────────────────────────

export function initializeSeasonTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      season_number INTEGER NOT NULL UNIQUE,
      start_at INTEGER NOT NULL,
      end_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'upcoming')),
      theme TEXT NOT NULL DEFAULT 'classic',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_seasons_status ON seasons(status);
    CREATE INDEX IF NOT EXISTS idx_seasons_number ON seasons(season_number);

    CREATE TABLE IF NOT EXISTS season_stats (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      seasonal_rating INTEGER NOT NULL DEFAULT 1200,
      season_wins INTEGER NOT NULL DEFAULT 0,
      season_losses INTEGER NOT NULL DEFAULT 0,
      last_match_at INTEGER,
      UNIQUE(season_id, user_id),
      FOREIGN KEY(season_id) REFERENCES seasons(id)
    );

    CREATE INDEX IF NOT EXISTS idx_season_stats_season ON season_stats(season_id);
    CREATE INDEX IF NOT EXISTS idx_season_stats_user ON season_stats(user_id);
    CREATE INDEX IF NOT EXISTS idx_season_stats_rating ON season_stats(season_id, seasonal_rating DESC);
  `);

  // Ensure Season 1 exists
  ensureCurrentSeason();
}

// ── Season Management ──────────────────────────────────────────────

/** Duration of a season in milliseconds (30 days) */
const SEASON_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const SEASON_THEMES = [
  "Rising Tides",
  "Diamond Rush",
  "Emerald Classic",
  "Golden Age",
  "Phoenix Ascent",
  "Shadow Tournament",
  "Sapphire Showdown",
  "Platinum Peak",
];

/**
 * Ensure there is an active season. If no season exists, create Season 1.
 * If the current season has ended, complete it and create the next one.
 */
export function ensureCurrentSeason(): Season {
  const now = Date.now();

  // Check for active season
  let active = db.prepare(
    "SELECT * FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1"
  ).get() as any;

  if (active && active.end_at <= now) {
    // Season has ended — complete it
    db.prepare("UPDATE seasons SET status = 'completed' WHERE id = ?").run(active.id);
    active = null;
  }

  if (!active) {
    // Get the latest season number
    const latest = db.prepare(
      "SELECT MAX(season_number) as maxNum FROM seasons"
    ).get() as any;

    const nextNum = (latest?.maxNum || 0) + 1;
    const id = crypto.randomUUID();
    const startAt = now;
    const endAt = now + SEASON_DURATION_MS;
    const theme = SEASON_THEMES[(nextNum - 1) % SEASON_THEMES.length];
    const name = `Season ${nextNum}`;

    db.prepare(`
      INSERT INTO seasons (id, name, season_number, start_at, end_at, status, theme, created_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, name, nextNum, startAt, endAt, theme, now);

    active = db.prepare("SELECT * FROM seasons WHERE id = ?").get(id) as any;
  }

  return formatSeason(active);
}

function formatSeason(row: any): Season {
  return {
    id: row.id,
    name: row.name,
    number: row.season_number,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    theme: row.theme,
  };
}

/** Get the current active season */
export function getCurrentSeason(): Season | null {
  const now = Date.now();
  const row = db.prepare(
    "SELECT * FROM seasons WHERE status = 'active' AND start_at <= ? AND end_at > ? ORDER BY season_number DESC LIMIT 1"
  ).get(now, now) as any;

  if (!row) return ensureCurrentSeason();
  return formatSeason(row);
}

/** Get season by ID */
export function getSeasonById(seasonId: string): Season | null {
  const row = db.prepare("SELECT * FROM seasons WHERE id = ?").get(seasonId) as any;
  return row ? formatSeason(row) : null;
}

/** Get all seasons (for archive/history) */
export function getAllSeasons(): Season[] {
  const rows = db.prepare(
    "SELECT * FROM seasons ORDER BY season_number DESC"
  ).all() as any[];
  return rows.map(formatSeason);
}

// ── Season Stats ───────────────────────────────────────────────────

/**
 * Record a match result for seasonal tracking.
 * Call this alongside the normal match recording flow.
 */
export function recordSeasonalMatch(
  seasonId: string,
  winnerId: string,
  loserId: string,
): void {
  const now = Date.now();

  // Upsert winner
  db.prepare(`
    INSERT INTO season_stats (id, season_id, user_id, seasonal_rating, season_wins, season_losses, last_match_at)
    VALUES (?, ?, ?, 1200, 1, 0, ?)
    ON CONFLICT(season_id, user_id) DO UPDATE SET
      season_wins = season_wins + 1,
      last_match_at = ?
  `).run(crypto.randomUUID(), seasonId, winnerId, now, now);

  // Upsert loser
  db.prepare(`
    INSERT INTO season_stats (id, season_id, user_id, seasonal_rating, season_wins, season_losses, last_match_at)
    VALUES (?, ?, ?, 1200, 0, 1, ?)
    ON CONFLICT(season_id, user_id) DO UPDATE SET
      season_losses = season_losses + 1,
      last_match_at = ?
  `).run(crypto.randomUUID(), seasonId, loserId, now, now);

  // Update seasonal ratings using simplified Elo
  updateSeasonalRating(seasonId, winnerId, loserId);
}

/**
 * Simplified seasonal Elo update.
 * Uses K=32 and standard Elo formula.
 */
function updateSeasonalRating(seasonId: string, winnerId: string, loserId: string): void {
  const K = 32;

  const winnerStats = db.prepare(
    "SELECT seasonal_rating FROM season_stats WHERE season_id = ? AND user_id = ?"
  ).get(seasonId, winnerId) as any;

  const loserStats = db.prepare(
    "SELECT seasonal_rating FROM season_stats WHERE season_id = ? AND user_id = ?"
  ).get(seasonId, loserId) as any;

  if (!winnerStats || !loserStats) return;

  const winnerR = winnerStats.seasonal_rating;
  const loserR = loserStats.seasonal_rating;

  const expectedWinner = 1 / (1 + Math.pow(10, (loserR - winnerR) / 400));
  const expectedLoser = 1 / (1 + Math.pow(10, (winnerR - loserR) / 400));

  const newWinnerR = Math.round(winnerR + K * (1 - expectedWinner));
  const newLoserR = Math.round(loserR + K * (0 - expectedLoser));

  db.prepare(
    "UPDATE season_stats SET seasonal_rating = ? WHERE season_id = ? AND user_id = ?"
  ).run(newWinnerR, seasonId, winnerId);

  db.prepare(
    "UPDATE season_stats SET seasonal_rating = ? WHERE season_id = ? AND user_id = ?"
  ).run(Math.max(newLoserR, 800), seasonId, loserId);
}

/**
 * Get seasonal leaderboard (top N players for a season).
 */
export function getSeasonalLeaderboard(seasonId: string, limit = 20): SeasonStanding[] {
  const rows = db.prepare(`
    SELECT ss.user_id, u.username, ss.seasonal_rating, ss.season_wins, ss.season_losses
    FROM season_stats ss
    INNER JOIN users u ON u.id = ss.user_id
    WHERE ss.season_id = ?
    ORDER BY ss.seasonal_rating DESC, ss.season_wins DESC
    LIMIT ?
  `).all(seasonId, limit) as any[];

  return rows.map((row, i) => ({
    rank: i + 1,
    userId: row.user_id,
    username: row.username,
    seasonalRating: row.seasonal_rating,
    seasonWins: row.season_wins,
    seasonLosses: row.season_losses,
    seasonMatches: row.season_wins + row.season_losses,
    winRate: (row.season_wins + row.season_losses) > 0
      ? ((row.season_wins / (row.season_wins + row.season_losses)) * 100).toFixed(1) + "%"
      : "N/A",
    ratingTier: computeSeasonTier(row.seasonal_rating),
  }));
}

/**
 * Get a player's season stats.
 */
export function getPlayerSeasonStats(userId: string, seasonId?: string): PlayerSeasonStats | null {
  const season = seasonId ? getSeasonById(seasonId) : getCurrentSeason();
  if (!season) return null;

  const stats = db.prepare(`
    SELECT seasonal_rating, season_wins, season_losses, last_match_at
    FROM season_stats
    WHERE season_id = ? AND user_id = ?
  `).get(season.id, userId) as any;

  // Calculate rank
  const rankRow = db.prepare(`
    SELECT COUNT(*) as rank FROM season_stats
    WHERE season_id = ? AND seasonal_rating > ?
  `).get(season.id, stats?.seasonal_rating || 0) as any;

  const totalPlayers = (db.prepare(
    "SELECT COUNT(*) as cnt FROM season_stats WHERE season_id = ?"
  ).get(season.id) as any)?.cnt || 0;

  const now = Date.now();
  const daysRemaining = Math.max(0, Math.ceil((season.endAt - now) / (24 * 60 * 60 * 1000)));

  return {
    seasonId: season.id,
    seasonName: season.name,
    seasonNumber: season.number,
    seasonalRating: stats?.seasonal_rating || 1200,
    seasonWins: stats?.season_wins || 0,
    seasonLosses: stats?.season_losses || 0,
    seasonMatches: (stats?.season_wins || 0) + (stats?.season_losses || 0),
    seasonRank: totalPlayers > 0 ? (rankRow?.rank || 0) + 1 : 0,
    totalSeasonPlayers: totalPlayers,
    seasonEndAt: season.endAt,
    seasonStartAt: season.startAt,
    daysRemaining,
    seasonStatus: season.status,
  };
}

function computeSeasonTier(rating: number): { tier: string; color: string } {
  if (rating >= 1800) return { tier: "Elite", color: "diamond" };
  if (rating >= 1600) return { tier: "Expert", color: "gold" };
  if (rating >= 1400) return { tier: "Skilled", color: "silver" };
  if (rating >= 1200) return { tier: "Intermediate", color: "bronze" };
  return { tier: "Beginner", color: "zinc" };
}
