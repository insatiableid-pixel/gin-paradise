/**
 * Tournament System for Gin Paradise — Scheduled + SNG.
 *
 * Formats:
 *   sit_and_go_4:     Legacy 4-player fill-on-demand bracket.
 *   scheduled:        Admin-created scheduled events with variable field sizes,
 *                     automatic byes, rating-based seeding, and no-show handling.
 *
 * Lifecycle (SNG):
 *   open → in_progress → completed
 *   open → cancelled
 *
 * Lifecycle (Scheduled):
 *   registration_open → registration_closed → in_progress → completed
 *   registration_open → cancelled (admin or insufficient field)
 *
 * Entry & Economy:
 *   - Free-play tournaments: no entry fee, no prize, no rake.
 *   - Paid tournaments: entry fee deducted on join (escrow hold),
 *     winner-take-all payout on completion, configurable rake on total pool.
 *   - Cancellation/refund: if tournament cancelled before meaningful play,
 *     all entry fees refunded in full, no rake taken.
 *
 * Bracket:
 *   SNG: Fixed 4-player bracket (SF1: 1v4, SF2: 2v3, Final).
 *   Scheduled: Single-elimination bracket of 2-128 players.
 *     - Variable sizes: rounds up to next power-of-two for bracket.
 *     - Byes awarded to highest-seeded players when field < bracket size.
 *     - Seeding: by Elo rating (highest = seed 1, descending).
 *     - Round-gated: no round starts until all matches of previous round resolve.
 *     - No-show: pending matches auto-forfeit after NO_SHOW_TIMEOUT_MS.
 *
 * Integration:
 *   - Reuses existing wallet/ledger/escrow primitives for all balance mutations.
 *   - Match outcomes hook back into advanceBracket() via roomManager.
 *   - Tournament matches create normal replays via the existing transcript pipeline.
 */

import crypto from "crypto";
import { db } from "./db.js";
import { mutateBalance, getBalances, type Currency } from "./ledger.js";
import { recordRake } from "./houseAccounting.js";
import { triggerLiveAchievements } from "./achievements.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type TournamentStatus =
  | "open"                // SNG: waiting for fill
  | "registration_open"   // Scheduled: accepting registrations
  | "registration_closed" // Scheduled: registrations locked, waiting for start
  | "in_progress"         // Matches underway
  | "completed"           // Winner determined
  | "cancelled";          // Admin-cancelled or insufficient field

export type TournamentFormat = "sit_and_go_4" | "scheduled";

export interface TournamentConfig {
  /** Display name */
  name: string;
  /** Entry fee per player (0 = free) */
  entryFee: number;
  /** Currency for entry/prize */
  currency: Currency;
  /** Rake as decimal (0.05 = 5%). 0 for free-play. */
  rakePercent: number;
}

export interface ScheduledTournamentConfig extends TournamentConfig {
  /** Scheduled start time (epoch ms) */
  startTime: number;
  /** Max field size / bracket cap (2-128, must be ≥2) */
  maxEntrants: number;
  /** Minimum players required to start (default: 2) */
  minEntrants: number;
  /** Admin-created flag */
  adminCreated: boolean;
}

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  entryFee: number;
  currency: Currency;
  rakePercent: number;
  /** Total prize pool = entryFee × entrantCount (computed on start) */
  totalPool: number;
  /** Rake amount = totalPool × rakePercent */
  rakeAmount: number;
  /** Net prize for winner = totalPool - rakeAmount */
  prizePool: number;
  entrants: TournamentEntrant[];
  bracket: TournamentBracket | null;
  winnerId: string | null;
  winnerUsername: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;

  // ─── Scheduled tournament fields ──────────────────────────────────
  /** Scheduled start time (epoch ms). Null for SNG. */
  scheduledStartTime: number | null;
  /** Maximum entrants allowed (4 for SNG, configurable for scheduled) */
  maxEntrants: number;
  /** Minimum entrants required to start (default: 2 for scheduled, 4 for SNG) */
  minEntrants: number;
  /** Whether this tournament was admin-created */
  adminCreated: boolean;
  /** Current round number (1-indexed). Null before bracket created. */
  currentRound: number | null;
  /** Total rounds in the bracket. Null before bracket created. */
  totalRounds: number | null;
}

export interface TournamentEntrant {
  userId: string;
  username: string;
  seed: number | null;
  eliminated: boolean;
  joinedAt: number;
  /** Elo rating at time of seeding */
  rating?: number;
}

export interface BracketMatch {
  matchIndex: number;
  round: string; // "round_1", "semifinal", "quarterfinal", "final", etc.
  roundNumber: number; // 1-indexed round number
  player1Id: string | null;
  player1Username: string | null;
  player2Id: string | null;
  player2Username: string | null;
  winnerId: string | null;
  winnerUsername: string | null;
  roomId: string | null;
  replayId: string | null;
  status: "pending" | "in_progress" | "completed" | "bye";
  /** Epoch ms when no-show timer started. Null if not applicable. */
  noShowDeadline: number | null;
}

export interface TournamentBracket {
  matches: BracketMatch[];
}

// ─── Constants ──────────────────────────────────────────────────────────

