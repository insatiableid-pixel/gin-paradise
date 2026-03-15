/**
 * Offer System — First-Purchase Optimization for Gin Paradise.
 *
 * Provides a durable, server-authoritative offer layer on top of the existing
 * billing and entitlement systems. Designed for first-purchase conversion.
 *
 * Architecture:
 *   - Named offers with eligibility rules, one-time enforcement, and analytics
 *   - Impression, dismissal, click, and purchase tracking
 *   - Server-side eligibility is the only source of truth
 *   - Anti-abuse: one redemption per account, no duplicate trials
 *   - PAID offers initiate checkout; FREE offers redeem directly
 *   - Paid offer fulfillment happens only after webhook confirmation
 *   - Compatible with both dry-run and live billing modes
 *
 * Current offers:
 *   - starter_bundle: One-time first-purchase bundle (coins + premium trial) — PAID
 *   - premium_trial_7d: Standalone 7-day premium trial for new users — FREE
 */

import { db } from "./db.js";
import Database from "better-sqlite3";
import { mutateBalance, getBalances } from "./ledger.js";
import { grantPremium, getUserPlan } from "./entitlements.js";
import {
  getUserPurchaseHistory,
  isBillingDryRun,
  createOfferPurchaseSession,
  fulfillOfferPurchase,
  getBillingSession,
} from "./billing.js";

export { isBillingDryRun };

// ─── Types ──────────────────────────────────────────────────────────────

export interface OfferDefinition {
  id: string;
  name: string;
  description: string;
  type: "starter_bundle" | "premium_trial" | "coin_bonus";
  /** What the offer includes */
  contents: {
    coins?: number;
    premiumTrialDays?: number;
    badge?: string;  // cosmetic badge ID
  };
  /** Price in USD (0 for free trials) */
  priceUsd: number;
  /** Value framing — what it would cost at standard rates */
  standardValueUsd: number;
  /** Discount percentage to show */
  discountPercent: number;
  /** Whether this offer can only be redeemed once per account */
  oneTimeOnly: boolean;
  /** Eligibility rules */
  eligibility: {
    /** Only available before first purchase */
    beforeFirstPurchase: boolean;
    /** Must not already have premium */
    requiresFree: boolean;
    /** Minimum account age in hours (0 = immediate) */
    minAccountAgeHours: number;
    /** Maximum account age in hours (0 = no limit) */
    maxAccountAgeHours: number;
  };
  /** Presentation */
  tagline: string;
  urgencyText?: string;
  /** Active flag */
  active: boolean;
}

export interface OfferEligibility {
  offerId: string;
  eligible: boolean;
  reasons: string[];
}

export interface OfferAnalytics {
  offerId: string;
  impressions: number;
  dismissals: number;
  clicks: number;
  purchases: number;
  revenue: number;
  conversionRate: number;
  dismissRate: number;
}

export interface UserOfferState {
  offerId: string;
  redeemed: boolean;
  redeemedAt: string | null;
  impressionCount: number;
  lastDismissedAt: string | null;
  dismissCount: number;
  pendingBillingSessionId: string | null;
}

// ─── Offer Catalog ──────────────────────────────────────────────────────

export const OFFER_CATALOG: OfferDefinition[] = [
  {
    id: "starter_bundle",
    name: "Starter Bundle",
    description: "The best way to start your Gin Paradise journey — coins, premium access, and a head start on the competition.",
    type: "starter_bundle",
    contents: {
      coins: 15_000,
      premiumTrialDays: 7,
    },
    priceUsd: 4.99,
    standardValueUsd: 14.98,   // $4.99 for 5K coins (×3 = $14.97) + $2.33 for 7d premium ($9.99/30*7)
    discountPercent: 67,
    oneTimeOnly: true,
    eligibility: {
      beforeFirstPurchase: true,
      requiresFree: true,
      minAccountAgeHours: 0,
      maxAccountAgeHours: 0,   // No max — available until first purchase
    },
    tagline: "3× the coins + 7 days of Pro — one time only",
    urgencyText: "Available only before your first purchase",
    active: true,
  },
  {
    id: "premium_trial_7d",
    name: "Free Premium Trial",
    description: "Try Gin Paradise Pro for 7 days — AI coaching, deep analytics, and exclusive cosmetics. No purchase required.",
    type: "premium_trial",
    contents: {
      premiumTrialDays: 7,
    },
    priceUsd: 0,
    standardValueUsd: 2.33,
    discountPercent: 100,
    oneTimeOnly: true,
    eligibility: {
      beforeFirstPurchase: false,
      requiresFree: true,
      minAccountAgeHours: 0,
      maxAccountAgeHours: 0,
    },
    tagline: "7 days of Pro features — completely free",
    urgencyText: "One-time trial per account",
    active: true,
  },
];

