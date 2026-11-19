/**
 * puzzleApi.ts — typed client helpers for the server-side puzzle API.
 *
 * Plain `fetch` wrappers (no React). Safe to import from client components.
 * The browser only ever receives the handful of puzzles it asks for — never
 * the full catalog.
 */

export interface ApiPuzzle {
  id: string
  fen: string
  moves: string
  rating: number
  popularity: number | null
  themes: string[]
}

export type ThemeCounts = Record<string, number>

export interface FetchPuzzlesParams {
  themes?: string[]
  min?: number
  max?: number
  limit?: number
  exclude?: string[]
}

/** GET /api/themes -> { theme: count, ... } */
export async function fetchThemeCounts(): Promise<ThemeCounts> {
  const res = await fetch('/api/themes')
  if (!res.ok) throw new Error(`fetchThemeCounts failed: ${res.status}`)
  return (await res.json()) as ThemeCounts
}

/** GET /api/puzzles -> randomised array of puzzles matching the filters. */
export async function fetchPuzzles({
  themes,
  min,
  max,
  limit,
  exclude,
}: FetchPuzzlesParams = {}): Promise<ApiPuzzle[]> {
  const params = new URLSearchParams()
  if (themes && themes.length) params.set('themes', themes.join(','))
  if (min !== undefined) params.set('min', String(min))
  if (max !== undefined) params.set('max', String(max))
  if (limit !== undefined) params.set('limit', String(limit))
  if (exclude && exclude.length) params.set('exclude', exclude.join(','))

  const res = await fetch(`/api/puzzles?${params.toString()}`)
  if (!res.ok) throw new Error(`fetchPuzzles failed: ${res.status}`)
  return (await res.json()) as ApiPuzzle[]
}

/** GET /api/puzzle?id=... -> single puzzle (null when not found). */
export async function fetchPuzzle(id: string): Promise<ApiPuzzle | null> {
  const res = await fetch(`/api/puzzle?id=${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`fetchPuzzle failed: ${res.status}`)
  return (await res.json()) as ApiPuzzle
}
