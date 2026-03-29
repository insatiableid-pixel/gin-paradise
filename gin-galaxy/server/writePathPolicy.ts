/**
 * Write-Path Policy — Explicit classification of authoritative vs derived writes.
 *
 * This module documents and enforces the system's write-path taxonomy.
 * Every persistent write in Gin Paradise falls into one of two categories:
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  AUTHORITATIVE SYNCHRONOUS WRITES                                  │
 * │  ─────────────────────────────────────────────────────────────────  │
 * │  Must complete atomically within the request/gameplay hot path.    │
 * │  Failure = user-visible error. Never eventually consistent.       │
 * │                                                                    │
 * │  • Wallet / ledger mutations (mutateBalance)                      │
 * │  • Escrow holds and settlement payouts                            │
 * │  • Billing session creation and fulfillment                       │
 * │  • Replay / transcript finalization (persistReplay)               │
 * │  • Match outcome recording and rating updates                     │
 * │  • Tournament advancement and payout-critical state               │
 * │  • User registration and session creation                        │
 * │  • Offer redemption and entitlement grants                       │
 * │  • Daily retention claims (streak, mission, puzzle rewards)       │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  DERIVED ASYNCHRONOUS WRITES                                       │
 * │  ─────────────────────────────────────────────────────────────────  │
 * │  Retryable, eventually-consistent side effects. Routed through    │
 * │  the durable outbox queue. Failure = background retry, not        │
 * │  user-visible error.                                              │
 * │                                                                    │
 * │  • Replay auto-evaluation (Python bridge)                         │
 * │  • Broadcast metrics persistence (spectator stats)                │
 * │  • Coaching cache warmup (Gemini/fallback generation)             │
 * │  • Achievement trigger evaluation                                 │
 * │  • Session expiry purge                                           │
 * │  • Completed job cleanup                                          │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * RULES:
 * 1. Money, entitlement, stake, settlement, and official match outcome
 *    writes remain synchronous and transactional — ALWAYS.
 * 2. Retryable derived work moves behind the durable outbox queue.
 * 3. Background follow-up must never be able to corrupt or double-apply
 *    core product truth. Handlers MUST be idempotent.
 * 4. A failure in the derived lane must never propagate to the hot path.
 */

/**
 * Classification of write operations by their durability requirement.
 * This is a compile-time documentation aid, not runtime enforcement.
 */
export type WritePathClass = "authoritative_sync" | "derived_async";

/**
 * Canonical write-path registry. Maps each system concern to its
 * classification. Used for documentation, testing, and auditing.
 */
export const WRITE_PATH_REGISTRY: Record<string, {
  classification: WritePathClass;
  module: string;
  description: string;
  transactional: boolean;
}> = {
  // ─── Authoritative Synchronous ────────────────────────────────
  "wallet_mutation": {
    classification: "authoritative_sync",
    module: "ledger.ts",
    description: "All balance changes (credits, debits, escrow, payouts)",
    transactional: true,
  },
  "escrow_hold": {
    classification: "authoritative_sync",
    module: "escrow.ts",
    description: "Entry fee deductions for staked matches",
    transactional: true,
  },
  "escrow_settlement": {
    classification: "authoritative_sync",
    module: "escrow.ts",
    description: "Prize payout to winner + rake to house",
    transactional: true,
  },
  "billing_fulfillment": {
    classification: "authoritative_sync",
    module: "billing.ts",
    description: "Coin purchase, subscription, and offer fulfillment",
    transactional: true,
  },
  "replay_persistence": {
    classification: "authoritative_sync",
    module: "db.ts",
    description: "Match transcript finalization to replays table",
    transactional: true,
  },
  "match_outcome": {
    classification: "authoritative_sync",
    module: "routes/matches.ts",
    description: "Rating updates and match result recording",
    transactional: true,
  },
  "tournament_advancement": {
    classification: "authoritative_sync",
    module: "tournament.ts",
    description: "Bracket progression and payout-critical state",
    transactional: true,
  },
  "user_registration": {
    classification: "authoritative_sync",
    module: "routes/auth.ts",
    description: "Account creation with signup bonus",
    transactional: true,
  },
  "offer_redemption": {
    classification: "authoritative_sync",
    module: "offers.ts",
    description: "Offer fulfillment and entitlement grants",
    transactional: true,
  },
  "daily_retention_claims": {
    classification: "authoritative_sync",
    module: "dailyRetention.ts",
    description: "Streak, mission, and puzzle reward grants",
    transactional: true,
  },

  // ─── Derived Asynchronous ─────────────────────────────────────
  "replay_auto_evaluation": {
    classification: "derived_async",
    module: "analysis/pythonBridge.ts",
    description: "Background Python evaluator run on completed replays",
    transactional: false,
  },
  "broadcast_metrics_persist": {
    classification: "derived_async",
    module: "multiplayer/spectator.ts",
    description: "Spectator analytics persistence on match completion",
    transactional: false,
  },
  "coaching_cache_warmup": {
    classification: "derived_async",
    module: "analysis/coachingCache.ts",
    description: "Pre-generate coaching narratives for recent replays",
    transactional: false,
  },
  "achievement_trigger": {
    classification: "derived_async",
    module: "achievements.ts",
    description: "Evaluate and grant achievements asynchronously",
    transactional: false,
  },
};

/**
 * Get all authoritative (synchronous) write paths.
 */
export function getAuthoritativeWritePaths() {
  return Object.entries(WRITE_PATH_REGISTRY)
    .filter(([, v]) => v.classification === "authoritative_sync")
    .map(([k, v]) => ({ key: k, ...v }));
}

/**
 * Get all derived (asynchronous) write paths.
 */
export function getDerivedWritePaths() {
  return Object.entries(WRITE_PATH_REGISTRY)
    .filter(([, v]) => v.classification === "derived_async")
    .map(([k, v]) => ({ key: k, ...v }));
}
