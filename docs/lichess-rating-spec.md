# Lichess rating spec — wiring notes for the puzzle trainer

Status: **reference only.** The rating engine (`src/lib/glicko2.ts`,
`src/lib/themeRatings.ts`) is implemented and verified, but nothing is wired into
the app yet. These notes capture what the follow-up wiring step must do to match
Lichess.

All facts below were read from GitHub `master` on this machine. Files cited:

- **lila** `modules/rating/src/main/Glicko.scala`
- **lila** `modules/puzzle/src/main/Puzzle.scala`
- **lila** `modules/puzzle/src/main/PuzzleFinisher.scala`
- **lila** `modules/puzzle/src/main/PuzzleSession.scala`
- **lila** `modules/puzzle/src/main/PuzzleTier.scala`
- **lila** `modules/puzzle/src/main/PuzzleDifficulty.scala`
- **scalachess** `rating/src/main/scala/glicko/model.scala`
- **scalachess** `rating/src/main/scala/glicko/GlickoCalculator.scala`
- **scalachess** `rating/src/main/scala/glicko/impl/RatingCalculator.scala`
- **scalachess** `test-kit/src/test/scala/rating/glicko/GlickoCalculatorTest.scala`

---

## (a) Glicko-2 replaces the flat ±10

Today the app does `rating += solved ? +10 : -10`. Lichess does **not**. A puzzle
solve is turned into a **one-game rating period** and fed to the Glicko-2
calculator (`PuzzleFinisher.apply`: "for rating computation, we treat the solve as
a game where the player is white and the puzzle is black", producing
`chess.rating.glicko.Game(players, Outcome(...))` via `GlickoCalculator.computeGame`).

The rating change therefore depends on **both** ratings and on your RD:

- beating a 1900 puzzle gains far more than beating an 1100 one;
- losing to a much weaker puzzle costs more than losing to a stronger one;
- a fresh player (RD 500) moves hundreds of points for one game; a settled player
  (RD ~60) moves single digits.

### Confirmed Lichess defaults (use these, do not guess)

From `lila/modules/rating/src/main/Glicko.scala`:

| constant | value | note |
|---|---|---|
| `Glicko.default` | `Glicko(1500, 500, 0.09)` | **new player: rating 1500, RD 500, volatility 0.09** |
| `minRating` / `maxRating` | 400 / 4000 | clamp bounds |
| `minDeviation` | 45 | RD floor for "settled" |
| `standardRankableDeviation` | 75 | RD ≤ 75 ⇒ established, shows a numeric rating |
| `provisionalDeviation` (model.scala) | 110 | RD ≥ 110 ⇒ provisional (`1500?`) |
| `maxDeviation` | 500 | RD ceiling |
| `maxVolatility` | 0.1 | sanity cap |
| `defaultVolatility` | **0.09** | **NOT Glickman's paper value of 0.06** |
| `maxRatingDelta` | 700 | max single-game rating move |
| `periodsPerDay` | `RatingPeriodsPerDay(0.21436)` | RD inflation rate |

From `scalachess/.../glicko/model.scala`: `Tau.default = 0.75`.

From `scalachess/.../impl/RatingCalculator.scala`: `MULTIPLIER = 173.7178`,
`DEFAULT_RATING = 1500.0`, `CONVERGENCE_TOLERANCE = 1e-6`, `ITERATION_MAX = 1000`.
Algorithm = Glicko-2 steps 1–7, incl. the Illinois iterative solver for σ' (step 5),
step-6 RD inflation `φ* = √(φ² + σ²)` once per elapsed rating period, and step-7
`φ' = 1/√(1/φ*² + 1/v)`.

`src/lib/glicko2.ts` encodes exactly these values (`GLICKO_DEFAULTS`,
`TAU_DEFAULT`, `GLICKO_LIMITS`) with everything overridable. Glickman's *paper*
example uses σ=0.06 and τ=0.5 — that is only used inside the verification test,
not the app.

### What the wiring step must do

