"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * localStorage key holding ONLY the pinned theme ids (a handful of strings).
 * The puzzle catalogue itself is never persisted here (localStorage ~5MB cap).
 */
export const PINS_KEY = "puzzle_trainer_pinned_themes";

/**
 * Small SSR-safe, localStorage-backed hook for the user's pinned ("quick pin")
 * themes. The list is read in an effect (never during render) so the server
 * render and first client render agree — no hydration mismatch.
 */
export function usePinnedThemes() {
  const [pinned, setPinned] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Read once on mount (client only).
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const raw = window.localStorage.getItem(PINS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setPinned(parsed.filter((x): x is string => typeof x === "string"));
          }
        }
      }
    } catch {
      // ignore malformed / unavailable storage
    }
    setLoaded(true);
  }, []);

  // Persist on change — but only after the initial read so we never clobber
  // stored pins with the empty initial state.
  useEffect(() => {
    if (!loaded) return;
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PINS_KEY, JSON.stringify(pinned));
      }
    } catch {
      // ignore quota / unavailable storage
    }
  }, [pinned, loaded]);

  /**
   * Pin a theme/opening. The SAME id may be pinned MORE THAN ONCE — each pin is
   * its own ordered block in the Quick start grid — so this ALWAYS appends a new
   * copy. Duplicates are legal: the store is a plain JSON string array.
   */
  const pin = useCallback((themeId: string) => {
    setPinned((prev) => [...prev, themeId]);
  }, []);

  /**
   * Pin several at once. Ids already present are skipped so one bulk "Pin all
   * shown" tap can never fan a single theme out into dozens of duplicates; add a
   * deliberate repeat with `pin`/`toggle` instead.
   */
  const pinMany = useCallback((themeIds: string[]) => {
    setPinned((prev) => {
      const next = [...prev];
      for (const id of themeIds) if (!next.includes(id)) next.push(id);
      return next;
    });
  }, []);

  /**
   * Remove ONE pin by its position. Index-based (not id-based) because the same
   * id can occupy several slots — removing a block must remove exactly that
   * block, never every copy.
   */
  const unpin = useCallback((index: number) => {
    setPinned((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /**
   * Toggle ADDS another pin for a theme/opening (the same id may be pinned
   * repeatedly). Removal is positional: use `unpin(index)` or the grid's × button.
   */
  const toggle = useCallback((themeId: string) => {
    setPinned((prev) => [...prev, themeId]);
  }, []);

  /** True when the id is pinned at least once (any number of copies). */
  const isPinned = useCallback((themeId: string) => pinned.includes(themeId), [pinned]);

  /** Persist a new order verbatim — duplicates and all. */
  const reorder = useCallback((themeIds: string[]) => {
    setPinned(themeIds.filter((x): x is string => typeof x === "string"));
  }, []);

  const clear = useCallback(() => setPinned([]), []);

  return { pinned, loaded, pin, pinMany, unpin, toggle, isPinned, reorder, clear, PINS_KEY };
}
