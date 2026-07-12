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
  fromMoneyUnits,
  toMoneyUnits,
  type Currency,
} from "./ledger.js";
import { recordRake } from "./houseAccounting.js";
import { db } from "./db.js";

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

// ─── Durable Escrow State (SQLite, keyed by room) ───────────────────────

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

interface EscrowRow {
  room_id: string;
  stake_id: string;
  status: "active" | "settled" | "refunded";
}

interface HoldRow {
  user_id: string;
  transaction_id: string;
  amount_units: number;
  currency: Currency;
}

function loadEscrow(roomId: string): RoomEscrow | undefined {
  const row = db.prepare(
    "SELECT room_id, stake_id, status FROM room_escrows WHERE room_id = ?",
  ).get(roomId) as EscrowRow | undefined;
  if (!row) return undefined;
  const preset = getStakePreset(row.stake_id);
  if (!preset) return undefined;
  const holds = db.prepare(`
    SELECT user_id, transaction_id, amount_units, currency
    FROM escrow_holds WHERE room_id = ? ORDER BY created_at, user_id
  `).all(roomId) as HoldRow[];
  return {
    stakeId: row.stake_id,
    preset,
    settled: row.status !== "active",
    holds: holds.map(hold => ({
      userId: hold.user_id,
      transactionId: hold.transaction_id,
      amount: fromMoneyUnits(hold.amount_units),
      currency: hold.currency,
    })),
  };
}

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

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO room_escrows (room_id, stake_id) VALUES (?, ?)
      ON CONFLICT(room_id) DO NOTHING
    `).run(roomId, stakeId);
    const escrow = db.prepare(
      "SELECT stake_id, status FROM room_escrows WHERE room_id = ?",
    ).get(roomId) as { stake_id: string; status: string };
    if (escrow.stake_id !== stakeId || escrow.status !== "active") {
      throw new Error(`Escrow room ${roomId} is not active for stake ${stakeId}`);
    }

    const existing = db.prepare(`
      SELECT transaction_id, amount_units, currency FROM escrow_holds
      WHERE room_id = ? AND user_id = ?
    `).get(roomId, userId) as Omit<HoldRow, "user_id"> | undefined;
    if (existing) {
      return {
        userId,
        transactionId: existing.transaction_id,
        amount: fromMoneyUnits(existing.amount_units),
        currency: existing.currency,
      };
    }

    const txnId = mutateBalance(
      userId, preset.currency, -preset.entryFee, "escrow_hold", roomId,
      `Match entry fee: ${preset.label}`,
    );
    db.prepare(`
      INSERT INTO escrow_holds (room_id, user_id, transaction_id, amount_units, currency)
      VALUES (?, ?, ?, ?, ?)
    `).run(roomId, userId, txnId, toMoneyUnits(preset.entryFee), preset.currency);
    return { userId, transactionId: txnId, amount: preset.entryFee, currency: preset.currency };
  });
  return run.immediate();
}

/**
 * Initialize escrow tracking for a room (for free matches or pre-hold setup).
 */
export function initRoomEscrow(roomId: string, stakeId: string): void {
  const preset = getStakePreset(stakeId);
  if (!preset) return;
  db.prepare(`
    INSERT INTO room_escrows (room_id, stake_id) VALUES (?, ?)
    ON CONFLICT(room_id) DO NOTHING
  `).run(roomId, stakeId);
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
  const run = db.transaction((): SettlementResult => {
    const escrow = loadEscrow(roomId);
    if (!escrow || escrow.settled) {
      return { type: "no_stake", details: "No active escrow for this room." };
    }
    const changed = db.prepare(`
      UPDATE room_escrows SET status = 'settled', winner_id = ?, loser_id = ?,
        end_reason = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE room_id = ? AND status = 'active'
    `).run(winnerId, loserId, endReason, roomId);
    if (changed.changes !== 1) {
      return { type: "no_stake", details: "No active escrow for this room." };
    }
    if (escrow.preset.entryFee === 0) {
      return { type: "no_stake", details: "Free play match — no funds to settle." };
    }

    const reasonLabel = endReason === "completed" ? "Match win" :
      endReason === "forfeit" ? "Opponent forfeited" :
      endReason === "timeout" ? "Opponent timed out" : "Opponent disconnected";
    const totalHeldUnits = escrow.holds.reduce((sum, hold) => sum + toMoneyUnits(hold.amount), 0);
    const rakeUnits = Math.round(totalHeldUnits * escrow.preset.rakePercent);
    const payoutUnits = totalHeldUnits - rakeUnits;
    const payoutAmount = fromMoneyUnits(payoutUnits);
    const rakeAmount = fromMoneyUnits(rakeUnits);
    const { currency } = escrow.preset;
    mutateBalance(
      winnerId, currency, payoutAmount, "prize_payout", roomId,
      `${reasonLabel}: ${escrow.preset.label} (net of ${rakeAmount} rake)`,
    );
    if (rakeUnits > 0) {
      recordRake(
        currency, rakeAmount, roomId, escrow.stakeId, winnerId, loserId,
        `${reasonLabel}: ${escrow.preset.label} (${(escrow.preset.rakePercent * 100).toFixed(0)}% rake)`,
      );
    }
    return {
      type: "payout", winnerId, payoutAmount, rakeAmount, currency,
      details: `${reasonLabel}. Winner receives ${payoutAmount} ${currency}. Platform rake: ${rakeAmount} ${currency}.`,
    };
  });
  return run.immediate();
}

/**
 * Refund all escrow holds for a match that failed before proper start.
 * E.g., pairing failure, room destroyed before game starts.
 * No rake is taken on refunds.
 */
export function refundEscrow(roomId: string): SettlementResult {
  const run = db.transaction((): SettlementResult => {
    const escrow = loadEscrow(roomId);
    if (!escrow || escrow.settled) {
      return { type: "no_stake", details: "No active escrow for this room." };
    }
    const changed = db.prepare(`
      UPDATE room_escrows SET status = 'refunded', resolved_at = CURRENT_TIMESTAMP
      WHERE room_id = ? AND status = 'active'
    `).run(roomId);
    if (changed.changes !== 1) {
      return { type: "no_stake", details: "No active escrow for this room." };
    }
    if (escrow.preset.entryFee === 0) {
      return { type: "no_stake", details: "Free play — nothing to refund." };
    }
    for (const hold of escrow.holds) {
      mutateBalance(
        hold.userId, hold.currency, hold.amount, "refund", roomId,
        `Match refund: ${escrow.preset.label}`,
      );
    }
    return {
      type: "refund",
      details: `Refunded ${escrow.holds.length} player(s) their ${escrow.preset.label} entry fee.`,
    };
  });
  return run.immediate();
}

// ─── Query / Cleanup ────────────────────────────────────────────────────

/**
 * Get escrow info for a room (for UI display, transcript metadata, etc.).
 */
export function getRoomEscrow(roomId: string): RoomEscrow | undefined {
  return loadEscrow(roomId);
}

/**
 * Clean up escrow state for a room (called after room cleanup).
 */
export function cleanupEscrow(roomId: string): void {
  // Resolved rows are intentionally retained as the durable idempotency key.
  // Empty active rows (room abandoned before a hold) carry no money and may go.
  db.prepare(`
    DELETE FROM room_escrows WHERE room_id = ? AND status = 'active'
      AND NOT EXISTS (SELECT 1 FROM escrow_holds WHERE room_id = ?)
  `).run(roomId, roomId);
}

// ─── Test Utilities ─────────────────────────────────────────────────────

export function _clearEscrows(): void {
  db.transaction(() => {
    db.prepare("DELETE FROM escrow_holds").run();
    db.prepare("DELETE FROM room_escrows").run();
  })();
}

export function _getEscrows(): Map<string, RoomEscrow> {
  const result = new Map<string, RoomEscrow>();
  const rows = db.prepare("SELECT room_id FROM room_escrows").all() as { room_id: string }[];
  for (const row of rows) {
    const escrow = loadEscrow(row.room_id);
    if (escrow) result.set(row.room_id, escrow);
  }
  return result;
}

/** Refund active holds whose rooms did not survive restart/failover recovery. */
export function reconcileOrphanedEscrows(activeRoomIds: ReadonlySet<string>): string[] {
  const active = db.prepare(
    "SELECT room_id FROM room_escrows WHERE status = 'active'",
  ).all() as { room_id: string }[];
  const refunded: string[] = [];
  for (const { room_id: roomId } of active) {
    if (activeRoomIds.has(roomId)) continue;
    const result = refundEscrow(roomId);
    if (result.type === "refund") refunded.push(roomId);
  }
  return refunded;
}
