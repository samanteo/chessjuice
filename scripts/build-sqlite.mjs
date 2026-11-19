#!/usr/bin/env node
/**
 * build-sqlite.mjs — one-time builder for the local puzzle SQLite DB.
 *
 * Reads a Lichess puzzle CSV and produces `data/puzzles.sqlite` with:
 *   table puzzles(id TEXT PK, fen TEXT, moves TEXT, rating INT, popularity INT, nb_plays INT)
 *   table puzzle_themes(puzzle_id TEXT, theme TEXT)   -- one row per (puzzle, theme)
 *   indexes: puzzle_themes(theme), puzzle_themes(puzzle_id), puzzles(rating)
 *
 * Streaming + batched transactions + prepared statements => ~4M rows without
 * holding the catalog in RAM. Pragmas are tuned for a one-shot build (journal OFF,
 * synchronous OFF); indexes are created AFTER the bulk insert.
 *
 * Usage:
 *   node scripts/build-sqlite.mjs [input.csv]
 *   npm run build-db
 *
 * Input defaults to ./lichess_db_puzzle.csv, falling back to ./filtered_puzzles.csv.
 * Column layout is detected from the CSV header, so both Lichess full dumps
 * (PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,...) and the
 * pruned filtered CSV (PuzzleId,FEN,Moves,Rating,Themes,Popularity) work.
 *
 * Rebuild whenever the source CSV changes:
 *   rm -f data/puzzles.sqlite && npm run build-db
 */

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = process.env.PUZZLE_DB_PATH
  ? path.resolve(process.env.PUZZLE_DB_PATH)
  : path.join(DATA_DIR, 'puzzles.sqlite')

const BATCH = 50_000

function pickInput(argPath) {
  const candidates = argPath
    ? [path.resolve(argPath)]
    : [path.join(ROOT, 'lichess_db_puzzle.csv'), path.join(ROOT, 'filtered_puzzles.csv')]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  throw new Error(
    `No input CSV found. Looked for: ${candidates.join(', ')}\n` +
      `Pass a path explicitly: node scripts/build-sqlite.mjs <file.csv>`,
  )
}

/** Map column name -> index from the header line. */
function headerIndex(headerLine) {
  const cols = headerLine.replace(/\r$/, '').split(',')
  const idx = {}
  cols.forEach((name, i) => {
    idx[name.trim()] = i
  })
  const need = ['PuzzleId', 'FEN', 'Moves', 'Rating', 'Themes']
  for (const n of need) {
    if (idx[n] === undefined) throw new Error(`Header missing required column "${n}" in: ${headerLine}`)
  }
  return idx
}

