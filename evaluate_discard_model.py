"""
Evaluate discard action model against offline baselines.

Compares:
  1. Learned MLP model
  2. Deadwood discard baseline (pure DW minimization)
  3. Apex heuristic discard baseline (two-phase pipeline)

Reports GROUP-AWARE decision metrics:
  - Top-1 best-discard accuracy by state
  - Average regret versus the best candidate in each state
  - Pairwise ranking accuracy
  - Flat metrics (accuracy, AUC, Brier, LogLoss)

Usage:
  python evaluate_discard_model.py [--data PATH] [--model PATH]
"""

import argparse
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from gin_rummy.discard_action_model import (
    LearnedDiscardModel, DeadwoodDiscardBaseline, ApexHeuristicDiscardBaseline
)
from gin_rummy.discard_action_features import DISCARD_FEATURE_DIM, get_discard_feature_names


def _sigmoid(x):
    """Apply sigmoid to convert raw scores to [0,1] range."""
    return 1.0 / (1.0 + np.exp(-np.clip(x, -20, 20)))


def evaluate_grouped(name, X, y_true, utilities, group_ids, score_fn):
    """
    Compute group-aware metrics for a discard ranker.

    The key question is: within each group (discard decision state),
    does the model rank the best candidate highest?
    """
    from sklearn.metrics import accuracy_score, roc_auc_score, brier_score_loss, log_loss

    # Get raw scores
    raw_scores = score_fn(X)

    # For flat probability metrics, normalize scores to [0,1] if needed
    if np.any(raw_scores < -0.01) or np.any(raw_scores > 1.01):
        # Scores are not probabilities — normalize via sigmoid for flat metrics
        std = max(np.std(raw_scores), 1e-6)
        y_proba = _sigmoid(raw_scores / std)
    else:
        y_proba = np.clip(raw_scores, 0, 1)

    y_pred = (y_proba > 0.5).astype(np.float32)

    flat_acc = accuracy_score(y_true, y_pred)
    try:
        flat_auc = roc_auc_score(y_true, raw_scores)
    except ValueError:
        flat_auc = 0.5

    try:
        y_clamped = np.clip(y_proba, 1e-7, 1 - 1e-7)
        flat_brier = float(brier_score_loss(y_true, y_clamped))
        flat_logloss = float(log_loss(y_true, y_clamped))
    except Exception:
        flat_brier = 999.0
        flat_logloss = 999.0

    # Group-aware metrics (use raw_scores for ranking — ordinal only)
    top1_correct = 0
    total_groups = 0
    total_regret = 0.0
    pairwise_correct = 0
    pairwise_total = 0

    for gid in np.unique(group_ids):
        mask = group_ids == gid
        g_scores = raw_scores[mask]
        g_labels = y_true[mask]
        g_utils = utilities[mask]

        if len(g_scores) < 2:
            continue

        total_groups += 1

        # Top-1 accuracy: does the model's top choice have label=1?
        model_choice = np.argmax(g_scores)
        if g_labels[model_choice] > 0.5:
            top1_correct += 1

        # Regret: utility difference between best and chosen
        best_util = np.max(g_utils)
        chosen_util = g_utils[model_choice]
        total_regret += (best_util - chosen_util)

        # Pairwise ranking accuracy: for each pair of candidates,
        # does the model correctly rank the one with higher utility higher?
        for i in range(len(g_utils)):
            for j in range(i + 1, len(g_utils)):
                if abs(g_utils[i] - g_utils[j]) < 1e-6:
                    continue  # Skip ties
                pairwise_total += 1
                if (g_utils[i] > g_utils[j]) == (g_scores[i] > g_scores[j]):
                    pairwise_correct += 1

    top1_acc = top1_correct / max(total_groups, 1)
    avg_regret = total_regret / max(total_groups, 1)
    pairwise_acc = pairwise_correct / max(pairwise_total, 1)

    return {
        'name': name,
        'flat_accuracy': round(flat_acc, 4),
        'flat_auc': round(float(flat_auc), 4),
        'flat_brier': round(flat_brier, 4),
        'flat_logloss': round(flat_logloss, 4),
        'top1_accuracy': round(top1_acc, 4),
        'avg_regret': round(float(avg_regret), 4),
        'pairwise_accuracy': round(pairwise_acc, 4),
        'total_groups': total_groups,
        'top1_correct': top1_correct,
        'pairwise_total': pairwise_total,
        'pairwise_correct': pairwise_correct,
    }


