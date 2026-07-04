import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Check,
  Wifi,
  WifiOff,
  Users,
  Loader2,
  Search,
  Zap,
  Clock,
  AlertTriangle,
  Coins,
  Sparkles,
  Trophy,
  Settings,
  Volume2,
  VolumeX,
  RotateCcw,
  Shield,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Button } from "@/src/components/ui/Button";
import { motion, AnimatePresence } from "motion/react";
import { useMultiplayer } from "@/src/lib/useMultiplayer";
import { useAuthStore } from "@/src/lib/store";
import { usePreferences, getSuitColor } from "@/src/lib/preferences";
import {
  computeMeldHighlights,
  getMeldColor,
  getCardMeldIndex,
  type MeldHighlightMap,
} from "@/src/lib/meldHighlight";
import { useHandDrag } from "@/src/lib/handDrag";
import {
  playDrawSound,
  playDiscardSound,
  playDealSound,
  playKnockSound,
  playResultSound,
  prefersReducedMotion,
} from "@/src/lib/audio";
import type { Card as EngineCard } from "@/src/lib/engine";
import type {
  ShowdownData,
  ShowdownPlayerData,
  ShowdownMeld,
  CardView,
} from "../../server/multiplayer/types";
import { SpectatorView } from "./SpectatorView";
import {
  PlayingCard,
  OverlappingCard,
  CardBack,
  ShowdownCardMini,
  TABLE_FELT_GRADIENT,
  TABLE_NOISE_STYLE,
} from "@/src/components/cards";
import * as MP from "@/src/lib/motionPresets";

// ── Card display types ───────────────────────────────────────────────

type Suit = "♠" | "♥" | "♦" | "♣";
type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
const SUIT_ORDER: Record<string, number> = { "♣": 0, "♦": 1, "♥": 2, "♠": 3 };
const RANK_ORDER: Record<string, number> = {
  A: 0,
  "2": 1,
  "3": 2,
  "4": 3,
  "5": 4,
  "6": 5,
  "7": 6,
  "8": 7,
  "9": 8,
  "10": 9,
  J: 10,
  Q: 11,
  K: 12,
};

function sortCards(cards: CardView[]): CardView[] {
  return [...cards].sort((a, b) => {
    const sd = (SUIT_ORDER[a.suit] ?? 0) - (SUIT_ORDER[b.suit] ?? 0);
    if (sd !== 0) return sd;
    return (RANK_ORDER[a.rank] ?? 0) - (RANK_ORDER[b.rank] ?? 0);
  });
}

// Local card components removed — now imported from @/src/components/cards

// ── ShowdownPlayerSection ────────────────────────────────────────────

