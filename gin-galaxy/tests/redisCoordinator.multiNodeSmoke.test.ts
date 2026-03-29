/**
 * Redis Coordinator Multi-Node Smoke Test.
 *
 * These tests only run when REDIS_URL is provided. They prove that two
 * real production-mode Gin Paradise server processes can cooperate through
 * Redis across the HTTP, WebSocket, and room relay paths.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  delay,
  registerUser,
  startServer,
  stopServer,
  updateRatings,
  openSocket,
  reservePort,
  waitForHealth,
} from "./redisAppHarness.js";
const redisUrl = process.env.REDIS_URL;
const runRedisIntegration = !!redisUrl;

const suite = runRedisIntegration ? describe : describe.skip;

suite("RedisCoordinator multi-node smoke proof", () => {
  it("relays room joins and live actions across two app processes", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gin-paradise-multinode-"));
    const databasePath = path.join(tempDir, "database.sqlite");
    const redisKeyPrefix = `smoke:${crypto.randomUUID()}:`;
    const portA = await reservePort();
    let portB = await reservePort();
    while (portB === portA) {
      portB = await reservePort();
    }
    const nodeA = await startServer("smoke-node-a", portA, databasePath, redisKeyPrefix);
    const nodeB = await startServer("smoke-node-b", portB, databasePath, redisKeyPrefix);

    const alice = await registerUser(nodeA.baseUrl, "alice");
    const bob = await registerUser(nodeA.baseUrl, "bob");
    updateRatings(databasePath, [alice.user.id, bob.user.id], 1500);

    const aliceSocket = await openSocket(nodeA.baseUrl, alice.sessionId);
    const bobSocket = await openSocket(nodeB.baseUrl, bob.sessionId);

    try {
      const healthA = await waitForHealth(
        nodeA.baseUrl,
        "health node A",
        () => true,
        nodeA.getLogs,
        (body) =>
          body.deployment?.coordinatorMode === "redis" &&
          body.deployment?.liveRoomRouting === "multi_node_relay" &&
          body.coordinator?.nodeId === "smoke-node-a",
      );
      const healthB = await waitForHealth(
        nodeB.baseUrl,
        "health node B",
        () => true,
        nodeB.getLogs,
        (body) =>
          body.deployment?.coordinatorMode === "redis" &&
          body.deployment?.liveRoomRouting === "multi_node_relay" &&
          body.coordinator?.nodeId === "smoke-node-b",
      );

      expect(healthA.coordinator?.nodeId).toBe("smoke-node-a");
      expect(healthB.coordinator?.nodeId).toBe("smoke-node-b");
      expect(healthA.coordinator?.nodeId).not.toBe(healthB.coordinator?.nodeId);

      aliceSocket.send({ type: "create_room" });
      const created = await aliceSocket.waitForMessage((message) => message.type === "room_created");
      const roomJoined = await aliceSocket.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
      );

      expect(created.roomId).toMatch(/^[A-Z0-9]{6}$/);
      expect(roomJoined.room?.id).toBe(created.roomId);

      await waitForHealth(
        nodeB.baseUrl,
        "room replication on node B",
        () => true,
        nodeB.getLogs,
        (body) => (body.coordinator?.rooms ?? 0) >= 1,
      );

      bobSocket.send({ type: "join_room", roomId: created.roomId });
      const bobRoomJoined = await bobSocket.waitForMessage(
        (message) => message.type === "room_joined" && message.room?.id === created.roomId,
      );
      const aliceOpponentJoined = await aliceSocket.waitForMessage(
        (message) => message.type === "opponent_joined" && message.opponent?.userId === bob.user.id,
      );
      await waitForHealth(
        nodeB.baseUrl,
        "node B live match sync",
        () => true,
        nodeB.getLogs,
        (body) =>
          (body.coordinator?.rooms ?? 0) >= 1 &&
          (body.coordinator?.players ?? 0) >= 2 &&
          (body.coordinator?.snapshots ?? 0) >= 1,
      );

      expect(bobRoomJoined.room?.status).toBe("waiting");
      expect(aliceOpponentJoined.opponent?.username).toContain("bob_");
      expect(
        [...aliceSocket.messages, ...bobSocket.messages].some((message) => message.type === "room_handoff_required"),
      ).toBe(false);

      await delay(500);

      aliceSocket.send({ type: "draw", source: "stock" });
      const aliceAfterDraw = await aliceSocket.waitForMessage(
        (message) => message.type === "game_update" && message.state?.roomId === created.roomId && message.state?.hasDrawn === true,
      );
      expect(aliceAfterDraw.state?.isMyTurn).toBe(true);

      aliceSocket.send({ type: "discard", cardIndex: 0 });
      const bobTurnStarted = await bobSocket.waitForMessage(
        (message) => message.type === "game_update" && message.state?.roomId === created.roomId && message.state?.isMyTurn === true,
      );
      expect(bobTurnStarted.state?.isMyTurn).toBe(true);

      bobSocket.send({ type: "draw", source: "stock" });
      const bobAfterDraw = await bobSocket.waitForMessage(
        (message) => message.type === "game_update" && message.state?.roomId === created.roomId && message.state?.hasDrawn === true,
      );
      expect(bobAfterDraw.state?.isMyTurn).toBe(true);

      bobSocket.send({ type: "discard", cardIndex: 0 });
      const aliceTurnResumed = await aliceSocket.waitForMessage(
        (message) => message.type === "game_update" && message.state?.roomId === created.roomId && message.state?.isMyTurn === true,
      );
      expect(aliceTurnResumed.state?.isMyTurn).toBe(true);

      expect(
        [...aliceSocket.messages, ...bobSocket.messages].some((message) => message.type === "room_handoff_required"),
      ).toBe(false);
      expect(
        [...aliceSocket.messages, ...bobSocket.messages].some((message) => message.type === "error"),
      ).toBe(false);
    } finally {
      await Promise.allSettled([
        aliceSocket.close(),
        bobSocket.close(),
      ]);
      await Promise.allSettled([
        stopServer(nodeA),
        stopServer(nodeB),
      ]);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 120_000);
});
