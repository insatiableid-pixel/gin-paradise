/**
 * Apex AI API — Sprint 2 Expert tier.
 *
 * POST /api/ai/decide  — draw | discard | knock via ApexMCTS service
 * GET  /api/ai/health  — service availability
 */

import { Router } from "express";
import {
  checkApexAiAvailability,
  requestApexDecision,
  type ApexAiRequest,
} from "../analysis/apexAiBridge.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

// Bound abuse: AI decisions can be CPU-heavy
const aiRateLimit = rateLimit({ windowMs: 10_000, max: 40 });

router.get("/health", async (_req, res) => {
  const ok = await checkApexAiAvailability();
  res.json({
    ok,
    tier: "expert",
    engine: "apex_mcts_sprint2_v1",
    note: ok
      ? "ApexMCTS draw-search service is available"
      : "Service unavailable; product will fall back to Club (TS Apex)",
  });
});

router.post("/decide", aiRateLimit, async (req, res) => {
  const body = (req.body || {}) as ApexAiRequest;
  const action = body.action;

  if (!action || !["draw", "discard", "knock", "health"].includes(action)) {
    res.status(400).json({
      success: false,
      error: "action must be one of: draw, discard, knock, health",
    });
    return;
  }

  if (action !== "health") {
    if (!Array.isArray(body.hand) || body.hand.length < 10) {
      res.status(400).json({
        success: false,
        error: "hand must be an array of at least 10 cards",
      });
      return;
    }
  }

  // Expert tier defaults
  const request: ApexAiRequest = {
    ...body,
    num_worlds: body.num_worlds ?? 30,
    rollout_depth: body.rollout_depth ?? 2,
    use_weighted_worlds: body.use_weighted_worlds ?? true,
  };

  const result = await requestApexDecision(request);

  if (!result.success) {
    res.status(503).json({
      success: false,
      error: result.error || "Apex AI service failed",
      source: result.source,
      elapsedMs: result.elapsedMs,
      fallback: "club",
    });
    return;
  }

  res.json({
    success: true,
    tier: "expert",
    source: result.source,
    elapsedMs: result.elapsedMs,
    decision: result.data,
  });
});

export default router;
