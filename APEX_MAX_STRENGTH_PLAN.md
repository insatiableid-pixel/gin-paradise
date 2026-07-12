# Apex Max-Strength Plan

**Definitive roadmap to make Apex as strong as possible**  
**Date:** 2026-07-11  
**Scope:** Product bot (`gin-galaxy`), research engine (`gin_rummy` / `docs/archive/research/gin_rummy`), evaluation, and oracle path  
**North star:** Superhuman, match-equity-optimal Gin Rummy play — the Gin analogue of eXtreme Gammon / Pluribus, not “a slightly better Heisenbot.”

---

## 0. Executive Thesis

Apex is already a **dominant heuristic engine**. Head-to-head evidence shows large undercut reduction (≈15 vs Heisenbot’s ≈201 in balanced tests) and clear win-rate/score edges. That is real progress.

It is **not** near oracle strength.

The remaining gap is architectural, not cosmetic:

| Layer | Current Apex | What oracle-level requires |
|-------|--------------|----------------------------|
| Objective | Deadwood proxies + handcrafted rules | **Expected match equity (EME)** |
| Uncertainty | Lightweight Bayesian weights / PIMC | **Public belief state + proper sampling** |
| Decisions | Decoupled draw / discard / knock | **Joint action search over full turn** |
| Endgame | Safety-weight scaling + MC knock | **Real-time subgame solving** |
| Learning | Mostly fixed heuristics | **Blueprint strategy + continual resolving** |

**Max-effort path:** stop treating Apex as an endless if-else refinement project. Harden the current champion as a **strong baseline and product opponent**, then climb a staged ladder: **parity → search → belief → match equity → subgame resolving → product distillation**.

Heuristic tuning still has some juice for the *product* bot (especially TypeScript parity). The *research* ceiling requires paradigm change.

---

## 1. Current Reality Map (Ground Truth)

### 1.1 Two different “Apex” systems exist

| System | Location | Role | Strength ceiling |
|--------|----------|------|------------------|
| **Product Apex** | `gin-galaxy/src/lib/ai.ts` | Human-facing AI in Gin Paradise | Mid-strong heuristic |
| **Research Apex** | `docs/archive/research/gin_rummy/apex.py` (and live `gin_rummy/` mirrors) | Tournament / benchmark baseline | Strong heuristic |
| **Shipped research champion** | `apex_mcts.py` (+ clinch/go-gin variants) | Strongest practical full-game bot | Heuristic + PIMC draw search |
| **Solver stack** | `solver_v2`…`v6`, `endgame_solver.py` | Low-stock analysis | Strong on knocks/endgame only |
| **CFR / value / action models** | `apex_cfr.py`, `value_model.py`, action models | Experiments | Partial / not fully shipped |

### 1.2 Feature parity audit (briefing vs code)

Your briefing describes the **research Apex** (with some product MET pieces). Actual status:

| Capability | Briefing claim | Research `apex.py` | Product `ai.ts` |
|------------|----------------|--------------------|-----------------|
| Meld-complete draw | Yes | Yes | Yes |
| Ace/Two insurance draw | Yes | Yes | Yes |
| DW reduction ≥4 draw | Yes | Yes | Yes |
| Triangle early draws | Yes | Yes | **Missing** |
| Low-DW doubles | (paper) | Yes | **Missing** |
| Defensive block draw | Yes | Yes (model-aware) | Partial (static danger ≥3) |
| Continuous discard scoring | Yes | Yes (heuristic phase) | Yes |
| Actual-DW discard verify | Implied / analysis doc | Yes (top-3 verify) | **Missing** |
| Bayesian opponent model | Yes | Yes (`OpponentModel`) | **Missing** |
| Model-weighted safety | Yes | Yes | Static blocked-set only |
| Endgame safety weights (stock ≤8) | Yes | Partial (turn decay, stock knock) | Yes (weights 10/5/300) |
| Full knock hierarchy | Yes | Yes (8-rule + MC) | Partial MET only |
| MC layoff knock gate | Yes | Yes (25 samples) | **Missing** (linear `pUndercut`) |
| Stock-depth knock override | Yes | Yes (≤8) | **Missing** |
| Turn early/late knock | Yes | Yes (≤3 / ≥13) | **Missing** |
| Match Equity Table | Yes | Exists in research MET | Yes (bilinear table) |
| MC draw search | (ApexMCTS) | ApexMCTS | **Missing** |

**Implication:** Product Apex is a **partial port**. Before oracle work, product strength jumps for free by porting research Apex faithfully.

