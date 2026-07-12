/**
 * Training Dashboard API Routes for Gin Paradise.
 *
 * Provides aggregated evaluation data, session-level review summaries,
 * trend/retention signals, progression depth, coaching integration,
 * and tournament/format context for the dedicated Training surface.
 *
 * Endpoints:
 *   GET  /api/training/summary       — overall training stats + recent sessions + trends + coaching themes
 *   GET  /api/training/session/:id   — detailed session review with engine eval + coaching
 *   POST /api/training/prepare       — batch-prepare evaluations for unevaluated replays
 *   GET  /api/training/history       — paginated, filterable training history
 *   POST /api/training/coaching/:id  — generate/retrieve coaching for a specific replay
 *   GET  /api/training/coaching/timeline — coaching timeline entries
 *   GET  /api/training/coaching/themes  — aggregated coaching themes across sessions
 */

import { Router, Response } from "express";
import { db } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { getCachedEvaluation, batchPrepareEvaluations } from "../analysis/pythonBridge.js";
import {
  getCachedCoaching,
  getOrGenerateCoaching,
  aggregateCoachingThemes,
  getCoachingHistory,
  getMostRecentCoaching,
} from "../analysis/coachingCache.js";
import type { ReplayData } from "../analysis/transcriptAdapter.js";
import { isPremium, hasFeatureAccess } from "../entitlements.js";

const router = Router();

// ── Types ────────────────────────────────────────────────────────────

interface ReplayRow {
  id: string;
  room_id: string;
  started_at: number;
  ended_at: number;
  player1_id: string;
  player1_username: string;
  player2_id: string;
  player2_username: string;
  winner_id: string | null;
  winner_username: string | null;
  loser_id: string | null;
  loser_username: string | null;
  winner_score: number;
  loser_score: number;
  end_reason: string | null;
  action_count: number;
  transcript_json: string;
  match_format: string | null;
  tournament_id: string | null;
}

interface SessionSummary {
  replayId: string;
  opponent: string;
  result: "win" | "loss" | "draw";
  score: string;
  endReason: string | null;
  playedAt: number;
  durationMs: number;
  hasEvaluation: boolean;
  hasAnalysis: boolean;
  hasCoaching: boolean;
  coachingSource: "ai" | "fallback" | null;
  accuracy: number | null;
  scoreLabel: string | null;
  severityCounts: { best: number; inaccuracy: number; mistake: number; blunder: number } | null;
  matchFormat: string;
  tournamentId: string | null;
  tournamentName: string | null;
}

interface ProgressionData {
  /** Rolling accuracy values (newest first) for time-series display */
  accuracyTimeline: { replayId: string; accuracy: number; playedAt: number; opponent: string }[];
  /** Mistake rate per evaluated session (percentage of non-best decisions) */
  mistakeRateTimeline: { replayId: string; mistakeRate: number; playedAt: number }[];
  /** Recent-window vs older-window comparison */
  recentWindowAccuracy: number | null;
  olderWindowAccuracy: number | null;
  /** Best streak: consecutive sessions above average */
  bestStreak: number;
  /** Current streak classification */
  currentStreakType: "hot" | "cold" | "neutral";
  currentStreakLength: number;
  /** Strongest and weakest decision categories */
  strongestCategory: string | null;
  weakestCategory: string | null;
  /** Improvement delta over last N sessions */
  improvementDelta: number | null;
}

interface TrendData {
  recentAccuracy: number | null;
  recentAccuracyTrend: "improving" | "declining" | "stable" | "insufficient";
  totalEvaluated: number;
  totalSeverity: { best: number; inaccuracy: number; mistake: number; blunder: number };
  bestSession: { replayId: string; accuracy: number; opponent: string; playedAt: number; matchFormat: string } | null;
  worstSession: { replayId: string; accuracy: number; opponent: string; playedAt: number; matchFormat: string } | null;
  averageAccuracy: number | null;
  sessionsPlayed: number;
  sessionsEvaluated: number;
  winRate: number | null;
  recurringMistakeTypes: string[];
  progression: ProgressionData;
  /** Format breakdown: how many sessions per format */
  formatBreakdown: Record<string, number>;
}

// ── Helpers ──────────────────────────────────────────────────────────

