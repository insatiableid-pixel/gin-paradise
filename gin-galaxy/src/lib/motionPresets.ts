/**
 * Motion Presets for Gin Paradise
 *
 * Centralized animation constants and spring configs for all
 * gameplay interactions. Shared between GameRoom and MultiplayerRoom.
 *
 * Design philosophy:
 * - Motion should explain state change or add physicality
 * - Keep timing tight; competitive players should never feel delayed
 * - Favor a few strong, readable animations over many weak ones
 * - Respect reduced-motion and animation toggle preferences
 */

// ── Spring Configs ───────────────────────────────────────────────────

/** Snappy spring for card movements (draw, discard, select) */
export const CARD_SPRING = { type: "spring" as const, stiffness: 400, damping: 28 };

/** Slightly bouncier spring for emphasis moments (knock flash, turn change) */
export const EMPHASIS_SPRING = { type: "spring" as const, stiffness: 350, damping: 22 };

/** Quick tween for opacity/scale transitions */
export const QUICK_TWEEN = { duration: 0.2, ease: "easeOut" as const };

/** Slower tween for overlay entrances */
export const OVERLAY_TWEEN = { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const };

// ── Draw Animation Presets ───────────────────────────────────────────

/** Stock draw: card rises from the stock pile position */
export const STOCK_DRAW_INITIAL = { y: -60, x: -40, opacity: 0, scale: 0.8, rotate: -8 };
export const STOCK_DRAW_ANIMATE = { y: 0, x: 0, opacity: 1, scale: 1, rotate: 0 };

/** Discard draw: card slides from the discard pile position (right side) */
export const DISCARD_DRAW_INITIAL = { y: -50, x: 40, opacity: 0, scale: 0.85, rotate: 6 };
export const DISCARD_DRAW_ANIMATE = { y: 0, x: 0, opacity: 1, scale: 1, rotate: 0 };

// ── Discard Animation Presets ────────────────────────────────────────

/** Card leaving the hand toward discard pile */
export const DISCARD_EXIT = { y: -80, x: 30, opacity: 0, scale: 0.7, rotate: 8 };

/** Discard pile receiving a new card */
export const DISCARD_PILE_ENTRY_INITIAL = { y: 50, opacity: 0, scale: 0.85, rotate: 6 };
export const DISCARD_PILE_ENTRY_ANIMATE = { y: 0, opacity: 1, scale: 1, rotate: 0 };

// ── Turn State Animation Presets ────────────────────────────────────

/** Pulse animation for valid draw targets */
export const DRAW_TARGET_PULSE = {
  boxShadow: [
    "0 0 0 0px rgba(251, 191, 36, 0)",
    "0 0 0 6px rgba(251, 191, 36, 0.25)",
    "0 0 0 0px rgba(251, 191, 36, 0)",
  ],
};

/** Turn indicator entrance */
export const TURN_INDICATOR_INITIAL = { opacity: 0, y: -8 };
export const TURN_INDICATOR_ANIMATE = { opacity: 1, y: 0 };

/** Action button enable/disable transition */
export const BUTTON_ENABLE_SCALE = { scale: [0.95, 1.02, 1] };
export const BUTTON_DISABLE_SCALE = { scale: 1 };

// ── Knock / Showdown / Reveal Presets ────────────────────────────────

/** Knock flash on the felt surface */
export const KNOCK_FLASH_INITIAL = { opacity: 0.4 };
export const KNOCK_FLASH_ANIMATE = { opacity: 0 };
export const KNOCK_FLASH_DURATION = 0.5;

/** Showdown overlay entrance */
export const SHOWDOWN_OVERLAY_INITIAL = { opacity: 0 };
export const SHOWDOWN_OVERLAY_ANIMATE = { opacity: 1 };

/** Showdown panel entrance — scales up with slight spring */
export const SHOWDOWN_PANEL_INITIAL = { scale: 0.85, opacity: 0, y: 20 };
export const SHOWDOWN_PANEL_ANIMATE = { scale: 1, opacity: 1, y: 0 };

/** Showdown outcome badge — pops in after panel */
export const OUTCOME_BADGE_INITIAL = { scale: 0, opacity: 0 };
export const OUTCOME_BADGE_ANIMATE = { scale: 1, opacity: 1 };

/** Staggered card reveal in showdown */
export const SHOWDOWN_CARD_INITIAL = { opacity: 0, y: 8, scale: 0.9 };
export const SHOWDOWN_CARD_ANIMATE = { opacity: 1, y: 0, scale: 1 };
export const SHOWDOWN_CARD_STAGGER = 0.04; // seconds between each card

/** Showdown meld group reveal stagger */
export const SHOWDOWN_MELD_STAGGER = 0.12; // seconds between meld groups

// ── Deal Animation Presets ───────────────────────────────────────────

/** Opponent cards fan in during deal */
export const DEAL_FAN_INITIAL = { y: -60, opacity: 0, rotate: -8 };
export const DEAL_FAN_ANIMATE = (fanY: number, fanAngle: number) => ({
  y: fanY,
  opacity: 1,
  rotate: fanAngle,
});

/** Player hand cards cascade in during deal */
export const DEAL_HAND_INITIAL = { y: 40, opacity: 0, scale: 0.85 };
export const DEAL_HAND_ANIMATE = { y: 0, opacity: 1, scale: 1 };
export const DEAL_HAND_STAGGER = 0.04;

// ── Outcome-Specific Emphasis Colors ─────────────────────────────────

export const GIN_FLASH_COLOR = "rgba(245, 158, 11, 0.15)";    // Warm amber
export const KNOCK_FLASH_COLOR = "rgba(16, 185, 129, 0.10)";   // Emerald
export const UNDERCUT_FLASH_COLOR = "rgba(244, 63, 94, 0.12)"; // Rose

export function getOutcomeFlashColor(outcome: "gin" | "knock" | "undercut"): string {
  switch (outcome) {
    case "gin": return GIN_FLASH_COLOR;
    case "knock": return KNOCK_FLASH_COLOR;
    case "undercut": return UNDERCUT_FLASH_COLOR;
  }
}

/** Outcome-specific emphasis ring for the showdown badge */
export function getOutcomeBadgeShadow(outcome: "gin" | "knock" | "undercut"): string {
  switch (outcome) {
    case "gin": return "0 0 30px rgba(245, 158, 11, 0.4)";
    case "knock": return "0 0 20px rgba(16, 185, 129, 0.3)";
    case "undercut": return "0 0 25px rgba(244, 63, 94, 0.35)";
  }
}
