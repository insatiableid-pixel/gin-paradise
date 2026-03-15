/**
 * Cosmetic Inventory & Store-Ready Prestige Catalog for Gin Paradise.
 *
 * Server-backed cosmetic item catalog with:
 *  - Durable item definitions (key, type, rarity, source, previews)
 *  - Ownership tracking via `cosmetic_inventory` table
 *  - Equip/unequip flow integrated with player_profiles
 *  - Duplicate prevention via UNIQUE constraint
 *  - Prestige migration: existing prestige unlocks auto-populate inventory
 *  - Source-tracking: achievement, catalog, admin_grant, promotion
 *  - Store-ready: structured for future monetization without requiring it now
 */

import crypto from "crypto";
import { db } from "./db.js";
import { ACHIEVEMENT_MAP, getUserPrestige } from "./achievements.js";

// ── Cosmetic Type Definitions ────────────────────────────────────────

export type CosmeticType = "title" | "badge" | "frame" | "card_back" | "table_theme" | "emote";
export type CosmeticRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type CosmeticSource = "achievement" | "catalog" | "admin_grant" | "promotion" | "starter";

export interface CosmeticItemDef {
  key: string;
  type: CosmeticType;
  displayName: string;
  description: string;
  rarity: CosmeticRarity;
  source: CosmeticSource;
  /** Achievement ID that unlocks this, if source is 'achievement' */
  sourceAchievementId?: string;
  /** Soft-currency price for catalog items (0 = free / unlockable only) */
  catalogPrice?: number;
  /** Currency for catalog purchase */
  catalogCurrency?: "gold_coins" | "sweeps_coins";
  /** Preview metadata for UI rendering */
  preview: {
    icon?: string;        // lucide icon name
    colorClass?: string;  // CSS class for theming
    gradient?: string;    // gradient specification
    emoji?: string;       // optional emoji for quick display
  };
  /** Whether the item is currently available in the catalog */
  available: boolean;
  /** Sort order within its category */
  sortOrder: number;
}

// ── Cosmetic Catalog ─────────────────────────────────────────────────
// The canonical catalog of all cosmetic items. Achievement-sourced items
// are auto-derived from ACHIEVEMENT_DEFINITIONS; catalog/promotion items
// are defined here directly.

