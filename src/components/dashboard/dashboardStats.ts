import { PuzzleAttempt, UserPuzzle, LichessTheme, THEME_DISPLAY_NAMES } from "@/types";

// ---------------------------------------------------------------------------
// Puzzle Dashboard metrics — faithful port of Lichess
// `modules/puzzle/src/main/PuzzleDashboard.scala` (+ `PuzzleBits.scala` UI).
// ---------------------------------------------------------------------------
// Data sources (documented contract):
//   * SHORT windows (<= SHORT_WINDOW_MAX_DAYS)  -> the timestamped ATTEMPTS
//     buffer, joined to the in-memory catalogue for each puzzle's themes+rating.
//     A puzzle's attempts are ordered by time so a correct solve that follows an
//     earlier incorrect attempt on the same puzzle is a `fix`.
//   * LONG windows (> SHORT_WINDOW_MAX_DAYS)     -> the persisted per-day
//     aggregate rollup (see DashboardAggregate). It is written on every scored
//     attempt and never truncates, so 30/60/90-day views stay accurate even when
//     the attempts buffer is capped.
//   * Each path falls back to the other when the preferred source has no rows.
//
// Only 'correct' | 'incorrect' | 'hard' attempts are ROUNDS. 'hint' / 'solution'
// rows are purely-viewed and are ignored entirely (Lichess only records
// win/loss rounds). A 'hard' round is a solved-but-not-solid answer (the user
// pressed HARD): it is NOT a clean first win, so it counts as a LOSS round
// (toward `failed`) exactly like an 'incorrect' one.
//
// Per-theme attribution: a round counts toward EVERY theme the puzzle carries
// (Lichess `Unwind("puzzle.themes")` + `GroupField`). A puzzle tagged
// fork/pin/mateIn2 increments fork AND pin AND mateIn2.
// ---------------------------------------------------------------------------

export type PeriodKey = "1" | "2" | "3" | "7" | "10" | "14" | "21" | "30" | "60" | "90";

// Lichess `dayChoices = Days.from(List(1, 2, 3, 7, 10, 14, 21, 30, 60, 90))`.
export const DAY_CHOICES = [1, 2, 3, 7, 10, 14, 21, 30, 60, 90] as const;

export const PERIODS: { key: PeriodKey; label: string }[] = DAY_CHOICES.map((d) => ({
  key: String(d) as PeriodKey,
  label: d === 1 ? "1 day" : `${d} days`,
}));

export const DEFAULT_PERIOD: PeriodKey = "30";

// Lichess `topThemesNb = 8`.
export const TOP_THEMES_NB = 8;
// Lichess `mostPlayed` = `byTheme.toList.sortBy(-_._2.nb).take(9)`.
export const RADAR_AXES = 9;
// Windows <= this many days are served from the timestamped attempts buffer.
export const SHORT_WINDOW_MAX_DAYS = 7;
// Lichess candidate filter: `nb > global.nb / 40` (integer division).
export const RANKING_DENOM = 40;

// Lichess `irrelevantThemes` (PuzzleDashboard.scala). Never shown on the radar
// nor in the ranked lists.
export const IRRELEVANT_THEMES: ReadonlySet<string> = new Set<string>([
  "oneMove",
  "short",
  "long",
  "veryLong",
  "mateIn1",
  "mateIn2",
  "mateIn3",
  "mateIn4",
  "mateIn5",
  "equality",
  "advantage",
  "crushing",
  "master",
  "masterVsMaster",
]);

export function themeLabel(theme: string): string {
  return THEME_DISPLAY_NAMES[theme as LichessTheme] || theme;
}

// ---------------------------------------------------------------------------
// Raw results (mirrors `PuzzleDashboard.Results`)
// ---------------------------------------------------------------------------
export interface Results {
  nb: number; // rounds
  wins: number; // rounds solved
  fixed: number; // rounds fixed (lost earlier, solved now)
  puzzleRatingAvg: number; // mean puzzle glicko rating, truncated to int
}

export interface DerivedResults extends Results {
  firstWins: number;
  unfixed: number;
  failed: number;
  winPercent: number;
  firstWinPercent: number;
  performance: number;
  clear: boolean;
  unclear: boolean;
  canReplay: boolean;
}

