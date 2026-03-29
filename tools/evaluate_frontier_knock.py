"""
Directive 60: Frontier-Informed Knock Policy Integration Sprint.

Benchmark evaluation comparing frontier-informed knock policy variants
against the current champion (ApexMCTSClinchOnlyGoGin).

Stages:
  1. Quick screen: 240 deals per variant H2H vs champion
  2. Confirmation: 500+ deals for the best candidate
  3. Patient field cross-play
  4. Secondary exploitative diagnostic
  5. Detailed knock diagnostics for the leading candidate
"""

import os
import sys
import json
import time
import random
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from gin_rummy.benchmark import (
    run_balanced_matchup,
    print_matchup_benchmark_result,
    wilson_interval,
)
from gin_rummy.game import GinRummyGame, GIN_BONUS, UNDERCUT_BONUS
from gin_rummy.meld import best_meld_arrangement, compute_deadwood, compute_layoffs
from gin_rummy.card import deadwood_value, card_str
from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin
from gin_rummy.apex_mcts_gogin import ApexMCTSGoGin
from gin_rummy.apex_mcts_clinch_gogin import ApexMCTSClinchGoGin
from gin_rummy.frontier_knock import (
    FrontierGinThreshold,
    FrontierMultiCard,
    FrontierLivenessGuard,
    estimate_gin_probability,
)


# ═══════════════════════════════════════════════════════════════════════
#  DIAGNOSTIC GAME: plays a game and collects knock-level diagnostics
# ═══════════════════════════════════════════════════════════════════════

class DiagnosticGame:
    """Wrapper that plays a full game and collects per-hand knock diagnostics."""

    def __init__(self, player_a, player_b, target_score=100):
        self.game = GinRummyGame(player_a, player_b,
                                  target_score=target_score, verbose=False)
        self.player_a = player_a
        self.player_b = player_b

    def play(self):
        return self.game.play_game()


def run_diagnostic_matchup(factory_a, factory_b, n_deals=100, seed=0):
    """Run a diagnostic matchup that collects knock-level stats.

    Returns (benchmark_result, diagnostics_dict).
    """
    result = run_balanced_matchup(factory_a, factory_b,
                                   n_games=n_deals, seed=seed, progress=True)
    return result


# ═══════════════════════════════════════════════════════════════════════
#  KNOCK DECISION PROFILER
# ═══════════════════════════════════════════════════════════════════════

def profile_knock_decisions(factory, n_games=200, seed=42):
    """Profile knock decisions for a bot across many games.

    Plays games against the champion and records every knock decision.
    Returns diagnostic summary.
    """
    rng = random.Random(seed)

    total_knocks = 0
    total_gins = 0
    total_undercuts_for = 0  # undercuts where this bot is the undercutter (opponent knocked)
    total_undercuts_against = 0  # undercuts where this bot knocked and got undercut
    total_knock_points = 0
    total_knock_dw = 0
    knock_dw_list = []

    gin_prob_at_knock = []
    dw_cards_at_knock = []

    # Play games and collect hand results
    champion_factory = lambda: ApexMCTSClinchOnlyGoGin(seed=None)

    for i in range(n_games):
        random.seed(seed + i)
        p_a = factory()
        p_b = champion_factory()
        game = GinRummyGame(p_a, p_b, target_score=100, verbose=False)
        gr = game.play_game()

        total_gins += gr.gin_count[0]
        total_undercuts_for += gr.undercut_count[0]  # A got undercut (A was knocker)

    # Also run with swapped seats
    for i in range(n_games):
        random.seed(seed + i)
        p_a = champion_factory()
        p_b = factory()
        game = GinRummyGame(p_a, p_b, target_score=100, verbose=False)
        gr = game.play_game()

        total_gins += gr.gin_count[1]
        total_undercuts_for += gr.undercut_count[1]

    total_games = n_games * 2
    return {
        'total_games': total_games,
        'total_gins': total_gins,
        'gin_rate': round(total_gins / total_games, 3),
        'total_undercuts_against': total_undercuts_for,
        'undercut_rate': round(total_undercuts_for / max(1, total_games), 3),
    }


