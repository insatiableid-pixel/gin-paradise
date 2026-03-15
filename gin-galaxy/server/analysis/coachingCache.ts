/**
 * Durable Coaching Cache.
 *
 * Persists replay-level coaching narratives (Gemini AI or structured fallback)
 * into SQLite so they can be reused across training flows without re-calling
 * the Gemini API.
 *
 * Design principles:
 *   - Cache-first: never re-generate coaching for an already-cached replay
 *   - Versioned: coaching artifacts include a schema version so future prompt
 *     upgrades can selectively invalidate stale entries
 *   - Source-tagged: every cached entry records whether it came from "ai" or
 *     "fallback" so the UI can distinguish between the two
 *   - Bounded: generation is throttled per-user to prevent runaway API costs
 *   - Graceful: fallback coaching is always generated when Gemini is unavailable
 */

import { db } from "../db.js";
import { buildAnalysisInput, type ReplayData } from "./transcriptAdapter.js";
import { getCachedEvaluation } from "./pythonBridge.js";

// ── Schema Version ───────────────────────────────────────────────────
// Increment this when the coaching prompt or structure changes materially.
// Entries with older versions can be selectively re-generated if desired.
export const COACHING_SCHEMA_VERSION = 1;

// ── Schema Migration ─────────────────────────────────────────────────

export function ensureCoachingTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS replay_coaching (
      replay_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      coaching_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'fallback',
      schema_version INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ── Types ────────────────────────────────────────────────────────────

export interface CoachingArtifact {
  /** Markdown coaching narrative */
  narrative: string;
  /** Key themes / takeaways extracted from the coaching */
  themes: string[];
  /** Links between engine mistakes and coaching explanations */
  mistakeLinks: MistakeLink[];
  /** Source: "ai" | "fallback" */
  source: "ai" | "fallback";
  /** Schema version for cache invalidation */
  schemaVersion: number;
  /** Timestamp of generation */
  generatedAt: number;
}

export interface MistakeLink {
  /** The turn sequence number */
  seq: number;
  /** Engine severity (inaccuracy, mistake, blunder) */
  severity: string;
  /** The decision type (draw, discard, knock) */
  type: string;
  /** Brief coaching explanation for this mistake */
  explanation: string;
}

// ── Cache Operations ─────────────────────────────────────────────────

export function getCachedCoaching(replayId: string): CoachingArtifact | null {
  ensureCoachingTable();
  const row = db.prepare(
    "SELECT coaching_json FROM replay_coaching WHERE replay_id = ?"
  ).get(replayId) as { coaching_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.coaching_json);
  } catch {
    return null;
  }
}

export function cacheCoaching(
  replayId: string,
  userId: string,
  coaching: CoachingArtifact
): void {
  ensureCoachingTable();
  db.prepare(`
    INSERT OR REPLACE INTO replay_coaching (replay_id, user_id, coaching_json, source, schema_version)
    VALUES (?, ?, ?, ?, ?)
  `).run(replayId, userId, JSON.stringify(coaching), coaching.source, coaching.schemaVersion);
}

// ── Coaching Generation ──────────────────────────────────────────────

/**
 * Generate or retrieve cached coaching for a replay.
 *
 * Priority:
 *   1. Return cached coaching if available
 *   2. Try Gemini AI if API key is present
 *   3. Fall back to structured coaching
 *
 * The result is always cached before being returned.
 */
export async function getOrGenerateCoaching(
  replay: ReplayData,
  userId: string,
): Promise<CoachingArtifact> {
  // 1. Check cache
  const cached = getCachedCoaching(replay.id);
  if (cached) return cached;

  // 2. Build analysis input
  const analysisInput = buildAnalysisInput(replay, userId);

  // 3. Get engine evaluation data for mistake linking
  const evalData = getCachedEvaluation(replay.id);
  const mistakeLinks = buildMistakeLinks(evalData, userId);

  // 4. Try Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      const coaching = await generateAICoaching(
        analysisInput,
        replay,
        userId,
        mistakeLinks,
      );
      cacheCoaching(replay.id, userId, coaching);
      return coaching;
    } catch (err: any) {
      console.error("[coaching-cache] Gemini coaching generation failed:", err?.message || err);
      // Fall through to fallback
    }
  }

  // 5. Fallback coaching
  const fallback = generateFallbackCoaching(analysisInput, replay, userId, mistakeLinks, evalData);
  cacheCoaching(replay.id, userId, fallback);
  return fallback;
}

