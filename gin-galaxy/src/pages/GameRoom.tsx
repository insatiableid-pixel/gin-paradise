import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Settings, RotateCcw, Volume2, VolumeX, Sparkles } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Button } from "@/src/components/ui/Button";
import { motion, AnimatePresence } from "motion/react";
import { createGame, drawCard, discardCard, knock, nextRound, GameState, Card as EngineCard, Suit, Rank, RANKS, getRankIndex, getCardValue, evaluateHand, evaluateAndLayOff } from "@/src/lib/engine";
import { useAuthStore } from "@/src/lib/store";
import { decideDrawSource, decideDiscard, shouldKnock } from "@/src/lib/ai";
import { usePreferences, getSuitColor } from "@/src/lib/preferences";
import { computeMeldHighlights, getMeldColor, getCardMeldIndex, type MeldHighlightMap } from "@/src/lib/meldHighlight";
import { useHandDrag, type DragCard } from "@/src/lib/handDrag";
import { playDrawSound, playDiscardSound, playDealSound, playKnockSound, playResultSound, prefersReducedMotion } from "@/src/lib/audio";
import { PlayingCard, OverlappingCard, CardBack, SuitRowCard, ShowdownCardMini, TABLE_FELT_GRADIENT, TABLE_NOISE_STYLE, SHOWDOWN_OVERLAY_BG, SHOWDOWN_PANEL_BG, SHOWDOWN_PANEL_BORDER } from "@/src/components/cards";

// ── Sort helpers ─────────────────────────────────────────────────────
const SUIT_ORDER: Record<string, number> = { "♣": 0, "♦": 1, "♥": 2, "♠": 3 };
const RANK_ORDER: Record<string, number> = { "A": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, "8": 7, "9": 8, "10": 9, "J": 10, "Q": 11, "K": 12 };

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

