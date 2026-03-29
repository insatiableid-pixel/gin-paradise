/**
 * Shared Card Visual System for Gin Paradise
 *
 * Single source of truth for all card renderers across the application:
 * - PlayingCard (standalone, e.g. discard pile)
 * - SuitRowCard (4-row hand layout)
 * - OverlappingCard (legacy overlapping hand)
 * - CardBack (burgundy & gold branded back)
 * - ShowdownCardMini (showdown overlay mini cards)
 * - SpectatorCard (spectator view discard pile)
 * - MiniCard (spectator showdown)
 *
 * Design language: Emerald felt table, warm gold accents,
 * burgundy/gold branded card backs, big-index card fronts.
 */

import React from "react";
import { cn } from "@/src/lib/utils";
import { getSuitColor } from "@/src/lib/preferences";
import { motion } from "motion/react";
import { prefersReducedMotion } from "@/src/lib/audio";

// ── Suit color accent bar helper ──────────────────────────────────────
export const getSuitAccentColor = (suit: string, fourColor?: boolean): string => {
  if (suit === '♥') return '#dc2626';
  if (suit === '♦') return fourColor ? '#2563eb' : '#dc2626';
  if (suit === '♣') return fourColor ? '#16a34a' : '#1a1a2e';
  if (suit === '♠') return '#1a1a2e';
  return '#1a1a2e';
};

// ── PlayingCard (standalone, for discard pile) ────────────────────────
export const PlayingCard: React.FC<{
  suit: string;
  rank: string;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  fourColor?: boolean;
  animate?: boolean;
}> = ({ suit, rank, active, onClick, className, style, fourColor = false, animate = true }) => {
  const colorCls = getSuitColor(suit, fourColor);
  const accentColor = getSuitAccentColor(suit, fourColor);
  return (
    <motion.div
      whileHover={animate ? { y: -10 } : {}}
      animate={animate ? { y: active ? -20 : 0 } : {}}
      onClick={onClick}
      style={style}
      className={cn(
        "relative w-[72px] h-[100px] sm:w-[80px] sm:h-[110px] rounded-xl bg-white shadow-lg border border-zinc-200 cursor-pointer select-none transition-shadow hover:shadow-xl overflow-hidden",
        active && "ring-2 ring-amber-400 shadow-amber-500/20",
        className
      )}
    >
      {/* Left accent stripe */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: accentColor }} />
      {/* Large centered rank + suit */}
      <div className={cn("absolute inset-0 flex flex-col items-center justify-center", colorCls)}>
        <span className="text-2xl sm:text-3xl font-black leading-none">{rank}</span>
        <span className="text-lg sm:text-xl leading-none -mt-0.5">{suit}</span>
      </div>
      {/* Subtle corner index top-left */}
      <div className={cn("absolute top-1 left-2 flex flex-col items-center leading-none opacity-40", colorCls)}>
        <span className="text-[9px] font-bold">{rank}</span>
        <span className="text-[8px] -mt-0.5">{suit}</span>
      </div>
      {/* Corner index bottom-right */}
      <div className={cn("absolute bottom-1 right-1.5 flex flex-col items-center leading-none rotate-180 opacity-40", colorCls)}>
        <span className="text-[9px] font-bold">{rank}</span>
        <span className="text-[8px] -mt-0.5">{suit}</span>
      </div>
    </motion.div>
  );
};

// ── OverlappingCard (for hand display) ────────────────────────────────
export const OverlappingCard: React.FC<{
  suit: string;
  rank: string;
  selected: boolean;
  onClick: () => void;
  index: number;
  isMyTurn: boolean;
  hasDrawn: boolean;
  fourColor?: boolean;
  meldColorCls?: string;
  isDragging?: boolean;
  isDragOver?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerEnter?: () => void;
  animationsEnabled?: boolean;
}> = ({ suit, rank, selected, onClick, index, isMyTurn, hasDrawn, fourColor = false, meldColorCls, isDragging, isDragOver, onPointerDown, onPointerEnter, animationsEnabled = true }) => {
  const colorCls = getSuitColor(suit, fourColor);
  const accentColor = getSuitAccentColor(suit, fourColor);
  const overlapPx = 38;
  const cardWidth = 72;

  const reducedMotion = prefersReducedMotion();
  const shouldAnimate = animationsEnabled && !reducedMotion;

  return (
    <motion.div
      initial={shouldAnimate ? { y: 20, opacity: 0 } : { opacity: 1 }}
      animate={shouldAnimate ? {
        y: selected ? -16 : 0,
        opacity: 1,
        scale: selected ? 1.05 : isDragOver ? 1.02 : 1,
      } : {
        y: selected ? -16 : 0,
        opacity: 1,
      }}
      whileHover={shouldAnimate && isMyTurn && hasDrawn ? { y: -10, scale: 1.04 } : {}}
      transition={shouldAnimate ? { type: "spring", stiffness: 400, damping: 25 } : { duration: 0.1 }}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      style={{
        position: "absolute",
        left: index * overlapPx,
        zIndex: isDragging ? 200 : selected ? 100 : index,
        width: cardWidth,
        touchAction: "none",
      }}
      className={cn(
        "h-[100px] sm:h-[110px] rounded-xl border-2 cursor-pointer select-none transition-shadow overflow-hidden",
        selected
          ? "ring-2 ring-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.4)] border-amber-300 z-50"
          : isDragging
          ? "ring-2 ring-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.4)] border-amber-400 opacity-90"
          : isDragOver
          ? "border-amber-300/60"
          : "border-zinc-200/90 shadow-md hover:shadow-lg",
        "bg-white",
      )}
    >
      {/* Left accent stripe */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: accentColor }} />
      {/* Large rank + suit — left-aligned so visible when overlapped */}
      <div className={cn("absolute top-2.5 left-3 flex flex-col items-start leading-none", colorCls)}>
        <span className="text-lg font-black">{rank}</span>
        <span className="text-sm -mt-0.5">{suit}</span>
      </div>
      {/* Watermark */}
      <div className={cn("absolute bottom-1 right-1.5 opacity-[0.08]", colorCls)}>
        <span className="text-3xl">{suit}</span>
      </div>
    </motion.div>
  );
};

