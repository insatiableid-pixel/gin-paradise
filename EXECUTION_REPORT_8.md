# Execution Report 8: Showdown Fidelity and Human-Factors Hand UX Sprint

**Date:** March 11, 2026  
**Directive:** `CLAUDE_DIRECTIVE_8.md`  
**Status:** ✅ Complete

---

## Objective

Build the showdown-fidelity and human-factors hand UX upgrade for Gin Paradise. Make the live and end-of-round Gin Rummy interface feel table-native, rules-faithful, and faster for humans to read and act on. Focus on rules-correct presentation, perceptual clarity, and strong interaction ergonomics.

---

## Current Context (Before)

Gin Paradise had:
- Dual-currency wallet with atomic ledger mutations
- Coin-gated matchmaking with escrow settlement
- Server-authoritative multiplayer with rating-aware matchmaking
- Turn timers, transcripts, replay persistence, and replay analysis
- 189 passing automated tests

Key gaps:
- End-of-hand showdowns did **not** reveal both hands with structured meld/deadwood breakdowns
- Layoff behavior was computed silently in scoring; never presented to the player
- Hand display used an evenly-spaced 4-row suit grid rather than a table-style overlapping layout
- `broadcastGameState` in roomManager had bugs that flattened all players' hands instead of correctly separating knocker/opponent data
- No `ShowdownData` type existed in the protocol — round_over/game_over messages carried raw card arrays with no meld/layoff structure

---

## Actions Taken (Chronological)

### 1. Protocol Type Extensions (Message-Shape Fix)

**Modified `server/multiplayer/types.ts`:**
- Added `ShowdownMeld` interface — cards + type ("set" | "run")
- Added `ShowdownPlayerData` interface — username, melds, deadwood, deadwoodValue, optional laidOffCards
- Added `ShowdownData` interface — knockOutcome, knocker/opponent data, roundWinnerUsername, roundPoints
- Extended `round_over` and `game_over` server message types to carry `showdown: ShowdownData`

### 2. Engine Showdown Data Generation (Engine Fix)

**Modified `server/multiplayer/engine.ts`:**
- Added `classifyMeld()` helper — determines if a meld is a "set" (same rank) or "run" (same suit consecutive)
- Added `meldsToShowdown()` and `cardsToView()` conversion helpers
- Extended `MoveResult` union type to include optional `showdownData: ShowdownData`
- Rewrote `handleKnock()` to compute full meld/deadwood/layoff breakdowns for both players:
  - For gin: evaluates opponent hand without layoffs
  - For normal knock: evaluates with `evaluateAndLayOff()`, then computes which cards were laid off by set-differencing melds+deadwood from the full hand
  - Builds structured `ShowdownData` payload with classified melds, deadwood arrays, layoff cards, and outcome metadata
- Preserved all existing return fields (reveal, knockOutcome, discardedCard)

### 3. Room Manager Broadcast Fix (Message-Shape Fix)

**Modified `server/multiplayer/roomManager.ts`:**
- Added `ShowdownData` import and `lastShowdown` field to `RoomState` interface
- Fixed `broadcastGameState()` — previously flattened all players' hands incorrectly on round_over/game_over; now uses stored `lastShowdown` to reconstruct correct knocker/opponent card arrays
- Updated `broadcastReveal()` to accept and store `ShowdownData`, and pass it in all round_over/game_over messages
- Added `lastShowdown: null` to all RoomState creation sites (create_room, matchmaking callback)
- Fixed forfeit `game_over` message to include a minimal `ShowdownData` stub (required by the now-strict type)
- Updated knock handler call site to pass `result.showdownData!` to `broadcastReveal()`

### 4. Client Hook Extension (Client-Side Fix)

**Modified `src/lib/useMultiplayer.ts`:**
- Added `ShowdownData` import from types
- Added `showdownData: ShowdownData | null` field to `MultiplayerState`
- Updated `round_over` and `game_over` message handlers to extract and store `msg.showdown`
- Cleared `showdownData` on disconnect, leave room, and initial state