/** No-show timeout: 5 minutes for a pending match before auto-forfeit */
export const NO_SHOW_TIMEOUT_MS = 5 * 60 * 1000;

/** Scheduled start check interval */
const SCHEDULED_CHECK_INTERVAL = 10_000; // 10 seconds

// ─── In-memory state ────────────────────────────────────────────────────

const tournaments = new Map<string, Tournament>();

// Track which rooms belong to tournaments: roomId → { tournamentId, matchIndex }
const roomToTournament = new Map<string, { tournamentId: string; matchIndex: number }>();

// ─── Tournament Presets ─────────────────────────────────────────────────

export const TOURNAMENT_PRESETS: TournamentConfig[] = [
  { name: "Free Sit & Go", entryFee: 0, currency: "gold_coins", rakePercent: 0 },
  { name: "500 Gold Sit & Go", entryFee: 500, currency: "gold_coins", rakePercent: 0.05 },
  { name: "2,000 Gold Sit & Go", entryFee: 2000, currency: "gold_coins", rakePercent: 0.05 },
];

// ─── Create SNG Tournament (existing) ───────────────────────────────────

export function createTournament(config: TournamentConfig): Tournament {
  const id = crypto.randomUUID();
  const totalPool = config.entryFee * 4;
  const rakeAmount = Math.round(totalPool * config.rakePercent * 100) / 100;
  const prizePool = totalPool - rakeAmount;

  const tournament: Tournament = {
    id,
    name: config.name,
    format: "sit_and_go_4",
    status: "open",
    entryFee: config.entryFee,
    currency: config.currency,
    rakePercent: config.rakePercent,
    totalPool,
    rakeAmount,
    prizePool,
    entrants: [],
    bracket: null,
    winnerId: null,
    winnerUsername: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    scheduledStartTime: null,
    maxEntrants: 4,
    minEntrants: 4,
    adminCreated: false,
    currentRound: null,
    totalRounds: null,
  };

  tournaments.set(id, tournament);
  _persistTournament(tournament);

  return tournament;
}

// ─── Create Scheduled Tournament (admin-only) ───────────────────────────

export function createScheduledTournament(config: ScheduledTournamentConfig): Tournament {
  const id = crypto.randomUUID();

  const maxEntrants = Math.min(Math.max(config.maxEntrants, 2), 128);
  const minEntrants = Math.min(Math.max(config.minEntrants || 2, 2), maxEntrants);

  const tournament: Tournament = {
    id,
    name: config.name,
    format: "scheduled",
    status: "registration_open",
    entryFee: config.entryFee,
    currency: config.currency,
    rakePercent: config.rakePercent,
    // Economics computed at lock time based on actual field size
    totalPool: 0,
    rakeAmount: 0,
    prizePool: 0,
    entrants: [],
    bracket: null,
    winnerId: null,
    winnerUsername: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    scheduledStartTime: config.startTime,
    maxEntrants,
    minEntrants,
    adminCreated: config.adminCreated,
    currentRound: null,
    totalRounds: null,
  };

  tournaments.set(id, tournament);
  _persistTournament(tournament);

  return tournament;
}

// ─── Join Tournament ────────────────────────────────────────────────────

export interface JoinResult {
  ok: boolean;
  error?: string;
  tournament?: Tournament;
  filled?: boolean;
}

export function joinTournament(tournamentId: string, userId: string, username: string): JoinResult {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) {
    return { ok: false, error: "Tournament not found." };
  }

  // Check joinable status
  const joinableStatuses: TournamentStatus[] = ["open", "registration_open"];
  if (!joinableStatuses.includes(tournament.status)) {
    return { ok: false, error: "Tournament is not open for entry." };
  }
  if (tournament.entrants.some(e => e.userId === userId)) {
    return { ok: false, error: "Already registered for this tournament." };
  }
  if (tournament.entrants.length >= tournament.maxEntrants) {
    return { ok: false, error: "Tournament is full." };
  }

  // Balance check for paid tournaments
  if (tournament.entryFee > 0) {
    const balances = getBalances(userId);
    const balance = balances[tournament.currency];
    if (balance < tournament.entryFee) {
      return {
        ok: false,
        error: `Insufficient ${tournament.currency === "sweeps_coins" ? "Sweeps" : "Gold"} balance. Need ${tournament.entryFee}, have ${balance}.`,
      };
    }

    // Deduct entry fee
    mutateBalance(
      userId,
      tournament.currency,
      -tournament.entryFee,
      "escrow_hold",
      tournamentId,
      `Tournament entry: ${tournament.name}`
    );
  }

  tournament.entrants.push({
    userId,
    username,
    seed: null,
    eliminated: false,
    joinedAt: Date.now(),
  });

  // SNG: auto-start when 4 players fill
  let filled = false;
  if (tournament.format === "sit_and_go_4" && tournament.entrants.length === 4) {
    filled = true;
    _startSNGTournament(tournament);
  }

  _persistTournament(tournament);

  return { ok: true, tournament, filled };
}

// ─── Leave / Cancel Entry ───────────────────────────────────────────────

