/**
 * Admin API Routes for Gin Paradise.
 *
 * All endpoints are protected by requireAuth + requireAdmin.
 * These are read-only operational visibility endpoints plus
 * live match curation controls and billing inspection.
 *
 * Endpoints:
 *   GET  /api/admin/revenue          — total rake by currency + summary cards
 *   GET  /api/admin/house-ledger     — recent house ledger (rake) entries
 *   GET  /api/admin/settlements      — recent staked match outcomes with settlement context
 *   GET  /api/admin/players/:id      — player wallet + recent ledger for support
 *   GET  /api/admin/players/search   — search for a player by username (targeted)
 *   GET  /api/admin/broadcast/live   — all live matches with admin metadata
 *   POST /api/admin/broadcast/feature   — admin-feature a live match
 *   POST /api/admin/broadcast/unfeature — admin-unfeature a live match
 *   GET  /api/admin/broadcast/metrics   — broadcast metrics summary + recent
 *   GET  /api/admin/billing/summary     — billing stats + mode overview
 *   GET  /api/admin/billing/events      — recent webhook events
 *   GET  /api/admin/billing/sessions    — recent billing sessions
 *   GET  /api/admin/offers/analytics     — offer analytics (impressions, conversions, revenue)
 *   GET  /api/admin/offers/redemptions   — recent offer redemptions
 *   GET  /api/admin/offers/catalog       — full offer catalog with analytics
 */

import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin, AdminRequest } from "../middleware/adminAuth.js";
import { db } from "../db.js";
import { getHouseRevenue, getHouseLedger } from "../houseAccounting.js";
import { getBalances, getTransactions } from "../ledger.js";
import { getLiveMatches } from "../multiplayer/roomManager.js";
import {
  addAdminFeatured,
  removeAdminFeatured,
  isAdminFeatured,
  getRecentBroadcastMetrics,
  getBroadcastSummary,
  getLiveBroadcastStats,
} from "../multiplayer/spectator.js";
import {
  getBillingStats,
  getRecentBillingEvents,
  getAllBillingSessions,
  isBillingDryRun,
  isWebhookSignatureEnabled,
} from "../billing.js";
import { getUserEntitlement } from "../entitlements.js";
import {
  OFFER_CATALOG,
  getAllOfferAnalytics,
  getRecentRedemptions,
} from "../offers.js";

const router = Router();

// All admin routes require auth + admin
router.use(requireAuth);
router.use(requireAdmin);

// ─── GET /api/admin/revenue ─────────────────────────────────────────────

router.get("/revenue", (_req: AdminRequest, res: Response) => {
  const revenue = getHouseRevenue();
  const ledgerRecent = getHouseLedger(5);

  // Total across all currencies
  const totalRakeCollected = revenue.reduce((sum, r) => sum + r.total_revenue, 0);
  const totalRakeTransactions = revenue.reduce((sum, r) => sum + r.transaction_count, 0);

  res.json({
    summary: {
      totalRakeCollected,
      totalRakeTransactions,
      byCurrency: revenue,
    },
    recentEntries: ledgerRecent,
  });
});

// ─── GET /api/admin/house-ledger ────────────────────────────────────────

router.get("/house-ledger", (req: AdminRequest, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);
  const entries = getHouseLedger(limit);
  res.json({ entries, count: entries.length });
});

// ─── GET /api/admin/settlements ─────────────────────────────────────────
// Joins replays + house_ledger for recent staked match outcomes.

router.get("/settlements", (req: AdminRequest, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 30, 1), 100);

  // Query recent replays that had a winner (settled matches)
  const settlements = db.prepare(`
    SELECT
      r.id           AS replay_id,
      r.room_id,
      r.player1_username,
      r.player2_username,
      r.winner_username,
      r.loser_username,
      r.winner_score,
      r.loser_score,
      r.end_reason,
      r.started_at,
      r.ended_at,
      r.action_count,
      h.currency,
      h.amount       AS rake_amount,
      h.stake_id,
      h.created_at   AS settled_at
    FROM replays r
    LEFT JOIN house_ledger h ON h.room_id = r.room_id
    WHERE r.winner_id IS NOT NULL
    ORDER BY r.ended_at DESC
    LIMIT ?
  `).all(limit);

  res.json({ settlements, count: settlements.length });
});

// ─── GET /api/admin/players/search ──────────────────────────────────────
// Targeted player search by username for support cases.
// NOTE: this route must be before /players/:id to avoid route collision

