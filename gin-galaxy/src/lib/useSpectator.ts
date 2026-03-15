/**
 * React hook for spectator WebSocket connection.
 * Connects to the same WS endpoint but sends watch_match to enter spectator mode.
 * Receives spectator_update messages with privacy-safe game state.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "./store";
import type { SpectatorGameViewWire } from "../../server/multiplayer/types";

export type SpectatorPhase = "disconnected" | "connecting" | "watching" | "match_over" | "error";

export interface SpectatorState {
  phase: SpectatorPhase;
  roomId: string | null;
  gameView: SpectatorGameViewWire | null;
  matchOverMessage: string | null;
  error: string | null;
  spectatorCount: number;
}

export function useSpectator(targetRoomId: string | null) {
  const { sessionId } = useAuthStore();
  const wsRef = useRef<WebSocket | null>(null);
  const intentionalClose = useRef(false);

  const [state, setState] = useState<SpectatorState>({
    phase: "disconnected",
    roomId: targetRoomId,
    gameView: null,
    matchOverMessage: null,
    error: null,
    spectatorCount: 0,
  });

  const connect = useCallback(() => {
    if (!sessionId || !targetRoomId) return;
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
      // Send watch_match as soon as connected
      ws.send(JSON.stringify({ type: "watch_match", roomId: targetRoomId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "spectator_update":
            setState(prev => ({
              ...prev,
              phase: "watching",
              gameView: msg.state,
              error: null,
            }));
            break;

          case "spectator_joined":
            setState(prev => ({ ...prev, spectatorCount: msg.spectatorCount }));
            break;

          case "spectator_left":
            setState(prev => ({ ...prev, spectatorCount: msg.spectatorCount }));
            break;

          case "spectator_match_over":
            setState(prev => ({
              ...prev,
              phase: "match_over",
              matchOverMessage: msg.message,
            }));
            break;

          case "error":
            setState(prev => ({
              ...prev,
              phase: "error",
              error: msg.message,
            }));
            break;

          default:
            // Ignore other messages (room_joined, etc.)
            break;
        }
      } catch {
        console.error("Failed to parse spectator message");
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!intentionalClose.current) {
        setState(prev => ({
          ...prev,
          phase: prev.phase === "watching" ? "match_over" : "disconnected",
          matchOverMessage: prev.phase === "watching" ? "Connection lost" : null,
        }));
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }, [sessionId, targetRoomId]);

  const disconnect = useCallback(() => {
    intentionalClose.current = true;
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ type: "leave_spectate" }));
      } catch {}
      wsRef.current.close();
      wsRef.current = null;
    }
    setState({
      phase: "disconnected",
      roomId: null,
      gameView: null,
      matchOverMessage: null,
      error: null,
      spectatorCount: 0,
    });
  }, []);

  // Auto-connect when targetRoomId is set
  useEffect(() => {
    if (targetRoomId && sessionId) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [targetRoomId, sessionId]);

  return {
    ...state,
    connect,
    disconnect,
  };
}
