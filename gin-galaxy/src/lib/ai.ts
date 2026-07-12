/**
 * Gin Paradise — Apex v2.1 (Sprint 1 parity)
 *
 * Product port of research Apex (`docs/archive/research/gin_rummy/apex.py`):
 * - Meld / ace-two / DW-reduction / triangle / defensive draw policy
 * - Heuristic discard filter → actual-DW verification (top-K)
 * - Endgame safety weight scaling (stock ≤ 8)
 * - Paper knock hierarchy + stock/turn rules
 * - Match Equity Table (shared JSON) + Monte Carlo layoff-aware knock gate
 * - Minimal Bayesian opponent model (pickups / declines / discards)
 *
 * Objective remains heuristic (not oracle). Sprint 1 goal: parity with research Apex.
 */

import type { Card } from "./engine";
import {
  evaluateHand,
  evaluateAndLayOff,
  findValidMelds,
  getCardValue,
  getRankIndex,
  SUITS,
  RANKS,
} from "./engine";
import metData from "./data/match_equity_table.json";

// ═══════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════

const cardKey = (c: Card): string => `${c.rank}${c.suit}`;
const cardsMatch = (a: Card, b: Card): boolean => a.rank === b.rank && a.suit === b.suit;

/** Research Apex uses 0-based turn counters. */
export const TRIANGLE_CUTOFF = 6;
export const SCORE_GAP_THRESHOLD = 22;
export const MC_KNOCK_SAMPLES = 25;
export const UNDERCUT_BONUS = 25;
export const DISCARD_TOP_K = 3;

// ═══════════════════════════════════════════════════════════════
//  Match Equity Table (single source of truth JSON)
// ═══════════════════════════════════════════════════════════════

type MetTable = Record<string, Record<string, number>>;

const MET_TABLE: MetTable = metData.table as MetTable;
const MET_BUCKET_SIZE: number = (metData as { bucket_size?: number }).bucket_size ?? 10;
const MET_TARGET: number = (metData as { target_score?: number }).target_score ?? 100;

export function getMatchEquity(
  myScore: number,
  oppScore: number,
  targetScore: number = MET_TARGET
): number {
  if (myScore >= targetScore) return 1.0;
  if (oppScore >= targetScore) return 0.0;

  myScore = Math.max(0, Math.min(myScore, targetScore - 1));
  oppScore = Math.max(0, Math.min(oppScore, targetScore - 1));

  const bucketSize = MET_BUCKET_SIZE;
  const maxBucket = Math.floor((targetScore - 1) / bucketSize) * bucketSize;
  const myLo = Math.floor(myScore / bucketSize) * bucketSize;
  const myHi = Math.min(maxBucket, myLo + bucketSize);
  const oppLo = Math.floor(oppScore / bucketSize) * bucketSize;
  const oppHi = Math.min(maxBucket, oppLo + bucketSize);

  const myFrac = myHi > myLo ? (myScore - myLo) / (myHi - myLo) : 0.0;
  const oppFrac = oppHi > oppLo ? (oppScore - oppLo) / (oppHi - oppLo) : 0.0;

  const getVal = (m: number, o: number): number => {
    return MET_TABLE[String(m)]?.[String(o)] ?? 0.5;
  };

  const v00 = getVal(myLo, oppLo);
  const v10 = getVal(myHi, oppLo);
  const v01 = getVal(myLo, oppHi);
  const v11 = getVal(myHi, oppHi);

  const vLo = v00 * (1 - myFrac) + v10 * myFrac;
  const vHi = v01 * (1 - myFrac) + v11 * myFrac;
  return vLo * (1 - oppFrac) + vHi * oppFrac;
}

// ═══════════════════════════════════════════════════════════════
//  Minimal opponent model (Bayesian-inspired weights)
// ═══════════════════════════════════════════════════════════════

const ALL_CARDS: Card[] = (() => {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ suit, rank });
    }
  }
  return cards;
})();

