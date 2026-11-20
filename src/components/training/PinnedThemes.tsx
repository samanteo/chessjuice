"use client";

import { useCallback, useRef, useState } from "react";
import { FLAT_THEME_CARDS, fmtCount, getOpeningMeta, getThemeIcon } from "./themeCatalogue";

interface PinnedThemesProps {
  pinned: string[];
  themeCounts: Record<string, number>;
  /** Opening -> puzzle count. Needed because a pinned id may be an opening. */
  openingCounts?: Record<string, number>;
  /** Tap a pinned card → start that theme/opening immediately. */
  onPlay: (themeId: string) => void;
  /**
   * Remove the pin at this INDEX. Index-based because the same theme/opening id
   * may be pinned several times — removing a block must remove only that block.
   */
  onUnpin: (index: number) => void;
  onOpenPicker: () => void;
  onGoToAllThemes: () => void;
  /** Persist a new order. Quick start walks the pins in exactly this order. */
  onReorder?: (themeIds: string[]) => void;
}

/**
 * Quick-launch grid of the user's PINNED themes and openings.
 *
 * ORDER MATTERS: a Quick start run walks the pins in list order, so the grid is
 * reorderable three ways —
 *   1. drag the ⠿ handle (pointer events, so it works with a FINGER, not just a
 *      mouse; HTML5 drag-and-drop never fires on touch),
 *   2. tap ◀ / ▶ to nudge a card one place,
 *   3. the 1,2,3 badge always shows where a card sits in the run.
 * The nudge buttons exist because drag is fiddly on a phone; the badge exists so
 * the order is never a mystery.
 */