### 1.3 Known strength ladder (research)

Approximate hierarchy from project status and audits:

1. **ApexMCTS family** (especially clinch/go-gin variants) — current practical champions  
2. **Apex** — strong baseline (~55–59% vs Heisenbot/DeepKnock class depending on suite)  
3. **Nexus / Titan / DeepKnock / Heisenbot** — competitive heuristics  
4. **CFR discard experiments** — historically failed when restricted to Apex candidate sets (~50% vs Apex)

### 1.4 Diagnosed failure modes (do not ignore)

1. **Deadwood is a proxy, not the objective.** DW 30→20 ≠ DW 12→8. Scorelines change optimal risk.  
2. **PIMC strategy fusion.** Sampled rollouts that “know” both hands overvalue speculative draws and understate information risk. Manual info penalties are a symptom.  
3. **Decoupled draw then discard.** True EV of a take depends on the forced discard after it.  
4. **Heuristic local maxima.** More rule branches yield diminishing returns and overfit bot-vs-bot quirks.  
5. **Evaluation noise.** Full-game win rate alone is too noisy for micro-improvements; need critical-spot suites.  
6. **Python speed.** Deep search / CFR needs a fast core (`gin-core` Rust path already started).

---

## 2. Strategic North Star and Success Metrics

### 2.1 Strength tiers (define “as strong as possible”)

| Tier | Name | Definition | Gate |
|------|------|------------|------|
| **T0** | Heisenbot-class | Paper heuristics | Baseline |
| **T1** | Product Apex (current) | Partial MET + safety | Human-facing |
| **T2** | Research Apex | Full rules + MC knock + model | Solid AI opponent |
| **T3** | ApexMCTS+ | Search-backed draw, best knock policy | Best shippable full-game bot |
| **T4** | Equity-search Apex | Joint draw/discard/knock search on EME | Superhuman vs heuristics |
| **T5** | Endgame-resolved Apex | Exact-ish subgames stock ≤12–15 | Near-unbeatable late game |
| **T6** | Oracle Apex | Blueprint CFR + continual resolving | XG/Pluribus-class analysis engine |

**Max-effort target:** reach **T5 in production-capable form**, with **T6 research engine** as the analysis / training teacher.

### 2.2 Primary metrics (always report these)

1. **Duplicate win rate** vs fixed opponents (seat-balanced, fixed seeds).  
2. **Mean score differential** (points/game).  
3. **Undercut rate** (self and inflicted).  
4. **Gin rate** and **knock success rate**.  
5. **Match win rate** from asymmetric score starts (0–0, 70–30, 85–50, 92–40).  
6. **Critical Situation Benchmark (CSB)** accuracy on mined hard spots.  
7. **Latency budgets:** product ≤50ms typical; analysis engine ≤2s; offline training unlimited.

### 2.3 Statistical discipline

| Experiment type | Minimum size | Purpose |
|-----------------|--------------|---------|
| Smoke | 200 games | Sanity |
| Candidate | 1,000 games seat-balanced | Ship/no-ship heuristic changes |
| Promotion | 4,000+ games | Promote champion |
| CSB branch eval | 500–2,000 playouts per spot | Micro EV |
| Match-equity table regen | ≥200 sims/bucket with strongest available policy | MET quality |

**Promotion rule:** a change ships only if it improves primary gate **and** does not regress undercut rate or asymmetric scoreline suites beyond noise.

---

## 3. Dual-Track Program Architecture

Run two tracks in parallel. Do not conflate them.

```
┌──────────────────────────────────────────────────────────────────┐
│ TRACK A — PRODUCT STRENGTH (weeks 0–6, continuous polish)        │
│ Goal: strongest playable AI in Gin Paradise under latency limits │
│ Output: ai.ts / server AI service, training/analysis agreement   │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│ TRACK B — ORACLE RESEARCH (months 1–12)                          │
│ Goal: match-equity / belief / resolving engine that teaches A    │
│ Output: blueprint, endgame solver, CSB, analysis API             │
└──────────────────────────────────────────────────────────────────┘
```

Track A makes Apex strong **now**.  
Track B makes Apex as strong as **possible**.  
Track B’s outputs distill back into Track A (policies, tables, endgame overrides).

---

# TRACK A — Product Apex Strength Ladder

## Phase A0 — Freeze Baselines and Instrumentation (Week 0)

**Goal:** Never fly blind again.

