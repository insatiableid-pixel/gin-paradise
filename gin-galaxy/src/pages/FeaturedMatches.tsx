/**
 * Featured Matches — Live match discovery, spectator surface, & broadcast history.
 *
 * Players can:
 *  - Discover currently watchable matches
 *  - See why a match is notable (tournament, stakes, ranking, featured)
 *  - Open a live spectator view
 *  - View recent broadcast history/stats
 *  - Toggle their spectate preference
 *
 * Design: Premium broadcast-style surface with live match cards.
 */

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Eye,
  Tv,
  Trophy,
  Coins,
  Star,
  Crown,
  RefreshCw,
  Users,
  Swords,
  Zap,
  Radio,
  BarChart3,
  EyeOff,
} from "lucide-react";
import { useAuthStore } from "../lib/store";

interface FeaturedMatch {
  roomId: string;
  player1: { username: string; rating: number };
  player2: { username: string; rating: number };
  scores: { player1: number; player2: number };
  roundNumber: number;
  status: "playing" | "round_over" | "game_over";
  reasons: string[];
  stakeInfo?: { label: string; prizePool: number; currency: string } | null;
  spectatorCount: number;
  startedAt: number;
  isAdminFeatured?: boolean;
}

interface BroadcastMetric {
  roomId: string;
  player1Username: string;
  player2Username: string;
  peakConcurrentSpectators: number;
  totalUniqueSpectators: number;
  wasAdminFeatured: boolean;
  featuredReasons: string[];
  winnerUsername: string | null;
  matchDurationSeconds: number | null;
  startedAt: number;
  endedAt: number;
}

