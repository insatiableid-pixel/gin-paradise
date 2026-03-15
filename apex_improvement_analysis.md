# Apex Bot — Next Highest-Leverage Improvements

**Date:** March 11, 2026
**Method:** Full source-code audit of `apex.py`, `opponent_model.py`, `meld.py`, `game.py`, and all competitor bots (`Nexus`, `DeepKnock`, `Heisenbot`, `Titan`), cross-referenced against the execution report's identified weaknesses.

---

## Current State Summary

Apex is already the strongest bot (57% vs Nexus, 65% vs DeepKnock, 59% vs Heisenbot). Its foundation is solid: paper-informed 8-rule knock hierarchy, Bayesian opponent model, MC layoff-aware knock EV, ace/two draw rule, triangle/double draws, and model-weighted discard safety.

The execution report identified 5 remaining weaknesses. Below I rank them by expected impact, then identify **2 additional bugs/gaps** the report missed.

---

## Improvement Rankings (Highest Leverage First)

### 🥇 1. Discard Selection: Switch from Heuristic Scoring to Actual-DW Computation
**Expected impact: HIGH — this is the single biggest gap**

| What Apex does | What Nexus does (better) |
|---|---|
| Scores discards with `dv * 100 - near_meld * 30 - safety * 15` heuristic | Computes `compute_deadwood(remaining)` for each candidate — exact minimum DW after discard |

Apex's heuristic discard scoring ([apex.py:192-208](file:///c:/Users/mrwat/OneDrive/Desktop/Gin%20Rummy/gin_rummy/apex.py#L192-L208)) uses a weighted formula of deadwood value, near-meld potential, and safety. This **approximates** which card to discard but can get it wrong when:
- A high-DW card is secretly part of a better meld arrangement
- Near-meld bonuses create false associations between cards
- The weighting coefficients (100/30/15) are suboptimal for edge cases