export function leaveTournament(tournamentId: string, userId: string): { ok: boolean; error?: string } {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) {
    return { ok: false, error: "Tournament not found." };
  }
  const leavableStatuses: TournamentStatus[] = ["open", "registration_open"];
  if (!leavableStatuses.includes(tournament.status)) {
    return { ok: false, error: "Cannot leave a tournament that has already started." };
  }
  const idx = tournament.entrants.findIndex(e => e.userId === userId);
  if (idx === -1) {
    return { ok: false, error: "Not registered for this tournament." };
  }

  // Refund entry fee
  if (tournament.entryFee > 0) {
    mutateBalance(
      userId,
      tournament.currency,
      tournament.entryFee,
      "refund",
      tournamentId,
      `Tournament exit refund: ${tournament.name}`
    );
  }

  tournament.entrants.splice(idx, 1);
  _persistTournament(tournament);

  return { ok: true };
}

// ─── Cancel Tournament ──────────────────────────────────────────────────

export function cancelTournament(tournamentId: string): { ok: boolean; error?: string } {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) {
    return { ok: false, error: "Tournament not found." };
  }
  if (tournament.status === "completed" || tournament.status === "cancelled") {
    return { ok: false, error: "Tournament is already finished." };
  }

  // Refund all entrants
  if (tournament.entryFee > 0) {
    for (const entrant of tournament.entrants) {
      mutateBalance(
        entrant.userId,
        tournament.currency,
        tournament.entryFee,
        "refund",
        tournamentId,
        `Tournament cancelled — refund: ${tournament.name}`
      );
    }
  }

  tournament.status = "cancelled";
  _persistTournament(tournament);

  return { ok: true };
}

// ─── Lock Registration (scheduled tournaments) ─────────────────────────

export function lockRegistration(tournamentId: string): { ok: boolean; error?: string } {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) {
    return { ok: false, error: "Tournament not found." };
  }
  if (tournament.format !== "scheduled") {
    return { ok: false, error: "Only scheduled tournaments support registration lock." };
  }
  if (tournament.status !== "registration_open") {
    return { ok: false, error: "Tournament is not in registration_open state." };
  }

  tournament.status = "registration_closed";
  _persistTournament(tournament);
  return { ok: true };
}

// ─── Start Scheduled Tournament ────────────────────────────────────────

export function startScheduledTournament(tournamentId: string): {
  ok: boolean;
  error?: string;
  tournament?: Tournament;
} {
  const tournament = tournaments.get(tournamentId);
  if (!tournament) {
    return { ok: false, error: "Tournament not found." };
  }
  if (tournament.format !== "scheduled") {
    return { ok: false, error: "Only scheduled tournaments support manual start." };
  }
  if (tournament.status !== "registration_open" && tournament.status !== "registration_closed") {
    return { ok: false, error: `Cannot start tournament in '${tournament.status}' state.` };
  }

  // Check minimum entrants
  if (tournament.entrants.length < tournament.minEntrants) {
    // Cancel and refund
    cancelTournament(tournamentId);
    return { ok: false, error: `Insufficient players (${tournament.entrants.length}/${tournament.minEntrants}). Tournament cancelled and refunded.` };
  }

  // Fetch ratings for seeding
  _fetchRatingsForEntrants(tournament);

  _startScheduledTournament(tournament);
  return { ok: true, tournament };
}

// ─── Start SNG Tournament (internal) ────────────────────────────────────

function _startSNGTournament(tournament: Tournament): void {
  tournament.status = "in_progress";
  tournament.startedAt = Date.now();

  // Random seeding
  const shuffled = [...tournament.entrants].sort(() => Math.random() - 0.5);
  shuffled.forEach((e, i) => { e.seed = i + 1; });
  tournament.entrants = shuffled;

  // Compute economics for SNG
  tournament.totalPool = tournament.entryFee * 4;
  tournament.rakeAmount = Math.round(tournament.totalPool * tournament.rakePercent * 100) / 100;
  tournament.prizePool = tournament.totalPool - tournament.rakeAmount;

  // Create bracket
  // SF1: Seed 1 vs Seed 4
  // SF2: Seed 2 vs Seed 3
  // Final: pending
  const sf1 = shuffled[0]; // seed 1
  const sf2 = shuffled[3]; // seed 4
  const sf3 = shuffled[1]; // seed 2
  const sf4 = shuffled[2]; // seed 3

  tournament.bracket = {
    matches: [
      {
        matchIndex: 0,
        round: "semifinal",
        roundNumber: 1,
        player1Id: sf1.userId,
        player1Username: sf1.username,
        player2Id: sf2.userId,
        player2Username: sf2.username,
        winnerId: null,
        winnerUsername: null,
        roomId: null,
        replayId: null,
        status: "pending",
        noShowDeadline: null,
      },
      {
        matchIndex: 1,
        round: "semifinal",
        roundNumber: 1,
        player1Id: sf3.userId,
        player1Username: sf3.username,
        player2Id: sf4.userId,
        player2Username: sf4.username,
        winnerId: null,
        winnerUsername: null,
        roomId: null,
        replayId: null,
        status: "pending",
        noShowDeadline: null,
      },
      {
        matchIndex: 2,
        round: "final",
        roundNumber: 2,
        player1Id: null,
        player1Username: null,
        player2Id: null,
        player2Username: null,
        winnerId: null,
        winnerUsername: null,
        roomId: null,
        replayId: null,
        status: "pending",
        noShowDeadline: null,
      },
    ],
  };

  tournament.currentRound = 1;
  tournament.totalRounds = 2;

  // Start no-show timers for semifinal matches
  _setNoShowDeadlines(tournament, 1);
}

