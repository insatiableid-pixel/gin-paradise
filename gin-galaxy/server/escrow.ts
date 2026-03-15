/**
 * Escrow & Stake System for Gin Paradise.
 *
 * Manages stake presets, entry fee escrow holds, and deterministic
 * settlement logic for multiplayer matches — now with configurable rake.
 *
 * Settlement formula (non-free stake):
 *   totalHeld       = entryFee × 2
 *   rakeAmount      = totalHeld × rakePercent
 *   winnerPayout    = totalHeld − rakeAmount   (= prizePool)
 *
 *   Reconciliation invariant:
 *     winnerPayout + rakeAmount = totalHeld
 *
 * Settlement rules:
 *  - Normal completed match: winner receives prizePool, platform takes rake.
 *  - Forfeit/timeout/disconnect after match start: winner receives prizePool, platform takes rake.
 *  - Match fail before proper start (< 2 players, pairing failure): full refund, no rake.
 *  - Queue cancellation: no charge (hold never created).
 *  - Free-play matches: zero entry fee, zero rake, zero payout.
 *
 * Design:
 *  - Uses ledger primitives (mutateBalance) for every balance mutation.
 *  - Every escrow operation creates explicit ledger entries (escrow_hold, prize_payout, rake, refund).
 *  - Rake is recorded in the house_ledger via recordRake() for platform revenue tracking.
 *  - Escrow state is tracked in-memory per room, with the ledger as the durable audit trail.
 *  - All balance checks use server-side wallet reads (never trust client).
 */

import {
  mutateBalance,
  getBalances,
  type Currency,
} from "./ledger.js";
import { recordRake } from "./houseAccounting.js";

// ─── Stake Presets ─────────────────────────────────────────────────────

export interface StakePreset {
  id: string;
  label: string;
  currency: Currency;
  entryFee: number;
  /** Rake as a decimal fraction (0.05 = 5%). Zero for free play. */
  rakePercent: number;
  /** Net prize pool awarded to winner (totalHeld − rakeAmount). Computed from entryFee and rakePercent. */
  prizePool: number;
  /** Rake amount per match (computed: 2 × entryFee × rakePercent). */
  rakeAmount: number;
}

/**
 * Helper to build a preset with computed prize/rake fields.
 * Ensures reconciliation: prizePool + rakeAmount = 2 × entryFee.
 */
function makePreset(
  id: string,
  label: string,
  currency: Currency,
  entryFee: number,
  rakePercent: number,
): StakePreset {
  const totalHeld = entryFee * 2;
  const rakeAmount = Math.round(totalHeld * rakePercent * 100) / 100; // round to 2 dp for clean math
  const prizePool = totalHeld - rakeAmount;
  return { id, label, currency, entryFee, rakePercent, prizePool, rakeAmount };
}

/**
 * Fixed stake presets — single-coin, profit-oriented economy.
 * All presets are symmetric: each player pays entryFee.
 * Non-free presets have a 5% rake.
 * Free play (practice) has 0% rake, 0 entry — for AI/social practice only.
 *
 * Stake ladder supports both conservative (100 Gold) and aggressive (10,000 Gold) wagering.
 */
export const STAKE_PRESETS: StakePreset[] = [
  makePreset("free",         "Practice",      "gold_coins",   0,      0     ),
  makePreset("gold_100",     "100 Coins",     "gold_coins",   100,    0.05  ),
  makePreset("gold_500",     "500 Coins",     "gold_coins",   500,    0.05  ),
  makePreset("gold_2000",    "2,000 Coins",   "gold_coins",   2000,   0.05  ),
  makePreset("gold_5000",    "5,000 Coins",   "gold_coins",   5000,   0.05  ),
  makePreset("gold_10000",   "10,000 Coins",  "gold_coins",   10000,  0.05  ),
];

export function getStakePreset(stakeId: string): StakePreset | undefined {
  return STAKE_PRESETS.find(p => p.id === stakeId);
}

export function isFreeStake(stakeId: string): boolean {
  return stakeId === "free";
}

// ─── Escrow State (in-memory, per room) ─────────────────────────────────

export interface EscrowHold {
  userId: string;
  transactionId: string;
  amount: number;
  currency: Currency;
}

export interface RoomEscrow {
  stakeId: string;
  preset: StakePreset;
  holds: EscrowHold[];
  settled: boolean;
}

const escrows = new Map<string, RoomEscrow>();

// ─── Balance Check ──────────────────────────────────────────────────────

/**
 * Check if a user can afford a given stake.
 * Returns { canAfford, balance, required } for UI feedback.
 */
export function checkBalance(
  userId: string,
  stakeId: string
): { canAfford: boolean; balance: number; required: number; currency: Currency } {
  const preset = getStakePreset(stakeId);
  if (!preset) {
    return { canAfford: false, balance: 0, required: 0, currency: "gold_coins" };
  }
  if (preset.entryFee === 0) {
    return { canAfford: true, balance: 0, required: 0, currency: preset.currency };
  }
  const balances = getBalances(userId);
  const balance = balances[preset.currency];
  return {
    canAfford: balance >= preset.entryFee,
    balance,
    required: preset.entryFee,
    currency: preset.currency,
  };
}

// ─── Hold Entry Fee ─────────────────────────────────────────────────────

/**
 * Create an escrow hold for a player joining a staked match.
 * Debits the entry fee and records it as an escrow_hold transaction.
 *
 * @throws if the user has insufficient balance
 */
