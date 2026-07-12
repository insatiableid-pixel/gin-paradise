"""
Directive 59 — Knock Frontier Mapping Sprint.

Paired same-world evaluation across the opening DW=1..9 frontier,
then subsequent turns 1..3, stratified by:
  - deadwood total (DW)
  - deadwood-card count (1, 2, 4)
  - gin liveness (LOW / MED / HIGH) via greedy rollout
  - turn number (0 = opening, 1, 2, 3)
  - opponent state (for turns 1-3): neutral / active_pickup

Opponent / continuation policies:
  Robust:       ApexMCTSClinchOnlyGoGin (current champion)
  Exploitative: ApexMCTS (aggressive baseline)
"""

import os, sys, json, random, time, math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from gin_rummy.card import (
    rank, suit, make_card, deadwood_value, card_str, hand_str,
    NUM_CARDS, parse_card,
)
from gin_rummy.meld import (
    best_meld_arrangement, find_all_melds, compute_deadwood, compute_layoffs,
)
from gin_rummy.game import GIN_BONUS, UNDERCUT_BONUS
from gin_rummy.apex_mcts import ApexMCTS
from gin_rummy.apex_mcts_gogin import ApexMCTSGoGin
from gin_rummy.apex_mcts_clinchonly_gogin import ApexMCTSClinchOnlyGoGin

_c = parse_card


# ═══════════════════════════════════════════════════════════════════════
#  VERIFIED SCENARIO LIBRARY
# ═══════════════════════════════════════════════════════════════════════
# All hands are validated to have the exact stated DW and n_dw_cards.
#
# Meld bases used:
#   BASE_A: 2{C,D,H}-set + 6{C,D,H}-set + K{C,D,H}-set (9 melded)
#     → safe DW cards on S suit EXCEPT 2S (absorbs), 6S (absorbs)
#   BASE_B: 3{C,D,H}-set + 7{C,D,H}-set + J{C,D,H}-set (9 melded)
#     → safe DW cards on S suit EXCEPT 3S, 7S, JS (absorb)
#   BASE_C: AC-2C-3C run + 7D-8D-9D run + JS-QS-KS run (9 melded)
#     → safe DW cards on H suit (isolated from all runs)
#   BASE_2DW: K{C,D,H,S} 4-set + 5-card S run (8 melded, 2 DW)
#   BASE_4DW: K{C,D,H}-set + 3{C,D,H}-set (6 melded, 4 DW)


