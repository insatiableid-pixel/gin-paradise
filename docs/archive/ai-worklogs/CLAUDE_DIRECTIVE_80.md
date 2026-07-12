# Claude Directive 80: Put A Real Claude-In-Antigravity Boundary In The Loop

## Mission

Phase 79 made one real improvement:

- candidate generation is now runtime-generated instead of coming from a fixed Python list

But it still did **not** satisfy the core requirement:

> the loop should send context to **Claude Opus 4.6 running in Antigravity**, receive back a candidate `train.py` edit, and then benchmark that returned edit

Right now, `candidate_generator.py` is still a local heuristic engine inside this repo.
It reads `agent_prompt.md`, hashes it, and runs internal strategy functions.
That is runtime generation, but it is **not** a real Claude-in-Antigravity request/response loop.

Phase 80 is therefore a **corrective integration phase**.

The goal is to insert a real external **Claude-in-Antigravity generation boundary** into the Oracle autoresearch loop.

---

## Why Phase 79 Is Not Sufficient

Phase 79 over-claimed in two important ways:

1. it described the local generator as “Antigravity-driven,” even though the code only runs internal Python strategies
2. it claimed `agent_prompt.md` was used as generation context, but in practice it is primarily hashed/provenanced rather than semantically consumed by an external agent

The loop is now:

- real file editing
- real runtime generation
- real benchmarking
- real discard restoration

But candidate generation is still **inside the local Python program**, not across an Antigravity boundary.

---

## Core Principle

This phase is about creating an honest generation interface.

The rule is:

> a candidate must come back from **Claude Opus 4.6 running in Antigravity** as a runtime response, not merely from local Python search logic

If that boundary is not real, do not call it Claude-in-Antigravity generation.

---

## Hard Constraints

1. **Do not break benchmark integrity.**
   The eval set remains frozen.

2. **Do not let the agent edit `prepare.py`.**
   `train.py` remains the research surface.

3. **Do not discard the good parts of Phase 79.**
   Keep real file edits, real subprocess benchmarking, and real revert behavior.

4. **Do not keep describing the local heuristic generator as Claude-in-Antigravity generation.**

5. **Do not make prompt usage merely cosmetic.**
   `agent_prompt.md` must be part of the actual request payload or message content sent across the boundary.

6. **Do not require a fresh directive for every experiment.**

---

## Task A: Add A Real Request/Response Boundary

Implement the smallest honest interface that makes this sentence true:

> the Oracle loop sends a candidate-generation request to **Claude Opus 4.6 in Antigravity** and receives back a proposed `train.py` edit

Acceptable shapes include:

- a direct Claude/Antigravity invocation API/CLI if available
- a file-based inbox/outbox bridge
- a prompt-request artifact plus response artifact protocol
- another explicit request/response adapter between the local loop and Claude running in Antigravity

But the loop must now have a real external boundary, not only internal Python function calls.

---

## Task B: Make `agent_prompt.md` Part Of The Actual Request

The prompt file must be used as actual generation input, not just hashed for provenance.

At minimum, the request should include:

- the current incumbent context
- the relevant experiment history summary
- the human-authored `agent_prompt.md`
- constraints limiting edits to `train.py`

The report must be able to show what was sent to Claude in Antigravity and what came back.

---

## Task C: Preserve Provenance, But Upgrade It

Keep provenance logs, but make them prove a real boundary crossing.

Each generated candidate should now log:

- request artifact / message id
- response artifact / message id
- prompt hash
- raw or normalized returned patch/edit description
- resulting applied diff
- benchmark result
- keep/discard decision

The provenance record should prove:

> this candidate came from Claude Opus 4.6 running in Antigravity, not just from local Python code

---

## Task D: Keep A Safe Local Fallback, But Be Honest About It

If a local heuristic generator is still useful as a fallback or seed mechanism, that is fine.

But:

- it must be clearly labeled as fallback
- it must not be presented as Claude-in-Antigravity generation
- the proof run for this phase must include at least one genuinely external candidate

---

## Task E: Prove The Boundary With A Bounded Run

Run a bounded proof showing at least:

1. one real outbound request to Claude Opus 4.6 in Antigravity
2. one real inbound response containing a candidate edit
3. one applied `train.py` diff from that response
4. one completed benchmark on that diff
5. one logged keep/discard decision

If possible, demonstrate multiple external candidates.

But the minimum proof must show at least one real boundary crossing.

---

## Task F: Be Explicit If Antigravity Cannot Actually Be Invoked

If Claude Opus 4.6 inside Antigravity cannot be programmatically invoked from this environment, say so plainly.

In that case:

- do not overclaim
- build the cleanest possible request/response stub or handoff protocol
- and explain exactly what final missing capability prevents true end-to-end operation

An honest “the bridge is still missing” is better than another inflated claim.

---

## Required Deliverables

Produce:

1. the corrected Oracle loop with a real Claude-in-Antigravity request/response generation boundary
2. any adapter / bridge files needed to support that boundary
3. upgraded provenance logs showing actual request/response artifacts
4. a bounded proof run with at least one real externally generated candidate
5. `phase80_results.json`
6. `EXECUTION_REPORT_80.md`

---

## Required Truthfulness

In `EXECUTION_REPORT_80.md`, answer these plainly:

1. Is candidate generation now crossing a real external boundary to Claude Opus 4.6 in Antigravity, or not?
2. What exact file/process sends the outbound request?
3. What exact file/process receives the inbound response?
4. How is `agent_prompt.md` included in the actual request?
5. Was at least one candidate returned by Claude-in-Antigravity benchmarked?
6. Is the local heuristic generator still present, and if so, what role does it play?
7. Was discard restoration still proven after the bridge change?
8. Did any externally returned candidate improve on the incumbent?
9. What still remains before overnight unattended operation is trustworthy?

---

## What Not To Do

Do **not**:

- describe internal Python heuristics as Claude-in-Antigravity generation again
- use prompt hashing alone as evidence of prompt usage
- hide the absence of a real request/response boundary
- spend the phase manually tuning outside the loop

---

## Success Condition

The strongest outcome for Phase 80 is:

> the Oracle loop now obtains at least one real candidate diff from Claude Opus 4.6 running in Antigravity across an explicit request/response boundary, benchmarks it, and keeps or discards it honestly

If the boundary still is not real, say so clearly.
