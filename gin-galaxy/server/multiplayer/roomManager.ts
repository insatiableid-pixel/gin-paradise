/**
 * Multiplayer Room Manager & WebSocket handler.
 *
 * Responsibilities:
 *  - Room lifecycle (create / join / leave / cleanup)
 *  - Session-authenticated WebSocket upgrade
 *  - Message routing to the server-side game engine
 *  - Player-filtered state broadcast
 *  - Disconnect / forfeit handling
 *  - Matchmaking queue integration
 *  - Server-enforced turn timers (60s per turn, auto-forfeit after 3 timeouts)
 *  - Match transcript recording for every multiplayer game
 *
 * Coordination boundary:
 *  All room/player/spectator state is accessed through the RealtimeCoordinator
 *  interface, not through direct process-local Maps. The coordinator implementation
 *  is selected at startup (memory for dev/single-instance, redis for multi-instance).
 *  Game engine state (MatchState, lastShowdown) remains local to this module.
 */

import crypto from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { Server as HttpServer } from "http";
import type { IncomingMessage } from "http";
import { db } from "../db.js";
import { observeCoordinatorCommit } from "../observability.js";
import { consumeWebSocketTicket } from "../websocketTickets.js";
import {
  createMatchWithDeck,
  getPlayerView,
  handleDraw,
  handleDiscard,
  handleKnock,
  handleNextRound,
  type MatchState,
  type Card,
} from "./engine.js";
import type {
  ClientMessage,
  ServerMessage,
  RoomPlayer,
  CardView,
  ShowdownData,
  FairnessStatusInfo,
  SpectatorGameViewWire,
} from "./types.js";
import {
  getSpectatorView,
  getFeaturedReasons,
  isSpectatable,
  addSpectator,
  removeSpectator,
  getSpectatorCount,
  getRoomSpectatorIds,
  cleanupSpectators,
  initBroadcastStats,
  persistBroadcastMetrics,
  cleanupBroadcastStats,
  getLiveBroadcastStats,
  isAdminFeatured,
  getPlayerSpectatePreference,
  type FeaturedMatch,
  type LiveMatchInfo,
} from "./spectator.js";
import {
  initMatchFairness,
  createRoundCommitment,
  revealRoundSeed,
  getSerializableFairnessData,
  cleanupFairness,
  submitClientSeed,
  getClientSeeds,
  getRoundProof,
} from "./fairness.js";
import {
  joinQueue,
  leaveQueue,
  isInQueue,
  getQueueSize,
  setMatchFoundCallback,
  handleDisconnect as handleQueueDisconnect,
  type QueueEntry,
} from "./matchmaking.js";
import {
  startTurnTimer,
  cancelTurnTimer,
  resetTimeoutCount,
  getTurnTimerInfo,
  getTurnTimerSnapshot,
  cleanupRoomTimers,
  suspendRoomTimersForShutdown,
  setTurnTimeoutCallback,
  setRoomTimerSpeed,
  recoverTurnTimerForRoom,
  recoverTurnTimersFromCoordinator,
  MAX_CONSECUTIVE_TIMEOUTS,
} from "./turnTimer.js";
import {
  createTranscript,
  recordRoundStart,
  recordDraw,
  recordDiscard,
  recordKnockOutcome,
  finalizeTranscript,
  recordTimeout,
  recordDisconnect,
  recordForfeit,
  addAction,
  getTranscript,
} from "./transcript.js";
import {
  checkBalance,
  holdEntryFee,
  initRoomEscrow,
  settleMatch,
  refundEscrow,
  getRoomEscrow,
  cleanupEscrow,
  getStakePreset,
  isFreeStake,
  reconcileOrphanedEscrows,
} from "../escrow.js";
import {
  advanceBracket,
  registerTournamentRoom,
  getTournament,
  getTournamentForRoom,
  type BracketMatch,
} from "../tournament.js";
import {
  setAvailabilityCallback,
  type PlayerAvailability,
} from "../social.js";
import { getCoordinator } from "./coordinatorFactory.js";
import type {
  RealtimeCoordinator,
  CoordinatorGameStateSnapshot,
  CoordinatorPlayer,
  CoordinatorEvent,
  CoordinatorRoomActionRequest,
  CoordinatorNodeMessageDelivery,
  CoordinatorSpectatorConnection,
} from "./coordinator.js";
import {
  buildRoomHandoffHint,
  canServeRoomLocally,
  type RoomAffinityAction,
  type RoomAffinityRoom,
} from "./roomAffinity.js";

// ── Game-engine state (local to this module, not coordinator concerns) ─

/** Extended room state: coordinator data + game engine state */
interface RoomState {
  id: string;
  hostId: string;
  players: Map<string, CoordinatorPlayer>;
  match: MatchState | null;
  status: "waiting" | "playing" | "finished";
  createdAt: number;
  stakeId: string;
  lastShowdown: ShowdownData | null;
  ownerNodeId?: string;
  ownerLeaseExpiresAt?: number;
  timerOwnerNodeId?: string;
  timerLeaseExpiresAt?: number;
}

/**
 * Game-engine state that lives alongside coordinator-managed room data.
 * MatchState and lastShowdown are not coordinator concerns — they are
 * game-engine data that the roomManager owns.
 */
type RoomGameState = {
  match: MatchState | null;
  lastShowdown: ShowdownData | null;
  updatedAt: number;
};

interface RelayCaptureWebSocket extends WebSocket {
  relayNodeId?: string;
}

const roomGameState = new Map<string, RoomGameState>();
let shuttingDown = false;

// ── Coordinator-backed accessors ─────────────────────────────────────
// These provide backward-compatible access patterns while routing through
// the coordinator boundary. The 'rooms', 'playerToRoom', and
// 'spectatorConnections' names are kept for minimal diff.

function _coord(): RealtimeCoordinator {
  return getCoordinator();
}

function currentNodeId(): string {
  return _coord().getNodeId();
}

function connectionNodeId(ws: WebSocket | null | undefined): string {
  return (ws as RelayCaptureWebSocket | undefined)?.relayNodeId ?? currentNodeId();
}

function createPlayerConnection(player: Pick<CoordinatorPlayer, "userId" | "username">, ws: WebSocket | null, connected: boolean): CoordinatorPlayer {
  return {
    userId: player.userId,
    username: player.username,
    ws,
    connected,
    nodeId: connectionNodeId(ws),
    lastSeenAt: Date.now(),
  };
}

function canServeRoom(room: RoomAffinityRoom): boolean {
  const nodeId = currentNodeId();
  const lease = _coord().getLease(roomOwnerLeaseName(room.id));
  let effectiveOwnerNodeId = room.ownerNodeId;
  let effectiveOwnerLeaseExpiresAt = room.ownerLeaseExpiresAt;

  if (lease) {
    effectiveOwnerNodeId = lease.ownerId;
    effectiveOwnerLeaseExpiresAt = lease.expiresAt;
    if (
      room.ownerNodeId !== effectiveOwnerNodeId ||
      room.ownerLeaseExpiresAt !== effectiveOwnerLeaseExpiresAt
    ) {
      _coord().updateRoomOwnership(room.id, {
        ownerNodeId: effectiveOwnerNodeId,
        ownerLeaseExpiresAt: effectiveOwnerLeaseExpiresAt,
      });
    }
  } else if (
    room.ownerNodeId &&
    room.ownerLeaseExpiresAt != null &&
    room.ownerLeaseExpiresAt > Date.now()
  ) {
    effectiveOwnerNodeId = undefined;
    effectiveOwnerLeaseExpiresAt = undefined;
    _coord().updateRoomOwnership(room.id, {
      ownerNodeId: undefined,
      ownerLeaseExpiresAt: undefined,
    });
  }

  if (!effectiveOwnerNodeId) {
    return adoptRoomOwnership(room);
  }

  if (effectiveOwnerNodeId === nodeId) {
    return true;
  }

  if (!lease && adoptRoomOwnership(room)) {
    return true;
  }

  if (
    !canServeRoomLocally(
      {
        ...room,
        ownerNodeId: effectiveOwnerNodeId,
        ownerLeaseExpiresAt: effectiveOwnerLeaseExpiresAt,
      },
      nodeId,
    )
  ) {
    return false;
  }

  return adoptRoomOwnership(room);
}

function adoptRoomOwnership(room: RoomAffinityRoom): boolean {
  const coord = _coord();
  const ownerNodeId = coord.getNodeId();
  if (!claimRoomOwnership(room.id)) {
    return false;
  }

  coord.updateRoomOwnership(room.id, {
    ownerNodeId,
    ownerLeaseExpiresAt: Date.now() + ROOM_OWNER_LEASE_TTL,
  });
  recoverTurnTimerForRoom(room.id);

  const localRoom = rooms.get(room.id);
  if (localRoom?.match) {
    broadcastGameState(localRoom);
    broadcastTimerUpdate(localRoom);
  }

  return true;
}

function sendRoomHandoffRequired(ws: WebSocket, room: RoomAffinityRoom, action: RoomAffinityAction): void {
  const hint = buildRoomHandoffHint(room, currentNodeId(), action);
  send(ws, { type: "room_handoff_required", ...hint });
}

function routeRelayNodeMessage(delivery: CoordinatorNodeMessageDelivery): void {
  if (delivery.roomId && delivery.roomGameSnapshot) {
    applyRoomGameSnapshot(delivery.roomId, delivery.roomGameSnapshot);
  }

  const room = delivery.roomId ? rooms.get(delivery.roomId) : (delivery.userId ? rooms.get(playerToRoom.get(delivery.userId) || "") : undefined);
  const userId = delivery.userId;
  if (room && userId) {
    const player = room.players.get(userId);
    if (player && player.nodeId === currentNodeId()) {
      send(player.ws, delivery.message as ServerMessage);
      return;
    }
  }

  if (userId) {
    const spectator = spectatorConnections.get(userId);
    if (spectator?.ws) {
      send(spectator.ws, delivery.message as ServerMessage);
    }
  }
}

function handleRelayCoordinatorEvent(event: CoordinatorEvent): void {
  if (event.type === "lease_released" && event.leaseName) {
    const lostOwnerId = event.payload?.ownerId as string | undefined;
    if (lostOwnerId !== currentNodeId()) return;

    const match = /^room:(.+):(owner|timer)$/.exec(event.leaseName);
    if (!match) return;
    const [, roomId, leaseKind] = match;
    const replacement = event.payload?.replacement as { ownerId: string; expiresAt: number } | null | undefined;
    if (leaseKind === "timer") {
      suspendRoomTimersForShutdown(roomId);
      _coord().updateRoomOwnership(roomId, {
        timerOwnerNodeId: replacement?.ownerId,
        timerLeaseExpiresAt: replacement?.expiresAt,
      });
    } else {
      suspendRoomTimersForShutdown(roomId);
      _coord().updateRoomOwnership(roomId, {
        ownerNodeId: replacement?.ownerId,
        ownerLeaseExpiresAt: replacement?.expiresAt,
      });
    }
    return;
  }

  if (event.type === "relay_node_message") {
    const delivery = event.payload?.delivery as CoordinatorNodeMessageDelivery | undefined;
    if (delivery && delivery.targetNodeId === currentNodeId()) {
      routeRelayNodeMessage(delivery);
    }
    return;
  }

  if (event.type !== "relay_room_action_requested") {
    return;
  }

  const request = event.payload?.request as CoordinatorRoomActionRequest | undefined;
  if (!request || request.targetNodeId !== currentNodeId()) {
    return;
  }

  const captured: ServerMessage[] = [];
  const relayWs = {
    readyState: WebSocket.OPEN,
    relayNodeId: request.sourceNodeId,
    send(data: string) {
      try {
        captured.push(JSON.parse(data.toString()) as ServerMessage);
      } catch {
        // Ignore malformed relay payloads.
      }
    },
  } as RelayCaptureWebSocket;

  void handleMessage(relayWs as unknown as WebSocket, request.userId, request.username, request.message as ClientMessage)
    .then(() => {
      _coord().completeRoomAction({
        requestId: request.requestId,
        targetNodeId: request.sourceNodeId,
        sourceNodeId: request.targetNodeId,
        roomId: request.roomId,
        userId: request.userId,
        messages: captured,
      });
    })
    .catch((err) => {
      _coord().completeRoomAction({
        requestId: request.requestId,
        targetNodeId: request.sourceNodeId,
        sourceNodeId: request.targetNodeId,
        roomId: request.roomId,
        userId: request.userId,
        messages: captured,
        error: err instanceof Error ? err.message : "Relay room action failed.",
      });
    });
}

