#!/usr/bin/env python3
"""
Apex Sprint-2 AI decision service.

Provides draw (ApexMCTS search), discard, and knock decisions via:
  - stdio JSON (one request per process, or JSONL interactive)
  - optional HTTP server (--http)

Card format (product-compatible):
  {"rank": "A"|"2"|...|"10"|"J"|"Q"|"K", "suit": "♠"|"♥"|"♦"|"♣"}

Usage:
  python scripts/apex_ai_service.py --request request.json
  echo '{...}' | python scripts/apex_ai_service.py
  python scripts/apex_ai_service.py --http --port 8765
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESEARCH_ROOT = os.path.join(REPO_ROOT, "docs", "archive", "research")
if RESEARCH_ROOT not in sys.path:
    sys.path.insert(0, RESEARCH_ROOT)

from gin_rummy.apex import Apex  # noqa: E402
from gin_rummy.apex_mcts import ApexMCTS  # noqa: E402
from gin_rummy.card import make_card  # noqa: E402
from gin_rummy.draw_search import evaluate_draw_choice  # noqa: E402
from gin_rummy.meld import compute_deadwood, best_meld_arrangement  # noqa: E402

# Product suit symbols → research suit indices (C=0, D=1, S=2, H=3)
SUIT_TO_IDX = {"♣": 0, "♦": 1, "♠": 2, "♥": 3}
IDX_TO_SUIT = {0: "♣", 1: "♦", 2: "♠", 3: "♥"}
RANK_TO_IDX = {
    "A": 0,
    "2": 1,
    "3": 2,
    "4": 3,
    "5": 4,
    "6": 5,
    "7": 6,
    "8": 7,
    "9": 8,
    "10": 9,
    "T": 9,
    "J": 10,
    "Q": 11,
    "K": 12,
}
IDX_TO_RANK = {
    0: "A",
    1: "2",
    2: "3",
    3: "4",
    4: "5",
    5: "6",
    6: "7",
    7: "8",
    8: "9",
    9: "10",
    10: "J",
    11: "Q",
    12: "K",
}

SERVICE_VERSION = "apex_mcts_sprint2_v1"
DEFAULT_WORLDS = 30
DEFAULT_DEPTH = 2
DEFAULT_INFO_PENALTY = 1.5
DEFAULT_OVERRIDE_MARGIN = 0.5


def card_to_int(card: Dict[str, str]) -> int:
    rank = str(card["rank"]).upper()
    if rank == "10":
        rank = "10"
    suit = card["suit"]
    if rank not in RANK_TO_IDX:
        raise ValueError(f"Unknown rank: {card['rank']}")
    if suit not in SUIT_TO_IDX:
        raise ValueError(f"Unknown suit: {suit}")
    return make_card(RANK_TO_IDX[rank if rank != "10" else "10"], SUIT_TO_IDX[suit])


def int_to_card(c: int) -> Dict[str, str]:
    from gin_rummy.card import rank, suit

    return {"rank": IDX_TO_RANK[rank(c)], "suit": IDX_TO_SUIT[suit(c)]}


def cards_to_ints(cards: List[Dict[str, str]]) -> List[int]:
    return [card_to_int(c) for c in cards]


def find_discard_index(hand_product: List[Dict[str, str]], discard_int: int) -> int:
    target = int_to_card(discard_int)
    for i, c in enumerate(hand_product):
        if c["rank"] == target["rank"] and c["suit"] == target["suit"]:
            return i
    # Fallback: first card
    return 0


def _apply_model_events(bot: Apex, events: Optional[List[Dict[str, Any]]]) -> None:
    """Apply optional opponent observation events to keep belief state warm."""
    if not events:
        return
    for ev in events:
        kind = ev.get("type")
        if kind == "opp_drew_discard" and ev.get("card"):
            bot.notify_opponent_draw(True, card_to_int(ev["card"]))
        elif kind == "opp_drew_stock":
            bot.notify_opponent_draw(False, None)
        elif kind == "opp_discard" and ev.get("card"):
            bot.notify_opponent_discard(card_to_int(ev["card"]))
        elif kind == "set_discard" and ev.get("card"):
            bot.model.set_discard(card_to_int(ev["card"]))


def build_game_state(req: Dict[str, Any], hand_ints: List[int]) -> Dict[str, Any]:
    discard_pile = cards_to_ints(req.get("discard_pile") or [])
    return {
        "turn_number": int(req.get("turn", req.get("turn_number", 0))),
        "my_score": int(req.get("my_score", 0)),
        "opp_score": int(req.get("opp_score", 0)),
        "deck_remaining": int(req.get("stock_remaining", req.get("deck_remaining", 30))),
        "discard_pile": discard_pile,
    }


def decide_draw(req: Dict[str, Any]) -> Dict[str, Any]:
    hand = cards_to_ints(req["hand"])
    top = card_to_int(req["top_discard"]) if req.get("top_discard") else None
    if top is None:
        return {
            "action": "draw",
            "source": "stock",
            "engine": SERVICE_VERSION,
            "reason": "no_top_discard",
        }

    seed = req.get("seed")
    num_worlds = int(req.get("num_worlds", DEFAULT_WORLDS))
    depth = int(req.get("rollout_depth", DEFAULT_DEPTH))
    info_penalty = float(req.get("info_penalty", DEFAULT_INFO_PENALTY))
    override_margin = float(req.get("override_margin", DEFAULT_OVERRIDE_MARGIN))
    use_weighted = bool(req.get("use_weighted_worlds", True))

    bot = ApexMCTS(
        "ApexMCTS",
        seed=seed,
        num_worlds=num_worlds,
        rollout_depth=depth,
        info_penalty=info_penalty,
        override_margin=override_margin,
    )
    bot.new_hand(hand, opponent_id=1)
    _apply_model_events(bot, req.get("events"))
    for c in cards_to_ints(req.get("discard_pile") or []):
        if c not in hand:
            bot.model.set_discard(c)

    gs = build_game_state(req, hand)

    # Apex heuristic (baseline)
    apex_take = bot._apex_draw_decision(top, hand, gs)

    # Full search diagnostics (may override)
    should_take, take_ev, stock_ev, diag = evaluate_draw_choice(
        hand=hand,
        top_discard=top,
        opponent_model=bot.model,
        game_state=gs,
        num_worlds=num_worlds,
        rollout_depth=depth,
        info_penalty=info_penalty,
        rng=bot._search_rng,
        use_weighted_worlds=use_weighted,
    )

    # Joint draw→discard EV snapshot (immediate best remaining DW, no rollout)
    from gin_rummy.draw_search import _best_discard_dw

    take_immediate = _best_discard_dw(hand + [top], restricted=top)
    current_dw = compute_deadwood(hand)

    final_take = bot.draw_decision(top, hand, gs)
    source = "discard" if final_take else "stock"

    disagreed = (should_take is not None) and (not diag.get("skipped")) and (
        bool(should_take) != bool(apex_take)
    )
    overridden = disagreed and abs(diag.get("margin", 0.0)) >= override_margin

    return {
        "action": "draw",
        "source": source,
        "engine": SERVICE_VERSION,
        "apex_heuristic_source": "discard" if apex_take else "stock",
        "search_source": (
            None
            if diag.get("skipped") or should_take is None
            else ("discard" if should_take else "stock")
        ),
        "disagreement": disagreed,
        "overridden": overridden,
        "take_ev": take_ev,
        "stock_ev": stock_ev,
        "joint_immediate": {
            "current_dw": current_dw,
            "take_best_remaining_dw": take_immediate,
            "delta_if_take": current_dw - take_immediate,
        },
        "diagnostics": diag,
        "search_stats": bot.get_search_stats(),
        "params": {
            "num_worlds": num_worlds,
            "rollout_depth": depth,
            "info_penalty": info_penalty,
            "override_margin": override_margin,
            "use_weighted_worlds": use_weighted,
        },
    }


def decide_discard(req: Dict[str, Any]) -> Dict[str, Any]:
    hand_prod = req["hand"]
    hand = cards_to_ints(hand_prod)
    drew_from_discard = bool(req.get("drew_from_discard", False))
    drawn = card_to_int(req["drawn_card"]) if req.get("drawn_card") else None

    bot = Apex("Apex")
    bot.new_hand(hand, opponent_id=1)
    _apply_model_events(bot, req.get("events"))
    for c in cards_to_ints(req.get("discard_pile") or []):
        if c not in hand:
            bot.model.set_discard(c)

    gs = build_game_state(req, hand)
    discard_int = bot.discard_decision(hand, drew_from_discard, drawn, gs)
    idx = find_discard_index(hand_prod, discard_int)

    remaining = list(hand)
    if discard_int in remaining:
        remaining.remove(discard_int)
    remaining_dw = compute_deadwood(remaining)

    return {
        "action": "discard",
        "discard_index": idx,
        "discard_card": int_to_card(discard_int),
        "remaining_dw": remaining_dw,
        "engine": SERVICE_VERSION,
    }


def decide_knock(req: Dict[str, Any]) -> Dict[str, Any]:
    hand = cards_to_ints(req["hand"])
    bot = Apex("Apex")
    bot.new_hand(hand, opponent_id=1)
    _apply_model_events(bot, req.get("events"))
    for c in cards_to_ints(req.get("discard_pile") or []):
        if c not in hand:
            bot.model.set_discard(c)

    gs = build_game_state(req, hand)
    melds, dw_cards, my_dw = best_meld_arrangement(hand)
    knock = bot.knock_decision(hand, gs) if my_dw <= 10 else False

    return {
        "action": "knock",
        "knock": bool(knock),
        "deadwood": my_dw,
        "dw_cards": len(dw_cards),
        "engine": SERVICE_VERSION,
    }


def handle_request(req: Dict[str, Any]) -> Dict[str, Any]:
    started = time.time()
    action = req.get("action", "draw")
    try:
        if action == "draw":
            result = decide_draw(req)
        elif action == "discard":
            result = decide_discard(req)
        elif action == "knock":
            result = decide_knock(req)
        elif action == "health":
            result = {
                "action": "health",
                "ok": True,
                "engine": SERVICE_VERSION,
                "research_root": RESEARCH_ROOT,
            }
        else:
            result = {"error": f"Unknown action: {action}", "engine": SERVICE_VERSION}
    except Exception as exc:  # noqa: BLE001 — surface to client as structured error
        result = {
            "error": str(exc),
            "traceback": traceback.format_exc()[-1500:],
            "engine": SERVICE_VERSION,
        }
    result["elapsed_ms"] = round((time.time() - started) * 1000, 2)
    result["ok"] = "error" not in result
    return result


def run_stdio_once(raw: str) -> None:
    req = json.loads(raw)
    out = handle_request(req)
    json.dump(out, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()


def run_http(host: str, port: int) -> None:
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, payload: Dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            if self.path in ("/health", "/"):
                self._send(200, handle_request({"action": "health"}))
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8")
            try:
                req = json.loads(raw) if raw else {"action": "health"}
            except json.JSONDecodeError:
                self._send(400, {"error": "invalid JSON", "ok": False})
                return
            result = handle_request(req)
            self._send(200 if result.get("ok") else 400, result)

        def log_message(self, fmt: str, *args: Any) -> None:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Apex AI service listening on http://{host}:{port}", file=sys.stderr)
    print(f"engine={SERVICE_VERSION}", file=sys.stderr)
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="ApexMCTS AI decision service")
    parser.add_argument("--request", type=str, help="Path to JSON request file")
    parser.add_argument("--http", action="store_true", help="Run HTTP server")
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    if args.http:
        run_http(args.host, args.port)
        return

    if args.request:
        with open(args.request, encoding="utf-8") as f:
            raw = f.read()
        run_stdio_once(raw)
        return

    raw = sys.stdin.read()
    if not raw.strip():
        print(
            json.dumps(
                {
                    "error": "empty stdin; pass --request, pipe JSON, or use --http",
                    "ok": False,
                }
            )
        )
        raise SystemExit(1)
    run_stdio_once(raw)


if __name__ == "__main__":
    main()
