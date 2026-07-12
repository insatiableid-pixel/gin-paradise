import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestServer,
  stopTestServer,
  registerUser,
  loginUser,
  makeRequest,
} from "./helpers.js";
import { db } from "../server/db.js";
import { consumeWebSocketTicket } from "../server/websocketTickets.js";

/**
 * Comprehensive cleanup of all test users and their FK-dependent rows.
 * Tables are deleted in dependency order (children before parents).
 * We also temporarily disable FK constraints as a safety net in case
 * new FK-dependent tables are added in the future.
 */
function cleanTestUsers(): void {
  const testUserFilter = "SELECT id FROM users WHERE username LIKE 'test_%'";

  // Temporarily disable FK enforcement so deletion order isn't critical
  db.pragma("foreign_keys = OFF");

  try {
    // Child tables referencing users(id) — added as the schema grew
    const childTables = [
      // social
      { table: "social_notifications", col: "user_id" },
      { table: "rematches", col: "player1_id" },
      { table: "challenges", col: "challenger_id" },
      { table: "follows", col: "follower_id" },
      { table: "follows", col: "following_id" },
      // daily retention
      { table: "daily_puzzles", col: "user_id" },
      { table: "daily_streaks", col: "user_id" },
      { table: "daily_missions", col: "user_id" },
      // billing & offers
      { table: "offer_redemptions", col: "user_id" },
      { table: "offer_interactions", col: "user_id" },
      { table: "billing_sessions", col: "user_id" },
      // cosmetics & achievements
      { table: "cosmetic_inventory", col: "user_id" },
      { table: "achievement_notifications", col: "user_id" },
      { table: "player_profiles", col: "user_id" },
      { table: "prestige", col: "user_id" },
      { table: "achievements", col: "user_id" },
      // entitlements
      { table: "entitlements", col: "user_id" },
      { table: "entitlement_audit_log", col: "user_id" },
      // core tables already cleaned before
      { table: "player_spectate_preferences", col: "user_id" },
      { table: "transactions", col: "user_id" },
      { table: "wallets", col: "user_id" },
      { table: "sessions", col: "user_id" },
      { table: "matches", col: "user_id" },
    ];

    for (const { table, col } of childTables) {
      try {
        db.prepare(`DELETE FROM ${table} WHERE ${col} IN (${testUserFilter})`).run();
      } catch {
        // Table may not exist yet — ignore
      }
    }

    // Finally delete the users themselves
    db.prepare("DELETE FROM users WHERE username LIKE 'test_%'").run();
  } finally {
    // Re-enable FK enforcement
    db.pragma("foreign_keys = ON");
  }
}

beforeAll(async () => {
  await startTestServer();
  cleanTestUsers();
});

afterAll(async () => {
  cleanTestUsers();
  await stopTestServer();
});

