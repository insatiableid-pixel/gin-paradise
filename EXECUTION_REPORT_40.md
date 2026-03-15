# Execution Report 40: Multiplayer Visual Parity, Shared Card System, and Play-Surface Consistency

**Date:** March 15, 2026  
**Directive:** CLAUDE_DIRECTIVE_40  
**Status:** ✅ Complete

---

## Objective

Finish the visual transition from the legacy zinc/indigo game board language to the new emerald felt / warm gold Gin Paradise identity across multiplayer and adjacent play-surface components. Ensure a user moving between single-player, multiplayer, showdown states, and spectator view experiences a consistent premium product.

## Current Context (Pre-Work)

Directive 39 established a premium emerald felt + gold accent palette in `GameRoom.tsx` with branded burgundy/gold card backs, big-index card fronts, and a warm lounge aesthetic. However, `MultiplayerRoom.tsx` still used the old zinc/indigo palette — cold backgrounds, indigo selection rings, generic carbon-fiber card backs, and indigo-purple player avatars. `SpectatorView.tsx` similarly retained cold zinc backgrounds and indigo card backs. The result was that multiplayer felt like a different product from single-player.

## Actions Taken (Chronological)

### 1. Created Shared Card Visual System (`src/components/cards/index.tsx`)

Extracted all card renderers into a single shared module that serves as the canonical source of truth for all card visuals across the application:

- **PlayingCard** — standalone card (discard pile), with accent stripe and big-index design
- **OverlappingCard** — hand card with amber selection rings, accent stripes, and drag support
- **SuitRowCard** — 4-row hand layout card with accent stripe and watermark
- **CardBack** — burgundy & gold branded "Gin Paradise" back with crosshatch texture, inner frames, corner diamonds, and center branding (with `mini` variant)
- **ShowdownCardMini** — showdown overlay mini cards with accent stripes
- **SpectatorCard** — spectator discard pile display with accent stripe
- **MiniCard** — spectator showdown tiny cards with accent stripe
- **getSuitAccentColor** — shared helper for consistent suit-color accent bars

Also exported shared design constants:
- `TABLE_FELT_GRADIENT` — emerald felt radial gradient
- `TABLE_NOISE_STYLE` — SVG noise texture for felt realism
- `TABLE_BG_CLASSES` — base background color
- `SHOWDOWN_OVERLAY_BG` / `SHOWDOWN_PANEL_BG` / `SHOWDOWN_PANEL_BORDER` — showdown overlay theming
- `CARD_OVERLAP_PX` / `CARD_WIDTH` — layout constants

### 2. Refactored `GameRoom.tsx` to Use Shared Card System

- Removed all local card component definitions (~270 lines removed)
- Replaced with single import from `@/src/components/cards`
- Updated showdown overlays from zinc-950/zinc-900 backgrounds to emerald-tinted `bg-[#030d08]/90` / `bg-[#0d1a12]` with `border-emerald-800/50`
- Replaced `bg-indigo-500/20` knock badges with `bg-emerald-500/20`
- Replaced zinc dividers with emerald-tinted dividers
- Updated loading state from `bg-zinc-950` to `bg-[#0a1f15]`

### 3. Complete MultiplayerRoom Visual Parity Overhaul

Applied the full emerald felt + warm gold palette across every phase of the multiplayer experience:

**Lobby Phase:**
- Background: `bg-[#0a1f15]` with felt gradient
- Header: emerald-tinted with `bg-[#0d1a12]/90`
- Connect button: amber gradient instead of indigo
- Stake selection cards: emerald-tinted unselected state (`bg-[#0a2e1e]/50`)
- Timer/matchmaking selectors: emerald unselected states
- Join/Create room buttons: emerald borders and text
- Room code input: emerald-themed focus ring
- Section dividers: emerald-tinted

**Searching Phase:**
- Background with felt gradient and noise texture
- Header with emerald text
- Cancel button: emerald-themed

**Waiting Room Phase:**
- Background with felt gradient and noise texture
- Waiting spinner: amber instead of indigo
- Room code display: emerald-themed border
- Copy button: emerald-themed
- Players list: emerald/teal avatar gradient instead of indigo/purple
- Leave room button: emerald-themed

**Active Game Phase:**
- Root: `bg-[#0a1f15]` instead of `bg-zinc-950`
- Header: emerald-tinted `bg-[#0d1a12]/80`
- MP badge: amber instead of purple
- Back button: emerald hover states
- Table surface: shared `TABLE_FELT_GRADIENT` with noise texture
- Stock/Discard rail: `bg-[#0a2e1e]/50` with emerald border
- Stock pile: branded `CardBack` component instead of generic carbon-fiber
- Stock draw glow: amber instead of indigo
- Discard ring: amber instead of indigo
- Empty discard: emerald-themed dashed border
- Labels: emerald-tinted text
- Opponent area: `bg-[#0a2e1e]/60` with amber turn indicator border
- Opponent hidden cards: `CardBack mini` component instead of generic

**Player Area:**
- Turn phase indicators: amber (draw) and emerald (discard/knock)
- Waiting text: emerald-tinted
- Player info pill: emerald background, amber turn border, emerald/teal avatar
- Discard button: amber instead of indigo
- Sound/settings controls: emerald-themed
- Preferences panel: emerald background, emerald accent checkboxes

**Trust Shield Tooltip:**
- Emerald-themed background and text
- Emerald inactive state

**Showdown Overlays (Round Over & Game Over):**
- Background: `bg-[#030d08]/90`
- Panel: `bg-[#0d1a12]` with emerald border
- Knock badge: emerald instead of indigo
- Dividers: emerald-tinted
- Score separator: emerald-tinted
- Dashboard button: emerald-themed