// ─── Start Scheduled Tournament (internal) ──────────────────────────────

function _startScheduledTournament(tournament: Tournament): void {
  const entrantCount = tournament.entrants.length;

  // Compute economics based on actual field size
  tournament.totalPool = tournament.entryFee * entrantCount;
  tournament.rakeAmount = Math.round(tournament.totalPool * tournament.rakePercent * 100) / 100;
  tournament.prizePool = tournament.totalPool - tournament.rakeAmount;

  // Seed by rating (highest rating = seed 1)
  const sorted = [...tournament.entrants].sort((a, b) => {
    const rA = a.rating ?? 1200;
    const rB = b.rating ?? 1200;
    return rB - rA; // Descending
  });
  sorted.forEach((e, i) => { e.seed = i + 1; });
  tournament.entrants = sorted;

  // Build variable-size bracket
  const bracketSize = nextPowerOfTwo(entrantCount);
  const totalRounds = Math.log2(bracketSize);
  const byeCount = bracketSize - entrantCount;

  // Generate bracket matches
  const matches: BracketMatch[] = [];
  let matchIndex = 0;

  // First round: pair seeded players. Top seeds get byes.
  // Byes go to the highest-seeded players (seed 1, 2, ..., byeCount).
  const firstRoundMatchCount = bracketSize / 2;
  const firstRoundPairs: { p1Seed: number; p2Seed: number }[] = [];

  // Standard bracket pairing: seed 1 vs seed N, seed 2 vs N-1, etc.
  for (let i = 0; i < firstRoundMatchCount; i++) {
    firstRoundPairs.push({
      p1Seed: i + 1,
      p2Seed: bracketSize - i,
    });
  }

  const roundNumber = 1;
  const roundLabel = _getRoundLabel(roundNumber, totalRounds);

  for (const pair of firstRoundPairs) {
    const p1 = sorted[pair.p1Seed - 1] || null;
    const p2 = sorted[pair.p2Seed - 1] || null;

    const isBye = !p2; // If p2Seed > entrantCount, it's a bye

    matches.push({
      matchIndex,
      round: roundLabel,
      roundNumber,
      player1Id: p1?.userId || null,
      player1Username: p1?.username || null,
      player2Id: p2?.userId || null,
      player2Username: p2?.username || null,
      winnerId: isBye ? p1?.userId || null : null,
      winnerUsername: isBye ? p1?.username || null : null,
      roomId: null,
      replayId: null,
      status: isBye ? "bye" : "pending",
      noShowDeadline: null,
    });
    matchIndex++;
  }

  // Create placeholder matches for subsequent rounds
  let prevRoundStart = 0;
  let prevRoundCount = firstRoundMatchCount;

  for (let r = 2; r <= totalRounds; r++) {
    const thisRoundCount = prevRoundCount / 2;
    const thisRoundLabel = _getRoundLabel(r, totalRounds);

    for (let i = 0; i < thisRoundCount; i++) {
      matches.push({
        matchIndex,
        round: thisRoundLabel,
        roundNumber: r,
        player1Id: null,
        player1Username: null,
        player2Id: null,
        player2Username: null,
        winnerId: null,
        winnerUsername: null,
        roomId: null,
        replayId: null,
        status: "pending",
        noShowDeadline: null,
      });
      matchIndex++;
    }

    prevRoundStart += prevRoundCount;
    prevRoundCount = thisRoundCount;
  }

  tournament.bracket = { matches };
  tournament.status = "in_progress";
  tournament.startedAt = Date.now();
  tournament.currentRound = 1;
  tournament.totalRounds = totalRounds;

  // Auto-advance bye winners into round 2
  _advanceByeWinners(tournament);

  // Set no-show deadlines for round 1 non-bye matches
  _setNoShowDeadlines(tournament, 1);

  _persistTournament(tournament);
}

// ─── Bracket helpers ────────────────────────────────────────────────────

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function _getRoundLabel(roundNumber: number, totalRounds: number): string {
  const roundsFromEnd = totalRounds - roundNumber;
  if (roundsFromEnd === 0) return "final";
  if (roundsFromEnd === 1) return "semifinal";
  if (roundsFromEnd === 2) return "quarterfinal";
  return `round_${roundNumber}`;
}

function _setNoShowDeadlines(tournament: Tournament, roundNumber: number): void {
  if (!tournament.bracket) return;
  const now = Date.now();
  for (const match of tournament.bracket.matches) {
    if (match.roundNumber === roundNumber && match.status === "pending" && match.player1Id && match.player2Id) {
      match.noShowDeadline = now + NO_SHOW_TIMEOUT_MS;
    }
  }
}

