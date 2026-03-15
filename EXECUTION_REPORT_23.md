# Execution Report 23: AI Coaching Timeline & Cached Training Narrative Sprint

**Date:** March 13, 2026  
**Directive:** CLAUDE_DIRECTIVE_23  
**Status:** ✅ Complete

---

## Objective

Integrate AI coaching into the training product by implementing a durable cache for replay coaching, surfacing cached coaching within the training timeline and session reviews, distinguishing it from engine evaluations, and adding a history layer for recurring coaching themes. Operational safety and cost control for AI features are prioritized throughout.

---

## Current Context

Before this sprint, Gin Paradise had:
- 516 passing tests across 20 test files
- Mature training dashboard with engine-backed evaluation, progression signals, format context, and batch-prep
- AI analysis on replays via Gemini with fallback, but no caching or integration into the training flow
- No persistent coaching layer — analysis was ephemeral and per-request
- No coaching history or recurring theme detection

---

## Actions Taken

### 1. Durable Coaching Cache (`server/analysis/coachingCache.ts`)

Created a complete coaching cache module with:

- **SQLite persistence**: New `replay_coaching` table with `replay_id` (PK), `user_id`, `coaching_json`, `source`, `schema_version`, `created_at`
- **Versioned schema**: `COACHING_SCHEMA_VERSION = 1` enables future prompt/model upgrades with selective invalidation
- **Source tagging**: Every cached entry records whether it came from `"ai"` (Gemini) or `"fallback"` (structured analysis)
- **Cache-first retrieval**: `getOrGenerateCoaching()` checks cache before any API call
- **Gemini AI generation**: Structured prompt requesting narrative + themes, with extraction parsing
- **Graceful fallback**: Rich structured coaching generated without an API key, including:
  - Match review with score and duration
  - Engine evaluation summary (when available)
  - Draw pattern analysis with actionable coaching notes
  - Key decision moments linked to engine mistakes
  - Strategic tips tailored to win/loss context
- **Mistake linking**: `buildMistakeLinks()` connects engine evaluation data to coaching explanations, producing per-turn coaching notes sorted by severity
- **Theme aggregation**: `aggregateCoachingThemes()` counts recurring themes across sessions for pattern surfacing
- **History retrieval**: `getCoachingHistory()` and `getMostRecentCoaching()` for timeline features

### 2. Training Routes Integration (`server/routes/training.ts`)

Major update to integrate coaching across all training surfaces:

- **Training Summary** (`GET /api/training/summary`):
  - New `coaching` top-level response field with `recentCoachingNote`, `recurringThemes`, and `totalCoached`
  - Sessions now include `hasCoaching` and `coachingSource` fields
  - `meta.coachingNote` documents the coaching methodology
  
- **Session Detail** (`GET /api/training/session/:id`):
  - New `coaching` object alongside existing `evaluation` — kept as distinct top-level keys
  - Coaching includes `narrative`, `themes`, `mistakeLinks`, `source`, `generatedAt`
  - `meta.hasCoaching` and `meta.coachingSource` for source distinction
  
- **Training History** (`GET /api/training/history`):
  - New `filter=coached` option alongside existing `evaluated`/`unevaluated`
  - Sessions include `hasCoaching` and `coachingSource`

- **Three new coaching endpoints**:

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/training/coaching/:id` | POST | Yes | Generate or retrieve cached coaching for a specific replay |
| `/api/training/coaching/timeline` | GET | Yes | Recent coaching timeline entries with narrative previews |
| `/api/training/coaching/themes` | GET | Yes | Aggregated recurring themes across coached sessions |

### 3. Frontend Integration (`src/pages/Training.tsx`)

Updated the Training Center UI with:

- **AI Coaching Insights Card**: New card in the overview section showing:
  - Recurring coaching themes with frequency counts and violet theme badges
  - Latest session coaching themes preview
  - Coaching coverage stats (sessions coached)
  - Source badge (AI vs Structured) for transparency
- **Session Coaching Badge**: Violet book icon badge in session list items when coaching is available
- **Updated Types**: `SessionSummary` extended with `hasCoaching`, `coachingSource`; new `CoachingData` interface; updated `TrainingSummaryResponse`
- **Methodology Note**: Added AI Coaching explanation to the About Training Metrics section, explicitly distinguishing coaching from engine evaluation

---

## Files Created

| File | Size | Purpose |
|---|---|---|
| `server/analysis/coachingCache.ts` | 11.1 KB | Durable coaching cache: SQLite persistence, AI/fallback generation, mistake linking, theme aggregation |
| `tests/coaching.test.ts` | 15.5 KB | 35 new tests for coaching integration |

## Files Modified

| File | Change |
|---|---|
| `server/routes/training.ts` | Added coaching imports, 3 new endpoints, coaching data in summary/session/history responses |
| `src/pages/Training.tsx` | Added coaching types, insights card, session badge, methodology note |

---

## Tests and Verification

### New Test Coverage (35 tests in `tests/coaching.test.ts`)

| Category | Tests | Coverage |
|---|---|---|
| **Direct Cache Operations** | 4 | Null on miss, cache/retrieve, overwrite, mistake link structure |
| **Theme Aggregation** | 4 | Multi-entry aggregation, empty user, most recent retrieval, history ordering |
| **Coaching Generation API** | 6 | Auth (401), not found (404), non-participant (403), fallback generation, cache reuse, engine-linked mistakes |
| **Coaching Timeline API** | 3 | Auth, empty timeline, populated timeline entries |
| **Coaching Themes API** | 2 | Auth, recurring theme aggregation |
| **Training Summary Integration** | 3 | Coaching data in summary, session-level coaching badges, recurring themes |
| **Session Detail Integration** | 3 | Coaching in session detail, evaluation/coaching distinction, null coaching |
| **Content Structure Validation** | 3 | Narrative structure, engine accuracy inclusion, loss perspective |
| **Regression Coverage** | 7 | Training summary, replay list, evaluation API, wallet, leaderboard, profile, coached filter |

### Full Suite Results

```
Test Files  21 passed (21)
     Tests  551 passed (551)
