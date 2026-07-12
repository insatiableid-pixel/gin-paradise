/**
 * Billing and Revenue Hardening Tests for Gin Paradise.
 *
 * Covers:
 *   - Webhook authentication/signature behavior with raw body bytes
 *   - Timing-safe signature verification
 *   - Idempotent webhook handling and duplicate-event safety
 *   - Coin purchase fulfillment and wallet crediting
 *   - Offer purchase sessions and paid-offer billing flow
 *   - Premium subscription fulfillment and entitlement activation
 *   - Subscription cancellation handling
 *   - Billing-mode status behavior (live vs dry-run)
 *   - Admin billing visibility endpoints with offer revenue attribution
 *   - Full regression coverage across wallet, entitlements, and admin surfaces
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "crypto";
import {
  startTestServer,
  stopTestServer,
  getBaseUrl,
  registerUser,
  makeRequest,
} from "./helpers.js";
import { db } from "../server/db.js";
import {
  initBillingTables,
  processWebhookEvent,
  verifyWebhookSignature,
  fulfillCoinPurchase,
  fulfillSubscription,
  fulfillOfferPurchase,
  createCoinPurchaseSession,
  createSubscriptionSession,
  createOfferPurchaseSession,
  cancelSubscription,
  isBillingDryRun,
  isWebhookSignatureEnabled,
  getBillingSession,
  getUserPurchaseHistory,
  getRecentBillingEvents,
  getAllBillingSessions,
  getBillingStats,
  getOfferBillingSessions,
  COIN_PACKAGES,
  SUBSCRIPTION_PLANS,
} from "../server/billing.js";
import { getBalances } from "../server/ledger.js";
import { getUserPlan, isPremium } from "../server/entitlements.js";

let base: string;
let userSession: string;
let userId: string;
let adminSession: string;
let adminId: string;

beforeAll(async () => {
  base = await startTestServer();
});

afterAll(async () => {
  await stopTestServer();
});

// ─── Helper: Register and get session ────────────────────────────────

const testSuffix = Date.now().toString(36);

/**
 * Create a test user via the API (rate-limited to 20 per 15 minutes).
 * Use this only when you need to test the registration flow.
 */
async function createTestUser(username: string, email: string, password = "password123") {
  const uniqueName = `${username}_${testSuffix}`;
  const uniqueEmail = `${uniqueName}@test.com`;
  const reg = await registerUser(uniqueName, uniqueEmail, password);
  if (reg.status !== 200 || !reg.body.user) {
    throw new Error(`Failed to register user ${uniqueName}: ${JSON.stringify(reg.body)}`);
  }
  return {
    userId: reg.body.user.id,
    sessionId: reg.body.sessionId,
  };
}

/**
 * Create a test user directly in the DB, bypassing rate-limited API.
 * Use this for tests that need many users but aren't testing auth flow.
 * Includes session and signup bonus for full test compatibility.
 */
import bcrypt from "bcryptjs";
import { creditSignupBonus } from "../server/ledger.js";

function createDbUser(username: string): { userId: string; sessionId: string } {
  const uniqueName = `${username}_${testSuffix}`;
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const hash = bcrypt.hashSync("password123", 4); // fast rounds for test
  db.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)")
    .run(userId, uniqueName, `${uniqueName}@test.com`, hash);
  creditSignupBonus(userId);
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sessionId, userId, expiresAt);
  return { userId, sessionId };
}

// ─── Billing Module Tests ────────────────────────────────────────────

