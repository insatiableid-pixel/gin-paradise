/**
 * Premium Entitlement System for Gin Paradise.
 *
 * Provides a durable server-backed entitlement model for free vs premium access.
 * This module is the single source of truth for all premium feature gating.
 *
 * Design:
 *   - Two tiers: 'free' (default) and 'premium'
 *   - Entitlement stored in SQLite `entitlements` table with metadata for
 *     future trial, expiration, and billing sync
 *   - Admin/dev grant flow for testing without a real payment processor
 *   - All premium checks go through this module — no scattered frontend conditionals
 *
 * Premium features (analytical depth, not gameplay):
 *   - Detailed progression analysis (window comparison, category breakdowns)
 *   - AI coaching narratives
 *   - Coaching timeline and recurring themes
 *   - Advanced training history filters
 *   - Replay export (future)
 *   - Priority evaluation queue (future)
 *
 * Free features (core competitive play, always available):
 *   - All gameplay (single-player, multiplayer, tournaments)
 *   - Basic training summary and recent session list
 *   - Basic engine evaluation results (accuracy %, severity counts)
 *   - Achievement and prestige system
 *   - Cosmetic inventory and store
 *   - Wallet, leaderboard, replays
 *   - Profile and public profile
 *   - Fairness/Trust Shield
 */

import { db } from "./db.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type PlanTier = "free" | "premium";

export interface Entitlement {
  userId: string;
  plan: PlanTier;
  grantedAt: string;
  expiresAt: string | null;
  grantedBy: string | null;  // admin user ID or 'system' or 'billing'
  grantReason: string | null;
  isActive: boolean;
}

export interface PlanDetails {
  plan: PlanTier;
  displayName: string;
  isActive: boolean;
  grantedAt: string | null;
  expiresAt: string | null;
  features: PremiumFeature[];
}

export interface PremiumFeature {
  key: string;
  name: string;
  description: string;
  free: boolean;
  premium: boolean;
}

// ─── Feature Catalog ───────────────────────────────────────────────────

export const FEATURE_CATALOG: PremiumFeature[] = [
  // === Always Free ===
  {
    key: "core_gameplay",
    name: "Core Gameplay",
    description: "Single-player, multiplayer, and tournament play",
    free: true,
    premium: true,
  },
  {
    key: "basic_training",
    name: "Basic Training",
    description: "Recent sessions list, accuracy score, severity counts",
    free: true,
    premium: true,
  },
  {
    key: "engine_evaluation",
    name: "Engine Evaluation",
    description: "Per-turn Apex v2 engine accuracy analysis",
    free: true,
    premium: true,
  },
  {
    key: "achievements",
    name: "Achievements & Prestige",
    description: "Full achievement system with prestige unlocks",
    free: true,
    premium: true,
  },
  {
    key: "cosmetics",
    name: "Cosmetic Store",
    description: "Browse, purchase, and equip cosmetic items",
    free: true,
    premium: true,
  },
  {
    key: "replays",
    name: "Match Replays",
    description: "Full replay history with transcript viewer",
    free: true,
    premium: true,
  },
  {
    key: "wallet",
    name: "Wallet & Economy",
    description: "Dual-currency wallet, daily bonus, staked matches",
    free: true,
    premium: true,
  },
  {
    key: "trust_shield",
    name: "Trust Shield",
    description: "Provably fair cryptographic shuffle verification",
    free: true,
    premium: true,
  },
  // === Premium Only ===
  {
    key: "ai_coaching",
    name: "AI Coaching Narratives",
    description: "Detailed AI-generated coaching per session with strategic themes",
    free: false,
    premium: true,
  },
  {
    key: "coaching_timeline",
    name: "Coaching Timeline",
    description: "Chronological coaching history with narrative previews",
    free: false,
    premium: true,
  },
  {
    key: "coaching_themes",
    name: "Recurring Coaching Themes",
    description: "Aggregated strategic patterns across all sessions",
    free: false,
    premium: true,
  },
  {
    key: "progression_depth",
    name: "Deep Progression Analysis",
    description: "Window comparison, category breakdowns, improvement deltas, streak analysis",
    free: false,
    premium: true,
  },
  {
    key: "advanced_history",
    name: "Advanced Training History",
    description: "Filtered, sortable session history with coached session filtering",
    free: false,
    premium: true,
  },
  {
    key: "session_coaching",
    name: "Session Coaching Detail",
    description: "In-depth coaching narratives, mistake links, and themes per session",
    free: false,
    premium: true,
  },
  {
    key: "batch_prepare",
    name: "Batch Evaluation Prep",
    description: "Bulk-prepare evaluations for multiple sessions at once",
    free: false,
    premium: true,
  },
];

export const PREMIUM_FEATURE_KEYS = new Set(
  FEATURE_CATALOG.filter(f => !f.free && f.premium).map(f => f.key)
);

export const FREE_FEATURE_KEYS = new Set(
  FEATURE_CATALOG.filter(f => f.free).map(f => f.key)
);

// ─── Database Initialization ───────────────────────────────────────────

