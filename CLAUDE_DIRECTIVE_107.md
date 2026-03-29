# Directive 107 - Oracle Multi-Lane Proxy Benchmark Sprint

## Objective
Upgrade `oracle_autoresearch` from a single narrow low-stock knock/continue sandbox into a broader, paper-aligned multi-lane Oracle proxy lab with explicit Gin Rummy information-state abstractions, a wider held-out evaluation suite, and one honest aggregate promotion score.

## Why This Sprint
The current Oracle lab is valuable, but it is still optimizing one narrow slice of strength. The attached paper, *Discovering Multiagent Learning Algorithms with Large Language Models*, does **not** argue for one giant monolithic objective from day one. It evolves constrained algorithm families inside bounded search spaces and evaluates them on proxy benchmarks / broader held-out suites. That is the right lesson for Gin Rummy.

For Gin, full raw-state tabular solving is intractable. We therefore need the next stage to be:
- broader than the current single knock lane,
- still explicit and reviewable,
- still constrained enough for autoresearch to make measurable progress.

This sprint should move the lab toward that middle path: not “one tiny lane forever,” and not “pretend we can already solve all of Gin Rummy in one unified tabular objective.”

The latest bounded Gemini exploitation block confirms this is now the right time:
- the incumbent did improve from `0.6243` to `0.6293`,
- but the only gain was a narrow threshold-edge calibration move (`CALIBRATION_MAX_WORLDS: 100 -> 150`, delta `+0.005`),
- and the remaining 11 experiments mostly collapsed into repeated calibration variants that lost badly.

Treat that as evidence that the current single-lane sandbox is still useful but becoming locally saturated. The next leverage move is to broaden the held-out suite, not to keep grinding the same calibration knob family.

## Required Deliverables
1. Introduce a shared, explicit Oracle abstraction layer for Gin proxy states, using repo-evidenced features and the user-provided strategy direction:
   - deadwood bucket,
   - meld count,
   - combination / layoff potential bucket,
   - upcard utility / extension / risk flags where applicable,
   - opponent memory abstraction derived from observed pickups / dangerous ranks or runs,
   - deck phase bucket.
2. Preserve the current narrow-lane winner as the baseline starting point for the broader suite:
   - keep the current incumbent behavior intact,
   - carry forward the live frontier assumptions around `DIRECT_EVAL_WEIGHT = 0.90`,
   - treat `CALIBRATION_MAX_WORLDS = 150` and `CALIBRATION_FRACTION = 0.15` as the stable incumbent baseline unless broader-lane evidence says otherwise.
3. Expand `oracle_autoresearch` into a **multi-lane** proxy benchmark instead of one narrow lane. Preserve the existing low-stock knock/continue lane, and add at least **two** more frozen held-out decision surfaces chosen from repo-evidenced Oracle problems, such as:
   - draw source decision (`discard` vs `stock`),
   - discard safety / discard selection,
   - broader knock windows across deck phases.
4. Keep the search space honest and constrained:
   - prefer explicit evolvable decision components or weighting logic over unconstrained whole-engine mutation,
   - keep `train.py` as the primary editable file if feasible,
   - if supporting scaffolding must change, freeze and document it clearly.
5. Replace the current narrow single-score promotion story with:
   - per-lane metrics,
   - one aggregate promotion score,
   - an honest distinction between optimization-time proxy measurement and the final broader held-out evaluation used for promotion.
6. Reuse existing repo evidence and data-generation pathways wherever possible. Do **not** invent magical labels by hand if the repo already contains generators, cached references, replay/evaluator infrastructure, or action-model tooling that can ground these lanes.
7. Update `oracle_autoresearch/program.md`, `oracle_autoresearch/agent_prompt.md`, and `oracle_autoresearch/README.md` so they now describe a broader multi-lane Oracle proxy lab inspired by the paper’s constrained-search / proxy-benchmark approach.
8. Add `EXECUTION_REPORT_107.md` in the repo root describing:
   - what benchmark lanes now exist,
   - what abstractions were introduced,
   - what remains intentionally out of scope,
   - how the new aggregate evaluation was verified.

## Constraints
- Do **not** over-claim full unified Gin Rummy solving or “eXtreme Gammon for gin” in this sprint.
- Do **not** remove or weaken the existing low-stock knock benchmark; it should become one lane inside the broader suite.
- Keep abstractions explicit, interpretable, and reviewable.
- Do **not** jump to an opaque neural-embedding rewrite in this sprint.
- Keep runtime bounded enough that the lab remains practical for iterative autoresearch.
- Prefer broader held-out evaluation over a superficially larger but noisier search target.
- Do **not** spend this sprint on another narrow calibration sweep. The latest run already showed that `CALIBRATION_FRACTION > 0.15` and aggressive `CALIBRATION_MAX_WORLDS` expansion are mostly a sink.

## Verification
Run, at minimum:
- `python oracle_autoresearch/prepare.py`
- `python oracle_autoresearch/train.py --time-budget 60 --tag directive107_smoke`
- `python oracle_autoresearch/agent_loop.py --bridge-provider gemini --bridge-mode fallback_only --max-experiments 1 --dry-run`

If the environment requires the local Python path, use the repo’s existing `.local-python\3.14\python.exe`.

## Completion Criteria
This sprint is complete when `oracle_autoresearch` has moved from a single narrow knock lane to a broader multi-lane proxy Oracle benchmark with explicit Gin abstractions, aggregate promotion scoring, updated docs, and a root execution report that honestly states both the gain and the remaining gap to a truly unified Gin super-oracle.