### 5. Multiplayer Hand Layout Redesign (Presentation-Layer Fix)

**Rewrote `src/pages/MultiplayerRoom.tsx`:**
- **OverlappingCard component**: Horizontally overlapping cards (28px overlap) with spring animations, lift-on-select, hover-on-available, z-index management
- **Hand container**: Dynamically sized based on card count, sorted by suit then rank for spatial stability
- **Phase clarity indicators**: Text cues that change between "Draw a card", "Select a card, then Discard or Knock", and "Waiting for opponent..." based on game phase
- **Opponent cards**: Also use overlapping layout (16px overlap) for visual consistency
- **ShowdownCardMini component**: Color-coded mini cards for showdown display (emerald=meld, amber=layoff, zinc=deadwood)
- **ShowdownPlayerSection component**: Renders a player's showdown breakdown with labeled melds (Set/Run), laid-off cards, and deadwood
- **Showdown overlay (round_over)**: Animated modal showing knockOutcome badge (GIN/UNDERCUT/KNOCK), winner/points, both players' hands broken into melds/layoffs/deadwood
- **Game over overlay**: Same showdown detail plus final scores and navigation options

### 6. Single-Player Hand Layout Redesign (Presentation-Layer Fix)

**Rewrote `src/pages/GameRoom.tsx`:**
- Replaced 4-row suit grid with identical overlapping card layout
- Added local `showdown` state computed before each knock (both human and bot)
- Added `ShowdownCardMini` and inline showdown sections for round_over and game_over overlays
- Bot AI now computes showdown data before knocking for display consistency
- Phase clarity indicators matching multiplayer behavior
- Overlapping opponent card-backs matching multiplayer visual treatment

### 7. Testing

**Created `tests/showdown-fidelity.test.ts`** — 17 new automated tests:

| Category | Tests | Coverage |
|---|---|---|
| **Showdown Data Presence** | 2 | showdownData exists on successful knock; both players have meld/deadwood breakdown |
| **Meld Classification** | 2 | Same-rank melds classified as "set"; same-suit consecutive classified as "run" |
| **Gin Detection** | 1 | Showdown structure correct when knocker has 0 deadwood |
| **Undercut Detection** | 1 | Undercut detected when opponent deadwood ≤ knocker deadwood |
| **Layoff Cards** | 2 | Laid-off cards detected on normal knock; no laidOffCards on gin |
| **Reveal Consistency** | 2 | Both hands in reveal; total showdown cards = 10 per player; points match state |
| **Status Transitions** | 1 | Status correctly set to round_over or game_over |
| **Regression** | 5 | >10 DW rejection, turn order, out-of-turn prevention, next round, drawnCard/discardedCard |
| **PlayerView** | 1 | Valid player views during round_over state |

**Full suite results:** 206 tests passing across 10 test files (17 new + 189 existing), 0 failures.

---

## Files Created

| File | Purpose |
|---|---|
| `tests/showdown-fidelity.test.ts` | 17 automated tests for showdown data, meld classification, layoff tracking, regressions |

## Files Modified

| File | Change |
|---|---|
| `server/multiplayer/types.ts` | Added `ShowdownMeld`, `ShowdownPlayerData`, `ShowdownData` interfaces; extended round_over/game_over message types |
| `server/multiplayer/engine.ts` | Added meld classification helpers; extended `handleKnock()` to compute full showdown breakdown with layoff detection |
| `server/multiplayer/roomManager.ts` | Fixed `broadcastGameState()` for round_over/game_over; added `lastShowdown` to `RoomState`; updated `broadcastReveal()` with showdown; fixed forfeit message |
| `src/lib/useMultiplayer.ts` | Added `showdownData` to state; populated from round_over/game_over messages |
| `src/pages/MultiplayerRoom.tsx` | Complete rewrite: overlapping hand layout, showdown overlay with meld/layoff/deadwood visualization, phase indicators |
| `src/pages/GameRoom.tsx` | Complete rewrite: overlapping hand layout, local showdown computation, showdown overlays matching multiplayer |
| `PROJECT_STATUS.md` | Updated to reflect showdown fidelity sprint completion |

