import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer, registerUser, loginUser, makeRequest } from "./helpers.js";
import { db } from "../server/db.js";
import {
  getBalances,
  mutateBalance,
  claimFaucet,
  creditSignupBonus,
  getTransactions,
  DEFAULT_GOLD_COINS,
  DEFAULT_SWEEPS_COINS,
  FAUCET_GOLD_AMOUNT,
  FAUCET_SWEEPS_AMOUNT,
  FAUCET_COOLDOWN_MS,
  reconcileWalletLedger,
  toMoneyUnits,
} from "../server/ledger.js";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
  // Clean up test users from any previous runs
  db.prepare("DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_wallet_%')").run();
  db.prepare("DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_wallet_%')").run();
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_wallet_%')").run();
  db.prepare("DELETE FROM matches WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_wallet_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'test_wallet_%'").run();
});

afterAll(async () => {
  db.prepare("DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_wallet_%')").run();
  db.prepare("DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_wallet_%')").run();
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_wallet_%')").run();
  db.prepare("DELETE FROM matches WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_wallet_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'test_wallet_%'").run();
  await stopTestServer();
});

// ─── Ledger Primitives (Unit Tests) ─────────────────────────────────────

describe("Ledger — mutateBalance", () => {
  let userId: string;

  beforeAll(() => {
    // Create a raw user for unit tests (no API call)
    userId = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)").run(
      userId, "test_wallet_ledger_unit", "ledger_unit@test.com", "hashed"
    );
  });

  it("should credit gold_coins and record a transaction", () => {
    const txnId = mutateBalance(userId, "gold_coins", 1000, "admin_grant", null, "Test credit");
    expect(txnId).toBeTruthy();

    const balances = getBalances(userId);
    expect(balances.gold_coins).toBe(1000);
    expect(balances.sweeps_coins).toBe(0);
  });

  it("should debit gold_coins and record a transaction", () => {
    mutateBalance(userId, "gold_coins", -500, "admin_debit", null, "Test debit");
    const balances = getBalances(userId);
    expect(balances.gold_coins).toBe(500);
  });

  it("should reject debit that would cause negative balance", () => {
    expect(() => {
      mutateBalance(userId, "gold_coins", -9999, "admin_debit");
    }).toThrow(/Insufficient gold_coins balance/);
    // Balance should be unchanged
    const balances = getBalances(userId);
    expect(balances.gold_coins).toBe(500);
  });

  it("should handle sweeps_coins independently (legacy compat)", () => {
    mutateBalance(userId, "sweeps_coins", 5.5, "admin_grant");
    const balances = getBalances(userId);
    expect(balances.sweeps_coins).toBe(5.5);
    expect(balances.gold_coins).toBe(500); // unchanged from previous test
  });

  it("should record correct balance_after in transaction", () => {
    const txns = getTransactions(userId, 10);
    // Most recent sweeps transaction should have balance_after = 5.5
    const sweepsTxn = txns.find(t => t.currency === "sweeps_coins");
    expect(sweepsTxn).toBeTruthy();
    expect(sweepsTxn!.balance_after).toBe(5.5);
  });

  it("should store reference and note in transaction", () => {
    mutateBalance(userId, "gold_coins", 100, "admin_grant", "ref-123", "With reference");
    const txns = getTransactions(userId, 20);
    const refTxn = txns.find(t => t.reference === "ref-123");
    expect(refTxn).toBeTruthy();
    expect(refTxn!.note).toBe("With reference");
  });
});

describe("Ledger — creditSignupBonus", () => {
  let userId: string;

  beforeAll(() => {
    userId = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)").run(
      userId, "test_wallet_signup_unit", "signup_unit@test.com", "hashed"
    );
  });

  it("should credit the default amounts (single coin economy)", () => {
    creditSignupBonus(userId);
    const balances = getBalances(userId);
    expect(balances.gold_coins).toBe(DEFAULT_GOLD_COINS);
    expect(balances.sweeps_coins).toBe(DEFAULT_SWEEPS_COINS); // 0 in new economy
  });

  it("should create signup_bonus transaction (gold only in new economy)", () => {
    const txns = getTransactions(userId, 10);
    const signupTxns = txns.filter(t => t.type === "signup_bonus");
    expect(signupTxns.length).toBe(1); // Only gold_coins now
    expect(signupTxns.some(t => t.currency === "gold_coins")).toBe(true);
  });
});

