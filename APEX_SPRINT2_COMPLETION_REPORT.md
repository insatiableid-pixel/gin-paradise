# Apex Sprint 2 Completion Report

**Date:** 2026-07-11  
**Plan:** `APEX_MAX_STRENGTH_PLAN.md` → Sprint 2 (Search Service + CSB)  
**Status:** **COMPLETE**  
**Depends on:** Sprint 1 (`APEX_SPRINT1_COMPLETION_REPORT.md`)

---

## Objective

1. Wrap **ApexMCTS** draw search as a local AI decision service (stdio + optional HTTP)
2. Ship **Expert tier** in Gin Paradise (service with Club/TS Apex fallback)
3. Mine **CSB draw disagreements** (Apex heuristic vs MC search)
4. Add **joint draw→discard EV** snapshot (service + Club helper)
5. Document at repo root

---

## Deliverables

| Item | Path | Status |
|------|------|--------|
| ApexMCTS decision service | `scripts/apex_ai_service.py` | ✅ |
| CSB disagreement miner | `scripts/mine_csb_disagreements.py` | ✅ |
| Server bridge | `gin-galaxy/server/analysis/apexAiBridge.ts` | ✅ |
| API routes | `gin-galaxy/server/routes/apexAi.ts` | ✅ |
| Route registration | `gin-galaxy/server.ts` → `/api/ai/*` | ✅ |
| Client | `gin-galaxy/src/lib/apexServiceClient.ts` | ✅ |
| Expert/Club preference | `gin-galaxy/src/lib/preferences.ts` | ✅ |
| GameRoom Expert wiring | `gin-galaxy/src/pages/GameRoom.tsx` | ✅ |
| Joint EV helper (Club) | `evaluateJointDrawDiscard` in `ai.ts` | ✅ |
| Unit + bridge tests | `tests/apex-ai*.test.ts` | ✅ 14/14 |
| CSB dataset | `data/csb_disagreements.json` | ✅ |
| Apex vs ApexMCTS baseline | `data/apex_mcts_baseline_sprint2.json` | ✅ |

---

## Architecture

```
GameRoom (aiTier=expert)
    │  POST /api/ai/decide
    ▼
apexAi.ts  ──►  apexAiBridge.ts  ──spawn──►  scripts/apex_ai_service.py
                                                    │
                                                    ├─ draw  → ApexMCTS + draw_search
                                                    ├─ discard → research Apex
                                                    └─ knock   → research Apex
    │
    └─ on failure / timeout → Club (local TS Apex v2.1)
```

### API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/ai/health` | Service availability |
| `POST` | `/api/ai/decide` | `{ action: "draw"\|"discard"\|"knock", hand, ... }` |

### Tiers (Settings panel)

| Tier | Behavior |
|------|----------|
| **Club** | Local TypeScript Apex (Sprint 1) — instant |
| **Expert** | Python ApexMCTS search for draw (+ research Apex discard/knock); falls back to Club |

Default preference: **Expert** (with automatic Club fallback if Python/research stack unavailable).

---

## CSB Mining Results

**Command:**

```bash
python scripts/mine_csb_disagreements.py --games 20 --seed 20260712
```

| Metric | Value |
|--------|------:|
| Games (ApexMCTS self-play) | 20 |
| Draw searches | 2,509 |
| Strong overrides (margin ≥ 0.5) | **379** |
| Weak disagreements | 26 |
| Agreements | 2,104 |
| **Override rate** | **15.11%** |
| Spots written | 405 |
| Elapsed | ~49s |

**Interpretation:** On ~1 in 6 searchable draws, MC search **overrides** the Apex heuristic with material margin. That is the highest-leverage Expert-tier edge and the seed set for Critical Situation Benchmarks.

Example weak disagreement (opening texture): Apex wants discard, search prefers stock — classic info-vs-value tension.

Full dump: `data/csb_disagreements.json`.

---

## Research Baseline: Apex vs ApexMCTS

**Command:**