export const COSMETIC_CATALOG: CosmeticItemDef[] = [
  // ── Achievement-Sourced Titles ──
  { key: "competitor", type: "title", displayName: "Competitor", description: "Earned by winning 50 matches", rarity: "uncommon", source: "achievement", sourceAchievementId: "win_50", preview: { icon: "Trophy", colorClass: "text-zinc-300" }, available: true, sortOrder: 10 },
  { key: "centurion", type: "title", displayName: "Centurion", description: "Earned by winning 100 matches", rarity: "rare", source: "achievement", sourceAchievementId: "win_100", preview: { icon: "Trophy", colorClass: "text-yellow-500" }, available: true, sortOrder: 20 },
  { key: "gin_master", type: "title", displayName: "Gin Master", description: "Earned by winning 500 matches", rarity: "legendary", source: "achievement", sourceAchievementId: "win_500", preview: { icon: "Crown", colorClass: "text-amber-400" }, available: true, sortOrder: 30 },
  { key: "expert", type: "title", displayName: "Expert", description: "Earned by reaching 1600 rating", rarity: "rare", source: "achievement", sourceAchievementId: "rating_1600", preview: { icon: "Star", colorClass: "text-yellow-500" }, available: true, sortOrder: 40 },
  { key: "elite", type: "title", displayName: "Elite", description: "Earned by reaching 1800 rating", rarity: "legendary", source: "achievement", sourceAchievementId: "rating_1800", preview: { icon: "Gem", colorClass: "text-cyan-400" }, available: true, sortOrder: 50 },
  { key: "champion", type: "title", displayName: "Champion", description: "Earned by winning a tournament", rarity: "epic", source: "achievement", sourceAchievementId: "tournament_win", preview: { icon: "Award", colorClass: "text-amber-500" }, available: true, sortOrder: 60 },
  { key: "precision", type: "title", displayName: "Precision", description: "Earned by achieving 90%+ engine accuracy", rarity: "rare", source: "achievement", sourceAchievementId: "accuracy_90", preview: { icon: "Crosshair", colorClass: "text-emerald-400" }, available: true, sortOrder: 70 },
  { key: "unstoppable", type: "title", displayName: "Unstoppable", description: "Earned by winning 10 matches in a row", rarity: "epic", source: "achievement", sourceAchievementId: "win_streak_10", preview: { icon: "Flame", colorClass: "text-orange-500" }, available: true, sortOrder: 80 },
  { key: "veteran", type: "title", displayName: "Veteran", description: "Earned by playing 100 matches", rarity: "uncommon", source: "achievement", sourceAchievementId: "matches_played_100", preview: { icon: "Shield", colorClass: "text-zinc-300" }, available: true, sortOrder: 90 },

  // ── Achievement-Sourced Badges ──
  { key: "newcomer", type: "badge", displayName: "Newcomer", description: "Earned by playing your first match", rarity: "common", source: "achievement", sourceAchievementId: "first_match", preview: { icon: "Swords", colorClass: "text-amber-600", emoji: "🗡️" }, available: true, sortOrder: 10 },
  { key: "rising_star", type: "badge", displayName: "Rising Star", description: "Earned by reaching 1400 rating", rarity: "uncommon", source: "achievement", sourceAchievementId: "rating_1400", preview: { icon: "TrendingUp", colorClass: "text-zinc-300", emoji: "⭐" }, available: true, sortOrder: 20 },
  { key: "gin_strike", type: "badge", displayName: "Gin Strike", description: "Earned by winning with 0 deadwood", rarity: "uncommon", source: "achievement", sourceAchievementId: "first_gin", preview: { icon: "Zap", colorClass: "text-yellow-400", emoji: "⚡" }, available: true, sortOrder: 30 },
  { key: "sharp", type: "badge", displayName: "Sharp", description: "Earned by achieving 80%+ engine accuracy", rarity: "uncommon", source: "achievement", sourceAchievementId: "accuracy_80", preview: { icon: "Target", colorClass: "text-emerald-400", emoji: "🎯" }, available: true, sortOrder: 40 },
  { key: "clean_sheet", type: "badge", displayName: "Clean Sheet", description: "Earned by completing a match with zero blunders", rarity: "uncommon", source: "achievement", sourceAchievementId: "no_blunders", preview: { icon: "CheckCircle", colorClass: "text-emerald-500", emoji: "✅" }, available: true, sortOrder: 50 },
  { key: "on_fire", type: "badge", displayName: "On Fire", description: "Earned by winning 5 matches in a row", rarity: "uncommon", source: "achievement", sourceAchievementId: "win_streak_5", preview: { icon: "Flame", colorClass: "text-orange-500", emoji: "🔥" }, available: true, sortOrder: 60 },
  { key: "dedicated", type: "badge", displayName: "Dedicated", description: "Earned by playing on 7 different days", rarity: "uncommon", source: "achievement", sourceAchievementId: "daily_player_7", preview: { icon: "Calendar", colorClass: "text-indigo-400", emoji: "📅" }, available: true, sortOrder: 70 },
  { key: "high_roller", type: "badge", displayName: "High Roller", description: "Earned by winning a staked match", rarity: "rare", source: "achievement", sourceAchievementId: "staked_win", preview: { icon: "DollarSign", colorClass: "text-green-400", emoji: "💰" }, available: true, sortOrder: 80 },
  { key: "trust_verified", type: "badge", displayName: "Trust Verified", description: "Earned by verifying a fairness proof", rarity: "common", source: "achievement", sourceAchievementId: "proof_verified", preview: { icon: "ShieldCheck", colorClass: "text-blue-400", emoji: "🛡️" }, available: true, sortOrder: 90 },

  // ── Achievement-Sourced Frames ──
  { key: "champion_frame", type: "frame", displayName: "Champion Frame", description: "Earned by winning 3 tournaments", rarity: "legendary", source: "achievement", sourceAchievementId: "tournament_win_3", preview: { icon: "Medal", colorClass: "text-yellow-500", gradient: "from-yellow-500/60 to-amber-600/60" }, available: true, sortOrder: 10 },

  // ── Catalog Card Backs (purchasable with gold coins) ──
  { key: "classic_red", type: "card_back", displayName: "Classic Red", description: "The timeless red card back", rarity: "common", source: "starter", preview: { colorClass: "text-red-500", gradient: "from-red-700 to-red-900", emoji: "🟥" }, available: true, sortOrder: 10 },
  { key: "midnight_blue", type: "card_back", displayName: "Midnight Blue", description: "A deep navy card back with subtle shimmer", rarity: "uncommon", source: "catalog", catalogPrice: 500, catalogCurrency: "gold_coins", preview: { colorClass: "text-blue-400", gradient: "from-blue-800 to-indigo-950", emoji: "🔵" }, available: true, sortOrder: 20 },
  { key: "emerald_felt", type: "card_back", displayName: "Emerald Felt", description: "Inspired by classic casino tables", rarity: "uncommon", source: "catalog", catalogPrice: 500, catalogCurrency: "gold_coins", preview: { colorClass: "text-emerald-400", gradient: "from-emerald-700 to-emerald-900", emoji: "🟢" }, available: true, sortOrder: 30 },
  { key: "royal_purple", type: "card_back", displayName: "Royal Purple", description: "Rich purple with gold accents", rarity: "rare", source: "catalog", catalogPrice: 1500, catalogCurrency: "gold_coins", preview: { colorClass: "text-purple-400", gradient: "from-purple-700 to-violet-950", emoji: "🟣" }, available: true, sortOrder: 40 },
  { key: "golden_luxury", type: "card_back", displayName: "Golden Luxury", description: "For those who demand the finest", rarity: "epic", source: "catalog", catalogPrice: 5000, catalogCurrency: "gold_coins", preview: { colorClass: "text-yellow-400", gradient: "from-yellow-600 to-amber-800", emoji: "✨" }, available: true, sortOrder: 50 },
  { key: "obsidian", type: "card_back", displayName: "Obsidian", description: "Sleek black with subtle diamond pattern", rarity: "legendary", source: "catalog", catalogPrice: 10000, catalogCurrency: "gold_coins", preview: { colorClass: "text-zinc-300", gradient: "from-zinc-800 to-zinc-950", emoji: "🖤" }, available: true, sortOrder: 60 },

  // ── Catalog Table Themes ──
  { key: "classic_green", type: "table_theme", displayName: "Classic Green", description: "The traditional felt table", rarity: "common", source: "starter", preview: { colorClass: "text-green-500", gradient: "from-green-800 to-green-950", emoji: "🃏" }, available: true, sortOrder: 10 },
  { key: "midnight_lounge", type: "table_theme", displayName: "Midnight Lounge", description: "Dark and sophisticated atmosphere", rarity: "uncommon", source: "catalog", catalogPrice: 750, catalogCurrency: "gold_coins", preview: { colorClass: "text-slate-400", gradient: "from-slate-800 to-slate-950", emoji: "🌙" }, available: true, sortOrder: 20 },
  { key: "sunset_parlor", type: "table_theme", displayName: "Sunset Parlor", description: "Warm amber tones for a relaxed vibe", rarity: "rare", source: "catalog", catalogPrice: 2000, catalogCurrency: "gold_coins", preview: { colorClass: "text-amber-400", gradient: "from-amber-800 to-orange-950", emoji: "🌅" }, available: true, sortOrder: 30 },

  // ── Catalog Emotes ──
  { key: "gg", type: "emote", displayName: "GG", description: "Good game!", rarity: "common", source: "starter", preview: { emoji: "🤝", colorClass: "text-blue-400" }, available: true, sortOrder: 10 },
  { key: "nice_hand", type: "emote", displayName: "Nice Hand", description: "Tip your hat to a great play", rarity: "uncommon", source: "catalog", catalogPrice: 200, catalogCurrency: "gold_coins", preview: { emoji: "👏", colorClass: "text-amber-400" }, available: true, sortOrder: 20 },
  { key: "think", type: "emote", displayName: "Thinking...", description: "Show you're carefully considering", rarity: "uncommon", source: "catalog", catalogPrice: 200, catalogCurrency: "gold_coins", preview: { emoji: "🤔", colorClass: "text-purple-400" }, available: true, sortOrder: 30 },
  { key: "lucky", type: "emote", displayName: "Lucky!", description: "When fortune smiles on you", rarity: "rare", source: "catalog", catalogPrice: 500, catalogCurrency: "gold_coins", preview: { emoji: "🍀", colorClass: "text-emerald-400" }, available: true, sortOrder: 40 },
];

