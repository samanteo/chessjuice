"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { UserPuzzle, UserSettings, PuzzleAttempt, QueueType, QueueCounts, LichessTheme, DEFAULT_SETTINGS } from "@/types";
import { createInitialWrongPuzzleState, createInitialCorrectState, calculateNextState, getQueueType, SM2State } from "@/lib/sm2";
import { resolveAngle } from "@/lib/historySessions";
import { fetchPuzzlesByIds, fetchThemeCounts, fetchOpeningCounts, type DispensedPuzzle } from "@/lib/dispenseClient";
import {
  DashboardAggregate,
  emptyAggregate,
  recordIntoAggregate,
  buildAggregateFromAttempts,
  pruneAggregate,
  dayKey,
} from "@/components/dashboard/dashboardStats";
import {
  RatingState,
  initialRatingState,
  serializeRatingState,
  deserializeRatingState,
  applyPuzzleResult,
  shouldFlushSession,
} from "@/lib/ratingPipeline";

// ---------------------------------------------------------------------------
// Storage strategy
// ---------------------------------------------------------------------------
// The puzzle catalog (100k+ puzzles) is WAY too big for localStorage (~5MB cap)
// so it is NEVER persisted. It is hydrated on demand from /api/puzzles (the
// catalogue lives server-side in data/puzzles.sqlite).
// Only per-puzzle PROGRESS for puzzles the user actually attempted is persisted,
// plus settings and recent attempts.
// ---------------------------------------------------------------------------
const STORAGE_KEYS = {
  PROGRESS: "puzzle_trainer_progress_v2",
  SETTINGS: "puzzle_trainer_settings",
  ATTEMPTS: "puzzle_trainer_attempts",
  USER_ID: "puzzle_trainer_user_id",
  // Compact all-time per-theme aggregate. Kept SEPARATE from the rolling
  // attempts buffer so long-term numbers never truncate.
  THEME_AGG: "puzzle_trainer_theme_agg_v1",
  // Per-day rollup of Lichess dashboard results (nb/wins/fixed/sumRating),
  // written on every scored attempt. Drives the long-period dashboard views so
  // they never truncate when the attempts buffer is capped.
  DASHBOARD_AGG: "puzzle_trainer_dashboard_agg_v1",
  // Glicko-2 rating state (overall + per-theme). Written on every scored
  // attempt; the source of truth for the user's rating (replaces the old flat
  // single-integer `settings.rating`).
  GLICKO: "puzzle_trainer_glicko_v1",
} as const;

// Rolling buffer of timestamped attempts used for DATE-WINDOWED stats (7/30/90d).
const MAX_ATTEMPTS = 2000;

// All-time per-theme aggregate (small, one record per theme).
// Written on every scored attempt; the source of truth for "all time" numbers.
//   played    = # of scored attempts (result 'correct' | 'incorrect' | 'hard')
//   correct   = # of those that were 'correct'
//   sumRating = Σ puzzle.rating over those attempts (for the mean)
//   lastPlayed= ISO timestamp of the most recent scored attempt in the theme
export interface ThemeAggEntry {
  played: number;
  correct: number;
  sumRating: number;
  lastPlayed: string;
}
export type ThemeAggMap = Record<string, ThemeAggEntry>;

// Compact progress record (short keys keep localStorage small)
interface ProgressEntry {
  rg: number; // rung (ladder position; 8 = mastered)
  due: string; // dueDate ISO
  wr: 0 | 1; // isWrongPuzzle
  at: number; // attempts
  co: number; // correctAttempts
  lm?: string; // last move/timestamp optional
  rm?: string; // removedAt ISO
}

type ProgressMap = Record<string, ProgressEntry>;

function stateToProgress(p: any): ProgressEntry {
  const s = p as SM2State;
  return {
    rg: s.rung ?? 0,
    due: s.dueDate instanceof Date ? s.dueDate.toISOString() : new Date(s.dueDate).toISOString(),
    wr: s.isWrongPuzzle ? 1 : 0,
    at: p.attempts || 0,
    co: p.correctAttempts || 0,
    rm: s.removedAt ? s.removedAt.toISOString() : undefined,
  };
}

function applyProgress(puzzle: any, e?: ProgressEntry) {
  if (!e) return puzzle;
  return {
    ...puzzle,
    rung: typeof e.rg === 'number' ? e.rg : 0,
    dueDate: new Date(e.due),
    isWrongPuzzle: !!e.wr,
    attempts: e.at,
    correctAttempts: e.co,
    removedAt: e.rm ? new Date(e.rm) : undefined,
  };
}

