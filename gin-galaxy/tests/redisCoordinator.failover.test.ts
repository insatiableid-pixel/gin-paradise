/**
 * Redis Coordinator Failover Rehearsal Tests.
 *
 * These tests only run when REDIS_URL is provided. They prove that a
 * successor node can reclaim expired room ownership, recover a persisted
 * timer snapshot, and still relay room actions through the takeover path.
 */

import crypto from "crypto";
import { describe, it, expect, vi } from "vitest";
import { RedisCoordinator } from "../server/multiplayer/redisCoordinator.js";
import { initCoordinator, _resetCoordinator } from "../server/multiplayer/coordinatorFactory.js";
import {
  restoreTurnTimerFromSnapshot,
  setTurnTimeoutCallback,
  getTurnTimerInfo,
  _clearAllTimers,
} from "../server/multiplayer/turnTimer.js";

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

function roomOwnerLeaseName(roomId: string): string {
  return `room:${roomId}:owner`;
}

function roomTimerLeaseName(roomId: string): string {
  return `room:${roomId}:timer`;
}

const suite = runRedisIntegration ? describe : describe.skip;

suite("RedisCoordinator failover rehearsal", () => {
  it("reclaims an expired room lease, restores the timer snapshot, and relays through the successor", async () => {
    const roomId = `ROOMFAIL:${crypto.randomUUID()}`;
    const keyPrefix = `failover:${crypto.randomUUID()}:`;
    const now = Date.now();
    const coordA = new RedisCoordinator({
      url: redisUrl!,
      keyPrefix,
      nodeId: "node-a",
    });

    await coordA.connect();

    const coordB = await initCoordinator({
      mode: "redis",
      nodeId: "node-b",
      redis: {
        url: redisUrl!,
        keyPrefix,
      },
    });

    try {
      coordA.createRoom({
        id: roomId,
        hostId: "u1",
        players: new Map([
          ["u1", { userId: "u1", username: "Alice", ws: null, connected: true, nodeId: coordA.getNodeId() }],
          ["u2", { userId: "u2", username: "Bob", ws: null, connected: true, nodeId: coordA.getNodeId() }],
        ]),
        status: "playing",
        createdAt: now,
        stakeId: "free",
        ownerNodeId: coordA.getNodeId(),
        ownerLeaseExpiresAt: now + 120,
        timerOwnerNodeId: coordA.getNodeId(),
        timerLeaseExpiresAt: now + 120,
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
          roundNumber: 6,
          message: "Failover rehearsal",
        },
        lastShowdown: null,
        timer: {
          activePlayerId: "u1",
          startedAt: now - 4_000,
          expiresAt: now - 1_000,
          totalSeconds: 3,
        },
        timeoutCounts: {
          u1: 1,
        },
        updatedAt: now,
        nodeId: coordA.getNodeId(),
      });

      expect(coordA.claimLease(roomOwnerLeaseName(roomId), coordA.getNodeId(), 120)).toBe(true);
      expect(coordA.claimLease(roomTimerLeaseName(roomId), coordA.getNodeId(), 120)).toBe(true);

      await waitFor(() => coordB.getRoom(roomId)?.ownerNodeId === coordA.getNodeId());
      await waitFor(() => coordB.getRoomGameState(roomId)?.timer?.activePlayerId === "u1");

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(coordB.getLease(roomOwnerLeaseName(roomId))).toBeUndefined();
      expect(coordB.getLease(roomTimerLeaseName(roomId))).toBeUndefined();
      expect(coordB.claimLease(roomOwnerLeaseName(roomId), coordB.getNodeId(), 10_000)).toBe(true);
      expect(coordB.claimLease(roomTimerLeaseName(roomId), coordB.getNodeId(), 10_000)).toBe(true);

      coordB.updateRoomOwnership(roomId, {
        ownerNodeId: coordB.getNodeId(),
        ownerLeaseExpiresAt: Date.now() + 10_000,
        timerOwnerNodeId: coordB.getNodeId(),
        timerLeaseExpiresAt: Date.now() + 10_000,
      });

      await waitFor(() => coordA.getRoom(roomId)?.ownerNodeId === coordB.getNodeId());

      const timeoutCallback = vi.fn();
      setTurnTimeoutCallback(timeoutCallback);

      const restored = restoreTurnTimerFromSnapshot(roomId, coordB.getRoomGameState(roomId));
      expect(restored).toBe(true);
      expect(timeoutCallback).toHaveBeenCalledWith(roomId, "u1", 2);
      expect(getTurnTimerInfo(roomId)).toBeNull();

      await waitFor(() => coordA.getRoomGameState(roomId)?.timeoutCounts?.u1 === 2);
      expect(coordB.getRoomGameState(roomId)?.timeoutCounts?.u1).toBe(2);

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
      expect(coordB.getRoom(roomId)?.ownerNodeId).toBe(coordB.getNodeId());
    } finally {
      _clearAllTimers();
      await coordA.disconnect().catch(() => undefined);
      await _resetCoordinator().catch(() => undefined);
    }
  }, 30_000);
});
