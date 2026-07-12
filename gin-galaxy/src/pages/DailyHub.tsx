/**
 * Daily Hub — Daily Missions, Streaks, and Puzzle for Gin Paradise.
 *
 * Primary retention surface that shows:
 * - Daily streak check-in with animated progress
 * - Today's missions with progress bars and claim buttons
 * - Daily puzzle/challenge with interactive scenario
 * - Reward summary and economy transparency
 */

import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Flame, Target, Puzzle, Gift, ChevronRight, Check, Star,
  Coins, Crown, Calendar, Zap, Trophy, ArrowRight, Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { cn } from "@/src/lib/utils";
import { useAuthStore } from "@/src/lib/store";

// ─── Types ──────────────────────────────────────────────────────────────

interface MissionDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  targetCount: number;
  rewardCoins: number;
  category: string;
}

interface PlayerMission {
  missionId: string;
  definition: MissionDefinition;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  nextReward: { day: number; coins: number };
  streakPreserved: boolean;
  todayCheckedIn: boolean;
}

interface PuzzleScenario {
  title: string;
  description: string;
  hand: number[];
  discardTop: number;
  stockAvailable: boolean;
  deadwood: number;
  optimalAction?: string;
  optimalReason?: string;
  difficulty: string;
}

interface DailyPuzzle {
  puzzleId: string;
  puzzleDate: string;
  scenario: PuzzleScenario;
  completed: boolean;
  playerChoice: string | null;
  wasOptimal: boolean | null;
  rewardClaimed: boolean;
}

interface DailySummary {
  missions: PlayerMission[];
  streak: StreakInfo;
  puzzle: DailyPuzzle;
  todayDate: string;
  totalAvailableCoins: number;
  totalClaimedCoins: number;
  balances: { gold_coins: number; sweeps_coins: number };
}

// ─── Card Helpers ───────────────────────────────────────────────────────

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function cardName(id: number): string {
  const suit = SUITS[Math.floor(id / 13)];
  const rank = RANKS[id % 13];
  return `${rank}${suit}`;
}

function cardColor(id: number): string {
  const suitIdx = Math.floor(id / 13);
  return suitIdx === 1 || suitIdx === 2 ? "text-red-400" : "text-zinc-200";
}

// ─── Difficulty Badge ───────────────────────────────────────────────────

const DIFFICULTY_STYLES: Record<string, string> = {
  easy: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  hard: "bg-red-500/20 text-red-400 border-red-500/40",
};

// ─── Main Component ─────────────────────────────────────────────────────

