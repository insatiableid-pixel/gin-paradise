/**
 * Durable Outbox / Job Queue — SQLite-backed background job system.
 *
 * Provides a persistent, retry-safe queue for secondary work that should
 * not compete with authoritative synchronous writes on the hot path.
 *
 * Design principles:
 *   - All jobs are persisted to SQLite — survives process restarts.
 *   - Atomic claim semantics — a job is owned exclusively by one worker.
 *   - Failed jobs are retried up to MAX_ATTEMPTS, then marked "dead".
 *   - Idempotency is the handler's responsibility, but dedup_key provides
 *     queue-level duplicate suppression where needed.
 *   - Poison jobs (repeated failures) stop retrying and are diagnosable.
 *   - All operations are synchronous (better-sqlite3) for simplicity.
 *
 * This is NOT a distributed queue. It is a single-node, in-process
 * durable lane for secondary work. That is the right fit for the
 * current SQLite-backed architecture.
 */

import crypto from "crypto";
import { db } from "./db.js";
import Database from "better-sqlite3";

// ─── Configuration ──────────────────────────────────────────────────

/** Maximum retry attempts before a job is marked "dead" */
export const MAX_ATTEMPTS = 5;

/** Delay between retry attempts in ms (exponential backoff base) */
export const RETRY_BASE_DELAY_MS = 5_000;

// ─── Types ──────────────────────────────────────────────────────────

export type JobStatus = "pending" | "processing" | "completed" | "failed" | "dead";

export type JobType =
  | "replay_auto_evaluation"
  | "broadcast_metrics_persist"
  | "coaching_cache_warmup"
  | "achievement_trigger";

export interface OutboxJob {
  id: string;
  job_type: JobType;
  payload: string;        // JSON-serialized
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  dedup_key: string | null;
  created_at: string;
  available_at: string;   // ISO timestamp — job won't be claimed before this
  started_at: string | null;
  completed_at: string | null;
}

export interface OutboxDiagnostics {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dead: number;
  total: number;
  oldestPending: string | null;
}

// ─── Schema ─────────────────────────────────────────────────────────

export function initOutboxTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS outbox_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT ${MAX_ATTEMPTS},
      last_error TEXT,
      dedup_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      available_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_outbox_available ON outbox_jobs(status, available_at);
    CREATE INDEX IF NOT EXISTS idx_outbox_dedup ON outbox_jobs(dedup_key);
    CREATE INDEX IF NOT EXISTS idx_outbox_type ON outbox_jobs(job_type);
    CREATE INDEX IF NOT EXISTS idx_outbox_created ON outbox_jobs(created_at DESC);
  `);
}

// ─── Lazy Prepared Statements ───────────────────────────────────────

interface OutboxStmts {
  enqueue: Database.Statement;
  checkDedup: Database.Statement;
  claimOne: Database.Statement;
  markProcessing: Database.Statement;
  markCompleted: Database.Statement;
  markFailed: Database.Statement;
  markDead: Database.Statement;
  getJob: Database.Statement;
  getPending: Database.Statement;
  getDiagnostics: Database.Statement;
  getOldestPending: Database.Statement;
  getRecentJobs: Database.Statement;
  getFailedJobs: Database.Statement;
  retryJob: Database.Statement;
  cleanupCompleted: Database.Statement;
}

let _stmts: OutboxStmts | null = null;

function stmts(): OutboxStmts {
  if (!_stmts) {
    _stmts = {
      enqueue: db.prepare(`
        INSERT INTO outbox_jobs (id, job_type, payload, status, max_attempts, dedup_key, available_at)
        VALUES (?, ?, ?, 'pending', ?, ?, datetime('now', '+' || ? || ' seconds'))
      `),
      checkDedup: db.prepare(`
        SELECT id, status FROM outbox_jobs WHERE dedup_key = ? AND status NOT IN ('completed', 'dead') LIMIT 1
      `),
      claimOne: db.prepare(`
        SELECT id FROM outbox_jobs
        WHERE status = 'pending'
          AND datetime(available_at) <= datetime('now')
        ORDER BY created_at ASC
        LIMIT 1
      `),
      markProcessing: db.prepare(`
        UPDATE outbox_jobs
        SET status = 'processing', started_at = datetime('now'), attempts = attempts + 1
        WHERE id = ? AND status = 'pending'
      `),
      markCompleted: db.prepare(`
        UPDATE outbox_jobs
        SET status = 'completed', completed_at = datetime('now'), last_error = NULL
        WHERE id = ?
      `),
      markFailed: db.prepare(`
        UPDATE outbox_jobs
        SET status = 'failed', last_error = ?,
            available_at = datetime('now', '+' || (? * ?) || ' seconds')
        WHERE id = ?
      `),
      markDead: db.prepare(`
        UPDATE outbox_jobs
        SET status = 'dead', last_error = ?
        WHERE id = ?
      `),
      getJob: db.prepare(`SELECT * FROM outbox_jobs WHERE id = ?`),
      getPending: db.prepare(`
        SELECT * FROM outbox_jobs
        WHERE status = 'pending' AND datetime(available_at) <= datetime('now')
        ORDER BY created_at ASC
        LIMIT ?
      `),
      getDiagnostics: db.prepare(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS dead,
          COUNT(*) AS total
        FROM outbox_jobs
      `),
      getOldestPending: db.prepare(`
        SELECT created_at FROM outbox_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1
      `),
      getRecentJobs: db.prepare(`
        SELECT * FROM outbox_jobs ORDER BY created_at DESC LIMIT ?
      `),
      getFailedJobs: db.prepare(`
        SELECT * FROM outbox_jobs WHERE status IN ('failed', 'dead') ORDER BY created_at DESC LIMIT ?
      `),
      retryJob: db.prepare(`
        UPDATE outbox_jobs SET status = 'pending', available_at = datetime('now') WHERE id = ? AND status IN ('failed', 'dead')
      `),
      cleanupCompleted: db.prepare(`
        DELETE FROM outbox_jobs WHERE status = 'completed' AND completed_at < datetime('now', '-' || ? || ' hours')
      `),
    };
  }
  return _stmts;
}

