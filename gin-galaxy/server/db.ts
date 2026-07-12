import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";

const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(process.cwd(), "database.sqlite");

export const db = new Database(DB_PATH);

/** Returns the resolved database file path for health checks and diagnostics. */
export function getDatabasePath(): string {
  return DB_PATH;
}

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

// ── SQLite Hardening ────────────────────────────────────────────────
// busy_timeout: wait up to 5s for write lock instead of failing immediately.
// Critical now that the outbox worker shares the same database file.
db.pragma("busy_timeout = 5000");

// Enforce foreign key constraints (SQLite defaults to OFF)
db.pragma("foreign_keys = ON");

// Tune WAL auto-checkpoint (default 1000 pages ≈ 4MB). Keep default but be explicit.
db.pragma("wal_autocheckpoint = 1000");

// Limit journal size to 64MB to prevent unbounded WAL growth
db.pragma("journal_size_limit = 67108864");

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      rating INTEGER DEFAULT 1200,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      opponent_name TEXT,
      user_score INTEGER,
      opponent_score INTEGER,
      is_win BOOLEAN,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS replays (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      player1_id TEXT NOT NULL,
      player1_username TEXT NOT NULL,
      player2_id TEXT NOT NULL,
      player2_username TEXT NOT NULL,
      winner_id TEXT,
      winner_username TEXT,
      loser_id TEXT,
      loser_username TEXT,
      winner_score INTEGER DEFAULT 0,
      loser_score INTEGER DEFAULT 0,
      end_reason TEXT,
      action_count INTEGER DEFAULT 0,
      transcript_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY,
      gold_coins REAL NOT NULL DEFAULT 0,
      sweeps_coins REAL NOT NULL DEFAULT 0,
      gold_coin_units INTEGER,
      sweeps_coin_units INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      currency TEXT NOT NULL CHECK(currency IN ('gold_coins', 'sweeps_coins')),
      amount REAL NOT NULL,
      amount_units INTEGER,
      type TEXT NOT NULL,
      balance_after REAL NOT NULL,
      balance_after_units INTEGER,
      reference TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS house_ledger (
      id TEXT PRIMARY KEY,
      currency TEXT NOT NULL CHECK(currency IN ('gold_coins', 'sweeps_coins')),
      amount REAL NOT NULL,
      amount_units INTEGER,
      type TEXT NOT NULL DEFAULT 'rake',
      room_id TEXT,
      stake_id TEXT,
      winner_id TEXT,
      loser_id TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_house_ledger_currency ON house_ledger(currency);
    CREATE INDEX IF NOT EXISTS idx_house_ledger_created ON house_ledger(created_at DESC);

    CREATE TABLE IF NOT EXISTS room_escrows (
      room_id TEXT PRIMARY KEY,
      stake_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'settled', 'refunded')),
      winner_id TEXT,
      loser_id TEXT,
      end_reason TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS escrow_holds (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL UNIQUE,
      amount_units INTEGER NOT NULL CHECK(amount_units >= 0),
      currency TEXT NOT NULL CHECK(currency IN ('gold_coins', 'sweeps_coins')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(room_id, user_id),
      FOREIGN KEY(room_id) REFERENCES room_escrows(room_id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS faucet_claims (
      user_id TEXT PRIMARY KEY,
      claimed_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'sit_and_go_4',
      status TEXT NOT NULL DEFAULT 'open',
      entry_fee REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'gold_coins',
      rake_percent REAL NOT NULL DEFAULT 0,
      total_pool REAL NOT NULL DEFAULT 0,
      rake_amount REAL NOT NULL DEFAULT 0,
      prize_pool REAL NOT NULL DEFAULT 0,
      entrants_json TEXT NOT NULL DEFAULT '[]',
      bracket_json TEXT,
      winner_id TEXT,
      winner_username TEXT,
      created_at INTEGER,
      started_at INTEGER,
      completed_at INTEGER,
      scheduled_start_time INTEGER,
      max_entrants INTEGER DEFAULT 4,
      min_entrants INTEGER DEFAULT 4,
      admin_created INTEGER DEFAULT 0,
      current_round INTEGER,
      total_rounds INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
    CREATE INDEX IF NOT EXISTS idx_tournaments_created ON tournaments(created_at DESC);

    CREATE TABLE IF NOT EXISTS player_spectate_preferences (
      user_id TEXT PRIMARY KEY,
      allow_spectating INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS broadcast_metrics (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      player1_id TEXT NOT NULL,
      player1_username TEXT NOT NULL,
      player2_id TEXT NOT NULL,
      player2_username TEXT NOT NULL,
      peak_concurrent_spectators INTEGER NOT NULL DEFAULT 0,
      total_unique_spectators INTEGER NOT NULL DEFAULT 0,
      was_admin_featured INTEGER NOT NULL DEFAULT 0,
      featured_reasons TEXT,
      stake_id TEXT,
      match_duration_seconds INTEGER,
      winner_id TEXT,
      winner_username TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_broadcast_metrics_room ON broadcast_metrics(room_id);
    CREATE INDEX IF NOT EXISTS idx_broadcast_metrics_created ON broadcast_metrics(created_at DESC);
  `);

  // Migrations for existing databases
  try { db.exec("ALTER TABLE users ADD COLUMN wins INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN losses INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE sessions ADD COLUMN expires_at DATETIME"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE tournaments ADD COLUMN scheduled_start_time INTEGER"); } catch {}
  try { db.exec("ALTER TABLE tournaments ADD COLUMN max_entrants INTEGER DEFAULT 4"); } catch {}
  try { db.exec("ALTER TABLE tournaments ADD COLUMN min_entrants INTEGER DEFAULT 4"); } catch {}
  try { db.exec("ALTER TABLE tournaments ADD COLUMN admin_created INTEGER DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE tournaments ADD COLUMN current_round INTEGER"); } catch {}
  try { db.exec("ALTER TABLE tournaments ADD COLUMN total_rounds INTEGER"); } catch {}
  try { db.exec("ALTER TABLE replays ADD COLUMN fairness_json TEXT"); } catch {}
  try { db.exec("ALTER TABLE replays ADD COLUMN match_format TEXT DEFAULT 'heads_up'"); } catch {}
  try { db.exec("ALTER TABLE replays ADD COLUMN tournament_id TEXT"); } catch {}
  try { db.exec("ALTER TABLE wallets ADD COLUMN gold_coin_units INTEGER"); } catch {}
  try { db.exec("ALTER TABLE wallets ADD COLUMN sweeps_coin_units INTEGER"); } catch {}
  try { db.exec("ALTER TABLE transactions ADD COLUMN amount_units INTEGER"); } catch {}
  try { db.exec("ALTER TABLE transactions ADD COLUMN balance_after_units INTEGER"); } catch {}
  try { db.exec("ALTER TABLE house_ledger ADD COLUMN amount_units INTEGER"); } catch {}

  // Integer hundredths are authoritative. Legacy REAL columns stay mirrored
  // during the compatibility window so existing databases/readers still work.
  db.exec(`
    UPDATE wallets SET gold_coin_units = ROUND(gold_coins * 100)
      WHERE gold_coin_units IS NULL;
    UPDATE wallets SET sweeps_coin_units = ROUND(sweeps_coins * 100)
      WHERE sweeps_coin_units IS NULL;
    UPDATE transactions SET amount_units = ROUND(amount * 100)
      WHERE amount_units IS NULL;
    UPDATE transactions SET balance_after_units = ROUND(balance_after * 100)
      WHERE balance_after_units IS NULL;
    UPDATE house_ledger SET amount_units = ROUND(amount * 100)
      WHERE amount_units IS NULL;

    CREATE TRIGGER IF NOT EXISTS wallets_legacy_gold_insert
    AFTER INSERT ON wallets
    BEGIN
      UPDATE wallets SET gold_coin_units = ROUND(NEW.gold_coins * 100)
      WHERE user_id = NEW.user_id;
    END;
    CREATE TRIGGER IF NOT EXISTS wallets_legacy_sweeps_insert
    AFTER INSERT ON wallets
    BEGIN
      UPDATE wallets SET sweeps_coin_units = ROUND(NEW.sweeps_coins * 100)
      WHERE user_id = NEW.user_id;
    END;
    CREATE TRIGGER IF NOT EXISTS wallets_legacy_gold_update
    AFTER UPDATE OF gold_coins ON wallets
    WHEN NEW.gold_coins IS NOT OLD.gold_coins
    BEGIN
      UPDATE wallets SET gold_coin_units = ROUND(NEW.gold_coins * 100)
      WHERE user_id = NEW.user_id;
    END;
    CREATE TRIGGER IF NOT EXISTS wallets_legacy_sweeps_update
    AFTER UPDATE OF sweeps_coins ON wallets
    WHEN NEW.sweeps_coins IS NOT OLD.sweeps_coins
    BEGIN
      UPDATE wallets SET sweeps_coin_units = ROUND(NEW.sweeps_coins * 100)
      WHERE user_id = NEW.user_id;
    END;
    CREATE TRIGGER IF NOT EXISTS transactions_legacy_money_insert
    AFTER INSERT ON transactions
    BEGIN
      UPDATE transactions SET
        amount_units = ROUND(NEW.amount * 100),
        balance_after_units = ROUND(NEW.balance_after * 100)
      WHERE id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS transactions_legacy_money_update
    AFTER UPDATE OF amount, balance_after ON transactions
    BEGIN
      UPDATE transactions SET
        amount_units = ROUND(NEW.amount * 100),
        balance_after_units = ROUND(NEW.balance_after * 100)
      WHERE id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS house_ledger_legacy_money_insert
    AFTER INSERT ON house_ledger
    BEGIN
      UPDATE house_ledger SET amount_units = ROUND(NEW.amount * 100)
      WHERE id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS house_ledger_legacy_money_update
    AFTER UPDATE OF amount ON house_ledger
    BEGIN
      UPDATE house_ledger SET amount_units = ROUND(NEW.amount * 100)
      WHERE id = NEW.id;
    END;
  `);

  // Early prerelease escrow tables used restrictive FKs. Rebuild once with
  // cascade semantics so account/test cleanup cannot strand financial rows.
  const escrowFks = db.prepare("PRAGMA foreign_key_list(escrow_holds)").all() as Array<{
    table: string;
    on_delete: string;
  }>;
  if (escrowFks.some(fk => fk.on_delete.toUpperCase() !== "CASCADE")) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec(`
        BEGIN;
        CREATE TABLE escrow_holds_migrated (
          room_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          transaction_id TEXT NOT NULL UNIQUE,
          amount_units INTEGER NOT NULL CHECK(amount_units >= 0),
          currency TEXT NOT NULL CHECK(currency IN ('gold_coins', 'sweeps_coins')),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(room_id, user_id),
          FOREIGN KEY(room_id) REFERENCES room_escrows(room_id) ON DELETE CASCADE,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO escrow_holds_migrated
          SELECT room_id, user_id, transaction_id, amount_units, currency, created_at
          FROM escrow_holds;
        DROP TABLE escrow_holds;
        ALTER TABLE escrow_holds_migrated RENAME TO escrow_holds;
        COMMIT;
      `);
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  const faucetFks = db.prepare("PRAGMA foreign_key_list(faucet_claims)").all() as Array<{
    on_delete: string;
  }>;
  if (faucetFks.some(fk => fk.on_delete.toUpperCase() !== "CASCADE")) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec(`
        BEGIN;
        CREATE TABLE faucet_claims_migrated (
          user_id TEXT PRIMARY KEY,
          claimed_at INTEGER NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO faucet_claims_migrated SELECT user_id, claimed_at FROM faucet_claims;
        DROP TABLE faucet_claims;
        ALTER TABLE faucet_claims_migrated RENAME TO faucet_claims;
        COMMIT;
      `);
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}

/** Session TTL in milliseconds (24 hours) */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Purge expired sessions from the database */
export function purgeExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < datetime('now')").run();
}

/** Persist a finalized match transcript to the replays table */
export function persistReplay(transcript: {
  roomId: string;
  players: { userId: string; username: string }[];
  startedAt: number;
  endedAt: number | null;
  actions: any[];
  outcome: {
    winnerId: string | null;
    winnerUsername: string | null;
    loserId: string | null;
    loserUsername: string | null;
    winnerScore: number;
    loserScore: number;
    endReason: string | null;
  } | null;
}, fairnessData?: any, matchFormat?: string, tournamentId?: string): string {
  const id = crypto.randomUUID();
  const p1 = transcript.players[0] || { userId: "", username: "" };
  const p2 = transcript.players[1] || { userId: "", username: "" };
  const outcome = transcript.outcome || {
    winnerId: null, winnerUsername: null,
    loserId: null, loserUsername: null,
    winnerScore: 0, loserScore: 0, endReason: null,
  };

  // Detect match format from transcript actions if not explicitly provided
  const detectedFormat = matchFormat || _detectMatchFormat(transcript.actions);
  const detectedTournamentId = tournamentId || _detectTournamentId(transcript.actions);

  db.prepare(`
    INSERT INTO replays (
      id, room_id, started_at, ended_at,
      player1_id, player1_username, player2_id, player2_username,
      winner_id, winner_username, loser_id, loser_username,
      winner_score, loser_score, end_reason,
      action_count, transcript_json, fairness_json,
      match_format, tournament_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    transcript.roomId,
    transcript.startedAt,
    transcript.endedAt ?? Date.now(),
    p1.userId, p1.username,
    p2.userId, p2.username,
    outcome.winnerId, outcome.winnerUsername,
    outcome.loserId, outcome.loserUsername,
    outcome.winnerScore, outcome.loserScore,
    outcome.endReason,
    transcript.actions.length,
    JSON.stringify(transcript.actions),
    fairnessData ? JSON.stringify(fairnessData) : null,
    detectedFormat,
    detectedTournamentId || null,
  );

  return id;
}

/** Detect match format from transcript actions metadata */
function _detectMatchFormat(actions: any[]): string {
  for (const action of actions) {
    if (action.type === "match_start" && action.detail) {
      if (action.detail.tournamentId) {
        return action.detail.tournamentFormat === "scheduled" ? "tournament_scheduled" : "tournament_sng";
      }
      if (action.detail.stakeId && action.detail.stakeId !== "free") {
        return "heads_up_staked";
      }
    }
  }
  return "heads_up";
}

/** Extract tournament ID from transcript actions metadata */
function _detectTournamentId(actions: any[]): string | null {
  for (const action of actions) {
    if (action.type === "match_start" && action.detail?.tournamentId) {
      return action.detail.tournamentId;
    }
  }
  return null;
}