export function holdEntryFee(
  roomId: string,
  userId: string,
  stakeId: string
): EscrowHold | null {
  const preset = getStakePreset(stakeId);
  if (!preset || preset.entryFee === 0) return null;

  // Debit the entry fee from the player's wallet
  const txnId = mutateBalance(
    userId,
    preset.currency,
    -preset.entryFee,
    "escrow_hold",
    roomId,
    `Match entry fee: ${preset.label}`
  );

  const hold: EscrowHold = {
    userId,
    transactionId: txnId,
    amount: preset.entryFee,
    currency: preset.currency,
  };

  // Track in room escrow state
  let escrow = escrows.get(roomId);
  if (!escrow) {
    escrow = { stakeId, preset, holds: [], settled: false };
    escrows.set(roomId, escrow);
  }
  escrow.holds.push(hold);

  return hold;
}

/**
 * Initialize escrow tracking for a room (for free matches or pre-hold setup).
 */
export function initRoomEscrow(roomId: string, stakeId: string): void {
  const preset = getStakePreset(stakeId);
  if (!preset) return;
  if (!escrows.has(roomId)) {
    escrows.set(roomId, { stakeId, preset, holds: [], settled: false });
  }
}

// ─── Settlement ─────────────────────────────────────────────────────────

export interface SettlementResult {
  type: "payout" | "refund" | "no_stake";
  winnerId?: string;
  payoutAmount?: number;
  rakeAmount?: number;
  currency?: Currency;
  details: string;
}

/**
 * Settle a completed match — winner receives the net prize pool, platform takes rake.
 * Called on normal game completion, forfeit, timeout, or disconnect.
 *
 * Settlement is atomic: payout + rake happen together.
 * Reconciliation: payoutAmount + rakeAmount = totalHeld
 */
export function settleMatch(
  roomId: string,
  winnerId: string,
  loserId: string,
  endReason: "completed" | "forfeit" | "timeout" | "disconnect"
): SettlementResult {
  const escrow = escrows.get(roomId);
  if (!escrow || escrow.settled) {
    return { type: "no_stake", details: "No active escrow for this room." };
  }

  // Free play — nothing to settle
  if (escrow.preset.entryFee === 0) {
    escrow.settled = true;
    return { type: "no_stake", details: "Free play match — no funds to settle." };
  }

  escrow.settled = true;

  const reasonLabel = endReason === "completed" ? "Match win" :
    endReason === "forfeit" ? "Opponent forfeited" :
    endReason === "timeout" ? "Opponent timed out" : "Opponent disconnected";

  const { prizePool, rakeAmount, currency } = escrow.preset;

  // Pay out the net prize pool to the winner
  mutateBalance(
    winnerId,
    currency,
    prizePool,
    "prize_payout",
    roomId,
    `${reasonLabel}: ${escrow.preset.label} (net of ${rakeAmount} rake)`
  );

  // Record rake in player ledger as an explicit "rake" transaction
  // This is a virtual deduction from the held pool, not from any player's wallet directly.
  // The rake flows from the escrow pool to the house — we record it in the house ledger.
  if (rakeAmount > 0) {
    recordRake(
      currency,
      rakeAmount,
      roomId,
      escrow.stakeId,
      winnerId,
      loserId,
      `${reasonLabel}: ${escrow.preset.label} (${(escrow.preset.rakePercent * 100).toFixed(0)}% rake)`
    );
  }

  return {
    type: "payout",
    winnerId,
    payoutAmount: prizePool,
    rakeAmount,
    currency,
    details: `${reasonLabel}. Winner receives ${prizePool} ${currency}. Platform rake: ${rakeAmount} ${currency}.`,
  };
}

/**
 * Refund all escrow holds for a match that failed before proper start.
 * E.g., pairing failure, room destroyed before game starts.
 * No rake is taken on refunds.
 */
export function refundEscrow(roomId: string): SettlementResult {
  const escrow = escrows.get(roomId);
  if (!escrow || escrow.settled) {
    return { type: "no_stake", details: "No active escrow for this room." };
  }

  if (escrow.preset.entryFee === 0) {
    escrow.settled = true;
    return { type: "no_stake", details: "Free play — nothing to refund." };
  }

  escrow.settled = true;

  // Refund each player's hold — full amount, no rake deducted
  for (const hold of escrow.holds) {
    mutateBalance(
      hold.userId,
      hold.currency,
      hold.amount,
      "refund",
      roomId,
      `Match refund: ${escrow.preset.label}`
    );
  }

  return {
    type: "refund",
    details: `Refunded ${escrow.holds.length} player(s) their ${escrow.preset.label} entry fee.`,
  };
}

// ─── Query / Cleanup ────────────────────────────────────────────────────

/**
 * Get escrow info for a room (for UI display, transcript metadata, etc.).
 */
export function getRoomEscrow(roomId: string): RoomEscrow | undefined {
  return escrows.get(roomId);
}

/**
 * Clean up escrow state for a room (called after room cleanup).
 */
export function cleanupEscrow(roomId: string): void {
  escrows.delete(roomId);
}

// ─── Test Utilities ─────────────────────────────────────────────────────

export function _clearEscrows(): void {
  escrows.clear();
}

export function _getEscrows(): Map<string, RoomEscrow> {
  return escrows;
}