export function DailyHub() {
  const { sessionId } = useAuthStore();
  const [data, setData] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [claimingMission, setClaimingMission] = useState<string | null>(null);
  const [puzzleChoice, setPuzzleChoice] = useState<string | null>(null);
  const [puzzleSubmitting, setPuzzleSubmitting] = useState(false);
  const [puzzleResult, setPuzzleResult] = useState<{
    wasOptimal: boolean;
    optimalAction: string;
    optimalReason: string;
  } | null>(null);
  const [puzzleClaiming, setPuzzleClaiming] = useState(false);
  const [rewardFlash, setRewardFlash] = useState<{ coins: number; label: string } | null>(null);

  const headers = React.useMemo(() => ({ Authorization: `Bearer ${sessionId}` }), [sessionId]);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/daily", { headers });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── Handlers ───────────────────────────────────────────────────────

  const handleCheckIn = async () => {
    setCheckInLoading(true);
    try {
      const res = await fetch("/api/daily/checkin", { method: "POST", headers });
      const json = await res.json();
      if (json.success) {
        setRewardFlash({ coins: json.coinsAwarded, label: `Day ${json.streakDay} Streak Bonus!` });
        setTimeout(() => setRewardFlash(null), 3000);
      }
      await loadData();
    } finally {
      setCheckInLoading(false);
    }
  };

  const handleClaimMission = async (missionId: string) => {
    setClaimingMission(missionId);
    try {
      const res = await fetch(`/api/daily/missions/${missionId}/claim`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (json.success) {
        setRewardFlash({ coins: json.coinsAwarded, label: "Mission Complete!" });
        setTimeout(() => setRewardFlash(null), 3000);
      }
      await loadData();
    } finally {
      setClaimingMission(null);
    }
  };

  const handlePuzzleSubmit = async () => {
    if (!puzzleChoice) return;
    setPuzzleSubmitting(true);
    try {
      const res = await fetch("/api/daily/puzzle/submit", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ choice: puzzleChoice }),
      });
      const json = await res.json();
      if (json.success) {
        setPuzzleResult({
          wasOptimal: json.wasOptimal,
          optimalAction: json.optimalAction,
          optimalReason: json.optimalReason,
        });
      }
      await loadData();
    } finally {
      setPuzzleSubmitting(false);
    }
  };

  const handlePuzzleClaim = async () => {
    setPuzzleClaiming(true);
    try {
      const res = await fetch("/api/daily/puzzle/claim", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (json.success) {
        setRewardFlash({
          coins: json.coinsAwarded,
          label: `Puzzle Reward! ${json.breakdown.optimalBonus > 0 ? "(Optimal Bonus!)" : ""}`,
        });
        setTimeout(() => setRewardFlash(null), 3000);
      }
      await loadData();
    } finally {
      setPuzzleClaiming(false);
    }
  };

  // ─── Loading State ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center text-zinc-500 py-20">
        <p>Unable to load daily content. Please try again.</p>
      </div>
    );
  }

  const { missions, streak, puzzle } = data;

  // ─── Puzzle Action Options ──────────────────────────────────────────

  const puzzleActions = [
    { id: "draw_stock", label: "Draw from Stock", icon: "📦" },
    { id: "draw_discard", label: "Draw from Discard", icon: "♻️" },
    { id: "knock", label: "Knock", icon: "👊" },
    ...(puzzle.scenario.hand || [])
      .filter((_, i) => i > 6) // Show discard options for last 3 cards
      .map(cardId => ({
        id: `discard_${cardId}`,
        label: `Discard ${cardName(cardId)}`,
        icon: "🗑️",
      })),
  ];

  return (
    <div className="space-y-8 pb-20 md:pb-0 max-w-5xl mx-auto">
      {/* ─── Reward Flash ────────────────────────────────────────────── */}
      {rewardFlash && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-6 py-3 rounded-xl shadow-2xl shadow-amber-500/30 flex items-center gap-3 text-lg font-bold">
            <Coins className="w-6 h-6" />
            +{rewardFlash.coins} Coins — {rewardFlash.label}
            <Sparkles className="w-5 h-5" />
          </div>
        </div>
      )}

      {/* ─── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            Daily Hub
          </h1>
          <p className="text-emerald-300/60 mt-1">
            Complete missions, maintain your streak, and solve today's puzzle.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-3 px-4 py-2 rounded-xl bg-emerald-950/40 border border-emerald-800/40">
          <Coins className="w-4 h-4 text-amber-500" />
          <span className="text-lg font-bold text-amber-50">{data.balances.gold_coins.toLocaleString()}</span>
          <span className="text-xs text-emerald-400/50">coins</span>
        </div>
      </div>

      {/* ─── Streak Section ──────────────────────────────────────────── */}
      <section>
        <Card className={cn(
          "relative overflow-hidden border transition-all duration-500",
          streak.todayCheckedIn
            ? "bg-gradient-to-br from-emerald-950/40 to-zinc-900/40 border-emerald-900/50"
            : "bg-gradient-to-br from-amber-950/40 to-zinc-900/40 border-amber-900/50"
        )}>
          {/* Animated fire background for active streaks */}
          {streak.currentStreak >= 3 && (
            <div className="absolute top-0 right-0 w-32 h-32 opacity-10">
              <Flame className="w-32 h-32 text-amber-500 animate-pulse" />
            </div>
          )}
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold shadow-lg",
                    streak.currentStreak >= 7
                      ? "bg-gradient-to-br from-amber-500 to-red-500 text-white shadow-amber-500/30"
                      : streak.currentStreak >= 3
                        ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-amber-500/20"
                        : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                  )}>
                    {streak.currentStreak}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-amber-50">
                      Daily Streak
                    </h2>
                    <p className="text-sm text-emerald-300/60">
                      {streak.currentStreak === 0
                        ? "Check in to start your streak!"
                        : streak.todayCheckedIn
                          ? "Streak preserved ✓"
                          : "Check in today to keep your streak!"}
                    </p>
                  </div>
                </div>

                {/* Streak stats row */}
                <div className="flex items-center gap-6 text-sm">
                  <div className="flex items-center gap-1.5 text-emerald-400/50">
                    <Trophy className="w-3.5 h-3.5 text-amber-500" />
                    <span>Best: <strong className="text-emerald-200">{streak.longestStreak}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-400/50">
                    <Coins className="w-3.5 h-3.5 text-amber-500" />
                    <span>Next: <strong className="text-amber-400">{streak.nextReward.coins}</strong> coins (day {streak.nextReward.day})</span>
                  </div>
                </div>

                {/* 7-day visual streak indicator */}
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: 7 }, (_, i) => {
                    const dayNum = i + 1;
                    const isActive = dayNum <= streak.currentStreak % 7 || (streak.currentStreak > 0 && streak.currentStreak % 7 === 0 && dayNum <= 7);
                    return (
                      <div
                        key={i}
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold transition-all",
                          isActive
                            ? "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm shadow-amber-500/20"
                            : "bg-emerald-950/40 text-emerald-600 border border-emerald-800/40"
                        )}
                      >
                        {dayNum}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Check-in button */}
              <div className="flex-shrink-0">
                {streak.todayCheckedIn ? (
                  <div className="flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <Check className="w-5 h-5" />
                    <span className="font-semibold">Checked In</span>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={handleCheckIn}
                    disabled={checkInLoading}
                    className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold px-8 py-3 rounded-xl shadow-lg shadow-amber-500/20 transition-all hover:shadow-amber-500/30 hover:scale-105"
                    id="daily-checkin-btn"
                  >
                    {checkInLoading ? (
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                    ) : (
                      <>
                        <Flame className="w-5 h-5 mr-2" />
                        Check In (+{streak.nextReward.coins} coins)
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── Missions Section ────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2 text-amber-50">
            <Target className="w-5 h-5 text-emerald-400" />
            Today's Missions
          </h2>
          <div className="text-sm text-emerald-400/50">
            {missions.filter(m => m.completed).length}/{missions.length} completed
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {missions.map((mission) => {
            const progressPct = Math.min(100, (mission.progress / mission.definition.targetCount) * 100);
            return (
              <Card
                key={mission.missionId}
                className={cn(
                  "transition-all border",
                  mission.claimed
                    ? "bg-emerald-950/10 border-emerald-800/20 opacity-70"
                    : mission.completed
                      ? "bg-gradient-to-br from-emerald-950/30 to-[#0a2e1e]/30 border-emerald-800/40"
                      : "bg-emerald-950/20 border-emerald-800/30 hover:bg-emerald-900/30"
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg",
                      mission.completed ? "bg-emerald-500/20" : "bg-emerald-950/40 border border-emerald-800/30"
                    )}>
                      {mission.definition.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-emerald-100 truncate">
                          {mission.definition.title}
                        </h3>
                        <span className="flex items-center gap-1 text-xs font-bold text-amber-400 flex-shrink-0">
                          <Coins className="w-3 h-3" />
                          {mission.definition.rewardCoins}
                        </span>
                      </div>
                      <p className="text-xs text-emerald-400/50 mt-0.5">{mission.definition.description}</p>

                      {/* Progress bar */}
                      <div className="mt-2 space-y-1">
                        <div className="h-1.5 rounded-full bg-[#0a2e1e]/80 overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-700",
                              mission.completed
                                ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                                : "bg-gradient-to-r from-emerald-500 to-emerald-400"
                            )}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-emerald-500/40">
                            {mission.progress}/{mission.definition.targetCount}
                          </span>
                          {mission.completed && !mission.claimed && (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleClaimMission(mission.missionId)}
                              disabled={claimingMission === mission.missionId}
                              className="h-6 px-3 text-xs bg-emerald-600 hover:bg-emerald-500 rounded-lg"
                              id={`claim-mission-${mission.missionId}`}
                            >
                              {claimingMission === mission.missionId ? "..." : (
                                <><Gift className="w-3 h-3 mr-1" /> Claim</>
                              )}
                            </Button>
                          )}
                          {mission.claimed && (
                            <span className="text-[10px] text-emerald-500 flex items-center gap-0.5">
                              <Check className="w-3 h-3" /> Claimed
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ─── Daily Puzzle Section ────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2 text-amber-50">
            <Puzzle className="w-5 h-5 text-amber-400" />
            Daily Puzzle
          </h2>
          <span className={cn(
            "text-xs font-bold uppercase px-2 py-0.5 rounded border",
            DIFFICULTY_STYLES[puzzle.scenario.difficulty] || DIFFICULTY_STYLES.medium
          )}>
            {puzzle.scenario.difficulty}
          </span>
        </div>

        <Card className="bg-gradient-to-br from-emerald-950/30 via-[#0a2e1e]/30 to-emerald-950/20 border-emerald-800/40">
          <CardContent className="p-6">
            <div className="space-y-5">
              {/* Scenario title & description */}
              <div>
                <h3 className="text-lg font-bold text-amber-50">{puzzle.scenario.title}</h3>
                <p className="text-sm text-emerald-300/60 mt-1">{puzzle.scenario.description}</p>
              </div>

              {/* Hand display */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-emerald-400/50 uppercase tracking-wider">Your Hand</label>
                <div className="flex flex-wrap gap-1.5">
                  {(puzzle.scenario.hand || []).map((cardId, i) => (
                    <div
                      key={i}
                      className={cn(
                        "w-10 h-14 rounded-lg border flex items-center justify-center text-xs font-bold",
                        "bg-emerald-950/60 border-emerald-800/40",
                        cardColor(cardId)
                      )}
                    >
                      {cardName(cardId)}
                    </div>
                  ))}
                </div>
              </div>

              {/* Discard pile */}
              <div className="flex items-center gap-4">
                <div>
                  <label className="text-xs font-medium text-emerald-400/50 uppercase tracking-wider">Discard Top</label>
                  <div className={cn(
                    "w-12 h-16 mt-1 rounded-lg border-2 flex items-center justify-center text-sm font-bold",
                    "bg-amber-900/20 border-amber-500/40",
                    cardColor(puzzle.scenario.discardTop)
                  )}>
                    {cardName(puzzle.scenario.discardTop)}
                  </div>
                </div>
                <div className="text-sm text-emerald-400/50">
                  <div>Deadwood: <strong className="text-emerald-200">{puzzle.scenario.deadwood}</strong></div>
                  <div>Stock: {puzzle.scenario.stockAvailable ? "✓ Available" : "✗ Empty"}</div>
                </div>
              </div>

              {/* Answer choices (before submission) */}
              {!puzzle.completed && !puzzleResult && (
                <div className="space-y-3">
                  <label className="text-xs font-medium text-emerald-400/50 uppercase tracking-wider">What's Your Move?</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {puzzleActions.map(action => (
                      <button
                        key={action.id}
                        onClick={() => setPuzzleChoice(action.id)}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left",
                          puzzleChoice === action.id
                            ? "bg-amber-500/20 border-amber-500/60 text-amber-200"
                            : "bg-emerald-950/30 border-emerald-800/40 text-emerald-200 hover:bg-emerald-900/30"
                        )}
                      >
                        <span className="text-lg">{action.icon}</span>
                        <span className="text-sm font-medium">{action.label}</span>
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="primary"
                    onClick={handlePuzzleSubmit}
                    disabled={!puzzleChoice || puzzleSubmitting}
                    className="w-full bg-emerald-700 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl mt-2"
                    id="daily-puzzle-submit-btn"
                  >
                    {puzzleSubmitting ? "Analyzing..." : "Submit Answer"}
                  </Button>
                </div>
              )}

              {/* Result (after submission) */}
              {(puzzle.completed || puzzleResult) && (
                <div className={cn(
                  "rounded-xl p-4 border",
                  (puzzleResult?.wasOptimal ?? puzzle.wasOptimal)
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : "bg-amber-500/10 border-amber-500/30"
                )}>
                  <div className="flex items-center gap-2 mb-2">
                    {(puzzleResult?.wasOptimal ?? puzzle.wasOptimal) ? (
                      <>
                        <Star className="w-5 h-5 text-emerald-400" />
                        <span className="font-bold text-emerald-400">Optimal! Great read.</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-5 h-5 text-amber-400" />
                        <span className="font-bold text-amber-400">Good try!</span>
                      </>
                    )}
                  </div>
                  <p className="text-sm text-emerald-200">
                    <strong>Best play:</strong> {puzzleResult?.optimalAction ?? puzzle.scenario.optimalAction}
                  </p>
                  <p className="text-sm text-emerald-300/60 mt-1">
                    {puzzleResult?.optimalReason ?? puzzle.scenario.optimalReason}
                  </p>

                  {/* Claim reward */}
                  {!puzzle.rewardClaimed && (
                    <Button
                      variant="primary"
                      onClick={handlePuzzleClaim}
                      disabled={puzzleClaiming}
                      className="mt-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold px-6 py-2 rounded-xl"
                      id="daily-puzzle-claim-btn"
                    >
                      {puzzleClaiming ? "Claiming..." : (
                        <>
                          <Gift className="w-4 h-4 mr-2" />
                          Claim Reward (100{(puzzleResult?.wasOptimal ?? puzzle.wasOptimal) ? "+50 bonus" : ""} coins)
                        </>
                      )}
                    </Button>
                  )}
                  {puzzle.rewardClaimed && (
                    <div className="mt-3 flex items-center gap-2 text-emerald-400 text-sm">
                      <Check className="w-4 h-4" />
                      <span>Reward claimed!</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── Reward Summary ──────────────────────────────────────────── */}
      <section>
        <Card className="bg-emerald-950/20 border-emerald-800/30">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-emerald-300/60 flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-500" />
                Today's Earnings
              </h3>
              <span className="text-xs text-emerald-500/40">
                {data.todayDate}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-2xl font-bold text-amber-400">
                  {data.totalClaimedCoins.toLocaleString()}
                  <span className="text-sm text-emerald-400/50 ml-1">/ {data.totalAvailableCoins.toLocaleString()} available</span>
                </div>
                <p className="text-xs text-emerald-500/40">
                  Missions + Streak + Puzzle rewards
                </p>
              </div>
              <Link to="/wallet">
                <Button variant="ghost" size="sm" className="text-amber-400 hover:text-amber-300">
                  Wallet <ArrowRight className="ml-1 w-4 h-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── Premium Upsell (subtle) ─────────────────────────────────── */}
      <section>
        <Card className="bg-emerald-950/15 border-emerald-800/30">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Crown className="w-5 h-5 text-amber-500" />
              <div>
                <p className="text-sm font-medium text-emerald-200/80">Gin Paradise Pro</p>
                <p className="text-xs text-emerald-400/50">Extended puzzle history, bonus rewards, AI coaching</p>
              </div>
            </div>
            <Link to="/premium">
              <Button variant="outline" size="sm" className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10">
                Learn More <ChevronRight className="ml-1 w-3 h-3" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
