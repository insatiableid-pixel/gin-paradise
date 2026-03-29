"""
Phase 69 Master Runner: Public-State CFR Pilot Sprint.

Executes all directive tasks:
  A. Audit what transfers from old CFR work
  B. Define bounded public-state Gin subgame
  C. Build and run MCCFR pilot
  D. Measure abstraction size and throughput
  E. Compare CFR pilot vs solver_v6
  F. Assess Rust necessity

Produces phase69_results.json with all numeric outputs.
"""

import random
import time
import json
import sys
import os

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main():
    print("=" * 70)
    print("  PHASE 69: PUBLIC-STATE CFR PILOT SPRINT")
    print("=" * 70)

    t0 = time.time()
    results = {}

    # ══════════════════════════════════════════════════════════════════
    # TASK A: Audit What Transfers From Old CFR Work
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK A: Auditing Old CFR Artifacts")
    print("─" * 70)

    results['task_a_audit'] = run_task_a_audit()

    # ══════════════════════════════════════════════════════════════════
    # TASK B: Define the Bounded Public-State Gin Subgame
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK B: Defining Bounded Subgame + Info-Set Abstraction")
    print("─" * 70)

    results['task_b_subgame'] = run_task_b_subgame_definition()

    # ══════════════════════════════════════════════════════════════════
    # TASK C: Build and Run MCCFR Pilot
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK C: MCCFR Pilot Training")
    print("─" * 70)

    spots, pilot_results = run_task_c_mccfr_pilot()
    results['task_c_pilot'] = pilot_results

    # ══════════════════════════════════════════════════════════════════
    # TASK D: Measure Abstraction Size and Throughput
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK D: Abstraction Size + Throughput Measurement")
    print("─" * 70)

    results['task_d_measurement'] = run_task_d_measurement(spots, pilot_results)

    # ══════════════════════════════════════════════════════════════════
    # TASK E: Compare CFR vs Solver V6
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK E: CFR Pilot vs Solver V6 Comparison")
    print("─" * 70)

    results['task_e_comparison'] = run_task_e_comparison(
        spots, pilot_results['strategy_obj']
    )

    # ══════════════════════════════════════════════════════════════════
    # TASK F: Rust Necessity Assessment
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK F: Rust Necessity Assessment")
    print("─" * 70)

    results['task_f_rust'] = run_task_f_rust_assessment(results)

    # ══════════════════════════════════════════════════════════════════
    # Save results
    # ══════════════════════════════════════════════════════════════════
    elapsed = time.time() - t0
    results['elapsed_total_seconds'] = round(elapsed, 1)
    results['phase'] = 69

    # Remove non-serializable objects
    serializable = {k: v for k, v in results.items() if k != 'task_c_pilot'}
    serializable['task_c_pilot'] = {
        k: v for k, v in pilot_results.items() if k != 'strategy_obj'
    }

    output_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'phase69_results.json'
    )
    with open(output_path, 'w') as f:
        json.dump(serializable, f, indent=2, default=str)

    print(f"\n{'=' * 70}")
    print(f"  PHASE 69 COMPLETE — {elapsed:.1f}s total")
    print(f"  Results: {output_path}")
    print(f"{'=' * 70}")


# ══════════════════════════════════════════════════════════════════════
# TASK A: Audit
# ══════════════════════════════════════════════════════════════════════