export const COSMETIC_CATALOG_MAP = new Map(COSMETIC_CATALOG.map(c => [c.key, c]));

// ── Database Schema ──────────────────────────────────────────────────

export function initializeCosmeticTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cosmetic_inventory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_key TEXT NOT NULL,
      item_type TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'achievement',
      source_ref TEXT,
      acquired_at INTEGER NOT NULL,
      UNIQUE(user_id, item_key),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_cosmetic_inv_user ON cosmetic_inventory(user_id);
    CREATE INDEX IF NOT EXISTS idx_cosmetic_inv_user_type ON cosmetic_inventory(user_id, item_type);
  `);

  // Add cosmetic equip columns to player_profiles if not present
  try { db.exec("ALTER TABLE player_profiles ADD COLUMN selected_card_back TEXT DEFAULT 'classic_red'"); } catch {}
  try { db.exec("ALTER TABLE player_profiles ADD COLUMN selected_table_theme TEXT DEFAULT 'classic_green'"); } catch {}
  try { db.exec("ALTER TABLE player_profiles ADD COLUMN selected_emote_1 TEXT DEFAULT 'gg'"); } catch {}
  try { db.exec("ALTER TABLE player_profiles ADD COLUMN selected_emote_2 TEXT"); } catch {}
}

// ── Ownership / Inventory ────────────────────────────────────────────

export interface OwnedItem {
  itemKey: string;
  itemType: CosmeticType;
  source: CosmeticSource;
  sourceRef: string | null;
  acquiredAt: number;
  definition: CosmeticItemDef | null;
}

/**
 * Grant a cosmetic item to a user. Uses INSERT OR IGNORE for idempotency.
 * Returns whether it was newly granted.
 */
export function grantCosmetic(
  userId: string,
  itemKey: string,
  source: CosmeticSource,
  sourceRef?: string
): { granted: boolean; duplicate: boolean } {
  const def = COSMETIC_CATALOG_MAP.get(itemKey);
  if (!def) return { granted: false, duplicate: false };

  const id = crypto.randomUUID();
  const now = Date.now();

  const result = db.prepare(`
    INSERT OR IGNORE INTO cosmetic_inventory (id, user_id, item_key, item_type, source, source_ref, acquired_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, itemKey, def.type, source, sourceRef || null, now);

  if (result.changes > 0) {
    return { granted: true, duplicate: false };
  }
  return { granted: false, duplicate: true };
}

