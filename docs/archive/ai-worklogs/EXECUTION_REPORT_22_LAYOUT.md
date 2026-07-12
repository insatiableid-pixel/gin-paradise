# Execution Report 22-Layout: Game Room Layout Refinement

**Date:** March 12, 2026  
**Trigger:** Post-Directive 22 demo review — user-identified regressions and design improvements  
**Status:** ✅ Complete

---

## Objective

Address the card layout regression on the game room page, fix the incorrect deadwood counter, implement a 4-row suit-based hand display with auto-sort and run-grouping, add optional 4-color deck support, and polish the overall game table aesthetics.

---

## Problems Identified

1. **Card layout regression** — the player hand was displayed as a single flat overlapping row, making it hard to read suits and spot potential runs
2. **Deadwood counter bug** — the player badge initial ("D" for DemoPlayer) + score ("0") was visually indistinguishable from a deadwood counter showing "D 0", misleading the user into thinking they had 0 deadwood when they didn't
3. **No actual deadwood counter** — despite a "Show Deadwood Count" preference toggle existing, there was no live deadwood counter during gameplay
4. **Knock button allowed invalid knocks** — the button was only disabled by draw/selection state, not by actual deadwood value, letting users attempt knocks that the engine would reject
5. **Stock/discard piles were disproportionately large** compared to hand cards
6. **Club/spade suit symbols were invisible** on the dark background (black on near-black)
7. **Turn instruction text crowded** under the stock/discard labels, causing visual overlap

---

## Actions Taken

### 1. Four-Row Suit-Based Hand Layout

Replaced the single-row overlapping card display with a **fixed-width rank grid**:

- **4 rows**: ♣, ♦, ♥, ♠ — each with a bold suit label on the left
- **Fixed column positions**: Each of the 13 ranks (A through K) has a fixed x-position in the grid
  - Aces always align on the **left margin**
  - Kings always align on the **right margin**
  - All suit rows share the same width (440px), so ranks align vertically across suits
- **Natural gap spacing**: Cards at non-adjacent ranks automatically show visible gaps because positions are determined by rank index, not sequential placement
- **Consecutive cards overlap**: Cards at adjacent ranks (e.g., 10♥-J♥) share overlapping space, visually grouping potential runs
- **Auto-sort always active**: Cards are automatically sorted by suit then rank (A→K) on every hand change

Created new `SuitRowCard` component specifically for the grid layout:
- 50px wide × 52-58px tall
- Rank + suit left-aligned in the visible overlap area
- Selected state: lifts up with indigo glow
- Meld highlighting via left-border accent (not background wash)

### 2. Proper Deadwood Counter

Added a **clearly labeled "DW" counter** in the action bar that computes deadwood correctly:

| Hand State | Computation |
|---|---|
| 10 cards (pre-draw) | `evaluateHand(hand).deadwoodValue` |
| 11 cards, card selected | `evaluateHand(hand without selected card).deadwoodValue` |
| 11 cards, no selection | Best achievable: `min over all cards: evaluateHand(hand \ {card}).deadwoodValue` |

Visual feedback:
- **Green** (`bg-emerald`) when DW ≤ 10 with a card selected (can knock)
- **Red** (`bg-rose`) when DW > 10 with a card selected (cannot knock)
- **Neutral gray** when no card is selected

### 3. Knock Button Validation

The Knock button is now **disabled when `currentDeadwood > 10`**, preventing the user from attempting invalid knocks. When a valid knock is possible, the button receives a green glow: `border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.2)]`.

### 4. Stock/Discard Pile Proportional Sizing

Reduced the PlayingCard and stock pile sizes from `w-24 h-36` (96×144px on desktop) to `w-[56px] h-[78px]`, matching the hand card proportions and creating a more cohesive visual balance.

### 5. Suit Symbol Visibility on Dark Backgrounds

Added an `onDark` parameter to `getSuitColor()` in `preferences.ts`:
- **Standard 2-color, onDark**: ♥♦ → red, ♣♠ → `text-zinc-200` (light gray)
- **Four-color, onDark**: ♣ → `text-emerald-400` (green), ♦ → `text-blue-400` (blue), ♥ → `text-red-500`, ♠ → `text-zinc-200`
- Cards on white backgrounds still use the original dark colors
- Row labels use `onDark: true`; card faces use default

### 6. Meld Highlight Redesign

Changed meld highlighting from heavy opaque background washes to **subtle left-border accents**:

Before: `bg-emerald-100/60 border-emerald-300/80` (washed out card text)  
After: `bg-emerald-50/40 border-l-[3px] border-l-emerald-500` (card text fully readable)

Five color variants for different meld groups: emerald, sky, violet, amber, rose.

### 7. Turn Instruction Text Cleanup

Moved the floating turn instruction text ("Draw a card from Stock or Discard" / "Select a card, then Discard or Knock") from a separate element between the piles and action bar **into the player badge pill** as a compact inline indicator:
- `D 0 · Draw` (draw phase)
- `D 0 · Pick & Act` (discard/knock phase)
- `D 0 · Waiting…` (opponent's turn)

This eliminates the visual crowding under the stock/discard labels.

### 8. Meld Highlighting Scope Fix

Changed `computeMeldHighlights()` input from `myHand.slice(0, 10)` to the full `myHand` array, so meld highlighting works correctly when the player has 11 cards (after drawing). This lets the player see which melds exist across all cards before deciding which to discard.

---

## Files Modified

| File | Changes |
|---|---|
| `src/pages/GameRoom.tsx` | New SuitRowCard component, 4-row rank grid layout, deadwood counter, knock validation, proportional pile sizing, inline turn indicator, meld scope fix |
| `src/lib/preferences.ts` | Added `onDark` parameter to `getSuitColor()` for dark-background suit visibility |
| `src/lib/meldHighlight.ts` | Redesigned MELD_COLORS from background wash to left-border accents |

## Files Unchanged

No new files were created. No test files were modified. No server-side changes were made.

---

## Tests

```
Test Files  20 passed (20)
     Tests  516 passed (516)
```

All 516 tests pass with zero regressions. The layout changes are purely frontend/presentation-layer and do not affect game logic or API behavior.

---

## Design Decisions

1. **Fixed-width rank grid over dynamic overlap**: Rank positions are determined by `rankIndex * (440 - 50) / 12` — approximately 32.5px per rank step. This means a card at rank position 3 is always at `3 × 32.5 = 97.5px` from the left, regardless of what other cards exist. Empty ranks create natural visual gaps.

2. **Deadwood computation for 11-card hands**: When no card is selected, we compute the minimum deadwood across all possible discards (11 calls to `evaluateHand`). With only 10-card evaluations, this is computationally trivial.

3. **onDark color system**: Rather than changing the game background from dark to light (which would break the design language), we added a third parameter to `getSuitColor()` that adapts colors for dark surfaces. This keeps the existing dark theme while making all suit symbols readable.

4. **Meld left-border accents**: A 3px colored left border is visible even when cards overlap (since the left edge is always exposed in the rank grid), while a full background wash obscured the rank/suit text.

---

## Unresolved / Future Considerations

1. **Drag-and-drop in 4-row layout**: The `useHandDrag` hook is still imported but not used in the new layout. The rank grid always auto-sorts, so manual reordering is not available. The hook could be removed or adapted for within-row drag in a future pass.

2. **Responsive sizing**: The rank grid uses a fixed 440px width. On very narrow viewports (<480px), this may need to scale down. A future pass could make `HAND_W` responsive.

3. **Empty suit rows**: Suits with no cards still show a row with a dash placeholder. This could optionally be hidden to save vertical space, though having all 4 rows always visible provides consistent layout.