### 4. SpectatorView Alignment

Brought `SpectatorView.tsx` into the emerald/gold visual world:

- All phase backgrounds: `bg-[#0a1f15]`
- Header: emerald-tinted with `bg-[#0d1a12]/90`
- Connecting spinner: amber instead of rose
- Error state: emerald-themed browse button
- Match-over: amber-themed crown box, amber "Watch Another Match" button
- Live view: felt gradient + noise texture background
- Score board: emerald/teal player avatars
- Game board: `bg-[#0a2e1e]/60` with emerald border
- Stock pile: burgundy/gold branded design
- Empty discard: emerald-themed
- Showdown panel: emerald-themed
- Knocker badge: emerald instead of indigo
- Hidden info indicator: emerald-themed
- Removed local `SpectatorCard` and `MiniCard` definitions (imported from shared module)

### 5. Selection, Highlight, and State Consistency

All interaction cues now use the warm palette consistently:

| State | Old | New |
|-------|-----|-----|
| Card selected | `ring-indigo-500`, `shadow-indigo` | `ring-amber-400`, `shadow-amber` |
| Draw available glow | `bg-indigo-500/25` | `bg-amber-500/20` |
| Discard ring | `ring-indigo-500` | `ring-amber-400` |
| Stock border active | `border-indigo-500` | `border-amber-500` |
| Player turn border | `border-indigo-500` | `border-amber-500` |
| Opponent turn border | `border-indigo-500/70` | `border-amber-500/60` |
| Drag over | `border-indigo-300/60` | `border-amber-300/60` |
| Action button primary | `bg-indigo-600` | `bg-amber-600` |
| Knocker badge | `bg-indigo-500/20` | `bg-emerald-500/20` |
| Player avatar | indigo-to-purple gradient | emerald-to-teal gradient |

Meld highlighting (emerald for melds, amber for layoffs) was already consistent and was preserved.

## Files Modified

| File | Lines Changed | Summary |
|------|---------------|---------|
| `src/components/cards/index.tsx` | Created (371 lines) | Shared card visual system with all renderers and design constants |
| `src/pages/GameRoom.tsx` | ~300 lines removed, ~30 updated | Imports shared cards, emerald-themed showdown overlays |
| `src/pages/MultiplayerRoom.tsx` | ~400 lines updated | Full emerald/gold parity across all phases |
| `src/pages/SpectatorView.tsx` | ~150 lines updated | Emerald/gold alignment, shared card imports |

## Verification Performed

### TypeScript Compilation
```
npx tsc --noEmit → 0 errors
```

### Indigo Reference Audit
All indigo references have been removed from:
- ✅ `GameRoom.tsx` — 0 remaining
- ✅ `MultiplayerRoom.tsx` — 0 remaining  
- ✅ `SpectatorView.tsx` — 0 remaining
- ✅ `src/components/cards/index.tsx` — 0 remaining

Indigo references remain in non-game pages (Wallet, SocialHub, Replays, Tournaments) which are outside the scope of this directive.

### Functional Preservation
- Drag/reorder interactions: preserved (same hook and event handling)
- Selection logic: preserved (same state management, visual-only accent change)
- Discard/knock flows: preserved (same handlers and conditions)
- Turn timers and status chips: preserved (same component structure)
- Trust shield context: preserved (same data display, themed to match)
- Showdown correctness: preserved (same data structures and rendering logic)
- Responsive usability: preserved (same breakpoint-aware sizing)
- `totalCards` prop removed from MultiplayerRoom's OverlappingCard usage (was unused by shared component)

### Visual Inconsistencies Removed

1. **Cold zinc/indigo game board vs warm emerald felt** — Now unified
2. **Generic carbon-fiber card backs vs branded Gin Paradise backs** — Now unified
3. **Indigo selection rings vs amber selection rings** — Now unified
4. **Indigo/purple player avatars vs emerald/teal** — Now unified
5. **Zinc showdown overlays vs emerald showdown overlays** — Now unified
6. **Indigo action buttons vs amber action buttons** — Now unified
7. **Separate card component definitions per file** — Now shared via `cards/index.tsx`
8. **Spectator cold background vs felt texture** — Now aligned
9. **Indigo stock/discard draw cues vs amber** — Now unified
10. **Zinc lobby/waiting/searching backgrounds vs emerald** — Now unified

## Intentionally Deferred

1. **Non-game page palette alignment** (Wallet, SocialHub, Replays, Tournaments, Dashboard, Daily Hub) — These pages still use indigo/zinc accents. They are outside the play-surface scope of this directive.
2. **Draw/discard/reveal motion animations** — Noted as a follow-up in the directive. No animation changes were made beyond preserving existing ones.
3. **Full spectator feature expansion** — Only visual alignment was performed. No new spectator features.

## Risks

- **No runtime visual verification was performed in a browser** — All validation was through code review, TypeScript compilation, and systematic indigo/zinc auditing. The risk of subtle visual issues is low but non-zero.
- **Shared card module may need adjustment** if a context-specific card variant is later needed that doesn't fit the current props.

## Recommended Next Steps

1. **Motion polish** — Draw/discard/reveal card animations for both GameRoom and MultiplayerRoom
2. **Product-wide brand alignment** — Port emerald/gold palette to Dashboard, Wallet, Daily Hub, SocialHub
3. **Spectator feature expansion** — If spectator usage grows, consider richer spectator-specific UI
4. **Card animation for showdown reveal** — Animated card flip/reveal for round-end showdown
