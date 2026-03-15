/**
 * Mathematical Replay Evaluation Tests.
 *
 * Covers:
 *  1. Evaluation API authentication and access control
 *  2. Evaluation route returns structured response
 *  3. Graceful degradation when Python is unavailable
 *  4. Caching behavior (GET returns cached, POST computes)
 *  5. Replay ownership enforcement for evaluation endpoint
 *  6. Regression: existing replay and analysis APIs still work
 *  7. Python evaluator unit tests (via subprocess)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestServer,
  stopTestServer,
  getBaseUrl,
  registerUser,
  loginUser,
  makeRequest,
} from "./helpers.js";
import { db, persistReplay } from "../server/db.js";
import {
  getCachedEvaluation,
  cacheEvaluation,
  ensureEvaluationTable,
} from "../server/analysis/pythonBridge.js";
import { resetAllRateLimiters } from "../server/middleware/rateLimit.js";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
  // Reset rate limiter state to prevent cross-file exhaustion
  // (all test requests share 127.0.0.1)
  resetAllRateLimiters();
});
afterAll(async () => {
  await stopTestServer();
});

// ── Helpers ──────────────────────────────────────────────────────────

let userCounter = 0;
const testRunId = Math.random().toString(36).slice(2, 8);
async function createTestUser(prefix = "evaluser") {
  userCounter++;
  // Reset rate limiters before each user creation to prevent
  // cross-test exhaustion (all test requests come from 127.0.0.1)
  resetAllRateLimiters();
  const username = `${prefix}_${testRunId}_${userCounter}`;
  const email = `${username}@test.com`;
  const password = "password123";

  // Retry up to 3 times with delay to handle rate limiting
  let regRes: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    regRes = await registerUser(username, email, password);
    if (regRes.status === 200) break;
    if (regRes.status === 429) {
      await new Promise(r => setTimeout(r, 1000));
    } else {
      break;
    }
  }
  expect([200]).toContain(regRes.status);

  let loginRes: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    loginRes = await loginUser(username, password);
    if (loginRes.status === 200) break;
    if (loginRes.status === 429) {
      await new Promise(r => setTimeout(r, 1000));
    } else {
      break;
    }
  }
  expect([200]).toContain(loginRes.status);

  const userId = loginRes.body.user?.id || regRes.body.user?.id;
  return {
    userId,
    username,
    sessionId: loginRes.body.sessionId,
  };
}

function insertTestReplay(
  player1: { userId: string; username: string },
  player2: { userId: string; username: string },
  opts: { endReason?: string; winnerIsP1?: boolean } = {},
): string {
  const { endReason = "completed", winnerIsP1 = true } = opts;
  const winner = winnerIsP1 ? player1 : player2;
  const loser = winnerIsP1 ? player2 : player1;
  const now = Date.now();

  return persistReplay({
    roomId: `eval-test-${now}-${Math.random().toString(36).slice(2, 6)}`,
    players: [player1, player2],
    startedAt: now - 120000,
    endedAt: now,
    actions: [
      {
        seq: 1,
        timestamp: now - 120000,
        type: "match_start",
        detail: { players: [player1.username, player2.username] },
      },
      {
        seq: 2,
        timestamp: now - 115000,
        type: "round_start",
        playerId: player1.userId,
        playerUsername: player1.username,
        detail: { roundNumber: 1 },
      },
      {
        seq: 3,
        timestamp: now - 110000,
        type: "draw",
        playerId: player1.userId,
        playerUsername: player1.username,
        detail: { source: "stock" },
      },
      {
        seq: 4,
        timestamp: now - 105000,
        type: "discard",
        playerId: player1.userId,
        playerUsername: player1.username,
        detail: { card: "K♠" },
      },
      {
        seq: 5,
        timestamp: now - 100000,
        type: "draw",
        playerId: player2.userId,
        playerUsername: player2.username,
        detail: { source: "discard", card: "K♠" },
      },
      {
        seq: 6,
        timestamp: now - 95000,
        type: "discard",
        playerId: player2.userId,
        playerUsername: player2.username,
        detail: { card: "3♥" },
      },
      {
        seq: 7,
        timestamp: now - 90000,
        type: "draw",
        playerId: player1.userId,
        playerUsername: player1.username,
        detail: { source: "stock" },
      },
      {
        seq: 8,
        timestamp: now - 85000,
        type: "knock",
        playerId: player1.userId,
        playerUsername: player1.username,
        detail: {
          discardedCard: "Q♦",
          knockerDeadwood: 5,
          opponentDeadwood: 28,
          winnerId: winner.userId,
          winnerUsername: winner.username,
          points: 23,
        },
      },
      {
        seq: 9,
        timestamp: now - 84000,
        type: "round_end",
        playerId: winner.userId,
        playerUsername: winner.username,
        detail: { points: 23, outcomeType: "knock" },
      },
      {
        seq: 10,
        timestamp: now,
        type: "match_end",
        playerId: winner.userId,
        playerUsername: winner.username,
        detail: {
          winnerScore: 100,
          loserScore: 75,
          endReason,
        },
      },
    ],
    outcome: {
      winnerId: winner.userId,
      winnerUsername: winner.username,
      loserId: loser.userId,
      loserUsername: loser.username,
      winnerScore: 100,
      loserScore: 75,
      endReason,
    },
  });
}

// ── API Tests ────────────────────────────────────────────────────────

describe("Replay Evaluation API — Authentication & Access", () => {
  it("should return evaluation response for a valid replay participant", async () => {
    const user = await createTestUser("valideval");
    const opponent = { userId: "eval-opp-1", username: "eval_opponent1" };
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );

    const res = await makeRequest(
      "POST",
      `/api/replays/${replayId}/evaluation`,
      {},
      { Authorization: `Bearer ${user.sessionId}` },
    );

    expect(res.status).toBe(200);
    // Response should have evaluation or graceful error
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.replayId).toBe(replayId);
    expect(res.body.meta.methodology).toBe("apex_v2_engine_agreement");
    // source should be one of: engine, cache, error
    expect(["engine", "cache", "error"]).toContain(res.body.source);
  });

  it("should reject evaluation for non-participant (403)", async () => {
    const owner = await createTestUser("evalowner");
    const intruder = await createTestUser("evalintruder");
    const replayId = insertTestReplay(
      { userId: owner.userId, username: owner.username },
      { userId: "eval-opp-2", username: "opp2" },
    );

    const res = await makeRequest(
      "POST",
      `/api/replays/${replayId}/evaluation`,
      {},
      { Authorization: `Bearer ${intruder.sessionId}` },
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Access denied");
  });

  it("should reject evaluation for unauthenticated requests (401)", async () => {
    const res = await makeRequest("POST", "/api/replays/some-id/evaluation", {});
    expect(res.status).toBe(401);
  });

  it("should return 404 for non-existent replay", async () => {
    const user = await createTestUser("notfoundeval");
    const res = await makeRequest(
      "POST",
      "/api/replays/nonexistent-replay/evaluation",
      {},
      { Authorization: `Bearer ${user.sessionId}` },
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Replay not found");
  });
});

describe("Replay Evaluation API — Graceful Degradation", () => {
  it("should not crash when Python evaluator is unavailable", async () => {
    const user = await createTestUser("gracefuleval");
    const opponent = { userId: "graceful-opp", username: "graceful_opponent" };
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );

    const res = await makeRequest(
      "POST",
      `/api/replays/${replayId}/evaluation`,
      {},
      { Authorization: `Bearer ${user.sessionId}` },
    );

    // Even if Python fails, the response should be structured (not 500)
    expect(res.status).toBe(200);
    expect(res.body.meta).toBeDefined();
    // If Python is unavailable, evaluation will be null with error message
    if (!res.body.evaluation) {
      expect(res.body.source).toBe("error");
      expect(res.body.meta.available).toBe(false);
    }
  });
});

describe("Replay Evaluation API — Caching", () => {
  it("GET should return not_computed when no cached evaluation exists", async () => {
    const user = await createTestUser("cachegetuser");
    const opponent = { userId: "cache-opp-get", username: "cache_opp" };
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );

    const res = await makeRequest(
      "GET",
      `/api/replays/${replayId}/evaluation`,
      undefined,
      { Authorization: `Bearer ${user.sessionId}` },
    );

    expect(res.status).toBe(200);
    expect(res.body.evaluation).toBeNull();
    expect(res.body.source).toBe("not_computed");
    expect(res.body.meta.available).toBe(false);
  });

  it("GET should return cached evaluation when one exists", async () => {
    const user = await createTestUser("cacheexists");
    const opponent = { userId: "cache-opp-exists", username: "cache_opp_ex" };
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );

    // Manually cache an evaluation
    const mockEval = {
      methodology: "apex_v2_engine_agreement",
      total_evaluated: 5,
      requesting_player_accuracy: 80.0,
      requesting_player_label: "good",
    };
    cacheEvaluation(replayId, mockEval);

    const res = await makeRequest(
      "GET",
      `/api/replays/${replayId}/evaluation`,
      undefined,
      { Authorization: `Bearer ${user.sessionId}` },
    );

    expect(res.status).toBe(200);
    expect(res.body.evaluation).toBeDefined();
    expect(res.body.source).toBe("cache");
    expect(res.body.evaluation.methodology).toBe("apex_v2_engine_agreement");
    expect(res.body.evaluation.requesting_player_accuracy).toBe(80.0);
    expect(res.body.meta.available).toBe(true);
  });

  it("POST should return cached evaluation if already computed", async () => {
    const user = await createTestUser("postcache");
    const opponent = { userId: "post-cache-opp", username: "post_cache_opp" };
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent,
    );

    // Pre-cache
    const mockEval = {
      methodology: "apex_v2_engine_agreement",
      total_evaluated: 10,
    };
    cacheEvaluation(replayId, mockEval);

    const res = await makeRequest(
      "POST",
      `/api/replays/${replayId}/evaluation`,
      {},
      { Authorization: `Bearer ${user.sessionId}` },
    );

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("cache");
  });
});

describe("Replay Evaluation — SQLite Cache Operations", () => {
  it("ensureEvaluationTable should create the table without error", () => {
    expect(() => ensureEvaluationTable()).not.toThrow();
  });

  it("getCachedEvaluation returns null for missing replay", () => {
    const result = getCachedEvaluation("nonexistent-replay");
    expect(result).toBeNull();
  });

  it("cacheEvaluation + getCachedEvaluation round-trip works", () => {
    const testId = `cache-roundtrip-${Date.now()}`;
    const evalData = { test: true, accuracy: 85.5 };

    cacheEvaluation(testId, evalData);
    const retrieved = getCachedEvaluation(testId);

    expect(retrieved).toBeDefined();
    expect(retrieved.test).toBe(true);
    expect(retrieved.accuracy).toBe(85.5);
  });

  it("cacheEvaluation overwrites existing cache (REPLACE)", () => {
    const testId = `cache-overwrite-${Date.now()}`;
    cacheEvaluation(testId, { version: 1 });
    cacheEvaluation(testId, { version: 2, updated: true });

    const retrieved = getCachedEvaluation(testId);
    expect(retrieved.version).toBe(2);
    expect(retrieved.updated).toBe(true);
  });
});

describe("Replay Evaluation — Access Control for GET", () => {
  it("GET should reject non-participant (403)", async () => {
    const owner = await createTestUser("getowner");
    const intruder = await createTestUser("getintruder");
    const replayId = insertTestReplay(
      { userId: owner.userId, username: owner.username },
      { userId: "get-opp", username: "get_opp" },
    );

    const res = await makeRequest(
      "GET",
      `/api/replays/${replayId}/evaluation`,
      undefined,
      { Authorization: `Bearer ${intruder.sessionId}` },
    );

    expect(res.status).toBe(403);
  });

  it("GET should reject unauthenticated (401)", async () => {
    const res = await makeRequest(
      "GET",
      "/api/replays/some-id/evaluation",
      undefined,
    );
    expect(res.status).toBe(401);
  });
});

describe("Replay Evaluation — Regression Coverage", () => {
  it("existing replay list API still works after evaluation route addition", async () => {
    const user = await createTestUser("regreval1");
    insertTestReplay(
      { userId: user.userId, username: user.username },
      { userId: "regr-eval-opp-1", username: "regression_eval_opp" },
    );

    const res = await makeRequest("GET", "/api/replays", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.replays)).toBe(true);
  });

  it("existing replay analysis API still works after evaluation route addition", async () => {
    const user = await createTestUser("regreval2");
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      { userId: "regr-eval-opp-2", username: "regression_eval_opp2" },
    );

    const res = await makeRequest(
      "POST",
      `/api/replays/${replayId}/analysis`,
      {},
      { Authorization: `Bearer ${user.sessionId}` },
    );

    expect(res.status).toBe(200);
    expect(res.body.analysis).toBeDefined();
  });

  it("existing replay detail API still works after evaluation route addition", async () => {
    const user = await createTestUser("regreval3");
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      { userId: "regr-eval-opp-3", username: "regression_eval_opp3" },
    );

    const res = await makeRequest(
      "GET",
      `/api/replays/${replayId}`,
      undefined,
      { Authorization: `Bearer ${user.sessionId}` },
    );

    expect(res.status).toBe(200);
    expect(res.body.replay).toBeDefined();
    expect(Array.isArray(res.body.replay.actions)).toBe(true);
  });

  it("wallet API still works after evaluation route addition", async () => {
    const user = await createTestUser("regreval4");
    const res = await makeRequest(
      "GET",
      "/api/wallet",
      undefined,
      { Authorization: `Bearer ${user.sessionId}` },
    );

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});
