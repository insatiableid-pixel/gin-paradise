/**
 * Live Achievement Triggers & Instant Progress Feedback Tests for Gin Paradise.
 *
 * Covers:
 *   - Live achievement evaluation after match completion trigger points
 *   - Duplicate prevention under repeated trigger calls
 *   - Notification creation and retrieval
 *   - Notification dismissal
 *   - Activity surface data loading
 *   - Prestige unlock visibility after new awards
 *   - Regression coverage for existing features
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer, registerUser, loginUser, makeRequest } from "./helpers.js";
import { db } from "../server/db.js";
import {
  triggerLiveAchievements,
  getUnseenNotifications,
  dismissNotifications,
  getRecentAchievementActivity,
} from "../server/achievements.js";

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

function getUserId(sessionId: string): string {
  const row = db.prepare(
    "SELECT user_id FROM sessions WHERE id = ?"
  ).get(sessionId) as { user_id: string };
  return row.user_id;
}

function insertTestReplay(opts: {
  player1Id: string;
  player1Username: string;
  player2Id: string;
  player2Username: string;
  winnerId?: string;
  winnerUsername?: string;
  matchFormat?: string;
}) {
  const id = `replay-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO replays (id, room_id, started_at, ended_at,
      player1_id, player1_username, player2_id, player2_username,
      winner_id, winner_username, loser_id, loser_username,
      winner_score, loser_score, end_reason, action_count, transcript_json,
      match_format, tournament_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, "room-test", now - 60000, now,
    opts.player1Id, opts.player1Username,
    opts.player2Id, opts.player2Username,
    opts.winnerId || null, opts.winnerUsername || null,
    opts.winnerId ? (opts.winnerId === opts.player1Id ? opts.player2Id : opts.player1Id) : null,
    opts.winnerId ? (opts.winnerId === opts.player1Id ? opts.player2Username : opts.player1Username) : null,
    10, 5, "completed", 20,
    JSON.stringify([{ type: "match_start", detail: {} }]),
    opts.matchFormat || "heads_up",
    null,
  );
  return id;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("Live Achievement Triggers — Match Completion", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`lt_match_${suffix}`, `lt_match_${suffix}@test.com`);
    userId = getUserId(sessionId);
  });

  it("awards achievements when triggered after match completion", () => {
    // Set up user with enough data for first_match and win_10
    db.prepare("UPDATE users SET wins = 12, losses = 3 WHERE id = ?").run(userId);

    const awards = triggerLiveAchievements(userId, "match_completion");
    expect(awards.length).toBeGreaterThan(0);

    const awardIds = awards.map(a => a.achievementId);
    expect(awardIds).toContain("first_match");
    expect(awardIds).toContain("win_10");
  });

  it("returns full definition metadata with each award", () => {
    // Use a fresh user to avoid dedup issues
    const suffix2 = Math.random().toString(36).slice(2, 8);
    const regRes = db.prepare(
      "INSERT INTO users (id, username, email, password_hash, rating, wins, losses, created_at) VALUES (?, ?, ?, 'x', 1200, 5, 0, datetime('now'))"
    ).run(`lt_meta_${suffix2}`, `lt_meta_${suffix2}`, `lt_meta_${suffix2}@test.com`);
    const freshUserId = `lt_meta_${suffix2}`;

    const awards = triggerLiveAchievements(freshUserId, "match_completion");
    for (const award of awards) {
      expect(award.definition).toBeDefined();
      expect(award.definition.name).toBeTypeOf("string");
      expect(award.definition.icon).toBeTypeOf("string");
      expect(award.definition.category).toBeTypeOf("string");
      expect(award.definition.tier).toBeTypeOf("string");
      expect(award.awardedAt).toBeTypeOf("number");
      expect(award.awardedAt).toBeGreaterThan(0);
    }
  });

  it("creates notification records for new awards", () => {
    const notifications = getUnseenNotifications(userId);
    expect(notifications.length).toBeGreaterThan(0);

    const notifAchIds = notifications.map(n => n.achievementId);
    expect(notifAchIds).toContain("first_match");
  });

  it("includes trigger source on notifications", () => {
    const notifications = getUnseenNotifications(userId);
    for (const n of notifications) {
      expect(n.triggerSource).toBe("match_completion");
    }
  });
});

describe("Live Achievement Triggers — Duplicate Prevention", () => {
  let userId: string;

  beforeAll(() => {
    const suffix = Math.random().toString(36).slice(2, 8);
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, rating, wins, losses, created_at) VALUES (?, ?, ?, 'x', 1200, 10, 0, datetime('now'))"
    ).run(`lt_dup_${suffix}`, `lt_dup_${suffix}`, `lt_dup_${suffix}@test.com`);
    userId = `lt_dup_${suffix}`;
  });

  it("awards on first call", () => {
    const first = triggerLiveAchievements(userId, "match_completion");
    expect(first.length).toBeGreaterThan(0);
    expect(first.map(a => a.achievementId)).toContain("first_match");
  });

  it("returns empty on second call (no new achievements)", () => {
    const second = triggerLiveAchievements(userId, "match_completion");
    expect(second.length).toBe(0);
  });

  it("DB has exactly one row per achievement", () => {
    const rows = db.prepare(
      "SELECT COUNT(*) as cnt FROM achievements WHERE user_id = ? AND achievement_id = 'first_match'"
    ).get(userId) as { cnt: number };
    expect(rows.cnt).toBe(1);
  });
});

describe("Notification API — GET /api/profile/notifications", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`lt_notif_${suffix}`, `lt_notif_${suffix}@test.com`);
    userId = getUserId(sessionId);
    // Set up and trigger
    db.prepare("UPDATE users SET wins = 5, losses = 0 WHERE id = ?").run(userId);
    triggerLiveAchievements(userId, "match_completion");
  });

  it("returns unseen notifications via API", async () => {
    const res = await makeRequest("GET", "/api/profile/notifications", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.notifications).toBeInstanceOf(Array);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it("includes achievement definition on each notification", async () => {
    const res = await makeRequest("GET", "/api/profile/notifications", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    for (const n of res.body.notifications) {
      expect(n.achievementId).toBeTypeOf("string");
      expect(n.definition).toBeDefined();
      expect(n.definition.name).toBeTypeOf("string");
    }
  });

  it("rejects unauthenticated requests", async () => {
    const res = await makeRequest("GET", "/api/profile/notifications");
    expect(res.status).toBe(401);
  });
});

describe("Notification API — POST /api/profile/notifications/dismiss", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`lt_dismiss_${suffix}`, `lt_dismiss_${suffix}@test.com`);
    userId = getUserId(sessionId);
    db.prepare("UPDATE users SET wins = 5, losses = 0 WHERE id = ?").run(userId);
    triggerLiveAchievements(userId, "match_completion");
  });

  it("dismisses all notifications when no IDs provided", async () => {
    // Verify there are notifications first
    const before = await makeRequest("GET", "/api/profile/notifications", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(before.body.count).toBeGreaterThan(0);

    // Dismiss all
    const res = await makeRequest("POST", "/api/profile/notifications/dismiss", {}, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.dismissed).toBeGreaterThan(0);

    // Verify cleared
    const after = await makeRequest("GET", "/api/profile/notifications", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(after.body.count).toBe(0);
  });

  it("dismisses specific notifications by ID", async () => {
    // Trigger new achievements to create fresh notifications
    db.prepare("UPDATE users SET wins = 55 WHERE id = ?").run(userId);
    triggerLiveAchievements(userId, "match_completion");

    const before = await makeRequest("GET", "/api/profile/notifications", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    if (before.body.count > 0) {
      const firstId = before.body.notifications[0].id;
      const res = await makeRequest("POST", "/api/profile/notifications/dismiss", {
        notificationIds: [firstId],
      }, {
        Authorization: `Bearer ${sessionId}`,
      });
      expect(res.status).toBe(200);
    }
  });

  it("rejects unauthenticated dismiss", async () => {
    const res = await makeRequest("POST", "/api/profile/notifications/dismiss", {});
    expect(res.status).toBe(401);
  });
});

describe("Activity Surface — GET /api/profile/activity", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`lt_activity_${suffix}`, `lt_activity_${suffix}@test.com`);
    userId = getUserId(sessionId);
    db.prepare("UPDATE users SET wins = 15, losses = 3 WHERE id = ?").run(userId);
    triggerLiveAchievements(userId, "match_completion");
  });

  it("returns recent achievement activity", async () => {
    const res = await makeRequest("GET", "/api/profile/activity", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.recentAchievements).toBeInstanceOf(Array);
    expect(res.body.recentAchievements.length).toBeGreaterThan(0);
    expect(res.body.totalAchievements).toBeGreaterThan(0);
  });

  it("includes definition and timestamps on activity items", async () => {
    const res = await makeRequest("GET", "/api/profile/activity", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    for (const item of res.body.recentAchievements) {
      expect(item.achievementId).toBeTypeOf("string");
      expect(item.awardedAt).toBeTypeOf("number");
      expect(item.definition).toBeDefined();
    }
  });

  it("includes prestige data", async () => {
    const res = await makeRequest("GET", "/api/profile/activity", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.body.prestige).toBeInstanceOf(Array);
    expect(res.body.totalPrestige).toBeTypeOf("number");
  });

  it("respects limit parameter", async () => {
    const res = await makeRequest("GET", "/api/profile/activity?limit=2", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.recentAchievements.length).toBeLessThanOrEqual(2);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await makeRequest("GET", "/api/profile/activity");
    expect(res.status).toBe(401);
  });
});

describe("Prestige Visibility After Live Triggers", () => {
  let sessionId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`lt_pres_${suffix}`, `lt_pres_${suffix}@test.com`);
    userId = getUserId(sessionId);
    // Set up for first_match → newcomer badge unlock
    db.prepare("UPDATE users SET wins = 1, losses = 0 WHERE id = ?").run(userId);
  });

  it("unlocks prestige via live trigger (not profile load)", () => {
    const awards = triggerLiveAchievements(userId, "match_completion");
    const firstMatch = awards.find(a => a.achievementId === "first_match");
    expect(firstMatch).toBeDefined();
    expect(firstMatch!.prestigeUnlock).toBeDefined();
    expect(firstMatch!.prestigeUnlock!.key).toBe("newcomer");
    expect(firstMatch!.prestigeUnlock!.type).toBe("badge");
  });

  it("prestige is visible on profile after live trigger", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    const badges = res.body.prestige.filter((p: any) => p.type === "badge");
    expect(badges.some((b: any) => b.key === "newcomer")).toBe(true);
  });

  it("live-triggered prestige can be equipped immediately", async () => {
    const res = await makeRequest("PUT", "/api/profile", { selectedBadge: "newcomer" }, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.selectedBadge).toBe("newcomer");
  });
});

describe("Training Achievement Live Triggers", () => {
  let userId: string;

  beforeAll(() => {
    const suffix = Math.random().toString(36).slice(2, 8);
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, rating, wins, losses, created_at) VALUES (?, ?, ?, 'x', 1200, 5, 0, datetime('now'))"
    ).run(`lt_train_${suffix}`, `lt_train_${suffix}`, `lt_train_${suffix}@test.com`);
    userId = `lt_train_${suffix}`;
  });

  it("awards first_evaluation after evaluation completion trigger", () => {
    // Insert a replay for this user
    const replayId = insertTestReplay({
      player1Id: userId,
      player1Username: "lt_train_user",
      player2Id: "opponent-eval",
      player2Username: "opp-eval",
      winnerId: userId,
      winnerUsername: "lt_train_user",
    });

    // Insert a cached evaluation
    try {
      db.prepare(`
        INSERT INTO replay_evaluations (replay_id, evaluation_json, engine_version)
        VALUES (?, ?, 'apex_v2')
      `).run(replayId, JSON.stringify({
        evaluations: [],
        player_summaries: {
          [userId]: { engine_accuracy: 75, score_label: "good", severity_counts: { best: 10, inaccuracy: 2, mistake: 1, blunder: 0 } },
        },
      }));
    } catch {
      // Table might not exist yet, create it
      db.exec(`
        CREATE TABLE IF NOT EXISTS replay_evaluations (
          replay_id TEXT PRIMARY KEY,
          evaluation_json TEXT NOT NULL,
          engine_version TEXT NOT NULL DEFAULT 'apex_v2',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      db.prepare(`
        INSERT INTO replay_evaluations (replay_id, evaluation_json, engine_version)
        VALUES (?, ?, 'apex_v2')
      `).run(replayId, JSON.stringify({
        evaluations: [],
        player_summaries: {
          [userId]: { engine_accuracy: 75, score_label: "good", severity_counts: { best: 10, inaccuracy: 2, mistake: 1, blunder: 0 } },
        },
      }));
    }

    const awards = triggerLiveAchievements(userId, "evaluation_completion");
    const awardIds = awards.map(a => a.achievementId);
    expect(awardIds).toContain("first_evaluation");
  });
});

describe("Live Triggers — Regression Coverage", () => {
  let sessionId: string;

  beforeAll(async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    sessionId = await createUserAndAuth(`lt_reg_${suffix}`, `lt_reg_${suffix}@test.com`);
  });

  it("profile API still works", async () => {
    const res = await makeRequest("GET", "/api/profile", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.achievements).toBeInstanceOf(Array);
  });

  it("training summary still works", async () => {
    const res = await makeRequest("GET", "/api/training/summary", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
  });

  it("wallet API still works", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, {
      Authorization: `Bearer ${sessionId}`,
    });
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

  it("achievement catalog still works", async () => {
    const res = await makeRequest("GET", "/api/profile/achievements/catalog");
    expect(res.status).toBe(200);
    expect(res.body.achievements.length).toBeGreaterThan(20);
  });

  it("backfill still works", async () => {
    const res = await makeRequest("POST", "/api/profile/backfill", {}, {
      Authorization: `Bearer ${sessionId}`,
    });
    expect(res.status).toBe(200);
  });
});