def main():
    parser = argparse.ArgumentParser(description="Evaluate discard action model vs baselines")
    parser.add_argument("--data", type=str, default=None)
    parser.add_argument("--model", type=str, default=None)
    parser.add_argument("--output", type=str, default=None)
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.abspath(__file__))
    data_path = args.data or os.path.join(project_root, "models", "discard_action_data.npz")
    model_path = args.model or os.path.join(project_root, "models", "discard_action_model.pkl")
    output_path = args.output or os.path.join(project_root, "models", "discard_action_evaluation.json")

    print("=" * 78)
    print("  DISCARD ACTION MODEL EVALUATION")
    print("=" * 78)
    print(f"  Data:   {data_path}")
    print(f"  Model:  {model_path}")
    print("=" * 78)

    # Load data
    data = np.load(data_path, allow_pickle=True)
    X = data['X']
    utilities = data['utilities']
    group_ids = data['group_ids']
    labels = data['labels']

    # Group-aware train/test split (same as training)
    unique_groups = np.unique(group_ids)
    rng = np.random.RandomState(42)
    rng.shuffle(unique_groups)

    split_idx = int(0.8 * len(unique_groups))
    test_groups = set(unique_groups[split_idx:])

    test_mask = np.array([g in test_groups for g in group_ids])
    X_test = X[test_mask]
    y_test = labels[test_mask]
    utils_test = utilities[test_mask]
    group_test = group_ids[test_mask]

    n_test_groups = len(np.unique(group_test))
    print(f"  Test samples:   {len(X_test):,}")
    print(f"  Test groups:    {n_test_groups:,}")
    print(f"  Near-optimal rate (test): {np.mean(y_test):.3f}")
    print()

    # Models to compare
    models = {}

    # Baselines
    dw_baseline = DeadwoodDiscardBaseline()
    apex_baseline = ApexHeuristicDiscardBaseline()
    models['deadwood_baseline'] = dw_baseline.score_candidates
    models['apex_heuristic'] = apex_baseline.score_candidates

    # Always-best-dw (oracle-like: just pick is_dw_optimal)
    def always_dw_optimal(X):
        return X[:, 9]  # IDX_IS_DW_OPTIMAL
    models['always_dw_optimal'] = always_dw_optimal

    # Add learned model if available
    if os.path.exists(model_path):
        learned = LearnedDiscardModel.load(model_path)
        models['learned_mlp'] = learned.score_candidates
    else:
        print(f"  WARNING: No learned model found at {model_path}")
        print()

    # Evaluate all
    results = {}
    for name, score_fn in models.items():
        metrics = evaluate_grouped(name, X_test, y_test, utils_test, group_test, score_fn)
        results[name] = metrics

    # Print comparison table
    print(f"  {'Model':<22} {'Top-1 Acc':>10} {'Pairwise':>10} {'Regret':>10} "
          f"{'Flat Acc':>10} {'AUC':>8}")
    print("  " + "-" * 72)
    for name, m in sorted(results.items(), key=lambda x: -x[1]['top1_accuracy']):
        print(f"  {m['name']:<22} {m['top1_accuracy']:>10.4f} {m['pairwise_accuracy']:>10.4f} "
              f"{m['avg_regret']:>10.4f} {m['flat_accuracy']:>10.4f} {m['flat_auc']:>8.4f}")

    print()

    # Detail breakdown for top models
    for name in ['learned_mlp', 'apex_heuristic', 'deadwood_baseline']:
        if name in results:
            m = results[name]
            print(f"  {m['name']}:")
            print(f"    Top-1 accuracy:     {m['top1_accuracy']:.4f} "
                  f"({m['top1_correct']}/{m['total_groups']})")
            print(f"    Avg regret:         {m['avg_regret']:.4f}")
            print(f"    Pairwise accuracy:  {m['pairwise_accuracy']:.4f} "
                  f"({m['pairwise_correct']}/{m['pairwise_total']})")
            print(f"    Flat accuracy:      {m['flat_accuracy']:.4f}")
            print(f"    AUC:                {m['flat_auc']:.4f}")
            print()

    # Decision summary
    if 'learned_mlp' in results:
        learned_top1 = results['learned_mlp']['top1_accuracy']
        learned_regret = results['learned_mlp']['avg_regret']
        learned_pairwise = results['learned_mlp']['pairwise_accuracy']

        best_baseline_top1 = max(
            results.get('deadwood_baseline', {}).get('top1_accuracy', 0),
            results.get('apex_heuristic', {}).get('top1_accuracy', 0),
        )
        best_baseline_regret = min(
            results.get('deadwood_baseline', {}).get('avg_regret', 999),
            results.get('apex_heuristic', {}).get('avg_regret', 999),
        )
        best_baseline_pairwise = max(
            results.get('deadwood_baseline', {}).get('pairwise_accuracy', 0),
            results.get('apex_heuristic', {}).get('pairwise_accuracy', 0),
        )

        print("  ═══ DECISION SUMMARY ═══")
        print(f"  Learned top-1 acc:         {learned_top1:.4f}")
        print(f"  Best baseline top-1 acc:   {best_baseline_top1:.4f}")
        print(f"  Top-1 edge:                {learned_top1 - best_baseline_top1:+.4f}")
        print()
        print(f"  Learned pairwise acc:      {learned_pairwise:.4f}")
        print(f"  Best baseline pairwise:    {best_baseline_pairwise:.4f}")
        print(f"  Pairwise edge:             {learned_pairwise - best_baseline_pairwise:+.4f}")
        print()
        print(f"  Learned avg regret:        {learned_regret:.4f}")
        print(f"  Best baseline avg regret:  {best_baseline_regret:.4f}")
        print(f"  Regret edge:               {learned_regret - best_baseline_regret:+.4f}")

        beats_top1 = learned_top1 > best_baseline_top1
        beats_pairwise = learned_pairwise > best_baseline_pairwise
        beats_regret = learned_regret < best_baseline_regret

        if beats_top1 and (beats_pairwise or beats_regret):
            print("\n  VERDICT: POSITIVE — learned model beats baselines → gameplay integration justified")
            results['verdict'] = 'positive'
        elif beats_top1 or beats_pairwise:
            print("\n  VERDICT: MIXED — optional integration for experimental probe")
            results['verdict'] = 'mixed'
        else:
            print("\n  VERDICT: NEGATIVE — learned model does not beat baselines → foundation-only")
            results['verdict'] = 'negative'

    # Save evaluation results
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n  Results saved to: {output_path}")

    print()
    print("=" * 78)


if __name__ == "__main__":
    main()
