/**
 * Spectator, Featured Matches & Broadcast API Routes for Gin Paradise.
 *
 * Endpoints:
 *   GET  /api/spectator/featured              — List currently spectatable/featured matches (public)
 *   GET  /api/spectator/preference             — Get player's spectate preference (auth required)
 *   PUT  /api/spectator/preference             — Set player's spectate preference (auth required)
 *   GET  /api/spectator/metrics/recent         — Recent broadcast metrics (public)
 *   GET  /api/spectator/metrics/:roomId        — Per-match broadcast metrics (public)
 */

import { Router, Response, Request } from "express";
import { getFeaturedMatches } from "../multiplayer/roomManager.js";
import {
  getPlayerSpectatePreference,
  setPlayerSpectatePreference,
  getRecentBroadcastMetrics,
} from "../multiplayer/spectator.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();

/**
 * GET /api/spectator/featured
 * Returns a list of currently live, featured/spectatable matches.
 * No auth required — this is a public discovery surface.
 */
router.get("/featured", (_req: Request, res: Response) => {
  const matches = getFeaturedMatches();
  res.json({ matches });
});

/**
 * GET /api/spectator/preference
 * Returns the authenticated player's spectate preference.
 */
router.get("/preference", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const allowSpectating = getPlayerSpectatePreference(userId);
  res.json({ allowSpectating });
});

/**
 * PUT /api/spectator/preference
 * Sets the authenticated player's spectate preference.
 * Body: { allowSpectating: boolean }
 */
router.put("/preference", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const { allowSpectating } = req.body;

  if (typeof allowSpectating !== "boolean") {
    res.status(400).json({ error: "allowSpectating must be a boolean" });
    return;
  }

  setPlayerSpectatePreference(userId, allowSpectating);
  res.json({ success: true, allowSpectating });
});

/**
 * GET /api/spectator/metrics/recent
 * Returns recent broadcast metrics (completed matches with spectator data).
 * Public endpoint — useful for showing broadcast history on the featured page.
 */
router.get("/metrics/recent", (_req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String((_req as any).query?.limit)) || 20, 1), 50);
  const metrics = getRecentBroadcastMetrics(limit);
  res.json({
    metrics: metrics.map(m => ({
      roomId: m.room_id,
      player1Username: m.player1_username,
      player2Username: m.player2_username,
      peakConcurrentSpectators: m.peak_concurrent_spectators,
      totalUniqueSpectators: m.total_unique_spectators,
      wasAdminFeatured: !!m.was_admin_featured,
      featuredReasons: JSON.parse(m.featured_reasons || "[]"),
      stakeId: m.stake_id,
      matchDurationSeconds: m.match_duration_seconds,
      winnerUsername: m.winner_username,
      startedAt: m.started_at,
      endedAt: m.ended_at,
    })),
  });
});

export default router;