/**
 * Get all owned cosmetic items for a user.
 */
export function getUserInventory(userId: string): OwnedItem[] {
  const rows = db.prepare(`
    SELECT item_key, item_type, source, source_ref, acquired_at
    FROM cosmetic_inventory
    WHERE user_id = ?
    ORDER BY acquired_at DESC
  `).all(userId) as { item_key: string; item_type: string; source: string; source_ref: string | null; acquired_at: number }[];

  return rows.map(r => ({
    itemKey: r.item_key,
    itemType: r.item_type as CosmeticType,
    source: r.source as CosmeticSource,
    sourceRef: r.source_ref,
    acquiredAt: r.acquired_at,
    definition: COSMETIC_CATALOG_MAP.get(r.item_key) || null,
  }));
}

/**
 * Check if a user owns a specific cosmetic item.
 */
export function userOwnsItem(userId: string, itemKey: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM cosmetic_inventory WHERE user_id = ? AND item_key = ?"
  ).get(userId, itemKey);
  return !!row;
}

/**
 * Get equipped cosmetic selections for a user.
 */
export function getEquippedCosmetics(userId: string): {
  selectedTitle: string | null;
  selectedBadge: string | null;
  selectedFrame: string | null;
  selectedCardBack: string;
  selectedTableTheme: string;
  selectedEmote1: string;
  selectedEmote2: string | null;
} {
  const row = db.prepare(`
    SELECT selected_title, selected_badge, selected_frame,
           selected_card_back, selected_table_theme,
           selected_emote_1, selected_emote_2
    FROM player_profiles
    WHERE user_id = ?
  `).get(userId) as any;

  return {
    selectedTitle: row?.selected_title || null,
    selectedBadge: row?.selected_badge || null,
    selectedFrame: row?.selected_frame || null,
    selectedCardBack: row?.selected_card_back || "classic_red",
    selectedTableTheme: row?.selected_table_theme || "classic_green",
    selectedEmote1: row?.selected_emote_1 || "gg",
    selectedEmote2: row?.selected_emote_2 || null,
  };
}

