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
 */

import crypto from "crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { Server as HttpServer } from "http";
import type { IncomingMessage } from "http";
import { db } from "../db.js";
import {
  createMatch,
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
  type FeaturedReason,
  type SpectatorGameView,
  type LiveMatchInfo,
} from "./spectator.js";
import {
  initMatchFairness,
  createRoundCommitment,
  revealRoundSeed,
  getMatchProofs,
  getSerializableFairnessData,
  cleanupFairness,
  buildProofPackage,
  submitClientSeed,
  getClientSeeds,
  getRoundProof,
  type FairnessCommitment,
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
  cleanupRoomTimers,
  setTurnTimeoutCallback,
  setRoomTimerSpeed,
  MAX_CONSECUTIVE_TIMEOUTS,
  TURN_TIMEOUT_SECONDS,
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
  STAKE_PRESETS,
} from "../escrow.js";
import {
  advanceBracket,
  registerTournamentRoom,
  getTournament,
  getTournamentForRoom,
  type BracketMatch,
  type AdvanceResult,
} from "../tournament.js";
import {
  setAvailabilityCallback,
  type PlayerAvailability,
} from "../social.js";

// ── In-memory state ──────────────────────────────────────────────────

interface RoomState {
  id: string;
  hostId: string;
  players: Map<string, { userId: string; username: string; ws: WebSocket | null; connected: boolean }>;
  match: MatchState | null;
  status: "waiting" | "playing" | "finished";
  createdAt: number;
  stakeId: string;
  lastShowdown: ShowdownData | null;
}

const rooms = new Map<string, RoomState>();
const playerToRoom = new Map<string, string>(); // userId → roomId

// ── Spectator WebSocket tracking ────────────────────────────────────
/** userId → { ws, roomId } for connected spectators */
interface SpectatorConnection {
  ws: WebSocket;
  roomId: string;
}
const spectatorConnections = new Map<string, SpectatorConnection>();

// Room TTL: auto-clean stale rooms after 30 minutes
const ROOM_TTL = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL) {
      cleanupRoom(id);
    }
  }
}, 60_000).unref();

// ── Helper: send typed message ───────────────────────────────────────

function send(ws: WebSocket | null, msg: ServerMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
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
  const room = rooms.get(roomId);
  if (!room) return;
  cleanupRoomTimers(roomId);
  cleanupEscrow(roomId);
  cleanupFairness(roomId);
  for (const p of room.players.values()) {
    playerToRoom.delete(p.userId);
  }
  // Notify spectators that the match is over and clean up their connections
  notifySpectatorsMatchOver(roomId, "Match ended.");
  cleanupSpectators(roomId);
  cleanupBroadcastStats(roomId);
  rooms.delete(roomId);
}

// ── Broadcast helpers ────────────────────────────────────────────────

function broadcastGameState(room: RoomState) {
  if (!room.match) return;
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
        send(p.ws, {
          type: "round_over",
          state: view,
          knockerHand: room.lastShowdown.knocker.melds.flatMap(m => m.cards).concat(room.lastShowdown.knocker.deadwood) as CardView[],
          opponentHand: room.lastShowdown.opponent.melds.flatMap(m => m.cards).concat(room.lastShowdown.opponent.deadwood) as CardView[],
          showdown: room.lastShowdown,
        });
      } else if (room.match.status === "game_over" && room.lastShowdown) {
        send(p.ws, {
          type: "game_over",
          state: view,
          knockerHand: room.lastShowdown.knocker.melds.flatMap(m => m.cards).concat(room.lastShowdown.knocker.deadwood) as CardView[],
          opponentHand: room.lastShowdown.opponent.melds.flatMap(m => m.cards).concat(room.lastShowdown.opponent.deadwood) as CardView[],
          showdown: room.lastShowdown,
        });
      } else {
        send(p.ws, { type: "game_update", state: view });
      }
    }
  }

  // Also broadcast to spectators
  broadcastSpectatorView(room);
}

