"""
Tournament runner for Gin Rummy AI evaluation.
Supports round-robin and head-to-head matchups with statistical analysis.
"""

import random
import sys
import time
from gin_rummy.game import GinRummyGame
from gin_rummy.meld import clear_cache


class TournamentResult:
    """Aggregated results for a head-to-head matchup."""

    def __init__(self, p0_name, p1_name):
        self.p0_name = p0_name
        self.p1_name = p1_name
        self.games_played = 0
        self.wins = [0, 0]
        self.total_winner_score = [0, 0]
        self.total_loser_score = [0, 0]
        self.total_hands = 0
        self.total_gins = [0, 0]
        self.total_undercuts = [0, 0]
        self.total_voids = 0

    @property
    def win_pct(self):
        if self.games_played == 0:
            return [0, 0]
        return [self.wins[i] / self.games_played * 100 for i in range(2)]

    @property
    def avg_winner_score(self):
        return [
            self.total_winner_score[i] / max(1, self.wins[i])
            for i in range(2)
        ]

    @property
    def avg_hands_per_game(self):
        return self.total_hands / max(1, self.games_played)

    def names(self):
        return [self.p0_name, self.p1_name]


def run_matchup(player0_factory, player1_factory, n_games=1000, target_score=100,
                verbose=False, progress=True, seed=None):
    """
    Run a head-to-head matchup between two player types.

    Args:
        player0_factory: callable returning a Player instance
        player1_factory: callable returning a Player instance
        n_games: number of games to play
        target_score: points needed to win a game
        verbose: print each hand result
        progress: print progress bar
        seed: optional deterministic base seed; game i uses seed+i

    Returns:
        TournamentResult
    """
    p0_sample = player0_factory()
    p1_sample = player1_factory()
    result = TournamentResult(p0_sample.name, p1_sample.name)

    start_time = time.time()

    for i in range(n_games):
        if seed is not None:
            random.seed(seed + i)

        # Create fresh player instances each game
        p0 = player0_factory()
        p1 = player1_factory()

        game = GinRummyGame(p0, p1, target_score=target_score, verbose=verbose)
        gr = game.play_game()

        result.games_played += 1
        result.wins[gr.winner] += 1
        result.total_winner_score[gr.winner] += gr.winner_score
        result.total_loser_score[gr.winner] += gr.loser_score
        result.total_hands += gr.hands_played
        for p in range(2):
            result.total_gins[p] += gr.gin_count[p]
            result.total_undercuts[p] += gr.undercut_count[p]
        result.total_voids += gr.void_count

        if progress and (i + 1) % max(1, n_games // 20) == 0:
            elapsed = time.time() - start_time
            pct = (i + 1) / n_games * 100
            rate = (i + 1) / elapsed
            eta = (n_games - i - 1) / rate if rate > 0 else 0
            sys.stdout.write(
                f"\r  {result.p0_name} vs {result.p1_name}: "
                f"{pct:5.1f}% ({i + 1}/{n_games}) "
                f"[{elapsed:.0f}s elapsed, ~{eta:.0f}s remaining] "
                f"W: {result.win_pct[0]:.1f}%-{result.win_pct[1]:.1f}%"
            )
            sys.stdout.flush()

    if progress:
        elapsed = time.time() - start_time
        sys.stdout.write(
            f"\r  {result.p0_name} vs {result.p1_name}: "
            f"DONE ({n_games} games in {elapsed:.1f}s)                    \n"
        )
        sys.stdout.flush()

    # Clear meld cache between matchups
    clear_cache()

    return result


def print_matchup_result(result):
    """Print detailed statistics for a matchup."""
    names = result.names()

    print(f"\n{'=' * 60}")
    print(f"  {names[0]} vs {names[1]}  ({result.games_played} games)")
    print(f"{'=' * 60}")
    print(f"  {'Metric':<30} {names[0]:>12} {names[1]:>12}")
    print(f"  {'-' * 54}")
    print(f"  {'Wins':<30} {result.wins[0]:>12} {result.wins[1]:>12}")
    print(f"  {'Win %':<30} {result.win_pct[0]:>11.1f}% {result.win_pct[1]:>11.1f}%")
    print(f"  {'Avg Winner Score (PPRW)':<30} {result.avg_winner_score[0]:>12.1f} {result.avg_winner_score[1]:>12.1f}")
    print(f"  {'Total Gins':<30} {result.total_gins[0]:>12} {result.total_gins[1]:>12}")
    print(f"  {'Total Undercuts':<30} {result.total_undercuts[0]:>12} {result.total_undercuts[1]:>12}")
    print(f"  {'Void Hands':<30} {result.total_voids:>12}")
    print(f"  {'Avg Hands/Game':<30} {result.avg_hands_per_game:>12.1f}")
    print(f"{'=' * 60}")


def run_round_robin(player_factories, n_games=1000, target_score=100, progress=True, seed=None):
    """
    Run a full round-robin tournament.

    Args:
        player_factories: dict of name -> factory callable
        n_games: games per matchup
        target_score: points to win
        progress: show progress
        seed: optional deterministic base seed for all matchups

    Returns:
        dict of (name_i, name_j) -> TournamentResult
    """
    names = list(player_factories.keys())
    results = {}

    print(f"\nRound-Robin Tournament: {len(names)} players, {n_games} games per matchup")
    print(f"Players: {', '.join(names)}\n")

    matchup_idx = 0
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            matchup_seed = None
            if seed is not None:
                matchup_seed = seed + matchup_idx * 1000003

            r = run_matchup(
                player_factories[names[i]],
                player_factories[names[j]],
                n_games=n_games,
                target_score=target_score,
                progress=progress,
                seed=matchup_seed,
            )
            results[(names[i], names[j])] = r
            matchup_idx += 1

    return results


def print_round_robin_results(results, player_names):
    """Print round-robin results as a matrix like Figure 3 in the paper."""
    print(f"\n{'=' * 70}")
    print("  HEAD-TO-HEAD WIN PERCENTAGES")
    print(f"{'=' * 70}")

    # Header
    header = f"  {'':>18}"
    for name in player_names:
        header += f" {name:>10}"
    header += f" {'Avg Win%':>10}"
    print(header)
    print(f"  {'-' * (18 + 11 * (len(player_names) + 1))}")

    # Track average win rates
    avg_wins = {name: [] for name in player_names}

    for row_name in player_names:
        line = f"  {row_name:>18}"
        for col_name in player_names:
            if row_name == col_name:
                line += f" {'---':>10}"
            else:
                key = (row_name, col_name)
                rev_key = (col_name, row_name)
                if key in results:
                    wp = results[key].win_pct[0]
                elif rev_key in results:
                    wp = results[rev_key].win_pct[1]
                else:
                    wp = 0
                line += f" {wp:>9.1f}%"
                avg_wins[row_name].append(wp)
        avg = sum(avg_wins[row_name]) / max(1, len(avg_wins[row_name]))
        line += f" {avg:>9.1f}%"
        print(line)

    print(f"{'=' * 70}")

    # Print rankings
    print(f"\n  RANKINGS:")
    rankings = sorted(avg_wins.items(), key=lambda x: sum(x[1]) / max(1, len(x[1])), reverse=True)
    for i, (name, wins) in enumerate(rankings):
        avg = sum(wins) / max(1, len(wins))
        print(f"  {i + 1}. {name}: {avg:.1f}% average win rate")
