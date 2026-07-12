import crypto from "crypto";
import { db } from "./db.js";

const TICKET_TTL_MS = 30_000;

function ensureTicketTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS websocket_tickets (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_websocket_tickets_expires_at
      ON websocket_tickets(expires_at);
  `);
}

function hashTicket(ticket: string): string {
  return crypto.createHash("sha256").update(ticket).digest("hex");
}

export function createWebSocketTicket(userId: string): { ticket: string; expiresInMs: number } {
  ensureTicketTable();
  const ticket = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = new Date(now + TICKET_TTL_MS).toISOString();
  db.transaction(() => {
    db.prepare("DELETE FROM websocket_tickets WHERE expires_at <= ?").run(new Date(now).toISOString());
    db.prepare("INSERT INTO websocket_tickets (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(hashTicket(ticket), userId, expiresAt);
  })();
  return { ticket, expiresInMs: TICKET_TTL_MS };
}

export function consumeWebSocketTicket(ticket: string): string | null {
  if (ticket.length < 20 || ticket.length > 128) return null;
  ensureTicketTable();
  return db.transaction(() => {
    const tokenHash = hashTicket(ticket);
    const row = db.prepare("SELECT user_id, expires_at FROM websocket_tickets WHERE token_hash = ?")
      .get(tokenHash) as { user_id: string; expires_at: string } | undefined;
    db.prepare("DELETE FROM websocket_tickets WHERE token_hash = ?").run(tokenHash);
    if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
    return row.user_id;
  })();
}
