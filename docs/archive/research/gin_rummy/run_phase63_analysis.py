"""
Phase 63 Analysis Runner: Mines spots, runs solver, and generates results.

This is the main analysis script for Phase 63.
It mines corpus, runs the full solver, and prints results.
"""

import time
import sys

from gin_rummy.disagreement_miner import (
    mine_disagreement_corpus, get_corpus_summary,
    NaturalFrequencyMiner, CoverageOversampledMiner, SyntheticPerturbationMiner,
    CORPUS_NATURAL, CORPUS_OVERSAMPLED, CORPUS_SYNTHETIC,
)
from gin_rummy.disagreement_analysis import (
    run_full_analysis, generate_analysis_report,
    run_solver_on_corpus, cluster_disagreements, estimate_frequency_and_cost,
)
from gin_rummy.card import hand_str


def main():
    t0 = time.time()
    
    print("=" * 70)
    print("Phase 63: Rare-Spot Disagreement Mapping Sprint")
    print("=" * 70)
    
    # ── Step 1: Mine corpus ──
    print("\n=== Step 1: Mining Disagreement Corpus ===\n")
    corpus = mine_disagreement_corpus(
        n_natural_games=200,
        n_oversampled_games=100,
        verbose=True,
    )
    
    # Corpus summary
    summary = get_corpus_summary(corpus)
    print("\n--- Corpus Summary ---")
    for ct, s in summary.items():
        print(f"  {ct}: {s['total']} spots, DW 0-4: {s['dw_0_4_count']}, DW 5-10: {s['dw_5_10_count']}")
        if s.get('dw_distribution'):
            dw_str = ', '.join(f"DW{k}:{v}" for k, v in sorted(s['dw_distribution'].items()))
            print(f"    DW dist: {dw_str}")
        if s.get('texture_distribution'):
            tex_str = ', '.join(f"{k}:{v}" for k, v in s['texture_distribution'].items())
            print(f"    Textures: {tex_str}")
    
    mine_elapsed = time.time() - t0
    print(f"\n  Mining time: {mine_elapsed:.1f}s")
    
    # ── Step 2: Run solver on full corpus ──
    print("\n=== Step 2: Running Solver on Expanded Corpus ===\n")
    result = run_full_analysis(corpus, n_worlds=300, verbose=True)
    
    # ── Step 3: Print results ──
    print("\n" + "=" * 70)
    print("RESULTS")
    print("=" * 70)
    
    report = generate_analysis_report(result, corpus)
    print(report)
    
    # ── Natural frequency key findings ──
    if result.frequency_estimate:
        est = result.frequency_estimate
        print("\n" + "=" * 70)
        print("KEY FINDINGS (Natural Frequency)")
        print("=" * 70)
        print(f"  Total low-stock legal-knock spots: {est.total_natural_spots}")
        print(f"  Disagreements: {est.total_natural_disagreements}")
        print(f"  Disagreement rate: {est.disagreement_rate:.1%}")
        print(f"  Mean conditional EV loss: {est.mean_conditional_ev_loss:.2f}")
        print(f"  Mean conditional ME loss: {est.mean_conditional_me_loss:.4f}")
        print(f"  Aggregate cost per spot: {est.aggregate_ev_cost_per_spot:.3f}")
        print(f"  Classification: {est.classification}")
        print(f"  DW 0-4: {est.dw_0_4_total} spots, {est.dw_0_4_disagreements} disagree ({est.dw_0_4_rate:.1%})")
        print(f"  DW 5-10: {est.dw_5_10_total} spots, {est.dw_5_10_disagreements} disagree ({est.dw_5_10_rate:.1%})")
    
    # ── Cluster analysis ──
    print("\n=== Cluster Analysis ===")
    for label, clusters in [
        ("Natural", result.natural_clusters),
        ("Oversampled", result.oversampled_clusters),
        ("Synthetic", result.synthetic_clusters),
    ]:
        if not clusters:
            print(f"\n  {label}: No disagreements found")
            continue
        print(f"\n  {label} disagreement clusters:")
        sorted_clusters = sorted(clusters.items(), key=lambda x: -x[1].n)
        for key, cluster in sorted_clusters:
            s = cluster.summary()
            print(f"    {key}: n={s['count']}, mean_ev_diff={s['mean_ev_diff']:+.1f}, "
                  f"mean_me_diff={s['mean_me_diff']:+.4f}")
    
    total_elapsed = time.time() - t0
    print(f"\n  Total time: {total_elapsed:.1f}s")
    
    return result, corpus


if __name__ == '__main__':
    result, corpus = main()
