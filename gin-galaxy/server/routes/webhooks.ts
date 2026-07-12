/**
 * Stripe Webhook Endpoint for Gin Paradise.
 *
 * Receives Stripe webhook events for payment and subscription lifecycle processing.
 * All events are processed idempotently — duplicate events are safely ignored.
 *
 * Endpoints:
 *   POST /api/webhooks/stripe — Process incoming Stripe webhook events
 *
 * Supported Stripe event types:
 *   - checkout.session.completed: Fulfills coin purchases, subscription activations, and paid offers
 *   - invoice.paid: Handles subscription renewals
 *   - customer.subscription.deleted: Handles subscription cancellations
 *
 * Security:
 *   - Signature verification when STRIPE_WEBHOOK_SECRET is set
 *   - Raw body bytes preserved for accurate signature computation
 *   - Replay protection (5-minute window)
 *
 * Raw Body Handling:
 *   This endpoint uses the rawBody attached by express.raw() middleware (configured
 *   in server.ts). The raw, unmodified request bytes are essential for Stripe webhook
 *   signature verification — re-serialized JSON produces different bytes and breaks
 *   signature validation. When rawBody is not available (e.g. in tests without the
 *   middleware), we fall back to JSON.stringify(req.body) but log a warning.
 *
 * NOTE: This endpoint does NOT use requireAuth.
 * Stripe webhooks are authenticated via signature verification, not user sessions.
 */

import { Router, Request, Response } from "express";
import {
  processWebhookEvent,
  verifyWebhookSignature,
  isBillingDryRun,
  isWebhookSignatureEnabled,
  getBillingSession,
} from "../billing.js";
import { fulfillPaidOffer } from "../offers.js";

const router = Router();

// ─── POST /api/webhooks/stripe — Process Stripe webhook ─────────────────

router.post("/stripe", (req: Request, res: Response) => {
  // Use preserved raw body bytes for signature verification.
  // This is set by express.raw() middleware applied specifically to this route
  // in server.ts, ensuring the original bytes are available.
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  const signatureHeader = req.headers["stripe-signature"] as string | undefined;

  // Verify signature using raw body bytes
  if (!verifyWebhookSignature(rawBody, signatureHeader)) {
    res.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  // Parse event
  let event: any;
  try {
    if ((req as any).rawBody) {
      // Parse from the raw body to ensure we use the original payload
      const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
      event = JSON.parse(bodyStr);
    } else {
      // Fall back to already-parsed body (test/dev environments)
      event = req.body;
    }
  } catch {
    res.status(400).json({ error: "Malformed JSON payload" });
    return;
  }

  if (!event || !event.id || !event.type) {
    res.status(400).json({ error: "Invalid event payload" });
    return;
  }

  // Process the event through the billing system
  const result = processWebhookEvent(event.id, event.type, event);

  // For offer purchase completion, handle the offer fulfillment
  if (result.success && event.type === "checkout.session.completed" && result.action === "checkout_completed_offer_purchase") {
    const sessionData = event?.data?.object || event;
    const billingSessionId = sessionData?.client_reference_id || sessionData?.metadata?.billing_session_id;

    if (billingSessionId) {
      const billingSession = getBillingSession(billingSessionId);
      if (billingSession && billingSession.offer_id) {
        const offerResult = fulfillPaidOffer(billingSessionId, billingSession.user_id, billingSession.offer_id);
        if (!offerResult.success && !offerResult.alreadyRedeemed) {
          console.error("[webhook] Failed to fulfill paid offer:", offerResult.error);
        }
      }
    }
  }

  if (result.success) {
    res.json({
      received: true,
      action: result.action,
      duplicate: result.duplicate || false,
    });
  } else {
    // Still return 200 to Stripe to prevent retries for permanent failures
    // Stripe retries on 4xx/5xx, but we log the error internally
    res.json({
      received: true,
      action: result.action,
      error: result.error,
    });
  }
});

// ─── GET /api/webhooks/stripe/status — Webhook status info ──────────────

router.get("/stripe/status", (_req: Request, res: Response) => {
  res.json({
    billingMode: isBillingDryRun() ? "dry_run" : "live",
    signatureVerification: isWebhookSignatureEnabled() ? "enabled" : "disabled",
    rawBodyPreservation: "enabled",
    supportedEvents: [
      "checkout.session.completed",
      "invoice.paid",
      "customer.subscription.deleted",
    ],
  });
});

export default router;
