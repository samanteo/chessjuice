"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ChessgroundWrapper } from "@/components/chessground/ChessgroundWrapper";
import { QueueViews } from "@/components/QueueViews";
import { ThemeFilter } from "@/components/ThemeFilter";
import { ThemeSelector } from "@/components/theme/ThemeSelector";
import { ThemeProvider, useTheme } from "@/components/theme/ThemeProvider";
import { PUZZLE_TIMER_OPTIONS } from "@/components/theme/themeConfig";
import { usePuzzleStore, getBaseOpening } from "@/hooks/usePuzzleStore";
import { usePinnedThemes } from "@/hooks/usePinnedThemes";
import {
  useQuickRunBlock,
  quickRunPosition,
  quickRunTotal,
  sanitizeQuickStartCount,
  type QuickRun,
} from "@/hooks/useQuickRunBlock";
import { PuzzleBoard } from "@/components/PuzzleBoard";
import { RatingProgressChart } from "@/components/dashboard/RatingProgressChart";
import { CalendarHeatmap } from "@/components/dashboard/CalendarHeatmap";
import { ThemeMastery } from "@/components/dashboard/ThemeMastery";
import AnalyticsPage from "@/components/dashboard/AnalyticsPage";
import { PinnedThemes } from "@/components/training/PinnedThemes";
import { ThemePicker } from "@/components/training/ThemePicker";
import {
  THEME_CATEGORIES,
  FLAT_THEME_CARDS,
  DIFFICULTY_LEVELS,
  fmtCount,
  getThemeIcon,
  getOpeningMeta,
} from "@/components/training/themeCatalogue";
import { UserPuzzle, QueueType, LichessTheme, PuzzleAttempt } from "@/types";
import { getQueueType, SM2State } from "@/lib/sm2";
import { selectPuzzle } from "@/lib/dispensing";
import { puzzleThemeGroup, GROUP_BY_THEME_KEY } from "@/lib/themeGroups";
import { dispenseFromDb } from "@/lib/dispenseClient";
import {
  playSound,
  setSoundEnabled,
  isSoundEnabled,
  setSoundVolume,
  getSoundVolume,
} from "@/lib/sound";

// Exactly 5 tabs, in this order.
const TABS = [
  { id: "training", label: "Training", icon: "🎯" },
  { id: "mistakes", label: "Review", icon: "📚" },
  { id: "dashboard", label: "Analytics", icon: "📊" },
  { id: "allthemes", label: "All themes", icon: "🗂️" },
  { id: "appearance", label: "Settings", icon: "⚙️" },
] as const;

type TabId = typeof TABS[number]["id"];

/**
 * Human label for a theme / opening key.
 * `sicilianDefense` -> "Sicilian Defense"; falls back to the raw key.
 */
// Bound on the previous-puzzle history the session strip walks. It used to be
// 30 RENDERED squares; the squares are gone, so the bound lives here instead and
// is the user's own number ("i think previously was 30. maybe 100max?").
const MAX_SESSION_ENTRIES = 100;