let relayBridgeNodeId: string | undefined;
let relayBridgeUnsubscribe: (() => void) | undefined;

function ensureRelayBridge(): void {
  const coord = _coord();
  const nodeId = coord.getNodeId();
  if (relayBridgeNodeId === nodeId) {
    return;
  }

  relayBridgeUnsubscribe?.();
  relayBridgeUnsubscribe = coord.subscribe(handleRelayCoordinatorEvent);
  relayBridgeNodeId = nodeId;
}

function relayRoomAction(
  ws: WebSocket,
  room: RoomAffinityRoom,
  userId: string,
  username: string,
  msg: ClientMessage,
  action: RoomAffinityAction,
): boolean {
  if (!room.ownerNodeId || room.ownerNodeId === currentNodeId()) {
    return false;
  }

  const request: CoordinatorRoomActionRequest = {
    requestId: crypto.randomUUID(),
    targetNodeId: room.ownerNodeId,
    sourceNodeId: currentNodeId(),
    roomId: room.id,
    userId,
    username,
    message: msg,
  };

  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) {
      return;
    }
    settled = true;
    sendRoomHandoffRequired(ws, room, action);
  }, 2000);
  timeout.unref?.();

  void _coord().requestRoomAction(request).then((response) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);

    if (response.error) {
      send(ws, { type: "error", message: response.error });
      return;
    }

    for (const message of response.messages) {
      send(ws, message as ServerMessage);
    }

    if (msg.type === "join_room" || msg.type === "join_challenge_room") {
      const localRoom = rooms.get(room.id);
      if (localRoom) {
        localRoom.players.set(userId, createPlayerConnection({ userId, username }, ws, true));
        playerToRoom.set(userId, room.id);
      }
    }
  }).catch(() => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    sendRoomHandoffRequired(ws, room, action);
  });

  return true;
}

function cloneSerializable<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function refreshRoomGameStateFromCoordinator(roomId: string): void {
  const snapshot = _coord().getRoomGameState(roomId);
  if (!snapshot) {
    return;
  }

  applyRoomGameSnapshot(roomId, snapshot);
}

function applyRoomGameSnapshot(roomId: string, snapshot: CoordinatorGameStateSnapshot): void {
  const current = roomGameState.get(roomId);
  const snapshotMatch = snapshot.match ? cloneSerializable(snapshot.match as MatchState) : null;
  const snapshotShowdown = snapshot.lastShowdown ? cloneSerializable(snapshot.lastShowdown as ShowdownData) : null;

  // Equal millisecond timestamps are not ordered; retain the applied state.
  if (!current || snapshot.updatedAt > current.updatedAt) {
    roomGameState.set(roomId, {
      match: snapshotMatch as MatchState | null,
      lastShowdown: snapshotShowdown as ShowdownData | null,
      updatedAt: snapshot.updatedAt,
    });
    return;
  }

  if (!current.match && snapshotMatch) {
    current.match = snapshotMatch as MatchState;
  }

  if (!current.lastShowdown && snapshotShowdown) {
    current.lastShowdown = snapshotShowdown as ShowdownData;
  }
}

function serializeRoomGameState(room: RoomState): CoordinatorGameStateSnapshot {
  return {
    match: room.match ? cloneSerializable(room.match) : null,
    lastShowdown: room.lastShowdown ? cloneSerializable(room.lastShowdown) : null,
    timer: getTurnTimerSnapshot(room.id),
    updatedAt: Date.now(),
    nodeId: _coord().getNodeId(),
  };
}

function buildMergedRoomGameStateSnapshot(room: RoomState): CoordinatorGameStateSnapshot | null {
  if (!room.match && !room.lastShowdown) {
    return null;
  }

  const snapshot = serializeRoomGameState(room);
  const existing = _coord().getRoomGameState(room.id);
  return {
    ...existing,
    ...snapshot,
  };
}

function syncRoomGameState(room: RoomState): void {
  const merged = buildMergedRoomGameStateSnapshot(room);
  if (!merged) {
    return;
  }

  applyRoomGameSnapshot(room.id, merged);
  _coord().setRoomGameState(room.id, merged);
}

async function commitRoomGameStateDurably(room: RoomState): Promise<void> {
  const merged = buildMergedRoomGameStateSnapshot(room);
  if (!merged) {
    return;
  }

  applyRoomGameSnapshot(room.id, merged);
  const startedAt = performance.now();
  let succeeded = false;
  try {
    await _coord().commitRoomGameState(room.id, merged);
    succeeded = true;
  } finally {
    observeCoordinatorCommit(performance.now() - startedAt, succeeded);
  }
}

/** Get a full RoomState (coordinator data + local game state) as a proxy.
 *  Mutations to status propagate to the coordinator; mutations to match/lastShowdown
 *  propagate to the local game-state map. */
function getRoomState(roomId: string): RoomState | undefined {
  const coordRoom = _coord().getRoom(roomId);
  if (!coordRoom) return undefined;
  refreshRoomGameStateFromCoordinator(roomId);
  if (!roomGameState.has(roomId)) {
    roomGameState.set(roomId, {
      match: null,
      lastShowdown: null,
      updatedAt: 0,
    });
  }
  const gs = roomGameState.get(roomId)!;

  // Return a live-linked object so mutations propagate
    return {
      get id() { return coordRoom.id; },
      get hostId() { return coordRoom.hostId; },
      get players() { return coordRoom.players as Map<string, CoordinatorPlayer>; },
      get status() { return coordRoom.status; },
      set status(v) { coordRoom.status = v; _coord().setRoomStatus(coordRoom.id, v); },
      get createdAt() { return coordRoom.createdAt; },
      get stakeId() { return coordRoom.stakeId; },
      get ownerNodeId() { return coordRoom.ownerNodeId; },
      get ownerLeaseExpiresAt() { return coordRoom.ownerLeaseExpiresAt; },
      get timerOwnerNodeId() { return coordRoom.timerOwnerNodeId; },
      get timerLeaseExpiresAt() { return coordRoom.timerLeaseExpiresAt; },
      get match() { return gs.match; },
      set match(v) { gs.match = v; },
      get lastShowdown() { return gs.lastShowdown; },
    set lastShowdown(v) { gs.lastShowdown = v; },
  };
}

// Backward-compat thin wrappers used by exports and legacy patterns
const rooms = {
  get: (id: string) => getRoomState(id),
  has: (id: string) => _coord().hasRoom(id),
  set: (id: string, room: RoomState) => {
    const ownerNodeId = room.ownerNodeId ?? _coord().getNodeId();
    const ownerLeaseExpiresAt = room.ownerLeaseExpiresAt ?? (Date.now() + ROOM_OWNER_LEASE_TTL);
    if (!claimRoomOwnership(room.id)) {
      console.warn(`[roomManager] Could not claim ownership lease for room ${room.id}. Using local room state, but ownership may belong to another node.`);
    }
    _coord().createRoom({
      id: room.id,
      hostId: room.hostId,
      players: room.players,
      status: room.status,
      createdAt: room.createdAt,
      stakeId: room.stakeId,
      ownerNodeId,
      ownerLeaseExpiresAt,
      timerOwnerNodeId: room.timerOwnerNodeId,
      timerLeaseExpiresAt: room.timerLeaseExpiresAt,
    });
    syncRoomGameState(room);
  },
  delete: (id: string) => { _coord().deleteRoom(id); roomGameState.delete(id); },
  [Symbol.iterator]: function* () { for (const [id] of _coord().getAllRooms()) { const r = getRoomState(id); if (r) yield [id, r] as [string, RoomState]; } },
};
const playerToRoom = {
  get: (userId: string) => _coord().getPlayerRoom(userId),
  has: (userId: string) => _coord().hasPlayerRoom(userId),
  set: (userId: string, roomId: string) => _coord().setPlayerRoom(userId, roomId),
  delete: (userId: string) => _coord().removePlayerRoom(userId),
};
const spectatorConnections = {
  get: (userId: string) => _coord().getSpectatorConnection(userId),
  has: (userId: string) => _coord().hasSpectatorConnection(userId),
  set: (userId: string, conn: CoordinatorSpectatorConnection) => _coord().setSpectatorConnection(userId, conn),
  delete: (userId: string) => _coord().removeSpectatorConnection(userId),
};

// Room TTL: auto-clean stale rooms after 30 minutes
const ROOM_TTL = 30 * 60 * 1000;

function parseLeaseDurationMs(
  raw: string | undefined,
  fallback: number,
  min: number,
  label: string,
): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    console.warn(
      `[roomManager] Ignoring invalid ${label}=${raw}; expected an integer >= ${min}. Using ${fallback}.`,
    );
    return fallback;
  }

  return parsed;
}

const ROOM_OWNER_LEASE_TTL = parseLeaseDurationMs(
  process.env.ROOM_OWNER_LEASE_TTL_MS,
  15_000,
  2_000,
  "ROOM_OWNER_LEASE_TTL_MS",
);
const ROOM_OWNER_LEASE_RENEW_INTERVAL_MS = Math.min(
  parseLeaseDurationMs(
    process.env.ROOM_OWNER_LEASE_RENEW_INTERVAL_MS,
    Math.max(1_000, Math.floor(ROOM_OWNER_LEASE_TTL / 3)),
    250,
    "ROOM_OWNER_LEASE_RENEW_INTERVAL_MS",
  ),
  Math.max(250, ROOM_OWNER_LEASE_TTL - 250),
);
const TEST_CRASH_AFTER_DURABLE_ACTION = process.env.TEST_CRASH_AFTER_DURABLE_ACTION?.trim();
let consumedDurableActionCrash = false;

type DurableCrashAction = ClientMessage["type"] | "match_start" | "forced_end";

function logAsyncRoomTaskError(context: string, error: unknown, roomId?: string): void {
  const roomSuffix = roomId ? ` for room ${roomId}` : "";
  console.error(`[roomManager] ${context}${roomSuffix}:`, error);
}