def run_task_a_audit():
    """Audit existing CFR artifacts for reusability."""

    print("\n  Analyzing cfr_strategy.py, cfr_trainer.py, apex_cfr.py...")

    audit = {
        'reusable_infrastructure': [
            {
                'component': 'Regret table handling (defaultdict pattern)',
                'source': 'cfr_strategy.py',
                'status': 'REUSED — same pattern in PublicStateCFRStrategy',
                'notes': 'defaultdict with per-action float arrays is clean and efficient',
            },
            {
                'component': 'Regret matching strategy computation',
                'source': 'cfr_strategy.py:get_strategy()',
                'status': 'REUSED — identical algorithm',
                'notes': 'max(0, regret) normalization is standard CFR',
            },
            {
                'component': 'Average strategy accumulation',
                'source': 'cfr_strategy.py:accumulate_strategy()',
                'status': 'REUSED — same pattern',
                'notes': 'Weighted strategy sum accumulation is correct',
            },
            {
                'component': 'Serialization pattern (JSON with string keys)',
                'source': 'cfr_strategy.py:save()/load()',
                'status': 'PARTIALLY REUSABLE — same approach works',
                'notes': 'Tuple-to-string key conversion is hacky but functional',
            },
            {
                'component': 'Training loop alternation',
                'source': 'cfr_trainer.py:train_cfr()',
                'status': 'REUSED — concept of alternating training sides',
                'notes': 'External sampling alternation is standard MCCFR',
            },
        ],
        'non_transferable_assumptions': [
            {
                'component': 'Discard-only action space (NUM_ACTIONS=3)',
                'source': 'cfr_strategy.py',
                'problem': 'The old path modeled WHICH CARD TO DISCARD, not '
                           'WHETHER TO KNOCK. This is a completely different '
                           'decision problem.',
                'oracle_path': 'Phase 69 models knock/continue (2 actions) as '
                               'a genuine imperfect-information problem.',
            },
            {
                'component': 'Apex top-K candidate abstraction',
                'source': 'cfr_trainer.py:CFRTrainingApex',
                'problem': 'Actions indexed 0..K-1 as "choose Nth-best Apex '
                           'candidate" are meaningless for the knock/continue '
                           'decision. The old path reduced CFR to a discard '
                           'preference learner on top of Apex, not a genuine '
                           'decision-maker.',
                'oracle_path': 'Phase 69 does not derive action candidates from '
                               'Apex. The action space is the raw strategic '
                               'choice: knock or continue.',
            },
            {
                'component': 'Immediate deadwood reward proxy',
                'source': 'cfr_trainer.py:_compute_hand_reward()',
                'problem': 'Regret was computed from immediate DW reduction, '
                           'not from full game outcomes. This made the CFR '
                           'training a DW-minimization secondary optimizer, '
                           'not a game-theoretic strategy learner.',
                'oracle_path': 'Phase 69 computes payoffs from exact knock '
                               'scoring and full continuation simulation.',
            },
            {
                'component': 'No genuine hidden-information traversal',
                'source': 'cfr_trainer.py',
                'problem': 'The old path never sampled opponent hands or '
                           'traversed a game tree with hidden state. It was '
                           'CFR in name only — a regret-based discard '
                           'preference learner.',
                'oracle_path': 'Phase 69 samples opponent worlds via belief-'
                               'weighted generation and computes counterfactual '
                               'values across hidden states.',
            },
            {
                'component': 'Information set features (discard-oriented)',
                'source': 'cfr_strategy.py:compute_info_set()',
                'problem': 'Features designed for 11-card (pre-discard) hand '
                           'state, not for 10-card (post-discard) knock '
                           'decision state. Missing public-trace features, '
                           'opponent belief features, and gin-liveness.',
                'oracle_path': 'Phase 69 uses a completely new info-set design '
                               'with public state, hero hand, and belief-'
                               'conditioning features (11 dimensions).',
            },
        ],
        'verdict': (
            'The old CFR path (cfr_strategy.py, cfr_trainer.py, apex_cfr.py) '
            'was a discard-preference learner built on top of Apex, NOT a '
            'genuine imperfect-information game solver. Its regret-table '
            'machinery (defaultdict, regret matching, strategy accumulation) '
            'transfers cleanly. Nothing else does. Phase 69 is a new oracle- '
            'oriented CFR path, not a resurrection of the old experiment.'
        ),
    }

    print(f"\n  Reusable components: {len(audit['reusable_infrastructure'])}")
    print(f"  Non-transferable:    {len(audit['non_transferable_assumptions'])}")
    print(f"\n  Verdict: Old path was CFR-in-name-only. New path is genuine.")

    return audit


