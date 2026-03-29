/**
 * Server-Enforced Turn Timer.
 *
 * Prevents players from stalling matches indefinitely by enforcing a
 * server-authoritative turn timeout. When a player's turn starts, a
 * timer is set. If the player does not act before it expires, the
 * server executes a fallback action:
 *
 *  - If the player hasn't drawn yet: auto-draw from stock, then auto-discard
 *    the drawn card (last card in hand, which is the one just drawn).
 *  - If the player has drawn but hasn't acted: auto-discard the last card
 *    in their hand.
 *
 * After 3 consecutive timeouts by the same player in one match, the
 * server forfeits the match on their behalf.
 *
 * Timer state is visible to clients via the `turn_timer` server message.
 */

import { getCoordinator } from "./coordinatorFactory.js";
import type {
  CoordinatorGameStateSnapshot,
  CoordinatorRoom,
  CoordinatorTurnTimerSnapshot,
} from "./coordinator.js";

// ── Configuration ───────────────────────────────────────────────────────────

/** Timer speed presets — optimized for throughput and anti-stall. */
export type TimerSpeed = "fast" | "medium" | "slow";

export interface TimerPreset {
  id: TimerSpeed;
  label: string;
  seconds: number;
}

export const TIMER_PRESETS: TimerPreset[] = [
  { id: "fast",   label: "Fast",   seconds: 20 },
  { id: "medium", label: "Medium", seconds: 30 },
  { id: "slow",   label: "Slow",   seconds: 40 },
];

export function getTimerPreset(speed: TimerSpeed): TimerPreset {
  return TIMER_PRESETS.find(p => p.id === speed) || TIMER_PRESETS[1]; // default to medium
}

/** Default timer speed if not explicitly chosen */
export const DEFAULT_TIMER_SPEED: TimerSpeed = "medium";

/** Legacy export for backward compat — default to medium */
export const TURN_TIMEOUT_SECONDS = 30;

/** Number of consecutive timeouts before auto-forfeit. */
export const MAX_CONSECUTIVE_TIMEOUTS = 3;

/** Per-room timer speed tracking */
const roomTimerSpeeds = new Map<string, TimerSpeed>();

function isTimerSpeed(value: string | undefined): value is TimerSpeed {
  return value === "fast" || value === "medium" || value === "slow";
}

function getSharedCoordinator() {
  try {
    return getCoordinator();
  } catch {
    return null;
  }
}

function timerLeaseName(roomId: string): string {
  return `room:${roomId}:timer`;
}

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
      `[turnTimer] Ignoring invalid ${label}=${raw}; expected an integer >= ${min}. Using ${fallback}.`,
    );
    return fallback;
  }

  return parsed;
}

const TURN_TIMER_LEASE_TTL_MS = parseLeaseDurationMs(
  process.env.TURN_TIMER_LEASE_TTL_MS,
  15_000,
  2_000,
  "TURN_TIMER_LEASE_TTL_MS",
);
const TURN_TIMER_LEASE_RENEW_INTERVAL_MS = Math.min(
  parseLeaseDurationMs(
    process.env.TURN_TIMER_LEASE_RENEW_INTERVAL_MS,
    Math.max(1_000, Math.floor(TURN_TIMER_LEASE_TTL_MS / 3)),
    250,
    "TURN_TIMER_LEASE_RENEW_INTERVAL_MS",
  ),
  Math.max(250, TURN_TIMER_LEASE_TTL_MS - 250),
);

export function setRoomTimerSpeed(roomId: string, speed: TimerSpeed): void {
  roomTimerSpeeds.set(roomId, speed);

  const coord = getSharedCoordinator();
  if (coord) {
    coord.updateRoomTimerSpeed(roomId, speed);
  }
}

export function getRoomTimerSpeed(roomId: string): TimerSpeed {
  const localSpeed = roomTimerSpeeds.get(roomId);
  if (localSpeed) {
    return localSpeed;
  }

  const coord = getSharedCoordinator();
  const persistedSpeed = coord?.getRoom(roomId)?.timerSpeed;
  if (isTimerSpeed(persistedSpeed)) {
    roomTimerSpeeds.set(roomId, persistedSpeed);
    return persistedSpeed;
  }

  return DEFAULT_TIMER_SPEED;
}

function getRoomTimerSeconds(roomId: string): number {
  return getTimerPreset(getRoomTimerSpeed(roomId)).seconds;
}

