"""Quick test: Titan vs Simple & DeepKnock (skip Heisenbot — its code freezes)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gin_rummy.player import SimplePlayer
from gin_rummy.deepknock import DeepKnock
from gin_rummy.titan import Titan
from gin_rummy.tournament import run_matchup, print_matchup_result

N = 500

matchups = [
    ("Titan", Titan, "Simple", SimplePlayer),
    ("Titan", Titan, "DeepKnock", DeepKnock),
    ("DeepKnock", DeepKnock, "Simple", SimplePlayer),
]

for na, A, nb, B in matchups:
    r = run_matchup(lambda a=A, n=na: a(n), lambda b=B, n=nb: b(n), n_games=N, progress=True)
    print_matchup_result(r)
    wp = r.win_pct[0]
    print(f"  >>> {na if wp>50 else nb} WINS ({max(wp,100-wp):.1f}%) <<<\n")
