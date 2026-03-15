/**
 * Season, Seasonal Leaderboard, and Public Social Layer Tests for Gin Paradise.
 *
 * Covers:
 *   - Season metadata retrieval
 *   - Season auto-creation
 *   - Seasonal leaderboard behavior
 *   - Seasonal match recording and rating updates
 *   - Public profile data shape and privacy boundaries
 *   - Public profile enrichment (season stats, recent highlights)
 *   - Leaderboard / profile integration
 *   - Regression coverage for gameplay, trust, coaching, training, profile,
 *     cosmetics, entitlements, wallet, tournaments, and multiplayer
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer, registerUser, loginUser, makeRequest, getBaseUrl } from "./helpers.js";
import { db } from "../server/db.js";
import { recordSeasonalMatch, getCurrentSeason } from "../server/seasons.js";

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

function getUserId(username: string): string {
  const row = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as any;
  return row?.id;
}

function insertTestReplay(opts: {
  player1Id: string;
  player1Username: string;
  player2Id: string;
  player2Username: string;
  winnerId?: string;
  winnerUsername?: string;
  endReason?: string;
}) {
  const id = `replay-season-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO replays (id, room_id, started_at, ended_at,
      player1_id, player1_username, player2_id, player2_username,
      winner_id, winner_username, loser_id, loser_username,
      winner_score, loser_score, end_reason, action_count, transcript_json,
      match_format, tournament_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, "room-season-test", now - 60000, now,
    opts.player1Id, opts.player1Username,
    opts.player2Id, opts.player2Username,
    opts.winnerId || null, opts.winnerUsername || null,
    opts.winnerId ? (opts.winnerId === opts.player1Id ? opts.player2Id : opts.player1Id) : null,
    opts.winnerId ? (opts.winnerId === opts.player1Id ? opts.player2Username : opts.player1Username) : null,
    10, 5, opts.endReason || "completed", 20,
    JSON.stringify([{ type: "match_start", detail: {} }]),
    "heads_up", null,
  );
  return id;
}

// ── Season Metadata Tests ────────────────────────────────────────

describe("Season Model — Metadata", () => {
  it("returns current active season", async () => {
    const res = await makeRequest("GET", "/api/seasons/current");
    expect(res.status).toBe(200);
    expect(res.body.season).toBeDefined();
    expect(res.body.season.id).toBeDefined();
    expect(res.body.season.name).toBeDefined();
    expect(res.body.season.number).toBeTypeOf("number");
    expect(res.body.season.status).toBe("active");
  });

  it("season has valid start and end dates", async () => {
    const res = await makeRequest("GET", "/api/seasons/current");
    const season = res.body.season;
    expect(season.startAt).toBeTypeOf("number");
    expect(season.endAt).toBeTypeOf("number");
    expect(season.endAt).toBeGreaterThan(season.startAt);
  });

  it("season has a theme label", async () => {
    const res = await makeRequest("GET", "/api/seasons/current");
    expect(res.body.season.theme).toBeDefined();
    expect(typeof res.body.season.theme).toBe("string");
  });

  it("season includes progress information", async () => {
    const res = await makeRequest("GET", "/api/seasons/current");
    expect(res.body.season.daysRemaining).toBeTypeOf("number");
    expect(res.body.season.daysRemaining).toBeGreaterThan(0);
    expect(res.body.season.totalDays).toBeTypeOf("number");
    expect(res.body.season.progress).toBeTypeOf("number");
  });

  it("season has a stable identifier", async () => {
    const res1 = await makeRequest("GET", "/api/seasons/current");
    const res2 = await makeRequest("GET", "/api/seasons/current");
    expect(res1.body.season.id).toBe(res2.body.season.id);
  });

  it("all-seasons endpoint returns at least one season", async () => {
    const res = await makeRequest("GET", "/api/seasons/all");
    expect(res.status).toBe(200);
    expect(res.body.seasons).toBeInstanceOf(Array);
    expect(res.body.seasons.length).toBeGreaterThanOrEqual(1);
    expect(res.body.seasons[0].status).toBe("active");
  });
});

// ── Seasonal Leaderboard Tests ───────────────────────────────────

describe("Seasonal Leaderboard", () => {
  let user1Session: string;
  let user2Session: string;
  let user1Id: string;
  let user2Id: string;
  const suffix = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    user1Session = await createUserAndAuth(`season_p1_${suffix}`, `sp1_${suffix}@test.com`);
    user2Session = await createUserAndAuth(`season_p2_${suffix}`, `sp2_${suffix}@test.com`);
    user1Id = getUserId(`season_p1_${suffix}`);
    user2Id = getUserId(`season_p2_${suffix}`);

    // Simulate 3 matches: user1 wins 2, user2 wins 1
    const season = getCurrentSeason();
    if (season) {
      recordSeasonalMatch(season.id, user1Id, user2Id);
      recordSeasonalMatch(season.id, user1Id, user2Id);
      recordSeasonalMatch(season.id, user2Id, user1Id);
    }
  });

  it("seasonal leaderboard returns standings", async () => {
    const res = await makeRequest("GET", "/api/seasons/leaderboard");
    expect(res.status).toBe(200);
    expect(res.body.standings).toBeInstanceOf(Array);
    expect(res.body.season).toBeDefined();
    expect(res.body.season.name).toBeDefined();
  });

  it("seasonal leaderboard entries have correct shape", async () => {
    const res = await makeRequest("GET", "/api/seasons/leaderboard");
    if (res.body.standings.length > 0) {
      const entry = res.body.standings[0];
      expect(entry.rank).toBeTypeOf("number");
      expect(entry.username).toBeTypeOf("string");
      expect(entry.seasonalRating).toBeTypeOf("number");
      expect(entry.seasonWins).toBeTypeOf("number");
      expect(entry.seasonLosses).toBeTypeOf("number");
      expect(entry.seasonMatches).toBeTypeOf("number");
      expect(entry.winRate).toBeTypeOf("string");
      expect(entry.ratingTier).toBeDefined();
    }
  });

  it("leaderboard ?view=seasonal returns seasonal data", async () => {
    const res = await makeRequest("GET", "/api/leaderboard?view=seasonal");
    expect(res.status).toBe(200);
    expect(res.body.view).toBe("seasonal");
    expect(res.body.season).toBeDefined();
    expect(res.body.leaderboard).toBeInstanceOf(Array);
  });

  it("leaderboard ?view=lifetime returns lifetime data", async () => {
    const res = await makeRequest("GET", "/api/leaderboard?view=lifetime");
    expect(res.status).toBe(200);
    expect(res.body.view).toBe("lifetime");
    expect(res.body.leaderboard).toBeInstanceOf(Array);
  });

  it("default leaderboard returns lifetime data", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
    expect(res.body.view).toBe("lifetime");
  });
});

// ── Player Season Stats Tests ────────────────────────────────────

describe("Player Season Stats", () => {
  let sessionId: string;
  let userId: string;
  const suffix = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    sessionId = await createUserAndAuth(`season_me_${suffix}`, `sme_${suffix}@test.com`);
    userId = getUserId(`season_me_${suffix}`);

    const season = getCurrentSeason();
    if (season) {
      // Record some seasonal matches
      const opponentId = `opponent-season-${suffix}`;
      recordSeasonalMatch(season.id, userId, opponentId);
      recordSeasonalMatch(season.id, userId, opponentId);
    }
  });

  it("returns current season stats for authenticated user", async () => {
    const res = await makeRequest("GET", "/api/seasons/me", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.seasonStats).toBeDefined();
    expect(res.body.seasonStats.seasonName).toBeDefined();
    expect(res.body.seasonStats.seasonalRating).toBeTypeOf("number");
    expect(res.body.seasonStats.seasonWins).toBeGreaterThanOrEqual(2);
  });

  it("season stats include rank and days remaining", async () => {
    const res = await makeRequest("GET", "/api/seasons/me", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.body.seasonStats.seasonRank).toBeTypeOf("number");
    expect(res.body.seasonStats.daysRemaining).toBeTypeOf("number");
    expect(res.body.seasonStats.totalSeasonPlayers).toBeTypeOf("number");
  });

  it("rejects unauthenticated season stats", async () => {
    const res = await makeRequest("GET", "/api/seasons/me");
    expect(res.status).toBe(401);
  });

  it("seasonal rating increases after wins", async () => {
    const res = await makeRequest("GET", "/api/seasons/me", undefined, { Authorization: `Bearer ${sessionId}` });
    // Started at 1200, won 2 matches, should be above 1200
    expect(res.body.seasonStats.seasonalRating).toBeGreaterThan(1200);
  });
});

// ── Public Profile Enhancement Tests ─────────────────────────────

describe("Public Profile — Enhanced Social Data", () => {
  let sessionId: string;
  let userId: string;
  let username: string;
  const suffix = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    username = `social_pub_${suffix}`;
    sessionId = await createUserAndAuth(username, `social_${suffix}@test.com`);
    userId = getUserId(username);

    // Set up some data
    db.prepare("UPDATE users SET wins = 10, losses = 5 WHERE id = ?").run(userId);

    // Create a replay for recent highlights
    insertTestReplay({
      player1Id: userId,
      player1Username: username,
      player2Id: "test-opponent-pub",
      player2Username: "TestOpponent",
      winnerId: userId,
      winnerUsername: username,
    });

    // Record seasonal match
    const season = getCurrentSeason();
    if (season) {
      recordSeasonalMatch(season.id, userId, "test-opponent-pub");
    }
  });

  it("public profile includes season stats", async () => {
    const res = await makeRequest("GET", `/api/profile/${username}`);
    expect(res.status).toBe(200);
    expect(res.body.seasonStats).toBeDefined();
    if (res.body.seasonStats) {
      expect(res.body.seasonStats.seasonName).toBeDefined();
      expect(res.body.seasonStats.seasonalRating).toBeTypeOf("number");
    }
  });

  it("public profile includes recent highlights", async () => {
    const res = await makeRequest("GET", `/api/profile/${username}`);
    expect(res.body.recentHighlights).toBeInstanceOf(Array);
    if (res.body.recentHighlights.length > 0) {
      const h = res.body.recentHighlights[0];
      expect(h.result).toBeDefined();
      expect(h.opponent).toBeDefined();
      expect(h.playedAt).toBeTypeOf("number");
    }
  });

  it("public profile includes win streak", async () => {
    const res = await makeRequest("GET", `/api/profile/${username}`);
    expect(res.body.user.currentWinStreak).toBeTypeOf("number");
  });

  it("public profile does NOT expose user ID", async () => {
    const res = await makeRequest("GET", `/api/profile/${username}`);
    expect(res.body.user.id).toBeUndefined();
  });

  it("public profile does NOT expose recent accuracy or internal data", async () => {
    const res = await makeRequest("GET", `/api/profile/${username}`);
    expect(res.body.user.recentAccuracy).toBeUndefined();
    expect(res.body.newAwards).toBeUndefined();
    expect(res.body.allAchievements).toBeUndefined();
  });

  it("public profile has achievements, prestige, and profile selections", async () => {
    const res = await makeRequest("GET", `/api/profile/${username}`);
    expect(res.body.achievements).toBeInstanceOf(Array);
    expect(res.body.prestige).toBeInstanceOf(Array);
    expect(res.body.profile).toBeDefined();
    expect(res.body.profile).toHaveProperty("selectedTitle");
    expect(res.body.profile).toHaveProperty("selectedBadge");
    expect(res.body.profile).toHaveProperty("bio");
  });
});

// ── Authenticated Profile — Season Integration ───────────────────

describe("Authenticated Profile — Season Stats", () => {
  let sessionId: string;
  let userId: string;
  const suffix = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    sessionId = await createUserAndAuth(`auth_season_${suffix}`, `asn_${suffix}@test.com`);
    userId = getUserId(`auth_season_${suffix}`);

    const season = getCurrentSeason();
    if (season) {
      recordSeasonalMatch(season.id, userId, "auth-opponent");
    }
  });

  it("authenticated profile includes season stats", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.seasonStats).toBeDefined();
    if (res.body.seasonStats) {
      expect(res.body.seasonStats.seasonId).toBeDefined();
      expect(res.body.seasonStats.seasonalRating).toBeTypeOf("number");
      expect(res.body.seasonStats.daysRemaining).toBeTypeOf("number");
    }
  });
});

// ── Regression Coverage ──────────────────────────────────────────

describe("Season Layer — Regression Coverage", () => {
  let sessionId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`reg_season_${suffix}`, `regs_${suffix}@test.com`);
  });

  it("gameplay: login still works", async () => {
    const res = await makeRequest("POST", "/api/auth/login", { username: `reg_season_${Math.random().toString(36).slice(2, 8)}`, password: "wrongpass" });
    // expect 401 (wrong credentials) — confirms auth route works
    expect(res.status).toBe(401);
  });

  it("wallet API still works", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
  });

  it("leaderboard still works (default)", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toBeInstanceOf(Array);
  });

  it("profile still works", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
  });

  it("training summary still works", async () => {
    const res = await makeRequest("GET", "/api/training/summary", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
  });

  it("cosmetics catalog still works", async () => {
    const res = await makeRequest("GET", "/api/cosmetics/catalog", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
  });

  it("entitlements plan still works", async () => {
    const res = await makeRequest("GET", "/api/entitlements/plan", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
  });

  it("health endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });

  it("tournaments API still works", async () => {
    const res = await makeRequest("GET", "/api/tournaments", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
  });

  it("stats endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/stats", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
 });

  it("fairness verify still works", async () => {
    const res = await makeRequest("POST", "/api/fairness/verify", { proof: "invalid" });
    // Returns 400 since proof is invalid — route is still functional
    expect([200, 400]).toContain(res.status);
  });
});
