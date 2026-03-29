"""
Distribution Alignment Analysis: Training Data vs. MCTS Rollout Leaf States.

Phase 52 Diagnostic: Compares the distribution of features between
the Phase 51 training dataset and actual rollout leaf states from
ApexMCTS draw search. This directly investigates the distribution
mismatch risk identified in Report 51.

Analyzes:
  - Deadwood distribution
  - Turn / phase distribution
  - Deck-remaining distribution
  - Score-differential distribution
  - Knock-eligibility rate
  - Prediction range / calibration on leaf states
"""

import os
import sys
import json
import random
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gin_rummy.card import NUM_CARDS, make_deck
from gin_rummy.meld import compute_deadwood
from gin_rummy.pbs_features import encode_pbs, FEATURE_DIM
from gin_rummy.value_model import LearnedValueModel, BaselinePredictor
from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.game import GinRummyGame
from gin_rummy.draw_search import (
    evaluate_draw_choice, _get_hand_after_best_discard, _rollout_dw
)

# Feature indices (from pbs_features.py / value_model.py)
IDX_DEADWOOD_RAW = 52
IDX_DEADWOOD_NORM = 53
IDX_MELD_COUNT = 54
IDX_CAN_KNOCK = 57
IDX_IS_GIN = 58
IDX_SCORE_DIFF_NORM = 123
IDX_TURN_NORM = 127
IDX_DECK_REMAINING_NORM = 128
IDX_PHASE_EARLY = 129
IDX_PHASE_MID = 130
IDX_PHASE_LATE = 131
IDX_PHASE_VERY_LATE = 132
IDX_KNOCK_CAN = 133


def collect_rollout_leaf_states(n_games=50, target_score=100, seed=42):
    """
    Collect leaf states from actual ApexMCTS draw search rollouts.

    Plays games and at each draw decision, captures the 10-card hand states
    that result from the rollout evaluation (both take and stock paths).
    """
    rng = random.Random(seed)
    leaf_features = []

    for game_idx in range(n_games):
        game_seed = rng.randint(0, 2**31)
        random.seed(game_seed)

        p0 = ApexMCTS("P0", seed=game_seed)
        p1 = ApexMCTS("P1", seed=game_seed + 1)
        game = GinRummyGame(p0, p1, target_score=target_score, verbose=False)

        # We need to intercept the search to capture leaf states.
        # Instead, we'll simulate the draw search process directly
        # on sampled game positions.
        deck = make_deck()
        hand = deck[:10]
        discard_pile = deck[20:23]
        top_discard = discard_pile[-1]

        game_state = {
            'turn_number': rng.randint(0, 20),
            'my_score': rng.randint(0, 80),
            'opp_score': rng.randint(0, 80),
            'deck_remaining': rng.randint(5, 31),
            'discard_pile': discard_pile,
        }

        # Build unseen cards (cards not in hand and not in discard)
        hand_set = set(hand)
        discard_set = set(discard_pile)
        unseen = [c for c in range(NUM_CARDS) if c not in hand_set and c not in discard_set]

        if len(unseen) < 5:
            continue

        search_rng = random.Random(game_seed + 100)

        # Sample 30 worlds and collect leaf states
        for _ in range(30):
            shuffled = list(unseen)
            search_rng.shuffle(shuffled)

            # TAKE path: add top_discard, find best discard, rollout
            take_hand = list(hand) + [top_discard]
            take_result = _get_hand_after_best_discard(take_hand, restricted=top_discard)
            take_rollout_hand = list(take_result)
            # Simulate 2 rollout depth
            stock_idx = 0
            for _ in range(2):
                if stock_idx >= len(shuffled):
                    break
                drawn = shuffled[stock_idx]
                stock_idx += 1
                hand_11 = take_rollout_hand + [drawn]
                take_rollout_hand = _get_hand_after_best_discard(hand_11, restricted=None)

            if len(take_rollout_hand) == 10:
                feats = encode_pbs(take_rollout_hand, game_state)
                leaf_features.append(feats)

            # STOCK path: draw first unseen, find best discard, rollout
            if not shuffled:
                continue
            stock_card = shuffled[0]
            stock_hand = list(hand) + [stock_card]
            stock_result = _get_hand_after_best_discard(stock_hand, restricted=None)
            stock_rollout_hand = list(stock_result)
            stock_idx_2 = 1
            for _ in range(2):
                if stock_idx_2 >= len(shuffled):
                    break
                drawn = shuffled[stock_idx_2]
                stock_idx_2 += 1
                hand_11 = stock_rollout_hand + [drawn]
                stock_rollout_hand = _get_hand_after_best_discard(hand_11, restricted=None)

            if len(stock_rollout_hand) == 10:
                feats = encode_pbs(stock_rollout_hand, game_state)
                leaf_features.append(feats)

    return np.array(leaf_features, dtype=np.float32) if leaf_features else np.zeros((0, FEATURE_DIM), dtype=np.float32)


