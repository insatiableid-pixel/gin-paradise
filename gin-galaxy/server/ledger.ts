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

/** Persisted money precision: one public coin equals 100 integer units. */
export const MONEY_SCALE = 100;

export function toMoneyUnits(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error("Money amount must be finite");
  return Math.round(amount * MONEY_SCALE);
}

export function fromMoneyUnits(units: number): number {
  return units / MONEY_SCALE;
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
  getFaucetClaim: Database.Statement;
  upsertFaucetClaim: Database.Statement;
} | null = null;

function stmts() {
  if (!_stmts) {
    _stmts = {
      getWallet: db.prepare(
        `SELECT
          COALESCE(gold_coin_units, ROUND(gold_coins * 100)) AS gold_coin_units,
          COALESCE(sweeps_coin_units, ROUND(sweeps_coins * 100)) AS sweeps_coin_units
         FROM wallets WHERE user_id = ?`
      ),
      upsertGold: db.prepare(`
        INSERT INTO wallets (user_id, gold_coins, sweeps_coins, gold_coin_units, sweeps_coin_units)
        VALUES (?, ?, 0, ?, 0)
        ON CONFLICT(user_id)
        DO UPDATE SET
          gold_coin_units = COALESCE(gold_coin_units, ROUND(gold_coins * 100)) + excluded.gold_coin_units,
          gold_coins = (COALESCE(gold_coin_units, ROUND(gold_coins * 100)) + excluded.gold_coin_units) / 100.0,
          updated_at = CURRENT_TIMESTAMP
      `),
      upsertSweeps: db.prepare(`
        INSERT INTO wallets (user_id, gold_coins, sweeps_coins, gold_coin_units, sweeps_coin_units)
        VALUES (?, 0, ?, 0, ?)
        ON CONFLICT(user_id)
        DO UPDATE SET
          sweeps_coin_units = COALESCE(sweeps_coin_units, ROUND(sweeps_coins * 100)) + excluded.sweeps_coin_units,
          sweeps_coins = (COALESCE(sweeps_coin_units, ROUND(sweeps_coins * 100)) + excluded.sweeps_coin_units) / 100.0,
          updated_at = CURRENT_TIMESTAMP
      `),
      insertTxn: db.prepare(`
        INSERT INTO transactions
          (id, user_id, currency, amount, amount_units, type, balance_after, balance_after_units, reference, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getRecent: db.prepare(`
        SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
      `),
      getLastFaucet: db.prepare(`
        SELECT created_at FROM transactions
        WHERE user_id = ? AND type = 'faucet'
        ORDER BY created_at DESC LIMIT 1
      `),
      getFaucetClaim: db.prepare("SELECT claimed_at FROM faucet_claims WHERE user_id = ?"),
      upsertFaucetClaim: db.prepare(`
        INSERT INTO faucet_claims (user_id, claimed_at) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET claimed_at = excluded.claimed_at
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
  const row = stmts().getWallet.get(userId) as
    | { gold_coin_units: number; sweeps_coin_units: number }
    | undefined;
  return row
    ? { gold_coins: fromMoneyUnits(row.gold_coin_units), sweeps_coins: fromMoneyUnits(row.sweeps_coin_units) }
    : { gold_coins: 0, sweeps_coins: 0 };
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
  const amountUnits = toMoneyUnits(amount);
  const canonicalAmount = fromMoneyUnits(amountUnits);
  const txnId = crypto.randomUUID();
  const s = stmts();

  const run = db.transaction(() => {
    // Read current balance
    const current = getBalances(userId);
    const currentUnits = toMoneyUnits(current[currency]);
    const newUnits = currentUnits + amountUnits;
    const newVal = fromMoneyUnits(newUnits);

    // Prevent negative balances
    if (newUnits < 0) {
      throw new Error(
        `Insufficient ${currency} balance: have ${current[currency]}, attempted debit of ${Math.abs(canonicalAmount)}`
      );
    }

    // Update (or create) wallet row
    if (currency === "gold_coins") {
      s.upsertGold.run(userId, canonicalAmount, amountUnits);
    } else {
      s.upsertSweeps.run(userId, canonicalAmount, amountUnits);
    }

    // Insert append-only ledger entry
    s.insertTxn.run(
      txnId, userId, currency, canonicalAmount, amountUnits,
      type, newVal, newUnits, reference, note,
    );
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
  const run = db.transaction(() => {
    const s = stmts();
    // The transaction remains the public audit record and supports databases
    // whose operators historically adjusted its timestamp during recovery.
    const legacy = s.getLastFaucet.get(userId) as { created_at: string } | undefined;
    const durable = s.getFaucetClaim.get(userId) as { claimed_at: number } | undefined;
    const lastClaimTime = legacy ? new Date(legacy.created_at).getTime() : (durable?.claimed_at ?? 0);
    const nextClaimAt = lastClaimTime + FAUCET_COOLDOWN_MS;
    const now = Date.now();
    if (lastClaimTime && now < nextClaimAt) {
      return { success: false, nextClaimAt, message: "Daily bonus already claimed. Come back later!" };
    }
    s.upsertFaucetClaim.run(userId, now);
    mutateBalance(userId, "gold_coins", FAUCET_GOLD_AMOUNT, "faucet", null, "Daily check-in");
    return { success: true };
  });
  return run.immediate();
}

/**
 * Retrieve recent transactions for a user.
 */
export function getTransactions(userId: string, limit = 20): TransactionRecord[] {
  return (stmts().getRecent.all(userId, limit) as Array<TransactionRecord & {
    amount_units?: number | null;
    balance_after_units?: number | null;
  }>).map(row => ({
    ...row,
    amount: row.amount_units == null ? row.amount : fromMoneyUnits(row.amount_units),
    balance_after: row.balance_after_units == null ? row.balance_after : fromMoneyUnits(row.balance_after_units),
  }));
}

export interface WalletLedgerDiscrepancy {
  userId: string;
  currency: Currency;
  walletUnits: number;
  ledgerUnits: number;
}

/** Read-only invariant check: each wallet balance must equal its ledger sum. */
export function reconcileWalletLedger(): WalletLedgerDiscrepancy[] {
  return db.prepare(`
    WITH currencies(currency) AS (VALUES ('gold_coins'), ('sweeps_coins')),
    ledger AS (
      SELECT user_id, currency,
        SUM(COALESCE(amount_units, ROUND(amount * 100))) AS ledger_units
      FROM transactions GROUP BY user_id, currency
    )
    SELECT w.user_id AS userId, c.currency,
      CASE c.currency
        WHEN 'gold_coins' THEN COALESCE(w.gold_coin_units, ROUND(w.gold_coins * 100))
        ELSE COALESCE(w.sweeps_coin_units, ROUND(w.sweeps_coins * 100))
      END AS walletUnits,
      COALESCE(l.ledger_units, 0) AS ledgerUnits
    FROM wallets w CROSS JOIN currencies c
    LEFT JOIN ledger l ON l.user_id = w.user_id AND l.currency = c.currency
    WHERE (CASE c.currency
      WHEN 'gold_coins' THEN COALESCE(w.gold_coin_units, ROUND(w.gold_coins * 100))
      ELSE COALESCE(w.sweeps_coin_units, ROUND(w.sweeps_coins * 100))
    END) != COALESCE(l.ledger_units, 0)
  `).all() as WalletLedgerDiscrepancy[];
}