// ── Card Back — Burgundy & Gold with Gin Paradise branding ──────────
export const CardBack: React.FC<{ className?: string; mini?: boolean }> = ({ className, mini = false }) => {
  return (
    <div className={cn(
      "rounded-xl overflow-hidden",
      className
    )} style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)' }}>
      {/* Gold card edge */}
      <div className="w-full h-full rounded-xl p-[2px]" style={{ background: 'linear-gradient(135deg, #d4a843, #b8860b, #d4a843)' }}>
        {/* Tropical card back image */}
        <div
          className="w-full h-full rounded-[10px] relative overflow-hidden"
          style={{
            backgroundImage: 'url(/assets/card-back.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {/* Subtle inner glow for depth */}
          <div className="absolute inset-0 rounded-[10px]" style={{ boxShadow: 'inset 0 0 6px rgba(0,0,0,0.2)' }} />
        </div>
      </div>
    </div>
  );
};

// ── ShowdownCardMini — small card for showdown display ───────────────
export const ShowdownCardMini: React.FC<{
  suit: string;
  rank: string;
  highlight?: "meld" | "layoff" | "deadwood";
  fourColor?: boolean;
}> = ({ suit, rank, highlight, fourColor = false }) => {
  const colorCls = getSuitColor(suit, fourColor);
  const accentColor = getSuitAccentColor(suit, fourColor);
  return (
    <div
      className={cn(
        "relative w-11 h-[60px] rounded-lg border flex flex-col items-center justify-center text-xs font-bold flex-shrink-0 transition-colors overflow-hidden",
        highlight === "meld" && "bg-emerald-50 border-emerald-300 shadow-sm",
        highlight === "layoff" && "bg-amber-50 border-amber-300 shadow-sm",
        highlight === "deadwood" && "bg-zinc-100 border-zinc-300 opacity-70",
        !highlight && "bg-white border-zinc-200",
        colorCls
      )}
    >
      {/* Accent stripe for consistency */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ backgroundColor: accentColor }} />
      <span className="leading-none">{rank}</span>
      <span className="text-[10px] leading-none">{suit}</span>
    </div>
  );
};