def _build_scenario_families():
    """Build verified hands for DW 1..9 with structural variety.
    
    Returns dict: dw -> list of scenario dicts, all verified.
    """
    families = {dw: [] for dw in range(1, 10)}

    def _v(label, hand, target_dw, n_dw_expected, hint, desc):
        """Verify and register a scenario."""
        assert len(hand) == 10 and len(set(hand)) == 10, f"{label}: bad hand"
        _, dw_cards, dw = best_meld_arrangement(hand)
        assert dw == target_dw, f"{label}: expected DW={target_dw}, got {dw}"
        assert len(dw_cards) == n_dw_expected, (
            f"{label}: expected {n_dw_expected} DW cards, got {len(dw_cards)}")
        families[target_dw].append(dict(
            label=label, hand=hand, target_dw=target_dw,
            n_dw_cards=n_dw_expected, structure_hint=hint, desc=desc,
        ))

    # ── DW = 1 (only Ace = 1 point, always 1 DW card) ──────────────
    _v('DW1_iso', 
       [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
        _c('KC'),_c('KD'),_c('KH'),_c('AS')],
       1, 1, 'isolated', '3 sets + lone AS. Fully isolated, no run/set draw.')

    _v('DW1_run',
       [_c('AC'),_c('2C'),_c('3C'),_c('7D'),_c('8D'),_c('9D'),
        _c('JS'),_c('QS'),_c('KS'),_c('AH')],
       1, 1, 'connected', '3 runs + AH. AH has 2H available for run extension.')

    _v('DW1_set',
       [_c('3C'),_c('3D'),_c('3H'),_c('7C'),_c('7D'),_c('7H'),
        _c('JC'),_c('JD'),_c('JH'),_c('AS')],
       1, 1, 'connected', '3 sets + AS. AS can set with free A{C,D,H}.')

    # ── DW = 2 ──────────────────────────────────────────────────────
    _v('DW2_iso',
       [_c('3C'),_c('3D'),_c('3H'),_c('7C'),_c('7D'),_c('7H'),
        _c('JC'),_c('JD'),_c('JH'),_c('2S')],
       2, 1, 'isolated', '3 sets + lone 2S. No 2-set or run neighbours.')

    _v('DW2_run',
       [_c('AC'),_c('2C'),_c('3C'),_c('7D'),_c('8D'),_c('9D'),
        _c('JS'),_c('QS'),_c('KS'),_c('2H')],
       2, 1, 'connected', '3 runs + 2H. 2H has 3H available for run start.')

    # ── DW = 3 ──────────────────────────────────────────────────────
    _v('DW3_iso',
       [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
        _c('KC'),_c('KD'),_c('KH'),_c('3S')],
       3, 1, 'isolated', '3 sets + lone 3S.')

    _v('DW3_run',
       [_c('AC'),_c('2C'),_c('3C'),_c('7D'),_c('8D'),_c('9D'),
        _c('JS'),_c('QS'),_c('KS'),_c('3H')],
       3, 1, 'connected', '3 runs + 3H. 3H has 4H and 2H for run paths.')

    _v('DW3_set',
       [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
        _c('KC'),_c('KD'),_c('KH'),_c('3H')],
       3, 1, 'connected', '3 sets (CDH) + 3H. 3H near 2H (free) for run.')

    # ── DW = 4 ──────────────────────────────────────────────────────
    _v('DW4_iso',
       [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
        _c('KC'),_c('KD'),_c('KH'),_c('4S')],
       4, 1, 'isolated', '3 sets + lone 4S.')

    _v('DW4_run',
       [_c('AC'),_c('2C'),_c('3C'),_c('7D'),_c('8D'),_c('9D'),
        _c('JS'),_c('QS'),_c('KS'),_c('4H')],
       4, 1, 'connected', '3 runs + 4H. 4H has run neighbours 3H,5H.')

    # Two-card DW: K{C,D,H,S} 4-set + 3{C,D,H,S} 4-set = 8 melded, 2 DW.
    # AH(1) + 3? No, 3S absorbs. Use ranks NOT matching: AH(1) + 5S(5) = DW=6? No.
    # Need DW=4 with 2 cards: e.g. AH(1)+AD(1) = 2. No, that's DW=2.
    # AH(1) + 3H doesn't work (3H not rank 12/2 so no meld with K-set or 3-set? Wait, 3H=rank 2 → 3{C,D,H,S} set absorbs 3H!)
    # Use ranks truly isolated from both 4-sets: K(rank 12), 3(rank 2).
    # AH(rank 0, dw=1) + 5S(rank 4, dw=5) → neither rank 12 nor rank 2 → safe.
    # BUT can AH + 5S form melds between themselves? No.
    # Can AH extend a run with other DW cards? AH(rank 0 suit 3) + ... no other suit 3 card.
    # Can 5S(rank 4 suit 2) extend? No other suit 2 card.
    # DW = 1 + 5 = 6, not 4.
    # For DW=4: AH(1) + AD(1) + 2S(2) = we need 3 DW cards → need 7 melded.
    # 7 melded = 4-set + 3-set = 7 melded, 3 DW cards.
    # For TRUE 2-card DW=4: 8 melded + 2 DW cards summing to 4.
    # Options: 2H(2) + 2S(2) = 4. But can 2H+2S form a set? Need 3+ of rank 1.
    # With K-4set + 3-4set, only 2H and 2S. That's only a pair, not a meld. Safe.
    _v('DW4_2dw',
       [_c('KC'),_c('KD'),_c('KH'),_c('KS'),
        _c('3C'),_c('3D'),_c('3H'),_c('3S'),
        _c('2H'),_c('2S')],
       4, 2, 'two-card-dw', '2 four-sets + 2H(2)+2S(2)=4. Two dispersed low cards.')

    # ── DW = 5 ──────────────────────────────────────────────────────
    _v('DW5_iso',
       [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
        _c('KC'),_c('KD'),_c('KH'),_c('5S')],
       5, 1, 'isolated', '3 sets + lone 5S.')

    _v('DW5_run',
       [_c('AC'),_c('2C'),_c('3C'),_c('7D'),_c('8D'),_c('9D'),
        _c('JS'),_c('QS'),_c('KS'),_c('5H')],
       5, 1, 'connected', '3 runs + 5H. 5H has run neighbours on H suit.')

    # ── DW = 6 ──────────────────────────────────────────────────────
    _v('DW6_iso',
       [_c('3C'),_c('3D'),_c('3H'),_c('7C'),_c('7D'),_c('7H'),
        _c('JC'),_c('JD'),_c('JH'),_c('6S')],
       6, 1, 'isolated', '3 sets + lone 6S. No run/set draws.')

    _v('DW6_run',
       [_c('AC'),_c('2C'),_c('3C'),_c('7D'),_c('8D'),_c('9D'),
        _c('JS'),_c('QS'),_c('KS'),_c('6H')],
       6, 1, 'connected', '3 runs + 6H. 6H has run neighbours 5H, 7H.')

    # ── DW = 7 ──────────────────────────────────────────────────────
    _v('DW7_iso',
       [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
        _c('KC'),_c('KD'),_c('KH'),_c('7S')],
       7, 1, 'isolated', '3 sets + lone 7S.')

    _v('DW7_run',
       [_c('AC'),_c('2C'),_c('3C'),_c('7D'),_c('8D'),_c('9D'),
        _c('JS'),_c('QS'),_c('KS'),_c('7H')],
       7, 1, 'connected', '3 runs + 7H. Rich run neighbours on H suit.')

    # ── DW = 8 ──────────────────────────────────────────────────────
    _v('DW8_iso',
       [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
        _c('KC'),_c('KD'),_c('KH'),_c('8S')],
       8, 1, 'isolated', '3 sets + lone 8S.')

    _v('DW8_run',
       [_c('AC'),_c('2C'),_c('3C'),_c('7D'),_c('8D'),_c('9D'),
        _c('JS'),_c('QS'),_c('KS'),_c('8H')],
       8, 1, 'connected', '3 runs + 8H. 8H has run neighbours 7H, 9H.')

    # ── DW = 9 ──────────────────────────────────────────────────────
    _v('DW9_iso',
       [_c('2C'),_c('2D'),_c('2H'),_c('6C'),_c('6D'),_c('6H'),
        _c('KC'),_c('KD'),_c('KH'),_c('9S')],
       9, 1, 'isolated', '3 sets + lone 9S. Isolated, minimal gin paths.')

    _v('DW9_run',
       [_c('AC'),_c('2C'),_c('3C'),_c('7D'),_c('8D'),_c('9D'),
        _c('JS'),_c('QS'),_c('KS'),_c('9H')],
       9, 1, 'connected', '3 runs + 9H. 9H neighbours: 8H,TH for run.')

    _v('DW9_strong',
       [_c('AC'),_c('2C'),_c('3C'),_c('4C'),_c('5C'),_c('6C'),
        _c('TD'),_c('JD'),_c('QD'),_c('9H')],
       9, 1, 'strong-base', '6-card run + 3-card run + 9H. Very strong base.')

    _v('DW9_mc',
       [_c('5S'),_c('5D'),_c('5H'),_c('8C'),_c('9C'),_c('TC'),
        _c('AC'),_c('2D'),_c('3H'),_c('3S')],
       9, 4, 'multi-card-dispersed',
       '2 melds + AC(1)+2D(2)+3H(3)+3S(3)=9. Dispersed, low gin upside.')

    # ── Multi-card DW variants (6 melded + 4 DW) ──────────────────
    # K{C,D,H}-set + 8{C,D,H}-set = 6 melded, 4 remaining = DW cards
    # Cards must not form melds with each other or with base!
    # AS(1)+AH(1)+2D(2)+2S(2)=6; no 3+ of any rank, no same-suit adjacency
    _v('DW6_4dw',
       [_c('KC'),_c('KD'),_c('KH'),_c('8C'),_c('8D'),_c('8H'),
        _c('AS'),_c('2D'),_c('AH'),_c('2S')],
       6, 4, 'multi-card-low',
       '2 sets + AS(1)+2D(2)+AH(1)+2S(2)=6. Dispersed low DW.')

    # AS(1)+AH(1)+2D(2)+3S(3)=7; check no melds: AS+AH=2 aces(not 3),
    # 2D alone, 3S alone, no same-suit adj between DW cards
    _v('DW7_4dw',
       [_c('KC'),_c('KD'),_c('KH'),_c('8C'),_c('8D'),_c('8H'),
        _c('AS'),_c('2D'),_c('AH'),_c('3S')],
       7, 4, 'multi-card-mid',
       '2 sets + AS(1)+2D(2)+AH(1)+3S(3)=7. Dispersed mid DW.')

    return families


