# Applying Karpathy-Style Autoresearch to the Gin Rummy Oracle, and How It Maps to Heads-Up 7 Card Stud

## What "autoresearch" means in this project

Karpathy's `autoresearch` pattern is not "let the model rewrite the whole codebase."
It is a much tighter loop:

1. Freeze the benchmark.
2. Expose a small evolvable code surface.
3. Let the model propose one candidate change.
4. Run the benchmark.
5. Keep the change only if it wins by rule.
6. Log everything and repeat.

That is exactly the pattern now being applied to the Gin Rummy Oracle.

## How it is being applied to the Gin Rummy Oracle

The Gin Oracle lab is built around a hard separation between **fixed evaluation
infrastructure** and **editable solver logic**.

### Fixed infrastructure

These files are treated as frozen measurement machinery:

- `oracle_autoresearch/prepare.py`
- `oracle_autoresearch/multi_lane_benchmark.py`
- `oracle_autoresearch/oracle_abstractions.py`
- `oracle_autoresearch/gauntlet_eval.py`

Their job is to make candidate comparison honest and repeatable.

### Editable solver surface

The main editable file is:

- `oracle_autoresearch/train.py`

And the current symbolic mutation surface is intentionally tiny:

- `compute_eval_weight(...)`
- `compute_trace_confidence_multiplier(...)`

That means Gemini is not being asked to redesign Gin Rummy from scratch. It is
being asked to discover better math inside two high-leverage helper functions.

### Frozen benchmark lanes

Instead of trying to solve "all of Gin" in one step, the lab uses a multi-lane
proxy benchmark:

- **Knock lane**: knock vs continue
- **Draw lane**: take discard vs draw stock
- **Discard lane**: which discard is best

Targets are generated offline and frozen into JSON artifacts. During candidate
evaluation, the loop does **not** recompute oracle truth on the fly.

### Promotion rule

A candidate is promoted only if:

1. Aggregate score beats the incumbent by margin.
2. No single lane regresses too much.

So the loop is not allowed to "cheat" by improving one slice while quietly
breaking another.

### Held-out gauntlet

The lab also has a real-policy gauntlet:

- `oracle_autoresearch/gauntlet_eval.py`

That matters because the proxy benchmark is the training-time fitness signal,
but the gauntlet is the more realistic check that the evolved policy still
behaves well in actual play.

### Gemini's role

Gemini CLI is the research worker, not the evaluator.

The loop:

1. Builds a prompt from the current Oracle state.
2. Asks Gemini for one exact patch to `train.py`.
3. Applies it.
4. Benchmarks it.
5. Keeps or discards it automatically.

That is the core Karpathy-style idea: the model proposes, the benchmark judges.

## Why this works better than "just tune the whole bot"

Gin Rummy is an imperfect-information card game. If the search space is too
wide, the loop becomes noisy and easy to fool. The current Gin setup avoids
that by combining:

- a **narrow mutation surface**
- a **frozen proxy benchmark**
- a **held-out gauntlet**
- a **strict keep/discard rule**

So the loop is not searching the whole game at once. It is searching a bounded,
high-signal part of the policy.

That is much closer to "algorithm discovery under constraints" than generic
prompt hacking.

## How this might map to Heads-Up 7 Card Stud

This is the important part: the same pattern can transfer to Heads-Up 7 Card
Stud, but not by copying the Gin benchmark directly.

The correct transfer is:

- keep the **autoresearch loop design**
- change the **decision lanes, abstractions, and oracle targets**

## What should stay the same in Stud

These principles should carry over almost unchanged:

1. **One frozen benchmark harness**
2. **One or a few tiny editable policy surfaces**
3. **Offline target generation**
4. **Automatic keep/discard promotion**
5. **Held-out match gauntlet against frozen baselines**

In other words, you want the same lab architecture, not the same features.

## What should change for Heads-Up 7 Card Stud

### 1. The proxy lanes

Gin's lanes are knock, draw, and discard. Stud needs different decision slices.

A strong initial Stud proxy set might be:

- **Street decision lane**: fold / call / raise in bounded heads-up spots
- **Bring-in / completion lane**: complete vs call vs fold after forced entry
- **Board-reading lane**: action quality conditioned on exposed dead cards
- **River/value lane**: thin value / bluff-catch / fold on late streets