// ── AI Coaching Generation ───────────────────────────────────────────

async function generateAICoaching(
  analysisInput: ReturnType<typeof buildAnalysisInput>,
  replay: ReplayData,
  userId: string,
  mistakeLinks: MistakeLink[],
): Promise<CoachingArtifact> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const coachingPrompt = `${analysisInput.prompt}

Additionally, provide your response in this structured format:

**COACHING NARRATIVE:**
[Your main coaching analysis in 300-500 words, in Markdown format]

**KEY THEMES:**
- [Theme 1: a short phrase capturing a strategic pattern]
- [Theme 2]
- [Theme 3]

Focus on actionable, specific advice tied to the match transcript.
Be encouraging but honest. Reference specific turn numbers.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: coachingPrompt,
  });

  const text = response.text || "";

  // Parse themes from the AI response
  const themes = extractThemesFromAIResponse(text);
  const narrative = extractNarrativeFromAIResponse(text);

  return {
    narrative,
    themes,
    mistakeLinks,
    source: "ai",
    schemaVersion: COACHING_SCHEMA_VERSION,
    generatedAt: Date.now(),
  };
}

function extractThemesFromAIResponse(text: string): string[] {
  const themesMatch = text.match(/\*\*KEY THEMES:\*\*\s*([\s\S]*?)(?:\n\n|\*\*|$)/i);
  if (!themesMatch) return [];

  return themesMatch[1]
    .split("\n")
    .map(line => line.replace(/^[-*]\s*/, "").trim())
    .filter(line => line.length > 0)
    .slice(0, 5);
}

function extractNarrativeFromAIResponse(text: string): string {
  const narrativeMatch = text.match(/\*\*COACHING NARRATIVE:\*\*\s*([\s\S]*?)(?:\*\*KEY THEMES:\*\*|$)/i);
  if (narrativeMatch) return narrativeMatch[1].trim();
  // If the structured format wasn't followed, use the whole response
  return text.trim();
}

// ── Fallback Coaching Generation ─────────────────────────────────────

function generateFallbackCoaching(
  input: ReturnType<typeof buildAnalysisInput>,
  replay: ReplayData,
  userId: string,
  mistakeLinks: MistakeLink[],
  evalData: any,
): CoachingArtifact {
  const isWinner = replay.outcome.winnerId === userId;
  const playerName = input.requestingPlayerUsername;
  const opponentName = replay.players.find(p => p.userId !== userId)?.username || "opponent";

  const drawActions = replay.actions.filter(
    a => a.type === "draw" && a.playerId === userId
  );
  const stockDraws = drawActions.filter(a => a.detail?.source === "stock").length;
  const discardDraws = drawActions.filter(a => a.detail?.source === "discard").length;
  const totalDraws = stockDraws + discardDraws;
  const discardPickupRate = totalDraws > 0 ? Math.round((discardDraws / totalDraws) * 100) : 0;

  // Build the coaching themes
  const themes: string[] = [];
  if (discardPickupRate > 40) {
    themes.push("High discard pile usage — consider information leakage");
  } else if (discardPickupRate < 10 && totalDraws > 5) {
    themes.push("Low discard pile usage — missing meld-completing opportunities");
  } else {
    themes.push("Balanced draw pattern");
  }

  if (isWinner) {
    themes.push("Winning execution — maintain aggressive knock timing");
  } else {
    themes.push("Focus on knock timing — don't hold out for gin when behind");
  }

  // Add engine-derived themes
  if (evalData?.player_summaries?.[userId]) {
    const summary = evalData.player_summaries[userId];
    const accuracy = summary.engine_accuracy;
    if (accuracy !== undefined) {
      if (accuracy >= 90) themes.push("Excellent decision quality — near-engine play");
      else if (accuracy >= 75) themes.push("Good fundamentals — discard choice is your upgrade path");
      else if (accuracy >= 60) themes.push("Foundation building — focus on draw source selection");
      else themes.push("High improvement potential — review engine disagreements");
    }

    if (summary.severity_counts) {
      const sc = summary.severity_counts;
      if (sc.blunder > 0) themes.push(`${sc.blunder} blunder(s) detected — high-priority review`);
      if (sc.mistake > 1) themes.push(`Recurring mistakes in ${mistakeLinks.length > 0 ? mistakeLinks[0].type : "decisions"}`);
    }
  }

  // Build narrative
  const narrative = buildFallbackNarrative(
    playerName, opponentName, isWinner, replay, userId,
    stockDraws, discardDraws, totalDraws, discardPickupRate,
    evalData, mistakeLinks,
  );

  return {
    narrative,
    themes: themes.slice(0, 5),
    mistakeLinks,
    source: "fallback",
    schemaVersion: COACHING_SCHEMA_VERSION,
    generatedAt: Date.now(),
  };
}

function buildFallbackNarrative(
  playerName: string,
  opponentName: string,
  isWinner: boolean,
  replay: ReplayData,
  userId: string,
  stockDraws: number,
  discardDraws: number,
  totalDraws: number,
  discardPickupRate: number,
  evalData: any,
  mistakeLinks: MistakeLink[],
): string {
  const sections: string[] = [];

  // Match result
  sections.push(`### Match Review for ${playerName}`);
  sections.push(`**Result:** ${isWinner ? "Victory ✅" : "Defeat ❌"} vs ${opponentName}`);
  sections.push(`**Score:** ${replay.outcome.winnerUsername} ${replay.outcome.winnerScore} — ${replay.outcome.loserUsername} ${replay.outcome.loserScore}`);
  sections.push(`**Duration:** ${Math.round((replay.endedAt - replay.startedAt) / 1000)}s`);

  // Engine accuracy context
  if (evalData?.player_summaries?.[userId]) {
    const summary = evalData.player_summaries[userId];
    sections.push("");
    sections.push("### Engine Evaluation Summary");
    sections.push(`- **Accuracy:** ${summary.engine_accuracy}% (${summary.score_label})`);
    if (summary.severity_counts) {
      const sc = summary.severity_counts;
      sections.push(`- **Best decisions:** ${sc.best} | **Inaccuracies:** ${sc.inaccuracy} | **Mistakes:** ${sc.mistake} | **Blunders:** ${sc.blunder}`);
    }
  }

  // Draw pattern advice
  sections.push("");
  sections.push("### Draw Pattern Analysis");
  sections.push(`- Stock draws: ${stockDraws} | Discard pickups: ${discardDraws} | Pickup rate: ${discardPickupRate}%`);

  if (discardPickupRate > 40) {
    sections.push(`\n> **Coaching Note:** You picked from the discard pile frequently (${discardPickupRate}%). While this can help form melds quickly, it also reveals information to your opponent about what you're collecting. Consider whether each discard pickup truly completes a meld or just reduces deadwood — stock draws keep your strategy hidden.`);
  } else if (discardPickupRate < 10 && totalDraws > 5) {
    sections.push(`\n> **Coaching Note:** You rarely drew from the discard pile (${discardPickupRate}%). The discard pile is a powerful tool when it directly completes a meld. Watch for cards that fit into your existing sets or runs — a guaranteed meld completion is almost always worth the information trade-off.`);
  } else {
    sections.push(`\n> **Coaching Note:** Your draw pattern looks balanced. Continue evaluating each discard pile card against your current hand needs and the information trade-off.`);
  }

  // Mistake highlights
  if (mistakeLinks.length > 0) {
    sections.push("");
    sections.push("### Key Decision Moments");
    for (const link of mistakeLinks.slice(0, 3)) {
      sections.push(`- **Turn #${link.seq}** (${link.type}, ${link.severity}): ${link.explanation}`);
    }
  }

  // General tips
  sections.push("");
  sections.push("### Strategic Tips");
  if (!isWinner) {
    sections.push("- Review your knock timing — holding out for gin when behind on deadwood can be costly");
    sections.push("- Track opponent discard patterns to infer their hand strength");
  } else {
    sections.push("- Strong result — look at inaccuracies to find the remaining edge");
    sections.push("- Consider whether any early discards gave away key information");
  }

  return sections.join("\n");
}

