"""
Evaluate knock action model against offline baselines.

Compares:
  1. Learned MLP model
  2. AlwaysKnock baseline (trivial)
  3. GoGin baseline (only knock on gin)
  4. ApexKnock baseline (mirrors Apex's knock rules)
  5. PaperInspired baseline (liveness-aware)

On held-out knock decisions, reports:
  - Decision accuracy
  - AUC / Brier score
  - Regret (avg missed points on wrong decisions)
  - Calibration (reliability plot data)
  - Breakdown by:
    - Gin liveness bucket
    - Turn bucket
    - Score state bucket
    - DW range bucket

Usage:
  python evaluate_knock_model.py [--data PATH] [--model PATH]
"""

import argparse
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from gin_rummy.knock_action_model import (
    LearnedKnockModel, AlwaysKnockBaseline, GoGinBaseline,
    ApexKnockBaseline, PaperInspiredBaseline,
    IDX_DW_TOTAL, IDX_IS_GIN, IDX_GIN_RATING, IDX_TURN,
    IDX_SCORE_DIFF, IDX_UNDERCUT_RISK, IDX_FEW_DW,
    IDX_SAFE_ZONE, IDX_RISKY_ZONE
)
from gin_rummy.knock_features import KNOCK_FEATURE_DIM, get_knock_feature_names


def evaluate_model(name, y_true, y_proba, deltas):
    """Compute comprehensive metrics for a model."""
    from sklearn.metrics import accuracy_score, roc_auc_score, brier_score_loss, log_loss

    y_pred = (y_proba > 0.5).astype(np.float32)
    acc = accuracy_score(y_true, y_pred)

    try:
        auc = roc_auc_score(y_true, y_proba)
    except ValueError:
        auc = 0.5

    brier = brier_score_loss(y_true, y_proba)

    y_proba_clamped = np.clip(y_proba, 1e-7, 1 - 1e-7)
    ll = log_loss(y_true, y_proba_clamped)

    # Regret analysis
    correct_mask = y_pred == y_true
    wrong_mask = ~correct_mask

    avg_regret = float(np.mean(np.abs(deltas[wrong_mask]))) if wrong_mask.sum() > 0 else 0.0
    avg_delta_correct = float(np.mean(np.abs(deltas[correct_mask]))) if correct_mask.sum() > 0 else 0.0

    # Breakdown by true label
    knock_mask = y_true == 1.0
    cont_mask = y_true == 0.0
    knock_acc = float(np.mean(y_pred[knock_mask] == y_true[knock_mask])) if knock_mask.sum() > 0 else 0.0
    cont_acc = float(np.mean(y_pred[cont_mask] == y_true[cont_mask])) if cont_mask.sum() > 0 else 0.0

    avg_prob_knock = float(np.mean(y_proba[knock_mask])) if knock_mask.sum() > 0 else 0.0
    avg_prob_cont = float(np.mean(y_proba[cont_mask])) if cont_mask.sum() > 0 else 0.0

    return {
        'name': name,
        'accuracy': round(acc, 4),
        'auc': round(auc, 4),
        'brier': round(brier, 4),
        'log_loss': round(ll, 4),
        'avg_regret_wrong': round(avg_regret, 4),
        'avg_delta_correct': round(avg_delta_correct, 4),
        'knock_accuracy': round(knock_acc, 4),
        'continue_accuracy': round(cont_acc, 4),
        'knock_count': int(knock_mask.sum()),
        'continue_count': int(cont_mask.sum()),
        'avg_prob_when_knock': round(avg_prob_knock, 4),
        'avg_prob_when_continue': round(avg_prob_cont, 4),
        'wrong_count': int(wrong_mask.sum()),
        'correct_count': int(correct_mask.sum()),
    }


def _bucket_breakdown(name, y_true, y_proba, deltas, X_test, bucket_idx, bucket_name, bucket_edges):
    """Compute accuracy breakdown by feature bucket."""
    y_pred = (y_proba > 0.5).astype(np.float32)
    breakdown = []
    values = X_test[:, bucket_idx]

    for i in range(len(bucket_edges) - 1):
        lo, hi = bucket_edges[i], bucket_edges[i + 1]
        mask = (values >= lo) & (values < hi)
        if mask.sum() == 0:
            continue
        acc = float(np.mean(y_pred[mask] == y_true[mask]))
        avg_regret = float(np.mean(np.abs(deltas[mask & (y_pred != y_true)]))) \
            if (mask & (y_pred != y_true)).sum() > 0 else 0.0
        breakdown.append({
            'bucket': f"{bucket_name}[{lo:.2f},{hi:.2f})",
            'count': int(mask.sum()),
            'accuracy': round(acc, 4),
            'avg_regret': round(avg_regret, 4),
            'knock_better_rate': round(float(np.mean(y_true[mask])), 4),
        })
    return breakdown