### Deliverables
1. **Canonical opponent set:** Heisenbot, Apex, ApexMCTS, ApexMCTSClinchOnlyGoGin, Random, Simple.  
2. **Canonical suites:**
   - `suite_h2h_0_0` — 2,000 games seat-balanced  
   - `suite_match_asymmetric` — starts at fixed score vectors  
   - `suite_undercut_stress` — mid DW 6–10 knock spots  
   - `suite_endgame_stock8` — force low stock  
3. **Decision logging:** every draw/discard/knock logs features + chosen action + alternatives.  
4. **Disagreement miner:** Apex vs ApexMCTS vs solver_v6 on same public states.  
5. **Product telemetry:** when humans play AI, store (public state, bot action) for later distillation (privacy-safe).

### Success criteria
- One command regenerates leaderboard tables.  
- Any PR can attach before/after numbers.

### Commands (research tree)
```bash
python benchmark.py --games 2000 --seed 20260711 --players Heisenbot,Apex,ApexMCTS
python -m pytest test_apex.py test_heisenbot.py test_mcts.py -q
```

---

## Phase A1 — Full Parity: Product Apex = Research Apex (Weeks 1–2)

**Highest product ROI.** The briefing’s agent is not fully in `ai.ts`.

### A1.1 Port missing policy pieces into `gin-galaxy/src/lib/ai.ts`

| Priority | Feature | Source of truth |
|----------|---------|-----------------|
| P0 | Turn-aware knock (early ≤3, late ≥13) | `apex.py` knock rules 5–6 |
| P0 | Stock-depth knock override (≤8) | `apex.py` rule 1b |
| P0 | Few-DW-cards hold (DW>5, ≤2 cards) | Already partial; align exactly |
| P0 | MC layoff knock gate (sample opponent hands) | `apex.py` MC block; start with simplified model |
| P1 | Triangle + doubles draw rules | `apex.py` |
| P1 | Actual-DW discard verification on top-K | `apex.py` discard phase 2 |
| P1 | Opponent model (pickups, declines, discards) | `opponent_model.py` |
| P1 | Model-weighted safety | `_safety_count` |
| P2 | Cycle prevention (`_last_discard`) | `apex.py` |
| P2 | Score-gap gin seeking (±22) | research Apex; reconcile with MET |

### A1.2 Architecture decision for product runtime

**Recommended:** keep client heuristics for offline/quick play, **and** add a server-side AI service that runs research Apex/ApexMCTS for ranked/premium difficulty tiers.

Reasons:
- Bayesian model + MC samples are awkward and slow in pure browser TS if deepened.  
- Server already has Python bridge (`server/analysis/pythonBridge.ts`).  
- Enables one strong codepath for training, coaching, and hard AI.

### A1.3 MET reconciliation

Today:
- Product MET is a coarse 10-point table in TS.  
- Research has empirical MET from strong self-play (`match_equity_table.py`, `match_equity_cache.json`).

**Action:** regenerate MET with current champion; export JSON; load same table in TS and Python. Kill divergent tables.

### Success criteria
- Product Apex matches research Apex on a **decision agreement suite** ≥95% on draw, ≥90% discard, ≥95% knock (allowing intentional latency simplifications only where documented).  
- Product Apex vs Heisenbot duplicate suite ≥ research Apex’s edge within 2pp.

---

## Phase A2 — Champion Policy Port: ApexMCTS Draw Search (Weeks 2–4)

Research already proved **draw is the highest-leverage imperfect-info action**. ApexMCTS ≈56.8% vs Apex.

### Deliverables
1. Port `draw_search.evaluate_draw_choice` to:
   - Python service (primary), and/or  
   - Fast TS approximation for client offline mode.  
2. Parameters to ship initially:
   - worlds: 30 (interactive), 80–150 (hard tier)  
   - depth: 2  
   - info penalty: calibrated, not hard-coded forever  
3. Weighted worlds using opponent model (v2 draw search path).  
4. Fallback to Apex heuristic when stock/unseen too thin or margin < threshold.

### Critical fix while porting
**Remove pure deadwood as the only objective.** Even a simple intermediate objective is better:

```
score = α * expected_hand_points
      + β * undercut_risk
      + γ * gin_chance
      + δ * match_equity_delta
      - λ * info_reveal_penalty
```

Start with α/β from MC layoffs; introduce MET δ immediately for score-aware tiers.

### Success criteria
- ApexMCTS (service) ≥ +3pp win rate vs product Apex.  
- Undercut rate does not worsen.  
- p95 latency: ≤80ms normal, ≤200ms hard tier on server CPU.

---

