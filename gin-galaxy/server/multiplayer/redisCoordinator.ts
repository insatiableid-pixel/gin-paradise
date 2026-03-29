/**
 * Redis-Backed Coordinator Implementation.
 *
 * This coordinator stores room registry, player-to-room mappings, queue
 * state, and ownership leases in Redis while keeping a local mirror that
 * stays synchronized through Redis pub/sub events.
 *
 * WebSocket references remain local. Redis carries shared identity,
 * membership, queue, and ownership truth across processes.
 */

import crypto from "crypto";
import { createClient, type RedisClientType } from "redis";
import type {
  RealtimeCoordinator,
  CoordinatorPlayer,
  CoordinatorRoom,
  CoordinatorSpectatorConnection,
  CoordinatorDiagnostics,
  CoordinatorQueueEntry,
  CoordinatorGameStateSnapshot,
  CoordinatorEvent,
  CoordinatorEventListener,
  LeaseRecord,
  RoomOwnershipUpdate,
  CoordinatorRoomActionRequest,
  CoordinatorRoomActionResponse,
  CoordinatorNodeMessageDelivery,
} from "./coordinator.js";

export interface RedisCoordinatorConfig {
  url: string;
  keyPrefix: string;
  nodeId?: string;
}

interface RoomMeta {
  id: string;
  hostId: string;
  status: "waiting" | "playing" | "finished";
  createdAt: number;
  stakeId: string;
  timerSpeed?: string;
  ownerNodeId?: string;
  ownerLeaseExpiresAt?: number;
  timerOwnerNodeId?: string;
  timerLeaseExpiresAt?: number;
}

interface RoomRecord {
  meta: RoomMeta;
  players: Map<string, CoordinatorPlayer>;
}

interface SerializedRoomSnapshot extends RoomMeta {
  players: Array<{
    userId: string;
    username: string;
    connected: boolean;
    nodeId?: string;
    lastSeenAt?: number;
  }>;
}

function clonePlayer(player: CoordinatorPlayer): CoordinatorPlayer {
  return {
    userId: player.userId,
    username: player.username,
    ws: player.ws ?? null,
    connected: player.connected,
    nodeId: player.nodeId,
    lastSeenAt: player.lastSeenAt,
  };
}

function clonePlayerForWire(player: CoordinatorPlayer): SerializedRoomSnapshot["players"][number] {
  return {
    userId: player.userId,
    username: player.username,
    connected: player.connected,
    nodeId: player.nodeId,
    lastSeenAt: player.lastSeenAt,
  };
}

function parseRoomSnapshot(raw: string): SerializedRoomSnapshot | null {
  try {
    return JSON.parse(raw) as SerializedRoomSnapshot;
  } catch {
    return null;
  }
}

function parseQueueEntry(raw: string): CoordinatorQueueEntry | null {
  try {
    const parsed = JSON.parse(raw) as CoordinatorQueueEntry;
    return { ...parsed, ws: null, connected: parsed.connected ?? true };
  } catch {
    return null;
  }
}

function parseLease(raw: string): LeaseRecord | null {
  try {
    return JSON.parse(raw) as LeaseRecord;
  } catch {
    return null;
  }
}

function parseGameSnapshot(raw: string): CoordinatorGameStateSnapshot | null {
  try {
    return JSON.parse(raw) as CoordinatorGameStateSnapshot;
  } catch {
    return null;
  }
}

class RedisRoomPlayers extends Map<string, CoordinatorPlayer> {
  constructor(
    private readonly coordinator: RedisCoordinator,
    private readonly roomId: string,
    initialEntries?: Iterable<[string, CoordinatorPlayer]>,
  ) {
    super();
    if (initialEntries) {
      for (const [userId, player] of initialEntries) {
        super.set(userId, clonePlayer(player));
      }
    }
  }

  override set(userId: string, player: CoordinatorPlayer): this {
    super.set(userId, clonePlayer(player));
    this.coordinator.syncRoomPlayers(this.roomId, this);
    return this;
  }

  override delete(userId: string): boolean {
    const deleted = super.delete(userId);
    if (deleted) {
      this.coordinator.syncRoomPlayers(this.roomId, this);
    }
    return deleted;
  }

  override clear(): void {
    if (this.size === 0) return;
    super.clear();
    this.coordinator.syncRoomPlayers(this.roomId, this);
  }
}

export class RedisCoordinator implements RealtimeCoordinator {
  readonly mode = "redis" as const;

  private readonly config: RedisCoordinatorConfig;
  private readonly nodeId: string;
  private readonly eventChannel: string;
  private readonly startedAt = Date.now();
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly playerToRoom = new Map<string, string>();
  private readonly spectatorConnections = new Map<string, CoordinatorSpectatorConnection>();
  private readonly matchmakingQueue = new Map<string, CoordinatorQueueEntry>();
  private readonly roomGameSnapshots = new Map<string, CoordinatorGameStateSnapshot>();
  private readonly leases = new Map<string, LeaseRecord>();
  private readonly listeners = new Set<CoordinatorEventListener>();
  private readonly pendingRoomActionResolvers = new Map<
    string,
    { resolve: (response: CoordinatorRoomActionResponse) => void; timer: ReturnType<typeof setTimeout> }
  >();

  private commandClient: RedisClientType | null = null;
  private subscriberClient: RedisClientType | null = null;
  private redisConnected = false;
  private connectPromise: Promise<boolean> | null = null;
  private commandContextVersion = 0;

