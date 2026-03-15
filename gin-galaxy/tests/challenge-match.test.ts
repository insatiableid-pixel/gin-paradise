/**
 * Challenge-to-Match Activation Tests for Gin Paradise.
 *
 * Tests the seamless challenge → room handoff, rematch flow,
 * availability status, and related social API extensions.
 *
 * Test categories:
 *  - Challenge acceptance with room allocation
 *  - Accepted challenges listing & room IDs
 *  - Rematch proposal, acceptance, decline, expiry
 *  - Availability status API
 *  - Notification types for match_ready / rematch_accepted
 *  - Edge cases and regression
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestServer,
  stopTestServer,
  registerUser,
  makeRequest,
} from "./helpers.js";

let BASE_URL: string;
let tokenA: string; // challenger
let tokenB: string; // target
let tokenC: string; // third player
let userAId: string;
let userBId: string;
let userCId: string;

function headersFor(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  BASE_URL = await startTestServer();

  const ts = Date.now();

  // Register three test users
  const a = await registerUser(`chAlpha_${ts}`, `alpha_${ts}@test.com`, "password123");
  expect(a.status).toBe(200);
  tokenA = a.body.sessionId;
  userAId = a.body.user.id;

  const b = await registerUser(`chBeta_${ts}`, `beta_${ts}@test.com`, "password123");
  expect(b.status).toBe(200);
  tokenB = b.body.sessionId;
  userBId = b.body.user.id;

  const c = await registerUser(`chGamma_${ts}`, `gamma_${ts}@test.com`, "password123");
  expect(c.status).toBe(200);
  tokenC = c.body.sessionId;
  userCId = c.body.user.id;
});

afterAll(async () => {
  await stopTestServer();
});

// ── Challenge Acceptance → Room Allocation ──────────────────────────

describe("Challenge acceptance with room allocation", () => {
  let challengeId: string;

  it("creates a challenge from A → B", async () => {
    const res = await makeRequest("POST", "/api/social/challenge", {
      targetId: userBId,
      stakeId: "free",
      message: "Let's play!",
    }, headersFor(tokenA));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.challenge).toBeDefined();
    expect(res.body.challenge.status).toBe("pending");
    expect(res.body.challenge.roomId).toBeNull();
    challengeId = res.body.challenge.id;
  });

  it("accepting a challenge allocates a room ID", async () => {
    const res = await makeRequest("POST", `/api/social/challenge/${challengeId}/accept`, undefined, headersFor(tokenB));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.roomId).toBeDefined();
    expect(typeof res.body.roomId).toBe("string");
    expect(res.body.roomId.startsWith("CH-")).toBe(true);
    expect(res.body.challenge.status).toBe("accepted");
    expect(res.body.challenge.roomId).toBe(res.body.roomId);
  });

  it("accepted challenge appears with roomId in the challenge detail", async () => {
    const res = await makeRequest("GET", `/api/social/challenge/${challengeId}`, undefined, headersFor(tokenA));

    expect(res.status).toBe(200);
    expect(res.body.challenge.status).toBe("accepted");
    expect(res.body.challenge.roomId).toBeDefined();
    expect(res.body.challenge.roomId.startsWith("CH-")).toBe(true);
  });
});

// ── Accepted Challenges Listing ─────────────────────────────────────

describe("Accepted challenges listing", () => {
  it("returns accepted challenges with room IDs for the challenger", async () => {
    const res = await makeRequest("GET", "/api/social/challenges/accepted", undefined, headersFor(tokenA));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.challenges)).toBe(true);
    // Should have the challenge we accepted above
    const accepted = res.body.challenges.filter((c: any) => c.status === "accepted" && c.roomId);
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    expect(accepted[0].roomId.startsWith("CH-")).toBe(true);
  });

  it("returns accepted challenges for the target as well", async () => {
    const res = await makeRequest("GET", "/api/social/challenges/accepted", undefined, headersFor(tokenB));

    expect(res.status).toBe(200);
    const accepted = res.body.challenges.filter((c: any) => c.status === "accepted" && c.roomId);
    expect(accepted.length).toBeGreaterThanOrEqual(1);
  });

  it("requires authentication", async () => {
    const res = await makeRequest("GET", "/api/social/challenges/accepted");
    expect(res.status).toBe(401);
  });
});

// ── Match Ready Notifications ───────────────────────────────────────

describe("Match-ready notifications", () => {
  it("challenger receives match_ready and challenge_accepted notifications", async () => {
    const res = await makeRequest("GET", "/api/social/notifications", undefined, headersFor(tokenA));

    expect(res.status).toBe(200);
    const notifs = res.body.notifications;
    const matchReady = notifs.find((n: any) => n.type === "match_ready");
    expect(matchReady).toBeDefined();
    expect(matchReady.message).toContain("accepted your challenge");
    expect(matchReady.message).toContain("Join the match");

    const accepted = notifs.find((n: any) => n.type === "challenge_accepted");
    expect(accepted).toBeDefined();
  });
});

// ── Rematch Flow ────────────────────────────────────────────────────

describe("Rematch proposal and acceptance", () => {
  let rematchId: string;

  it("proposes a rematch from A → B", async () => {
    const res = await makeRequest("POST", "/api/social/rematch", {
      opponentId: userBId,
      stakeId: "free",
    }, headersFor(tokenA));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.rematch).toBeDefined();
    expect(res.body.rematch.status).toBe("proposed");
    expect(res.body.rematch.proposerId).toBe(userAId);
    expect(res.body.rematch.roomId).toBeNull();
    rematchId = res.body.rematch.id;
  });

  it("B receives rematch_received notification", async () => {
    const res = await makeRequest("GET", "/api/social/notifications", undefined, headersFor(tokenB));
    const notifs = res.body.notifications;
    const rematchNotif = notifs.find((n: any) => n.type === "rematch_received");
    expect(rematchNotif).toBeDefined();
    expect(rematchNotif.message).toContain("wants a rematch");
  });

  it("rematch shows in pending rematches for both players", async () => {
    const resA = await makeRequest("GET", "/api/social/rematches", undefined, headersFor(tokenA));
    expect(resA.body.rematches.length).toBeGreaterThanOrEqual(1);

    const resB = await makeRequest("GET", "/api/social/rematches", undefined, headersFor(tokenB));
    expect(resB.body.rematches.length).toBeGreaterThanOrEqual(1);
  });

  it("proposer cannot accept their own rematch", async () => {
    const res = await makeRequest("POST", `/api/social/rematch/${rematchId}/accept`, undefined, headersFor(tokenA));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Cannot accept your own rematch");
  });

  it("accepting a rematch allocates a room ID", async () => {
    const res = await makeRequest("POST", `/api/social/rematch/${rematchId}/accept`, undefined, headersFor(tokenB));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.roomId).toBeDefined();
    expect(typeof res.body.roomId).toBe("string");
    expect(res.body.roomId.startsWith("CH-")).toBe(true);
    expect(res.body.rematch.status).toBe("accepted");
    expect(res.body.rematch.roomId).toBe(res.body.roomId);
  });

  it("A receives rematch_accepted and match_ready notifications", async () => {
    const res = await makeRequest("GET", "/api/social/notifications", undefined, headersFor(tokenA));
    const notifs = res.body.notifications;
    const rematchAccepted = notifs.find((n: any) => n.type === "rematch_accepted");
    expect(rematchAccepted).toBeDefined();
    expect(rematchAccepted.message).toContain("accepted your rematch");

    // match_ready should also be present for the rematch
    const matchReady = notifs.filter((n: any) => n.type === "match_ready");
    expect(matchReady.length).toBeGreaterThanOrEqual(2); // one from challenge, one from rematch
  });
});

describe("Rematch decline", () => {
  let rematchId: string;

  it("creates and declines a rematch", async () => {
    // Create
    const create = await makeRequest("POST", "/api/social/rematch", {
      opponentId: userCId,
      stakeId: "free",
    }, headersFor(tokenA));
    expect(create.status).toBe(200);
    rematchId = create.body.rematch.id;

    // Decline
    const decline = await makeRequest("POST", `/api/social/rematch/${rematchId}/decline`, undefined, headersFor(tokenC));
    expect(decline.status).toBe(200);
    expect(decline.body.success).toBe(true);
  });

  it("declined rematch cannot be accepted", async () => {
    const res = await makeRequest("POST", `/api/social/rematch/${rematchId}/accept`, undefined, headersFor(tokenC));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("declined");
  });
});

describe("Rematch duplicate prevention", () => {
  it("rejects duplicate pending rematch between same players", async () => {
    // First rematch
    const first = await makeRequest("POST", "/api/social/rematch", {
      opponentId: userCId,
      stakeId: "free",
    }, headersFor(tokenB));
    expect(first.status).toBe(200);

    // Second rematch (should fail)
    const second = await makeRequest("POST", "/api/social/rematch", {
      opponentId: userCId,
      stakeId: "free",
    }, headersFor(tokenB));
    expect(second.status).toBe(400);
    expect(second.body.error).toContain("already pending");
  });
});

describe("Rematch self-challenge prevention", () => {
  it("rejects rematch with self", async () => {
    const res = await makeRequest("POST", "/api/social/rematch", {
      opponentId: userAId,
    }, headersFor(tokenA));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Cannot rematch yourself");
  });
});

describe("Rematch detail endpoint", () => {
  it("participants can view rematch details", async () => {
    const create = await makeRequest("POST", "/api/social/rematch", {
      opponentId: userAId,
      stakeId: "free",
    }, headersFor(tokenC));
    expect(create.status).toBe(200);
    const id = create.body.rematch.id;

    // C can view
    const resC = await makeRequest("GET", `/api/social/rematch/${id}`, undefined, headersFor(tokenC));
    expect(resC.status).toBe(200);
    expect(resC.body.rematch.id).toBe(id);

    // A can view (as participant)
    const resA = await makeRequest("GET", `/api/social/rematch/${id}`, undefined, headersFor(tokenA));
    expect(resA.status).toBe(200);

    // B cannot view (not a participant)
    const resB = await makeRequest("GET", `/api/social/rematch/${id}`, undefined, headersFor(tokenB));
    expect(resB.status).toBe(403);
  });

  it("returns 404 for nonexistent rematch", async () => {
    const res = await makeRequest("GET", "/api/social/rematch/nonexistent-id", undefined, headersFor(tokenA));
    expect(res.status).toBe(404);
  });
});

// ── Availability Status ─────────────────────────────────────────────

describe("Availability status API", () => {
  it("returns availability for a valid player", async () => {
    const res = await makeRequest("GET", `/api/social/availability/${userBId}`, undefined, headersFor(tokenA));

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userBId);
    expect(res.body.username).toBeDefined();
    expect(typeof res.body.username).toBe("string");
    expect(["online", "in_match", "in_queue", "offline"]).toContain(res.body.availability);
  });

  it("returns 404 for nonexistent player", async () => {
    const res = await makeRequest("GET", "/api/social/availability/nonexistent-id", undefined, headersFor(tokenA));
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await makeRequest("GET", `/api/social/availability/${userBId}`);
    expect(res.status).toBe(401);
  });
});

describe("Batch availability API", () => {
  it("returns availability for multiple users", async () => {
    const res = await makeRequest("POST", "/api/social/availability/batch", {
      userIds: [userAId, userBId, userCId],
    }, headersFor(tokenA));

    expect(res.status).toBe(200);
    expect(res.body.availabilities).toBeDefined();
    expect(typeof res.body.availabilities).toBe("object");
    // Each user should have a status string
    for (const id of [userAId, userBId, userCId]) {
      expect(["online", "in_match", "in_queue", "offline"]).toContain(res.body.availabilities[id]);
    }
  });

  it("rejects empty userIds array", async () => {
    const res = await makeRequest("POST", "/api/social/availability/batch", {
      userIds: [],
    }, headersFor(tokenA));
    expect(res.status).toBe(400);
  });

  it("rejects missing userIds", async () => {
    const res = await makeRequest("POST", "/api/social/availability/batch", {}, headersFor(tokenA));
    expect(res.status).toBe(400);
  });
});

// ── Rematch Validation Errors ───────────────────────────────────────

describe("Rematch validation errors", () => {
  it("rejects rematch without opponentId", async () => {
    const res = await makeRequest("POST", "/api/social/rematch", {}, headersFor(tokenA));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("opponentId is required");
  });

  it("rejects rematch with nonexistent opponent", async () => {
    const res = await makeRequest("POST", "/api/social/rematch", {
      opponentId: "nonexistent-id",
    }, headersFor(tokenA));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Player not found");
  });
});

// ── Challenge Room ID Format ────────────────────────────────────────

describe("Challenge room ID format", () => {
  it("room IDs start with CH- prefix and are 9 characters total", async () => {
    // Create and accept a new challenge
    const create = await makeRequest("POST", "/api/social/challenge", {
      targetId: userCId,
      stakeId: "free",
    }, headersFor(tokenA));
    expect(create.status).toBe(200);

    const accept = await makeRequest("POST", `/api/social/challenge/${create.body.challenge.id}/accept`, undefined, headersFor(tokenC));
    expect(accept.status).toBe(200);
    const roomId = accept.body.roomId;

    expect(roomId).toMatch(/^CH-[A-Z2-9]{6}$/);
  });
});

// ── Edge Cases ──────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("declining a challenge does not allocate a room", async () => {
    const create = await makeRequest("POST", "/api/social/challenge", {
      targetId: userBId,
      stakeId: "free",
    }, headersFor(tokenC));
    expect(create.status).toBe(200);
    const challId = create.body.challenge.id;

    const decline = await makeRequest("POST", `/api/social/challenge/${challId}/decline`, undefined, headersFor(tokenB));
    expect(decline.status).toBe(200);

    const detail = await makeRequest("GET", `/api/social/challenge/${challId}`, undefined, headersFor(tokenC));
    expect(detail.body.challenge.status).toBe("declined");
    expect(detail.body.challenge.roomId).toBeNull();
  });

  it("cancelled challenges do not have room IDs", async () => {
    const create = await makeRequest("POST", "/api/social/challenge", {
      targetId: userCId,
      stakeId: "free",
    }, headersFor(tokenB));
    expect(create.status).toBe(200);
    const challId = create.body.challenge.id;

    const cancel = await makeRequest("POST", `/api/social/challenge/${challId}/cancel`, undefined, headersFor(tokenB));
    expect(cancel.status).toBe(200);

    const detail = await makeRequest("GET", `/api/social/challenge/${challId}`, undefined, headersFor(tokenB));
    expect(detail.body.challenge.status).toBe("cancelled");
    expect(detail.body.challenge.roomId).toBeNull();
  });
});

// ── Regression Tests ────────────────────────────────────────────────

describe("Regression — existing endpoints unchanged", () => {
  it("challenge inbox still works", async () => {
    const res = await makeRequest("GET", "/api/social/challenges/inbox", undefined, headersFor(tokenA));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.challenges)).toBe(true);
  });

  it("challenge outbox still works", async () => {
    const res = await makeRequest("GET", "/api/social/challenges/outbox", undefined, headersFor(tokenA));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.challenges)).toBe(true);
  });

  it("challenge history still works", async () => {
    const res = await makeRequest("GET", "/api/social/challenges/history", undefined, headersFor(tokenA));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.challenges)).toBe(true);
  });

  it("following list still works", async () => {
    const res = await makeRequest("GET", "/api/social/following", undefined, headersFor(tokenA));
    expect(res.status).toBe(200);
  });

  it("notifications still work", async () => {
    const res = await makeRequest("GET", "/api/social/notifications", undefined, headersFor(tokenA));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.notifications)).toBe(true);
  });

  it("head-to-head still works", async () => {
    const res = await makeRequest("GET", `/api/social/head-to-head/${userBId}`, undefined, headersFor(tokenA));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("wins");
    expect(res.body).toHaveProperty("losses");
  });

  it("follow/unfollow still works", async () => {
    const follow = await makeRequest("POST", `/api/social/follow/${userBId}`, undefined, headersFor(tokenA));
    expect(follow.status).toBe(200);

    const unfollow = await makeRequest("DELETE", `/api/social/follow/${userBId}`, undefined, headersFor(tokenA));
    expect(unfollow.status).toBe(200);
  });

  it("mark notifications read still works", async () => {
    const res = await makeRequest("POST", "/api/social/notifications/read", {}, headersFor(tokenA));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("marked");
  });

  it("health endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });

  it("wallet API still works", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, headersFor(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.balances).toBeDefined();
  });

  it("leaderboard still works", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });
});