# ═══════════════════════════════════════════════════════════════════════
#  DETAILED KNOCK PROFILING VIA INSTRUMENTED GAMES
# ═══════════════════════════════════════════════════════════════════════

class InstrumentedKnockBot:
    """Wraps a bot to instrument its knock decisions."""

    def __init__(self, inner_bot, gp_rng=None):
        self.inner = inner_bot
        self.name = inner_bot.name
        self._gp_rng = gp_rng or random.Random(12345)
        self.knock_log = []  # (dw, n_dw_cards, gin_prob, decision)

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def new_hand(self, hand, opponent_id):
        return self.inner.new_hand(hand, opponent_id)

    def draw_decision(self, top_discard, hand, game_state):
        return self.inner.draw_decision(top_discard, hand, game_state)

    def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
        return self.inner.discard_decision(hand, drew_from_discard, drawn_card,
                                            game_state)

    def knock_decision(self, hand, game_state):
        decision = self.inner.knock_decision(hand, game_state)

        # Log the state at decision time
        melds, dw_cards, my_dw = best_meld_arrangement(hand)
        if my_dw <= 10 and my_dw > 0:  # Non-trivial decision
            gp = estimate_gin_probability(hand, n_rollouts=30,
                                           rng=self._gp_rng)
            self.knock_log.append({
                'dw': my_dw,
                'n_dw_cards': len(dw_cards),
                'gin_prob': round(gp, 3),
                'decision': decision,
            })
        return decision

    def notify_opponent_draw(self, from_discard, card=None):
        return self.inner.notify_opponent_draw(from_discard, card)

    def notify_opponent_discard(self, card):
        return self.inner.notify_opponent_discard(card)

    def notify_hand_result(self, result):
        return self.inner.notify_hand_result(result)


def run_instrumented_matchup(candidate_factory, n_games=150, seed=42):
    """Run games with instrumented knock decisions.

    Returns detailed knock diagnostics for the candidate.
    """
    champion_factory = lambda: ApexMCTSClinchOnlyGoGin(seed=None)
    all_logs = []

    for i in range(n_games):
        random.seed(seed + i)
        bot = InstrumentedKnockBot(candidate_factory())
        opp = champion_factory()
        game = GinRummyGame(bot, opp, target_score=100, verbose=False)
        game.play_game()
        all_logs.extend(bot.knock_log)

    # Swap seats
    for i in range(n_games):
        random.seed(seed + i)
        opp = champion_factory()
        bot = InstrumentedKnockBot(candidate_factory())
        game = GinRummyGame(opp, bot, target_score=100, verbose=False)
        game.play_game()
        all_logs.extend(bot.knock_log)

    if not all_logs:
        return {'error': 'no knock decisions logged'}

    # Analyze
    total = len(all_logs)
    knocks = [e for e in all_logs if e['decision']]
    continues = [e for e in all_logs if not e['decision']]

    knock_rate = len(knocks) / total

    # By gin probability bucket
    gp_buckets = {'<0.10': [], '0.10-0.20': [], '0.20-0.30': [],
                  '0.30-0.40': [], '>=0.40': []}
    for e in all_logs:
        gp = e['gin_prob']
        if gp < 0.10:
            gp_buckets['<0.10'].append(e)
        elif gp < 0.20:
            gp_buckets['0.10-0.20'].append(e)
        elif gp < 0.30:
            gp_buckets['0.20-0.30'].append(e)
        elif gp < 0.40:
            gp_buckets['0.30-0.40'].append(e)
        else:
            gp_buckets['>=0.40'].append(e)

    gp_knock_rates = {}
    for bucket, entries in gp_buckets.items():
        if entries:
            kr = sum(1 for e in entries if e['decision']) / len(entries)
            gp_knock_rates[bucket] = {'count': len(entries),
                                       'knock_rate': round(kr, 3)}

    # By DW-card count bucket
    dw_card_buckets = {'1': [], '2': [], '3+': []}
    for e in all_logs:
        n = e['n_dw_cards']
        if n == 1:
            dw_card_buckets['1'].append(e)
        elif n == 2:
            dw_card_buckets['2'].append(e)
        else:
            dw_card_buckets['3+'].append(e)

    dw_card_knock_rates = {}
    for bucket, entries in dw_card_buckets.items():
        if entries:
            kr = sum(1 for e in entries if e['decision']) / len(entries)
            dw_card_knock_rates[bucket] = {'count': len(entries),
                                            'knock_rate': round(kr, 3)}

    # Average DW when knocking
    avg_knock_dw = sum(e['dw'] for e in knocks) / max(1, len(knocks))

    return {
        'total_decisions': total,
        'total_knocks': len(knocks),
        'total_continues': len(continues),
        'knock_rate': round(knock_rate, 3),
        'avg_knock_dw': round(avg_knock_dw, 1),
        'gp_bucket_knock_rates': gp_knock_rates,
        'dw_card_bucket_knock_rates': dw_card_knock_rates,
    }


