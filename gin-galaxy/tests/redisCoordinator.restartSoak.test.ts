/**
 * Redis Coordinator Restart Soak Proof.
 *
 * These tests only run when REDIS_URL is provided. They prove that a
 * coordinator can disconnect and reconnect repeatedly while preserving
 * room ownership, recovering expired timer snapshots, and relaying live
 * room actions after each recovery cycle.
 */

import crypto from "crypto";
import { describe, it, expect } from "vitest";
import { RedisCoordinator } from "../server/multiplayer/redisCoordinator.js";
import { initCoordinator, _resetCoordinator } from "../server/multiplayer/coordinatorFactory.js";
import {
  recoverTurnTimersFromCoordinator,
  setTurnTimeoutCallback,
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

suite("RedisCoordinator restart soak proof", () => {
  it("survives repeated reconnect cycles while preserving ownership, timers, and relay", async () => {
    const roomCount = 3;
    const restartCycles = 3;
    const keyPrefix = `soak:${crypto.randomUUID()}:`;
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

    const rooms = Array.from({ length: roomCount }, (_, index) => {
      const roomId = `ROOMSOAK-${index}-${crypto.randomUUID().slice(0, 8)}`;
      return {
        roomId,
        actorId: `u${index}-a`,
        actorName: `Alice${index}`,
        opponentId: `u${index}-b`,
        opponentName: `Bob${index}`,
      };
    });

    const timeoutCounts = new Map<string, number>();
    setTurnTimeoutCallback((roomId, _timedOutPlayerId, consecutiveTimeouts) => {
      timeoutCounts.set(roomId, consecutiveTimeouts);
    });
    coordB.subscribe((event) => {
      if (event.type !== "relay_room_action_requested") {
        return;
      }

      const request = event.payload?.request as
        | {
            requestId: string;
            targetNodeId: string;
            sourceNodeId: string;
            roomId: string;
            userId: string;
            username: string;
            message: unknown;
          }
        | undefined;
      if (!request) {
        return;
      }

      coordB.completeRoomAction({
        requestId: request.requestId,
        targetNodeId: request.sourceNodeId,
        sourceNodeId: request.targetNodeId,
        roomId: request.roomId,
        userId: request.userId,
        messages: [{ type: "room_joined", room: { id: request.roomId } }],
      });
    });

    try {
      for (const [index, room] of rooms.entries()) {
        coordA.createRoom({
          id: room.roomId,
          hostId: room.actorId,
          players: new Map([
            [
              room.actorId,
              {
                userId: room.actorId,
                username: room.actorName,
                ws: null,
                connected: true,
                nodeId: coordA.getNodeId(),
              },
            ],
            [
              room.opponentId,
              {
                userId: room.opponentId,
                username: room.opponentName,
                ws: null,
                connected: true,
                nodeId: coordA.getNodeId(),
              },
            ],
          ]),
          status: "playing",
          createdAt: now + index,
          stakeId: "free",
          ownerNodeId: coordA.getNodeId(),
          ownerLeaseExpiresAt: now + 120,
          timerOwnerNodeId: coordA.getNodeId(),
          timerLeaseExpiresAt: now + 120,
        });

        coordA.setRoomGameState(room.roomId, {
          match: {
            roomId: room.roomId,
            players: [
              { userId: room.actorId, username: room.actorName, hand: [], score: 0 },
              { userId: room.opponentId, username: room.opponentName, hand: [], score: 0 },
            ],
            currentPlayerIndex: 0,
            stock: [],
            discard: [],
            status: "playing",
            winnerId: null,
            roundWinnerId: null,
            roundPoints: 0,
            roundNumber: 6,
            message: "Restart soak proof",
          },
          lastShowdown: null,
          timer: {
            activePlayerId: room.actorId,
            startedAt: now - 4_000,
            expiresAt: now - 1_000,
            totalSeconds: 3,
          },
          timeoutCounts: {
            [room.actorId]: 0,
          },
          updatedAt: now,
          nodeId: coordA.getNodeId(),
        });

        expect(coordA.claimLease(roomOwnerLeaseName(room.roomId), coordA.getNodeId(), 120)).toBe(
          true,
        );
        expect(coordA.claimLease(roomTimerLeaseName(room.roomId), coordA.getNodeId(), 120)).toBe(
          true,
        );
      }

      await waitFor(() =>
        rooms.every((room) => coordB.getRoom(room.roomId)?.ownerNodeId === coordA.getNodeId()),
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
      for (const room of rooms) {
        expect(coordB.claimLease(roomOwnerLeaseName(room.roomId), coordB.getNodeId(), 10_000)).toBe(
          true,
        );
        expect(coordB.claimLease(roomTimerLeaseName(room.roomId), coordB.getNodeId(), 10_000)).toBe(
          true,
        );
        coordB.updateRoomOwnership(room.roomId, {
          ownerNodeId: coordB.getNodeId(),
          ownerLeaseExpiresAt: Date.now() + 10_000,
          timerOwnerNodeId: coordB.getNodeId(),
          timerLeaseExpiresAt: Date.now() + 10_000,
        });
      }

      await waitFor(() =>
        rooms.every((room) => coordA.getRoom(room.roomId)?.ownerNodeId === coordB.getNodeId()),
      );

      recoverTurnTimersFromCoordinator();
      await waitFor(() => rooms.every((room) => timeoutCounts.get(room.roomId) === 1));

      for (let cycle = 0; cycle < restartCycles; cycle++) {
        const expectedCount = cycle + 1;

        for (const room of rooms) {
          const persistedCount =
            coordB.getRoomGameState(room.roomId)?.timeoutCounts?.[room.actorId] ??
            expectedCount - 1;
          coordB.setRoomGameState(room.roomId, {
            match: coordB.getRoomGameState(room.roomId)?.match ?? null,
            lastShowdown: coordB.getRoomGameState(room.roomId)?.lastShowdown ?? null,
            timer: {
              activePlayerId: room.actorId,
              startedAt: Date.now() - 4_000,
              expiresAt: Date.now() - 1_000,
              totalSeconds: 3,
            },
            timeoutCounts: {
              [room.actorId]: persistedCount,
            },
            updatedAt: Date.now(),
            nodeId: coordB.getNodeId(),
          });

          coordB.renewLease(roomOwnerLeaseName(room.roomId), coordB.getNodeId(), 10_000);
          coordB.renewLease(roomTimerLeaseName(room.roomId), coordB.getNodeId(), 10_000);
          coordB.updateRoomOwnership(room.roomId, {
            ownerNodeId: coordB.getNodeId(),
            ownerLeaseExpiresAt: Date.now() + 10_000,
            timerOwnerNodeId: coordB.getNodeId(),
            timerLeaseExpiresAt: Date.now() + 10_000,
          });
        }

        await waitFor(() =>
          rooms.every(
            (room) =>
              coordA.getRoomGameState(room.roomId)?.timeoutCounts?.[room.actorId] === expectedCount,
          ),
        );

        await coordB.disconnect?.();
        _clearAllTimers();
        await coordB.connect?.();

        await waitFor(() =>
          rooms.every((room) => coordB.getRoom(room.roomId)?.ownerNodeId === coordB.getNodeId()),
        );
        recoverTurnTimersFromCoordinator();

        await waitFor(() =>
          rooms.every((room) => timeoutCounts.get(room.roomId) === expectedCount + 1),
        );
        await waitFor(() =>
          rooms.every(
            (room) =>
              coordA.getRoomGameState(room.roomId)?.timeoutCounts?.[room.actorId] ===
              expectedCount + 1,
          ),
        );

        const responses = await Promise.all(
          rooms.map((room) =>
            coordA.requestRoomAction({
              requestId: crypto.randomUUID(),
              targetNodeId: coordB.getNodeId(),
              sourceNodeId: coordA.getNodeId(),
              roomId: room.roomId,
              userId: room.actorId,
              username: room.actorName,
              message: { type: "join_room", roomId: room.roomId },
            }),
          ),
        );

        expect(responses).toHaveLength(roomCount);
        expect(
          responses.every((response, index) => {
            const roomId = rooms[index].roomId;
            return (
              response.messages.length === 1 &&
              (response.messages[0] as { type?: string }).type === "room_joined" &&
              (response.messages[0] as { room?: { id?: string } }).room?.id === roomId
            );
          }),
        ).toBe(true);
      }
    } finally {
      _clearAllTimers();
      await coordA.disconnect().catch(() => undefined);
      await _resetCoordinator().catch(() => undefined);
    }
  }, 30_000);
});