## Phase A3 — Knock Policy Unification (Weeks 3–5)

Knock is where Apex already shines (undercut collapse). Push it further.

### A3.1 Single knock decision stack (precedence)

1. Illegal if DW > 10  
2. Gin always  
3. Match-clinch knock (MET / target score)  
4. Endgame solver override if stock ≤ N and solver available  
5. Stock-depth aggression (≤8) — but **only if solver not available** or solver agrees  
6. MET equity gate (hold if EME drop > threshold)  
7. Opponent near match-point safety  
8. Early aggression / late preemption  
9. Few-card hold  
10. MC layoff EV with **belief-weighted samples**  
11. Default: legal knock if EV ≥ turn-sensitive threshold

### A3.2 Replace linear `pUndercut` in product

Product currently uses:
```
pUndercut ≈ min(0.8, (myDW - 2) * 0.08)
```
This ignores opponent pickups, known cards, and layoffs — the exact reason Heisenbot gets destroyed.

**Replace with:**
- Fast path: undercut estimator model (AUC ~0.75 already exists)  
- Strong path: MC samples from opponent model + `compute_layoffs`  
- Oracle path: endgame solver distribution

### A3.3 Ablate stock≤8 always-knock

Always knocking when stock ≤8 is strong vs bots that hang, but can throw away gin equity and force bad undercuts vs accurate defenders. Ablate:
- always knock  
- knock if MC EV ≥ 0  
- solver-only  
Pick winner on CSB + asymmetric suite.

### Success criteria
- Undercut rate ≤ research Apex on Heisenbot gauntlet.  
- No regression in mean score vs ApexMCTS self-play.

---

## Phase A4 — Discard Strength Beyond Heuristics (Weeks 4–6)

### A4.1 Exact remaining-DW primary objective
For every legal discard candidate (not only top-3 heuristic):
1. Compute true remaining deadwood.  
2. Rank by: `remaining_dw + safety_weight * danger - decline_bonus`.  
3. In endgame (stock ≤8): invert priorities — safety first, then DW.

### A4.2 Joint draw→discard evaluation
When considering taking the upcard, score:

```
EV(take) = best_discard_EV(hand + upcard) - info_cost
EV(stock) = E_c~stock[ best_discard_EV(hand + c) ]
```

This alone often beats independent draw rules.

### A4.3 What not to waste time on
- Coefficient fiddling of 100/30/15 without CSB  
- CFR discard restricted to Apex top candidates (already failed historically)

### Success criteria
- Discard disagreement with ApexMCTS falls; CSB mid-game pivot suite improves ≥1pp full-game equivalent.

---

## Phase A5 — Difficulty Tiers and Product Integration (Weeks 5–7)

Ship strength without one monolithic bot.

| Tier | Name | Policy | Latency |
|------|------|--------|---------|
| 1 | Social | Simple / Titan-light | <10ms |
| 2 | Club | Product Apex (full parity) | <30ms |
| 3 | Expert | ApexMCTS draw + MC knock | <100ms |
| 4 | Master | Equity search + endgame solver | <250ms |
| 5 | Analysis | Oracle teacher (offline / premium) | 1–5s |

Wire into:
- Play vs AI  
- Training mode agreement scoring (stop overselling “Apex v2” as oracle)  
- Replay evaluation / coaching (teacher = highest available tier)

### Messaging honesty
Training already notes heuristic approximation — keep that until T5/T6. Strength gains should not claim solved-game authority prematurely.

---

# TRACK B — Oracle Path (Maximum Possible Strength)

This is the true max-effort path. It follows poker (Pluribus) more than backgammon (XG).

## Phase B0 — Research Doctrine (Non-Negotiables)

1. **Objective = match equity**, not deadwood.  
2. **No full-game pure CFR without abstraction** — use blueprint + online resolving.  
3. **Never restrict solver action sets to heuristic candidates.**  
4. **Fix PIMC leakage** before scaling world counts.  
5. **Build CSB first**; use full-game WR as a held-out gate, not the only signal.  
6. **Autoresearch is allowed** only with fixed eval harness and statistical gates (Karpathy-style loops already exist under `oracle_autoresearch`).

---

## Phase B1 — Critical Situation Benchmark (CSB) Factory (Weeks 1–3)

**Highest leverage infrastructure investment.**

### Mine spots where decisions matter
Axes:
1. Wall depth: early / mid / endgame  
2. Info texture: wet (many pickups) vs dry  
3. Score asymmetry: ICM-like leverage  
4. Decision type: draw / discard / knock  
5. Danger class: known opponent meld threats

