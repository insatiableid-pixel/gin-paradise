"""
Train and evaluate the Gin Rummy value model.

Loads self-play data, trains an MLP value model, evaluates offline metrics,
and saves the trained model. Also evaluates against the handcrafted baseline.

Usage:
  python train_value_model.py [--data PATH] [--output PATH]
"""

import argparse
import os
import sys
import time
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    brier_score_loss, log_loss, accuracy_score, roc_auc_score,
    classification_report
)

from gin_rummy.value_model import (
    BaselinePredictor, LearnedValueModel, train_value_model
)
from gin_rummy.pbs_features import FEATURE_DIM


def evaluate_predictor(name, y_true, y_proba, threshold=0.5):
    """Compute and report metrics for a predictor."""
    y_pred = (y_proba >= threshold).astype(int)

    brier = brier_score_loss(y_true, y_proba)
    y_proba_clipped = np.clip(y_proba, 1e-7, 1 - 1e-7)
    logloss = log_loss(y_true, y_proba_clipped)
    acc = accuracy_score(y_true, y_pred)

    try:
        auc = roc_auc_score(y_true, y_proba)
    except ValueError:
        auc = 0.5  # Degenerate case

    # Calibration: bin predictions and compare to actual rates
    n_bins = 10
    bin_edges = np.linspace(0, 1, n_bins + 1)
    calibration = []
    for i in range(n_bins):
        mask = (y_proba >= bin_edges[i]) & (y_proba < bin_edges[i + 1])
        if i == n_bins - 1:  # Include 1.0 in last bin
            mask = mask | (y_proba == 1.0)
        if mask.sum() > 0:
            bin_mean_pred = y_proba[mask].mean()
            bin_mean_true = y_true[mask].mean()
            calibration.append({
                'bin': f'{bin_edges[i]:.1f}-{bin_edges[i+1]:.1f}',
                'count': int(mask.sum()),
                'mean_predicted': round(float(bin_mean_pred), 4),
                'mean_actual': round(float(bin_mean_true), 4),
                'gap': round(abs(float(bin_mean_pred) - float(bin_mean_true)), 4),
            })

    # Expected Calibration Error
    ece = 0.0
    total_samples = len(y_true)
    for b in calibration:
        ece += b['count'] / total_samples * b['gap']

    metrics = {
        'name': name,
        'brier_score': round(float(brier), 6),
        'log_loss': round(float(logloss), 6),
        'accuracy': round(float(acc), 4),
        'auc_roc': round(float(auc), 4),
        'ece': round(float(ece), 6),
        'calibration': calibration,
    }

    return metrics


def print_metrics(metrics):
    """Pretty-print evaluation metrics."""
    print(f"\n  {metrics['name']}:")
    print(f"    Brier Score:  {metrics['brier_score']:.6f}  (lower is better)")
    print(f"    Log Loss:     {metrics['log_loss']:.6f}  (lower is better)")
    print(f"    Accuracy:     {metrics['accuracy']:.4f}")
    print(f"    AUC-ROC:      {metrics['auc_roc']:.4f}")
    print(f"    ECE:          {metrics['ece']:.6f}  (lower is better)")

    if metrics['calibration']:
        print(f"    Calibration:")
        for b in metrics['calibration']:
            print(f"      {b['bin']}: n={b['count']:5d}  pred={b['mean_predicted']:.3f}  "
                  f"actual={b['mean_actual']:.3f}  gap={b['gap']:.3f}")


