/**
 * Server-side game engine for multiplayer Gin Rummy.
 * This is a thin server-authoritative wrapper around the same card logic
 * used by the single-player client, but runs entirely server-side.
 *
 * Key difference from the client engine: this module never exposes raw
 * state that would reveal an opponent's hand.
 *
 * Trust Shield: All live shuffles use either a deterministic fairness-
 * derived deck or crypto.randomBytes as fallback. Math.random() is not
 * used in any live multiplayer code path.
 */

import crypto from "crypto";
import type { CardView, PlayerGameView, ShowdownData, ShowdownMeld } from "./types.js";

// ── Card Constants ───────────────────────────────────────────────────

export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

export interface Card {
  suit: Suit;
  rank: Rank;
}

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export const getCardValue = (rank: Rank): number => {
  if (rank === "A") return 1;
  if (["J", "Q", "K"].includes(rank)) return 10;
  return parseInt(rank);
};

const getRankIndex = (rank: Rank): number => RANKS.indexOf(rank);

// ── Deck ─────────────────────────────────────────────────────────────

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/**
 * Cryptographically secure Fisher-Yates shuffle (fallback path).
 * Uses crypto.randomBytes instead of Math.random().
 * In live multiplayer, the fairness module provides a deterministic deck
 * via createMatchWithDeck / startNextRoundWithDeck, so this is only used
 * for edge cases (e.g. stock depletion reshuffle).
 */
