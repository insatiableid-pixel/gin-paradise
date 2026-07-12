/**
 * Realtime Coordinator Interface.
 *
 * This defines the contract between multiplayer coordination logic
 * (rooms, queue, presence, spectators) and the underlying state backend.
 *
 * Two implementations exist:
 *   1. MemoryCoordinator - zero-infra, in-process Map-based (default/dev)
 *   2. RedisCoordinator  - shared-state via Redis pub/sub + hashes
 *
 * The coordinator is NOT responsible for game engine logic, fairness,
 * escrow, or transcript recording. Those remain separate concerns.
 * The coordinator IS responsible for:
 *   - Room registry (create, get, delete, list)
 *   - Player-to-room membership
 *   - Room player state (connected, ws ref)
 *   - Spectator connection tracking
 *   - Matchmaking queue state
 *   - Lease/ownership metadata for rooms, timers, and queue leadership
 *   - Room metadata (stakeId, hostId, status, createdAt, owner hints)
 *   - Live match snapshots for failover/reconnect hydration
 *
 * Design principles:
 *   - Operations are idempotent where possible
 *   - WebSocket references are always local (not serialisable)
 *   - The interface is narrow: only coordination data, not game state
 *   - Game state (MatchState) is stored alongside but managed by roomManager
 */

import type { WebSocket } from "ws";

// ── Coordinator Data Types ───────────────────────────────────────────

export type MatchPosture = "like_rated" | "wider_field";

export interface CoordinatorPlayer {
  userId: string;
  username: string;
  ws: WebSocket | null;
  connected: boolean;
  nodeId?: string;
  lastSeenAt?: number;
}

export interface CoordinatorRoom {
  id: string;
  hostId: string;
  players: Map<string, CoordinatorPlayer>;
  status: "waiting" | "playing" | "finished";
  createdAt: number;
  stakeId: string;
  timerSpeed?: string;
  ownerNodeId?: string;
  ownerLeaseExpiresAt?: number;
  timerOwnerNodeId?: string;
  timerLeaseExpiresAt?: number;
}

export interface RoomOwnershipUpdate {
  ownerNodeId?: string;
  ownerLeaseExpiresAt?: number;
  timerOwnerNodeId?: string;
  timerLeaseExpiresAt?: number;
}

export interface CoordinatorRoomActionRequest {
  requestId: string;
  targetNodeId: string;
  sourceNodeId: string;
  roomId: string;
  userId: string;
  username: string;
  message: unknown;
}

export interface CoordinatorRoomActionResponse {
  requestId: string;
  targetNodeId: string;
  sourceNodeId: string;
  roomId: string;
  userId: string;
  messages: unknown[];
  error?: string;
}

export interface CoordinatorNodeMessageDelivery {
  targetNodeId: string;
  sourceNodeId: string;
  roomId?: string;
  userId?: string;
  message: unknown;
  roomGameSnapshot?: CoordinatorGameStateSnapshot;
}

export interface CoordinatorTurnTimerSnapshot {
  activePlayerId: string;
  startedAt: number;
  expiresAt: number;
  totalSeconds: number;
}

export interface CoordinatorSpectatorConnection {
  ws: WebSocket | null;
  roomId: string;
  nodeId?: string;
  connectedAt?: number;
}

export interface CoordinatorQueueEntry {
  userId: string;
  username: string;
  rating: number;
  ws: WebSocket | null;
  enqueuedAt: number;
  stakeId: string;
  timerSpeed?: string;
  matchPosture?: MatchPosture;
  nodeId?: string;
  connected: boolean;
}

export interface CoordinatorGameStateSnapshot {
  match: unknown | null;
  lastShowdown: unknown | null;
  timer?: CoordinatorTurnTimerSnapshot | null;
  timeoutCounts?: Record<string, number>;
  updatedAt: number;
  nodeId: string;
}

export interface LeaseRecord {
  ownerId: string;
  expiresAt: number;
}

