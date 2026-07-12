"""
Phase 68: Trace Activation and Solver V6 Sprint

Master runner that executes all tasks:
  A. Build trace-rich low-stock dataset with per-card events
  B. Verify trace signal activation on the new dataset
  C. Build solver v6 with trace-active meld construction
  D. Calibration comparison: v5 vs v6
  E. Trace-off vs trace-on ablation
  F. Surviving knock frontier analysis
  G. Low-DW world gap analysis

Lightweight execution — solver calibration work, no broad benchmarks.
"""

import json
import time
import random
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gin_rummy.undercut_dataset import LabelledKnockSpot
from gin_rummy.undercut_estimator import (
    UndercutRiskEstimator, evaluate_estimator,
)
from gin_rummy.endgame_solver import (
    PublicState, evaluate_knock_now,
)
from gin_rummy.solver_v5 import solve_spot_v5
from gin_rummy.solver_v6 import solve_spot_v6
from gin_rummy.meld import compute_deadwood
from gin_rummy.game import TARGET_SCORE

from gin_rummy.action_trace import (
    ActionTrace, build_trace_weights, trace_weight_diagnostics
)
from gin_rummy.trace_rich_dataset import (
    build_trace_rich_dataset, save_trace_rich_dataset,
    trace_rich_dataset_summary, TraceRichSpot,
)
from gin_rummy.meld_constructor_v2 import (
    enumerate_meld_skeletons_v2,
)


def load_or_build_trace_rich_dataset():
    """Load existing trace-rich dataset or build fresh one."""
    dataset_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'phase68_trace_rich_dataset.json'
    )
    if os.path.exists(dataset_path):
        print(f"  Loading existing trace-rich dataset from {dataset_path} …")
        with open(dataset_path, 'r') as f:
            raw = json.load(f)
        spots = []
        for d in raw:
            spot = TraceRichSpot(
                hero_hand=d['hero_hand'],
                hero_deadwood=d['hero_deadwood'],
                hero_melds=d['hero_melds'],
                hero_dw_cards=d['hero_dw_cards'],
                stock_size=d['stock_size'],
                turn_number=d['turn_number'],
                my_score=d['my_score'],
                opp_score=d['opp_score'],
                discard_pile=d['discard_pile'],
                known_opponent_pickups=d.get('known_opponent_pickups', []),
                known_opponent_discards=d.get('known_opponent_discards', []),
                upcard_declines=d.get('upcard_declines', []),
                hero_discards=d.get('hero_discards', []),
                trace_events=d.get('trace_events', []),
                opp_hand=d['opp_hand'],
                opp_deadwood_raw=d['opp_deadwood_raw'],
                opp_deadwood_after_layoff=d['opp_deadwood_after_layoff'],
                outcome=d['outcome'],
                hero_points=d['hero_points'],
                opp_points=d['opp_points'],
                undercut_ready=d['undercut_ready'],
                discard_pile_size=d.get('discard_pile_size', len(d['discard_pile'])),
                n_opponent_pickups=d.get('n_opponent_pickups', 0),
                n_opponent_discards=d.get('n_opponent_discards', 0),
                hero_dw_card_count=d.get('hero_dw_card_count', 0),
                hero_meld_count=d.get('hero_meld_count', 0),
                game_id=d.get('game_id', 0),
            )
            spots.append(spot)
        print(f"  Loaded {len(spots)} trace-rich spots")
        return spots
    else:
        print(f"  Building fresh trace-rich dataset (500 games) …")
        spots = build_trace_rich_dataset(n_games=500, max_stock=6, verbose=True)
        save_trace_rich_dataset(spots, dataset_path)
        print(f"  Saved {len(spots)} spots to {dataset_path}")
        return spots


