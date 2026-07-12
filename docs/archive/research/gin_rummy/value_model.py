"""
Gin Rummy Value Model: Win probability prediction from PBS features.

Provides both a handcrafted baseline predictor and a learned MLP model.
Both predict P(acting player wins the game) from the current public
belief state features.

The handcrafted baseline uses a simple linear combination of:
  - deadwood (lower is better)
  - score differential (higher is better)
  - meld count (more is better)

The learned model is a scikit-learn MLPClassifier trained on self-play data.
"""

import os
import math
import pickle
import numpy as np
from gin_rummy.pbs_features import FEATURE_DIM


# ── Feature indices (must match pbs_features.py) ──────────────────
# These are hardcoded positions in the feature vector
IDX_DEADWOOD_NORM = 53        # deadwood_norm
IDX_MELD_COUNT = 54           # meld_count
IDX_CAN_KNOCK = 57            # can_knock
IDX_IS_GIN = 58               # is_gin
IDX_MY_SCORE_NORM = 121       # my_score_norm
IDX_OPP_SCORE_NORM = 122      # opp_score_norm
IDX_SCORE_DIFF_NORM = 123     # score_diff_norm
IDX_TURN_NORM = 127           # turn_norm
IDX_DECK_REMAINING_NORM = 128 # deck_remaining_norm


class BaselinePredictor:
    """
    Handcrafted win probability baseline.

    Uses a simple logistic model based on deadwood and score differential.
    This is the "simple handcrafted baseline" required by the directive.
    """

    def predict_proba(self, X):
        """
        Predict win probability for each sample.

        Args:
            X: numpy array of shape (N, FEATURE_DIM)

        Returns:
            numpy array of shape (N,) with win probabilities
        """
        if X.ndim == 1:
            X = X.reshape(1, -1)

        probs = np.zeros(X.shape[0])
        for i in range(X.shape[0]):
            probs[i] = self._predict_single(X[i])
        return probs

    def _predict_single(self, features):
        """Predict win probability for a single feature vector."""
        dw_norm = features[IDX_DEADWOOD_NORM]       # 0-1, lower is better
        score_diff = features[IDX_SCORE_DIFF_NORM]  # -1 to 1
        meld_count = features[IDX_MELD_COUNT]       # 0-4 typically
        can_knock = features[IDX_CAN_KNOCK]         # 0 or 1
        is_gin = features[IDX_IS_GIN]               # 0 or 1
        turn_norm = features[IDX_TURN_NORM]          # 0-1

        # Linear combination into logit
        logit = (
            0.0                           # bias (50% base)
            - 3.0 * dw_norm               # lower deadwood → higher win prob
            + 2.0 * score_diff            # ahead on score → higher win prob
            + 0.3 * meld_count            # more melds → slightly better
            + 0.5 * can_knock             # ability to knock is positive
            + 2.0 * is_gin                # gin is very positive
            - 0.2 * turn_norm             # later in game slightly worse (more uncertain)
        )

        # Sigmoid to get probability
        prob = 1.0 / (1.0 + math.exp(-logit))
        return prob


class LearnedValueModel:
    """
    Wrapper around a scikit-learn MLPClassifier for value prediction.

    Provides save/load functionality and a consistent predict_proba interface.
    """

    def __init__(self, model=None):
        self.model = model

    def predict_proba(self, X):
        """
        Predict win probability for each sample.

        Args:
            X: numpy array of shape (N, FEATURE_DIM) or (FEATURE_DIM,)

        Returns:
            numpy array of shape (N,) with win probabilities
        """
        if self.model is None:
            raise RuntimeError("Model not loaded/trained")

        if X.ndim == 1:
            X = X.reshape(1, -1)

        # MLPClassifier.predict_proba returns (N, 2) for binary classification
        proba = self.model.predict_proba(X)
        return proba[:, 1]  # P(class=1) = P(win)

    def predict_single(self, features):
        """Predict win probability for a single feature vector (list or array)."""
        X = np.array(features, dtype=np.float32).reshape(1, -1)
        return float(self.predict_proba(X)[0])

    def save(self, path):
        """Save model to disk."""
        os.makedirs(os.path.dirname(path) if os.path.dirname(path) else '.', exist_ok=True)
        with open(path, 'wb') as f:
            pickle.dump(self.model, f)

    @classmethod
    def load(cls, path):
        """Load model from disk."""
        with open(path, 'rb') as f:
            model = pickle.load(f)
        return cls(model=model)


def train_value_model(X_train, y_train, hidden_layers=(128, 64, 32),
                       max_iter=500, random_state=42, verbose=False):
    """
    Train an MLP value model on self-play data.

    Args:
        X_train: (N, FEATURE_DIM) training features
        y_train: (N,) binary labels
        hidden_layers: MLP hidden layer sizes
        max_iter: maximum training iterations
        random_state: random seed for reproducibility
        verbose: print training progress

    Returns:
        LearnedValueModel
    """
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler

    # Create a pipeline manually to include scaler
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_train)

    clf = MLPClassifier(
        hidden_layer_sizes=hidden_layers,
        activation='relu',
        solver='adam',
        alpha=1e-4,             # L2 regularization
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

    # Wrap in a ScaledModel that applies the scaler at prediction time
    wrapped = _ScaledMLPModel(scaler, clf)
    return LearnedValueModel(model=wrapped)


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