export function initializeEntitlementTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entitlements (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'premium')),
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      granted_by TEXT,
      grant_reason TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entitlement_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      old_plan TEXT NOT NULL,
      new_plan TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_entitlement_audit_user ON entitlement_audit_log(user_id);
  `);
}

// ─── Core API ──────────────────────────────────────────────────────────

/**
 * Get the current plan tier for a user.
 * Returns 'free' if no entitlement row exists.
 * Checks expiration and demotes expired premium users.
 */
export function getUserPlan(userId: string): PlanTier {
  const row = db.prepare(
    "SELECT plan, expires_at FROM entitlements WHERE user_id = ?"
  ).get(userId) as { plan: PlanTier; expires_at: string | null } | undefined;

  if (!row) return "free";

  // Check expiration
  if (row.plan === "premium" && row.expires_at) {
    const expiresAt = new Date(row.expires_at).getTime();
    if (Date.now() > expiresAt) {
      // Auto-demote expired premium
      _setPlan(userId, "free", "system", "Premium expired");
      return "free";
    }
  }

  return row.plan;
}

/**
 * Get full entitlement details for a user.
 */
export function getUserEntitlement(userId: string): PlanDetails {
  const plan = getUserPlan(userId);

  const row = db.prepare(
    "SELECT granted_at, expires_at FROM entitlements WHERE user_id = ?"
  ).get(userId) as { granted_at: string; expires_at: string | null } | undefined;

  return {
    plan,
    displayName: plan === "premium" ? "Gin Paradise Pro" : "Free",
    isActive: plan === "premium",
    grantedAt: row?.granted_at || null,
    expiresAt: row?.expires_at || null,
    features: FEATURE_CATALOG,
  };
}

/**
 * Check if a user has access to a specific premium feature.
 */
export function hasFeatureAccess(userId: string, featureKey: string): boolean {
  // If it's a free feature, everyone has access
  if (FREE_FEATURE_KEYS.has(featureKey)) return true;

  // Premium features require premium plan
  if (PREMIUM_FEATURE_KEYS.has(featureKey)) {
    return getUserPlan(userId) === "premium";
  }

  // Unknown feature keys default to free access
  return true;
}

/**
 * Check if a user is on the premium plan.
 */
export function isPremium(userId: string): boolean {
  return getUserPlan(userId) === "premium";
}

// ─── Admin / Dev Grant Controls ────────────────────────────────────────

/**
 * Grant premium access to a user. Auditable, server-enforced.
 *
 * @param userId       Target user
 * @param grantedBy    Admin user ID or 'system' or 'dev'
 * @param reason       Reason for the grant
 * @param durationDays Optional: number of days until expiry. null = indefinite.
 */
export function grantPremium(
  userId: string,
  grantedBy: string,
  reason: string,
  durationDays: number | null = null
): { success: boolean; error?: string } {
  // Verify target user exists
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId) as { id: string } | undefined;
  if (!user) {
    return { success: false, error: "User not found" };
  }

  const expiresAt = durationDays
    ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  _setPlan(userId, "premium", grantedBy, reason, expiresAt);
  return { success: true };
}

/**
 * Revoke premium access (demote to free).
 */
export function revokePremium(
  userId: string,
  revokedBy: string,
  reason: string
): { success: boolean; error?: string } {
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId) as { id: string } | undefined;
  if (!user) {
    return { success: false, error: "User not found" };
  }

  const currentPlan = getUserPlan(userId);
  if (currentPlan === "free") {
    return { success: false, error: "User is already on the free plan" };
  }

  _setPlan(userId, "free", revokedBy, reason);
  return { success: true };
}

/**
 * Get the entitlement audit log for a specific user.
 */
export function getAuditLog(userId: string, limit = 20): Array<{
  oldPlan: string;
  newPlan: string;
  changedBy: string;
  reason: string | null;
  createdAt: string;
}> {
  const rows = db.prepare(`
    SELECT old_plan, new_plan, changed_by, reason, created_at
    FROM entitlement_audit_log
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit) as Array<{
    old_plan: string;
    new_plan: string;
    changed_by: string;
    reason: string | null;
    created_at: string;
  }>;

  return rows.map(r => ({
    oldPlan: r.old_plan,
    newPlan: r.new_plan,
    changedBy: r.changed_by,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

// ─── Internal Helpers ──────────────────────────────────────────────────

function _setPlan(
  userId: string,
  plan: PlanTier,
  changedBy: string,
  reason: string,
  expiresAt: string | null = null
): void {
  const txn = db.transaction(() => {
    // Get old plan for audit
    const oldRow = db.prepare("SELECT plan FROM entitlements WHERE user_id = ?").get(userId) as { plan: string } | undefined;
    const oldPlan = oldRow?.plan || "free";

    // Upsert entitlement
    db.prepare(`
      INSERT INTO entitlements (user_id, plan, granted_at, expires_at, granted_by, grant_reason, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        plan = excluded.plan,
        granted_at = CASE WHEN excluded.plan = 'premium' THEN CURRENT_TIMESTAMP ELSE entitlements.granted_at END,
        expires_at = excluded.expires_at,
        granted_by = excluded.granted_by,
        grant_reason = excluded.grant_reason,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, plan, expiresAt, changedBy, reason);

    // Audit log
    db.prepare(`
      INSERT INTO entitlement_audit_log (user_id, old_plan, new_plan, changed_by, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, oldPlan, plan, changedBy, reason);
  });

  txn();
}