def load_phase65_dataset():
    """Load the Phase 65 dataset for estimator training."""
    dataset_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'phase65_undercut_dataset.json'
    )
    if os.path.exists(dataset_path):
        with open(dataset_path, 'r') as f:
            raw = json.load(f)
        spots = []
        for d in raw:
            spot = LabelledKnockSpot(
                hero_hand=d['hero_hand'],
                hero_deadwood=d['hero_deadwood'],
                hero_melds=d['hero_melds'],
                hero_dw_cards=d['hero_dw_cards'],
                stock_size=d['stock_size'],
                turn_number=d['turn_number'],
                my_score=d['my_score'],
                opp_score=d['opp_score'],
                discard_pile=d['discard_pile'],
                opp_hand=d['opp_hand'],
                opp_deadwood_raw=d['opp_deadwood_raw'],
                opp_deadwood_after_layoff=d['opp_deadwood_after_layoff'],
                outcome=d['outcome'],
                hero_points=d['hero_points'],
                opp_points=d['opp_points'],
                undercut_ready=d['undercut_ready'],
                discard_pile_size=d.get('discard_pile_size', len(d['discard_pile'])),
                n_opponent_pickups=d.get('n_opponent_pickups', 0),
                n_opponent_discards=d.get('n_opponent_discards', 0),
                hero_dw_card_count=d.get('hero_dw_card_count', 0),
                hero_meld_count=d.get('hero_meld_count', 0),
                game_id=d.get('game_id', 0),
            )
            spots.append(spot)
        return spots
    return None


def train_estimator(spots):
    """Train the undercut estimator."""
    rng_split = random.Random(123)
    shuffled = list(spots)
    rng_split.shuffle(shuffled)
    split_idx = int(len(shuffled) * 0.8)
    train_spots = shuffled[:split_idx]
    test_spots = shuffled[split_idx:]

    estimator = UndercutRiskEstimator()
    estimator.train(train_spots, lr=0.01, epochs=300, verbose=True)
    return estimator, train_spots, test_spots