# ══════════════════════════════════════════════════════════════════════
# TASK B: Bounded Subgame Definition
# ══════════════════════════════════════════════════════════════════════

def run_task_b_subgame_definition():
    """Define and validate the bounded subgame information-set schema."""
    from gin_rummy.cfr_public_state import (
        compute_public_info_set, compute_info_set_space_size,
        N_ACTIONS, ACTIONS,
    )

    theoretical_size = compute_info_set_space_size()

    definition = {
        'subgame_name': 'Late-Game Legal-Knock Decision',
        'description': (
            'Bounded subgame centered on low-stock legal-knock positions. '
            'Hero has 10 cards with DW ≤ 10, stock ≤ 6, and must decide '
            'whether to knock or continue.'
        ),
        'action_space': {
            'actions': ACTIONS,
            'n_actions': N_ACTIONS,
            'notes': (
                'Binary knock/continue choice. This is the strategically most '
                'important imperfect-information decision in late-game Gin: '
                'the payoff depends critically on the unknown opponent hand.'
            ),
        },
        'public_state_encoding': {
            'stock_bucket': '4 levels (≤2, ≤4, ≤6, >6)',
            'score_diff_bucket': '5 levels (far behind → far ahead)',
            'discard_pile_bucket': '4 levels',
            'turn_bucket': '5 levels (turn//4, capped)',
        },
        'hero_hand_encoding': {
            'hero_dw_bucket': '6 levels (gin, near-gin, low, med, high, max)',
            'hero_meld_count': '5 levels (0-4)',
            'hero_gin_live': '2 levels (binary)',
        },
        'belief_conditioning': {
            'opponent_pickup_bucket': '5 levels (0-4)',
            'opponent_discard_bucket': '5 levels',
            'opponent_decline_bucket': '5 levels',
            'trace_intensity': '4 levels',
            'notes': (
                'Belief features derived from Phase 68 trace-rich dataset. '
                'These condition the info set on publicly observable opponent '
                'behavior, enabling the CFR pilot to learn different '
                'knock/continue strategies based on what the opponent has '
                'been doing.'
            ),
        },
        'theoretical_info_set_space': theoretical_size,
        'memory_per_info_set_bytes': N_ACTIONS * 2 * 8,  # 2 tables × 2 actions × 8 bytes
        'theoretical_memory_MB': round(theoretical_size * N_ACTIONS * 2 * 8 / 1e6, 2),
        'leaf_handling': {
            'knock': 'Exact scoring via evaluate_knock_now()',
            'continue': (
                'Simulated continuation via solver_v2.simulate_continuation_policy() '
                'with CONTINUATION_CHAMPION mode. This is an approximation, not '
                'game-theoretic optimal play.'
            ),
        },
        'hidden_information': {
            'what': 'Opponent 10-card hand',
            'sampling': (
                'Belief-weighted world generation from '
                'belief_world_generator.py, using card-level weights from '
                'public action trace history.'
            ),
        },
        'what_is_exact': [
            'Hero hand meld arrangement and deadwood computation',
            'Knock scoring (gin bonus, undercut, layoffs)',
            'Card visibility constraints',
            'Information-set feature extraction',
        ],
        'what_is_sampled': [
            'Opponent hand distribution (belief-weighted)',
            'Stock card ordering in each world',
            'Continuation play outcomes (champion policy rollout)',
        ],
        'what_is_approximated': [
            'Information-set bucketing (discretization loss)',
            'Continuation value (champion heuristic, not Nash)',
            'Belief model accuracy (heuristic weights, not Bayesian)',
        ],
    }

    print(f"\n  Subgame: {definition['subgame_name']}")
    print(f"  Actions: {ACTIONS}")
    print(f"  Info-set dimensions: 11")
    print(f"  Theoretical max info sets: {theoretical_size:,}")
    print(f"  Theoretical memory: {definition['theoretical_memory_MB']} MB")

    return definition


