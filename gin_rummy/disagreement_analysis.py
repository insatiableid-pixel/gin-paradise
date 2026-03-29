"""
Phase 63 Tasks B–D: Disagreement Analysis Engine.

Runs the Phase 62 solver over the Phase 63 expanded corpus, clusters
disagreements by structural axes, and estimates real-world importance.

Key outputs:
  1. Per-spot solver results with champion comparison
  2. Disagreement clustering by (stock_bucket, dw_bucket, texture, score_bucket)
  3. Frequency estimation from natural-corpus statistics
  4. Aggregate cost estimation

All analysis strictly separates natural / oversampled / synthetic corpora.
"""

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple

from gin_rummy.card import hand_str, card_str, deadwood_value
from gin_rummy.meld import best_meld_arrangement, compute_deadwood
from gin_rummy.endgame_solver import PublicState, what_would_champion_do
from gin_rummy.solver_v2 import solve_spot_v2, CONTINUATION_CHAMPION
from gin_rummy.disagreement_miner import (
    DisagreementSpot, CORPUS_NATURAL, CORPUS_OVERSAMPLED, CORPUS_SYNTHETIC,
    classify_hand_texture,
)


# ── Solver Runner ─────────────────────────────────────────────────────

def run_solver_on_corpus(
    spots: List[DisagreementSpot],
    n_worlds: int = 300,
    seed: int = 42,
    verbose: bool = False,
) -> List[DisagreementSpot]:
    """
    Run the Phase 62 solver on each spot and populate solver results.
    
    Modifies spots in place with solver_action, ev_knock, ev_continue, etc.
    """
    t0 = time.time()
    
    for i, spot in enumerate(spots):
        try:
            result = solve_spot_v2(
                hero_hand=spot.hero_hand,
                public_state=spot.public_state,
                n_worlds=n_worlds,
                seed=seed + i,
                continuation_mode=CONTINUATION_CHAMPION,
                use_empirical_equity=True,
            )
            
            # Champion comparison
            champ_action, champ_reason = what_would_champion_do(
                spot.hero_hand, spot.public_state
            )
            
            spot.champion_action = champ_action
            spot.solver_action = result.recommended_action
            spot.ev_knock = result.knock_now.net_expected_points
            spot.ev_continue = result.continue_play.net_expected_points
            spot.ev_diff = spot.ev_knock - spot.ev_continue
            spot.me_knock = result.match_equity_knock or 0.0
            spot.me_continue = result.match_equity_continue or 0.0
            spot.is_disagreement = (spot.champion_action != spot.solver_action)
            
        except ValueError:
            # Skip invalid spots (e.g., DW > 10 after perturbation check fails)
            spot.champion_action = 'error'
            spot.solver_action = 'error'
            spot.is_disagreement = False
        
        if verbose and (i + 1) % 20 == 0:
            elapsed = time.time() - t0
            print(f"  Solved {i+1}/{len(spots)} spots ({elapsed:.1f}s)")
    
    elapsed = time.time() - t0
    if verbose:
        print(f"  Solver complete: {len(spots)} spots in {elapsed:.1f}s")
    
    return spots


# ── Disagreement Clustering ──────────────────────────────────────────

@dataclass
class DisagreementCluster:
    """A cluster of disagreements sharing structural properties."""
    cluster_key: Tuple  # (stock_bucket, dw_bucket, texture, score_bucket)
    spots: List[DisagreementSpot] = field(default_factory=list)
    
    @property
    def n(self) -> int:
        return len(self.spots)
    
    @property
    def mean_ev_diff(self) -> float:
        if not self.spots:
            return 0.0
        return sum(s.ev_diff for s in self.spots) / len(self.spots)
    
    @property
    def mean_me_diff(self) -> float:
        if not self.spots:
            return 0.0
        return sum(s.me_knock - s.me_continue for s in self.spots) / len(self.spots)
    
    @property
    def mean_dw(self) -> float:
        if not self.spots:
            return 0.0
        return sum(s.hero_deadwood for s in self.spots) / len(self.spots)
    
    @property
    def mean_stock(self) -> float:
        if not self.spots:
            return 0.0
        return sum(s.stock_size for s in self.spots) / len(self.spots)
    
    @property
    def label(self) -> str:
        return '_'.join(str(k) for k in self.cluster_key)
    
    def summary(self) -> dict:
        return {
            'cluster_key': self.cluster_key,
            'count': self.n,
            'mean_ev_diff': round(self.mean_ev_diff, 2),
            'mean_me_diff': round(self.mean_me_diff, 4),
            'mean_dw': round(self.mean_dw, 1),
            'mean_stock': round(self.mean_stock, 1),
            'textures': self._texture_dist(),
        }
    
    def _texture_dist(self) -> Dict[str, int]:
        d = {}
        for s in self.spots:
            d[s.hand_texture] = d.get(s.hand_texture, 0) + 1
        return d