The point is not to cover the whole betting tree at once. The point is to pick
repeatable high-value sub-decisions that matter a lot.

### 2. The abstraction layer

Gin abstractions focus on deadwood, meld structure, deck phase, and trace
signals. Stud needs a different public-state abstraction.

A useful Stud abstraction layer would likely include:

- street (`3rd`, `4th`, `5th`, `6th`, `7th`)
- hero hand class / draw class
- visible board strength
- dead/live card counts
- exposed pairs / trips / suitedness
- betting lead and action history
- pot size and price
- initiative / aggressor state
- opponent board pressure

This is the Stud equivalent of `oracle_abstractions.py`.

### 3. The frozen oracle targets

In Gin, frozen targets come from offline oracle calculations per lane.
In Stud, you would need the same thing:

- a large offline solve or very expensive rollout for selected benchmark spots
- frozen labels or target values for each lane

Those targets could be:

- best action
- action distribution
- EV difference between top actions
- regret against a reference policy

The key is the same as Gin: **do not recompute the expensive oracle during each
candidate evaluation**.

### 4. The mutation surface

Do not let the LLM edit the entire Stud engine first.

Start with a tiny number of helper functions, just like Gin. For example:

- `compute_board_confidence_weight(...)`
- `compute_aggression_mix(...)`
- `compute_dead_card_risk_multiplier(...)`

These would be the Stud equivalents of the current Gin helper functions.

The loop then asks Gemini to discover better continuous schedules inside these
functions, not to rewrite the whole policy.

## A concrete mapping from Gin concepts to Stud concepts

### Gin: `compute_eval_weight(...)`

Current role:
- blend direct EV with a prior, using confidence signals

Stud analogue:
- blend rollout EV with a street prior or abstraction prior, using signals like:
  - street depth
  - board visibility
  - dead-card certainty
  - betting aggression

### Gin: `compute_trace_confidence_multiplier(...)`

Current role:
- scale risk penalties based on observation quality and game phase

Stud analogue:
- scale bluff/value/risk penalties based on:
  - number of live outs
  - number of key dead cards visible
  - opponent board coherence
  - street depth
  - pot commitment

So the conceptual transfer is very clean even though the game mechanics differ.

## What not to do in Stud

If you want this to work, avoid these mistakes:

### 1. Do not start with full-game "GTO" solving

That is too big for the first autoresearch loop. You will drown in noise before
the loop teaches you anything.

### 2. Do not let Gemini mutate everything

If the editable surface is huge, the benchmark signal gets muddy and the model
will produce lots of plausible but unhelpful churn.

### 3. Do not rely only on head-to-head match win rate

Match win rate is useful as a held-out gate, but it is too noisy to be the only
 inner-loop fitness signal. You still want frozen proxy lanes.

### 4. Do not skip the abstraction layer

Stud has even richer public information than Gin. If you do not explicitly
structure that information, your search loop will waste time rediscovering
obvious card-exposure features.

## A good Stud build order

If you want to port this pattern into Heads-Up 7 Card Stud, the best order is:

1. Build a shared Stud abstraction layer.
2. Curate a small fixed set of benchmark spots per lane.
3. Generate expensive offline oracle targets for those spots.
4. Freeze the benchmark.
5. Expose 1-3 small helper functions as the mutation surface.
6. Add a held-out bot-vs-bot gauntlet.
7. Only then start the Gemini autoresearch loop.

That is the closest Stud analogue to what the Gin Oracle is doing today.

## Bottom line

The Gin Oracle is applying Karpathy-style autoresearch in a disciplined way:

- frozen measurement
- tiny evolvable policy surface
- LLM-generated candidate patches
- automatic keep/discard
- proxy benchmark plus held-out gauntlet

For Heads-Up 7 Card Stud, the right move is not "copy the Gin bot."
It is "copy the research factory."

Build the Stud version as:

- frozen Stud proxy lanes
- frozen offline targets
- small helper-function mutation surface
- Gemini proposing exact code edits
- benchmark deciding what survives

That gives you a realistic path toward a strong Stud bot without pretending you
can solve the entire game monolithically on day one.
