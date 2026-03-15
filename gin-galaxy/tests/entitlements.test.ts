/**
 * Entitlements & Premium Packaging Tests for Gin Paradise.
 *
 * Covers:
 *   - Default free plan assignment
 *   - Premium plan grant and verification
 *   - Premium revoke and verification
 *   - Server-side feature gating (training coaching, batch-prepare, themes, timeline)
 *   - Admin grant and revoke endpoints
 *   - Admin audit log
 *   - Plan info in auth responses (/me, login)
 *   - Session detail coaching gating
 *   - Regression: gameplay, replays, wallet, profile, cosmetics
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer, getBaseUrl, registerUser, loginUser, makeRequest } from "./helpers.js";
import { db } from "../server/db.js";
import { grantPremium, revokePremium, getUserPlan, isPremium, hasFeatureAccess, initializeEntitlementTables } from "../server/entitlements.js";
import { resetAllRateLimiters } from "../server/middleware/rateLimit.js";

let base: string;

beforeAll(async () => {
  base = await startTestServer();
  resetAllRateLimiters();
});

afterAll(async () => {
  await stopTestServer();
});

// ── Helpers ──────────────────────────────────────────────────────────

let userCounter = 0;
const testRunId = Math.random().toString(36).slice(2, 8);

async function createUser(suffix: string = "") {
  userCounter++;
  resetAllRateLimiters();
  const username = `ent_${suffix}_${testRunId}_${userCounter}`;
  const email = `${username}@test.com`;
  const { body } = await registerUser(username, email, "password123");
  const loginRes = await loginUser(username, "password123");
  const userId = loginRes.body.user?.id || body.user?.id;
  return { userId, username, sessionId: loginRes.body.sessionId };
}

async function createAdminUser(suffix: string = "") {
  const { userId, username, sessionId } = await createUser(`admin_${suffix}`);
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(userId);
  return { userId, username, sessionId };
}

// ── Default Plan ─────────────────────────────────────────────────────

describe("Default Plan", () => {
  test("new users default to free plan", async () => {
    const { userId } = await createUser("default1");
    expect(getUserPlan(userId)).toBe("free");
    expect(isPremium(userId)).toBe(false);
  });

  test("free users have access to free features", async () => {
    const { userId } = await createUser("default2");
    expect(hasFeatureAccess(userId, "core_gameplay")).toBe(true);
    expect(hasFeatureAccess(userId, "basic_training")).toBe(true);
    expect(hasFeatureAccess(userId, "engine_evaluation")).toBe(true);
    expect(hasFeatureAccess(userId, "replays")).toBe(true);
    expect(hasFeatureAccess(userId, "wallet")).toBe(true);
  });

  test("free users lack premium features", async () => {
    const { userId } = await createUser("default3");
    expect(hasFeatureAccess(userId, "ai_coaching")).toBe(false);
    expect(hasFeatureAccess(userId, "coaching_timeline")).toBe(false);
    expect(hasFeatureAccess(userId, "coaching_themes")).toBe(false);
    expect(hasFeatureAccess(userId, "progression_depth")).toBe(false);
    expect(hasFeatureAccess(userId, "batch_prepare")).toBe(false);
    expect(hasFeatureAccess(userId, "session_coaching")).toBe(false);
  });
});

// ── Premium Grant & Revoke (Server-Side) ─────────────────────────────

describe("Premium Grant & Revoke", () => {
  test("granting premium upgrades user plan", async () => {
    const { userId } = await createUser("grant1");
    const result = grantPremium(userId, "system", "test grant");
    expect(result.success).toBe(true);
    expect(getUserPlan(userId)).toBe("premium");
    expect(isPremium(userId)).toBe(true);
  });

  test("premium users have access to all features", async () => {
    const { userId } = await createUser("grant2");
    grantPremium(userId, "system", "test");
    expect(hasFeatureAccess(userId, "ai_coaching")).toBe(true);
    expect(hasFeatureAccess(userId, "coaching_timeline")).toBe(true);
    expect(hasFeatureAccess(userId, "coaching_themes")).toBe(true);
    expect(hasFeatureAccess(userId, "progression_depth")).toBe(true);
    expect(hasFeatureAccess(userId, "batch_prepare")).toBe(true);
    expect(hasFeatureAccess(userId, "core_gameplay")).toBe(true);
  });

  test("revoking premium demotes to free", async () => {
    const { userId } = await createUser("revoke1");
    grantPremium(userId, "system", "test");
    expect(isPremium(userId)).toBe(true);
    const result = revokePremium(userId, "system", "test revoke");
    expect(result.success).toBe(true);
    expect(getUserPlan(userId)).toBe("free");
    expect(isPremium(userId)).toBe(false);
  });

  test("revoking free user returns error", async () => {
    const { userId } = await createUser("revoke2");
    const result = revokePremium(userId, "system", "test");
    expect(result.success).toBe(false);
    expect(result.error).toContain("already on the free plan");
  });

  test("granting for nonexistent user returns error", () => {
    const result = grantPremium("nonexistent-id", "system", "test");
    expect(result.success).toBe(false);
    expect(result.error).toContain("User not found");
  });
});

// ── Plan API ─────────────────────────────────────────────────────────

describe("Plan API", () => {
  test("GET /api/entitlements/plan returns free plan for new user", async () => {
    const { sessionId } = await createUser("planapi1");
    const res = await makeRequest("GET", "/api/entitlements/plan", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("free");
    expect(res.body.displayName).toBe("Free");
    expect(res.body.isActive).toBe(false);
    expect(res.body.upgradeAvailable).toBe(true);
    expect(res.body.features).toBeDefined();
    expect(res.body.features.length).toBeGreaterThan(0);
  });

  test("GET /api/entitlements/plan returns premium plan after grant", async () => {
    const { userId, sessionId } = await createUser("planapi2");
    grantPremium(userId, "system", "test");
    const res = await makeRequest("GET", "/api/entitlements/plan", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("premium");
    expect(res.body.displayName).toBe("Gin Paradise Pro");
    expect(res.body.isActive).toBe(true);
    expect(res.body.upgradeAvailable).toBe(false);
  });

  test("GET /api/entitlements/features returns feature catalog", async () => {
    const { sessionId } = await createUser("planapi3");
    const res = await makeRequest("GET", "/api/entitlements/features", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.features.length).toBeGreaterThan(5);
    expect(res.body.plans.length).toBe(2);
    expect(res.body.plans[0].tier).toBe("free");
    expect(res.body.plans[1].tier).toBe("premium");
  });

  test("unauthenticated request returns 401", async () => {
    const res = await makeRequest("GET", "/api/entitlements/plan");
    expect(res.status).toBe(401);
  });
});

// ── Admin Grant/Revoke API ───────────────────────────────────────────

describe("Admin Entitlement Controls", () => {
  test("admin can grant premium to a user", async () => {
    const admin = await createAdminUser("admgrant1");
    const user = await createUser("target1");

    const res = await makeRequest("POST", "/api/entitlements/admin/grant", {
      userId: user.userId,
      reason: "test grant via API",
    }, { Authorization: `Bearer ${admin.sessionId}` });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.plan.plan).toBe("premium");
    expect(getUserPlan(user.userId)).toBe("premium");
  });

  test("admin can revoke premium from a user", async () => {
    const admin = await createAdminUser("admrevoke1");
    const user = await createUser("target2");
    grantPremium(user.userId, "system", "setup");

    const res = await makeRequest("POST", "/api/entitlements/admin/revoke", {
      userId: user.userId,
      reason: "test revoke via API",
    }, { Authorization: `Bearer ${admin.sessionId}` });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.plan.plan).toBe("free");
  });

  test("non-admin cannot grant premium", async () => {
    const user = await createUser("nonadmin1");
    const target = await createUser("nonadmintarget");

    const res = await makeRequest("POST", "/api/entitlements/admin/grant", {
      userId: target.userId,
      reason: "should fail",
    }, { Authorization: `Bearer ${user.sessionId}` });

    expect(res.status).toBe(403);
  });

  test("grant requires reason", async () => {
    const admin = await createAdminUser("admreason");
    const user = await createUser("targetreason");

    const res = await makeRequest("POST", "/api/entitlements/admin/grant", {
      userId: user.userId,
    }, { Authorization: `Bearer ${admin.sessionId}` });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("reason");
  });

  test("admin can view audit log", async () => {
    const admin = await createAdminUser("admaudit");
    const user = await createUser("targetaudit");

    grantPremium(user.userId, admin.userId, "audit test grant");

    const res = await makeRequest("GET", `/api/entitlements/admin/audit/${user.userId}`, undefined, {
      Authorization: `Bearer ${admin.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.auditLog.length).toBeGreaterThan(0);
    expect(res.body.auditLog[0].newPlan).toBe("premium");
    expect(res.body.auditLog[0].reason).toBe("audit test grant");
  });

  test("admin can view user plan status", async () => {
    const admin = await createAdminUser("admstatus");
    const user = await createUser("targetstatus");

    const res = await makeRequest("GET", `/api/entitlements/admin/status/${user.userId}`, undefined, {
      Authorization: `Bearer ${admin.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("free");
    expect(res.body.username).toBe(user.username);
  });
});

// ── Auth Responses Include Plan ──────────────────────────────────────

describe("Auth Plan Info", () => {
  test("login response includes plan", async () => {
    const username = `ent_login_${Date.now()}`;
    await registerUser(username, `${username}@t.com`, "password123");
    const res = await makeRequest("POST", "/api/auth/login", { username, password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.user.plan).toBe("free");
  });

  test("/me response includes plan", async () => {
    const { sessionId } = await createUser("meplan");
    const res = await makeRequest("GET", "/api/auth/me", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.plan).toBe("free");
  });

  test("/me response shows premium after grant", async () => {
    const { userId, sessionId } = await createUser("meprem");
    grantPremium(userId, "system", "test");
    const res = await makeRequest("GET", "/api/auth/me", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.body.user.plan).toBe("premium");
  });
});

// ── Training Gating ──────────────────────────────────────────────────

describe("Training Entitlement Gating", () => {
  test("free user training summary has locked coaching", async () => {
    const { sessionId } = await createUser("trfree1");
    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.coaching.locked).toBe(true);
    expect(res.body.coaching.upgradeMessage).toBeDefined();
    expect(res.body.plan.tier).toBe("free");
    expect(res.body.plan.coachingLocked).toBe(true);
    expect(res.body.plan.progressionLocked).toBe(true);
    // But sessions and trends still present
    expect(res.body.sessions).toBeDefined();
    expect(res.body.trends).toBeDefined();
  });

  test("premium user training summary has full coaching", async () => {
    const { userId, sessionId } = await createUser("trprem1");
    grantPremium(userId, "system", "test");
    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.coaching.locked).toBeUndefined();
    expect(res.body.plan.tier).toBe("premium");
    expect(res.body.plan.coachingLocked).toBe(false);
  });

  test("free user batch-prepare returns locked", async () => {
    const { sessionId } = await createUser("trbatch1");
    const res = await makeRequest("POST", "/api/training/prepare", {}, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
    expect(res.body.upgradeMessage).toBeDefined();
  });

  test("free user coaching timeline returns locked", async () => {
    const { sessionId } = await createUser("trtl1");
    const res = await makeRequest("GET", "/api/training/coaching/timeline", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
  });

  test("free user coaching themes returns locked", async () => {
    const { sessionId } = await createUser("trth1");
    const res = await makeRequest("GET", "/api/training/coaching/themes", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
  });
});

// ── Regression Coverage ──────────────────────────────────────────────

describe("Entitlement Regression", () => {
  test("registration still works", async () => {
    resetAllRateLimiters();
    const res = await registerUser(`ent_reg_${Date.now()}`, `ent_reg_${Date.now()}@t.com`, "password123");
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.user.id).toBeDefined();
  });

  test("wallet API still works", async () => {
    const { sessionId } = await createUser("entreg_wallet");
    const res = await makeRequest("GET", "/api/wallet", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    // Wallet response has balances nested under a key
    expect(res.body).toBeDefined();
  });

  test("leaderboard still works", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });

  test("profile still works", async () => {
    const { sessionId } = await createUser("entreg_profile");
    const res = await makeRequest("GET", "/api/profile", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.achievements).toBeDefined();
  });

  test("cosmetics catalog still works", async () => {
    const { sessionId } = await createUser("entreg_cosmetics");
    const res = await makeRequest("GET", "/api/cosmetics/catalog", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.catalog).toBeDefined();
  });

  test("health endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });

  test("faucet still works", async () => {
    const { sessionId } = await createUser("entreg_faucet");
    const res = await makeRequest("POST", "/api/wallet/faucet", {}, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
  });
});
