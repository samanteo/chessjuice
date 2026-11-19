import { NextResponse } from 'next/server'
import { getDb, getMaxRowid, DbMissingError, normaliseOpening } from '@/lib/puzzleDb'
import {
  DIFFICULTY_DELTA,
  flexFor,
  isExtremeDifficulty,
  MAX_COMPROMISE,
  stepDown,
  tierMinPopularity,
  type Tier,
} from '@/lib/dispensing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * camelCase opening key -> the RAW tag stored in `puzzle_openings`.
 *
 * The catalogue stores Lichess's raw form ("Sicilian_Defense") while every caller
 * (UI, pinned ids, /api/openings) speaks the camelCase key ("sicilianDefense").
 * The transform is lossy in one direction, so we build the reverse map once from
 * the ~1,593 distinct tags rather than trying to guess word boundaries.
 */
let openingLookup: Map<string, string> | null = null

function rawOpeningFor(key: string): string | null {
  try {
    if (!openingLookup) {
      openingLookup = new Map()
      const db = getDb()
      for (const r of db
        .prepare('SELECT DISTINCT opening FROM puzzle_openings')
        .all() as unknown as { opening: string }[]) {
        openingLookup.set(normaliseOpening(r.opening), r.opening)
      }
    }
    return openingLookup.get(key) ?? null
  } catch {
    return null
  }
}

/**
 * Server-side dispenser.
 *
 * Runs Lichess's verified selection ladder (src/lib/dispensing.ts) entirely in SQL,
 * so the full 6.19M-puzzle catalogue can be dispensed from WITHOUT ever loading it
 * into the browser. The client sends its rating + difficulty + theme; this returns
 * exactly one puzzle (plus its real rating_deviation, which the CSV pool lacked).
 *
 * Query shape is the same random-rowid walk proven in /api/puzzles: `ORDER BY RANDOM()`
 * over a 6M-row file sorts the whole matching set, so we start at a random rowid and
 * walk forward, forcing the planner off idx_puzzles_rating with `rating + 0`.
 */

const MAX_EXCLUDE = 200
const EXCLUDE_PARAM_CAP = 120

interface Row {
  id: string
  fen: string
  moves: string
  rating: number
  rating_deviation: number | null
  popularity: number | null
}

