import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Settings, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Button } from "@/src/components/ui/Button";
import { motion, AnimatePresence } from "motion/react";
import type { GameState, Card as EngineCard } from "@/src/lib/engine";
import {
  createGame,
  drawCard,
  discardCard,
  knock,
  nextRound,
  evaluateHand,
  evaluateAndLayOff,
} from "@/src/lib/engine";
import { useAuthStore } from "@/src/lib/store";
import { decideDrawSource, decideDiscard, shouldKnock, ApexSession } from "@/src/lib/ai";
import {
  expertDecideDraw,
  expertDecideDiscard,
  expertDecideKnock,
  logDrawDisagreement,
} from "@/src/lib/apexServiceClient";
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
import {
  PlayingCard,
  CardBack,
  SuitRowCard,
  ShowdownCardMini,
} from "@/src/components/cards";
import * as MP from "@/src/lib/motionPresets";

// ── Sort helpers ─────────────────────────────────────────────────────
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

// ── Showdown state for single-player ─────────────────────────────────

interface LocalShowdown {
  knockOutcome: "knock" | "gin" | "undercut";
  knockerName: string;
  opponentName: string;
  winnerName: string;
  points: number;
  knockerMelds: EngineCard[][];
  knockerDeadwood: EngineCard[];
  knockerDW: number;
  opponentMelds: EngineCard[][];
  opponentDeadwood: EngineCard[];
  opponentDW: number;
  laidOffCards: EngineCard[];
}

type DrawSource = "stock" | "discard";

interface OpponentDrawNotice {
  source: DrawSource;
  card: EngineCard | null;
  id: number;
}

