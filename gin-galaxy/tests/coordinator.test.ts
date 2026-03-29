/**
 * Coordinator Contract Tests.
 *
 * Verifies that the RealtimeCoordinator interface implementations
 * behave correctly for all coordination operations. These tests run
 * against both MemoryCoordinator and RedisCoordinator. Redis coverage is
 * gated by REDIS_URL so the live contract can be exercised when available.
 *
 * Also covers: factory instantiation, config validation, startup healthcheck,
 * room lifecycle, player membership, spectator tracking, and diagnostics.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryCoordinator } from "../server/multiplayer/memoryCoordinator.js";
import { RedisCoordinator } from "../server/multiplayer/redisCoordinator.js";
import type { RealtimeCoordinator, CoordinatorRoom } from "../server/multiplayer/coordinator.js";
import {
  createCoordinator,
  validateCoordinator,
  _resetCoordinator,
  initCoordinator,
  getCoordinator,
} from "../server/multiplayer/coordinatorFactory.js";

const redisUrl = process.env.REDIS_URL;
const runRedisTests = !!redisUrl && process.env.RUN_REDIS_TESTS !== "0";

// ── Shared contract test suite ───────────────────────────────────────

function coordinatorContractTests(name: string, factory: () => RealtimeCoordinator) {
  describe(`${name} — contract`, () => {
    let coord: RealtimeCoordinator;

    beforeEach(async () => {
      coord = factory();
      if (coord.connect) {
        await coord.connect();
      }
    });

    afterEach(async () => {
      if (coord.disconnect) {
        await coord.disconnect();
      }
    });

    // ── Room Registry ────────────────────────────────────────

    it("creates and retrieves a room", () => {
      const room: CoordinatorRoom = {
        id: "ROOM01",
        hostId: "user1",
        players: new Map(),
        status: "waiting",
        createdAt: Date.now(),
        stakeId: "free",
      };
      coord.createRoom(room);
      expect(coord.hasRoom("ROOM01")).toBe(true);
      expect(coord.getRoom("ROOM01")).toBeDefined();
      expect(coord.getRoom("ROOM01")!.hostId).toBe("user1");
    });

    it("returns undefined for non-existent room", () => {
      expect(coord.getRoom("NOPE")).toBeUndefined();
      expect(coord.hasRoom("NOPE")).toBe(false);
    });

    it("deletes a room", () => {
      coord.createRoom({ id: "R1", hostId: "u1", players: new Map(), status: "waiting", createdAt: Date.now(), stakeId: "free" });
      coord.deleteRoom("R1");
      expect(coord.hasRoom("R1")).toBe(false);
    });

    it("counts rooms", () => {
      expect(coord.getRoomCount()).toBe(0);
      coord.createRoom({ id: "R1", hostId: "u1", players: new Map(), status: "waiting", createdAt: Date.now(), stakeId: "free" });
      coord.createRoom({ id: "R2", hostId: "u2", players: new Map(), status: "waiting", createdAt: Date.now(), stakeId: "free" });
      expect(coord.getRoomCount()).toBe(2);
    });

    it("iterates over all rooms", () => {
      coord.createRoom({ id: "R1", hostId: "u1", players: new Map(), status: "waiting", createdAt: Date.now(), stakeId: "free" });
      coord.createRoom({ id: "R2", hostId: "u2", players: new Map(), status: "waiting", createdAt: Date.now(), stakeId: "free" });
      const ids: string[] = [];
      for (const [id] of coord.getAllRooms()) {
        ids.push(id);
      }
      expect(ids).toContain("R1");
      expect(ids).toContain("R2");
    });

    // ── Player-to-Room Membership ────────────────────────────

    it("maps player to room", () => {
      coord.setPlayerRoom("user1", "ROOM01");
      expect(coord.getPlayerRoom("user1")).toBe("ROOM01");
      expect(coord.hasPlayerRoom("user1")).toBe(true);
    });

    it("removes player room mapping", () => {
      coord.setPlayerRoom("user1", "ROOM01");
      coord.removePlayerRoom("user1");
      expect(coord.getPlayerRoom("user1")).toBeUndefined();
      expect(coord.hasPlayerRoom("user1")).toBe(false);
    });

    // ── Room Player Management ───────────────────────────────

    it("adds and retrieves players in a room", () => {
      coord.createRoom({ id: "R1", hostId: "u1", players: new Map(), status: "waiting", createdAt: Date.now(), stakeId: "free" });
      coord.setRoomPlayer("R1", { userId: "u1", username: "Alice", ws: null, connected: true });
      coord.setRoomPlayer("R1", { userId: "u2", username: "Bob", ws: null, connected: true });

      expect(coord.getRoomPlayerCount("R1")).toBe(2);
      expect(coord.isPlayerInRoom("R1", "u1")).toBe(true);
      expect(coord.getRoomPlayer("R1", "u1")!.username).toBe("Alice");

      const players = coord.getRoomPlayers("R1");
      expect(players.length).toBe(2);
    });

    it("removes a player from a room", () => {
      coord.createRoom({ id: "R1", hostId: "u1", players: new Map(), status: "waiting", createdAt: Date.now(), stakeId: "free" });
      coord.setRoomPlayer("R1", { userId: "u1", username: "Alice", ws: null, connected: true });
      coord.removeRoomPlayer("R1", "u1");
      expect(coord.isPlayerInRoom("R1", "u1")).toBe(false);
      expect(coord.getRoomPlayerCount("R1")).toBe(0);
    });

    // ── Room Status ──────────────────────────────────────────

    it("updates room status via coordinator", () => {
      coord.createRoom({ id: "R1", hostId: "u1", players: new Map(), status: "waiting", createdAt: Date.now(), stakeId: "free" });
      coord.setRoomStatus("R1", "playing");
      expect(coord.getRoom("R1")!.status).toBe("playing");
      coord.setRoomStatus("R1", "finished");
      expect(coord.getRoom("R1")!.status).toBe("finished");
    });

    it("updates room ownership metadata via coordinator", () => {
      const now = Date.now();
      coord.createRoom({ id: "R1", hostId: "u1", players: new Map(), status: "waiting", createdAt: now, stakeId: "free" });
      coord.updateRoomOwnership("R1", {
        ownerNodeId: coord.getNodeId(),
        ownerLeaseExpiresAt: now + 10_000,
        timerOwnerNodeId: coord.getNodeId(),
        timerLeaseExpiresAt: now + 5_000,
      });

      expect(coord.getRoom("R1")).toMatchObject({
        ownerNodeId: coord.getNodeId(),
        ownerLeaseExpiresAt: now + 10_000,
        timerOwnerNodeId: coord.getNodeId(),
        timerLeaseExpiresAt: now + 5_000,
      });

      coord.updateRoomOwnership("R1", {
        ownerNodeId: undefined,
        ownerLeaseExpiresAt: undefined,
        timerOwnerNodeId: undefined,
        timerLeaseExpiresAt: undefined,
      });

      const room = coord.getRoom("R1")!;
      expect(room.ownerNodeId).toBeUndefined();
      expect(room.ownerLeaseExpiresAt).toBeUndefined();
      expect(room.timerOwnerNodeId).toBeUndefined();
      expect(room.timerLeaseExpiresAt).toBeUndefined();
    });

    it("relays room actions through the coordinator", async () => {
      const events: string[] = [];
      coord.subscribe((event) => {
        events.push(event.type);
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

        coord.completeRoomAction({
          requestId: request.requestId,
          targetNodeId: request.sourceNodeId,
          sourceNodeId: request.targetNodeId,
          roomId: request.roomId,
          userId: request.userId,
          messages: [{ type: "room_joined", room: { id: request.roomId } }],
        });
      });

      const response = await coord.requestRoomAction({
        requestId: "relay-local",
        targetNodeId: coord.getNodeId(),
        sourceNodeId: "source-node",
        roomId: "R1",
        userId: "u1",
        username: "Alice",
        message: { type: "join_room", roomId: "R1" },
      });

      expect(events).toContain("relay_room_action_requested");
      expect(events).toContain("relay_room_action_completed");
      expect(response.messages).toEqual([{ type: "room_joined", room: { id: "R1" } }]);
    });

    it("delivers node messages through the coordinator", () => {
      const events: string[] = [];
      coord.subscribe((event) => {
        if (event.type === "relay_node_message") {
          events.push(event.type);
        }
      });

      coord.deliverNodeMessage({
        targetNodeId: coord.getNodeId(),
        sourceNodeId: "source-node",
        roomId: "R1",
        userId: "u1",
        message: { type: "game_update" },
      });

      expect(events).toContain("relay_node_message");
    });

    // ── Live Match Snapshots ─────────────────────────────────

    it("stores and retrieves a live match snapshot", () => {
      const snapshot = {
        match: {
          roomId: "R1",
          status: "playing",
          currentPlayerIndex: 0,
          roundNumber: 1,
        },
        lastShowdown: {
          knockOutcome: "knock",
          roundWinnerUsername: "Alice",
        },
        updatedAt: Date.now(),
        nodeId: coord.getNodeId(),
      };

      coord.setRoomGameState("R1", snapshot);

      expect(coord.getRoomGameState("R1")).toMatchObject({
        match: { roomId: "R1", status: "playing" },
        lastShowdown: { knockOutcome: "knock" },
      });
      expect((coord.getDiagnostics().details as any).roomGameSnapshotCount).toBe(1);
    });

    it("stores and retrieves a live match snapshot with timer recovery metadata", () => {
      const now = Date.now();
      const snapshot = {
        match: {
          roomId: "R1",
          status: "playing",
          currentPlayerIndex: 1,
          roundNumber: 2,
        },
        lastShowdown: null,
        timer: {
          activePlayerId: "u2",
          startedAt: now - 12_000,
          expiresAt: now + 18_000,
          totalSeconds: 30,
        },
        timeoutCounts: {
          u1: 1,
          u2: 2,
        },
        updatedAt: now,
        nodeId: coord.getNodeId(),
      };

      coord.setRoomGameState("R1", snapshot);

      expect(coord.getRoomGameState("R1")).toMatchObject({
        match: { roomId: "R1", status: "playing" },
        timer: {
          activePlayerId: "u2",
          totalSeconds: 30,
        },
        timeoutCounts: {
          u1: 1,
          u2: 2,
        },
      });
    });

    it("clears a live match snapshot explicitly", () => {
      coord.setRoomGameState("R1", {
        match: { roomId: "R1", status: "playing" },
        lastShowdown: null,
        updatedAt: Date.now(),
        nodeId: coord.getNodeId(),
      });
      coord.clearRoomGameState("R1");
      expect(coord.getRoomGameState("R1")).toBeUndefined();
    });

    it("clears live match snapshots when a room is deleted", () => {
      coord.createRoom({ id: "R1", hostId: "u1", players: new Map(), status: "waiting", createdAt: Date.now(), stakeId: "free" });
      coord.setRoomGameState("R1", {
        match: { roomId: "R1", status: "game_over" },
        lastShowdown: { knockOutcome: "gin" },
        updatedAt: Date.now(),
        nodeId: coord.getNodeId(),
      });

      coord.deleteRoom("R1");

      expect(coord.getRoomGameState("R1")).toBeUndefined();
    });

    // ── Spectator Connections ────────────────────────────────

    it("tracks spectator connections", () => {
      const mockWs = {} as any;
      coord.setSpectatorConnection("spec1", { ws: mockWs, roomId: "R1" });
      expect(coord.hasSpectatorConnection("spec1")).toBe(true);
      expect(coord.getSpectatorConnection("spec1")!.roomId).toBe("R1");
    });

    it("removes spectator connections", () => {
      const mockWs = {} as any;
      coord.setSpectatorConnection("spec1", { ws: mockWs, roomId: "R1" });
      coord.removeSpectatorConnection("spec1");
      expect(coord.hasSpectatorConnection("spec1")).toBe(false);
    });

    // ── Diagnostics ──────────────────────────────────────────

    it("reports healthy", () => {
      expect(coord.isHealthy()).toBe(true);
    });

    it("returns diagnostic info", () => {
      coord.createRoom({ id: "R1", hostId: "u1", players: new Map(), status: "waiting", createdAt: Date.now(), stakeId: "free" });
      coord.setPlayerRoom("u1", "R1");

      const diag = coord.getDiagnostics();
      expect(diag.healthy).toBe(true);
      expect(diag.roomCount).toBe(1);
      expect(diag.playerMappingCount).toBe(1);
      expect(diag.uptimeMs).toBeGreaterThanOrEqual(0);
    });
  });
}

// ── Run contract tests for both implementations ──────────────────────

coordinatorContractTests("MemoryCoordinator", () => new MemoryCoordinator());
if (runRedisTests) {
  coordinatorContractTests("RedisCoordinator", () => new RedisCoordinator({
    url: redisUrl!,
    keyPrefix: "test:",
  }));
}

// ── Factory Tests ────────────────────────────────────────────────────

describe("CoordinatorFactory", () => {
  beforeEach(async () => {
    await _resetCoordinator();
  });

  afterEach(async () => {
    await _resetCoordinator();
  });

  it("creates memory coordinator by default", () => {
    const coord = createCoordinator({ mode: "memory" });
    expect(coord.mode).toBe("memory");
    expect(coord.isHealthy()).toBe(true);
  });

  it("uses a provided node id for memory coordinator", () => {
    const coord = createCoordinator({ mode: "memory", nodeId: "memory-alpha" });
    expect(coord.getNodeId()).toBe("memory-alpha");
  });

  it("creates redis coordinator with config", () => {
    const coord = createCoordinator({
      mode: "redis",
      nodeId: "redis-alpha",
      redis: { url: "redis://localhost:6379", keyPrefix: "test:" },
    });
    expect(coord.mode).toBe("redis");
    expect(coord.getNodeId()).toBe("redis-alpha");
  });

  it("throws for redis mode without redis config", () => {
    expect(() => createCoordinator({ mode: "redis" })).toThrow();
  });

  it("validates healthy coordinator", () => {
    const coord = createCoordinator({ mode: "memory" });
    expect(() => validateCoordinator(coord)).not.toThrow();
  });

  it("initCoordinator creates singleton, getCoordinator retrieves it", async () => {
    await initCoordinator({ mode: "memory" });
    const coord = getCoordinator();
    expect(coord.mode).toBe("memory");
  });

  it("getCoordinator throws before init", () => {
    expect(() => getCoordinator()).toThrow(/not initialized/);
  });

  // ── Room lifecycle through coordinator ───────────────────

  it("full room lifecycle through coordinator", async () => {
    const coord = await initCoordinator({ mode: "memory" });

    // Create room
    coord.createRoom({
      id: "TEST01",
      hostId: "host1",
      players: new Map(),
      status: "waiting",
      createdAt: Date.now(),
      stakeId: "gold_500",
    });

    // Add players
    coord.setRoomPlayer("TEST01", { userId: "host1", username: "Host", ws: null, connected: true });
    coord.setRoomPlayer("TEST01", { userId: "p2", username: "Challenger", ws: null, connected: true });
    coord.setPlayerRoom("host1", "TEST01");
    coord.setPlayerRoom("p2", "TEST01");

    expect(coord.getRoomPlayerCount("TEST01")).toBe(2);
    expect(coord.getPlayerRoom("host1")).toBe("TEST01");

    // Status transition
    coord.setRoomStatus("TEST01", "playing");
    expect(coord.getRoom("TEST01")!.status).toBe("playing");

    // Cleanup
    coord.removePlayerRoom("host1");
    coord.removePlayerRoom("p2");
    coord.deleteRoom("TEST01");

    expect(coord.hasRoom("TEST01")).toBe(false);
    expect(coord.hasPlayerRoom("host1")).toBe(false);
  });

  // ── Reconnect semantics ────────────────────────────────────

  it("player reconnect updates connection state without losing room membership", async () => {
    const coord = await initCoordinator({ mode: "memory" });
    coord.createRoom({ id: "R1", hostId: "u1", players: new Map(), status: "playing", createdAt: Date.now(), stakeId: "free" });
    coord.setRoomPlayer("R1", { userId: "u1", username: "Alice", ws: null, connected: true });
    coord.setPlayerRoom("u1", "R1");

    // Simulate disconnect
    const player = coord.getRoomPlayer("R1", "u1")!;
    player.ws = null;
    player.connected = false;
    coord.setRoomPlayer("R1", player);

    expect(coord.getRoomPlayer("R1", "u1")!.connected).toBe(false);
    expect(coord.getPlayerRoom("u1")).toBe("R1"); // membership preserved

    // Simulate reconnect
    const newWs = {} as any;
    player.ws = newWs;
    player.connected = true;
    coord.setRoomPlayer("R1", player);

    expect(coord.getRoomPlayer("R1", "u1")!.connected).toBe(true);
    expect(coord.getPlayerRoom("u1")).toBe("R1"); // still mapped
  });
});