# ═══════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════

def main():
    t_global = time.time()
    print("=" * 78)
    print("  DIRECTIVE 60: FRONTIER-INFORMED KNOCK POLICY INTEGRATION SPRINT")
    print("=" * 78)

    BASE_SEED = 20260320

    # ────────────────────────────────────────────────────────────────
    # Define candidate variants
    # ────────────────────────────────────────────────────────────────
    candidates = {
        # Family A: Simple gin-probability threshold
        'FrontierGinT20': lambda: FrontierGinThreshold(
            gin_prob_threshold=0.20, seed=None),
        'FrontierGinT30': lambda: FrontierGinThreshold(
            gin_prob_threshold=0.30, seed=None),

        # Family B: Threshold + multi-card DW exception
        'FrontierMC3_T20': lambda: FrontierMultiCard(
            gin_prob_threshold=0.20, min_dw_cards=3, seed=None),

        # Family C: Threshold + high-liveness patience guard
        'FrontierLG40_T20': lambda: FrontierLivenessGuard(
            gin_prob_threshold=0.20, liveness_guard=0.40,
            guard_min_dw=6, seed=None),
        'FrontierLG40_T30': lambda: FrontierLivenessGuard(
            gin_prob_threshold=0.30, liveness_guard=0.40,
            guard_min_dw=6, seed=None),
    }

    champion_factory = lambda: ApexMCTSClinchOnlyGoGin(seed=None)

    # ════════════════════════════════════════════════════════════════
    # STAGE 1: Quick Screen (240 deals each)
    # ════════════════════════════════════════════════════════════════
    SCREEN_DEALS = 240
    print(f"\n{'━' * 78}")
    print(f"  STAGE 1: QUICK SCREEN ({SCREEN_DEALS} deals each vs Champion)")
    print(f"{'━' * 78}")

    screen_results = {}
    for name, factory in candidates.items():
        print(f"\n  ── {name} vs Champion ──")
        result = run_balanced_matchup(
            factory, champion_factory,
            n_games=SCREEN_DEALS,
            seed=BASE_SEED,
            progress=True,
        )
        print_matchup_benchmark_result(result)
        screen_results[name] = result

    # Rank by win rate
    print(f"\n{'━' * 78}")
    print("  SCREEN RANKING")
    print(f"{'━' * 78}")
    ranked = sorted(screen_results.items(),
                    key=lambda x: x[1].win_rate_a, reverse=True)
    for i, (name, r) in enumerate(ranked, 1):
        ci_lo, ci_hi = r.win_rate_ci_a
        print(f"  {i}. {name:<22s}  WR={r.win_rate_a*100:5.1f}%  "
              f"95% CI [{ci_lo*100:.1f}%, {ci_hi*100:.1f}%]  "
              f"({r.wins_a}-{r.wins_b})")

    # Select best candidate
    best_name = ranked[0][0]
    best_factory = candidates[best_name]
    print(f"\n  → Best candidate: {best_name}")

    # ════════════════════════════════════════════════════════════════
    # STAGE 2: Confirmation (500+ deals)
    # ════════════════════════════════════════════════════════════════
    CONFIRM_DEALS = 500
    print(f"\n{'━' * 78}")
    print(f"  STAGE 2: CONFIRMATION ({CONFIRM_DEALS} deals: {best_name} vs Champion)")
    print(f"{'━' * 78}")

    confirm_result = run_balanced_matchup(
        best_factory, champion_factory,
        n_games=CONFIRM_DEALS,
        seed=BASE_SEED + 100000,
        progress=True,
    )
    print_matchup_benchmark_result(confirm_result)

    # Check if the second-best also deserves confirmation
    if len(ranked) >= 2:
        second_name = ranked[1][0]
        second_wr = ranked[1][1].win_rate_a
        best_wr = ranked[0][1].win_rate_a
        if second_wr > 0.48 and abs(best_wr - second_wr) < 0.03:
            print(f"\n  [Second-best {second_name} is close; running confirmation]")
            second_factory = candidates[second_name]
            confirm2 = run_balanced_matchup(
                second_factory, champion_factory,
                n_games=CONFIRM_DEALS,
                seed=BASE_SEED + 200000,
                progress=True,
            )
            print_matchup_benchmark_result(confirm2)

            # If second is actually better in confirmation, switch
            if confirm2.win_rate_a > confirm_result.win_rate_a:
                print(f"  → {second_name} beats {best_name} in confirmation. Switching.")
                best_name = second_name
                best_factory = second_factory
                confirm_result = confirm2

    # ════════════════════════════════════════════════════════════════
    # STAGE 3: Patient Field Cross-Play
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'━' * 78}")
    print(f"  STAGE 3: PATIENT FIELD CROSS-PLAY ({best_name})")
    print(f"{'━' * 78}")

    field_opponents = {
        'Champion': champion_factory,
        'GoGin': lambda: ApexMCTSGoGin(seed=None),
        'ClinchGoGin': lambda: ApexMCTSClinchGoGin(seed=None),
    }

    FIELD_DEALS = 300
    field_results = {}
    for opp_name, opp_factory in field_opponents.items():
        print(f"\n  ── {best_name} vs {opp_name} ──")
        result = run_balanced_matchup(
            best_factory, opp_factory,
            n_games=FIELD_DEALS,
            seed=BASE_SEED + 300000,
            progress=True,
        )
        print_matchup_benchmark_result(result)
        field_results[opp_name] = result

    # ════════════════════════════════════════════════════════════════
    # STAGE 4: Secondary Exploitative Diagnostic
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'━' * 78}")
    print(f"  STAGE 4: SECONDARY EXPLOITATIVE DIAGNOSTIC ({best_name} vs Apex)")
    print(f"{'━' * 78}")

    exploit_factory = lambda: ApexMCTS(seed=None)
    exploit_result = run_balanced_matchup(
        best_factory, exploit_factory,
        n_games=FIELD_DEALS,
        seed=BASE_SEED + 400000,
        progress=True,
    )
    print_matchup_benchmark_result(exploit_result)

    # Also run champion vs Apex for comparison
    print(f"\n  ── Champion vs Apex (baseline comparison) ──")
    champ_exploit_result = run_balanced_matchup(
        champion_factory, exploit_factory,
        n_games=FIELD_DEALS,
        seed=BASE_SEED + 400000,
        progress=True,
    )
    print_matchup_benchmark_result(champ_exploit_result)

    # ════════════════════════════════════════════════════════════════
    # STAGE 5: Detailed Knock Diagnostics
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'━' * 78}")
    print(f"  STAGE 5: DETAILED KNOCK DIAGNOSTICS ({best_name})")
    print(f"{'━' * 78}")

    print(f"\n  [Running instrumented games for {best_name}...]")
    candidate_diag = run_instrumented_matchup(
        best_factory, n_games=100, seed=BASE_SEED + 500000)

    print(f"\n  [Running instrumented games for Champion...]")
    champion_diag = run_instrumented_matchup(
        champion_factory, n_games=100, seed=BASE_SEED + 500000)

    print(f"\n  ── {best_name} Knock Profile ──")
    _print_knock_diagnostics(best_name, candidate_diag)

    print(f"\n  ── Champion Knock Profile ──")
    _print_knock_diagnostics("Champion", champion_diag)

    # ════════════════════════════════════════════════════════════════
    # SUMMARY
    # ════════════════════════════════════════════════════════════════
    elapsed = time.time() - t_global
    print(f"\n{'═' * 78}")
    print(f"  DIRECTIVE 60 COMPLETE — {elapsed:.0f}s total")
    print(f"{'═' * 78}")

    # Save results as JSON
    out = {
        'meta': {
            'directive': 60,
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'elapsed_seconds': round(elapsed, 1),
            'best_candidate': best_name,
        },
        'screen': {
            name: {
                'wins_a': r.wins_a, 'wins_b': r.wins_b,
                'games': r.games_played,
                'win_rate_a': round(r.win_rate_a, 4),
                'ci_a': [round(x, 4) for x in r.win_rate_ci_a],
            }
            for name, r in screen_results.items()
        },
        'confirmation': {
            'name': best_name,
            'wins_a': confirm_result.wins_a,
            'wins_b': confirm_result.wins_b,
            'games': confirm_result.games_played,
            'win_rate_a': round(confirm_result.win_rate_a, 4),
            'ci_a': [round(x, 4) for x in confirm_result.win_rate_ci_a],
        },
        'field': {
            opp_name: {
                'wins_a': r.wins_a, 'wins_b': r.wins_b,
                'games': r.games_played,
                'win_rate_a': round(r.win_rate_a, 4),
            }
            for opp_name, r in field_results.items()
        },
        'exploitative': {
            'wins_a': exploit_result.wins_a,
            'wins_b': exploit_result.wins_b,
            'win_rate_a': round(exploit_result.win_rate_a, 4),
            'champion_vs_apex_wr': round(champ_exploit_result.win_rate_a, 4),
        },
        'diagnostics': {
            'candidate': candidate_diag,
            'champion': champion_diag,
        },
    }

    out_path = os.path.join(os.path.dirname(__file__), '..',
                            'frontier_knock_results.json')
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=2)
    print(f"  Results → {out_path}")


def _print_knock_diagnostics(name, diag):
    if 'error' in diag:
        print(f"    {diag['error']}")
        return

    print(f"    Total non-trivial decisions: {diag['total_decisions']}")
    print(f"    Total knocks: {diag['total_knocks']} "
          f"({diag['knock_rate']*100:.1f}%)")
    print(f"    Total continues: {diag['total_continues']}")
    print(f"    Avg DW when knocking: {diag['avg_knock_dw']}")

    print(f"\n    Knock rate by gin-probability bucket:")
    for bucket, info in diag.get('gp_bucket_knock_rates', {}).items():
        print(f"      {bucket:12s}: {info['knock_rate']*100:5.1f}%  "
              f"(n={info['count']})")

    print(f"\n    Knock rate by DW-card count:")
    for bucket, info in diag.get('dw_card_bucket_knock_rates', {}).items():
        print(f"      {bucket:4s} cards: {info['knock_rate']*100:5.1f}%  "
              f"(n={info['count']})")


if __name__ == '__main__':
    main()
