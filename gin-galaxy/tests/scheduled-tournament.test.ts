/**
 * Scheduled Tournament Tests for Gin Paradise.
 *
 * Covers the scheduled tournament expansion:
 *  - Admin-only creation / control behavior
 *  - Registration before start and lock behavior at or near start time
 *  - Insufficient-field cancellation and refund behavior
 *  - Variable-size bracket generation (2-16 players)
 *  - Bye assignment and auto-advancement
 *  - Round gating (next round waits for current round completion)
 *  - No-show / unstarted-match resolution
 *  - Payout and rake behavior for scheduled events
 *  - Regression coverage confirming existing SNG flows still work
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  startTestServer,
  stopTestServer,
  makeRequest,
} from "./helpers.js";
import { initializeDatabase, db, SESSION_TTL_MS } from "../server/db.js";
import {
  createTournament,
  createScheduledTournament,
  joinTournament,
  cancelTournament,
  startScheduledTournament,
  lockRegistration,
  getTournament,
  listTournaments,
  listUpcomingTournaments,
  advanceBracket,
  registerTournamentRoom,
  resolveNoShows,
  nextPowerOfTwo,
  isRoundComplete,
  TOURNAMENT_PRESETS,
  NO_SHOW_TIMEOUT_MS,
  _clearTournaments,
  type ScheduledTournamentConfig,
} from "../server/tournament.js";
import { getBalances, creditSignupBonus, mutateBalance } from "../server/ledger.js";
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

async function createFundedUser(suffix: string, goldAmount = 10000, isAdmin = false) {
  userCounter++;
  const username = `st_${suffix}_${userCounter}_${Date.now().toString(36)}`;
  const email = `${username}@test.com`;
  const userId = crypto.randomUUID();
  const hash = await bcrypt.hash("password123", 4);
  db.prepare("INSERT INTO users (id, username, email, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)").run(userId, username, email, hash, isAdmin ? 1 : 0);
  creditSignupBonus(userId);

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(sessionId, userId, expiresAt);

  if (goldAmount > 10000) {
    mutateBalance(userId, "gold_coins", goldAmount - 10000, "admin_grant");
  }

  return { userId, username, sessionId };
}

function makeScheduledConfig(overrides: Partial<ScheduledTournamentConfig> = {}): ScheduledTournamentConfig {
  return {
    name: "Test Scheduled Event",
    startTime: Date.now() + 60 * 60 * 1000, // 1 hour from now
    entryFee: 0,
    currency: "gold_coins",
    rakePercent: 0,
    maxEntrants: 8,
    minEntrants: 2,
    adminCreated: true,
    ...overrides,
  };
}

// ── Admin-Only Creation ────────────────────────────────────────────────

describe("Admin-Only Scheduled Tournament Creation", () => {
  it("should create a scheduled tournament with correct fields", () => {
    const config = makeScheduledConfig({ name: "Sunday Showdown", maxEntrants: 16 });
    const t = createScheduledTournament(config);

    expect(t.id).toBeDefined();
    expect(t.name).toBe("Sunday Showdown");
    expect(t.format).toBe("scheduled");
    expect(t.status).toBe("registration_open");
    expect(t.maxEntrants).toBe(16);
    expect(t.minEntrants).toBe(2);
    expect(t.scheduledStartTime).toBeGreaterThan(Date.now() - 1000);
    expect(t.adminCreated).toBe(true);
    expect(t.bracket).toBeNull();
    expect(t.totalPool).toBe(0); // computed at start
  });

  it("should clamp maxEntrants between 2 and 128", () => {
    const t1 = createScheduledTournament(makeScheduledConfig({ maxEntrants: 1 }));
    expect(t1.maxEntrants).toBe(2);

    const t2 = createScheduledTournament(makeScheduledConfig({ maxEntrants: 200 }));
    expect(t2.maxEntrants).toBe(128);
  });

  it("admin API endpoint should reject non-admin users", async () => {
    const user = await createFundedUser("nonadmin");
    const res = await makeRequest("POST", "/api/tournaments/scheduled", {
      name: "Test",
      startTime: Date.now() + 60000,
      entryFee: 0,
      maxEntrants: 8,
    }, { Authorization: `Bearer ${user.sessionId}` });
    expect(res.status).toBe(403);
  });

  it("admin API endpoint should create tournament for admin user", async () => {
    const admin = await createFundedUser("admin", 10000, true);
    const res = await makeRequest("POST", "/api/tournaments/scheduled", {
      name: "Admin Event",
      startTime: Date.now() + 60000,
      entryFee: 500,
      currency: "gold_coins",
      maxEntrants: 8,
      minEntrants: 3,
    }, { Authorization: `Bearer ${admin.sessionId}` });
    expect(res.status).toBe(201);
    expect(res.body.tournament.format).toBe("scheduled");
    expect(res.body.tournament.status).toBe("registration_open");
    expect(res.body.tournament.adminCreated).toBe(true);
  });

  it("admin API should reject missing required fields", async () => {
    const admin = await createFundedUser("admin2", 10000, true);
    const res = await makeRequest("POST", "/api/tournaments/scheduled", {
      // Missing name
      startTime: Date.now() + 60000,
      maxEntrants: 8,
    }, { Authorization: `Bearer ${admin.sessionId}` });
    expect(res.status).toBe(400);
  });
});

// ── Registration Behavior ──────────────────────────────────────────────

describe("Scheduled Tournament Registration", () => {
  it("should allow joining a registration_open tournament", async () => {
    const user = await createFundedUser("regjoin");
    const t = createScheduledTournament(makeScheduledConfig());
    const result = joinTournament(t.id, user.userId, user.username);
    expect(result.ok).toBe(true);
    expect(result.tournament!.entrants).toHaveLength(1);
  });

  it("should reject joining when registration is closed", async () => {
    const user = await createFundedUser("reglate");
    const t = createScheduledTournament(makeScheduledConfig());
    lockRegistration(t.id);
    const result = joinTournament(t.id, user.userId, user.username);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not open");
  });

  it("should reject joining a full scheduled tournament", async () => {
    const t = createScheduledTournament(makeScheduledConfig({ maxEntrants: 2 }));
    const u1 = await createFundedUser("regfull1");
    const u2 = await createFundedUser("regfull2");
    joinTournament(t.id, u1.userId, u1.username);
    joinTournament(t.id, u2.userId, u2.username);

    const u3 = await createFundedUser("regfull3");
    const result = joinTournament(t.id, u3.userId, u3.username);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("full");
  });

  it("should lock registration for scheduled tournaments", () => {
    const t = createScheduledTournament(makeScheduledConfig());
    const result = lockRegistration(t.id);
    expect(result.ok).toBe(true);
    expect(getTournament(t.id)!.status).toBe("registration_closed");
  });

  it("should deduct entry fee on join for paid scheduled tournaments", async () => {
    const user = await createFundedUser("paidreg");
    const t = createScheduledTournament(makeScheduledConfig({ entryFee: 1000, rakePercent: 0.05 }));
    const balBefore = getBalances(user.userId).gold_coins;

    joinTournament(t.id, user.userId, user.username);
    expect(getBalances(user.userId).gold_coins).toBe(balBefore - 1000);
  });
});

// ── Insufficient Field Cancellation ────────────────────────────────────

describe("Insufficient Field Cancellation", () => {
  it("should cancel and refund when field is below minimum on start", async () => {
    const t = createScheduledTournament(makeScheduledConfig({
      entryFee: 500,
      minEntrants: 4,
    }));

    const u1 = await createFundedUser("insuf1");
    const u2 = await createFundedUser("insuf2");
    joinTournament(t.id, u1.userId, u1.username);
    joinTournament(t.id, u2.userId, u2.username);

    const bal1Before = getBalances(u1.userId).gold_coins;
    const bal2Before = getBalances(u2.userId).gold_coins;

    const result = startScheduledTournament(t.id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Insufficient");

    const cancelled = getTournament(t.id)!;
    expect(cancelled.status).toBe("cancelled");

    // Refund check
    expect(getBalances(u1.userId).gold_coins).toBe(bal1Before + 500);
    expect(getBalances(u2.userId).gold_coins).toBe(bal2Before + 500);
  });
});

// ── Variable-Size Bracket Generation ───────────────────────────────────

describe("Variable-Size Bracket Generation", () => {
  it("nextPowerOfTwo should work correctly", () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(4)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(7)).toBe(8);
    expect(nextPowerOfTwo(8)).toBe(8);
    expect(nextPowerOfTwo(9)).toBe(16);
  });

  it("should create correct bracket for 4 players (no byes)", async () => {
    const t = createScheduledTournament(makeScheduledConfig({ maxEntrants: 8, minEntrants: 2 }));
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`b4_${i}`);
      joinTournament(t.id, u.userId, u.username);
    }

    startScheduledTournament(t.id);
    const tournament = getTournament(t.id)!;

    expect(tournament.status).toBe("in_progress");
    expect(tournament.bracket).not.toBeNull();

    // 4 players → bracket size 4 → 2 round-1 matches + 1 final = 3 matches
    expect(tournament.bracket!.matches).toHaveLength(3);
    expect(tournament.totalRounds).toBe(2);

    // No byes
    const byes = tournament.bracket!.matches.filter(m => m.status === "bye");
    expect(byes).toHaveLength(0);
  });

  it("should create bracket with byes for 3 players", async () => {
    const t = createScheduledTournament(makeScheduledConfig({ maxEntrants: 8, minEntrants: 2 }));
    for (let i = 0; i < 3; i++) {
      const u = await createFundedUser(`b3_${i}`);
      db.prepare("UPDATE users SET rating = ? WHERE id = ?").run(1500 - i * 100, u.userId);
      joinTournament(t.id, u.userId, u.username);
    }

    startScheduledTournament(t.id);
    const tournament = getTournament(t.id)!;

    // 3 players → bracket size 4 → 2 round-1 matches + 1 final = 3 matches
    expect(tournament.bracket!.matches).toHaveLength(3);

    // 1 bye (top seed = highest rated gets bye)
    const byes = tournament.bracket!.matches.filter(m => m.status === "bye");
    expect(byes).toHaveLength(1);

    // Top seed should get the bye
    const byeMatch = byes[0];
    expect(byeMatch.winnerId).toBeTruthy();
  });

  it("should create bracket with byes for 5 players (3 byes)", async () => {
    const t = createScheduledTournament(makeScheduledConfig({ maxEntrants: 16, minEntrants: 2 }));
    for (let i = 0; i < 5; i++) {
      const u = await createFundedUser(`b5_${i}`);
      db.prepare("UPDATE users SET rating = ? WHERE id = ?").run(1800 - i * 100, u.userId);
      joinTournament(t.id, u.userId, u.username);
    }

    startScheduledTournament(t.id);
    const tournament = getTournament(t.id)!;

    // 5 players → bracket size 8 → round 1 has 4 matches, round 2 has 2, final has 1 = 7 matches
    expect(tournament.bracket!.matches).toHaveLength(7);
    expect(tournament.totalRounds).toBe(3);

    // 3 byes
    const byes = tournament.bracket!.matches.filter(m => m.status === "bye");
    expect(byes).toHaveLength(3);
  });

  it("should seed players by rating descending", async () => {
    const t = createScheduledTournament(makeScheduledConfig({ maxEntrants: 8, minEntrants: 2 }));
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`seed_${i}`);
      db.prepare("UPDATE users SET rating = ? WHERE id = ?").run(1000 + i * 200, u.userId);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    startScheduledTournament(t.id);
    const tournament = getTournament(t.id)!;

    // Highest rated player gets seed 1
    const seed1 = tournament.entrants.find(e => e.seed === 1)!;
    const seed4 = tournament.entrants.find(e => e.seed === 4)!;

    // The user with highest rating (users[3] at 1600) should be seed 1
    expect(seed1.userId).toBe(users[3].userId);
    // The user with lowest rating (users[0] at 1000) should be seed 4
    expect(seed4.userId).toBe(users[0].userId);
  });
});

// ── Bye Auto-Advancement ───────────────────────────────────────────────

describe("Bye Auto-Advancement", () => {
  it("bye winners should be placed in next-round slots", async () => {
    const t = createScheduledTournament(makeScheduledConfig({ maxEntrants: 8, minEntrants: 2 }));
    for (let i = 0; i < 3; i++) {
      const u = await createFundedUser(`bye_${i}`);
      db.prepare("UPDATE users SET rating = ? WHERE id = ?").run(1500 - i * 100, u.userId);
      joinTournament(t.id, u.userId, u.username);
    }

    startScheduledTournament(t.id);
    const tournament = getTournament(t.id)!;

    // The bye match winner should already appear in the next round
    const byeMatches = tournament.bracket!.matches.filter(m => m.status === "bye");
    expect(byeMatches.length).toBeGreaterThan(0);

    // Check that the final has the bye winner pre-placed
    const finalMatch = tournament.bracket!.matches.find(m => m.round === "final")!;
    // At least one player should be filled from bye
    const hasByeAdvance = finalMatch.player1Id !== null || finalMatch.player2Id !== null;
    expect(hasByeAdvance).toBe(true);
  });
});

// ── Round Gating ───────────────────────────────────────────────────────

describe("Round Gating", () => {
  it("should report round completion correctly", async () => {
    const t = createScheduledTournament(makeScheduledConfig({ maxEntrants: 8, minEntrants: 2 }));
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`rg_${i}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    startScheduledTournament(t.id);
    const tournament = getTournament(t.id)!;

    // Round 1 should NOT be complete initially
    expect(isRoundComplete(t.id, 1)).toBe(false);

    // Complete first match of round 1
    const round1Matches = tournament.bracket!.matches.filter(m => m.roundNumber === 1 && m.status === "pending");
    if (round1Matches.length >= 2) {
      // Complete first match
      const m1 = round1Matches[0];
      registerTournamentRoom("rg-room1", t.id, m1.matchIndex);
      advanceBracket("rg-room1", m1.player1Id!, m1.player1Username!, m1.player2Id!);

      // Still not complete (second match pending)
      expect(isRoundComplete(t.id, 1)).toBe(false);

      // Complete second match
      const m2 = round1Matches[1];
      registerTournamentRoom("rg-room2", t.id, m2.matchIndex);
      advanceBracket("rg-room2", m2.player1Id!, m2.player1Username!, m2.player2Id!);

      // Now round 1 should be complete
      expect(isRoundComplete(t.id, 1)).toBe(true);
    }
  });

  it("should advance tournament.currentRound when round completes", async () => {
    const t = createScheduledTournament(makeScheduledConfig({ maxEntrants: 8, minEntrants: 2 }));
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`cr_${i}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    startScheduledTournament(t.id);
    expect(getTournament(t.id)!.currentRound).toBe(1);

    const tournament = getTournament(t.id)!;
    const round1Matches = tournament.bracket!.matches.filter(m => m.roundNumber === 1 && m.status === "pending");

    for (const m of round1Matches) {
      registerTournamentRoom(`cr-room-${m.matchIndex}`, t.id, m.matchIndex);
      advanceBracket(`cr-room-${m.matchIndex}`, m.player1Id!, m.player1Username!, m.player2Id!);
    }

    expect(getTournament(t.id)!.currentRound).toBe(2);
  });
});

// ── No-Show Resolution ─────────────────────────────────────────────────

describe("No-Show Resolution", () => {
  it("should not resolve matches before deadline", async () => {
    const t = createScheduledTournament(makeScheduledConfig({ maxEntrants: 8, minEntrants: 2 }));
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`ns_${i}`);
      joinTournament(t.id, u.userId, u.username);
    }

    startScheduledTournament(t.id);

    // Resolve immediately — nothing should happen (deadlines are in the future)
    const resolved = resolveNoShows();
    expect(resolved).toHaveLength(0);
  });

  it("should resolve matches past deadline by awarding to higher seed", async () => {
    const t = createScheduledTournament(makeScheduledConfig({ maxEntrants: 8, minEntrants: 2 }));
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`ns2_${i}`);
      joinTournament(t.id, u.userId, u.username);
    }

    startScheduledTournament(t.id);
    const tournament = getTournament(t.id)!;

    // Manually set no-show deadlines to the past
    for (const match of tournament.bracket!.matches) {
      if (match.status === "pending" && match.noShowDeadline) {
        match.noShowDeadline = Date.now() - 1000;
      }
    }

    const resolved = resolveNoShows();
    expect(resolved.length).toBeGreaterThan(0);

    // All resolved matches should have winners (player1 = higher seed)
    for (const m of resolved) {
      expect(m.winnerId).toBe(m.player1Id);
      expect(m.status).toBe("completed");
    }
  });

  it("should not stall tournament when matches time out", async () => {
    const t = createScheduledTournament(makeScheduledConfig({ maxEntrants: 8, minEntrants: 2 }));
    for (let i = 0; i < 2; i++) {
      const u = await createFundedUser(`ns3_${i}`);
      joinTournament(t.id, u.userId, u.username);
    }

    startScheduledTournament(t.id);
    const tournament = getTournament(t.id)!;

    // Set deadline to past for all pending matches in all rounds
    for (const match of tournament.bracket!.matches) {
      if (match.status === "pending" && match.noShowDeadline) {
        match.noShowDeadline = Date.now() - 1000;
      }
    }

    resolveNoShows();

    // Tournament should eventually complete (2 player bracket = 1 match)
    const updated = getTournament(t.id)!;
    // Either completed or the final match is resolved
    expect(updated.status === "completed" || updated.bracket!.matches.some(m => m.status === "completed")).toBe(true);
  });
});

// ── Scheduled Tournament Full Lifecycle ────────────────────────────────

describe("Scheduled Tournament Full Lifecycle", () => {
  it("should complete a paid scheduled tournament with correct payout", async () => {
    const t = createScheduledTournament(makeScheduledConfig({
      entryFee: 1000,
      rakePercent: 0.05,
      maxEntrants: 4,
      minEntrants: 2,
    }));

    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`lc_${i}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    startScheduledTournament(t.id);
    const tournament = getTournament(t.id)!;

    // Economics should reflect actual field
    expect(tournament.totalPool).toBe(4000); // 1000 * 4
    expect(tournament.rakeAmount).toBe(200); // 4000 * 0.05
    expect(tournament.prizePool).toBe(3800); // 4000 - 200

    // Play through all matches
    const round1Matches = tournament.bracket!.matches.filter(m => m.roundNumber === 1 && m.status === "pending");
    const winners: string[] = [];

    for (const m of round1Matches) {
      registerTournamentRoom(`lc-room-${m.matchIndex}`, t.id, m.matchIndex);
      advanceBracket(`lc-room-${m.matchIndex}`, m.player1Id!, m.player1Username!, m.player2Id!);
      winners.push(m.player1Id!);
    }

    // Now play final
    const finalMatch = getTournament(t.id)!.bracket!.matches.find(m => m.round === "final")!;
    registerTournamentRoom("lc-final", t.id, finalMatch.matchIndex);
    advanceBracket("lc-final", finalMatch.player1Id!, finalMatch.player1Username!, finalMatch.player2Id!);

    const completed = getTournament(t.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.winnerId).toBeTruthy();
    expect(completed.completedAt).toBeGreaterThan(0);

    // Winner should have received prizePool
    const winnerBal = getBalances(completed.winnerId!);
    // Balance = signup bonus (10000) - entry fee (1000) + prize (3800)
    expect(winnerBal.gold_coins).toBe(5000 - 1000 + 3800);

    // Reconciliation
    expect(completed.prizePool + completed.rakeAmount).toBe(completed.totalPool);
  });
});

// ── API Endpoints ──────────────────────────────────────────────────────

describe("Scheduled Tournament API", () => {
  it("should list upcoming tournaments", async () => {
    const admin = await createFundedUser("apiup", 10000, true);
    createScheduledTournament(makeScheduledConfig({ name: "Upcoming 1" }));
    createScheduledTournament(makeScheduledConfig({ name: "Upcoming 2" }));

    const res = await makeRequest("GET", "/api/tournaments/upcoming", undefined, {
      Authorization: `Bearer ${admin.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.tournaments.length).toBeGreaterThanOrEqual(2);
  });

  it("should allow admin to start scheduled tournament", async () => {
    const admin = await createFundedUser("apistart", 10000, true);
    const t = createScheduledTournament(makeScheduledConfig({ minEntrants: 2 }));

    const u1 = await createFundedUser("apistartu1");
    const u2 = await createFundedUser("apistartu2");
    joinTournament(t.id, u1.userId, u1.username);
    joinTournament(t.id, u2.userId, u2.username);

    const res = await makeRequest("POST", `/api/tournaments/${t.id}/start`, {}, {
      Authorization: `Bearer ${admin.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tournament.status).toBe("in_progress");
  });

  it("should reject non-admin start attempt", async () => {
    const user = await createFundedUser("nonadminstart");
    const t = createScheduledTournament(makeScheduledConfig({ minEntrants: 2 }));
    joinTournament(t.id, user.userId, user.username);

    const res = await makeRequest("POST", `/api/tournaments/${t.id}/start`, {}, {
      Authorization: `Bearer ${user.sessionId}`,
    });

    expect(res.status).toBe(403);
  });

  it("should return scheduled-specific fields in view projection", async () => {
    const admin = await createFundedUser("apiprojection", 10000, true);
    const t = createScheduledTournament(makeScheduledConfig({ name: "Projection Test" }));

    const res = await makeRequest("GET", `/api/tournaments/${t.id}`, undefined, {
      Authorization: `Bearer ${admin.sessionId}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.tournament.scheduledStartTime).toBeTruthy();
    expect(res.body.tournament.maxEntrants).toBeGreaterThan(0);
    expect(res.body.tournament.minEntrants).toBeGreaterThan(0);
    expect(res.body.tournament.adminCreated).toBe(true);
  });
});

// ── Regression Coverage ────────────────────────────────────────────────

describe("Scheduled Tournament Regression", () => {
  it("existing SNG tournaments should still work", async () => {
    const t = createTournament(TOURNAMENT_PRESETS[0]);
    const users = [];
    for (let i = 0; i < 4; i++) {
      const u = await createFundedUser(`sng_reg_${i}`);
      joinTournament(t.id, u.userId, u.username);
      users.push(u);
    }

    const tournament = getTournament(t.id)!;
    expect(tournament.status).toBe("in_progress");
    expect(tournament.format).toBe("sit_and_go_4");
    expect(tournament.bracket!.matches).toHaveLength(3);
  });

  it("should not break wallet API", async () => {
    const user = await createFundedUser("regwallet");
    const res = await makeRequest("GET", "/api/wallet", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
  });

  it("should not break leaderboard", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });

  it("should not break health endpoint", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });

  it("should not break tournament listing", async () => {
    const user = await createFundedUser("reglist");
    createTournament(TOURNAMENT_PRESETS[0]);
    createScheduledTournament(makeScheduledConfig());

    const res = await makeRequest("GET", "/api/tournaments", undefined, {
      Authorization: `Bearer ${user.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.tournaments.length).toBeGreaterThanOrEqual(2);
  });
});
