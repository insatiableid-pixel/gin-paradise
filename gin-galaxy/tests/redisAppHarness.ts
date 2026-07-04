import crypto from "crypto";
import Database from "better-sqlite3";
import net from "net";
import path from "path";
import { spawn, type ChildProcessByStdio } from "child_process";
import { once } from "events";
import { fileURLToPath } from "url";
import type { Readable } from "stream";
import { WebSocket } from "ws";
import { expect } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(appRoot, "server.ts");

function redisUrlOrThrow(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for Redis app-process tests.");
  }
  return redisUrl;
}

export interface HealthBody {
  status?: string;
  deployment?: {
    coordinatorMode?: string;
    liveRoomRouting?: string;
  };
  coordinator?: {
    mode?: string;
    healthy?: boolean;
    nodeId?: string;
    rooms?: number;
    players?: number;
    spectators?: number;
    snapshots?: number;
  };
}

export interface ServerHandle {
  proc: ChildProcessByStdio<null, Readable, Readable>;
  baseUrl: string;
  nodeId: string;
  port: number;
  databasePath: string;
  redisKeyPrefix: string;
  extraEnv?: Record<string, string>;
  getLogs: () => string;
}

export interface SocketHarness {
  ws: WebSocket;
  messages: Array<Record<string, any>>;
  send: (message: unknown) => void;
  waitForMessage: (
    predicate: (message: Record<string, any>) => boolean,
    timeoutMs?: number,
  ) => Promise<Record<string, any>>;
  count: (type: string) => number;
  close: () => Promise<void>;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to reserve a free port."));
        return;
      }

      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function waitForHealth(
  baseUrl: string,
  label: string,
  isAlive: () => boolean,
  getLogs: () => string,
  predicate: (body: HealthBody) => boolean,
  timeoutMs = 45_000,
): Promise<HealthBody> {
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start < timeoutMs) {
    if (!isAlive()) {
      throw new Error(`${label} exited before it became healthy.\n${getLogs()}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        const body = (await response.json()) as HealthBody;
        if (predicate(body)) {
          return body;
        }
      }
    } catch (error) {
      lastError = error;
    }

    await delay(200);
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`${label} did not become healthy in time.${suffix}\n${getLogs()}`);
}

export async function startServer(
  nodeId: string,
  port: number,
  databasePath: string,
  redisKeyPrefix: string,
  extraEnv: Record<string, string> = {},
): Promise<ServerHandle> {
  let stdout = "";
  let stderr = "";
  let exited = false;

  const proc = spawn(process.execPath, ["--import", "tsx", serverScript], {
    cwd: appRoot,
    env: {
      ...process.env,
      CI: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_PATH: databasePath,
      COORDINATOR_MODE: "redis",
      COORDINATOR_NODE_ID: nodeId,
      REDIS_URL: redisUrlOrThrow(),
      REDIS_KEY_PREFIX: redisKeyPrefix,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  proc.once("exit", () => {
    exited = true;
  });

  const getLogs = (): string =>
    [
      `--- stdout (${nodeId}) ---`,
      stdout.trimEnd(),
      `--- stderr (${nodeId}) ---`,
      stderr.trimEnd(),
    ].join("\n");

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(
    baseUrl,
    `server ${nodeId}`,
    () => !exited,
    getLogs,
    (body) =>
      body.status === "healthy" &&
      body.deployment?.coordinatorMode === "redis" &&
      body.deployment?.liveRoomRouting === "multi_node_relay" &&
      body.coordinator?.mode === "redis" &&
      body.coordinator?.healthy === true &&
      body.coordinator?.nodeId === nodeId,
  );

  return { proc, baseUrl, nodeId, port, databasePath, redisKeyPrefix, extraEnv, getLogs };
}

export async function restartServer(handle: ServerHandle): Promise<ServerHandle> {
  await stopServer(handle);
  return await startServer(
    handle.nodeId,
    handle.port,
    handle.databasePath,
    handle.redisKeyPrefix,
    handle.extraEnv,
  );
}

export async function stopServerGracefully(handle: ServerHandle): Promise<void> {
  if (handle.proc.exitCode !== null || handle.proc.signalCode !== null) {
    return;
  }

  try {
    handle.proc.kill("SIGINT");
  } catch {
    handle.proc.kill();
  }

  await Promise.race([once(handle.proc, "exit"), delay(10_000)]);

  if (handle.proc.exitCode === null && handle.proc.signalCode === null) {
    await stopServer(handle);
  }
}

export async function stopServer(handle: ServerHandle): Promise<void> {
  if (handle.proc.exitCode !== null || handle.proc.signalCode !== null) {
    return;
  }

  handle.proc.kill();
  const exitPromise = once(handle.proc, "exit");
  await Promise.race([exitPromise, delay(8_000)]);

  if (handle.proc.exitCode === null && handle.proc.signalCode === null) {
    try {
      handle.proc.kill("SIGKILL");
    } catch {
      handle.proc.kill();
    }
    await Promise.race([once(handle.proc, "exit"), delay(5_000)]);
  }
}

export async function crashServer(handle: ServerHandle): Promise<void> {
  if (handle.proc.exitCode !== null || handle.proc.signalCode !== null) {
    return;
  }

  try {
    handle.proc.kill("SIGKILL");
  } catch {
    handle.proc.kill();
  }

  await Promise.race([once(handle.proc, "exit"), delay(5_000)]);
}

export async function registerUser(
  baseUrl: string,
  username: string,
): Promise<{ sessionId: string; user: { id: string; username: string } }> {
  const suffix = `${username}_${crypto.randomUUID().slice(0, 8)}`;
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: suffix,
      email: `${suffix}@test.com`,
      password: "password123",
    }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { sessionId: string; user: { id: string; username: string } };
}

export function updateRatings(databasePath: string, userIds: string[], rating: number): void {
  const db = new Database(databasePath);
  try {
    const statement = db.prepare("UPDATE users SET rating = ? WHERE id = ?");
    for (const userId of userIds) {
      statement.run(rating, userId);
    }
  } finally {
    db.close();
  }
}

export function openSocket(baseUrl: string, sessionId: string): Promise<SocketHarness> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `${baseUrl.replace("http://", "ws://")}/ws?token=${encodeURIComponent(sessionId)}`,
    );
    const messages: Array<Record<string, any>> = [];
    const waiters: Array<{
      predicate: (message: Record<string, any>) => boolean;
      resolve: (message: Record<string, any>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }> = [];
    let opened = false;
    let intentionallyClosed = false;

    const settleWaiters = (message: Record<string, any>): void => {
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (!waiter.predicate(message)) {
          continue;
        }

        clearTimeout(waiter.timer);
        waiters.splice(index, 1);
        waiter.resolve(message);
      }
    };

    const rejectAllWaiters = (error: Error): void => {
      while (waiters.length > 0) {
        const waiter = waiters.shift()!;
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    };

    ws.on("message", (data) => {
      const text =
        typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : data.toString();

      try {
        const message = JSON.parse(text) as Record<string, any>;
        messages.push(message);
        settleWaiters(message);
      } catch {
        // Ignore malformed payloads; the test will fail if the expected JSON never arrives.
      }
    });

    ws.once("open", () => {
      opened = true;
      resolve({
        ws,
        messages,
        send(message: unknown) {
          ws.send(JSON.stringify(message));
        },
        waitForMessage(predicate, timeoutMs = 10_000) {
          const existing = messages.find(predicate);
          if (existing) {
            return Promise.resolve(existing);
          }

          if (ws.readyState === WebSocket.CLOSED) {
            return Promise.reject(new Error("Socket is already closed."));
          }

          return new Promise<Record<string, any>>((resolveMessage, rejectMessage) => {
            const waiter = {
              predicate,
              resolve: resolveMessage,
              reject: rejectMessage,
              timer: setTimeout(() => {
                const index = waiters.indexOf(waiter);
                if (index >= 0) {
                  waiters.splice(index, 1);
                }
                const observed = messages.map((message) => JSON.stringify(message)).join(", ");
                rejectMessage(
                  new Error(`Timed out waiting for websocket message. Observed: [${observed}]`),
                );
              }, timeoutMs),
            };

            waiters.push(waiter);
          });
        },
        count(type: string) {
          return messages.filter((message) => message.type === type).length;
        },
        close() {
          intentionallyClosed = true;
          return new Promise<void>((resolveClose) => {
            if (ws.readyState === WebSocket.CLOSED) {
              resolveClose();
              return;
            }
            ws.once("close", () => resolveClose());
            ws.close();
          });
        },
      });
    });

    ws.once("error", (error) => {
      if (!opened) {
        reject(error);
        return;
      }

      rejectAllWaiters(error instanceof Error ? error : new Error(String(error)));
    });

    ws.once("close", () => {
      if (intentionallyClosed) {
        return;
      }

      const error = new Error("Socket closed unexpectedly.");
      if (!opened) {
        reject(error);
        return;
      }
      rejectAllWaiters(error);
    });
  });
}
