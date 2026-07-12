import "dotenv/config";
import express from "express";
import http from "http";
import { createServer as createViteServer } from "vite";
import path from "path";

import { loadConfig, validateAndLogConfig, getLiveRoomRoutingMode } from "./server/config.js";
import { initializeDatabase, purgeExpiredSessions, db } from "./server/db.js";
import { reconcileWalletLedger } from "./server/ledger.js";
import authRoutes from "./server/routes/auth.js";
import matchRoutes, { statsRouter } from "./server/routes/matches.js";
import leaderboardRoutes from "./server/routes/leaderboard.js";
import analysisRoutes from "./server/routes/analysis.js";
import replayRoutes from "./server/routes/replays.js";
import replayAnalysisRoutes from "./server/routes/replayAnalysis.js";
import replayEvaluationRoutes from "./server/routes/replayEvaluation.js";
import walletRoutes from "./server/routes/wallet.js";
import adminRoutes from "./server/routes/admin.js";
import tournamentRoutes from "./server/routes/tournament.js";
import trainingRoutes from "./server/routes/training.js";
import fairnessRoutes, { fairnessVerifyRouter } from "./server/routes/fairness.js";
import profileRoutes from "./server/routes/profile.js";
import cosmeticsRoutes from "./server/routes/cosmetics.js";
import entitlementRoutes from "./server/routes/entitlements.js";
import seasonRoutes from "./server/routes/seasons.js";
import socialRoutes from "./server/routes/social.js";
import spectatorRoutes from "./server/routes/spectator.js";
import billingRoutes from "./server/routes/billing.js";
import webhookRoutes from "./server/routes/webhooks.js";
import dailyRetentionRoutes from "./server/routes/dailyRetention.js";
import offerRoutes from "./server/routes/offers.js";
import apexAiRoutes from "./server/routes/apexAi.js";
import {
  attachWebSocketServer,
  prepareRoomsForShutdown,
} from "./server/multiplayer/roomManager.js";
import { initCoordinator, getCoordinator } from "./server/multiplayer/coordinatorFactory.js";
import { loadTournamentsFromDB } from "./server/tournament.js";
import { initializeAchievementTables } from "./server/achievements.js";
import { initializeCosmeticTables } from "./server/cosmetics.js";
import { initializeEntitlementTables } from "./server/entitlements.js";
import { initializeSeasonTables } from "./server/seasons.js";
import { initializeSocialTables } from "./server/social.js";
import { initBillingTables } from "./server/billing.js";
import { initializeDailyRetentionTables } from "./server/dailyRetention.js";
import { initOfferTables } from "./server/offers.js";
import { initOutboxTable } from "./server/outbox.js";
import { startWorker, stopWorker, getWorkerStatus } from "./server/outboxWorker.js";
import { registerAllHandlers } from "./server/outboxHandlers.js";
import { logger } from "./server/logger.js";
import {
  apiNotFoundHandler,
  errorHandler,
  metricsHandler,
  requestContextMiddleware,
} from "./server/observability.js";

// ─── Load and validate config ────────────────────────────────────────
const config = loadConfig();
validateAndLogConfig(config);

// ─── Initialize realtime coordinator ────────────────────────────────
await initCoordinator({
  mode: config.coordinatorMode,
  nodeId: config.coordinatorNodeId,
  redis:
    config.coordinatorMode === "redis" && config.redisUrl
      ? { url: config.redisUrl, keyPrefix: config.redisKeyPrefix }
      : undefined,
});

// ─── Initialize database ────────────────────────────────────────────
initializeDatabase();
const ledgerDiscrepancies = reconcileWalletLedger();
if (ledgerDiscrepancies.length > 0) {
  console.error(`[ledger] Wallet reconciliation found ${ledgerDiscrepancies.length} discrepancy(ies).`);
}
initializeAchievementTables();
initializeCosmeticTables();
initializeEntitlementTables();
initializeSeasonTables();
initializeSocialTables();
initBillingTables();
initializeDailyRetentionTables();
initOfferTables();
initOutboxTable();
loadTournamentsFromDB();