### Mining methods
1. Heavy search vs fast baseline disagreement.  
2. Near-ties: top-2 action EVs within 0.5% match equity.  
3. Undercut / gin border cases from self-play.  
4. Human-vs-bot blunders (once telemetry exists).

### Store both
- **Public state + belief prior** (no cheating)  
- **True hidden state + remaining stock order** (duplicate resolution)

### Canonical spot families (must-have)
1. Early Speculator — opponent takes first upcard; blocker vs points.  
2. Mid-Game Pivot — dry board, pair-break thresholds.  
3. Endgame Wall — stock ≤10; knock 8 vs defense.  
4. Asymmetric Push — 92–40 style clinch/hold.  
5. Layoff Trap — DW 7–10 with dense meld board.  
6. Info Poison — “unsafe” discard that pollutes inference.

### Success criteria
- ≥500 high-quality spots with stable labels.  
- Reproducible EV difference when branching policies on identical walls.

---

## Phase B2 — Belief Tracker 2.0 (Weeks 2–6)

Current `OpponentModel` is good for a heuristic bot; not enough for oracle sampling.

### Upgrade path
1. **Event graph:** pickup, decline, discard, pass, stock draw timing.  
2. **Negative inference:** declines must sharply cut neighbor probabilities.  
3. **Consistency constraints:** opponent hand size, known cards, impossible melds.  
4. **Calibration:** predicted card occupancy vs revealed hands at showdown (Brier score / log loss).  
5. **Optional sequence model:** transformer over public history → 52-d occupancy logits, trained on self-play traces.

### Sampling
- Replace naive MC with **belief-weighted without replacement** hands.  
- Add **diversity / ESS monitoring** so samples don’t collapse.  
- In endgame, switch to **enumeration or importance sampling** (solver_v6 path).

### Success criteria
- Endgame opp DW MAE competitive with solver_v6 (~2.5 or better).  
- Midgame calibration better than uniform prior by large margin.  
- Knock undercut prediction improves AUC over current estimator.

---

## Phase B3 — Match Equity as Universal Currency (Weeks 3–7)

### B3.1 Rebuild MET with strongest policy
- Self-play with current champion (not outdated bot).  
- Bucket size 5 (research) exported to product.  
- Store confidence intervals per bucket.

### B3.2 Value network V(state) → EME
Inputs:
- private hand features (melds, DW, near-melds, blockers)  
- public: discard sequence summary, stock depth, turn  
- scores / target  
- belief summary stats (entropy, known opp cards, threat scores)

Output:
- P(win match)  
- optional auxiliary: expected next-hand points, undercut prob, gin prob

Training data:
- ApexMCTS / stronger self-play trajectories labeled by eventual match winner  
- later: bootstrapped from deeper search

### B3.3 Replace leaf evaluation in search
Wherever MCTS/rollouts currently minimize deadwood, evaluate **ΔEME**.

### Success criteria
- Asymmetric scoreline suite: equity-aware bot crushes deadwood bot.  
- Trailing large deficits: higher gin attempt rate and better match WR.  
- Leading near clinch: lower undercut rate, more defensive discards.

---

## Phase B4 — Joint Turn Search (Weeks 5–10)

### Architecture
At decision time:

```
PublicBeliefState + PrivateHand
        │
        ▼
  Candidate generation (broad, not heuristic-only)
        │
        ▼
  Depth-limited search (2–3 plies)
        │
        ▼
  Leaf V(EME) / short rollouts
        │
        ▼
  Argmax action (draw+discard plan, knock boolean)
```

### Must include
1. **Draw and discard in one tree** (take implies specific discard plans).  
2. **Knock as first-class action** at every legal node.  
3. **Information-set consistency:** opponent strategy cannot depend on hero’s private cards (anti-PIMC).  
4. Prefer **IS-MCTS** or depth-limited **CFR resolving** over vanilla PIMC as soon as belief quality allows.

### Compute budgets
| Mode | Worlds / iterations | Depth | Target latency |
|------|---------------------|-------|----------------|
| Live Master | 64–128 | 2 | ≤250ms |
| Analysis | 512–2048 | 3 | ≤2s |
| Offline teacher | 10k+ | 3–4 | minutes/spot OK |

### Success criteria
- ≥58–60% vs ApexMCTS on 4k games.  
- CSB: wins majority of disagreement spots vs ApexMCTS.  
- Draw exploitability on early-speculator suite drops measurably.

---