function getOpponent(row: ReplayRow, userId: string): string {
  return row.player1_id === userId ? row.player2_username : row.player1_username;
}

function getResult(row: ReplayRow, userId: string): "win" | "loss" | "draw" {
  if (!row.winner_id) return "draw";
  return row.winner_id === userId ? "win" : "loss";
}

function getScore(row: ReplayRow, userId: string): string {
  const isWinner = row.winner_id === userId;
  const myScore = isWinner ? row.winner_score : row.loser_score;
  const opScore = isWinner ? row.loser_score : row.winner_score;
  return `${myScore}-${opScore}`;
}

function extractPlayerSeverity(
  evalData: any,
  userId: string
): { accuracy: number | null; label: string | null; severity: { best: number; inaccuracy: number; mistake: number; blunder: number } | null } {
  if (!evalData || !evalData.player_summaries) {
    return { accuracy: null, label: null, severity: null };
  }

  const summary = evalData.player_summaries[userId];
  if (!summary) {
    return {
      accuracy: evalData.requesting_player_accuracy ?? null,
      label: evalData.requesting_player_label ?? null,
      severity: null,
    };
  }

  return {
    accuracy: summary.engine_accuracy ?? null,
    label: summary.score_label ?? null,
    severity: summary.severity_counts ?? null,
  };
}

/**
 * Detect the most common non-best decision types across evaluated sessions.
 */
function detectRecurringMistakeTypes(evaluations: { evalData: any; userId: string }[]): string[] {
  const typeCounts: Record<string, number> = {};

  for (const { evalData, userId } of evaluations) {
    if (!evalData?.evaluations) continue;
    for (const turn of evalData.evaluations) {
      if (turn.player_id !== userId) continue;
      if (turn.severity === "best") continue;
      const type = turn.type || "unknown";
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }
  }

  return Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type]) => type);
}

/**
 * Compute per-category accuracy rates (draw, discard, knock).
 */
function computeCategoryAccuracy(evaluations: { evalData: any; userId: string }[]): Record<string, { total: number; correct: number; rate: number }> {
  const categories: Record<string, { total: number; correct: number }> = {};

  for (const { evalData, userId } of evaluations) {
    if (!evalData?.evaluations) continue;
    for (const turn of evalData.evaluations) {
      if (turn.player_id !== userId) continue;
      const type = turn.type || "unknown";
      if (!categories[type]) categories[type] = { total: 0, correct: 0 };
      categories[type].total++;
      if (turn.severity === "best" || turn.matches_engine) {
        categories[type].correct++;
      }
    }
  }

  const result: Record<string, { total: number; correct: number; rate: number }> = {};
  for (const [type, data] of Object.entries(categories)) {
    result[type] = {
      ...data,
      rate: data.total > 0 ? Math.round((data.correct / data.total) * 1000) / 10 : 0,
    };
  }
  return result;
}

/**
 * Build detailed progression data from evaluated sessions.
 */
