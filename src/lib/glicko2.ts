/**
 * Glicko-2 rating engine (pure TypeScript, zero dependencies, client-safe).
 *
 * This is a faithful port of the algorithm Lichess actually runs for puzzles and
 * games. Lichess does NOT use a flat +/-10 for puzzles: `lila/modules/puzzle/src/main/Puzzle.scala`
 * imports `chess.rating.glicko.Glicko`, and every solve is fed to the Glicko-2
 * calculator in the `scalachess` rating library.
 *
 * Verified sources (fetched from GitHub master):
 *
 *  - lila  modules/rating/src/main/Glicko.scala
 *      val default = new Glicko(1500d, maxDeviation (500), defaultVolatility)
 *      val maxDeviation = 500d
 *      val minDeviation = 45
 *      val maxVolatility = 0.1d
 *      val defaultVolatility = 0.09d          <-- NOTE: 0.09, NOT Glickman's 0.06
 *      val minRating = 400 ; val maxRating = 4000
 *      val maxRatingDelta = 700
 *      val periodsPerDay = RatingPeriodsPerDay(0.21436d)
 *
 *  - scalachess rating/src/main/scala/glicko/model.scala
 *      object Tau { val default: Tau = 0.75d }
 *
 *  - scalachess rating/src/main/scala/glicko/impl/RatingCalculator.scala
 *      MULTIPLIER = 173.7178 ; DEFAULT_RATING = 1500.0
 *      CONVERGENCE_TOLERANCE = 0.000001 ; ITERATION_MAX = 1000
 *      Glicko-2 step 1..7 (see below), incl. the Illinois iterative solver (step 5),
 *      step 6 RD inflation  phi* = sqrt(phi^2 + sigma^2)  (per elapsed rating period)
 *      and step 7          phi' = 1 / sqrt(1/phi*^2 + 1/v).
 *
 * Glickman's original paper example uses sigma = 0.06 and tau = 0.5; Lichess uses
 * sigma = 0.09 and tau = 0.75 by default. Both are overridable here.
 */

/** A Glicko-2 rating triple, in the *natural* (display) scale. */
export interface Glicko {
  /** Rating, e.g. 1500. */
  rating: number;
  /** Rating deviation (RD), e.g. 500 for a fresh player. */
  deviation: number;
  /** Volatility (sigma), e.g. 0.09 for a fresh Lichess player. */
  volatility: number;
}

/** One opponent result within a rating period. */
export interface RatingResult {
  /** Opponent rating, or a full Glicko triple if the opponent's RD/volatility are known. */
  opponent: Glicko | number;
  /** Outcome from the player's point of view: 1 = win, 0.5 = draw, 0 = loss. */
  score: number;
}

/** Tunable parameters. Defaults mirror Lichess. */
export interface GlickoOptions {
  /** System constant tau. Lichess: 0.75 (Glickman's paper example: 0.5). */
  tau?: number;
  /** Convergence tolerance for the step-5 solver. Lichess: 1e-6. */
  convergenceTolerance?: number;
  /** Max solver iterations before giving up. Lichess: 1000. */
  maxIterations?: number;
  /**
   * Number of elapsed rating periods used in step 6 (RD inflation).
   * 1 = a normal rating-period update (Lichess's single-game puzzle case).
   * 0 = "skipDeviationIncrease" (used by Lichess's reference unit tests).
   */
  elapsedRatingPeriods?: number;
}

/** Lichess's confirmed defaults (lila/modules/rating/src/main/Glicko.scala). */
export const GLICKO_DEFAULTS = {
  rating: 1500,
  deviation: 500,
  volatility: 0.09,
} as const;

export const TAU_DEFAULT = 0.75;
export const CONVERGENCE_TOLERANCE_DEFAULT = 1e-6;
export const MAX_ITERATIONS_DEFAULT = 1000;