export class OpponentModel {
  /** Keys known to be in discard / my hand / opponent hand. */
  private discarded = new Set<string>();
  private myHand = new Set<string>();
  private knownOpponent = new Set<string>();
  /** Relative probability weight for unknown cards. */
  private weight = new Map<string, number>();
  declined = new Set<string>();
  lastOfferedToOpp: Card | null = null;

  constructor() {
    this.reset([]);
  }

  reset(hand: Card[]): void {
    this.discarded = new Set();
    this.knownOpponent = new Set();
    this.declined = new Set();
    this.lastOfferedToOpp = null;
    this.weight = new Map();
    for (const c of ALL_CARDS) {
      this.weight.set(cardKey(c), 1.0);
    }
    this.updateMyHand(hand);
  }

  updateMyHand(hand: Card[]): void {
    for (const key of this.myHand) {
      if (!this.discarded.has(key) && !this.knownOpponent.has(key)) {
        this.weight.set(key, 1.0);
      }
    }
    this.myHand = new Set(hand.map(cardKey));
    for (const key of this.myHand) {
      this.weight.set(key, 0);
    }
  }

  setDiscard(card: Card): void {
    const key = cardKey(card);
    this.discarded.add(key);
    this.knownOpponent.delete(key);
    this.weight.set(key, 0);
  }

  observePublicDiscardPile(discardPile: Card[]): void {
    for (const c of discardPile) {
      this.setDiscard(c);
    }
  }

  opponentDrewDiscard(card: Card): void {
    const key = cardKey(card);
    this.knownOpponent.add(key);
    this.discarded.delete(key);
    this.weight.set(key, 0);
    this.boostNeighbors(card, 1.2, 1.0, 0.5);
  }

  opponentDeclinedTop(card: Card | null): void {
    if (!card) return;
    this.declined.add(cardKey(card));
    this.reduceNeighbors(card, 0.4, 0.4, 0.2);
  }

  opponentDiscarded(card: Card): void {
    const key = cardKey(card);
    this.knownOpponent.delete(key);
    this.setDiscard(card);
    this.reduceNeighbors(card, 0.4, 0.4, 0.2);
    this.lastOfferedToOpp = card;
  }

  myDiscard(card: Card): void {
    this.setDiscard(card);
    this.myHand.delete(cardKey(card));
    this.lastOfferedToOpp = card;
  }

  getKnownOpponentCards(): Card[] {
    return ALL_CARDS.filter((c) => this.knownOpponent.has(cardKey(c)));
  }

  sampleOpponentHand(nTotal = 10): Card[] {
    const known = this.getKnownOpponentCards();
    const needed = nTotal - known.length;
    if (needed <= 0) return known.slice(0, nTotal);

    const unknown = ALL_CARDS.filter((c) => {
      const k = cardKey(c);
      return (
        !this.myHand.has(k) &&
        !this.discarded.has(k) &&
        !this.knownOpponent.has(k) &&
        (this.weight.get(k) ?? 0) > 0
      );
    });

    if (unknown.length <= needed) return known.concat(unknown);

    const weights = unknown.map((c) => this.weight.get(cardKey(c)) ?? 1);
    const sampled = weightedSample(unknown, weights, needed);
    return known.concat(sampled);
  }

  private boostNeighbors(
    card: Card,
    sameRank: number,
    adjSuit: number,
    farSuit: number
  ): void {
    const ri = getRankIndex(card.rank);
    for (const s of SUITS) {
      if (s === card.suit) continue;
      this.bumpWeight(`${card.rank}${s}`, sameRank, 5);
    }
    for (const dr of [-1, 1]) {
      const nr = ri + dr;
      if (nr >= 0 && nr <= 12) this.bumpWeight(`${RANKS[nr]}${card.suit}`, adjSuit, 5);
    }
    for (const dr of [-2, 2]) {
      const nr = ri + dr;
      if (nr >= 0 && nr <= 12) this.bumpWeight(`${RANKS[nr]}${card.suit}`, farSuit, 5);
    }
  }

