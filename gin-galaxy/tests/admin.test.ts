/**
 * Admin Dashboard API Tests for Gin Paradise.
 *
 * Covers:
 * - Non-admin rejection for admin API endpoints
 * - Admin revenue summary access
 * - Admin house ledger access
 * - Admin settlement/match data access
 * - Admin player search and inspection
 * - Regression tests for existing auth, wallet, leaderboard behavior
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer, registerUser, makeRequest } from "./helpers.js";
import { db } from "../server/db.js";
import { recordRake } from "../server/houseAccounting.js";
import { creditSignupBonus, mutateBalance } from "../server/ledger.js";
import { resetAllRateLimiters } from "../server/middleware/rateLimit.js";
import crypto from "crypto";

let baseUrl: string;
let adminToken: string;
let regularToken: string;
let adminUserId: string;
let regularUserId: string;
let regularUsername: string;

describe("Admin Dashboard API", () => {
  beforeAll(async () => {
    baseUrl = await startTestServer();
    resetAllRateLimiters();

    // Create a regular user
    const regularSuffix = crypto.randomUUID().slice(0, 6);
    regularUsername = `regular_${regularSuffix}`;
    const regResult = await registerUser(regularUsername, `${regularUsername}@test.com`, "password123");
    expect(regResult.status).toBe(200);
    regularToken = regResult.body.sessionId;
    regularUserId = regResult.body.user.id;

    // Create an admin user
    const adminSuffix = crypto.randomUUID().slice(0, 6);
    const adminResult = await registerUser(`admin_${adminSuffix}`, `admin_${adminSuffix}@test.com`, "adminpass123");
    expect(adminResult.status).toBe(200);
    adminToken = adminResult.body.sessionId;
    adminUserId = adminResult.body.user.id;

    // Promote to admin
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(adminUserId);

    // Seed some house ledger data for testing
    recordRake("gold_coins", 50, "test-room-1", "gold_500", adminUserId, regularUserId, "Test rake 1");
    recordRake("gold_coins", 200, "test-room-2", "gold_2000", adminUserId, regularUserId, "Test rake 2");
    recordRake("gold_coins", 10, "test-room-3", "gold_100", adminUserId, regularUserId, "Test rake 3");
  });

  afterAll(async () => {
    await stopTestServer();
  });

  // ─── Non-Admin Rejection ──────────────────────────────────────────────

  describe("Non-admin rejection", () => {
    it("rejects unauthenticated access to admin revenue", async () => {
      const res = await makeRequest("GET", "/api/admin/revenue");
      expect(res.status).toBe(401);
    });

    it("rejects regular user access to admin revenue", async () => {
      const res = await makeRequest("GET", "/api/admin/revenue", undefined, {
        Authorization: `Bearer ${regularToken}`,
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("admin");
    });

    it("rejects regular user access to admin house-ledger", async () => {
      const res = await makeRequest("GET", "/api/admin/house-ledger", undefined, {
        Authorization: `Bearer ${regularToken}`,
      });
      expect(res.status).toBe(403);
    });

    it("rejects regular user access to admin settlements", async () => {
      const res = await makeRequest("GET", "/api/admin/settlements", undefined, {
        Authorization: `Bearer ${regularToken}`,
      });
      expect(res.status).toBe(403);
    });

    it("rejects regular user access to player search", async () => {
      const res = await makeRequest("GET", "/api/admin/players/search?q=test", undefined, {
        Authorization: `Bearer ${regularToken}`,
      });
      expect(res.status).toBe(403);
    });

    it("rejects regular user access to player detail", async () => {
      const res = await makeRequest("GET", `/api/admin/players/${regularUserId}`, undefined, {
        Authorization: `Bearer ${regularToken}`,
      });
      expect(res.status).toBe(403);
    });
  });

  // ─── Admin Revenue ────────────────────────────────────────────────────

  describe("Admin revenue summary", () => {
    it("returns revenue summary with currency breakdown", async () => {
      const res = await makeRequest("GET", "/api/admin/revenue", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.totalRakeCollected).toBeGreaterThan(0);
      expect(res.body.summary.totalRakeTransactions).toBeGreaterThanOrEqual(3);
      expect(Array.isArray(res.body.summary.byCurrency)).toBe(true);
    });

    it("returns gold coins revenue (single coin economy)", async () => {
      const res = await makeRequest("GET", "/api/admin/revenue", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      const gold = res.body.summary.byCurrency.find((r: any) => r.currency === "gold_coins");
      expect(gold).toBeDefined();
      expect(gold.total_revenue).toBeGreaterThanOrEqual(260); // 50 + 200 + 10
    });

    it("includes recent entries in revenue response", async () => {
      const res = await makeRequest("GET", "/api/admin/revenue", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(Array.isArray(res.body.recentEntries)).toBe(true);
      expect(res.body.recentEntries.length).toBeGreaterThan(0);
    });
  });

  // ─── Admin House Ledger ───────────────────────────────────────────────

  describe("Admin house ledger", () => {
    it("returns house ledger entries", async () => {
      const res = await makeRequest("GET", "/api/admin/house-ledger", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.entries)).toBe(true);
      expect(res.body.entries.length).toBeGreaterThanOrEqual(3);
      expect(res.body.count).toBeGreaterThanOrEqual(3);
    });

    it("respects limit parameter", async () => {
      const res = await makeRequest("GET", "/api/admin/house-ledger?limit=2", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.entries.length).toBeLessThanOrEqual(2);
    });

    it("house ledger entries have expected fields", async () => {
      const res = await makeRequest("GET", "/api/admin/house-ledger?limit=1", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(200);
      const entry = res.body.entries[0];
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("currency");
      expect(entry).toHaveProperty("amount");
      expect(entry).toHaveProperty("type");
      expect(entry).toHaveProperty("created_at");
    });
  });

  // ─── Admin Settlements ────────────────────────────────────────────────

  describe("Admin settlements", () => {
    it("returns settlements list (may be empty without replays)", async () => {
      const res = await makeRequest("GET", "/api/admin/settlements", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.settlements)).toBe(true);
      expect(typeof res.body.count).toBe("number");
    });

    it("respects limit parameter on settlements", async () => {
      const res = await makeRequest("GET", "/api/admin/settlements?limit=5", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.settlements.length).toBeLessThanOrEqual(5);
    });
  });

  // ─── Admin Player Search ──────────────────────────────────────────────

  describe("Admin player search", () => {
    it("searches players by username", async () => {
      const res = await makeRequest("GET", "/api/admin/players/search?q=admin", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.players)).toBe(true);
      expect(res.body.players.length).toBeGreaterThanOrEqual(1);
      expect(res.body.players[0].username).toContain("admin");
    });

    it("returns player balances in search results", async () => {
      const res = await makeRequest("GET", `/api/admin/players/search?q=${regularUsername}`, undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(200);
      const player = res.body.players.find((p: any) => p.id === regularUserId);
      expect(player).toBeDefined();
      expect(player.balances).toBeDefined();
      expect(typeof player.balances.gold_coins).toBe("number");
      expect(typeof player.balances.sweeps_coins).toBe("number");
    });

    it("rejects empty search query", async () => {
      const res = await makeRequest("GET", "/api/admin/players/search?q=", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Admin Player Detail ──────────────────────────────────────────────

  describe("Admin player detail", () => {
    it("returns player detail with balances and transactions", async () => {
      const res = await makeRequest("GET", `/api/admin/players/${regularUserId}`, undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.player).toBeDefined();
      expect(res.body.player.username).toContain("regular");
      expect(res.body.balances).toBeDefined();
      expect(Array.isArray(res.body.transactions)).toBe(true);
      expect(Array.isArray(res.body.recentMatches)).toBe(true);
    });

    it("returns 404 for nonexistent player", async () => {
      const res = await makeRequest("GET", "/api/admin/players/nonexistent-id", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Admin identity in auth responses ─────────────────────────────────

  describe("Admin identity in auth", () => {
    it("/me returns is_admin for admin users", async () => {
      const res = await makeRequest("GET", "/api/auth/me", undefined, {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.user.is_admin).toBe(true);
    });

    it("/me returns is_admin false for regular users", async () => {
      const res = await makeRequest("GET", "/api/auth/me", undefined, {
        Authorization: `Bearer ${regularToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.user.is_admin).toBe(false);
    });
  });

  // ─── Regression ───────────────────────────────────────────────────────

  describe("Regression", () => {
    it("registration still works", async () => {
      const suffix = crypto.randomUUID().slice(0, 6);
      const res = await registerUser(`regtest_${suffix}`, `regtest_${suffix}@test.com`, "password123");
      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBeDefined();
    });

    it("wallet API still works", async () => {
      const res = await makeRequest("GET", "/api/wallet", undefined, {
        Authorization: `Bearer ${regularToken}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.balances).toBeDefined();
    });

    it("leaderboard still works", async () => {
      const res = await makeRequest("GET", "/api/leaderboard");
      expect(res.status).toBe(200);
    });

    it("faucet still works for regular users", async () => {
      // Just verify the endpoint is reachable (may 429 if recently claimed)
      const res = await makeRequest("POST", "/api/wallet/faucet", undefined, {
        Authorization: `Bearer ${regularToken}`,
      });
      expect([200, 429]).toContain(res.status);
    });
  });
});