/** Lichess bounds/sanity limits (lila Glicko.scala). */
export const GLICKO_LIMITS = {
  minRating: 400,
  maxRating: 4000,
  minDeviation: 45,
  maxDeviation: 500,
  maxVolatility: 0.1,
  maxRatingDelta: 700,
} as const;

/** Glicko-2 scale constants (RatingCalculator.scala). */
const MULTIPLIER = 173.7178;
const DEFAULT_RATING = 1500;

/** A fresh player, matching Lichess's `Glicko.default`. */
export function initialGlicko(): Glicko {
  return { ...GLICKO_DEFAULTS };
}

// ---------------------------------------------------------------------------
// Scale conversions (step 1 of Glickman's paper)
// ---------------------------------------------------------------------------

function toGlicko2Rating(rating: number): number {
  return (rating - DEFAULT_RATING) / MULTIPLIER;
}
function fromGlicko2Rating(mu: number): number {
  return mu * MULTIPLIER + DEFAULT_RATING;
}
function toGlicko2Deviation(rd: number): number {
  return rd / MULTIPLIER;
}
function fromGlicko2Deviation(phi: number): number {
  return phi * MULTIPLIER;
}

// ---------------------------------------------------------------------------
// Core sub-functions (steps 3, 4, 5 of Glickman's paper)
// ---------------------------------------------------------------------------

/** g(phi_j) — first sub-function of step 3. */
export function g(phiJ: number): number {
  return 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI));
}

/** E(mu, mu_j, phi_j) — second sub-function of step 3 (expected score). */
export function expectedScoreGlicko2(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Expected score on the natural scale. Uses the Glicko g(RD) weighting, i.e. the
 * same E the engine uses internally — not the naive logistic-in-rating-difference.
 */
export function expectedScore(player: Glicko, opponentRating: number, opponentDeviation = GLICKO_DEFAULTS.deviation): number {
  return expectedScoreGlicko2(
    toGlicko2Rating(player.rating),
    toGlicko2Rating(opponentRating),
    toGlicko2Deviation(opponentDeviation),
  );
}

function toOpponent(o: Glicko | number): Glicko {
  return typeof o === "number"
    ? { rating: o, deviation: GLICKO_DEFAULTS.deviation, volatility: GLICKO_DEFAULTS.volatility }
    : o;
}

/** The f(x) function used by the step-5 iterative solver. */
function f(x: number, delta: number, phi: number, v: number, a: number, tau: number): number {
  const ex = Math.exp(x);
  const denom = 2 * Math.pow(phi * phi + v + ex, 2);
  return (ex * (delta * delta - phi * phi - v - ex)) / denom - (x - a) / (tau * tau);
}

/** step 6: new RD before the step-7 correction. */
function calculateNewRD(phi: number, sigma: number, elapsedRatingPeriods: number): number {
  return Math.sqrt(phi * phi + elapsedRatingPeriods * sigma * sigma);
}

// ---------------------------------------------------------------------------
// The public engine
// ---------------------------------------------------------------------------

/**
 * Apply a full rating period (one or more results) to `player`, returning a NEW
 * Glicko (the input is never mutated). Implements steps 1-7 of Glickman's paper.
 */
export function updateRating(
  player: Glicko,
  results: RatingResult[],
  options: GlickoOptions = {},
): Glicko {
  const tau = options.tau ?? TAU_DEFAULT;
  const tol = options.convergenceTolerance ?? CONVERGENCE_TOLERANCE_DEFAULT;
  const maxIter = options.maxIterations ?? MAX_ITERATIONS_DEFAULT;
  const elapsed = options.elapsedRatingPeriods ?? 1;

  // A player with no results simply has their RD inflated (step 6 only).
  if (results.length === 0) {
    const phi0 = toGlicko2Deviation(player.deviation);
    const phiStar = calculateNewRD(phi0, player.volatility, elapsed);
    return {
      rating: player.rating,
      deviation: fromGlicko2Deviation(phiStar),
      volatility: player.volatility,
    };
  }

  // Step 1: convert to the Glicko-2 scale.
  const mu = toGlicko2Rating(player.rating);
  const phi = toGlicko2Deviation(player.deviation);
  const sigma = player.volatility;

  // Step 2: (results already given).
  // Step 3: v and the outcome-expected-rating term.
  let vInv = 0; // 1/v accumulates directly
  let outcomeTerm = 0; // sum g(phi_j) * (s_j - E_j)
  for (const r of results) {
    const opp = toOpponent(r.opponent);
    const muJ = toGlicko2Rating(opp.rating);
    const phiJ = toGlicko2Deviation(opp.deviation);
    const gj = g(phiJ);
    const e = expectedScoreGlicko2(mu, muJ, phiJ);
    vInv += gj * gj * e * (1 - e);
    outcomeTerm += gj * (r.score - e);
  }
  const v = 1 / vInv;

  // Step 4: delta.
  const delta = v * outcomeTerm;

  // Step 5: solve for the new volatility sigma' (Illinois algorithm).
  const a = Math.log(sigma * sigma);
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    B = a - k * Math.abs(tau);
    while (f(B, delta, phi, v, a, tau) < 0) {
      k += 1;
      B = a - k * Math.abs(tau);
    }
  }
  let fA = f(A, delta, phi, v, a, tau);
  let fB = f(B, delta, phi, v, a, tau);
  let iterations = 0;
  while (Math.abs(B - A) > tol && iterations < maxIter) {
    iterations += 1;
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C, delta, phi, v, a, tau);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  if (iterations >= maxIter) {
    throw new Error(`Glicko-2 volatility solver failed to converge in ${maxIter} iterations`);
  }
  const newSigma = Math.exp(A / 2);

  // Step 6: RD inflation for the new rating period.
  const phiStar = calculateNewRD(phi, newSigma, elapsed);

  // Step 7: new RD and new rating.
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * outcomeTerm;

  return {
    rating: fromGlicko2Rating(newMu),
    deviation: fromGlicko2Deviation(newPhi),
    volatility: newSigma,
  };
}