/** After byes are processed, advance bye winners to their next-round slots. */
function _advanceByeWinners(tournament: Tournament): void {
  if (!tournament.bracket) return;

  const firstRoundSize = _getFirstRoundSize(tournament);
  const firstRoundMatches = tournament.bracket.matches.slice(0, firstRoundSize);

  for (let i = 0; i < firstRoundMatches.length; i++) {
    const match = firstRoundMatches[i];
    if (match.status === "bye" && match.winnerId) {
      // Find the next-round match this winner feeds into
      const nextMatchIdx = _getNextMatchIndex(i, firstRoundSize, tournament.bracket.matches.length);
      if (nextMatchIdx !== null && nextMatchIdx < tournament.bracket.matches.length) {
        const nextMatch = tournament.bracket.matches[nextMatchIdx];
        // First-round match at index i: if i is even, winner goes to player1; if odd, to player2
        if (i % 2 === 0) {
          nextMatch.player1Id = match.winnerId;
          nextMatch.player1Username = match.winnerUsername;
        } else {
          nextMatch.player2Id = match.winnerId;
          nextMatch.player2Username = match.winnerUsername;
        }
      }
    }
  }
}

function _getFirstRoundSize(tournament: Tournament): number {
  if (!tournament.bracket) return 0;
  const totalRounds = tournament.totalRounds || 1;
  const bracketSize = Math.pow(2, totalRounds);
  return bracketSize / 2;
}

/**
 * Given a match index in the current round, find the match index in the next round.
 * Standard single-elimination: match i in round feeds into match floor(i/2) of next round offset.
 */
function _getNextMatchIndex(matchIdxInRound: number, currentRoundSize: number, _totalMatches: number): number | null {
  // Next round starts at the end of all matches up to and including current round
  // For first round: offset = firstRoundSize, next round size = firstRoundSize/2
  // Match i feeds into nextRoundStart + floor(i/2)
  const nextRoundIdx = currentRoundSize + Math.floor(matchIdxInRound / 2);
  return nextRoundIdx;
}

// ─── Register a room ↔ tournament match ─────────────────────────────────

export function registerTournamentRoom(roomId: string, tournamentId: string, matchIndex: number): void {
  roomToTournament.set(roomId, { tournamentId, matchIndex });
  const tournament = tournaments.get(tournamentId);
  if (tournament?.bracket) {
    tournament.bracket.matches[matchIndex].roomId = roomId;
    tournament.bracket.matches[matchIndex].status = "in_progress";
    // Clear no-show deadline since match started
    tournament.bracket.matches[matchIndex].noShowDeadline = null;
    _persistTournament(tournament);
  }
}

// ─── Get tournament for a room ──────────────────────────────────────────

export function getTournamentForRoom(roomId: string): { tournamentId: string; matchIndex: number } | undefined {
  return roomToTournament.get(roomId);
}

// ─── Advance Bracket (called when a tournament match completes) ─────────

export interface AdvanceResult {
  tournamentCompleted: boolean;
  nextMatch?: BracketMatch;
  tournament: Tournament;
  /** Matches ready to play in the next round (if round just completed) */
  readyMatches?: BracketMatch[];
}

export function advanceBracket(
  roomId: string,
  winnerId: string,
  winnerUsername: string,
  loserId: string,
  replayId?: string
): AdvanceResult | null {
  const mapping = roomToTournament.get(roomId);
  if (!mapping) return null;

  const tournament = tournaments.get(mapping.tournamentId);
  if (!tournament || !tournament.bracket) return null;

  const match = tournament.bracket.matches[mapping.matchIndex];
  match.winnerId = winnerId;
  match.winnerUsername = winnerUsername;
  match.status = "completed";
  match.noShowDeadline = null;
  if (replayId) match.replayId = replayId;

  // Mark loser as eliminated
  const loser = tournament.entrants.find(e => e.userId === loserId);
  if (loser) loser.eliminated = true;

  // Clean up room mapping
  roomToTournament.delete(roomId);

  // --- SNG bracket logic (backward compat) ---
  if (tournament.format === "sit_and_go_4") {
    return _advanceSNGBracket(tournament, match, mapping.matchIndex, winnerId, winnerUsername, loserId);
  }

  // --- Scheduled bracket logic ---
  return _advanceScheduledBracket(tournament, match, mapping.matchIndex, winnerId, winnerUsername);
}

function _advanceSNGBracket(
  tournament: Tournament,
  match: BracketMatch,
  matchIndex: number,
  winnerId: string,
  winnerUsername: string,
  loserId: string,
): AdvanceResult {
  // If this was a semifinal, check if we can populate the final
  if (match.round === "semifinal") {
    const final = tournament.bracket!.matches[2];
    const sf1 = tournament.bracket!.matches[0];
    const sf2 = tournament.bracket!.matches[1];

    if (matchIndex === 0 && sf1.winnerId) {
      final.player1Id = sf1.winnerId;
      final.player1Username = sf1.winnerUsername;
    }
    if (matchIndex === 1 && sf2.winnerId) {
      final.player2Id = sf2.winnerId;
      final.player2Username = sf2.winnerUsername;
    }

    // If both semis are done, the final is ready
    if (sf1.status === "completed" && sf2.status === "completed") {
      tournament.currentRound = 2;
      // Set no-show deadline for final
      final.noShowDeadline = Date.now() + NO_SHOW_TIMEOUT_MS;
      _persistTournament(tournament);
      return {
        tournamentCompleted: false,
        nextMatch: final,
        tournament,
      };
    }

    _persistTournament(tournament);
    return { tournamentCompleted: false, tournament };
  }

  // This was the final — tournament is complete!
  if (match.round === "final") {
    _completeTournament(tournament, winnerId, winnerUsername, loserId);
    _persistTournament(tournament);
    return { tournamentCompleted: true, tournament };
  }

  _persistTournament(tournament);
  return { tournamentCompleted: false, tournament };
}