function themeLabel(id: string | null | undefined): string {
  if (!id) return "Mixed";
  const meta = FLAT_THEME_CARDS[id];
  if (meta?.label) return meta.label;
  return id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function PuzzleDashboardPage() {
  return (
    <ThemeProvider>
      <PuzzleDashboardPageInner />
    </ThemeProvider>
  );
}

export default PuzzleDashboardPage;

function PuzzleDashboardPageInner() {
  const {
    puzzles,
    settings,
    attempts,
    themeAggregates,
    isLoading,
    userId,
    getPuzzlesByQueue,
    getQueueCounts,
    getDueCount,
    getWrongPuzzlesCount,
    getThemeCounts,
    getOpeningCounts,
    recordAttempt,
    addPuzzles,
    removePuzzle,
    restorePuzzle,
    updateSettings,
  } = usePuzzleStore();

  const theme = useTheme();
  const [activeTab, setActiveTab] = useState<TabId>("training");
  const [activeQueue, setActiveQueue] = useState<QueueType>("due");
  // Shown when a due-review run runs OUT of due mistakes. Without this the queue
  // emptied silently: the finished puzzle stayed on the board and "Next puzzle"
  // did nothing, so the last puzzle looked un-completable.
  const [reviewComplete, setReviewComplete] = useState(false);
  const [selectedPuzzle, setSelectedPuzzle] = useState<UserPuzzle | null>(null);
  // Which tab a puzzle was started from — the board renders in that tab only.
  const [boardContext, setBoardContext] = useState<"training" | "review" | "allthemes">("review");
  const [selectedThemes, setSelectedThemes] = useState<LichessTheme[]>([]);
  const [showWrongPuzzles, setShowWrongPuzzles] = useState(false);
  /**
   * "Group by theme" lives HERE, not in QueueViews, for two reasons:
   *  1. Selecting a puzzle unmounts QueueViews (the board replaces the queue),
   *     so a local useState forgot the setting on every single puzzle.
   *  2. The board's "Next puzzle" needs it: grouped review must keep serving the
   *     SAME motif until that group is exhausted. Only the page sees both.
   * Persisted so it survives a reload / device switch.
   */
  const [groupByTheme, setGroupByTheme] = useState(false);
  useEffect(() => {
    try {
      setGroupByTheme(localStorage.getItem(GROUP_BY_THEME_KEY) === "1");
    } catch {
      /* private mode / storage blocked — default off */
    }
  }, []);
  const toggleGroupByTheme = useCallback((next: boolean) => {
    setGroupByTheme(next);
    try {
      localStorage.setItem(GROUP_BY_THEME_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);
  const [showSettings, setShowSettings] = useState(false);

  // All-themes browser state (shared with the parent so the board's "next"
  // handler can reuse the current difficulty).
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [expandedCategories, setExpandedCategories] = useState<string[]>(["Phases", "Motifs", "Mates"]);
  const [difficulty, setDifficulty] = useState<string>("normal");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);

  // ---- Session strip (Lichess "progress chips") ---------------------------
  // One entry per puzzle served in the CURRENT THEME BATCH of this sitting.
  // Keyed by theme so a theme switch (which is what a Quick start run does when
  // it moves on) restarts the strip, per the user's spec.
  const [sessionLog, setSessionLog] = useState<{
    theme: string | null;
    entries: { id: string; result?: string; rating?: number }[];
  }>({ theme: null, entries: [] });
  // Which entry of the strip is on the board (−1 = follow the newest).
  const [sessionActive, setSessionActive] = useState<number>(-1);

  /**
   * Note a newly served puzzle in the session strip. Resets the batch when the
   * theme changes; otherwise appends.
   */
  const noteServed = useCallback((themeId: string | null, puzzleId: string, rating?: number) => {
    setSessionLog((s) => {
      const sameTheme = s.theme === themeId;
      const entries = sameTheme ? s.entries : [];
      if (entries.some((e) => e.id === puzzleId)) {
        return { theme: themeId, entries };
      }
      const appended = [...entries, { id: puzzleId, rating }];
      return {
        theme: themeId,
        entries:
          appended.length > MAX_SESSION_ENTRIES
            ? appended.slice(appended.length - MAX_SESSION_ENTRIES)
            : appended,
      };
    });
    setSessionActive(-1);
  }, []);

  // Pinned ("quick pin") themes — persisted to localStorage.
  const { pinned, pin, pinMany, unpin, unpinId, toggle, clear: unpinAll, reorder } = usePinnedThemes();
  const [showPicker, setShowPicker] = useState(false);

  // Apply theme filter from settings
  useEffect(() => {
    if (settings?.themesFilter) {
      setSelectedThemes(settings.themesFilter);
    }
  }, [settings?.themesFilter]);

  // Handle puzzle completion — declared AFTER dispenseThemed / advanceQuickRun
  // (see below) because it drives the Quick start run and must not hit the
  // temporal dead zone of those consts.
  const handlePuzzleCompleteRef = useRef<((a: PuzzleAttempt) => void) | null>(null);
  const handlePuzzleComplete = useCallback((attempt: PuzzleAttempt) => {
    handlePuzzleCompleteRef.current?.(attempt);
  }, []);

  // Get hint - returns first move piece info
  const handleHint = useCallback((): { piece: string; square: string; cost: number } => {
    if (!selectedPuzzle) return { piece: "", square: "", cost: 5 };

    const moves = selectedPuzzle.moves.split(" ").filter(Boolean);
    const currentMove = moves[0];
    if (!currentMove) return { piece: "", square: "", cost: 5 };

    const fromSquare = currentMove.slice(0, 2);
    return {
      piece: "Piece",
      square: fromSquare,
      cost: 5,
    };
  }, [selectedPuzzle]);

  // Get solution - returns all moves
  const handleSolution = useCallback((): string[] => {
    if (!selectedPuzzle) return [];
    return selectedPuzzle.moves.split(" ").filter(Boolean);
  }, [selectedPuzzle]);

  // Queue counts
  const queueCounts = getQueueCounts();
  const dueCount = getDueCount();
  const wrongPuzzlesCount = getWrongPuzzlesCount();
  const themeCounts = getThemeCounts();
  const openingCounts = getOpeningCounts();

  // Filter puzzles based on selected themes and wrong puzzles toggle
  const filteredPuzzles = useMemo(() => {
    let result = puzzles;

    if (showWrongPuzzles) {
      result = result.filter(p => (p as any).isWrongPuzzle && !(p as any).removedAt);
    } else if (selectedThemes.length > 0) {
      result = result.filter(p =>
        p.themes.some(t => selectedThemes.includes(t))
      );
    }

    return result;
  }, [puzzles, selectedThemes, showWrongPuzzles]);

  // Weighted pick by rating proximity to the target band.
  // (Superseded by the Lichess-faithful `selectPuzzle` in src/lib/dispensing.ts,
  // which uses a hard flex band + tier fallback instead of a soft weight curve.)

  // Recently-served puzzle ids — the equivalent of Lichess's `previousPaths`
  // exclusion, so the same puzzle is not handed out twice in a row.
  const recentlyServed = useRef(new Set<string>());

  // Dispense a puzzle and render it in the given tab context.
  //  - 'training' → stays in the Training tab (theme cards / random).
  //  - 'review'   → stays in the Mistakes tab (queue selection).
  // ---- Quick start run -----------------------------------------------------
  // Walks the user's PINNED themes in order, serving `count` puzzles from each
  // before moving on to the next. `done` counts puzzles finished in the CURRENT
  // block. A run ends when every pinned theme has been through.
  //
  // The run is driven from handlePuzzleComplete, so it advances only on a real
  // scored outcome — never on a back/forward review.
  //
  // `quickRun` is the block running RIGHT NOW; `savedQuickRun` is the durable
  // copy mirrored from `puzzle_trainer_quickrun`, which is what makes a run
  // resumable after a tab close. `persistQuickRun` writes both.
  const {
    quickRun,
    setQuickRun,
    saved: savedQuickRun,
    persist: persistQuickRun,
  } = useQuickRunBlock();

  /** The theme label currently on the board (for the header). */
  const [activeTheme, setActiveTheme] = useState<string | null>(null);

  // Sound preferences live in the sound module's own localStorage key; mirror
  // them into state so the Settings tab can render and toggle them.
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled());
  const [soundVolume, setSoundVolumeState] = useState<number>(() => getSoundVolume());

  // ---- Settings ▸ Training Block size (Item 6) ----------------------------
  // The stored value is validated on READ and clamped 1–100, so a nonsense
  // value (a harness-seeded 6, a 0, a 999) can never render a nonsense block
  // size. The text box keeps a draft while typing and only commits on blur/Enter.
  const savedQuickStartCount = sanitizeQuickStartCount(settings?.quickStartCount);
  const [quickStartCountDraft, setQuickStartCountDraft] = useState<string>(() =>
    String(savedQuickStartCount)
  );
  // Mirror the stored value into the box when it changes from elsewhere.
  useEffect(() => {
    setQuickStartCountDraft(String(savedQuickStartCount));
  }, [savedQuickStartCount]);
  const commitQuickStartCount = useCallback(() => {
    const n = sanitizeQuickStartCount(quickStartCountDraft);
    updateSettings({ quickStartCount: n });
    setQuickStartCountDraft(String(n));
  }, [quickStartCountDraft, updateSettings]);

  const dispenseThemed = useCallback(
    async (
      themes: LichessTheme[],
      difficultyId: string,
      context: "training" | "review" | "allthemes",
      /**
       * REVIEW ONLY. When "Group by theme" is on, keep serving the same motif
       * until that group runs out, so a review session works one pattern at a
       * time instead of jumping between themes on every puzzle.
       */
      groupKey?: string | null,
    ) => {
      // ---- 1. Server-side 6.19M catalogue (TRAINING only) --------------------
      // Review is deliberately excluded: it must serve the user's own DUE
      // MISTAKES, whose ladder state lives in localStorage progress and has
      // nothing to do with the puzzle database.
      if (context !== "review") {
        // A pinned id may be a THEME or an OPENING. They are different dimensions
        // in the catalogue, so they must go to /api/dispense on different params —
        // sending an opening id as `theme` simply matches nothing and the puzzle
        // silently fails to dispense.
        const single = themes.length === 1 ? (themes[0] as string) : null;
        const isThemeId = single ? !!FLAT_THEME_CARDS[single] : false;
        const dbHit = await dispenseFromDb({
          rating: settings?.rating || 1000,
          difficulty: difficultyId,
          theme: isThemeId ? single : null,
          opening: single && !isThemeId ? single : null,
          exclude: recentlyServed.current,
        });
        if (dbHit?.puzzle) {
          const p = dbHit.puzzle;
          recentlyServed.current.add(p.id);
          setSelectedThemes(themes);
          setShowWrongPuzzles(false);
          // Show what is being practised, above the board.
          setActiveTheme(single);
          // Session strip: only Training has a running batch to page back through.
          if (context === "training") noteServed(single, p.id, p.rating);
          setSelectedPuzzle({
            id: p.id,
            fen: p.fen,
            moves: p.moves,
            rating: p.rating,
            ratingDeviation: p.ratingDeviation,
            popularity: p.popularity,
            themes: p.themes,
            openings: p.openings,
          } as any);
          setBoardContext(context);
          setActiveTab(context);
          return;
        }
        // DB missing (503) → fall through to the in-memory CSV pool below.
      }

      let pool = (puzzles as any[]).filter((p) => !p.removedAt);

      // REVIEW must always serve the next DUE MISTAKE — never a random puzzle
      // from the whole catalogue.
      if (context === "review") {
        pool = pool.filter((p) => getQueueType(p as unknown as SM2State) === "due");
        // Rung 0 is ALWAYS 'due' (that is the "today's deck" rule in sm2.ts), so a
        // puzzle you got wrong stays due indefinitely — the queue would never
        // empty on its own. Within ONE sitting we must not serve the same mistake
        // twice, so drop whatever we have already shown. Once the last due puzzle
        // has been served this leaves an empty pool, which is what ENDS the run
        // (see the guard below) instead of re-serving the same puzzle forever —
        // the "due count stuck at 1, Next puzzle does nothing" bug.
        pool = pool.filter((p) => !recentlyServed.current.has(p.id));

        // Grouped review: stay inside the current motif group. Only when that
        // group is exhausted do we fall back to the whole due pool — a review
        // run must always be able to finish, so this is a PREFERENCE, not a
        // hard filter. (Hard filtering is how the "Next puzzle does nothing"
        // bug happened: an empty pool silently ended the run.)
        if (groupKey) {
          const sameGroup = pool.filter((p) => puzzleThemeGroup(p) === groupKey);
          if (sameGroup.length > 0) pool = sameGroup;
        }
      }

      if (themes.length > 0) {
        pool = pool.filter((p) => p.themes.some((t: string) => themes.includes(t as LichessTheme)));
      }

      // ---- Review reaching the END of the due queue --------------------------
      // Review must NEVER fall back to the whole catalogue (that served a random
      // NON-due puzzle). Worse, the shared fallback below could leave `chosen`
      // undefined, and `if (!chosen) return` then returned SILENTLY: the finished
      // puzzle stayed on the board and "Next puzzle" did nothing at all, so the
      // last due puzzle looked impossible to finish. Clear the board and show a
      // completion state instead.
      if (context === "review" && pool.length === 0) {
        setSelectedPuzzle(null);
        setActiveTheme(null);
        setReviewComplete(true);
        return;
      }

      if (pool.length === 0) pool = (puzzles as any[]).filter((p) => !p.removedAt);

      // Training dispenses NEW puzzles first; fall back only when exhausted.
      // Review has no "new" concept — it is entirely due mistakes.
      const unseen = context === "training" ? pool.filter((p) => (p.attempts ?? 0) === 0) : [];
      const matching = unseen.length > 0 ? unseen : pool;

      // Lichess-faithful selection (see src/lib/dispensing.ts).
      const { puzzle: chosen } = selectPuzzle(matching, {
        userRating: settings?.rating || 1000,
        difficultyId,
        exclude: recentlyServed.current,
      });
      if (!chosen) {
        // Review: everything still in the pool is already in `recentlyServed`, so
        // this sitting is over. Clear the board rather than leaving a dead one up.
        if (context === "review") {
          setSelectedPuzzle(null);
          setActiveTheme(null);
          setReviewComplete(true);
        }
        return;
      }
      recentlyServed.current.add(chosen.id);
      setReviewComplete(false);

      setSelectedThemes(themes);
      setShowWrongPuzzles(false);
      setActiveTheme(themes.length === 1 ? (themes[0] as string) : null);
      setSelectedPuzzle(chosen);
      setBoardContext(context);
      setActiveTab(context === "review" ? "mistakes" : context);
      if (context === "review") setActiveQueue("due");
      // Keep the previous-puzzle pager fed for BOTH Training and Review, so the
      // ◀ ▶ works on either board (Review previously had no pager at all).
      // Review has no chosen theme, so its batch key is null.
      noteServed(
        context === "review" ? null : themes.length === 1 ? (themes[0] as string) : null,
        chosen.id,
        (chosen as { rating?: number }).rating,
      );
    },
    [puzzles, settings, noteServed]
  );

  // Dispense a puzzle from a specific OPENING family. Mirrors dispenseThemed
  // but filters the in-memory catalogue by BASE opening (derived from the
  // `openings` tags) instead of by theme. NEW puzzles first, fall back when
  // exhausted. Renders the board INSIDE the Training tab.
  const dispenseOpening = useCallback(
    async (openingId: string, difficultyId: string, context: "training" | "review" | "allthemes" = "training") => {
      // ---- 1. Server-side 6.19M catalogue -----------------------------------
      // This MUST hit the server DB. The in-memory `puzzles` array only holds the
      // user's OWN puzzles now that the CSV is gone, so the old local filter
      // `puzzles.filter(p => getBaseOpening(p.openings) === openingId)` matched
      // nothing for almost every opening and the function returned silently:
      // no board, no sound, no request. Openings with a non-empty local pool
      // (the user had attempted one) still worked — hence "some work, some don't".
      const dbHit = await dispenseFromDb({
        rating: settings?.rating || 1000,
        difficulty: difficultyId,
        opening: openingId,
        exclude: recentlyServed.current,
      });
      if (dbHit?.puzzle) {
        const p = dbHit.puzzle;
        recentlyServed.current.add(p.id);
        setSelectedThemes([]);
        setShowWrongPuzzles(false);
        setActiveTheme(openingId);
        setSelectedPuzzle({
          id: p.id,
          fen: p.fen,
          moves: p.moves,
          rating: p.rating,
          ratingDeviation: p.ratingDeviation,
          popularity: p.popularity,
          themes: p.themes,
          openings: p.openings,
        } as any);
        // Feeding the pager here too: an OPENING-dispensed puzzle previously never
        // entered the batch, so the ◀ ▶ could not walk back over it.
        noteServed(context === "review" ? null : openingId, p.id, p.rating);
        setBoardContext(context);
        setActiveTab(context === "review" ? "mistakes" : context);
        if (context === "review") setActiveQueue("due");
        return;
      }

      // ---- 2. Fallback: the user's own local pool ---------------------------
      const pool = (puzzles as any[]).filter(
        (p) => !p.removedAt && getBaseOpening(p.openings) === openingId
      );
      if (pool.length === 0) return; // nothing anywhere — leave the board alone

      // NEW puzzles first; fall back to the whole (already-attempted) pool.
      const unseen = pool.filter((p) => (p.attempts ?? 0) === 0);
      const matching = unseen.length > 0 ? unseen : pool;

      // Lichess-faithful selection (see src/lib/dispensing.ts).
      const { puzzle: chosen } = selectPuzzle(matching, {
        userRating: settings?.rating || 1000,
        difficultyId,
        exclude: recentlyServed.current,
      });
      if (!chosen) return;
      recentlyServed.current.add(chosen.id);

      // An opening is not a theme: clear any theme filter so a subsequent
      // "next" falls back to a fresh random puzzle rather than a stale theme.
      setSelectedThemes([]);
      setShowWrongPuzzles(false);
      setActiveTheme(openingId);
      setSelectedPuzzle(chosen);
      setBoardContext(context);
      setActiveTab(context === "review" ? "mistakes" : context);
      if (context === "review") setActiveQueue("due");
      noteServed(context === "review" ? null : openingId, chosen.id, (chosen as { rating?: number }).rating);
    },
    [puzzles, settings, noteServed]
  );

  // ---- Quick start run (defined after dispenseThemed so it can call it) ----
  const startQuickRun = useCallback(() => {
    const list: string[] = ((pinned && pinned.length > 0 ? pinned : selectedThemes) || []) as string[];
    if (list.length === 0) return;
    const count = sanitizeQuickStartCount(settings?.quickStartCount);
    const run: QuickRun = { themes: list, themeIndex: 0, done: 0, count, savedAt: Date.now() };
    setQuickRun(run);
    // "Start new" is an explicit choice: it OVERWRITES any saved-but-unfinished
    // block rather than resuming it. (Resuming is the separate Continue action.)
    persistQuickRun(run);
    setActiveTheme(list[0]);
    dispenseThemed([list[0] as LichessTheme], difficulty, "training");
  }, [pinned, selectedThemes, settings?.quickStartCount, difficulty, dispenseThemed, setQuickRun, persistQuickRun]);

  /** Pick up the durable block where the user left off. */
  const resumeQuickRun = useCallback(() => {
    if (!savedQuickRun) return;
    const run = savedQuickRun;
    setQuickRun(run);
    const theme = run.themes[run.themeIndex];
    setActiveTheme(theme ?? null);
    if (theme) dispenseThemed([theme as LichessTheme], difficulty, "training");
  }, [savedQuickRun, setQuickRun, difficulty, dispenseThemed]);

  const stopQuickRun = useCallback(() => {
    // Pause, not abandon: the durable block stays in storage, so the button
    // offers "Continue" instead of losing the user's place. Only finishing the
    // run, or "Start new", clears the saved block.
    setQuickRun(null);
    setActiveTheme(null);
  }, [setQuickRun]);

  /**
   * Advance the run by one finished puzzle. When the current block's quota is
   * met, move to the next pinned theme; when the themes run out, end the run.
   * Returns the theme id to dispense next, or null if the run is over.
   */
  const advanceQuickRun = useCallback((): string | null => {
    if (!quickRun) return null;
    const done = quickRun.done + 1;
    if (done < quickRun.count) {
      const next: QuickRun = { ...quickRun, done, savedAt: Date.now() };
      setQuickRun(next);
      persistQuickRun(next);
      return quickRun.themes[quickRun.themeIndex];
    }
    const nextIndex = quickRun.themeIndex + 1;
    if (nextIndex >= quickRun.themes.length) {
      // Run complete — nothing left to resume.
      setQuickRun(null);
      setActiveTheme(null);
      persistQuickRun(null);
      return null;
    }
    const next: QuickRun = { ...quickRun, themeIndex: nextIndex, done: 0, savedAt: Date.now() };
    setQuickRun(next);
    persistQuickRun(next);
    setActiveTheme(quickRun.themes[nextIndex]);
    return quickRun.themes[nextIndex];
  }, [quickRun, setQuickRun, persistQuickRun]);

  // The real completion handler, assigned into the ref declared above so the
  // board's callback stays stable while this still sees the latest run state.
  useEffect(() => {
    handlePuzzleCompleteRef.current = (attempt: PuzzleAttempt) => {
      const fullAttempt: PuzzleAttempt = { ...attempt, userId };
      // Register the puzzle first. A puzzle dispensed from the 6.19M server
      // catalogue is not in the hydrated local set, so without this the store
      // has no entry to update and no metadata to score against — the attempt
      // would be saved but the SM-2 progress and the Glicko rating skipped.
      if (selectedPuzzle) addPuzzles([selectedPuzzle]);
      recordAttempt(fullAttempt);

      // Colour the session square for this puzzle.
      setSessionLog((s) => ({
        theme: s.theme,
        entries: s.entries.map((e) =>
          e.id === fullAttempt.puzzleId ? { ...e, result: fullAttempt.result } : e
        ),
      }));

      // DO NOT clear the board and DO NOT advance the run here.
      //
      // Recording an outcome used to also `setSelectedPuzzle(null)` and dispense
      // the next run puzzle, which meant a wrong move / timeout / revealed
      // solution yanked the board away before it could be studied. Recording and
      // NAVIGATING are now separate: the board stays showing the played-out
      // solution, and `handleBoardNext` (driven by the "Next puzzle" button) is
      // the only thing that moves on. This also stops a Quick start run from
      // burning through puzzles on a failed one.
    };
  }, [userId, selectedPuzzle, addPuzzles, recordAttempt]);

  // ---- Replay queue (Analytics → history panels) --------------------------
  // Replaying is PURE PRACTICE: attempts made while a replay queue is active
  // must not touch the SM-2 ladder or the Glicko rating, and are not recorded
  // as history (that would double-count plays in the dashboard).
  const replayQueue = useRef<string[]>([]);
  const replayPos = useRef(0);
  const practiceRef = useRef(false);

  /** Resolve a puzzle for the board: local pool first, then the server DB. */
  const loadPuzzleById = useCallback(
    async (id: string) => {
      const local = (puzzles as any[]).find((p) => p.id === id);
      if (local) return local;
      try {
        const res = await fetch(`/api/puzzle?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) return null;
        const p = await res.json();
        return p?.id ? p : null;
      } catch {
        return null;
      }
    },
    [puzzles]
  );

  /** Serve position `pos` of the active replay queue, skipping missing puzzles. */
  const serveReplay = useCallback(
    async (pos: number) => {
      const queue = replayQueue.current;
      for (let i = pos; i < queue.length; i++) {
        const p = await loadPuzzleById(queue[i]);
        if (!p) continue;
        replayPos.current = i;
        setSelectedThemes([]);
        setShowWrongPuzzles(false);
        setSelectedPuzzle(p);
        setBoardContext("training");
        setActiveTab("training");
        return;
      }
      // Queue exhausted — leave practice mode.
      replayQueue.current = [];
      replayPos.current = 0;
      practiceRef.current = false;
    },
    [loadPuzzleById]
  );

  /** Entry point from the Analytics history panels. */
  const startReplay = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      replayQueue.current = ids;
      replayPos.current = 0;
      practiceRef.current = true;
      void serveReplay(0);
    },
    [serveReplay]
  );

  /**
   * Reopen a puzzle from the session strip. Replay-only — it goes through the
   * same practice queue Analytics uses, so nothing here can touch the rating,
   * the SM-2 ladder, or the attempt history.
   */
  const replaySessionAt = useCallback(
    (index: number) => {
      const entry = sessionLog.entries[index];
      if (!entry) return;
      setSessionActive(index);
      startReplay([entry.id]);
    },
    [sessionLog.entries, startReplay]
  );

  // "Next puzzle" inside PuzzleBoard dispenses within the SAME context.
  // It must ALWAYS load another puzzle — never close the board or bounce the
  // user back to a list. Review keeps serving due mistakes; training keeps
  // serving the current theme. An active REPLAY queue takes priority.
  /**
   * Start a due-review session: switch to Review, select the due queue, and
   * actually SERVE the first due mistake.
   *
   * The "Review Due" buttons used to only run `setActiveQueue("due")`, which
   * filtered a list nobody was looking at — no puzzle ever started, so the
   * button looked dead. The queue filter alone is not an action.
   */
  const startDueReview = useCallback(() => {
    setActiveQueue("due");
    setShowWrongPuzzles(true);
    setActiveTab("mistakes");
    setBoardContext("review");
    setSelectedThemes([]);
    // A fresh run must be able to serve puzzles we already showed in the last
    // sitting, so clear the exclusion set and the "queue cleared" state.
    recentlyServed.current.clear();
    setReviewComplete(false);
    dispenseThemed([], difficulty, "review");
  }, [dispenseThemed, difficulty]);

  /**
   * Leave for a PRISTINE Training tab.
   *
   * This is what "Go to Training" must mean. Previously it only ran
   * `setActiveTab("training")`, but `selectedPuzzle` was still set from whatever
   * had just been reviewed — so Training rendered that leftover puzzle and looked
   * like it had launched a random one. Landing on Training must match a fresh
   * load: no puzzle, no active theme, just the pinned-theme grid.
   */
  const goToTraining = useCallback(() => {
    setSelectedPuzzle(null);
    setActiveTheme(null);
    setBoardContext("training");
    setSessionActive(-1);
    setReviewComplete(false);
    setActiveTab("training");
  }, []);

  const handleBoardNext = useCallback(
    (context: "training" | "review" | "allthemes") => {
      if (practiceRef.current) {
        // Still inside a replay queue (Analytics run) -> walk it.
        const next = replayPos.current + 1;
        if (next < replayQueue.current.length) {
          void serveReplay(next);
          return;
        }
        // Replay queue finished, or we were replaying a single session square.
        // Exit practice mode and fall through to live training.
        replayQueue.current = [];
        replayPos.current = 0;
        practiceRef.current = false;
        setSessionActive(-1);
      }
      // A Quick start run advances HERE — when the user actually leaves a puzzle —
      // not on the outcome. So a failed puzzle stays on the board to be studied
      // and "Next puzzle" is what carries the run forward.
      if (context === "training" && quickRun) {
        const nextTheme = advanceQuickRun();
        if (nextTheme) {
          dispenseThemed([nextTheme as LichessTheme], difficulty, "training");
          return;
        }
        // The run just finished — fall through and serve a plain puzzle.
      }
      // REVIEW + "Group by theme": keep the session inside the motif group the
      // current puzzle belongs to. This is what makes the toggle mean something
      // when you actually PLAY — it used to only regroup the list, and the very
      // next puzzle could be a different theme.
      const reviewGroup =
        context === "review" && groupByTheme && selectedPuzzle
          ? puzzleThemeGroup(selectedPuzzle)
          : null;
      dispenseThemed(context === "review" ? [] : selectedThemes, difficulty, context, reviewGroup);
    },
    [
      dispenseThemed,
      selectedThemes,
      difficulty,
      serveReplay,
      quickRun,
      advanceQuickRun,
      groupByTheme,
      selectedPuzzle,
    ]
  );

  // Shared board render helper — used by the Training, All themes and Mistakes tabs.
  const renderBoardPanel = useCallback(
    (context: "training" | "review" | "allthemes") => {
      if (!selectedPuzzle) return null;
      // What to show above the board:
      //  - Training / All-themes: the theme or opening the user chose.
      //  - Review: there is no "chosen" theme when reviewing a mistake, so fall
      //    back to the puzzle's own angle (opening first, then first theme).
      // NOTE: allthemes must be included here. Omitting it silently discarded
      // the chosen theme and mislabelled the board with the puzzle's own first
      // theme (click Fork -> board says "Advanced pawn").
      const p = selectedPuzzle as unknown as { themes?: string[]; openings?: string[] };
      const choseTheme = context === "training" || context === "allthemes";
      const chosen = choseTheme && activeTheme ? themeLabel(activeTheme) : null;
      const own = (p.openings ?? [])[0] ?? (p.themes ?? [])[0] ?? null;
      const boardAngleLabel = chosen ?? (own ? themeLabel(own) : null);
      return (
        <div
          className="w-full board-frame"
          data-board-context={context}
        >
          <PuzzleBoard
            key={selectedPuzzle.id}
            puzzle={selectedPuzzle}
            userRating={settings?.rating || 1000}
            pieceSet={theme.pieceSet}
            boardTheme={theme.boardTheme}
            coordinates={theme.coordinates}
            angleLabel={boardAngleLabel}
            // TAGS switch in the head. Persisted in settings so the choice
            // survives a reload and syncs phone <-> laptop. Default OFF.
            showTags={settings?.showTags ?? false}
            onToggleTags={() => updateSettings({ showTags: !(settings?.showTags ?? false) })}
            showDots={settings?.showDots ?? true}
            onToggleDots={() => updateSettings({ showDots: !(settings?.showDots ?? true) })}
            onComplete={(attempt) => {
              // Replay = pure practice: no SM-2, no rating, no history entry.
              if (!practiceRef.current) handlePuzzleComplete(attempt);
            }}
            onAdvance={() => handleBoardNext(context)}
            onClose={() => handleBoardNext(context)}
            // Session progress pager renders INSIDE the board's foot — above the
            // Skip/Next column (see PuzzleBoard). Training AND Review keep a
            // running batch; All themes has no run to page back through.
            {...(context !== "allthemes"
              ? {
                  sessionEntries: sessionLog.entries,
                  sessionActiveIndex: sessionActive,
                  // Use the SAME label the board head shows above the puzzle, so
                  // the strip reads "Fork · Puzzle 1/1" in BOTH Training and
                  // Review. It used to be hardcoded to training (`context ===
                  // "training" && activeTheme ? ... : null`), so Review's strip
                  // silently lost the theme name and rendered a bare
                  // "Puzzle 1 / 1" — the only visible difference between the two
                  // boards. `boardAngleLabel` already resolves correctly for
                  // review (the puzzle's own opening, else its first theme).
                  sessionThemeLabel: boardAngleLabel,
                  onReplayAt: replaySessionAt,
                }
              : {})}
          />
        </div>
      );
    },
    [selectedPuzzle, settings, theme, activeTheme, handlePuzzleComplete, handleBoardNext]
  );

  // When a training puzzle is started, bring its board into view.
  // NOTE: there used to be a scrollIntoView() here that pulled the board into
  // view when a training puzzle started. It is gone deliberately. It was needed
  // when the board sat far down a long page, but the layout is board-first now,
  // so all it did was leave the page scrolled down on load (measured: scrollY 136
  // on both phone and desktop) and force the user to scroll back up every time.
  // With the head tightened the whole panel fits without scrolling at all.

  // Activity heatmap data: day (YYYY-MM-DD) -> attempt count, from real attempts.
  const heatmapData = useMemo(() => {
    const out: Record<string, number> = {};
    (attempts as PuzzleAttempt[]).forEach((a) => {
      // Local-time key. `toISOString()` is UTC and shifts the day backwards in
      // UTC+7, so attempts made before 07:00 were bucketed into the prior day.
      const d = new Date(a.timestamp);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`;
      out[date] = (out[date] || 0) + 1;
    });
    return out;
  }, [attempts]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading Puzzle Trainer...</p>
        </div>
      </div>
    );
  }

  // Appearance tab
  // Settings tab (was "Appearance") — theme/appearance PLUS the puzzle-count and
  // sound controls. Renamed because it now holds behaviour, not just looks.
  const renderSettings = () => (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Training Block */}
      <section
        className="bg-white dark:bg-[#262421] rounded-xl p-5 shadow-sm border border-gray-200 dark:border-white/5"
        data-testid="settings-quickstart"
      >
        <h2 className="text-lg font-bold text-gray-900 dark:text-[#e5e0d8] mb-1">Training Block</h2>
        <p className="text-sm text-gray-500 dark:text-[#8b8987] mb-4">
          How many puzzles to serve from EACH pinned theme before moving on to the next.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {[5, 10, 15, 20].map((n) => {
            const on = savedQuickStartCount === n;
            return (
              <button
                key={n}
                data-testid={`quickstart-count-${n}`}
                data-on={on ? "1" : "0"}
                onClick={() => updateSettings({ quickStartCount: n })}
                className={
                  "px-4 py-2 rounded-lg text-sm font-semibold border transition-colors tabular-nums " +
                  (on
                    ? "bg-[#d59020] text-[#1b1a17] border-transparent"
                    : "bg-white dark:bg-white/5 text-gray-700 dark:text-[#e5e0d8] border-gray-300 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10")
                }
              >
                {n}
              </button>
            );
          })}
          {/* Custom size — 1–100, committed on blur or Enter, clamped on save. */}
          <label className="flex items-center gap-2 ml-1 text-sm text-gray-600 dark:text-[#c9c5bd]">
            <span className="sr-only">Custom block size</span>
            <input
              data-testid="quickstart-count-custom"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={quickStartCountDraft}
              onChange={(e) => setQuickStartCountDraft(e.target.value)}
              onBlur={commitQuickStartCount}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="w-20 px-3 py-2 rounded-lg text-sm font-semibold tabular-nums border border-gray-300 dark:border-white/10 bg-white dark:bg-white/5 text-gray-900 dark:text-[#e5e0d8] focus:outline-none focus:ring-2 focus:ring-[#d59020]"
            />
          </label>
        </div>
        <p className="text-xs text-gray-400 dark:text-[#6b6a68] mt-3">
          Currently {savedQuickStartCount} per theme. With {pinned.length} pinned
          theme{pinned.length === 1 ? "" : "s"} a full run is{" "}
          {savedQuickStartCount * Math.max(1, pinned.length)} puzzles.
        </p>
      </section>

      {/* Puzzle time — second item, right after Quick start. This is the
          per-puzzle countdown; when it runs out the puzzle is auto-failed
          exactly like a wrong answer. The control used to live only on the
          Appearance/theme page, so it was hard to find from Settings. */}
      <section
        className="bg-white dark:bg-[#262421] rounded-xl p-5 shadow-sm border border-gray-200 dark:border-white/5"
        data-testid="settings-puzzle-time"
      >
        <h2 className="text-lg font-bold text-gray-900 dark:text-[#e5e0d8] mb-1">Puzzle time</h2>
        <p className="text-sm text-gray-500 dark:text-[#8b8987] mb-4">
          Optional countdown while a puzzle is unsolved. Running out counts as a wrong
          answer — the puzzle drops to today&apos;s deck and into your mistakes.
        </p>
        <div className="flex flex-wrap items-center gap-2" data-testid="settings-puzzle-time-options">
          {PUZZLE_TIMER_OPTIONS.map((opt) => {
            const on = (theme.puzzleTimerSeconds || 0) === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-testid={`settings-puzzle-time-${opt.value}`}
                data-on={on ? "1" : "0"}
                aria-pressed={on}
                onClick={() => theme.setPuzzleTimerSeconds(opt.value)}
                className={
                  "min-w-[4.5rem] px-4 py-2 rounded-lg text-sm font-semibold border transition-colors " +
                  (on
                    ? "bg-[#d59020] text-[#1b1a17] border-transparent"
                    : "bg-white dark:bg-white/5 text-gray-700 dark:text-[#e5e0d8] border-gray-300 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10")
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-400 dark:text-[#6b6a68] mt-3">
          {(theme.puzzleTimerSeconds || 0) === 0
            ? "Off — take as long as you like."
            : `A puzzle auto-fails after ${PUZZLE_TIMER_OPTIONS.find(o => o.value === theme.puzzleTimerSeconds)?.label ?? theme.puzzleTimerSeconds}.`}
        </p>
      </section>

      {/* Sound */}
      <section
        className="bg-white dark:bg-[#262421] rounded-xl p-5 shadow-sm border border-gray-200 dark:border-white/5"
        data-testid="settings-sound"
      >
        <h2 className="text-lg font-bold text-gray-900 dark:text-[#e5e0d8] mb-1">Sound</h2>
        <p className="text-sm text-gray-500 dark:text-[#8b8987] mb-4">
          Move, capture, check, solve and fail cues.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <button
            data-testid="sound-toggle"
            data-on={soundOn ? "1" : "0"}
            onClick={() => {
              const next = !soundOn;
              setSoundEnabled(next);
              setSoundOn(next);
              updateSettings({ soundEnabled: next });
            }}
            className={
              "px-4 py-2 rounded-lg text-sm font-semibold border transition-colors " +
              (soundOn
                ? "bg-[#629924] text-white border-transparent"
                : "bg-white dark:bg-white/5 text-gray-700 dark:text-[#e5e0d8] border-gray-300 dark:border-white/10")
            }
          >
            {soundOn ? "🔊 Sound on" : "🔇 Sound off"}
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-[#8b8987]">
            Volume
            <input
              data-testid="sound-volume"
              type="range"
              min={0}
              max={100}
              value={Math.round(soundVolume * 100)}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                setSoundVolume(v);
                setSoundVolumeState(v);
              }}
              className="w-32"
            />
            <span className="tabular-nums w-8">{Math.round(soundVolume * 100)}</span>
          </label>
        </div>
      </section>

      {/* Appearance */}
      <ThemeSelector />
    </div>
  );

  // Analytics tab — the puzzle dashboard plus the activity heatmap and
  // per-theme mastery cards (moved here from the old Training tab).
  const renderAnalytics = () => (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <AnalyticsPage onReplay={startReplay} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Calendar heatmap */}
        <div
          className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700 min-w-0"
          data-testid="activity-heatmap"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Activity</h3>
            <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
              {(attempts as PuzzleAttempt[]).length} attempts
            </span>
          </div>
          <CalendarHeatmap data={heatmapData} />
        </div>

        {/* Theme mastery — worst first */}
        <div
          className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700"
          data-testid="theme-mastery"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Theme Mastery</h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">worst first</span>
          </div>
          <ThemeMastery attempts={attempts as PuzzleAttempt[]} puzzles={puzzles as UserPuzzle[]} />
        </div>
      </div>
    </div>
  );

  // Mistakes tab (SM-2 queue)
  const renderMistakes = () => {
    const boardUp = !!(selectedPuzzle && boardContext === "review");

    // BOARD-FIRST, exactly like Training.
    // Once a mistake is on the board, the queue sidebar is noise: it took a whole
    // column of width and pushed the controls below the fold (invisible without
    // scrolling, which is what Training gets right). When a board is up, Review
    // renders ONLY the board panel, same as Training does.
    if (boardUp) {
      // EXACTLY the wrapper Training uses. This matters more than it looks: an
      // earlier version used `max-w-3xl`, which is narrower than Training's
      // container, so the head's flex row WRAPPED onto three lines instead of
      // collapsing to one — a 102px head vs Training's 38px, and a board 455px
      // wide vs 518px. Same markup, same result, no per-tab divergence.
      return (
        <div className="mb-4" data-testid="review-board">
          {renderBoardPanel("review")}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar - Queue Views (only while no puzzle is on the board) */}
        <aside className="lg:col-span-1">
          <QueueViews
            puzzles={filteredPuzzles}
            queueCounts={queueCounts}
            activeQueue={activeQueue}
            onQueueChange={setActiveQueue}
            onPuzzleSelect={(puzzle) => {
              setReviewComplete(false);
              setSelectedPuzzle(puzzle);
              setBoardContext("review");
              setActiveTab("mistakes");
            }}
            onRemovePuzzle={removePuzzle}
            onRestorePuzzle={restorePuzzle}
            onThemeFilterChange={setSelectedThemes}
            selectedThemes={selectedThemes}
            themeCounts={themeCounts}
            wrongPuzzlesCount={wrongPuzzlesCount}
            showWrongPuzzles={showWrongPuzzles}
            onWrongPuzzlesToggle={setShowWrongPuzzles}
            userRating={settings?.rating || 1000}
            newPuzzlesPerDay={settings?.newPuzzlesPerDay || 5}
            groupByTheme={groupByTheme}
            onGroupByThemeChange={toggleGroupByTheme}
          />
        </aside>

        {/* Main - prompt, or the "you cleared the due queue" state */}
        <section className="lg:col-span-2">
          {reviewComplete ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-8xl mb-6">🎉</div>
              <h2 className="text-2xl font-semibold mb-2">Review complete</h2>
              <p className="text-lg max-w-md text-gray-500 dark:text-gray-400">
                Nothing is due right now — you cleared the whole due queue.
                Your mistakes stay here until you remove them by hand.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={goToTraining}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  🎯 Go to Training
                </button>
                <button
                  onClick={() => setReviewComplete(false)}
                  className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
                >
                  ↩ Back to the list
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center text-gray-500 dark:text-gray-400">
              <div className="text-8xl mb-6">📚</div>
              <h2 className="text-2xl font-semibold mb-2">No mistake selected</h2>
              <p className="text-lg max-w-md">
                This tab collects the puzzles you got <strong>wrong</strong> while training.
                Pick one from the queue on the left to review it.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={goToTraining}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  🎯 Go to Training
                </button>
                {dueCount > 0 && (
                  <button
                    onClick={startDueReview}
                    className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                  >
                    ⏰ Review Due ({dueCount})
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* h-16 / py-6 below are desktop sizes. On a phone the header is pure
              branding above the board, so it shrinks to h-11 and main's top
              padding drops to 8px — 44px of vertical space that now belongs to
              the board/controls instead of to a title bar. Trimmed only on
              mobile (sm:) so the desktop layout is untouched. */}
          <div className="flex items-center justify-between h-11 sm:h-16">
            <div className="flex items-center gap-4">
              {/* The branding doubles as HOME. Tapping it from ANY tab drops
                  whatever puzzle is on the board and returns to a pristine
                  Training tab (no board, no active theme) — the same path the
                  "Go to Training" action uses. Unmounting the board clears its
                  timers and the half-finished attempt is simply discarded. */}
              <button
                type="button"
                onClick={goToTraining}
                data-testid="home-logo"
                title="Back to Training — ends the current puzzle"
                aria-label="Back to Training — ends the current puzzle"
                className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white rounded-lg hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                ♟️ Puzzle Trainer
              </button>

              {/* Tab Navigation */}
              <nav className="hidden md:flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    data-testid={`tab-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? "bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <span>{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-3">
              {/* Due count badge */}
              {dueCount > 0 && (
                <button
                  onClick={() => {
                    setActiveTab("mistakes");
                    // Rung 0 (today's deck) now lives in "learning", so jump to
                    // whichever bucket actually holds the actionable puzzles.
                    setActiveQueue(queueCounts.learning > 0 ? "learning" : "due");
                  }}
                  className="relative px-3 py-1.5 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                >
                  ⏰ {dueCount} Due
                </button>
              )}

              {/* Settings */}
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                ⚙️
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Tab Navigation — each tab is exactly 1/5 of the width.
            Previously each button carried px-3 + an inline icon + label, which
            measured ~528px in a 390px viewport and pushed the page sideways.
            flex-1 + min-w-0 + truncate makes overflow structurally impossible. */}
        <nav className="md:hidden flex items-stretch bg-gray-100 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-700">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors ${
                activeTab === tab.id
                  ? "bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400"
                  : "text-gray-600 dark:text-gray-300"
              }`}
            >
              <span aria-hidden className="text-base leading-none">{tab.icon}</span>
              <span className="text-[10px] font-medium leading-tight truncate max-w-full px-0.5">
                {tab.label}
              </span>
            </button>
          ))}
        </nav>
      </header>

      {/* Main content — py-6 is the desktop rhythm; on a phone the board wants
          that space, so the top padding drops to 4px. */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1 sm:py-6">
        {activeTab === "training" && (
          <TrainingTab
            themeCounts={themeCounts}
            openingCounts={openingCounts}
            settings={settings}
            dueCount={dueCount}
            attempts={attempts}
            dispenseThemed={dispenseThemed}
            difficulty={difficulty}
            boardContext={boardContext}
            selectedPuzzle={selectedPuzzle}
            renderBoardPanel={renderBoardPanel}
            setActiveTab={setActiveTab}
            setActiveQueue={setActiveQueue}
            pinned={pinned}
            unpin={unpin}
            onOpenPicker={() => setShowPicker(true)}
            onGoToAllThemes={() => setActiveTab("allthemes")}
            onReorder={reorder}
            quickRun={quickRun}
            savedQuickRun={savedQuickRun}
            activeTheme={activeTheme}
            onQuickStart={startQuickRun}
            onQuickStartResume={resumeQuickRun}
            onQuickStartStop={stopQuickRun}
            onStartDueReview={startDueReview}
          />
        )}
        {activeTab === "mistakes" && renderMistakes()}
        {activeTab === "dashboard" && renderAnalytics()}
        {activeTab === "allthemes" && (
          <AllThemesTab
            themeCounts={themeCounts}
            openingCounts={openingCounts}
            difficulty={difficulty}
            setDifficulty={setDifficulty}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            expandedCategories={expandedCategories}
            setExpandedCategories={setExpandedCategories}
            selectedTheme={selectedTheme}
            setSelectedTheme={setSelectedTheme}
            dispenseThemed={dispenseThemed}
            dispenseOpening={dispenseOpening}
            boardContext={boardContext}
            selectedPuzzle={selectedPuzzle}
            renderBoardPanel={renderBoardPanel}
          />
        )}
        {activeTab === "appearance" && renderSettings()}
      </main>

      {/* Pinned-theme picker (modal) */}
      <ThemePicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        pinned={pinned}
        themeCounts={themeCounts}
        openingCounts={openingCounts}
        onToggle={toggle}
        onPinMany={pinMany}
        onUnpinAll={unpinAll}
        onUnpin={unpinId}
      />

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold">Settings</h2>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Rating Range</label>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    value={settings?.ratingMin || 1000}
                    onChange={e => updateSettings({ ratingMin: parseInt(e.target.value) || 1000 })}
                    className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                    min={1000}
                    max={2200}
                  />
                  <span className="text-gray-400">–</span>
                  <input
                    type="number"
                    value={settings?.ratingMax || 2200}
                    onChange={e => updateSettings({ ratingMax: parseInt(e.target.value) || 2200 })}
                    className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                    min={1000}
                    max={2200}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">New Puzzles Per Day</label>
                <input
                  type="number"
                  value={settings?.newPuzzlesPerDay || 5}
                  onChange={e => updateSettings({ newPuzzlesPerDay: parseInt(e.target.value) || 5 })}
                  className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                  min={1}
                  max={50}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Theme Filters</label>
                <ThemeFilter
                  selectedThemes={selectedThemes}
                  onThemesChange={themes => {
                    setSelectedThemes(themes);
                    updateSettings({ themesFilter: themes });
                  }}
                  themeCounts={themeCounts}
                />
              </div>

              <div className="pt-4 border-t flex justify-end gap-3">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Training tab — QUICK PIN page.
 * Shows only a compact grid of the user's pinned themes as big
 * one-click cards, plus a small "+ Add theme" affordance and an empty
 * state. The full theme browser lives in the All themes tab.
 * ------------------------------------------------------------------ */
function TrainingTab({
  themeCounts,
  openingCounts,
  settings,
  dueCount,
  attempts,
  dispenseThemed,
  difficulty,
  boardContext,
  selectedPuzzle,
  renderBoardPanel,
  setActiveTab,
  setActiveQueue,
  pinned,
  unpin,
  onOpenPicker,
  onGoToAllThemes,
  quickRun,
  savedQuickRun,
  activeTheme,
  onQuickStart,
  onQuickStartResume,
  onQuickStartStop,
  onStartDueReview,
  onReorder,
}: any) {
  // Start training on a specific theme — dispenses a NEW puzzle and renders
  // the board INSIDE the Training tab (stays put; no bounce to Mistakes).
  const startTheme = (themeId: string) => {
    dispenseThemed([themeId as LichessTheme], difficulty, "training");
  };

  // Dispense a random NEW puzzle (any theme).
  const dispenseRandom = () => {
    dispenseThemed([], difficulty, "training");
  };

  const boardUpHere = boardContext === "training" && !!selectedPuzzle;
  // How many puzzles a Training Block run serves per pinned theme. Validated on
  // read so a bad stored value (a test harness once seeded 6) cannot render a
  // nonsense block size.
  const quickStartCount = sanitizeQuickStartCount(settings?.quickStartCount);

  // A durable block we can pick up where the user left off. Only "resumable"
  // when nothing is actively running — a RUNNING block shows the live counter.
  const resumable = !quickRun && !!savedQuickRun;
  // The global position / total of the whole run (not just the current block):
  // with 16 pins and count 5 this reads "1 / 80" and ends at "80 / 80".
  const livePos = quickRun ? quickRunPosition(quickRun) : 0;
  const liveTotal = quickRun ? quickRunTotal(quickRun) : 0;
  const resumePos = savedQuickRun ? quickRunPosition(savedQuickRun) : 0;
  const resumeTotal = savedQuickRun ? quickRunTotal(savedQuickRun) : 0;

  const quickStartRow = (
    <div className="mb-4 flex flex-wrap items-center gap-4">
        <button
          data-testid="quickstart-button"
          onClick={resumable ? onQuickStartResume : onQuickStart}
          disabled={!resumable && pinned.length === 0}
          className={
            "flex items-center gap-2 px-6 py-3 rounded-lg text-white transition-colors font-medium " +
            (!resumable && pinned.length === 0
              ? "bg-green-300 cursor-not-allowed"
              : "bg-green-700 hover:bg-green-800")
          }
        >
          {resumable ? `▶ Continue ${resumePos} / ${resumeTotal}` : "▶ Start new"}
        </button>

        {/* Before starting: how big the run will be. The user could not tell how
            many puzzles an auto-play would serve, so state it up front. Hidden
            while a block is resumable — the button already reads "Continue N / M". */}
        {!quickRun && !savedQuickRun && pinned.length > 0 && (
          <span className="text-xs text-gray-400 dark:text-[#6b6a68] tabular-nums" data-testid="quickrun-plan">
            {pinned.length} theme{pinned.length === 1 ? "" : "s"} × {quickStartCount} ={" "}
            {pinned.length * quickStartCount} puzzles
          </span>
        )}

        {quickRun && (
          <div className="flex items-center gap-3 flex-wrap" data-testid="quickrun-status">
            <span className="text-sm font-semibold text-gray-800 dark:text-[#e5e0d8] tabular-nums" data-testid="quickrun-counter">
              {livePos} / {liveTotal}
            </span>
            <span className="text-xs text-gray-400 dark:text-[#6b6a68] tabular-nums">
              theme {quickRun.themeIndex + 1} of {quickRun.themes.length}
            </span>
            <button
              data-testid="quickrun-stop"
              onClick={onQuickStartStop}
              className="text-xs text-gray-500 hover:underline"
            >
              Stop
            </button>
          </div>
        )}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
      {/* The Quick start row is the call to action when there is NO board. Once a
          puzzle is up it moves BELOW the board, where its ~64px no longer pushes
          the board and its buttons below the fold. */}
      {!boardUpHere && quickStartRow}

      {/* Board — rendered INSIDE the Training tab when a training puzzle is active.
          The negative margins cancel this tab's own container padding: `main`
          ALREADY provides px-4/sm:px-6/lg:px-8, so without this the board was
          padded twice and came out 326px wide while Review's identical board was
          358px. The two tabs must render the same board at the same width. */}
      {boardContext === "training" && selectedPuzzle && (
        <div
          className="mb-4 -mx-4 sm:-mx-6 lg:-mx-8"
          data-testid="training-board"
          style={{ scrollMarginTop: "var(--board-header, 65px)" }}
        >
          {renderBoardPanel("training")}
        </div>
      )}

      {/* While a board is up, the Quick start / Stop row lives here, under the
          board. The run's progress is already visible in the board's session
          strip, so nothing is hidden except having to scroll past it. */}
      {boardUpHere && quickStartRow}

      {/* Rating & Stats Bar */}
      <div className="flex flex-wrap items-center gap-4 mb-8 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Your rating:</span>
          <span className="text-2xl font-bold font-mono text-blue-600 dark:text-blue-400">
            {settings?.rating || 1000}
          </span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Streak:</span>
          <span className="text-xl font-bold font-mono text-orange-600 dark:text-orange-400">
            {settings?.streak || 0} 🔥
          </span>
        </div>
        {dueCount > 0 && (
          <button
            onClick={onStartDueReview}
            className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            ⏰ {dueCount} puzzles due for review
          </button>
        )}

        {/* Rating sparkline — driven by the user's real attempt history */}
        <div className="ml-auto flex items-center gap-3 pl-4 border-l border-gray-200 dark:border-gray-700">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-gray-500 dark:text-gray-400">Rating trend</div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 tabular-nums">
              {(attempts as PuzzleAttempt[]).length} attempts
            </div>
          </div>
          <div className="w-28 sm:w-36 h-10" data-testid="rating-sparkline">
            <RatingProgressChart data={attempts as PuzzleAttempt[]} />
          </div>
        </div>
      </div>

      {/* Pinned themes — the quick-launch grid */}
      <PinnedThemes
        pinned={pinned}
        themeCounts={themeCounts}
        openingCounts={openingCounts}
        onPlay={startTheme}
        onUnpin={unpin}
        onOpenPicker={onOpenPicker}
        onGoToAllThemes={onGoToAllThemes}
        onReorder={onReorder}
      />

      {/* Quick Actions */}
      <div className="mt-10 flex flex-wrap gap-4">
        <button
          onClick={dispenseRandom}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          🎲 Random Puzzle
        </button>
        {dueCount > 0 && (
          <button
            onClick={onStartDueReview}
            className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
          >
            ⏰ Review Due ({dueCount})
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * All themes tab — the FULL theme browser (search, category &
 * difficulty dropdowns, category pills, collapsible category sections
 * with every theme card). Relocated from the old Training tab.
 * ------------------------------------------------------------------ */
function AllThemesTab({
  themeCounts,
  openingCounts,
  difficulty,
  setDifficulty,
  searchQuery,
  setSearchQuery,
  selectedCategory,
  setSelectedCategory,
  expandedCategories,
  setExpandedCategories,
  selectedTheme,
  setSelectedTheme,
  dispenseThemed,
  dispenseOpening,
  boardContext,
  selectedPuzzle,
  renderBoardPanel,
}: any) {
  // Dropdown open state
  const [catOpen, setCatOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  // Long-tail toggle for the Openings section.
  const [showAllOpenings, setShowAllOpenings] = useState(false);

  // Threshold below which an opening is de-emphasised (hidden behind a toggle).
  const OPENING_PROMINENT_MIN = 10;

  // The Openings section is expanded via the SAME expandedCategories state as
  // the theme categories, under a reserved key.
  const OPENINGS_KEY = "__openings__";
  // While a search is active the section auto-expands as soon as it has matches.
  // Without this, searching "jobava" DID narrow 1591 openings to 4, but they
  // stayed inside a collapsed accordion, so it looked like nothing was found.
  const searching = searchQuery.trim().length > 0;
  const openingsHasMatches = (openingCounts as Record<string, number> | undefined)
    ? Object.keys(openingCounts ?? {}).some((k) => k.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : searching;
  const isOpeningsExpanded =
    (expandedCategories as string[]).includes(OPENINGS_KEY) ||
    (searching && openingsHasMatches);

  // Start training on a specific theme — dispenses a NEW puzzle and renders the
  // board INSIDE the All themes tab, so you stay where you clicked.
  const startTheme = (themeId: string) => {
    dispenseThemed([themeId as LichessTheme], difficulty, "allthemes");
    setSelectedTheme(null);
  };

  // Start training on a specific opening family (same board/tab, same pool).
  const startOpening = (openingId: string) => {
    dispenseOpening(openingId, difficulty, "allthemes");
    setSelectedTheme(null);
  };

  // Live openings list (base family -> count), sorted by count desc. Empty
  // openings never appear (count > 0 filter), matching the app's "no empty
  // card" rule.
  const openings = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const rows = Object.entries((openingCounts || {}) as Record<string, number>)
      .filter(([, c]) => c > 0)
      .map(([id, count]) => {
        const meta = getOpeningMeta(id);
        return { id, count, label: meta.label, description: meta.description };
      })
      .filter(
        (o) =>
          !q ||
          o.label.toLowerCase().includes(q) ||
          o.description.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q)
      )
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const big = rows.filter((o) => o.count >= OPENING_PROMINENT_MIN);
    const small = rows.filter((o) => o.count < OPENING_PROMINENT_MIN);
    return {
      big,
      small,
      total: rows.length,
      totalPuzzles: rows.reduce((s, o) => s + o.count, 0),
    };
  }, [openingCounts, searchQuery]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">All themes</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Choose a theme to start training. Each theme shows puzzles matching that motif.
        </p>
      </div>

      {/* Board — rendered INSIDE this tab when a puzzle was started from here, so
          you stay where you clicked and can see the theme above the board. */}
      {boardContext === "allthemes" && selectedPuzzle && (
        <div className="mb-8" data-testid="allthemes-board">
          {renderBoardPanel("allthemes")}
        </div>
      )}

      {/* Toolbar: Search, Category filter, Difficulty dropdown */}
      <div className="mb-6 flex flex-wrap items-center gap-4 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search themes..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            data-testid="theme-search"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        </div>

        {/* Category Filter Dropdown */}
        <div className="relative">
          <button
            onClick={() => { setCatOpen(o => !o); setDiffOpen(false); }}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            <span>{selectedCategory === "all" ? "All Categories" : selectedCategory}</span>
            <span className={`text-gray-400 transition-transform ${catOpen ? "rotate-180" : ""}`}>▼</span>
          </button>
          {catOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setCatOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-20 max-h-80 overflow-y-auto">
                <button
                  onClick={() => { setSelectedCategory("all"); setCatOpen(false); }}
                  className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                    selectedCategory === "all"
                      ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  All Categories
                </button>
                {Object.keys(THEME_CATEGORIES).map(cat => (
                  <button
                    key={cat}
                    onClick={() => { setSelectedCategory(cat); setCatOpen(false); }}
                    className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                      cat === selectedCategory
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Difficulty Dropdown */}
        <div className="relative">
          <button
            onClick={() => { setDiffOpen(o => !o); setCatOpen(false); }}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            <span>Difficulty: {DIFFICULTY_LEVELS.find(d => d.id === difficulty)?.label || "Normal"}</span>
            <span className={`text-gray-400 transition-transform ${diffOpen ? "rotate-180" : ""}`}>▼</span>
          </button>
          {diffOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDiffOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-20">
                {DIFFICULTY_LEVELS.map(d => (
                  <button
                    key={d.id}
                    onClick={() => { setDifficulty(d.id); setDiffOpen(false); }}
                    className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                      d.id === difficulty
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Category Quick Filter Buttons */}
        <div className="hidden md:flex flex-wrap gap-2">
          {Object.keys(THEME_CATEGORIES).map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat === selectedCategory ? "all" : cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                cat === selectedCategory
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Selected Theme Preview / Start Button */}
      {selectedTheme && FLAT_THEME_CARDS[selectedTheme] && (
        <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{FLAT_THEME_CARDS[selectedTheme].icon}</span>
              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{FLAT_THEME_CARDS[selectedTheme].label}</h3>
                <p className="text-gray-500 dark:text-gray-400">{FLAT_THEME_CARDS[selectedTheme].description}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {fmtCount(themeCounts[selectedTheme as LichessTheme] || 0)} puzzles
              </span>
              <button
                onClick={() => startTheme(selectedTheme)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Start Training
              </button>
              <button
                onClick={() => setSelectedTheme(null)}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Theme Categories with Collapsible Sections */}
      <div className="space-y-4" data-testid="theme-categories">
        {/* ── Openings drill-down ──────────────────────────────────────────
            A SEPARATE dimension from themes (its own pool column). Styled to
            match the category sections below and expanded via the same
            expandedCategories state. Hidden only when a search excludes all
            openings. */}
        {(!searchQuery || openings.total > 0) && (
          <div
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            data-testid="openings-section"
          >
            <button
              data-testid="openings-toggle"
              onClick={() =>
                setExpandedCategories((prev: string[]) =>
                  prev.includes(OPENINGS_KEY)
                    ? prev.filter((c: string) => c !== OPENINGS_KEY)
                    : [...prev, OPENINGS_KEY]
                )
              }
              className="w-full px-5 py-4 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={`text-gray-400 transition-transform ${isOpeningsExpanded ? "rotate-90" : ""}`}>▶</span>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Openings</h3>
                <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-mono text-gray-600 dark:text-gray-400">
                  {fmtCount(openings.totalPuzzles)} puzzles · {openings.total} openings
                </span>
              </div>
            </button>

            {isOpeningsExpanded && (
              <div className="p-4 space-y-2" data-testid="openings-list">
                {openings.total === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 px-1 py-2">
                    No openings match your search.
                  </p>
                )}

                {/* Big openings (>= 10 puzzles) — full cards, count desc. */}
                {openings.big.map((o) => (
                  <button
                    key={o.id}
                    data-testid={`opening-${o.id}`}
                    onClick={() => startOpening(o.id)}
                    className="w-full p-3 rounded-lg text-left transition-all duration-200 border border-transparent hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl shrink-0">{getThemeIcon(o.id)}</span>
                        <div className="min-w-0">
                          <h4 className="font-medium text-gray-900 dark:text-white">{o.label}</h4>
                          {o.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{o.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-mono text-gray-600 dark:text-gray-400">
                          {fmtCount(o.count)} puzzles
                        </span>
                        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Play →</span>
                      </div>
                    </div>
                  </button>
                ))}

                {/* Long tail (< 10 puzzles) — de-emphasised, behind a toggle. */}
                {openings.small.length > 0 && (
                  <div className="pt-2">
                    <button
                      data-testid="openings-longtail-toggle"
                      onClick={() => setShowAllOpenings((v) => !v)}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {showAllOpenings ? "▲ Hide" : "▼ Show"} {openings.small.length} smaller openings (fewer than {OPENING_PROMINENT_MIN} puzzles)
                    </button>
                    {showAllOpenings && (
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                        {openings.small.map((o) => (
                          <button
                            key={o.id}
                            data-testid={`opening-${o.id}`}
                            onClick={() => startOpening(o.id)}
                            className="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded text-left text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            <span className="truncate">{o.label}</span>
                            <span className="tabular-nums opacity-70 shrink-0">{fmtCount(o.count)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {Object.entries(THEME_CATEGORIES).map(([category, themes]) => {
          const categoryThemes = themes.filter(t => {
            const q = searchQuery.toLowerCase();
            return t.label.toLowerCase().includes(q) ||
                   t.description?.toLowerCase().includes(q) ||
                   category.toLowerCase().includes(q);
          });
          if (categoryThemes.length === 0 && searchQuery) return null;

          // Auto-expand a category while searching, so matches are actually visible.
          const isExpanded = expandedCategories.includes(category) || (searching && categoryThemes.length > 0);
          const totalCount = themes.reduce((sum, t) => sum + (themeCounts[t.id as LichessTheme] || 0), 0);

          return (
            <div key={category} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => setExpandedCategories((prev: string[]) =>
                  prev.includes(category)
                    ? prev.filter((c: string) => c !== category)
                    : [...prev, category]
                )}
                className="w-full px-5 py-4 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{category}</h3>
                  <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-mono text-gray-600 dark:text-gray-400">
                    {fmtCount(totalCount)} puzzles
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="p-4 space-y-2">
                  {categoryThemes.map(theme => (
                    <button
                      key={theme.id}
                      onClick={() => startTheme(theme.id)}
                      disabled={(themeCounts[theme.id as LichessTheme] || 0) === 0}
                      className={`w-full p-3 rounded-lg text-left transition-all duration-200 border border-transparent hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800 disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{FLAT_THEME_CARDS[theme.id]?.icon || "🎯"}</span>
                          <div>
                            <h4 className="font-medium text-gray-900 dark:text-white">{theme.label}</h4>
                            {theme.description && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{theme.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-mono text-gray-600 dark:text-gray-400">
                            {fmtCount(themeCounts[theme.id as LichessTheme] || 0)} puzzles
                          </span>
                          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            Play →
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
