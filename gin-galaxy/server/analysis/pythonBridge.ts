/**
 * Python Evaluation Bridge.
 *
 * Spawns the gin_rummy.evaluator Python module as a subprocess,
 * passes replay transcript data via stdin, and collects structured
 * evaluation JSON from stdout.
 *
 * Features:
 *   - Configurable timeout (default 30s) with kill
 *   - Graceful degradation when Python is unavailable
 *   - SQLite caching of evaluation results
 *   - Bounded execution: one evaluation at a time per replay
 */

import { spawn } from "child_process";
import path from "path";
import { db } from "../db.js";
import type { ReplayData } from "./transcriptAdapter.js";
import { triggerLiveAchievements } from "../achievements.js";

// In-flight evaluation tracking to prevent duplicate concurrent work
const inFlightEvaluations = new Set<string>();

// ── Configuration ────────────────────────────────────────────────────

/** Max time in ms to wait for the Python evaluator */
const EVALUATION_TIMEOUT_MS = parseInt(process.env.EVAL_TIMEOUT_MS || "30000", 10);

/** Python executable path (override with PYTHON_PATH env) */
const PYTHON_PATH = process.env.PYTHON_PATH || "python";

/** Path to the gin_rummy package root (one level above gin-galaxy) */
const ENGINE_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

// ── Schema Migration ─────────────────────────────────────────────────

export function ensureEvaluationTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS replay_evaluations (
      replay_id TEXT PRIMARY KEY,
      evaluation_json TEXT NOT NULL,
      engine_version TEXT NOT NULL DEFAULT 'apex_v2',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ── Cache Operations ─────────────────────────────────────────────────

export function getCachedEvaluation(replayId: string): any | null {
  ensureEvaluationTable();
  const row = db.prepare(
    "SELECT evaluation_json FROM replay_evaluations WHERE replay_id = ?"
  ).get(replayId) as { evaluation_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.evaluation_json);
  } catch {
    return null;
  }
}

export function cacheEvaluation(replayId: string, evaluation: any): void {
  ensureEvaluationTable();
  db.prepare(`
    INSERT OR REPLACE INTO replay_evaluations (replay_id, evaluation_json, engine_version)
    VALUES (?, ?, 'apex_v2')
  `).run(replayId, JSON.stringify(evaluation));
}

// ── Python Invocation ────────────────────────────────────────────────

export interface EvaluationResult {
  success: boolean;
  evaluation?: any;
  error?: string;
  source: "cache" | "engine" | "error";
}

/**
 * Run the Python evaluator on a replay transcript.
 *
 * 1. Check cache first
 * 2. Spawn Python subprocess
 * 3. Send transcript via stdin
 * 4. Collect evaluation from stdout
 * 5. Cache result on success
 */
export async function evaluateReplay(
  replay: ReplayData,
  requestingPlayerId: string,
): Promise<EvaluationResult> {
  // 1. Check cache
  const cached = getCachedEvaluation(replay.id);
  if (cached && !cached.error) {
    return { success: true, evaluation: cached, source: "cache" };
  }

  // 1b. Check if already in-flight
  if (inFlightEvaluations.has(replay.id)) {
    return { success: false, error: "Evaluation already in progress", source: "error" };
  }

  inFlightEvaluations.add(replay.id);

  // 2. Build input payload
  const payload = {
    actions: replay.actions,
    players: replay.players,
    requestingPlayerId,
    outcome: replay.outcome,
  };

  // 3. Spawn Python evaluator
  try {
    const result = await runPythonEvaluator(JSON.stringify(payload));

    if (result.error) {
      return {
        success: false,
        error: result.error,
        source: "error",
      };
    }

    // 4. Parse and cache
    const evaluation = result.data;
    if (evaluation && !evaluation.error) {
      cacheEvaluation(replay.id, evaluation);

      // Trigger live achievements for both players after evaluation (training achievements)
      for (const player of replay.players) {
        try {
          triggerLiveAchievements(player.userId, "evaluation_completion");
        } catch (err) {
          console.error(`[python-bridge] Achievement trigger failed for ${player.userId}:`, err);
        }
      }
    }

    return {
      success: !evaluation?.error,
      evaluation,
      error: evaluation?.error ? evaluation.message : undefined,
      source: "engine",
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Python evaluator failed",
      source: "error",
    };
  } finally {
    inFlightEvaluations.delete(replay.id);
  }
}

