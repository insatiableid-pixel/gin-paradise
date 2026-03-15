/**
 * Billing API Routes — Coin purchases and premium subscriptions.
 *
 * Endpoints:
 *   GET  /api/billing/packages         — Available coin packages
 *   GET  /api/billing/subscriptions    — Available subscription plans
 *   POST /api/billing/purchase         — Create a coin purchase checkout
 *   POST /api/billing/subscribe        — Create a subscription checkout
 *   GET  /api/billing/history          — Purchase history for current user
 *   GET  /api/billing/session/:id      — Get specific billing session status
 *   GET  /api/billing/status           — Billing configuration status
 */

import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  COIN_PACKAGES,
  SUBSCRIPTION_PLANS,
  createCoinPurchaseSession,
  createSubscriptionSession,
  getUserPurchaseHistory,
  getBillingSession,
  isBillingDryRun,
  isWebhookSignatureEnabled,
} from "../billing.js";
import { getBalances } from "../ledger.js";

const router = Router();

// Rate limit purchases (5 per minute per IP)
const purchaseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many purchase requests. Please try again shortly.",
});

// ─── GET /api/billing/packages — Coin package catalog ───────────────────

router.get("/packages", requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  res.json({
    packages: COIN_PACKAGES,
    currency: "USD",
    billingMode: isBillingDryRun() ? "dry_run" : "live",
  });
});

// ─── GET /api/billing/subscriptions — Subscription plans ────────────────

router.get("/subscriptions", requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  res.json({
    plans: SUBSCRIPTION_PLANS,
    currency: "USD",
    billingMode: isBillingDryRun() ? "dry_run" : "live",
  });
});

// ─── POST /api/billing/purchase — Create coin purchase ──────────────────

router.post(
  "/purchase",
  purchaseLimiter,
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const { packageId } = req.body;

    if (!packageId || typeof packageId !== "string") {
      res.status(400).json({ error: "Missing or invalid packageId" });
      return;
    }

    const result = createCoinPurchaseSession(req.userId!, packageId);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    // In dry-run mode, balances are updated instantly. In live mode, balances
    // update after webhook confirmation — return current balances for now.
    const balances = getBalances(req.userId!);

    res.json({
      success: true,
      sessionId: result.sessionId,
      checkoutUrl: result.checkoutUrl,
      requiresCheckout: result.requiresCheckout || false,
      balances,
      billingMode: result.billingMode || (isBillingDryRun() ? "dry_run" : "live"),
    });
  }
);

// ─── POST /api/billing/subscribe — Create subscription ──────────────────

router.post(
  "/subscribe",
  purchaseLimiter,
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const { planId } = req.body;

    if (!planId || typeof planId !== "string") {
      res.status(400).json({ error: "Missing or invalid planId" });
      return;
    }

    const result = createSubscriptionSession(req.userId!, planId);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      sessionId: result.sessionId,
      checkoutUrl: result.checkoutUrl,
      requiresCheckout: result.requiresCheckout || false,
      billingMode: result.billingMode || (isBillingDryRun() ? "dry_run" : "live"),
    });
  }
);

// ─── GET /api/billing/history — Purchase history ────────────────────────

router.get("/history", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 20, 1), 100);
  const history = getUserPurchaseHistory(req.userId!, limit);
  res.json({ history });
});

// ─── GET /api/billing/session/:id — Session status ──────────────────────

router.get("/session/:id", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const session = getBillingSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  // Only allow users to see their own sessions
  if (session.user_id !== req.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json({
    session: {
      id: session.id,
      type: session.type,
      packageId: session.package_id,
      status: session.status,
      amountUsd: session.amount_usd,
      coinsAmount: session.coins_amount,
      createdAt: session.created_at,
      fulfilledAt: session.fulfilled_at,
    },
    billingMode: isBillingDryRun() ? "dry_run" : "live",
  });
});

// ─── GET /api/billing/status — Billing status ───────────────────────────

router.get("/status", requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  res.json({
    billingMode: isBillingDryRun() ? "dry_run" : "live",
    provider: "stripe",
    webhookSignatureVerification: isWebhookSignatureEnabled() ? "enabled" : "disabled",
    coinPackagesAvailable: COIN_PACKAGES.length,
    subscriptionPlansAvailable: SUBSCRIPTION_PLANS.length,
    note: isBillingDryRun()
      ? "Billing is in dry-run mode. Purchases auto-fulfill for testing. Set STRIPE_SECRET_KEY to enable live billing."
      : "Live billing is active.",
  });
});

export default router;