function maybeCrashAfterDurableActionCommit(action: DurableCrashAction): void {
  if (
    consumedDurableActionCrash ||
    !TEST_CRASH_AFTER_DURABLE_ACTION ||
    TEST_CRASH_AFTER_DURABLE_ACTION !== action
  ) {
    return;
  }

  consumedDurableActionCrash = true;
  console.error(`[roomManager] Triggering abrupt test crash after durable ${action} commit.`);

  try {
    process.kill(process.pid, "SIGKILL");
  } catch {
    process.abort();
  }
}

function roomOwnerLeaseName(roomId: string): string {
  return `room:${roomId}:owner`;
}

function claimRoomOwnership(roomId: string): boolean {
  const coord = _coord();
  const ownerId = coord.getNodeId();
  return (
    coord.renewLease(roomOwnerLeaseName(roomId), ownerId, ROOM_OWNER_LEASE_TTL) ||
    coord.claimLease(roomOwnerLeaseName(roomId), ownerId, ROOM_OWNER_LEASE_TTL)
  );
}

function releaseRoomOwnership(roomId: string): void {
  const coord = _coord();
  const room = coord.getRoom(roomId);
  if (room && room.ownerNodeId && room.ownerNodeId !== coord.getNodeId()) {
    return;
  }
  coord.releaseLease(roomOwnerLeaseName(roomId), coord.getNodeId());
  coord.updateRoomOwnership(roomId, {
    ownerNodeId: undefined,
    ownerLeaseExpiresAt: undefined,
  });
}

export function prepareRoomsForShutdown(): void {
  shuttingDown = true;
  const coord = _coord();
  const nodeId = coord.getNodeId();
  for (const [roomId, room] of coord.getAllRooms()) {
    if (room.ownerNodeId !== nodeId) {
      continue;
    }
    suspendRoomTimersForShutdown(roomId);
    releaseRoomOwnership(roomId);
  }
}

function renewOwnedRoomLeases(): void {
  if (shuttingDown) {
    return;
  }

  const coord = _coord();
  const nodeId = coord.getNodeId();
  const nextExpiry = Date.now() + ROOM_OWNER_LEASE_TTL;

  for (const [roomId, room] of coord.getAllRooms()) {
    if (room.ownerNodeId !== nodeId) {
      continue;
    }

    if (!claimRoomOwnership(roomId)) {
      continue;
    }

    coord.updateRoomOwnership(roomId, {
      ownerNodeId: nodeId,
      ownerLeaseExpiresAt: nextExpiry,
    });
    // Ownership may have been acquired provisionally before the previous
    // timer lease expired. Retry hydration on each successful renewal.
    recoverTurnTimerForRoom(roomId);
  }
}

function reclaimRecoverableRooms(): void {
  if (shuttingDown) {
    return;
  }

  const coord = _coord();
  const nodeId = coord.getNodeId();

  for (const [roomId, room] of coord.getAllRooms()) {
    if (room.ownerNodeId === nodeId) {
      continue;
    }

    const localRoom = rooms.get(roomId);
    if (!localRoom) {
      continue;
    }

    const hasLocalConnectedPlayers = Array.from(localRoom.players.values()).some(
      (player) => player.connected && player.nodeId === nodeId,
    );
    if (!hasLocalConnectedPlayers) {
      continue;
    }

    if (!canServeRoomLocally(room, nodeId)) {
      continue;
    }

    adoptRoomOwnership(room);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of _coord().getAllRooms()) {
    if (now - room.createdAt > ROOM_TTL) {
      cleanupRoom(id);
    }
  }
}, 60_000).unref();

setInterval(() => {
  renewOwnedRoomLeases();
}, ROOM_OWNER_LEASE_RENEW_INTERVAL_MS).unref();

setInterval(() => {
  reclaimRecoverableRooms();
}, ROOM_OWNER_LEASE_RENEW_INTERVAL_MS).unref();

// ── Helper: send typed message ───────────────────────────────────────

