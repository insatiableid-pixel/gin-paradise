"""
Evaluate draw action model against offline baselines.

Compares:
  1. Learned MLP model
  2. Deadwood improvement baseline
  3. Apex heuristic baseline
  4. Always-stock baseline (trivial)

On held-out draw decisions, reports:
  - Decision accuracy
  - AUC / Brier score
  - Regret (avg missed EV on wrong decisions)
  - Calibration (reliability plot data)
  - Breakdown by decision type (take-correct, stock-correct)

Usage:
  python evaluate_action_model.py [--data PATH] [--model PATH]
"""

import argparse
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from gin_rummy.draw_action_model import (
    LearnedDrawActionModel, DeadwoodBaseline, ApexHeuristicBaseline
)
from gin_rummy.action_features import ACTION_FEATURE_DIM, get_action_feature_names


def evaluate_model(name, y_true, y_proba, deltas):
    """Compute comprehensive metrics for a model."""
    from sklearn.metrics import accuracy_score, roc_auc_score, brier_score_loss, log_loss

    y_pred = (y_proba > 0.5).astype(np.float32)
    acc = accuracy_score(y_true, y_pred)

    # AUC requires both classes present
    try:
        auc = roc_auc_score(y_true, y_proba)
    except ValueError:
        auc = 0.5

    brier = brier_score_loss(y_true, y_proba)

    # Clamp probabilities for log_loss
    y_proba_clamped = np.clip(y_proba, 1e-7, 1 - 1e-7)
    ll = log_loss(y_true, y_proba_clamped)

    # Regret analysis
    correct_mask = y_pred == y_true
    wrong_mask = ~correct_mask

    avg_regret = float(np.mean(np.abs(deltas[wrong_mask]))) if wrong_mask.sum() > 0 else 0.0
    avg_delta_correct = float(np.mean(np.abs(deltas[correct_mask]))) if correct_mask.sum() > 0 else 0.0

    # Breakdown by true label
    take_mask = y_true == 1.0
    stock_mask = y_true == 0.0
    take_acc = float(np.mean(y_pred[take_mask] == y_true[take_mask])) if take_mask.sum() > 0 else 0.0
    stock_acc = float(np.mean(y_pred[stock_mask] == y_true[stock_mask])) if stock_mask.sum() > 0 else 0.0

    # Average predicted probability by true class
    avg_prob_take = float(np.mean(y_proba[take_mask])) if take_mask.sum() > 0 else 0.0
    avg_prob_stock = float(np.mean(y_proba[stock_mask])) if stock_mask.sum() > 0 else 0.0

    return {
        'name': name,
        'accuracy': round(acc, 4),
        'auc': round(auc, 4),
        'brier': round(brier, 4),
        'log_loss': round(ll, 4),
        'avg_regret_wrong': round(avg_regret, 4),
        'avg_delta_correct': round(avg_delta_correct, 4),
        'take_accuracy': round(take_acc, 4),
        'stock_accuracy': round(stock_acc, 4),
        'take_count': int(take_mask.sum()),
        'stock_count': int(stock_mask.sum()),
        'avg_prob_when_take': round(avg_prob_take, 4),
        'avg_prob_when_stock': round(avg_prob_stock, 4),
        'wrong_count': int(wrong_mask.sum()),
        'correct_count': int(correct_mask.sum()),
    }


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
    parser = argparse.ArgumentParser(description="Evaluate draw action model vs baselines")
    parser.add_argument("--data", type=str, default=None)
    parser.add_argument("--model", type=str, default=None)
    parser.add_argument("--output", type=str, default=None)
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.abspath(__file__))
    data_path = args.data or os.path.join(project_root, "models", "draw_action_data.npz")
    model_path = args.model or os.path.join(project_root, "models", "draw_action_model.pkl")
    output_path = args.output or os.path.join(project_root, "models", "draw_action_evaluation.json")

    print("=" * 70)
    print("  DRAW ACTION MODEL EVALUATION")
    print("=" * 70)
    print(f"  Data:   {data_path}")
    print(f"  Model:  {model_path}")
    print("=" * 70)

    # Load data
    data = np.load(data_path, allow_pickle=True)
    X = data['X']
    deltas = data['action_deltas']
    labels = data['take_better']

    # Use 20% split as test set (same split as training)
    from sklearn.model_selection import train_test_split
    _, X_test, _, y_test, _, delta_test = train_test_split(
        X, labels, deltas, test_size=0.2, random_state=42, stratify=labels
    )

    print(f"  Test samples: {len(X_test):,}")
    print(f"  Take-better rate (test): {np.mean(y_test):.3f}")
    print()

    # Models to compare
    models = {
        'always_stock': lambda X: np.zeros(X.shape[0]),
        'always_take': lambda X: np.ones(X.shape[0]),
        'deadwood_baseline': DeadwoodBaseline().predict_proba,
        'apex_heuristic': ApexHeuristicBaseline().predict_proba,
    }

    # Add learned model if available
    if os.path.exists(model_path):
        learned = LearnedDrawActionModel.load(model_path)
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
    for name in ['learned_mlp', 'apex_heuristic', 'deadwood_baseline']:
        if name in results:
            m = results[name]
            print(f"  {m['name']}:")
            print(f"    Take accuracy:  {m['take_accuracy']:.4f} ({m['take_count']} samples)")
            print(f"    Stock accuracy: {m['stock_accuracy']:.4f} ({m['stock_count']} samples)")
            print(f"    Avg P(take) when take: {m['avg_prob_when_take']:.4f}")
            print(f"    Avg P(take) when stock: {m['avg_prob_when_stock']:.4f}")
            print()

    # Calibration for learned model
    if 'learned_mlp' in results:
        print("  Calibration (learned_mlp):")
        y_proba_learned = models['learned_mlp'](X_test)
        cal = _calibration_data(y_test, y_proba_learned)
        for bin_data in cal:
            bar = "█" * int(bin_data['count'] / max(1, len(X_test) / 50))
            print(f"    [{bin_data['bin_start']:.1f}-{bin_data['bin_end']:.1f}] "
                  f"pred={bin_data['mean_predicted']:.3f} "
                  f"actual={bin_data['mean_actual']:.3f} "
                  f"n={bin_data['count']:>5} {bar}")
        print()
        results['calibration'] = cal

    # Decision: does the learned model beat baselines?
    if 'learned_mlp' in results:
        learned_acc = results['learned_mlp']['accuracy']
        apex_acc = results['apex_heuristic']['accuracy']
        dw_acc = results['deadwood_baseline']['accuracy']
        best_baseline_acc = max(apex_acc, dw_acc)

        learned_auc = results['learned_mlp']['auc']
        apex_auc = results['apex_heuristic']['auc']
        dw_auc = results['deadwood_baseline']['auc']
        best_baseline_auc = max(apex_auc, dw_auc)

        print("  ═══ DECISION SUMMARY ═══")
        print(f"  Learned accuracy:      {learned_acc:.4f}")
        print(f"  Best baseline accuracy: {best_baseline_acc:.4f} "
              f"({'apex' if apex_acc > dw_acc else 'deadwood'})")
        print(f"  Accuracy edge:         {learned_acc - best_baseline_acc:+.4f}")
        print(f"  Learned AUC:           {learned_auc:.4f}")
        print(f"  Best baseline AUC:     {best_baseline_auc:.4f}")
        print(f"  AUC edge:              {learned_auc - best_baseline_auc:+.4f}")

        if learned_acc > best_baseline_acc and learned_auc > best_baseline_auc:
            print("\n  ✓ LEARNED MODEL BEATS ALL BASELINES → gameplay integration justified")
            results['verdict'] = 'positive'
        elif learned_acc > best_baseline_acc or learned_auc > best_baseline_auc:
            print("\n  ~ MIXED SIGNAL → optional integration for experimental probe")
            results['verdict'] = 'mixed'
        else:
            print("\n  ✗ LEARNED MODEL DOES NOT BEAT BASELINES → foundation-only")
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
