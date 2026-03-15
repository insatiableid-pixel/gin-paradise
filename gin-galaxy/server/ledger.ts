/**
 * Coin Economy Ledger — Atomic wallet primitives for Gin Paradise.
 *
 * Single non-redeemable coin economy. No sweepstakes, no dual currency.
 *
 * Design principles:
 * - Every balance mutation is paired with an append-only transaction record.
 * - Balance updates and transaction inserts succeed or fail together (SQLite transaction).
 * - Negative balances are forbidden unless explicitly overridden.
 * - Helpers are reusable for escrow, buy-in, rake, refund, payout, and billing flows.
 *
 * NOTE: Prepared statements are lazily initialized because this module may be
 * imported before initializeDatabase() creates the wallets/transactions tables.
 */

import Database from "better-sqlite3";
import { db } from "./db.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type Currency = "gold_coins" | "sweeps_coins";  // sweeps_coins retained for DB compat, but not user-facing

export type TransactionType =
  | "faucet"              // Daily free-coin check-in (wallet faucet only)
  | "daily_grant"         // Canonical daily claim (Daily Hub)
  | "streak_reward"       // Streak check-in bonus
  | "mission_reward"      // Daily mission completion reward
  | "puzzle_reward"       // Daily puzzle completion reward
  | "signup_bonus"        // Initial balance on account creation
  | "buy_in"              // Match entry fee
  | "escrow_hold"         // Escrow reservation
  | "escrow_release"      // Escrow return
  | "prize_payout"        // Match winnings
  | "rake"                // House fee
  | "refund"              // Reversal
  | "admin_grant"         // Manual admin adjustment
  | "admin_debit"         // Manual admin removal
  | "coin_purchase"       // Stripe coin package purchase
  | "subscription_payment" // Stripe premium subscription payment
  | "offer_purchase";     // Starter offer / promotional redemption

export interface TransactionRecord {
  id: string;
  user_id: string;
  currency: Currency;
  amount: number;          // positive = credit, negative = debit
  type: TransactionType;
  balance_after: number;
  reference: string | null;
  note: string | null;
  created_at: string;
}

export interface WalletBalances {
  gold_coins: number;
  sweeps_coins: number;
}

// ─── Configuration ──────────────────────────────────────────────────────

/** Default starting balance for new accounts (single coin economy) */
export const DEFAULT_GOLD_COINS = 5_000;
export const DEFAULT_SWEEPS_COINS = 0;  // Sweeps discontinued — kept for DB compat

/** Daily check-in configuration — trivial amount, keeps habit, doesn't undermine purchases */
export const FAUCET_GOLD_AMOUNT = 500;
export const FAUCET_SWEEPS_AMOUNT = 0;  // No sweeps in coin economy
export const FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Lazy Prepared Statements ───────────────────────────────────────────
// Deferred until first use so tables are guaranteed to exist.

let _stmts: {
  getWallet: Database.Statement;
  upsertGold: Database.Statement;
  upsertSweeps: Database.Statement;
  insertTxn: Database.Statement;
  getRecent: Database.Statement;
  getLastFaucet: Database.Statement;
} | null = null;

function stmts() {
  if (!_stmts) {
    _stmts = {
      getWallet: db.prepare(
        "SELECT gold_coins, sweeps_coins FROM wallets WHERE user_id = ?"
      ),
      upsertGold: db.prepare(`
        INSERT INTO wallets (user_id, gold_coins, sweeps_coins)
        VALUES (?, ?, 0)
        ON CONFLICT(user_id)
        DO UPDATE SET gold_coins = gold_coins + excluded.gold_coins, updated_at = CURRENT_TIMESTAMP
      `),
      upsertSweeps: db.prepare(`
        INSERT INTO wallets (user_id, gold_coins, sweeps_coins)
        VALUES (?, 0, ?)
        ON CONFLICT(user_id)
        DO UPDATE SET sweeps_coins = sweeps_coins + excluded.sweeps_coins, updated_at = CURRENT_TIMESTAMP
      `),
      insertTxn: db.prepare(`
        INSERT INTO transactions (id, user_id, currency, amount, type, balance_after, reference, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getRecent: db.prepare(`
        SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
      `),
      getLastFaucet: db.prepare(`
        SELECT created_at FROM transactions
        WHERE user_id = ? AND type = 'faucet'
        ORDER BY created_at DESC LIMIT 1
      `),
    };
  }
  return _stmts;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Retrieve current wallet balances for a user.
 * Returns { gold_coins: 0, sweeps_coins: 0 } if no wallet row exists.
 */
export function getBalances(userId: string): WalletBalances {
  const row = stmts().getWallet.get(userId) as WalletBalances | undefined;
  return row ?? { gold_coins: 0, sweeps_coins: 0 };
}

/**
 * Atomically mutate a user's balance and record a transaction.
 *
 * @param userId     The user whose balance is changing
 * @param currency   Which currency to modify
 * @param amount     Positive = credit, negative = debit
 * @param type       The reason for the mutation
 * @param reference  Optional durable reference (e.g. match ID, claim ID)
 * @param note       Optional human-readable note
 * @returns The created transaction record ID
 * @throws If the debit would cause a negative balance
 */
export function mutateBalance(
  userId: string,
  currency: Currency,
  amount: number,
  type: TransactionType,
  reference: string | null = null,
  note: string | null = null,
): string {
  const txnId = crypto.randomUUID();
  const s = stmts();

  const run = db.transaction(() => {
    // Read current balance
    const current = getBalances(userId);
    const currentVal = current[currency];
    const newVal = currentVal + amount;

    // Prevent negative balances
    if (newVal < 0) {
      throw new Error(
        `Insufficient ${currency} balance: have ${currentVal}, attempted debit of ${Math.abs(amount)}`
      );
    }

    // Update (or create) wallet row
    if (currency === "gold_coins") {
      s.upsertGold.run(userId, amount);
    } else {
      s.upsertSweeps.run(userId, amount);
    }

    // Insert append-only ledger entry
    s.insertTxn.run(txnId, userId, currency, amount, type, newVal, reference, note);
  });

  run();
  return txnId;
}

/**
 * Credit the signup bonus to a new user (coins only — single economy).
 * Safe to call multiple times — will stack, so guard externally.
 */
export function creditSignupBonus(userId: string): void {
  mutateBalance(userId, "gold_coins", DEFAULT_GOLD_COINS, "signup_bonus", null, "Welcome bonus");
}

/**
 * Attempt to claim the daily faucet for a user.
 *
 * @returns { success: true } or { success: false, nextClaimAt, message }
 */
export function claimFaucet(userId: string): {
  success: boolean;
  nextClaimAt?: number;
  message?: string;
} {
  const lastClaim = stmts().getLastFaucet.get(userId) as { created_at: string } | undefined;

  if (lastClaim) {
    const lastClaimTime = new Date(lastClaim.created_at).getTime();
    const nextClaimAt = lastClaimTime + FAUCET_COOLDOWN_MS;
    if (Date.now() < nextClaimAt) {
      return {
        success: false,
        nextClaimAt,
        message: "Daily bonus already claimed. Come back later!",
      };
    }
  }

  mutateBalance(userId, "gold_coins", FAUCET_GOLD_AMOUNT, "faucet", null, "Daily check-in");

  return { success: true };
}

/**
 * Retrieve recent transactions for a user.
 */
export function getTransactions(userId: string, limit = 20): TransactionRecord[] {
  return stmts().getRecent.all(userId, limit) as TransactionRecord[];
}
