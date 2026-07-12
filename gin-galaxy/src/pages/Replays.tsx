import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import {
  History, Clock, Trophy, ArrowLeft, ChevronRight, ChevronDown,
  ChevronUp, Play, SkipForward, SkipBack, Swords,
  AlertTriangle, Timer, WifiOff, Flag, ArrowRight,
  Activity, Loader2, Sparkles, Shield, Download, Copy, Check
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { cn } from "@/src/lib/utils";
import { useAuthStore } from "@/src/lib/store";
import Markdown from "react-markdown";

// ── Types ────────────────────────────────────────────────────────────

interface ReplayListItem {
  id: string;
  roomId: string;
  startedAt: number;
  endedAt: number;
  players: { userId: string; username: string }[];
  outcome: {
    winnerId: string | null;
    winnerUsername: string | null;
    loserId: string | null;
    loserUsername: string | null;
    winnerScore: number;
    loserScore: number;
    endReason: string | null;
  };
  actionCount: number;
}

interface TranscriptAction {
  seq: number;
  timestamp: number;
  type: string;
  playerId?: string;
  playerUsername?: string;
  detail?: Record<string, unknown>;
}

interface ReplayDetail extends ReplayListItem {
  actions: TranscriptAction[];
}

interface AnalysisMeta {
  replayId: string;
  totalActions: number;
  totalRounds: number;
  durationMs: number;
  endReason: string | null;
}

interface EvaluationSeverityCounts {
  best: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
}

interface EvaluationTypeBreakdown {
  total: number;
  matches: number;
  accuracy: number | null;
}

interface PlayerEvalSummary {
  username: string;
  total_decisions: number;
  engine_matches?: number;
  engine_accuracy: number | null;
  score_label: string;
  severity_counts?: EvaluationSeverityCounts;
  type_breakdown?: Record<string, EvaluationTypeBreakdown>;
  total_discard_dw_cost?: number;
}

interface TurnEvaluation {
  seq: number;
  type: string;
  severity: string;
  matches_engine: boolean;
  actual_card?: string;
  engine_preferred?: string;
  dw_cost?: number;
  player_id?: string;
  player_username?: string;
  did_knock?: boolean;
  engine_preferred_take?: boolean;
  took_discard?: boolean;
  completes_meld?: boolean;
  caveat?: string | null;
}

interface ReplayEvaluation {
  methodology: string;
  methodology_description: string;
  total_evaluated: number;
  requesting_player_accuracy: number | null;
  requesting_player_label: string;
  player_summaries: Record<string, PlayerEvalSummary>;
  evaluations: TurnEvaluation[];
  evaluation_time_ms?: number;
}

// Fairness / Trust Shield types
interface FairnessCommitment {
  commitmentHash: string;
  committedAt: string;
  algorithmVersion: number;
}

interface FairnessReveal {
  serverSeed: string;
  nonce: number;
  algorithmVersion: number;
  deckHash: string;
  deckOrder: number[];
  revealedAt: string;
  clientSeeds?: { player1: string; player2: string } | null;
  combinedSeed?: string | null;
}

interface FairnessProofVerified {
  handId: string;
  matchId: string;
  roundNumber: number;
  commitment: FairnessCommitment;
  reveal: FairnessReveal | null;
  transcriptHash: string | null;
  verified: boolean;
  verificationDetails?: string[];
  algorithmVersion?: number;
  hasClientSeeds?: boolean;
  reason?: string;
}

interface FairnessData {
  algorithmVersion: number;
  proofs: FairnessProofVerified[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

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

function formatDuration(startedAt: number, endedAt: number): string {
  const diff = endedAt - startedAt;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function endReasonLabel(reason: string | null): string {
  switch (reason) {
    case "completed": return "Completed";
    case "forfeit": return "Forfeit";
    case "timeout": return "Timeout";
    case "disconnect": return "Disconnect";
    default: return reason ?? "Unknown";
  }
}

function endReasonColor(reason: string | null): string {
  switch (reason) {
    case "completed": return "text-emerald-400";
    case "forfeit": return "text-amber-400";
    case "timeout": return "text-orange-400";
    case "disconnect": return "text-rose-400";
    default: return "text-emerald-300/60";
  }
}

function actionIcon(type: string) {
  switch (type) {
    case "match_start": return <Play className="w-3.5 h-3.5 text-amber-400" />;
    case "round_start": return <Flag className="w-3.5 h-3.5 text-emerald-300" />;
    case "draw": return <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />;
    case "discard": return <ArrowLeft className="w-3.5 h-3.5 text-amber-400" />;
    case "knock": return <Swords className="w-3.5 h-3.5 text-amber-500" />;
    case "gin": return <Trophy className="w-3.5 h-3.5 text-yellow-400" />;
    case "undercut": return <AlertTriangle className="w-3.5 h-3.5 text-purple-400" />;
    case "round_end": return <ChevronRight className="w-3.5 h-3.5 text-emerald-300/60" />;
    case "match_end": return <Trophy className="w-3.5 h-3.5 text-amber-400" />;
    case "timeout": return <Timer className="w-3.5 h-3.5 text-orange-400" />;
    case "disconnect": return <WifiOff className="w-3.5 h-3.5 text-rose-400" />;
    case "forfeit": return <Flag className="w-3.5 h-3.5 text-rose-400" />;
    case "next_round": return <SkipForward className="w-3.5 h-3.5 text-emerald-300" />;
    default: return <ChevronRight className="w-3.5 h-3.5 text-emerald-400/50" />;
  }
}

function actionLabel(action: TranscriptAction): string {
  const who = action.playerUsername || "";
  const d = action.detail || {};

  switch (action.type) {
    case "match_start": return `Match started — ${(d.players as string[])?.join(" vs ") || ""}`;
    case "round_start": return `Round ${d.roundNumber} — ${who} goes first`;
    case "draw": return `${who} drew from ${d.source}${d.card ? ` (${d.card})` : ""}`;
    case "discard": return `${who} discarded ${d.card || "a card"}`;
    case "knock": {
      const pts = d.points !== undefined ? ` — ${d.winnerUsername} wins ${d.points} pts` : "";
      return `${who} knocked (DW: ${d.knockerDeadwood ?? "?"} vs ${d.opponentDeadwood ?? "?"})${pts}`;
    }
    case "gin": {
      const pts = d.points !== undefined ? ` (${d.points} pts)` : "";
      return `${who} goes GIN!${pts}`;
    }
    case "undercut": {
      const pts = d.points !== undefined ? ` — ${d.winnerUsername} wins ${d.points} pts` : "";
      return `${d.winnerUsername || who} undercuts!${pts}`;
    }
    case "round_end": return `Round won by ${who} — ${d.outcomeType} for ${d.points} points`;
    case "match_end": return `Match over — ${who} wins (${d.winnerScore}-${d.loserScore}) [${endReasonLabel(d.endReason as string)}]`;
    case "timeout": return `${who} timed out`;
    case "disconnect": return `${who} disconnected`;
    case "forfeit": return `${who} forfeited (${d.reason || "left"})`;
    case "next_round": return `Round ${d.roundNumber} requested`;
    case "leave": return `${who} left the match`;
    default: return `${action.type}${who ? ` — ${who}` : ""}`;
  }
}

function actionTypeBg(type: string): string {
  switch (type) {
    case "match_start":
    case "match_end":
      return "border-l-amber-500/60 bg-amber-950/10";
    case "round_start":
    case "round_end":
    case "next_round":
      return "border-l-emerald-500/60 bg-emerald-950/10";
    case "knock":
    case "gin":
    case "undercut":
      return "border-l-amber-500/60 bg-amber-950/10";
    case "timeout":
    case "disconnect":
    case "forfeit":
      return "border-l-rose-500/60 bg-rose-950/10";
    default:
      return "border-l-zinc-700/60";
  }
}

// ── Main Component ───────────────────────────────────────────────────

export function Replays() {
  const { sessionId, user } = useAuthStore();
  const [replays, setReplays] = useState<ReplayListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReplay, setSelectedReplay] = useState<ReplayDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [focusedAction, setFocusedAction] = useState<number | null>(null);
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set());

  // Analysis state
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysisMeta, setAnalysisMeta] = useState<AnalysisMeta | null>(null);
  const [analysisSource, setAnalysisSource] = useState<string | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Evaluation state (engine-backed)
  const [evaluation, setEvaluation] = useState<ReplayEvaluation | null>(null);
  const [loadingEval, setLoadingEval] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalSource, setEvalSource] = useState<string | null>(null);

  // Fairness / Trust Shield state
  const [fairnessData, setFairnessData] = useState<FairnessData | null>(null);
  const [loadingFairness, setLoadingFairness] = useState(false);
  const [fairnessError, setFairnessError] = useState<string | null>(null);
  const [expandedProofs, setExpandedProofs] = useState<Set<number>>(new Set());
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const fetchFairnessRef = useRef<(replayId: string) => void>(() => {});

  // Fetch replay list
  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    fetch("/api/replays?limit=20", {
      headers: { Authorization: `Bearer ${sessionId}` },
    })
      .then(r => r.json())
      .then(data => setReplays(data.replays || []))
      .catch(() => setReplays([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  // Load replay detail
  const openReplay = useCallback(async (id: string) => {
    if (!sessionId) return;
    setLoadingDetail(true);
    setAnalysis(null);
    setAnalysisMeta(null);
    setAnalysisSource(null);
    setAnalysisError(null);
    setEvaluation(null);
    setEvalError(null);
    setEvalSource(null);
    try {
      const res = await fetch(`/api/replays/${id}`, {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      if (!res.ok) throw new Error("Failed to load.");
      const data = await res.json();
      setSelectedReplay(data.replay);
      setFocusedAction(null);
      setExpandedRounds(new Set());
      // Auto-fetch fairness data
      fetchFairnessRef.current(id);
    } catch {
      setSelectedReplay(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [sessionId]);

  // Step-through navigation
  const goNext = () => {
    if (!selectedReplay) return;
    setFocusedAction(prev =>
      prev === null ? 0 : Math.min(prev + 1, selectedReplay.actions.length - 1)
    );
  };
  const goPrev = () => {
    if (!selectedReplay) return;
    setFocusedAction(prev => (prev === null || prev <= 0 ? 0 : prev - 1));
  };

  // Group actions by round for collapsible display
  const groupByRound = (actions: TranscriptAction[]) => {
    const rounds: { roundNumber: number; actions: TranscriptAction[] }[] = [];
    let current: TranscriptAction[] = [];
    let currentRound = 0;

    for (const a of actions) {
      if (a.type === "round_start") {
        if (current.length > 0) {
          rounds.push({ roundNumber: currentRound, actions: current });
        }
        currentRound = (a.detail?.roundNumber as number) || currentRound + 1;
        current = [a];
      } else {
        current.push(a);
      }
    }
    if (current.length > 0) {
      rounds.push({ roundNumber: currentRound || 1, actions: current });
    }
    return rounds;
  };

  const toggleRound = (roundNumber: number) => {
    setExpandedRounds(prev => {
      const next = new Set(prev);
      if (next.has(roundNumber)) next.delete(roundNumber);
      else next.add(roundNumber);
      return next;
    });
  };

  // Request AI analysis for the current replay
  const requestAnalysis = useCallback(async () => {
    if (!sessionId || !selectedReplay) return;
    setLoadingAnalysis(true);
    setAnalysisError(null);
    try {
      const res = await fetch(`/api/replays/${selectedReplay.id}/analysis`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionId}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Analysis request failed.");
      }
      const data = await res.json();
      setAnalysis(data.analysis);
      setAnalysisMeta(data.meta || null);
      setAnalysisSource(data.source || "ai");
    } catch (err: any) {
      setAnalysisError(err.message || "Failed to generate analysis.");
    } finally {
      setLoadingAnalysis(false);
    }
  }, [sessionId, selectedReplay]);

  // Request engine evaluation for the current replay
  const requestEvaluation = useCallback(async () => {
    if (!sessionId || !selectedReplay) return;
    setLoadingEval(true);
    setEvalError(null);
    try {
      const res = await fetch(`/api/replays/${selectedReplay.id}/evaluation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionId}`,
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();
      if (data.evaluation) {
        setEvaluation(data.evaluation);
        setEvalSource(data.source);
      } else {
        setEvalError(data.error || "Evaluation unavailable.");
      }
    } catch (err: any) {
      setEvalError(err.message || "Failed to run evaluation.");
    } finally {
      setLoadingEval(false);
    }
  }, [sessionId, selectedReplay]);

  // Helper: find evaluation for a specific action seq
  const getEvalForSeq = (seq: number): TurnEvaluation | undefined => {
    if (!evaluation?.evaluations) return undefined;
    return evaluation.evaluations.find(e => e.seq === seq);
  };

  // Severity badge styling
  const severityBadge = (severity: string) => {
    switch (severity) {
      case 'blunder': return { bg: 'bg-rose-500/15 border-rose-500/30', text: 'text-rose-400', label: '⚠ Blunder' };
      case 'mistake': return { bg: 'bg-orange-500/15 border-orange-500/30', text: 'text-orange-400', label: '△ Mistake' };
      case 'inaccuracy': return { bg: 'bg-amber-500/15 border-amber-500/30', text: 'text-amber-400', label: '○ Inaccuracy' };
      case 'best': return { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', label: '✓ Best' };
      default: return { bg: 'bg-[#0a2e1e]/50 border-emerald-800/40/30', text: 'text-emerald-300/60', label: severity };
    }
  };

  // Score color helper
  const accuracyColor = (accuracy: number | null) => {
    if (accuracy === null) return 'text-emerald-400/50';
    if (accuracy >= 90) return 'text-emerald-400';
    if (accuracy >= 75) return 'text-emerald-300';
    if (accuracy >= 60) return 'text-amber-400';
    if (accuracy >= 40) return 'text-orange-400';
    return 'text-rose-400';
  };

  // Fairness data fetch
  const fetchFairness = useCallback(async (replayId: string) => {
    if (!sessionId) return;
    setLoadingFairness(true);
    setFairnessError(null);
    try {
      const res = await fetch(`/api/replays/${replayId}/fairness`, {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      if (!res.ok) throw new Error("Failed to load fairness data.");
      const data = await res.json();
      setFairnessData(data.fairness);
    } catch (err: any) {
      setFairnessError(err.message || "Failed to load fairness data.");
    } finally {
      setLoadingFairness(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchFairnessRef.current = fetchFairness;
  }, [fetchFairness]);

  // Copy to clipboard helper
  const copyToClipboard = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // fallback
    }
  }, []);

  // Download proof
  const downloadProof = useCallback(async () => {
    if (!sessionId || !selectedReplay) return;
    try {
      const res = await fetch(`/api/replays/${selectedReplay.id}/fairness/download`, {
        headers: { Authorization: `Bearer ${sessionId}` },
      });
      if (!res.ok) throw new Error("Download failed.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fairness-proof-${selectedReplay.id.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  }, [sessionId, selectedReplay]);

  const toggleProofExpand = (roundNumber: number) => {
    setExpandedProofs(prev => {
      const next = new Set(prev);
      if (next.has(roundNumber)) next.delete(roundNumber);
      else next.add(roundNumber);
      return next;
    });
  };

  // ── Replay Detail View ──────────────────────────────────
  if (selectedReplay) {
    const replay = selectedReplay;
    const isWinner = replay.outcome.winnerId === user?.id;
    const rounds = groupByRound(replay.actions);

    return (
      <div className="space-y-6 pb-20 md:pb-0">
        {/* Back button */}
        <button
          onClick={() => setSelectedReplay(null)}
          className="flex items-center gap-2 text-sm text-emerald-300/60 hover:text-emerald-100 transition-colors group"
          id="replay-back-btn"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Replays
        </button>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-amber-50 flex items-center gap-3">
              <History className="w-6 h-6 text-amber-400" />
              Match Replay
            </h1>
            <p className="text-sm text-emerald-400/50 mt-1">
              {formatDate(replay.startedAt)} at {formatTime(replay.startedAt)} · {formatDuration(replay.startedAt, replay.endedAt)}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              className="border-emerald-600/40 text-emerald-300 hover:bg-emerald-950/20"
              onClick={() => { if (expandedProofs.size === 0 && fairnessData?.proofs) { setExpandedProofs(new Set(fairnessData.proofs.map(p => p.roundNumber))); } else { setExpandedProofs(new Set()); } }}
              disabled={!fairnessData || fairnessData.proofs.length === 0}
              id="replay-trustshield-btn"
            >
              <Shield className="w-4 h-4 mr-2" />
              Trust Shield
            </Button>
            <Button
              variant="outline"
              className="border-emerald-600/40 text-emerald-400 hover:bg-emerald-950/30"
              onClick={requestEvaluation}
              disabled={loadingEval}
              id="replay-evaluate-btn"
            >
              {loadingEval ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Activity className="w-4 h-4 mr-2" />
              )}
              {loadingEval ? "Evaluating..." : evaluation ? "Re-Evaluate" : "Engine Eval"}
            </Button>
            <Button
              variant="primary"
              className="bg-emerald-700 hover:bg-emerald-600"
              onClick={requestAnalysis}
              disabled={loadingAnalysis}
              id="replay-analyze-btn"
            >
              {loadingAnalysis ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              {loadingAnalysis ? "Analyzing..." : analysis ? "Re-Analyze" : "AI Coach"}
            </Button>
            <div className={cn(
              "px-4 py-2 rounded-xl text-sm font-semibold",
              isWinner ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
            )}>
              {isWinner ? "Victory" : "Defeat"}
            </div>
          </div>
        </div>

        {/* Match summary cards */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Player cards */}
          {replay.players.map((p, idx) => {
            const isMe = p.userId === user?.id;
            const isMatchWinner = p.userId === replay.outcome.winnerId;
            const score = isMatchWinner ? replay.outcome.winnerScore : replay.outcome.loserScore;
            return (
              <Card key={idx} className={cn(
                "bg-emerald-950/30 border-emerald-800/30",
                isMatchWinner && "ring-1 ring-emerald-500/30"
              )}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border",
                      isMe ? "bg-gradient-to-tr from-emerald-500 to-emerald-600 border-amber-400/40 text-white" : "bg-[#0a2e1e] border-emerald-800/40 text-emerald-300/60"
                    )}>
                      {p.username[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-emerald-100">{p.username}</span>
                        {isMe && <span className="text-[10px] uppercase tracking-wider text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">You</span>}
                      </div>
                      <span className="text-xs text-emerald-400/50">
                        {isMatchWinner ? "Winner" : ""}
                      </span>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-amber-50">{score}</div>
                  <div className="text-xs text-emerald-400/50">Final Score</div>
                </CardContent>
              </Card>
            );
          })}

          {/* Match info card */}
          <Card className="bg-emerald-950/30 border-emerald-800/30">
            <CardContent className="p-5 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-emerald-400/50 uppercase tracking-wider">Result</span>
                <span className={cn("text-xs font-semibold", endReasonColor(replay.outcome.endReason))}>
                  {endReasonLabel(replay.outcome.endReason)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-emerald-400/50 uppercase tracking-wider">Rounds</span>
                <span className="text-sm font-medium text-emerald-200">{rounds.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-emerald-400/50 uppercase tracking-wider">Actions</span>
                <span className="text-sm font-medium text-emerald-200">{replay.actions.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-emerald-400/50 uppercase tracking-wider">Duration</span>
                <span className="text-sm font-medium text-emerald-200">
                  {formatDuration(replay.startedAt, replay.endedAt)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Trust Shield / Proof Inspector Panel */}
        {(fairnessData || loadingFairness || fairnessError) && (
          <Card className="bg-emerald-950/30 border-emerald-800/30 overflow-hidden" id="replay-fairness-panel">
            <CardHeader className="border-b border-emerald-800/30 bg-gradient-to-r from-emerald-950/40 via-emerald-950/20 to-[#0a2e1e]/80">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="w-5 h-5 text-emerald-400" />
                  Trust Shield
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    v{fairnessData?.algorithmVersion || '?'}
                  </span>
                  {fairnessData?.proofs?.some(p => p.hasClientSeeds) && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      Client Seeds
                    </span>
                  )}
                </CardTitle>
                {fairnessData && fairnessData.proofs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-emerald-800/40 text-emerald-300/60 hover:text-emerald-100 hover:bg-emerald-950/40"
                      onClick={downloadProof}
                      id="replay-download-proof"
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Download Proof
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {loadingFairness ? (
                <div className="flex items-center justify-center py-6">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-emerald-400/50">Loading fairness data...</span>
                  </div>
                </div>
              ) : fairnessError ? (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-950/20 border border-amber-500/20">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                  <p className="text-sm text-amber-300">{fairnessError}</p>
                </div>
              ) : !fairnessData ? (
                <div className="text-sm text-emerald-400/50 text-center py-4">
                  No fairness proof data available for this match.
                </div>
              ) : fairnessData.proofs.length === 0 ? (
                <div className="text-sm text-emerald-400/50 text-center py-4">
                  No completed proofs found.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Summary line */}
                  <div className="flex items-center gap-4 text-sm text-emerald-300/60 mb-4">
                    <span>{fairnessData.proofs.length} round{fairnessData.proofs.length !== 1 ? 's' : ''} verified</span>
                    <span className="text-emerald-500/40">•</span>
                    {fairnessData.proofs.every(p => p.verified) ? (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Check className="w-3.5 h-3.5" /> All proofs valid
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-rose-400">
                        <AlertTriangle className="w-3.5 h-3.5" /> Some proofs failed
                      </span>
                    )}
                  </div>

                  {/* Per-round proof cards */}
                  {fairnessData.proofs.map((proof) => {
                    const isExpanded = expandedProofs.has(proof.roundNumber);
                    return (
                      <div key={proof.roundNumber} className="border border-emerald-800/30 rounded-lg overflow-hidden">
                        <button
                          className="w-full flex items-center justify-between p-3 hover:bg-emerald-950/30 transition-colors text-left"
                          onClick={() => toggleProofExpand(proof.roundNumber)}
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold",
                              proof.verified
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            )}>
                              {proof.verified ? <Check className="w-3.5 h-3.5" /> : '!'}
                            </div>
                            <div>
                              <span className="text-sm font-medium text-emerald-100">
                                Round {proof.roundNumber}
                              </span>
                              <span className="text-xs text-emerald-400/50 ml-2">
                                v{proof.algorithmVersion || proof.commitment.algorithmVersion}
                                {proof.hasClientSeeds && ' · client seeds'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full border font-medium",
                              proof.verified
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                            )}>
                              {proof.verified ? 'Verified' : proof.reason || 'Failed'}
                            </span>
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-emerald-400/50" /> : <ChevronDown className="w-4 h-4 text-emerald-400/50" />}
                          </div>
                        </button>

                        {isExpanded && proof.reveal && (
                          <div className="border-t border-emerald-800/25 p-4 space-y-4 bg-[#061f14]/40">
                            {/* Verification details */}
                            {proof.verificationDetails && (
                              <div className="space-y-1">
                                {proof.verificationDetails.map((d, i) => (
                                  <div key={i} className="text-xs text-emerald-300/60 font-mono leading-relaxed">
                                    {d}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Proof fields */}
                            <div className="grid gap-3 text-xs">
                              {/* Commitment Hash */}
                              <div className="flex flex-col gap-1">
                                <span className="text-emerald-400/50 uppercase tracking-wider text-[10px]">Commitment Hash</span>
                                <div className="flex items-center gap-2">
                                  <code className="text-emerald-200 bg-emerald-950/50 px-2 py-1 rounded font-mono text-[11px] flex-1 overflow-hidden text-ellipsis">
                                    {proof.commitment.commitmentHash}
                                  </code>
                                  <button
                                    onClick={() => copyToClipboard(proof.commitment.commitmentHash, `commit-${proof.roundNumber}`)}
                                    className="text-emerald-400/50 hover:text-emerald-200 transition-colors shrink-0"
                                  >
                                    {copiedField === `commit-${proof.roundNumber}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </div>

                              {/* Server Seed */}
                              <div className="flex flex-col gap-1">
                                <span className="text-emerald-400/50 uppercase tracking-wider text-[10px]">Server Seed</span>
                                <div className="flex items-center gap-2">
                                  <code className="text-emerald-200 bg-emerald-950/50 px-2 py-1 rounded font-mono text-[11px] flex-1 overflow-hidden text-ellipsis">
                                    {proof.reveal.serverSeed}
                                  </code>
                                  <button
                                    onClick={() => copyToClipboard(proof.reveal!.serverSeed, `seed-${proof.roundNumber}`)}
                                    className="text-emerald-400/50 hover:text-emerald-200 transition-colors shrink-0"
                                  >
                                    {copiedField === `seed-${proof.roundNumber}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </div>

                              {/* Client Seeds (v2 only) */}
                              {proof.reveal.clientSeeds && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-purple-400 uppercase tracking-wider text-[10px]">Client Seeds (Defense in Depth)</span>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <span className="text-[9px] text-emerald-500/40">Player 1:</span>
                                      <code className="block text-emerald-200 bg-emerald-950/50 px-2 py-1 rounded font-mono text-[11px] overflow-hidden text-ellipsis mt-0.5">
                                        {proof.reveal.clientSeeds.player1}
                                      </code>
                                    </div>
                                    <div>
                                      <span className="text-[9px] text-emerald-500/40">Player 2:</span>
                                      <code className="block text-emerald-200 bg-emerald-950/50 px-2 py-1 rounded font-mono text-[11px] overflow-hidden text-ellipsis mt-0.5">
                                        {proof.reveal.clientSeeds.player2}
                                      </code>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Combined Seed (v2 only) */}
                              {proof.reveal.combinedSeed && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-purple-400 uppercase tracking-wider text-[10px]">Combined Seed</span>
                                  <code className="text-emerald-200 bg-emerald-950/50 px-2 py-1 rounded font-mono text-[11px] overflow-hidden text-ellipsis">
                                    {proof.reveal.combinedSeed}
                                  </code>
                                </div>
                              )}

                              {/* Nonce + Algorithm + Deck Hash in a row */}
                              <div className="grid grid-cols-3 gap-3">
                                <div>
                                  <span className="text-emerald-400/50 uppercase tracking-wider text-[10px]">Nonce</span>
                                  <div className="text-emerald-200 font-mono text-sm mt-1">{proof.reveal.nonce}</div>
                                </div>
                                <div>
                                  <span className="text-emerald-400/50 uppercase tracking-wider text-[10px]">Algorithm</span>
                                  <div className="text-emerald-200 font-mono text-sm mt-1">v{proof.reveal.algorithmVersion}</div>
                                </div>
                                <div>
                                  <span className="text-emerald-400/50 uppercase tracking-wider text-[10px]">Deck Hash</span>
                                  <div className="text-emerald-300/60 font-mono text-[11px] mt-1 overflow-hidden text-ellipsis">
                                    {proof.reveal.deckHash.slice(0, 20)}...
                                  </div>
                                </div>
                              </div>

                              {/* Timestamps */}
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <span className="text-emerald-400/50 uppercase tracking-wider text-[10px]">Committed At</span>
                                  <div className="text-emerald-300/60 text-[11px] mt-1">
                                    {new Date(proof.commitment.committedAt).toLocaleString()}
                                  </div>
                                </div>
                                <div>
                                  <span className="text-emerald-400/50 uppercase tracking-wider text-[10px]">Revealed At</span>
                                  <div className="text-emerald-300/60 text-[11px] mt-1">
                                    {new Date(proof.reveal.revealedAt).toLocaleString()}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Copy full proof button */}
                            <div className="flex items-center gap-2 pt-2 border-t border-emerald-800/25">
                              <button
                                onClick={() => copyToClipboard(JSON.stringify({
                                  commitment: proof.commitment,
                                  reveal: proof.reveal,
                                  roundNumber: proof.roundNumber,
                                  handId: proof.handId,
                                }, null, 2), `full-${proof.roundNumber}`)}
                                className="flex items-center gap-1.5 text-[11px] text-emerald-400/50 hover:text-emerald-200 transition-colors"
                              >
                                {copiedField === `full-${proof.roundNumber}` ? (
                                  <><Check className="w-3 h-3 text-emerald-400" /> Copied!</>
                                ) : (
                                  <><Copy className="w-3 h-3" /> Copy verification payload</>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* How it works */}
                  <div className="text-[11px] text-emerald-500/40 leading-relaxed border-t border-emerald-800/30 pt-3 mt-4">
                    <p><strong className="text-emerald-400/50">How verification works:</strong> Before each round, the server commits to a shuffle seed by publishing its hash. After the round, the seed is revealed. Anyone can re-derive the shuffle from the seed and verify it matches the committed hash — proving the server did not change the deck after seeing your moves.</p>
                    {fairnessData.proofs.some(p => p.hasClientSeeds) && (
                      <p className="mt-1"><strong className="text-purple-400">Client seed contribution (v2):</strong> Both players contributed random seeds that were combined with the server seed using HMAC-SHA256 before generating the shuffle. This ensures neither the server nor any single player determines the deck order alone.</p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Engine Evaluation Panel */}
        {(evaluation || evalError || loadingEval) && (
          <Card className="bg-emerald-950/30 border-emerald-800/30 overflow-hidden" id="replay-evaluation-panel">
            <CardHeader className="border-b border-emerald-800/30 bg-gradient-to-r from-emerald-950/40 to-[#0a2e1e]/80">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-400" />
                Engine Evaluation
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Apex v2
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {loadingEval ? (
                <div className="flex items-center justify-center py-8">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-emerald-400/50">Running engine evaluation...</span>
                  </div>
                </div>
              ) : evalError ? (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-950/20 border border-amber-500/20">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <p className="text-sm text-amber-300 font-medium">Evaluation Unavailable</p>
                    <p className="text-xs text-amber-400/80 mt-0.5">{evalError}</p>
                    <p className="text-xs text-emerald-400/50 mt-1">The replay viewer is unaffected. Ensure Python is available to run the Apex v2 evaluator.</p>
                  </div>
                </div>
              ) : evaluation ? (
                <div className="space-y-6">
                  {/* Score summary */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                    <div className="flex flex-col items-center">
                      <div className={cn("text-4xl font-bold tabular-nums", accuracyColor(evaluation.requesting_player_accuracy))}>
                        {evaluation.requesting_player_accuracy !== null ? `${evaluation.requesting_player_accuracy}%` : '—'}
                      </div>
                      <div className="text-xs text-emerald-400/50 mt-1 uppercase tracking-wider">Engine Accuracy</div>
                      <div className={cn(
                        "text-xs px-2 py-0.5 rounded-full mt-2 capitalize border",
                        evaluation.requesting_player_label === 'excellent' && 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                        evaluation.requesting_player_label === 'good' && 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
                        evaluation.requesting_player_label === 'fair' && 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                        evaluation.requesting_player_label === 'needs_improvement' && 'bg-orange-500/10 text-orange-400 border-orange-500/20',
                        evaluation.requesting_player_label === 'poor' && 'bg-rose-500/10 text-rose-400 border-rose-500/20',
                      )}>
                        {evaluation.requesting_player_label?.replace('_', ' ')}
                      </div>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="text-xs text-emerald-400/50">{evaluation.total_evaluated} decisions evaluated</div>
                      {Object.entries(evaluation.player_summaries || {}).map(([pid, ps]) => {
                        const isMe = pid === user?.id;
                        return ps.severity_counts ? (
                          <div key={pid} className="flex items-center gap-2 flex-wrap">
                            <span className={cn("text-xs font-medium", isMe ? 'text-emerald-100' : 'text-emerald-400/50')}>
                              {ps.username}:
                            </span>
                            {ps.severity_counts.best > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                ✓ {ps.severity_counts.best}
                              </span>
                            )}
                            {ps.severity_counts.inaccuracy > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                ○ {ps.severity_counts.inaccuracy}
                              </span>
                            )}
                            {ps.severity_counts.mistake > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                △ {ps.severity_counts.mistake}
                              </span>
                            )}
                            {ps.severity_counts.blunder > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                ⚠ {ps.severity_counts.blunder}
                              </span>
                            )}
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                  {/* Methodology note */}
                  <div className="text-[11px] text-emerald-500/40 leading-relaxed border-t border-emerald-800/30 pt-3">
                    {evaluation.methodology_description}
                  </div>
                  {evaluation.evaluation_time_ms !== undefined && (
                    <div className="text-[10px] text-emerald-600/30">
                      Evaluated in {evaluation.evaluation_time_ms}ms · Source: {evalSource}
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        {/* AI Analysis Panel */}
        {(analysis || analysisError || loadingAnalysis) && (
          <Card className="bg-emerald-950/30 border-emerald-800/30 overflow-hidden" id="replay-analysis-panel">
            <CardHeader className="border-b border-emerald-800/30 bg-gradient-to-r from-emerald-950/40 to-[#0a2e1e]/80">
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                AI Match Analysis
                {analysisSource && (
                  <span className={cn(
                    "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full",
                    analysisSource === "ai"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  )}>
                    {analysisSource === "ai" ? "AI Powered" : "Summary"}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {loadingAnalysis ? (
                <div className="flex items-center justify-center py-8">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-emerald-400/50">Analyzing transcript...</span>
                    <span className="text-xs text-emerald-500/40">Reviewing {replay.actions.length} actions across {rounds.length} round(s)</span>
                  </div>
                </div>
              ) : analysisError ? (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-rose-950/20 border border-rose-500/20">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                  <div>
                    <p className="text-sm text-rose-300 font-medium">Analysis Failed</p>
                    <p className="text-xs text-rose-400/80 mt-0.5">{analysisError}</p>
                  </div>
                </div>
              ) : analysis ? (
                <div>
                  <div className="prose prose-invert prose-emerald max-w-none">
                    <div className="markdown-body">
                      <Markdown>{analysis}</Markdown>
                    </div>
                  </div>
                  {analysisMeta && (
                    <div className="mt-6 pt-4 border-t border-emerald-800/30 flex flex-wrap gap-4 text-[11px] text-emerald-500/40">
                      <span>Replay: {analysisMeta.replayId.slice(0, 8)}...</span>
                      <span>Actions analyzed: {analysisMeta.totalActions}</span>
                      <span>Rounds: {analysisMeta.totalRounds}</span>
                      <span>Duration: {Math.round(analysisMeta.durationMs / 1000)}s</span>
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        {/* Step-through controls */}
        <Card className="bg-emerald-950/30 border-emerald-800/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-emerald-300/60">
                {focusedAction !== null
                  ? `Action ${focusedAction + 1} of ${replay.actions.length}`
                  : "Step through the match actions"
                }
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFocusedAction(0)}
                  className="border-emerald-800/40 hover:bg-emerald-950/40 w-8 h-8 p-0"
                  id="replay-step-first"
                >
                  <SkipBack className="w-3.5 h-3.5 text-emerald-300/60" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goPrev}
                  className="border-emerald-800/40 hover:bg-emerald-950/40 w-8 h-8 p-0"
                  id="replay-step-prev"
                >
                  <ChevronUp className="w-4 h-4 text-emerald-300/60" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goNext}
                  className="border-emerald-800/40 hover:bg-emerald-950/40 w-8 h-8 p-0"
                  id="replay-step-next"
                >
                  <ChevronDown className="w-4 h-4 text-emerald-300/60" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFocusedAction(replay.actions.length - 1)}
                  className="border-emerald-800/40 hover:bg-emerald-950/40 w-8 h-8 p-0"
                  id="replay-step-last"
                >
                  <SkipForward className="w-3.5 h-3.5 text-emerald-300/60" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFocusedAction(null)}
                  className="text-emerald-400/50 hover:text-emerald-200 ml-1"
                >
                  Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transcript timeline by round */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-emerald-100 flex items-center gap-2">
            <History className="w-5 h-5 text-amber-400" />
            Match Transcript
          </h2>

          {rounds.map((round, ri) => {
            const isExpanded = expandedRounds.has(round.roundNumber) || rounds.length === 1;
            const roundWinAction = round.actions.find(a => a.type === "round_end");
            const roundWinner = roundWinAction?.playerUsername;

            return (
              <Card key={ri} className="bg-emerald-950/20 border-emerald-800/30 overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-4 hover:bg-emerald-950/30 transition-colors text-left"
                  onClick={() => toggleRound(round.roundNumber)}
                  id={`replay-round-${round.roundNumber}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-sm font-bold text-amber-400">
                      {round.roundNumber || ri + 1}
                    </div>
                    <div>
                      <span className="text-sm font-semibold text-emerald-100">
                        Round {round.roundNumber || ri + 1}
                      </span>
                      <span className="text-xs text-emerald-400/50 ml-3">
                        {round.actions.length} actions
                        {roundWinner ? ` · Won by ${roundWinner}` : ""}
                      </span>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-emerald-400/50" /> : <ChevronDown className="w-4 h-4 text-emerald-400/50" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-emerald-800/25">
                    {round.actions.map((action, ai) => {
                      const globalIdx = replay.actions.indexOf(action);
                      const isFocused = focusedAction === globalIdx;
                      return (
                        <div
                          key={ai}
                          className={cn(
                            "flex items-start gap-3 px-4 py-2.5 border-l-2 transition-all cursor-pointer",
                            actionTypeBg(action.type),
                            isFocused && "!bg-amber-500/10 ring-1 ring-amber-500/30",
                            "hover:bg-emerald-950/20"
                          )}
                          onClick={() => setFocusedAction(globalIdx)}
                          id={`replay-action-${action.seq}`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {actionIcon(action.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-emerald-200 leading-snug">
                              {actionLabel(action)}
                            </div>
                            {/* Evaluation severity badge */}
                            {(() => {
                              const ev = getEvalForSeq(action.seq);
                              if (!ev || ev.severity === 'best') return null;
                              const badge = severityBadge(ev.severity);
                              return (
                                <div className={cn(
                                  "inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded text-[10px] font-medium border",
                                  badge.bg
                                )}>
                                  <span className={badge.text}>{badge.label}</span>
                                  {ev.type === 'discard' && ev.engine_preferred && ev.actual_card !== ev.engine_preferred && (
                                    <span className="text-emerald-400/50">· Engine preferred: {ev.engine_preferred}</span>
                                  )}
                                  {ev.dw_cost !== undefined && ev.dw_cost > 0 && (
                                    <span className="text-emerald-400/50">· +{ev.dw_cost} DW</span>
                                  )}
                                </div>
                              );
                            })()}
                            <div className="text-[10px] text-emerald-500/40 mt-0.5 font-mono">
                              #{action.seq}
                            </div>
                          </div>
                          <div className="text-[10px] text-emerald-500/40 shrink-0 mt-0.5 tabular-nums">
                            {new Date(action.timestamp).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Replay List View ─────────────────────────────────────
  return (
    <div className="space-y-8 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-amber-50 flex items-center gap-3">
            <History className="w-8 h-8 text-amber-400" />
            Match Replays
          </h1>
          <p className="text-sm text-emerald-400/50 mt-1">
            Review your completed multiplayer matches
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-emerald-400/50">Loading replays...</span>
          </div>
        </div>
      ) : replays.length === 0 ? (
        <Card className="bg-emerald-950/20 border-emerald-800/25 p-8 text-center">
          <div className="flex flex-col items-center gap-4">
            <History className="w-12 h-12 text-emerald-600/30" />
            <div>
              <p className="text-emerald-300/60 text-lg font-medium">No replays yet</p>
              <p className="text-emerald-500/40 text-sm mt-1">
                Complete a multiplayer match to see your replay history here.
              </p>
            </div>
            <Link to="/play/multiplayer">
              <Button variant="primary" className="mt-2 bg-emerald-700 hover:bg-emerald-600">
                <Swords className="w-4 h-4 mr-2" />
                Play Multiplayer
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {replays.map((replay) => {
            const isWinner = replay.outcome.winnerId === user?.id;
            const opponent = replay.players.find(p => p.userId !== user?.id);
            const myScore = isWinner ? replay.outcome.winnerScore : replay.outcome.loserScore;
            const oppScore = isWinner ? replay.outcome.loserScore : replay.outcome.winnerScore;

            return (
              <Card
                key={replay.id}
                onClick={() => openReplay(replay.id)}
                className="bg-emerald-950/20 border-emerald-800/25 hover:bg-emerald-950/40 hover:border-emerald-800/40/60 transition-all cursor-pointer group"
                id={`replay-item-${replay.id}`}
              >
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    {/* Result indicator */}
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center font-bold text-sm",
                      isWinner
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    )}>
                      {isWinner ? "W" : "L"}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-emerald-100">
                          vs {opponent?.username || "Unknown"}
                        </span>
                        <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", endReasonColor(replay.outcome.endReason))}>
                          {endReasonLabel(replay.outcome.endReason)}
                        </span>
                      </div>
                      <div className="text-xs text-emerald-400/50 flex items-center gap-3 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {timeAgo(replay.endedAt)}
                        </span>
                        <span>·</span>
                        <span>{replay.actionCount} actions</span>
                        <span>·</span>
                        <span>{formatDuration(replay.startedAt, replay.endedAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-right hidden sm:block">
                      <div className="text-lg font-bold text-emerald-100 tabular-nums">
                        {myScore} - {oppScore}
                      </div>
                      <div className="text-xs text-emerald-400/50">Score</div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-emerald-500/40 group-hover:text-emerald-300/60 transition-colors" />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {loadingDetail && (
        <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-emerald-300/60">Loading replay...</span>
          </div>
        </div>
      )}
    </div>
  );
}
