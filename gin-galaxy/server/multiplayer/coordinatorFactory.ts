/**
 * Coordinator Factory.
 *
 * Config-driven selection of the RealtimeCoordinator implementation.
 * At startup, the factory reads COORDINATOR_MODE from environment/config,
 * instantiates the appropriate implementation, and validates it.
 *
 * Supported modes:
 *   "memory"  — MemoryCoordinator (default, zero-infra)
 *   "redis"   — RedisCoordinator (shared-state, requires REDIS_URL)
 *
 * The factory logs which mode is active at startup so operators can
 * confirm the correct coordinator is running.
 */

import type { RealtimeCoordinator } from "./coordinator.js";
import { MemoryCoordinator } from "./memoryCoordinator.js";
import { RedisCoordinator } from "./redisCoordinator.js";

export type CoordinatorMode = "memory" | "redis";

export interface CoordinatorFactoryConfig {
  mode: CoordinatorMode;
  nodeId?: string;
  redis?: {
    url: string;
    keyPrefix: string;
  };
}

/**
 * Parse coordinator configuration from environment variables.
 */
export function loadCoordinatorConfig(): CoordinatorFactoryConfig {
  const mode = (process.env.COORDINATOR_MODE || "memory") as CoordinatorMode;

  if (mode !== "memory" && mode !== "redis") {
    throw new Error(
      `Invalid COORDINATOR_MODE "${mode}". Supported values: "memory", "redis".`
    );
  }

  const config: CoordinatorFactoryConfig = { mode };
  const nodeId = process.env.COORDINATOR_NODE_ID || undefined;
  if (nodeId) {
    config.nodeId = nodeId;
  }

  if (mode === "redis") {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error(
        `COORDINATOR_MODE is "redis" but REDIS_URL is not set. ` +
        `Set REDIS_URL to a valid Redis connection string (e.g. redis://localhost:6379).`
      );
    }
    if (!nodeId) {
      throw new Error(
        `COORDINATOR_MODE is "redis" but COORDINATOR_NODE_ID is not set. ` +
        `Set COORDINATOR_NODE_ID to a stable per-instance value so ownership survives restarts.`
      );
    }
    config.redis = {
      url,
      keyPrefix: process.env.REDIS_KEY_PREFIX || "ginparadise:",
    };
  }

  return config;
}

/**
 * Create a RealtimeCoordinator instance based on the provided config.
 * Logs the active mode and any relevant details.
 */
export function createCoordinator(config: CoordinatorFactoryConfig): RealtimeCoordinator {
  switch (config.mode) {
    case "memory": {
      const coordinator = new MemoryCoordinator(config.nodeId);
      console.log(`  Coordinator:   memory (in-process, single-instance)`);
      console.log(`  Node ID:       ${coordinator.getNodeId()}`);
      return coordinator;
    }

    case "redis": {
      if (!config.redis) {
        throw new Error(`Redis coordinator requires redis config (url, keyPrefix)`);
      }
      const coordinator = new RedisCoordinator({ ...config.redis, nodeId: config.nodeId });
      console.log(`  Coordinator:   redis (shared-state, multi-instance capable)`);
      console.log(`  Redis URL:     ${config.redis.url.replace(/\/\/.*@/, "//***@")}`); // mask credentials
      console.log(`  Key Prefix:    ${config.redis.keyPrefix}`);
      console.log(`  Node ID:       ${coordinator.getNodeId()}`);
      return coordinator;
    }

    default:
      throw new Error(`Unknown coordinator mode: ${config.mode}`);
  }
}

/**
 * Validate that the coordinator is operational after creation.
 * Throws if the coordinator fails its health check.
 */
export function validateCoordinator(coordinator: RealtimeCoordinator): void {
  if (!coordinator.isHealthy()) {
    throw new Error(
      `Coordinator health check failed (mode: ${coordinator.mode}). ` +
      `The server cannot start with an unhealthy coordinator.`
    );
  }

  const diag = coordinator.getDiagnostics();
  console.log(`  Coordinator is healthy (mode: ${diag.mode}, uptime: ${diag.uptimeMs}ms)`);
}

// ── Singleton ────────────────────────────────────────────────────────

let _coordinator: RealtimeCoordinator | null = null;

/**
 * Initialize the global coordinator singleton.
 * Must be called once during server startup.
 */
export async function initCoordinator(config?: CoordinatorFactoryConfig): Promise<RealtimeCoordinator> {
  const effectiveConfig = config || loadCoordinatorConfig();
  _coordinator = createCoordinator(effectiveConfig);
  if (_coordinator.connect) {
    const connected = await _coordinator.connect();
    if (!connected) {
      throw new Error(
        `Coordinator mode "${effectiveConfig.mode}" failed to connect. ` +
        `Redis mode requires a reachable Redis server and does not silently fall back.`
      );
    }
  }
  validateCoordinator(_coordinator);
  return _coordinator;
}

/**
 * Get the global coordinator instance.
 * Throws if initCoordinator() has not been called.
 */
export function getCoordinator(): RealtimeCoordinator {
  if (!_coordinator) {
    throw new Error(
      `Coordinator not initialized. Call initCoordinator() during server startup.`
    );
  }
  return _coordinator;
}

/**
 * Reset the coordinator (for testing only).
 */
export async function _resetCoordinator(): Promise<void> {
  if (_coordinator?.disconnect) {
    await _coordinator.disconnect().catch(() => undefined);
  }
  _coordinator = null;
}