function broadcastReveal(room: RoomState, knockerHand: Card[], opponentHand: Card[], showdownData: ShowdownData) {
  if (!room.match) return;
  const kh: CardView[] = knockerHand.map(c => ({ suit: c.suit, rank: c.rank }));
  const oh: CardView[] = opponentHand.map(c => ({ suit: c.suit, rank: c.rank }));

  // Store showdown for reconnection scenarios
  room.lastShowdown = showdownData;

  for (const p of room.players.values()) {
    const view = getPlayerView(room.match, p.userId);
    if (!view) continue;
    const msgType = room.match.status === "game_over" ? "game_over" : "round_over";
    send(p.ws, { type: msgType, state: view, knockerHand: kh, opponentHand: oh, showdown: showdownData });
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
    send(p.ws, {
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
      send(p.ws, { type: "fairness_status", status });
    }
  }
}

// ── Match start helper (creates match + transcript + timer) ──────────

function startMatchForRoom(room: RoomState) {
  const ps = Array.from(room.players.values());

  // Create escrow holds for staked matches
  if (!isFreeStake(room.stakeId)) {
    initRoomEscrow(room.id, room.stakeId);
    for (const p of ps) {
      try {
        holdEntryFee(room.id, p.userId, room.stakeId);
      } catch (err) {
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
      send(p.ws, { type: "game_started", state: view });
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

  // Record for winner
  const wid = crypto.randomUUID();
  db.prepare(`INSERT INTO matches (id, user_id, opponent_name, user_score, opponent_score, is_win, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(wid, winner.userId, loser.username, winner.score, loser.score, 1);
  db.prepare("UPDATE users SET rating = MAX(100, rating + 15), wins = wins + 1 WHERE id = ?").run(winner.userId);

  // Record for loser
  const lid = crypto.randomUUID();
  db.prepare(`INSERT INTO matches (id, user_id, opponent_name, user_score, opponent_score, is_win, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(lid, loser.userId, winner.username, loser.score, winner.score, 0);
  db.prepare("UPDATE users SET rating = MAX(100, rating - 10), losses = losses + 1 WHERE id = ?").run(loser.userId);
}

// ── Forfeit / End match helper ───────────────────────────────────────

/**
 * End a match by forfeit/timeout/disconnect.
 * Handles: match state update, rating persistence, transcript finalization,
 * timer cleanup, and client notification.
 */
function endMatchByForfeit(
  room: RoomState,
  forfeitingUserId: string,
  forfeitingUsername: string,
  reason: "forfeit" | "timeout" | "disconnect"
) {
  if (!room.match || room.match.status === "game_over") return;

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

  // Notify remaining player
  const rp = room.players.get(remaining.userId);
  if (rp) {
    send(rp.ws, { type: "opponent_forfeited", username: forfeitingUsername });
    const view = getPlayerView(room.match, remaining.userId);
    if (view) send(rp.ws, {
      type: "game_over",
      state: view,
      knockerHand: [],
      opponentHand: [],
      showdown: {
        knockOutcome: "knock",
        knockerUsername: forfeitingUsername,
        opponentUsername: remaining.username,
        knocker: { username: forfeitingUsername, melds: [], deadwood: [], deadwoodValue: 0 },
        opponent: { username: remaining.username, melds: [], deadwood: [], deadwoodValue: 0 },
        roundWinnerUsername: remaining.username,
        roundPoints: 0,
      },
    });
  }

  // Tournament bracket advancement for forfeit/timeout/disconnect
  _handleTournamentAdvance(room.id, remaining.userId, remaining.username, forfeitingUserId);
}

// ── Turn timeout handler ─────────────────────────────────────────────

function handleTurnTimeout(roomId: string, timedOutPlayerId: string, consecutiveTimeouts: number) {
  const room = rooms.get(roomId);
  if (!room || !room.match || room.match.status !== "playing") return;

  const timedOutPlayer = room.match.players.find(p => p.userId === timedOutPlayerId);
  if (!timedOutPlayer) return;

  // Record timeout in transcript
  recordTimeout(roomId, timedOutPlayerId, timedOutPlayer.username);

  // Check if we should forfeit
  if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
    // Auto-forfeit — too many consecutive timeouts
    endMatchByForfeit(room, timedOutPlayerId, timedOutPlayer.username, "timeout");

    // Notify the timed-out player too if still connected
    const timedOutPlayerState = room.players.get(timedOutPlayerId);
    if (timedOutPlayerState?.ws) {
      send(timedOutPlayerState.ws, {
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

  // Notify the timed-out player
  const timedOutPlayerState = room.players.get(timedOutPlayerId);
  if (timedOutPlayerState?.ws) {
    send(timedOutPlayerState.ws, {
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

function handleMessage(ws: WebSocket, userId: string, username: string, msg: ClientMessage) {
  switch (msg.type) {
    case "ping": {
      send(ws, { type: "pong" });
      break;
    }

    case "create_room": {
      // Remove from existing room if any
      const existingRoom = playerToRoom.get(userId);
      if (existingRoom) {
        handleLeave(userId);
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
      room.players.set(userId, { userId, username, ws, connected: true });
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
      const existingRoom2 = playerToRoom.get(userId);
      if (existingRoom2) {
        // If reconnecting to the same room
        const existing = rooms.get(existingRoom2);
        if (existing && existing.id === msg.roomId) {
          const ep = existing.players.get(userId);
          if (ep) {
            ep.ws = ws;
            ep.connected = true;
            // Send current state
            send(ws, {
              type: "room_joined",
              room: {
                id: existing.id,
                hostUsername: Array.from(existing.players.values()).find(p => p.userId === existing.hostId)?.username || "",
                players: getRoomPlayers(existing),
                status: existing.status,
              },
            });
            if (existing.match) {
              const view = getPlayerView(existing.match, userId);
              if (view) send(ws, { type: "game_update", state: view });
            }
            // Notify opponent
            for (const p of existing.players.values()) {
              if (p.userId !== userId) {
                send(p.ws, { type: "opponent_reconnected", username });
              }
            }
            break;
          }
        }
        handleLeave(userId);
      }

      const room = rooms.get(msg.roomId);
      if (!room) {
        send(ws, { type: "error", message: "Room not found." });
        break;
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

      room.players.set(userId, { userId, username, ws, connected: true });
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
          send(p.ws, { type: "opponent_joined", opponent: { userId, username, connected: true } });
        }
      }

      // Both players present — start the game
      if (room.players.size === 2) {
        startMatchForRoom(room);
      }
      break;
    }

    case "draw": {
      const roomId = playerToRoom.get(userId);
      if (!roomId) { send(ws, { type: "error", message: "Not in a room." }); break; }
      const room = rooms.get(roomId);
      if (!room || !room.match) { send(ws, { type: "error", message: "No active match." }); break; }

      const result = handleDraw(room.match, userId, msg.source);
      if (!result.ok) { send(ws, { type: "error", message: (result as { ok: false; error: string }).error }); break; }

      // Player acted voluntarily — reset their timeout counter
      resetTimeoutCount(roomId, userId);

      // Record in transcript
      recordDraw(roomId, userId, username, msg.source);

      broadcastGameState(room);
      break;
    }

    case "discard": {
      const roomId = playerToRoom.get(userId);
      if (!roomId) { send(ws, { type: "error", message: "Not in a room." }); break; }
      const room = rooms.get(roomId);
      if (!room || !room.match) { send(ws, { type: "error", message: "No active match." }); break; }

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

      broadcastGameState(room);
      broadcastTimerUpdate(room);
      break;
    }

    case "knock": {
      const roomId = playerToRoom.get(userId);
      if (!roomId) { send(ws, { type: "error", message: "Not in a room." }); break; }
      const room = rooms.get(roomId);
      if (!room || !room.match) { send(ws, { type: "error", message: "No active match." }); break; }

      const result = handleKnock(room.match, userId, msg.cardIndex);
      if (!result.ok) { send(ws, { type: "error", message: (result as { ok: false; error: string }).error }); break; }

      // Player acted voluntarily — reset their timeout counter
      resetTimeoutCount(roomId, userId);

      // Record knock outcome in transcript
      if (result.knockOutcome && result.discardedCard && room.match.roundWinnerId) {
        const knocker = room.match.players.find(p => p.userId === userId)!;
        const opponent = room.match.players.find(p => p.userId !== userId)!;
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

      // Reveal the previous round's fairness seed before starting next round
      const prevRound = room.match.roundNumber;
      const transcript = getTranscript(roomId);
      const roundActions = transcript?.actions.filter(
        (a: any) => a.detail?.roundNumber === prevRound || true
      );
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
      handleLeave(userId);
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
        _createTournamentMatchRoom(tmnt.id, tmatch, ws, userId, username);
      } else {
        // Room exists — rejoin it
        const existingRoom = rooms.get(tmatch.roomId);
        if (existingRoom) {
          const ep = existingRoom.players.get(userId);
          if (ep) {
            ep.ws = ws;
            ep.connected = true;
          } else {
            existingRoom.players.set(userId, { userId, username, ws, connected: true });
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
            startMatchForRoom(existingRoom);
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

      // Remove from existing room if any
      const existingChallengeRoom = playerToRoom.get(userId);
      if (existingChallengeRoom && existingChallengeRoom !== targetRoomId) {
        handleLeave(userId);
      }

      // Check if room exists already
      let challengeRoom = rooms.get(targetRoomId);
      if (challengeRoom) {
        // Room already exists — try to join/reconnect
        const ep = challengeRoom.players.get(userId);
        if (ep) {
          // Reconnecting
          ep.ws = ws;
          ep.connected = true;
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
              send(p.ws, { type: "opponent_reconnected", username });
            }
          }
        } else if (challengeRoom.status === "waiting" && challengeRoom.players.size < 2) {
          // Join as second player
          challengeRoom.players.set(userId, { userId, username, ws, connected: true });
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
              send(p.ws, { type: "opponent_joined", opponent: { userId, username, connected: true } });
            }
          }
          // Both players present — start the game
          if (challengeRoom.players.size === 2) {
            startMatchForRoom(challengeRoom);
          }
        } else {
          send(ws, { type: "error", message: challengeRoom.status !== "waiting" ? "Game already in progress." : "Room is full." });
        }
      } else {
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
        newRoom.players.set(userId, { userId, username, ws, connected: true });
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

function handleLeave(userId: string) {
  const roomId = playerToRoom.get(userId);
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) { playerToRoom.delete(userId); return; }

  const leavingPlayer = room.players.get(userId);
  room.players.delete(userId);
  playerToRoom.delete(userId);

  // If the match was in progress, the remaining player wins by forfeit
  if (room.match && (room.match.status === "playing" || room.match.status === "round_over")) {
    endMatchByForfeit(room, userId, leavingPlayer?.username || "Opponent", "forfeit");
  } else {
    // Match hasn't started — refund any escrow holds
    refundEscrow(roomId);

    // Notify remaining players (for waiting room scenarios)
    if (leavingPlayer) {
      for (const p of room.players.values()) {
        send(p.ws, { type: "opponent_forfeited", username: leavingPlayer.username });
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
  const token = url.searchParams.get("token");
  if (!token || token.length < 10) return null;

  const session = db.prepare(
    "SELECT user_id FROM sessions WHERE id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).get(token) as { user_id: string } | undefined;
  if (!session) return null;

  const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(session.user_id) as { id: string; username: string } | undefined;
  if (!user) return null;

  return { userId: user.id, username: user.username };
}

// ── Attach to HTTP server ────────────────────────────────────────────

export function attachWebSocketServer(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // Register turn timeout callback
  setTurnTimeoutCallback(handleTurnTimeout);

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
        const existing = room.players.get(userId);
        if (existing) {
          existing.ws = ws;
          existing.connected = true;
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
            if (view) send(ws, { type: "game_update", state: view });
          }
          for (const p of room.players.values()) {
            if (p.userId !== userId) {
              send(p.ws, { type: "opponent_reconnected", username });
            }
          }
        }
      }
    }

    ws.on("message", (data) => {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());
        handleMessage(ws, userId, username, msg);
      } catch {
        send(ws, { type: "error", message: "Invalid message format." });
      }
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
      if (player) {
        player.ws = null;
        player.connected = false;

        // Record disconnect in transcript
        if (room.match && room.match.status === "playing") {
          recordDisconnect(roomId, userId, username);
        }

        // Notify opponent of disconnect
        for (const p of room.players.values()) {
          if (p.userId !== userId) {
            send(p.ws, { type: "opponent_disconnected", username });
          }
        }

        // Start a 60-second forfeit timer if in a game
        if (room.match && room.match.status === "playing") {
          setTimeout(() => {
            const r = rooms.get(roomId);
            if (!r) return;
            const pl = r.players.get(userId);
            if (pl && !pl.connected) {
              endMatchByForfeit(r, userId, username, "disconnect");
            }
          }, 60_000);
        }

        // If waiting and they disconnect, clean up room
        if (room.status === "waiting") {
          handleLeave(userId);
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

    room.players.set(p1.userId, { userId: p1.userId, username: p1.username, ws: p1.ws, connected: true });
    room.players.set(p2.userId, { userId: p2.userId, username: p2.username, ws: p2.ws, connected: true });
    rooms.set(roomId, room);
    playerToRoom.set(p1.userId, roomId);
    playerToRoom.set(p2.userId, roomId);

    // Notify both players of the match
    send(p1.ws, { type: "match_found", roomId, opponent: p2.username });
    send(p2.ws, { type: "match_found", roomId, opponent: p1.username });

    // Set timer speed from matched player preferences (use p1's preference)
    const timerSpeed = (p1 as any).timerSpeed || "medium";
    setRoomTimerSpeed(roomId, timerSpeed);

    // Start match with transcript + timer
    startMatchForRoom(room);

    // Send room_joined to each
    for (const p of room.players.values()) {
      send(p.ws, {
        type: "room_joined",
        room: {
          id: roomId,
          hostUsername: p1.username,
          players: getRoomPlayers(room),
          status: room.status,
        },
      });
    }
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
    const pState = room2?.players.get(entrant.userId);
    const ws = pState?.ws ?? null;

    if (ws && ws.readyState === 1) {
      send(ws, {
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
            send(ws, {
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
        send(ws, {
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
      const p = r?.players.get(entrant.userId);
      if (p?.ws && p.ws.readyState === 1) {
        send(p.ws, {
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
function _createTournamentMatchRoom(
  tournamentId: string,
  bracketMatch: BracketMatch,
  ws: WebSocket,
  userId: string,
  username: string
): void {
  // Leave any existing room
  const existingRoom = playerToRoom.get(userId);
  if (existingRoom) {
    handleLeave(userId);
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

  room.players.set(userId, { userId, username, ws, connected: true });
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
    const conn = spectatorConnections.get(specId);
    if (conn && conn.ws.readyState === WebSocket.OPEN) {
      send(conn.ws, { type: "spectator_update", state: wireView });
    }
  }
}

/**
 * Notify all spectators that a match is over.
 */
function notifySpectatorsMatchOver(roomId: string, message: string) {
  const spectatorIds = getRoomSpectatorIds(roomId);
  for (const specId of spectatorIds) {
    const conn = spectatorConnections.get(specId);
    if (conn && conn.ws.readyState === WebSocket.OPEN) {
      send(conn.ws, { type: "spectator_match_over", roomId, message });
    }
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
  spectatorConnections.set(userId, { ws, roomId });

  const specCount = getSpectatorCount(roomId);

  // Notify players of spectator count
  for (const p of room.players.values()) {
    send(p.ws, { type: "spectator_joined", roomId, spectatorCount: specCount });
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
  send(ws, { type: "spectator_update", state: wireView });
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
      send(p.ws, { type: "spectator_left", roomId, spectatorCount: specCount });
    }
  }
}

/**
 * Get a list of currently featured/spectatable matches.
 * Called by the REST API to populate the Featured Matches surface.
 */
export function getFeaturedMatches(): FeaturedMatch[] {
  const featured: FeaturedMatch[] = [];

  for (const [roomId, room] of rooms) {
    if (!room.match || room.status !== "playing") continue;
    if (room.match.status === "game_over") continue;

    const ps = Array.from(room.players.values());
    if (ps.length < 2) continue;

    const p1Rating = (db.prepare("SELECT rating FROM users WHERE id = ?").get(ps[0].userId) as any)?.rating ?? 1200;
    const p2Rating = (db.prepare("SELECT rating FROM users WHERE id = ?").get(ps[1].userId) as any)?.rating ?? 1200;
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

  for (const [roomId, room] of rooms) {
    if (room.status === "finished") continue;
    const ps = Array.from(room.players.values());
    if (ps.length < 2) continue;

    const p1Rating = (db.prepare("SELECT rating FROM users WHERE id = ?").get(ps[0].userId) as any)?.rating ?? 1200;
    const p2Rating = (db.prepare("SELECT rating FROM users WHERE id = ?").get(ps[1].userId) as any)?.rating ?? 1200;
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
export { rooms, playerToRoom, cleanupRoom, spectatorConnections };

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