  private reduceNeighbors(
    card: Card,
    sameRank: number,
    adjSuit: number,
    farSuit: number
  ): void {
    const ri = getRankIndex(card.rank);
    for (const s of SUITS) {
      if (s === card.suit) continue;
      this.cutWeight(`${card.rank}${s}`, sameRank);
    }
    for (const dr of [-1, 1]) {
      const nr = ri + dr;
      if (nr >= 0 && nr <= 12) this.cutWeight(`${RANKS[nr]}${card.suit}`, adjSuit);
    }
    for (const dr of [-2, 2]) {
      const nr = ri + dr;
      if (nr >= 0 && nr <= 12) this.cutWeight(`${RANKS[nr]}${card.suit}`, farSuit);
    }
  }

  private bumpWeight(key: string, amount: number, cap: number): void {
    if (this.myHand.has(key) || this.discarded.has(key) || this.knownOpponent.has(key)) return;
    const cur = this.weight.get(key) ?? 1;
    this.weight.set(key, Math.min(cap, cur + amount));
  }

  private cutWeight(key: string, amount: number): void {
    if (this.myHand.has(key) || this.discarded.has(key) || this.knownOpponent.has(key)) return;
    const cur = this.weight.get(key) ?? 1;
    this.weight.set(key, Math.max(0.1, cur - amount));
  }
}

function weightedSample<T>(population: T[], weights: number[], k: number): T[] {
  const pool = population.map((item, i) => ({ item, w: Math.max(0, weights[i]) }));
  const result: T[] = [];
  for (let n = 0; n < k && pool.length > 0; n++) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let idx = 0;
    if (total <= 0) {
      idx = Math.floor(Math.random() * pool.length);
    } else {
      let r = Math.random() * total;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i].w;
        if (r <= 0) {
          idx = i;
          break;
        }
      }
    }
    result.push(pool[idx].item);
    pool.splice(idx, 1);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
//  Decision context
// ═══════════════════════════════════════════════════════════════

export interface ApexDecisionContext {
  /** 0-based turn number (research-compatible). */
  turn?: number;
  /** Cards remaining in stock. */
  stockRemaining?: number;
  myScore?: number;
  oppScore?: number;
  targetScore?: number;
  /** Optional live opponent model. */
  model?: OpponentModel;
  /** Prevent re-taking the card we just discarded. */
  lastDiscard?: Card | null;
}

function estimateStockRemaining(discardPile: Card[], explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  // Start-of-hand stock is 31 after deal + face-up; discard starts length 1.
  return Math.max(0, 32 - discardPile.length);
}

// ═══════════════════════════════════════════════════════════════
//  JOINT DRAW → DISCARD EV (Sprint 2, Club-side lightweight)
// ═══════════════════════════════════════════════════════════════

export interface JointDrawDiscardEval {
  takeBestRemainingDw: number;
  /** Approximate EV of drawing stock: average best remaining DW over unseen pool sample. */
  stockExpectedRemainingDw: number | null;
  currentDw: number;
  preferTake: boolean;
  delta: number;
}

/**
 * Joint evaluation: value of taking the upcard depends on the best forced discard after.
 * Lightweight Club-side proxy (no rollouts). Expert tier uses ApexMCTS service for full search.
 */
export function evaluateJointDrawDiscard(
  hand: Card[],
  topDiscard: Card,
  unseenPool: Card[],
  stockSampleSize = 12
): JointDrawDiscardEval {
  const currentDw = evaluateHand(hand).deadwoodValue;
  const takeHand = [...hand, topDiscard];
  const takeBestRemainingDw = bestDwAfterTake(takeHand, topDiscard);

  if (unseenPool.length === 0) {
    return {
      takeBestRemainingDw,
      stockExpectedRemainingDw: null,
      currentDw,
      preferTake: takeBestRemainingDw < currentDw,
      delta: currentDw - takeBestRemainingDw,
    };
  }

  const n = Math.min(stockSampleSize, unseenPool.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const c = unseenPool[i];
    const h11 = [...hand, c];
    // Stock draw: any card may be discarded
    let best = Infinity;
    for (let j = 0; j < h11.length; j++) {
      const remaining = [...h11.slice(0, j), ...h11.slice(j + 1)];
      const dw = evaluateHand(remaining).deadwoodValue;
      if (dw < best) best = dw;
    }
    sum += best;
  }
  const stockExpectedRemainingDw = sum / n;
  const preferTake = takeBestRemainingDw < stockExpectedRemainingDw;
  return {
    takeBestRemainingDw,
    stockExpectedRemainingDw,
    currentDw,
    preferTake,
    delta: stockExpectedRemainingDw - takeBestRemainingDw,
  };
}

