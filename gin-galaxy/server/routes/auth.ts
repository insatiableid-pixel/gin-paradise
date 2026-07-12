import { Router, Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db, SESSION_TTL_MS } from "../db.js";
import { validateBody } from "../middleware/validate.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { creditSignupBonus } from "../ledger.js";
import { getUserPlan } from "../entitlements.js";
import { createWebSocketTicket } from "../websocketTickets.js";
const router = Router();

const BCRYPT_ROUNDS = 12;

// Rate limiting on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: "Too many auth attempts. Please try again in 15 minutes.",
});

/** Create a session with an expiration timestamp */
function createSession(userId: string): string {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(sessionId, userId, expiresAt);
  return sessionId;
}

// ─── POST /api/auth/register ─────────────────────────────────────────
router.post(
  "/register",
  authLimiter,
  validateBody([
    { name: "username", type: "string", minLength: 2, maxLength: 30 },
    { name: "email", type: "string", minLength: 5, maxLength: 100 },
    { name: "password", type: "string", minLength: 6, maxLength: 128 },
  ]),
  async (req: Request, res: Response) => {
    const { username, email, password } = req.body;
    try {
      const id = crypto.randomUUID();
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)").run(id, username, email, hash);
      creditSignupBonus(id);
      const sessionId = createSession(id);
      res.json({ sessionId, user: { id, username, email, rating: 1200 } });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "";
      if (message.includes("UNIQUE constraint")) {
        res.status(400).json({ error: "Username or email already exists" });
      } else {
        console.error("[auth] Registration failed", e);
        res.status(500).json({ error: "Unable to create account" });
      }
    }
  }
);

// ─── POST /api/auth/login ────────────────────────────────────────────
router.post(
  "/login",
  authLimiter,
  validateBody([
    { name: "username", type: "string", minLength: 1 },
    { name: "password", type: "string", minLength: 1 },
  ]),
  async (req: Request, res: Response) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // Support legacy SHA-256 hashes for existing users: if the stored hash
    // is exactly 64 hex chars it's a legacy SHA-256 hash.
    let valid = false;
    if (user.password_hash.length === 64 && /^[0-9a-f]+$/i.test(user.password_hash)) {
      const legacyHash = crypto.createHash("sha256").update(password).digest("hex");
      valid = legacyHash === user.password_hash;
      if (valid) {
        // Upgrade to bcrypt transparently
        const newHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, user.id);
      }
    } else {
      valid = await bcrypt.compare(password, user.password_hash);
    }

    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const sessionId = createSession(user.id);
    res.json({ sessionId, user: { id: user.id, username: user.username, email: user.email, rating: user.rating, is_admin: !!user.is_admin, plan: getUserPlan(user.id) } });
  }
);

// ─── POST /api/auth/logout ───────────────────────────────────────────
// Uses authenticated session context — deletes the session identified by
// the Authorization header, not an arbitrary ID in the request body.
router.post("/logout", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(req.sessionId);
  res.json({ success: true });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────
router.get("/me", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const user = db.prepare("SELECT id, username, email, rating, is_admin FROM users WHERE id = ?").get(req.userId) as any;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ user: { ...user, is_admin: !!user.is_admin, plan: getUserPlan(user.id) } });
});

// Short-lived, single-use auth keeps reusable session IDs out of WebSocket URLs.
router.post("/ws-ticket", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json(createWebSocketTicket(req.userId!));
});

export default router;