## Phase B5 — Endgame Exactness (Weeks 6–12)

You already have the right skeleton (`endgame_solver.py`, solver v6).

### Push hard here — best “oracle feel” per engineering hour
1. Port hot path to **Rust `gin-core`** (meld, world gen, continuation).  
2. Extend real-time solving from stock ≤6–8 toward **≤12–15**.  
3. Use **meld-aware constructed worlds** + trace activation (v6 lessons).  
4. Continuation policy: upgrade from greedy DW to **blueprint-guided** or solved sub-policies.  
5. Output full outcome distribution: gin / knock-win / undercut / wall → MET.

### Product hook
When stock ≤10 (configurable), Master tier **must** call endgame solver for knock and discard safety.

### Success criteria
- stock ≤10 solve <100ms (Rust) or <300ms (optimized Python interim).  
- Undercut rate in endgame suite near floor vs heuristic attackers.  
- Opp DW prediction remains calibrated (bias near 0).

---

## Phase B6 — CFR Blueprint + Continual Resolving (Months 3–9)

This is the Pluribus template for **maximum possible** strength.

### B6.1 Abstraction design
- Hand buckets by meld structure + DW + blockers (not raw 10-card ids)  
- Suit isomorphisms with run-breakers  
- Timing phases (opening / mid / late)  
- Public texture buckets (wet/dry)  
- Score buckets for match play (or separate money-play blueprint + MET overlay)

### B6.2 Offline MCCFR
- External-sampling MCCFR in Rust  
- Disk-backed regrets if needed  
- Parallelize; track exploitability proxies  
- Extract average strategy blueprint

### B6.3 Online continual resolving
At real decisions:
1. Build local subgame from current belief ranges.  
2. Resolve 2–3 plies with CFR.  
3. Query value net / blueprint at leaves.  
4. Act according to resolved strategy (sampled or pure for analysis).

### B6.4 Explicit non-goals
- Do **not** re-run failed “CFR only on Apex top discards.”  
- Do **not** attempt AlphaZero-style perfect-info self-play as primary.  
- Do **not** claim Nash without exploitability measurement.

### Success criteria
- Blueprint alone competitive with champion (≥50–55%).  
- Blueprint + resolving ≥60% vs prior champion at 4k+ games.  
- Long-term: exploitability <0.5 points/hand on abstract game; analysis trust among strong humans.

---

## Phase B7 — Teacher Distillation into Product (Months 4–12, continuous)

Oracle that cannot run live still makes Apex stronger:

1. **Policy nets** for draw / discard / knock trained on teacher labels.  
2. **Opening book** for first 2–3 turns under common public textures.  
3. **Endgame override tables** for frequent public patterns.  
4. **Coaching / replay evaluation** uses teacher EV, not Apex-heuristic agreement.  
5. **Autoresearch** proposes only features/abstractions that pass CSB gates.

### Success criteria
- Distilled live bot recovers ≥80% of teacher’s edge vs Apex baseline under latency cap.  
- Training mode methodology upgrades from `apex_v2_engine_agreement` → `oracle_ev_agreement` when ready.

---

# 4. Cross-Cutting Engineering Workstreams

## 4.1 Rust core acceleration (`gin-core`)

Prioritize in order:
1. Card bitboards + exact melds/deadwood (parity-tested vs Python)  
2. Layoff computation  
3. World sampling / playout kernel  
4. Bindings for Python research and (optional) Node AI service  
5. CFR traversal primitives

Without this, B4–B6 will hit a wall.

## 4.2 Evaluation platform

Single module, e.g. `gin_rummy/eval/`:
- duplicate runner  
- CSB runner  
- MET generator  
- ablation harness  
- latency profiler  
- HTML/JSON report artifacts

Every strength claim in docs must link a report hash/seed.

## 4.3 Regression batteries (must never break)

- Meld optimality  
- Scoring: gin / undercut / layoff  
- Legal actions (no discard of restricted upcard)  
- Seat-balance invariance of harness  
- Determinism under fixed RNG seeds

## 4.4 Safety and product constraints

- No cheating: AI never sees opponent private cards.  
- Fairness commit-reveal remains authoritative in multiplayer.  
- Hard AI tiers may be premium-gated; analysis uses same engine as evaluator for trust.

---

# 5. Prioritized Work Queue (What to do first)

### Immediate (this sprint)
1. **A0 instrumentation + baselines**  
2. **A1 product↔research parity** (turn/stock knock, MC undercut, triangles, actual-DW discard)  
3. **MET single source of truth**  
4. **A3.2 kill linear pUndercut in product**

