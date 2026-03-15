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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      currency TEXT NOT NULL CHECK(currency IN ('gold_coins', 'sweeps_coins')),
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      balance_after REAL NOT NULL,
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