describe("Ledger — claimFaucet", () => {
  let userId: string;

  beforeAll(() => {
    userId = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)").run(
      userId, "test_wallet_faucet_unit", "faucet_unit@test.com", "hashed"
    );
  });

  it("should succeed on first claim", () => {
    const result = claimFaucet(userId);
    expect(result.success).toBe(true);
    const balances = getBalances(userId);
    expect(balances.gold_coins).toBe(FAUCET_GOLD_AMOUNT);
    // No sweeps in new economy (FAUCET_SWEEPS_AMOUNT = 0)
  });

  it("should reject duplicate claim within cooldown", () => {
    const result = claimFaucet(userId);
    expect(result.success).toBe(false);
    expect(result.nextClaimAt).toBeTruthy();
    expect(result.message).toContain("already claimed");
  });

  it("should succeed after cooldown expires", () => {
    // Manually backdate the faucet transactions to a concrete past time (48 hours ago)
    const pastTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    db.prepare(
      "UPDATE transactions SET created_at = ? WHERE user_id = ? AND type = 'faucet'"
    ).run(pastTime, userId);

    const result = claimFaucet(userId);
    expect(result.success).toBe(true);
    const balances = getBalances(userId);
    expect(balances.gold_coins).toBe(FAUCET_GOLD_AMOUNT * 2); // Two claims
  });
});

// ─── Wallet API (Integration Tests) ─────────────────────────────────────

describe("Wallet API — GET /api/wallet", () => {
  let sessionId: string;

  beforeAll(async () => {
    await registerUser("test_wallet_api_1", "wallet_api1@test.com", "password123");
    const loginRes = await loginUser("test_wallet_api_1", "password123");
    sessionId = loginRes.body.sessionId;
  });

  it("should return balances with signup bonus", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.balances).toBeTruthy();
    expect(res.body.balances.gold_coins).toBe(DEFAULT_GOLD_COINS);
  });

  it("should reject with no auth", async () => {
    const res = await makeRequest("GET", "/api/wallet");
    expect(res.status).toBe(401);
  });
});

describe("Wallet API — GET /api/wallet/history", () => {
  let sessionId: string;

  beforeAll(async () => {
    await registerUser("test_wallet_hist_1", "wallet_hist1@test.com", "password123");
    const loginRes = await loginUser("test_wallet_hist_1", "password123");
    sessionId = loginRes.body.sessionId;
  });

  it("should return signup bonus transactions", async () => {
    const res = await makeRequest("GET", "/api/wallet/history", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.transactions)).toBe(true);
    expect(res.body.transactions.length).toBe(1); // gold signup bonus only
    expect(res.body.transactions[0].type).toBe("signup_bonus");
  });

  it("should respect limit parameter", async () => {
    const res = await makeRequest("GET", "/api/wallet/history?limit=1", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.transactions.length).toBe(1);
  });

  it("should reject with no auth", async () => {
    const res = await makeRequest("GET", "/api/wallet/history");
    expect(res.status).toBe(401);
  });
});

