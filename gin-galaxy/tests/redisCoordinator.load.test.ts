/**
 * Redis Coordinator Load / Soak Tests.
 *
 * These tests only run when REDIS_URL is provided. They provide a bounded
 * proof that the coordinator path survives concurrent relay bursts and lease
 * reclamation pressure without losing responses or ownership handoff.
 */

import crypto from "crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RedisCoordinator } from "../server/multiplayer/redisCoordinator.js";

const redisUrl = process.env.REDIS_URL;
const runRedisIntegration = !!redisUrl;

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for Redis load-test state to propagate");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const suite = runRedisIntegration ? describe : describe.skip;

suite("RedisCoordinator load proof", () => {
  let coordA: RedisCoordinator;
  let coordB: RedisCoordinator;
  let keyPrefix: string;

  beforeEach(async () => {
    keyPrefix = `load:${crypto.randomUUID()}:`;
    coordA = new RedisCoordinator({ url: redisUrl!, keyPrefix });
    coordB = new RedisCoordinator({ url: redisUrl!, keyPrefix });
    await coordA.connect();
    await coordB.connect();
  });

  afterEach(async () => {
    await coordA.disconnect();
    await coordB.disconnect();
  });

  it("keeps a burst of relayed room actions moving across instances", async () => {
    const relayCount = 24;
    const seenRequests = new Set<string>();

    coordB.subscribe((event) => {
      if (event.type !== "relay_room_action_requested") {
        return;
      }

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

      seenRequests.add(request.requestId);
      coordB.completeRoomAction({
        requestId: request.requestId,
        targetNodeId: request.sourceNodeId,
        sourceNodeId: request.targetNodeId,
        roomId: request.roomId,
        userId: request.userId,
        messages: [{ type: "room_joined", room: { id: request.roomId } }],
      });
    });

    const responses = await Promise.all(Array.from({ length: relayCount }, (_, index) => {
      const roomId = `ROOMLOAD-${index}`;
      return coordA.requestRoomAction({
        requestId: crypto.randomUUID(),
        targetNodeId: coordB.getNodeId(),
        sourceNodeId: coordA.getNodeId(),
        roomId,
        userId: `u${index}`,
        username: `User${index}`,
        message: { type: "join_room", roomId },
      });
    }));

    await waitFor(() => seenRequests.size === relayCount);
    expect(responses).toHaveLength(relayCount);
    expect(responses.every((response) => response.messages.length === 1)).toBe(true);
    expect(
      responses.every((response, index) => {
        const roomId = `ROOMLOAD-${index}`;
        return response.messages[0] != null && (response.messages[0] as { type?: string }).type === "room_joined" &&
          (response.messages[0] as { room?: { id?: string } }).room?.id === roomId;
      })
    ).toBe(true);
  });

  it("reclaims a burst of expired leases on a successor node", async () => {
    const leaseCount = 16;
    const ownerId = coordA.getNodeId();
    const successorId = coordB.getNodeId();
    const leaseNames = Array.from({ length: leaseCount }, (_, index) => `room:LOAD-${index}:owner`);

    for (const leaseName of leaseNames) {
      expect(coordA.claimLease(leaseName, ownerId, 150)).toBe(true);
    }

    await waitFor(() => leaseNames.every((leaseName) => coordB.getLease(leaseName)?.ownerId === ownerId));

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(leaseNames.every((leaseName) => coordB.getLease(leaseName) === undefined)).toBe(true);

    const reclaimed = await Promise.all(
      leaseNames.map((leaseName) => coordB.claimLease(leaseName, successorId, 10_000))
    );
    expect(reclaimed.every(Boolean)).toBe(true);

    await waitFor(() => leaseNames.every((leaseName) => coordA.getLease(leaseName)?.ownerId === successorId));
  });
});
