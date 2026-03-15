/**
 * Drag-and-Drop Hand Sorting for Gin Paradise.
 *
 * Provides a React hook for managing local hand order via pointer-based
 * drag-and-drop. The hand order is purely a presentation-layer concern —
 * it does not modify the underlying hand array indices or weaken
 * server-authoritative gameplay.
 *
 * Key design decisions:
 * - Uses raw pointer events (not a drag library) for minimal surface area
 * - Maintains a local display order separate from the engine's hand order
 * - Preserves original indices for action dispatch (discard/knock)
 * - Supports a reset-to-auto-sort affordance
 */

import { useState, useCallback, useRef, useEffect } from "react";

export interface DragCard {
  suit: string;
  rank: string;
  originalIndex: number;
}

export interface DragState {
  isDragging: boolean;
  dragIndex: number | null;
  dragOverIndex: number | null;
}

export interface UseHandDragReturn {
  /** The current display-order of cards (with originalIndex preserved) */
  displayHand: DragCard[];
  /** Current drag state for visual feedback */
  dragState: DragState;
  /** Whether the user has manually reordered (vs auto-sorted) */
  isCustomOrder: boolean;
  /** Call on pointer down on a card */
  onDragStart: (displayIndex: number) => void;
  /** Call on pointer enter on a card (while dragging) */
  onDragOver: (displayIndex: number) => void;
  /** Call on pointer up anywhere (ends drag, commits reorder) */
  onDragEnd: () => void;
  /** Reset to auto-sorted order */
  resetToAutoSort: () => void;
}

const SUIT_ORDER: Record<string, number> = { "♣": 0, "♦": 1, "♥": 2, "♠": 3 };
const RANK_ORDER: Record<string, number> = {
  "A": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6,
  "8": 7, "9": 8, "10": 9, "J": 10, "Q": 11, "K": 12,
};

function autoSort(cards: DragCard[]): DragCard[] {
  return [...cards].sort((a, b) => {
    const sd = (SUIT_ORDER[a.suit] ?? 0) - (SUIT_ORDER[b.suit] ?? 0);
    if (sd !== 0) return sd;
    return (RANK_ORDER[a.rank] ?? 0) - (RANK_ORDER[b.rank] ?? 0);
  });
}

function cardKey(c: DragCard): string {
  return `${c.rank}${c.suit}`;
}

/**
 * React hook for drag-and-drop hand sorting.
 *
 * @param rawHand — The current hand from the game engine (may change on draw/discard)
 * @returns The sorted/reordered display hand + drag event handlers
 */
export function useHandDrag(rawHand: Array<{ suit: string; rank: string }>): UseHandDragReturn {
  // Track the user's custom card order (by card keys)
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    dragIndex: null,
    dragOverIndex: null,
  });

  // Track the previous hand length for detecting new deals
  const prevHandLengthRef = useRef(rawHand.length);

  // When hand changes significantly (round reset), drop custom order
  useEffect(() => {
    // If hand length drops to 10 from a different length, a new deal happened
    const prevLen = prevHandLengthRef.current;
    prevHandLengthRef.current = rawHand.length;

    if (rawHand.length === 10 && prevLen !== 10 && prevLen !== 11) {
      // New round deal — reset custom order
      setCustomOrder(null);
    }
  }, [rawHand.length]);

  // Build display hand: apply custom order if set, otherwise auto-sort
  const indexedHand: DragCard[] = rawHand.map((card, i) => ({
    suit: card.suit,
    rank: card.rank,
    originalIndex: i,
  }));

  let displayHand: DragCard[];
  if (customOrder) {
    // Re-map by card keys, preserving custom order
    const byKey = new Map<string, DragCard>();
    for (const card of indexedHand) byKey.set(cardKey(card), card);

    // Keep cards that still exist, add any new cards (drawn) at the end
    const ordered: DragCard[] = [];
    for (const key of customOrder) {
      const card = byKey.get(key);
      if (card) {
        ordered.push(card);
        byKey.delete(key);
      }
    }
    // Any remaining cards (newly drawn) go at the end
    for (const card of byKey.values()) {
      ordered.push(card);
    }
    displayHand = ordered;
  } else {
    displayHand = autoSort(indexedHand);
  }

  const onDragStart = useCallback((displayIndex: number) => {
    setDragState({ isDragging: true, dragIndex: displayIndex, dragOverIndex: null });
  }, []);

  const onDragOver = useCallback((displayIndex: number) => {
    setDragState(prev => {
      if (!prev.isDragging || prev.dragIndex === null) return prev;
      if (prev.dragOverIndex === displayIndex) return prev;
      return { ...prev, dragOverIndex: displayIndex };
    });
  }, []);

  const onDragEnd = useCallback(() => {
    setDragState(prev => {
      if (!prev.isDragging || prev.dragIndex === null || prev.dragOverIndex === null) {
        return { isDragging: false, dragIndex: null, dragOverIndex: null };
      }

      const fromIdx = prev.dragIndex;
      const toIdx = prev.dragOverIndex;

      if (fromIdx !== toIdx) {
        // Commit reorder
        setCustomOrder(_prevOrder => {
          // Build current display order as keys
          const currentKeys = displayHand.map(c => cardKey(c));
          // Move card from fromIdx to toIdx
          const [moved] = currentKeys.splice(fromIdx, 1);
          currentKeys.splice(toIdx, 0, moved);
          return currentKeys;
        });
      }

      return { isDragging: false, dragIndex: null, dragOverIndex: null };
    });
  }, [displayHand]);

  const resetToAutoSort = useCallback(() => {
    setCustomOrder(null);
  }, []);

  return {
    displayHand,
    dragState,
    isCustomOrder: customOrder !== null,
    onDragStart,
    onDragOver,
    onDragEnd,
    resetToAutoSort,
  };
}

/**
 * Reorder an array by moving an element from one index to another.
 * Pure utility for testability.
 */
export function reorderArray<T>(arr: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...arr];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
}
