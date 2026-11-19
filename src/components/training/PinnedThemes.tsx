"use client";

import { FLAT_THEME_CARDS, fmtCount, getOpeningMeta, getThemeIcon } from "./themeCatalogue";

interface PinnedThemesProps {
  pinned: string[];
  themeCounts: Record<string, number>;
  /** Opening -> puzzle count. Needed because a pinned id may be an opening. */
  openingCounts?: Record<string, number>;
  /** Tap a pinned card → start that theme/opening immediately. */
  onPlay: (themeId: string) => void;
  onUnpin: (themeId: string) => void;
  onOpenPicker: () => void;
  onGoToAllThemes: () => void;
}

/**
 * Quick-launch grid of the user's PINNED themes and openings. Big one-click
 * cards; a small × on each card unpins it. Shows a helpful empty state when
 * nothing is pinned.
 */
export function PinnedThemes({
  pinned,
  themeCounts,
  openingCounts = {},
  onPlay,
  onUnpin,
  onOpenPicker,
  onGoToAllThemes,
}: PinnedThemesProps) {
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {pinned.map((id) => {
            // A pinned id can be a THEME or an OPENING. Resolve both, otherwise a
            // pinned opening falls back to the raw id with a count of 0 and the
            // card renders disabled even though it is perfectly playable.
            const card = FLAT_THEME_CARDS[id];
            const openingMeta = card ? null : getOpeningMeta(id);
            const label = card?.label || openingMeta?.label || id;
            const icon = card?.icon || getThemeIcon(id) || "🎯";
            const count = card ? (themeCounts[id] || 0) : (openingCounts[id] || 0);
            return (
              <div key={id} className="relative">
                <button
                  data-testid={`pinned-card-${id}`}
                  data-theme={id}
                  data-kind={card ? "theme" : "opening"}
                  onClick={() => onPlay(id)}
                  disabled={count === 0}
                  className="w-full h-full text-left p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
                <button
                  data-testid={`unpin-${id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnpin(id);
                  }}
                  title="Unpin"
                  aria-label={`Unpin ${label}`}
                  className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600 dark:hover:text-red-400 transition-colors text-sm leading-none"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