```

516 pre-existing + 35 new = **551 total tests, all passing, zero regressions.**

---

## Acceptance Criteria Verification

### ✅ Durable Replay Coaching Cache
- Coaching cached in SQLite `replay_coaching` table with versioned schema
- Cache-first retrieval prevents redundant API calls
- Works with both Gemini AI and structured fallback
- Source tagged for UI distinction

### ✅ Training Timeline Integration
- Coaching data surfaced in training summary with themes and coverage stats
- Session-level `hasCoaching` and `coachingSource` fields in session lists
- Coaching timeline endpoint returns recent coaching entries with narrative previews

### ✅ Session Review Enrichment
- Session detail combines engine evaluation and coaching as **distinct top-level keys**
- Coaching includes narrative, themes, and mistake links
- Engine evaluation remains unchanged — no conflation

### ✅ Engine vs Coaching Distinction
- Evaluation: `evaluation` key with accuracy, severity counts, per-turn data (source: "cache")
- Coaching: `coaching` key with narrative, themes, mistake links (source: "ai" or "fallback")
- API response explicitly states: "Engine evaluation uses Apex v2 heuristic agreement. AI coaching is a separate, complementary narrative layer."
- Frontend shows coaching as violet-themed UI distinct from teal-themed engine data

### ✅ Coaching History & Pattern Surfacing
- `aggregateCoachingThemes()` counts recurring themes across sessions
- Coaching timeline endpoint provides full history
- Themes endpoint returns sorted theme-count pairs
- Frontend shows recurring themes with frequency indicators

### ✅ Operational Safety
- AI coaching is **not** in the critical gameplay path
- Cache-first design prevents runaway API costs
- Fallback always generates meaningful coaching without API key
- Schema versioning enables future prompt/model invalidation
- Per-user coaching history bounded by query limits

---

## Design Decisions

### Coaching vs Evaluation Separation
Engine evaluation (Apex v2 agreement) provides **mathematical truth** — per-turn accuracy scores. Coaching provides **narrative explanation** — "why did this mistake happen and what to do instead." These are fundamentally different data types and are kept as separate response objects throughout the API.

### Fallback Quality
The structured fallback is not a degraded experience — it includes match review, draw pattern analysis, engine accuracy context, and strategic tips. The AI version adds more natural language and deeper strategic reasoning, but the fallback is informative and actionable on its own.

### Cache Granularity
Coaching is cached at the replay level (one coaching artifact per replay), not the turn level. This is intentional — the coaching narrative covers the whole match strategically, while per-turn detail comes from engine evaluation's `mistakeLinks`.

---

## Unresolved Issues or Risks

1. **AI Coaching Prompt Quality**: The current prompt directs Gemini to produce structured output (COACHING NARRATIVE + KEY THEMES). More sophisticated prompt engineering could improve theme extraction and narrative quality in future iterations.

2. **Theme Normalization**: Themes are normalized to lowercase for aggregation, but semantically similar themes (e.g., "balanced draw pattern" and "draw source selection") are not currently deduplicated. A future NLP-based deduplication pass could improve theme aggregation quality.

3. **Coaching Trigger**: Coaching is generated on-demand via `POST /api/training/coaching/:id`. It is not auto-generated after match completion like evaluations. This is intentional for cost control but could be selectively automated for high-value sessions.

---

## Recommended Next Step

The strongest follow-on options are:
1. **Monetizable cosmetic system** — extend prestige items into a purchasable cosmetic store
2. **Achievement triggers from live gameplay** — call `evaluateAchievements()` and auto-generate coaching after match completion
3. **Coaching quality iteration** — refine prompts, add per-turn coaching annotations, integrate coaching into the replay viewer
4. **Subscription packaging** — bundle coaching features into a premium tier
