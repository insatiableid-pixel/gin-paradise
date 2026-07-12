# Claude Directive 79: Make Antigravity Actually Generate The Candidates

## Mission

Phase 78 improved the Oracle loop in one real way:

- it now benchmarks actual edited versions of `train.py`
- discard restoration was proven

But it still does **not** satisfy the core requirement we asked for:

> Antigravity should be the thing proposing the candidate edits

Right now the candidate edits still come from a hard-coded `SEARCH_AGENDA` inside `agent_loop.py`.
That is better than monkey-patching, but it is still a scripted local search agenda, not true runtime agent generation.

Phase 79 is therefore a **corrective integration phase**.

The goal is to make Antigravity the actual source of candidate `train.py` diffs.

---

## Why Phase 78 Is Not Enough

Phase 78 over-claimed in two important ways:

1. `agent_prompt.md` exists, but the loop does not actually read and use it to generate candidates at runtime
2. the loop still selects edits from a static `SEARCH_AGENDA` rather than asking Antigravity for the next code change

So the system is currently:

- real file editing
- real benchmarking
- real keep/discard

but still only **pseudo-agent-driven** candidate generation.

---

## Core Principle

This phase is about replacing scripted candidate supply with real agent-generated candidate supply.

The rule is:

> the next candidate diff must come from Antigravity at runtime, not from a prewritten list in Python

---

## Hard Constraints

1. **Do not break benchmark integrity.**
   The eval set remains frozen.

2. **Do not let the agent edit `prepare.py`.**
   `train.py` remains the research surface.

3. **Do not fake prompt usage.**
   `agent_prompt.md` must actually participate in candidate generation.

4. **Do not keep relying on a static agenda as the primary source of edits.**
   A seed prior is allowed, but runtime candidate generation must be real.

5. **Do not lose the good Phase 78 behavior.**
   Keep real file edits, real subprocess benchmarking, and real discard restoration.

6. **Do not require a fresh directive after each experiment.**

---

## Task A: Replace Static SEARCH_AGENDA With Runtime Candidate Generation

Refactor the loop so that candidate edits are generated at runtime from Antigravity.

That means:

- `agent_prompt.md` must be read
- current incumbent context must be provided
- recent experiment history should be available
- the next candidate diff must be produced by the Antigravity path, not selected from a fixed Python list

If you keep a seed prior, that is fine, but it must become context for generation, not the whole generator.

---

## Task B: Make The Antigravity Interface Explicit

Implement the smallest honest integration that makes this true.

Possible shapes include:

- direct Antigravity invocation from the loop
- a file-based request/response bridge
- a prompt + patch exchange directory
- another minimal adapter that genuinely puts Antigravity in the generation loop

But the report must be able to say, concretely:

- what request was sent
- what response came back
- how that response became a `train.py` diff

---

## Task C: Log Prompt/Response Provenance

Every real candidate should now have durable provenance.

At minimum log:

- prompt/context identifier
- raw or normalized Antigravity response
- resulting diff
- benchmark result
- keep/discard decision

The point is not verbosity.
The point is to prove the candidate really came from Antigravity.

---

## Task D: Preserve Safe Revert Behavior

Do not regress the good part of Phase 78.

After a losing candidate:

- `train.py` must be restored to the incumbent
- restore must still be verifiable

If a generated candidate is malformed or unusable, the loop must discard it cleanly and continue.

---

## Task E: Prove Real Agent-Generated Candidates

Run a bounded proof with at least:

1. one Antigravity-generated candidate diff
2. one completed benchmark on that diff
3. one logged keep/discard decision
4. one durable prompt/response record showing candidate provenance

If possible, demonstrate multiple generated candidates.

But the minimum proof must show that the candidate was not pre-scripted inside Python.

---

## Task F: Keep The Search Grounded In Current Evidence

Use the Phase 77/78 findings as prior context for the agent:

- trace-confidence behavior is promising
- mixed continuation is weak / near-neutral
- aggressive trace decay is harmful
- the incumbent around 0.5873 is hard to beat

That prior should guide generation, but it must not be the same thing as hard-coding the next ten edits.

---

## Required Deliverables

Produce:

1. the corrected Antigravity-driven candidate-generation loop
2. any adapter / bridge files needed for real runtime generation
3. durable provenance logs for generated candidates
4. a bounded proof run with actual Antigravity-generated diffs
5. `phase79_results.json`
6. `EXECUTION_REPORT_79.md`

---

## Required Truthfulness

In `EXECUTION_REPORT_79.md`, answer these plainly:

1. Is candidate generation now truly runtime-generated, or still scripted?
2. What exact file or process sends the request to Antigravity?
3. What exact file or process receives the response?
4. How is `agent_prompt.md` actually used now?
5. Was at least one non-pre-scripted candidate diff benchmarked?
6. Was discard restoration still proven after the integration change?
7. Did any real Antigravity-generated candidate improve on the incumbent?
8. What still remains before overnight unattended operation is trustworthy?

---

## What Not To Do

Do **not**:

- report another fixed Python candidate list as “agent generation”
- leave `agent_prompt.md` unused
- replace runtime generation with a cosmetic wrapper around the same scripted edits
- spend the phase manually tuning by hand outside the loop

---

## Success Condition

The strongest outcome for Phase 79 is:

> the Oracle loop now gets its next candidate diff from Antigravity at runtime, benchmarks that real generated diff, and keeps or discards it honestly without needing a fresh directive for each experiment

If generation is still partly scripted, say so clearly.
