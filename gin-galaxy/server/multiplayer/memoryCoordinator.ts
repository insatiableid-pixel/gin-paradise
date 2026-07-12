/**
 * In-Memory Coordinator Implementation.
 *
 * This is the zero-extra-infra default that preserves the exact behavior
 * of the original roomManager's module-level Maps. All state lives in
 * process memory — identical to how Gin Paradise has always worked.
 *
 * Use this for:
 *   - Local development
 *   - Single-instance production deployments
 *   - Testing
 *
 * Limitations:
 *   - State is lost on process restart
 *   - Cannot share state across multiple Node processes
 *   - Not suitable for horizontal scaling
 */

import crypto from "crypto";
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

export class MemoryCoordinator implements RealtimeCoordinator {
  readonly mode = "memory" as const;

  private readonly nodeId: string;
  private readonly rooms = new Map<string, CoordinatorRoom>();
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
  private readonly startedAt = Date.now();

  constructor(nodeId?: string) {
    this.nodeId = nodeId || `memory-${crypto.randomUUID()}`;
  }

  getNodeId(): string {
    return this.nodeId;
  }

  subscribe(listener: CoordinatorEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: Omit<CoordinatorEvent, "nodeId" | "timestamp">): void {
    const envelope: CoordinatorEvent = {
      ...event,
      nodeId: this.nodeId,
      timestamp: Date.now(),
    };

    for (const listener of this.listeners) {
      try {
        listener(envelope);
      } catch {
        // Ignore listener failures so one bad subscriber cannot break coordination.
      }
    }
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
    if (pending) {
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
    return true;
  }

  async disconnect(): Promise<void> {
    return;
  }

  // ── Room Registry ────────────────────────────────────────────────

  createRoom(room: CoordinatorRoom): void {
    this.rooms.set(room.id, room);
    this.emit({
      type: "room_created",
      roomId: room.id,
      payload: {
        hostId: room.hostId,
        status: room.status,
        stakeId: room.stakeId,
      },
    });
  }

  getRoom(roomId: string): CoordinatorRoom | undefined {
    return this.rooms.get(roomId);
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  deleteRoom(roomId: string): void {
    this.rooms.delete(roomId);
    this.roomGameSnapshots.delete(roomId);
    this.emit({ type: "room_deleted", roomId });
  }

  getAllRooms(): Iterable<[string, CoordinatorRoom]> {
    return this.rooms;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  // ── Player-to-Room Membership ──────────────────────────────────

  setPlayerRoom(userId: string, roomId: string): void {
    this.playerToRoom.set(userId, roomId);
    this.emit({ type: "player_room_set", roomId, userId, payload: { roomId } });
  }

  getPlayerRoom(userId: string): string | undefined {
    return this.playerToRoom.get(userId);
  }

  removePlayerRoom(userId: string): void {
    const roomId = this.playerToRoom.get(userId);
    this.playerToRoom.delete(userId);
    this.emit({ type: "player_room_removed", roomId, userId });
  }

  hasPlayerRoom(userId: string): boolean {
    return this.playerToRoom.has(userId);
  }

  // ── Room Player Management ─────────────────────────────────────

  setRoomPlayer(roomId: string, player: CoordinatorPlayer): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.players.set(player.userId, player);
      this.emit({
        type: "room_player_set",
        roomId,
        userId: player.userId,
        payload: {
          connected: player.connected,
          nodeId: player.nodeId ?? null,
        },
      });
    }
  }

  getRoomPlayer(roomId: string, userId: string): CoordinatorPlayer | undefined {
    return this.rooms.get(roomId)?.players.get(userId);
  }

  removeRoomPlayer(roomId: string, userId: string): void {
    this.rooms.get(roomId)?.players.delete(userId);
    this.emit({ type: "room_player_removed", roomId, userId });
  }

  getRoomPlayers(roomId: string): CoordinatorPlayer[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.players.values()) : [];
  }

  getRoomPlayerCount(roomId: string): number {
    return this.rooms.get(roomId)?.players.size ?? 0;
  }

  isPlayerInRoom(roomId: string, userId: string): boolean {
    return this.rooms.get(roomId)?.players.has(userId) ?? false;
  }

  // ── Room Status ────────────────────────────────────────────────────