/**
 * Equip a cosmetic item. Validates ownership before equipping.
 */
export function equipCosmetic(
  userId: string,
  itemKey: string | null,
  slot: "title" | "badge" | "frame" | "card_back" | "table_theme" | "emote_1" | "emote_2"
): { success: boolean; error?: string } {
  // Allow unequip (null)
  if (itemKey === null || itemKey === "") {
    // Starter items can't be unequipped for card_back and table_theme
    if (slot === "card_back") {
      _updateEquipSlot(userId, slot, "classic_red");
      return { success: true };
    }
    if (slot === "table_theme") {
      _updateEquipSlot(userId, slot, "classic_green");
      return { success: true };
    }
    if (slot === "emote_1") {
      _updateEquipSlot(userId, slot, "gg");
      return { success: true };
    }
    _updateEquipSlot(userId, slot, null);
    return { success: true };
  }

  const def = COSMETIC_CATALOG_MAP.get(itemKey);
  if (!def) return { success: false, error: "Unknown item" };

  // Validate slot matches item type
  const slotTypeMap: Record<string, CosmeticType | CosmeticType[]> = {
    title: "title",
    badge: "badge",
    frame: "frame",
    card_back: "card_back",
    table_theme: "table_theme",
    emote_1: "emote",
    emote_2: "emote",
  };
  const expectedType = slotTypeMap[slot];
  const typeMatch = Array.isArray(expectedType)
    ? expectedType.includes(def.type)
    : def.type === expectedType;
  if (!typeMatch) return { success: false, error: "Item type does not match slot" };

  // Starter items are always available without explicit ownership
  if (def.source === "starter") {
    _updateEquipSlot(userId, slot, itemKey);
    return { success: true };
  }

  // For prestige items (title/badge/frame from achievements), check both
  // cosmetic_inventory AND the legacy prestige table
  if (def.source === "achievement" && (def.type === "title" || def.type === "badge" || def.type === "frame")) {
    const ownsInInventory = userOwnsItem(userId, itemKey);
    const ownsInPrestige = db.prepare(
      "SELECT 1 FROM prestige WHERE user_id = ? AND prestige_key = ?"
    ).get(userId, itemKey);

    if (!ownsInInventory && !ownsInPrestige) {
      return { success: false, error: "Item not owned" };
    }
  } else {
    if (!userOwnsItem(userId, itemKey)) {
      return { success: false, error: "Item not owned" };
    }
  }

  _updateEquipSlot(userId, slot, itemKey);
  return { success: true };
}