const REASON_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  tournament: { label: "Tournament", icon: <Trophy size={12} />, color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  high_stakes: { label: "High Stakes", icon: <Coins size={12} />, color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  featured: { label: "Featured", icon: <Star size={12} />, color: "bg-amber-500/20 text-amber-200 border-amber-500/30" },
  ranked: { label: "Top Ranked", icon: <Crown size={12} />, color: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
};

export function FeaturedMatches() {
  const [matches, setMatches] = useState<FeaturedMatch[]>([]);
  const [metrics, setMetrics] = useState<BroadcastMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"live" | "history">("live");
  const [spectateAllowed, setSpectateAllowed] = useState<boolean | null>(null);
  const [savingPref, setSavingPref] = useState(false);
  const navigate = useNavigate();
  const { sessionId } = useAuthStore();

  const fetchMatches = useCallback(async () => {
    try {
      const res = await fetch("/api/spectator/featured");
      const data = await res.json();
      setMatches(data.matches || []);
      setError(null);
    } catch {
      setError("Failed to load featured matches");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/spectator/metrics/recent?limit=10");
      const data = await res.json();
      setMetrics(data.metrics || []);
    } catch {
      // silently fail
    }
  }, []);

  const fetchPreference = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch("/api/spectator/preference", {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSpectateAllowed(data.allowSpectating);
      }
    } catch {
      // silently fail
    }
  }, [sessionId]);

  const togglePreference = async () => {
    if (!sessionId || spectateAllowed === null) return;
    setSavingPref(true);
    try {
      const res = await fetch("/api/spectator/preference", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionId}`,
        },
        body: JSON.stringify({ allowSpectating: !spectateAllowed }),
      });
      if (res.ok) {
        setSpectateAllowed(!spectateAllowed);
      }
    } catch {
      // silently fail
    } finally {
      setSavingPref(false);
    }
  };

  useEffect(() => {
    fetchMatches();
    fetchMetrics();
    fetchPreference();
    // Auto-refresh live matches every 10 seconds
    const interval = setInterval(fetchMatches, 10_000);
    return () => clearInterval(interval);
  }, [fetchMatches, fetchMetrics, fetchPreference]);

  const handleWatch = (roomId: string) => {
    navigate(`/play/multiplayer?watch=${roomId}`);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-500/20 to-amber-500/20 border border-rose-500/20">
            <Tv className="h-6 w-6 text-rose-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Live Matches</h1>
            <p className="text-sm text-emerald-300/60">Watch notable matches in real-time</p>
          </div>
        </div>
        <button
          onClick={() => { fetchMatches(); fetchMetrics(); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0a2e1e] hover:bg-emerald-900/40 text-emerald-200 text-sm transition-colors border border-emerald-800/40"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 bg-emerald-950/60 rounded-xl border border-emerald-800/30">
        <button
          onClick={() => setTab("live")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
            tab === "live" ? "bg-[#0a2e1e] text-amber-50 shadow-sm" : "text-emerald-400/50 hover:text-emerald-200"
          }`}
        >
          <Radio size={14} />
          Live Now
          {matches.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold">
              {matches.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("history")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
            tab === "history" ? "bg-[#0a2e1e] text-amber-50 shadow-sm" : "text-emerald-400/50 hover:text-emerald-200"
          }`}
        >
          <BarChart3 size={14} />
          Broadcast History
        </button>
      </div>

      {/* Live Tab */}
      {tab === "live" && (
        <>
          {/* Live indicator */}
          <div className="flex items-center gap-2 text-sm text-emerald-300/60">
            <div className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
            </div>
            <span>{matches.length} live {matches.length === 1 ? "match" : "matches"} available</span>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-rose-500 border-t-transparent"></div>
              <p className="text-emerald-300/60">Loading featured matches...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-6 text-center">
              <p className="text-red-400">{error}</p>
              <button onClick={fetchMatches} className="mt-3 text-sm text-red-300 hover:text-red-200">
                Try again
              </button>
            </div>
          ) : matches.length === 0 ? (
            <div className="rounded-xl bg-[#0a2e1e]/50 border border-emerald-800/40 p-12 text-center space-y-4">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-900/40 flex items-center justify-center">
                <Radio className="h-8 w-8 text-emerald-400/50" />
              </div>
              <h3 className="text-lg font-semibold text-emerald-200">No Live Matches Right Now</h3>
              <p className="text-emerald-400/50 text-sm max-w-md mx-auto">
                Featured matches appear when notable games are in progress — tournament matches,
                high-stakes play, top-ranked rivalries, and admin-featured showdowns.
              </p>
              <p className="text-emerald-500/40 text-xs">Auto-refreshing every 10 seconds</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {matches.map((match) => (
                <FeaturedMatchCard key={match.roomId} match={match} onWatch={handleWatch} />
              ))}
            </div>
          )}
        </>
      )}

      {/* History Tab */}
      {tab === "history" && (
        <div className="space-y-4">
          {metrics.length === 0 ? (
            <div className="rounded-xl bg-[#0a2e1e]/50 border border-emerald-800/40 p-12 text-center space-y-3">
              <BarChart3 className="h-8 w-8 text-emerald-400/50 mx-auto" />
              <h3 className="text-lg font-semibold text-emerald-200">No Broadcast History Yet</h3>
              <p className="text-emerald-400/50 text-sm">
                Broadcast metrics appear after featured matches complete.
              </p>
            </div>
          ) : (
            <div className="bg-emerald-950/50 border border-emerald-800/30 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-emerald-800/40">
                <h2 className="text-sm font-semibold text-emerald-100">Recent Broadcasts</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-emerald-400/50 text-xs border-b border-emerald-800/40">
                      <th className="text-left px-5 py-3 font-medium">Match</th>
                      <th className="text-left px-5 py-3 font-medium">Tags</th>
                      <th className="text-center px-5 py-3 font-medium">Peak</th>
                      <th className="text-center px-5 py-3 font-medium">Unique</th>
                      <th className="text-left px-5 py-3 font-medium">Winner</th>
                      <th className="text-left px-5 py-3 font-medium">Duration</th>
                      <th className="text-left px-5 py-3 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((m, i) => (
                      <tr key={i} className="border-b border-emerald-800/40/50 hover:bg-[#0a2e1e]/30 transition-colors">
                        <td className="px-5 py-3 text-emerald-200 text-xs">
                          {m.player1Username} vs {m.player2Username}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {m.featuredReasons.map((r) => {
                              const info = REASON_LABELS[r];
                              if (!info) return null;
                              return (
                                <span key={r} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${info.color}`}>
                                  {info.icon}
                                  {info.label}
                                </span>
                              );
                            })}
                            {m.wasAdminFeatured && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                <Star size={8} />
                                Admin
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-center font-mono text-xs text-amber-400">
                          {m.peakConcurrentSpectators}
                        </td>
                        <td className="px-5 py-3 text-center font-mono text-xs text-emerald-200">
                          {m.totalUniqueSpectators}
                        </td>
                        <td className="px-5 py-3 text-emerald-400 text-xs font-medium">
                          {m.winnerUsername || "—"}
                        </td>
                        <td className="px-5 py-3 text-emerald-300/60 text-xs">
                          {m.matchDurationSeconds ? `${Math.floor(m.matchDurationSeconds / 60)}m` : "—"}
                        </td>
                        <td className="px-5 py-3 text-emerald-400/50 text-xs font-mono whitespace-nowrap">
                          {new Date(m.endedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info footer + Spectate Preference */}
      <div className="rounded-xl bg-[#0a2e1e]/30 border border-emerald-700/25 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-emerald-200 flex items-center gap-2">
          <Eye size={14} className="text-emerald-300/60" />
          About Spectating
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-emerald-400/50">
          <div className="flex items-start gap-2">
            <span className="text-emerald-500">✓</span>
            <span>Spectators see scores, turns, and discard pile</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-emerald-500">✓</span>
            <span>Hands revealed only at showdown (end of round)</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-red-400">✗</span>
            <span>Hidden cards are never shown during live play</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-red-400">✗</span>
            <span>Spectators cannot interact or chat</span>
          </div>
        </div>

        {/* Spectate Preference Toggle */}
        {sessionId && spectateAllowed !== null && (
          <div className="pt-3 mt-3 border-t border-emerald-700/25">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${spectateAllowed ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-emerald-900/30 border border-emerald-700/25"}`}>
                  {spectateAllowed ? <Eye size={16} className="text-emerald-400" /> : <EyeOff size={16} className="text-emerald-400/50" />}
                </div>
                <div>
                  <p className="text-sm font-medium text-emerald-100">Allow Spectating</p>
                  <p className="text-xs text-emerald-400/50">
                    {spectateAllowed
                      ? "Your eligible matches can be watched by other players"
                      : "Your non-tournament matches are hidden from spectators"}
                  </p>
                </div>
              </div>
              <button
                onClick={togglePreference}
                disabled={savingPref}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  spectateAllowed ? "bg-emerald-600" : "bg-zinc-600"
                } ${savingPref ? "opacity-50" : ""}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    spectateAllowed ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            <p className="text-[10px] text-emerald-500/40 mt-2 ml-11">
              Tournament matches are always public. This setting only applies to staked, ranked, and admin-featured matches.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FeaturedMatchCard({
  match,
  onWatch,
}: {
  match: FeaturedMatch;
  onWatch: (roomId: string) => void;
}) {
  const elapsedMs = Date.now() - match.startedAt;
  const elapsedMin = Math.floor(elapsedMs / 60_000);

  return (
    <div className="group relative rounded-xl bg-gradient-to-br from-[#0a2e1e]/80 to-emerald-950/80 border border-emerald-800/40 hover:border-emerald-700/50 transition-all duration-300 overflow-hidden">
      {/* Glow effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 to-amber-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="relative p-5">
        {/* Top row: reasons + spectators */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5 flex-wrap">
            {match.reasons.map((reason) => {
              const info = REASON_LABELS[reason];
              if (!info) return null;
              return (
                <span
                  key={reason}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${info.color}`}
                >
                  {info.icon}
                  {info.label}
                </span>
              );
            })}
            {match.isAdminFeatured && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-gradient-to-r from-emerald-500/20 to-emerald-400/20 text-amber-300 border-amber-500/30">
                <Zap size={10} />
                Admin Pick
              </span>
            )}
            {match.stakeInfo && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-900/40 text-emerald-200 border border-emerald-700/35">
                <Coins size={10} />
                {match.stakeInfo.prizePool.toLocaleString()} Coins
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-emerald-400/50 text-xs">
            <span className="flex items-center gap-1">
              <Users size={12} />
              {match.spectatorCount}
            </span>
            <span>Rd {match.roundNumber}</span>
            <span>{elapsedMin}m</span>
          </div>
        </div>

        {/* Players */}
        <div className="flex items-center gap-4">
          <div className="flex-1 text-right">
            <p className="text-lg font-bold text-white">{match.player1.username}</p>
            <p className="text-xs text-emerald-400/50">{match.player1.rating} Elo</p>
          </div>

          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black text-emerald-400 tabular-nums">{match.scores.player1}</span>
              <span className="text-emerald-500/40 text-lg">—</span>
              <span className="text-2xl font-black text-emerald-400 tabular-nums">{match.scores.player2}</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-emerald-400/50">
              <Swords size={10} />
              <span>vs</span>
            </div>
          </div>

          <div className="flex-1">
            <p className="text-lg font-bold text-white">{match.player2.username}</p>
            <p className="text-xs text-emerald-400/50">{match.player2.rating} Elo</p>
          </div>
        </div>

        {/* Watch button */}
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => onWatch(match.roomId)}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-semibold text-sm transition-all shadow-lg shadow-rose-500/20 hover:shadow-rose-500/30"
          >
            <Eye size={16} />
            Watch Live
          </button>
        </div>
      </div>
    </div>
  );
}
