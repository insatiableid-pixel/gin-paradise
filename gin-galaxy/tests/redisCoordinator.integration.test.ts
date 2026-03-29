/**
 * Redis Coordinator Integration Tests.
 *
 * These tests only run when REDIS_URL is provided. They prove that two
 * independent coordinator instances can share room, queue, and lease state
 * through Redis and observe each other's coordination events.
 */

import crypto from "crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RedisCoordinator } from "../server/multiplayer/redisCoordinator.js";

const redisUrl = process.env.REDIS_URL;
const runRedisIntegration = !!redisUrl;

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for Redis state to propagate");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const suite = runRedisIntegration ? describe : describe.skip;

suite("RedisCoordinator integration", () => {
  let coordA: RedisCoordinator;
  let coordB: RedisCoordinator;
  let keyPrefix: string;

  beforeEach(async () => {
    keyPrefix = `itest:${crypto.randomUUID()}:`;
    coordA = new RedisCoordinator({ url: redisUrl!, keyPrefix });
    coordB = new RedisCoordinator({ url: redisUrl!, keyPrefix });
    await coordA.connect();
    await coordB.connect();
  });

  afterEach(async () => {
    await coordA.disconnect();
    await coordB.disconnect();
  });

  it("shares room snapshots and emits room events across instances", async () => {
    const roomId = "ROOM01";
    const now = Date.now();
    const received: string[] = [];
    coordB.subscribe((event) => {
      received.push(event.type);
    });

    coordA.createRoom({
      id: roomId,
      hostId: "u1",
      players: new Map([
        ["u1", { userId: "u1", username: "Alice", ws: null, connected: true, nodeId: coordA.getNodeId() }],
      ]),
      status: "waiting",
      createdAt: now,
      stakeId: "free",
      ownerNodeId: coordA.getNodeId(),
      ownerLeaseExpiresAt: now + 30_000,
    });

    coordA.updateRoomOwnership(roomId, {
      timerOwnerNodeId: coordA.getNodeId(),
      timerLeaseExpiresAt: now + 45_000,
    });

    await waitFor(() => coordB.getRoom(roomId)?.timerOwnerNodeId === coordA.getNodeId());
    const room = coordB.getRoom(roomId);
    expect(room).toBeDefined();
    expect(room!.players.size).toBe(1);
    expect(room!.players.get("u1")?.username).toBe("Alice");
    expect(room!.timerOwnerNodeId).toBe(coordA.getNodeId());
    expect(received).toContain("room_created");
  });

  it("relays room actions between coordinator instances", async () => {
    const roomId = "ROOMRELAY";
    const received: string[] = [];

    coordB.subscribe((event) => {
      if (event.type !== "relay_room_action_requested") {
        return;
      }
      received.push(event.type);

      const request = event.payload?.request as {
        requestId: string;
        targetNodeId: string;
        sourceNodeId: string;
        roomId: string;
        userId: string;
        username: string;
        message: unknown;
      } | undefined;
      if (!request) {
        return;
      }

      coordB.completeRoomAction({
        requestId: request.requestId,
        targetNodeId: request.sourceNodeId,
        sourceNodeId: request.targetNodeId,
        roomId: request.roomId,
        userId: request.userId,
        messages: [{ type: "room_joined", room: { id: roomId } }],
      });
    });

    const response = await coordA.requestRoomAction({
      requestId: crypto.randomUUID(),
      targetNodeId: coordB.getNodeId(),
      sourceNodeId: coordA.getNodeId(),
      roomId,
      userId: "u1",
      username: "Alice",
      message: { type: "join_room", roomId },
    });

    expect(received).toContain("relay_room_action_requested");
    expect(response.messages).toEqual([{ type: "room_joined", room: { id: roomId } }]);
  });

  it("shares queue entries across instances", async () => {
    const received: string[] = [];
    coordB.subscribe((event) => {
      received.push(event.type);
    });

    coordA.enqueueMatchmaking({
      userId: "u1",
      username: "Alice",
      rating: 1200,
      ws: null,
      enqueuedAt: Date.now(),
      stakeId: "free",
      timerSpeed: "medium",
      matchPosture: "like_rated",
      nodeId: coordA.getNodeId(),
      connected: true,
    });

    await waitFor(() => coordB.isMatchmakingQueued("u1"));
    expect(coordB.getMatchmakingQueueSize()).toBe(1);
    expect(received).toContain("matchmaking_enqueued");

    coordB.dequeueMatchmaking("u1");
    await waitFor(() => !coordA.isMatchmakingQueued("u1"));
    expect(coordA.getMatchmakingQueueSize()).toBe(0);
  });

  it("restores live match snapshots after a coordinator restart", async () => {
    const roomId = "ROOMSNAP";
    const now = Date.now();

    coordA.createRoom({
      id: roomId,
      hostId: "u1",
      players: new Map([
        ["u1", { userId: "u1", username: "Alice", ws: null, connected: true, nodeId: coordA.getNodeId() }],
      ]),
      status: "playing",
      createdAt: now,
      stakeId: "free",
      ownerNodeId: coordA.getNodeId(),
      ownerLeaseExpiresAt: now + 30_000,
    });

    coordA.setRoomGameState(roomId, {
      match: {
        roomId,
        players: [
          { userId: "u1", username: "Alice", hand: [], score: 0 },
          { userId: "u2", username: "Bob", hand: [], score: 0 },
        ],
        currentPlayerIndex: 0,
        stock: [],
        discard: [],
        status: "playing",
        winnerId: null,
        roundWinnerId: null,
        roundPoints: 0,
        roundNumber: 4,
        message: "Snapshot test",
      },
      lastShowdown: {
        knockOutcome: "knock",
        knockerUsername: "Alice",
        opponentUsername: "Bob",
        knocker: { username: "Alice", melds: [], deadwood: [], deadwoodValue: 0 },
        opponent: { username: "Bob", melds: [], deadwood: [], deadwoodValue: 0 },
        roundWinnerUsername: "Alice",
        roundPoints: 0,
      },
      timer: {
        activePlayerId: "u1",
        startedAt: now - 15_000,
        expiresAt: now + 15_000,
        totalSeconds: 30,
      },
      timeoutCounts: {
        u1: 1,
        u2: 2,
      },
      updatedAt: now,
      nodeId: coordA.getNodeId(),
    });

    coordA.updateRoomTimerSpeed(roomId, "fast");

    coordA.updateRoomOwnership(roomId, {
      ownerNodeId: undefined,
      ownerLeaseExpiresAt: undefined,
      timerOwnerNodeId: undefined,
      timerLeaseExpiresAt: undefined,
    });

    await waitFor(() => coordB.getRoom(roomId)?.status === "playing" && coordB.getRoom(roomId)?.ownerNodeId === undefined);

    await waitFor(() => {
      const match = coordB.getRoomGameState(roomId)?.match as { roomId?: string } | null | undefined;
      return match?.roomId === roomId;
    });
    expect(coordB.getRoomGameState(roomId)).toMatchObject({
      match: { roomId, status: "playing", roundNumber: 4 },
      lastShowdown: { knockOutcome: "knock", knockerUsername: "Alice" },
    });

    await coordA.disconnect();
    await coordB.disconnect();

    const coordC = new RedisCoordinator({ url: redisUrl!, keyPrefix });
    await coordC.connect();
    try {
      await waitFor(() => {
        const match = coordC.getRoomGameState(roomId)?.match as { roomId?: string } | null | undefined;
        return match?.roomId === roomId;
      });
    expect(coordC.getRoomGameState(roomId)).toMatchObject({
      match: { roomId, status: "playing", roundNumber: 4 },
      lastShowdown: { knockOutcome: "knock", roundPoints: 0 },
      timer: { activePlayerId: "u1", totalSeconds: 30 },
      timeoutCounts: { u1: 1, u2: 2 },
    });
    expect(coordC.getRoom(roomId)).toMatchObject({
      ownerNodeId: undefined,
      timerOwnerNodeId: undefined,
      timerSpeed: "fast",
    });
    } finally {
      await coordC.disconnect();
    }
  });

  it("propagates lease ownership across instances", async () => {
    const leaseName = "room:ROOM01:owner";
    const ownerId = coordA.getNodeId();
    const followerId = coordB.getNodeId();

    coordA.claimLease(leaseName, ownerId, 10_000);
    await waitFor(() => coordB.getLease(leaseName)?.ownerId === ownerId);
    expect(coordB.getLease(leaseName)?.ownerId).toBe(ownerId);
    expect(coordB.getLease(leaseName)?.expiresAt).toBeGreaterThan(Date.now());

    expect(coordB.claimLease(leaseName, followerId, 10_000)).toBe(false);
  });

  it("allows a successor node to claim an expired lease", async () => {
    const leaseName = `room:${crypto.randomUUID()}:owner`;
    const ownerId = coordA.getNodeId();
    const successorId = coordB.getNodeId();

    expect(coordA.claimLease(leaseName, ownerId, 120)).toBe(true);
    await waitFor(() => coordB.getLease(leaseName)?.ownerId === ownerId);

    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(coordB.getLease(leaseName)).toBeUndefined();
    expect(coordB.claimLease(leaseName, successorId, 10_000)).toBe(true);

    await waitFor(() => coordA.getLease(leaseName)?.ownerId === successorId);
    expect(coordA.getLease(leaseName)).toMatchObject({
      ownerId: successorId,
    });
  });

  it("suppresses stale closed-client persistence noise during disconnect", async () => {
    const roomId = `ROOMCLOSE-${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const commandClient = (coordA as unknown as { commandClient?: { set: (...args: any[]) => Promise<unknown> } }).commandClient;

    expect(commandClient).toBeDefined();

    const originalSet = commandClient!.set.bind(commandClient);
    const setSpy = vi.spyOn(commandClient!, "set").mockImplementation(async (...args: any[]) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return originalSet(...args);
    });

    try {
      coordA.createRoom({
        id: roomId,
        hostId: "u1",
        players: new Map([
          ["u1", { userId: "u1", username: "Alice", ws: null, connected: true, nodeId: coordA.getNodeId() }],
        ]),
        status: "playing",
        createdAt: now,
        stakeId: "free",
        ownerNodeId: coordA.getNodeId(),
        ownerLeaseExpiresAt: now + 30_000,
      });

      expect(setSpy).toHaveBeenCalled();

      await coordA.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const errorText = errorSpy.mock.calls.flat().map(String).join(" ");
      expect(errorText).not.toContain("The client is closed");
      expect(errorText).not.toContain("Failed to persist room");
    } finally {
      setSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
