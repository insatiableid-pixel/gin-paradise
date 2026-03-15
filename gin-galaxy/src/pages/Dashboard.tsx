import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Play, Activity, Clock, Users, ArrowRight, Zap, Search, Award, Crown, Star, Shield, Flame, CalendarCheck, Target, Coins, AlertTriangle, Wallet, TrendingUp, Gift, X, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { cn } from "@/src/lib/utils";
import { useAuthStore } from "@/src/lib/store";

interface Stats {
  rating: number;
  wins: number;
  losses: number;
  totalMatches: number;
  winRate: string;
  globalRank: number;
  recentRatingChange: number;
}

interface Match {
  id: string;
  opponent_name: string;
  user_score: number;
  opponent_score: number;
  is_win: boolean;
  created_at: string;
}

interface AchievementActivity {
  achievementId: string;
  awardedAt: number;
  definition: {
    name: string;
    description: string;
    icon: string;
    category: string;
    tier: string;
  } | null;
  prestigeUnlock?: {
    type: string;
    key: string;
    label: string;
  };
}

interface ActivityData {
  recentAchievements: AchievementActivity[];
  prestige: { type: string; key: string; label: string; sourceAchievement: string }[];
  totalAchievements: number;
  totalPrestige: number;
}

const TIER_BADGE: Record<string, string> = {
  bronze: "bg-amber-700/20 text-amber-400 border-amber-700/40",
  silver: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  gold: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  platinum: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  diamond: "bg-violet-500/20 text-violet-300 border-violet-500/40",
};

// Stake thresholds for "can afford" indications
const STAKE_TIERS = [
  { coins: 100, label: "100-coin" },
  { coins: 500, label: "500-coin" },
  { coins: 2000, label: "2K-coin" },
  { coins: 5000, label: "5K-coin" },
];