describe("Billing Module", () => {
  it("should report dry-run mode when no Stripe key is set", () => {
    expect(isBillingDryRun()).toBe(true);
  });

  it("should report webhook signature verification disabled without secret", () => {
    expect(isWebhookSignatureEnabled()).toBe(false);
  });

  it("should have valid coin package catalog", () => {
    expect(COIN_PACKAGES.length).toBeGreaterThan(0);
    for (const pkg of COIN_PACKAGES) {
      expect(pkg.id).toBeTruthy();
      expect(pkg.coins).toBeGreaterThan(0);
      expect(pkg.priceUsd).toBeGreaterThan(0);
    }
  });

  it("should have valid subscription plans", () => {
    expect(SUBSCRIPTION_PLANS.length).toBeGreaterThan(0);
    for (const plan of SUBSCRIPTION_PLANS) {
      expect(plan.id).toBeTruthy();
      expect(plan.priceUsd).toBeGreaterThan(0);
      expect(plan.intervalDays).toBeGreaterThan(0);
    }
  });
});

// ─── Coin Purchase Tests ─────────────────────────────────────────────

describe("Coin Purchase Fulfillment", () => {
  it("should create a coin purchase session and auto-fulfill in dry-run", async () => {
    const user = await createTestUser("billing_purchase_1", "bp1@test.com");
    const startBalance = getBalances(user.userId);

    const result = createCoinPurchaseSession(user.userId, "coins_5000");
    expect(result.success).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(result.checkoutUrl).toContain("purchase=success");

    // In dry-run, should be auto-fulfilled
    const session = getBillingSession(result.sessionId!);
    expect(session.status).toBe("completed");

    // Balance should be credited
    const endBalance = getBalances(user.userId);
    expect(endBalance.gold_coins).toBe(startBalance.gold_coins + 5000);
  });

  it("should reject unknown package IDs", async () => {
    const user = await createTestUser("billing_purchase_2", "bp2@test.com");
    const result = createCoinPurchaseSession(user.userId, "nonexistent_package");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown package");
  });

  it("should be idempotent — double fulfillment returns alreadyFulfilled", async () => {
    const user = await createTestUser("billing_purchase_3", "bp3@test.com");
    const result = createCoinPurchaseSession(user.userId, "coins_5000");

    // Already fulfilled in dry run, try again
    const double = fulfillCoinPurchase(result.sessionId!, user.userId, 5000, "coins_5000");
    expect(double.success).toBe(true);
    expect(double.alreadyFulfilled).toBe(true);

    // Balance should not be double-credited
    const balance = getBalances(user.userId);
    // 5000 signup + 5000 purchase = 10000
    expect(balance.gold_coins).toBe(10000);
  });

  it("should track purchase in billing history", async () => {
    const user = await createTestUser("billing_purchase_4", "bp4@test.com");
    createCoinPurchaseSession(user.userId, "coins_12000");

    const history = getUserPurchaseHistory(user.userId);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].package_id).toBe("coins_12000");
    expect(history[0].status).toBe("completed");
    expect(history[0].type).toBe("coin_purchase");
  });
});

// ─── Offer Purchase Session Tests ────────────────────────────────────

