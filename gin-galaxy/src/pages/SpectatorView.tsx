/**
 * SpectatorView — Live read-only match spectator page.
 *
 * Renders a privacy-safe broadcast surface for live matches.
 * Hidden player information stays hidden until showdown.
 */

import React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Coins,
  Crown,
  Eye,
  EyeOff,
  Loader2,
  Radio,
  Sparkles,
  Swords,
  Users,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useSpectator } from "@/src/lib/useSpectator";
import { usePreferences } from "@/src/lib/preferences";
import type { ShowdownData, ShowdownPlayerData } from "../../server/multiplayer/types";
import { MiniCard, SpectatorCard, TABLE_FELT_GRADIENT, TABLE_NOISE_STYLE } from "@/src/components/cards";

const DISPLAY_FONT = '"Fraunces", ui-serif, Georgia, serif';

function formatMatchStatus(status: "playing" | "round_over" | "game_over"): string {
  if (status === "round_over") return "Round Over";
  if (status === "game_over") return "Match Final";
  return "Live Play";
}

export function SpectatorView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const roomId = searchParams.get("watch");
  const { phase, gameView, matchOverMessage, error, spectatorCount, disconnect } = useSpectator(roomId);
  const { fourColorDeck } = usePreferences();

  if (!roomId) {
    return (
      <div className="fixed inset-0 bg-[#07160f] flex items-center justify-center">
        <div className="text-center space-y-4 px-6">
          <p className="text-emerald-300/70">No live table was specified.</p>
          <Link
            to="/live"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-700/40 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-200 transition-colors hover:bg-emerald-900/50"
          >
            <Eye size={15} />
            Browse live matches
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "connecting") {
    return (
      <div className="fixed inset-0 bg-[#07160f] flex flex-col">
        <SpectatorHeader onBack={() => navigate("/live")} spectatorCount={0} roomId={roomId} />
        <div className="relative flex-1 flex items-center justify-center overflow-hidden">
          <div className={cn("absolute inset-0 pointer-events-none", TABLE_FELT_GRADIENT)} />
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={TABLE_NOISE_STYLE} />
          <div className="relative z-10 rounded-[28px] border border-emerald-700/25 bg-[#08140f]/85 px-8 py-10 text-center shadow-[0_30px_80px_-36px_rgba(0,0,0,0.8)] backdrop-blur-xl">
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-amber-400" />
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: DISPLAY_FONT }}>
              Tuning into the table
            </h2>
            <p className="mt-2 text-sm text-emerald-200/65">Connecting to the live broadcast feed…</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="fixed inset-0 bg-[#07160f] flex flex-col">
        <SpectatorHeader onBack={() => navigate("/live")} spectatorCount={0} roomId={roomId} />
        <div className="relative flex-1 flex items-center justify-center overflow-hidden p-4">
          <div className={cn("absolute inset-0 pointer-events-none", TABLE_FELT_GRADIENT)} />
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={TABLE_NOISE_STYLE} />
          <div className="relative z-10 w-full max-w-lg rounded-[30px] border border-amber-500/20 bg-[#08140f]/88 p-8 text-center shadow-[0_30px_80px_-36px_rgba(0,0,0,0.8)] backdrop-blur-xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/10">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
            </div>
            <h2 className="mt-5 text-2xl font-bold text-white" style={{ fontFamily: DISPLAY_FONT }}>
              Broadcast unavailable
            </h2>
            <p className="mt-3 text-sm text-amber-200/80">{error}</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/live"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-700/40 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-100 transition-colors hover:bg-emerald-900/50"
              >
                <Eye size={15} />
                Browse matches
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "match_over") {
    return (
      <div className="fixed inset-0 bg-[#07160f] flex flex-col">
        <SpectatorHeader onBack={() => navigate("/live")} spectatorCount={spectatorCount} roomId={roomId} />
        <div className="relative flex-1 flex items-center justify-center overflow-hidden p-4">
          <div className={cn("absolute inset-0 pointer-events-none", TABLE_FELT_GRADIENT)} />
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={TABLE_NOISE_STYLE} />
          <div className="relative z-10 w-full max-w-2xl rounded-[30px] border border-amber-500/20 bg-[#08140f]/88 p-8 text-center shadow-[0_30px_80px_-36px_rgba(0,0,0,0.8)] backdrop-blur-xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/25 bg-amber-500/10">
              <Crown className="h-8 w-8 text-amber-400" />
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <SpectatorChip tone="rose" icon={<Radio size={12} />} label="Table closed" />
              <SpectatorChip tone="emerald" icon={<Eye size={12} />} label={`Room ${roomId}`} />
            </div>
            <h2 className="mt-4 text-3xl font-bold text-white" style={{ fontFamily: DISPLAY_FONT }}>
              Match finished
            </h2>
            {gameView && (
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <PlayerPod
                  username={gameView.player1Username}
                  score={gameView.player1Score}
                  cardCount={gameView.player1CardCount}
                  isCurrentTurn={false}
                  seatLabel="Seat One"
                />
                <PlayerPod
                  username={gameView.player2Username}
                  score={gameView.player2Score}
                  cardCount={gameView.player2CardCount}
                  isCurrentTurn={false}
                  seatLabel="Seat Two"
                />
              </div>
            )}
            <p className="mt-5 text-sm text-emerald-200/65">{matchOverMessage}</p>
            <Link
              to="/live"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-600 to-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_28px_-10px_rgba(217,119,6,0.55)]"
            >
              <Eye size={15} />
              Watch another match
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!gameView) {
    return (
      <div className="fixed inset-0 bg-[#07160f] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  const matchStatusLabel = formatMatchStatus(gameView.status);
  const tableTone = gameView.status === "playing" ? "emerald" : gameView.status === "round_over" ? "amber" : "rose";
  const featuredLabel = gameView.isAdminFeatured ? "Featured Table" : "Live Table";
  const currentTurnLabel = gameView.currentTurnUsername ? `${gameView.currentTurnUsername} to act` : "Awaiting action";

  return (
    <div className="fixed inset-0 bg-[#07160f] flex flex-col font-sans overflow-hidden">
      <SpectatorHeader
        onBack={() => {
          disconnect();
          navigate("/live");
        }}
        spectatorCount={spectatorCount}
        roomId={roomId}
      />

      <main className="relative flex-1 overflow-y-auto">
        <div className={cn("absolute inset-0 pointer-events-none", TABLE_FELT_GRADIENT)} />
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={TABLE_NOISE_STYLE} />

        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6">
          <section className="rounded-[30px] border border-emerald-700/25 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_34%),linear-gradient(180deg,rgba(7,23,16,0.96),rgba(6,18,13,0.88))] p-5 shadow-[0_34px_80px_-42px_rgba(0,0,0,0.85)] backdrop-blur-xl sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <SpectatorChip tone="rose" icon={<Radio size={12} />} label="Live broadcast" />
              <SpectatorChip tone="emerald" icon={<Sparkles size={12} />} label={featuredLabel} />
              <SpectatorChip tone={tableTone} icon={<Swords size={12} />} label={matchStatusLabel} />
              {gameView.stakeInfo && gameView.stakeInfo.prizePool > 0 ? (
                <SpectatorChip
                  tone="amber"
                  icon={<Coins size={12} />}
                  label={`${gameView.stakeInfo.prizePool.toLocaleString()} coin prize`}
                />
              ) : (
                <SpectatorChip tone="emerald" icon={<Eye size={12} />} label="Practice table" />
              )}
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(250px,0.65fr)]">
              <div className="space-y-3">
                <p className="text-[10px] uppercase tracking-[0.38em] text-emerald-400/45">Broadcast Deck</p>
                <div>
                  <h1
                    className="text-3xl font-bold leading-none text-white sm:text-4xl"
                    style={{ fontFamily: DISPLAY_FONT }}
                  >
                    {gameView.player1Username} vs {gameView.player2Username}
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm text-emerald-100/68">{gameView.message}</p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                <MatchDetailCard title="Current turn" value={currentTurnLabel} tone={tableTone} />
                <MatchDetailCard title="Round" value={`Round ${gameView.roundNumber}`} tone="emerald" />
                <MatchDetailCard title="Room code" value={roomId} tone="emerald" mono />
                <MatchDetailCard title="Audience" value={`${spectatorCount} watching`} tone="emerald" />
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(220px,1fr)_minmax(340px,1.2fr)_minmax(220px,1fr)]">
            <PlayerPod
              username={gameView.player1Username}
              score={gameView.player1Score}
              cardCount={gameView.player1CardCount}
              isCurrentTurn={gameView.currentTurnUsername === gameView.player1Username}
              seatLabel="Seat One"
            />

            <div className="rounded-[32px] border border-emerald-700/25 bg-[#08140f]/86 p-5 shadow-[0_28px_70px_-42px_rgba(0,0,0,0.85)] backdrop-blur-xl sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
                    <Swords className="h-5 w-5 text-emerald-300" />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.32em] text-emerald-500/45">Table center</p>
                    <p className="text-sm font-semibold text-zinc-100">{matchStatusLabel}</p>
                  </div>
                </div>

                <SpectatorChip
                  tone={gameView.currentTurnUsername ? tableTone : "emerald"}
                  icon={<Crown size={12} />}
                  label={currentTurnLabel}
                />
              </div>

              <div className="mt-6 rounded-[28px] border border-emerald-700/20 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.14),transparent_45%),linear-gradient(180deg,rgba(10,46,30,0.82),rgba(8,30,21,0.86))] p-5 sm:p-6">
                <div className="flex items-center justify-center gap-5 sm:gap-10">
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex h-28 w-20 items-center justify-center rounded-[18px] border border-amber-500/20 bg-gradient-to-br from-[#5d1e32] via-[#421424] to-[#2d0f19] shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)] sm:h-32 sm:w-24">
                      <span
                        className="text-3xl font-black tracking-[0.08em] text-[#d7b15a]/30"
                        style={{ fontFamily: DISPLAY_FONT }}
                      >
                        G
                      </span>
                    </div>
                    <span className="text-[11px] font-medium text-emerald-100/70">Stock</span>
                    <span className="text-[10px] text-emerald-400/55">{gameView.stockCount} live</span>
                  </div>

                  <div className="flex flex-col items-center gap-2">
                    {gameView.topDiscard ? (
                      <SpectatorCard suit={gameView.topDiscard.suit} rank={gameView.topDiscard.rank} fourColor={fourColorDeck} />
                    ) : (
                      <div className="flex h-28 w-20 items-center justify-center rounded-[18px] border border-dashed border-emerald-700/30 bg-black/10 sm:h-32 sm:w-24">
                        <span className="text-xs text-emerald-400/35">Empty</span>
                      </div>
                    )}
                    <span className="text-[11px] font-medium text-emerald-100/70">Discard</span>
                    <span className="text-[10px] text-emerald-400/55">{gameView.discardCount} spent</span>
                  </div>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-3">
                  <MatchDetailCard title="Traffic" value={`${gameView.discardCount} seen`} tone="emerald" compact />
                  <MatchDetailCard title="Pressure" value={gameView.stockCount <= 10 ? "Thin deck" : "Healthy deck"} tone={gameView.stockCount <= 10 ? "amber" : "emerald"} compact />
                  <MatchDetailCard title="Visibility" value="Hands hidden" tone="emerald" compact />
                </div>
              </div>
            </div>

            <PlayerPod
              username={gameView.player2Username}
              score={gameView.player2Score}
              cardCount={gameView.player2CardCount}
              isCurrentTurn={gameView.currentTurnUsername === gameView.player2Username}
              seatLabel="Seat Two"
            />
          </section>

          {gameView.showdown && (gameView.status === "round_over" || gameView.status === "game_over") && (
            <SpectatorShowdown showdown={gameView.showdown} fourColor={fourColorDeck} />
          )}

          <div className="flex flex-wrap items-center justify-center gap-2 pb-2">
            <SpectatorChip tone="emerald" icon={<EyeOff size={12} />} label="Read-only mode" />
            <SpectatorChip tone="emerald" icon={<Users size={12} />} label="No hidden hands during live play" />
          </div>
        </div>
      </main>
    </div>
  );
}

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
    <header className="relative z-20 border-b border-emerald-900/35 bg-[#07120d]/86 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={onBack} className="text-emerald-700 transition-colors hover:text-emerald-300">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.34em] text-emerald-500/45">Spectator desk</p>
            <p className="truncate text-sm font-semibold text-zinc-100">Live Room {roomId}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <SpectatorChip tone="rose" icon={<Radio size={12} />} label="LIVE" />
          <SpectatorChip tone="emerald" icon={<Users size={12} />} label={`${spectatorCount} watching`} />
        </div>
      </div>
    </header>
  );
}