function cloneTimeoutCounts(counts?: TimeoutCounter | null): TimeoutCounter | undefined {
  return counts ? { ...counts } : undefined;
}

function buildTimerSnapshot(state: TurnTimerState): CoordinatorTurnTimerSnapshot {
  return {
    activePlayerId: state.activePlayerId,
    startedAt: state.startedAt,
    expiresAt: state.expiresAt,
    totalSeconds: state.totalSeconds,
  };
}

export function getTurnTimerSnapshot(roomId: string): CoordinatorTurnTimerSnapshot | null {
  const timer = activeTimers.get(roomId);
  return timer ? buildTimerSnapshot(timer) : null;
}

function isTimerSnapshot(snapshot: CoordinatorTurnTimerSnapshot): boolean {
  return (
    typeof snapshot.activePlayerId === "string" &&
    Number.isFinite(snapshot.startedAt) &&
    Number.isFinite(snapshot.expiresAt) &&
    Number.isFinite(snapshot.totalSeconds) &&
    snapshot.totalSeconds > 0
  );
}

function getPersistedTimeoutCounts(roomId: string): TimeoutCounter {
  const localCounts = timeoutCounts.get(roomId);
  if (localCounts) {
    return localCounts;
  }

  const persistedCounts = getSharedCoordinator()?.getRoomGameState(roomId)?.timeoutCounts;
  if (persistedCounts) {
    const cloned = cloneTimeoutCounts(persistedCounts) || {};
    timeoutCounts.set(roomId, cloned);
    return cloned;
  }

  const emptyCounts: TimeoutCounter = {};
  timeoutCounts.set(roomId, emptyCounts);
  return emptyCounts;
}

function persistTimerSnapshot(
  roomId: string,
  updates: { timer?: CoordinatorTurnTimerSnapshot | null; timeoutCounts?: TimeoutCounter | null }
): void {
  const coord = getSharedCoordinator();
  if (!coord) return;

  const existing = coord.getRoomGameState(roomId);
  if (!existing) return;

  const next: CoordinatorGameStateSnapshot = {
    ...existing,
    updatedAt: Date.now(),
    nodeId: coord.getNodeId(),
  };

  if ("timer" in updates) {
    next.timer = updates.timer ?? null;
  }

  if ("timeoutCounts" in updates) {
    if (updates.timeoutCounts == null) {
      delete next.timeoutCounts;
    } else {
      next.timeoutCounts = cloneTimeoutCounts(updates.timeoutCounts);
    }
  }

  coord.setRoomGameState(roomId, next);
}

function claimTimerLease(roomId: string): boolean {
  const coord = getSharedCoordinator();
  if (!coord) {
    return true;
  }

  const leaseName = timerLeaseName(roomId);
  const ownerId = coord.getNodeId();
  if (
    !coord.renewLease(leaseName, ownerId, TURN_TIMER_LEASE_TTL_MS) &&
    !coord.claimLease(leaseName, ownerId, TURN_TIMER_LEASE_TTL_MS)
  ) {
    return false;
  }

  coord.updateRoomOwnership(roomId, {
    timerOwnerNodeId: ownerId,
    timerLeaseExpiresAt: Date.now() + TURN_TIMER_LEASE_TTL_MS,
  });
  return true;
}

function clearLocalTimer(roomId: string): void {
  const timer = activeTimers.get(roomId);
  if (!timer) {
    return;
  }

  clearTimeout(timer.timerId);
  activeTimers.delete(roomId);
}

function scheduleTurnTimer(
  roomId: string,
  activePlayerId: string,
  startedAt: number,
  expiresAt: number,
  totalSeconds: number
): boolean {
  const remainingMs = Math.max(0, expiresAt - Date.now());
  if (!claimTimerLease(roomId)) {
    return false;
  }

  const timerId = setTimeout(() => {
    activeTimers.delete(roomId);

    const counts = getPersistedTimeoutCounts(roomId);
    counts[activePlayerId] = (counts[activePlayerId] || 0) + 1;
    timeoutCounts.set(roomId, counts);
    persistTimerSnapshot(roomId, { timeoutCounts: counts });

    if (onTurnTimeout) {
      onTurnTimeout(roomId, activePlayerId, counts[activePlayerId]);
    }

    const leaseCoord = getSharedCoordinator();
    if (leaseCoord) {
      leaseCoord.releaseLease(timerLeaseName(roomId), leaseCoord.getNodeId());
      leaseCoord.updateRoomOwnership(roomId, {
        timerOwnerNodeId: undefined,
        timerLeaseExpiresAt: undefined,
      });
    }
  }, remainingMs);

  if (timerId && typeof timerId === "object" && "unref" in timerId) {
    (timerId as NodeJS.Timeout).unref();
  }

  const timerState: TurnTimerState = {
    roomId,
    activePlayerId,
    startedAt,
    expiresAt,
    totalSeconds,
    timerId,
  };
  activeTimers.set(roomId, timerState);
  timeoutCounts.set(roomId, getPersistedTimeoutCounts(roomId));
  persistTimerSnapshot(roomId, {
    timer: buildTimerSnapshot(timerState),
    timeoutCounts: timeoutCounts.get(roomId),
  });
  return true;
}

