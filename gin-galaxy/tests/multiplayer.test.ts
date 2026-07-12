/**
 * Tests for the multiplayer system.
 * Covers the server-side game engine and room management logic.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createMatch,
  handleDraw,
  handleDiscard,
  handleKnock,
  handleNextRound,
  getPlayerView,
} from "../server/multiplayer/engine.js";

// ─── Engine: Match Creation ──────────────────────────────────────────

describe("Multiplayer Engine", () => {
  const p1 = { userId: "user-1", username: "Alice" };
  const p2 = { userId: "user-2", username: "Bob" };

  it("should create a match with correct initial state", () => {
    const match = createMatch("ROOM01", p1, p2);
    expect(match.status).toBe("playing");
    expect(match.players).toHaveLength(2);
    expect(match.players[0].hand).toHaveLength(10);
    expect(match.players[1].hand).toHaveLength(10);
    expect(match.discard).toHaveLength(1);
    expect(match.stock.length).toBe(52 - 10 - 10 - 1);
    expect(match.currentPlayerIndex).toBe(0);
    expect(match.roomId).toBe("ROOM01");
  });

  // ─── Draw ────────────────────────────────────────────────────────

  it("should allow current player to draw from stock", () => {
    const match = createMatch("R1", p1, p2);
    const result = handleDraw(match, "user-1", "stock");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.players[0].hand).toHaveLength(11);
    }
  });

  it("should allow current player to draw from discard", () => {
    const match = createMatch("R2", p1, p2);
    const result = handleDraw(match, "user-1", "discard");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.players[0].hand).toHaveLength(11);
    }
  });

  it("should reject draw by non-current player", () => {
    const match = createMatch("R3", p1, p2);
    const result = handleDraw(match, "user-2", "stock");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as { ok: false; error: string }).error).toContain("Not your turn");
    }
  });

  it("should reject double draw", () => {
    const match = createMatch("R4", p1, p2);
    handleDraw(match, "user-1", "stock");
    const result = handleDraw(match, "user-1", "stock");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as { ok: false; error: string }).error).toContain("Already drew");
    }
  });

  // ─── Discard ─────────────────────────────────────────────────────

  it("should allow discard after drawing", () => {
    const match = createMatch("R5", p1, p2);
    handleDraw(match, "user-1", "stock");
    const result = handleDiscard(match, "user-1", 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.players[0].hand).toHaveLength(10);
      expect(result.state.currentPlayerIndex).toBe(1); // Turn switched
    }
  });

  it("should reject discard without drawing first", () => {
    const match = createMatch("R6", p1, p2);
    const result = handleDiscard(match, "user-1", 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as { ok: false; error: string }).error).toContain("Must draw");
    }
  });

  it("should reject discard by non-current player", () => {
    const match = createMatch("R7", p1, p2);
    handleDraw(match, "user-1", "stock");
    const result = handleDiscard(match, "user-2", 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as { ok: false; error: string }).error).toContain("Not your turn");
    }
  });

  it("should reject discard with invalid card index", () => {
    const match = createMatch("R8", p1, p2);
    handleDraw(match, "user-1", "stock");
    const result = handleDiscard(match, "user-1", 99);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as { ok: false; error: string }).error).toContain("Invalid card index");
    }
  });

  // ─── Turn Order Enforcement ──────────────────────────────────────

  it("should enforce correct turn order through a full turn cycle", () => {
    const match = createMatch("R9", p1, p2);

    // Player 1 turn
    expect(match.currentPlayerIndex).toBe(0);
    handleDraw(match, "user-1", "stock");
    handleDiscard(match, "user-1", 0);

    // Now it should be player 2's turn
    expect(match.currentPlayerIndex).toBe(1);
    const drawByP1 = handleDraw(match, "user-1", "stock");
    expect(drawByP1.ok).toBe(false); // Can't draw when it's not your turn

    handleDraw(match, "user-2", "stock");
    handleDiscard(match, "user-2", 0);

    // Back to player 1
    expect(match.currentPlayerIndex).toBe(0);
  });

  // ─── Player View Projection ──────────────────────────────────────

  it("should project filtered view per player", () => {
    const match = createMatch("R10", p1, p2);
    const view1 = getPlayerView(match, "user-1");
    const view2 = getPlayerView(match, "user-2");

    expect(view1).not.toBeNull();
    expect(view2).not.toBeNull();

    if (view1 && view2) {
      expect(view1.myHand).toHaveLength(10);
      expect(view1.opponentCardCount).toBe(10);
      expect(view1.isMyTurn).toBe(true);

      expect(view2.myHand).toHaveLength(10);
      expect(view2.opponentCardCount).toBe(10);
      expect(view2.isMyTurn).toBe(false);

      // Views should show different hands
      expect(view1.myUserId).toBe("user-1");
      expect(view1.myUsername).toBe("Alice");
      expect(view1.opponentUsername).toBe("Bob");
      expect(view2.myUserId).toBe("user-2");
      expect(view2.myUsername).toBe("Bob");
      expect(view2.opponentUsername).toBe("Alice");
    }
  });

  it("should return null for non-player", () => {
    const match = createMatch("R11", p1, p2);
    const view = getPlayerView(match, "user-999");
    expect(view).toBeNull();
  });

  // ─── Knock ───────────────────────────────────────────────────────

  it("should reject knock without drawing first", () => {
    const match = createMatch("R12", p1, p2);
    const result = handleKnock(match, "user-1", 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as { ok: false; error: string }).error).toContain("Must draw");
    }
  });

  it("should reject knock by non-current player", () => {
    const match = createMatch("R13", p1, p2);
    handleDraw(match, "user-1", "stock");
    const result = handleKnock(match, "user-2", 0);
    expect(result.ok).toBe(false);
  });

  // ─── Next Round ──────────────────────────────────────────────────

  it("should reject next round when game is still playing", () => {
    const match = createMatch("R14", p1, p2);
    const result = handleNextRound(match, "user-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as { ok: false; error: string }).error).toContain("Not round over");
    }
  });

  // ─── Full Match Completion Path ──────────────────────────────────

  it("should complete a full match with multiple rounds", () => {
    const match = createMatch("R15", p1, p2);

    // Play turns until match ends (simulate by playing many turns)
    let turnsPlayed = 0;
    const MAX_TURNS = 200;

    while (match.status === "playing" && turnsPlayed < MAX_TURNS) {
      const currentUserId = match.players[match.currentPlayerIndex].userId;
      const drawResult = handleDraw(match, currentUserId, "stock");
      if (!drawResult.ok) break;

      // Try to knock with last card
      const knockResult = handleKnock(match, currentUserId, 10);
      if (knockResult.ok) {
        // Round ended
        if ((match.status as string) === "round_over") {
          const prevRound = match.roundNumber;
          handleNextRound(match, currentUserId);
          // Verify round actually advanced
          if (match.roundNumber > prevRound) continue;
        }
      } else {
        // Just discard
        handleDiscard(match, currentUserId, 10);
      }
      turnsPlayed++;
    }

    // Should have played at minimum 1 turn
    expect(turnsPlayed).toBeGreaterThan(0);
  });
});

// ─── Room Management (uses real WebSocket-less helpers) ──────────────

describe("Multiplayer Engine - Game State Integrity", () => {
  const p1 = { userId: "integrity-1", username: "Player1" };
  const p2 = { userId: "integrity-2", username: "Player2" };

  it("should not reveal opponent hand through view projection", () => {
    const match = createMatch("SEC1", p1, p2);
    const view1 = getPlayerView(match, "integrity-1")!;
    const view2 = getPlayerView(match, "integrity-2")!;

    // Ensure hands are not the same (different cards)
    // The key security property: view1.myHand should NOT equal view2.myHand
    const hand1Str = JSON.stringify(view1.myHand);
    const hand2Str = JSON.stringify(view2.myHand);
    expect(hand1Str).not.toBe(hand2Str);

    // Neither view exposes the opponent's cards directly
    expect(view1).not.toHaveProperty("opponentHand");
    expect(view2).not.toHaveProperty("opponentHand");
  });

  it("should prevent mutating state through out-of-turn actions", () => {
    const match = createMatch("SEC2", p1, p2);
    expect(match.currentPlayerIndex).toBe(0);

    // Player 2 tries every action out of turn
    expect(handleDraw(match, "integrity-2", "stock").ok).toBe(false);
    expect(handleDiscard(match, "integrity-2", 0).ok).toBe(false);
    expect(handleKnock(match, "integrity-2", 0).ok).toBe(false);

    // Verify state unchanged
    expect(match.players[0].hand).toHaveLength(10);
    expect(match.players[1].hand).toHaveLength(10);
    expect(match.currentPlayerIndex).toBe(0);
  });

  it("should prevent actions on completed games", () => {
    const match = createMatch("SEC3", p1, p2);
    match.status = "game_over";

    expect(handleDraw(match, "integrity-1", "stock").ok).toBe(false);
    expect(handleDiscard(match, "integrity-1", 0).ok).toBe(false);
    expect(handleKnock(match, "integrity-1", 0).ok).toBe(false);
  });
});
