"""
Standalone offline evaluation of the trained value model.

Loads the model and test data, produces detailed metrics and analysis.
Can be run independently of training for reproducible evaluation.

Usage:
  python evaluate_value_model.py [--data PATH] [--model PATH]
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from sklearn.model_selection import train_test_split

from gin_rummy.value_model import BaselinePredictor, LearnedValueModel
from gin_rummy.pbs_features import FEATURE_DIM


def main():
    parser = argparse.ArgumentParser(description="Evaluate trained value model")
    parser.add_argument("--data", type=str, default=None)
    parser.add_argument("--model", type=str, default=None)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    data_path = args.data or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "models", "value_data.npz"
    )
    model_path = args.model or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "models", "apex_value_model.pkl"
    )

    print("=" * 60)
    print("  VALUE MODEL OFFLINE EVALUATION")
    print("=" * 60)

    # Load data
    data = np.load(data_path, allow_pickle=True)
    X = data['X']
    y = data['y']

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=args.test_size, random_state=args.seed, stratify=y
    )

    print(f"  Test samples: {len(y_test):,}")
    print(f"  Test positive rate: {y_test.mean():.4f}")

    # Baseline
    baseline = BaselinePredictor()
    baseline_proba = baseline.predict_proba(X_test)

    from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score, accuracy_score

    print(f"\n  Baseline (handcrafted):")
    b_brier = brier_score_loss(y_test, baseline_proba)
    b_logloss = log_loss(y_test, np.clip(baseline_proba, 1e-7, 1-1e-7))
    b_acc = accuracy_score(y_test, (baseline_proba >= 0.5).astype(int))
    b_auc = roc_auc_score(y_test, baseline_proba)
    print(f"    Brier:   {b_brier:.6f}")
    print(f"    LogLoss: {b_logloss:.6f}")
    print(f"    Acc:     {b_acc:.4f}")
    print(f"    AUC:     {b_auc:.4f}")

    # Learned model
    if not os.path.exists(model_path):
        print(f"\n  Model file not found: {model_path}")
        print(f"  Skipping learned model evaluation.")
        return

    learned = LearnedValueModel.load(model_path)
    learned_proba = learned.predict_proba(X_test)

    print(f"\n  Learned (MLP):")
    l_brier = brier_score_loss(y_test, learned_proba)
    l_logloss = log_loss(y_test, np.clip(learned_proba, 1e-7, 1-1e-7))
    l_acc = accuracy_score(y_test, (learned_proba >= 0.5).astype(int))
    l_auc = roc_auc_score(y_test, learned_proba)
    print(f"    Brier:   {l_brier:.6f}")
    print(f"    LogLoss: {l_logloss:.6f}")
    print(f"    Acc:     {l_acc:.4f}")
    print(f"    AUC:     {l_auc:.4f}")

    print(f"\n  Improvement (baseline - learned, positive = learned better):")
    print(f"    Brier:   {b_brier - l_brier:+.6f}")
    print(f"    LogLoss: {b_logloss - l_logloss:+.6f}")
    print(f"    Acc:     {l_acc - b_acc:+.4f}")
    print(f"    AUC:     {l_auc - b_auc:+.4f}")

    # Prediction distribution analysis
    print(f"\n  Prediction distribution (learned):")
    print(f"    Mean:   {learned_proba.mean():.4f}")
    print(f"    Std:    {learned_proba.std():.4f}")
    print(f"    Min:    {learned_proba.min():.4f}")
    print(f"    Max:    {learned_proba.max():.4f}")

    # Per-quartile analysis
    quartiles = np.percentile(learned_proba, [25, 50, 75])
    print(f"    Q1:     {quartiles[0]:.4f}")
    print(f"    Median: {quartiles[1]:.4f}")
    print(f"    Q3:     {quartiles[2]:.4f}")

    print("\n" + "=" * 60)
    print("  EVALUATION COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    main()
