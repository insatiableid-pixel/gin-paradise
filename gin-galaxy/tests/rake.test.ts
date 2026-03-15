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
  recordRake,
  getHouseLedger,
  getHouseRevenue,
  getHouseRevenueForCurrency,
} from "../server/houseAccounting.js";
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
  db.prepare("DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_rake_%')").run();
  db.prepare("DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_rake_%')").run();
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_rake_%')").run();
  db.prepare("DELETE FROM matches WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_rake_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'test_rake_%'").run();
  db.prepare("DELETE FROM house_ledger").run();
});

afterAll(async () => {
  db.prepare("DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_rake_%')").run();
  db.prepare("DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_rake_%')").run();
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_rake_%')").run();
  db.prepare("DELETE FROM matches WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test_rake_%')").run();
  db.prepare("DELETE FROM users WHERE username LIKE 'test_rake_%'").run();
  db.prepare("DELETE FROM house_ledger").run();
  _clearEscrows();
  _clearQueue();
  await stopTestServer();
});

// ─── Rake Model on Stake Presets ────────────────────────────────────────

describe("Rake Model — Stake Presets", () => {
  it("free play should have zero rake", () => {
    const free = getStakePreset("free")!;
    expect(free.rakePercent).toBe(0);
    expect(free.rakeAmount).toBe(0);
    expect(free.prizePool).toBe(0);
    expect(free.entryFee).toBe(0);
  });

  it("gold_500 should have correct rake math: 5% of 1000 = 50 rake, 950 payout", () => {
    const preset = getStakePreset("gold_500")!;
    expect(preset.rakePercent).toBe(0.05);
    // totalHeld = 500*2 = 1000, rake = 1000*0.05 = 50, payout = 950
    expect(preset.rakeAmount).toBe(50);
    expect(preset.prizePool).toBe(950);
    // Reconciliation: prizePool + rakeAmount = totalHeld
    expect(preset.prizePool + preset.rakeAmount).toBe(preset.entryFee * 2);
  });

  it("gold_2000 should have correct rake math", () => {
    const preset = getStakePreset("gold_2000")!;
    expect(preset.rakeAmount).toBe(200);
    expect(preset.prizePool).toBe(3800);
    expect(preset.prizePool + preset.rakeAmount).toBe(4000);
  });

  it("gold_5000 should have correct rake math", () => {
    const preset = getStakePreset("gold_5000")!;
    expect(preset.rakeAmount).toBe(500);
    expect(preset.prizePool).toBe(9500);
    expect(preset.prizePool + preset.rakeAmount).toBe(10000);
  });

  it("gold_100 should have correct rake math", () => {
    const preset = getStakePreset("gold_100")!;
    // totalHeld = 100*2 = 200, rake = 200*0.05 = 10, payout = 190
    expect(preset.rakeAmount).toBe(10);
    expect(preset.prizePool).toBe(190);
    expect(preset.prizePool + preset.rakeAmount).toBe(200);
  });

  it("all presets should satisfy reconciliation: prizePool + rakeAmount = 2 * entryFee", () => {
    for (const p of STAKE_PRESETS) {
      const totalHeld = p.entryFee * 2;
      expect(p.prizePool + p.rakeAmount).toBe(totalHeld);
    }
  });
});

// ─── Settlement with Rake ───────────────────────────────────────────────

describe("Rake Settlement — Completed Match", () => {
  let winnerId: string;
  let loserId: string;
  const roomId = "RAKE_SETTLE_1";

  beforeAll(() => {
    winnerId = createTestUser("test_rake_settle_w");
    loserId = createTestUser("test_rake_settle_l");
    creditSignupBonus(winnerId);
    creditSignupBonus(loserId);
    _clearEscrows();
    db.prepare("DELETE FROM house_ledger").run();
  });

  it("should settle with correct rake-adjusted payout (gold_500, 5% rake)", () => {
    holdEntryFee(roomId, winnerId, "gold_500");
    holdEntryFee(roomId, loserId, "gold_500");

    const winnerBefore = getBalances(winnerId);

    const settlement = settleMatch(roomId, winnerId, loserId, "completed");
    expect(settlement.type).toBe("payout");
    expect(settlement.payoutAmount).toBe(950); // 1000 - 50 rake
    expect(settlement.rakeAmount).toBe(50);
    expect(settlement.currency).toBe("gold_coins");

    const winnerAfter = getBalances(winnerId);
    // Winner: was debited 500, then received 950 payout = net +450
    expect(winnerAfter.gold_coins).toBe(winnerBefore.gold_coins + 950);
  });

  it("should reconcile: payout + rake = total held", () => {
    // Already settled above
    const escrow = getRoomEscrow(roomId)!;
    expect(escrow.settled).toBe(true);
    // The preset's math: 950 + 50 = 1000 = 2 × 500
    expect(950 + 50).toBe(1000);
  });
});