/**
 * Trigger automatic background evaluation for a freshly completed replay.
 * This is fire-and-forget: failures are logged but never block gameplay.
 * Deduplication: skips if already cached or in-flight.
 */
export function triggerAutoEvaluation(replayId: string): void {
  // Skip if already cached
  const cached = getCachedEvaluation(replayId);
  if (cached && !cached.error) return;

  // Skip if in-flight
  if (inFlightEvaluations.has(replayId)) return;

  // Load replay from DB
  const row = db.prepare("SELECT * FROM replays WHERE id = ?").get(replayId) as any;
  if (!row) return;

  let actions: any[] = [];
  try {
    actions = JSON.parse(row.transcript_json || "[]");
  } catch {
    return;
  }

  const replay: ReplayData = {
    id: row.id,
    roomId: row.room_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    players: [
      { userId: row.player1_id, username: row.player1_username },
      { userId: row.player2_id, username: row.player2_username },
    ],
    outcome: {
      winnerId: row.winner_id,
      winnerUsername: row.winner_username,
      loserId: row.loser_id,
      loserUsername: row.loser_username,
      winnerScore: row.winner_score,
      loserScore: row.loser_score,
      endReason: row.end_reason,
    },
    actions,
  };

  // Use player1 as requesting player for auto-eval (evaluation is symmetric)
  evaluateReplay(replay, row.player1_id).catch((err) => {
    console.error(`[auto-eval] Background evaluation failed for replay ${replayId}:`, err?.message || err);
  });
}

/**
 * Batch-prepare evaluations for a user's recent unevaluated replays.
 * Returns the number of evaluations triggered.
 * Bounded: at most `maxBatch` evaluations per call.
 */
export function batchPrepareEvaluations(userId: string, maxBatch = 5): { triggered: number; alreadyCached: number; total: number } {
  ensureEvaluationTable();

  // Find user's recent replays that don't have cached evaluations
  const replays = db.prepare(`
    SELECT r.id FROM replays r
    LEFT JOIN replay_evaluations e ON r.id = e.replay_id
    WHERE (r.player1_id = ? OR r.player2_id = ?)
      AND e.replay_id IS NULL
    ORDER BY r.ended_at DESC
    LIMIT ?
  `).all(userId, userId, maxBatch * 2) as { id: string }[];

  let triggered = 0;
  let alreadyCached = 0;

  for (const replay of replays) {
    if (triggered >= maxBatch) break;

    const cached = getCachedEvaluation(replay.id);
    if (cached && !cached.error) {
      alreadyCached++;
      continue;
    }

    if (inFlightEvaluations.has(replay.id)) continue;

    triggerAutoEvaluation(replay.id);
    triggered++;
  }

  return { triggered, alreadyCached, total: replays.length };
}

/** Check if a replay evaluation is currently in-flight */
export function isEvaluationInFlight(replayId: string): boolean {
  return inFlightEvaluations.has(replayId);
}

/**
 * Low-level: invoke `python -m gin_rummy.evaluator` with stdin/stdout.
 */
async function runPythonEvaluator(
  inputJson: string,
): Promise<{ data?: any; error?: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const proc = spawn(PYTHON_PATH, ["-m", "gin_rummy.evaluator"], {
      cwd: ENGINE_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Timeout kill
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { proc.kill("SIGTERM"); } catch {}
        resolve({ error: "Evaluation timed out" });
      }
    }, EVALUATION_TIMEOUT_MS);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        resolve({
          error: `Python evaluator exited with code ${code}: ${stderr.slice(0, 500)}`,
        });
        return;
      }

      try {
        const data = JSON.parse(stdout);
        resolve({ data });
      } catch {
        resolve({ error: `Invalid JSON from evaluator: ${stdout.slice(0, 500)}` });
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ error: `Failed to spawn Python: ${err.message}` });
    });

    // Send input
    try {
      proc.stdin.write(inputJson);
      proc.stdin.end();
    } catch (err: any) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ error: `Failed to write to Python stdin: ${err.message}` });
      }
    }
  });
}

/**
 * Check if Python is available and the evaluator module can be imported.
 */
export async function checkPythonAvailability(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_PATH, ["-c", "import gin_rummy.evaluator; print('ok')"], {
      cwd: ENGINE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve(false);
    }, 5000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && out.trim() === "ok");
    });

    proc.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