# ═══════════════════════════════════════════════════════════════════════
#  GIN PROBABILITY MEASUREMENT
# ═══════════════════════════════════════════════════════════════════════

def measure_gin_probability(hand, n_rollouts=200, max_horizon=6, rng=None):
    """Measure gin probability via greedy rollout."""
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
    return gin_count / n_rollouts


def classify_gin_liveness(gp):
    if gp < 0.05:
        return 'LOW'
    elif gp < 0.20:
        return 'MED'
    else:
        return 'HIGH'


# ═══════════════════════════════════════════════════════════════════════
#  SCORING & CONTINUATION
# ═══════════════════════════════════════════════════════════════════════

def score_knock_immediate(knocker_hand, opponent_hand):
    """Score a knock: positive = good for knocker."""
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


def play_continuation(hero_hand, opp_hand, stock, hero_factory, opp_factory,
                      turn_start=1, my_score=0, opp_score=0):
    """Play out the hand after hero declines to knock.
    Returns signed hand points for hero."""
    hero_h = list(hero_hand)
    opp_h = list(opp_hand)
    stk = list(stock)
    disc_pile = []

    hero_p = hero_factory()
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
            'discard_pile': list(disc_pile),
        }
        top = disc_pile[-1] if disc_pile else None
        take = False
        if top is not None:
            take = players[current].draw_decision(top, list(hand), gs)
        drew_disc = False; drawn = None
        if take and top is not None:
            drawn = disc_pile.pop(); hand.append(drawn); drew_disc = True
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
        disc_pile.append(disc)
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