function _advanceScheduledBracket(
  tournament: Tournament,
  match: BracketMatch,
  _matchIndex: number,
  winnerId: string,
  winnerUsername: string,
): AdvanceResult {
  const bracket = tournament.bracket!;
  const totalRounds = tournament.totalRounds!;

  // Find the next-round match this winner feeds into
  const currentRoundMatches = bracket.matches.filter(m => m.roundNumber === match.roundNumber);
  const indexInRound = currentRoundMatches.indexOf(match);
  const currentRoundSize = currentRoundMatches.length;

  // Calculate the absolute index of the next match
  let matchesBefore = 0;
  for (let r = 1; r < match.roundNumber; r++) {
    matchesBefore += bracket.matches.filter(m => m.roundNumber === r).length;
  }
  const nextRoundStart = matchesBefore + currentRoundSize;
  const nextMatchAbsIdx = nextRoundStart + Math.floor(indexInRound / 2);

  if (match.roundNumber < totalRounds && nextMatchAbsIdx < bracket.matches.length) {
    const nextMatch = bracket.matches[nextMatchAbsIdx];
    if (indexInRound % 2 === 0) {
      nextMatch.player1Id = winnerId;
      nextMatch.player1Username = winnerUsername;
    } else {
      nextMatch.player2Id = winnerId;
      nextMatch.player2Username = winnerUsername;
    }
  }

  // Check if the current round is now complete
  const allRoundComplete = currentRoundMatches.every(
    m => m.status === "completed" || m.status === "bye"
  );

  if (allRoundComplete && match.roundNumber < totalRounds) {
    // Advance to next round
    tournament.currentRound = match.roundNumber + 1;

    // Set no-show deadlines for next round
    _setNoShowDeadlines(tournament, match.roundNumber + 1);

    const nextRoundMatches = bracket.matches.filter(m => m.roundNumber === match.roundNumber + 1);
    const readyMatches = nextRoundMatches.filter(m => m.status === "pending" && m.player1Id && m.player2Id);

    _persistTournament(tournament);

    return {
      tournamentCompleted: false,
      readyMatches,
      tournament,
    };
  }

  // Check if this was the final match
  if (match.round === "final") {
    const loserId = match.player1Id === winnerId ? match.player2Id! : match.player1Id!;
    _completeTournament(tournament, winnerId, winnerUsername, loserId);
    _persistTournament(tournament);
    return { tournamentCompleted: true, tournament };
  }

  _persistTournament(tournament);
  return { tournamentCompleted: false, tournament };
}

function _completeTournament(tournament: Tournament, winnerId: string, winnerUsername: string, loserId: string): void {
  tournament.winnerId = winnerId;
  tournament.winnerUsername = winnerUsername;
  tournament.status = "completed";
  tournament.completedAt = Date.now();

  // Pay out winner and collect rake
  if (tournament.entryFee > 0) {
    mutateBalance(
      winnerId,
      tournament.currency,
      tournament.prizePool,
      "prize_payout",
      tournament.id,
      `Tournament winner: ${tournament.name} (net of ${tournament.rakeAmount} rake)`
    );

    if (tournament.rakeAmount > 0) {
      recordRake(
        tournament.currency,
        tournament.rakeAmount,
        tournament.id, // use tournament ID as room reference
        `tournament_${tournament.entryFee}`,
        winnerId,
        loserId,
        `Tournament rake: ${tournament.name} (${(tournament.rakePercent * 100).toFixed(0)}% of ${tournament.totalPool})`
      );
    }
  }

  // Live achievement triggers for all tournament participants (fire-and-forget)
  for (const entrant of tournament.entrants) {
    try {
      triggerLiveAchievements(entrant.userId, "tournament_completion");
    } catch (err) {
      console.error(`[tournament] Achievement trigger failed for ${entrant.userId}:`, err);
    }
  }
}

// ─── No-Show Resolution ─────────────────────────────────────────────────

/**
 * Check all in-progress tournaments for matches past their no-show deadline.
 * Returns the list of matches that were resolved by no-show forfeit.
 */
