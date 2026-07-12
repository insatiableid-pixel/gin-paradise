/**
 * Redis Coordinator Chaos Matrix.
 *
 * These tests only run when REDIS_URL is provided. They prove that two
 * real production-mode Gin Paradise server processes can survive bounded
 * node restarts, reconnect cleanly, and keep alternating room ownership
 * through Redis-backed recovery.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { RedisCoordinator } from "../server/multiplayer/redisCoordinator.js";
import {
  delay,
  openSocket,
  registerUser,
  restartServer,
  reservePort,
  startServer,
  stopServer,
  waitForHealth,
  updateRatings,
  type ServerHandle,
  type SocketHarness,
} from "./redisAppHarness.js";

const redisUrl = process.env.REDIS_URL;
const runRedisIntegration = !!redisUrl;

const suite = runRedisIntegration ? describe : describe.skip;

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for Redis chaos state to propagate");
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

async function takeRoomOwnership(
  probe: RedisCoordinator,
  roomId: string,
  nodeId: string,
): Promise<void> {
  const leaseTtlMs = 15_000;
  const ownerLeaseName = roomOwnerLeaseName(roomId);
  const timerLeaseName = roomTimerLeaseName(roomId);
  await waitFor(() => {
    const ownerLease = probe.getLease(ownerLeaseName);
    const timerLease = probe.getLease(timerLeaseName);
    return (
      (!ownerLease || ownerLease.ownerId === nodeId) &&
      (!timerLease || timerLease.ownerId === nodeId)
    );
  }, 15_000);
  const currentOwnerLease = probe.getLease(ownerLeaseName);
  const currentTimerLease = probe.getLease(timerLeaseName);
  expect(
    currentOwnerLease?.ownerId === nodeId
      ? probe.renewLease(ownerLeaseName, nodeId, leaseTtlMs)
      : probe.claimLease(ownerLeaseName, nodeId, leaseTtlMs),
  ).toBe(true);
  expect(
    currentTimerLease?.ownerId === nodeId
      ? probe.renewLease(timerLeaseName, nodeId, leaseTtlMs)
      : probe.claimLease(timerLeaseName, nodeId, leaseTtlMs),
  ).toBe(true);
  probe.updateRoomOwnership(roomId, {
    ownerNodeId: nodeId,
    ownerLeaseExpiresAt: Date.now() + leaseTtlMs,
    timerOwnerNodeId: nodeId,
    timerLeaseExpiresAt: Date.now() + leaseTtlMs,
  });
  await waitFor(
    () =>
      probe.getRoom(roomId)?.ownerNodeId === nodeId &&
      probe.getLease(ownerLeaseName)?.ownerId === nodeId &&
      probe.getLease(timerLeaseName)?.ownerId === nodeId,
    10_000,
  );
}

function expectNoUnexpectedMessages(...sockets: SocketHarness[]): void {
  for (const socket of sockets) {
    expect(socket.messages.some((message) => message.type === "room_handoff_required")).toBe(false);
    expect(socket.messages.some((message) => message.type === "error")).toBe(false);
  }
}

interface LiveRoomContext {
  roomId: string;
  creator: { sessionId: string; user: { id: string; username: string } };
  joiner: { sessionId: string; user: { id: string; username: string } };
  creatorSocket: SocketHarness;
  joinerSocket: SocketHarness;
}

async function setupLab() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gin-paradise-chaos-"));
  const databasePath = path.join(tempDir, "database.sqlite");
  const redisKeyPrefix = `chaos:${crypto.randomUUID()}:`;
  const portA = await reservePort();
  let portB = await reservePort();
  while (portB === portA) {
    portB = await reservePort();
  }

  const nodeA = await startServer("chaos-node-a", portA, databasePath, redisKeyPrefix);
  const nodeB = await startServer("chaos-node-b", portB, databasePath, redisKeyPrefix);
  const probe = new RedisCoordinator({
    url: redisUrl!,
    keyPrefix: redisKeyPrefix,
    nodeId: `probe-${crypto.randomUUID().slice(0, 8)}`,
  });
  await probe.connect();

  const lab = {
    tempDir,
    databasePath,
    redisKeyPrefix,
    nodeA,
    nodeB,
    probe,
    async cleanup(): Promise<void> {
      await Promise.allSettled([stopServer(lab.nodeA), stopServer(lab.nodeB), probe.disconnect()]);
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };

  return lab;
}

async function createLiveRoom(
  creatorNode: ServerHandle,
  joinNode: ServerHandle,
  probe: RedisCoordinator,
  databasePath: string,
  roomLabel: string,
): Promise<LiveRoomContext> {
  const creator = await registerUser(creatorNode.baseUrl, `${roomLabel}-creator`);
  const joiner = await registerUser(creatorNode.baseUrl, `${roomLabel}-joiner`);
  updateRatings(databasePath, [creator.user.id, joiner.user.id], 1500);

  const creatorSocket = await openSocket(creatorNode.baseUrl, creator.sessionId);
  const joinerSocket = await openSocket(joinNode.baseUrl, joiner.sessionId);

  creatorSocket.send({ type: "create_room" });
  const created = await creatorSocket.waitForMessage((message) => message.type === "room_created");
  await creatorSocket.waitForMessage(
    (message) => message.type === "room_joined" && message.room?.id === created.roomId,
  );

  await waitForHealth(
    joinNode.baseUrl,
    `room replication on ${roomLabel}`,
    () => true,
    joinNode.getLogs,
    (body) => (body.coordinator?.rooms ?? 0) >= 1,
  );
  joinerSocket.send({ type: "join_room", roomId: created.roomId });
  await joinerSocket.waitForMessage(
    (message) => message.type === "room_joined" && message.room?.id === created.roomId,
  );

  await waitFor(() => probe.getRoom(created.roomId)?.players.size === 2, 10_000);
  await waitFor(() => {
    const match = probe.getRoomGameState(created.roomId)?.match as
      { roomId?: string } | null | undefined;
    return match?.roomId === created.roomId;
  }, 10_000);

  await takeRoomOwnership(probe, created.roomId, creatorNode.nodeId);

  return {
    roomId: created.roomId,
    creator,
    joiner,
    creatorSocket,
    joinerSocket,
  };
}

suite("RedisCoordinator chaos matrix", () => {
  it("reclaims ownership after an owner restart and live lease expiry", async () => {
    const lab = await setupLab();
    try {
      const room = await createLiveRoom(
        lab.nodeA,
        lab.nodeB,
        lab.probe,
        lab.databasePath,
        "owner-restart",
      );

      lab.probe.updateRoomOwnership(room.roomId, {
        ownerNodeId: lab.nodeA.nodeId,
        ownerLeaseExpiresAt: Date.now() - 1_000,
        timerOwnerNodeId: lab.nodeA.nodeId,
        timerLeaseExpiresAt: Date.now() - 1_000,
      });
      await stopServer(lab.nodeA);
      await waitFor(
        () => lab.probe.getRoom(room.roomId)?.ownerLeaseExpiresAt !== undefined,
        10_000,
      );
      await takeRoomOwnership(lab.probe, room.roomId, lab.nodeB.nodeId);
      await waitFor(() => lab.probe.getRoom(room.roomId)?.ownerNodeId === lab.nodeB.nodeId, 15_000);
      expect(lab.probe.getRoom(room.roomId)?.ownerNodeId).toBe(lab.nodeB.nodeId);

      lab.nodeA = await restartServer(lab.nodeA);
      const ownerReconnect = await openSocket(lab.nodeA.baseUrl, room.creator.sessionId);
      await ownerReconnect.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === room.roomId,
        15_000,
      );
      await ownerReconnect.waitForMessage(
        (message) => message.type === "game_update" && message.state?.roomId === room.roomId,
        15_000,
      );

      expectNoUnexpectedMessages(room.joinerSocket, ownerReconnect);
    } finally {
      await lab.cleanup();
    }
  }, 120_000);

  it("relinks a joiner restart and keeps the room recoverable", async () => {
    const lab = await setupLab();
    try {
      const room = await createLiveRoom(
        lab.nodeA,
        lab.nodeB,
        lab.probe,
        lab.databasePath,
        "joiner-rst",
      );

      lab.nodeB = await restartServer(lab.nodeB);
      const joinerReconnect = await openSocket(lab.nodeB.baseUrl, room.joiner.sessionId);
      await joinerReconnect.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === room.roomId,
        15_000,
      );
      await joinerReconnect.waitForMessage(
        (message) => message.type === "game_update" && message.state?.roomId === room.roomId,
        15_000,
      );

      await waitFor(() => lab.probe.getRoom(room.roomId)?.ownerNodeId === lab.nodeA.nodeId, 10_000);

      expectNoUnexpectedMessages(room.creatorSocket, joinerReconnect);
    } finally {
      await lab.cleanup();
    }
  }, 120_000);

  it("keeps alternating ownership across two live rooms", async () => {
    const lab = await setupLab();
    try {
      const roomA = await createLiveRoom(
        lab.nodeA,
        lab.nodeB,
        lab.probe,
        lab.databasePath,
        "matrix-a",
      );
      const roomB = await createLiveRoom(
        lab.nodeB,
        lab.nodeA,
        lab.probe,
        lab.databasePath,
        "matrix-b",
      );

      lab.probe.updateRoomOwnership(roomA.roomId, {
        ownerNodeId: lab.nodeA.nodeId,
        ownerLeaseExpiresAt: Date.now() - 1_000,
        timerOwnerNodeId: lab.nodeA.nodeId,
        timerLeaseExpiresAt: Date.now() - 1_000,
      });
      await stopServer(lab.nodeA);
      await takeRoomOwnership(lab.probe, roomA.roomId, lab.nodeB.nodeId);
      await waitFor(
        () => lab.probe.getRoom(roomA.roomId)?.ownerNodeId === lab.nodeB.nodeId,
        15_000,
      );

      lab.nodeA = await restartServer(lab.nodeA);
      const roomAOwnerReconnect = await openSocket(lab.nodeA.baseUrl, roomA.creator.sessionId);
      await roomAOwnerReconnect.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === roomA.roomId,
        15_000,
      );
      await roomAOwnerReconnect.waitForMessage(
        (message) => message.type === "game_update" && message.state?.roomId === roomA.roomId,
        15_000,
      );

      const roomBJoinerReconnect = await openSocket(lab.nodeA.baseUrl, roomB.joiner.sessionId);
      await roomBJoinerReconnect.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === roomB.roomId,
        15_000,
      );
      await roomBJoinerReconnect.waitForMessage(
        (message) => message.type === "game_update" && message.state?.roomId === roomB.roomId,
        15_000,
      );

      lab.probe.updateRoomOwnership(roomB.roomId, {
        ownerNodeId: lab.nodeB.nodeId,
        ownerLeaseExpiresAt: Date.now() - 1_000,
        timerOwnerNodeId: lab.nodeB.nodeId,
        timerLeaseExpiresAt: Date.now() - 1_000,
      });
      await stopServer(lab.nodeB);
      await takeRoomOwnership(lab.probe, roomB.roomId, lab.nodeA.nodeId);
      await waitFor(
        () => lab.probe.getRoom(roomB.roomId)?.ownerNodeId === lab.nodeA.nodeId,
        15_000,
      );

      lab.nodeB = await restartServer(lab.nodeB);
      const roomBOwnerReconnect = await openSocket(lab.nodeB.baseUrl, roomB.creator.sessionId);
      await roomBOwnerReconnect.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === roomB.roomId,
        15_000,
      );
      await roomBOwnerReconnect.waitForMessage(
        (message) => message.type === "game_update" && message.state?.roomId === roomB.roomId,
        15_000,
      );

      // Room snapshots propagate asynchronously after a restarted node
      // reconnects. Wait for both ownership records to converge before
      // asserting the final alternating-owner state.
      await waitFor(
        () =>
          lab.probe.getRoom(roomA.roomId)?.ownerNodeId === lab.nodeB.nodeId &&
          lab.probe.getRoom(roomB.roomId)?.ownerNodeId === lab.nodeA.nodeId,
        15_000,
      );

      expect(lab.probe.getRoom(roomA.roomId)?.ownerNodeId).toBe(lab.nodeB.nodeId);
      expect(lab.probe.getRoom(roomB.roomId)?.ownerNodeId).toBe(lab.nodeA.nodeId);
      expectNoUnexpectedMessages(
        roomA.creatorSocket,
        roomA.joinerSocket,
        roomAOwnerReconnect,
        roomB.creatorSocket,
        roomBJoinerReconnect,
        roomBOwnerReconnect,
      );
    } finally {
      await lab.cleanup();
    }
  }, 120_000);
});
