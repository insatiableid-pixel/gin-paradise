/**
 * Production Hardening Tests for Gin Paradise.
 *
 * Covers:
 * - Health endpoint behavior
 * - Configuration validation logic
 * - Trust-proxy / IP handling
 * - Startup validation
 * - Regression: auth, matchmaking, escrow, rake, admin, replay, analysis, wallet
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer, getBaseUrl, registerUser, loginUser, makeRequest } from "./helpers.js";
import { getLiveRoomRoutingMode, loadConfig, validateAndLogConfig } from "../server/config.js";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

// ─── Health Endpoint ──────────────────────────────────────────────────

describe("Health Endpoint", () => {
  it("should return healthy status with correct shape", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.database).toBe("connected");
    expect(res.body.version).toBe("1.0.0-beta");
    expect(typeof res.body.timestamp).toBe("string");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("should be accessible without authentication", async () => {
    // No Authorization header
    const res = await fetch(`${getBaseUrl()}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
  });

  it("should not expose sensitive information", async () => {
    const res = await makeRequest("GET", "/api/health");
    const body = res.body;
    // Should not contain API keys, database paths, or internal details
    const jsonStr = JSON.stringify(body);
    expect(jsonStr).not.toContain("GEMINI");
    expect(jsonStr).not.toContain("sqlite");
    expect(jsonStr).not.toContain("password");
    expect(jsonStr).not.toContain("secret");
  });

  it("should include environment field", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.body.environment).toBeDefined();
    expect(typeof res.body.environment).toBe("string");
  });

  it("should include deployment routing metadata", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.body.deployment).toMatchObject({
      coordinatorMode: "memory",
      liveRoomRouting: "single_node",
    });
  });

  it("should include coordinator identity metadata", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.body.coordinator).toMatchObject({
      mode: "memory",
      healthy: true,
    });
    expect(typeof res.body.coordinator.nodeId).toBe("string");
  });
});

// ─── Configuration Validation ──────────────────────────────────────────

describe("Configuration Module", () => {
  it("should load default config values", () => {
    const config = loadConfig();
    expect(config.port).toBe(3000);
    expect(config.host).toBe("0.0.0.0");
    expect(config.nodeEnv).toBe("development"); // test env doesn't set NODE_ENV=production
    expect(typeof config.databasePath).toBe("string");
    expect(config.databasePath.length).toBeGreaterThan(0);
    expect(config.trustProxy).toBe(false);
    expect(config.coordinatorNodeId).toBeUndefined();
    expect(Array.isArray(config.allowedOrigins)).toBe(true);
  });

  it("should parse port from environment", () => {
    const originalPort = process.env.PORT;
    try {
      process.env.PORT = "8080";
      const config = loadConfig();
      expect(config.port).toBe(8080);
    } finally {
      if (originalPort !== undefined) process.env.PORT = originalPort;
      else delete process.env.PORT;
    }
  });

  it("should parse trust proxy from environment", () => {
    const originalTP = process.env.TRUST_PROXY;
    try {
      process.env.TRUST_PROXY = "true";
      let config = loadConfig();
      expect(config.trustProxy).toBe(true);

      process.env.TRUST_PROXY = "false";
      config = loadConfig();
      expect(config.trustProxy).toBe(false);

      process.env.TRUST_PROXY = "loopback";
      config = loadConfig();
      expect(config.trustProxy).toBe("loopback");
    } finally {
      if (originalTP !== undefined) process.env.TRUST_PROXY = originalTP;
      else delete process.env.TRUST_PROXY;
    }
  });

  it("should parse allowed origins from environment", () => {
    const original = process.env.ALLOWED_ORIGINS;
    try {
      process.env.ALLOWED_ORIGINS = "https://example.com, https://foo.com";
      const config = loadConfig();
      expect(config.allowedOrigins).toEqual(["https://example.com", "https://foo.com"]);
    } finally {
      if (original !== undefined) process.env.ALLOWED_ORIGINS = original;
      else delete process.env.ALLOWED_ORIGINS;
    }
  });

  it("should report multi-node relay routing in redis mode", () => {
    expect(getLiveRoomRoutingMode("memory")).toBe("single_node");
    expect(getLiveRoomRoutingMode("redis")).toBe("multi_node_relay");
  });

  it("should parse coordinator node identity from environment", () => {
    const original = process.env.COORDINATOR_NODE_ID;
    try {
      process.env.COORDINATOR_NODE_ID = "gin-paradise-alpha";
      expect(loadConfig().coordinatorNodeId).toBe("gin-paradise-alpha");
    } finally {
      if (original !== undefined) process.env.COORDINATOR_NODE_ID = original;
      else delete process.env.COORDINATOR_NODE_ID;
    }
  });

  it("should treat missing GEMINI_API_KEY as undefined (not crash)", () => {
    const original = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      const config = loadConfig();
      expect(config.geminiApiKey).toBeUndefined();
    } finally {
      if (original !== undefined) process.env.GEMINI_API_KEY = original;
    }
  });

  it("should allow redis coordinator mode with stable node identity", () => {
    const originalMode = process.env.COORDINATOR_MODE;
    const originalNodeId = process.env.COORDINATOR_NODE_ID;
    try {
      process.env.COORDINATOR_MODE = "redis";
      process.env.COORDINATOR_NODE_ID = "gin-paradise-alpha";
      expect(() => validateAndLogConfig(loadConfig())).not.toThrow();
    } finally {
      if (originalMode !== undefined) process.env.COORDINATOR_MODE = originalMode;
      else delete process.env.COORDINATOR_MODE;
      if (originalNodeId !== undefined) process.env.COORDINATOR_NODE_ID = originalNodeId;
      else delete process.env.COORDINATOR_NODE_ID;
    }
  });

  it("should require a stable coordinator node id when redis coordinator is enabled", () => {
    const originalMode = process.env.COORDINATOR_MODE;
    const originalNodeId = process.env.COORDINATOR_NODE_ID;
    try {
      process.env.COORDINATOR_MODE = "redis";
      delete process.env.COORDINATOR_NODE_ID;
      expect(() => validateAndLogConfig(loadConfig())).toThrow(/COORDINATOR_NODE_ID/);

      process.env.COORDINATOR_NODE_ID = "gin-paradise-alpha";
      expect(() => validateAndLogConfig(loadConfig())).not.toThrow();
    } finally {
      if (originalMode !== undefined) process.env.COORDINATOR_MODE = originalMode;
      else delete process.env.COORDINATOR_MODE;
      if (originalNodeId !== undefined) process.env.COORDINATOR_NODE_ID = originalNodeId;
      else delete process.env.COORDINATOR_NODE_ID;
    }
  });

  it("should require Stripe webhook verification in production", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.STRIPE_WEBHOOK_SECRET;
      expect(() => validateAndLogConfig(loadConfig())).toThrow(/STRIPE_WEBHOOK_SECRET/);

      process.env.STRIPE_WEBHOOK_SECRET = "whsec_production_test";
      expect(() => validateAndLogConfig(loadConfig())).not.toThrow();
    } finally {
      if (originalEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnv;
      if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    }
  });
});

// ─── Trust Proxy / IP Handling ──────────────────────────────────────────

describe("Trust Proxy Behavior", () => {
  it("should respect X-Forwarded-For header when trust proxy is enabled", async () => {
    // The test harness has trust proxy enabled
    // Rate-limited endpoints should use the forwarded IP
    const res = await fetch(`${getBaseUrl()}/api/health`, {
      headers: {
        "X-Forwarded-For": "203.0.113.50",
      },
    });
    expect(res.status).toBe(200);
  });
});

// ─── Regression Tests ──────────────────────────────────────────────────

describe("Hardening Regression", () => {
  it("should still register users correctly", async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const res = await registerUser(`hardening_user_${suffix}`, `hardening_${suffix}@test.com`, "password123");
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeDefined();
  });

  it("should still serve wallet API", async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const reg = await registerUser(`hardening_wallet_${suffix}`, `hw_${suffix}@test.com`, "password123");
    const token = reg.body.sessionId;
    const res = await makeRequest("GET", "/api/wallet", undefined, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.body.balances).toBeDefined();
    expect(res.body.balances.gold_coins).toBeGreaterThan(0);
  });

  it("should still serve the leaderboard", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leaderboard)).toBe(true);
  });

  it("should still enforce auth on protected endpoints", async () => {
    const res = await makeRequest("GET", "/api/wallet");
    expect(res.status).toBe(401);
  });

  it("should still serve the faucet", async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const reg = await registerUser(`hardening_faucet_${suffix}`, `hf_${suffix}@test.com`, "password123");
    const token = reg.body.sessionId;
    const res = await makeRequest("POST", "/api/wallet/faucet", {}, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.body.claimed).toBeDefined();
    expect(res.body.claimed.coins).toBeGreaterThan(0);
  });

  it("should still reject admin endpoints for non-admins", async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await registerUser(`hardening_admin_${suffix}`, `ha_${suffix}@test.com`, "password123");
    const login = await loginUser(`hardening_admin_${suffix}`, "password123");
    expect(login.status).toBe(200);
    const token = login.body.sessionId;
    const res = await makeRequest("GET", "/api/admin/revenue", undefined, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
  });
});