// ── Timer State ─────────────────────────────────────────────────────

export interface TurnTimerState {
  roomId: string;
  activePlayerId: string;
  startedAt: number;     // Date.now() when the turn started
  expiresAt: number;     // Date.now() + timeout
  totalSeconds: number;
  timerId: ReturnType<typeof setTimeout>;
}

export interface TimeoutCounter {
  [userId: string]: number;
}

/**
 * Callback invoked when a turn timer expires.
 * The room manager registers this to handle auto-action or forfeit.
 */
export type TurnTimeoutCallback = (
  roomId: string,
  timedOutPlayerId: string,
  consecutiveTimeouts: number
) => void;

// ── In-memory state ─────────────────────────────────────────────────

const activeTimers = new Map<string, TurnTimerState>();
const timeoutCounts = new Map<string, TimeoutCounter>(); // roomId → { userId: count }

let onTurnTimeout: TurnTimeoutCallback | null = null;

/**
 * Register the callback the room manager uses to handle timeouts.
 */
export function setTurnTimeoutCallback(cb: TurnTimeoutCallback) {
  onTurnTimeout = cb;
}

/**
 * Start (or restart) the turn timer for a room.
 * Should be called whenever the turn changes — after draw+discard,
 * after round start, after next round, etc.
 */
export function startTurnTimer(roomId: string, activePlayerId: string): void {
  cancelTurnTimer(roomId);

  const now = Date.now();
  const timeoutSeconds = getRoomTimerSeconds(roomId);
  scheduleTurnTimer(roomId, activePlayerId, now, now + timeoutSeconds * 1000, timeoutSeconds);
}

/**
 * Cancel the turn timer for a room. Called when a player acts in time,
 * or when the match ends.
 */
export function cancelTurnTimer(roomId: string, persistSnapshot = true): void {
  const timer = activeTimers.get(roomId);
  if (timer) {
    clearTimeout(timer.timerId);
    activeTimers.delete(roomId);
  }

  const coord = getSharedCoordinator();
  if (coord) {
    coord.releaseLease(timerLeaseName(roomId), coord.getNodeId());
    coord.updateRoomOwnership(roomId, {
      timerOwnerNodeId: undefined,
      timerLeaseExpiresAt: undefined,
    });
  }

  if (persistSnapshot) {
    persistTimerSnapshot(roomId, { timer: null });
  }
}

/**
 * Reset the consecutive timeout counter for a player in a room.
 * Called when a player takes a voluntary action (proving they're active).
 */
export function resetTimeoutCount(roomId: string, playerId: string): void {
  const counts = getPersistedTimeoutCounts(roomId);
  counts[playerId] = 0;
  timeoutCounts.set(roomId, counts);
  persistTimerSnapshot(roomId, { timeoutCounts: counts });
}

/**
 * Get the remaining turn time in seconds for a room.
 * Returns null if no timer is active.
 */
export function getTurnTimeRemaining(roomId: string): number | null {
  const timer = activeTimers.get(roomId);
  if (!timer) return null;
  return Math.max(0, Math.ceil((timer.expiresAt - Date.now()) / 1000));
}

/**
 * Get the timer state for a room (for sending to clients).
 */
export function getTurnTimerInfo(roomId: string): {
  activePlayerId: string;
  remainingSeconds: number;
  totalSeconds: number;
} | null {
  const timer = activeTimers.get(roomId);
  if (!timer) return null;
  return {
    activePlayerId: timer.activePlayerId,
    remainingSeconds: Math.max(0, Math.ceil((timer.expiresAt - Date.now()) / 1000)),
    totalSeconds: timer.totalSeconds,
  };
}

/**
 * Get consecutive timeout count for a player in a room.
 */
