import React, { useState, useEffect } from "react";
import { Trophy, Medal, Crown, TrendingUp, Calendar, Clock, ChevronRight, Flame, Timer } from "lucide-react";
import { Card } from "@/src/components/ui/Card";
import { cn } from "@/src/lib/utils";

interface LeaderboardEntry {
  rank: number;
  username: string;
  rating: number;
  winRate: string;
  matches: number;
  seasonWins?: number;
  seasonLosses?: number;
  ratingTier?: { tier: string; color: string };
}

interface SeasonInfo {
  id: string;
  name: string;
  number: number;
  theme: string;
  endAt: number;
  status: string;
}

interface SeasonCurrent {
  season: {
    id: string;
    name: string;
    number: number;
    startAt: number;
    endAt: number;
    status: string;
    theme: string;
    daysRemaining: number;
    totalDays: number;
    progress: number;
  };
}

// ── Public Player Inspect Modal ───────────────────────────────────

interface PublicProfile {
  user: {
    username: string;
    rating: number;
    wins: number;
    losses: number;
    totalMatches: number;
    winRate: number;
    globalRank: number;
    joinedAt: string;
    ratingTier: { tier: string; color: string };
    currentWinStreak: number;
  };
  tournamentStats: { entered: number; won: number; bestFinish: string };
  seasonStats?: {
    seasonalRating: number;
    seasonWins: number;
    seasonLosses: number;
    seasonRank: number;
    seasonName: string;
  } | null;
  recentHighlights?: { result: string; opponent: string; endReason: string; playedAt: number }[];
  achievements: { achievementId: string; definition: { name: string; tier: string; icon: string } | null }[];
  achievementCount: number;
  prestige: { type: string; key: string; label: string }[];
  profile: { selectedTitle: string | null; selectedBadge: string | null; selectedFrame: string | null; bio: string };
}

const TIER_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  diamond: { bg: "bg-cyan-400/15", text: "text-cyan-400", border: "border-cyan-500/40" },
  gold: { bg: "bg-yellow-500/15", text: "text-yellow-500", border: "border-yellow-600/40" },
  silver: { bg: "bg-zinc-400/10", text: "text-zinc-300", border: "border-zinc-500/40" },
  bronze: { bg: "bg-amber-900/20", text: "text-amber-600", border: "border-amber-700/40" },
  zinc: { bg: "bg-zinc-800/30", text: "text-zinc-500", border: "border-zinc-700/40" },
};

const RATING_TIER_GRADIENT: Record<string, string> = {
  diamond: "from-cyan-400 to-blue-500",
  gold: "from-yellow-400 to-amber-500",
  silver: "from-zinc-300 to-zinc-400",
  bronze: "from-amber-700 to-amber-800",
  zinc: "from-zinc-600 to-zinc-700",
};

