import { describe, it, expect } from "vitest";

import { getSuitAccentColor } from "../src/lib/preferences";
import { createGame, drawCard, discardCard, type Card } from "../src/lib/engine";

function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

function expectUniqueStateCards(label: string, state: ReturnType<typeof createGame>) {
  const cards = [
    ...state.players[0].hand,
    ...state.players[1].hand,
    ...state.stock,
    ...state.discard,
  ];
  expect(cards, `${label} card count`).toHaveLength(52);
  expect(new Set(cards.map(cardKey)).size, `${label} duplicate cards`).toBe(52);
}

describe("Card Clarity", () => {
  it("uses distinct accent colors for clubs and spades in the standard deck", () => {
    expect(getSuitAccentColor("♣", false)).not.toBe(getSuitAccentColor("♠", false));
  });

  it("preserves a unique 52-card state across deal and draw-discard transitions", () => {
    let state = createGame({ id: "p1", name: "P1" }, { id: "p2", name: "P2" });
    expectUniqueStateCards("initial deal", state);

    state = drawCard(state, "p1", "stock");
    expectUniqueStateCards("player 1 stock draw", state);

    state = discardCard(state, "p1", state.players[0].hand.length - 1);
    expectUniqueStateCards("player 1 discard", state);

    state = drawCard(state, "p2", "discard");
    expectUniqueStateCards("player 2 discard pickup", state);
  });
});
