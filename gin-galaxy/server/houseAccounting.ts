/**
 * House Accounting — Platform revenue tracking for Gin Paradise.
 *
 * Design principles:
 * - Every rake collection is explicitly recorded in the house ledger.
 * - House revenue is queryable and auditable by currency.
 * - Uses a dedicated house_ledger table separate from player transactions.
 * - Atomic: rake recording happens inside settlement transactions.
 *
 * NOTE: Prepared statements are lazily initialized because this module may be
 * imported before initializeDatabase() creates the required tables.
 */

import Database from "better-sqlite3";
import { db } from "./db.js";
import { fromMoneyUnits, toMoneyUnits } from "./ledger.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type Currency = "gold_coins" | "sweeps_coins";  // sweeps_coins retained for DB compat

export interface HouseLedgerEntry {
  id: string;
  currency: Currency;
  amount: number;
  type: "rake" | "admin_adjustment";
  room_id: string | null;
  stake_id: string | null;
  winner_id: string | null;
  loser_id: string | null;
  note: string | null;
  created_at: string;
}

export interface HouseRevenueSummary {
  currency: Currency;
  total_revenue: number;
  transaction_count: number;
}

// ─── Lazy Prepared Statements ───────────────────────────────────────────

let _stmts: {
  insertEntry: Database.Statement;
  getRecent: Database.Statement;
  getRevenueByCurrency: Database.Statement;
} | null = null;

function stmts() {
  if (!_stmts) {
    _stmts = {
      insertEntry: db.prepare(`
        INSERT INTO house_ledger
          (id, currency, amount, amount_units, type, room_id, stake_id, winner_id, loser_id, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getRecent: db.prepare(`
        SELECT * FROM house_ledger ORDER BY created_at DESC LIMIT ?
      `),
      getRevenueByCurrency: db.prepare(`
        SELECT currency,
          SUM(COALESCE(amount_units, ROUND(amount * 100))) as total_revenue_units,
          COUNT(*) as transaction_count
        FROM house_ledger
        WHERE type = 'rake'
        GROUP BY currency
      `),
    };
  }
  return _stmts;
}

// ─── Record rake ────────────────────────────────────────────────────────

/**
 * Record a rake collection in the house ledger.
 *
 * @param currency   Which currency the rake is in
 * @param amount     The rake amount (always positive)
 * @param roomId     The room where the match occurred
 * @param stakeId    The stake preset ID
 * @param winnerId   The winner's user ID
 * @param loserId    The loser's user ID
 * @param note       Human-readable note
 * @returns The created house ledger entry ID
 */
export function recordRake(
  currency: Currency,
  amount: number,
  roomId: string,
  stakeId: string,
  winnerId: string,
  loserId: string,
  note: string | null = null,
): string {
  const id = crypto.randomUUID();
  const units = toMoneyUnits(amount);
  stmts().insertEntry.run(
    id, currency, fromMoneyUnits(units), units, "rake",
    roomId, stakeId, winnerId, loserId, note,
  );
  return id;
}

// ─── Query ──────────────────────────────────────────────────────────────

/**
 * Get recent house ledger entries.
 */
export function getHouseLedger(limit = 50): HouseLedgerEntry[] {
  return (stmts().getRecent.all(limit) as Array<HouseLedgerEntry & { amount_units?: number | null }>).map(
    row => ({ ...row, amount: row.amount_units == null ? row.amount : fromMoneyUnits(row.amount_units) }),
  );
}

/**
 * Get total house revenue grouped by currency.
 * Returns an array with one entry per currency that has recorded revenue.
 */
export function getHouseRevenue(): HouseRevenueSummary[] {
  return (stmts().getRevenueByCurrency.all() as Array<{
    currency: Currency;
    total_revenue_units: number;
    transaction_count: number;
  }>).map(row => ({
    currency: row.currency,
    total_revenue: fromMoneyUnits(row.total_revenue_units),
    transaction_count: row.transaction_count,
  }));
}

/**
 * Convenience: get total revenue for a specific currency.
 */
export function getHouseRevenueForCurrency(currency: Currency): number {
  const results = getHouseRevenue();
  const entry = results.find(r => r.currency === currency);
  return entry ? entry.total_revenue : 0;
}
