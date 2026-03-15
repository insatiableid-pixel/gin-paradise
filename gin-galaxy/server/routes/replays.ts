/**
 * Replay API Routes.
 *
 * Provides authenticated endpoints for viewing saved match transcripts.
 * Transcripts are persisted to SQLite when a match finalizes and can be
 * retrieved as a list (recent replays) or individually (full detail).
 *
 * Access control: users can only view replays for matches they participated in.
 */

import { Router, Response } from "express";
import { db } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";

const router = Router();

// ─── GET /api/replays ────────────────────────────────────────────────
// Returns the most recent replays for the authenticated user (up to 20).
router.get("/", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

  const rows = db.prepare(`
    SELECT r.id, r.room_id, r.started_at, r.ended_at,
           r.winner_id, r.winner_username, r.loser_id, r.loser_username,
           r.winner_score, r.loser_score, r.end_reason,
           r.player1_id, r.player1_username, r.player2_id, r.player2_username,
           r.action_count
    FROM replays r
    WHERE r.player1_id = ? OR r.player2_id = ?
    ORDER BY r.ended_at DESC
    LIMIT ? OFFSET ?
  `).all(req.userId, req.userId, limit, offset) as any[];

  const replays = rows.map(r => ({
    id: r.id,
    roomId: r.room_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    players: [
      { userId: r.player1_id, username: r.player1_username },
      { userId: r.player2_id, username: r.player2_username },
    ],
    outcome: {
      winnerId: r.winner_id,
      winnerUsername: r.winner_username,
      loserId: r.loser_id,
      loserUsername: r.loser_username,
      winnerScore: r.winner_score,
      loserScore: r.loser_score,
      endReason: r.end_reason,
    },
    actionCount: r.action_count,
  }));

  res.json({ replays, count: replays.length, offset, limit });
});

// ─── GET /api/replays/:id ────────────────────────────────────────────
// Returns full replay detail including the transcript actions.
// Access control: only participants can view.
router.get("/:id", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const replayId = req.params.id;

  const row = db.prepare(`
    SELECT r.*
    FROM replays r
    WHERE r.id = ?
  `).get(replayId) as any;

  if (!row) {
    res.status(404).json({ error: "Replay not found." });
    return;
  }

  // Access control: must be a participant
  if (row.player1_id !== req.userId && row.player2_id !== req.userId) {
    res.status(403).json({ error: "Access denied. You are not a participant in this match." });
    return;
  }

  // Parse the stored JSON transcript
  let actions: any[] = [];
  try {
    actions = JSON.parse(row.transcript_json || "[]");
  } catch {
    actions = [];
  }

  // Parse fairness proof data (if available)
  let fairness: any = null;
  try {
    if (row.fairness_json) {
      fairness = JSON.parse(row.fairness_json);
    }
  } catch {
    fairness = null;
  }

  res.json({
    replay: {
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
      actionCount: row.action_count,
      fairness,
    },
  });
});

export default router;
