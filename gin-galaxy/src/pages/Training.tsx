import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  GraduationCap, TrendingUp, TrendingDown, Minus, Target, Activity,
  Trophy, AlertTriangle, ChevronRight, Clock, Zap, BarChart3,
  Eye, Loader2,
  Brain, Flame, Percent, Swords, Award, RefreshCw,
  ArrowUpRight, ArrowDownRight, Sparkles, BookOpen, MessageSquare
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { cn } from "@/src/lib/utils";
import { useAuthStore } from "@/src/lib/store";

// ── Types ────────────────────────────────────────────────────────────

interface SessionSummary {
  replayId: string;
  opponent: string;
  result: "win" | "loss" | "draw";
  score: string;
  endReason: string | null;
  playedAt: number;
  durationMs: number;
  hasEvaluation: boolean;
  hasAnalysis: boolean;
  hasCoaching: boolean;
  coachingSource: "ai" | "fallback" | null;
  accuracy: number | null;
  scoreLabel: string | null;
  severityCounts: { best: number; inaccuracy: number; mistake: number; blunder: number } | null;
  matchFormat: string;
  tournamentId: string | null;
  tournamentName: string | null;
}

interface ProgressionData {
  accuracyTimeline: { replayId: string; accuracy: number; playedAt: number; opponent: string }[];
  mistakeRateTimeline: { replayId: string; mistakeRate: number; playedAt: number }[];
  recentWindowAccuracy: number | null;
  olderWindowAccuracy: number | null;
  bestStreak: number;
  currentStreakType: "hot" | "cold" | "neutral";
  currentStreakLength: number;
  strongestCategory: string | null;
  weakestCategory: string | null;
  improvementDelta: number | null;
}

interface TrendData {
  recentAccuracy: number | null;
  recentAccuracyTrend: "improving" | "declining" | "stable" | "insufficient";
  totalEvaluated: number;
  totalSeverity: { best: number; inaccuracy: number; mistake: number; blunder: number };
  bestSession: { replayId: string; accuracy: number; opponent: string; playedAt: number; matchFormat: string } | null;
  worstSession: { replayId: string; accuracy: number; opponent: string; playedAt: number; matchFormat: string } | null;
  averageAccuracy: number | null;
  sessionsPlayed: number;
  sessionsEvaluated: number;
  winRate: number | null;
  recurringMistakeTypes: string[];
  progression: ProgressionData;
  formatBreakdown: Record<string, number>;
}

interface CoachingData {
  recentCoachingNote: {
    themes: string[];
    source: "ai" | "fallback";
    generatedAt: number;
  } | null;
  recurringThemes: { theme: string; count: number }[];
  totalCoached: number;
}