// ═══════════════════════════════════════════════════════════════
//  DRAW
// ═══════════════════════════════════════════════════════════════

/**
 * Decide whether to draw from discard pile or stock.
 */
export function decideDrawSource(
  hand: Card[],
  topDiscard: Card | undefined,
  discardPile: Card[],
  ctx: ApexDecisionContext = {}
): "stock" | "discard" {
  if (!topDiscard) return "stock";

  // Cycle prevention
  if (ctx.lastDiscard && cardsMatch(topDiscard, ctx.lastDiscard)) {
    return "stock";
  }

  const model = ctx.model;
  model?.updateMyHand(hand);
  model?.observePublicDiscardPile(discardPile);

  // 1. Take if the discard card participates in any valid meld
  const testHand = [...hand, topDiscard];
  const melds = findValidMelds(testHand);
  if (melds.some((meld) => meld.some((c) => cardsMatch(c, topDiscard)))) {
    return "discard";
  }

  // 2. Always take Aces and Twos (low deadwood / undercut protection)
  const rankIdx = getRankIndex(topDiscard.rank);
  if (rankIdx <= 1) {
    return "discard";
  }

  // 3. Take if best achievable DW after taking + discarding is ≥4 lower
  const currentDW = evaluateHand(hand).deadwoodValue;
  const bestDWAfterTake = bestDwAfterTake(testHand, topDiscard);

  if (bestDWAfterTake < currentDW - 3) {
    return "discard";
  }

  const turn = ctx.turn ?? 0;

  // 4. Triangle formation in early game (if no DW cost)
  if (turn < TRIANGLE_CUTOFF && bestDWAfterTake <= currentDW) {
    if (formsTriangle(topDiscard, hand)) {
      return "discard";
    }
  }

  // 5. Low-DW doubles in early/mid game
  if (turn < 10 && getCardValue(topDiscard.rank) <= 3) {
    if (formsDouble(topDiscard, hand) && bestDWAfterTake <= currentDW) {
      return "discard";
    }
  }

  // 6. Defensive block draw (model-aware when available)
  if (shouldDefensiveDraw(topDiscard, hand, currentDW, bestDWAfterTake, discardPile, ctx)) {
    return "discard";
  }

  return "stock";
}

function bestDwAfterTake(hand11: Card[], restricted: Card): number {
  let best = Infinity;
  for (let i = 0; i < hand11.length; i++) {
    if (cardsMatch(hand11[i], restricted)) continue;
    const remaining = [...hand11.slice(0, i), ...hand11.slice(i + 1)];
    const dw = evaluateHand(remaining).deadwoodValue;
    if (dw < best) best = dw;
  }
  return best;
}

function formsTriangle(card: Card, hand: Card[]): boolean {
  const ri = getRankIndex(card.rank);
  const handSet = new Set(hand.map(cardKey));
  const sameRank = hand.filter((c) => c.rank === card.rank && c.suit !== card.suit);

  if (sameRank.length > 0) {
    for (const sr of sameRank) {
      for (const dr of [-1, 1]) {
        const nr = ri + dr;
        if (nr < 0 || nr > 12) continue;
        if (
          handSet.has(`${RANKS[nr]}${card.suit}`) ||
          handSet.has(`${RANKS[nr]}${sr.suit}`)
        ) {
          return true;
        }
      }
    }
  }

  for (const dr of [-1, 1]) {
    const nr = ri + dr;
    if (nr < 0 || nr > 12) continue;
    if (!handSet.has(`${RANKS[nr]}${card.suit}`)) continue;
    for (const c of hand) {
      if (c.rank === card.rank && c.suit !== card.suit) return true;
      if (getRankIndex(c.rank) === nr && c.suit !== card.suit) return true;
    }
  }
  return false;
}