router.get("/players/search", (req: AdminRequest, res: Response) => {
  const username = String(req.query.q || "").trim();
  if (!username || username.length < 1) {
    res.status(400).json({ error: "Query parameter 'q' is required." });
    return;
  }

  const users = db.prepare(`
    SELECT id, username, email, rating, wins, losses, created_at, is_admin
    FROM users
    WHERE username LIKE ?
    LIMIT 20
  `).all(`%${username}%`) as any[];

  const results = users.map(u => ({
    ...u,
    is_admin: !!u.is_admin,
    balances: getBalances(u.id),
  }));

  res.json({ players: results, count: results.length });
});

// ─── GET /api/admin/players/:id ─────────────────────────────────────────
// Targeted player wallet + ledger inspection for support/debug.

router.get("/players/:id", (req: AdminRequest, res: Response) => {
  const { id } = req.params;

  const user = db.prepare(
    "SELECT id, username, email, rating, wins, losses, created_at, is_admin FROM users WHERE id = ?"
  ).get(id) as any;

  if (!user) {
    res.status(404).json({ error: "Player not found." });
    return;
  }

  const balances = getBalances(id);
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 30, 1), 100);
  const transactions = getTransactions(id, limit);
  const recentMatches = db.prepare(
    "SELECT * FROM matches WHERE user_id = ? ORDER BY created_at DESC LIMIT 10"
  ).all(id);

  res.json({
    player: { ...user, is_admin: !!user.is_admin },
    balances,
    transactions,
    recentMatches,
  });
});

// ─── GET /api/admin/broadcast/live ──────────────────────────────────────
// Returns ALL live matches with full admin-facing metadata.
// Admins can see eligibility reasons and broadcast stats for every match.

router.get("/broadcast/live", (_req: AdminRequest, res: Response) => {
  const matches = getLiveMatches();
  res.json({ matches, count: matches.length });
});

// ─── POST /api/admin/broadcast/feature ──────────────────────────────────
// Manually feature a live match. The match must exist and have two players.
// This does NOT override player spectate preferences — if a player has
// disabled spectating, the match will still not appear as spectatable.

router.post("/broadcast/feature", (req: AdminRequest, res: Response) => {
  const { roomId } = req.body;
  if (!roomId || typeof roomId !== "string") {
    res.status(400).json({ error: "roomId is required" });
    return;
  }

  // Verify room exists
  const matches = getLiveMatches();
  const match = matches.find(m => m.roomId === roomId);
  if (!match) {
    res.status(404).json({ error: "Room not found or no active match" });
    return;
  }

  if (isAdminFeatured(roomId)) {
    res.json({ success: true, message: "Already featured", roomId });
    return;
  }

  addAdminFeatured(roomId);
  res.json({
    success: true,
    message: "Match featured successfully",
    roomId,
    isSpectatable: match.isSpectatable || match.reasons.length > 0,
  });
});

// ─── POST /api/admin/broadcast/unfeature ────────────────────────────────
// Remove admin featuring from a live match.

router.post("/broadcast/unfeature", (req: AdminRequest, res: Response) => {
  const { roomId } = req.body;
  if (!roomId || typeof roomId !== "string") {
    res.status(400).json({ error: "roomId is required" });
    return;
  }

  if (!isAdminFeatured(roomId)) {
    res.json({ success: true, message: "Not currently featured", roomId });
    return;
  }

  removeAdminFeatured(roomId);
  res.json({ success: true, message: "Match unfeatured successfully", roomId });
});

// ─── GET /api/admin/broadcast/metrics ───────────────────────────────────
// Broadcast metrics: summary + recent completed match metrics.

router.get("/broadcast/metrics", (req: AdminRequest, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 20, 1), 100);
  const summary = getBroadcastSummary();
  const recent = getRecentBroadcastMetrics(limit);

  res.json({
    summary,
    recent: recent.map(m => ({
      roomId: m.room_id,
      player1Username: m.player1_username,
      player2Username: m.player2_username,
      peakConcurrentSpectators: m.peak_concurrent_spectators,
      totalUniqueSpectators: m.total_unique_spectators,
      wasAdminFeatured: !!m.was_admin_featured,
      featuredReasons: JSON.parse(m.featured_reasons || "[]"),
      stakeId: m.stake_id,
      matchDurationSeconds: m.match_duration_seconds,
      winnerUsername: m.winner_username,
      startedAt: m.started_at,
      endedAt: m.ended_at,
    })),
  });
});

// ─── GET /api/admin/billing/summary ─────────────────────────────────────
// Billing overview: revenue stats, modes, and configuration status.

