/**
 * Unified Activation Funnel Tests for Gin Paradise.
 *
 * Regression tests covering:
 * - Ledger collision fix: daily rewards use proper TransactionTypes (not 'faucet')
 * - Faucet cooldown isolation: daily rewards don't interfere with wallet faucet
 * - Transaction type differentiation in history
 * - Daily Hub as canonical claim surface
 * - Low-balance economy thresholds
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestServer,
  stopTestServer,
  registerUser,
  makeRequest,
} from "./helpers.js";
import { db } from "../server/db.js";
import {
  getBalances,
  mutateBalance,
  getTransactions,
  claimFaucet,
} from "../server/ledger.js";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

// ─── Ledger Collision Fix ─────────────────────────────────────────────────

describe("Ledger Collision Fix — Transaction Type Differentiation", () => {
  let session: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = `lcf_${Date.now()}`;
    const reg = await registerUser(`lcfuser_${suffix}`, `lcf_${suffix}@test.com`, "password123");
    session = reg.body.sessionId;
    userId = reg.body.user?.id;

    // Initialize daily data (triggers mission assignment)
    await makeRequest("GET", "/api/daily", undefined, { Authorization: `Bearer ${session}` });
  });

  function auth() {
    return { Authorization: `Bearer ${session}` };
  }

  it("streak check-in creates 'streak_reward' transaction (not 'faucet')", async () => {
    // Do a streak check-in via API
    const checkin = await makeRequest("POST", "/api/daily/checkin", undefined, auth());
    expect(checkin.status).toBe(200);
    expect(checkin.body.success).toBe(true);

    // Check that the transaction was recorded with the correct type
    const txns = getTransactions(userId, 20);
    const streakTxn = txns.find(t => t.type === "streak_reward");
    expect(streakTxn).toBeDefined();
    expect(streakTxn!.amount).toBeGreaterThan(0);
    expect(streakTxn!.reference).toContain("streak:");
  });

  it("streak reward does NOT create a 'faucet' transaction", async () => {
    const txns = getTransactions(userId, 20);
    const faucetTxns = txns.filter(t => t.type === "faucet");
    expect(faucetTxns.length).toBe(0);
  });

  it("mission claim creates 'mission_reward' transaction", async () => {
    // The check-in we did above should have auto-completed the daily_checkin mission
    const daily = await makeRequest("GET", "/api/daily", undefined, auth());
    const checkinMission = daily.body.missions.find((m: any) => m.missionId === "daily_checkin");
    expect(checkinMission).toBeDefined();
    expect(checkinMission.completed).toBe(true);

    // Claim it
    const claim = await makeRequest("POST", "/api/daily/missions/daily_checkin/claim", undefined, auth());
    expect(claim.status).toBe(200);
    expect(claim.body.success).toBe(true);

    // Verify transaction type
    const txns = getTransactions(userId, 30);
    const missionTxn = txns.find(t => t.type === "mission_reward");
    expect(missionTxn).toBeDefined();
    expect(missionTxn!.reference).toContain("mission:");
  });

  it("puzzle claim creates 'puzzle_reward' transaction", async () => {
    // Get puzzle, submit answer, then claim
    await makeRequest("GET", "/api/daily/puzzle", undefined, auth());
    await makeRequest("POST", "/api/daily/puzzle/submit", { choice: "draw_stock" }, auth());
    const claim = await makeRequest("POST", "/api/daily/puzzle/claim", undefined, auth());
    expect(claim.status).toBe(200);
    expect(claim.body.success).toBe(true);

    // Verify transaction type
    const txns = getTransactions(userId, 40);
    const puzzleTxn = txns.find(t => t.type === "puzzle_reward");
    expect(puzzleTxn).toBeDefined();
    expect(puzzleTxn!.reference).toContain("puzzle:");
  });

  it("no daily retention operations produced 'faucet' type transactions", async () => {
    const txns = getTransactions(userId, 50);
    const faucetTxns = txns.filter(t => t.type === "faucet");
    expect(faucetTxns.length).toBe(0);
  });
});

// ─── Faucet Cooldown Isolation ──────────────────────────────────────────

describe("Faucet Cooldown Isolation", () => {
  let session: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = `fci_${Date.now()}`;
    const reg = await registerUser(`fciuser_${suffix}`, `fci_${suffix}@test.com`, "password123");
    session = reg.body.sessionId;
    userId = reg.body.user?.id;
  });

  function auth() {
    return { Authorization: `Bearer ${session}` };
  }

  it("claiming daily rewards does not block the wallet faucet", async () => {
    // First, claim daily streak
    const checkin = await makeRequest("POST", "/api/daily/checkin", undefined, auth());
    expect(checkin.body.success).toBe(true);

    // Now claim the wallet faucet — this should still succeed
    const faucet = await makeRequest("POST", "/api/wallet/faucet", undefined, auth());
    expect(faucet.status).toBe(200);
    expect(faucet.body.success).toBe(true);
  });

  it("faucet cooldown only checks 'faucet' type transactions", async () => {
    // After claiming faucet, try again — should be blocked by faucet cooldown
    const faucet2 = await makeRequest("POST", "/api/wallet/faucet", undefined, auth());
    expect(faucet2.status).toBe(429);
    expect(faucet2.body.error).toContain("already claimed");

    // But claiming a mission should still work (different type)
    const daily = await makeRequest("GET", "/api/daily", undefined, auth());
    const checkinMission = daily.body.missions.find((m: any) => m.missionId === "daily_checkin");
    if (checkinMission && checkinMission.completed && !checkinMission.claimed) {
      const claim = await makeRequest("POST", "/api/daily/missions/daily_checkin/claim", undefined, auth());
      expect(claim.status).toBe(200);
    }
  });

  it("wallet transaction history shows differentiated types", async () => {
    const history = await makeRequest("GET", "/api/wallet/history?limit=50", undefined, auth());
    expect(history.status).toBe(200);
    const types = new Set(history.body.transactions.map((t: any) => t.type));

    // Should have faucet (from wallet claim) and streak_reward (from daily check-in) as separate types
    expect(types.has("faucet")).toBe(true);
    expect(types.has("streak_reward")).toBe(true);
    // Should NOT have more than one faucet (the daily streak should not be tagged as faucet)
    const faucetCount = history.body.transactions.filter((t: any) => t.type === "faucet").length;
    expect(faucetCount).toBe(1);
  });
});

// ─── Transaction Type Taxonomy ──────────────────────────────────────────

describe("Transaction Type Taxonomy", () => {
  it("daily_grant, streak_reward, mission_reward, puzzle_reward are valid types in mutateBalance", () => {
    const testUserId = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)")
      .run(testUserId, `taxonomy_${Date.now()}`, `taxonomy_${Date.now()}@test.com`, "hashed");

    // All new types should work without errors
    expect(() => mutateBalance(testUserId, "gold_coins", 10, "streak_reward", null, "test")).not.toThrow();
    expect(() => mutateBalance(testUserId, "gold_coins", 10, "mission_reward", null, "test")).not.toThrow();
    expect(() => mutateBalance(testUserId, "gold_coins", 10, "puzzle_reward", null, "test")).not.toThrow();
    expect(() => mutateBalance(testUserId, "gold_coins", 10, "daily_grant", null, "test")).not.toThrow();

    // Verify all recorded
    const txns = getTransactions(testUserId, 20);
    const types = new Set(txns.map(t => t.type));
    expect(types.has("streak_reward")).toBe(true);
    expect(types.has("mission_reward")).toBe(true);
    expect(types.has("puzzle_reward")).toBe(true);
    expect(types.has("daily_grant")).toBe(true);
  });
});

// ─── Unified Funnel Regression ──────────────────────────────────────────

describe("Unified Funnel — Regression", () => {
  let session: string;

  beforeAll(async () => {
    const suffix = `ufr_${Date.now()}`;
    const reg = await registerUser(`ufruser_${suffix}`, `ufr_${suffix}@test.com`, "password123");
    session = reg.body.sessionId;
  });

  function auth() {
    return { Authorization: `Bearer ${session}` };
  }

  it("daily summary still returns complete data shape", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, auth());
    expect(res.status).toBe(200);
    expect(res.body.missions).toBeDefined();
    expect(res.body.streak).toBeDefined();
    expect(res.body.puzzle).toBeDefined();
    expect(res.body.todayDate).toBeDefined();
    expect(res.body.totalAvailableCoins).toBeGreaterThan(0);
    expect(res.body.balances).toBeDefined();
  });

  it("wallet endpoints still return correct shape", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, auth());
    expect(res.status).toBe(200);
    expect(res.body.balances).toBeDefined();
    expect(typeof res.body.balances.gold_coins).toBe("number");
  });

  it("wallet history returns transactions with proper types", async () => {
    const res = await makeRequest("GET", "/api/wallet/history", undefined, auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.transactions)).toBe(true);
    // Signup bonus should still exist
    const signupTxn = res.body.transactions.find((t: any) => t.type === "signup_bonus");
    expect(signupTxn).toBeDefined();
  });

  it("billing packages still return", async () => {
    const res = await makeRequest("GET", "/api/billing/packages", undefined, auth());
    expect(res.status).toBe(200);
    expect(res.body.packages).toBeDefined();
  });

  it("health endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });
});
