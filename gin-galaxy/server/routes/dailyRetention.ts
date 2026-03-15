/**
 * Daily Retention API routes for Gin Paradise.
 *
 * Endpoints:
 *   GET  /api/daily              — full daily retention summary (missions, streak, puzzle)
 *   POST /api/daily/checkin      — check in for streak
 *   POST /api/daily/missions/:id/claim — claim a completed mission reward
 *   GET  /api/daily/puzzle       — get today's puzzle
 *   POST /api/daily/puzzle/submit — submit puzzle answer
 *   POST /api/daily/puzzle/claim — claim puzzle reward
 *   GET  /api/daily/puzzle/history — puzzle history (premium: extended)
 */

import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  getDailyRetentionSummary,
  checkInStreak,
  claimMissionReward,
  getDailyPuzzle,
  submitPuzzleAnswer,
  claimPuzzleReward,
  getPuzzleHistory,
  getStreakInfo,
  getPlayerMissions,
} from "../dailyRetention.js";
import { getBalances } from "../ledger.js";

const router = Router();

// Rate limit daily operations (generous but prevents scripted abuse)
const dailyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: "Too many daily requests. Please try again later.",
});

// ─── GET /api/daily ────────────────────────────────────────────────────

router.get("/", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const summary = getDailyRetentionSummary(req.userId!);
  const balances = getBalances(req.userId!);
  res.json({ ...summary, balances });
});

// ─── POST /api/daily/checkin ───────────────────────────────────────────

router.post(
  "/checkin",
  dailyLimiter,
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const result = checkInStreak(req.userId!);

    if (!result.success) {
      res.status(429).json({
        error: result.error,
        streak: getStreakInfo(req.userId!),
      });
      return;
    }

    const balances = getBalances(req.userId!);
    res.json({
      ...result,
      streak: getStreakInfo(req.userId!),
      balances,
    });
  }
);

// ─── POST /api/daily/missions/:missionId/claim ─────────────────────────

router.post(
  "/missions/:missionId/claim",
  dailyLimiter,
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const { missionId } = req.params;
    const result = claimMissionReward(req.userId!, missionId);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    const balances = getBalances(req.userId!);
    const missions = getPlayerMissions(req.userId!);
    res.json({
      ...result,
      balances,
      missions,
    });
  }
);

// ─── GET /api/daily/puzzle ─────────────────────────────────────────────

router.get("/puzzle", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const puzzle = getDailyPuzzle(req.userId!);

  // Don't reveal the optimal action before submission
  const sanitizedScenario = { ...puzzle.scenario };
  if (!puzzle.completed) {
    (sanitizedScenario as any).optimalAction = undefined;
    (sanitizedScenario as any).optimalReason = undefined;
  }

  res.json({
    ...puzzle,
    scenario: sanitizedScenario,
  });
});

// ─── POST /api/daily/puzzle/submit ─────────────────────────────────────

router.post(
  "/puzzle/submit",
  dailyLimiter,
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const { choice } = req.body;
    if (!choice || typeof choice !== "string") {
      res.status(400).json({ error: "Missing 'choice' in request body" });
      return;
    }

    const result = submitPuzzleAnswer(req.userId!, choice);

    if (!result.success) {
      res.status(400).json({ error: result.error, ...result });
      return;
    }

    res.json(result);
  }
);

// ─── POST /api/daily/puzzle/claim ──────────────────────────────────────

router.post(
  "/puzzle/claim",
  dailyLimiter,
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const result = claimPuzzleReward(req.userId!);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    const balances = getBalances(req.userId!);
    res.json({ ...result, balances });
  }
);

// ─── GET /api/daily/puzzle/history ─────────────────────────────────────

router.get("/puzzle/history", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const history = getPuzzleHistory(req.userId!);
  res.json({ history });
});

export default router;
