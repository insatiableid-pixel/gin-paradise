/**
 * Outbox Worker — In-process durable job processor.
 *
 * Runs inside the same Node process, polling the outbox table for
 * pending jobs and dispatching them to registered handlers.
 *
 * Architecture:
 *   - Single worker loop with configurable poll interval
 *   - Handlers are registered per job type
 *   - Failed handlers are retried with exponential backoff (via outbox)
 *   - Poison jobs (max retries exceeded) are marked "dead" — never spin
 *   - Worker is startable/stoppable/diagnosable
 *   - Health and backlog metrics exposed for operator visibility
 *
 * What is proven (in-process):
 *   - Job dispatch, retry, failure, dead-letter behavior
 *   - SQLite-durable across clean restarts
 *
 * What would change in a future multi-process deployment:
 *   - Worker would run in a separate process/container
 *   - Claim semantics would need distributed locking (Redis or pg advisory)
 *   - The handler registry interface would stay identical
 */

import {
  claimNextJob,
  completeJob,
  failJob,
  getOutboxDiagnostics,
  cleanupCompletedJobs,
  type JobType,
  type OutboxJob,
  type OutboxDiagnostics,
} from "./outbox.js";

// ─── Types ──────────────────────────────────────────────────────────

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface WorkerConfig {
  /** Poll interval in ms (default: 2000) */
  pollIntervalMs?: number;
  /** Maximum jobs to process per poll cycle (default: 5) */
  batchSize?: number;
  /** Cleanup completed jobs older than this many hours (default: 24) */
  cleanupAfterHours?: number;
  /** How often to run cleanup, in poll cycles (default: 50) */
  cleanupEveryNCycles?: number;
}

export interface WorkerStatus {
  running: boolean;
  jobsProcessed: number;
  jobsFailed: number;
  lastPollAt: string | null;
  startedAt: string | null;
  pollCycles: number;
  registeredHandlers: string[];
  diagnostics: OutboxDiagnostics;
}

// ─── Handler Registry ───────────────────────────────────────────────

const handlers = new Map<JobType, JobHandler>();

/**
 * Register a handler for a specific job type.
 * Handlers should be idempotent — the outbox guarantees at-least-once delivery.
 */
export function registerJobHandler(jobType: JobType, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

// ─── Worker State ───────────────────────────────────────────────────

let _running = false;
let _pollTimer: ReturnType<typeof setTimeout> | null = null;
let _jobsProcessed = 0;
let _jobsFailed = 0;
let _lastPollAt: string | null = null;
let _startedAt: string | null = null;
let _pollCycles = 0;
let _config: Required<WorkerConfig> = {
  pollIntervalMs: 2000,
  batchSize: 5,
  cleanupAfterHours: 24,
  cleanupEveryNCycles: 50,
};

// ─── Worker Control ─────────────────────────────────────────────────

/**
 * Start the outbox worker loop.
 * Safe to call multiple times — only one loop runs at a time.
 */
export function startWorker(config?: WorkerConfig): void {
  if (_running) {
    console.log("[outbox-worker] Already running — ignoring start request.");
    return;
  }

  _config = {
    pollIntervalMs: config?.pollIntervalMs ?? 2000,
    batchSize: config?.batchSize ?? 5,
    cleanupAfterHours: config?.cleanupAfterHours ?? 24,
    cleanupEveryNCycles: config?.cleanupEveryNCycles ?? 50,
  };

  _running = true;
  _startedAt = new Date().toISOString();
  _jobsProcessed = 0;
  _jobsFailed = 0;
  _pollCycles = 0;

  console.log(`[outbox-worker] Started (poll=${_config.pollIntervalMs}ms, batch=${_config.batchSize}, cleanup=${_config.cleanupAfterHours}h)`);
  schedulePoll();
}

/**
 * Stop the outbox worker loop.
 * In-flight jobs will complete before the worker fully stops.
 */
export function stopWorker(): void {
  if (!_running) return;

  _running = false;
  if (_pollTimer) {
    clearTimeout(_pollTimer);
    _pollTimer = null;
  }
  console.log(`[outbox-worker] Stopped. Processed=${_jobsProcessed}, Failed=${_jobsFailed}, Cycles=${_pollCycles}`);
}

/**
 * Check if the worker is currently running.
 */
export function isWorkerRunning(): boolean {
  return _running;
}

/**
 * Get the current worker status and queue diagnostics.
 */
export function getWorkerStatus(): WorkerStatus {
  return {
    running: _running,
    jobsProcessed: _jobsProcessed,
    jobsFailed: _jobsFailed,
    lastPollAt: _lastPollAt,
    startedAt: _startedAt,
    pollCycles: _pollCycles,
    registeredHandlers: Array.from(handlers.keys()),
    diagnostics: _running ? getOutboxDiagnostics() : {
      pending: 0, processing: 0, completed: 0, failed: 0, dead: 0, total: 0, oldestPending: null,
    },
  };
}

// ─── Poll Loop ──────────────────────────────────────────────────────

function schedulePoll(): void {
  if (!_running) return;
  _pollTimer = setTimeout(async () => {
    try {
      await pollAndProcess();
    } catch (err: any) {
      console.error("[outbox-worker] Poll cycle error:", err?.message || err);
    }
    schedulePoll();
  }, _config.pollIntervalMs);
  _pollTimer.unref(); // Don't block process shutdown
}

async function pollAndProcess(): Promise<void> {
  _pollCycles++;
  _lastPollAt = new Date().toISOString();

  // Process up to batchSize jobs per cycle
  let processed = 0;
  while (processed < _config.batchSize) {
    const job = claimNextJob();
    if (!job) break; // Queue empty

    await processJob(job);
    processed++;
  }

  // Periodic cleanup of old completed jobs
  if (_pollCycles % _config.cleanupEveryNCycles === 0) {
    try {
      const cleaned = cleanupCompletedJobs(_config.cleanupAfterHours);
      if (cleaned > 0) {
        console.log(`[outbox-worker] Cleaned up ${cleaned} completed jobs older than ${_config.cleanupAfterHours}h`);
      }
    } catch (err: any) {
      console.error("[outbox-worker] Cleanup error:", err?.message);
    }
  }
}

async function processJob(job: OutboxJob): Promise<void> {
  const handler = handlers.get(job.job_type);
  if (!handler) {
    failJob(job.id, `No handler registered for job type: ${job.job_type}`);
    _jobsFailed++;
    console.warn(`[outbox-worker] No handler for job type "${job.job_type}" (job ${job.id})`);
    return;
  }

  try {
    const payload = JSON.parse(job.payload);
    await handler(payload);
    completeJob(job.id);
    _jobsProcessed++;
  } catch (err: any) {
    const errorMsg = err?.message || "Unknown handler error";
    failJob(job.id, errorMsg);
    _jobsFailed++;
    console.error(`[outbox-worker] Job ${job.id} (${job.job_type}) failed [attempt ${job.attempts}]: ${errorMsg}`);
  }
}

// ─── Test Utilities ─────────────────────────────────────────────────

export function _resetWorker(): void {
  stopWorker();
  _jobsProcessed = 0;
  _jobsFailed = 0;
  _lastPollAt = null;
  _startedAt = null;
  _pollCycles = 0;
  handlers.clear();
}

/**
 * Process a single pending job synchronously — for testing only.
 * Returns true if a job was processed, false if queue was empty.
 */
export async function _processNextJob(): Promise<boolean> {
  const job = claimNextJob();
  if (!job) return false;
  await processJob(job);
  return true;
}
