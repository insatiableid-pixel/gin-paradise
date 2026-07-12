"""
Knock Action Model: Learned model for knock decision quality.

Two model types:
  1. LearnedKnockModel: MLP classifier predicting P(knock is better)
  2. Baselines for comparison:
     - AlwaysKnockBaseline: knock whenever legal
     - GoGinBaseline: only knock on gin (DW=0)
     - ApexKnockBaseline: mirrors Apex's knock rules
     - FirstKnockBaseline: knock at first opportunity (DW <= 10)
     - PaperInspiredBaseline: threshold rules from the knocking paper

All use the same knock-decision feature encoding.
"""

import os
import math
import pickle
import numpy as np
from gin_rummy.knock_features import KNOCK_FEATURE_DIM

# Feature index constants (must match knock_features.py)
IDX_DW_TOTAL = 0          # dw_total_norm
IDX_DW_CARDS = 1          # dw_card_count_norm
IDX_IS_GIN = 2            # is_gin
IDX_VERY_LOW_DW = 3       # very_low_dw
IDX_LOW_DW = 4            # low_dw
IDX_GIN_RATING = 11       # gin_rating
IDX_GIN_HITS = 12         # gin_hits_norm
IDX_ONE_DW = 13           # one_dw_card
IDX_FEW_DW = 14           # few_dw_cards
IDX_TURN = 17             # turn_norm
IDX_IS_EARLY = 19         # is_early
IDX_IS_LATE = 20          # is_late
IDX_LOW_STOCK = 21        # low_stock
IDX_MY_SCORE = 22         # my_score_norm
IDX_OPP_SCORE = 23        # opp_score_norm
IDX_SCORE_DIFF = 24       # score_diff_norm
IDX_KNOCK_WINS = 25       # knock_wins_game
IDX_WELL_AHEAD = 27       # well_ahead
IDX_WELL_BEHIND = 28      # well_behind
IDX_UNDERCUT_RISK = 30    # undercut_risk
IDX_SAFE_ZONE = 31        # safe_knock_zone
IDX_RISKY_ZONE = 33       # risky_knock_zone


class AlwaysKnockBaseline:
    """Trivial baseline: always knock when legal (DW <= 10)."""

    def predict_proba(self, X):
        if X.ndim == 1:
            X = X.reshape(1, -1)
        return np.ones(X.shape[0])

    def predict(self, X):
        return (self.predict_proba(X) > 0.5).astype(np.float32)


class GoGinBaseline:
    """Only knock on gin (DW = 0). Never knock otherwise."""

    def predict_proba(self, X):
        if X.ndim == 1:
            X = X.reshape(1, -1)
        probs = np.zeros(X.shape[0])
        for i in range(X.shape[0]):
            probs[i] = 1.0 if X[i, IDX_IS_GIN] > 0.5 else 0.0
        return probs

    def predict(self, X):
        return (self.predict_proba(X) > 0.5).astype(np.float32)


class FirstKnockBaseline:
    """Knock at first legal opportunity (DW <= 10), same as SimplePlayer."""

    def predict_proba(self, X):
        if X.ndim == 1:
            X = X.reshape(1, -1)
        # Always 1.0 since we only see legal knock states
        return np.ones(X.shape[0])

    def predict(self, X):
        return np.ones(X.shape[0] if X.ndim == 2 else 1, dtype=np.float32)


class ApexKnockBaseline:
    """
    Baseline mimicking Apex's knock heuristic logic.

    Rules (from Apex):
      1. Gin: always knock
      2. Low stock (<=8): always knock
      3. Well ahead (score_diff >= 22) + few DW cards + early: hold
      4. Well behind (score_diff <= -22) + few DW cards + early: hold
      5. DW <= 5: always knock
      6. Early (turn <= 3): knock aggressively
      7. Late (turn >= 13): knock
      8. Few DW cards (<=2): hold
      9. Otherwise: knock (simplified, no MC)
    """

    def predict_proba(self, X):
        if X.ndim == 1:
            X = X.reshape(1, -1)
        probs = np.zeros(X.shape[0])
        for i in range(X.shape[0]):
            probs[i] = self._predict_single(X[i])
        return probs

    def predict(self, X):
        return (self.predict_proba(X) > 0.5).astype(np.float32)

    def _predict_single(self, f):
        is_gin = f[IDX_IS_GIN] > 0.5
        low_stock = f[IDX_LOW_STOCK] > 0.5
        well_ahead = f[IDX_WELL_AHEAD] > 0.5
        well_behind = f[IDX_WELL_BEHIND] > 0.5
        few_dw = f[IDX_FEW_DW] > 0.5
        is_early = f[IDX_IS_EARLY] > 0.5
        is_late = f[IDX_IS_LATE] > 0.5
        low_dw = f[IDX_LOW_DW] > 0.5
        turn = f[IDX_TURN] * 30.0
        dw = f[IDX_DW_TOTAL] * 10.0

        # 1. Gin
        if is_gin:
            return 0.99

        # 2. Low stock
        if low_stock:
            return 0.95

        # 3. Well ahead + few DW + early → hold
        if well_ahead and dw > 0 and few_dw and turn < 12:
            return 0.15

        # 4. Well behind + few DW + early → hold
        if well_behind and dw > 0 and few_dw and turn < 12:
            return 0.15

        # 5. Low DW
        if low_dw:
            return 0.9

        # 6. Early game
        if turn <= 3:
            return 0.85

        # 7. Late game
        if turn >= 13:
            return 0.85

        # 8. Few DW cards → hold
        if few_dw:
            return 0.2

        # 9. Default: moderate knock tendency for DW 6-10
        return 0.6


