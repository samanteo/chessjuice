/**
 * Per-theme Glicko-2 rating bookkeeping (pure TypeScript, no React, zero deps).
 *
 * Lichess's Puzzle Dashboard shows a rating *per theme*. When you solve a puzzle
 * tagged ['fork','pin'] the same game result is applied to every theme the puzzle
 * carries, so both 'fork' and 'pin' move; unrelated themes stay put.
 *
 * This module layers that bookkeeping on top of `./glicko2`. It keeps the
 * overall rating derivable too, so the app can display both.
 */

import {
  type Glicko,
  type GlickoOptions,
  initialGlicko,
  rateFromPuzzle,
  serializeGlicko,
  deserializeGlicko,
  type SerializedGlicko,
} from "./glicko2";

/** A per-theme rating plus simple counters. */
export interface ThemeRating extends Glicko {
  /** Number of rated attempts that carried this theme. */
  played: number;
  /** Number of those attempts that were solved. */
  correct: number;
}

/** theme key (e.g. "fork", "pin") -> rating. */
export type ThemeStore = Record<string, ThemeRating>;

export interface Attempt {
  /** Rating of the puzzle that was served. */
  puzzleRating: number;
  /** All themes the puzzle is tagged with. */
  themes: string[];
  /** Whether the user solved it. */
  solved: boolean;
}

function freshThemeRating(): ThemeRating {
  return { ...initialGlicko(), played: 0, correct: 0 };
}

/** Read a theme's rating, or the initial state if it has never been played. */
export function getTheme(store: ThemeStore, theme: string): Glicko {
  const t = store[theme];
  return t ? { rating: t.rating, deviation: t.deviation, volatility: t.volatility } : initialGlicko();
}

/** Read a theme's full record (rating + counters), or empty initial state. */
export function getThemeRecord(store: ThemeStore, theme: string): ThemeRating {
  return store[theme] ? { ...store[theme] } : freshThemeRating();
}

/**
 * Apply a single puzzle attempt to the store, returning a NEW store.
 * The same result is applied to every carried theme (Lichess behaviour);
 * themes not present on the puzzle are left untouched.
 */
export function applyAttempt(
  store: ThemeStore,
  attempt: Attempt,
  options?: GlickoOptions,
): ThemeStore {
  const { puzzleRating, themes, solved } = attempt;
  const next: ThemeStore = { ...store };
  for (const theme of themes) {
    const prev = next[theme] ?? freshThemeRating();
    const updated = rateFromPuzzle(prev, puzzleRating, solved, options);
    next[theme] = {
      ...updated,
      played: prev.played + 1,
      correct: prev.correct + (solved ? 1 : 0),
    };
  }
  return next;
}

/**
 * Derive an overall rating from the theme store.
 *
 * Lichess computes the overall ("mix") puzzle rating with its own Glicko run over
 * every attempt rather than by blending themes; this played-weighted blend of the
 * per-theme ratings is a faithful display-side approximation when only the theme
 * store is available. With no data it returns the initial Glicko.
 */
export function overall(store: ThemeStore): Glicko {
  const entries = Object.values(store).filter((t) => t.played > 0);
  if (entries.length === 0) return initialGlicko();
  let weight = 0;
  let rating = 0;
  let deviation = 0;
  let volatility = 0;
  for (const t of entries) {
    weight += t.played;
    rating += t.rating * t.played;
    deviation += t.deviation * t.played;
    volatility += t.volatility * t.played;
  }
  return {
    rating: rating / weight,
    deviation: deviation / weight,
    volatility: volatility / weight,
  };
}

/** Total rated attempts recorded across all themes (deduped per the caller's use). */
export function totalPlayed(store: ThemeStore): number {
  return Object.values(store).reduce((n, t) => n + t.played, 0);
}

// ---------------------------------------------------------------------------
// Compact serialisation for localStorage
// ---------------------------------------------------------------------------

export interface SerializedThemeRating extends SerializedGlicko {
  p: number; // played
  c: number; // correct
}
export type SerializedThemeStore = Record<string, SerializedThemeRating>;

export function serializeThemeStore(store: ThemeStore): SerializedThemeStore {
  const out: SerializedThemeStore = {};
  for (const [theme, t] of Object.entries(store)) {
    out[theme] = { ...serializeGlicko(t), p: t.played, c: t.correct };
  }
  return out;
}

export function deserializeThemeStore(s: SerializedThemeStore | null | undefined): ThemeStore {
  if (!s || typeof s !== "object") return {};
  const out: ThemeStore = {};
  for (const [theme, v] of Object.entries(s)) {
    const base = deserializeGlicko(v);
    out[theme] = { ...base, played: v.p ?? 0, correct: v.c ?? 0 };
  }
  return out;
}