function send(ws: WebSocket | null, msg: ServerMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendRoomPlayer(room: RoomState, userId: string, msg: ServerMessage): void {
  const player = room.players.get(userId);
  if (!player) {
    return;
  }

  if (player.nodeId && player.nodeId !== currentNodeId()) {
    _coord().deliverNodeMessage({
      targetNodeId: player.nodeId,
      sourceNodeId: currentNodeId(),
      roomId: room.id,
      userId,
      message: msg,
      roomGameSnapshot: room.match || room.lastShowdown ? serializeRoomGameState(room) : undefined,
    });
    return;
  }

  send(player.ws, msg);
}

function sendSpectatorMessage(roomId: string, userId: string, msg: ServerMessage): void {
  const spectator = spectatorConnections.get(userId);
  if (!spectator) {
    return;
  }

  const spectatorNodeId = spectator.nodeId ?? currentNodeId();
  if (spectatorNodeId !== currentNodeId()) {
    const room = rooms.get(roomId);
    _coord().deliverNodeMessage({
      targetNodeId: spectatorNodeId,
      sourceNodeId: currentNodeId(),
      roomId,
      userId,
      message: msg,
      roomGameSnapshot: room && (room.match || room.lastShowdown) ? serializeRoomGameState(room) : undefined,
    });
    return;
  }

  if (spectator.ws && spectator.ws.readyState === WebSocket.OPEN) {
    send(spectator.ws, msg);
  }
}

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  // Ensure uniqueness
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

function getRoomPlayers(room: RoomState): RoomPlayer[] {
  return Array.from(room.players.values()).map(p => ({
    userId: p.userId,
    username: p.username,
    connected: p.connected,
  }));
}

function cleanupRoom(roomId: string) {
  if (shuttingDown) {
    return;
  }
  const room = rooms.get(roomId);
  if (!room) return;
  cleanupRoomTimers(roomId);
  cleanupEscrow(roomId);
  cleanupFairness(roomId);
  for (const p of room.players.values()) {
    playerToRoom.delete(p.userId);
  }
  releaseRoomOwnership(roomId);
  // Notify spectators that the match is over and clean up their connections
  notifySpectatorsMatchOver(roomId, "Match ended.");
  cleanupSpectators(roomId);
  cleanupBroadcastStats(roomId);
  rooms.delete(roomId);
}

// ── Broadcast helpers ────────────────────────────────────────────────

function broadcastGameState(room: RoomState) {
  if (!room.match) return;
  if (!canServeRoom(room)) return;
  syncRoomGameState(room);
  const timerInfo = getTurnTimerInfo(room.id);
  const escrow = getRoomEscrow(room.id);

  for (const p of room.players.values()) {
    const view = getPlayerView(room.match, p.userId);
    if (view) {
      // Inject timer info
      if (timerInfo) {
        view.turnTimer = {
          remainingSeconds: timerInfo.remainingSeconds,
          totalSeconds: timerInfo.totalSeconds,
          isMyTimer: timerInfo.activePlayerId === p.userId,
        };
      }

      // Inject stake info (rake-adjusted)
      if (escrow && escrow.preset.entryFee > 0) {
        view.stakeInfo = {
          stakeId: escrow.stakeId,
          label: escrow.preset.label,
          entryFee: escrow.preset.entryFee,
          prizePool: escrow.preset.prizePool,
          rakeAmount: escrow.preset.rakeAmount,
          rakePercent: escrow.preset.rakePercent,
          currency: escrow.preset.currency,
        };
      }

      // Inject fairness status
      if (room.match) {
        view.fairnessStatus = buildFairnessStatus(room.id, room.match.roundNumber, p.userId, room);
      }

      // For round_over/game_over use the stored showdown
      if (room.match.status === "round_over" && room.lastShowdown) {
        sendRoomPlayer(room, p.userId, {
          type: "round_over",
          state: view,
          knockerHand: room.lastShowdown.knocker.melds.flatMap(m => m.cards).concat(room.lastShowdown.knocker.deadwood) as CardView[],
          opponentHand: room.lastShowdown.opponent.melds.flatMap(m => m.cards).concat(room.lastShowdown.opponent.deadwood) as CardView[],
          showdown: room.lastShowdown,
        });
      } else if (room.match.status === "game_over" && room.lastShowdown) {
        sendRoomPlayer(room, p.userId, {
          type: "game_over",
          state: view,
          knockerHand: room.lastShowdown.knocker.melds.flatMap(m => m.cards).concat(room.lastShowdown.knocker.deadwood) as CardView[],
          opponentHand: room.lastShowdown.opponent.melds.flatMap(m => m.cards).concat(room.lastShowdown.opponent.deadwood) as CardView[],
          showdown: room.lastShowdown,
        });
      } else {
        sendRoomPlayer(room, p.userId, { type: "game_update", state: view });
      }
    }
  }

  // Also broadcast to spectators
  broadcastSpectatorView(room);
}

function broadcastReveal(room: RoomState, knockerHand: Card[], opponentHand: Card[], showdownData: ShowdownData) {
  if (!room.match) return;
  if (!canServeRoom(room)) return;
  const kh: CardView[] = knockerHand.map(c => ({ suit: c.suit, rank: c.rank }));
  const oh: CardView[] = opponentHand.map(c => ({ suit: c.suit, rank: c.rank }));

  // Store showdown for reconnection scenarios
  room.lastShowdown = showdownData;
  syncRoomGameState(room);

  for (const p of room.players.values()) {
    const view = getPlayerView(room.match, p.userId);
    if (!view) continue;
    const msgType = room.match.status === "game_over" ? "game_over" : "round_over";
    sendRoomPlayer(room, p.userId, { type: msgType, state: view, knockerHand: kh, opponentHand: oh, showdown: showdownData });
  }

  // Also broadcast to spectators (they'll see the showdown data)
  broadcastSpectatorView(room);
}

/**
 * Broadcast a turn_timer message to both players in a room.
 */
function broadcastTimerUpdate(room: RoomState) {
  const timerInfo = getTurnTimerInfo(room.id);
  if (!timerInfo) return;

  for (const p of room.players.values()) {
      sendRoomPlayer(room, p.userId, {
        type: "turn_timer" as const,
        activePlayerId: timerInfo.activePlayerId,
        remainingSeconds: timerInfo.remainingSeconds,
        totalSeconds: timerInfo.totalSeconds,
      });
  }
}

/**
 * Build a per-player fairness status info object for the current round.
 */
function buildFairnessStatus(roomId: string, roundNumber: number, playerId: string, room: RoomState): FairnessStatusInfo | null {
  const seeds = getClientSeeds(roomId, roundNumber);
  const ps = Array.from(room.players.values());
  const playerIds = ps.map(p => p.userId);
  const myIdx = playerIds.indexOf(playerId);
  if (myIdx === -1) return null;

  const isPlayer1 = myIdx === 0;
  const mySeed = isPlayer1 ? seeds?.player1 : seeds?.player2;
  const opponentSeed = isPlayer1 ? seeds?.player2 : seeds?.player1;
  const bothPresent = mySeed != null && opponentSeed != null;
  const activeVersion = bothPresent ? 2 : 1;

  // Get commitment hash from the proof
  const proof = getRoundProof(roomId, roundNumber);
  const commitmentHash = proof?.commitment?.commitmentHash || "";

  return {
    roundNumber,
    commitmentPublished: !!commitmentHash,
    commitmentHashShort: commitmentHash.slice(0, 12),
    mySeedSubmitted: mySeed != null,
    opponentSeedSubmitted: opponentSeed != null,
    activeVersion,
    label: bothPresent ? "Trust Shield v2" : "Trust Shield v1 (server-only)",
  };
}

/**
 * Broadcast fairness status to both players in a room.
 */
function broadcastFairnessStatus(room: RoomState, roundNumber: number) {
  for (const p of room.players.values()) {
    const status = buildFairnessStatus(room.id, roundNumber, p.userId, room);
    if (status) {
      sendRoomPlayer(room, p.userId, { type: "fairness_status", status });
    }
  }
}

// ── Match start helper (creates match + transcript + timer) ──────────

async function startMatchForRoom(room: RoomState): Promise<void> {
  if (!canServeRoom(room)) {
    console.warn(
      `[roomManager] Refusing to start room ${room.id} on node ${currentNodeId()} because ownership belongs to ${room.ownerNodeId ?? "unknown"}.`
    );
    return;
  }

  const ps = Array.from(room.players.values());

  // Create escrow holds for staked matches
  if (!isFreeStake(room.stakeId)) {
    initRoomEscrow(room.id, room.stakeId);
    for (const p of ps) {
      try {
        holdEntryFee(room.id, p.userId, room.stakeId);
      } catch {
        // If hold fails (insufficient funds at match start), refund any previous holds and abort
        refundEscrow(room.id);
        for (const pl of ps) {
          send(pl.ws, { type: "error", message: `Match cancelled: ${p.username} has insufficient funds.` });
        }
        room.status = "finished";
        return;
      }
    }
  } else {
    initRoomEscrow(room.id, "free");
  }

  // Initialize fairness (cryptographic commitment system) — pass player IDs for v2 client-seed ordering
  initMatchFairness(room.id, [ps[0].userId, ps[1].userId]);

  // Create pre-deal commitment for round 1
  const { commitment, deckOrder } = createRoundCommitment(room.id, 1);

  room.match = createMatchWithDeck(
    room.id,
    { userId: ps[0].userId, username: ps[0].username },
    { userId: ps[1].userId, username: ps[1].username },
    deckOrder
  );
  room.status = "playing";

  // Initialize broadcast analytics tracking
  initBroadcastStats(room.id);

  // Record stake info in transcript
  const stakePreset = getStakePreset(room.stakeId);

  // Create transcript
  createTranscript(room.id, [
    { userId: ps[0].userId, username: ps[0].username },
    { userId: ps[1].userId, username: ps[1].username },
  ]);
  // Record stake metadata in transcript (including rake)
  if (stakePreset && stakePreset.entryFee > 0) {
    addAction(room.id, "match_start", undefined, undefined, {
      stakeId: room.stakeId,
      stakeLabel: stakePreset.label,
      entryFee: stakePreset.entryFee,
      prizePool: stakePreset.prizePool,
      rakeAmount: stakePreset.rakeAmount,
      rakePercent: stakePreset.rakePercent,
      currency: stakePreset.currency,
    });
  }
  // Record fairness commitment in transcript
  addAction(room.id, "round_start", undefined, undefined, {
    roundNumber: 1,
    fairnessCommitment: commitment.commitmentHash,
    fairnessAlgorithmVersion: commitment.algorithmVersion,
  });
  recordRoundStart(room.id, 1, room.match.players[0].userId, room.match.players[0].username);

  // Start turn timer for first player
  startTurnTimer(room.id, room.match.players[room.match.currentPlayerIndex].userId);

  await commitRoomGameStateDurably(room);
  maybeCrashAfterDurableActionCommit("match_start");

  // Broadcast game start (with stake info + fairness commitment + fairness status)
  const escrow = getRoomEscrow(room.id);
  for (const p of room.players.values()) {
    const view = getPlayerView(room.match, p.userId);
    if (view) {
      const timerInfo = getTurnTimerInfo(room.id);
      if (timerInfo) {
        view.turnTimer = {
          remainingSeconds: timerInfo.remainingSeconds,
          totalSeconds: timerInfo.totalSeconds,
          isMyTimer: timerInfo.activePlayerId === p.userId,
        };
      }
      if (escrow && escrow.preset.entryFee > 0) {
        view.stakeInfo = {
          stakeId: escrow.stakeId,
          label: escrow.preset.label,
          entryFee: escrow.preset.entryFee,
          prizePool: escrow.preset.prizePool,
          rakeAmount: escrow.preset.rakeAmount,
          rakePercent: escrow.preset.rakePercent,
          currency: escrow.preset.currency,
        };
      }
      // Attach fairness commitment to the game_started message via view
      view.fairnessCommitment = {
        commitmentHash: commitment.commitmentHash,
        algorithmVersion: commitment.algorithmVersion,
        roundNumber: 1,
      };
      // Attach live fairness status
      view.fairnessStatus = buildFairnessStatus(room.id, 1, p.userId, room);
      sendRoomPlayer(room, p.userId, { type: "game_started", state: view });
    }
  }

  // Send initial timer update
  broadcastTimerUpdate(room);
  // Send initial fairness status
  broadcastFairnessStatus(room, 1);
}

// ── Persist match result ─────────────────────────────────────────────

function persistMatchResult(match: MatchState) {
  const winner = match.players.find(p => p.userId === match.winnerId);
  const loser = match.players.find(p => p.userId !== match.winnerId);
  if (!winner || !loser) return;

  db.transaction(() => {
    const wid = crypto.randomUUID();
    db.prepare(`INSERT INTO matches (id, user_id, opponent_name, user_score, opponent_score, is_win, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run(wid, winner.userId, loser.username, winner.score, loser.score, 1);
    db.prepare("UPDATE users SET rating = MAX(100, rating + 15), wins = wins + 1 WHERE id = ?").run(winner.userId);

    const lid = crypto.randomUUID();
    db.prepare(`INSERT INTO matches (id, user_id, opponent_name, user_score, opponent_score, is_win, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run(lid, loser.userId, winner.username, loser.score, winner.score, 0);
    db.prepare("UPDATE users SET rating = MAX(100, rating - 10), losses = losses + 1 WHERE id = ?").run(loser.userId);
  })();
}

// ── Forfeit / End match helper ───────────────────────────────────────

/**
 * End a match by forfeit/timeout/disconnect.
 * Handles: match state update, rating persistence, transcript finalization,
 * timer cleanup, and client notification.
 */
async function endMatchByForfeit(
  room: RoomState,
  forfeitingUserId: string,
  forfeitingUsername: string,
  reason: "forfeit" | "timeout" | "disconnect"
): Promise<void> {
  if (!room.match || room.match.status === "game_over") return;
  if (!canServeRoom(room)) return;

  const remaining = room.match.players.find(p => p.userId !== forfeitingUserId);
  if (!remaining) return;

  // Record in transcript
  recordForfeit(room.id, forfeitingUserId, forfeitingUsername, reason === "forfeit" ? "leave" : reason);

  // Update match state
  room.match.status = "game_over";
  room.match.winnerId = remaining.userId;
  const reasonLabel = reason === "timeout" ? "timed out" : reason === "disconnect" ? "disconnected" : "forfeited";
  room.match.message = `${forfeitingUsername} ${reasonLabel}. ${remaining.username} wins!`;

  // Settle escrow — winner receives net prize pool (after rake)
  const settlement = settleMatch(room.id, remaining.userId, forfeitingUserId, reason);
  if (settlement.type === "payout" && settlement.payoutAmount) {
    room.match.message += ` (+${settlement.payoutAmount} ${settlement.currency === "sweeps_coins" ? "Sweeps" : "Gold"})`;
  }

  const forfeitShowdown: ShowdownData = {
    knockOutcome: "knock",
    knockerUsername: forfeitingUsername,
    opponentUsername: remaining.username,
    knocker: { username: forfeitingUsername, melds: [], deadwood: [], deadwoodValue: 0 },
    opponent: { username: remaining.username, melds: [], deadwood: [], deadwoodValue: 0 },
    roundWinnerUsername: remaining.username,
    roundPoints: 0,
  };
  room.lastShowdown = forfeitShowdown;

  // Reveal any unrevealed fairness seeds and collect proof data
  const currentRound = room.match.roundNumber;
  revealRoundSeed(room.id, currentRound);
  const forfeitFairnessData = getSerializableFairnessData(room.id);

  // Finalize transcript
  finalizeTranscript(
    room.id,
    remaining.userId,
    remaining.username,
    forfeitingUserId,
    forfeitingUsername,
    remaining.score,
    room.match.players.find(p => p.userId === forfeitingUserId)?.score ?? 0,
    reason === "timeout" ? "timeout" : reason === "disconnect" ? "disconnect" : "forfeit",
    forfeitFairnessData
  );

  // Persist results and update ratings
  persistMatchResult(room.match);
  room.status = "finished";

  // Clean up timer
  cleanupRoomTimers(room.id);

  await commitRoomGameStateDurably(room);
  maybeCrashAfterDurableActionCommit("forced_end");

  // Notify remaining player
  const rp = room.players.get(remaining.userId);
  if (rp) {
    sendRoomPlayer(room, remaining.userId, { type: "opponent_forfeited", username: forfeitingUsername });
    const view = getPlayerView(room.match, remaining.userId);
    if (view) sendRoomPlayer(room, remaining.userId, {
      type: "game_over",
      state: view,
      knockerHand: [],
      opponentHand: [],
      showdown: forfeitShowdown,
    });
  }

  // Tournament bracket advancement for forfeit/timeout/disconnect
  _handleTournamentAdvance(room.id, remaining.userId, remaining.username, forfeitingUserId);
}

// ── Turn timeout handler ─────────────────────────────────────────────

function handleTurnTimeout(roomId: string, timedOutPlayerId: string, consecutiveTimeouts: number) {
  const room = rooms.get(roomId);
  if (!room || !room.match || room.match.status !== "playing") return;
  if (!canServeRoom(room)) return;

  const timedOutPlayer = room.match.players.find(p => p.userId === timedOutPlayerId);
  if (!timedOutPlayer) return;

  // Record timeout in transcript
  recordTimeout(roomId, timedOutPlayerId, timedOutPlayer.username);

  // Check if we should forfeit
  if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
    // Auto-forfeit — too many consecutive timeouts
    void endMatchByForfeit(room, timedOutPlayerId, timedOutPlayer.username, "timeout").catch((err) => {
      logAsyncRoomTaskError("Failed to end timed-out match", err, roomId);
    });

    // Notify the timed-out player too if still connected
    const timedOutPlayerState = room.players.get(timedOutPlayerId);
    if (timedOutPlayerState) {
      sendRoomPlayer(room, timedOutPlayerId, {
        type: "turn_timeout_warning",
        message: `You were forfeited after ${MAX_CONSECUTIVE_TIMEOUTS} consecutive timeouts.`
      });
    }
    return;
  }

  // Auto-play: draw from stock if haven't drawn, then discard last card
  const currentPlayerIdx = room.match.players.findIndex(p => p.userId === timedOutPlayerId);
  if (currentPlayerIdx !== room.match.currentPlayerIndex) return; // Safety check

  const player = room.match.players[currentPlayerIdx];

  if (player.hand.length <= 10) {
    // Haven't drawn yet — auto-draw from stock
    const drawResult = handleDraw(room.match, timedOutPlayerId, "stock");
    if (drawResult.ok && drawResult.drawnCard) {
      recordDraw(roomId, timedOutPlayerId, timedOutPlayer.username, "stock");
    }
  }

  // Now auto-discard last card (the drawn card, or the last card in hand)
  if (player.hand.length > 10) {
    const lastIdx = player.hand.length - 1;
    const discardResult = handleDiscard(room.match, timedOutPlayerId, lastIdx);
    if (discardResult.ok && discardResult.discardedCard) {
      recordDiscard(roomId, timedOutPlayerId, timedOutPlayer.username, discardResult.discardedCard);
    }
  }

  syncRoomGameState(room);

  // Notify the timed-out player
  const timedOutPlayerState = room.players.get(timedOutPlayerId);
  if (timedOutPlayerState) {
    sendRoomPlayer(room, timedOutPlayerId, {
      type: "turn_timeout_warning",
      message: `You timed out. Auto-played your turn. (${consecutiveTimeouts}/${MAX_CONSECUTIVE_TIMEOUTS} warnings)`
    });
  }

  // If the match is still going, start timer for next player and broadcast
  if (room.match.status === "playing") {
    const nextPlayerId = room.match.players[room.match.currentPlayerIndex].userId;
    startTurnTimer(roomId, nextPlayerId);
    broadcastGameState(room);
    broadcastTimerUpdate(room);
  }
}

// ── Message Handler ──────────────────────────────────────────────────

async function handleMessage(ws: WebSocket, userId: string, username: string, msg: ClientMessage): Promise<void> {
  switch (msg.type) {
    case "ping": {
      send(ws, { type: "pong" });
      break;
    }

    case "create_room": {
      // Remove from existing room if any
      const existingRoom = playerToRoom.get(userId);
      if (existingRoom) {
        await handleLeave(userId);
      }

      const roomId = generateRoomCode();
      const room: RoomState = {
        id: roomId,
        hostId: userId,
        players: new Map(),
        match: null,
        status: "waiting",
        createdAt: Date.now(),
        stakeId: "free",
        lastShowdown: null,
      };
      room.players.set(userId, createPlayerConnection({ userId, username }, ws, true));
      rooms.set(roomId, room);
      playerToRoom.set(userId, roomId);

      send(ws, { type: "room_created", roomId });
      send(ws, {
        type: "room_joined",
        room: {
          id: roomId,
          hostUsername: username,
          players: getRoomPlayers(room),
          status: room.status,
        },
      });
      break;
    }

    case "join_room": {
      const room = rooms.get(msg.roomId);
      if (!room) {
        send(ws, { type: "error", message: "Room not found." });
        break;
      }
      if (!canServeRoom(room)) {
        if (relayRoomAction(ws, room, userId, username, msg, "join_room")) {
          break;
        }
        sendRoomHandoffRequired(ws, room, "join_room");
        break;
      }

      const existingRoom2 = playerToRoom.get(userId);
      if (existingRoom2 === msg.roomId) {
        const ep = room.players.get(userId);
        if (ep) {
      room.players.set(userId, createPlayerConnection(ep, ws, true));
          // Send current state
          send(ws, {
            type: "room_joined",
            room: {
              id: room.id,
              hostUsername: Array.from(room.players.values()).find(p => p.userId === room.hostId)?.username || "",
              players: getRoomPlayers(room),
              status: room.status,
            },
          });
          if (room.match) {
            const view = getPlayerView(room.match, userId);
            if (view) send(ws, { type: "game_update", state: view });
          }
          // Notify opponent
          for (const p of room.players.values()) {
            if (p.userId !== userId) {
              sendRoomPlayer(room, p.userId, { type: "opponent_reconnected", username });
            }
          }
          break;
        }
      }
      if (existingRoom2 && existingRoom2 !== msg.roomId) {
        await handleLeave(userId);
      }

      if (room.status !== "waiting") {
        send(ws, { type: "error", message: "Game already in progress." });
        break;
      }
      if (room.players.size >= 2) {
        send(ws, { type: "error", message: "Room is full." });
        break;
      }
      if (room.players.has(userId)) {
        send(ws, { type: "error", message: "Already in this room." });
        break;
      }

      room.players.set(userId, createPlayerConnection({ userId, username }, ws, true));
      playerToRoom.set(userId, room.id);

      // Notify the joiner
      send(ws, {
        type: "room_joined",
        room: {
          id: room.id,
          hostUsername: Array.from(room.players.values()).find(p => p.userId === room.hostId)?.username || "",
          players: getRoomPlayers(room),
          status: room.status,
        },
      });

      // Notify the host that opponent joined
      for (const p of room.players.values()) {
        if (p.userId !== userId) {
          sendRoomPlayer(room, p.userId, { type: "opponent_joined", opponent: { userId, username, connected: true } });
        }
      }

      // Both players present — start the game
      if (room.players.size === 2) {
        await startMatchForRoom(room);
      }
      break;
    }

    case "draw": {
      const roomId = playerToRoom.get(userId);
      if (!roomId) { send(ws, { type: "error", message: "Not in a room." }); break; }
      const room = rooms.get(roomId);
      if (!room || !room.match) { send(ws, { type: "error", message: "No active match." }); break; }
      if (!canServeRoom(room)) {
        if (relayRoomAction(ws, room, userId, username, msg, "reconnect")) {
          break;
        }
        sendRoomHandoffRequired(ws, room, "reconnect");
        break;
      }

      const result = handleDraw(room.match, userId, msg.source);
      if (!result.ok) { send(ws, { type: "error", message: (result as { ok: false; error: string }).error }); break; }

      // Player acted voluntarily — reset their timeout counter
      resetTimeoutCount(roomId, userId);

      // Record in transcript
      recordDraw(roomId, userId, username, msg.source);

      await commitRoomGameStateDurably(room);
      maybeCrashAfterDurableActionCommit("draw");
      broadcastGameState(room);
      break;
    }

    case "discard": {
      const roomId = playerToRoom.get(userId);
      if (!roomId) { send(ws, { type: "error", message: "Not in a room." }); break; }
      const room = rooms.get(roomId);
      if (!room || !room.match) { send(ws, { type: "error", message: "No active match." }); break; }
      if (!canServeRoom(room)) {
        if (relayRoomAction(ws, room, userId, username, msg, "reconnect")) {
          break;
        }
        sendRoomHandoffRequired(ws, room, "reconnect");
        break;
      }

      const result = handleDiscard(room.match, userId, msg.cardIndex);
      if (!result.ok) { send(ws, { type: "error", message: (result as { ok: false; error: string }).error }); break; }

      // Player acted voluntarily — reset their timeout counter
      resetTimeoutCount(roomId, userId);

      // Record in transcript
      if (result.discardedCard) {
        recordDiscard(roomId, userId, username, result.discardedCard);
      }

      // Turn has changed — restart timer for the new active player
      if (room.match.status === "playing") {
        const nextPlayerId = room.match.players[room.match.currentPlayerIndex].userId;
        startTurnTimer(roomId, nextPlayerId);
      }

      await commitRoomGameStateDurably(room);
      maybeCrashAfterDurableActionCommit("discard");
      broadcastGameState(room);
      broadcastTimerUpdate(room);
      break;
    }

    case "knock": {
      const roomId = playerToRoom.get(userId);
      if (!roomId) { send(ws, { type: "error", message: "Not in a room." }); break; }
      const room = rooms.get(roomId);
      if (!room || !room.match) { send(ws, { type: "error", message: "No active match." }); break; }
      if (!canServeRoom(room)) {
        if (relayRoomAction(ws, room, userId, username, msg, "reconnect")) {
          break;
        }
        sendRoomHandoffRequired(ws, room, "reconnect");
        break;
      }

      const result = handleKnock(room.match, userId, msg.cardIndex);
      if (!result.ok) { send(ws, { type: "error", message: (result as { ok: false; error: string }).error }); break; }

      // Player acted voluntarily — reset their timeout counter
      resetTimeoutCount(roomId, userId);

      // Record knock outcome in transcript
      if (result.knockOutcome && result.discardedCard && room.match.roundWinnerId) {
        const knocker = room.match.players.find(p => p.userId === userId)!;
        const winner = room.match.players.find(p => p.userId === room.match!.roundWinnerId)!;

        recordKnockOutcome(
          roomId,
          userId,
          knocker.username,
          result.knockOutcome,
          winner.userId,
          winner.username,
          room.match.roundPoints,
          0, // knocker's final deadwood (recorded but approximated)
          0, // opponent's final deadwood
          result.discardedCard
        );
      }

      // Cancel timer on round/game end
      if (room.match.status !== "playing") {
        cancelTurnTimer(roomId);
      }

      if (result.showdownData) {
        room.lastShowdown = result.showdownData;
      }

      await commitRoomGameStateDurably(room);
      maybeCrashAfterDurableActionCommit("knock");

      if (result.reveal) {
        broadcastReveal(room, result.reveal.knockerHand, result.reveal.opponentHand, result.showdownData!);
      } else {
        broadcastGameState(room);
      }

      // If game over, persist results and finalize transcript
      if (room.match.status === "game_over") {
        const winner = room.match.players.find(p => p.userId === room.match!.winnerId)!;
        const loser = room.match.players.find(p => p.userId !== room.match!.winnerId)!;

        // Reveal fairness seed for the final round
        const finalRound = room.match.roundNumber;
        const transcriptForReveal = getTranscript(roomId);
        revealRoundSeed(roomId, finalRound, transcriptForReveal?.actions);

        // Collect fairness data for persistence
        const completedFairnessData = getSerializableFairnessData(roomId);

        finalizeTranscript(
          roomId,
          winner.userId,
          winner.username,
          loser.userId,
          loser.username,
          winner.score,
          loser.score,
          "completed",
          completedFairnessData
        );
        // Settle escrow — winner receives net prize pool (after rake)
        const settlement = settleMatch(roomId, winner.userId, loser.userId, "completed");
        if (settlement.type === "payout" && settlement.payoutAmount) {
          room.match.message = (room.match.message || "") + ` (+${settlement.payoutAmount} ${settlement.currency === "sweeps_coins" ? "Sweeps" : "Gold"})`;
        }
        persistMatchResult(room.match);
        room.status = "finished";
        cleanupRoomTimers(roomId);

        // Persist broadcast metrics
        const p1r = (db.prepare("SELECT rating FROM users WHERE id = ?").get(winner.userId) as any)?.rating ?? 1200;
        const p2r = (db.prepare("SELECT rating FROM users WHERE id = ?").get(loser.userId) as any)?.rating ?? 1200;
        const isTournament = !!getTournamentForRoom(roomId);
        const completedReasons = getFeaturedReasons(roomId, room.stakeId, isTournament, p1r, p2r, winner.userId, loser.userId);
        persistBroadcastMetrics(
          roomId, winner.userId, winner.username, loser.userId, loser.username,
          winner.userId, winner.username, room.stakeId, completedReasons, room.createdAt
        );

        // Tournament bracket advancement
        _handleTournamentAdvance(roomId, winner.userId, winner.username, loser.userId);
      }
      break;
    }

    case "next_round": {
      const roomId = playerToRoom.get(userId);
      if (!roomId) { send(ws, { type: "error", message: "Not in a room." }); break; }
      const room = rooms.get(roomId);
      if (!room || !room.match) { send(ws, { type: "error", message: "No active match." }); break; }
      if (!canServeRoom(room)) {
        if (relayRoomAction(ws, room, userId, username, msg, "reconnect")) {
          break;
        }
        sendRoomHandoffRequired(ws, room, "reconnect");
        break;
      }

      // Reveal the previous round's fairness seed before starting next round
      const prevRound = room.match.roundNumber;
      const transcript = getTranscript(roomId);
      const actions = transcript?.actions ?? [];
      const roundStartIndex = actions.findIndex(
        (action) => action.type === "round_start" && action.detail?.roundNumber === prevRound,
      );
      const nextRoundIndex = roundStartIndex < 0
        ? -1
        : actions.findIndex(
            (action, index) => index > roundStartIndex && action.type === "round_start",
          );
      const roundActions = roundStartIndex < 0
        ? []
        : actions.slice(roundStartIndex, nextRoundIndex < 0 ? undefined : nextRoundIndex);
      revealRoundSeed(roomId, prevRound, roundActions);

      // Create fairness commitment for the new round
      const newRound = prevRound + 1;
      let newDeckOrder: number[] | undefined;
      try {
        const fairResult = createRoundCommitment(roomId, newRound);
        newDeckOrder = fairResult.deckOrder;
        // Record in transcript
        addAction(roomId, "round_start", undefined, undefined, {
          roundNumber: newRound,
          fairnessCommitment: fairResult.commitment.commitmentHash,
          fairnessAlgorithmVersion: fairResult.commitment.algorithmVersion,
        });
      } catch {
        // Fairness init may have been cleaned up — fallback
      }

      const result = handleNextRound(room.match, userId, newDeckOrder);
      if (!result.ok) { send(ws, { type: "error", message: (result as { ok: false; error: string }).error }); break; }

      // Record round start in transcript
      recordRoundStart(
        roomId,
        room.match.roundNumber,
        room.match.players[0].userId,
        room.match.players[0].username
      );

      // Start timer for first player of new round
      if (room.match.status === "playing") {
        startTurnTimer(roomId, room.match.players[room.match.currentPlayerIndex].userId);
      }

      await commitRoomGameStateDurably(room);
      maybeCrashAfterDurableActionCommit("next_round");
      broadcastGameState(room);
      broadcastTimerUpdate(room);
      break;
    }

    case "queue_match": {
      // Don't allow queueing if already in a room
      const existingRoomForQueue = playerToRoom.get(userId);
      if (existingRoomForQueue) {
        send(ws, { type: "error", message: "Leave your current room before queueing." });
        break;
      }

      const stakeId = msg.stakeId || "free";
      const preset = getStakePreset(stakeId);
      if (!preset) {
        send(ws, { type: "error", message: "Invalid stake level." });
        break;
      }

      // Validate balance for staked matches
      if (preset.entryFee > 0) {
        const balCheck = checkBalance(userId, stakeId);
        if (!balCheck.canAfford) {
          send(ws, {
            type: "insufficient_funds",
            message: `Insufficient coins. Need ${balCheck.required}, have ${balCheck.balance}.`,
            balance: balCheck.balance,
            required: balCheck.required,
            currency: balCheck.currency,
          });
          break;
        }
      }

      // Timer speed and match posture from client
      const timerSpeed = (msg as any).timerSpeed || "medium";
      const matchPosture = (msg as any).matchPosture || "like_rated";

      // Look up rating from DB for rating-aware pairing
      const userRow = db.prepare("SELECT rating FROM users WHERE id = ?").get(userId) as { rating: number } | undefined;
      const rating = userRow?.rating ?? 1200;

      const result = joinQueue(userId, username, rating, ws, stakeId, timerSpeed, matchPosture);
      if (!result.ok) {
        send(ws, { type: "error", message: result.error! });
      } else {
        send(ws, { type: "queue_joined", position: result.position!, queueSize: getQueueSize() });
      }
      break;
    }

    case "cancel_queue": {
      const result = leaveQueue(userId);
      if (result.ok) {
        send(ws, { type: "queue_cancelled" });
      } else {
        send(ws, { type: "error", message: result.error! });
      }
      break;
    }

    case "leave_room": {
      await handleLeave(userId);
      break;
    }

    case "start_tournament_match": {
      const tmnt = getTournament(msg.tournamentId);
      if (!tmnt || !tmnt.bracket) {
        send(ws, { type: "error", message: "Tournament not found or not started." });
        break;
      }
      const tmatch = tmnt.bracket.matches[msg.matchIndex];
      if (!tmatch || tmatch.status !== "pending") {
        send(ws, { type: "error", message: "Match is not pending." });
        break;
      }
      if (tmatch.player1Id !== userId && tmatch.player2Id !== userId) {
        send(ws, { type: "error", message: "You are not in this match." });
        break;
      }
      // Only create the room if it doesn't already exist
      if (!tmatch.roomId) {
        await _createTournamentMatchRoom(tmnt.id, tmatch, ws, userId, username);
      } else {
        // Room exists — rejoin it
        const existingRoom = rooms.get(tmatch.roomId);
        if (existingRoom) {
          const ep = existingRoom.players.get(userId);
          if (ep) {
      existingRoom.players.set(userId, createPlayerConnection(ep, ws, true));
          } else {
      existingRoom.players.set(userId, createPlayerConnection({ userId, username }, ws, true));
            playerToRoom.set(userId, existingRoom.id);
          }
          send(ws, {
            type: "room_joined",
            room: {
              id: existingRoom.id,
              hostUsername: Array.from(existingRoom.players.values()).find(p => p.userId === existingRoom.hostId)?.username || "",
              players: getRoomPlayers(existingRoom),
              status: existingRoom.status,
            },
          });
          if (existingRoom.match) {
            const view = getPlayerView(existingRoom.match, userId);
            if (view) send(ws, { type: "game_update", state: view });
          }
          // If both players are present and match hasn't started, start it
          if (existingRoom.players.size === 2 && existingRoom.status === "waiting") {
            await startMatchForRoom(existingRoom);
          }
        }
      }
      break;
    }

    case "submit_client_seed": {
      const roomId = playerToRoom.get(userId);
      if (!roomId) { send(ws, { type: "error", message: "Not in a room." }); break; }
      const room = rooms.get(roomId);
      if (!room || !room.match) { send(ws, { type: "error", message: "No active match." }); break; }
      if (!canServeRoom(room)) {
        if (relayRoomAction(ws, room, userId, username, msg, "reconnect")) {
          break;
        }
        sendRoomHandoffRequired(ws, room, "reconnect");
        break;
      }

      // Validate the seed (max 64 chars, non-empty)
      const seedStr = (msg.seed || "").slice(0, 64);
      if (!seedStr) { send(ws, { type: "error", message: "Client seed cannot be empty." }); break; }

      // Submit for the current round
      const currentRound = room.match.roundNumber;
      submitClientSeed(roomId, currentRound, userId, seedStr);

      // Acknowledge the submitter
      send(ws, { type: "client_seed_accepted", roundNumber: currentRound });

      // Broadcast updated fairness status to both players (so they see seed progress)
      broadcastFairnessStatus(room, currentRound);
      break;
    }

    case "join_challenge_room": {
      // Social challenge/rematch -> room join.
      // The roomId was allocated when the challenge was accepted.
      // The stakeId is carried from the challenge/rematch record.
      const targetRoomId = msg.roomId;
      if (!targetRoomId) {
        send(ws, { type: "error", message: "Room ID is required." });
        break;
      }

      // Determine stakeId from the message (which should come from the challenge/rematch record)
      const challengeStakeId = msg.stakeId || "free";

      // Validate balance for staked challenge rooms
      if (challengeStakeId !== "free") {
        const preset = getStakePreset(challengeStakeId);
        if (!preset) {
          send(ws, { type: "error", message: "Invalid stake level." });
          break;
        }
        if (preset.entryFee > 0) {
          const balCheck = checkBalance(userId, challengeStakeId);
          if (!balCheck.canAfford) {
            send(ws, {
              type: "insufficient_funds",
              message: `Insufficient ${balCheck.currency === "sweeps_coins" ? "Sweeps" : "Gold"} balance. Need ${balCheck.required}, have ${balCheck.balance}.`,
              balance: balCheck.balance,
              required: balCheck.required,
              currency: balCheck.currency,
            });
            break;
          }
        }
      }

      // Check if room exists already
      let challengeRoom = rooms.get(targetRoomId);
      if (challengeRoom) {
        if (!canServeRoom(challengeRoom)) {
          if (relayRoomAction(ws, challengeRoom, userId, username, msg, "join_challenge_room")) {
            break;
          }
          sendRoomHandoffRequired(ws, challengeRoom, "join_challenge_room");
          break;
        }

        const existingChallengeRoom = playerToRoom.get(userId);
        if (existingChallengeRoom && existingChallengeRoom !== targetRoomId) {
          await handleLeave(userId);
        }

        // Room already exists — try to join/reconnect
        const ep = challengeRoom.players.get(userId);
        if (ep) {
          // Reconnecting
      challengeRoom.players.set(userId, createPlayerConnection(ep, ws, true));
          send(ws, {
            type: "room_joined",
            room: {
              id: challengeRoom.id,
              hostUsername: Array.from(challengeRoom.players.values()).find(p => p.userId === challengeRoom!.hostId)?.username || "",
              players: getRoomPlayers(challengeRoom),
              status: challengeRoom.status,
            },
          });
          if (challengeRoom.match) {
            const view = getPlayerView(challengeRoom.match, userId);
            if (view) send(ws, { type: "game_update", state: view });
          }
          for (const p of challengeRoom.players.values()) {
            if (p.userId !== userId) {
              sendRoomPlayer(challengeRoom, p.userId, { type: "opponent_reconnected", username });
            }
          }
        } else if (challengeRoom.status === "waiting" && challengeRoom.players.size < 2) {
          // Join as second player
      challengeRoom.players.set(userId, createPlayerConnection({ userId, username }, ws, true));
          playerToRoom.set(userId, challengeRoom.id);
          send(ws, {
            type: "room_joined",
            room: {
              id: challengeRoom.id,
              hostUsername: Array.from(challengeRoom.players.values()).find(p => p.userId === challengeRoom!.hostId)?.username || "",
              players: getRoomPlayers(challengeRoom),
              status: challengeRoom.status,
            },
          });
          for (const p of challengeRoom.players.values()) {
            if (p.userId !== userId) {
              sendRoomPlayer(challengeRoom, p.userId, { type: "opponent_joined", opponent: { userId, username, connected: true } });
            }
          }
          // Both players present — start the game
          if (challengeRoom.players.size === 2) {
            await startMatchForRoom(challengeRoom);
          }
        } else {
          send(ws, { type: "error", message: challengeRoom.status !== "waiting" ? "Game already in progress." : "Room is full." });
        }
      } else {
        const existingChallengeRoom = playerToRoom.get(userId);
        if (existingChallengeRoom && existingChallengeRoom !== targetRoomId) {
          await handleLeave(userId);
        }

        // Room doesn't exist yet — create it with the predetermined ID and challenge stake
        const newRoom: RoomState = {
          id: targetRoomId,
          hostId: userId,
          players: new Map(),
          match: null,
          status: "waiting",
          createdAt: Date.now(),
          stakeId: challengeStakeId,
          lastShowdown: null,
        };
      newRoom.players.set(userId, createPlayerConnection({ userId, username }, ws, true));
        rooms.set(targetRoomId, newRoom);
        playerToRoom.set(userId, targetRoomId);

        send(ws, { type: "room_created", roomId: targetRoomId });
        send(ws, {
          type: "room_joined",
          room: {
            id: targetRoomId,
            hostUsername: username,
            players: getRoomPlayers(newRoom),
            status: newRoom.status,
          },
        });
      }
      break;
    }

    case "watch_match": {
      handleWatchMatch(ws, userId, username, msg.roomId);
      break;
    }

    case "leave_spectate": {
      handleLeaveSpectate(userId);
      break;
    }

    default: {
      send(ws, { type: "error", message: "Unknown message type." });
    }
  }
}

async function handleLeave(userId: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  const roomId = playerToRoom.get(userId);
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) { playerToRoom.delete(userId); return; }

  const leavingPlayer = room.players.get(userId);
  room.players.delete(userId);
  playerToRoom.delete(userId);

  // If the match was in progress, the remaining player wins by forfeit
  if (room.match && (room.match.status === "playing" || room.match.status === "round_over")) {
    await endMatchByForfeit(room, userId, leavingPlayer?.username || "Opponent", "forfeit");
  } else {
    // Match hasn't started — refund any escrow holds
    refundEscrow(roomId);

    // Notify remaining players (for waiting room scenarios)
    if (leavingPlayer) {
      for (const p of room.players.values()) {
        sendRoomPlayer(room, p.userId, { type: "opponent_forfeited", username: leavingPlayer.username });
      }
    }
  }

  // If room is empty, clean it up
  if (room.players.size === 0) {
    cleanupRoom(roomId);
  }
}

// ── WebSocket Authentication ─────────────────────────────────────────

function authenticateUpgrade(req: IncomingMessage): { userId: string; username: string } | null {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const ticket = url.searchParams.get("ticket");
  if (!ticket) return null;
  const userId = consumeWebSocketTicket(ticket);
  if (!userId) return null;

  const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId) as { id: string; username: string } | undefined;
  if (!user) return null;

  return { userId: user.id, username: user.username };
}