function defaultPuzzleFields(p: any, rating: number) {
  return {
    ...p,
    rung: 0,
    dueDate: new Date(),
    isWrongPuzzle: false,
    attempts: 0,
    correctAttempts: 0,
    userRating: rating,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// parseCSV / buildPuzzlesFromCSV removed: the catalogue is server-side now and
// puzzle rows arrive as JSON from /api/puzzles, so no CSV parsing is needed.

// ---------------------------------------------------------------------------
// Opening families
// ---------------------------------------------------------------------------
// A puzzle's `openings` is a SPACE-separated list of camelCase Lichess opening
// tags, most-general first (e.g. "sicilianDefense sicilianDefenseDragonVariation").
// Lichess sometimes emits only a deep variation with no general parent in the
// row, so the BASE family is taken as the tag with the FEWEST hyphen/underscore
// separated components, tie-broken by shortest string, then lexicographically
// (deterministic). This mirrors how the catalogue was grouped offline, yielding
// 147 base openings over the 62,914 opening puzzles.
export function getBaseOpening(openings?: string[] | null): string | null {
  if (!openings || openings.length === 0) return null;
  let best: string | null = null;
  let bk0 = Infinity, bk1 = Infinity;
  for (const t of openings) {
    if (!t) continue;
    const comps = t.split(/[-_]/).filter(Boolean).length;
    const len = t.length;
    if (
      best === null ||
      comps < bk0 ||
      (comps === bk0 && len < bk1) ||
      (comps === bk0 && len === bk1 && t < best)
    ) {
      best = t; bk0 = comps; bk1 = len;
    }
  }
  return best;
}

/**
 * Convert a server puzzle row into a `UserPuzzle`, merging the user's persisted
 * ladder state.
 *
 * Replaces `buildPuzzlesFromCSV` now that the catalogue is server-side: the shape
 * is the same, the source is `/api/puzzles` instead of a 53 MB CSV.
 */
function toUserPuzzle(
  p: DispensedPuzzle,
  progress: ProgressMap[string] | undefined,
  userRating: number,
): UserPuzzle {
  const base = defaultPuzzleFields(
    {
      id: p.id,
      fen: p.fen,
      moves: p.moves,
      rating: p.rating,
      themes: p.themes as LichessTheme[],
      openings: p.openings ?? [],
      popularity: p.popularity ?? 0,
    },
    userRating,
  );
  return applyProgress(base, progress) as UserPuzzle;
}

function buildThemeAggFromAttempts(attempts: PuzzleAttempt[], puzzles: UserPuzzle[]): ThemeAggMap {
  const themeByPuzzle = new Map<string, { themes: LichessTheme[]; rating: number }>();
  for (const p of puzzles) themeByPuzzle.set(p.id, { themes: p.themes, rating: p.rating });
  const agg: ThemeAggMap = {};
  const ensureOverall = () => agg["__overall"] || (agg["__overall"] = { played: 0, correct: 0, sumRating: 0, lastPlayed: "" });
  for (const a of attempts) {
    if (a.result !== "correct" && a.result !== "incorrect" && a.result !== "hard") continue; // only scored attempts count
    const entry = themeByPuzzle.get(a.puzzleId);
    if (!entry) continue;
    const ts = a.timestamp instanceof Date ? a.timestamp.toISOString() : String(a.timestamp);
    const overall = ensureOverall();
    overall.played += 1;
    overall.sumRating += entry.rating;
    if (a.result === "correct") overall.correct += 1;
    if (ts > overall.lastPlayed) overall.lastPlayed = ts;
    for (const t of entry.themes) {
      const cur = agg[t] || (agg[t] = { played: 0, correct: 0, sumRating: 0, lastPlayed: "" });
      cur.played += 1;
      cur.sumRating += entry.rating;
      if (a.result === "correct") cur.correct += 1;
      if (ts > cur.lastPlayed) cur.lastPlayed = ts;
    }
  }
  return agg;
}

export function usePuzzleStore() {
  const [puzzles, setPuzzles] = useState<UserPuzzle[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [attempts, setAttempts] = useState<PuzzleAttempt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [useSupabase, setUseSupabase] = useState(false);
  const [supabaseClient, setSupabaseClient] = useState<any>(null);
  const [userId, setUserId] = useState<string>("");
  const [catalogSize, setCatalogSize] = useState(0);
  // All-time per-theme aggregate (mirrors the persisted theme_agg record).
  const [themeAggregates, setThemeAggregates] = useState<ThemeAggMap>({});
  // Lichess dashboard rollup (per-day nb/wins/fixed/sumRating). Source of truth
  // for the dashboard's long-period numbers; never truncates.
  const [dashboardAggregate, setDashboardAggregate] = useState<DashboardAggregate>(() => emptyAggregate());
  // Glicko-2 rating state (overall + per-theme) — the source of truth for the
  // user's rating. Kept in a ref (like progress) so per-attempt updates don't
  // re-render the whole catalog; state is synced for consumers.
  const [ratingState, setRatingState] = useState<RatingState>(() => initialRatingState());

  // Progress is kept in a ref so updates don't re-render the whole catalog
  const progressRef = useRef<ProgressMap>({});
  // Theme aggregate is kept in a ref (like progress) so per-attempt updates
  // don't re-render the whole catalog; state is synced for consumers.
  const themeAggRef = useRef<ThemeAggMap>({});
  // Dashboard rollup, kept in a ref and synced to state for consumers.
  const dashboardAggRef = useRef<DashboardAggregate>(emptyAggregate());
  // puzzleId -> { themes, rating } built once from the (immutable) catalogue so
  // per-attempt aggregation never scans the 100k-puzzle array.
  const puzzleMetaRef = useRef<Map<string, { themes: string[]; rating: number; openings: string[]; deviation: number | null }>>(new Map());
  // puzzleIds that have ever been failed (used to flag a later solve as a fix).
  const failedRef = useRef<Set<string>>(new Set());
  // Glicko state ref (mutated per attempt, synced to React state on persist).
  const ratingStateRef = useRef<RatingState>(initialRatingState());
  // Rating snapshot taken when the current puzzle session began. Lichess flushes
  // the session once the live rating drifts > 100 from this (±100 window).
  const sessionRatingRef = useRef<number | null>(null);

  const persistDashboardAgg = useCallback(() => {
    try {
      pruneAggregate(dashboardAggRef.current, 180);
      localStorage.setItem(STORAGE_KEYS.DASHBOARD_AGG, JSON.stringify(dashboardAggRef.current));
      // Shallow copy so React consumers re-render (the ref object is mutated).
      setDashboardAggregate({ ...dashboardAggRef.current });
    } catch (e) {
      console.warn("Dashboard aggregate persist failed:", e);
    }
  }, []);

  const persistThemeAgg = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.THEME_AGG, JSON.stringify(themeAggRef.current));
      setThemeAggregates(themeAggRef.current);
    } catch (e) {
      console.warn("Theme aggregate persist failed:", e);
    }
  }, []);

  // Persist the Glicko-2 rating state (overall + per-theme).
  const persistGlicko = useCallback(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.GLICKO,
        JSON.stringify(serializeRatingState(ratingStateRef.current))
      );
      // Shallow copy so React consumers re-render.
      setRatingState(ratingStateRef.current);
    } catch (e) {
      console.warn("Glicko persist failed:", e);
    }
  }, []);

  const persistProgress = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(progressRef.current));
    } catch (e) {
      // If it ever gets too big, drop the oldest mastered entries (keep wrong puzzles)
      console.warn("Progress persist failed, trimming:", e);
      const entries = Object.entries(progressRef.current);
      entries.sort((a, b) => (a[1].wr === b[1].wr ? 0 : a[1].wr ? -1 : 1));
      progressRef.current = Object.fromEntries(entries.slice(0, 20000));
      try {
        localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(progressRef.current));
      } catch {}
    }
  }, []);

  // Init userId
  useEffect(() => {
    let id = localStorage.getItem(STORAGE_KEYS.USER_ID);
    if (!id) {
      id = "local_" + Math.random().toString(36).slice(2, 11);
      localStorage.setItem(STORAGE_KEYS.USER_ID, id);
    }
    setUserId(id);
  }, []);

  const saveSettings = useCallback((s: UserSettings) => {
    setSettings(s);
    try {
      // Preserve any fields written by other surfaces (e.g. the Appearance
      // tab's puzzle timer) that this store instance doesn't track in memory.
      const existingRaw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ ...existing, ...s }));
    } catch {}
  }, []);

  const saveAttempts = useCallback((a: PuzzleAttempt[]) => {
    const trimmed = a.slice(-MAX_ATTEMPTS);
    setAttempts(trimmed);
    try {
      localStorage.setItem(STORAGE_KEYS.ATTEMPTS, JSON.stringify(trimmed));
    } catch {}
  }, []);

  // Load settings + progress + catalog
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        // Purge legacy key that used to store the whole catalog (can exceed quota)
        try {
          localStorage.removeItem("puzzle_trainer_puzzles");
        } catch {}

        // settings
        const rawSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        let s: UserSettings;
        if (rawSettings) {
          const p = JSON.parse(rawSettings);
          // Merge over the defaults so newly-added fields (e.g. the puzzle
          // timer) always exist, and tolerate a partial record.
          s = {
            ...DEFAULT_SETTINGS,
            ...p,
            createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
            updatedAt: p.updatedAt ? new Date(p.updatedAt) : new Date(),
          };
        } else {
          s = { userId, ...DEFAULT_SETTINGS, createdAt: new Date(), updatedAt: new Date() };
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s));
        }
        if (cancelled) return;
        setSettings(s);

        // progress
        const rawProgress = localStorage.getItem(STORAGE_KEYS.PROGRESS);
        progressRef.current = rawProgress ? JSON.parse(rawProgress) : {};

        // attempts (timestamped buffer -> date-windowed stats)
        const rawAttempts = localStorage.getItem(STORAGE_KEYS.ATTEMPTS);
        let parsedAttempts: PuzzleAttempt[] = [];
        if (rawAttempts) {
          const p = JSON.parse(rawAttempts);
          parsedAttempts = p.map((a: any) => ({ ...a, timestamp: new Date(a.timestamp) }));
          if (cancelled) return;
          setAttempts(parsedAttempts);
        }

        // Glicko-2 rating state (overall + per-theme) — the source of truth.
        // A brand-new profile starts at Lichess's default (1500 / RD 500 /
        // σ 0.09). An EXISTING profile (legacy progress/attempts but no Glicko
        // blob yet) keeps its old numeric rating as the seed so progress carries.
        const rawGlicko = localStorage.getItem(STORAGE_KEYS.GLICKO);
        let parsedGlicko: RatingState | null = null;
        if (rawGlicko) {
          try {
            parsedGlicko = deserializeRatingState(JSON.parse(rawGlicko));
          } catch {
            parsedGlicko = null;
          }
        }
        const hasLegacyHistory = Object.keys(progressRef.current).length > 0 || parsedAttempts.length > 0;
        const seeded = parsedGlicko ?? initialRatingState(hasLegacyHistory ? s.rating : undefined);
        ratingStateRef.current = seeded;
        sessionRatingRef.current = seeded.overall.rating;
        // Keep settings.rating in lock-step with the Glicko overall rating so the
        // rest of the UI (which reads settings.rating) stays consistent.
        const syncedRating = Math.round(seeded.overall.rating);
        if (syncedRating !== s.rating) {
          s = { ...s, rating: syncedRating, updatedAt: new Date() };
          try {
            localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s));
          } catch {}
        }
        if (cancelled) return;
        setRatingState(seeded);
        setSettings(s);
        // all-time per-theme aggregate (persisted separately so it never truncates)
        const rawAgg = localStorage.getItem(STORAGE_KEYS.THEME_AGG);
        if (rawAgg) {
          try {
            themeAggRef.current = JSON.parse(rawAgg) as ThemeAggMap;
            setThemeAggregates(themeAggRef.current);
          } catch {
            themeAggRef.current = {};
          }
        }

        // ---- Catalogue: NO CSV -------------------------------------------------
        // The 6.19M catalogue lives server-side (data/puzzles.sqlite) and is served
        // by /api/dispense + /api/puzzles. The browser never downloads it.
        //
        // We hydrate only the puzzles THIS user has touched — their progress keys
        // and attempt history (hundreds, not millions) — because that is all the
        // queue views and analytics need locally. Training dispenses fresh puzzles
        // from the server one at a time.
        const ownedIds = new Set<string>();
        for (const id of Object.keys(progressRef.current)) ownedIds.add(id);
        for (const a of parsedAttempts) ownedIds.add(a.puzzleId);

        const fetched = await fetchPuzzlesByIds(ownedIds);
        if (cancelled) return;

        // Server rows -> UserPuzzle (merging the user's persisted SM-2 state).
        const list: UserPuzzle[] = fetched.map((p) =>
          toUserPuzzle(p, progressRef.current[p.id], s.rating),
        );

        // The "New" queue used to be carved out of the in-memory catalogue
        // (never-attempted ∩ daily allowance). With no catalogue, ask the server
        // for a random sample and drop anything already attempted. Over-fetch a
        // little because a few of the sample will be puzzles we already own.
        const attempted = new Set<string>();
        ownedIds.forEach((id) => attempted.add(id));
        for (const p of list) attempted.add(p.id);
        // Keep the raw API rows so the real rating deviation survives into the
        // metadata index (UserPuzzle does not carry `ratingDeviation`).
        let newRows: DispensedPuzzle[] = [];
        let newOnes: UserPuzzle[] = [];
        try {
          const res = await fetch(`/api/puzzles?limit=${Math.max(20, (s.newPuzzlesPerDay || 5) * 4)}`, {
            cache: "no-store",
          });
          if (res.ok) {
            const rows = (await res.json()) as DispensedPuzzle[];
            newRows = rows.filter((r) => !attempted.has(r.id));
            newOnes = newRows.map((r) => toUserPuzzle(r, undefined, s.rating));
          }
        } catch {
          // Offline / DB absent: the New queue is simply empty.
        }
        if (cancelled) return;
        const all = [...list, ...newOnes];

        setPuzzles(all);
        setCatalogSize(all.length);

        // Static puzzle -> {themes, rating, openings, deviation} index.
        // Built from the API rows so the REAL rating deviation rides along.
        const meta = new Map<
          string,
          { themes: string[]; rating: number; openings: string[]; deviation: number | null }
        >();
        for (const r of [...fetched, ...newRows]) {
          meta.set(r.id, {
            themes: r.themes,
            rating: r.rating,
            openings: r.openings ?? [],
            deviation: r.ratingDeviation ?? null,
          });
        }
        puzzleMetaRef.current = meta;

        // Rebuild "ever failed" set from persisted progress (isWrongPuzzle) and
        // from the attempts buffer, so a later solve is correctly flagged a fix.
        const failed = new Set<string>();
        for (const [id, e] of Object.entries(progressRef.current)) if (e && e.wr) failed.add(id);
        for (const a of parsedAttempts) if (a.result === "incorrect" || a.result === "hard" || a.result === "solution") failed.add(a.puzzleId);
        failedRef.current = failed;

        // Lichess dashboard rollup (persisted separately so it never truncates).
        const rawDash = localStorage.getItem(STORAGE_KEYS.DASHBOARD_AGG);
        if (rawDash) {
          try {
            const parsed = JSON.parse(rawDash) as DashboardAggregate;
            dashboardAggRef.current = parsed && parsed.v === 1 ? parsed : emptyAggregate();
          } catch {
            dashboardAggRef.current = emptyAggregate();
          }
        }

        // Backfill the rollup from the attempts buffer when it is empty (seeded /
        // imported history) so long-period dashboard views have data.
        if (parsedAttempts.length > 0 && dashboardAggRef.current.overall.nb === 0) {
          dashboardAggRef.current = buildAggregateFromAttempts(parsedAttempts, list);
        }
        if (dashboardAggRef.current.overall.nb > 0) {
          setDashboardAggregate({ ...dashboardAggRef.current });
          try {
            pruneAggregate(dashboardAggRef.current, 180);
            localStorage.setItem(STORAGE_KEYS.DASHBOARD_AGG, JSON.stringify(dashboardAggRef.current));
          } catch {}
        }

        // No persisted aggregate yet, but attempts exist (seeded / imported
        // history): backfill the legacy all-time aggregate from the attempts buffer.
        if (parsedAttempts.length > 0 && Object.keys(themeAggRef.current).length === 0) {
          themeAggRef.current = buildThemeAggFromAttempts(parsedAttempts, list);
          persistThemeAgg();
        }
        console.log(`Loaded ${list.length} puzzles into memory (persisted progress: ${Object.keys(progressRef.current).length})`);
      } catch (e) {
        console.error("Failed to load puzzle data:", e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // ---- mutations ----

  const upsertPuzzle = useCallback((puzzle: UserPuzzle) => {
    setPuzzles((prev) => {
      const i = prev.findIndex((p) => p.id === puzzle.id);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...puzzle, updatedAt: new Date() };
        return copy;
      }
      return [...prev, { ...puzzle, createdAt: new Date(), updatedAt: new Date() }];
    });
    progressRef.current[puzzle.id] = stateToProgress(puzzle);
    persistProgress();
  }, [persistProgress]);

  const removePuzzle = useCallback((puzzleId: string) => {
    setPuzzles((prev) => prev.map((p) => (p.id === puzzleId ? { ...p, removedAt: new Date(), updatedAt: new Date() } : p)));
    const cur = progressRef.current[puzzleId];
    if (cur) {
      progressRef.current[puzzleId] = { ...cur, rm: new Date().toISOString() };
    } else {
      progressRef.current[puzzleId] = { rg: 0, due: new Date().toISOString(), wr: 1, at: 0, co: 0, rm: new Date().toISOString() };
    }
    persistProgress();
  }, [persistProgress]);

  const restorePuzzle = useCallback((puzzleId: string) => {
    setPuzzles((prev) => prev.map((p) => (p.id === puzzleId ? { ...p, removedAt: undefined, updatedAt: new Date() } : p)));
    const cur = progressRef.current[puzzleId];
    if (cur) {
      const { rm, ...rest } = cur;
      progressRef.current[puzzleId] = rest as any;
    }
    persistProgress();
  }, [persistProgress]);

  const recordAttempt = useCallback((attempt: PuzzleAttempt) => {
    // The catalogue's meta map only knows puzzles from the local CSV pool. A puzzle
    // dispensed from the server catalogue (6.19M) will NOT be in it — and the whole
    // Glicko update used to sit inside `if (meta)`, so those solves would silently
    // score nothing. Fall back to the metadata carried ON the attempt itself.
    const fromCatalog = puzzleMetaRef.current.get(attempt.puzzleId);
    const meta = fromCatalog
      ? {
          rating: fromCatalog.rating,
          themes: fromCatalog.themes,
          openings: fromCatalog.openings,
          deviation: fromCatalog.deviation,
        }
      : attempt.puzzleRating !== undefined
        ? {
            rating: attempt.puzzleRating,
            themes: attempt.themes ?? [],
            openings: attempt.openings ?? [],
            deviation: attempt.puzzleDeviation ?? null,
          }
        : null;

    // ---- Glicko-2 rating update: ONE rating period per solve ---------------
    // The puzzle is the opponent. A clean first-try solve is the ONLY win; a
    // hint, a shown solution or a HARD press all count as LOSSES, matching
    // Lichess. The store is the single source of truth, so we overwrite the
    // attempt's ratingBefore/ratingAfter with the engine's real numbers (the
    // board no longer applies a flat ±10).
    if (meta) {
      // Stamp the puzzle's own metadata onto the attempt, so analytics never has
      // to join against a catalogue that cannot hold the full server-side set.
      if (attempt.puzzleRating === undefined) attempt.puzzleRating = meta.rating;
      if (attempt.puzzleDeviation === undefined) attempt.puzzleDeviation = meta.deviation;
      if (!attempt.themes) attempt.themes = meta.themes;
      // Opening tags drive history session grouping (lila's PuzzleAngle).
      if (!attempt.openings) attempt.openings = meta.openings;
      if (!attempt.angle) {
        attempt.angle = resolveAngle({ openings: attempt.openings, themes: attempt.themes });
      }

      const applied = applyPuzzleResult(ratingStateRef.current, {
        puzzleRating: meta.rating,
        // The puzzle's REAL Glicko RD from the catalogue (was previously assumed).
        puzzleDeviation: meta.deviation,
        themes: meta.themes,
        result: attempt.result,
        hintUsed: attempt.hintUsed,
        solutionViewed: attempt.solutionViewed,
      });
      if (applied.scored) {
        ratingStateRef.current = applied.state;
        persistGlicko();
        // ±100 session window: re-seed the snapshot once the live rating drifts
        // more than 100 from where the session began (Lichess flushes here).
        if (
          sessionRatingRef.current === null ||
          shouldFlushSession(applied.after.rating, sessionRatingRef.current)
        ) {
          sessionRatingRef.current = applied.after.rating;
        }
        attempt.ratingBefore = Math.round(applied.before.rating);
        attempt.ratingAfter = Math.round(applied.after.rating);
      }
    }

    saveAttempts([...attempts, attempt]);

    if (settings) {
      const isCorrect = attempt.result === "correct";
      const newStreak = isCorrect ? settings.streak + 1 : 0;
      saveSettings({
        ...settings,
        rating: attempt.ratingAfter,
        streak: newStreak,
        maxStreak: Math.max(settings.maxStreak, newStreak),
        totalSolved: settings.totalSolved + (isCorrect ? 1 : 0),
        totalFailed: settings.totalFailed + (isCorrect ? 0 : 1),
        updatedAt: new Date(),
      });
    }

    const isCorrect = attempt.result === "correct";
    // WRONG, HARD (a lucky-guess solve) and SOLUTION (a shown solution) are all
    // scored rounds — but none of them is a win. Viewing the solution is a LOSS.
    const isLoss =
      attempt.result === "incorrect" ||
      attempt.result === "hard" ||
      attempt.result === "solution";
    const isScored = isCorrect || isLoss;

    // Fold the scored round into the persisted aggregates. This is done OUTSIDE
    // the setState updater on purpose: React StrictMode double-invokes updaters
    // in dev, and these are non-idempotent increments.
    if (isScored && meta) {
      const tsMs =
        attempt.timestamp instanceof Date
          ? attempt.timestamp.getTime()
          : new Date(attempt.timestamp).getTime();
      const wasFailed = failedRef.current.has(attempt.puzzleId);
      const fix = isCorrect && wasFailed; // a solve of a puzzle previously failed
      // A wrong answer, a HARD press and a shown solution all mark the puzzle
      // as "seen failed" so a later clean solve is counted as a fix.
      if (isLoss) failedRef.current.add(attempt.puzzleId);

      // Lichess dashboard rollup (per-day, never truncates).
      recordIntoAggregate(dashboardAggRef.current, meta.themes, meta.rating, isCorrect, fix, dayKey(tsMs));
      persistDashboardAgg();

      // Legacy all-time per-theme aggregate (kept for backward-compat consumers).
      const iso = new Date(tsMs).toISOString();
      const overall =
        themeAggRef.current["__overall"] ||
        (themeAggRef.current["__overall"] = { played: 0, correct: 0, sumRating: 0, lastPlayed: "" });
      overall.played += 1;
      overall.sumRating += meta.rating;
      if (isCorrect) overall.correct += 1;
      if (iso > overall.lastPlayed) overall.lastPlayed = iso;
      for (const t of meta.themes) {
        const cur =
          themeAggRef.current[t] ||
          (themeAggRef.current[t] = { played: 0, correct: 0, sumRating: 0, lastPlayed: "" });
        cur.played += 1;
        cur.sumRating += meta.rating;
        if (isCorrect) cur.correct += 1;
        if (iso > cur.lastPlayed) cur.lastPlayed = iso;
      }
      persistThemeAgg();
    }

    setPuzzles((prev) => {
      const i = prev.findIndex((p) => p.id === attempt.puzzleId);
      // A puzzle dispensed from the 6.19M server catalogue may have no entry in
      // the hydrated local set. The old `if (i === -1) return prev` bailed out
      // here, so the SM-2 progress was NEVER written for those puzzles: a wrong
      // answer never entered the review queue and a solve never advanced the
      // ladder. Fall back to a fresh state, seeded from the attempt's metadata.
      const existing = i === -1 ? null : prev[i];
      const state = (existing ?? createInitialCorrectState()) as unknown as SM2State;

      let newState: SM2State;
      let newIsWrong: boolean;

      if (attempt.result === "correct") {
        if (!state.isWrongPuzzle) {
          newState = createInitialCorrectState();
          newIsWrong = false;
        } else {
          newState = calculateNextState(state, "correct");
          newIsWrong = true;
        }
      } else if (isLoss) {
        // WRONG, HARD and SOLUTION are the SAME transition: straight back to
        // rung 0, and the puzzle belongs to the mistake deck even if it was
        // solved. Viewing the solution is a loss, never a win.
        newState = state.isWrongPuzzle
          ? calculateNextState(state, "hard")
          : createInitialWrongPuzzleState();
        newIsWrong = true;
      } else {
        return prev;
      }

      const updatedPuzzle = {
        ...(existing ?? {}),
        id: attempt.puzzleId,
        fen: existing?.fen ?? "",
        moves: existing?.moves ?? "",
        rating: existing?.rating ?? attempt.puzzleRating ?? 0,
        themes: existing?.themes ?? attempt.themes ?? [],
        openings: existing?.openings ?? attempt.openings ?? [],
        ...newState,
        isWrongPuzzle: newIsWrong,
        attempts: (existing?.attempts ?? 0) + 1,
        correctAttempts:
          (existing?.correctAttempts ?? 0) + (attempt.result === "correct" ? 1 : 0),
        userRating: attempt.ratingBefore,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      } as unknown as UserPuzzle;

      progressRef.current[attempt.puzzleId] = stateToProgress(updatedPuzzle);
      persistProgress();

      if (i === -1) return [...prev, updatedPuzzle];
      const copy = [...prev];
      copy[i] = updatedPuzzle;
      return copy;
    });
  }, [attempts, settings, saveAttempts, saveSettings, persistProgress, persistThemeAgg, persistDashboardAgg, persistGlicko]);

  const addPuzzles = useCallback((incoming: any[]) => {
    setPuzzles((prev) => {
      const existing = new Set(prev.map((p) => p.id));
      const toAdd = incoming
        .filter((p) => !existing.has(p.id))
        .map((p) => applyProgress(defaultPuzzleFields(p, settings?.rating || 1000), progressRef.current[p.id]));
      return [...prev, ...toAdd];
    });
    // Keep the static meta index in sync so later attempts aggregate correctly.
    for (const p of incoming) {
      if (p && p.id)
        puzzleMetaRef.current.set(p.id, {
          themes: p.themes || [],
          rating: p.rating || 0,
          openings: p.openings || [],
          deviation: (p as { ratingDeviation?: number | null }).ratingDeviation ?? null,
        });
    }
  }, [settings?.rating]);

  // ---- queries ----

  // "New" is a DAILY ALLOWANCE (settings.newPuzzlesPerDay), NOT the whole catalog.
  // A puzzle counts as "new" only if it has never been attempted.
  // Puzzles already answered correctly belong to no queue (nothing to review).
  const newPerDay = settings?.newPuzzlesPerDay ?? 5;

  const isNewCandidate = useCallback(
    (p: UserPuzzle) => {
      const s = p as unknown as SM2State;
      return !s.isWrongPuzzle && !s.removedAt && (p.attempts ?? 0) === 0;
    },
    []
  );

  const getPuzzlesByQueue = useCallback(
    (queue: QueueType): UserPuzzle[] => {
      if (queue === "new") {
        return puzzles.filter(isNewCandidate).slice(0, newPerDay);
      }
      return puzzles.filter((p) => {
        const s = p as unknown as SM2State;
        if (!s.isWrongPuzzle) return false; // solved puzzles aren't queued
        return getQueueType(s) === queue;
      });
    },
    [puzzles, isNewCandidate, newPerDay]
  );

  const getQueueCounts = useCallback((): QueueCounts => {
    const counts: QueueCounts = { due: 0, new: 0, learning: 0, mastered: 0, archived: 0 };
    puzzles.forEach((p) => {
      const s = p as unknown as SM2State;
      if (!s.isWrongPuzzle) {
        // only never-attempted puzzles are "new"; solved ones belong to no queue
        if (!s.removedAt && (p.attempts ?? 0) === 0) counts.new++;
        return;
      }
      counts[getQueueType(s)]++;
    });
    counts.new = Math.min(counts.new, newPerDay);
    return counts;
  }, [puzzles, newPerDay]);

  // "Due Now" = puzzles ready to work on right now. With the queue mapping,
  // rung 0 and any arrived rung are 'due'; 'learning' means scheduled AHEAD
  // (waiting for its next rung), so it is deliberately NOT counted here.
  const getDueCount = useCallback(
    () => puzzles.filter((p) => getQueueType(p as unknown as SM2State) === 'due').length,
    [puzzles]
  );

  const getWrongPuzzlesCount = useCallback(
    () => puzzles.filter((p) => (p as unknown as SM2State).isWrongPuzzle && !(p as unknown as SM2State).removedAt).length,
    [puzzles]
  );

  // ---- Theme / opening counts ----------------------------------------------
  // These used to be tallied from the in-memory CSV catalogue. That catalogue is
  // gone (the browser no longer holds 6.19M puzzles), so the counts come from
  // /api/themes and /api/openings — which is strictly better: they now describe
  // the WHOLE catalogue rather than the shipped subset.
  //
  // The local tally is kept as a fallback for when the server is unreachable.
  const [themeCounts, setThemeCounts] = useState<Record<string, number> | null>(null);
  const [openingCounts, setOpeningCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [t, o] = await Promise.all([fetchThemeCounts(), fetchOpeningCounts()]);
      if (cancelled) return;
      if (t) setThemeCounts(t);
      if (o) {
        const map: Record<string, number> = {};
        for (const entry of o.openings) map[entry.opening] = entry.count;
        setOpeningCounts(map);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const getThemeCounts = useCallback((): Record<LichessTheme, number> => {
    if (themeCounts) return themeCounts as Record<LichessTheme, number>;
    // Fallback: tally whatever is loaded locally.
    const counts: Record<string, number> = {};
    puzzles.forEach((p) => {
      p.themes.forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return counts as Record<LichessTheme, number>;
  }, [puzzles, themeCounts]);

  // Live puzzle counts per BASE opening family (mirrors getThemeCounts).
  // Only puzzles that actually belong to an opening are counted (~17% of pool).
  const getOpeningCounts = useCallback((): Record<string, number> => {
    if (openingCounts) return openingCounts;
    const counts: Record<string, number> = {};
    puzzles.forEach((p) => {
      const b = getBaseOpening((p as UserPuzzle).openings);
      if (b) counts[b] = (counts[b] || 0) + 1;
    });
    return counts;
  }, [puzzles, openingCounts]);

  const updateSettings = useCallback((updates: Partial<UserSettings>) => {
    if (!settings) return;
    saveSettings({ ...settings, ...updates, updatedAt: new Date() });
  }, [settings, saveSettings]);

  const enableSupabase = useCallback((client: any) => {
    setSupabaseClient(client);
    setUseSupabase(true);
  }, []);

  return {
    puzzles,
    settings,
    attempts,
    themeAggregates,
    dashboardAggregate,
    // Glicko-2 rating state: overall triple + per-theme ratings.
    ratingState,
    themeRatings: ratingState.themes,
    sessionRating: sessionRatingRef.current,
    isLoading,
    userId,
    useSupabase,
    catalogSize,
    upsertPuzzle,
    removePuzzle,
    restorePuzzle,
    recordAttempt,
    addPuzzles,
    updateSettings,
    enableSupabase,
    getPuzzlesByQueue,
    getQueueCounts,
    getDueCount,
    getWrongPuzzlesCount,
    getThemeCounts,
    getOpeningCounts,
  };
}
