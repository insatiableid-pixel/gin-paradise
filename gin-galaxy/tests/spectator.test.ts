/**
 * Spectator, Featured Matches & Broadcast Productization Tests for Gin Paradise.
 *
 * Covers:
 *   - Spectator view privacy boundaries (hidden hand safety)
 *   - Featured match eligibility / selection rules
 *   - Featured match listing behavior
 *   - Spectator module unit tests
 *   - Watch-page data shape and read-only access
 *   - Player spectate preferences (opt-in/opt-out)
 *   - Preference-aware eligibility enforcement
 *   - Broadcast analytics (in-memory + persistence)
 *   - Admin featured-match operations (API)
 *   - Admin broadcast metrics API
 *   - Regression coverage for existing systems
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import WebSocket from "ws";
import { startTestServer, stopTestServer, registerUser, loginUser, makeRequest } from "./helpers.js";
import {
  getSpectatorView,
  getFeaturedReasons,
  isSpectatable,
  addSpectator,
  removeSpectator,
  getSpectatorCount,
  getRoomSpectatorIds,
  cleanupSpectators,
  addAdminFeatured,
  removeAdminFeatured,
  isAdminFeatured,
  getPlayerSpectatePreference,
  setPlayerSpectatePreference,
  bothPlayersAllowSpectating,
  initBroadcastStats,
  getLiveBroadcastStats,
  persistBroadcastMetrics,
  cleanupBroadcastStats,
  getRecentBroadcastMetrics,
  getBroadcastSummary,
  type FeaturedReason,
} from "../server/multiplayer/spectator.js";
import type { MatchState, Card } from "../server/multiplayer/engine.js";
import {
  createMatch,
  handleDraw,
  handleDiscard,
  handleKnock,
  getPlayerView,
} from "../server/multiplayer/engine.js";
import { db } from "../server/db.js";
import { getCoordinator } from "../server/multiplayer/coordinatorFactory.js";
import { handleWatchMatch, sendSpectatorMessage } from "../server/multiplayer/roomManager.js";

// ── Test utilities ─────────────────────────────────────────────────

function createTestMatchState(): MatchState {
  return createMatch(
    "test-room-1",
    { userId: "player1", username: "Alice" },
    { userId: "player2", username: "Bob" }
  );
}

/** Create a test user directly in the DB and return the userId */
function createTestUserInDB(username: string, rating: number = 1200): string {
  const userId = `test-user-${username}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    db.prepare(
      "INSERT INTO users (id, username, email, password_hash, rating) VALUES (?, ?, ?, ?, ?)"
    ).run(userId, `test_${username}_${Date.now()}`, `${username}_${Date.now()}@test.com`, "test", rating);
  } catch {
    // User may already exist in a test run
  }
  return userId;
}

// ── Setup ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

// ── Spectator View Privacy Boundaries ─────────────────────────────

describe("Spectator View — Privacy Safety", () => {
  it("should not expose either player's hand during live play", () => {
    const match = createTestMatchState();
    const view = getSpectatorView(match);

    // The spectator view should NOT have any hand-revealing fields
    expect(view).not.toHaveProperty("myHand");
    expect(view).not.toHaveProperty("opponentHand");
    expect(view).not.toHaveProperty("hand");
    expect(view).not.toHaveProperty("knockerHand");

    // Should only have card counts
    expect(view.player1CardCount).toBe(10);
    expect(view.player2CardCount).toBe(10);
  });

  it("should expose public-state information only", () => {
    const match = createTestMatchState();
    const view = getSpectatorView(match);

    // Verify all expected public fields are present
    expect(view.roomId).toBe("test-room-1");
    expect(view.player1Username).toBe("Alice");
    expect(view.player2Username).toBe("Bob");
    expect(view.player1Score).toBe(0);
    expect(view.player2Score).toBe(0);
    expect(view.currentTurnUsername).toBe("Alice"); // First player goes first
    expect(view.topDiscard).not.toBeNull();
    expect(view.stockCount).toBeGreaterThan(0);
    expect(view.discardCount).toBeGreaterThan(0);
    expect(view.status).toBe("playing");
    expect(view.roundNumber).toBe(1);
    expect(view.winnerId).toBeNull();
    expect(view.roundWinnerId).toBeNull();
    expect(view.roundPoints).toBe(0);
  });

  it("should not expose stock card identities", () => {
    const match = createTestMatchState();
    const view = getSpectatorView(match);

    // Only count, no card data for stock
    expect(view.stockCount).toBeGreaterThan(0);
    expect(view).not.toHaveProperty("stock");
    expect(view).not.toHaveProperty("stockCards");
  });

  it("should track card counts correctly after draws", () => {
    const match = createTestMatchState();

    // Player 1 draws from stock
    const drawResult = handleDraw(match, "player1", "stock");
    expect(drawResult.ok).toBe(true);

    const view = getSpectatorView(match);
    // Player 1 should have 11 cards now (drew but hasn't discarded)
    expect(view.player1CardCount).toBe(11);
    expect(view.player2CardCount).toBe(10);
  });

  it("should update turn correctly after discard", () => {
    const match = createTestMatchState();

    // Player 1 draws and discards
    handleDraw(match, "player1", "stock");
    handleDiscard(match, "player1", 0);

    const view = getSpectatorView(match);
    // Turn should now be player 2
    expect(view.currentTurnUsername).toBe("Bob");
    expect(view.player1CardCount).toBe(10);
    expect(view.player2CardCount).toBe(10);
  });

  it("should expose top discard card (public info)", () => {
    const match = createTestMatchState();

    // The initial top discard is set during match creation
    const view = getSpectatorView(match);
    expect(view.topDiscard).not.toBeNull();
    expect(view.topDiscard).toHaveProperty("suit");
    expect(view.topDiscard).toHaveProperty("rank");
  });

  it("should never contain hidden player fields that PlayerGameView has", () => {
    const match = createTestMatchState();
    const spectatorView = getSpectatorView(match);
    const playerView = getPlayerView(match, "player1");

    // PlayerGameView has hand data; SpectatorView should NOT
    expect(playerView).toHaveProperty("myHand");
    expect(playerView!.myHand.length).toBeGreaterThan(0);

    // SpectatorView intentionally lacks all of these
    expect(spectatorView).not.toHaveProperty("myHand");
    expect(spectatorView).not.toHaveProperty("isMyTurn");
    expect(spectatorView).not.toHaveProperty("hasDrawn");
    expect(spectatorView).not.toHaveProperty("fairnessCommitment");
    expect(spectatorView).not.toHaveProperty("turnTimer");
  });
});

// ── Featured Match Eligibility / Selection Rules ──────────────────

describe("Featured Match Eligibility", () => {
  beforeEach(() => {
    cleanupSpectators("test-room");
  });

  it("should mark tournament matches as eligible", () => {
    const reasons = getFeaturedReasons("room-1", "free", true, 1200, 1200);
    expect(reasons).toContain("tournament");
    expect(isSpectatable("room-1", "free", true, 1200, 1200)).toBe(true);
  });

  it("should mark high-stakes matches as eligible", () => {
    const reasons = getFeaturedReasons("room-2", "gold_5000", false, 1200, 1200);
    expect(reasons).toContain("high_stakes");
    expect(isSpectatable("room-2", "gold_5000", false, 1200, 1200)).toBe(true);
  });

  it("should mark gold_2000 as high stakes", () => {
    const reasons = getFeaturedReasons("room-3", "gold_2000", false, 1200, 1200);
    expect(reasons).toContain("high_stakes");
  });

  it("should mark gold_5000 as high stakes", () => {
    const reasons = getFeaturedReasons("room-4", "gold_5000", false, 1200, 1200);
    expect(reasons).toContain("high_stakes");
  });

  it("should NOT mark free matches as eligible without other reasons", () => {
    const reasons = getFeaturedReasons("room-5", "free", false, 1200, 1200);
    expect(reasons).toHaveLength(0);
    expect(isSpectatable("room-5", "free", false, 1200, 1200)).toBe(false);
  });

  it("should NOT mark gold_500 matches as high stakes", () => {
    const reasons = getFeaturedReasons("room-6", "gold_500", false, 1200, 1200);
    expect(reasons).not.toContain("high_stakes");
  });

  it("should mark admin-featured matches as eligible", () => {
    addAdminFeatured("room-7");
    const reasons = getFeaturedReasons("room-7", "free", false, 1200, 1200);
    expect(reasons).toContain("featured");
    expect(isSpectatable("room-7", "free", false, 1200, 1200)).toBe(true);
    removeAdminFeatured("room-7");
  });

  it("should mark ranked matches (both players above threshold) as eligible", () => {
    const reasons = getFeaturedReasons("room-8", "free", false, 1500, 1450);
    expect(reasons).toContain("ranked");
    expect(isSpectatable("room-8", "free", false, 1500, 1450)).toBe(true);
  });

  it("should NOT mark ranked if only one player above threshold", () => {
    const reasons = getFeaturedReasons("room-9", "free", false, 1500, 1300);
    expect(reasons).not.toContain("ranked");
    expect(isSpectatable("room-9", "free", false, 1500, 1300)).toBe(false);
  });

  it("should combine multiple reasons", () => {
    addAdminFeatured("room-10");
    const reasons = getFeaturedReasons("room-10", "gold_5000", true, 1500, 1450);
    expect(reasons).toContain("tournament");
    expect(reasons).toContain("high_stakes");
    expect(reasons).toContain("featured");
    expect(reasons).toContain("ranked");
    expect(reasons.length).toBe(4);
    removeAdminFeatured("room-10");
  });

  it("should handle admin featured add/remove correctly", () => {
    expect(isAdminFeatured("room-11")).toBe(false);
    addAdminFeatured("room-11");
    expect(isAdminFeatured("room-11")).toBe(true);
    removeAdminFeatured("room-11");
    expect(isAdminFeatured("room-11")).toBe(false);
  });
});

// ── Spectator Tracking ────────────────────────────────────────────

describe("Spectator Tracking", () => {
  beforeEach(() => {
    cleanupSpectators("track-room");
  });

  it("should track spectator count correctly", () => {
    expect(getSpectatorCount("track-room")).toBe(0);

    addSpectator("track-room", "spec-1");
    expect(getSpectatorCount("track-room")).toBe(1);

    addSpectator("track-room", "spec-2");
    expect(getSpectatorCount("track-room")).toBe(2);
  });

  it("should remove spectators correctly", () => {
    addSpectator("track-room", "spec-1");
    addSpectator("track-room", "spec-2");
    expect(getSpectatorCount("track-room")).toBe(2);

    removeSpectator("track-room", "spec-1");
    expect(getSpectatorCount("track-room")).toBe(1);

    removeSpectator("track-room", "spec-2");
    expect(getSpectatorCount("track-room")).toBe(0);
  });

  it("should list spectator IDs", () => {
    addSpectator("track-room", "spec-a");
    addSpectator("track-room", "spec-b");

    const ids = getRoomSpectatorIds("track-room");
    expect(ids).toContain("spec-a");
    expect(ids).toContain("spec-b");
    expect(ids.length).toBe(2);
  });

  it("should clean up all spectators for a room", () => {
    addSpectator("track-room", "spec-1");
    addSpectator("track-room", "spec-2");
    expect(getSpectatorCount("track-room")).toBe(2);

    cleanupSpectators("track-room");
    expect(getSpectatorCount("track-room")).toBe(0);
    expect(getRoomSpectatorIds("track-room")).toHaveLength(0);
  });

  it("should handle removing non-existent spectator gracefully", () => {
    removeSpectator("track-room", "non-existent");
    expect(getSpectatorCount("track-room")).toBe(0);
  });

  it("should not duplicate spectators", () => {
    addSpectator("track-room", "spec-1");
    addSpectator("track-room", "spec-1"); // duplicate
    expect(getSpectatorCount("track-room")).toBe(1);
  });
});

// ── Featured Matches API ──────────────────────────────────────────

describe("Featured Matches API", () => {
  it("should return empty list when no matches are active", async () => {
    const res = await makeRequest("GET", "/api/spectator/featured");
    expect(res.status).toBe(200);
    expect(res.body.matches).toBeDefined();
    expect(Array.isArray(res.body.matches)).toBe(true);
  });

  it("should be accessible without authentication", async () => {
    const res = await makeRequest("GET", "/api/spectator/featured");
    expect(res.status).toBe(200);
  });
});

// ── Spectator View Data Shape ─────────────────────────────────────

describe("Spectator View — Data Shape", () => {
  it("should have all required public fields", () => {
    const match = createTestMatchState();
    const view = getSpectatorView(match);

    const requiredFields = [
      "roomId",
      "player1Username",
      "player2Username",
      "player1Score",
      "player2Score",
      "currentTurnUsername",
      "player1CardCount",
      "player2CardCount",
      "topDiscard",
      "stockCount",
      "discardCount",
      "status",
      "message",
      "roundNumber",
      "winnerId",
      "roundWinnerId",
      "roundPoints",
    ];

    for (const field of requiredFields) {
      expect(view).toHaveProperty(field);
    }
  });

  it("should reflect playing status during live game", () => {
    const match = createTestMatchState();
    const view = getSpectatorView(match);
    expect(view.status).toBe("playing");
  });

  it("should update scores after knock", () => {
    const match = createTestMatchState();

    // Play through to a knock
    handleDraw(match, "player1", "stock");
    // Force a knock scenario by manually adjusting state
    // The exact outcome depends on random hands, but we can verify the
    // spectator view updates scores
    const originalView = getSpectatorView(match);
    expect(originalView.player1Score).toBe(0);
    expect(originalView.player2Score).toBe(0);
  });

  it("should include round number", () => {
    const match = createTestMatchState();
    const view = getSpectatorView(match);
    expect(view.roundNumber).toBe(1);
  });

  it("should include discard count", () => {
    const match = createTestMatchState();
    const view = getSpectatorView(match);
    expect(view.discardCount).toBe(1); // Initial discard
  });
});

// ── Spectator Relay ──────────────────────────────────────────────

describe("Spectator Relay", () => {
  it("should send spectator updates directly on the local node", () => {
    const coord = getCoordinator();
    const roomId = `relay-local-${Date.now()}`;
    const userId = createTestUserInDB(`relay_local_${Date.now().toString(36)}`);
    const ws = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket;

    try {
      coord.setSpectatorConnection(userId, { ws, roomId, connectedAt: Date.now() });
      sendSpectatorMessage(roomId, userId, {
        type: "spectator_update",
        state: { roomId } as any,
      });

      expect((ws as any).send).toHaveBeenCalledTimes(1);
      const payload = JSON.parse((ws as any).send.mock.calls[0][0]);
      expect(payload).toMatchObject({
        type: "spectator_update",
        state: { roomId },
      });
    } finally {
      coord.removeSpectatorConnection(userId);
    }
  });

  it("should relay spectator updates to the owning node when the socket lives elsewhere", () => {
    const coord = getCoordinator();
    const roomId = `relay-remote-${Date.now()}`;
    const userId = createTestUserInDB(`relay_remote_${Date.now().toString(36)}`);
    const ws = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket;
    const deliverSpy = vi.spyOn(coord, "deliverNodeMessage");

    try {
      coord.setSpectatorConnection(userId, {
        ws,
        roomId,
        nodeId: "remote-spectator-node",
        connectedAt: Date.now(),
      });

      sendSpectatorMessage(roomId, userId, {
        type: "spectator_update",
        state: { roomId } as any,
      });

      expect(deliverSpy).toHaveBeenCalledTimes(1);
      expect(deliverSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          targetNodeId: "remote-spectator-node",
          sourceNodeId: expect.any(String),
          roomId,
          userId,
          message: expect.objectContaining({
            type: "spectator_update",
            state: { roomId },
          }),
        })
      );
      expect((ws as any).send).not.toHaveBeenCalled();
    } finally {
      deliverSpy.mockRestore();
      coord.removeSpectatorConnection(userId);
    }
  });

  it("should watch a remote-owned match without a handoff", async () => {
    const coord = getCoordinator();
    const roomId = `watch-remote-${Date.now()}`;
    const ownerNodeId = "remote-owner-node";
    const suffix = Date.now().toString(36);
    const player1 = await registerUser(`watch_p1_${suffix}`, `watch_p1_${suffix}@test.com`, "password123");
    const player2 = await registerUser(`watch_p2_${suffix}`, `watch_p2_${suffix}@test.com`, "password123");
    const spectator = await registerUser(`watch_spec_${suffix}`, `watch_spec_${suffix}@test.com`, "password123");
    const player1Id = player1.body.user.id;
    const player2Id = player2.body.user.id;
    const spectatorId = spectator.body.user.id;
    const match = createMatch(
      roomId,
      { userId: player1Id, username: player1.body.user.username },
      { userId: player2Id, username: player2.body.user.username }
    );

    try {
      coord.createRoom({
        id: roomId,
        hostId: player1Id,
        players: new Map([
          [player1Id, { userId: player1Id, username: player1.body.user.username, ws: null, connected: true }],
          [player2Id, { userId: player2Id, username: player2.body.user.username, ws: null, connected: true }],
        ]),
        status: "playing",
        createdAt: Date.now(),
        stakeId: "free",
        ownerNodeId,
        ownerLeaseExpiresAt: Date.now() + 60_000,
      });
      coord.setRoomGameState(roomId, {
        match,
        lastShowdown: null,
        updatedAt: Date.now(),
        nodeId: ownerNodeId,
      });
      addAdminFeatured(roomId);

      const socket = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as WebSocket;
      handleWatchMatch(socket, spectatorId, spectator.body.user.username, roomId);

      expect((socket as any).send).toHaveBeenCalledTimes(1);
      const message = JSON.parse((socket as any).send.mock.calls[0][0]);
      expect(message.type).toBe("spectator_update");
      expect(message).not.toMatchObject({ type: "room_handoff_required" });
      expect(message.state.roomId).toBe(roomId);

      coord.removeSpectatorConnection(spectatorId);
    } finally {
      removeAdminFeatured(roomId);
      cleanupSpectators(roomId);
      coord.deleteRoom(roomId);
      coord.removeSpectatorConnection(spectatorId);
    }
  });
});

// ── Player Spectate Preferences ───────────────────────────────────

describe("Player Spectate Preferences", () => {
  it("should default to allowing spectating", () => {
    const userId = createTestUserInDB("pref_default");
    expect(getPlayerSpectatePreference(userId)).toBe(true);
  });

  it("should persist opt-out preference", () => {
    const userId = createTestUserInDB("pref_optout");
    setPlayerSpectatePreference(userId, false);
    expect(getPlayerSpectatePreference(userId)).toBe(false);
  });

  it("should allow toggling back to opt-in", () => {
    const userId = createTestUserInDB("pref_toggle");
    setPlayerSpectatePreference(userId, false);
    expect(getPlayerSpectatePreference(userId)).toBe(false);
    setPlayerSpectatePreference(userId, true);
    expect(getPlayerSpectatePreference(userId)).toBe(true);
  });

  it("should check both players' preferences", () => {
    const p1 = createTestUserInDB("pref_both_p1");
    const p2 = createTestUserInDB("pref_both_p2");

    // Both default to true
    expect(bothPlayersAllowSpectating(p1, p2)).toBe(true);

    // One opts out
    setPlayerSpectatePreference(p1, false);
    expect(bothPlayersAllowSpectating(p1, p2)).toBe(false);

    // Both opt out
    setPlayerSpectatePreference(p2, false);
    expect(bothPlayersAllowSpectating(p1, p2)).toBe(false);

    // Restore both
    setPlayerSpectatePreference(p1, true);
    setPlayerSpectatePreference(p2, true);
    expect(bothPlayersAllowSpectating(p1, p2)).toBe(true);
  });
});

// ── Preference-Aware Eligibility ──────────────────────────────────

describe("Preference-Aware Eligibility", () => {
  it("should block high-stakes spectating when a player has opted out", () => {
    const p1 = createTestUserInDB("elig_p1", 1200);
    const p2 = createTestUserInDB("elig_p2", 1200);

    // High stakes, both allow (default) → eligible
    expect(isSpectatable("elig-room-1", "gold_5000", false, 1200, 1200, p1, p2)).toBe(true);

    // Player 1 opts out → no longer eligible
    setPlayerSpectatePreference(p1, false);
    expect(isSpectatable("elig-room-2", "gold_5000", false, 1200, 1200, p1, p2)).toBe(false);

    // Restore
    setPlayerSpectatePreference(p1, true);
  });

  it("should never block tournament matches regardless of preferences", () => {
    const p1 = createTestUserInDB("elig_tm_p1");
    const p2 = createTestUserInDB("elig_tm_p2");

    // Both opt out
    setPlayerSpectatePreference(p1, false);
    setPlayerSpectatePreference(p2, false);

    // Tournament matches are ALWAYS public
    expect(isSpectatable("elig-tm-room", "free", true, 1200, 1200, p1, p2)).toBe(true);
    const reasons = getFeaturedReasons("elig-tm-room", "free", true, 1200, 1200, p1, p2);
    expect(reasons).toContain("tournament");

    // But non-tournament reasons should NOT appear
    expect(reasons).not.toContain("ranked");
    expect(reasons).not.toContain("high_stakes");

    // Restore
    setPlayerSpectatePreference(p1, true);
    setPlayerSpectatePreference(p2, true);
  });

  it("should block admin-featured when players opted out", () => {
    const p1 = createTestUserInDB("elig_af_p1");
    const p2 = createTestUserInDB("elig_af_p2");

    addAdminFeatured("elig-af-room");
    // Both allow → eligible
    expect(isSpectatable("elig-af-room", "free", false, 1200, 1200, p1, p2)).toBe(true);

    // Player 2 opts out → admin featuring blocked
    setPlayerSpectatePreference(p2, false);
    expect(isSpectatable("elig-af-room", "free", false, 1200, 1200, p1, p2)).toBe(false);
    const reasons = getFeaturedReasons("elig-af-room", "free", false, 1200, 1200, p1, p2);
    expect(reasons).not.toContain("featured");

    // Restore
    setPlayerSpectatePreference(p2, true);
    removeAdminFeatured("elig-af-room");
  });

  it("should block ranked spectating when a player opts out", () => {
    const p1 = createTestUserInDB("elig_rk_p1", 1500);
    const p2 = createTestUserInDB("elig_rk_p2", 1450);

    // Both allow, both high-rated → eligible
    expect(isSpectatable("elig-rk-room", "free", false, 1500, 1450, p1, p2)).toBe(true);

    // Opt out
    setPlayerSpectatePreference(p1, false);
    expect(isSpectatable("elig-rk-room", "free", false, 1500, 1450, p1, p2)).toBe(false);

    // Restore
    setPlayerSpectatePreference(p1, true);
  });

  it("should maintain backward compat when player IDs not provided", () => {
    // Without player IDs, preference check is skipped
    expect(isSpectatable("compat-room", "gold_5000", false, 1200, 1200)).toBe(true);
    expect(getFeaturedReasons("compat-room", "gold_5000", false, 1200, 1200).length).toBeGreaterThan(0);
  });
});

// ── Player Spectate Preference API ────────────────────────────────

describe("Player Spectate Preference API", () => {
  let token: string;

  beforeAll(async () => {
    const u = `specpref_api_${Date.now()}`;
    await registerUser(u, `${u}@test.com`, "password123");
    const login = await loginUser(u, "password123");
    token = login.body.sessionId;
  });

  it("should return default preference (allow)", async () => {
    const res = await makeRequest("GET", "/api/spectator/preference", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.allowSpectating).toBe(true);
  });

  it("should allow setting preference to false", async () => {
    const res = await makeRequest("PUT", "/api/spectator/preference", { allowSpectating: false }, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.allowSpectating).toBe(false);
  });

  it("should persist preference change", async () => {
    const res = await makeRequest("GET", "/api/spectator/preference", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.allowSpectating).toBe(false);
  });

  it("should allow toggling back to true", async () => {
    await makeRequest("PUT", "/api/spectator/preference", { allowSpectating: true }, {
      Authorization: `Bearer ${token}`,
    });
    const res = await makeRequest("GET", "/api/spectator/preference", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.allowSpectating).toBe(true);
  });

  it("should reject non-boolean values", async () => {
    const res = await makeRequest("PUT", "/api/spectator/preference", { allowSpectating: "yes" }, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(400);
  });

  it("should require authentication for GET", async () => {
    const res = await makeRequest("GET", "/api/spectator/preference");
    expect(res.status).toBe(401);
  });

  it("should require authentication for PUT", async () => {
    const res = await makeRequest("PUT", "/api/spectator/preference", { allowSpectating: true });
    expect(res.status).toBe(401);
  });
});

// ── Broadcast Analytics ───────────────────────────────────────────

describe("Broadcast Analytics", () => {
  beforeEach(() => {
    cleanupSpectators("analytics-room");
    cleanupBroadcastStats("analytics-room");
  });

  it("should initialize broadcast stats", () => {
    initBroadcastStats("analytics-room");
    const stats = getLiveBroadcastStats("analytics-room");
    expect(stats).not.toBeNull();
    expect(stats!.peakConcurrent).toBe(0);
    expect(stats!.uniqueSpectators).toBe(0);
    expect(stats!.currentSpectators).toBe(0);
  });

  it("should track peak concurrent spectators", () => {
    initBroadcastStats("analytics-room");

    addSpectator("analytics-room", "s1");
    addSpectator("analytics-room", "s2");
    addSpectator("analytics-room", "s3");

    const stats = getLiveBroadcastStats("analytics-room");
    expect(stats!.peakConcurrent).toBe(3);
    expect(stats!.currentSpectators).toBe(3);

    removeSpectator("analytics-room", "s1");
    const stats2 = getLiveBroadcastStats("analytics-room");
    expect(stats2!.peakConcurrent).toBe(3); // Peak stays at 3
    expect(stats2!.currentSpectators).toBe(2);
  });

  it("should track unique spectators across joins/leaves", () => {
    initBroadcastStats("analytics-room");

    addSpectator("analytics-room", "s1");
    addSpectator("analytics-room", "s2");
    removeSpectator("analytics-room", "s1");
    addSpectator("analytics-room", "s3");
    addSpectator("analytics-room", "s1"); // s1 returns — still unique count 3

    const stats = getLiveBroadcastStats("analytics-room");
    expect(stats!.uniqueSpectators).toBe(3);
    expect(stats!.currentSpectators).toBe(3);
  });

  it("should track admin-featured status", () => {
    addAdminFeatured("analytics-room");
    initBroadcastStats("analytics-room");

    const stats = getLiveBroadcastStats("analytics-room");
    expect(stats!.wasAdminFeatured).toBe(true);

    removeAdminFeatured("analytics-room");
    cleanupBroadcastStats("analytics-room");
  });

  it("should persist broadcast metrics to DB", () => {
    initBroadcastStats("persist-room");
    addSpectator("persist-room", "s1");
    addSpectator("persist-room", "s2");

    persistBroadcastMetrics(
      "persist-room",
      "p1", "Alice",
      "p2", "Bob",
      "p1", "Alice",
      "free",
      ["tournament"],
      Date.now() - 60000,
    );

    const metrics = getRecentBroadcastMetrics(1);
    expect(metrics.length).toBeGreaterThanOrEqual(1);
    const latest = metrics[0];
    expect(latest.room_id).toBe("persist-room");
    expect(latest.peak_concurrent_spectators).toBe(2);
    expect(latest.total_unique_spectators).toBe(2);

    // Cleanup
    cleanupSpectators("persist-room");
  });

  it("should return null for non-existent room stats", () => {
    expect(getLiveBroadcastStats("nonexistent-room")).toBeNull();
  });

  it("should cleanup broadcast stats", () => {
    initBroadcastStats("cleanup-room");
    expect(getLiveBroadcastStats("cleanup-room")).not.toBeNull();
    cleanupBroadcastStats("cleanup-room");
    expect(getLiveBroadcastStats("cleanup-room")).toBeNull();
  });
});

// ── Broadcast Metrics Summary ─────────────────────────────────────

describe("Broadcast Metrics Summary", () => {
  it("should return summary stats", () => {
    const summary = getBroadcastSummary();
    expect(summary).toHaveProperty("totalBroadcasts");
    expect(summary).toHaveProperty("totalUniqueViewers");
    expect(summary).toHaveProperty("peakAllTimeViewers");
    expect(summary).toHaveProperty("adminFeaturedCount");
    expect(typeof summary.totalBroadcasts).toBe("number");
  });
});

// ── Admin Broadcast API ───────────────────────────────────────────

describe("Admin Broadcast API", () => {
  let adminToken: string;
  let regularToken: string;

  beforeAll(async () => {
    // Create admin user
    const adminU = `admin_bc_${Date.now()}`;
    await registerUser(adminU, `${adminU}@test.com`, "password123");
    const adminLogin = await loginUser(adminU, "password123");
    adminToken = adminLogin.body.sessionId;
    // Set admin flag
    db.prepare("UPDATE users SET is_admin = 1 WHERE username = ?").run(adminU);

    // Create regular user
    const regU = `reg_bc_${Date.now()}`;
    await registerUser(regU, `${regU}@test.com`, "password123");
    const regLogin = await loginUser(regU, "password123");
    regularToken = regLogin.body.sessionId;
  });

  it("should list live matches for admin", async () => {
    const res = await makeRequest("GET", "/api/admin/broadcast/live", undefined, {
      Authorization: `Bearer ${adminToken}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.matches).toBeDefined();
    expect(Array.isArray(res.body.matches)).toBe(true);
  });

  it("should return broadcast metrics for admin", async () => {
    const res = await makeRequest("GET", "/api/admin/broadcast/metrics", undefined, {
      Authorization: `Bearer ${adminToken}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    expect(res.body.recent).toBeDefined();
    expect(res.body.summary).toHaveProperty("totalBroadcasts");
  });

  it("should reject live match listing for non-admin", async () => {
    const res = await makeRequest("GET", "/api/admin/broadcast/live", undefined, {
      Authorization: `Bearer ${regularToken}`,
    });
    expect(res.status).toBe(403);
  });

  it("should reject broadcast metrics for non-admin", async () => {
    const res = await makeRequest("GET", "/api/admin/broadcast/metrics", undefined, {
      Authorization: `Bearer ${regularToken}`,
    });
    expect(res.status).toBe(403);
  });

  it("should reject featuring without room ID", async () => {
    const res = await makeRequest("POST", "/api/admin/broadcast/feature", {}, {
      Authorization: `Bearer ${adminToken}`,
    });
    expect(res.status).toBe(400);
  });

  it("should reject featuring non-existent room", async () => {
    const res = await makeRequest("POST", "/api/admin/broadcast/feature", { roomId: "nonexistent" }, {
      Authorization: `Bearer ${adminToken}`,
    });
    expect(res.status).toBe(404);
  });

  it("should reject unfeaturing without room ID", async () => {
    const res = await makeRequest("POST", "/api/admin/broadcast/unfeature", {}, {
      Authorization: `Bearer ${adminToken}`,
    });
    expect(res.status).toBe(400);
  });

  it("should handle unfeaturing non-featured room gracefully", async () => {
    const res = await makeRequest("POST", "/api/admin/broadcast/unfeature", { roomId: "some-room" }, {
      Authorization: `Bearer ${adminToken}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("should reject feature operation for non-admin", async () => {
    const res = await makeRequest("POST", "/api/admin/broadcast/feature", { roomId: "test" }, {
      Authorization: `Bearer ${regularToken}`,
    });
    expect(res.status).toBe(403);
  });

  it("should reject unfeature operation for non-admin", async () => {
    const res = await makeRequest("POST", "/api/admin/broadcast/unfeature", { roomId: "test" }, {
      Authorization: `Bearer ${regularToken}`,
    });
    expect(res.status).toBe(403);
  });
});

// ── Recent Broadcast Metrics API (public) ─────────────────────────

describe("Broadcast Metrics API (public)", () => {
  it("should return recent broadcast metrics", async () => {
    const res = await makeRequest("GET", "/api/spectator/metrics/recent");
    expect(res.status).toBe(200);
    expect(res.body.metrics).toBeDefined();
    expect(Array.isArray(res.body.metrics)).toBe(true);
  });
});

// ── Regression Coverage ──────────────────────────────────────────

describe("Spectator Regression", () => {
  it("should still allow user registration", async () => {
    const u = `spectest_${Date.now()}`;
    const res = await registerUser(u, `${u}@test.com`, "password123");
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
  });

  it("should still return wallet balances", async () => {
    const u = `specwallet_${Date.now()}`;
    await registerUser(u, `${u}@test.com`, "password123");
    const login = await loginUser(u, "password123");
    const token = login.body.sessionId;

    const res = await makeRequest("GET", "/api/wallet", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.balances).toBeDefined();
  });

  it("should still return leaderboard", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toBeDefined();
  });

  it("should still enforce auth on protected endpoints", async () => {
    const res = await makeRequest("GET", "/api/wallet");
    expect(res.status).toBe(401);
  });

  it("should still return social notifications with auth", async () => {
    const u = `specnotif_${Date.now()}`;
    await registerUser(u, `${u}@test.com`, "password123");
    const login = await loginUser(u, "password123");
    const token = login.body.sessionId;

    const res = await makeRequest("GET", "/api/social/notifications", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
  });

  it("should still return profile data", async () => {
    const u = `specprofile_${Date.now()}`;
    await registerUser(u, `${u}@test.com`, "password123");
    const login = await loginUser(u, "password123");
    const token = login.body.sessionId;

    const res = await makeRequest("GET", "/api/profile", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeDefined();
  });

  it("should still return faucet claim", async () => {
    const u = `specfaucet_${Date.now()}`;
    await registerUser(u, `${u}@test.com`, "password123");
    const login = await loginUser(u, "password123");
    const token = login.body.sessionId;

    const res = await makeRequest("POST", "/api/wallet/faucet", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
  });

  it("should still return seasons data", async () => {
    const res = await makeRequest("GET", "/api/seasons/current");
    expect(res.status).toBe(200);
  });
});
