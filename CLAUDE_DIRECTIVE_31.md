# Claude Directive 31: Featured Matches and Privacy-Safe Spectator MVP Sprint for Gin Paradise

## Default Protocol

This directive inherits the project default protocol, with one directive-specific reporting rule:

1. You must emit a comprehensive markdown Execution Report.
2. You must save that report to the workspace root as `EXECUTION_REPORT_31.md`.
3. You must also emit an updated project status report and save it to the workspace root as `PROJECT_STATUS.md`.
4. The execution report must include, at minimum:
   - objective
   - current context
   - actions taken in chronological order
   - files created, modified, or deleted
   - tests and manual verification performed
   - unresolved issues or risks
   - recommended next step
5. The updated `PROJECT_STATUS.md` must reflect the true current state of the product and must not overclaim completed scope.
6. The task is not complete until the code, verification, `EXECUTION_REPORT_31.md`, and updated `PROJECT_STATUS.md` are all finished.

## Current State

The latest reports show that Gin Paradise now has:

- a mature competitive core with multiplayer, tournaments, fairness proofs, training/coaching, achievements, cosmetics, premium packaging, seasons, public profiles, and direct-social competition
- a completed challenge-to-match and staked-rematch path, including in-game rematch affordance and cleanup of stale accepted challenge/rematch rooms
- a fully green suite with `798/798` tests passing

However, one important community/retention layer is still missing:

1. Players can now chase status and rivals, but there is still no way for the broader community to watch notable matches inside the product.
2. High-skill, high-stakes, tournament, and rivalry matches still disappear into private play instead of becoming public spectacle.
3. The platform lacks a featured/live-competition surface that can convert seasons, profiles, and social rivalry into audience energy.

## Your Next Task

Build the Featured Matches and Privacy-Safe Spectator MVP sprint for Gin Paradise.

## Primary Objective

Add a first spectator/featured-match layer that makes Gin Paradise feel alive as a public competitive venue, while preserving hidden-information safety and the server-authoritative trust model.

## Required Scope

### 1. Privacy-Safe Spectator Model

- Add a read-only spectator capability for selected live matches.
- The spectator view must remain safe for an imperfect-information card game.
- Spectators must never receive hidden information they should not see during live play.
- At minimum, the live spectator model should expose only public-state information such as:
  - player identities
  - scores / round totals
  - whose turn it is
  - discard information already public to both players
  - stock/discard counts or other already-public state
  - revealed hands only when the rules already reveal them at showdown/end of hand
- Be explicit in the report about what data spectators can and cannot see.

### 2. Match Eligibility / Opt-In Rules

- Define a clear first-pass rule for what matches can be spectated.
- Keep this version simple and safe.
- Examples of acceptable approaches:
  - tournament matches only
  - featured/opt-in matches only
  - admin-featured matches
  - leaderboard/top-player public matches if both players allow it
- Avoid turning every private challenge into a public default unless clearly justified.

### 3. Featured Matches Surface

- Build a first-class UI surface that highlights watchable matches.
- At minimum, players should be able to:
  - discover currently watchable matches
  - understand why a match is notable (tournament, seasonal ranking, rivalry, high stake, featured)
  - open a live watch page
- This can live on Dashboard, Social Hub, a dedicated page, or a combination, but it should feel deliberate rather than hidden.

### 4. Spectator Watch Experience

- Build a clean live watch page or spectator mode using the existing trusted multiplayer/view infrastructure where possible.
- The spectator experience should feel like a real competitive broadcast surface, even in MVP form.
- At minimum, include:
  - player names and status context
  - live public board state
  - clearly marked spectator/read-only mode
  - round/match progression
  - proper showdown visibility when both hands are legitimately revealed
- Preserve usability and visual coherence with the current Game Room.

### 5. Fairness and Anti-Leak Boundaries

- Do not weaken fairness, hidden information, or server authority.
- Spectator transport and rendering must not leak either player’s concealed hand during live play.
- Do not add chat or spectator interactions in this sprint.
- If any match type is not safe to spectate under the chosen approach, leave it out and state so explicitly.

### 6. Testing and Verification

Add automated coverage for the spectator/featured-match pass. At minimum, cover:

- spectator visibility boundaries for live hidden-information matches
- eligibility / opt-in / featured-match selection rules
- featured-match listing behavior
- watch-page data shape and read-only access behavior
- regression coverage confirming multiplayer, fairness, wallet, escrow, rake, social systems, seasons, training, cosmetics, entitlements, tournaments, and admin still work

Also perform manual verification if the environment allows it.

## Non-Goals for This Pass

- No spectator chat, emotes, or direct interaction in this sprint
- No hidden-hand reveal during live play
- No broad streaming/media infrastructure in this sprint
- No irreversible billing/provider integration in this sprint
- No weakening of trust shield, fairness proofs, or room authority
- No regression of the existing challenge/rematch and staked-play flows

## Implementation Guidance

- Treat this as a competitive broadcast/community layer, not as a social-media feed.
- Reuse existing multiplayer room/view projection logic wherever possible so spectator views inherit the same trust boundaries.
- Favor explicit public-state projection for spectators over ad hoc UI filtering.
- Keep the first eligibility model simple and defensible.
- If scope must be narrowed, prioritize in this order:
  1. privacy-safe spectator state projection
  2. featured-match discovery surface
  3. live watch page
  4. richer notable-match labeling/polish
- If shared gameplay surfaces are touched, preserve recent Game Room improvements: 4-row suit-based hand layout, live deadwood counter, knock validation, four-color deck support, and dark-surface suit visibility.
- Be explicit in the report about:
  - what live data spectators receive
  - what hidden data is intentionally withheld
  - what match types are eligible for spectating
  - what community/broadcast features remain out of scope

## Acceptance Criteria

This task is complete only if all of the following are true:

- Gin Paradise has a first real featured-match / spectator MVP
- spectators can watch eligible matches without receiving hidden-hand information during live play
- players can discover notable live matches through a clear in-product surface
- the spectator/watch experience is clearly read-only and coherent with the existing table/game UX
- automated tests for the spectator/featured-match layer exist and pass alongside the existing suite
- a comprehensive `EXECUTION_REPORT_31.md` is saved to the workspace root
- an updated `PROJECT_STATUS.md` is saved to the workspace root and accurately reflects the new state

## Deliverable Expectation

Complete the first safe public-watch layer next. After that, the strongest follow-on options will likely be richer featured-broadcast polish, a fuller cosmetic storefront, or real billing/provider integration depending on product strategy.
