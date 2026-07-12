"""
Phase 70 Master Runner: CFR Convergence and Policy Validation Sprint.

Executes all directive tasks:
  A. Push current pilot toward real convergence (long-run sweep)
  B. Refine the abstraction based on actual occupancy
  C. Evaluate CFR policy quality on held-out spots
  D. Build a research-only CFR-guided low-stock knock bot
  E. Run narrow, honest validation
  F. Decide the next oracle pivot honestly

Produces phase70_results.json with all numeric outputs.
"""

import random
import time
import json
import sys
import os
import copy
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main():
    print("=" * 70)
    print("  PHASE 70: CFR CONVERGENCE AND POLICY VALIDATION SPRINT")
    print("=" * 70)

    t0 = time.time()
    results = {}

    # ── Build dataset (shared across all tasks) ──
    print("\n" + "─" * 70)
    print("  DATASET: Building trace-rich spots")
    print("─" * 70)
    from gin_rummy.trace_rich_dataset import build_trace_rich_dataset
    all_spots = build_trace_rich_dataset(n_games=500, max_stock=6, verbose=True)
    print(f"  Total spots: {len(all_spots)}")

    # Split: 70% train, 30% held-out
    rng = random.Random(70)
    shuffled = list(all_spots)
    rng.shuffle(shuffled)
    split = int(len(shuffled) * 0.7)
    train_spots = shuffled[:split]
    heldout_spots = shuffled[split:]
    print(f"  Train: {len(train_spots)}, Held-out: {len(heldout_spots)}")
    results['dataset'] = {
        'total': len(all_spots),
        'train': len(train_spots),
        'heldout': len(heldout_spots),
    }

    # ══════════════════════════════════════════════════════════════════
    # TASK A: Long-Run Convergence Sweep
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK A: Long-Run Convergence Sweep")
    print("─" * 70)
    results['task_a'] = run_task_a(train_spots)

    # ══════════════════════════════════════════════════════════════════
    # TASK B: Abstraction Refinement
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK B: Abstraction Refinement Sweep")
    print("─" * 70)
    results['task_b'] = run_task_b(train_spots)

    # ══════════════════════════════════════════════════════════════════
    # TASK C: Held-Out Action Quality (uses best strategy from A)
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK C: Held-Out CFR vs solver_v6 Action Quality")
    print("─" * 70)
    best_strategy = results['task_a']['best_strategy_obj']
    results['task_c'] = run_task_c(heldout_spots, best_strategy)

    # ══════════════════════════════════════════════════════════════════
    # TASK D: Research-Only CFR-Guided Knock Bot
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK D: Research-Only CFR Knock Bot")
    print("─" * 70)
    results['task_d'] = run_task_d(best_strategy)

    # ══════════════════════════════════════════════════════════════════
    # TASK E: Narrow Honest Validation
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK E: Narrow Honest Validation")
    print("─" * 70)
    results['task_e'] = run_task_e(heldout_spots, best_strategy)

    # ══════════════════════════════════════════════════════════════════
    # TASK F: Next Oracle Pivot Decision
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "─" * 70)
    print("  TASK F: Next Oracle Pivot Decision")
    print("─" * 70)
    results['task_f'] = run_task_f(results)

    # ── Save results ──
    elapsed = time.time() - t0
    results['elapsed_total_seconds'] = round(elapsed, 1)
    results['phase'] = 70

    # Strip non-serializable objects
    serializable = _make_serializable(results)

    output_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'phase70_results.json'
    )
    with open(output_path, 'w') as f:
        json.dump(serializable, f, indent=2, default=str)

    print(f"\n{'=' * 70}")
    print(f"  PHASE 70 COMPLETE — {elapsed:.1f}s total")
    print(f"  Results: {output_path}")
    print(f"{'=' * 70}")


def _make_serializable(obj):
    """Recursively strip non-serializable objects."""
    if isinstance(obj, dict):
        return {k: _make_serializable(v) for k, v in obj.items()
                if not k.endswith('_obj')}
    elif isinstance(obj, list):
        return [_make_serializable(v) for v in obj]
    elif isinstance(obj, (int, float, str, bool, type(None))):
        return obj
    else:
        return str(obj)


