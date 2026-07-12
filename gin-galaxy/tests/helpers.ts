/**
 * Test helper that spins up an Express app with the real routes
 * against the actual SQLite database for integration testing.
 */
import express, { type Express } from "express";
import type http from "http";

import { initializeDatabase, db } from "../server/db.js";
import authRoutes from "../server/routes/auth.js";
import matchRoutes, { statsRouter } from "../server/routes/matches.js";
import leaderboardRoutes from "../server/routes/leaderboard.js";
import analysisRoutes from "../server/routes/analysis.js";
import replayRoutes from "../server/routes/replays.js";
import replayAnalysisRoutes from "../server/routes/replayAnalysis.js";
import replayEvaluationRoutes from "../server/routes/replayEvaluation.js";
import walletRoutes from "../server/routes/wallet.js";
import adminRoutes from "../server/routes/admin.js";
import tournamentRoutes from "../server/routes/tournament.js";
import trainingRoutes from "../server/routes/training.js";
import fairnessRoutes, { fairnessVerifyRouter } from "../server/routes/fairness.js";
import profileRoutes from "../server/routes/profile.js";
import cosmeticsRoutes from "../server/routes/cosmetics.js";
import entitlementRoutes from "../server/routes/entitlements.js";
import seasonRoutes from "../server/routes/seasons.js";
import socialRoutes from "../server/routes/social.js";
import spectatorRoutes from "../server/routes/spectator.js";
import billingRoutes from "../server/routes/billing.js";
import webhookRoutes from "../server/routes/webhooks.js";
import dailyRetentionRoutes from "../server/routes/dailyRetention.js";
import offerRoutes from "../server/routes/offers.js";
import { initializeAchievementTables } from "../server/achievements.js";
import { initializeCosmeticTables } from "../server/cosmetics.js";
import { initializeEntitlementTables } from "../server/entitlements.js";
import { initializeSeasonTables } from "../server/seasons.js";
import { initializeSocialTables } from "../server/social.js";
import { initBillingTables } from "../server/billing.js";
import { initializeDailyRetentionTables } from "../server/dailyRetention.js";
import { initOfferTables } from "../server/offers.js";
import { resetAllRateLimiters } from "../server/middleware/rateLimit.js";
import { initCoordinator, _resetCoordinator } from "../server/multiplayer/coordinatorFactory.js";
import { getCoordinator } from "../server/multiplayer/coordinatorFactory.js";
import { getLiveRoomRoutingMode } from "../server/config.js";
import { initOutboxTable } from "../server/outbox.js";
import { registerAllHandlers } from "../server/outboxHandlers.js";

let server: http.Server;
let baseUrl: string;

export function createApp(): Express {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());

  // Health endpoint (mirrors production server.ts)
  app.get("/api/health", (_req, res) => {
    try {
      const row = db.prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
      const dbOk = row?.ok === 1;
      let coordInfo: {
        mode: "memory" | "redis" | "unknown";
        healthy: boolean;
        nodeId?: string;
        rooms?: number;
        players?: number;
        spectators?: number;
        snapshots?: number;
      } = {
        mode: "unknown",
        healthy: false,
      };
      let deployment: {
        coordinatorMode: "memory" | "redis" | "unknown";
        liveRoomRouting: "single_node" | "multi_node_relay";
      } = {
        coordinatorMode: "unknown",
        liveRoomRouting: "single_node",
      };

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
        deployment = {
          coordinatorMode: diag.mode,
          liveRoomRouting: getLiveRoomRoutingMode(diag.mode),
        };
      } catch {
        // Coordinator is not available in some minimal test setups.
      }

      res.json({
        status: dbOk ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        version: "1.0.0-beta",
        database: dbOk ? "connected" : "unreachable",
        coordinator: coordInfo,
        deployment,
        environment: "test",
      });
    } catch {
      res.status(503).json({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        version: "1.0.0-beta",
        database: "error",
        environment: "test",
      });
    }
  });

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
  app.use("/api/replays", fairnessRoutes);
  app.use("/api/fairness", fairnessVerifyRouter);
  return app;
}

export async function startTestServer(): Promise<string> {
  await _resetCoordinator();
  await initCoordinator({ mode: "memory" });
  initializeDatabase();
  initializeAchievementTables();
  initializeCosmeticTables();
  initializeEntitlementTables();
  initializeSeasonTables();
  initializeSocialTables();
  initBillingTables();
  initializeDailyRetentionTables();
  initOfferTables();
  initOutboxTable();
  resetAllRateLimiters();
  registerAllHandlers();
  const app = createApp();
  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve(baseUrl);
    });
  });
}

export async function stopTestServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}

export function getBaseUrl(): string {
  return baseUrl;
}

/** Register a user and return the parsed response */
export async function registerUser(
  username = "testuser",
  email = "test@test.com",
  password = "password123",
) {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/** Login a user and return the parsed response */
export async function loginUser(username = "testuser", password = "password123") {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/** Generic request helper */
export async function makeRequest(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: any,
  headers?: Record<string, string>,
) {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, body: await res.json(), headers: res.headers };
}
