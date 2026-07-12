"""
Directive 58 — Isolated Opening DW=9 Knock Study.

Paired same-world evaluation: for each scenario × hidden world,
force 'knock now' vs 'continue' from the exact same state and
compare hand-level point outcomes.

Gin-probability measured via greedy rollout (200 trials, 6-turn horizon).

Opponent / continuation policies:
  Robust:       ApexMCTSGoGin  (patient mirror)
  Robust2:      ApexMCTSPaperKnock (textbook heuristic knock)
  Exploitative: ApexMCTS (aggressive baseline)
"""

import os, sys, json, random, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from gin_rummy.card import (
    rank, suit, make_card, deadwood_value, card_str, hand_str,
    NUM_CARDS, parse_card,
)
from gin_rummy.meld import (
    best_meld_arrangement, find_all_melds, compute_deadwood, compute_layoffs,
)
from gin_rummy.game import GIN_BONUS, UNDERCUT_BONUS
from gin_rummy.player import Player
from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.apex_mcts_gogin import ApexMCTSGoGin
from gin_rummy.apex_mcts_paperknock import ApexMCTSPaperKnock

_c = parse_card

# ── Scenario family (all verified DW=9, 10 cards) ────────────────────

SCENARIO_FAMILY = [
    # --- LOW gin-liveness ---
    dict(label='L1',
         hand=[_c('AS'),_c('AD'),_c('AH'),_c('2C'),_c('3C'),_c('4C'),
               _c('TH'),_c('JH'),_c('QH'),_c('9C')],
         structure='one-card-dw',
         desc='3 melds + lone 9C. Isolated rank/suit, few gin paths.'),
    dict(label='L2',
         hand=[_c('JS'),_c('QS'),_c('KS'),_c('4C'),_c('4D'),_c('4H'),
               _c('7H'),_c('8H'),_c('9H'),_c('9S')],
         structure='one-card-dw',
         desc='3 melds + lone 9S. Only distant set draws for gin.'),
    dict(label='L3',
         hand=[_c('AC'),_c('AD'),_c('AH'),_c('6S'),_c('7S'),_c('8S'),
               _c('TH'),_c('JH'),_c('QH'),_c('9D')],
         structure='one-card-dw',
         desc='3 melds + 9D. All neighbours occupied by melds.'),
    dict(label='L4',
         hand=[_c('5S'),_c('5D'),_c('5H'),_c('8C'),_c('9C'),_c('TC'),
               _c('AC'),_c('2D'),_c('3H'),_c('3S')],
         structure='multi-card-dw',
         desc='2 melds + AC,2D,3H,3S scattered DW. Dispersed, low synergy.'),

    # --- MEDIUM gin-liveness ---
    dict(label='M1',
         hand=[_c('3C'),_c('3D'),_c('3H'),_c('TS'),_c('JS'),_c('QS'),
               _c('AC'),_c('AD'),_c('AS'),_c('9D')],
         structure='one-card-dw',
         desc='3 melds (incl A-set) + 9D. Modest run/set draws.'),
    dict(label='M2',
         hand=[_c('5D'),_c('6D'),_c('7D'),_c('KC'),_c('KD'),_c('KH'),
               _c('AS'),_c('AH'),_c('AD'),_c('9C')],
         structure='one-card-dw',
         desc='3 melds + 9C. Some set potential.'),
    dict(label='M3',
         hand=[_c('JC'),_c('QC'),_c('KC'),_c('4D'),_c('5D'),_c('6D'),
               _c('2C'),_c('2S'),_c('2H'),_c('9S')],
         structure='one-card-dw',
         desc='3 melds + 9S. Mixed set/run draws.'),
    dict(label='M4',
         hand=[_c('8S'),_c('9S'),_c('TS'),_c('2C'),_c('2D'),_c('2H'),
               _c('KD'),_c('KH'),_c('KC'),_c('9C')],
         structure='one-card-dw',
         desc='3 melds + 9C. 9C can set via 9D/9H (9S melded).'),

    # --- HIGH gin-liveness ---
    dict(label='H1',
         hand=[_c('3C'),_c('4C'),_c('5C'),_c('TH'),_c('JH'),_c('QH'),
               _c('7D'),_c('7S'),_c('7H'),_c('9D')],
         structure='one-card-dw',
         desc='3 melds (incl 7-set) + 9D. Rich draws from 7-set overhang.'),
    dict(label='H2',
         hand=[_c('AC'),_c('2C'),_c('3C'),_c('8D'),_c('9D'),_c('TD'),
               _c('6H'),_c('6S'),_c('6D'),_c('9H')],
         structure='one-card-dw',
         desc='3 melds + 9H. 9H can set (9C/9S free) or run (8H-TH).'),
    dict(label='H3',
         hand=[_c('AC'),_c('2C'),_c('3C'),_c('4C'),_c('5C'),_c('6C'),
               _c('TD'),_c('JD'),_c('QD'),_c('9H')],
         structure='one-card-dw',
         desc='6-card run + 3-card run + 9H. Very strong base structure.'),
    dict(label='H4',
         hand=[_c('5H'),_c('6H'),_c('7H'),_c('TC'),_c('TD'),_c('TS'),
               _c('QC'),_c('QD'),_c('QH'),_c('9C')],
         structure='one-card-dw',
         desc='3 melds + 9C. Multiple partial-meld neighbours free.'),
]


