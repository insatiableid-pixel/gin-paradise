"""
Reproducible, statistically rigorous benchmarking utilities for Gin Rummy AI.

Features:
- Deterministic seeding per game
- Seat-balanced head-to-head matchups
- 95% Wilson confidence intervals for win rates
- Elo tracking over full round-robins
"""

import math
import random
import sys
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Tuple

from gin_rummy.game import GinRummyGame
from gin_rummy.meld import clear_cache


PlayerFactory = Callable[[], object]


@dataclass
class BenchmarkMatchupResult:
    player_a: str
    player_b: str
    games_played: int = 0
    wins_a: int = 0
    wins_b: int = 0
    seat_games_a_p0: int = 0
    seat_games_a_p1: int = 0
    total_hands: int = 0
    total_void_hands: int = 0
    total_gins_a: int = 0
    total_gins_b: int = 0
    total_undercuts_a: int = 0
    total_undercuts_b: int = 0
    total_points_a: int = 0
    total_points_b: int = 0

    @property
    def win_rate_a(self):
        if self.games_played == 0:
            return 0.0
        return self.wins_a / self.games_played

    @property
    def win_rate_b(self):
        if self.games_played == 0:
            return 0.0
        return self.wins_b / self.games_played

    @property
    def avg_hands_per_game(self):
        if self.games_played == 0:
            return 0.0
        return self.total_hands / self.games_played

    @property
    def avg_points_a(self):
        if self.games_played == 0:
            return 0.0
        return self.total_points_a / self.games_played

    @property
    def avg_points_b(self):
        if self.games_played == 0:
            return 0.0
        return self.total_points_b / self.games_played

    @property
    def avg_point_diff_a(self):
        return self.avg_points_a - self.avg_points_b

    @property
    def win_rate_ci_a(self):
        return wilson_interval(self.wins_a, self.games_played)

    @property
    def win_rate_ci_b(self):
        return wilson_interval(self.wins_b, self.games_played)


@dataclass
class BenchmarkSummary:
    results: Dict[Tuple[str, str], BenchmarkMatchupResult]
    elo_ratings: Dict[str, float]
    games_per_matchup: int
    target_score: int
    seed: int
    elo_k: float
    elapsed_seconds: float


def wilson_interval(successes, trials, z=1.96):
    """Compute Wilson score confidence interval for binomial proportion."""
    if trials <= 0:
        return 0.0, 1.0

    p_hat = successes / trials
    z2 = z * z
    denom = 1.0 + z2 / trials
    center = (p_hat + z2 / (2.0 * trials)) / denom
    margin = (z * math.sqrt((p_hat * (1.0 - p_hat) / trials) + (z2 / (4.0 * trials * trials)))) / denom
    low = max(0.0, center - margin)
    high = min(1.0, center + margin)
    return low, high


def _elo_expected(rating_a, rating_b):
    return 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / 400.0))


def _elo_update(rating_a, rating_b, score_a, k):
    expected_a = _elo_expected(rating_a, rating_b)
    expected_b = 1.0 - expected_a
    score_b = 1.0 - score_a
    new_a = rating_a + k * (score_a - expected_a)
    new_b = rating_b + k * (score_b - expected_b)
    return new_a, new_b


