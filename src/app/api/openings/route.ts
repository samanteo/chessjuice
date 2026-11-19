import { NextResponse } from 'next/server'
import { getDb, DbMissingError, normaliseOpening } from '@/lib/puzzleDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Opening counts across the whole catalogue.
 *
 * The All-themes browser used to derive these by grouping the 371k-row CSV held in
 * memory. With the catalogue server-side, the counts come from the DB instead — and
 * they now cover all 6.19M puzzles rather than a subset.
 *
 * Response: `{ total, totalPuzzles, openings: [{ opening, count }] }` where
 * `opening` is the camelCase key (matching `normaliseOpening`) and the list is
 * sorted by count descending.
 *
 * Cached in-process: this aggregates 2.46M rows, so it is computed once per
 * server start rather than on every request.
 */
let cached: { total: number; totalPuzzles: number; openings: { opening: string; count: number }[] } | null = null

export async function GET() {
  try {
    if (cached) return NextResponse.json(cached)

    const db = getDb()
    const rows = db
      .prepare(
        'SELECT opening, COUNT(*) AS count FROM puzzle_openings GROUP BY opening ORDER BY count DESC',
      )
      .all() as unknown as { opening: string; count: number }[]

    const openings = rows.map((r) => ({
      opening: normaliseOpening(r.opening),
      count: r.count,
    }))

    cached = {
      total: openings.length,
      totalPuzzles: openings.reduce((n, o) => n + o.count, 0),
      openings,
    }
    return NextResponse.json(cached)
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
