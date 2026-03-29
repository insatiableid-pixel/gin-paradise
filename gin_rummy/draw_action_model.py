"""
Draw Action Model: Learned model for draw decision quality.

Two model types:
  1. DrawActionClassifier: binary classifier predicting P(take is better)
  2. DrawActionRegressor: regression model predicting action_delta

Both use the same action-conditioned feature encoding.
Also provides handcrafted baselines for comparison:
  - DeadwoodBaseline: take if DW improves
  - ApexHeuristicBaseline: mirrors Apex's draw rules
"""

import os
import math
import pickle
import numpy as np
from gin_rummy.action_features import ACTION_FEATURE_DIM


# Feature index constants (must match action_features.py)
IDX_DW_SWING = 8          # dw_swing_norm
IDX_DW_IMPROVES = 9       # dw_improves
IDX_COMPLETES_MELD = 11   # completes_meld
IDX_CARD_RANK = 0          # card_rank_norm
IDX_CARD_DW = 1            # card_dw_norm
IDX_CURRENT_DW = 6         # current_dw_norm
IDX_TAKE_DW = 7            # best_take_dw_norm
IDX_TAKE_KNOCK = 10        # take_reaches_knock
IDX_SAME_RANK = 14         # same_rank_partners
IDX_ADJ_SUIT = 15          # adj_suit_partners
IDX_TURN = 32              # turn_norm
IDX_IS_EARLY = 34          # is_early


class DeadwoodBaseline:
    """
    Simple baseline: take if it improves deadwood.

    Predictions are based on:
      - DW improvement (primary)
      - Meld completion (bonus)
      - Card DW value penalty (info cost proxy)
    """

    def predict_proba(self, X):
        """Predict P(take is better) for each sample."""
        if X.ndim == 1:
            X = X.reshape(1, -1)
        probs = np.zeros(X.shape[0])
        for i in range(X.shape[0]):
            probs[i] = self._predict_single(X[i])
        return probs

    def predict(self, X):
        """Predict binary take_better for each sample."""
        probs = self.predict_proba(X)
        return (probs > 0.5).astype(np.float32)

    def _predict_single(self, f):
        dw_swing = f[IDX_DW_SWING] * 50.0      # unnormalize
        completes = f[IDX_COMPLETES_MELD]
        card_dw = f[IDX_CARD_DW] * 10.0

        # Simple decision rule: take if DW improves enough
        logit = (
            -0.5                    # bias toward stock (info cost)
            + 0.15 * dw_swing       # DW improvement
            + 2.0 * completes       # meld completion
            - 0.1 * card_dw         # high-DW cards cost more to reveal
        )
        return 1.0 / (1.0 + math.exp(-logit))


class ApexHeuristicBaseline:
    """
    Baseline mimicking Apex's draw heuristic logic.

    Takes if:
      1. Completes a meld
      2. Card is Ace/Two (rank <= 1)
      3. DW improvement >= 4
      4. Forms triangle in early game
      5. Low-DW double in early/mid game
    """

    def predict_proba(self, X):
        if X.ndim == 1:
            X = X.reshape(1, -1)
        probs = np.zeros(X.shape[0])
        for i in range(X.shape[0]):
            probs[i] = self._predict_single(X[i])
        return probs

    def predict(self, X):
        probs = self.predict_proba(X)
        return (probs > 0.5).astype(np.float32)

    def _predict_single(self, f):
        completes = f[IDX_COMPLETES_MELD]
        card_rank = f[IDX_CARD_RANK] * 12.0
        dw_swing = f[IDX_DW_SWING] * 50.0
        is_early = f[IDX_IS_EARLY]
        same_rank = f[IDX_SAME_RANK] * 3.0
        adj_suit = f[IDX_ADJ_SUIT] * 4.0
        card_dw = f[IDX_CARD_DW] * 10.0
        turn = f[IDX_TURN] * 50.0
        dw_improves = f[IDX_DW_IMPROVES]

        # Rule-based: completes meld → take
        if completes > 0.5:
            return 0.95

        # Low-rank always take (Ace, 2)
        if card_rank <= 1.5:
            return 0.85

        # DW improvement >= 4
        if dw_swing >= 4.0:
            return 0.8

        # Triangle in early game
        if is_early > 0.5 and same_rank >= 1 and adj_suit >= 1 and dw_improves > 0.5:
            return 0.7

        # Low-DW double in early/mid
        if turn < 10 and card_dw <= 3 and (same_rank >= 1 or adj_suit >= 1) and dw_improves > 0.5:
            return 0.65

        # Default: don't take
        return 0.15


class LearnedDrawActionModel:
    """
    Wrapper around a learned model for draw action prediction.

    Supports both classification (predict_proba) and the underlying
    model's predict method.
    """

    def __init__(self, model=None):
        self.model = model

    def predict_proba(self, X):
        """Predict P(take is better) for each sample."""
        if self.model is None:
            raise RuntimeError("Model not loaded/trained")
        if X.ndim == 1:
            X = X.reshape(1, -1)

        proba = self.model.predict_proba(X)
        return proba[:, 1]  # P(class=1) = P(take is better)

    def predict(self, X):
        """Predict binary take_better."""
        if self.model is None:
            raise RuntimeError("Model not loaded/trained")
        if X.ndim == 1:
            X = X.reshape(1, -1)
        return self.model.predict(X)

    def predict_single(self, features):
        """Predict P(take is better) for a single feature vector."""
        X = np.array(features, dtype=np.float32).reshape(1, -1)
        return float(self.predict_proba(X)[0])

    def save(self, path):
        os.makedirs(os.path.dirname(path) if os.path.dirname(path) else '.', exist_ok=True)
        with open(path, 'wb') as f:
            pickle.dump(self.model, f)

    @classmethod
    def load(cls, path):
        with open(path, 'rb') as f:
            model = pickle.load(f)
        return cls(model=model)


class _ScaledMLPModel:
    """Internal wrapper that applies StandardScaler before MLP prediction."""

    def __init__(self, scaler, mlp):
        self.scaler = scaler
        self.mlp = mlp

    def predict_proba(self, X):
        X_scaled = self.scaler.transform(X)
        return self.mlp.predict_proba(X_scaled)

    def predict(self, X):
        X_scaled = self.scaler.transform(X)
        return self.mlp.predict(X_scaled)


def train_draw_action_model(X_train, y_train, hidden_layers=(64, 32, 16),
                             max_iter=500, random_state=42, verbose=False):
    """
    Train an MLP classifier for draw action prediction.

    Args:
        X_train: (N, ACTION_FEATURE_DIM) training features
        y_train: (N,) binary labels (take_better)
        hidden_layers: MLP hidden layer sizes
        max_iter: max training iterations
        random_state: seed
        verbose: print progress

    Returns:
        LearnedDrawActionModel
    """
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_train)

    clf = MLPClassifier(
        hidden_layer_sizes=hidden_layers,
        activation='relu',
        solver='adam',
        alpha=1e-4,
        batch_size=256,
        learning_rate='adaptive',
        learning_rate_init=1e-3,
        max_iter=max_iter,
        random_state=random_state,
        early_stopping=True,
        validation_fraction=0.1,
        n_iter_no_change=20,
        verbose=verbose,
    )

    clf.fit(X_scaled, y_train)

    wrapped = _ScaledMLPModel(scaler, clf)
    return LearnedDrawActionModel(model=wrapped)
