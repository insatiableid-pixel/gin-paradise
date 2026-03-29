/**
 * Redis Coordinator App Soak Proof.
 *
 * These tests only run when REDIS_URL is provided. They prove that two
 * real production-mode Gin Paradise server processes can survive repeated
 * abrupt owner churn across multiple live rooms and still keep gameplay
 * moving after recovery.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { RedisCoordinator } from "../server/multiplayer/redisCoordinator.js";
import {
  crashServer,
  delay,
  openSocket,
  registerUser,
  reservePort,
  restartServer,
  startServer,
  stopServer,
  updateRatings,
  waitForHealth,
  type ServerHandle,
  type SocketHarness,
} from "./redisAppHarness.js";

const redisUrl = process.env.REDIS_URL;
const runRedisIntegration = !!redisUrl;

const suite = runRedisIntegration ? describe : describe.skip;

interface PlayerRegistration {
  sessionId: string;
  user: {
    id: string;
    username: string;
  };
}

interface LiveRoomContext {
  roomId: string;
  creator: PlayerRegistration;
  joiner: PlayerRegistration;
  creatorSocket: SocketHarness;
  joinerSocket: SocketHarness;
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for app soak state to propagate");
    }
    await delay(50);
  }
}

function roomOwnerLeaseName(roomId: string): string {
  return `room:${roomId}:owner`;
}

function roomTimerLeaseName(roomId: string): string {
  return `room:${roomId}:timer`;
}

async function reconnectUntilJoined(
  baseUrl: string,
  sessionId: string,
  roomId: string,
  attempts = 6,
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

      lastError = new Error(
        `Reconnect attempt observed handoff instead of recovery: ${JSON.stringify(socket.messages[socket.messages.length - 1])}`,
      );
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

function expectNoUnexpectedMessages(...sockets: Array<SocketHarness | null>): void {
  for (const socket of sockets) {
    if (!socket) {
      continue;
    }
    expect(socket.messages.some((message) => message.type === "room_handoff_required")).toBe(false);
    expect(socket.messages.some((message) => message.type === "error")).toBe(false);
  }
}

async function waitForRoomRecovery(
  probe: RedisCoordinator,
  roomId: string,
  ownerNodeId: string,
  activePlayerId: string,
  timeoutMs = 15_000,
): Promise<void> {
  await waitFor(() => {
    const room = probe.getRoom(roomId);
    const snapshot = probe.getRoomGameState(roomId);
    return (
      room?.ownerNodeId === ownerNodeId &&
      room?.timerOwnerNodeId === ownerNodeId &&
      snapshot?.timer?.activePlayerId === activePlayerId &&
      (snapshot?.timer?.expiresAt ?? 0) > Date.now()
    );
  }, timeoutMs);
}

async function waitForRoomLeaseRelease(
  probe: RedisCoordinator,
  roomIds: string[],
  timeoutMs = 20_000,
): Promise<void> {
  await waitFor(() =>
    roomIds.every((roomId) => {
      const room = probe.getRoom(roomId);
      return (
        !!room &&
        (room.ownerLeaseExpiresAt ?? 0) <= Date.now() &&
        (room.timerLeaseExpiresAt ?? 0) <= Date.now() &&
        probe.getLease(roomOwnerLeaseName(roomId)) == null &&
        probe.getLease(roomTimerLeaseName(roomId)) == null
      );
    }),
    timeoutMs,
  );
}

async function createOwnerLocalLiveRoom(
  ownerNode: ServerHandle,
  replicaNode: ServerHandle,
  probe: RedisCoordinator,
  databasePath: string,
  roomLabel: string,
  expectedReplicaRooms: number,
): Promise<LiveRoomContext> {
  const creator = await registerUser(ownerNode.baseUrl, `${roomLabel}-creator`);
  const joiner = await registerUser(ownerNode.baseUrl, `${roomLabel}-joiner`);
  updateRatings(databasePath, [creator.user.id, joiner.user.id], 1500);

  const creatorSocket = await openSocket(ownerNode.baseUrl, creator.sessionId);
  const joinerSocket = await openSocket(ownerNode.baseUrl, joiner.sessionId);

  creatorSocket.send({ type: "create_room" });
  const created = await creatorSocket.waitForMessage((message) => message.type === "room_created");
  await creatorSocket.waitForMessage(
    (message) => message.type === "room_joined" && message.room?.id === created.roomId,
  );

  await waitForHealth(
    replicaNode.baseUrl,
    `room replication on ${replicaNode.nodeId} for ${roomLabel}`,
    () => true,
    replicaNode.getLogs,
    (body) => (body.coordinator?.rooms ?? 0) >= expectedReplicaRooms,
  );

  joinerSocket.send({ type: "join_room", roomId: created.roomId });
  await joinerSocket.waitForMessage(
    (message) => message.type === "room_joined" && message.room?.id === created.roomId,
  );
  await creatorSocket.waitForMessage(
    (message) => message.type === "opponent_joined" && message.opponent?.userId === joiner.user.id,
  );

  await waitFor(() => {
    const room = probe.getRoom(created.roomId);
    const snapshot = probe.getRoomGameState(created.roomId);
    const match = snapshot?.match as
      | { roomId?: string; status?: string; currentPlayerIndex?: number }
      | null
      | undefined;
    return (
      room?.players.size === 2 &&
      match?.roomId === created.roomId &&
      match?.status === "playing" &&
      match?.currentPlayerIndex === 0 &&
      snapshot?.timer?.activePlayerId === creator.user.id &&
      (snapshot?.timer?.expiresAt ?? 0) > Date.now()
    );
  }, 15_000);

  return {
    roomId: created.roomId,
    creator,
    joiner,
    creatorSocket,
    joinerSocket,
  };
}

suite("RedisCoordinator app soak proof", () => {
  it("survives repeated abrupt owner churn across multiple live rooms and keeps play moving", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gin-paradise-app-soak-"));
    const databasePath = path.join(tempDir, "database.sqlite");
    const redisKeyPrefix = `app-soak:${crypto.randomUUID()}:`;
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
      "app-soak-node-a",
      portA,
      databasePath,
      redisKeyPrefix,
      leaseEnv,
    );
    let nodeB = await startServer(
      "app-soak-node-b",
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

    const socketsToClose: SocketHarness[] = [];

    try {
      const roomA = await createOwnerLocalLiveRoom(nodeA, nodeB, probe, databasePath, "soak-a", 1);
      const roomB = await createOwnerLocalLiveRoom(nodeB, nodeA, probe, databasePath, "soak-b", 2);
      socketsToClose.push(
        roomA.creatorSocket,
        roomA.joinerSocket,
        roomB.creatorSocket,
        roomB.joinerSocket,
      );

      await waitFor(() => {
        const roomARecord = probe.getRoom(roomA.roomId);
        const roomBRecord = probe.getRoom(roomB.roomId);
        return (
          roomARecord?.ownerNodeId === nodeA.nodeId &&
          roomARecord?.timerOwnerNodeId === nodeA.nodeId &&
          roomBRecord?.ownerNodeId === nodeB.nodeId &&
          roomBRecord?.timerOwnerNodeId === nodeB.nodeId
        );
      }, 15_000);

      await crashServer(nodeA);
      await waitForRoomLeaseRelease(probe, [roomA.roomId]);
      await waitForHealth(
        nodeB.baseUrl,
        "surviving node B health",
        () => true,
        nodeB.getLogs,
        (body) =>
          body.status === "healthy" &&
          body.coordinator?.healthy === true &&
          body.coordinator?.nodeId === nodeB.nodeId,
      );

      const roomACreatorOnB = await reconnectUntilJoined(nodeB.baseUrl, roomA.creator.sessionId, roomA.roomId);
      socketsToClose.push(roomACreatorOnB);
      const roomAJoinerOnB = await reconnectUntilJoined(nodeB.baseUrl, roomA.joiner.sessionId, roomA.roomId);
      socketsToClose.push(roomAJoinerOnB);

      const roomARecovered = await roomACreatorOnB.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === roomA.roomId &&
          message.state?.isMyTurn === true &&
          message.state?.turnTimer?.totalSeconds > 0,
        15_000,
      );
      expect(roomARecovered.state?.isMyTurn).toBe(true);
      await roomAJoinerOnB.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === roomA.roomId &&
          typeof message.state?.isMyTurn === "boolean",
        15_000,
      );

      await waitForRoomRecovery(probe, roomA.roomId, nodeB.nodeId, roomA.creator.user.id);

      roomACreatorOnB.send({ type: "draw", source: "stock" });
      await roomACreatorOnB.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === roomA.roomId &&
          message.state?.hasDrawn === true,
        15_000,
      );

      roomACreatorOnB.send({ type: "discard", cardIndex: 0 });
      const roomAJoinerTurn = await roomAJoinerOnB.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === roomA.roomId &&
          message.state?.isMyTurn === true,
        15_000,
      );
      expect(roomAJoinerTurn.state?.isMyTurn).toBe(true);
      await waitForRoomRecovery(probe, roomA.roomId, nodeB.nodeId, roomA.joiner.user.id);

      nodeA = await restartServer(nodeA);

      await crashServer(nodeB);
      await waitForRoomLeaseRelease(probe, [roomA.roomId, roomB.roomId], 25_000);
      await waitForHealth(
        nodeA.baseUrl,
        "surviving node A health",
        () => true,
        nodeA.getLogs,
        (body) =>
          body.status === "healthy" &&
          body.coordinator?.healthy === true &&
          body.coordinator?.nodeId === nodeA.nodeId,
      );

      const roomAActiveOnA = await reconnectUntilJoined(nodeA.baseUrl, roomA.joiner.sessionId, roomA.roomId);
      socketsToClose.push(roomAActiveOnA);
      const roomBActiveOnA = await reconnectUntilJoined(nodeA.baseUrl, roomB.creator.sessionId, roomB.roomId);
      socketsToClose.push(roomBActiveOnA);

      const roomARecoveredOnA = await roomAActiveOnA.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === roomA.roomId &&
          message.state?.isMyTurn === true &&
          message.state?.turnTimer?.totalSeconds > 0,
        15_000,
      );
      const roomBRecoveredOnA = await roomBActiveOnA.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === roomB.roomId &&
          message.state?.isMyTurn === true &&
          message.state?.turnTimer?.totalSeconds > 0,
        15_000,
      );
      expect(roomARecoveredOnA.state?.isMyTurn).toBe(true);
      expect(roomBRecoveredOnA.state?.isMyTurn).toBe(true);

      await waitForRoomRecovery(probe, roomA.roomId, nodeA.nodeId, roomA.joiner.user.id);
      await waitForRoomRecovery(probe, roomB.roomId, nodeA.nodeId, roomB.creator.user.id);

      roomAActiveOnA.send({ type: "draw", source: "stock" });
      await roomAActiveOnA.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === roomA.roomId &&
          message.state?.hasDrawn === true,
        15_000,
      );
      roomAActiveOnA.send({ type: "discard", cardIndex: 0 });
      await roomAActiveOnA.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === roomA.roomId &&
          message.state?.isMyTurn === false,
        15_000,
      );

      roomBActiveOnA.send({ type: "draw", source: "stock" });
      await roomBActiveOnA.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === roomB.roomId &&
          message.state?.hasDrawn === true,
        15_000,
      );
      roomBActiveOnA.send({ type: "discard", cardIndex: 0 });
      await roomBActiveOnA.waitForMessage(
        (message) =>
          message.type === "game_update" &&
          message.state?.roomId === roomB.roomId &&
          message.state?.isMyTurn === false,
        15_000,
      );

      expectNoUnexpectedMessages(
        roomACreatorOnB,
        roomAJoinerOnB,
        roomAActiveOnA,
        roomBActiveOnA,
      );
    } finally {
      await Promise.allSettled(socketsToClose.map((socket) => socket.close()));
      await Promise.allSettled([
        stopServer(nodeA),
        stopServer(nodeB),
        probe.disconnect(),
      ]);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 180_000);
});
