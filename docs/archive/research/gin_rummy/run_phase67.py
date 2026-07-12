"""
Phase 67: Trace-Aware Meld World Construction Sprint

Master runner that executes all tasks:
  A. Pipe per-card public action traces (action_trace.py)
  B. Build meld-aware opponent hand constructor (meld_constructor.py)
  C. Combine meld construction with trace-aware card weights
  D. Build solver v5
  E. Calibration comparison: v3 vs v4 vs v5
  F. Revisit the surviving knock frontier
  G. (Optional) Tiny validation probe if v5 materially outperforms

Lightweight execution — solver calibration work, no broad benchmarks.
"""

import json
import time
import random
import sys
import os

# Ensure project root is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gin_rummy.undercut_dataset import (
    build_undercut_dataset, save_dataset, dataset_summary, LabelledKnockSpot
)
from gin_rummy.undercut_estimator import (
    UndercutRiskEstimator, evaluate_estimator, feature_importance,
)
from gin_rummy.endgame_solver import (
    PublicState, evaluate_knock_now, generate_hidden_worlds
)
from gin_rummy.solver_v2 import solve_spot_v2, CONTINUATION_CHAMPION
from gin_rummy.solver_v3 import solve_spot_v3
from gin_rummy.solver_v4 import solve_spot_v4
from gin_rummy.solver_v5 import solve_spot_v5
from gin_rummy.meld import compute_deadwood
from gin_rummy.game import TARGET_SCORE

# Phase 67 modules
from gin_rummy.action_trace import (
    ActionTrace, build_trace_weights, trace_weight_diagnostics
)
from gin_rummy.meld_constructor import (
    construct_meld_aware_hands, construct_worlds_with_estimator,
    enumerate_meld_skeletons,
)


def load_or_build_dataset():
    """Load the Phase 65 dataset or build a fresh one."""
    dataset_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'phase65_undercut_dataset.json'
    )
    if os.path.exists(dataset_path):
        print(f"  Loading existing dataset from {dataset_path} …")
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
        print(f"  Loaded {len(spots)} spots")
        return spots
    else:
        print(f"  Building fresh dataset …")
        return build_undercut_dataset(n_games=500, max_stock=6, verbose=True)