// ─── Register outbox job handlers and start worker ──────────────────
registerAllHandlers();
startWorker({ pollIntervalMs: 2000, batchSize: 5, cleanupAfterHours: 24 });

// Purge expired sessions on startup and every hour
purgeExpiredSessions();
const sessionPurgeInterval = setInterval(purgeExpiredSessions, 60 * 60 * 1000);
sessionPurgeInterval.unref();

async function startServer() {
  const app = express();

  // ─── Proxy trust ──────────────────────────────────────────────────
  // Required for correct req.ip and rate limiting behind reverse proxies.
  // Set TRUST_PROXY=true for platform hosts (Render, Railway, Fly, etc.)
  // or TRUST_PROXY=loopback for local nginx.
  if (config.trustProxy) {
    app.set("trust proxy", config.trustProxy);
    logger.info("server.trust_proxy_enabled", { trustProxy: config.trustProxy });
  }

  // Raw body preservation for Stripe webhook signature verification.
  // This must come BEFORE express.json() so the raw bytes are captured first.
  // The rawBody is attached to the request object for use by the webhook handler.
  app.use(
    "/api/webhooks",
    express.raw({ type: "application/json" }),
    (req: any, _res: any, next: any) => {
      if (Buffer.isBuffer(req.body)) {
        req.rawBody = req.body;
      }
      next();
    },
  );

  app.use(express.json());
  app.use(requestContextMiddleware);

  // ─── Health endpoint (unauthenticated) ────────────────────────────
  app.get("/api/health", (_req, res) => {
    try {
      // Quick SQLite connectivity check
      const row = db.prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
      const dbOk = row?.ok === 1;

      // Coordinator health (graceful if not initialized, e.g. in test helpers)
      let coordInfo: any = { mode: "unknown", healthy: false };
      try {
        const coord = getCoordinator();
        const diag = coord.getDiagnostics();
        coordInfo = {
          mode: diag.mode,
          healthy: diag.healthy,
          nodeId: diag.nodeId,
          rooms: diag.roomCount,
          players: diag.playerMappingCount,
          spectators: diag.spectatorConnectionCount,
          snapshots: (diag.details as any)?.roomGameSnapshotCount ?? 0,
        };
      } catch {
        /* coordinator not initialized — skip */
      }

      // Outbox worker status (graceful if not started, e.g. in test envs)
      let workerInfo: any = { running: false };
      try {
        workerInfo = getWorkerStatus();
      } catch {
        /* worker not initialized — skip */
      }

      res.json({
        status: dbOk ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        version: "1.0.0-beta",
        database: dbOk ? "connected" : "unreachable",
        databaseHardening: {
          walMode: true,
          busyTimeout: 5000,
          foreignKeys: true,
        },
        deployment: {
          coordinatorMode: config.coordinatorMode,
          liveRoomRouting: getLiveRoomRoutingMode(config.coordinatorMode),
        },
        coordinator: coordInfo,
        outboxWorker: workerInfo,
        environment: config.nodeEnv,
      });
    } catch (_err) {
      res.status(503).json({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        version: "1.0.0-beta",
        database: "error",
        environment: config.nodeEnv,
      });
    }
  });
  app.get("/api/metrics", metricsHandler);

  // ─── API Routes ──────────────────────────────────────────────────
  app.use("/api/auth", authRoutes);
  app.use("/api/matches", matchRoutes);
  app.use("/api/stats", statsRouter);
  app.use("/api/leaderboard", leaderboardRoutes);
  app.use("/api/analysis", analysisRoutes);
  app.use("/api/replays", replayRoutes);
  app.use("/api/replays", replayAnalysisRoutes);
  app.use("/api/replays", replayEvaluationRoutes);
  app.use("/api/wallet", walletRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/tournaments", tournamentRoutes);
  app.use("/api/training", trainingRoutes);
  app.use("/api/profile", profileRoutes);
  app.use("/api/cosmetics", cosmeticsRoutes);
  app.use("/api/entitlements", entitlementRoutes);
  app.use("/api/seasons", seasonRoutes);
  app.use("/api/social", socialRoutes);
  app.use("/api/spectator", spectatorRoutes);
  app.use("/api/billing", billingRoutes);
  app.use("/api/webhooks", webhookRoutes);
  app.use("/api/daily", dailyRetentionRoutes);
  app.use("/api/offers", offerRoutes);
  app.use("/api/ai", apexAiRoutes);
  app.use("/api/replays", fairnessRoutes);
  app.use("/api/fairness", fairnessVerifyRouter);
  app.use("/api", apiNotFoundHandler);

  // Create the raw HTTP server so WebSocket upgrades are registered
  // BEFORE Vite's HMR handler can intercept them.
  const httpServer = http.createServer(app);

  // ─── WebSocket Multiplayer Server ────────────────────────────────
  // Attach BEFORE Vite middleware so our /ws upgrade handler wins.
  const wss = attachWebSocketServer(httpServer);

  // ─── Vite / Static Serving ───────────────────────────────────────
  if (config.nodeEnv !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(import.meta.dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(import.meta.dirname, "dist", "index.html"));
    });
  }

  // Error middleware must be last so it also handles Vite/static failures.
  app.use(errorHandler);

  httpServer.listen(config.port, config.host, () => {
    const host = config.host === "0.0.0.0" ? "localhost" : config.host;
    logger.info("server.started", {
      url: `http://${host}:${config.port}`,
      websocketUrl: `ws://${host}:${config.port}/ws`,
      healthUrl: `http://${host}:${config.port}/api/health`,
      metricsUrl: `http://${host}:${config.port}/api/metrics`,
      liveRoomRouting: getLiveRoomRoutingMode(config.coordinatorMode),
      nodeEnv: config.nodeEnv,
    });
  });

  // ─── Graceful Shutdown ────────────────────────────────────────────
  let isShuttingDown = false;

  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info("server.shutdown_started", { signal });

    // Release live-room ownership metadata before close handlers run so
    // recoverable rooms stay in Redis instead of being torn down as empty.
    try {
      prepareRoomsForShutdown();
      logger.info("server.live_room_ownership_released");
    } catch (err) {
      logger.warn("server.live_room_shutdown_prepare_failed", { error: err });
    }

    // Stop accepting new connections
    httpServer.close(() => {
      logger.info("server.http_closed");
    });

    // Close WebSocket connections
    if (wss) {
      for (const client of wss.clients) {
        try {
          client.close(1001, "Server shutting down");
        } catch {}
      }
      wss.close(() => {
        logger.info("server.websocket_closed");
      });
    }

    // Stop outbox worker
    try {
      stopWorker();
      logger.info("server.outbox_worker_stopped");
    } catch (err) {
      logger.warn("server.outbox_worker_stop_failed", { error: err });
    }

    // Give the coordinator a moment to flush the fire-and-forget lease
    // release writes before we disconnect the Redis client.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Release coordinator resources
    try {
      const coord = getCoordinator();
      await coord.disconnect?.();
      logger.info("server.coordinator_disconnected");
    } catch (err) {
      logger.warn("server.coordinator_disconnect_failed", { error: err });
    }

    // Clear recurring intervals
    clearInterval(sessionPurgeInterval);

    // Close database connection
    try {
      db.close();
      logger.info("server.database_closed");
    } catch (err) {
      logger.warn("server.database_close_failed", { error: err });
    }

    // Allow a brief drain period, then force exit
    setTimeout(() => {
      logger.info("server.shutdown_complete");
      process.exit(0);
    }, 2000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((err) => {
  logger.error("server.start_failed", { error: err });
  process.exit(1);
});