/** Convenience wrapper: apply a single game result. */
export function rateOne(
  player: Glicko,
  opponent: Glicko | number,
  score: number,
  options?: GlickoOptions,
): Glicko {
  return updateRating(player, [{ opponent, score }], options);
}

/**
 * Apply a single puzzle attempt. The opponent is the puzzle itself; puzzles carry
 * a rating and (per Lichess) a default RD/volatility when not otherwise known.
 * solved = true means the user beat the puzzle.
 */
export function rateFromPuzzle(
  current: Glicko,
  puzzleRating: number,
  solved: boolean,
  options?: GlickoOptions,
): Glicko {
  return rateOne(current, puzzleRating, solved ? 1 : 0, options);
}

/** Clamp a rating triple into Lichess's sane bounds. */
export function capGlicko(g: Glicko): Glicko {
  return {
    rating: Math.min(GLICKO_LIMITS.maxRating, Math.max(GLICKO_LIMITS.minRating, g.rating)),
    deviation: Math.min(
      GLICKO_LIMITS.maxDeviation,
      Math.max(GLICKO_LIMITS.minDeviation, g.deviation),
    ),
    volatility: Math.min(GLICKO_LIMITS.maxVolatility, g.volatility),
  };
}

// ---------------------------------------------------------------------------
// Compact serialisation for localStorage (short keys, rounded)
// ---------------------------------------------------------------------------

export interface SerializedGlicko {
  r: number;
  d: number;
  v: number;
}

export function serializeGlicko(g: Glicko): SerializedGlicko {
  return {
    r: Math.round(g.rating * 100) / 100,
    d: Math.round(g.deviation * 100) / 100,
    v: Math.round(g.volatility * 100000) / 100000,
  };
}

export function deserializeGlicko(s: SerializedGlicko | null | undefined): Glicko {
  if (!s || typeof s.r !== "number") return initialGlicko();
  return { rating: s.r, deviation: s.d, volatility: s.v };
}
