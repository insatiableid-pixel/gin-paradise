/**
 * Tournament API Routes for Gin Paradise.
 *
 * Endpoints:
 *   GET  /api/tournaments          — List tournaments (filter by status, or all)
 *   GET  /api/tournaments/upcoming — List upcoming scheduled events
 *   GET  /api/tournaments/my       — Tournaments for authenticated user
 *   GET  /api/tournaments/:id      — Get tournament detail
 *   POST /api/tournaments          — Create a SNG tournament from preset
 *   POST /api/tournaments/scheduled — Create a scheduled tournament (admin-only)
 *   POST /api/tournaments/:id/join — Join an open/registering tournament
 *   POST /api/tournaments/:id/leave — Leave an open tournament (refund)
 *   POST /api/tournaments/:id/start — Manually start a scheduled tournament (admin-only)
 *   POST /api/tournaments/:id/cancel — Cancel a tournament (admin-only for scheduled)
 */

import { Router, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import {
  createTournament,
  createScheduledTournament,
  joinTournament,
  leaveTournament,
  cancelTournament,
  startScheduledTournament,
  getTournament,
  listTournaments,
  listUpcomingTournaments,
  getPlayerTournaments,
  TOURNAMENT_PRESETS,
  type ScheduledTournamentConfig,
} from "../tournament.js";

const router = Router();

// All tournament routes require auth
router.use(requireAuth);

// ─── GET /api/tournaments ──────────────────────────────────────────────
// List tournaments, optionally filtered by status

router.get("/", (req: any, res: Response) => {
  const status = req.query.status as string | undefined;
  const validStatuses = ["open", "registration_open", "registration_closed", "in_progress", "completed", "cancelled"];

  if (status && !validStatuses.includes(status)) {
    res.status(400).json({ error: "Invalid status filter." });
    return;
  }

  const tournaments = listTournaments(status as any);
  res.json({
    tournaments: tournaments.map(_tournamentView),
    count: tournaments.length,
    presets: TOURNAMENT_PRESETS,
  });
});

// ─── GET /api/tournaments/upcoming ────────────────────────────────────
// List upcoming scheduled events (registration_open or registration_closed)
// NOTE: this must be before /:id to avoid collision

router.get("/upcoming", (req: any, res: Response) => {
  const tournaments = listUpcomingTournaments();
  res.json({
    tournaments: tournaments.map(_tournamentView),
    count: tournaments.length,
  });
});

// ─── GET /api/tournaments/my ───────────────────────────────────────────
// NOTE: this must be before /:id to avoid collision

router.get("/my", (req: any, res: Response) => {
  const userId = req.userId as string;
  const tournaments = getPlayerTournaments(userId);
  res.json({
    tournaments: tournaments.map(_tournamentView),
    count: tournaments.length,
  });
});

// ─── GET /api/tournaments/:id ──────────────────────────────────────────

router.get("/:id", (req: any, res: Response) => {
  const tournament = getTournament(req.params.id);
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found." });
    return;
  }
  res.json({ tournament: _tournamentView(tournament) });
});

// ─── POST /api/tournaments ─────────────────────────────────────────────
// Create a SNG tournament from a preset index

router.post("/", (req: any, res: Response) => {
  const { presetIndex } = req.body;
  if (presetIndex === undefined || presetIndex < 0 || presetIndex >= TOURNAMENT_PRESETS.length) {
    res.status(400).json({ error: "Invalid preset index." });
    return;
  }

  const config = TOURNAMENT_PRESETS[presetIndex];
  const tournament = createTournament(config);
  res.status(201).json({ tournament: _tournamentView(tournament) });
});

// ─── POST /api/tournaments/scheduled ───────────────────────────────────
// Create a scheduled tournament (admin-only)