export function PinnedThemes({
  pinned,
  themeCounts,
  openingCounts = {},
  onPlay,
  onUnpin,
  onOpenPicker,
  onGoToAllThemes,
  onReorder,
}: PinnedThemesProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const commit = useCallback(
    (from: number, to: number) => {
      if (!onReorder || from === to || to < 0 || to >= pinned.length) return;
      const next = pinned.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onReorder(next);
    },
    [onReorder, pinned]
  );

  /** Which card is under this viewport point? */
  const indexAtPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const card = el?.closest?.("[data-index]") as HTMLElement | null;
    if (!card) return null;
    const n = Number(card.getAttribute("data-index"));
    return Number.isFinite(n) ? n : null;
  };

  const onHandleDown = (i: number) => (e: React.PointerEvent) => {
    if (!onReorder) return;
    e.preventDefault();
    e.stopPropagation();
    setDragIndex(i);
    setOverIndex(i);
    // Capture so we keep receiving moves even if the finger leaves the card.
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onGridMove = (e: React.PointerEvent) => {
    if (dragIndex === null) return;
    const i = indexAtPoint(e.clientX, e.clientY);
    if (i !== null && i !== overIndex) setOverIndex(i);
  };

  const onGridUp = () => {
    if (dragIndex !== null && overIndex !== null) commit(dragIndex, overIndex);
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <section className="mb-8" data-testid="pinned-themes">
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Quick start</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Your pinned themes — one tap to start a puzzle.
          </p>
        </div>
        <button
          onClick={onOpenPicker}
          data-testid="add-theme"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
        >
          ➕ Add theme
        </button>
      </div>

      {pinned.length > 1 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3" data-testid="order-hint">
          Drag ⠿ or use ◀ ▶ to set the order. Quick start runs them top-left first:
          <span className="font-semibold">
            {" "}
            {pinned
              .map((id) => FLAT_THEME_CARDS[id]?.label || getOpeningMeta(id).label || id)
              .slice(0, 4)
              .join(" → ")}
            {pinned.length > 4 ? ` → +${pinned.length - 4} more` : ""}
          </span>
        </p>
      )}

      {pinned.length === 0 ? (
        <div
          data-testid="pinned-empty"
          className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-10 text-center"
        >
          <div className="text-5xl mb-3">📌</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            Pin your daily themes here
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md mx-auto">
            Pick from <strong>All themes</strong> to build a quick-launch grid of the motifs you
            practise every day — no more scrolling a huge list to find them.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onOpenPicker}
              data-testid="empty-add-theme"
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              ➕ Add theme
            </button>
            <button
              onClick={onGoToAllThemes}
              data-testid="empty-browse-all"
              className="px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors font-medium"
            >
              🗂️ Browse All themes
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={gridRef}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
          onPointerMove={onGridMove}
          onPointerUp={onGridUp}
          onPointerCancel={onGridUp}
          data-testid="pinned-grid"
        >
          {pinned.map((id, i) => {
            // A pinned id can be a THEME or an OPENING. Resolve both, otherwise a
            // pinned opening falls back to the raw id with a count of 0 and the
            // card renders disabled even though it is perfectly playable.
            const card = FLAT_THEME_CARDS[id];
            const openingMeta = card ? null : getOpeningMeta(id);
            const label = card?.label || openingMeta?.label || id;
            const icon = card?.icon || getThemeIcon(id) || "🎯";
            const count = card ? (themeCounts[id] || 0) : (openingCounts[id] || 0);
            const isDragging = dragIndex === i;
            const isOver = dragIndex !== null && overIndex === i && dragIndex !== i;
            return (
              <div
                key={i}
                className="relative"
                data-index={i}
                data-testid={`pinned-slot-${i}`}
              >
                <button
                  data-testid={`pinned-card-${id}`}
                  data-theme={id}
                  data-kind={card ? "theme" : "opening"}
                  data-order={i + 1}
                  onClick={() => onPlay(id)}
                  disabled={count === 0}
                  className={
                    "w-full h-full text-left p-4 pt-7 rounded-xl bg-white dark:bg-gray-800 border shadow-sm hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed " +
                    (isOver
                      ? "border-blue-500 ring-2 ring-blue-400/50"
                      : "border-gray-200 dark:border-gray-700") +
                    (isDragging ? " opacity-60" : "")
                  }
                >
                  <div className="text-3xl mb-2">{icon}</div>
                  <div className="font-semibold text-gray-900 dark:text-white leading-tight">
                    {label}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-mono text-gray-600 dark:text-gray-400">
                      {fmtCount(count)}
                    </span>
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                      Play →
                    </span>
                  </div>
                </button>

                {/* Order badge — always tells you where this sits in a run. */}
                <span
                  data-testid={`order-badge-${i}`}
                  title={`Position ${i + 1} in the Quick start order`}
                  className="absolute top-2 left-2 min-w-[1.35rem] h-[1.35rem] px-1 flex items-center justify-center rounded-full bg-gray-900/80 dark:bg-black/70 text-white text-[11px] font-bold tabular-nums pointer-events-none"
                >
                  {i + 1}
                </span>

                {/* Drag handle — pointer events so a finger works. */}
                {onReorder && pinned.length > 1 && (
                  <span
                    data-testid={`drag-handle-${i}`}
                    onPointerDown={onHandleDown(i)}
                    title="Drag to reorder"
                    aria-label={`Reorder ${label}`}
                    role="button"
                    className="absolute top-1.5 left-8 w-7 h-6 flex items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-grab active:cursor-grabbing touch-none select-none"
                  >
                    ⠿
                  </span>
                )}

                <button
                  data-testid={`unpin-${id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnpin(i);
                  }}
                  title="Unpin"
                  aria-label={`Unpin ${label}`}
                  className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600 dark:hover:text-red-400 transition-colors text-sm leading-none"
                >
                  ×
                </button>

                {/* Nudge buttons — reliable order control on a touch screen. */}
                {onReorder && pinned.length > 1 && (
                  <div className="absolute bottom-2 right-2 flex gap-1">
                    <button
                      data-testid={`move-earlier-${i}`}
                      disabled={i === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        commit(i, i - 1);
                      }}
                      title="Move earlier in the Quick start order"
                      aria-label={`Move ${label} earlier`}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      ◀
                    </button>
                    <button
                      data-testid={`move-later-${i}`}
                      disabled={i === pinned.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        commit(i, i + 1);
                      }}
                      title="Move later in the Quick start order"
                      aria-label={`Move ${label} later`}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs disabled:opacity-30 hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      ▶
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