export function resolveNoShows(): BracketMatch[] {
  const resolved: BracketMatch[] = [];
  const now = Date.now();

  for (const tournament of tournaments.values()) {
    if (tournament.status !== "in_progress" || !tournament.bracket) continue;

    for (const match of tournament.bracket.matches) {
      if (match.status !== "pending" || !match.noShowDeadline) continue;
      if (now < match.noShowDeadline) continue;

      // Match timed out — need to resolve
      // If neither player has joined (room not created), resolve as:
      // - If only one player exists, they advance
      // - If both exist but neither started, the higher seed advances
      // For simplicity: the player in player1 slot advances (higher seed by construction)
      if (match.player1Id && match.player2Id) {
        // Higher seed (player1) wins by default
        match.winnerId = match.player1Id;
        match.winnerUsername = match.player1Username;
        match.status = "completed";
        match.noShowDeadline = null;

        // Mark loser as eliminated
        const loser = tournament.entrants.find(e => e.userId === match.player2Id);
        if (loser) loser.eliminated = true;

        resolved.push(match);

        // Propagate winner to next round
        _propagateWinnerToNextRound(tournament, match);
      } else if (match.player1Id && !match.player2Id) {
        // Only player1 — auto-advance
        match.winnerId = match.player1Id;
        match.winnerUsername = match.player1Username;
        match.status = "completed";
        match.noShowDeadline = null;
        resolved.push(match);
        _propagateWinnerToNextRound(tournament, match);
      }

      // Check if whole round is now complete
      _checkRoundCompletion(tournament, match.roundNumber);
    }

    _persistTournament(tournament);
  }

  return resolved;
}

function _propagateWinnerToNextRound(tournament: Tournament, match: BracketMatch): void {
  if (!tournament.bracket || !match.winnerId) return;

  const totalRounds = tournament.totalRounds!;
  if (match.roundNumber >= totalRounds) {
    // This was the final — complete the tournament
    const loserId = match.player1Id === match.winnerId ? match.player2Id : match.player1Id;
    _completeTournament(tournament, match.winnerId, match.winnerUsername!, loserId || "");
    return;
  }

  const currentRoundMatches = tournament.bracket.matches.filter(m => m.roundNumber === match.roundNumber);
  const indexInRound = currentRoundMatches.indexOf(match);
  const currentRoundSize = currentRoundMatches.length;

  let matchesBefore = 0;
  for (let r = 1; r < match.roundNumber; r++) {
    matchesBefore += tournament.bracket.matches.filter(m => m.roundNumber === r).length;
  }
  const nextRoundStart = matchesBefore + currentRoundSize;
  const nextMatchAbsIdx = nextRoundStart + Math.floor(indexInRound / 2);

  if (nextMatchAbsIdx < tournament.bracket.matches.length) {
    const nextMatch = tournament.bracket.matches[nextMatchAbsIdx];
    if (indexInRound % 2 === 0) {
      nextMatch.player1Id = match.winnerId;
      nextMatch.player1Username = match.winnerUsername;
    } else {
      nextMatch.player2Id = match.winnerId;
      nextMatch.player2Username = match.winnerUsername;
    }
  }
}

function _checkRoundCompletion(tournament: Tournament, roundNumber: number): void {
  if (!tournament.bracket) return;

  const roundMatches = tournament.bracket.matches.filter(m => m.roundNumber === roundNumber);
  const allComplete = roundMatches.every(m => m.status === "completed" || m.status === "bye");

  if (allComplete && tournament.totalRounds && roundNumber < tournament.totalRounds) {
    tournament.currentRound = roundNumber + 1;
    _setNoShowDeadlines(tournament, roundNumber + 1);
  }
}

// ─── Scheduled Tournament Auto-Start Timer ──────────────────────────────

/**
 * Check all tournaments for scheduled start times that have passed.
 * Automatically locks registration and starts the tournament.
 */
export function checkScheduledStarts(): Tournament[] {
  const started: Tournament[] = [];
  const now = Date.now();

  for (const tournament of tournaments.values()) {
    if (tournament.format !== "scheduled") continue;
    if (tournament.status !== "registration_open") continue;
    if (!tournament.scheduledStartTime) continue;
    if (now < tournament.scheduledStartTime) continue;

    // Time to start
    if (tournament.entrants.length < tournament.minEntrants) {
      // Insufficient field — cancel
      cancelTournament(tournament.id);
    } else {
      // Lookup ratings for seeding
      _fetchRatingsForEntrants(tournament);

      tournament.status = "registration_closed";
      _startScheduledTournament(tournament);
      started.push(tournament);
    }
  }

  return started;
}

function _fetchRatingsForEntrants(tournament: Tournament): void {
  try {
    for (const entrant of tournament.entrants) {
      const row = db.prepare("SELECT rating FROM users WHERE id = ?").get(entrant.userId) as { rating: number } | undefined;
      entrant.rating = row?.rating ?? 1200;
    }
  } catch {
    // If DB lookup fails, default ratings already set
  }
}

// Start background timer for scheduled starts and no-show resolution
const _scheduledCheckInterval = setInterval(() => {
  checkScheduledStarts();
  resolveNoShows();
}, SCHEDULED_CHECK_INTERVAL);
_scheduledCheckInterval.unref();

// ─── Query ──────────────────────────────────────────────────────────────

export function getTournament(id: string): Tournament | undefined {
  return tournaments.get(id);
}

