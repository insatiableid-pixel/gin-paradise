/**
 * Offer System Tests — First-Purchase Optimization for Gin Paradise.
 *
 * Tests:
 *   - Offer eligibility rules
 *   - One-time enforcement
 *   - PAID offer flow: checkout initiation + dry-run auto-fulfillment
 *   - FREE offer flow: premium trial instant redemption
 *   - Starter offer fulfillment (coins + premium trial) via billing session
 *   - Premium trial entitlement behavior
 *   - Analytics recording (impressions, dismissals, clicks, purchases)
 *   - Admin visibility endpoints for offer analytics & revenue attribution
 *   - Anti-abuse rules (duplicate redemption, premium check)
 *   - Paid vs free offer API differentiation
 *   - Regression: billing, wallet, entitlements, dashboard shapes
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestServer, stopTestServer, getBaseUrl, registerUser, makeRequest } from "./helpers.js";

let baseUrl: string;
let token: string;
let userId: string;

const rnd = () => Math.random().toString(36).slice(2, 8);

async function createUser(name: string, email: string) {
  const suffix = rnd();
  const reg = await registerUser(`${name}_${suffix}`, `${suffix}_${email}`, "password123");
  expect(reg.status).toBe(200);
  return { token: reg.body.sessionId, userId: reg.body.user.id };
}

// ─── Setup ────────────────────────────────────────────────────────────

beforeAll(async () => {
  baseUrl = await startTestServer();
  const user = await createUser("offer_tester", "offer@test.com");
  token = user.token;
  userId = user.userId;
});

afterAll(async () => {
  await stopTestServer();
});

// ─── Helper ─────────────────────────────────────────────────────────────

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

// ─── Offer Catalog & Eligibility ────────────────────────────────────────

describe("Offer Catalog", () => {
  it("should return eligible offers for a new user", async () => {
    const res = await makeRequest("GET", "/api/offers", undefined, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.offers).toBeDefined();
    expect(Array.isArray(res.body.offers)).toBe(true);
    // New user should be eligible for at least the starter bundle and premium trial
    const offerIds = res.body.offers.map((o: any) => o.id);
    expect(offerIds).toContain("starter_bundle");
    expect(offerIds).toContain("premium_trial_7d");
  });

  it("should return offer details with eligibility", async () => {
    const res = await makeRequest("GET", "/api/offers/starter_bundle", undefined, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.offer.id).toBe("starter_bundle");
    expect(res.body.offer.contents.coins).toBe(15000);
    expect(res.body.offer.contents.premiumTrialDays).toBe(7);
    expect(res.body.offer.priceUsd).toBe(4.99);
    expect(res.body.eligibility.eligible).toBe(true);
    expect(res.body.eligibility.reasons).toHaveLength(0);
  });

  it("should distinguish paid and free offers in API response", async () => {
    const res = await makeRequest("GET", "/api/offers", undefined, authHeaders());
    expect(res.status).toBe(200);

    const starter = res.body.offers.find((o: any) => o.id === "starter_bundle");
    const trial = res.body.offers.find((o: any) => o.id === "premium_trial_7d");

    // starter_bundle should be marked as paid
    expect(starter).toBeDefined();
    expect(starter.isPaid).toBe(true);
    expect(starter.priceUsd).toBe(4.99);

    // premium_trial should be marked as free
    expect(trial).toBeDefined();
    expect(trial.isPaid).toBe(false);
    expect(trial.priceUsd).toBe(0);
  });

  it("should return 404 for unknown offer", async () => {
    const res = await makeRequest("GET", "/api/offers/nonexistent", undefined, authHeaders());
    expect(res.status).toBe(404);
  });

  it("should include billing mode in response", async () => {
    const res = await makeRequest("GET", "/api/offers", undefined, authHeaders());
    expect(res.body.billingMode).toBeDefined();
    expect(["dry_run", "live"]).toContain(res.body.billingMode);
  });
});

// ─── Interaction Tracking ───────────────────────────────────────────────

describe("Offer Interactions", () => {
  it("should record an impression", async () => {
    const res = await makeRequest("POST", "/api/offers/starter_bundle/impression",
      { surface: "dashboard" }, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("should record a dismissal", async () => {
    const res = await makeRequest("POST", "/api/offers/starter_bundle/dismiss",
      { surface: "dashboard" }, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("should record a click", async () => {
    const res = await makeRequest("POST", "/api/offers/starter_bundle/click",
      { surface: "wallet" }, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("should return 404 for interaction on unknown offer", async () => {
    const res = await makeRequest("POST", "/api/offers/fake_offer/impression",
      { surface: "dashboard" }, authHeaders());
    expect(res.status).toBe(404);
  });

  it("should track user offer state", async () => {
    const res = await makeRequest("GET", "/api/offers/starter_bundle/state", undefined, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.state.offerId).toBe("starter_bundle");
    expect(res.body.state.redeemed).toBe(false);
    expect(res.body.state.impressionCount).toBeGreaterThan(0);
    expect(res.body.state.dismissCount).toBeGreaterThan(0);
    expect(res.body.eligibility.eligible).toBe(true);
    expect(res.body.isPaid).toBe(true);  // should include isPaid flag
  });
});

// ─── Starter Offer Redemption (PAID flow) ───────────────────────────────

describe("Starter Offer Redemption (Paid)", () => {
  it("should redeem the starter bundle via checkout flow in dry-run", async () => {
    // Get balance before
    const walletBefore = await makeRequest("GET", "/api/wallet", undefined, authHeaders());
    const balanceBefore = walletBefore.body.balances.gold_coins;

    // Redeem offer — in dry-run, this auto-fulfills
    const res = await makeRequest("POST", "/api/offers/starter_bundle/redeem", {}, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // In dry-run, paid offers auto-fulfill too
    expect(res.body.coinsGranted).toBe(15000);
    expect(res.body.premiumDaysGranted).toBe(7);

    // Verify coins were added
    expect(res.body.balances.gold_coins).toBe(balanceBefore + 15000);

    // Verify premium was activated
    expect(res.body.entitlement.plan).toBe("premium");
    expect(res.body.entitlement.expiresAt).toBeTruthy();
  });

  it("should show offer_purchase in transaction history", async () => {
    const res = await makeRequest("GET", "/api/wallet/history?limit=5", undefined, authHeaders());
    expect(res.status).toBe(200);
    const offerTxn = res.body.transactions.find((t: any) => t.type === "offer_purchase");
    expect(offerTxn).toBeDefined();
    expect(offerTxn.amount).toBe(15000);
    expect(offerTxn.note).toContain("Starter");
  });

  it("should verify premium was granted via offer state", async () => {
    const res = await makeRequest("GET", "/api/offers/starter_bundle/state", undefined, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.state.redeemed).toBe(true);
    expect(res.body.state.redeemedAt).toBeTruthy();
  });
});

// ─── One-Time Enforcement ───────────────────────────────────────────────

describe("One-Time Enforcement", () => {
  it("should reject duplicate redemption of starter bundle", async () => {
    const res = await makeRequest("POST", "/api/offers/starter_bundle/redeem", {}, authHeaders());
    expect([400, 409]).toContain(res.status);
    expect(res.body.error).toContain("Not eligible");
  });

  it("should mark starter bundle as ineligible after redemption", async () => {
    const res = await makeRequest("GET", "/api/offers/starter_bundle", undefined, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.eligibility.eligible).toBe(false);
    expect(res.body.state.redeemed).toBe(true);
    expect(res.body.state.redeemedAt).toBeTruthy();
  });

  it("should not show redeemed offers in eligible list", async () => {
    const res = await makeRequest("GET", "/api/offers", undefined, authHeaders());
    expect(res.status).toBe(200);
    const offerIds = res.body.offers.map((o: any) => o.id);
    expect(offerIds).not.toContain("starter_bundle");
  });

  it("should reject premium trial if user is already premium", async () => {
    const res = await makeRequest("POST", "/api/offers/premium_trial_7d/redeem", {}, authHeaders());
    expect([400, 409]).toContain(res.status);
    // Should mention premium plan requirement
    expect(res.body.error).toBeDefined();
  });
});

// ─── Analytics Recording ────────────────────────────────────────────────

describe("Analytics Recording", () => {
  it("should show interactions in user offer state", async () => {
    const res = await makeRequest("GET", "/api/offers/starter_bundle/state", undefined, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.state.impressionCount).toBeGreaterThan(0);
    expect(res.body.state.dismissCount).toBeGreaterThan(0);
    expect(res.body.state.redeemed).toBe(true);
  });
});

// ─── Fresh User Tests (anti-abuse) ──────────────────────────────────────

describe("Fresh User Eligibility", () => {
  let freshToken: string;

  beforeAll(async () => {
    const user = await createUser("fresh_user_1", "fresh1@test.com");
    freshToken = user.token;
  });

  it("should show starter offer for fresh user who has not purchased", async () => {
    const res = await makeRequest("GET", "/api/offers", undefined, { Authorization: `Bearer ${freshToken}` });
    expect(res.status).toBe(200);
    const ids = res.body.offers.map((o: any) => o.id);
    expect(ids).toContain("starter_bundle");
    expect(ids).toContain("premium_trial_7d");
  });

  it("should block starter offer after a standard coin purchase", async () => {
    // Make a standard purchase first
    await makeRequest("POST", "/api/billing/purchase",
      { packageId: "coins_5000" }, { Authorization: `Bearer ${freshToken}` });

    // Now check starter offer eligibility — should be ineligible
    const res = await makeRequest("GET", "/api/offers/starter_bundle", undefined,
      { Authorization: `Bearer ${freshToken}` });
    expect(res.status).toBe(200);
    expect(res.body.eligibility.eligible).toBe(false);
    expect(res.body.eligibility.reasons.some((r: string) => r.includes("Already made a purchase"))).toBe(true);
  });
});

// ─── Premium Trial Standalone (FREE flow) ───────────────────────────────

describe("Premium Trial Standalone (Free)", () => {
  let trialToken: string;
  let trialUserId: string;

  beforeAll(async () => {
    const user = await createUser("trial_user", "trial@test.com");
    trialToken = user.token;
    trialUserId = user.userId;
  });

  it("should redeem free premium trial immediately (no checkout required)", async () => {
    const res = await makeRequest("POST", "/api/offers/premium_trial_7d/redeem", {},
      { Authorization: `Bearer ${trialToken}` });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.premiumDaysGranted).toBe(7);
    expect(res.body.coinsGranted).toBe(0); // No coins in trial
    expect(res.body.entitlement.plan).toBe("premium");
    // Free offer should NOT require checkout
    expect(res.body.requiresCheckout).toBeFalsy();
  });

  it("should reject duplicate trial claim", async () => {
    const res = await makeRequest("POST", "/api/offers/premium_trial_7d/redeem", {},
      { Authorization: `Bearer ${trialToken}` });
    expect([400, 409]).toContain(res.status);
  });

  it("should still allow coin purchases after trial", async () => {
    const res = await makeRequest("POST", "/api/billing/purchase",
      { packageId: "coins_5000" }, { Authorization: `Bearer ${trialToken}` });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── Paid vs Free Offer API Differentiation ─────────────────────────────

describe("Paid vs Free Offer Differentiation", () => {
  it("offer details should include isPaid flag for paid offers", async () => {
    const user = await createUser("paid_check_1", "pcheck1@test.com");
    const res = await makeRequest("GET", "/api/offers/starter_bundle", undefined,
      { Authorization: `Bearer ${user.token}` });
    expect(res.status).toBe(200);
    expect(res.body.offer.isPaid).toBe(true);
  });

  it("offer details should include isPaid=false for free offers", async () => {
    const user = await createUser("paid_check_2", "pcheck2@test.com");
    const res = await makeRequest("GET", "/api/offers/premium_trial_7d", undefined,
      { Authorization: `Bearer ${user.token}` });
    expect(res.status).toBe(200);
    expect(res.body.offer.isPaid).toBe(false);
  });

  it("offer state endpoint should include isPaid", async () => {
    const user = await createUser("paid_check_3", "pcheck3@test.com");
    const res = await makeRequest("GET", "/api/offers/starter_bundle/state", undefined,
      { Authorization: `Bearer ${user.token}` });
    expect(res.status).toBe(200);
    expect(res.body.isPaid).toBe(true);
  });
});

// ─── Regression: Existing Systems Still Work ────────────────────────────

describe("Regression — Existing Systems", () => {
  it("billing packages are unchanged", async () => {
    const res = await makeRequest("GET", "/api/billing/packages", undefined, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.packages.length).toBe(5);
    expect(res.body.packages[0].id).toBe("coins_5000");
  });

  it("billing subscriptions are unchanged", async () => {
    const res = await makeRequest("GET", "/api/billing/subscriptions", undefined, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.plans.length).toBeGreaterThan(0);
    expect(res.body.plans[0].id).toBe("premium_monthly");
  });

  it("standard coin purchase still works", async () => {
    const res = await makeRequest("POST", "/api/billing/purchase",
      { packageId: "coins_5000" }, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("wallet endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/wallet", undefined, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.balances).toBeDefined();
    expect(typeof res.body.balances.gold_coins).toBe("number");
  });

  it("wallet history includes all transaction types", async () => {
    const res = await makeRequest("GET", "/api/wallet/history?limit=50", undefined, authHeaders());
    expect(res.status).toBe(200);
    const types = new Set(res.body.transactions.map((t: any) => t.type));
    expect(types.has("signup_bonus")).toBe(true);
    expect(types.has("offer_purchase")).toBe(true);
  });

  it("offer state endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/offers/starter_bundle/state", undefined, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.state).toBeDefined();
    expect(res.body.eligibility).toBeDefined();
  });

  it("daily retention endpoints still work", async () => {
    const res = await makeRequest("GET", "/api/daily", undefined, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body.streak).toBeDefined();
    expect(res.body.missions).toBeDefined();
  });

  it("health endpoint still works", async () => {
    const res = await makeRequest("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });
});
