/**
 * Shared types for the multiplayer system.
 * All messages between client and server use these contracts.
 */

export interface RoomPlayer {
  userId: string;
  username: string;
  connected: boolean;
}

export interface MultiplayerRoom {
  id: string;
  hostId: string;
  players: RoomPlayer[];
  status: "waiting" | "playing" | "finished";
  createdAt: number;
}

// ── Client → Server Messages ─────────────────────────────────────────

export type ClientMessage =
  | { type: "create_room" }
  | { type: "join_room"; roomId: string }
  | { type: "join_challenge_room"; roomId: string; stakeId?: string }
  | { type: "queue_match"; stakeId?: string; timerSpeed?: string; matchPosture?: string }
  | { type: "cancel_queue" }
  | { type: "draw"; source: "stock" | "discard" }
  | { type: "discard"; cardIndex: number }
  | { type: "knock"; cardIndex: number }
  | { type: "next_round" }
  | { type: "leave_room" }
  | { type: "start_tournament_match"; tournamentId: string; matchIndex: number }
  | { type: "submit_client_seed"; seed: string }
  | { type: "watch_match"; roomId: string }
  | { type: "leave_spectate" }
  | { type: "ping" };

// ── Server → Client Messages ─────────────────────────────────────────

/** Structured showdown data for end-of-round/game reveals */
export interface ShowdownMeld {
  cards: CardView[];
  type: "set" | "run";
}

export interface ShowdownPlayerData {
  username: string;
  melds: ShowdownMeld[];
  deadwood: CardView[];
  deadwoodValue: number;
  /** Cards that were laid off onto knocker's melds (opponent only, non-gin) */
  laidOffCards?: CardView[];
}

export interface ShowdownData {
  knockOutcome: "knock" | "gin" | "undercut";
  knockerUsername: string;
  opponentUsername: string;
  knocker: ShowdownPlayerData;
  opponent: ShowdownPlayerData;
  roundWinnerUsername: string;
  roundPoints: number;
}

export type ServerMessage =
  | { type: "room_created"; roomId: string }
  | { type: "room_joined"; room: RoomView }
  | { type: "opponent_joined"; opponent: RoomPlayer }
  | { type: "game_started"; state: PlayerGameView }
  | { type: "game_update"; state: PlayerGameView }
  | { type: "round_over"; state: PlayerGameView; knockerHand: CardView[]; opponentHand: CardView[]; showdown: ShowdownData }
  | { type: "game_over"; state: PlayerGameView; knockerHand: CardView[]; opponentHand: CardView[]; showdown: ShowdownData }
  | { type: "opponent_disconnected"; username: string }
  | { type: "opponent_reconnected"; username: string }
  | { type: "opponent_forfeited"; username: string }
  | { type: "queue_joined"; position: number; queueSize: number }
  | { type: "queue_cancelled" }
  | { type: "match_found"; roomId: string; opponent: string }
  | { type: "queue_timeout"; message: string }
  | { type: "turn_timer"; activePlayerId: string; remainingSeconds: number; totalSeconds: number }
  | { type: "turn_timeout_warning"; message: string }
  | { type: "insufficient_funds"; message: string; balance: number; required: number; currency: string }
  | { type: "tournament_match_starting"; tournamentId: string; matchIndex: number; opponent: string; round: string }
  | { type: "tournament_update"; tournamentId: string; status: string; bracket: any; winnerId: string | null; winnerUsername: string | null }
  | { type: "tournament_advance"; tournamentId: string; round: string; message: string }
  | { type: "tournament_eliminated"; tournamentId: string; round: string; message: string }
  | { type: "tournament_completed"; tournamentId: string; winnerId: string; winnerUsername: string; prizePool: number; currency: string }
  | { type: "client_seed_accepted"; roundNumber: number }
  | { type: "fairness_status"; status: FairnessStatusInfo }
  | { type: "client_seed_status"; roundNumber: number; mySubmitted: boolean; opponentSubmitted: boolean; version: number }
  | { type: "spectator_update"; state: SpectatorGameViewWire }
  | { type: "spectator_joined"; roomId: string; spectatorCount: number }
  | { type: "spectator_left"; roomId: string; spectatorCount: number }
  | { type: "spectator_match_over"; roomId: string; message: string }
  | { type: "room_handoff_required"; roomId: string; ownerNodeId: string; currentNodeId: string; action: "join_room" | "join_challenge_room" | "reconnect" | "watch_match" | "start_match"; message: string }
  | { type: "error"; message: string }
  | { type: "pong" };

/** Wire format for spectator game view — matches SpectatorGameView from spectator.ts */
export interface SpectatorGameViewWire {
  roomId: string;
  player1Username: string;
  player2Username: string;
  player1Score: number;
  player2Score: number;
  currentTurnUsername: string;
  player1CardCount: number;
  player2CardCount: number;
  topDiscard: CardView | null;
  stockCount: number;
  discardCount: number;
  status: "playing" | "round_over" | "game_over";
  message: string;
  roundNumber: number;
  winnerId: string | null;
  roundWinnerId: string | null;
  roundPoints: number;
  stakeInfo?: { stakeId: string; label: string; prizePool: number; currency: string } | null;
  showdown?: ShowdownData | null;
  /** Whether this match was manually featured by an admin */
  isAdminFeatured?: boolean;
}

export interface CardView {
  suit: string;
  rank: string;
}

/** The game state as seen by a specific player. Hides opponent hand. */
export interface PlayerGameView {
  roomId: string;
  myHand: CardView[];
  opponentCardCount: number;
  myScore: number;
  opponentScore: number;
  myUsername: string;
  opponentUsername: string;
  topDiscard: CardView | null;
  stockCount: number;
  turnNumber?: number;
  isMyTurn: boolean;
  hasDrawn: boolean;
  status: "waiting" | "playing" | "round_over" | "game_over";
  message: string;
  winnerId: string | null;
  roundWinnerId: string | null;
  roundPoints: number;
  /** Timer info — present when a turn timer is active */
  turnTimer?: {
    remainingSeconds: number;
    totalSeconds: number;
    isMyTimer: boolean;
  };
  /** Stake info — present when the match has a stake */
  stakeInfo?: {
    stakeId: string;
    label: string;
    entryFee: number;
    prizePool: number;
    rakeAmount: number;
    rakePercent: number;
    currency: string;
  } | null;
  /** Fairness commitment — present when provably fair shuffle is active */
  fairnessCommitment?: {
    commitmentHash: string;
    algorithmVersion: number;
    roundNumber: number;
  } | null;
  /** Live fairness status — present when Trust Shield is active */
  fairnessStatus?: FairnessStatusInfo | null;
}

/** Fairness status information broadcast to players during a live match */
export interface FairnessStatusInfo {
  /** Current round number */
  roundNumber: number;
  /** Whether the server commitment has been published */
  commitmentPublished: boolean;
  /** Short hash of the commitment for display */
  commitmentHashShort: string;
  /** Whether the local player has submitted their seed */
  mySeedSubmitted: boolean;
  /** Whether the opponent has submitted their seed */
  opponentSeedSubmitted: boolean;
  /** Algorithm version in effect: 2 = full v2 (both seeds), 1 = server-only fallback */
  activeVersion: number;
  /** Human-readable label: "Trust Shield v2" or "Trust Shield v1 (server-only)" */
  label: string;
}

export interface RoomView {
  id: string;
  hostUsername: string;
  players: RoomPlayer[];
  status: string;
}
