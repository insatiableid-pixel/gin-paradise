/**
 * Tournaments Page — Gin Paradise Tournament System.
 *
 * Supports both SNG (sit-and-go) and Scheduled tournaments:
 *  - Browse open, upcoming, in-progress, and completed tournaments
 *  - Create SNG tournaments from presets (any user)
 *  - View upcoming scheduled events with countdowns
 *  - Join / leave open or registering tournaments
 *  - View dynamic bracket progression (variable sizes, byes)
 *  - Start tournament matches via WebSocket
 */

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Trophy,
  Users,
  Coins,
  Swords,
  Crown,
  Clock,
  Plus,
  LogIn,
  LogOut,
  ChevronRight,
  RefreshCw,
  Shield,
  Zap,
  X,
  Calendar,
  Timer,
  Award,
} from "lucide-react";
import { useAuthStore } from "@/src/lib/store";

interface TournamentEntrant {
  userId: string;
  username: string;
  seed: number | null;
  eliminated: boolean;
}

interface BracketMatch {
  matchIndex: number;
  round: string;
  roundNumber: number;
  player1Id: string | null;
  player1Username: string | null;
  player2Id: string | null;
  player2Username: string | null;
  winnerId: string | null;
  winnerUsername: string | null;
  roomId: string | null;
  status: "pending" | "in_progress" | "completed" | "bye";
  noShowDeadline: number | null;
}

interface Tournament {
  id: string;
  name: string;
  format: "sit_and_go_4" | "scheduled";
  status: "open" | "registration_open" | "registration_closed" | "in_progress" | "completed" | "cancelled";
  entryFee: number;
  currency: string;
  rakePercent: number;
  totalPool: number;
  rakeAmount: number;
  prizePool: number;
  entrants: TournamentEntrant[];
  bracket: { matches: BracketMatch[] } | null;
  winnerId: string | null;
  winnerUsername: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  entrantCount: number;
  maxEntrants: number;
  scheduledStartTime: number | null;
  minEntrants: number;
  adminCreated: boolean;
  currentRound: number | null;
  totalRounds: number | null;
}

interface TournamentPreset {
  name: string;
  entryFee: number;
  currency: string;
  rakePercent: number;
}