describe("Wallet API — POST /api/wallet/faucet", () => {
  let sessionId: string;

  beforeAll(async () => {
    await registerUser("test_wallet_faucet_api", "wallet_faucet@test.com", "password123");
    const loginRes = await loginUser("test_wallet_faucet_api", "password123");
    sessionId = loginRes.body.sessionId;
  });

  it("should claim faucet successfully", async () => {
    const res = await makeRequest("POST", "/api/wallet/faucet", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.claimed.coins).toBe(FAUCET_GOLD_AMOUNT);
    expect(res.body.balances.gold_coins).toBe(DEFAULT_GOLD_COINS + FAUCET_GOLD_AMOUNT);
  });

  it("should reject duplicate faucet claim", async () => {
    const res = await makeRequest("POST", "/api/wallet/faucet", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(429);
    expect(res.body.error).toContain("already claimed");
    expect(res.body.nextClaimAt).toBeTruthy();
  });

  it("should reject faucet with no auth", async () => {
    const res = await makeRequest("POST", "/api/wallet/faucet");
    expect(res.status).toBe(401);
  });
});

describe("Wallet — Atomic Integrity", () => {
  let userId: string;

  beforeAll(() => {
    userId = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)").run(
      userId, "test_wallet_atomic", "atomic@test.com", "hashed"
    );
    mutateBalance(userId, "gold_coins", 100, "admin_grant");
  });

  it("should not leave partial state on failed debit", () => {
    const balanceBefore = getBalances(userId);
    const txnsBefore = getTransactions(userId, 100);

    try {
      mutateBalance(userId, "gold_coins", -9999, "admin_debit");
    } catch {}

    const balanceAfter = getBalances(userId);
    const txnsAfter = getTransactions(userId, 100);

    expect(balanceAfter.gold_coins).toBe(balanceBefore.gold_coins);
    expect(txnsAfter.length).toBe(txnsBefore.length);
  });

  it("should create exactly one transaction per successful mutation", () => {
    const countBefore = getTransactions(userId, 100).length;
    mutateBalance(userId, "gold_coins", 50, "admin_grant");
    const countAfter = getTransactions(userId, 100).length;
    expect(countAfter).toBe(countBefore + 1);
  });

  it("stores fractional money canonically as integer units", () => {
    mutateBalance(userId, "sweeps_coins", 0.1, "admin_grant");
    mutateBalance(userId, "sweeps_coins", 0.2, "admin_grant");
    const wallet = db.prepare(`
      SELECT sweeps_coin_units FROM wallets WHERE user_id = ?
    `).get(userId) as { sweeps_coin_units: number };
    const ledger = db.prepare(`
      SELECT SUM(amount_units) AS units FROM transactions
      WHERE user_id = ? AND currency = 'sweeps_coins'
    `).get(userId) as { units: number };
    expect(wallet.sweeps_coin_units).toBe(toMoneyUnits(0.3));
    expect(ledger.units).toBe(toMoneyUnits(0.3));
    expect(getBalances(userId).sweeps_coins).toBe(0.3);
  });

  it("mirrors legacy REAL-column wallet updates into integer units", () => {
    const legacyUserId = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)").run(
      legacyUserId, "test_wallet_legacy_writer", "legacy_writer@test.com", "hashed",
    );
    db.prepare("INSERT INTO wallets (user_id, gold_coins, sweeps_coins) VALUES (?, ?, ?)")
      .run(legacyUserId, 12.34, 0);
    expect(getBalances(legacyUserId).gold_coins).toBe(12.34);
    db.prepare("UPDATE wallets SET gold_coins = ? WHERE user_id = ?").run(56.78, legacyUserId);
    expect(getBalances(legacyUserId).gold_coins).toBe(56.78);
  });

  it("detects ledger-versus-wallet drift", () => {
    expect(reconcileWalletLedger().filter(row => row.userId === userId)).toEqual([]);
    db.prepare(`
      UPDATE wallets SET gold_coin_units = gold_coin_units + 1 WHERE user_id = ?
    `).run(userId);
    expect(reconcileWalletLedger()).toContainEqual(expect.objectContaining({
      userId,
      currency: "gold_coins",
    }));
    db.prepare(`
      UPDATE wallets SET gold_coin_units = gold_coin_units - 1 WHERE user_id = ?
    `).run(userId);
  });
});

// ─── Regression ─────────────────────────────────────────────────────

describe("Wallet — Regression", () => {
  it("registration should still work with signup bonus", async () => {
    const res = await registerUser("test_wallet_reg_check", "reg_check@test.com", "password123");
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.user.username).toBe("test_wallet_reg_check");
  });

  it("existing auth endpoints still work", async () => {
    const loginRes = await loginUser("test_wallet_reg_check", "password123");
    expect(loginRes.status).toBe(200);

    const meRes = await makeRequest("GET", "/api/auth/me", undefined, {
      Authorization: `Bearer ${loginRes.body.sessionId}`,
    });
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.username).toBe("test_wallet_reg_check");
  });

  it("leaderboard still works", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leaderboard)).toBe(true);
  });
});