def _calibration_data(y_true, y_proba, n_bins=10):
    """Compute calibration bin data."""
    bins = np.linspace(0, 1, n_bins + 1)
    cal = []
    for i in range(n_bins):
        mask = (y_proba >= bins[i]) & (y_proba < bins[i + 1])
        if mask.sum() > 0:
            cal.append({
                'bin_start': round(float(bins[i]), 2),
                'bin_end': round(float(bins[i + 1]), 2),
                'mean_predicted': round(float(np.mean(y_proba[mask])), 4),
                'mean_actual': round(float(np.mean(y_true[mask])), 4),
                'count': int(mask.sum()),
            })
    return cal


def main():
    parser = argparse.ArgumentParser(description="Evaluate knock action model vs baselines")
    parser.add_argument("--data", type=str, default=None)
    parser.add_argument("--model", type=str, default=None)
    parser.add_argument("--output", type=str, default=None)
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.abspath(__file__))
    data_path = args.data or os.path.join(project_root, "models", "knock_action_data.npz")
    model_path = args.model or os.path.join(project_root, "models", "knock_action_model.pkl")
    output_path = args.output or os.path.join(project_root, "models", "knock_action_evaluation.json")

    print("=" * 70)
    print("  KNOCK ACTION MODEL EVALUATION")
    print("=" * 70)
    print(f"  Data:   {data_path}")
    print(f"  Model:  {model_path}")
    print("=" * 70)

    # Load data
    data = np.load(data_path, allow_pickle=True)
    X = data['X']
    deltas = data['point_deltas']
    labels = data['knock_better']

    # Use 20% split as test set (same split as training)
    from sklearn.model_selection import train_test_split
    _, X_test, _, y_test, _, delta_test = train_test_split(
        X, labels, deltas, test_size=0.2, random_state=42, stratify=labels
    )

    print(f"  Test samples: {len(X_test):,}")
    print(f"  Knock-better rate (test): {np.mean(y_test):.3f}")
    print()

    # Models to compare
    models = {
        'always_knock': AlwaysKnockBaseline().predict_proba,
        'go_gin': GoGinBaseline().predict_proba,
        'apex_knock': ApexKnockBaseline().predict_proba,
        'paper_inspired': PaperInspiredBaseline().predict_proba,
    }

    # Add learned model if available
    if os.path.exists(model_path):
        learned = LearnedKnockModel.load(model_path)
        models['learned_mlp'] = learned.predict_proba
    else:
        print(f"  WARNING: No learned model found at {model_path}")
        print()

    # Evaluate all
    results = {}
    for name, predict_fn in models.items():
        y_proba = predict_fn(X_test)
        metrics = evaluate_model(name, y_test, y_proba, delta_test)
        results[name] = metrics

    # Print comparison table
    print(f"  {'Model':<22} {'Accuracy':>10} {'AUC':>8} {'Brier':>8} {'LogLoss':>10} {'Regret':>10}")
    print("  " + "-" * 68)
    for name, m in sorted(results.items(), key=lambda x: -x[1]['accuracy']):
        print(f"  {m['name']:<22} {m['accuracy']:>10.4f} {m['auc']:>8.4f} "
              f"{m['brier']:>8.4f} {m['log_loss']:>10.4f} {m['avg_regret_wrong']:>10.4f}")

    print()

    # Detail breakdown for top models
    for name in ['learned_mlp', 'apex_knock', 'paper_inspired', 'always_knock']:
        if name in results:
            m = results[name]
            print(f"  {m['name']}:")
            print(f"    Knock accuracy:    {m['knock_accuracy']:.4f} ({m['knock_count']} samples)")
            print(f"    Continue accuracy: {m['continue_accuracy']:.4f} ({m['continue_count']} samples)")
            print(f"    Avg P(knock) when knock: {m['avg_prob_when_knock']:.4f}")
            print(f"    Avg P(knock) when cont:  {m['avg_prob_when_continue']:.4f}")
            print()

    # Bucket breakdowns for learned model
    if 'learned_mlp' in models:
        y_proba_learned = models['learned_mlp'](X_test)

        # Gin liveness breakdown
        print("  --- Breakdown by Gin Liveness (learned_mlp) ---")
        gin_bd = _bucket_breakdown(
            'learned_mlp', y_test, y_proba_learned, delta_test, X_test,
            IDX_GIN_RATING, 'gin_rating', [0.0, 0.2, 0.4, 0.6, 0.8, 1.01]
        )
        for b in gin_bd:
            print(f"    {b['bucket']:<28} acc={b['accuracy']:.4f} n={b['count']:>5} "
                  f"knock_rate={b['knock_better_rate']:.3f} regret={b['avg_regret']:.4f}")
        results['breakdown_gin_liveness'] = gin_bd
        print()

        # Turn breakdown
        print("  --- Breakdown by Turn (learned_mlp) ---")
        turn_bd = _bucket_breakdown(
            'learned_mlp', y_test, y_proba_learned, delta_test, X_test,
            IDX_TURN, 'turn', [0.0, 0.1, 0.2, 0.33, 0.5, 1.01]
        )
        for b in turn_bd:
            print(f"    {b['bucket']:<28} acc={b['accuracy']:.4f} n={b['count']:>5} "
                  f"knock_rate={b['knock_better_rate']:.3f} regret={b['avg_regret']:.4f}")
        results['breakdown_turn'] = turn_bd
        print()

        # Score diff breakdown
        print("  --- Breakdown by Score Diff (learned_mlp) ---")
        score_bd = _bucket_breakdown(
            'learned_mlp', y_test, y_proba_learned, delta_test, X_test,
            IDX_SCORE_DIFF, 'score_diff', [-1.01, -0.3, -0.1, 0.1, 0.3, 1.01]
        )
        for b in score_bd:
            print(f"    {b['bucket']:<28} acc={b['accuracy']:.4f} n={b['count']:>5} "
                  f"knock_rate={b['knock_better_rate']:.3f} regret={b['avg_regret']:.4f}")
        results['breakdown_score'] = score_bd
        print()

        # DW range breakdown
        print("  --- Breakdown by Deadwood (learned_mlp) ---")
        dw_bd = _bucket_breakdown(
            'learned_mlp', y_test, y_proba_learned, delta_test, X_test,
            IDX_DW_TOTAL, 'deadwood', [0.0, 0.05, 0.3, 0.5, 0.8, 1.01]
        )
        for b in dw_bd:
            print(f"    {b['bucket']:<28} acc={b['accuracy']:.4f} n={b['count']:>5} "
                  f"knock_rate={b['knock_better_rate']:.3f} regret={b['avg_regret']:.4f}")
        results['breakdown_deadwood'] = dw_bd
        print()

        # Calibration
        print("  Calibration (learned_mlp):")
        cal = _calibration_data(y_test, y_proba_learned)
        for bin_data in cal:
            bar = "#" * int(bin_data['count'] / max(1, len(X_test) / 50))
            print(f"    [{bin_data['bin_start']:.1f}-{bin_data['bin_end']:.1f}] "
                  f"pred={bin_data['mean_predicted']:.3f} "
                  f"actual={bin_data['mean_actual']:.3f} "
                  f"n={bin_data['count']:>5} {bar}")
        print()
        results['calibration'] = cal

    # Decision: does the learned model beat baselines?
    if 'learned_mlp' in results:
        learned_acc = results['learned_mlp']['accuracy']
        apex_acc = results['apex_knock']['accuracy']
        paper_acc = results['paper_inspired']['accuracy']
        always_acc = results['always_knock']['accuracy']
        best_baseline_name = max(
            ['apex_knock', 'paper_inspired', 'always_knock'],
            key=lambda n: results[n]['accuracy']
        )
        best_baseline_acc = results[best_baseline_name]['accuracy']

        learned_auc = results['learned_mlp']['auc']
        best_baseline_auc = max(
            results[n]['auc'] for n in ['apex_knock', 'paper_inspired', 'always_knock']
        )

        print("  === DECISION SUMMARY ===")
        print(f"  Learned accuracy:      {learned_acc:.4f}")
        print(f"  Best baseline accuracy: {best_baseline_acc:.4f} ({best_baseline_name})")
        print(f"  Accuracy edge:         {learned_acc - best_baseline_acc:+.4f}")
        print(f"  Learned AUC:           {learned_auc:.4f}")
        print(f"  Best baseline AUC:     {best_baseline_auc:.4f}")
        print(f"  AUC edge:              {learned_auc - best_baseline_auc:+.4f}")
        print()
        print(f"  Apex knock accuracy:     {apex_acc:.4f}")
        print(f"  Paper-inspired accuracy: {paper_acc:.4f}")
        print(f"  Always-knock accuracy:   {always_acc:.4f}")

        if learned_acc > best_baseline_acc and learned_auc > best_baseline_auc:
            print("\n  [+] LEARNED MODEL BEATS ALL BASELINES -> gameplay integration justified")
            results['verdict'] = 'positive'
        elif learned_acc > best_baseline_acc or learned_auc > best_baseline_auc:
            print("\n  [~] MIXED SIGNAL -> optional integration for experimental probe")
            results['verdict'] = 'mixed'
        else:
            print("\n  [-] LEARNED MODEL DOES NOT BEAT BASELINES -> foundation-only")
            results['verdict'] = 'negative'

    # Save evaluation results
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n  Results saved to: {output_path}")

    print()
    print("=" * 70)


if __name__ == "__main__":
    main()
