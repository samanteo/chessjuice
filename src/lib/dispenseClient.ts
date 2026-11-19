/**
 * dispenseClient.ts — client-side caller for the server-side dispenser.
 *
 * The full catalogue is 6.19M puzzles, so it is NEVER held in the browser. The
 * client sends only its rating + difficulty + angle (theme or opening) and gets
 * back exactly one puzzle, already selected by the Lichess-faithful ladder that
 * runs in SQL inside /api/dispense.
 *
 * Falls back to `null` when the DB is absent (HTTP 503), so the app can keep
 * working off the in-memory CSV pool in that case.
 */

export interface DispensedPuzzle {
  id: string
  fen: string
  moves: string
  rating: number
  /** The puzzle's REAL Glicko rating deviation (Lichess ships this). */
  ratingDeviation: number | null
  popularity: number | null
  themes: string[]
  openings: string[]
}

export interface DispenseTrace {
  target: number
  flex?: number
  compromise?: number
  tier?: string
  difficulty?: string
  trail?: string[]
  gaveUp?: boolean
}

export interface DispenseResult {
  puzzle: DispensedPuzzle | null
  trace: DispenseTrace
}

export interface DispenseParams {
  rating: number
  difficulty: string
  /** A theme key (Lichess "angle"). */
  theme?: string | null
  /** An opening tag (also an "angle" in Lichess's model). */
  opening?: string | null
  /** Recently-served puzzle ids — Lichess's `previousPaths` exclusion. */
  exclude?: Iterable<string>
}

const EXCLUDE_CAP = 120

export async function dispenseFromDb(p: DispenseParams): Promise<DispenseResult | null> {
  const qs = new URLSearchParams({
    rating: String(Math.round(p.rating)),
    difficulty: p.difficulty,
  })
  if (p.theme) qs.set('theme', p.theme)
  if (p.opening) qs.set('opening', p.opening)
  if (p.exclude) {
    const list = Array.from(p.exclude).slice(-EXCLUDE_CAP)
    if (list.length) qs.set('exclude', list.join(','))
  }

  try {
    const res = await fetch(`/api/dispense?${qs.toString()}`, { cache: 'no-store' })
    // DB not built yet — let the caller fall back to the CSV pool.
    if (res.status === 503) return null
    if (!res.ok) return null
    const json = (await res.json()) as DispenseResult
    if (!json?.puzzle) return null
    return json
  } catch {
    return null
  }
}

/** True when the server-side catalogue is available. */
export async function dbAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/themes', { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

/** Server cap on a single by-id batch (/api/puzzles MAX_IDS). */
const IDS_PER_BATCH = 200

/**
 * Fetch specific puzzles by id, in batches.
 *
 * This is how the browser gets puzzle data now that the 53 MB CSV is gone: the
 * user's own set (progress + attempts) is hydrated at load, and anything else
 * (dispensed, replayed) is fetched on demand. Order of the returned array is not
 * guaranteed to match the input across batches, so callers should key by `id`.
 *
 * Returns [] on any failure — callers treat a missing puzzle as "not loadable".
 */
export async function fetchPuzzlesByIds(ids: Iterable<string>): Promise<DispensedPuzzle[]> {
  const unique = Array.from(new Set(ids)).filter(Boolean)
  if (unique.length === 0) return []

  const batches: string[][] = []
  for (let i = 0; i < unique.length; i += IDS_PER_BATCH) {
    batches.push(unique.slice(i, i + IDS_PER_BATCH))
  }

  const out: DispensedPuzzle[] = []
  for (const batch of batches) {
    try {
      const res = await fetch(`/api/puzzles?ids=${encodeURIComponent(batch.join(','))}`, {
        cache: 'no-store',
      })
      if (!res.ok) continue
      const json = (await res.json()) as DispensedPuzzle[]
      if (Array.isArray(json)) out.push(...json)
    } catch {
      // Skip this batch; the rest of the set still loads.
    }
  }
  return out
}

/** Theme -> puzzle count across the whole catalogue. */
export async function fetchThemeCounts(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch('/api/themes', { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as Record<string, number>
  } catch {
    return null
  }
}

export interface OpeningCount {
  opening: string
  count: number
}

export interface OpeningCounts {
  total: number
  totalPuzzles: number
  openings: OpeningCount[]
}

/** Opening -> puzzle count across the whole catalogue. */
export async function fetchOpeningCounts(): Promise<OpeningCounts | null> {
  try {
    const res = await fetch('/api/openings', { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as OpeningCounts
  } catch {
    return null
  }
}