function buildProgression(
  evaluatedSessions: { accuracy: number; replayId: string; opponent: string; playedAt: number; matchFormat: string; evalData: any; userId: string }[],
  averageAccuracy: number | null
): ProgressionData {
  const accuracyTimeline = evaluatedSessions.map(s => ({
    replayId: s.replayId,
    accuracy: s.accuracy,
    playedAt: s.playedAt,
    opponent: s.opponent,
  }));

  // Mistake rate timeline
  const mistakeRateTimeline = evaluatedSessions.map(s => {
    const playerSeverity = extractPlayerSeverity(s.evalData, s.userId);
    if (!playerSeverity.severity) return { replayId: s.replayId, mistakeRate: 0, playedAt: s.playedAt };
    const total = playerSeverity.severity.best + playerSeverity.severity.inaccuracy + playerSeverity.severity.mistake + playerSeverity.severity.blunder;
    const nonBest = total - playerSeverity.severity.best;
    return {
      replayId: s.replayId,
      mistakeRate: total > 0 ? Math.round((nonBest / total) * 1000) / 10 : 0,
      playedAt: s.playedAt,
    };
  });

  // Window comparison (recent 40% vs older 40%)
  let recentWindowAccuracy: number | null = null;
  let olderWindowAccuracy: number | null = null;
  if (evaluatedSessions.length >= 4) {
    const windowSize = Math.floor(evaluatedSessions.length * 0.4);
    const recentSlice = evaluatedSessions.slice(0, windowSize);
    const olderSlice = evaluatedSessions.slice(-windowSize);
    recentWindowAccuracy = Math.round((recentSlice.reduce((s, e) => s + e.accuracy, 0) / recentSlice.length) * 10) / 10;
    olderWindowAccuracy = Math.round((olderSlice.reduce((s, e) => s + e.accuracy, 0) / olderSlice.length) * 10) / 10;
  }

  // Streak analysis
  let bestStreak = 0;
  let currentStreakType: "hot" | "cold" | "neutral" = "neutral";
  let currentStreakLength = 0;

  if (averageAccuracy !== null && evaluatedSessions.length > 0) {
    // Count consecutive sessions above/below average (newest first)
    const threshold = averageAccuracy;
    let aboveStreak = 0;

    for (const s of evaluatedSessions) {
      if (s.accuracy >= threshold) {
        aboveStreak++;
        bestStreak = Math.max(bestStreak, aboveStreak);
      } else {
        aboveStreak = 0;
      }
    }

    // Current streak (from most recent)
    for (const s of evaluatedSessions) {
      if (s.accuracy >= threshold + 3) {
        if (currentStreakType === "neutral") currentStreakType = "hot";
        if (currentStreakType === "hot") currentStreakLength++;
        else break;
      } else if (s.accuracy <= threshold - 3) {
        if (currentStreakType === "neutral") currentStreakType = "cold";
        if (currentStreakType === "cold") currentStreakLength++;
        else break;
      } else {
        break;
      }
    }
  }

  // Category performance
  const categoryAccuracy = computeCategoryAccuracy(evaluatedSessions.map(s => ({ evalData: s.evalData, userId: s.userId })));
  const categories = Object.entries(categoryAccuracy).filter(([_, v]) => v.total >= 3);
  categories.sort((a, b) => b[1].rate - a[1].rate);
  const strongestCategory = categories.length > 0 ? categories[0][0] : null;
  const weakestCategory = categories.length > 1 ? categories[categories.length - 1][0] : null;

  // Improvement delta
  let improvementDelta: number | null = null;
  if (recentWindowAccuracy !== null && olderWindowAccuracy !== null) {
    improvementDelta = Math.round((recentWindowAccuracy - olderWindowAccuracy) * 10) / 10;
  }

  return {
    accuracyTimeline,
    mistakeRateTimeline,
    recentWindowAccuracy,
    olderWindowAccuracy,
    bestStreak,
    currentStreakType,
    currentStreakLength,
    strongestCategory,
    weakestCategory,
    improvementDelta,
  };
}

/** Look up tournament name by ID */
function getTournamentName(tournamentId: string | null): string | null {
  if (!tournamentId) return null;
  try {
    const row = db.prepare("SELECT name FROM tournaments WHERE id = ?").get(tournamentId) as { name: string } | undefined;
    return row?.name || null;
  } catch {
    return null;
  }
}

/** Compute format label for display */
function formatLabel(format: string | null): string {
  switch (format) {
    case "heads_up": return "Heads Up";
    case "heads_up_staked": return "Staked Match";
    case "tournament_sng": return "SNG Tournament";
    case "tournament_scheduled": return "Scheduled Tournament";
    default: return "Standard";
  }
}

// ── GET /api/training/summary ────────────────────────────────────────

