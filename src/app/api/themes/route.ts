import { NextResponse } from 'next/server'
import { getDb, DbMissingError } from '@/lib/puzzleDb'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Cached in module scope after the first successful call.
let cache: Record<string, number> | null = null

export async function GET() {
  if (cache) {
    return NextResponse.json(cache, { headers: { 'x-cache': 'hit' } })
  }
  try {
    const db = getDb()
    const rows = db
      .prepare('SELECT theme, COUNT(*) AS n FROM puzzle_themes GROUP BY theme ORDER BY theme')
      .all() as { theme: string; n: number }[]

    const out: Record<string, number> = {}
    for (const r of rows) out[r.theme] = Number(r.n)
    cache = out
    return NextResponse.json(out)
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