### Next (month 1)
5. **A2 ApexMCTS draw search service**  
6. **B1 CSB factory**  
7. **A4 joint draw→discard EV**  
8. **A5 difficulty tiers**

### Month 2–3
9. **B2 belief 2.0 calibration**  
10. **B3 value/EME leaves**  
11. **B5 endgame solver deepening + Rust hot path**  
12. Ablations on knock/endgame policies with CSB

### Month 3–9
13. **B4 joint IS search**  
14. **B6 blueprint CFR + resolving**  
15. **B7 distillation** into live Master tier + honest analysis

---

# 6. Ablation Matrix (Scientific Strength Climb)

Run these as controlled experiments; promote only winners.

| ID | Hypothesis | Control | Variant | Primary metric |
|----|------------|---------|---------|----------------|
| AB01 | Actual-DW discard beats heuristic-only | Apex | Apex+exactDW | WR vs Nexus/Heisenbot |
| AB02 | MC layoff knock beats linear pUndercut | Product Apex | MC knock | Undercut rate |
| AB03 | MET gate beats score-gap constants | Gap-22 rules | MET equity | Match WR asymmetric |
| AB04 | Stock≤8 always-knock is too blunt | Always | EV/solver gated | Endgame CSB EV |
| AB05 | Draw search worlds 30→100 | 30 | 100 | WR / latency |
| AB06 | Weighted belief worlds beat uniform | Uniform PIMC | Weighted | Draw CSB |
| AB07 | Joint draw-discard beats decoupled | Decoupled | Joint | WR + CSB |
| AB08 | EME leaves beat DW leaves | DW MCTS | EME MCTS | Asymmetric match WR |
| AB09 | Endgame solver overrides heuristics | ApexMCTS | +solver@≤10 | Undercut + EV |
| AB10 | Distilled policy retains teacher edge | Teacher | Student@50ms | Edge retention % |

---

# 7. What NOT to Do (Anti-Plan)

1. **Do not** spend months adding more special-case rules to Apex’s knock tree without CSB proof.  
2. **Do not** treat full-game win rate alone as acceptance for tiny changes.  
3. **Do not** re-attempt full-game CFR with tiny action spaces.  
4. **Do not** scale PIMC world counts without fixing information leakage.  
5. **Do not** optimize only vs Heisenbot — it overfits undercut-prone knock trees.  
6. **Do not** claim oracle/analysis authority from Apex-heuristic agreement.  
7. **Do not** ship Master-tier search in the browser without a latency/quality budget.  
8. **Do not** diverge product MET and research MET.  
9. **Do not** “fix” strength by weakening opponents in training mode.  
10. **Do not** ignore match score — money-play optimal ≠ match-play optimal.

---

# 8. Resource Model

### People / agent bandwidth
- **Track A owner:** product parity, AI service, tiers, latency  
- **Track B owner:** CSB, belief, search, solver, CFR  
- **Eval owner:** harness integrity (can be shared)

### Compute
- Dev: multi-core CPU for 1k–4k game suites  
- Training: offline self-play + MCCFR (can start CPU-only; scale later)  
- Optional GPU: value/belief nets (helpful, not mandatory early)

### Dependencies
- Python research tree remains source of truth for strength.  
- Rust `gin-core` becomes mandatory for T5/T6.  
- Node/Express AI route for product hard tiers.  
- Existing autoresearch loop for candidate generation **after** eval gates are solid.

---

# 9. Milestone Scoreboard

| Milestone | When | Strength tier | Proof |
|-----------|------|---------------|-------|
| M1 Parity | +2 weeks | T2 product | Decision agreement ≥95/90/95; Heisenbot edge restored |
| M2 Search | +4 weeks | T3 | ≥+3pp vs Apex; undercut not worse |
| M3 CSB+EME | +8 weeks | T4-proto | Asymmetric match suite wins; CSB majority |
| M4 Endgame | +12 weeks | T5-proto | stock≤10 solver live; undercut floor |
| M5 Blueprint | +6 months | T5–T6 | ≥60% vs prior champion @4k |
| M6 Distill | +9–12 months | T5 live | Student retains ≥80% teacher edge under latency |

---

# 10. Concrete First Implementation Spec (Start Here)

If only one sequence is executed, do this:

### Sprint 1 — Truth and Parity
1. Add `scripts/apex_baseline_report.py` (or extend `benchmark.py`) producing JSON: WR, score Δ, undercuts, gins.  
2. Port to `ai.ts`:
   - stock remaining into `shouldKnock`  
   - early/late turn rules  
   - few-card hold aligned with research  
   - top-K actual-DW discard selection  
   - triangle draw  
3. Port minimal opponent model + MC knock samples (even 15–25 uniform-over-unknown is better than linear pUndercut).  
4. Export research MET JSON → product import.  
5. Run 2,000-game Apex(product-logic-in-Python-port) vs Heisenbot and vs research Apex for parity.

### Sprint 2 — Search Service
1. Wrap ApexMCTS in a local HTTP/stdio service.  
2. Expert tier in GameRoom calls service when available; falls back to TS Apex.  
3. Log disagreements for CSB seeding.

### Sprint 3 — CSB + Endgame Hook
1. Mine 100 knock disagreements and 100 draw disagreements.  
2. Attach solver_v6 / endgame_solver for stock≤8 knocks in Master path.  
3. Publish first honest strength report.

---

# 11. Expected Strength Gains (Order-of-Magnitude)

These are planning estimates, not guarantees — validate with suites.

| Work | Expected full-game impact vs current product Apex | Confidence |
|------|---------------------------------------------------|------------|
| Full research parity | +3 to +8pp vs weak bots; large undercut drop | High |
| ApexMCTS draw search | +2 to +5pp vs Apex | High (already observed in research) |
| Joint draw–discard + better knock EV | +1 to +3pp | Medium |
| EME / asymmetric score play | Small money WR; large match WR swing | High for match play |
| Endgame solver | Big undercut/EV in late game; +1 to +3pp overall | Medium-High |
| Blueprint + resolving | +5 to +15pp vs current champion long-term | Medium (execution risk) |
| Pure heuristic coefficient thrash | ~0 to +1pp, often noise | Low value |

---

# 12. Final Doctrine

**Apex becomes as strong as possible by changing what it optimizes and how it searches — not by writing the 47th knock heuristic.**

1. **Baseline ruthlessly** (duplicate + CSB).  
2. **Parity** so product is not a weak cousin of research.  
3. **Search the draw and the full turn** with belief-weighted worlds.  
4. **Price every decision in match equity.**  
5. **Solve the endgame for real.**  
6. **Learn a blueprint; resolve online.**  
7. **Distill** into latency-bounded product tiers.  
8. **Tell the truth** in analysis: heuristic agreement ≠ oracle until T5/T6.

That is the complete max-effort plan: a shippable strength climb for Gin Paradise in weeks, and an oracle-class engine in months — with every promotion gated by measurement rather than narrative.

---

## Appendix A — Key Code Anchors

| Component | Path |
|-----------|------|
| Product Apex | `gin-galaxy/src/lib/ai.ts` |
| Research Apex | `docs/archive/research/gin_rummy/apex.py` |
| Opponent model | `docs/archive/research/gin_rummy/opponent_model.py` |
| ApexMCTS | `docs/archive/research/gin_rummy/apex_mcts.py` |
| Draw search | `docs/archive/research/gin_rummy/draw_search.py` |
| Endgame solver | `docs/archive/research/gin_rummy/endgame_solver.py` |
| MET | `docs/archive/research/gin_rummy/match_equity_table.py` |
| Solvers v2–v6 | `docs/archive/research/gin_rummy/solver_v*.py` |
| Benchmark entry | `benchmark.py` |
| Oracle autoresearch | `docs/archive/research/oracle_autoresearch/` |
| Prior improvement notes | `apex_improvement_analysis.md` |
| Oracle architecture essay | `Building an Oracle Gin Rummy Engine.md` |
| CFR/oracle roadmap | `ORACLE_ROADMAP_ASSESSMENT.md` |
| Python bridge (product) | `gin-galaxy/server/analysis/pythonBridge.ts` |

## Appendix B — Mapping Briefing Pillars → Plan Phases

| Briefing pillar | Keep / upgrade | Plan phases |
|-----------------|----------------|-------------|
| Draw: predictive & defensive | Keep rules as fallback; search overrides | A1, A2, A4, B4 |
| Discard: continuous + endgame safety | Keep as proposal policy; exact DW + joint EV | A1, A4, B4, B5 |
| Knock: MET + MC gate | Keep hierarchy; replace weak pUndercut; add solver | A1, A3, B3, B5 |
| Bayesian opponent model | Keep; rebuild as calibrated belief tracker | A1, B2 |
| Undercut resistance | Preserve as sacred regression metric | All phases |

---

*End of plan.*