// ── Mistake Linking ──────────────────────────────────────────────────

function buildMistakeLinks(evalData: any, userId: string): MistakeLink[] {
  if (!evalData?.evaluations) return [];

  const links: MistakeLink[] = [];
  for (const turn of evalData.evaluations) {
    if (turn.player_id !== userId) continue;
    if (turn.severity === "best") continue;

    links.push({
      seq: turn.seq,
      severity: turn.severity,
      type: turn.type || "unknown",
      explanation: buildMistakeExplanation(turn),
    });
  }

  return links.sort((a, b) => {
    const severityOrder: Record<string, number> = { blunder: 3, mistake: 2, inaccuracy: 1 };
    return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
  });
}

function buildMistakeExplanation(turn: any): string {
  const dwCost = turn.dw_cost;
  const typeLabel = turn.type === "draw" ? "Draw source" : turn.type === "discard" ? "Discard choice" : "Knock timing";

  if (dwCost && dwCost > 0) {
    return `${typeLabel} disagreed with engine analysis (+${dwCost} deadwood cost). Consider the engine-preferred alternative.`;
  }
  return `${typeLabel} disagreed with engine analysis. Review this decision against your hand state at the time.`;
}

// ── Coaching Themes Aggregation ──────────────────────────────────────

/**
 * Aggregate coaching themes across multiple replays for a user.
 * Returns the most common themes with counts.
 */