// ─── Database Setup ─────────────────────────────────────────────────────

export function initOfferTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS offer_interactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      offer_id TEXT NOT NULL,
      interaction_type TEXT NOT NULL CHECK(interaction_type IN ('impression', 'dismiss', 'click', 'purchase')),
      surface TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_offer_interactions_user ON offer_interactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_offer_interactions_offer ON offer_interactions(offer_id);
    CREATE INDEX IF NOT EXISTS idx_offer_interactions_type ON offer_interactions(interaction_type);

    CREATE TABLE IF NOT EXISTS offer_redemptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      offer_id TEXT NOT NULL,
      coins_granted INTEGER DEFAULT 0,
      premium_days_granted INTEGER DEFAULT 0,
      price_usd REAL DEFAULT 0,
      billing_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_offer_redemptions_user ON offer_redemptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_offer_redemptions_offer ON offer_redemptions(offer_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_redemptions_unique ON offer_redemptions(user_id, offer_id);
  `);
}

// ─── Lazy Prepared Statements ───────────────────────────────────────────

interface OfferStmts {
  insertInteraction: Database.Statement;
  getUserInteractions: Database.Statement;
  getUserDismissCount: Database.Statement;
  getLastDismissal: Database.Statement;
  insertRedemption: Database.Statement;
  getUserRedemption: Database.Statement;
  getOfferAnalytics: Database.Statement;
  getAllAnalytics: Database.Statement;
  getUserImpressionCount: Database.Statement;
  getRecentRedemptions: Database.Statement;
}

let _stmts: OfferStmts | null = null;

function stmts(): OfferStmts {
  if (!_stmts) {
    _stmts = {
      insertInteraction: db.prepare(`
        INSERT INTO offer_interactions (id, user_id, offer_id, interaction_type, surface, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getUserInteractions: db.prepare(`
        SELECT * FROM offer_interactions WHERE user_id = ? AND offer_id = ? ORDER BY created_at DESC LIMIT ?
      `),
      getUserDismissCount: db.prepare(`
        SELECT COUNT(*) as count FROM offer_interactions
        WHERE user_id = ? AND offer_id = ? AND interaction_type = 'dismiss'
      `),
      getLastDismissal: db.prepare(`
        SELECT created_at FROM offer_interactions
        WHERE user_id = ? AND offer_id = ? AND interaction_type = 'dismiss'
        ORDER BY created_at DESC LIMIT 1
      `),
      insertRedemption: db.prepare(`
        INSERT INTO offer_redemptions (id, user_id, offer_id, coins_granted, premium_days_granted, price_usd, billing_session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      getUserRedemption: db.prepare(`
        SELECT * FROM offer_redemptions WHERE user_id = ? AND offer_id = ?
      `),
      getOfferAnalytics: db.prepare(`
        SELECT
          oi.offer_id,
          SUM(CASE WHEN oi.interaction_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
          SUM(CASE WHEN oi.interaction_type = 'dismiss' THEN 1 ELSE 0 END) AS dismissals,
          SUM(CASE WHEN oi.interaction_type = 'click' THEN 1 ELSE 0 END) AS clicks,
          SUM(CASE WHEN oi.interaction_type = 'purchase' THEN 1 ELSE 0 END) AS purchases,
          COALESCE(SUM(r.price_usd), 0) AS revenue
        FROM offer_interactions oi
        LEFT JOIN offer_redemptions r ON r.offer_id = oi.offer_id AND r.user_id = oi.user_id AND oi.interaction_type = 'purchase'
        WHERE oi.offer_id = ?
        GROUP BY oi.offer_id
      `),
      getAllAnalytics: db.prepare(`
        SELECT
          offer_id,
          SUM(CASE WHEN interaction_type = 'impression' THEN 1 ELSE 0 END) AS impressions,
          SUM(CASE WHEN interaction_type = 'dismiss' THEN 1 ELSE 0 END) AS dismissals,
          SUM(CASE WHEN interaction_type = 'click' THEN 1 ELSE 0 END) AS clicks,
          SUM(CASE WHEN interaction_type = 'purchase' THEN 1 ELSE 0 END) AS purchases
        FROM offer_interactions
        GROUP BY offer_id
      `),
      getUserImpressionCount: db.prepare(`
        SELECT COUNT(*) as count FROM offer_interactions
        WHERE user_id = ? AND offer_id = ? AND interaction_type = 'impression'
      `),
      getRecentRedemptions: db.prepare(`
        SELECT r.*, u.username
        FROM offer_redemptions r
        LEFT JOIN users u ON u.id = r.user_id
        ORDER BY r.created_at DESC LIMIT ?
      `),
    };
  }
  return _stmts;
}

// ─── Eligibility ────────────────────────────────────────────────────────

/**
 * Check whether a user is eligible for a specific offer.
 * Server-authoritative — this is the only eligibility check that matters.
 */
export function checkEligibility(userId: string, offerId: string): OfferEligibility {
  const offer = OFFER_CATALOG.find(o => o.id === offerId);
  if (!offer) {
    return { offerId, eligible: false, reasons: ["Offer not found"] };
  }
  if (!offer.active) {
    return { offerId, eligible: false, reasons: ["Offer is not currently active"] };
  }

  const reasons: string[] = [];

  // Check one-time enforcement
  if (offer.oneTimeOnly) {
    const redemption = stmts().getUserRedemption.get(userId, offerId) as any;
    if (redemption) {
      reasons.push("Already redeemed (one-time offer)");
    }
  }

  // Check before-first-purchase rule
  if (offer.eligibility.beforeFirstPurchase) {
    const purchases = getUserPurchaseHistory(userId, 1);
    const hasCompletedPurchase = purchases.some((p: any) => p.status === "completed");
    if (hasCompletedPurchase) {
      reasons.push("Already made a purchase");
    }
  }

  // Check premium requirement
  if (offer.eligibility.requiresFree) {
    const plan = getUserPlan(userId);
    if (plan === "premium") {
      reasons.push("Already on premium plan");
    }
  }

  // Check account age
  if (offer.eligibility.minAccountAgeHours > 0 || offer.eligibility.maxAccountAgeHours > 0) {
    const user = db.prepare("SELECT created_at FROM users WHERE id = ?").get(userId) as { created_at: string } | undefined;
    if (user) {
      const accountAgeHours = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60);
      if (offer.eligibility.minAccountAgeHours > 0 && accountAgeHours < offer.eligibility.minAccountAgeHours) {
        reasons.push(`Account too new (need ${offer.eligibility.minAccountAgeHours}h)`);
      }
      if (offer.eligibility.maxAccountAgeHours > 0 && accountAgeHours > offer.eligibility.maxAccountAgeHours) {
        reasons.push("Offer expired for this account");
      }
    }
  }

  return {
    offerId,
    eligible: reasons.length === 0,
    reasons,
  };
}

/**
 * Get all eligible offers for a user with visibility rules.
 * Respects dismiss cooldowns (don't re-show within 4 hours of dismiss).
 */
export function getEligibleOffers(userId: string): Array<OfferDefinition & { eligibility_state: OfferEligibility; suppressed: boolean; suppressReason?: string }> {
  const results: Array<OfferDefinition & { eligibility_state: OfferEligibility; suppressed: boolean; suppressReason?: string }> = [];

  for (const offer of OFFER_CATALOG) {
    if (!offer.active) continue;

    const eligibility = checkEligibility(userId, offer.id);
    if (!eligibility.eligible) continue;

    // Check dismiss cooldown (4 hours)
    let suppressed = false;
    let suppressReason: string | undefined;

    const lastDismiss = stmts().getLastDismissal.get(userId, offer.id) as { created_at: string } | undefined;
    if (lastDismiss) {
      const dismissAge = Date.now() - new Date(lastDismiss.created_at).getTime();
      const DISMISS_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
      if (dismissAge < DISMISS_COOLDOWN_MS) {
        suppressed = true;
        suppressReason = "Recently dismissed (cooldown active)";
      }
    }

    // Check max impressions per day (10 per day to avoid spam)
    const today = new Date().toISOString().split("T")[0];
    const impressionCount = (stmts().getUserImpressionCount.get(userId, offer.id) as { count: number })?.count || 0;
    if (impressionCount > 50) {
      suppressed = true;
      suppressReason = "Maximum impressions reached";
    }

    results.push({
      ...offer,
      eligibility_state: eligibility,
      suppressed,
      suppressReason,
    });
  }

  return results;
}

// ─── Interaction Tracking ───────────────────────────────────────────────

/**
 * Record an offer interaction (impression, dismiss, click).
 */
export function recordInteraction(
  userId: string,
  offerId: string,
  type: "impression" | "dismiss" | "click" | "purchase",
  surface?: string,
  metadata?: Record<string, any>,
): void {
  const id = crypto.randomUUID();
  stmts().insertInteraction.run(
    id, userId, offerId, type, surface || null,
    metadata ? JSON.stringify(metadata) : null,
  );
}

// ─── Redemption / Purchase ──────────────────────────────────────────────

export interface RedemptionResult {
  success: boolean;
  error?: string;
  coinsGranted?: number;
  premiumDaysGranted?: number;
  alreadyRedeemed?: boolean;
  /** If set, this is a paid offer that requires checkout */
  requiresCheckout?: boolean;
  checkoutUrl?: string;
  billingSessionId?: string;
}

/**
 * Check if an offer is a paid offer (priceUsd > 0).
 */
export function isPaidOffer(offerId: string): boolean {
  const offer = OFFER_CATALOG.find(o => o.id === offerId);
  return !!offer && offer.priceUsd > 0;
}

/**
 * Redeem / purchase an offer for a user.
 * Server-authoritative: re-checks eligibility, enforces one-time, and fulfills.
 *
 * For PAID offers (priceUsd > 0):
 *   - Creates a billing session and returns a checkout URL
 *   - Does NOT grant value until payment confirmation (webhook)
 *
 * For FREE offers (priceUsd === 0):
 *   - Immediately fulfills in-app (grant coins, premium trial, etc.)
 */
export function redeemOffer(userId: string, offerId: string): RedemptionResult {
  const offer = OFFER_CATALOG.find(o => o.id === offerId);
  if (!offer) {
    return { success: false, error: "Offer not found" };
  }

  // Re-check eligibility at redemption time
  const eligibility = checkEligibility(userId, offerId);
  if (!eligibility.eligible) {
    return {
      success: false,
      error: `Not eligible: ${eligibility.reasons.join(", ")}`,
      alreadyRedeemed: eligibility.reasons.some(r => r.includes("Already redeemed")),
    };
  }

  // Verify user exists
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId) as { id: string } | undefined;
  if (!user) {
    return { success: false, error: "User not found" };
  }

  // ─── PAID OFFER: Initiate checkout ────────────────────────────
  if (offer.priceUsd > 0) {
    const checkoutResult = createOfferPurchaseSession(
      userId,
      offerId,
      offer.name,
      offer.priceUsd,
      offer.contents.coins || 0,
    );

    if (!checkoutResult.success) {
      return { success: false, error: checkoutResult.error || "Failed to create checkout session" };
    }

    // In dry-run mode, auto-fulfill the paid offer too (for dev convenience)
    if (isBillingDryRun()) {
      return fulfillPaidOffer(checkoutResult.sessionId!, userId, offerId);
    }

    return {
      success: true,
      requiresCheckout: true,
      checkoutUrl: checkoutResult.checkoutUrl,
      billingSessionId: checkoutResult.sessionId,
    };
  }

  // ─── FREE OFFER: Immediate in-app fulfillment ────────────────
  return fulfillFreeOffer(userId, offerId);
}

/**
 * Fulfill a free offer — immediately grants coins, premium trial, etc.
 */
function fulfillFreeOffer(userId: string, offerId: string): RedemptionResult {
  const offer = OFFER_CATALOG.find(o => o.id === offerId);
  if (!offer) {
    return { success: false, error: "Offer not found" };
  }

  const redemptionId = crypto.randomUUID();
  let coinsGranted = 0;
  let premiumDaysGranted = 0;

  const txn = db.transaction(() => {
    // Grant coins
    if (offer.contents.coins && offer.contents.coins > 0) {
      coinsGranted = offer.contents.coins;
      mutateBalance(
        userId, "gold_coins", coinsGranted,
        "offer_purchase", null,
        `Offer: ${offer.name}`,
      );
    }

    // Grant premium trial
    if (offer.contents.premiumTrialDays && offer.contents.premiumTrialDays > 0) {
      premiumDaysGranted = offer.contents.premiumTrialDays;
      grantPremium(
        userId, "offer_system",
        `Offer: ${offer.name} (${premiumDaysGranted}-day trial)`,
        premiumDaysGranted,
      );
    }

    // Record redemption
    stmts().insertRedemption.run(
      redemptionId, userId, offerId,
      coinsGranted, premiumDaysGranted, offer.priceUsd,
      null, // no billing session for free offers
    );

    // Record purchase interaction
    recordInteraction(userId, offerId, "purchase", "redemption", {
      coinsGranted,
      premiumDaysGranted,
      priceUsd: offer.priceUsd,
      fulfillmentType: "free_instant",
    });
  });

  txn();

  return {
    success: true,
    coinsGranted,
    premiumDaysGranted,
  };
}

/**
 * Fulfill a paid offer after payment confirmation.
 * Called from webhook processing or dry-run auto-fulfillment.
 * Atomically grants coins, premium trial, and records redemption.
 */
export function fulfillPaidOffer(
  billingSessionId: string,
  userId: string,
  offerId: string,
): RedemptionResult {
  const offer = OFFER_CATALOG.find(o => o.id === offerId);
  if (!offer) {
    return { success: false, error: "Offer not found" };
  }

  // Check if already redeemed (idempotent)
  const existingRedemption = stmts().getUserRedemption.get(userId, offerId) as any;
  if (existingRedemption) {
    return { success: true, alreadyRedeemed: true, coinsGranted: 0, premiumDaysGranted: 0 };
  }

  // Mark billing session as fulfilled
  const billingResult = fulfillOfferPurchase(billingSessionId, userId);
  if (!billingResult.success && !billingResult.alreadyFulfilled) {
    return { success: false, error: billingResult.error || "Billing fulfillment failed" };
  }

  const redemptionId = crypto.randomUUID();
  let coinsGranted = 0;
  let premiumDaysGranted = 0;

  const txn = db.transaction(() => {
    // Grant coins
    if (offer.contents.coins && offer.contents.coins > 0) {
      coinsGranted = offer.contents.coins;
      mutateBalance(
        userId, "gold_coins", coinsGranted,
        "offer_purchase", billingSessionId,
        `Starter offer: ${offer.name}`,
      );
    }

    // Grant premium trial
    if (offer.contents.premiumTrialDays && offer.contents.premiumTrialDays > 0) {
      premiumDaysGranted = offer.contents.premiumTrialDays;
      grantPremium(
        userId, "offer_system",
        `Offer: ${offer.name} (${premiumDaysGranted}-day trial)`,
        premiumDaysGranted,
      );
    }

    // Record redemption linked to billing session
    stmts().insertRedemption.run(
      redemptionId, userId, offerId,
      coinsGranted, premiumDaysGranted, offer.priceUsd,
      billingSessionId,
    );

    // Record purchase interaction
    recordInteraction(userId, offerId, "purchase", "checkout_fulfillment", {
      coinsGranted,
      premiumDaysGranted,
      priceUsd: offer.priceUsd,
      billingSessionId,
      fulfillmentType: "paid_webhook",
    });
  });

  txn();

  return {
    success: true,
    coinsGranted,
    premiumDaysGranted,
  };
}

// ─── Analytics ──────────────────────────────────────────────────────────

/**
 * Get analytics for a specific offer.
 */
export function getOfferAnalytics(offerId: string): OfferAnalytics {
  const row = stmts().getOfferAnalytics.get(offerId) as any;
  if (!row) {
    return {
      offerId,
      impressions: 0,
      dismissals: 0,
      clicks: 0,
      purchases: 0,
      revenue: 0,
      conversionRate: 0,
      dismissRate: 0,
    };
  }

  const impressions = row.impressions || 0;
  const purchases = row.purchases || 0;
  const dismissals = row.dismissals || 0;

  return {
    offerId,
    impressions,
    dismissals,
    clicks: row.clicks || 0,
    purchases,
    revenue: row.revenue || 0,
    conversionRate: impressions > 0 ? (purchases / impressions) * 100 : 0,
    dismissRate: impressions > 0 ? (dismissals / impressions) * 100 : 0,
  };
}

/**
 * Get analytics for all offers.
 */
export function getAllOfferAnalytics(): OfferAnalytics[] {
  const rows = stmts().getAllAnalytics.all() as any[];

  // Also get revenue from redemptions
  const revenueByOffer = db.prepare(`
    SELECT offer_id, SUM(price_usd) as total_revenue, COUNT(*) as redemption_count
    FROM offer_redemptions GROUP BY offer_id
  `).all() as any[];
  const revenueMap = new Map(revenueByOffer.map(r => [r.offer_id, r]));

  return OFFER_CATALOG.map(offer => {
    const interactionRow = rows.find(r => r.offer_id === offer.id);
    const revenueRow = revenueMap.get(offer.id);

    const impressions = interactionRow?.impressions || 0;
    const purchases = revenueRow?.redemption_count || 0;
    const dismissals = interactionRow?.dismissals || 0;
    const revenue = revenueRow?.total_revenue || 0;

    return {
      offerId: offer.id,
      impressions,
      dismissals,
      clicks: interactionRow?.clicks || 0,
      purchases,
      revenue,
      conversionRate: impressions > 0 ? (purchases / impressions) * 100 : 0,
      dismissRate: impressions > 0 ? (dismissals / impressions) * 100 : 0,
    };
  });
}

/**
 * Get user-specific offer state.
 */
export function getUserOfferState(userId: string, offerId: string): UserOfferState {
  const redemption = stmts().getUserRedemption.get(userId, offerId) as any;
  const impressionCount = (stmts().getUserImpressionCount.get(userId, offerId) as { count: number })?.count || 0;
  const dismissCount = (stmts().getUserDismissCount.get(userId, offerId) as { count: number })?.count || 0;
  const lastDismiss = stmts().getLastDismissal.get(userId, offerId) as { created_at: string } | undefined;

  // Check for pending billing session
  let pendingBillingSessionId: string | null = null;
  if (!redemption) {
    try {
      const pendingSession = db.prepare(`
        SELECT id FROM billing_sessions
        WHERE user_id = ? AND offer_id = ? AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1
      `).get(userId, offerId) as { id: string } | undefined;
      if (pendingSession) {
        pendingBillingSessionId = pendingSession.id;
      }
    } catch { /* ignore if column doesn't exist */ }
  }

  return {
    offerId,
    redeemed: !!redemption,
    redeemedAt: redemption?.created_at || null,
    impressionCount,
    lastDismissedAt: lastDismiss?.created_at || null,
    dismissCount,
    pendingBillingSessionId,
  };
}

/**
 * Get recent redemptions for admin view.
 */
export function getRecentRedemptions(limit: number = 30): any[] {
  return stmts().getRecentRedemptions.all(limit) as any[];
}