// ── Attach to HTTP server ────────────────────────────────────────────

export function attachWebSocketServer(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // Register turn timeout callback
  setTurnTimeoutCallback(handleTurnTimeout);
  recoverTurnTimersFromCoordinator();
  const recoveredRoomIds = new Set<string>();
  for (const [roomId] of rooms) recoveredRoomIds.add(roomId);
  const refundedOrphans = reconcileOrphanedEscrows(recoveredRoomIds);
  if (refundedOrphans.length > 0) {
    console.warn(`[escrow] Refunded ${refundedOrphans.length} orphaned room hold(s) after recovery.`);
  }
  ensureRelayBridge();

  // Register availability callback so social.ts can query player status
  setAvailabilityCallback(getPlayerStatus);

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/ws") {
      // Not for us — let Vite HMR handle /
      return;
    }

    const auth = authenticateUpgrade(req);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, auth);
    });
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, auth: { userId: string; username: string }) => {
    const { userId, username } = auth;

    // Handle reconnection: if user was in a room, reconnect
    const existingRoomId = playerToRoom.get(userId);
    if (existingRoomId) {
      const room = rooms.get(existingRoomId);
      if (room) {
        if (!canServeRoom(room)) {
          if (!relayRoomAction(ws, room, userId, username, { type: "join_room", roomId: existingRoomId } as ClientMessage, "reconnect")) {
            sendRoomHandoffRequired(ws, room, "reconnect");
          }
          return;
        }

        const existing = room.players.get(userId);
        if (existing) {
      room.players.set(userId, createPlayerConnection(existing, ws, true));
          // Re-send room and game state
          send(ws, {
            type: "room_joined",
            room: {
              id: room.id,
              hostUsername: Array.from(room.players.values()).find(p => p.userId === room.hostId)?.username || "",
              players: getRoomPlayers(room),
              status: room.status,
            },
          });
          if (room.match) {
            const view = getPlayerView(room.match, userId);
            if (view) {
              let timerInfo = getTurnTimerInfo(room.id);
              if (!timerInfo && recoverTurnTimerForRoom(room.id)) {
                timerInfo = getTurnTimerInfo(room.id);
              }
              if (timerInfo) {
                view.turnTimer = {
                  remainingSeconds: timerInfo.remainingSeconds,
                  totalSeconds: timerInfo.totalSeconds,
                  isMyTimer: timerInfo.activePlayerId === userId,
                };
              }
              send(ws, { type: "game_update", state: view });
            }
          }
          for (const p of room.players.values()) {
            if (p.userId !== userId) {
              sendRoomPlayer(room, p.userId, { type: "opponent_reconnected", username });
            }
          }
        }
      }
    }

    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        send(ws, { type: "error", message: "Invalid message format." });
        return;
      }

      void handleMessage(ws, userId, username, msg).catch((err) => {
        console.error(`[roomManager] Failed to process message ${msg.type} for ${userId}:`, err);
        send(ws, { type: "error", message: "Unable to process multiplayer action." });
      });
    });

    ws.on("close", () => {
      // Clean up from matchmaking queue if queued
      handleQueueDisconnect(userId);

      // Clean up spectator connection if spectating
      handleLeaveSpectate(userId);

      const roomId = playerToRoom.get(userId);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      const player = room.players.get(userId);
      // A reconnect may already have replaced this socket. A stale close must
      // never disconnect the live replacement.
      if (player?.ws !== ws) return;
      if (player) {
        const disconnectedPlayer = createPlayerConnection(player, null, false);
        const disconnectMarker = disconnectedPlayer.lastSeenAt;
        room.players.set(userId, disconnectedPlayer);

        // Record disconnect in transcript
        if (room.match && room.match.status === "playing") {
          recordDisconnect(roomId, userId, username);
        }

        // Notify opponent of disconnect
        for (const p of room.players.values()) {
          if (p.userId !== userId) {
            sendRoomPlayer(room, p.userId, { type: "opponent_disconnected", username });
          }
        }

        // Start a 60-second forfeit timer if in a game
        if (room.match && room.match.status === "playing") {
          setTimeout(() => {
            const r = rooms.get(roomId);
            if (!r) return;
            const pl = r.players.get(userId);
            // Match the exact disconnect generation so an older timer cannot
            // forfeit a later disconnect after an intervening reconnect.
            if (pl && !pl.connected && pl.ws === null && pl.lastSeenAt === disconnectMarker) {
              void endMatchByForfeit(r, userId, username, "disconnect").catch((err) => {
                logAsyncRoomTaskError("Failed to end disconnected match", err, roomId);
              });
            }
          }, 60_000);
        }

        // If waiting and they disconnect, clean up room
        if (!shuttingDown && room.status === "waiting") {
          void handleLeave(userId).catch((err) => {
            logAsyncRoomTaskError("Failed to clean up waiting room after disconnect", err, roomId);
          });
        }
      }
    });
  });

  // ── Register matchmaking callback ───────────────────────────────
  setMatchFoundCallback((p1: QueueEntry, p2: QueueEntry) => {
    // Create a room and auto-start the game for the matched pair
    const roomId = generateRoomCode();
    const room: RoomState = {
      id: roomId,
      hostId: p1.userId,
      players: new Map(),
      match: null,
      status: "waiting",
      createdAt: Date.now(),
      stakeId: p1.stakeId,
      lastShowdown: null,
    };

      room.players.set(p1.userId, createPlayerConnection({ userId: p1.userId, username: p1.username }, p1.ws, true));
      room.players.set(p2.userId, createPlayerConnection({ userId: p2.userId, username: p2.username }, p2.ws, true));
    rooms.set(roomId, room);
    playerToRoom.set(p1.userId, roomId);
    playerToRoom.set(p2.userId, roomId);

    // Notify both players of the match
    send(p1.ws, { type: "match_found", roomId, opponent: p2.username });
    send(p2.ws, { type: "match_found", roomId, opponent: p1.username });

    // Set timer speed from matched player preferences (use p1's preference)
    const timerSpeed = (p1 as any).timerSpeed || "medium";
    setRoomTimerSpeed(roomId, timerSpeed);

    void (async () => {
      // Start match with transcript + timer
      await startMatchForRoom(room);

      // Send room_joined to each
      for (const p of room.players.values()) {
        sendRoomPlayer(room, p.userId, {
          type: "room_joined",
          room: {
            id: roomId,
            hostUsername: p1.username,
            players: getRoomPlayers(room),
            status: room.status,
          },
        });
      }
    })().catch((err) => {
      logAsyncRoomTaskError("Failed to start matched queue room", err, roomId);
    });
  });

  return wss;
}

