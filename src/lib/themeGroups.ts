/**
 * Theme grouping for the Review queue's "Group by theme" view.
 *
 * WHY THIS EXISTS
 * The review queue used to group by ANGLE (`resolveAngle` in historySessions),
 * which is Lichess's opening-session idea. That is the wrong key for puzzles:
 * ~83% of Lichess puzzles carry no opening tag at all, so on the user's own
 * queue the whole list collapsed into ONE group literally labelled "Mixed" —
 * a button called "Group by theme" that produced a single bucket. Verified on
 * the live queue: 37 due puzzles, 1 group, "Mixed".
 *
 * Grouping by THEME means grouping by the *motif* the puzzle teaches. A puzzle
 * carries several tags, and the first one is frequently an evaluation tag
 * ("crushing", "advantage") or a phase/length tag ("middlegame", "long") rather
 * than a pattern. Grouping on those would rebuild the same useless buckets, so
 * we skip them and take the first real motif.
 */

import type { UserPuzzle } from "@/types";

/**
 * Tags that describe a position's evaluation, game phase, length or audience —
 * never the pattern to practise. Grouping by these gives buckets like
 * "Crushing" / "Advantage" / "Endgame" that say nothing about what to train.
 */
export const NON_MOTIF_TAGS = new Set<string>([
  // evaluation
  "advantage",
  "crushing",
  "equality",
  "mate",
  // game phase
  "opening",
  "middlegame",
  "endgame",
  // length / move count
  "short",
  "long",
  "oneMove",
  "veryLong",
  // audience / source
  "master",
  "masterVsMaster",
  "superGM",
]);

/** The key a puzzle is grouped under: its first real motif tag. */
export function puzzleThemeGroup(puzzle: {
  themes?: string[] | null;
  openings?: string[] | null;
}): string {
  const themes = puzzle.themes ?? [];
  const motif = themes.find((t) => !NON_MOTIF_TAGS.has(t));
  if (motif) return motif;
  // Everything is non-motif (rare): fall back to the first tag so the puzzle is
  // never silently dropped from the grouped view, then to "mix".
  if (themes.length > 0) return themes[0];
  const opening = (puzzle.openings ?? [])[0];
  return opening ?? "mix";
}

/** True when the puzzle has at least one real motif tag to group on. */
export function hasMotifTag(puzzle: UserPuzzle | { themes?: string[] | null }): boolean {
  return (puzzle.themes ?? []).some((t) => !NON_MOTIF_TAGS.has(t));
}

/** localStorage key for the review queue's "Group by theme" preference. */
export const GROUP_BY_THEME_KEY = "puzzle_trainer_group_by_theme";