1. Replace the ±10 in the attempt handler with `rateFromPuzzle(playerGlicko, puzzleRating, solved)`
   (overall rating) **and** `applyAttempt(themeStore, {puzzleRating, themes, solved})`
   (per-theme ratings).
2. Store the overall Glicko and the theme store via `serializeGlicko` /
   `serializeThemeStore` (short keys `{r,d,v}` and `{r,d,v,p,c}`) instead of a
   single integer.
3. Optionally clamp with `capGlicko` and respect `maxRatingDelta = 700` if you want
   to mirror Lichess's puzzle-rating guard (see `PuzzleFinisher`, which caps the
   *puzzle's* rating change at ±700).
4. Show `getTheme(store, theme)` on the puzzle dashboard exactly like Lichess's
   per-theme panel; `overall(store)` gives a display-side overall estimate.

---

## (b) Session is kept within ~±100 of your rating

From `lila/modules/puzzle/src/main/PuzzleSession.scala`:

```scala
private def shouldFlushSession(session: PuzzleSession)(using perf: Perf) = !session.brandNew &&
  Math.abs((perf.intRating - session.rating).value) > 100
```

The server keeps a rolling session whose `rating` is a snapshot taken when the
session was created (`PuzzleSession(settings, path, 0, perf.intRating)`). Every new
session is seeded from your **current** rating. The session is **flushed** (a fresh
session started) when your rating has drifted more than **100** points away from
that snapshot — so the puzzles you are served within one session stay roughly
±100 of the rating you had when it began. Provisional players flush more aggressively
(`// renew the session often for provisional players`).

Wiring implication: if the app caches a queue/session of puzzles, re-seed it from
the current overall rating and re-create it when `|current − sessionSnapshot| > 100`.

---

## (c) Puzzle selection is theme-scoped with a difficulty tier

From `PuzzleSession.scala` / `PuzzleSelector`, selection is keyed by an
`angle` (the theme scope) plus a difficulty tier:

- **Angle** — `PuzzleAngle.mix` for mixed puzzles, or a specific `PuzzleTheme`
  key. Stored on the session; the session is re-created when the angle changes
  (`wrongAngle`). Per-theme practice => angle = that theme.
- **Tier** — `PuzzleTier` = `top | good | all` (`PuzzleTier.scala`), and
  `nextFor(...)` is called with `PuzzleTier.top` when creating a session
  (`PuzzleSessionApi.createSessionFor`).
- **Difficulty** — `PuzzleDifficulty` (`PuzzleDifficulty.scala`) is an offset from
  your current rating, default `Normal`:

  | tier | `ratingDelta` |
  |---|---|
  | Easiest | −600 |
  | Easier  | −300 |
  | Normal  | 0 (default) |
  | Harder  | +300 |
  | Hardest | +600 |

  So a puzzle is roughly `yourRating + difficulty.ratingDelta`, then filtered by
  the theme angle and the tier.

Wiring implication: when selecting the next puzzle, target
`overall(store).rating + difficultyDelta` (or the active theme's
`getTheme(store, angle).rating + difficultyDelta`), scoped to the active theme, and
apply the ±100 session-flush rule from (b).

---

## Verification

`node scripts/verify-glicko.mjs` transpiles the real `src/lib/*.ts` with the
project's `typescript` package and asserts:

1. Glickman's published worked example (r=1500, RD=200, σ=0.06, τ=0.5; results
   win/1400·30, loss/1550·100, loss/1700·300) → **r'≈1464.05, RD'≈151.52,
   σ'≈0.059996** vs published 1464.06 / 151.52 / 0.05999.
2. Sanity properties (RD shrinks with volume; upsets gain more; losses to weaker
   opponents cost more; new players move most).
3. Per-theme store updates every carried theme and leaves others at the initial state.
4. **Cross-check against scalachess's own reference unit tests**
   (`GlickoCalculatorTest.scala`, τ=0.75): ratings to ±0.005, RDs to ±0.00005,
   volatilities to ±0.000002.

Exits non-zero on failure. All 29 checks pass.
