/**
 * SpectatorView — Live read-only match spectator page.
 *
 * Renders a clean spectator board showing:
 *  - Player names and scores
 *  - Whose turn it is
 *  - Card counts (not actual cards)
 *  - Top discard card
 *  - Stock/discard pile counts
 *  - Round/match progression
 *  - Showdown data at round_over/game_over
 *  - Read-only badge
 *
 * NEVER displays hidden information (either player's cards) during live play.
 */

import React from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Radio,
  Users,
  RotateCcw,
  Crown,
  Swords,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useSpectator } from "@/src/lib/useSpectator";
import { usePreferences, getSuitColor } from "@/src/lib/preferences";
import type { SpectatorGameViewWire, ShowdownData, ShowdownPlayerData, CardView } from "../../server/multiplayer/types";
import { SpectatorCard, MiniCard, TABLE_FELT_GRADIENT, TABLE_NOISE_STYLE } from "@/src/components/cards";

export function SpectatorView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const roomId = searchParams.get("watch");
  const { phase, gameView, matchOverMessage, error, spectatorCount, disconnect } = useSpectator(roomId);
  const { fourColorDeck } = usePreferences();

  if (!roomId) {
    return (
      <div className="fixed inset-0 bg-[#0a1f15] flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-emerald-400/60">No match specified</p>
          <Link to="/live" className="text-amber-400 hover:text-amber-300 text-sm">
            Browse live matches
          </Link>
        </div>
      </div>
    );
  }

  // Loading state
  if (phase === "connecting") {
    return (
      <div className="fixed inset-0 bg-[#0a1f15] flex flex-col">
        <SpectatorHeader onBack={() => navigate("/live")} spectatorCount={0} roomId={roomId} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-amber-400 mx-auto" />
            <p className="text-emerald-400/60">Connecting to match...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (phase === "error") {
    return (
      <div className="fixed inset-0 bg-[#0a1f15] flex flex-col">
        <SpectatorHeader onBack={() => navigate("/live")} spectatorCount={0} roomId={roomId} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-md">
            <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto" />
            <p className="text-amber-400 font-medium">{error}</p>
            <div className="flex gap-3 justify-center">
              <Link
                to="/live"
                className="px-4 py-2 rounded-lg bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-300 text-sm border border-emerald-700/50"
              >
                Browse Matches
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Match over state
  if (phase === "match_over") {
    return (
      <div className="fixed inset-0 bg-[#0a1f15] flex flex-col">
        <SpectatorHeader onBack={() => navigate("/live")} spectatorCount={spectatorCount} roomId={roomId} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-md">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto">
              <Crown className="h-8 w-8 text-amber-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Match Ended</h2>
            {gameView && (
              <div className="flex items-center justify-center gap-4 text-lg">
                <span className="text-white font-bold">{gameView.player1Username}</span>
                <span className="text-2xl font-black text-emerald-400">{gameView.player1Score}</span>
                <span className="text-emerald-700">—</span>
                <span className="text-2xl font-black text-emerald-400">{gameView.player2Score}</span>
                <span className="text-white font-bold">{gameView.player2Username}</span>
              </div>
            )}
            <p className="text-emerald-500/50 text-sm">{matchOverMessage}</p>
            <Link
              to="/live"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 text-white font-semibold text-sm shadow-[0_0_20px_-8px_rgba(217,119,6,0.5)]"
            >
              <Eye size={16} />
              Watch Another Match
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Watching state — main spectator view
  if (!gameView) {
    return (
      <div className="fixed inset-0 bg-[#0a1f15] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#0a1f15] flex flex-col font-sans">
      <SpectatorHeader onBack={() => { disconnect(); navigate("/live"); }} spectatorCount={spectatorCount} roomId={roomId} />

      <main className="flex-1 flex flex-col items-center justify-center gap-6 p-4 overflow-hidden relative">
        {/* Felt table background */}
        <div className={cn("absolute inset-0 pointer-events-none", TABLE_FELT_GRADIENT)} />
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={TABLE_NOISE_STYLE} />
        
        {/* Score Board */}
        <div className="flex items-center gap-8 relative z-10">
          <PlayerScore
            username={gameView.player1Username}
            score={gameView.player1Score}
            cardCount={gameView.player1CardCount}
            isCurrentTurn={gameView.currentTurnUsername === gameView.player1Username}
          />
          <div className="flex flex-col items-center gap-1">
            <Swords className="h-5 w-5 text-emerald-700" />
            <span className="text-[10px] text-emerald-600/40">Round {gameView.roundNumber}</span>
          </div>
          <PlayerScore
            username={gameView.player2Username}
            score={gameView.player2Score}
            cardCount={gameView.player2CardCount}
            isCurrentTurn={gameView.currentTurnUsername === gameView.player2Username}
          />
        </div>

        {/* Game Board */}
        <div className="relative w-full max-w-lg z-10">
          <div className="rounded-2xl bg-[#0a2e1e]/60 border border-emerald-800/30 p-6 sm:p-10">
            {/* Table center — stock and discard */}
            <div className="flex items-center justify-center gap-6 sm:gap-10">
              {/* Stock Pile */}
              <div className="flex flex-col items-center gap-2">
                <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-lg bg-gradient-to-br from-[#5c1a2f] to-[#3d1020] border-2 border-[#d4a843]/40 shadow-lg flex items-center justify-center">
                  <div className="text-[#d4a843]/30 text-3xl font-black" style={{ fontFamily: 'Georgia, serif' }}>G</div>
                </div>
                <span className="text-[10px] text-emerald-500/50">{gameView.stockCount} cards</span>
              </div>

              {/* Discard Pile */}
              <div className="flex flex-col items-center gap-2">
                {gameView.topDiscard ? (
                  <SpectatorCard suit={gameView.topDiscard.suit} rank={gameView.topDiscard.rank} fourColor={fourColorDeck} />
                ) : (
                  <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-lg border-2 border-dashed border-emerald-800/40 flex items-center justify-center">
                    <span className="text-xs text-emerald-700/40">Empty</span>
                  </div>
                )}
                <span className="text-[10px] text-emerald-500/50">{gameView.discardCount} discarded</span>
              </div>
            </div>

            {/* Status message */}
            <div className="mt-4 text-center">
              <p className="text-sm text-zinc-300">{gameView.message}</p>
            </div>
          </div>
        </div>

        {/* Showdown Data (at round_over/game_over) */}
        {gameView.showdown && (gameView.status === "round_over" || gameView.status === "game_over") && (
          <div className="relative z-10">
            <SpectatorShowdown showdown={gameView.showdown} fourColor={fourColorDeck} />
          </div>
        )}

        {/* Stake Info */}
        {gameView.stakeInfo && gameView.stakeInfo.prizePool > 0 && (
          <div className="flex items-center gap-2 text-xs text-emerald-500/50 relative z-10">
            <Crown size={12} className="text-amber-400" />
            <span>Prize Pool: {gameView.stakeInfo.prizePool.toLocaleString()} Coins</span>
          </div>
        )}

        {/* Hidden Info Indicator */}
        <div className="flex items-center gap-2 text-[11px] text-emerald-600/40 bg-[#0a2e1e]/50 border border-emerald-800/30 px-3 py-1.5 rounded-full relative z-10">
          <EyeOff size={12} />
          <span>Player hands are hidden • Read-only mode</span>
        </div>
      </main>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function SpectatorHeader({
  onBack,
  spectatorCount,
  roomId,
}: {
  onBack: () => void;
  spectatorCount: number;
  roomId: string;
}) {
  return (
    <header className="h-14 border-b border-emerald-900/40 bg-[#0d1a12]/90 backdrop-blur flex items-center justify-between px-4 z-10">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="text-emerald-700 hover:text-emerald-300 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </div>
          <span className="text-sm font-medium text-emerald-400/70">Spectating</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">LIVE</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-emerald-500/50">
          <Users size={12} />
          <span>{spectatorCount} watching</span>
        </div>
        <span className="text-[10px] text-emerald-600/40 font-mono">{roomId}</span>
      </div>
    </header>
  );
}

function PlayerScore({
  username,
  score,
  cardCount,
  isCurrentTurn,
}: {
  username: string;
  score: number;
  cardCount: number;
  isCurrentTurn: boolean;
}) {
  return (
    <div className={cn(
      "flex flex-col items-center gap-1.5 px-6 py-3 rounded-xl border transition-colors",
      isCurrentTurn
        ? "bg-emerald-500/10 border-emerald-500/30"
        : "bg-[#0a2e1e]/40 border-emerald-800/30"
    )}>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-xs font-bold text-white">
          {username[0]?.toUpperCase()}
        </div>
        <span className="text-sm font-bold text-white">{username}</span>
      </div>
      <span className="text-2xl font-black text-emerald-400 tabular-nums">{score}</span>
      <div className="flex items-center gap-1 text-[10px] text-zinc-500">
        <span>{cardCount} cards</span>
        {isCurrentTurn && (
          <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">TURN</span>
        )}
      </div>
    </div>
  );
}

// SpectatorCard and MiniCard are now imported from @/src/components/cards

/** Showdown display for spectators — shows revealed hands at end of round */
function SpectatorShowdown({
  showdown,
  fourColor = false,
}: {
  showdown: ShowdownData;
  fourColor?: boolean;
}) {
  return (
    <div className="w-full max-w-lg rounded-xl bg-[#0a2e1e]/60 border border-emerald-800/30 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-400">
        <Crown size={14} />
        <span>
          {showdown.knockOutcome === "gin" ? "GIN!" :
           showdown.knockOutcome === "undercut" ? "UNDERCUT!" :
           "Knock!"}
          {" "}— {showdown.roundPoints} points
        </span>
      </div>

      {/* Knocker */}
      <SpectatorShowdownPlayer data={showdown.knocker} isKnocker={true} fourColor={fourColor} />

      {/* Opponent */}
      <SpectatorShowdownPlayer data={showdown.opponent} isKnocker={false} fourColor={fourColor} />
    </div>
  );
}

function SpectatorShowdownPlayer({
  data,
  isKnocker,
  fourColor = false,
}: {
  data: ShowdownPlayerData;
  isKnocker: boolean;
  fourColor?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-bold text-zinc-200">{data.username}</span>
        {isKnocker && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            KNOCKER
          </span>
        )}
        <span className="text-emerald-600/60 ml-auto">DW: {data.deadwoodValue}</span>
      </div>

      {/* Melds */}
      {data.melds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.melds.map((meld, mi) => (
            <div key={mi} className="flex gap-0.5 p-1 rounded bg-emerald-500/10 border border-emerald-500/20">
              {meld.cards.map((c, ci) => (
                <MiniCard key={ci} suit={c.suit} rank={c.rank} highlight="meld" fourColor={fourColor} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Deadwood */}
      {data.deadwood.length > 0 && (
        <div className="flex gap-0.5 flex-wrap">
          {data.deadwood.map((c, ci) => (
            <MiniCard key={ci} suit={c.suit} rank={c.rank} highlight="deadwood" fourColor={fourColor} />
          ))}
        </div>
      )}
    </div>
  );
}

// MiniCard is now imported from @/src/components/cards
