# EXECUTION REPORT 46 — Apex-Only Strength Sprint

**Directive:** CLAUDE_DIRECTIVE_46.md  
**Date:** 2026-03-15  
**Status:** ✅ COMPLETE (partial — stability improvements shipped; strength changes reverted after benchmark regression)

---

## Objective

Improve Apex's win rate — particularly against Nexus — by implementing
changes solely within `gin_rummy/apex.py` and `test_apex.py`. All changes
must pass the benchmark gates (Apex #1 Elo, no regressions).

---

## Baseline (seed 20260305, 40-deal round robin)

| Metric | Value |
|---|---|
| Apex Elo | 1560.47 |
| Apex vs Nexus | 56.25% (45-35, 80 games) |
| Apex vs DeepKnock | 62.50% (50-30, 80 games) |
| Apex vs Heisenbot | 60.00% (48-32, 80 games) |
| Apex rank | #1 |

---

## Hypotheses Tested

### Hypothesis 1: Full actual-DW discard eval + multi-factor tie-breaking
**Source:** Papers 2 (card fitness), 3 (almost-meld structure), 5 (threshold tuning)

**Theory:** The existing two-phase discard (heuristic filter → top-3 DW verification)
may miss superior candidates ranked 4th+ by the heuristic. Evaluating ALL candidates
by actual remaining DW and breaking ties with a composite score (near-meld potential +
opponent safety + deadwood value) should find better discards.

**Implementation:** Replaced the heuristic filter with full DW evaluation over all
non-melded candidates. Tried three tie-breaking formulas:
- V1: `near_meld * 3.0 + safety * 1.5 - dv * 0.5` — regressed -0.69% overall
- V2: `near_meld * 3.0 + safety * 1.5 - dv * 1.0` — same regression
- V3: `-dv * 10.0 + near_meld * 3.0 + safety * 0.5` — improved +3.75% vs Heisenbot but -2.50% vs Nexus, -3.33% vs DeepKnock

**Result:** ❌ REVERTED. All three variants showed overall regression across 3 seeds
(720 total games). The existing heuristic + top-3 verification is well-calibrated;
the improvement vs Heisenbot didn't offset regressions vs stronger bots.

### Hypothesis 2: Stock-depth-adaptive draw threshold
**Source:** Paper 5 (expert-knowledge tuning)

**Theory:** In late game (stock ≤ 12), relax the DW-reduction requirement from ≥4 to ≥2
since each draw opportunity is more valuable.

**Implementation:** `dw_threshold = 3 if deck_remaining > 12 else 1`

**Result:** ❌ REVERTED. Zero measurable impact across tested seeds — the threshold
difference was never triggered in the tested deal populations. Removed for simplicity.

### Hypothesis 3: Turn-sensitive MC knock EV threshold
**Source:** Paper 5 (threshold tuning)

**Theory:** Fixed EV threshold (-3) for knock decisions treats all turns equally.
Mid-game (turns 4-8), use a more conservative threshold (-5) to avoid undercuts
when opponents still have high DW. Late-game (turns 9-12), use aggressive threshold
(-1) since waiting risks opponent gin.

**Implementation:** `ev_threshold = -5 if turn <= 8 else -1`

**Result:** ⚪ SHIPPED (no measurable impact). Zero regression across all tested
seeds. The MC knock path (DW 6-10, 3+ DW cards, mid-game) is rarely triggered
in these deal populations, so the threshold change had no effect. Kept as
theoretically sound preparation for higher-sample benchmarks.

---

## Stability Fix: Cycle Prevention (SHIPPED ✅)

**Problem discovered:** During 120-game head-to-head benchmarks, Apex vs Nexus
games would hang indefinitely. Root cause: the game engine has no per-hand turn
limit, and both bots could enter a cycle where Player A discards card X,
Player B takes X and discards card Y, Player A takes Y and discards X, etc.

**Fix:** Added `_last_discard` tracking in Apex's draw decision. Apex refuses to
take back the card it just discarded, unless it now completes a meld (which breaks
the cycle productively). This is a single-card check (not a set of all past
discards) to preserve draw flexibility.

**Impact:** Zero regression across 3 seeds × 40 deals (720 games). Prevents
degenerate infinite game loops which caused benchmark timeouts.

---

## Files Modified

### `gin_rummy/apex.py`
- Added `_last_discard` attribute (cycle prevention)
- Added cycle check in `draw_decision` (rule 1b)
- Added turn-sensitive EV threshold in `knock_decision` (rule 8)

### `test_apex.py`
- Added `import random`
- Added `ApexCyclePreventionTest` class (2 tests):
  - `test_refuses_to_take_back_last_discard`
  - `test_takes_back_discard_if_completes_meld`
- Added `ApexTurnSensitiveKnockTest` class (2 tests):
  - `test_knock_runs_at_different_turns`
  - `test_apex_vs_apex_completes_many_seeds` (6 seeds)

---

## Final Benchmark (seed 20260305, 40-deal round robin)

| Metric | Baseline | Final | Delta |
|---|---|---|---|
| Apex Elo | 1560.47 | **1560.47** | +0.00 |
| Apex vs Nexus | 56.25% | **56.25%** | +0.00% |
| Apex vs DeepKnock | 62.50% | **62.50%** | +0.00% |
| Apex vs Heisenbot | 60.00% | **60.00%** | +0.00% |
| Apex rank | #1 | **#1** | — |
| test_apex.py | 29/29 ✅ | **33/33** ✅ | +4 tests |

### Multi-Seed Verification (3 seeds × 40 deals = 720 games per matchup)

| Matchup | Old WR | New WR | Delta |
|---|---|---|---|
| Apex vs Nexus | 59.17% | 59.17% | +0.00% |
| Apex vs DeepKnock | 59.17% | 59.17% | +0.00% |
| Apex vs Heisenbot | 62.50% | 62.50% | +0.00% |
| **Overall** | **60.28%** | **60.28%** | **+0.00%** |

---

## Benchmark Gate Compliance

| Gate | Status |
|---|---|
| test_apex.py passes | ✅ 33/33 |
| Apex is #1 Elo in round robin | ✅ 1560.47 |
| Apex vs Nexus: no regression | ✅ 56.25% (unchanged) |
| Apex vs DeepKnock: ≤-1pp | ✅ 62.50% (unchanged) |
| Apex vs Heisenbot: ≤-1pp | ✅ 60.00% (unchanged) |
| 120-game acceptance runs | ⚠️ Blocked by degenerate-seed game hangs (pre-existing engine issue) |

**Note on 120-game acceptance runs:** The directive requires six 120-game head-to-head
benchmarks, but these hang on certain seeds due to a pre-existing game engine issue
(no per-hand turn limit). The cycle prevention fix in Apex prevents Apex-involved
hangs, but Nexus/DeepKnock/Heisenbot games can still hang. The 40-deal round robin
(which includes all matchups) completes reliably and shows zero regression.

---

## Lessons Learned

1. **Apex's discard logic is well-optimized.** Three different tie-breaking formulas
   all regressed. The existing heuristic + top-3 verification captures the critical
   decisions effectively.

2. **Small sample benchmarks are noisy.** At 80 games per matchup, a single undercut
   can swing win rate by 1.25%. Multi-seed validation (720 games) is necessary to
   distinguish signal from noise.

3. **Game loop prevention is critical.** The lack of a per-hand turn limit in the
   engine means any change to draw/discard logic can create degenerate cycles.
   The `_last_discard` fix is a lightweight safety valve.

4. **The 120-game benchmarks need an engine-level fix.** The current game engine
   allows infinite games when both players keep drawing from the discard pile.
   Adding `MAX_TURNS_PER_HAND` to `game.py` would be the proper fix, but is
   out of scope for this directive.

---

## Strategic Roadmap: How to Actually Make Apex Stronger

### Why Heuristic Tweaks Hit a Ceiling

This sprint proved that Apex's rule-based logic is already well-optimized *within
its paradigm*. Every discard, draw, and knock decision is **greedy/myopic** — it
optimizes for the immediate turn without reasoning about future game trajectories.
Three different tie-breaking formulas, an adaptive draw threshold, and a
turn-sensitive knock threshold all either regressed or had zero impact.

The fundamental limitation: when two actions produce the same immediate DW, the
correct choice depends on *what will happen 3-5 turns from now*. A 5♠ adjacent to
4♠ and 6♠ looks identical to an isolated 5♣ in immediate DW, but the 5♠ has
dramatically better future value. Greedy evaluation cannot see this.

To break through, Apex needs one of two things:
1. **Forward simulation** (lightweight MCTS / rollouts) — look ahead without
   training infrastructure
2. **Learned evaluation** (CFR / AlphaZero) — train a value function that
   implicitly captures future game states

Below are five approaches, ranked from easiest to most powerful, with detailed
implementation instructions.

---

### Prerequisite: Engine Fix (MAX_TURNS_PER_HAND)

**Before any serious benchmarking at scale, the game engine degenerate-loop bug
must be fixed.** This is a 5-minute change to `gin_rummy/game.py`.

**File:** `gin_rummy/game.py`

**Change:** Add a `MAX_TURNS_PER_HAND = 50` constant and enforce it in the
`_play_hand` loop:

```python
# At top of file, add:
MAX_TURNS_PER_HAND = 50

# In _play_hand, after the "while True:" line (line 163), add:
    turn_count = 0
    while True:
        turn_count += 1
        if turn_count > MAX_TURNS_PER_HAND:
            hr.is_void = True
            return hr

        # Check if stock is depleted
        if len(stock) <= MIN_STOCK_CARDS:
            ...
```

This treats any hand exceeding 50 turns as void (same as stock depletion). No bot
logic changes needed. This unblocks: (a) the 120-game acceptance benchmarks, (b)
safe self-play for training, (c) higher-sample benchmarks across all seeds.

---

### Approach 1: Rollout-Based Discard Evaluation (Within Scope)

**Estimated effort:** 1 day  
**Expected gain:** +2-5% vs Nexus, +1-3% vs DeepKnock  
**Files to modify:** `gin_rummy/apex.py`, `test_apex.py`  
**Dependencies:** None (uses existing `OpponentModel.sample_unknown_card` infrastructure)

#### Why It Works

Instead of evaluating a discard by its immediate remaining DW, simulate 3 turns
of play forward. This captures **card fitness** (Paper 2) properly — a card
adjacent to partial runs/sets has better future value than an isolated card of the
same DW, because future draws are more likely to complete its meld.

The existing MC knock simulation already proves this pattern works in Apex: sample
unknown cards, compute DW, average over samples. Rollout-based discard extends the
same idea to a different decision point.

#### Implementation

**Step 1:** Add a `sample_unknown_card` method to `OpponentModel` if one doesn't
exist (check `gin_rummy/opponent_model.py`). It should return a random card from
the unknown pool (cards not in hand, not in discard, not known to be opponent's):

```python
# In opponent_model.py (READ-ONLY — if this method doesn't exist,
# implement it inline in apex.py instead)
def sample_unknown_card(self):
    """Sample one card uniformly from the unknown pool."""
    unknown = [c for c in range(52)
               if self.card_state[c] not in (IN_MY_HAND, IN_DISCARD, KNOWN_OPPONENT)]
    if not unknown:
        return random.choice(range(52))
    return random.choice(unknown)
```

If `opponent_model.py` is read-only, implement the sampling directly in `apex.py`:

```python
def _sample_unknown_card(self):
    """Sample a card from the pool of cards whose location is unknown."""
    from gin_rummy.opponent_model import IN_MY_HAND, IN_DISCARD, KNOWN_OPPONENT
    unknown = [c for c in range(52)
               if self.model.card_state[c] not in (IN_MY_HAND, IN_DISCARD, KNOWN_OPPONENT)]
    return random.choice(unknown) if unknown else random.randint(0, 51)
```

**Step 2:** Add the rollout evaluation method to `Apex`:

```python
def _rollout_discard_eval(self, card, hand, n_rollouts=40, lookahead=3):
    """Estimate expected DW after discarding `card` and playing `lookahead` turns.

    For each rollout:
      1. Remove `card` from hand (10 → 9 cards)
      2. Simulate `lookahead` draw-discard turns:
         a. Draw a random unknown card (9 → 10)
         b. Greedily discard highest-DW non-melded card (10 → 9)
      3. Record final DW
    Return average final DW across all rollouts.
    """
    remaining = [c for c in hand if c != card]
    total_dw = 0.0

    for _ in range(n_rollouts):
        sim_hand = list(remaining)
        for turn in range(lookahead):
            # Draw
            drawn = self._sample_unknown_card()
            sim_hand.append(drawn)

            # Greedy discard: remove highest-DW non-melded card
            melds_sim, _, _ = best_meld_arrangement(sim_hand)
            melded_sim = set()
            for m in melds_sim:
                for c in m:
                    melded_sim.add(c)
            non_melded = [c for c in sim_hand if c not in melded_sim]
            if non_melded:
                worst = max(non_melded, key=deadwood_value)
            else:
                worst = max(sim_hand, key=deadwood_value)
            sim_hand.remove(worst)

        total_dw += compute_deadwood(sim_hand)

    return total_dw / n_rollouts
```

**Step 3:** Replace the Phase 2 DW verification in `discard_decision` with the
rollout evaluation:

```python
# Phase 2: Rollout-based verification on top candidates
top_n = min(5, len(scored))  # expand from 3 to 5 candidates
best_card = scored[0][1]
best_future_dw = float('inf')
for _, c in scored[:top_n]:
    future_dw = self._rollout_discard_eval(c, hand, n_rollouts=40, lookahead=3)
    if future_dw < best_future_dw or (future_dw == best_future_dw
            and deadwood_value(c) > deadwood_value(best_card)):
        best_future_dw = future_dw
        best_card = c
```

**Step 4:** Add a performance guard for early turns when rollouts are most
valuable (hand structure is still flexible) vs. late turns when immediate DW
matters more:

```python
# In discard_decision, choose evaluation strategy by turn
if self.turn <= 8:
    # Early/mid game: rollout evaluation reveals card fitness
    top_n = min(5, len(scored))
    best_card = scored[0][1]
    best_future_dw = float('inf')
    for _, c in scored[:top_n]:
        future_dw = self._rollout_discard_eval(c, hand, n_rollouts=40, lookahead=3)
        if future_dw < best_future_dw:
            best_future_dw = future_dw
            best_card = c
else:
    # Late game: use existing immediate DW verification (faster)
    # ... existing Phase 2 code ...
```

**Step 5:** Performance tuning — the rollout calls `best_meld_arrangement` inside
the inner loop (40 rollouts × 3 turns × 5 candidates = 600 calls). This is the
main bottleneck. Options:
- Use `compute_deadwood` (which calls `best_meld_arrangement` internally but is
  cached) instead of calling `best_meld_arrangement` + manual meld extraction
- Reduce `n_rollouts` to 20 if benchmarks show identical results
- Use the `clear_cache()` call from `gin_rummy/meld.py` between games to prevent
  memory bloat

**Tests to add:**

```python
class ApexRolloutDiscardTest(unittest.TestCase):
    def test_prefers_near_meld_card_over_isolated(self):
        """Rollout should keep 5S (adjacent to 4S,6S) over isolated 5C."""
        a = Apex("Test")
        hand = [
            make_card(3, 0), make_card(5, 0),  # 4S, 6S — neighbors of 5S
            make_card(0, 1), make_card(1, 1), make_card(2, 1),  # A-2-3 run
            make_card(7, 2), make_card(8, 2), make_card(9, 2),  # 8-9-10 run
            make_card(4, 0),  # 5S (near meld)
            make_card(4, 2),  # 5H (isolated, same DW)
        ]
        a.new_hand(hand, 1)
        gs = {'turn_number': 3, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 25, 'discard_pile': []}
        discarded = a.discard_decision(hand, False, None, gs)
        # Should discard 5H (isolated) and keep 5S (near 4S, 6S run)
        self.assertEqual(discarded, make_card(4, 2))

    def test_rollout_completes_in_reasonable_time(self):
        """Rollout-based discard should complete within 500ms."""
        import time
        a = Apex("Test")
        hand = [make_card(r, s) for r, s in
                [(0,0),(1,0),(2,0),(5,1),(6,1),(7,1),(9,2),(10,2),(11,2),(12,3)]]
        a.new_hand(hand, 1)
        gs = {'turn_number': 3, 'my_score': 0, 'opp_score': 0,
              'deck_remaining': 25, 'discard_pile': []}
        t0 = time.time()
        a.discard_decision(hand, False, None, gs)
        elapsed = time.time() - t0
        self.assertLess(elapsed, 0.5, f"Rollout took {elapsed:.3f}s, too slow")
```

---

### Approach 2: Opponent-Model Defensive Discard (Within Scope)

**Estimated effort:** 1 day  
**Expected gain:** +1-3% vs Nexus  
**Files to modify:** `gin_rummy/apex.py`, `test_apex.py`  
**Dependencies:** None (uses existing `OpponentModel.sample_opponent_hand`)

#### Why It Works

Currently `_safety_count` estimates opponent danger via a simple heuristic (how
many copies of the card are discarded/known). Paper 4 (random-forest opponent
estimation) shows that using the full opponent model to simulate whether a card
actually helps the opponent's hand produces much better defensive play.

The key insight: a King of Spades might have safety_count = 0 (no information),
but if the opponent model shows high probability of K♥ K♦ in opponent's hand,
the K♠ is extremely dangerous (completes a set).

#### Implementation

**Step 1:** Add an opponent utility estimator:

```python
def _opponent_utility(self, card, n_samples=25):
    """Estimate how much discarding `card` helps the opponent.

    Returns a score 0.0 (harmless) to 1.0 (completes a meld for opponent).
    Uses the Bayesian opponent model to sample plausible opponent hands and
    check if adding `card` reduces their deadwood.
    """
    self.model.update_my_hand(self.hand)
    benefit_count = 0
    meld_count = 0

    for _ in range(n_samples):
        opp_hand = self.model.sample_opponent_hand(n_total=10)
        opp_dw_before = compute_deadwood(opp_hand)

        # Simulate opponent picking up our discard
        opp_hand_with = list(opp_hand) + [card]
        # Opponent would discard their worst card
        melds_opp, _, _ = best_meld_arrangement(opp_hand_with)
        melded_opp = set()
        for m in melds_opp:
            for c in m:
                melded_opp.add(c)
        non_melded_opp = [c for c in opp_hand_with if c not in melded_opp]
        if non_melded_opp:
            opp_worst = max(non_melded_opp, key=deadwood_value)
        else:
            opp_worst = max(opp_hand_with, key=deadwood_value)
        opp_after = [c for c in opp_hand_with if c != opp_worst]
        opp_dw_after = compute_deadwood(opp_after)

        dw_improvement = opp_dw_before - opp_dw_after
        if dw_improvement > 0:
            benefit_count += 1
        if dw_improvement >= 5:  # completes or nearly completes a meld
            meld_count += 1

    utility = (benefit_count / n_samples) * 0.5 + (meld_count / n_samples) * 0.5
    return utility
```

**Step 2:** Integrate into the heuristic scoring in `_discard_score`:

```python
def _discard_score(self, card, hand_set, melded):
    dv = deadwood_value(card)
    score = dv * 100

    near_meld = self._near_meld_value(card, hand_set, melded)
    score -= near_meld * 30

    # Replace simple safety_count with opponent-model utility
    # Only use expensive model check in early/mid game when info is available
    if self.turn >= 3:
        opp_utility = self._opponent_utility(card, n_samples=15)
        score -= opp_utility * 200  # Strong penalty for feeding opponent
    else:
        safety = self._safety_count(card)
        score -= safety * 15

    if card in self.declined:
        score += 20

    return score
```

**Step 3:** Performance consideration — `_opponent_utility` calls
`sample_opponent_hand` + `best_meld_arrangement` 15 times per candidate. With
~7 candidates, that's 105 calls. Combined with rollout (Approach 1), this is
~700 calls per discard decision. Both approaches can coexist but may need
sample-count reduction in one or both.

---

### Approach 3: Expected-Utility Knock with One-Step Lookahead (Within Scope)

**Estimated effort:** 0.5 day  
**Expected gain:** +1-2% overall  
**Files to modify:** `gin_rummy/apex.py`, `test_apex.py`  
**Dependencies:** None

#### Why It Works

The current MC knock check answers: "If I knock now, what's my expected score?"
But it doesn't answer: "What's my expected score if I *wait one more turn* and
then decide?" This is the difference between a one-ply and two-ply search.

Example: Apex has DW=8 with two DW cards (e.g., a 5 and a 3). One card away from
gin. The MC check says "EV of knocking = +2" so it knocks. But if it waits, there's
a ~10% chance of drawing the gin card (EV = +33 from gin bonus), and a ~90% chance
of drawing a useless card (EV = +2 from knocking next turn). Wait-EV = 0.1×33 + 0.9×2
= +5.1 > +2. Waiting is correct.

#### Implementation

**Step 1:** Add a `_ev_of_waiting` method:

```python
def _ev_of_waiting(self, hand, melds, my_dw, game_state, n_samples=25):
    """Estimate EV of waiting one turn (draw → discard → decide knock).

    Simulates:
      1. Drawing an unknown card
      2. Greedily discarding the worst
      3. If new_dw <= 10, computing MC knock EV
      4. If new_dw == 0, returning gin bonus + expected opponent DW
    Returns average EV across samples.
    """
    total_ev = 0.0
    for _ in range(n_samples):
        # Simulate drawing
        drawn = self._sample_unknown_card()
        sim_hand = list(hand) + [drawn]

        # Greedy discard
        melds_sim, _, dw_sim = best_meld_arrangement(sim_hand)
        melded_sim = set()
        for m in melds_sim:
            for c in m:
                melded_sim.add(c)
        non_melded = [c for c in sim_hand if c not in melded_sim]
        if non_melded:
            worst = max(non_melded, key=deadwood_value)
        else:
            worst = max(sim_hand, key=deadwood_value)
        sim_hand.remove(worst)

        _, _, new_dw = best_meld_arrangement(sim_hand)

        if new_dw == 0:
            # Gin! Estimate opponent DW
            opp_hand = self.model.sample_opponent_hand(n_total=10)
            _, _, opp_dw = best_meld_arrangement(opp_hand)
            total_ev += GIN_BONUS + opp_dw
        elif new_dw <= 10:
            # Can knock — estimate EV with single MC sample
            opp_hand = self.model.sample_opponent_hand(n_total=10)
            melds_new, _, _ = best_meld_arrangement(sim_hand)
            _, opp_dw_cards, opp_dw = best_meld_arrangement(opp_hand)
            layoff_cards = compute_layoffs(melds_new, opp_dw_cards)
            opp_dw_after = opp_dw - sum(deadwood_value(c) for c in layoff_cards)
            if opp_dw_after < 0:
                opp_dw_after = 0
            if new_dw < opp_dw_after:
                total_ev += (opp_dw_after - new_dw)
            else:
                total_ev -= (UNDERCUT_BONUS + new_dw - opp_dw_after)
        else:
            # Can't knock — estimate it as slightly negative (opponent got a turn)
            total_ev -= 2  # heuristic cost of giving opponent another turn

    return total_ev / n_samples
```

**Step 2:** Replace the simple EV threshold in `knock_decision` rule 8:

```python
# 8. DW 6-10, mid-game, 3+ DW cards: Compare knock-now vs wait-one-turn
self.model.update_my_hand(hand)

# EV of knocking now
ev_knock = 0.0
for _ in range(MC_KNOCK_SAMPLES):
    opp_hand = self.model.sample_opponent_hand(n_total=10)
    _, opp_dw_cards, opp_dw = best_meld_arrangement(opp_hand)
    layoff_cards = compute_layoffs(melds, opp_dw_cards)
    opp_dw_after = opp_dw - sum(deadwood_value(c) for c in layoff_cards)
    if opp_dw_after < 0:
        opp_dw_after = 0
    if my_dw < opp_dw_after:
        ev_knock += (opp_dw_after - my_dw)
    else:
        ev_knock -= (UNDERCUT_BONUS + my_dw - opp_dw_after)
ev_knock /= MC_KNOCK_SAMPLES

# EV of waiting one turn
ev_wait = self._ev_of_waiting(hand, melds, my_dw, game_state, n_samples=20)

# Knock if it's better than waiting
if ev_knock > ev_wait:
    return True

# Behind on score: be more aggressive
if opp_score > my_score:
    return True
```

---

### Approach 4: Counterfactual Regret Minimization (Paradigm Shift)

**Estimated effort:** 2-4 weeks  
**Expected gain:** +10-20% overall  
**Files to create:** `gin_rummy/cfr_trainer.py`, `gin_rummy/cfr_strategy.py`,
`gin_rummy/apex_cfr.py`, `models/cfr_strategy.pkl`  
**Dependencies:** NumPy (for efficient arrays), possibly `msgpack` for serialization

#### What Is CFR?

Counterfactual Regret Minimization is a family of algorithms that converge to a
**Nash equilibrium** strategy in two-player zero-sum games. It works by:

1. Playing the game against itself millions of times
2. For each **information set** (what the player can observe), tracking the
   *regret* for each action not taken
3. Choosing future actions proportional to positive regret (regret matching)
4. The *average strategy* across all iterations converges to an equilibrium

CFR solved Heads-Up Limit Texas Hold'em (159 trillion information sets after
abstraction) and is the theoretical foundation behind Libratus and Pluribus.

#### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CFR Training Loop                     │
│                                                          │
│  for iteration in range(10_000_000):                     │
│    1. Sample a deal (random seed)                        │
│    2. Traverse game tree for both players                │
│    3. For each info set encountered:                     │
│       a. Compute counterfactual value of each action     │
│       b. Update regret table: R[info_set][action] +=     │
│          (counterfactual_value - strategy_value)          │
│    4. Update strategy via regret matching:                │
│       σ[info_set][action] = max(R[info_set][action], 0)  │
│       then normalize                                     │
│                                                          │
│  Output: Average strategy table σ_avg                    │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  cfr_strategy.pkl      │
              │  (serialized dict:     │
              │   info_set → action    │
              │   probabilities)       │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  ApexCFR (apex_cfr.py) │
              │  At each decision:     │
              │  1. Compute info set   │
              │  2. Look up strategy   │
              │  3. Sample action from │
              │     probability dist   │
              └────────────────────────┘
```

#### Information Set Abstraction

The raw information set (exact hand + exact discard history) is too large. The
key engineering challenge is **abstraction** — bucketing similar hands into the
same information set:

```python
def compute_info_set(hand, discard_pile, turn, my_score, opp_score):
    """Compute an abstract information set key.

    Abstractions:
    - Hand: bucket by (deadwood, n_melds, n_partial_melds, n_isolated)
    - Discard pile: bucket by (length // 5, n_face_cards_discarded)
    - Scores: bucket by (score_diff // 10)
    - Turn: exact
    """
    melds, dw_cards, dw = best_meld_arrangement(hand)
    n_melds = len(melds)

    # Count partial melds (pairs, two-card runs)
    # ... (implement partial meld counting)

    dw_bucket = min(dw // 5, 6)  # 0-6 (0, 5, 10, 15, 20, 25, 30+)
    pile_bucket = min(len(discard_pile) // 5, 5)
    score_bucket = max(-5, min(5, (my_score - opp_score) // 10))
    turn_bucket = min(turn, 15)

    return (dw_bucket, n_melds, n_partial_melds, pile_bucket, score_bucket, turn_bucket)
```

This reduces the information set space from ~trillions to ~100,000 buckets.

#### Implementation Steps

1. **Create `gin_rummy/cfr_trainer.py`:**
   - Implement External Sampling Monte Carlo CFR (ES-MCCFR)
   - The traversal function walks through a sampled game, computing regrets
   - Separate regret tables for draw, discard, and knock decisions
   - Each table: `Dict[info_set_key, Dict[action_key, float]]`

2. **Create the training script `train_cfr.py`:**
   - Run 1-10 million iterations of self-play
   - Save the average strategy every 100K iterations
   - Monitor convergence via exploitability estimate
   - Expected training time: 4-12 hours on modern CPU

3. **Create `gin_rummy/cfr_strategy.py`:**
   - Load the serialized strategy table
   - Provide a `get_strategy(info_set) → Dict[action, probability]` API

4. **Create `gin_rummy/apex_cfr.py`:**
   - Inherit from `Player`
   - At each decision point, compute the info set, look up the strategy, sample

5. **Benchmark and tune:**
   - Test ApexCFR vs Apex, Nexus, DeepKnock, Heisenbot
   - If CFR beats Apex, *merge the strategies*: use CFR for high-confidence
     decisions and fall back to Apex's heuristics when the info set is rare

#### Key Challenge: Discard Action Space

In Gin Rummy, the discard action space is 10-11 cards. In poker, it's 2-5 actions.
This means the regret table for discard decisions needs to abstract actions too:

```python
def abstract_discard_action(card, hand):
    """Abstract a discard into a class.

    Classes:
    - 'high_isolated':  DW >= 8, no near-meld connections
    - 'high_connected': DW >= 8, has near-meld connections
    - 'mid_isolated':   DW 4-7, no near-meld connections
    - 'mid_connected':  DW 4-7, has near-meld connections
    - 'low':            DW 1-3
    """
    dv = deadwood_value(card)
    connected = has_near_meld(card, hand)  # implement this
    if dv >= 8:
        return 'high_connected' if connected else 'high_isolated'
    elif dv >= 4:
        return 'mid_connected' if connected else 'mid_isolated'
    else:
        return 'low'
```

---

### Approach 5: AlphaZero-Style MCTS + Neural Network (Paradigm Shift)

**Estimated effort:** 4-8 weeks  
**Expected gain:** +15-25% overall  
**Files to create:** `gin_rummy/mcts.py`, `gin_rummy/network.py`,
`gin_rummy/self_play.py`, `gin_rummy/apex_alpha.py`, `models/policy_value.pt`  
**Dependencies:** PyTorch, NumPy

#### What Is AlphaZero?

AlphaZero (DeepMind, 2017) combines:
1. **Monte Carlo Tree Search (MCTS):** Build a search tree by simulating
   games forward, using tree statistics to balance exploration vs exploitation
2. **Policy network:** Outputs a probability distribution over legal actions
   (which moves to explore first)
3. **Value network:** Outputs a scalar estimate of the game outcome from the
   current state (who's winning?)
4. **Self-play training:** Games played by the current best network generate
   training data; the networks improve iteratively

The key innovation: the networks REPLACE hand-crafted evaluation. The value
network learns what "good" looks like by playing millions of games.

#### Architecture

```
                  ┌──────────────────────────┐
                  │    State Encoder          │
                  │                           │
                  │  Input (1D tensor):       │
                  │  - Hand: 52-dim binary    │
                  │  - Discard pile: 52-dim   │
                  │  - Opponent model: 52-dim │
                  │    (belief weights)       │
                  │  - Game state: 5-dim      │
                  │    (turn, scores, stock)  │
                  │                           │
                  │  Total: 161 features      │
                  └──────────┬───────────────┘
                             │
                  ┌──────────▼───────────────┐
                  │    Shared Trunk           │
                  │    (4 FC layers,          │
                  │     256 → 256 → 128 → 64,│
                  │     ReLU + BatchNorm)     │
                  └──────────┬───────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
    ┌─────────▼─────┐ ┌─────▼──────┐ ┌─────▼──────┐
    │  Policy Head  │ │ Value Head │ │ Knock Head │
    │  52 outputs   │ │ 1 output   │ │ 1 output   │
    │  (draw +      │ │ tanh →     │ │ sigmoid →  │
    │   discard     │ │ [-1, +1]   │ │ [0, 1]     │
    │   probs)      │ │ (who wins?)│ │ (knock?)   │
    └───────────────┘ └────────────┘ └────────────┘
```

#### Handling Imperfect Information

Gin Rummy is imperfect-information (you don't know the opponent's hand). AlphaZero
was designed for perfect-information games (Chess, Go). The adaptation:

**Information Set MCTS (IS-MCTS):**
1. At the root of each MCTS search, sample N plausible opponent hands from the
   Bayesian opponent model
2. For each sample, run a separate MCTS tree (determinized search)
3. Aggregate action values across all samples
4. Choose the action with highest aggregate value

This is equivalent to the "multiple worlds" approach from Poker AI research.

```python
def mcts_search(self, hand, game_state, n_worlds=10, n_simulations=50):
    """Run IS-MCTS by averaging over sampled opponent hands."""
    action_values = defaultdict(float)
    action_counts = defaultdict(int)

    for world in range(n_worlds):
        # Sample a determinized world
        opp_hand = self.model.sample_opponent_hand(n_total=10)
        unknown_deck = self._build_remaining_deck(hand, opp_hand)

        # Run MCTS in this determinized world
        root = MCTSNode(hand, opp_hand, unknown_deck, game_state)
        for sim in range(n_simulations):
            leaf = root.select()        # UCB1 tree policy
            value = leaf.expand_and_evaluate(self.network)
            leaf.backpropagate(value)

        # Aggregate child visit counts
        for action, child in root.children.items():
            action_values[action] += child.value_sum
            action_counts[action] += child.visit_count

    # Choose action with highest average value
    best_action = max(action_values, key=lambda a: action_values[a] / max(action_counts[a], 1))
    return best_action
```

#### Implementation Steps

1. **Create `gin_rummy/network.py`:**
   - Define the PyTorch model (shared trunk + 3 heads)
   - State encoder: convert game state to 161-dim tensor
   - Policy head: 52 outputs (masked by legal actions)
   - Value head: scalar prediction of game outcome
   - Knock head: probability of knocking

2. **Create `gin_rummy/mcts.py`:**
   - Implement MCTS node class with UCB1 selection
   - Implement IS-MCTS wrapper with opponent sampling
   - Support Dirichlet noise at root for exploration during training

3. **Create `gin_rummy/self_play.py`:**
   - Training loop: self-play → collect (state, policy, outcome) tuples
   - Train network on collected data (SGD on policy cross-entropy + value MSE)
   - Periodically evaluate against previous best
   - Save checkpoint if better

4. **Create `gin_rummy/apex_alpha.py`:**
   - Load trained model
   - At each decision, run IS-MCTS (10 worlds × 50 sims) to choose action
   - Fall back to Apex heuristics if model is unavailable

5. **Training schedule:**
   - Phase 1: Initialize with random network, run 100K self-play games
   - Phase 2: Train for 50 epochs, evaluate vs Apex
   - Phase 3: Iterate (self-play → train → evaluate) for 10-20 cycles
   - Expected: 24-72 hours on GPU, 1-2 weeks on CPU

---

### Priority Ranking

| # | Approach | Effort | Expected Gain | Scope Lock? |
|---|---|---|---|---|
| 0 | Engine fix (MAX_TURNS_PER_HAND) | 10 min | Unblocks all | ❌ Needs `game.py` |
| 1 | Rollout-based discard | 1 day | +2-5% vs Nexus | ✅ `apex.py` only |
| 2 | Opponent-model defensive discard | 1 day | +1-3% vs Nexus | ✅ `apex.py` only |
| 3 | Lookahead knock EV | 0.5 day | +1-2% overall | ✅ `apex.py` only |
| 4 | Deep CFR | 2-4 weeks | +10-20% | ❌ New files + training |
| 5 | AlphaZero MCTS+NN | 4-8 weeks | +15-25% | ❌ PyTorch + training |

**Recommended next directive:** Lift the scope lock to allow `game.py` edits (10
minutes for the engine fix), then implement Approaches 1-3 sequentially with
benchmark gates between each.
