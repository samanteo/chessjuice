"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Chess } from "chess.js";
import { ChessgroundWrapper } from "@/components/chessground/ChessgroundWrapper";
import { useTheme } from "@/components/theme/ThemeProvider";
import { UserPuzzle, PuzzleAttempt } from "@/types";
import { playSound } from "@/lib/sound";
import { SessionStrip, type SessionEntry } from "@/components/SessionStrip";

type Key = string;

/**
 * Delay before the opponent's first move is applied.
 *
 * We render the pre-move position first and apply the move after this delay so
 * chessground has a FEN transition to animate. Applying it in the same tick as
 * the initial render makes the piece teleport in instead of moving.
 */
const FIRST_MOVE_DELAY_MS = 450;

/** How long a mid-puzzle "skip" stays armed before it resets (two-tap guard). */
const SKIP_CONFIRM_MS = 4000;

/**
 * Is the viewport wide enough for the session strip to share the button row?
 *
 * On a WIDE screen the strip fits comfortably between Solution and the Skip/Next
 * column, and keeping it in that row costs no vertical space — which matters
 * because the board is height-limited, so any extra row makes the board smaller
 * (measured: 518px with the strip inline vs 469px with it on its own row).
 *
 * On a NARROW screen there is no room in that row, so the strip gets its own row
 * above the buttons where it cannot collide with anything.
 */
