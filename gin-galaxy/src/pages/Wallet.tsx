import React, { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Coins, Gift, Clock, ArrowUpRight, ArrowDownRight, History, Sparkles, RefreshCw, ShoppingCart, Package, CalendarCheck, ArrowRight, Flame, AlertTriangle, Crown, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { cn } from "@/src/lib/utils";
import { useAuthStore } from "@/src/lib/store";

interface Balances {
  gold_coins: number;
  sweeps_coins: number;
}

interface Transaction {
  id: string;
  currency: string;
  amount: number;
  type: string;
  balance_after: number;
  note: string | null;
  created_at: string;
}

interface CoinPackage {
  id: string;
  label: string;
  coins: number;
  priceUsd: number;
  popular?: boolean;
  bestValue?: boolean;
}

const TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  faucet:              { label: "Daily Check-in",       icon: "☀️" },
  daily_grant:         { label: "Daily Claim",          icon: "🎁" },
  streak_reward:       { label: "Streak Bonus",         icon: "🔥" },
  mission_reward:      { label: "Mission Reward",       icon: "🎯" },
  puzzle_reward:       { label: "Puzzle Reward",        icon: "🧩" },
  signup_bonus:        { label: "Welcome Bonus",        icon: "🎉" },
  buy_in:              { label: "Match Entry",          icon: "🃏" },
  escrow_hold:         { label: "Escrow Hold",          icon: "🔒" },
  escrow_release:      { label: "Escrow Release",       icon: "🔓" },
  prize_payout:        { label: "Prize Payout",         icon: "🏆" },
  rake:                { label: "Rake",                 icon: "🏦" },
  refund:              { label: "Refund",               icon: "↩️" },
  admin_grant:         { label: "Admin Credit",         icon: "⚙️" },
  admin_debit:         { label: "Admin Debit",          icon: "⚙️" },
  coin_purchase:       { label: "Coin Purchase",        icon: "💎" },
  subscription_payment:{ label: "Subscription",         icon: "👑" },
  offer_purchase:      { label: "Starter Offer",         icon: "🎁" },
};

// Minimum public coin stake
const MIN_PUBLIC_STAKE = 100;