  constructor(config: RedisCoordinatorConfig) {
    this.config = config;
    this.nodeId = config.nodeId || `redis-${crypto.randomUUID()}`;
    this.eventChannel = this.key("coordinator:events");

    console.log(`[RedisCoordinator] Initializing with URL: ${config.url}, prefix: ${config.keyPrefix}`);
    console.log(`[RedisCoordinator] Node ID: ${this.nodeId}`);
  }

  getNodeId(): string {
    return this.nodeId;
  }

  subscribe(listener: CoordinatorEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  requestRoomAction(request: CoordinatorRoomActionRequest): Promise<CoordinatorRoomActionResponse> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const pending = this.pendingRoomActionResolvers.get(request.requestId);
        if (!pending) return;
        this.pendingRoomActionResolvers.delete(request.requestId);
        pending.resolve({
          requestId: request.requestId,
          targetNodeId: request.sourceNodeId,
          sourceNodeId: request.targetNodeId,
          roomId: request.roomId,
          userId: request.userId,
          messages: [],
          error: "Relay request timed out.",
        });
      }, 5000);
      timer.unref?.();

      this.pendingRoomActionResolvers.set(request.requestId, { resolve, timer });
      this.emit({
        type: "relay_room_action_requested",
        roomId: request.roomId,
        userId: request.userId,
        payload: { request },
      });
    });
  }

  completeRoomAction(response: CoordinatorRoomActionResponse): void {
    const pending = this.pendingRoomActionResolvers.get(response.requestId);
    if (pending && response.targetNodeId === this.nodeId) {
      clearTimeout(pending.timer);
      this.pendingRoomActionResolvers.delete(response.requestId);
      pending.resolve(response);
    }

    this.emit({
      type: "relay_room_action_completed",
      roomId: response.roomId,
      userId: response.userId,
      payload: { response },
    });
  }

  deliverNodeMessage(delivery: CoordinatorNodeMessageDelivery): void {
    this.emit({
      type: "relay_node_message",
      roomId: delivery.roomId,
      userId: delivery.userId,
      payload: { delivery },
    });
  }

  async connect(): Promise<boolean> {
    if (this.redisConnected) return true;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      try {
        if (!this.commandClient) {
          this.commandClient = createClient({ url: this.config.url });
          this.commandClient.on("error", (err) => {
            console.error(`[RedisCoordinator] Redis command client error: ${err}`);
            this.redisConnected = false;
          });
        }
        if (!this.subscriberClient) {
          this.subscriberClient = this.commandClient.duplicate();
          this.subscriberClient.on("error", (err) => {
            console.error(`[RedisCoordinator] Redis subscriber error: ${err}`);
            this.redisConnected = false;
          });
        }

        if (!this.commandClient.isOpen) {
          await this.commandClient.connect();
        }
        if (!this.subscriberClient.isOpen) {
          await this.subscriberClient.connect();
        }

        this.commandContextVersion += 1;
        await this.subscriberClient.unsubscribe(this.eventChannel).catch(() => undefined);
        await this.subscriberClient.subscribe(this.eventChannel, (message) => this.handleInboundEvent(message));

        await this.loadSnapshotFromRedis();
        this.redisConnected = true;
        return true;
      } catch (err) {
        console.error(`[RedisCoordinator] Failed to connect to Redis: ${err}`);
        await this.disconnect().catch(() => undefined);
        this.redisConnected = false;
        return false;
      } finally {
        this.connectPromise = null;
      }
    })();

    return this.connectPromise;
  }

  async disconnect(): Promise<void> {
    this.redisConnected = false;
    this.commandContextVersion += 1;
    this.rooms.clear();
    this.playerToRoom.clear();
    this.spectatorConnections.clear();
    this.matchmakingQueue.clear();
    this.roomGameSnapshots.clear();
    this.leases.clear();

    const subscriber = this.subscriberClient;
    const command = this.commandClient;
    this.subscriberClient = null;
    this.commandClient = null;

    if (subscriber) {
      try {
        await subscriber.quit();
      } catch {
        try {
          await subscriber.disconnect();
        } catch {}
      }
    }

    if (command) {
      try {
        await command.quit();
      } catch {
        try {
          await command.disconnect();
        } catch {}
      }
    }
  }

  // ── Room Registry ────────────────────────────────────────────────

  createRoom(room: CoordinatorRoom): void {
    const record = this.toRoomRecord(room);
    this.rooms.set(room.id, record);
    for (const userId of record.players.keys()) {
      this.playerToRoom.set(userId, room.id);
      this.persistPlayerRoom(userId, room.id);
    }
    this.persistRoom(room.id);
    this.emit({
      type: "room_created",
      roomId: room.id,
      payload: { room: this.serializeRoom(room.id) },
    });
  }

  getRoom(roomId: string): CoordinatorRoom | undefined {
    const record = this.rooms.get(roomId);
    if (!record) return undefined;
    return this.toRoomView(roomId, record);
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  deleteRoom(roomId: string): void {
    const record = this.rooms.get(roomId);
    if (record) {
      for (const userId of record.players.keys()) {
        if (this.playerToRoom.get(userId) === roomId) {
          this.playerToRoom.delete(userId);
          this.persistPlayerRoom(userId, undefined);
        }
      }
    }

    this.rooms.delete(roomId);
    this.clearRoomGameState(roomId);
    this.persistRoomDeletion(roomId);
    this.emit({ type: "room_deleted", roomId });
  }

  getAllRooms(): Iterable<[string, CoordinatorRoom]> {
    return Array.from(this.rooms.entries()).map(([roomId, record]) => [
      roomId,
      this.toRoomView(roomId, record),
    ] as [string, CoordinatorRoom]);
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  // ── Player-to-Room Membership ──────────────────────────────────

  setPlayerRoom(userId: string, roomId: string): void {
    this.playerToRoom.set(userId, roomId);
    this.persistPlayerRoom(userId, roomId);
    this.emit({ type: "player_room_set", roomId, userId, payload: { roomId } });
  }

  getPlayerRoom(userId: string): string | undefined {
    return this.playerToRoom.get(userId);
  }

  removePlayerRoom(userId: string): void {
    const roomId = this.playerToRoom.get(userId);
    this.playerToRoom.delete(userId);
    this.persistPlayerRoom(userId, undefined);
    this.emit({ type: "player_room_removed", roomId, userId });
  }

  hasPlayerRoom(userId: string): boolean {
    return this.playerToRoom.has(userId);
  }

  // ── Room Player Management ─────────────────────────────────────

  setRoomPlayer(roomId: string, player: CoordinatorPlayer): void {
    this.setRoomPlayerRecord(roomId, player, true);
  }

  getRoomPlayer(roomId: string, userId: string): CoordinatorPlayer | undefined {
    return this.rooms.get(roomId)?.players.get(userId);
  }

  removeRoomPlayer(roomId: string, userId: string): void {
    this.removeRoomPlayerRecord(roomId, userId, true);
  }

  getRoomPlayers(roomId: string): CoordinatorPlayer[] {
    return Array.from(this.rooms.get(roomId)?.players.values() ?? []);
  }

  getRoomPlayerCount(roomId: string): number {
    return this.rooms.get(roomId)?.players.size ?? 0;
  }

  isPlayerInRoom(roomId: string, userId: string): boolean {
    return this.rooms.get(roomId)?.players.has(userId) ?? false;
  }

  // ── Room Status ────────────────────────────────────────────────────

  setRoomStatus(roomId: string, status: "waiting" | "playing" | "finished"): void {
    const record = this.rooms.get(roomId);
    if (!record) return;
    record.meta.status = status;
    this.persistRoom(roomId);
    this.emit({ type: "room_updated", roomId, payload: { room: this.serializeRoom(roomId) } });
  }

  updateRoomOwnership(roomId: string, ownership: RoomOwnershipUpdate): void {
    const record = this.rooms.get(roomId);
    if (!record) return;

    if ("ownerNodeId" in ownership) record.meta.ownerNodeId = ownership.ownerNodeId;
    if ("ownerLeaseExpiresAt" in ownership) record.meta.ownerLeaseExpiresAt = ownership.ownerLeaseExpiresAt;
    if ("timerOwnerNodeId" in ownership) record.meta.timerOwnerNodeId = ownership.timerOwnerNodeId;
    if ("timerLeaseExpiresAt" in ownership) record.meta.timerLeaseExpiresAt = ownership.timerLeaseExpiresAt;

    this.persistRoom(roomId);
    this.emit({ type: "room_updated", roomId, payload: { room: this.serializeRoom(roomId) } });
  }

  updateRoomTimerSpeed(roomId: string, timerSpeed?: string): void {
    const record = this.rooms.get(roomId);
    if (!record) return;

    record.meta.timerSpeed = timerSpeed;
    this.persistRoom(roomId);
    this.emit({ type: "room_updated", roomId, payload: { room: this.serializeRoom(roomId) } });
  }

  // ── Matchmaking Queue ──────────────────────────────────────────────

  enqueueMatchmaking(entry: CoordinatorQueueEntry): void {
    const normalized = this.normalizeQueueEntry(entry);
    this.matchmakingQueue.set(normalized.userId, normalized);
    this.persistQueueEntry(normalized);
    this.emit({
      type: "matchmaking_enqueued",
      userId: normalized.userId,
      payload: { entry: normalized },
    });
  }

  dequeueMatchmaking(userId: string): void {
    const existing = this.matchmakingQueue.get(userId);
    this.matchmakingQueue.delete(userId);
    this.persistQueueRemoval(userId);
    this.emit({
      type: "matchmaking_dequeued",
      userId,
      payload: { entry: existing ?? null },
    });
  }

  getMatchmakingQueueEntries(): CoordinatorQueueEntry[] {
    return Array.from(this.matchmakingQueue.values());
  }

  getMatchmakingQueueSize(): number {
    return this.matchmakingQueue.size;
  }

  isMatchmakingQueued(userId: string): boolean {
    return this.matchmakingQueue.has(userId);
  }

  clearMatchmakingQueue(): void {
    this.matchmakingQueue.clear();
    this.persistQueueClear();
    this.emit({ type: "matchmaking_cleared" });
  }

  // ── Live Match Snapshots ─────────────────────────────────────────

  setRoomGameState(roomId: string, snapshot: CoordinatorGameStateSnapshot): void {
    const normalized = this.normalizeGameSnapshot(snapshot);
    this.roomGameSnapshots.set(roomId, normalized);
    this.persistRoomGameState(roomId, normalized);
    this.emit({
      type: "room_game_state_set",
      roomId,
      payload: { snapshot: normalized },
    });
  }

  async commitRoomGameState(roomId: string, snapshot: CoordinatorGameStateSnapshot): Promise<void> {
    const normalized = this.normalizeGameSnapshot(snapshot);
    this.roomGameSnapshots.set(roomId, normalized);

    const envelope = this.createEventEnvelope({
      type: "room_game_state_set",
      roomId,
      payload: { snapshot: normalized },
    });
    const context = this.captureCommandContext();

    if (!context) {
      this.persistRoomGameState(roomId, normalized);
      this.dispatchLocalEvent(envelope);
      this.publishEvent(envelope);
      return;
    }

    const { client, version } = context;
    const payload = JSON.stringify(normalized);

    try {
      await client
        .multi()
        .set(this.roomGameSnapshotKey(roomId), payload)
        .publish(this.eventChannel, JSON.stringify(envelope))
        .exec();
    } catch (err) {
      if (!this.shouldSuppressBestEffortError(client, version, err)) {
        console.error(`[RedisCoordinator] Failed to durably persist room game snapshot for ${roomId}: ${err}`);
      }
      this.persistRoomGameState(roomId, normalized);
      this.publishEvent(envelope);
    }

    this.dispatchLocalEvent(envelope);
  }

  getRoomGameState(roomId: string): CoordinatorGameStateSnapshot | undefined {
    const snapshot = this.roomGameSnapshots.get(roomId);
    return snapshot ? this.normalizeGameSnapshot(snapshot) : undefined;
  }

  clearRoomGameState(roomId: string): void {
    const removed = this.roomGameSnapshots.delete(roomId);
    this.persistRoomGameStateRemoval(roomId);
    if (removed) {
      this.emit({ type: "room_game_state_cleared", roomId });
    }
  }

  // ── Leases / Ownership ─────────────────────────────────────────────

  claimLease(leaseName: string, ownerId: string, ttlMs: number): boolean {
    const now = Date.now();
    const existing = this.leases.get(leaseName);
    if (existing && existing.expiresAt > now && existing.ownerId !== ownerId) {
      return false;
    }

    const record = { ownerId, expiresAt: now + ttlMs };
    this.leases.set(leaseName, record);
    this.persistLease(leaseName, record, ttlMs, "claim");
    this.emit({ type: "lease_claimed", leaseName, payload: { lease: record } });
    return true;
  }

  renewLease(leaseName: string, ownerId: string, ttlMs: number): boolean {
    const existing = this.leases.get(leaseName);
    if (!existing || existing.ownerId !== ownerId) {
      return false;
    }

    const record = { ownerId, expiresAt: Date.now() + ttlMs };
    this.leases.set(leaseName, record);
    this.persistLease(leaseName, record, ttlMs, "renew");
    this.emit({ type: "lease_renewed", leaseName, payload: { lease: record } });
    return true;
  }

  releaseLease(leaseName: string, ownerId: string): void {
    const existing = this.leases.get(leaseName);
    if (!existing || existing.ownerId !== ownerId) {
      return;
    }

    this.leases.delete(leaseName);
    this.persistLeaseRemoval(leaseName);
    this.emit({ type: "lease_released", leaseName, payload: { ownerId } });
  }

  getLease(leaseName: string): LeaseRecord | undefined {
    const existing = this.leases.get(leaseName);
    if (!existing) return undefined;
    if (existing.expiresAt <= Date.now()) {
      this.leases.delete(leaseName);
      return undefined;
    }
    return existing;
  }

  // ── Spectator Connections ──────────────────────────────────────────

  setSpectatorConnection(userId: string, connection: CoordinatorSpectatorConnection): void {
    const normalized: CoordinatorSpectatorConnection = {
      ws: connection.ws ?? null,
      roomId: connection.roomId,
      nodeId: connection.nodeId ?? this.nodeId,
      connectedAt: connection.connectedAt ?? Date.now(),
    };
    this.spectatorConnections.set(userId, normalized);
    this.persistSpectatorConnection(userId, normalized);
    this.emit({ type: "spectator_set", userId, roomId: normalized.roomId, payload: { connection: normalized } });
  }

  getSpectatorConnection(userId: string): CoordinatorSpectatorConnection | undefined {
    return this.spectatorConnections.get(userId);
  }

  removeSpectatorConnection(userId: string): void {
    const existing = this.spectatorConnections.get(userId);
    this.spectatorConnections.delete(userId);
    this.persistSpectatorRemoval(userId);
    this.emit({
      type: "spectator_removed",
      userId,
      roomId: existing?.roomId,
      payload: { connection: existing ?? null },
    });
  }

  hasSpectatorConnection(userId: string): boolean {
    return this.spectatorConnections.has(userId);
  }

  // ── Diagnostics ────────────────────────────────────────────────

  isHealthy(): boolean {
    return this.redisConnected && !!this.commandClient?.isOpen && !!this.subscriberClient?.isOpen;
  }

  getDiagnostics(): CoordinatorDiagnostics {
    return {
      mode: "redis",
      healthy: this.isHealthy(),
      roomCount: this.rooms.size,
      playerMappingCount: this.playerToRoom.size,
      spectatorConnectionCount: this.spectatorConnections.size,
      uptimeMs: Date.now() - this.startedAt,
      nodeId: this.nodeId,
      details: {
        implementation: "Redis-backed with local mirror + pub/sub events",
        redisUrl: this.maskRedisUrl(this.config.url),
        keyPrefix: this.config.keyPrefix,
        redisConnected: this.redisConnected,
        sharedState: this.redisConnected,
        nodeId: this.nodeId,
        queueSize: this.matchmakingQueue.size,
        roomGameSnapshotCount: this.roomGameSnapshots.size,
        leaseCount: this.leases.size,
        eventSubscribers: this.listeners.size,
        requiresExternalInfra: true,
      },
    };
  }

  // ── Internal room helpers ──────────────────────────────────────────

  private toRoomRecord(room: CoordinatorRoom): RoomRecord {
    const meta: RoomMeta = {
      id: room.id,
      hostId: room.hostId,
      status: room.status,
      createdAt: room.createdAt,
      stakeId: room.stakeId,
      ownerNodeId: room.ownerNodeId,
      ownerLeaseExpiresAt: room.ownerLeaseExpiresAt,
      timerOwnerNodeId: room.timerOwnerNodeId,
      timerLeaseExpiresAt: room.timerLeaseExpiresAt,
    };

    const players = new Map<string, CoordinatorPlayer>();
    for (const [userId, player] of room.players.entries()) {
      players.set(userId, clonePlayer(player));
    }

    return { meta, players };
  }

  private toRoomView(roomId: string, record: RoomRecord): CoordinatorRoom {
    return {
      id: roomId,
      hostId: record.meta.hostId,
      players: new RedisRoomPlayers(this, roomId, record.players),
      status: record.meta.status,
      createdAt: record.meta.createdAt,
      stakeId: record.meta.stakeId,
      timerSpeed: record.meta.timerSpeed,
      ownerNodeId: record.meta.ownerNodeId,
      ownerLeaseExpiresAt: record.meta.ownerLeaseExpiresAt,
      timerOwnerNodeId: record.meta.timerOwnerNodeId,
      timerLeaseExpiresAt: record.meta.timerLeaseExpiresAt,
    };
  }

  private serializeRoom(roomId: string): SerializedRoomSnapshot | null {
    const record = this.rooms.get(roomId);
    if (!record) return null;
    return {
      ...record.meta,
      players: Array.from(record.players.values()).map(clonePlayerForWire),
    };
  }

  private replaceRoomFromSnapshot(snapshot: SerializedRoomSnapshot): void {
    const previous = this.rooms.get(snapshot.id);
    const players = new Map<string, CoordinatorPlayer>();
    for (const player of snapshot.players) {
      const previousPlayer = previous?.players.get(player.userId);
      const nextNodeId = player.nodeId ?? previousPlayer?.nodeId;
      const preserveSocket =
        !!previousPlayer?.ws &&
        (!!player.nodeId ? previousPlayer.nodeId === player.nodeId : previousPlayer.nodeId === this.nodeId);
      players.set(player.userId, {
        userId: player.userId,
        username: player.username,
        ws: preserveSocket ? previousPlayer.ws : null,
        connected: player.connected ?? previousPlayer?.connected ?? false,
        nodeId: nextNodeId,
        lastSeenAt: player.lastSeenAt ?? previousPlayer?.lastSeenAt,
      });
      this.playerToRoom.set(player.userId, snapshot.id);
      this.persistPlayerRoom(player.userId, snapshot.id);
    }

    if (previous) {
      for (const userId of previous.players.keys()) {
        if (!players.has(userId) && this.playerToRoom.get(userId) === snapshot.id) {
          this.playerToRoom.delete(userId);
          this.persistPlayerRoom(userId, undefined);
        }
      }
    }

    this.rooms.set(snapshot.id, {
      meta: {
        id: snapshot.id,
      hostId: snapshot.hostId,
      status: snapshot.status,
      createdAt: snapshot.createdAt,
      stakeId: snapshot.stakeId,
      timerSpeed: snapshot.timerSpeed,
      ownerNodeId: snapshot.ownerNodeId,
      ownerLeaseExpiresAt: snapshot.ownerLeaseExpiresAt,
      timerOwnerNodeId: snapshot.timerOwnerNodeId,
      timerLeaseExpiresAt: snapshot.timerLeaseExpiresAt,
      },
      players,
    });

    this.syncLeaseCacheFromRoomSnapshot(snapshot);
  }

  private setRoomPlayerRecord(roomId: string, player: CoordinatorPlayer, emitEvent: boolean): void {
    const record = this.rooms.get(roomId);
    if (!record) return;

    record.players.set(player.userId, clonePlayer(player));
    this.playerToRoom.set(player.userId, roomId);
    this.persistPlayerRoom(player.userId, roomId);
    this.persistRoom(roomId);

    if (emitEvent) {
      this.emit({
        type: "room_player_set",
        roomId,
        userId: player.userId,
        payload: { room: this.serializeRoom(roomId), player: clonePlayerForWire(player) },
      });
      this.emit({
        type: "player_room_set",
        roomId,
        userId: player.userId,
        payload: { roomId },
      });
    }
  }

  private removeRoomPlayerRecord(roomId: string, userId: string, emitEvent: boolean): void {
    const record = this.rooms.get(roomId);
    if (!record) return;

    const removed = record.players.delete(userId);
    if (!removed) return;

    if (this.playerToRoom.get(userId) === roomId) {
      this.playerToRoom.delete(userId);
      this.persistPlayerRoom(userId, undefined);
    }

    this.persistRoom(roomId);

    if (emitEvent) {
      this.emit({
        type: "room_player_removed",
        roomId,
        userId,
        payload: { room: this.serializeRoom(roomId), userId },
      });
      this.emit({
        type: "player_room_removed",
        roomId,
        userId,
        payload: { roomId },
      });
    }
  }

  syncRoomPlayers(roomId: string, players: Map<string, CoordinatorPlayer>): void {
    const record = this.rooms.get(roomId);
    if (!record) return;

    const nextPlayers = new Map<string, CoordinatorPlayer>();
    for (const [userId, player] of players.entries()) {
      nextPlayers.set(userId, clonePlayer(player));
    }

    const previousUserIds = new Set(record.players.keys());
    record.players = nextPlayers;
    for (const [userId] of nextPlayers.entries()) {
      this.playerToRoom.set(userId, roomId);
      this.persistPlayerRoom(userId, roomId);
      previousUserIds.delete(userId);
    }

    for (const userId of previousUserIds) {
      if (this.playerToRoom.get(userId) === roomId) {
        this.playerToRoom.delete(userId);
        this.persistPlayerRoom(userId, undefined);
      }
    }

    this.persistRoom(roomId);
    this.emit({ type: "room_updated", roomId, payload: { room: this.serializeRoom(roomId) } });
  }

  // ── Internal persistence ───────────────────────────────────────────

  private persistRoom(roomId: string): void {
    const snapshot = this.serializeRoom(roomId);
    if (!snapshot) return;

    this.runBestEffortCommand(`Failed to persist room ${roomId}`, async (client) => {
      await client.set(this.roomSnapshotKey(roomId), JSON.stringify(snapshot));
      await client.sAdd(this.roomIndexKey(), roomId);
    });
  }

  private persistRoomDeletion(roomId: string): void {
    this.runBestEffortCommand(`Failed to delete room ${roomId}`, async (client) => {
      await client.del(this.roomSnapshotKey(roomId));
      await client.sRem(this.roomIndexKey(), roomId);
    });
  }

  private persistRoomGameState(roomId: string, snapshot: CoordinatorGameStateSnapshot): void {
    const payload = JSON.stringify(this.normalizeGameSnapshot(snapshot));
    this.runBestEffortCommand(`Failed to persist room game snapshot for ${roomId}`, async (client) => {
      await client.set(this.roomGameSnapshotKey(roomId), payload);
    });
  }

  private persistRoomGameStateRemoval(roomId: string): void {
    this.runBestEffortCommand(`Failed to remove room game snapshot for ${roomId}`, async (client) => {
      await client.del(this.roomGameSnapshotKey(roomId));
    });
  }

  private persistPlayerRoom(userId: string, roomId: string | undefined): void {
    this.runBestEffortCommand(`Failed to persist player room mapping for ${userId}`, async (client) => {
      if (roomId) {
        await client.hSet(this.playerRoomKey(), userId, roomId);
      } else {
        await client.hDel(this.playerRoomKey(), userId);
      }
    });
  }

  private persistQueueEntry(entry: CoordinatorQueueEntry): void {
    const payload = JSON.stringify(this.normalizeQueueEntry(entry));
    this.runBestEffortCommand(`Failed to persist queue entry ${entry.userId}`, async (client) => {
      await client.set(this.queueEntryKey(entry.userId), payload);
      await client.zAdd(this.queueIndexKey(), [{ score: entry.enqueuedAt, value: entry.userId }]);
    });
  }

  private persistQueueRemoval(userId: string): void {
    this.runBestEffortCommand(`Failed to remove queue entry ${userId}`, async (client) => {
      await client.del(this.queueEntryKey(userId));
      await client.zRem(this.queueIndexKey(), userId);
    });
  }

  private persistQueueClear(): void {
    this.runBestEffortCommand("Failed to clear matchmaking queue", async (client) => {
      const keys = await client.keys(this.queueEntryKey("*"));
      if (keys.length > 0) {
        for (const key of keys) {
          await client.del(key);
        }
      }
      await client.del(this.queueIndexKey());
    });
  }

  private persistSpectatorConnection(userId: string, connection: CoordinatorSpectatorConnection): void {
    const payload = JSON.stringify({
      roomId: connection.roomId,
      nodeId: connection.nodeId ?? this.nodeId,
      connectedAt: connection.connectedAt ?? Date.now(),
    });

    this.runBestEffortCommand(`Failed to persist spectator connection ${userId}`, async (client) => {
      await client.hSet(this.spectatorKey(), userId, payload);
    });
  }

  private persistSpectatorRemoval(userId: string): void {
    this.runBestEffortCommand(`Failed to remove spectator connection ${userId}`, async (client) => {
      await client.hDel(this.spectatorKey(), userId);
    });
  }

  private persistLease(leaseName: string, record: LeaseRecord, ttlMs: number, mode: "claim" | "renew"): void {
    this.runBestEffortCommand(`Failed to persist lease ${leaseName}`, async (client) => {
      const key = this.leaseKey(leaseName);
      const payload = JSON.stringify(record);
      if (mode === "claim") {
        const result = await client.set(key, payload, { NX: true, PX: ttlMs });
        if (result !== "OK") {
          const remote = await client.get(key);
          const parsed = remote ? parseLease(remote) : null;
          if (parsed) {
            this.leases.set(leaseName, parsed);
          } else {
            this.leases.delete(leaseName);
          }
        }
      } else {
        const result = await client.set(key, payload, { XX: true, PX: ttlMs });
        if (result !== "OK") {
          const remote = await client.get(key);
          const parsed = remote ? parseLease(remote) : null;
          if (parsed) {
            this.leases.set(leaseName, parsed);
          } else {
            this.leases.delete(leaseName);
          }
        }
      }
    });
  }

  private persistLeaseRemoval(leaseName: string): void {
    this.runBestEffortCommand(`Failed to remove lease ${leaseName}`, async (client) => {
      await client.del(this.leaseKey(leaseName));
    });
  }

  private async loadSnapshotFromRedis(): Promise<void> {
    const client = this.commandClient;
    if (!client) return;

    this.rooms.clear();
    this.playerToRoom.clear();
    this.spectatorConnections.clear();
    this.matchmakingQueue.clear();
    this.roomGameSnapshots.clear();
    this.leases.clear();

    const roomIds = await client.sMembers(this.roomIndexKey());
    for (const roomId of roomIds) {
      const raw = await client.get(this.roomSnapshotKey(roomId));
      if (!raw) continue;
      const snapshot = parseRoomSnapshot(raw);
      if (!snapshot) continue;
      this.replaceRoomFromSnapshot(snapshot);
      const gameRaw = await client.get(this.roomGameSnapshotKey(roomId));
      if (gameRaw) {
        const gameSnapshot = parseGameSnapshot(gameRaw);
        if (gameSnapshot) {
          this.roomGameSnapshots.set(roomId, this.normalizeGameSnapshot(gameSnapshot));
        }
      }
    }

    const playerMappings = await client.hGetAll(this.playerRoomKey());
    for (const [userId, roomId] of Object.entries(playerMappings)) {
      const room = this.rooms.get(roomId);
      if (room?.players.has(userId)) {
        this.playerToRoom.set(userId, roomId);
      } else {
        this.persistPlayerRoom(userId, undefined);
      }
    }

    const queueIds = await client.zRange(this.queueIndexKey(), 0, -1);
    for (const userId of queueIds) {
      const raw = await client.get(this.queueEntryKey(userId));
      if (!raw) continue;
      const entry = parseQueueEntry(raw);
      if (!entry) continue;
      this.matchmakingQueue.set(userId, entry);
    }

    const spectatorRecords = await client.hGetAll(this.spectatorKey());
    for (const [userId, raw] of Object.entries(spectatorRecords)) {
      try {
        const data = JSON.parse(raw) as { roomId: string; nodeId?: string; connectedAt?: number };
        this.spectatorConnections.set(userId, {
          ws: null,
          roomId: data.roomId,
          nodeId: data.nodeId,
          connectedAt: data.connectedAt,
        });
      } catch {
        // ignore malformed spectator rows
      }
    }

    for await (const key of client.scanIterator({ MATCH: this.leaseKey("*"), COUNT: 50 })) {
      const raw = await client.get(key);
      if (!raw) continue;
      const leaseName = this.extractLeaseName(key);
      const lease = parseLease(raw);
      if (lease && leaseName) {
        this.leases.set(leaseName, lease);
      }
    }
  }

  private handleInboundEvent(message: string): void {
    try {
      const event = JSON.parse(message) as CoordinatorEvent;
      if (event.nodeId === this.nodeId) {
        return;
      }
      this.applyRemoteEvent(event);
      this.dispatchLocalEvent(event);
    } catch (err) {
      console.error(`[RedisCoordinator] Failed to decode coordination event: ${err}`);
    }
  }

  private applyRemoteEvent(event: CoordinatorEvent): void {
    switch (event.type) {
      case "room_created":
      case "room_updated":
      case "room_player_set":
      case "room_player_removed": {
        const snapshot = event.payload?.room as SerializedRoomSnapshot | undefined;
        if (snapshot) {
          this.replaceRoomFromSnapshot(snapshot);
        }
        break;
      }

      case "room_deleted": {
        if (event.roomId) {
          const record = this.rooms.get(event.roomId);
          if (record) {
            for (const userId of record.players.keys()) {
              if (this.playerToRoom.get(userId) === event.roomId) {
                this.playerToRoom.delete(userId);
              }
            }
          }
          this.rooms.delete(event.roomId);
          this.roomGameSnapshots.delete(event.roomId);
        }
        break;
      }

      case "player_room_set": {
        if (event.userId && event.roomId) {
          this.playerToRoom.set(event.userId, event.roomId);
        }
        break;
      }

      case "player_room_removed": {
        if (event.userId) {
          this.playerToRoom.delete(event.userId);
        }
        break;
      }

      case "matchmaking_enqueued": {
        const entry = event.payload?.entry as CoordinatorQueueEntry | undefined;
        if (entry) {
          this.matchmakingQueue.set(entry.userId, this.normalizeQueueEntry(entry));
        }
        break;
      }

      case "matchmaking_dequeued": {
        if (event.userId) {
          this.matchmakingQueue.delete(event.userId);
        }
        break;
      }

      case "matchmaking_cleared": {
        this.matchmakingQueue.clear();
        break;
      }

      case "room_game_state_set": {
        const snapshot = event.payload?.snapshot as CoordinatorGameStateSnapshot | undefined;
        if (event.roomId && snapshot) {
          this.roomGameSnapshots.set(event.roomId, this.normalizeGameSnapshot(snapshot));
        }
        break;
      }

      case "room_game_state_cleared": {
        if (event.roomId) {
          this.roomGameSnapshots.delete(event.roomId);
        }
        break;
      }

      case "spectator_set": {
        const connection = event.payload?.connection as
          | { roomId: string; nodeId?: string; connectedAt?: number }
          | undefined;
        if (event.userId && connection) {
          this.spectatorConnections.set(event.userId, {
            ws: null,
            roomId: connection.roomId,
            nodeId: connection.nodeId,
            connectedAt: connection.connectedAt,
          });
        }
        break;
      }

      case "spectator_removed": {
        if (event.userId) {
          this.spectatorConnections.delete(event.userId);
        }
        break;
      }

      case "lease_claimed":
      case "lease_renewed": {
        if (event.leaseName) {
          const lease = event.payload?.lease as LeaseRecord | undefined;
          if (lease) {
            this.leases.set(event.leaseName, lease);
          }
        }
        break;
      }

      case "lease_released": {
        if (event.leaseName) {
          this.leases.delete(event.leaseName);
        }
        break;
      }

      case "relay_room_action_completed": {
        const response = event.payload?.response as CoordinatorRoomActionResponse | undefined;
        if (response && response.targetNodeId === this.nodeId) {
          const pending = this.pendingRoomActionResolvers.get(response.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRoomActionResolvers.delete(response.requestId);
            pending.resolve(response);
          }
        }
        break;
      }

      case "relay_room_action_requested":
      case "relay_node_message":
        break;
    }
  }

  private dispatchLocalEvent(event: CoordinatorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors to keep the coordinator healthy.
      }
    }
  }

  private emit(event: Omit<CoordinatorEvent, "nodeId" | "timestamp">): void {
    const envelope = this.createEventEnvelope(event);

    this.dispatchLocalEvent(envelope);
    this.publishEvent(envelope);
  }

  private createEventEnvelope(event: Omit<CoordinatorEvent, "nodeId" | "timestamp">): CoordinatorEvent {
    return {
      ...event,
      nodeId: this.nodeId,
      timestamp: Date.now(),
    };
  }

  private publishEvent(event: CoordinatorEvent): void {
    this.runBestEffortCommand("Failed to publish coordination event", async (client) => {
      await client.publish(this.eventChannel, JSON.stringify(event));
    });
  }

  private captureCommandContext(): { client: RedisClientType; version: number } | null {
    const client = this.commandClient;
    if (!client || !client.isOpen) {
      return null;
    }
    return { client, version: this.commandContextVersion };
  }

  private isCurrentCommandContext(client: RedisClientType, version: number): boolean {
    return this.commandClient === client && this.commandContextVersion === version && client.isOpen;
  }

  private isClosedClientError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes("The client is closed");
  }

  private shouldSuppressBestEffortError(client: RedisClientType, version: number, err: unknown): boolean {
    return !this.isCurrentCommandContext(client, version) || this.isClosedClientError(err);
  }

  private runBestEffortCommand(
    label: string,
    command: (client: RedisClientType) => Promise<void>,
  ): void {
    const context = this.captureCommandContext();
    if (!context) {
      return;
    }

    const { client, version } = context;
    void (async () => {
      if (!this.isCurrentCommandContext(client, version)) {
        return;
      }

      try {
        await command(client);
      } catch (err) {
        if (this.shouldSuppressBestEffortError(client, version, err)) {
          return;
        }
        console.error(`[RedisCoordinator] ${label}: ${err}`);
      }
    })();
  }

  private normalizeQueueEntry(entry: CoordinatorQueueEntry): CoordinatorQueueEntry {
    return {
      ...entry,
      ws: entry.ws ?? null,
      connected: entry.connected ?? true,
    };
  }

  private normalizeGameSnapshot(snapshot: CoordinatorGameStateSnapshot): CoordinatorGameStateSnapshot {
    return {
      match: snapshot.match == null ? null : JSON.parse(JSON.stringify(snapshot.match)),
      lastShowdown: snapshot.lastShowdown == null ? null : JSON.parse(JSON.stringify(snapshot.lastShowdown)),
      timer: snapshot.timer == null ? null : JSON.parse(JSON.stringify(snapshot.timer)),
      timeoutCounts: snapshot.timeoutCounts == null ? undefined : JSON.parse(JSON.stringify(snapshot.timeoutCounts)),
      updatedAt: snapshot.updatedAt ?? Date.now(),
      nodeId: snapshot.nodeId || this.nodeId,
    };
  }

  private roomSnapshotKey(roomId: string): string {
    return this.key(`room:${roomId}:snapshot`);
  }

  private roomGameSnapshotKey(roomId: string): string {
    return this.key(`room:${roomId}:game`);
  }

  private roomIndexKey(): string {
    return this.key("rooms:index");
  }

  private syncLeaseCacheFromRoomSnapshot(snapshot: SerializedRoomSnapshot): void {
    const now = Date.now();
    const ownerLeaseName = `room:${snapshot.id}:owner`;
    const timerLeaseName = `room:${snapshot.id}:timer`;

    if (snapshot.ownerNodeId && (snapshot.ownerLeaseExpiresAt ?? 0) > now) {
      this.leases.set(ownerLeaseName, {
        ownerId: snapshot.ownerNodeId,
        expiresAt: snapshot.ownerLeaseExpiresAt!,
      });
    } else {
      this.leases.delete(ownerLeaseName);
    }

    if (snapshot.timerOwnerNodeId && (snapshot.timerLeaseExpiresAt ?? 0) > now) {
      this.leases.set(timerLeaseName, {
        ownerId: snapshot.timerOwnerNodeId,
        expiresAt: snapshot.timerLeaseExpiresAt!,
      });
    } else {
      this.leases.delete(timerLeaseName);
    }
  }

  private playerRoomKey(): string {
    return this.key("player:rooms");
  }

  private queueEntryKey(userId: string): string {
    return this.key(`matchmaking:entry:${userId}`);
  }

  private queueIndexKey(): string {
    return this.key("matchmaking:index");
  }

  private spectatorKey(): string {
    return this.key("spectators:connections");
  }

  private leaseKey(leaseName: string): string {
    return this.key(`lease:${leaseName}`);
  }

  private key(path: string): string {
    return `${this.config.keyPrefix}${path}`;
  }

  private extractLeaseName(redisKey: string): string | null {
    const prefix = this.leaseKey("");
    if (!redisKey.startsWith(prefix)) return null;
    return redisKey.slice(prefix.length);
  }

  private maskRedisUrl(url: string): string {
    return url.replace(/\/\/.*@/, "//***@");
  }
}