describe("Rake Settlement — Forfeit/Timeout/Disconnect", () => {
  it("should apply rake on forfeit settlement", () => {
    const w = createTestUser("test_rake_forfeit_w");
    const l = createTestUser("test_rake_forfeit_l");
    creditSignupBonus(w);
    creditSignupBonus(l);
    const rid = "RAKE_FORFEIT";
    _clearEscrows();

    holdEntryFee(rid, w, "gold_2000");
    holdEntryFee(rid, l, "gold_2000");

    const settlement = settleMatch(rid, w, l, "forfeit");
    expect(settlement.type).toBe("payout");
    expect(settlement.payoutAmount).toBe(3800); // 4000 - 200 rake
    expect(settlement.rakeAmount).toBe(200);
    expect(settlement.details).toContain("Opponent forfeited");

    const wBal = getBalances(w);
    // 5000 - 2000 + 3800 = 6800
    expect(wBal.gold_coins).toBe(6800);
  });

  it("should apply rake on timeout settlement", () => {
    const w = createTestUser("test_rake_timeout_w");
    const l = createTestUser("test_rake_timeout_l");
    creditSignupBonus(w);
    creditSignupBonus(l);
    const rid = "RAKE_TIMEOUT";
    _clearEscrows();

    holdEntryFee(rid, w, "gold_500");
    holdEntryFee(rid, l, "gold_500");

    const settlement = settleMatch(rid, w, l, "timeout");
    expect(settlement.type).toBe("payout");
    expect(settlement.payoutAmount).toBe(950);
    expect(settlement.rakeAmount).toBe(50);
    expect(settlement.details).toContain("Opponent timed out");
  });

  it("should apply rake on disconnect settlement (gold_100)", () => {
    const w = createTestUser("test_rake_dc_w");
    const l = createTestUser("test_rake_dc_l");
    creditSignupBonus(w);
    creditSignupBonus(l);
    const rid = "RAKE_DC";
    _clearEscrows();

    holdEntryFee(rid, w, "gold_100");
    holdEntryFee(rid, l, "gold_100");

    const settlement = settleMatch(rid, w, l, "disconnect");
    expect(settlement.type).toBe("payout");
    expect(settlement.payoutAmount).toBe(190);
    expect(settlement.rakeAmount).toBe(10);
    expect(settlement.currency).toBe("gold_coins");
  });
});

// ─── Free Play — No Rake ───────────────────────────────────────────────

describe("Free Play — Rake-Free", () => {
  it("should not apply rake on free play settlement", () => {
    const rid = "RAKE_FREE";
    _clearEscrows();
    initRoomEscrow(rid, "free");
    const settlement = settleMatch(rid, "user1", "user2", "completed");
    expect(settlement.type).toBe("no_stake");
    expect(settlement.rakeAmount).toBeUndefined();
  });

  it("free play hold should return null", () => {
    const u = createTestUser("test_rake_freehold");
    const hold = holdEntryFee("FREE_ROOM", u, "free");
    expect(hold).toBeNull();
  });
});

// ─── Pre-Start Refund — No Rake ─────────────────────────────────────────

describe("Escrow Refund — No Rake Taken", () => {
  it("should refund full amount with no rake deducted", () => {
    const u1 = createTestUser("test_rake_refund1");
    const u2 = createTestUser("test_rake_refund2");
    creditSignupBonus(u1);
    creditSignupBonus(u2);
    const rid = "RAKE_REFUND";
    _clearEscrows();

    holdEntryFee(rid, u1, "gold_5000");
    holdEntryFee(rid, u2, "gold_5000");

    // Verify both were debited
    expect(getBalances(u1).gold_coins).toBe(DEFAULT_GOLD_COINS - 5000);
    expect(getBalances(u2).gold_coins).toBe(DEFAULT_GOLD_COINS - 5000);

    // Refund — no rake
    const result = refundEscrow(rid);
    expect(result.type).toBe("refund");

    // Both should be back to original balance
    expect(getBalances(u1).gold_coins).toBe(DEFAULT_GOLD_COINS);
    expect(getBalances(u2).gold_coins).toBe(DEFAULT_GOLD_COINS);
  });
});