  setRoomStatus(roomId: string, status: "waiting" | "playing" | "finished"): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.status = status;
      this.emit({ type: "room_updated", roomId, payload: { status } });
    }
  }

  updateRoomOwnership(roomId: string, ownership: RoomOwnershipUpdate): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if ("ownerNodeId" in ownership) room.ownerNodeId = ownership.ownerNodeId;
    if ("ownerLeaseExpiresAt" in ownership) room.ownerLeaseExpiresAt = ownership.ownerLeaseExpiresAt;
    if ("timerOwnerNodeId" in ownership) room.timerOwnerNodeId = ownership.timerOwnerNodeId;
    if ("timerLeaseExpiresAt" in ownership) room.timerLeaseExpiresAt = ownership.timerLeaseExpiresAt;

    this.emit({
      type: "room_updated",
      roomId,
      payload: {
        room: {
          ...room,
          players: new Map(room.players),
        },
      },
    });
  }

  updateRoomTimerSpeed(roomId: string, timerSpeed?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.timerSpeed = timerSpeed;

    this.emit({
      type: "room_updated",
      roomId,
      payload: {
        room: {
          ...room,
          players: new Map(room.players),
        },
      },
    });
  }

  // ── Matchmaking Queue ──────────────────────────────────────────────

  enqueueMatchmaking(entry: CoordinatorQueueEntry): void {
    this.matchmakingQueue.set(entry.userId, entry);
    this.emit({
      type: "matchmaking_enqueued",
      userId: entry.userId,
      payload: {
        username: entry.username,
        rating: entry.rating,
        stakeId: entry.stakeId,
        nodeId: entry.nodeId ?? null,
        matchPosture: entry.matchPosture ?? null,
      },
    });
  }

  dequeueMatchmaking(userId: string): void {
    this.matchmakingQueue.delete(userId);
    this.emit({ type: "matchmaking_dequeued", userId });
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
    this.emit({ type: "matchmaking_cleared" });
  }

  // ── Live Match Snapshots ─────────────────────────────────────────

  setRoomGameState(roomId: string, snapshot: CoordinatorGameStateSnapshot): void {
    const normalized = this.cloneSnapshot(snapshot);
    this.roomGameSnapshots.set(roomId, normalized);
    this.emit({
      type: "room_game_state_set",
      roomId,
      payload: { snapshot: normalized },
    });
  }

  async commitRoomGameState(roomId: string, snapshot: CoordinatorGameStateSnapshot): Promise<void> {
    this.setRoomGameState(roomId, snapshot);
  }

  getRoomGameState(roomId: string): CoordinatorGameStateSnapshot | undefined {
    const snapshot = this.roomGameSnapshots.get(roomId);
    return snapshot ? this.cloneSnapshot(snapshot) : undefined;
  }

  clearRoomGameState(roomId: string): void {
    const removed = this.roomGameSnapshots.delete(roomId);
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

    const expiresAt = now + ttlMs;
    this.leases.set(leaseName, { ownerId, expiresAt });
    this.emit({ type: "lease_claimed", leaseName, payload: { ownerId, expiresAt, ttlMs } });
    return true;
  }

  async claimLeaseAuthoritatively(leaseName: string, ownerId: string, ttlMs: number): Promise<boolean> {
    return this.claimLease(leaseName, ownerId, ttlMs);
  }

  renewLease(leaseName: string, ownerId: string, ttlMs: number): boolean {
    const existing = this.leases.get(leaseName);
    if (!existing || existing.ownerId !== ownerId) {
      return false;
    }

    const expiresAt = Date.now() + ttlMs;
    this.leases.set(leaseName, { ownerId, expiresAt });
    this.emit({ type: "lease_renewed", leaseName, payload: { ownerId, expiresAt, ttlMs } });
    return true;
  }

  async renewLeaseAuthoritatively(leaseName: string, ownerId: string, ttlMs: number): Promise<boolean> {
    return this.renewLease(leaseName, ownerId, ttlMs);
  }

  releaseLease(leaseName: string, ownerId: string): void {
    const existing = this.leases.get(leaseName);
    if (!existing || existing.ownerId !== ownerId) {
      return;
    }

    this.leases.delete(leaseName);
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
    this.spectatorConnections.set(userId, connection);
    this.emit({
      type: "spectator_set",
      userId,
      roomId: connection.roomId,
      payload: { nodeId: connection.nodeId ?? null },
    });
  }

  getSpectatorConnection(userId: string): CoordinatorSpectatorConnection | undefined {
    return this.spectatorConnections.get(userId);
  }

  removeSpectatorConnection(userId: string): void {
    const connection = this.spectatorConnections.get(userId);
    this.spectatorConnections.delete(userId);
    this.emit({ type: "spectator_removed", userId, roomId: connection?.roomId });
  }

  hasSpectatorConnection(userId: string): boolean {
    return this.spectatorConnections.has(userId);
  }

  // ── Diagnostics ────────────────────────────────────────────────

  isHealthy(): boolean {
    return true; // In-memory is always healthy if the process is alive
  }

  getDiagnostics(): CoordinatorDiagnostics {
    return {
      mode: "memory",
      healthy: true,
      roomCount: this.rooms.size,
      playerMappingCount: this.playerToRoom.size,
      spectatorConnectionCount: this.spectatorConnections.size,
      uptimeMs: Date.now() - this.startedAt,
      nodeId: this.nodeId,
      details: {
        implementation: "in-process Map-based",
        sharedState: false,
        requiresExternalInfra: false,
        queueSize: this.matchmakingQueue.size,
        roomGameSnapshotCount: this.roomGameSnapshots.size,
        leaseCount: this.leases.size,
      },
    };
  }

  private cloneSnapshot(snapshot: CoordinatorGameStateSnapshot): CoordinatorGameStateSnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as CoordinatorGameStateSnapshot;
  }
}
