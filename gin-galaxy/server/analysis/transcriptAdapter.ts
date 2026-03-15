/**
 * Transcript-to-Prompt Adapter.
 *
 * Converts a stored replay transcript into a structured, readable prompt
 * suitable for AI analysis. The adapter is deterministic and future-proof,
 * producing a consistent format regardless of transcript length.
 *
 * Design principles:
 *  - Structured sections for easy parsing
 *  - Deterministic output (no randomness)
 *  - Extensible for future features (blunder tagging, per-turn annotations)
 *  - Honest about what can and cannot be inferred from transcript data
 */

export interface TranscriptAction {
  seq: number;
  timestamp: number;
  type: string;
  playerId?: string;
  playerUsername?: string;
  detail?: Record<string, unknown>;
}

export interface ReplayData {
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
  actions: TranscriptAction[];
}

export interface AnalysisInput {
  /** The requesting player's userId */
  requestingPlayerId: string;
  /** The requesting player's username */
  requestingPlayerUsername: string;
  /** Structured summary for the AI prompt */
  prompt: string;
  /** Metadata for the response payload */
  meta: {
    replayId: string;
    totalActions: number;
    totalRounds: number;
    durationMs: number;
    endReason: string | null;
  };
}

// ── Round Extraction ─────────────────────────────────────────────────

interface RoundSummary {
  roundNumber: number;
  actions: TranscriptAction[];
  winner?: string;
  outcomeType?: string;
  points?: number;
  knockerDeadwood?: number;
  opponentDeadwood?: number;
}

function extractRounds(actions: TranscriptAction[]): RoundSummary[] {
  const rounds: RoundSummary[] = [];
  let current: TranscriptAction[] = [];
  let currentRound = 0;

  for (const a of actions) {
    if (a.type === "round_start") {
      if (current.length > 0) {
        rounds.push(buildRoundSummary(currentRound, current));
      }
      currentRound = (a.detail?.roundNumber as number) || currentRound + 1;
      current = [a];
    } else {
      current.push(a);
    }
  }
  if (current.length > 0) {
    rounds.push(buildRoundSummary(currentRound || 1, current));
  }
  return rounds;
}

function buildRoundSummary(roundNumber: number, actions: TranscriptAction[]): RoundSummary {
  const summary: RoundSummary = { roundNumber, actions };

  // Find knock/gin/undercut outcome
  const endAction = actions.find(a =>
    a.type === "knock" || a.type === "gin" || a.type === "undercut"
  );
  if (endAction?.detail) {
    summary.outcomeType = endAction.type;
    summary.winner = endAction.detail.winnerUsername as string;
    summary.points = endAction.detail.points as number;
    summary.knockerDeadwood = endAction.detail.knockerDeadwood as number;
    summary.opponentDeadwood = endAction.detail.opponentDeadwood as number;
  }

  // Fallback from round_end
  const roundEnd = actions.find(a => a.type === "round_end");
  if (roundEnd?.playerUsername && !summary.winner) {
    summary.winner = roundEnd.playerUsername;
    summary.outcomeType = roundEnd.detail?.outcomeType as string;
    summary.points = roundEnd.detail?.points as number;
  }

  return summary;
}

// ── Player Action Stats ──────────────────────────────────────────────

interface PlayerStats {
  username: string;
  draws: { stock: number; discard: number };
  discards: number;
  knocks: number;
  gins: number;
  roundsWon: number;
  timeouts: number;
}

function computePlayerStats(actions: TranscriptAction[], players: { userId: string; username: string }[]): Map<string, PlayerStats> {
  const stats = new Map<string, PlayerStats>();

  for (const p of players) {
    stats.set(p.userId, {
      username: p.username,
      draws: { stock: 0, discard: 0 },
      discards: 0,
      knocks: 0,
      gins: 0,
      roundsWon: 0,
      timeouts: 0,
    });
  }

  for (const a of actions) {
    if (!a.playerId) continue;
    const s = stats.get(a.playerId);
    if (!s) continue;

    switch (a.type) {
      case "draw":
        if (a.detail?.source === "stock") s.draws.stock++;
        else if (a.detail?.source === "discard") s.draws.discard++;
        break;
      case "discard":
        s.discards++;
        break;
      case "knock":
        s.knocks++;
        if (a.detail?.winnerId === a.playerId) s.roundsWon++;
        break;
      case "gin":
        s.gins++;
        s.roundsWon++;
        break;
      case "undercut":
        // The winner of an undercut is the opponent, not the knocker
        if (a.detail?.winnerId === a.playerId) s.roundsWon++;
        break;
      case "round_end":
        // Already counted via knock/gin/undercut
        break;
      case "timeout":
        s.timeouts++;
        break;
    }
  }

  return stats;
}

