# Apex Sprint 1 Completion Report

**Date:** 2026-07-11  
**Plan:** `APEX_MAX_STRENGTH_PLAN.md` → Sprint 1 (Truth & Parity)  
**Status:** **COMPLETE**

---

## Objective

Execute the first max-strength sprint:

1. Baseline report harness (JSON: WR, score Δ, undercuts, gins)
2. Port research Apex policies into product `ai.ts`
3. Shared Match Equity Table export
4. Wire GameRoom score / stock / turn / opponent-model context
5. Document results at repo root

---

## Deliverables

| Item | Path | Status |
|------|------|--------|
| Baseline harness | `scripts/apex_baseline_report.py` | ✅ |
| MET export tool | `scripts/export_match_equity_table.py` | ✅ |
| Shared MET JSON | `data/match_equity_table.json` | ✅ |
| Product MET JSON | `gin-galaxy/src/lib/data/match_equity_table.json` | ✅ |
| Product Apex v2.1 | `gin-galaxy/src/lib/ai.ts` | ✅ |
| GameRoom wiring | `gin-galaxy/src/pages/GameRoom.tsx` | ✅ |
| Unit tests | `gin-galaxy/tests/apex-ai.test.ts` | ✅ (10/10 pass) |
| Baseline JSON | `data/apex_baseline_report.json` | ✅ |
| Max-strength plan | `APEX_MAX_STRENGTH_PLAN.md` | ✅ (prior) |

---

## Baseline Results (Research Apex vs Heisenbot)

**Command:**

```bash
python scripts/apex_baseline_report.py --players Apex,Heisenbot --games 150 --seed 20260711
```

**Methodology:** seat-balanced duplicate (each deal played twice with seats swapped) → **300 games**.

| Metric | Apex | Heisenbot |
|--------|------|-----------|
| Wins | **165** | 135 |
| Win rate | **55.00%** | 45.00% |
| 95% CI (Wilson) | 49.3% – 60.5% | 39.5% – 50.7% |
| Avg score | **86.19** | 78.28 |
| Score Δ | **+7.90** | — |
| Gins | 53 | 206 |
| Undercuts | **15** | **201** |
| Undercut / game | 0.05 | 0.67 |
| Void hands | 0 | 0 |

These numbers **exactly match** the executive briefing (165–135, +7.91 ppg, 15 vs 201 undercuts) under seed `20260711` with 150 deals.

Full machine-readable report: `data/apex_baseline_report.json`.

---

## Product Parity Changes (`gin-galaxy/src/lib/ai.ts`)

Upgraded from partial Apex to **Apex v2.1 (Sprint 1)**:

### Draw
- Meld-complete take
- Ace / Two insurance
- DW reduction ≥ 4
- **Triangle formation** (early game, turn &lt; 6)
- **Low-DW doubles** (turn &lt; 10)
- **Defensive block** (model-aware + static fallback)
- **Cycle prevention** (don’t re-take last discard)

### Discard
- Continuous scoring with endgame safety weights (stock ≤ 8 → 10/5/300)
- **Top-K actual deadwood verification** (K = 3)
- Decline bonus + model-weighted safety when session model is live

### Knock
- Gin always
- **Stock-depth override** (stock ≤ 8 → knock if legal)
- Match clinch via expected points
- **Score-gap gin seeking** (±22)
- **MET equity gate** from shared JSON (no hardcoded divergent table)
- **MC layoff undercut estimation** (25 samples) — **linear `pUndercut` removed**
- Early aggression (turn ≤ 3), late preemption (turn ≥ 13)
- Few-DW-card hold
- **MC knock EV** with turn-sensitive threshold

### Opponent model
- New `OpponentModel` + `ApexSession` for pickup / decline / discard tracking
- Weighted sampling for MC knock hands

### MET
- Single source: research `match_equity_cache.json` → exported JSON
- Bilinear interpolation over bucket size 10
- Product imports `gin-galaxy/src/lib/data/match_equity_table.json`

---

## GameRoom Integration

- Bot display name: **Apex**
- Passes **0-based turn**, **stockRemaining**, scores into every decision
- Session model updates on human draw/discard/knock
- Resets model each deal / next round

---

## Verification

```bash
# Product
cd gin-galaxy
npm run typecheck          # clean
npx vitest run tests/apex-ai.test.ts   # 10/10 pass

# Research baseline
python scripts/export_match_equity_table.py
python scripts/apex_baseline_report.py --players Apex,Heisenbot --games 150 --seed 20260711
```

Lint: unused-import errors fixed on `ai.ts`. Complexity warnings remain on large decision functions (expected for heuristic policy trees; not gating).

---

## Known Gaps (Intentionally Out of Sprint 1 Scope)

These remain for Sprint 2+ (see max-strength plan):

1. **Product AI is still pure TypeScript heuristics** — no ApexMCTS draw search service yet.
2. **Decision agreement suite** (product vs research on identical spots) not automated; policy ported by hand.
3. **MC samples use Math.random** in product (non-deterministic); fine for play, not for bit-identical replay.
4. **Root `gin_rummy/` package is partial** — research codepath is `docs/archive/research/gin_rummy` (harness sets `sys.path`).
5. **Master tier / endgame solver / EME value net** — later phases.

---

## How to Re-run / Extend

```bash
# Larger promotion suite (recommended before claiming further strength)
python scripts/apex_baseline_report.py --players Apex,Heisenbot,Nexus --games 1000 --seed 20260711

# Include MCTS champion when available
python scripts/apex_baseline_report.py --players Apex,ApexMCTS,Heisenbot --games 200

# Refresh MET after regenerating research cache
python scripts/export_match_equity_table.py
```

---

## Next Sprint (Sprint 2 preview)

From `APEX_MAX_STRENGTH_PLAN.md`:

1. ApexMCTS draw-search **server service** for Expert tier  
2. Critical Situation Benchmark (CSB) miner from Apex vs ApexMCTS disagreements  
3. Joint draw→discard EV evaluation  
4. Optional: seed product MC with fixed RNG for deterministic tests  

---

## Summary

Sprint 1 is **done**. Product Apex is no longer a weak cousin of research: it has MET parity, stock/turn knock rules, triangle draws, actual-DW discard selection, opponent modeling, and Monte Carlo layoff-aware knocking. Research baseline is instrumented and reproduces the published 55% / 15-undercut edge over Heisenbot.

*End of report.*
