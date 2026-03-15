/**
 * Gin Paradise - Smart AI Bot (Apex-level strategy)
 *
 * Features:
 * - Meld-completing draw decisions with DW reduction evaluation
 * - Near-meld-aware discard scoring
 * - Safety-aware discard (avoid feeding opponent melds)
 * - Always-knock-when-legal strategy
 */

import type { Card, Suit, Rank } from './engine';
import { evaluateHand, findValidMelds, getCardValue, getRankIndex } from './engine';

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const cardKey = (c: Card): string => `${c.rank}${c.suit}`;
const cardsMatch = (a: Card, b: Card): boolean => a.rank === b.rank && a.suit === b.suit;

// ═══════════════════════════════════════════════════════════════
//  DRAW DECISION
// ═══════════════════════════════════════════════════════════════

/**
 * Decide whether to draw from discard pile or stock.
 * Takes from discard if:
 *   1. It immediately completes or extends a meld, OR
 *   2. It reduces deadwood by ≥4 points
 */
export function decideDrawSource(
  hand: Card[],
  topDiscard: Card | undefined,
  discardPile: Card[]
): "stock" | "discard" {
  if (!topDiscard) return "stock";

  // 1. Take if the discard card participates in any valid meld
  const testHand = [...hand, topDiscard];
  const melds = findValidMelds(testHand);
  if (melds.some(meld => meld.some(c => cardsMatch(c, topDiscard)))) {
    return "discard";
  }

  // 2. Take if best achievable DW after taking + discarding is ≥4 lower
  const currentDW = evaluateHand(hand).deadwoodValue;
  let bestDWAfterTake = Infinity;
  for (let i = 0; i < testHand.length; i++) {
    if (cardsMatch(testHand[i], topDiscard)) continue;
    const remaining = [...testHand.slice(0, i), ...testHand.slice(i + 1)];
    const dw = evaluateHand(remaining).deadwoodValue;
    if (dw < bestDWAfterTake) bestDWAfterTake = dw;
  }

  if (bestDWAfterTake < currentDW - 3) {
    return "discard";
  }

  return "stock";
}

// ═══════════════════════════════════════════════════════════════
//  DISCARD DECISION
// ═══════════════════════════════════════════════════════════════

/**
 * Choose which card to discard from an 11-card hand.
 * Scores each non-melded card by deadwood value (high = discard),
 * near-meld penalty (close to meld = keep), and safety (dangerous = keep).
 * Returns the index in the hand array.
 */
export function decideDiscard(
  hand: Card[],
  drewFromDiscard: boolean,
  drawnCard: Card | null,
  discardPile: Card[]
): number {
  const eval_ = evaluateHand(hand);
  const meldedSet = new Set<string>();
  for (const meld of eval_.melds) {
    for (const card of meld) {
      meldedSet.add(cardKey(card));
    }
  }

  // Build candidate list: prefer non-melded cards
  let candidates = hand
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !meldedSet.has(cardKey(card)));

  // Can't discard what was just drawn from discard pile
  if (drewFromDiscard && drawnCard) {
    candidates = candidates.filter(({ card }) => !cardsMatch(card, drawnCard));
  }

  // Fallback: any non-restricted card
  if (candidates.length === 0) {
    candidates = hand
      .map((card, index) => ({ card, index }))
      .filter(({ card }) =>
        !(drewFromDiscard && drawnCard && cardsMatch(card, drawnCard))
      );
  }
  if (candidates.length === 0) {
    candidates = hand.map((card, index) => ({ card, index }));
  }

  const handSet = new Set(hand.map(cardKey));
  const blockedSet = new Set([
    ...hand.map(cardKey),
    ...discardPile.map(cardKey)
  ]);

  let bestIndex = candidates[0].index;
  let bestScore = -Infinity;

  for (const { card, index } of candidates) {
    let score = getCardValue(card.rank) * 100;
    score -= nearMeldValue(card, handSet, meldedSet) * 30;
    score -= safetyDanger(card, blockedSet) * 15;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

/**
 * How close is this card to forming a meld? Higher = should keep.
 */
function nearMeldValue(card: Card, handSet: Set<string>, meldedSet: Set<string>): number {
  let value = 0;
  const ri = getRankIndex(card.rank);

  // Same-rank partners (partial set)
  let sameRankCount = 0;
  for (const s of SUITS) {
    if (s !== card.suit) {
      const key = `${card.rank}${s}`;
      if (handSet.has(key) && !meldedSet.has(key)) sameRankCount++;
    }
  }
  if (sameRankCount >= 2) value += 4;
  else if (sameRankCount === 1) value += 2;

  // Adjacent same-suit (partial run)
  let adjCount = 0;
  if (ri > 0) {
    const key = `${RANKS[ri - 1]}${card.suit}`;
    if (handSet.has(key) && !meldedSet.has(key)) adjCount++;
  }
  if (ri < 12) {
    const key = `${RANKS[ri + 1]}${card.suit}`;
    if (handSet.has(key) && !meldedSet.has(key)) adjCount++;
  }
  if (adjCount >= 2) value += 5;
  else if (adjCount === 1) value += 2;

  // Gap (rank ± 2 same suit, no direct neighbor)
  if (adjCount === 0) {
    if (ri >= 2) {
      const key = `${RANKS[ri - 2]}${card.suit}`;
      if (handSet.has(key) && !meldedSet.has(key)) value += 1;
    }
    if (ri <= 10) {
      const key = `${RANKS[ri + 2]}${card.suit}`;
      if (handSet.has(key) && !meldedSet.has(key)) value += 1;
    }
  }

  return value;
}

/**
 * How many melds could the opponent form with this card? Higher = riskier.
 */
function safetyDanger(card: Card, blockedSet: Set<string>): number {
  let count = 0;
  const ri = getRankIndex(card.rank);

  // Set melds: opponent needs 2 other suits of same rank
  const otherSuits = SUITS.filter(s => s !== card.suit);
  for (let i = 0; i < otherSuits.length; i++) {
    for (let j = i + 1; j < otherSuits.length; j++) {
      if (!blockedSet.has(`${card.rank}${otherSuits[i]}`) &&
          !blockedSet.has(`${card.rank}${otherSuits[j]}`)) {
        count++;
      }
    }
  }

  // Run melds: opponent needs 2 consecutive same-suit cards
  for (let startR = Math.max(0, ri - 2); startR <= Math.min(10, ri); startR++) {
    const endR = startR + 2;
    if (endR > 12) continue;
    const needed: string[] = [];
    for (let r = startR; r <= endR; r++) {
      if (r !== ri) needed.push(`${RANKS[r]}${card.suit}`);
    }
    if (needed.every(key => !blockedSet.has(key))) {
      count++;
    }
  }

  return count;
}

// ═══════════════════════════════════════════════════════════════
//  KNOCK DECISION
// ═══════════════════════════════════════════════════════════════

/**
 * Decide whether to knock. Always knocks when deadwood ≤ 10.
 */
export function shouldKnock(hand: Card[]): boolean {
  return evaluateHand(hand).deadwoodValue <= 10;
}
