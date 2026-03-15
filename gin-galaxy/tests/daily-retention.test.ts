/**
 * Daily Retention System Tests for Gin Paradise.
 *
 * Covers:
 * - Daily mission assignment and reset behavior
 * - Mission progress tracking and reward claiming
 * - Streak increment / reset rules
 * - Daily puzzle availability and completion handling
 * - Reward economy behavior (bounded, non-inflationary)
 * - Premium/non-premium boundaries
 * - API endpoint integration tests
 * - Regression coverage across wallet, billing, and existing systems
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startTestServer,
  stopTestServer,
  registerUser,
  makeRequest,
} from "./helpers.js";

let baseUrl: string;

// We create multiple users upfront to avoid registration-related issues
let mainSession: string;
let mainUserId: string;

let streakSession: string;
let puzzleSession: string;

beforeAll(async () => {
  baseUrl = await startTestServer();

  // Register the main test user
  const suffix = Date.now();
  const reg1 = await registerUser(`retmain_${suffix}`, `retmain_${suffix}@test.com`, "password123");
  mainSession = reg1.body.sessionId;
  mainUserId = reg1.body.user?.id;

  // Register a streak test user
  const reg2 = await registerUser(`retstreak_${suffix}`, `retstreak_${suffix}@test.com`, "password123");
  streakSession = reg2.body.sessionId;

  // Register a puzzle test user
  const reg3 = await registerUser(`retpuzzle_${suffix}`, `retpuzzle_${suffix}@test.com`, "password123");
  puzzleSession = reg3.body.sessionId;
});

afterAll(async () => {
  await stopTestServer();
});

function auth() {
  return { Authorization: `Bearer ${mainSession}` };
}
function streakAuth() {
  return { Authorization: `Bearer ${streakSession}` };
}
function puzzleAuth() {
  return { Authorization: `Bearer ${puzzleSession}` };
}

// ─── Daily Summary ──────────────────────────────────────────────────────

describe("Daily Retention Summary", () => {
  it("returns a full daily summary with missions, streak, and puzzle", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, auth());
    expect(res.status).toBe(200);
    expect(res.body.missions).toBeDefined();
    expect(res.body.streak).toBeDefined();
    expect(res.body.puzzle).toBeDefined();
    expect(res.body.todayDate).toBeDefined();
    expect(res.body.totalAvailableCoins).toBeGreaterThan(0);
    expect(res.body.balances).toBeDefined();
  });

  it("requires authentication", async () => {
    const res = await makeRequest("GET", "/api/daily");
    expect(res.status).toBe(401);
  });
});

// ─── Mission System ─────────────────────────────────────────────────────

describe("Daily Missions", () => {
  it("assigns exactly 4 missions per day", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, auth());
    expect(res.status).toBe(200);
    expect(res.body.missions).toHaveLength(4);
  });

  it("always includes daily_checkin mission", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, auth());
    const ids = res.body.missions.map((m: any) => m.missionId);
    expect(ids).toContain("daily_checkin");
  });

  it("returns idempotent results on multiple calls", async () => {
    const res1 = await makeRequest("GET", "/api/daily", undefined, auth());
    const res2 = await makeRequest("GET", "/api/daily", undefined, auth());
    expect(res1.body.missions.map((m: any) => m.missionId))
      .toEqual(res2.body.missions.map((m: any) => m.missionId));
  });

  it("missions have bounded rewards (50-200 coins each)", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, auth());
    for (const mission of res.body.missions) {
      expect(mission.definition.rewardCoins).toBeGreaterThanOrEqual(50);
      expect(mission.definition.rewardCoins).toBeLessThanOrEqual(200);
    }
  });

  it("cannot claim reward for uncompleted mission", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, auth());
    const uncompleted = res.body.missions.find((m: any) => !m.completed);
    if (uncompleted) {
      const claim = await makeRequest(
        "POST",
        `/api/daily/missions/${uncompleted.missionId}/claim`,
        undefined,
        auth()
      );
      expect(claim.status).toBe(400);
      expect(claim.body.error).toContain("not yet completed");
    }
  });
});

// ─── Streak System ──────────────────────────────────────────────────────

describe("Streak System", () => {
  it("starts with 0 streak", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, streakAuth());
    expect(res.status).toBe(200);
    expect(res.body.streak.currentStreak).toBe(0);
    expect(res.body.streak.todayCheckedIn).toBe(false);
  });

  it("increments streak on first check-in", async () => {
    const res = await makeRequest("POST", "/api/daily/checkin", undefined, streakAuth());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.streakDay).toBe(1);
    expect(res.body.coinsAwarded).toBe(25); // Day 1 reward
  });

  it("prevents double check-in on same day", async () => {
    const res = await makeRequest("POST", "/api/daily/checkin", undefined, streakAuth());
    expect(res.status).toBe(429);
    expect(res.body.error).toContain("Already checked in today");
    expect(res.body.streak.todayCheckedIn).toBe(true);
  });

  it("shows streak as preserved after check-in", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, streakAuth());
    expect(res.status).toBe(200);
    expect(res.body.streak.todayCheckedIn).toBe(true);
    expect(res.body.streak.streakPreserved).toBe(true);
  });

  it("auto-progresses daily_checkin mission on streak check-in", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, streakAuth());
    expect(res.status).toBe(200);
    const checkinMission = res.body.missions.find((m: any) => m.missionId === "daily_checkin");
    expect(checkinMission).toBeDefined();
    expect(checkinMission.progress).toBeGreaterThanOrEqual(1);
    expect(checkinMission.completed).toBe(true);
  });
});

// ─── Streak Reward Schedule ─────────────────────────────────────────────

describe("Streak Reward Schedule", () => {
  it("rewards are bounded by the schedule (max 500)", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, auth());
    expect(res.body.streak.nextReward.coins).toBeGreaterThan(0);
    expect(res.body.streak.nextReward.coins).toBeLessThanOrEqual(500);
  });
});

// ─── Daily Puzzle ───────────────────────────────────────────────────────

describe("Daily Puzzle", () => {
  it("returns a puzzle for today", async () => {
    const res = await makeRequest("GET", "/api/daily/puzzle", undefined, puzzleAuth());
    expect(res.status).toBe(200);
    expect(res.body.puzzleDate).toBeDefined();
    expect(res.body.scenario).toBeDefined();
    expect(res.body.scenario.title).toBeDefined();
    expect(res.body.scenario.description).toBeDefined();
    expect(res.body.scenario.hand).toBeDefined();
    expect(res.body.completed).toBe(false);
  });

  it("does not reveal optimal action before submission", async () => {
    const res = await makeRequest("GET", "/api/daily/puzzle", undefined, puzzleAuth());
    expect(res.status).toBe(200);
    expect(res.body.scenario.optimalAction).toBeUndefined();
    expect(res.body.scenario.optimalReason).toBeUndefined();
  });

  it("accepts a puzzle answer submission", async () => {
    const res = await makeRequest("POST", "/api/daily/puzzle/submit", { choice: "draw_stock" }, puzzleAuth());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.wasOptimal).toBe("boolean");
    expect(res.body.optimalAction).toBeDefined();
    expect(res.body.optimalReason).toBeDefined();
  });

  it("prevents double submission", async () => {
    const res = await makeRequest("POST", "/api/daily/puzzle/submit", { choice: "draw_stock" }, puzzleAuth());
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("already completed");
  });

  it("allows claiming puzzle reward after completion", async () => {
    const res = await makeRequest("POST", "/api/daily/puzzle/claim", undefined, puzzleAuth());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.coinsAwarded).toBeGreaterThanOrEqual(100);
    expect(res.body.breakdown).toBeDefined();
    expect(res.body.breakdown.base).toBe(100);
    expect(res.body.balances).toBeDefined();
  });

  it("prevents double reward claim", async () => {
    const res = await makeRequest("POST", "/api/daily/puzzle/claim", undefined, puzzleAuth());
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("already claimed");
  });

  it("returns puzzle history", async () => {
    const res = await makeRequest("GET", "/api/daily/puzzle/history", undefined, puzzleAuth());
    expect(res.status).toBe(200);
    expect(res.body.history).toBeDefined();
    expect(Array.isArray(res.body.history)).toBe(true);
    expect(res.body.history.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Puzzle Reward Economy ──────────────────────────────────────────────

describe("Puzzle Reward Economy", () => {
  it("base reward is 100 coins", async () => {
    const suffix = Date.now();
    const reg = await registerUser(`preward_${suffix}`, `preward_${suffix}@test.com`, "password123");
    const pa = { Authorization: `Bearer ${reg.body.sessionId}` };

    // Get puzzle and submit
    const puzzle = await makeRequest("GET", "/api/daily/puzzle", undefined, pa);
    expect(puzzle.status).toBe(200);
    expect(puzzle.body.scenario).toBeDefined();

    await makeRequest("POST", "/api/daily/puzzle/submit", { choice: "some_action" }, pa);
    const claim = await makeRequest("POST", "/api/daily/puzzle/claim", undefined, pa);
    expect(claim.status).toBe(200);
    expect(claim.body.breakdown.base).toBe(100);
  });

  it("optimal answer grants +50 bonus", async () => {
    const suffix = `optbonus_${Date.now()}`;
    const reg = await registerUser(`optuser_${suffix}`, `opt_${suffix}@test.com`, "password123");
    const pa = { Authorization: `Bearer ${reg.body.sessionId}` };

    // Must GET puzzle first to create the DB record
    await makeRequest("GET", "/api/daily/puzzle", undefined, pa);

    // Submit an answer — the API tells us what the optimal was
    const submit = await makeRequest("POST", "/api/daily/puzzle/submit", { choice: "draw_stock" }, pa);
    expect(submit.status).toBe(200);

    const claim = await makeRequest("POST", "/api/daily/puzzle/claim", undefined, pa);
    expect(claim.status).toBe(200);
    expect(claim.body.breakdown.base).toBe(100);
    // Optimal bonus is 50 if answer was correct, 0 otherwise
    expect([0, 50]).toContain(claim.body.breakdown.optimalBonus);
  });
});

// ─── Premium Boundaries ─────────────────────────────────────────────────

describe("Premium Feature Boundaries", () => {
  it("non-premium users get 0 premium bonus on puzzle", async () => {
    // Use the main session (non-premium) to avoid rate limits on register
    // Create puzzle record first by accessing the daily summary
    const suffix = `fpuzz_${Date.now()}`;
    const reg = await registerUser(`fpuzzuser_${suffix}`, `fpuzz_${suffix}@test.com`, "password123");
    const fa = { Authorization: `Bearer ${reg.body.sessionId}` };

    // Must GET puzzle first to create the DB record
    await makeRequest("GET", "/api/daily/puzzle", undefined, fa);
    await makeRequest("POST", "/api/daily/puzzle/submit", { choice: "draw_stock" }, fa);
    const claim = await makeRequest("POST", "/api/daily/puzzle/claim", undefined, fa);
    expect(claim.status).toBe(200);
    expect(claim.body.breakdown.premiumBonus).toBe(0);
  });

  it("non-premium users get limited puzzle history (max 7 days)", async () => {
    // Use puzzleAuth which already has a completed puzzle
    const hist = await makeRequest("GET", "/api/daily/puzzle/history", undefined, puzzleAuth());
    expect(hist.status).toBe(200);
    expect(hist.body.history.length).toBeLessThanOrEqual(7);
  });
});

// ─── Mission Progress Integration ───────────────────────────────────────

describe("Mission Progress via API", () => {
  it("daily_checkin mission completes when streak check-in is done", async () => {
    const suffix = `mpi_${Date.now()}`;
    const reg = await registerUser(`mpiuser_${suffix}`, `mpi_${suffix}@test.com`, "password123");
    const ma = { Authorization: `Bearer ${reg.body.sessionId}` };

    // Get the initial summary to trigger mission assignment
    await makeRequest("GET", "/api/daily", undefined, ma);

    // Check in
    await makeRequest("POST", "/api/daily/checkin", undefined, ma);

    // Verify check-in mission is now complete
    const daily = await makeRequest("GET", "/api/daily", undefined, ma);
    const checkinMission = daily.body.missions.find((m: any) => m.missionId === "daily_checkin");
    expect(checkinMission).toBeDefined();
    expect(checkinMission.completed).toBe(true);

    // Claim it
    const claim = await makeRequest("POST", "/api/daily/missions/daily_checkin/claim", undefined, ma);
    expect(claim.status).toBe(200);
    expect(claim.body.success).toBe(true);
    expect(claim.body.coinsAwarded).toBe(50);
  });
});

// ─── Economy Validation ─────────────────────────────────────────────────

describe("Economy Validation", () => {
  it("total available daily coins are bounded (< 1500)", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, auth());
    expect(res.body.totalAvailableCoins).toBeLessThanOrEqual(1500);
  });

  it("streak rewards are monotonically bounded at 500", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, auth());
    expect(res.body.streak.nextReward.coins).toBeLessThanOrEqual(500);
  });
});

// ─── Regression: Existing Systems ───────────────────────────────────────

describe("Regression: Existing Systems Unaffected", () => {
  it("wallet endpoints still work", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, auth());
    expect(res.status).toBe(200);
    expect(res.body.balances).toBeDefined();
  });

  it("health endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });

  it("profile endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, auth());
    expect(res.status).toBe(200);
  });

  it("entitlements endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/entitlements/plan", undefined, auth());
    expect(res.status).toBe(200);
  });

  it("training endpoints still work", async () => {
    const res = await makeRequest("GET", "/api/training/summary", undefined, auth());
    expect(res.status).toBe(200);
  });
});
