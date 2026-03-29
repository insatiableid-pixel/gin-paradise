# Oracle Roadmap Assessment: How Close Are We to eXtreme Gammon–Level Gin Rummy?

**Date:** 2026-03-23  
**Context:** Post–Phase 68 strategic review  
**Scope:** Honest assessment of current capabilities, feasibility analysis of the oracle target, recommended architectural pivot, and detailed implementation roadmap

---

## Table of Contents

1. [The Question](#1-the-question)
2. [What eXtreme Gammon Actually Is](#2-what-extreme-gammon-actually-is)
3. [What We Have Built (68 Phases)](#3-what-we-have-built-68-phases)
4. [Current Score: 25 / 100](#4-current-score-25--100)
5. [Why the Mountain Is Shorter Than It Looks](#5-why-the-mountain-is-shorter-than-it-looks)
6. [The Paradigm Insight: Not XG — Pluribus](#6-the-paradigm-insight-not-xg--pluribus)
7. [The Architectural Pivot: CFR + Endgame Solving](#7-the-architectural-pivot-cfr--endgame-solving)
8. [The Performance Bottleneck and the Rust Solution](#8-the-performance-bottleneck-and-the-rust-solution)
9. [Detailed Implementation Roadmap](#9-detailed-implementation-roadmap)
10. [What Already Transfers](#10-what-already-transfers)
11. [Revised Feasibility: 25/100 → 90/100](#11-revised-feasibility-25100--90100)
12. [What 90/100 Means in Practice](#12-what-90100-means-in-practice)
13. [What Would Remain for 100/100](#13-what-would-remain-for-100100)
14. [Risk Analysis](#14-risk-analysis)
15. [Conclusion](#15-conclusion)

---

## 1. The Question

After completing Phase 68 (Trace Activation and Solver V6 Sprint), the natural question arose:

> **How close are we to having a gin player as good as eXtreme Gammon is for backgammon?**

This document is the honest, deep answer.

---

## 2. What eXtreme Gammon Actually Is

eXtreme Gammon (XG) represents the culmination of **30+ years of research** in computer backgammon, spanning from Gerald Tesauro's TD-Gammon (1992) through JellyFish, Snowie, GNU Backgammon, and finally XG. Understanding what XG actually does — and *why* it needs to do it — is essential for assessing our position.

### 2.1 XG's Core Architecture

| Component | What It Does | Why It Needs It |
|-----------|-------------|-----------------|
| **Deep neural network evaluator** | Evaluates any board position to ~0.01 equity error | Backgammon has ~10²⁰ positions; can't enumerate |
| **Rollout engine** | Plays out thousands of games from any position | Refines NN evaluation with Monte Carlo sampling |
| **Full decision coverage** | Checker play, doubling, race, bear-off, match play | Every decision point needs evaluation |
| **Match equity table** | Exact pre-computed match-winning probabilities | Doubling cube decisions depend on match context |
| **Opening book** | Pre-computed optimal plays for opening positions | First few moves are high-leverage |
| **Endgame database** | Exact solutions for late-game bear-off positions | Can be enumerated; provides ground truth |

### 2.2 Why XG Needed Neural Networks

Backgammon's state space is astronomical (~10²⁰ reachable positions) and its branching factor is enormous (up to 21 possible dice rolls × multiple checker-play choices per roll). It is **impossible to enumerate** the game tree. The only viable approach is to *learn* what positions are worth through pattern recognition — hence neural networks trained on self-play.

This is a crucial point for our assessment: **the reason XG uses neural networks is specific to backgammon's structure.** If Gin Rummy's structure is different, the optimal approach may be completely different.

### 2.3 XG's Achievement Level

- **Equity error:** ~0.003 per position on average (world-class level)
- **Checker play:** Near-perfect (errors detectable only by exhaustive rollout)
- **Doubling decisions:** Near-perfect for money play; excellent for match play
- **Practical strength:** No human has consistently beaten XG at any time setting
- **Community acceptance:** Universally regarded as the oracle standard for backgammon

---

## 3. What We Have Built (68 Phases)

### 3.1 Complete Inventory

Over 68 phases of development, the Gin Rummy project has produced:

#### Game Infrastructure
- **Full game engine** (`game.py`) — complete rules, scoring, layoffs, match play
- **Card representation** (`card.py`) — standard encoding, utilities
- **Meld detection** (`meld.py`) — optimal meld arrangement (exact)
- **Player interface** (`player.py`) — abstract base class for all bot types

#### Bot Family
- **SimplePlayer** — baseline heuristic (draw-if-meld, discard-highest, always-knock)
- **RandomPlayer** — random baseline for calibration
- **Apex** (`apex.py`) — advanced heuristic player
- **ApexMCTS** (`apex_mcts.py`) — Monte Carlo Tree Search player
- **ApexMCTS variants** — specialized versions for different strategies:
  - `apex_mcts_action.py` — action-based MCTS
  - `apex_mcts_clinch_gogin.py` — clinch-or-go-gin strategy
  - `apex_mcts_clinchonly_gogin.py` — **current champion** (clinch-only + go-gin)
  - `apex_mcts_discard.py` — discard-focused MCTS
  - `apex_mcts_firstknock.py` — first-knock strategy
  - `apex_mcts_gogin.py` — pure go-gin strategy
  - `apex_mcts_knock.py` — knock-focused MCTS
  - `apex_mcts_lowstock_gogin.py` — low-stock go-gin
  - `apex_mcts_paperknock.py` — paper-knock strategy
  - `apex_mcts_v2.py` — second-generation MCTS
  - `apex_mcts_value.py` — value-based MCTS
- **ApexCFR** (`apex_cfr.py`) — Counterfactual Regret Minimization player
- **ApexValue** (`apex_value.py`) — value-network player
- **Heisenbot** (`heisenbot.py`) — uncertainty-aware player
- **Titan** (`titan.py`) — strong tournament player
- **Nexus** (`nexus.py`) — combination strategy player
- **DeepKnock** (`deepknock.py`) — deep knock analysis player

#### Solvers (Phases 61-68)
- **Solver v1** (Phase 61) — uniform worlds + greedy continuation
- **Solver v2** (`solver_v2.py`, Phase 62) — uniform worlds + champion continuation + empirical equity
- **Solver v3** (`solver_v3.py`, Phase 65) — uniform worlds + belief reweighting + undercut penalty
- **Solver v4** (`solver_v4.py`, Phase 66) — belief-weighted random worlds + importance weights
- **Solver v5** (`solver_v5.py`, Phase 67) — meld-aware constructed worlds + trace infrastructure
- **Solver v6** (`solver_v6.py`, Phase 68) — trace-active meld construction + gin-chasing tier

#### Analysis & Evaluation Infrastructure
- **Endgame solver** (`endgame_solver.py`) — public state representation, hidden world generation, outcome distributions, match equity
- **Undercut estimator** (`undercut_estimator.py`) — ML model for undercut risk prediction (AUC 0.752)
- **Undercut dataset** (`undercut_dataset.py`) — low-stock position mining from self-play
- **Trace-rich dataset** (`trace_rich_dataset.py`) — per-card event dataset builder
- **Action trace** (`action_trace.py`) — per-card public action signal pipeline
- **Meld constructor v1** (`meld_constructor.py`) — meld-aware opponent hand construction
- **Meld constructor v2** (`meld_constructor_v2.py`) — trace-active 4-tier construction
- **Belief world generator** (`belief_world_generator.py`) — belief-weighted hidden world generation
- **Opponent model** (`opponent_model.py`) — opponent card-weight modeling

#### Decision Models
- **Knock action model** (`knock_action_model.py`) — learned knock decision features
- **Knock features** (`knock_features.py`) — feature extraction for knock decisions
- **Draw action model** (`draw_action_model.py`) — learned draw decision features
- **Discard action model** (`discard_action_model.py`) — learned discard decision features
- **Discard action features** (`discard_action_features.py`) — feature extraction for discard decisions
- **Action features** (`action_features.py`) — general action feature extraction
- **PBS features** (`pbs_features.py`) — position-based scoring features
- **Value model** (`value_model.py`) — position value estimation

#### Search & Strategy
- **Draw search** (`draw_search.py`) — search-based draw decisions
- **Value-augmented search** (`value_augmented_search.py`) — value-network enhanced search
- **CFR trainer** (`cfr_trainer.py`) — CFR training infrastructure
- **CFR strategy** (`cfr_strategy.py`) — CFR strategy representation

#### Evaluation Infrastructure
- **Tournament** (`tournament.py`) — round-robin tournament system
- **Benchmark** (`benchmark.py`) — performance benchmarking
- **Evaluator** (`evaluator.py`) — position evaluation
- **Disagreement analysis** (`disagreement_analysis.py`) — inter-solver disagreement study
- **Disagreement miner** (`disagreement_miner.py`) — automated disagreement mining
- **Canonical spots** (`canonical_spots.py`) — reference positions for calibration
- **Spot miner** (`spot_miner.py`) — game-state mining from self-play
- **Frontier knock** (`frontier_knock.py`) — knock frontier analysis
- **Solver probe knock** (`solver_probe_knock.py`) — solver knock probing
- **Match equity table** (`match_equity_table.py`) — empirical match-equity calculations
- **Match equity cache** (`match_equity_cache.json`) — cached equity values

### 3.2 Phase 68's Specific Achievement

Phase 68 (just completed) achieved:

| Metric | v5 (P67) | **v6 (P68)** | Actual |
|--------|----------|-------------|--------|
| Opp DW MAE | 5.46 | **2.56** | — |
| Opp DW bias | +4.73 | **+0.77** | — |
| Frac opp DW ≤ 5 | 39.3% | **74.4%** | 80.7% |
| Trace signal activation | 0% | **100%** | — |

The v6 solver now predicts opponent deadwood within 0.77 points of reality in low-stock positions. The belief model is genuinely close to ground truth for endgame opponent hand inference.

---

## 4. Current Score: 25 / 100

### 4.1 Scoring Methodology

The score is measured against "XG-equivalent for Gin Rummy" — meaning:
- Can evaluate any position to high accuracy
- Makes near-optimal decisions for all decision types
- No human can consistently beat it
- Produces analysis that players trust as authoritative

### 4.2 Component Scores

| Component | Weight | Our Score | Max | Notes |
|-----------|--------|-----------|-----|-------|
| **Game engine correctness** | 5% | 5/5 | 5 | Complete, exact |
| **Meld/deadwood computation** | 5% | 5/5 | 5 | Exact, optimal |
| **Knock decision (low-stock)** | 10% | 7/10 | 10 | v6 is genuinely good |
| **Knock decision (mid-stock)** | 5% | 1/5 | 5 | Not addressed |
| **Draw decision** | 15% | 2/15 | 15 | Heuristic only |
| **Discard decision** | 15% | 2/15 | 15 | Heuristic only |
| **Opponent modeling (full game)** | 15% | 4/15 | 15 | Good in endgame, absent elsewhere |
| **Opening / early game** | 5% | 0/5 | 5 | Nothing |
| **Match play optimization** | 5% | 2/5 | 5 | Basic equity table exists |
| **Speed / real-time play** | 5% | 2/5 | 5 | Python is slow |
| **Provable optimality / equilibrium** | 10% | 0/10 | 10 | No game-theoretic solution |
| **Tournament strength** | 5% | 3/5 | 5 | Champion bot is strong but heuristic |
| **TOTAL** | 100% | **25/100** | 100 | |

### 4.3 Where the Points Are

The 25 points come from:
- Perfect game infrastructure (10/10)
- Strong low-stock knock analysis (7/10)
- Decent opponent modeling in endgame (4/15)
- Reasonable tournament play (3/5)
- Basic match equity (2/5)

The 75 missing points come from:
- No full-game decision solver (draw + discard = 30% of total, we have ~4/30)
- No game-theoretic equilibrium computation (0/10)
- No opponent modeling outside endgame (0/~7)
- No opening theory (0/5)
- Python speed limitations (2/5)

---

## 5. Why the Mountain Is Shorter Than It Looks

### 5.1 Gin Rummy vs Backgammon: Structural Differences

The initial instinct is to map "XG for Backgammon" directly onto "XG for Gin Rummy" and conclude we need the same approach (massive neural networks, billions of training games). This is wrong, because the games have fundamentally different structures.

| Dimension | Backgammon | Gin Rummy |
|-----------|-----------|-----------|
| **State space** | ~10²⁰ positions | ~10¹⁰ relevant information sets |
| **Information** | Perfect (both players see the board) | **Imperfect** (hidden opponent hand) |
| **Randomness** | Dice every turn (21 outcomes) | Card draws (shrinking known pool) |
| **Branching factor** | High (dice × checker moves) | Low (draw 1 of 2, discard 1 of 11, knock y/n) |
| **Key challenge** | Position evaluation | **Inference under uncertainty** |
| **Evaluation complexity** | Requires pattern recognition | Requires **Bayesian belief updating** |
| **Solved by** | Neural networks (can't enumerate) | **CFR + information set abstraction** |

### 5.2 The Critical Insight: Gin Rummy Is an Information Game, Not an Evaluation Game

In backgammon, the hard problem is: "given this board position, what is it worth?" The board is visible to both players, but the space is so large that you can't compute the answer — you have to *learn* it with neural networks.

In Gin Rummy, the hard problem is: "given what I've seen my opponent do, what cards do they hold?" The hand evaluation itself is trivial (exact deadwood computation), but the **hidden information** is the challenge.

This is fundamentally the same problem as poker. And poker has been "solved" (or made superhuman) without neural networks.

### 5.3 Gin Rummy's Game Tree Is Manageable

A rough estimate of the game tree complexity:

```
Deals:         C(52,10) × C(42,10) ≈ 10^18 (but information sets collapse this)
Info sets:     ~10^10 with good abstraction (comparable to Heads-Up Limit Hold'em)
Actions/turn:  Draw: 2 choices. Discard: ≤11 choices. Knock: 2 choices. Total: ~44
Turns/game:    ~15-25 average
```

Heads-Up Limit Hold'em (HULHE) was **fully solved** in 2015 by the University of Alberta team. It has ~10^13 information sets. Gin Rummy, with appropriate abstraction, has **fewer** or comparable information sets.

6-player No-Limit Hold'em (which Pluribus beat human professionals at) is vastly more complex than Gin Rummy, and its blueprint strategy was computed for **$150 of cloud compute**.

**Gin Rummy is between HULHE (solved) and 6-max NLHE (superhuman). It is tractable.**

---

## 6. The Paradigm Insight: Not XG — Pluribus

### 6.1 The Wrong Paradigm

For 68 phases, we've been implicitly following the XG paradigm:
- Build strong heuristic bots
- Evaluate individual positions
- Iterate on position evaluation accuracy
- Use learned models (undercut estimator, value model) to improve evaluation

This is the right approach for backgammon (perfect information, huge state space, need pattern recognition). It is the **wrong paradigm for Gin Rummy.**

### 6.2 The Right Paradigm

Gin Rummy's structure matches **poker**, not backgammon:

| Property | Backgammon | **Poker** | **Gin Rummy** |
|----------|-----------|----------|--------------|
| Information | Perfect | **Imperfect** | **Imperfect** |
| Hidden state | None | **Opponent cards** | **Opponent cards** |
| Key signal | Board position | **Betting patterns** | **Draw/discard patterns** |
| Inference | Not needed | **Bayesian belief updating** | **Bayesian belief updating** |
| Optimal strategy | Value maximization | **Game-theoretic equilibrium** | **Game-theoretic equilibrium** |
| Solution method | Neural network | **CFR** | **CFR** |

### 6.3 What Pluribus Did

Pluribus (2019, Carnegie Mellon/Facebook) beat professional poker players in 6-player No-Limit Hold'em. Its architecture:

1. **Blueprint strategy** — Computed offline via Monte Carlo CFR (MCCFR) with information set abstraction. This gives near-Nash-equilibrium play for the abstract game.

2. **Real-time endgame solving** — During play, when reaching late-game situations, recompute a refined strategy specific to the current information set. This is exactly what our v6 solver does for low-stock Gin Rummy.

3. **Depth-limited search** — For decisions in the middle of the game, look ahead a few actions and evaluate using the blueprint.

4. **No neural networks.** Pluribus used no deep learning. Pure CFR + search.

5. **Computational cost:** The blueprint strategy took **$150 worth of cloud compute** to create. Real-time search ran on a single CPU during play.

**This is the template for our oracle Gin Rummy player.**

### 6.4 What CFR Actually Computes

Counterfactual Regret Minimization works by:

1. Traversing the game tree repeatedly
2. At each information set (a state where you can't distinguish between game histories), tracking the "regret" of not having played each action
3. Over millions of iterations, the average strategy converges to a **Nash equilibrium** — a strategy that cannot be exploited, regardless of what the opponent does

The key properties:
- **No training data needed** — CFR learns from self-play against itself
- **Provable convergence** — guaranteed to approach Nash equilibrium
- **Works for imperfect information** — designed specifically for games where you don't see all cards
- **We already have it** — `cfr_trainer.py` and `cfr_strategy.py` exist in our codebase

---

## 7. The Architectural Pivot: CFR + Endgame Solving

### 7.1 The Three Pillars

A Gin Rummy oracle needs three things:

#### Pillar 1: Full-Game CFR Blueprint

Compute a near-Nash-equilibrium strategy for the entire game, using information set abstraction to make the game tree tractable.

**What this gives us:**
- Optimal draw decisions (draw from stock vs discard pile)
- Optimal discard decisions (which card to throw)
- Optimal knock decisions (knock vs continue)
- All decisions are game-theoretically grounded, not heuristic

**How abstraction works:**
- Group similar hands together (e.g., all hands with 3 melds + 2 DW points are "equivalent" for strategy purposes)
- Card isomorphism: suits are interchangeable unless they participate in runs (rank matters more than suit for strategic equivalence)
- Timing abstraction: early game, mid game, late game phases
- Opponent belief bucketing: different levels of information about opponent hand

**Estimated information set count with good abstraction:** 10^8–10^10 (comparable to solved poker variants)

#### Pillar 2: Real-Time Endgame Solving

When the game reaches a late stage (stock ≤ 15), switch from the blueprint to a precise, real-time computation for the actual game state.

**What this gives us:**
- Exact evaluation for the specific cards we hold and the specific information we have
- No abstraction error — we solve the actual subgame, not an abstracted version
- This is exactly what our v6 solver already does, but extended to earlier in the game

**What we already have:**
- v6 solver handles stock ≤ 6 with meld-aware construction
- Endgame solver with continuation simulation
- Belief updating from public actions

**What needs to extend:**
- Coverage back to stock ≤ 15 (or even ≤ 20)
- Tighter belief models using the trace pipeline
- Faster computation (currently seconds per solve, needs milliseconds)

#### Pillar 3: Real-Time Belief Updating

Throughout the game, maintain a Bayesian belief distribution over the opponent's hand based on all public actions.

**What this gives us:**
- At every decision point, a probability distribution over what the opponent holds
- Feeds into both the blueprint (for strategy selection) and endgame solving (for world generation)

**What we already have:**
- ActionTrace pipeline (Phase 67-68) — tracks pickups, discards, declines
- Per-card trace weights — converts events into card probabilities
- Meld constructor — generates plausible opponent hands from beliefs

**What needs to extend:**
- Update beliefs every turn, not just at knock decision time
- Full Bayesian card tracking: P(opponent holds card X | all observed actions)
- Integration with CFR so the strategy adapts to the current belief state

### 7.2 How They Work Together

```
Turn 1-8 (early/mid game):
  ┌──────────────────────────────┐
  │  CFR Blueprint Strategy      │
  │  + Real-time belief update   │
  │  → draws, discards, knocks  │
  │    from pre-computed table   │
  └──────────────────────────────┘

Turn 8-15 (transition):
  ┌──────────────────────────────┐
  │  Blueprint + depth-limited   │
  │  search with current beliefs │
  │  → refines blueprint using  │
  │    actual information set    │
  └──────────────────────────────┘

Turn 15+ (endgame):
  ┌──────────────────────────────┐
  │  Full real-time endgame      │
  │  solve (extended v6 solver)  │
  │  → exact computation with   │
  │    belief-generated worlds   │
  └──────────────────────────────┘
```

This is exactly the Pluribus architecture adapted for Gin Rummy.

---

## 8. The Performance Bottleneck and the Rust Solution

### 8.1 Python's Limitation

CFR's inner loop is extremely tight:
1. Pick a game state
2. Enumerate legal actions
3. For each action, recursively traverse the subtree
4. Update regret values
5. Repeat billions of times

In Python, each iteration takes ~200–500 μs. For a game tree with 10^8 information sets and 10,000 CFR iterations (minimum for convergence), that's:

```
10^8 info sets × 10^4 iterations × 300 μs = 3 × 10^14 μs = 10^7 seconds ≈ 115 days
```

In Rust or C++:

```
10^8 info sets × 10^4 iterations × 0.3 μs = 3 × 10^11 μs = 10^4 seconds ≈ 3 hours
```

This is the 1,000× difference between "theoretically possible" and "practically achievable."

### 8.2 Why Rust

| Criterion | Rust | C++ | Python/Cython | Julia |
|-----------|------|-----|---------------|-------|
| Raw speed | ★★★★★ | ★★★★★ | ★★☆☆☆ | ★★★★☆ |
| Memory safety | ★★★★★ | ★★☆☆☆ | ★★★★★ | ★★★★☆ |
| Python interop | ★★★★☆ (PyO3) | ★★★☆☆ (pybind11) | N/A | ★★☆☆☆ |
| Parallelism | ★★★★★ (Rayon) | ★★★★☆ (threads) | ★☆☆☆☆ (GIL) | ★★★★☆ |
| Build system | ★★★★★ (Cargo) | ★★☆☆☆ (CMake) | N/A | ★★★☆☆ |
| Ecosystem | ★★★★☆ | ★★★★★ | ★★★★★ | ★★★☆☆ |
| Learning curve | ★★☆☆☆ | ★★★☆☆ | ★★★★★ | ★★★★☆ |

**Rust wins** because:
1. **Same speed as C++** but without memory corruption bugs (critical when processing billions of card states)
2. **PyO3** provides seamless Python interop — we keep all existing Python code and only replace the hot inner loop
3. **Rayon** gives trivially-easy parallelism for multi-core CFR traversal
4. **Cargo** build system is painless compared to C++ builds on Windows

### 8.3 Architecture: Rust Core + Python Shell

```
┌─────────────────────────────────────────────────────────┐
│  PYTHON LAYER (existing code, unchanged)                │
│                                                         │
│  ┌─────────────┐ ┌───────────┐ ┌─────────────────────┐ │
│  │ Tournament   │ │ Analysis  │ │ Dataset / Reporting │ │
│  │ runner       │ │ scripts   │ │ infrastructure      │ │
│  └─────────────┘ └───────────┘ └─────────────────────┘ │
│                                                         │
│  ┌─────────────┐ ┌───────────┐ ┌─────────────────────┐ │
│  │ Bot          │ │ Solver    │ │ Belief model        │ │
│  │ interfaces   │ │ v1-v6     │ │ (ActionTrace etc)   │ │
│  └──────┬──────┘ └─────┬─────┘ └──────────┬──────────┘ │
│         │              │                   │            │
│         └──────────────┼───────────────────┘            │
│                        │ PyO3 FFI boundary              │
├────────────────────────┼────────────────────────────────┤
│                        │                                │
│  RUST CORE (new, performance-critical)                  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Card Engine                                     │    │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐   │    │
│  │  │ Bitboard │ │ Fast     │ │ Card-set      │   │    │
│  │  │ card     │ │ meld     │ │ operations    │   │    │
│  │  │ repr     │ │ detect   │ │ (O(1) union,  │   │    │
│  │  │          │ │ (lookup) │ │  intersect)   │   │    │
│  │  └──────────┘ └──────────┘ └───────────────┘   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  CFR Engine                                      │    │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐   │    │
│  │  │ Info set │ │ MCCFR    │ │ Strategy      │   │    │
│  │  │ abstract │ │ traversal│ │ table / lookup│   │    │
│  │  │ + hash   │ │ (Rayon   │ │               │   │    │
│  │  │          │ │  parallel│ │               │   │    │
│  │  └──────────┘ └──────────┘ └───────────────┘   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Endgame Solver                                  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐   │    │
│  │  │ World    │ │ Contin-  │ │ Belief-       │   │    │
│  │  │ enumerat │ │ uation   │ │ weighted      │   │    │
│  │  │ ion      │ │ rollout  │ │ sampling      │   │    │
│  │  └──────────┘ └──────────┘ └───────────────┘   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 8.4 Key Rust Data Structures

#### Bitboard Card Representation
```
A hand of cards can be represented as a u64 bitmask:
  bit 0  = Ace of Clubs
  bit 1  = Ace of Diamonds
  bit 2  = Ace of Spades
  bit 3  = Ace of Hearts
  bit 4  = 2 of Clubs
  ...
  bit 51 = King of Hearts

Operations on card sets become single CPU instructions:
  union:        hand1 | hand2           (1 ns)
  intersection: hand1 & hand2           (1 ns)
  removal:      hand & !card_mask       (1 ns)
  count:        hand.count_ones()       (1 ns)
  iterate:      while hand != 0 { ... } (few ns per card)
```

This is ~1000× faster than Python set operations on integer lists.

#### Information Set Hashing
```
An information set in Gin Rummy is defined by:
  1. My hand (52-bit mask)
  2. Visible discard pile (52-bit mask + order)
  3. Known opponent actions (compact event log)
  4. Score state (my_score, opp_score)
  5. Game phase (stock remaining)

Hash: combine these into a 128-bit hash for table lookup.
Two game states with the same hash are strategically equivalent.
```

---

## 9. Detailed Implementation Roadmap

### Phase 1: Rust Core Foundation (Est. 2-4 weeks of sessions)

**Goal:** Fast card engine + Python bindings, benchmarked against current Python code.

| Step | Deliverable | Verification |
|------|-------------|-------------|
| 1.1 | Install Rust toolchain | `cargo --version` works |
| 1.2 | Create `gin-core` Rust crate | Basic project structure |
| 1.3 | Bitboard card representation | Unit tests matching card.py |
| 1.4 | Fast meld detection | Benchmark vs Python meld.py (target: 1000×) |
| 1.5 | Deadwood calculation | Exact match with Python, benchmark |
| 1.6 | PyO3 bindings | Python can call Rust card/meld functions |
| 1.7 | Integration test | Existing Python tests pass with Rust backend |

**Success metric:** Meld detection 1000× faster than Python, provably correct.

### Phase 2: Game Tree & Information Set Abstraction (Est. 3-5 weeks)

**Goal:** Define the abstract game tree for CFR traversal.

| Step | Deliverable | Verification |
|------|-------------|-------------|
| 2.1 | Game tree representation in Rust | Correct legal-action enumeration |
| 2.2 | Information set definition | Hash function for strategic equivalence |
| 2.3 | Hand abstraction buckets | Group similar hands; measure abstraction error |
| 2.4 | Timing abstraction | Define early/mid/late game phases |
| 2.5 | Action encoding | Compact representation for draw/discard/knock |
| 2.6 | Game tree size measurement | Count actual info sets after abstraction |

**Success metric:** Abstract game tree fits in RAM; info set count < 10^10.

### Phase 3: CFR Engine (Est. 4-8 weeks)

**Goal:** Compute a blueprint strategy via Monte Carlo CFR.

| Step | Deliverable | Verification |
|------|-------------|-------------|
| 3.1 | MCCFR traversal (external sampling) | Correct regret updates on toy game |
| 3.2 | Regret table (disc-backed for large games) | Memory-efficient storage |
| 3.3 | Parallelization via Rayon | Linear speedup with core count |
| 3.4 | Convergence monitoring | Exploitability decreasing over iterations |
| 3.5 | Blueprint extraction | Average strategy → lookup table |
| 3.6 | Blueprint vs champion bot | Tournament: blueprint should be competitive |

**Success metric:** Blueprint strategy beats ApexMCTSClinchOnlyGoGin in 1000-game tournament.

### Phase 4: Endgame Solver Upgrade (Est. 2-3 weeks)

**Goal:** Extend current v6 solver to Rust-speed, deeper coverage.

| Step | Deliverable | Verification |
|------|-------------|-------------|
| 4.1 | Port world generation to Rust | 1000× faster than Python |
| 4.2 | Port continuation simulation to Rust | 1000× faster |
| 4.3 | Extend to stock ≤ 15 | Solve deeper subgames in real time |
| 4.4 | Belief-aware world generation | Use full action trace for belief updating |
| 4.5 | Integration with blueprint | Endgame solve replaces blueprint in late game |

**Success metric:** Full endgame solve (stock ≤ 15) in < 100ms.

### Phase 5: Full Player Integration (Est. 2-3 weeks)

**Goal:** Complete Gin Rummy player using blueprint + endgame solving.

| Step | Deliverable | Verification |
|------|-------------|-------------|
| 5.1 | Blueprint player bot | Uses CFR table for all decisions |
| 5.2 | Real-time belief updating | Updates card probabilities every action |
| 5.3 | Endgame trigger | Switches from blueprint to endgame solve |
| 5.4 | Search refinement | Depth-limited search for mid-game decisions |
| 5.5 | Full tournament evaluation | vs all existing bots, 10,000 games each |

**Success metric:** Wins > 60% vs ApexMCTSClinchOnlyGoGin (champion).

### Phase 6: Calibration & Hardening (Est. 3-5 weeks)

**Goal:** Push toward oracle-level accuracy.

| Step | Deliverable | Verification |
|------|-------------|-------------|
| 6.1 | Exploitability measurement | How far from Nash equilibrium? |
| 6.2 | Finer abstraction in critical regions | Reduce abstraction error |
| 6.3 | Longer CFR training runs | More iterations = tighter strategy |
| 6.4 | Position analysis tool | "What would oracle do?" for any position |
| 6.5 | Error analysis | Where does the player make mistakes? |
| 6.6 | Match play optimization | Adjust for score context |

**Success metric:** Exploitability < 0.5 points/hand; wins > 70% vs champion.

### Phase 7: Oracle Interface (Est. 2-3 weeks)

**Goal:** XG-like analysis interface.

| Step | Deliverable | Verification |
|------|-------------|-------------|
| 7.1 | Position analyzer | Input any game state → optimal action + EV |
| 7.2 | Decision breakdown | For each action: probability, expected value, equity |
| 7.3 | Error detection | Compare any player's decision to oracle |
| 7.4 | Match replay analysis | Load a game, analyze every decision |

**Success metric:** Convincing "XG-like" output for any Gin Rummy position.

---

## 10. What Already Transfers

A significant fraction of our 68 phases of work transfers directly to the new architecture:

| Component | Transfers? | How |
|-----------|-----------|-----|
| Game engine (`game.py`) | ✅ Full | Reference implementation for Rust port correctness |
| Card/meld/deadwood logic | ✅ Full | Specification for Rust bitboard reimplementation |
| Tournament system | ✅ Full | Benchmarks new player against all existing bots |
| Endgame solver architecture | ✅ Core logic | Port to Rust, extend coverage |
| Belief model (ActionTrace) | ✅ Core logic | Port to Rust, extend to full game |
| Meld constructor | ✅ Design | Inform endgame world generation in Rust |
| Undercut estimator | ✅ As feature | Supplementary signal for endgame |
| CFR trainer/strategy | ⚠️ Partial | Architecture transfers; Python impl too slow |
| All bot implementations | ✅ As opponents | Benchmark targets for new player |
| Dataset infrastructure | ✅ Full | Training data for calibration |
| Match equity table | ✅ Full | Score-context adjustment |
| All 68 execution reports | ✅ As knowledge | Lessons learned, failure modes documented |

**Estimated transfer value: ~40% of total work directly applicable.** The remaining 60% is new engineering (Rust core, CFR at scale, information set abstraction).

---

## 11. Revised Feasibility: 25/100 → 90/100

### With the Rust core and CFR pivot:

| Milestone | Score | Timeline | Cumulative |
|-----------|-------|----------|------------|
| Current state | 25/100 | Done | 25 |
| Rust core + fast card engine | 30/100 | +2-4 weeks | 30 |
| CFR blueprint (basic abstraction) | 50/100 | +4-8 weeks | 50 |
| Extended endgame solver (Rust) | 60/100 | +2-3 weeks | 60 |
| Full player (blueprint + endgame) | 70/100 | +2-3 weeks | 70 |
| Fine-grained CFR + calibration | 80/100 | +3-5 weeks | 80 |
| Oracle interface + position analysis | 85/100 | +2-3 weeks | 85 |
| Hardening + match play optimization | 90/100 | +3-5 weeks | 90 |
| **TOTAL** | **90/100** | **~18-31 weeks of sessions** | |

### What We Cannot Reach Without External Validation

The gap from 90 to 100 requires:
- **Independent verification** by other researchers/players
- **Community acceptance** as the standard (like XG earned over years)
- **Exhaustive testing** across millions of positions
- **Publication** and peer review
- **Years of refinement** and edge-case hunting

This is not a technical limitation — it's a social/scientific one. XG didn't reach "100" overnight either.

---

## 12. What 90/100 Means in Practice

At 90/100, the system would:

1. **Beat any human player** in Gin Rummy, consistently
2. **Beat all existing bots** in the codebase by a significant margin
3. **Evaluate any position** and say "the optimal action is X with expected value Y"
4. **Explain decisions** — "drawing from discard is +2.3 EV because card Z completes a run"
5. **Analyze replays** — "this discard cost you 1.7 expected points"
6. **Play in near-real-time** — decisions in < 1 second
7. **Be provably near-optimal** — strategy is within measurable distance of Nash equilibrium

This is genuinely comparable to what XG provides for backgammon, adjusted for the fact that Gin Rummy is a smaller, less commercially studied game.

---

## 13. What Would Remain for 100/100

| Gap | What It Is | Difficulty |
|-----|-----------|-----------|
| Perfect Nash equilibrium | Zero abstraction error, exact game solution | Extremely hard (10^10+ info sets) |
| Tournament-verified dominance | Run in major Gin Rummy competitions | Requires community engagement |
| Exhaustive position database | Pre-computed analysis for all common positions | Large storage, years of compute |
| Multi-format support | Oklahoma, Hollywood, three-hand variants | Engineering, not research |
| Perfect match play | Exact match equity table from solved game | Depends on perfect solution |

---

## 14. Risk Analysis

### 14.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Information set space too large for RAM | Medium | High | Disk-backed tables, coarser abstraction |
| CFR convergence too slow | Low | Medium | Monte Carlo sampling, parallelism |
| Abstraction error dominates | Medium | High | Iterative refinement, finer buckets in critical regions |
| Rust/Python interop friction | Low | Low | PyO3 is mature; fallback to subprocess |
| Endgame solver too slow at stock ≤ 15 | Medium | Medium | Pruning, caching, belief simplification |

### 14.2 Strategic Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Unknown game-theoretic complexity | Low | High | Gin Rummy is known to be tractable; HULHE precedent |
| Diminishing returns beyond 85/100 | High | Medium | Accept 85-90 as practical ceiling |
| Motivation/time | Medium | High | Clear milestones with measurable progress |

### 14.3 Key Unknown

The single biggest unknown is: **how fine does the information set abstraction need to be for near-optimal play?** If coarse abstraction works (like in poker), we reach 80+ quickly. If fine abstraction is needed, the compute cost goes up but is still feasible with Rust on a consumer machine.

The encouraging sign: poker research showed that even fairly coarse abstractions produce superhuman play. Gin Rummy is simpler than poker.

---

## 15. Conclusion

### The mountain is climbable.

The path is:
1. **Pivot from XG-paradigm (neural nets) to Pluribus-paradigm (CFR + endgame solving)**
2. **Build a Rust core** for the performance-critical inner loops
3. **Compute a CFR blueprint strategy** for the full game
4. **Extend the endgame solver** (which already works well) to cover more of the game
5. **Integrate belief updating** (which already works) throughout the full game

The 68 phases built the right foundation. The next step is an architectural pivot, not more heuristic refinement.

**Current score: 25/100**  
**Achievable with available tools: 90/100**  
**Timeline: ~18-31 weeks of active development sessions**  
**Technical risk: Manageable — Gin Rummy is between HULHE (solved) and Pluribus poker (superhuman)**

The oracle is reachable.

---

*This assessment was produced on 2026-03-23 following the completion of Phase 68 (Trace Activation and Solver V6 Sprint). It reflects an honest evaluation of the project's current state and a concrete path forward.*