const ShowdownPlayerSection: React.FC<{
  data: ShowdownPlayerData;
  isKnocker: boolean;
  knockOutcome: "knock" | "gin" | "undercut";
  fourColor?: boolean;
  showDeadwoodCount?: boolean;
}> = ({ data, isKnocker, knockOutcome, fourColor = false, showDeadwoodCount = true }) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-zinc-100">{data.username}</span>
        {isKnocker && (
          <span
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-bold border",
              knockOutcome === "gin"
                ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
            )}
          >
            {knockOutcome === "gin" ? "GIN" : "KNOCKER"}
          </span>
        )}
        {showDeadwoodCount && (
          <span className="text-[10px] text-emerald-600/60 ml-auto">DW: {data.deadwoodValue}</span>
        )}
      </div>

      {/* Melds */}
      {data.melds.length > 0 && (
        <div className="space-y-1">
          {data.melds.map((meld, mi) => (
            <div key={mi} className="flex items-center gap-0.5">
              <span className="text-[9px] text-emerald-500 w-8 flex-shrink-0 font-medium">
                {meld.type === "set" ? "Set" : "Run"}
              </span>
              <div className="flex gap-0.5 flex-wrap">
                {meld.cards.map((c, ci) => (
                  <ShowdownCardMini
                    key={ci}
                    suit={c.suit}
                    rank={c.rank}
                    highlight="meld"
                    fourColor={fourColor}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Laid-off cards */}
      {data.laidOffCards && data.laidOffCards.length > 0 && (
        <div className="flex items-center gap-0.5">
          <span className="text-[9px] text-amber-500 w-8 flex-shrink-0 font-medium">Laid</span>
          <div className="flex gap-0.5 flex-wrap">
            {data.laidOffCards.map((c, ci) => (
              <ShowdownCardMini
                key={ci}
                suit={c.suit}
                rank={c.rank}
                highlight="layoff"
                fourColor={fourColor}
              />
            ))}
          </div>
        </div>
      )}

      {/* Deadwood */}
      {data.deadwood.length > 0 && (
        <div className="flex items-center gap-0.5">
          <span className="text-[9px] text-zinc-500 w-8 flex-shrink-0 font-medium">DW</span>
          <div className="flex gap-0.5 flex-wrap">
            {data.deadwood.map((c, ci) => (
              <ShowdownCardMini
                key={ci}
                suit={c.suit}
                rank={c.rank}
                highlight="deadwood"
                fourColor={fourColor}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export function MultiplayerRoom() {
  const [searchParams] = useSearchParams();

  if (searchParams.get("watch")) {
    return <SpectatorView />;
  }

  return <MultiplayerGameRoom />;
}

// ── Main Component ───────────────────────────────────────────────────

function MultiplayerGameRoom() {
  const { user } = useAuthStore();
  const mp = useMultiplayer();
  const {
    showDeadwoodCount,
    fourColorDeck,
    soundEnabled,
    animationsEnabled,
    setShowDeadwoodCount,
    setFourColorDeck,
    setSoundEnabled,
    setAnimationsEnabled,
  } = usePreferences();
  const [searchParams] = useSearchParams();
  const [joinCode, setJoinCode] = useState("");
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const autoQueueTriggered = useRef(false);
  const [displayTimer, setDisplayTimer] = useState<number | null>(null);
  const [selectedStake, setSelectedStake] = useState("gold_100");
  const [walletBalance, setWalletBalance] = useState<{
    gold_coins: number;
    sweeps_coins: number;
  } | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [knockAnimating, setKnockAnimating] = useState(false);
  const [discardAnimating, setDiscardAnimating] = useState(false);
  const [timerSpeed, setTimerSpeed] = useState("medium");
  const [matchPosture, setMatchPosture] = useState("like_rated");

  const reducedMotion = prefersReducedMotion();
  const shouldAnimate = animationsEnabled && !reducedMotion;
  const playSound = useCallback(
    (fn: () => void) => {
      if (soundEnabled) fn();
    },
    [soundEnabled],
  );
  const activeHand = mp.gameState?.myHand ?? [];

  // Drag-and-drop hand management
  const {
    displayHand,
    dragState,
    isCustomOrder,
    onDragStart,
    onDragOver,
    onDragEnd,
    resetToAutoSort,
  } = useHandDrag(activeHand);

  // Meld highlighting
  const meldHighlights = useMemo<MeldHighlightMap>(() => {
    const hand10 = activeHand.length <= 10 ? activeHand : activeHand.slice(0, 10);
    return computeMeldHighlights(hand10 as EngineCard[]);
  }, [activeHand]);

  // Global pointer up for drag end
  useEffect(() => {
    const handler = () => {
      if (dragState.isDragging) onDragEnd();
    };
    window.addEventListener("pointerup", handler);
    return () => window.removeEventListener("pointerup", handler);
  }, [dragState.isDragging, onDragEnd]);

  // Fetch wallet balances
  useEffect(() => {
    if (!mp.phase) return;
    const { sessionId } = useAuthStore.getState();
    if (!sessionId) return;
    fetch("/api/wallet", { headers: { Authorization: `Bearer ${sessionId}` } })
      .then((r) => r.json())
      .then((d) => setWalletBalance(d.balances))
      .catch(() => {});
  }, [mp.phase]);

  // Helper to compute rake-adjusted presets (mirrors server logic)
  function makeClientPreset(
    id: string,
    label: string,
    currency: string,
    entryFee: number,
    rakePercent: number,
    icon: any,
    color: string,
  ) {
    const totalHeld = entryFee * 2;
    const rakeAmount = Math.round(totalHeld * rakePercent * 100) / 100;
    const prizePool = totalHeld - rakeAmount;
    return { id, label, currency, entryFee, rakePercent, rakeAmount, prizePool, icon, color };
  }

  const STAKE_PRESETS = [
    makeClientPreset("free", "Practice", "gold_coins", 0, 0, Zap, "emerald"),
    makeClientPreset("gold_100", "100 Coins", "gold_coins", 100, 0.05, Coins, "amber"),
    makeClientPreset("gold_500", "500 Coins", "gold_coins", 500, 0.05, Coins, "amber"),
    makeClientPreset("gold_2000", "2,000 Coins", "gold_coins", 2000, 0.05, Coins, "amber"),
    makeClientPreset("gold_5000", "5,000 Coins", "gold_coins", 5000, 0.05, Coins, "amber"),
    makeClientPreset("gold_10000", "10,000 Coins", "gold_coins", 10000, 0.05, Coins, "amber"),
  ];

  // Compute recommended (highest affordable) stake
  const affordablePresets = STAKE_PRESETS.filter(
    (p) => p.entryFee === 0 || (walletBalance ? walletBalance.gold_coins >= p.entryFee : true),
  );
  const recommendedStake =
    affordablePresets.length > 1
      ? affordablePresets[affordablePresets.length - 1] // highest affordable
      : affordablePresets[0] || STAKE_PRESETS[0];
  const canAffordAnyStake = walletBalance ? walletBalance.gold_coins >= 100 : true;

  // Auto-select recommended gold stake when wallet loads (only once)
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (walletBalance && !autoSelectedRef.current) {
      autoSelectedRef.current = true;
      if (walletBalance.gold_coins >= 100) {
        // Select lowest non-free stake by default for commercial intent
        setSelectedStake("gold_100");
      } else {
        setSelectedStake("free");
      }
    }
  }, [walletBalance]);

  // Timer countdown — update every second based on server timer info
  useEffect(() => {
    if (mp.gameState?.turnTimer) {
      setDisplayTimer(mp.gameState.turnTimer.remainingSeconds);
      const interval = setInterval(() => {
        setDisplayTimer((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setDisplayTimer(null);
    }
  }, [mp.gameState?.turnTimer?.remainingSeconds, mp.gameState?.turnTimer?.isMyTimer]);

  // Auto-queue when navigated with ?quickmatch=true
  useEffect(() => {
    if (searchParams.get("quickmatch") === "true" && !autoQueueTriggered.current) {
      if (mp.phase === "disconnected") {
        mp.connect();
      }
    }
  }, [searchParams, mp.phase]);

  // Once connected in lobby, auto-queue if quickmatch param is set
  useEffect(() => {
    if (
      searchParams.get("quickmatch") === "true" &&
      mp.phase === "lobby" &&
      !autoQueueTriggered.current
    ) {
      autoQueueTriggered.current = true;
      mp.queueMatch(selectedStake);
    }
  }, [searchParams, mp.phase]);

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => mp.disconnect();
  }, []);

  // Tournament match: auto-connect and start when navigated with tournament params
  const tournamentAutoTriggered = useRef(false);
  useEffect(() => {
    const tournamentId = searchParams.get("tournamentId");
    const matchIndex = searchParams.get("matchIndex");
    if (tournamentId && matchIndex && !tournamentAutoTriggered.current) {
      if (mp.phase === "disconnected") {
        mp.connect();
      }
    }
  }, [searchParams, mp.phase]);

  useEffect(() => {
    const tournamentId = searchParams.get("tournamentId");
    const matchIndex = searchParams.get("matchIndex");
    if (tournamentId && matchIndex && mp.phase === "lobby" && !tournamentAutoTriggered.current) {
      tournamentAutoTriggered.current = true;
      mp.startTournamentMatch(tournamentId, parseInt(matchIndex));
    }
  }, [searchParams, mp.phase]);

  // Challenge room: auto-connect and join when navigated with ?challengeRoom=ROOMID
  const challengeRoomTriggered = useRef(false);
  useEffect(() => {
    const challengeRoom = searchParams.get("challengeRoom");
    if (challengeRoom && !challengeRoomTriggered.current) {
      if (mp.phase === "disconnected") {
        mp.connect();
      }
    }
  }, [searchParams, mp.phase]);

  useEffect(() => {
    const challengeRoom = searchParams.get("challengeRoom");
    if (challengeRoom && mp.phase === "lobby" && !challengeRoomTriggered.current) {
      challengeRoomTriggered.current = true;
      mp.joinChallengeRoom(challengeRoom);
    }
  }, [searchParams, mp.phase]);

  const copyRoomCode = () => {
    if (mp.roomId) {
      navigator.clipboard.writeText(mp.roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── Lobby: Create or Join ────────────────────────────────────────
  if (mp.phase === "disconnected" || mp.phase === "connecting" || mp.phase === "lobby") {
    return (
      <div className="fixed inset-0 bg-[#0a1f15] flex flex-col font-sans">
        <header className="h-14 border-b border-emerald-900/50 bg-[#0d1a12]/90 backdrop-blur flex items-center justify-between px-4 z-10">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-emerald-700 hover:text-emerald-300 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <span className="text-sm font-medium text-emerald-400/70">Multiplayer</span>
          </div>
          <div className="flex items-center gap-2">
            {mp.phase === "connecting" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                <span className="text-xs text-amber-400">Connecting...</span>
              </>
            ) : mp.phase === "lobby" ? (
              <>
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-emerald-400">Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-rose-400" />
                <span className="text-xs text-rose-400">Disconnected</span>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 relative">
          {/* Felt background for lobby */}
          <div className={cn("absolute inset-0 pointer-events-none", TABLE_FELT_GRADIENT)} />
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={TABLE_NOISE_STYLE}
          />
          <div className="max-w-md w-full space-y-8 relative z-10">
            <div className="text-center space-y-2">
              <h1 className="text-4xl font-bold tracking-tighter text-white">Multiplayer</h1>
              <p className="text-emerald-400/60">
                Find an opponent instantly, or create a room to play with a friend.
              </p>
            </div>

            {mp.error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-sm text-rose-400 text-center"
              >
                {mp.error}
                <button onClick={mp.clearError} className="ml-2 underline text-xs">
                  dismiss
                </button>
              </motion.div>
            )}

            {mp.phase === "disconnected" && (
              <Button
                variant="primary"
                onClick={mp.connect}
                className="w-full h-14 text-lg bg-amber-600 hover:bg-amber-500 rounded-xl shadow-[0_0_40px_-10px_rgba(217,119,6,0.5)]"
              >
                Connect to Server
              </Button>
            )}

            {mp.phase === "connecting" && (
              <div className="flex items-center justify-center gap-3 py-8">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                <span className="text-emerald-300">Connecting...</span>
              </div>
            )}

            {mp.phase === "lobby" && (
              <div className="space-y-6">
                {/* Quick Match — primary action */}
                <Button
                  variant="primary"
                  onClick={() => mp.queueMatch(selectedStake, timerSpeed, matchPosture)}
                  className="w-full h-16 text-xl font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 rounded-xl shadow-[0_0_50px_-10px_rgba(245,158,11,0.5)] transition-all"
                  id="quick-match-btn"
                >
                  <Zap className="mr-2 h-6 w-6" /> Quick Match
                </Button>

                {/* Stake Selection */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-zinc-400">Stake Level</h3>
                    {walletBalance && (
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-amber-400 flex items-center gap-1">
                          <Coins className="w-3 h-3" /> {walletBalance.gold_coins.toLocaleString()}{" "}
                          Coins
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {STAKE_PRESETS.map((preset) => {
                      const isSelected = selectedStake === preset.id;
                      const canAfford =
                        preset.entryFee === 0 ||
                        (walletBalance ? walletBalance.gold_coins >= preset.entryFee : true);
                      const Icon = preset.icon;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => setSelectedStake(preset.id)}
                          disabled={!canAfford}
                          className={cn(
                            "relative flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all text-sm",
                            isSelected
                              ? preset.color === "emerald"
                                ? "bg-emerald-950/50 border-emerald-500/60 text-emerald-300 shadow-[0_0_20px_-8px_rgba(16,185,129,0.3)]"
                                : "bg-amber-950/50 border-amber-500/60 text-amber-300 shadow-[0_0_20px_-8px_rgba(245,158,11,0.3)]"
                              : canAfford
                                ? "bg-[#0a2e1e]/50 border-emerald-800/50 text-emerald-400/60 hover:bg-[#0a2e1e]/70 hover:border-emerald-700/60"
                                : "bg-[#0a2e1e]/30 border-emerald-900/30 text-emerald-600/40 cursor-not-allowed opacity-60",
                          )}
                        >
                          <Icon
                            className={cn(
                              "w-4 h-4 flex-shrink-0",
                              isSelected
                                ? preset.color === "emerald"
                                  ? "text-emerald-400"
                                  : preset.color === "amber"
                                    ? "text-amber-400"
                                    : "text-violet-400"
                                : "text-zinc-500",
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{preset.label}</div>
                            {preset.entryFee > 0 && (
                              <div className="text-[10px] text-zinc-500">
                                Win {preset.prizePool.toLocaleString()}
                                {preset.rakePercent > 0 && (
                                  <span className="text-zinc-600 ml-1">
                                    ({(preset.rakePercent * 100).toFixed(0)}% rake)
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          {isSelected && (
                            <div
                              className={cn(
                                "w-2 h-2 rounded-full",
                                preset.color === "emerald"
                                  ? "bg-emerald-400"
                                  : preset.color === "amber"
                                    ? "bg-amber-400"
                                    : "bg-violet-400",
                              )}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Low-balance guidance */}
                  {walletBalance && !canAffordAnyStake && (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-amber-950/20 border border-amber-800/30 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                      <span className="text-zinc-400">
                        Need coins for staked play.
                        <Link to="/daily" className="text-emerald-400 underline ml-1">
                          Earn free coins
                        </Link>{" "}
                        or
                        <Link to="/wallet" className="text-amber-400 underline ml-1">
                          buy coins
                        </Link>
                      </span>
                    </div>
                  )}

                  {/* Recommended stake hint */}
                  {walletBalance && canAffordAnyStake && recommendedStake.entryFee > 0 && (
                    <div className="text-[10px] text-zinc-500 px-1 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      Recommended:{" "}
                      <strong className="text-zinc-400">{recommendedStake.label}</strong> based on
                      your bankroll
                    </div>
                  )}
                </div>

                {/* Timer Speed + Matchmaking Posture Selectors */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Timer Speed */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> Timer Speed
                    </h3>
                    <div className="space-y-1.5">
                      {(
                        [
                          { id: "fast", label: "Fast", sub: "20s per turn", color: "rose" },
                          { id: "medium", label: "Medium", sub: "30s per turn", color: "amber" },
                          { id: "slow", label: "Slow", sub: "40s per turn", color: "emerald" },
                        ] as const
                      ).map((opt) => {
                        const isSelected = timerSpeed === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => setTimerSpeed(opt.id)}
                            className={cn(
                              "w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-all",
                              isSelected
                                ? opt.color === "rose"
                                  ? "bg-rose-950/40 border-rose-500/50 text-rose-300"
                                  : opt.color === "amber"
                                    ? "bg-amber-950/40 border-amber-500/50 text-amber-300"
                                    : "bg-emerald-950/40 border-emerald-500/50 text-emerald-300"
                                : "bg-[#0a2e1e]/40 border-emerald-800/40 text-emerald-500/60 hover:border-emerald-700/50 hover:text-emerald-400/80",
                            )}
                          >
                            <span className="font-medium">{opt.label}</span>
                            <span className="text-[10px] opacity-70">{opt.sub}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Matchmaking Posture */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" /> Match Quality
                    </h3>
                    <div className="space-y-1.5">
                      {(
                        [
                          {
                            id: "like_rated",
                            label: "Like Rated",
                            sub: "Tighter skill match",
                            color: "emerald",
                          },
                          {
                            id: "wider_field",
                            label: "Wider Field",
                            sub: "Faster queue times",
                            color: "amber",
                          },
                        ] as const
                      ).map((opt) => {
                        const isSelected = matchPosture === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => setMatchPosture(opt.id)}
                            className={cn(
                              "w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-all",
                              isSelected
                                ? opt.color === "emerald"
                                  ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-300"
                                  : "bg-amber-950/40 border-amber-500/50 text-amber-300"
                                : "bg-[#0a2e1e]/40 border-emerald-800/40 text-emerald-500/60 hover:border-emerald-700/50 hover:text-emerald-400/80",
                            )}
                          >
                            <span className="font-medium">{opt.label}</span>
                            <span className="text-[10px] opacity-70">{opt.sub}</span>
                          </button>
                        );
                      })}
                      <p className="text-[10px] text-emerald-600/50 px-1">
                        Wider Field expands rating brackets by 1.5×
                      </p>
                    </div>
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-emerald-800/40" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-4 bg-[#0a1f15] text-emerald-600/50">or play a friend</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    onClick={mp.createRoom}
                    className="h-12 rounded-xl border-emerald-700/50 hover:bg-emerald-900/30 text-emerald-400"
                  >
                    <Users className="mr-2 h-4 w-4" /> Create Room
                  </Button>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                      placeholder="Code"
                      maxLength={6}
                      className="flex-1 min-w-0 bg-[#0a2e1e]/60 border border-emerald-800/50 rounded-xl px-3 py-2 text-center text-sm font-mono tracking-[0.2em] text-white placeholder:text-emerald-700/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                    <Button
                      variant="outline"
                      onClick={() => mp.joinRoom(joinCode)}
                      disabled={joinCode.length < 4}
                      className="px-4 rounded-xl border-emerald-700/50 hover:bg-emerald-900/30 text-emerald-400"
                    >
                      Join
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── Searching / Matchmaking Queue ─────────────────────────────────
  if (mp.phase === "searching") {
    return (
      <div className="fixed inset-0 bg-[#0a1f15] flex flex-col font-sans">
        <header className="h-14 border-b border-emerald-900/50 bg-[#0d1a12]/90 backdrop-blur flex items-center justify-between px-4 z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                mp.cancelQueue();
              }}
              className="text-emerald-700 hover:text-emerald-300 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-emerald-400/70">Finding Opponent</span>
          </div>
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-amber-400 animate-pulse" />
            <span className="text-xs text-amber-400">Searching...</span>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 relative">
          <div className={cn("absolute inset-0 pointer-events-none", TABLE_FELT_GRADIENT)} />
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={TABLE_NOISE_STYLE}
          />
          <div className="max-w-md w-full text-center space-y-8 relative z-10">
            <div className="space-y-4">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/40"
              >
                <Zap className="w-12 h-12 text-amber-400" />
              </motion.div>
              <h2 className="text-2xl font-bold text-white">Finding your opponent...</h2>
              <p className="text-emerald-400/60">
                You're in the matchmaking queue. We'll pair you as soon as another player joins.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <motion.div
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{
                  repeat: Infinity,
                  duration: 3,
                  ease: "easeInOut",
                  repeatType: "reverse",
                }}
                className="h-1 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
              />
              <Button
                variant="outline"
                onClick={mp.cancelQueue}
                className="border-emerald-700/50 hover:bg-emerald-900/30 text-emerald-400"
                id="cancel-queue-btn"
              >
                Cancel Search
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Waiting Room ─────────────────────────────────────────────────
  if (mp.phase === "waiting") {
    return (
      <div className="fixed inset-0 bg-[#0a1f15] flex flex-col font-sans">
        <header className="h-14 border-b border-emerald-900/50 bg-[#0d1a12]/90 backdrop-blur flex items-center justify-between px-4 z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={mp.leaveRoom}
              className="text-emerald-700 hover:text-emerald-300 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-emerald-400/70">Waiting for Opponent</span>
          </div>
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-emerald-400">Connected</span>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 relative">
          <div className={cn("absolute inset-0 pointer-events-none", TABLE_FELT_GRADIENT)} />
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={TABLE_NOISE_STYLE}
          />
          <div className="max-w-md w-full text-center space-y-8 relative z-10">
            <div className="space-y-4">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/30">
                <Loader2 className="w-10 h-10 animate-spin text-amber-400" />
              </div>
              <h2 className="text-2xl font-bold text-white">Waiting for opponent...</h2>
              <p className="text-emerald-400/60">Share this code with your friend</p>
            </div>

            {mp.roomId && (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-3">
                  <div className="bg-[#0a2e1e]/60 border border-emerald-700/50 rounded-xl px-8 py-4 text-3xl font-mono font-bold tracking-[0.4em] text-white shadow-lg">
                    {mp.roomId}
                  </div>
                  <button
                    onClick={copyRoomCode}
                    className="p-3 rounded-xl bg-[#0a2e1e]/60 border border-emerald-700/50 text-emerald-400 hover:text-white hover:bg-emerald-800/40 transition-colors"
                  >
                    {copied ? (
                      <Check className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </button>
                </div>
                {copied && <p className="text-xs text-emerald-400">Copied to clipboard!</p>}
              </div>
            )}

            {mp.room && (
              <div className="bg-[#0a2e1e]/40 border border-emerald-800/40 rounded-xl p-4 space-y-2">
                <h3 className="text-sm font-medium text-emerald-400/60">Players in room</h3>
                {mp.room.players.map((p) => (
                  <div key={p.userId} className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-[10px] font-bold">
                      {p.username[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm text-zinc-300">{p.username}</span>
                    <span className="text-xs text-emerald-400">●</span>
                  </div>
                ))}
              </div>
            )}

            <Button
              variant="outline"
              onClick={mp.leaveRoom}
              className="border-emerald-700/50 hover:bg-emerald-900/30 text-emerald-400"
            >
              Leave Room
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // ── Active Game ──────────────────────────────────────────────────
  const gs = mp.gameState;
  if (!gs)
    return (
      <div className="min-h-screen bg-[#0a1f15] flex items-center justify-center text-emerald-400/60">
        Loading game...
      </div>
    );

  const isMyTurn = gs.isMyTurn;

  const overlapPx = 38;
  const cardWidth = 72;
  const handWidth = displayHand.length > 0 ? (displayHand.length - 1) * overlapPx + cardWidth : 0;

  const handleDraw = (source: "stock" | "discard") => {
    if (!isMyTurn || gs.hasDrawn) return;
    playSound(playDrawSound);
    mp.draw(source);
    setSelectedCardIndex(null);
  };

  const handleDiscard = () => {
    if (!isMyTurn || !gs.hasDrawn || selectedCardIndex === null) return;
    playSound(playDiscardSound);
    if (shouldAnimate) {
      setDiscardAnimating(true);
      setTimeout(() => setDiscardAnimating(false), 400);
    }
    mp.discard(selectedCardIndex);
    setSelectedCardIndex(null);
  };

  const handleKnock = () => {
    if (!isMyTurn || !gs.hasDrawn || selectedCardIndex === null) return;
    playSound(playKnockSound);
    if (shouldAnimate) {
      setKnockAnimating(true);
      setTimeout(() => setKnockAnimating(false), MP.KNOCK_FLASH_DURATION * 1000);
    }
    mp.knock(selectedCardIndex);
    setSelectedCardIndex(null);
  };

  const livePrompt =
    gs.status === "game_over"
      ? "Match complete. Review the board and line up the next set."
      : gs.status === "round_over"
        ? "Round locked. Review the reveal and advance when both players are ready."
        : isMyTurn
          ? gs.hasDrawn
            ? "Your move: choose the cleanest discard or close the door with a knock."
            : "Your move: read the discard and decide whether to draw blind or take the shown card."
          : `${gs.opponentUsername} is on the clock. Track the discard lane and be ready to answer.`;
  const tableTelemetry = [
    { label: "Turn", value: gs.turnNumber ?? 1 },
    { label: "Cards Remaining", value: gs.stockCount },
  ];

  const roomCode = mp.roomId ?? gs.roomId;

  return (
    <div className="fixed inset-0 bg-[#0a1f15] flex flex-col font-sans">
      {/* Game Header — Compact */}
      <header className="h-14 border-b border-emerald-900/40 bg-[#0d1a12]/85 backdrop-blur-xl flex items-center justify-between px-3 sm:px-4 z-20">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={mp.leaveRoom}
            className="text-emerald-700 hover:text-emerald-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.34em] text-emerald-500/45">
              Competitive Table
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="truncate text-sm font-semibold text-zinc-100"
                style={{ fontFamily: '"Fraunces", ui-serif, Georgia, serif' }}
              >
                vs {gs.opponentUsername}
              </span>
              <span className="hidden rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.24em] text-amber-200 sm:inline-flex">
                Live
              </span>
            </div>
          </div>
          {/* Trust Shield badge */}
          {mp.fairnessStatus && (
            <div className="relative group" id="trust-shield-badge">
              <span
                className={cn(
                  "px-1.5 py-0.5 rounded text-[9px] font-bold border flex items-center gap-0.5 cursor-default transition-colors",
                  mp.fairnessStatus.activeVersion >= 2
                    ? "bg-emerald-500/10 text-emerald-400/80 border-emerald-500/20"
                    : mp.fairnessStatus.mySeedSubmitted || mp.fairnessStatus.opponentSeedSubmitted
                      ? "bg-amber-500/10 text-amber-400/80 border-amber-500/20"
                      : "bg-emerald-800/30 text-emerald-600/60 border-emerald-800/40",
                )}
              >
                <Shield
                  className={cn(
                    "w-2.5 h-2.5",
                    mp.fairnessStatus.activeVersion >= 2 && "text-emerald-400",
                  )}
                />
                {mp.fairnessStatus.activeVersion >= 2 ? "v2" : "v1"}
              </span>
              {/* Tooltip on hover */}
              <div className="absolute right-0 top-8 w-56 bg-[#0d1a12] border border-emerald-800/50 rounded-xl shadow-xl p-3 space-y-1.5 z-50 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity">
                <div className="text-[10px] font-bold text-zinc-200">{mp.fairnessStatus.label}</div>
                <div className="text-[9px] text-emerald-500/60">
                  Commitment:{" "}
                  <span className="font-mono text-emerald-400/70">
                    {mp.fairnessStatus.commitmentHashShort}…
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[9px]">
                  <span
                    className={
                      mp.fairnessStatus.commitmentPublished
                        ? "text-emerald-400"
                        : "text-emerald-800"
                    }
                  >
                    ●
                  </span>
                  <span className="text-emerald-400/70">Commitment published</span>
                </div>
                <div className="flex items-center gap-1 text-[9px]">
                  <span
                    className={
                      mp.fairnessStatus.mySeedSubmitted ? "text-emerald-400" : "text-emerald-800"
                    }
                  >
                    ●
                  </span>
                  <span className="text-emerald-400/70">My seed submitted</span>
                </div>
                <div className="flex items-center gap-1 text-[9px]">
                  <span
                    className={
                      mp.fairnessStatus.opponentSeedSubmitted
                        ? "text-emerald-400"
                        : "text-amber-500"
                    }
                  >
                    ●
                  </span>
                  <span className="text-emerald-400/70">
                    {mp.fairnessStatus.opponentSeedSubmitted
                      ? "Opponent seed received"
                      : "Waiting for opponent seed"}
                  </span>
                </div>
                <div className="border-t border-emerald-800/40 pt-1 text-[9px] text-emerald-500/50 mt-1">
                  Round {mp.fairnessStatus.roundNumber} •{" "}
                  {mp.fairnessStatus.activeVersion >= 2
                    ? "Both players contributed entropy"
                    : "Server-only entropy"}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Turn Timer Display */}
          {displayTimer !== null && (
            <div
              className={cn(
                "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-mono font-bold transition-colors",
                displayTimer <= 10
                  ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                  : displayTimer <= 30
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
              )}
            >
              <Clock className={cn("w-3 h-3", displayTimer <= 10 && "animate-pulse")} />
              {Math.floor(displayTimer / 60)}:{(displayTimer % 60).toString().padStart(2, "0")}
            </div>
          )}
          {mp.opponentDisconnected && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
              <WifiOff className="w-2.5 h-2.5 text-amber-400" />
              <span className="text-[9px] text-amber-400">DC</span>
            </div>
          )}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="w-7 h-7 rounded-full bg-emerald-900/40 hover:bg-emerald-800/60 flex items-center justify-center transition-colors"
            title={soundEnabled ? "Mute sounds" : "Enable sounds"}
          >
            {soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5 text-emerald-500/60" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-emerald-700/50" />
            )}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowPrefs(!showPrefs)}
              className="w-7 h-7 rounded-full bg-emerald-900/40 hover:bg-emerald-800/60 flex items-center justify-center transition-colors"
              title="Preferences"
            >
              <Settings className="w-3.5 h-3.5 text-emerald-500/60" />
            </button>
            {showPrefs && (
              <div className="absolute right-0 top-9 w-52 bg-[#0d1a12] border border-emerald-800/50 rounded-xl shadow-xl p-3 space-y-3 z-50">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs text-zinc-300">Show Deadwood Count</span>
                  <input
                    type="checkbox"
                    checked={showDeadwoodCount}
                    onChange={(e) => setShowDeadwoodCount(e.target.checked)}
                    className="accent-emerald-500"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs text-zinc-300">Four-Color Deck</span>
                  <input
                    type="checkbox"
                    checked={fourColorDeck}
                    onChange={(e) => setFourColorDeck(e.target.checked)}
                    className="accent-emerald-500"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs text-zinc-300">Sound Effects</span>
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => setSoundEnabled(e.target.checked)}
                    className="accent-emerald-500"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs text-zinc-300">Enhanced Animations</span>
                  <input
                    type="checkbox"
                    checked={animationsEnabled}
                    onChange={(e) => setAnimationsEnabled(e.target.checked)}
                    className="accent-emerald-500"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="relative z-20 border-b border-emerald-950/40 bg-[#07140f]/78 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-2 px-3 py-2 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-500/18 bg-emerald-500/8 px-3 py-1 text-[11px] font-medium text-emerald-100">
              Room {roomCode}
            </span>
            <span className="rounded-full border border-emerald-500/18 bg-emerald-500/8 px-3 py-1 text-[11px] font-medium text-emerald-100">
              {gs.stakeInfo?.entryFee ? gs.stakeInfo.label : "Practice Table"}
            </span>
            {tableTelemetry.map((item) => (
              <span
                key={item.label}
                className="rounded-full border border-emerald-500/18 bg-emerald-500/8 px-3 py-1 text-[11px] font-medium text-emerald-100"
              >
                <span className="text-emerald-300/70">{item.label}:</span> {item.value}
              </span>
            ))}
            {gs.stakeInfo && gs.stakeInfo.entryFee > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-100">
                <Trophy className="h-3.5 w-3.5 text-amber-300" />
                {gs.stakeInfo.prizePool.toLocaleString()} prize
              </span>
            )}
            {mp.opponentDisconnected && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-100">
                <WifiOff className="h-3.5 w-3.5 text-amber-300" />
                Opponent reconnecting
              </span>
            )}
          </div>

          <div
            className={cn(
              "rounded-2xl border px-3 py-2 text-[11px] font-medium shadow-[0_12px_32px_-24px_rgba(0,0,0,0.85)] lg:max-w-[620px] lg:text-right",
              gs.status === "game_over"
                ? "border-rose-500/16 bg-rose-500/8 text-rose-100"
                : gs.status === "round_over"
                  ? "border-amber-500/18 bg-amber-500/10 text-amber-100"
                  : isMyTurn
                    ? "border-emerald-500/18 bg-emerald-500/10 text-emerald-100"
                    : "border-emerald-500/12 bg-emerald-500/6 text-emerald-100/90",
            )}
          >
            <div className="text-[10px] uppercase tracking-[0.28em] text-emerald-400/45">
              {gs.status === "game_over"
                ? "Post-match"
                : gs.status === "round_over"
                  ? "Round reveal"
                  : isMyTurn
                    ? "On move"
                    : "Reading the table"}
            </div>
            <div className="mt-1">{livePrompt}</div>
            <div className="mt-1 text-zinc-300/72">{gs.message}</div>
          </div>
        </div>
      </div>

      {/* Game Board — Vertical seat composition */}
      <main className="flex-1 relative overflow-hidden flex flex-col">
        <div className={cn("absolute inset-0 pointer-events-none", TABLE_FELT_GRADIENT)} />
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={TABLE_NOISE_STYLE}
        />

        {/* ═══════ ZONE 1: Opponent seat (top-center) — unified identity + cards ═══════ */}
        <div className="relative z-10 flex flex-col items-center pt-3 sm:pt-4 md:pt-4 pb-0.5 sm:pb-1 flex-shrink-0">
          {/* Opponent seat pill — avatar + name/score + hidden cards as one coherent unit */}
          <div className="flex items-center gap-2 sm:gap-3 bg-[#0a2e1e]/40 md:bg-[#0a2e1e]/55 border border-emerald-700/20 md:border-emerald-700/35 rounded-full px-3 sm:px-4 py-1.5 sm:py-2 backdrop-blur-sm shadow-lg shadow-black/10">
            <div
              className={cn(
                "w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9 rounded-full bg-rose-500/20 border-2 flex items-center justify-center text-rose-400 font-bold text-xs sm:text-sm shadow-md transition-colors flex-shrink-0",
                !isMyTurn ? "border-amber-500/60" : "border-rose-500/40",
              )}
            >
              {gs.opponentUsername[0]}
            </div>
            <div className="flex flex-col mr-1">
              <span className="text-xs sm:text-sm font-bold text-zinc-200 leading-none">
                {gs.opponentUsername}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[9px] sm:text-[10px] text-emerald-400/60 uppercase tracking-wider">
                  Score: {gs.opponentScore}
                </span>
                <span className="text-[9px] text-emerald-500/40">
                  • {gs.opponentCardCount} cards
                </span>
              </div>
            </div>
            {/* Opponent Cards (Hidden) — compact overlapping inline */}
            <div className="flex items-center opacity-70">
              <div
                className="relative"
                style={{
                  width: gs.opponentCardCount > 0 ? (gs.opponentCardCount - 1) * 18 + 48 : 0,
                  height: 56,
                }}
              >
                {Array.from({ length: gs.opponentCardCount }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute w-10 h-[56px] rounded-md overflow-hidden shadow-sm"
                    style={{ left: i * 18, zIndex: i }}
                  >
                    <CardBack className="w-full h-full" mini />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ═══════ ZONE 2: Draw area — centered, lifted upper-middle ═══════ */}
        <div className="flex-1 flex flex-col items-center z-10 min-h-0 relative">
          {/* Stock/Discard — positioned in upper portion */}
          <div className="flex flex-col items-center pt-1 sm:pt-2 md:pt-3">
            {/* Turn indicator */}
            <div className="text-center mb-2 md:mb-3">
              <AnimatePresence mode="wait">
                <motion.span
                  key={isMyTurn ? (gs.hasDrawn ? "act" : "draw") : "wait"}
                  initial={shouldAnimate ? MP.TURN_INDICATOR_INITIAL : {}}
                  animate={MP.TURN_INDICATOR_ANIMATE}
                  exit={shouldAnimate ? { opacity: 0, y: 8 } : {}}
                  transition={shouldAnimate ? { duration: 0.25 } : { duration: 0 }}
                  className={cn(
                    "text-xs sm:text-sm font-bold tracking-[0.2em] uppercase inline-block",
                    isMyTurn ? "text-amber-300" : "text-emerald-400/50",
                  )}
                >
                  {isMyTurn
                    ? gs.hasDrawn
                      ? "SELECT & ACT"
                      : "YOUR TURN — DRAW"
                    : `${gs.opponentUsername}'S TURN`}
                </motion.span>
              </AnimatePresence>
            </div>

            {/* Stock & Discard — centered horizontal pair */}
            <div className="flex items-start gap-4 sm:gap-6 md:gap-10">
              {/* Stock */}
              <div
                className="flex flex-col items-center cursor-pointer"
                onClick={() => handleDraw("stock")}
              >
                <span className="text-[10px] sm:text-xs font-semibold text-emerald-200/60 tracking-wide mb-1">
                  Stock
                </span>
                <div className="relative">
                  <div
                    className={cn(
                      "absolute inset-0 blur-xl rounded-full transition-colors",
                      isMyTurn && !gs.hasDrawn ? "bg-amber-500/20" : "bg-transparent",
                    )}
                  />
                  <motion.div
                    animate={
                      shouldAnimate
                        ? {
                            ...(isMyTurn && !gs.hasDrawn ? MP.DRAW_TARGET_PULSE : {}),
                          }
                        : {}
                    }
                    transition={
                      shouldAnimate
                        ? {
                            boxShadow: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                          }
                        : { duration: 0 }
                    }
                    className={cn(
                      "relative w-[64px] h-[90px] sm:w-[72px] sm:h-[100px] md:w-[80px] md:h-[110px] rounded-xl shadow-xl transition-colors overflow-hidden",
                      isMyTurn && !gs.hasDrawn ? "ring-2 ring-amber-400" : "",
                    )}
                  >
                    <CardBack className="w-full h-full" />
                  </motion.div>
                </div>
                <span className="text-[10px] text-emerald-600/40 mt-1">{gs.stockCount}</span>
              </div>

              {/* Swap arrows */}
              <div className="flex items-center self-center mt-7 text-emerald-400/30">
                <span className="text-lg">⇄</span>
              </div>

              {/* Discard */}
              <div
                className="flex flex-col items-center cursor-pointer"
                onClick={() => handleDraw("discard")}
              >
                <span className="text-[10px] sm:text-xs font-semibold text-emerald-200/60 tracking-wide mb-1">
                  Discard
                </span>
                <div className="relative">
                  {gs.topDiscard ? (
                    <motion.div
                      key={`${gs.topDiscard.suit}${gs.topDiscard.rank}`}
                      initial={
                        shouldAnimate && discardAnimating ? MP.DISCARD_PILE_ENTRY_INITIAL : {}
                      }
                      animate={
                        shouldAnimate
                          ? {
                              ...MP.DISCARD_PILE_ENTRY_ANIMATE,
                              ...(isMyTurn && !gs.hasDrawn ? MP.DRAW_TARGET_PULSE : {}),
                            }
                          : MP.DISCARD_PILE_ENTRY_ANIMATE
                      }
                      transition={
                        shouldAnimate
                          ? {
                              ...MP.CARD_SPRING,
                              boxShadow: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                            }
                          : { duration: 0 }
                      }
                      className={cn(
                        "transition-transform",
                        isMyTurn && !gs.hasDrawn ? "hover:-translate-y-2" : "",
                      )}
                    >
                      <PlayingCard
                        suit={gs.topDiscard.suit}
                        rank={gs.topDiscard.rank}
                        fourColor={fourColorDeck}
                        className={cn(
                          "!w-[64px] !h-[90px] sm:!w-[72px] sm:!h-[100px] md:!w-[80px] md:!h-[110px]",
                          isMyTurn && !gs.hasDrawn ? "ring-2 ring-amber-400" : "",
                        )}
                      />
                    </motion.div>
                  ) : (
                    <div className="w-[64px] h-[90px] sm:w-[72px] sm:h-[100px] md:w-[80px] md:h-[110px] rounded-xl border-2 border-dashed border-emerald-800/40 flex items-center justify-center">
                      <span className="text-emerald-700/40 text-[10px]">Empty</span>
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-emerald-600/40 mt-1">
                  {gs.topDiscard ? "Ready" : "Empty"}
                </span>
              </div>
            </div>
          </div>

          {/* Open felt spacer — deliberate breathing room between draw area and player hand */}
          <div className="flex-1 min-h-[24px] sm:min-h-[40px] md:min-h-[64px]" />
        </div>

        {/* ═══════ ZONE 3: Player seat + Hand + Actions (bottom) ═══════ */}
        <div className="relative flex flex-col items-center z-20 pb-3 sm:pb-5 flex-shrink-0">
          {/* Timeout Warning Toast */}
          <AnimatePresence>
            {mp.timeoutWarning && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                {mp.timeoutWarning}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Turn phase indicator */}
          <div className="mb-1">
            {isMyTurn && !gs.hasDrawn && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-[11px] text-amber-400 font-medium"
              >
                Draw a card from Stock or Discard
              </motion.div>
            )}
            {isMyTurn && gs.hasDrawn && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-[11px] text-emerald-400 font-medium"
              >
                Select a card, then Discard or Knock
              </motion.div>
            )}
            {!isMyTurn && (
              <div className="text-[11px] text-emerald-500/50 font-medium">
                Waiting for {gs.opponentUsername}...
              </div>
            )}
          </div>

          {/* Player seat bar — avatar + score + action buttons as one coherent unit */}
          <div className="flex items-center gap-2 sm:gap-3 bg-[#0a2e1e]/40 md:bg-[#0a2e1e]/55 border border-emerald-700/20 md:border-emerald-700/35 rounded-full px-2 sm:px-3 py-1 sm:py-1.5 mb-2 md:mb-2.5 backdrop-blur-sm shadow-lg shadow-black/10">
            {/* Player identity pill */}
            <div
              className={cn(
                "flex items-center gap-1.5 sm:gap-2 rounded-full pl-1 pr-2.5 py-0.5 transition-colors",
                isMyTurn ? "bg-[#0a2e1e]/50" : "",
              )}
            >
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-[10px] sm:text-xs font-bold flex-shrink-0">
                {gs.myUsername[0]}
              </div>
              <span className="text-xs font-bold text-zinc-100">{gs.myScore}</span>
            </div>
            {/* Action buttons */}
            <Button
              variant="primary"
              onClick={handleDiscard}
              className="bg-amber-600 hover:bg-amber-500 shadow-[0_0_20px_-5px_rgba(217,119,6,0.5)] px-5 sm:px-7 text-sm"
              disabled={!isMyTurn || !gs.hasDrawn || selectedCardIndex === null}
            >
              Discard
            </Button>
            <Button
              variant="outline"
              onClick={handleKnock}
              className="bg-zinc-900/80 backdrop-blur border-emerald-700/50 text-emerald-400 hover:bg-emerald-900/30 hover:text-emerald-300 text-sm"
              disabled={!isMyTurn || !gs.hasDrawn || selectedCardIndex === null}
            >
              Knock
            </Button>
            {/* Reset sort button */}
            {isCustomOrder && (
              <button
                onClick={resetToAutoSort}
                className="w-7 h-7 rounded-full bg-emerald-900/40 hover:bg-emerald-800/60 flex items-center justify-center transition-colors"
                title="Reset to auto-sort"
              >
                <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />
              </button>
            )}
          </div>

          {/* Player Hand — overlapping card layout with drag + meld highlights */}
          <div className="w-full overflow-x-auto px-4">
            <div
              className="mx-auto"
              style={{ width: handWidth, position: "relative", height: 114 }}
            >
              {displayHand.map((card, displayIndex) => {
                const meldIdx = getCardMeldIndex(meldHighlights, card as EngineCard);
                const meldColorCls = meldIdx !== undefined ? getMeldColor(meldIdx) : undefined;
                return (
                  <OverlappingCard
                    key={`${card.suit}-${card.rank}`}
                    suit={card.suit}
                    rank={card.rank}
                    selected={selectedCardIndex === card.originalIndex}
                    onClick={() => {
                      if (!dragState.isDragging) {
                        setSelectedCardIndex(
                          selectedCardIndex === card.originalIndex ? null : card.originalIndex,
                        );
                      }
                    }}
                    index={displayIndex}
                    isMyTurn={isMyTurn}
                    hasDrawn={gs.hasDrawn}
                    fourColor={fourColorDeck}
                    meldColorCls={meldColorCls}
                    isDragging={dragState.isDragging && dragState.dragIndex === displayIndex}
                    isDragOver={dragState.isDragging && dragState.dragOverIndex === displayIndex}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onDragStart(displayIndex);
                    }}
                    onPointerEnter={() => {
                      if (dragState.isDragging) onDragOver(displayIndex);
                    }}
                    animationsEnabled={animationsEnabled}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Showdown Overlay (Round Over) ────────────────────── */}
        <AnimatePresence>
          {mp.phase === "round_over" && (
            <motion.div
              initial={MP.SHOWDOWN_OVERLAY_INITIAL}
              animate={MP.SHOWDOWN_OVERLAY_ANIMATE}
              exit={{ opacity: 0 }}
              transition={MP.OVERLAY_TWEEN}
              className="absolute inset-0 z-50 flex items-center justify-center bg-[#030d08]/90 backdrop-blur-sm"
            >
              <motion.div
                initial={shouldAnimate ? MP.SHOWDOWN_PANEL_INITIAL : {}}
                animate={MP.SHOWDOWN_PANEL_ANIMATE}
                transition={shouldAnimate ? { ...MP.EMPHASIS_SPRING, delay: 0.1 } : { duration: 0 }}
                className="bg-[#0d1a12] border border-emerald-800/50 p-6 rounded-2xl text-center max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
                style={
                  mp.showdownData && shouldAnimate
                    ? { boxShadow: MP.getOutcomeBadgeShadow(mp.showdownData.knockOutcome) }
                    : {}
                }
              >
                <motion.h2
                  initial={shouldAnimate ? { opacity: 0, y: -10 } : {}}
                  animate={{ opacity: 1, y: 0 }}
                  transition={shouldAnimate ? { delay: 0.15 } : { duration: 0 }}
                  className="text-2xl font-bold text-zinc-100 mb-1"
                >
                  Round Over
                </motion.h2>
                {mp.showdownData && (
                  <>
                    <motion.div
                      initial={shouldAnimate ? MP.OUTCOME_BADGE_INITIAL : {}}
                      animate={MP.OUTCOME_BADGE_ANIMATE}
                      transition={
                        shouldAnimate ? { ...MP.EMPHASIS_SPRING, delay: 0.25 } : { duration: 0 }
                      }
                      className={cn(
                        "inline-flex px-3 py-1 rounded-full text-xs font-bold mb-3",
                        mp.showdownData.knockOutcome === "gin"
                          ? "bg-amber-500/20 text-amber-400"
                          : mp.showdownData.knockOutcome === "undercut"
                            ? "bg-rose-500/20 text-rose-400"
                            : "bg-emerald-500/20 text-emerald-400",
                      )}
                    >
                      {mp.showdownData.knockOutcome === "gin"
                        ? "🔥 GIN"
                        : mp.showdownData.knockOutcome === "undercut"
                          ? "⚡ UNDERCUT"
                          : "👊 KNOCK"}
                      {" — "}
                      {mp.showdownData.roundWinnerUsername} wins {mp.showdownData.roundPoints} pts
                    </motion.div>

                    <div className="space-y-4 mt-4 text-left">
                      {/* Knocker */}
                      <ShowdownPlayerSection
                        data={mp.showdownData.knocker}
                        isKnocker={true}
                        knockOutcome={mp.showdownData.knockOutcome}
                        fourColor={fourColorDeck}
                        showDeadwoodCount={showDeadwoodCount}
                      />
                      <div className="border-t border-emerald-800/40" />
                      {/* Opponent */}
                      <ShowdownPlayerSection
                        data={mp.showdownData.opponent}
                        isKnocker={false}
                        knockOutcome={mp.showdownData.knockOutcome}
                        fourColor={fourColorDeck}
                        showDeadwoodCount={showDeadwoodCount}
                      />
                    </div>
                  </>
                )}
                {!mp.showdownData && <p className="text-zinc-400 mb-4">{gs.message}</p>}
                <motion.div
                  initial={shouldAnimate ? { opacity: 0, y: 10 } : {}}
                  animate={{ opacity: 1, y: 0 }}
                  transition={shouldAnimate ? { delay: 0.8 } : { duration: 0 }}
                >
                  <Button variant="primary" onClick={mp.nextRound} className="w-full mt-4">
                    Next Round
                  </Button>
                </motion.div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Game Over Overlay ────────────────────────────────── */}
        <AnimatePresence>
          {mp.phase === "game_over" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-[#030d08]/90 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-[#0d1a12] border border-emerald-800/50 p-6 rounded-2xl text-center max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
              >
                <h2
                  className={cn(
                    "text-3xl font-bold mb-1",
                    gs.winnerId ? "text-amber-500" : "text-rose-500",
                  )}
                >
                  Game Over
                </h2>
                <p className="text-zinc-300 mb-2">{gs.message}</p>

                {mp.showdownData &&
                  mp.showdownData.knocker.melds.length + mp.showdownData.knocker.deadwood.length >
                    0 && (
                    <>
                      <div
                        className={cn(
                          "inline-flex px-3 py-1 rounded-full text-xs font-bold mb-3",
                          mp.showdownData.knockOutcome === "gin"
                            ? "bg-amber-500/20 text-amber-400"
                            : mp.showdownData.knockOutcome === "undercut"
                              ? "bg-rose-500/20 text-rose-400"
                              : "bg-emerald-500/20 text-emerald-400",
                        )}
                      >
                        {mp.showdownData.knockOutcome === "gin"
                          ? "🔥 GIN"
                          : mp.showdownData.knockOutcome === "undercut"
                            ? "⚡ UNDERCUT"
                            : "👊 KNOCK"}
                      </div>
                      <div className="space-y-4 mt-3 text-left">
                        <ShowdownPlayerSection
                          data={mp.showdownData.knocker}
                          isKnocker={true}
                          knockOutcome={mp.showdownData.knockOutcome}
                          fourColor={fourColorDeck}
                          showDeadwoodCount={showDeadwoodCount}
                        />
                        <div className="border-t border-emerald-800/40" />
                        <ShowdownPlayerSection
                          data={mp.showdownData.opponent}
                          isKnocker={false}
                          knockOutcome={mp.showdownData.knockOutcome}
                          fourColor={fourColorDeck}
                          showDeadwoodCount={showDeadwoodCount}
                        />
                      </div>
                    </>
                  )}

                <div className="flex justify-center gap-8 my-4 text-sm">
                  <div>
                    <div className="text-zinc-500">You</div>
                    <div className="text-2xl font-bold font-mono text-white">{gs.myScore}</div>
                  </div>
                  <div className="border-l border-emerald-800/40" />
                  <div>
                    <div className="text-zinc-500">{gs.opponentUsername}</div>
                    <div className="text-2xl font-bold font-mono text-white">
                      {gs.opponentScore}
                    </div>
                  </div>
                </div>

                {/* In-Game Rematch Button */}
                <RematchButton
                  opponentUsername={gs.opponentUsername}
                  stakeId={gs.stakeInfo?.stakeId || "free"}
                  stakeLabel={gs.stakeInfo?.label}
                />

                <div className="flex gap-3 mt-3">
                  <Link to="/" className="flex-1">
                    <Button
                      variant="outline"
                      className="w-full border-emerald-700/50 text-emerald-400"
                    >
                      Dashboard
                    </Button>
                  </Link>
                  <Button variant="primary" onClick={mp.leaveRoom} className="flex-1">
                    New Match
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ── In-Game Rematch Button Component ──────────────────────────────────

function RematchButton({
  opponentUsername,
  stakeId,
  stakeLabel,
}: {
  opponentUsername: string;
  stakeId: string;
  stakeLabel?: string;
}) {
  const [rematchState, setRematchState] = React.useState<
    "idle" | "sending" | "sent" | "error" | "accepted"
  >("idle");
  const [rematchRoomId, setRematchRoomId] = React.useState<string | null>(null);
  const [rematchError, setRematchError] = React.useState<string | null>(null);
  const { sessionId } = useAuthStore();

  const handleRematch = async () => {
    if (!sessionId || rematchState !== "idle") return;
    setRematchState("sending");
    setRematchError(null);

    try {
      // First, look up opponent's userId by username
      const profileRes = await fetch(`/api/profile/${encodeURIComponent(opponentUsername)}`, {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      if (!profileRes.ok) {
        throw new Error("Could not find opponent");
      }
      const profileData = await profileRes.json();
      const opponentId = profileData.profile?.userId || profileData.profile?.id;
      if (!opponentId) throw new Error("Could not resolve opponent ID");

      // Propose rematch
      const res = await fetch("/api/social/rematch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionId}`,
        },
        body: JSON.stringify({
          opponentId,
          stakeId: stakeId || "free",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to propose rematch");
      }

      setRematchState("sent");

      // Poll for acceptance (check every 3s, 5 times max)
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        if (attempts > 10) {
          clearInterval(pollInterval);
          return;
        }
        try {
          const checkRes = await fetch(`/api/social/rematch/${data.rematch.id}`, {
            headers: { Authorization: `Bearer ${sessionId}` },
          });
          const checkData = await checkRes.json();
          if (checkData.rematch?.status === "accepted" && checkData.rematch?.roomId) {
            setRematchState("accepted");
            setRematchRoomId(checkData.rematch.roomId);
            clearInterval(pollInterval);
          } else if (checkData.rematch?.status === "declined") {
            setRematchError("Opponent declined the rematch");
            setRematchState("error");
            clearInterval(pollInterval);
          }
        } catch {
          // Ignore poll errors
        }
      }, 3000);
    } catch (err: any) {
      setRematchError(err.message || "Failed to propose rematch");
      setRematchState("error");
    }
  };

  if (rematchState === "accepted" && rematchRoomId) {
    return (
      <Link to={`/multiplayer?challengeRoom=${rematchRoomId}&stakeId=${stakeId}`}>
        <Button
          variant="primary"
          className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-[0_0_30px_-8px_rgba(16,185,129,0.5)]"
          id="join-rematch-btn"
        >
          <Zap className="mr-2 h-4 w-4" /> Join Rematch Room
        </Button>
      </Link>
    );
  }

  return (
    <div className="w-full">
      <Button
        variant="outline"
        onClick={handleRematch}
        disabled={rematchState === "sending" || rematchState === "sent"}
        className={cn(
          "w-full border-emerald-700/50 text-emerald-400 hover:bg-emerald-900/30 hover:text-emerald-300 transition-all",
          rematchState === "sent" && "border-emerald-700/50 text-emerald-400",
        )}
        id="rematch-btn"
      >
        {rematchState === "sending" && (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Proposing Rematch...
          </>
        )}
        {rematchState === "idle" && (
          <>
            <RotateCcw className="mr-2 h-4 w-4" /> Rematch{" "}
            {stakeLabel && stakeId !== "free" ? `(${stakeLabel})` : ""}
          </>
        )}
        {rematchState === "sent" && (
          <>
            <Check className="mr-2 h-4 w-4" /> Rematch Sent — Waiting for {opponentUsername}
          </>
        )}
        {rematchState === "error" && (
          <>
            <AlertTriangle className="mr-2 h-4 w-4" /> {rematchError || "Rematch failed"}
          </>
        )}
      </Button>
      {rematchState === "error" && (
        <button
          onClick={() => {
            setRematchState("idle");
            setRematchError(null);
          }}
          className="text-xs text-zinc-500 hover:text-zinc-300 mt-1 underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}