// ── Tournament integration helpers ───────────────────────────────────

/**
 * After a match ends (normal or forfeit), check if this room was a tournament
 * bracket match and advance the bracket accordingly.
 */
function _handleTournamentAdvance(roomId: string, winnerId: string, winnerUsername: string, loserId: string): void {
  const mapping = getTournamentForRoom(roomId);
  if (!mapping) return;

  const result = advanceBracket(roomId, winnerId, winnerUsername, loserId);
  if (!result) return;

  const tournament = result.tournament;

  // Notify all entrants of bracket update
  for (const entrant of tournament.entrants) {
    const roomId2 = playerToRoom.get(entrant.userId);
    const room2 = roomId2 ? rooms.get(roomId2) : null;
    if (room2) {
      sendRoomPlayer(room2, entrant.userId, {
        type: "tournament_update",
        tournamentId: tournament.id,
        status: tournament.status,
        bracket: tournament.bracket,
        winnerId: tournament.winnerId,
        winnerUsername: tournament.winnerUsername,
      });

      // Notify players who are advancing to the next round
      if (result.readyMatches) {
        for (const readyMatch of result.readyMatches) {
          if (readyMatch.player1Id === entrant.userId || readyMatch.player2Id === entrant.userId) {
            const opponentName = readyMatch.player1Id === entrant.userId
              ? readyMatch.player2Username
              : readyMatch.player1Username;
            sendRoomPlayer(room2, entrant.userId, {
              type: "tournament_advance",
              tournamentId: tournament.id,
              round: readyMatch.round,
              message: `You advance to the ${readyMatch.round}! Your opponent: ${opponentName}`,
            });
          }
        }
      }

      // Notify eliminated players
      if (entrant.eliminated && entrant.userId === loserId) {
        const matchRound = tournament.bracket?.matches.find(m => m.winnerId === winnerId && m.roomId === null)?.round
          || tournament.bracket?.matches[mapping.matchIndex]?.round || 'unknown';
        sendRoomPlayer(room2, entrant.userId, {
          type: "tournament_eliminated",
          tournamentId: tournament.id,
          round: matchRound,
          message: `You have been eliminated in the ${matchRound}.`,
        });
      }
    }
  }

  if (result.tournamentCompleted) {
    // Send completion message
    for (const entrant of tournament.entrants) {
      const rId = playerToRoom.get(entrant.userId);
      const r = rId ? rooms.get(rId) : null;
      if (r) {
        sendRoomPlayer(r, entrant.userId, {
          type: "tournament_completed",
          tournamentId: tournament.id,
          winnerId: tournament.winnerId!,
          winnerUsername: tournament.winnerUsername!,
          prizePool: tournament.prizePool,
          currency: tournament.currency,
        });
      }
    }
  }
}