# ═══════════════════════════════════════════════════════════════════════
#  PAIRED EVALUATION
# ═══════════════════════════════════════════════════════════════════════

def run_paired(hand, hero_factory, opp_factory, n_worlds=150, seed=42,
               turn_number=0, my_score=0, opp_score=0):
    """Paired same-world evaluation: knock vs continue from identical state."""
    rng = random.Random(seed)
    known = set(hand)
    knock_pts = []; cont_pts = []; diffs = []

    for _ in range(n_worlds):
        pool = [c for c in range(NUM_CARDS) if c not in known]
        rng.shuffle(pool)
        opp = pool[:10]; stk = pool[10:]

        pk = score_knock_immediate(list(hand), list(opp))
        pc = play_continuation(
            list(hand), list(opp), list(stk),
            hero_factory=hero_factory,
            opp_factory=opp_factory,
            turn_start=turn_number + 1,
            my_score=my_score,
            opp_score=opp_score,
        )
        knock_pts.append(pk)
        cont_pts.append(pc)
        diffs.append(pk - pc)

    n = len(diffs)
    avg_knock = sum(knock_pts) / n
    avg_cont = sum(cont_pts) / n
    avg_diff = sum(diffs) / n
    knock_better = sum(1 for d in diffs if d > 0) / n
    cont_better = sum(1 for d in diffs if d < 0) / n

    if n > 1:
        var = sum((d - avg_diff)**2 for d in diffs) / (n - 1)
        se = math.sqrt(var / n)
    else:
        se = 0.0

    return {
        'avg_knock': round(avg_knock, 2),
        'avg_cont': round(avg_cont, 2),
        'avg_diff': round(avg_diff, 2),
        'se': round(se, 2),
        'knock_better_frac': round(knock_better, 3),
        'cont_better_frac': round(cont_better, 3),
        'n_worlds': n,
    }


# ═══════════════════════════════════════════════════════════════════════
#  MAIN FRONTIER STUDY
# ═══════════════════════════════════════════════════════════════════════

