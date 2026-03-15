import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
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
 * Simple in-memory sliding-window rate limiter.
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
      if (now > entry.resetAt) store.delete(key);
    }
  }, CLEANUP_INTERVAL).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      store.set(key, entry);
    }

    entry.count++;

    res.setHeader("X-RateLimit-Limit", String(opts.max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, opts.max - entry.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > opts.max) {
      res.status(429).json({
        error: opts.message || "Too many requests, please try again later",
      });
      return;
    }

    next();
  };
}
