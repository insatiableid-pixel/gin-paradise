/**
 * Sprint-2 ApexMCTS service bridge tests.
 */
import { describe, it, expect } from "vitest";
import {
  requestApexDecision,
  checkApexAiAvailability,
} from "../server/analysis/apexAiBridge";

const sampleHand = [
  { rank: "7", suit: "♠" },
  { rank: "7", suit: "♥" },
  { rank: "7", suit: "♦" },
  { rank: "2", suit: "♣" },
  { rank: "4", suit: "♣" },
  { rank: "9", suit: "♥" },
  { rank: "J", suit: "♦" },
  { rank: "K", suit: "♠" },
  { rank: "3", suit: "♥" },
  { rank: "5", suit: "♦" },
];

describe("Apex Sprint-2 AI service bridge", () => {
  it(
    "health check succeeds when Python research stack is available",
    async () => {
      const ok = await checkApexAiAvailability();
      expect(ok).toBe(true);
    },
    15_000
  );

  it(
    "draw decision returns stock|discard with joint EV fields",
    async () => {
      const res = await requestApexDecision({
        action: "draw",
        hand: sampleHand,
        top_discard: { rank: "7", suit: "♣" },
        discard_pile: [
          { rank: "A", suit: "♠" },
          { rank: "7", suit: "♣" },
        ],
        turn: 3,
        stock_remaining: 25,
        my_score: 0,
        opp_score: 0,
        seed: 42,
        num_worlds: 15,
        use_weighted_worlds: true,
      });
      expect(res.success).toBe(true);
      expect(res.data).toBeTruthy();
      expect(["stock", "discard"]).toContain(res.data?.source);
      expect(res.data?.engine).toBe("apex_mcts_sprint2_v1");
      expect(res.data?.joint_immediate).toBeTruthy();
      // Meld-complete 7♣ should take discard
      expect(res.data?.source).toBe("discard");
    },
    20_000
  );

  it(
    "discard decision returns a valid index",
    async () => {
      const hand11 = [...sampleHand, { rank: "Q", suit: "♣" }];
      const res = await requestApexDecision({
        action: "discard",
        hand: hand11,
        drew_from_discard: false,
        drawn_card: { rank: "Q", suit: "♣" },
        discard_pile: [{ rank: "A", suit: "♠" }],
        turn: 4,
        stock_remaining: 24,
        my_score: 10,
        opp_score: 10,
      });
      expect(res.success).toBe(true);
      const idx = res.data?.discard_index;
      expect(typeof idx).toBe("number");
      expect(idx as number).toBeGreaterThanOrEqual(0);
      expect(idx as number).toBeLessThan(11);
    },
    15_000
  );
});
