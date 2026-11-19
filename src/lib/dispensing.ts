/**
 * Lichess-faithful puzzle dispensing.
 *
 * Ported from lila's source, verified 2026-11-19:
 *   modules/puzzle/src/main/PuzzlePath.scala     (nextFor / select — the band)
 *   modules/puzzle/src/main/PuzzleSelector.scala (retry + tier fallback)
 *   modules/puzzle/src/main/PuzzleDifficulty.scala (rating deltas)
 *   modules/puzzle/src/main/PuzzleTier.scala      (top/good/all + stepDown)
 *   modules/puzzle/src/main/PuzzleSession.scala   (±100 flush)
 *
 * Lichess's real algorithm:
 *   1. target = yourGlickoRating + difficulty.ratingDelta
 *   2. flex   = (100 + |1500 - target| / 4) * compromise      (compromise 0..5)
 *   3. tier   = top, or good when the difficulty is extreme; fallback top→good→all
 *   4. sample ONE path whose [min,max] overlaps [target-flex, target+flex],
 *      excluding already-used paths
 *   5. walk the path; flush the session when |rating - sessionRating| > 100
 *
 * IMPORTANT DEVIATION, stated plainly:
 * Lichess samples a pre-built PATH (an ordered list of puzzle ids with a rating
 * RANGE) and walks it. We have no pre-built paths, so we select an individual
 * puzzle instead. The band therefore needs a base width to stand in for the
 * width of a path's rating range — see BASE_BAND. Everything else is the same
 * shape: hard band, widening flex, exclusions, tier fallback.
 */

/** PuzzleDifficulty.ratingDelta — exact values from PuzzleDifficulty.scala. */
export const DIFFICULTY_DELTA: Record<string, number> = {
  easiest: -600,
  easier: -300,
  normal: 0,
  harder: 300,
  hardest: 600,
};

/** PuzzleDifficulty.isExtreme — Easiest | Hardest. Those use tier `good`. */
export function isExtremeDifficulty(difficultyId: string): boolean {
  return difficultyId === "easiest" || difficultyId === "hardest";
}

/**
 * Stand-in for the width of a path's rating range. Lichess matches PATHS whose
 * [min,max] overlaps the band, so flex=0 still finds a path spanning some width.
 * Selecting individual puzzles needs that width made explicit.
 */
export const BASE_BAND = 100;

/** Lichess allows compromise 0..5 before giving up. */
export const MAX_COMPROMISE = 5;

/**
 * PuzzlePath.scala:50 — `(100 + math.abs(1500 - rating.value) / 4) * compromise.atMost(4)`
 *
 * NOTE: with compromise=0 Lichess's flex is literally 0 — which works only
 * because paths carry rating RANGES. For point-rated puzzles we floor the band
 * at BASE_BAND so compromise 0 still yields a usable (tight) band.
 */
export function flexFor(target: number, compromise: number): number {
  const lichess = (100 + Math.abs(1500 - target) / 4) * Math.min(compromise, 4);
  return Math.max(lichess, BASE_BAND);
}

export interface DispensablePuzzle {
  id: string;
  rating: number;
  popularity?: number;
}

/**
 * Quality tiers. Lichess's tiers are a property of a curated PATH; our only
 * quality signal is the popularity column, so we approximate.
 *
 * ⚠️ CONFOUND: popularity correlates with EASINESS (measured: popularity-100
 * puzzles have a median rating of 965). Using it as a quality tier therefore
 * skews slightly easy. The tiers are deliberately mild and only act as a
 * fallback, so the effect is small — but it is not the same thing Lichess does.
 */
export type Tier = "top" | "good" | "all";

/**
 * Minimum popularity for a quality tier. Single source of truth so the client
 * filter and the server-side SQL dispenser cannot drift apart.
 */
export function tierMinPopularity(tier: Tier): number {
  if (tier === "all") return 0;
  return tier === "top" ? 90 : 85;
}

export function tierFilter<T extends DispensablePuzzle>(pool: T[], tier: Tier): T[] {
  if (tier === "all") return pool;
  const min = tierMinPopularity(tier);
  const out = pool.filter((p) => (p.popularity ?? 0) >= min);
  return out.length > 0 ? out : pool; // never return an empty tier
}

/** PuzzleTier.stepDown — top → good → all → (nothing). */
export function stepDown(tier: Tier): "good" | "all" | null {
  if (tier === "top") return "good";
  if (tier === "good") return "all";
  return null;
}