router.get("/summary", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 20, 1), 50);

  // Fetch recent replays for this user
  const replays = db.prepare(`
    SELECT * FROM replays
    WHERE player1_id = ? OR player2_id = ?
    ORDER BY ended_at DESC
    LIMIT ?
  `).all(userId, userId, limit) as ReplayRow[];

  // Build session summaries with evaluation data
  const sessions: SessionSummary[] = [];
  const evaluatedSessions: { evalData: any; userId: string; accuracy: number; replayId: string; opponent: string; playedAt: number; matchFormat: string }[] = [];
  let totalSeverity = { best: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  let wins = 0;
  let losses = 0;
  const formatBreakdown: Record<string, number> = {};

  for (const row of replays) {
    const cached = getCachedEvaluation(row.id);
    const playerData = cached ? extractPlayerSeverity(cached, userId) : { accuracy: null, label: null, severity: null };

    const result = getResult(row, userId);
    if (result === "win") wins++;
    if (result === "loss") losses++;

    const matchFormat = row.match_format || "heads_up";
    formatBreakdown[matchFormat] = (formatBreakdown[matchFormat] || 0) + 1;

    const coachingData = getCachedCoaching(row.id);
    const session: SessionSummary = {
      replayId: row.id,
      opponent: getOpponent(row, userId),
      result,
      score: getScore(row, userId),
      endReason: row.end_reason,
      playedAt: row.ended_at,
      durationMs: row.ended_at - row.started_at,
      hasEvaluation: !!cached,
      hasAnalysis: !!coachingData,
      hasCoaching: !!coachingData,
      coachingSource: coachingData?.source || null,
      accuracy: playerData.accuracy,
      scoreLabel: playerData.label,
      severityCounts: playerData.severity,
      matchFormat,
      tournamentId: row.tournament_id,
      tournamentName: getTournamentName(row.tournament_id),
    };

    sessions.push(session);

    if (cached && playerData.accuracy !== null) {
      evaluatedSessions.push({
        evalData: cached,
        userId,
        accuracy: playerData.accuracy,
        replayId: row.id,
        opponent: getOpponent(row, userId),
        playedAt: row.ended_at,
        matchFormat,
      });

      if (playerData.severity) {
        totalSeverity.best += playerData.severity.best;
        totalSeverity.inaccuracy += playerData.severity.inaccuracy;
        totalSeverity.mistake += playerData.severity.mistake;
        totalSeverity.blunder += playerData.severity.blunder;
      }
    }
  }

  // Compute trends
  const totalEvaluated = evaluatedSessions.length;
  const averageAccuracy = totalEvaluated > 0
    ? Math.round((evaluatedSessions.reduce((sum, s) => sum + s.accuracy, 0) / totalEvaluated) * 10) / 10
    : null;

  // Trend: compare first half vs second half of evaluated sessions
  let recentAccuracyTrend: "improving" | "declining" | "stable" | "insufficient" = "insufficient";
  if (totalEvaluated >= 4) {
    const half = Math.floor(totalEvaluated / 2);
    const recentHalf = evaluatedSessions.slice(0, half);
    const olderHalf = evaluatedSessions.slice(half);
    const recentAvg = recentHalf.reduce((s, e) => s + e.accuracy, 0) / recentHalf.length;
    const olderAvg = olderHalf.reduce((s, e) => s + e.accuracy, 0) / olderHalf.length;
    const diff = recentAvg - olderAvg;
    if (diff > 3) recentAccuracyTrend = "improving";
    else if (diff < -3) recentAccuracyTrend = "declining";
    else recentAccuracyTrend = "stable";
  }

  // Best / worst sessions
  let bestSession = null;
  let worstSession = null;
  if (totalEvaluated > 0) {
    const sorted = [...evaluatedSessions].sort((a, b) => b.accuracy - a.accuracy);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    bestSession = { replayId: best.replayId, accuracy: best.accuracy, opponent: best.opponent, playedAt: best.playedAt, matchFormat: best.matchFormat };
    worstSession = { replayId: worst.replayId, accuracy: worst.accuracy, opponent: worst.opponent, playedAt: worst.playedAt, matchFormat: worst.matchFormat };
  }

  const recurringMistakeTypes = detectRecurringMistakeTypes(
    evaluatedSessions.map(s => ({ evalData: s.evalData, userId }))
  );

  const userIsPremium = isPremium(userId);
  const progression = userIsPremium ? buildProgression(evaluatedSessions, averageAccuracy) : null;

  // Coaching themes aggregation — premium only
  const coachingThemes = userIsPremium ? aggregateCoachingThemes(userId, limit) : [];
  const recentCoaching = userIsPremium ? getMostRecentCoaching(userId) : null;

  const trends: TrendData = {
    recentAccuracy: averageAccuracy,
    recentAccuracyTrend,
    totalEvaluated,
    totalSeverity,
    bestSession,
    worstSession,
    averageAccuracy,
    sessionsPlayed: replays.length,
    sessionsEvaluated: totalEvaluated,
    winRate: (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : null,
    recurringMistakeTypes,
    progression: progression || {
      accuracyTimeline: [],
      mistakeRateTimeline: [],
      recentWindowAccuracy: null,
      olderWindowAccuracy: null,
      bestStreak: 0,
      currentStreakType: "neutral" as const,
      currentStreakLength: 0,
      strongestCategory: null,
      weakestCategory: null,
      improvementDelta: null,
    },
    formatBreakdown,
  };

  res.json({
    sessions,
    trends,
    coaching: userIsPremium ? {
      recentCoachingNote: recentCoaching ? {
        themes: recentCoaching.themes,
        source: recentCoaching.source,
        generatedAt: recentCoaching.generatedAt,
      } : null,
      recurringThemes: coachingThemes.slice(0, 5),
      totalCoached: sessions.filter(s => s.hasCoaching).length,
    } : {
      locked: true,
      upgradeMessage: "Upgrade to Gin Paradise Pro for AI coaching narratives, recurring themes, and deep progression analysis.",
      recentCoachingNote: null,
      recurringThemes: [],
      totalCoached: 0,
    },
    plan: {
      tier: userIsPremium ? "premium" : "free",
      progressionLocked: !userIsPremium,
      coachingLocked: !userIsPremium,
    },
    meta: {
      userId,
      generatedAt: Date.now(),
      sessionCount: sessions.length,
      methodology: "apex_v2_engine_agreement",
      methodologyNote: "Engine accuracy measures agreement with Apex v2 heuristic evaluation. This is not a solved-game oracle — it is a strong heuristic approximation.",
      autoEvaluationEnabled: true,
      autoEvaluationNote: "Evaluations are automatically prepared after match completion. Some sessions may still be processing.",
      coachingNote: userIsPremium
        ? "Coaching narratives are generated from AI or structured analysis and cached per replay. Engine evaluation and coaching are separate systems."
        : "AI coaching is a Gin Paradise Pro feature. Upgrade for personalized coaching narratives.",
    },
  });
});