def train_estimator(spots):
    """Train the undercut estimator on 80% of spots."""
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
    # SETUP: Load data and train estimator
    # ══════════════════════════════════════════════════════════════════
    print("=" * 72)
    print("  PHASE 67: Trace-Aware Meld World Construction Sprint")
    print("=" * 72)

    print("\n  SETUP: Loading dataset and training estimator …")
    spots = load_or_build_dataset()
    estimator, train_spots, test_spots = train_estimator(spots)
    print(f"  Estimator trained on {len(train_spots)} spots")
    print(f"  Test set: {len(test_spots)} spots")

    eval_result = evaluate_estimator(estimator, test_spots)
    print(f"\n  Estimator Test Performance:")
    print(f"    UC AUC:     {eval_result['uc_auc']}")
    print(f"    UC Brier:   {eval_result['uc_brier_score']:.4f}")
    print(f"    Opp DW MAE: {eval_result['opp_dw_mae']:.2f}")

    results['setup'] = {
        'n_spots': len(spots),
        'n_train': len(train_spots),
        'n_test': len(test_spots),
        'estimator_auc': eval_result['uc_auc'],
        'estimator_brier': eval_result['uc_brier_score'],
    }

    # ══════════════════════════════════════════════════════════════════
    # TASK A: Trace Signal Activation Audit
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK A: Trace signal activation audit …")
    print("=" * 72)

    trace_audit_sample = random.Random(88).sample(spots, min(100, len(spots)))
    n_has_signal = 0
    signal_spreads = []

    for spot in trace_audit_sample:
        tw = build_trace_weights(
            spot.hero_hand, spot.discard_pile,
            known_opponent_pickups=[] if spot.n_opponent_pickups == 0 else None,
            known_opponent_discards=[] if spot.n_opponent_discards == 0 else None,
        )
        diag = trace_weight_diagnostics(tw)
        spread = diag.get('spread', 0.0)
        if spread > 0.01:
            n_has_signal += 1
        signal_spreads.append(spread)

    mean_spread = sum(signal_spreads) / len(signal_spreads) if signal_spreads else 0
    print(f"\n  Trace Signal Activation ({len(trace_audit_sample)} spots):")
    print(f"    Spots with active signal: {n_has_signal}/{len(trace_audit_sample)}"
          f" ({n_has_signal/len(trace_audit_sample):.1%})")
    print(f"    Mean weight spread:       {mean_spread:.3f}")
    print(f"    NOTE: Most spots lack per-card pickup/discard lists in the")
    print(f"          Phase 65 dataset. The trace weights activate when")
    print(f"          specific card-level events are available.")

    results['task_a'] = {
        'n_sampled': len(trace_audit_sample),
        'n_has_signal': n_has_signal,
        'signal_activation_rate': round(n_has_signal / len(trace_audit_sample), 4),
        'mean_spread': round(mean_spread, 4),
        'note': 'Phase 65 dataset stores only pickup/discard COUNTS, not specific cards. '
                'Trace weights will show more differentiation with real per-card events.',
    }

    # ══════════════════════════════════════════════════════════════════
    # TASK B: Meld Skeleton Audit
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK B: Meld skeleton enumeration audit …")
    print("=" * 72)

    skel_audit_sample = random.Random(99).sample(spots, min(50, len(spots)))
    skel_counts = []
    skel_card_counts = []

    for spot in skel_audit_sample:
        hero_set = set(spot.hero_hand)
        visible = set(spot.discard_pile)
        pool = [c for c in range(52) if c not in hero_set and c not in visible]

        tw = build_trace_weights(spot.hero_hand, spot.discard_pile)
        skeletons = enumerate_meld_skeletons(pool, tw, max_skeletons=50)
        skel_counts.append(len(skeletons))
        if skeletons:
            # Count unique cards across all skeletons
            all_cards = set()
            for melds, _ in skeletons:
                for m in melds:
                    all_cards.update(m)
            skel_card_counts.append(len(all_cards))

    mean_skels = sum(skel_counts) / len(skel_counts) if skel_counts else 0
    mean_cards = sum(skel_card_counts) / len(skel_card_counts) if skel_card_counts else 0

    print(f"\n  Meld Skeleton Enumeration ({len(skel_audit_sample)} spots):")
    print(f"    Mean skeletons per spot: {mean_skels:.1f}")
    print(f"    Mean unique cards in skeletons: {mean_cards:.1f}")
    print(f"    Spots with 0 skeletons: {sum(1 for c in skel_counts if c == 0)}")

    results['task_b'] = {
        'n_sampled': len(skel_audit_sample),
        'mean_skeletons': round(mean_skels, 1),
        'mean_unique_cards': round(mean_cards, 1),
        'n_zero_skeletons': sum(1 for c in skel_counts if c == 0),
    }

    # ══════════════════════════════════════════════════════════════════
    # TASK E: Calibration Comparison — v3 vs v4 vs v5
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK E: Calibration comparison v3 vs v4 vs v5 …")
    print("=" * 72)

    eval_sample_size = min(150, len(spots))
    eval_spots = random.Random(77).sample(spots, eval_sample_size)

    # Per-solver accumulators
    v3_results = {'knock': 0, 'continue': 0, 'opp_dw_sum': 0,
                  'opp_dw_abs_errors': [], 'opp_dw_errors': [],
                  'correct_continue_on_uc': 0, 'recommendations': [],
                  'frac_dw_le5_sum': 0}
    v4_results = {'knock': 0, 'continue': 0, 'opp_dw_sum': 0,
                  'opp_dw_abs_errors': [], 'opp_dw_errors': [],
                  'correct_continue_on_uc': 0, 'recommendations': [],
                  'frac_dw_le5_sum': 0}
    v5_results = {'knock': 0, 'continue': 0, 'opp_dw_sum': 0,
                  'opp_dw_abs_errors': [], 'opp_dw_errors': [],
                  'correct_continue_on_uc': 0, 'recommendations': [],
                  'diag_samples': [], 'frac_dw_le5_sum': 0}

    n_undercut_spots = sum(1 for s in eval_spots if s.outcome == 'undercut')

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

        # v3 (Phase 65 — uniform worlds + belief reweighting + penalty)
        try:
            r3 = solve_spot_v3(
                hero_hand=list(spot.hero_hand), public_state=ps,
                estimator=estimator, n_worlds=100, seed=seed_j,
            )
            v3_results['knock' if r3.recommended_action == 'knock' else 'continue'] += 1
            v3_results['recommendations'].append(r3.recommended_action)

            v3_mean_dw = sum(o.opp_deadwood for o in r3.knock_now.outcomes) / max(1, len(r3.knock_now.outcomes))
            v3_results['opp_dw_sum'] += v3_mean_dw
            v3_results['opp_dw_abs_errors'].append(abs(v3_mean_dw - actual_opp_dw))
            v3_results['opp_dw_errors'].append(v3_mean_dw - actual_opp_dw)
            v3_frac_le5 = sum(1 for o in r3.knock_now.outcomes if o.opp_deadwood <= 5) / max(1, len(r3.knock_now.outcomes))
            v3_results['frac_dw_le5_sum'] += v3_frac_le5

            if spot.outcome == 'undercut' and r3.recommended_action == 'continue':
                v3_results['correct_continue_on_uc'] += 1
        except Exception as e:
            v3_results['recommendations'].append('error')
            print(f"  v3 error on spot {j}: {e}")

        # v4 (Phase 66 — belief-weighted random worlds)
        try:
            r4 = solve_spot_v4(
                hero_hand=list(spot.hero_hand), public_state=ps,
                estimator=estimator, n_worlds=100, seed=seed_j,
            )
            v4_results['knock' if r4.recommended_action == 'knock' else 'continue'] += 1
            v4_results['recommendations'].append(r4.recommended_action)

            v4_mean_dw = sum(o.opp_deadwood for o in r4.knock_now.outcomes) / max(1, len(r4.knock_now.outcomes))
            v4_results['opp_dw_sum'] += v4_mean_dw
            v4_results['opp_dw_abs_errors'].append(abs(v4_mean_dw - actual_opp_dw))
            v4_results['opp_dw_errors'].append(v4_mean_dw - actual_opp_dw)
            v4_frac_le5 = sum(1 for o in r4.knock_now.outcomes if o.opp_deadwood <= 5) / max(1, len(r4.knock_now.outcomes))
            v4_results['frac_dw_le5_sum'] += v4_frac_le5

            if spot.outcome == 'undercut' and r4.recommended_action == 'continue':
                v4_results['correct_continue_on_uc'] += 1
        except Exception as e:
            v4_results['recommendations'].append('error')
            print(f"  v4 error on spot {j}: {e}")

        # v5 (Phase 67 — meld-aware construction)
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

            if spot.outcome == 'undercut' and r5.recommended_action == 'continue':
                v5_results['correct_continue_on_uc'] += 1

            # Detailed diagnostics for first 20
            if j < 20:
                diag = r5.diagnostics
                v5_results['diag_samples'].append({
                    'spot_idx': j,
                    'hero_dw': spot.hero_deadwood,
                    'stock': spot.stock_size,
                    'actual_outcome': spot.outcome,
                    'actual_opp_dw': actual_opp_dw,
                    'v5_opp_dw_mean': round(v5_mean_dw, 1),
                    'v5_frac_dw_le5': round(v5_frac_le5, 3),
                    'v5_uc_rate': diag.get('meld_aware_uc_rate'),
                    'v5_action': r5.recommended_action,
                    'v3_action': v3_results['recommendations'][-1] if v3_results['recommendations'] else '?',
                    'v4_action': v4_results['recommendations'][-1] if v4_results['recommendations'] else '?',
                    'constructor_skeletons': diag.get('constructor', {}).get('n_skeletons_found'),
                    'constructor_tiers': diag.get('constructor', {}).get('tier_counts_selected'),
                })
        except Exception as e:
            v5_results['recommendations'].append('error')
            print(f"  v5 error on spot {j}: {e}")

        if (j + 1) % 25 == 0:
            print(f"  … {j+1}/{eval_sample_size}")

    # ── Print comparison table ──
    n = eval_sample_size
    actual_uc_rate = sum(1 for s in eval_spots if s.outcome == 'undercut') / n
    actual_mean_opp_dw = sum(s.opp_deadwood_after_layoff for s in eval_spots) / n
    actual_frac_le5 = sum(1 for s in eval_spots if s.opp_deadwood_after_layoff <= 5) / n

    print(f"\n  CALIBRATION COMPARISON ({n} spots)")
    print(f"  {'':30} {'v3 (P65)':>12} {'v4 (P66)':>12} {'v5 (P67)':>12} {'Actual':>12}")
    print(f"  {'-' * 78}")

    v3_mean_dw = v3_results['opp_dw_sum'] / n
    v4_mean_dw = v4_results['opp_dw_sum'] / n
    v5_mean_dw = v5_results['opp_dw_sum'] / n
    print(f"  {'Mean opp DW prediction':30} {v3_mean_dw:12.1f} {v4_mean_dw:12.1f} {v5_mean_dw:12.1f} {actual_mean_opp_dw:12.1f}")

    v3_mae = sum(v3_results['opp_dw_abs_errors']) / max(1, len(v3_results['opp_dw_abs_errors']))
    v4_mae = sum(v4_results['opp_dw_abs_errors']) / max(1, len(v4_results['opp_dw_abs_errors']))
    v5_mae = sum(v5_results['opp_dw_abs_errors']) / max(1, len(v5_results['opp_dw_abs_errors']))
    print(f"  {'Opp DW MAE':30} {v3_mae:12.1f} {v4_mae:12.1f} {v5_mae:12.1f}")

    v3_bias = sum(v3_results['opp_dw_errors']) / max(1, len(v3_results['opp_dw_errors']))
    v4_bias = sum(v4_results['opp_dw_errors']) / max(1, len(v4_results['opp_dw_errors']))
    v5_bias = sum(v5_results['opp_dw_errors']) / max(1, len(v5_results['opp_dw_errors']))
    print(f"  {'Opp DW bias':30} {v3_bias:+12.1f} {v4_bias:+12.1f} {v5_bias:+12.1f}")

    v3_frac = v3_results['frac_dw_le5_sum'] / n
    v4_frac = v4_results['frac_dw_le5_sum'] / n
    v5_frac = v5_results['frac_dw_le5_sum'] / n
    print(f"  {'Frac opp DW <= 5':30} {v3_frac:12.1%} {v4_frac:12.1%} {v5_frac:12.1%} {actual_frac_le5:12.1%}")

    v3_knock_rate = v3_results['knock'] / n
    v4_knock_rate = v4_results['knock'] / n
    v5_knock_rate = v5_results['knock'] / n
    print(f"\n  {'Knock rate':30} {v3_knock_rate:12.1%} {v4_knock_rate:12.1%} {v5_knock_rate:12.1%}")
    print(f"  {'Continue rate':30} {1-v3_knock_rate:12.1%} {1-v4_knock_rate:12.1%} {1-v5_knock_rate:12.1%}")

    if n_undercut_spots > 0:
        v3_cc = v3_results['correct_continue_on_uc']
        v4_cc = v4_results['correct_continue_on_uc']
        v5_cc = v5_results['correct_continue_on_uc']
        print(f"\n  Undercut-Aware Accuracy (on {n_undercut_spots} actual undercut spots):")
        print(f"  {'Correctly says continue':30} {v3_cc:>5}/{n_undercut_spots} ({v3_cc/n_undercut_spots:.1%})"
              f"  {v4_cc:>5}/{n_undercut_spots} ({v4_cc/n_undercut_spots:.1%})"
              f"  {v5_cc:>5}/{n_undercut_spots} ({v5_cc/n_undercut_spots:.1%})")

    results['task_e'] = {
        'n_eval_spots': n,
        'actual_uc_rate': round(actual_uc_rate, 4),
        'actual_mean_opp_dw': round(actual_mean_opp_dw, 2),
        'actual_frac_dw_le5': round(actual_frac_le5, 4),
        'v3': {
            'knock_rate': round(v3_knock_rate, 4),
            'mean_opp_dw': round(v3_mean_dw, 2),
            'opp_dw_mae': round(v3_mae, 2),
            'opp_dw_bias': round(v3_bias, 2),
            'frac_dw_le5': round(v3_frac, 4),
            'correct_continue_on_uc': v3_results['correct_continue_on_uc'],
        },
        'v4': {
            'knock_rate': round(v4_knock_rate, 4),
            'mean_opp_dw': round(v4_mean_dw, 2),
            'opp_dw_mae': round(v4_mae, 2),
            'opp_dw_bias': round(v4_bias, 2),
            'frac_dw_le5': round(v4_frac, 4),
            'correct_continue_on_uc': v4_results['correct_continue_on_uc'],
        },
        'v5': {
            'knock_rate': round(v5_knock_rate, 4),
            'mean_opp_dw': round(v5_mean_dw, 2),
            'opp_dw_mae': round(v5_mae, 2),
            'opp_dw_bias': round(v5_bias, 2),
            'frac_dw_le5': round(v5_frac, 4),
            'correct_continue_on_uc': v5_results['correct_continue_on_uc'],
        },
        'diag_samples': v5_results['diag_samples'],
    }

    # ══════════════════════════════════════════════════════════════════
    # TASK F: Surviving Knock Frontier Analysis
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK F: Surviving knock frontier analysis …")
    print("=" * 72)

    v5_knock_spots = []
    v5_continue_spots = []

    for j, spot in enumerate(eval_spots):
        action = v5_results['recommendations'][j]
        if action == 'knock':
            v5_knock_spots.append(spot)
        else:
            v5_continue_spots.append(spot)

    # Analyse knock survivors by DW class
    dw_classes = {}
    for spot in v5_knock_spots:
        dw = spot.hero_deadwood
        if dw not in dw_classes:
            dw_classes[dw] = {'n': 0, 'gin': 0, 'knock_win': 0, 'undercut': 0, 'spots': []}
        dw_classes[dw]['n'] += 1
        dw_classes[dw][spot.outcome] += 1
        dw_classes[dw]['spots'].append(spot)

    print(f"\n  v5 Knock Survivors: {len(v5_knock_spots)}/{n}")
    print(f"  v5 Continue Recommendations: {len(v5_continue_spots)}/{n}")

    print(f"\n  {'DW':>4} {'n':>5} {'Gin':>5} {'Win':>5} {'UC':>5} {'UC Rate':>8} {'Actual Mean OppDW':>18}")
    print(f"  {'-' * 56}")
    for dw in sorted(dw_classes.keys()):
        cls = dw_classes[dw]
        uc_rate = cls['undercut'] / cls['n'] if cls['n'] > 0 else 0
        mean_opp = sum(s.opp_deadwood_after_layoff for s in cls['spots']) / cls['n'] if cls['n'] > 0 else 0
        print(f"  {dw:>4} {cls['n']:>5} {cls['gin']:>5} {cls['knock_win']:>5} "
              f"{cls['undercut']:>5} {uc_rate:>8.1%} {mean_opp:>18.1f}")

    # Classification
    gin_class = sum(1 for s in v5_knock_spots if s.hero_deadwood == 0)
    clinch_class = sum(1 for s in v5_knock_spots if s.hero_deadwood > 0 and
                       (s.my_score + max(1, 10 - s.hero_deadwood)) >= TARGET_SCORE)
    low_dw_class = sum(1 for s in v5_knock_spots if s.hero_deadwood in [1, 2]
                       and (s.my_score + max(1, 10 - s.hero_deadwood)) < TARGET_SCORE)
    other_class = len(v5_knock_spots) - gin_class - clinch_class - low_dw_class

    print(f"\n  Knock Survivor Classification:")
    print(f"    Gin (DW=0):              {gin_class}")
    print(f"    Clinch-adjacent:         {clinch_class}")
    print(f"    Low-DW (DW=1-2, !clinch): {low_dw_class}")
    print(f"    Other:                   {other_class}")

    # Disagreement: v3→v5, v4→v5
    v3_to_v5 = {'knock_to_continue': 0, 'continue_to_knock': 0, 'same': 0}
    v4_to_v5 = {'knock_to_continue': 0, 'continue_to_knock': 0, 'same': 0}
    for j in range(n):
        v3a = v3_results['recommendations'][j]
        v4a = v4_results['recommendations'][j]
        v5a = v5_results['recommendations'][j]

        if v3a == 'knock' and v5a == 'continue':
            v3_to_v5['knock_to_continue'] += 1
        elif v3a == 'continue' and v5a == 'knock':
            v3_to_v5['continue_to_knock'] += 1
        else:
            v3_to_v5['same'] += 1

        if v4a == 'knock' and v5a == 'continue':
            v4_to_v5['knock_to_continue'] += 1
        elif v4a == 'continue' and v5a == 'knock':
            v4_to_v5['continue_to_knock'] += 1
        else:
            v4_to_v5['same'] += 1

    print(f"\n  v3 → v5 Recommendation Changes:")
    print(f"    Same action:        {v3_to_v5['same']}")
    print(f"    knock → continue:   {v3_to_v5['knock_to_continue']}")
    print(f"    continue → knock:   {v3_to_v5['continue_to_knock']}")

    print(f"\n  v4 → v5 Recommendation Changes:")
    print(f"    Same action:        {v4_to_v5['same']}")
    print(f"    knock → continue:   {v4_to_v5['knock_to_continue']}")
    print(f"    continue → knock:   {v4_to_v5['continue_to_knock']}")

    # UC rate among surviving knocks
    v3_knock_list = [eval_spots[j] for j in range(n) if v3_results['recommendations'][j] == 'knock']
    v4_knock_list = [eval_spots[j] for j in range(n) if v4_results['recommendations'][j] == 'knock']

    v3_surv_uc = sum(1 for s in v3_knock_list if s.outcome == 'undercut') / max(1, len(v3_knock_list))
    v4_surv_uc = sum(1 for s in v4_knock_list if s.outcome == 'undercut') / max(1, len(v4_knock_list))
    v5_surv_uc = sum(1 for s in v5_knock_spots if s.outcome == 'undercut') / max(1, len(v5_knock_spots))

    print(f"\n  UC Rate Among Remaining Knock Recommendations:")
    print(f"    v3: {v3_surv_uc:.1%} ({len(v3_knock_list)} knocks)")
    print(f"    v4: {v4_surv_uc:.1%} ({len(v4_knock_list)} knocks)")
    print(f"    v5: {v5_surv_uc:.1%} ({len(v5_knock_spots)} knocks)")

    results['task_f'] = {
        'v5_knock_count': len(v5_knock_spots),
        'v5_continue_count': len(v5_continue_spots),
        'knock_survivor_classification': {
            'gin': gin_class,
            'clinch': clinch_class,
            'low_dw': low_dw_class,
            'other': other_class,
        },
        'v3_to_v5_changes': v3_to_v5,
        'v4_to_v5_changes': v4_to_v5,
        'surviving_uc_rate_v3': round(v3_surv_uc, 4),
        'surviving_uc_rate_v4': round(v4_surv_uc, 4),
        'surviving_uc_rate_v5': round(v5_surv_uc, 4),
        'v5_knock_dw_classes': {
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
        'phase67_results.json'
    )
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n  Saved all results to {output_path}")
    print(f"  Total elapsed: {elapsed:.1f}s")


if __name__ == '__main__':
    main()
