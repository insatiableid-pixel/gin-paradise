import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startTestServer, stopTestServer, registerUser, loginUser, makeRequest } from "./helpers.js";
import { db } from "../server/db.js";
import {
  getBalances,
  mutateBalance,
  getTransactions,
  creditSignupBonus,
  DEFAULT_GOLD_COINS,
  DEFAULT_SWEEPS_COINS,
} from "../server/ledger.js";
import {
  checkBalance,
  holdEntryFee,
  settleMatch,
  refundEscrow,
  initRoomEscrow,
  getRoomEscrow,
  cleanupEscrow,
  getStakePreset,
  isFreeStake,
  STAKE_PRESETS,
  _clearEscrows,
} from "../server/escrow.js";
import {
  joinQueue,
  leaveQueue,
  _clearQueue,
  _getQueue,
  setMatchFoundCallback,
} from "../server/multiplayer/matchmaking.js";
import { WebSocket } from "ws";

let baseUrl: string;

// Helper: create a raw user directly in the DB (bypasses API, faster)
function createTestUser(username: string): string {
  const userId = crypto.randomUUID();
  db.prepare(
    "INSERT INTO users (id, username, email, password_hash, rating) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, username, `${username}@test.com`, "hashed", 1200);
  return userId;
}

beforeAll(async () => {
  baseUrl = await startTestServer();
  // Clean up test users from any previous runs
  db.prepare("DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_escrow_%')").run();
  db.prepare("DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_escrow_%')").run();
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_escrow_%')").run();
  db.prepare("DELETE FROM matches WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_escrow_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'test_escrow_%'").run();
});

afterAll(async () => {
  db.prepare("DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_escrow_%')").run();
  db.prepare("DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_escrow_%')").run();
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_escrow_%')").run();
  db.prepare("DELETE FROM matches WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_escrow_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'test_escrow_%'").run();
  _clearEscrows();
  _clearQueue();
  await stopTestServer();
});

// ─── Stake Presets ──────────────────────────────────────────────────────

describe("Stake Presets", () => {
  it("should have a free play preset", () => {
    const free = getStakePreset("free");
    expect(free).toBeTruthy();
    expect(free!.entryFee).toBe(0);
    expect(free!.prizePool).toBe(0);
    expect(isFreeStake("free")).toBe(true);
  });

  it("should have gold stake presets", () => {
    const g500 = getStakePreset("gold_500");
    const g2000 = getStakePreset("gold_2000");
    const g5000 = getStakePreset("gold_5000");
    expect(g500).toBeTruthy();
    expect(g500!.entryFee).toBe(500);
    expect(g500!.prizePool).toBe(950); // 1000 - 50 rake
    expect(g500!.rakeAmount).toBe(50);
    expect(g500!.currency).toBe("gold_coins");
    expect(g2000!.entryFee).toBe(2000);
    expect(g5000!.entryFee).toBe(5000);
  });

  it("should have new coin economy presets", () => {
    const g100 = getStakePreset("gold_100");
    expect(g100).toBeTruthy();
    expect(g100!.entryFee).toBe(100);
    expect(g100!.prizePool).toBe(190); // 200 - 10 rake
    expect(g100!.rakeAmount).toBe(10);
    expect(g100!.currency).toBe("gold_coins");
  });

  it("should return undefined for invalid preset", () => {
    expect(getStakePreset("invalid")).toBeUndefined();
  });

  it("should identify non-free stakes correctly", () => {
    expect(isFreeStake("gold_100")).toBe(false);
  });
});

// ─── Balance Check ──────────────────────────────────────────────────────

describe("Balance Check", () => {
  let userId: string;

  beforeAll(() => {
    userId = createTestUser("test_escrow_balcheck");
    creditSignupBonus(userId); // 5,000 Gold in new economy
  });

  it("should approve free play for any balance", () => {
    const result = checkBalance(userId, "free");
    expect(result.canAfford).toBe(true);
  });

  it("should approve affordable gold stake", () => {
    const result = checkBalance(userId, "gold_500");
    expect(result.canAfford).toBe(true);
    expect(result.balance).toBe(DEFAULT_GOLD_COINS);
    expect(result.required).toBe(500);
  });

  it("should reject unaffordable gold stake", () => {
    const poorUserId = createTestUser("test_escrow_poor");
    // No signup bonus — zero balance
    const result = checkBalance(poorUserId, "gold_500");
    expect(result.canAfford).toBe(false);
    expect(result.balance).toBe(0);
    expect(result.required).toBe(500);
  });

  it("should approve affordable gold_100 stake", () => {
    const result = checkBalance(userId, "gold_100");
    expect(result.canAfford).toBe(true);
    expect(result.balance).toBe(DEFAULT_GOLD_COINS);
    expect(result.required).toBe(100);
  });

  it("should reject unaffordable gold_100 stake for zero-balance user", () => {
    const poorUserId = createTestUser("test_escrow_poor_coin");
    const result = checkBalance(poorUserId, "gold_100");
    expect(result.canAfford).toBe(false);
    expect(result.balance).toBe(0);
    expect(result.required).toBe(100);
  });
});

// ─── Escrow Hold ────────────────────────────────────────────────────────

describe("Escrow Hold", () => {
  let userId: string;
  const roomId = "ESCROW_HOLD_TEST";

  beforeAll(() => {
    userId = createTestUser("test_escrow_hold");
    creditSignupBonus(userId);
  });

  beforeEach(() => {
    _clearEscrows();
  });

  it("should hold entry fee and debit balance", () => {
    const balanceBefore = getBalances(userId);
    const hold = holdEntryFee(roomId, userId, "gold_500");
    expect(hold).toBeTruthy();
    expect(hold!.amount).toBe(500);
    expect(hold!.currency).toBe("gold_coins");

    const balanceAfter = getBalances(userId);
    expect(balanceAfter.gold_coins).toBe(balanceBefore.gold_coins - 500);
  });

  it("should create escrow_hold transaction in ledger", () => {
    holdEntryFee(roomId + "2", userId, "gold_500");
    const txns = getTransactions(userId, 50);
    const escrowTxn = txns.find(t => t.type === "escrow_hold" && t.reference === roomId + "2");
    expect(escrowTxn).toBeTruthy();
    expect(escrowTxn!.amount).toBe(-500);
    expect(escrowTxn!.currency).toBe("gold_coins");
  });

  it("should track hold in room escrow state", () => {
    holdEntryFee(roomId + "3", userId, "gold_500");
    const escrow = getRoomEscrow(roomId + "3");
    expect(escrow).toBeTruthy();
    expect(escrow!.holds.length).toBe(1);
    expect(escrow!.stakeId).toBe("gold_500");
    expect(escrow!.settled).toBe(false);
  });

  it("should return null for free play holds", () => {
    const hold = holdEntryFee(roomId + "4", userId, "free");
    expect(hold).toBeNull();
  });

  it("should throw on insufficient balance", () => {
    const poorUserId = createTestUser("test_escrow_hold_poor");
    expect(() => {
      holdEntryFee(roomId + "5", poorUserId, "gold_500");
    }).toThrow(/Insufficient/);
  });
});

// ─── Escrow Settlement — Normal Win ─────────────────────────────────────

describe("Escrow Settlement — Normal Win", () => {
  let winnerId: string;
  let loserId: string;
  const roomId = "SETTLE_NORMAL";

  beforeAll(() => {
    winnerId = createTestUser("test_escrow_winner");
    loserId = createTestUser("test_escrow_loser");
    creditSignupBonus(winnerId);
    creditSignupBonus(loserId);
    _clearEscrows();
  });

  it("should settle match: winner receives net prize pool (after rake)", () => {
    // Both players hold entry fee
    holdEntryFee(roomId, winnerId, "gold_500");
    holdEntryFee(roomId, loserId, "gold_500");

    const winnerBefore = getBalances(winnerId);
    const loserBefore = getBalances(loserId);

    const settlement = settleMatch(roomId, winnerId, loserId, "completed");
    expect(settlement.type).toBe("payout");
    expect(settlement.winnerId).toBe(winnerId);
    expect(settlement.payoutAmount).toBe(950); // 1000 - 50 rake
    expect(settlement.rakeAmount).toBe(50);
    expect(settlement.currency).toBe("gold_coins");

    const winnerAfter = getBalances(winnerId);
    const loserAfter = getBalances(loserId);

    // Winner: started with 10000, -500 hold, +950 payout = 10450
    expect(winnerAfter.gold_coins).toBe(winnerBefore.gold_coins + 950);
    // Loser: started with 10000, -500 hold = 9500 (no change after settlement)
    expect(loserAfter.gold_coins).toBe(loserBefore.gold_coins);
  });

  it("should create prize_payout transaction for winner (net of rake)", () => {
    const txns = getTransactions(winnerId, 50);
    const payoutTxn = txns.find(t => t.type === "prize_payout" && t.reference === roomId);
    expect(payoutTxn).toBeTruthy();
    expect(payoutTxn!.amount).toBe(950); // net of 50 rake
    expect(payoutTxn!.currency).toBe("gold_coins");
  });

  it("should mark escrow as settled", () => {
    const escrow = getRoomEscrow(roomId);
    expect(escrow!.settled).toBe(true);
  });

  it("should not settle twice", () => {
    const result = settleMatch(roomId, winnerId, loserId, "completed");
    expect(result.type).toBe("no_stake");
  });
});

// ─── Escrow Settlement — Forfeit ────────────────────────────────────────

describe("Escrow Settlement — Forfeit/Timeout/Disconnect", () => {
  it("should settle on forfeit: winner receives prize pool", () => {
    const w = createTestUser("test_escrow_forfeit_w");
    const l = createTestUser("test_escrow_forfeit_l");
    creditSignupBonus(w);
    creditSignupBonus(l);
    const rid = "SETTLE_FORFEIT";
    _clearEscrows();

    holdEntryFee(rid, w, "gold_2000");
    holdEntryFee(rid, l, "gold_2000");

    const settlement = settleMatch(rid, w, l, "forfeit");
    expect(settlement.type).toBe("payout");
    expect(settlement.payoutAmount).toBe(3800); // 4000 - 200 rake

    const wBal = getBalances(w);
    // 5000 - 2000 + 3800 = 6800
    expect(wBal.gold_coins).toBe(6800);
  });

  it("should settle on timeout: winner receives prize pool", () => {
    const w = createTestUser("test_escrow_timeout_w");
    const l = createTestUser("test_escrow_timeout_l");
    creditSignupBonus(w);
    creditSignupBonus(l);
    const rid = "SETTLE_TIMEOUT";
    _clearEscrows();

    holdEntryFee(rid, w, "gold_500");
    holdEntryFee(rid, l, "gold_500");

    const settlement = settleMatch(rid, w, l, "timeout");
    expect(settlement.type).toBe("payout");
    expect(settlement.payoutAmount).toBe(950); // 1000 - 50 rake
    expect(settlement.details).toContain("Opponent timed out");
  });

  it("should settle on disconnect: winner receives prize pool", () => {
    const w = createTestUser("test_escrow_dc_w");
    const l = createTestUser("test_escrow_dc_l");
    creditSignupBonus(w);
    creditSignupBonus(l);
    const rid = "SETTLE_DC";
    _clearEscrows();

    holdEntryFee(rid, w, "gold_100");
    holdEntryFee(rid, l, "gold_100");

    const settlement = settleMatch(rid, w, l, "disconnect");
    expect(settlement.type).toBe("payout");
    expect(settlement.payoutAmount).toBe(190); // 200 - 10 rake
    expect(settlement.currency).toBe("gold_coins");
  });
});

// ─── Escrow Refund ──────────────────────────────────────────────────────

describe("Escrow Refund — Pre-Start Failure", () => {
  it("should refund all holds when match fails before start", () => {
    const u1 = createTestUser("test_escrow_refund1");
    const u2 = createTestUser("test_escrow_refund2");
    creditSignupBonus(u1);
    creditSignupBonus(u2);
    const rid = "REFUND_TEST";
    _clearEscrows();

    holdEntryFee(rid, u1, "gold_5000");
    holdEntryFee(rid, u2, "gold_5000");

    // Verify both were debited
    expect(getBalances(u1).gold_coins).toBe(DEFAULT_GOLD_COINS - 5000);
    expect(getBalances(u2).gold_coins).toBe(DEFAULT_GOLD_COINS - 5000);

    // Refund
    const result = refundEscrow(rid);
    expect(result.type).toBe("refund");
    expect(result.details).toContain("Refunded 2 player");

    // Both should be back to original balance
    expect(getBalances(u1).gold_coins).toBe(DEFAULT_GOLD_COINS);
    expect(getBalances(u2).gold_coins).toBe(DEFAULT_GOLD_COINS);
  });

  it("should create refund transactions in ledger", () => {
    const u = createTestUser("test_escrow_refund_txn");
    creditSignupBonus(u);
    const rid = "REFUND_TXN_TEST";
    _clearEscrows();

    holdEntryFee(rid, u, "gold_500");
    refundEscrow(rid);

    const txns = getTransactions(u, 50);
    const refundTxn = txns.find(t => t.type === "refund" && t.reference === rid);
    expect(refundTxn).toBeTruthy();
    expect(refundTxn!.amount).toBe(500);
    expect(refundTxn!.note).toContain("Match refund");
  });

  it("should handle free play refund gracefully", () => {
    const rid = "REFUND_FREE";
    _clearEscrows();
    initRoomEscrow(rid, "free");
    const result = refundEscrow(rid);
    expect(result.type).toBe("no_stake");
  });
});

// ─── Queue Stake Compatibility ──────────────────────────────────────────

describe("Queue — Stake-Compatible Pairing", () => {
  beforeEach(() => {
    _clearQueue();
  });

  it("should not pair players with different stakes", () => {
    // Create mock websockets
    const ws1 = { readyState: 1 } as any;
    const ws2 = { readyState: 1 } as any;

    joinQueue("user_a", "userA", 1200, ws1, "gold_500");
    joinQueue("user_b", "userB", 1200, ws2, "gold_2000");

    // Both should still be in queue (no pair formed)
    const queue = _getQueue();
    expect(queue.length).toBe(2);
  });

  it("should pair players with the same stake", () => {
    const ws1 = { readyState: 1, send: () => {} } as any;
    const ws2 = { readyState: 1, send: () => {} } as any;

    // Set up a match found callback that records the match
    let matchFormed = false;
    setMatchFoundCallback(() => { matchFormed = true; });

    joinQueue("user_c", "userC", 1200, ws1, "gold_500");
    joinQueue("user_d", "userD", 1200, ws2, "gold_500");

    expect(matchFormed).toBe(true);
    // Queue should be empty after pairing
    const queue = _getQueue();
    expect(queue.length).toBe(0);
  });

  it("should carry stakeId on queue entries", () => {
    const ws = { readyState: 1 } as any;
    joinQueue("user_e", "userE", 1200, ws, "gold_100");
    const queue = _getQueue();
    expect(queue[0].stakeId).toBe("gold_100");
  });
});

// ─── Wallet History Reflects Stakes ─────────────────────────────────────

describe("Wallet History — Stake Transactions", () => {
  let userId: string;

  beforeAll(() => {
    userId = createTestUser("test_escrow_history");
    creditSignupBonus(userId);
    _clearEscrows();
  });

  it("should show escrow_hold and prize_payout in transaction history", () => {
    const rid = "HISTORY_TEST";
    holdEntryFee(rid, userId, "gold_500");

    const opponentId = createTestUser("test_escrow_history_opp");
    creditSignupBonus(opponentId);
    holdEntryFee(rid, opponentId, "gold_500");

    settleMatch(rid, userId, opponentId, "completed");

    const txns = getTransactions(userId, 20);
    const holdTxn = txns.find(t => t.type === "escrow_hold");
    const payoutTxn = txns.find(t => t.type === "prize_payout");

    expect(holdTxn).toBeTruthy();
    expect(holdTxn!.amount).toBe(-500);
    expect(payoutTxn).toBeTruthy();
    expect(payoutTxn!.amount).toBe(950); // net of 50 rake

    // Net gain: -500 + 950 = +450
    const bal = getBalances(userId);
    expect(bal.gold_coins).toBe(DEFAULT_GOLD_COINS - 500 + 950);
  });
});

// ─── Cleanup ────────────────────────────────────────────────────────────

describe("Escrow Cleanup", () => {
  it("should remove escrow state on cleanup", () => {
    const rid = "CLEANUP_TEST";
    _clearEscrows();
    initRoomEscrow(rid, "gold_500");
    expect(getRoomEscrow(rid)).toBeTruthy();
    cleanupEscrow(rid);
    expect(getRoomEscrow(rid)).toBeUndefined();
  });
});

// ─── Regression — Existing Features ─────────────────────────────────────

describe("Escrow — Regression", () => {
  it("registration still grants signup bonus", async () => {
    const res = await registerUser("test_escrow_reg_check", "escrow_reg@test.com", "password123");
    expect(res.status).toBe(200);
    expect(res.body.user).toBeTruthy();
  });

  it("wallet API still returns balances", async () => {
    const loginRes = await loginUser("test_escrow_reg_check", "password123");
    const walletRes = await makeRequest("GET", "/api/wallet", undefined, {
      Authorization: `Bearer ${loginRes.body.sessionId}`,
    });
    expect(walletRes.status).toBe(200);
    expect(walletRes.body.balances.gold_coins).toBe(DEFAULT_GOLD_COINS);
  });

  it("leaderboard still works", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leaderboard)).toBe(true);
  });

  it("faucet still works", async () => {
    const loginRes = await loginUser("test_escrow_reg_check", "password123");
    const res = await makeRequest("POST", "/api/wallet/faucet", undefined, {
      Authorization: `Bearer ${loginRes.body.sessionId}`,
    });
    // Either success or cooldown — both valid
    expect([200, 429]).toContain(res.status);
  });
});
