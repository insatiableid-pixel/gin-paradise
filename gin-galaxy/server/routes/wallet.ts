/**
 * Wallet & Daily Check-in API routes for Gin Paradise.
 *
 * Single non-redeemable coin economy. No sweepstakes.
 *
 * Endpoints:
 *   GET  /api/wallet          — current coin balance
 *   GET  /api/wallet/history  — recent transaction ledger
 *   POST /api/wallet/faucet   — claim daily check-in coins
 */

import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  getBalances,
  getTransactions,
  claimFaucet,
  FAUCET_GOLD_AMOUNT,
  FAUCET_COOLDOWN_MS,
} from "../ledger.js";

const router = Router();

// Rate limit faucet claims (10 per 5 minutes per IP — generous but prevents scripted abuse)
const faucetLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: "Too many check-in requests. Please try again later.",
});

// ─── GET /api/wallet ────────────────────────────────────────────────────

router.get("/", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const balances = getBalances(req.userId!);
  res.json({ balances });
});

// ─── GET /api/wallet/history ────────────────────────────────────────────

router.get("/history", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 20, 1), 100);
  const transactions = getTransactions(req.userId!, limit);
  res.json({ transactions });
});

// ─── POST /api/wallet/faucet ────────────────────────────────────────────

router.post(
  "/faucet",
  faucetLimiter,
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    const result = claimFaucet(req.userId!);

    if (!result.success) {
      res.status(429).json({
        error: result.message,
        nextClaimAt: result.nextClaimAt,
        cooldownMs: FAUCET_COOLDOWN_MS,
      });
      return;
    }

    const balances = getBalances(req.userId!);
    res.json({
      success: true,
      claimed: {
        coins: FAUCET_GOLD_AMOUNT,
      },
      balances,
    });
  }
);

export default router;
