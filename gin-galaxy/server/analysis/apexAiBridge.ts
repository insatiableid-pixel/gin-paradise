/**
 * Apex Sprint-2 AI Bridge.
 *
 * Invokes `scripts/apex_ai_service.py` (ApexMCTS draw search + Apex discard/knock)
 * via a short-lived Python subprocess. Falls back gracefully when Python or the
 * research package is unavailable.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PYTHON_PATH = process.env.PYTHON_PATH || "python";
const AI_TIMEOUT_MS = parseInt(process.env.APEX_AI_TIMEOUT_MS || "2500", 10);

/** Repo root (Gin Rummy/) — parent of gin-galaxy/ */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SERVICE_SCRIPT = path.join(REPO_ROOT, "scripts", "apex_ai_service.py");

export type ApexAiTier = "club" | "expert";

export interface ApexAiCard {
  rank: string;
  suit: string;
}

export interface ApexAiRequest {
  action: "draw" | "discard" | "knock" | "health";
  hand?: ApexAiCard[];
  top_discard?: ApexAiCard | null;
  discard_pile?: ApexAiCard[];
  drawn_card?: ApexAiCard | null;
  drew_from_discard?: boolean;
  turn?: number;
  stock_remaining?: number;
  my_score?: number;
  opp_score?: number;
  target_score?: number;
  events?: Array<{ type: string; card?: ApexAiCard }>;
  num_worlds?: number;
  rollout_depth?: number;
  use_weighted_worlds?: boolean;
  seed?: number;
}

export interface ApexAiResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  source: "engine" | "error";
  elapsedMs?: number;
}

/**
 * Run one AI decision through the Python ApexMCTS service.
 */
export async function requestApexDecision(req: ApexAiRequest): Promise<ApexAiResult> {
  const started = Date.now();
  try {
    const result = await runService(JSON.stringify(req));
    const elapsedMs = Date.now() - started;
    if (result.error) {
      return { success: false, error: result.error, source: "error", elapsedMs };
    }
    const data = result.data ?? {};
    if (data.ok === false || data.error) {
      return {
        success: false,
        error: String(data.error || "Apex service returned error"),
        data,
        source: "error",
        elapsedMs,
      };
    }
    return { success: true, data, source: "engine", elapsedMs };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
      source: "error",
      elapsedMs: Date.now() - started,
    };
  }
}

export async function checkApexAiAvailability(): Promise<boolean> {
  const res = await requestApexDecision({ action: "health" });
  return res.success === true;
}

function runService(inputJson: string): Promise<{ data?: Record<string, unknown>; error?: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const proc = spawn(PYTHON_PATH, [SERVICE_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Card suits are Unicode symbols. Force a stable pipe encoding on
        // Windows, where Python otherwise inherits a legacy console codepage.
        PYTHONUTF8: process.env.PYTHONUTF8 || "1",
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
      },
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        resolve({ error: `Apex AI service timed out after ${AI_TIMEOUT_MS}ms` });
      }
    }, AI_TIMEOUT_MS);

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        resolve({
          error: `Apex AI service exited ${code}: ${stderr.slice(0, 400) || stdout.slice(0, 400)}`,
        });
        return;
      }

      try {
        // Service may print logs on stderr; stdout is pure JSON
        const line = stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .pop();
        if (!line) {
          resolve({ error: "Empty response from Apex AI service" });
          return;
        }
        const data = JSON.parse(line) as Record<string, unknown>;
        resolve({ data });
      } catch {
        resolve({ error: `Invalid JSON from Apex AI service: ${stdout.slice(0, 400)}` });
      }
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ error: `Failed to spawn Apex AI service: ${err.message}` });
    });

    try {
      proc.stdin.write(inputJson);
      proc.stdin.end();
    } catch (err: unknown) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const message = err instanceof Error ? err.message : String(err);
        resolve({ error: `Failed to write to Apex AI service: ${message}` });
      }
    }
  });
}
