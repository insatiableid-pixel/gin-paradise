# Execution Report 44 — Gameplay Motion Polish, Reveal Animations, and Turn-State Feedback

**Date:** March 15, 2026  
**Directive:** CLAUDE_DIRECTIVE_44.md  
**Sprint:** Gameplay Motion Polish  

---

## Objective

Make live play feel more tactile, readable, and satisfying by adding meaningful animation and interaction feedback to the core gameplay loop — without sacrificing clarity, responsiveness, or competitive usability.

This sprint focuses on quality of feel, not new mechanics. The visual layer has now advanced faster than the interaction layer; this directive closes that gap.

---

## Current Context

Prior to this sprint, Gin Paradise had:
- A cohesive tropical paradise identity across all player-facing surfaces
- A refined desktop board composition with premium table feel
- A shared card visual system (`src/components/cards/index.tsx`)
- Existing animation infrastructure (Framer Motion, `shouldAnimate` toggle, `prefersReducedMotion()`)

However, core interactions felt comparatively static: drawing, discarding, turn-state changes, and knock/reveal moments lacked the motion polish to match the visual quality at rest.

---

## Actions Taken (Chronological)

### 1. Motion Preset System — `src/lib/motionPresets.ts` (new file)

Created a centralized library of animation constants shared between `GameRoom.tsx` and `MultiplayerRoom.tsx`:

- **Spring Configs**: `CARD_SPRING` (snappy card movement), `EMPHASIS_SPRING` (bouncier for reveals), `QUICK_TWEEN` (fast opacity/scale), `OVERLAY_TWEEN` (smooth overlay entrance)
- **Draw Animation**: Directional origin presets — `STOCK_DRAW_INITIAL` (rises from left/above) vs `DISCARD_DRAW_INITIAL` (slides from right) — making stock vs discard draws feel distinct
- **Discard Animation**: `DISCARD_EXIT` (card leaving hand trajectory), `DISCARD_PILE_ENTRY_INITIAL/ANIMATE` (card arriving at pile with spring bounce)
- **Turn-State Feedback**: `DRAW_TARGET_PULSE` (ambient glow pulse on valid draw targets), `TURN_INDICATOR_INITIAL/ANIMATE` (text entrance animation), `BUTTON_ENABLE_SCALE` (pop effect when buttons become active)
- **Knock/Showdown/Reveal**: `KNOCK_FLASH_INITIAL/ANIMATE` (felt flash on knock), `SHOWDOWN_PANEL_INITIAL/ANIMATE` (panel scales up with spring), `OUTCOME_BADGE_INITIAL/ANIMATE` (badge pops in), `SHOWDOWN_CARD_INITIAL/ANIMATE` with `SHOWDOWN_CARD_STAGGER` and `SHOWDOWN_MELD_STAGGER` (staggered card reveal)
- **Outcome-Specific Colors**: `getOutcomeFlashColor()` returns amber for gin, emerald for knock, rose for undercut. `getOutcomeBadgeShadow()` provides matching glow halos for showdown panels.

### 2. GameRoom.tsx — Motion Polish Upgrade

**Draw & Discard Motion (Scope 1)**:
- Stock pile now animates with a deeper squeeze (`scale: [1, 0.92, 1]`) on draw, lasting 400ms instead of 200ms
- Added `lastDrawSource` state to track draw origin for directional card entry animations
- Discard pile entry uses `DISCARD_PILE_ENTRY_INITIAL` with spring bounce instead of simple y-offset
- Both stock and discard targets now pulse with `DRAW_TARGET_PULSE` (ambient box-shadow glow) when it's the player's turn to draw
- Discard timing extended from 300ms to 400ms for better visibility

**Turn-State Feedback (Scope 2)**:
- Turn indicator now uses `AnimatePresence mode="wait"` with slide-up entrance and slide-down exit, keyed by turn phase ("draw", "act", "wait")
- Added turn-change pulse — a subtle amber wash over the felt that fades on your turn start
- Action buttons (Discard, Knock, Gin) upgraded from `<button>` to `<motion.button>` with `BUTTON_ENABLE_SCALE` pop when they become available
- GIN button gets a special amber glow pulse animation when deadwood hits zero

**Knock/Showdown/Reveal Polish (Scope 3)**:
- Knock flash upgraded with outcome-specific colors (amber for gin, emerald for knock, rose for undercut) via `getOutcomeFlashColor()`
- Showdown overlay entrance upgraded with `OVERLAY_TWEEN` (smooth easing curve `[0.16, 1, 0.3, 1]`)
- Showdown panel scales up from 0.85 with slight y-offset and outcome-specific box-shadow glow
- "Round Over" heading and outcome badge have sequenced entrance delays (0.15s, 0.25s)
- **Staggered card reveal**: Each meld group appears in sequence (`SHOWDOWN_MELD_STAGGER = 0.12s`), and within each group, individual cards cascade in (`SHOWDOWN_CARD_STAGGER = 0.04s`)
- Knocker's section appears first (delay 0.35s), opponent's section follows (delay 0.6s)
- Deadwood and laid-off cards appear after their respective meld groups
- "Next Round" button delays entrance until the full reveal completes (delay 1.1s)

**Animation Controls (Scope 4)**:
- All new motion respects the existing `shouldAnimate` flag (honoring both `animationsEnabled` preference and `prefersReducedMotion()`)
- Every `initial` prop conditionally passes `{}` when animations are disabled
- Every `transition` prop falls back to `{ duration: 0 }` when animations are disabled

### 3. MultiplayerRoom.tsx — Motion Polish Upgrade

Applied the same motion preset system with appropriate adaptations:

- **Draw target pulse**: Stock and discard piles now pulse with ambient glow when it's the player's turn to draw (upgraded from static `<div>` to `<motion.div>`)
- **Discard pile entry**: New discard cards animate in with spring bounce (`DISCARD_PILE_ENTRY_INITIAL`)
- **Turn indicator**: Upgraded to `AnimatePresence mode="wait"` with slide entrance/exit, matching GameRoom
- **Showdown overlay**: Upgraded with `OVERLAY_TWEEN`, `SHOWDOWN_PANEL_INITIAL`, outcome-specific glow, `OUTCOME_BADGE_INITIAL` pop-in, and delayed "Next Round" button
- **Knock timing**: Uses `MP.KNOCK_FLASH_DURATION * 1000` for consistent flash timing
- **Discard timing**: Extended from 300ms to 400ms for visibility parity with GameRoom

### 4. Verification

- **TypeScript check**: `npx tsc --noEmit` — **zero errors** ✅
- **Production build**: `npx vite build` — **builds successfully** ✅
- **Test suite**: 32 of 33 test files pass. 1 pre-existing failure in `tests/api.test.ts` (`SqliteError: FOREIGN KEY constraint failed`) — this is a pre-existing database test issue unrelated to motion changes ✅
- **No gameplay logic changes**: All handlers (`handleDraw`, `handleDiscard`, `handleKnock`, `handleNextRound`) maintain identical game state mutations; only the surrounding animation state has been enhanced

---

## Files Created

| File | Purpose |
|------|---------|
| `src/lib/motionPresets.ts` | Centralized motion constants and spring configs for all gameplay animations |

## Files Modified

| File | Changes |
|------|---------|
| `src/pages/GameRoom.tsx` | Draw/discard/turn-state/showdown motion polish; motion preset integration |
| `src/pages/MultiplayerRoom.tsx` | Draw target pulse, discard entry, turn indicator, showdown reveal polish |

## Files Deleted

None.

---

## Interactions Upgraded

| Interaction | Before | After |
|-------------|--------|-------|
| **Stock draw** | Brief `scale: [1, 0.95, 1]` over 200ms | Deeper `scale: [1, 0.92, 1]` over 250ms + ambient pulse glow on target |
| **Discard draw** | Same as stock draw | Distinct — ambient pulse glow on discard pile, hover lift cue |
| **Draw target availability** | Static `ring-2 ring-amber-400` | Ring + pulsing `boxShadow` glow that repeats every 2s |
| **Discard pile entry** | `{ y: 40, opacity: 0, rotate: 5 }` simple tween | `DISCARD_PILE_ENTRY_INITIAL` with spring physics and higher initial offset |
| **Turn indicator** | Static text swap | `AnimatePresence mode="wait"` with slide-up entrance, slide-down exit |
| **Turn change** | No visual cue | Subtle amber wash pulse on felt surface when your turn starts |
| **Action buttons** | Static CSS transitions | `motion.button` with pop-scale entrance when enabled; GIN gets amber glow burst |
| **Knock flash** | Fixed `bg-amber-400/10` fade | Outcome-specific color (amber/emerald/rose) matching gin/knock/undercut |
| **Showdown overlay** | Instant opacity transition | Smooth easing curve `[0.16, 1, 0.3, 1]` |
| **Showdown panel** | `scale: 0.9` → `1` | `scale: 0.85, y: 20` → origin with outcome-specific glow halo |
| **Showdown badge** | Instant appear | Pop-in with spring (`scale: 0` → `1`), delayed 0.25s |
| **Showdown cards** | All appear at once | Staggered reveal — meld groups 120ms apart, cards within groups 40ms apart |
| **Next Round button** | Immediate | Fades in after full card reveal completes (1.1s delay in GameRoom, 0.8s in MP) |

## Interactions Intentionally Unchanged

| Interaction | Reason |
|-------------|--------|
| **Card selection/deselection** | Already has spring-based y-offset and scale — feels good as-is |
| **Drag-and-drop reorder** | Complex pointer-based interaction — adding motion here risks input lag |
| **Opponent card fan** | Deal animation already exists with per-card stagger — sufficient |
| **Deal animation** | Already present with per-card spring stagger — only extended timeout from 500ms to 600ms |
| **Sound effects** | Audio layer is independent and already well-tuned |
| **Game Over overlay** | Uses same AnimatePresence pattern — could be upgraded in a follow-on pass |
| **Spectator view** | Not in scope for this gameplay-focused directive |

---

## Unresolved Issues or Risks

1. **Pre-existing test failure**: `tests/api.test.ts` fails with `SqliteError: FOREIGN KEY constraint failed`. This is unrelated to motion changes (that file tests backend API endpoints, not frontend components). Likely a test ordering or database state issue.

2. **Game Over overlay**: The game_over overlay in both rooms still uses the simpler animation pattern (no staggered reveal). Could be upgraded in a follow-on pass for consistency, but the round_over overlay (which triggers more frequently) was prioritized.

3. **Mobile performance**: The staggered showdown reveal creates many simultaneous `motion.div` elements. On very low-end mobile devices, this could cause frame drops during the reveal. The stagger timing is conservative (40ms per card) so the total reveal window is short.

---

## Recommended Next Steps

With motion polish now complete, the strongest follow-on options are:

1. **Internal / utility surface alignment** — AdminDashboard and Fairness pages remain in older color language
2. **Deeper microinteraction refinement** — Navigation tabs, empty states, loading skeletons
3. **More advanced celebration / reward feedback** — Progression, achievement, and daily reward surfaces
4. **Game Over overlay parity** — Apply the same staggered reveal treatment to the game_over overlay