def compute_distribution_stats(features, label):
    """Compute distribution statistics for a set of feature vectors."""
    if len(features) == 0:
        return {}

    dw_raw = features[:, IDX_DEADWOOD_RAW]
    dw_norm = features[:, IDX_DEADWOOD_NORM]
    turn_norm = features[:, IDX_TURN_NORM]
    deck_norm = features[:, IDX_DECK_REMAINING_NORM]
    score_diff = features[:, IDX_SCORE_DIFF_NORM]
    can_knock = features[:, IDX_KNOCK_CAN]

    stats = {
        'label': label,
        'n_samples': len(features),
        'deadwood': {
            'mean': float(np.mean(dw_raw)),
            'std': float(np.std(dw_raw)),
            'median': float(np.median(dw_raw)),
            'p25': float(np.percentile(dw_raw, 25)),
            'p75': float(np.percentile(dw_raw, 75)),
            'min': float(np.min(dw_raw)),
            'max': float(np.max(dw_raw)),
        },
        'turn_norm': {
            'mean': float(np.mean(turn_norm)),
            'std': float(np.std(turn_norm)),
            'median': float(np.median(turn_norm)),
        },
        'deck_remaining_norm': {
            'mean': float(np.mean(deck_norm)),
            'std': float(np.std(deck_norm)),
            'median': float(np.median(deck_norm)),
        },
        'score_diff_norm': {
            'mean': float(np.mean(score_diff)),
            'std': float(np.std(score_diff)),
            'median': float(np.median(score_diff)),
        },
        'knock_eligibility_rate': float(np.mean(can_knock)),
        'phase_distribution': {
            'early': float(np.mean(features[:, IDX_PHASE_EARLY])),
            'mid': float(np.mean(features[:, IDX_PHASE_MID])),
            'late': float(np.mean(features[:, IDX_PHASE_LATE])),
            'very_late': float(np.mean(features[:, IDX_PHASE_VERY_LATE])),
        },
    }
    return stats


def analyze_model_on_leaves(leaf_features, model_path):
    """Analyze model predictions on leaf states."""
    if len(leaf_features) == 0:
        return {'error': 'no leaf features'}

    result = {}

    # Try loading the learned model
    try:
        model = LearnedValueModel.load(model_path)
        preds = model.predict_proba(leaf_features)
        result['learned_model'] = {
            'mean_pred': float(np.mean(preds)),
            'std_pred': float(np.std(preds)),
            'min_pred': float(np.min(preds)),
            'max_pred': float(np.max(preds)),
            'p10': float(np.percentile(preds, 10)),
            'p25': float(np.percentile(preds, 25)),
            'median': float(np.median(preds)),
            'p75': float(np.percentile(preds, 75)),
            'p90': float(np.percentile(preds, 90)),
            'pct_below_0.3': float(np.mean(preds < 0.3)),
            'pct_above_0.7': float(np.mean(preds > 0.7)),
            'pct_near_0.5': float(np.mean((preds >= 0.4) & (preds <= 0.6))),
        }
    except Exception as e:
        result['learned_model'] = {'error': str(e)}

    # Baseline model
    baseline = BaselinePredictor()
    baseline_preds = baseline.predict_proba(leaf_features)
    result['baseline_model'] = {
        'mean_pred': float(np.mean(baseline_preds)),
        'std_pred': float(np.std(baseline_preds)),
        'min_pred': float(np.min(baseline_preds)),
        'max_pred': float(np.max(baseline_preds)),
    }

    return result


