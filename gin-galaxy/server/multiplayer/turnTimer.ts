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

export function setRoomTimerSpeed(roomId: string, speed: TimerSpeed): void {
  roomTimerSpeeds.set(roomId, speed);
}

export function getRoomTimerSpeed(roomId: string): TimerSpeed {
  return roomTimerSpeeds.get(roomId) || DEFAULT_TIMER_SPEED;
}

function getRoomTimerSeconds(roomId: string): number {
  return getTimerPreset(getRoomTimerSpeed(roomId)).seconds;
}

// ── Timer State ─────────────────────────────────────────────────────

export interface TurnTimerState {
  roomId: string;
  activePlayerId: string;
  startedAt: number;     // Date.now() when the turn started
  expiresAt: number;     // Date.now() + timeout
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
  // Cancel any existing timer for this room
  cancelTurnTimer(roomId);

  const now = Date.now();
  const timeoutSeconds = getRoomTimerSeconds(roomId);
  const expiresAt = now + timeoutSeconds * 1000;

  const timerId = setTimeout(() => {
    // Timer expired
    activeTimers.delete(roomId);

    // Increment timeout count
    if (!timeoutCounts.has(roomId)) {
      timeoutCounts.set(roomId, {});
    }
    const counts = timeoutCounts.get(roomId)!;
    counts[activePlayerId] = (counts[activePlayerId] || 0) + 1;

    if (onTurnTimeout) {
      onTurnTimeout(roomId, activePlayerId, counts[activePlayerId]);
    }
  }, timeoutSeconds * 1000);

  // Ensure the timer doesn't keep the process alive
  if (timerId && typeof timerId === 'object' && 'unref' in timerId) {
    (timerId as NodeJS.Timeout).unref();
  }

  activeTimers.set(roomId, {
    roomId,
    activePlayerId,
    startedAt: now,
    expiresAt,
    timerId,
  });
}

/**
 * Cancel the turn timer for a room. Called when a player acts in time,
 * or when the match ends.
 */
export function cancelTurnTimer(roomId: string): void {
  const timer = activeTimers.get(roomId);
  if (timer) {
    clearTimeout(timer.timerId);
    activeTimers.delete(roomId);
  }
}

/**
 * Reset the consecutive timeout counter for a player in a room.
 * Called when a player takes a voluntary action (proving they're active).
 */
export function resetTimeoutCount(roomId: string, playerId: string): void {
  const counts = timeoutCounts.get(roomId);
  if (counts) {
    counts[playerId] = 0;
  }
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
    totalSeconds: getRoomTimerSeconds(timer.roomId),
  };
}

/**
 * Get consecutive timeout count for a player in a room.
 */
export function getTimeoutCount(roomId: string, playerId: string): number {
  return timeoutCounts.get(roomId)?.[playerId] ?? 0;
}

/**
 * Clean up timer and counters for a room (match ended).
 */
export function cleanupRoomTimers(roomId: string): void {
  cancelTurnTimer(roomId);
  timeoutCounts.delete(roomId);
  roomTimerSpeeds.delete(roomId);
}

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
}
