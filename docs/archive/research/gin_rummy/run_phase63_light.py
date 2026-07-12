"""
Phase 63 Lightweight Analysis Runner.

Reduced game counts and solver worlds to avoid PC strain.
- 100 natural games (vs 200 in full run)
- 60 oversampled games (vs 100)
- 150 solver worlds (vs 300)

The analysis is still sufficient for frequency estimation.
"""

import time
import sys
import json

from gin_rummy.disagreement_miner import (
    mine_disagreement_corpus, get_corpus_summary,
    CORPUS_NATURAL, CORPUS_OVERSAMPLED, CORPUS_SYNTHETIC,
)
from gin_rummy.disagreement_analysis import (
    run_full_analysis, generate_analysis_report,
)
from gin_rummy.card import hand_str


def main():
    t0 = time.time()

    print("=" * 70)
    print("Phase 63: Rare-Spot Disagreement Mapping Sprint (Lightweight)")
    print("=" * 70)

    # ── Step 1: Mine corpus (smaller counts) ──
    print("\n=== Step 1: Mining Disagreement Corpus ===\n")
    corpus = mine_disagreement_corpus(
        n_natural_games=100,
        n_oversampled_games=60,
        verbose=True,
    )

    summary = get_corpus_summary(corpus)
    print("\n--- Corpus Summary ---")
    for ct, s in summary.items():
        print(f"  {ct}: {s['total']} spots, DW 0-4: {s['dw_0_4_count']}, DW 5-10: {s['dw_5_10_count']}")

    mine_elapsed = time.time() - t0
    print(f"\n  Mining time: {mine_elapsed:.1f}s")

    # ── Step 2: Run solver (fewer worlds) ──
    print("\n=== Step 2: Running Solver on Expanded Corpus ===\n")
    result = run_full_analysis(corpus, n_worlds=150, verbose=True)

    # ── Step 3: Print results ──
    print("\n" + "=" * 70)
    print("RESULTS")
    print("=" * 70)

    report = generate_analysis_report(result, corpus)
    print(report)

    # ── Key findings ──
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

    # ── Save results as JSON for report generation ──
    json_out = {
        'corpus_summary': result.corpus_summary,
        'frequency_estimate': {
            'total_natural_spots': est.total_natural_spots if result.frequency_estimate else 0,
            'total_natural_disagreements': est.total_natural_disagreements if result.frequency_estimate else 0,
            'disagreement_rate': est.disagreement_rate if result.frequency_estimate else 0,
            'mean_conditional_ev_loss': est.mean_conditional_ev_loss if result.frequency_estimate else 0,
            'mean_conditional_me_loss': est.mean_conditional_me_loss if result.frequency_estimate else 0,
            'aggregate_ev_cost_per_spot': est.aggregate_ev_cost_per_spot if result.frequency_estimate else 0,
            'classification': est.classification if result.frequency_estimate else '',
            'dw_0_4_total': est.dw_0_4_total if result.frequency_estimate else 0,
            'dw_0_4_disagreements': est.dw_0_4_disagreements if result.frequency_estimate else 0,
            'dw_0_4_rate': est.dw_0_4_rate if result.frequency_estimate else 0,
            'dw_5_10_total': est.dw_5_10_total if result.frequency_estimate else 0,
            'dw_5_10_disagreements': est.dw_5_10_disagreements if result.frequency_estimate else 0,
            'dw_5_10_rate': est.dw_5_10_rate if result.frequency_estimate else 0,
        },
        'natural_clusters': {
            str(k): v.summary() for k, v in result.natural_clusters.items()
        } if result.natural_clusters else {},
        'oversampled_clusters': {
            str(k): v.summary() for k, v in result.oversampled_clusters.items()
        } if result.oversampled_clusters else {},
        'synthetic_clusters': {
            str(k): v.summary() for k, v in result.synthetic_clusters.items()
        } if result.synthetic_clusters else {},
        'timing': result.timing,
        'total_elapsed': total_elapsed,
    }

    with open('phase63_results.json', 'w') as f:
        json.dump(json_out, f, indent=2, default=str)
    print(f"\n  Results saved to phase63_results.json")

    return result, corpus


if __name__ == '__main__':
    result, corpus = main()
