/**
 * Replay Analysis API Route.
 *
 * Provides an authenticated endpoint for requesting AI-powered analysis
 * of a specific stored replay. The analysis is grounded in the persisted
 * transcript rather than summary-level match data.
 *
 * POST /api/replays/:id/analysis
 *   - Requires authentication
 *   - Requires the requesting user to be a participant in the replay
 *   - Returns transcript-driven analysis from Gemini (or graceful fallback)
 *   - Rate-limited alongside existing analysis
 */

import { Router, Response } from "express";
import { db } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { buildAnalysisInput, type ReplayData } from "../analysis/transcriptAdapter.js";

const router = Router();

const replayAnalysisLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  message: "Too many analysis requests. Please try again in a few minutes.",
});

// ─── POST /api/replays/:id/analysis ──────────────────────────────────
router.post("/:id/analysis", requireAuth, replayAnalysisLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const replayId = req.params.id;

  // 1. Fetch the replay
  const row = db.prepare(`
    SELECT r.*
    FROM replays r
    WHERE r.id = ?
  `).get(replayId) as any;

  if (!row) {
    res.status(404).json({ error: "Replay not found." });
    return;
  }

  // 2. Access control: must be a participant
  if (row.player1_id !== req.userId && row.player2_id !== req.userId) {
    res.status(403).json({ error: "Access denied. You are not a participant in this match." });
    return;
  }

  // 3. Parse transcript
  let actions: any[] = [];
  try {
    actions = JSON.parse(row.transcript_json || "[]");
  } catch {
    actions = [];
  }

  // 4. Build the replay data structure
  const replayData: ReplayData = {
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

  // 5. Build analysis input
  const analysisInput = buildAnalysisInput(replayData, req.userId!);

  // 6. Check for Gemini API key
  if (!process.env.GEMINI_API_KEY) {
    // Graceful fallback: return a structured summary without AI
    res.json({
      analysis: generateFallbackAnalysis(analysisInput, replayData),
      source: "fallback",
      meta: analysisInput.meta,
    });
    return;
  }

  // 7. Call Gemini
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: analysisInput.prompt,
    });

    res.json({
      analysis: response.text,
      source: "ai",
      meta: analysisInput.meta,
    });
  } catch (error: any) {
    console.error("Replay AI Analysis Error:", error);
    res.status(500).json({ error: "Failed to generate analysis. Please try again later." });
  }
});

// ── Fallback Analysis (no Gemini API key) ────────────────────────────

function generateFallbackAnalysis(
  input: ReturnType<typeof buildAnalysisInput>,
  replay: ReplayData
): string {
  const isWinner = replay.outcome.winnerId === input.requestingPlayerId;
  const playerName = input.requestingPlayerUsername;
  const drawActions = replay.actions.filter(
    a => a.type === "draw" && a.playerId === input.requestingPlayerId
  );
  const stockDraws = drawActions.filter(a => a.detail?.source === "stock").length;
  const discardDraws = drawActions.filter(a => a.detail?.source === "discard").length;
  const totalDraws = stockDraws + discardDraws;
  const discardPickupRate = totalDraws > 0 ? Math.round((discardDraws / totalDraws) * 100) : 0;

  return `**AI Analysis Unavailable**

The \`GEMINI_API_KEY\` environment variable is not configured. Set it in your \`.env\` file to enable AI-powered match analysis.

---

**Match Summary for ${playerName}:**

- **Result:** ${isWinner ? "Victory ✅" : "Defeat ❌"}
- **Score:** ${replay.outcome.winnerUsername} ${replay.outcome.winnerScore} — ${replay.outcome.loserUsername} ${replay.outcome.loserScore}
- **End Reason:** ${replay.outcome.endReason || "Unknown"}
- **Total Actions:** ${replay.actions.length}
- **Total Rounds:** ${input.meta.totalRounds}
- **Duration:** ${Math.round(input.meta.durationMs / 1000)} seconds

**Draw Pattern:**
- Stock draws: ${stockDraws}
- Discard pile pickups: ${discardDraws}
- Discard pickup rate: ${discardPickupRate}%

${discardPickupRate > 40
    ? "_Tip: You're picking up from the discard pile frequently. While this can help form melds, it also reveals information to your opponent about your hand._"
    : discardPickupRate < 10 && totalDraws > 5
      ? "_Tip: You're rarely drawing from the discard pile. Consider picking up discard pile cards that directly complete melds — it can speed up your path to knocking._"
      : "_Tip: Your draw pattern looks balanced. Continue evaluating each discard pile card against your current hand needs._"
  }

_Configure your GEMINI_API_KEY for detailed, turn-by-turn AI coaching._`;
}

export default router;
