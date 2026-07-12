/**
 * Client for Sprint-2 Expert-tier ApexMCTS service.
 * Falls back to null when the service is unavailable so callers use local Club Apex.
 */

import type { Card } from "./engine";

export type AiTier = "club" | "expert";

export interface ApexServiceEvent {
  type: "opp_drew_discard" | "opp_drew_stock" | "opp_discard" | "set_discard";
  card?: Card;
}

export interface DrawDecisionRequest {
  hand: Card[];
  topDiscard: Card | undefined;
  discardPile: Card[];
  turn: number;
  stockRemaining: number;
  myScore: number;
  oppScore: number;
  events?: ApexServiceEvent[];
}

export interface DiscardDecisionRequest {
  hand: Card[];
  drewFromDiscard: boolean;
  drawnCard: Card | null;
  discardPile: Card[];
  turn: number;
  stockRemaining: number;
  myScore: number;
  oppScore: number;
  events?: ApexServiceEvent[];
}

export interface KnockDecisionRequest {
  hand: Card[];
  discardPile: Card[];
  turn: number;
  stockRemaining: number;
  myScore: number;
  oppScore: number;
  events?: ApexServiceEvent[];
}

export interface ExpertDrawResult {
  source: "stock" | "discard";
  disagreement?: boolean;
  overridden?: boolean;
  apexHeuristicSource?: "stock" | "discard";
  takeEv?: number;
  stockEv?: number;
  elapsedMs?: number;
  engine?: string;
}

export interface ExpertDiscardResult {
  discardIndex: number;
  elapsedMs?: number;
  engine?: string;
}

export interface ExpertKnockResult {
  knock: boolean;
  elapsedMs?: number;
  engine?: string;
}

async function postDecide(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2800);
    const res = await fetch("/api/ai/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.success || !json.decision) return null;
    return json.decision as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function checkExpertAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/ai/health");
    if (!res.ok) return false;
    const json = await res.json();
    return Boolean(json?.ok);
  } catch {
    return false;
  }
}

export async function expertDecideDraw(
  req: DrawDecisionRequest
): Promise<ExpertDrawResult | null> {
  const decision = await postDecide({
    action: "draw",
    hand: req.hand,
    top_discard: req.topDiscard ?? null,
    discard_pile: req.discardPile,
    turn: req.turn,
    stock_remaining: req.stockRemaining,
    my_score: req.myScore,
    opp_score: req.oppScore,
    events: req.events,
    num_worlds: 30,
    rollout_depth: 2,
    use_weighted_worlds: true,
  });
  if (!decision) return null;
  const source = decision.source === "discard" ? "discard" : "stock";
  return {
    source,
    disagreement: Boolean(decision.disagreement),
    overridden: Boolean(decision.overridden),
    apexHeuristicSource:
      decision.apex_heuristic_source === "discard" ? "discard" : "stock",
    takeEv: typeof decision.take_ev === "number" ? decision.take_ev : undefined,
    stockEv: typeof decision.stock_ev === "number" ? decision.stock_ev : undefined,
    elapsedMs: typeof decision.elapsed_ms === "number" ? decision.elapsed_ms : undefined,
    engine: typeof decision.engine === "string" ? decision.engine : undefined,
  };
}

export async function expertDecideDiscard(
  req: DiscardDecisionRequest
): Promise<ExpertDiscardResult | null> {
  const decision = await postDecide({
    action: "discard",
    hand: req.hand,
    drew_from_discard: req.drewFromDiscard,
    drawn_card: req.drawnCard,
    discard_pile: req.discardPile,
    turn: req.turn,
    stock_remaining: req.stockRemaining,
    my_score: req.myScore,
    opp_score: req.oppScore,
    events: req.events,
  });
  if (!decision) return null;
  const idx = decision.discard_index;
  if (typeof idx !== "number" || idx < 0 || idx >= req.hand.length) return null;
  return {
    discardIndex: idx,
    elapsedMs: typeof decision.elapsed_ms === "number" ? decision.elapsed_ms : undefined,
    engine: typeof decision.engine === "string" ? decision.engine : undefined,
  };
}

export async function expertDecideKnock(
  req: KnockDecisionRequest
): Promise<ExpertKnockResult | null> {
  const decision = await postDecide({
    action: "knock",
    hand: req.hand,
    discard_pile: req.discardPile,
    turn: req.turn,
    stock_remaining: req.stockRemaining,
    my_score: req.myScore,
    opp_score: req.oppScore,
    events: req.events,
  });
  if (!decision) return null;
  if (typeof decision.knock !== "boolean") return null;
  return {
    knock: decision.knock,
    elapsedMs: typeof decision.elapsed_ms === "number" ? decision.elapsed_ms : undefined,
    engine: typeof decision.engine === "string" ? decision.engine : undefined,
  };
}

/** In-memory ring buffer of Apex vs search disagreements for CSB seeding. */
const disagreementLog: Array<Record<string, unknown>> = [];
const MAX_LOG = 200;

export function logDrawDisagreement(entry: Record<string, unknown>): void {
  disagreementLog.push({ ...entry, ts: Date.now() });
  if (disagreementLog.length > MAX_LOG) disagreementLog.shift();
}

export function getDrawDisagreementLog(): Array<Record<string, unknown>> {
  return [...disagreementLog];
}