Nexus ([nexus.py:122-139](file:///c:/Users/mrwat/OneDrive/Desktop/Gin%20Rummy/gin_rummy/nexus.py#L122-L139)) solves this exactly: for each candidate, it removes the card, calls `compute_deadwood()` on the 10-card remainder, and picks the card whose removal minimizes actual deadwood. Safety is only a small tiebreaker (`* 0.5`).

> [!IMPORTANT]
> This is Nexus's **main advantage** over Apex. Despite Apex being ~57% vs Nexus, this gap likely costs Apex ~1-3% win rate across all matchups. Every discard where Apex picks a heuristically-high-DW card that's actually part of a better meld arrangement is a lost opportunity.

**Implementation:**
```python
def discard_decision(self, hand, drew_from_discard, drawn_card, game_state):
    self.hand = list(hand)
    self.model.update_my_hand(self.hand)

    melds, dw_cards, dw = best_meld_arrangement(hand)
    melded = set()
    for m in melds:
        for c in m:
            melded.add(c)

    restricted = drawn_card if drew_from_discard else None
    candidates = [c for c in hand if c not in melded and c != restricted]
    if not candidates:
        candidates = [c for c in hand if c != restricted]
    if not candidates:
        candidates = list(hand)

    best_card = None
    best_score = float('inf')
    for c in candidates:
        remaining = list(hand)
        remaining.remove(c)
        actual_dw = compute_deadwood(remaining)
        safety = self._safety_count(c)
        # Primary: minimize remaining DW. Secondary: safety tiebreaker.
        combined = actual_dw + safety * 0.3
        if combined < best_score or (combined == best_score and best_card is not None 
                and deadwood_value(c) > deadwood_value(best_card)):
            best_score = combined
            best_card = c

    self._top_for_opp = best_card
    self.model.my_discard(best_card)
    if best_card in self.hand:
        self.hand.remove(best_card)
    return best_card
```

**Cost:** ~10 extra `compute_deadwood()` calls per discard, but `best_meld_arrangement` is cached, so this is near-free.

---

### 🥈 2. Stock-Depth-Aware Knock Aggression
**Expected impact: MEDIUM — eliminates late-game gin-holding blunders**

The execution report flagged this as weakness #4. Currently Apex has no awareness of how many cards remain in the stock. The game engine ([game.py:231-232](file:///c:/Users/mrwat/OneDrive/Desktop/Gin%20Rummy/gin_rummy/game.py#L231-L232)) force-knocks when `stock <= 2`, but Apex doesn't proactively adjust.

When `deck_remaining` is low (≤8 cards), the hold-for-gin rules become dangerous:
- Score-aware suppression (rules 2-3, [apex.py:307-317](file:///c:/Users/mrwat/OneDrive/Desktop/Gin%20Rummy/gin_rummy/apex.py#L307-L317)) can suppress a knock even when the hand may void
- Few-DW-cards hold rule (rule 7, [apex.py:332-334](file:///c:/Users/mrwat/OneDrive/Desktop/Gin%20Rummy/gin_rummy/apex.py#L332-L334)) can hold when there aren't enough draws left to improve

**Implementation:** Add `deck_remaining` to the knock decision:
```python
deck_remaining = game_state.get('deck_remaining', 30)
# Override hold rules when stock is low
if deck_remaining <= 8 and my_dw <= 10:
    return True  # Don't risk a void hand
```

Place this after the gin check but before score-aware rules.

---

### 🥉 3. Bug Fix: `_forms_double` Gap-Adjacency Check
**Expected impact: MEDIUM — this is a logic bug**

In [apex.py:143](file:///c:/Users/mrwat/OneDrive/Desktop/Gin%20Rummy/gin_rummy/apex.py#L143):
```python
if cs == s and 0 < abs(cr - r) <= 1:
```

This only detects **directly adjacent** cards (distance 1) in the same suit, but a gap of 2 (e.g., 5♠ and 7♠) also forms a valid partial run (the missing 6♠ completes a 5-6-7 run). The `_near_meld_value` function correctly handles distance-2 gaps ([apex.py:239-243](file:///c:/Users/mrwat/OneDrive/Desktop/Gin%20Rummy/gin_rummy/apex.py#L239-L243)), but the draw-phase double check misses them.

**Fix:**
```python
if cs == s and 0 < abs(cr - r) <= 2:  # Include gap-1 partial runs
```

---

### 4. MC Sample Count Increase (15 → 25)
**Expected impact: LOW-MEDIUM**

The execution report noted this as weakness #3. At `MC_KNOCK_SAMPLES = 15`, the EV estimate has high variance — a single unlucky sample can swing the decision. Increasing to 25 reduces standard error by ~30%.

**Cost:** 10 more `best_meld_arrangement()` calls per knock decision. With caching, this adds negligible time.

```python
MC_KNOCK_SAMPLES = 25
```

---

### 5. SCORE_GAP_THRESHOLD Tuning (30 → 22)
**Expected impact: LOW-MEDIUM**

The execution report noted Heisenbot gins 3x more than Apex (68 vs 22). Apex's `SCORE_GAP_THRESHOLD = 30` means it only seeks gin when ahead/behind by 30+. Lowering to ~22 would trigger gin-seeking more often, which is profitable because:
- Apex already has strong discard safety (survives while opponent draws)
- Gin bonus (25) outweighs typical knock gains (5-15 points)

```python
SCORE_GAP_THRESHOLD = 22
```

---

### 6. Bug Fix: Stale `current_dw` Reference in Low-DW Doubles
**Expected impact: LOW — minor correctness fix**

In [apex.py:92](file:///c:/Users/mrwat/OneDrive/Desktop/Gin%20Rummy/gin_rummy/apex.py#L92):
```python
current_dw = current_dw if 'current_dw' in dir() else compute_deadwood(hand)
```

This uses `'current_dw' in dir()` which is a Python anti-pattern — `dir()` searches local scope unpredictably. In practice `current_dw` is always defined at this point (line 79), so this line is harmless but fragile. Should be simplified:

```python
# current_dw already computed at line 79, just use it
best_dw_check = self._best_dw_after_take(test_hand, top_discard)
if best_dw_check <= current_dw:
    return True
```

---

## Priority Matrix

| # | Improvement | Impact | Effort | Risk |
|---|-------------|--------|--------|------|
| 1 | **Actual-DW discard selection** | 🟢 High | Low | None — proven in Nexus |
| 2 | **Stock-depth knock override** | 🟡 Medium | Trivial | None |
| 3 | **`_forms_double` gap fix** | 🟡 Medium | Trivial | None |
| 4 | MC samples 15→25 | 🟡 Low-Med | Trivial | None |
| 5 | SCORE_GAP 30→22 | 🟡 Low-Med | Trivial | Needs benchmark validation |
| 6 | `dir()` cleanup | ⚪ Low | Trivial | None |

> [!TIP]
> **Recommended execution order:** Items 1-4 are safe to implement immediately (proven patterns or obvious fixes). Item 5 should be benchmarked to validate the exact value. Item 6 is cosmetic.

---

## What NOT to Change

- **Knock hierarchy ordering** — The 8-rule structure matches the AAAI paper's proven priority order. Don't rearrange.
- **Opponent model architecture** — The Bayesian weight system in `OpponentModel` is already the best implementation across all bots.
- **Safety scoring logic** — The model-weighted approach is strictly better than Heisenbot's binary counting and DeepKnock's identical approach.
- **Draw decision ordering** — The priority chain (meld-completing → ace/two → DW reduction → triangle → doubles → defensive) is correct.