def cluster_disagreements(
    spots: List[DisagreementSpot],
) -> Dict[Tuple, DisagreementCluster]:
    """
    Cluster disagreement spots by structural axes.
    
    Axes:
      - stock_bucket: stock_1_2, stock_3_4, stock_5_6
      - dw_bucket: dw_0_2, dw_3_5, dw_6_8, dw_9_10
      - hand_texture: fragmented, concentrated, gin_live
      - score_bucket: early_game, mid_game, late_game
    """
    clusters = {}
    
    disagreements = [s for s in spots if s.is_disagreement]
    
    for spot in disagreements:
        key = (spot.stock_bucket, spot.dw_bucket, spot.hand_texture, spot.score_bucket)
        if key not in clusters:
            clusters[key] = DisagreementCluster(cluster_key=key)
        clusters[key].spots.append(spot)
    
    return clusters


# ── Frequency and Cost Estimation ────────────────────────────────────

@dataclass
class FrequencyEstimate:
    """Frequency and cost estimates for a disagreement class."""
    total_natural_spots: int = 0
    total_natural_disagreements: int = 0
    disagreement_rate: float = 0.0  # Fraction of low-stock legal-knock states
    mean_conditional_ev_loss: float = 0.0  # When wrong, how big is the loss
    mean_conditional_me_loss: float = 0.0
    aggregate_ev_cost_per_spot: float = 0.0  # disagreement_rate * mean_loss
    classification: str = ''  # rare_negligible, rare_large, common_small, common_meaningful
    
    # DW-region breakdown
    dw_5_10_total: int = 0
    dw_5_10_disagreements: int = 0
    dw_5_10_rate: float = 0.0
    
    dw_0_4_total: int = 0
    dw_0_4_disagreements: int = 0
    dw_0_4_rate: float = 0.0


def estimate_frequency_and_cost(
    natural_spots: List[DisagreementSpot],
) -> FrequencyEstimate:
    """
    Estimate real-world frequency and cost from natural-frequency corpus.
    
    This is the most important analytical output of Phase 63.
    Only uses natural-frequency spots for honest estimation.
    """
    est = FrequencyEstimate()
    
    est.total_natural_spots = len(natural_spots)
    disagreements = [s for s in natural_spots if s.is_disagreement]
    est.total_natural_disagreements = len(disagreements)
    
    if est.total_natural_spots > 0:
        est.disagreement_rate = len(disagreements) / est.total_natural_spots
    
    if disagreements:
        # Conditional severity: how much value is left on the table
        losses = [abs(s.ev_diff) for s in disagreements]
        est.mean_conditional_ev_loss = sum(losses) / len(losses)
        
        me_losses = [abs(s.me_knock - s.me_continue) for s in disagreements]
        est.mean_conditional_me_loss = sum(me_losses) / len(me_losses)
    
    # Aggregate cost per low-stock legal-knock state
    est.aggregate_ev_cost_per_spot = est.disagreement_rate * est.mean_conditional_ev_loss
    
    # DW-region breakdown
    dw_5_10 = [s for s in natural_spots if 5 <= s.hero_deadwood <= 10]
    dw_0_4 = [s for s in natural_spots if s.hero_deadwood <= 4]
    
    est.dw_5_10_total = len(dw_5_10)
    est.dw_5_10_disagreements = len([s for s in dw_5_10 if s.is_disagreement])
    if est.dw_5_10_total > 0:
        est.dw_5_10_rate = est.dw_5_10_disagreements / est.dw_5_10_total
    
    est.dw_0_4_total = len(dw_0_4)
    est.dw_0_4_disagreements = len([s for s in dw_0_4 if s.is_disagreement])
    if est.dw_0_4_total > 0:
        est.dw_0_4_rate = est.dw_0_4_disagreements / est.dw_0_4_total
    
    # Classify aggregate importance
    rate = est.disagreement_rate
    severity = est.mean_conditional_ev_loss
    
    if rate < 0.05 and severity < 5.0:
        est.classification = 'rare_negligible'
    elif rate < 0.05 and severity >= 5.0:
        est.classification = 'rare_large'
    elif rate >= 0.05 and severity < 5.0:
        est.classification = 'common_small'
    else:
        est.classification = 'common_meaningful'
    
    return est