interface TrainingSummaryResponse {
  sessions: SessionSummary[];
  trends: TrendData;
  coaching: CoachingData;
  meta: {
    userId: string;
    generatedAt: number;
    sessionCount: number;
    methodology: string;
    methodologyNote: string;
    autoEvaluationEnabled: boolean;
    autoEvaluationNote: string;
    coachingNote?: string;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function accuracyColor(accuracy: number | null): string {
  if (accuracy === null) return "text-emerald-400/50";
  if (accuracy >= 90) return "text-emerald-400";
  if (accuracy >= 75) return "text-emerald-400";
  if (accuracy >= 60) return "text-amber-400";
  if (accuracy >= 40) return "text-orange-400";
  return "text-rose-400";
}

function accuracyBgColor(accuracy: number | null): string {
  if (accuracy === null) return "bg-[#0a2e1e]/50";
  if (accuracy >= 90) return "bg-emerald-500/10";
  if (accuracy >= 75) return "bg-emerald-500/10";
  if (accuracy >= 60) return "bg-amber-500/10";
  if (accuracy >= 40) return "bg-orange-500/10";
  return "bg-rose-500/10";
}

function accuracyBorderColor(accuracy: number | null): string {
  if (accuracy === null) return "border-emerald-700/30";
  if (accuracy >= 90) return "border-emerald-500/25";
  if (accuracy >= 75) return "border-amber-500/25";
  if (accuracy >= 60) return "border-amber-500/25";
  if (accuracy >= 40) return "border-orange-500/25";
  return "border-rose-500/25";
}

function resultColor(result: string): string {
  switch (result) {
    case "win": return "text-emerald-400";
    case "loss": return "text-rose-400";
    default: return "text-emerald-300/60";
  }
}

function resultBg(result: string): string {
  switch (result) {
    case "win": return "bg-emerald-500/10 border-emerald-500/20";
    case "loss": return "bg-rose-500/10 border-rose-500/20";
    default: return "bg-[#0a2e1e]/50 border-emerald-700/30";
  }
}

function trendIcon(trend: string) {
  switch (trend) {
    case "improving": return <TrendingUp className="w-5 h-5 text-emerald-400" />;
    case "declining": return <TrendingDown className="w-5 h-5 text-rose-400" />;
    case "stable": return <Minus className="w-5 h-5 text-amber-400" />;
    default: return <BarChart3 className="w-5 h-5 text-emerald-400/50" />;
  }
}

function trendLabel(trend: string): string {
  switch (trend) {
    case "improving": return "Improving";
    case "declining": return "Declining";
    case "stable": return "Stable";
    default: return "Not enough data";
  }
}

function trendColor(trend: string): string {
  switch (trend) {
    case "improving": return "text-emerald-400";
    case "declining": return "text-rose-400";
    case "stable": return "text-amber-400";
    default: return "text-emerald-400/50";
  }
}

function formatBadge(format: string): { label: string; color: string; icon: React.ReactNode } {
  switch (format) {
    case "tournament_sng":
      return { label: "SNG", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: <Trophy className="w-3 h-3" /> };
    case "tournament_scheduled":
      return { label: "Tournament", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: <Trophy className="w-3 h-3" /> };
    case "heads_up_staked":
      return { label: "Staked", color: "bg-amber-500/15 text-amber-400 border-amber-500/25", icon: <Zap className="w-3 h-3" /> };
    default:
      return { label: "Casual", color: "bg-zinc-500/15 text-emerald-300/60 border-zinc-500/25", icon: <Swords className="w-3 h-3" /> };
  }
}

// ── Main Component ───────────────────────────────────────────────────

export function Training() {
  const { sessionId } = useAuthStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TrainingSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepResult, setPrepResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "history">("overview");

  const fetchData = React.useCallback(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    fetch("/api/training/summary?limit=30", {
      headers: { Authorization: `Bearer ${sessionId}` },
    })
      .then(r => {
        if (!r.ok) throw new Error("Failed to load training data");
        return r.json();
      })
      .then(d => setData(d))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleBatchPrep = async () => {
    if (!sessionId || preparing) return;
    setPreparing(true);
    setPrepResult(null);
    try {
      const res = await fetch("/api/training/prepare", {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify({ maxBatch: 5 }),
      });
      const result = await res.json();
      setPrepResult(result.message);
      // Refresh data after a short delay to pick up any fast evaluations
      setTimeout(fetchData, 3000);
    } catch {
      setPrepResult("Failed to prepare evaluations.");
    } finally {
      setPreparing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-emerald-400/50">Loading your training data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24">
        <Card className="bg-emerald-950/30 border-emerald-800/30 max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
            <p className="text-emerald-200 font-medium">Unable to load training data</p>
            <p className="text-sm text-emerald-400/50">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const { sessions, trends, meta, coaching } = data;
  const hasData = sessions.length > 0;
  const hasEvaluations = trends.totalEvaluated > 0;
  const unevaluatedCount = trends.sessionsPlayed - trends.sessionsEvaluated;
  const p = trends.progression;

  return (
    <div className="space-y-8 pb-20 md:pb-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-amber-50 flex items-center gap-3" id="training-heading">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            Training Center
          </h1>
          <p className="text-sm text-emerald-400/50 mt-1">
            Track your decision quality, identify patterns, and improve your game.
            {meta.autoEvaluationEnabled && (
              <span className="ml-1 text-emerald-400/70">Evaluations auto-prepare after each match.</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasData && unevaluatedCount > 0 && (
            <Button
              variant="outline"
              className="border-emerald-600/40 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-600/10"
              onClick={handleBatchPrep}
              disabled={preparing}
              id="training-batch-prep"
            >
              {preparing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Evaluate ({unevaluatedCount})
            </Button>
          )}
          <Link to="/replays">
            <Button variant="outline" className="border-emerald-800/40 text-emerald-300/60 hover:text-emerald-100 hover:bg-emerald-950/40">
              <Eye className="w-4 h-4 mr-2" />
              View Replays
            </Button>
          </Link>
        </div>
      </div>

      {/* Prep result banner */}
      {prepResult && (
        <div className="bg-emerald-500/10 border border-amber-500/20 rounded-lg px-4 py-2.5 text-sm text-emerald-200 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
          {prepResult}
        </div>
      )}

      {!hasData && (
        <Card className="bg-emerald-950/30 border-emerald-800/30">
          <CardContent className="p-12 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-400/20 flex items-center justify-center mx-auto border border-amber-500/20">
              <Target className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="text-lg font-semibold text-emerald-100">No sessions yet</h2>
            <p className="text-sm text-emerald-400/50 max-w-md mx-auto">
              Play some matches to start building your training profile. Evaluations are now prepared automatically after each match.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Link to="/">
                <Button variant="primary" className="bg-emerald-700 hover:bg-emerald-600">
                  Play a Game
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {hasData && (
        <>
          {/* Tab Navigation */}
          <div className="flex items-center gap-1 bg-emerald-950/40 rounded-lg p-1 border border-emerald-800/30 w-fit">
            <button
              className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-all", activeTab === "overview" ? "bg-emerald-950/40 text-emerald-100 shadow-sm" : "text-emerald-400/50 hover:text-emerald-200")}
              onClick={() => setActiveTab("overview")}
            >Overview</button>
            <button
              className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-all", activeTab === "history" ? "bg-emerald-950/40 text-emerald-100 shadow-sm" : "text-emerald-400/50 hover:text-emerald-200")}
              onClick={() => setActiveTab("history")}
            >History</button>
          </div>

          {activeTab === "overview" && (
            <>
              {/* Stat Cards Row */}
              <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                {/* Engine Accuracy */}
                <Card className={cn(
                  "border overflow-hidden",
                  hasEvaluations
                    ? cn(accuracyBgColor(trends.averageAccuracy), accuracyBorderColor(trends.averageAccuracy))
                    : "bg-emerald-950/30 border-emerald-800/30"
                )} id="training-accuracy-card">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] uppercase tracking-wider text-emerald-400/50 font-medium">Engine Accuracy</span>
                      <Percent className="w-4 h-4 text-emerald-500/40" />
                    </div>
                    <div className={cn("text-3xl font-bold tabular-nums", accuracyColor(trends.averageAccuracy))}>
                      {trends.averageAccuracy !== null ? `${trends.averageAccuracy}%` : "—"}
                    </div>
                    {hasEvaluations && (
                      <div className="flex items-center gap-1.5 mt-2">
                        {trendIcon(trends.recentAccuracyTrend)}
                        <span className={cn("text-xs font-medium", trendColor(trends.recentAccuracyTrend))}>
                          {trendLabel(trends.recentAccuracyTrend)}
                        </span>
                        {p.improvementDelta !== null && p.improvementDelta !== 0 && (
                          <span className={cn("text-[10px] font-medium ml-1", p.improvementDelta > 0 ? "text-emerald-500" : "text-rose-500")}>
                            {p.improvementDelta > 0 ? "+" : ""}{p.improvementDelta}%
                          </span>
                        )}
                      </div>
                    )}
                    {!hasEvaluations && (
                      <p className="text-[11px] text-emerald-500/40 mt-2">Evaluations auto-prepare after matches</p>
                    )}
                  </CardContent>
                </Card>

                {/* Win Rate */}
                <Card className="bg-emerald-950/30 border-emerald-800/30" id="training-winrate-card">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] uppercase tracking-wider text-emerald-400/50 font-medium">Win Rate</span>
                      <Trophy className="w-4 h-4 text-emerald-500/40" />
                    </div>
                    <div className={cn(
                      "text-3xl font-bold tabular-nums",
                      trends.winRate !== null
                        ? trends.winRate >= 50 ? "text-emerald-400" : "text-amber-400"
                        : "text-emerald-400/50"
                    )}>
                      {trends.winRate !== null ? `${trends.winRate}%` : "—"}
                    </div>
                    <p className="text-[11px] text-emerald-500/40 mt-2">
                      {trends.sessionsPlayed} sessions played
                    </p>
                  </CardContent>
                </Card>

                {/* Sessions Evaluated */}
                <Card className="bg-emerald-950/30 border-emerald-800/30" id="training-evaluated-card">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] uppercase tracking-wider text-emerald-400/50 font-medium">Evaluated</span>
                      <Activity className="w-4 h-4 text-emerald-500/40" />
                    </div>
                    <div className="text-3xl font-bold tabular-nums text-emerald-100">
                      {trends.sessionsEvaluated}
                      <span className="text-lg text-emerald-500/40 font-normal"> / {trends.sessionsPlayed}</span>
                    </div>
                    <p className="text-[11px] text-emerald-500/40 mt-2">
                      {unevaluatedCount > 0 ? `${unevaluatedCount} pending` : "All evaluated"}
                    </p>
                  </CardContent>
                </Card>

                {/* Decision Quality */}
                <Card className="bg-emerald-950/30 border-emerald-800/30" id="training-decisions-card">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] uppercase tracking-wider text-emerald-400/50 font-medium">Decision Quality</span>
                      <Brain className="w-4 h-4 text-emerald-500/40" />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {trends.totalSeverity.best > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                          ✓ {trends.totalSeverity.best}
                        </span>
                      )}
                      {trends.totalSeverity.inaccuracy > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                          ○ {trends.totalSeverity.inaccuracy}
                        </span>
                      )}
                      {trends.totalSeverity.mistake > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 font-medium">
                          △ {trends.totalSeverity.mistake}
                        </span>
                      )}
                      {trends.totalSeverity.blunder > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium">
                          ⚠ {trends.totalSeverity.blunder}
                        </span>
                      )}
                    </div>
                    {!hasEvaluations && (
                      <p className="text-[11px] text-emerald-500/40 mt-2">No evaluations yet</p>
                    )}
                    {hasEvaluations && trends.recurringMistakeTypes.length > 0 && (
                      <p className="text-[11px] text-emerald-500/40 mt-2">
                        Common issue area{trends.recurringMistakeTypes.length > 1 ? "s" : ""}: {trends.recurringMistakeTypes.join(", ")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Progression Insights */}
              {hasEvaluations && (
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Streak & Category Card */}
                  <Card className="bg-emerald-950/30 border-emerald-800/30" id="training-progression-card">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2 text-emerald-200">
                        <TrendingUp className="w-4 h-4 text-emerald-400" />
                        Progression Insights
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-5 pt-0 space-y-4">
                      {/* Streak */}
                      {p.currentStreakLength > 0 && (
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                            p.currentStreakType === "hot" ? "bg-emerald-500/15 border border-emerald-500/25" : "bg-rose-500/15 border border-rose-500/25"
                          )}>
                            {p.currentStreakType === "hot" ? (
                              <Flame className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-rose-400" />
                            )}
                          </div>
                          <div>
                            <div className={cn("text-sm font-medium", p.currentStreakType === "hot" ? "text-emerald-400" : "text-rose-400")}>
                              {p.currentStreakType === "hot" ? "Hot Streak" : "Cold Streak"}: {p.currentStreakLength} sessions
                            </div>
                            <div className="text-[10px] text-emerald-500/40">
                              {p.currentStreakType === "hot" ? "Playing above your average" : "Playing below your average"}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Best streak */}
                      {p.bestStreak > 1 && (
                        <div className="flex items-center gap-2 text-[11px] text-emerald-400/50">
                          <Award className="w-3.5 h-3.5 text-amber-500/70" />
                          Best streak: <span className="text-emerald-200 font-medium">{p.bestStreak} sessions</span> above average
                        </div>
                      )}

                      {/* Category performance */}
                      {(p.strongestCategory || p.weakestCategory) && (
                        <div className="space-y-2">
                          {p.strongestCategory && (
                            <div className="flex items-center gap-2 text-[11px]">
                              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400/50">Strongest:</span>
                              <span className="text-emerald-400 font-medium capitalize">{p.strongestCategory} decisions</span>
                            </div>
                          )}
                          {p.weakestCategory && (
                            <div className="flex items-center gap-2 text-[11px]">
                              <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />
                              <span className="text-emerald-400/50">Focus area:</span>
                              <span className="text-rose-400 font-medium capitalize">{p.weakestCategory} decisions</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Window comparison */}
                      {p.recentWindowAccuracy !== null && p.olderWindowAccuracy !== null && (
                        <div className="bg-[#0a2e1e]/40 rounded-lg p-3 border border-emerald-700/25">
                          <div className="text-[10px] text-emerald-500/40 uppercase tracking-wider font-medium mb-2">Window Comparison</div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <div className="text-[10px] text-emerald-400/50 mb-0.5">Recent</div>
                              <div className={cn("text-lg font-bold tabular-nums", accuracyColor(p.recentWindowAccuracy))}>
                                {p.recentWindowAccuracy}%
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-emerald-400/50 mb-0.5">Earlier</div>
                              <div className={cn("text-lg font-bold tabular-nums", accuracyColor(p.olderWindowAccuracy))}>
                                {p.olderWindowAccuracy}%
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Format Breakdown Card */}
                  {Object.keys(trends.formatBreakdown).length > 0 && (
                    <Card className="bg-emerald-950/30 border-emerald-800/30" id="training-format-card">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2 text-emerald-200">
                          <Swords className="w-4 h-4 text-emerald-400" />
                          Match Format Distribution
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pb-5 pt-0 space-y-3">
                        {Object.entries(trends.formatBreakdown).map(([format, count]) => {
                          const badge = formatBadge(format);
                          const pct = Math.round((count / trends.sessionsPlayed) * 100);
                          return (
                            <div key={format} className="flex items-center gap-3">
                              <div className={cn("flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border shrink-0", badge.color)}>
                                {badge.icon}
                                {badge.label}
                              </div>
                              <div className="flex-1">
                                <div className="w-full h-2 bg-[#0a2e1e]/60 rounded-full overflow-hidden">
                                  <div className="h-full bg-emerald-500/50 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                              <span className="text-[11px] text-emerald-400/50 tabular-nums shrink-0">{count} ({pct}%)</span>
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* AI Coaching Insights */}
              {coaching && (coaching.totalCoached > 0 || coaching.recurringThemes.length > 0) && (
                <Card className="bg-emerald-950/30 border-emerald-800/30" id="training-coaching-card">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 text-emerald-200">
                      <BookOpen className="w-4 h-4 text-emerald-400" />
                      AI Coaching Insights
                      <span className="text-[10px] text-emerald-500/40 font-normal ml-auto">
                        {coaching.totalCoached} session{coaching.totalCoached !== 1 ? "s" : ""} coached
                        {coaching.recentCoachingNote?.source === "ai" && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            AI
                          </span>
                        )}
                        {coaching.recentCoachingNote?.source === "fallback" && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-zinc-500/10 text-emerald-300/60 border border-zinc-500/20">
                            Structured
                          </span>
                        )}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-5 pt-0 space-y-4">
                    {/* Recurring themes */}
                    {coaching.recurringThemes.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] text-emerald-500/40 uppercase tracking-wider font-medium">Recurring Themes</div>
                        <div className="flex flex-wrap gap-2">
                          {coaching.recurringThemes.map((t, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15 text-emerald-300/80"
                            >
                              <MessageSquare className="w-3 h-3 text-emerald-400/60" />
                              <span className="capitalize">{t.theme}</span>
                              {t.count > 1 && (
                                <span className="text-[9px] text-emerald-500/50 ml-0.5">×{t.count}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recent coaching note themes */}
                    {coaching.recentCoachingNote && coaching.recentCoachingNote.themes.length > 0 && (
                      <div className="bg-[#0a2e1e]/40 rounded-lg p-3 border border-emerald-700/25">
                        <div className="text-[10px] text-emerald-500/40 uppercase tracking-wider font-medium mb-2">Latest Session</div>
                        <div className="space-y-1.5">
                          {coaching.recentCoachingNote.themes.slice(0, 3).map((theme, i) => (
                            <div key={i} className="flex items-center gap-2 text-[11px] text-emerald-300/60">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 shrink-0" />
                              {theme}
                            </div>
                          ))}
                        </div>
                        <div className="text-[10px] text-emerald-500/40 mt-2">
                          {timeAgo(coaching.recentCoachingNote.generatedAt)}
                        </div>
                      </div>
                    )}

                    {/* No coaching prompt */}
                    {coaching.totalCoached === 0 && (
                      <p className="text-[11px] text-emerald-500/40">
                        Request coaching via the session detail view to start building your coaching history.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Highlights Row */}
              {hasEvaluations && (
                <div className="grid gap-4 md:grid-cols-2">
                  {trends.bestSession && (
                    <Card className="bg-emerald-950/30 border-emerald-800/30 hover:border-emerald-500/30 transition-colors cursor-pointer group"
                      id="training-best-session"
                      onClick={() => navigate(`/replays?highlight=${trends.bestSession!.replayId}`)}
                    >
                      <CardContent className="p-5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                              <Flame className="w-5 h-5 text-emerald-400" />
                            </div>
                            <div>
                              <div className="text-xs text-emerald-400/50 uppercase tracking-wider font-medium">Best Session</div>
                              <div className="text-sm text-emerald-200 font-medium mt-0.5 flex items-center gap-2">
                                vs {trends.bestSession.opponent}
                                {trends.bestSession.matchFormat !== "heads_up" && (
                                  <span className={cn("text-[9px] px-1 py-0.5 rounded border", formatBadge(trends.bestSession.matchFormat).color)}>
                                    {formatBadge(trends.bestSession.matchFormat).label}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className={cn("text-xl font-bold tabular-nums", accuracyColor(trends.bestSession.accuracy))}>
                                {trends.bestSession.accuracy}%
                              </div>
                              <div className="text-[10px] text-emerald-500/40">{timeAgo(trends.bestSession.playedAt)}</div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-emerald-500/40 group-hover:text-emerald-300/60 transition-colors" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {trends.worstSession && trends.worstSession.replayId !== trends.bestSession?.replayId && (
                    <Card className="bg-emerald-950/30 border-emerald-800/30 hover:border-rose-500/30 transition-colors cursor-pointer group"
                      id="training-worst-session"
                      onClick={() => navigate(`/replays?highlight=${trends.worstSession!.replayId}`)}
                    >
                      <CardContent className="p-5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                              <Target className="w-5 h-5 text-rose-400" />
                            </div>
                            <div>
                              <div className="text-xs text-emerald-400/50 uppercase tracking-wider font-medium">Most Instructive</div>
                              <div className="text-sm text-emerald-200 font-medium mt-0.5 flex items-center gap-2">
                                vs {trends.worstSession.opponent}
                                {trends.worstSession.matchFormat !== "heads_up" && (
                                  <span className={cn("text-[9px] px-1 py-0.5 rounded border", formatBadge(trends.worstSession.matchFormat).color)}>
                                    {formatBadge(trends.worstSession.matchFormat).label}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className={cn("text-xl font-bold tabular-nums", accuracyColor(trends.worstSession.accuracy))}>
                                {trends.worstSession.accuracy}%
                              </div>
                              <div className="text-[10px] text-emerald-500/40">{timeAgo(trends.worstSession.playedAt)}</div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-emerald-500/40 group-hover:text-emerald-300/60 transition-colors" />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Severity Distribution Bar */}
              {hasEvaluations && (() => {
                const total = trends.totalSeverity.best + trends.totalSeverity.inaccuracy +
                              trends.totalSeverity.mistake + trends.totalSeverity.blunder;
                if (total === 0) return null;
                const bestPct = (trends.totalSeverity.best / total) * 100;
                const inaccPct = (trends.totalSeverity.inaccuracy / total) * 100;
                const mistPct = (trends.totalSeverity.mistake / total) * 100;
                const blunPct = (trends.totalSeverity.blunder / total) * 100;
                return (
                  <Card className="bg-emerald-950/30 border-emerald-800/30" id="training-severity-bar">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2 text-emerald-200">
                        <BarChart3 className="w-4 h-4 text-emerald-400" />
                        Decision Severity Distribution
                        <span className="text-[10px] text-emerald-500/40 font-normal">({total} decisions)</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pb-5 pt-0 px-6">
                      <div className="flex w-full h-4 rounded-full overflow-hidden border border-emerald-800/30">
                        {bestPct > 0 && (
                          <div className="bg-emerald-500/70 h-full transition-all duration-500" style={{ width: `${bestPct}%` }}
                            title={`Best: ${trends.totalSeverity.best} (${Math.round(bestPct)}%)`} />
                        )}
                        {inaccPct > 0 && (
                          <div className="bg-amber-500/70 h-full transition-all duration-500" style={{ width: `${inaccPct}%` }}
                            title={`Inaccuracy: ${trends.totalSeverity.inaccuracy} (${Math.round(inaccPct)}%)`} />
                        )}
                        {mistPct > 0 && (
                          <div className="bg-orange-500/70 h-full transition-all duration-500" style={{ width: `${mistPct}%` }}
                            title={`Mistake: ${trends.totalSeverity.mistake} (${Math.round(mistPct)}%)`} />
                        )}
                        {blunPct > 0 && (
                          <div className="bg-rose-500/70 h-full transition-all duration-500" style={{ width: `${blunPct}%` }}
                            title={`Blunder: ${trends.totalSeverity.blunder} (${Math.round(blunPct)}%)`} />
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-3 flex-wrap">
                        <span className="flex items-center gap-1.5 text-[10px] text-emerald-300/60">
                          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70" /> Best {Math.round(bestPct)}%
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-emerald-300/60">
                          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/70" /> Inaccuracy {Math.round(inaccPct)}%
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-emerald-300/60">
                          <span className="w-2.5 h-2.5 rounded-sm bg-orange-500/70" /> Mistake {Math.round(mistPct)}%
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-emerald-300/60">
                          <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/70" /> Blunder {Math.round(blunPct)}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </>
          )}

          {/* Session List (both tabs) */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-emerald-100 flex items-center gap-2" id="training-sessions-heading">
              <Clock className="w-5 h-5 text-emerald-400" />
              {activeTab === "overview" ? "Recent Sessions" : "Session History"}
            </h2>

            <div className="space-y-2">
              {sessions.map(session => {
                const badge = formatBadge(session.matchFormat);
                return (
                <Card
                  key={session.replayId}
                  className="bg-emerald-950/20 border-emerald-800/30 hover:border-emerald-800/40/60 transition-all cursor-pointer group"
                  id={`training-session-${session.replayId.slice(0, 8)}`}
                  onClick={() => navigate(`/replays?highlight=${session.replayId}`)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      {/* Left: result & opponent */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border font-bold text-sm",
                          resultBg(session.result)
                        )}>
                          {session.result === "win" ? "W" : session.result === "loss" ? "L" : "D"}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-emerald-100 truncate">
                              vs {session.opponent}
                            </span>
                            <span className={cn("text-xs font-medium", resultColor(session.result))}>
                              {session.score}
                            </span>
                            {/* Format badge */}
                            {session.matchFormat !== "heads_up" && (
                              <span className={cn("text-[9px] px-1.5 py-0.5 rounded border flex items-center gap-1", badge.color)}>
                                {badge.icon}
                                {badge.label}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-emerald-500/40">
                            <span>{timeAgo(session.playedAt)}</span>
                            <span>·</span>
                            <span>{formatDuration(session.durationMs)}</span>
                            {session.endReason && session.endReason !== "completed" && (
                              <>
                                <span>·</span>
                                <span className="capitalize text-amber-500/80">{session.endReason}</span>
                              </>
                            )}
                            {session.tournamentName && (
                              <>
                                <span>·</span>
                                <span className="text-emerald-400/80">{session.tournamentName}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Center: severity badges & accuracy */}
                      <div className="hidden sm:flex items-center gap-3 shrink-0">
                        {session.hasEvaluation && session.severityCounts && (
                          <div className="flex items-center gap-1">
                            {session.severityCounts.best > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                ✓{session.severityCounts.best}
                              </span>
                            )}
                            {session.severityCounts.inaccuracy > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                ○{session.severityCounts.inaccuracy}
                              </span>
                            )}
                            {session.severityCounts.mistake > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                △{session.severityCounts.mistake}
                              </span>
                            )}
                            {session.severityCounts.blunder > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                ⚠{session.severityCounts.blunder}
                              </span>
                            )}
                          </div>
                        )}
                        {session.hasEvaluation && session.accuracy !== null && (
                          <div className={cn("text-sm font-bold tabular-nums", accuracyColor(session.accuracy))}>
                            {session.accuracy}%
                          </div>
                        )}
                        {session.hasCoaching && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1" title="Coaching available">
                            <BookOpen className="w-3 h-3" />
                          </span>
                        )}
                        {!session.hasEvaluation && (
                          <span className="text-[10px] text-emerald-500/40 px-2 py-0.5 rounded border border-emerald-800/30">
                            Preparing…
                          </span>
                        )}
                      </div>

                      {/* Right: action arrow */}
                      <ChevronRight className="w-4 h-4 text-emerald-500/40 group-hover:text-emerald-300/60 shrink-0 transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              )})}
            </div>
          </div>

          {/* Methodology Note */}
          <Card className="bg-emerald-950/15 border-emerald-800/25">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <Brain className="w-5 h-5 text-emerald-400/60 mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-emerald-300/60">About Training Metrics</h3>
                  <p className="text-[11px] text-emerald-500/40 leading-relaxed">
                    <strong className="text-emerald-400/50">Automatic Evaluation</strong> — evaluations are now prepared
                    automatically after each completed match. You can also trigger batch evaluation for older replays
                    using the Evaluate button above.
                  </p>
                  <p className="text-[11px] text-emerald-500/40 leading-relaxed">
                    <strong className="text-emerald-400/50">Engine Accuracy</strong> measures how often your decisions
                    agree with the Apex v2 heuristic evaluator. It is a strong approximation, not a solved-game oracle.
                    Gin Rummy has hidden information, so draw evaluations carry inherent uncertainty.
                  </p>
                  <p className="text-[11px] text-emerald-500/40 leading-relaxed">
                    <strong className="text-emerald-400/50">Progression Signals</strong> compare your recent performance
                    against earlier sessions. Streaks and trends help identify when you're playing your best or
                    when to take a break.
                  </p>
                  <p className="text-[11px] text-emerald-500/40 leading-relaxed">
                    <strong className="text-emerald-400/50">AI Coaching</strong> provides narrative explanations and strategic
                    themes cached per session. Coaching is a separate layer from the engine evaluation — the engine
                    provides mathematical accuracy, while coaching provides contextual explanation and actionable advice.
                    Coaching is generated on-demand and cached for reuse.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
