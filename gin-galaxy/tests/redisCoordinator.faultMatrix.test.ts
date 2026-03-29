/**
 * Redis Coordinator Seeded Fault Matrix.
 *
 * These tests only run when REDIS_URL is provided. They prove that two
 * real production-mode Gin Paradise server processes can survive a
 * deterministic matrix of mixed room topologies, alternating crash
 * orders, survivor-connected sockets, and reconnect-driven recovery.
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

type NodeKey = "A" | "B";
type Role = "creator" | "joiner";

interface PlayerRegistration {
  sessionId: string;
  user: {
    id: string;
    username: string;
  };
}

interface PlayerState {
  registration: PlayerRegistration;
  socket: SocketHarness;
  nodeKey: NodeKey;
  connected: boolean;
}

interface LiveRoomState {
  key: string;
  roomId: string;
  creator: PlayerState;
  joiner: PlayerState;
  activeRole: Role;
}

interface RoomSeed {
  key: string;
  ownerNode: NodeKey;
  joinNode: NodeKey;
  initialTurns: 0 | 1 | 2;
}

interface ScenarioSeed {
  name: string;
  roomSeeds: RoomSeed[];
  crashOrder: NodeKey[];
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for fault-matrix state to propagate");
    }
    await delay(50);
  }
}

function oppositeNode(node: NodeKey): NodeKey {
  return node === "A" ? "B" : "A";
}

function oppositeRole(role: Role): Role {
  return role === "creator" ? "joiner" : "creator";
}

function roomOwnerLeaseName(roomId: string): string {
  return `room:${roomId}:owner`;
}

function roomTimerLeaseName(roomId: string): string {
  return `room:${roomId}:timer`;
}

function getNode(lab: TestLab, node: NodeKey): ServerHandle {
  return node === "A" ? lab.nodeA : lab.nodeB;
}

function getPlayer(room: LiveRoomState, role: Role): PlayerState {
  return role === "creator" ? room.creator : room.joiner;
}

function getActiveUserId(room: LiveRoomState): string {
  return getPlayer(room, room.activeRole).registration.user.id;
}

function getConnectedSockets(rooms: LiveRoomState[]): SocketHarness[] {
  const sockets = new Set<SocketHarness>();
  for (const room of rooms) {
    if (room.creator.connected) {
      sockets.add(room.creator.socket);
    }
    if (room.joiner.connected) {
      sockets.add(room.joiner.socket);
    }
  }
  return Array.from(sockets);
}

function expectNoUnexpectedMessages(rooms: LiveRoomState[]): void {
  for (const socket of getConnectedSockets(rooms)) {
    expect(socket.messages.some((message) => message.type === "room_handoff_required")).toBe(false);
    expect(socket.messages.some((message) => message.type === "error")).toBe(false);
  }
}

async function waitForSocketMessageSince(
  socket: SocketHarness,
  sinceIndex: number,
  predicate: (message: Record<string, any>) => boolean,
  timeoutMs = 15_000,
): Promise<Record<string, any>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const nextMessage = socket.messages.slice(sinceIndex).find(predicate);
    if (nextMessage) {
      return nextMessage;
    }

    if (socket.ws.readyState === socket.ws.CLOSED) {
      throw new Error("Socket closed before the expected fault-matrix message arrived.");
    }

    await delay(50);
  }

  const observed = socket.messages.slice(sinceIndex).map((message) => JSON.stringify(message)).join(", ");
  throw new Error(`Timed out waiting for fault-matrix websocket message. Observed: [${observed}]`);
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

async function waitForRoomRecovery(
  probe: RedisCoordinator,
  room: LiveRoomState,
  ownerNodeId: string,
  timeoutMs = 15_000,
): Promise<void> {
  await waitFor(() => {
    const state = probe.getRoom(room.roomId);
    const snapshot = probe.getRoomGameState(room.roomId);
    return (
      state?.ownerNodeId === ownerNodeId &&
      state?.timerOwnerNodeId === ownerNodeId &&
      snapshot?.timer?.activePlayerId === getActiveUserId(room) &&
      (snapshot?.timer?.expiresAt ?? 0) > Date.now()
    );
  }, timeoutMs);
}

async function waitForRoomLeaseRelease(
  probe: RedisCoordinator,
  roomIds: string[],
  timeoutMs = 25_000,
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

async function waitForPlayerControl(
  room: LiveRoomState,
  role: Role,
  roomId: string,
): Promise<void> {
  const player = getPlayer(room, role);
  const since = player.socket.messages.length;
  if (player.connected) {
    await waitForSocketMessageSince(
      player.socket,
      since,
      (message) =>
        message.type === "game_update" &&
        message.state?.roomId === roomId &&
        message.state?.isMyTurn === true &&
        message.state?.turnTimer?.totalSeconds > 0,
      15_000,
    );
  }
}

async function playStockTurn(
  probe: RedisCoordinator,
  room: LiveRoomState,
): Promise<void> {
  const activeRole = room.activeRole;
  const activePlayer = getPlayer(room, activeRole);
  if (!activePlayer.connected) {
    throw new Error(`Cannot advance room ${room.roomId}; active ${activeRole} is not connected.`);
  }

  const drawSince = activePlayer.socket.messages.length;
  activePlayer.socket.send({ type: "draw", source: "stock" });
  await waitForSocketMessageSince(
    activePlayer.socket,
    drawSince,
    (message) =>
      message.type === "game_update" &&
      message.state?.roomId === room.roomId &&
      message.state?.hasDrawn === true,
    15_000,
  );

  const nextRole = oppositeRole(activeRole);
  const nextPlayer = getPlayer(room, nextRole);
  const nextSince = nextPlayer.connected ? nextPlayer.socket.messages.length : 0;
  const discardSince = activePlayer.socket.messages.length;
  activePlayer.socket.send({ type: "discard", cardIndex: 0 });

  if (nextPlayer.connected) {
    await waitForSocketMessageSince(
      nextPlayer.socket,
      nextSince,
      (message) =>
        message.type === "game_update" &&
        message.state?.roomId === room.roomId &&
        message.state?.isMyTurn === true,
      15_000,
    );
  } else {
    await waitForSocketMessageSince(
      activePlayer.socket,
      discardSince,
      (message) =>
        message.type === "game_update" &&
        message.state?.roomId === room.roomId &&
        message.state?.isMyTurn === false,
      15_000,
    );
  }

  room.activeRole = nextRole;
  await waitForRoomRecovery(probe, room, probe.getRoom(room.roomId)?.ownerNodeId ?? "");
}

async function createLiveRoomFromSeed(
  lab: TestLab,
  seed: RoomSeed,
  expectedReplicaRooms: number,
): Promise<LiveRoomState> {
  const ownerNode = getNode(lab, seed.ownerNode);
  const joinNode = getNode(lab, seed.joinNode);
  const replicaNode = getNode(lab, oppositeNode(seed.ownerNode));

  const creator = await registerUser(ownerNode.baseUrl, `${seed.key}-creator`);
  const joiner = await registerUser(ownerNode.baseUrl, `${seed.key}-joiner`);
  updateRatings(lab.databasePath, [creator.user.id, joiner.user.id], 1500);

  const creatorSocket = await openSocket(ownerNode.baseUrl, creator.sessionId);
  const joinerSocket = await openSocket(joinNode.baseUrl, joiner.sessionId);
  lab.sockets.push(creatorSocket, joinerSocket);

  creatorSocket.send({ type: "create_room" });
  const created = await creatorSocket.waitForMessage((message) => message.type === "room_created");
  await creatorSocket.waitForMessage(
    (message) => message.type === "room_joined" && message.room?.id === created.roomId,
  );

  await waitForHealth(
    replicaNode.baseUrl,
    `room replication for ${seed.key}`,
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

  const room: LiveRoomState = {
    key: seed.key,
    roomId: created.roomId,
    creator: {
      registration: creator,
      socket: creatorSocket,
      nodeKey: seed.ownerNode,
      connected: true,
    },
    joiner: {
      registration: joiner,
      socket: joinerSocket,
      nodeKey: seed.joinNode,
      connected: true,
    },
    activeRole: "creator",
  };

  await waitForRoomRecovery(lab.probe, room, ownerNode.nodeId);

  for (let turn = 0; turn < seed.initialTurns; turn += 1) {
    await playStockTurn(lab.probe, room);
  }

  return room;
}

interface TestLab {
  tempDir: string;
  databasePath: string;
  nodeA: ServerHandle;
  nodeB: ServerHandle;
  probe: RedisCoordinator;
  sockets: SocketHarness[];
  cleanup: () => Promise<void>;
}

async function setupLab(seedName: string): Promise<TestLab> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `gin-paradise-fault-matrix-${seedName}-`));
  const databasePath = path.join(tempDir, "database.sqlite");
  const redisKeyPrefix = `fault-matrix:${seedName}:${crypto.randomUUID()}:`;
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

  const nodeA = await startServer("fault-matrix-node-a", portA, databasePath, redisKeyPrefix, leaseEnv);
  const nodeB = await startServer("fault-matrix-node-b", portB, databasePath, redisKeyPrefix, leaseEnv);
  const probe = new RedisCoordinator({
    url: redisUrl!,
    keyPrefix: redisKeyPrefix,
    nodeId: `probe-${crypto.randomUUID().slice(0, 8)}`,
  });
  await probe.connect();

  const lab: TestLab = {
    tempDir,
    databasePath,
    nodeA,
    nodeB,
    probe,
    sockets: [],
    async cleanup(): Promise<void> {
      await Promise.allSettled(lab.sockets.map((socket) => socket.close()));
      await Promise.allSettled([
        stopServer(lab.nodeA),
        stopServer(lab.nodeB),
        lab.probe.disconnect(),
      ]);
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };

  return lab;
}

function markNodeDisconnected(rooms: LiveRoomState[], node: NodeKey): void {
  for (const room of rooms) {
    if (room.creator.nodeKey === node) {
      room.creator.connected = false;
    }
    if (room.joiner.nodeKey === node) {
      room.joiner.connected = false;
    }
  }
}

async function ensureActivePlayerReady(
  lab: TestLab,
  room: LiveRoomState,
  survivorNode: NodeKey,
): Promise<void> {
  const survivor = getNode(lab, survivorNode);
  const activePlayer = getPlayer(room, room.activeRole);
  const isActiveTurnMessage = (message: Record<string, any>): boolean =>
    message.type === "game_update" &&
    message.state?.roomId === room.roomId &&
    message.state?.isMyTurn === true &&
    message.state?.turnTimer?.totalSeconds > 0;

  if (!activePlayer.connected || activePlayer.nodeKey !== survivorNode) {
    const reconnected = await reconnectUntilJoined(
      survivor.baseUrl,
      activePlayer.registration.sessionId,
      room.roomId,
    );
    lab.sockets.push(reconnected);
    activePlayer.socket = reconnected;
    activePlayer.nodeKey = survivorNode;
    activePlayer.connected = true;

    await waitForRoomRecovery(lab.probe, room, survivor.nodeId);

    await reconnected.waitForMessage(isActiveTurnMessage, 15_000);
    return;
  }

  const since = activePlayer.socket.messages.length;
  await waitForRoomRecovery(lab.probe, room, survivor.nodeId);
  try {
    await waitForSocketMessageSince(activePlayer.socket, since, isActiveTurnMessage, 5_000);
  } catch (error) {
    const existing = [...activePlayer.socket.messages].reverse().find(isActiveTurnMessage);
    if (!existing || activePlayer.socket.ws.readyState !== activePlayer.socket.ws.OPEN) {
      throw error;
    }
  }
}

async function runCrashPhase(
  lab: TestLab,
  rooms: LiveRoomState[],
  crashNode: NodeKey,
): Promise<void> {
  const crashedHandle = getNode(lab, crashNode);
  const survivorNode = oppositeNode(crashNode);
  const survivorHandle = getNode(lab, survivorNode);
  const affectedRooms = rooms.filter(
    (room) => lab.probe.getRoom(room.roomId)?.ownerNodeId === crashedHandle.nodeId,
  );

  await crashServer(crashedHandle);
  markNodeDisconnected(rooms, crashNode);

  await waitForRoomLeaseRelease(
    lab.probe,
    affectedRooms.map((room) => room.roomId),
    25_000,
  );
  await waitForHealth(
    survivorHandle.baseUrl,
    `surviving node ${survivorNode} health`,
    () => true,
    survivorHandle.getLogs,
    (body) =>
      body.status === "healthy" &&
      body.coordinator?.healthy === true &&
      body.coordinator?.nodeId === survivorHandle.nodeId,
  );

  for (const room of affectedRooms) {
    await ensureActivePlayerReady(lab, room, survivorNode);
    await playStockTurn(lab.probe, room);
    await waitForRoomRecovery(lab.probe, room, survivorHandle.nodeId);
  }
}

const SCENARIOS: ScenarioSeed[] = [
  {
    name: "alpha",
    roomSeeds: [
      { key: "alpha-local-a", ownerNode: "A", joinNode: "A", initialTurns: 0 },
      { key: "alpha-split-a", ownerNode: "A", joinNode: "B", initialTurns: 1 },
      { key: "alpha-split-b", ownerNode: "B", joinNode: "A", initialTurns: 1 },
    ],
    crashOrder: ["A", "B"],
  },
  {
    name: "beta",
    roomSeeds: [
      { key: "beta-local-b", ownerNode: "B", joinNode: "B", initialTurns: 0 },
      { key: "beta-split-b", ownerNode: "B", joinNode: "A", initialTurns: 2 },
      { key: "beta-split-a", ownerNode: "A", joinNode: "B", initialTurns: 2 },
    ],
    crashOrder: ["B", "A"],
  },
];

suite("RedisCoordinator seeded fault matrix", () => {
  for (const scenario of SCENARIOS) {
    it(`replays seeded app churn scenario ${scenario.name}`, async () => {
      const lab = await setupLab(scenario.name);

      try {
        const rooms: LiveRoomState[] = [];
        for (let index = 0; index < scenario.roomSeeds.length; index += 1) {
          rooms.push(await createLiveRoomFromSeed(lab, scenario.roomSeeds[index], index + 1));
        }

        for (let phaseIndex = 0; phaseIndex < scenario.crashOrder.length; phaseIndex += 1) {
          const crashNode = scenario.crashOrder[phaseIndex];
          await runCrashPhase(lab, rooms, crashNode);

          if (phaseIndex < scenario.crashOrder.length - 1) {
            if (crashNode === "A") {
              lab.nodeA = await restartServer(lab.nodeA);
            } else {
              lab.nodeB = await restartServer(lab.nodeB);
            }
          }
        }

        expectNoUnexpectedMessages(rooms);
      } finally {
        await lab.cleanup();
      }
    }, 240_000);
  }
});