router.post("/scheduled", requireAdmin, (req: any, res: Response) => {
  const { name, startTime, entryFee, currency, rakePercent, maxEntrants, minEntrants } = req.body;

  // Validate required fields
  if (!name || typeof name !== "string" || name.length < 1 || name.length > 100) {
    res.status(400).json({ error: "Name is required (1-100 characters)." });
    return;
  }
  if (!startTime || typeof startTime !== "number" || startTime < Date.now()) {
    res.status(400).json({ error: "Start time must be a future timestamp." });
    return;
  }
  if (typeof entryFee !== "number" || entryFee < 0) {
    res.status(400).json({ error: "Entry fee must be >= 0." });
    return;
  }
  const validCurrencies = ["gold_coins", "sweeps_coins"];
  if (currency && !validCurrencies.includes(currency)) {
    res.status(400).json({ error: "Invalid currency." });
    return;
  }
  if (typeof maxEntrants !== "number" || maxEntrants < 2 || maxEntrants > 128) {
    res.status(400).json({ error: "Max entrants must be between 2 and 128." });
    return;
  }

  const config: ScheduledTournamentConfig = {
    name,
    startTime,
    entryFee: entryFee || 0,
    currency: currency || "gold_coins",
    rakePercent: typeof rakePercent === "number" ? rakePercent : (entryFee > 0 ? 0.05 : 0),
    maxEntrants,
    minEntrants: typeof minEntrants === "number" ? Math.max(2, minEntrants) : 2,
    adminCreated: true,
  };

  const tournament = createScheduledTournament(config);
  res.status(201).json({ tournament: _tournamentView(tournament) });
});

// ─── POST /api/tournaments/:id/join ────────────────────────────────────

router.post("/:id/join", (req: any, res: Response) => {
  const userId = req.userId as string;
  const username = req.username as string;
  const result = joinTournament(req.params.id, userId, username);

  if (!result.ok) {
    const statusCode = result.error?.includes("Insufficient") ? 402 : 400;
    res.status(statusCode).json({ error: result.error });
    return;
  }

  res.json({
    tournament: _tournamentView(result.tournament!),
    filled: result.filled,
  });
});

// ─── POST /api/tournaments/:id/leave ───────────────────────────────────

router.post("/:id/leave", (req: any, res: Response) => {
  const userId = req.userId as string;
  const result = leaveTournament(req.params.id, userId);

  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  const tournament = getTournament(req.params.id);
  res.json({
    ok: true,
    tournament: tournament ? _tournamentView(tournament) : null,
  });
});

// ─── POST /api/tournaments/:id/start ───────────────────────────────────
// Manually start a scheduled tournament (admin-only)

router.post("/:id/start", requireAdmin, (req: any, res: Response) => {
  const result = startScheduledTournament(req.params.id);

  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({
    ok: true,
    tournament: _tournamentView(result.tournament!),
  });
});

// ─── POST /api/tournaments/:id/cancel ──────────────────────────────────
// Cancel a tournament (admin for scheduled events, creator for SNG)

router.post("/:id/cancel", (req: any, res: Response) => {
  const tournament = getTournament(req.params.id);
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found." });
    return;
  }

  // Scheduled tournaments: admin-only cancel
  // SNG tournaments: any participant (who is the creator) or admin can cancel while open
  if (tournament.adminCreated) {
    // Check admin status
    const { db } = require("../db.js");
    const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.userId) as { is_admin: number } | undefined;
    if (!user || user.is_admin !== 1) {
      res.status(403).json({ error: "Only admins can cancel scheduled tournaments." });
      return;
    }
  }

  const result = cancelTournament(req.params.id);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ ok: true });
});

// ─── View Projection ───────────────────────────────────────────────────
// Strip internal-only fields for API response

function _tournamentView(t: any) {
  return {
    id: t.id,
    name: t.name,
    format: t.format,
    status: t.status,
    entryFee: t.entryFee,
    currency: t.currency,
    rakePercent: t.rakePercent,
    totalPool: t.totalPool,
    rakeAmount: t.rakeAmount,
    prizePool: t.prizePool,
    entrants: t.entrants.map((e: any) => ({
      userId: e.userId,
      username: e.username,
      seed: e.seed,
      eliminated: e.eliminated,
    })),
    bracket: t.bracket,
    winnerId: t.winnerId,
    winnerUsername: t.winnerUsername,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    entrantCount: t.entrants.length,
    maxEntrants: t.maxEntrants || 4,
    // New scheduled fields
    scheduledStartTime: t.scheduledStartTime || null,
    minEntrants: t.minEntrants || 4,
    adminCreated: t.adminCreated || false,
    currentRound: t.currentRound || null,
    totalRounds: t.totalRounds || null,
  };
}

export default router;
