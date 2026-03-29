"""
Discard Action Model: Learned model for discard candidate ranking.

Provides:
  1. LearnedDiscardModel: MLP-based candidate ranker
  2. DeadwoodDiscardBaseline: pure post-discard DW minimizer
  3. ApexHeuristicDiscardBaseline: mirrors Apex's discard heuristic pipeline

The model scores each candidate discard from a post-draw 11-card hand
and ranks them. The training objective uses normalized utility labels
computed via paired continuation rollouts.
"""

import os
import math
import pickle
import numpy as np
from gin_rummy.discard_action_features import DISCARD_FEATURE_DIM


# Feature index constants (must match discard_action_features.py)
IDX_CARD_DW = 1              # card_dw_norm
IDX_POST_DW = 6              # post_discard_dw_norm
IDX_BEST_POST_DW = 7         # best_post_dw_norm
IDX_DW_DELTA = 8             # dw_delta_from_best
IDX_IS_DW_OPTIMAL = 9        # is_dw_optimal
IDX_IN_MELD = 10             # in_meld_11
IDX_MELD_DELTA = 11          # meld_count_delta
IDX_MELDS_INVOLVING = 12     # melds_involving_candidate
IDX_IS_HIGHEST_DW = 13       # is_highest_dw_card
IDX_SAME_RANK = 14           # same_rank_partners
IDX_ADJ_SUIT = 15            # adj_suit_partners
IDX_NEAR_MELD_LOSS = 16      # near_meld_loss
IDX_OPP_WEIGHT = 18          # opp_card_weight
IDX_OPP_RELATED = 19         # opp_related_cards
IDX_BLOCKED_PATHS = 21       # blocked_meld_paths


class DeadwoodDiscardBaseline:
    """
    Pure deadwood minimization baseline: score = -post_discard_dw.

    Always picks the discard that minimizes resulting deadwood.
    This is essentially Phase 2 of Apex's discard pipeline.
    """

    def score_candidates(self, X):
        """Score candidates. Higher = better to discard."""
        if X.ndim == 1:
            X = X.reshape(1, -1)
        # Higher DW value card with lower remaining DW = better discard
        # Negate post-discard DW so lower remaining DW gets higher score
        scores = -X[:, IDX_POST_DW] + X[:, IDX_CARD_DW] * 0.1
        return scores

    def rank_candidates(self, X):
        """Return indices sorted by score (best discard first)."""
        scores = self.score_candidates(X)
        return np.argsort(-scores)


class ApexHeuristicDiscardBaseline:
    """
    Baseline mimicking Apex's full two-phase discard heuristic.

    Phase 1: heuristic score = DW_value * 100 - near_meld * 30 - safety * 15
    Phase 2: actual DW verification on top candidates
    """

    def score_candidates(self, X):
        """Score candidates using Apex-like heuristic. Higher = better to discard."""
        if X.ndim == 1:
            X = X.reshape(1, -1)
        scores = np.zeros(X.shape[0])
        for i in range(X.shape[0]):
            scores[i] = self._score_single(X[i])
        return scores

    def _score_single(self, f):
        card_dw = f[IDX_CARD_DW] * 10.0
        post_dw = f[IDX_POST_DW] * 100.0
        in_meld = f[IDX_IN_MELD]
        near_meld_loss = f[IDX_NEAR_MELD_LOSS] * 5.0
        same_rank = f[IDX_SAME_RANK] * 3.0
        adj_suit = f[IDX_ADJ_SUIT] * 4.0
        opp_weight = f[IDX_OPP_WEIGHT] * 5.0
        opp_related = f[IDX_OPP_RELATED] * 4.0
        blocked = f[IDX_BLOCKED_PATHS]

        # Phase 1: heuristic scoring
        score = card_dw * 100  # Higher DW = better to discard

        # Near-meld penalty (don't discard cards with partners)
        near_meld_value = same_rank + adj_suit
        score -= near_meld_value * 30

        # Safety penalty (don't discard what opponent wants)
        safety = opp_weight + opp_related
        score -= safety * 15

        # Strong penalty for discarding melded cards
        if in_meld > 0.5:
            score -= 500

        # Bonus for cards with all meld paths blocked
        score += blocked * 20

        # Phase 2: DW verification (dominant factor)
        score -= post_dw * 2  # Lower resulting DW = better

        return score

    def rank_candidates(self, X):
        """Return indices sorted by score (best discard first)."""
        scores = self.score_candidates(X)
        return np.argsort(-scores)


class LearnedDiscardModel:
    """
    Wrapper around a learned model for discard candidate scoring.

    Supports scoring and ranking of discard candidates.
    """

    def __init__(self, model=None):
        self.model = model

    def score_candidates(self, X):
        """Score candidates. Higher = better to discard (higher utility)."""
        if self.model is None:
            raise RuntimeError("Model not loaded/trained")
        if X.ndim == 1:
            X = X.reshape(1, -1)
        # Use model's predicted probability of being the "best" candidate
        proba = self.model.predict_proba(X)
        return proba[:, 1]  # P(class=1) = P(good discard)

    def score_single(self, features):
        """Score a single candidate feature vector."""
        X = np.array(features, dtype=np.float32).reshape(1, -1)
        return float(self.score_candidates(X)[0])

    def rank_candidates(self, X):
        """Return indices sorted by score (best discard first)."""
        scores = self.score_candidates(X)
        return np.argsort(-scores)

    def predict_best(self, X):
        """Return index of the highest-scored candidate."""
        scores = self.score_candidates(X)
        return int(np.argmax(scores))

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


def train_discard_model(X_train, y_train, hidden_layers=(128, 64, 32),
                         max_iter=500, random_state=42, verbose=False):
    """
    Train an MLP classifier for discard candidate scoring.

    Args:
        X_train: (N, DISCARD_FEATURE_DIM) training features
        y_train: (N,) binary labels (1 = near-optimal discard, 0 = suboptimal)
        hidden_layers: MLP hidden layer sizes
        max_iter: max training iterations
        random_state: seed
        verbose: print progress

    Returns:
        LearnedDiscardModel
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
    return LearnedDiscardModel(model=wrapped)