# ── Gin probability via rollout ───────────────────────────────────────

def measure_gin_probability(hand, n_rollouts=200, max_horizon=6, rng=None):
    if rng is None:
        rng = random.Random(12345)
    known = set(hand)
    pool_base = [c for c in range(NUM_CARDS) if c not in known]
    gin_count = 0
    for _ in range(n_rollouts):
        pool = list(pool_base)
        rng.shuffle(pool)
        h = list(hand)
        pi = 0
        for _ in range(max_horizon):
            if pi >= len(pool):
                break
            draw = pool[pi]; pi += 1
            h.append(draw)
            best_disc = None; best_dw = 999
            for i, c in enumerate(h):
                rest = h[:i] + h[i+1:]
                dw = compute_deadwood(rest)
                if dw < best_dw:
                    best_dw = dw; best_disc = c
            h.remove(best_disc)
            if best_dw == 0:
                gin_count += 1
                break
    return gin_count / n_rollouts, gin_count, n_rollouts


# ── Scoring helpers ───────────────────────────────────────────────────

def score_knock_immediate(knocker_hand, opponent_hand):
    k_melds, k_dw_cards, k_dw = best_meld_arrangement(knocker_hand)
    o_melds, o_dw_cards, o_dw = best_meld_arrangement(opponent_hand)
    if k_dw == 0:
        return GIN_BONUS + o_dw
    layoffs = compute_layoffs(k_melds, o_dw_cards)
    o_dw_after = max(0, o_dw - sum(deadwood_value(c) for c in layoffs))
    if k_dw < o_dw_after:
        return o_dw_after - k_dw
    else:
        return -(UNDERCUT_BONUS + k_dw - o_dw_after)


def play_continuation(hero_hand, opp_hand, stock, opp_factory,
                      turn_start=1, my_score=0, opp_score=0):
    """Play out the hand after hero declines to knock (turn 0).
    Hero uses ApexMCTS policy; opponent uses opp_factory.
    Returns signed hand points for hero."""
    hero_h = list(hero_hand)
    opp_h = list(opp_hand)
    stk = list(stock)
    discard_pile = []

    hero_p = ApexMCTS(seed=None)
    hero_p.new_hand(list(hero_h), 1)
    opp_p = opp_factory()
    opp_p.new_hand(list(opp_h), 0)
    players = [hero_p, opp_p]

    current = 1  # opponent goes next after hero declined knock

    for t in range(turn_start, turn_start + 40):
        if len(stk) <= 2:
            return 0
        hand = hero_h if current == 0 else opp_h
        gs = {
            'turn_number': t,
            'my_score': my_score if current == 0 else opp_score,
            'opp_score': opp_score if current == 0 else my_score,
            'deck_remaining': len(stk),
            'discard_pile': list(discard_pile),
        }
        top = discard_pile[-1] if discard_pile else None
        take = False
        if top is not None:
            take = players[current].draw_decision(top, list(hand), gs)
        drew_disc = False; drawn = None
        if take and top is not None:
            drawn = discard_pile.pop(); hand.append(drawn); drew_disc = True
            players[1-current].notify_opponent_draw(True, drawn)
        else:
            drawn = stk.pop(); hand.append(drawn)
            players[1-current].notify_opponent_draw(False)

        gs['deck_remaining'] = len(stk)
        disc = players[current].discard_decision(list(hand), drew_disc, drawn, gs)
        if disc not in hand:
            disc = max(hand, key=deadwood_value)
        if drew_disc and disc == drawn:
            cands = [c for c in hand if c != drawn]
            disc = max(cands, key=deadwood_value) if cands else hand[0]
        hand.remove(disc)
        discard_pile.append(disc)
        players[1-current].notify_opponent_discard(disc)

        _, _, dw_k = best_meld_arrangement(hand)
        knock = False
        if dw_k <= 10:
            knock = players[current].knock_decision(list(hand), gs)
        if len(stk) <= 2 and dw_k <= 10:
            knock = True
        if knock:
            other = opp_h if current == 0 else hero_h
            pts = score_knock_immediate(list(hand), list(other))
            return pts if current == 0 else -pts
        current = 1 - current
    return 0


# ── Paired evaluation ────────────────────────────────────────────────

