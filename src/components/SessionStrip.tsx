"use client";

/**
 * Session strip — the previous/next PUZZLE pager under the board.
 *
 * One entry per puzzle served in the CURRENT THEME BATCH of this sitting. It
 * resets whenever the theme changes, which is exactly when a Quick start run
 * moves on to its next pinned theme.
 *
 * ◀ ▶ walk the batch one puzzle at a time; either one REPLAYS the puzzle it lands
 * on — no rating change, no SM-2, no history entry (the parent routes it through
 * the same practice queue Analytics uses).
 *
 * There used to be one small SQUARE per puzzle as well. They were REMOVED on the
 * user's request: "eventually there will be more squares than the page can
 * handle, the left right thing will be enough." The whole batch is still walked by
 * the arrows, and the counter says where you are. The bound on how much history
 * is kept now lives in the parent (`MAX_SESSION_ENTRIES`), not here.
 */

export interface SessionEntry {
  id: string;
  /** Lichess result vocabulary: correct / incorrect / hard / solution. */
  result?: string;
  rating?: number;
}

export function SessionStrip({
  entries,
  activeIndex,
  themeLabel,
  onReplayAt,
}: {
  entries: SessionEntry[];
  /** Index of the puzzle currently on the board, or null when browsing freely. */
  activeIndex: number | null;
  themeLabel?: string | null;
  onReplayAt: (index: number) => void;
}) {
  if (entries.length === 0) return null;

  const currentIdx =
    activeIndex !== null && activeIndex >= 0 && activeIndex < entries.length
      ? activeIndex
      : entries.length - 1;

  const canPrev = currentIdx > 0;
  const canNext = currentIdx < entries.length - 1;

  return (
    <div
      // A card treatment, not just a top hairline. The strip sits between the
      // board's action row and Skip/Hard, where a transparent background made it
      // read as empty space.
      // NOTE: this app's tokens are --surface-* / --text (NOT --foreground, which
      // only the desktop widget frame injects). Referencing an undefined var made
      // the whole declaration invalid and it silently fell back to transparent.
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg"
      data-testid="session-strip"
      style={{
        background: "var(--surface-3)",
        border: "1px solid var(--border-strong)",
      }}
    >
      <button
        onClick={() => canPrev && onReplayAt(currentIdx - 1)}
        disabled={!canPrev}
        data-testid="session-prev"
        aria-label="Previous puzzle in this batch"
        className="px-2 py-1 rounded text-sm disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/10"
      >
        ◀
      </button>

      <div
        className="flex-1 min-w-0 text-center text-xs tabular opacity-80 truncate"
        data-testid="session-label"
      >
        {themeLabel ? `${themeLabel} · ` : ""}Puzzle {currentIdx + 1} / {entries.length}
      </div>

      <button
        onClick={() => canNext && onReplayAt(currentIdx + 1)}
        disabled={!canNext}
        data-testid="session-next"
        aria-label="Next puzzle in this batch"
        className="px-2 py-1 rounded text-sm disabled:opacity-30 hover:bg-black/5 dark:hover:bg-white/10"
      >
        ▶
      </button>
    </div>
  );
}

export default SessionStrip;
