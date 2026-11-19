"use client";

/**
 * Session strip — Lichess-style "progress chips" under the board.
 *
 * One square per puzzle served in the CURRENT THEME BATCH of this sitting. It
 * resets whenever the theme changes, which is exactly when a Quick start run
 * moves on to its next pinned theme ("everytime it switches theme it restarts").
 *
 * Tapping a square REPLAYS that puzzle: no rating change, no SM-2, no history
 * entry (the parent routes it through the same practice queue Analytics uses).
 *
 * Long batches cap at `MAX_SQUARES` rendered; the ◀ ▶ pair walks the WHOLE batch
 * one puzzle at a time and the counter says where you are, so nothing becomes
 * unreachable just because the row is capped.
 */

export interface SessionEntry {
  id: string;
  /** Lichess result vocabulary: correct / incorrect / hard / solution. */
  result?: string;
  rating?: number;
}

const MAX_SQUARES = 30;

const squareClass = (result?: string): string => {
  switch (result) {
    case "correct":
      return "bg-[#629924] border-[#4d7a1c]";
    case "solution":
      return "bg-amber-500 border-amber-600";
    case "hard":
      return "bg-orange-600 border-orange-700";
    case "incorrect":
      return "bg-[#c33] border-[#a11]";
    default:
      return "bg-neutral-300 dark:bg-neutral-600 border-neutral-400 dark:border-neutral-500";
  }
};

const squareLabel = (e: SessionEntry, i: number): string =>
  `Puzzle ${i + 1}${e.result ? ` — ${e.result}` : " — not played yet"}`;

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

  // Cap the RENDERED squares but keep the whole batch reachable via the arrows.
  const start = Math.max(0, entries.length - MAX_SQUARES);
  const shown = entries.slice(start);

  const playedIdx =
    activeIndex !== null && activeIndex >= 0 && activeIndex < entries.length
      ? activeIndex
      : entries.length - 1;
  const currentIdx = playedIdx;
  const counter = `${currentIdx + 1} / ${entries.length}`;

  const canPrev = currentIdx > 0;
  const canNext = currentIdx < entries.length - 1;

  return (
    <div
      // A card treatment, not just a top hairline. The strip is placed between
      // the Solution button and the Skip/Next column, where a transparent
      // background made it read as empty space — it needs to look like a block.
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

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap justify-center" data-testid="session-squares">
          {start > 0 && (
            <span className="text-[10px] opacity-60 mr-1">+{start} earlier</span>
          )}
          {shown.map((e, i) => {
            const abs = start + i;
            const isCurrent = abs === currentIdx;
            return (
              <button
                key={`${e.id}-${abs}`}
                onClick={() => onReplayAt(abs)}
                title={squareLabel(e, abs)}
                aria-label={squareLabel(e, abs)}
                data-testid={`session-square-${abs}`}
                data-result={e.result ?? "unplayed"}
                data-current={isCurrent ? "true" : "false"}
                className={`h-3.5 w-3.5 rounded-[2px] border ${squareClass(e.result)} ${
                  isCurrent ? "ring-2 ring-offset-1 ring-neutral-900 dark:ring-white" : "opacity-85"
                }`}
              />
            );
          })}
        </div>
        <div className="text-[10px] text-center opacity-70 mt-0.5 tabular">
          {themeLabel ? `${themeLabel} · ` : ""}
          Puzzle {counter}
        </div>
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