class PaperInspiredBaseline:
    """
    Paper-inspired baseline using the knocking research paper's key ideas:
    - Consider gin liveness when deciding to hold
    - Score-aware gin pursuit (bigger gap → more reason to go for gin)
    - Turn-aware urgency
    """

    def predict_proba(self, X):
        if X.ndim == 1:
            X = X.reshape(1, -1)
        probs = np.zeros(X.shape[0])
        for i in range(X.shape[0]):
            probs[i] = self._predict_single(X[i])
        return probs

    def predict(self, X):
        return (self.predict_proba(X) > 0.5).astype(np.float32)

    def _predict_single(self, f):
        is_gin = f[IDX_IS_GIN] > 0.5
        gin_rating = f[IDX_GIN_RATING]
        gin_hits = f[IDX_GIN_HITS] * 8.0
        few_dw = f[IDX_FEW_DW] > 0.5
        turn = f[IDX_TURN] * 30.0
        dw = f[IDX_DW_TOTAL] * 10.0
        low_stock = f[IDX_LOW_STOCK] > 0.5
        score_diff = f[IDX_SCORE_DIFF]
        undercut_risk = f[IDX_UNDERCUT_RISK]

        # Always knock gin
        if is_gin:
            return 0.99

        # Low stock → knock
        if low_stock:
            return 0.95

        # Very low DW + late → knock
        if dw <= 3 and turn >= 6:
            return 0.9

        # Key paper idea: if gin-live (high rating + hits), hold
        if gin_rating >= 0.6 and gin_hits >= 2 and turn < 12:
            # Stronger hold signal when score gap is large
            hold_strength = 0.15 + 0.15 * min(1.0, abs(score_diff))
            return hold_strength

        # Moderate gin liveness + few DW cards → hold early
        if few_dw and gin_rating >= 0.3 and turn < 8:
            return 0.25

        # High undercut risk (DW 8-10) → be cautious
        if undercut_risk > 0.4 and turn < 10:
            return 0.35

        # Low DW → knock
        if dw <= 5:
            return 0.85

        # Very early → knock aggressively
        if turn <= 2:
            return 0.8

        # Late → knock
        if turn >= 12:
            return 0.85

        # Default
        return 0.55


class LearnedKnockModel:
    """
    Wrapper around a learned model for knock action prediction.

    Supports both classification (predict_proba) and the underlying
    model's predict method.
    """

    def __init__(self, model=None):
        self.model = model

    def predict_proba(self, X):
        """Predict P(knock is better) for each sample."""
        if self.model is None:
            raise RuntimeError("Model not loaded/trained")
        if X.ndim == 1:
            X = X.reshape(1, -1)

        proba = self.model.predict_proba(X)
        return proba[:, 1]  # P(class=1) = P(knock is better)

    def predict(self, X):
        """Predict binary knock_better."""
        if self.model is None:
            raise RuntimeError("Model not loaded/trained")
        if X.ndim == 1:
            X = X.reshape(1, -1)
        return self.model.predict(X)

    def predict_single(self, features):
        """Predict P(knock is better) for a single feature vector."""
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


def train_knock_model(X_train, y_train, hidden_layers=(64, 32, 16),
                      max_iter=500, random_state=42, verbose=False):
    """
    Train an MLP classifier for knock action prediction.

    Args:
        X_train: (N, KNOCK_FEATURE_DIM) training features
        y_train: (N,) binary labels (knock_better)
        hidden_layers: MLP hidden layer sizes
        max_iter: max training iterations
        random_state: seed
        verbose: print progress

    Returns:
        LearnedKnockModel
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
    return LearnedKnockModel(model=wrapped)
