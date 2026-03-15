/**
 * Entitlement & Premium Plan API Routes for Gin Paradise.
 *
 * Provides user-facing plan information, upgrade surfaces,
 * and admin grant/revoke controls.
 *
 * Endpoints:
 *   GET  /api/entitlements/plan             — current plan details + feature breakdown
 *   GET  /api/entitlements/features         — full feature comparison (free vs premium)
 *   POST /api/entitlements/admin/grant      — admin: grant premium to a user
 *   POST /api/entitlements/admin/revoke     — admin: revoke premium from a user
 *   GET  /api/entitlements/admin/audit/:id  — admin: view entitlement audit log
 *   GET  /api/entitlements/admin/status/:id — admin: view user's current plan
 */

import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { requireAdmin, AdminRequest } from "../middleware/adminAuth.js";
import { db } from "../db.js";
import {
  getUserEntitlement,
  getUserPlan,
  isPremium,
  grantPremium,
  revokePremium,
  getAuditLog,
  FEATURE_CATALOG,
} from "../entitlements.js";

const router = Router();

// ── GET /api/entitlements/plan — Current plan for authenticated user ──

router.get("/plan", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const details = getUserEntitlement(userId);

  // Add user context
  const user = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as { username: string } | undefined;

  res.json({
    ...details,
    username: user?.username || null,
    userId,
    upgradeAvailable: !details.isActive,
    meta: {
      note: "Premium access unlocks deeper analytical tools for training improvement. Core gameplay and coin wagering remain available for all players.",
      billingStatus: "active",
      billingNote: "Premium subscriptions are processed via our billing system.",
    },
  });
});

// ── GET /api/entitlements/features — Feature comparison ──────────────

router.get("/features", requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  res.json({
    features: FEATURE_CATALOG,
    plans: [
      {
        tier: "free",
        displayName: "Free",
        price: "$0",
        description: "Coin-wagered PvP, daily check-in, practice matches",
        highlight: false,
      },
      {
        tier: "premium",
        displayName: "Gin Paradise Pro",
        price: "$9.99/mo",
        description: "Deep analytical coaching and exclusive features",
        highlight: true,
      },
    ],
  });
});

// ── POST /api/entitlements/admin/grant — Admin grant premium ─────────

router.post("/admin/grant", requireAuth, requireAdmin, (req: AdminRequest, res: Response) => {
  const { userId, reason, durationDays } = req.body;
  const adminId = req.userId!;

  if (!userId) {
    res.status(400).json({ error: "Missing userId" });
    return;
  }

  if (!reason || typeof reason !== "string" || reason.length < 3) {
    res.status(400).json({ error: "A reason is required (minimum 3 characters)" });
    return;
  }

  const duration = durationDays !== undefined && durationDays !== null
    ? Math.max(1, Math.min(365, parseInt(String(durationDays)) || 30))
    : null;

  const result = grantPremium(userId, adminId, reason, duration);

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  const targetUser = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as { username: string } | undefined;

  res.json({
    success: true,
    message: `Premium granted to ${targetUser?.username || userId}${duration ? ` for ${duration} days` : " (indefinite)"}`,
    plan: getUserEntitlement(userId),
  });
});

// ── POST /api/entitlements/admin/revoke — Admin revoke premium ───────

router.post("/admin/revoke", requireAuth, requireAdmin, (req: AdminRequest, res: Response) => {
  const { userId, reason } = req.body;
  const adminId = req.userId!;

  if (!userId) {
    res.status(400).json({ error: "Missing userId" });
    return;
  }

  if (!reason || typeof reason !== "string" || reason.length < 3) {
    res.status(400).json({ error: "A reason is required (minimum 3 characters)" });
    return;
  }

  const result = revokePremium(userId, adminId, reason);

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  const targetUser = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as { username: string } | undefined;

  res.json({
    success: true,
    message: `Premium revoked from ${targetUser?.username || userId}`,
    plan: getUserEntitlement(userId),
  });
});

// ── GET /api/entitlements/admin/audit/:id — Audit log for a user ─────

router.get("/admin/audit/:id", requireAuth, requireAdmin, (req: AdminRequest, res: Response) => {
  const targetUserId = req.params.id;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 20, 1), 100);

  const targetUser = db.prepare("SELECT id, username FROM users WHERE id = ?").get(targetUserId) as { id: string; username: string } | undefined;
  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const log = getAuditLog(targetUserId, limit);

  res.json({
    userId: targetUserId,
    username: targetUser.username,
    currentPlan: getUserPlan(targetUserId),
    auditLog: log,
    totalEntries: log.length,
  });
});

// ── GET /api/entitlements/admin/status/:id — User plan status ────────

router.get("/admin/status/:id", requireAuth, requireAdmin, (req: AdminRequest, res: Response) => {
  const targetUserId = req.params.id;

  const targetUser = db.prepare("SELECT id, username FROM users WHERE id = ?").get(targetUserId) as { id: string; username: string } | undefined;
  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const details = getUserEntitlement(targetUserId);

  res.json({
    userId: targetUserId,
    username: targetUser.username,
    ...details,
  });
});

export default router;
