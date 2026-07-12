/**
 * Player Preferences Store for Gin Paradise.
 *
 * Lightweight Zustand store persisted to localStorage.
 * Manages optional display and interaction preferences:
 * - showDeadwoodCount: Show/hide deadwood count during play (default: true)
 * - fourColorDeck: Enable/disable four-color deck rendering (default: false)
 *   Standard: ♥♦ red, ♣♠ black
 *   Four-color: ♠ black, ♥ red, ♦ blue, ♣ green
 * - soundEnabled: Enable/disable audio feedback for table actions (default: true)
 * - animationsEnabled: Enable/disable enhanced animations (default: true)
 */

import { create } from "zustand";

const STORAGE_KEY = "gin-paradise-prefs";
const LEGACY_STORAGE_KEY = "gin-galaxy-prefs";

/**
 * One-time migration: copy preferences from the old key to the new key
 * so existing users don't lose their settings after the rename.
 */
function migrateStorageKey(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return; // Already migrated or fresh install
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      localStorage.setItem(STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {}
}

// Run migration once on module load
migrateStorageKey();

export type AiTierPref = "club" | "expert";

interface PreferencesState {
  showDeadwoodCount: boolean;
  fourColorDeck: boolean;
  soundEnabled: boolean;
  animationsEnabled: boolean;
  /** Club = local TS Apex; Expert = ApexMCTS draw-search service with Club fallback */
  aiTier: AiTierPref;
  setShowDeadwoodCount: (show: boolean) => void;
  setFourColorDeck: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setAnimationsEnabled: (enabled: boolean) => void;
  setAiTier: (tier: AiTierPref) => void;
}

interface StoredPrefs {
  showDeadwoodCount: boolean;
  fourColorDeck: boolean;
  soundEnabled: boolean;
  animationsEnabled: boolean;
  aiTier: AiTierPref;
}

function loadPrefs(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const tier = parsed.aiTier === "expert" ? "expert" : "club";
      return {
        showDeadwoodCount: parsed.showDeadwoodCount ?? true,
        fourColorDeck: parsed.fourColorDeck ?? false,
        soundEnabled: parsed.soundEnabled ?? true,
        animationsEnabled: parsed.animationsEnabled ?? true,
        // Sprint 2 default: Expert (falls back to Club if service down)
        aiTier: parsed.aiTier != null ? tier : "expert",
      };
    }
  } catch {}
  return {
    showDeadwoodCount: true,
    fourColorDeck: false,
    soundEnabled: true,
    animationsEnabled: true,
    aiTier: "expert",
  };
}

function savePrefs(prefs: StoredPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

function persistFrom(get: () => PreferencesState): void {
  const {
    showDeadwoodCount,
    fourColorDeck,
    soundEnabled,
    animationsEnabled,
    aiTier,
  } = get();
  savePrefs({ showDeadwoodCount, fourColorDeck, soundEnabled, animationsEnabled, aiTier });
}

export const usePreferences = create<PreferencesState>((set, get) => {
  const initial = loadPrefs();
  return {
    ...initial,
    setShowDeadwoodCount: (show) => {
      set({ showDeadwoodCount: show });
      persistFrom(get);
    },
    setFourColorDeck: (enabled) => {
      set({ fourColorDeck: enabled });
      persistFrom(get);
    },
    setSoundEnabled: (enabled) => {
      set({ soundEnabled: enabled });
      persistFrom(get);
    },
    setAnimationsEnabled: (enabled) => {
      set({ animationsEnabled: enabled });
      persistFrom(get);
    },
    setAiTier: (tier) => {
      set({ aiTier: tier });
      persistFrom(get);
    },
  };
});

/**
 * Returns the CSS color class for a card suit.
 * Depends on whether four-color deck is enabled.
 */
export function getSuitColor(suit: string, fourColor: boolean, onDark: boolean = false): string {
  if (!fourColor) {
    // Standard two-color: red for hearts/diamonds, light/dark for spades/clubs
    if (suit === "♥" || suit === "♦") return "text-red-600";
    return onDark ? "text-zinc-200" : "text-zinc-900";
  }
  // Four-color deck:
  switch (suit) {
    case "♠":
      return onDark ? "text-zinc-200" : "text-zinc-900"; // White on dark, Black on light
    case "♥":
      return "text-red-500"; // Red
    case "♦":
      return "text-blue-400"; // Blue
    case "♣":
      return "text-emerald-400"; // Green
    default:
      return onDark ? "text-zinc-200" : "text-zinc-900";
  }
}

export function getSuitAccentColor(suit: string, fourColor: boolean = false): string {
  if (suit === "♥") return "#dc2626";
  if (suit === "♦") return fourColor ? "#2563eb" : "#dc2626";
  if (suit === "♣") return fourColor ? "#16a34a" : "#15803d";
  if (suit === "♠") return fourColor ? "#1a1a2e" : "#334155";
  return "#1a1a2e";
}