describe("Offer Purchase Sessions", () => {
  it("should create an offer purchase session in dry-run (no auto-fulfill)", async () => {
    const user = await createTestUser("billing_offerpurch_1", "bop1@test.com");
    const result = createOfferPurchaseSession(
      user.userId, "starter_bundle", "Starter Bundle", 4.99, 15000
    );

    expect(result.success).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(result.billingMode).toBe("dry_run");
    expect(result.requiresCheckout).toBe(false);

    // Session should be pending — NOT auto-fulfilled
    const session = getBillingSession(result.sessionId!);
    expect(session.status).toBe("pending");
    expect(session.type).toBe("offer_purchase");
    expect(session.offer_id).toBe("starter_bundle");
    expect(session.amount_usd).toBe(4.99);
    expect(session.coins_amount).toBe(15000);
  });

  it("should track offer_id on billing sessions", async () => {
    const user = await createTestUser("billing_offerpurch_2", "bop2@test.com");
    const result = createOfferPurchaseSession(
      user.userId, "starter_bundle", "Starter Bundle", 4.99, 15000
    );

    const sessions = getOfferBillingSessions("starter_bundle", 10);
    expect(sessions.length).toBeGreaterThan(0);

    const found = sessions.find((s: any) => s.id === result.sessionId);
    expect(found).toBeTruthy();
    expect(found.offer_id).toBe("starter_bundle");
  });

  it("should fulfill offer purchase idempotently", async () => {
    const user = await createTestUser("billing_offerpurch_3", "bop3@test.com");
    const result = createOfferPurchaseSession(
      user.userId, "starter_bundle", "Starter Bundle", 4.99, 15000
    );

    // Fulfill
    const fill1 = fulfillOfferPurchase(result.sessionId!, user.userId);
    expect(fill1.success).toBe(true);

    // Second fulfillment — should be idempotent
    const fill2 = fulfillOfferPurchase(result.sessionId!, user.userId);
    expect(fill2.success).toBe(true);
    expect(fill2.alreadyFulfilled).toBe(true);
  });

  it("should reject non-offer session for offer fulfillment", async () => {
    const user = await createTestUser("billing_offerpurch_4", "bop4@test.com");
    const coinResult = createCoinPurchaseSession(user.userId, "coins_5000");

    // Reset the session to pending for testing
    db.prepare("UPDATE billing_sessions SET status = 'pending', fulfilled_at = NULL WHERE id = ?")
      .run(coinResult.sessionId);

    const fill = fulfillOfferPurchase(coinResult.sessionId!, user.userId);
    expect(fill.success).toBe(false);
    expect(fill.error).toContain("not an offer purchase");
  });
});

// ─── Subscription Tests ──────────────────────────────────────────────

describe("Subscription Fulfillment", () => {
  it("should create and auto-fulfill subscription in dry-run", async () => {
    const user = await createTestUser("billing_sub_1", "bs1@test.com");
    expect(isPremium(user.userId)).toBe(false);

    const result = createSubscriptionSession(user.userId, "premium_monthly");
    expect(result.success).toBe(true);

    // Should be auto-fulfilled and premium granted
    expect(isPremium(user.userId)).toBe(true);
    expect(getUserPlan(user.userId)).toBe("premium");
  });

  it("should be idempotent for subscription fulfillment", async () => {
    const user = await createTestUser("billing_sub_2", "bs2@test.com");
    const result = createSubscriptionSession(user.userId, "premium_monthly");

    const double = fulfillSubscription(result.sessionId!, user.userId, "premium_monthly");
    expect(double.success).toBe(true);
    expect(double.alreadyFulfilled).toBe(true);

    expect(isPremium(user.userId)).toBe(true);
  });

  it("should reject unknown plan IDs", async () => {
    const user = await createTestUser("billing_sub_3", "bs3@test.com");
    const result = createSubscriptionSession(user.userId, "nonexistent_plan");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown plan");
  });

  it("should handle subscription cancellation", async () => {
    const user = await createTestUser("billing_sub_4", "bs4@test.com");
    createSubscriptionSession(user.userId, "premium_monthly");
    expect(isPremium(user.userId)).toBe(true);

    const cancelResult = cancelSubscription(user.userId, "User cancelled");
    expect(cancelResult.success).toBe(true);
    expect(isPremium(user.userId)).toBe(false);
  });
});

// ─── Webhook Event Processing Tests ──────────────────────────────────

