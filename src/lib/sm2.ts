/**
 * Hardcoded-ladder scheduler for mistake-deck puzzles.
 *
 * There is NO decaying multiplier and NO interval growth factor anywhere: the
 * ladder IS the schedule. Only TWO outcomes matter:
 *
 *   - CORRECT -> advance exactly ONE rung.
 *   - HARD    -> IDENTICAL to a WRONG answer: drop straight back to rung 0.
 *     ("If you click on hard its the same as u got puzzle wrong... you must get
 *      it right before moving on or it keeps coming back into the deck.")
 *
 * LADDER (rung index -> delay before the puzzle is shown again):
 *   rung 0 -> today's deck (a few minutes / back of the queue)
 *   rung 1 -> 1 day
 *   rung 2 -> 2 days
 *   rung 3 -> 3 days
 *   rung 4 -> 7 days
 *   rung 5 -> 14 days
 *   rung 6 -> 30 days
 *   rung 7 -> 90 days
 *   completing rung 7 (a correct answer while on rung 7) -> MASTERED
 *     (leaves the active deck; still viewable, NEVER deleted).
 *
 * A puzzle is only scheduled while it belongs to the mistake deck
 * (isWrongPuzzle = true). A puzzle solved correctly on the first try never
 * enters the ladder — HARD is the explicit "I am not solid" signal that puts a
 * puzzle into the mistake deck at rung 0 without it being answered wrong.
 */

// The only two outcomes. 'hard' is the not-solid transition and is shared by
// both a genuinely wrong answer and the user pressing the HARD button.
export type SM2Result = 'correct' | 'hard';

/**
 * The ladder. Index = rung; value = delay in DAYS before the puzzle returns.
 * Index 0 is special ("today's deck") and is served as TODAY_DELAY_MINUTES.
 */
export const LADDER_DAYS = [0, 1, 2, 3, 7, 14, 30, 90] as const;

/** Highest rung in the ladder (7 -> 90 days). */
export const MAX_RUNG = LADDER_DAYS.length - 1; // 7

/** Rung value that means "completed the ladder" (mastered, leaves the deck). */
export const MASTERED_RUNG = MAX_RUNG + 1; // 8

/** rung 0 sends the puzzle back into today's deck after this many minutes. */
export const TODAY_DELAY_MINUTES = 5;

// Pure time-unit conversions (NOT schedule maths — the schedule is the table).
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SM2State {
  /** Ladder rung, 0..MAX_RUNG; MASTERED_RUNG (8) = mastered. */
  rung: number;
  /** When the puzzle is next shown. */
  dueDate: Date;
  /** Last review timestamp. */
  lastReviewed?: Date;
  /** Last review outcome. */
  lastResult?: SM2Result;
  /** Only mistake-deck puzzles are scheduled by the ladder. */
  isWrongPuzzle: boolean;
  /** Manual removal only — the ladder never deletes a puzzle. */
  removedAt?: Date;
}

/** Delay in days for a rung (rung 0 -> 0 = "today"). */
export function ladderDaysForRung(rung: number): number {
  if (rung <= 0) return 0;
  if (rung > MAX_RUNG) return LADDER_DAYS[MAX_RUNG];
  return LADDER_DAYS[rung];
}

/** Delay in milliseconds before a puzzle on `rung` is shown again. */
export function delayMsForRung(rung: number): number {
  if (rung <= 0) return TODAY_DELAY_MINUTES * MINUTE_MS; // today's deck
  if (rung > MAX_RUNG) return 0; // mastered — no active schedule
  return LADDER_DAYS[rung] * DAY_MS;
}

/**
 * Create the initial state for a new mistake (failed on first attempt):
 * rung 0, due back in today's deck.
 */
export function createInitialWrongPuzzleState(): SM2State {
  const now = new Date();
  return {
    rung: 0,
    dueDate: new Date(now.getTime() + delayMsForRung(0)),
    isWrongPuzzle: true,
  };
}

/**
 * Create the state for a puzzle solved correctly on the first try. It does NOT
 * enter the mistake deck (the ladder only schedules mistakes), so there is
 * nothing to review — the user must explicitly mark it HARD to send it there.
 */
export function createInitialCorrectState(): SM2State {
  return {
    rung: 0,
    dueDate: new Date(),
    isWrongPuzzle: false,
  };
}