// ── SuitRowCard for 4-row hand layout ────────────────────────────────
export const SuitRowCard: React.FC<{
  suit: string;
  rank: string;
  selected: boolean;
  onClick: () => void;
  leftPx: number;
  zIdx: number;
  isMyTurn: boolean;
  hasDrawn: boolean;
  fourColor?: boolean;
  meldColorCls?: string;
  animationsEnabled?: boolean;
}> = ({ suit, rank, selected, onClick, leftPx, zIdx, isMyTurn, hasDrawn, fourColor = false, meldColorCls, animationsEnabled = true }) => {
  const colorCls = getSuitColor(suit, fourColor);
  const accentColor = getSuitAccentColor(suit, fourColor);
  const suitCardW = 78;

  const reducedMotion = prefersReducedMotion();
  const shouldAnim = animationsEnabled && !reducedMotion;

  return (
    <motion.div
      animate={shouldAnim ? {
        y: selected ? -10 : 0,
        scale: selected ? 1.05 : 1,
        opacity: 1,
      } : {
        y: selected ? -10 : 0,
        opacity: 1,
      }}
      whileHover={shouldAnim && isMyTurn && hasDrawn ? { y: -6, scale: 1.03 } : {}}
      transition={shouldAnim ? { type: "spring", stiffness: 400, damping: 25 } : { duration: 0.1 }}
      onClick={onClick}
      style={{
        position: "absolute",
        left: leftPx,
        zIndex: selected ? 100 : zIdx,
        width: suitCardW,
        touchAction: "none",
      }}
      className={cn(
        "h-[88px] sm:h-[94px] rounded-xl border-2 cursor-pointer select-none transition-shadow overflow-hidden",
        selected
          ? "ring-2 ring-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.4)] border-amber-300 z-50"
          : "border-zinc-300/80 shadow-sm hover:shadow-[0_2px_12px_rgba(245,158,11,0.15)]",
        "bg-white",
      )}
    >
      {/* Left accent stripe for instant suit-color scanning */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ backgroundColor: accentColor }} />
      
      {/* Large rank + suit — left-aligned so always visible when overlapped */}
      <div className={cn("absolute top-2 left-2.5 flex flex-col items-start leading-none", colorCls)}>
        <span className="text-xl font-black">{rank}</span>
        <span className="text-base -mt-0.5">{suit}</span>
      </div>
      
      {/* Large faded suit watermark on right side — visible on exposed cards */}
      <div className={cn("absolute bottom-1 right-1.5 opacity-[0.08]", colorCls)}>
        <span className="text-4xl">{suit}</span>
      </div>
    </motion.div>
  );
};

// ── SpectatorCard (for spectator discard pile display) ────────────────
export const SpectatorCard: React.FC<{
  suit: string;
  rank: string;
  fourColor?: boolean;
}> = ({ suit, rank, fourColor = false }) => {
  const colorCls = getSuitColor(suit, fourColor);
  const accentColor = getSuitAccentColor(suit, fourColor);
  return (
    <div className={cn(
      "relative w-16 h-24 sm:w-20 sm:h-28 rounded-lg bg-white shadow-lg border border-zinc-200 overflow-hidden",
    )}>
      {/* Left accent stripe */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: accentColor }} />
      {/* Centered rank + suit */}
      <div className={cn("absolute inset-0 flex flex-col items-center justify-center", colorCls)}>
        <span className="text-xl sm:text-2xl font-black leading-none">{rank}</span>
        <span className="text-base sm:text-lg leading-none -mt-0.5">{suit}</span>
      </div>
      {/* Corner index */}
      <div className={cn("absolute top-1 left-2.5 flex flex-col items-center leading-none opacity-40", colorCls)}>
        <span className="text-[9px] font-bold">{rank}</span>
        <span className="text-[8px] -mt-0.5">{suit}</span>
      </div>
    </div>
  );
};

// ── MiniCard (spectator showdown) ────────────────────────────────────
export const MiniCard: React.FC<{
  suit: string;
  rank: string;
  highlight?: "meld" | "deadwood" | "layoff";
  fourColor?: boolean;
}> = ({ suit, rank, highlight, fourColor = false }) => {
  const colorCls = getSuitColor(suit, fourColor);
  const accentColor = getSuitAccentColor(suit, fourColor);
  return (
    <div className={cn(
      "relative w-7 h-10 rounded border flex flex-col items-center justify-center text-[9px] font-bold flex-shrink-0 overflow-hidden",
      highlight === "meld" && "bg-emerald-50 border-emerald-300",
      highlight === "deadwood" && "bg-zinc-100 border-zinc-300 opacity-70",
      highlight === "layoff" && "bg-amber-50 border-amber-300",
      !highlight && "bg-white border-zinc-200",
      colorCls
    )}>
      {/* Tiny accent stripe */}
      <div className="absolute left-0 top-0 bottom-0 w-[1.5px]" style={{ backgroundColor: accentColor }} />
      <span className="leading-none">{rank}</span>
      <span className="text-[7px] leading-none">{suit}</span>
    </div>
  );
};

// ── Common layout constants ──────────────────────────────────────────
export const CARD_OVERLAP_PX = 38;
export const CARD_WIDTH = 72;

// ── Shared table surface background ─────────────────────────────────
export const TABLE_BG_CLASSES = "bg-[#0a1f15]";
export const TABLE_FELT_GRADIENT = "bg-[radial-gradient(ellipse_80%_70%_at_50%_50%,_#0f3d2a_0%,_#0a2e1e_40%,_#061a11_75%,_#030d08_100%)]";
export const TABLE_NOISE_STYLE: React.CSSProperties = {
  backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%270 0 256 256%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%274%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")',
  backgroundSize: '128px 128px',
};

// ── Showdown overlay theme constants ─────────────────────────────────
export const SHOWDOWN_OVERLAY_BG = "bg-[#030d08]/90";
export const SHOWDOWN_PANEL_BG = "bg-[#0d1a12]";
export const SHOWDOWN_PANEL_BORDER = "border-emerald-800/50";