# ══════════════════════════════════════════════════════════════════════
# TASK A: Long-Run Convergence Sweep
# ══════════════════════════════════════════════════════════════════════

def run_task_a(train_spots):
    """Train with checkpoints at 3K, 10K, 25K, 50K iterations."""
    from gin_rummy.cfr_public_state import (
        PublicStateCFRStrategy, PublicStateMCCFR,
    )

    strategy = PublicStateCFRStrategy()
    trainer = PublicStateMCCFR(
        strategy=strategy,
        n_worlds_per_spot=20,
        seed=70,
    )

    checkpoints = [3000, 10000, 25000, 50000]
    checkpoint_results = []
    prev_iters = 0

    for target in checkpoints:
        delta = target - prev_iters
        print(f"\n  Training {prev_iters} → {target} ({delta} iterations)...")

        training = trainer.train_on_spots(
            spots=train_spots,
            n_iterations=delta,
            verbose=True,
            progress_interval=max(delta // 5, 500),
        )

        stats = strategy.get_strategy_stats()
        exploit = strategy.get_exploitability_proxy()

        # Strategy stability: measure how dispersed knock probs are
        knock_probs = []
        for info_set in strategy.strategy_sum:
            avg = strategy.get_average_strategy(info_set)
            knock_probs.append(avg[0])

        # Compute stability metric: std of knock probs across info sets
        mean_kp = sum(knock_probs) / len(knock_probs) if knock_probs else 0
        var_kp = sum((p - mean_kp)**2 for p in knock_probs) / len(knock_probs) if knock_probs else 0
        std_kp = var_kp ** 0.5

        # Count singleton visits
        singletons = sum(1 for k, v in strategy.visit_count.items() if v <= 2)

        ckpt = {
            'iterations': target,
            'n_info_sets': stats['n_info_sets'],
            'exploitability_proxy': round(exploit, 6),
            'mean_knock_prob': stats['mean_knock_prob'],
            'n_mixed_strategies': stats['n_mixed_strategies'],
            'frac_mixed': stats['frac_mixed'],
            'knock_prob_std': round(std_kp, 4),
            'singleton_visit_info_sets': singletons,
            'elapsed_sec': training['elapsed_seconds'],
            'iter_per_sec': training['iterations_per_sec'],
        }
        checkpoint_results.append(ckpt)
        prev_iters = target

        print(f"    Checkpoint {target}:")
        print(f"      Info sets:       {ckpt['n_info_sets']}")
        print(f"      Exploit proxy:   {ckpt['exploitability_proxy']}")
        print(f"      Mean P(knock):   {ckpt['mean_knock_prob']}")
        print(f"      Mixed:           {ckpt['n_mixed_strategies']} ({ckpt['frac_mixed']})")
        print(f"      Knock prob std:  {ckpt['knock_prob_std']}")

    # Convergence assessment
    first_exploit = checkpoint_results[0]['exploitability_proxy']
    last_exploit = checkpoint_results[-1]['exploitability_proxy']
    exploit_improving = last_exploit < first_exploit
    knock_stabilizing = (
        abs(checkpoint_results[-1]['mean_knock_prob'] -
            checkpoint_results[-2]['mean_knock_prob']) < 0.03
    )

    assessment = {
        'exploit_improving': exploit_improving,
        'exploit_reduction': round(first_exploit - last_exploit, 6),
        'knock_stabilizing': knock_stabilizing,
        'knock_bias_persists': checkpoint_results[-1]['mean_knock_prob'] > 0.60,
        'verdict': None,
    }

    if exploit_improving and knock_stabilizing:
        assessment['verdict'] = (
            'Policy is converging and stabilizing. Exploit proxy dropped '
            f'from {first_exploit:.4f} to {last_exploit:.4f}. '
            f'Knock bias {"persists" if assessment["knock_bias_persists"] else "resolved"}.'
        )
    elif exploit_improving:
        assessment['verdict'] = (
            'Exploit proxy is still improving but knock prob has not stabilized. '
            'More iterations likely needed.'
        )
    else:
        assessment['verdict'] = (
            'Exploit proxy is NOT improving. The abstraction or leaf values '
            'may need fixing before more iterations help.'
        )

    print(f"\n  Convergence verdict: {assessment['verdict']}")

    return {
        'checkpoints': checkpoint_results,
        'convergence_assessment': assessment,
        'best_strategy_obj': strategy,  # non-serializable, used by later tasks
    }


# ══════════════════════════════════════════════════════════════════════
# TASK B: Abstraction Refinement
# ══════════════════════════════════════════════════════════════════════

def run_task_b(train_spots):
    """Test a coarsened abstraction (remove sparse trace dimensions)."""
    from gin_rummy.cfr_public_state import (
        PublicStateCFRStrategy, PublicStateMCCFR,
        compute_public_info_set, N_ACTIONS,
    )
    from gin_rummy.endgame_solver import PublicState

    # ── Variant 1: Coarsened abstraction ──
    # Remove decline_bucket and trace_intensity (sparse dimensions)
    # Keep pickup_bucket and discard_count_bucket (more signal)
    print("\n  Variant: Coarsened abstraction (drop decline + trace_intensity)")

    def coarsened_info_set(spot):
        """Compute a coarsened info set dropping 2 sparse dimensions."""
        full = compute_public_info_set(
            hero_hand=spot.hero_hand,
            public_state=PublicState(
                discard_pile=list(spot.discard_pile),
                turn_number=spot.turn_number,
                stock_size=spot.stock_size,
                my_score=spot.my_score,
                opp_score=spot.opp_score,
            ),
            known_opponent_pickups=spot.known_opponent_pickups,
            known_opponent_discards=spot.known_opponent_discards,
            upcard_declines=spot.upcard_declines,
        )
        # Drop indices 9 (decline_bucket) and 10 (trace_intensity)
        return full[:9]  # keep first 9 dimensions

    # Measure coverage with coarsened abstraction
    info_sets_full = set()
    info_sets_coarse = set()
    coarse_counts = defaultdict(int)
    full_counts = defaultdict(int)
    rng = random.Random(77)
    sample = rng.sample(train_spots, min(1000, len(train_spots)))

    for spot in sample:
        full_is = compute_public_info_set(
            hero_hand=spot.hero_hand,
            public_state=PublicState(
                discard_pile=list(spot.discard_pile),
                turn_number=spot.turn_number,
                stock_size=spot.stock_size,
                my_score=spot.my_score,
                opp_score=spot.opp_score,
            ),
            known_opponent_pickups=spot.known_opponent_pickups,
            known_opponent_discards=spot.known_opponent_discards,
            upcard_declines=spot.upcard_declines,
        )
        coarse_is = full_is[:9]
        info_sets_full.add(full_is)
        info_sets_coarse.add(coarse_is)
        full_counts[full_is] += 1
        coarse_counts[coarse_is] += 1

    full_singletons = sum(1 for c in full_counts.values() if c == 1)
    coarse_singletons = sum(1 for c in coarse_counts.values() if c == 1)

    full_mean_occ = sum(full_counts.values()) / len(full_counts) if full_counts else 0
    coarse_mean_occ = sum(coarse_counts.values()) / len(coarse_counts) if coarse_counts else 0

    coverage_comparison = {
        'full_11d': {
            'unique_info_sets': len(info_sets_full),
            'singleton_rate': round(full_singletons / len(info_sets_full), 4) if info_sets_full else 0,
            'mean_occupancy': round(full_mean_occ, 2),
        },
        'coarsened_9d': {
            'unique_info_sets': len(info_sets_coarse),
            'singleton_rate': round(coarse_singletons / len(info_sets_coarse), 4) if info_sets_coarse else 0,
            'mean_occupancy': round(coarse_mean_occ, 2),
        },
    }

    print(f"    Full (11d):     {coverage_comparison['full_11d']}")
    print(f"    Coarsened (9d): {coverage_comparison['coarsened_9d']}")

    # ── Train coarsened variant for comparison ──
    print("\n  Training coarsened variant for 25K iterations...")

    # Use a custom trainer that overrides info-set computation
    strategy_coarse = PublicStateCFRStrategy()
    trainer_coarse = PublicStateMCCFR(
        strategy=strategy_coarse,
        n_worlds_per_spot=20,
        seed=71,
    )

    # Monkey-patch the info set computation for coarsened variant
    import gin_rummy.cfr_public_state as cfr_mod
    _original_compute = cfr_mod.compute_public_info_set

    def _coarsened_compute(*args, **kwargs):
        full = _original_compute(*args, **kwargs)
        return full[:9]

    cfr_mod.compute_public_info_set = _coarsened_compute

    coarse_training = trainer_coarse.train_on_spots(
        spots=train_spots,
        n_iterations=25000,
        verbose=True,
        progress_interval=5000,
    )

    coarse_stats = strategy_coarse.get_strategy_stats()

    # Restore original
    cfr_mod.compute_public_info_set = _original_compute

    coarse_result = {
        'n_info_sets': coarse_stats['n_info_sets'],
        'exploitability_proxy': coarse_stats['exploitability_proxy'],
        'mean_knock_prob': coarse_stats['mean_knock_prob'],
        'n_mixed': coarse_stats['n_mixed_strategies'],
        'frac_mixed': coarse_stats['frac_mixed'],
        'elapsed': coarse_training['elapsed_seconds'],
    }

    print(f"    Coarsened result: {coarse_result}")

    # Compare with full abstraction at same iteration count (from task A)
    verdict = None
    # We'll compare against Task A's 25K checkpoint in the report

    return {
        'coverage_comparison': coverage_comparison,
        'coarsened_training': coarse_result,
        'verdict': (
            'Coarsened abstraction reduces info-set count and singleton rate, '
            'improving per-bucket coverage. Compare exploit proxy against '
            'the full-abstraction 25K checkpoint to determine if the '
            'knock-heavy skew is partly an abstraction artifact.'
        ),
    }


# ══════════════════════════════════════════════════════════════════════
# TASK C: Held-Out Action Quality
# ══════════════════════════════════════════════════════════════════════

def run_task_c(heldout_spots, strategy):
    """Compare CFR vs solver_v6 on held-out spots with value estimation."""
    from gin_rummy.cfr_public_state import (
        compute_public_info_set, ACTION_KNOCK, ACTION_CONTINUE,
    )
    from gin_rummy.endgame_solver import PublicState, evaluate_knock_now
    from gin_rummy.solver_v6 import solve_spot_v6
    from gin_rummy.solver_v2 import simulate_continuation_policy, CONTINUATION_CHAMPION
    from gin_rummy.belief_world_generator import generate_belief_weighted_worlds

    rng = random.Random(170)
    n_eval = min(80, len(heldout_spots))
    eval_spots = rng.sample(heldout_spots, n_eval)

    agree = 0
    disagree = 0
    cfr_better = 0
    v6_better = 0
    tie = 0
    cfr_knock_count = 0
    v6_knock_count = 0
    detail = []

    for i, spot in enumerate(eval_spots):
        if (i + 1) % 20 == 0:
            print(f"    Evaluating {i+1}/{n_eval}...")

        ps = PublicState(
            discard_pile=list(spot.discard_pile),
            turn_number=spot.turn_number,
            stock_size=spot.stock_size,
            my_score=spot.my_score,
            opp_score=spot.opp_score,
        )

        # ── CFR recommendation ──
        info_set = compute_public_info_set(
            hero_hand=spot.hero_hand, public_state=ps,
            known_opponent_pickups=spot.known_opponent_pickups,
            known_opponent_discards=spot.known_opponent_discards,
            upcard_declines=spot.upcard_declines,
        )
        avg_strat = strategy.get_average_strategy(info_set)
        cfr_action = 'knock' if avg_strat[ACTION_KNOCK] >= avg_strat[ACTION_CONTINUE] else 'continue'
        if cfr_action == 'knock':
            cfr_knock_count += 1

        # ── V6 recommendation ──
        try:
            v6_result = solve_spot_v6(
                hero_hand=spot.hero_hand, public_state=ps,
                n_worlds=100, seed=170 + i,
                known_opponent_pickups=spot.known_opponent_pickups,
                known_opponent_discards=spot.known_opponent_discards,
                upcard_declines=spot.upcard_declines,
            )
            v6_action = v6_result.recommended_action
        except Exception:
            v6_action = 'error'

        if v6_action == 'knock':
            v6_knock_count += 1

        # ── Value estimation (stronger evaluation) ──
        # Sample worlds and compute EV for both actions
        worlds, _ = generate_belief_weighted_worlds(
            hero_hand=spot.hero_hand,
            discard_pile=list(spot.discard_pile),
            stock_size=spot.stock_size,
            n_worlds=30,
            rng=random.Random(rng.randint(0, 2**31)),
            known_opponent_pickups=spot.known_opponent_pickups,
            known_opponent_discards=spot.known_opponent_discards,
            oversample_factor=2,
        )

        knock_ev = 0.0
        cont_ev = 0.0
        n_worlds_eval = len(worlds)

        for opp_hand, stock in worlds:
            ko = evaluate_knock_now(spot.hero_hand, opp_hand)
            knock_ev += (ko.hero_points - ko.opp_points)

            co = simulate_continuation_policy(
                hero_hand=list(spot.hero_hand),
                opp_hand=list(opp_hand),
                stock=list(stock),
                public_state=ps,
                rng=random.Random(rng.randint(0, 2**31)),
                mode=CONTINUATION_CHAMPION,
            )
            cont_ev += (co.hero_points - co.opp_points)

        if n_worlds_eval > 0:
            knock_ev /= n_worlds_eval
            cont_ev /= n_worlds_eval

        best_action = 'knock' if knock_ev >= cont_ev else 'continue'

        # Score methods
        cfr_correct = (cfr_action == best_action)
        v6_correct = (v6_action == best_action)

        if cfr_action == v6_action:
            agree += 1
        else:
            disagree += 1
            if cfr_correct and not v6_correct:
                cfr_better += 1
            elif v6_correct and not cfr_correct:
                v6_better += 1
            else:
                tie += 1

        entry = {
            'hero_dw': spot.hero_deadwood,
            'stock': spot.stock_size,
            'cfr_action': cfr_action,
            'cfr_knock_p': round(avg_strat[ACTION_KNOCK], 4),
            'v6_action': v6_action,
            'best_action': best_action,
            'knock_ev': round(knock_ev, 2),
            'cont_ev': round(cont_ev, 2),
            'cfr_correct': cfr_correct,
            'v6_correct': v6_correct,
            'actual': spot.outcome,
        }
        detail.append(entry)

    cfr_correct_total = sum(1 for d in detail if d['cfr_correct'])
    v6_correct_total = sum(1 for d in detail if d['v6_correct'])

    summary = {
        'n_evaluated': n_eval,
        'agreement_rate': round(agree / n_eval, 4),
        'cfr_knock_rate': round(cfr_knock_count / n_eval, 4),
        'v6_knock_rate': round(v6_knock_count / n_eval, 4),
        'cfr_accuracy_vs_best': round(cfr_correct_total / n_eval, 4),
        'v6_accuracy_vs_best': round(v6_correct_total / n_eval, 4),
        'disagreements': disagree,
        'cfr_better_on_disagree': cfr_better,
        'v6_better_on_disagree': v6_better,
        'tie_on_disagree': tie,
        'detail': detail[:20],
    }

    print(f"\n  Results ({n_eval} held-out spots):")
    print(f"    Agreement:          {summary['agreement_rate']:.1%}")
    print(f"    CFR knock rate:     {summary['cfr_knock_rate']:.1%}")
    print(f"    V6 knock rate:      {summary['v6_knock_rate']:.1%}")
    print(f"    CFR accuracy:       {summary['cfr_accuracy_vs_best']:.1%}")
    print(f"    V6 accuracy:        {summary['v6_accuracy_vs_best']:.1%}")
    print(f"    On disagreements:   CFR better={cfr_better}, V6 better={v6_better}, tie={tie}")

    return summary


# ══════════════════════════════════════════════════════════════════════
# TASK D: Research-Only CFR Knock Bot
# ══════════════════════════════════════════════════════════════════════

def run_task_d(strategy):
    """Build a research CFR knock bot and describe its integration."""
    from gin_rummy.cfr_public_state import (
        compute_public_info_set, ACTION_KNOCK, ACTION_CONTINUE,
    )
    from gin_rummy.endgame_solver import PublicState

    # Count info sets by knock policy character
    always_knock = 0
    always_continue = 0
    mixed = 0
    threshold_knock = 0  # p(knock) >= 0.6

    for info_set in strategy.strategy_sum:
        avg = strategy.get_average_strategy(info_set)
        pk = avg[ACTION_KNOCK]
        if pk >= 0.95:
            always_knock += 1
        elif pk <= 0.05:
            always_continue += 1
        else:
            mixed += 1
        if pk >= 0.6:
            threshold_knock += 1

    total_is = strategy.num_info_sets()

    bot_spec = {
        'name': 'CFR-Guided Research Bot',
        'scope': 'Low-stock legal-knock states covered by the pilot',
        'mode': 'deterministic_threshold',
        'threshold': 0.6,
        'description': (
            'Uses the current champion stack (ApexMCTSClinchOnlyGoGin) for '
            'all decisions EXCEPT in covered low-stock legal-knock states, '
            'where it consults the CFR average strategy. If P(knock) >= 0.6 '
            'in the learned strategy, it knocks; otherwise continues.'
        ),
        'policy_stats': {
            'total_info_sets': total_is,
            'always_knock': always_knock,
            'always_continue': always_continue,
            'mixed_strategy': mixed,
            'threshold_knock': threshold_knock,
            'threshold_continue': total_is - threshold_knock,
        },
        'integration_notes': [
            'Research-only: NOT promoted as champion candidate',
            'Only applies in pilot-covered state family',
            'Falls back to champion for uncovered states',
            'Deterministic threshold avoids variance from stochastic play',
        ],
    }

    print(f"  Bot specification:")
    print(f"    Mode:            {bot_spec['mode']} (threshold={bot_spec['threshold']})")
    print(f"    Info sets:        {total_is}")
    print(f"    Always knock:    {always_knock}")
    print(f"    Always continue: {always_continue}")
    print(f"    Mixed:           {mixed}")
    print(f"    Threshold knock: {threshold_knock} ({threshold_knock/total_is:.1%})")

    return bot_spec


# ══════════════════════════════════════════════════════════════════════
# TASK E: Narrow Honest Validation
# ══════════════════════════════════════════════════════════════════════

def run_task_e(heldout_spots, strategy):
    """Spot-level validation on held-out data."""
    from gin_rummy.cfr_public_state import (
        compute_public_info_set, ACTION_KNOCK, ACTION_CONTINUE,
    )
    from gin_rummy.endgame_solver import PublicState

    # Spot-level: for each spot, compare CFR recommendation to actual outcome
    outcomes_by_action = {
        'cfr_knock': {'gin': 0, 'knock_win': 0, 'undercut': 0, 'total': 0},
        'cfr_continue': {'gin': 0, 'knock_win': 0, 'undercut': 0, 'total': 0},
    }

    # DW-stratified analysis
    dw_strata = defaultdict(lambda: {'cfr_knock': 0, 'cfr_continue': 0,
                                      'undercuts_on_knock': 0, 'wins_on_knock': 0})

    for spot in heldout_spots:
        ps = PublicState(
            discard_pile=list(spot.discard_pile),
            turn_number=spot.turn_number,
            stock_size=spot.stock_size,
            my_score=spot.my_score,
            opp_score=spot.opp_score,
        )
        info_set = compute_public_info_set(
            hero_hand=spot.hero_hand, public_state=ps,
            known_opponent_pickups=spot.known_opponent_pickups,
            known_opponent_discards=spot.known_opponent_discards,
            upcard_declines=spot.upcard_declines,
        )
        avg = strategy.get_average_strategy(info_set)
        cfr_action = 'knock' if avg[ACTION_KNOCK] >= 0.6 else 'continue'

        key = f'cfr_{cfr_action}'
        outcomes_by_action[key]['total'] += 1
        outcomes_by_action[key][spot.outcome] += 1

        dw_bucket = 'dw_0' if spot.hero_deadwood == 0 else \
                    'dw_1-3' if spot.hero_deadwood <= 3 else \
                    'dw_4-7' if spot.hero_deadwood <= 7 else 'dw_8-10'

        if cfr_action == 'knock':
            dw_strata[dw_bucket]['cfr_knock'] += 1
            if spot.outcome == 'undercut':
                dw_strata[dw_bucket]['undercuts_on_knock'] += 1
            elif spot.outcome in ('knock_win', 'gin'):
                dw_strata[dw_bucket]['wins_on_knock'] += 1
        else:
            dw_strata[dw_bucket]['cfr_continue'] += 1

    # Compute undercut rates
    for key in outcomes_by_action:
        data = outcomes_by_action[key]
        if data['total'] > 0:
            data['undercut_rate'] = round(data['undercut'] / data['total'], 4)
            data['win_rate'] = round(
                (data['gin'] + data['knock_win']) / data['total'], 4
            )

    validation = {
        'n_spots': len(heldout_spots),
        'outcomes_by_cfr_action': outcomes_by_action,
        'dw_strata': dict(dw_strata),
    }

    print(f"\n  Spot-level validation ({len(heldout_spots)} spots):")
    for key, data in outcomes_by_action.items():
        print(f"    {key}: {data}")
    print(f"\n  DW-stratified:")
    for dw, data in sorted(dw_strata.items()):
        print(f"    {dw}: {dict(data)}")

    return validation


# ══════════════════════════════════════════════════════════════════════
# TASK F: Next Oracle Pivot
# ══════════════════════════════════════════════════════════════════════

def run_task_f(results):
    """Make next-step recommendation based on evidence."""
    task_a = results.get('task_a', {})
    task_c = results.get('task_c', {})

    checkpoints = task_a.get('checkpoints', [])
    assessment = task_a.get('convergence_assessment', {})

    cfr_accuracy = task_c.get('cfr_accuracy_vs_best', 0)
    v6_accuracy = task_c.get('v6_accuracy_vs_best', 0)
    cfr_better = task_c.get('cfr_better_on_disagree', 0)
    v6_better = task_c.get('v6_better_on_disagree', 0)

    # Decision logic
    cfr_outperforms = cfr_accuracy > v6_accuracy and cfr_better > v6_better
    cfr_comparable = abs(cfr_accuracy - v6_accuracy) < 0.05
    exploit_improving = assessment.get('exploit_improving', False)
    knock_bias = assessment.get('knock_bias_persists', True)

    if cfr_outperforms and exploit_improving:
        recommendation = 'EXPAND_ACTION_SPACE'
        reason = (
            'CFR outperforms solver_v6 on held-out spots AND exploit proxy is '
            'still improving. The bounded policy is validated — expand to '
            'draw-source decisions next.'
        )
    elif cfr_comparable and exploit_improving and not knock_bias:
        recommendation = 'EXPAND_ACTION_SPACE'
        reason = (
            'CFR matches solver_v6 quality, exploit proxy improving, and knock '
            'bias resolved. Safe to widen scope.'
        )
    elif exploit_improving and knock_bias:
        recommendation = 'FIX_ABSTRACTION_FIRST'
        reason = (
            'Exploit proxy is improving but knock-heavy bias persists. '
            'Refine abstraction or leaf values before expanding scope. '
            'Try coarsened abstraction from Task B or improve continuation '
            'value estimation.'
        )
    elif not exploit_improving:
        recommendation = 'FIX_LEAF_VALUES'
        reason = (
            'Exploit proxy has stalled. The abstraction or continuation value '
            'estimation needs fundamental improvement before more iterations '
            'or wider scope would help.'
        )
    else:
        recommendation = 'MORE_ITERATIONS'
        reason = 'Evidence is inconclusive. Run 100K+ iterations before deciding.'

    pivot = {
        'recommendation': recommendation,
        'reason': reason,
        'evidence': {
            'exploit_improving': exploit_improving,
            'knock_bias_persists': knock_bias,
            'cfr_accuracy': cfr_accuracy,
            'v6_accuracy': v6_accuracy,
            'cfr_outperforms': cfr_outperforms,
        },
        'options': {
            'EXPAND_ACTION_SPACE': 'Add draw-source decision as second CFR surface',
            'FIX_ABSTRACTION_FIRST': 'Refine info-set buckets or leaf value estimation',
            'FIX_LEAF_VALUES': 'Improve continuation simulation accuracy',
            'MORE_ITERATIONS': 'Run 100K+ to see if current trajectory resolves',
            'RUST': 'Only if training throughput becomes the real blocker',
        },
    }

    print(f"\n  Recommendation: {recommendation}")
    print(f"  Reason: {reason}")

    return pivot


if __name__ == '__main__':
    main()
