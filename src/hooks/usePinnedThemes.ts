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

  const pin = useCallback((themeId: string) => {
    setPinned((prev) => (prev.includes(themeId) ? prev : [...prev, themeId]));
  }, []);

  const pinMany = useCallback((themeIds: string[]) => {
    setPinned((prev) => {
      const next = [...prev];
      for (const id of themeIds) if (!next.includes(id)) next.push(id);
      return next;
    });
  }, []);

  const unpin = useCallback((themeId: string) => {
    setPinned((prev) => prev.filter((id) => id !== themeId));
  }, []);

  const toggle = useCallback((themeId: string) => {
    setPinned((prev) =>
      prev.includes(themeId) ? prev.filter((id) => id !== themeId) : [...prev, themeId]
    );
  }, []);

  const isPinned = useCallback((themeId: string) => pinned.includes(themeId), [pinned]);

  const reorder = useCallback((themeIds: string[]) => {
    setPinned(themeIds.filter((x): x is string => typeof x === "string"));
  }, []);

  const clear = useCallback(() => setPinned([]), []);

  return { pinned, loaded, pin, pinMany, unpin, toggle, isPinned, reorder, clear, PINS_KEY };
}