export function getTimeoutCount(roomId: string, playerId: string): number {
  const counts = timeoutCounts.get(roomId) || getSharedCoordinator()?.getRoomGameState(roomId)?.timeoutCounts;
  return counts?.[playerId] ?? 0;
}

/**
 * Clean up timer and counters for a room (match ended).
 */
export function cleanupRoomTimers(roomId: string): void {
  cancelTurnTimer(roomId);
  timeoutCounts.delete(roomId);
  roomTimerSpeeds.delete(roomId);
  persistTimerSnapshot(roomId, { timer: null, timeoutCounts: null });
}

/**
 * Stop a room timer locally during server shutdown without erasing the
 * persisted coordinator snapshot. This lets another node recover the
 * timer after failover.
 */
export function suspendRoomTimersForShutdown(roomId: string): void {
  cancelTurnTimer(roomId, false);
  timeoutCounts.delete(roomId);
  roomTimerSpeeds.delete(roomId);
}

/**
 * Restore a turn timer from a persisted coordinator snapshot.
 * If the timer has already expired, the timeout callback is triggered immediately.
 */
export function restoreTurnTimerFromSnapshot(
  roomId: string,
  snapshot?: CoordinatorGameStateSnapshot | null
): boolean {
  if (activeTimers.has(roomId)) {
    return true;
  }

  const persisted = snapshot ?? getSharedCoordinator()?.getRoomGameState(roomId);
  const timer = persisted?.timer;
  if (!timer) {
    return false;
  }

  if (!isTimerSnapshot(timer)) {
    return false;
  }

  const counts = cloneTimeoutCounts(persisted.timeoutCounts) || {};
  timeoutCounts.set(roomId, counts);

  const remainingMs = timer.expiresAt - Date.now();
  if (remainingMs <= 0) {
    counts[timer.activePlayerId] = (counts[timer.activePlayerId] || 0) + 1;
    timeoutCounts.set(roomId, counts);
    persistTimerSnapshot(roomId, { timeoutCounts: counts });

    if (onTurnTimeout) {
      onTurnTimeout(roomId, timer.activePlayerId, counts[timer.activePlayerId]);
    }
    return true;
  }

  return scheduleTurnTimer(roomId, timer.activePlayerId, timer.startedAt, timer.expiresAt, timer.totalSeconds);
}

function shouldRecoverTurnTimerForNode(
  room: CoordinatorRoom | undefined,
  snapshot: CoordinatorGameStateSnapshot | undefined,
  nodeId: string,
): boolean {
  if (!room || room.status !== "playing" || !snapshot?.timer) {
    return false;
  }

  return (
    room.ownerNodeId === nodeId ||
    room.timerOwnerNodeId === nodeId ||
    (!room.ownerNodeId && snapshot.nodeId === nodeId)
  );
}

export function recoverTurnTimerForRoom(roomId: string): boolean {
  const coord = getSharedCoordinator();
  if (!coord) return false;

  const room = coord.getRoom(roomId);
  const snapshot = coord.getRoomGameState(roomId);
  if (!shouldRecoverTurnTimerForNode(room, snapshot, coord.getNodeId())) {
    return false;
  }

  return restoreTurnTimerFromSnapshot(roomId, snapshot);
}

/**
 * Recover any timers owned by this node from the coordinator snapshot store.
 * Used on startup and when a room is reclaimed after reconnect.
 */
export function recoverTurnTimersFromCoordinator(): void {
  const coord = getSharedCoordinator();
  if (!coord) return;

  for (const [roomId] of coord.getAllRooms()) {
    recoverTurnTimerForRoom(roomId);
  }
}

function renewActiveTimerLeases(): void {
  for (const [roomId] of activeTimers) {
    if (claimTimerLease(roomId)) {
      continue;
    }

    clearLocalTimer(roomId);
    console.warn(
      `[turnTimer] Lost renewable timer lease for room ${roomId}; local timer stopped until recovery reclaims it.`,
    );
  }
}

setInterval(() => {
  renewActiveTimerLeases();
}, TURN_TIMER_LEASE_RENEW_INTERVAL_MS).unref();

// ── Testing helpers ─────────────────────────────────────────────────

export function _getActiveTimers(): Map<string, TurnTimerState> {
  return activeTimers;
}

export function _clearAllTimers(): void {
  for (const timer of activeTimers.values()) {
    clearTimeout(timer.timerId);
  }
  activeTimers.clear();
  timeoutCounts.clear();
  roomTimerSpeeds.clear();
}
