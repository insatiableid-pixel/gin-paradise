import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer, registerUser, loginUser, makeRequest } from "./helpers.js";
import { db } from "../server/db.js";

beforeAll(async () => {
  await startTestServer();
  // Clean up test users from any previous runs
  db.prepare("DELETE FROM player_spectate_preferences WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_%')").run();
  db.prepare("DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_%')").run();
  db.prepare("DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_%')").run();
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_%')").run();
  db.prepare("DELETE FROM matches WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'test_%'").run();
});

afterAll(async () => {
  // Clean up test users
  db.prepare("DELETE FROM player_spectate_preferences WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_%')").run();
  db.prepare("DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_%')").run();
  db.prepare("DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_%')").run();
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_%')").run();
  db.prepare("DELETE FROM matches WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'test_%'").run();
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
      { Authorization: `Bearer ${sessionId}` }
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
      { Authorization: `Bearer ${sessionId}` }
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("should reject match with invalid score types", async () => {
    const res = await makeRequest(
      "POST",
      "/api/matches",
      { opponent_name: "Bot", user_score: "not_a_number", opponent_score: 10, is_win: true },
      { Authorization: `Bearer ${sessionId}` }
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
      { Authorization: `Bearer ${sessionId}` }
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