function PlayerInspectModal({ username, onClose }: { username: string; onClose: () => void }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/profile/${username}`)
      .then(r => r.json())
      .then(d => setProfile(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [username]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (!profile) return null;

  const { user, tournamentStats, seasonStats, recentHighlights, achievements, prestige, profile: profileData } = profile;
  const tierColors = TIER_BADGE[user.ratingTier?.color] || TIER_BADGE.zinc;
  const gradient = RATING_TIER_GRADIENT[user.ratingTier?.color] || "from-emerald-500 to-emerald-600";
  const selectedTitle = prestige.find(p => p.type === "title" && p.key === profileData.selectedTitle)?.label;
  const selectedBadge = prestige.find(p => p.type === "badge" && p.key === profileData.selectedBadge)?.label;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative p-6 pb-4 border-b border-emerald-800/40">
          <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-amber-500/8 to-transparent rounded-full blur-3xl" />
          <div className="relative flex items-center gap-4">
            <div className={cn(
              "w-16 h-16 rounded-full bg-gradient-to-tr flex-shrink-0 flex items-center justify-center text-2xl font-bold text-white shadow-xl",
              gradient,
              profileData.selectedFrame === "champion_frame" ? "ring-3 ring-yellow-500/60" : "",
            )}>
              {user.username?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold truncate">{user.username}</h2>
                <span className={cn("px-2 py-0.5 rounded-full text-xs font-bold border", tierColors.bg, tierColors.text, tierColors.border)}>
                  {user.ratingTier?.tier}
                </span>
                {selectedTitle && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {selectedTitle}
                  </span>
                )}
                {selectedBadge && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    {selectedBadge}
                  </span>
                )}
              </div>
              {profileData.bio && <p className="text-sm text-zinc-400 mt-1">{profileData.bio}</p>}
              <p className="text-xs text-zinc-500 mt-1">
                Joined {new Date(user.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                {" · "}{profile.achievementCount} achievement{profile.achievementCount !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="p-4 grid grid-cols-4 gap-3">
          <div className="text-center">
            <div className="text-lg font-bold text-zinc-100">{user.rating}</div>
            <div className="text-[10px] text-zinc-500 uppercase font-medium">Rating</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-amber-500">#{user.globalRank}</div>
            <div className="text-[10px] text-zinc-500 uppercase font-medium">Rank</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-emerald-500">{user.winRate}%</div>
            <div className="text-[10px] text-zinc-500 uppercase font-medium">Win Rate</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-zinc-100">{user.totalMatches}</div>
            <div className="text-[10px] text-zinc-500 uppercase font-medium">Matches</div>
          </div>
        </div>

        {/* Season Standing */}
        {seasonStats && seasonStats.seasonWins + seasonStats.seasonLosses > 0 && (
          <div className="mx-4 mb-3 p-3 rounded-xl bg-gradient-to-r from-emerald-500/10 to-emerald-500/5 border border-emerald-500/20">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-medium text-emerald-300">{seasonStats.seasonName}</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-sm font-bold text-zinc-100">{seasonStats.seasonalRating}</div>
                <div className="text-[10px] text-zinc-500">Season Rating</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold text-amber-500">#{seasonStats.seasonRank}</div>
                <div className="text-[10px] text-zinc-500">Season Rank</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold">
                  <span className="text-emerald-500">{seasonStats.seasonWins}W</span>
                  {" / "}
                  <span className="text-rose-500">{seasonStats.seasonLosses}L</span>
                </div>
                <div className="text-[10px] text-zinc-500">Record</div>
              </div>
            </div>
          </div>
        )}

        {/* Tournament & Streak */}
        <div className="mx-4 mb-3 grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800/60">
            <div className="flex items-center gap-2 mb-1.5">
              <Trophy className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-medium text-zinc-400">Tournaments</span>
            </div>
            <div className="text-sm font-medium text-zinc-200">
              {tournamentStats.won} won / {tournamentStats.entered} entered
            </div>
          </div>
          <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800/60">
            <div className="flex items-center gap-2 mb-1.5">
              <Flame className="w-3.5 h-3.5 text-orange-500" />
              <span className="text-xs font-medium text-zinc-400">Win Streak</span>
            </div>
            <div className={cn("text-sm font-medium", user.currentWinStreak >= 3 ? "text-orange-500" : "text-zinc-200")}>
              {user.currentWinStreak > 0 ? `${user.currentWinStreak} in a row 🔥` : "No streak"}
            </div>
          </div>
        </div>

        {/* Recent Highlights */}
        {recentHighlights && recentHighlights.length > 0 && (
          <div className="mx-4 mb-3">
            <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Recent Matches</h4>
            <div className="space-y-1.5">
              {recentHighlights.slice(0, 5).map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className={cn(
                    "w-8 text-center text-xs font-bold px-1.5 py-0.5 rounded",
                    m.result === "win" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400",
                  )}>
                    {m.result === "win" ? "W" : "L"}
                  </span>
                  <span className="text-zinc-300 truncate flex-1">vs {m.opponent || "Unknown"}</span>
                  <span className="text-[10px] text-zinc-600">
                    {new Date(m.playedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Achievements Preview */}
        {achievements.length > 0 && (
          <div className="mx-4 mb-4">
            <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
              Achievements ({profile.achievementCount})
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {achievements.slice(0, 8).map(a => {
                if (!a.definition) return null;
                const tc = TIER_BADGE[a.definition.tier] || TIER_BADGE.bronze;
                return (
                  <span key={a.achievementId} className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-medium border",
                    tc.bg, tc.text, tc.border,
                  )}>
                    {a.definition.name}
                  </span>
                );
              })}
              {achievements.length > 8 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium text-zinc-500 bg-zinc-800 border border-zinc-700">
                  +{achievements.length - 8} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Close Button */}
        <div className="p-4 border-t border-zinc-800/60 text-center">
          <button
            className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium text-zinc-300 transition-colors"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Leaderboard Component ────────────────────────────────────

export function Leaderboard() {
  const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
  const [view, setView] = useState<"lifetime" | "seasonal">("seasonal");
  const [seasonInfo, setSeasonInfo] = useState<SeasonCurrent["season"] | null>(null);
  const [inspectUsername, setInspectUsername] = useState<string | null>(null);

  useEffect(() => {
    // Fetch season info
    fetch("/api/seasons/current")
      .then(r => r.json())
      .then(d => setSeasonInfo(d.season || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`/api/leaderboard?view=${view}`)
      .then(r => r.json())
      .then(d => setPlayers(d.leaderboard || []))
      .catch(() => {});
  }, [view]);

  const topThree = players.slice(0, 3);
  const padded = [...topThree];
  while (padded.length < 3) padded.push({ rank: padded.length + 1, username: "—", rating: 0, winRate: "N/A", matches: 0 });

  return (
    <div className="space-y-8 pb-20 md:pb-0 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {view === "seasonal" ? "Season Leaderboard" : "Global Leaderboard"}
          </h1>
        <p className="text-emerald-300/60 mt-1">
            {view === "seasonal"
              ? `Compete for the top spot this season.`
              : "All-time player rankings by Elo rating."}
          </p>
        </div>
      </div>

      {/* View Toggle + Season Info */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex bg-emerald-950/40 p-1 rounded-lg border border-emerald-800/40">
            <button
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-all",
              view === "seasonal"
                ? "bg-emerald-700 text-white shadow-lg shadow-emerald-500/20"
                : "text-emerald-400/50 hover:text-emerald-200"
            )}
            onClick={() => setView("seasonal")}
          >
            <Calendar className="w-4 h-4 inline mr-1.5 -mt-0.5" />
            Seasonal
          </button>
            <button
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-all",
              view === "lifetime"
                ? "bg-emerald-700 text-white shadow-lg shadow-emerald-500/20"
                : "text-emerald-400/50 hover:text-emerald-200"
            )}
            onClick={() => setView("lifetime")}
          >
            <Trophy className="w-4 h-4 inline mr-1.5 -mt-0.5" />
            All-Time
          </button>
        </div>

        {view === "seasonal" && seasonInfo && (
          <div className="flex items-center gap-3 flex-1 justify-end">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-zinc-300">{seasonInfo.name}: {seasonInfo.theme}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
              <Timer className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-medium text-zinc-300">{seasonInfo.daysRemaining}d left</span>
            </div>
          </div>
        )}
      </div>

      {/* Season Progress Bar */}
      {view === "seasonal" && seasonInfo && (
        <div className="relative overflow-hidden rounded-xl border border-emerald-800/40 bg-gradient-to-r from-emerald-950/40 via-[#0a2e1e]/60 to-emerald-950/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-200">{seasonInfo.name}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {seasonInfo.theme}
              </span>
            </div>
            <span className="text-xs text-zinc-400">
              {seasonInfo.progress}% complete · {seasonInfo.daysRemaining} days remaining
            </span>
          </div>
          <div className="h-2 bg-[#0a2e1e]/80 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-1000"
              style={{ width: `${seasonInfo.progress}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
            <span>{new Date(seasonInfo.startAt).toLocaleDateString()}</span>
            <span>{new Date(seasonInfo.endAt).toLocaleDateString()}</span>
          </div>
        </div>
      )}

      {/* Top 3 Podium */}
      <div className="grid grid-cols-3 gap-4 mb-8 items-end h-64">
        {/* 2nd Place */}
        <div className="flex flex-col items-center cursor-pointer group" onClick={() => padded[1].username !== "—" && setInspectUsername(padded[1].username)}>
          <div className="w-16 h-16 rounded-full bg-zinc-800 border-4 border-zinc-400 flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(161,161,170,0.3)] group-hover:scale-110 transition-transform">
            <span className="font-bold text-xl text-zinc-300">{padded[1].username.substring(0,2).toUpperCase()}</span>
          </div>
          <div className="text-sm font-bold text-emerald-200 group-hover:text-amber-400 transition-colors">{padded[1].username}</div>
          <div className="text-xs text-zinc-400 mb-2">{padded[1].rating || "—"}</div>
          <div className="w-full h-32 bg-gradient-to-t from-zinc-800 to-zinc-700 rounded-t-lg flex justify-center pt-4 border-t border-x border-zinc-600">
            <Medal className="w-8 h-8 text-zinc-400" />
          </div>
        </div>

        {/* 1st Place */}
        <div className="flex flex-col items-center cursor-pointer group" onClick={() => padded[0].username !== "—" && setInspectUsername(padded[0].username)}>
          <Crown className="w-8 h-8 text-amber-500 mb-2 animate-bounce" />
          <div className="w-20 h-20 rounded-full bg-zinc-800 border-4 border-amber-500 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(245,158,11,0.4)] group-hover:scale-110 transition-transform">
            <span className="font-bold text-2xl text-amber-500">{padded[0].username.substring(0,2).toUpperCase()}</span>
          </div>
          <div className="text-base font-bold text-amber-500 group-hover:text-amber-400 transition-colors">{padded[0].username}</div>
          <div className="text-sm text-amber-500/80 mb-2">{padded[0].rating || "—"}</div>
          <div className="w-full h-40 bg-gradient-to-t from-amber-900/50 to-amber-700/50 rounded-t-lg flex justify-center pt-4 border-t border-x border-amber-600/50">
            <span className="text-4xl font-black text-amber-500/50">1</span>
          </div>
        </div>

        {/* 3rd Place */}
        <div className="flex flex-col items-center cursor-pointer group" onClick={() => padded[2].username !== "—" && setInspectUsername(padded[2].username)}>
          <div className="w-16 h-16 rounded-full bg-zinc-800 border-4 border-amber-700 flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(180,83,9,0.3)] group-hover:scale-110 transition-transform">
            <span className="font-bold text-xl text-amber-700">{padded[2].username.substring(0,2).toUpperCase()}</span>
          </div>
          <div className="text-sm font-bold text-emerald-200 group-hover:text-amber-400 transition-colors">{padded[2].username}</div>
          <div className="text-xs text-zinc-400 mb-2">{padded[2].rating || "—"}</div>
          <div className="w-full h-24 bg-gradient-to-t from-zinc-900 to-zinc-800 rounded-t-lg flex justify-center pt-4 border-t border-x border-zinc-700">
            <Medal className="w-8 h-8 text-amber-700" />
          </div>
        </div>
      </div>

      {/* List */}
      <Card className="bg-zinc-900/50 border-zinc-800/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-zinc-400 uppercase bg-zinc-900/80 border-b border-zinc-800">
              <tr>
                <th scope="col" className="px-6 py-4 font-medium">Rank</th>
                <th scope="col" className="px-6 py-4 font-medium">Player</th>
                <th scope="col" className="px-6 py-4 font-medium text-right">
                  {view === "seasonal" ? "Season Rating" : "Rating"}
                </th>
                <th scope="col" className="px-6 py-4 font-medium text-right hidden sm:table-cell">Win Rate</th>
                <th scope="col" className="px-6 py-4 font-medium text-right hidden md:table-cell">
                  {view === "seasonal" ? "Season Matches" : "Matches"}
                </th>
                <th scope="col" className="px-6 py-4 font-medium text-right w-10"></th>
              </tr>
            </thead>
            <tbody>
              {players.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-zinc-500">
                    {view === "seasonal"
                      ? "No seasonal matches yet. Play to climb the ladder!"
                      : "No players yet. Be the first to play!"}
                  </td>
                </tr>
              ) : (
                players.map((player, index) => (
                  <tr
                    key={player.username}
                    className={cn(
                      "border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors cursor-pointer",
                      index < 3 ? "bg-zinc-900/20" : ""
                    )}
                    onClick={() => setInspectUsername(player.username)}
                  >
                    <td className="px-6 py-4 font-medium text-zinc-400">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "w-6 text-center",
                          index === 0 ? "text-amber-500 font-bold" :
                          index === 1 ? "text-zinc-300 font-bold" :
                          index === 2 ? "text-amber-700 font-bold" : ""
                        )}>
                          {player.rank}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400 border border-zinc-700">
                          {player.username.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <span className={cn("font-medium", index === 0 ? "text-amber-500" : "text-zinc-200")}>
                            {player.username}
                          </span>
                          {view === "seasonal" && player.ratingTier && (
                            <span className={cn(
                              "ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold",
                              TIER_BADGE[player.ratingTier.color]?.bg,
                              TIER_BADGE[player.ratingTier.color]?.text,
                            )}>
                              {player.ratingTier.tier}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-bold text-zinc-100">
                      {player.rating}
                    </td>
                    <td className="px-6 py-4 text-right hidden sm:table-cell text-zinc-400">
                      {player.winRate}
                    </td>
                    <td className="px-6 py-4 text-right hidden md:table-cell text-zinc-500">
                      {player.matches}
                    </td>
                    <td className="px-3 py-4 text-right">
                      <ChevronRight className="w-4 h-4 text-emerald-600 group-hover:text-amber-400" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Player Inspect Modal */}
      {inspectUsername && (
        <PlayerInspectModal username={inspectUsername} onClose={() => setInspectUsername(null)} />
      )}
    </div>
  );
}
