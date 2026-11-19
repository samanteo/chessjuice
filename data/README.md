# data/ — local puzzle SQLite database

`puzzles.sqlite` is generated from a Lichess puzzle CSV. It is the server-side
catalog that `/api/*` routes query, so the browser only ever holds the puzzles
currently on screen.

## Rebuild

```bash
npm run build-db                 # reads ./lichess_db_puzzle.csv, falls back to ./filtered_puzzles.csv
node scripts/build-sqlite.mjs path/to/other.csv   # explicit input
```

The builder streams the CSV, batches inserts in transactions, creates indexes
*after* the bulk load, and finishes by printing row counts + per-theme counts.
~4M puzzles produce a several-hundred-MB file; that is expected.

Reproduce from scratch:

```bash
rm -f data/puzzles.sqlite* && npm run build-db
```

Set `PUZZLE_DB_PATH` to point the API and builder at a different file.

### Schema

| table | columns |
| --- | --- |
| `puzzles` | `id TEXT PK, fen TEXT, moves TEXT (UCI), rating INT, popularity INT, nb_plays INT` |
| `puzzle_themes` | `puzzle_id TEXT, theme TEXT` — one row per (puzzle, theme) |

Indexes: `puzzles(rating)`, `puzzle_themes(theme)`, `puzzle_themes(puzzle_id)`.

## Endpoints

| route | description |
| --- | --- |
| `GET /api/themes` | `{ theme: count, ... }` for all themes (module-cached). |
| `GET /api/puzzles` | random puzzles. Query: `themes` (csv), `min`, `max` (rating), `limit` (default 20, cap 100), `exclude` (csv of puzzle ids). Returns `{id,fen,moves,rating,popularity,themes[]}[]`. |
| `GET /api/puzzle?id=<id>` | single puzzle with themes; 404 when missing. |

When `data/puzzles.sqlite` is absent every route returns **503**
`{"error":"db-missing","hint":"run npm run build-db"}` instead of crashing.

## Client helpers

`src/lib/puzzleApi.ts` exports `fetchThemeCounts()`, `fetchPuzzles({themes,min,max,limit,exclude})`,
and `fetchPuzzle(id)` — typed `fetch` wrappers for the UI.
