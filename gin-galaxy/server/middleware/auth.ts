import type { Request, Response, NextFunction } from "express";
import { db } from "../db.js";
import { readSessionCookie } from "../sessionCookie.js";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  sessionId?: string;
}

/**
 * Middleware that extracts and validates the session from an HttpOnly cookie or
 * an Authorization bearer token. Browser clients use the cookie; bearer support
 * remains available for non-browser API clients.
 * Rejects expired or invalid sessions with 401.
 * Attaches `userId` and `sessionId` to the request object.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  // The frontend keeps this non-secret marker so existing request guards and
  // header construction continue to work without persisting the real token.
  const token = bearerToken && bearerToken !== "cookie" ? bearerToken : readSessionCookie(req);
  if (!token || token.length < 10) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const session = db
    .prepare(
      "SELECT user_id FROM sessions WHERE id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
    )
    .get(token) as { user_id: string } | undefined;

  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.userId = session.user_id;
  req.sessionId = token;
  next();
}
