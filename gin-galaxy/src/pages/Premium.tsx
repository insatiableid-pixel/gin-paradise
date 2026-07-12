/**
 * Premium Plan & Upgrade Page for Gin Paradise.
 *
 * Displays current plan status, feature comparison between free and premium,
 * upgrade messaging, and admin grant controls (for admin users).
 * Themed with the tropical paradise visual system.
 */

import React, { useEffect, useState } from "react";
import { useAuthStore } from "@/src/lib/store";
import { cn } from "@/src/lib/utils";
import { Crown, Check, X, Sparkles, Shield, Zap, Star, RefreshCw } from "lucide-react";

interface PlanData {
  plan: string;
  displayName: string;
  isActive: boolean;
  grantedAt: string | null;
  expiresAt: string | null;
  upgradeAvailable: boolean;
  features: Array<{
    key: string;
    name: string;
    description: string;
    free: boolean;
    premium: boolean;
  }>;
}

interface FeatureData {
  features: PlanData["features"];
  plans: Array<{
    tier: string;
    displayName: string;
    price: string;
    description: string;
    highlight: boolean;
    futurePrice?: boolean;
  }>;
}

export function Premium() {
  const { user, sessionId } = useAuthStore();
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [, setFeatureData] = useState<FeatureData | null>(null);
  const [loading, setLoading] = useState(true);

  // Admin grant state
  const [grantUsername, setGrantUsername] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [grantDays, setGrantDays] = useState("");
  const [grantResult, setGrantResult] = useState<{ success: boolean; message: string } | null>(null);
  const [grantLoading, setGrantLoading] = useState(false);

  // Subscription purchase state
  const [subscribing, setSubscribing] = useState(false);
  const [subscriptionResult, setSubscriptionResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const headers = { Authorization: `Bearer ${sessionId}` };
    Promise.all([
      fetch("/api/entitlements/plan", { headers }).then(r => r.json()),
      fetch("/api/entitlements/features", { headers }).then(r => r.json()),
    ]).then(([plan, features]) => {
      setPlanData(plan);
      setFeatureData(features);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [sessionId]);

  const handleAdminGrant = async () => {
    if (!grantUsername || !grantReason) return;
    setGrantLoading(true);
    setGrantResult(null);

    try {
      // Look up user ID by username
      const searchRes = await fetch(`/api/admin/players/search?q=${encodeURIComponent(grantUsername)}`, {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      const searchData = await searchRes.json();
      if (!searchRes.ok || !searchData.players?.length) {
        setGrantResult({ success: false, message: `User "${grantUsername}" not found` });
        setGrantLoading(false);
        return;
      }

      const targetUserId = searchData.players[0].id;

      const res = await fetch("/api/entitlements/admin/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionId}` },
        body: JSON.stringify({
          userId: targetUserId,
          reason: grantReason,
          durationDays: grantDays ? parseInt(grantDays) : null,
        }),
      });
      const data = await res.json();
      setGrantResult({
        success: res.ok,
        message: res.ok ? data.message : data.error || "Grant failed",
      });
    } catch (err: any) {
      setGrantResult({ success: false, message: err?.message || "Network error" });
    }
    setGrantLoading(false);
  };

  const handleAdminRevoke = async () => {
    if (!grantUsername || !grantReason) return;
    setGrantLoading(true);
    setGrantResult(null);

    try {
      const searchRes = await fetch(`/api/admin/players/search?q=${encodeURIComponent(grantUsername)}`, {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      const searchData = await searchRes.json();
      if (!searchRes.ok || !searchData.players?.length) {
        setGrantResult({ success: false, message: `User "${grantUsername}" not found` });
        setGrantLoading(false);
        return;
      }

      const targetUserId = searchData.players[0].id;

      const res = await fetch("/api/entitlements/admin/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionId}` },
        body: JSON.stringify({
          userId: targetUserId,
          reason: grantReason,
        }),
      });
      const data = await res.json();
      setGrantResult({
        success: res.ok,
        message: res.ok ? data.message : data.error || "Revoke failed",
      });
    } catch (err: any) {
      setGrantResult({ success: false, message: err?.message || "Network error" });
    }
    setGrantLoading(false);
  };

  const handleSubscribe = async () => {
    setSubscribing(true);
    setSubscriptionResult(null);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionId}` },
        body: JSON.stringify({ planId: "premium_monthly" }),
      });
      const data = await res.json();
      setSubscriptionResult({
        success: res.ok,
        message: res.ok ? "Premium activated!" : data.error || "Subscription failed",
      });
      // Refresh plan data
      if (res.ok) {
        const planRes = await fetch("/api/entitlements/plan", { headers: { Authorization: `Bearer ${sessionId}` } });
        const planData = await planRes.json();
        setPlanData(planData);
      }
    } catch (err: any) {
      setSubscriptionResult({ success: false, message: err?.message || "Network error" });
    }
    setSubscribing(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const isPremium = planData?.isActive;
  const freeFeatures = planData?.features.filter(f => f.free) || [];
  const premiumFeatures = planData?.features.filter(f => !f.free && f.premium) || [];

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="flex items-center justify-center gap-3">
          <Crown className="w-8 h-8 text-amber-400" />
          <h1 className="text-3xl font-bold text-amber-50">Your Plan</h1>
        </div>
        <p className="text-emerald-300/60 max-w-xl mx-auto">
          Gin Paradise keeps competitive coin play available for everyone. Premium unlocks deeper analytical tools for serious improvement — it's never pay-to-win.
        </p>
      </div>

      {/* Current Plan Badge */}
      <div className={cn(
        "relative overflow-hidden rounded-2xl border p-6",
        isPremium
          ? "border-amber-500/40 bg-gradient-to-br from-amber-950/30 via-[#0a2e1e]/60 to-emerald-950/30"
          : "border-emerald-800/40 bg-emerald-950/30"
      )}>
        {isPremium && (
          <div className="absolute top-0 right-0 w-64 h-64 -mt-32 -mr-32 bg-amber-500/5 rounded-full blur-3xl" />
        )}
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className={cn(
              "flex items-center justify-center w-14 h-14 rounded-xl",
              isPremium
                ? "bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20"
                : "bg-emerald-900/60 border border-emerald-700/40"
            )}>
              {isPremium ? (
                <Crown className="w-7 h-7 text-white" />
              ) : (
                <Zap className="w-7 h-7 text-emerald-400/60" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold text-amber-50">
                {planData?.displayName || "Free"}
              </h2>
              <p className="text-sm text-emerald-300/60">
                {isPremium
                  ? planData?.expiresAt
                    ? `Active until ${new Date(planData.expiresAt).toLocaleDateString()}`
                    : "Active · Unlimited access"
                  : "Free tier · Core gameplay included"}
              </p>
            </div>
          </div>
          {isPremium && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium text-amber-300">Pro Active</span>
            </div>
          )}
        </div>
      </div>

      {/* Plan Comparison Cards */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Free Plan */}
        <div className={cn(
          "rounded-2xl border p-6 space-y-5",
          !isPremium
            ? "border-emerald-500/40 bg-emerald-950/30"
            : "border-emerald-800/30 bg-emerald-950/20"
        )}>
          {!isPremium && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-medium text-emerald-300">
              Current Plan
            </div>
          )}
          <div>
            <h3 className="text-lg font-bold text-amber-50">Free</h3>
            <p className="text-3xl font-bold mt-1 text-amber-50">$0 <span className="text-sm font-normal text-emerald-400/50">forever</span></p>
            <p className="text-sm text-emerald-300/60 mt-2">Coin-wagered PvP, daily check-in, practice matches</p>
          </div>
          <div className="space-y-3">
            {freeFeatures.map(f => (
              <div key={f.key} className="flex items-start gap-3">
                <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-100">{f.name}</p>
                  <p className="text-xs text-emerald-400/50">{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Premium Plan */}
        <div className={cn(
          "relative rounded-2xl border p-6 space-y-5",
          isPremium
            ? "border-amber-500/40 bg-gradient-to-br from-amber-950/20 via-[#0a2e1e]/40 to-emerald-950/20"
            : "border-emerald-700/40 bg-emerald-950/20"
        )}>
          {isPremium && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-xs font-medium text-amber-300">
              Current Plan
            </div>
          )}
          {!isPremium && (
            <div className="absolute top-3 right-3">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-xs font-medium text-amber-300">
                <Star className="w-3 h-3" /> Recommended
              </div>
            </div>
          )}
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2 text-amber-50">
              <Crown className="w-5 h-5 text-amber-400" />
              Gin Paradise Pro
            </h3>
            <p className="text-3xl font-bold mt-1 text-amber-50">
              $9.99 <span className="text-sm font-normal text-emerald-400/50">/month</span>
            </p>
            <p className="text-sm text-emerald-300/60 mt-2">Deep analytical coaching and exclusive features</p>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-medium text-emerald-400/50 uppercase tracking-wide">Everything in Free, plus:</p>
            {premiumFeatures.map(f => (
              <div key={f.key} className="flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-emerald-100">{f.name}</p>
                  <p className="text-xs text-emerald-400/50">{f.description}</p>
                </div>
              </div>
            ))}
          </div>
          {!isPremium && (
            <div className="pt-3 border-t border-emerald-800/40 space-y-3">
              <button
                onClick={handleSubscribe}
                disabled={subscribing}
                className={cn(
                  "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-all",
                  subscribing ? "opacity-70 cursor-wait" : "",
                  "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white shadow-[0_0_30px_-8px_rgba(245,158,11,0.4)]"
                )}
              >
                {subscribing ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Processing...</>
                ) : (
                  <><Crown className="w-4 h-4" /> Subscribe Now — $9.99/mo</>
                )}
              </button>
              {subscriptionResult && (
                <div className={cn(
                  "text-sm rounded-lg px-3 py-2 border",
                  subscriptionResult.success
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                    : "bg-rose-500/10 text-rose-300 border-rose-500/30"
                )}>
                  {subscriptionResult.message}
                </div>
              )}
              <p className="text-xs text-emerald-400/50 text-center">
                Premium is never pay-to-win. It unlocks training and coaching tools only.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Feature Comparison Table */}
      <div className="rounded-2xl border border-emerald-800/40 bg-emerald-950/20 overflow-hidden">
        <div className="px-6 py-4 border-b border-emerald-800/40">
          <h3 className="text-lg font-bold text-amber-50">Feature Comparison</h3>
        </div>
        <div className="divide-y divide-emerald-800/30">
          <div className="grid grid-cols-3 px-6 py-3 bg-[#0a2e1e]/60 text-xs font-medium text-emerald-400/50 uppercase tracking-wide">
            <span>Feature</span>
            <span className="text-center">Free</span>
            <span className="text-center">Pro</span>
          </div>
          {planData?.features.map(f => (
            <div key={f.key} className="grid grid-cols-3 px-6 py-3 items-center hover:bg-emerald-900/20 transition-colors">
              <div>
                <p className="text-sm font-medium text-emerald-100">{f.name}</p>
                <p className="text-xs text-emerald-400/40 hidden sm:block">{f.description}</p>
              </div>
              <div className="flex justify-center">
                {f.free ? (
                  <Check className="w-5 h-5 text-emerald-400" />
                ) : (
                  <X className="w-5 h-5 text-emerald-800/60" />
                )}
              </div>
              <div className="flex justify-center">
                <Check className="w-5 h-5 text-amber-400" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Admin Grant Controls (admin-only) */}
      {user?.is_admin && (
        <div className="rounded-2xl border border-emerald-800/40 bg-emerald-950/20 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-amber-50">Admin: Manage Premium Access</h3>
          </div>
          <p className="text-sm text-emerald-300/60">
            Grant or revoke premium access for any player. All actions are audited.
          </p>
          <div className="grid sm:grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Username"
              value={grantUsername}
              onChange={e => setGrantUsername(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[#0a2e1e] border border-emerald-700/40 text-sm text-emerald-100 focus:outline-none focus:border-amber-500/50"
            />
            <input
              type="text"
              placeholder="Reason (required)"
              value={grantReason}
              onChange={e => setGrantReason(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[#0a2e1e] border border-emerald-700/40 text-sm text-emerald-100 focus:outline-none focus:border-amber-500/50"
            />
            <input
              type="number"
              placeholder="Days (blank = indefinite)"
              value={grantDays}
              onChange={e => setGrantDays(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[#0a2e1e] border border-emerald-700/40 text-sm text-emerald-100 focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleAdminGrant}
              disabled={grantLoading || !grantUsername || !grantReason}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              <Crown className="w-4 h-4" />
              Grant Premium
            </button>
            <button
              onClick={handleAdminRevoke}
              disabled={grantLoading || !grantUsername || !grantReason}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              <X className="w-4 h-4" />
              Revoke Premium
            </button>
          </div>
          {grantResult && (
            <div className={`px-4 py-2 rounded-lg text-sm ${
              grantResult.success ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/10 text-rose-300 border border-rose-500/30"
            }`}>
              {grantResult.message}
            </div>
          )}
        </div>
      )}

      {/* What Premium Unlocks for Free Users */}
      {!isPremium && (
        <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-950/20 via-[#0a2e1e]/40 to-emerald-950/20 p-6 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-amber-400 mx-auto" />
          <h3 className="text-lg font-bold text-amber-50">Ready to level up your game?</h3>
          <p className="text-sm text-emerald-300/60 max-w-md mx-auto">
            Gin Paradise Pro gives you AI coaching, deep progression analysis, and advanced training tools — 
            everything you need to identify weaknesses and improve faster.
          </p>
          <p className="text-xs text-emerald-400/40">
            Premium is never pay-to-win — all competitive features remain available to every player.
          </p>
        </div>
      )}
    </div>
  );
}
