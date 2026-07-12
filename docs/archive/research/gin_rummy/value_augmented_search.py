"""
Value-Augmented Draw Search for Gin Rummy.

Conservative integration of the learned value model into the proven
ApexMCTS draw search. The value signal is used as a small supplementary
correction, NOT as a replacement for the deadwood rollout objective.

Design principles (Phase 52):
  1. Deadwood EV from rollouts remains the PRIMARY evaluation signal
  2. Value model provides a small additive adjustment
  3. Adjustment is gated by a close-call band — only fires when the
     deadwood margin between take and stock is already small
  4. When the model is unavailable, behavior falls back cleanly to
     pure deadwood evaluation (identical to baseline ApexMCTS)
  5. When value_weight=0, behavior is identical to baseline

Key parameters:
  - value_weight: Strength of the value model's additive correction (DW units)
  - close_call_band: Only apply value correction when deadwood margin < this
  - override_threshold: Value margin required to override a close deadwood call
"""

import os
import numpy as np
from gin_rummy.card import NUM_CARDS
from gin_rummy.meld import compute_deadwood
from gin_rummy.pbs_features import encode_pbs, FEATURE_DIM
from gin_rummy.draw_search import (
    _best_discard_dw, _get_hand_after_best_discard, _rollout_dw,
    DEFAULT_NUM_WORLDS, DEFAULT_ROLLOUT_DEPTH, INFO_PENALTY,
)

# Default model path
DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "models", "apex_value_model.pkl"
)

# Value augmentation parameters
DEFAULT_VALUE_WEIGHT = 3.0       # DW-unit impact of max value difference
DEFAULT_CLOSE_CALL_BAND = 3.0    # Only augment when DW margin < this
DEFAULT_OVERRIDE_THRESHOLD = 0.08 # Min P(win) delta to flip a close call


def _load_value_model(model_path=None):
    """Try to load the value model. Returns None if unavailable."""
    from gin_rummy.value_model import LearnedValueModel
    path = model_path or DEFAULT_MODEL_PATH
    try:
        if os.path.exists(path):
            return LearnedValueModel.load(path)
    except Exception:
        pass
    return None