function SpectatorChip({
  icon,
  label,
  tone = "emerald",
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "emerald" | "amber" | "rose";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
      : tone === "rose"
      ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";

  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium", toneClass)}>
      {icon}
      {label}
    </span>
  );
}

function MatchDetailCard({
  title,
  value,
  tone = "emerald",
  mono = false,
  compact = false,
}: {
  title: string;
  value: string;
  tone?: "emerald" | "amber" | "rose";
  mono?: boolean;
  compact?: boolean;
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-500/18 bg-amber-500/8"
      : tone === "rose"
      ? "border-rose-500/18 bg-rose-500/8"
      : "border-emerald-500/14 bg-emerald-500/7";

  return (
    <div className={cn("rounded-2xl border p-3", toneClass, compact && "px-3 py-2.5")}>
      <p className="text-[10px] uppercase tracking-[0.24em] text-emerald-500/45">{title}</p>
      <p className={cn("mt-1 text-sm font-semibold text-zinc-100", mono && "font-mono tracking-[0.18em]")}>{value}</p>
    </div>
  );
}

function PlayerPod({
  username,
  score,
  cardCount,
  isCurrentTurn,
  seatLabel,
}: {
  username: string;
  score: number;
  cardCount: number;
  isCurrentTurn: boolean;
  seatLabel: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[28px] border p-5 shadow-[0_24px_60px_-38px_rgba(0,0,0,0.85)] backdrop-blur-xl",
        isCurrentTurn
          ? "border-amber-500/28 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.16),transparent_42%),linear-gradient(180deg,rgba(14,20,12,0.9),rgba(8,18,13,0.86))]"
          : "border-emerald-700/22 bg-[#08140f]/86",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.32em] text-emerald-500/45">{seatLabel}</p>
          <p className="mt-2 truncate text-lg font-bold text-white">{username}</p>
        </div>
        {isCurrentTurn && <SpectatorChip tone="amber" icon={<Crown size={12} />} label="On turn" />}
      </div>

      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.26em] text-emerald-500/45">Match score</p>
          <p className="mt-1 text-4xl font-black tabular-nums text-emerald-300">{score}</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/14 bg-black/10 px-4 py-3 text-right">
          <p className="text-[10px] uppercase tracking-[0.26em] text-emerald-500/45">Hand</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{cardCount} cards</p>
        </div>
      </div>
    </div>
  );
}