export function Tournaments() {
  const { sessionId, user } = useAuthStore();
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [presets, setPresets] = useState<TournamentPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [tab, setTab] = useState<"upcoming" | "open" | "in_progress" | "completed">("upcoming");
  const [showCreate, setShowCreate] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchTournaments = useCallback(async () => {
    try {
      const res = await fetch("/api/tournaments", {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      const data = await res.json();
      setTournaments(data.tournaments || []);
      setPresets(data.presets || []);
      setLoading(false);
    } catch {
      setError("Failed to load tournaments.");
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchTournaments();
    const interval = setInterval(fetchTournaments, 5000);
    return () => clearInterval(interval);
  }, [fetchTournaments]);

  const createTournament = async (presetIndex: number) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionId}`,
        },
        body: JSON.stringify({ presetIndex }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowCreate(false);
        fetchTournaments();
        setSelectedTournament(data.tournament);
      } else {
        setError(data.error || "Failed to create tournament.");
      }
    } catch {
      setError("Network error.");
    }
    setActionLoading(false);
  };

  const joinTournament = async (tournamentId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionId}`,
        },
      });
      const data = await res.json();
      if (res.ok) {
        setSelectedTournament(data.tournament);
        fetchTournaments();
      } else {
        setError(data.error || "Failed to join tournament.");
      }
    } catch {
      setError("Network error.");
    }
    setActionLoading(false);
  };

  const leaveTournament = async (tournamentId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/leave`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionId}`,
        },
      });
      const data = await res.json();
      if (res.ok) {
        if (data.tournament) setSelectedTournament(data.tournament);
        else setSelectedTournament(null);
        fetchTournaments();
      } else {
        setError(data.error || "Failed to leave tournament.");
      }
    } catch {
      setError("Network error.");
    }
    setActionLoading(false);
  };

  const startTournamentMatch = (tournament: Tournament, matchIndex: number) => {
    const params = new URLSearchParams({
      tournamentId: tournament.id,
      matchIndex: matchIndex.toString(),
    });
    navigate(`/play/multiplayer?${params.toString()}`);
  };

  // Filter tournaments by tab
  const filteredTournaments = tournaments.filter((t) => {
    if (tab === "upcoming") return t.status === "registration_open" || t.status === "registration_closed";
    if (tab === "open") return t.status === "open";
    if (tab === "in_progress") return t.status === "in_progress";
    if (tab === "completed") return t.status === "completed" || t.status === "cancelled";
    return false;
  });

  const isJoined = (t: Tournament) =>
    t.entrants.some((e) => e.userId === user?.id);

  const getMyPendingMatch = (t: Tournament): BracketMatch | null => {
    if (!t.bracket || t.status !== "in_progress") return null;
    for (const m of t.bracket.matches) {
      if (m.status !== "pending") continue;
      if (m.player1Id === user?.id || m.player2Id === user?.id) {
        if (m.player1Id && m.player2Id) return m;
      }
    }
    return null;
  };

  const getCurrencyLabel = (currency: string) =>
    currency === "sweeps_coins" ? "Coins" : "Coins";

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "open": return "Waiting for Players";
      case "registration_open": return "Registration Open";
      case "registration_closed": return "Registration Closed";
      case "in_progress": return "In Progress";
      case "completed": return "Completed";
      case "cancelled": return "Cancelled";
      default: return status;
    }
  };

  const getFormatLabel = (t: Tournament) => {
    if (t.format === "sit_and_go_4") return "4-Player Sit & Go";
    return `Scheduled Event (up to ${t.maxEntrants} players)`;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 bg-clip-text text-transparent">
            Tournaments
          </h1>
          <p className="text-zinc-400 mt-1">
            Compete in sit-and-go brackets or scheduled events
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchTournaments}
            className="p-2 rounded-lg bg-zinc-800/50 border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 rounded-lg font-medium text-sm shadow-lg shadow-amber-500/20 transition-all"
          >
            <Plus className="w-4 h-4" /> New Tournament
          </button>
        </div>
      </div>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center justify-between p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg"
          >
            <span className="text-rose-300 text-sm">{error}</span>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-1">
        {(["upcoming", "open", "in_progress", "completed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
              tab === t
                ? "bg-zinc-700 text-zinc-100 shadow"
                : "text-zinc-400 hover:text-zinc-300"
            }`}
          >
            {t === "upcoming" && <Calendar className="w-3.5 h-3.5" />}
            {t === "open" && <Users className="w-3.5 h-3.5" />}
            {t === "in_progress" && <Swords className="w-3.5 h-3.5" />}
            {t === "completed" && <Trophy className="w-3.5 h-3.5" />}
            {t === "upcoming" ? "Upcoming" : t === "open" ? "Open" : t === "in_progress" ? "In Progress" : "Completed"}
          </button>
        ))}
      </div>

      {/* Tournament List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
        </div>
      ) : filteredTournaments.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg">No {tab === "upcoming" ? "upcoming" : tab.replace("_", " ")} tournaments</p>
          {tab === "open" && (
            <p className="text-sm mt-1">
              Create one to get started!
            </p>
          )}
          {tab === "upcoming" && (
            <p className="text-sm mt-1">
              Scheduled events will appear here when an admin creates one.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredTournaments.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-zinc-900/60 border rounded-xl p-4 cursor-pointer transition-all hover:bg-zinc-800/60 ${
                selectedTournament?.id === t.id
                  ? "border-amber-500/50 ring-1 ring-amber-500/20"
                  : "border-zinc-800/50"
              }`}
              onClick={() => setSelectedTournament(t)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      t.format === "scheduled"
                        ? t.status === "registration_open"
                          ? "bg-cyan-500/10 text-cyan-400"
                          : t.status === "in_progress"
                          ? "bg-amber-500/10 text-amber-400"
                          : t.status === "completed"
                          ? "bg-indigo-500/10 text-indigo-400"
                          : "bg-zinc-700/30 text-zinc-500"
                        : t.status === "open"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : t.status === "in_progress"
                        ? "bg-amber-500/10 text-amber-400"
                        : t.status === "completed"
                        ? "bg-indigo-500/10 text-indigo-400"
                        : "bg-zinc-700/30 text-zinc-500"
                    }`}
                  >
                    {t.format === "scheduled" ? (
                      <Calendar className="w-5 h-5" />
                    ) : t.status === "completed" ? (
                      <Crown className="w-5 h-5" />
                    ) : t.status === "in_progress" ? (
                      <Swords className="w-5 h-5" />
                    ) : (
                      <Trophy className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-zinc-100">{t.name}</h3>
                      {t.format === "scheduled" && (
                        <span className="px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 text-[10px] rounded-full border border-cyan-500/20 font-medium">
                          SCHEDULED
                        </span>
                      )}
                      {t.adminCreated && (
                        <span className="px-1.5 py-0.5 bg-violet-500/10 text-violet-400 text-[10px] rounded-full border border-violet-500/20 font-medium">
                          OFFICIAL
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {t.entrantCount}/{t.maxEntrants}
                      </span>
                      {t.entryFee > 0 && (
                        <span className="flex items-center gap-1">
                          <Coins className="w-3 h-3" />
                          {t.entryFee} {getCurrencyLabel(t.currency)}
                        </span>
                      )}
                      {t.entryFee === 0 && (
                        <span className="text-emerald-400">Free</span>
                      )}
                      {t.prizePool > 0 && (
                        <span className="text-amber-400">
                          Prize: {t.prizePool} {getCurrencyLabel(t.currency)}
                        </span>
                      )}
                      {t.scheduledStartTime && (
                        <CountdownBadge startTime={t.scheduledStartTime} />
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isJoined(t) && (t.status === "open" || t.status === "registration_open") && (
                    <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-full border border-emerald-500/20">
                      Joined
                    </span>
                  )}
                  {t.status === "completed" && t.winnerUsername && (
                    <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 text-xs rounded-full border border-amber-500/20 flex items-center gap-1">
                      <Crown className="w-3 h-3" /> {t.winnerUsername}
                    </span>
                  )}
                  {t.currentRound && t.totalRounds && t.status === "in_progress" && (
                    <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 text-xs rounded-full border border-amber-500/20">
                      Round {t.currentRound}/{t.totalRounds}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-zinc-600" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Tournament Detail Panel */}
      <AnimatePresence>
        {selectedTournament && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="bg-zinc-900/80 border border-zinc-800/50 rounded-xl p-6 space-y-5"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-zinc-100">
                    {selectedTournament.name}
                  </h2>
                  {selectedTournament.format === "scheduled" && (
                    <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 text-xs rounded-full border border-cyan-500/20">
                      Scheduled
                    </span>
                  )}
                </div>
                <p className="text-sm text-zinc-500 mt-0.5">
                  {getFormatLabel(selectedTournament)} •{" "}
                  {getStatusLabel(selectedTournament.status)}
                  {selectedTournament.totalRounds && selectedTournament.currentRound && selectedTournament.status === "in_progress" && (
                    <> • Round {selectedTournament.currentRound}/{selectedTournament.totalRounds}</>
                  )}
                </p>
              </div>
              <button
                onClick={() => setSelectedTournament(null)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Countdown for scheduled tournaments */}
            {selectedTournament.scheduledStartTime && selectedTournament.status !== "in_progress" && selectedTournament.status !== "completed" && (
              <CountdownTimer startTime={selectedTournament.scheduledStartTime} />
            )}

            {/* Economics */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-zinc-800/40 rounded-lg p-3 text-center">
                <div className="text-xs text-zinc-500 mb-1">Entry Fee</div>
                <div className="text-lg font-bold text-zinc-100">
                  {selectedTournament.entryFee === 0
                    ? "Free"
                    : `${selectedTournament.entryFee} ${getCurrencyLabel(selectedTournament.currency)}`}
                </div>
              </div>
              <div className="bg-zinc-800/40 rounded-lg p-3 text-center">
                <div className="text-xs text-zinc-500 mb-1">Prize Pool</div>
                <div className="text-lg font-bold text-amber-400">
                  {selectedTournament.prizePool === 0
                    ? selectedTournament.status === "in_progress" || selectedTournament.status === "completed"
                      ? "—"
                      : selectedTournament.entryFee > 0
                      ? `~${Math.round(selectedTournament.entryFee * selectedTournament.entrantCount * (1 - selectedTournament.rakePercent))}`
                      : "—"
                    : `${selectedTournament.prizePool} ${getCurrencyLabel(selectedTournament.currency)}`}
                </div>
              </div>
              <div className="bg-zinc-800/40 rounded-lg p-3 text-center">
                <div className="text-xs text-zinc-500 mb-1">Rake</div>
                <div className="text-lg font-bold text-zinc-400">
                  {selectedTournament.rakePercent > 0
                    ? `${(selectedTournament.rakePercent * 100).toFixed(0)}%`
                    : "None"}
                </div>
              </div>
            </div>

            {/* Entrants */}
            <div>
              <h3 className="text-sm font-semibold text-zinc-400 mb-2">
                Players ({selectedTournament.entrantCount}/
                {selectedTournament.maxEntrants})
                {selectedTournament.minEntrants > 2 && selectedTournament.status === "registration_open" && (
                  <span className="text-zinc-600 font-normal ml-2">
                    (min {selectedTournament.minEntrants} to start)
                  </span>
                )}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {selectedTournament.entrants.map((e) => (
                  <div
                    key={e.userId}
                    className={`flex items-center gap-2 p-2 rounded-lg border ${
                      e.eliminated
                        ? "bg-zinc-800/20 border-zinc-800/30 opacity-50"
                        : e.userId === selectedTournament.winnerId
                        ? "bg-amber-500/10 border-amber-500/30"
                        : "bg-zinc-800/40 border-zinc-700/30"
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        e.userId === selectedTournament.winnerId
                          ? "bg-gradient-to-tr from-amber-500 to-yellow-400 text-zinc-900"
                          : "bg-gradient-to-tr from-indigo-500 to-purple-500 text-white"
                      }`}
                    >
                      {e.username[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-200 truncate">
                        {e.username}
                        {e.userId === user?.id && (
                          <span className="text-indigo-400 ml-1">(you)</span>
                        )}
                      </div>
                      {e.seed && (
                        <div className="text-[10px] text-zinc-500">
                          Seed #{e.seed}
                          {e.eliminated && " • Eliminated"}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {/* Empty slots */}
                {Array.from({
                  length: Math.min(
                    selectedTournament.maxEntrants - selectedTournament.entrantCount,
                    8 // Cap empty slots shown to avoid massive grids
                  ),
                }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="flex items-center gap-2 p-2 rounded-lg border border-dashed border-zinc-800/50 text-zinc-600"
                  >
                    <div className="w-7 h-7 rounded-full bg-zinc-800/30 flex items-center justify-center">
                      <Users className="w-3 h-3" />
                    </div>
                    <span className="text-xs">Waiting...</span>
                  </div>
                ))}
                {selectedTournament.maxEntrants - selectedTournament.entrantCount > 8 && (
                  <div className="flex items-center gap-2 p-2 rounded-lg text-zinc-600">
                    <span className="text-xs italic">
                      +{selectedTournament.maxEntrants - selectedTournament.entrantCount - 8} more slots
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Bracket View */}
            {selectedTournament.bracket && (
              <DynamicBracketView
                bracket={selectedTournament.bracket}
                userId={user?.id}
                totalRounds={selectedTournament.totalRounds || 1}
                onStartMatch={(matchIndex: number) =>
                  startTournamentMatch(selectedTournament, matchIndex)
                }
              />
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2 border-t border-zinc-800/50">
              {(selectedTournament.status === "open" || selectedTournament.status === "registration_open") &&
                !isJoined(selectedTournament) && (
                  <button
                    onClick={() => joinTournament(selectedTournament.id)}
                    disabled={actionLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 rounded-lg font-medium text-sm shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
                  >
                    <LogIn className="w-4 h-4" /> Join Tournament
                    {selectedTournament.entryFee > 0 &&
                      ` (${selectedTournament.entryFee} ${getCurrencyLabel(selectedTournament.currency)})`}
                  </button>
                )}
              {(selectedTournament.status === "open" || selectedTournament.status === "registration_open") &&
                isJoined(selectedTournament) && (
                  <button
                    onClick={() => leaveTournament(selectedTournament.id)}
                    disabled={actionLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg font-medium text-sm transition-all disabled:opacity-50"
                  >
                    <LogOut className="w-4 h-4" /> Leave Tournament
                  </button>
                )}
              {selectedTournament.status === "in_progress" &&
                getMyPendingMatch(selectedTournament) && (
                  <button
                    onClick={() => {
                      const match = getMyPendingMatch(selectedTournament)!;
                      startTournamentMatch(selectedTournament, match.matchIndex);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 rounded-lg font-medium text-sm shadow-lg shadow-amber-500/20 transition-all animate-pulse"
                  >
                    <Zap className="w-4 h-4" /> Play Next Match
                  </button>
                )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Tournament Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-zinc-100 mb-4">
                Create Sit & Go Tournament
              </h2>
              <div className="space-y-3">
                {presets.map((preset, i) => (
                  <button
                    key={i}
                    onClick={() => createTournament(i)}
                    disabled={actionLoading}
                    className="w-full flex items-center justify-between p-4 bg-zinc-800/50 border border-zinc-700/50 rounded-xl hover:bg-zinc-800 hover:border-zinc-600 transition-all disabled:opacity-50"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          preset.entryFee === 0
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-amber-500/10 text-amber-400"
                        }`}
                      >
                        <Trophy className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <div className="font-medium text-zinc-100">
                          {preset.name}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {preset.entryFee === 0
                            ? "No entry fee"
                            : `${preset.entryFee} ${getCurrencyLabel(preset.currency)} entry`}
                          {preset.rakePercent > 0 &&
                            ` • ${(preset.rakePercent * 100).toFixed(0)}% rake`}
                        </div>
                      </div>
                    </div>
                    {preset.entryFee > 0 && (
                      <div className="text-right">
                        <div className="text-sm font-semibold text-amber-400">
                          {preset.entryFee * 4 -
                            Math.round(
                              preset.entryFee * 4 * preset.rakePercent * 100
                            ) /
                              100}{" "}
                          {getCurrencyLabel(preset.currency)}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          Winner takes all
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="w-full mt-4 py-2 text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Countdown Badge (compact, for list items) ─────────────────────────

function CountdownBadge({ startTime }: { startTime: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const diff = startTime - now;
  if (diff <= 0) return <span className="text-amber-400 font-medium">Starting...</span>;

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((diff % (1000 * 60)) / 1000);

  return (
    <span className="flex items-center gap-1 text-cyan-400 font-medium">
      <Timer className="w-3 h-3" />
      {hours > 0 ? `${hours}h ${mins}m` : `${mins}m ${secs}s`}
    </span>
  );
}

// ── Countdown Timer (detailed, for detail panel) ──────────────────────

function CountdownTimer({ startTime }: { startTime: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const diff = startTime - now;
  if (diff <= 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
        <Zap className="w-5 h-5 text-amber-400 animate-pulse" />
        <span className="text-amber-300 font-semibold">Tournament is starting!</span>
      </div>
    );
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((diff % (1000 * 60)) / 1000);

  return (
    <div className="bg-zinc-800/40 rounded-lg p-4">
      <div className="text-xs text-zinc-500 text-center mb-2 flex items-center justify-center gap-1">
        <Calendar className="w-3.5 h-3.5" />
        Starts {new Date(startTime).toLocaleDateString()} at {new Date(startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="flex justify-center gap-4">
        {days > 0 && <TimeUnit value={days} label="DAYS" />}
        <TimeUnit value={hours} label="HRS" />
        <TimeUnit value={mins} label="MIN" />
        <TimeUnit value={secs} label="SEC" />
      </div>
    </div>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold text-cyan-400 tabular-nums">
        {String(value).padStart(2, "0")}
      </div>
      <div className="text-[10px] text-zinc-500 font-medium">{label}</div>
    </div>
  );
}

// ── Dynamic Bracket View ──────────────────────────────────────────────

function DynamicBracketView({
  bracket,
  userId,
  totalRounds,
  onStartMatch,
}: {
  bracket: { matches: BracketMatch[] };
  userId?: string;
  totalRounds: number;
  onStartMatch: (matchIndex: number) => void;
}) {
  // Group matches by round
  const roundGroups: { round: string; roundNumber: number; matches: BracketMatch[] }[] = [];
  const seen = new Set<string>();

  for (const match of bracket.matches) {
    const key = `${match.roundNumber}`;
    if (!seen.has(key)) {
      seen.add(key);
      roundGroups.push({
        round: match.round,
        roundNumber: match.roundNumber,
        matches: bracket.matches.filter(m => m.roundNumber === match.roundNumber),
      });
    }
  }

  // Sort by round number
  roundGroups.sort((a, b) => a.roundNumber - b.roundNumber);

  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-400 mb-3">
        Bracket
      </h3>
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-6 min-w-fit">
          {roundGroups.map((group, gi) => (
            <React.Fragment key={group.roundNumber}>
              <div className="space-y-3 min-w-[180px]">
                <div className="text-xs text-zinc-500 text-center font-medium capitalize">
                  {group.round.replace("_", " ")}
                </div>
                <div className="space-y-2" style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-around",
                  minHeight: `${group.matches.length * 100}px`,
                }}>
                  {group.matches.map((m) => (
                    <BracketMatchCard
                      key={m.matchIndex}
                      match={m}
                      userId={userId}
                      onStart={() => onStartMatch(m.matchIndex)}
                      isFinal={m.round === "final"}
                    />
                  ))}
                </div>
              </div>
              {gi < roundGroups.length - 1 && (
                <div className="flex items-center justify-center px-1">
                  <ChevronRight className="w-6 h-6 text-zinc-700" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Bracket Match Card Component ──────────────────────────────────────

function BracketMatchCard({
  match,
  userId,
  onStart,
  isFinal,
}: {
  match: BracketMatch;
  userId?: string;
  onStart: () => void;
  isFinal?: boolean;
}) {
  const isMyMatch =
    match.player1Id === userId || match.player2Id === userId;
  const canPlay =
    isMyMatch && match.status === "pending" && match.player1Id && match.player2Id;
  const isBye = match.status === "bye";

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        isBye
          ? "bg-zinc-800/10 border-zinc-800/20 opacity-70"
          : match.status === "completed"
          ? "bg-zinc-800/20 border-zinc-800/30"
          : match.status === "in_progress"
          ? "bg-amber-500/5 border-amber-500/20"
          : canPlay
          ? "bg-emerald-500/5 border-emerald-500/20"
          : "bg-zinc-800/40 border-zinc-700/30"
      } ${isFinal ? "ring-1 ring-amber-500/10" : ""}`}
    >
      {/* Player 1 */}
      <PlayerSlot
        name={match.player1Username}
        isWinner={match.winnerId === match.player1Id}
        isMe={match.player1Id === userId}
      />
      {isBye ? (
        <div className="text-center text-[10px] text-zinc-600 font-medium italic">BYE</div>
      ) : (
        <div className="text-center text-[10px] text-zinc-600 font-medium">VS</div>
      )}
      {/* Player 2 */}
      <PlayerSlot
        name={match.player2Username}
        isWinner={match.winnerId === match.player2Id}
        isMe={match.player2Id === userId}
      />
      {/* Play button */}
      {canPlay && (
        <button
          onClick={onStart}
          className="w-full mt-1 py-1.5 text-xs font-medium bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 rounded-md transition-all"
        >
          Play Match
        </button>
      )}
      {match.status === "completed" && match.winnerUsername && !isBye && (
        <div className="text-center text-[10px] text-amber-400 flex items-center justify-center gap-1">
          <Crown className="w-3 h-3" /> {match.winnerUsername} wins
        </div>
      )}
      {match.status === "in_progress" && (
        <div className="text-center text-[10px] text-amber-400 animate-pulse">
          In Progress...
        </div>
      )}
      {isBye && match.winnerUsername && (
        <div className="text-center text-[10px] text-zinc-500 flex items-center justify-center gap-1">
          <Award className="w-3 h-3" /> {match.winnerUsername} advances
        </div>
      )}
    </div>
  );
}

function PlayerSlot({
  name,
  isWinner,
  isMe,
}: {
  name: string | null;
  isWinner: boolean;
  isMe: boolean;
}) {
  if (!name) {
    return (
      <div className="flex items-center gap-2 p-1.5 rounded bg-zinc-800/30">
        <div className="w-5 h-5 rounded-full bg-zinc-700/30" />
        <span className="text-[11px] text-zinc-600 italic">TBD</span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 p-1.5 rounded ${
        isWinner
          ? "bg-amber-500/10"
          : "bg-zinc-800/30"
      }`}
    >
      <div
        className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
          isWinner
            ? "bg-gradient-to-tr from-amber-500 to-yellow-400 text-zinc-900"
            : "bg-gradient-to-tr from-indigo-500 to-purple-500 text-white"
        }`}
      >
        {name[0]?.toUpperCase()}
      </div>
      <span
        className={`text-[11px] font-medium ${
          isWinner ? "text-amber-300" : "text-zinc-300"
        }`}
      >
        {name}
        {isMe && <span className="text-indigo-400 ml-1">(you)</span>}
      </span>
      {isWinner && <Crown className="w-3 h-3 text-amber-400 ml-auto" />}
    </div>
  );
}
