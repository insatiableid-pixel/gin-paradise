/**
 * Replay Persistence & Access Tests.
 *
 * Covers:
 *  1. Transcript persistence for completed multiplayer matches
 *  2. Replay list retrieval for an authorized player
 *  3. Replay detail retrieval for an authorized player
 *  4. Replay access rejection for unauthorized users
 *  5. Transcript integrity after persistence round-trip
 *  6. Regression coverage for room-code and quick-match flows
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startTestServer, stopTestServer, getBaseUrl, registerUser, loginUser, makeRequest } from "./helpers.js";
import { db, initializeDatabase, persistReplay } from "../server/db.js";
import {
  createTranscript,
  addAction,
  recordRoundStart,
  recordDraw,
  recordDiscard,
  recordKnockOutcome,
  finalizeTranscript,
  recordTimeout,
  recordForfeit,
  getTranscript,
  _clearTranscripts,
} from "../server/multiplayer/transcript.js";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
});
afterAll(async () => {
  await stopTestServer();
});

// ── Helpers ──────────────────────────────────────────────────────────

let userCounter = 0;
async function createTestUser(prefix = "replayuser") {
  userCounter++;
  const username = `${prefix}_${Date.now()}_${userCounter}`;
  const email = `${username}@test.com`;
  const password = "password123";

  // Register
  const regRes = await registerUser(username, email, password);
  expect(regRes.status).toBe(200);

  // Login
  const loginRes = await loginUser(username, password);
  expect(loginRes.status).toBe(200);

  // The auth API returns { sessionId, user: { id, username, ... } }
  const userId = loginRes.body.user?.id || regRes.body.user?.id;

  return {
    userId,
    username,
    sessionId: loginRes.body.sessionId,
  };
}

function createCompletedTranscript(
  roomId: string,
  player1: { userId: string; username: string },
  player2: { userId: string; username: string }
): void {
  const t = createTranscript(roomId, [player1, player2]);

  recordRoundStart(roomId, 1, player1.userId, player1.username);

  // Simulate a few moves
  recordDraw(roomId, player1.userId, player1.username, "stock");
  recordDiscard(roomId, player1.userId, player1.username, { suit: "♠", rank: "K" });
  recordDraw(roomId, player2.userId, player2.username, "discard");
  recordDiscard(roomId, player2.userId, player2.username, { suit: "♥", rank: "3" });

  // Simulate knock and round end
  recordDraw(roomId, player1.userId, player1.username, "stock");
  recordKnockOutcome(
    roomId,
    player1.userId, player1.username,
    "knock",
    player1.userId, player1.username,
    25, 5, 30,
    { suit: "♦", rank: "Q" }
  );

  // Finalize (this persists to DB via persistReplay)
  finalizeTranscript(
    roomId,
    player1.userId, player1.username,
    player2.userId, player2.username,
    100, 75,
    "completed"
  );
}

// ── Test Suites ──────────────────────────────────────────────────────

describe("Replay Persistence", () => {
  beforeEach(() => {
    _clearTranscripts();
  });

  it("should persist a completed transcript to the replays table", () => {
    const roomId = `persist-test-${Date.now()}`;
    const p1 = { userId: "persist-p1", username: "alice" };
    const p2 = { userId: "persist-p2", username: "bob" };

    createCompletedTranscript(roomId, p1, p2);

    // Check the replay exists in DB
    const row = db.prepare("SELECT * FROM replays WHERE room_id = ?").get(roomId) as any;
    expect(row).toBeDefined();
    expect(row.room_id).toBe(roomId);
    expect(row.player1_id).toBe(p1.userId);
    expect(row.player2_id).toBe(p2.userId);
    expect(row.winner_id).toBe(p1.userId);
    expect(row.loser_id).toBe(p2.userId);
    expect(row.winner_score).toBe(100);
    expect(row.loser_score).toBe(75);
    expect(row.end_reason).toBe("completed");
    expect(row.action_count).toBeGreaterThan(0);
  });

  it("should persist forfeit match transcripts", () => {
    const roomId = `forfeit-test-${Date.now()}`;
    const p1 = { userId: "forfeit-p1", username: "charlie" };
    const p2 = { userId: "forfeit-p2", username: "diana" };

    createTranscript(roomId, [p1, p2]);
    recordRoundStart(roomId, 1, p1.userId, p1.username);
    recordDraw(roomId, p1.userId, p1.username, "stock");
    recordForfeit(roomId, p2.userId, p2.username, "leave");
    finalizeTranscript(roomId, p1.userId, p1.username, p2.userId, p2.username, 50, 0, "forfeit");

    const row = db.prepare("SELECT * FROM replays WHERE room_id = ?").get(roomId) as any;
    expect(row).toBeDefined();
    expect(row.end_reason).toBe("forfeit");
    expect(row.winner_id).toBe(p1.userId);
  });

  it("should persist timeout match transcripts", () => {
    const roomId = `timeout-test-${Date.now()}`;
    const p1 = { userId: "timeout-p1", username: "eve" };
    const p2 = { userId: "timeout-p2", username: "frank" };

    createTranscript(roomId, [p1, p2]);
    recordRoundStart(roomId, 1, p1.userId, p1.username);
    recordTimeout(roomId, p2.userId, p2.username);
    finalizeTranscript(roomId, p1.userId, p1.username, p2.userId, p2.username, 30, 10, "timeout");

    const row = db.prepare("SELECT * FROM replays WHERE room_id = ?").get(roomId) as any;
    expect(row).toBeDefined();
    expect(row.end_reason).toBe("timeout");
  });

  it("should persist disconnect match transcripts", () => {
    const roomId = `disconnect-test-${Date.now()}`;
    const p1 = { userId: "dc-p1", username: "grace" };
    const p2 = { userId: "dc-p2", username: "heidi" };

    createTranscript(roomId, [p1, p2]);
    recordRoundStart(roomId, 1, p1.userId, p1.username);
    finalizeTranscript(roomId, p1.userId, p1.username, p2.userId, p2.username, 0, 0, "disconnect");

    const row = db.prepare("SELECT * FROM replays WHERE room_id = ?").get(roomId) as any;
    expect(row).toBeDefined();
    expect(row.end_reason).toBe("disconnect");
  });
});

describe("Transcript Integrity After Round-Trip", () => {
  beforeEach(() => {
    _clearTranscripts();
  });

  it("should preserve all action data after persist + read round-trip", () => {
    const roomId = `integrity-test-${Date.now()}`;
    const p1 = { userId: "int-p1", username: "integritya" };
    const p2 = { userId: "int-p2", username: "integrityb" };

    createCompletedTranscript(roomId, p1, p2);

    // Get the original transcript before clearing
    const original = getTranscript(roomId);
    expect(original).toBeDefined();

    // Read from DB
    const row = db.prepare("SELECT * FROM replays WHERE room_id = ?").get(roomId) as any;
    const restoredActions = JSON.parse(row.transcript_json);

    // Verify action count matches
    expect(restoredActions.length).toBe(original!.actions.length);

    // Verify each action's structure
    for (let i = 0; i < restoredActions.length; i++) {
      expect(restoredActions[i].seq).toBe(original!.actions[i].seq);
      expect(restoredActions[i].type).toBe(original!.actions[i].type);
      if (original!.actions[i].playerId) {
        expect(restoredActions[i].playerId).toBe(original!.actions[i].playerId);
      }
      if (original!.actions[i].playerUsername) {
        expect(restoredActions[i].playerUsername).toBe(original!.actions[i].playerUsername);
      }
    }

    // Verify outcome stored correctly
    expect(row.winner_username).toBe(p1.username);
    expect(row.loser_username).toBe(p2.username);
    expect(row.winner_score).toBe(100);
    expect(row.loser_score).toBe(75);
  });

  it("should preserve action detail fields through round-trip", () => {
    const roomId = `detail-test-${Date.now()}`;
    const p1 = { userId: "det-p1", username: "detaila" };
    const p2 = { userId: "det-p2", username: "detailb" };

    createTranscript(roomId, [p1, p2]);
    recordRoundStart(roomId, 1, p1.userId, p1.username);
    recordDraw(roomId, p1.userId, p1.username, "stock", { suit: "♠", rank: "A" });
    recordDiscard(roomId, p1.userId, p1.username, { suit: "♥", rank: "K" });
    finalizeTranscript(roomId, p1.userId, p1.username, p2.userId, p2.username, 50, 25, "completed");

    const row = db.prepare("SELECT * FROM replays WHERE room_id = ?").get(roomId) as any;
    const actions = JSON.parse(row.transcript_json);

    // Find the draw action
    const drawAction = actions.find((a: any) => a.type === "draw");
    expect(drawAction).toBeDefined();
    expect(drawAction.detail.source).toBe("stock");
    expect(drawAction.detail.card).toBe("A♠");

    // Find the discard action
    const discardAction = actions.find((a: any) => a.type === "discard");
    expect(discardAction).toBeDefined();
    expect(discardAction.detail.card).toBe("K♥");
  });
});

describe("Replay API — List Endpoint", () => {
  it("should return recent replays for an authorized player", async () => {
    const user = await createTestUser("listuser");

    // Insert a replay where this user is player1
    const roomId = `list-test-${Date.now()}`;
    persistReplay({
      roomId,
      players: [
        { userId: user.userId, username: user.username },
        { userId: "list-opp", username: "list_opponent" },
      ],
      startedAt: Date.now() - 60000,
      endedAt: Date.now(),
      actions: [
        { seq: 1, timestamp: Date.now(), type: "match_start" },
        { seq: 2, timestamp: Date.now(), type: "match_end" },
      ],
      outcome: {
        winnerId: user.userId,
        winnerUsername: user.username,
        loserId: "list-opp",
        loserUsername: "list_opponent",
        winnerScore: 100,
        loserScore: 50,
        endReason: "completed",
      },
    });

    const res = await makeRequest("GET", "/api/replays", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.replays)).toBe(true);
    expect(res.body.replays.length).toBeGreaterThanOrEqual(1);

    const replay = res.body.replays.find((r: any) => r.roomId === roomId);
    expect(replay).toBeDefined();
    expect(replay.outcome.winnerId).toBe(user.userId);
    expect(replay.outcome.winnerScore).toBe(100);
    expect(replay.actionCount).toBe(2);
  });

  it("should return replays where user is player2", async () => {
    const user = await createTestUser("p2user");
    const roomId = `p2-test-${Date.now()}`;

    persistReplay({
      roomId,
      players: [
        { userId: "p2-opp", username: "the_opponent" },
        { userId: user.userId, username: user.username },
      ],
      startedAt: Date.now() - 30000,
      endedAt: Date.now(),
      actions: [{ seq: 1, timestamp: Date.now(), type: "match_start" }],
      outcome: {
        winnerId: "p2-opp",
        winnerUsername: "the_opponent",
        loserId: user.userId,
        loserUsername: user.username,
        winnerScore: 100,
        loserScore: 80,
        endReason: "completed",
      },
    });

    const res = await makeRequest("GET", "/api/replays", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    const replay = res.body.replays.find((r: any) => r.roomId === roomId);
    expect(replay).toBeDefined();
    expect(replay.outcome.loserId).toBe(user.userId);
  });

  it("should reject unauthenticated replay list requests", async () => {
    const res = await makeRequest("GET", "/api/replays");
    expect(res.status).toBe(401);
  });
});

describe("Replay API — Detail Endpoint", () => {
  it("should return full replay detail for a participant", async () => {
    const user = await createTestUser("detailuser");
    const roomId = `detail-api-${Date.now()}`;

    const replayId = persistReplay({
      roomId,
      players: [
        { userId: user.userId, username: user.username },
        { userId: "detail-opp", username: "detail_opponent" },
      ],
      startedAt: Date.now() - 120000,
      endedAt: Date.now(),
      actions: [
        { seq: 1, timestamp: Date.now() - 120000, type: "match_start", detail: { players: [user.username, "detail_opponent"] } },
        { seq: 2, timestamp: Date.now() - 100000, type: "round_start", playerId: user.userId, playerUsername: user.username, detail: { roundNumber: 1 } },
        { seq: 3, timestamp: Date.now() - 80000, type: "draw", playerId: user.userId, playerUsername: user.username, detail: { source: "stock" } },
        { seq: 4, timestamp: Date.now() - 60000, type: "discard", playerId: user.userId, playerUsername: user.username, detail: { card: "K♠" } },
        { seq: 5, timestamp: Date.now(), type: "match_end", playerId: user.userId, playerUsername: user.username, detail: { winnerScore: 100, loserScore: 75, endReason: "completed" } },
      ],
      outcome: {
        winnerId: user.userId,
        winnerUsername: user.username,
        loserId: "detail-opp",
        loserUsername: "detail_opponent",
        winnerScore: 100,
        loserScore: 75,
        endReason: "completed",
      },
    });

    const res = await makeRequest("GET", `/api/replays/${replayId}`, undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.replay).toBeDefined();
    expect(res.body.replay.id).toBe(replayId);
    expect(res.body.replay.roomId).toBe(roomId);
    expect(Array.isArray(res.body.replay.actions)).toBe(true);
    expect(res.body.replay.actions.length).toBe(5);
    expect(res.body.replay.outcome.winnerScore).toBe(100);
    expect(res.body.replay.players.length).toBe(2);
  });

  it("should return 403 for a non-participant user", async () => {
    const owner = await createTestUser("owner");
    const intruder = await createTestUser("intruder");

    const replayId = persistReplay({
      roomId: `auth-test-${Date.now()}`,
      players: [
        { userId: owner.userId, username: owner.username },
        { userId: "auth-opp", username: "auth_opponent" },
      ],
      startedAt: Date.now() - 60000,
      endedAt: Date.now(),
      actions: [{ seq: 1, timestamp: Date.now(), type: "match_start" }],
      outcome: {
        winnerId: owner.userId,
        winnerUsername: owner.username,
        loserId: "auth-opp",
        loserUsername: "auth_opponent",
        winnerScore: 100,
        loserScore: 50,
        endReason: "completed",
      },
    });

    // Intruder tries to access the replay
    const res = await makeRequest("GET", `/api/replays/${replayId}`, undefined, {
      Authorization: `Bearer ${intruder.sessionId}`,
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Access denied");
  });

  it("should return 404 for a nonexistent replay", async () => {
    const user = await createTestUser("notfound");
    const res = await makeRequest("GET", "/api/replays/nonexistent-id", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(404);
  });

  it("should reject unauthenticated replay detail requests", async () => {
    const res = await makeRequest("GET", "/api/replays/some-id");
    expect(res.status).toBe(401);
  });
});

describe("Replay — Regression Coverage", () => {
  beforeEach(() => {
    _clearTranscripts();
  });

  it("room-code match should produce a durable replay via finalizeTranscript", () => {
    const roomId = `rc-regression-${Date.now()}`;
    const p1 = { userId: "rc-p1", username: "rcuser1" };
    const p2 = { userId: "rc-p2", username: "rcuser2" };

    // Simulate a room-code match lifecycle
    createTranscript(roomId, [p1, p2]);
    recordRoundStart(roomId, 1, p1.userId, p1.username);
    recordDraw(roomId, p1.userId, p1.username, "stock");
    recordDiscard(roomId, p1.userId, p1.username, { suit: "♠", rank: "5" });
    recordDraw(roomId, p2.userId, p2.username, "discard");
    recordDiscard(roomId, p2.userId, p2.username, { suit: "♣", rank: "9" });
    finalizeTranscript(roomId, p1.userId, p1.username, p2.userId, p2.username, 100, 50, "completed");

    const row = db.prepare("SELECT * FROM replays WHERE room_id = ?").get(roomId) as any;
    expect(row).toBeDefined();
    expect(row.end_reason).toBe("completed");
    expect(row.player1_username).toBe("rcuser1");
    expect(row.player2_username).toBe("rcuser2");
  });

  it("quick-match (matchmaking) style match should produce a durable replay", () => {
    const roomId = `qm-regression-${Date.now()}`;
    const p1 = { userId: "qm-p1", username: "qmuser1" };
    const p2 = { userId: "qm-p2", username: "qmuser2" };

    // Simulate a quick match lifecycle
    createTranscript(roomId, [p1, p2]);
    recordRoundStart(roomId, 1, p1.userId, p1.username);
    recordDraw(roomId, p1.userId, p1.username, "stock");
    recordKnockOutcome(
      roomId, p1.userId, p1.username,
      "gin", p1.userId, p1.username,
      35, 0, 35,
      { suit: "♦", rank: "2" }
    );
    finalizeTranscript(roomId, p1.userId, p1.username, p2.userId, p2.username, 100, 0, "completed");

    const row = db.prepare("SELECT * FROM replays WHERE room_id = ?").get(roomId) as any;
    expect(row).toBeDefined();
    expect(row.winner_id).toBe(p1.userId);
    expect(row.winner_score).toBe(100);

    const actions = JSON.parse(row.transcript_json);
    const ginAction = actions.find((a: any) => a.type === "gin");
    expect(ginAction).toBeDefined();
    expect(ginAction.playerUsername).toBe("qmuser1");
  });

  it("existing transcript functions (createTranscript, addAction, etc.) still work as before", () => {
    const roomId = `compat-test-${Date.now()}`;
    const p1 = { userId: "compat-p1", username: "compata" };
    const p2 = { userId: "compat-p2", username: "compatb" };

    const t = createTranscript(roomId, [p1, p2]);
    expect(t).toBeDefined();
    expect(t.roomId).toBe(roomId);
    expect(t.players.length).toBe(2);
    expect(t.actions.length).toBe(1); // match_start

    addAction(roomId, "draw", p1.userId, p1.username, { source: "stock" });
    const transcript = getTranscript(roomId);
    expect(transcript).toBeDefined();
    expect(transcript!.actions.length).toBe(2);
    expect(transcript!.actions[1].type).toBe("draw");
    expect(transcript!.actions[1].seq).toBe(2);
  });
});

describe("Replay — Edge Cases", () => {
  it("should handle multiple replays for the same player ordered by recency", async () => {
    const user = await createTestUser("multiuser");

    // Insert 3 replays at different times
    for (let i = 0; i < 3; i++) {
      persistReplay({
        roomId: `multi-${i}-${Date.now()}`,
        players: [
          { userId: user.userId, username: user.username },
          { userId: `multi-opp-${i}`, username: `opp${i}` },
        ],
        startedAt: Date.now() - (3 - i) * 100000,
        endedAt: Date.now() - (3 - i) * 50000,
        actions: [{ seq: 1, timestamp: Date.now(), type: "match_start" }],
        outcome: {
          winnerId: user.userId,
          winnerUsername: user.username,
          loserId: `multi-opp-${i}`,
          loserUsername: `opp${i}`,
          winnerScore: 100,
          loserScore: 50 + i * 10,
          endReason: "completed",
        },
      });
    }

    const res = await makeRequest("GET", "/api/replays?limit=10", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.replays.length).toBeGreaterThanOrEqual(3);

    // Verify ordering (most recent first)
    const times = res.body.replays.map((r: any) => r.endedAt);
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
  });

  it("should handle limit and offset query params", async () => {
    const user = await createTestUser("paginateuser");

    // Insert 5 replays
    for (let i = 0; i < 5; i++) {
      persistReplay({
        roomId: `page-${i}-${Date.now()}`,
        players: [
          { userId: user.userId, username: user.username },
          { userId: `page-opp-${i}`, username: `pageopp${i}` },
        ],
        startedAt: Date.now() - (5 - i) * 100000,
        endedAt: Date.now() - (5 - i) * 50000 + i,
        actions: [{ seq: 1, timestamp: Date.now(), type: "match_start" }],
        outcome: {
          winnerId: user.userId,
          winnerUsername: user.username,
          loserId: `page-opp-${i}`,
          loserUsername: `pageopp${i}`,
          winnerScore: 100,
          loserScore: 50,
          endReason: "completed",
        },
      });
    }

    const res = await makeRequest("GET", "/api/replays?limit=2&offset=0", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.replays.length).toBeLessThanOrEqual(2);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(0);
  });
});