function num(v: string | null, fallback: number): number {
  if (v === null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function buildQuery(
  startRowid: number,
  opts: {
    min: number
    max: number
    theme: string | null
    opening: string | null
    minPopularity: number
    exclude: string[]
  },
): { sql: string; args: unknown[] } {
  const where: string[] = ['p.rowid >= ?']
  const args: unknown[] = [startRowid]

  where.push('(p.rating + 0) >= ?')
  args.push(opts.min)
  where.push('(p.rating + 0) <= ?')
  args.push(opts.max)

  if (opts.minPopularity > 0) {
    where.push('COALESCE(p.popularity, 0) >= ?')
    args.push(opts.minPopularity)
  }
  if (opts.theme) {
    where.push('EXISTS (SELECT 1 FROM puzzle_themes t WHERE t.puzzle_id = p.id AND t.theme = ?)')
    args.push(opts.theme)
  }
  if (opts.opening) {
    // The catalogue stores Lichess's RAW tag ("Sicilian_Defense") but every caller
    // passes the camelCase key ("sicilianDefense" — what normaliseOpening emits and
    // what the UI/pinned ids use). Compare in the STORED form or nothing matches,
    // the ladder exhausts every tier and the fallback silently returns a puzzle
    // with no opening at all.
    const raw = rawOpeningFor(opts.opening)
    if (raw === null) {
      // Unknown opening key: match nothing rather than silently ignoring the filter.
      where.push('1 = 0')
    } else {
      where.push('EXISTS (SELECT 1 FROM puzzle_openings o WHERE o.puzzle_id = p.id AND o.opening = ?)')
      args.push(raw)
    }
  }
  if (opts.exclude.length) {
    where.push(`p.id NOT IN (${opts.exclude.map(() => '?').join(',')})`)
    args.push(...opts.exclude)
  }

  const sql =
    `SELECT p.id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity ` +
    `FROM puzzles p WHERE ${where.join(' AND ')} ORDER BY p.rowid LIMIT 1`
  return { sql, args }
}

/** One random-rowid-walk attempt, with wrap-around. */
function attempt(
  db: ReturnType<typeof getDb>,
  maxRowid: number,
  opts: Parameters<typeof buildQuery>[1],
): Row | null {
  const start = Math.floor(Math.random() * Math.max(1, maxRowid))
  const primary = buildQuery(start, opts)
  const hit = db.prepare(primary.sql).get(...(primary.args as never[])) as unknown as Row | undefined
  if (hit) return hit

  const wrap = buildQuery(0, opts)
  const tail = db.prepare(wrap.sql).get(...(wrap.args as never[])) as unknown as Row | undefined
  return tail ?? null
}

/** Fetch the theme + opening tags for a puzzle. */
function tagsFor(
  db: ReturnType<typeof getDb>,
  id: string,
): { themes: string[]; openings: string[] } {
  const themes = (
    db.prepare('SELECT theme FROM puzzle_themes WHERE puzzle_id = ?').all(id) as unknown as {
      theme: string
    }[]
  ).map((r) => r.theme)
  const openings = (
    db.prepare('SELECT opening FROM puzzle_openings WHERE puzzle_id = ?').all(id) as unknown as {
      opening: string
    }[]
  ).map((r) => normaliseOpening(r.opening))
  return { themes: themes.sort(), openings: Array.from(new Set(openings)).sort() }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const userRating = num(searchParams.get('rating'), 1500)
  const difficultyId = searchParams.get('difficulty') ?? 'normal'
  const theme = searchParams.get('theme')
  const opening = searchParams.get('opening')
  const exclude = (searchParams.get('exclude') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_EXCLUDE)

  // Lichess: target = rating + difficulty.ratingDelta
  const delta = DIFFICULTY_DELTA[difficultyId] ?? 0
  const target = userRating + delta

  try {
    const db = getDb()
    const maxRowid = getMaxRowid(db)

    let tier: Tier = isExtremeDifficulty(difficultyId) ? 'good' : 'top'
    let compromise = 0
    const trail: string[] = []

    for (;;) {
      // Lichess caps the exclusion list it will honour at high compromise.
      const useExclude = compromise < MAX_COMPROMISE ? exclude.slice(0, EXCLUDE_PARAM_CAP) : []
      const flex = flexFor(target, compromise)
      const minPopularity = tierMinPopularity(tier)

      const hit = attempt(db, maxRowid, {
        min: target - flex,
        max: target + flex,
        theme,
        opening,
        minPopularity,
        exclude: useExclude,
      })
      trail.push(`${tier}/c${compromise}/±${Math.round(flex)}${hit ? ' HIT' : ' miss'}`)

      if (hit) {
        const tags = tagsFor(db, hit.id)
        return NextResponse.json({
          puzzle: {
            id: hit.id,
            fen: hit.fen,
            moves: hit.moves,
            rating: hit.rating,
            ratingDeviation: hit.rating_deviation,
            popularity: hit.popularity,
            themes: tags.themes,
            openings: tags.openings,
          },
          trace: { target, flex, compromise, tier, difficulty: difficultyId, trail },
        })
      }

      // PuzzleSelector.scala:61-67 — widen, then degrade the tier, then give up.
      if (compromise < MAX_COMPROMISE) {
        compromise += 1
        continue
      }
      const next = stepDown(tier)
      if (next) {
        tier = next
        compromise = 0
        continue
      }
      break
    }

    // Nothing matched anywhere: never return a dead board. Closest rating wins.
    const relaxed = db
      .prepare(
        `SELECT p.id, p.fen, p.moves, p.rating, p.rating_deviation, p.popularity
         FROM puzzles p
         WHERE p.rating BETWEEN ? AND ?
         ORDER BY ABS(p.rating - ?) LIMIT 1`,
      )
      .get(target - 400, target + 400, target) as unknown as Row | undefined

    if (!relaxed) {
      return NextResponse.json({ puzzle: null, trace: { target, trail, gaveUp: true } })
    }
    const relaxedTags = tagsFor(db, relaxed.id)
    return NextResponse.json({
      puzzle: {
        id: relaxed.id,
        fen: relaxed.fen,
        moves: relaxed.moves,
        rating: relaxed.rating,
        ratingDeviation: relaxed.rating_deviation,
        popularity: relaxed.popularity,
        themes: relaxedTags.themes,
        openings: relaxedTags.openings,
      },
      trace: { target, trail, gaveUp: true },
    })
  } catch (e) {
    if (e instanceof DbMissingError) {
      return NextResponse.json({ error: 'db-missing', hint: 'run npm run build-db' }, { status: 503 })
    }
    throw e
  }
}
