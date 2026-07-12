/**
 * Cosmetic Inventory & Store API Routes for Gin Paradise.
 *
 * Endpoints:
 *   GET  /api/cosmetics/catalog      — full catalog with ownership status
 *   GET  /api/cosmetics/inventory    — player's owned items
 *   GET  /api/cosmetics/equipped     — currently equipped cosmetics
 *   PUT  /api/cosmetics/equip        — equip/unequip a cosmetic item
 *   POST /api/cosmetics/purchase     — purchase a catalog item with soft currency
 *   POST /api/cosmetics/migrate      — migrate prestige unlocks to inventory
 */

import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { db } from "../db.js";
import {
  COSMETIC_CATALOG,
  COSMETIC_CATALOG_MAP,
  getUserInventory,
  getEquippedCosmetics,
  equipCosmetic,
  validateCatalogPurchase,
  grantCosmetic,
  migratePrestigeToInventory,
  ensureStarterItems,
  adminGrantCosmetic,
} from "../cosmetics.js";
import { requireAdmin, AdminRequest } from "../middleware/adminAuth.js";
import { getBalances, mutateBalance } from "../ledger.js";

const router = Router();

// ── GET /api/cosmetics/catalog — Full catalog with ownership status ──

router.get("/catalog", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;

  // Ensure starter items are granted
  ensureStarterItems(userId);

  // Auto-migrate prestige unlocks (idempotent)
  migratePrestigeToInventory(userId);

  const inventory = getUserInventory(userId);
  const ownedKeys = new Set(inventory.map(i => i.itemKey));

  // Also check legacy prestige table for backward compat
  const prestigeRows = db.prepare(
    "SELECT prestige_key FROM prestige WHERE user_id = ?"
  ).all(userId) as { prestige_key: string }[];
  for (const p of prestigeRows) {
    ownedKeys.add(p.prestige_key);
  }

  const catalog = COSMETIC_CATALOG.filter(c => c.available).map(item => ({
    ...item,
    owned: ownedKeys.has(item.key),
    acquiredAt: inventory.find(i => i.itemKey === item.key)?.acquiredAt || null,
  }));

  // Group by type
  const grouped: Record<string, typeof catalog> = {};
  for (const item of catalog) {
    if (!grouped[item.type]) grouped[item.type] = [];
    grouped[item.type].push(item);
  }

  // Sort each group
  for (const type of Object.keys(grouped)) {
    grouped[type].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  res.json({
    catalog,
    grouped,
    totalItems: catalog.length,
    ownedCount: catalog.filter(c => c.owned).length,
  });
});

// ── GET /api/cosmetics/inventory — Player's owned items ──────────────

router.get("/inventory", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;

  // Ensure starter items and prestige migration
  ensureStarterItems(userId);
  migratePrestigeToInventory(userId);

  const inventory = getUserInventory(userId);
  const equipped = getEquippedCosmetics(userId);

  // Group by type
  const grouped: Record<string, typeof inventory> = {};
  for (const item of inventory) {
    if (!grouped[item.itemType]) grouped[item.itemType] = [];
    grouped[item.itemType].push(item);
  }

  res.json({
    inventory,
    grouped,
    equipped,
    totalOwned: inventory.length,
  });
});

// ── GET /api/cosmetics/equipped — Currently equipped cosmetics ──────

router.get("/equipped", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const equipped = getEquippedCosmetics(userId);

  // Enrich with definitions
  const enriched: Record<string, any> = {};
  for (const [slot, key] of Object.entries(equipped)) {
    if (key) {
      const def = COSMETIC_CATALOG_MAP.get(key as string);
      enriched[slot] = {
        key,
        definition: def || null,
      };
    } else {
      enriched[slot] = { key: null, definition: null };
    }
  }

  res.json({ equipped: enriched });
});

// ── PUT /api/cosmetics/equip — Equip/unequip a cosmetic ─────────────

router.put("/equip", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const { itemKey, slot } = req.body;

  if (!slot) {
    res.status(400).json({ error: "Missing 'slot' field" });
    return;
  }

  const validSlots = ["title", "badge", "frame", "card_back", "table_theme", "emote_1", "emote_2"];
  if (!validSlots.includes(slot)) {
    res.status(400).json({ error: `Invalid slot. Valid: ${validSlots.join(", ")}` });
    return;
  }

  const result = equipCosmetic(userId, itemKey || null, slot);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  const updated = getEquippedCosmetics(userId);
  res.json({ success: true, equipped: updated });
});

// ── POST /api/cosmetics/purchase — Purchase a catalog item ──────────

router.post("/purchase", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const { itemKey } = req.body;

  if (!itemKey) {
    res.status(400).json({ error: "Missing 'itemKey' field" });
    return;
  }

  // Validate purchase
  const validation = validateCatalogPurchase(userId, itemKey);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const price = validation.price!;
  const currency = validation.currency! as "gold_coins" | "sweeps_coins";

  // Check balance
  const balances = getBalances(userId);
  const currentBalance = currency === "gold_coins" ? balances.gold_coins : balances.sweeps_coins;

  if (currentBalance < price) {
    res.status(400).json({
      error: "Insufficient balance",
      required: price,
      available: currentBalance,
      currency,
    });
    return;
  }

  // Deduct balance and grant item in a transaction
  const txn = db.transaction(() => {
    // Deduct via ledger
    mutateBalance(userId, currency, -price, "buy_in" as any, `cosmetic:${itemKey}`, `Purchased ${COSMETIC_CATALOG_MAP.get(itemKey)?.displayName || itemKey}`);
    // Grant
    grantCosmetic(userId, itemKey, "catalog", `purchase`);
  });

  try {
    txn();
  } catch (err: any) {
    res.status(500).json({ error: "Purchase failed", message: err?.message });
    return;
  }

  const def = COSMETIC_CATALOG_MAP.get(itemKey);
  res.json({
    success: true,
    item: def,
    spent: price,
    currency,
    newBalance: getBalances(userId),
  });
});

// ── POST /api/cosmetics/migrate — Migrate prestige to inventory ─────

router.post("/migrate", requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  ensureStarterItems(userId);
  const migrated = migratePrestigeToInventory(userId);
  const inventory = getUserInventory(userId);

  res.json({
    migrated,
    totalOwned: inventory.length,
    message: migrated > 0
      ? `Migrated ${migrated} prestige item${migrated > 1 ? "s" : ""} to your inventory.`
      : "All prestige items are already in your inventory.",
  });
});

// ── POST /api/cosmetics/admin/grant — Admin grant cosmetic ──────────

router.post("/admin/grant", requireAuth, requireAdmin, (req: AdminRequest, res: Response) => {
  const { userId, itemKey } = req.body;

  if (!userId || !itemKey) {
    res.status(400).json({ error: "Missing userId or itemKey" });
    return;
  }

  const result = adminGrantCosmetic(userId, itemKey, `admin:${(req as any).userId}`);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true, message: `Granted ${itemKey} to user ${userId}` });
});

export default router;