function _updateEquipSlot(userId: string, slot: string, value: string | null): void {
  const columnMap: Record<string, string> = {
    title: "selected_title",
    badge: "selected_badge",
    frame: "selected_frame",
    card_back: "selected_card_back",
    table_theme: "selected_table_theme",
    emote_1: "selected_emote_1",
    emote_2: "selected_emote_2",
  };

  const column = columnMap[slot];
  if (!column) return;

  // Ensure profile row exists
  db.prepare(`
    INSERT OR IGNORE INTO player_profiles (user_id, updated_at)
    VALUES (?, ?)
  `).run(userId, Date.now());

  db.prepare(`
    UPDATE player_profiles SET ${column} = ?, updated_at = ? WHERE user_id = ?
  `).run(value, Date.now(), userId);
}

// ── Prestige Migration ───────────────────────────────────────────────

/**
 * Migrate existing prestige unlocks into the cosmetic inventory.
 * Safe to call multiple times — uses INSERT OR IGNORE.
 * Returns the number of newly migrated items.
 */
export function migratePrestigeToInventory(userId: string): number {
  const prestige = getUserPrestige(userId);
  let migrated = 0;

  for (const p of prestige) {
    // Find matching catalog item
    const catalogItem = COSMETIC_CATALOG.find(
      c => c.key === p.key && c.type === p.type && c.source === "achievement"
    );

    if (catalogItem) {
      const result = grantCosmetic(userId, catalogItem.key, "achievement", p.sourceAchievement);
      if (result.granted) migrated++;
    }
  }

  return migrated;
}

/**
 * Grant starter items to a user (items with source 'starter').
 * Called on first cosmetic access or inventory load.
 */
export function ensureStarterItems(userId: string): void {
  const starters = COSMETIC_CATALOG.filter(c => c.source === "starter");
  for (const item of starters) {
    grantCosmetic(userId, item.key, "starter");
  }
}

// ── Catalog Purchase ─────────────────────────────────────────────────

/**
 * Attempt to purchase a catalog item with soft currency.
 * Returns success/error. Does NOT handle balance deduction — caller must
 * coordinate with the wallet/ledger system.
 */
export function validateCatalogPurchase(
  userId: string,
  itemKey: string
): { valid: boolean; error?: string; price?: number; currency?: string } {
  const def = COSMETIC_CATALOG_MAP.get(itemKey);
  if (!def) return { valid: false, error: "Unknown item" };
  if (!def.available) return { valid: false, error: "Item not currently available" };
  if (def.source !== "catalog") return { valid: false, error: "Item is not purchasable" };
  if (!def.catalogPrice || def.catalogPrice <= 0) return { valid: false, error: "Item has no price set" };

  // Check for duplicate ownership
  if (userOwnsItem(userId, itemKey)) {
    return { valid: false, error: "Already owned" };
  }

  return {
    valid: true,
    price: def.catalogPrice,
    currency: def.catalogCurrency || "gold_coins",
  };
}

// ── Admin Grant ──────────────────────────────────────────────────────

/**
 * Admin grant of a cosmetic item. Bypasses purchase validation.
 */
export function adminGrantCosmetic(
  userId: string,
  itemKey: string,
  adminRef?: string
): { success: boolean; error?: string } {
  const def = COSMETIC_CATALOG_MAP.get(itemKey);
  if (!def) return { success: false, error: "Unknown item" };

  const result = grantCosmetic(userId, itemKey, "admin_grant", adminRef);
  if (result.duplicate) return { success: false, error: "Already owned" };
  return { success: true };
}