function useIsWideScreen(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(min-width: 900px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return wide;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface PuzzleBoardProps {
  puzzle: UserPuzzle;
  userRating: number;
  pieceSet: string;
  boardTheme: string;
  coordinates: boolean;
  onComplete: (attempt: PuzzleAttempt) => void;
  onClose: () => void;
  /**
   * Move to the NEXT puzzle in this context. Kept separate from `onComplete`
   * because a losing outcome (wrong move / timeout / solution revealed) must be
   * RECORDED immediately — the rating and the mistake deck update at once — but
   * must NOT yank the board away: the user stays to step through the solution.
   * Only an explicit "Next puzzle" (or HARD) navigates.
   */
  onAdvance?: () => void;
  /**
   * The theme/opening this puzzle is being trained under (already a display label,
   * e.g. "Fork" or "Sicilian Defense"). Shown above the board so you can see what
   * you asked to practise. Omitted for a plain review of a mistake.
   */
  angleLabel?: string | null;
  /**
   * Session progress chips, rendered INSIDE the foot between the Solution button
   * and the Skip/Next column. The user asked for them there instead of below the
   * board, where they sat under the fold on a phone and wasted the space.
   */
  sessionEntries?: SessionEntry[];
  sessionActiveIndex?: number | null;
  sessionThemeLabel?: string | null;
  onReplayAt?: (index: number) => void;
  /**
   * Whether the puzzle's theme tags are shown in the head. The TAGS switch in the
   * head toggles it; the value lives in user settings so the choice survives a
   * reload and syncs between phone and laptop. Default OFF — the tags name the
   * motif, which is a hint, so they are opt-in.
   */
  showTags?: boolean;
  onToggleTags?: () => void;
}

interface Snapshot {
  fen: string;
  lastMove?: Key[];
}

export function PuzzleBoard({
  puzzle,
  userRating,
  pieceSet,
  boardTheme,
  coordinates,
  onComplete,
  onClose,
  onAdvance,
  angleLabel,
  sessionEntries,
  sessionActiveIndex,
  sessionThemeLabel,
  onReplayAt,
  showTags = false,
  onToggleTags,
}: PuzzleBoardProps) {
  const theme = useTheme();
  const isWide = useIsWideScreen();
  const {
    animation,
    pieceAnimation,
    highlightLastMove,
    highlightCheck,
    autoCastle,
    autoPromoteToQueen,
    blockTouchScroll,
    puzzleTimerSeconds,
  } = theme;

  // Optional per-puzzle countdown (0 = Off).
  const timerSeconds = puzzleTimerSeconds || 0;
  const timerEnabled = timerSeconds > 0;

  const solutionMoves = useMemo(
    () => puzzle.moves.split(" ").filter(Boolean),
    [puzzle.moves]
  );

  // chess.js game state (authoritative)
  const gameRef = useRef<Chess>(new Chess(puzzle.fen));
  const [view, setView] = useState<Snapshot>({ fen: puzzle.fen });
  const [moveIndex, setMoveIndex] = useState(0); // index of next expected SOLVER move
  const [solverColor, setSolverColor] = useState<"white" | "black">("white");
  const [status, setStatus] = useState<"playing" | "correct" | "wrong">("playing");
  /**
   * Has the SOLVER touched this attempt yet? The sync engine reads this (via
   * `data-attempt`) to decide whether a page reload would destroy work in
   * progress. `moveIndex` is no good: it starts at 1 when the puzzle opens with
   * the opponent's move, so a freshly served puzzle would look "in progress".
   */
  const [attemptTouched, setAttemptTouched] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const [hintSquare, setHintSquare] = useState<Key | null>(null);
  const [hintUsed, setHintUsed] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  // The attempt for a finished puzzle, held so the user can still press HARD
  // on a correct solve (lucky guess) before moving on.
  const [finishedAttempt, setFinishedAttempt] = useState<PuzzleAttempt | null>(null);
  // Countdown: seconds remaining on the optional puzzle timer (0 = Off).
  const [timeLeft, setTimeLeft] = useState<number>(timerSeconds);
  // Live status mirror so the (stable) timer callback can guard against a
  // double fire without re-creating itself on every tick.
  const statusRef = useRef<"playing" | "correct" | "wrong">("playing");
  const startTimeRef = useRef<number>(Date.now());
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ---- Move history: Lichess-style back / forward -------------------------
  // Every position this puzzle passes through, oldest first. `scrubIndex` is the
  // entry currently being VIEWED; `null` means "follow the live position".
  //
  // Scrubbing is purely VISUAL. It never touches gameRef (the authoritative
  // chess.js game), the SM-2 ladder, the attempt record, or the rating — so
  // stepping back to re-see the moves can never mark the puzzle as failed.
  const [history, setHistory] = useState<Snapshot[]>([{ fen: puzzle.fen }]);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const isScrubbing = scrubIndex !== null;

  /** Commit a new live position AND append it to the history. */
  const commitView = useCallback((snap: Snapshot) => {
    setView(snap);
    setHistory((h) => [...h, snap]);
    setScrubIndex(null);
  }, []);

  const clearTimers = () => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
  };

  // Safely apply a UCI move to a chess.js instance
  const applyUci = (g: Chess, uci: string): boolean => {
    try {
      const res = g.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || "q",
      });
      return !!res;
    } catch {
      return false;
    }
  };

  // ---- Record the attempt EXACTLY ONCE per puzzle --------------------------
  // A losing outcome (wrong move / timeout / solution revealed) is recorded the
  // MOMENT it happens, because the rating and the mistake deck must update right
  // away — but the board stays put so the solution can be studied. Pressing
  // "Next puzzle" must therefore NOT record it a second time.
  const recordedRef = useRef(false);
  // The solution line is played onto the board exactly ONCE per puzzle. A second
  // tap used to append the whole line again and land on the FINAL position —
  // which is what "the solution starts at the last move" really was: the first
  // tap leaves the board on the position you were already looking at (the start
  // of the line), so nothing visibly changes and a second tap is natural.
  const playedOutRef = useRef(false);
  const lineStartRef = useRef(0);
  const recordOnce = useCallback(
    (attempt: PuzzleAttempt) => {
      if (recordedRef.current) return;
      recordedRef.current = true;
      onComplete(attempt);
    },
    [onComplete]
  );

  // ---- Play the rest of the solution onto the board ------------------------
  // Used by BOTH "show solution" and a wrong/timeout finish, so every losing
  // outcome leaves the full line on the board, step-through-able with the ◀ ▶
  // controls (each position is appended to `history`).
  const playOutRemaining = useCallback(() => {
    // Idempotent: if the line is already on the board, just walk the view back to
    // its start. Re-appending would duplicate every position in `history` and
    // drop the counter on the final move — the "solution starts at the last
    // move" report.
    if (playedOutRef.current) {
      setScrubIndex(lineStartRef.current);
      return;
    }

    // CANCEL PENDING ANIMATION TIMERS FIRST. The opponent's reply is committed
    // 350ms after the solver's move, so failing or asking for the solution inside
    // that window leaves a timer queued. When it fires it calls commitView(),
    // which clears scrubIndex — and the board jumps to the LAST position of the
    // line instead of the one you failed on. That is the "after I got a move or
    // two right, the solution jumps to the last move" report. Killing the timers
    // here makes the position we land on below final, whatever was queued.
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];
    const g = new Chess(gameRef.current.fen());
    let last: Key[] | undefined;
    const steps: Snapshot[] = [];
    for (let i = moveIndex; i < solutionMoves.length; i++) {
      if (!applyUci(g, solutionMoves[i])) break;
      last = [solutionMoves[i].slice(0, 2), solutionMoves[i].slice(2, 4)];
      steps.push({ fen: g.fen(), lastMove: last });
    }
    gameRef.current = g;

    // Where the solver stood BEFORE the line is played out — i.e. the position
    // the first solution move is played FROM.
    const startIdx = history.length - 1;

    if (steps.length > 0) {
      playedOutRef.current = true;
      lineStartRef.current = startIdx;
      setHistory((h) => [...h, ...steps]);
      // Land on the START of the line, not the end. Showing the final position
      // meant you had to rewind to move 1 every single time to see how the
      // solution began; now ◀ ▶ walks FORWARD through it from the beginning.
      // (The live position stays the true end — `view` is untouched and
      // scrubbing is purely visual, so nothing is scored differently.)
      setScrubIndex(startIdx);
    } else {
      setView({ fen: g.fen(), lastMove: last });
      setScrubIndex(null);
    }
  }, [moveIndex, solutionMoves, history.length]);

  // Initialize / reset whenever the puzzle changes
  useEffect(() => {
    clearTimers();
    playedOutRef.current = false;
    lineStartRef.current = 0;
    const g = new Chess(puzzle.fen);
    gameRef.current = g;
    startTimeRef.current = Date.now();

    // The FEN side-to-move is the OPPONENT. The solver is the opposite color.
    const opponentColor = g.turn(); // "w" | "b"
    setSolverColor(opponentColor === "w" ? "black" : "white");

    // Auto-play the opponent's first move (Moves[0]) to reveal the puzzle position.
    //
    // IMPORTANT: this must be a DELAYED second setView, not part of the initial
    // one. chessground animates a piece when the FEN CHANGES; if the board's very
    // first render is already the post-move position there is no transition and
    // the piece simply teleports in. So we render the pre-move position first,
    // then apply the move a beat later and let chessground animate it.
    const first = solutionMoves[0];
    setHistory([{ fen: puzzle.fen }]);
    setScrubIndex(null);
    setView({ fen: puzzle.fen, lastMove: undefined });
    if (first) {
      setMoveIndex(1);
      const t = setTimeout(() => {
        applyUci(g, first);
        commitView({
          fen: g.fen(),
          lastMove: [first.slice(0, 2) as Key, first.slice(2, 4) as Key],
        });
      }, FIRST_MOVE_DELAY_MS);
      timersRef.current.push(t);
    } else {
      setMoveIndex(0);
    }
    setStatus("playing");
    setAttemptTouched(false);
    setFeedback("");
    setHintSquare(null);
    setHintUsed(false);
    setShowSolution(false);
    setFinishedAttempt(null);
    statusRef.current = "playing";
    setTimeLeft(timerSeconds);
    playSound("start");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  // Reset the countdown if the timer setting changes mid-puzzle.
  useEffect(() => {
    setTimeLeft(timerSeconds);
  }, [timerSeconds]);

  // Keep the live status mirror in sync for the timer guard.
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Legal move destinations for the side to move (chessground format)
  const dests = useMemo(() => {
    const map = new Map<string, string[]>();
    try {
      const moves = gameRef.current.moves({ verbose: true }) as any[];
      moves.forEach((m) => {
        const from = m.from as string;
        const to = m.to as string;
        if (!map.has(from)) map.set(from, []);
        map.get(from)!.push(to);
      });
    } catch {
      /* ignore */
    }
    return map;
  }, [view.fen]);

  const finish = useCallback(
    (correct: boolean, userMoveUci?: string, expectedUci?: string, timedOut = false) => {
      setStatus(correct ? "correct" : "wrong");
      if (correct) {
        playSound("correct");
        // ONE short line, matching the red "Puzzle failed" banner. The banner sits
        // above the board and the board is height-limited on a phone, so every
        // extra wrapped line costs board pixels. The "lucky guess" hint already
        // lives on the Hard button's tooltip, so it is not lost by shortening.
        setFeedback("Correct! 🎉");
      } else if (timedOut) {
        // Both losing outcomes read the SAME short label on purpose — the full
        // line is played onto the board below, so the old "the best move was X"
        // sentence was redundant and cost two lines above the board's own space.
        playSound("wrong");
        setFeedback("Puzzle failed");
      } else {
        playSound("wrong");
        setFeedback("Puzzle failed");
      }
      const attempt: PuzzleAttempt = {
        puzzleId: puzzle.id,
        userId: "",
        result: correct ? "correct" : "incorrect",
        userMove: userMoveUci,
        expectedMove: expectedUci || solutionMoves[moveIndex],
        moveNumber: moveIndex,
        timeSpent: Date.now() - startTimeRef.current,
        hintUsed,
        solutionViewed: showSolution,
        ratingBefore: userRating,
        // The Glicko-2 rating change is computed by the store (usePuzzleStore),
        // which owns the rating state; the board only reports the outcome.
        ratingAfter: userRating,
        // Carry the puzzle's own metadata. The store's catalogue index only holds
        // the user's hydrated set, so a puzzle dispensed from the 6.19M server
        // catalogue is NOT in it — without these fields `recordAttempt` finds no
        // metadata and silently skips BOTH the SM-2 progress and the Glicko update.
        puzzleRating: puzzle.rating,
        puzzleDeviation: (puzzle as unknown as { ratingDeviation?: number | null }).ratingDeviation ?? null,
        themes: puzzle.themes,
        openings: puzzle.openings ?? [],
        timestamp: new Date(),
      };
      setFinishedAttempt(attempt);
      // A CORRECT solve does NOT auto-advance: the user may still press HARD
      // (lucky guess), which sends the puzzle back into the mistake deck at rung 0.
      if (!correct) {
        // WRONG move or TIMEOUT. Record the attempt AT ONCE so the rating and the
        // mistake deck update, but do NOT yank the board away — play the rest of
        // the line onto the board so it can be stepped through with ◀ ▶, and let
        // the user leave via "Next puzzle". This also fixes the timer bug: a
        // timeout used to auto-exit the board mid-puzzle.
        recordOnce(attempt);
        playOutRemaining();
      }
    },
    [puzzle.id, moveIndex, solutionMoves, hintUsed, showSolution, userRating, recordOnce, playOutRemaining]
  );

  // HARD === WRONG. The user is not solid on this puzzle: record a 'hard'
  // attempt and drop the puzzle straight back to rung 0 (today's deck / the
  // mistakes deck) even though they solved it. Shared by BOTH the Training and
  // Mistakes boards, which render this same component.
  const handleHard = useCallback(() => {
    clearTimers();
    const attempt: PuzzleAttempt = {
      puzzleId: puzzle.id,
      userId: "",
      result: "hard",
      userMove: finishedAttempt?.userMove,
      expectedMove: finishedAttempt?.expectedMove ?? solutionMoves[moveIndex],
      moveNumber: finishedAttempt?.moveNumber ?? moveIndex,
      timeSpent: Date.now() - startTimeRef.current,
      hintUsed,
      solutionViewed: showSolution,
      ratingBefore: userRating,
      // HARD is a LOSS; the store's Glicko engine computes the real change.
      ratingAfter: userRating,
      // Same reason as the solve path: the store's index has no entry for a
      // server-dispensed puzzle, so the metadata must ride on the attempt.
      puzzleRating: puzzle.rating,
      puzzleDeviation: (puzzle as unknown as { ratingDeviation?: number | null }).ratingDeviation ?? null,
      themes: puzzle.themes,
      openings: puzzle.openings ?? [],
      timestamp: new Date(),
    };
    setStatus("wrong");
    setFeedback("Marked HARD — back into today's deck.");
    playSound("hard");
    // HARD is a deliberate "I'm done with this one" -> record and move on.
    recordOnce(attempt);
    const t = setTimeout(() => {
      if (onAdvance) onAdvance();
      else onClose();
    }, 300);
    timersRef.current.push(t);
  }, [puzzle.id, finishedAttempt, solutionMoves, moveIndex, hintUsed, showSolution, userRating, recordOnce, onAdvance, onClose]);

  // Commit a finished (correct) solve, or fall back to closing the board.
  // Records at most once (a losing outcome already recorded itself on the spot)
  // and then navigates — the ONLY path that moves off a puzzle.
  const handleNext = useCallback(() => {
    clearTimers();
    if (finishedAttempt) recordOnce(finishedAttempt);
    if (onAdvance) onAdvance();
    else onClose();
  }, [finishedAttempt, recordOnce, onAdvance, onClose]);

  // ---- Mid-puzzle guard ----------------------------------------------------
  // "Next puzzle" used to be visible and live from the first move, and clicking
  // it mid-puzzle silently abandoned the attempt (handleNext -> onClose with no
  // record). Mid-puzzle it is now a two-tap SKIP: the first tap arms it, the
  // second within SKIP_CONFIRM_MS actually skips. Once solved, "Next puzzle"
  // commits immediately because there is nothing left to lose.
  const [skipArmed, setSkipArmed] = useState(false);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarmSkip = useCallback(() => {
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    skipTimerRef.current = null;
    setSkipArmed(false);
  }, []);

  const handleSkip = useCallback(() => {
    if (skipArmed) {
      disarmSkip();
      handleNext();
      return;
    }
    setSkipArmed(true);
    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    skipTimerRef.current = setTimeout(() => setSkipArmed(false), SKIP_CONFIRM_MS);
  }, [skipArmed, disarmSkip, handleNext]);

  // Clear the armed state whenever the puzzle changes.
  useEffect(() => {
    return () => {
      if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    };
  }, [puzzle.id]);

  const handleMove = useCallback(
    (orig: Key, dest: Key) => {
      if (status !== "playing") return;
      // While reviewing an earlier position, a board interaction just snaps the
      // view back to the live position. It must NOT count as a move (and so can
      // never be scored as a mistake).
      if (isScrubbing) {
        setScrubIndex(null);
        return;
      }
      // From here on the user has really engaged with this attempt, so a reload
      // would lose something. Mark it before any legality check: even a rejected
      // drag means they are mid-solve.
      setAttemptTouched(true);
      const expected = solutionMoves[moveIndex];
      if (!expected) return;
      const expFrom = expected.slice(0, 2);
      const expTo = expected.slice(2, 4);
      const expPromo = expected[4];

      // Validate legality on a clone
      const clone = new Chess(gameRef.current.fen());
      let legal = false;
      try {
        const res = clone.move({ from: orig, to: dest, promotion: expPromo || "q" });
        legal = !!res;
      } catch {
        legal = false;
      }
      if (!legal) {
        // snap back
        setView((v) => ({ ...v }));
        return;
      }

      const userUci = orig + dest + (expPromo || "");

      if (orig === expFrom && dest === expTo) {
        // Correct solver move
        gameRef.current = clone;
        setHintSquare(null);
        commitView({ fen: clone.fen(), lastMove: [orig, dest] });

        // Feedback cue: capture beats check beats a plain move.
        {
          const last = clone.history({ verbose: true }).slice(-1)[0] as any;
          if (clone.inCheck()) playSound("check");
          else if (last && (last.captured || last.flags?.includes("e"))) playSound("capture");
          else playSound("move");
        }

        const replyIndex = moveIndex + 1;
        const reply = solutionMoves[replyIndex];
        if (reply) {
          // Auto-play opponent reply
          const g2 = new Chess(clone.fen());
          applyUci(g2, reply);
          if (replyIndex + 1 >= solutionMoves.length) {
            // last move was the opponent's — puzzle solved
            gameRef.current = g2;
            const t = setTimeout(() => {
              commitView({ fen: g2.fen(), lastMove: [reply.slice(0, 2), reply.slice(2, 4)] });
              finish(true, userUci, expected);
            }, 350);
            timersRef.current.push(t);
            setMoveIndex(replyIndex + 1);
          } else {
            gameRef.current = g2;
            const t = setTimeout(() => {
              commitView({ fen: g2.fen(), lastMove: [reply.slice(0, 2), reply.slice(2, 4)] });
            }, 350);
            timersRef.current.push(t);
            setMoveIndex(replyIndex + 1);
          }
        } else {
          // No more moves — solved
          setMoveIndex(replyIndex);
          finish(true, userUci, expected);
        }
      } else {
        // Wrong solver move — flash the correct continuation
        finish(false, userUci, expected);
      }
    },
    [status, solutionMoves, moveIndex, finish]
  );

  const handleHint = useCallback(() => {
    if (status !== "playing" || hintUsed) return;
    const expected = solutionMoves[moveIndex];
    if (!expected) return;
    setHintUsed(true);
    setHintSquare(expected.slice(0, 2));
    const t = setTimeout(() => setHintSquare(null), 2500);
    timersRef.current.push(t);
  }, [status, hintUsed, solutionMoves, moveIndex]);

  // ---- Back / forward review ----------------------------------------------
  // `history` always ends at the live position. Scrubbing only changes which
  // entry is DISPLAYED; gameRef, moveIndex, the ladder and the attempt are all
  // untouched, so reviewing can never score the puzzle as wrong.
  const canGoBack = history.length > 1 && (scrubIndex === null || scrubIndex > 0);
  const canGoForward = scrubIndex !== null && scrubIndex < history.length - 1;
  // The solver plays the odd-indexed plies (0 is the opponent's setup move),
  // so the number of moves YOU have to find is floor(plies / 2).
  const solverTotal = Math.max(1, Math.floor(solutionMoves.length / 2));

  const displayIndex = scrubIndex === null ? history.length - 1 : scrubIndex;
  const displayView = history[displayIndex] ?? view;
  // The counter used to print the raw HISTORY index ("1 / 1" at the start of a
  // 4-move puzzle, because history only held the setup position). It must speak
  // in the solver's own moves: position 1 is the start of solver move 1, position
  // 2 is the same move just played, position 3 starts move 2, and so on.
  const displaySolverMove = Math.min(
    solverTotal,
    Math.max(1, Math.ceil(displayIndex / 2))
  );

  const goBack = useCallback(() => {
    setScrubIndex((cur) => {
      const i = cur === null ? history.length - 1 : cur;
      return i > 0 ? i - 1 : cur;
    });
  }, [history.length]);

  const goForward = useCallback(() => {
    setScrubIndex((cur) => {
      if (cur === null) return null;
      const next = cur + 1;
      return next >= history.length - 1 ? null : next;
    });
  }, [history.length]);

  const goLive = useCallback(() => setScrubIndex(null), []);

  const handleSolution = useCallback(() => {
    setShowSolution(true);
    // Play out the remaining line; every position lands in `history` so the whole
    // solution can be stepped through with ◀ ▶.
    playOutRemaining();
    setStatus("wrong");
    setFeedback("Puzzle failed");
    const attempt: PuzzleAttempt = {
      puzzleId: puzzle.id,
      userId: "",
      result: "solution",
      moveNumber: moveIndex,
      timeSpent: Date.now() - startTimeRef.current,
      hintUsed,
      solutionViewed: true,
      ratingBefore: userRating,
      // Viewing the solution is a LOSS; the store computes the real change.
      ratingAfter: userRating,
      timestamp: new Date(),
    };
    // Recorded now (rating + mistake deck), but the board STAYS so it can be
    // studied — no auto-advance. Leave via "Next puzzle".
    recordOnce(attempt);
  }, [moveIndex, solutionMoves, hintUsed, userRating, recordOnce, playOutRemaining, puzzle.id]);

  // TIMER EXPIRY === WRONG ANSWER. It emits the same 'incorrect' attempt
  // through the SAME onComplete mechanism, so the store drops the puzzle to
  // rung 0, flags it isWrongPuzzle, sends it to the Mistakes deck and scores it
  // as a loss — identical to playing the wrong move.
  const handleTimeout = useCallback(() => {
    if (statusRef.current !== "playing") return; // guard against a double fire
    statusRef.current = "wrong";
    finish(false, undefined, solutionMoves[moveIndex], true);
  }, [finish, solutionMoves, moveIndex]);

  // Tick the countdown down while a puzzle is unsolved; auto-fail on expiry.
  // Runs on BOTH the Training and Mistakes boards (both render this component).
  useEffect(() => {
    if (!timerEnabled || status !== "playing") return;
    if (timeLeft <= 0) {
      handleTimeout();
      return;
    }
    const id = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [timerEnabled, status, timeLeft, handleTimeout]);

  useEffect(() => () => clearTimers(), []);

  const orientation = solverColor;

  // Highlight the king when the side to move is in check (if enabled).
  const check = useMemo<"white" | "black" | undefined>(() => {
    if (!highlightCheck) return undefined;
    try {
      if (!gameRef.current.inCheck()) return undefined;
      return gameRef.current.turn() === "w" ? "white" : "black";
    } catch {
      return undefined;
    }
  }, [view.fen, highlightCheck]);

  // "live" = the SOLVER has engaged with this attempt and it is still open. The
  // sync engine uses this to decide whether a reload would destroy work in
  // progress; a board that is merely mounted (no solver move yet) is safe.
  const attemptLive = status === "playing" && attemptTouched;

  return (
    <div
      className="board-panel"
      data-attempt={attemptLive ? "live" : "idle"}
      data-resolved={status === "playing" ? "false" : "true"}
    >
      {/* Head */}
      <div className="board-panel__head">
        <div className="board-panel__titles">
          {/* What you asked to practise. Prominent, above the board, on every
              page (Training / All themes / Review). */}
          {angleLabel && (
            <div
              className="text-sm font-semibold text-[#629924] dark:text-[#8bbf4a] mb-1"
              data-testid="active-theme"
              data-angle={angleLabel}
            >
              {angleLabel}
            </div>
          )}
          <div className="board-panel__title">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                solverColor === "white" ? "bg-white ring-1 ring-neutral-300" : "bg-neutral-900 ring-1 ring-neutral-600"
              }`}
              aria-hidden
            />
            Puzzle #{puzzle.id}
          </div>
          <div className="board-panel__meta">
            {/* Ratings live in their OWN group and never scroll: "my rating and
                the puzzle's rating, side by side, always visible". Everything
                that can be long (theme chips) goes in the sibling group below,
                so it can wrap without ever pushing these two off-screen. */}
            <span className="board-panel__ratings" data-testid="board-ratings">
              <span className="pill pill-neutral">
                Rating&nbsp;<span className="tabular">{puzzle.rating}</span>
              </span>
              {/* YOUR rating, so it is visible while solving on Training, All themes
                  and Review alike — previously only the puzzle's rating showed, and
                  your own was only on the tab header (which the board replaces). */}
              <span className="pill pill-you" data-testid="user-rating">
                You&nbsp;<span className="tabular">{userRating}</span>
              </span>
              {/* "White to move" is only meaningful while the attempt is open. Once
                  the puzzle resolves it is dead weight in a row that has to fit the
                  theme chips, so it yields its space. */}
              {status === "playing" && (
                <span className="pill pill-accent">
                  {solverColor === "white" ? "White" : "Black"} to move
                </span>
              )}
              {/* ONLY the resolved summary stays here. The live "Move X of Y" pill
                  was removed: the row under the board already prints "1 / 3", so it
                  was duplicated information eating the width the tags needed. */}
              {status !== "playing" && (
                <span className="pill pill-info" data-testid="move-counter">
                  {status === "correct" ? (
                    <>✓ Solved &mdash; {solverTotal} move{solverTotal === 1 ? "" : "s"}</>
                  ) : (
                    <>Solution &mdash; {solverTotal} move{solverTotal === 1 ? "" : "s"}</>
                  )}
                </span>
              )}
            </span>
            {/* TAGS switch. Sits at the right end of the ratings row (margin-left:
                auto pushes it there), so it never costs a row of its own. ON is
                green and reads "TAGS"; OFF is red and reads "OFF". The choice is
                persisted in settings — see onToggleTags. */}
            <button
              type="button"
              className="tag-toggle"
              data-testid="tags-toggle"
              data-on={showTags ? "true" : "false"}
              aria-pressed={showTags}
              aria-label={showTags ? "Hide puzzle tags" : "Show puzzle tags"}
              title={showTags ? "Hide puzzle tags" : "Show puzzle tags"}
              onClick={onToggleTags}
            >
              <span className="tag-toggle__knob" aria-hidden="true" />
              <span className="tag-toggle__label">{showTags ? "TAGS" : "OFF"}</span>
            </button>
            {/* Themes — ALL of them, while solving and after, but only when the
                TAGS switch is on. This is the group that wraps: it takes the full
                width under the ratings and flows left-to-right, so nothing is
                hidden behind a sideways scroll. */}
            {showTags && (
              <span
                className="board-panel__themes"
                data-testid="puzzle-themes"
                data-count={puzzle.themes.length}
              >
                {puzzle.themes.map((t) => (
                  <span key={t} className="pill pill-neutral theme-chip">
                    {t}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="board-panel__side hidden sm:block">
          {solutionMoves.length} move{solutionMoves.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Board stage */}
      {/* data-fen is the position ACTUALLY on screen — the single source of truth
          for tests (a style hash is not: two positions can share one, and a
          mid-animation frame can look unchanged). */}
      <div className="board-stage" data-testid="board-stage" data-fen={displayView.fen}>
        <ChessgroundWrapper
          fen={displayView.fen}
          orientation={orientation}
          lastMove={displayView.lastMove as any}
          check={check as any}
          dests={(isScrubbing ? new Map() : dests) as any}
          pieceSet={pieceSet}
          boardTheme={boardTheme}
          coordinates={coordinates}
          viewOnly={status !== "playing"}
          onMove={handleMove}
          animation={animation}
          pieceAnimation={pieceAnimation}
          highlightLastMove={highlightLastMove}
          highlightCheck={highlightCheck}
          autoCastle={autoCastle}
          autoPromoteToQueen={autoPromoteToQueen}
          blockTouchScroll={blockTouchScroll}
        />
      </div>

      {/* Back / forward review — Lichess-style. Purely visual: stepping through
          the moves never scores the puzzle or touches the ladder. */}
      <div
        className="board-panel__actions"
        data-testid="move-nav"
        style={{ padding: "0.4rem 1.25rem", borderTop: "1px solid var(--border)" }}
      >
        {/* LEFT: Solution — and Next puzzle once the attempt is over, so both are
            reachable without scrolling past the board. */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            data-testid="solution-button"
            onClick={handleSolution}
            disabled={status === "correct"}
            className="btn-ghost"
          >
            Solution
          </button>
          {(status === "correct" || status === "wrong") && (
            <button
              data-testid="next-button"
              onClick={handleNext}
              className="btn-primary"
            >
              Next puzzle
            </button>
          )}
        </div>

        {/* MIDDLE: the countdown, while the puzzle is unsolved.
            It lives in THIS row, not in the header and never as an overlay on the
            board. Two reasons:
              - An overlay sat in the board's corner and covered whichever piece
                stood there — "the puzzle timer is covering the rook".
              - An extra pill in the HEADER wrapped the meta onto another line on
                a phone, and the board is height-limited, so that cost it ~26px
                (§88).
            This row is nearly empty while PLAYING (just Solution on the left), so
            the clock is free here. It is hidden once the puzzle resolves, which is
            exactly when the row fills up with Next. */}
        {timerEnabled && status === "playing" && (
          <span
            className={`pill board-timer flex-shrink-0${timeLeft <= 10 ? " warning" : ""}`}
            data-testid="puzzle-timer"
            data-time-left={timeLeft}
            aria-live="polite"
          >
            ⏱ {formatClock(timeLeft)}
          </span>
        )}

        {/* RIGHT: move stepping + position counter. flex-shrink-0 so the left
            group (Solution / Next) yields space before this one — the alternative
            was the counter collapsing onto three stacked lines. */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            data-testid="move-back"
            onClick={goBack}
            disabled={!canGoBack}
            aria-label="Previous move"
            className={
              "px-3 py-1.5 rounded-lg border text-sm transition-colors " +
              (canGoBack
                ? "border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-white/15 dark:text-[#e5e0d8] dark:hover:bg-white/10"
                : "border-gray-200 text-gray-300 dark:border-white/5 dark:text-white/20 cursor-not-allowed")
            }
          >
            ◀
          </button>
          <button
            data-testid="move-forward"
            onClick={goForward}
            disabled={!canGoForward}
            aria-label="Next move"
            className={
              "px-3 py-1.5 rounded-lg border text-sm transition-colors " +
              (canGoForward
                ? "border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-white/15 dark:text-[#e5e0d8] dark:hover:bg-white/10"
                : "border-gray-200 text-gray-300 dark:border-white/5 dark:text-white/20 cursor-not-allowed")
            }
          >
            ▶
          </button>
          {/* The counter doubles as "back to the live position" while reviewing.
              It REPLACES the old orange "Back to position" button, which was one
              control too many: the row overflowed at phone width, "Next puzzle"
              painted OVER the ▶ button, and the counter wrapped onto three lines.
              Tapping the counter costs no width and is inert when not reviewing. */}
          <button
            type="button"
            onClick={goLive}
            disabled={!isScrubbing}
            title={isScrubbing ? "Back to the current position" : undefined}
            data-testid="move-nav-position"
            data-live={isScrubbing ? "false" : "true"}
            className={
              "text-xs tabular-nums ml-1 whitespace-nowrap bg-transparent border-0 p-0 " +
              (isScrubbing
                ? "text-[#d59020] font-semibold hover:underline"
                : "text-gray-500 dark:text-[#8b8987]")
            }
          >
            {displaySolverMove} / {solverTotal}
          </button>
        </div>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div className={`board-feedback ${status === "correct" ? "correct" : "wrong"}`}>
          {feedback}
        </div>
      )}

      {/* NOTE: a second "Solved — or mark it Hard…" action bar used to live here,
          with its own Hard + Next buttons. That duplicated the primary column in
          the foot below, so the board rendered FOUR buttons where there should be
          two. Its message now rides on the feedback line instead (see finish()),
          so the "you can still mark it Hard" hint is not lost. */}

      {/* Foot / controls */}
      <div className="board-panel__foot">
        {/* Session progress chips.
            Narrow screens: their OWN full-width row above the buttons. In the
            middle of the action row there is no room, so the strip sat at a
            different height from the buttons beside it and read as covering
            "Skip puzzle".
            Wide screens: inside the action row instead (see below), because an
            extra row here would shrink the board — it is height-limited, and the
            measurement was 518px inline vs 469px on its own row. */}
        {!isWide && sessionEntries && sessionEntries.length > 0 && onReplayAt && (
          <SessionStrip
            entries={sessionEntries}
            activeIndex={sessionActiveIndex ?? null}
            themeLabel={sessionThemeLabel ?? null}
            onReplayAt={onReplayAt}
          />
        )}

        <div className="board-panel__actions">
          {/* Solution and Next puzzle moved up into the move-nav bar so they are
              visible without scrolling. Only Hard stays down here. */}

          {/* Session progress chips live in their OWN row above (see the foot),
              not squeezed into this row. In the middle of the action row they sat
              at a different height from the buttons beside them, so the card read
              as covering "Skip puzzle" — and on a narrower phone they would
              genuinely overlap. */}

          {/* Wide screens only: the strip shares this row, which costs no vertical
              space and therefore keeps the board at full size. */}
          {isWide && sessionEntries && sessionEntries.length > 0 && onReplayAt && (
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <SessionStrip
                entries={sessionEntries}
                activeIndex={sessionActiveIndex ?? null}
                themeLabel={sessionThemeLabel ?? null}
                onReplayAt={onReplayAt}
              />
            </div>
          )}

          {/* Primary column: the button you press most often is on TOP, with Hard
              directly beneath it — both full-width, so they are easy to hit with
              a thumb on a phone. Order requested: Next above, Hard below. */}
          <div className="board-actions__primary">
            {/* Next puzzle now lives in the move-nav bar above. Skip only makes
                sense mid-attempt; Hard stays here (may need a scroll). */}
            {status === "playing" && (
              <button
                onClick={handleSkip}
                className={skipArmed ? "btn-primary" : "btn-ghost"}
                data-testid="skip-button"
                data-skip-armed={skipArmed ? "true" : "false"}
                title="Abandons this puzzle without recording it."
              >
                {/* Short labels on a phone: the strip shares this row and every
                    px "Skip puzzle" takes comes off the strip's label, which was
                    ellipsising the position ("Fork · Puzz…") — losing the one
                    thing the strip exists to show. "Tap again to skip ↷" is even
                    longer, so it would also make the row width jump on arming. */}
                {skipArmed ? (isWide ? "Tap again to skip ↷" : "Tap again ↷") : isWide ? "Skip puzzle" : "Skip"}
              </button>
            )}
            <button
              onClick={handleHard}
              disabled={status === "wrong"}
              className="btn-ghost"
              data-testid="hard-button"
              title="Not solid / lucky guess? Same as a wrong answer — sends this puzzle back into the mistakes deck."
            >
              😅 Hard
            </button>
          </div>
        </div>

        {/* Progress */}
        {!showSolution && (
          <div className="board-panel__progress">
            {solutionMoves.map((_, i) => (
              <span key={i} className={i < moveIndex ? "done" : i === moveIndex ? "active" : ""} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PuzzleBoard;