function shuffleDeck(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    // Generate 4 random bytes and use modular reduction
    const randomBytes = crypto.randomBytes(4);
    const randomValue = randomBytes.readUInt32BE(0);
    const j = randomValue % (i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ── Meld Evaluation ──────────────────────────────────────────────────

export interface HandEvaluation {
  melds: Card[][];
  deadwood: Card[];
  deadwoodValue: number;
}

function findValidMelds(cards: Card[]): Card[][] {
  const melds: Card[][] = [];

  // Sets
  const rankGroups = new Map<Rank, Card[]>();
  for (const c of cards) {
    if (!rankGroups.has(c.rank)) rankGroups.set(c.rank, []);
    rankGroups.get(c.rank)!.push(c);
  }
  for (const group of rankGroups.values()) {
    if (group.length >= 3) {
      melds.push([group[0], group[1], group[2]]);
      if (group.length === 4) {
        melds.push([group[0], group[1], group[3]]);
        melds.push([group[0], group[2], group[3]]);
        melds.push([group[1], group[2], group[3]]);
        melds.push([...group]);
      }
    }
  }

  // Runs
  const suitGroups = new Map<Suit, Card[]>();
  for (const c of cards) {
    if (!suitGroups.has(c.suit)) suitGroups.set(c.suit, []);
    suitGroups.get(c.suit)!.push(c);
  }
  for (const group of suitGroups.values()) {
    if (group.length >= 3) {
      const sorted = [...group].sort((a, b) => getRankIndex(a.rank) - getRankIndex(b.rank));
      for (let i = 0; i < sorted.length - 2; i++) {
        for (let j = i + 2; j < sorted.length; j++) {
          const run = sorted.slice(i, j + 1);
          let valid = true;
          for (let k = 1; k < run.length; k++) {
            if (getRankIndex(run[k].rank) !== getRankIndex(run[k - 1].rank) + 1) {
              valid = false;
              break;
            }
          }
          if (valid) melds.push(run);
        }
      }
    }
  }

  return melds;
}

function evaluateHand(cards: Card[]): HandEvaluation {
  const allMelds = findValidMelds(cards);
  let best: HandEvaluation = {
    melds: [],
    deadwood: cards,
    deadwoodValue: cards.reduce((s, c) => s + getCardValue(c.rank), 0),
  };

  function search(mi: number, currentMelds: Card[][], used: Set<string>) {
    const dw = cards.filter(c => !used.has(`${c.rank}${c.suit}`));
    const dwv = dw.reduce((s, c) => s + getCardValue(c.rank), 0);
    if (dwv < best.deadwoodValue) {
      best = { melds: [...currentMelds], deadwood: dw, deadwoodValue: dwv };
    }
    for (let i = mi; i < allMelds.length; i++) {
      const m = allMelds[i];
      if (m.some(c => used.has(`${c.rank}${c.suit}`))) continue;
      const nu = new Set(used);
      m.forEach(c => nu.add(`${c.rank}${c.suit}`));
      search(i + 1, [...currentMelds, m], nu);
    }
  }

  search(0, [], new Set());
  return best;
}

function canLayOff(card: Card, meld: Card[]): boolean {
  if (meld.length === 0) return false;
  const isSet = meld.every(c => c.rank === meld[0].rank);
  if (isSet) return meld.length < 4 && card.rank === meld[0].rank;
  const isRun = meld.every(c => c.suit === meld[0].suit);
  if (isRun) {
    if (card.suit !== meld[0].suit) return false;
    const sorted = [...meld].sort((a, b) => getRankIndex(a.rank) - getRankIndex(b.rank));
    const ci = getRankIndex(card.rank);
    return ci === getRankIndex(sorted[0].rank) - 1 || ci === getRankIndex(sorted[sorted.length - 1].rank) + 1;
  }
  return false;
}

function layOff(knockerMelds: Card[][], opponentDeadwood: Card[]): Card[] {
  let dw = [...opponentDeadwood];
  const active = knockerMelds.map(m => [...m]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = dw.length - 1; i >= 0; i--) {
      for (const m of active) {
        if (canLayOff(dw[i], m)) {
          m.push(dw[i]);
          dw.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
  }
  return dw;
}

function evaluateAndLayOff(hand: Card[], knockerMelds: Card[][]): HandEvaluation {
  const allMelds = findValidMelds(hand);
  let best: HandEvaluation = {
    melds: [],
    deadwood: hand,
    deadwoodValue: hand.reduce((s, c) => s + getCardValue(c.rank), 0),
  };

  function search(mi: number, currentMelds: Card[][], used: Set<string>) {
    const dw = hand.filter(c => !used.has(`${c.rank}${c.suit}`));
    const finalDw = layOff(knockerMelds, dw);
    const dwv = finalDw.reduce((s, c) => s + getCardValue(c.rank), 0);
    if (dwv < best.deadwoodValue) {
      best = { melds: [...currentMelds], deadwood: finalDw, deadwoodValue: dwv };
    }
    for (let i = mi; i < allMelds.length; i++) {
      const m = allMelds[i];
      if (m.some(c => used.has(`${c.rank}${c.suit}`))) continue;
      const nu = new Set(used);
      m.forEach(c => nu.add(`${c.rank}${c.suit}`));
      search(i + 1, [...currentMelds, m], nu);
    }
  }

  search(0, [], new Set());
  return best;
}

// ── MatchState — server-side authoritative state for one match ────────

export interface MatchPlayer {
  userId: string;
  username: string;
  hand: Card[];
  score: number;
}

export interface MatchState {
  roomId: string;
  players: [MatchPlayer, MatchPlayer];
  currentPlayerIndex: number;
  turnNumber?: number;
  stock: Card[];
  discard: Card[];
  status: "playing" | "round_over" | "game_over";
  winnerId: string | null;
  roundWinnerId: string | null;
  roundPoints: number;
  roundNumber: number;
  message: string;
}

// ── Match lifecycle ──────────────────────────────────────────────────

export function createMatch(
  roomId: string,
  p1: { userId: string; username: string },
  p2: { userId: string; username: string }
): MatchState {
  let deck = shuffleDeck(createDeck());
  const h1 = deck.splice(0, 10);
  const h2 = deck.splice(0, 10);
  const discard = [deck.pop()!];

  return {
    roomId,
    players: [
      { ...p1, hand: h1, score: 0 },
      { ...p2, hand: h2, score: 0 },
    ],
    currentPlayerIndex: 0,
    turnNumber: 1,
    stock: deck,
    discard,
    status: "playing",
    winnerId: null,
    roundWinnerId: null,
    roundPoints: 0,
    roundNumber: 1,
    message: `Game started. ${p1.username}'s turn.`,
  };
}

/**
 * Create a match with a pre-determined deck order from the fairness module.
 * The deckOrder is an array of 52 card indices (0-51) produced by the
 * deterministic fairness shuffle.
 */
export function createMatchWithDeck(
  roomId: string,
  p1: { userId: string; username: string },
  p2: { userId: string; username: string },
  deckOrder: number[]
): MatchState {
  const orderedDeck = createDeck();
  const deck = deckOrder.map(i => orderedDeck[i]);
  const h1 = deck.splice(0, 10);
  const h2 = deck.splice(0, 10);
  const discard = [deck.pop()!];

  return {
    roomId,
    players: [
      { ...p1, hand: h1, score: 0 },
      { ...p2, hand: h2, score: 0 },
    ],
    currentPlayerIndex: 0,
    turnNumber: 1,
    stock: deck,
    discard,
    status: "playing",
    winnerId: null,
    roundWinnerId: null,
    roundPoints: 0,
    roundNumber: 1,
    message: `Game started. ${p1.username}'s turn.`,
  };
}

// ── Move handlers — each returns a result or error ───────────────────

export type MoveResult =
  | { ok: true; state: MatchState; reveal?: { knockerHand: Card[]; opponentHand: Card[] }; drawnCard?: Card; knockOutcome?: "knock" | "gin" | "undercut"; discardedCard?: Card; showdownData?: ShowdownData }
  | { ok: false; error: string };

// ── Meld classification helper ──────────────────────────────────────

function classifyMeld(meld: Card[]): "set" | "run" {
  if (meld.length === 0) return "set";
  return meld.every(c => c.rank === meld[0].rank) ? "set" : "run";
}

function meldsToShowdown(melds: Card[][]): ShowdownMeld[] {
  return melds.map(m => ({
    cards: m.map(c => ({ suit: c.suit, rank: c.rank })),
    type: classifyMeld(m),
  }));
}

function cardsToView(cards: Card[]): CardView[] {
  return cards.map(c => ({ suit: c.suit, rank: c.rank }));
}

export function handleDraw(state: MatchState, userId: string, source: "stock" | "discard"): MoveResult {
  if (state.status !== "playing") return { ok: false, error: "Game is not in progress." };
  const pi = state.players.findIndex(p => p.userId === userId);
  if (pi === -1) return { ok: false, error: "Player not found." };
  if (pi !== state.currentPlayerIndex) return { ok: false, error: "Not your turn." };
  const player = state.players[pi];
  if (player.hand.length > 10) return { ok: false, error: "Already drew this turn." };

  if (source === "stock") {
    if (state.stock.length === 0) {
      const top = state.discard.pop()!;
      state.stock = shuffleDeck(state.discard);
      state.discard = [top];
    }
    const drawn = state.stock.pop()!;
    player.hand.push(drawn);
    state.message = `${player.username} drew from ${source}.`;
    return { ok: true, state, drawnCard: drawn };
  } else {
    if (state.discard.length === 0) return { ok: false, error: "Discard pile is empty." };
    const drawn = state.discard.pop()!;
    player.hand.push(drawn);
    state.message = `${player.username} drew from ${source}.`;
    return { ok: true, state, drawnCard: drawn };
  }
}

export function handleDiscard(state: MatchState, userId: string, cardIndex: number): MoveResult {
  if (state.status !== "playing") return { ok: false, error: "Game is not in progress." };
  const pi = state.players.findIndex(p => p.userId === userId);
  if (pi === -1) return { ok: false, error: "Player not found." };
  if (pi !== state.currentPlayerIndex) return { ok: false, error: "Not your turn." };
  const player = state.players[pi];
  if (player.hand.length <= 10) return { ok: false, error: "Must draw before discarding." };
  if (cardIndex < 0 || cardIndex >= player.hand.length) return { ok: false, error: "Invalid card index." };

  const [card] = player.hand.splice(cardIndex, 1);
  state.discard.push(card);
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % 2;
  state.turnNumber = (state.turnNumber ?? 1) + 1;
  state.message = `${player.username} discarded ${card.rank}${card.suit}.`;
  return { ok: true, state, discardedCard: card };
}

export function handleKnock(state: MatchState, userId: string, cardIndex: number): MoveResult {
  if (state.status !== "playing") return { ok: false, error: "Game is not in progress." };
  const pi = state.players.findIndex(p => p.userId === userId);
  if (pi === -1) return { ok: false, error: "Player not found." };
  if (pi !== state.currentPlayerIndex) return { ok: false, error: "Not your turn." };
  const player = state.players[pi];
  if (player.hand.length <= 10) return { ok: false, error: "Must draw before knocking." };
  if (cardIndex < 0 || cardIndex >= player.hand.length) return { ok: false, error: "Invalid card index." };

  const oi = (pi + 1) % 2;
  const opponent = state.players[oi];

  const newHand = [...player.hand];
  const [discarded] = newHand.splice(cardIndex, 1);

  const knockerEval = evaluateHand(newHand);
  if (knockerEval.deadwoodValue > 10) {
    return { ok: false, error: "Cannot knock with more than 10 deadwood." };
  }

  // Compute opponent evaluation — with or without layoff
  let opponentEval: HandEvaluation;
  let laidOffCards: Card[] = [];
  if (knockerEval.deadwoodValue === 0) {
    // Gin — no layoffs allowed
    opponentEval = evaluateHand(opponent.hand);
  } else {
    // Normal knock — opponent can lay off on knocker's melds
    opponentEval = evaluateAndLayOff(opponent.hand, knockerEval.melds);
    // Compute which cards were laid off: cards in opponent's hand that are NOT in opponentEval.deadwood AND NOT in opponentEval.melds
    const inMeldsSet = new Set<string>();
    for (const m of opponentEval.melds) {
      for (const c of m) inMeldsSet.add(`${c.rank}${c.suit}`);
    }
    const inDeadwoodSet = new Set<string>();
    for (const c of opponentEval.deadwood) inDeadwoodSet.add(`${c.rank}${c.suit}`);
    laidOffCards = opponent.hand.filter(c => {
      const key = `${c.rank}${c.suit}`;
      return !inMeldsSet.has(key) && !inDeadwoodSet.has(key);
    });
  }

  const opponentDw = opponentEval.deadwoodValue;

  let points = 0;
  let roundWinnerId: string;
  let msg = "";

  let knockOutcomeType: "knock" | "gin" | "undercut";
  if (knockerEval.deadwoodValue === 0) {
    points = opponentDw + 25;
    roundWinnerId = player.userId;
    msg = `${player.username} goes Gin! Wins ${points} points.`;
    knockOutcomeType = "gin";
  } else if (opponentDw <= knockerEval.deadwoodValue) {
    points = (knockerEval.deadwoodValue - opponentDw) + 25;
    roundWinnerId = opponent.userId;
    msg = `${opponent.username} undercuts! Wins ${points} points.`;
    knockOutcomeType = "undercut";
  } else {
    points = opponentDw - knockerEval.deadwoodValue;
    roundWinnerId = player.userId;
    msg = `${player.username} knocks. Wins ${points} points.`;
    knockOutcomeType = "knock";
  }

  // Apply the discard
  player.hand = newHand;
  state.discard.push(discarded);

  const wi = state.players.findIndex(p => p.userId === roundWinnerId);
  state.players[wi].score += points;
  state.roundWinnerId = roundWinnerId;
  state.roundPoints = points;

  if (state.players[wi].score >= 100) {
    state.status = "game_over";
    state.winnerId = roundWinnerId;
    msg += ` ${state.players[wi].username} wins the game!`;
  } else {
    state.status = "round_over";
  }

  state.message = msg;

  // Build structured showdown data
  const roundWinner = state.players.find(p => p.userId === roundWinnerId)!;
  const showdownData: ShowdownData = {
    knockOutcome: knockOutcomeType,
    knockerUsername: player.username,
    opponentUsername: opponent.username,
    knocker: {
      username: player.username,
      melds: meldsToShowdown(knockerEval.melds),
      deadwood: cardsToView(knockerEval.deadwood),
      deadwoodValue: knockerEval.deadwoodValue,
    },
    opponent: {
      username: opponent.username,
      melds: meldsToShowdown(opponentEval.melds),
      deadwood: cardsToView(opponentEval.deadwood),
      deadwoodValue: opponentDw,
      laidOffCards: laidOffCards.length > 0 ? cardsToView(laidOffCards) : undefined,
    },
    roundWinnerUsername: roundWinner.username,
    roundPoints: points,
  };

  return {
    ok: true,
    state,
    reveal: {
      knockerHand: player.hand,
      opponentHand: opponent.hand,
    },
    knockOutcome: knockOutcomeType,
    discardedCard: discarded,
    showdownData,
  };
}

export function handleNextRound(state: MatchState, userId: string, deckOrder?: number[]): MoveResult {
  if (state.status !== "round_over") return { ok: false, error: "Not round over." };
  // Any player in the match can trigger next round
  if (!state.players.some(p => p.userId === userId)) {
    return { ok: false, error: "Not a player in this match." };
  }

  let deck: Card[];
  if (deckOrder) {
    // Deterministic fairness-derived deck
    const orderedDeck = createDeck();
    deck = deckOrder.map(i => orderedDeck[i]);
  } else {
    // Fallback: crypto-secure shuffle
    deck = shuffleDeck(createDeck());
  }
  const h1 = deck.splice(0, 10);
  const h2 = deck.splice(0, 10);
  const discard = [deck.pop()!];

  state.players[0].hand = h1;
  state.players[1].hand = h2;
  state.stock = deck;
  state.discard = discard;
  state.status = "playing";
  state.currentPlayerIndex = 0;
  state.turnNumber = 1;
  state.roundWinnerId = null;
  state.roundPoints = 0;
  state.roundNumber = (state.roundNumber || 1) + 1;
  state.message = `New round started. ${state.players[0].username}'s turn.`;

  return { ok: true, state };
}

// ── View Projection ──────────────────────────────────────────────────

function cardToView(c: Card): CardView {
  return { suit: c.suit, rank: c.rank };
}

export function getPlayerView(state: MatchState, userId: string): PlayerGameView | null {
  const myIdx = state.players.findIndex(p => p.userId === userId);
  if (myIdx === -1) return null;
  const opIdx = (myIdx + 1) % 2;

  const me = state.players[myIdx];
  const op = state.players[opIdx];
  const topDiscard = state.discard.length > 0 ? state.discard[state.discard.length - 1] : null;

  return {
    roomId: state.roomId,
    myUserId: me.userId,
    myHand: me.hand.map(cardToView),
    opponentCardCount: op.hand.length,
    myScore: me.score,
    opponentScore: op.score,
    myUsername: me.username,
    opponentUsername: op.username,
    topDiscard: topDiscard ? cardToView(topDiscard) : null,
    stockCount: state.stock.length,
    turnNumber: state.turnNumber ?? 1,
    isMyTurn: state.currentPlayerIndex === myIdx,
    hasDrawn: me.hand.length > 10,
    status: state.status,
    message: state.message,
    winnerId: state.winnerId,
    roundWinnerId: state.roundWinnerId,
    roundPoints: state.roundPoints,
  };
}