// ─── Enqueue ────────────────────────────────────────────────────────

export interface EnqueueOptions {
  jobType: JobType;
  payload: Record<string, unknown>;
  /** Optional dedup key — if a non-terminal job with this key exists, the enqueue is silently skipped */
  dedupKey?: string;
  /** Max retry attempts (default: MAX_ATTEMPTS) */
  maxAttempts?: number;
  /** Delay before the job becomes available, in ms (default: 0) */
  delayMs?: number;
}

/**
 * Enqueue a new job into the durable outbox.
 *
 * @returns The job ID if enqueued, or null if dedup suppressed it.
 */
export function enqueueJob(opts: EnqueueOptions): string | null {
  const s = stmts();

  // Dedup check
  if (opts.dedupKey) {
    const existing = s.checkDedup.get(opts.dedupKey) as { id: string; status: string } | undefined;
    if (existing) {
      return null; // Silently skip — job already exists and is non-terminal
    }
  }

  const id = crypto.randomUUID();
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const delaySeconds = Math.ceil((opts.delayMs ?? 0) / 1000);

  s.enqueue.run(
    id,
    opts.jobType,
    JSON.stringify(opts.payload),
    maxAttempts,
    opts.dedupKey ?? null,
    delaySeconds,
  );

  return id;
}

// ─── Claim ──────────────────────────────────────────────────────────

/**
 * Atomically claim the next available pending job.
 * Returns the job if one was claimed, or null if the queue is empty.
 */
export function claimNextJob(): OutboxJob | null {
  const s = stmts();

  // Use a transaction to atomically find + claim
  const claim = db.transaction(() => {
    const row = s.claimOne.get() as { id: string } | undefined;
    if (!row) return null;

    const result = s.markProcessing.run(row.id);
    if (result.changes === 0) return null; // Race with another claim (shouldn't happen in single-node)

    return s.getJob.get(row.id) as OutboxJob | undefined;
  });

  return claim() ?? null;
}

// ─── Complete / Fail ────────────────────────────────────────────────

/**
 * Mark a claimed job as successfully completed.
 */
export function completeJob(jobId: string): void {
  stmts().markCompleted.run(jobId);
}

/**
 * Mark a claimed job as failed.
 * If it hasn't exceeded max_attempts, it returns to "pending" with backoff.
 * If max_attempts is exceeded, it's marked "dead" (poison job).
 */
export function failJob(jobId: string, error: string): void {
  const s = stmts();
  const job = s.getJob.get(jobId) as OutboxJob | undefined;
  if (!job) return;

  if (job.attempts >= job.max_attempts) {
    // Poison job — exceeded max retries
    s.markDead.run(error, jobId);
  } else {
    // Retry with exponential backoff
    const backoffSeconds = Math.ceil(RETRY_BASE_DELAY_MS / 1000);
    s.markFailed.run(error, job.attempts, backoffSeconds, jobId);
    // After updating to 'failed', immediately set back to pending for re-claim
    db.prepare(`UPDATE outbox_jobs SET status = 'pending' WHERE id = ? AND status = 'failed'`).run(jobId);
  }
}

// ─── Diagnostics ────────────────────────────────────────────────────

/**
 * Get outbox queue diagnostics for health checks and operator visibility.
 */
export function getOutboxDiagnostics(): OutboxDiagnostics {
  const s = stmts();
  const row = s.getDiagnostics.get() as any;
  const oldestRow = s.getOldestPending.get() as { created_at: string } | undefined;

  return {
    pending: row?.pending ?? 0,
    processing: row?.processing ?? 0,
    completed: row?.completed ?? 0,
    failed: row?.failed ?? 0,
    dead: row?.dead ?? 0,
    total: row?.total ?? 0,
    oldestPending: oldestRow?.created_at ?? null,
  };
}

/**
 * Get recent jobs for admin/debug visibility.
 */
export function getRecentJobs(limit: number = 20): OutboxJob[] {
  return stmts().getRecentJobs.all(limit) as OutboxJob[];
}

/**
 * Get failed and dead jobs for debugging.
 */
export function getFailedJobs(limit: number = 20): OutboxJob[] {
  return stmts().getFailedJobs.all(limit) as OutboxJob[];
}

/**
 * Get a specific job by ID.
 */
export function getJob(jobId: string): OutboxJob | null {
  return (stmts().getJob.get(jobId) as OutboxJob) ?? null;
}

/**
 * Manually retry a failed or dead job.
 */
export function retryJob(jobId: string): boolean {
  const result = stmts().retryJob.run(jobId);
  return result.changes > 0;
}

/**
 * Cleanup completed jobs older than the given hours.
 */
export function cleanupCompletedJobs(olderThanHours: number = 24): number {
  const result = stmts().cleanupCompleted.run(olderThanHours);
  return result.changes;
}

// ─── Test Utilities ─────────────────────────────────────────────────

export function _resetOutboxStmts(): void {
  _stmts = null;
}