function main() {
  const input = pickInput(process.argv[2])
  console.log(`[build-db] input : ${input}`)
  console.log(`[build-db] output: ${DB_PATH}`)

  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH)
  for (const sidecar of ['-wal', '-shm', '-journal']) {
    const p = DB_PATH + sidecar
    if (fs.existsSync(p)) fs.rmSync(p)
  }

  const db = new DatabaseSync(DB_PATH)
  // One-shot build tuning.
  db.exec('PRAGMA journal_mode = OFF;')
  db.exec('PRAGMA synchronous = OFF;')
  db.exec('PRAGMA temp_store = MEMORY;')
  db.exec('PRAGMA cache_size = -64000;') // ~64 MB page cache

  db.exec(`
    CREATE TABLE puzzles (
      id               TEXT PRIMARY KEY,
      fen              TEXT NOT NULL,
      moves            TEXT NOT NULL,
      rating           INTEGER NOT NULL,
      rating_deviation INTEGER,
      popularity       INTEGER,
      nb_plays         INTEGER
    );
    CREATE TABLE puzzle_themes (
      puzzle_id TEXT NOT NULL,
      theme     TEXT NOT NULL
    );
    CREATE TABLE puzzle_openings (
      puzzle_id TEXT NOT NULL,
      opening   TEXT NOT NULL
    );
  `)

  const insPuzzle = db.prepare(
    'INSERT OR REPLACE INTO puzzles (id, fen, moves, rating, rating_deviation, popularity, nb_plays) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const insTheme = db.prepare('INSERT INTO puzzle_themes (puzzle_id, theme) VALUES (?, ?)')
  const insOpening = db.prepare('INSERT INTO puzzle_openings (puzzle_id, opening) VALUES (?, ?)')

  let col = null
  let rows = 0
  let themesWritten = 0
  let openingsWritten = 0
  let skipped = 0
  let inTx = false

  const commit = () => {
    if (inTx) {
      db.exec('COMMIT')
      inTx = false
    }
  }
  const begin = () => {
    if (!inTx) {
      db.exec('BEGIN')
      inTx = true
    }
  }

  const started = Date.now()
  const rl = readline.createInterface({
    input: fs.createReadStream(input, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  // Synchronous readline consumption via events (keeps the whole flow single-threaded
  // and lets prepared statements re-use the same DatabaseSync handle).
  return new Promise((resolve, reject) => {
    rl.on('line', (line) => {
      if (!col) {
        col = headerIndex(line)
        begin()
        return
      }
      if (!line) return
      const f = line.split(',')
      // Detect truncated / malformed lines defensively.
      const id = f[col.PuzzleId]
      const fen = f[col.FEN]
      const moves = f[col.Moves]
      if (!id || !fen || !moves) {
        skipped++
        return
      }
      const rating = parseInt(f[col.Rating], 10)
      if (!Number.isFinite(rating)) {
        skipped++
        return
      }
      const popularity = col.Popularity !== undefined ? parseInt(f[col.Popularity], 10) : null
      const nbPlays = col.NbPlays !== undefined ? parseInt(f[col.NbPlays], 10) : null
      // RatingDeviation drives the Glicko-2 update. Lichess's own DB carries it;
      // without it the app has to guess a constant (previously 80).
      const ratingDeviation =
        col.RatingDeviation !== undefined ? parseInt(f[col.RatingDeviation], 10) : null

      insPuzzle.run(
        id,
        fen,
        moves,
        rating,
        Number.isFinite(ratingDeviation) ? ratingDeviation : null,
        Number.isFinite(popularity) ? popularity : null,
        Number.isFinite(nbPlays) ? nbPlays : null,
      )
      rows++

      const themeStr = f[col.Themes] || ''
      if (themeStr) {
        for (const theme of themeStr.split(' ')) {
          if (theme) {
            insTheme.run(id, theme)
            themesWritten++
          }
        }
      }

      // OpeningTags — a separate drill-down dimension, same as Lichess's
      // PuzzleAngle.Opening. Stored raw; the client normalises to a base opening.
      const openingStr = col.OpeningTags !== undefined ? f[col.OpeningTags] || '' : ''
      if (openingStr) {
        for (const opening of openingStr.split(' ')) {
          if (opening) {
            insOpening.run(id, opening)
            openingsWritten++
          }
        }
      }

      if (rows % BATCH === 0) {
        commit()
        begin()
        const secs = ((Date.now() - started) / 1000).toFixed(1)
        process.stdout.write(`\r[build-db] ${rows.toLocaleString()} puzzles, ${themesWritten.toLocaleString()} theme rows (${secs}s)`)
      }
    })
    rl.on('error', reject)
    rl.on('close', () => {
      try {
        commit()
        process.stdout.write('\n')
        console.log('[build-db] bulk insert done, building indexes...')

        db.exec(`
          CREATE INDEX idx_puzzles_rating ON puzzles(rating);
          CREATE INDEX idx_themes_theme ON puzzle_themes(theme);
          CREATE INDEX idx_themes_puzzle ON puzzle_themes(puzzle_id);
          CREATE INDEX idx_openings_opening ON puzzle_openings(opening);
          CREATE INDEX idx_openings_puzzle ON puzzle_openings(puzzle_id);
        `)
        db.exec('ANALYZE;')
        // Self-contained read-only file: no -wal/-shm sidecars to ship.
        db.exec('PRAGMA journal_mode = DELETE;')

        const total = db.prepare('SELECT COUNT(*) AS n FROM puzzles').get().n
        const themeRows = db.prepare('SELECT COUNT(*) AS n FROM puzzle_themes').get().n
        const openingRows = db.prepare('SELECT COUNT(*) AS n FROM puzzle_openings').get().n
        const withRD = db.prepare('SELECT COUNT(*) AS n FROM puzzles WHERE rating_deviation IS NOT NULL').get().n

        console.log('\n================ build summary ================')
        console.log(`input              : ${input}`)
        console.log(`output             : ${DB_PATH}`)
        console.log(`puzzles            : ${total.toLocaleString()}`)
        console.log(`puzzle_themes rows : ${themeRows.toLocaleString()}`)
        console.log(`puzzle_openings    : ${openingRows.toLocaleString()}`)
        console.log(`with rating_dev    : ${withRD.toLocaleString()}`)
        console.log(`skipped (bad rows) : ${skipped.toLocaleString()}`)
        console.log(`elapsed            : ${((Date.now() - started) / 1000).toFixed(1)}s`)

        const counts = db
          .prepare(
            'SELECT theme, COUNT(*) AS n FROM puzzle_themes GROUP BY theme ORDER BY n DESC',
          )
          .all()
        console.log(`distinct themes    : ${counts.length}`)
        console.log('per-theme counts:')
        for (const r of counts) console.log(`  ${r.theme.padEnd(24)} ${r.n.toLocaleString()}`)
        console.log('==============================================')

        db.close()
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
}

main().catch((e) => {
  console.error('[build-db] FAILED:', e)
  process.exit(1)
})
