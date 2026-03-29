"""
Phase 65: Undercut-Aware Belief Calibration Sprint

Master runner that executes all five tasks:
  A. Build low-stock undercut dataset
  B. Measure current solver calibration
  C. Train undercut-risk estimator
  D. Integrate into solver v3
  E. Re-run calibration spots (before vs after)

Lightweight execution — no heavy benchmark, just solver calibration work.
"""

import json
import time
import random
import sys
import os

# Ensure project root is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gin_rummy.undercut_dataset import (
    build_undercut_dataset, save_dataset, dataset_summary
)
from gin_rummy.undercut_estimator import (
    calibration_audit, compute_solver_implied_undercut,
    UndercutRiskEstimator, evaluate_estimator, feature_importance,
    BUCKET_LABELS
)
from gin_rummy.endgame_solver import PublicState
from gin_rummy.solver_v2 import solve_spot_v2, CONTINUATION_CHAMPION
from gin_rummy.solver_v3 import solve_spot_v3


def main():
    t0 = time.time()
    results = {}

    # ══════════════════════════════════════════════════════════════════
    # TASK A: Build Low-Stock Undercut Dataset
    # ══════════════════════════════════════════════════════════════════
    print("=" * 72)
    print("  TASK A: Building low-stock undercut dataset …")
    print("=" * 72)

    spots = build_undercut_dataset(n_games=500, max_stock=6, verbose=True)
    summary_a = dataset_summary(spots)

    print(f"\n  Dataset Summary:")
    print(f"    Total spots: {summary_a['n']}")
    print(f"    Undercut rate: {summary_a['undercut_rate']:.1%}")
    print(f"    Gin rate: {summary_a['gin_rate']:.1%}")
    print(f"    Knock-win rate: {summary_a['knock_win_rate']:.1%}")
    print(f"    Mean opp DW after layoff: {summary_a['mean_opp_dw_after_layoff']:.1f}")
    print(f"    DW buckets: {summary_a['dw_buckets']}")
    print(f"    Stock buckets: {summary_a['stock_buckets']}")

    results['task_a'] = summary_a

    # Save dataset
    save_dataset(spots, 'phase65_undercut_dataset.json')
    print(f"  Saved {len(spots)} spots to phase65_undercut_dataset.json")

    # ══════════════════════════════════════════════════════════════════
    # TASK B: Measure Current Solver Calibration
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK B: Measuring current solver calibration …")
    print("=" * 72)

    # Ground-truth audit from dataset
    audit = calibration_audit(spots)
    print(f"\n  Ground-Truth Calibration Audit:")
    print(f"    Overall undercut rate: {audit['overall'].get('actual_undercut_rate', 'N/A')}")
    print(f"    Mean opp DW (raw): {audit['overall'].get('mean_opp_dw_raw', 'N/A')}")
    print(f"    Mean opp DW (after layoff): {audit['overall'].get('mean_opp_dw_after_layoff', 'N/A')}")

    print(f"\n  By Stock Size:")
    for stock, data in sorted(audit['by_stock'].items()):
        print(f"    stock={stock}: n={data['n']}, UC rate={data['undercut_rate']:.1%}, "
              f"mean_opp_dw={data['mean_opp_dw']:.1f}")

    print(f"\n  By Hero DW:")
    for dw, data in sorted(audit['by_hero_dw'].items()):
        print(f"    DW={dw}: n={data['n']}, UC rate={data['undercut_rate']:.1%}, "
              f"mean_opp_dw={data['mean_opp_dw']:.1f}")

    print(f"\n  By Opp DW Bucket (ground truth):")
    for label, data in audit['by_opp_dw_bucket'].items():
        print(f"    {label}: n={data['n']}, fraction={data['fraction']:.1%}, "
              f"UC rate={data['undercut_rate']:.1%}")

    results['task_b_audit'] = audit

    # Solver-implied calibration (sample for speed)
    sample_size = min(200, len(spots))
    sample_spots = random.Random(42).sample(spots, sample_size)
    print(f"\n  Computing solver-implied undercut rates ({sample_size} spots, 100 worlds each) …")
    solver_cal = compute_solver_implied_undercut(sample_spots, n_worlds=100, seed=42)

    print(f"\n  Solver Calibration vs Ground Truth:")
    print(f"    Actual undercut rate:        {solver_cal['actual_undercut_rate']:.1%}")
    print(f"    Solver-implied undercut rate: {solver_cal['solver_implied_undercut_rate']:.1%}")
    print(f"    Undercut bias (solver-actual): {solver_cal['undercut_bias']:+.4f}")
    print(f"    Actual mean opp DW:          {solver_cal['actual_mean_opp_dw']:.1f}")
    print(f"    Solver-implied mean opp DW:  {solver_cal['solver_mean_opp_dw']:.1f}")
    print(f"    Opp DW bias:                 {solver_cal['opp_dw_bias']:+.1f}")

    if 'calibration_by_predicted_bucket' in solver_cal:
        print(f"\n  Calibration by Solver-Predicted UC Bucket:")
        for label, data in solver_cal['calibration_by_predicted_bucket'].items():
            print(f"    {label}: n={data['n']}, predicted={data['solver_predicted']:.1%}, "
                  f"actual={data['actual_rate']:.1%}, bias={data['bias']:+.4f}")

    results['task_b_solver_cal'] = solver_cal

    # ══════════════════════════════════════════════════════════════════
    # TASK C: Train Undercut-Risk Estimator
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK C: Training undercut-risk estimator …")
    print("=" * 72)

    # 80/20 train/test split
    rng_split = random.Random(123)
    shuffled = list(spots)
    rng_split.shuffle(shuffled)
    split_idx = int(len(shuffled) * 0.8)
    train_spots = shuffled[:split_idx]
    test_spots = shuffled[split_idx:]
    print(f"  Train: {len(train_spots)} spots, Test: {len(test_spots)} spots")

    estimator = UndercutRiskEstimator()
    estimator.train(train_spots, lr=0.01, epochs=300, verbose=True)

    # Evaluate on held-out test set
    eval_result = evaluate_estimator(estimator, test_spots)
    print(f"\n  Test-Set Evaluation:")
    print(f"    UC accuracy:     {eval_result['uc_accuracy']:.1%}")
    print(f"    UC AUC:          {eval_result['uc_auc']}")
    print(f"    UC Brier score:  {eval_result['uc_brier_score']:.4f}")
    print(f"    UC log loss:     {eval_result['uc_log_loss']:.4f}")
    print(f"    Opp DW MAE:      {eval_result['opp_dw_mae']:.1f}")
    print(f"    Actual UC rate:  {eval_result['actual_undercut_rate']:.1%}")
    print(f"    Predicted UC rate: {eval_result['predicted_undercut_rate']:.1%}")

    print(f"\n  Calibration by Predicted Bucket:")
    for label, data in eval_result.get('calibration_buckets', {}).items():
        print(f"    {label}: n={data['n']}, predicted={data['predicted']:.1%}, "
              f"actual={data['actual']:.1%}, bias={data['bias']:+.4f}")

    # Feature importance
    fi = feature_importance(estimator)
    print(f"\n  Top Feature Importance (UC model):")
    for name, imp in fi[:10]:
        print(f"    {name:<30} {imp:.4f}")

    results['task_c'] = eval_result
    results['task_c_feature_importance'] = [(n, round(i, 4)) for n, i in fi[:10]]

    # ══════════════════════════════════════════════════════════════════
    # TASK D: Show Integration Works (Solver v3 smoke test)
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK D: Solver v3 integration smoke test …")
    print("=" * 72)

    # Pick 5 representative spots and compare v2 vs v3
    demo_spots = sample_spots[:5]
    v2_v3_comparison = []

    for i, spot in enumerate(demo_spots):
        ps = PublicState(
            discard_pile=list(spot.discard_pile),
            turn_number=spot.turn_number,
            stock_size=spot.stock_size,
            my_score=spot.my_score,
            opp_score=spot.opp_score,
        )

        # v2 (baseline)
        r2 = solve_spot_v2(
            hero_hand=list(spot.hero_hand),
            public_state=ps,
            n_worlds=100,
            seed=42 + i,
        )

        # v3 (with estimator)
        r3 = solve_spot_v3(
            hero_hand=list(spot.hero_hand),
            public_state=ps,
            estimator=estimator,
            n_worlds=100,
            seed=42 + i,
        )

        comp = {
            'spot_idx': i,
            'hero_dw': spot.hero_deadwood,
            'stock': spot.stock_size,
            'actual_outcome': spot.outcome,
            'v2_action': r2.recommended_action,
            'v2_confidence': round(r2.confidence, 3),
            'v2_knock_net': round(r2.knock_now.net_expected_points, 2),
            'v2_cont_net': round(r2.continue_play.net_expected_points, 2),
            'v2_uc_rate': round(r2.knock_now.undercut_rate, 4),
            'v3_action': r3.recommended_action,
            'v3_confidence': round(r3.confidence, 3),
            'v3_knock_net_weighted': round(r3.diagnostics.get('knock_net_weighted', 0), 2),
            'v3_cont_net': round(r3.continue_play.net_expected_points, 2),
            'v3_uc_rate_weighted': round(r3.diagnostics.get('weighted_uc_rate', 0), 4),
            'v3_estimator_uc': round(r3.diagnostics.get('estimator_uc_prob', 0.0) or 0.0, 4),
            'v3_correction': round(r3.diagnostics.get('undercut_correction', 0), 2),
        }
        v2_v3_comparison.append(comp)

        action_changed = '→ CHANGED' if r2.recommended_action != r3.recommended_action else ''
        print(f"\n  Spot {i}: DW={spot.hero_deadwood}, stock={spot.stock_size}, "
              f"actual={spot.outcome}")
        print(f"    v2: {r2.recommended_action} (conf={r2.confidence:.3f}, "
              f"knock_net={r2.knock_now.net_expected_points:+.2f}, "
              f"uc_rate={r2.knock_now.undercut_rate:.1%})")
        print(f"    v3: {r3.recommended_action} (conf={r3.confidence:.3f}, "
              f"knock_net_w={r3.diagnostics.get('knock_net_weighted', 0):+.2f}, "
              f"est_uc={r3.diagnostics.get('estimator_uc_prob', 0):.1%}, "
              f"correction={r3.diagnostics.get('undercut_correction', 0):+.2f}) "
              f"{action_changed}")

    results['task_d'] = v2_v3_comparison

    # ══════════════════════════════════════════════════════════════════
    # TASK E: Re-run Calibration Spots (Before vs After)
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 72)
    print("  TASK E: Before/after solver calibration comparison …")
    print("=" * 72)

    # Run v2 and v3 on a larger sample to compare disagreement rates
    eval_sample_size = min(100, len(spots))
    eval_spots = random.Random(99).sample(spots, eval_sample_size)

    v2_actions = {'knock': 0, 'continue': 0}
    v3_actions = {'knock': 0, 'continue': 0}
    v2_correct_continue = 0   # correctly recommended continue when undercut would happen
    v3_correct_continue = 0
    disagreements = 0
    v2_total_uc_rate = 0
    v3_total_uc_rate_est = 0

    for j, spot in enumerate(eval_spots):
        ps = PublicState(
            discard_pile=list(spot.discard_pile),
            turn_number=spot.turn_number,
            stock_size=spot.stock_size,
            my_score=spot.my_score,
            opp_score=spot.opp_score,
        )

        r2 = solve_spot_v2(
            hero_hand=list(spot.hero_hand), public_state=ps,
            n_worlds=100, seed=42 + j,
        )
        r3 = solve_spot_v3(
            hero_hand=list(spot.hero_hand), public_state=ps,
            estimator=estimator, n_worlds=100, seed=42 + j,
        )

        v2_actions[r2.recommended_action] += 1
        v3_actions[r3.recommended_action] += 1
        v2_total_uc_rate += r2.knock_now.undercut_rate
        v3_total_uc_rate_est += (r3.diagnostics.get('estimator_uc_prob', 0) or 0)

        if r2.recommended_action != r3.recommended_action:
            disagreements += 1

        if spot.outcome == 'undercut':
            if r2.recommended_action == 'continue':
                v2_correct_continue += 1
            if r3.recommended_action == 'continue':
                v3_correct_continue += 1

        if (j + 1) % 25 == 0:
            print(f"  … {j+1}/{eval_sample_size}")

    n_undercut_spots = sum(1 for s in eval_spots if s.outcome == 'undercut')

    print(f"\n  Evaluation on {eval_sample_size} spots:")
    print(f"    v2 knock / continue: {v2_actions['knock']} / {v2_actions['continue']}")
    print(f"    v3 knock / continue: {v3_actions['knock']} / {v3_actions['continue']}")
    print(f"    Disagreements (v2 vs v3): {disagreements} ({disagreements/eval_sample_size:.1%})")
    print(f"    v2 knock rate: {v2_actions['knock']/eval_sample_size:.1%}")
    print(f"    v3 knock rate: {v3_actions['knock']/eval_sample_size:.1%}")
    print(f"    Mean v2 UC rate (uniform): {v2_total_uc_rate/eval_sample_size:.1%}")
    print(f"    Mean v3 estimator UC prob: {v3_total_uc_rate_est/eval_sample_size:.1%}")

    if n_undercut_spots > 0:
        print(f"\n  Undercut-Aware Accuracy (on {n_undercut_spots} actual undercut spots):")
        print(f"    v2 correctly says continue: {v2_correct_continue}/{n_undercut_spots} "
              f"({v2_correct_continue/n_undercut_spots:.1%})")
        print(f"    v3 correctly says continue: {v3_correct_continue}/{n_undercut_spots} "
              f"({v3_correct_continue/n_undercut_spots:.1%})")

    results['task_e'] = {
        'n_eval_spots': eval_sample_size,
        'v2_actions': v2_actions,
        'v3_actions': v3_actions,
        'disagreements': disagreements,
        'disagreement_rate': round(disagreements / eval_sample_size, 4),
        'n_undercut_spots': n_undercut_spots,
        'v2_correct_continue_on_undercut': v2_correct_continue,
        'v3_correct_continue_on_undercut': v3_correct_continue,
        'mean_v2_uc_rate': round(v2_total_uc_rate / eval_sample_size, 4),
        'mean_v3_estimator_uc': round(v3_total_uc_rate_est / eval_sample_size, 4),
    }

    # ══════════════════════════════════════════════════════════════════
    # SAVE RESULTS
    # ══════════════════════════════════════════════════════════════════
    elapsed = time.time() - t0
    results['elapsed_seconds'] = round(elapsed, 1)

    with open('phase65_results.json', 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n  Saved all results to phase65_results.json")
    print(f"  Total elapsed: {elapsed:.1f}s")


if __name__ == '__main__':
    main()