export function listTournaments(status?: TournamentStatus): Tournament[] {
  const all = Array.from(tournaments.values());
  if (status) return all.filter(t => t.status === status);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export function getPlayerTournaments(userId: string): Tournament[] {
  return Array.from(tournaments.values())
    .filter(t => t.entrants.some(e => e.userId === userId))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** List upcoming scheduled tournaments (registration is open, sorted by start time) */
export function listUpcomingTournaments(): Tournament[] {
  return Array.from(tournaments.values())
    .filter(t => t.format === "scheduled" && (t.status === "registration_open" || t.status === "registration_closed"))
    .sort((a, b) => (a.scheduledStartTime || 0) - (b.scheduledStartTime || 0));
}

// ─── Persistence ────────────────────────────────────────────────────────

function _persistTournament(tournament: Tournament): void {
  try {
    db.prepare(`
      INSERT INTO tournaments (id, name, format, status, entry_fee, currency, rake_percent,
        total_pool, rake_amount, prize_pool, entrants_json, bracket_json,
        winner_id, winner_username, created_at, started_at, completed_at,
        scheduled_start_time, max_entrants, min_entrants, admin_created,
        current_round, total_rounds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        total_pool = excluded.total_pool,
        rake_amount = excluded.rake_amount,
        prize_pool = excluded.prize_pool,
        entrants_json = excluded.entrants_json,
        bracket_json = excluded.bracket_json,
        winner_id = excluded.winner_id,
        winner_username = excluded.winner_username,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        current_round = excluded.current_round,
        total_rounds = excluded.total_rounds
    `).run(
      tournament.id,
      tournament.name,
      tournament.format,
      tournament.status,
      tournament.entryFee,
      tournament.currency,
      tournament.rakePercent,
      tournament.totalPool,
      tournament.rakeAmount,
      tournament.prizePool,
      JSON.stringify(tournament.entrants),
      tournament.bracket ? JSON.stringify(tournament.bracket) : null,
      tournament.winnerId,
      tournament.winnerUsername,
      tournament.createdAt,
      tournament.startedAt,
      tournament.completedAt,
      tournament.scheduledStartTime,
      tournament.maxEntrants,
      tournament.minEntrants,
      tournament.adminCreated ? 1 : 0,
      tournament.currentRound,
      tournament.totalRounds,
    );
  } catch {
    // Silently handle — in-memory is the source of truth
  }
}

/** Load tournaments from SQLite on startup */
export function loadTournamentsFromDB(): void {
  try {
    const rows = db.prepare(`SELECT * FROM tournaments ORDER BY created_at DESC LIMIT 200`).all() as any[];
    for (const row of rows) {
      const tournament: Tournament = {
        id: row.id,
        name: row.name,
        format: row.format || "sit_and_go_4",
        status: row.status,
        entryFee: row.entry_fee,
        currency: row.currency,
        rakePercent: row.rake_percent,
        totalPool: row.total_pool,
        rakeAmount: row.rake_amount,
        prizePool: row.prize_pool,
        entrants: JSON.parse(row.entrants_json || "[]"),
        bracket: row.bracket_json ? JSON.parse(row.bracket_json) : null,
        winnerId: row.winner_id,
        winnerUsername: row.winner_username,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        scheduledStartTime: row.scheduled_start_time || null,
        maxEntrants: row.max_entrants || 4,
        minEntrants: row.min_entrants || (row.format === "scheduled" ? 2 : 4),
        adminCreated: !!row.admin_created,
        currentRound: row.current_round || null,
        totalRounds: row.total_rounds || null,
      };
      tournaments.set(tournament.id, tournament);

      // Rebuild room mappings for in-progress tournaments
      if (tournament.bracket && tournament.status === "in_progress") {
        for (const match of tournament.bracket.matches) {
          if (match.roomId && match.status === "in_progress") {
            roomToTournament.set(match.roomId, {
              tournamentId: tournament.id,
              matchIndex: match.matchIndex,
            });
          }
        }
      }
    }
  } catch {
    // Table may not exist yet — handled by initializeDatabase
  }
}

// ─── Get pending matches for a player ───────────────────────────────────

export function getPendingTournamentMatch(userId: string): { tournament: Tournament; match: BracketMatch } | null {
  for (const tournament of tournaments.values()) {
    if (tournament.status !== "in_progress" || !tournament.bracket) continue;
    for (const match of tournament.bracket.matches) {
      if (match.status !== "pending") continue;
      if (match.player1Id === userId || match.player2Id === userId) {
        // Check if both players are assigned (for later rounds)
        if (match.player1Id && match.player2Id) {
          return { tournament, match };
        }
      }
    }
  }
  return null;
}

// ─── Check if all matches in a round are completed ──────────────────────

export function isRoundComplete(tournamentId: string, roundNumber: number): boolean {
  const tournament = tournaments.get(tournamentId);
  if (!tournament?.bracket) return false;
  const roundMatches = tournament.bracket.matches.filter(m => m.roundNumber === roundNumber);
  return roundMatches.every(m => m.status === "completed" || m.status === "bye");
}

// ─── Test Utilities ─────────────────────────────────────────────────────

export function _clearTournaments(): void {
  tournaments.clear();
  roomToTournament.clear();
}

export function _getTournaments(): Map<string, Tournament> {
  return tournaments;
}

export function _getRoomToTournament(): Map<string, { tournamentId: string; matchIndex: number }> {
  return roomToTournament;
}