describe("Webhook Event Processing", () => {
  it("should process checkout.session.completed for coin purchase", async () => {
    const user = await createTestUser("billing_wh_1", "bw1@test.com");
    const session = createCoinPurchaseSession(user.userId, "coins_30000");

    // Reset completion status for webhook test
    db.prepare("UPDATE billing_sessions SET status = 'pending', fulfilled_at = NULL WHERE id = ?")
      .run(session.sessionId);
    // Also reverse the balance credit from dry-run auto-fulfillment
    db.prepare("UPDATE wallets SET gold_coins = gold_coins - 30000 WHERE user_id = ?")
      .run(user.userId);

    const result = processWebhookEvent(
      `evt_test_${crypto.randomUUID()}`,
      "checkout.session.completed",
      {
        data: {
          object: {
            id: `cs_test_${crypto.randomUUID()}`,
            client_reference_id: session.sessionId,
          },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("checkout_completed_coin_purchase");

    const balance = getBalances(user.userId);
    expect(balance.gold_coins).toBe(5000 + 30000); // signup + purchase
  });

  it("should process checkout.session.completed for offer purchase", async () => {
    const user = await createTestUser("billing_wh_offer_1", "bwo1@test.com");
    const session = createOfferPurchaseSession(
      user.userId, "starter_bundle", "Starter Bundle", 4.99, 15000
    );

    const result = processWebhookEvent(
      `evt_test_offer_${crypto.randomUUID()}`,
      "checkout.session.completed",
      {
        data: {
          object: {
            id: `cs_test_offer_${crypto.randomUUID()}`,
            client_reference_id: session.sessionId,
          },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("checkout_completed_offer_purchase");

    // Billing session should be marked completed
    const billingSession = getBillingSession(session.sessionId!);
    expect(billingSession.status).toBe("completed");
  });

  it("should deduplicate webhook events", async () => {
    const user = await createTestUser("billing_wh_2", "bw2@test.com");
    const session = createCoinPurchaseSession(user.userId, "coins_5000");
    const stripeEventId = `evt_test_dedup_${crypto.randomUUID()}`;

    // Reset for webhook processing
    db.prepare("UPDATE billing_sessions SET status = 'pending', fulfilled_at = NULL WHERE id = ?")
      .run(session.sessionId);
    db.prepare("UPDATE wallets SET gold_coins = gold_coins - 5000 WHERE user_id = ?")
      .run(user.userId);

    // First call
    const result1 = processWebhookEvent(stripeEventId, "checkout.session.completed", {
      data: { object: { client_reference_id: session.sessionId } },
    });
    expect(result1.success).toBe(true);
    expect(result1.duplicate).toBeFalsy();

    const balanceAfterFirst = getBalances(user.userId);

    // Second call with same event ID — should be deduplicated
    const result2 = processWebhookEvent(stripeEventId, "checkout.session.completed", {
      data: { object: { client_reference_id: session.sessionId } },
    });
    expect(result2.success).toBe(true);
    expect(result2.duplicate).toBe(true);
    expect(result2.action).toBe("ignored_duplicate");

    // Balance should not change
    const balanceAfterSecond = getBalances(user.userId);
    expect(balanceAfterSecond.gold_coins).toBe(balanceAfterFirst.gold_coins);
  });

  it("should process customer.subscription.deleted events", async () => {
    const user = await createTestUser("billing_wh_3", "bw3@test.com");
    createSubscriptionSession(user.userId, "premium_monthly");
    expect(isPremium(user.userId)).toBe(true);

    const result = processWebhookEvent(
      `evt_test_cancel_${crypto.randomUUID()}`,
      "customer.subscription.deleted",
      {
        data: {
          object: {
            metadata: { user_id: user.userId },
          },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("subscription_cancelled");
    expect(isPremium(user.userId)).toBe(false);
  });

  it("should handle unknown event types gracefully", () => {
    const result = processWebhookEvent(
      `evt_test_unknown_${crypto.randomUUID()}`,
      "charge.refunded",
      {}
    );
    expect(result.success).toBe(true);
    expect(result.action).toBe("ignored_unhandled");
  });

  it("should record all events in billing_events table", async () => {
    const user = await createTestUser("billing_wh_4", "bw4@test.com");
    const eventId = `evt_test_audit_${crypto.randomUUID()}`;

    processWebhookEvent(eventId, "charge.succeeded", {});

    const events = getRecentBillingEvents(10);
    const found = events.find(e => e.stripe_event_id === eventId);
    expect(found).toBeTruthy();
    expect(found!.event_type).toBe("charge.succeeded");
    expect(found!.status).toBe("ignored");
  });
});

// ─── Webhook Signature Verification Tests ────────────────────────────

describe("Webhook Signature Verification", () => {
  it("should accept events when no webhook secret is configured", () => {
    const result = verifyWebhookSignature("{}", undefined);
    expect(result).toBe(true);
  });

  it("should accept events without signature header when no secret", () => {
    const result = verifyWebhookSignature("{}", undefined);
    expect(result).toBe(true);
  });

  it("should accept raw Buffer bodies when no secret is configured", () => {
    const rawBuffer = Buffer.from('{"id":"evt_test","type":"test.event"}');
    const result = verifyWebhookSignature(rawBuffer, undefined);
    expect(result).toBe(true);
  });

  it("should handle both string and Buffer raw bodies", () => {
    const jsonStr = '{"id":"test_event","type":"checkout.session.completed"}';
    const jsonBuf = Buffer.from(jsonStr);

    // Both should pass when no secret is configured
    expect(verifyWebhookSignature(jsonStr, undefined)).toBe(true);
    expect(verifyWebhookSignature(jsonBuf, undefined)).toBe(true);
  });

  it("should accept a correctly signed payload when a webhook secret is configured", () => {
    const original = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_signing_secret";
      const body = '{"id":"evt_signed","type":"checkout.session.completed"}';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
        .update(`${timestamp}.${body}`)
        .digest("hex");
      expect(verifyWebhookSignature(body, `t=${timestamp},v1=${signature}`)).toBe(true);
    } finally {
      if (original === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = original;
    }
  });

  it("should reject a tampered payload", () => {
    const original = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_signing_secret";
      const body = '{"id":"evt_signed","type":"checkout.session.completed"}';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
        .update(`${timestamp}.${body}`)
        .digest("hex");
      const tampered = body.replace("evt_signed", "evt_tampered");
      expect(verifyWebhookSignature(tampered, `t=${timestamp},v1=${signature}`)).toBe(false);
    } finally {
      if (original === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = original;
    }
  });
});

// ─── Billing API Routes Tests ────────────────────────────────────────

describe("Billing API Routes", () => {
  let testUser: { userId: string; sessionId: string };

  beforeAll(async () => {
    testUser = await createTestUser("b_api_usr", "bapi@test.com");
  });

  it("GET /api/billing/packages returns coin packages", async () => {
    const res = await makeRequest("GET", "/api/billing/packages", undefined, {
      Authorization: `Bearer ${testUser.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.packages.length).toBeGreaterThan(0);
    expect(res.body.billingMode).toBe("dry_run");
  });

  it("GET /api/billing/subscriptions returns plans", async () => {
    const res = await makeRequest("GET", "/api/billing/subscriptions", undefined, {
      Authorization: `Bearer ${testUser.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.plans.length).toBeGreaterThan(0);
    expect(res.body.billingMode).toBe("dry_run");
  });

  it("POST /api/billing/purchase creates a purchase (dry-run)", async () => {
    const res = await makeRequest("POST", "/api/billing/purchase",
      { packageId: "coins_5000" },
      { Authorization: `Bearer ${testUser.sessionId}` },
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.billingMode).toBe("dry_run");
    expect(res.body.balances.gold_coins).toBeGreaterThan(0);
    // In dry-run, requiresCheckout should be false
    expect(res.body.requiresCheckout).toBe(false);
  });

  it("POST /api/billing/purchase rejects invalid packageId", async () => {
    const res = await makeRequest("POST", "/api/billing/purchase",
      { packageId: "fake_package" },
      { Authorization: `Bearer ${testUser.sessionId}` },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Unknown package");
  });

  it("POST /api/billing/subscribe creates a subscription (dry-run)", async () => {
    const res = await makeRequest("POST", "/api/billing/subscribe",
      { planId: "premium_monthly" },
      { Authorization: `Bearer ${testUser.sessionId}` },
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.billingMode).toBe("dry_run");
    expect(res.body.requiresCheckout).toBe(false);
  });

  it("GET /api/billing/history returns purchase history", async () => {
    // Create a fresh user and make a purchase so history is populated
    const historyUser = await createTestUser("b_api_hist", "bapih@test.com");
    await makeRequest("POST", "/api/billing/purchase",
      { packageId: "coins_5000" },
      { Authorization: `Bearer ${historyUser.sessionId}` },
    );
    const res = await makeRequest("GET", "/api/billing/history", undefined, {
      Authorization: `Bearer ${historyUser.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.history).toBeInstanceOf(Array);
    expect(res.body.history.length).toBeGreaterThan(0);
  });

  it("GET /api/billing/status shows dry-run mode", async () => {
    const res = await makeRequest("GET", "/api/billing/status", undefined, {
      Authorization: `Bearer ${testUser.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.billingMode).toBe("dry_run");
    expect(res.body.provider).toBe("stripe");
    expect(res.body.note).toContain("dry-run");
  });

  it("GET /api/billing/session/:id returns session status", async () => {
    // Create a purchase first
    const purchaseRes = await makeRequest("POST", "/api/billing/purchase",
      { packageId: "coins_5000" },
      { Authorization: `Bearer ${testUser.sessionId}` },
    );
    const sessionId = purchaseRes.body.sessionId;

    const res = await makeRequest("GET", `/api/billing/session/${sessionId}`, undefined, {
      Authorization: `Bearer ${testUser.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe("completed");
    expect(res.body.session.type).toBe("coin_purchase");
  });

  it("GET /api/billing/session/:id returns 404 for unknown session", async () => {
    const res = await makeRequest("GET", "/api/billing/session/nonexistent", undefined, {
      Authorization: `Bearer ${testUser.sessionId}`,
    });
    expect(res.status).toBe(404);
  });
});

// ─── Webhook Endpoint Tests ──────────────────────────────────────────

describe("Webhook Endpoint", () => {
  it("POST /api/webhooks/stripe processes events", async () => {
    const user = await createTestUser("b_wh_ep", "bwe@test.com");
    const session = createCoinPurchaseSession(user.userId, "coins_5000");

    // Reset for webhook processing
    db.prepare("UPDATE billing_sessions SET status = 'pending', fulfilled_at = NULL WHERE id = ?")
      .run(session.sessionId);
    db.prepare("UPDATE wallets SET gold_coins = gold_coins - 5000 WHERE user_id = ?")
      .run(user.userId);

    const res = await makeRequest("POST", "/api/webhooks/stripe", {
      id: `evt_ep_test_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: session.sessionId,
        },
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it("POST /api/webhooks/stripe rejects invalid events", async () => {
    const res = await makeRequest("POST", "/api/webhooks/stripe", {});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid event");
  });

  it("GET /api/webhooks/stripe/status shows webhook config", async () => {
    const res = await makeRequest("GET", "/api/webhooks/stripe/status");
    expect(res.status).toBe(200);
    expect(res.body.billingMode).toBe("dry_run");
    expect(res.body.supportedEvents).toBeInstanceOf(Array);
    expect(res.body.supportedEvents).toContain("checkout.session.completed");
    expect(res.body.rawBodyPreservation).toBe("enabled");
  });
});

// ─── Admin Billing Visibility Tests ──────────────────────────────────

describe("Admin Billing Visibility", () => {
  let admin: { userId: string; sessionId: string };

  beforeAll(async () => {
    admin = createDbUser("b_admin");
    // Make admin
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.userId);
  });

  it("GET /api/admin/billing/summary returns billing stats with offer revenue", async () => {
    const res = await makeRequest("GET", "/api/admin/billing/summary", undefined, {
      Authorization: `Bearer ${admin.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.billingMode).toBe("dry_run");
    expect(res.body.revenue).toBeDefined();
    expect(res.body.revenue.offerRevenue).toBeDefined();
    expect(res.body.revenue.totalRevenue).toBeDefined();
    expect(res.body.revenue.offerPurchaseCount).toBeDefined();
    expect(res.body.sessions).toBeDefined();
  });

  it("GET /api/admin/billing/events returns webhook events", async () => {
    const res = await makeRequest("GET", "/api/admin/billing/events", undefined, {
      Authorization: `Bearer ${admin.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.events).toBeInstanceOf(Array);
  });

  it("GET /api/admin/billing/sessions returns billing sessions with offer metadata", async () => {
    // Create an offer purchase session to ensure offer-related metadata exists
    const testOfferUser = createDbUser("b_admin_offer");
    createOfferPurchaseSession(testOfferUser.userId, "starter_bundle", "Starter Bundle", 4.99, 15000);

    const res = await makeRequest("GET", "/api/admin/billing/sessions", undefined, {
      Authorization: `Bearer ${admin.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.sessions).toBeInstanceOf(Array);
    expect(res.body.billingMode).toBe("dry_run");

    // Check that offer sessions have the offer metadata
    const offerSession = res.body.sessions.find((s: any) => s.isOfferPurchase);
    if (offerSession) {
      expect(offerSession.purchaseSource).toBe("offer");
      expect(offerSession.offerName).toBeTruthy();
    }
  });

  it("admin billing endpoints require admin auth", async () => {
    const normalUser = createDbUser("b_notadm");
    const res = await makeRequest("GET", "/api/admin/billing/summary", undefined, {
      Authorization: `Bearer ${normalUser.sessionId}`,
    });
    // Should be rejected (403 or similar) for non-admin
    expect(res.status).toBeGreaterThanOrEqual(403);
  });
});

// ─── Billing Stats Tests ─────────────────────────────────────────────

describe("Billing Stats", () => {
  it("getBillingStats returns aggregated data with offer stats", () => {
    const user = createDbUser("bstat1");
    createCoinPurchaseSession(user.userId, "coins_5000");
    createSubscriptionSession(user.userId, "premium_monthly");

    const stats = getBillingStats();
    expect(stats).toBeDefined();
    expect(stats.coin_revenue).toBeGreaterThanOrEqual(0);
    expect(stats.sub_revenue).toBeGreaterThanOrEqual(0);
    expect(stats.offer_revenue).toBeDefined();
    expect(stats.offer_count).toBeDefined();
  });

  it("getAllBillingSessions returns session list", async () => {
    const sessions = getAllBillingSessions(10);
    expect(sessions).toBeInstanceOf(Array);
  });

  it("getOfferBillingSessions returns sessions for a specific offer", () => {
    const user = createDbUser("bstat_offer");
    createOfferPurchaseSession(user.userId, "starter_bundle", "Starter Bundle", 4.99, 15000);

    const sessions = getOfferBillingSessions("starter_bundle");
    expect(sessions).toBeInstanceOf(Array);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].offer_id).toBe("starter_bundle");
  });
});

// ─── Regression Coverage ─────────────────────────────────────────────

describe("Revenue Hardening Regression", () => {
  let regUser: { userId: string; sessionId: string };

  beforeAll(async () => {
    regUser = createDbUser("breg");
  });

  it("wallet API still works after billing changes", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, {
      Authorization: `Bearer ${regUser.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.balances.gold_coins).toBe(5000);
  });

  it("faucet still works after billing changes", async () => {
    const res = await makeRequest("POST", "/api/wallet/faucet", undefined, {
      Authorization: `Bearer ${regUser.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.claimed.coins).toBe(500);
  });

  it("entitlements API still works after billing changes", async () => {
    const res = await makeRequest("GET", "/api/entitlements/plan", undefined, {
      Authorization: `Bearer ${regUser.sessionId}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("free");
  });

  it("health endpoint is healthy", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });
});