def main():
    print("=" * 70)
    print("  VALUE MODEL DISTRIBUTION ALIGNMENT ANALYSIS")
    print("  Phase 52 Diagnostic")
    print("=" * 70)

    # ── 1. Load training data ──────────────────────────────────────
    data_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "value_data.npz"
    )
    model_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "apex_value_model.pkl"
    )

    if not os.path.exists(data_path):
        print(f"ERROR: Training data not found at {data_path}")
        return

    data = np.load(data_path)
    X_train = data['X']
    y_train = data['y']
    print(f"\nTraining data: {X_train.shape[0]} samples, {X_train.shape[1]} features")

    # ── 2. Collect rollout leaf states ─────────────────────────────
    print("\nCollecting rollout leaf states from ApexMCTS search...")
    leaf_features = collect_rollout_leaf_states(n_games=100, target_score=100, seed=42)
    print(f"Collected {len(leaf_features)} leaf state samples")

    # ── 3. Compute distribution statistics ─────────────────────────
    print("\n" + "─" * 70)
    print("DISTRIBUTION COMPARISON")
    print("─" * 70)

    train_stats = compute_distribution_stats(X_train, "Training Data (Phase 51)")
    leaf_stats = compute_distribution_stats(leaf_features, "Rollout Leaf States")

    def print_comparison(metric_name, train_dict, leaf_dict):
        print(f"\n  {metric_name}:")
        for key in train_dict:
            t_val = train_dict[key]
            l_val = leaf_dict.get(key, 'N/A')
            if isinstance(t_val, float):
                print(f"    {key:>10s}: train={t_val:8.3f}  leaf={l_val:8.3f}  delta={l_val-t_val:+8.3f}")

    print_comparison("Deadwood", train_stats['deadwood'], leaf_stats['deadwood'])
    print_comparison("Turn (norm)", train_stats['turn_norm'], leaf_stats['turn_norm'])
    print_comparison("Deck Remaining (norm)", train_stats['deck_remaining_norm'], leaf_stats['deck_remaining_norm'])
    print_comparison("Score Differential (norm)", train_stats['score_diff_norm'], leaf_stats['score_diff_norm'])

    print(f"\n  Knock Eligibility Rate:")
    print(f"    Training:  {train_stats['knock_eligibility_rate']:.3f}")
    print(f"    Leaf:      {leaf_stats['knock_eligibility_rate']:.3f}")
    print(f"    Delta:     {leaf_stats['knock_eligibility_rate'] - train_stats['knock_eligibility_rate']:+.3f}")

    print(f"\n  Phase Distribution:")
    for phase in ['early', 'mid', 'late', 'very_late']:
        t_val = train_stats['phase_distribution'][phase]
        l_val = leaf_stats['phase_distribution'][phase]
        print(f"    {phase:>10s}: train={t_val:.3f}  leaf={l_val:.3f}  delta={l_val-t_val:+.3f}")

    # ── 4. Model predictions on leaf states ────────────────────────
    print("\n" + "─" * 70)
    print("MODEL PREDICTIONS ON LEAF STATES")
    print("─" * 70)

    model_analysis = analyze_model_on_leaves(leaf_features, model_path)

    if 'error' not in model_analysis.get('learned_model', {}):
        lm = model_analysis['learned_model']
        print(f"\n  Learned Model Predictions on Leaf States:")
        print(f"    Mean P(win):  {lm['mean_pred']:.4f}")
        print(f"    Std P(win):   {lm['std_pred']:.4f}")
        print(f"    Range:        [{lm['min_pred']:.4f}, {lm['max_pred']:.4f}]")
        print(f"    10th pctile:  {lm['p10']:.4f}")
        print(f"    25th pctile:  {lm['p25']:.4f}")
        print(f"    Median:       {lm['median']:.4f}")
        print(f"    75th pctile:  {lm['p75']:.4f}")
        print(f"    90th pctile:  {lm['p90']:.4f}")
        print(f"    % below 0.3:  {lm['pct_below_0.3']:.1%}")
        print(f"    % above 0.7:  {lm['pct_above_0.7']:.1%}")
        print(f"    % near 0.5:   {lm['pct_near_0.5']:.1%}")
    else:
        print(f"  Learned model error: {model_analysis['learned_model']}")

    bm = model_analysis['baseline_model']
    print(f"\n  Baseline Model Predictions on Leaf States:")
    print(f"    Mean P(win):  {bm['mean_pred']:.4f}")
    print(f"    Std P(win):   {bm['std_pred']:.4f}")
    print(f"    Range:        [{bm['min_pred']:.4f}, {bm['max_pred']:.4f}]")

    # ── 5. Jensen-Shannon divergence approximation ─────────────────
    # Compare deadwood distributions using histogram overlap
    print("\n" + "─" * 70)
    print("DISTRIBUTION OVERLAP (DEADWOOD)")
    print("─" * 70)

    train_dw = X_train[:, IDX_DEADWOOD_RAW]
    leaf_dw = leaf_features[:, IDX_DEADWOOD_RAW]

    bins = np.arange(0, 105, 5)
    train_hist, _ = np.histogram(train_dw, bins=bins, density=True)
    leaf_hist, _ = np.histogram(leaf_dw, bins=bins, density=True)

    # Histogram overlap coefficient
    overlap = np.sum(np.minimum(train_hist, leaf_hist)) * 5  # bin width
    print(f"\n  Histogram overlap coefficient: {overlap:.3f}")
    print(f"  (1.0 = identical distributions, 0.0 = no overlap)")

    # ── 6. Alignment verdict ───────────────────────────────────────
    print("\n" + "─" * 70)
    print("ALIGNMENT VERDICT")
    print("─" * 70)

    dw_delta = abs(leaf_stats['deadwood']['mean'] - train_stats['deadwood']['mean'])
    knock_delta = abs(leaf_stats['knock_eligibility_rate'] - train_stats['knock_eligibility_rate'])

    issues = []
    if dw_delta > 10:
        issues.append(f"Large deadwood mean shift ({dw_delta:.1f} points)")
    if knock_delta > 0.15:
        issues.append(f"Large knock eligibility shift ({knock_delta:.1%})")
    if overlap < 0.5:
        issues.append(f"Low deadwood distribution overlap ({overlap:.3f})")

    if 'error' not in model_analysis.get('learned_model', {}):
        lm = model_analysis['learned_model']
        if lm['std_pred'] < 0.05:
            issues.append("Model predictions nearly constant (low variance)")
        if lm['pct_near_0.5'] > 0.8:
            issues.append("Model mostly predicts near 0.5 (low discrimination)")

    if issues:
        print(f"\n  ⚠ {len(issues)} alignment concern(s):")
        for issue in issues:
            print(f"    - {issue}")
        print(f"\n  RECOMMENDATION: Proceed with caution. Use conservative")
        print(f"  augmentation (small weight, close-call-only) to limit")
        print(f"  exposure to distribution mismatch.")
    else:
        print(f"\n  ✓ No major alignment concerns detected.")
        print(f"  Model appears to be queried on data reasonably close")
        print(f"  to its training distribution.")

    # ── 7. Save analysis results ───────────────────────────────────
    results = {
        'training_stats': train_stats,
        'leaf_stats': leaf_stats,
        'model_predictions': model_analysis,
        'deadwood_overlap': float(overlap),
        'issues': issues,
    }

    output_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "value_alignment_analysis.json"
    )
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n  Analysis saved to {output_path}")

    print("\n" + "=" * 70)
    print("  ANALYSIS COMPLETE")
    print("=" * 70)


if __name__ == "__main__":
    main()