def main():
    t0 = time.time()
    results = {}

    # ══════════════════════════════════════════════════════════════════
    # SETUP: Build trace-rich dataset and train estimator
    # ══════════════════════════════════════════════════════════════════
    print("=" * 72)
    print("  PHASE 68: Trace Activation and Solver V6 Sprint")
    print("=" * 72)

    # Build or load trace-rich dataset
    print("\n  TASK A: Building trace-rich dataset …")
    trace_spots = load_or_build_trace_rich_dataset()
    trace_summary = trace_rich_dataset_summary(trace_spots)
    print(f"\n  Trace-Rich Dataset Summary:")
    print(f"    Total spots:             {trace_summary['n']}")
    print(f"    Undercut rate:           {trace_summary['undercut_rate']:.1%}")
    print(f"    Mean opp DW after layoff: {trace_summary['mean_opp_dw_after_layoff']:.1f}")
    print(f"    Frac opp DW ≤ 5:        {trace_summary['frac_dw_le5']:.1%}")
    tc = trace_summary['trace_coverage']
    print(f"\n    Trace Coverage:")
    print(f"      Spots with any trace:  {tc['spots_with_any_trace']} ({tc['pct_with_any_trace']:.1f}%)")
    print(f"      Spots with pickups:    {tc['spots_with_pickups']} ({tc['pct_with_pickups']:.1f}%)")
    print(f"      Spots with discards:   {tc['spots_with_discards']} ({tc['pct_with_discards']:.1f}%)")
    print(f"      Spots with declines:   {tc['spots_with_declines']} ({tc['pct_with_declines']:.1f}%)")
    print(f"      Mean pickups/spot:     {tc['mean_pickups_per_spot']:.2f}")
    print(f"      Mean discards/spot:    {tc['mean_discards_per_spot']:.2f}")
    print(f"      Mean declines/spot:    {tc['mean_declines_per_spot']:.2f}")

    results['task_a'] = trace_summary

    # Train estimator on Phase 65 dataset (or trace-rich dataset as fallback)
    print("\n  SETUP: Training estimator …")
    p65_spots = load_phase65_dataset()
    if p65_spots:
        print(f"  Using Phase 65 dataset ({len(p65_spots)} spots) for estimator")
        # Convert TraceRichSpots to LabelledKnockSpots for compatibility
        estimator_spots = p65_spots
    else:
        print(f"  No Phase 65 dataset; using trace-rich dataset for estimator")
        estimator_spots = []
        for s in trace_spots:
            estimator_spots.append(LabelledKnockSpot(
                hero_hand=s.hero_hand, hero_deadwood=s.hero_deadwood,
                hero_melds=s.hero_melds, hero_dw_cards=s.hero_dw_cards,
                stock_size=s.stock_size, turn_number=s.turn_number,
                my_score=s.my_score, opp_score=s.opp_score,
                discard_pile=s.discard_pile,
                opp_hand=s.opp_hand, opp_deadwood_raw=s.opp_deadwood_raw,
                opp_deadwood_after_layoff=s.opp_deadwood_after_layoff,
                outcome=s.outcome, hero_points=s.hero_points, opp_points=s.opp_points,
                undercut_ready=s.undercut_ready,
                discard_pile_size=s.discard_pile_size,
                n_opponent_pickups=s.n_opponent_pickups,
                n_opponent_discards=s.n_opponent_discards,
                hero_dw_card_count=s.hero_dw_card_count,
                hero_meld_count=s.hero_meld_count,
                game_id=s.game_id,
            ))

    estimator, train_spots, test_spots = train_estimator(estimator_spots)
    eval_result = evaluate_estimator(estimator, test_spots)
    print(f"\n  Estimator Performance:")
    print(f"    UC AUC:     {eval_result['uc_auc']}")
    print(f"    UC Brier:   {eval_result['uc_brier_score']:.4f}")
    print(f"    Opp DW MAE: {eval_result['opp_dw_mae']:.2f}")

    results['setup'] = {
        'n_trace_spots': len(trace_spots),
        'n_estimator_train': len(train_spots),
        'n_estimator_test': len(test_spots),
        'estimator_auc': eval_result['uc_auc'],
        'estimator_brier': eval_result['uc_brier_score'],
    }

    # ══════════════════════════════════════════════════════════════════
    # TASK B: Trace Signal Activation Audit on NEW dataset
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK B: Trace signal activation audit (trace-rich dataset) …")
    print("=" * 72)

    trace_audit_sample = random.Random(88).sample(trace_spots, min(100, len(trace_spots)))
    n_has_signal = 0
    signal_spreads = []
    n_skeleton_ranking_changed = 0

    for spot in trace_audit_sample:
        # Build trace with REAL per-card data
        trace = ActionTrace()
        for c in spot.known_opponent_pickups:
            trace.record_opponent_pickup(c)
        for c in spot.known_opponent_discards:
            trace.record_opponent_discard(c)
        for c in spot.upcard_declines:
            trace.record_upcard_decline(c)

        tw = build_trace_weights(
            spot.hero_hand, spot.discard_pile, trace=trace,
        )
        diag = trace_weight_diagnostics(tw)
        spread = diag.get('spread', 0.0)
        if spread > 0.01:
            n_has_signal += 1
        signal_spreads.append(spread)

        # Check if trace changes skeleton ranking
        hero_set = set(spot.hero_hand)
        visible = set(spot.discard_pile)
        pool = [c for c in range(52) if c not in hero_set and c not in visible]

        # Trace-on skeletons
        skels_on = enumerate_meld_skeletons_v2(pool, tw, max_skeletons=20, trace_active=True)
        # Trace-off skeletons (uniform weights)
        tw_off = {c: 1.0 for c in tw}
        skels_off = enumerate_meld_skeletons_v2(pool, tw_off, max_skeletons=20, trace_active=False)

        if skels_on and skels_off:
            top_on = tuple(sorted(c for m in skels_on[0][0] for c in m))
            top_off = tuple(sorted(c for m in skels_off[0][0] for c in m))
            if top_on != top_off:
                n_skeleton_ranking_changed += 1

    mean_spread = sum(signal_spreads) / len(signal_spreads) if signal_spreads else 0
    pct_active = n_has_signal / len(trace_audit_sample) * 100

    print(f"\n  Trace Signal Activation ({len(trace_audit_sample)} spots):")
    print(f"    Spots with active signal (spread > 0.01): {n_has_signal}/{len(trace_audit_sample)} ({pct_active:.1f}%)")
    print(f"    Mean weight spread:       {mean_spread:.3f}")
    print(f"    Max spread:               {max(signal_spreads):.3f}")
    print(f"    Skeleton ranking changed: {n_skeleton_ranking_changed}/{len(trace_audit_sample)} ({n_skeleton_ranking_changed/len(trace_audit_sample)*100:.1f}%)")

    results['task_b'] = {
        'n_sampled': len(trace_audit_sample),
        'n_has_signal': n_has_signal,
        'signal_activation_rate': round(pct_active / 100, 4),
        'mean_spread': round(mean_spread, 4),
        'max_spread': round(max(signal_spreads), 4),
        'skeleton_ranking_changed': n_skeleton_ranking_changed,
        'skeleton_ranking_change_rate': round(n_skeleton_ranking_changed / len(trace_audit_sample), 4),
    }

    # ══════════════════════════════════════════════════════════════════
    # TASK D+E: Calibration Comparison — v5 vs v6 (trace on) vs v6 (trace off)
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK D+E: Calibration comparison v5 vs v6(on) vs v6(off) …")
    print("=" * 72)

    eval_sample_size = min(150, len(trace_spots))
    eval_spots = random.Random(77).sample(trace_spots, eval_sample_size)

    # Per-solver accumulators
    def make_accum():
        return {
            'knock': 0, 'continue': 0, 'opp_dw_sum': 0,
            'opp_dw_abs_errors': [], 'opp_dw_errors': [],
            'correct_continue_on_uc': 0, 'recommendations': [],
            'frac_dw_le5_sum': 0, 'frac_dw_le5_values': [],
        }

    v5_results = make_accum()
    v6_on_results = make_accum()
    v6_off_results = make_accum()

    n_undercut_spots = sum(1 for s in eval_spots if s.outcome == 'undercut')
    n_v6_differs_from_v5 = 0
    n_trace_changes_action = 0

    for j, spot in enumerate(eval_spots):
        ps = PublicState(
            discard_pile=list(spot.discard_pile),
            turn_number=spot.turn_number,
            stock_size=spot.stock_size,
            my_score=spot.my_score,
            opp_score=spot.opp_score,
        )

        seed_j = 42 + j
        actual_opp_dw = spot.opp_deadwood_after_layoff

        # v5 (Phase 67 — meld-aware construction, no active trace)
        try:
            r5 = solve_spot_v5(
                hero_hand=list(spot.hero_hand), public_state=ps,
                estimator=estimator, n_worlds=100, seed=seed_j,
            )
            v5_results['knock' if r5.recommended_action == 'knock' else 'continue'] += 1
            v5_results['recommendations'].append(r5.recommended_action)

            v5_mean_dw = sum(o.opp_deadwood for o in r5.knock_now.outcomes) / max(1, len(r5.knock_now.outcomes))
            v5_results['opp_dw_sum'] += v5_mean_dw
            v5_results['opp_dw_abs_errors'].append(abs(v5_mean_dw - actual_opp_dw))
            v5_results['opp_dw_errors'].append(v5_mean_dw - actual_opp_dw)
            v5_frac_le5 = sum(1 for o in r5.knock_now.outcomes if o.opp_deadwood <= 5) / max(1, len(r5.knock_now.outcomes))
            v5_results['frac_dw_le5_sum'] += v5_frac_le5
            v5_results['frac_dw_le5_values'].append(v5_frac_le5)

            if spot.outcome == 'undercut' and r5.recommended_action == 'continue':
                v5_results['correct_continue_on_uc'] += 1
        except Exception as e:
            v5_results['recommendations'].append('error')
            print(f"  v5 error on spot {j}: {e}")

        # v6 TRACE ON (Phase 68 — trace-active construction)
        try:
            r6_on = solve_spot_v6(
                hero_hand=list(spot.hero_hand), public_state=ps,
                estimator=estimator, n_worlds=100, seed=seed_j,
                known_opponent_pickups=list(spot.known_opponent_pickups),
                known_opponent_discards=list(spot.known_opponent_discards),
                upcard_declines=list(spot.upcard_declines),
                trace_active=True,
            )
            v6_on_results['knock' if r6_on.recommended_action == 'knock' else 'continue'] += 1
            v6_on_results['recommendations'].append(r6_on.recommended_action)

            v6_on_mean_dw = sum(o.opp_deadwood for o in r6_on.knock_now.outcomes) / max(1, len(r6_on.knock_now.outcomes))
            v6_on_results['opp_dw_sum'] += v6_on_mean_dw
            v6_on_results['opp_dw_abs_errors'].append(abs(v6_on_mean_dw - actual_opp_dw))
            v6_on_results['opp_dw_errors'].append(v6_on_mean_dw - actual_opp_dw)
            v6_on_frac_le5 = sum(1 for o in r6_on.knock_now.outcomes if o.opp_deadwood <= 5) / max(1, len(r6_on.knock_now.outcomes))
            v6_on_results['frac_dw_le5_sum'] += v6_on_frac_le5
            v6_on_results['frac_dw_le5_values'].append(v6_on_frac_le5)

            if spot.outcome == 'undercut' and r6_on.recommended_action == 'continue':
                v6_on_results['correct_continue_on_uc'] += 1

            # Track trace-specific differences
            if v5_results['recommendations'][-1] != 'error' and r6_on.recommended_action != v5_results['recommendations'][-1]:
                n_v6_differs_from_v5 += 1
        except Exception as e:
            v6_on_results['recommendations'].append('error')
            print(f"  v6(on) error on spot {j}: {e}")

        # v6 TRACE OFF (same constructor, trace disabled — ablation control)
        try:
            r6_off = solve_spot_v6(
                hero_hand=list(spot.hero_hand), public_state=ps,
                estimator=estimator, n_worlds=100, seed=seed_j,
                known_opponent_pickups=list(spot.known_opponent_pickups),
                known_opponent_discards=list(spot.known_opponent_discards),
                upcard_declines=list(spot.upcard_declines),
                trace_active=False,
            )
            v6_off_results['knock' if r6_off.recommended_action == 'knock' else 'continue'] += 1
            v6_off_results['recommendations'].append(r6_off.recommended_action)

            v6_off_mean_dw = sum(o.opp_deadwood for o in r6_off.knock_now.outcomes) / max(1, len(r6_off.knock_now.outcomes))
            v6_off_results['opp_dw_sum'] += v6_off_mean_dw
            v6_off_results['opp_dw_abs_errors'].append(abs(v6_off_mean_dw - actual_opp_dw))
            v6_off_results['opp_dw_errors'].append(v6_off_mean_dw - actual_opp_dw)
            v6_off_frac_le5 = sum(1 for o in r6_off.knock_now.outcomes if o.opp_deadwood <= 5) / max(1, len(r6_off.knock_now.outcomes))
            v6_off_results['frac_dw_le5_sum'] += v6_off_frac_le5
            v6_off_results['frac_dw_le5_values'].append(v6_off_frac_le5)

            if spot.outcome == 'undercut' and r6_off.recommended_action == 'continue':
                v6_off_results['correct_continue_on_uc'] += 1

            # Track trace-on vs trace-off differences
            if v6_on_results['recommendations'][-1] != 'error' and r6_off.recommended_action != v6_on_results['recommendations'][-1]:
                n_trace_changes_action += 1
        except Exception as e:
            v6_off_results['recommendations'].append('error')
            print(f"  v6(off) error on spot {j}: {e}")

        if (j + 1) % 25 == 0:
            print(f"  … {j+1}/{eval_sample_size}")

    # ── Print comparison table ──
    n = eval_sample_size
    actual_mean_opp_dw = sum(s.opp_deadwood_after_layoff for s in eval_spots) / n
    actual_frac_le5 = sum(1 for s in eval_spots if s.opp_deadwood_after_layoff <= 5) / n

    print(f"\n  CALIBRATION COMPARISON ({n} trace-rich spots)")
    print(f"  {'':30} {'v5 (P67)':>12} {'v6 ON':>12} {'v6 OFF':>12} {'Actual':>12}")
    print(f"  {'-' * 78}")

    v5_mean_dw = v5_results['opp_dw_sum'] / n
    v6_on_mean = v6_on_results['opp_dw_sum'] / n
    v6_off_mean = v6_off_results['opp_dw_sum'] / n
    print(f"  {'Mean opp DW prediction':30} {v5_mean_dw:12.1f} {v6_on_mean:12.1f} {v6_off_mean:12.1f} {actual_mean_opp_dw:12.1f}")

    v5_mae = sum(v5_results['opp_dw_abs_errors']) / max(1, len(v5_results['opp_dw_abs_errors']))
    v6_on_mae = sum(v6_on_results['opp_dw_abs_errors']) / max(1, len(v6_on_results['opp_dw_abs_errors']))
    v6_off_mae = sum(v6_off_results['opp_dw_abs_errors']) / max(1, len(v6_off_results['opp_dw_abs_errors']))
    print(f"  {'Opp DW MAE':30} {v5_mae:12.1f} {v6_on_mae:12.1f} {v6_off_mae:12.1f}")

    v5_bias = sum(v5_results['opp_dw_errors']) / max(1, len(v5_results['opp_dw_errors']))
    v6_on_bias = sum(v6_on_results['opp_dw_errors']) / max(1, len(v6_on_results['opp_dw_errors']))
    v6_off_bias = sum(v6_off_results['opp_dw_errors']) / max(1, len(v6_off_results['opp_dw_errors']))
    print(f"  {'Opp DW bias':30} {v5_bias:+12.1f} {v6_on_bias:+12.1f} {v6_off_bias:+12.1f}")

    v5_frac = v5_results['frac_dw_le5_sum'] / n
    v6_on_frac = v6_on_results['frac_dw_le5_sum'] / n
    v6_off_frac = v6_off_results['frac_dw_le5_sum'] / n
    print(f"  {'Frac opp DW ≤ 5':30} {v5_frac:12.1%} {v6_on_frac:12.1%} {v6_off_frac:12.1%} {actual_frac_le5:12.1%}")

    v5_knock_rate = v5_results['knock'] / n
    v6_on_knock_rate = v6_on_results['knock'] / n
    v6_off_knock_rate = v6_off_results['knock'] / n
    print(f"\n  {'Knock rate':30} {v5_knock_rate:12.1%} {v6_on_knock_rate:12.1%} {v6_off_knock_rate:12.1%}")
    print(f"  {'Continue rate':30} {1-v5_knock_rate:12.1%} {1-v6_on_knock_rate:12.1%} {1-v6_off_knock_rate:12.1%}")

    if n_undercut_spots > 0:
        v5_cc = v5_results['correct_continue_on_uc']
        v6_on_cc = v6_on_results['correct_continue_on_uc']
        v6_off_cc = v6_off_results['correct_continue_on_uc']
        print(f"\n  Undercut-Aware Accuracy (on {n_undercut_spots} actual undercut spots):")
        print(f"  {'Correctly says continue':30} {v5_cc:>5}/{n_undercut_spots} ({v5_cc/n_undercut_spots:.1%})"
              f"  {v6_on_cc:>5}/{n_undercut_spots} ({v6_on_cc/n_undercut_spots:.1%})"
              f"  {v6_off_cc:>5}/{n_undercut_spots} ({v6_off_cc/n_undercut_spots:.1%})")

    # Trace-specific metrics
    print(f"\n  Trace-Specific Metrics:")
    print(f"    v6 differs from v5 because of any change: {n_v6_differs_from_v5}/{n} ({n_v6_differs_from_v5/n*100:.1f}%)")
    print(f"    v6(on) differs from v6(off) (trace signal alone): {n_trace_changes_action}/{n} ({n_trace_changes_action/n*100:.1f}%)")

    results['task_de'] = {
        'n_eval_spots': n,
        'actual_mean_opp_dw': round(actual_mean_opp_dw, 2),
        'actual_frac_dw_le5': round(actual_frac_le5, 4),
        'n_undercut_spots': n_undercut_spots,
        'v5': {
            'knock_rate': round(v5_knock_rate, 4),
            'mean_opp_dw': round(v5_mean_dw, 2),
            'opp_dw_mae': round(v5_mae, 2),
            'opp_dw_bias': round(v5_bias, 2),
            'frac_dw_le5': round(v5_frac, 4),
            'correct_continue_on_uc': v5_results['correct_continue_on_uc'],
        },
        'v6_trace_on': {
            'knock_rate': round(v6_on_knock_rate, 4),
            'mean_opp_dw': round(v6_on_mean, 2),
            'opp_dw_mae': round(v6_on_mae, 2),
            'opp_dw_bias': round(v6_on_bias, 2),
            'frac_dw_le5': round(v6_on_frac, 4),
            'correct_continue_on_uc': v6_on_results['correct_continue_on_uc'],
        },
        'v6_trace_off': {
            'knock_rate': round(v6_off_knock_rate, 4),
            'mean_opp_dw': round(v6_off_mean, 2),
            'opp_dw_mae': round(v6_off_mae, 2),
            'opp_dw_bias': round(v6_off_bias, 2),
            'frac_dw_le5': round(v6_off_frac, 4),
            'correct_continue_on_uc': v6_off_results['correct_continue_on_uc'],
        },
        'trace_metrics': {
            'v6_differs_from_v5': n_v6_differs_from_v5,
            'trace_changes_action': n_trace_changes_action,
            'pct_v6_differs_v5': round(n_v6_differs_from_v5 / n * 100, 1),
            'pct_trace_changes_action': round(n_trace_changes_action / n * 100, 1),
        },
    }

    # ══════════════════════════════════════════════════════════════════
    # TASK F: Surviving Knock Frontier Analysis
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK F: Surviving knock frontier analysis …")
    print("=" * 72)

    v6_knock_spots = []
    v6_continue_spots = []
    for j, spot in enumerate(eval_spots):
        action = v6_on_results['recommendations'][j]
        if action == 'knock':
            v6_knock_spots.append(spot)
        else:
            v6_continue_spots.append(spot)

    # Analyse knock survivors by DW class
    dw_classes = {}
    for spot in v6_knock_spots:
        dw = spot.hero_deadwood
        if dw not in dw_classes:
            dw_classes[dw] = {'n': 0, 'gin': 0, 'knock_win': 0, 'undercut': 0, 'spots': []}
        dw_classes[dw]['n'] += 1
        dw_classes[dw][spot.outcome] += 1
        dw_classes[dw]['spots'].append(spot)

    print(f"\n  v6 Knock Survivors: {len(v6_knock_spots)}/{n}")
    print(f"  v6 Continue Recommendations: {len(v6_continue_spots)}/{n}")

    print(f"\n  {'DW':>4} {'n':>5} {'Gin':>5} {'Win':>5} {'UC':>5} {'UC Rate':>8}")
    print(f"  {'-' * 38}")
    for dw in sorted(dw_classes.keys()):
        cls = dw_classes[dw]
        uc_rate = cls['undercut'] / cls['n'] if cls['n'] > 0 else 0
        print(f"  {dw:>4} {cls['n']:>5} {cls['gin']:>5} {cls['knock_win']:>5} "
              f"{cls['undercut']:>5} {uc_rate:>8.1%}")

    # Classification
    gin_class = sum(1 for s in v6_knock_spots if s.hero_deadwood == 0)
    clinch_class = sum(1 for s in v6_knock_spots if s.hero_deadwood > 0 and
                       (s.my_score + max(1, 10 - s.hero_deadwood)) >= TARGET_SCORE)
    low_dw_class = sum(1 for s in v6_knock_spots if s.hero_deadwood in [1, 2]
                       and (s.my_score + max(1, 10 - s.hero_deadwood)) < TARGET_SCORE)
    other_class = len(v6_knock_spots) - gin_class - clinch_class - low_dw_class

    print(f"\n  Knock Survivor Classification:")
    print(f"    Gin (DW=0):              {gin_class}")
    print(f"    Clinch-adjacent:         {clinch_class}")
    print(f"    Low-DW (DW=1-2, !clinch): {low_dw_class}")
    print(f"    Other:                   {other_class}")

    # v5→v6 disagreement
    v5_to_v6 = {'knock_to_continue': 0, 'continue_to_knock': 0, 'same': 0}
    for j in range(n):
        v5a = v5_results['recommendations'][j]
        v6a = v6_on_results['recommendations'][j]
        if v5a == 'knock' and v6a == 'continue':
            v5_to_v6['knock_to_continue'] += 1
        elif v5a == 'continue' and v6a == 'knock':
            v5_to_v6['continue_to_knock'] += 1
        else:
            v5_to_v6['same'] += 1

    print(f"\n  v5 → v6 Recommendation Changes:")
    print(f"    Same action:        {v5_to_v6['same']}")
    print(f"    knock → continue:   {v5_to_v6['knock_to_continue']}")
    print(f"    continue → knock:   {v5_to_v6['continue_to_knock']}")

    # UC rate among surviving knocks
    v5_knock_list = [eval_spots[j] for j in range(n) if v5_results['recommendations'][j] == 'knock']
    v5_surv_uc = sum(1 for s in v5_knock_list if s.outcome == 'undercut') / max(1, len(v5_knock_list))
    v6_surv_uc = sum(1 for s in v6_knock_spots if s.outcome == 'undercut') / max(1, len(v6_knock_spots))

    print(f"\n  UC Rate Among Remaining Knock Recommendations:")
    print(f"    v5: {v5_surv_uc:.1%} ({len(v5_knock_list)} knocks)")
    print(f"    v6: {v6_surv_uc:.1%} ({len(v6_knock_spots)} knocks)")

    # Non-gin knock analysis
    v6_nongin_knocks = [s for s in v6_knock_spots if s.hero_deadwood > 0]
    v6_nongin_uc = sum(1 for s in v6_nongin_knocks if s.outcome == 'undercut') / max(1, len(v6_nongin_knocks))
    print(f"\n  Non-Gin Knock Analysis:")
    print(f"    v6 non-gin knocks: {len(v6_nongin_knocks)}")
    print(f"    v6 non-gin UC rate: {v6_nongin_uc:.1%}")

    results['task_f'] = {
        'v6_knock_count': len(v6_knock_spots),
        'v6_continue_count': len(v6_continue_spots),
        'knock_survivor_classification': {
            'gin': gin_class,
            'clinch': clinch_class,
            'low_dw': low_dw_class,
            'other': other_class,
        },
        'v5_to_v6_changes': v5_to_v6,
        'surviving_uc_rate_v5': round(v5_surv_uc, 4),
        'surviving_uc_rate_v6': round(v6_surv_uc, 4),
        'v6_nongin_knocks': len(v6_nongin_knocks),
        'v6_nongin_uc_rate': round(v6_nongin_uc, 4),
        'v6_knock_dw_classes': {
            str(dw): {'n': cls['n'], 'gin': cls['gin'], 'knock_win': cls['knock_win'],
                      'undercut': cls['undercut']}
            for dw, cls in dw_classes.items()
        },
    }

    # ══════════════════════════════════════════════════════════════════
    # SAVE RESULTS
    # ══════════════════════════════════════════════════════════════════
    elapsed = time.time() - t0
    results['elapsed_seconds'] = round(elapsed, 1)

    output_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'phase68_results.json'
    )
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n  Saved all results to {output_path}")
    print(f"  Total elapsed: {elapsed:.1f}s")


if __name__ == '__main__':
    main()
