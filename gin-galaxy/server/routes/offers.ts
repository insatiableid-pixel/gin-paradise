/**
 * Offer API Routes — First-purchase optimization and offer management.
 *
 * Endpoints:
 *   GET  /api/offers                — Get eligible offers for current user
 *   GET  /api/offers/:id            — Get specific offer details + eligibility
 *   POST /api/offers/:id/impression — Record an offer impression
 *   POST /api/offers/:id/dismiss    — Record an offer dismissal
 *   POST /api/offers/:id/click      — Record an offer click
 *   POST /api/offers/:id/redeem     — Redeem/purchase an offer
 *   GET  /api/offers/:id/state      — Get user's state for an offer
 *
 * Paid vs Free differentiation:
 *   - FREE offers (priceUsd = 0): Redeem endpoint immediately fulfills
 *   - PAID offers (priceUsd > 0): Redeem endpoint returns a checkout URL;
 *     fulfillment only happens after payment confirmation via webhook
 */

import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  OFFER_CATALOG,
  getEligibleOffers,
  checkEligibility,
  recordInteraction,
  redeemOffer,
  getUserOfferState,
  isBillingDryRun,
} from "../offers.js";
import { getBalances } from "../ledger.js";
import { getUserEntitlement } from "../entitlements.js";

const router = Router();

// Rate limit redemptions (10 per minute per IP)
const redeemLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many redemption requests. Please try again shortly.",
});

// ─── GET /api/offers — Eligible offers for current user ─────────────────

router.get("/", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const eligible = getEligibleOffers(req.userId!);

  // Filter to non-suppressed for the primary response, include suppressed for transparency
  const visible = eligible.filter(o => !o.suppressed);
  const suppressed = eligible.filter(o => o.suppressed);

  res.json({
    offers: visible.map(o => ({
      id: o.id,
      name: o.name,
      description: o.description,
      type: o.type,
      contents: o.contents,
      priceUsd: o.priceUsd,
      standardValueUsd: o.standardValueUsd,
      discountPercent: o.discountPercent,
      tagline: o.tagline,
      urgencyText: o.urgencyText,
      oneTimeOnly: o.oneTimeOnly,
      isPaid: o.priceUsd > 0,
    })),
    suppressed: suppressed.map(o => ({
      id: o.id,
      name: o.name,
      suppressReason: o.suppressReason,
    })),
    billingMode: isBillingDryRun() ? "dry_run" : "live",
  });
});

// ─── GET /api/offers/:id — Specific offer details + eligibility ─────────

router.get("/:id", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const offer = OFFER_CATALOG.find(o => o.id === req.params.id);
  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }

  const eligibility = checkEligibility(req.userId!, offer.id);
  const state = getUserOfferState(req.userId!, offer.id);

  res.json({
    offer: {
      id: offer.id,
      name: offer.name,
      description: offer.description,
      type: offer.type,
      contents: offer.contents,
      priceUsd: offer.priceUsd,
      standardValueUsd: offer.standardValueUsd,
      discountPercent: offer.discountPercent,
      tagline: offer.tagline,
      urgencyText: offer.urgencyText,
      oneTimeOnly: offer.oneTimeOnly,
      isPaid: offer.priceUsd > 0,
    },
    eligibility,
    state,
    billingMode: isBillingDryRun() ? "dry_run" : "live",
  });
});

// ─── POST /api/offers/:id/impression — Record impression ────────────────

router.post("/:id/impression", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const offer = OFFER_CATALOG.find(o => o.id === req.params.id);
  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }

  const surface = req.body?.surface || "unknown";
  recordInteraction(req.userId!, offer.id, "impression", surface);
  res.json({ success: true });
});

// ─── POST /api/offers/:id/dismiss — Record dismissal ────────────────────

router.post("/:id/dismiss", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const offer = OFFER_CATALOG.find(o => o.id === req.params.id);
  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }

  const surface = req.body?.surface || "unknown";
  recordInteraction(req.userId!, offer.id, "dismiss", surface);
  res.json({ success: true });
});

// ─── POST /api/offers/:id/click — Record click ─────────────────────────

router.post("/:id/click", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const offer = OFFER_CATALOG.find(o => o.id === req.params.id);
  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }

  const surface = req.body?.surface || "unknown";
  recordInteraction(req.userId!, offer.id, "click", surface);
  res.json({ success: true });
});

// ─── POST /api/offers/:id/redeem — Redeem/purchase an offer ─────────────

router.post(
  "/:id/redeem",
  redeemLimiter,
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const offer = OFFER_CATALOG.find(o => o.id === req.params.id);
    if (!offer) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }

    const result = redeemOffer(req.userId!, offer.id);

    if (!result.success) {
      const statusCode = result.alreadyRedeemed ? 409 : 400;
      res.status(statusCode).json({
        error: result.error,
        alreadyRedeemed: result.alreadyRedeemed,
      });
      return;
    }

    // If this is a paid offer requiring checkout, return the checkout URL
    if (result.requiresCheckout) {
      res.json({
        success: true,
        requiresCheckout: true,
        checkoutUrl: result.checkoutUrl,
        billingSessionId: result.billingSessionId,
        billingMode: isBillingDryRun() ? "dry_run" : "live",
      });
      return;
    }

    // Free offer — immediate fulfillment, return updated state
    const balances = getBalances(req.userId!);
    const entitlement = getUserEntitlement(req.userId!);

    res.json({
      success: true,
      requiresCheckout: false,
      coinsGranted: result.coinsGranted,
      premiumDaysGranted: result.premiumDaysGranted,
      balances,
      entitlement: {
        plan: entitlement.plan,
        expiresAt: entitlement.expiresAt,
      },
      billingMode: isBillingDryRun() ? "dry_run" : "live",
    });
  },
);

// ─── GET /api/offers/:id/state — User state for an offer ────────────────

router.get("/:id/state", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const offer = OFFER_CATALOG.find(o => o.id === req.params.id);
  if (!offer) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }

  const state = getUserOfferState(req.userId!, offer.id);
  const eligibility = checkEligibility(req.userId!, offer.id);

  res.json({ state, eligibility, isPaid: offer.priceUsd > 0 });
});

export default router;