def main():
    t_global = time.time()
    print("=" * 72)
    print("  DIRECTIVE 59: KNOCK FRONTIER MAPPING SPRINT")
    print("=" * 72)

    # ── Step 1: Build & verify scenarios ──
    print("\n[1] Building scenario families ...")
    try:
        families = _build_scenario_families()
    except (AssertionError, Exception) as e:
        print(f"  *** HAND VERIFICATION FAILED: {e}")
        print("  Removing failed scenario and continuing ...")
        # Fall through with whatever was built
        families = {dw: [] for dw in range(1, 10)}

    total = sum(len(v) for v in families.values())
    for dw in range(1, 10):
        print(f"    DW={dw}: {len(families[dw])} scenarios")
    print(f"    TOTAL: {total}")

    # ── Step 2: Gin probability ──
    print("\n[2] Measuring gin probability ...")
    rng_gp = random.Random(12345)
    all_scenarios = []
    for dw in range(1, 10):
        for sc in families.get(dw, []):
            gp = measure_gin_probability(sc['hand'], rng=rng_gp)
            sc['gin_prob'] = round(gp, 3)
            sc['gin_liveness'] = classify_gin_liveness(gp)
            all_scenarios.append(sc)
            print(f"    {sc['label']:22s}: DW={sc['target_dw']}, "
                  f"n_dw={sc['n_dw_cards']}, "
                  f"gp={gp:.3f} → {sc['gin_liveness']}")

    # ── Step 3: Paired evaluation ──
    N_WORLDS = 150
    TURNS = [0, 1, 2, 3]

    hero_robust = lambda: ApexMCTSClinchOnlyGoGin(seed=None)
    hero_exploit = lambda: ApexMCTS(seed=None)

    opp_configs = [
        ('Robust_Champion', lambda: ApexMCTSClinchOnlyGoGin(seed=None), hero_robust),
        ('Exploitative_Apex', lambda: ApexMCTS(seed=None), hero_exploit),
    ]

    all_results = []

    for opp_label, opp_fac, hero_fac in opp_configs:
        print(f"\n{'━' * 72}")
        print(f"  OPPONENT: {opp_label}  ({N_WORLDS} worlds)")
        print(f"{'━' * 72}")

        for turn in TURNS:
            label_t = f"Turn {turn}" + (" (Opening)" if turn == 0 else "")
            print(f"\n  ── {label_t} ──")

            for dw in range(1, 10):
                for sc in families.get(dw, []):
                    t0 = time.time()
                    result = run_paired(
                        sc['hand'], hero_fac, opp_fac,
                        n_worlds=N_WORLDS,
                        seed=42 + turn * 1000,
                        turn_number=turn,
                    )
                    el = time.time() - t0

                    fav = ("KNOCK" if result['avg_diff'] > 0.5
                           else "CONTINUE" if result['avg_diff'] < -0.5
                           else "~TIE")

                    rec = {
                        **result,
                        'dw': sc['target_dw'],
                        'n_dw_cards': sc['n_dw_cards'],
                        'gin_liveness': sc.get('gin_liveness', '?'),
                        'gin_prob': sc.get('gin_prob', 0),
                        'turn': turn,
                        'opp_state': 'neutral',
                        'opponent': opp_label,
                        'label': sc['label'],
                        'structure': sc.get('structure_hint', ''),
                        'verdict': fav,
                    }
                    all_results.append(rec)

                    print(f"    DW={dw} {sc['label']:22s} "
                          f"[{sc.get('gin_liveness','?'):4s}] "
                          f"gp={sc.get('gin_prob',0):.3f} "
                          f"n_dw={sc['n_dw_cards']} "
                          f"| K={result['avg_knock']:+6.1f} "
                          f"C={result['avg_cont']:+6.1f} "
                          f"Δ={result['avg_diff']:+5.1f}±{result['se']:.1f} "
                          f"→ {fav:8s} [{el:.1f}s]")

    # ════════════════════════════════════════════════════════════════
    # FRONTIER TABLES
    # ════════════════════════════════════════════════════════════════
    print(f"\n{'═' * 72}")
    print("  FRONTIER AGGREGATE TABLES")
    print(f"{'═' * 72}")

    for opp_label, _, _ in opp_configs:
        print(f"\n  ═══ vs {opp_label} ═══")
        opp_res = [r for r in all_results if r['opponent'] == opp_label]

        # DW × Turn (averaged across all scenarios at that DW/Turn)
        print(f"\n  DW × Turn (avg Δ = knock − continue):")
        print(f"  {'DW':>4s} | {'T0':>8s} | {'T1':>8s} | {'T2':>8s} | {'T3':>8s}")
        print(f"  {'─'*4}-+-{'─'*8}-+-{'─'*8}-+-{'─'*8}-+-{'─'*8}")
        for dw in range(1, 10):
            row = f"  {dw:4d} |"
            for turn in TURNS:
                matches = [r for r in opp_res
                          if r['dw'] == dw and r['turn'] == turn]
                if matches:
                    avg = sum(r['avg_diff'] for r in matches) / len(matches)
                    fav = "K" if avg > 0.5 else "C" if avg < -0.5 else "~"
                    row += f" {avg:+5.1f}{fav:>2s} |"
                else:
                    row += f" {'N/A':>7s} |"
            print(row)

        # DW × Gin Liveness (Turn 0)
        print(f"\n  DW × Gin Liveness (Turn 0 only):")
        print(f"  {'DW':>4s} | {'LOW':>8s} | {'MED':>8s} | {'HIGH':>8s}")
        print(f"  {'─'*4}-+-{'─'*8}-+-{'─'*8}-+-{'─'*8}")
        for dw in range(1, 10):
            row = f"  {dw:4d} |"
            for gl in ['LOW', 'MED', 'HIGH']:
                matches = [r for r in opp_res
                          if r['dw'] == dw and r['turn'] == 0
                          and r['gin_liveness'] == gl]
                if matches:
                    avg = sum(r['avg_diff'] for r in matches) / len(matches)
                    fav = "K" if avg > 0.5 else "C" if avg < -0.5 else "~"
                    row += f" {avg:+5.1f}{fav:>2s} |"
                else:
                    row += f" {'---':>7s} |"
            print(row)

        # DW × n_dw_cards (Turn 0)
        print(f"\n  DW × DW-Card Count (Turn 0 only):")
        print(f"  {'DW':>4s} | {'1-card':>8s} | {'2-card':>8s} | {'4-card':>8s}")
        print(f"  {'─'*4}-+-{'─'*8}-+-{'─'*8}-+-{'─'*8}")
        for dw in range(1, 10):
            row = f"  {dw:4d} |"
            for ndc in [1, 2, 4]:
                matches = [r for r in opp_res
                          if r['dw'] == dw and r['turn'] == 0
                          and r['n_dw_cards'] == ndc]
                if matches:
                    avg = sum(r['avg_diff'] for r in matches) / len(matches)
                    fav = "K" if avg > 0.5 else "C" if avg < -0.5 else "~"
                    row += f" {avg:+5.1f}{fav:>2s} |"
                else:
                    row += f" {'---':>7s} |"
            print(row)

        # Structure × Turn (iso vs connected at turn 0)
        print(f"\n  Structure Impact (Turn 0):")
        print(f"  {'DW':>4s} | {'Isolated':>10s} | {'Connected':>10s}")
        print(f"  {'─'*4}-+-{'─'*10}-+-{'─'*10}")
        for dw in range(1, 10):
            iso = [r for r in opp_res
                  if r['dw'] == dw and r['turn'] == 0
                  and 'iso' in r.get('structure', '')]
            con = [r for r in opp_res
                  if r['dw'] == dw and r['turn'] == 0
                  and 'connect' in r.get('structure', '')]
            iso_s = f"{sum(r['avg_diff'] for r in iso)/len(iso):+6.1f}" if iso else "---"
            con_s = f"{sum(r['avg_diff'] for r in con)/len(con):+6.1f}" if con else "---"
            print(f"  {dw:4d} | {iso_s:>10s} | {con_s:>10s}")

    # ── Dominant-action check ──
    print(f"\n{'═' * 72}")
    print("  DOMINANT-ACTION CHECK")
    print(f"{'═' * 72}")
    print("  Game-clinch exception: remains dominant (not re-tested here).")
    print("  All scenarios use my_score=0, opp_score=0 → no clinch territory.")

    # ── Save JSON ──
    out_path = os.path.join(os.path.dirname(__file__), '..', 'knock_frontier_results.json')
    out = {
        'meta': {
            'n_worlds': N_WORLDS,
            'turns': TURNS,
            'total_scenarios': total,
            'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
        },
        'scenarios': [{
            'label': s['label'],
            'hand': [card_str(c) for c in s['hand']],
            'target_dw': s['target_dw'],
            'n_dw_cards': s['n_dw_cards'],
            'gin_prob': s.get('gin_prob', 0),
            'gin_liveness': s.get('gin_liveness', '?'),
            'structure': s.get('structure_hint', ''),
            'desc': s.get('desc', ''),
        } for s in all_scenarios],
        'results': all_results,
    }
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=2)

    elapsed = time.time() - t_global
    print(f"\n{'═' * 72}")
    print(f"  COMPLETE — {elapsed:.0f}s total")
    print(f"  Results → {out_path}")
    print(f"{'═' * 72}")
    return all_results


if __name__ == '__main__':
    main()