router.get("/billing/summary", (_req: AdminRequest, res: Response) => {
  const stats = getBillingStats() || {};
  res.json({
    billingMode: isBillingDryRun() ? "dry_run" : "live",
    webhookSignatureVerification: isWebhookSignatureEnabled() ? "enabled" : "disabled",
    revenue: {
      coinPurchaseRevenue: stats.coin_revenue || 0,
      subscriptionRevenue: stats.sub_revenue || 0,
      offerRevenue: stats.offer_revenue || 0,
      totalRevenue: (stats.coin_revenue || 0) + (stats.sub_revenue || 0) + (stats.offer_revenue || 0),
      coinPurchaseCount: stats.coin_count || 0,
      subscriptionCount: stats.sub_count || 0,
      offerPurchaseCount: stats.offer_count || 0,
    },
    sessions: {
      pending: stats.pending_count || 0,
      failed: stats.failed_count || 0,
      cancelled: stats.cancelled_count || 0,
    },
  });
});

// ─── GET /api/admin/billing/events ──────────────────────────────────────
// Recent webhook events for debugging duplicate handling and failures.

router.get("/billing/events", (req: AdminRequest, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);
  const events = getRecentBillingEvents(limit);
  res.json({ events, count: events.length });
});

// ─── GET /api/admin/billing/sessions ────────────────────────────────────
// Recent billing sessions for support/debug, with entitlement context.

router.get("/billing/sessions", (req: AdminRequest, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 50, 1), 200);
  const sessions = getAllBillingSessions(limit);

  // Enrich sessions with user info and offer context
  const enriched = sessions.map((s: any) => {
    const user = db.prepare("SELECT username FROM users WHERE id = ?").get(s.user_id) as { username: string } | undefined;
    const entitlement = getUserEntitlement(s.user_id);
    const isOfferPurchase = s.type === "offer_purchase";
    const offerDef = isOfferPurchase ? OFFER_CATALOG.find(o => o.id === s.offer_id) : undefined;
    return {
      ...s,
      username: user?.username || "Unknown",
      premiumStatus: entitlement.plan,
      premiumExpiresAt: entitlement.expiresAt,
      isOfferPurchase,
      offerName: offerDef?.name || (isOfferPurchase ? s.offer_id : null),
      purchaseSource: isOfferPurchase ? "offer" : s.type === "subscription" ? "subscription" : "standard",
    };
  });

  res.json({
    sessions: enriched,
    count: enriched.length,
    billingMode: isBillingDryRun() ? "dry_run" : "live",
  });
});

// ─── GET /api/admin/offers/analytics ────────────────────────────────────
// Offer analytics: impressions, clicks, conversions, revenue.

router.get("/offers/analytics", (_req: AdminRequest, res: Response) => {
  const analytics = getAllOfferAnalytics();

  // Enrich with offer metadata
  const enriched = analytics.map(a => {
    const offer = OFFER_CATALOG.find(o => o.id === a.offerId);
    return {
      ...a,
      offerName: offer?.name || "Unknown",
      offerType: offer?.type || "unknown",
      priceUsd: offer?.priceUsd || 0,
      active: offer?.active || false,
    };
  });

  const totals = {
    totalImpressions: enriched.reduce((s, a) => s + a.impressions, 0),
    totalClicks: enriched.reduce((s, a) => s + a.clicks, 0),
    totalPurchases: enriched.reduce((s, a) => s + a.purchases, 0),
    totalRevenue: enriched.reduce((s, a) => s + a.revenue, 0),
  };

  res.json({
    offers: enriched,
    totals,
    catalogSize: OFFER_CATALOG.length,
    activeOffers: OFFER_CATALOG.filter(o => o.active).length,
  });
});

// ─── GET /api/admin/offers/redemptions ──────────────────────────────────
// Recent offer redemptions for support/debug.

router.get("/offers/redemptions", (req: AdminRequest, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 30, 1), 100);
  const redemptions = getRecentRedemptions(limit);

  res.json({
    redemptions: redemptions.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username || "Unknown",
      offerId: r.offer_id,
      coinsGranted: r.coins_granted,
      premiumDaysGranted: r.premium_days_granted,
      priceUsd: r.price_usd,
      createdAt: r.created_at,
    })),
    count: redemptions.length,
  });
});

// ─── GET /api/admin/offers/catalog ──────────────────────────────────────
// Full offer catalog with current status.

router.get("/offers/catalog", (_req: AdminRequest, res: Response) => {
  res.json({
    catalog: OFFER_CATALOG.map(o => ({
      id: o.id,
      name: o.name,
      type: o.type,
      priceUsd: o.priceUsd,
      standardValueUsd: o.standardValueUsd,
      discountPercent: o.discountPercent,
      contents: o.contents,
      oneTimeOnly: o.oneTimeOnly,
      active: o.active,
      eligibility: o.eligibility,
    })),
  });
});

export default router;
