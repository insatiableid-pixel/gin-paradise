/**
 * Replay Evaluation API Route.
 *
 * POST /api/replays/:id/evaluation
 *   - Requires authentication
 *   - Requires the requesting user to be a participant
 *   - Returns structured, engine-backed per-turn evaluation
 *   - Cached after first computation
 *   - Gracefully degrades when Python evaluator is unavailable
 *
 * GET /api/replays/:id/evaluation
 *   - Returns cached evaluation if available (no Python invocation)
 */

import { Router, Response } from "express";
import { db } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  evaluateReplay,
  getCachedEvaluation,
  type EvaluationResult,
} from "../analysis/pythonBridge.js";
import type { ReplayData } from "../analysis/transcriptAdapter.js";

const router = Router();

const evaluationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  message: "Too many evaluation requests. Please try again in a few minutes.",
});

// ── Shared: fetch + access-check replay ──────────────────────────────

function fetchReplayForUser(
  replayId: string,
  userId: string,
  res: Response,
): ReplayData | null {
  const row = db.prepare("SELECT * FROM replays WHERE id = ?").get(replayId) as any;

  if (!row) {
    res.status(404).json({ error: "Replay not found." });
    return null;
  }

  if (row.player1_id !== userId && row.player2_id !== userId) {
    res.status(403).json({ error: "Access denied. You are not a participant in this match." });
    return null;
  }

  let actions: any[] = [];
  try {
    actions = JSON.parse(row.transcript_json || "[]");
  } catch {
    actions = [];
  }

  return {
    id: row.id,
    roomId: row.room_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    players: [
      { userId: row.player1_id, username: row.player1_username },
      { userId: row.player2_id, username: row.player2_username },
    ],
    outcome: {
      winnerId: row.winner_id,
      winnerUsername: row.winner_username,
      loserId: row.loser_id,
      loserUsername: row.loser_username,
      winnerScore: row.winner_score,
      loserScore: row.loser_score,
      endReason: row.end_reason,
    },
    actions,
  };
}

// ── POST /api/replays/:id/evaluation ─────────────────────────────────
// Generates (or retrieves cached) engine-backed evaluation.
router.post(
  "/:id/evaluation",
  requireAuth,
  evaluationLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const replay = fetchReplayForUser(req.params.id, req.userId!, res);
    if (!replay) return;

    try {
      const result: EvaluationResult = await evaluateReplay(replay, req.userId!);

      if (!result.success) {
        // Graceful degradation: return a structured error without breaking the UX
        res.json({
          evaluation: null,
          source: result.source,
          error: result.error || "Evaluation unavailable",
          meta: {
            replayId: replay.id,
            methodology: "apex_v2_engine_agreement",
            available: false,
          },
        });
        return;
      }

      res.json({
        evaluation: result.evaluation,
        source: result.source,
        meta: {
          replayId: replay.id,
          methodology: "apex_v2_engine_agreement",
          available: true,
        },
      });
    } catch (err: any) {
      console.error("Evaluation error:", err);
      res.json({
        evaluation: null,
        source: "error",
        error: "Internal evaluation error. The replay viewer is unaffected.",
        meta: {
          replayId: replay.id,
          methodology: "apex_v2_engine_agreement",
          available: false,
        },
      });
    }
  },
);

// ── GET /api/replays/:id/evaluation ──────────────────────────────────
// Returns cached evaluation only (no Python invocation).
router.get(
  "/:id/evaluation",
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const replay = fetchReplayForUser(req.params.id, req.userId!, res);
    if (!replay) return;

    const cached = getCachedEvaluation(replay.id);
    if (cached) {
      res.json({
        evaluation: cached,
        source: "cache",
        meta: {
          replayId: replay.id,
          methodology: "apex_v2_engine_agreement",
          available: true,
        },
      });
    } else {
      res.json({
        evaluation: null,
        source: "not_computed",
        meta: {
          replayId: replay.id,
          methodology: "apex_v2_engine_agreement",
          available: false,
        },
      });
    }
  },
);

export default router;
