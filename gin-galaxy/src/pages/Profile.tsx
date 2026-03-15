/**
 * Profile, Achievement & Prestige Page for Gin Paradise.
 *
 * Rich player identity surface with:
 *  - Player card with prestige title, badge, frame, and rating tier
 *  - Lifetime match record, rating context, and recent form
 *  - Tournament participation stats
 *  - Server-backed achievement showcase with progress indicators
 *  - Prestige customization (title/badge/frame selector)
 *  - Public/shareable profile link
 *  - Training highlights and improvement indicators
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  User, Settings, Shield, History, Award, BarChart3, Trophy, Crown,
  Star, Flame, Target, Zap, Flag, Medal, Search, BookOpen, Calendar,
  DollarSign, ShieldCheck, CheckCircle, TrendingUp, Gem, Swords,
  Share2, Copy, Check, ChevronDown, ChevronUp, Crosshair, Sparkles,
  Timer,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { cn } from "@/src/lib/utils";
import { useAuthStore } from "@/src/lib/store";

// ── Icon Map ─────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  Swords, Trophy, Crown, Star, Gem, TrendingUp, Zap, Flag, Award, Medal,
  Search, Target, Crosshair, CheckCircle, BookOpen, Flame, Shield, Calendar,
  DollarSign, ShieldCheck,
};

// ── Types ────────────────────────────────────────────────────────────

interface ProfileData {
  user: {
    id: string;
    username: string;
    rating: number;
    wins: number;
    losses: number;
    totalMatches: number;
    winRate: number;
    globalRank: number;
    totalPlayers: number;
    joinedAt: string;
    ratingTier: { tier: string; color: string };
    currentWinStreak: number;
    recentAccuracy: number | null;
  };
  tournamentStats: { entered: number; won: number; bestFinish: string };
  seasonStats?: {
    seasonId: string;
    seasonName: string;
    seasonNumber: number;
    seasonalRating: number;
    seasonWins: number;
    seasonLosses: number;
    seasonMatches: number;
    seasonRank: number;
    totalSeasonPlayers: number;
    seasonEndAt: number;
    seasonStartAt: number;
    daysRemaining: number;
    seasonStatus: string;
  } | null;
  achievements: {
    achievementId: string;
    awardedAt: number;
    context: string | null;
    definition: AchievementDef | null;
  }[];
  achievementCount: number;
  bestTier: string;
  prestige: { type: string; key: string; label: string; sourceAchievement: string; unlockedAt: number }[];
  profile: { selectedTitle: string | null; selectedBadge: string | null; selectedFrame: string | null; bio: string };
  recentRecord: { wins: number; losses: number; total: number };
  newAwards: { achievementId: string; definition: AchievementDef | null }[];
  allAchievements: (AchievementDef & { earned: boolean; earnedAt: number | null })[];
}

interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  tier: string;
  prestigeUnlock?: { type: string; key: string; label: string };
}

// ── Tier Colors ──────────────────────────────────────────────────────

const TIER_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  bronze: { bg: "bg-amber-900/20", text: "text-amber-600", border: "border-amber-700/40", glow: "shadow-amber-900/10" },
  silver: { bg: "bg-zinc-400/10", text: "text-zinc-300", border: "border-zinc-500/40", glow: "shadow-zinc-500/10" },
  gold: { bg: "bg-yellow-500/15", text: "text-yellow-500", border: "border-yellow-600/40", glow: "shadow-yellow-500/10" },
  diamond: { bg: "bg-cyan-400/15", text: "text-cyan-400", border: "border-cyan-500/40", glow: "shadow-cyan-400/20" },
};

const RATING_TIER_COLORS: Record<string, string> = {
  diamond: "from-cyan-400 to-blue-500",
  gold: "from-yellow-400 to-amber-500",
  silver: "from-zinc-300 to-zinc-400",
  bronze: "from-amber-700 to-amber-800",
  zinc: "from-zinc-600 to-zinc-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  competitive: "Competitive",
  tournament: "Tournament",
  training: "Training",
  consistency: "Consistency",
  prestige: "Prestige",
};

// ── Component ────────────────────────────────────────────────────────

export function Profile() {
  const { user, sessionId } = useAuthStore();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "achievements" | "prestige">("overview");
  const [copiedLink, setCopiedLink] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [bioText, setBioText] = useState("");
  const [showCustomize, setShowCustomize] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch("/api/profile", {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      const body = await res.json();
      setData(body);
      setBioText(body.profile?.bio || "");
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleShareProfile = () => {
    const url = `${window.location.origin}/api/profile/${data?.user?.username}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const updateProfile = async (updates: Record<string, any>) => {
    if (!sessionId) return;
    setSaving(true);
    try {
      await fetch("/api/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionId}`,
        },
        body: JSON.stringify(updates),
      });
      await fetchProfile();
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const handleBackfill = async () => {
    if (!sessionId) return;
    try {
      await fetch("/api/profile/backfill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionId}`,
        },
      });
      await fetchProfile();
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center text-zinc-500 mt-20">
        <p>Unable to load profile.</p>
      </div>
    );
  }

  const { user: profileUser, tournamentStats, seasonStats, achievements, prestige, profile, recentRecord, allAchievements } = data;

  const frameClass = profile.selectedFrame === "champion_frame"
    ? "ring-4 ring-yellow-500/60 ring-offset-2 ring-offset-zinc-950"
    : "";

  const selectedTitleLabel = prestige.find(p => p.type === "title" && p.key === profile.selectedTitle)?.label;
  const selectedBadgeLabel = prestige.find(p => p.type === "badge" && p.key === profile.selectedBadge)?.label;

  return (
    <div className="space-y-8 pb-20 md:pb-0 max-w-6xl mx-auto">
      {/* ── New Award Toast ── */}
      {data.newAwards.length > 0 && (
        <div className="bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border border-yellow-500/30 rounded-xl p-4 animate-pulse">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-yellow-500" />
            <span className="text-yellow-200 font-medium">
              🎉 New achievement{data.newAwards.length > 1 ? "s" : ""} unlocked!{" "}
              {data.newAwards.map(a => a.definition?.name).join(", ")}
            </span>
          </div>
        </div>
      )}

      {/* ── Player Identity Card ── */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900/80 via-zinc-900/60 to-zinc-950/80 p-6 md:p-8">
        {/* Background gradient accent */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-indigo-600/10 to-transparent rounded-full blur-3xl" />

        <div className="relative flex flex-col md:flex-row gap-6 md:gap-8 items-start md:items-center">
          {/* Avatar with Frame */}
          <div className={cn(
            "w-28 h-28 rounded-full bg-gradient-to-tr flex-shrink-0 flex items-center justify-center text-4xl font-bold text-white shadow-2xl",
            RATING_TIER_COLORS[profileUser.ratingTier.color] || "from-indigo-500 to-purple-500",
            frameClass
          )}>
            {profileUser.username?.[0]?.toUpperCase()}
          </div>

          {/* Identity Info */}
          <div className="flex-1 space-y-2 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight">{profileUser.username}</h1>

              {/* Rating Tier Badge */}
              <span className={cn(
                "px-2.5 py-0.5 rounded-full text-xs font-bold border",
                TIER_COLORS[profileUser.ratingTier.color]?.bg || "bg-zinc-800",
                TIER_COLORS[profileUser.ratingTier.color]?.text || "text-zinc-400",
                TIER_COLORS[profileUser.ratingTier.color]?.border || "border-zinc-700",
              )}>
                {profileUser.ratingTier.tier}
              </span>

              {/* Selected Title */}
              {selectedTitleLabel && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  {selectedTitleLabel}
                </span>
              )}

              {/* Selected Badge */}
              {selectedBadgeLabel && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  {selectedBadgeLabel}
                </span>
              )}
            </div>

            {/* Bio */}
            {editingBio ? (
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={bioText}
                  onChange={e => setBioText(e.target.value)}
                  maxLength={200}
                  className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1 text-sm text-zinc-200 w-64 focus:outline-none focus:border-indigo-500"
                  placeholder="Write a short bio..."
                />
                <Button size="sm" onClick={() => { updateProfile({ bio: bioText }); setEditingBio(false); }}>Save</Button>
                <Button size="sm" variant="outline" className="border-zinc-700" onClick={() => setEditingBio(false)}>Cancel</Button>
              </div>
            ) : (
              <p className="text-zinc-400 text-sm cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => setEditingBio(true)}>
                {profile.bio || "Click to add a bio..."}
              </p>
            )}

            <p className="text-zinc-500 text-xs">
              Joined {new Date(profileUser.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              {" · "}{data.achievementCount} achievement{data.achievementCount !== 1 ? "s" : ""}
              {" · "}Rank #{profileUser.globalRank} of {profileUser.totalPlayers}
            </p>

            {/* Action Bar */}
            <div className="flex gap-2 pt-1 flex-wrap">
              <Button variant="outline" size="sm" className="border-zinc-700 hover:border-indigo-500/50 transition-colors" onClick={() => setShowCustomize(!showCustomize)}>
                <Settings className="w-3.5 h-3.5 mr-1.5" /> Customize
              </Button>
              <Button variant="outline" size="sm" className="border-zinc-700 hover:border-indigo-500/50 transition-colors" onClick={handleShareProfile}>
                {copiedLink ? <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5 mr-1.5" />}
                {copiedLink ? "Link Copied!" : "Share Profile"}
              </Button>
              <Button variant="outline" size="sm" className="border-zinc-700 hover:border-amber-500/50 transition-colors" onClick={handleBackfill}>
                <Award className="w-3.5 h-3.5 mr-1.5" /> Sync Achievements
              </Button>
            </div>
          </div>

          {/* Key Stats Cards */}
          <div className="flex gap-3 flex-shrink-0">
            <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-4 py-3 text-center min-w-[80px]">
              <div className="text-xs text-zinc-500 mb-0.5">Rating</div>
              <div className="text-xl font-bold text-zinc-100">{profileUser.rating}</div>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-4 py-3 text-center min-w-[80px]">
              <div className="text-xs text-zinc-500 mb-0.5">Rank</div>
              <div className="text-xl font-bold text-amber-500">#{profileUser.globalRank}</div>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl px-4 py-3 text-center min-w-[80px]">
              <div className="text-xs text-zinc-500 mb-0.5">Win Rate</div>
              <div className="text-xl font-bold text-emerald-500">{profileUser.winRate}%</div>
            </div>
          </div>
        </div>

        {/* Prestige Customization Panel */}
        {showCustomize && (
          <div className="mt-6 pt-6 border-t border-zinc-800/60 space-y-4 animate-in slide-in-from-top-2">
            <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              Customize Your Identity
            </h3>

            <div className="grid md:grid-cols-3 gap-4">
              {/* Title Selector */}
              <div className="space-y-2">
                <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Title</label>
                <select
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500"
                  value={profile.selectedTitle || ""}
                  onChange={e => updateProfile({ selectedTitle: e.target.value || null })}
                  disabled={saving}
                >
                  <option value="">No title</option>
                  {prestige.filter(p => p.type === "title").map(p => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Badge Selector */}
              <div className="space-y-2">
                <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Badge</label>
                <select
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500"
                  value={profile.selectedBadge || ""}
                  onChange={e => updateProfile({ selectedBadge: e.target.value || null })}
                  disabled={saving}
                >
                  <option value="">No badge</option>
                  {prestige.filter(p => p.type === "badge").map(p => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Frame Selector */}
              <div className="space-y-2">
                <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Frame</label>
                <select
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500"
                  value={profile.selectedFrame || ""}
                  onChange={e => updateProfile({ selectedFrame: e.target.value || null })}
                  disabled={saving}
                >
                  <option value="">Default frame</option>
                  {prestige.filter(p => p.type === "frame").map(p => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Tab Nav ── */}
      <div className="flex gap-1 border-b border-zinc-800/60 pb-px">
        {(["overview", "achievements", "prestige"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors",
              tab === t
                ? "bg-zinc-800/60 text-zinc-100 border-b-2 border-indigo-500"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30"
            )}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* Season Standing Card */}
          {seasonStats && seasonStats.seasonMatches > 0 && (
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
                    <div className="text-xs text-zinc-500">Season Record</div>
                  </div>
                  <div className="text-center p-3 bg-zinc-900/40 rounded-xl">
                    <div className="text-xl font-bold text-zinc-100">{seasonStats.seasonMatches}</div>
                    <div className="text-xs text-zinc-500">Season Matches</div>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="mt-4">
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-600 to-purple-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.round(((Math.ceil((seasonStats.seasonEndAt - seasonStats.seasonStartAt) / (24*60*60*1000)) - seasonStats.daysRemaining) / Math.ceil((seasonStats.seasonEndAt - seasonStats.seasonStartAt) / (24*60*60*1000))) * 100))}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

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
                <span className="font-medium text-zinc-100">{profileUser.totalMatches}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-400 text-sm">Wins</span>
                <span className="font-medium text-emerald-500">{profileUser.wins}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-400 text-sm">Losses</span>
                <span className="font-medium text-rose-500">{profileUser.losses}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-400 text-sm">Win Rate</span>
                <span className="font-medium text-zinc-100">{profileUser.winRate}%</span>
              </div>
              <div className="h-px bg-zinc-800 my-1" />
              <div className="flex justify-between items-center">
                <span className="text-zinc-400 text-sm">Current Win Streak</span>
                <span className={cn("font-medium", profileUser.currentWinStreak >= 3 ? "text-amber-500" : "text-zinc-100")}>
                  {profileUser.currentWinStreak > 0 ? `${profileUser.currentWinStreak} 🔥` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-400 text-sm">Recent Form (10)</span>
                <span className="font-medium text-zinc-100">
                  <span className="text-emerald-500">{recentRecord.wins}W</span>
                  {" "}
                  <span className="text-rose-500">{recentRecord.losses}L</span>
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Tournament Stats */}
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
              <div className="h-px bg-zinc-800 my-1" />
              <div className="flex justify-between items-center">
                <span className="text-zinc-400 text-sm">Engine Accuracy</span>
                <span className={cn(
                  "font-medium",
                  profileUser.recentAccuracy && profileUser.recentAccuracy >= 80 ? "text-emerald-500" :
                  profileUser.recentAccuracy && profileUser.recentAccuracy >= 60 ? "text-amber-500" : "text-zinc-400"
                )}>
                  {profileUser.recentAccuracy ? `${profileUser.recentAccuracy}%` : "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Recent Achievements */}
          <Card className="bg-zinc-900/40 border-zinc-800/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400 flex items-center">
                <Award className="w-4 h-4 mr-2 text-amber-500" />
                Recent Achievements
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {achievements.length === 0 ? (
                <p className="text-sm text-zinc-500">No achievements yet. Play more to unlock!</p>
              ) : (
                achievements.slice(0, 5).map(a => {
                  const def = a.definition;
                  if (!def) return null;
                  const IconComp = ICON_MAP[def.icon] || Award;
                  const colors = TIER_COLORS[def.tier];
                  return (
                    <div key={a.achievementId} className="flex items-center gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center",
                        colors?.bg || "bg-zinc-800"
                      )}>
                        <IconComp className={cn("w-4 h-4", colors?.text || "text-zinc-400")} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={cn("text-sm font-medium truncate", colors?.text || "text-zinc-200")}>{def.name}</div>
                        <div className="text-xs text-zinc-500">{def.description}</div>
                      </div>
                    </div>
                  );
                })
              )}
              {achievements.length > 5 && (
                <button
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  onClick={() => setTab("achievements")}
                >
                  View all {achievements.length} achievements →
                </button>
              )}
            </CardContent>
          </Card>
          </div>
        </div>
      )}

      {/* ── Achievements Tab ── */}
      {tab === "achievements" && (
        <div className="space-y-6">
          {/* Progress Bar */}
          <Card className="bg-zinc-900/40 border-zinc-800/60">
            <CardContent className="py-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-zinc-300">
                  Achievement Progress
                </span>
                <span className="text-sm text-zinc-400">
                  {achievements.length} / {allAchievements.length}
                </span>
              </div>
              <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-600 to-purple-500 rounded-full transition-all duration-500"
                  style={{ width: `${(achievements.length / allAchievements.length) * 100}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* By Category */}
          {Object.entries(CATEGORY_LABELS).map(([catKey, catLabel]) => {
            const items = allAchievements.filter(a => a.category === catKey);
            if (items.length === 0) return null;
            const earnedCount = items.filter(a => a.earned).length;
            const isExpanded = expandedCategory === catKey || expandedCategory === null;

            return (
              <div key={catKey}>
                <button
                  className="w-full flex items-center justify-between py-2 group"
                  onClick={() => setExpandedCategory(expandedCategory === catKey ? null : catKey)}
                >
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-200">{catLabel}</h3>
                    <span className="text-xs text-zinc-500">{earnedCount}/{items.length}</span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-zinc-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-zinc-500" />
                  )}
                </button>

                {isExpanded && (
                  <div className="grid gap-3 md:grid-cols-2 mt-2">
                    {items.map(a => {
                      const IconComp = ICON_MAP[a.icon] || Award;
                      const colors = TIER_COLORS[a.tier];
                      return (
                        <div
                          key={a.id}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-xl border transition-all",
                            a.earned
                              ? `${colors?.bg} ${colors?.border} ${colors?.glow} shadow-md`
                              : "bg-zinc-900/30 border-zinc-800/40 opacity-50 grayscale"
                          )}
                        >
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0",
                            a.earned ? colors?.bg : "bg-zinc-800"
                          )}>
                            <IconComp className={cn("w-5 h-5", a.earned ? colors?.text : "text-zinc-600")} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={cn("text-sm font-semibold", a.earned ? colors?.text : "text-zinc-500")}>
                                {a.name}
                              </span>
                              <span className={cn("text-[10px] uppercase font-bold px-1.5 py-0.5 rounded", colors?.bg, colors?.text)}>
                                {a.tier}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-500 mt-0.5">{a.description}</p>
                            {a.earned && a.earnedAt && (
                              <p className="text-[10px] text-zinc-600 mt-0.5">
                                Earned {new Date(a.earnedAt).toLocaleDateString()}
                              </p>
                            )}
                            {a.prestigeUnlock && (
                              <p className="text-[10px] text-indigo-400 mt-0.5">
                                Unlocks: {a.prestigeUnlock.label} ({a.prestigeUnlock.type})
                              </p>
                            )}
                          </div>
                          {a.earned && (
                            <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Prestige Tab ── */}
      {tab === "prestige" && (
        <div className="space-y-6">
          {/* Unlocked Items */}
          <Card className="bg-zinc-900/40 border-zinc-800/60">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-zinc-400 flex items-center">
                <Crown className="w-4 h-4 mr-2 text-amber-500" />
                Unlocked Prestige Items ({prestige.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {prestige.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No prestige items unlocked yet. Earn achievements to unlock titles, badges, and avatar frames!
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {prestige.map((p, i) => {
                    const isSelected =
                      (p.type === "title" && p.key === profile.selectedTitle) ||
                      (p.type === "badge" && p.key === profile.selectedBadge) ||
                      (p.type === "frame" && p.key === profile.selectedFrame);

                    return (
                      <div
                        key={`${p.type}-${p.key}`}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer hover:border-indigo-500/40",
                          isSelected
                            ? "bg-indigo-500/10 border-indigo-500/40"
                            : "bg-zinc-900/30 border-zinc-800/40"
                        )}
                        onClick={() => {
                          if (p.type === "title") updateProfile({ selectedTitle: isSelected ? null : p.key });
                          if (p.type === "badge") updateProfile({ selectedBadge: isSelected ? null : p.key });
                          if (p.type === "frame") updateProfile({ selectedFrame: isSelected ? null : p.key });
                        }}
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center",
                          p.type === "title" ? "bg-indigo-500/20" :
                          p.type === "badge" ? "bg-amber-500/20" :
                          "bg-cyan-500/20"
                        )}>
                          {p.type === "title" && <Crown className="w-5 h-5 text-indigo-400" />}
                          {p.type === "badge" && <Award className="w-5 h-5 text-amber-400" />}
                          {p.type === "frame" && <Shield className="w-5 h-5 text-cyan-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-zinc-200">{p.label}</span>
                            <span className={cn(
                              "text-[10px] uppercase font-bold px-1.5 py-0.5 rounded",
                              p.type === "title" ? "bg-indigo-500/20 text-indigo-400" :
                              p.type === "badge" ? "bg-amber-500/15 text-amber-400" :
                              "bg-cyan-500/15 text-cyan-400"
                            )}>
                              {p.type}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            From: {ACHIEVEMENT_MAP_FROM_IDS[p.sourceAchievement] || p.sourceAchievement}
                          </p>
                          <p className="text-[10px] text-zinc-600">
                            Unlocked {new Date(p.unlockedAt).toLocaleDateString()}
                          </p>
                        </div>
                        {isSelected && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30">
                            <Check className="w-3 h-3 text-indigo-400" />
                            <span className="text-[10px] text-indigo-400 font-medium">Active</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Locked Items Preview */}
          {(() => {
            const lockedPrestige = allAchievements
              .filter(a => a.prestigeUnlock && !a.earned)
              .map(a => ({ ...a.prestigeUnlock!, achievementName: a.name, achievementDesc: a.description }));

            if (lockedPrestige.length === 0) return null;

            return (
              <Card className="bg-zinc-900/40 border-zinc-800/60">
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-zinc-400 flex items-center">
                    <Target className="w-4 h-4 mr-2 text-zinc-500" />
                    Locked Items ({lockedPrestige.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-2">
                    {lockedPrestige.map(p => (
                      <div
                        key={`locked-${p.type}-${p.key}`}
                        className="flex items-center gap-3 p-3 rounded-xl border bg-zinc-900/20 border-zinc-800/30 opacity-60 grayscale"
                      >
                        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center">
                          {p.type === "title" && <Crown className="w-5 h-5 text-zinc-600" />}
                          {p.type === "badge" && <Award className="w-5 h-5 text-zinc-600" />}
                          {p.type === "frame" && <Shield className="w-5 h-5 text-zinc-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-zinc-500">{p.label}</div>
                          <div className="text-xs text-zinc-600">{p.achievementName}: {p.achievementDesc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// Helper to map achievement IDs to names for prestige display
const ACHIEVEMENT_MAP_FROM_IDS: Record<string, string> = {
  first_match: "First Steps",
  win_10: "Getting Started",
  win_50: "Competitor",
  win_100: "Centurion",
  win_500: "Gin Master",
  rating_1400: "Rising Star",
  rating_1600: "Expert Player",
  rating_1800: "Elite",
  first_gin: "Gin!",
  first_tournament: "Tournament Debut",
  tournament_win: "Champion",
  tournament_win_3: "Serial Winner",
  first_evaluation: "Self Aware",
  accuracy_80: "Sharp Player",
  accuracy_90: "Precision",
  no_blunders: "Clean Sheet",
  evaluated_10: "Student of the Game",
  win_streak_5: "Hot Streak",
  win_streak_10: "Unstoppable",
  matches_played_100: "Veteran",
  daily_player_7: "Dedicated",
  staked_win: "High Roller",
  proof_verified: "Trust Verified",
};
