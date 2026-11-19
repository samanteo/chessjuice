import { NextResponse } from 'next/server'
import { getDb, getMaxRowid, DbMissingError, normaliseOpening } from '@/lib/puzzleDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const MAX_EXCLUDE = 200
/** Batch-by-id ceiling. The review/archive queues fetch their own puzzle set. */
const MAX_IDS = 200

interface PuzzleRow {
  id: string
  fen: string
  moves: string
  rating: number
  rating_deviation: number | null
  popularity: number | null
}

function csvList(v: string | null): string[] {
  if (!v) return []
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function num(v: string | null, fallback: number | null): number | null {
  if (v === null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Build the rowid-walk query.
 *
 * `ORDER BY RANDOM()` sorts the whole matching set (minutes on a 2.3 GB / 6 M-row
 * file), and the rating index + `ORDER BY rowid` makes SQLite materialise and sort
 * the entire rating range. Instead we pick a random starting rowid and walk forward
 * in primary-key order, applying the filter inline. `rating + 0` deliberately defeats
 * `idx_puzzles_rating` so the planner is forced onto the ordered rowid scan (no sort).
 */
function buildQuery(
  startRowid: number,
  limit: number,
  opts: { min: number | null; max: number | null; themes: string[]; exclude: string[] },
): { sql: string; args: unknown[] } {
  const where: string[] = ['p.rowid >= ?']
  const args: unknown[] = [startRowid]

  if (opts.min !== null) {
    where.push('(p.rating + 0) >= ?')
    args.push(opts.min)
  }
  if (opts.max !== null) {
    where.push('(p.rating + 0) <= ?')
    args.push(opts.max)
  }
  if (opts.themes.length) {
    where.push(
      `EXISTS (SELECT 1 FROM puzzle_themes t WHERE t.puzzle_id = p.id AND t.theme IN (${opts.themes
        .map(() => '?')
        .join(',')}))`,
    )
    args.push(...opts.themes)
  }
  if (opts.exclude.length) {
    where.push(`p.id NOT IN (${opts.exclude.map(() => '?').join(',')})`)
    args.push(...opts.exclude)
  }

  const sql =
    `SELECT p.id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity ` +
    `FROM puzzles p WHERE ${where.join(' AND ')} ORDER BY p.rowid LIMIT ?`
  args.push(limit)
  return { sql, args }
}

/** Attach the full theme + opening tag lists to a set of rows. */
function hydrate(
  db: ReturnType<typeof getDb>,
  rows: PuzzleRow[],
): { id: string; fen: string; moves: string; rating: number; ratingDeviation: number | null; popularity: number | null; themes: string[]; openings: string[] }[] {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const ph = ids.map(() => '?').join(',')

  const themeMap = new Map<string, string[]>()
  for (const tr of db
    .prepare(`SELECT puzzle_id, theme FROM puzzle_themes WHERE puzzle_id IN (${ph})`)
    .all(...(ids as never[])) as unknown as { puzzle_id: string; theme: string }[]) {
    const list = themeMap.get(tr.puzzle_id)
    if (list) list.push(tr.theme)
    else themeMap.set(tr.puzzle_id, [tr.theme])
  }

  const openingMap = new Map<string, string[]>()
  for (const or_ of db
    .prepare(`SELECT puzzle_id, opening FROM puzzle_openings WHERE puzzle_id IN (${ph})`)
    .all(...(ids as never[])) as unknown as { puzzle_id: string; opening: string }[]) {
    // Normalise to the camelCase key the rest of the app uses for angles
    // ("Sicilian_Defense" -> "sicilianDefense"), matching /api/openings.
    const key = normaliseOpening(or_.opening)
    const list = openingMap.get(or_.puzzle_id)
    if (list) list.push(key)
    else openingMap.set(or_.puzzle_id, [key])
  }

  return rows.map((r) => ({
    id: r.id,
    fen: r.fen,
    moves: r.moves,
    rating: r.rating,
    ratingDeviation: r.rating_deviation ?? null,
    popularity: r.popularity,
    themes: (themeMap.get(r.id) ?? []).sort(),
    openings: (openingMap.get(r.id) ?? []).sort(),
  }))
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const ids = csvList(searchParams.get('ids')).slice(0, MAX_IDS)
  const themes = csvList(searchParams.get('themes'))
  const min = num(searchParams.get('min'), null)
  const max = num(searchParams.get('max'), null)
  const exclude = csvList(searchParams.get('exclude')).slice(0, MAX_EXCLUDE)
  const rawLimit = num(searchParams.get('limit'), DEFAULT_LIMIT) ?? DEFAULT_LIMIT
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(rawLimit)))

  try {
    const db = getDb()

    // ---- Mode 1: fetch specific puzzles by id --------------------------------
    // Used by the Review / Archived queues, whose puzzle ids come from the user's
    // own progress (localStorage) rather than from a catalogue in memory. Order is
    // preserved as requested so callers can rely on it.
    if (ids.length > 0) {
      const found = db
        .prepare(
          `SELECT id, fen, moves, rating, rating_deviation, popularity FROM puzzles ` +
            `WHERE id IN (${ids.map(() => '?').join(',')})`,
        )
        .all(...(ids as never[])) as unknown as PuzzleRow[]

      const byId = new Map(found.map((r) => [r.id, r]))
      const ordered = ids.map((id) => byId.get(id)).filter((r): r is PuzzleRow => r !== undefined)
      return NextResponse.json(hydrate(db, ordered))
    }

    // ---- Mode 2: random sample (training pool / "New") -----------------------
    const maxRowid = getMaxRowid(db)
    const rows: PuzzleRow[] = []
    const seen = new Set<string>()

    // Primary: random start rowid, walk forward.
    const start = Math.floor(Math.random() * Math.max(1, maxRowid))
    {
      const { sql, args } = buildQuery(start, limit, { min, max, themes, exclude })
      for (const r of db.prepare(sql).all(...(args as never[])) as unknown as PuzzleRow[]) {
        if (!seen.has(r.id)) {
          seen.add(r.id)
          rows.push(r)
        }
      }
    }

    // Wrap-around: if the random start was near the end, top up from the beginning.
    if (rows.length < limit) {
      const { sql, args } = buildQuery(0, limit, {
        min,
        max,
        themes,
        exclude: exclude.concat(Array.from(seen)),
      })
      for (const r of db.prepare(sql).all(...(args as never[])) as unknown as PuzzleRow[]) {
        if (rows.length >= limit) break
        if (!seen.has(r.id)) {
          seen.add(r.id)
          rows.push(r)
        }
      }
    }

    return NextResponse.json(hydrate(db, rows))
  } catch (e) {
    if (e instanceof DbMissingError) {
      return NextResponse.json(
        { error: 'db-missing', hint: 'run npm run build-db' },
        { status: 503 },
      )
    }
    throw e
  }
}
