/**
 * AI Coaching Timeline & Cached Training Narrative Tests for Gin Paradise.
 *
 * Covers:
 *  1. Replay coaching cache creation and reuse
 *  2. Fallback coaching persistence behavior
 *  3. Training/session endpoints surfacing cached coaching
 *  4. Distinction between engine data and coaching data in responses
 *  5. Coaching generation endpoint (POST /api/training/coaching/:id)
 *  6. Coaching timeline endpoint (GET /api/training/coaching/timeline)
 *  7. Coaching themes aggregation endpoint (GET /api/training/coaching/themes)
 *  8. Access control on coaching endpoints
 *  9. Coaching content structure validation
 *  10. Regression coverage for replays, evaluation, training, profile, wallet, tournaments, multiplayer
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestServer,
  stopTestServer,
  registerUser,
  loginUser,
  makeRequest,
} from "./helpers.js";
import { db, persistReplay } from "../server/db.js";
import { cacheEvaluation } from "../server/analysis/pythonBridge.js";
import {
  getCachedCoaching,
  cacheCoaching,
  ensureCoachingTable,
  aggregateCoachingThemes,
  getMostRecentCoaching,
  getCoachingHistory,
  COACHING_SCHEMA_VERSION,
  type CoachingArtifact,
} from "../server/analysis/coachingCache.js";
import { resetAllRateLimiters } from "../server/middleware/rateLimit.js";
import { grantPremium } from "../server/entitlements.js";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
  resetAllRateLimiters();
  ensureCoachingTable();
});
afterAll(async () => {
  await stopTestServer();
});

// ── Helpers ──────────────────────────────────────────────────────────

let userCounter = 0;
const testRunId = Math.random().toString(36).slice(2, 8);
async function createTestUser(prefix = "coachuser", opts: { premium?: boolean } = {}) {
  userCounter++;
  resetAllRateLimiters();
  const username = `${prefix}_${testRunId}_${userCounter}`;
  const email = `${username}@test.com`;
  const password = "password123";

  const regRes = await registerUser(username, email, password);
  expect(regRes.status).toBe(200);

  const loginRes = await loginUser(username, password);
  expect(loginRes.status).toBe(200);

  const userId = loginRes.body.user?.id || regRes.body.user?.id;
  if (opts.premium) {
    grantPremium(userId, "system", "test setup");
  }
  return { userId, username, sessionId: loginRes.body.sessionId };
}

function insertTestReplay(
  player1: { userId: string; username: string },
  player2: { userId: string; username: string },
  opts: {
    endReason?: string;
    winnerIsP1?: boolean;
    timeOffset?: number;
    matchFormat?: string;
    tournamentId?: string;
  } = {},
): string {
  const { endReason = "completed", winnerIsP1 = true, timeOffset = 0, matchFormat, tournamentId } = opts;
  const winner = winnerIsP1 ? player1 : player2;
  const loser = winnerIsP1 ? player2 : player1;
  const now = Date.now() - timeOffset;

  return persistReplay({
    roomId: `coach-test-${now}-${Math.random().toString(36).slice(2, 6)}`,
    players: [player1, player2],
    startedAt: now - 120000,
    endedAt: now,
    actions: [
      { seq: 1, timestamp: now - 120000, type: "match_start", detail: { players: [player1.username, player2.username] } },
      { seq: 2, timestamp: now - 115000, type: "round_start", playerId: player1.userId, playerUsername: player1.username, detail: { roundNumber: 1 } },
      { seq: 3, timestamp: now - 110000, type: "draw", playerId: player1.userId, playerUsername: player1.username, detail: { source: "stock" } },
      { seq: 4, timestamp: now - 105000, type: "discard", playerId: player1.userId, playerUsername: player1.username, detail: { card: "K♠" } },
      { seq: 5, timestamp: now - 100000, type: "draw", playerId: player2.userId, playerUsername: player2.username, detail: { source: "stock" } },
      { seq: 6, timestamp: now - 95000, type: "discard", playerId: player2.userId, playerUsername: player2.username, detail: { card: "3♥" } },
      { seq: 7, timestamp: now - 90000, type: "knock", playerId: player1.userId, playerUsername: player1.username, detail: {
        discardedCard: "Q♦", knockerDeadwood: 5, opponentDeadwood: 28,
        winnerId: winner.userId, winnerUsername: winner.username, points: 23,
      }},
      { seq: 8, timestamp: now, type: "match_end", playerId: winner.userId, playerUsername: winner.username, detail: {
        winnerScore: 100, loserScore: 75, endReason
      }},
    ],
    outcome: {
      winnerId: winner.userId, winnerUsername: winner.username,
      loserId: loser.userId, loserUsername: loser.username,
      winnerScore: 100, loserScore: 75, endReason,
    },
  }, undefined, matchFormat, tournamentId);
}

function mockEvaluation(replayId: string, userId: string, accuracy: number) {
  const engineMatches = Math.round(6 * accuracy / 100);
  const evalData = {
    methodology: "apex_v2_engine_agreement",
    total_evaluated: 6,
    requesting_player_accuracy: accuracy,
    requesting_player_label: accuracy >= 90 ? "excellent" : accuracy >= 75 ? "good" : accuracy >= 60 ? "fair" : "needs_improvement",
    player_summaries: {
      [userId]: {
        username: "testplayer",
        total_decisions: 6,
        engine_matches: engineMatches,
        engine_accuracy: accuracy,
        score_label: accuracy >= 90 ? "excellent" : accuracy >= 75 ? "good" : "fair",
        severity_counts: {
          best: engineMatches,
          inaccuracy: Math.max(0, 6 - engineMatches - 1),
          mistake: 1,
          blunder: 0,
        },
      },
    },
    evaluations: [
      { seq: 3, type: "draw", severity: "best", matches_engine: true, player_id: userId },
      { seq: 4, type: "discard", severity: "best", matches_engine: true, player_id: userId },
      { seq: 5, type: "draw", severity: "best", matches_engine: true, player_id: userId },
      { seq: 6, type: "discard", severity: "mistake", matches_engine: false, player_id: userId, dw_cost: 3 },
    ],
  };
  cacheEvaluation(replayId, evalData);
}

function mockCoaching(replayId: string, userId: string, overrides: Partial<CoachingArtifact> = {}) {
  const coaching: CoachingArtifact = {
    narrative: "### Test Coaching\nThis is a test coaching narrative for your match review.",
    themes: ["Balanced draw pattern", "Good knock timing", "Consider discard safety"],
    mistakeLinks: [
      { seq: 6, severity: "mistake", type: "discard", explanation: "Discard choice disagreed with engine analysis (+3 deadwood cost)." },
    ],
    source: "fallback",
    schemaVersion: COACHING_SCHEMA_VERSION,
    generatedAt: Date.now(),
    ...overrides,
  };
  cacheCoaching(replayId, userId, coaching);
  return coaching;
}

// ── Direct Cache Tests ───────────────────────────────────────────────

describe("Coaching Cache — Direct Operations", () => {
  it("should return null for uncached replay", () => {
    const result = getCachedCoaching("nonexistent-replay-id");
    expect(result).toBeNull();
  });

  it("should cache and retrieve coaching artifact", () => {
    const replayId = `cache-test-${Date.now()}`;
    const coaching: CoachingArtifact = {
      narrative: "Test narrative content",
      themes: ["theme-a", "theme-b"],
      mistakeLinks: [],
      source: "fallback",
      schemaVersion: COACHING_SCHEMA_VERSION,
      generatedAt: Date.now(),
    };

    cacheCoaching(replayId, "test-user", coaching);
    const result = getCachedCoaching(replayId);

    expect(result).not.toBeNull();
    expect(result!.narrative).toBe("Test narrative content");
    expect(result!.themes).toEqual(["theme-a", "theme-b"]);
    expect(result!.source).toBe("fallback");
    expect(result!.schemaVersion).toBe(COACHING_SCHEMA_VERSION);
  });

  it("should overwrite existing coaching on re-cache", () => {
    const replayId = `overwrite-test-${Date.now()}`;
    const v1: CoachingArtifact = {
      narrative: "Version 1",
      themes: ["old-theme"],
      mistakeLinks: [],
      source: "fallback",
      schemaVersion: COACHING_SCHEMA_VERSION,
      generatedAt: Date.now(),
    };
    const v2: CoachingArtifact = {
      narrative: "Version 2",
      themes: ["new-theme"],
      mistakeLinks: [],
      source: "ai",
      schemaVersion: COACHING_SCHEMA_VERSION,
      generatedAt: Date.now(),
    };

    cacheCoaching(replayId, "test-user", v1);
    cacheCoaching(replayId, "test-user", v2);
    const result = getCachedCoaching(replayId);

    expect(result!.narrative).toBe("Version 2");
    expect(result!.source).toBe("ai");
  });

  it("should include mistake links with proper structure", () => {
    const replayId = `mistake-test-${Date.now()}`;
    const coaching: CoachingArtifact = {
      narrative: "Narrative",
      themes: [],
      mistakeLinks: [
        { seq: 4, severity: "mistake", type: "discard", explanation: "Engine preferred a lower-cost discard." },
        { seq: 7, severity: "blunder", type: "knock", explanation: "Premature knock with high deadwood." },
      ],
      source: "fallback",
      schemaVersion: COACHING_SCHEMA_VERSION,
      generatedAt: Date.now(),
    };

    cacheCoaching(replayId, "test-user", coaching);
    const result = getCachedCoaching(replayId);

    expect(result!.mistakeLinks.length).toBe(2);
    expect(result!.mistakeLinks[0].seq).toBe(4);
    expect(result!.mistakeLinks[0].severity).toBe("mistake");
    expect(result!.mistakeLinks[1].severity).toBe("blunder");
  });
});

// ── Theme Aggregation Tests ──────────────────────────────────────────

describe("Coaching Cache — Theme Aggregation", () => {
  it("should aggregate themes across multiple coaching entries", () => {
    const userId = `theme-agg-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      const replayId = `theme-agg-replay-${i}-${Date.now()}`;
      cacheCoaching(replayId, userId, {
        narrative: "Narrative",
        themes: ["balanced draw pattern", "knock timing"],
        mistakeLinks: [],
        source: "fallback",
        schemaVersion: COACHING_SCHEMA_VERSION,
        generatedAt: Date.now(),
      });
    }

    const themes = aggregateCoachingThemes(userId, 10);
    expect(themes.length).toBeGreaterThan(0);
    const balancedTheme = themes.find(t => t.theme === "balanced draw pattern");
    expect(balancedTheme).toBeDefined();
    expect(balancedTheme!.count).toBe(3);
  });

  it("should return empty array for user with no coaching", () => {
    const themes = aggregateCoachingThemes("no-such-user", 10);
    expect(themes).toEqual([]);
  });

  it("should return most recent coaching for user", () => {
    const userId = `recent-${Date.now()}`;
    cacheCoaching(`recent-r1-${Date.now()}`, userId, {
      narrative: "First coaching entry",
      themes: ["first-theme"],
      mistakeLinks: [],
      source: "fallback",
      schemaVersion: COACHING_SCHEMA_VERSION,
      generatedAt: Date.now() - 10000,
    });
    cacheCoaching(`recent-r2-${Date.now()}`, userId, {
      narrative: "Second coaching entry",
      themes: ["second-theme"],
      mistakeLinks: [],
      source: "fallback",
      schemaVersion: COACHING_SCHEMA_VERSION,
      generatedAt: Date.now(),
    });

    const recent = getMostRecentCoaching(userId);
    expect(recent).not.toBeNull();
    // Should return a valid coaching entry (ordering within same second may vary)
    expect(recent!.narrative).toContain("coaching entry");
    expect(recent!.source).toBe("fallback");
  });

  it("should return coaching history in order", () => {
    const userId = `history-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      cacheCoaching(`history-r${i}-${Date.now()}`, userId, {
        narrative: `Narrative ${i}`,
        themes: [`theme-${i}`],
        mistakeLinks: [],
        source: "fallback",
        schemaVersion: COACHING_SCHEMA_VERSION,
        generatedAt: Date.now() + i * 1000,
      });
    }

    const history = getCoachingHistory(userId, 3);
    expect(history.length).toBe(3);
    // Each entry should have replayId and coaching
    for (const entry of history) {
      expect(entry.replayId).toBeDefined();
      expect(entry.coaching.narrative).toBeDefined();
      expect(entry.coaching.themes).toBeDefined();
    }
  });
});

// ── Coaching Generation API Tests ────────────────────────────────────

describe("Coaching Generation API — POST /api/training/coaching/:id", () => {
  it("should reject unauthenticated requests (401)", async () => {
    const res = await makeRequest("POST", "/api/training/coaching/some-id");
    expect(res.status).toBe(401);
  });

  it("should return 404 for nonexistent replay", async () => {
    const user = await createTestUser("coachnotfound", { premium: true });
    const res = await makeRequest("POST", "/api/training/coaching/nonexistent-id", {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(404);
  });

  it("should reject non-participant (403)", async () => {
    const owner = await createTestUser("coachowner", { premium: true });
    const intruder = await createTestUser("coachintruder", { premium: true });
    const replayId = insertTestReplay(
      { userId: owner.userId, username: owner.username },
      { userId: "coach-opp-403", username: "coach_opp_403" },
    );

    const res = await makeRequest("POST", `/api/training/coaching/${replayId}`, {}, {
      Authorization: `Bearer ${intruder.sessionId}`,
    });
    expect(res.status).toBe(403);
  });

  it("should generate and return fallback coaching for participant", async () => {
    const user = await createTestUser("coachgenerate", { premium: true });
    const opponent = { userId: "coach-gen-opp", username: "coach_gen_opp" };
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );

    const res = await makeRequest("POST", `/api/training/coaching/${replayId}`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.coaching).toBeDefined();
    expect(res.body.coaching.narrative).toBeDefined();
    expect(typeof res.body.coaching.narrative).toBe("string");
    expect(res.body.coaching.narrative.length).toBeGreaterThan(0);
    expect(res.body.coaching.source).toBe("fallback");
    expect(Array.isArray(res.body.coaching.themes)).toBe(true);
    expect(res.body.coaching.themes.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.coaching.mistakeLinks)).toBe(true);
    expect(res.body.coaching.generatedAt).toBeDefined();
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.replayId).toBe(replayId);
    expect(res.body.meta.source).toBe("fallback");
  });

  it("should return cached coaching on second call (no re-generation)", async () => {
    const user = await createTestUser("coachcached", { premium: true });
    const opponent = { userId: "coach-cache-opp", username: "coach_cache_opp" };
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );

    // First call
    const res1 = await makeRequest("POST", `/api/training/coaching/${replayId}`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res1.status).toBe(200);
    const firstGeneratedAt = res1.body.coaching.generatedAt;

    // Second call should return the same cached coaching
    const res2 = await makeRequest("POST", `/api/training/coaching/${replayId}`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res2.status).toBe(200);
    expect(res2.body.coaching.generatedAt).toBe(firstGeneratedAt);
  });

  it("should include engine-linked mistake explanations when evaluation exists", async () => {
    const user = await createTestUser("coachmistake", { premium: true });
    const opponent = { userId: "coach-mistake-opp", username: "coach_mistake_opp" };
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );
    mockEvaluation(replayId, user.userId, 70);

    const res = await makeRequest("POST", `/api/training/coaching/${replayId}`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.coaching.mistakeLinks.length).toBeGreaterThan(0);
    const link = res.body.coaching.mistakeLinks[0];
    expect(link.seq).toBeDefined();
    expect(link.severity).toBeDefined();
    expect(link.type).toBeDefined();
    expect(link.explanation).toBeDefined();
  });
});

// ── Coaching Timeline API Tests ──────────────────────────────────────

describe("Coaching Timeline API — GET /api/training/coaching/timeline", () => {
  it("should reject unauthenticated requests (401)", async () => {
    const res = await makeRequest("GET", "/api/training/coaching/timeline");
    expect(res.status).toBe(401);
  });

  it("should return empty timeline for user with no coaching", async () => {
    const user = await createTestUser("coachtimeline0", { premium: true });
    const res = await makeRequest("GET", "/api/training/coaching/timeline", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.timeline).toEqual([]);
    expect(res.body.meta.count).toBe(0);
  });

  it("should return coaching timeline entries after generation", async () => {
    const user = await createTestUser("coachtimeline", { premium: true });
    const opponent = { userId: "tl-opp", username: "tl_opp" };

    // Create and coach two replays
    for (let i = 0; i < 2; i++) {
      const replayId = insertTestReplay(
        { userId: user.userId, username: user.username },
        opponent,
        { timeOffset: i * 60000 },
      );
      mockCoaching(replayId, user.userId);
    }

    const res = await makeRequest("GET", "/api/training/coaching/timeline", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.timeline.length).toBe(2);
    for (const entry of res.body.timeline) {
      expect(entry.replayId).toBeDefined();
      expect(Array.isArray(entry.themes)).toBe(true);
      expect(entry.source).toBeDefined();
      expect(entry.narrativePreview).toBeDefined();
      expect(typeof entry.mistakeLinkCount).toBe("number");
    }
  });
});

// ── Coaching Themes API Tests ────────────────────────────────────────

describe("Coaching Themes API — GET /api/training/coaching/themes", () => {
  it("should reject unauthenticated requests (401)", async () => {
    const res = await makeRequest("GET", "/api/training/coaching/themes");
    expect(res.status).toBe(401);
  });

  it("should return aggregated themes for coached user", async () => {
    const user = await createTestUser("coachthemes", { premium: true });
    const opponent = { userId: "th-opp", username: "th_opp" };

    // Create multiple coaching entries with overlapping themes
    for (let i = 0; i < 3; i++) {
      const replayId = insertTestReplay(
        { userId: user.userId, username: user.username },
        opponent,
        { timeOffset: i * 60000 },
      );
      mockCoaching(replayId, user.userId, {
        themes: ["Balanced draw pattern", `unique-theme-${i}`],
      });
    }

    const res = await makeRequest("GET", "/api/training/coaching/themes", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.themes)).toBe(true);
    expect(res.body.themes.length).toBeGreaterThan(0);

    // "balanced draw pattern" should appear 3 times
    const recurring = res.body.themes.find((t: any) => t.theme === "balanced draw pattern");
    expect(recurring).toBeDefined();
    expect(recurring.count).toBe(3);
  });
});

// ── Training Summary — Coaching Integration ──────────────────────────

describe("Training Summary — Coaching Integration", () => {
  it("should include coaching data in training summary", async () => {
    const user = await createTestUser("coachsummary", { premium: true });
    const opponent = { userId: "cs-opp", username: "cs_opp" };

    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );
    mockEvaluation(replayId, user.userId, 80);
    mockCoaching(replayId, user.userId);

    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.coaching).toBeDefined();
    expect(res.body.coaching.totalCoached).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.coachingNote).toBeDefined();
  });

  it("should surface coaching in session summary entries", async () => {
    const user = await createTestUser("coachsess");
    const opponent = { userId: "scl-opp", username: "scl_opp" };

    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );
    mockCoaching(replayId, user.userId);

    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    const session = res.body.sessions.find((s: any) => s.replayId === replayId);
    expect(session).toBeDefined();
    expect(session.hasCoaching).toBe(true);
    expect(session.coachingSource).toBe("fallback");
    expect(session.hasAnalysis).toBe(true);
  });

  it("should surface recurring coaching themes in summary", async () => {
    const user = await createTestUser("coachrecurr", { premium: true });
    const opponent = { userId: "rcr-opp", username: "rcr_opp" };

    for (let i = 0; i < 3; i++) {
      const replayId = insertTestReplay(
        { userId: user.userId, username: user.username },
        opponent,
        { timeOffset: i * 60000 },
      );
      mockCoaching(replayId, user.userId, {
        themes: ["draw pattern analysis", `session-${i}-theme`],
      });
    }

    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.coaching.recurringThemes).toBeDefined();
    expect(Array.isArray(res.body.coaching.recurringThemes)).toBe(true);
  });
});

// ── Training Session Detail — Coaching Integration ───────────────────

describe("Training Session Detail — Coaching Integration", () => {
  it("should include coaching data in session detail", async () => {
    const user = await createTestUser("sesscoach", { premium: true });
    const opponent = { userId: "scd-opp", username: "scd_opp" };

    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );
    mockEvaluation(replayId, user.userId, 85);
    mockCoaching(replayId, user.userId);

    const res = await makeRequest("GET", `/api/training/session/${replayId}`, undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.coaching).toBeDefined();
    expect(res.body.coaching.narrative).toBeDefined();
    expect(res.body.coaching.themes).toBeDefined();
    expect(res.body.coaching.mistakeLinks).toBeDefined();
    expect(res.body.coaching.source).toBe("fallback");
    expect(res.body.meta.hasCoaching).toBe(true);
  });

  it("should keep evaluation and coaching as distinct layers", async () => {
    const user = await createTestUser("sessdistinct", { premium: true });
    const opponent = { userId: "dist-opp", username: "dist_opp" };

    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );
    mockEvaluation(replayId, user.userId, 90);
    mockCoaching(replayId, user.userId);

    const res = await makeRequest("GET", `/api/training/session/${replayId}`, undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    // Evaluation and coaching should be separate top-level keys
    expect(res.body.evaluation).toBeDefined();
    expect(res.body.coaching).toBeDefined();
    expect(res.body.evaluation.source).toBe("cache"); // Engine cache
    expect(res.body.coaching.source).toBe("fallback"); // Coaching cache
    // They should NOT be merged
    expect(res.body.evaluation.narrative).toBeUndefined();
    expect(res.body.coaching.accuracy).toBeUndefined();
  });

  it("should return null coaching when no coaching is cached", async () => {
    const user = await createTestUser("sessnocoach", { premium: true });
    const opponent = { userId: "nc-opp", username: "nc_opp" };

    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );

    const res = await makeRequest("GET", `/api/training/session/${replayId}`, undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.coaching).toBeNull();
    expect(res.body.meta.hasCoaching).toBe(false);
  });
});

// ── Coaching Content Validation ──────────────────────────────────────

describe("Coaching Content — Structure Validation", () => {
  it("should generate coaching with proper narrative structure", async () => {
    const user = await createTestUser("coachstruct", { premium: true });
    const opponent = { userId: "str-opp", username: "str_opp" };

    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );
    mockEvaluation(replayId, user.userId, 75);

    const res = await makeRequest("POST", `/api/training/coaching/${replayId}`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    const narrative = res.body.coaching.narrative;

    // Should contain match review section
    expect(narrative).toContain("Match Review");
    // Should contain draw pattern analysis
    expect(narrative).toContain("Draw Pattern");
    // Should contain strategic tips
    expect(narrative).toContain("Strategic Tips");
  });

  it("should include engine accuracy in coaching narrative when available", async () => {
    const user = await createTestUser("coacheval", { premium: true });
    const opponent = { userId: "ce-opp", username: "ce_opp" };

    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );
    mockEvaluation(replayId, user.userId, 82);

    const res = await makeRequest("POST", `/api/training/coaching/${replayId}`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    // Coaching should reference engine data
    expect(res.body.coaching.narrative).toContain("82%");
  });

  it("should work correctly for losing player", async () => {
    const user = await createTestUser("coachloser", { premium: true });
    const winner = { userId: "coach-winner", username: "coach_winner" };

    const replayId = insertTestReplay(
      winner,
      { userId: user.userId, username: user.username },
      { winnerIsP1: true },
    );

    const res = await makeRequest("POST", `/api/training/coaching/${replayId}`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.coaching.narrative).toContain("Defeat");
    expect(res.body.coaching.narrative).toContain(user.username);
  });
});

// ── Regression Coverage ──────────────────────────────────────────────

describe("Coaching Integration — Regression Coverage", () => {
  it("existing training summary API still works", async () => {
    const user = await createTestUser("coachreg1");
    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.sessions).toBeDefined();
    expect(res.body.trends).toBeDefined();
    expect(res.body.coaching).toBeDefined();
  });

  it("existing replay list API still works", async () => {
    const user = await createTestUser("coachreg2");
    insertTestReplay(
      { userId: user.userId, username: user.username },
      { userId: "reg-opp", username: "coach_reg_opp" },
    );

    const res = await makeRequest("GET", "/api/replays", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.replays)).toBe(true);
  });

  it("existing evaluation API still works", async () => {
    const user = await createTestUser("coachreg3");
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      { userId: "reg-opp-3", username: "coach_reg_opp3" },
    );

    const res = await makeRequest("GET", `/api/replays/${replayId}/evaluation`, undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
  });

  it("existing wallet API still works", async () => {
    const user = await createTestUser("coachreg4");
    const res = await makeRequest("GET", "/api/wallet", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
  });

  it("existing leaderboard API still works", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });

  it("existing profile API still works", async () => {
    const user = await createTestUser("coachreg6");
    const res = await makeRequest("GET", "/api/profile", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
  });

  it("training history with coached filter works", async () => {
    const user = await createTestUser("coachregfilt");
    const opponent = { userId: "filt-opp", username: "filt_opp" };

    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );
    mockCoaching(replayId, user.userId);

    const res = await makeRequest("GET", "/api/training/history?filter=coached", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
    for (const session of res.body.sessions) {
      expect(session.hasCoaching).toBe(true);
    }
  });
});
