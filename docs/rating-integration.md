# Glicko-2 rating integration (flat ±10 → real engine)

Status: **wired.** The verified engine (`src/lib/glicko2.ts`, `src/lib/themeRatings.ts`)
is now driven by a thin compose layer, `src/lib/ratingPipeline.ts`, and the app
store (`src/hooks/usePuzzleStore.ts`) is the single source of truth for the
rating. The old flat `rating += solved ? +10 : -10` (`PuzzleBoard.tsx`) is gone.

## Pipeline

```
PuzzleBoard (reports outcome only)
  └─ onComplete(attempt) → page.tsx → usePuzzleStore.recordAttempt(attempt)
       └─ applyPuzzleResult(ratingStateRef.current, {puzzleRating, themes, result, hintUsed, solutionViewed})
            ├─ overall: rateOne(state.overall, {rating: puzzleRating, deviation: 80, volatility: 0.09}, cleanWin ? 1 : 0)
            │     then capGlicko() + ±700 guard  (src/lib/glicko2.ts)
            └─ themes : applyAttempt(state.themes, {puzzleRating, themes, solved: cleanWin})  (src/lib/themeRatings.ts)
       → attempt.ratingBefore / ratingAfter overwritten with the real numbers
       → settings.rating = round(overall.rating)   (keeps the rest of the UI in sync)
       → persisted to localStorage key `puzzle_trainer_glicko_v1` ({overall:{r,d,v}, themes:{<t>:{r,d,v,p,c}}})
```

- **One rating period per solve.** Each scored attempt is a single game fed to
  Glicko-2 steps 1–7. The puzzle is the opponent.
- **Clean win only.** `isCleanWin = result === 'correct' && !hintUsed && !solutionViewed`.
  A wrong answer, a HARD press, a hint-assisted "correct" and a viewed solution
  all score `0` (a loss), matching Lichess.
- **Per-theme ratings.** Solving a puzzle tagged `['fork','pin']` applies the same
  result to every carried theme; unrelated themes stay put.
- **±100 session window.** `shouldFlushSession(current, sessionSnapshot)` returns
  true once the live rating drifts more than 100 points from the snapshot taken at
  the start of the session; the store re-seeds the snapshot then. Because this app
  dispenses one puzzle at a time straight from the live rating (there is no cached
  queue), the window is a safety net rather than a hard driver.
- **Persistence.** Only the compact rating blob (+ existing per-puzzle progress and
  aggregate maps) is persisted — never the catalogue.

## Puzzle opponent RD (ASSUMPTION)

`public/puzzles.csv` (modern Lichess export `PuzzleId,FEN,Moves,Rating,Themes,Popularity`)
has **no** rating-deviation column — lila derives the puzzle's RD server-side. So
every puzzle is given a fixed, deterministic `PUZZLE_DEVIATION = 80`
(`src/lib/ratingPipeline.ts`). 80 sits just above Lichess's
`standardRankableDeviation` (75): a published puzzle is treated as a settled
opponent, and an established player's per-solve move stays in the low-double-digit
range. Any constant works; determinism is what matters for reproducibility.

## Seed / migration

- Brand-new profile → Lichess defaults: rating **1500**, RD **500**, σ **0.09**.
- Existing profile (legacy progress/attempts but no Glicko blob yet) → seeded from
  the old numeric `settings.rating` (RD still starts fresh at 500 so the engine can
  re-converge). A legacy default of 1000 therefore carries over rather than jumping
  to 1500.

## Verification

- `node scripts/verify-glicko.mjs` — engine + scalachess cross-check, **29/29**.
- `node scripts/verify-rating-integration.mjs` — drives real solves through
  `applyPuzzleResult`, **25/25** (clean solve ↑, wrong ↓, HARD ↓, hint/solution not
  a win, provisional ≫ established, per-theme bookkeeping, persistence round-trip,
  ±100 window).
- Live browser (CDP, localhost:3000): fresh 1500 → clean solve → **1691**
  (engine: 1691.4267); HARD → **1634** (engine: 1634.1496). Both match exactly.
