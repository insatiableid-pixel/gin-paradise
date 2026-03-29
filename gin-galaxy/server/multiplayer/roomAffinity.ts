export type RoomAffinityAction = "join_room" | "join_challenge_room" | "reconnect" | "watch_match" | "start_match";

export interface RoomAffinityRoom {
  id: string;
  ownerNodeId?: string | null;
  ownerLeaseExpiresAt?: number | null;
  status?: "waiting" | "playing" | "finished";
}

export interface RoomHandoffHint {
  roomId: string;
  ownerNodeId: string;
  currentNodeId: string;
  action: RoomAffinityAction;
  message: string;
}

export function canServeRoomLocally(room: RoomAffinityRoom, currentNodeId: string): boolean {
  const leaseExpired = room.ownerLeaseExpiresAt != null && room.ownerLeaseExpiresAt <= Date.now();
  return !room.ownerNodeId || room.ownerNodeId === currentNodeId || leaseExpired;
}

export function buildRoomHandoffHint(room: RoomAffinityRoom, currentNodeId: string, action: RoomAffinityAction): RoomHandoffHint {
  const ownerNodeId = room.ownerNodeId ?? "unknown";
  const actionLabel = action.replace(/_/g, " ");
  const message = room.ownerNodeId
    ? `Room ${room.id} is owned by node ${room.ownerNodeId}. Please reconnect to that node or wait for relay/failover recovery before trying to ${actionLabel}.`
    : `Room ${room.id} is missing ownership metadata. Please retry on the original node.`;

  return {
    roomId: room.id,
    ownerNodeId,
    currentNodeId,
    action,
    message,
  };
}
