/**
 * Social Hub / Challenge Inbox page for Gin Paradise.
 *
 * Unified social competition surface:
 *  - Incoming challenge inbox with accept/decline actions → accept flows directly into match
 *  - Outbound pending challenges with cancel option
 *  - Accepted (joinable) challenges with "Join Match" action
 *  - Rematch proposals with accept/decline → accepted rematches flow into match
 *  - Challenge history (recent results)
 *  - Social notification feed with match-ready cues
 *  - Following list with availability badges
 */

import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Swords, Users, Bell, UserPlus, UserMinus, Inbox, Send,
  Clock, CheckCircle, XCircle, AlertTriangle, Trophy, ArrowRight,
  RefreshCw, Flame, Eye, Play, Zap, Circle, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/Card";
import { cn } from "@/src/lib/utils";
import { useAuthStore } from "@/src/lib/store";

interface Challenge {
  id: string;
  challengerId: string;
  challengerUsername: string;
  targetId: string;
  targetUsername: string;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  stakeId: string;
  message: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  roomId: string | null;
}

interface Rematch {
  id: string;
  player1Id: string;
  player1Username: string;
  player2Id: string;
  player2Username: string;
  proposerId: string;
  status: "proposed" | "accepted" | "declined" | "expired";
  stakeId: string;
  roomId: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

interface SocialNotification {
  id: string;
  type: string;
  fromUsername: string | null;
  message: string;
  read: boolean;
  createdAt: number;
  referenceId: string | null;
}

interface FollowEntry {
  userId: string;
  username: string;
  followedAt: number;
}

const STATUS_BADGE: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  pending: { bg: "bg-amber-500/15", text: "text-amber-400", icon: Clock },
  accepted: { bg: "bg-emerald-500/15", text: "text-emerald-400", icon: CheckCircle },
  declined: { bg: "bg-rose-500/15", text: "text-rose-400", icon: XCircle },
  expired: { bg: "bg-zinc-500/15", text: "text-emerald-300/60", icon: AlertTriangle },
  cancelled: { bg: "bg-zinc-500/15", text: "text-emerald-400/50", icon: XCircle },
};

const AVAILABILITY_BADGE: Record<string, { color: string; label: string }> = {
  online: { color: "bg-emerald-400", label: "Online" },
  in_match: { color: "bg-amber-400", label: "In Match" },
  in_queue: { color: "bg-amber-400", label: "Searching" },
  offline: { color: "bg-zinc-600", label: "Offline" },
};

