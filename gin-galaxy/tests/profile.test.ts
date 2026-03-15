/**
 * Profile, Achievement & Prestige Layer Tests for Gin Paradise.
 *
 * Covers:
 *   - Achievement award criteria and duplicate prevention
 *   - Profile API / data loading
 *   - Public / shareable profile access
 *   - Prestige unlock logic
 *   - Profile update validation
 *   - Achievement backfill
 *   - Regression coverage for existing features
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startTestServer, stopTestServer, registerUser, loginUser, makeRequest, getBaseUrl } from "./helpers.js";
import { db } from "../server/db.js";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

// ── Helpers ──────────────────────────────────────────────────────────

async function createUserAndAuth(username: string, email: string) {
  await registerUser(username, email, "password123");
  const login = await loginUser(username, "password123");
  return login.body.sessionId;
}

function insertTestReplay(opts: {
  id?: string;
  player1Id: string;
  player1Username: string;
  player2Id: string;
  player2Username: string;
  winnerId?: string;
  winnerUsername?: string;
  endReason?: string;
  matchFormat?: string;
  tournamentId?: string;
}) {
  const id = opts.id || `replay-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO replays (id, room_id, started_at, ended_at,
      player1_id, player1_username, player2_id, player2_username,
      winner_id, winner_username, loser_id, loser_username,
      winner_score, loser_score, end_reason, action_count, transcript_json,
      match_format, tournament_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, "room-test", now - 60000, now,
    opts.player1Id, opts.player1Username,
    opts.player2Id, opts.player2Username,
    opts.winnerId || null, opts.winnerUsername || null,
    opts.winnerId ? (opts.winnerId === opts.player1Id ? opts.player2Id : opts.player1Id) : null,
    opts.winnerId ? (opts.winnerId === opts.player1Id ? opts.player2Username : opts.player1Username) : null,
    10, 5, opts.endReason || "completed", 20,
    JSON.stringify([{ type: "match_start", detail: {} }]),
    opts.matchFormat || "heads_up",
    opts.tournamentId || null,
  );
  return id;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Profile API — Authenticated Profile", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`prof_user_${suffix}`, `prof_${suffix}@test.com`);
    const me = await makeRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${sessionId}` });
    userId = me.body.user.id;
  });

  it("returns full profile shape", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.username).toBeDefined();
    expect(res.body.user.rating).toBeTypeOf("number");
    expect(res.body.user.ratingTier).toBeDefined();
    expect(res.body.achievements).toBeInstanceOf(Array);
    expect(res.body.prestige).toBeInstanceOf(Array);
    expect(res.body.profile).toBeDefined();
    expect(res.body.allAchievements).toBeInstanceOf(Array);
    expect(res.body.achievementCount).toBeTypeOf("number");
    expect(res.body.tournamentStats).toBeDefined();
    expect(res.body.recentRecord).toBeDefined();
  });

  it("returns rating tier information", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.body.user.ratingTier).toHaveProperty("tier");
    expect(res.body.user.ratingTier).toHaveProperty("color");
  });

  it("returns achievement catalog with earned status", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.body.allAchievements.length).toBeGreaterThan(0);
    for (const a of res.body.allAchievements) {
      expect(a).toHaveProperty("id");
      expect(a).toHaveProperty("name");
      expect(a).toHaveProperty("earned");
      expect(typeof a.earned).toBe("boolean");
    }
  });

  it("rejects unauthenticated profile access", async () => {
    const res = await makeRequest("GET", "/api/profile");
    expect(res.status).toBe(401);
  });
});

describe("Achievement Award Logic", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`ach_user_${suffix}`, `ach_${suffix}@test.com`);
    const me = await makeRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${sessionId}` });
    userId = me.body.user.id;
  });

  it("awards first_match achievement when user has played", async () => {
    // Set up user with 1 win
    db.prepare("UPDATE users SET wins = 1, losses = 0 WHERE id = ?").run(userId);

    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    const earned = res.body.achievements.map((a: any) => a.achievementId);
    expect(earned).toContain("first_match");
  });

  it("prevents duplicate awards", async () => {
    // Call profile twice — should not duplicate
    await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });

    const firstMatchAwards = res.body.achievements.filter((a: any) => a.achievementId === "first_match");
    expect(firstMatchAwards.length).toBe(1);
  });

  it("awards win milestones progressively", async () => {
    db.prepare("UPDATE users SET wins = 55 WHERE id = ?").run(userId);

    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    const earned = res.body.achievements.map((a: any) => a.achievementId);
    expect(earned).toContain("win_10");
    expect(earned).toContain("win_50");
    expect(earned).not.toContain("win_100"); // only 55 wins
  });

  it("awards rating-based achievements", async () => {
    db.prepare("UPDATE users SET rating = 1450 WHERE id = ?").run(userId);

    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    const earned = res.body.achievements.map((a: any) => a.achievementId);
    expect(earned).toContain("rating_1400");
    expect(earned).not.toContain("rating_1600");
  });

  it("includes timestamps on awarded achievements", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    for (const a of res.body.achievements) {
      expect(a.awardedAt).toBeTypeOf("number");
      expect(a.awardedAt).toBeGreaterThan(0);
    }
  });
});

describe("Prestige Unlocks", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`pres_user_${suffix}`, `pres_${suffix}@test.com`);
    const me = await makeRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${sessionId}` });
    userId = me.body.user.id;
  });

  it("unlocks prestige items from achievements", async () => {
    db.prepare("UPDATE users SET wins = 1, losses = 0 WHERE id = ?").run(userId);

    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    // first_match should unlock "newcomer" badge
    const badges = res.body.prestige.filter((p: any) => p.type === "badge");
    expect(badges.some((b: any) => b.key === "newcomer")).toBe(true);
  });

  it("unlocks title from win_50 achievement", async () => {
    db.prepare("UPDATE users SET wins = 50, losses = 10 WHERE id = ?").run(userId);

    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    const titles = res.body.prestige.filter((p: any) => p.type === "title");
    expect(titles.some((t: any) => t.key === "competitor")).toBe(true);
  });

  it("includes source achievement on prestige items", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    for (const p of res.body.prestige) {
      expect(p.sourceAchievement).toBeDefined();
      expect(typeof p.sourceAchievement).toBe("string");
    }
  });
});

describe("Profile Update", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`upd_user_${suffix}`, `upd_${suffix}@test.com`);
    const me = await makeRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${sessionId}` });
    userId = me.body.user.id;

    // Award first_match to unlock newcomer badge
    db.prepare("UPDATE users SET wins = 1, losses = 0 WHERE id = ?").run(userId);
    await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
  });

  it("allows setting unlocked badge", async () => {
    const res = await makeRequest("PUT", "/api/profile", { selectedBadge: "newcomer" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.profile.selectedBadge).toBe("newcomer");
  });

  it("rejects setting locked title", async () => {
    const res = await makeRequest("PUT", "/api/profile", { selectedTitle: "elite" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not unlocked");
  });

  it("allows setting bio", async () => {
    const res = await makeRequest("PUT", "/api/profile", { bio: "I love Gin Rummy!" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.profile.bio).toBe("I love Gin Rummy!");
  });

  it("rejects bio over 200 characters", async () => {
    const longBio = "a".repeat(201);
    const res = await makeRequest("PUT", "/api/profile", { bio: longBio }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(400);
  });

  it("profile selections persist across requests", async () => {
    await makeRequest("PUT", "/api/profile", { selectedBadge: "newcomer", bio: "Test bio" }, { Authorization: `Bearer ${sessionId}` });
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.body.profile.selectedBadge).toBe("newcomer");
    expect(res.body.profile.bio).toBe("Test bio");
  });
});

describe("Public Profile", () => {
  let sessionId: string;
  let username: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    username = `pub_user_${suffix}`;
    sessionId = await createUserAndAuth(username, `pub_${suffix}@test.com`);
  });

  it("returns public profile by username", async () => {
    const res = await makeRequest("GET", `/api/profile/${username}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(username);
    expect(res.body.user.rating).toBeTypeOf("number");
    expect(res.body.tournamentStats).toBeDefined();
  });

  it("excludes sensitive data from public profile", async () => {
    const res = await makeRequest("GET", `/api/profile/${username}`);
    expect(res.body.user.id).toBeUndefined();
    expect(res.body.newAwards).toBeUndefined();
  });

  it("returns 404 for nonexistent username", async () => {
    const res = await makeRequest("GET", "/api/profile/nonexistent_user_xyz");
    expect(res.status).toBe(404);
  });

  it("shows achievements on public profile", async () => {
    const res = await makeRequest("GET", `/api/profile/${username}`);
    expect(res.body.achievements).toBeInstanceOf(Array);
    expect(res.body.prestige).toBeInstanceOf(Array);
  });
});

describe("Achievement Backfill", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`back_user_${suffix}`, `back_${suffix}@test.com`);
    const me = await makeRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${sessionId}` });
    userId = me.body.user.id;
  });

  it("backfills achievements from historical data", async () => {
    db.prepare("UPDATE users SET wins = 15, losses = 5 WHERE id = ?").run(userId);

    const res = await makeRequest("POST", "/api/profile/backfill", {}, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.newAwards).toBeInstanceOf(Array);
    expect(res.body.totalNewAwards).toBeGreaterThan(0);

    // first_match + win_10 at minimum
    const awardIds = res.body.newAwards.map((a: any) => a.achievementId);
    expect(awardIds).toContain("first_match");
    expect(awardIds).toContain("win_10");
  });

  it("second backfill returns no new awards", async () => {
    const res = await makeRequest("POST", "/api/profile/backfill", {}, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.totalNewAwards).toBe(0);
  });
});

describe("Win Streak Achievement", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`streak_user_${suffix}`, `streak_${suffix}@test.com`);
    const me = await makeRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${sessionId}` });
    userId = me.body.user.id;

    // Create 5 consecutive wins
    for (let i = 0; i < 5; i++) {
      insertTestReplay({
        player1Id: userId,
        player1Username: `streak_user_${suffix}`,
        player2Id: `opponent-${i}`,
        player2Username: `opp-${i}`,
        winnerId: userId,
        winnerUsername: `streak_user_${suffix}`,
      });
    }

    db.prepare("UPDATE users SET wins = 5, losses = 0 WHERE id = ?").run(userId);
  });

  it("awards win_streak_5 after 5 consecutive wins", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    const earned = res.body.achievements.map((a: any) => a.achievementId);
    expect(earned).toContain("win_streak_5");
  });
});

describe("Staked Win Achievement", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`staked_user_${suffix}`, `staked_${suffix}@test.com`);
    const me = await makeRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${sessionId}` });
    userId = me.body.user.id;

    insertTestReplay({
      player1Id: userId,
      player1Username: `staked_user_${suffix}`,
      player2Id: "opponent-staked",
      player2Username: "opp-staked",
      winnerId: userId,
      winnerUsername: `staked_user_${suffix}`,
      matchFormat: "heads_up_staked",
    });

    db.prepare("UPDATE users SET wins = 1, losses = 0 WHERE id = ?").run(userId);
  });

  it("awards staked_win for winning a staked match", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    const earned = res.body.achievements.map((a: any) => a.achievementId);
    expect(earned).toContain("staked_win");
  });
});

describe("Achievement Catalog", () => {
  it("returns full achievement catalog without auth", async () => {
    const res = await makeRequest("GET", "/api/profile/achievements/catalog");
    expect(res.status).toBe(200);
    expect(res.body.achievements).toBeInstanceOf(Array);
    expect(res.body.achievements.length).toBeGreaterThan(20);
    for (const a of res.body.achievements) {
      expect(a).toHaveProperty("id");
      expect(a).toHaveProperty("name");
      expect(a).toHaveProperty("category");
      expect(a).toHaveProperty("tier");
    }
  });
});

describe("Profile — Regression Coverage", () => {
  let sessionId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`reg_user_${suffix}`, `reg_${suffix}@test.com`);
  });

  it("wallet API still works", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
  });

  it("leaderboard still works", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });

  it("stats endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/stats", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.stats).toBeDefined();
  });

  it("training summary still works", async () => {
    const res = await makeRequest("GET", "/api/training/summary", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
  });

  it("health endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });
});
