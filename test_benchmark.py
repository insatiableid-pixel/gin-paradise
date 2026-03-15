import unittest

from gin_rummy.benchmark import run_balanced_matchup, run_seeded_round_robin, wilson_interval
from gin_rummy.player import RandomPlayer, SimplePlayer


class BenchmarkHarnessTests(unittest.TestCase):

    def test_wilson_interval_contains_empirical_rate(self):
        low, high = wilson_interval(55, 100)
        self.assertLessEqual(low, 0.55)
        self.assertGreaterEqual(high, 0.55)
        self.assertLessEqual(low, high)

    def test_balanced_matchup_reproducible_with_fixed_seed(self):
        factory_a = lambda: SimplePlayer("Simple")
        factory_b = lambda: RandomPlayer("Random")

        r1 = run_balanced_matchup(
            factory_a,
            factory_b,
            n_games=20,
            target_score=50,
            seed=12345,
            progress=False,
        )
        r2 = run_balanced_matchup(
            factory_a,
            factory_b,
            n_games=20,
            target_score=50,
            seed=12345,
            progress=False,
        )

        self.assertEqual(r1.wins_a, r2.wins_a)
        self.assertEqual(r1.wins_b, r2.wins_b)
        self.assertEqual(r1.total_hands, r2.total_hands)
        self.assertEqual(r1.total_points_a, r2.total_points_a)
        self.assertEqual(r1.total_points_b, r2.total_points_b)

    def test_balanced_matchup_seat_distribution(self):
        result = run_balanced_matchup(
            lambda: SimplePlayer("Simple"),
            lambda: RandomPlayer("Random"),
            n_games=11,
            target_score=30,
            seed=7,
            progress=False,
        )

        self.assertEqual(result.seat_games_a_p0 + result.seat_games_a_p1, 11)
        self.assertLessEqual(abs(result.seat_games_a_p0 - result.seat_games_a_p1), 1)

    def test_round_robin_outputs_elo_and_results(self):
        summary = run_seeded_round_robin(
            {
                "Simple": lambda: SimplePlayer("Simple"),
                "Random": lambda: RandomPlayer("Random"),
            },
            n_games_per_matchup=8,
            target_score=30,
            seed=2026,
            elo_k=24.0,
            progress=False,
        )

        self.assertIn("Simple", summary.elo_ratings)
        self.assertIn("Random", summary.elo_ratings)
        self.assertIn(("Simple", "Random"), summary.results)


if __name__ == "__main__":
    unittest.main()
