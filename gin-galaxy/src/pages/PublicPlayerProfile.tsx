/**
 * Public Player Profile Page for Gin Paradise.
 *
 * A full-page public competitive identity surface accessible via /player/:username.
 * Shows:
 *  - Player card with prestige title/badge/frame and rating tier
 *  - Lifetime stats and seasonal standing
 *  - Recent match highlights
 *  - Tournament record
 *  - Achievement showcase
 */

import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Trophy, Crown, Star, Award, BarChart3, Calendar, Timer,
  Flame, Medal, Target, Zap, Flag, Search, BookOpen, Crosshair,
  CheckCircle, DollarSign, ShieldCheck, Shield, Gem, TrendingUp, Swords,
  ArrowLeft, UserPlus, UserMinus, Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/Card";
import { cn } from "@/src/lib/utils";
import { useAuthStore } from "@/src/lib/store";

const ICON_MAP: Record<string, React.ElementType> = {
  Swords, Trophy, Crown, Star, Gem, TrendingUp, Zap, Flag, Award, Medal,
  Search, Target, Crosshair, CheckCircle, BookOpen, Flame, Shield, Calendar,
  DollarSign, ShieldCheck,
};

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

interface PublicProfileData {
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
    seasonMatches: number;
    seasonRank: number;
    seasonName: string;
    daysRemaining: number;
  } | null;
  recentHighlights?: { result: string; opponent: string; endReason: string; playedAt: number }[];
  achievements: { achievementId: string; definition: { name: string; tier: string; icon: string; description: string } | null }[];
  achievementCount: number;
  prestige: { type: string; key: string; label: string }[];
  profile: { selectedTitle: string | null; selectedBadge: string | null; selectedFrame: string | null; bio: string };
  social?: { followerCount: number; followingCount: number };
  relationship?: { isFollowing: boolean; isFollowedBy: boolean; headToHead?: { wins: number; losses: number; total: number; lastPlayed: number | null } } | null;
}

