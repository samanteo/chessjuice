/**
 * Lichess-faithful puzzle-history SESSION grouping.
 *
 * Ported from lila `modules/puzzle/src/main/PuzzleHistory.scala`:
 *
 *   case class PuzzleSession(puzzles: NonEmptyList[SessionRound])   // oldest first
 *   def angle = puzzles.head.angle
 *
 *   if last.puzzles.head.angle == r.angle &&
 *      r.round.date.isAfter(last.puzzles.head.round.date.minusHours(1))
 *   then last.copy(puzzles = r :: last.puzzles)   // same session
 *   else PuzzleSession(NonEmptyList(r, Nil))      // new session
 *
 * lila folds the list NEWEST-first and PREPENDS each round, so `puzzles.head` is
 * always the most recently added round — i.e. the one immediately newer than `r`.
 * Walking OLDEST-first is equivalent and much easier to read: append `r` when it
 * shares the previous round's angle AND the gap is under one hour.
 *
 * Pagination in lila is `maxPerPage = 100` SESSIONS per page (not rounds).
 */

export interface HistoryRound {
  puzzleId: string;
  at: Date;
  /** The angle this round was played under: an opening key, a theme key, or "mix". */
  angle: string;
  result: string;
  rating: number | null;
  themes: string[];
  openings: string[];
}

export interface HistorySession {
  /** lila: `def angle = puzzles.head.angle` — the angle of the OLDEST round. */
  angle: string;
  startedAt: Date;
  endedAt: Date;
  /** Chronological, oldest first. */
  rounds: HistoryRound[];
}

/** lila: `minusHours(1)`. */
export const SESSION_GAP_MS = 60 * 60 * 1000;

/** lila: `maxPerPage = MaxPerPage(100)` — 100 sessions per page. */
export const SESSIONS_PER_PAGE = 100;

/**
 * Resolve a round's angle.
 *
 * DEVIATION, stated plainly: lila stores the angle the user *chose to train* on
 * the round document. We do not record that, so we derive it — an explicit
 * `angle` wins, else the puzzle's first opening tag, else `"mix"`. This means a
 * run of opening-tagged puzzles groups the way Lichess's opening drill would,
 * and everything else lands in the single "mix" bucket, which is also how lila
 * behaves when you train the mixed angle.
 */
export function resolveAngle(src: {
  angle?: string | null;
  openings?: string[] | null;
  themes?: string[] | null;
}): string {
  if (src.angle) return src.angle;
  if (src.openings && src.openings.length > 0) return src.openings[0];
  return "mix";
}

/** Human label for an angle key. `mix` is lila's mixed/default angle. */
export function angleLabel(angle: string): string {
  if (angle === "mix") return "Mixed";
  // camelCase -> "Title Case" (sicilianDefenseDragonVariation -> Sicilian Defense Dragon Variation)
  return angle
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Fold rounds into sessions. Input order does not matter — we sort oldest first,
 * exactly like lila's `Sort(Descending("d"))` + reverse.
 */
export function groupIntoSessions(rounds: HistoryRound[]): HistorySession[] {
  const sorted = [...rounds].sort((a, b) => a.at.getTime() - b.at.getTime());
  const sessions: HistorySession[] = [];

  for (const r of sorted) {
    const last = sessions[sessions.length - 1];
    if (last) {
      const prev = last.rounds[last.rounds.length - 1]; // most recent in this session
      const sameAngle = prev.angle === r.angle;
      const withinGap = r.at.getTime() - prev.at.getTime() < SESSION_GAP_MS;
      if (sameAngle && withinGap) {
        last.rounds.push(r);
        last.endedAt = r.at;
        continue;
      }
    }
    sessions.push({ angle: r.angle, startedAt: r.at, endedAt: r.at, rounds: [r] });
  }

  return sessions;
}

/** Sessions newest-first, for display. */
export function sessionsNewestFirst(sessions: HistorySession[]): HistorySession[] {
  return [...sessions].sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime());
}
