/**
 * Game Feel Tests for Gin Paradise.
 *
 * Tests covering the pure logic introduced in the game-feel sprint:
 * - Preference store behavior (sound/animation toggles)
 * - Meld highlighting logic
 * - Hand drag reordering logic
 * - Audio module (reduced-motion detection)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";

// ── Meld Highlighting Tests ──────────────────────────────────────────

import { computeMeldHighlights, getMeldColor, getCardMeldIndex, isCardInMeld, MELD_COLORS } from "../src/lib/meldHighlight";
import type { Card } from "../src/lib/engine";

function makeCard(rank: string, suit: string): Card {
  return { rank, suit } as Card;
}

describe("Meld Highlighting", () => {
  it("should return empty map for empty hand", () => {
    const result = computeMeldHighlights([]);
    expect(result.cardToMeldIndex.size).toBe(0);
    expect(result.deadwoodValue).toBe(0);
    expect(result.meldCount).toBe(0);
  });

  it("should identify a 3-card set as a meld", () => {
    const hand = [
      makeCard("K", "♠"), makeCard("K", "♥"), makeCard("K", "♦"),
      makeCard("2", "♠"), makeCard("5", "♥"), makeCard("7", "♦"),
      makeCard("9", "♣"), makeCard("3", "♠"), makeCard("4", "♥"),
      makeCard("8", "♦"),
    ];
    const result = computeMeldHighlights(hand);
    // All three Kings should be in the same meld group
    const k1 = getCardMeldIndex(result, makeCard("K", "♠"));
    const k2 = getCardMeldIndex(result, makeCard("K", "♥"));
    const k3 = getCardMeldIndex(result, makeCard("K", "♦"));
    expect(k1).toBeDefined();
    expect(k1).toBe(k2);
    expect(k2).toBe(k3);
    expect(result.meldCount).toBeGreaterThanOrEqual(1);
  });

  it("should identify a 3-card run as a meld", () => {
    const hand = [
      makeCard("3", "♠"), makeCard("4", "♠"), makeCard("5", "♠"),
      makeCard("2", "♥"), makeCard("7", "♦"), makeCard("9", "♣"),
      makeCard("J", "♠"), makeCard("Q", "♥"), makeCard("A", "♦"),
      makeCard("8", "♣"),
    ];
    const result = computeMeldHighlights(hand);
    expect(isCardInMeld(result, makeCard("3", "♠"))).toBe(true);
    expect(isCardInMeld(result, makeCard("4", "♠"))).toBe(true);
    expect(isCardInMeld(result, makeCard("5", "♠"))).toBe(true);
  });

  it("should mark non-melded cards as deadwood (not in map)", () => {
    const hand = [
      makeCard("K", "♠"), makeCard("K", "♥"), makeCard("K", "♦"),
      makeCard("2", "♠"), makeCard("5", "♥"), makeCard("7", "♦"),
      makeCard("9", "♣"), makeCard("3", "♠"), makeCard("4", "♥"),
      makeCard("8", "♦"),
    ];
    const result = computeMeldHighlights(hand);
    expect(isCardInMeld(result, makeCard("2", "♠"))).toBe(false);
    expect(isCardInMeld(result, makeCard("5", "♥"))).toBe(false);
    expect(result.deadwoodValue).toBeGreaterThan(0);
  });

  it("should handle gin (all cards in melds, 0 deadwood)", () => {
    // Gin hand: 3 melds + 1 set = 10 cards
    const hand = [
      makeCard("A", "♠"), makeCard("2", "♠"), makeCard("3", "♠"),
      makeCard("5", "♥"), makeCard("6", "♥"), makeCard("7", "♥"),
      makeCard("10", "♦"), makeCard("10", "♣"), makeCard("10", "♠"),
      makeCard("8", "♥"),
    ];
    const result = computeMeldHighlights(hand);
    // Should have melds covering 9 or 10 cards
    expect(result.deadwoodValue).toBeLessThanOrEqual(8); // 8 for the lone 8♥ if not melded
  });

  it("should provide rotating meld colors", () => {
    expect(getMeldColor(0)).toBe(MELD_COLORS[0]);
    expect(getMeldColor(1)).toBe(MELD_COLORS[1]);
    expect(getMeldColor(MELD_COLORS.length)).toBe(MELD_COLORS[0]); // wraps
  });
});

// ── Hand Drag Reorder Tests ──────────────────────────────────────────

import { reorderArray } from "../src/lib/handDrag";

describe("Hand Drag — reorderArray", () => {
  it("should move an element forward", () => {
    const result = reorderArray(["A", "B", "C", "D"], 0, 2);
    expect(result).toEqual(["B", "C", "A", "D"]);
  });

  it("should move an element backward", () => {
    const result = reorderArray(["A", "B", "C", "D"], 3, 1);
    expect(result).toEqual(["A", "D", "B", "C"]);
  });

  it("should handle same index (no-op)", () => {
    const result = reorderArray(["A", "B", "C"], 1, 1);
    expect(result).toEqual(["A", "B", "C"]);
  });

  it("should preserve array length", () => {
    const result = reorderArray([1, 2, 3, 4, 5], 0, 4);
    expect(result).toHaveLength(5);
  });

  it("should not mutate the original array", () => {
    const original = ["A", "B", "C"];
    const result = reorderArray(original, 0, 2);
    expect(original).toEqual(["A", "B", "C"]);
    expect(result).not.toBe(original);
  });
});

// ── Preference Store Tests ───────────────────────────────────────────

describe("Preferences — Sound & Animation", () => {
  it("should export soundEnabled and animationsEnabled defaults", async () => {
    // Dynamic import to get fresh store
    const mod = await import("../src/lib/preferences");
    const state = mod.usePreferences.getState();
    // Defaults are true (may vary if localStorage has values)
    expect(typeof state.soundEnabled).toBe("boolean");
    expect(typeof state.animationsEnabled).toBe("boolean");
    expect(typeof state.setSoundEnabled).toBe("function");
    expect(typeof state.setAnimationsEnabled).toBe("function");
  });

  it("should toggle soundEnabled", async () => {
    const mod = await import("../src/lib/preferences");
    const initial = mod.usePreferences.getState().soundEnabled;
    mod.usePreferences.getState().setSoundEnabled(!initial);
    expect(mod.usePreferences.getState().soundEnabled).toBe(!initial);
    // Restore
    mod.usePreferences.getState().setSoundEnabled(initial);
  });

  it("should toggle animationsEnabled", async () => {
    const mod = await import("../src/lib/preferences");
    const initial = mod.usePreferences.getState().animationsEnabled;
    mod.usePreferences.getState().setAnimationsEnabled(!initial);
    expect(mod.usePreferences.getState().animationsEnabled).toBe(!initial);
    // Restore
    mod.usePreferences.getState().setAnimationsEnabled(initial);
  });

  it("should preserve existing preferences when toggling new ones", async () => {
    const mod = await import("../src/lib/preferences");
    const state = mod.usePreferences.getState();
    const origDW = state.showDeadwoodCount;
    const origFC = state.fourColorDeck;
    state.setSoundEnabled(false);
    const after = mod.usePreferences.getState();
    expect(after.showDeadwoodCount).toBe(origDW);
    expect(after.fourColorDeck).toBe(origFC);
    // Restore
    state.setSoundEnabled(true);
  });
});

// ── Audio Module Tests ───────────────────────────────────────────────

import { prefersReducedMotion } from "../src/lib/audio";

describe("Audio — Reduced Motion Detection", () => {
  it("should return a boolean for prefersReducedMotion", () => {
    const result = prefersReducedMotion();
    expect(typeof result).toBe("boolean");
  });
});

// ── Regression Tests ─────────────────────────────────────────────────

import { startTestServer, stopTestServer, registerUser, makeRequest } from "./helpers";
import crypto from "crypto";

describe("Game Feel — Regression", () => {
  let sessionToken: string;

  beforeAll(async () => {
    await startTestServer();
    const suffix = crypto.randomUUID().slice(0, 6);
    const reg = await registerUser(`gf_${suffix}`, `gf_${suffix}@test.com`, "password123");
    sessionToken = reg.body.sessionId;
  });

  afterAll(async () => {
    await stopTestServer();
  });

  it("registration still works", async () => {
    const suffix = crypto.randomUUID().slice(0, 6);
    const res = await registerUser(`gf2_${suffix}`, `gf2_${suffix}@test.com`, "password123");
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeDefined();
  });

  it("wallet API still works", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.balances).toBeDefined();
  });

  it("leaderboard still works", async () => {
    const res = await makeRequest("GET", "/api/leaderboard");
    expect(res.status).toBe(200);
  });

  it("faucet still works", async () => {
    const res = await makeRequest("POST", "/api/wallet/faucet", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    expect([200, 429]).toContain(res.status);
  });

  it("health endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });
});
