/**
 * puzzleDb.ts — server-only SQLite access for the puzzle catalog.
 *
 * Opens `data/puzzles.sqlite` lazily (once per server process) using Node's
 * built-in `node:sqlite`. Never import this from a client component.
 *
 * If the DB file is missing the callers (`/api/*` routes) translate the thrown
 * DbMissingError into a 503 JSON response.
 */

// NB: server-only. Do not import from a client component.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export class DbMissingError extends Error {
  code = 'db-missing' as const
  constructor(public dbPath: string) {
    super(`Puzzle database not found at ${dbPath}`)
    this.name = 'DbMissingError'
  }
}

export const DB_PATH = process.env.PUZZLE_DB_PATH
  ? path.resolve(process.env.PUZZLE_DB_PATH)
  : path.join(process.cwd(), 'data', 'puzzles.sqlite')

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db

  if (!fs.existsSync(DB_PATH)) {
    throw new DbMissingError(DB_PATH)
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true })
  db.exec('PRAGMA query_only = TRUE;')
  db.exec('PRAGMA cache_size = -20000;')
  _db = db
  return _db
}

export function dbExists(): boolean {
  return fs.existsSync(DB_PATH)
}

let _maxRowid: number | null = null

/** Cache the max rowid for random rowid-walk sampling. */
export function getMaxRowid(db: DatabaseSync): number {
  if (_maxRowid === null) {
    const row = db.prepare('SELECT MAX(rowid) AS m FROM puzzles').get() as { m: number } | undefined
    _maxRowid = Number(row?.m ?? 0)
  }
  return _maxRowid
}

export interface PuzzleRow {
  id: string
  fen: string
  moves: string
  rating: number
  popularity: number | null
  themes: string[]
}

/**
 * Normalise a raw Lichess opening tag to the app's camelCase convention:
 *   Sicilian_Defense_Delayed_Alapin_Variation -> sicilianDefenseDelayedAlapinVariation
 *
 * The DB stores Lichess's raw tags, but the CSV pool's `Openings` column is
 * camelCase — so normalising here lets `getBaseOpening()` and the openings
 * drill-down behave identically for DB-served and pool-served puzzles.
 */
export function normaliseOpening(tag: string): string {
  const parts = tag.split(/[_-]+/).filter(Boolean)
  if (parts.length === 0) return tag
  return (
    parts[0].toLowerCase() +
    parts
      .slice(1)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('')
  )
}