## Files Deleted

None.

---

## Tests and Verification

### Automated Tests

```
 Test Files  10 passed (10)
      Tests  206 passed (206)
   Duration  16.53s
```

All tests pass, including:
- 17 new showdown fidelity tests
- 189 existing tests (zero regressions)

### Test Coverage Mapping to Acceptance Criteria

| Acceptance Criterion | Test Coverage |
|---|---|
| Both hands revealed on every round end | `Reveal data consistency` tests (2) — knockerHand + opponentHand verified, card count = 10 each |
| Normal knocks support layoffs | `Layoff card tracking` test — laidOffCards detected on normal knock |
| Gin hands reveal but no layoffs | `Layoff card tracking` test — laidOffCards undefined on gin |
| Showdown data internally consistent | `Reveal consistency` — points match state.roundPoints; card totals = 10 |
| Meld classification correct | `Meld type classification` tests (2) — sets and runs correctly identified |
| Existing behavior still works | `Regression` tests (5) + full existing suite (189 tests) |
| Live hand uses overlapping layout | Implemented in both MultiplayerRoom.tsx and GameRoom.tsx |
| Overlapping layout preserves selection | OverlappingCard component with absolute positioning, z-index management, lift animation |

### Human-Factors Design Decisions

| Principle | Implementation |
|---|---|
| **Perceptual grouping** | Cards sorted by suit then rank; spatial proximity enables visual chunking of runs |
| **Recognition over recall** | Showdown melds labeled "Set" or "Run" with color-coded borders; no mental reconstruction needed |
| **Spatial stability** | `useMemo` sort prevents re-ordering during a turn; hand only re-sorts on card count change |
| **Motor accuracy** | Each card has 56px width with 28px overlap = 28px exposed hit target; selected cards lift 16px |
| **Low cognitive noise** | Phase indicators replace generic messages; showdown uses color to distinguish melds/layoffs/deadwood |
| **Phase clarity** | Explicit text: "Draw a card" → "Select, then Discard or Knock" → "Waiting for opponent" |
| **Individual differences** | Horizontal scroll on narrow screens; responsive card heights (76px/88px breakpoints) |

---

## Unresolved Issues / Risks

1. **TypeScript strict check**: `tsc --noEmit` reports 11 errors across 4 test files due to a pre-existing pattern where tests access `result.error` on discriminated union types without narrowing. All tests run correctly via Vitest. This is a pre-existing issue not introduced by this sprint.

2. **Replay visual consistency**: Replay transcript viewer still shows text-based action logs. While the stored transcript data now includes all action types needed for future visual replay (including knock outcomes with deadwood values), the replay UI does not yet render a visual showdown grid. Replay data is complete and consistent with live showdown behavior.

3. **Showdown card animation**: Cards appear immediately in the showdown overlay via `AnimatePresence` + scale. A future pass could add sequential reveal animation (knocker melds first, then opponent melds, then layoffs, then deadwood) for dramatic effect.

4. **Overlapping card touch targets on very small devices**: The 28px exposed width per card is comfortable for thumb targeting at normal phone widths (10-11 cards). With 11+ cards and very narrow viewports (<320px), scroll may be needed. This is handled by `overflow-x-auto` on the hand container.

---

## Recommended Next Steps

1. **Deeper single-player difficulty tiers**: Port DeepKnock/Nexus MC strategies from Python to give players selectable difficulty levels
2. **Richer match analysis**: Per-turn annotations, blunder tagging, recommended moves in replay analysis
3. **Visual showdown in replays**: Extend replay viewer to render the meld/layoff/deadwood breakdown from stored transcript data
4. **Deal and reveal animations**: Animate card dealing at round start and sequential showdown reveal for dramatic effect
5. **Tournament mode**: Multi-round bracket tournaments with entry fees and prize pools