def run_balanced_matchup(player_a_factory, player_b_factory, n_games=2000, target_score=100,
                         seed=0, progress=True, elo_ratings=None, elo_k=24.0):
    """
    Run a deterministic, duplicate-hand matchup.

    Each deal is played TWICE with the same seed — once with A as player0
    and once with B as player0. This eliminates card-distribution luck
    entirely, isolating pure AI skill differences.

    The n_games parameter is the number of unique deals.
    Total games played = 2 × n_games.

    Args:
        player_a_factory: factory for player A
        player_b_factory: factory for player B
        n_games: number of unique deals (each played twice = 2× total games)
        target_score: game target score
        seed: deterministic base seed (seed + i per deal)
        progress: print progress status
        elo_ratings: optional mutable map name->rating to update each game
        elo_k: Elo K factor

    Returns:
        BenchmarkMatchupResult
    """
    if n_games <= 0:
        raise ValueError("n_games must be > 0")

    a_sample = player_a_factory()
    b_sample = player_b_factory()
    result = BenchmarkMatchupResult(player_a=a_sample.name, player_b=b_sample.name)

    start_time = time.time()

    for i in range(n_games):
        deal_seed = seed + i

        # --- Game 1: A as player0, B as player1 ---
        random.seed(deal_seed)
        result.seat_games_a_p0 += 1
        p0 = player_a_factory()
        p1 = player_b_factory()
        gr = GinRummyGame(p0, p1, target_score=target_score, verbose=False).play_game()
        _accumulate_result(result, gr, a_is_p0=True)

        if elo_ratings is not None:
            a_won = (gr.winner == 0)
            score_a = 1.0 if a_won else 0.0
            rating_a = elo_ratings[result.player_a]
            rating_b = elo_ratings[result.player_b]
            rating_a, rating_b = _elo_update(rating_a, rating_b, score_a, elo_k)
            elo_ratings[result.player_a] = rating_a
            elo_ratings[result.player_b] = rating_b

        # --- Game 2: B as player0, A as player1 (same deal) ---
        random.seed(deal_seed)
        result.seat_games_a_p1 += 1
        p0 = player_b_factory()
        p1 = player_a_factory()
        gr = GinRummyGame(p0, p1, target_score=target_score, verbose=False).play_game()
        _accumulate_result(result, gr, a_is_p0=False)

        if elo_ratings is not None:
            a_won = (gr.winner == 1)
            score_a = 1.0 if a_won else 0.0
            rating_a = elo_ratings[result.player_a]
            rating_b = elo_ratings[result.player_b]
            rating_a, rating_b = _elo_update(rating_a, rating_b, score_a, elo_k)
            elo_ratings[result.player_a] = rating_a
            elo_ratings[result.player_b] = rating_b

        if progress and (i + 1) % max(1, n_games // 20) == 0:
            elapsed = time.time() - start_time
            pct = (i + 1) / n_games * 100
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            eta = (n_games - i - 1) / rate if rate > 0 else 0
            sys.stdout.write(
                f"\r  {result.player_a} vs {result.player_b}: "
                f"{pct:5.1f}% ({i + 1}/{n_games} deals) "
                f"[{elapsed:.0f}s elapsed, ~{eta:.0f}s remaining] "
                f"W: {result.wins_a}-{result.wins_b}"
            )
            sys.stdout.flush()

    if progress:
        elapsed = time.time() - start_time
        sys.stdout.write(
            f"\r  {result.player_a} vs {result.player_b}: "
            f"DONE ({n_games} deals, {result.games_played} games in {elapsed:.1f}s)                    \n"
        )
        sys.stdout.flush()

    clear_cache()
    return result


def _accumulate_result(result, gr, a_is_p0):
    """Accumulate a single game outcome into the matchup result."""
    result.games_played += 1
    result.total_hands += gr.hands_played
    result.total_void_hands += gr.void_count

    if a_is_p0:
        a_won = (gr.winner == 0)
        a_score = gr.winner_score if gr.winner == 0 else gr.loser_score
        b_score = gr.winner_score if gr.winner == 1 else gr.loser_score
        result.total_gins_a += gr.gin_count[0]
        result.total_gins_b += gr.gin_count[1]
        result.total_undercuts_a += gr.undercut_count[0]
        result.total_undercuts_b += gr.undercut_count[1]
    else:
        a_won = (gr.winner == 1)
        a_score = gr.winner_score if gr.winner == 1 else gr.loser_score
        b_score = gr.winner_score if gr.winner == 0 else gr.loser_score
        result.total_gins_a += gr.gin_count[1]
        result.total_gins_b += gr.gin_count[0]
        result.total_undercuts_a += gr.undercut_count[1]
        result.total_undercuts_b += gr.undercut_count[0]

    result.total_points_a += a_score
    result.total_points_b += b_score

    if a_won:
        result.wins_a += 1
    else:
        result.wins_b += 1


def run_seeded_round_robin(player_factories, n_games_per_matchup=2000, target_score=100,
                           seed=20260305, elo_k=24.0, progress=True):
    """
    Run a deterministic round-robin with Elo and per-match confidence intervals.

    Args:
        player_factories: dict name -> player factory
        n_games_per_matchup: number of games for each pair
        target_score: score to win each game
        seed: base seed
        elo_k: Elo K factor
        progress: show per-match progress

    Returns:
        BenchmarkSummary
    """
    names = list(player_factories.keys())
    results = {}
    elo = {name: 1500.0 for name in names}

    start = time.time()
    matchup_idx = 0

    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a = names[i]
            b = names[j]
            matchup_seed = seed + matchup_idx * 1000003

            result = run_balanced_matchup(
                player_factories[a],
                player_factories[b],
                n_games=n_games_per_matchup,
                target_score=target_score,
                seed=matchup_seed,
                progress=progress,
                elo_ratings=elo,
                elo_k=elo_k,
            )
            results[(a, b)] = result
            matchup_idx += 1

    elapsed = time.time() - start
    return BenchmarkSummary(
        results=results,
        elo_ratings=elo,
        games_per_matchup=n_games_per_matchup,
        target_score=target_score,
        seed=seed,
        elo_k=elo_k,
        elapsed_seconds=elapsed,
    )


def print_matchup_benchmark_result(result):
    """Print a single matchup report with confidence intervals."""
    ci_low_a, ci_high_a = result.win_rate_ci_a
    ci_low_b, ci_high_b = result.win_rate_ci_b

    print(f"\n{'=' * 72}")
    print(f"  {result.player_a} vs {result.player_b} ({result.games_played} games, seat-balanced)")
    print(f"{'=' * 72}")
    print(f"  Wins: {result.player_a} {result.wins_a} | {result.player_b} {result.wins_b}")
    print(
        f"  Win Rate: {result.player_a} {result.win_rate_a * 100:.2f}% "
        f"(95% CI {ci_low_a * 100:.2f}% to {ci_high_a * 100:.2f}%)"
    )
    print(
        f"            {result.player_b} {result.win_rate_b * 100:.2f}% "
        f"(95% CI {ci_low_b * 100:.2f}% to {ci_high_b * 100:.2f}%)"
    )
    print(f"  Seat Balance: {result.player_a} as P0={result.seat_games_a_p0}, as P1={result.seat_games_a_p1}")
    print(f"  Avg Points/Game: {result.player_a} {result.avg_points_a:.2f} | {result.player_b} {result.avg_points_b:.2f}")
    print(f"  Avg Point Diff ({result.player_a}-{result.player_b}): {result.avg_point_diff_a:+.2f}")
    print(f"  Total Gins: {result.player_a} {result.total_gins_a} | {result.player_b} {result.total_gins_b}")
    print(
        f"  Total Undercuts: {result.player_a} {result.total_undercuts_a} | "
        f"{result.player_b} {result.total_undercuts_b}"
    )
    print(f"  Void Hands: {result.total_void_hands} | Avg Hands/Game: {result.avg_hands_per_game:.2f}")
    print(f"{'=' * 72}")


def print_round_robin_benchmark(summary):
    """Print full benchmark summary including Elo ranking."""
    print(f"\n{'=' * 78}")
    print("  REPRODUCIBLE ROUND-ROBIN BENCHMARK SUMMARY")
    print(f"{'=' * 78}")
    print(f"  Games per matchup: {summary.games_per_matchup}")
    print(f"  Target score: {summary.target_score}")
    print(f"  Base seed: {summary.seed}")
    print(f"  Elo K-factor: {summary.elo_k}")
    print(f"  Total elapsed: {summary.elapsed_seconds:.1f}s")

    print("\n  ELO RANKING:")
    ranked = sorted(summary.elo_ratings.items(), key=lambda x: x[1], reverse=True)
    for idx, (name, rating) in enumerate(ranked, start=1):
        print(f"  {idx}. {name:<18} {rating:>8.2f}")

    print("\n  MATCHUP SNAPSHOT (A-side win rate with 95% CI):")
    for (a, b), result in summary.results.items():
        low, high = result.win_rate_ci_a
        print(
            f"  {a:>12} vs {b:<12} "
            f"{result.win_rate_a * 100:>6.2f}% "
            f"[95% CI {low * 100:>6.2f}%, {high * 100:>6.2f}%]"
        )