export type CoordinatorEventType =
  | "room_created"
  | "room_updated"
  | "room_deleted"
  | "player_room_set"
  | "player_room_removed"
  | "room_player_set"
  | "room_player_removed"
  | "matchmaking_enqueued"
  | "matchmaking_dequeued"
  | "matchmaking_cleared"
  | "room_game_state_set"
  | "room_game_state_cleared"
  | "lease_claimed"
  | "lease_renewed"
  | "lease_released"
  | "spectator_set"
  | "spectator_removed"
  | "relay_room_action_requested"
  | "relay_room_action_completed"
  | "relay_node_message";

export interface CoordinatorEvent {
  type: CoordinatorEventType;
  nodeId: string;
  timestamp: number;
  roomId?: string;
  userId?: string;
  leaseName?: string;
  payload?: Record<string, unknown>;
}

export type CoordinatorEventListener = (event: CoordinatorEvent) => void;

// ── Coordinator Interface ────────────────────────────────────────────

export interface RealtimeCoordinator {
  /** Coordinator mode identifier for logging/diagnostics */
  readonly mode: "memory" | "redis";

  /** Unique node identifier for ownership/lease metadata */
  getNodeId(): string;

  /** Optional lifecycle hooks for implementations that need network setup. */
  connect?(): Promise<boolean>;
  disconnect?(): Promise<void>;

  /** Subscribe to cross-instance coordination events. Returns an unsubscribe function. */
  subscribe(listener: CoordinatorEventListener): () => void;

  // ── Room Registry ──────────────────────────────────────────────────

  /** Create a room with the given ID and initial state. Idempotent if room already exists. */
  createRoom(room: CoordinatorRoom): void;

  /** Get a room by ID. Returns undefined if not found. */
  getRoom(roomId: string): CoordinatorRoom | undefined;

  /** Check if a room exists. */
  hasRoom(roomId: string): boolean;

  /** Delete a room. Idempotent. */
  deleteRoom(roomId: string): void;

  /** Iterate over all rooms. */
  getAllRooms(): Iterable<[string, CoordinatorRoom]>;

  /** Get the total number of rooms. */
  getRoomCount(): number;

  // ── Player-to-Room Membership ──────────────────────────────────────

  /** Map a player to a room. */
  setPlayerRoom(userId: string, roomId: string): void;

  /** Get the room ID a player is in. Returns undefined if not mapped. */
  getPlayerRoom(userId: string): string | undefined;

  /** Remove a player's room mapping. */
  removePlayerRoom(userId: string): void;

  /** Check if a player is mapped to any room. */
  hasPlayerRoom(userId: string): boolean;

  // ── Room Player Management ─────────────────────────────────────────

  /** Add or update a player in a room's player map. */
  setRoomPlayer(roomId: string, player: CoordinatorPlayer): void;

  /** Get a player from a room. */
  getRoomPlayer(roomId: string, userId: string): CoordinatorPlayer | undefined;

  /** Remove a player from a room. */
  removeRoomPlayer(roomId: string, userId: string): void;

  /** Get all players in a room. */
  getRoomPlayers(roomId: string): CoordinatorPlayer[];

  /** Get the number of players in a room. */
  getRoomPlayerCount(roomId: string): number;

  /** Check if a player is in a specific room. */
  isPlayerInRoom(roomId: string, userId: string): boolean;

  // ── Room Status ────────────────────────────────────────────────────

  /** Update a room's status. */
  setRoomStatus(roomId: string, status: "waiting" | "playing" | "finished"): void;

  /** Update room/timer ownership metadata without touching the roster or snapshot. */
  updateRoomOwnership(roomId: string, ownership: RoomOwnershipUpdate): void;

  /** Update the configured turn timer speed for a room. */
  updateRoomTimerSpeed(roomId: string, timerSpeed?: string): void;

  // ── Matchmaking Queue ──────────────────────────────────────────────

