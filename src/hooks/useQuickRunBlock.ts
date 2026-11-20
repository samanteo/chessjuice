"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Durable "Quick start" run block.
 *
 * A Quick-start run walks the user's PINNED themes in order, serving `count`
 * puzzles from each before moving on. Previously that run lived only in React
 * state: closing the tab lost it, and the running counter reported the position
 * WITHIN the current block ("1 / 6") instead of across the whole run ("1 / 80").
 *
 * This hook owns the block's durable half. It persists the block to a
 * `puzzle_trainer_*` key — the prefix the cross-device sync engine watches — so a
 * block survives a tab close and can be resumed, and it exposes the derived
 * helpers (position / total) both the counter and the button label share.
 *
 * The persisted block is deliberately the ORDERED theme-id list (duplicates
 * included: a theme may be pinned twice, which is a distinct block).
 */

/** Synced storage key (the `puzzle_trainer_` prefix opts into stateSync). */
export const QUICKRUN_STORAGE_KEY = "puzzle_trainer_quickrun";

export interface QuickRun {
  /** Ordered theme ids for every block — duplicates included, not de-duped. */
  themes: string[];
  /** Which block (theme repetition) we are on. */
  themeIndex: number;
  /** Puzzles finished WITHIN the current block. */
  done: number;
  /** Puzzles served per block. */
  count: number;
  /** Epoch ms the block was last written (diagnostics only). */
  savedAt: number;
}

/** Total puzzles across the whole run. */
export function quickRunTotal(r: Pick<QuickRun, "themes" | "count">): number {
  return r.themes.length * r.count;
}

/** 1-based global position of the puzzle currently on the board. */
export function quickRunPosition(r: QuickRun): number {
  return r.themeIndex * r.count + r.done + 1;
}

/**
 * Coerce a stored/typed block size into a valid one.
 *
 * The value lives in `puzzle_trainer_settings.quickStartCount` and has been
 * seeded by a test harness before, so it is validated on READ as well as on
 * save — a nonsense value (0, -3, 999, "abc", null) must not render a nonsense
 * block size. Unset / non-numeric falls back to 10; anything out of range is
 * clamped to 1–100.
 */
export function sanitizeQuickStartCount(v: unknown, fallback = 10): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.trunc(n)));
}

/** Structural validation for anything coming out of storage. */
function isQuickRun(p: unknown): p is QuickRun {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    Array.isArray(o.themes) &&
    o.themes.length > 0 &&
    o.themes.every((t) => typeof t === "string") &&
    typeof o.themeIndex === "number" &&
    o.themeIndex >= 0 &&
    typeof o.done === "number" &&
    o.done >= 0 &&
    typeof o.count === "number" &&
    o.count >= 1
  );
}

/** Read the stored block, or null when absent / malformed / already finished. */
function readStored(): QuickRun | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(QUICKRUN_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isQuickRun(parsed)) return null;
    const run: QuickRun = { ...parsed, savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0 };
    // A block whose position is past the last puzzle is finished — not resumable.
    if (quickRunPosition(run) > quickRunTotal(run)) return null;
    return run;
  } catch {
    return null;
  }
}

function writeStored(r: QuickRun): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(QUICKRUN_STORAGE_KEY, JSON.stringify(r));
  } catch {
    /* storage blocked — the run still works for this page's lifetime */
  }
}

function clearStored(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(QUICKRUN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Own the live run plus its durable, resumable copy.
 *
 * - `quickRun`  — the block actively running right now (null when none).
 * - `saved`     — the last durable block, mirrored from storage so the button can
 *                 offer "Continue N / total" without re-reading localStorage.
 * - `persist`   — write the durable block (or clear it with `null`); called on
 *                 start, on every advance, and on completion.
 */
export function useQuickRunBlock() {
  const [quickRun, setQuickRun] = useState<QuickRun | null>(null);
  const [saved, setSaved] = useState<QuickRun | null>(null);

  // Hydrate AFTER mount: reading localStorage during the first render risks a
  // hydration mismatch, and the sync engine may still be swapping in the
  // server's copy (a device that has never seen this key inherits it from one
  // that has).
  useEffect(() => {
    setSaved(readStored());
  }, []);

  const persist = useCallback((r: QuickRun | null) => {
    setSaved(r);
    if (r) writeStored(r);
    else clearStored();
  }, []);

  return { quickRun, setQuickRun, saved, persist };
}