export function Dashboard() {
  const { sessionId } = useAuthStore();
  const [stats, setStats] = useState<Stats | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [dailyData, setDailyData] = useState<any>(null);
  const [balances, setBalances] = useState<{ gold_coins: number; sweeps_coins: number } | null>(null);
  const [offers, setOffers] = useState<any[]>([]);
  const [offerDismissed, setOfferDismissed] = useState<Record<string, boolean>>({});
  const [offerRedeeming, setOfferRedeeming] = useState<string | null>(null);
  const [offerResult, setOfferResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const headers = { Authorization: `Bearer ${sessionId}` };

    fetch("/api/stats", { headers })
      .then(r => r.json()).then(d => setStats(d.stats)).catch(() => {});

    fetch("/api/matches", { headers })
      .then(r => r.json()).then(d => setMatches(d.matches || [])).catch(() => {});

    fetch("/api/profile/activity", { headers })
      .then(r => r.json()).then(d => setActivity(d)).catch(() => {});

    fetch("/api/daily", { headers })
      .then(r => r.json()).then(d => setDailyData(d)).catch(() => {});

    fetch("/api/wallet", { headers })
      .then(r => r.json()).then(d => setBalances(d.balances)).catch(() => {});

    fetch("/api/offers", { headers })
      .then(r => r.json()).then(d => setOffers(d.offers || [])).catch(() => {});
  }, [sessionId]);

  // Offer interaction helpers
  const trackImpression = (offerId: string) => {
    if (!sessionId) return;
    fetch(`/api/offers/${offerId}/impression`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "dashboard" }),
    }).catch(() => {});
  };

  const handleDismissOffer = (offerId: string) => {
    setOfferDismissed(prev => ({ ...prev, [offerId]: true }));
    if (!sessionId) return;
    fetch(`/api/offers/${offerId}/dismiss`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "dashboard" }),
    }).catch(() => {});
  };

  const handleRedeemOffer = async (offerId: string) => {
    if (!sessionId || offerRedeeming) return;
    setOfferRedeeming(offerId);
    setOfferResult(null);
    try {
      const authHeaders = { Authorization: `Bearer ${sessionId}`, "Content-Type": "application/json" };
      // Track click
      await fetch(`/api/offers/${offerId}/click`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ surface: "dashboard" }),
      });

      const res = await fetch(`/api/offers/${offerId}/redeem`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json();
      if (res.ok) {
        setOfferResult({
          success: true,
          message: `🎉 ${data.coinsGranted?.toLocaleString() || 0} coins added${data.premiumDaysGranted ? ` + ${data.premiumDaysGranted}-day Pro trial activated` : ""}!`,
        });
        if (data.balances) setBalances(data.balances);
        setOffers(prev => prev.filter(o => o.id !== offerId));
      } else {
        setOfferResult({ success: false, message: data.error || "Redemption failed" });
      }
    } catch {
      setOfferResult({ success: false, message: "Network error" });
    } finally {
      setOfferRedeeming(null);
    }
  };

  const timeAgo = (date: string | number) => {
    const ts = typeof date === "number" ? date : new Date(date).getTime();
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  // Compute affordable stake count
  const affordableStakes = balances
    ? STAKE_TIERS.filter(t => balances.gold_coins >= t.coins)
    : [];
  const highestAffordable = affordableStakes.length > 0
    ? affordableStakes[affordableStakes.length - 1]
    : null;
  const isLowBalance = balances && balances.gold_coins < 100;
  const hasDailyClaims = dailyData && !dailyData.streak?.todayCheckedIn;

  return (
    <div className="space-y-8 pb-20 md:pb-0">

      {/* ─── Step 1: Claim Today (if not claimed) ──────────────────── */}
      {dailyData && !dailyData.streak?.todayCheckedIn && (
        <section id="daily-claim-prompt">
          <Card className="bg-gradient-to-br from-amber-950/30 to-orange-950/20 border-amber-800/40 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 opacity-10">
              <Flame className="w-24 h-24 text-amber-500 animate-pulse" />
            </div>
            <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <CalendarCheck className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-zinc-100">Claim Today's Rewards</h2>
                  <p className="text-sm text-zinc-400">
                    {dailyData.streak?.currentStreak > 0
                      ? `${dailyData.streak.currentStreak}-day streak — keep it going!`
                      : "Start your streak and earn daily coins"
                    }
                    {" "}&middot; Up to {dailyData.totalAvailableCoins?.toLocaleString() || "750"} coins available
                  </p>
                </div>
              </div>
              <Link to="/daily">
                <Button
                  variant="primary"
                  className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 font-bold px-6 py-3 rounded-xl shadow-lg shadow-amber-500/20 whitespace-nowrap"
                  id="dashboard-claim-daily-btn"
                >
                  <Flame className="mr-2 w-5 h-5" /> Claim Now
                </Button>
              </Link>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ─── Starter Offer Banner ─────────────────────────────────── */}
      {offers.filter(o => !offerDismissed[o.id]).map(offer => {
        // Track impression on render
        if (typeof window !== "undefined") {
          setTimeout(() => trackImpression(offer.id), 500);
        }
        return (
          <section key={offer.id} id={`offer-banner-${offer.id}`}>
            <Card className="bg-gradient-to-br from-violet-950/40 via-indigo-950/30 to-zinc-900/30 border-violet-500/30 ring-1 ring-violet-500/10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-36 h-36 opacity-10">
                <Gift className="w-36 h-36 text-violet-400" />
              </div>
              {/* Dismiss button */}
              <button
                onClick={() => handleDismissOffer(offer.id)}
                className="absolute top-3 right-3 p-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-700/80 text-zinc-400 hover:text-zinc-200 transition-colors z-10"
                aria-label="Dismiss offer"
                id={`dismiss-offer-${offer.id}`}
              >
                <X className="w-4 h-4" />
              </button>
              <CardContent className="p-5 relative">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20 flex-shrink-0">
                      <Gift className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-lg font-bold text-zinc-100">{offer.name}</h2>
                        {offer.discountPercent > 0 && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            {offer.discountPercent}% off
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-violet-200/80">{offer.tagline}</p>
                      {/* Contents */}
                      <div className="flex flex-wrap gap-3 mt-2">
                        {offer.contents.coins && (
                          <span className="text-xs text-amber-300 flex items-center gap-1 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                            <Coins className="w-3 h-3" /> {offer.contents.coins.toLocaleString()} coins
                          </span>
                        )}
                        {offer.contents.premiumTrialDays && (
                          <span className="text-xs text-indigo-300 flex items-center gap-1 bg-indigo-500/10 px-2 py-1 rounded-lg border border-indigo-500/20">
                            <Crown className="w-3 h-3" /> {offer.contents.premiumTrialDays}-day Pro trial
                          </span>
                        )}
                      </div>
                      {offer.urgencyText && (
                        <p className="text-[10px] text-zinc-500 mt-2 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-violet-400" /> {offer.urgencyText}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    {offer.standardValueUsd > 0 && offer.priceUsd < offer.standardValueUsd && (
                      <div className="text-right">
                        <span className="text-xs text-zinc-500 line-through">${offer.standardValueUsd.toFixed(2)}</span>
                      </div>
                    )}
                    <Button
                      variant="primary"
                      className="bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 font-bold px-6 py-3 rounded-xl shadow-lg shadow-violet-500/20 whitespace-nowrap text-base"
                      onClick={() => handleRedeemOffer(offer.id)}
                      disabled={offerRedeeming !== null}
                      id={`redeem-offer-${offer.id}-btn`}
                    >
                      {offerRedeeming === offer.id ? (
                        <>Processing...</>
                      ) : offer.priceUsd > 0 ? (
                        <>${offer.priceUsd.toFixed(2)} — Claim Now</>
                      ) : (
                        <>Claim Free Trial</>
                      )}
                    </Button>
                  </div>
                </div>
                {offerResult && (
                  <div className={cn(
                    "mt-3 text-sm rounded-lg px-4 py-2 border",
                    offerResult.success
                      ? "bg-emerald-950/40 border-emerald-800/40 text-emerald-300"
                      : "bg-rose-950/40 border-rose-800/40 text-rose-300"
                  )}>
                    {offerResult.message}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        );
      })}

      {/* ─── Step 2: Bankroll + Play CTA ───────────────────────────── */}
      <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="col-span-full lg:col-span-2 bg-gradient-to-br from-indigo-950/50 to-zinc-900/50 border-indigo-900/50 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
          <CardContent className="relative p-8 md:p-12 flex flex-col justify-center h-full space-y-6">
            <div className="space-y-2">
              <h1 className="text-4xl md:text-5xl font-bold tracking-tighter text-white">
                Play Gin Rummy
              </h1>
              <p className="text-lg text-indigo-200/80 max-w-md">
                Compete against players worldwide. Analyze your games. Climb the leaderboard.
              </p>
            </div>

            {/* Bankroll indicator */}
            {balances && (
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/60">
                  <Coins className="w-4 h-4 text-amber-400" />
                  <span className="text-lg font-bold text-zinc-100">{balances.gold_coins.toLocaleString()}</span>
                  <span className="text-xs text-zinc-500">coins</span>
                </div>
                {highestAffordable ? (
                  <span className="text-xs text-emerald-400/80 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    Can afford up to {highestAffordable.label} stake
                  </span>
                ) : isLowBalance ? (
                  <span className="text-xs text-amber-400/80 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Low balance — <Link to="/daily" className="underline">earn coins</Link> or <Link to="/wallet" className="underline">buy coins</Link>
                  </span>
                ) : null}
              </div>
            )}

            <div className="flex flex-wrap gap-4 pt-2">
              <Link to="/play/multiplayer?quickmatch=true">
                <Button variant="primary" size="lg" className="w-full sm:w-auto text-lg font-semibold h-14 px-8 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 shadow-[0_0_40px_-10px_rgba(245,158,11,0.5)]" id="dashboard-quick-match-btn">
                  <Search className="mr-2 h-5 w-5" /> Quick Match
                </Button>
              </Link>
              <Link to="/play">
                <Button variant="primary" size="lg" className="w-full sm:w-auto text-lg font-semibold h-14 px-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 shadow-[0_0_40px_-10px_rgba(79,70,229,0.5)]">
                  <Play className="mr-2 h-5 w-5 fill-current" /> Play vs AI
                </Button>
              </Link>
              <Link to="/play/multiplayer">
                <Button variant="outline" size="lg" className="w-full sm:w-auto text-lg h-14 px-8 rounded-xl border-zinc-700 hover:bg-zinc-800">
                  <Users className="mr-2 h-5 w-5" /> Play Friend
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <div className="space-y-6 flex flex-col">
          <Card className="flex-1 bg-zinc-900/40 border-zinc-800/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400 flex items-center">
                <Activity className="w-4 h-4 mr-2 text-emerald-500" />
                Current Rating
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold tracking-tight text-zinc-50">
                {stats?.rating ?? "—"}
              </div>
              {stats && (
                <p className={cn("text-xs mt-1 flex items-center",
                  stats.recentRatingChange >= 0 ? "text-emerald-400" : "text-rose-400"
                )}>
                  <ArrowRight className={cn("w-3 h-3 mr-1", stats.recentRatingChange >= 0 ? "-rotate-45" : "rotate-45")} />
                  {stats.recentRatingChange >= 0 ? "+" : ""}{stats.recentRatingChange} this week
                </p>
              )}
            </CardContent>
          </Card>
          
          <Card className="flex-1 bg-zinc-900/40 border-zinc-800/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-400 flex items-center">
                <Zap className="w-4 h-4 mr-2 text-amber-500" />
                Win Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold tracking-tight text-zinc-50">
                {stats ? `${stats.winRate}%` : "—"}
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                {stats ? `Over ${stats.totalMatches} match${stats.totalMatches !== 1 ? "es" : ""}` : "Play your first match!"}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ─── Daily Hub Summary (when already claimed) ──────────────── */}
      {dailyData && dailyData.streak?.todayCheckedIn && (
        <section className="space-y-4" id="daily-hub-widget">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight flex items-center">
              <CalendarCheck className="w-5 h-5 mr-2 text-amber-500" />
              Daily Hub
            </h2>
            <Link to="/daily">
              <Button variant="ghost" size="sm" className="text-indigo-400 hover:text-indigo-300">
                Go to Daily Hub <ArrowRight className="ml-1 w-4 h-4" />
              </Button>
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {/* Streak */}
            <Card className="bg-gradient-to-br from-amber-950/30 to-zinc-900/30 border-amber-900/40">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold",
                    dailyData.streak.currentStreak >= 3
                      ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white"
                      : "bg-zinc-800 text-zinc-400"
                  )}>
                    {dailyData.streak.currentStreak}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-200 flex items-center gap-1">
                      <Flame className="w-3.5 h-3.5 text-amber-500" />
                      Day Streak
                    </div>
                    <div className="text-xs text-zinc-500">
                      Checked in ✓
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Missions */}
            <Card className="bg-zinc-900/30 border-zinc-800/40">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                    <Target className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-200">
                      {dailyData.missions.filter((m: any) => m.completed).length}/{dailyData.missions.length} Missions
                    </div>
                    <div className="text-xs text-zinc-500">
                      {dailyData.missions.filter((m: any) => m.completed && !m.claimed).length > 0
                        ? "Rewards ready to claim!"
                        : "Keep playing!"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Earnings */}
            <Card className="bg-zinc-900/30 border-zinc-800/40">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <Coins className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-200">
                      {dailyData.totalClaimedCoins}/{dailyData.totalAvailableCoins}
                    </div>
                    <div className="text-xs text-zinc-500">
                      Daily coins earned
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* ─── Low Balance Nudge ─────────────────────────────────────── */}
      {isLowBalance && (!dailyData || dailyData.streak?.todayCheckedIn) && (
        <section>
          <Card className="bg-gradient-to-br from-amber-950/20 to-zinc-900/20 border-amber-800/30">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <div>
                  <p className="text-sm text-zinc-300">
                    <strong className="text-amber-300">Low balance</strong> — You need at least 100 coins for staked matches.
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Earn free coins daily or grab a coin package.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link to="/wallet">
                  <Button variant="primary" size="sm" className="bg-amber-600 hover:bg-amber-500 rounded-lg font-medium whitespace-nowrap" id="dashboard-buy-coins-btn">
                    <Coins className="w-3.5 h-3.5 mr-1.5" /> Buy Coins
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Recent Progress — Achievement Activity */}
      {activity && activity.recentAchievements.length > 0 && (
        <section className="space-y-4" id="recent-progress">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight flex items-center">
              <Award className="w-5 h-5 mr-2 text-amber-500" />
              Recent Progress
            </h2>
            <Link to="/profile">
              <Button variant="ghost" size="sm" className="text-indigo-400 hover:text-indigo-300">
                View All <ArrowRight className="ml-1 w-4 h-4" />
              </Button>
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Summary card */}
            <Card className="bg-gradient-to-br from-indigo-950/40 to-zinc-900/40 border-indigo-900/40">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-zinc-400">Progress</span>
                  <Star className="w-4 h-4 text-amber-500" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-3xl font-bold text-zinc-50">{activity.totalAchievements}</span>
                    <span className="text-xs text-zinc-500">achievements</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-semibold text-amber-400">{activity.totalPrestige}</span>
                    <span className="text-xs text-zinc-500">prestige items</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent achievement cards */}
            {activity.recentAchievements.slice(0, 5).map((ach) => (
              <Card
                key={ach.achievementId}
                className="bg-zinc-900/30 border-zinc-800/40 hover:bg-zinc-800/40 transition-colors group"
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-lg">
                      {ach.definition?.icon || "🏆"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-zinc-200 truncate">
                          {ach.definition?.name || ach.achievementId}
                        </span>
                        {ach.definition?.tier && (
                          <span className={cn(
                            "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border",
                            TIER_BADGE[ach.definition.tier] || TIER_BADGE.bronze
                          )}>
                            {ach.definition.tier}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 leading-snug truncate">
                        {ach.definition?.description || ""}
                      </p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-zinc-600">
                          {timeAgo(ach.awardedAt)}
                        </span>
                        {ach.prestigeUnlock && (
                          <span className="text-[10px] text-amber-500 flex items-center gap-1">
                            <Crown className="w-3 h-3" />
                            {ach.prestigeUnlock.label}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Recent Matches — real data */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Recent Matches</h2>
          <Button variant="ghost" size="sm" className="text-indigo-400 hover:text-indigo-300">
            View All <ArrowRight className="ml-1 w-4 h-4" />
          </Button>
        </div>
        
        <div className="grid gap-3">
          {matches.length === 0 ? (
            <Card className="bg-zinc-900/30 border-zinc-800/40 p-6 text-center">
              <p className="text-zinc-500">No matches played yet. <Link to="/play" className="text-indigo-400 hover:text-indigo-300">Play your first game →</Link></p>
            </Card>
          ) : (
            matches.map((match) => {
              const ratingDelta = match.is_win ? "+15" : "-10";
              return (
                <Card key={match.id} className="bg-zinc-900/30 border-zinc-800/40 hover:bg-zinc-800/40 transition-colors cursor-pointer group">
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-zinc-400 border border-zinc-700">
                        {match.opponent_name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-zinc-200">{match.opponent_name}</div>
                        <div className="text-xs text-zinc-500 flex items-center">
                          <Clock className="w-3 h-3 mr-1" /> {timeAgo(match.created_at)}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className="text-right hidden sm:block">
                        <div className="text-sm font-medium text-zinc-300">{match.user_score} - {match.opponent_score}</div>
                        <div className="text-xs text-zinc-500">Score</div>
                      </div>
                      <div className="text-right">
                        <div className={cn("text-sm font-bold", match.is_win ? "text-emerald-500" : "text-rose-500")}>
                          {match.is_win ? "Win" : "Loss"}
                        </div>
                        <div className={cn("text-xs", match.is_win ? "text-emerald-500/70" : "text-rose-500/70")}>
                          {ratingDelta}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity">
                        <Activity className="w-4 h-4 text-indigo-400" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