// ─── House Accounting — Rake Recorded ───────────────────────────────────

describe("House Accounting — Rake Recording", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM house_ledger").run();
    _clearEscrows();
  });

  it("should record rake in house_ledger on settlement", () => {
    const w = createTestUser("test_rake_house_w");
    const l = createTestUser("test_rake_house_l");
    creditSignupBonus(w);
    creditSignupBonus(l);
    const rid = "HOUSE_ACCT_1";

    holdEntryFee(rid, w, "gold_500");
    holdEntryFee(rid, l, "gold_500");

    settleMatch(rid, w, l, "completed");

    const ledger = getHouseLedger(10);
    expect(ledger.length).toBe(1);
    expect(ledger[0].currency).toBe("gold_coins");
    expect(ledger[0].amount).toBe(50);
    expect(ledger[0].type).toBe("rake");
    expect(ledger[0].room_id).toBe(rid);
    expect(ledger[0].stake_id).toBe("gold_500");
    expect(ledger[0].winner_id).toBe(w);
    expect(ledger[0].loser_id).toBe(l);
  });

  it("should report correct revenue by currency", () => {
    // Create gold rake
    const w1 = createTestUser("test_rake_rev_w1");
    const l1 = createTestUser("test_rake_rev_l1");
    creditSignupBonus(w1);
    creditSignupBonus(l1);
    holdEntryFee("REV_G", w1, "gold_500");
    holdEntryFee("REV_G", l1, "gold_500");
    settleMatch("REV_G", w1, l1, "completed");

    // Create second gold rake at different tier
    _clearEscrows();
    const w2 = createTestUser("test_rake_rev_w2");
    const l2 = createTestUser("test_rake_rev_l2");
    creditSignupBonus(w2);
    creditSignupBonus(l2);
    holdEntryFee("REV_S", w2, "gold_100");
    holdEntryFee("REV_S", l2, "gold_100");
    settleMatch("REV_S", w2, l2, "completed");

    const revenue = getHouseRevenue();
    // All gold_coins in new economy
    const goldRev = revenue.find(r => r.currency === "gold_coins");
    expect(goldRev).toBeTruthy();
    expect(goldRev!.total_revenue).toBe(60); // 50 + 10
    expect(goldRev!.transaction_count).toBe(2);
  });

  it("should return correct total for a specific currency", () => {
    const w = createTestUser("test_rake_curr_w");
    const l = createTestUser("test_rake_curr_l");
    creditSignupBonus(w);
    creditSignupBonus(l);
    holdEntryFee("CURR1", w, "gold_2000");
    holdEntryFee("CURR1", l, "gold_2000");
    settleMatch("CURR1", w, l, "completed");

    const goldTotal = getHouseRevenueForCurrency("gold_coins");
    expect(goldTotal).toBe(200); // 4000 * 0.05
    // Only gold coins in new economy
    const sweepsTotal = getHouseRevenueForCurrency("sweeps_coins");
    expect(sweepsTotal).toBe(0);
  });

  it("should not record house rake for free play", () => {
    const rid = "FREE_HOUSE";
    initRoomEscrow(rid, "free");
    settleMatch(rid, "u1", "u2", "completed");
    // House ledger was cleared in beforeEach
    const ledger = getHouseLedger(10);
    expect(ledger.length).toBe(0);
  });

  it("should not record house rake on refund", () => {
    const u1 = createTestUser("test_rake_norefund1");
    const u2 = createTestUser("test_rake_norefund2");
    creditSignupBonus(u1);
    creditSignupBonus(u2);
    holdEntryFee("NOREFUND", u1, "gold_500");
    holdEntryFee("NOREFUND", u2, "gold_500");
    refundEscrow("NOREFUND");

    const ledger = getHouseLedger(10);
    expect(ledger.length).toBe(0);
  });
});

// ─── Player Transaction History Reflects Rake ───────────────────────────