def run_paired(scenario, opp_factory, n_worlds=200, seed=42):
    rng = random.Random(seed)
    hand = scenario['hand']
    known = set(hand)
    knock_pts = []; cont_pts = []; diffs = []
    for _ in range(n_worlds):
        pool = [c for c in range(NUM_CARDS) if c not in known]
        rng.shuffle(pool)
        opp = pool[:10]; stk = pool[10:]
        pk = score_knock_immediate(list(hand), list(opp))
        pc = play_continuation(list(hand), list(opp), list(stk), opp_factory)
        knock_pts.append(pk); cont_pts.append(pc); diffs.append(pk - pc)
    return knock_pts, cont_pts, diffs


# ── Main ──────────────────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("  DIRECTIVE 58: Isolated Opening DW=9 Knock Study")
    print("=" * 70)

    scenarios = []
    for sd in SCENARIO_FAMILY:
        melds, dw_cards, dw = best_meld_arrangement(sd['hand'])
        if dw != 9 or len(sd['hand']) != 10:
            print(f"  SKIP {sd['label']}: DW={dw}")
            continue
        sd['verified_dw'] = dw
        sd['n_dw_cards'] = len(dw_cards)
        scenarios.append(sd)
    print(f"\n{len(scenarios)} valid scenarios")

    # Gin probability
    print("\nGin-probability rollout (200 × 6-turn horizon)...")
    for sc in scenarios:
        gp, gc, gt = measure_gin_probability(sc['hand'])
        sc['gin_prob'] = gp
        if gp < 0.05:
            sc['stratum'] = 'LOW'
        elif gp < 0.20:
            sc['stratum'] = 'MED'
        else:
            sc['stratum'] = 'HIGH'
        print(f"  {sc['label']:4s}: gin_prob={gp:.3f} → {sc['stratum']}")

    N = 200
    opp_configs = [
        ('Robust_GoGin',       lambda: ApexMCTSGoGin(seed=None)),
        ('Robust_PaperKnock',  lambda: ApexMCTSPaperKnock(seed=None)),
        ('Aggressive_ApexMCTS',lambda: ApexMCTS(seed=None)),
    ]

    all_results = {}
    for opp_label, opp_fac in opp_configs:
        print(f"\n{'─'*60}")
        print(f"  vs {opp_label}  ({N} worlds)")
        print(f"{'─'*60}")
        for sc in scenarios:
            t0 = time.time()
            kp, cp, df = run_paired(sc, opp_fac, n_worlds=N, seed=42)
            el = time.time() - t0
            ak = sum(kp)/len(kp); ac = sum(cp)/len(cp); ad = sum(df)/len(df)
            kb = sum(1 for d in df if d > 0)/len(df)
            cb = sum(1 for d in df if d < 0)/len(df)
            fav = "KNOCK" if ad > 0.5 else "CONTINUE" if ad < -0.5 else "~TIE"
            key = (sc['label'], opp_label)
            all_results[key] = dict(
                avg_knock=ak, avg_cont=ac, avg_diff=ad,
                knock_better_frac=kb, cont_better_frac=cb,
                stratum=sc['stratum'], gin_prob=sc['gin_prob'],
            )
            print(f"  {sc['label']:4s} [{sc['stratum']:4s}] gp={sc['gin_prob']:.3f} "
                  f"| K={ak:+6.1f} C={ac:+6.1f} Δ={ad:+5.1f} → {fav:8s} [{el:.1f}s]")

    # Stratum aggregates
    print(f"\n{'='*70}")
    print("  STRATUM AGGREGATES")
    print(f"{'='*70}")
    for opp_label, _ in opp_configs:
        print(f"\n  vs {opp_label}:")
        for st in ['LOW','MED','HIGH']:
            ms = [v for k,v in all_results.items() if v['stratum']==st and k[1]==opp_label]
            if not ms: continue
            ad = sum(v['avg_diff'] for v in ms)/len(ms)
            fav = "KNOCK" if ad > 0.5 else "CONTINUE" if ad < -0.5 else "~TIE"
            print(f"    {st:4s} ({len(ms)} hands): avg Δ = {ad:+5.1f} → {fav}")

    # Save JSON
    out = {
        'scenarios': [{
            'label': s['label'], 'hand': [card_str(c) for c in s['hand']],
            'structure': s['structure'], 'gin_prob': s['gin_prob'],
            'stratum': s['stratum'], 'verified_dw': 9,
        } for s in scenarios],
        'results': {f"{k[0]}_vs_{k[1]}": v for k,v in all_results.items()},
    }
    out_path = os.path.join(os.path.dirname(__file__), '..', 'opening_dw9_results.json')
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=2)
    print(f"\nResults saved to {out_path}")
    return scenarios, all_results


if __name__ == '__main__':
    main()