# ── Full Analysis Pipeline ────────────────────────────────────────────

@dataclass
class AnalysisResult:
    """Complete Phase 63 analysis result."""
    corpus_summary: Dict = field(default_factory=dict)
    natural_clusters: Dict = field(default_factory=dict)
    oversampled_clusters: Dict = field(default_factory=dict)
    synthetic_clusters: Dict = field(default_factory=dict)
    frequency_estimate: Optional[FrequencyEstimate] = None
    all_spots: List[DisagreementSpot] = field(default_factory=list)
    timing: Dict = field(default_factory=dict)


def run_full_analysis(
    corpus: Dict[str, List[DisagreementSpot]],
    n_worlds: int = 300,
    verbose: bool = False,
) -> AnalysisResult:
    """
    Run the complete Phase 63 analysis pipeline.
    
    Steps:
      1. Run solver on all spots
      2. Cluster disagreements per corpus type
      3. Estimate frequency and cost from natural corpus
    """
    result = AnalysisResult()
    t0 = time.time()
    
    # 1. Run solver on each corpus (separately)
    for corpus_type, spots in corpus.items():
        if verbose:
            print(f"\n=== Running solver on {corpus_type} corpus ({len(spots)} spots) ===")
        run_solver_on_corpus(spots, n_worlds=n_worlds, verbose=verbose)
        result.all_spots.extend(spots)
    
    result.timing['solver_seconds'] = round(time.time() - t0, 1)
    
    # 2. Cluster disagreements per corpus type
    if 'natural' in corpus:
        result.natural_clusters = cluster_disagreements(corpus['natural'])
    if 'oversampled' in corpus:
        result.oversampled_clusters = cluster_disagreements(corpus['oversampled'])
    if 'synthetic' in corpus:
        result.synthetic_clusters = cluster_disagreements(corpus['synthetic'])
    
    # 3. Frequency and cost estimation (natural only)
    if 'natural' in corpus:
        result.frequency_estimate = estimate_frequency_and_cost(corpus['natural'])
    
    # 4. Corpus summary
    for corpus_type, spots in corpus.items():
        total = len(spots)
        disagreements = sum(1 for s in spots if s.is_disagreement)
        result.corpus_summary[corpus_type] = {
            'total_spots': total,
            'disagreements': disagreements,
            'rate': round(disagreements / total, 4) if total > 0 else 0,
            'mean_ev_diff_disagree': round(
                sum(abs(s.ev_diff) for s in spots if s.is_disagreement) / disagreements, 2
            ) if disagreements > 0 else 0,
        }
    
    result.timing['total_seconds'] = round(time.time() - t0, 1)
    
    return result


# ── Report Generation ─────────────────────────────────────────────────

