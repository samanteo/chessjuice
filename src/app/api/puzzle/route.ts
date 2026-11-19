import { NextResponse } from 'next/server'
import { getDb, DbMissingError, normaliseOpening } from '@/lib/puzzleDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'missing-id', hint: 'pass ?id=<puzzleId>' }, { status: 400 })
  }

  try {
    const db = getDb()
    const row = db
      .prepare(
        'SELECT id, fen, moves, rating, rating_deviation, popularity FROM puzzles WHERE id = ?',
      )
      .get(id) as
      | {
          id: string
          fen: string
          moves: string
          rating: number
          rating_deviation: number | null
          popularity: number | null
        }
      | undefined

    if (!row) {
      return NextResponse.json({ error: 'not-found', id }, { status: 404 })
    }

    const themeRows = db
      .prepare('SELECT theme FROM puzzle_themes WHERE puzzle_id = ? ORDER BY theme')
      .all(id) as unknown as { theme: string }[]

    const openingRows = db
      .prepare('SELECT opening FROM puzzle_openings WHERE puzzle_id = ?')
      .all(id) as unknown as { opening: string }[]

    return NextResponse.json({
      id: row.id,
      fen: row.fen,
      moves: row.moves,
      rating: row.rating,
      ratingDeviation: row.rating_deviation,
      popularity: row.popularity,
      themes: themeRows.map((t) => t.theme),
      openings: Array.from(new Set(openingRows.map((o) => normaliseOpening(o.opening)))).sort(),
    })
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
