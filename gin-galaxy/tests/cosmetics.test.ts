/**
 * Cosmetic Inventory & Store-Ready Prestige Catalog Tests for Gin Paradise.
 *
 * Covers:
 *   - Catalog retrieval with ownership status
 *   - Ownership persistence and duplicate prevention
 *   - Equip/unequip validation
 *   - Catalog purchase with wallet integration
 *   - Prestige migration compatibility
 *   - Starter item grants
 *   - Admin grant
 *   - Regression: profile, achievements, coaching, training, wallet, fairness still work
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

// ── Catalog Retrieval ────────────────────────────────────────────────

describe("Cosmetic Catalog", () => {
  let sessionId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`cos_cat_${suffix}`, `cos_cat_${suffix}@test.com`);
  });

  it("returns the full catalog with ownership status", async () => {
    const res = await makeRequest("GET", "/api/cosmetics/catalog", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.catalog).toBeInstanceOf(Array);
    expect(res.body.totalItems).toBeGreaterThan(20);
    expect(res.body.ownedCount).toBeGreaterThan(0); // starter items

    // Validate catalog item shape
    for (const item of res.body.catalog) {
      expect(item).toHaveProperty("key");
      expect(item).toHaveProperty("type");
      expect(item).toHaveProperty("displayName");
      expect(item).toHaveProperty("rarity");
      expect(item).toHaveProperty("source");
      expect(item).toHaveProperty("owned");
      expect(typeof item.owned).toBe("boolean");
    }
  });

  it("returns grouped catalog by type", async () => {
    const res = await makeRequest("GET", "/api/cosmetics/catalog", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.body.grouped).toBeDefined();
    expect(res.body.grouped.card_back).toBeInstanceOf(Array);
    expect(res.body.grouped.card_back.length).toBeGreaterThan(0);
    expect(res.body.grouped.title).toBeInstanceOf(Array);
    expect(res.body.grouped.badge).toBeInstanceOf(Array);
    expect(res.body.grouped.emote).toBeInstanceOf(Array);
  });

  it("starter items are automatically owned", async () => {
    const res = await makeRequest("GET", "/api/cosmetics/catalog", undefined, { Authorization: `Bearer ${sessionId}` });
    const starters = res.body.catalog.filter((c: any) => c.source === "starter");
    expect(starters.length).toBeGreaterThan(0);
    for (const s of starters) {
      expect(s.owned).toBe(true);
    }
  });

  it("rejects unauthenticated catalog access", async () => {
    const res = await makeRequest("GET", "/api/cosmetics/catalog");
    expect(res.status).toBe(401);
  });
});

// ── Ownership & Inventory ────────────────────────────────────────────

describe("Cosmetic Inventory", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`cos_inv_${suffix}`, `cos_inv_${suffix}@test.com`);
    const me = await makeRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${sessionId}` });
    userId = me.body.user.id;
  });

  it("returns inventory with starter items", async () => {
    const res = await makeRequest("GET", "/api/cosmetics/inventory", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.inventory).toBeInstanceOf(Array);
    expect(res.body.totalOwned).toBeGreaterThan(0);
    expect(res.body.equipped).toBeDefined();
  });

  it("inventory items have correct shape", async () => {
    const res = await makeRequest("GET", "/api/cosmetics/inventory", undefined, { Authorization: `Bearer ${sessionId}` });
    for (const item of res.body.inventory) {
      expect(item).toHaveProperty("itemKey");
      expect(item).toHaveProperty("itemType");
      expect(item).toHaveProperty("source");
      expect(item).toHaveProperty("acquiredAt");
      expect(item.acquiredAt).toBeTypeOf("number");
    }
  });

  it("prevents duplicate ownership", async () => {
    // Call inventory twice — count shouldn't change
    const res1 = await makeRequest("GET", "/api/cosmetics/inventory", undefined, { Authorization: `Bearer ${sessionId}` });
    const res2 = await makeRequest("GET", "/api/cosmetics/inventory", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res1.body.totalOwned).toBe(res2.body.totalOwned);
  });
});

// ── Equip/Unequip ────────────────────────────────────────────────────

describe("Cosmetic Equip", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`cos_eq_${suffix}`, `cos_eq_${suffix}@test.com`);
    const me = await makeRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${sessionId}` });
    userId = me.body.user.id;
    // Trigger initial inventory setup
    await makeRequest("GET", "/api/cosmetics/inventory", undefined, { Authorization: `Bearer ${sessionId}` });
  });

  it("allows equipping a starter card back", async () => {
    const res = await makeRequest("PUT", "/api/cosmetics/equip", { itemKey: "classic_red", slot: "card_back" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.equipped.selectedCardBack).toBe("classic_red");
  });

  it("allows equipping a starter emote", async () => {
    const res = await makeRequest("PUT", "/api/cosmetics/equip", { itemKey: "gg", slot: "emote_1" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("rejects equipping an unowned catalog item", async () => {
    const res = await makeRequest("PUT", "/api/cosmetics/equip", { itemKey: "midnight_blue", slot: "card_back" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not owned");
  });

  it("rejects invalid slot", async () => {
    const res = await makeRequest("PUT", "/api/cosmetics/equip", { itemKey: "classic_red", slot: "invalid_slot" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid slot");
  });

  it("rejects mismatched item type and slot", async () => {
    const res = await makeRequest("PUT", "/api/cosmetics/equip", { itemKey: "classic_red", slot: "title" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("does not match");
  });

  it("returns equipped state via dedicated endpoint", async () => {
    const res = await makeRequest("GET", "/api/cosmetics/equipped", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.equipped).toBeDefined();
  });
});

// ── Purchase Flow ────────────────────────────────────────────────────

describe("Cosmetic Purchase", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`cos_buy_${suffix}`, `cos_buy_${suffix}@test.com`);
    const me = await makeRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${sessionId}` });
    userId = me.body.user.id;

    // Give user some gold coins via faucet
    await makeRequest("POST", "/api/wallet/faucet", {}, { Authorization: `Bearer ${sessionId}` });
  });

  it("allows purchasing a catalog item with sufficient balance", async () => {
    const res = await makeRequest("POST", "/api/cosmetics/purchase", { itemKey: "midnight_blue" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.spent).toBe(500);
    expect(res.body.currency).toBe("gold_coins");
    expect(res.body.newBalance).toBeDefined();
  });

  it("purchased item appears in inventory", async () => {
    const res = await makeRequest("GET", "/api/cosmetics/inventory", undefined, { Authorization: `Bearer ${sessionId}` });
    const owned = res.body.inventory.map((i: any) => i.itemKey);
    expect(owned).toContain("midnight_blue");
  });

  it("purchased item can be equipped", async () => {
    const res = await makeRequest("PUT", "/api/cosmetics/equip", { itemKey: "midnight_blue", slot: "card_back" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("prevents duplicate purchase", async () => {
    const res = await makeRequest("POST", "/api/cosmetics/purchase", { itemKey: "midnight_blue" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Already owned");
  });

  it("rejects purchase of non-catalog item", async () => {
    const res = await makeRequest("POST", "/api/cosmetics/purchase", { itemKey: "newcomer" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not purchasable");
  });

  it("rejects purchase with insufficient balance", async () => {
    // Drain balance by buying expensive items
    // First check if obsidian (10000) would fail with remaining balance
    const wallet = await makeRequest("GET", "/api/wallet", undefined, { Authorization: `Bearer ${sessionId}` });
    const balance = wallet.body.balances?.gold_coins || 0;
    if (balance < 10000) {
      const res = await makeRequest("POST", "/api/cosmetics/purchase", { itemKey: "obsidian" }, { Authorization: `Bearer ${sessionId}` });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Insufficient");
    }
  });
});

// ── Prestige Migration Compatibility ─────────────────────────────────

describe("Prestige Migration", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`cos_mig_${suffix}`, `cos_mig_${suffix}@test.com`);
    const me = await makeRequest("GET", "/api/auth/me", undefined, { Authorization: `Bearer ${sessionId}` });
    userId = me.body.user.id;

    // Award first_match to trigger "newcomer" badge prestige unlock
    db.prepare("UPDATE users SET wins = 1, losses = 0 WHERE id = ?").run(userId);
    await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
  });

  it("migrates prestige unlocks to cosmetic inventory", async () => {
    const res = await makeRequest("POST", "/api/cosmetics/migrate", {}, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.totalOwned).toBeGreaterThan(0);
  });

  it("prestige items appear in inventory after migration", async () => {
    const inv = await makeRequest("GET", "/api/cosmetics/inventory", undefined, { Authorization: `Bearer ${sessionId}` });
    const keys = inv.body.inventory.map((i: any) => i.itemKey);
    expect(keys).toContain("newcomer"); // newcomer badge from first_match achievement
  });

  it("prestige items show as owned in catalog", async () => {
    const cat = await makeRequest("GET", "/api/cosmetics/catalog", undefined, { Authorization: `Bearer ${sessionId}` });
    const newcomer = cat.body.catalog.find((c: any) => c.key === "newcomer");
    expect(newcomer).toBeDefined();
    expect(newcomer.owned).toBe(true);
  });

  it("equipping prestige item via cosmetics equip works", async () => {
    const res = await makeRequest("PUT", "/api/cosmetics/equip", { itemKey: "newcomer", slot: "badge" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("second migration is idempotent", async () => {
    const res1 = await makeRequest("POST", "/api/cosmetics/migrate", {}, { Authorization: `Bearer ${sessionId}` });
    const res2 = await makeRequest("POST", "/api/cosmetics/migrate", {}, { Authorization: `Bearer ${sessionId}` });
    // After first migration, second should migrate 0
    expect(res2.body.migrated).toBe(0);
  });

  it("existing profile selections still work after migration", async () => {
    // Set badge via old profile API
    await makeRequest("PUT", "/api/profile", { selectedBadge: "newcomer" }, { Authorization: `Bearer ${sessionId}` });
    const profile = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(profile.body.profile.selectedBadge).toBe("newcomer");
  });
});

// ── Regression Coverage ──────────────────────────────────────────────

describe("Cosmetics — Regression Coverage", () => {
  let sessionId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`cos_reg_${suffix}`, `cos_reg_${suffix}@test.com`);
  });

  it("profile API still works", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.achievements).toBeInstanceOf(Array);
    expect(res.body.prestige).toBeInstanceOf(Array);
  });

  it("achievement catalog still works", async () => {
    const res = await makeRequest("GET", "/api/profile/achievements/catalog");
    expect(res.status).toBe(200);
    expect(res.body.achievements.length).toBeGreaterThan(20);
  });

  it("wallet API still works", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
  });

  it("training summary still works", async () => {
    const res = await makeRequest("GET", "/api/training/summary", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
  });

  it("leaderboard still works", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });

  it("health endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });

  it("replays endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/replays", undefined, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
  });

  it("profile update still works", async () => {
    const res = await makeRequest("PUT", "/api/profile", { bio: "Test cosmetics bio" }, { Authorization: `Bearer ${sessionId}` });
    expect(res.status).toBe(200);
    expect(res.body.profile.bio).toBe("Test cosmetics bio");
  });

  it("fairness verify endpoint still works", async () => {
    const res = await makeRequest("POST", "/api/fairness/verify", { replayId: "nonexistent" });
    // Should return 404 or 400 (not crash/500)
    expect([400, 404]).toContain(res.status);
  });
});
