/**
 * Meld Highlighting Utility for Gin Paradise.
 *
 * Computes which cards in the player's hand belong to the optimal meld
 * arrangement and assigns subtle color tokens for live in-hand highlighting.
 *
 * This is a pure presentation-layer function — it reuses the existing
 * evaluateHand() logic from the engine and does not invent a second
 * interpretation layer.
 */

import type { Card } from "./engine";
import { evaluateHand } from "./engine";

/** Which meld group (index in the melds array) a card belongs to, or null for deadwood */
export interface MeldHighlightMap {
  /** Maps card key ("rank+suit") to a meld group index (0, 1, 2...) or null if deadwood */
  cardToMeldIndex: Map<string, number>;
  /** Total deadwood value for the current hand */
  deadwoodValue: number;
  /** Number of distinct meld groups */
  meldCount: number;
}

/** Palette of subtle background colors for meld groups (CSS class names) */
export const MELD_COLORS = [
  "bg-emerald-50/40 border-l-[3px] border-l-emerald-500 border-t-emerald-200/50 border-r-emerald-200/50 border-b-emerald-200/50",
  "bg-sky-50/40 border-l-[3px] border-l-sky-500 border-t-sky-200/50 border-r-sky-200/50 border-b-sky-200/50",
  "bg-violet-50/40 border-l-[3px] border-l-violet-500 border-t-violet-200/50 border-r-violet-200/50 border-b-violet-200/50",
  "bg-amber-50/40 border-l-[3px] border-l-amber-500 border-t-amber-200/50 border-r-amber-200/50 border-b-amber-200/50",
  "bg-rose-50/40 border-l-[3px] border-l-rose-500 border-t-rose-200/50 border-r-rose-200/50 border-b-rose-200/50",
];

/** Get the meld highlight color classes for a given meld group index */
export function getMeldColor(meldIndex: number): string {
  return MELD_COLORS[meldIndex % MELD_COLORS.length];
}

function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`;
}

/**
 * Compute meld highlighting for a hand of cards.
 * Returns a map from card key to meld group index.
 * Cards not in any meld have no entry (treated as deadwood).
 */
export function computeMeldHighlights(hand: Card[]): MeldHighlightMap {
  if (hand.length === 0) {
    return { cardToMeldIndex: new Map(), deadwoodValue: 0, meldCount: 0 };
  }

  const evaluation = evaluateHand(hand);
  const cardToMeldIndex = new Map<string, number>();

  for (let mi = 0; mi < evaluation.melds.length; mi++) {
    for (const card of evaluation.melds[mi]) {
      cardToMeldIndex.set(cardKey(card), mi);
    }
  }

  return {
    cardToMeldIndex,
    deadwoodValue: evaluation.deadwoodValue,
    meldCount: evaluation.melds.length,
  };
}

/**
 * Check if a specific card is part of a meld in the highlight map.
 */
export function isCardInMeld(highlights: MeldHighlightMap, card: Card): boolean {
  return highlights.cardToMeldIndex.has(cardKey(card));
}

/**
 * Get the meld group index for a card, or undefined if it's deadwood.
 */
export function getCardMeldIndex(highlights: MeldHighlightMap, card: Card): number | undefined {
  return highlights.cardToMeldIndex.get(cardKey(card));
}
