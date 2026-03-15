import { Request, Response, NextFunction } from "express";
import { db } from "../db.js";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  sessionId?: string;
}

/**
 * Middleware that extracts and validates the session from the Authorization header.
 * Rejects expired or invalid sessions with 401.
 * Attaches `userId` and `sessionId` to the request object.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.split(" ")[1];
  if (!token || token.length < 10) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const session = db.prepare(
    "SELECT user_id FROM sessions WHERE id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).get(token) as { user_id: string } | undefined;

  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.userId = session.user_id;
  req.sessionId = token;
  next();
}
