/**
 * React hook for multiplayer WebSocket connection.
 * Handles connection lifecycle, message sending, and state management.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "./store";
import type { ClientMessage, ServerMessage, PlayerGameView, RoomView, RoomPlayer, ShowdownData, FairnessStatusInfo } from "../../server/multiplayer/types";
import type { StakePreset } from "../../server/escrow";

export type MultiplayerPhase =
  | "disconnected"
  | "connecting"
  | "lobby"        // connected, not in a room
  | "searching"    // in matchmaking queue
  | "waiting"      // created/joined room, waiting for opponent
  | "playing"      // match in progress
  | "round_over"   // round ended
  | "game_over"    // match ended
  | "error";

export interface TurnTimerInfo {
  remainingSeconds: number;
  totalSeconds: number;
  isMyTimer: boolean;
}

export interface MultiplayerState {
  phase: MultiplayerPhase;
  roomId: string | null;
  room: RoomView | null;
  gameState: PlayerGameView | null;
  error: string | null;
  opponentDisconnected: boolean;
  matchFound: { roomId: string; opponent: string } | null;
  turnTimer: TurnTimerInfo | null;
  timeoutWarning: string | null;
  insufficientFunds: { message: string; balance: number; required: number; currency: string } | null;
  showdownData: ShowdownData | null;
  tournamentContext: { tournamentId: string; matchIndex: number; round: string; opponent: string } | null;
  tournamentUpdate: { tournamentId: string; status: string; bracket: any; winnerId: string | null; winnerUsername: string | null } | null;
  fairnessStatus: FairnessStatusInfo | null;
}

export function useMultiplayer() {
  const { sessionId } = useAuthStore();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalClose = useRef(false);

  const [state, setState] = useState<MultiplayerState>({
    phase: "disconnected",
    roomId: null,
    room: null,
    gameState: null,
    error: null,
    opponentDisconnected: false,
    matchFound: null,
    turnTimer: null,
    timeoutWarning: null,
    insufficientFunds: null,
    showdownData: null,
    tournamentContext: null,
    tournamentUpdate: null,
    fairnessStatus: null,
  });

  // Auto-seed generation: generate a cryptographically random client seed
  const generateClientSeed = useCallback((): string => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }, []);

  // Auto-submit client seed for a round
  const autoSubmitClientSeed = useCallback(() => {
    try {
      const seed = generateClientSeed();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "submit_client_seed", seed }));
      }
    } catch {
      // Graceful fallback: if seed generation fails, server falls back to v1
      console.warn("Failed to auto-submit client seed; Trust Shield will use v1 fallback.");
    }
  }, [generateClientSeed]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!sessionId) return;
    // Guard against duplicate connections
    if (wsRef.current) {
      const rs = wsRef.current.readyState;
      if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return;
    }

    intentionalClose.current = false;
    setState(prev => ({ ...prev, phase: "connecting", error: null }));

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(prev => ({ ...prev, phase: "lobby" }));
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch {
        console.error("Failed to parse server message");
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!intentionalClose.current) {
        setState(prev => ({
          ...prev,
          phase: "disconnected",
          error: prev.phase === "connecting" ? "Connection failed. Session may be expired — try logging out and back in." : prev.error,
        }));
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }, [sessionId]);

  // Disconnect
  const disconnect = useCallback(() => {
    intentionalClose.current = true;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState({
      phase: "disconnected",
      roomId: null,
      room: null,
      gameState: null,
      error: null,
      opponentDisconnected: false,
      matchFound: null,
      turnTimer: null,
      timeoutWarning: null,
      insufficientFunds: null,
      showdownData: null,
      tournamentContext: null,
      tournamentUpdate: null,
      fairnessStatus: null,
    });
  }, []);

  // Send a message
  const sendMessage = useCallback((msg: ClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Handle incoming messages
  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "room_created":
        setState(prev => ({ ...prev, roomId: msg.roomId, phase: "waiting" }));
        break;

      case "room_joined":
        setState(prev => ({
          ...prev,
          room: msg.room,
          roomId: msg.room.id,
          phase: prev.gameState ? prev.phase : "waiting",
        }));
        break;

      case "opponent_joined":
        setState(prev => ({
          ...prev,
          room: prev.room ? {
            ...prev.room,
            players: [...prev.room.players, msg.opponent],
          } : prev.room,
        }));
        break;

      case "game_started":
        setState(prev => ({
          ...prev,
          phase: "playing",
          gameState: msg.state,
          error: null,
          opponentDisconnected: false,
          fairnessStatus: msg.state.fairnessStatus || null,
        }));
        // Auto-submit a client seed for Trust Shield v2
        autoSubmitClientSeed();
        break;

      case "game_update": {
        const newPhase = msg.state.status === "playing" ? "playing" as const :
                 msg.state.status === "round_over" ? "round_over" as const :
                 msg.state.status === "game_over" ? "game_over" as const : null;
        setState(prev => {
          // Detect new round start (round_over → playing transition)
          const isNewRound = prev.phase === "round_over" && newPhase === "playing";
          return {
            ...prev,
            phase: newPhase || prev.phase,
            gameState: msg.state,
            fairnessStatus: msg.state.fairnessStatus || prev.fairnessStatus,
          };
        });
        // If we transitioned to a new round, auto-submit a fresh client seed
        if (msg.state.status === "playing") {
          // Use a small delay to ensure the server has created the commitment first
          setTimeout(() => autoSubmitClientSeed(), 50);
        }
        break;
      }

      case "round_over":
        setState(prev => ({
          ...prev,
          phase: "round_over",
          gameState: msg.state,
          showdownData: msg.showdown,
        }));
        break;

      case "game_over":
        setState(prev => ({
          ...prev,
          phase: "game_over",
          gameState: msg.state,
          showdownData: msg.showdown,
        }));
        break;

      case "opponent_disconnected":
        setState(prev => ({ ...prev, opponentDisconnected: true }));
        break;

      case "opponent_reconnected":
        setState(prev => ({ ...prev, opponentDisconnected: false }));
        break;

      case "opponent_forfeited":
        setState(prev => ({
          ...prev,
          phase: "game_over",
          gameState: prev.gameState ? {
            ...prev.gameState,
            status: "game_over",
            message: `${msg.username} forfeited. You win!`,
          } : prev.gameState,
        }));
        break;

      case "queue_joined":
        setState(prev => ({ ...prev, phase: "searching", error: null, matchFound: null }));
        break;

      case "queue_cancelled":
        setState(prev => ({ ...prev, phase: "lobby", matchFound: null }));
        break;

      case "match_found":
        setState(prev => ({
          ...prev,
          matchFound: { roomId: msg.roomId, opponent: msg.opponent },
        }));
        break;

      case "queue_timeout":
        setState(prev => ({
          ...prev,
          phase: "lobby",
          error: msg.message,
          matchFound: null,
        }));
        break;

      case "turn_timer":
        setState(prev => ({
          ...prev,
          turnTimer: {
            remainingSeconds: msg.remainingSeconds,
            totalSeconds: msg.totalSeconds,
            isMyTimer: prev.gameState ? msg.activePlayerId === prev.gameState.myUsername : false,
          },
        }));
        break;

      case "turn_timeout_warning":
        setState(prev => ({
          ...prev,
          timeoutWarning: msg.message,
        }));
        // Auto-clear warning after 5 seconds
        setTimeout(() => {
          setState(prev => ({ ...prev, timeoutWarning: null }));
        }, 5000);
        break;

      case "insufficient_funds":
        setState(prev => ({
          ...prev,
          insufficientFunds: {
            message: msg.message,
            balance: msg.balance,
            required: msg.required,
            currency: msg.currency,
          },
          error: msg.message,
        }));
        // Auto-clear after 8 seconds
        setTimeout(() => {
          setState(prev => ({ ...prev, insufficientFunds: null }));
        }, 8000);
        break;

      case "error":
        setState(prev => ({ ...prev, error: msg.message }));
        break;

      case "tournament_match_starting":
        setState(prev => ({
          ...prev,
          tournamentContext: {
            tournamentId: msg.tournamentId,
            matchIndex: msg.matchIndex,
            round: msg.round,
            opponent: msg.opponent,
          },
        }));
        break;

      case "tournament_update":
        setState(prev => ({
          ...prev,
          tournamentUpdate: {
            tournamentId: msg.tournamentId,
            status: msg.status,
            bracket: msg.bracket,
            winnerId: msg.winnerId,
            winnerUsername: msg.winnerUsername,
          },
        }));
        break;

      case "tournament_advance":
      case "tournament_eliminated":
        setState(prev => ({ ...prev, error: msg.message }));
        break;

      case "tournament_completed":
        setState(prev => ({
          ...prev,
          tournamentUpdate: {
            tournamentId: msg.tournamentId,
            status: "completed",
            bracket: prev.tournamentUpdate?.bracket ?? null,
            winnerId: msg.winnerId,
            winnerUsername: msg.winnerUsername,
          },
        }));
        break;

      case "fairness_status":
        setState(prev => ({
          ...prev,
          fairnessStatus: msg.status,
        }));
        break;

      case "client_seed_status":
        // Also handled via fairness_status, but this provides a per-player ack
        break;

      case "client_seed_accepted":
        // Seed was accepted by the server — no additional UI action needed
        break;

      case "pong":
        break;
    }
  }, [autoSubmitClientSeed]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, []);

  // Convenience actions
  const createRoom = useCallback(() => sendMessage({ type: "create_room" }), [sendMessage]);
  const joinRoom = useCallback((roomId: string) => sendMessage({ type: "join_room", roomId: roomId.toUpperCase().trim() }), [sendMessage]);
  const queueMatch = useCallback((stakeId: string = "free", timerSpeed: string = "medium", matchPosture: string = "like_rated") => sendMessage({ type: "queue_match", stakeId, timerSpeed, matchPosture }), [sendMessage]);
  const cancelQueue = useCallback(() => sendMessage({ type: "cancel_queue" }), [sendMessage]);
  const draw = useCallback((source: "stock" | "discard") => sendMessage({ type: "draw", source }), [sendMessage]);
  const discard = useCallback((cardIndex: number) => sendMessage({ type: "discard", cardIndex }), [sendMessage]);
  const knockCard = useCallback((cardIndex: number) => sendMessage({ type: "knock", cardIndex }), [sendMessage]);
  const nextRound = useCallback(() => sendMessage({ type: "next_round" }), [sendMessage]);
  const leaveRoom = useCallback(() => {
    sendMessage({ type: "leave_room" });
    setState(prev => ({
      ...prev,
      phase: "lobby",
      roomId: null,
      room: null,
      gameState: null,
      error: null,
      opponentDisconnected: false,
      matchFound: null,
      turnTimer: null,
      timeoutWarning: null,
      insufficientFunds: null,
      showdownData: null,
      tournamentContext: null,
      tournamentUpdate: null,
      fairnessStatus: null,
    }));
  }, [sendMessage]);

  const startTournamentMatch = useCallback((tournamentId: string, matchIndex: number) => {
    sendMessage({ type: "start_tournament_match", tournamentId, matchIndex });
  }, [sendMessage]);

  const joinChallengeRoom = useCallback((roomId: string, stakeId?: string) => {
    sendMessage({ type: "join_challenge_room", roomId, stakeId });
  }, [sendMessage]);

  return {
    ...state,
    connect,
    disconnect,
    createRoom,
    joinRoom,
    joinChallengeRoom,
    queueMatch,
    cancelQueue,
    draw,
    discard,
    knock: knockCard,
    nextRound,
    leaveRoom,
    startTournamentMatch,
    clearError: useCallback(() => setState(prev => ({ ...prev, error: null })), []),
  };
}