export function SocialHub() {
  const { sessionId, user } = useAuthStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"inbox" | "outbox" | "active" | "history" | "following" | "notifications">("inbox");
  const [inbox, setInbox] = useState<Challenge[]>([]);
  const [outbox, setOutbox] = useState<Challenge[]>([]);
  const [accepted, setAccepted] = useState<Challenge[]>([]);
  const [rematches, setRematches] = useState<Rematch[]>([]);
  const [history, setHistory] = useState<Challenge[]>([]);
  const [following, setFollowing] = useState<FollowEntry[]>([]);
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [followAvailability, setFollowAvailability] = useState<Record<string, string>>({});

  const headers = { Authorization: `Bearer ${sessionId}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [inboxRes, outboxRes, acceptedRes, rematchRes, historyRes, followingRes, notifRes] = await Promise.all([
        fetch("/api/social/challenges/inbox", { headers }),
        fetch("/api/social/challenges/outbox", { headers }),
        fetch("/api/social/challenges/accepted", { headers }),
        fetch("/api/social/rematches", { headers }),
        fetch("/api/social/challenges/history", { headers }),
        fetch("/api/social/following", { headers }),
        fetch("/api/social/notifications", { headers }),
      ]);

      const [inboxData, outboxData, acceptedData, rematchData, historyData, followingData, notifData] = await Promise.all([
        inboxRes.json(), outboxRes.json(), acceptedRes.json(), rematchRes.json(), historyRes.json(), followingRes.json(), notifRes.json(),
      ]);

      setInbox(inboxData.challenges || []);
      setOutbox(outboxData.challenges || []);
      setAccepted(acceptedData.challenges || []);
      setRematches(rematchData.rematches || []);
      setHistory(historyData.challenges || []);
      setFollowing(followingData.following || []);
      setNotifications(notifData.notifications || []);
      setUnreadCount(notifData.unreadCount || 0);

      // Fetch availability for followed players
      const followedIds = (followingData.following || []).map((f: FollowEntry) => f.userId);
      if (followedIds.length > 0) {
        const availRes = await fetch("/api/social/availability/batch", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: followedIds }),
        });
        const availData = await availRes.json();
        setFollowAvailability(availData.availabilities || {});
      }
    } catch {
      // Silently handle
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const acceptChallenge = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/social/challenge/${id}/accept`, { method: "POST", headers });
      const data = await res.json();
      if (data.success && data.roomId) {
        // Navigate directly to multiplayer with the allocated room
        navigate(`/play/multiplayer?challengeRoom=${data.roomId}`);
        return;
      }
    } catch { /* fallthrough */ }
    await fetchData();
    setActionLoading(null);
  };

  const joinMatch = (roomId: string) => {
    navigate(`/play/multiplayer?challengeRoom=${roomId}`);
  };

  const declineChallenge = async (id: string) => {
    setActionLoading(id);
    await fetch(`/api/social/challenge/${id}/decline`, { method: "POST", headers });
    await fetchData();
    setActionLoading(null);
  };

  const cancelChallenge = async (id: string) => {
    setActionLoading(id);
    await fetch(`/api/social/challenge/${id}/cancel`, { method: "POST", headers });
    await fetchData();
    setActionLoading(null);
  };

  const acceptRematch = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/social/rematch/${id}/accept`, { method: "POST", headers });
      const data = await res.json();
      if (data.success && data.roomId) {
        navigate(`/play/multiplayer?challengeRoom=${data.roomId}`);
        return;
      }
    } catch { /* fallthrough */ }
    await fetchData();
    setActionLoading(null);
  };

  const declineRematch = async (id: string) => {
    setActionLoading(id);
    await fetch(`/api/social/rematch/${id}/decline`, { method: "POST", headers });
    await fetchData();
    setActionLoading(null);
  };

  const unfollowPlayer = async (userId: string) => {
    setActionLoading(userId);
    await fetch(`/api/social/follow/${userId}`, { method: "DELETE", headers });
    await fetchData();
    setActionLoading(null);
  };

  const markAllRead = async () => {
    await fetch("/api/social/notifications/read", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await fetchData();
  };

  const timeAgo = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return `${Math.floor(diff / 86400_000)}d ago`;
  };

  const timeRemaining = (expiresAt: number) => {
    const diff = expiresAt - Date.now();
    if (diff <= 0) return "expired";
    const mins = Math.ceil(diff / 60_000);
    return `${mins}m left`;
  };

  const activeCount = accepted.length + rematches.length;

  const tabs = [
    { key: "inbox" as const, label: "Inbox", icon: Inbox, count: inbox.length },
    { key: "active" as const, label: "Active", icon: Zap, count: activeCount },
    { key: "outbox" as const, label: "Sent", icon: Send, count: outbox.length },
    { key: "history" as const, label: "History", icon: Clock, count: 0 },
    { key: "following" as const, label: "Following", icon: Users, count: following.length },
    { key: "notifications" as const, label: "Alerts", icon: Bell, count: unreadCount },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20 md:pb-0 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Swords className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Social Hub</h1>
            <p className="text-sm text-emerald-400/50">Challenges, matches, and rivalry</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          className="px-3 py-1.5 rounded-lg bg-[#0a2e1e] border border-emerald-800/40 hover:bg-emerald-900/40 text-emerald-200 text-sm flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 bg-emerald-950/40 rounded-xl border border-emerald-800/30 p-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-all",
              tab === t.key
                ? "bg-emerald-950/40 text-amber-400 border border-amber-500/30"
                : "text-emerald-400/50 hover:text-emerald-200 hover:bg-[#0a2e1e]/40"
            )}
          >
            <t.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{t.label}</span>
            {t.count > 0 && (
              <span className={cn(
                "ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                t.key === "notifications"
                  ? "bg-rose-500/20 text-rose-400"
                  : t.key === "active"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-zinc-700 text-emerald-200"
              )}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "inbox" && (
        <div className="space-y-3">
          {inbox.length === 0 ? (
            <Card className="bg-emerald-950/30 border-emerald-800/30">
              <CardContent className="py-12 text-center">
                <Inbox className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
                <p className="text-emerald-400/50">No pending challenges</p>
                <p className="text-sm text-emerald-500/40 mt-1">Challenge someone from the leaderboard or their profile</p>
              </CardContent>
            </Card>
          ) : (
            inbox.map(ch => (
              <Card key={ch.id} className="bg-emerald-950/30 border-emerald-800/30 hover:border-amber-500/30 transition-colors">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center text-sm font-bold text-white">
                        {ch.challengerUsername?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/player/${ch.challengerUsername}`}
                            className="font-semibold text-amber-50 hover:text-amber-400 transition-colors"
                          >
                            {ch.challengerUsername}
                          </Link>
                          <Swords className="w-4 h-4 text-amber-500" />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-emerald-400/50">
                          <span>{timeAgo(ch.createdAt)}</span>
                          <span>·</span>
                          <span className="text-amber-400">{timeRemaining(ch.expiresAt)}</span>
                          {ch.message && (
                            <>
                              <span>·</span>
                              <span className="text-emerald-300/60 italic">"{ch.message}"</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => acceptChallenge(ch.id)}
                        disabled={actionLoading === ch.id}
                        className="px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5" />
                        {actionLoading === ch.id ? "..." : "Accept & Play"}
                      </button>
                      <button
                        onClick={() => declineChallenge(ch.id)}
                        disabled={actionLoading === ch.id}
                        className="px-4 py-2 rounded-lg bg-[#0a2e1e] text-emerald-300/60 border border-emerald-800/40 hover:bg-emerald-900/40 text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}

          {/* Pending rematches in inbox */}
          {rematches.filter(r => r.proposerId !== user?.id).length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-emerald-300/60 mb-2 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-amber-400" />
                Rematch Requests
              </h3>
              {rematches.filter(r => r.proposerId !== user?.id).map(r => {
                const opponentName = r.player1Id === user?.id ? r.player2Username : r.player1Username;
                return (
                  <Card key={r.id} className="bg-emerald-950/30 border-amber-500/20 hover:border-amber-500/40 transition-colors mb-2">
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-sm font-bold text-white">
                            {opponentName?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <Link to={`/player/${opponentName}`} className="font-semibold text-amber-50 hover:text-amber-400 transition-colors">
                                {opponentName}
                              </Link>
                              <Flame className="w-4 h-4 text-amber-500" />
                              <span className="text-xs text-amber-400">Rematch</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-emerald-400/50">
                              <span>{timeAgo(r.createdAt)}</span>
                              <span>·</span>
                              <span className="text-amber-400">{timeRemaining(r.expiresAt)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => acceptRematch(r.id)}
                            disabled={actionLoading === r.id}
                            className="px-4 py-2 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                          >
                            <Play className="w-3.5 h-3.5" />
                            {actionLoading === r.id ? "..." : "Accept & Play"}
                          </button>
                          <button
                            onClick={() => declineRematch(r.id)}
                            disabled={actionLoading === r.id}
                            className="px-4 py-2 rounded-lg bg-[#0a2e1e] text-emerald-300/60 border border-emerald-800/40 hover:bg-emerald-900/40 text-sm font-medium transition-colors disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "active" && (
        <div className="space-y-3">
          {activeCount === 0 ? (
            <Card className="bg-emerald-950/30 border-emerald-800/30">
              <CardContent className="py-12 text-center">
                <Zap className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
                <p className="text-emerald-400/50">No active matches</p>
                <p className="text-sm text-emerald-500/40 mt-1">Accept a challenge or rematch to see joinable matches here</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {accepted.map(ch => {
                const opponentName = ch.challengerId === user?.id ? ch.targetUsername : ch.challengerUsername;
                return (
                  <Card key={ch.id} className="bg-emerald-950/30 border-emerald-500/20 hover:border-emerald-500/40 transition-colors">
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-600 flex items-center justify-center">
                            <Play className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-emerald-300/60 text-sm">Challenge vs</span>
                              <Link to={`/player/${opponentName}`} className="font-semibold text-amber-50 hover:text-emerald-400 transition-colors">
                                {opponentName}
                              </Link>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-emerald-400/50">
                              <span className="text-emerald-400 font-medium">Ready to play</span>
                              <span>·</span>
                              <span>{timeAgo(ch.updatedAt)}</span>
                            </div>
                          </div>
                        </div>
                        {ch.roomId && (
                          <button
                            onClick={() => joinMatch(ch.roomId!)}
                            className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-bold shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 transition-all flex items-center gap-2"
                          >
                            <Play className="w-4 h-4" />
                            Join Match
                          </button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {rematches.filter(r => r.status === "proposed" && r.proposerId === user?.id).map(r => {
                const opponentName = r.player1Id === user?.id ? r.player2Username : r.player1Username;
                return (
                  <Card key={r.id} className="bg-emerald-950/30 border-amber-500/10">
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center">
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-emerald-300/60 text-sm">Rematch with</span>
                              <Link to={`/player/${opponentName}`} className="font-semibold text-amber-50 hover:text-amber-400 transition-colors">{opponentName}</Link>
                            </div>
                            <div className="text-xs text-amber-400">Waiting for response...</div>
                          </div>
                        </div>
                        <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-medium border border-amber-500/20">Pending</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </div>
      )}

      {tab === "outbox" && (
        <div className="space-y-3">
          {outbox.length === 0 ? (
            <Card className="bg-emerald-950/30 border-emerald-800/30">
              <CardContent className="py-12 text-center">
                <Send className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
                <p className="text-emerald-400/50">No pending outbound challenges</p>
              </CardContent>
            </Card>
          ) : (
            outbox.map(ch => (
              <Card key={ch.id} className="bg-emerald-950/30 border-emerald-800/30">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-600 flex items-center justify-center text-sm font-bold text-white">
                        {ch.targetUsername?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400/50 text-sm">Challenged</span>
                          <Link
                            to={`/player/${ch.targetUsername}`}
                            className="font-semibold text-amber-50 hover:text-amber-400 transition-colors"
                          >
                            {ch.targetUsername}
                          </Link>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-emerald-400/50">
                          <span>{timeAgo(ch.createdAt)}</span>
                          <span>·</span>
                          <span className="text-amber-400">{timeRemaining(ch.expiresAt)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => cancelChallenge(ch.id)}
                      disabled={actionLoading === ch.id}
                      className="px-4 py-2 rounded-lg bg-[#0a2e1e] text-emerald-300/60 border border-emerald-800/40 hover:bg-red-900/30 hover:text-red-400 hover:border-red-500/30 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-2">
          {history.length === 0 ? (
            <Card className="bg-emerald-950/30 border-emerald-800/30">
              <CardContent className="py-12 text-center">
                <Clock className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
                <p className="text-emerald-400/50">No challenge history yet</p>
              </CardContent>
            </Card>
          ) : (
            history.map(ch => {
              const badge = STATUS_BADGE[ch.status] || STATUS_BADGE.pending;
              const Icon = badge.icon;
              const isMine = ch.challengerId === user?.id;
              const opponentName = isMine ? ch.targetUsername : ch.challengerUsername;
              return (
                <div key={ch.id} className="flex items-center gap-3 p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/30">
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", badge.bg)}>
                    <Icon className={cn("w-4 h-4", badge.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-emerald-300/60">{isMine ? "You →" : "←"}</span>
                      <Link
                        to={`/player/${opponentName}`}
                        className="font-medium text-amber-50 hover:text-amber-400 truncate transition-colors"
                      >
                        {opponentName}
                      </Link>
                      {!isMine && <span className="text-emerald-300/60">→ You</span>}
                    </div>
                  </div>
                  {ch.status === "accepted" && ch.roomId && (
                    <button
                      onClick={() => joinMatch(ch.roomId!)}
                      className="px-3 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 text-xs font-medium transition-colors flex items-center gap-1"
                    >
                      <Play className="w-3 h-3" />
                      Join
                    </button>
                  )}
                  <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold border", badge.bg, badge.text, `border-${badge.text.replace("text-", "")}/30`)}>
                    {ch.status}
                  </span>
                  <span className="text-[10px] text-emerald-500/40 flex-shrink-0">{timeAgo(ch.updatedAt)}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === "following" && (
        <div className="space-y-2">
          {following.length === 0 ? (
            <Card className="bg-emerald-950/30 border-emerald-800/30">
              <CardContent className="py-12 text-center">
                <Users className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
                <p className="text-emerald-400/50">Not following anyone yet</p>
                <p className="text-sm text-emerald-500/40 mt-1">Follow players from the leaderboard or profiles</p>
              </CardContent>
            </Card>
          ) : (
            following.map(f => {
              const avail = followAvailability[f.userId] || "offline";
              const availInfo = AVAILABILITY_BADGE[avail] || AVAILABILITY_BADGE.offline;
              return (
                <div key={f.userId} className="flex items-center gap-3 p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/30 hover:border-emerald-800/40 transition-colors">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-600 flex items-center justify-center text-sm font-bold text-white">
                      {f.username?.[0]?.toUpperCase()}
                    </div>
                    <div className={cn("absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-zinc-900", availInfo.color)} title={availInfo.label} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/player/${f.username}`}
                        className="font-medium text-amber-50 hover:text-amber-400 truncate block transition-colors"
                      >
                        {f.username}
                      </Link>
                      <span className={cn(
                        "text-[9px] px-1.5 py-0.5 rounded-full font-semibold",
                        avail === "online" ? "bg-emerald-500/10 text-emerald-400" :
                        avail === "in_match" ? "bg-amber-500/10 text-amber-400" :
                        avail === "in_queue" ? "bg-amber-500/10 text-amber-400" :
                        "bg-[#0a2e1e] text-emerald-400/50"
                      )}>
                        {availInfo.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-emerald-500/40">Following since {timeAgo(f.followedAt)}</span>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      to={`/player/${f.username}`}
                      className="px-3 py-1.5 rounded-lg bg-[#0a2e1e] text-emerald-300/60 border border-emerald-800/40 hover:bg-emerald-900/40 text-xs font-medium transition-colors flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      Profile
                    </Link>
                    <button
                      onClick={() => unfollowPlayer(f.userId)}
                      disabled={actionLoading === f.userId}
                      className="px-3 py-1.5 rounded-lg bg-[#0a2e1e] text-emerald-400/50 border border-emerald-800/40 hover:bg-red-900/20 hover:text-red-400 text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      <UserMinus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === "notifications" && (
        <div className="space-y-3">
          {unreadCount > 0 && (
            <div className="flex justify-end">
              <button
                onClick={markAllRead}
                className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
              >
                Mark all as read
              </button>
            </div>
          )}
          {notifications.length === 0 ? (
            <Card className="bg-emerald-950/30 border-emerald-800/30">
              <CardContent className="py-12 text-center">
                <Bell className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
                <p className="text-emerald-400/50">No notifications</p>
              </CardContent>
            </Card>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-xl border transition-colors",
                  n.read
                    ? "bg-emerald-950/15 border-emerald-800/25"
                    : n.type === "match_ready"
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : "bg-emerald-950/40 border-amber-500/20"
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                  n.type === "match_ready" || n.type === "rematch_accepted"
                    ? "bg-emerald-500/15"
                    : n.type.includes("challenge") || n.type === "rematch_received"
                      ? "bg-amber-500/15"
                      : "bg-amber-500/10"
                )}>
                  {n.type === "match_ready" || n.type === "rematch_accepted" ? (
                    <Play className="w-4 h-4 text-emerald-400" />
                  ) : n.type.includes("challenge") || n.type === "rematch_received" ? (
                    <Swords className="w-4 h-4 text-amber-400" />
                  ) : n.type === "new_follower" ? (
                    <UserPlus className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Bell className="w-4 h-4 text-emerald-300/60" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm", n.read ? "text-emerald-400/50" : "text-emerald-100")}>
                    {n.message}
                  </p>
                  <p className="text-[10px] text-emerald-500/40 mt-0.5">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.read && (
                  <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 mt-2" />
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
