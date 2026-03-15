/**
 * Admin Authorization Middleware for Gin Paradise.
 *
 * Admin access model:
 * - Admin status is stored as `is_admin` column in the users table.
 * - There is no self-service admin provisioning; admins are designated
 *   via direct DB update: UPDATE users SET is_admin = 1 WHERE username = 'admin';
 * - All admin endpoints require both valid session AND is_admin = 1.
 * - Non-admin users receive 403 Forbidden (not 404) so admins are aware
 *   the endpoint exists but access is denied — this is intentional since
 *   admin routes are also hidden from non-admin navigation.
 */

import { Response, NextFunction } from "express";
import { db } from "../db.js";
import { requireAuth, AuthenticatedRequest } from "./auth.js";

export interface AdminRequest extends AuthenticatedRequest {
  isAdmin?: boolean;
}

/**
 * Middleware that enforces admin access.
 * Must be used AFTER requireAuth (the userId must already be set).
 * Returns 403 if the authenticated user is not an admin.
 */
export function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.userId) as { is_admin: number } | undefined;

  if (!user || user.is_admin !== 1) {
    res.status(403).json({ error: "Forbidden — admin access required" });
    return;
  }

  req.isAdmin = true;
  next();
}
