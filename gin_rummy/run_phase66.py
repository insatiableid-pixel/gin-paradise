"""
Phase 66: Belief-Weighted World Generation Sprint

Master runner that executes all tasks:
  A. Build belief-weighted world generator
  B. Build solver v4 on top of it
  C. Calibration comparison: v2 vs v3 vs v4
  D. Opponent deadwood prediction improvement analysis
  E. Surviving knock frontier analysis

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
from gin_rummy.meld import compute_deadwood
from gin_rummy.game import TARGET_SCORE


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


def compute_actual_stats(spots, indices):
    """Compute actual undercut/deadwood statistics for a set of spots."""
    subset = [spots[i] for i in indices]
    n = len(subset)
    if n == 0:
        return {}
    n_uc = sum(1 for s in subset if s.outcome == 'undercut')
    return {
        'n': n,
        'actual_uc_rate': round(n_uc / n, 4),
        'actual_mean_opp_dw': round(sum(s.opp_deadwood_after_layoff for s in subset) / n, 2),
        'actual_mean_hero_dw': round(sum(s.hero_deadwood for s in subset) / n, 2),
    }


def main():
    t0 = time.time()
    results = {}

    # ══════════════════════════════════════════════════════════════════
    # SETUP: Load data and train estimator
    # ══════════════════════════════════════════════════════════════════
    print("=" * 72)
    print("  PHASE 66: Belief-Weighted World Generation Sprint")
    print("=" * 72)

    print("\n  SETUP: Loading dataset and training estimator …")
    spots = load_or_build_dataset()
    estimator, train_spots, test_spots = train_estimator(spots)
    print(f"  Estimator trained on {len(train_spots)} spots")
    print(f"  Test set: {len(test_spots)} spots")

    # Quick estimator eval
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
    # TASK C: Calibration Comparison — v2 vs v3 vs v4
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK C: Calibration comparison v2 vs v3 vs v4 …")
    print("=" * 72)

    # Use a consistent sample for fair comparison
    eval_sample_size = min(150, len(spots))
    eval_spots = random.Random(77).sample(spots, eval_sample_size)

    # Per-solver accumulators
    v2_results = {'knock': 0, 'continue': 0, 'uc_sum': 0, 'opp_dw_sum': 0,
                  'correct_continue_on_uc': 0, 'recommendations': []}
    v3_results = {'knock': 0, 'continue': 0, 'uc_sum': 0, 'opp_dw_sum': 0,
                  'correct_continue_on_uc': 0, 'recommendations': []}
    v4_results = {'knock': 0, 'continue': 0, 'uc_sum': 0, 'opp_dw_sum': 0,
                  'correct_continue_on_uc': 0, 'recommendations': [],
                  'belief_diag_samples': []}

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

        # v2 (Phase 62 baseline — uniform worlds)
        r2 = solve_spot_v2(
            hero_hand=list(spot.hero_hand), public_state=ps,
            n_worlds=100, seed=seed_j,
        )
        v2_results['knock' if r2.recommended_action == 'knock' else 'continue'] += 1
        v2_results['uc_sum'] += r2.knock_now.undercut_rate
        v2_results['recommendations'].append(r2.recommended_action)

        # Compute solver-implied opp DW for v2
        v2_opp_dw_from_worlds = sum(
            o.opp_deadwood for o in r2.knock_now.outcomes
        ) / max(1, len(r2.knock_now.outcomes))
        v2_results['opp_dw_sum'] += v2_opp_dw_from_worlds

        if spot.outcome == 'undercut' and r2.recommended_action == 'continue':
            v2_results['correct_continue_on_uc'] += 1

        # v3 (Phase 65 — uniform worlds + belief reweighting + penalty)
        r3 = solve_spot_v3(
            hero_hand=list(spot.hero_hand), public_state=ps,
            estimator=estimator, n_worlds=100, seed=seed_j,
        )
        v3_results['knock' if r3.recommended_action == 'knock' else 'continue'] += 1
        v3_results['uc_sum'] += (r3.diagnostics.get('estimator_uc_prob', 0) or 0)
        v3_results['recommendations'].append(r3.recommended_action)

        v3_opp_dw_from_worlds = sum(
            o.opp_deadwood for o in r3.knock_now.outcomes
        ) / max(1, len(r3.knock_now.outcomes))
        v3_results['opp_dw_sum'] += v3_opp_dw_from_worlds

        if spot.outcome == 'undercut' and r3.recommended_action == 'continue':
            v3_results['correct_continue_on_uc'] += 1

        # v4 (Phase 66 — belief-weighted worlds + importance weights)
        r4 = solve_spot_v4(
            hero_hand=list(spot.hero_hand), public_state=ps,
            estimator=estimator, n_worlds=100, seed=seed_j,
        )
        v4_results['knock' if r4.recommended_action == 'knock' else 'continue'] += 1
        v4_diag = r4.diagnostics
        v4_results['uc_sum'] += (v4_diag.get('belief_weighted_uc_rate', 0) or 0)
        v4_results['recommendations'].append(r4.recommended_action)

        # v4 world-level opp DW
        v4_opp_dw_from_worlds = sum(
            o.opp_deadwood for o in r4.knock_now.outcomes
        ) / max(1, len(r4.knock_now.outcomes))
        v4_results['opp_dw_sum'] += v4_opp_dw_from_worlds

        if spot.outcome == 'undercut' and r4.recommended_action == 'continue':
            v4_results['correct_continue_on_uc'] += 1

        # Save belief diagnostics for a sample
        if j < 20:
            belief_gen = v4_diag.get('belief_generator', {})
            v4_results['belief_diag_samples'].append({
                'spot_idx': j,
                'hero_dw': spot.hero_deadwood,
                'stock': spot.stock_size,
                'actual_outcome': spot.outcome,
                'actual_opp_dw': spot.opp_deadwood_after_layoff,
                'predicted_mean_opp_dw': belief_gen.get('predicted_mean_opp_dw'),
                'sampled_mean_opp_dw': belief_gen.get('sampled_mean_opp_dw'),
                'sampled_frac_opp_dw_le5': belief_gen.get('sampled_frac_opp_dw_le5'),
                'card_weight_spread': belief_gen.get('card_weight_spread'),
                'v2_action': r2.recommended_action,
                'v3_action': r3.recommended_action,
                'v4_action': r4.recommended_action,
                'v4_uc_rate': v4_diag.get('belief_weighted_uc_rate'),
                'v4_knock_net': v4_diag.get('knock_net_weighted'),
            })

        if (j + 1) % 25 == 0:
            print(f"  … {j+1}/{eval_sample_size}")

    # Print comparison table
    n = eval_sample_size
    actual_uc_rate = sum(1 for s in eval_spots if s.outcome == 'undercut') / n
    actual_mean_opp_dw = sum(s.opp_deadwood_after_layoff for s in eval_spots) / n

    print(f"\n  CALIBRATION COMPARISON ({n} spots)")
    print(f"  {'':30} {'v2 (P62)':>12} {'v3 (P65)':>12} {'v4 (P66)':>12} {'Actual':>12}")
    print(f"  {'-' * 78}")

    v2_mean_uc = v2_results['uc_sum'] / n
    v3_mean_uc = v3_results['uc_sum'] / n
    v4_mean_uc = v4_results['uc_sum'] / n
    print(f"  {'Mean UC rate':30} {v2_mean_uc:12.1%} {v3_mean_uc:12.1%} {v4_mean_uc:12.1%} {actual_uc_rate:12.1%}")

    v2_mean_dw = v2_results['opp_dw_sum'] / n
    v3_mean_dw = v3_results['opp_dw_sum'] / n
    v4_mean_dw = v4_results['opp_dw_sum'] / n
    print(f"  {'Mean opp DW prediction':30} {v2_mean_dw:12.1f} {v3_mean_dw:12.1f} {v4_mean_dw:12.1f} {actual_mean_opp_dw:12.1f}")

    print(f"  {'UC rate bias':30} {v2_mean_uc - actual_uc_rate:+12.1%} {v3_mean_uc - actual_uc_rate:+12.1%} {v4_mean_uc - actual_uc_rate:+12.1%}")
    print(f"  {'Opp DW bias':30} {v2_mean_dw - actual_mean_opp_dw:+12.1f} {v3_mean_dw - actual_mean_opp_dw:+12.1f} {v4_mean_dw - actual_mean_opp_dw:+12.1f}")

    v2_knock_rate = v2_results['knock'] / n
    v3_knock_rate = v3_results['knock'] / n
    v4_knock_rate = v4_results['knock'] / n
    print(f"\n  {'Knock rate':30} {v2_knock_rate:12.1%} {v3_knock_rate:12.1%} {v4_knock_rate:12.1%}")
    print(f"  {'Continue rate':30} {1-v2_knock_rate:12.1%} {1-v3_knock_rate:12.1%} {1-v4_knock_rate:12.1%}")

    if n_undercut_spots > 0:
        v2_cc = v2_results['correct_continue_on_uc']
        v3_cc = v3_results['correct_continue_on_uc']
        v4_cc = v4_results['correct_continue_on_uc']
        print(f"\n  Undercut-Aware Accuracy (on {n_undercut_spots} actual undercut spots):")
        print(f"  {'Correctly says continue':30} {v2_cc:>5}/{n_undercut_spots} ({v2_cc/n_undercut_spots:.1%})"
              f"  {v3_cc:>5}/{n_undercut_spots} ({v3_cc/n_undercut_spots:.1%})"
              f"  {v4_cc:>5}/{n_undercut_spots} ({v4_cc/n_undercut_spots:.1%})")

    results['task_c'] = {
        'n_eval_spots': n,
        'actual_uc_rate': round(actual_uc_rate, 4),
        'actual_mean_opp_dw': round(actual_mean_opp_dw, 2),
        'v2': {
            'knock_rate': round(v2_knock_rate, 4),
            'mean_uc_rate': round(v2_mean_uc, 4),
            'mean_opp_dw': round(v2_mean_dw, 2),
            'uc_bias': round(v2_mean_uc - actual_uc_rate, 4),
            'opp_dw_bias': round(v2_mean_dw - actual_mean_opp_dw, 2),
            'correct_continue_on_uc': v2_results['correct_continue_on_uc'],
        },
        'v3': {
            'knock_rate': round(v3_knock_rate, 4),
            'mean_uc_rate': round(v3_mean_uc, 4),
            'mean_opp_dw': round(v3_mean_dw, 2),
            'uc_bias': round(v3_mean_uc - actual_uc_rate, 4),
            'opp_dw_bias': round(v3_mean_dw - actual_mean_opp_dw, 2),
            'correct_continue_on_uc': v3_results['correct_continue_on_uc'],
        },
        'v4': {
            'knock_rate': round(v4_knock_rate, 4),
            'mean_uc_rate': round(v4_mean_uc, 4),
            'mean_opp_dw': round(v4_mean_dw, 2),
            'uc_bias': round(v4_mean_uc - actual_uc_rate, 4),
            'opp_dw_bias': round(v4_mean_dw - actual_mean_opp_dw, 2),
            'correct_continue_on_uc': v4_results['correct_continue_on_uc'],
        },
        'belief_diag_samples': v4_results['belief_diag_samples'],
    }

    # ══════════════════════════════════════════════════════════════════
    # TASK D: Opponent Deadwood Prediction Quality
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK D: Opponent deadwood prediction quality …")
    print("=" * 72)

    # Analyse world-level opp DW distributions for a smaller sample
    dw_analysis_size = min(50, len(eval_spots))
    dw_spots = eval_spots[:dw_analysis_size]

    v2_dw_errors = []
    v4_dw_errors = []
    v2_dw_abs_errors = []
    v4_dw_abs_errors = []

    for j, spot in enumerate(dw_spots):
        ps = PublicState(
            discard_pile=list(spot.discard_pile),
            turn_number=spot.turn_number,
            stock_size=spot.stock_size,
            my_score=spot.my_score,
            opp_score=spot.opp_score,
        )
        actual_opp_dw = spot.opp_deadwood_after_layoff

        # v2 worlds
        rng2 = random.Random(42 + j)
        worlds2 = generate_hidden_worlds(
            hero_hand=list(spot.hero_hand), public_state=ps,
            n_worlds=100, rng=rng2,
        )
        if worlds2:
            v2_mean_world_dw = sum(compute_deadwood(opp) for opp, _ in worlds2) / len(worlds2)
            v2_dw_errors.append(v2_mean_world_dw - actual_opp_dw)
            v2_dw_abs_errors.append(abs(v2_mean_world_dw - actual_opp_dw))

        # v4 worlds
        from gin_rummy.belief_world_generator import generate_worlds_with_estimator
        rng4 = random.Random(42 + j)
        worlds4, weights4, diag4 = generate_worlds_with_estimator(
            hero_hand=list(spot.hero_hand),
            discard_pile=list(spot.discard_pile),
            stock_size=spot.stock_size,
            turn_number=spot.turn_number,
            my_score=spot.my_score,
            opp_score=spot.opp_score,
            estimator=estimator,
            n_worlds=100,
            rng=rng4,
        )
        if worlds4:
            v4_mean_world_dw = sum(compute_deadwood(opp) for opp, _ in worlds4) / len(worlds4)
            v4_dw_errors.append(v4_mean_world_dw - actual_opp_dw)
            v4_dw_abs_errors.append(abs(v4_mean_world_dw - actual_opp_dw))

    if v2_dw_errors and v4_dw_errors:
        v2_mae = sum(v2_dw_abs_errors) / len(v2_dw_abs_errors)
        v4_mae = sum(v4_dw_abs_errors) / len(v4_dw_abs_errors)
        v2_bias = sum(v2_dw_errors) / len(v2_dw_errors)
        v4_bias = sum(v4_dw_errors) / len(v4_dw_errors)

        print(f"\n  Opponent Deadwood Prediction ({dw_analysis_size} spots):")
        print(f"  {'':30} {'v2 (uniform)':>14} {'v4 (belief)':>14}")
        print(f"  {'-' * 60}")
        print(f"  {'Mean Absolute Error':30} {v2_mae:14.1f} {v4_mae:14.1f}")
        print(f"  {'Mean Bias (predicted-actual)':30} {v2_bias:+14.1f} {v4_bias:+14.1f}")
        print(f"  {'MAE Improvement':30} {'':14} {(v2_mae - v4_mae):+14.1f}")

        results['task_d'] = {
            'n_spots': dw_analysis_size,
            'v2_mae': round(v2_mae, 2),
            'v4_mae': round(v4_mae, 2),
            'v2_bias': round(v2_bias, 2),
            'v4_bias': round(v4_bias, 2),
            'mae_improvement': round(v2_mae - v4_mae, 2),
        }

    # ══════════════════════════════════════════════════════════════════
    # TASK E: Surviving Knock Frontier Analysis
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK E: Surviving knock frontier analysis …")
    print("=" * 72)

    # Classify v4's surviving knock recommendations
    v4_knock_spots = []
    v4_continue_spots = []

    for j, spot in enumerate(eval_spots):
        action = v4_results['recommendations'][j]
        if action == 'knock':
            v4_knock_spots.append(spot)
        else:
            v4_continue_spots.append(spot)

    # Analyse knock survivors by DW class
    dw_classes = {}
    for spot in v4_knock_spots:
        dw = spot.hero_deadwood
        if dw not in dw_classes:
            dw_classes[dw] = {'n': 0, 'gin': 0, 'knock_win': 0, 'undercut': 0, 'spots': []}
        dw_classes[dw]['n'] += 1
        dw_classes[dw][spot.outcome] += 1
        dw_classes[dw]['spots'].append(spot)

    print(f"\n  v4 Knock Survivors: {len(v4_knock_spots)}/{n}")
    print(f"  v4 Continue Recommendations: {len(v4_continue_spots)}/{n}")

    print(f"\n  {'DW':>4} {'n':>5} {'Gin':>5} {'Win':>5} {'UC':>5} {'UC Rate':>8} {'Actual Mean OppDW':>18}")
    print(f"  {'-' * 56}")
    for dw in sorted(dw_classes.keys()):
        cls = dw_classes[dw]
        uc_rate = cls['undercut'] / cls['n'] if cls['n'] > 0 else 0
        mean_opp = sum(s.opp_deadwood_after_layoff for s in cls['spots']) / cls['n'] if cls['n'] > 0 else 0
        print(f"  {dw:>4} {cls['n']:>5} {cls['gin']:>5} {cls['knock_win']:>5} "
              f"{cls['undercut']:>5} {uc_rate:>8.1%} {mean_opp:>18.1f}")

    # Classify surviving knocks
    gin_class = sum(1 for s in v4_knock_spots if s.hero_deadwood == 0)
    clinch_class = sum(1 for s in v4_knock_spots if s.hero_deadwood > 0 and
                       (s.my_score + max(1, 10 - s.hero_deadwood)) >= TARGET_SCORE)
    low_dw_class = sum(1 for s in v4_knock_spots if s.hero_deadwood in [1, 2]
                       and (s.my_score + max(1, 10 - s.hero_deadwood)) < TARGET_SCORE)
    other_class = len(v4_knock_spots) - gin_class - clinch_class - low_dw_class

    print(f"\n  Knock Survivor Classification:")
    print(f"    Gin (DW=0):              {gin_class}")
    print(f"    Clinch-adjacent:         {clinch_class}")
    print(f"    Low-DW (DW=1-2, !clinch): {low_dw_class}")
    print(f"    Other:                   {other_class}")

    # Disagreement analysis v3 vs v4
    v3_to_v4_changes = {'knock_to_continue': 0, 'continue_to_knock': 0, 'same': 0}
    for j in range(len(eval_spots)):
        v3_act = v3_results['recommendations'][j]
        v4_act = v4_results['recommendations'][j]
        if v3_act == 'knock' and v4_act == 'continue':
            v3_to_v4_changes['knock_to_continue'] += 1
        elif v3_act == 'continue' and v4_act == 'knock':
            v3_to_v4_changes['continue_to_knock'] += 1
        else:
            v3_to_v4_changes['same'] += 1

    print(f"\n  v3 -> v4 Recommendation Changes:")
    print(f"    Same action:      {v3_to_v4_changes['same']}")
    print(f"    knock -> continue: {v3_to_v4_changes['knock_to_continue']}")
    print(f"    continue -> knock: {v3_to_v4_changes['continue_to_knock']}")

    # Actual UC rate of remaining knock spots
    if v4_knock_spots:
        surviving_uc_rate = sum(1 for s in v4_knock_spots if s.outcome == 'undercut') / len(v4_knock_spots)
        surviving_mean_opp_dw = sum(s.opp_deadwood_after_layoff for s in v4_knock_spots) / len(v4_knock_spots)
    else:
        surviving_uc_rate = 0
        surviving_mean_opp_dw = 0

    # Same for v2 and v3
    v2_knock_spots_list = [eval_spots[j] for j in range(n) if v2_results['recommendations'][j] == 'knock']
    v3_knock_spots_list = [eval_spots[j] for j in range(n) if v3_results['recommendations'][j] == 'knock']

    if v2_knock_spots_list:
        v2_surviving_uc = sum(1 for s in v2_knock_spots_list if s.outcome == 'undercut') / len(v2_knock_spots_list)
    else:
        v2_surviving_uc = 0
    if v3_knock_spots_list:
        v3_surviving_uc = sum(1 for s in v3_knock_spots_list if s.outcome == 'undercut') / len(v3_knock_spots_list)
    else:
        v3_surviving_uc = 0

    print(f"\n  UC Rate Among Remaining Knock Recommendations:")
    print(f"    v2: {v2_surviving_uc:.1%} ({len(v2_knock_spots_list)} knocks)")
    print(f"    v3: {v3_surviving_uc:.1%} ({len(v3_knock_spots_list)} knocks)")
    print(f"    v4: {surviving_uc_rate:.1%} ({len(v4_knock_spots)} knocks)")

    results['task_e'] = {
        'v4_knock_count': len(v4_knock_spots),
        'v4_continue_count': len(v4_continue_spots),
        'v4_knock_dw_classes': {
            str(dw): {'n': cls['n'], 'gin': cls['gin'], 'knock_win': cls['knock_win'],
                      'undercut': cls['undercut']}
            for dw, cls in dw_classes.items()
        },
        'knock_survivor_classification': {
            'gin': gin_class,
            'clinch': clinch_class,
            'low_dw': low_dw_class,
            'other': other_class,
        },
        'v3_to_v4_changes': v3_to_v4_changes,
        'surviving_uc_rate_v2': round(v2_surviving_uc, 4),
        'surviving_uc_rate_v3': round(v3_surviving_uc, 4),
        'surviving_uc_rate_v4': round(surviving_uc_rate, 4),
        'surviving_mean_opp_dw': round(surviving_mean_opp_dw, 2),
    }

    # ══════════════════════════════════════════════════════════════════
    # SAVE RESULTS
    # ══════════════════════════════════════════════════════════════════
    elapsed = time.time() - t0
    results['elapsed_seconds'] = round(elapsed, 1)

    output_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'phase66_results.json'
    )
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n  Saved all results to {output_path}")
    print(f"  Total elapsed: {elapsed:.1f}s")


if __name__ == '__main__':
    main()