// ── GET /api/training/session/:id ────────────────────────────────────

router.get("/session/:id", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const replayId = req.params.id;

  const row = db.prepare("SELECT * FROM replays WHERE id = ?").get(replayId) as ReplayRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Replay not found." });
    return;
  }

  if (row.player1_id !== userId && row.player2_id !== userId) {
    res.status(403).json({ error: "Access denied. You are not a participant in this match." });
    return;
  }

  const cached = getCachedEvaluation(replayId);
  const playerData = cached ? extractPlayerSeverity(cached, userId) : { accuracy: null, label: null, severity: null };
  const userHasCoachingAccess = hasFeatureAccess(userId, "session_coaching");
  const coachingData = userHasCoachingAccess ? getCachedCoaching(replayId) : null;

  const review = {
    replay: {
      id: row.id,
      opponent: getOpponent(row, userId),
      result: getResult(row, userId),
      score: getScore(row, userId),
      endReason: row.end_reason,
      playedAt: row.ended_at,
      durationMs: row.ended_at - row.started_at,
      actionCount: row.action_count,
      matchFormat: row.match_format || "heads_up",
      matchFormatLabel: formatLabel(row.match_format),
      tournamentId: row.tournament_id,
      tournamentName: getTournamentName(row.tournament_id),
    },
    evaluation: cached ? {
      accuracy: playerData.accuracy,
      scoreLabel: playerData.label,
      severityCounts: playerData.severity,
      totalEvaluated: cached.total_evaluated || 0,
      evaluations: cached.evaluations || [],
      source: "cache",
    } : null,
    coaching: !userHasCoachingAccess ? {
      locked: true,
      upgradeMessage: "Session coaching detail is a Gin Paradise Pro feature.",
    } : coachingData ? {
      narrative: coachingData.narrative,
      themes: coachingData.themes,
      mistakeLinks: coachingData.mistakeLinks,
      source: coachingData.source,
      generatedAt: coachingData.generatedAt,
    } : null,
    keyMoments: cached?.evaluations
      ? cached.evaluations
          .filter((e: any) => e.severity !== "best" && (e.player_id === userId || !e.player_id))
          .sort((a: any, b: any) => {
            const severityOrder: Record<string, number> = { blunder: 3, mistake: 2, inaccuracy: 1 };
            return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
          })
          .slice(0, 5)
      : [],
    meta: {
      replayId,
      hasEvaluation: !!cached,
      hasCoaching: !!coachingData,
      coachingSource: coachingData?.source || null,
      engineMethodology: "apex_v2_engine_agreement",
      note: "Engine evaluation uses Apex v2 heuristic agreement. AI coaching is a separate, complementary narrative layer.",
    },
  };

  res.json(review);
});