/**
 * Create a room for a tournament bracket match.
 * The first player to join creates the room + waits.
 * The second player joining triggers startMatchForRoom.
 */
async function _createTournamentMatchRoom(
  tournamentId: string,
  bracketMatch: BracketMatch,
  ws: WebSocket,
  userId: string,
  username: string
): Promise<void> {
  // Leave any existing room
  const existingRoom = playerToRoom.get(userId);
  if (existingRoom) {
    await handleLeave(userId);
  }

  const roomId = generateRoomCode();
  const room: RoomState = {
    id: roomId,
    hostId: bracketMatch.player1Id!,
    players: new Map(),
    match: null,
    status: "waiting",
    createdAt: Date.now(),
    stakeId: "free", // Tournament matches use free stake — payout is at tournament level
    lastShowdown: null,
  };

      room.players.set(userId, createPlayerConnection({ userId, username }, ws, true));
  rooms.set(roomId, room);
  playerToRoom.set(userId, roomId);

  // Register this room with the tournament
  registerTournamentRoom(roomId, tournamentId, bracketMatch.matchIndex);

  // Notify the player
  send(ws, {
    type: "tournament_match_starting",
    tournamentId,
    matchIndex: bracketMatch.matchIndex,
    opponent: bracketMatch.player1Id === userId ? bracketMatch.player2Username! : bracketMatch.player1Username!,
    round: bracketMatch.round,
  });

  send(ws, {
    type: "room_joined",
    room: {
      id: roomId,
      hostUsername: username,
      players: getRoomPlayers(room),
      status: room.status,
    },
  });
}

