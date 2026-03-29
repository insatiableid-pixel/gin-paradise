# Claude Directive 60: Frontier-Informed Knock Policy Integration Sprint

## Mission

Take the strongest honest next step after Phase 59: **do not run another descriptive frontier study yet**. Instead, convert the Phase 59 result into a **small, defensible knock-policy candidate set**, integrate those candidates on top of the current champion, and test them in **full duplicate matches** to see whether the early-game frontier actually improves match-winning play.

The current production baseline remains:

- `ApexMCTSClinchOnlyGoGin`

Phase 59 is important, but it is still a **0-0, early-turn, hand-level frontier map**. That is not enough by itself to replace the champion. The next step is to test whether a compact frontier-informed rule really beats the champion in actual matches without reopening the undercut leaks that killed earlier aggressive knock behavior.

## Why This Is The Right Next Step

Reports 57–59 now give us a coherent picture:

- **Phase 57:** `ClinchOnlyGoGin` beat the simpler aggressive variants as the best robust production policy.
- **Phase 58:** `DW=9` at `0-0` is not a universal knock; gin liveness and deadwood-card structure matter.
- **Phase 59:** the early knock decision is a **frontier over gin probability / hand texture**, not a simple deadwood threshold, and pure patience likely leaves EV on the table at `0-0`.

That means the right move is **not**:

- more CFR
- more draw/discard modeling
- another giant frontier map before testing an integrated policy
- blindly replacing the champion with “always knock below some deadwood”

The right move is:

1. build a **small number of compact policy variants** suggested by the frontier,
2. test them in **full duplicate matches** against the current champion and a patient field,
3. only promote a new champion if the gain survives honest match-level validation.

## Hard Constraints

1. **Do not discard the clinch-only exception.**
   Immediate match-clinch knocks remain mandatory.

2. **Do not optimize for beating an exploitable bot.**
   Primary benchmark = robust / patient field and direct H2H vs the current champion.
   Aggressive-opponent results are secondary diagnostics only.

3. **Do not rely on hand-level signed points as the promotion criterion.**
   Use real duplicate matches and match-level outcomes.

4. **Do not create a large, baroque rule tree.**
   We want the smallest rule set that captures the real signal from Phase 59.

5. **Do not treat Phase 59 as final truth outside its tested regime.**
   It fixed score at `0-0`, only covered turns `0..3`, and used estimated gin probability. Respect those limits.

## Required Deliverable

Create a new knock-policy evaluation sprint centered on **compact frontier-informed variants** built on top of `ApexMCTSClinchOnlyGoGin`.

You should implement and compare **at least three** candidate variants, all inheriting the clinch-only rule:

### Candidate Family A: Simple Gin-Probability Threshold

Example shape:

- if legal knock and `gin_prob < T`, knock
- else continue
- with clinch-only override above everything

Test at least **two threshold values**. Recommended starting points:

- `T = 0.20`
- `T = 0.30`

### Candidate Family B: Threshold + Multi-Card Deadwood Exception

Example shape:

- if clinch, knock
- else if legal knock and `n_dw_cards >= 3`, knock
- else if legal knock and `gin_prob < T`, knock
- else continue

This is directly motivated by Phase 58 and Phase 59, where fragmented multi-card DW hands were consistently strong knocks.

### Candidate Family C: Threshold + High-Liveness Patience Guard

Example shape:

- if clinch, knock
- else if legal knock and `gin_prob >= H` and `dw >= 6`, continue
- else if legal knock and `gin_prob < T`, knock
- else continue

This is the minimal way to encode the “connected / gin-live high-DW hands want patience” result without hard-coding many special cases.

You may rename the variants, but keep them compact and interpretable.

## Implementation Guidance

Use the existing gin-probability / knock feature machinery where practical. Prefer reusing the same estimator from the Phase 59 frontier tool if it can be called cheaply and deterministically enough inside gameplay.

If estimator cost is too high for direct live use, it is acceptable to:

- cache the estimate per decision state, or
- create a reduced-rollout approximation

But do **not** silently change the definition of gin probability without saying so.

## Required Benchmarks

### 1. Direct Champion H2H

Each candidate variant must play duplicate H2H against:

- `ApexMCTSClinchOnlyGoGin`

Run a quick screen first, then a higher-power confirmation for the best candidate.

Recommended minimum:

- quick screen: `240` total games
- confirmation: `500+` total games if a candidate looks promising

### 2. Patient Field Cross-Play

The leading candidate must also be tested in a patient / robust field. At minimum include:

- current champion
- one or two patience-adjacent variants from prior phases if still available

If there is no meaningful patient-field pool beyond the champion and its close relatives, say so clearly and use the strongest available robust set.

### 3. Secondary Exploitative Diagnostic

Run the leading candidate against the more aggressive baseline(s), but report this only as a secondary view. A candidate that gains only by farming aggressive knockers should **not** be promoted.

## Required Diagnostics

Do not stop at win rates. For the leading candidate versus the current champion, report:

- knock frequency
- gin frequency
- undercut frequency
- average hand points when knocking
- average knock deadwood
- knock decisions by gin-probability bucket
- knock decisions by deadwood-card-count bucket

Most importantly, answer:

- Is the gain coming from a real frontier-aware improvement?
- Or is it just “knock more” in a way that may be fragile?

## Required Truthfulness Checks

You must explicitly check for these failure modes:

1. **Threshold overfitting to the 0-0 frontier**
   A candidate may look smart in the early-hand map but fail in full matches.

2. **Reintroduced undercut leak**
   A candidate may gain points in some spots but lose match EV by knocking too often.

3. **Estimator artifact**
   If the gin-probability estimator is noisy, the live policy may behave differently than the frontier study implied.

4. **Pseudo-improvement from exploitative field effects**
   Be careful not to “promote” a policy that only beats aggressive opponents.

## What To Record

Produce:

- code for the policy variants
- any new test coverage
- benchmark artifacts
- `EXECUTION_REPORT_60.md`

In the report, clearly state one of these outcomes:

1. **Promote a new champion**
   Only if a compact frontier-informed variant beats `ApexMCTSClinchOnlyGoGin` in honest duplicate match testing.

2. **Keep the current champion**
   If the frontier signal does not convert to match-level improvement.

3. **Frontier signal is real but not yet safely integrable**
   If the candidate logic is directionally right but too noisy / unstable for promotion.

## Preferred Mindset

This phase is about **closing the loop from descriptive research to real play strength**.

Phase 59 strongly suggests that “never knock below gin” is leaving EV on the table. Now prove whether that insight survives actual full-match competition when folded back into the champion.

Keep the policy small, honest, and benchmark-driven.