export interface SelectOptions {
  /** The user's overall Glicko puzzle rating (perf.glicko.intRating). */
  userRating: number;
  /** easiest | easier | normal | harder | hardest */
  difficultyId: string;
  /** Puzzle ids served recently — Lichess's `previousPaths` exclusion. */
  exclude?: Set<string>;
  /** Inject for deterministic tests. */
  random?: () => number;
}

export interface SelectionResult<T> {
  puzzle: T | null;
  /** Diagnostics so the caller (and tests) can see exactly how it decided. */
  trace: {
    target: number;
    flex: number;
    bandLow: number;
    bandHigh: number;
    compromise: number;
    tier: "top" | "good" | "all";
    bandSize: number;
    gaveUp: boolean;
  };
}

/**
 * Pick the next puzzle the way Lichess would.
 *
 * Mirrors `PuzzlePathApi.nextFor` (lila modules/puzzle/src/main/PuzzlePathApi.scala:34-67)
 * case for case:
 *
 *   val actualTier = if tier == top && isExtreme(difficulty) then good else tier
 *   val ratingFlex = (100 + |1500 - rating| / 4) * compromise.atMost(4)
 *   Match(select(angle, actualTier, rating ± ratingFlex) ++
 *         ((compromise != 5 && previousPaths.nonEmpty).so("_id".nin(previousPaths)))
 *   ) -> Sample(1)
 *   // then, IN THIS EXACT ORDER:
 *   case _ if actualTier == top                     => nextFor(good)              // compromise UNCHANGED
 *   case _ if actualTier == good && compromise == 2 => nextFor(all, compromise=1)
 *   case _ if compromise < 5                        => nextFor(tier, compromise+1)
 *   case _                                          => none
 *
 * The easily-missed details this encodes:
 *  - `top` does NOT widen. It steps straight down to `good` at the SAME compromise.
 *    (The previous port widened top 0→5 first, which meant a small top-tier band
 *    got recycled instead of falling through to the larger `good`/`all` pools.)
 *  - `good` widens 0→1→2, then drops to `all` with compromise reset to 1.
 *  - The recent-puzzle exclusion is lifted ONLY at compromise == 5.
 */
export function selectPuzzle<T extends DispensablePuzzle>(
  pool: T[],
  opts: SelectOptions,
): SelectionResult<T> {
  const rnd = opts.random ?? Math.random;
  const exclude = opts.exclude ?? new Set<string>();
  const delta = DIFFICULTY_DELTA[opts.difficultyId] ?? 0;
  const target = opts.userRating + delta;

  // PuzzlePathApi.nextFor:41-44 — extreme difficulties start at tier `good`.
  let tier: "top" | "good" | "all" = isExtremeDifficulty(opts.difficultyId) ? "good" : "top";
  let compromise = 0;
  let lastBandSize = 0;
  let lastFlex = flexFor(target, 0);

  for (;;) {
    const flex = flexFor(target, compromise);
    const lo = target - flex;
    const hi = target + flex;

    const tiered = tierFilter(pool, tier);
    let band = tiered.filter((p) => p.rating >= lo && p.rating <= hi);

    // `(compromise != 5 && previousPaths.nonEmpty).so(_id nin previousPaths)`
    if (compromise !== MAX_COMPROMISE && exclude.size > 0) {
      band = band.filter((p) => !exclude.has(p.id));
    }

    lastBandSize = band.length;
    lastFlex = flex;

    if (band.length > 0) {
      const puzzle = band[Math.min(band.length - 1, Math.floor(rnd() * band.length))];
      return {
        puzzle,
        trace: {
          target, flex, bandLow: lo, bandHigh: hi,
          compromise, tier, bandSize: band.length, gaveUp: false,
        },
      };
    }

    // ---- the nextFor fallback chain, in lila's order ------------------------
    if (tier === "top") {
      tier = "good";                 // compromise deliberately unchanged
      continue;
    }
    if (tier === "good" && compromise === 2) {
      tier = "all";
      compromise = 1;
      continue;
    }
    if (compromise < MAX_COMPROMISE) {
      compromise += 1;
      continue;
    }
    break;
  }

  // lila returns `none` here. We deliberately do NOT: a dead board is worse than
  // an off-band puzzle, so fall back to the least-bad un-served puzzle.
  const fallback = pool.filter((p) => !exclude.has(p.id));
  const usable = fallback.length > 0 ? fallback : pool;
  const puzzle = usable.length
    ? usable.reduce((best, p) =>
        Math.abs(p.rating - target) < Math.abs(best.rating - target) ? p : best,
      )
    : null;

  return {
    puzzle,
    trace: {
      target, flex: lastFlex, bandLow: target - lastFlex, bandHigh: target + lastFlex,
      compromise, tier, bandSize: lastBandSize, gaveUp: true,
    },
  };
}