def main():
    parser = argparse.ArgumentParser(description="Train Gin Rummy value model")
    parser.add_argument("--data", type=str, default=None,
                        help="Path to training data (default: models/value_data.npz)")
    parser.add_argument("--output", type=str, default=None,
                        help="Path to save model (default: models/apex_value_model.pkl)")
    parser.add_argument("--test-size", type=float, default=0.2,
                        help="Test set fraction (default: 0.2)")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed (default: 42)")
    args = parser.parse_args()

    data_path = args.data or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "models", "value_data.npz"
    )
    model_path = args.output or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "models", "apex_value_model.pkl"
    )

    # Load data
    print("=" * 60)
    print("  GIN RUMMY VALUE MODEL TRAINING")
    print("=" * 60)
    print(f"  Data:       {data_path}")
    print(f"  Model:      {model_path}")
    print(f"  Test size:  {args.test_size}")
    print(f"  Seed:       {args.seed}")

    data = np.load(data_path, allow_pickle=True)
    X = data['X']
    y = data['y']

    print(f"\n  Dataset loaded:")
    print(f"    Total samples:  {len(y):,}")
    print(f"    Feature dim:    {X.shape[1]}")
    print(f"    Positive rate:  {y.mean():.4f}")

    # Train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=args.test_size, random_state=args.seed, stratify=y
    )

    print(f"    Train samples:  {len(y_train):,}")
    print(f"    Test samples:   {len(y_test):,}")
    print(f"    Train positive: {y_train.mean():.4f}")
    print(f"    Test positive:  {y_test.mean():.4f}")

    # ── Baseline evaluation ───────────────────────────────────────
    print("\n" + "=" * 60)
    print("  BASELINE PREDICTOR (Handcrafted)")
    print("=" * 60)

    baseline = BaselinePredictor()
    baseline_proba_test = baseline.predict_proba(X_test)
    baseline_metrics = evaluate_predictor("Baseline (handcrafted)", y_test, baseline_proba_test)
    print_metrics(baseline_metrics)

    # ── Learned model training ────────────────────────────────────
    print("\n" + "=" * 60)
    print("  TRAINING LEARNED MODEL (MLP)")
    print("=" * 60)

    start_time = time.time()
    learned_model = train_value_model(
        X_train, y_train,
        hidden_layers=(128, 64, 32),
        max_iter=500,
        random_state=args.seed,
        verbose=False,
    )
    train_time = time.time() - start_time
    print(f"  Training time: {train_time:.1f}s")

    # Evaluate on test set
    learned_proba_test = learned_model.predict_proba(X_test)
    learned_metrics = evaluate_predictor("Learned (MLP)", y_test, learned_proba_test)
    print_metrics(learned_metrics)

    # Also evaluate on train set for overfitting check
    learned_proba_train = learned_model.predict_proba(X_train)
    train_metrics = evaluate_predictor("Learned (MLP) - TRAIN", y_train, learned_proba_train)
    print(f"\n  Train set overfitting check:")
    print(f"    Train Brier:  {train_metrics['brier_score']:.6f}")
    print(f"    Test Brier:   {learned_metrics['brier_score']:.6f}")
    print(f"    Gap:          {abs(train_metrics['brier_score'] - learned_metrics['brier_score']):.6f}")

    # ── Comparison ────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  HEAD-TO-HEAD COMPARISON")
    print("=" * 60)

    brier_improvement = baseline_metrics['brier_score'] - learned_metrics['brier_score']
    logloss_improvement = baseline_metrics['log_loss'] - learned_metrics['log_loss']
    acc_improvement = learned_metrics['accuracy'] - baseline_metrics['accuracy']
    auc_improvement = learned_metrics['auc_roc'] - baseline_metrics['auc_roc']

    print(f"  {'Metric':<20} {'Baseline':>12} {'Learned':>12} {'Improvement':>12}")
    print(f"  {'-'*20} {'-'*12} {'-'*12} {'-'*12}")
    print(f"  {'Brier Score':<20} {baseline_metrics['brier_score']:>12.6f} {learned_metrics['brier_score']:>12.6f} {brier_improvement:>+12.6f}")
    print(f"  {'Log Loss':<20} {baseline_metrics['log_loss']:>12.6f} {learned_metrics['log_loss']:>12.6f} {logloss_improvement:>+12.6f}")
    print(f"  {'Accuracy':<20} {baseline_metrics['accuracy']:>12.4f} {learned_metrics['accuracy']:>12.4f} {acc_improvement:>+12.4f}")
    print(f"  {'AUC-ROC':<20} {baseline_metrics['auc_roc']:>12.4f} {learned_metrics['auc_roc']:>12.4f} {auc_improvement:>+12.4f}")
    print(f"  {'ECE':<20} {baseline_metrics['ece']:>12.6f} {learned_metrics['ece']:>12.6f} {baseline_metrics['ece'] - learned_metrics['ece']:>+12.6f}")

    learned_beats_baseline = (
        learned_metrics['brier_score'] < baseline_metrics['brier_score']
        and learned_metrics['log_loss'] < baseline_metrics['log_loss']
    )

    print(f"\n  Verdict: Learned model {'BEATS' if learned_beats_baseline else 'DOES NOT BEAT'} baseline")
    print(f"  Gameplay integration: {'JUSTIFIED' if learned_beats_baseline else 'NOT JUSTIFIED'}")

    # ── Save model ────────────────────────────────────────────────
    if learned_beats_baseline:
        print(f"\n  Saving learned model to {model_path}")
        learned_model.save(model_path)
        print(f"  Model saved.")
    else:
        print(f"\n  NOT saving model (did not beat baseline).")

    # ── Save results ──────────────────────────────────────────────
    results = {
        'baseline_metrics': baseline_metrics,
        'learned_metrics': learned_metrics,
        'train_metrics': {
            'brier_score': train_metrics['brier_score'],
            'log_loss': train_metrics['log_loss'],
        },
        'comparison': {
            'brier_improvement': round(brier_improvement, 6),
            'logloss_improvement': round(logloss_improvement, 6),
            'accuracy_improvement': round(acc_improvement, 4),
            'auc_improvement': round(auc_improvement, 4),
            'learned_beats_baseline': learned_beats_baseline,
        },
        'data': {
            'total_samples': len(y),
            'train_samples': len(y_train),
            'test_samples': len(y_test),
            'positive_rate': round(float(y.mean()), 4),
        },
        'model': {
            'architecture': '128-64-32 MLP',
            'activation': 'relu',
            'solver': 'adam',
            'training_time_sec': round(train_time, 1),
        },
    }

    results_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "models", "value_model_results.json"
    )
    os.makedirs(os.path.dirname(results_path), exist_ok=True)
    with open(results_path, 'w') as f:
        # Remove calibration data to keep results compact
        compact_results = dict(results)
        if 'calibration' in compact_results.get('baseline_metrics', {}):
            compact_results['baseline_metrics'] = {
                k: v for k, v in compact_results['baseline_metrics'].items()
                if k != 'calibration'
            }
        if 'calibration' in compact_results.get('learned_metrics', {}):
            compact_results['learned_metrics'] = {
                k: v for k, v in compact_results['learned_metrics'].items()
                if k != 'calibration'
            }
        json.dump(compact_results, f, indent=2)
    print(f"  Results saved to {results_path}")

    print("\n" + "=" * 60)
    print("  TRAINING COMPLETE")
    print("=" * 60)

    return learned_beats_baseline


if __name__ == "__main__":
    result = main()
    sys.exit(0 if result else 1)