function SpectatorShowdown({
  showdown,
  fourColor = false,
}: {
  showdown: ShowdownData;
  fourColor?: boolean;
}) {
  return (
    <section className="rounded-[30px] border border-emerald-700/25 bg-[#08140f]/88 p-5 shadow-[0_30px_80px_-42px_rgba(0,0,0,0.85)] backdrop-blur-xl sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <SpectatorChip tone="amber" icon={<Crown size={12} />} label={showdown.knockOutcome === "gin" ? "GIN finish" : showdown.knockOutcome === "undercut" ? "Undercut" : "Knock finish"} />
        <SpectatorChip tone="emerald" icon={<Sparkles size={12} />} label={`${showdown.roundPoints} points`} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <SpectatorShowdownPlayer data={showdown.knocker} isKnocker={true} fourColor={fourColor} />
        <SpectatorShowdownPlayer data={showdown.opponent} isKnocker={false} fourColor={fourColor} />
      </div>
    </section>
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
    <div className="rounded-[24px] border border-emerald-700/18 bg-[#0a1a13]/75 p-4">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-bold text-zinc-100">{data.username}</span>
        {isKnocker && (
          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
            KNOCKER
          </span>
        )}
        <span className="ml-auto text-emerald-400/60">DW: {data.deadwoodValue}</span>
      </div>

      {data.melds.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.melds.map((meld, mi) => (
            <div key={mi} className="flex gap-0.5 rounded-xl border border-emerald-500/18 bg-emerald-500/8 p-1.5">
              {meld.cards.map((c, ci) => (
                <MiniCard key={ci} suit={c.suit} rank={c.rank} highlight="meld" fourColor={fourColor} />
              ))}
            </div>
          ))}
        </div>
      )}

      {data.deadwood.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-0.5">
          {data.deadwood.map((c, ci) => (
            <MiniCard key={ci} suit={c.suit} rank={c.rank} highlight="deadwood" fourColor={fourColor} />
          ))}
        </div>
      )}
    </div>
  );
}