```bash
python scripts/apex_baseline_report.py --players Apex,ApexMCTS --games 40 --seed 20260712
```

| Metric | Apex | ApexMCTS |
|--------|-----:|---------:|
| Wins (80 games) | 31 | **49** |
| Win rate | 38.75% | **61.25%** |
| Avg score Δ (Apex) | **−12.72** | — |
| Undercuts | 25 | 29 |

**Note:** N=80 is a **smoke promotion sample**, not a 4k-game claim. Direction matches historical shipping claims (~56–57% ApexMCTS vs Apex). Expert tier is justified.

Full JSON: `data/apex_mcts_baseline_sprint2.json`.

---

## Service Smoke

```bash
# Health
echo {"action":"health"} | python scripts/apex_ai_service.py

# Draw (meld-complete 7♣) — returns source=discard, joint_immediate delta, search EVs
python scripts/apex_ai_service.py --request <json>

# Optional long-running HTTP mode
python scripts/apex_ai_service.py --http --port 8765
```

Draw smoke (seed 42, 20 worlds): **discard** in ~34ms, `take_ev=27.2` vs `stock_ev=34.15`, joint immediate DW drop 43→33.

---

## Verification

```bash
# Research service + CSB
python scripts/apex_ai_service.py   # pipe health JSON
python scripts/mine_csb_disagreements.py --games 20 --seed 20260712

# Product
cd gin-galaxy
npm run typecheck
npx vitest run tests/apex-ai.test.ts tests/apex-ai-service.test.ts
```

**Results this sprint:** typecheck clean; **14/14** tests passed (11 unit + 3 bridge).

---

## Product UX

- Settings → **Apex AI Tier**: Club | Expert  
- Expert path logs Club-vs-Expert draw disagreements client-side (`logDrawDisagreement`) for future CSB export  
- Bot still named **Apex**; Expert is stronger when the service is up  

---

## Joint Draw→Discard EV

| Layer | Implementation |
|-------|----------------|
| Expert service | Full MC rollouts + best discard after take/stock (`draw_search`) + `joint_immediate` snapshot |
| Club TS | `evaluateJointDrawDiscard()` — immediate best-remaining-DW comparison (no rollouts) |

This closes the Sprint-1 gap where draw and discard were fully decoupled on the product path for Expert tier.

---

## Known Gaps / Next Sprint Hooks

1. **Per-request process spawn** — Expert starts a Python process each decision (~30–100ms+). Persistent HTTP worker (`--http`) or long-lived child process would cut latency further.  
2. **Opponent model events** not yet fully streamed from GameRoom into `/api/ai/decide` (API supports `events[]`; client can be extended).  
3. **CSB** currently draw-only; knock/discard disagreements still to mine.  
4. **Promotion baseline** Apex vs ApexMCTS at ≥1000 deals recommended before claiming full +3pp edge in product.  
5. Sprint 3 candidates: endgame solver hook, EME leaves, disagreement branch evaluation on fixed walls.

---

## Commands Cheat Sheet

```bash
# Expert service (stdio)
echo {"action":"health"} | python scripts/apex_ai_service.py

# CSB mine
python scripts/mine_csb_disagreements.py --games 40 --seed 20260712

# Research H2H
python scripts/apex_baseline_report.py --players Apex,ApexMCTS --games 100 --seed 20260712

# Persistent HTTP (optional)
python scripts/apex_ai_service.py --http --port 8765
```

Env knobs (Node bridge):

- `PYTHON_PATH` — Python executable  
- `APEX_AI_TIMEOUT_MS` — default 2500  

---

## Summary

Sprint 2 is **done**. Expert-tier Apex can call **ApexMCTS draw search** through a real service, falls back safely to Club Apex, and we now have a **405-spot CSB seed** showing a **15% override rate** — hard evidence that search moves play off the pure heuristic path. A 80-game smoke baseline shows **ApexMCTS at 61% vs Apex**, confirming the Expert path is the right strength ladder.

*End of report.*