def evaluate_draw_choice_augmented(
    hand, top_discard, opponent_model, game_state,
    value_model=None,
    num_worlds=DEFAULT_NUM_WORLDS,
    rollout_depth=DEFAULT_ROLLOUT_DEPTH,
    info_penalty=INFO_PENALTY,
    rng=None,
    value_weight=DEFAULT_VALUE_WEIGHT,
    close_call_band=DEFAULT_CLOSE_CALL_BAND,
    override_threshold=DEFAULT_OVERRIDE_THRESHOLD,
):
    """
    Value-augmented draw search.

    Runs the same Monte Carlo world-sampling draw evaluation as the
    baseline, but supplements the deadwood EV with a small value-model
    correction when the deadwood margin is within the close-call band.

    The correction is computed as:
      value_adjustment = value_weight * (take_pwin - stock_pwin)

    This is SUBTRACTED from the take EV (since lower DW is better):
      adjusted_take_ev = raw_take_ev - value_adjustment

    So if the value model says "take is more likely to win," the
    effective deadwood for take is nudged lower (better).

    Returns:
        (should_take, take_ev, stock_ev, diagnostics)
    """
    import random as _random
    if rng is None:
        rng = _random.Random()

    hand_set = set(hand)
    current_dw = compute_deadwood(hand)

    unseen = opponent_model.sample_unseen_cards()
    if len(unseen) < 3:
        return None, 0.0, 0.0, {
            'skipped': True, 'reason': 'too_few_unseen',
            'value_consulted': False, 'value_changed_answer': False,
        }

    take_dw_sum = 0.0
    stock_dw_sum = 0.0
    worlds_evaluated = 0

    # Collect leaf features for batched prediction (perf optimization)
    collect_features = (value_model is not None and value_weight > 0)
    take_feature_batch = []
    stock_feature_batch = []

    for _ in range(num_worlds):
        shuffled_unseen = list(unseen)
        rng.shuffle(shuffled_unseen)

        # === TAKE path ===
        take_hand = list(hand) + [top_discard]
        take_dw = _best_discard_dw(take_hand, restricted=top_discard)
        rollout_hand_take = _get_hand_after_best_discard(take_hand, restricted=top_discard)
        take_rollout_dw = _rollout_dw(rollout_hand_take, shuffled_unseen, rollout_depth, rng)

        # === STOCK path ===
        if not shuffled_unseen:
            continue
        stock_card = shuffled_unseen[0]
        stock_hand = list(hand) + [stock_card]
        stock_dw = _best_discard_dw(stock_hand, restricted=None)
        rollout_hand_stock = _get_hand_after_best_discard(stock_hand, restricted=None)
        remaining_stock = shuffled_unseen[1:]
        stock_rollout_dw = _rollout_dw(rollout_hand_stock, remaining_stock, rollout_depth, rng)

        take_dw_sum += take_rollout_dw
        stock_dw_sum += stock_rollout_dw

        # Collect features for batched value model prediction
        if collect_features:
            try:
                take_feature_batch.append(encode_pbs(rollout_hand_take, game_state))
                stock_feature_batch.append(encode_pbs(rollout_hand_stock, game_state))
            except Exception:
                pass

        worlds_evaluated += 1

    # Batched value model prediction (single call instead of per-world)
    take_value_sum = 0.0
    stock_value_sum = 0.0
    value_evals = 0
    if collect_features and take_feature_batch:
        try:
            X_take = np.array(take_feature_batch, dtype=np.float32)
            X_stock = np.array(stock_feature_batch, dtype=np.float32)
            take_preds = value_model.predict_proba(X_take)
            stock_preds = value_model.predict_proba(X_stock)
            take_value_sum = float(np.sum(take_preds))
            stock_value_sum = float(np.sum(stock_preds))
            value_evals = len(take_feature_batch)
        except Exception:
            pass

    if worlds_evaluated == 0:
        return None, 0.0, 0.0, {
            'skipped': True, 'reason': 'no_worlds',
            'value_consulted': False, 'value_changed_answer': False,
        }

    # Compute deadwood EVs
    take_ev = take_dw_sum / worlds_evaluated
    stock_ev = stock_dw_sum / worlds_evaluated

    # Apply info penalty
    adjusted_take_ev = take_ev + info_penalty

    # Deadwood-only decision
    dw_margin = stock_ev - adjusted_take_ev
    dw_decision = adjusted_take_ev < stock_ev  # True = take is better

    # Value augmentation: only in close-call band
    value_consulted = False
    value_changed_answer = False
    value_adjustment = 0.0
    take_pwin_avg = 0.0
    stock_pwin_avg = 0.0

    if (value_model is not None and value_weight > 0 and
            value_evals > 0 and abs(dw_margin) < close_call_band):

        value_consulted = True
        take_pwin_avg = take_value_sum / value_evals
        stock_pwin_avg = stock_value_sum / value_evals

        pwin_delta = take_pwin_avg - stock_pwin_avg

        # Only adjust if the value model has a meaningful opinion
        if abs(pwin_delta) >= override_threshold:
            # Convert P(win) delta into DW-space adjustment
            # Positive pwin_delta means take is better → lower take DW
            value_adjustment = value_weight * pwin_delta
            adjusted_take_ev -= value_adjustment

            # Check if this changed the decision
            new_decision = adjusted_take_ev < stock_ev
            if new_decision != dw_decision:
                value_changed_answer = True

    should_take = adjusted_take_ev < stock_ev

    diagnostics = {
        'skipped': False,
        'worlds_evaluated': worlds_evaluated,
        'take_ev_raw': take_ev,
        'take_ev_adjusted': adjusted_take_ev,
        'stock_ev': stock_ev,
        'current_dw': current_dw,
        'margin': stock_ev - adjusted_take_ev,
        'dw_margin': dw_margin,
        'dw_decision': dw_decision,
        'value_consulted': value_consulted,
        'value_changed_answer': value_changed_answer,
        'value_adjustment': value_adjustment,
        'value_evals': value_evals,
        'take_pwin_avg': take_pwin_avg,
        'stock_pwin_avg': stock_pwin_avg,
    }

    return should_take, adjusted_take_ev, stock_ev, diagnostics