describe("Auth API", () => {
  // ─── Registration ─────────────────────────────────────────────────
  it("should register a new user", async () => {
    const res = await registerUser("test_auth_1", "auth1@test.com", "password123");
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.user.username).toBe("test_auth_1");
    expect(res.body.user.rating).toBe(1200);
  });

  it("should reject registration with missing fields", async () => {
    const res = await makeRequest("POST", "/api/auth/register", { username: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("should reject registration with short password", async () => {
    const res = await makeRequest("POST", "/api/auth/register", {
      username: "test_short_pw",
      email: "short@test.com",
      password: "abc",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("at least 6 characters");
  });

  it("should reject duplicate username", async () => {
    const res = await registerUser("test_auth_1", "auth1_dup@test.com", "password123");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  // ─── Login ────────────────────────────────────────────────────────
  it("should login with valid credentials", async () => {
    const res = await loginUser("test_auth_1", "password123");
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.user.username).toBe("test_auth_1");
    expect(res.headers.get("set-cookie")).toContain("gin_session=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("set-cookie")).toContain("SameSite=Lax");
  });

  it("should reject login with wrong password", async () => {
    const res = await loginUser("test_auth_1", "wrongpass");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("should reject login with nonexistent user", async () => {
    const res = await loginUser("nonexistent_user_xyz", "password123");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("should reject login with missing fields", async () => {
    const res = await makeRequest("POST", "/api/auth/login", {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  // ─── Auth/Me ──────────────────────────────────────────────────────
  it("should return user data for valid session", async () => {
    const loginRes = await loginUser("test_auth_1", "password123");
    const res = await makeRequest("GET", "/api/auth/me", undefined, {
      Authorization: `Bearer ${loginRes.body.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("test_auth_1");
  });

  it("should authenticate browser requests with the HttpOnly session cookie", async () => {
    const loginRes = await loginUser("test_auth_1", "password123");
    const cookie = loginRes.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();

    const res = await makeRequest("GET", "/api/auth/me", undefined, {
      Cookie: cookie!,
      Authorization: "Bearer cookie",
    });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("test_auth_1");
  });

  it("should reject /me with no auth header", async () => {
    const res = await makeRequest("GET", "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("should reject /me with invalid session", async () => {
    const res = await makeRequest("GET", "/api/auth/me", undefined, {
      Authorization: "Bearer invalid-session-id-that-does-not-exist",
    });
    expect(res.status).toBe(401);
  });

  it("should issue a short-lived WebSocket ticket that can only be consumed once", async () => {
    const suffix = Date.now().toString(36);
    const loginRes = await registerUser(
      `test_ws_ticket_${suffix}`,
      `ws_ticket_${suffix}@test.com`,
      "password123",
    );
    const res = await makeRequest("POST", "/api/auth/ws-ticket", undefined, {
      Authorization: `Bearer ${loginRes.body.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.ticket).toEqual(expect.any(String));
    expect(res.body.ticket).not.toContain(loginRes.body.sessionId);
    expect(consumeWebSocketTicket(res.body.ticket)).toBe(loginRes.body.user.id);
    expect(consumeWebSocketTicket(res.body.ticket)).toBeNull();
  });

  // ─── Logout ───────────────────────────────────────────────────────
  it("should logout via authenticated session", async () => {
    const loginRes = await loginUser("test_auth_1", "password123");
    const sid = loginRes.body.sessionId;

    // Logout
    const logoutRes = await makeRequest("POST", "/api/auth/logout", undefined, {
      Authorization: `Bearer ${sid}`,
    });
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);
    expect(logoutRes.headers.get("set-cookie")).toContain("Max-Age=0");

    // Session should now be invalid
    const meRes = await makeRequest("GET", "/api/auth/me", undefined, {
      Authorization: `Bearer ${sid}`,
    });
    expect(meRes.status).toBe(401);
  });
});

describe("Matches API", () => {
  let sessionId: string;

  beforeAll(async () => {
    await registerUser("test_match_user", "match@test.com", "password123");
    const loginRes = await loginUser("test_match_user", "password123");
    sessionId = loginRes.body.sessionId;
  });

  it("should record a match and update stats", async () => {
    const res = await makeRequest(
      "POST",
      "/api/matches",
      { opponent_name: "Bot Alpha", user_score: 45, opponent_score: 30, is_win: true },
      { Authorization: `Bearer ${sessionId}` },
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify stats updated
    const statsRes = await makeRequest("GET", "/api/stats", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.stats.wins).toBe(1);
    expect(statsRes.body.stats.losses).toBe(0);
    expect(statsRes.body.stats.totalMatches).toBe(1);
    expect(statsRes.body.stats.rating).toBe(1215); // 1200 + 15
  });

  it("should reject match with missing fields", async () => {
    const res = await makeRequest(
      "POST",
      "/api/matches",
      { opponent_name: "Bot" },
      { Authorization: `Bearer ${sessionId}` },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("should reject match with invalid score types", async () => {
    const res = await makeRequest(
      "POST",
      "/api/matches",
      { opponent_name: "Bot", user_score: "not_a_number", opponent_score: 10, is_win: true },
      { Authorization: `Bearer ${sessionId}` },
    );
    expect(res.status).toBe(400);
  });

  it("should reject match with no auth", async () => {
    const res = await makeRequest("POST", "/api/matches", {
      opponent_name: "Bot",
      user_score: 45,
      opponent_score: 30,
      is_win: true,
    });
    expect(res.status).toBe(401);
  });

  it("should list recent matches", async () => {
    const res = await makeRequest("GET", "/api/matches", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.matches)).toBe(true);
    expect(res.body.matches.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Leaderboard API", () => {
  it("should return leaderboard data with correct shape", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leaderboard)).toBe(true);
    if (res.body.leaderboard.length > 0) {
      const entry = res.body.leaderboard[0];
      expect(entry).toHaveProperty("rank");
      expect(entry).toHaveProperty("username");
      expect(entry).toHaveProperty("rating");
      expect(entry).toHaveProperty("winRate");
      expect(entry).toHaveProperty("matches");
    }
  });
});

describe("Analysis API", () => {
  let sessionId: string;

  beforeAll(async () => {
    await registerUser("test_analysis_user", "analysis@test.com", "password123");
    const loginRes = await loginUser("test_analysis_user", "password123");
    sessionId = loginRes.body.sessionId;
  });

  it("should return message when no matches exist", async () => {
    const res = await makeRequest("GET", "/api/analysis", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.analysis).toContain("haven't played any matches");
  });

  it("should handle missing API key gracefully", async () => {
    // Record a match so we get past the "no matches" check
    await makeRequest(
      "POST",
      "/api/matches",
      { opponent_name: "AnalysisBot", user_score: 30, opponent_score: 45, is_win: false },
      { Authorization: `Bearer ${sessionId}` },
    );

    // Clear the env key temporarily
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const res = await makeRequest("GET", "/api/analysis", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.analysis).toContain("AI Analysis Unavailable");

    // Restore
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
  });

  it("should reject analysis with no auth", async () => {
    const res = await makeRequest("GET", "/api/analysis");
    expect(res.status).toBe(401);
  });
});