def generate_analysis_report(
    result: AnalysisResult,
    corpus: Dict[str, List[DisagreementSpot]],
) -> str:
    """Generate a human-readable analysis report."""
    lines = []
    
    lines.append("# Phase 63 Disagreement Analysis Report")
    lines.append("")
    
    # Corpus summary
    lines.append("## 1. Corpus Summary")
    lines.append("")
    lines.append("| Corpus | Total Spots | Disagreements | Rate | Mean |EV Diff| |")
    lines.append("|--------|----------:|-------------:|-----:|-------:|")
    for ct, summary in result.corpus_summary.items():
        lines.append(
            f"| {ct} | {summary['total_spots']} | {summary['disagreements']} | "
            f"{summary['rate']:.1%} | {summary['mean_ev_diff_disagree']} |"
        )
    lines.append("")
    
    # Natural frequency findings
    if result.frequency_estimate:
        est = result.frequency_estimate
        lines.append("## 2. Natural-Frequency Findings")
        lines.append("")
        lines.append(f"- **Total natural spots:** {est.total_natural_spots}")
        lines.append(f"- **Natural disagreements:** {est.total_natural_disagreements}")
        lines.append(f"- **Disagreement rate:** {est.disagreement_rate:.1%}")
        lines.append(f"- **Mean conditional EV loss:** {est.mean_conditional_ev_loss:.2f} points")
        lines.append(f"- **Mean conditional ME loss:** {est.mean_conditional_me_loss:.4f}")
        lines.append(f"- **Aggregate EV cost per spot:** {est.aggregate_ev_cost_per_spot:.3f}")
        lines.append(f"- **Classification:** {est.classification}")
        lines.append("")
        lines.append("### DW Region Breakdown (Natural)")
        lines.append("")
        lines.append(f"| Region | Total | Disagree | Rate |")
        lines.append(f"|--------|------:|---------:|-----:|")
        lines.append(
            f"| DW 0–4 | {est.dw_0_4_total} | {est.dw_0_4_disagreements} | "
            f"{est.dw_0_4_rate:.1%} |"
        )
        lines.append(
            f"| DW 5–10 | {est.dw_5_10_total} | {est.dw_5_10_disagreements} | "
            f"{est.dw_5_10_rate:.1%} |"
        )
        lines.append("")
    
    # Cluster analysis
    for label, clusters in [
        ("Natural", result.natural_clusters),
        ("Oversampled", result.oversampled_clusters),
        ("Synthetic", result.synthetic_clusters),
    ]:
        if not clusters:
            continue
        lines.append(f"## 3. Disagreement Clusters ({label})")
        lines.append("")
        lines.append("| Stock | DW | Texture | Score | Count | Mean EV Diff | Mean ME Diff |")
        lines.append("|-------|-----|---------|-------|------:|----------:|----------:|")
        
        sorted_clusters = sorted(clusters.items(), key=lambda x: -x[1].n)
        for key, cluster in sorted_clusters:
            s = cluster.summary()
            lines.append(
                f"| {key[0]} | {key[1]} | {key[2]} | {key[3]} | "
                f"{s['count']} | {s['mean_ev_diff']:+.1f} | {s['mean_me_diff']:+.4f} |"
            )
        lines.append("")
    
    # Timing
    lines.append("## 4. Timing")
    lines.append("")
    for k, v in result.timing.items():
        lines.append(f"- {k}: {v}s")
    lines.append("")
    
    # Example disagreement spots
    all_disagree = [s for s in result.all_spots if s.is_disagreement]
    if all_disagree:
        lines.append("## 5. Example Disagreement Spots")
        lines.append("")
        
        # Show top disagreements by EV diff magnitude
        sorted_by_diff = sorted(all_disagree, key=lambda x: -abs(x.ev_diff))[:10]
        
        for spot in sorted_by_diff:
            lines.append(f"### {spot.to_dict()['id']}")
            lines.append(f"- DW={spot.hero_deadwood}, Stock={spot.stock_size}, "
                        f"Score={spot.score_state}")
            lines.append(f"- Texture: {spot.hand_texture}, DW cards: {spot.dw_card_count}")
            lines.append(f"- Corpus: {spot.corpus_type}")
            lines.append(f"- Champion: {spot.champion_action}, Solver: {spot.solver_action}")
            lines.append(f"- EV: knock={spot.ev_knock:+.1f}, continue={spot.ev_continue:+.1f}, "
                        f"diff={spot.ev_diff:+.1f}")
            lines.append(f"- ME: knock={spot.me_knock:+.4f}, continue={spot.me_continue:+.4f}")
            lines.append(f"- Hand: {hand_str(spot.hero_hand)}")
            lines.append("")
    
    return '\n'.join(lines)