# ══════════════════════════════════════════════════════════════════════
# TASK C: MCCFR Pilot
# ══════════════════════════════════════════════════════════════════════

def run_task_c_mccfr_pilot():
    """Run the MCCFR pilot: Kuhn sanity check + real Gin subgame training."""

    # ── Step 1: Kuhn Poker Sanity Check ──
    print("\n  Step 1: Kuhn Poker sanity check...")
    from gin_rummy.cfr_public_state import KuhnPokerCFR

    kuhn = KuhnPokerCFR(seed=42)
    kuhn_results = kuhn.train(n_iterations=10000, verbose=False)

    print(f"    Kuhn iterations: {kuhn_results['iterations']}")
    print(f"    Kuhn elapsed: {kuhn_results['elapsed']}s")
    print(f"    Kuhn converged: {kuhn_results['converged']['passed']}")

    if kuhn_results['converged']['passed']:
        print("    ✓ Kuhn Poker converged — regret machinery is correct")
    else:
        print("    ✗ Kuhn Poker did NOT converge — regret machinery may have bugs")

    # Log a few key Kuhn strategies
    for key in ['0_', '1_', '2_']:
        if key in kuhn_results['strategies']:
            s = kuhn_results['strategies'][key]
            card_name = ['J', 'Q', 'K'][int(key[0])]
            print(f"      P0 with {card_name}: pass={s['pass']:.3f}, bet={s['bet']:.3f}")

    # ── Step 2: Build trace-rich dataset ──
    print("\n  Step 2: Building trace-rich dataset...")
    from gin_rummy.trace_rich_dataset import build_trace_rich_dataset

    spots = build_trace_rich_dataset(n_games=300, max_stock=6, verbose=True)
    print(f"    Dataset: {len(spots)} trace-rich spots")

    if len(spots) < 50:
        print("    WARNING: Very few spots. Results will be noisy.")

    # ── Step 3: MCCFR Training on Gin Subgame ──
    print("\n  Step 3: MCCFR training on bounded Gin subgame...")
    from gin_rummy.cfr_public_state import (
        PublicStateCFRStrategy, PublicStateMCCFR
    )

    strategy = PublicStateCFRStrategy()
    trainer = PublicStateMCCFR(
        strategy=strategy,
        n_worlds_per_spot=20,
        seed=69,
    )

    training_results = trainer.train_on_spots(
        spots=spots,
        n_iterations=3000,
        verbose=True,
        progress_interval=300,
    )

    print(f"\n    Training complete:")
    print(f"      Iterations: {training_results['n_iterations']}")
    print(f"      Info sets: {training_results['n_info_sets']}")
    print(f"      Throughput: {training_results['iterations_per_sec']} iter/s")
    print(f"      Elapsed: {training_results['elapsed_seconds']}s")

    # ── Step 4: Strategy Analysis ──
    print("\n  Step 4: Strategy analysis...")
    strategy_stats = strategy.get_strategy_stats()
    print(f"    Mean knock prob: {strategy_stats['mean_knock_prob']}")
    print(f"    Mean continue prob: {strategy_stats['mean_continue_prob']}")
    print(f"    Mixed strategies: {strategy_stats['n_mixed_strategies']}")
    print(f"    Frac mixed: {strategy_stats['frac_mixed']}")
    print(f"    Exploitability proxy: {strategy_stats['exploitability_proxy']}")

    pilot_results = {
        'kuhn_sanity_check': kuhn_results,
        'dataset_size': len(spots),
        'training': training_results,
        'strategy_stats': strategy_stats,
        'strategy_obj': strategy,  # Non-serializable, used in later tasks
    }

    return spots, pilot_results


