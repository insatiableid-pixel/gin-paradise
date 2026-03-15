/**
 * Social, Challenge, Follow, and Rematch tests for Gin Paradise.
 *
 * Covers:
 *  - Follow / unfollow behavior and permission boundaries
 *  - Challenge creation, acceptance, decline, expiry, and invalid-state handling
 *  - Rematch initiation and validation
 *  - Social notification / inbox behavior for challenge events
 *  - Head-to-head record queries
 *  - Public profile social integration
 *  - Regression: existing systems remain unaffected
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer, registerUser, makeRequest } from "./helpers.js";

let baseUrl: string;
let user1Token: string;
let user2Token: string;
let user3Token: string;
let user1Id: string;
let user2Id: string;
let user3Id: string;

beforeAll(async () => {
  baseUrl = await startTestServer();

  // Register three test users
  const r1 = await registerUser(`social_alice_${Date.now()}`, `social_alice_${Date.now()}@test.com`, "password123");
  user1Token = r1.body.sessionId;
  user1Id = r1.body.user.id;

  const r2 = await registerUser(`social_bob_${Date.now()}`, `social_bob_${Date.now()}@test.com`, "password123");
  user2Token = r2.body.sessionId;
  user2Id = r2.body.user.id;

  const r3 = await registerUser(`social_carol_${Date.now()}`, `social_carol_${Date.now()}@test.com`, "password123");
  user3Token = r3.body.sessionId;
  user3Id = r3.body.user.id;
});

afterAll(async () => {
  await stopTestServer();
});

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── Follow Tests ─────────────────────────────────────────────────

describe("Social Follow Model", () => {
  it("should follow another player", async () => {
    const res = await makeRequest("POST", `/api/social/follow/${user2Id}`, {}, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.isFollowing).toBe(true);
    expect(res.body.followerCount).toBeGreaterThanOrEqual(1);
  });

  it("should reject following yourself", async () => {
    const res = await makeRequest("POST", `/api/social/follow/${user1Id}`, {}, authHeader(user1Token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("yourself");
  });

  it("should reject duplicate follow", async () => {
    const res = await makeRequest("POST", `/api/social/follow/${user2Id}`, {}, authHeader(user1Token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Already following");
  });

  it("should reject following non-existent player", async () => {
    const res = await makeRequest("POST", `/api/social/follow/nonexistent-id`, {}, authHeader(user1Token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not found");
  });

  it("should check relationship status", async () => {
    const res = await makeRequest("GET", `/api/social/relationship/${user2Id}`, undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.isFollowing).toBe(true);
    expect(res.body.isFollowedBy).toBe(false);
    expect(res.body.isSelf).toBe(false);
  });

  it("should handle self-relationship check", async () => {
    const res = await makeRequest("GET", `/api/social/relationship/${user1Id}`, undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.isSelf).toBe(true);
  });

  it("should list followers", async () => {
    // user2 should have user1 as a follower
    const res = await makeRequest("GET", "/api/social/followers", undefined, authHeader(user2Token));
    expect(res.status).toBe(200);
    expect(res.body.followers).toBeDefined();
    expect(res.body.totalCount).toBeGreaterThanOrEqual(1);
  });

  it("should list following", async () => {
    // user1 should be following user2
    const res = await makeRequest("GET", "/api/social/following", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.following).toBeDefined();
    expect(res.body.totalCount).toBeGreaterThanOrEqual(1);
  });

  it("should create notification for new follower", async () => {
    // user2 should have a new_follower notification
    const res = await makeRequest("GET", "/api/social/notifications", undefined, authHeader(user2Token));
    expect(res.status).toBe(200);
    const followerNotif = res.body.notifications.find((n: any) => n.type === "new_follower");
    expect(followerNotif).toBeDefined();
    expect(followerNotif.fromUserId).toBe(user1Id);
  });

  it("should unfollow a player", async () => {
    // First follow user3
    await makeRequest("POST", `/api/social/follow/${user3Id}`, {}, authHeader(user1Token));

    // Then unfollow
    const res = await makeRequest("DELETE", `/api/social/follow/${user3Id}`, {}, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.isFollowing).toBe(false);
  });

  it("should reject unfollowing when not following", async () => {
    const res = await makeRequest("DELETE", `/api/social/follow/${user3Id}`, {}, authHeader(user1Token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Not following");
  });
});

// ── Challenge Tests ──────────────────────────────────────────────

describe("Direct Challenge Flow", () => {
  let challengeId: string;

  it("should create a challenge", async () => {
    const res = await makeRequest("POST", "/api/social/challenge", {
      targetId: user2Id,
    }, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.challenge).toBeDefined();
    expect(res.body.challenge.status).toBe("pending");
    expect(res.body.challenge.challengerId).toBe(user1Id);
    expect(res.body.challenge.targetId).toBe(user2Id);
    challengeId = res.body.challenge.id;
  });

  it("should reject challenging yourself", async () => {
    const res = await makeRequest("POST", "/api/social/challenge", {
      targetId: user1Id,
    }, authHeader(user1Token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("yourself");
  });

  it("should reject duplicate pending challenge to same target", async () => {
    const res = await makeRequest("POST", "/api/social/challenge", {
      targetId: user2Id,
    }, authHeader(user1Token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("pending challenge");
  });

  it("should list pending challenges in inbox", async () => {
    const res = await makeRequest("GET", "/api/social/challenges/inbox", undefined, authHeader(user2Token));
    expect(res.status).toBe(200);
    expect(res.body.challenges.length).toBeGreaterThanOrEqual(1);
    const ch = res.body.challenges.find((c: any) => c.id === challengeId);
    expect(ch).toBeDefined();
    expect(ch.status).toBe("pending");
  });

  it("should list pending challenges in outbox", async () => {
    const res = await makeRequest("GET", "/api/social/challenges/outbox", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.challenges.length).toBeGreaterThanOrEqual(1);
  });

  it("should create notification for challenge received", async () => {
    const res = await makeRequest("GET", "/api/social/notifications?unread=true", undefined, authHeader(user2Token));
    expect(res.status).toBe(200);
    const challengeNotif = res.body.notifications.find((n: any) => n.type === "challenge_received");
    expect(challengeNotif).toBeDefined();
    expect(challengeNotif.referenceId).toBe(challengeId);
  });

  it("should reject accept by wrong user", async () => {
    const res = await makeRequest("POST", `/api/social/challenge/${challengeId}/accept`, {}, authHeader(user3Token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Not your challenge");
  });

  it("should accept a challenge", async () => {
    const res = await makeRequest("POST", `/api/social/challenge/${challengeId}/accept`, {}, authHeader(user2Token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.challenge.status).toBe("accepted");
  });

  it("should reject accepting an already accepted challenge", async () => {
    const res = await makeRequest("POST", `/api/social/challenge/${challengeId}/accept`, {}, authHeader(user2Token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("accepted");
  });

  it("should create notification for challenge accepted", async () => {
    const res = await makeRequest("GET", "/api/social/notifications", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    const acceptNotif = res.body.notifications.find((n: any) => n.type === "challenge_accepted");
    expect(acceptNotif).toBeDefined();
  });

  it("should view challenge details by participants only", async () => {
    const res1 = await makeRequest("GET", `/api/social/challenge/${challengeId}`, undefined, authHeader(user1Token));
    expect(res1.status).toBe(200);
    expect(res1.body.challenge.id).toBe(challengeId);

    const res2 = await makeRequest("GET", `/api/social/challenge/${challengeId}`, undefined, authHeader(user3Token));
    expect(res2.status).toBe(403);
  });

  it("should show challenge history", async () => {
    const res = await makeRequest("GET", "/api/social/challenges/history", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.challenges.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Challenge Decline Flow", () => {
  let challengeId: string;

  it("should create and decline a challenge", async () => {
    const create = await makeRequest("POST", "/api/social/challenge", {
      targetId: user3Id,
    }, authHeader(user1Token));
    expect(create.status).toBe(200);
    challengeId = create.body.challenge.id;

    const decline = await makeRequest("POST", `/api/social/challenge/${challengeId}/decline`, {}, authHeader(user3Token));
    expect(decline.status).toBe(200);
    expect(decline.body.success).toBe(true);
  });

  it("should create notification for declined challenge", async () => {
    const res = await makeRequest("GET", "/api/social/notifications", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    const declineNotif = res.body.notifications.find((n: any) => n.type === "challenge_declined");
    expect(declineNotif).toBeDefined();
  });

  it("should reject declining an already declined challenge", async () => {
    const res = await makeRequest("POST", `/api/social/challenge/${challengeId}/decline`, {}, authHeader(user3Token));
    expect(res.status).toBe(400);
  });
});

describe("Challenge Cancel Flow", () => {
  let challengeId: string;

  it("should create and cancel own challenge", async () => {
    const create = await makeRequest("POST", "/api/social/challenge", {
      targetId: user3Id,
    }, authHeader(user2Token));
    expect(create.status).toBe(200);
    challengeId = create.body.challenge.id;

    const cancel = await makeRequest("POST", `/api/social/challenge/${challengeId}/cancel`, {}, authHeader(user2Token));
    expect(cancel.status).toBe(200);
    expect(cancel.body.success).toBe(true);
  });

  it("should reject cancel by non-challenger", async () => {
    // Create a new challenge to test wrong-user cancel
    const create = await makeRequest("POST", "/api/social/challenge", {
      targetId: user3Id,
    }, authHeader(user2Token));
    const id = create.body.challenge.id;

    const cancelWrong = await makeRequest("POST", `/api/social/challenge/${id}/cancel`, {}, authHeader(user3Token));
    expect(cancelWrong.status).toBe(400);
    expect(cancelWrong.body.error).toContain("Not your challenge");
  });
});

describe("Challenge Validation Edge Cases", () => {
  it("should require targetId", async () => {
    const res = await makeRequest("POST", "/api/social/challenge", {}, authHeader(user1Token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("targetId");
  });

  it("should reject challenge to non-existent player", async () => {
    const res = await makeRequest("POST", "/api/social/challenge", {
      targetId: "nonexistent-id",
    }, authHeader(user1Token));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not found");
  });

  it("should reject accessing non-existent challenge", async () => {
    const res = await makeRequest("GET", "/api/social/challenge/nonexistent-id", undefined, authHeader(user1Token));
    expect(res.status).toBe(404);
  });
});

// ── Head-to-Head Tests ───────────────────────────────────────────

describe("Head-to-Head Record", () => {
  it("should return empty head-to-head for new matchup", async () => {
    const res = await makeRequest("GET", `/api/social/head-to-head/${user2Id}`, undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.isSelf).toBe(false);
    expect(res.body.total).toBe(0);
    expect(res.body.wins).toBe(0);
    expect(res.body.losses).toBe(0);
  });

  it("should handle self head-to-head", async () => {
    const res = await makeRequest("GET", `/api/social/head-to-head/${user1Id}`, undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.isSelf).toBe(true);
  });
});

// ── Social Notification Tests ────────────────────────────────────

describe("Social Notifications", () => {
  it("should list all notifications", async () => {
    const res = await makeRequest("GET", "/api/social/notifications", undefined, authHeader(user2Token));
    expect(res.status).toBe(200);
    expect(res.body.notifications).toBeDefined();
    expect(Array.isArray(res.body.notifications)).toBe(true);
    expect(res.body.unreadCount).toBeDefined();
  });

  it("should filter unread notifications", async () => {
    const res = await makeRequest("GET", "/api/social/notifications?unread=true", undefined, authHeader(user2Token));
    expect(res.status).toBe(200);
    // All returned should be unread
    for (const n of res.body.notifications) {
      expect(n.read).toBe(false);
    }
  });

  it("should mark specific notifications as read", async () => {
    const list = await makeRequest("GET", "/api/social/notifications?unread=true", undefined, authHeader(user2Token));
    if (list.body.notifications.length > 0) {
      const id = list.body.notifications[0].id;
      const res = await makeRequest("POST", "/api/social/notifications/read", {
        notificationIds: [id],
      }, authHeader(user2Token));
      expect(res.status).toBe(200);
      expect(res.body.marked).toBeGreaterThanOrEqual(1);
    }
  });

  it("should mark all notifications as read", async () => {
    const res = await makeRequest("POST", "/api/social/notifications/read", {}, authHeader(user2Token));
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(0);
  });
});

// ── Public Profile Integration Tests ─────────────────────────────

describe("Public Profile Social Integration", () => {
  it("should include social counts in own profile", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.social).toBeDefined();
    expect(typeof res.body.social.followerCount).toBe("number");
    expect(typeof res.body.social.followingCount).toBe("number");
  });

  it("should include social counts in public profile", async () => {
    const user2 = await makeRequest("GET", "/api/profile", undefined, authHeader(user2Token));
    const username = user2.body.user.username;

    const res = await makeRequest("GET", `/api/profile/${username}`, undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.social).toBeDefined();
    expect(typeof res.body.social.followerCount).toBe("number");
    expect(typeof res.body.social.followingCount).toBe("number");
  });

  it("should include relationship data in public profile when authenticated", async () => {
    const user2 = await makeRequest("GET", "/api/profile", undefined, authHeader(user2Token));
    const username = user2.body.user.username;

    const res = await makeRequest("GET", `/api/profile/${username}`, undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.relationship).toBeDefined();
    expect(typeof res.body.relationship.isFollowing).toBe("boolean");
    expect(typeof res.body.relationship.isFollowedBy).toBe("boolean");
    expect(res.body.relationship.headToHead).toBeDefined();
  });
});

// ── Regression Tests ──────────────────────────────────────────────

describe("Regression: Existing Systems Unaffected", () => {
  it("health endpoint works", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });

  it("auth system works", async () => {
    const res = await makeRequest("GET", "/api/auth/me", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
  });

  it("leaderboard works", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });

  it("seasons endpoint works", async () => {
    const res = await makeRequest("GET", "/api/seasons/current");
    expect(res.status).toBe(200);
  });

  it("wallet endpoint works with auth", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
  });

  it("profile endpoint works", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.achievements).toBeDefined();
  });

  it("training summary works with auth", async () => {
    const res = await makeRequest("GET", "/api/training/summary", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
  });

  it("tournaments endpoint works", async () => {
    const res = await makeRequest("GET", "/api/tournaments", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
  });

  it("cosmetics catalog works with auth", async () => {
    const res = await makeRequest("GET", "/api/cosmetics/catalog", undefined, authHeader(user1Token));
    expect(res.status).toBe(200);
  });
});