export function GameRoom() {
  const { user } = useAuthStore();
  const {
    showDeadwoodCount,
    fourColorDeck,
    soundEnabled,
    animationsEnabled,
    aiTier,
    setShowDeadwoodCount,
    setFourColorDeck,
    setSoundEnabled,
    setAnimationsEnabled,
    setAiTier,
  } = usePreferences();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);
  const botDrewFromDiscard = useRef(false);
  /** Sprint-1 Apex brain: opponent model + last-discard cycle prevention. */
  const apexSession = useRef(new ApexSession());
  const [showdown, setShowdown] = useState<LocalShowdown | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

  // Animation state flags
  const [dealAnimating, setDealAnimating] = useState(false);
  const [drawAnimating, setDrawAnimating] = useState<"stock" | "discard" | null>(null);
  const [discardAnimating, setDiscardAnimating] = useState(false);
  const [knockAnimating, setKnockAnimating] = useState(false);
  const [tablePulseSource, setTablePulseSource] = useState<DrawSource | null>(null);
  const [opponentDrawNotice, setOpponentDrawNotice] = useState<OpponentDrawNotice | null>(null);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 1080,
  );
  const opponentDrawNoticeTimer = useRef<number | null>(null);

  const reducedMotion = prefersReducedMotion();
  const shouldAnimate = animationsEnabled && !reducedMotion;

  // Sound helper
  const playSound = useCallback(
    (fn: () => void) => {
      if (soundEnabled) fn();
    },
    [soundEnabled],
  );

  const announceOpponentDraw = useCallback((source: DrawSource, card: EngineCard | null) => {
    setTablePulseSource(source);
    setOpponentDrawNotice({ source, card, id: Date.now() });

    window.setTimeout(() => {
      setTablePulseSource((current) => (current === source ? null : current));
    }, 650);

    if (opponentDrawNoticeTimer.current) {
      window.clearTimeout(opponentDrawNoticeTimer.current);
    }

    opponentDrawNoticeTimer.current = window.setTimeout(() => {
      setOpponentDrawNotice(null);
      opponentDrawNoticeTimer.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    if (user) {
      const fresh = createGame({ id: user.id, name: user.username }, { id: "bot", name: "Apex" });
      const bot = fresh.players.find((p) => p.id === "bot");
      if (bot) apexSession.current.beginHand(bot.hand, fresh.discard);
      setGameState(fresh);
      setShowdown(null);
      // Deal animation
      if (shouldAnimate) {
        setDealAnimating(true);
        setTimeout(() => setDealAnimating(false), 500);
      }
      playSound(playDealSound);
    }
  }, [playSound, shouldAnimate, user]);

  // Drag-and-drop hand management
  const myHand = useMemo(
    () => gameState
      ? (gameState.players[gameState.players.findIndex((p) => p.id === user?.id)]?.hand ?? [])
      : [],
    [gameState, user?.id],
  );
  const {
    dragState,
    onDragEnd,
  } = useHandDrag(myHand);

  // Meld highlighting
  const meldHighlights = useMemo<MeldHighlightMap>(() => {
    return computeMeldHighlights(myHand as EngineCard[]);
  }, [myHand]);

  // Global pointer up for drag end
  useEffect(() => {
    const handler = () => {
      if (dragState.isDragging) onDragEnd();
    };
    window.addEventListener("pointerup", handler);
    return () => window.removeEventListener("pointerup", handler);
  }, [dragState.isDragging, onDragEnd]);

  useEffect(() => {
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    return () => {
      if (opponentDrawNoticeTimer.current) {
        window.clearTimeout(opponentDrawNoticeTimer.current);
      }
    };
  }, []);

  // Apex AI — Club (local TS) or Expert (ApexMCTS service + Club fallback)
  useEffect(() => {
    if (!gameState || gameState.status !== "playing") return;

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (currentPlayer.id !== "bot") return;

    // Research Apex uses 0-based turns; engine turnNumber is 1-based.
    const turn0 = Math.max(0, (gameState.turnNumber ?? 1) - 1);
    const stockRemaining = gameState.stock.length;
    let cancelled = false;

    if (currentPlayer.hand.length === 10) {
      const timer = setTimeout(async () => {
        const topDiscard = gameState.discard[gameState.discard.length - 1];
        const opponent = gameState.players.find((p) => p.id !== "bot");
        const myScore = currentPlayer.score;
        const oppScore = opponent?.score ?? 0;
        const ctx = apexSession.current.context(currentPlayer.hand, gameState.discard, {
          turn: turn0,
          stockRemaining,
          myScore,
          oppScore,
          targetScore: 100,
        });

        let source = decideDrawSource(
          currentPlayer.hand,
          topDiscard,
          gameState.discard,
          ctx
        );

        if (aiTier === "expert") {
          const expert = await expertDecideDraw({
            hand: currentPlayer.hand,
            topDiscard,
            discardPile: gameState.discard,
            turn: turn0,
            stockRemaining,
            myScore,
            oppScore,
          });
          if (!cancelled && expert) {
            if (expert.disagreement) {
              logDrawDisagreement({
                phase: "draw",
                clubSource: source,
                expertSource: expert.source,
                overridden: expert.overridden,
                takeEv: expert.takeEv,
                stockEv: expert.stockEv,
                turn: turn0,
                stockRemaining,
              });
            }
            source = expert.source;
          }
        }

        if (cancelled) return;
        botDrewFromDiscard.current = source === "discard";
        announceOpponentDraw(source, source === "discard" ? topDiscard : null);
        playSound(playDrawSound);
        setGameState((prev) => (prev ? drawCard(prev, "bot", source) : prev));
      }, 600);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    if (currentPlayer.hand.length === 11) {
      const timer = setTimeout(async () => {
        const opponent = gameState.players.find((p) => p.id !== "bot")!;
        const myScore = currentPlayer.score;
        const oppScore = opponent ? opponent.score : 0;
        const targetScore = 100;

        const drawnCard = currentPlayer.hand[currentPlayer.hand.length - 1];
        const ctx = apexSession.current.context(currentPlayer.hand, gameState.discard, {
          turn: turn0,
          stockRemaining,
          myScore,
          oppScore,
          targetScore,
        });

        let discardIdx = decideDiscard(
          currentPlayer.hand,
          botDrewFromDiscard.current,
          drawnCard,
          gameState.discard,
          myScore,
          oppScore,
          targetScore,
          ctx
        );

        if (aiTier === "expert") {
          const expertDiscard = await expertDecideDiscard({
            hand: currentPlayer.hand,
            drewFromDiscard: botDrewFromDiscard.current,
            drawnCard,
            discardPile: gameState.discard,
            turn: turn0,
            stockRemaining,
            myScore,
            oppScore,
          });
          if (!cancelled && expertDiscard) {
            discardIdx = expertDiscard.discardIndex;
          }
        }

        if (cancelled) return;

        const discardedCard = currentPlayer.hand[discardIdx];
        apexSession.current.noteMyDiscard(discardedCard);

        const handAfter = [
          ...currentPlayer.hand.slice(0, discardIdx),
          ...currentPlayer.hand.slice(discardIdx + 1),
        ];

        let doKnock = shouldKnock(handAfter, myScore, oppScore, targetScore, ctx);
        if (aiTier === "expert") {
          const expertKnock = await expertDecideKnock({
            hand: handAfter,
            discardPile: gameState.discard,
            turn: turn0,
            stockRemaining,
            myScore,
            oppScore,
          });
          if (!cancelled && expertKnock) {
            doKnock = expertKnock.knock;
          }
        }

        if (cancelled) return;

        if (doKnock) {
          const knockerEval = evaluateHand(handAfter);
          let opponentEval;
          let laidOff: EngineCard[] = [];
          let knockOutcome: "knock" | "gin" | "undercut";

          if (knockerEval.deadwoodValue === 0) {
            opponentEval = evaluateHand(opponent.hand);
          } else {
            opponentEval = evaluateAndLayOff(opponent.hand, knockerEval.melds);
            const inMeldsSet = new Set<string>();
            for (const m of opponentEval.melds)
              for (const c of m) inMeldsSet.add(`${c.rank}${c.suit}`);
            const inDWSet = new Set<string>();
            for (const c of opponentEval.deadwood) inDWSet.add(`${c.rank}${c.suit}`);
            laidOff = opponent.hand.filter((c) => {
              const key = `${c.rank}${c.suit}`;
              return !inMeldsSet.has(key) && !inDWSet.has(key);
            });
          }

          if (knockerEval.deadwoodValue === 0) knockOutcome = "gin";
          else if (opponentEval.deadwoodValue <= knockerEval.deadwoodValue)
            knockOutcome = "undercut";
          else knockOutcome = "knock";

          const winnerName = knockOutcome === "undercut" ? opponent.name : currentPlayer.name;
          let points = 0;
          if (knockOutcome === "gin") points = opponentEval.deadwoodValue + 25;
          else if (knockOutcome === "undercut")
            points = knockerEval.deadwoodValue - opponentEval.deadwoodValue + 25;
          else points = opponentEval.deadwoodValue - knockerEval.deadwoodValue;

          setShowdown({
            knockOutcome,
            knockerName: currentPlayer.name,
            opponentName: opponent.name,
            winnerName,
            points,
            knockerMelds: knockerEval.melds,
            knockerDeadwood: knockerEval.deadwood,
            knockerDW: knockerEval.deadwoodValue,
            opponentMelds: opponentEval.melds,
            opponentDeadwood: opponentEval.deadwood,
            opponentDW: opponentEval.deadwoodValue,
            laidOffCards: laidOff,
          });
          playSound(playKnockSound);
          if (shouldAnimate) setKnockAnimating(true);
          setTimeout(() => setKnockAnimating(false), 400);
          setGameState((prev) => (prev ? knock(prev, "bot", discardIdx) : prev));
        } else {
          playSound(playDiscardSound);
          setGameState((prev) => (prev ? discardCard(prev, "bot", discardIdx) : prev));
        }
      }, 800);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
  }, [aiTier, announceOpponentDraw, gameState, playSound, shouldAnimate]);

  // Save match result when game is over
  useEffect(() => {
    if (gameState?.status === "game_over" && user) {
      const myPlayer = gameState.players.find((p) => p.id === user.id);
      const opponent = gameState.players.find((p) => p.id !== user.id);

      if (myPlayer && opponent) {
        const isWin = myPlayer.score >= 100;
        playSound(() => playResultSound(isWin));
        fetch("/api/matches", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${useAuthStore.getState().sessionId}`,
          },
          body: JSON.stringify({
            opponent_name: opponent.name,
            user_score: myPlayer.score,
            opponent_score: opponent.score,
            is_win: isWin,
          }),
        }).catch(console.error);
      }
    }
  }, [gameState?.players, gameState?.status, playSound, user]);

  // ── 4-row suit grouping (always auto-sorted A→K per suit) ──
  // Must be above early return to maintain React hook call order
  const suitRows = useMemo(() => {
    const groups: Record<string, Array<{ suit: string; rank: string; originalIndex: number }>> = {
      "♣": [],
      "♦": [],
      "♥": [],
      "♠": [],
    };
    myHand.forEach((card, i) => {
      if (groups[card.suit])
        groups[card.suit].push({ suit: card.suit, rank: card.rank, originalIndex: i });
    });
    for (const suit of Object.keys(groups)) {
      groups[suit].sort((a, b) => (RANK_ORDER[a.rank] ?? 0) - (RANK_ORDER[b.rank] ?? 0));
    }
    return groups;
  }, [myHand]);

  // ── Proper deadwood counter ──
  // Must be above early return to maintain React hook call order
  const currentDeadwood = useMemo(() => {
    if (myHand.length === 0) return 0;
    const hand = myHand as EngineCard[];
    if (hand.length <= 10) {
      return evaluateHand(hand).deadwoodValue;
    }
    // 11 cards with a selected card: show post-discard deadwood
    if (selectedCardIndex !== null && selectedCardIndex < hand.length) {
      const handAfter = hand.filter((_, i) => i !== selectedCardIndex);
      return evaluateHand(handAfter).deadwoodValue;
    }
    // 11 cards, no selection: show best achievable deadwood
    let minDW = Infinity;
    for (let i = 0; i < hand.length; i++) {
      const handAfter = hand.filter((_, j) => j !== i);
      minDW = Math.min(minDW, evaluateHand(handAfter).deadwoodValue);
    }
    return minDW === Infinity ? 0 : minDW;
  }, [myHand, selectedCardIndex]);

  if (!gameState || !user)
    return (
      <div className="min-h-screen bg-[#0a1f15] flex items-center justify-center text-emerald-400/60">
        Loading game...
      </div>
    );

  const myPlayerIndex = gameState.players.findIndex((p) => p.id === user.id);
  const opponentIndex = myPlayerIndex === 0 ? 1 : 0;
  const myPlayer = gameState.players[myPlayerIndex];
  const opponent = gameState.players[opponentIndex];
  const isMyTurn = gameState.currentPlayerIndex === myPlayerIndex;
  const hasDrawn = myPlayer.hand.length > 10;

  const handleDraw = (source: "stock" | "discard") => {
    if (!isMyTurn || myPlayer.hand.length > 10) return;
    playSound(playDrawSound);
    if (shouldAnimate) {
      setDrawAnimating(source);
      setTimeout(() => setDrawAnimating(null), 400);
    }
    const topDiscard = gameState.discard[gameState.discard.length - 1] ?? null;
    if (source === "discard" && topDiscard) {
      apexSession.current.onHumanDrewDiscard(topDiscard);
    } else {
      apexSession.current.onHumanDrewStock(topDiscard);
    }
    setGameState(drawCard(gameState, user.id, source));
  };

  const handleDiscard = () => {
    if (!isMyTurn || myPlayer.hand.length <= 10 || selectedCardIndex === null) return;
    playSound(playDiscardSound);
    if (shouldAnimate) {
      setDiscardAnimating(true);
      setTimeout(() => setDiscardAnimating(false), 400);
    }
    const discarded = myPlayer.hand[selectedCardIndex];
    if (discarded) apexSession.current.onHumanDiscard(discarded);
    setGameState(discardCard(gameState, user.id, selectedCardIndex));
    setSelectedCardIndex(null);
  };

  const handleKnock = () => {
    if (!isMyTurn || myPlayer.hand.length <= 10 || selectedCardIndex === null) return;

    // Compute showdown before knock
    const handAfter = [...myPlayer.hand];
    handAfter.splice(selectedCardIndex, 1);
    const knockerEval = evaluateHand(handAfter);
    if (knockerEval.deadwoodValue <= 10) {
      let opponentEval;
      let laidOff: EngineCard[] = [];
      let knockOutcome: "knock" | "gin" | "undercut";

      if (knockerEval.deadwoodValue === 0) {
        opponentEval = evaluateHand(opponent.hand);
      } else {
        opponentEval = evaluateAndLayOff(opponent.hand, knockerEval.melds);
        const inMeldsSet = new Set<string>();
        for (const m of opponentEval.melds) for (const c of m) inMeldsSet.add(`${c.rank}${c.suit}`);
        const inDWSet = new Set<string>();
        for (const c of opponentEval.deadwood) inDWSet.add(`${c.rank}${c.suit}`);
        laidOff = opponent.hand.filter((c) => {
          const key = `${c.rank}${c.suit}`;
          return !inMeldsSet.has(key) && !inDWSet.has(key);
        });
      }

      if (knockerEval.deadwoodValue === 0) knockOutcome = "gin";
      else if (opponentEval.deadwoodValue <= knockerEval.deadwoodValue) knockOutcome = "undercut";
      else knockOutcome = "knock";

      const winnerName = knockOutcome === "undercut" ? opponent.name : myPlayer.name;
      let points = 0;
      if (knockOutcome === "gin") points = opponentEval.deadwoodValue + 25;
      else if (knockOutcome === "undercut")
        points = knockerEval.deadwoodValue - opponentEval.deadwoodValue + 25;
      else points = opponentEval.deadwoodValue - knockerEval.deadwoodValue;

      setShowdown({
        knockOutcome,
        knockerName: myPlayer.name,
        opponentName: opponent.name,
        winnerName,
        points,
        knockerMelds: knockerEval.melds,
        knockerDeadwood: knockerEval.deadwood,
        knockerDW: knockerEval.deadwoodValue,
        opponentMelds: opponentEval.melds,
        opponentDeadwood: opponentEval.deadwood,
        opponentDW: opponentEval.deadwoodValue,
        laidOffCards: laidOff,
      });
    }

    playSound(playKnockSound);
    if (shouldAnimate) {
      setKnockAnimating(true);
      setTimeout(() => setKnockAnimating(false), MP.KNOCK_FLASH_DURATION * 1000);
    }
    const discarded = myPlayer.hand[selectedCardIndex];
    if (discarded) apexSession.current.onHumanDiscard(discarded);
    setGameState(knock(gameState, user.id, selectedCardIndex));
    setSelectedCardIndex(null);
  };

  const handleNextRound = () => {
    setShowdown(null);
    setTablePulseSource(null);
    setOpponentDrawNotice(null);
    const next = nextRound(gameState);
    const bot = next.players.find((p) => p.id === "bot");
    if (bot) apexSession.current.beginHand(bot.hand, next.discard);
    setGameState(next);
    playSound(playDealSound);
    if (shouldAnimate) {
      setDealAnimating(true);
      setTimeout(() => setDealAnimating(false), 600);
    }
  };

  const topDiscard = gameState.discard[gameState.discard.length - 1];
  const tableTelemetry = [
    { label: "Turn", value: gameState.turnNumber ?? 1 },
    { label: "Cards Remaining", value: gameState.stock.length },
  ];
  const tableScale =
    viewportHeight < 780 ? 0.64 : viewportHeight < 900 ? 0.72 : viewportHeight < 1080 ? 0.84 : 1;
  const tableContentStyle =
    tableScale === 1
      ? undefined
      : {
          transform: `translateX(-50%) scale(${tableScale})`,
          transformOrigin: "top center",
          left: "50%",
          width: `${100 / tableScale}%`,
          height: `${100 / tableScale}%`,
        };

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden font-sans">
      {/* Tropical paradise background image */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "url(/assets/tropical-bg.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "brightness(0.7) saturate(1.1)",
        }}
      />
      {/* Layered dark overlay — richer depth */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 65% 50% at 50% 50%, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Game Board — Table with integrated header on wood trim */}
      <main className="relative z-10 flex flex-1 items-start justify-center overflow-x-hidden p-3 sm:p-5">
        {/* Outer bevel / rich walnut wood trim frame with integrated title */}
        <div
          className="relative flex min-h-full w-full max-w-[1050px] flex-col overflow-hidden rounded-[16px] sm:rounded-[24px]"
          style={{
            background:
              "linear-gradient(180deg, #d4b896 0%, #c4a47a 8%, #b89260 16%, #a67e4c 28%, #8c6638 45%, #7a5a30 55%, #8c6638 65%, #a67e4c 78%, #b89260 88%, #c4a47a 95%, #d4b896 100%)",
            padding: "9px 9px 11px 9px",
            boxShadow:
              "0 12px 48px rgba(0,0,0,0.6), 0 3px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -2px 0 rgba(0,0,0,0.3)",
          }}
        >
          {/* Title + controls on the wood trim — sits on top edge like reference */}
          <div className="flex items-center justify-between px-3 sm:px-5 -mt-0.5 mb-1.5 relative z-30">
            <Link to="/" className="text-emerald-900/60 hover:text-emerald-900 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1
              className="text-xl sm:text-2xl font-bold tracking-[0.18em] text-emerald-950"
              style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                textShadow: "0 1px 0 rgba(255,255,255,0.3)",
              }}
            >
              GIN PARADISE
            </h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="flex flex-col items-center gap-0.5 text-emerald-900/60 hover:text-emerald-900 transition-colors"
                title={soundEnabled ? "Mute sounds" : "Enable sounds"}
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <span className="text-[7px] tracking-wide font-semibold">Sound</span>
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowPrefs(!showPrefs)}
                  className="flex flex-col items-center gap-0.5 text-emerald-900/60 hover:text-emerald-900 transition-colors"
                  title="Settings"
                >
                  <Settings className="w-4 h-4" />
                  <span className="text-[7px] tracking-wide font-semibold">Settings</span>
                </button>
                {showPrefs && (
                  <div className="absolute right-0 top-10 w-52 bg-[#0d2b1c]/95 border border-emerald-700/50 rounded-xl shadow-2xl p-3 space-y-3 z-50 backdrop-blur-md">
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-xs text-emerald-200/80">Show Deadwood Count</span>
                      <input
                        type="checkbox"
                        checked={showDeadwoodCount}
                        onChange={(e) => setShowDeadwoodCount(e.target.checked)}
                        className="accent-amber-500"
                      />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-xs text-emerald-200/80">Four-Color Deck</span>
                      <input
                        type="checkbox"
                        checked={fourColorDeck}
                        onChange={(e) => setFourColorDeck(e.target.checked)}
                        className="accent-amber-500"
                      />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-xs text-emerald-200/80">Sound Effects</span>
                      <input
                        type="checkbox"
                        checked={soundEnabled}
                        onChange={(e) => setSoundEnabled(e.target.checked)}
                        className="accent-amber-500"
                      />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-xs text-emerald-200/80">Enhanced Animations</span>
                      <input
                        type="checkbox"
                        checked={animationsEnabled}
                        onChange={(e) => setAnimationsEnabled(e.target.checked)}
                        className="accent-amber-500"
                      />
                    </label>
                    <div className="pt-1 border-t border-emerald-700/40">
                      <div className="text-[10px] uppercase tracking-wider text-emerald-400/60 mb-1.5">
                        Apex AI Tier
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setAiTier("club")}
                          className={cn(
                            "flex-1 text-[10px] font-semibold rounded-md py-1 border transition-colors",
                            aiTier === "club"
                              ? "bg-amber-500/20 border-amber-500/50 text-amber-200"
                              : "border-emerald-700/40 text-emerald-200/70 hover:border-emerald-500/40"
                          )}
                        >
                          Club
                        </button>
                        <button
                          type="button"
                          onClick={() => setAiTier("expert")}
                          className={cn(
                            "flex-1 text-[10px] font-semibold rounded-md py-1 border transition-colors",
                            aiTier === "expert"
                              ? "bg-amber-500/20 border-amber-500/50 text-amber-200"
                              : "border-emerald-700/40 text-emerald-200/70 hover:border-emerald-500/40"
                          )}
                        >
                          Expert
                        </button>
                      </div>
                      <p className="text-[9px] text-emerald-400/45 mt-1 leading-snug">
                        Expert uses ApexMCTS draw search when available; otherwise falls back to Club.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="mb-2 flex justify-center px-3 sm:px-5 relative z-30">
            <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-amber-950/15 bg-[#f6e7be]/45 px-2 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] backdrop-blur-sm">
              {tableTelemetry.map((item) => (
                <div
                  key={item.label}
                  className="min-w-[118px] rounded-full border border-emerald-950/10 bg-[#fff7dd]/60 px-3 py-1 text-center"
                >
                  <div className="text-[9px] font-semibold uppercase tracking-[0.24em] text-emerald-950/55">
                    {item.label}
                  </div>
                  <div className="text-sm font-semibold text-emerald-950">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Inner dark border before felt */}
          <div
            className="relative min-h-0 w-full flex-1 overflow-hidden rounded-[10px] sm:rounded-[16px]"
            style={{
              boxShadow: "inset 0 2px 8px rgba(0,0,0,0.5), 0 -1px 0 rgba(255,255,255,0.15)",
            }}
          >
            {/* Inner felt surface — deep premium green with ambient lighting */}
            <div
              className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[10px] sm:rounded-[16px]"
              style={{
                background:
                  "radial-gradient(ellipse 90% 85% at 50% 48%, #1f7a5a 0%, #1a6e4e 20%, #156344 40%, #10573a 60%, #0d4c32 80%, #0a4028 100%)",
              }}
            >
              {/* Felt cloth texture — richer weave */}
              <div
                className="absolute inset-0 opacity-[0.06] pointer-events-none"
                style={{
                  backgroundImage:
                    'url("data:image/svg+xml,%3Csvg viewBox=%270 0 256 256%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.75%27 numOctaves=%274%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")',
                  backgroundSize: "160px 160px",
                }}
              />
              {/* Ambient spotlight vignette on felt */}
              <div
                className="absolute inset-0 pointer-events-none rounded-[10px] sm:rounded-[16px]"
                style={{
                  background:
                    "radial-gradient(ellipse 70% 60% at 50% 50%, transparent 30%, rgba(0,0,0,0.15) 70%, rgba(0,0,0,0.25) 100%)",
                }}
              />
              {/* Inner bevel highlight — depth on the felt edge */}
              <div
                className="absolute inset-0 rounded-[10px] sm:rounded-[16px] pointer-events-none z-20"
                style={{
                  boxShadow:
                    "inset 0 3px 8px rgba(255,255,255,0.04), inset 0 -4px 12px rgba(0,0,0,0.35), inset 5px 0 8px rgba(0,0,0,0.08), inset -5px 0 8px rgba(0,0,0,0.08)",
                }}
              />

              {/* Knock / outcome emphasis flash */}
              <AnimatePresence>
                {knockAnimating && shouldAnimate && (
                  <motion.div
                    initial={MP.KNOCK_FLASH_INITIAL}
                    animate={MP.KNOCK_FLASH_ANIMATE}
                    exit={{ opacity: 0 }}
                    transition={{ duration: MP.KNOCK_FLASH_DURATION }}
                    className="absolute inset-0 z-30 pointer-events-none"
                    style={{
                      backgroundColor: showdown
                        ? MP.getOutcomeFlashColor(showdown.knockOutcome)
                        : MP.KNOCK_FLASH_COLOR,
                    }}
                  />
                )}
              </AnimatePresence>

              {/* Turn change pulse — subtle flash when it becomes your turn */}
              <AnimatePresence>
                {isMyTurn && !hasDrawn && shouldAnimate && (
                  <motion.div
                    key="turn-pulse"
                    initial={{ opacity: 0.08 }}
                    animate={{ opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6 }}
                    className="absolute inset-0 z-30 bg-amber-400/10 pointer-events-none"
                  />
                )}
              </AnimatePresence>

              <div
                className="relative z-10 flex h-full min-h-0 w-full flex-col items-stretch"
                style={tableContentStyle}
              >
                {/* ═══════ ZONE 1: Opponent seat (top-center) — unified identity + cards ═══════ */}
                <div className="flex flex-col items-center pt-2 sm:pt-3 md:pt-3 pb-0.5 sm:pb-1 z-10 flex-shrink-0">
                  {/* Opponent seat pill — avatar + name/score + fanned cards as one coherent unit */}
                  <div className="flex items-center gap-2 sm:gap-3 bg-[#0a2e1e]/40 md:bg-[#0a2e1e]/55 border border-emerald-700/20 md:border-emerald-700/35 rounded-full px-3 sm:px-5 py-1.5 sm:py-2 backdrop-blur-sm shadow-lg shadow-black/10">
                    {/* Avatar */}
                    <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-11 md:h-11 rounded-full bg-gradient-to-br from-amber-700 to-amber-900 border-2 border-amber-500/50 flex items-center justify-center text-amber-200 font-bold text-xs sm:text-sm md:text-base shadow-lg flex-shrink-0">
                      {opponent.name[0]}
                    </div>
                    {/* Name + Score */}
                    <div className="flex flex-col mr-1 sm:mr-2">
                      <span className="text-xs sm:text-sm font-bold text-emerald-50 leading-none">
                        {opponent.name}
                      </span>
                      <span className="text-[9px] sm:text-[10px] text-emerald-300/60 uppercase tracking-wider">
                        Score: {opponent.score}
                      </span>
                    </div>
                    {/* Fanned cards inline */}
                    <div
                      className="relative"
                      style={{
                        width: opponent.hand.length > 0 ? (opponent.hand.length - 1) * 24 + 48 : 0,
                        height: 66,
                      }}
                    >
                      {opponent.hand.map((_, i) => {
                        const fanAngle =
                          opponent.hand.length > 1
                            ? -18 + (36 / (opponent.hand.length - 1)) * i
                            : 0;
                        const fanY = Math.abs(i - (opponent.hand.length - 1) / 2) * 2.5;
                        return (
                          <motion.div
                            key={i}
                            initial={
                              shouldAnimate && dealAnimating
                                ? { y: -60, opacity: 0, rotate: -8 }
                                : {}
                            }
                            animate={{ y: fanY, opacity: 1, rotate: fanAngle }}
                            transition={
                              shouldAnimate
                                ? { delay: i * 0.03, type: "spring", stiffness: 300, damping: 20 }
                                : { duration: 0 }
                            }
                            className="absolute rounded-lg overflow-hidden"
                            style={{
                              left: i * 24,
                              zIndex: i,
                              width: 48,
                              height: 66,
                              transformOrigin: "bottom center",
                            }}
                          >
                            <CardBack className="w-full h-full" mini />
                          </motion.div>
                        );
                      })}
                    </div>
                    {/* Card count badge */}
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-emerald-900/80 border border-emerald-500/40 flex items-center justify-center text-emerald-100 text-xs sm:text-sm font-bold shadow-md ml-0.5">
                      {opponent.hand.length}
                    </div>
                  </div>
                  <div className="mt-1.5 h-6 flex items-center justify-center">
                    <AnimatePresence mode="wait">
                      {opponentDrawNotice && (
                        <motion.div
                          key={opponentDrawNotice.id}
                          initial={shouldAnimate ? { opacity: 0, y: -8, scale: 0.96 } : {}}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={shouldAnimate ? { opacity: 0, y: -6, scale: 0.98 } : {}}
                          transition={shouldAnimate ? { duration: 0.2 } : { duration: 0 }}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] shadow-lg",
                            opponentDrawNotice.source === "discard"
                              ? "bg-amber-100/95 text-amber-950"
                              : "bg-emerald-100/95 text-emerald-950",
                          )}
                        >
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              opponentDrawNotice.source === "discard"
                                ? "bg-amber-500"
                                : "bg-emerald-500",
                            )}
                          />
                          {opponentDrawNotice.source === "discard" && opponentDrawNotice.card
                            ? `${opponent.name} took ${opponentDrawNotice.card.rank}${opponentDrawNotice.card.suit}`
                            : `${opponent.name} drew stock`}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* ═══════ ZONE 2: Draw area — centered, lifted to upper-middle ═══════ */}
                <div className="flex-1 flex flex-col items-center z-10 min-h-0 relative">
                  {/* Stock/Discard — positioned in upper portion, not dead-center */}
                  <div className="flex flex-col items-center pt-1 sm:pt-2 md:pt-3">
                    {/* Turn indicator above piles — animated entrance on turn change */}
                    <div className="text-center mb-1.5 md:mb-2 flex-shrink-0">
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={isMyTurn ? (hasDrawn ? "act" : "draw") : "wait"}
                          initial={shouldAnimate ? MP.TURN_INDICATOR_INITIAL : {}}
                          animate={MP.TURN_INDICATOR_ANIMATE}
                          exit={shouldAnimate ? { opacity: 0, y: 8 } : {}}
                          transition={shouldAnimate ? { duration: 0.25 } : { duration: 0 }}
                          className={cn(
                            "text-xs sm:text-sm font-bold tracking-[0.2em] uppercase inline-block",
                            isMyTurn ? "text-amber-300" : "text-emerald-400/50",
                          )}
                        >
                          {isMyTurn ? (hasDrawn ? "SELECT & ACT" : "YOUR TURN") : "OPPONENT'S TURN"}
                        </motion.span>
                      </AnimatePresence>
                    </div>

                    {/* Stock & Discard — centered horizontal pair */}
                    <div className="flex items-start gap-4 sm:gap-6 md:gap-10">
                      {/* Stockpile */}
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
                              isMyTurn && myPlayer.hand.length === 10
                                ? "bg-amber-500/20"
                                : tablePulseSource === "stock"
                                  ? "bg-emerald-300/30"
                                  : "bg-transparent",
                            )}
                          />
                          <motion.div
                            animate={
                              shouldAnimate
                                ? {
                                    scale:
                                      drawAnimating === "stock" || tablePulseSource === "stock"
                                        ? [1, 0.92, 1]
                                        : 1,
                                    ...(isMyTurn && myPlayer.hand.length === 10
                                      ? MP.DRAW_TARGET_PULSE
                                      : {}),
                                  }
                                : {}
                            }
                            transition={
                              shouldAnimate
                                ? {
                                    scale: { duration: 0.25 },
                                    boxShadow: { duration: 2, repeat: Infinity, ease: "easeInOut" },
                                  }
                                : { duration: 0 }
                            }
                            className={cn(
                              "relative rounded-xl",
                              isMyTurn && myPlayer.hand.length === 10
                                ? "ring-2 ring-amber-400"
                                : tablePulseSource === "stock"
                                  ? "ring-2 ring-emerald-300"
                                  : "",
                            )}
                          >
                            <CardBack className="w-[68px] h-[96px] sm:w-[80px] sm:h-[112px]" />
                          </motion.div>
                        </div>
                      </div>

                      {/* Swap arrows */}
                      <div className="flex items-center self-center mt-6 text-emerald-400/30">
                        <span className="text-lg">⇄</span>
                      </div>

                      {/* Discard Pile */}
                      <div
                        className="flex flex-col items-center cursor-pointer"
                        onClick={() => handleDraw("discard")}
                      >
                        <span className="text-[10px] sm:text-xs font-semibold text-emerald-200/60 tracking-wide mb-1">
                          Discard
                        </span>
                        <div className="relative">
                          {topDiscard ? (
                            <motion.div
                              key={`${topDiscard.rank}${topDiscard.suit}`}
                              initial={
                                shouldAnimate && discardAnimating
                                  ? MP.DISCARD_PILE_ENTRY_INITIAL
                                  : {}
                              }
                              animate={
                                shouldAnimate
                                  ? {
                                      ...MP.DISCARD_PILE_ENTRY_ANIMATE,
                                      scale: tablePulseSource === "discard" ? [1, 1.06, 1] : 1,
                                      ...(isMyTurn && myPlayer.hand.length === 10
                                        ? MP.DRAW_TARGET_PULSE
                                        : {}),
                                    }
                                  : MP.DISCARD_PILE_ENTRY_ANIMATE
                              }
                              transition={
                                shouldAnimate
                                  ? {
                                      ...MP.CARD_SPRING,
                                      scale: { duration: 0.3 },
                                      boxShadow: {
                                        duration: 2,
                                        repeat: Infinity,
                                        ease: "easeInOut",
                                      },
                                    }
                                  : { duration: 0 }
                              }
                              className={cn(
                                "transition-transform",
                                isMyTurn && myPlayer.hand.length === 10
                                  ? "hover:-translate-y-2"
                                  : "",
                              )}
                            >
                              <PlayingCard
                                suit={topDiscard.suit}
                                rank={topDiscard.rank}
                                fourColor={fourColorDeck}
                                animate={shouldAnimate}
                                className={cn(
                                  "!w-[68px] !h-[96px] sm:!w-[80px] sm:!h-[112px]",
                                  isMyTurn && myPlayer.hand.length === 10
                                    ? "ring-2 ring-amber-400"
                                    : tablePulseSource === "discard"
                                      ? "ring-2 ring-amber-200"
                                      : "",
                                )}
                              />
                            </motion.div>
                          ) : (
                            <div className="w-[68px] h-[96px] sm:w-[80px] sm:h-[112px] rounded-xl border-2 border-dashed border-emerald-600/40 flex items-center justify-center">
                              <span className="text-emerald-500/30 text-xs">Empty</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* DRAW button */}
                    <button
                      onClick={() => handleDraw("stock")}
                      disabled={!isMyTurn || myPlayer.hand.length > 10}
                      className={cn(
                        "mt-2 md:mt-3 px-6 sm:px-8 py-1.5 rounded-lg text-xs sm:text-sm font-bold uppercase tracking-wider transition-all",
                        isMyTurn && myPlayer.hand.length === 10
                          ? "bg-emerald-700 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-900/50 border border-emerald-500/40"
                          : "bg-emerald-900/40 text-emerald-500/40 border border-emerald-800/30 cursor-not-allowed",
                      )}
                    >
                      Draw
                    </button>
                  </div>

                  {/* Open felt spacer — deliberate breathing room between draw area and player hand */}
                  <div className="flex-1 min-h-[8px] sm:min-h-[20px] md:min-h-[32px]" />
                </div>

                {/* ═══════ ZONE 3: Player seat + Hand + Buttons (bottom) ═══════ */}
                {(() => {
                  const HAND_W = 680;
                  const CARD_W = 78;
                  const RANK_STEP = (HAND_W - CARD_W) / 12;
                  const ROW_H = 90;

                  return (
                    <div className="flex flex-col items-center z-10 flex-shrink-0">
                      {/* Player seat bar — avatar + name/score + deadwood as a unified anchor */}
                      <div className="flex items-center gap-2 sm:gap-3 bg-[#0a2e1e]/40 md:bg-[#0a2e1e]/55 border border-emerald-700/20 md:border-emerald-700/35 rounded-full px-3 sm:px-5 py-1.5 sm:py-2 mb-1.5 md:mb-2.5 backdrop-blur-sm shadow-lg shadow-black/10">
                        {/* Player avatar */}
                        <div className="w-8 h-8 sm:w-10 sm:h-10 md:w-11 md:h-11 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 border-2 border-emerald-300/50 flex items-center justify-center text-white font-bold text-xs sm:text-sm md:text-base shadow-lg flex-shrink-0">
                          {myPlayer.name[0]}
                        </div>
                        {/* Name + Score */}
                        <div className="flex flex-col mr-1">
                          <span className="text-xs sm:text-sm font-bold text-emerald-100 leading-none">
                            You
                          </span>
                          <span className="text-[9px] sm:text-[10px] text-emerald-300/60 uppercase tracking-wider">
                            Score: {myPlayer.score}
                          </span>
                        </div>
                        {/* Deadwood indicator inline */}
                        {showDeadwoodCount && (
                          <div className="ml-2 sm:ml-4 px-2.5 sm:px-3 py-0.5 rounded-full bg-emerald-900/50 border border-emerald-700/30">
                            <span
                              className={cn(
                                "text-xs sm:text-sm font-bold",
                                hasDrawn && selectedCardIndex !== null && currentDeadwood <= 10
                                  ? "text-emerald-300"
                                  : hasDrawn && selectedCardIndex !== null && currentDeadwood > 10
                                    ? "text-rose-400"
                                    : "text-emerald-200/70",
                              )}
                            >
                              DW: {currentDeadwood}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Player Hand — 4 suit rows */}
                      <div className="w-full px-3 sm:px-4">
                        <div
                          style={{ width: "100%", maxWidth: HAND_W + 44 }}
                          className="mx-auto bg-[#0d2b1c]/30 border border-emerald-700/15 rounded-t-xl px-2 py-1 overflow-x-auto"
                        >
                          <div
                            style={{ width: HAND_W + 20 }}
                            className="mx-auto flex flex-col gap-0"
                          >
                            {(["♣", "♦", "♥", "♠"] as const).map((suit) => {
                              const suitCards = suitRows[suit];
                              return (
                                <div key={suit} className="flex items-center gap-1">
                                  <span
                                    className={cn(
                                      "w-5 text-center text-lg font-bold flex-shrink-0 opacity-70",
                                      getSuitColor(suit, fourColorDeck, true),
                                    )}
                                  >
                                    {suit}
                                  </span>
                                  <div
                                    className="relative"
                                    style={{ width: HAND_W, height: ROW_H }}
                                  >
                                    {suitCards.length === 0 ? (
                                      <div className="h-full flex items-center text-[10px] text-emerald-700/30">
                                        —
                                      </div>
                                    ) : (
                                      suitCards.map((card, i) => {
                                        const rankIdx = RANK_ORDER[card.rank] ?? 0;
                                        const meldIdx = getCardMeldIndex(
                                          meldHighlights,
                                          card as unknown as EngineCard,
                                        );
                                        const meldColor =
                                          meldIdx !== undefined ? getMeldColor(meldIdx) : undefined;
                                        return (
                                          <SuitRowCard
                                            key={`${card.rank}${card.suit}`}
                                            suit={card.suit}
                                            rank={card.rank}
                                            selected={selectedCardIndex === card.originalIndex}
                                            onClick={() => {
                                              setSelectedCardIndex(
                                                selectedCardIndex === card.originalIndex
                                                  ? null
                                                  : card.originalIndex,
                                              );
                                            }}
                                            leftPx={rankIdx * RANK_STEP}
                                            zIdx={i}
                                            isMyTurn={isMyTurn}
                                            hasDrawn={hasDrawn}
                                            fourColor={fourColorDeck}
                                            meldColorCls={meldColor}
                                            animationsEnabled={animationsEnabled}
                                          />
                                        );
                                      })
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons Row — DISCARD, KNOCK, GIN — with animated enable/disable */}
                      <div className="w-full flex justify-center gap-2 sm:gap-3 py-2 sm:py-2.5 bg-[#0a2e1e]/50 backdrop-blur-sm border-t border-emerald-700/15 rounded-b-[10px] sm:rounded-b-[16px]">
                        <motion.button
                          onClick={handleDiscard}
                          disabled={!isMyTurn || !hasDrawn || selectedCardIndex === null}
                          animate={
                            shouldAnimate && isMyTurn && hasDrawn && selectedCardIndex !== null
                              ? MP.BUTTON_ENABLE_SCALE
                              : MP.BUTTON_DISABLE_SCALE
                          }
                          transition={MP.QUICK_TWEEN}
                          className={cn(
                            "px-5 sm:px-7 py-2 rounded-lg text-xs sm:text-sm font-bold uppercase tracking-wider transition-all border",
                            isMyTurn && hasDrawn && selectedCardIndex !== null
                              ? "bg-teal-700 hover:bg-teal-600 text-white border-teal-500/50 shadow-lg"
                              : "bg-emerald-900/40 text-emerald-600/40 border-emerald-800/30 cursor-not-allowed",
                          )}
                        >
                          Discard
                        </motion.button>
                        <motion.button
                          onClick={handleKnock}
                          disabled={
                            !isMyTurn ||
                            !hasDrawn ||
                            selectedCardIndex === null ||
                            currentDeadwood > 10
                          }
                          animate={
                            shouldAnimate &&
                            isMyTurn &&
                            hasDrawn &&
                            selectedCardIndex !== null &&
                            currentDeadwood <= 10
                              ? MP.BUTTON_ENABLE_SCALE
                              : MP.BUTTON_DISABLE_SCALE
                          }
                          transition={MP.QUICK_TWEEN}
                          className={cn(
                            "px-5 sm:px-7 py-2 rounded-lg text-xs sm:text-sm font-bold uppercase tracking-wider transition-all border",
                            isMyTurn &&
                              hasDrawn &&
                              selectedCardIndex !== null &&
                              currentDeadwood <= 10
                              ? "bg-teal-700 hover:bg-teal-600 text-white border-teal-500/50 shadow-lg"
                              : "bg-emerald-900/40 text-emerald-600/40 border-emerald-800/30 cursor-not-allowed",
                          )}
                        >
                          Knock
                        </motion.button>
                        <motion.button
                          onClick={handleKnock}
                          disabled={
                            !isMyTurn ||
                            !hasDrawn ||
                            selectedCardIndex === null ||
                            currentDeadwood !== 0
                          }
                          animate={
                            shouldAnimate &&
                            isMyTurn &&
                            hasDrawn &&
                            selectedCardIndex !== null &&
                            currentDeadwood === 0
                              ? {
                                  scale: [0.95, 1.05, 1],
                                  boxShadow: [
                                    "0 0 0px rgba(245,158,11,0)",
                                    "0 0 20px rgba(245,158,11,0.4)",
                                    "0 0 10px rgba(245,158,11,0.2)",
                                  ],
                                }
                              : MP.BUTTON_DISABLE_SCALE
                          }
                          transition={MP.QUICK_TWEEN}
                          className={cn(
                            "px-5 sm:px-7 py-2 rounded-lg text-xs sm:text-sm font-bold uppercase tracking-wider transition-all border",
                            isMyTurn &&
                              hasDrawn &&
                              selectedCardIndex !== null &&
                              currentDeadwood === 0
                              ? "bg-amber-600 hover:bg-amber-500 text-white border-amber-400/50 shadow-lg shadow-amber-600/30"
                              : "bg-emerald-900/40 text-emerald-600/40 border-emerald-800/30 cursor-not-allowed",
                          )}
                        >
                          Gin
                        </motion.button>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* ── Round Over / Showdown ───────────────────────────── */}
              <AnimatePresence>
                {gameState.status === "round_over" && (
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
                      transition={
                        shouldAnimate ? { ...MP.EMPHASIS_SPRING, delay: 0.1 } : { duration: 0 }
                      }
                      className="bg-[#0d1a12] border border-emerald-800/50 p-6 rounded-2xl text-center max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
                      style={
                        showdown && shouldAnimate
                          ? { boxShadow: MP.getOutcomeBadgeShadow(showdown.knockOutcome) }
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
                      {showdown && (
                        <>
                          <motion.div
                            initial={shouldAnimate ? MP.OUTCOME_BADGE_INITIAL : {}}
                            animate={MP.OUTCOME_BADGE_ANIMATE}
                            transition={
                              shouldAnimate
                                ? { ...MP.EMPHASIS_SPRING, delay: 0.25 }
                                : { duration: 0 }
                            }
                            className={cn(
                              "inline-flex px-3 py-1 rounded-full text-xs font-bold mb-3",
                              showdown.knockOutcome === "gin"
                                ? "bg-amber-500/20 text-amber-400"
                                : showdown.knockOutcome === "undercut"
                                  ? "bg-rose-500/20 text-rose-400"
                                  : "bg-emerald-500/20 text-emerald-400",
                            )}
                          >
                            {showdown.knockOutcome === "gin"
                              ? "🔥 GIN"
                              : showdown.knockOutcome === "undercut"
                                ? "⚡ UNDERCUT"
                                : "👊 KNOCK"}
                            {" — "}
                            {showdown.winnerName} wins {showdown.points} pts
                          </motion.div>
                          <div className="space-y-4 mt-4 text-left">
                            {/* Knocker — staggered card reveal */}
                            <motion.div
                              initial={shouldAnimate ? { opacity: 0 } : {}}
                              animate={{ opacity: 1 }}
                              transition={shouldAnimate ? { delay: 0.35 } : { duration: 0 }}
                              className="space-y-2"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-zinc-100">
                                  {showdown.knockerName}
                                </span>
                                <span
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-bold border",
                                    showdown.knockOutcome === "gin"
                                      ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                      : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
                                  )}
                                >
                                  {showdown.knockOutcome === "gin" ? "GIN" : "KNOCKER"}
                                </span>
                                <span className="text-[10px] text-emerald-600/60 ml-auto">
                                  {showDeadwoodCount ? `DW: ${showdown.knockerDW}` : ""}
                                </span>
                              </div>
                              {showdown.knockerMelds.map((meld, mi) => (
                                <motion.div
                                  key={mi}
                                  initial={shouldAnimate ? MP.SHOWDOWN_CARD_INITIAL : {}}
                                  animate={MP.SHOWDOWN_CARD_ANIMATE}
                                  transition={
                                    shouldAnimate
                                      ? {
                                          delay: 0.4 + mi * MP.SHOWDOWN_MELD_STAGGER,
                                          ...MP.CARD_SPRING,
                                        }
                                      : { duration: 0 }
                                  }
                                  className="flex items-center gap-0.5"
                                >
                                  <span className="text-[9px] text-emerald-500 w-8 flex-shrink-0 font-medium">
                                    {meld.every((c) => c.rank === meld[0].rank) ? "Set" : "Run"}
                                  </span>
                                  <div className="flex gap-0.5 flex-wrap">
                                    {meld.map((c, ci) => (
                                      <motion.div
                                        key={ci}
                                        initial={shouldAnimate ? MP.SHOWDOWN_CARD_INITIAL : {}}
                                        animate={MP.SHOWDOWN_CARD_ANIMATE}
                                        transition={
                                          shouldAnimate
                                            ? {
                                                delay:
                                                  0.4 +
                                                  mi * MP.SHOWDOWN_MELD_STAGGER +
                                                  ci * MP.SHOWDOWN_CARD_STAGGER,
                                              }
                                            : { duration: 0 }
                                        }
                                      >
                                        <ShowdownCardMini
                                          suit={c.suit}
                                          rank={c.rank}
                                          highlight="meld"
                                          fourColor={fourColorDeck}
                                        />
                                      </motion.div>
                                    ))}
                                  </div>
                                </motion.div>
                              ))}
                              {showdown.knockerDeadwood.length > 0 && (
                                <motion.div
                                  initial={shouldAnimate ? MP.SHOWDOWN_CARD_INITIAL : {}}
                                  animate={MP.SHOWDOWN_CARD_ANIMATE}
                                  transition={
                                    shouldAnimate
                                      ? {
                                          delay:
                                            0.4 +
                                            showdown.knockerMelds.length * MP.SHOWDOWN_MELD_STAGGER,
                                        }
                                      : { duration: 0 }
                                  }
                                  className="flex items-center gap-0.5"
                                >
                                  <span className="text-[9px] text-emerald-600/60 w-8 flex-shrink-0 font-medium">
                                    DW
                                  </span>
                                  <div className="flex gap-0.5 flex-wrap">
                                    {showdown.knockerDeadwood.map((c, ci) => (
                                      <motion.div
                                        key={ci}
                                        initial={shouldAnimate ? MP.SHOWDOWN_CARD_INITIAL : {}}
                                        animate={MP.SHOWDOWN_CARD_ANIMATE}
                                        transition={
                                          shouldAnimate
                                            ? {
                                                delay:
                                                  0.45 +
                                                  showdown.knockerMelds.length *
                                                    MP.SHOWDOWN_MELD_STAGGER +
                                                  ci * MP.SHOWDOWN_CARD_STAGGER,
                                              }
                                            : { duration: 0 }
                                        }
                                      >
                                        <ShowdownCardMini
                                          suit={c.suit}
                                          rank={c.rank}
                                          highlight="deadwood"
                                          fourColor={fourColorDeck}
                                        />
                                      </motion.div>
                                    ))}
                                  </div>
                                </motion.div>
                              )}
                            </motion.div>
                            <div className="border-t border-emerald-800/40" />
                            {/* Opponent — staggered card reveal (delayed further) */}
                            <motion.div
                              initial={shouldAnimate ? { opacity: 0 } : {}}
                              animate={{ opacity: 1 }}
                              transition={shouldAnimate ? { delay: 0.6 } : { duration: 0 }}
                              className="space-y-2"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-zinc-100">
                                  {showdown.opponentName}
                                </span>
                                <span className="text-[10px] text-emerald-600/60 ml-auto">
                                  {showDeadwoodCount ? `DW: ${showdown.opponentDW}` : ""}
                                </span>
                              </div>
                              {showdown.opponentMelds.map((meld, mi) => (
                                <motion.div
                                  key={mi}
                                  initial={shouldAnimate ? MP.SHOWDOWN_CARD_INITIAL : {}}
                                  animate={MP.SHOWDOWN_CARD_ANIMATE}
                                  transition={
                                    shouldAnimate
                                      ? {
                                          delay: 0.7 + mi * MP.SHOWDOWN_MELD_STAGGER,
                                          ...MP.CARD_SPRING,
                                        }
                                      : { duration: 0 }
                                  }
                                  className="flex items-center gap-0.5"
                                >
                                  <span className="text-[9px] text-emerald-500 w-8 flex-shrink-0 font-medium">
                                    {meld.every((c) => c.rank === meld[0].rank) ? "Set" : "Run"}
                                  </span>
                                  <div className="flex gap-0.5 flex-wrap">
                                    {meld.map((c, ci) => (
                                      <motion.div
                                        key={ci}
                                        initial={shouldAnimate ? MP.SHOWDOWN_CARD_INITIAL : {}}
                                        animate={MP.SHOWDOWN_CARD_ANIMATE}
                                        transition={
                                          shouldAnimate
                                            ? {
                                                delay:
                                                  0.7 +
                                                  mi * MP.SHOWDOWN_MELD_STAGGER +
                                                  ci * MP.SHOWDOWN_CARD_STAGGER,
                                              }
                                            : { duration: 0 }
                                        }
                                      >
                                        <ShowdownCardMini
                                          suit={c.suit}
                                          rank={c.rank}
                                          highlight="meld"
                                          fourColor={fourColorDeck}
                                        />
                                      </motion.div>
                                    ))}
                                  </div>
                                </motion.div>
                              ))}
                              {showdown.laidOffCards.length > 0 && (
                                <motion.div
                                  initial={shouldAnimate ? MP.SHOWDOWN_CARD_INITIAL : {}}
                                  animate={MP.SHOWDOWN_CARD_ANIMATE}
                                  transition={
                                    shouldAnimate
                                      ? {
                                          delay:
                                            0.8 +
                                            showdown.opponentMelds.length *
                                              MP.SHOWDOWN_MELD_STAGGER,
                                        }
                                      : { duration: 0 }
                                  }
                                  className="flex items-center gap-0.5"
                                >
                                  <span className="text-[9px] text-amber-500 w-8 flex-shrink-0 font-medium">
                                    Laid
                                  </span>
                                  <div className="flex gap-0.5 flex-wrap">
                                    {showdown.laidOffCards.map((c, ci) => (
                                      <motion.div
                                        key={ci}
                                        initial={shouldAnimate ? MP.SHOWDOWN_CARD_INITIAL : {}}
                                        animate={MP.SHOWDOWN_CARD_ANIMATE}
                                        transition={
                                          shouldAnimate
                                            ? {
                                                delay:
                                                  0.85 +
                                                  showdown.opponentMelds.length *
                                                    MP.SHOWDOWN_MELD_STAGGER +
                                                  ci * MP.SHOWDOWN_CARD_STAGGER,
                                              }
                                            : { duration: 0 }
                                        }
                                      >
                                        <ShowdownCardMini
                                          suit={c.suit}
                                          rank={c.rank}
                                          highlight="layoff"
                                          fourColor={fourColorDeck}
                                        />
                                      </motion.div>
                                    ))}
                                  </div>
                                </motion.div>
                              )}
                              {showdown.opponentDeadwood.length > 0 && (
                                <motion.div
                                  initial={shouldAnimate ? MP.SHOWDOWN_CARD_INITIAL : {}}
                                  animate={MP.SHOWDOWN_CARD_ANIMATE}
                                  transition={
                                    shouldAnimate
                                      ? {
                                          delay:
                                            0.9 +
                                            showdown.opponentMelds.length *
                                              MP.SHOWDOWN_MELD_STAGGER,
                                        }
                                      : { duration: 0 }
                                  }
                                  className="flex items-center gap-0.5"
                                >
                                  <span className="text-[9px] text-zinc-500 w-8 flex-shrink-0 font-medium">
                                    DW
                                  </span>
                                  <div className="flex gap-0.5 flex-wrap">
                                    {showdown.opponentDeadwood.map((c, ci) => (
                                      <motion.div
                                        key={ci}
                                        initial={shouldAnimate ? MP.SHOWDOWN_CARD_INITIAL : {}}
                                        animate={MP.SHOWDOWN_CARD_ANIMATE}
                                        transition={
                                          shouldAnimate
                                            ? {
                                                delay:
                                                  0.95 +
                                                  showdown.opponentMelds.length *
                                                    MP.SHOWDOWN_MELD_STAGGER +
                                                  ci * MP.SHOWDOWN_CARD_STAGGER,
                                              }
                                            : { duration: 0 }
                                        }
                                      >
                                        <ShowdownCardMini
                                          suit={c.suit}
                                          rank={c.rank}
                                          highlight="deadwood"
                                          fourColor={fourColorDeck}
                                        />
                                      </motion.div>
                                    ))}
                                  </div>
                                </motion.div>
                              )}
                            </motion.div>
                          </div>
                        </>
                      )}
                      {!showdown && <p className="text-zinc-400 mb-4">{gameState.message}</p>}
                      <motion.div
                        initial={shouldAnimate ? { opacity: 0, y: 10 } : {}}
                        animate={{ opacity: 1, y: 0 }}
                        transition={shouldAnimate ? { delay: 1.1 } : { duration: 0 }}
                      >
                        <Button variant="primary" onClick={handleNextRound} className="w-full mt-4">
                          Next Round
                        </Button>
                      </motion.div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Game Over */}
              <AnimatePresence>
                {gameState.status === "game_over" && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-50 flex items-center justify-center bg-[#030d08]/90 backdrop-blur-sm"
                  >
                    <motion.div
                      initial={shouldAnimate ? { scale: 0.9, opacity: 0 } : {}}
                      animate={{ scale: 1, opacity: 1 }}
                      className="bg-[#0d1a12] border border-emerald-800/50 p-6 rounded-2xl text-center max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
                    >
                      <h2 className="text-3xl font-bold text-amber-500 mb-1">Game Over</h2>
                      <p className="text-zinc-300 mb-2">{gameState.message}</p>
                      {showdown && (
                        <>
                          <div
                            className={cn(
                              "inline-flex px-3 py-1 rounded-full text-xs font-bold mb-3",
                              showdown.knockOutcome === "gin"
                                ? "bg-amber-500/20 text-amber-400"
                                : showdown.knockOutcome === "undercut"
                                  ? "bg-rose-500/20 text-rose-400"
                                  : "bg-emerald-500/20 text-emerald-400",
                            )}
                          >
                            {showdown.knockOutcome === "gin"
                              ? "🔥 GIN"
                              : showdown.knockOutcome === "undercut"
                                ? "⚡ UNDERCUT"
                                : "👊 KNOCK"}
                          </div>
                          <div className="space-y-3 mt-3 text-left">
                            {/* Knocker */}
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                                {showdown.knockerName}
                                <span className="text-[10px] text-zinc-500 ml-auto font-normal">
                                  {showDeadwoodCount ? `DW: ${showdown.knockerDW}` : ""}
                                </span>
                              </div>
                              {showdown.knockerMelds.map((meld, mi) => (
                                <div key={mi} className="flex items-center gap-0.5">
                                  <span className="text-[9px] text-emerald-500 w-8 flex-shrink-0 font-medium">
                                    {meld.every((c) => c.rank === meld[0].rank) ? "Set" : "Run"}
                                  </span>
                                  <div className="flex gap-0.5 flex-wrap">
                                    {meld.map((c, ci) => (
                                      <ShowdownCardMini
                                        key={ci}
                                        suit={c.suit}
                                        rank={c.rank}
                                        highlight="meld"
                                        fourColor={fourColorDeck}
                                      />
                                    ))}
                                  </div>
                                </div>
                              ))}
                              {showdown.knockerDeadwood.length > 0 && (
                                <div className="flex items-center gap-0.5">
                                  <span className="text-[9px] text-zinc-500 w-8 flex-shrink-0 font-medium">
                                    DW
                                  </span>
                                  <div className="flex gap-0.5 flex-wrap">
                                    {showdown.knockerDeadwood.map((c, ci) => (
                                      <ShowdownCardMini
                                        key={ci}
                                        suit={c.suit}
                                        rank={c.rank}
                                        highlight="deadwood"
                                        fourColor={fourColorDeck}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="border-t border-emerald-800/40" />
                            {/* Opponent */}
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                                {showdown.opponentName}
                                <span className="text-[10px] text-zinc-500 ml-auto font-normal">
                                  {showDeadwoodCount ? `DW: ${showdown.opponentDW}` : ""}
                                </span>
                              </div>
                              {showdown.opponentMelds.map((meld, mi) => (
                                <div key={mi} className="flex items-center gap-0.5">
                                  <span className="text-[9px] text-emerald-500 w-8 flex-shrink-0 font-medium">
                                    {meld.every((c) => c.rank === meld[0].rank) ? "Set" : "Run"}
                                  </span>
                                  <div className="flex gap-0.5 flex-wrap">
                                    {meld.map((c, ci) => (
                                      <ShowdownCardMini
                                        key={ci}
                                        suit={c.suit}
                                        rank={c.rank}
                                        highlight="meld"
                                        fourColor={fourColorDeck}
                                      />
                                    ))}
                                  </div>
                                </div>
                              ))}
                              {showdown.laidOffCards.length > 0 && (
                                <div className="flex items-center gap-0.5">
                                  <span className="text-[9px] text-amber-500 w-8 flex-shrink-0 font-medium">
                                    Laid
                                  </span>
                                  <div className="flex gap-0.5 flex-wrap">
                                    {showdown.laidOffCards.map((c, ci) => (
                                      <ShowdownCardMini
                                        key={ci}
                                        suit={c.suit}
                                        rank={c.rank}
                                        highlight="layoff"
                                        fourColor={fourColorDeck}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                              {showdown.opponentDeadwood.length > 0 && (
                                <div className="flex items-center gap-0.5">
                                  <span className="text-[9px] text-zinc-500 w-8 flex-shrink-0 font-medium">
                                    DW
                                  </span>
                                  <div className="flex gap-0.5 flex-wrap">
                                    {showdown.opponentDeadwood.map((c, ci) => (
                                      <ShowdownCardMini
                                        key={ci}
                                        suit={c.suit}
                                        rank={c.rank}
                                        highlight="deadwood"
                                        fourColor={fourColorDeck}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                      <div className="flex justify-center gap-8 my-4 text-sm">
                        <div>
                          <div className="text-zinc-500">You</div>
                          <div className="text-2xl font-bold font-mono text-white">
                            {myPlayer.score}
                          </div>
                        </div>
                        <div className="border-l border-emerald-800/40" />
                        <div>
                          <div className="text-zinc-500">{opponent.name}</div>
                          <div className="text-2xl font-bold font-mono text-white">
                            {opponent.score}
                          </div>
                        </div>
                      </div>
                      <Link to="/">
                        <Button variant="primary" className="w-full">
                          Return to Dashboard
                        </Button>
                      </Link>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {/* end inner felt */}
          </div>
          {/* end inner dark border */}
        </div>
        {/* end outer blonde wood trim */}
      </main>
    </div>
  );
}
