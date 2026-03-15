import { Router, Response } from "express";
import crypto from "crypto";
import { db } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";

const router = Router();

// ─── POST /api/matches ───────────────────────────────────────────────
router.post(
  "/",
  requireAuth,
  validateBody([
    { name: "opponent_name", type: "string", minLength: 1, maxLength: 50 },
    { name: "user_score", type: "number", min: 0, max: 500 },
    { name: "opponent_score", type: "number", min: 0, max: 500 },
    { name: "is_win", type: "boolean" },
  ]),
  (req: AuthenticatedRequest, res: Response) => {
    const { opponent_name, user_score, opponent_score, is_win } = req.body;
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO matches (id, user_id, opponent_name, user_score, opponent_score, is_win)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.userId, opponent_name, user_score, opponent_score, is_win ? 1 : 0);

    // Update rating and win/loss counters
    const ratingChange = is_win ? 15 : -10;
    db.prepare("UPDATE users SET rating = MAX(100, rating + ?), wins = wins + ?, losses = losses + ? WHERE id = ?")
      .run(ratingChange, is_win ? 1 : 0, is_win ? 0 : 1, req.userId);

    res.json({ success: true });
  }
);

// ─── GET /api/matches ────────────────────────────────────────────────
router.get("/", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const matches = db.prepare("SELECT * FROM matches WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").all(req.userId);
  res.json({ matches });
});

export default router;

// ─── Stats Router (mounted separately at /api/stats) ─────────────────
export const statsRouter = Router();

statsRouter.get("/", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const user = db.prepare("SELECT id, username, rating, wins, losses, created_at FROM users WHERE id = ?").get(req.userId) as any;
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const totalMatches = (user.wins || 0) + (user.losses || 0);
  const winRate = totalMatches > 0 ? ((user.wins || 0) / totalMatches * 100).toFixed(1) : "0.0";

  // Compute global rank
  const rankRow = db.prepare("SELECT COUNT(*) as rank FROM users WHERE rating > ?").get(user.rating) as any;
  const globalRank = (rankRow?.rank || 0) + 1;

  // Recent rating trend (last 7 days)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentMatches = db.prepare(
    "SELECT is_win FROM matches WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC"
  ).all(req.userId, weekAgo) as any[];
  const recentChange = recentMatches.reduce((sum: number, m: any) => sum + (m.is_win ? 15 : -10), 0);

  res.json({
    stats: {
      rating: user.rating,
      wins: user.wins || 0,
      losses: user.losses || 0,
      totalMatches,
      winRate,
      globalRank,
      recentRatingChange: recentChange,
      joinedAt: user.created_at,
    },
  });
});