export function GameRoom() {
  const { user } = useAuthStore();
  const { showDeadwoodCount, fourColorDeck, soundEnabled, animationsEnabled, setShowDeadwoodCount, setFourColorDeck, setSoundEnabled, setAnimationsEnabled } = usePreferences();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);
  const botDrewFromDiscard = useRef(false);
  const [showdown, setShowdown] = useState<LocalShowdown | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

  // Animation state flags
  const [dealAnimating, setDealAnimating] = useState(false);
  const [drawAnimating, setDrawAnimating] = useState<"stock" | "discard" | null>(null);
  const [discardAnimating, setDiscardAnimating] = useState(false);
  const [knockAnimating, setKnockAnimating] = useState(false);

  const reducedMotion = prefersReducedMotion();
  const shouldAnimate = animationsEnabled && !reducedMotion;

  // Sound helper
  const playSound = useCallback((fn: () => void) => {
    if (soundEnabled) fn();
  }, [soundEnabled]);

  useEffect(() => {
    if (user) {
      setGameState(createGame(
        { id: user.id, name: user.username },
        { id: "bot", name: "Nova" }
      ));
      setShowdown(null);
      // Deal animation
      if (shouldAnimate) {
        setDealAnimating(true);
        setTimeout(() => setDealAnimating(false), 500);
      }
      playSound(playDealSound);
    }
  }, [user]);

  // Drag-and-drop hand management
  const myHand = gameState ? gameState.players[gameState.players.findIndex(p => p.id === user?.id)]?.hand ?? [] : [];
  const { displayHand, dragState, isCustomOrder, onDragStart, onDragOver, onDragEnd, resetToAutoSort } = useHandDrag(myHand);

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

  // Smart AI bot — two-phase turn for natural UX
  useEffect(() => {
    if (!gameState || gameState.status !== "playing") return;

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (currentPlayer.id !== "bot") return;

    if (currentPlayer.hand.length === 10) {
      // Phase 1: Draw decision (600ms think time)
      const timer = setTimeout(() => {
        const topDiscard = gameState.discard[gameState.discard.length - 1];
        const source = decideDrawSource(currentPlayer.hand, topDiscard, gameState.discard);
        botDrewFromDiscard.current = source === "discard";
        playSound(playDrawSound);
        setGameState(prev => prev ? drawCard(prev, "bot", source) : prev);
      }, 600);
      return () => clearTimeout(timer);
    }

    if (currentPlayer.hand.length === 11) {
      // Phase 2: Discard / Knock decision (800ms think time)
      const timer = setTimeout(() => {
        const drawnCard = currentPlayer.hand[currentPlayer.hand.length - 1];
        const discardIdx = decideDiscard(
          currentPlayer.hand,
          botDrewFromDiscard.current,
          drawnCard,
          gameState.discard
        );

        const handAfter = [
          ...currentPlayer.hand.slice(0, discardIdx),
          ...currentPlayer.hand.slice(discardIdx + 1)
        ];

        if (shouldKnock(handAfter)) {
          // Compute showdown data before knock modifies state
          const knockerEval = evaluateHand(handAfter);
          const opponent = gameState.players.find(p => p.id !== "bot")!;
          let opponentEval;
          let laidOff: EngineCard[] = [];
          let knockOutcome: "knock" | "gin" | "undercut";

          if (knockerEval.deadwoodValue === 0) {
            opponentEval = evaluateHand(opponent.hand);
          } else {
            opponentEval = evaluateAndLayOff(opponent.hand, knockerEval.melds);
            // Compute laid-off cards
            const inMeldsSet = new Set<string>();
            for (const m of opponentEval.melds) for (const c of m) inMeldsSet.add(`${c.rank}${c.suit}`);
            const inDWSet = new Set<string>();
            for (const c of opponentEval.deadwood) inDWSet.add(`${c.rank}${c.suit}`);
            laidOff = opponent.hand.filter(c => {
              const key = `${c.rank}${c.suit}`;
              return !inMeldsSet.has(key) && !inDWSet.has(key);
            });
          }

          if (knockerEval.deadwoodValue === 0) knockOutcome = "gin";
          else if (opponentEval.deadwoodValue <= knockerEval.deadwoodValue) knockOutcome = "undercut";
          else knockOutcome = "knock";

          const winnerName = knockOutcome === "undercut" ? opponent.name : currentPlayer.name;
          let points = 0;
          if (knockOutcome === "gin") points = opponentEval.deadwoodValue + 25;
          else if (knockOutcome === "undercut") points = (knockerEval.deadwoodValue - opponentEval.deadwoodValue) + 25;
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
          setGameState(prev => prev ? knock(prev, "bot", discardIdx) : prev);
        } else {
          playSound(playDiscardSound);
          setGameState(prev => prev ? discardCard(prev, "bot", discardIdx) : prev);
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [gameState]);

  // Save match result when game is over
  useEffect(() => {
    if (gameState?.status === "game_over" && user) {
      const myPlayer = gameState.players.find(p => p.id === user.id);
      const opponent = gameState.players.find(p => p.id !== user.id);
      
      if (myPlayer && opponent) {
        const isWin = myPlayer.score >= 100;
        playSound(() => playResultSound(isWin));
        fetch("/api/matches", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${useAuthStore.getState().sessionId}`
          },
          body: JSON.stringify({
            opponent_name: opponent.name,
            user_score: myPlayer.score,
            opponent_score: opponent.score,
            is_win: isWin
          })
        }).catch(console.error);
      }
    }
  }, [gameState?.status, user]);

  // ── 4-row suit grouping (always auto-sorted A→K per suit) ──
  // Must be above early return to maintain React hook call order
  const suitRows = useMemo(() => {
    const groups: Record<string, Array<{ suit: string; rank: string; originalIndex: number }>> = { "♣": [], "♦": [], "♥": [], "♠": [] };
    myHand.forEach((card, i) => {
      if (groups[card.suit]) groups[card.suit].push({ suit: card.suit, rank: card.rank, originalIndex: i });
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

  if (!gameState || !user) return <div className="min-h-screen bg-[#0a1f15] flex items-center justify-center text-emerald-400/60">Loading game...</div>;

  const myPlayerIndex = gameState.players.findIndex(p => p.id === user.id);
  const opponentIndex = myPlayerIndex === 0 ? 1 : 0;
  const myPlayer = gameState.players[myPlayerIndex];
  const opponent = gameState.players[opponentIndex];
  const isMyTurn = gameState.currentPlayerIndex === myPlayerIndex;
  const hasDrawn = myPlayer.hand.length > 10;

  const overlapPx = 38;
  const cardWidth = 72;
  const handWidth = displayHand.length > 0 ? (displayHand.length - 1) * overlapPx + cardWidth : 0;

  const handleDraw = (source: "stock" | "discard") => {
    if (!isMyTurn || myPlayer.hand.length > 10) return;
    playSound(playDrawSound);
    if (shouldAnimate) {
      setDrawAnimating(source);
      setTimeout(() => setDrawAnimating(null), 300);
    }
    setGameState(drawCard(gameState, user.id, source));
  };

  const handleDiscard = () => {
    if (!isMyTurn || myPlayer.hand.length <= 10 || selectedCardIndex === null) return;
    playSound(playDiscardSound);
    if (shouldAnimate) {
      setDiscardAnimating(true);
      setTimeout(() => setDiscardAnimating(false), 300);
    }
    setGameState(discardCard(gameState, user.id, selectedCardIndex));
    setSelectedCardIndex(null);
  };

  const handleKnock = () => {
    if (!isMyTurn || myPlayer.hand.length <= 10 || selectedCardIndex === null) return;

    // Compute showdown before knock
    const handAfter = [...myPlayer.hand];
    const [discarded] = handAfter.splice(selectedCardIndex, 1);
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
        laidOff = opponent.hand.filter(c => {
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
      else if (knockOutcome === "undercut") points = (knockerEval.deadwoodValue - opponentEval.deadwoodValue) + 25;
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
      setTimeout(() => setKnockAnimating(false), 400);
    }
    setGameState(knock(gameState, user.id, selectedCardIndex));
    setSelectedCardIndex(null);
  };

  const handleNextRound = () => {
    setShowdown(null);
    setGameState(nextRound(gameState));
    playSound(playDealSound);
    if (shouldAnimate) {
      setDealAnimating(true);
      setTimeout(() => setDealAnimating(false), 500);
    }
  };

  const topDiscard = gameState.discard[gameState.discard.length - 1];

  return (
    <div className="fixed inset-0 bg-[#0a1f15] flex flex-col font-sans">
      {/* Game Header — Warm wood-tone bar */}
      <header className="h-11 border-b border-emerald-900/50 bg-[#0d1a12]/90 backdrop-blur flex items-center justify-between px-3 z-20">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-emerald-700 hover:text-emerald-300 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <span className="text-xs font-medium text-emerald-400/70">vs {opponent.name}</span>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400/80 border border-amber-500/25">RATED</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-emerald-600/60 hidden sm:block">{gameState.message}</div>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="w-7 h-7 rounded-full bg-emerald-900/40 hover:bg-emerald-800/50 flex items-center justify-center transition-colors"
            title={soundEnabled ? "Mute sounds" : "Enable sounds"}
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-emerald-600" /> : <VolumeX className="w-3.5 h-3.5 text-emerald-800" />}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowPrefs(!showPrefs)}
              className="w-7 h-7 rounded-full bg-emerald-900/40 hover:bg-emerald-800/50 flex items-center justify-center transition-colors"
              title="Preferences"
            >
              <Settings className="w-3.5 h-3.5 text-emerald-600" />
            </button>
            {showPrefs && (
              <div className="absolute right-0 top-9 w-52 bg-[#0d1a12] border border-emerald-800/50 rounded-xl shadow-xl p-3 space-y-3 z-50">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs text-emerald-300/80">Show Deadwood Count</span>
                  <input
                    type="checkbox"
                    checked={showDeadwoodCount}
                    onChange={(e) => setShowDeadwoodCount(e.target.checked)}
                    className="accent-amber-500"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs text-emerald-300/80">Four-Color Deck</span>
                  <input
                    type="checkbox"
                    checked={fourColorDeck}
                    onChange={(e) => setFourColorDeck(e.target.checked)}
                    className="accent-amber-500"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs text-emerald-300/80">Sound Effects</span>
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => setSoundEnabled(e.target.checked)}
                    className="accent-amber-500"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs text-emerald-300/80">Enhanced Animations</span>
                  <input
                    type="checkbox"
                    checked={animationsEnabled}
                    onChange={(e) => setAnimationsEnabled(e.target.checked)}
                    className="accent-amber-500"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Game Board — Emerald Felt Table */}
      <main className="flex-1 relative overflow-hidden">
        {/* Felt table surface — rich emerald gradient with dark vignette edges */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_70%_at_50%_50%,_#0f3d2a_0%,_#0a2e1e_40%,_#061a11_75%,_#030d08_100%)] pointer-events-none" />
        {/* Subtle noise/grain overlay for cloth texture */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%270 0 256 256%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%274%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")', backgroundSize: '128px 128px' }} />

        {/* Knock emphasis flash */}
        <AnimatePresence>
          {knockAnimating && shouldAnimate && (
            <motion.div
              initial={{ opacity: 0.3 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 z-30 bg-amber-400/10 pointer-events-none"
            />
          )}
        </AnimatePresence>

        {/* Opponent Area — Upper Right (absolute) */}
        <div className="absolute top-3 right-4 sm:right-6 lg:right-10 z-10 flex flex-col items-end">
          <div className={cn("flex items-center gap-3 bg-[#0a2e1e]/80 border rounded-full px-3 py-1.5 backdrop-blur-sm shadow-md transition-colors", !isMyTurn ? "border-amber-500/60" : "border-emerald-800/50")}>
            <div className="w-7 h-7 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 font-bold text-xs">
              {opponent.name[0]}
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-emerald-100 leading-none">{opponent.name}</span>
              <span className="text-[9px] text-emerald-500/60">{opponent.hand.length} cards</span>
            </div>
            <div className="ml-2 flex flex-col items-end">
              <span className="text-[9px] text-emerald-600/50">Score</span>
              <span className="text-base font-mono font-bold text-emerald-100 leading-none">{opponent.score}</span>
            </div>
          </div>
          
          {/* Opponent Cards (Hidden) */}
          <div className="mt-2 flex justify-end scale-[0.65] sm:scale-[0.8] origin-top-right opacity-50">
            <div className="relative" style={{ width: opponent.hand.length > 0 ? (opponent.hand.length - 1) * 18 + 48 : 0, height: 68 }}>
              {opponent.hand.map((_, i) => (
                <motion.div
                  key={i}
                  initial={shouldAnimate && dealAnimating ? { y: -60, opacity: 0, rotate: -8 } : {}}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  transition={shouldAnimate ? { delay: i * 0.03, type: "spring", stiffness: 300, damping: 20 } : { duration: 0 }}
                  className="absolute rounded-lg overflow-hidden"
                  style={{ left: i * 18, zIndex: i, width: 48, height: 68 }}
                >
                  <CardBack className="w-full h-full" mini />
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Center-anchored content: Stock/Discard above hand, hand vertically centered ── */}
        {(() => {
          const HAND_W = 780;
          const CARD_W = 88;
          const RANK_STEP = (HAND_W - CARD_W) / 12;
          const ROW_H = 118; // tightened from 128 to prevent bottom clipping

          return (
            <div className="absolute inset-0 flex flex-col items-center z-10" style={{ top: 0, bottom: 0 }}>
              {/* Top spacer — pushes Clubs row to vertical center */}
              <div className="flex-1" style={{ minHeight: 0 }} />

              {/* Stock & Discard — Centered Tray */}
              <div className="flex items-end justify-center gap-8 sm:gap-10 mb-4 flex-shrink-0">
                {/* Stock Pile */}
                <div className="group cursor-pointer" onClick={() => handleDraw("stock")}>
                  <div className="relative">
                    <div className={cn("absolute inset-0 blur-xl rounded-full transition-colors", isMyTurn && myPlayer.hand.length === 10 ? "bg-amber-500/20" : "bg-transparent")} />
                    <motion.div
                      animate={shouldAnimate && drawAnimating === "stock" ? { scale: [1, 0.95, 1] } : {}}
                      transition={{ duration: 0.2 }}
                      className={cn("relative transition-colors", isMyTurn && myPlayer.hand.length === 10 ? "ring-2 ring-amber-400 rounded-xl" : "")}
                    >
                      <CardBack className="w-[80px] h-[112px] sm:w-[88px] sm:h-[124px]" />
                    </motion.div>
                  </div>
                  <div className="mt-1.5 flex flex-col items-center text-center">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-500/50">Stock</span>
                    <span className="text-[10px] text-emerald-600/40">{gameState.stock.length} cards</span>
                  </div>
                </div>

                {/* Discard Pile */}
                <div className="cursor-pointer" onClick={() => handleDraw("discard")}>
                  <div className="relative">
                    {topDiscard ? (
                      <motion.div
                        key={`${topDiscard.rank}${topDiscard.suit}`}
                        initial={shouldAnimate && discardAnimating ? { y: 40, opacity: 0, rotate: 5 } : {}}
                        animate={{ y: 0, opacity: 1, rotate: 0 }}
                        transition={shouldAnimate ? { type: "spring", stiffness: 400, damping: 20 } : { duration: 0 }}
                        className={cn("transition-transform", isMyTurn && myPlayer.hand.length === 10 ? "hover:-translate-y-2" : "")}
                      >
                        <PlayingCard suit={topDiscard.suit} rank={topDiscard.rank} fourColor={fourColorDeck} animate={shouldAnimate} className={cn("!w-[80px] !h-[112px] sm:!w-[88px] sm:!h-[124px]", isMyTurn && myPlayer.hand.length === 10 ? "ring-2 ring-amber-400" : "")} />
                      </motion.div>
                    ) : (
                      <div className="w-[80px] h-[112px] sm:w-[88px] sm:h-[124px] rounded-xl border-2 border-dashed border-emerald-700/50 flex items-center justify-center">
                        <span className="text-emerald-600/40 text-xs">Empty</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-col items-center text-center">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-500/50">Discard</span>
                    <span className="text-[10px] text-emerald-600/40">{topDiscard ? "Top card" : "Empty"}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons & Player Info */}
              <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-shrink-0">
                <div className={cn("flex items-center gap-2 bg-[#0a2e1e]/80 border rounded-full pl-2 pr-3 py-1 backdrop-blur-sm transition-colors", isMyTurn ? "border-amber-500/60" : "border-emerald-800/40")}>
                  <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-amber-500 to-amber-400 flex items-center justify-center text-[10px] font-bold text-emerald-950">
                    {myPlayer.name[0]}
                  </div>
                  <span className="text-xs font-bold text-emerald-100">{myPlayer.score}</span>
                  {isMyTurn && !hasDrawn && (
                    <span className="text-[10px] text-amber-400 font-medium ml-1">· Draw</span>
                  )}
                  {isMyTurn && hasDrawn && (
                    <span className="text-[10px] text-emerald-400 font-medium ml-1">· Pick & Act</span>
                  )}
                  {!isMyTurn && (
                    <span className="text-[10px] text-emerald-600/60 font-medium ml-1">· Waiting…</span>
                  )}
                </div>
                {showDeadwoodCount && (
                  <div className={cn(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 border text-xs font-bold backdrop-blur-sm",
                    hasDrawn && selectedCardIndex !== null && currentDeadwood <= 10
                      ? "bg-emerald-900/60 border-emerald-500/50 text-emerald-400"
                      : hasDrawn && selectedCardIndex !== null && currentDeadwood > 10
                      ? "bg-rose-900/30 border-rose-600/40 text-rose-400"
                      : "bg-[#0a2e1e]/60 border-emerald-800/40 text-emerald-300/80"
                  )}>
                    <span className="text-emerald-600/60 font-medium">DW</span>
                    <span>{currentDeadwood}</span>
                  </div>
                )}
                <Button 
                  variant="primary" 
                  onClick={handleDiscard}
                  className="bg-amber-600 hover:bg-amber-500 shadow-[0_0_20px_-5px_rgba(217,119,6,0.5)] px-6 sm:px-8 text-sm text-white" 
                  disabled={!isMyTurn || !hasDrawn || selectedCardIndex === null}
                >
                  Discard
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleKnock}
                  className={cn(
                    "bg-[#0a2e1e]/60 backdrop-blur border-emerald-600/50 text-emerald-400 hover:bg-emerald-900/40 hover:text-emerald-300 text-sm",
                    hasDrawn && selectedCardIndex !== null && currentDeadwood <= 10 && "border-emerald-400 shadow-[0_0_14px_rgba(16,185,129,0.25)]"
                  )}
                  disabled={!isMyTurn || !hasDrawn || selectedCardIndex === null || currentDeadwood > 10}
                >
                  Knock
                </Button>
                {isCustomOrder && (
                  <button
                    onClick={resetToAutoSort}
                    className="w-7 h-7 rounded-full bg-emerald-900/40 hover:bg-emerald-800/50 flex items-center justify-center transition-colors"
                    title="Reset to auto-sort"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-emerald-500/60" />
                  </button>
                )}
              </div>

              {/* Player Hand — 4-row grid (♣ ♦ ♥ ♠), Clubs at vertical center */}
              {/* Subtle felt panel behind hand */}
              <div className="w-full px-4 flex-shrink-0">
                <div style={{ width: HAND_W + 48 }} className="mx-auto rounded-2xl bg-[#0d2b1c]/50 border border-emerald-800/30 px-3 py-2">
                  <div style={{ width: HAND_W + 24 }} className="mx-auto flex flex-col gap-0">
                    {(["♣", "♦", "♥", "♠"] as const).map(suit => {
                      const suitCards = suitRows[suit];
                      return (
                        <div key={suit} className="flex items-center gap-1.5">
                          <span className={cn(
                            "w-6 text-center text-xl font-bold flex-shrink-0 opacity-70",
                            getSuitColor(suit, fourColorDeck, true)
                          )}>
                            {suit}
                          </span>
                          <div className="relative" style={{ width: HAND_W, height: ROW_H }}>
                            {suitCards.length === 0 ? (
                              <div className="h-full flex items-center text-[10px] text-emerald-700/30">—</div>
                            ) : (
                              suitCards.map((card, i) => {
                                const rankIdx = RANK_ORDER[card.rank] ?? 0;
                                const meldIdx = getCardMeldIndex(meldHighlights, card as unknown as EngineCard);
                                const meldColor = meldIdx !== undefined ? getMeldColor(meldIdx) : undefined;
                                return (
                                  <SuitRowCard
                                    key={`${card.rank}${card.suit}`}
                                    suit={card.suit}
                                    rank={card.rank}
                                    selected={selectedCardIndex === card.originalIndex}
                                    onClick={() => {
                                      setSelectedCardIndex(
                                        selectedCardIndex === card.originalIndex ? null : card.originalIndex
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

              {/* Bottom spacer — mirror to keep hand centered */}
              <div className="flex-1" style={{ minHeight: 8 }} />
            </div>
          );
        })()}

        {/* ── Round Over / Showdown ───────────────────────────── */}
        <AnimatePresence>
          {gameState.status === "round_over" && (
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
                <h2 className="text-2xl font-bold text-zinc-100 mb-1">Round Over</h2>
                {showdown && (
                  <>
                    <div className={cn(
                      "inline-flex px-3 py-1 rounded-full text-xs font-bold mb-3",
                      showdown.knockOutcome === "gin"
                        ? "bg-amber-500/20 text-amber-400"
                        : showdown.knockOutcome === "undercut"
                        ? "bg-rose-500/20 text-rose-400"
                        : "bg-emerald-500/20 text-emerald-400"
                    )}>
                      {showdown.knockOutcome === "gin" ? "🔥 GIN" :
                       showdown.knockOutcome === "undercut" ? "⚡ UNDERCUT" :
                       "👊 KNOCK"}
                      {" — "}
                      {showdown.winnerName} wins {showdown.points} pts
                    </div>
                    <div className="space-y-4 mt-4 text-left">
                      {/* Knocker */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-zinc-100">{showdown.knockerName}</span>
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold border",
                            showdown.knockOutcome === "gin"
                              ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                              : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          )}>
                            {showdown.knockOutcome === "gin" ? "GIN" : "KNOCKER"}
                          </span>
                          <span className="text-[10px] text-emerald-600/60 ml-auto">{showDeadwoodCount ? `DW: ${showdown.knockerDW}` : ''}</span>
                        </div>
                        {showdown.knockerMelds.map((meld, mi) => (
                          <div key={mi} className="flex items-center gap-0.5">
                            <span className="text-[9px] text-emerald-500 w-8 flex-shrink-0 font-medium">
                              {meld.every(c => c.rank === meld[0].rank) ? "Set" : "Run"}
                            </span>
                            <div className="flex gap-0.5 flex-wrap">
                              {meld.map((c, ci) => (
                                <ShowdownCardMini key={ci} suit={c.suit} rank={c.rank} highlight="meld" fourColor={fourColorDeck} />
                              ))}
                            </div>
                          </div>
                        ))}
                        {showdown.knockerDeadwood.length > 0 && (
                          <div className="flex items-center gap-0.5">
                            <span className="text-[9px] text-emerald-600/60 w-8 flex-shrink-0 font-medium">DW</span>
                            <div className="flex gap-0.5 flex-wrap">
                              {showdown.knockerDeadwood.map((c, ci) => (
                                <ShowdownCardMini key={ci} suit={c.suit} rank={c.rank} highlight="deadwood" fourColor={fourColorDeck} />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="border-t border-emerald-800/40" />
                      {/* Opponent */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-zinc-100">{showdown.opponentName}</span>
                          <span className="text-[10px] text-emerald-600/60 ml-auto">{showDeadwoodCount ? `DW: ${showdown.opponentDW}` : ''}</span>
                        </div>
                        {showdown.opponentMelds.map((meld, mi) => (
                          <div key={mi} className="flex items-center gap-0.5">
                            <span className="text-[9px] text-emerald-500 w-8 flex-shrink-0 font-medium">
                              {meld.every(c => c.rank === meld[0].rank) ? "Set" : "Run"}
                            </span>
                            <div className="flex gap-0.5 flex-wrap">
                              {meld.map((c, ci) => (
                                <ShowdownCardMini key={ci} suit={c.suit} rank={c.rank} highlight="meld" fourColor={fourColorDeck} />
                              ))}
                            </div>
                          </div>
                        ))}
                        {showdown.laidOffCards.length > 0 && (
                          <div className="flex items-center gap-0.5">
                            <span className="text-[9px] text-amber-500 w-8 flex-shrink-0 font-medium">Laid</span>
                            <div className="flex gap-0.5 flex-wrap">
                              {showdown.laidOffCards.map((c, ci) => (
                                <ShowdownCardMini key={ci} suit={c.suit} rank={c.rank} highlight="layoff" fourColor={fourColorDeck} />
                              ))}
                            </div>
                          </div>
                        )}
                        {showdown.opponentDeadwood.length > 0 && (
                          <div className="flex items-center gap-0.5">
                            <span className="text-[9px] text-zinc-500 w-8 flex-shrink-0 font-medium">DW</span>
                            <div className="flex gap-0.5 flex-wrap">
                              {showdown.opponentDeadwood.map((c, ci) => (
                                <ShowdownCardMini key={ci} suit={c.suit} rank={c.rank} highlight="deadwood" fourColor={fourColorDeck} />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {!showdown && <p className="text-zinc-400 mb-4">{gameState.message}</p>}
                <Button variant="primary" onClick={handleNextRound} className="w-full mt-4">
                  Next Round
                </Button>
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
                    <div className={cn(
                      "inline-flex px-3 py-1 rounded-full text-xs font-bold mb-3",
                      showdown.knockOutcome === "gin"
                        ? "bg-amber-500/20 text-amber-400"
                        : showdown.knockOutcome === "undercut"
                        ? "bg-rose-500/20 text-rose-400"
                        : "bg-emerald-500/20 text-emerald-400"
                    )}>
                      {showdown.knockOutcome === "gin" ? "🔥 GIN" :
                       showdown.knockOutcome === "undercut" ? "⚡ UNDERCUT" :
                       "👊 KNOCK"}
                    </div>
                    <div className="space-y-3 mt-3 text-left">
                      {/* Knocker */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                          {showdown.knockerName}
                          <span className="text-[10px] text-zinc-500 ml-auto font-normal">{showDeadwoodCount ? `DW: ${showdown.knockerDW}` : ''}</span>
                        </div>
                        {showdown.knockerMelds.map((meld, mi) => (
                          <div key={mi} className="flex items-center gap-0.5">
                            <span className="text-[9px] text-emerald-500 w-8 flex-shrink-0 font-medium">
                              {meld.every(c => c.rank === meld[0].rank) ? "Set" : "Run"}
                            </span>
                            <div className="flex gap-0.5 flex-wrap">
                              {meld.map((c, ci) => <ShowdownCardMini key={ci} suit={c.suit} rank={c.rank} highlight="meld" fourColor={fourColorDeck} />)}
                            </div>
                          </div>
                        ))}
                        {showdown.knockerDeadwood.length > 0 && (
                          <div className="flex items-center gap-0.5">
                            <span className="text-[9px] text-zinc-500 w-8 flex-shrink-0 font-medium">DW</span>
                            <div className="flex gap-0.5 flex-wrap">
                              {showdown.knockerDeadwood.map((c, ci) => <ShowdownCardMini key={ci} suit={c.suit} rank={c.rank} highlight="deadwood" fourColor={fourColorDeck} />)}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="border-t border-emerald-800/40" />
                      {/* Opponent */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm font-bold text-zinc-100">
                          {showdown.opponentName}
                          <span className="text-[10px] text-zinc-500 ml-auto font-normal">{showDeadwoodCount ? `DW: ${showdown.opponentDW}` : ''}</span>
                        </div>
                        {showdown.opponentMelds.map((meld, mi) => (
                          <div key={mi} className="flex items-center gap-0.5">
                            <span className="text-[9px] text-emerald-500 w-8 flex-shrink-0 font-medium">
                              {meld.every(c => c.rank === meld[0].rank) ? "Set" : "Run"}
                            </span>
                            <div className="flex gap-0.5 flex-wrap">
                              {meld.map((c, ci) => <ShowdownCardMini key={ci} suit={c.suit} rank={c.rank} highlight="meld" fourColor={fourColorDeck} />)}
                            </div>
                          </div>
                        ))}
                        {showdown.laidOffCards.length > 0 && (
                          <div className="flex items-center gap-0.5">
                            <span className="text-[9px] text-amber-500 w-8 flex-shrink-0 font-medium">Laid</span>
                            <div className="flex gap-0.5 flex-wrap">
                              {showdown.laidOffCards.map((c, ci) => <ShowdownCardMini key={ci} suit={c.suit} rank={c.rank} highlight="layoff" fourColor={fourColorDeck} />)}
                            </div>
                          </div>
                        )}
                        {showdown.opponentDeadwood.length > 0 && (
                          <div className="flex items-center gap-0.5">
                            <span className="text-[9px] text-zinc-500 w-8 flex-shrink-0 font-medium">DW</span>
                            <div className="flex gap-0.5 flex-wrap">
                              {showdown.opponentDeadwood.map((c, ci) => <ShowdownCardMini key={ci} suit={c.suit} rank={c.rank} highlight="deadwood" fourColor={fourColorDeck} />)}
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
                    <div className="text-2xl font-bold font-mono text-white">{myPlayer.score}</div>
                  </div>
                  <div className="border-l border-emerald-800/40" />
                  <div>
                    <div className="text-zinc-500">{opponent.name}</div>
                    <div className="text-2xl font-bold font-mono text-white">{opponent.score}</div>
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
      </main>
    </div>
  );
}