export interface ThemeStat extends DerivedResults {
  theme: string;
  label: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Persisted per-day aggregate rollup (compact; the catalogue is NEVER stored)
// ---------------------------------------------------------------------------
export interface ThemeBucket {
  nb: number;
  wins: number;
  fixed: number;
  sr: number; // Σ puzzle.rating (for the mean)
}

export interface DayBucket extends ThemeBucket {
  themes: Record<string, ThemeBucket>;
}

export interface DashboardAggregate {
  v: 1;
  overall: ThemeBucket; // all-time global (per-attempt, not per-theme)
  themes: Record<string, ThemeBucket>; // all-time per-theme (relevant only)
  days: Record<string, DayBucket>; // "YYYY-MM-DD" -> per-day rollup
}

export function emptyBucket(): ThemeBucket {
  return { nb: 0, wins: 0, fixed: 0, sr: 0 };
}

export function emptyAggregate(): DashboardAggregate {
  return { v: 1, overall: emptyBucket(), themes: {}, days: {} };
}

/** Local-time day key, e.g. 2026-11-19. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function bumpBucket(b: ThemeBucket, rating: number, win: boolean, fix: boolean): void {
  b.nb += 1;
  b.sr += rating;
  if (win) b.wins += 1;
  if (fix) b.fixed += 1;
}

export function addBucket(dst: ThemeBucket, src: ThemeBucket): void {
  dst.nb += src.nb;
  dst.wins += src.wins;
  dst.fixed += src.fixed;
  dst.sr += src.sr;
}

/**
 * Fold one scored round into the aggregate. Counts toward the global totals,
 * the per-day totals, and EVERY (relevant) theme the puzzle carries.
 */
export function recordIntoAggregate(
  agg: DashboardAggregate,
  themes: readonly string[],
  rating: number,
  win: boolean,
  fix: boolean,
  day: string
): void {
  bumpBucket(agg.overall, rating, win, fix);
  let dayB = agg.days[day];
  if (!dayB) {
    dayB = agg.days[day] = { nb: 0, wins: 0, fixed: 0, sr: 0, themes: {} };
  }
  bumpBucket(dayB, rating, win, fix);
  for (const t of themes) {
    if (IRRELEVANT_THEMES.has(t)) continue;
    let tb = agg.themes[t];
    if (!tb) tb = agg.themes[t] = emptyBucket();
    bumpBucket(tb, rating, win, fix);
    let dtb = dayB.themes[t];
    if (!dtb) dtb = dayB.themes[t] = emptyBucket();
    bumpBucket(dtb, rating, win, fix);
  }
}

/** Drop day buckets older than `keepDays` so localStorage stays small. */
export function pruneAggregate(agg: DashboardAggregate, keepDays = 180): DashboardAggregate {
  const keys = Object.keys(agg.days);
  if (keys.length <= keepDays) return agg;
  keys.sort();
  for (const k of keys.slice(0, keys.length - keepDays)) delete agg.days[k];
  return agg;
}

function tsOf(a: PuzzleAttempt): number {
  const t = a.timestamp as unknown;
  return t instanceof Date ? t.getTime() : new Date(t as string).getTime();
}

const isScored = (a: PuzzleAttempt) =>
  a.result === "correct" || a.result === "incorrect" || a.result === "hard";

/**
 * Rebuild the whole aggregate from the timestamped attempts buffer. Used to
 * backfill the rollup for seeded / imported history. A correct round that
 * follows an earlier incorrect round on the SAME puzzle is marked a fix.
 */
export function buildAggregateFromAttempts(
  attempts: PuzzleAttempt[],
  puzzles: UserPuzzle[]
): DashboardAggregate {
  const meta = new Map<string, { themes: string[]; rating: number }>();
  for (const p of puzzles) meta.set(p.id, { themes: p.themes, rating: p.rating });
  // Attempts carry their own puzzle metadata when the catalogue cannot cover them
  // (puzzles dispensed from the server-side 6.19M DB are not in the local pool).
  for (const a of attempts) {
    if (meta.has(a.puzzleId)) continue;
    if (a.puzzleRating !== undefined && a.themes) {
      meta.set(a.puzzleId, { themes: a.themes, rating: a.puzzleRating });
    }
  }

  const byPuzzle = new Map<string, PuzzleAttempt[]>();
  for (const a of attempts) {
    if (!isScored(a)) continue;
    const list = byPuzzle.get(a.puzzleId);
    if (list) list.push(a);
    else byPuzzle.set(a.puzzleId, [a]);
  }

  const agg = emptyAggregate();
  for (const list of Array.from(byPuzzle.values())) {
    list.sort((x, y) => tsOf(x) - tsOf(y));
    let seenFail = false;
    for (const a of list) {
      const m = meta.get(a.puzzleId);
      if (!m) continue;
      const win = a.result === "correct";
      const fix = win && seenFail;
      if (!win) seenFail = true;
      recordIntoAggregate(agg, m.themes, m.rating, win, fix, dayKey(tsOf(a)));
    }
  }
  return agg;
}

// ---------------------------------------------------------------------------
// Derivation (mirrors PuzzleDashboard.Results)
// ---------------------------------------------------------------------------
export function bucketToResults(b: ThemeBucket): Results {
  return {
    nb: b.nb,
    wins: b.wins,
    fixed: b.fixed,
    // IntRating(rating.toInt) -> truncate the mean toward zero.
    puzzleRatingAvg: b.nb > 0 ? Math.trunc(b.sr / b.nb) : 0,
  };
}

export function derive(r: Results): DerivedResults {
  const firstWins = r.wins - r.fixed;
  const unfixed = r.nb - r.wins;
  const failed = r.fixed + unfixed;
  // Scala Int division truncates toward zero.
  const winPercent = r.nb > 0 ? Math.trunc((r.wins * 100) / r.nb) : 0;
  const firstWinPercent = r.nb > 0 ? Math.trunc((firstWins * 100) / r.nb) : 0;
  // performance = puzzleRatingAvg - 500 + round(1000 * firstWins / nb)
  const performance =
    r.nb > 0 ? r.puzzleRatingAvg - 500 + Math.round((1000 * firstWins) / r.nb) : 0;
  const clear = r.nb >= 6 && firstWins >= 2 && failed >= 2;
  return {
    ...r,
    firstWins,
    unfixed,
    failed,
    winPercent,
    firstWinPercent,
    performance,
    clear,
    unclear: !clear,
    canReplay: unfixed > 0,
  };
}

// ---------------------------------------------------------------------------
// Sources -> raw results
// ---------------------------------------------------------------------------
export interface Round {
  themes: string[];
  rating: number;
  win: boolean;
  fix: boolean;
}

/** Rounds inside the window from the attempts buffer (fixes via time ordering). */
export function roundsFromAttempts(
  attempts: PuzzleAttempt[],
  puzzles: UserPuzzle[],
  cutoffMs: number
): Round[] {
  const meta = new Map<string, { themes: string[]; rating: number }>();
  for (const p of puzzles) meta.set(p.id, { themes: p.themes, rating: p.rating });
  // Same fallback as buildAggregateFromAttempts: server-dispensed puzzles are not
  // in the local catalogue, so their metadata rides on the attempt.
  for (const a of attempts) {
    if (meta.has(a.puzzleId)) continue;
    if (a.puzzleRating !== undefined && a.themes) {
      meta.set(a.puzzleId, { themes: a.themes, rating: a.puzzleRating });
    }
  }

  const byPuzzle = new Map<string, PuzzleAttempt[]>();
  for (const a of attempts) {
    if (!isScored(a)) continue;
    const list = byPuzzle.get(a.puzzleId);
    if (list) list.push(a);
    else byPuzzle.set(a.puzzleId, [a]);
  }

  const fixes = new Set<PuzzleAttempt>();
  for (const list of Array.from(byPuzzle.values())) {
    list.sort((x, y) => tsOf(x) - tsOf(y));
    let seenFail = false;
    for (const a of list) {
      if (a.result === "correct" && seenFail) fixes.add(a);
      // 'hard' counts as a non-win, so a later clean solve is a fix.
      if (a.result !== "correct") seenFail = true;
    }
  }

  const rounds: Round[] = [];
  for (const a of attempts) {
    if (!isScored(a)) continue;
    const t = tsOf(a);
    if (!(t >= cutoffMs)) continue;
    const m = meta.get(a.puzzleId);
    if (!m) continue;
    rounds.push({ themes: m.themes, rating: m.rating, win: a.result === "correct", fix: fixes.has(a) });
  }
  return rounds;
}

function aggregateRounds(rounds: Round[]): { global: ThemeBucket; byTheme: Record<string, ThemeBucket> } {
  const global = emptyBucket();
  const byTheme: Record<string, ThemeBucket> = {};
  for (const r of rounds) {
    bumpBucket(global, r.rating, r.win, r.fix);
    for (const t of r.themes) {
      if (IRRELEVANT_THEMES.has(t)) continue;
      let b = byTheme[t];
      if (!b) b = byTheme[t] = emptyBucket();
      bumpBucket(b, r.rating, r.win, r.fix);
    }
  }
  return { global, byTheme };
}

/** Sum the per-day buckets whose day falls inside the window. */
export function aggregateFromRollup(
  agg: DashboardAggregate,
  cutoffMs: number
): { global: ThemeBucket; byTheme: Record<string, ThemeBucket> } {
  const global = emptyBucket();
  const byTheme: Record<string, ThemeBucket> = {};
  for (const [day, db] of Object.entries(agg.days || {})) {
    const dayStart = new Date(`${day}T00:00:00`).getTime();
    if (!(dayStart >= cutoffMs)) continue;
    addBucket(global, db);
    for (const [t, tb] of Object.entries(db.themes || {})) {
      let b = byTheme[t];
      if (!b) b = byTheme[t] = emptyBucket();
      addBucket(b, tb);
    }
  }
  return { global, byTheme };
}

// ---------------------------------------------------------------------------
// Top-level compute
// ---------------------------------------------------------------------------
export type DashboardSource = "attempts" | "aggregate";

export interface Dashboard {
  global: DerivedResults;
  byTheme: Record<string, ThemeBucket>;
  stats: ThemeStat[];
  source: DashboardSource;
  days: number;
}

export interface ThemeMetaMap {
  [theme: string]: { label?: string; description?: string };
}

export function computeDashboard(
  period: PeriodKey,
  attempts: PuzzleAttempt[],
  puzzles: UserPuzzle[],
  agg: DashboardAggregate,
  themeMeta?: ThemeMetaMap
): Dashboard {
  const days = parseInt(period, 10);
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  let raw: { global: ThemeBucket; byTheme: Record<string, ThemeBucket> };
  let source: DashboardSource;

  if (days <= SHORT_WINDOW_MAX_DAYS) {
    const rounds = roundsFromAttempts(attempts, puzzles, cutoffMs);
    if (rounds.length > 0) {
      raw = aggregateRounds(rounds);
      source = "attempts";
    } else {
      raw = aggregateFromRollup(agg, cutoffMs);
      source = "aggregate";
    }
  } else {
    raw = aggregateFromRollup(agg, cutoffMs);
    source = "aggregate";
    if (raw.global.nb === 0) {
      const rounds = roundsFromAttempts(attempts, puzzles, cutoffMs);
      if (rounds.length > 0) {
        raw = aggregateRounds(rounds);
        source = "attempts";
      }
    }
  }

  const stats: ThemeStat[] = Object.entries(raw.byTheme).map(([theme, b]) => {
    const d = derive(bucketToResults(b));
    const meta = themeMeta?.[theme];
    return {
      theme,
      label: meta?.label || themeLabel(theme),
      description: meta?.description || "",
      ...d,
    };
  });

  return {
    global: derive(bucketToResults(raw.global)),
    byTheme: raw.byTheme,
    stats,
    source,
    days,
  };
}

// ---------------------------------------------------------------------------
// Radar + ranked lists (exact Lichess rules)
// ---------------------------------------------------------------------------

/** Lichess `mostPlayed`: top 9 by nb, rendered sorted by theme name. */
export function pickRadarThemes(stats: ThemeStat[], count = RADAR_AXES): ThemeStat[] {
  const top = [...stats]
    .sort((a, b) => b.nb - a.nb || a.label.localeCompare(b.label))
    .slice(0, count);
  // PuzzleBits.pageModule sorts the radar axes by theme display name.
  return top.sort((a, b) => a.label.localeCompare(b.label));
}

export interface RankedThemes {
  weak: ThemeStat[];
  strong: ThemeStat[];
}

/**
 * Lichess `weakThemes` / `strongThemes`.
 *   all = byTheme.filter(nb > global.nb / 40).sortBy((performance, -nb))
 *   weak   = all.filter(failed >= 3 && performance < global.performance).take(8)
 *   strong = all.filter(firstWins >= 3 && performance > global.performance).takeRight(8).reverse()
 */
export function rankedThemes(stats: ThemeStat[], global: DerivedResults): RankedThemes {
  const threshold = Math.trunc(global.nb / RANKING_DENOM);
  const all = stats
    .filter((s) => s.nb > threshold)
    .sort((a, b) => a.performance - b.performance || b.nb - a.nb);

  const weak = all
    .filter((s) => s.failed >= 3 && s.performance < global.performance)
    .slice(0, TOP_THEMES_NB);

  const strong = all
    .filter((s) => s.firstWins >= 3 && s.performance > global.performance)
    .slice(-TOP_THEMES_NB)
    .reverse();

  return { weak, strong };
}