// ── POST /api/training/prepare ───────────────────────────────────────
// Batch-prepare evaluations for the user's recent unevaluated replays.
// Premium feature — free users get a locked response with upgrade message.

router.post("/prepare", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;

  if (!hasFeatureAccess(userId, "batch_prepare")) {
    res.json({
      locked: true,
      triggered: 0,
      alreadyCached: 0,
      total: 0,
      message: "Batch preparation is a Gin Paradise Pro feature. Evaluations are still auto-prepared after each match.",
      upgradeMessage: "Upgrade to Pro for bulk evaluation preparation.",
    });
    return;
  }

  const maxBatch = Math.min(Math.max(parseInt(String(req.body?.maxBatch)) || 5, 1), 10);

  const result = batchPrepareEvaluations(userId, maxBatch);

  res.json({
    triggered: result.triggered,
    alreadyCached: result.alreadyCached,
    total: result.total,
    message: result.triggered > 0
      ? `Preparing ${result.triggered} evaluation${result.triggered > 1 ? "s" : ""}. Check back in a few moments.`
      : result.total === 0
        ? "All your replays are already evaluated!"
        : "No new evaluations to prepare.",
  });
});

// ── GET /api/training/history ────────────────────────────────────────
// Paginated, filterable training session history.

router.get("/history", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 20, 1), 100);
  const offset = Math.max(parseInt(String(req.query.offset)) || 0, 0);
  const filter = String(req.query.filter || "all"); // all | evaluated | unevaluated | wins | losses | tournament
  const sort = String(req.query.sort || "recent"); // recent | accuracy_high | accuracy_low

  // Build base query
  let whereClause = "(player1_id = ? OR player2_id = ?)";
  const params: any[] = [userId, userId];

  if (filter === "tournament") {
    whereClause += " AND match_format IN ('tournament_sng', 'tournament_scheduled')";
  } else if (filter === "wins") {
    whereClause += " AND winner_id = ?";
    params.push(userId);
  } else if (filter === "losses") {
    whereClause += " AND loser_id = ?";
    params.push(userId);
  }

  const totalCount = (db.prepare(`SELECT COUNT(*) as cnt FROM replays WHERE ${whereClause}`).get(...params) as { cnt: number }).cnt;

  const replays = db.prepare(`
    SELECT * FROM replays
    WHERE ${whereClause}
    ORDER BY ended_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as ReplayRow[];

  const sessions: SessionSummary[] = [];
  for (const row of replays) {
    const cached = getCachedEvaluation(row.id);
    const playerData = cached ? extractPlayerSeverity(cached, userId) : { accuracy: null, label: null, severity: null };

    if (filter === "evaluated" && !cached) continue;
    if (filter === "unevaluated" && cached) continue;
    if (filter === "coached" && !getCachedCoaching(row.id)) continue;

    const coachingData = getCachedCoaching(row.id);
    sessions.push({
      replayId: row.id,
      opponent: getOpponent(row, userId),
      result: getResult(row, userId),
      score: getScore(row, userId),
      endReason: row.end_reason,
      playedAt: row.ended_at,
      durationMs: row.ended_at - row.started_at,
      hasEvaluation: !!cached,
      hasAnalysis: !!coachingData,
      hasCoaching: !!coachingData,
      coachingSource: coachingData?.source || null,
      accuracy: playerData.accuracy,
      scoreLabel: playerData.label,
      severityCounts: playerData.severity,
      matchFormat: row.match_format || "heads_up",
      tournamentId: row.tournament_id,
      tournamentName: getTournamentName(row.tournament_id),
    });
  }

  // Sort if requested
  if (sort === "accuracy_high") {
    sessions.sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));
  } else if (sort === "accuracy_low") {
    sessions.sort((a, b) => (a.accuracy ?? 999) - (b.accuracy ?? 999));
  }

  res.json({
    sessions,
    pagination: {
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
    },
    filter,
    sort,
  });
});

// ── POST /api/training/coaching/:id ──────────────────────────────────
// Generate or retrieve cached coaching for a specific replay.
// Premium feature — free users get a locked response.

router.post("/coaching/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const replayId = req.params.id;

  if (!hasFeatureAccess(userId, "ai_coaching")) {
    res.json({
      locked: true,
      coaching: null,
      upgradeMessage: "AI coaching narratives are a Gin Paradise Pro feature. Upgrade for personalized strategic coaching on every session.",
      meta: {
        replayId,
        note: "Coaching is available to Gin Paradise Pro subscribers.",
      },
    });
    return;
  }

  const row = db.prepare("SELECT * FROM replays WHERE id = ?").get(replayId) as ReplayRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Replay not found." });
    return;
  }

  if (row.player1_id !== userId && row.player2_id !== userId) {
    res.status(403).json({ error: "Access denied. You are not a participant in this match." });
    return;
  }

  let actions: any[] = [];
  try {
    actions = JSON.parse(row.transcript_json || "[]");
  } catch {
    actions = [];
  }

  const replay: ReplayData = {
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

  try {
    const coaching = await getOrGenerateCoaching(replay, userId);
    res.json({
      coaching: {
        narrative: coaching.narrative,
        themes: coaching.themes,
        mistakeLinks: coaching.mistakeLinks,
        source: coaching.source,
        generatedAt: coaching.generatedAt,
      },
      meta: {
        replayId,
        source: coaching.source,
        schemaVersion: coaching.schemaVersion,
        note: "Coaching is a narrative layer on top of engine evaluation. Engine evaluation is the structured analytical source; coaching is the explanatory layer.",
      },
    });
  } catch (err: any) {
    console.error("[training/coaching] Error generating coaching:", err?.message || err);
    res.status(500).json({ error: "Failed to generate coaching. Please try again later." });
  }
});

// ── GET /api/training/coaching/timeline ──────────────────────────────
// Returns recent coaching timeline entries for the authenticated user.
// Premium feature.

router.get("/coaching/timeline", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;

  if (!hasFeatureAccess(userId, "coaching_timeline")) {
    res.json({
      locked: true,
      timeline: [],
      upgradeMessage: "Coaching timeline is a Gin Paradise Pro feature. Upgrade to track your coaching history over time.",
      meta: {
        userId,
        count: 0,
        note: "Coaching timeline is available to Gin Paradise Pro subscribers.",
      },
    });
    return;
  }

  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 10, 1), 30);

  const history = getCoachingHistory(userId, limit);

  res.json({
    timeline: history.map(entry => ({
      replayId: entry.replayId,
      themes: entry.coaching.themes,
      source: entry.coaching.source,
      generatedAt: entry.coaching.generatedAt,
      narrativePreview: entry.coaching.narrative.slice(0, 200) + (entry.coaching.narrative.length > 200 ? "…" : ""),
      mistakeLinkCount: entry.coaching.mistakeLinks.length,
    })),
    meta: {
      userId,
      count: history.length,
      note: "Coaching timeline shows recent coaching entries. Each entry is tied to a specific replay and contains themes, narrative preview, and mistake links.",
    },
  });
});

// ── GET /api/training/coaching/themes ────────────────────────────────
// Returns aggregated coaching themes across the user's sessions.
// Premium feature.

router.get("/coaching/themes", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;

  if (!hasFeatureAccess(userId, "coaching_themes")) {
    res.json({
      locked: true,
      themes: [],
      upgradeMessage: "Recurring coaching themes are a Gin Paradise Pro feature. Upgrade to identify persistent strategic patterns.",
      meta: {
        userId,
        totalThemes: 0,
        sessionsAnalyzed: 0,
        note: "Coaching themes are available to Gin Paradise Pro subscribers.",
      },
    });
    return;
  }

  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 20, 1), 50);

  const themes = aggregateCoachingThemes(userId, limit);

  res.json({
    themes,
    meta: {
      userId,
      totalThemes: themes.length,
      sessionsAnalyzed: limit,
      note: "Themes are aggregated from coaching narratives across your most recent sessions. Recurring themes indicate persistent strategic patterns.",
    },
  });
});

export default router;
