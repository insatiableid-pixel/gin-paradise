/**
 * Redis Coordinator App Failover Proof.
 *
 * These tests only run when REDIS_URL is provided. They prove that two
 * real production-mode Gin Paradise server processes can survive an owner
 * shutdown, recover the live turn timer on the surviving node, and keep
 * gameplay moving after a player reconnects through that surviving node.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { RedisCoordinator } from "../server/multiplayer/redisCoordinator.js";
import {
  crashServer,
  openSocket,
  registerUser,
  reservePort,
  startServer,
  stopServer,
  updateRatings,
  waitForHealth,
  delay,
  type SocketHarness,
} from "./redisAppHarness.js";

const redisUrl = process.env.REDIS_URL;
const runRedisIntegration = !!redisUrl;

const suite = runRedisIntegration ? describe : describe.skip;

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for app failover state to propagate");
    }
    await delay(50);
  }
}

async function reconnectUntilJoined(
  baseUrl: string,
  sessionId: string,
  roomId: string,
  attempts = 5,
): Promise<SocketHarness> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const socket = await openSocket(baseUrl, sessionId);

    try {
      await socket.waitForMessage(
        (message) =>
          (message.type === "room_joined" && message.room?.id === roomId) ||
          message.type === "room_handoff_required",
        15_000,
      );

      if (socket.messages.some((message) => message.type === "room_joined" && message.room?.id === roomId)) {
        return socket;
      }

      const latestMessage = socket.messages[socket.messages.length - 1];
      lastError = new Error(`Reconnect attempt observed handoff instead of recovery: ${JSON.stringify(latestMessage)}`);
    } catch (error) {
      lastError = error;
    }

    await socket.close();
    await delay(750);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out reconnecting to recovered room.");
}

function roomOwnerLeaseName(roomId: string): string {
  return `room:${roomId}:owner`;
}

function roomTimerLeaseName(roomId: string): string {
  return `room:${roomId}:timer`;
}

async function waitForRecoveryWindow(
  probe: RedisCoordinator,
  roomId: string,
  crashedNodeId: string,
  {
    includeTimerLease = true,
    timeoutMs = 20_000,
  }: {
    includeTimerLease?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  await waitFor(() => {
    const room = probe.getRoom(roomId);
    const ownerLease = probe.getLease(roomOwnerLeaseName(roomId));
    const timerLease = includeTimerLease ? probe.getLease(roomTimerLeaseName(roomId)) : null;

    return (
      !!room &&
      (ownerLease == null || ownerLease.ownerId !== crashedNodeId) &&
      (room.ownerNodeId !== crashedNodeId || (room.ownerLeaseExpiresAt ?? 0) <= Date.now()) &&
      (!includeTimerLease ||
        (((timerLease == null || timerLease.ownerId !== crashedNodeId) &&
          (room.timerOwnerNodeId !== crashedNodeId || (room.timerLeaseExpiresAt ?? 0) <= Date.now()))))
    );
  }, timeoutMs);
}

suite("RedisCoordinator app failover proof", () => {
  it("reclaims an abruptly lost owner via renewable lease expiry, restores the turn timer, and continues live play", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gin-paradise-app-failover-"));
    const databasePath = path.join(tempDir, "database.sqlite");
    const redisKeyPrefix = `app-failover:${crypto.randomUUID()}:`;
    const leaseEnv = {
      ROOM_OWNER_LEASE_TTL_MS: "3000",
      ROOM_OWNER_LEASE_RENEW_INTERVAL_MS: "500",
      TURN_TIMER_LEASE_TTL_MS: "3000",
      TURN_TIMER_LEASE_RENEW_INTERVAL_MS: "500",
    };
    const portA = await reservePort();
    let portB = await reservePort();
    while (portB === portA) {
      portB = await reservePort();
    }

    let nodeA = await startServer(
      "app-failover-node-a",
      portA,
      databasePath,
      redisKeyPrefix,
      leaseEnv,
    );
    let nodeB = await startServer(
      "app-failover-node-b",
      portB,
      databasePath,
      redisKeyPrefix,
      leaseEnv,
    );
    const probe = new RedisCoordinator({
      url: redisUrl!,
      keyPrefix: redisKeyPrefix,
      nodeId: `probe-${crypto.randomUUID().slice(0, 8)}`,
    });
    await probe.connect();

    const alice = await registerUser(nodeA.baseUrl, "alice");
    const bob = await registerUser(nodeA.baseUrl, "bob");
    updateRatings(databasePath, [alice.user.id, bob.user.id], 1500);

    const aliceSocket = await openSocket(nodeA.baseUrl, alice.sessionId);
    const bobSocket = await openSocket(nodeB.baseUrl, bob.sessionId);
    let aliceReconnect: Awaited<ReturnType<typeof openSocket>> | null = null;

    try {
      aliceSocket.send({ type: "create_room" });
      const created = await aliceSocket.waitForMessage((message) => message.type === "room_created");
      await aliceSocket.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
      );

      await waitForHealth(
        nodeB.baseUrl,
        "room replication on node B",
        () => true,
        nodeB.getLogs,
        (body) => (body.coordinator?.rooms ?? 0) >= 1,
      );

      bobSocket.send({ type: "join_room", roomId: created.roomId });
      await bobSocket.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
      );
      await aliceSocket.waitForMessage(
        (message) => message.type === "opponent_joined" && message.opponent?.userId === bob.user.id,
      );

      await waitFor(() => {
        const room = probe.getRoom(created.roomId);
        const match = probe.getRoomGameState(created.roomId)?.match as { roomId?: string } | null | undefined;
        return room?.players.size === 2 && match?.roomId === created.roomId;
      });

      aliceSocket.send({ type: "draw", source: "stock" });
      await aliceSocket.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === created.roomId &&
          message.state?.hasDrawn === true,
      );

      aliceSocket.send({ type: "discard", cardIndex: 0 });
      const bobTurnStarted = await bobSocket.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === created.roomId &&
          message.state?.isMyTurn === true,
      );
      expect(bobTurnStarted.state?.isMyTurn).toBe(true);

      await waitFor(() => {
        const match = probe.getRoomGameState(created.roomId)?.match as
          | { currentPlayerIndex?: number; message?: string }
          | null
          | undefined;
        return match?.currentPlayerIndex === 1 && match?.message?.includes("discarded") === true;
      }, 10_000);

      await bobSocket.waitForMessage(
        (message) =>
          message.type === "turn_timer" &&
          message.activePlayerId === bob.user.id &&
          message.totalSeconds > 0,
      );

      await waitFor(() => {
        const room = probe.getRoom(created.roomId);
        return room?.ownerLeaseExpiresAt != null && room.ownerLeaseExpiresAt > Date.now();
      }, 10_000);

      await crashServer(nodeA);
      await waitForRecoveryWindow(probe, created.roomId, "app-failover-node-a");

      await waitForHealth(
        nodeB.baseUrl,
        "surviving node health",
        () => true,
        nodeB.getLogs,
        (body) =>
          body.status === "healthy" &&
          body.coordinator?.healthy === true &&
          body.coordinator?.nodeId === "app-failover-node-b",
      );

      aliceReconnect = await openSocket(nodeB.baseUrl, alice.sessionId);
      await aliceReconnect.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
        15_000,
      );
      const recoveredState = await aliceReconnect.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === created.roomId &&
          message.state?.status === "playing",
        15_000,
      );

      await waitFor(() => {
        const snapshot = probe.getRoomGameState(created.roomId);
        return snapshot?.timer?.activePlayerId === bob.user.id && (snapshot?.timer?.expiresAt ?? 0) > Date.now();
      }, 15_000);

      expect(recoveredState.state?.isMyTurn).toBe(false);
      if (recoveredState.state?.turnTimer != null) {
        expect(typeof recoveredState.state.turnTimer.isMyTimer).toBe("boolean");
        expect(recoveredState.state.turnTimer.remainingSeconds).toBeGreaterThan(0);
      }

      await waitFor(() => {
        const room = probe.getRoom(created.roomId);
        return room?.ownerNodeId === "app-failover-node-b" && room?.timerOwnerNodeId === "app-failover-node-b";
      }, 15_000);

      await bobSocket.waitForMessage(
        (message) => message.type === "opponent_reconnected" && message.username === alice.user.username,
        15_000,
      );

      bobSocket.send({ type: "draw", source: "stock" });
      const bobAfterDraw = await bobSocket.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === created.roomId &&
          message.state?.hasDrawn === true,
      );
      expect(bobAfterDraw.state?.isMyTurn).toBe(true);

      bobSocket.send({ type: "discard", cardIndex: 0 });
      const aliceTurnResumed = await aliceReconnect.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === created.roomId &&
          message.state?.isMyTurn === true,
      );

      expect(aliceTurnResumed.state?.isMyTurn).toBe(true);
      expect(
        [...aliceSocket.messages, ...bobSocket.messages, ...aliceReconnect.messages].some(
          (message) => message.type === "room_handoff_required",
        ),
      ).toBe(false);
      expect(
        [...aliceSocket.messages, ...bobSocket.messages, ...aliceReconnect.messages].some(
          (message) => message.type === "error",
        ),
      ).toBe(false);
    } finally {
      await Promise.allSettled([
        aliceSocket.close(),
        bobSocket.close(),
        aliceReconnect?.close?.() ?? Promise.resolve(),
      ]);
      await Promise.allSettled([
        stopServer(nodeA),
        stopServer(nodeB),
        probe.disconnect(),
      ]);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("recovers a durably committed discard after the owner crashes before broadcasting it", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gin-paradise-app-discard-commit-"));
    const databasePath = path.join(tempDir, "database.sqlite");
    const redisKeyPrefix = `app-discard-commit:${crypto.randomUUID()}:`;
    const leaseEnv = {
      ROOM_OWNER_LEASE_TTL_MS: "3000",
      ROOM_OWNER_LEASE_RENEW_INTERVAL_MS: "500",
      TURN_TIMER_LEASE_TTL_MS: "3000",
      TURN_TIMER_LEASE_RENEW_INTERVAL_MS: "500",
    };
    const crashEnv = {
      ...leaseEnv,
      TEST_CRASH_AFTER_DURABLE_ACTION: "discard",
    };
    const portA = await reservePort();
    let portB = await reservePort();
    while (portB === portA) {
      portB = await reservePort();
    }

    let nodeA = await startServer(
      "app-discard-commit-node-a",
      portA,
      databasePath,
      redisKeyPrefix,
      crashEnv,
    );
    let nodeB = await startServer(
      "app-discard-commit-node-b",
      portB,
      databasePath,
      redisKeyPrefix,
      leaseEnv,
    );
    const probe = new RedisCoordinator({
      url: redisUrl!,
      keyPrefix: redisKeyPrefix,
      nodeId: `probe-${crypto.randomUUID().slice(0, 8)}`,
    });
    await probe.connect();

    const alice = await registerUser(nodeA.baseUrl, "alice");
    const bob = await registerUser(nodeA.baseUrl, "bob");
    updateRatings(databasePath, [alice.user.id, bob.user.id], 1500);

    const aliceSocket = await openSocket(nodeA.baseUrl, alice.sessionId);
    const bobSocket = await openSocket(nodeB.baseUrl, bob.sessionId);
    let aliceReconnect: Awaited<ReturnType<typeof openSocket>> | null = null;

    try {
      aliceSocket.send({ type: "create_room" });
      const created = await aliceSocket.waitForMessage((message) => message.type === "room_created");
      await aliceSocket.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
      );

      await waitForHealth(
        nodeB.baseUrl,
        "room replication on node B",
        () => true,
        nodeB.getLogs,
        (body) => (body.coordinator?.rooms ?? 0) >= 1,
      );

      bobSocket.send({ type: "join_room", roomId: created.roomId });
      await bobSocket.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
      );
      await aliceSocket.waitForMessage(
        (message) => message.type === "opponent_joined" && message.opponent?.userId === bob.user.id,
      );

      await waitFor(() => {
        const room = probe.getRoom(created.roomId);
        const match = probe.getRoomGameState(created.roomId)?.match as { roomId?: string } | null | undefined;
        return room?.players.size === 2 && match?.roomId === created.roomId;
      });

      aliceSocket.send({ type: "draw", source: "stock" });
      await aliceSocket.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === created.roomId &&
          message.state?.hasDrawn === true,
      );

      aliceSocket.send({ type: "discard", cardIndex: 0 });

      await waitFor(
        () => nodeA.proc.exitCode !== null || nodeA.proc.signalCode !== null,
        15_000,
      );

      await waitFor(() => {
        const snapshot = probe.getRoomGameState(created.roomId);
        const match = snapshot?.match as
          | { currentPlayerIndex?: number; message?: string }
          | null
          | undefined;
        return (
          match?.currentPlayerIndex === 1 &&
          match?.message?.includes("discarded") === true &&
          snapshot?.timer?.activePlayerId === bob.user.id &&
          (snapshot?.timer?.expiresAt ?? 0) > Date.now()
        );
      }, 10_000);

      await waitForRecoveryWindow(probe, created.roomId, "app-discard-commit-node-a");

      await waitForHealth(
        nodeB.baseUrl,
        "surviving node health",
        () => true,
        nodeB.getLogs,
        (body) =>
          body.status === "healthy" &&
          body.coordinator?.healthy === true &&
          body.coordinator?.nodeId === "app-discard-commit-node-b",
      );

      bobSocket.send({ type: "draw", source: "stock" });
      const bobRecoveredTurn = await bobSocket.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === created.roomId &&
          message.state?.hasDrawn === true,
        15_000,
      );
      expect(bobRecoveredTurn.state?.isMyTurn).toBe(true);

      await waitFor(() => {
        const room = probe.getRoom(created.roomId);
        return (
          room?.ownerNodeId === "app-discard-commit-node-b" &&
          room?.timerOwnerNodeId === "app-discard-commit-node-b"
        );
      }, 15_000);

      aliceReconnect = await openSocket(nodeB.baseUrl, alice.sessionId);
      await aliceReconnect.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
        15_000,
      );
      const recoveredState = await aliceReconnect.waitForMessage(
        (message) => message.type === "game_update" && message.state?.roomId === created.roomId,
        15_000,
      );

      expect(recoveredState.state?.isMyTurn).toBe(false);
      expect(recoveredState.state?.turnTimer?.totalSeconds).toBeGreaterThan(0);
      expect(recoveredState.state?.turnTimer?.remainingSeconds).toBeGreaterThan(0);

      bobSocket.send({ type: "discard", cardIndex: 0 });
      const aliceTurnResumed = await aliceReconnect.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === created.roomId &&
          message.state?.isMyTurn === true,
        15_000,
      );

      expect(aliceTurnResumed.state?.isMyTurn).toBe(true);
      expect(
        [...aliceSocket.messages, ...bobSocket.messages, ...aliceReconnect.messages].some(
          (message) => message.type === "room_handoff_required",
        ),
      ).toBe(false);
      expect(
        [...aliceSocket.messages, ...bobSocket.messages, ...aliceReconnect.messages].some(
          (message) => message.type === "error",
        ),
      ).toBe(false);
    } finally {
      await Promise.allSettled([
        aliceSocket.close(),
        bobSocket.close(),
        aliceReconnect?.close?.() ?? Promise.resolve(),
      ]);
      await Promise.allSettled([
        stopServer(nodeA),
        stopServer(nodeB),
        probe.disconnect(),
      ]);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("recovers a durably committed match start after the owner crashes before broadcasting it", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gin-paradise-app-match-start-commit-"));
    const databasePath = path.join(tempDir, "database.sqlite");
    const redisKeyPrefix = `app-match-start-commit:${crypto.randomUUID()}:`;
    const leaseEnv = {
      ROOM_OWNER_LEASE_TTL_MS: "3000",
      ROOM_OWNER_LEASE_RENEW_INTERVAL_MS: "500",
      TURN_TIMER_LEASE_TTL_MS: "3000",
      TURN_TIMER_LEASE_RENEW_INTERVAL_MS: "500",
    };
    const crashEnv = {
      ...leaseEnv,
      TEST_CRASH_AFTER_DURABLE_ACTION: "match_start",
    };
    const portA = await reservePort();
    let portB = await reservePort();
    while (portB === portA) {
      portB = await reservePort();
    }

    let nodeA = await startServer(
      "app-match-start-commit-node-a",
      portA,
      databasePath,
      redisKeyPrefix,
      crashEnv,
    );
    let nodeB = await startServer(
      "app-match-start-commit-node-b",
      portB,
      databasePath,
      redisKeyPrefix,
      leaseEnv,
    );
    const probe = new RedisCoordinator({
      url: redisUrl!,
      keyPrefix: redisKeyPrefix,
      nodeId: `probe-${crypto.randomUUID().slice(0, 8)}`,
    });
    await probe.connect();

    const alice = await registerUser(nodeA.baseUrl, "alice");
    const bob = await registerUser(nodeA.baseUrl, "bob");
    updateRatings(databasePath, [alice.user.id, bob.user.id], 1500);

    const aliceSocket = await openSocket(nodeA.baseUrl, alice.sessionId);
    const bobSocket = await openSocket(nodeA.baseUrl, bob.sessionId);
    let aliceReconnect: Awaited<ReturnType<typeof openSocket>> | null = null;

    try {
      aliceSocket.send({ type: "create_room" });
      const created = await aliceSocket.waitForMessage((message) => message.type === "room_created");
      await aliceSocket.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
      );

      await waitForHealth(
        nodeB.baseUrl,
        "room replication on node B",
        () => true,
        nodeB.getLogs,
        (body) => (body.coordinator?.rooms ?? 0) >= 1,
      );

      bobSocket.send({ type: "join_room", roomId: created.roomId });
      await bobSocket.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
      );
      await aliceSocket.waitForMessage(
        (message) => message.type === "opponent_joined" && message.opponent?.userId === bob.user.id,
      );

      await waitFor(
        () => nodeA.proc.exitCode !== null || nodeA.proc.signalCode !== null,
        15_000,
      );

      await waitFor(() => {
        const snapshot = probe.getRoomGameState(created.roomId);
        const match = snapshot?.match as
          | { roomId?: string; status?: string; currentPlayerIndex?: number }
          | null
          | undefined;
        return (
          match?.roomId === created.roomId &&
          match?.status === "playing" &&
          match?.currentPlayerIndex === 0 &&
          snapshot?.timer?.activePlayerId === alice.user.id &&
          (snapshot?.timer?.expiresAt ?? 0) > Date.now()
        );
      }, 10_000);

      await waitForRecoveryWindow(probe, created.roomId, "app-match-start-commit-node-a");

      await waitForHealth(
        nodeB.baseUrl,
        "surviving node health",
        () => true,
        nodeB.getLogs,
        (body) =>
          body.status === "healthy" &&
          body.coordinator?.healthy === true &&
          body.coordinator?.nodeId === "app-match-start-commit-node-b",
      );

      expect(
        [...aliceSocket.messages, ...bobSocket.messages].some(
          (message) => message.type === "room_handoff_required",
        ),
      ).toBe(false);
      expect(
        [...aliceSocket.messages, ...bobSocket.messages].some(
          (message) => message.type === "error",
        ),
      ).toBe(false);
    } finally {
      await Promise.allSettled([
        aliceSocket.close(),
        bobSocket.close(),
      ]);
      await Promise.allSettled([
        stopServer(nodeA),
        stopServer(nodeB),
        probe.disconnect(),
      ]);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("recovers a durably committed forced end after the owner crashes before broadcasting it", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gin-paradise-app-forced-end-commit-"));
    const databasePath = path.join(tempDir, "database.sqlite");
    const redisKeyPrefix = `app-forced-end-commit:${crypto.randomUUID()}:`;
    const leaseEnv = {
      ROOM_OWNER_LEASE_TTL_MS: "3000",
      ROOM_OWNER_LEASE_RENEW_INTERVAL_MS: "500",
      TURN_TIMER_LEASE_TTL_MS: "3000",
      TURN_TIMER_LEASE_RENEW_INTERVAL_MS: "500",
    };
    const crashEnv = {
      ...leaseEnv,
      TEST_CRASH_AFTER_DURABLE_ACTION: "forced_end",
    };
    const portA = await reservePort();
    let portB = await reservePort();
    while (portB === portA) {
      portB = await reservePort();
    }

    let nodeA = await startServer(
      "app-forced-end-commit-node-a",
      portA,
      databasePath,
      redisKeyPrefix,
      crashEnv,
    );
    let nodeB = await startServer(
      "app-forced-end-commit-node-b",
      portB,
      databasePath,
      redisKeyPrefix,
      leaseEnv,
    );
    const probe = new RedisCoordinator({
      url: redisUrl!,
      keyPrefix: redisKeyPrefix,
      nodeId: `probe-${crypto.randomUUID().slice(0, 8)}`,
    });
    await probe.connect();

    const alice = await registerUser(nodeA.baseUrl, "alice");
    const bob = await registerUser(nodeA.baseUrl, "bob");
    updateRatings(databasePath, [alice.user.id, bob.user.id], 1500);

    const aliceSocket = await openSocket(nodeA.baseUrl, alice.sessionId);
    const bobSocket = await openSocket(nodeB.baseUrl, bob.sessionId);
    let bobReconnect: Awaited<ReturnType<typeof openSocket>> | null = null;

    try {
      aliceSocket.send({ type: "create_room" });
      const created = await aliceSocket.waitForMessage((message) => message.type === "room_created");
      await aliceSocket.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
      );

      await waitForHealth(
        nodeB.baseUrl,
        "room replication on node B",
        () => true,
        nodeB.getLogs,
        (body) => (body.coordinator?.rooms ?? 0) >= 1,
      );

      bobSocket.send({ type: "join_room", roomId: created.roomId });
      await bobSocket.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
      );
      await aliceSocket.waitForMessage(
        (message) => message.type === "opponent_joined" && message.opponent?.userId === bob.user.id,
      );

      await waitFor(() => {
        const snapshot = probe.getRoomGameState(created.roomId);
        const match = snapshot?.match as { status?: string; roomId?: string } | null | undefined;
        return (
          match?.roomId === created.roomId &&
          match?.status === "playing"
        );
      }, 10_000);

      aliceSocket.send({ type: "leave_room" });

      await waitFor(
        () => nodeA.proc.exitCode !== null || nodeA.proc.signalCode !== null,
        15_000,
      );

      await waitFor(() => {
        const snapshot = probe.getRoomGameState(created.roomId);
        const match = snapshot?.match as
          | { status?: string; winnerId?: string; message?: string }
          | null
          | undefined;
        const room = probe.getRoom(created.roomId);
        return (
          match?.status === "game_over" &&
          match?.winnerId === bob.user.id &&
          match?.message?.includes("wins") === true &&
          room?.status === "finished" &&
          snapshot?.timer == null
        );
      }, 10_000);

      await waitForRecoveryWindow(probe, created.roomId, "app-forced-end-commit-node-a", {
        includeTimerLease: false,
      });

      await waitForHealth(
        nodeB.baseUrl,
        "surviving node health",
        () => true,
        nodeB.getLogs,
        (body) =>
          body.status === "healthy" &&
          body.coordinator?.healthy === true &&
          body.coordinator?.nodeId === "app-forced-end-commit-node-b",
      );

      bobSocket.send({ type: "draw", source: "stock" });
      await bobSocket.waitForMessage(
        (message) =>
          message.type === "error" &&
          (message.message === "Game is not in progress." || message.message === "Not your turn."),
        15_000,
      );

      await waitFor(() => {
        const room = probe.getRoom(created.roomId);
        return room?.ownerNodeId === "app-forced-end-commit-node-b";
      }, 15_000);

      await bobSocket.close();
      bobReconnect = await reconnectUntilJoined(nodeB.baseUrl, bob.sessionId, created.roomId);
      const recoveredGameOver = await bobReconnect.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === created.roomId &&
          message.state?.status === "game_over" &&
          message.state?.winnerId === bob.user.id,
        15_000,
      );

      expect(recoveredGameOver.state?.message).toContain(alice.user.username);
      expect(recoveredGameOver.state?.turnTimer).toBeUndefined();

      expect(
        [...aliceSocket.messages, ...bobSocket.messages, ...bobReconnect.messages].some(
          (message) => message.type === "room_handoff_required",
        ),
      ).toBe(false);
      expect(
        [...aliceSocket.messages, ...bobSocket.messages, ...bobReconnect.messages]
          .filter((message) => message.type === "error")
          .every(
            (message) =>
              message.message === "Game is not in progress." || message.message === "Not your turn.",
          ),
      ).toBe(true);
    } finally {
      await Promise.allSettled([
        aliceSocket.close(),
        bobSocket.close(),
        bobReconnect?.close?.() ?? Promise.resolve(),
      ]);
      await Promise.allSettled([
        stopServer(nodeA),
        stopServer(nodeB),
        probe.disconnect(),
      ]);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 120_000);
});
