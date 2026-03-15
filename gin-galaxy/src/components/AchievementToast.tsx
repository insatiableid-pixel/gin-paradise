/**
 * AchievementToast — Animated toast banner for newly unlocked achievements.
 *
 * Polls /api/profile/notifications on a timer, queues up unseen
 * notifications, and shows them one-at-a-time with a slide-in animation.
 * Auto-dismisses on the server after display to keep the feed clean.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuthStore } from "@/src/lib/store";
import { Award, Star, Crown, Shield, X } from "lucide-react";

interface AchievementNotification {
  id: string;
  achievementId: string;
  triggerSource: string;
  createdAt: number;
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

const TIER_COLORS: Record<string, string> = {
  bronze: "from-amber-700/90 to-amber-900/90 border-amber-500/50",
  silver: "from-slate-500/90 to-slate-700/90 border-slate-400/50",
  gold: "from-amber-500/90 to-amber-700/90 border-amber-400/50",
  platinum: "from-cyan-600/90 to-cyan-800/90 border-cyan-400/50",
  diamond: "from-violet-600/90 to-violet-800/90 border-violet-400/50",
};

const TIER_GLOW: Record<string, string> = {
  bronze: "shadow-amber-700/40",
  silver: "shadow-slate-400/40",
  gold: "shadow-amber-400/50",
  platinum: "shadow-cyan-400/50",
  diamond: "shadow-violet-400/60",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  milestone: <Award className="w-6 h-6" />,
  competitive: <Star className="w-6 h-6" />,
  prestige: <Crown className="w-6 h-6" />,
  training: <Shield className="w-6 h-6" />,
};

// Poll interval: 15 seconds
const POLL_INTERVAL_MS = 15_000;
// Display duration per toast: 6 seconds
const TOAST_DURATION_MS = 6_000;

export function AchievementToast() {
  const { sessionId } = useAuthStore();
  const [queue, setQueue] = useState<AchievementNotification[]>([]);
  const [current, setCurrent] = useState<AchievementNotification | null>(null);
  const [visible, setVisible] = useState(false);
  const dismissedRef = useRef(new Set<string>());

  // Poll for notifications
  const fetchNotifications = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch("/api/profile/notifications", {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.notifications?.length > 0) {
        // Filter out already-displayed ones
        const fresh = data.notifications.filter(
          (n: AchievementNotification) => !dismissedRef.current.has(n.id)
        );
        if (fresh.length > 0) {
          setQueue(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const newOnes = fresh.filter((n: AchievementNotification) => !existingIds.has(n.id));
            return [...prev, ...newOnes];
          });
        }
      }
    } catch {
      // Silent fail — notification polling is non-critical
    }
  }, [sessionId]);

  // Poll timer
  useEffect(() => {
    if (!sessionId) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionId, fetchNotifications]);

  // Process queue → show toast
  useEffect(() => {
    if (current || queue.length === 0) return;

    const next = queue[0];
    setQueue(prev => prev.slice(1));
    setCurrent(next);

    // Animate in
    requestAnimationFrame(() => {
      setVisible(true);
    });

    // Auto-dismiss after duration
    const timer = setTimeout(() => {
      handleDismiss(next.id);
    }, TOAST_DURATION_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, current]);

  const handleDismiss = useCallback(async (notifId: string) => {
    setVisible(false);
    dismissedRef.current.add(notifId);

    // Animate out, then clear
    setTimeout(() => {
      setCurrent(null);
    }, 400);

    // Server dismiss (fire-and-forget)
    if (sessionId) {
      fetch("/api/profile/notifications/dismiss", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionId}`,
        },
        body: JSON.stringify({ notificationIds: [notifId] }),
      }).catch(() => {});
    }
  }, [sessionId]);

  if (!current) return null;

  const def = current.definition;
  const tier = def?.tier || "bronze";
  const tierColor = TIER_COLORS[tier] || TIER_COLORS.bronze;
  const tierGlow = TIER_GLOW[tier] || TIER_GLOW.bronze;
  const icon = CATEGORY_ICONS[def?.category || "milestone"] || CATEGORY_ICONS.milestone;

  return (
    <div
      className={`
        fixed top-6 right-6 z-[9999] max-w-sm w-full
        transition-all duration-500 ease-out
        ${visible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"}
      `}
      id="achievement-toast"
    >
      <div
        className={`
          relative bg-gradient-to-br ${tierColor}
          border rounded-2xl p-5 backdrop-blur-lg
          shadow-2xl ${tierGlow}
          overflow-hidden
        `}
      >
        {/* Shimmer effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-shimmer pointer-events-none" />

        {/* Dismiss button */}
        <button
          onClick={() => handleDismiss(current.id)}
          className="absolute top-3 right-3 text-white/50 hover:text-white/90 transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Content */}
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-white">
            {def?.icon ? (
              <span className="text-2xl">{def.icon}</span>
            ) : (
              icon
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
                Achievement Unlocked
              </span>
              <span className={`
                text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full
                ${tier === "diamond" ? "bg-violet-400/20 text-violet-300" :
                  tier === "platinum" ? "bg-cyan-400/20 text-cyan-300" :
                  tier === "gold" ? "bg-amber-400/20 text-amber-300" :
                  tier === "silver" ? "bg-slate-400/20 text-slate-300" :
                  "bg-amber-700/20 text-amber-400"}
              `}>
                {tier}
              </span>
            </div>

            {/* Name */}
            <h3 className="text-lg font-bold text-white leading-tight">
              {def?.name || current.achievementId}
            </h3>

            {/* Description */}
            {def?.description && (
              <p className="text-sm text-white/70 mt-1 leading-snug">
                {def.description}
              </p>
            )}

            {/* Prestige unlock callout */}
            {current.prestigeUnlock && (
              <div className="mt-2 flex items-center gap-2 text-xs text-white/80 bg-white/10 rounded-lg px-3 py-1.5">
                <Crown className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  <span className="font-semibold text-white">Prestige Unlock:</span>{" "}
                  {current.prestigeUnlock.label} ({current.prestigeUnlock.type})
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
