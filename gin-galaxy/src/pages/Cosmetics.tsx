/**
 * Cosmetics & Inventory Page for Gin Paradise.
 *
 * Premium cosmetic browsing surface with:
 *  - Tabbed catalog/inventory view
 *  - Visual item cards with rarity indicators and previews
 *  - One-click equip/unequip with instant feedback
 *  - Purchase flow with balance display
 *  - Prestige migration prompt
 *  - Category filtering and rarity grouping
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Package, Crown, Award, Shield, Palette, MessageCircle, CheckCircle,
  Lock, ShoppingCart, Star, Gem, Sparkles, ChevronDown, Zap, Trophy,
  Target, Swords, Flame, Calendar, DollarSign, ShieldCheck, TrendingUp,
  BookOpen, Flag, Medal, Search, Crosshair, Check, ArrowRight, Coins,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/Card";
import { Button } from "@/src/components/ui/Button";
import { cn } from "@/src/lib/utils";
import { useAuthStore } from "@/src/lib/store";

// ── Icon map ─────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  Swords, Trophy, Crown, Star, Gem, TrendingUp, Zap, Flag, Award, Medal,
  Search, Target, Crosshair, CheckCircle, BookOpen, Flame, Shield, Calendar,
  DollarSign, ShieldCheck, Package, Palette, MessageCircle,
};

// ── Types ────────────────────────────────────────────────────────────

interface CatalogItem {
  key: string;
  type: string;
  displayName: string;
  description: string;
  rarity: string;
  source: string;
  sourceAchievementId?: string;
  catalogPrice?: number;
  catalogCurrency?: string;
  preview: {
    icon?: string;
    colorClass?: string;
    gradient?: string;
    emoji?: string;
  };
  available: boolean;
  sortOrder: number;
  owned: boolean;
  acquiredAt: number | null;
}

interface InventoryItem {
  itemKey: string;
  itemType: string;
  source: string;
  sourceRef: string | null;
  acquiredAt: number;
  definition: CatalogItem | null;
}

interface EquippedState {
  selectedTitle: string | null;
  selectedBadge: string | null;
  selectedFrame: string | null;
  selectedCardBack: string;
  selectedTableTheme: string;
  selectedEmote1: string;
  selectedEmote2: string | null;
}

// ── Rarity styling ───────────────────────────────────────────────────

const RARITY_STYLES: Record<string, { bg: string; text: string; border: string; glow: string; label: string }> = {
  common: { bg: "bg-zinc-700/20", text: "text-zinc-400", border: "border-zinc-600/40", glow: "", label: "Common" },
  uncommon: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-600/30", glow: "shadow-emerald-900/10", label: "Uncommon" },
  rare: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-600/30", glow: "shadow-blue-900/10", label: "Rare" },
  epic: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-600/30", glow: "shadow-purple-900/10", label: "Epic" },
  legendary: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-600/30", glow: "shadow-amber-500/10", label: "Legendary" },
};

const TYPE_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  title: { label: "Titles", icon: Crown },
  badge: { label: "Badges", icon: Award },
  frame: { label: "Frames", icon: Shield },
  card_back: { label: "Card Backs", icon: Palette },
  table_theme: { label: "Table Themes", icon: Package },
  emote: { label: "Emotes", icon: MessageCircle },
};

const TYPE_ORDER = ["title", "badge", "frame", "card_back", "table_theme", "emote"];

// ── Component ────────────────────────────────────────────────────────

export function Cosmetics() {
  const { sessionId } = useAuthStore();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [equipped, setEquipped] = useState<EquippedState | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"catalog" | "inventory">("catalog");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [equipping, setEquipping] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [goldBalance, setGoldBalance] = useState(0);

  const fetchData = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [catRes, invRes, walletRes] = await Promise.all([
        fetch("/api/cosmetics/catalog", { headers: { Authorization: `Bearer ${sessionId}` } }),
        fetch("/api/cosmetics/inventory", { headers: { Authorization: `Bearer ${sessionId}` } }),
        fetch("/api/wallet", { headers: { Authorization: `Bearer ${sessionId}` } }),
      ]);
      const catData = await catRes.json();
      const invData = await invRes.json();
      const walletData = await walletRes.json();
      setCatalog(catData.catalog || []);
      setInventory(invData.inventory || []);
      setEquipped(invData.equipped || null);
      setGoldBalance(walletData.balances?.gold_coins || 0);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const showFeedback = (message: string, type: "success" | "error") => {
    setFeedback({ message, type });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handlePurchase = async (itemKey: string) => {
    if (!sessionId) return;
    setPurchasing(itemKey);
    try {
      const res = await fetch("/api/cosmetics/purchase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionId}`,
        },
        body: JSON.stringify({ itemKey }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showFeedback(`Purchased ${data.item?.displayName || itemKey}!`, "success");
        await fetchData();
      } else {
        showFeedback(data.error || "Purchase failed", "error");
      }
    } catch {
      showFeedback("Purchase failed", "error");
    } finally {
      setPurchasing(null);
    }
  };

  const handleEquip = async (itemKey: string | null, slot: string) => {
    if (!sessionId) return;
    setEquipping(itemKey || slot);
    try {
      const res = await fetch("/api/cosmetics/equip", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionId}`,
        },
        body: JSON.stringify({ itemKey, slot }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setEquipped(data.equipped);
        showFeedback(itemKey ? "Item equipped!" : "Item unequipped", "success");
        await fetchData();
      } else {
        showFeedback(data.error || "Equip failed", "error");
      }
    } catch {
      showFeedback("Equip failed", "error");
    } finally {
      setEquipping(null);
    }
  };

  const getSlotForType = (type: string): string => {
    switch (type) {
      case "title": return "title";
      case "badge": return "badge";
      case "frame": return "frame";
      case "card_back": return "card_back";
      case "table_theme": return "table_theme";
      case "emote": return "emote_1";
      default: return type;
    }
  };

  const isItemEquipped = (key: string): boolean => {
    if (!equipped) return false;
    return (
      equipped.selectedTitle === key ||
      equipped.selectedBadge === key ||
      equipped.selectedFrame === key ||
      equipped.selectedCardBack === key ||
      equipped.selectedTableTheme === key ||
      equipped.selectedEmote1 === key ||
      equipped.selectedEmote2 === key
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  const filteredCatalog = typeFilter
    ? catalog.filter(c => c.type === typeFilter)
    : catalog;

  const ownedCount = catalog.filter(c => c.owned).length;
  const totalCount = catalog.length;

  return (
    <div className="space-y-8 pb-20 md:pb-0 max-w-6xl mx-auto">
      {/* Feedback Toast */}
      {feedback && (
        <div className={cn(
          "fixed top-20 right-4 z-50 px-4 py-3 rounded-xl border shadow-2xl transition-all animate-in slide-in-from-right-5",
          feedback.type === "success"
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
            : "bg-red-500/10 border-red-500/30 text-red-400"
        )}>
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? <CheckCircle className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            <span className="text-sm font-medium">{feedback.message}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 shadow-lg shadow-indigo-500/20">
              <Package className="w-5 h-5 text-white" />
            </div>
            Cosmetics
          </h1>
          <p className="text-zinc-400 mt-1">
            Browse, collect, and equip cosmetic items to personalize your Gin Paradise identity.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/60">
            <Coins className="w-4 h-4 text-yellow-500" />
            <span className="text-sm font-bold text-yellow-400">{goldBalance.toLocaleString()}</span>
            <span className="text-xs text-zinc-500">Gold</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/40">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="text-xs text-zinc-400">
              {ownedCount}/{totalCount} collected
            </span>
          </div>
        </div>
      </div>

      {/* Collection Progress */}
      <Card className="bg-zinc-900/40 border-zinc-800/60">
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-zinc-300">Collection Progress</span>
            <span className="text-sm text-zinc-500">{Math.round((ownedCount / totalCount) * 100)}%</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-600 via-purple-500 to-pink-500 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${(ownedCount / totalCount) * 100}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Tab Strip */}
      <div className="flex gap-1 border-b border-zinc-800/60 pb-px">
        {(["catalog", "inventory"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-5 py-2.5 text-sm font-medium rounded-t-lg transition-colors",
              tab === t
                ? "bg-zinc-800/60 text-zinc-100 border-b-2 border-indigo-500"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30"
            )}
          >
            {t === "catalog" ? "🛒 Store" : "📦 My Collection"}
          </button>
        ))}
      </div>

      {/* Type Filter Pills */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setTypeFilter(null)}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
            !typeFilter
              ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30"
              : "bg-zinc-900/40 text-zinc-500 border-zinc-800/40 hover:text-zinc-300"
          )}
        >
          All
        </button>
        {TYPE_ORDER.map(type => {
          const info = TYPE_LABELS[type];
          if (!info) return null;
          const Icon = info.icon;
          const count = tab === "catalog"
            ? catalog.filter(c => c.type === type).length
            : inventory.filter(i => i.itemType === type).length;
          if (count === 0) return null;

          return (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                typeFilter === type
                  ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30"
                  : "bg-zinc-900/40 text-zinc-500 border-zinc-800/40 hover:text-zinc-300"
              )}
            >
              <Icon className="w-3 h-3" />
              {info.label}
              <span className="text-zinc-600">({count})</span>
            </button>
          );
        })}
      </div>

      {/* ── Catalog Tab ── */}
      {tab === "catalog" && (
        <div className="space-y-8">
          {TYPE_ORDER.map(type => {
            const items = filteredCatalog.filter(c => c.type === type);
            if (items.length === 0) return null;
            const info = TYPE_LABELS[type];
            if (!info) return null;
            const TypeIcon = info.icon;

            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-4">
                  <TypeIcon className="w-5 h-5 text-indigo-400" />
                  <h2 className="text-lg font-semibold text-zinc-200">{info.label}</h2>
                  <span className="text-xs text-zinc-500">
                    {items.filter(i => i.owned).length}/{items.length} owned
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map(item => {
                    const rarity = RARITY_STYLES[item.rarity] || RARITY_STYLES.common;
                    const IconComp = item.preview.icon ? ICON_MAP[item.preview.icon] || Package : Package;
                    const equipped_ = isItemEquipped(item.key);

                    return (
                      <div
                        key={item.key}
                        className={cn(
                          "group relative rounded-xl border p-4 transition-all duration-200",
                          item.owned
                            ? `${rarity.bg} ${rarity.border} ${rarity.glow} shadow-md hover:shadow-lg`
                            : "bg-zinc-900/20 border-zinc-800/30",
                          equipped_ && "ring-2 ring-indigo-500/50 ring-offset-1 ring-offset-zinc-950"
                        )}
                      >
                        {/* Rarity indicator strip */}
                        <div className={cn("absolute top-0 left-4 right-4 h-0.5 rounded-full", rarity.bg.replace("/10", "/40").replace("/20", "/60"))} />

                        <div className="flex items-start gap-3">
                          {/* Icon/Preview */}
                          <div className={cn(
                            "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105",
                            item.owned ? rarity.bg : "bg-zinc-800/60",
                            item.preview.gradient && item.owned ? `bg-gradient-to-br ${item.preview.gradient}` : ""
                          )}>
                            {item.preview.emoji ? (
                              <span className="text-xl">{item.preview.emoji}</span>
                            ) : (
                              <IconComp className={cn(
                                "w-6 h-6",
                                item.owned ? (item.preview.colorClass || rarity.text) : "text-zinc-600"
                              )} />
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn(
                                "text-sm font-semibold truncate",
                                item.owned ? rarity.text : "text-zinc-500"
                              )}>
                                {item.displayName}
                              </span>
                              <span className={cn(
                                "text-[10px] uppercase font-bold px-1.5 py-0.5 rounded",
                                rarity.bg, rarity.text
                              )}>
                                {rarity.label}
                              </span>
                            </div>
                            <p className={cn(
                              "text-xs mt-0.5",
                              item.owned ? "text-zinc-400" : "text-zinc-600"
                            )}>
                              {item.description}
                            </p>

                            {/* Source indicator */}
                            {item.source === "achievement" && !item.owned && (
                              <p className="text-[10px] text-amber-500/60 mt-1 flex items-center gap-1">
                                <Award className="w-3 h-3" />
                                Achievement unlock
                              </p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            {item.owned ? (
                              <>
                                {equipped_ ? (
                                  <button
                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors"
                                    onClick={() => handleEquip(null, getSlotForType(item.type))}
                                    disabled={equipping !== null}
                                  >
                                    <Check className="w-3 h-3" />
                                    Equipped
                                  </button>
                                ) : (
                                  <button
                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
                                    onClick={() => handleEquip(item.key, getSlotForType(item.type))}
                                    disabled={equipping !== null}
                                  >
                                    <ArrowRight className="w-3 h-3" />
                                    Equip
                                  </button>
                                )}
                                <span className="text-[10px] text-emerald-500 flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" />
                                  Owned
                                </span>
                              </>
                            ) : item.source === "catalog" && item.catalogPrice ? (
                              <button
                                className={cn(
                                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                                  goldBalance >= item.catalogPrice
                                    ? "bg-gradient-to-r from-amber-600 to-yellow-600 text-white shadow-lg shadow-amber-900/20 hover:from-amber-500 hover:to-yellow-500 hover:scale-105"
                                    : "bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed"
                                )}
                                onClick={() => handlePurchase(item.key)}
                                disabled={purchasing !== null || goldBalance < item.catalogPrice}
                              >
                                {purchasing === item.key ? (
                                  <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                                ) : (
                                  <Coins className="w-3 h-3" />
                                )}
                                {item.catalogPrice.toLocaleString()}
                              </button>
                            ) : (
                              <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-zinc-600">
                                <Lock className="w-3 h-3" />
                                Locked
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Inventory Tab ── */}
      {tab === "inventory" && (
        <div className="space-y-8">
          {/* Equipped Loadout */}
          {equipped && (
            <Card className="bg-gradient-to-br from-zinc-900/60 via-zinc-900/40 to-zinc-950/60 border-zinc-800/60">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  Active Loadout
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { label: "Title", key: equipped.selectedTitle, type: "title" },
                    { label: "Badge", key: equipped.selectedBadge, type: "badge" },
                    { label: "Frame", key: equipped.selectedFrame, type: "frame" },
                    { label: "Card Back", key: equipped.selectedCardBack, type: "card_back" },
                    { label: "Table Theme", key: equipped.selectedTableTheme, type: "table_theme" },
                    { label: "Emote", key: equipped.selectedEmote1, type: "emote" },
                  ].map(slot => {
                    const item = slot.key ? catalog.find(c => c.key === slot.key) : null;
                    return (
                      <div
                        key={slot.label}
                        className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/40"
                      >
                        <div className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center",
                          item ? (RARITY_STYLES[item.rarity]?.bg || "bg-zinc-800") : "bg-zinc-800/40"
                        )}>
                          {item?.preview.emoji ? (
                            <span className="text-base">{item.preview.emoji}</span>
                          ) : (
                            (() => {
                              const SlotIcon = TYPE_LABELS[slot.type]?.icon || Package;
                              return <SlotIcon className={cn(
                                "w-4 h-4",
                                item ? (item.preview.colorClass || "text-zinc-400") : "text-zinc-600"
                              )} />;
                            })()
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-zinc-500 uppercase font-medium tracking-wider">
                            {slot.label}
                          </div>
                          <div className={cn(
                            "text-sm font-medium truncate",
                            item ? "text-zinc-200" : "text-zinc-600"
                          )}>
                            {item?.displayName || "None"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Owned Items Grid */}
          {TYPE_ORDER.map(type => {
            const items = typeFilter
              ? inventory.filter(i => i.itemType === type && i.itemType === typeFilter)
              : inventory.filter(i => i.itemType === type);
            if (items.length === 0) return null;
            const info = TYPE_LABELS[type];
            if (!info) return null;
            const TypeIcon = info.icon;

            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-3">
                  <TypeIcon className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-semibold text-zinc-300">{info.label}</h3>
                  <span className="text-xs text-zinc-600">{items.length} owned</span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map(item => {
                    const def = item.definition || catalog.find(c => c.key === item.itemKey);
                    const rarity = RARITY_STYLES[def?.rarity || "common"];
                    const equipped_ = isItemEquipped(item.itemKey);
                    const IconComp = def?.preview.icon ? ICON_MAP[def.preview.icon] || Package : Package;

                    return (
                      <div
                        key={item.itemKey}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer hover:border-indigo-500/30",
                          equipped_
                            ? "bg-indigo-500/10 border-indigo-500/30"
                            : `${rarity.bg} ${rarity.border}`
                        )}
                        onClick={() => {
                          if (equipped_) {
                            handleEquip(null, getSlotForType(type));
                          } else {
                            handleEquip(item.itemKey, getSlotForType(type));
                          }
                        }}
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center",
                          rarity.bg,
                          def?.preview.gradient ? `bg-gradient-to-br ${def.preview.gradient}` : ""
                        )}>
                          {def?.preview.emoji ? (
                            <span className="text-lg">{def.preview.emoji}</span>
                          ) : (
                            <IconComp className={cn("w-5 h-5", def?.preview.colorClass || rarity.text)} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={cn("text-sm font-medium truncate", rarity.text)}>
                            {def?.displayName || item.itemKey}
                          </div>
                          <div className="text-[10px] text-zinc-500 capitalize">{item.source.replace("_", " ")}</div>
                        </div>
                        {equipped_ && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30">
                            <Check className="w-3 h-3 text-indigo-400" />
                            <span className="text-[10px] text-indigo-400 font-medium">Active</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {inventory.length === 0 && (
            <div className="text-center py-16">
              <Package className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-500">No cosmetic items yet.</p>
              <p className="text-zinc-600 text-sm mt-1">Visit the Store tab to browse and collect items!</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
