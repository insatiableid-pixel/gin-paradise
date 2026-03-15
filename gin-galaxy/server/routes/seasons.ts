/**
 * Season & Seasonal Leaderboard API Routes for Gin Paradise.
 *
 * Endpoints:
 *   GET  /api/seasons/current        — current active season metadata
 *   GET  /api/seasons/leaderboard    — seasonal leaderboard (current or by ?seasonId=)
 *   GET  /api/seasons/me             — authenticated user's current season stats
 *   GET  /api/seasons/all            — all seasons (for history/archive)
 */

import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import {
  getCurrentSeason,
  getSeasonalLeaderboard,
  getPlayerSeasonStats,
  getAllSeasons,
  getSeasonById,
} from "../seasons.js";

const router = Router();

// ── GET /api/seasons/current — Current active season ──────────────

router.get("/current", (_req, res: Response) => {
  const season = getCurrentSeason();

  if (!season) {
    res.status(404).json({ error: "No active season" });
    return;
  }

  const now = Date.now();
  const daysRemaining = Math.max(0, Math.ceil((season.endAt - now) / (24 * 60 * 60 * 1000)));
  const totalDays = Math.ceil((season.endAt - season.startAt) / (24 * 60 * 60 * 1000));
  const progress = Math.min(100, Math.round(((totalDays - daysRemaining) / totalDays) * 100));

  res.json({
    season: {
      id: season.id,
      name: season.name,
      number: season.number,
      startAt: season.startAt,
      endAt: season.endAt,
      status: season.status,
      theme: season.theme,
      daysRemaining,
      totalDays,
      progress,
    },
  });
});

// ── GET /api/seasons/leaderboard — Seasonal leaderboard ───────────

router.get("/leaderboard", (req, res: Response) => {
  const seasonId = req.query.seasonId as string | undefined;

  let targetSeason = seasonId ? getSeasonById(seasonId) : getCurrentSeason();
  if (!targetSeason) {
    res.status(404).json({ error: "Season not found" });
    return;
  }

  const rawLimit = parseInt(req.query.limit as string || "20", 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 20 : rawLimit, 1), 100);

  const standings = getSeasonalLeaderboard(targetSeason.id, limit);

  res.json({
    season: {
      id: targetSeason.id,
      name: targetSeason.name,
      number: targetSeason.number,
      theme: targetSeason.theme,
      status: targetSeason.status,
      endAt: targetSeason.endAt,
    },
    standings,
    totalEntries: standings.length,
  });
});

// ── GET /api/seasons/me — Authenticated user's season stats ──────

router.get("/me", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const seasonId = req.query.seasonId as string | undefined;

  const stats = getPlayerSeasonStats(userId, seasonId || undefined);

  if (!stats) {
    res.status(404).json({ error: "Season not found" });
    return;
  }

  res.json({ seasonStats: stats });
});

// ── GET /api/seasons/all — All seasons (archive) ─────────────────

router.get("/all", (_req, res: Response) => {
  const seasons = getAllSeasons();
  res.json({ seasons });
});

export default router;
