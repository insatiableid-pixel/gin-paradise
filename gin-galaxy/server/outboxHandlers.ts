/**
 * Outbox Job Handlers — Implementations for derived async work.
 *
 * Each handler is idempotent and self-contained.
 * Registration happens at server startup via registerAllHandlers().
 */

import { registerJobHandler } from "./outboxWorker.js";
import { triggerAutoEvaluation, getCachedEvaluation } from "./analysis/pythonBridge.js";
import { persistBroadcastMetrics, type FeaturedReason } from "./multiplayer/spectator.js";
import { triggerLiveAchievements } from "./achievements.js";

/**
 * Register all outbox job handlers.
 * Call this once at server startup, after all tables are initialized.
 */
export function registerAllHandlers(): void {
  // ─── Replay Auto-Evaluation ─────────────────────────────────────
  registerJobHandler("replay_auto_evaluation", async (payload) => {
    const replayId = payload.replayId as string;
    if (!replayId) throw new Error("Missing replayId in payload");

    // Idempotency: skip if already cached
    const cached = getCachedEvaluation(replayId);
    if (cached && !cached.error) return;

    // Delegate to the existing evaluation trigger (handles load + spawn)
    triggerAutoEvaluation(replayId);
  });

  // ─── Broadcast Metrics Persistence ──────────────────────────────
  registerJobHandler("broadcast_metrics_persist", async (payload) => {
    const {
      roomId, player1Id, player1Username,
      player2Id, player2Username,
      winnerId, winnerUsername,
      stakeId, reasons, startedAt,
    } = payload as {
      roomId: string;
      player1Id: string; player1Username: string;
      player2Id: string; player2Username: string;
      winnerId: string | null; winnerUsername: string | null;
      stakeId: string;
      reasons: FeaturedReason[];
      startedAt: number;
    };

    if (!roomId) throw new Error("Missing roomId in payload");

    // persistBroadcastMetrics is already idempotent (insert only, keyed by UUID)
    persistBroadcastMetrics(
      roomId,
      player1Id, player1Username,
      player2Id, player2Username,
      winnerId, winnerUsername,
      stakeId,
      reasons,
      startedAt,
    );
  });

  // ─── Achievement Trigger ────────────────────────────────────────
  registerJobHandler("achievement_trigger", async (payload) => {
    const userId = payload.userId as string;
    const trigger = payload.trigger as string;
    if (!userId || !trigger) throw new Error("Missing userId or trigger in payload");

    // triggerLiveAchievements is idempotent (checks grant state)
    triggerLiveAchievements(userId, trigger);
  });

  // ─── Coaching Cache Warmup ──────────────────────────────────────
  registerJobHandler("coaching_cache_warmup", async (payload) => {
    // Future: pre-warm coaching cache for recently evaluated replays
    // For now this is a placeholder that validates the handler registration
    const replayId = payload.replayId as string;
    const userId = payload.userId as string;
    if (!replayId || !userId) throw new Error("Missing replayId or userId in payload");

    // The coaching system is cache-first, so this is a no-op if already cached
    // Full implementation would call getOrGenerateCoaching but that requires
    // loading the full replay data — left for coaching-specific sprint
    console.log(`[outbox-handler] Coaching warmup acknowledged for replay ${replayId}`);
  });

  console.log("[outbox-handlers] All job handlers registered: replay_auto_evaluation, broadcast_metrics_persist, achievement_trigger, coaching_cache_warmup");
}