// ── Spectator Helpers ────────────────────────────────────────────────

/**
 * Broadcast spectator-safe view to all spectators of a room.
 */
function broadcastSpectatorView(room: RoomState) {
  if (!room.match) return;
  const spectatorIds = getRoomSpectatorIds(room.id);
  if (spectatorIds.length === 0) return;

  const view = getSpectatorView(room.match);

  // Attach showdown data only at round_over/game_over
  const wireView: SpectatorGameViewWire = {
    ...view,
    showdown: room.lastShowdown || null,
    isAdminFeatured: isAdminFeatured(room.id),
  };

  // Attach stake info
  const escrow = getRoomEscrow(room.id);
  if (escrow && escrow.preset.entryFee > 0) {
    wireView.stakeInfo = {
      stakeId: escrow.stakeId,
      label: escrow.preset.label,
      prizePool: escrow.preset.prizePool,
      currency: escrow.preset.currency,
    };
  }

  for (const specId of spectatorIds) {
    sendSpectatorMessage(room.id, specId, { type: "spectator_update", state: wireView });
  }
}

/**
 * Notify all spectators that a match is over.
 */
function notifySpectatorsMatchOver(roomId: string, message: string) {
  const spectatorIds = getRoomSpectatorIds(roomId);
  for (const specId of spectatorIds) {
    sendSpectatorMessage(roomId, specId, { type: "spectator_match_over", roomId, message });
    spectatorConnections.delete(specId);
  }
}

/**
 * Handle a watch_match request from a spectator.
 */
function handleWatchMatch(ws: WebSocket, userId: string, username: string, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) {
    send(ws, { type: "error", message: "Match not found." });
    return;
  }

  // Players in the match cannot spectate their own match
  if (room.players.has(userId)) {
    send(ws, { type: "error", message: "Cannot spectate a match you are playing in." });
    return;
  }

  if (!room.match || room.status === "finished") {
    send(ws, { type: "error", message: "Match is not in progress." });
    return;
  }

  // Check eligibility (with player preference enforcement)
  const ps = Array.from(room.players.values());
  const p1Rating = (db.prepare("SELECT rating FROM users WHERE id = ?").get(ps[0]?.userId) as any)?.rating ?? 1200;
  const p2Rating = (db.prepare("SELECT rating FROM users WHERE id = ?").get(ps[1]?.userId) as any)?.rating ?? 1200;
  const isTournament = !!getTournamentForRoom(roomId);
  const eligible = isSpectatable(roomId, room.stakeId, isTournament, p1Rating, p2Rating, ps[0]?.userId, ps[1]?.userId);

  if (!eligible) {
    send(ws, { type: "error", message: "This match is not available for spectating." });
    return;
  }

  // Leave any existing spectator session
  handleLeaveSpectate(userId);

  // Register as spectator
  addSpectator(roomId, userId);
  spectatorConnections.set(userId, { ws, roomId, nodeId: currentNodeId(), connectedAt: Date.now() });

  const specCount = getSpectatorCount(roomId);

  // Notify players of spectator count
  for (const p of room.players.values()) {
    sendRoomPlayer(room, p.userId, { type: "spectator_joined", roomId, spectatorCount: specCount });
  }

  // Send initial spectator view
  const view = getSpectatorView(room.match);
  const wireView: SpectatorGameViewWire = {
    ...view,
    showdown: room.lastShowdown || null,
    isAdminFeatured: isAdminFeatured(roomId),
  };
  const escrow = getRoomEscrow(roomId);
  if (escrow && escrow.preset.entryFee > 0) {
    wireView.stakeInfo = {
      stakeId: escrow.stakeId,
      label: escrow.preset.label,
      prizePool: escrow.preset.prizePool,
      currency: escrow.preset.currency,
    };
  }
  sendSpectatorMessage(roomId, userId, { type: "spectator_update", state: wireView });
}

/**
 * Handle a leave_spectate request.
 */
function handleLeaveSpectate(userId: string) {
  const conn = spectatorConnections.get(userId);
  if (!conn) return;

  const roomId = conn.roomId;
  removeSpectator(roomId, userId);
  spectatorConnections.delete(userId);

  const specCount = getSpectatorCount(roomId);
  const room = rooms.get(roomId);
  if (room) {
    for (const p of room.players.values()) {
      sendRoomPlayer(room, p.userId, { type: "spectator_left", roomId, spectatorCount: specCount });
    }
  }
}

/**
 * Get a list of currently featured/spectatable matches.
 * Called by the REST API to populate the Featured Matches surface.
 */
function loadLivePlayerRatings(): Map<string, number> {
  const userIds = new Set<string>();
  for (const [, room] of rooms) {
    for (const player of room.players.values()) userIds.add(player.userId);
  }
  if (userIds.size === 0) return new Map();
  const ids = Array.from(userIds);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT id, rating FROM users WHERE id IN (${placeholders})`,
  ).all(...ids) as Array<{ id: string; rating: number }>;
  return new Map(rows.map((row) => [row.id, row.rating]));
}

export function getFeaturedMatches(): FeaturedMatch[] {
  const featured: FeaturedMatch[] = [];
  const ratings = loadLivePlayerRatings();

  for (const [roomId, room] of rooms) {
    if (!room.match || room.status !== "playing") continue;
    if (room.match.status === "game_over") continue;

    const ps = Array.from(room.players.values());
    if (ps.length < 2) continue;

    const p1Rating = ratings.get(ps[0].userId) ?? 1200;
    const p2Rating = ratings.get(ps[1].userId) ?? 1200;
    const isTournament = !!getTournamentForRoom(roomId);
    const reasons = getFeaturedReasons(roomId, room.stakeId, isTournament, p1Rating, p2Rating, ps[0].userId, ps[1].userId);

    if (reasons.length === 0) continue;

    const escrow = getRoomEscrow(roomId);
    featured.push({
      roomId,
      player1: { username: ps[0].username, rating: p1Rating },
      player2: { username: ps[1].username, rating: p2Rating },
      scores: {
        player1: room.match.players[0].score,
        player2: room.match.players[1].score,
      },
      roundNumber: room.match.roundNumber,
      status: room.match.status,
      reasons,
      stakeInfo: escrow && escrow.preset.entryFee > 0
        ? { label: escrow.preset.label, prizePool: escrow.preset.prizePool, currency: escrow.preset.currency }
        : null,
      spectatorCount: getSpectatorCount(roomId),
      startedAt: room.createdAt,
      isAdminFeatured: isAdminFeatured(roomId),
    });
  }

  // Sort by spectator count (desc), then reasons count (desc)
  featured.sort((a, b) => {
    if (b.spectatorCount !== a.spectatorCount) return b.spectatorCount - a.spectatorCount;
    return b.reasons.length - a.reasons.length;
  });

  return featured;
}

/**
 * Get ALL live matches with full admin-facing metadata.
 * Used by the admin dashboard to inspect/feature matches.
 */
export function getLiveMatches(): LiveMatchInfo[] {
  const liveMatches: LiveMatchInfo[] = [];
  const ratings = loadLivePlayerRatings();

  for (const [roomId, room] of rooms) {
    if (room.status === "finished") continue;
    const ps = Array.from(room.players.values());
    if (ps.length < 2) continue;

    const p1Rating = ratings.get(ps[0].userId) ?? 1200;
    const p2Rating = ratings.get(ps[1].userId) ?? 1200;
    const isTournament = !!getTournamentForRoom(roomId);
    const reasons = getFeaturedReasons(roomId, room.stakeId, isTournament, p1Rating, p2Rating, ps[0].userId, ps[1].userId);
    const spectatable = reasons.length > 0;

    // Determine ineligibility reason if not spectatable
    let ineligibilityReason: string | undefined;
    if (!spectatable) {
      if (room.stakeId === "free" && !isTournament && p1Rating < 1400 && p2Rating < 1400 && !isAdminFeatured(roomId)) {
        ineligibilityReason = "Free casual match — not notable enough";
      } else if (!getPlayerSpectatePreference(ps[0].userId) || !getPlayerSpectatePreference(ps[1].userId)) {
        ineligibilityReason = "One or both players have disabled spectating";
      } else {
        ineligibilityReason = "Does not meet eligibility criteria";
      }
    }

    const broadcastStats = getLiveBroadcastStats(roomId);

    liveMatches.push({
      roomId,
      player1: { userId: ps[0].userId, username: ps[0].username, rating: p1Rating },
      player2: { userId: ps[1].userId, username: ps[1].username, rating: p2Rating },
      status: room.match?.status === "playing" ? "playing"
            : room.match?.status === "round_over" ? "round_over"
            : room.match?.status === "game_over" ? "game_over"
            : room.status as any,
      stakeId: room.stakeId,
      isTournament,
      isAdminFeatured: isAdminFeatured(roomId),
      spectatorCount: getSpectatorCount(roomId),
      reasons,
      isSpectatable: spectatable,
      ineligibilityReason,
      scores: room.match ? {
        player1: room.match.players[0].score,
        player2: room.match.players[1].score,
      } : undefined,
      roundNumber: room.match?.roundNumber,
      startedAt: room.createdAt,
      broadcastStats: broadcastStats ? {
        peakConcurrent: broadcastStats.peakConcurrent,
        uniqueSpectators: broadcastStats.uniqueSpectators,
        currentSpectators: broadcastStats.currentSpectators,
      } : undefined,
    });
  }

  return liveMatches;
}

// ── Exported for testing ─────────────────────────────────────────────
export { rooms, playerToRoom, cleanupRoom, spectatorConnections, sendSpectatorMessage, handleWatchMatch };

// ── Player Status (used by social availability) ──────────────────────

/**
 * Derive a player's availability status from in-memory state.
 * This is registered as the availability callback in social.ts
 * to avoid circular imports.
 */
export function getPlayerStatus(userId: string): PlayerAvailability {
  // Check if in a room with an active match
  const roomId = playerToRoom.get(userId);
  if (roomId) {
    const room = rooms.get(roomId);
    if (room) {
      if (room.status === "playing") return "in_match";
      if (room.status === "waiting") return "online"; // in lobby, but not playing yet
    }
  }

  // Check if in matchmaking queue
  if (isInQueue(userId)) return "in_queue";

  return "online"; // connected but not in a room or queue — we don't track raw WS connections as "online" vs "offline" here
}
