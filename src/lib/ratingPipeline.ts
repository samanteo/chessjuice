/**
 * Rating pipeline — the single place that turns a puzzle attempt into a
 * Glicko-2 rating update. It composes the verified engine (`./glicko2`) and the
 * per-theme bookkeeping (`./themeRatings`) into the shape the app store needs.
 *
 * This is the wiring layer described by `docs/lichess-rating-spec.md`. It exists
 * so the store keeps ONE honest rating path (overall + per-theme) instead of the
 * old flat ±10.
 *
 * Lichess semantics encoded here:
 *  - each puzzle solve is ONE rating period (one game);
 *  - the puzzle is the opponent and carries its own rating;
 *  - a CLEAN first-try solve is the only win — a hint, a shown solution or a HARD
 *    press are all recorded as a loss (`lila` rewards no partial credit);
 *  - solving a puzzle tagged ['fork','pin'] applies the same game result to EVERY
 *    theme the puzzle carries;
 *  - the session rating is flushed when the live rating drifts > 100 from the
 *    session snapshot (`PuzzleSession.shouldFlushSession`).
 *
 * Pure TypeScript, zero runtime deps, no path aliases — so it transpiles and runs
 * in a bare Node test (`scripts/verify-rating-integration.mjs`) as well as in the
 * browser.
 */

import {
  type Glicko,
  type SerializedGlicko,
  initialGlicko,
  rateOne,
  capGlicko,
  GLICKO_LIMITS,
  serializeGlicko,
  deserializeGlicko,
} from "./glicko2";
import {
  type ThemeStore,
  type SerializedThemeStore,
  applyAttempt,
  serializeThemeStore,
  deserializeThemeStore,
} from "./themeRatings";

// ---------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------

/**
 * FALLBACK — the puzzle opponent's rating deviation, when the catalogue has none.
 *
 * This USED to be applied to every puzzle: the old CSV export
 * (`PuzzleId,FEN,Moves,Rating,Themes,Popularity`) carried no rating deviation,
 * because lila derives it server-side and it was absent from the public file.
 *
 * That is no longer the case. Our SQLite catalogue carries `rating_deviation` for
 * all 6,193,530 puzzles (clustered 74-83), and `applyPuzzleResult` uses it via
 * `input.puzzleDeviation`. This constant is now only the fallback for a puzzle
 * with no RD (e.g. a legacy CSV-sourced row, or an imported attempt).
 *
 * Why 80: it sits just above Lichess's `standardRankableDeviation` (75), i.e. we
 * treat a published puzzle as a settled-but-not-maximally-confident opponent, and
 * it keeps an established player's per-solve move in the single/low-double-digit
 * range (see the integration test) rather than letting a wobbly "opponent" swing
 * the result. Any constant would be defensible; what matters is that it is
 * deterministic and documented, so ratings reproduce exactly.
 */
export const PUZZLE_DEVIATION = 80;

/**
 * The puzzle opponent's volatility. Glicko-2 never reads the opponent's
 * volatility, so this value is inert; it is kept only so the opponent is a
 * well-formed `Glicko` triple.
 */
export const PUZZLE_VOLATILITY = 0.09;

/** Lichess flushes a puzzle session once the live rating drifts this far. */
export const SESSION_WINDOW = 100;

