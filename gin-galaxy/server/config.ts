/**
 * Production Configuration for Gin Paradise.
 *
 * Centralizes all runtime configuration with explicit defaults,
 * environment variable overrides, and startup validation.
 *
 * Environment variables:
 *   PORT              — HTTP server port (default: 3000)
 *   HOST              — Bind address (default: "0.0.0.0")
 *   NODE_ENV          — "production" or "development" (default: "development")
 *   DATABASE_PATH     — Absolute path to SQLite database (default: "./database.sqlite")
 *   TRUST_PROXY       — Enable Express trust proxy for reverse-proxy deployments (default: "false")
 *   GEMINI_API_KEY    — Optional. AI analysis key. Missing = graceful fallback.
 *   SESSION_SECRET    — Optional. Not currently used but reserved for future cookie signing.
 *   ALLOWED_ORIGINS   — Optional. Comma-separated list of allowed CORS origins.
 */

import path from "path";

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "production" | "development";
  databasePath: string;
  trustProxy: boolean | string;
  geminiApiKey: string | undefined;
  allowedOrigins: string[];
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid PORT "${raw}": must be a number between 1 and 65535`);
  }
  return n;
}

function parseTrustProxy(raw: string | undefined): boolean | string {
  if (!raw || raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  // Allow specific proxy values like "loopback", "linklocal", "uniquelocal", or CIDR
  return raw;
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV === "production" ? "production" : "development") as AppConfig["nodeEnv"];
  const port = parsePort(process.env.PORT, 3000);
  const host = process.env.HOST || "0.0.0.0";
  const databasePath = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.resolve(process.cwd(), "database.sqlite");
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  const geminiApiKey = process.env.GEMINI_API_KEY || undefined;
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  return {
    port,
    host,
    nodeEnv,
    databasePath,
    trustProxy,
    geminiApiKey,
    allowedOrigins,
  };
}

/**
 * Validate configuration and log startup summary.
 * Throws on fatal configuration errors.
 */
export function validateAndLogConfig(config: AppConfig): void {
  const issues: string[] = [];

  // Validate database path is writable-looking
  if (!config.databasePath) {
    issues.push("DATABASE_PATH is empty — SQLite database location must be specified");
  }

  if (issues.length > 0) {
    throw new Error(`Configuration errors:\n  - ${issues.join("\n  - ")}`);
  }

  // Log startup summary
  console.log("─── Gin Paradise Configuration ─────────────────────────────");
  console.log(`  Environment:   ${config.nodeEnv}`);
  console.log(`  Port:          ${config.port}`);
  console.log(`  Host:          ${config.host}`);
  console.log(`  Database:      ${config.databasePath}`);
  console.log(`  Trust Proxy:   ${config.trustProxy}`);
  console.log(`  Gemini API:    ${config.geminiApiKey ? "configured ✓" : "not set (analysis will use fallback)"}`);
  if (config.allowedOrigins.length > 0) {
    console.log(`  CORS Origins:  ${config.allowedOrigins.join(", ")}`);
  }
  console.log("────────────────────────────────────────────────────────────");
}