/**
 * Apply one review outcome.
 *
 *   correct -> advance exactly one rung (rung 7 -> mastered).
 *   hard    -> drop straight back to rung 0 (today's deck). This is the SAME
 *              transition a wrong answer takes.
 */
export function calculateNextState(currentState: SM2State, result: SM2Result): SM2State {
  const now = new Date();

  // The ladder only schedules mistake-deck puzzles. A clean solve of a
  // non-mistake puzzle records the result but changes nothing.
  if (!currentState.isWrongPuzzle) {
    return { ...currentState, lastReviewed: now, lastResult: result };
  }

  if (result === 'correct') {
    const nextRung = Math.min(currentState.rung + 1, MASTERED_RUNG);
    return {
      ...currentState,
      rung: nextRung,
      dueDate: new Date(now.getTime() + delayMsForRung(nextRung)),
      lastReviewed: now,
      lastResult: result,
    };
  }

  // 'hard' — identical to a wrong answer: straight back to rung 0.
  return {
    ...currentState,
    rung: 0,
    dueDate: new Date(now.getTime() + delayMsForRung(0)),
    lastReviewed: now,
    lastResult: result,
  };
}

/**
 * Get queue classification for a puzzle based on its ladder state.
 *
 *   due       -> ready now (rung 0 = today's deck, or an overdue scheduled rung)
 *   mastered  -> scheduled ahead on a later rung, or the ladder is completed
 *   new       -> not a mistake-deck puzzle (never scheduled)
 *   archived  -> manually removed
 */
export type QueueType = 'due' | 'new' | 'learning' | 'mastered' | 'archived';

export function getQueueType(state: SM2State, now: Date = new Date()): QueueType {
  if (state.removedAt) return 'archived';

  if (!state.isWrongPuzzle) {
    return 'new'; // clean solves are never queued
  }

  if (state.rung > MAX_RUNG) {
    return 'mastered'; // completed the ladder (still viewable, never deleted)
  }

  // Rung 0 is today's deck — it is DUE NOW (not "learning").
  if (state.rung <= 0) {
    return 'due';
  }

  // A puzzle you answered correctly is scheduled ahead. Until its next rung
  // date arrives it sits in LEARNING; once the date arrives it becomes DUE.
  return state.dueDate <= now ? 'due' : 'learning';
}

/** Check if a puzzle is due for review right now. */
export function isDue(state: SM2State, now: Date = new Date()): boolean {
  if (!state.isWrongPuzzle) return false;
  if (state.removedAt) return false;
  if (state.rung > MAX_RUNG) return false;
  return state.dueDate <= now;
}

/** Human-readable description of where a puzzle sits on the ladder. */
export function getIntervalDescription(state: SM2State): string {
  if (!state.isWrongPuzzle) return 'New puzzle';
  if (state.rung > MAX_RUNG) return 'Mastered';
  if (state.rung <= 0) return 'Today';
  const days = LADDER_DAYS[state.rung];
  return days === 1 ? '1 day' : `${days} days`;
}

/** Convert ladder state to a database row. */
export function stateToDbRow(state: SM2State): Record<string, any> {
  return {
    rung: state.rung,
    due_date: state.dueDate.toISOString(),
    last_reviewed: state.lastReviewed?.toISOString() || null,
    last_result: state.lastResult || null,
    is_wrong_puzzle: state.isWrongPuzzle,
    removed_at: state.removedAt?.toISOString() || null,
  };
}

/** Convert a database row back to ladder state. */
export function dbRowToState(row: Record<string, any>): SM2State {
  return {
    rung: typeof row.rung === 'number' ? row.rung : 0,
    dueDate: new Date(row.due_date),
    lastReviewed: row.last_reviewed ? new Date(row.last_reviewed) : undefined,
    lastResult: row.last_result || undefined,
    isWrongPuzzle: !!row.is_wrong_puzzle,
    removedAt: row.removed_at ? new Date(row.removed_at) : undefined,
  };
}

/** Simulate ladder progression for testing. */
export function simulateProgression(results: SM2Result[]): SM2State[] {
  const states: SM2State[] = [];
  let state = createInitialWrongPuzzleState();
  states.push({ ...state });

  for (const result of results) {
    state = calculateNextState(state, result);
    states.push({ ...state });
  }

  return states;
}
