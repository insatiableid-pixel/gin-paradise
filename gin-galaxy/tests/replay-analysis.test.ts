/**
 * Transcript-Driven AI Analysis Tests.
 *
 * Covers:
 *  1. Authenticated analysis request for a valid replay (participant)
 *  2. Unauthorized analysis rejection (non-participant, 403)
 *  3. Unauthenticated analysis rejection (401)
 *  4. Replay-not-found handling (404)
 *  5. Graceful fallback when AI configuration is unavailable
 *  6. Transcript-to-analysis input shaping / formatting behavior
 *  7. Regression: replay APIs and existing analysis still work
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startTestServer, stopTestServer, getBaseUrl, registerUser, loginUser, makeRequest } from "./helpers.js";
import { db, persistReplay } from "../server/db.js";
import {
  createTranscript,
  recordRoundStart,
  recordDraw,
  recordDiscard,
  recordKnockOutcome,
  finalizeTranscript,
  recordTimeout,
  recordForfeit,
  _clearTranscripts,
} from "../server/multiplayer/transcript.js";
import {
  buildAnalysisInput,
  extractRounds,
  computePlayerStats,
  type ReplayData,
} from "../server/analysis/transcriptAdapter.js";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
});
afterAll(async () => {
  await stopTestServer();
});

// ── Helpers ──────────────────────────────────────────────────────────

let userCounter = 0;
const testRunId = Math.random().toString(36).slice(2, 8);
async function createTestUser(prefix = "analyuser") {
  userCounter++;
  const username = `${prefix}_${testRunId}_${userCounter}`;
  const email = `${username}@test.com`;
  const password = "password123";

  const regRes = await registerUser(username, email, password);
  expect(regRes.status).toBe(200);

  const loginRes = await loginUser(username, password);
  expect(loginRes.status).toBe(200);

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
  opts: { endReason?: string; winnerIsP1?: boolean } = {}
): string {
  const { endReason = "completed", winnerIsP1 = true } = opts;
  const winner = winnerIsP1 ? player1 : player2;
  const loser = winnerIsP1 ? player2 : player1;
  const now = Date.now();

  return persistReplay({
    roomId: `analysis-test-${now}-${Math.random().toString(36).slice(2, 6)}`,
    players: [player1, player2],
    startedAt: now - 120000,
    endedAt: now,
    actions: [
      { seq: 1, timestamp: now - 120000, type: "match_start", detail: { players: [player1.username, player2.username] } },
      { seq: 2, timestamp: now - 115000, type: "round_start", playerId: player1.userId, playerUsername: player1.username, detail: { roundNumber: 1 } },
      { seq: 3, timestamp: now - 110000, type: "draw", playerId: player1.userId, playerUsername: player1.username, detail: { source: "stock" } },
      { seq: 4, timestamp: now - 105000, type: "discard", playerId: player1.userId, playerUsername: player1.username, detail: { card: "K♠" } },
      { seq: 5, timestamp: now - 100000, type: "draw", playerId: player2.userId, playerUsername: player2.username, detail: { source: "discard", card: "K♠" } },
      { seq: 6, timestamp: now - 95000, type: "discard", playerId: player2.userId, playerUsername: player2.username, detail: { card: "3♥" } },
      { seq: 7, timestamp: now - 90000, type: "draw", playerId: player1.userId, playerUsername: player1.username, detail: { source: "stock" } },
      { seq: 8, timestamp: now - 85000, type: "knock", playerId: player1.userId, playerUsername: player1.username, detail: {
        discardedCard: "Q♦", knockerDeadwood: 5, opponentDeadwood: 28, winnerId: winner.userId, winnerUsername: winner.username, points: 23,
      } },
      { seq: 9, timestamp: now - 84000, type: "round_end", playerId: winner.userId, playerUsername: winner.username, detail: { points: 23, outcomeType: "knock" } },
      { seq: 10, timestamp: now, type: "match_end", playerId: winner.userId, playerUsername: winner.username, detail: { winnerScore: 100, loserScore: 75, endReason } },
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

describe("Replay Analysis API — Authentication & Access", () => {
  it("should return analysis for a valid replay participant (no API key = fallback)", async () => {
    const user = await createTestUser("validanalysis");
    const opponent = { userId: "analysis-opp-1", username: "analysis_opponent1" };
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent
    );

    const res = await makeRequest("POST", `/api/replays/${replayId}/analysis`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.analysis).toBeDefined();
    expect(typeof res.body.analysis).toBe("string");
    expect(res.body.analysis.length).toBeGreaterThan(0);
    // Without GEMINI_API_KEY, should be fallback source
    expect(res.body.source).toBe("fallback");
    // Meta should be present
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.replayId).toBe(replayId);
    expect(res.body.meta.totalActions).toBeGreaterThan(0);
    expect(res.body.meta.totalRounds).toBeGreaterThanOrEqual(1);
  });

  it("should reject analysis for non-participant (403)", async () => {
    const owner = await createTestUser("analysisowner");
    const intruder = await createTestUser("analysisintr");
    const replayId = insertTestReplay(
      { userId: owner.userId, username: owner.username },
      { userId: "analysis-opp-2", username: "opp2" }
    );

    const res = await makeRequest("POST", `/api/replays/${replayId}/analysis`, {}, {
      Authorization: `Bearer ${intruder.sessionId}`,
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Access denied");
  });

  it("should reject analysis for unauthenticated requests (401)", async () => {
    const res = await makeRequest("POST", "/api/replays/some-id/analysis", {});
    expect(res.status).toBe(401);
  });

  it("should return 404 for non-existent replay", async () => {
    const user = await createTestUser("notfoundanalysis");
    const res = await makeRequest("POST", "/api/replays/nonexistent-replay-id/analysis", {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Replay not found");
  });
});

describe("Replay Analysis — Fallback Behavior", () => {
  it("should return a structured fallback with match summary when no API key", async () => {
    const user = await createTestUser("fallbackuser");
    const opponent = { userId: "fb-opp", username: "fallback_opponent" };
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      opponent
    );

    const res = await makeRequest("POST", `/api/replays/${replayId}/analysis`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("fallback");

    // Verify fallback content includes useful info
    const analysis: string = res.body.analysis;
    expect(analysis).toContain("AI Analysis Unavailable");
    expect(analysis).toContain("GEMINI_API_KEY");
    expect(analysis).toContain(user.username);
    // Should include score info
    expect(analysis).toContain("100");
    expect(analysis).toContain("75");
    // Should include draw pattern info
    expect(analysis).toContain("Draw Pattern");
  });

  it("should return fallback for player2 analyzing a replay they lost", async () => {
    const user = await createTestUser("loseranalysis");
    const winnerUser = { userId: "winner-fb", username: "the_winner" };
    const replayId = insertTestReplay(
      winnerUser,
      { userId: user.userId, username: user.username },
      { winnerIsP1: true }
    );

    const res = await makeRequest("POST", `/api/replays/${replayId}/analysis`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("fallback");
    // Analysis should mention the requesting player
    expect(res.body.analysis).toContain(user.username);
    // Should indicate defeat
    expect(res.body.analysis).toContain("Defeat");
  });
});

describe("Transcript Adapter — Input Shaping", () => {
  const now = Date.now();
  const p1 = { userId: "adapter-p1", username: "alice_adapter" };
  const p2 = { userId: "adapter-p2", username: "bob_adapter" };

  const sampleReplay: ReplayData = {
    id: "test-replay-id",
    roomId: "test-room",
    startedAt: now - 120000,
    endedAt: now,
    players: [p1, p2],
    outcome: {
      winnerId: p1.userId,
      winnerUsername: p1.username,
      loserId: p2.userId,
      loserUsername: p2.username,
      winnerScore: 100,
      loserScore: 75,
      endReason: "completed",
    },
    actions: [
      { seq: 1, timestamp: now - 120000, type: "match_start", detail: { players: [p1.username, p2.username] } },
      { seq: 2, timestamp: now - 115000, type: "round_start", playerId: p1.userId, playerUsername: p1.username, detail: { roundNumber: 1 } },
      { seq: 3, timestamp: now - 110000, type: "draw", playerId: p1.userId, playerUsername: p1.username, detail: { source: "stock" } },
      { seq: 4, timestamp: now - 105000, type: "discard", playerId: p1.userId, playerUsername: p1.username, detail: { card: "K♠" } },
      { seq: 5, timestamp: now - 100000, type: "draw", playerId: p2.userId, playerUsername: p2.username, detail: { source: "discard", card: "K♠" } },
      { seq: 6, timestamp: now - 95000, type: "discard", playerId: p2.userId, playerUsername: p2.username, detail: { card: "3♥" } },
      { seq: 7, timestamp: now - 90000, type: "draw", playerId: p1.userId, playerUsername: p1.username, detail: { source: "stock" } },
      { seq: 8, timestamp: now - 85000, type: "knock", playerId: p1.userId, playerUsername: p1.username, detail: {
        discardedCard: "Q♦", knockerDeadwood: 5, opponentDeadwood: 28, winnerId: p1.userId, winnerUsername: p1.username, points: 23,
      } },
      { seq: 9, timestamp: now - 84000, type: "round_end", playerId: p1.userId, playerUsername: p1.username, detail: { points: 23, outcomeType: "knock" } },
      { seq: 10, timestamp: now, type: "match_end", playerId: p1.userId, playerUsername: p1.username, detail: { winnerScore: 100, loserScore: 75, endReason: "completed" } },
    ],
  };

  it("should produce a structured prompt with all required sections", () => {
    const input = buildAnalysisInput(sampleReplay, p1.userId);

    expect(input.requestingPlayerId).toBe(p1.userId);
    expect(input.requestingPlayerUsername).toBe(p1.username);
    expect(input.prompt).toContain("Match Overview");
    expect(input.prompt).toContain("Player Statistics");
    expect(input.prompt).toContain("Round-by-Round Summary");
    expect(input.prompt).toContain("Key Moments");
    expect(input.prompt).toContain("Complete Turn Log");
    expect(input.prompt).toContain("Instructions for Analysis");
  });

  it("should include the requesting player's name in the prompt", () => {
    const input = buildAnalysisInput(sampleReplay, p1.userId);
    expect(input.prompt).toContain(p1.username);
    expect(input.prompt).toContain("requesting analysis");
  });

  it("should include the opponent's name in the prompt", () => {
    const input = buildAnalysisInput(sampleReplay, p1.userId);
    expect(input.prompt).toContain(p2.username);
  });

  it("should include correct match result in prompt", () => {
    const input = buildAnalysisInput(sampleReplay, p1.userId);
    expect(input.prompt).toContain("WON");
    expect(input.prompt).toContain("100");
    expect(input.prompt).toContain("75");
  });

  it("should generate loss perspective when requesting player lost", () => {
    const input = buildAnalysisInput(sampleReplay, p2.userId);
    expect(input.prompt).toContain("LOST");
  });

  it("should include meta with correct values", () => {
    const input = buildAnalysisInput(sampleReplay, p1.userId);
    expect(input.meta.replayId).toBe("test-replay-id");
    expect(input.meta.totalActions).toBe(10);
    expect(input.meta.totalRounds).toBeGreaterThanOrEqual(1);
    expect(input.meta.durationMs).toBeGreaterThan(0);
    expect(input.meta.endReason).toBe("completed");
  });

  it("should include draw statistics per player", () => {
    const input = buildAnalysisInput(sampleReplay, p1.userId);
    // p1 drew from stock twice, never from discard
    expect(input.prompt).toContain("Draws from stock: 2");
    // p2 drew once from discard
    expect(input.prompt).toContain("Draws from discard pile: 1");
  });

  it("should include knock details in the turn log", () => {
    const input = buildAnalysisInput(sampleReplay, p1.userId);
    expect(input.prompt).toContain("KNOCKED");
    expect(input.prompt).toContain("DW 5 vs 28");
  });
});

describe("Transcript Adapter — extractRounds", () => {
  it("should split actions into rounds correctly", () => {
    const now = Date.now();
    const actions = [
      { seq: 1, timestamp: now, type: "match_start" },
      { seq: 2, timestamp: now, type: "round_start", detail: { roundNumber: 1 } },
      { seq: 3, timestamp: now, type: "draw", playerId: "p1", playerUsername: "alice" },
      { seq: 4, timestamp: now, type: "discard", playerId: "p1", playerUsername: "alice" },
      { seq: 5, timestamp: now, type: "round_end", playerUsername: "alice" },
      { seq: 6, timestamp: now, type: "round_start", detail: { roundNumber: 2 } },
      { seq: 7, timestamp: now, type: "draw", playerId: "p2", playerUsername: "bob" },
      { seq: 8, timestamp: now, type: "match_end" },
    ];

    const rounds = extractRounds(actions);
    expect(rounds.length).toBe(3); // pre-round actions + round 1 + round 2
  });

  it("should handle single-round matches", () => {
    const now = Date.now();
    const actions = [
      { seq: 1, timestamp: now, type: "match_start" },
      { seq: 2, timestamp: now, type: "round_start", detail: { roundNumber: 1 } },
      { seq: 3, timestamp: now, type: "draw" },
      { seq: 4, timestamp: now, type: "match_end" },
    ];

    const rounds = extractRounds(actions);
    expect(rounds.length).toBe(2); // pre-round + round 1
  });
});

describe("Transcript Adapter — computePlayerStats", () => {
  it("should count draws, discards, knocks, and gins correctly", () => {
    const now = Date.now();
    const players = [
      { userId: "p1", username: "alice" },
      { userId: "p2", username: "bob" },
    ];

    const actions = [
      { seq: 1, timestamp: now, type: "draw", playerId: "p1", playerUsername: "alice", detail: { source: "stock" } },
      { seq: 2, timestamp: now, type: "discard", playerId: "p1", playerUsername: "alice", detail: { card: "K♠" } },
      { seq: 3, timestamp: now, type: "draw", playerId: "p2", playerUsername: "bob", detail: { source: "discard" } },
      { seq: 4, timestamp: now, type: "discard", playerId: "p2", playerUsername: "bob", detail: { card: "3♥" } },
      { seq: 5, timestamp: now, type: "draw", playerId: "p1", playerUsername: "alice", detail: { source: "stock" } },
      { seq: 6, timestamp: now, type: "knock", playerId: "p1", playerUsername: "alice", detail: { winnerId: "p1" } },
    ];

    const stats = computePlayerStats(actions, players);

    const p1Stats = stats.get("p1")!;
    expect(p1Stats.draws.stock).toBe(2);
    expect(p1Stats.draws.discard).toBe(0);
    expect(p1Stats.discards).toBe(1);
    expect(p1Stats.knocks).toBe(1);
    expect(p1Stats.roundsWon).toBe(1);

    const p2Stats = stats.get("p2")!;
    expect(p2Stats.draws.stock).toBe(0);
    expect(p2Stats.draws.discard).toBe(1);
    expect(p2Stats.discards).toBe(1);
    expect(p2Stats.knocks).toBe(0);
  });

  it("should count timeouts for timed-out players", () => {
    const players = [
      { userId: "p1", username: "alice" },
      { userId: "p2", username: "bob" },
    ];

    const actions = [
      { seq: 1, timestamp: Date.now(), type: "timeout", playerId: "p2", playerUsername: "bob" },
      { seq: 2, timestamp: Date.now(), type: "timeout", playerId: "p2", playerUsername: "bob" },
    ];

    const stats = computePlayerStats(actions, players);
    expect(stats.get("p2")!.timeouts).toBe(2);
    expect(stats.get("p1")!.timeouts).toBe(0);
  });

  it("should count gin wins correctly", () => {
    const players = [
      { userId: "p1", username: "alice" },
      { userId: "p2", username: "bob" },
    ];

    const actions = [
      { seq: 1, timestamp: Date.now(), type: "gin", playerId: "p1", playerUsername: "alice", detail: { points: 35 } },
    ];

    const stats = computePlayerStats(actions, players);
    expect(stats.get("p1")!.gins).toBe(1);
    expect(stats.get("p1")!.roundsWon).toBe(1);
  });
});

describe("Replay Analysis — Regression Coverage", () => {
  it("existing replay list API still works after analysis route addition", async () => {
    const user = await createTestUser("regrlistuser");
    insertTestReplay(
      { userId: user.userId, username: user.username },
      { userId: "regr-opp-list", username: "regression_opp" }
    );

    const res = await makeRequest("GET", "/api/replays", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.replays)).toBe(true);
    expect(res.body.replays.length).toBeGreaterThanOrEqual(1);
  });

  it("existing replay detail API still works after analysis route addition", async () => {
    const user = await createTestUser("regrdetuser");
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      { userId: "regr-opp-det", username: "regression_det_opp" }
    );

    const res = await makeRequest("GET", `/api/replays/${replayId}`, undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.replay).toBeDefined();
    expect(res.body.replay.id).toBe(replayId);
    expect(Array.isArray(res.body.replay.actions)).toBe(true);
  });

  it("existing summary analysis endpoint still works", async () => {
    const user = await createTestUser("regranalysis");

    const res = await makeRequest("GET", "/api/analysis", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.analysis).toBeDefined();
  });

  it("replay analysis with forfeit end-reason returns valid fallback", async () => {
    const user = await createTestUser("forfeitanalysis");
    const replayId = insertTestReplay(
      { userId: user.userId, username: user.username },
      { userId: "forfeit-opp", username: "forfeit_opponent" },
      { endReason: "forfeit" }
    );

    const res = await makeRequest("POST", `/api/replays/${replayId}/analysis`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.analysis).toBeDefined();
    expect(res.body.meta.endReason).toBe("forfeit");
  });
});