// ── Prompt Builder ───────────────────────────────────────────────────

/**
 * Build a structured analysis input from a replay and requesting player.
 */
export function buildAnalysisInput(
  replay: ReplayData,
  requestingPlayerId: string
): AnalysisInput {
  const requestingPlayer = replay.players.find(p => p.userId === requestingPlayerId);
  const opponent = replay.players.find(p => p.userId !== requestingPlayerId);
  const rounds = extractRounds(replay.actions);
  const playerStats = computePlayerStats(replay.actions, replay.players);

  const reqStats = playerStats.get(requestingPlayerId);
  const oppStats = opponent ? playerStats.get(opponent.userId) : undefined;
  const isWinner = replay.outcome.winnerId === requestingPlayerId;
  const durationMs = replay.endedAt - replay.startedAt;

  // Build the structured prompt
  const sections: string[] = [];

  // Section 1: Match Overview
  sections.push(`## Match Overview
- Players: ${requestingPlayer?.username || "Unknown"} (the player requesting analysis) vs ${opponent?.username || "Unknown"}
- Result: ${isWinner ? `${requestingPlayer?.username} WON` : `${requestingPlayer?.username} LOST`}
- Final Score: ${replay.outcome.winnerUsername} ${replay.outcome.winnerScore} — ${replay.outcome.loserUsername} ${replay.outcome.loserScore}
- End Reason: ${replay.outcome.endReason || "unknown"}
- Duration: ${Math.round(durationMs / 1000)} seconds
- Total Rounds: ${rounds.length}
- Total Actions: ${replay.actions.length}`);

  // Section 2: Player Statistics
  if (reqStats && oppStats) {
    sections.push(`## Player Statistics

### ${requestingPlayer?.username} (Requesting Player)
- Draws from stock: ${reqStats.draws.stock}
- Draws from discard pile: ${reqStats.draws.discard}
- Total discards: ${reqStats.discards}
- Knocks: ${reqStats.knocks}
- Gins: ${reqStats.gins}
- Rounds won: ${reqStats.roundsWon}
- Timeouts: ${reqStats.timeouts}

### ${opponent?.username} (Opponent)
- Draws from stock: ${oppStats.draws.stock}
- Draws from discard pile: ${oppStats.draws.discard}
- Total discards: ${oppStats.discards}
- Knocks: ${oppStats.knocks}
- Gins: ${oppStats.gins}
- Rounds won: ${oppStats.roundsWon}
- Timeouts: ${oppStats.timeouts}`);
  }

  // Section 3: Round-by-Round Breakdown
  const roundDetails = rounds.map(r => {
    const drawsInRound = r.actions.filter(a => a.type === "draw");
    const discardsInRound = r.actions.filter(a => a.type === "discard");
    const turnsInRound = Math.ceil(drawsInRound.length / 1); // Each draw = 1 half-turn

    let outcome = "in progress";
    if (r.outcomeType === "gin") {
      outcome = `${r.winner || "?"} achieved GIN for ${r.points ?? "?"} points`;
    } else if (r.outcomeType === "knock") {
      outcome = `${r.winner || "?"} knocked — deadwood ${r.knockerDeadwood ?? "?"} vs ${r.opponentDeadwood ?? "?"} — ${r.points ?? "?"} points`;
    } else if (r.outcomeType === "undercut") {
      outcome = `${r.winner || "?"} undercut — deadwood ${r.knockerDeadwood ?? "?"} vs ${r.opponentDeadwood ?? "?"} — ${r.points ?? "?"} points`;
    }

    // Key decision moments to highlight
    const discardPickups = r.actions.filter(
      a => a.type === "draw" && a.detail?.source === "discard"
    );
    const discardPickupLines = discardPickups.map(a =>
      `  - Turn #${a.seq}: ${a.playerUsername} drew ${a.detail?.card || "a card"} from discard pile`
    ).join("\n");

    let lines = `### Round ${r.roundNumber}
- Actions in round: ${r.actions.length}
- Turns (draws): ${drawsInRound.length}
- Outcome: ${outcome}`;

    if (discardPickupLines) {
      lines += `\n- Notable discard-pile pickups:\n${discardPickupLines}`;
    }

    return lines;
  });

  sections.push(`## Round-by-Round Summary\n\n${roundDetails.join("\n\n")}`);

  // Section 4: Key Moments Timeline
  const keyMoments = replay.actions.filter(a =>
    ["knock", "gin", "undercut", "timeout", "forfeit", "disconnect"].includes(a.type)
  );
  if (keyMoments.length > 0) {
    const momentLines = keyMoments.map(a => {
      switch (a.type) {
        case "knock":
          return `- Turn #${a.seq}: ${a.playerUsername} knocked (deadwood: ${a.detail?.knockerDeadwood ?? "?"} vs ${a.detail?.opponentDeadwood ?? "?"})`;
        case "gin":
          return `- Turn #${a.seq}: ${a.playerUsername} achieved GIN (${a.detail?.points ?? "?"} points)`;
        case "undercut":
          return `- Turn #${a.seq}: ${a.detail?.winnerUsername ?? a.playerUsername} undercut (${a.detail?.points ?? "?"} points)`;
        case "timeout":
          return `- Turn #${a.seq}: ${a.playerUsername} timed out`;
        case "forfeit":
          return `- Turn #${a.seq}: ${a.playerUsername} forfeited (${a.detail?.reason || "left"})`;
        case "disconnect":
          return `- Turn #${a.seq}: ${a.playerUsername} disconnected`;
        default:
          return `- Turn #${a.seq}: ${a.type}`;
      }
    });
    sections.push(`## Key Moments\n\n${momentLines.join("\n")}`);
  }

  // Section 5: Full Turn-by-Turn Log (condensed for draws/discards)
  const turnLog = replay.actions
    .filter(a => ["draw", "discard", "knock", "gin", "undercut"].includes(a.type))
    .map(a => {
      switch (a.type) {
        case "draw":
          return `#${a.seq} ${a.playerUsername}: drew from ${a.detail?.source}${a.detail?.card ? ` (${a.detail.card})` : ""}`;
        case "discard":
          return `#${a.seq} ${a.playerUsername}: discarded ${a.detail?.card || "?"}`;
        case "knock":
          return `#${a.seq} ${a.playerUsername}: KNOCKED (DW ${a.detail?.knockerDeadwood} vs ${a.detail?.opponentDeadwood}) → ${a.detail?.winnerUsername} +${a.detail?.points}`;
        case "gin":
          return `#${a.seq} ${a.playerUsername}: GIN → +${a.detail?.points}`;
        case "undercut":
          return `#${a.seq} ${a.playerUsername}: UNDERCUT → ${a.detail?.winnerUsername} +${a.detail?.points}`;
        default:
          return `#${a.seq} ${a.type}`;
      }
    });

  sections.push(`## Complete Turn Log\n\n${turnLog.join("\n")}`);

  // Assemble the full prompt
  const transcriptData = sections.join("\n\n");

  const prompt = `You are an expert Gin Rummy coach analyzing a specific match replay for a player.
The player "${requestingPlayer?.username}" is requesting feedback on this match.

Analyze the following detailed match transcript and provide actionable, turn-specific coaching.

${transcriptData}

## Instructions for Analysis

Provide a thorough post-game analysis in Markdown format. Include:

1. **Match Summary**: Brief overview of what happened and the final result.

2. **Key Decision Analysis**: Identify 2-4 specific moments in the match where the requesting player made notable decisions (good or bad). Reference specific turn numbers (e.g., "At turn #12..."). Focus on:
   - Draw source choices (stock vs discard pile) — were they optimal?
   - Discard selections — did they give away useful cards?
   - Knock timing — did they knock at the right time or wait too long?

3. **Strategic Patterns**: Identify broader patterns in the requesting player's strategy:
   - Draw behavior (stock vs discard pile ratio and what it suggests)
   - Offensive vs defensive tendencies
   - Pace of play (aggressive knocker vs patient builder?)

4. **Opponent Read**: What can we infer about the opponent's strategy from the transcript? Any exploitable patterns?

5. **Actionable Tips**: 2-3 specific, actionable Gin Rummy strategy tips tailored to what this match reveals about the player's tendencies.

Important notes:
- Focus your analysis on the requesting player ("${requestingPlayer?.username}").
- Be honest about uncertainty — if you can only infer from the available data, say so.
- Be encouraging but genuinely helpful. Avoid empty praise.
- Reference specific turn numbers when discussing decisions.
- Keep the analysis concise but substantive (aim for 400-600 words).`;

  return {
    requestingPlayerId,
    requestingPlayerUsername: requestingPlayer?.username || "Unknown",
    prompt,
    meta: {
      replayId: replay.id,
      totalActions: replay.actions.length,
      totalRounds: rounds.length,
      durationMs,
      endReason: replay.outcome.endReason,
    },
  };
}

/**
 * Exported for testing: extract rounds from actions.
 */
export { extractRounds, computePlayerStats };
export type { RoundSummary, PlayerStats };