# ══════════════════════════════════════════════════════════════════════
# TASK D: Measurement
# ══════════════════════════════════════════════════════════════════════

def run_task_d_measurement(spots, pilot_results):
    """Measure abstraction size and throughput on real data."""
    from gin_rummy.cfr_public_state import measure_abstraction_size

    print("\n  Measuring info-set abstraction size...")
    abstraction = measure_abstraction_size(spots, n_sample=min(1000, len(spots)))

    print(f"    Unique info sets (observed): {abstraction['unique_info_sets_observed']}")
    print(f"    Theoretical max:             {abstraction['theoretical_max_info_sets']:,}")
    print(f"    Occupancy rate:              {abstraction['occupancy_rate']:.4%}")
    print(f"    Mean spots per info set:     {abstraction['mean_spots_per_info_set']}")
    print(f"    Memory (observed):           {abstraction['memory_estimate_observed_KB']} KB")
    print(f"    Memory (theoretical max):    {abstraction['memory_estimate_theoretical_MB']} MB")

    # Throughput analysis from training
    training = pilot_results['training']
    throughput = {
        'iterations_per_sec': training['iterations_per_sec'],
        'seconds_per_iteration': round(1.0 / training['iterations_per_sec'], 4) if training['iterations_per_sec'] > 0 else 'inf',
        'worlds_per_iteration': 20,  # n_worlds_per_spot
        'total_world_evaluations': training['n_iterations'] * 20,
        'world_evaluations_per_sec': round(training['iterations_per_sec'] * 20, 1),
        'bottleneck_analysis': (
            'Primary bottleneck is continuation simulation '
            '(simulate_continuation_policy). Each world requires a full '
            'continuation rollout with meld arrangement at every step. '
            'The knock evaluation (evaluate_knock_now) is comparatively cheap. '
            'World generation (belief_world_generator) is moderate.'
        ),
    }

    print(f"\n  Throughput:")
    print(f"    Iterations/sec:              {throughput['iterations_per_sec']}")
    print(f"    World evaluations/sec:       {throughput['world_evaluations_per_sec']}")
    print(f"    Total world evaluations:     {throughput['total_world_evaluations']:,}")

    return {
        'abstraction': abstraction,
        'throughput': throughput,
    }


# ══════════════════════════════════════════════════════════════════════
# TASK E: CFR vs Solver V6 Comparison
# ══════════════════════════════════════════════════════════════════════

def run_task_e_comparison(spots, strategy):
    """Compare CFR pilot average strategy vs solver_v6."""
    from gin_rummy.cfr_public_state import compare_cfr_vs_solver_v6

    print("\n  Comparing CFR pilot vs solver_v6 on 50 spots...")

    comparison = compare_cfr_vs_solver_v6(
        spots=spots,
        strategy=strategy,
        n_compare=min(50, len(spots)),
        seed=123,
    )

    print(f"\n    Agreement rate:       {comparison['agreement_rate']:.1%}")
    print(f"    Agree:               {comparison['agree']}")
    print(f"    Disagree:            {comparison['disagree']}")
    print(f"    CFR knock rate:      {comparison['cfr_knock_rate']:.1%}")
    print(f"    V6 knock rate:       {comparison['v6_knock_rate']:.1%}")
    print(f"    Mixed strategies:    {comparison['n_mixed_strategies']}")

    # Disagreement analysis
    if comparison['disagree'] > 0:
        print(f"\n    Disagreement details (first 5):")
        disagreements = [d for d in comparison.get('detail', []) if not d.get('agree')]
        for d in disagreements[:5]:
            print(f"      DW={d['hero_dw']}, stock={d['stock_size']}: "
                  f"CFR={d['cfr_action']} (p_knock={d['cfr_knock_prob']:.2f}) "
                  f"vs V6={d['v6_action']} | actual={d['actual_outcome']}")

    return comparison