export function PublicPlayerProfile() {
  const { username } = useParams<{ username: string }>();
  const { sessionId, user: currentUser } = useAuthStore();
  const [data, setData] = useState<PublicProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);
  const [challengeSent, setChallengeSent] = useState(false);

  const headers = React.useMemo<Record<string, string>>(() => {
    const value: Record<string, string> = {};
    if (sessionId) value.Authorization = `Bearer ${sessionId}`;
    return value;
  }, [sessionId]);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    setError(false);
    setChallengeSent(false);
    fetch(`/api/profile/${username}`, { headers })
      .then(r => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(d => {
        setData(d);
        setIsFollowing(d.relationship?.isFollowing || false);
        setFollowerCount(d.social?.followerCount || 0);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [headers, username]);

  const toggleFollow = async () => {
    if (!data || !sessionId) return;
    setActionLoading(true);
    try {
      const method = isFollowing ? "DELETE" : "POST";
      const res = await fetch(`/api/social/follow-by-username/${username}`, {
        method,
        headers: { ...headers, "Content-Type": "application/json" },
      });
      const result = await res.json();
      if (result.success) {
        setIsFollowing(!isFollowing);
        setFollowerCount(result.followerCount ?? (isFollowing ? followerCount - 1 : followerCount + 1));
      }
    } catch {}
    setActionLoading(false);
  };

  const sendChallenge = async () => {
    if (!data || !sessionId || challengeSent) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/social/challenge-by-username`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ targetUsername: username }),
      });
      const result = await res.json();
      if (result.success) {
        setChallengeSent(true);
      }
    } catch {}
    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center mt-20 space-y-4">
        <h2 className="text-2xl font-bold text-zinc-300">Player Not Found</h2>
        <p className="text-zinc-500">The player <span className="text-zinc-300 font-medium">{username}</span> doesn't exist.</p>
        <Link to="/leaderboard" className="inline-flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Leaderboard
        </Link>
      </div>
    );
  }

  const { user, tournamentStats, seasonStats, recentHighlights, achievements, prestige, profile } = data;
  const tierColors = TIER_BADGE[user.ratingTier?.color] || TIER_BADGE.zinc;
  const gradient = RATING_TIER_GRADIENT[user.ratingTier?.color] || "from-indigo-500 to-purple-500";
  const selectedTitle = prestige.find(p => p.type === "title" && p.key === profile.selectedTitle)?.label;
  const selectedBadge = prestige.find(p => p.type === "badge" && p.key === profile.selectedBadge)?.label;
  const h2h = data.relationship?.headToHead;
  const isSelf = currentUser?.username === username;

  return (
    <div className="space-y-8 pb-20 md:pb-0 max-w-4xl mx-auto">
      {/* Back Link */}
      <Link to="/leaderboard" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to Leaderboard
      </Link>

      {/* Player Identity Card */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900/80 via-zinc-900/60 to-zinc-950/80 p-6 md:p-8">
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-indigo-600/10 to-transparent rounded-full blur-3xl" />

        <div className="relative flex flex-col md:flex-row gap-6 md:gap-8 items-start md:items-center">
          {/* Avatar */}
          <div className={cn(
            "w-24 h-24 md:w-28 md:h-28 rounded-full bg-gradient-to-tr flex-shrink-0 flex items-center justify-center text-4xl font-bold text-white shadow-2xl",
            gradient,
            profile.selectedFrame === "champion_frame" ? "ring-4 ring-yellow-500/60 ring-offset-2 ring-offset-zinc-950" : "",
          )}>
            {user.username?.[0]?.toUpperCase()}
          </div>

          {/* Info */}
          <div className="flex-1 space-y-2 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight">{user.username}</h1>
              <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-bold border", tierColors.bg, tierColors.text, tierColors.border)}>
                {user.ratingTier?.tier}
              </span>
              {selectedTitle && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  {selectedTitle}
                </span>
              )}
              {selectedBadge && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  {selectedBadge}
                </span>
              )}
            </div>

            {profile.bio && <p className="text-zinc-400 text-sm">{profile.bio}</p>}

            <p className="text-zinc-500 text-xs">
              Joined {new Date(user.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              {" · "}{data.achievementCount} achievement{data.achievementCount !== 1 ? "s" : ""}
              {" · "}Rank #{user.globalRank}
              {data.social && (
                <>
                  {" · "}
                  <Users className="w-3 h-3 inline-block" />
                  {" "}{data.social.followerCount} follower{data.social.followerCount !== 1 ? "s" : ""}
                </>
              )}
            </p>

            {/* Social Action Buttons */}
            {!isSelf && sessionId && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={toggleFollow}
                  disabled={actionLoading}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 disabled:opacity-50",
                    isFollowing
                      ? "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-red-900/20 hover:text-red-400 hover:border-red-500/30"
                      : "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/25"
                  )}
                >
                  {isFollowing ? <UserMinus className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                  {isFollowing ? "Unfollow" : "Follow"}
                </button>
                <button
                  onClick={sendChallenge}
                  disabled={actionLoading || challengeSent}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 disabled:opacity-50",
                    challengeSent
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                      : "bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
                  )}
                >
                  <Swords className="w-3.5 h-3.5" />
                  {challengeSent ? "Challenge Sent!" : "Challenge"}
                </button>
              </div>
            )}
          </div>

          {/* Key Stats */}
          <div className="flex gap-3 flex-shrink-0">
            <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-4 py-3 text-center min-w-[80px]">
              <div className="text-xs text-zinc-500 mb-0.5">Rating</div>
              <div className="text-xl font-bold text-zinc-100">{user.rating}</div>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-4 py-3 text-center min-w-[80px]">
              <div className="text-xs text-zinc-500 mb-0.5">Rank</div>
              <div className="text-xl font-bold text-amber-500">#{user.globalRank}</div>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-4 py-3 text-center min-w-[80px]">
              <div className="text-xs text-zinc-500 mb-0.5">Win Rate</div>
              <div className="text-xl font-bold text-emerald-500">{user.winRate}%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Head-to-Head Rivalry Card */}
      {h2h && h2h.total > 0 && (
        <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-gradient-to-r from-amber-950/30 via-zinc-900/60 to-rose-950/30 p-5">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-amber-500/10 to-transparent rounded-full blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <Swords className="w-5 h-5 text-amber-400" />
              <h3 className="text-lg font-semibold text-zinc-100">Head-to-Head Rivalry</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-zinc-900/40 rounded-xl">
                <div className="text-2xl font-bold text-emerald-500">{h2h.wins}</div>
                <div className="text-xs text-zinc-500">Your Wins</div>
              </div>
              <div className="text-center p-3 bg-zinc-900/40 rounded-xl">
                <div className="text-2xl font-bold text-zinc-100">{h2h.total}</div>
                <div className="text-xs text-zinc-500">Total Matches</div>
              </div>
              <div className="text-center p-3 bg-zinc-900/40 rounded-xl">
                <div className="text-2xl font-bold text-rose-500">{h2h.losses}</div>
                <div className="text-xs text-zinc-500">Their Wins</div>
              </div>
            </div>
            {h2h.lastPlayed && (
              <p className="text-[10px] text-zinc-600 mt-3 text-center">
                Last played {new Date(h2h.lastPlayed).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Season Standing */}
      {seasonStats && seasonStats.seasonWins + seasonStats.seasonLosses > 0 && (
        <div className="relative overflow-hidden rounded-xl border border-indigo-500/20 bg-gradient-to-r from-indigo-950/40 via-zinc-900/60 to-purple-950/40 p-5">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-indigo-500/10 to-transparent rounded-full blur-2xl" />
          <div className="relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-indigo-400" />
                <h3 className="text-lg font-semibold text-zinc-100">{seasonStats.seasonName}</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Active
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-zinc-400">
                <Timer className="w-4 h-4 text-amber-500" />
                <span>{seasonStats.daysRemaining}d remaining</span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center p-3 bg-zinc-900/40 rounded-xl">
                <div className="text-xl font-bold text-zinc-100">{seasonStats.seasonalRating}</div>
                <div className="text-xs text-zinc-500">Season Rating</div>
              </div>
              <div className="text-center p-3 bg-zinc-900/40 rounded-xl">
                <div className="text-xl font-bold text-amber-500">#{seasonStats.seasonRank}</div>
                <div className="text-xs text-zinc-500">Season Rank</div>
              </div>
              <div className="text-center p-3 bg-zinc-900/40 rounded-xl">
                <div className="text-xl font-bold">
                  <span className="text-emerald-500">{seasonStats.seasonWins}W</span>
                  <span className="text-zinc-600 mx-0.5">/</span>
                  <span className="text-rose-500">{seasonStats.seasonLosses}L</span>
                </div>
                <div className="text-xs text-zinc-500">Record</div>
              </div>
              <div className="text-center p-3 bg-zinc-900/40 rounded-xl">
                <div className="text-xl font-bold text-zinc-100">{seasonStats.seasonMatches}</div>
                <div className="text-xs text-zinc-500">Matches</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Match Statistics */}
        <Card className="bg-zinc-900/40 border-zinc-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400 flex items-center">
              <BarChart3 className="w-4 h-4 mr-2 text-indigo-400" />
              Match Statistics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 text-sm">Total Matches</span>
              <span className="font-medium text-zinc-100">{user.totalMatches}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 text-sm">Wins</span>
              <span className="font-medium text-emerald-500">{user.wins}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 text-sm">Losses</span>
              <span className="font-medium text-rose-500">{user.losses}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 text-sm">Win Rate</span>
              <span className="font-medium text-zinc-100">{user.winRate}%</span>
            </div>
            <div className="h-px bg-zinc-800 my-1" />
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 text-sm">Win Streak</span>
              <span className={cn("font-medium", user.currentWinStreak >= 3 ? "text-amber-500" : "text-zinc-100")}>
                {user.currentWinStreak > 0 ? `${user.currentWinStreak} 🔥` : "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Tournament Record */}
        <Card className="bg-zinc-900/40 border-zinc-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400 flex items-center">
              <Trophy className="w-4 h-4 mr-2 text-amber-500" />
              Tournament Record
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 text-sm">Tournaments Entered</span>
              <span className="font-medium text-zinc-100">{tournamentStats.entered}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 text-sm">Tournaments Won</span>
              <span className="font-medium text-amber-500">{tournamentStats.won}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-400 text-sm">Best Finish</span>
              <span className="font-medium text-zinc-100">{tournamentStats.bestFinish}</span>
            </div>
          </CardContent>
        </Card>

        {/* Recent Matches */}
        <Card className="bg-zinc-900/40 border-zinc-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400 flex items-center">
              <Flame className="w-4 h-4 mr-2 text-orange-500" />
              Recent Matches
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentHighlights && recentHighlights.length > 0 ? (
              recentHighlights.slice(0, 5).map((m, i) => (
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
              ))
            ) : (
              <p className="text-sm text-zinc-500">No recent matches recorded.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Achievements */}
      {achievements.length > 0 && (
        <Card className="bg-zinc-900/40 border-zinc-800/60">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-400 flex items-center">
              <Award className="w-4 h-4 mr-2 text-amber-500" />
              Achievements ({data.achievementCount})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {achievements.map(a => {
                if (!a.definition) return null;
                const IconComp = ICON_MAP[a.definition.icon] || Award;
                const tc = TIER_BADGE[a.definition.tier] || TIER_BADGE.bronze;
                return (
                  <div key={a.achievementId} className={cn(
                    "flex items-center gap-3 p-3 rounded-xl border",
                    tc.bg, tc.border,
                  )}>
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", tc.bg)}>
                      <IconComp className={cn("w-4 h-4", tc.text)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn("text-sm font-medium truncate", tc.text)}>{a.definition.name}</div>
                      <div className="text-xs text-zinc-500">{a.definition.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