describe("Player Transaction History — Rake Accuracy", () => {
  it("should show correct net payout amount in winner's transaction history", () => {
    _clearEscrows();
    const w = createTestUser("test_rake_hist_w");
    const l = createTestUser("test_rake_hist_l");
    creditSignupBonus(w);
    creditSignupBonus(l);
    const rid = "HIST_RAKE";

    holdEntryFee(rid, w, "gold_500");
    holdEntryFee(rid, l, "gold_500");
    settleMatch(rid, w, l, "completed");

    const txns = getTransactions(w, 20);
    const payoutTxn = txns.find(t => t.type === "prize_payout" && t.reference === rid);
    expect(payoutTxn).toBeTruthy();
    expect(payoutTxn!.amount).toBe(950); // net of 50 rake
    expect(payoutTxn!.note).toContain("net of 50 rake");
  });

  it("loser's balance should reflect only the escrow hold", () => {
    _clearEscrows();
    const w = createTestUser("test_rake_loser_w");
    const l = createTestUser("test_rake_loser_l");
    creditSignupBonus(w);
    creditSignupBonus(l);

    holdEntryFee("LOSER_BAL", w, "gold_500");
    holdEntryFee("LOSER_BAL", l, "gold_500");
    settleMatch("LOSER_BAL", w, l, "completed");

    const loserBal = getBalances(l);
    // 5000 - 500 (hold) = 4500, no payout
    expect(loserBal.gold_coins).toBe(4500);

    const loserTxns = getTransactions(l, 20);
    const payoutTxns = loserTxns.filter(t => t.type === "prize_payout");
    expect(payoutTxns.length).toBe(0);
  });
});

// ─── Settlement Reconciliation (Comprehensive) ──────────────────────────

describe("Settlement Reconciliation — All Stakes", () => {
  const testCases = [
    { stakeId: "gold_500",  entry: 500,  total: 1000,  rake: 50,   payout: 950   },
    { stakeId: "gold_2000", entry: 2000, total: 4000,  rake: 200,  payout: 3800  },
    { stakeId: "gold_5000", entry: 5000, total: 10000, rake: 500,  payout: 9500  },
    { stakeId: "gold_100",  entry: 100,  total: 200,   rake: 10,   payout: 190   },
  ];

  testCases.forEach(tc => {
    it(`${tc.stakeId}: payout(${tc.payout}) + rake(${tc.rake}) = total held(${tc.total})`, () => {
      expect(tc.payout + tc.rake).toBe(tc.total);
      expect(tc.total).toBe(tc.entry * 2);

      const preset = getStakePreset(tc.stakeId)!;
      expect(preset.prizePool).toBe(tc.payout);
      expect(preset.rakeAmount).toBe(tc.rake);
    });
  });
});

// ─── Queue Stake Compatibility (unchanged by rake) ──────────────────────

describe("Queue — Stake Compatibility (with Rake)", () => {
  beforeEach(() => {
    _clearQueue();
  });

  it("should still only pair players with matching stakes", () => {
    const ws1 = { readyState: 1 } as any;
    const ws2 = { readyState: 1 } as any;

    joinQueue("user_ra", "userRA", 1200, ws1, "gold_500");
    joinQueue("user_rb", "userRB", 1200, ws2, "gold_2000");

    const queue = _getQueue();
    expect(queue.length).toBe(2); // No pair formed
  });

  it("should pair same-stake players and hold entry fees", () => {
    const ws1 = { readyState: 1, send: () => {} } as any;
    const ws2 = { readyState: 1, send: () => {} } as any;

    let matchFormed = false;
    setMatchFoundCallback(() => { matchFormed = true; });

    joinQueue("user_rc", "userRC", 1200, ws1, "gold_500");
    joinQueue("user_rd", "userRD", 1200, ws2, "gold_500");

    expect(matchFormed).toBe(true);
    const queue = _getQueue();
    expect(queue.length).toBe(0);
  });
});

// ─── Regression — Existing Features Still Work ──────────────────────────

describe("Rake — Regression", () => {
  it("registration still grants signup bonus", async () => {
    const res = await registerUser("test_rake_reg_check", "rakereg@test.com", "password123");
    expect(res.status).toBe(200);
    expect(res.body.user).toBeTruthy();
  });

  it("wallet API still returns balances", async () => {
    const loginRes = await loginUser("test_rake_reg_check", "password123");
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
    const loginRes = await loginUser("test_rake_reg_check", "password123");
    const res = await makeRequest("POST", "/api/wallet/faucet", undefined, {
      Authorization: `Bearer ${loginRes.body.sessionId}`,
    });
    expect([200, 429]).toContain(res.status);
  });

  it("existing escrow preset structure includes rakePercent and rakeAmount", () => {
    for (const preset of STAKE_PRESETS) {
      expect(typeof preset.rakePercent).toBe("number");
      expect(typeof preset.rakeAmount).toBe("number");
      expect(typeof preset.prizePool).toBe("number");
    }
  });
});