  /** Add a player to the shared matchmaking queue. */
  enqueueMatchmaking(entry: CoordinatorQueueEntry): void;

  /** Remove a player from the shared matchmaking queue. */
  dequeueMatchmaking(userId: string): void;

  /** Get the current shared matchmaking queue snapshot. */
  getMatchmakingQueueEntries(): CoordinatorQueueEntry[];

  /** Get the queue size. */
  getMatchmakingQueueSize(): number;

  /** Check if a user is currently queued. */
  isMatchmakingQueued(userId: string): boolean;

  /** Clear queue state (testing / cleanup). */
  clearMatchmakingQueue(): void;

  // ── Live Match Snapshots ─────────────────────────────────────────

  /** Persist the serializable live match snapshot for a room. */
  setRoomGameState(roomId: string, snapshot: CoordinatorGameStateSnapshot): void;

  /** Persist the serializable live match snapshot for a room and wait for the write barrier when supported. */
  commitRoomGameState(roomId: string, snapshot: CoordinatorGameStateSnapshot): Promise<void>;

  /** Fetch the latest live match snapshot for a room. */
  getRoomGameState(roomId: string): CoordinatorGameStateSnapshot | undefined;

  /** Clear the live match snapshot for a room. */
  clearRoomGameState(roomId: string): void;

  // ── Leases / Ownership ─────────────────────────────────────────────

  /** Claim a lease for a room, timer, or queue leadership. */
  claimLease(leaseName: string, ownerId: string, ttlMs: number): boolean;

  /** Claim a lease and wait for the authoritative backing store. */
  claimLeaseAuthoritatively(leaseName: string, ownerId: string, ttlMs: number): Promise<boolean>;

  /** Renew an existing lease if the caller still owns it. */
  renewLease(leaseName: string, ownerId: string, ttlMs: number): boolean;

  /** Renew a lease only if the authoritative store still has this owner. */
  renewLeaseAuthoritatively(leaseName: string, ownerId: string, ttlMs: number): Promise<boolean>;

  /** Release a lease if owned by the caller. */
  releaseLease(leaseName: string, ownerId: string): void;

  // ── Cross-node live relay ──────────────────────────────────────────

  /** Request that the owning node process a live room action. */
  requestRoomAction(request: CoordinatorRoomActionRequest): Promise<CoordinatorRoomActionResponse>;

  /** Complete a live room action request and return the captured response to the source node. */
  completeRoomAction(response: CoordinatorRoomActionResponse): void;

  /** Deliver a server message to a specific node so it can forward it to a local socket. */
  deliverNodeMessage(delivery: CoordinatorNodeMessageDelivery): void;

  /** Inspect the current lease state. */
  getLease(leaseName: string): LeaseRecord | undefined;

  // ── Spectator Connections ──────────────────────────────────────────

  /** Track a spectator WebSocket connection. */
  setSpectatorConnection(userId: string, connection: CoordinatorSpectatorConnection): void;

  /** Get a spectator's connection info. */
  getSpectatorConnection(userId: string): CoordinatorSpectatorConnection | undefined;

  /** Remove a spectator connection. */
  removeSpectatorConnection(userId: string): void;

  /** Check if a user has an active spectator connection. */
  hasSpectatorConnection(userId: string): boolean;

  // ── Diagnostics ────────────────────────────────────────────────────

  /** Health check - returns true if the coordinator is operational. */
  isHealthy(): boolean;

  /** Get diagnostic summary for admin/debug endpoints. */
  getDiagnostics(): CoordinatorDiagnostics;
}

// ── Diagnostics ──────────────────────────────────────────────────────

export interface CoordinatorDiagnostics {
  mode: "memory" | "redis";
  healthy: boolean;
  roomCount: number;
  playerMappingCount: number;
  spectatorConnectionCount: number;
  uptimeMs: number;
  nodeId: string;
  /** Extra details specific to the implementation */
  details: Record<string, unknown>;
}
