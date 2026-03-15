import { Router, Request, Response } from "express";
import { db } from "../db.js";
import { getCurrentSeason, getSeasonalLeaderboard } from "../seasons.js";

const router = Router();

// ─── GET /api/leaderboard ────────────────────────────────────────────
// Supports ?view=lifetime|seasonal (default: lifetime)
router.get("/", (req: Request, res: Response) => {
  const view = (req.query.view as string) || "lifetime";

  if (view === "seasonal") {
    const season = getCurrentSeason();
    if (!season) {
      res.json({ leaderboard: [], season: null });
      return;
    }

    const standings = getSeasonalLeaderboard(season.id, 20);

    const leaderboard = standings.map(s => ({
      rank: s.rank,
      username: s.username,
      rating: s.seasonalRating,
      winRate: s.winRate,
      matches: s.seasonMatches,
      seasonWins: s.seasonWins,
      seasonLosses: s.seasonLosses,
      ratingTier: s.ratingTier,
    }));

    res.json({
      leaderboard,
      view: "seasonal",
      season: {
        id: season.id,
        name: season.name,
        number: season.number,
        theme: season.theme,
        endAt: season.endAt,
        status: season.status,
      },
    });
    return;
  }

  // Default: lifetime leaderboard
  const players = db.prepare(
    "SELECT username, rating, wins, losses FROM users ORDER BY rating DESC LIMIT 20"
  ).all() as any[];

  const leaderboard = players.map((p: any, i: number) => {
    const total = (p.wins || 0) + (p.losses || 0);
    return {
      rank: i + 1,
      username: p.username,
      rating: p.rating,
      winRate: total > 0 ? ((p.wins || 0) / total * 100).toFixed(1) + "%" : "N/A",
      matches: total,
    };
  });

  res.json({
    leaderboard,
    view: "lifetime",
  });
});

export default router;
