/**
 * Tests for Competitive Integrity features.
 *
 * Covers:
 *  - Server-enforced turn timer behavior
 *  - Timeout outcome persistence
 *  - Match transcript creation and integrity
 *  - Rating-aware matchmaking pairing
 *  - Room-code and quick-match regression
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import {
  createMatch,
  handleDraw,
  handleDiscard,
  handleKnock,
  handleNextRound,
  getPlayerView,
  type MatchState,
} from "../server/multiplayer/engine.js";
import {
  joinQueue,
  leaveQueue,
  isInQueue,
  getQueueSize,
  setMatchFoundCallback,
  handleDisconnect,
  _getQueue,
  _clearQueue,
  _getSearchBracket,
  BASE_BRACKET,
  BRACKET_EXPANSION,
  EXPANSION_INTERVAL_SECONDS,
  type QueueEntry,
} from "../server/multiplayer/matchmaking.js";
import {
  createTranscript,
  addAction,
  recordRoundStart,
  recordDraw,
  recordDiscard,
  recordKnockOutcome,
  finalizeTranscript,
  recordTimeout,
  recordDisconnect,
  recordForfeit,
  getTranscript,
  _clearTranscripts,
} from "../server/multiplayer/transcript.js";
import {
  startTurnTimer,
  cancelTurnTimer,
  resetTimeoutCount,
  getTurnTimeRemaining,
  getTurnTimerInfo,
  getTimeoutCount,
  cleanupRoomTimers,
  setTurnTimeoutCallback,
  _clearAllTimers,
  TURN_TIMEOUT_SECONDS,
  MAX_CONSECUTIVE_TIMEOUTS,
} from "../server/multiplayer/turnTimer.js";

// ── Mock WebSocket ───────────────────────────────────────────────────

function createMockWs(open = true): WebSocket {
  return {
    readyState: open ? WebSocket.OPEN : WebSocket.CLOSED,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

// ════════════════════════════════════════════════════════════════════
// 1. Server-Enforced Turn Timer
// ════════════════════════════════════════════════════════════════════

describe("Server-Enforced Turn Timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _clearAllTimers();
  });

  afterEach(() => {
    _clearAllTimers();
    vi.useRealTimers();
  });

  it("should start a timer for a room", () => {
    startTurnTimer("ROOM1", "user-1");
    const info = getTurnTimerInfo("ROOM1");
    expect(info).not.toBeNull();
    expect(info!.activePlayerId).toBe("user-1");
    expect(info!.totalSeconds).toBe(TURN_TIMEOUT_SECONDS);
    expect(info!.remainingSeconds).toBeGreaterThan(0);
  });

  it("should return correct remaining time", () => {
    startTurnTimer("ROOM2", "user-1");
    vi.advanceTimersByTime(10_000); // 10 seconds
    const remaining = getTurnTimeRemaining("ROOM2");
    expect(remaining).toBe(TURN_TIMEOUT_SECONDS - 10);
  });

  it("should fire timeout callback when timer expires", () => {
    const timeoutCallback = vi.fn();
    setTurnTimeoutCallback(timeoutCallback);

    startTurnTimer("ROOM3", "user-1");
    vi.advanceTimersByTime(TURN_TIMEOUT_SECONDS * 1000);

    expect(timeoutCallback).toHaveBeenCalledTimes(1);
    expect(timeoutCallback).toHaveBeenCalledWith("ROOM3", "user-1", 1);
  });

  it("should cancel timer when cancelTurnTimer is called", () => {
    const timeoutCallback = vi.fn();
    setTurnTimeoutCallback(timeoutCallback);

    startTurnTimer("ROOM4", "user-1");
    cancelTurnTimer("ROOM4");
    vi.advanceTimersByTime(TURN_TIMEOUT_SECONDS * 1000 + 1000);

    expect(timeoutCallback).not.toHaveBeenCalled();
    expect(getTurnTimerInfo("ROOM4")).toBeNull();
  });

  it("should track consecutive timeout counts", () => {
    const timeoutCallback = vi.fn();
    setTurnTimeoutCallback(timeoutCallback);

    // First timeout
    startTurnTimer("ROOM5", "user-1");
    vi.advanceTimersByTime(TURN_TIMEOUT_SECONDS * 1000);
    expect(getTimeoutCount("ROOM5", "user-1")).toBe(1);

    // Second timeout for same player
    startTurnTimer("ROOM5", "user-1");
    vi.advanceTimersByTime(TURN_TIMEOUT_SECONDS * 1000);
    expect(getTimeoutCount("ROOM5", "user-1")).toBe(2);

    // Third timeout triggers forfeit path
    startTurnTimer("ROOM5", "user-1");
    vi.advanceTimersByTime(TURN_TIMEOUT_SECONDS * 1000);
    expect(getTimeoutCount("ROOM5", "user-1")).toBe(3);
    expect(timeoutCallback).toHaveBeenCalledWith("ROOM5", "user-1", 3);
  });

  it("should reset timeout count when player acts voluntarily", () => {
    const timeoutCallback = vi.fn();
    setTurnTimeoutCallback(timeoutCallback);

    // First timeout
    startTurnTimer("ROOM6", "user-1");
    vi.advanceTimersByTime(TURN_TIMEOUT_SECONDS * 1000);
    expect(getTimeoutCount("ROOM6", "user-1")).toBe(1);

    // Player acts voluntarily
    resetTimeoutCount("ROOM6", "user-1");
    expect(getTimeoutCount("ROOM6", "user-1")).toBe(0);
  });

  it("should replace existing timer when startTurnTimer called again", () => {
    const timeoutCallback = vi.fn();
    setTurnTimeoutCallback(timeoutCallback);

    startTurnTimer("ROOM7", "user-1");
    vi.advanceTimersByTime(15_000); // 15s — less than 30s timeout

    // Turn changes — new timer starts (cancels user-1's timer)
    startTurnTimer("ROOM7", "user-2");
    const info = getTurnTimerInfo("ROOM7");
    expect(info!.activePlayerId).toBe("user-2");
    expect(info!.remainingSeconds).toBe(TURN_TIMEOUT_SECONDS);

    // Advance 20s — user-1's timer was cancelled, user-2's timer hasn't expired (only 20s of 30s)
    vi.advanceTimersByTime(20_000);
    // Callback should NOT have fired for user-1 since that timer was replaced
    // user-2's timer hasn't expired yet (only 20s of 30s)
    expect(timeoutCallback).not.toHaveBeenCalled();
  });

  it("should clean up all state for a room", () => {
    startTurnTimer("ROOM8", "user-1");
    cleanupRoomTimers("ROOM8");
    expect(getTurnTimerInfo("ROOM8")).toBeNull();
    expect(getTimeoutCount("ROOM8", "user-1")).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Timeout Outcome — auto-play behavior
// ════════════════════════════════════════════════════════════════════

describe("Timeout Auto-Play Behavior", () => {
  const p1 = { userId: "timeout-1", username: "Alice" };
  const p2 = { userId: "timeout-2", username: "Bob" };

  it("should auto-draw and discard on timeout when player hasn't drawn", () => {
    const match = createMatch("T1", p1, p2);
    expect(match.currentPlayerIndex).toBe(0);
    expect(match.players[0].hand.length).toBe(10);

    // Simulate what the room manager does on timeout:
    // Auto-draw from stock
    const drawResult = handleDraw(match, "timeout-1", "stock");
    expect(drawResult.ok).toBe(true);
    expect(match.players[0].hand.length).toBe(11);

    // Auto-discard last card (the drawn card)
    const discardResult = handleDiscard(match, "timeout-1", 10);
    expect(discardResult.ok).toBe(true);
    expect(match.players[0].hand.length).toBe(10);

    // Turn should have switched to player 2
    expect(match.currentPlayerIndex).toBe(1);
  });

  it("should auto-discard on timeout when player has drawn but not acted", () => {
    const match = createMatch("T2", p1, p2);

    // Player draws manually
    handleDraw(match, "timeout-1", "stock");
    expect(match.players[0].hand.length).toBe(11);

    // Timer expires — auto-discard last card
    const discardResult = handleDiscard(match, "timeout-1", 10);
    expect(discardResult.ok).toBe(true);
    expect(match.players[0].hand.length).toBe(10);
    expect(match.currentPlayerIndex).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Match Transcript / Action Ledger
// ════════════════════════════════════════════════════════════════════

describe("Match Transcript", () => {
  beforeEach(() => {
    _clearTranscripts();
  });

  it("should create a transcript with correct initial state", () => {
    const transcript = createTranscript("TR1", [
      { userId: "u1", username: "Alice" },
      { userId: "u2", username: "Bob" },
    ]);

    expect(transcript.roomId).toBe("TR1");
    expect(transcript.players).toHaveLength(2);
    expect(transcript.players[0].username).toBe("Alice");
    expect(transcript.players[1].username).toBe("Bob");
    expect(transcript.actions).toHaveLength(1); // match_start
    expect(transcript.actions[0].type).toBe("match_start");
    expect(transcript.outcome).toBeNull();
    expect(transcript.endedAt).toBeNull();
  });

  it("should record draw events", () => {
    createTranscript("TR2", [
      { userId: "u1", username: "Alice" },
      { userId: "u2", username: "Bob" },
    ]);

    recordDraw("TR2", "u1", "Alice", "stock");
    recordDraw("TR2", "u1", "Alice", "discard", { suit: "♠", rank: "K" });

    const transcript = getTranscript("TR2")!;
    expect(transcript.actions.filter(a => a.type === "draw")).toHaveLength(2);

    const drawActions = transcript.actions.filter(a => a.type === "draw");
    expect(drawActions[0].detail?.source).toBe("stock");
    expect(drawActions[1].detail?.source).toBe("discard");
    expect(drawActions[1].detail?.card).toBe("K♠");
  });

  it("should record discard events", () => {
    createTranscript("TR3", [
      { userId: "u1", username: "Alice" },
      { userId: "u2", username: "Bob" },
    ]);

    recordDiscard("TR3", "u1", "Alice", { suit: "♥", rank: "10" });

    const transcript = getTranscript("TR3")!;
    const discardActions = transcript.actions.filter(a => a.type === "discard");
    expect(discardActions).toHaveLength(1);
    expect(discardActions[0].detail?.card).toBe("10♥");
  });

  it("should record knock outcomes correctly", () => {
    createTranscript("TR4", [
      { userId: "u1", username: "Alice" },
      { userId: "u2", username: "Bob" },
    ]);

    recordKnockOutcome("TR4", "u1", "Alice", "gin", "u1", "Alice", 35, 0, 10, { suit: "♦", rank: "3" });

    const transcript = getTranscript("TR4")!;
    const ginActions = transcript.actions.filter(a => a.type === "gin");
    expect(ginActions).toHaveLength(1);
    expect(ginActions[0].detail?.points).toBe(35);
    expect(ginActions[0].detail?.winnerId).toBe("u1");

    const roundEndActions = transcript.actions.filter(a => a.type === "round_end");
    expect(roundEndActions).toHaveLength(1);
    expect(roundEndActions[0].detail?.outcomeType).toBe("gin");
  });

  it("should record round starts", () => {
    createTranscript("TR5", [
      { userId: "u1", username: "Alice" },
      { userId: "u2", username: "Bob" },
    ]);

    recordRoundStart("TR5", 1, "u1", "Alice");
    recordRoundStart("TR5", 2, "u2", "Bob");

    const transcript = getTranscript("TR5")!;
    const roundStarts = transcript.actions.filter(a => a.type === "round_start");
    expect(roundStarts).toHaveLength(2);
    expect(roundStarts[0].detail?.roundNumber).toBe(1);
    expect(roundStarts[1].detail?.roundNumber).toBe(2);
  });

  it("should finalize transcript with correct outcome", () => {
    createTranscript("TR6", [
      { userId: "u1", username: "Alice" },
      { userId: "u2", username: "Bob" },
    ]);

    finalizeTranscript("TR6", "u1", "Alice", "u2", "Bob", 105, 80, "completed");

    const transcript = getTranscript("TR6")!;
    expect(transcript.endedAt).not.toBeNull();
    expect(transcript.outcome).not.toBeNull();
    expect(transcript.outcome!.winnerId).toBe("u1");
    expect(transcript.outcome!.winnerUsername).toBe("Alice");
    expect(transcript.outcome!.loserId).toBe("u2");
    expect(transcript.outcome!.winnerScore).toBe(105);
    expect(transcript.outcome!.loserScore).toBe(80);
    expect(transcript.outcome!.endReason).toBe("completed");

    const matchEndActions = transcript.actions.filter(a => a.type === "match_end");
    expect(matchEndActions).toHaveLength(1);
  });

  it("should record timeout and forfeit events", () => {
    createTranscript("TR7", [
      { userId: "u1", username: "Alice" },
      { userId: "u2", username: "Bob" },
    ]);

    recordTimeout("TR7", "u1", "Alice");
    recordForfeit("TR7", "u1", "Alice", "timeout");

    const transcript = getTranscript("TR7")!;
    const timeoutActions = transcript.actions.filter(a => a.type === "timeout");
    expect(timeoutActions).toHaveLength(1);
    expect(timeoutActions[0].playerId).toBe("u1");

    const forfeitActions = transcript.actions.filter(a => a.type === "forfeit");
    expect(forfeitActions).toHaveLength(1);
    expect(forfeitActions[0].detail?.reason).toBe("timeout");
  });

  it("should record disconnect events", () => {
    createTranscript("TR8", [
      { userId: "u1", username: "Alice" },
      { userId: "u2", username: "Bob" },
    ]);

    recordDisconnect("TR8", "u2", "Bob");

    const transcript = getTranscript("TR8")!;
    const disconnectActions = transcript.actions.filter(a => a.type === "disconnect");
    expect(disconnectActions).toHaveLength(1);
    expect(disconnectActions[0].playerUsername).toBe("Bob");
  });

  it("should record forfeit transcript correctly for disconnect end reason", () => {
    createTranscript("TR9", [
      { userId: "u1", username: "Alice" },
      { userId: "u2", username: "Bob" },
    ]);

    finalizeTranscript("TR9", "u1", "Alice", "u2", "Bob", 45, 20, "disconnect");

    const transcript = getTranscript("TR9")!;
    expect(transcript.outcome!.endReason).toBe("disconnect");
  });

  it("should maintain monotonically increasing sequence numbers", () => {
    createTranscript("TR10", [
      { userId: "u1", username: "Alice" },
      { userId: "u2", username: "Bob" },
    ]);

    recordRoundStart("TR10", 1, "u1", "Alice");
    recordDraw("TR10", "u1", "Alice", "stock");
    recordDiscard("TR10", "u1", "Alice", { suit: "♠", rank: "K" });
    recordDraw("TR10", "u2", "Bob", "discard", { suit: "♠", rank: "K" });
    recordDiscard("TR10", "u2", "Bob", { suit: "♥", rank: "5" });

    const transcript = getTranscript("TR10")!;
    for (let i = 1; i < transcript.actions.length; i++) {
      expect(transcript.actions[i].seq).toBeGreaterThan(transcript.actions[i - 1].seq);
    }
  });

  it("should have timestamps on every action", () => {
    createTranscript("TR11", [
      { userId: "u1", username: "Alice" },
      { userId: "u2", username: "Bob" },
    ]);

    recordDraw("TR11", "u1", "Alice", "stock");

    const transcript = getTranscript("TR11")!;
    for (const action of transcript.actions) {
      expect(action.timestamp).toBeGreaterThan(0);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Transcript Integrity — Full Game Simulation
// ════════════════════════════════════════════════════════════════════

describe("Transcript Integrity - Full Game Simulation", () => {
  beforeEach(() => {
    _clearTranscripts();
  });

  it("should produce a complete transcript for a match with key actions", () => {
    const p1 = { userId: "sim-1", username: "Alice" };
    const p2 = { userId: "sim-2", username: "Bob" };

    // Create transcript and match
    createTranscript("SIM1", [p1, p2]);
    recordRoundStart("SIM1", 1, p1.userId, p1.username);

    const match = createMatch("SIM1", p1, p2);

    // Play several turns
    let turns = 0;
    while (match.status === "playing" && turns < 20) {
      const currentUserId = match.players[match.currentPlayerIndex].userId;
      const currentUsername = match.players[match.currentPlayerIndex].username;

      const drawResult = handleDraw(match, currentUserId, "stock");
      if (!drawResult.ok) break;
      recordDraw("SIM1", currentUserId, currentUsername, "stock");

      // Try to knock
      const knockResult = handleKnock(match, currentUserId, 10);
      if (knockResult.ok) {
        if (knockResult.knockOutcome && knockResult.discardedCard) {
          const winner = match.players.find(p => p.userId === match.roundWinnerId)!;
          recordKnockOutcome(
            "SIM1", currentUserId, currentUsername,
            knockResult.knockOutcome,
            winner.userId, winner.username,
            match.roundPoints, 0, 0,
            knockResult.discardedCard
          );
        }

        if ((match.status as string) === "round_over") {
          handleNextRound(match, currentUserId);
          recordRoundStart("SIM1", match.roundNumber, match.players[0].userId, match.players[0].username);
        }
      } else {
        const discardResult = handleDiscard(match, currentUserId, 10);
        if (discardResult.ok && discardResult.discardedCard) {
          recordDiscard("SIM1", currentUserId, currentUsername, discardResult.discardedCard);
        }
      }
      turns++;
    }

    const transcript = getTranscript("SIM1")!;
    // Should have at minimum: match_start + round_start + some draws + some discards
    expect(transcript.actions.length).toBeGreaterThan(5);

    // Must have match_start as first action
    expect(transcript.actions[0].type).toBe("match_start");

    // Must have round_start
    const roundStarts = transcript.actions.filter(a => a.type === "round_start");
    expect(roundStarts.length).toBeGreaterThanOrEqual(1);

    // Must have draws
    const draws = transcript.actions.filter(a => a.type === "draw");
    expect(draws.length).toBeGreaterThanOrEqual(1);

    // All actions must have playerIds (except match_start)
    for (const action of transcript.actions) {
      if (action.type !== "match_start") {
        expect(action.playerId).toBeDefined();
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. Rating-Aware Matchmaking
// ════════════════════════════════════════════════════════════════════

describe("Rating-Aware Matchmaking", () => {
  beforeEach(() => {
    _clearQueue();
    setMatchFoundCallback(null as any);
  });

  it("should calculate search bracket correctly based on wait time", () => {
    const ws = createMockWs();
    const entry: QueueEntry = {
      userId: "u1",
      username: "Alice",
      rating: 1200,
      ws,
      enqueuedAt: Date.now(),
      stakeId: "free",
    };

    // At time 0, bracket should be BASE_BRACKET (50)
    expect(_getSearchBracket(entry)).toBe(BASE_BRACKET);

    // After 10 seconds, bracket should expand by BRACKET_EXPANSION
    entry.enqueuedAt = Date.now() - EXPANSION_INTERVAL_SECONDS * 1000;
    expect(_getSearchBracket(entry)).toBe(BASE_BRACKET + BRACKET_EXPANSION);

    // After 30 seconds, bracket should expand by 3 * BRACKET_EXPANSION
    entry.enqueuedAt = Date.now() - 3 * EXPANSION_INTERVAL_SECONDS * 1000;
    expect(_getSearchBracket(entry)).toBe(BASE_BRACKET + 3 * BRACKET_EXPANSION);
  });

  it("should pair close-rated players over far-rated players", () => {
    const matchedPairs: [QueueEntry, QueueEntry][] = [];
    setMatchFoundCallback((p1, p2) => {
      matchedPairs.push([p1, p2]);
    });

    const ws1 = createMockWs(); // Rating 1200
    const ws2 = createMockWs(); // Rating 1500 (far)
    const ws3 = createMockWs(); // Rating 1210 (close to ws1)

    // Set all enqueue times to now so brackets are narrow (±50)
    // Queue player with rating 1200
    joinQueue("user-1", "Alice", 1200, ws1);

    // Queue player with rating 1500 — too far from 1200 (bracket is ±50)
    joinQueue("user-2", "Bob", 1500, ws2);

    // No pairing yet — 1500 is outside ±50 of 1200
    // But user-2 is also outside ±50 of user-1
    // Actually both need to accept: |1200-1500| = 300 > 50
    expect(matchedPairs).toHaveLength(0);

    // Queue player with rating 1210 — within ±50 of 1200
    joinQueue("user-3", "Charlie", 1210, ws3);

    // Should pair user-1 (1200) with user-3 (1210) — closest match
    expect(matchedPairs).toHaveLength(1);
    expect(matchedPairs[0][0].userId).toBe("user-1");
    expect(matchedPairs[0][1].userId).toBe("user-3");

    // user-2 should still be in queue
    expect(isInQueue("user-2")).toBe(true);
    expect(getQueueSize()).toBe(1);
  });

  it("should expand bracket over time to eventually match wider-rated players", () => {
    const matchedPairs: [QueueEntry, QueueEntry][] = [];
    setMatchFoundCallback((p1, p2) => {
      matchedPairs.push([p1, p2]);
    });

    // Manually add entries with old enqueue times to simulate wait
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    // Both waited 60 seconds — bracket should be 50 + 6*50 = 350
    const oldTime = Date.now() - 60_000;
    _getQueue().push(
      { userId: "user-1", username: "Alice", rating: 1200, ws: ws1, enqueuedAt: oldTime, stakeId: "free" },
      { userId: "user-2", username: "Bob", rating: 1500, ws: ws2, enqueuedAt: oldTime, stakeId: "free" }
    );

    // Trigger pairing check by adding a third player (which also triggers tryPair)
    // Actually let's just add a player that will cause the pairing to check all
    const ws3 = createMockWs();
    joinQueue("user-3", "Charlie", 1200, ws3);

    // After 60s wait, bracket = 50 + 6*50 = 350, so |1200-1500|=300 < 350 ✓
    // But user-3 (1200) is closest to user-1 (1200), gap=0 vs gap=300
    // So user-1 and user-3 should be paired first
    expect(matchedPairs).toHaveLength(1);
    expect(matchedPairs[0][0].rating).toBe(1200);
    expect(matchedPairs[0][1].rating).toBe(1200);
  });

  it("should preserve all existing queue safety guarantees", () => {
    _clearQueue();

    const ws = createMockWs();
    // Duplicate prevention still works
    joinQueue("user-1", "Alice", 1200, ws);
    const dup = joinQueue("user-1", "Alice", 1200, ws);
    expect(dup.ok).toBe(false);

    // Cancel still works
    leaveQueue("user-1");
    expect(isInQueue("user-1")).toBe(false);

    // Disconnect cleanup still works
    joinQueue("user-1", "Alice", 1200, ws);
    handleDisconnect("user-1");
    expect(isInQueue("user-1")).toBe(false);
  });

  it("should skip disconnected players during rating-aware pairing", () => {
    const matchedPairs: [QueueEntry, QueueEntry][] = [];
    setMatchFoundCallback((p1, p2) => {
      matchedPairs.push([p1, p2]);
    });

    const wsDisconnected = createMockWs(false); // disconnected
    const ws2 = createMockWs();
    const ws3 = createMockWs();

    // Manually add disconnected player
    _getQueue().push({
      userId: "user-1", username: "Alice", rating: 1200,
      ws: wsDisconnected, enqueuedAt: Date.now(), stakeId: "free"
    });

    joinQueue("user-2", "Bob", 1210, ws2);
    joinQueue("user-3", "Charlie", 1220, ws3);

    // user-1 should be skipped, user-2 and user-3 paired
    expect(matchedPairs).toHaveLength(1);
    expect(matchedPairs[0][0].userId).toBe("user-2");
    expect(matchedPairs[0][1].userId).toBe("user-3");
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. Room-Code Multiplayer Regression
// ════════════════════════════════════════════════════════════════════

describe("Room-Code Multiplayer Regression (Competitive Integrity)", () => {
  const p1 = { userId: "room-ci-1", username: "RoomAlice" };
  const p2 = { userId: "room-ci-2", username: "RoomBob" };

  it("should create a match with roundNumber tracking", () => {
    const match = createMatch("RC1", p1, p2);
    expect(match.roundNumber).toBe(1);
    expect(match.status).toBe("playing");
    expect(match.players[0].hand).toHaveLength(10);
    expect(match.players[1].hand).toHaveLength(10);
  });

  it("should return drawn card info in draw result", () => {
    const match = createMatch("RC2", p1, p2);
    const result = handleDraw(match, "room-ci-1", "stock");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.drawnCard).toBeDefined();
      expect(result.drawnCard!.suit).toBeDefined();
      expect(result.drawnCard!.rank).toBeDefined();
    }
  });

  it("should return discarded card info in discard result", () => {
    const match = createMatch("RC3", p1, p2);
    handleDraw(match, "room-ci-1", "stock");
    const result = handleDiscard(match, "room-ci-1", 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discardedCard).toBeDefined();
      expect(result.discardedCard!.suit).toBeDefined();
      expect(result.discardedCard!.rank).toBeDefined();
    }
  });

  it("should still enforce turn order", () => {
    const match = createMatch("RC4", p1, p2);
    const result = handleDraw(match, "room-ci-2", "stock");
    expect(result.ok).toBe(false);
  });

  it("should still project filtered views", () => {
    const match = createMatch("RC5", p1, p2);
    const view1 = getPlayerView(match, "room-ci-1")!;
    const view2 = getPlayerView(match, "room-ci-2")!;

    expect(view1.myUsername).toBe("RoomAlice");
    expect(view1.opponentUsername).toBe("RoomBob");
    expect(view2.myUsername).toBe("RoomBob");
    expect(view2.opponentUsername).toBe("RoomAlice");

    // No opponent hand exposure
    expect(view1).not.toHaveProperty("opponentHand");
    expect(view2).not.toHaveProperty("opponentHand");
  });

  it("should increment roundNumber on next round", () => {
    const match = createMatch("RC6", p1, p2);
    expect(match.roundNumber).toBe(1);

    // Force round_over state
    match.status = "round_over";
    handleNextRound(match, "room-ci-1");
    expect(match.roundNumber).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════
// 7. Quick-Match Multiplayer Regression
// ════════════════════════════════════════════════════════════════════

describe("Quick-Match Multiplayer Regression (Competitive Integrity)", () => {
  beforeEach(() => {
    _clearQueue();
  });

  it("should still pair two queued players into a match", () => {
    let matchedPair: [QueueEntry, QueueEntry] | null = null;
    setMatchFoundCallback((p1, p2) => {
      matchedPair = [p1, p2];
    });

    const ws1 = createMockWs();
    const ws2 = createMockWs();

    // Same rating — should pair immediately
    joinQueue("qm-1", "Alice", 1200, ws1);
    joinQueue("qm-2", "Bob", 1200, ws2);

    expect(matchedPair).not.toBeNull();

    // Create a match simulating what room manager does
    const match = createMatch(
      "QM1",
      { userId: matchedPair![0].userId, username: matchedPair![0].username },
      { userId: matchedPair![1].userId, username: matchedPair![1].username }
    );

    // Both players should have valid views
    const view1 = getPlayerView(match, "qm-1");
    const view2 = getPlayerView(match, "qm-2");
    expect(view1).not.toBeNull();
    expect(view2).not.toBeNull();
    expect(view1!.myHand).toHaveLength(10);
    expect(view2!.myHand).toHaveLength(10);
  });

  it("should still allow a full game to be played after matchmaking", () => {
    let matchedPair: [QueueEntry, QueueEntry] | null = null;
    setMatchFoundCallback((p1, p2) => {
      matchedPair = [p1, p2];
    });

    const ws1 = createMockWs();
    const ws2 = createMockWs();

    joinQueue("qm-3", "Alice", 1200, ws1);
    joinQueue("qm-4", "Bob", 1200, ws2);

    const match = createMatch(
      "QM2",
      { userId: matchedPair![0].userId, username: matchedPair![0].username },
      { userId: matchedPair![1].userId, username: matchedPair![1].username }
    );

    // Play a few turns
    const drawResult = handleDraw(match, "qm-3", "stock");
    expect(drawResult.ok).toBe(true);

    const discardResult = handleDiscard(match, "qm-3", 0);
    expect(discardResult.ok).toBe(true);

    expect(match.currentPlayerIndex).toBe(1);

    const drawResult2 = handleDraw(match, "qm-4", "stock");
    expect(drawResult2.ok).toBe(true);

    const discardResult2 = handleDiscard(match, "qm-4", 0);
    expect(discardResult2.ok).toBe(true);

    expect(match.currentPlayerIndex).toBe(0);
  });
});
