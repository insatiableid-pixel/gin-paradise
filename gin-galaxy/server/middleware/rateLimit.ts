import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  timestamps: number[];
}

/**
 * Registry of all rate limiter stores for test-time reset capability.
 * Each entry's clear() wipes the sliding-window counters.
 */
const rateLimitStores: Map<string, RateLimitEntry>[] = [];

/**
 * Reset all rate limiter stores. Call this in test setup to prevent
 * cross-test rate limit exhaustion when all requests share one IP.
 */
export function resetAllRateLimiters(): void {
  for (const store of rateLimitStores) {
    store.clear();
  }
}

/**
 * In-memory sliding-window rate limiter for the supported single-process mode.
 * Not suitable for multi-process deployments; use Redis-backed limiter
 * if the app is horizontally scaled in the future.
 */
export function rateLimit(opts: { windowMs: number; max: number; message?: string }) {
  const store = new Map<string, RateLimitEntry>();
  rateLimitStores.push(store);

  // Periodically clean up expired entries to prevent unbounded memory growth
  const CLEANUP_INTERVAL = 60_000;
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.timestamps.every((timestamp) => now - timestamp >= opts.windowMs)) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    const entry = store.get(key) ?? { timestamps: [] };
    entry.timestamps = entry.timestamps.filter(
      (timestamp) => now - timestamp < opts.windowMs,
    );
    entry.timestamps.push(now);
    // Once blocked, only the oldest max+1 samples affect the decision/reset;
    // bounding the array prevents a single abusive client from growing memory.
    if (entry.timestamps.length > opts.max + 1) {
      entry.timestamps.splice(1, entry.timestamps.length - (opts.max + 1));
    }
    store.set(key, entry);
    const resetAt = entry.timestamps[0] + opts.windowMs;

    res.setHeader("X-RateLimit-Limit", String(opts.max));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, opts.max - entry.timestamps.length)),
    );
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    if (entry.timestamps.length > opts.max) {
      res.status(429).json({
        error: opts.message || "Too many requests, please try again later",
      });
      return;
    }

    next();
  };
}
