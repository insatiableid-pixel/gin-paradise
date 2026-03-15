import React, { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/src/lib/store";
import { motion } from "motion/react";
import {
  DollarSign, TrendingUp, Users, Search, Activity, Shield, ChevronRight, RefreshCw,
  Radio, Star, Eye, Tv, Trophy, Coins, Crown, Zap,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Button } from "@/src/components/ui/Button";

interface RevenueSummary {
  totalRakeCollected: number;
  totalRakeTransactions: number;
  byCurrency: { currency: string; total_revenue: number; transaction_count: number }[];
}

interface HouseLedgerEntry {
  id: string;
  currency: string;
  amount: number;
  type: string;
  room_id: string | null;
  stake_id: string | null;
  winner_id: string | null;
  loser_id: string | null;
  note: string | null;
  created_at: string;
}

interface Settlement {
  replay_id: string;
  room_id: string;
  player1_username: string;
  player2_username: string;
  winner_username: string | null;
  loser_username: string | null;
  winner_score: number;
  loser_score: number;
  end_reason: string;
  started_at: number;
  ended_at: number;
  action_count: number;
  currency: string | null;
  rake_amount: number | null;
  stake_id: string | null;
  settled_at: string | null;
}

interface PlayerResult {
  id: string;
  username: string;
  email: string;
  rating: number;
  wins: number;
  losses: number;
  created_at: string;
  is_admin: boolean;
  balances: { gold_coins: number; sweeps_coins: number };
}

interface PlayerDetail extends PlayerResult {
  transactions: any[];
  recentMatches: any[];
}

interface LiveMatch {
  roomId: string;
  player1: { userId: string; username: string; rating: number };
  player2: { userId: string; username: string; rating: number };
  status: string;
  stakeId: string;
  isTournament: boolean;
  isAdminFeatured: boolean;
  spectatorCount: number;
  reasons: string[];
  isSpectatable: boolean;
  ineligibilityReason?: string;
  scores?: { player1: number; player2: number };
  roundNumber?: number;
  startedAt: number;
  broadcastStats?: {
    peakConcurrent: number;
    uniqueSpectators: number;
    currentSpectators: number;
  };
}

interface BroadcastSummary {
  totalBroadcasts: number;
  totalUniqueViewers: number;
  peakAllTimeViewers: number;
  adminFeaturedCount: number;
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

export function AdminDashboard() {
  const { sessionId } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"revenue" | "settlements" | "players" | "broadcast" | "billing">("revenue");
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [recentEntries, setRecentEntries] = useState<HouseLedgerEntry[]>([]);
  const [houseLedger, setHouseLedger] = useState<HouseLedgerEntry[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerResults, setPlayerResults] = useState<PlayerResult[]>([]);
  const [playerDetail, setPlayerDetail] = useState<PlayerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [broadcastSummary, setBroadcastSummary] = useState<BroadcastSummary | null>(null);
  const [broadcastRecent, setBroadcastRecent] = useState<BroadcastMetric[]>([]);
  const [featuringRoom, setFeaturingRoom] = useState<string | null>(null);
  const [billingSummary, setBillingSummary] = useState<any | null>(null);
  const [billingEvents, setBillingEvents] = useState<any[]>([]);
  const [billingSessions, setBillingSessions] = useState<any[]>([]);

  const headers = { Authorization: `Bearer ${sessionId}` };

  const fetchRevenue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/revenue", { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRevenue(data.summary);
      setRecentEntries(data.recentEntries);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const fetchHouseLedger = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/house-ledger?limit=50", { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHouseLedger(data.entries);
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionId]);

  const fetchSettlements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/settlements?limit=30", { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSettlements(data.settlements);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const searchPlayers = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setPlayerResults([]);
        return;
      }
      try {
        const res = await fetch(`/api/admin/players/search?q=${encodeURIComponent(query)}`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setPlayerResults(data.players);
      } catch (e: any) {
        setError(e.message);
      }
    },
    [sessionId]
  );

  const fetchPlayerDetail = useCallback(
    async (playerId: string) => {
      try {
        const res = await fetch(`/api/admin/players/${playerId}`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setPlayerDetail({
          ...data.player,
          balances: data.balances,
          transactions: data.transactions,
          recentMatches: data.recentMatches,
        });
      } catch (e: any) {
        setError(e.message);
      }
    },
    [sessionId]
  );

  const fetchLiveMatches = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/broadcast/live", { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLiveMatches(data.matches);
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionId]);

  const fetchBroadcastMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/broadcast/metrics?limit=20", { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBroadcastSummary(data.summary);
      setBroadcastRecent(data.recent);
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionId]);

  const featureMatch = async (roomId: string) => {
    setFeaturingRoom(roomId);
    try {
      const res = await fetch("/api/admin/broadcast/feature", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchLiveMatches();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFeaturingRoom(null);
    }
  };

  const unfeatureMatch = async (roomId: string) => {
    setFeaturingRoom(roomId);
    try {
      const res = await fetch("/api/admin/broadcast/unfeature", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchLiveMatches();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFeaturingRoom(null);
    }
  };

  const fetchBillingSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/billing/summary", { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBillingSummary(data);
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionId]);

  const fetchBillingEvents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/billing/events?limit=30", { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBillingEvents(data.events || []);
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionId]);

  const fetchBillingSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/billing/sessions?limit=30", { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBillingSessions(data.sessions || []);
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchRevenue();
    fetchHouseLedger();
  }, [fetchRevenue, fetchHouseLedger]);

  useEffect(() => {
    if (activeTab === "settlements" && settlements.length === 0) {
      fetchSettlements();
    }
    if (activeTab === "broadcast") {
      fetchLiveMatches();
      fetchBroadcastMetrics();
    }
    if (activeTab === "billing") {
      fetchBillingSummary();
      fetchBillingEvents();
      fetchBillingSessions();
    }
  }, [activeTab, fetchSettlements, fetchLiveMatches, fetchBroadcastMetrics]);

  const goldRevenue = revenue?.byCurrency.find((r) => r.currency === "gold_coins");
  const sweepsRevenue = revenue?.byCurrency.find((r) => r.currency === "sweeps_coins");

  const tabs = [
    { id: "revenue" as const, label: "Revenue", icon: DollarSign },
    { id: "settlements" as const, label: "Settlements", icon: Activity },
    { id: "players" as const, label: "Players", icon: Users },
    { id: "broadcast" as const, label: "Broadcast", icon: Radio },
    { id: "billing" as const, label: "Billing", icon: Coins },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center">
            <Shield className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Admin Dashboard</h1>
            <p className="text-sm text-zinc-500">Platform operations & revenue</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            fetchRevenue();
            fetchHouseLedger();
            if (activeTab === "settlements") fetchSettlements();
            if (activeTab === "broadcast") { fetchLiveMatches(); fetchBroadcastMetrics(); }
            if (activeTab === "billing") { fetchBillingSummary(); fetchBillingEvents(); fetchBillingSessions(); }
          }}
          className="gap-2 text-zinc-400 border-zinc-700"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 p-1 bg-zinc-900 rounded-xl border border-zinc-800">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all",
                activeTab === tab.id
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Revenue Tab */}
      {activeTab === "revenue" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium mb-3">
                <TrendingUp className="w-4 h-4" />
                TOTAL RAKE COLLECTED
              </div>
              <div className="text-3xl font-bold text-zinc-100 font-mono">
                {revenue ? revenue.totalRakeCollected.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {revenue ? `${revenue.totalRakeTransactions} transactions` : ""}
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center gap-2 text-amber-500 text-xs font-medium mb-3">
                <DollarSign className="w-4 h-4" />
                GOLD COIN RAKE
              </div>
              <div className="text-3xl font-bold text-amber-400 font-mono">
                {goldRevenue ? goldRevenue.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "0.00"}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {goldRevenue ? `${goldRevenue.transaction_count} collections` : "No collections"}
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center gap-2 text-violet-500 text-xs font-medium mb-3">
                <DollarSign className="w-4 h-4" />
                COIN RAKE (ALL)
              </div>
              <div className="text-3xl font-bold text-violet-400 font-mono">
                {sweepsRevenue ? sweepsRevenue.total_revenue.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "0.00"}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {sweepsRevenue ? `${sweepsRevenue.transaction_count} collections` : "No collections"}
              </div>
            </div>
          </div>

          {/* Recent House Ledger */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">Recent Rake Ledger</h2>
              <span className="text-xs text-zinc-500">{houseLedger.length} entries</span>
            </div>
            {houseLedger.length === 0 ? (
              <div className="px-5 py-8 text-center text-zinc-500 text-sm">No rake entries yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                      <th className="text-left px-5 py-3 font-medium">Date</th>
                      <th className="text-left px-5 py-3 font-medium">Type</th>
                      <th className="text-left px-5 py-3 font-medium">Currency</th>
                      <th className="text-right px-5 py-3 font-medium">Amount</th>
                      <th className="text-left px-5 py-3 font-medium">Stake</th>
                      <th className="text-left px-5 py-3 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {houseLedger.map((entry) => (
                      <tr key={entry.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                        <td className="px-5 py-3 text-zinc-400 text-xs font-mono whitespace-nowrap">
                          {new Date(entry.created_at).toLocaleString()}
                        </td>
                        <td className="px-5 py-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            {entry.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={cn("text-xs font-medium", entry.currency === "gold_coins" ? "text-amber-400" : "text-violet-400")}>
                            {entry.currency === "gold_coins" ? "Gold" : "Sweeps"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right font-mono text-zinc-100">
                          +{entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-3 text-zinc-400 text-xs">{entry.stake_id || "—"}</td>
                        <td className="px-5 py-3 text-zinc-500 text-xs max-w-[200px] truncate">{entry.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Settlements Tab */}
      {activeTab === "settlements" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">Recent Staked Match Settlements</h2>
              <span className="text-xs text-zinc-500">{settlements.length} matches</span>
            </div>
            {settlements.length === 0 ? (
              <div className="px-5 py-8 text-center text-zinc-500 text-sm">No staked match settlements yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                      <th className="text-left px-5 py-3 font-medium">Date</th>
                      <th className="text-left px-5 py-3 font-medium">Players</th>
                      <th className="text-left px-5 py-3 font-medium">Winner</th>
                      <th className="text-center px-5 py-3 font-medium">Score</th>
                      <th className="text-left px-5 py-3 font-medium">End Reason</th>
                      <th className="text-left px-5 py-3 font-medium">Stake</th>
                      <th className="text-right px-5 py-3 font-medium">Rake</th>
                      <th className="text-left px-5 py-3 font-medium">Replay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlements.map((s) => (
                      <tr key={s.replay_id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                        <td className="px-5 py-3 text-zinc-400 text-xs font-mono whitespace-nowrap">
                          {new Date(s.ended_at).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-zinc-300 text-xs">
                          {s.player1_username} vs {s.player2_username}
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-emerald-400 text-xs font-medium">{s.winner_username || "—"}</span>
                        </td>
                        <td className="px-5 py-3 text-center text-zinc-300 font-mono text-xs">
                          {s.winner_score}–{s.loser_score}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold border",
                              s.end_reason === "completed"
                                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                : s.end_reason === "forfeit"
                                ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                            )}
                          >
                            {(s.end_reason || "unknown").toUpperCase()}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-zinc-400 text-xs">{s.stake_id || "free"}</td>
                        <td className="px-5 py-3 text-right">
                          {s.rake_amount != null ? (
                            <span className={cn("font-mono text-xs", s.currency === "gold_coins" ? "text-amber-400" : "text-violet-400")}>
                              {s.rake_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-zinc-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs">
                          <span className="text-zinc-600 font-mono text-[10px]">{s.replay_id.slice(0, 8)}…</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Players Tab */}
      {activeTab === "players" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Search Bar */}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                id="admin-player-search"
                type="text"
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchPlayers(playerSearch)}
                placeholder="Search by username..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <Button variant="primary" onClick={() => searchPlayers(playerSearch)} className="px-6">
              Search
            </Button>
          </div>

          {/* Player Results */}
          {playerResults.length > 0 && !playerDetail && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-200">{playerResults.length} player(s) found</h2>
              </div>
              {playerResults.map((p) => (
                <button
                  key={p.id}
                  onClick={() => fetchPlayerDetail(p.id)}
                  className="w-full flex items-center justify-between px-5 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-xs font-bold">
                      {p.username[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-zinc-100">
                        {p.username}
                        {p.is_admin && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            ADMIN
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500">
                        Rating: {p.rating} · {p.wins}W / {p.losses}L · Coins: {p.balances.gold_coins.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600" />
                </button>
              ))}
            </div>
          )}

          {/* Player Detail View */}
          {playerDetail && (
            <div className="space-y-4">
              <button
                onClick={() => setPlayerDetail(null)}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
              >
                ← Back to results
              </button>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-lg font-bold">
                    {playerDetail.username[0]?.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-100">
                      {playerDetail.username}
                      {playerDetail.is_admin && (
                        <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                          ADMIN
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-zinc-500">{playerDetail.email} · Joined {new Date(playerDetail.created_at).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="text-[10px] text-zinc-500 font-medium">RATING</div>
                    <div className="text-lg font-bold font-mono text-zinc-100">{playerDetail.rating}</div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="text-[10px] text-zinc-500 font-medium">W / L</div>
                    <div className="text-lg font-bold font-mono text-zinc-100">{playerDetail.wins} / {playerDetail.losses}</div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="text-[10px] text-amber-500 font-medium">GOLD</div>
                    <div className="text-lg font-bold font-mono text-amber-400">{playerDetail.balances.gold_coins.toLocaleString()}</div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="text-[10px] text-zinc-500 font-medium">SWEEPS (LEGACY)</div>
                    <div className="text-lg font-bold font-mono text-zinc-600">{playerDetail.balances.sweeps_coins.toLocaleString()}</div>
                  </div>
                </div>
              </div>

              {/* Player Transactions */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-zinc-800">
                  <h3 className="text-sm font-semibold text-zinc-200">Recent Transactions</h3>
                </div>
                {playerDetail.transactions.length === 0 ? (
                  <div className="px-5 py-6 text-center text-zinc-500 text-sm">No transactions.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                          <th className="text-left px-5 py-2 font-medium">Date</th>
                          <th className="text-left px-5 py-2 font-medium">Type</th>
                          <th className="text-left px-5 py-2 font-medium">Currency</th>
                          <th className="text-right px-5 py-2 font-medium">Amount</th>
                          <th className="text-right px-5 py-2 font-medium">Balance After</th>
                          <th className="text-left px-5 py-2 font-medium">Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {playerDetail.transactions.map((txn: any, i: number) => (
                          <tr key={txn.id || i} className="border-b border-zinc-800/50">
                            <td className="px-5 py-2 text-zinc-400 text-xs font-mono whitespace-nowrap">
                              {new Date(txn.created_at).toLocaleString()}
                            </td>
                            <td className="px-5 py-2 text-zinc-300 text-xs">{txn.type}</td>
                            <td className="px-5 py-2">
                              <span className={cn("text-xs", txn.currency === "gold_coins" ? "text-amber-400" : "text-violet-400")}>
                                {txn.currency === "gold_coins" ? "Coins" : "Coins"}
                              </span>
                            </td>
                            <td className={cn("px-5 py-2 text-right font-mono text-xs", txn.amount > 0 ? "text-emerald-400" : "text-rose-400")}>
                              {txn.amount > 0 ? "+" : ""}
                              {txn.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-5 py-2 text-right font-mono text-xs text-zinc-300">
                              {txn.balance_after.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-5 py-2 text-zinc-500 text-xs max-w-[200px] truncate">{txn.note || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Empty State */}
          {playerResults.length === 0 && !playerDetail && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-12 text-center">
              <Users className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
              <p className="text-sm text-zinc-500">Search for a player by username to inspect their wallet and activity.</p>
            </div>
          )}
        </motion.div>
      )}

      {/* Broadcast Tab */}
      {activeTab === "broadcast" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Broadcast Summary Cards */}
          {broadcastSummary && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center gap-2 text-rose-400 text-xs font-medium mb-3">
                  <Tv className="w-4 h-4" />
                  TOTAL BROADCASTS
                </div>
                <div className="text-3xl font-bold text-zinc-100 font-mono">{broadcastSummary.totalBroadcasts}</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium mb-3">
                  <Eye className="w-4 h-4" />
                  TOTAL UNIQUE VIEWERS
                </div>
                <div className="text-3xl font-bold text-emerald-400 font-mono">{broadcastSummary.totalUniqueViewers}</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-medium mb-3">
                  <TrendingUp className="w-4 h-4" />
                  PEAK ALL-TIME
                </div>
                <div className="text-3xl font-bold text-amber-400 font-mono">{broadcastSummary.peakAllTimeViewers}</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <div className="flex items-center gap-2 text-violet-400 text-xs font-medium mb-3">
                  <Star className="w-4 h-4" />
                  ADMIN FEATURED
                </div>
                <div className="text-3xl font-bold text-violet-400 font-mono">{broadcastSummary.adminFeaturedCount}</div>
              </div>
            </div>
          )}

          {/* Live Matches Section */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </div>
                <h2 className="text-sm font-semibold text-zinc-200">Live Matches</h2>
                <span className="text-xs text-zinc-500">{liveMatches.length} active</span>
              </div>
              <button onClick={fetchLiveMatches} className="text-xs text-indigo-400 hover:text-indigo-300">
                Refresh
              </button>
            </div>
            {liveMatches.length === 0 ? (
              <div className="px-5 py-12 text-center text-zinc-500 text-sm">
                <Radio className="w-8 h-8 mx-auto mb-3 text-zinc-700" />
                No live matches right now.
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/50">
                {liveMatches.map((m) => (
                  <div key={m.roomId} className="px-5 py-4 hover:bg-zinc-800/20 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-zinc-100">
                            {m.player1.username} vs {m.player2.username}
                          </span>
                          <span className="text-xs text-zinc-500">
                            ({m.player1.rating} / {m.player2.rating})
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {m.reasons.map(r => {
                            const colors: Record<string, string> = {
                              tournament: "bg-amber-500/20 text-amber-300 border-amber-500/30",
                              high_stakes: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
                              featured: "bg-violet-500/20 text-violet-300 border-violet-500/30",
                              ranked: "bg-rose-500/20 text-rose-300 border-rose-500/30",
                            };
                            return (
                              <span key={r} className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${colors[r] || "bg-zinc-700 text-zinc-300"}`}>
                                {r.toUpperCase()}
                              </span>
                            );
                          })}
                          {!m.isSpectatable && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-zinc-700/50 text-zinc-500 border border-zinc-600/30">
                              NOT SPECTATABLE
                            </span>
                          )}
                          {m.isAdminFeatured && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30">
                              ⭐ ADMIN PICK
                            </span>
                          )}
                        </div>
                        {!m.isSpectatable && m.ineligibilityReason && (
                          <p className="text-[10px] text-zinc-600 mt-1">{m.ineligibilityReason}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-zinc-500">
                          <span>Score: {m.scores ? `${m.scores.player1}–${m.scores.player2}` : "—"}</span>
                          <span>Round: {m.roundNumber ?? "—"}</span>
                          <span>Stake: {m.stakeId}</span>
                          <span>👁 {m.spectatorCount}</span>
                          {m.broadcastStats && (
                            <span>Peak: {m.broadcastStats.peakConcurrent} / Unique: {m.broadcastStats.uniqueSpectators}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        {m.isAdminFeatured ? (
                          <button
                            onClick={() => unfeatureMatch(m.roomId)}
                            disabled={featuringRoom === m.roomId}
                            className="px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            Unfeature
                          </button>
                        ) : (
                          <button
                            onClick={() => featureMatch(m.roomId)}
                            disabled={featuringRoom === m.roomId}
                            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            <Star className="w-3 h-3 inline mr-1" />
                            Feature
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Broadcast History */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-200">Recent Broadcast History</h2>
            </div>
            {broadcastRecent.length === 0 ? (
              <div className="px-5 py-8 text-center text-zinc-500 text-sm">No broadcast history yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-500 text-xs border-b border-zinc-800">
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
                    {broadcastRecent.map((m, i) => (
                      <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                        <td className="px-5 py-3 text-zinc-300 text-xs">
                          {m.player1Username} vs {m.player2Username}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {m.featuredReasons.map(r => (
                              <span key={r} className="px-1 py-0.5 rounded text-[8px] font-bold bg-zinc-700/50 text-zinc-400">
                                {r}
                              </span>
                            ))}
                            {m.wasAdminFeatured && (
                              <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-violet-500/20 text-violet-300">
                                admin
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-center font-mono text-xs text-amber-400">
                          {m.peakConcurrentSpectators}
                        </td>
                        <td className="px-5 py-3 text-center font-mono text-xs text-zinc-300">
                          {m.totalUniqueSpectators}
                        </td>
                        <td className="px-5 py-3 text-emerald-400 text-xs font-medium">
                          {m.winnerUsername || "—"}
                        </td>
                        <td className="px-5 py-3 text-zinc-400 text-xs">
                          {m.matchDurationSeconds ? `${Math.floor(m.matchDurationSeconds / 60)}m` : "—"}
                        </td>
                        <td className="px-5 py-3 text-zinc-500 text-xs font-mono">
                          {new Date(m.endedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="text-xs text-zinc-600 px-2">
            Admin featuring cannot override player spectate preferences. If a player has disabled spectating, featured matches involving them will not appear to spectators.
          </div>
        </motion.div>
      )}

      {/* Billing Tab */}
      {activeTab === "billing" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Billing Mode + Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center gap-2 text-xs font-medium mb-3">
                <Zap className={cn("w-4 h-4", billingSummary?.billingMode === "live" ? "text-emerald-400" : "text-amber-400")} />
                <span className={billingSummary?.billingMode === "live" ? "text-emerald-400" : "text-amber-400"}>
                  {billingSummary?.billingMode === "live" ? "LIVE BILLING" : "DRY-RUN MODE"}
                </span>
              </div>
              <div className="text-lg font-bold text-zinc-100">
                {billingSummary?.billingMode === "live" ? "Production" : "Development"}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">
                Webhook: {billingSummary?.webhookSignatureVerification || "unknown"}
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-medium mb-3">
                <Coins className="w-4 h-4" />
                COIN PURCHASE REVENUE
              </div>
              <div className="text-3xl font-bold text-amber-400 font-mono">
                ${(billingSummary?.revenue?.coinPurchaseRevenue || 0).toFixed(2)}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {billingSummary?.revenue?.coinPurchaseCount || 0} purchases
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center gap-2 text-violet-400 text-xs font-medium mb-3">
                <Crown className="w-4 h-4" />
                SUBSCRIPTION REVENUE
              </div>
              <div className="text-3xl font-bold text-violet-400 font-mono">
                ${(billingSummary?.revenue?.subscriptionRevenue || 0).toFixed(2)}
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {billingSummary?.revenue?.subscriptionCount || 0} subscriptions
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center gap-2 text-zinc-400 text-xs font-medium mb-3">
                <Activity className="w-4 h-4" />
                SESSION STATUS
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-amber-400 font-mono">{billingSummary?.sessions?.pending || 0} pending</span>
                <span className="text-rose-400 font-mono">{billingSummary?.sessions?.failed || 0} failed</span>
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                {billingSummary?.sessions?.cancelled || 0} cancelled
              </div>
            </div>
          </div>

          {/* Billing Sessions */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">Recent Billing Sessions</h2>
              <span className="text-xs text-zinc-500">{billingSessions.length} sessions</span>
            </div>
            {billingSessions.length === 0 ? (
              <div className="px-5 py-8 text-center text-zinc-500 text-sm">No billing sessions yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                      <th className="text-left px-5 py-3 font-medium">Date</th>
                      <th className="text-left px-5 py-3 font-medium">User</th>
                      <th className="text-left px-5 py-3 font-medium">Type</th>
                      <th className="text-left px-5 py-3 font-medium">Package</th>
                      <th className="text-right px-5 py-3 font-medium">Amount</th>
                      <th className="text-left px-5 py-3 font-medium">Status</th>
                      <th className="text-left px-5 py-3 font-medium">Premium</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingSessions.map((s: any) => (
                      <tr key={s.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                        <td className="px-5 py-3 text-zinc-400 text-xs font-mono whitespace-nowrap">
                          {new Date(s.created_at).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-zinc-300 text-xs">{s.username}</td>
                        <td className="px-5 py-3">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold border",
                            s.type === "coin_purchase"
                              ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                              : "bg-violet-500/20 text-violet-400 border-violet-500/30"
                          )}>
                            {s.type === "coin_purchase" ? "PURCHASE" : "SUBSCRIPTION"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-zinc-400 text-xs">{s.package_id}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-zinc-100">
                          ${s.amount_usd?.toFixed(2)}
                        </td>
                        <td className="px-5 py-3">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold border",
                            s.status === "completed" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : s.status === "pending" ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                              : s.status === "failed" ? "bg-rose-500/20 text-rose-400 border-rose-500/30"
                              : "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"
                          )}>
                            {s.status?.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs">
                          <span className={s.premiumStatus === "premium" ? "text-amber-400" : "text-zinc-500"}>
                            {s.premiumStatus}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Webhook Events */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">Recent Webhook Events</h2>
              <span className="text-xs text-zinc-500">{billingEvents.length} events</span>
            </div>
            {billingEvents.length === 0 ? (
              <div className="px-5 py-8 text-center text-zinc-500 text-sm">No webhook events yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-500 text-xs border-b border-zinc-800">
                      <th className="text-left px-5 py-3 font-medium">Date</th>
                      <th className="text-left px-5 py-3 font-medium">Event Type</th>
                      <th className="text-left px-5 py-3 font-medium">Status</th>
                      <th className="text-left px-5 py-3 font-medium">Details</th>
                      <th className="text-left px-5 py-3 font-medium">Event ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billingEvents.map((e: any) => (
                      <tr key={e.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                        <td className="px-5 py-3 text-zinc-400 text-xs font-mono whitespace-nowrap">
                          {new Date(e.created_at).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-zinc-300 text-xs font-mono">{e.event_type}</td>
                        <td className="px-5 py-3">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold border",
                            e.status === "processed" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : e.status === "ignored" ? "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"
                              : "bg-rose-500/20 text-rose-400 border-rose-500/30"
                          )}>
                            {e.status?.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-zinc-500 text-xs max-w-[200px] truncate">{e.details || "—"}</td>
                        <td className="px-5 py-3 text-zinc-600 font-mono text-[10px]">{e.stripe_event_id?.slice(0, 16)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