/** Results that represent a scored rating round (all others are ignored). */
const SCORED_RESULTS = new Set(["correct", "incorrect", "hard", "solution"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The full rating state: one overall Glicko plus the per-theme store. */
export interface RatingState {
  overall: Glicko;
  themes: ThemeStore;
}

/** The minimal attempt shape the pipeline needs (a subset of `PuzzleAttempt`). */
export interface AttemptInput {
  puzzleRating: number;
  /**
   * The puzzle's REAL Glicko rating deviation, when known.
   *
   * Lichess derives each puzzle's RD server-side; our SQLite catalogue carries it
   * (`rating_deviation`, clustered 74-83). Using it makes the opponent's confidence
   * accurate instead of assumed. Falls back to `PUZZLE_DEVIATION` when absent —
   * e.g. for puzzles that came from the old CSV export, which had no RD column.
   */
  puzzleDeviation?: number | null;
  themes: string[];
  result: string;
  hintUsed: boolean;
  solutionViewed: boolean;
}

/** Result of applying one attempt. */
export interface AppliedRating {
  /** The new state (inputs are never mutated). */
  state: RatingState;
  /** Overall Glicko before / after the update. */
  before: Glicko;
  after: Glicko;
  /** Rating delta (after − before), in points. */
  delta: number;
  /** Whether this attempt was a scored rating round. */
  scored: boolean;
  /** Whether it counted as a win (a clean first-try solve). */
  isWin: boolean;
}

export interface SerializedRatingState {
  overall: SerializedGlicko;
  themes: SerializedThemeStore;
}

// ---------------------------------------------------------------------------
// Construction / (de)serialisation
// ---------------------------------------------------------------------------

/**
 * A fresh Lichess-default rating state: rating 1500, RD 500, σ 0.09.
 * `seedRating` lets an existing profile carry its old numeric rating across
 * (the deviation still starts at the fresh 500 so the engine can re-converge).
 */
export function initialRatingState(seedRating?: number): RatingState {
  const overall = initialGlicko();
  if (typeof seedRating === "number" && isFinite(seedRating)) {
    overall.rating = seedRating;
  }
  return { overall, themes: {} };
}

export function serializeRatingState(s: RatingState): SerializedRatingState {
  return {
    overall: serializeGlicko(s.overall),
    themes: serializeThemeStore(s.themes),
  };
}

export function deserializeRatingState(
  s: SerializedRatingState | null | undefined,
  seedRating?: number,
): RatingState {
  if (!s || typeof s !== "object" || !s.overall) return initialRatingState(seedRating);
  return {
    overall: deserializeGlicko(s.overall),
    themes: deserializeThemeStore(s.themes),
  };
}

// ---------------------------------------------------------------------------
// The core rule
// ---------------------------------------------------------------------------

/**
 * A clean win is a first-try CORRECT solve made without a hint and without
 * viewing the solution. Everything else — wrong, HARD, hint-assisted, or a shown
 * solution — is a loss for rating purposes (matches Lichess).
 */
export function isCleanWin(
  result: string,
  hintUsed: boolean,
  solutionViewed: boolean,
): boolean {
  return result === "correct" && !hintUsed && !solutionViewed;
}

/** Whether a result is a scored rating round at all. */
export function isScoredResult(result: string): boolean {
  return SCORED_RESULTS.has(result);
}

/**
 * Apply one puzzle attempt to the rating state. One rating period per solve.
 * Non-scored results return the state unchanged (`scored: false`).
 */
export function applyPuzzleResult(state: RatingState, input: AttemptInput): AppliedRating {
  const scored = isScoredResult(input.result);
  if (!scored) {
    return {
      state,
      before: state.overall,
      after: state.overall,
      delta: 0,
      scored: false,
      isWin: false,
    };
  }

  const isWin = isCleanWin(input.result, input.hintUsed, input.solutionViewed);
  const score = isWin ? 1 : 0;

  // Overall rating: the puzzle is the opponent, with its OWN rating and — when the
  // catalogue provides it — its REAL rating deviation. Lichess derives each
  // puzzle's RD server-side; we now carry it in SQLite, so this is measured rather
  // than assumed. `PUZZLE_DEVIATION` remains the fallback for puzzles with no RD.
  const opponentDeviation =
    typeof input.puzzleDeviation === 'number' &&
    Number.isFinite(input.puzzleDeviation) &&
    input.puzzleDeviation > 0
      ? input.puzzleDeviation
      : PUZZLE_DEVIATION;
  const opponent: Glicko = {
    rating: input.puzzleRating,
    deviation: opponentDeviation,
    volatility: PUZZLE_VOLATILITY,
  };
  let after = rateOne(state.overall, opponent, score);
  after = capGlicko(after);
  // Mirror Lichess's ±700 single-round guard (defensive; a well-behaved update
  // never gets near it, but a wild first provisional game should stay bounded).
  const rawDelta = after.rating - state.overall.rating;
  if (Math.abs(rawDelta) > GLICKO_LIMITS.maxRatingDelta) {
    after = {
      ...after,
      rating:
        state.overall.rating +
        Math.sign(rawDelta) * GLICKO_LIMITS.maxRatingDelta,
    };
  }

  // Per-theme ratings: the SAME result applied to every carried theme.
  const themes = applyAttempt(state.themes, {
    puzzleRating: input.puzzleRating,
    themes: input.themes,
    solved: isWin,
  });

  return {
    state: { overall: after, themes },
    before: state.overall,
    after,
    delta: after.rating - state.overall.rating,
    scored: true,
    isWin,
  };
}

// ---------------------------------------------------------------------------
// Session window (±100)
// ---------------------------------------------------------------------------

/**
 * Lichess keeps a rolling session seeded from your rating when it was created,
 * and flushes (re-seeds) it once your live rating drifts more than 100 points
 * away (`PuzzleSession.shouldFlushSession`). Returns true when a flush is due.
 */
export function shouldFlushSession(
  currentRating: number,
  sessionRating: number,
): boolean {
  return Math.abs(currentRating - sessionRating) > SESSION_WINDOW;
}