function formsDouble(card: Card, hand: Card[]): boolean {
  const ri = getRankIndex(card.rank);
  for (const c of hand) {
    if (c.rank === card.rank && c.suit !== card.suit) return true;
    if (c.suit === card.suit) {
      const d = Math.abs(getRankIndex(c.rank) - ri);
      if (d >= 1 && d <= 2) return true;
    }
  }
  return false;
}

function shouldDefensiveDraw(
  card: Card,
  hand: Card[],
  currentDW: number,
  bestDWAfterTake: number,
  discardPile: Card[],
  ctx: ApexDecisionContext
): boolean {
  const model = ctx.model;
  if (model) {
    const known = model.getKnownOpponentCards();
    let oppWant = 0;
    const ri = getRankIndex(card.rank);
    for (const oppC of known) {
      if (oppC.rank === card.rank && oppC.suit !== card.suit) oppWant += 3;
      if (oppC.suit === card.suit && Math.abs(getRankIndex(oppC.rank) - ri) <= 2 && Math.abs(getRankIndex(oppC.rank) - ri) > 0) {
        oppWant += 3;
      }
    }
    if (oppWant >= 6 && bestDWAfterTake <= currentDW + 2) return true;
  }

  // Fallback: static danger when stock is mid-late
  const stockSize = estimateStockRemaining(discardPile, ctx.stockRemaining);
  if (stockSize <= 12) {
    const blockedSet = new Set([
      ...hand.map(cardKey),
      ...discardPile.map(cardKey),
    ]);
    const oppDanger = safetyDanger(card, blockedSet);
    if (oppDanger >= 3 && bestDWAfterTake <= currentDW + 2) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
//  DISCARD
// ═══════════════════════════════════════════════════════════════

/**
 * Choose which card to discard from an 11-card hand.
 * Phase 1: heuristic ranking. Phase 2: actual remaining-DW among top-K.
 * Returns the index in the hand array.
 */
export function decideDiscard(
  hand: Card[],
  drewFromDiscard: boolean,
  drawnCard: Card | null,
  discardPile: Card[],
  myScore?: number,
  oppScore?: number,
  targetScore: number = 100,
  ctx: ApexDecisionContext = {}
): number {
  void myScore;
  void oppScore;
  void targetScore;

  const model = ctx.model;
  model?.updateMyHand(hand);
  model?.observePublicDiscardPile(discardPile);

  const eval_ = evaluateHand(hand);
  const meldedSet = new Set<string>();
  for (const meld of eval_.melds) {
    for (const card of meld) meldedSet.add(cardKey(card));
  }

  let candidates = hand
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !meldedSet.has(cardKey(card)));

  if (drewFromDiscard && drawnCard) {
    candidates = candidates.filter(({ card }) => !cardsMatch(card, drawnCard));
  }

  if (candidates.length === 0) {
    candidates = hand
      .map((card, index) => ({ card, index }))
      .filter(
        ({ card }) => !(drewFromDiscard && drawnCard && cardsMatch(card, drawnCard))
      );
  }
  if (candidates.length === 0) {
    candidates = hand.map((card, index) => ({ card, index }));
  }

  const handSet = new Set(hand.map(cardKey));
  const stockSize = estimateStockRemaining(discardPile, ctx.stockRemaining);
  const turn = ctx.turn ?? 0;

  // Phase 1: heuristic scores
  const scored = candidates.map(({ card, index }) => ({
    card,
    index,
    heuristic: discardHeuristicScore(card, handSet, meldedSet, discardPile, stockSize, turn, model),
  }));
  scored.sort((a, b) => b.heuristic - a.heuristic);

  // Phase 2: actual-DW verification on top-K
  const topN = Math.min(DISCARD_TOP_K, scored.length);
  let bestIndex = scored[0].index;
  let bestCard = scored[0].card;
  let bestDw = Infinity;

  for (let i = 0; i < topN; i++) {
    const { card, index } = scored[i];
    const remaining = hand.filter((_, hi) => hi !== index);
    const actualDw = evaluateHand(remaining).deadwoodValue;
    if (
      actualDw < bestDw ||
      (actualDw === bestDw && getCardValue(card.rank) > getCardValue(bestCard.rank))
    ) {
      bestDw = actualDw;
      bestIndex = index;
      bestCard = card;
    }
  }

  model?.myDiscard(bestCard);
  return bestIndex;
}

function discardHeuristicScore(
  card: Card,
  handSet: Set<string>,
  meldedSet: Set<string>,
  discardPile: Card[],
  stockSize: number,
  turn: number,
  model?: OpponentModel
): number {
  let cardValueWeight = 100;
  let nearMeldWeight = 30;
  let safetyWeight = 15;

  if (stockSize <= 8) {
    cardValueWeight = 10;
    nearMeldWeight = 5;
    safetyWeight = 300;
  }

  let score = getCardValue(card.rank) * cardValueWeight;
  let near = nearMeldValue(card, handSet, meldedSet);
  if (turn >= 8) near = Math.floor(near / 2);
  score -= near * nearMeldWeight;

  const blockedSet = new Set([...handSet, ...discardPile.map(cardKey)]);
  const danger =
    model != null
      ? modelWeightedSafety(card, blockedSet, model)
      : safetyDanger(card, blockedSet);
  score -= danger * safetyWeight;

  if (model?.declined.has(cardKey(card))) {
    score += 20;
  }

  return score;
}

function nearMeldValue(card: Card, handSet: Set<string>, meldedSet: Set<string>): number {
  let value = 0;
  const ri = getRankIndex(card.rank);

  let sameRankCount = 0;
  for (const s of SUITS) {
    if (s !== card.suit) {
      const key = `${card.rank}${s}`;
      if (handSet.has(key) && !meldedSet.has(key)) sameRankCount++;
    }
  }
  if (sameRankCount >= 2) value += 4;
  else if (sameRankCount === 1) value += 2;

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

function safetyDanger(card: Card, blockedSet: Set<string>): number {
  let count = 0;
  const ri = getRankIndex(card.rank);

  const otherSuits = SUITS.filter((s) => s !== card.suit);
  for (let i = 0; i < otherSuits.length; i++) {
    for (let j = i + 1; j < otherSuits.length; j++) {
      if (
        !blockedSet.has(`${card.rank}${otherSuits[i]}`) &&
        !blockedSet.has(`${card.rank}${otherSuits[j]}`)
      ) {
        count++;
      }
    }
  }

  for (let startR = Math.max(0, ri - 2); startR <= Math.min(10, ri); startR++) {
    const endR = startR + 2;
    if (endR > 12) continue;
    const needed: string[] = [];
    for (let r = startR; r <= endR; r++) {
      if (r !== ri) needed.push(`${RANKS[r]}${card.suit}`);
    }
    if (needed.every((key) => !blockedSet.has(key))) count++;
  }

  return count;
}

function modelWeightedSafety(
  card: Card,
  blockedSet: Set<string>,
  model: OpponentModel
): number {
  let score = 0;
  const ri = getRankIndex(card.rank);
  const otherSuits = SUITS.filter((s) => s !== card.suit);

  for (let i = 0; i < otherSuits.length; i++) {
    for (let j = i + 1; j < otherSuits.length; j++) {
      const a = `${card.rank}${otherSuits[i]}`;
      const b = `${card.rank}${otherSuits[j]}`;
      if (!blockedSet.has(a) && !blockedSet.has(b)) {
        // Uniform weight 1 when model has no finer signal for TS path
        score += 0.5;
      }
    }
  }

  for (let startR = Math.max(0, ri - 2); startR <= Math.min(10, ri); startR++) {
    const endR = startR + 2;
    if (endR > 12) continue;
    let ok = true;
    for (let r = startR; r <= endR; r++) {
      if (r === ri) continue;
      if (blockedSet.has(`${RANKS[r]}${card.suit}`)) {
        ok = false;
        break;
      }
    }
    if (ok) score += 0.5;
  }

  if (model.declined.has(cardKey(card))) {
    score = Math.max(0, score - 2);
  }

  for (const oppC of model.getKnownOpponentCards()) {
    if (oppC.rank === card.rank && oppC.suit !== card.suit) score += 4;
    if (
      oppC.suit === card.suit &&
      Math.abs(getRankIndex(oppC.rank) - ri) > 0 &&
      Math.abs(getRankIndex(oppC.rank) - ri) <= 2
    ) {
      score += 3;
    }
  }

  return score;
}

// ═══════════════════════════════════════════════════════════════
//  KNOCK
// ═══════════════════════════════════════════════════════════════

/**
 * Decide whether to knock after discarding to 10 cards.
 * Precedence matches research Apex paper hierarchy + MET + MC layoffs.
 */
export function shouldKnock(
  hand: Card[],
  myScore?: number,
  oppScore?: number,
  targetScore: number = 100,
  ctx: ApexDecisionContext = {}
): boolean {
  const eval_ = evaluateHand(hand);
  const myDW = eval_.deadwoodValue;
  if (myDW > 10) return false;

  const turn = ctx.turn ?? 0;
  const stockRemaining = ctx.stockRemaining ?? 30;
  const scoreMy = myScore ?? ctx.myScore ?? 0;
  const scoreOpp = oppScore ?? ctx.oppScore ?? 0;
  const target = targetScore ?? ctx.targetScore ?? 100;
  const scoreDiff = scoreMy - scoreOpp;
  const dwCardsCount = eval_.deadwood.length;

  // 1. Gin always
  if (myDW === 0) return true;

  // 1b. Stock-depth override: don't risk a void hand when stock is low
  if (stockRemaining <= 8 && myDW <= 10) return true;

  // 2. Match clinch: if expected knock points win the match
  const expectedWinPoints = Math.max(10, 20 - myDW);
  if (scoreMy + expectedWinPoints >= target) return true;

  // 3. Score-gap gin seeking (paper ±22) when few DW cards
  if (scoreDiff >= SCORE_GAP_THRESHOLD && myDW > 0) {
    if (turn < 12 && scoreMy + myDW < target && dwCardsCount <= 2) {
      return false;
    }
  }
  if (scoreDiff <= -SCORE_GAP_THRESHOLD && myDW > 0) {
    if (turn < 12 && dwCardsCount <= 2) {
      return false;
    }
  }

  // 4. MET equity gate (replaces crude linear undercut prior when scores known)
  if (myScore !== undefined && oppScore !== undefined) {
    const currentEquity = getMatchEquity(scoreMy, scoreOpp, target);

    // Monte Carlo undercut probability when model available; else sample uniform unknown
    const pUndercut = estimateUndercutProbability(hand, eval_.melds, myDW, ctx);

    const winEquity = getMatchEquity(scoreMy + expectedWinPoints, scoreOpp, target);
    const undercutEquity = getMatchEquity(scoreMy, scoreOpp + (UNDERCUT_BONUS + myDW), target);
    const knockEquity = (1 - pUndercut) * winEquity + pUndercut * undercutEquity;

    if (knockEquity < currentEquity - 0.02) {
      // Still allow later aggressive rules unless we're near opponent match point
      if (scoreOpp >= target - 15 && myDW > 4) return false;
    } else if (scoreOpp >= target - 15 && myDW > 4) {
      return false;
    }
  }

  // 5. Low DW always knock
  if (myDW <= 5) return true;

  // 6. Early game aggression (research: turn <= 3)
  if (turn <= 3) return true;

  // 7. Late game preemption (research: turn >= 13)
  if (turn >= 13) return true;

  // 8. Few DW cards hold for gin
  if (myDW > 5 && dwCardsCount <= 2) return false;

  // 9. MC layoff-aware EV gate for DW 6–10 mid-game
  const mcEv = monteCarloKnockEv(hand, eval_.melds, myDW, ctx);
  const evThreshold = turn <= 8 ? -5 : -1;
  if (mcEv > evThreshold) return true;

  // Behind on score: be more aggressive
  if (scoreOpp > scoreMy) return true;

  return false;
}

function estimateUndercutProbability(
  hand: Card[],
  melds: Card[][],
  myDW: number,
  ctx: ApexDecisionContext
): number {
  const samples = MC_KNOCK_SAMPLES;
  let undercuts = 0;
  for (let i = 0; i < samples; i++) {
    const oppHand = sampleOppHand(hand, ctx);
    const oppAfter = evaluateAndLayOff(oppHand, melds);
    if (oppAfter.deadwoodValue <= myDW) undercuts++;
  }
  return undercuts / samples;
}

function monteCarloKnockEv(
  hand: Card[],
  melds: Card[][],
  myDW: number,
  ctx: ApexDecisionContext
): number {
  const samples = MC_KNOCK_SAMPLES;
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const oppHand = sampleOppHand(hand, ctx);
    const oppEval = evaluateHand(oppHand);
    // Layoffs onto knocker melds
    const afterLayoff = evaluateAndLayOff(oppHand, melds);
    const oppDwAfter = afterLayoff.deadwoodValue;
    if (myDW < oppDwAfter) {
      total += oppDwAfter - myDW;
    } else {
      total -= UNDERCUT_BONUS + myDW - oppDwAfter;
    }
    void oppEval;
  }
  return total / samples;
}

function sampleOppHand(myHand: Card[], ctx: ApexDecisionContext): Card[] {
  if (ctx.model) {
    ctx.model.updateMyHand(myHand);
    return ctx.model.sampleOpponentHand(10);
  }
  // Uniform over cards not in my hand (no discard pile awareness without model)
  const myKeys = new Set(myHand.map(cardKey));
  const pool = ALL_CARDS.filter((c) => !myKeys.has(cardKey(c)));
  // Fisher-Yates partial shuffle
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════
//  Stateful helper for GameRoom
// ═══════════════════════════════════════════════════════════════

/**
 * Session-scoped Apex brain: keeps opponent model + last discard across turns.
 */
export class ApexSession {
  readonly model = new OpponentModel();
  lastDiscard: Card | null = null;
  private initialized = false;

  beginHand(hand: Card[], discardPile: Card[] = []): void {
    this.model.reset(hand);
    this.model.observePublicDiscardPile(discardPile);
    this.lastDiscard = null;
    this.initialized = true;
  }

  ensure(hand: Card[], discardPile: Card[]): void {
    if (!this.initialized) this.beginHand(hand, discardPile);
  }

  onHumanDrewDiscard(card: Card): void {
    this.model.opponentDrewDiscard(card);
  }

  onHumanDrewStock(offeredCard: Card | null): void {
    this.model.opponentDeclinedTop(offeredCard);
  }

  onHumanDiscard(card: Card): void {
    this.model.opponentDiscarded(card);
  }

  context(
    hand: Card[],
    discardPile: Card[],
    extras: {
      turn?: number;
      stockRemaining?: number;
      myScore?: number;
      oppScore?: number;
      targetScore?: number;
    } = {}
  ): ApexDecisionContext {
    this.ensure(hand, discardPile);
    this.model.updateMyHand(hand);
    this.model.observePublicDiscardPile(discardPile);
    return {
      turn: extras.turn,
      stockRemaining: extras.stockRemaining,
      myScore: extras.myScore,
      oppScore: extras.oppScore,
      targetScore: extras.targetScore,
      model: this.model,
      lastDiscard: this.lastDiscard,
    };
  }

  noteMyDiscard(card: Card): void {
    this.lastDiscard = card;
    this.model.myDiscard(card);
  }
}