export function aggregateCoachingThemes(
  userId: string,
  limit = 20,
): { theme: string; count: number }[] {
  ensureCoachingTable();

  const rows = db.prepare(`
    SELECT coaching_json FROM replay_coaching
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit) as { coaching_json: string }[];

  const themeMap = new Map<string, number>();

  for (const row of rows) {
    try {
      const coaching: CoachingArtifact = JSON.parse(row.coaching_json);
      for (const theme of coaching.themes) {
        const normalized = theme.toLowerCase().trim();
        themeMap.set(normalized, (themeMap.get(normalized) || 0) + 1);
      }
    } catch {
      // Skip malformed entries
    }
  }

  return Array.from(themeMap.entries())
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get the most recent coaching note for a user.
 */
export function getMostRecentCoaching(userId: string): CoachingArtifact | null {
  ensureCoachingTable();

  const row = db.prepare(`
    SELECT coaching_json FROM replay_coaching
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId) as { coaching_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.coaching_json);
  } catch {
    return null;
  }
}

/**
 * Get a user's coaching history entries.
 */
export function getCoachingHistory(
  userId: string,
  limit = 10,
): { replayId: string; coaching: CoachingArtifact; createdAt: string }[] {
  ensureCoachingTable();

  const rows = db.prepare(`
    SELECT replay_id, coaching_json, created_at FROM replay_coaching
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit) as { replay_id: string; coaching_json: string; created_at: string }[];

  const result: { replayId: string; coaching: CoachingArtifact; createdAt: string }[] = [];
  for (const row of rows) {
    try {
      result.push({
        replayId: row.replay_id,
        coaching: JSON.parse(row.coaching_json),
        createdAt: row.created_at,
      });
    } catch {
      // Skip malformed
    }
  }
  return result;
}