# ══════════════════════════════════════════════════════════════════════
# TASK F: Rust Assessment
# ══════════════════════════════════════════════════════════════════════

def run_task_f_rust_assessment(results):
    """Assess whether Rust is an immediate necessity."""
    import shutil

    # Check Rust toolchain availability
    rustc_available = shutil.which('rustc') is not None
    cargo_available = shutil.which('cargo') is not None

    rust_version = None
    if rustc_available:
        import subprocess
        try:
            result = subprocess.run(['rustc', '--version'],
                                    capture_output=True, text=True, timeout=5)
            rust_version = result.stdout.strip()
        except Exception:
            pass

    # Extract throughput data
    throughput = results.get('task_d_measurement', {}).get('throughput', {})
    iter_per_sec = throughput.get('iterations_per_sec', 0)

    # Python is "sufficient" if we can run 10K iterations in < 5 minutes
    target_iterations = 10000
    estimated_time_10k = target_iterations / iter_per_sec if iter_per_sec > 0 else float('inf')
    python_sufficient = estimated_time_10k < 300  # 5 minutes

    # For full-game CFR, estimate scale factor
    # Current subgame: ~120K theoretical info sets, 2 actions
    # Full game: ~10M+ info sets, variable action space
    full_game_scale = 100  # rough conservative estimate
    estimated_full_game_time = estimated_time_10k * full_game_scale

    assessment = {
        'rust_toolchain': {
            'rustc_available': rustc_available,
            'cargo_available': cargo_available,
            'rust_version': rust_version,
        },
        'python_throughput': {
            'iterations_per_sec': iter_per_sec,
            'estimated_10k_iterations_sec': round(estimated_time_10k, 1),
            'python_sufficient_for_pilot': python_sufficient,
        },
        'scaling_analysis': {
            'current_theoretical_info_sets': results.get('task_b_subgame', {}).get(
                'theoretical_info_set_space', 0),
            'current_observed_info_sets': results.get('task_d_measurement', {}).get(
                'abstraction', {}).get('unique_info_sets_observed', 0),
            'estimated_full_game_scale_factor': full_game_scale,
            'estimated_full_game_10k_sec': round(estimated_full_game_time, 0),
        },
        'verdict': None,
        'recommendation': None,
    }

    if python_sufficient:
        assessment['verdict'] = (
            'PYTHON IS SUFFICIENT for the bounded pilot. The current throughput '
            f'({iter_per_sec:.1f} iter/s) allows meaningful MCCFR convergence '
            f'experiments in minutes, not hours. Python is NOT the bottleneck '
            f'for the Phase 69 pilot scope.'
        )
        assessment['recommendation'] = (
            'Keep architecture work in Python for the next 1-2 phases. '
            'Rust becomes relevant when scaling to larger subgames or '
            'full-game CFR. The immediate next step should be widening the '
            'subgame scope (more actions, more game phases), not rewriting '
            'in Rust.'
        )
    else:
        assessment['verdict'] = (
            'PYTHON IS THE BOTTLENECK. The current throughput '
            f'({iter_per_sec:.1f} iter/s) is too slow for meaningful '
            f'convergence even on the bounded pilot. Phase 70 should begin '
            f'Rust core foundation.'
        )
        assessment['recommendation'] = (
            'Phase 70 should begin Rust core foundation immediately. '
            'Start with the hot-loop inner functions: meld arrangement, '
            'deadwood computation, and continuation simulation.'
        )

    print(f"\n  Rust toolchain: {'available' if rustc_available else 'NOT available'}")
    print(f"  Python throughput: {iter_per_sec:.1f} iter/s")
    print(f"  10K iterations: ~{estimated_time_10k:.0f}s")
    print(f"  Verdict: {'Python sufficient' if python_sufficient else 'Python is bottleneck'}")

    return assessment


if __name__ == '__main__':
    main()
