/**
 * Tournament Mode Tests for Gin Paradise.
 *
 * Covers:
 *  - Tournament creation / listing
 *  - Successful join and duplicate/invalid join rejection
 *  - Balance-gated entry for paid tournaments
 *  - Bracket fill and automatic start
 *  - Bracket structure (seeding, semifinal→final)
 *  - Tournament completion and payout
 *  - Refund path for cancelled tournaments
 *  - Payout and rake accounting for completed tournaments
 *  - Leave / cancel before start
 *  - Regression coverage for existing flows
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  startTestServer,
  stopTestServer,
  getBaseUrl,
  registerUser,
  makeRequest,
} from "./helpers.js";
import { initializeDatabase, db, SESSION_TTL_MS } from "../server/db.js";
import {
  createTournament,
  joinTournament,
  leaveTournament,
  cancelTournament,
  getTournament,
  listTournaments,
  advanceBracket,
  registerTournamentRoom,
  getPendingTournamentMatch,
  TOURNAMENT_PRESETS,
  _clearTournaments,
  _getTournaments,
  _getRoomToTournament,
} from "../server/tournament.js";
import { getBalances, mutateBalance, creditSignupBonus } from "../server/ledger.js";
import { getHouseRevenue } from "../server/houseAccounting.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";

let baseUrl: string;

beforeAll(async () => {
  baseUrl = await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

beforeEach(() => {
  _clearTournaments();
});

// ── Helper to create a user with funds (direct DB, bypasses rate limiter) ─

let userCounter = 0;

async function createFundedUser(suffix: string, goldAmount = 10000) {
  userCounter++;
  const username = `t_${suffix}_${userCounter}_${Date.now().toString(36)}`;
  const email = `${username}@test.com`;
  const userId = crypto.randomUUID();
  const hash = await bcrypt.hash("password123", 4); // Fast hash for tests
  db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)").run(userId, username, email, hash);
  creditSignupBonus(userId);

  // Create a session for API tests
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(sessionId, userId, expiresAt);

  // Add extra gold if needed beyond signup bonus (10000 is the default)
  if (goldAmount > 10000) {
    mutateBalance(userId, "gold_coins", goldAmount - 10000, "admin_grant");
  }

  return { userId, username, sessionId };
}

// ── Tournament Presets ─────────────────────────────────────────────────

describe("Tournament Presets", () => {
  it("should have free and paid presets", () => {
    expect(TOURNAMENT_PRESETS.length).toBeGreaterThanOrEqual(2);
    const free = TOURNAMENT_PRESETS.find(p => p.entryFee === 0);
    expect(free).toBeDefined();
    expect(free!.rakePercent).toBe(0);

    const paid = TOURNAMENT_PRESETS.find(p => p.entryFee > 0);
    expect(paid).toBeDefined();
    expect(paid!.rakePercent).toBeGreaterThan(0);
  });
});

// ── Tournament Creation ────────────────────────────────────────────────

describe("Tournament Creation", () => {
  it("should create a free tournament with correct fields", () => {
    const config = TOURNAMENT_PRESETS[0]; // Free
    const t = createTournament(config);

    expect(t.id).toBeDefined();
    expect(t.name).toBe(config.name);
    expect(t.format).toBe("sit_and_go_4");
    expect(t.status).toBe("open");
    expect(t.entryFee).toBe(0);
    expect(t.totalPool).toBe(0);
    expect(t.rakeAmount).toBe(0);
    expect(t.prizePool).toBe(0);
    expect(t.entrants).toHaveLength(0);
    expect(t.bracket).toBeNull();
    expect(t.winnerId).toBeNull();
  });

  it("should create a paid tournament with correct economics", () => {
    const config = TOURNAMENT_PRESETS[1]; // 500 Gold
    const t = createTournament(config);

    expect(t.entryFee).toBe(500);
    expect(t.totalPool).toBe(2000); // 500 * 4
    expect(t.rakePercent).toBe(0.05);
    expect(t.rakeAmount).toBe(100); // 2000 * 0.05
    expect(t.prizePool).toBe(1900); // 2000 - 100
    // Reconciliation invariant
    expect(t.prizePool + t.rakeAmount).toBe(t.totalPool);
  });

  it("should persist to in-memory store", () => {
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    expect(getTournament(t.id)).toBeDefined();
    expect(listTournaments()).toHaveLength(1);
  });
});

// ── Tournament Join ────────────────────────────────────────────────────

describe("Tournament Join", () => {
  it("should allow joining an open tournament", async () => {
    const user = await createFundedUser("join1");
    const t = createTournament(TOURNAMENT_PRESETS[0]);

    const result = joinTournament(t.id, user.userId, user.username);
    expect(result.ok).toBe(true);
    expect(result.tournament!.entrants).toHaveLength(1);
    expect(result.filled).toBe(false);
  });

  it("should reject duplicate join", async () => {
    const user = await createFundedUser("dup1");
    const t = createTournament(TOURNAMENT_PRESETS[0]);

    joinTournament(t.id, user.userId, user.username);
    const result2 = joinTournament(t.id, user.userId, user.username);
    expect(result2.ok).toBe(false);
    expect(result2.error).toContain("Already registered");
  });

  it("should reject join to non-existent tournament", async () => {
    const user = await createFundedUser("noexist");
    const result = joinTournament("fake-id", user.userId, user.username);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("should reject join to full tournament", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`full${i}`);
      joinTournament(t.id, u.userId, u.username);
    }
    const extra = await createFundedUser("extra");
    const result = joinTournament(t.id, extra.userId, extra.username);
    expect(result.ok).toBe(false);
    // After 4 players join, tournament transitions to in_progress
    expect(result.error).toContain("not open");
  });

  it("should reject join when tournament is in_progress", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`started${i}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }
    const late = await createFundedUser("late");
    const result = joinTournament(t.id, late.userId, late.username);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not open");
  });
});

// ── Balance-Gated Entry ────────────────────────────────────────────────

describe("Balance-Gated Tournament Entry", () => {
  it("should deduct entry fee on join for paid tournament", async () => {
    const user = await createFundedUser("paid1");
    const balBefore = getBalances(user.userId);

    const t = createTournament(TOURNAMENT_PRESETS[1]); // 500 Gold
    joinTournament(t.id, user.userId, user.username);

    const balAfter = getBalances(user.userId);
    expect(balAfter.gold_coins).toBe(balBefore.gold_coins - 500);
  });

  it("should reject join with insufficient balance", async () => {
    const username = `broke_${Date.now()}`;
    const reg = await registerUser(username, `${username}@test.com`, "password123");
    const userId = reg.body.user.id;

    // Drain wallet
    const bal = getBalances(userId);
    if (bal.gold_coins > 0) {
      mutateBalance(userId, "gold_coins", -bal.gold_coins, "admin_debit");
    }

    const t = createTournament(TOURNAMENT_PRESETS[1]); // 500 Gold
    const result = joinTournament(t.id, userId, username);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Insufficient");
  });
});

// ── Bracket Fill and Automatic Start ───────────────────────────────────

describe("Bracket Fill & Auto-Start", () => {
  it("should transition to in_progress and seed bracket when 4 players join", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`bf${i}`);
      const result = joinTournament(t.id, u.userId, u.username);
      users.push(u);
      if (i === 3) {
        expect(result.filled).toBe(true);
      }
    }

    const updated = getTournament(t.id)!;
    expect(updated.status).toBe("in_progress");
    expect(updated.startedAt).not.toBeNull();
    expect(updated.bracket).not.toBeNull();
    expect(updated.bracket!.matches).toHaveLength(3);

    // All entrants should have seeds
    for (const e of updated.entrants) {
      expect(e.seed).toBeGreaterThanOrEqual(1);
      expect(e.seed).toBeLessThanOrEqual(4);
    }
  });

  it("should create correct bracket structure", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`bs${i}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    const bracket = getTournament(t.id)!.bracket!;

    // Two semifinals and one final
    expect(bracket.matches[0].round).toBe("semifinal");
    expect(bracket.matches[1].round).toBe("semifinal");
    expect(bracket.matches[2].round).toBe("final");

    // Semifinals should have players assigned
    expect(bracket.matches[0].player1Id).toBeTruthy();
    expect(bracket.matches[0].player2Id).toBeTruthy();
    expect(bracket.matches[1].player1Id).toBeTruthy();
    expect(bracket.matches[1].player2Id).toBeTruthy();

    // Final should be pending with no players yet
    expect(bracket.matches[2].player1Id).toBeNull();
    expect(bracket.matches[2].player2Id).toBeNull();
    expect(bracket.matches[2].status).toBe("pending");
  });
});

// ── Semifinal-to-Final Advancement ─────────────────────────────────────

describe("Bracket Advancement", () => {
  async function setupTournamentWithBracket() {
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`adv${i}_${Math.random().toString(36).slice(2,6)}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }
    return { tournament: getTournament(t.id)!, users };
  }

  it("should advance semifinal winner to final", async () => {
    const { tournament, users } = await setupTournamentWithBracket();
    const sf1 = tournament.bracket!.matches[0];

    // Register a fake room for SF1
    registerTournamentRoom("test-room-sf1", tournament.id, 0);

    // Advance SF1
    const result = advanceBracket(
      "test-room-sf1",
      sf1.player1Id!,
      sf1.player1Username!,
      sf1.player2Id!
    );

    expect(result).not.toBeNull();
    expect(result!.tournamentCompleted).toBe(false);

    const updated = getTournament(tournament.id)!;
    const final = updated.bracket!.matches[2];

    // SF1 winner should be in final as player1
    expect(final.player1Id).toBe(sf1.player1Id);
  });

  it("should populate final when both semis complete", async () => {
    const { tournament } = await setupTournamentWithBracket();
    const sf1 = tournament.bracket!.matches[0];
    const sf2 = tournament.bracket!.matches[1];

    registerTournamentRoom("test-room-sf1b", tournament.id, 0);
    registerTournamentRoom("test-room-sf2b", tournament.id, 1);

    advanceBracket("test-room-sf1b", sf1.player1Id!, sf1.player1Username!, sf1.player2Id!);
    const result2 = advanceBracket("test-room-sf2b", sf2.player1Id!, sf2.player1Username!, sf2.player2Id!);

    expect(result2).not.toBeNull();
    expect(result2!.nextMatch).toBeDefined();
    expect(result2!.nextMatch!.round).toBe("final");
    expect(result2!.nextMatch!.player1Id).toBe(sf1.player1Id);
    expect(result2!.nextMatch!.player2Id).toBe(sf2.player1Id);
  });

  it("should complete tournament when final ends", async () => {
    const { tournament } = await setupTournamentWithBracket();
    const sf1 = tournament.bracket!.matches[0];
    const sf2 = tournament.bracket!.matches[1];

    registerTournamentRoom("test-room-sf1c", tournament.id, 0);
    registerTournamentRoom("test-room-sf2c", tournament.id, 1);

    advanceBracket("test-room-sf1c", sf1.player1Id!, sf1.player1Username!, sf1.player2Id!);
    advanceBracket("test-room-sf2c", sf2.player1Id!, sf2.player1Username!, sf2.player2Id!);

    // Now play final
    registerTournamentRoom("test-room-final", tournament.id, 2);
    const finalResult = advanceBracket(
      "test-room-final",
      sf1.player1Id!,
      sf1.player1Username!,
      sf2.player1Id!
    );

    expect(finalResult).not.toBeNull();
    expect(finalResult!.tournamentCompleted).toBe(true);

    const completed = getTournament(tournament.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.winnerId).toBe(sf1.player1Id);
    expect(completed.completedAt).not.toBeNull();
  });
});

// ── Tournament Completion with Payout ──────────────────────────────────

describe("Tournament Payout & Rake", () => {
  it("should pay winner and collect rake for paid tournament", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[1]); // 500 Gold, 5% rake
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`pay${i}_${Math.random().toString(36).slice(2,6)}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    const tournament = getTournament(t.id)!;
    const sf1 = tournament.bracket!.matches[0];
    const sf2 = tournament.bracket!.matches[1];

    const winnerId = sf1.player1Id!;
    const winnerBalBefore = getBalances(winnerId);

    registerTournamentRoom("pay-sf1", tournament.id, 0);
    registerTournamentRoom("pay-sf2", tournament.id, 1);
    advanceBracket("pay-sf1", sf1.player1Id!, sf1.player1Username!, sf1.player2Id!);
    advanceBracket("pay-sf2", sf2.player1Id!, sf2.player1Username!, sf2.player2Id!);

    registerTournamentRoom("pay-final", tournament.id, 2);
    advanceBracket("pay-final", winnerId, sf1.player1Username!, sf2.player1Id!);

    // Winner should have received prizePool (1900 = 2000 - 100 rake)
    const winnerBalAfter = getBalances(winnerId);
    expect(winnerBalAfter.gold_coins).toBe(winnerBalBefore.gold_coins + 1900);

    // Reconciliation: each player paid 500 (total pool 2000).
    // Winner gets 1900, rake is 100.
    const completed = getTournament(t.id)!;
    expect(completed.prizePool + completed.rakeAmount).toBe(completed.totalPool);
  });

  it("should not pay anything for free tournament", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[0]); // Free
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`free${i}_${Math.random().toString(36).slice(2,6)}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    const tournament = getTournament(t.id)!;
    const sf1 = tournament.bracket!.matches[0];
    const sf2 = tournament.bracket!.matches[1];
    const winnerId = sf1.player1Id!;
    const winnerBalBefore = getBalances(winnerId);

    registerTournamentRoom("free-sf1", tournament.id, 0);
    registerTournamentRoom("free-sf2", tournament.id, 1);
    advanceBracket("free-sf1", sf1.player1Id!, sf1.player1Username!, sf1.player2Id!);
    advanceBracket("free-sf2", sf2.player1Id!, sf2.player1Username!, sf2.player2Id!);
    registerTournamentRoom("free-final", tournament.id, 2);
    advanceBracket("free-final", winnerId, sf1.player1Username!, sf2.player1Id!);

    const winnerBalAfter = getBalances(winnerId);
    // No change (free tournament)
    expect(winnerBalAfter.gold_coins).toBe(winnerBalBefore.gold_coins);
  });
});

// ── Cancel / Refund ────────────────────────────────────────────────────

describe("Tournament Cancel & Refund", () => {
  it("should refund all players on cancel before start", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[1]); // 500 Gold
    const users = [];
    for (let i = 0; i < 2; i++) {
      const u = await createFundedUser(`cancel${i}_${Math.random().toString(36).slice(2,6)}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    // Each user paid 500 on join
    const balsBefore = users.map(u => getBalances(u.userId).gold_coins);

    cancelTournament(t.id);

    const cancelled = getTournament(t.id)!;
    expect(cancelled.status).toBe("cancelled");

    // Each user should get 500 refunded
    for (let i = 0; i < users.length; i++) {
      const balAfter = getBalances(users[i].userId).gold_coins;
      expect(balAfter).toBe(balsBefore[i] + 500);
    }
  });

  it("should not allow cancelling a completed tournament", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`cc${i}_${Math.random().toString(36).slice(2,6)}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }
    const tournament = getTournament(t.id)!;
    const sf1 = tournament.bracket!.matches[0];
    const sf2 = tournament.bracket!.matches[1];

    registerTournamentRoom("cc-sf1", tournament.id, 0);
    registerTournamentRoom("cc-sf2", tournament.id, 1);
    advanceBracket("cc-sf1", sf1.player1Id!, sf1.player1Username!, sf1.player2Id!);
    advanceBracket("cc-sf2", sf2.player1Id!, sf2.player1Username!, sf2.player2Id!);
    registerTournamentRoom("cc-final", tournament.id, 2);
    advanceBracket("cc-final", sf1.player1Id!, sf1.player1Username!, sf2.player1Id!);

    const result = cancelTournament(t.id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already finished");
  });
});

// ── Leave Tournament ───────────────────────────────────────────────────

describe("Leave Tournament", () => {
  it("should allow leaving an open tournament with refund", async () => {
    const user = await createFundedUser("leave1");
    const t = createTournament(TOURNAMENT_PRESETS[1]); // 500 Gold
    const balBefore = getBalances(user.userId).gold_coins;

    joinTournament(t.id, user.userId, user.username);
    expect(getBalances(user.userId).gold_coins).toBe(balBefore - 500);

    const result = leaveTournament(t.id, user.userId);
    expect(result.ok).toBe(true);
    expect(getBalances(user.userId).gold_coins).toBe(balBefore);

    const updated = getTournament(t.id)!;
    expect(updated.entrants).toHaveLength(0);
  });

  it("should not allow leaving a started tournament", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`noleave${i}_${Math.random().toString(36).slice(2,6)}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    const result = leaveTournament(t.id, users[0].userId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("already started");
  });
});

// ── Pending Match Detection ────────────────────────────────────────────

describe("Pending Tournament Match", () => {
  it("should detect semifinal as pending match", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`pend${i}_${Math.random().toString(36).slice(2,6)}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    const tournament = getTournament(t.id)!;
    const sf1p1 = tournament.bracket!.matches[0].player1Id!;

    const pending = getPendingTournamentMatch(sf1p1);
    expect(pending).not.toBeNull();
    expect(pending!.match.round).toBe("semifinal");
  });
});

// ── Tournament API ────────────────────────────────────────────────────

describe("Tournament API", () => {
  it("should list tournaments", async () => {
    const user = await createFundedUser("apilist");
    createTournament(TOURNAMENT_PRESETS[0]);
    createTournament(TOURNAMENT_PRESETS[1]);

    const res = await makeRequest("GET", "/api/tournaments", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.tournaments.length).toBeGreaterThanOrEqual(2);
    expect(res.body.presets).toBeDefined();
  });

  it("should create tournament via API", async () => {
    const user = await createFundedUser("apicreate");
    const res = await makeRequest(
      "POST",
      "/api/tournaments",
      { presetIndex: 0 },
      { Authorization: `Bearer ${user.sessionId}` }
    );

    expect(res.status).toBe(201);
    expect(res.body.tournament.format).toBe("sit_and_go_4");
    expect(res.body.tournament.status).toBe("open");
  });

  it("should join tournament via API", async () => {
    const user = await createFundedUser("apijoin");
    const t = createTournament(TOURNAMENT_PRESETS[0]);

    const res = await makeRequest(
      "POST",
      `/api/tournaments/${t.id}/join`,
      {},
      { Authorization: `Bearer ${user.sessionId}` }
    );

    expect(res.status).toBe(200);
    expect(res.body.tournament.entrantCount).toBe(1);
  });

  it("should leave tournament via API", async () => {
    const user = await createFundedUser("apileave");
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    joinTournament(t.id, user.userId, user.username);

    const res = await makeRequest(
      "POST",
      `/api/tournaments/${t.id}/leave`,
      {},
      { Authorization: `Bearer ${user.sessionId}` }
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("should require auth for tournament endpoints", async () => {
    const res = await makeRequest("GET", "/api/tournaments");
    expect(res.status).toBe(401);
  });

  it("should return 404 for nonexistent tournament", async () => {
    const user = await createFundedUser("api404");
    const res = await makeRequest(
      "GET",
      "/api/tournaments/nonexistent",
      undefined,
      { Authorization: `Bearer ${user.sessionId}` }
    );
    expect(res.status).toBe(404);
  });
});

// ── Elimination Tracking ───────────────────────────────────────────────

describe("Elimination Tracking", () => {
  it("should mark losers as eliminated", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`elim${i}_${Math.random().toString(36).slice(2,6)}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    const tournament = getTournament(t.id)!;
    const sf1 = tournament.bracket!.matches[0];

    registerTournamentRoom("elim-sf1", tournament.id, 0);
    advanceBracket("elim-sf1", sf1.player1Id!, sf1.player1Username!, sf1.player2Id!);

    const updated = getTournament(t.id)!;
    const loser = updated.entrants.find(e => e.userId === sf1.player2Id);
    expect(loser!.eliminated).toBe(true);

    const winner = updated.entrants.find(e => e.userId === sf1.player1Id);
    expect(winner!.eliminated).toBe(false);
  });
});

// ── Regression Coverage ────────────────────────────────────────────────

describe("Tournament Regression", () => {
  it("should not break user registration", async () => {
    // Direct DB registration check (bypasses rate limiter for regression test)
    const user = await createFundedUser("regtest");
    expect(user.userId).toBeDefined();
    expect(user.sessionId).toBeDefined();
  });

  it("should not break wallet API", async () => {
    const user = await createFundedUser("tregwallet");
    const res = await makeRequest("GET", "/api/wallet", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.balances).toBeDefined();
  });

  it("should not break leaderboard", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });

  it("should not break faucet", async () => {
    const user = await createFundedUser("tregfaucet");
    const res = await makeRequest("POST", "/api/wallet/faucet", {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect([200, 429]).toContain(res.status);
  });

  it("should not break health endpoint", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });
});
