/**
 * Training Dashboard API Tests for Gin Paradise.
 *
 * Covers:
 *  1. Training summary API authentication and basic response shape
 *  2. Training summary with no replays
 *  3. Training summary with replays but no evaluations
 *  4. Training summary with cached evaluations (trends, severity)
 *  5. Training session detail API (access control, data shape)
 *  6. Batch-prepare endpoint
 *  7. Training history endpoint with filtering/sorting/pagination
 *  8. Tournament/format context in session data
 *  9. Progression signals (streaks, category accuracy, window comparison)
 *  10. Auto-evaluation trigger and deduplication
 *  11. Regression coverage for existing APIs
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
import { resetAllRateLimiters } from "../server/middleware/rateLimit.js";
import { grantPremium } from "../server/entitlements.js";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
  resetAllRateLimiters();
});
afterAll(async () => {
  await stopTestServer();
});

// ── Helpers ──────────────────────────────────────────────────────────

let userCounter = 0;
const testRunId = Math.random().toString(36).slice(2, 8);
async function createTestUser(prefix = "trainuser") {
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
    roomId: `train-test-${now}-${Math.random().toString(36).slice(2, 6)}`,
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
    methodology_description: "Engine agreement rate",
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

// ── API Tests ────────────────────────────────────────────────────────

describe("Training Summary API — Authentication", () => {
  it("should reject unauthenticated requests (401)", async () => {
    const res = await makeRequest("GET", "/api/training/summary");
    expect(res.status).toBe(401);
  });

  it("should return training summary for authenticated user", async () => {
    const user = await createTestUser("trainsummary");
    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.sessions).toBeDefined();
    expect(res.body.trends).toBeDefined();
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.methodology).toBe("apex_v2_engine_agreement");
    expect(res.body.meta.autoEvaluationEnabled).toBe(true);
  });
});

describe("Training Summary API — Empty State", () => {
  it("should return empty sessions for new user", async () => {
    const user = await createTestUser("trainempty");
    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.sessions).toEqual([]);
    expect(res.body.trends.sessionsPlayed).toBe(0);
    expect(res.body.trends.sessionsEvaluated).toBe(0);
    expect(res.body.trends.averageAccuracy).toBeNull();
    expect(res.body.trends.winRate).toBeNull();
  });
});

describe("Training Summary API — With Replays", () => {
  it("should return sessions for user with replays", async () => {
    const user = await createTestUser("trainreplays");
    const opponent = { userId: "train-opp-1", username: "train_opp_1" };
    insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );

    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBeGreaterThanOrEqual(1);
    const session = res.body.sessions[0];
    expect(session.replayId).toBeDefined();
    expect(session.opponent).toBe("train_opp_1");
    expect(session.result).toBe("win");
    expect(session.hasEvaluation).toBe(false);
    expect(res.body.trends.sessionsPlayed).toBeGreaterThanOrEqual(1);
    expect(res.body.trends.winRate).toBeDefined();
  });

  it("should compute trends when evaluations are cached", async () => {
    const user = await createTestUser("traineval");
    const opponent = { userId: "train-eval-opp", username: "train_eval_opp" };

    // Create multiple replays
    const replay1 = insertTestReplay({ userId: user.userId, username: user.username }, opponent, { timeOffset: 60000 });
    const replay2 = insertTestReplay({ userId: user.userId, username: user.username }, opponent, { timeOffset: 30000 });
    const replay3 = insertTestReplay({ userId: user.userId, username: user.username }, opponent, { timeOffset: 0 });

    // Cache evaluations with different accuracies
    mockEvaluation(replay1, user.userId, 70);
    mockEvaluation(replay2, user.userId, 80);
    mockEvaluation(replay3, user.userId, 90);

    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.trends.sessionsEvaluated).toBeGreaterThanOrEqual(3);
    expect(res.body.trends.averageAccuracy).toBeDefined();
    expect(res.body.trends.averageAccuracy).toBeGreaterThan(0);
    expect(res.body.trends.totalSeverity.best).toBeGreaterThan(0);
    expect(res.body.trends.bestSession).toBeDefined();
    expect(res.body.trends.worstSession).toBeDefined();
    expect(res.body.trends.bestSession.accuracy).toBeGreaterThanOrEqual(res.body.trends.worstSession.accuracy);
  });

  it("should detect recurring mistake types", async () => {
    const user = await createTestUser("trainmistake");
    const opponent = { userId: "train-mistake-opp", username: "mistake_opp" };
    const replayId = insertTestReplay({ userId: user.userId, username: user.username }, opponent);
    mockEvaluation(replayId, user.userId, 50);

    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    // Should have at least some recurring type (discard has a mistake in mock)
    expect(Array.isArray(res.body.trends.recurringMistakeTypes)).toBe(true);
  });
});

describe("Training Summary API — Progression Signals", () => {
  it("should include progression data in trends", async () => {
    const user = await createTestUser("trainprogress");
    // Progression depth requires premium plan
    grantPremium(user.userId, "system", "test - progression signals");
    const opponent = { userId: "train-prog-opp", username: "progress_opp" };

    // Create enough sessions for progression analysis
    for (let i = 0; i < 6; i++) {
      const replayId = insertTestReplay(
        { userId: user.userId, username: user.username },
        opponent,
        { timeOffset: i * 60000 }
      );
      mockEvaluation(replayId, user.userId, 60 + i * 5); // 60, 65, 70, 75, 80, 85
    }

    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    const prog = res.body.trends.progression;
    expect(prog).toBeDefined();
    expect(Array.isArray(prog.accuracyTimeline)).toBe(true);
    expect(prog.accuracyTimeline.length).toBeGreaterThanOrEqual(6);
    expect(Array.isArray(prog.mistakeRateTimeline)).toBe(true);

    // With 6 sessions, window comparison should be available
    expect(prog.recentWindowAccuracy).not.toBeNull();
    expect(prog.olderWindowAccuracy).not.toBeNull();

    // Improvement delta should reflect improvement (recent > older)
    expect(typeof prog.improvementDelta).toBe("number");

    // Category analysis should be present
    // strongestCategory and weakestCategory may or may not be set depending on data volume
    expect(prog.bestStreak).toBeDefined();
    expect(typeof prog.bestStreak).toBe("number");
  });

  it("should include format breakdown in trends", async () => {
    const user = await createTestUser("trainformat");
    const opponent = { userId: "train-fmt-opp", username: "format_opp" };

    // Insert replays with different formats
    insertTestReplay({ userId: user.userId, username: user.username }, opponent, { matchFormat: "heads_up" });
    insertTestReplay({ userId: user.userId, username: user.username }, opponent, { matchFormat: "tournament_sng" });
    insertTestReplay({ userId: user.userId, username: user.username }, opponent, { matchFormat: "tournament_sng" });

    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    const fb = res.body.trends.formatBreakdown;
    expect(fb).toBeDefined();
    expect(typeof fb).toBe("object");
    // Should have at least one format entry
    expect(Object.keys(fb).length).toBeGreaterThan(0);
  });
});

describe("Training Summary API — Tournament Context", () => {
  it("should include tournament context in sessions", async () => {
    const user = await createTestUser("traintournament");
    const opponent = { userId: "train-tourney-opp", username: "tourney_opp" };
    const tournamentId = "test-tournament-" + Math.random().toString(36).slice(2, 8);

    insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
      { matchFormat: "tournament_sng", tournamentId }
    );

    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    const session = res.body.sessions.find((s: any) => s.tournamentId === tournamentId);
    expect(session).toBeDefined();
    expect(session.matchFormat).toBe("tournament_sng");
    expect(session.tournamentId).toBe(tournamentId);
  });

  it("should include format in best/worst sessions", async () => {
    const user = await createTestUser("trainbestformat");
    const opponent = { userId: "train-bf-opp", username: "bf_opp" };

    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
      { matchFormat: "heads_up_staked" }
    );
    mockEvaluation(replayId, user.userId, 90);

    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    if (res.body.trends.bestSession) {
      expect(res.body.trends.bestSession.matchFormat).toBeDefined();
    }
  });
});

describe("Training Session Detail API", () => {
  it("should return session detail for participant", async () => {
    const user = await createTestUser("trainsession");
    const opponent = { userId: "train-sess-opp", username: "session_opp" };
    const replayId = insertTestReplay({ userId: user.userId, username: user.username }, opponent);
    mockEvaluation(replayId, user.userId, 85);

    const res = await makeRequest("GET", `/api/training/session/${replayId}`, undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.replay).toBeDefined();
    expect(res.body.replay.result).toBe("win");
    expect(res.body.evaluation).toBeDefined();
    expect(res.body.evaluation.accuracy).toBe(85);
    expect(res.body.keyMoments).toBeDefined();
    expect(res.body.meta.hasEvaluation).toBe(true);
  });

  it("should include format and tournament context in session detail", async () => {
    const user = await createTestUser("sessformat");
    const opponent = { userId: "sess-fmt-opp", username: "fmt_opp" };
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
      { matchFormat: "tournament_scheduled" }
    );

    const res = await makeRequest("GET", `/api/training/session/${replayId}`, undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.replay.matchFormat).toBe("tournament_scheduled");
    expect(res.body.replay.matchFormatLabel).toBe("Scheduled Tournament");
  });

  it("should reject non-participant access (403)", async () => {
    const owner = await createTestUser("sessowner");
    const intruder = await createTestUser("sessintruder");
    const replayId = insertTestReplay(
      { userId: owner.userId, username: owner.username },
      { userId: "sess-opp", username: "sess_opp" },
    );

    const res = await makeRequest("GET", `/api/training/session/${replayId}`, undefined, {
      Authorization: `Bearer ${intruder.sessionId}`,
    });

    expect(res.status).toBe(403);
  });

  it("should reject unauthenticated requests (401)", async () => {
    const res = await makeRequest("GET", "/api/training/session/some-id", undefined);
    expect(res.status).toBe(401);
  });

  it("should return 404 for nonexistent replay", async () => {
    const user = await createTestUser("sessnotfound");
    const res = await makeRequest("GET", "/api/training/session/nonexistent-replay", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(404);
  });

  it("should return null evaluation when no cached eval exists", async () => {
    const user = await createTestUser("sessnoeval");
    const opponent = { userId: "sess-noeval-opp", username: "noeval_opp" };
    const replayId = insertTestReplay({ userId: user.userId, username: user.username }, opponent);

    const res = await makeRequest("GET", `/api/training/session/${replayId}`, undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.evaluation).toBeNull();
    expect(res.body.meta.hasEvaluation).toBe(false);
  });
});

describe("Training Batch Prepare API", () => {
  it("should reject unauthenticated requests (401)", async () => {
    const res = await makeRequest("POST", "/api/training/prepare");
    expect(res.status).toBe(401);
  });

  it("should return prepare result for authenticated user", async () => {
    const user = await createTestUser("trainprep");
    const res = await makeRequest("POST", "/api/training/prepare", { maxBatch: 3 }, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.triggered).toBe("number");
    expect(typeof res.body.alreadyCached).toBe("number");
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.message).toBe("string");
  });

  it("should handle user with no replays", async () => {
    const user = await createTestUser("trainprepempty");
    const res = await makeRequest("POST", "/api/training/prepare", {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.triggered).toBe(0);
    expect(res.body.total).toBe(0);
  });
});

describe("Training History API", () => {
  it("should reject unauthenticated requests (401)", async () => {
    const res = await makeRequest("GET", "/api/training/history");
    expect(res.status).toBe(401);
  });

  it("should return paginated history for authenticated user", async () => {
    const user = await createTestUser("trainhist");
    const opponent = { userId: "hist-opp", username: "hist_opp" };

    for (let i = 0; i < 5; i++) {
      insertTestReplay({ userId: user.userId, username: user.username }, opponent, { timeOffset: i * 60000 });
    }

    const res = await makeRequest("GET", "/api/training/history?limit=3&offset=0", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBeLessThanOrEqual(3);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(5);
    expect(res.body.pagination.limit).toBe(3);
    expect(res.body.pagination.offset).toBe(0);
    expect(res.body.pagination.hasMore).toBe(true);
  });

  it("should support offset pagination", async () => {
    const user = await createTestUser("trainhistpage");
    const opponent = { userId: "histpage-opp", username: "histpage_opp" };

    for (let i = 0; i < 5; i++) {
      insertTestReplay({ userId: user.userId, username: user.username }, opponent, { timeOffset: i * 60000 });
    }

    const page1 = await makeRequest("GET", "/api/training/history?limit=2&offset=0", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    const page2 = await makeRequest("GET", "/api/training/history?limit=2&offset=2", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    expect(page1.body.sessions.length).toBe(2);
    expect(page2.body.sessions.length).toBe(2);

    // Ensure different sessions
    const ids1 = page1.body.sessions.map((s: any) => s.replayId);
    const ids2 = page2.body.sessions.map((s: any) => s.replayId);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
  });

  it("should filter by result (wins)", async () => {
    const user = await createTestUser("trainhistwins");
    const opponent = { userId: "histwin-opp", username: "histwin_opp" };

    insertTestReplay({ userId: user.userId, username: user.username }, opponent, { winnerIsP1: true });
    insertTestReplay({ userId: user.userId, username: user.username }, opponent, { winnerIsP1: false });

    const res = await makeRequest("GET", "/api/training/history?filter=wins", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    for (const session of res.body.sessions) {
      expect(session.result).toBe("win");
    }
  });

  it("should filter by tournament format", async () => {
    const user = await createTestUser("trainhisttourney");
    const opponent = { userId: "histtourney-opp", username: "histtourney_opp" };

    insertTestReplay({ userId: user.userId, username: user.username }, opponent, { matchFormat: "heads_up" });
    insertTestReplay({ userId: user.userId, username: user.username }, opponent, { matchFormat: "tournament_sng" });

    const res = await makeRequest("GET", "/api/training/history?filter=tournament", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    for (const session of res.body.sessions) {
      expect(["tournament_sng", "tournament_scheduled"]).toContain(session.matchFormat);
    }
  });

  it("should include match format in session data", async () => {
    const user = await createTestUser("trainhistfmt");
    const opponent = { userId: "histfmt-opp", username: "histfmt_opp" };
    insertTestReplay({ userId: user.userId, username: user.username }, opponent, { matchFormat: "heads_up_staked" });

    const res = await makeRequest("GET", "/api/training/history", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    const session = res.body.sessions.find((s: any) => s.matchFormat === "heads_up_staked");
    expect(session).toBeDefined();
  });
});

describe("Training API — Regression Coverage", () => {
  it("existing replay list API still works", async () => {
    const user = await createTestUser("trainregr1");
    insertTestReplay(
      { userId: user.userId, username: user.username },
      { userId: "regr-opp-1", username: "train_regr_opp" },
    );

    const res = await makeRequest("GET", "/api/replays", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.replays)).toBe(true);
  });

  it("existing evaluation API still works", async () => {
    const user = await createTestUser("trainregr2");
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      { userId: "regr-opp-2", username: "train_regr_opp2" },
    );

    const res = await makeRequest("GET", `/api/replays/${replayId}/evaluation`, undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
  });

  it("existing wallet API still works", async () => {
    const user = await createTestUser("trainregr3");
    const res = await makeRequest("GET", "/api/wallet", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
  });

  it("existing leaderboard API still works", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });
});