export function Wallet() {
  const { sessionId } = useAuthStore();
  const [balances, setBalances] = useState<Balances | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [purchaseResult, setPurchaseResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [billingMode, setBillingMode] = useState<string>("unknown");
  const [dailyStatus, setDailyStatus] = useState<any>(null);
  const [offers, setOffers] = useState<any[]>([]);
  const [offerDismissed, setOfferDismissed] = useState<Record<string, boolean>>({});
  const [offerRedeeming, setOfferRedeeming] = useState<string | null>(null);
  const [offerRedeemResult, setOfferRedeemResult] = useState<{ success: boolean; message: string } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const headers = { Authorization: `Bearer ${sessionId}` };

  const fetchData = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [walletRes, historyRes, packagesRes, dailyRes] = await Promise.all([
        fetch("/api/wallet", { headers }),
        fetch("/api/wallet/history?limit=30", { headers }),
        fetch("/api/billing/packages", { headers }),
        fetch("/api/daily", { headers }),
      ]);
      const walletData = await walletRes.json();
      const historyData = await historyRes.json();
      const packagesData = await packagesRes.json();
      const dailyData = dailyRes.ok ? await dailyRes.json() : null;
      setBalances(walletData.balances);
      setTransactions(historyData.transactions || []);
      setPackages(packagesData.packages || []);
      setDailyStatus(dailyData);
      // Fetch offers
      const offersRes = await fetch("/api/offers", { headers });
      const offersData = offersRes.ok ? await offersRes.json() : { offers: [] };
      setOffers(offersData.offers || []);
    } catch {
      // Silently handle — user will see empty state
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Handle URL-based purchase/cancel results
  useEffect(() => {
    const purchaseStatus = searchParams.get("purchase");
    if (purchaseStatus === "success") {
      setPurchaseResult({ success: true, message: "Purchase completed successfully! Coins added to your wallet." });
      searchParams.delete("purchase");
      searchParams.delete("session");
      setSearchParams(searchParams, { replace: true });
      fetchData();
    } else if (purchaseStatus === "cancelled") {
      setPurchaseResult({ success: false, message: "Purchase was cancelled. No charges were made." });
      searchParams.delete("purchase");
      searchParams.delete("session");
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  // Fetch billing status
  useEffect(() => {
    if (!sessionId) return;
    fetch("/api/billing/status", { headers })
      .then(r => r.json())
      .then(d => setBillingMode(d.billingMode || "unknown"))
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePurchase = async (packageId: string) => {
    setPurchasing(packageId);
    setPurchaseResult(null);
    try {
      const res = await fetch("/api/billing/purchase", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ packageId }),
      });
      const data = await res.json();

      if (res.ok) {
        // In live mode, redirect to Stripe Checkout
        if (data.requiresCheckout && data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
          return;
        }
        // Dry-run mode: auto-fulfilled, show success
        setPurchaseResult({ success: true, message: "Coins added to your wallet!" });
        if (data.balances) setBalances(data.balances);
        fetchData();
      } else {
        setPurchaseResult({ success: false, message: data.error || "Purchase failed" });
      }
    } catch {
      setPurchaseResult({ success: false, message: "Network error. Please try again." });
    } finally {
      setPurchasing(null);
    }
  };

  const handleRedeemOffer = async (offerId: string) => {
    if (offerRedeeming) return;
    setOfferRedeeming(offerId);
    setOfferRedeemResult(null);
    try {
      await fetch(`/api/offers/${offerId}/click`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ surface: "wallet" }),
      });
      const res = await fetch(`/api/offers/${offerId}/redeem`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok) {
        // Paid offer — redirect to checkout
        if (data.requiresCheckout && data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
          return;
        }
        // Free offer — instant fulfillment
        setOfferRedeemResult({
          success: true,
          message: `🎉 ${data.coinsGranted?.toLocaleString() || 0} coins added${data.premiumDaysGranted ? ` + ${data.premiumDaysGranted}-day Pro trial activated` : ""}!`,
        });
        if (data.balances) setBalances(data.balances);
        setOffers(prev => prev.filter(o => o.id !== offerId));
        fetchData();
      } else {
        setOfferRedeemResult({ success: false, message: data.error || "Redemption failed" });
      }
    } catch {
      setOfferRedeemResult({ success: false, message: "Network error" });
    } finally {
      setOfferRedeeming(null);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  // Gameplay-framed value descriptions for packages
  function getPackageGameplayInfo(pkg: CoinPackage) {
    const entries100 = Math.floor(pkg.coins / MIN_PUBLIC_STAKE);
    const entries500 = Math.floor(pkg.coins / 500);
    const costPerEntry = (pkg.priceUsd / entries100).toFixed(2);
    let playStyle = "";
    if (entries100 <= 100) playStyle = "Cautious player — test the waters";
    else if (entries100 <= 300) playStyle = "Regular player — a few sessions";
    else playStyle = "Serious grinder — extended play";
    return { entries100, entries500, costPerEntry, playStyle };
  }

  const isLowBalance = balances && balances.gold_coins < MIN_PUBLIC_STAKE;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20 md:pb-0">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-amber-50">Wallet</h1>
        <p className="text-emerald-300/60">Your coin balance, purchases, and transaction history</p>
      </div>

      {/* Billing Mode Banner */}
      {billingMode === "dry_run" && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-300/80 text-xs">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <span>
            <strong>Dev Mode</strong> — Purchases auto-fulfill. Set STRIPE_SECRET_KEY for live billing.
          </span>
        </div>
      )}

      {/* Balance + Daily Status Row */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Coin Balance */}
        <Card className="bg-gradient-to-br from-amber-950/40 via-[#0a2e1e]/50 to-emerald-950/40 border-amber-800/40 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl -translate-y-8 translate-x-8" />
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-300/80 flex items-center">
              <Coins className="w-4 h-4 mr-2 text-amber-400" />
              Coins
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold tracking-tight text-amber-100">
              {balances?.gold_coins?.toLocaleString() ?? "—"}
            </div>
            <p className="text-xs text-amber-400/60 mt-1">Non-redeemable gameplay currency</p>
            {isLowBalance && (
              <div className="mt-3 flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Low balance — buy coins or earn via <Link to="/daily" className="underline font-medium">Daily Hub</Link></span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Daily Claim Status (read-only — directs to Daily Hub) */}
        <Card className="bg-gradient-to-br from-emerald-950/40 via-[#0a2e1e]/50 to-[#0d3828]/40 border-emerald-800/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-300/70 flex items-center">
              <CalendarCheck className="w-4 h-4 mr-2 text-emerald-400" />
              Today's Earnings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dailyStatus ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="w-4 h-4 text-amber-500" />
                    <span className="text-sm text-emerald-200/80">
                      {dailyStatus.streak?.currentStreak || 0} day streak
                    </span>
                    {dailyStatus.streak?.todayCheckedIn && (
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/30 font-medium">✓</span>
                    )}
                  </div>
                  <span className="text-sm font-bold text-amber-400">
                    {dailyStatus.totalClaimedCoins}/{dailyStatus.totalAvailableCoins} coins
                  </span>
                </div>

                <div className="h-1.5 bg-[#0a2e1e]/80 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, dailyStatus.totalAvailableCoins > 0 ? (dailyStatus.totalClaimedCoins / dailyStatus.totalAvailableCoins) * 100 : 0)}%` }}
                  />
                </div>

                <Link to="/daily">
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full bg-gradient-to-r from-emerald-700 to-emerald-600 hover:from-emerald-600 hover:to-emerald-500 rounded-lg font-semibold"
                    id="wallet-go-to-daily-btn"
                  >
                    <CalendarCheck className="w-4 h-4 mr-2" />
                    {dailyStatus.streak?.todayCheckedIn ? "View Daily Hub" : "Claim Daily Rewards"}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </Link>
              </>
            ) : (
              <div className="text-sm text-emerald-400/50">
                <Link to="/daily" className="text-amber-400 hover:text-amber-300 flex items-center gap-1">
                  Go to Daily Hub to claim rewards <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Offer Surface — above coin packages */}
      {offers.filter(o => !offerDismissed[o.id]).map(offer => {
        if (typeof window !== "undefined") {
          setTimeout(() => {
            fetch(`/api/offers/${offer.id}/impression`, {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify({ surface: "wallet" }),
            }).catch(() => {});
          }, 300);
        }
        return (
          <section key={offer.id} id={`wallet-offer-${offer.id}`}>
            <Card className="bg-gradient-to-r from-emerald-950/40 via-[#0a2e1e]/30 to-[#0d3828]/30 border-amber-600/30 ring-1 ring-amber-500/10 relative overflow-hidden">
              <button
                onClick={() => {
                  setOfferDismissed(p => ({ ...p, [offer.id]: true }));
                  fetch(`/api/offers/${offer.id}/dismiss`, {
                    method: "POST",
                    headers: { ...headers, "Content-Type": "application/json" },
                    body: JSON.stringify({ surface: "wallet" }),
                  }).catch(() => {});
                }}
                className="absolute top-2.5 right-2.5 p-1 rounded-lg bg-[#0a2e1e]/60 hover:bg-emerald-900/80 text-emerald-300/50 hover:text-emerald-200 transition-colors z-10"
                aria-label="Dismiss"
                id={`wallet-dismiss-offer-${offer.id}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/20">
                    <Gift className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-amber-100">{offer.name}</span>
                      {offer.discountPercent > 0 && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          {offer.discountPercent}% off
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-emerald-200/70 truncate">{offer.tagline}</p>
                    {offer.contents.coins && offer.contents.premiumTrialDays && (
                      <p className="text-[10px] text-emerald-400/50 mt-0.5">
                        {offer.contents.coins.toLocaleString()} coins + {offer.contents.premiumTrialDays}-day Pro trial
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 rounded-lg font-bold whitespace-nowrap flex-shrink-0 shadow-lg shadow-amber-500/20"
                  onClick={() => handleRedeemOffer(offer.id)}
                  disabled={offerRedeeming !== null}
                  id={`wallet-redeem-offer-${offer.id}-btn`}
                >
                  {offerRedeeming === offer.id ? "Processing..." :
                    offer.priceUsd > 0 ? `$${offer.priceUsd.toFixed(2)} — Claim` : "Claim Free"}
                </Button>
              </CardContent>
              {offerRedeemResult && (
                <div className={cn(
                  "mx-4 mb-3 text-xs rounded-lg px-3 py-2 border",
                  offerRedeemResult.success
                    ? "bg-emerald-950/40 border-emerald-800/40 text-emerald-300"
                    : "bg-rose-950/40 border-rose-800/40 text-rose-300"
                )}>
                  {offerRedeemResult.message}
                </div>
              )}
            </Card>
          </section>
        );
      })}

      {/* Coin Packages — with gameplay framing */}
      {packages.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-amber-400" />
            <h2 className="text-xl font-semibold tracking-tight text-amber-50">Buy Coins</h2>
          </div>

          {purchaseResult && (
            <div className={cn(
              "text-sm rounded-lg px-4 py-3 border",
              purchaseResult.success
                ? "bg-emerald-950/40 border-emerald-800/40 text-emerald-300"
                : "bg-rose-950/40 border-rose-800/40 text-rose-300"
            )}>
              {purchaseResult.message}
            </div>
          )}

          {/* Low-balance guidance */}
          {isLowBalance && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-950/20 border border-amber-800/30 text-sm">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <span className="text-amber-300 font-medium">Need coins to play?</span>
                <span className="text-emerald-200/60 ml-1">
                  The 100-coin stake needs just {MIN_PUBLIC_STAKE.toLocaleString()} coins. Grab a package below or earn free coins at the <Link to="/daily" className="text-amber-400 underline">Daily Hub</Link>.
                </span>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {packages.map(pkg => {
              const info = getPackageGameplayInfo(pkg);
              const isSelected = purchasing === pkg.id;
              return (
                <Card
                  key={pkg.id}
                  className={cn(
                    "relative overflow-hidden transition-all hover:scale-[1.02] cursor-pointer",
                    pkg.popular
                      ? "bg-gradient-to-br from-amber-950/40 via-[#0a2e1e]/50 to-emerald-950/30 border-amber-500/40 ring-1 ring-amber-500/20"
                      : pkg.bestValue
                      ? "bg-gradient-to-br from-emerald-950/50 via-[#0a2e1e]/50 to-[#0d3828]/30 border-emerald-500/40 ring-1 ring-emerald-500/20"
                      : "bg-emerald-950/30 border-emerald-800/40 hover:border-emerald-700"
                  )}
                  onClick={() => !purchasing && handlePurchase(pkg.id)}
                >
                  {pkg.popular && (
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-[10px] font-bold text-amber-300 uppercase">
                      Popular
                    </div>
                  )}
                  {pkg.bestValue && (
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-bold text-emerald-300 uppercase">
                      Best Value
                    </div>
                  )}
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Package className={cn("w-5 h-5", pkg.popular ? "text-amber-400" : pkg.bestValue ? "text-emerald-400" : "text-emerald-500/60")} />
                      <span className="text-lg font-bold text-amber-50">{pkg.label}</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-amber-100">${pkg.priceUsd.toFixed(2)}</span>
                      <span className="text-xs text-emerald-400/50">USD</span>
                    </div>

                    {/* Gameplay value framing */}
                    <div className="space-y-1 text-xs text-emerald-400/50">
                      <div className="flex items-center justify-between">
                        <span>≈ {info.entries100.toLocaleString()} entries at 100 coins</span>
                      </div>
                      {info.entries500 > 0 && (
                        <div className="flex items-center justify-between">
                          <span>≈ {info.entries500.toLocaleString()} entries at 500 coins</span>
                        </div>
                      )}
                      <div className="text-emerald-500/40 italic">{info.playStyle}</div>
                    </div>

                    <Button
                      variant="primary"
                      size="sm"
                      className={cn(
                        "w-full rounded-lg",
                        isSelected ? "opacity-70 cursor-wait" : "",
                        pkg.popular
                          ? "bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500"
                          : pkg.bestValue
                          ? "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400"
                          : "bg-emerald-800 hover:bg-emerald-700"
                      )}
                      disabled={purchasing !== null}
                      id={`buy-${pkg.id}-btn`}
                    >
                      {isSelected ? (
                        <><RefreshCw className="mr-1 h-3 w-3 animate-spin" /> Processing...</>
                      ) : (
                        <>Buy Now</>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Premium upsell (subtle) */}
          <Card className="bg-emerald-950/20 border-emerald-800/30">
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Crown className="w-4 h-4 text-amber-500" />
                <span className="text-xs text-emerald-300/60">
                  <strong className="text-emerald-200/80">Gin Paradise Pro</strong> — AI coaching, extended replays, bonus daily rewards
                </span>
              </div>
              <Link to="/premium">
                <Button variant="ghost" size="sm" className="text-xs text-amber-400 hover:text-amber-300">
                  Learn More <ArrowRight className="ml-1 w-3 h-3" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Transaction History */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2 text-amber-50">
            <History className="w-5 h-5 text-emerald-400/60" />
            Transaction History
          </h2>
          <span className="text-xs text-emerald-400/50">{transactions.length} transactions</span>
        </div>

        <div className="space-y-2">
          {transactions.length === 0 ? (
            <Card className="bg-emerald-950/30 border-emerald-800/40 p-6 text-center">
              <p className="text-emerald-400/50">No transactions yet. <Link to="/daily" className="text-amber-400 hover:text-amber-300">Earn coins at the Daily Hub!</Link></p>
            </Card>
          ) : (
            transactions.map((txn) => {
              const isCredit = txn.amount > 0;
              const typeInfo = TYPE_LABELS[txn.type] || { label: txn.type, icon: "📝" };
              return (
                <Card
                  key={txn.id}
                  className="bg-emerald-950/20 border-emerald-800/30 hover:bg-emerald-900/30 transition-colors"
                >
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-sm",
                          isCredit
                            ? "bg-emerald-950/60 border border-emerald-800/40"
                            : "bg-rose-950/60 border border-rose-800/40"
                        )}
                      >
                        {typeInfo.icon}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-emerald-100 truncate">
                          {typeInfo.label}
                        </div>
                        <div className="text-xs text-emerald-400/40 flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          {timeAgo(txn.created_at)}
                          {txn.note && (
                            <span className="text-emerald-500/30">· {txn.note}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 ml-4">
                      <div
                        className={cn(
                          "text-sm font-semibold",
                          isCredit ? "text-emerald-400" : "text-rose-400"
                        )}
                      >
                        {isCredit ? "+" : ""}
                        {txn.amount.toLocaleString()}{" "}
                        <span className="text-xs font-normal text-amber-400">
                          Coins
                        </span>
                      </div>
                      <div className="text-xs text-emerald-500/40">
                        Bal: {txn.balance_after.toLocaleString()}
                      </div>
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
